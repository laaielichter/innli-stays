import { createHash } from 'node:crypto';
import { z } from 'zod';
import { track } from '../analytics/funnel.ts';
import { CatalogError, type Catalog } from '../catalog.ts';
import { addDays, stayNights } from '../domain/dates.ts';
import type { BookingRequest, Language, Property, Quote } from '../domain/types.ts';
import { consentFor } from '../agent/consent.ts';
import { scanText } from '../agent/hostText.ts';
import { money } from '../i18n/index.ts';
import { rateLimiter } from '../http/safeFetch.ts';
import type { Store } from '../store.ts';
import { signRecord } from '../security/signing.ts';
import { cancellationCost } from '../domain/cancellation.ts';
import { isCamperRental, rentalBlockers } from '../domain/rental.ts';
import type { QuestionService } from './questions.ts';
import type { WaitlistService } from './waitlist.ts';
import { RequestError, rulesOf, type RequestService } from './service.ts';

export interface AgentContext {
  name: string;
  /** Whether this agent may act for guests (requests, questions, cancellations). */
  canAct: boolean;
  /** How the caller proved who it is: an agent key, a signed request (Web Bot Auth), or not at all. */
  identity?: 'key' | 'verified' | 'anonymous';
  /** Domain whose published key signed the request. */
  verifiedDomain?: string;
  /** What rate limits and hold limits count against: the key, the verified domain, or the address. */
  bucket?: string;
}
export type AgentCaller = AgentContext;

/** Open (unanswered) requests one holder may have per property. */
/** Short quote holds (15 minutes) one caller may have at the same time. */
export const MAX_QUOTE_HOLDS = { anonymous: 3, identified: 60 };
// Counted per room: three rooms held in one quote are three holds.
const QUOTE_HOLD_MS = 15 * 60_000;

export const MAX_OPEN_HOLDS = { anonymous: 2, identified: 25, perGuest: 3 };

/** A stable, non-reversible id for whoever holds the nights; an address is never stored as such. */
export function holderId(agent: AgentContext): string {
  return `h_${createHash('sha256').update(agent.bucket ?? `name:${agent.name}`).digest('hex').slice(0, 16)}`;
}

/**
 * Actions an AI agent can take on a guest's behalf. Each one needs the guest's
 * explicit consent, is rate limited, and is written to the property's audit
 * log, so owner, guest and agent can always reconstruct who did what.
 */
export class AgentActions {
  private store: Store;
  private requests: RequestService;
  private questions: QuestionService;
  private catalog: Catalog;
  private publicUrl: string;
  private limit = rateLimiter(10);
  private quoteHolds = new Map<string, number[]>();

  constructor(store: Store, requests: RequestService, questions: QuestionService, catalog: Catalog, publicUrl: string) {
    this.store = store;
    this.requests = requests;
    this.questions = questions;
    this.catalog = catalog;
    this.publicUrl = publicUrl.replace(/\/$/, '');
  }

  /**
   * @param property when known: the host may only take actions from agents that proved who they are.
   */
  private guard(agent: AgentContext, kind: string, property?: Property): void {
    if (!agent.canAct) throw new CatalogError('This agent key is read-only: it may search and quote, but not act for guests.', { code: 'FORBIDDEN' });
    if (property && rulesOf(property).requireIdentifiedAgent && (agent.identity ?? 'anonymous') === 'anonymous') {
      throw new CatalogError(`${property.name} only takes requests from agents that prove who they are.`, { code: 'AGENT_IDENTITY_REQUIRED' });
    }
    // Anonymous agents are counted per address, not together: one noisy caller must not block the rest.
    if (!this.limit(`${agent.bucket ?? agent.name}:${kind}`)) throw new CatalogError('Too many requests from this agent; try again in a minute.', { code: 'RATE_LIMITED' });
  }

