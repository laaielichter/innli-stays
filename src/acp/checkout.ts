import { randomBytes } from 'node:crypto';
import { AgentError } from '../agentErrors.ts';
import { consentFor } from '../agent/consent.ts';
import type { Catalog } from '../catalog.ts';
import { refundability } from '../domain/cancellation.ts';
import { DateRangeError } from '../domain/dates.ts';
import type { BookingRequest, Property, Quote, QuoteLine } from '../domain/types.ts';
import { money } from '../i18n/index.ts';
import { PaymentError, type PaymentHandler } from '../payments/handlers.ts';
import { holderId, type AgentActions, type AgentContext } from '../requests/agentActions.ts';
import { rulesOf, type BookingEventType, type RequestService } from '../requests/service.ts';
import type { Store } from '../store.ts';
import { digitsOf, minor } from '../ucp/lodging.ts';
import type { AcpBuyer, CheckoutSessionRecord } from './types.ts';

/**
 * Agentic Commerce Protocol (ACP) checkout for stays. ACP was designed for
 * goods: an item is an id and a quantity, with no dates or guests. INNLI
 * bridges that with the thing it already has: a quote. An item id is either a
 * `quoteId` from search_stays or get_quote, or a stay written out as
 * `property:unit:checkin:checkout:adults[:children[:dogs[:ratePlan]]]`.
 *
 * A session holds the rooms; completing it sends the same booking request as
 * request_booking, with the same consent hash, hold limits and signed record.
 * With a payment handler the card is authorised at completion and only
 * captured when the host confirms; without one, the guest pays the property.
 */

export const ACP_VERSIONS = ['2026-04-17', '2026-01-16'];
export const ACP_BASE_PATH = '/acp';

type Json = Record<string, any>;

/** An ACP error: a flat `{ type, code, message, param? }` with an HTTP status. */
export class AcpError extends Error {
  status: number;
  type: 'invalid_request' | 'processing_error' | 'service_unavailable';
  code: string;
  param?: string;
  constructor(status: number, code: string, message: string, opts: { param?: string; type?: AcpError['type'] } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.param = opts.param;
    this.type = opts.type ?? 'invalid_request';
  }
  toJSON() {
    return { type: this.type, code: this.code, message: this.message, param: this.param };
  }
}

const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function acpDiscovery(publicUrl: string) {
  return { protocol: { name: 'acp', version: ACP_VERSIONS[0], supported_versions: ACP_VERSIONS }, api_base_url: `${publicUrl.replace(/\/$/, '')}${ACP_BASE_PATH}`, transports: ['rest'], capabilities: { services: ['checkout'] } };
}

interface StayParams {
  propertyId: string;
  unitId: string;
  checkin: string;
  checkout: string;
  guests: { adults: number; children: number; dogs: number };
  rooms: number;
  ratePlanId?: string;
  breakfast: boolean;
}

export class AcpCheckout {
  private store: Store;
  private catalog: Catalog;
  private actions: AgentActions;
  private requests: RequestService;
  private publicUrl: string;
  private handler?: PaymentHandler;
  private settling = new Set<Promise<void>>();

  constructor(store: Store, catalog: Catalog, actions: AgentActions, requests: RequestService, publicUrl: string, handler?: PaymentHandler) {
    this.store = store;
    this.catalog = catalog;
    this.actions = actions;
    this.requests = requests;
    this.publicUrl = publicUrl.replace(/\/$/, '');
    this.handler = handler;
  }

  // ---------------------------------------------------------------- Operations

  async create(body: unknown, agent: AgentContext) {
    const b = this.object(body);
    const items = this.items(b.items);
    const stays = items.map((item, i) => this.stayOf(item, i));
    const property = this.property(stays[0].propertyId);
    const session: CheckoutSessionRecord = {
      id: `cs_${randomBytes(12).toString('base64url')}`,
      propertyId: property.id,
      items,
      quoteIds: [],
      buyer: this.buyer(b.buyer, b.fulfillment_details),
      fulfillment_details: this.details(b.fulfillment_details),
      agentClient: agent.name,
      owner: (agent.identity ?? 'anonymous') === 'anonymous' ? undefined : holderId(agent),
      createdAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
    };
    await this.price(property, session, stays, agent);
    this.store.saveCheckoutSession(session);
    return this.render(session);
  }

