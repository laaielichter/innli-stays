import { randomBytes } from 'node:crypto';
import { AgentError } from '../agentErrors.ts';
import { consentFor } from '../agent/consent.ts';
import type { Catalog } from '../catalog.ts';
import { cancellationCost, cancellationSchedule, refundability } from '../domain/cancellation.ts';
import { DateRangeError } from '../domain/dates.ts';
import type { BookingRequest, Property, Quote, QuoteLine } from '../domain/types.ts';
import { money } from '../i18n/index.ts';
import type { AgentActions, AgentContext } from '../requests/agentActions.ts';
import { rulesOf, type RequestService } from '../requests/service.ts';
import type { Store } from '../store.ts';
import type { BookingSessionRecord, UcpPerson, UcpStayInput } from './types.ts';

/**
 * UCP lodging booking (capability `dev.ucp.lodging.booking`, draft): the
 * booking-session protocol agent platforms use to reserve a stay. This is a
 * thin adapter: a session is one or more INNLI quotes with a short hold, and
 * completing it sends the same booking request `request_booking` sends, with
 * the same consent hash, hold limits and signed record behind it.
 *
 * The property stays merchant of record and INNLI moves no money: payment
 * terms say what is paid to the property and when, and there are no payment
 * handlers, so platforms complete with `payment: {}`.
 */

export const UCP_VERSION = process.env.INNLI_UCP_VERSION || '2026-08-25';
export const UCP_BASE_PATH = '/ucp/v1';
const BOOKING = 'dev.ucp.lodging.booking';
const TERMS = 'dev.ucp.common.payment.terms';
const CANCELLATION = 'dev.ucp.lodging.policy.cancellation';
const SPEC = 'https://ucp.dev';

type Json = Record<string, unknown>;
type Severity = 'recoverable' | 'requires_buyer_input' | 'requires_buyer_review' | 'unrecoverable';
interface Message {
  type: 'error' | 'warning' | 'info';
  code: string;
  content: string;
  severity?: Severity;
  path?: string;
  presentation?: 'notice' | 'disclosure';
}

/** A business outcome that is not a session: returned with HTTP 200 and `ucp.status: "error"`. */
export class UcpOutcome extends Error {
  code: string;
  severity: Severity;
  constructor(code: string, content: string, severity: Severity = 'unrecoverable') {
    super(content);
    this.code = code;
    this.severity = severity;
  }
}

/** A protocol error: an HTTP status with `{ code, content }`. */
export class UcpProtocolError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, content: string) {
    super(content);
    this.status = status;
    this.code = code;
  }
}

const digitsOf = (currency: string) => new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
/** Amounts travel as integers in the currency's minor unit (cents; whole units for e.g. ISK). */
export const minor = (amount: number, currency: string) => Math.round(amount * 10 ** digitsOf(currency));

const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function person(raw: unknown): UcpPerson | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Json;
  return { id: str(r.id, 80), first_name: str(r.first_name, 80), last_name: str(r.last_name, 80), email: str(r.email, 200), phone_number: str(r.phone_number, 40) };
}

const isLead = (p?: UcpPerson) => Boolean(p?.first_name && p.last_name && p.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email));

/** What the profile at /.well-known/ucp says this installation speaks. */
export function ucpProfile(store: Store, publicUrl: string, keys: unknown[]) {
  const url = publicUrl.replace(/\/$/, '');
  return {
    ucp: {
      version: UCP_VERSION,
      services: {
        'dev.ucp.lodging': [{ version: UCP_VERSION, spec: `${SPEC}/${UCP_VERSION}/specification/overview`, transport: 'rest', schema: `${SPEC}/${UCP_VERSION}/services/lodging/rest.openapi.json`, endpoint: `${url}${UCP_BASE_PATH}` }],
      },
      capabilities: {
        [BOOKING]: [{ version: UCP_VERSION, spec: `${SPEC}/${UCP_VERSION}/specification/lodging/booking`, schema: `${SPEC}/${UCP_VERSION}/schemas/lodging/booking.json` }],
        [CANCELLATION]: [{ version: UCP_VERSION, extends: [BOOKING], spec: `${SPEC}/${UCP_VERSION}/specification/lodging/extensions/cancellation-policy`, schema: `${SPEC}/${UCP_VERSION}/schemas/lodging/policy_cancellation.json` }],
        [TERMS]: [{ version: UCP_VERSION }],
      },
      // The guest pays the property directly (deposit instructions, payment link, or at the property).
      payment_handlers: {},
    },
    signing_keys: keys,
    properties: store
      .listProperties()
      .filter((p) => p.published)
      .slice(0, 500)
      .map((p) => ({ id: p.id, name: p.name, accommodation_types: p.units.map((u) => ({ id: u.id, title: u.name })), rate_plans: [{ id: 'standard', title: 'Standard rate' }, ...(p.ratePlans ?? []).map((r) => ({ id: r.id, title: r.name }))] })),
    'io.innli': { note: 'Lodging booking is a draft capability. Search, facts and quotes: the MCP endpoint.', mcp: `${url}/mcp`, agent_card: `${url}/.well-known/agent-card.json` },
  };
}