  /**
   * Speculative holds are the cheapest way to hurt a small property: a script
   * that "requests" every room keeps real guests out for days. So open
   * requests are limited per holder and per guest address; an agent that
   * proved who it is gets room to work for many guests at once.
   */
  private holdGuard(property: Property, agent: AgentContext, email: string, rooms: number, replacing?: BookingRequest): string {
    const holder = holderId(agent);
    // A change and the request it replaces count as one.
    const open = this.store.requestsFor(property.id).filter((r) => r.id !== replacing?.id && r.status === 'new' && (!r.holdUntil || Date.parse(r.holdUntil) > Date.now()));
    const identified = (agent.identity ?? 'anonymous') !== 'anonymous';
    const max = identified ? MAX_OPEN_HOLDS.identified : MAX_OPEN_HOLDS.anonymous;
    const groups = (list: BookingRequest[]) => new Set(list.map((r) => r.groupId ?? r.id)).size;
    if (groups(open.filter((r) => r.holder === holder)) + 1 > max) {
      throw new CatalogError(`This agent already has ${max} open request${max === 1 ? '' : 's'} holding rooms at ${property.name}. Wait for the host's answer or withdraw one first.${identified ? '' : ' Agents that prove who they are (Web Bot Auth or OAuth) may hold more.'}`, { code: 'LIMIT_REACHED' });
    }
    const mail = email.trim().toLowerCase();
    if (groups(open.filter((r) => r.guest.email?.toLowerCase() === mail)) + 1 > MAX_OPEN_HOLDS.perGuest) {
      throw new CatalogError(`This guest already has ${MAX_OPEN_HOLDS.perGuest} open requests at ${property.name}. Wait for the host's answer or withdraw one first.`, { code: 'LIMIT_REACHED' });
    }
    // An anonymous caller may not tie up most of a small property on its own.
    if (!identified) {
      const totalRooms = property.units.reduce((n, u) => n + Math.max(1, u.inventory ?? 1), 0);
      const held = open.filter((r) => r.holder === holder).reduce((n, r) => n + (r.rooms ?? 1), 0);
      if (totalRooms > 2 && held + rooms > Math.max(2, Math.ceil(totalRooms / 2))) {
        throw new CatalogError(`An anonymous agent cannot hold more than half of the rooms at ${property.name} at once. Agents that prove who they are (Web Bot Auth or OAuth) may.`, { code: 'LIMIT_REACHED' });
      }
    }
    return holder;
  }

  /**
   * Short holds (get_quote with hold, a UCP booking session) keep rooms off the
   * market for a quarter of an hour without any guest details. They are counted
   * per caller too: a few at a time for an anonymous address, many for an
   * identified agent.
   */
  reserveQuoteHold(agent: AgentContext, holds = 1): void {
    const holder = holderId(agent);
    const now = Date.now();
    const active = (this.quoteHolds.get(holder) ?? []).filter((until) => until > now);
    const max = (agent.identity ?? 'anonymous') === 'anonymous' ? MAX_QUOTE_HOLDS.anonymous : MAX_QUOTE_HOLDS.identified;
    if (active.length + holds > max) {
      throw new CatalogError(`This agent already holds ${active.length} room selection${active.length === 1 ? '' : 's'} for guests who are still deciding (at most ${max} at once). Finish or let one expire first.`, { code: 'LIMIT_REACHED', retryable: true, retryAfterSeconds: Math.max(1, Math.ceil((Math.min(...active, now + QUOTE_HOLD_MS) - now) / 1000)), nextTools: ['request_booking'], hint: 'Quote without hold: true, or wait until an earlier hold expires. Agents that prove who they are (Web Bot Auth or OAuth) may hold more.' });
    }
    for (let i = 0; i < holds; i++) active.push(now + QUOTE_HOLD_MS);
    this.quoteHolds.set(holder, active);
    if (this.quoteHolds.size > 20_000) for (const [k, v] of this.quoteHolds) if (v.every((until) => until <= now)) this.quoteHolds.delete(k);
  }

  private audit(property: Property, agent: AgentContext, action: string, meta: Record<string, unknown>): void {
    track(this.store, 'agent_action', property.id, agent.name, { action, ...meta });
  }