  get(id: string, agent: AgentContext) {
    return this.render(this.session(id, agent));
  }

  async update(id: string, body: unknown, agent: AgentContext) {
    const session = this.session(id, agent);
    const status = this.statusOf(session);
    if (session.statusToken || status === 'canceled') throw new AcpError(400, 'invalid', `This checkout session is ${status} and can no longer be changed.`);
    const b = this.object(body);
    const next: CheckoutSessionRecord = { ...session, agentClient: agent.name };
    if (b.buyer !== undefined || b.fulfillment_details !== undefined) {
      next.buyer = this.buyer(b.buyer ?? session.buyer, b.fulfillment_details ?? session.fulfillment_details);
      if (b.fulfillment_details !== undefined) next.fulfillment_details = this.details(b.fulfillment_details);
    }
    if (b.items !== undefined) {
      const items = this.items(b.items);
      if (JSON.stringify(items) !== JSON.stringify(session.items)) {
        const stays = items.map((item, i) => this.stayOf(item, i));
        if (stays[0].propertyId !== session.propertyId) throw new AcpError(400, 'invalid', 'A checkout session belongs to one property. Start a new session for another property.', { param: '$.items' });
        // The old holds make way for the new selection; if pricing that fails, they come back.
        const held = session.quoteIds.map((q) => this.store.getQuote(q)).filter((q) => q?.hold).map((q) => ({ quote: q!, hold: q!.hold }));
        this.release(session);
        next.items = items;
        try {
          await this.price(this.property(session.propertyId), next, stays, agent);
        } catch (err) {
          for (const h of held) {
            h.quote.hold = h.hold;
            this.store.saveQuote(h.quote);
          }
          throw err;
        }
      }
    }
    Object.assign(session, next);
    this.store.saveCheckoutSession(session);
    return this.render(session);
  }

  async complete(id: string, body: unknown, agent: AgentContext) {
    const session = this.session(id, agent);
    // A repeated Complete is answered with the state the first one produced.
    if (session.statusToken) return this.render(session);
    const b = this.object(body);
    if (b.buyer !== undefined) {
      session.buyer = this.buyer(b.buyer, session.fulfillment_details);
      this.store.saveCheckoutSession(session);
    }
    const status = this.statusOf(session);
    if (status === 'canceled') throw new AcpError(400, 'invalid', 'This checkout session is canceled or expired. Start a new one.');
    if (session.handoffUrl) throw new AcpError(400, 'intervention_required', `This property takes bookings in its own booking system. Send the buyer to ${session.handoffUrl}`);
    if (status !== 'ready_for_payment') throw new AcpError(400, 'missing', 'A buyer with first name, last name and e-mail is required before completing.', { param: '$.buyer' });

    const property = this.property(session.propertyId);
    const quotes = session.quoteIds.map((q) => this.store.getQuote(q)!);
    const token = str(b.payment_data?.instrument?.credential?.token, 500);
    if (this.handler) {
      if (!b.payment_data) throw new AcpError(400, 'missing', 'payment_data is required: this property takes a card guarantee through its payment handler.', { param: '$.payment_data' });
      if (b.payment_data.handler_id !== this.handler.id || !token) throw new AcpError(400, 'invalid', `Use payment handler "${this.handler.id}" with a delegated payment token.`, { param: '$.payment_data' });
    } else if (b.payment_data) {
      throw new AcpError(400, 'invalid', 'This property offers no payment handler: the guest pays the property directly. Complete without payment_data.', { param: '$.payment_data' });
    }

    // 1. Authorise the card. Nothing is taken yet; if this fails, no request is made.
    const due = this.dueNow(property, quotes);
    let auth;
    if (this.handler && token) {
      try {
        auth = await this.handler.authorize({ token, amount: due, currency: property.currency, description: `${property.name}, ${quotes[0].checkin} to ${quotes[0].checkout}`, idempotencyKey: `${session.id}-authorize`, metadata: { checkout_session_id: session.id, property_id: property.id } });
      } catch (err) {
        if (err instanceof PaymentError) throw new AcpError(err.code === 'payment_provider_unavailable' ? 503 : 402, err.code, err.message, { param: '$.payment_data', type: err.code === 'payment_provider_unavailable' ? 'service_unavailable' : 'invalid_request' });
        throw err;
      }
    }

    // 2. Send the request: the same one request_booking sends.
    const buyer = session.buyer!;
    try {
      const result = (await this.actions.requestBooking(
        {
          ...(session.quoteIds.length === 1 ? { quoteId: session.quoteIds[0] } : { quoteIds: session.quoteIds }),
          guest: { name: `${buyer.first_name} ${buyer.last_name}`, email: buyer.email!, phone: buyer.phone_number },
          // Complete is the platform's statement that the buyer reviewed and confirmed these exact terms.
          guestConsent: true,
          consentHash: consentFor(property, quotes).hash,
          idempotencyKey: session.id,
        },
        agent,
      )) as { statusToken: string };
      session.statusToken = result.statusToken;
      this.store.saveCheckoutSession(session);
    } catch (err) {
      if (auth) await this.handler!.release(auth, `${session.id}-release`).catch(() => {});
      if (!(err instanceof AgentError)) throw err;
      if (err.code === 'UNAVAILABLE') {
        this.cancelOpen(session);
        throw new AcpError(409, 'out_of_stock', err.message, { param: '$.items' });
      }
      if (err.code === 'TERMS_CHANGED' || err.code === 'QUOTE_EXPIRED') {
        this.release(session);
        await this.price(property, session, session.items.map((item, i) => this.stayOf(item, i)), agent).catch(() => this.cancelOpen(session));
        this.store.saveCheckoutSession(session);
        throw new AcpError(409, 'invalid', 'The price or terms changed. Retrieve the session, show the buyer the new totals and complete again.', { param: '$.totals' });
      }
      if (err.code === 'RATE_LIMITED') throw new AcpError(429, 'rate_limit_exceeded', err.message, { type: 'service_unavailable' });
      throw new AcpError(err.code === 'AGENT_IDENTITY_REQUIRED' || err.code === 'FORBIDDEN' ? 403 : 400, err.code.toLowerCase(), `${err.message} ${err.hint ?? ''}`.trim());
    }

    // 3. Keep the authorisation with the booking; capture at once when it was confirmed instantly.
    const request = this.store.getRequestByToken(session.statusToken)!;
    if (auth) {
      request.cardPayment = auth;
      this.store.saveRequest(request);
      if (request.status === 'accepted') await this.settle(request, 'capture');
    }
    return this.render(session);
  }