export class UcpLodging {
  private store: Store;
  private catalog: Catalog;
  private actions: AgentActions;
  private requests: RequestService;
  private publicUrl: string;

  constructor(store: Store, catalog: Catalog, actions: AgentActions, requests: RequestService, publicUrl: string) {
    this.store = store;
    this.catalog = catalog;
    this.actions = actions;
    this.requests = requests;
    this.publicUrl = publicUrl.replace(/\/$/, '');
  }

  // ---------------------------------------------------------------- Operations

  async create(body: unknown, agent: AgentContext, platformProfile: string) {
    const input = this.parse(body);
    const property = this.property(input.propertyId);
    const session: BookingSessionRecord = {
      id: `bks_${randomBytes(12).toString('base64url')}`,
      propertyId: property.id,
      checkin: input.checkin,
      checkout: input.checkout,
      stays: input.stays,
      quotes: [],
      guests: input.guests,
      booker: input.booker,
      travel_purpose: input.travel_purpose,
      platformProfile,
      agentClient: agent.name,
      createdAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
    };
    await this.price(property, session, agent);
    this.store.saveBookingSession(session);
    return this.render(session);
  }

  get(id: string) {
    return this.render(this.session(id));
  }

  async update(id: string, body: unknown, agent: AgentContext) {
    const session = this.session(id);
    if (session.statusToken) return this.render(session, [{ type: 'error', code: 'session_not_editable', severity: 'recoverable', content: 'This session was already completed; it can no longer be changed. Cancel it, or start a new session.' }]);
    if (this.statusOf(session) === 'canceled') return this.render(session);
    const input = this.parse(body);
    if (input.propertyId !== session.propertyId) throw new UcpOutcome('property_mismatch', 'A session belongs to one property; start a new session for another property.', 'recoverable');
    const property = this.property(session.propertyId);
    const same = input.checkin === session.checkin && input.checkout === session.checkout && JSON.stringify(input.stays.map(stayKey)) === JSON.stringify(session.stays.map(stayKey));
    // Full replacement: what the platform left out is gone.
    Object.assign(session, { stays: same ? input.stays.map((s, i) => ({ ...s, id: session.stays[i].id })) : input.stays, guests: input.guests, booker: input.booker, travel_purpose: input.travel_purpose, agentClient: agent.name });
    if (!same || Date.parse(session.expiresAt) < Date.now()) {
      this.release(session);
      Object.assign(session, { checkin: input.checkin, checkout: input.checkout });
      await this.price(property, session, agent);
    }
    this.store.saveBookingSession(session);
    return this.render(session);
  }