  async requestBooking(
    args: { quoteId?: string; quoteIds?: string[]; guest: { name: string; email: string; phone?: string }; message?: string; guestConsent: boolean; consentHash?: string; idempotencyKey?: string; guestLanguage?: Language; callbackUrl?: string },
    agent: AgentContext,
  ) {
    if (args.guestConsent !== true) {
      throw new CatalogError('Ask the guest first: they must agree that their name and e-mail are shared with this host (set guestConsent: true).', { code: 'CONSENT_REQUIRED' });
    }
    const ids = args.quoteIds?.length ? args.quoteIds : args.quoteId ? [args.quoteId] : [];
    if (!ids.length) throw new CatalogError('Pass quoteId, or quoteIds for a group over several rooms.');
    if (ids.length > 3) throw new CatalogError('At most three rooms per group request.');
    const quotes = ids.map((id) => this.store.getQuote(id));
    if (quotes.some((q) => !q)) throw new CatalogError('Quote not found. Get a quote first with get_quote or search_stays.', { code: 'QUOTE_NOT_FOUND' });
    const first = quotes[0]!;
    if (quotes.some((q) => q!.propertyId !== first.propertyId || q!.checkin !== first.checkin || q!.checkout !== first.checkout)) {
      throw new CatalogError('All rooms of a group must be in the same property and for the same dates.');
    }
    if (new Set(quotes.map((q) => q!.unitId)).size !== quotes.length) throw new CatalogError('Each room can only be requested once in a group.');
    const property = this.store.getProperty(first.propertyId);
    if (!property || !property.published) throw new CatalogError('Accommodation not found.', { code: 'NOT_FOUND' });
    this.guard(agent, 'request', property);
    if (quotes.some((q) => q!.bookingMode === 'booking_link')) {
      throw new CatalogError('This property takes bookings in its own booking system: use prepare_booking and give the guest the link.', { code: 'INVALID_INPUT', nextTools: ['prepare_booking'] });
    }
    if (isCamperRental(property)) {
      // A rental company cannot hand over keys to a driver it may not insure: settle that before the request, not at the counter.
      for (const q of quotes as Quote[]) {
        const unit = property.units.find((u) => u.id === q.unitId);
        if (!unit) continue;
        const blocker = rentalBlockers(property, unit, q);
        if (blocker) throw new CatalogError(blocker.message, { code: blocker.code });
        if (!q.driver) throw new CatalogError("A camper rental needs the main driver's age and driving licence. Ask the guest, then get a fresh quote with driver.", { code: 'INVALID_INPUT', nextTools: ['get_quote'] });
      }
    }
    if (quotes.some((q) => Date.parse(q!.validUntil) < Date.now())) throw new CatalogError('Quote expired. Get a fresh quote first, so the guest agrees to the current price.', { code: 'QUOTE_EXPIRED' });
    // The guest approved specific terms; if the host changed any of them since, ask again instead of sending.
    const approved = consentFor(property, quotes as Quote[]);
    if (args.consentHash && args.consentHash !== approved.hash) {
      throw new CatalogError(`The terms changed since the guest approved them. Current terms: ${approved.summary}`, { code: 'TERMS_CHANGED' });
    }
    // The same for the price: the request is priced afresh, and must cost what the guest was shown.
    for (const q of quotes as Quote[]) {
      const now = await this.catalog
        .offer(property, q.unitId, q.checkin, q.checkout, q.guests, q.breakfast, { rooms: q.rooms, ratePlanId: q.ratePlanId, extras: q.extras, discountCode: q.discountCode, ignoreQuoteHold: q.id })
        .catch(() => null);
      if (now && now.availability.status !== 'unavailable' && Math.abs(now.quote.total - q.total) > 0.005) {
        throw new CatalogError(`The price changed since the quote: now ${money(now.quote.total, 'en', property.currency)} instead of ${money(q.total, 'en', property.currency)}. Get a fresh quote and show the guest the new price.`, { code: 'TERMS_CHANGED' });
      }
    }
    const raw = (q: NonNullable<(typeof quotes)[number]>) => ({
      unitId: q.unitId,
      checkin: q.checkin,
      checkout: q.checkout,
      adults: q.guests.adults,
      children: q.guests.children,
      dogs: q.guests.dogs,
      breakfast: q.breakfast,
      rooms: q.rooms ?? 1,
      ratePlanId: q.ratePlanId,
      extras: q.extras,
      discountCode: q.discountCode,
      callbackUrl: args.callbackUrl,
      quoteId: q.id,
      name: args.guest.name,
      email: args.guest.email,
      phone: args.guest.phone,
      message: args.message,
    });
    // A retried call is the same request, not another hold.
    // Keys are scoped to the caller: anonymous agents share a name, and one must never get another's request back.
    const idempotencyKey = args.idempotencyKey ? `${holderId(agent)}:${args.idempotencyKey}`.slice(0, 120) : undefined;
    const replay = idempotencyKey ? this.store.findRequestByIdempotencyKey(property.id, agent.name, idempotencyKey) : undefined;
    const holder = replay ? undefined : this.holdGuard(property, agent, args.guest.email, (quotes as Quote[]).reduce((n, q) => n + (q.rooms ?? 1), 0));
    let members: BookingRequest[];
    try {
      members = quotes.length === 1
        ? [await this.requests.create(property, raw(first), { agentClient: agent.name, idempotencyKey, language: args.guestLanguage, approved: args.consentHash ? approved : undefined })]
        : await this.requests.createGroup(property, quotes.map((q) => raw(q!)), { agentClient: agent.name, idempotencyKey, language: args.guestLanguage, approved: args.consentHash ? approved : undefined });
    } catch (err) {
      if (err instanceof RequestError) throw new CatalogError(err.message, { code: err.code });
      if (err instanceof z.ZodError) throw new CatalogError('Invalid guest details: provide a full name and a valid e-mail address.');
      throw err;
    }
    if (holder) {
      // Who held the nights, and how the agent proved itself, belong in the record a dispute is settled with.
      for (const m of this.requests.members(property, members[0])) {
        m.holder = holder;
        if (m.consent) Object.assign(m.consent, { agentIdentity: agent.identity ?? 'anonymous', agentDomain: agent.verifiedDomain });
        this.store.saveRequest(m);
      }
    }
    if (isCamperRental(property) && !replay) {
      // The company needs to know who drives; it is removed with the guest's other personal data.
      for (const m of this.requests.members(property, members[0])) {
        const q = (quotes as Quote[]).find((x) => x.unitId === m.unitId);
        if (q?.driver) this.store.saveRequest(Object.assign(m, { driver: q.driver, destinations: q.destinations }));
      }
    }
    const request = this.requests.members(property, members[0])[0];
    this.audit(property, agent, 'request_booking', { identity: agent.identity ?? 'anonymous', verifiedDomain: agent.verifiedDomain, requestId: request.id, groupId: request.groupId, rooms: ids.length, result: request.status, idempotencyKey: args.idempotencyKey });
    const booked = request.status === 'accepted';
    const view = await this.view(property, request);
    return {
      ...view,
      tellTheGuest: booked
        ? `Your stay at ${property.name} is confirmed (instant booking).${view.payment ? ` A deposit of ${money(view.payment.amountDue, 'en', property.currency)} is due by ${view.payment.dueDate}; details are in the confirmation e-mail.` : ''}`
        : `Your request has been sent to ${property.name}. This is not yet a booking: ${ids.length > 1 ? 'the rooms are' : 'the room is'} held for you until ${request.holdUntil?.slice(0, 16).replace('T', ' ')} UTC and the host will confirm by e-mail. If the host does not answer in time, the request expires and you pay nothing.`,
    };
  }

