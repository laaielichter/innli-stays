import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { ErrorCode } from '../agentErrors.ts';
import { track } from '../analytics/funnel.ts';
import { CatalogError, stayPolicies, type Catalog } from '../catalog.ts';
import { addDays, stayNights } from '../domain/dates.ts';
import { DEFAULT_BOOKING_RULES, type BookingRequest, type BookingRules, type Language, type Property } from '../domain/types.ts';
import { currentLang, defaultLang, formatDate, LOCALE, money, ownerLang, t, type Lang } from '../i18n/index.ts';
import type { Store } from '../store.ts';
import type { Mailer } from './mailer.ts';
import { pushToOwner } from './push.ts';

export class RequestError extends Error {
  status: number;
  code: ErrorCode;
  constructor(message: string, status = 400, code?: ErrorCode) {
    super(message);
    this.status = status;
    this.code = code ?? (status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : 'INVALID_INPUT');
  }
}

export const requestInputSchema = z.object({
  unitId: z.string().min(1).max(80),
  checkin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkout: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adults: z.coerce.number().int().min(1).max(20),
  children: z.coerce.number().int().min(0).max(20).default(0),
  dogs: z.coerce.number().int().min(0).max(5).default(0),
  breakfast: z.preprocess((v) => v === true || v === 'on' || v === '1' || v === 'true', z.boolean()).default(false),
  name: z.string().trim().min(2, { error: () => t('req.nameRequired') }).max(120),
  email: z.string().trim().email({ error: () => t('req.emailRequired') }).max(200),
  phone: z.string().trim().max(40).optional().transform((v) => v || undefined),
  message: z.string().trim().max(2000).optional().transform((v) => v || undefined),
  ref: z.string().max(100).optional().transform((v) => v || undefined),
  rooms: z.coerce.number().int().min(1).max(50).default(1),
  ratePlanId: z.string().max(40).optional().transform((v) => (v && v !== 'standard' ? v : undefined)),
  /** The quote this request comes from: its short hold is released into the request. */
  quoteId: z.string().max(80).optional(),
  extras: z.array(z.object({ id: z.string().max(40), qty: z.coerce.number().int().min(1).max(50).default(1) })).max(20).optional(),
  discountCode: z.string().trim().max(40).optional().transform((v) => v || undefined),
  /** Agent platform URL for signed status updates (https only). */
  callbackUrl: z.string().url().max(500).refine((u) => u.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u), { error: () => 'callbackUrl must use https' }).optional(),
});

export type RequestInput = z.input<typeof requestInputSchema>;