  async complete(id: string, body: unknown, agent: AgentContext) {
    const session = this.session(id);
    // A repeated Complete is answered with the state the first one produced.
    if (session.statusToken) return this.render(session);
    const status = this.statusOf(session);
    if (status === 'canceled') return this.render(session);
    const payment = (body as Json | undefined)?.payment;
    if (!payment || typeof payment !== 'object') return this.render(session, [{ type: 'error', code: 'payment_required', severity: 'recoverable', path: '$.payment', content: 'Complete needs a payment object. Nothing is charged here: send an empty object (payment: {}) to confirm the payment terms.' }]);
    if (Array.isArray((payment as Json).instruments) && ((payment as Json).instruments as unknown[]).length) {
      return this.render(session, [{ type: 'error', code: 'payment_instrument_not_supported', severity: 'recoverable', path: '$.payment.instruments', content: 'This property takes no card details through the platform. The guest pays the property directly, as the payment terms say. Complete with payment: {}.' }]);
    }
    if (status !== 'ready_for_complete') return this.render(session);
    const property = this.property(session.propertyId);
    const lead = this.lead(session)!;
    const quoteIds = session.quotes.map((q) => q.quoteId);
    const quotes = quoteIds.map((q) => this.store.getQuote(q)!);
    try {
      const result = (await this.actions.requestBooking(
        {
          ...(quoteIds.length === 1 ? { quoteId: quoteIds[0] } : { quoteIds }),
          guest: { name: `${lead.first_name} ${lead.last_name}`, email: lead.email!, phone: lead.phone_number },
          message: session.travel_purpose ? `Travel purpose: ${session.travel_purpose}` : undefined,
          // Complete is the platform's statement that the buyer reviewed and confirmed these exact terms.
          guestConsent: true,
          consentHash: consentFor(property, quotes).hash,
          idempotencyKey: session.id,
        },
        agent,
      )) as { statusToken: string };
      session.statusToken = result.statusToken;
      this.store.saveBookingSession(session);
      return this.render(session);
    } catch (err) {
      if (!(err instanceof AgentError)) throw err;
      if (err.code === 'TERMS_CHANGED' || err.code === 'QUOTE_EXPIRED') {
        this.release(session);
        await this.price(property, session);
        this.store.saveBookingSession(session);
        return this.render(session);
      }
      if (err.code === 'UNAVAILABLE') {
        this.cancelOpen(session, 'inventory_exhausted');
        return this.render(session, [{ type: 'error', code: 'inventory_exhausted', severity: 'unrecoverable', content: err.message }]);
      }
      if (err.code === 'AGENT_IDENTITY_REQUIRED' || err.code === 'LIMIT_REACHED' || err.code === 'FORBIDDEN') {
        session.handoffUrl = this.stayPage(property);
        this.store.saveBookingSession(session);
        return this.render(session, [{ type: 'error', code: err.code.toLowerCase(), severity: 'requires_buyer_input', content: `${err.message} ${err.hint ?? ''}`.trim() }]);
      }
      if (err.code === 'RATE_LIMITED') throw new UcpProtocolError(429, 'rate_limited', err.message);
      return this.render(session, [{ type: 'error', code: err.code.toLowerCase(), severity: 'recoverable', content: err.message }]);
    }
  }

  async cancel(id: string, body: unknown, agent: AgentContext) {
    const session = this.session(id);
    const reason = str((body as Json | undefined)?.reason, 500);
    if (!session.statusToken) {
      this.cancelOpen(session, reason ?? 'canceled_by_platform');
      return this.render(session);
    }
    const request = this.store.getRequestByToken(session.statusToken);
    if (!request || (request.status !== 'new' && request.status !== 'accepted')) return this.render(session);
    try {
      const result = (await this.actions.cancelRequest({ statusToken: session.statusToken, reason, guestConsent: true }, agent)) as { tellTheGuest?: string };
      return this.render(session, result.tellTheGuest ? [{ type: 'info', code: 'cancellation_result', content: result.tellTheGuest }] : []);
    } catch (err) {
      if (!(err instanceof AgentError)) throw err;
      if (err.code === 'RATE_LIMITED') throw new UcpProtocolError(429, 'rate_limited', err.message);
      return this.render(session, [{ type: 'error', code: err.code.toLowerCase(), severity: 'recoverable', content: err.message }]);
    }
  }

  // ---------------------------------------------------------------- Input