  async cancel(id: string, agent: AgentContext) {
    const session = this.session(id, agent);
    const status = this.statusOf(session);
    if (status === 'completed' || status === 'canceled') throw new AcpError(405, 'invalid', `This checkout session is already ${status}. A confirmed booking is cancelled with cancel_request, under the terms agreed at booking.`);
    if (session.statusToken) {
      // Still waiting for the host: withdraw the request, which also releases the card authorisation.
      await this.actions.cancelRequest({ statusToken: session.statusToken, guestConsent: true, reason: 'Checkout session canceled by the platform' }, agent).catch((err) => {
        if (err instanceof AgentError) throw new AcpError(400, err.code.toLowerCase(), err.message);
        throw err;
      });
    } else this.cancelOpen(session);
    await this.idle();
    return this.render(session);
  }

  /** Card authorisations follow the booking: captured when confirmed, released when it does not happen. */
  onBookingEvent(_property: Property, type: BookingEventType, request: BookingRequest): void {
    if (!this.handler || request.cardPayment?.status !== 'authorized') return;
    const action = type === 'booking.confirmed' ? 'capture' : type === 'request.declined' || type === 'request.expired' || type === 'request.cancelled' ? 'release' : undefined;
    if (!action) return;
    const job = this.settle(request, action).finally(() => this.settling.delete(job));
    this.settling.add(job);
  }

