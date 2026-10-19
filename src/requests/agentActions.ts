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
import type { QuestionService } from './questions.ts';
import type { WaitlistService } from './waitlist.ts';
import { RequestError, rulesOf, type RequestService } from './service.ts';

export interface AgentContext {
  name: string;
  /** Whether this agent may act for guests (requests, questions, cancellations). */
  canAct: boolean;
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

  constructor(store: Store, requests: RequestService, questions: QuestionService, catalog: Catalog, publicUrl: string) {
    this.store = store;
    this.requests = requests;
    this.questions = questions;
    this.catalog = catalog;
    this.publicUrl = publicUrl.replace(/\/$/, '');
  }

  private guard(agent: AgentContext, kind: string): void {
    if (!agent.canAct) throw new CatalogError('This agent key is read-only: it may search and quote, but not act for guests.', { code: 'FORBIDDEN' });
    if (!this.limit(`${agent.name}:${kind}`)) throw new CatalogError('Too many requests from this agent; try again in a minute.', { code: 'RATE_LIMITED' });
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
    this.guard(agent, 'request');
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
    if (quotes.some((q) => q!.bookingMode === 'booking_link')) {
      throw new CatalogError('This property takes bookings in its own booking system: use prepare_booking and give the guest the link.', { code: 'INVALID_INPUT', nextTools: ['prepare_booking'] });
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
    let members: BookingRequest[];
    try {
      members = quotes.length === 1
        ? [await this.requests.create(property, raw(first), { agentClient: agent.name, idempotencyKey: args.idempotencyKey, language: args.guestLanguage, approved: args.consentHash ? approved : undefined })]
        : await this.requests.createGroup(property, quotes.map((q) => raw(q!)), { agentClient: agent.name, idempotencyKey: args.idempotencyKey, language: args.guestLanguage, approved: args.consentHash ? approved : undefined });
    } catch (err) {
      if (err instanceof RequestError) throw new CatalogError(err.message, { code: err.code });
      if (err instanceof z.ZodError) throw new CatalogError('Invalid guest details: provide a full name and a valid e-mail address.');
      throw err;
    }
    const request = this.requests.members(property, members[0])[0];
    this.audit(property, agent, 'request_booking', { requestId: request.id, groupId: request.groupId, rooms: ids.length, result: request.status, idempotencyKey: args.idempotencyKey });
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
    this.guard(agent, 'waitlist');
    const property = this.store.getProperty(args.propertyId);
    if (!property || !property.published) throw new CatalogError('Accommodation not found.', { code: 'NOT_FOUND' });
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
    this.guard(agent, 'question');
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
    this.guard(agent, 'modify');
    const old = this.store.getRequestByToken(args.statusToken);
    if (!old) throw new CatalogError('Unknown status token.', { code: 'NOT_FOUND' });
    const property = this.store.getProperty(old.propertyId);
    if (!property) throw new CatalogError('Accommodation not found.', { code: 'NOT_FOUND' });
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
    let created: BookingRequest;
    try {
      created = await this.requests.create(property, raw, { agentClient: agent.name, language: old.language, replaces: old });
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
    this.guard(agent, 'issue');
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