  async cancelRequest(args: { statusToken: string; reason?: string; guestConsent: boolean }, agent: AgentContext) {
    if (args.guestConsent !== true) throw new CatalogError('Only cancel when the guest explicitly asked for it (set guestConsent: true).', { code: 'CONSENT_REQUIRED' });
    this.guard(agent, 'cancel');
    const before = this.store.getRequestByToken(args.statusToken);
    if (!before) throw new CatalogError('Unknown status token.', { code: 'NOT_FOUND' });
    const property = this.store.getProperty(before.propertyId)!;
    const wasBooked = before.status === 'accepted';
    const members = this.requests.members(property, before);
    const fee = wasBooked ? cancellationCost(property, { checkin: before.checkin, total: members.reduce((s, m) => s + m.quotedTotal, 0), ratePlanId: before.ratePlanId }) : undefined;
    try {
      const r = await this.requests.cancelByToken(args.statusToken, { reason: args.reason, by: 'agent', agentClient: agent.name });
      this.audit(property, agent, 'cancel_request', { requestId: r.id, groupId: r.groupId, wasBooked });
      const c = (r.terms?.policies as { cancellation?: { value?: unknown } } | undefined)?.cancellation?.value;
      const feeText = fee?.amount != null ? (fee.amount > 0 ? ` Under the conditions agreed at booking the cancellation costs ${money(fee.amount, 'en', property.currency)} (${fee.percent}%).` : ' Under the conditions agreed at booking the cancellation is free of charge.') : '';
      return {
        ...(await this.view(property, r)),
        cancellationCost: fee,
        tellTheGuest: wasBooked
          ? `Your booking at ${property.name} is cancelled.${feeText || (c ? ` Cancellation conditions agreed at booking: ${String(c)}` : '')} Any cancellation fee is settled with the host.`
          : `Your request to ${property.name} is withdrawn. Nothing was booked and nothing is due.`,
      };
    } catch (err) {
      if (err instanceof RequestError) throw new CatalogError(err.message, { code: err.code });
      throw err;
    }
  }