  private parse(body: unknown) {
    const b = (body ?? {}) as Json;
    const propertyId = str((b.property as Json | undefined)?.id, 120);
    if (!propertyId) throw new UcpOutcome('invalid_request', 'property.id is required.', 'recoverable');
    const rawStays = Array.isArray(b.stays) ? (b.stays as Json[]) : [];
    if (!rawStays.length || rawStays.length > 10) throw new UcpOutcome('invalid_request', 'stays must hold 1 to 10 entries.', 'recoverable');
    const guests = Array.isArray(b.guests) ? (b.guests as unknown[]).slice(0, 40).map(person).filter((g): g is UcpPerson => Boolean(g)) : undefined;
    let checkin: string | undefined;
    let checkout: string | undefined;
    const stays: UcpStayInput[] = rawStays.map((s, i) => {
      const dates = (s.stay_dates ?? {}) as Json;
      const start = str(dates.start_date, 10);
      const end = str(dates.end_date, 10);
      if (!start || !end || !DATE.test(start) || !DATE.test(end)) throw new UcpOutcome('invalid_request', `stays[${i}].stay_dates needs start_date and end_date as YYYY-MM-DD.`, 'recoverable');
      checkin ??= start;
      checkout ??= end;
      if (start !== checkin || end !== checkout) throw new UcpOutcome('stay_dates_differ', 'All stays of one booking session must have the same dates. Open a second session for other dates.', 'recoverable');
      const unitId = str((s.accommodation_type as Json | undefined)?.id, 120);
      if (!unitId) throw new UcpOutcome('invalid_request', `stays[${i}].accommodation_type.id is required.`, 'recoverable');
      const occ = (s.occupancy && typeof s.occupancy === 'object' ? s.occupancy : {}) as Json;
      const count = (v: unknown) => (Array.isArray(v) ? v.length : Math.max(0, Math.floor(Number(v) || 0)));
      const children = count(occ.children);
      const adults = occ.adults === undefined ? Math.max(1, count(occ.total) - children) : count(occ.adults);
      if (adults < 1) throw new UcpOutcome('invalid_request', `stays[${i}].occupancy needs at least one adult.`, 'recoverable');
      const assignments = Array.isArray(s.guest_assignments) ? (s.guest_assignments as Json[]).slice(0, 20).map((a) => ({ guest_id: String(a.guest_id ?? ''), role: str(a.role, 40) })) : undefined;
      for (const a of assignments ?? []) {
        if (!guests?.some((g) => g.id === a.guest_id)) throw new UcpOutcome('invalid_request', `stays[${i}].guest_assignments refers to guest "${a.guest_id}", which is not in guests[].`, 'recoverable');
      }
      const ratePlanId = str((s.rate_plan as Json | undefined)?.id, 120) ?? 'standard';
      return { id: str(s.id, 120) ?? `stay_${unitId}__${ratePlanId}${i ? `_${i + 1}` : ''}`, unitId, ratePlanId, occupancy: { adults, children, dogs: count(occ.pets ?? occ['io.innli.dogs']) }, occupancyEcho: occ, guest_assignments: assignments };
    });
    if (new Set(stays.map((s) => s.id)).size !== stays.length) throw new UcpOutcome('invalid_request', 'Every stay needs its own id.', 'recoverable');
    return { propertyId, stays, checkin: checkin!, checkout: checkout!, guests, booker: person(b.booker) as BookingSessionRecord['booker'], travel_purpose: str(b.travel_purpose, 40) };
  }

  private property(id: string): Property {
    const property = this.store.getProperty(id);
    if (!property || !property.published) throw new UcpOutcome('property_not_found', 'This property is not offered here.');
    return property;
  }

  private session(id: string): BookingSessionRecord {
    const session = this.store.getBookingSession(id);
    if (!session) throw new UcpProtocolError(404, 'not_found', 'Unknown booking session.');
    return session;
  }

  // ---------------------------------------------------------------- Pricing and holds