  /** Waits for captures and releases in flight (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.settling.size) await Promise.allSettled([...this.settling]);
  }

  private async settle(request: BookingRequest, action: 'capture' | 'release'): Promise<void> {
    const auth = request.cardPayment;
    if (!this.handler || !auth || auth.status !== 'authorized') return;
    // Claim it first, so an event arriving twice cannot capture twice.
    auth.status = action === 'capture' ? 'captured' : 'released';
    auth.settledAt = new Date().toISOString();
    try {
      if (action === 'capture') await this.handler.capture(auth, `${request.id}-capture`);
      else await this.handler.release(auth, `${request.id}-release`);
      // A captured card payment is the deposit (or the whole amount) the host no longer has to chase.
      if (action === 'capture' && request.payment) Object.assign(request.payment, { status: 'paid', paidAt: auth.settledAt });
    } catch (err) {
      auth.status = 'failed';
      auth.error = `${action}: ${(err as Error).message}`.slice(0, 300);
    }
    this.store.saveRequest(request);
  }

  // ---------------------------------------------------------------- Input

  private object(body: unknown): Json {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
    return body as Json;
  }

  private items(raw: unknown): { id: string; quantity: number }[] {
    if (!Array.isArray(raw) || !raw.length || raw.length > 3) throw new AcpError(400, 'invalid', 'items must hold 1 to 3 entries: one per room type.', { param: '$.items' });
    return raw.map((item, i) => {
      const id = str(item?.id, 300);
      const quantity = Math.floor(Number(item?.quantity ?? 1));
      if (!id) throw new AcpError(400, 'missing', 'Every item needs an id: a quoteId, or property:unit:checkin:checkout:adults.', { param: `$.items[${i}].id` });
      if (!(quantity >= 1 && quantity <= 10)) throw new AcpError(400, 'invalid', 'quantity is the number of identical rooms: 1 to 10.', { param: `$.items[${i}].quantity` });
      return { id, quantity };
    });
  }

  /** An item is a quote that already exists, or a stay written out in its id. */
  private stayOf(item: { id: string; quantity: number }, i: number): StayParams {
    const param = `$.items[${i}].id`;
    if (item.id.startsWith('q_')) {
      const q = this.store.getQuote(item.id);
      if (!q) throw new AcpError(400, 'invalid', 'Unknown or expired quote. Get a quote first with get_quote or search_stays.', { param });
      return { propertyId: q.propertyId, unitId: q.unitId, checkin: q.checkin, checkout: q.checkout, guests: q.guests, rooms: item.quantity > 1 ? item.quantity : (q.rooms ?? 1), ratePlanId: q.ratePlanId, breakfast: q.breakfast };
    }
    const [propertyId, unitId, checkin, checkout, adults, children, dogs, ratePlanId] = item.id.split(':');
    if (!propertyId || !unitId || !DATE.test(checkin ?? '') || !DATE.test(checkout ?? '') || !(Number(adults) >= 1)) {
      throw new AcpError(400, 'invalid', 'An item id is a quoteId, or property:unit:checkin:checkout:adults[:children[:dogs[:ratePlan]]] with dates as YYYY-MM-DD.', { param });
    }
    const n = (v?: string) => Math.max(0, Math.min(20, Math.floor(Number(v) || 0)));
    return { propertyId, unitId, checkin, checkout, guests: { adults: n(adults), children: n(children), dogs: n(dogs) }, rooms: item.quantity, ratePlanId: ratePlanId && ratePlanId !== 'standard' ? ratePlanId : undefined, breakfast: false };
  }

  private buyer(raw: unknown, details: unknown): AcpBuyer | undefined {
    const b = this.object(raw);
    const d = this.object(details);
    const [first, ...rest] = String(d.name ?? '').trim().split(/\s+/).filter(Boolean);
    const buyer: AcpBuyer = { first_name: str(b.first_name, 80) ?? first, last_name: str(b.last_name, 80) ?? (rest.join(' ') || undefined), email: str(b.email, 200) ?? str(d.email, 200), phone_number: str(b.phone_number, 40) ?? str(d.phone_number, 40) };
    return Object.values(buyer).some(Boolean) ? buyer : undefined;
  }

  private details(raw: unknown): Record<string, unknown> | undefined {
    const d = this.object(raw);
    if (!Object.keys(d).length) return undefined;
    const a = this.object(d.address);
    // Kept only to echo back; a stay is not shipped anywhere.
    return { name: str(d.name, 160), phone_number: str(d.phone_number, 40), email: str(d.email, 200), address: Object.keys(a).length ? { name: str(a.name, 160), line_one: str(a.line_one), line_two: str(a.line_two), city: str(a.city, 100), state: str(a.state, 100), country: str(a.country, 2), postal_code: str(a.postal_code, 20) } : undefined };
  }

  private property(id: string): Property {
    const property = this.store.getProperty(id);
    if (!property || !property.published) throw new AcpError(400, 'invalid', 'This property is not offered here.', { param: '$.items' });
    return property;
  }