  joinWaitlist(
    args: { propertyId: string; unitId?: string; checkin: string; checkout: string; guests?: { adults?: number; children?: number; dogs?: number }; email: string; guestConsent: boolean; guestLanguage?: Language },
    agent: AgentContext,
    waitlist: WaitlistService,
  ) {
    if (args.guestConsent !== true) throw new CatalogError('Only add the guest when they agreed to be e-mailed about this stay (guestConsent: true).', { code: 'CONSENT_REQUIRED' });
    const property = this.store.getProperty(args.propertyId);
    if (!property || !property.published) throw new CatalogError('Accommodation not found.', { code: 'NOT_FOUND' });
    this.guard(agent, 'waitlist', property);
    const entry = waitlist.join(property, { ...args, guests: args.guests ?? {}, language: args.guestLanguage }, agent.name);
    this.audit(property, agent, 'join_waitlist', { waitlistId: entry.id });
    return {
      status: 'waiting',
      statusToken: entry.publicToken,
      tellTheGuest: `You are on the waitlist for ${property.name} (${entry.checkin} – ${entry.checkout}). You will get an e-mail as soon as a room frees up; then whoever requests first gets it.`,
    };
  }

  async askHost(args: { propertyId: string; question: string; factKey?: string; unitId?: string; replyEmail?: string; guestConsent?: boolean; guestLanguage?: Language }, agent: AgentContext) {
    const property = this.store.getProperty(args.propertyId);
    if (!property || !property.published) throw new CatalogError('Accommodation not found.', { code: 'NOT_FOUND' });
    if (args.replyEmail && args.guestConsent !== true) throw new CatalogError('Only pass replyEmail when the guest agreed to share it with the host (guestConsent: true).', { code: 'CONSENT_REQUIRED' });
    this.guard(agent, 'question', property);
    try {
      const q = await this.questions.ask(property, { ...args, language: args.guestLanguage }, agent.name);
      this.audit(property, agent, 'ask_host', { questionId: q.id, factKey: q.factKey, answeredBy: q.answeredBy });
      if (q.answeredBy === 'assistant') {
        return {
          status: 'answered',
          answeredBy: 'assistant',
          questionId: q.id,
          statusToken: q.publicToken,
          answer: q.answer,
          tellTheGuest: `${property.name} already answered this in its own confirmed details:\n${q.answer}`,
          next: 'Answered from the host-confirmed passport, so the host was not bothered. If the guest still wants the host personally, ask a more specific question.',
        };
      }
      return {
        status: 'sent',
        questionId: q.id,
        statusToken: q.publicToken,
        tellTheGuest: `The question was sent to ${property.name}.${q.replyEmail ? ' The answer will be e-mailed to the guest.' : ''} Check back later with check_status.`,
      };
    } catch (err) {
      if (err instanceof RequestError) throw new CatalogError(err.message, { code: err.code });
      throw err;
    }
  }