  /** Quotes every room type once (identical rooms together) and holds the rooms while the buyer decides. */
  private async price(property: Property, session: BookingSessionRecord, agent?: AgentContext): Promise<void> {
    const groups = new Map<string, UcpStayInput[]>();
    for (const s of session.stays) groups.set(stayGroup(s), [...(groups.get(stayGroup(s)) ?? []), s]);
    if (groups.size > 3) throw new UcpOutcome('too_many_room_types', 'At most three different room types per booking session.', 'recoverable');
    if (new Set(session.stays.map((s) => s.unitId)).size !== groups.size) throw new UcpOutcome('rate_plans_differ', 'Rooms of the same type in one session must share a rate plan.', 'recoverable');
    const quotes: BookingSessionRecord['quotes'] = [];
    try {
      for (const members of groups.values()) {
        const first = members[0];
        if (first.ratePlanId !== 'standard' && !property.ratePlans?.some((r) => r.id === first.ratePlanId)) throw new UcpOutcome('rate_plan_not_found', `Unknown rate plan "${first.ratePlanId}".`, 'recoverable');
        const unit = property.units.find((u) => u.id === first.unitId);
        const over = unit && members.find((s) => s.occupancy.adults + s.occupancy.children > unit.maxGuests);
        if (over) throw new UcpOutcome('occupancy_exceeded_capacity', `${unit.name} sleeps at most ${unit.maxGuests}; stay "${over.id}" has ${over.occupancy.adults + over.occupancy.children} guests. Add a room or choose a larger one.`, 'recoverable');
        const party = members.reduce((g, s) => ({ adults: g.adults + s.occupancy.adults, children: g.children + s.occupancy.children, dogs: g.dogs + s.occupancy.dogs }), { adults: 0, children: 0, dogs: 0 });
        // A session holds rooms without any guest details: counted per caller, like any short hold.
        if (agent) this.actions.reserveQuoteHold(agent);
        const q = await this.catalog.quote(property.id, first.unitId, session.checkin, session.checkout, party, false, session.agentClient, { rooms: members.length, ratePlanId: first.ratePlanId === 'standard' ? undefined : first.ratePlanId, hold: true });
        quotes.push({ quoteId: q.quoteId, stayIds: members.map((m) => m.id) });
      }
    } catch (err) {
      for (const q of quotes) this.releaseQuote(q.quoteId);
      if (err instanceof UcpOutcome) throw err;
      if (err instanceof DateRangeError) throw new UcpOutcome('invalid_stay_dates', err.message, 'recoverable');
      if (err instanceof AgentError) {
        if (err.code === 'UNAVAILABLE') throw new UcpOutcome('inventory_exhausted', err.message);
        if (err.code === 'LIMIT_REACHED') throw new UcpProtocolError(429, 'hold_limit_reached', `${err.message} ${err.hint ?? ''}`.trim());
        if (err.code === 'NOT_FOUND') throw new UcpOutcome('accommodation_type_not_found', err.message, 'recoverable');
        throw new UcpOutcome(/guest|gast|person/i.test(err.message) ? 'occupancy_exceeded_capacity' : 'invalid_request', err.message, 'recoverable');
      }
      throw err;
    }
    session.quotes = quotes;
    const stored = quotes.map((q) => this.store.getQuote(q.quoteId)!);
    session.expiresAt = stored.map((q) => q.hold?.until ?? q.validUntil).sort()[0];
    // A property that sells in its own booking system finishes there: the platform hands the buyer over.
    session.handoffUrl = stored.some((q) => q.bookingMode === 'booking_link') ? this.catalog.prepareBooking(stored[0].id, session.agentClient).url : undefined;
  }

  private releaseQuote(quoteId: string): void {
    const quote = this.store.getQuote(quoteId);
    if (quote?.hold) {
      quote.hold = undefined;
      this.store.saveQuote(quote);
    }
  }

  private release(session: BookingSessionRecord): void {
    for (const q of session.quotes) this.releaseQuote(q.quoteId);
  }

  private cancelOpen(session: BookingSessionRecord, reason: string): void {
    this.release(session);
    Object.assign(session, { canceledAt: new Date().toISOString(), cancelReason: reason, guests: undefined, booker: undefined });
    this.store.saveBookingSession(session);
  }

  // ---------------------------------------------------------------- Output

  private lead(session: BookingSessionRecord): UcpPerson | undefined {
    if (isLead(session.booker)) return session.booker;
    const primary = session.stays.flatMap((s) => s.guest_assignments ?? []).find((a) => a.role === 'primary');
    const guest = primary ? session.guests?.find((g) => g.id === primary.guest_id) : undefined;
    if (isLead(guest)) return guest;
    // A named primary guest with a booker who only gives the contact channel.
    if (guest?.first_name && guest.last_name && session.booker?.email) return { ...guest, email: session.booker.email, phone_number: guest.phone_number ?? session.booker.phone_number };
    return undefined;
  }