  private session(id: string, agent: AgentContext): CheckoutSessionRecord {
    const session = this.store.getCheckoutSession(id);
    if (!session || (session.owner && holderId(agent) !== session.owner)) throw new AcpError(404, 'not_found', 'Unknown checkout session.');
    return session;
  }

  // ---------------------------------------------------------------- Pricing and holds

  private async price(property: Property, session: CheckoutSessionRecord, stays: StayParams[], agent: AgentContext): Promise<void> {
    if (stays.some((s) => s.propertyId !== property.id)) throw new AcpError(400, 'invalid', 'All items of a checkout session must be at the same property.', { param: '$.items' });
    if (stays.some((s) => s.checkin !== stays[0].checkin || s.checkout !== stays[0].checkout)) throw new AcpError(400, 'invalid', 'All items of a checkout session must have the same dates.', { param: '$.items' });
    if (new Set(stays.map((s) => s.unitId)).size !== stays.length) throw new AcpError(400, 'invalid', 'Each room type can be in a session once; use quantity for identical rooms.', { param: '$.items' });
    const quoteIds: string[] = [];
    try {
      for (const s of stays) {
        this.actions.reserveQuoteHold(agent, s.rooms);
        const q = await this.catalog.quote(property.id, s.unitId, s.checkin, s.checkout, s.guests, s.breakfast, session.agentClient, { rooms: s.rooms, ratePlanId: s.ratePlanId, hold: true });
        quoteIds.push(q.quoteId);
      }
    } catch (err) {
      for (const q of quoteIds) this.releaseQuote(q);
      if (err instanceof DateRangeError) throw new AcpError(400, 'invalid', err.message, { param: '$.items' });
      if (err instanceof AgentError) {
        if (err.code === 'UNAVAILABLE') throw new AcpError(409, 'out_of_stock', err.message, { param: '$.items' });
        if (err.code === 'LIMIT_REACHED') throw new AcpError(429, 'rate_limit_exceeded', `${err.message} ${err.hint ?? ''}`.trim(), { type: 'service_unavailable' });
        throw new AcpError(400, 'invalid', err.message, { param: '$.items' });
      }
      throw err;
    }
    session.quoteIds = quoteIds;
    const stored = quoteIds.map((q) => this.store.getQuote(q)!);
    session.expiresAt = stored.map((q) => q.hold?.until ?? q.validUntil).sort()[0];
    session.handoffUrl = stored.some((q) => q.bookingMode === 'booking_link') ? this.catalog.prepareBooking(stored[0].id, session.agentClient).url : undefined;
  }

  private releaseQuote(quoteId: string): void {
    const quote = this.store.getQuote(quoteId);
    if (quote?.hold) {
      quote.hold = undefined;
      this.store.saveQuote(quote);
    }
  }

  private release(session: CheckoutSessionRecord): void {
    for (const q of session.quoteIds) this.releaseQuote(q);
  }

  private cancelOpen(session: CheckoutSessionRecord): void {
    this.release(session);
    Object.assign(session, { canceledAt: new Date().toISOString(), buyer: undefined, fulfillment_details: undefined });
    this.store.saveCheckoutSession(session);
  }

  /** What the card is authorised for at completion: the deposit when the host asks one, otherwise the whole stay. */
  private dueNow(property: Property, quotes: Quote[]): number {
    const total = quotes.reduce((n, q) => n + lineItemAmounts(q.lines, (x) => minor(x, property.currency)).total, 0);
    const deposit = rulesOf(property).deposit;
    return deposit && deposit.percent > 0 ? Math.round((total * Math.min(100, deposit.percent)) / 100) : total;
  }

  // ---------------------------------------------------------------- Output

  private request(session: CheckoutSessionRecord): BookingRequest | undefined {
    return session.statusToken ? this.store.getRequestByToken(session.statusToken) : undefined;
  }