  /**
   * The answer agent: answers a guest's question from the host-confirmed passport
   * and published FAQ, instantly and without contacting the host. Read-only.
   */
  answerQuestion(args: { propertyId: string; question: string; unitId?: string; language?: Language }, agent: AgentContext) {
    const property = this.store.getProperty(args.propertyId);
    if (!property || !property.published) throw new CatalogError('Accommodation not found.', { code: 'NOT_FOUND' });
    if (args.unitId && !property.units.some((u) => u.id === args.unitId)) throw new CatalogError('Unknown unitId for this property.', { code: 'NOT_FOUND' });
    if (!this.limit(`${agent.name}:answer`)) throw new CatalogError('Too many requests from this agent; try again in a minute.', { code: 'RATE_LIMITED' });
    const result = this.questions.answers.answer(property, args.question, { unitId: args.unitId, lang: args.language ?? 'en' });
    this.audit(property, agent, 'answer_question', { answered: result.answered, confidence: result.confidence, topics: result.topics });
    return { propertyId: property.id, property: property.name, question: args.question, ...result, answer: scanText(result.answer).text };
  }

  /**
   * Changes a request or booking (dates, room, party, rooms, rate plan). A pending
   * request is replaced right away; a confirmed booking stays valid until the host
   * (or instant booking) confirms the change, so the guest never ends up with nothing.
   */
  async modifyRequest(
    args: {
      statusToken: string;
      checkin?: string;
      checkout?: string;
      unitId?: string;
      guests?: { adults?: number; children?: number; dogs?: number };
      breakfast?: boolean;
      rooms?: number;
      ratePlanId?: string;
      extras?: { id: string; qty?: number }[];
      discountCode?: string;
      message?: string;
      guestConsent: boolean;
    },
    agent: AgentContext,
  ) {
    if (args.guestConsent !== true) throw new CatalogError('Only change a booking when the guest explicitly asked for it (set guestConsent: true).', { code: 'CONSENT_REQUIRED' });
    const old = this.store.getRequestByToken(args.statusToken);
    if (!old) throw new CatalogError('Unknown status token.', { code: 'NOT_FOUND' });
    const property = this.store.getProperty(old.propertyId);
    if (!property) throw new CatalogError('Accommodation not found.', { code: 'NOT_FOUND' });
    this.guard(agent, 'modify', property);
    if (old.groupId) throw new CatalogError('Group requests cannot be changed in one step: cancel_request and send a new group request.');
    if (old.status !== 'new' && old.status !== 'accepted') throw new CatalogError(`This request is ${old.status}; send a new request instead.`, { code: 'CONFLICT' });
    if (old.status === 'accepted' && old.checkin <= new Date().toISOString().slice(0, 10)) throw new CatalogError('The stay has already started; contact the host directly.', { code: 'CONFLICT' });
    const pending = this.store.requestsFor(property.id).find((r) => r.replacesRequestId === old.id && r.status === 'new');
    if (pending) throw new CatalogError('A change for this booking is already waiting for the host; check_status on its statusToken first.', { code: 'CONFLICT' });
    const raw = {
      unitId: args.unitId ?? old.unitId,
      checkin: args.checkin ?? old.checkin,
      checkout: args.checkout ?? old.checkout,
      adults: args.guests?.adults ?? old.guests.adults,
      children: args.guests?.children ?? old.guests.children,
      dogs: args.guests?.dogs ?? old.guests.dogs,
      breakfast: args.breakfast ?? old.breakfast,
      rooms: args.rooms ?? old.rooms ?? 1,
      ratePlanId: args.ratePlanId ?? old.ratePlanId,
      extras: args.extras ?? old.extras,
      discountCode: args.discountCode ?? old.discountCode,
      callbackUrl: old.callbackUrl,
      name: old.guest.name,
      email: old.guest.email,
      phone: old.guest.phone,
      message: args.message ?? old.guest.message,
    };
    // A change holds rooms like any request: the same limits apply, and the holder is recorded.
    const holder = this.holdGuard(property, agent, old.guest.email, raw.rooms, old);
    let created: BookingRequest;
    try {
      created = await this.requests.create(property, raw, { agentClient: agent.name, language: old.language, replaces: old });
      created.holder = holder;
      if (old.driver) created.driver = old.driver;
      if (old.destinations) created.destinations = old.destinations;
      if (created.consent) Object.assign(created.consent, { agentIdentity: agent.identity ?? 'anonymous', agentDomain: agent.verifiedDomain });
      this.store.saveRequest(created);
    } catch (err) {
      if (err instanceof RequestError) throw new CatalogError(err.message, { code: err.code });
      if (err instanceof z.ZodError) throw new CatalogError('Invalid change: check dates, room and party.');
      throw err;
    }
    this.audit(property, agent, 'modify_request', { requestId: created.id, replaces: old.id, wasBooked: old.status === 'accepted', result: created.status });
    const view = await this.view(property, created);
    const booked = created.status === 'accepted';
    return {
      ...view,
      replacesRequestId: old.id,
      tellTheGuest: booked
        ? `Your change at ${property.name} is confirmed: ${created.checkin} – ${created.checkout}. The earlier booking is replaced.`
        : old.status === 'accepted'
          ? `Your change was sent to ${property.name}. Your current booking (${old.checkin} – ${old.checkout}) stays valid until the host confirms the change.`
          : `Your request to ${property.name} was updated to ${created.checkin} – ${created.checkout}. It is still waiting for the host.`,
    };
  }