  private request(session: BookingSessionRecord): BookingRequest | undefined {
    return session.statusToken ? this.store.getRequestByToken(session.statusToken) : undefined;
  }

  private statusOf(session: BookingSessionRecord): 'incomplete' | 'requires_escalation' | 'ready_for_complete' | 'complete_in_progress' | 'completed' | 'canceled' {
    const request = this.request(session);
    if (request) return request.status === 'accepted' ? 'completed' : request.status === 'new' ? 'complete_in_progress' : 'canceled';
    if (session.canceledAt || session.statusToken || Date.parse(session.expiresAt) < Date.now()) return 'canceled';
    if (session.handoffUrl) return 'requires_escalation';
    return this.lead(session) ? 'ready_for_complete' : 'incomplete';
  }

  private stayPage(property: Property): string {
    return `${this.publicUrl}/verblijf/${encodeURIComponent(property.slug)}`;
  }

  private render(session: BookingSessionRecord, extra: Message[] = []) {
    const property = this.store.getProperty(session.propertyId);
    if (!property) throw new UcpProtocolError(404, 'not_found', 'Unknown booking session.');
    const status = this.statusOf(session);
    const request = this.request(session);
    const members = request ? this.requests.members(property, request) : [];
    const currency = property.currency;
    const m = (n: number) => minor(n, currency);
    const messages: Message[] = [...extra];

    // Price lines: from the booking record once there is one, else from the live quotes.
    const quotes = session.quotes.map((q) => ({ ...q, quote: this.store.getQuote(q.quoteId) }));
    const linesOf = (q: (typeof quotes)[number]): { lines: QuoteLine[]; quote?: Quote } => {
      const member = members.find((r) => r.unitId === q.quote?.unitId) ?? (members.length === 1 ? members[0] : undefined);
      return { lines: member?.terms?.lines ?? q.quote?.lines ?? [], quote: q.quote };
    };
    const allLines = quotes.flatMap((q) => linesOf(q).lines);
    const totals = totalsOf(allLines, m);
    const total = totals.at(-1)!.amount;

    const stays = session.stays.map((s) => {
      const group = quotes.find((q) => q.stayIds.includes(s.id));
      const unit = property.units.find((u) => u.id === s.unitId);
      const plan = property.ratePlans?.find((p) => p.id === s.ratePlanId);
      const share = group ? group.stayIds.length : 1;
      const first = group?.stayIds[0] === s.id;
      // Identical rooms are priced together; each gets its share, the first one any rounding remainder.
      const groupTotals = group ? totalsOf(linesOf(group).lines, m) : [];
      const split = groupTotals.map((t) => ({ ...t, amount: Math.floor(t.amount / share) + (first ? t.amount % share : 0) }));
      return {
        id: s.id,
        accommodation_type: { id: s.unitId, title: unit?.name, capacity: unit ? { total: unit.maxGuests } : undefined },
        rate_plan: { id: s.ratePlanId, title: plan?.name ?? 'Standard rate', description: plan ? (plan.refundable ? plan.cancellation : 'Non-refundable') : undefined },
        occupancy: Object.keys(s.occupancyEcho).length ? s.occupancyEcho : { adults: s.occupancy.adults, children: s.occupancy.children || undefined, total: s.occupancy.adults + s.occupancy.children },
        stay_dates: { start_date: session.checkin, end_date: session.checkout },
        guest_assignments: s.guest_assignments,
        totals: split,
      };
    });

    // Cancellation: one machine-readable word plus the full terms in words.
    const amount = allLines.reduce((sum, l) => sum + l.amount, 0);
    const ratePlanId = session.stays[0].ratePlanId === 'standard' ? undefined : session.stays[0].ratePlanId;
    const stay = { checkin: session.checkin, total: amount, ratePlanId };
    const refund = refundability(property, stay);
    const policyText = (request?.terms?.policies as { cancellation?: { value?: unknown } } | undefined)?.cancellation?.value ?? property.ratePlans?.find((p) => p.id === ratePlanId)?.cancellation ?? property.facts['policy.cancellation']?.value;
    const schedule = cancellationSchedule(property, stay)
      .map((r) => (r.from === 'booking' ? 'Non-refundable: cancelling costs the full amount.' : `From ${r.from}: ${r.percent}% (${money(r.amount, 'en', currency)}).`))
      .join(' ');
    const policies =
      refund.refundability === 'unknown'
        ? []
        : [{ type: CANCELLATION, refundability: refund.refundability, description: [refund.freeUntil ? `Free cancellation until ${refund.freeUntil}.` : '', schedule, typeof policyText === 'string' ? policyText : ''].filter(Boolean).join(' '), url: this.stayPage(property) }];
    if (refund.refundability === 'unknown') {
      messages.push({ type: 'warning', code: 'cancellation_terms_not_structured', presentation: 'disclosure', path: '$.policies', content: typeof policyText === 'string' ? `Cancellation conditions as the host states them: ${policyText}` : 'The host has not stated cancellation conditions. Ask before booking.' });
    } else if (refund.refundability === 'non_refundable') {
      messages.push({ type: 'warning', code: CANCELLATION, presentation: 'disclosure', path: '$.policies[0]', content: 'This booking is non-refundable: cancelling costs the full amount.' });
    }

    // Payment timing: what is paid to the property, and when. INNLI moves no money.
    const deposit = rulesOf(property).deposit;
    const depositMinor = deposit && deposit.percent > 0 ? Math.round((total * Math.min(100, deposit.percent)) / 100) : 0;
    const term = depositMinor
      ? {
          id: 'pt_deposit',
          title: 'Deposit, balance at the property',
          description: { plain: `A deposit of ${deposit!.percent}% is paid directly to the property within ${deposit!.dueDays} days after it confirms; the rest is settled with the property.` },
          schedules: [
            { id: 'sched_deposit', type: 'deferred', amount: depositMinor, description: { plain: `Deposit, due within ${deposit!.dueDays} days after confirmation. Payment details are in the confirmation e-mail from the property.` } },
            ...(total - depositMinor > 0 ? [{ id: 'sched_property', type: 'at_property', amount: total - depositMinor, description: { plain: 'Balance, settled directly with the property.' } }] : []),
          ],
        }
      : { id: 'pt_property', title: 'Pay the property', description: { plain: 'Nothing is charged now. The whole amount is settled directly with the property.' }, schedules: [{ id: 'sched_property', type: 'at_property', amount: total, description: { plain: 'Settled directly with the property.' } }] };

    if (quotes.some((q) => q.quote && !q.quote.complete)) messages.push({ type: 'warning', code: 'total_incomplete', presentation: 'disclosure', path: '$.totals', content: 'Not all mandatory costs are known: the host has not stated every fee or tax. The total may be higher.' });
    if (!request && quotes.some((q) => q.quote?.priceCertainty === 'indicative')) messages.push({ type: 'info', code: 'price_indicative', content: 'The price comes from the host\'s rate table and is final once the host confirms.' });
    // Conditions the stay breaks (minimum nights, arrival day, dogs): the host decides, and the buyer should know.
    if (!request) for (const w of new Set(quotes.flatMap((q) => q.quote?.warnings ?? []))) messages.push({ type: 'warning', code: 'stay_condition', presentation: 'notice', content: w });
    if (session.lastTotal !== undefined && session.lastTotal !== total && !request) messages.push({ type: 'warning', code: 'totals_changed', presentation: 'disclosure', path: '$.totals', content: `The total changed from ${money(session.lastTotal / 10 ** digitsOf(currency), 'en', currency)} to ${money(total / 10 ** digitsOf(currency), 'en', currency)}.` });
    if (session.lastTotal !== total && !request && status !== 'canceled') {
      session.lastTotal = total;
      this.store.saveBookingSession(session);
    }

    if (status === 'incomplete') messages.push({ type: 'error', code: 'lead_guest_required', severity: 'recoverable', path: '$.booker', content: 'A lead guest is needed: a booker (or a guest assigned as primary) with first name, last name and e-mail. Only send them once the buyer agreed to share them with this property.' });
    if (status === 'requires_escalation' && !messages.some((x) => x.severity?.startsWith('requires_'))) messages.push({ type: 'error', code: 'completed_at_property', severity: 'requires_buyer_input', content: 'This property takes bookings in its own booking system. Hand the buyer over through continue_url; dates and guests are pre-filled where supported.' });
    if (status === 'complete_in_progress') messages.push({ type: 'info', code: 'awaiting_host_confirmation', content: `The request is with ${property.name} and the rooms are held until ${request!.holdUntil}. It is not a booking until the status is completed; the buyer pays nothing if the host does not confirm.` });
    if (status === 'canceled' && request) {
      const fee = request.status === 'cancelled' && request.decidedAt ? cancellationCost(property, stay, request.cancelledAt?.slice(0, 10)) : undefined;
      const why: Record<string, string> = { declined: 'The host declined the request. Nothing was booked.', expired: 'The host did not answer in time. Nothing was booked.', cancelled: `The booking was cancelled.${fee?.amount ? ` Cancellation costs under the agreed conditions: ${money(fee.amount, 'en', currency)}.` : ''}` };
      messages.push({ type: 'info', code: `request_${request.status}`, content: why[request.status] ?? 'This session is no longer valid.' });
    } else if (status === 'canceled' && !session.canceledAt) messages.push({ type: 'info', code: 'session_expired', content: 'The session expired and the rooms were released. Start a new booking session.' });

    const terminal = status === 'completed' || status === 'canceled';
    return {
      ucp: { version: UCP_VERSION, status: 'success', capabilities: { [BOOKING]: [{ version: UCP_VERSION }], [CANCELLATION]: [{ version: UCP_VERSION }], [TERMS]: [{ version: UCP_VERSION }] }, payment_handlers: {} },
      id: session.id,
      status,
      property: { id: property.id, name: property.name, address: { street_address: property.address.street, address_locality: property.address.city, address_region: property.address.region, address_country: property.address.country, postal_code: property.address.postalCode } },
      stays,
      guests: session.guests,
      booker: session.booker,
      travel_purpose: session.travel_purpose,
      currency,
      totals,
      policies,
      payment: { selected_term_id: term.id, terms: [term] },
      messages: messages.length ? messages : undefined,
      links: [{ type: 'cancellation_policy', url: this.stayPage(property) }, ...(property.website ? [{ type: 'terms_of_service', url: property.website }] : [])],
      continue_url: terminal ? undefined : (session.handoffUrl ?? (request ? `${this.publicUrl}/aanvraag/${request.publicToken}` : this.stayPage(property))),
      expires_at: terminal ? undefined : (request?.holdUntil ?? session.expiresAt),
      confirmation: status === 'completed' && request ? { id: request.id, label: request.id.replace(/^req_/, '').toUpperCase() } : undefined,
      // What INNLI adds: the signed booking record lives behind this token (check_status), for disputes.
      'io.innli': request ? { status_token: request.publicToken, record: `${this.publicUrl}/api/agent/v1/tools/check_status` } : undefined,
    };
  }
}