  private statusOf(session: CheckoutSessionRecord): 'not_ready_for_payment' | 'ready_for_payment' | 'in_progress' | 'completed' | 'canceled' {
    const request = this.request(session);
    if (request) return request.status === 'accepted' ? 'completed' : request.status === 'new' ? 'in_progress' : 'canceled';
    if (session.canceledAt || session.statusToken || Date.parse(session.expiresAt) < Date.now()) return 'canceled';
    if (session.handoffUrl) return 'not_ready_for_payment';
    const b = session.buyer;
    return b?.first_name && b.last_name && b.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email) ? 'ready_for_payment' : 'not_ready_for_payment';
  }

  private render(session: CheckoutSessionRecord) {
    const property = this.store.getProperty(session.propertyId);
    if (!property) throw new AcpError(404, 'not_found', 'Unknown checkout session.');
    const status = this.statusOf(session);
    const request = this.request(session);
    const members = request ? this.requests.members(property, request) : [];
    const currency = property.currency;
    const m = (n: number) => minor(n, currency);
    const show = (n: number) => money(n / 10 ** digitsOf(currency), 'en', currency);
    const stayPage = `${this.publicUrl}/verblijf/${encodeURIComponent(property.slug)}`;
    const messages: Json[] = [];

    const lineItems = session.items.map((item, i) => {
      const quote = this.store.getQuote(session.quoteIds[i]);
      const member = members.find((r) => r.unitId === quote?.unitId) ?? (members.length === 1 ? members[0] : undefined);
      const lines = member?.terms?.lines ?? quote?.lines ?? [];
      const amounts = lineItemAmounts(lines, m);
      const unit = property.units.find((u) => u.id === quote?.unitId);
      const plan = property.ratePlans?.find((p) => p.id === quote?.ratePlanId);
      const refund = quote ? refundability(property, { checkin: quote.checkin, total: quote.total, ratePlanId: quote.ratePlanId }) : undefined;
      const guests = quote?.guests;
      const disclosures: Json[] = [];
      if (refund?.refundability === 'non_refundable') disclosures.push({ type: 'disclaimer', content_type: 'plain', content: 'Non-refundable: cancelling costs the full amount.' });
      if (quote && !quote.complete) disclosures.push({ type: 'disclaimer', content_type: 'plain', content: 'Not all mandatory costs are known: the host has not stated every fee or tax. The total may be higher.' });
      return {
        id: `li_${i + 1}`,
        item,
        ...amounts,
        name: `${(quote?.rooms ?? 1) > 1 ? `${quote!.rooms} × ` : ''}${unit?.name ?? quote?.unitId ?? item.id} at ${property.name}`,
        description: quote ? `${quote.checkin} to ${quote.checkout}, ${quote.nights} night${quote.nights === 1 ? '' : 's'}` : undefined,
        unit_amount: Math.round(amounts.total / Math.max(1, quote?.rooms ?? 1)),
        disclosures: disclosures.length ? disclosures : undefined,
        // ACP has no fields for a stay; what a buyer must see travels as attributes.
        custom_attributes: quote
          ? [
              { display_name: 'Check-in', value: quote.checkin },
              { display_name: 'Check-out', value: quote.checkout },
              { display_name: 'Guests', value: `${guests!.adults} adult${guests!.adults === 1 ? '' : 's'}${guests!.children ? `, ${guests!.children} child${guests!.children === 1 ? '' : 'ren'}` : ''}${guests!.dogs ? `, ${guests!.dogs} dog${guests!.dogs === 1 ? '' : 's'}` : ''}` },
              { display_name: 'Rate', value: plan?.name ?? 'Standard rate' },
              { display_name: 'Cancellation', value: refund?.refundability === 'unknown' ? String(property.facts['policy.cancellation']?.value ?? 'Not stated by the host') : `${refund!.refundability.replace(/_/g, ' ')}${refund!.freeUntil ? `, free until ${refund!.freeUntil}` : ''}` },
            ]
          : undefined,
      };
    });
    const sum = (k: 'base_amount' | 'discount' | 'subtotal' | 'tax' | 'total') => lineItems.reduce((n, l) => n + l[k], 0);
    const total = sum('total');
    const totals = [
      { type: 'items_base_amount', display_text: 'Stay', amount: sum('base_amount') },
      ...(sum('discount') ? [{ type: 'items_discount', display_text: 'Discount', amount: sum('discount') }] : []),
      { type: 'subtotal', display_text: 'Subtotal', amount: sum('subtotal') },
      ...(sum('tax') ? [{ type: 'tax', display_text: 'Tourist tax', amount: sum('tax') }] : []),
      { type: 'total', display_text: 'Total', amount: total },
    ];

    const deposit = rulesOf(property).deposit;
    const quotes = session.quoteIds.map((q) => this.store.getQuote(q)).filter((q): q is Quote => Boolean(q));
    const due = quotes.length === session.quoteIds.length ? this.dueNow(property, quotes) : total;
    if (!request && status !== 'canceled') {
      messages.push({
        type: 'info',
        content_type: 'plain',
        content: this.handler
          ? `At completion the card is authorised for ${show(due)}${due < total ? ` (the deposit; the rest, ${show(total - due)}, is settled with the property)` : ''}. It is only charged when the host confirms.`
          : deposit && deposit.percent > 0
            ? `Nothing is charged here. After the host confirms, a deposit of ${deposit.percent}% is paid directly to the property; the rest is settled with the property.`
            : 'Nothing is charged here. The whole amount is settled directly with the property.',
      });
      if (quotes.some((q) => q.priceCertainty === 'indicative')) messages.push({ type: 'info', content_type: 'plain', content: "The price comes from the host's rate table and is final once the host confirms." });
    }
    if (status === 'not_ready_for_payment' && session.handoffUrl) messages.push({ type: 'error', code: 'intervention_required', resolution: 'requires_buyer_input', content_type: 'plain', content: `This property takes bookings in its own booking system. Send the buyer to ${session.handoffUrl}` });
    else if (status === 'not_ready_for_payment') messages.push({ type: 'error', code: 'missing', resolution: 'recoverable', param: '$.buyer', content_type: 'plain', content: 'A buyer with first name, last name and e-mail is needed. Only send them once the buyer agreed to share them with this property.' });
    if (status === 'in_progress') messages.push({ type: 'info', content_type: 'plain', content: `The request is with ${property.name} and the rooms are held until ${request!.holdUntil}. It is not a booking until the status is completed${request!.cardPayment ? '; the card is only charged when the host confirms' : ''}.` });
    if (status === 'canceled' && request) messages.push({ type: 'info', content_type: 'plain', content: request.status === 'declined' ? 'The host declined the request. Nothing was booked and nothing was charged.' : request.status === 'expired' ? 'The host did not answer in time. Nothing was booked and nothing was charged.' : 'The booking was cancelled.' });

    const handlers = this.handler ? [this.handler.descriptor()] : [];
    return {
      id: session.id,
      buyer: session.buyer,
      capabilities: { payment: { handlers } },
      payment: { handlers },
      status,
      currency: currency.toLowerCase(),
      line_items: lineItems,
      fulfillment_details: session.fulfillment_details,
      // A stay is not shipped: the confirmation comes by e-mail.
      fulfillment_options: [{ type: 'digital', id: 'confirmation_by_email', title: 'Confirmation by e-mail', description: 'The property confirms by e-mail; check-in details follow before arrival.', totals: [{ type: 'total', display_text: 'Confirmation', amount: 0 }] }],
      selected_fulfillment_options: [{ type: 'digital', option_id: 'confirmation_by_email', item_ids: session.items.map((x) => x.id) }],
      totals,
      messages,
      links: [{ type: 'terms_of_use', url: property.website ?? stayPage }, { type: 'return_policy', url: stayPage }],
      expires_at: status === 'completed' || status === 'canceled' ? undefined : (request?.holdUntil ?? session.expiresAt),
      order: request && status === 'completed' ? { id: request.id, checkout_session_id: session.id, permalink_url: `${this.publicUrl}/aanvraag/${request.publicToken}` } : undefined,
      // What INNLI adds: the signed booking record and, with a payment handler, the state of the card authorisation.
      'io.innli': request ? { status_token: request.publicToken, card_payment: request.cardPayment ? { status: request.cardPayment.status, amount: request.cardPayment.amount } : undefined } : undefined,
    };
  }
}

/** INNLI price lines as the five amounts of an ACP line item: total = subtotal + tax, subtotal = base_amount - discount. */
export function lineItemAmounts(lines: QuoteLine[], m: (n: number) => number) {
  const sum = (test: (l: QuoteLine) => boolean) => lines.filter(test).reduce((n, l) => n + m(l.amount), 0);
  const isDiscount = (l: QuoteLine) => l.kind === 'discount' || l.kind === 'code_discount';
  const base_amount = sum((l) => !isDiscount(l) && l.kind !== 'tax');
  const discount = -sum(isDiscount);
  const tax = sum((l) => l.kind === 'tax');
  return { base_amount, discount, subtotal: base_amount - discount, tax, total: base_amount - discount + tax };
}