  /** Reports wrong or outdated data in the passport to the host; never changes data itself. */
  async reportDataIssue(args: { propertyId: string; description: string; factKey?: string; unitId?: string }, agent: AgentContext) {
    const property = this.store.getProperty(args.propertyId);
    if (!property || !property.published) throw new CatalogError('Accommodation not found.', { code: 'NOT_FOUND' });
    this.guard(agent, 'issue', property);
    try {
      const q = await this.questions.ask(property, { question: args.description, factKey: args.factKey, unitId: args.unitId, kind: 'issue', language: 'en' }, agent.name);
      this.audit(property, agent, 'report_data_issue', { questionId: q.id, factKey: q.factKey });
      return {
        status: 'reported',
        reportId: q.id,
        statusToken: q.publicToken,
        next: 'The host was notified and can correct the passport. Until then, treat the reported fact as uncertain and say so to the guest.',
      };
    } catch (err) {
      if (err instanceof RequestError) throw new CatalogError(err.message, { code: err.code });
      throw err;
    }
  }

  async checkStatus(token: string) {
    const request = this.store.getRequestByToken(token);
    if (request) return this.view(this.store.getProperty(request.propertyId)!, request);
    const question = this.store.getQuestionByToken(token);
    if (question) {
      const property = this.store.getProperty(question.propertyId);
      return { type: question.kind === 'issue' ? 'data_issue' : 'host_question', status: question.status, property: property?.name, question: question.question, answer: question.answer ? scanText(question.answer).text : question.answer, answeredBy: question.answeredBy, answeredAt: question.answeredAt };
    }
    throw new CatalogError('Unknown status token.', { code: 'NOT_FOUND' });
  }