const stayKey = (s: UcpStayInput) => [s.unitId, s.ratePlanId, s.occupancy.adults, s.occupancy.children, s.occupancy.dogs];
const stayGroup = (s: UcpStayInput) => `${s.unitId}|${s.ratePlanId}`;

/** INNLI price lines as UCP totals: addends that sum exactly to the one `total`. */
export function totalsOf(lines: QuoteLine[], m: (n: number) => number): { type: string; amount: number; display_text?: string }[] {
  const sum = (kinds: QuoteLine['kind'][]) => lines.filter((l) => kinds.includes(l.kind)).reduce((n, l) => n + m(l.amount), 0);
  const out: { type: string; amount: number; display_text?: string }[] = [];
  out.push({ type: 'subtotal', amount: sum(['accommodation', 'rate_plan', 'extra_guest', 'supplement', 'breakfast', 'pet', 'extra']) });
  const discount = sum(['discount', 'code_discount']);
  if (discount) out.push({ type: 'discount', amount: discount });
  for (const l of lines.filter((x) => x.kind === 'fee' && x.amount)) out.push({ type: 'fee', display_text: l.label, amount: m(l.amount) });
  for (const l of lines.filter((x) => x.kind === 'tax' && x.amount)) out.push({ type: 'tax', display_text: l.label, amount: m(l.amount) });
  out.push({ type: 'total', amount: out.reduce((n, t) => n + t.amount, 0) });
  return out;
}