const longDate = (d: string, lang: Lang) => formatDate(d, lang, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
const guestLang = (r: BookingRequest): Lang => r.language ?? defaultLang();

const TIME_ZONES: Record<string, string> = { PT: 'Europe/Lisbon', IE: 'Europe/Dublin', GB: 'Europe/London', UK: 'Europe/London', GR: 'Europe/Athens', FI: 'Europe/Helsinki', CY: 'Europe/Nicosia' };
/** Local time zone of a stay, for deadlines in e-mails (most of the EU is on Central European Time). */
export const timeZoneOf = (property: Property) => TIME_ZONES[property.address.country?.toUpperCase()] ?? 'Europe/Amsterdam';
const localTime = (iso: string, property: Property, lang: Lang) => new Date(iso).toLocaleString(LOCALE[lang], { dateStyle: 'medium', timeStyle: 'short', timeZone: timeZoneOf(property) });
const today = () => new Date().toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function rulesOf(property: Property): BookingRules {
  return { ...DEFAULT_BOOKING_RULES, ...property.bookingRules };
}

/**
 * Booking requests for stays without a booking system of their own.
 *
 * Lifecycle: new (nights held) → accepted | declined | expired | cancelled.
 * A request is only a booking once accepted — by the owner, or instantly when
 * the owner enabled instant booking and the request meets their rules. The
 * request keeps a record of the price, the conditions and the guest's consent
 * as they were at the time, so there is no argument afterwards about what was agreed.
 */
/** What the guest approved through their agent: see agent/consent.ts. */
export interface ApprovedTerms {
  hash: string;
  summary: string;
}

export type BookingEventType = 'request.created' | 'booking.confirmed' | 'request.declined' | 'request.expired' | 'request.cancelled' | 'booking.cancelled';

export class RequestService {
  private store: Store;
  private catalog: Catalog;
  private mailer: Mailer;
  private publicUrl: string;

  constructor(store: Store, catalog: Catalog, mailer: Mailer, publicUrl: string) {
    this.store = store;
    this.catalog = catalog;
    this.mailer = mailer;
    this.publicUrl = publicUrl.replace(/\/$/, '');
  }

  /** Listeners for booking events (outbound webhooks to a PMS or channel manager). Never break the flow. */
  readonly listeners: ((property: Property, type: BookingEventType, request: BookingRequest) => void)[] = [];
  private emit(property: Property, type: BookingEventType, requests: BookingRequest[]): void {
    for (const r of requests) {
      for (const listener of this.listeners) {
        try {
          listener(property, type, r);
        } catch {
          // A listener problem must never block a booking.
        }
      }
    }
  }

  /** Requests returned for a repeated idempotency key in this call (not newly created). */
  private replays = new Set<string>();
  private isReplay(r: BookingRequest): boolean {
    return this.replays.delete(r.id);
  }

  statusUrl(request: BookingRequest): string {
    return `${this.publicUrl}/aanvraag/${request.publicToken}`;
  }

  /**
   * @param opts.agentClient set when an AI agent submits the request on the guest's behalf
   * @param opts.idempotencyKey a retried call with the same key returns the first request
   */
  async create(property: Property, raw: unknown, opts: { agentClient?: string; idempotencyKey?: string; language?: Language; replaces?: BookingRequest; approved?: ApprovedTerms } = {}): Promise<BookingRequest> {
    const request = await this.createOne(property, raw, opts);
    if (this.isReplay(request)) return request;
    // Changing a request that was not decided yet: the new one simply takes its place.
    if (opts.replaces?.status === 'new') {
      opts.replaces.status = 'cancelled';
      opts.replaces.decidedBy = 'guest';
      opts.replaces.cancelledAt = new Date().toISOString();
      opts.replaces.cancelReason = 'changed';
      opts.replaces.holdUntil = undefined;
      this.store.saveRequest(opts.replaces);
      this.emit(property, 'request.cancelled', [opts.replaces]);
    }
    return (await this.finalizeNew(property, [request]))[0];
  }

  /** Nights a booking being changed occupies, so the change is not blocked by the booking itself. */
  private replacing(r: BookingRequest | undefined) {
    return r && (r.status === 'accepted' || r.status === 'new') ? { requestId: r.id, nights: r.status === 'accepted' ? stayNights(r.checkin, r.checkout) : [] } : undefined;
  }

  /**
   * One stay over several rooms (a group), requested together and decided
   * together: the host confirms all rooms or none.
   */
  async createGroup(property: Property, raws: unknown[], opts: { agentClient?: string; idempotencyKey?: string; language?: Language; approved?: ApprovedTerms } = {}): Promise<BookingRequest[]> {
    if (raws.length < 2 || raws.length > 3) throw new RequestError(t('req.groupSize'));
    if (opts.agentClient && opts.idempotencyKey) {
      const existing = this.store.findRequestByIdempotencyKey(property.id, opts.agentClient, opts.idempotencyKey);
      if (existing) return this.members(property, existing);
    }
    const groupId = `grp_${randomBytes(5).toString('hex')}`;
    const created: BookingRequest[] = [];
    try {
      for (let i = 0; i < raws.length; i++) {
        created.push(await this.createOne(property, raws[i], { ...opts, idempotencyKey: i === 0 ? opts.idempotencyKey : undefined, groupId }));
      }
    } catch (err) {
      // All or nothing: release what was already held.
      for (const r of created) {
        r.status = 'cancelled';
        r.decidedBy = 'system';
        r.holdUntil = undefined;
        this.store.saveRequest(r);
      }
      throw err;
    }
    return this.finalizeNew(property, created);
  }

  private async createOne(property: Property, raw: unknown, opts: { agentClient?: string; idempotencyKey?: string; groupId?: string; language?: Language; replaces?: BookingRequest; approved?: ApprovedTerms }): Promise<BookingRequest> {
    const input = requestInputSchema.parse(raw);
    if (opts.agentClient && opts.idempotencyKey) {
      const existing = this.store.findRequestByIdempotencyKey(property.id, opts.agentClient, opts.idempotencyKey);
      if (existing) {
        this.replays.add(existing.id);
        return existing;
      }
    }
    let offer;
    try {
      offer = await this.catalog.offer(property, input.unitId, input.checkin, input.checkout, input, input.breakfast, { rooms: input.rooms, ratePlanId: input.ratePlanId, extras: input.extras, discountCode: input.discountCode, ignoreQuoteHold: input.quoteId, replacing: this.replacing(opts.replaces) });
    } catch (err) {
      throw new RequestError((err as Error).message, 400, err instanceof CatalogError ? err.code : undefined);
    }
    if (offer.availability.status === 'unavailable') throw new RequestError(t('req.unitUnavailable', { unit: offer.unit.name }), 409, 'UNAVAILABLE');
    if (property.facts['pets.dogsAllowed']?.value === false && offer.guests.dogs > 0) throw new RequestError(t('req.noDogs'));

    const rules = rulesOf(property);
    const link = input.ref ? this.store.getBookingLink(input.ref) : undefined;
    const viaLink = link && link.propertyId === property.id ? link : undefined;
    const now = new Date();
    const agentClient = opts.agentClient ?? viaLink?.agentClient;
    const request: BookingRequest = {
      id: `req_${randomBytes(5).toString('hex')}`,
      publicToken: randomBytes(16).toString('base64url'),
      propertyId: property.id,
      unitId: offer.unit.id,
      checkin: input.checkin,
      checkout: input.checkout,
      guests: offer.guests,
      breakfast: offer.quote.breakfast,
      rooms: input.rooms > 1 ? input.rooms : undefined,
      ratePlanId: offer.quote.ratePlanId,
      extras: offer.quote.extras,
      discountCode: offer.quote.discountCode,
      callbackUrl: input.callbackUrl,
      replacesRequestId: opts.replaces?.id,
      quotedTotal: offer.quote.total,
      quoteComplete: offer.quote.complete,
      guest: { name: input.name, email: input.email, phone: input.phone, message: input.message },
      // Stay page: the page's language. Agent without guestLanguage: the host's language.
      language: opts.language ?? (opts.agentClient ? (property.language ?? defaultLang()) : currentLang()),
      status: 'new',
      ref: viaLink?.token,
      agentClient,
      idempotencyKey: opts.idempotencyKey,
      groupId: opts.groupId,
      holdUntil: new Date(now.getTime() + rules.holdHours * 3_600_000).toISOString(),
      consent: {
        via: opts.agentClient ? 'agent' : 'stay_page',
        agentClient: opts.agentClient,
        statement: opts.agentClient
          ? `Guest agreed to share name and e-mail with ${property.name} and to send this request (confirmed to ${opts.agentClient}).`
          : 'Guest submitted the request form on the stay page.',
        givenAt: now.toISOString(),
        termsHash: opts.approved?.hash,
        summary: opts.approved?.summary,
      },
      terms: { lines: offer.quote.lines, policies: stayPolicies(property, offer.quote.ratePlanId), capturedAt: now.toISOString() },
      createdAt: now.toISOString(),
    };
    this.store.saveRequest(request);
    // The rooms now sit under the request's own hold; the quote's short hold is no longer needed.
    const heldQuote = input.quoteId ? this.store.getQuote(input.quoteId) : undefined;
    if (heldQuote?.hold) {
      heldQuote.hold = undefined;
      this.store.saveQuote(heldQuote);
    }
    track(this.store, 'booking_request', property.id, agentClient ?? 'verblijfspagina', { requestId: request.id, groupId: opts.groupId });
    (request as BookingRequest & { _issues?: string[] })._issues = offer.quote.issues ?? [];
    return request;
  }

  /** Instant booking when every room qualifies; otherwise the host is notified once. */
  private async finalizeNew(property: Property, members: BookingRequest[]): Promise<BookingRequest[]> {
    const issuesOf = (r: BookingRequest) => (r as BookingRequest & { _issues?: string[] })._issues ?? [];
    const eligible = members.every((r) => this.instantEligible(property, r, issuesOf(r)).ok);
    for (const r of members) delete (r as BookingRequest & { _issues?: string[] })._issues;
    if (eligible) {
      try {
        // Re-check against fresh calendars before promising anything.
        await this.accept(property, members[0].id, { decidedBy: 'instant', fresh: true });
        return members;
      } catch {
        // Fall through: the owner decides.
      }
    }
    await this.notifyNew(property, members);
    return members;
  }

  /** All requests of the same group (or just this one), in a stable order. */
  members(property: Property, r: BookingRequest): BookingRequest[] {
    if (!r.groupId) return [r];
    return this.store
      .requestsFor(property.id)
      .filter((x) => x.groupId === r.groupId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  /** Instant booking: only when the owner opted in and the request stays within their rules. */
  instantEligible(property: Property, r: BookingRequest, issues: string[] = []): { ok: boolean; reason?: string } {
    const rules = rulesOf(property);
    if (!rules.instantBooking) return { ok: false, reason: 'not enabled' };
    const kind = property.booking.connector.kind;
    if (kind !== 'manual' && kind !== 'ical') return { ok: false, reason: 'calendar not managed in INNLI' };
    if (!r.quoteComplete) return { ok: false, reason: 'price incomplete' };
    const lead = (Date.parse(r.checkin) - Date.parse(today())) / 86_400_000;
    if (lead < rules.minLeadDays) return { ok: false, reason: 'too short notice' };
    const nights = stayNights(r.checkin, r.checkout).length;
    if (nights > rules.maxNights) return { ok: false, reason: 'too long' };
    if (issues.length) return { ok: false, reason: 'conditions not met' };
    return { ok: true };
  }

  private async notifyNew(property: Property, members: BookingRequest[]): Promise<void> {
    this.emit(property, 'request.created', members);
    const request = members[0];
    const o = ownerLang(property);
    const g = guestLang(request);
    const dashboard = `${this.publicUrl}/dashboard/`;
    await pushToOwner(property, t('push.new.title', {}, o), t('push.new.body', { guest: request.guest.name, checkin: request.checkin, checkout: request.checkout, rooms: members.length > 1 ? t('push.rooms', { n: members.length }, o) : '' }, o));
    if (property.contactEmail) {
      const what = members.length > 1 ? t('owner.nRooms', { n: members.length }, o) : (property.units.find((u) => u.id === request.unitId)?.name ?? t('owner.room', {}, o));
      await this.mailer.send({
        to: property.contactEmail,
        replyTo: request.guest.email,
        subject: t('owner.new.subject', { what, checkin: request.checkin, checkout: request.checkout }, o),
        text: t('owner.new.body', {
          via: request.agentClient ? t('owner.via', { agent: request.agentClient }, o) : '',
          group: members.length > 1 ? t('owner.new.group', {}, o) : '',
          summary: this.summaryAll(property, members, o),
          guest: request.guest.name,
          email: request.guest.email,
          phone: request.guest.phone ? t('owner.phone', { phone: request.guest.phone }, o) : '',
          message: request.guest.message ? t('owner.message', { message: request.guest.message }, o) : '',
          holdUntil: localTime(request.holdUntil!, property, o),
          dashboard,
        }, o),
      });
    }
    await this.mailer.send({
      to: request.guest.email,
      replyTo: property.contactEmail,
      subject: t('mail.received.subject', { property: property.name }, g),
      text: t('mail.received.body', {
        dear: t('mail.dear', { name: request.guest.name }, g),
        property: property.name,
        holdUntil: localTime(request.holdUntil!, property, g),
        rooms: t(members.length > 1 ? 'mail.theRooms' : 'mail.theRoom', {}, g),
        summary: this.summaryAll(property, members, g),
        statusUrl: this.statusUrl(request),
        regards: t('mail.regards', {}, g),
      }, g),
    });
  }

  async accept(property: Property, id: string, opts: { note?: string; force?: boolean; decidedBy?: 'owner' | 'instant'; fresh?: boolean } = {}): Promise<BookingRequest> {
    const first = this.owned(property, id);
    const members = this.members(property, first);
    for (const r of members) if (r.status !== 'new') throw new RequestError(t('req.alreadyStatus', { status: t(`status.${r.status}`) }), 409);

    // Check every room before changing anything: all or nothing.
    for (const request of members) {
      const unit = property.units.find((u) => u.id === request.unitId);
      if (!unit) throw new RequestError(t('req.unitGone'), 409);
      if (opts.force) continue;
      let availability;
      try {
        availability = (await this.catalog.offer(property, unit.id, request.checkin, request.checkout, request.guests, request.breakfast, { ignoreHoldOf: request.id, fresh: opts.fresh, rooms: request.rooms, ratePlanId: request.ratePlanId, extras: request.extras, discountCode: request.discountCode, ignoreCodeUseOf: request.id, replacing: this.replacing(request.replacesRequestId ? this.store.getRequest(request.replacesRequestId) : undefined) })).availability;
      } catch (err) {
        if (!(err instanceof CatalogError)) throw err;
        throw new RequestError(err.message, 409);
      }
      if (availability.status === 'unavailable' || (opts.decidedBy === 'instant' && availability.status !== 'available')) {
        throw new RequestError(t('req.noLongerFree', { unit: unit.name, note: availability.note }), 409);
      }
    }

    const decidedAt = new Date().toISOString();
    // An accepted change replaces the earlier booking: release that one first.
    for (const request of members) {
      const old = request.replacesRequestId ? this.store.getRequest(request.replacesRequestId) : undefined;
      if (!old || (old.status !== 'accepted' && old.status !== 'new')) continue;
      const oldUnit = property.units.find((u) => u.id === old.unitId);
      if (old.status === 'accepted' && oldUnit && (oldUnit.inventory ?? 1) === 1) {
        const nights = new Set(stayNights(old.checkin, old.checkout));
        oldUnit.closedNights = (oldUnit.closedNights ?? []).filter((n) => !nights.has(n));
      }
      const wasBooked = old.status === 'accepted';
      old.status = 'cancelled';
      old.decidedBy = 'guest';
      old.cancelledAt = decidedAt;
      old.cancelReason = 'changed';
      old.holdUntil = undefined;
      this.store.saveRequest(old);
      this.emit(property, wasBooked ? 'booking.cancelled' : 'request.cancelled', [old]);
    }
    for (const request of members) {
      const unit = property.units.find((u) => u.id === request.unitId)!;
      // A single room is closed in the room calendar (and its export feed). A room type with
      // several rooms is not: the accepted request itself counts as one room sold.
      if ((unit.inventory ?? 1) === 1) unit.closedNights = [...new Set([...(unit.closedNights ?? []), ...stayNights(request.checkin, request.checkout)])].sort();
      request.status = 'accepted';
      request.decidedAt = decidedAt;
      request.decidedBy = opts.decidedBy ?? 'owner';
      request.ownerNote = opts.note?.trim() || undefined;
      request.holdUntil = undefined;
      request.payment = this.paymentFor(property, request);
      this.store.saveRequest(request);
      track(this.store, 'booking_confirmed', property.id, request.agentClient ?? 'verblijfspagina', {
        ref: request.ref,
        bookingReference: request.id,
        amount: request.quotedTotal,
        mode: request.decidedBy === 'instant' ? 'instant_booking' : 'availability_request',
        groupId: request.groupId,
      });
    }
    this.store.saveProperty(property);
    this.emit(property, 'booking.confirmed', members);

    const head = members[0];
    const g = guestLang(head);
    const o = ownerLang(property);
    const due = members.reduce((sum, r) => sum + (r.payment?.amountDue ?? 0), 0);
    const pay = head.payment
      ? `${t('mail.deposit', { amount: money(round2(due), g, property.currency), date: longDate(head.payment.dueDate, g) }, g)}${head.payment.paymentUrl ? t('mail.payLink', { url: head.payment.paymentUrl }, g) : ''}${head.payment.instructions ? `\n${head.payment.instructions}` : ''}`
      : '';
    await this.mailer.send({
      to: head.guest.email,
      replyTo: property.contactEmail,
      subject: t('mail.confirmed.subject', { property: property.name }, g),
      text: t('mail.confirmed.body', {
        dear: t('mail.dear', { name: head.guest.name }, g),
        summary: this.summaryAll(property, members, g),
        payment: pay,
        note: head.ownerNote ? t('mail.ownerNote', { property: property.name, note: head.ownerNote }, g) : '',
        cancellation: this.cancellationText(head, g),
        statusUrl: this.statusUrl(head),
        seeYou: t('mail.seeYou', {}, g),
        property: property.name,
      }, g),
    });
    if (head.decidedBy === 'instant') await pushToOwner(property, t('push.instant.title', {}, o), `${head.guest.name}: ${head.checkin} - ${head.checkout}`);
    if (head.decidedBy === 'instant' && property.contactEmail) {
      await this.mailer.send({
        to: property.contactEmail,
        replyTo: head.guest.email,
        subject: t('owner.instant.subject', { what: members.length > 1 ? t('owner.nRooms', { n: members.length }, o) : (property.units.find((u) => u.id === head.unitId)?.name ?? ''), checkin: head.checkin, checkout: head.checkout }, o),
        text: t('owner.instant.body', {
          via: head.agentClient ? t('owner.via', { agent: head.agentClient }, o) : '',
          summary: this.summaryAll(property, members, o),
          guest: head.guest.name,
          email: head.guest.email,
          phone: head.guest.phone ? `, ${head.guest.phone}` : '',
          message: head.guest.message ? t('owner.message', { message: head.guest.message }, o) : '',
        }, o),
      });
    }
    return first;
  }

  private paymentFor(property: Property, r: BookingRequest): BookingRequest['payment'] {
    const deposit = rulesOf(property).deposit;
    if (!deposit || deposit.percent <= 0) return undefined;
    const due = addDays(today(), Math.max(0, deposit.dueDays));
    return {
      status: 'pending',
      amountDue: round2((r.quotedTotal * Math.min(100, deposit.percent)) / 100),
      // Never later than the day before arrival.
      dueDate: due < r.checkin ? due : addDays(r.checkin, -1) < today() ? today() : addDays(r.checkin, -1),
      instructions: deposit.instructions,
      paymentUrl: deposit.paymentUrl,
    };
  }

  private cancellationText(r: BookingRequest, lang: Lang): string {
    const c = (r.terms?.policies as { cancellation?: { value?: unknown } } | undefined)?.cancellation?.value;
    return c ? t('mail.cancellation', { policy: String(c) }, lang) : '';
  }

  async decline(property: Property, id: string, note?: string): Promise<BookingRequest> {
    const first = this.owned(property, id);
    const members = this.members(property, first);
    for (const r of members) if (r.status !== 'new') throw new RequestError(t('req.alreadyStatus', { status: t(`status.${r.status}`) }), 409);
    const decidedAt = new Date().toISOString();
    for (const r of members) {
      r.status = 'declined';
      r.decidedAt = decidedAt;
      r.decidedBy = 'owner';
      r.ownerNote = note?.trim() || undefined;
      r.holdUntil = undefined;
      this.store.saveRequest(r);
    }
    this.emit(property, 'request.declined', members);
    const g = guestLang(first);
    await this.mailer.send({
      to: first.guest.email,
      replyTo: property.contactEmail,
      subject: t('mail.declined.subject', { property: property.name }, g),
      text: t('mail.declined.body', { dear: t('mail.dear', { name: first.guest.name }, g), checkin: longDate(first.checkin, g), checkout: longDate(first.checkout, g), note: first.ownerNote ? `\n\n${first.ownerNote}` : '', regards: t('mail.regards', {}, g), property: property.name }, g),
    });
    return first;
  }

  /**
   * Cancellation by the guest (status page) or by an agent with the guest's
   * consent, identified by the status token only the guest and their agent have.
   * Cancels the whole group. Accepted nights reopen; the owner is told, including
   * the cancellation conditions that applied when the guest asked.
   */
  async cancelByToken(token: string, opts: { reason?: string; by: 'guest' | 'agent'; agentClient?: string }): Promise<BookingRequest> {
    const request = this.store.getRequestByToken(token);
    if (!request) throw new RequestError(t('req.notFound'), 404);
    const property = this.store.getProperty(request.propertyId);
    if (!property) throw new RequestError(t('req.propertyNotFound'), 404);
    if (request.status !== 'new' && request.status !== 'accepted') throw new RequestError(t('req.alreadyStatus', { status: t(`status.${request.status}`) }), 409);
    if (request.status === 'accepted' && request.checkin <= today()) throw new RequestError(t('req.stayStarted'), 409);
    const wasBooked = request.status === 'accepted';
    const members = this.members(property, request).filter((r) => r.status === 'new' || r.status === 'accepted');
    const cancelledAt = new Date().toISOString();
    for (const r of members) {
      if (r.status === 'accepted') {
        const unit = property.units.find((u) => u.id === r.unitId);
        const nights = new Set(stayNights(r.checkin, r.checkout));
        if (unit && (unit.inventory ?? 1) === 1) unit.closedNights = (unit.closedNights ?? []).filter((n) => !nights.has(n));
      }
      r.status = 'cancelled';
      r.cancelledAt = cancelledAt;
      r.cancelReason = opts.reason?.trim().slice(0, 500) || undefined;
      r.decidedBy = 'guest';
      r.holdUntil = undefined;
      this.store.saveRequest(r);
    }
    if (wasBooked) this.store.saveProperty(property);
    this.emit(property, wasBooked ? 'booking.cancelled' : 'request.cancelled', members);
    const o = ownerLang(property);
    const g = guestLang(request);
    if (property.contactEmail) {
      await this.mailer.send({
        to: property.contactEmail,
        replyTo: request.guest.email,
        subject: t('owner.cancelled.subject', { what: t(wasBooked ? 'owner.cancelled.booking' : 'owner.cancelled.request', {}, o), checkin: request.checkin, checkout: request.checkout }, o),
        text: t('owner.cancelled.body', {
          guest: request.guest.name,
          what: t(wasBooked ? 'mail.booking' : 'mail.request', {}, o),
          via: opts.by === 'agent' ? t('owner.via', { agent: opts.agentClient }, o) : '',
          reason: request.cancelReason ? t('owner.cancelled.reason', { reason: request.cancelReason }, o) : '',
          summary: this.summaryAll(property, members, o),
          reopened: wasBooked ? t('owner.cancelled.reopened', { cancellation: this.cancellationText(request, o) }, o) : '',
        }, o),
      });
    }
    await this.mailer.send({
      to: request.guest.email,
      replyTo: property.contactEmail,
      subject: t('mail.cancelled.subject', { property: property.name }, g),
      text: t('mail.cancelled.body', { dear: t('mail.dear', { name: request.guest.name }, g), what: t(wasBooked ? 'mail.booking' : 'mail.request', {}, g), checkin: longDate(request.checkin, g), checkout: longDate(request.checkout, g), cancellation: wasBooked ? this.cancellationText(request, g) : '', regards: t('mail.regards', {}, g), property: property.name }, g),
    });
    return request;
  }

  markPaid(property: Property, id: string): BookingRequest {
    const request = this.owned(property, id);
    if (!request.payment) throw new RequestError(t('req.noDeposit'));
    request.payment.status = 'paid';
    request.payment.paidAt = new Date().toISOString();
    this.store.saveRequest(request);
    return request;
  }

  /**
   * Housekeeping, run periodically: expire unanswered requests (releasing their
   * hold), remind owners of open requests, and send guests a pre-arrival message.
   */
  async maintain(now = new Date()): Promise<{ expired: number; ownerReminders: number; preArrival: number }> {
    const result = { expired: 0, ownerReminders: 0, preArrival: 0 };
    const iso = now.toISOString();
    const day = iso.slice(0, 10);
    const mailedGroups = new Set<string>();
    for (const r of this.store.allRequests()) {
      const property = this.store.getProperty(r.propertyId);
      if (!property) continue;
      if (r.status === 'new' && r.holdUntil && r.holdUntil <= iso) {
        r.status = 'expired';
        r.decidedBy = 'system';
        r.decidedAt = iso;
        r.holdUntil = undefined;
        this.store.saveRequest(r);
        this.emit(property, 'request.expired', [r]);
        result.expired++;
        if (r.groupId) {
          if (mailedGroups.has(r.groupId)) continue;
          mailedGroups.add(r.groupId);
        }
        const g = guestLang(r);
        await this.mailer.send({
          to: r.guest.email,
          replyTo: property.contactEmail,
          subject: t('mail.expired.subject', { property: property.name }, g),
          text: t('mail.expired.body', { dear: t('mail.dear', { name: r.guest.name }, g), property: property.name, checkin: longDate(r.checkin, g), checkout: longDate(r.checkout, g), regards: t('mail.regards', {}, g) }, g),
        });
        continue;
      }
      if (r.status === 'new' && !r.ownerRemindedAt && now.getTime() - Date.parse(r.createdAt) > 12 * 3_600_000 && property.contactEmail && !(r.groupId && mailedGroups.has(`remind:${r.groupId}`))) {
        if (r.groupId) mailedGroups.add(`remind:${r.groupId}`);
        r.ownerRemindedAt = iso;
        this.store.saveRequest(r);
        result.ownerReminders++;
        const o = ownerLang(property);
        await this.mailer.send({
          to: property.contactEmail,
          subject: t('owner.reminder.subject', { guest: r.guest.name }, o),
          text: t('owner.reminder.body', { checkin: r.checkin, checkout: r.checkout, holdUntil: localTime(r.holdUntil!, property, o), dashboard: `${this.publicUrl}/dashboard/` }, o),
        });
      }
      if (r.status === 'accepted' && !r.preArrivalSentAt && r.checkin >= day && r.checkin <= addDays(day, 3) && r.guest.email) {
        r.preArrivalSentAt = iso;
        this.store.saveRequest(r);
        result.preArrival++;
        const policies = stayPolicies(property) as Record<string, { value?: unknown } | unknown>;
        const v = (k: string) => (policies[k] as { value?: unknown } | undefined)?.value;
        const g = guestLang(r);
        const when = [v('checkInFrom') && t('mail.from', { time: String(v('checkInFrom')) }, g), v('checkInUntil') && t('mail.until', { time: String(v('checkInUntil')) }, g)].filter(Boolean).join(' ');
        const details = [
          when ? t('mail.checkinLine', { when }, g) : '',
          v('checkOutUntil') ? t('mail.checkoutLine', { time: String(v('checkOutUntil')) }, g) : '',
          property.address.street ? t('mail.addressLine', { address: `${property.address.street}, ${property.address.postalCode ?? ''} ${property.address.city}` }, g) : '',
        ].join('');
        const unpaid = r.payment?.status === 'pending' ? t('mail.unpaid', { amount: money(r.payment.amountDue, g, property.currency), pay: r.payment.paymentUrl ? t('mail.payInline', { url: r.payment.paymentUrl }, g) : '' }, g) : '';
        await this.mailer.send({
          to: r.guest.email,
          replyTo: property.contactEmail,
          subject: t('mail.preArrival.subject', { property: property.name }, g),
          text: t('mail.preArrival.body', { dear: t('mail.dear', { name: r.guest.name }, g), property: property.name, summary: this.summary(property, r, g), details, unpaid, statusUrl: this.statusUrl(r), seeYou: t('mail.seeYou', {}, g) }, g),
        });
      }
    }
    return result;
  }

  /**
   * Double-booking guard: confirmed INNLI bookings whose nights are now also
   * booked in a connected channel (Airbnb, Booking.com…). Live systems are
   * excluded: they hold the booking themselves.
   */
  async conflicts(property: Property): Promise<{ requestId: string; guest: string; unit: string; nights: string[] }[]> {
    if (property.booking.connector.kind !== 'ical') return [];
    const out = [];
    for (const r of this.store.requestsFor(property.id)) {
      if (r.status !== 'accepted' || r.checkout <= today()) continue;
      const unit = property.units.find((u) => u.id === r.unitId);
      if (!unit) continue;
      const nights = stayNights(r.checkin, r.checkout);
      const overview = await this.catalog.roomCalendar(property, unit, nights);
      const clash = overview.nights.filter((n) => n.state === 'booked_elsewhere').map((n) => n.date);
      if (clash.length) out.push({ requestId: r.id, guest: r.guest.name, unit: unit.name, nights: clash });
    }
    return out;
  }

  /** E-mails the owner once per confirmed booking that now clashes with another channel. */
  async notifyConflicts(): Promise<number> {
    let sent = 0;
    for (const property of this.store.listProperties()) {
      const clashes = await this.conflicts(property);
      for (const c of clashes) {
        const r = this.store.getRequest(c.requestId)!;
        if (r.conflictNotifiedAt) continue;
        r.conflictNotifiedAt = new Date().toISOString();
        this.store.saveRequest(r);
        sent++;
        const o = ownerLang(property);
        await pushToOwner(property, t('push.conflict.title', {}, o), t('push.conflict.body', { unit: c.unit, nights: c.nights.join(', ') }, o));
        if (property.contactEmail) {
          await this.mailer.send({
            to: property.contactEmail,
            subject: t('owner.conflict.subject', { unit: c.unit }, o),
            text: t('owner.conflict.body', { guest: c.guest, checkin: r.checkin, checkout: r.checkout, unit: c.unit, nights: c.nights.join(', '), verb: t(c.nights.length === 1 ? 'owner.conflict.is' : 'owner.conflict.are', {}, o), dashboard: `${this.publicUrl}/dashboard/` }, o),
          });
        }
      }
    }
    return sent;
  }

  /** Reliability signals agents can show: how quickly and how often this host confirms. */
  hostStats(propertyId: string, now = new Date()) {
    const since = new Date(now.getTime() - 180 * 86_400_000).toISOString();
    const decided = this.store.requestsFor(propertyId).filter((r) => r.createdAt >= since && (r.status === 'accepted' || r.status === 'declined' || r.status === 'expired'));
    const owner = decided.filter((r) => r.decidedBy === 'owner' && r.decidedAt);
    const hours = owner.map((r) => (Date.parse(r.decidedAt!) - Date.parse(r.createdAt)) / 3_600_000).sort((a, b) => a - b);
    const median = hours.length ? Math.round(hours[Math.floor(hours.length / 2)] * 10) / 10 : null;
    const accepted = decided.filter((r) => r.status === 'accepted').length;
    return {
      requestsLast180Days: decided.length,
      medianResponseHours: median,
      confirmationRate: decided.length >= 3 ? Math.round((accepted / decided.length) * 100) / 100 : null,
    };
  }

  /** Summary of one request, or of a whole group with a line per room and the combined total. */
  summaryAll(property: Property, members: BookingRequest[], lang: Lang = currentLang()): string {
    if (members.length <= 1) return this.summary(property, members[0], lang);
    const r = members[0];
    const rooms = members.map((m) => `- ${property.units.find((u) => u.id === m.unitId)?.name ?? m.unitId} (${party(m, lang)}): ${money(m.quotedTotal, lang, property.currency)}`);
    const total = round2(members.reduce((sum, m) => sum + m.quotedTotal, 0));
    return [
      t('sum.rooms', { property: property.name, n: members.length }, lang),
      t('sum.arrival', { date: longDate(r.checkin, lang) }, lang),
      t('sum.departure', { date: longDate(r.checkout, lang) }, lang),
      ...rooms,
      t('sum.total', { amount: money(total, lang, property.currency) }, lang) + (members.every((m) => m.quoteComplete) ? '' : t('sum.incomplete', {}, lang)),
    ].join('\n');
  }

  summary(property: Property, r: BookingRequest, lang: Lang = currentLang()): string {
    const unit = property.units.find((u) => u.id === r.unitId);
    return [
      `${property.name} – ${(r.rooms ?? 1) > 1 ? `${r.rooms} × ` : ''}${unit?.name ?? r.unitId}`,
      t('sum.arrival', { date: longDate(r.checkin, lang) }, lang),
      t('sum.departure', { date: longDate(r.checkout, lang) }, lang),
      t('sum.guests', { party: party(r, lang) }, lang) + (r.breakfast ? t('sum.withBreakfast', {}, lang) : ''),
      t('sum.total', { amount: money(r.quotedTotal, lang, property.currency) }, lang) + (r.quoteComplete ? '' : t('sum.incomplete', {}, lang)),
    ].join('\n');
  }

  private owned(property: Property, id: string): BookingRequest {
    const r = this.store.getRequest(id);
    if (!r || r.propertyId !== property.id) throw new RequestError(t('req.notFound'), 404);
    return r;
  }
}

function party(r: BookingRequest, lang: Lang): string {
  return [t('party.adults', { n: r.guests.adults }, lang), r.guests.children ? t('party.children', { n: r.guests.children }, lang) : '', r.guests.dogs ? t('price.dogs', { n: r.guests.dogs }, lang) : ''].filter(Boolean).join(', ');
}

/** Status in the given language, for pages and messages. */
export const statusText = (status: BookingRequest['status'], lang: Lang = currentLang()) => t(`status.${status}`, {}, lang);

export const STATUS_NL: Record<BookingRequest['status'], string> = {
  new: 'in behandeling',
  accepted: 'bevestigd',
  declined: 'afgewezen',
  expired: 'verlopen',
  cancelled: 'geannuleerd',
};