  /** The booking record as an agent may see it: status, what was agreed, and what happens next. */
  private async view(property: Property, r: BookingRequest) {
    const members = this.requests.members(property, r);
    const group = members.length > 1;
    const total = Math.round(members.reduce((sum, m) => sum + m.quotedTotal, 0) * 100) / 100;
    const due = Math.round(members.reduce((sum, m) => sum + (m.payment?.amountDue ?? 0), 0) * 100) / 100;
    const payment = r.payment ? { ...r.payment, amountDue: due } : undefined;
    const next: Record<BookingRequest['status'], string> = {
      new: `Waiting for the host. ${group ? 'Rooms are' : 'Nights are'} held until ${r.holdUntil}; after that the request expires automatically.`,
      accepted: payment?.status === 'pending' ? `Confirmed. Deposit ${money(due, 'en', property.currency)} due by ${payment.dueDate}.` : 'Confirmed.',
      declined: 'Declined by the host. Offer the guest one of the alternatives, or another stay.',
      expired: 'Expired: the host did not answer in time. Nothing is booked. Offer the guest one of the alternatives, or another stay.',
      cancelled: 'Cancelled.',
    };
    const signedPart = {
      requestId: r.id,
      propertyId: property.id,
      status: r.status,
      booked: r.status === 'accepted',
      checkin: r.checkin,
      checkout: r.checkout,
      rooms: members.map((m) => ({ unitId: m.unitId, roomCount: m.rooms ?? 1, ratePlanId: m.ratePlanId, guests: m.guests, total: m.quotedTotal, priceLines: m.terms?.lines })),
      total,
      conditions: r.terms?.policies,
      consent: r.consent,
      decidedAt: r.decidedAt,
    };
    return {
      type: 'booking_request',
      signedRecord: signedPart,
      signature: signRecord(this.store, signedPart),
      verify: 'Verify signature over canonical JSON (sorted keys) of signedRecord with the Ed25519 key published at /.well-known/innli.json.',
      requestId: r.id,
      statusToken: r.publicToken,
      status: r.status,
      booked: r.status === 'accepted',
      decidedBy: r.decidedBy,
      property: property.name,
      propertyId: property.id,
      unitId: r.unitId,
      roomCount: group ? undefined : r.rooms ?? 1,
      ratePlanId: r.ratePlanId,
      rooms: group ? members.map((m) => ({ unitId: m.unitId, name: property.units.find((u) => u.id === m.unitId)?.name, guests: m.guests, total: m.quotedTotal })) : undefined,
      checkin: r.checkin,
      checkout: r.checkout,
      guests: r.guests,
      total,
      totalIncludesAllMandatoryCosts: members.every((m) => m.quoteComplete),
      holdUntil: r.status === 'new' ? r.holdUntil : undefined,
      payment,
      hostMessage: r.ownerNote ? scanText(r.ownerNote).text : undefined,
      record: { priceLines: group ? members.flatMap((m) => m.terms?.lines ?? []) : r.terms?.lines, conditions: r.terms?.policies, consent: r.consent && { via: r.consent.via, statement: r.consent.statement, givenAt: r.consent.givenAt } },
      alternatives: r.status === 'declined' || r.status === 'expired' ? await this.alternatives(property, r, members) : undefined,
      next: next[r.status],
      statusUrl: `${this.publicUrl}/aanvraag/${r.publicToken}`,
      instantBooking: rulesOf(property).instantBooking,
      // What cancelling would cost today, from the owner's structured rules (null amount: only a text policy).
      cancellationCostIfCancelledNow: r.status === 'accepted' ? cancellationCost(property, { checkin: r.checkin, total, ratePlanId: r.ratePlanId }) : undefined,
      extras: r.extras,
      discountCode: r.discountCode,
    };
  }

  /** Other dates of the same length close to the requested ones, for a declined or expired request. */
  private async alternatives(property: Property, r: BookingRequest, members: BookingRequest[]) {
    if (members.length > 1) return [];
    const nights = stayNights(r.checkin, r.checkout).length;
    const today = new Date().toISOString().slice(0, 10);
    const from = addDays(r.checkin, -7) > today ? addDays(r.checkin, -7) : addDays(today, 1);
    try {
      const found = await this.catalog.findAvailableDates(property.id, { from, to: addDays(r.checkout, 14), nights, guests: r.guests }, '__preview__');
      return found.options
        .filter((o) => o.checkin !== r.checkin)
        .slice(0, 3)
        .map((o) => ({ checkin: o.checkin, checkout: o.checkout, rooms: o.units }));
    } catch {
      return [];
    }
  }
}
