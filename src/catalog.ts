import { randomBytes, randomUUID } from 'node:crypto';
import { track } from './analytics/funnel.ts';
import { bookingTarget } from './booking/links.ts';
import { AvailabilityService, type CheckOptions } from './connectors/availability.ts';
import { addDays, assertNotInPast, stayNights } from './domain/dates.ts';
import { factDefinitionsFor, isStale, readFact, type FactScope } from './domain/facts.ts';
import { evaluateRequirement, impliedRequirements, matchesLocation, matchRoomCombinations, matchScore, matchUnits, roomsNeeded, type CombinationMatch, type LocationFilter, type Requirement, type UnitMatch } from './domain/matching.ts';
import { buildQuote as buildQuoteRaw, QuoteInputError, weekdayNames, type QuoteInput } from './domain/pricing.ts';
import { cancellationSchedule } from './domain/cancellation.ts';
import { nightPrices } from './domain/rates.ts';
import { isLiveConnector, type AvailabilityResult, type Currency, type FactMap, type FactValue, type Guests, type Language, type PoiKind, type Property, type Quote, type Unit } from './domain/types.ts';
import type { Store } from './store.ts';
import { currentLang, money, t, type MessageKey, type Params } from './i18n/index.ts';
import { mapLimit } from './util/concurrency.ts';
import { AgentError, type ErrorCode } from './agentErrors.ts';
import { consentFor } from './agent/consent.ts';
import { scanText, TextGuard } from './agent/hostText.ts';
import { signedPassport, trustFor } from './agent/trust.ts';

/** Parallel calls to one owner's booking system / calendars, kept modest so it is not flooded. */
const CONCURRENCY = 6;
/** Search candidates are different properties (different systems), so more can run at once. */
const SEARCH_CONCURRENCY = 12;

/** An error an agent can act on: a readable message plus a code (see agentErrors.ts). */
export class CatalogError extends AgentError {}

const KEY_CODES: Record<string, ErrorCode> = {
  'cat.propertyNotFound': 'NOT_FOUND',
  'cat.unitNotFound': 'NOT_FOUND',
  'cat.unitNotFoundShort': 'NOT_FOUND',
  'cat.quoteNotFound': 'QUOTE_NOT_FOUND',
  'cat.quoteExpired': 'QUOTE_EXPIRED',
  'cat.unitUnavailable': 'UNAVAILABLE',
  'price.codeUsedUp': 'LIMIT_REACHED',
};

/** A translated catalog error with the code that belongs to its message. */
function fail(key: MessageKey, vars?: Params): CatalogError {
  const code = KEY_CODES[key] ?? 'INVALID_INPUT';
  const nextTools = key === 'cat.unitNotFound' ? ['get_stay_details'] : undefined;
  return new CatalogError(t(key, vars), { code, nextTools });
}

/** Price calculation; an unknown rate plan is a readable error for the agent. */
function buildQuote(input: QuoteInput): Quote {
  try {
    return buildQuoteRaw(input);
  } catch (err) {
    if (err instanceof QuoteInputError) throw new CatalogError(err.message);
    throw err;
  }
}

/** How long a quote with `hold: true` keeps the rooms while the agent asks the guest. */
export const QUOTE_HOLD_MINUTES = 15;

export interface QuoteOptions {
  /** Identical rooms of the unit's type (default: as many as the party needs). */
  rooms?: number;
  ratePlanId?: string;
  /** Hold the rooms for QUOTE_HOLD_MINUTES while the guest decides. */
  hold?: boolean;
  /** Paid options (bikes, packed lunch …) with quantity. */
  extras?: { id: string; qty?: number }[];
  discountCode?: string;
}

/** Agent identity used by the owner dashboard: sees unpublished stays and is not counted in analytics. */
export const PREVIEW_CLIENT = '__preview__';

/** Fixed stay shapes guests ask for: weekend Fri–Sun, long weekend Fri–Mon, midweek Mon–Fri. */
export type StayPattern = 'weekend' | 'long_weekend' | 'midweek';
const PATTERNS: Record<StayPattern, { weekday: number; nights: number }> = {
  weekend: { weekday: 5, nights: 2 },
  long_weekend: { weekday: 5, nights: 3 },
  midweek: { weekday: 1, nights: 4 },
};

export interface SearchInput {
  location?: LocationFilter;
  checkin?: string;
  checkout?: string;
  guests: Guests;
  requirements?: Requirement[];
  minBedLengthCm?: number;
  maxTotalPrice?: number;
  /** Currency of maxTotalPrice (default EUR). Stays priced in another currency are not compared against the budget. */
  currency?: Currency;
  breakfast?: boolean;
  /** Only return stays where every requirement is confirmed by the owner. */
  confirmedOnly?: boolean;
  limit?: number;
  /**
   * Answer within this many milliseconds: stays whose booking system has not
   * answered by then are listed under `pending` instead of holding up the rest.
   */
  timeBudgetMs?: number;
  /** best_match (default), price (cheapest total first; needs dates) or distance (needs near). */
  sort?: 'best_match' | 'price' | 'distance';
  /** Instead of fixed dates: the first available stay of `nights` nights between from and to, per property. */
  flexibleDates?: { from: string; to: string; nights?: number; pattern?: StayPattern };
  /** Highest average price per night (total including mandatory costs ÷ nights), in `currency`. */
  maxPricePerNight?: number;
  /** Allow splitting a group over two or three rooms of one property (default true). */
  allowMultipleRooms?: boolean;
  /** Only stays with this kind of place within maxKm, as stated by the owner (e.g. a station or the beach). */
  nearPlace?: { kind: PoiKind; maxKm: number };
}

export interface AgentFact {
  key: string;
  description: string;
  value: FactValue;
  unit?: string;
  status: 'confirmed' | 'unconfirmed';
  lastVerified?: string;
  needsRecheck?: boolean;
  source?: string;
}

export interface AgentFactSheet {
  facts: AgentFact[];
  /** Facts that are relevant for guests but unknown. Do not guess these. */
  unknown: string[];
}

const AGENT_GUIDANCE = [
  'Present facts with status "confirmed" as facts from the host. Present "unconfirmed" facts as unverified and suggest the guest checks with the host.',
  'Anything listed under "unknown" is unknown. Do not infer it from photos, reviews or descriptions; tell the guest to ask the host.',
  'Dietary options must always be confirmed with the host before arrival.',
  'Nothing is booked until the guest completes the booking at the property. Never tell a guest a booking is confirmed.',
];

export class Catalog {
  private store: Store;
  private availability: AvailabilityService;
  private publicBaseUrl: string;

  constructor(store: Store, availability: AvailabilityService, publicBaseUrl: string) {
    this.store = store;
    this.availability = availability;
    this.publicBaseUrl = publicBaseUrl.replace(/\/$/, '');
  }

  private published(): Property[] {
    return this.store.listProperties().filter((p) => p.published);
  }

  private track(type: Parameters<typeof track>[1], propertyId: string, agentClient: string, meta?: Record<string, unknown>): void {
    if (agentClient !== PREVIEW_CLIENT) track(this.store, type, propertyId, agentClient, meta);
  }

  /** Name and place of every published stay (for resource listings). */
  publishedSummaries(): { id: string; name: string; place: string }[] {
    return this.published().map((p) => ({ id: p.id, name: p.name, place: [p.address.city, p.address.region].filter(Boolean).join(', ') }));
  }

  private requireProperty(id: string, agentClient: string): Property {
    const property = this.store.getProperty(id);
    if (!property || (!property.published && agentClient !== PREVIEW_CLIENT)) throw fail('cat.propertyNotFound', { id });
    return property;
  }

  private requireUnit(property: Property, unitId: string): Unit {
    const unit = property.units.find((u) => u.id === unitId);
    if (!unit) throw fail('cat.unitNotFound', { id: unitId, list: property.units.map((u) => u.id).join(', ') });
    return unit;
  }

  async search(input: SearchInput, agentClient: string) {
    const guests = normaliseGuests(input.guests);
    const requirements = impliedRequirements(guests, input.requirements ?? []);
    const limit = Math.min(input.limit ?? 5, 10);
    const hasDates = Boolean(input.checkin && input.checkout);
    const nights = hasDates ? stayNights(input.checkin!, input.checkout!) : null;
    if (hasDates) assertNotInPast(input.checkin!);
    const pattern = input.flexibleDates?.pattern ? PATTERNS[input.flexibleDates.pattern] : undefined;
    const flexible = !hasDates && input.flexibleDates ? { ...input.flexibleDates, nights: pattern?.nights ?? input.flexibleDates.nights ?? 0 } : null;
    if (flexible) {
      assertNotInPast(flexible.from);
      if (flexible.nights < 1 || flexible.nights > 21) throw fail('cat.nightsRange');
      if (addDays(flexible.to, -flexible.nights) < flexible.from) throw fail('cat.windowTooShort');
    }

    // Demand insight for owners: every property in the searched area, and why it was or was not shown.
    const considered = new Map<string, { outcome: string; failed: Requirement[]; unknown: Requirement[] }>();
    const candidates: { property: Property; units: UnitMatch[]; combos: CombinationMatch[]; distanceKm?: number }[] = [];
    for (const property of this.published()) {
      const loc = matchesLocation(property, input.location);
      if (!loc.ok) continue;
      const units = matchUnits(property, requirements, { guests, minBedLengthCm: input.minBedLengthCm });
      if (input.nearPlace && !(property.pointsOfInterest ?? []).some((p) => p.kind === input.nearPlace!.kind && p.distanceKm <= input.nearPlace!.maxKm)) {
        considered.set(property.id, { outcome: 'requirement_not_met', failed: [], unknown: [] });
        continue;
      }
      const why = this.whyNot(property, requirements, guests, input.minBedLengthCm);
      // A group too large for any single room may fit in two or three rooms.
      let combos: CombinationMatch[] = [];
      if (!units.length && why.capacity && input.allowMultipleRooms !== false) {
        combos = matchRoomCombinations(property, requirements, { guests, minBedLengthCm: input.minBedLengthCm });
        if (input.confirmedOnly) combos = combos.filter((c) => c.overall === 'met');
      }
      if (!units.length && !combos.length) {
        considered.set(property.id, { outcome: why.capacity ? 'too_small' : 'requirement_not_met', ...why });
        continue;
      }
      if (units.length && input.confirmedOnly && !units.some((u) => u.overall === 'met')) {
        considered.set(property.id, { outcome: 'not_confirmed', ...why });
        continue;
      }
      considered.set(property.id, { outcome: 'ranked_lower', ...why });
      candidates.push({ property, units: input.confirmedOnly ? units.filter((u) => u.overall === 'met') : units, combos, distanceKm: loc.distanceKm });
    }
    const score = (c: (typeof candidates)[number]) => (c.units.length ? matchScore(c.units[0].criteria) : matchScore(c.combos[0].rooms.flatMap((r) => r.criteria)) / c.combos[0].rooms.length - 0.5);
    candidates.sort((a, b) => score(b) - score(a) || (a.distanceKm ?? 0) - (b.distanceKm ?? 0));

    const results = [];
    const excluded: { property: string; reason: string }[] = [];
    const sort = input.sort ?? 'best_match';
    // For another order than best match, look at more candidates before trimming to the limit.
    const collect = sort === 'best_match' ? limit : 10;
    type Candidate = (typeof candidates)[number];
    type Found =
      | { kind: 'room'; chosen: UnitMatch; quote: Quote | null }
      | { kind: 'rooms'; combo: CombinationMatch; quotes: Quote[] };

    // One property, one set of dates: the best single room, or the best room combination for a group.
    const tryDates = async (c: Candidate, checkin: string, checkout: string, stay: string[]): Promise<{ found?: Found; reason: string; overBudget?: boolean }> => {
      let reason = t('cat.noRoom');
      let overBudget = false;
      for (const um of c.units) {
        const availability = await this.availability.check(c.property, um.unit, stay, guests, { rooms: um.rooms });
        if (availability.status === 'unavailable') continue;
        const quote = this.createQuote(c.property, um.unit, checkin, checkout, stay, guests, input.breakfast ?? false, availability, { rooms: um.rooms });
        if (input.maxTotalPrice !== undefined && quote.total > input.maxTotalPrice) {
          reason = t('cat.overBudget', { amount: money(quote.total, currentLang(), c.property.currency) });
          overBudget = true;
          continue;
        }
        if (input.maxPricePerNight !== undefined && quote.total / stay.length > input.maxPricePerNight) {
          reason = t('cat.overNightBudget', { amount: money(Math.round((quote.total / stay.length) * 100) / 100, currentLang(), c.property.currency) });
          overBudget = true;
          continue;
        }
        return { found: { kind: 'room', chosen: um, quote }, reason: '' };
      }
      for (const combo of c.combos) {
        const checks = await Promise.all(combo.rooms.map((r) => this.availability.check(c.property, r.unit, stay, r.guests)));
        if (checks.some((a) => a.status === 'unavailable')) continue;
        const quotes = combo.rooms.map((r, i) => this.createQuote(c.property, r.unit, checkin, checkout, stay, r.guests, input.breakfast ?? false, checks[i]));
        const total = quotes.reduce((sum, q) => sum + q.total, 0);
        if (input.maxTotalPrice !== undefined && total > input.maxTotalPrice) {
          reason = t('cat.overBudget', { amount: money(total, currentLang(), c.property.currency) });
          overBudget = true;
          continue;
        }
        if (input.maxPricePerNight !== undefined && total / stay.length > input.maxPricePerNight) {
          reason = t('cat.overNightBudget', { amount: money(Math.round((total / stay.length) * 100) / 100, currentLang(), c.property.currency) });
          overBudget = true;
          continue;
        }
        return { found: { kind: 'rooms', combo, quotes }, reason: '' };
      }
      return { reason, overBudget };
    };

    const budgetCurrency = input.currency ?? 'EUR';
    const evaluate = async (c: Candidate): Promise<{ found?: Found; reason: string; overBudget?: boolean }> => {
      // No exchange rates: a budget only applies to stays priced in the same currency.
      if ((input.maxTotalPrice !== undefined || input.maxPricePerNight !== undefined) && c.property.currency !== budgetCurrency) return { reason: t('cat.otherCurrency', { currency: c.property.currency, budget: budgetCurrency }), overBudget: true };
      if (nights) return tryDates(c, input.checkin!, input.checkout!, nights);
      if (flexible) {
        const live = isLiveConnector(c.property.booking.connector);
        let dates = stayNights(flexible.from, addDays(addDays(flexible.to, -flexible.nights), 1), 62);
        if (pattern) dates = dates.filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === pattern.weekday);
        if (live) dates = dates.slice(0, 14);
        let overBudget: { reason: string; overBudget: boolean } | undefined;
        for (const checkin of dates) {
          const checkout = addDays(checkin, flexible.nights);
          const r = await tryDates(c, checkin, checkout, stayNights(checkin, checkout));
          if (r.found) return r;
          if (r.overBudget) overBudget = { reason: r.reason, overBudget: true };
        }
        // Free dates that only failed on price say so, instead of "nothing free".
        return overBudget ?? { reason: t('cat.noPeriod') };
      }
      return c.units.length ? { found: { kind: 'room', chosen: c.units[0], quote: null }, reason: '' } : { found: { kind: 'rooms', combo: c.combos[0], quotes: [] }, reason: '' };
    };

    const datesKnown = Boolean(nights || flexible);
    const startedAt = Date.now();
    const deadline = input.timeBudgetMs ? startedAt + input.timeBudgetMs : Infinity;
    const pending: { propertyId: string; name: string }[] = [];
    type Evaluated = Awaited<ReturnType<typeof evaluate>> | 'timeout';
    // A slow booking system costs only its own result, not the whole answer.
    const timed = (c: Candidate): Promise<Evaluated> => {
      const left = deadline - Date.now();
      if (left === Infinity) return evaluate(c);
      if (left <= 0) return Promise.resolve('timeout');
      let timer: NodeJS.Timeout | undefined;
      return Promise.race([evaluate(c), new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), left)))]).finally(() => clearTimeout(timer));
    };
    let next = 0;
    while (next < candidates.length && results.length < collect) {
      const batch = candidates.slice(next, next + Math.max(SEARCH_CONCURRENCY, collect - results.length));
      next += batch.length;
      const evaluated = await mapLimit(batch, SEARCH_CONCURRENCY, timed);
      for (let k = 0; k < batch.length && results.length < collect; k++) {
        const c = batch[k];
        const outcome = evaluated[k];
        if (outcome === 'timeout') {
          pending.push({ propertyId: c.property.id, name: c.property.name });
          continue;
        }
        const { found, reason, overBudget } = outcome;
        if (!found || (datesKnown && found.kind === 'room' && !found.quote)) {
          excluded.push({ property: c.property.name, reason });
          considered.get(c.property.id)!.outcome = overBudget ? 'over_budget' : 'unavailable';
          continue;
        }
        considered.get(c.property.id)!.outcome = 'shown';
        this.track('search_impression', c.property.id, agentClient);
        const base = {
          propertyId: c.property.id,
          name: c.property.name,
          type: c.property.type,
          location: `${c.property.address.city}${c.property.address.region ? `, ${c.property.address.region}` : ''}`,
          distanceKm: c.distanceKm,
          summary: scanText(c.property.description).text.slice(0, 280),
          host: this.hostInfo?.(c.property),
          rating: this.rating(c.property),
          trust: this.trust(c.property),
        };
        if (found.kind === 'room') {
          let offer: ReturnType<Catalog['quoteSummary']> | null = null;
          if (found.quote) {
            offer = this.quoteSummary(c.property, found.quote, input.maxTotalPrice);
            this.track('quote_issued', c.property.id, agentClient, { quoteId: found.quote.id, via: 'search' });
          }
          results.push({ ...base, unit: { id: found.chosen.unit.id, name: found.chosen.unit.name, maxGuests: found.chosen.unit.maxGuests, rooms: found.chosen.rooms, roomsOfThisType: found.chosen.unit.inventory ?? 1 }, matchQuality: found.chosen.overall, criteria: found.chosen.criteria, offer });
        } else {
          for (const q of found.quotes) this.track('quote_issued', c.property.id, agentClient, { quoteId: q.id, via: 'search', group: true });
          const summaries = found.quotes.map((q) => this.quoteSummary(c.property, q, input.maxTotalPrice));
          const total = Math.round(found.quotes.reduce((sum, q) => sum + q.total, 0) * 100) / 100;
          results.push({
            ...base,
            unit: null,
            rooms: found.combo.rooms.map((r) => ({ unitId: r.unit.id, name: r.unit.name, maxGuests: r.unit.maxGuests, guests: r.guests, criteria: r.criteria })),
            matchQuality: found.combo.overall,
            criteria: found.combo.rooms[0].criteria,
            offer: summaries.length
              ? {
                  quoteIds: summaries.map((x) => x.quoteId),
                  checkin: summaries[0].checkin,
                  checkout: summaries[0].checkout,
                  total,
                  currency: c.property.currency,
                  totalIncludesAllMandatoryCosts: summaries.every((x) => x.totalIncludesAllMandatoryCosts),
                  bookingMode: summaries.every((x) => x.bookingMode === 'availability_request') ? 'availability_request' : 'booking_link',
                  rooms: summaries,
                  consent: summaries.every((x) => x.bookingMode === 'availability_request') ? consentFor(c.property, found.quotes) : undefined,
                  next: 'Book all rooms together with request_booking({ quoteIds, consentHash }) — the host confirms them as one group, all or nothing.',
                }
              : null,
          });
        }
      }
    }

    // Aggregated per property per day: bounded storage however many agents search.
    if (agentClient !== PREVIEW_CLIENT) {
      for (const [propertyId, c] of considered) this.store.recordDemand(propertyId, { requirements, outcome: c.outcome, failed: c.failed, unknown: c.unknown });
    }
    if (sort === 'price') results.sort((a, b) => ((a.offer as { total?: number } | null)?.total ?? Infinity) - ((b.offer as { total?: number } | null)?.total ?? Infinity));
    if (sort === 'distance') results.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    return {
      query: { guests, requirements, checkin: input.checkin, checkout: input.checkout, flexibleDates: flexible ?? undefined, maxTotalPrice: input.maxTotalPrice, maxPricePerNight: input.maxPricePerNight, currency: input.maxTotalPrice !== undefined || input.maxPricePerNight !== undefined ? budgetCurrency : undefined, sort },
      results: results.slice(0, limit),
      excluded,
      // Only when a time budget cut the search short: these can be checked one by one (check_availability).
      partial: pending.length ? true : undefined,
      pending: pending.length ? pending : undefined,
      tookMs: Date.now() - startedAt,
      legend: {
        met: 'Confirmed by the host',
        unverified: 'Indicated but not (re)confirmed by the host — mention this to the guest',
        unknown: 'No reliable information — the guest should ask the host',
      },
      guidance: AGENT_GUIDANCE,
    };
  }

  /** For each requirement: did every room fail it (failed), or is the best answer unknown? */
  private whyNot(property: Property, requirements: Requirement[], guests: Guests, minBedLengthCm?: number) {
    const rooms = property.units.filter((u) => roomsNeeded(u, guests) !== null);
    const failed: Requirement[] = [];
    const unknown: Requirement[] = [];
    for (const req of requirements) {
      const levels = rooms.map((u) => evaluateRequirement(req, property, u, { guests, minBedLengthCm }).level);
      if (!levels.length) continue;
      if (levels.every((l) => l === 'not_met')) failed.push(req);
      else if (!levels.some((l) => l === 'met' || l === 'unverified')) unknown.push(req);
    }
    return { failed, unknown, capacity: rooms.length === 0 };
  }

  private hostInfo?: (property: Property) => Record<string, unknown>;

  /** Reliability signals (response time, instant booking, deposit), provided by the request service. */
  setHostInfoProvider(fn: (property: Property) => Record<string, unknown>): void {
    this.hostInfo = fn;
  }

  details(propertyId: string, agentClient: string, language?: Language) {
    const property = this.requireProperty(propertyId, agentClient);
    this.track('details_view', property.id, agentClient);
    const base = property.language ?? 'nl';
    const translated = language && language !== base ? property.translations?.[language]?.description : undefined;
    // Everything below that a host or guest wrote is cleaned of instruction-like text (see agent/hostText.ts).
    const guard = new TextGuard();
    const faq = this.store
      .questionsFor(property.id)
      .filter((q) => q.status === 'answered' && q.publishAsFaq && q.answer)
      .map((q, i) => ({ question: guard.clean(`faq[${i}].question`, q.question), answer: guard.clean(`faq[${i}].answer`, q.answer!), answeredAt: q.answeredAt?.slice(0, 10) }));
    const reviews = this.reviews?.(property) as { recent?: { text?: string; ownerReply?: string }[] } | undefined;
    reviews?.recent?.forEach((r, i) => {
      r.text = guard.clean(`reviews.recent[${i}].text`, r.text);
      r.ownerReply = guard.clean(`reviews.recent[${i}].ownerReply`, r.ownerReply);
    });
    const sheet = (facts: FactMap, scope: FactScope, prefix: string) => {
      const s = factSheet(facts, scope, new Date(), property.currency);
      for (const f of s.facts) f.value = guard.clean(`${prefix}${f.key}`, f.value);
      return s;
    };
    const facts = sheet(property.facts, 'property', 'facts.');
    const units = property.units.map((u) => ({
      id: u.id,
      name: u.name,
      description: guard.clean(`units.${u.id}.description`, u.description),
      maxGuests: u.maxGuests,
      roomsOfThisType: u.inventory ?? 1,
      indicativeRatePerNight: u.baseRatePerNight,
      discounts: u.rates?.discounts,
      arrivalRules: arrivalRules(u),
      photos: u.photos ?? [],
      facts: sheet(u.facts, 'unit', `units.${u.id}.facts.`),
    }));
    return {
      propertyId: property.id,
      name: property.name,
      type: property.type,
      description: guard.clean('description', translated || property.description),
      descriptionLanguage: translated ? language : base,
      availableLanguages: [base, ...Object.entries(property.translations ?? {}).filter(([k, v]) => k !== base && v?.description).map(([k]) => k)],
      address: { city: property.address.city, region: property.address.region, country: property.address.country },
      geo: property.geo,
      website: property.website,
      photos: property.photos ?? [],
      pointsOfInterest: property.pointsOfInterest ?? [],
      currency: property.currency,
      facts,
      faq,
      reviews,
      units,
      booking: describeBooking(property),
      ratePlans: property.ratePlans?.length ? [{ id: 'standard', name: 'Standard', adjustmentPercent: 0, refundable: true }, ...property.ratePlans] : undefined,
      extras: property.extras?.length ? property.extras.map((e) => ({ id: e.id, name: e.name, description: guard.clean(`extras.${e.id}.description`, e.description), price: e.price, per: e.per, max: e.max ?? 1 })) : undefined,
      // Codes themselves are private; agents only learn that asking the guest for one makes sense.
      acceptsDiscountCodes: (property.discountCodes ?? []).some((c) => c.active) || undefined,
      cancellationRules: property.cancellationRules?.length ? property.cancellationRules : undefined,
      host: this.hostInfo?.(property),
      passport: passportAge(property),
      trust: this.trust(property),
      signedPassport: (({ content: _c, ...signed }) => ({ ...signed, contentUrl: `${this.publicBaseUrl}/api/public/properties/${property.id}/passport` }))(signedPassport(this.store, property)),
      contentSafety: guard.report(),
      guidance: AGENT_GUIDANCE,
    };
  }

  private reviews?: (property: Property) => unknown;

  /** The checkable trust block for one stay (see agent/trust.ts). */
  private trust(property: Property) {
    const age = passportAge(property);
    const reviews = this.reviews?.(property) as { count?: number } | undefined;
    return trustFor(property, { reviewCount: reviews?.count, confirmedFacts: age.confirmedFacts, staleFacts: age.staleFacts });
  }

  /** Verified review average for result lists: overall plus per part of the stay. */
  private rating(property: Property) {
    const s = this.reviews?.(property) as { count?: number; average?: number; aspects?: Record<string, { average: number }> } | undefined;
    if (!s?.count) return undefined;
    return { average: s.average, count: s.count, aspects: s.aspects ? Object.fromEntries(Object.entries(s.aspects).map(([k, v]) => [k, v.average])) : undefined };
  }

  /** Verified guest reviews, provided by the review service. */
  setReviewsProvider(fn: (property: Property) => unknown): void {
    this.reviews = fn;
  }

  async checkAvailability(propertyId: string, checkin: string, checkout: string, rawGuests: Guests, agentClient: string, opts: { rooms?: number } = {}) {
    const property = this.requireProperty(propertyId, agentClient);
    const guests = normaliseGuests(rawGuests);
    const nights = stayNights(checkin, checkout);
    assertNotInPast(checkin);
    const units = await Promise.all(
      property.units.map(async (unit) => {
        const rooms = opts.rooms ?? roomsNeeded(unit, guests);
        if (rooms === null || guests.adults + guests.children > unit.maxGuests * rooms) {
          return { unitId: unit.id, name: unit.name, status: 'unavailable', certainty: 'none', note: t('cat.maxGuestsNote', { n: unit.maxGuests }) };
        }
        const result = await this.availability.check(property, unit, nights, guests, { rooms });
        // Honest scarcity: only for room types with several rooms, from the actual count.
        const fewLeft = (unit.inventory ?? 1) > 1 && result.status === 'available' && result.roomsLeft !== undefined && result.roomsLeft <= 2 ? true : undefined;
        return { name: unit.name, rooms, roomsOfThisType: unit.inventory ?? 1, ...result, fewLeft };
      }),
    );
    const demand = agentClient === PREVIEW_CLIENT ? undefined : this.dateDemand(property.id, checkin, checkout);
    this.track('availability_check', property.id, agentClient, { checkin, checkout });
    const full = units.every((u) => u.status === 'unavailable');
    return {
      propertyId: property.id,
      checkin,
      checkout,
      guests,
      units,
      booking: describeBooking(property),
      demand,
      alternatives: full ? await this.alternativesNearby(property, { checkin, checkout, guests }, agentClient) : undefined,
    };
  }

  /**
   * How many agents checked overlapping dates for this property in the last 7 days.
   * A fact, not a sales trick: no invented urgency, and nothing about who asked.
   */
  private dateDemand(propertyId: string, checkin: string, checkout: string) {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const checks = this.store.eventsFor(propertyId, since).filter((e) => e.type === 'availability_check' && e.agentClient !== PREVIEW_CLIENT && typeof e.meta?.checkin === 'string' && (e.meta.checkin as string) < checkout && (e.meta.checkout as string) > checkin).length;
    return checks >= 3 ? { checksLast7Days: checks, popularDates: true, note: `${checks} availability checks by agents for overlapping dates in the last 7 days.` } : undefined;
  }

  /** Similar stays nearby (or in the same region) that are free for the same dates, for when this one is full. */
  async alternativesNearby(property: Property, stay: { checkin: string; checkout: string; guests: Guests }, agentClient: string) {
    // Nearby first (30 km); when nothing nearby is free, the same country.
    const nearby: LocationFilter = property.geo ? { near: { ...property.geo, radiusKm: 30 } } : property.address.region ? { area: property.address.region } : { country: property.address.country };
    try {
      let found = await this.search({ location: nearby, checkin: stay.checkin, checkout: stay.checkout, guests: stay.guests, limit: 4, sort: 'best_match' }, agentClient);
      const usable = (f: typeof found) => (f.results as { propertyId: string; offer?: unknown }[]).some((r) => r.propertyId !== property.id && r.offer);
      if (!usable(found)) found = await this.search({ location: { country: property.address.country }, checkin: stay.checkin, checkout: stay.checkout, guests: stay.guests, limit: 4, sort: 'best_match' }, agentClient);
      return (found.results as { propertyId: string; name: string; location?: string; distanceKm?: number; offer?: { total?: number; currency?: string; quoteId?: string } | null; matchQuality?: string }[])
        .filter((r) => r.propertyId !== property.id && r.offer)
        .slice(0, 3)
        .map((r) => ({ propertyId: r.propertyId, name: r.name, place: r.location, distanceKm: r.distanceKm, total: r.offer?.total, currency: r.offer?.currency, quoteId: r.offer?.quoteId }));
    } catch {
      return [];
    }
  }

  async quote(propertyId: string, unitId: string, checkin: string, checkout: string, rawGuests: Guests, breakfast: boolean, agentClient: string, opts: QuoteOptions = {}) {
    const property = this.requireProperty(propertyId, agentClient);
    const unit = this.requireUnit(property, unitId);
    const guests = normaliseGuests(rawGuests);
    const nights = stayNights(checkin, checkout);
    assertNotInPast(checkin);
    const rooms = opts.rooms ?? roomsNeeded(unit, guests) ?? 1;
    const availability = await this.availability.check(property, unit, nights, guests, { rooms });
    if (availability.status === 'unavailable') throw fail('cat.unitUnavailable', { unit: unit.name });
    const quote = this.createQuote(property, unit, checkin, checkout, nights, guests, breakfast, availability, { ...opts, rooms });
    this.track('quote_issued', property.id, agentClient, { quoteId: quote.id });
    return this.quoteSummary(property, quote);
  }

  prepareBooking(quoteId: string, agentClient: string) {
    const quote = this.store.getQuote(quoteId);
    if (!quote) throw fail('cat.quoteNotFound');
    if (Date.parse(quote.validUntil) < Date.now()) throw fail('cat.quoteExpired');
    const property = this.requireProperty(quote.propertyId, agentClient);
    const unit = this.requireUnit(property, quote.unitId);
    const token = randomBytes(12).toString('base64url');
    const target = bookingTarget(property, unit, quote, token, this.publicBaseUrl);
    this.store.saveBookingLink({ token, quoteId, propertyId: property.id, unitId: unit.id, targetUrl: target, mode: quote.bookingMode, agentClient, createdAt: new Date().toISOString() });
    this.track('booking_link_created', property.id, agentClient, { quoteId, mode: quote.bookingMode });
    const isLink = quote.bookingMode === 'booking_link';
    return {
      mode: quote.bookingMode,
      url: `${this.publicBaseUrl}/r/${token}`,
      reference: token,
      property: property.name,
      unit: unit.name,
      checkin: quote.checkin,
      checkout: quote.checkout,
      total: quote.total,
      totalComplete: quote.complete,
      currency: quote.currency,
      instructionsForGuest: isLink
        ? 'Open the link to complete the booking in the property\'s own booking system. Dates and guests are pre-filled where supported. The booking is only confirmed by the property.'
        : 'Open the link to send an availability request to the host (dates and guests are pre-filled). This is not a booking: the host confirms availability and the final price by e-mail.',
      status: 'not_booked',
    };
  }

  /**
   * Live offer for the stay page and booking requests: availability plus price,
   * without storing a quote or counting it as agent activity.
   */
  async offer(property: Property, unitId: string, checkin: string, checkout: string, rawGuests: Partial<Guests>, breakfast: boolean, opts: CheckOptions & { ratePlanId?: string; extras?: { id: string; qty?: number }[]; discountCode?: string; ignoreCodeUseOf?: string } = {}) {
    const unit = this.requireUnit(property, unitId);
    const guests = normaliseGuests(rawGuests);
    const nights = stayNights(checkin, checkout);
    assertNotInPast(checkin);
    const rooms = Math.max(1, Math.floor(opts.rooms ?? 1));
    if (guests.adults + guests.children > unit.maxGuests * rooms) throw fail('price.maxGuests', { unit: unit.name, n: unit.maxGuests * rooms });
    const availability = await this.availability.check(property, unit, nights, guests, opts);
    this.checkCodeUses(property, opts.discountCode, opts.ignoreCodeUseOf);
    const quote = buildQuote({ id: 'offer', property, unit, checkin, checkout, nights, guests, breakfast, availability, rooms, ratePlanId: opts.ratePlanId, extras: opts.extras, discountCode: opts.discountCode });
    return { unit, guests, nights, availability, quote };
  }

  /** A discount code with a usage limit counts requests that are still standing (new or accepted). */
  private checkCodeUses(property: Property, code: string | undefined, ignoreRequestId?: string): void {
    const wanted = code?.trim().toUpperCase();
    const dc = wanted ? [...(property.offerCodes ?? []), ...(property.discountCodes ?? [])].find((c) => c.code.toUpperCase() === wanted) : undefined;
    if (!dc?.maxUses) return;
    const used = this.store.requestsFor(property.id).filter((r) => r.id !== ignoreRequestId && r.discountCode === dc.code && (r.status === 'new' || r.status === 'accepted')).length;
    if (used >= dc.maxUses) throw fail('price.codeUsedUp', { code: dc.code });
  }

  /** Owner-facing room calendar: own closures plus nights booked through connected feeds. */
  roomCalendar(property: Property, unit: Unit, nights: string[], opts: { fresh?: boolean } = {}) {
    return this.availability.overview(property, unit, nights, opts);
  }

  private createQuote(property: Property, unit: Unit, checkin: string, checkout: string, nights: string[], guests: Guests, breakfast: boolean, availability: AvailabilityResult, opts: QuoteOptions = {}): Quote {
    this.checkCodeUses(property, opts.discountCode);
    const quote = buildQuote({ id: `q_${randomUUID()}`, property, unit, checkin, checkout, nights, guests, breakfast, availability, rooms: opts.rooms, ratePlanId: opts.ratePlanId, extras: opts.extras, discountCode: opts.discountCode });
    // A short hold while the agent asks the guest for consent, so a busy property cannot sell the room meanwhile.
    if (opts.hold && availability.status === 'available' && quote.bookingMode === 'availability_request') {
      quote.hold = { until: new Date(Date.now() + QUOTE_HOLD_MINUTES * 60_000).toISOString() };
      quote.validUntil = quote.hold.until > quote.validUntil ? quote.hold.until : quote.validUntil;
    }
    this.store.saveQuote(quote);
    return quote;
  }

  private quoteSummary(property: Property, quote: Quote, budget?: number) {
    const warnings = [...quote.warnings];
    if (budget !== undefined && !quote.complete) warnings.push(t('cat.withinBudgetIncomplete', { amount: money(budget, currentLang(), property.currency) }));
    const unit = property.units.find((u) => u.id === quote.unitId);
    const nights = stayNights(quote.checkin, quote.checkout);
    const live = quote.priceCertainty === 'live' && quote.availability.nightlyRates?.length === nights.length;
    const nightly = live ? quote.availability.nightlyRates! : unit ? nightPrices(unit, nights).map(({ date, amount, season }) => ({ date, amount, season })) : [];
    return {
      quoteId: quote.id,
      unitId: quote.unitId,
      rooms: quote.rooms ?? 1,
      ratePlanId: quote.ratePlanId ?? 'standard',
      extras: quote.extras,
      discountCode: quote.discountCode,
      holdUntil: quote.hold?.until,
      checkin: quote.checkin,
      checkout: quote.checkout,
      nights: quote.nights,
      lines: quote.lines,
      total: quote.total,
      currency: quote.currency,
      totalIncludesAllMandatoryCosts: quote.complete,
      priceCertainty: quote.priceCertainty,
      availability: { status: quote.availability.status, certainty: quote.availability.certainty, checkedAt: quote.availability.checkedAt, roomsLeft: quote.availability.roomsLeft, note: quote.availability.note },
      bookingMode: quote.bookingMode,
      validUntil: quote.validUntil,
      nightly,
      policies: stayPolicies(property, quote.ratePlanId),
      cancellationCosts: property.cancellationRules?.length || quote.ratePlanId ? cancellationSchedule(property, quote) : undefined,
      extrasAvailable: property.extras?.length ? property.extras.map((e) => ({ id: e.id, name: e.name, price: e.price, per: e.per, max: e.max ?? 1, chosen: quote.extras?.find((x) => x.id === e.id)?.qty ?? 0 })) : undefined,
      ratePlanOptions: unit && property.ratePlans?.length ? this.ratePlanOptions(property, unit, quote) : undefined,
      summaryForGuest: guestSummary(property, unit, quote),
      consent: quote.bookingMode === 'availability_request' ? consentFor(property, [quote]) : undefined,
      warnings,
    };
  }

  /** The same stay priced in every rate plan, so the agent can offer the guest the choice. */
  private ratePlanOptions(property: Property, unit: Unit, quote: Quote) {
    const nights = stayNights(quote.checkin, quote.checkout);
    return ['standard', ...(property.ratePlans ?? []).map((p) => p.id)].map((id) => {
      const plan = property.ratePlans?.find((p) => p.id === id);
      const q = buildQuote({ id: 'plan', property, unit, checkin: quote.checkin, checkout: quote.checkout, nights, guests: quote.guests, breakfast: quote.breakfast, availability: quote.availability, rooms: quote.rooms, ratePlanId: id });
      return {
        ratePlanId: id,
        name: plan?.name ?? 'Standard',
        total: q.total,
        refundable: plan ? plan.refundable : true,
        breakfastIncluded: plan?.breakfastIncluded ?? readFact(property.facts, 'breakfast.included').value === true,
        cancellation: plan?.cancellation ?? (readFact(property.facts, 'policy.cancellation').value as string | null) ?? undefined,
        selected: (quote.ratePlanId ?? 'standard') === id,
        next: (quote.ratePlanId ?? 'standard') === id ? undefined : 'Get a quote with this ratePlanId to book it.',
      };
    });
  }

  /**
   * Flexible dates: every check-in date in a window where a unit is free for
   * the requested number of nights, with the total price. For "any weekend in
   * November" style questions.
   */
  async findAvailableDates(propertyId: string, input: { from: string; to: string; nights: number; guests: Guests; unitId?: string; weekendsOnly?: boolean }, agentClient: string) {
    const property = this.requireProperty(propertyId, agentClient);
    const guests = normaliseGuests(input.guests);
    const nightsCount = Math.floor(input.nights);
    if (nightsCount < 1 || nightsCount > 21) throw fail('cat.nightsRange');
    assertNotInPast(input.from);
    const lastCheckin = addDays(input.to, -nightsCount);
    if (lastCheckin < input.from) throw fail('cat.windowTooShort');
    const dates = stayNights(input.from, addDays(lastCheckin, 1), 62);
    const live = isLiveConnector(property.booking.connector);
    let candidates = input.weekendsOnly ? dates.filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 5) : dates;
    // Live booking systems get one request per date and unit; keep that bounded.
    if (live) candidates = candidates.slice(0, 14);
    const units = property.units.filter((u) => (!input.unitId || u.id === input.unitId) && roomsNeeded(u, guests) !== null);
    if (input.unitId && !units.length) throw fail('cat.unitTooSmall', { id: input.unitId });
    const perDate = await mapLimit(candidates, CONCURRENCY, async (checkin) => {
      const checkout = addDays(checkin, nightsCount);
      const nights = stayNights(checkin, checkout);
      const checks = await Promise.all(units.map(async (unit) => ({ unit, rooms: roomsNeeded(unit, guests)!, availability: await this.availability.check(property, unit, nights, guests, { rooms: roomsNeeded(unit, guests)! }) })));
      const free = checks
        .filter((c) => c.availability.status === 'available')
        .map(({ unit, rooms, availability }) => {
          const quote = buildQuote({ id: 'dates', property, unit, checkin, checkout, nights, guests, breakfast: false, availability, rooms });
          return { unitId: unit.id, name: unit.name, rooms, total: quote.total, totalIncludesAllMandatoryCosts: quote.complete, certainty: availability.certainty, roomsLeft: availability.roomsLeft };
        });
      return { checkin, checkout, units: free };
    });
    const options = perDate.filter((o) => o.units.length).slice(0, 15);
    this.track('availability_check', property.id, agentClient, { from: input.from, to: input.to, flexible: true });
    return {
      propertyId: property.id,
      nights: nightsCount,
      searchedFrom: input.from,
      searchedUntil: input.to,
      checkedCheckinDates: candidates.length,
      options,
      note: live && dates.length > candidates.length ? `Live system: only the first ${candidates.length} check-in dates were checked; narrow the window for later dates.` : undefined,
      next: 'Use get_quote with a chosen checkin/checkout and unitId for an itemised, bookable quote.',
    };
  }

  /** Month view per unit: which nights are open and what each night costs (owner rate table). */
  async availabilityCalendar(propertyId: string, month: string, agentClient: string, unitId?: string) {
    const property = this.requireProperty(propertyId, agentClient);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw fail('cat.monthFormat');
    const first = `${month}-01`;
    const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const start = first < today ? today : first;
    if (start >= next) throw fail('cat.monthPast');
    const nights = stayNights(start, next, 31);
    const kind = property.booking.connector.kind;
    const units = property.units.filter((u) => !unitId || u.id === unitId);
    if (unitId && !units.length) throw fail('cat.unitNotFoundShort', { id: unitId });
    const result = [];
    for (const unit of units) {
      const prices = new Map(nightPrices(unit, nights).map((n) => [n.date, n.amount]));
      if (kind === 'live_api' || kind === 'beds24' || kind === 'none') {
        result.push({ unitId: unit.id, name: unit.name, calendar: null, reason: kind !== 'none' ? 'Live booking system: use find_available_dates or check_availability for specific dates.' : 'No calendar connected; availability is confirmed by the host on request.' });
        continue;
      }
      const overview = await this.availability.overview(property, unit, nights);
      if (overview.feedErrors.length) {
        result.push({ unitId: unit.id, name: unit.name, calendar: null, reason: 'A connected calendar could not be read; availability unknown.' });
        continue;
      }
      result.push({
        unitId: unit.id,
        name: unit.name,
        calendar: overview.nights.map((n) => ({ date: n.date, available: n.state === 'open', price: prices.get(n.date) })),
        reason: 'Synced/host calendar: indicative, the host confirms on request.',
      });
    }
    this.track('availability_check', property.id, agentClient, { month });
    return { propertyId: property.id, month, units: result };
  }

  /** Side-by-side comparison of up to five stays for the same dates and party. */
  async compare(propertyIds: string[], input: { checkin?: string; checkout?: string; guests: Guests; requirements?: Requirement[]; breakfast?: boolean }, agentClient: string) {
    if (propertyIds.length < 1 || propertyIds.length > 5) throw fail('cat.compareRange');
    const guests = normaliseGuests(input.guests);
    const requirements = impliedRequirements(guests, input.requirements ?? []);
    const hasDates = Boolean(input.checkin && input.checkout);
    const nights = hasDates ? stayNights(input.checkin!, input.checkout!) : null;
    if (hasDates) assertNotInPast(input.checkin!);
    const rows = [];
    for (const id of propertyIds) {
      const property = this.store.getProperty(id);
      if (!property || !property.published) {
        rows.push({ propertyId: id, error: 'Not found' });
        continue;
      }
      const units = matchUnits(property, requirements, { guests });
      let offer = null;
      let chosen = units[0];
      if (nights) {
        for (const um of units) {
          const availability = await this.availability.check(property, um.unit, nights, guests, { rooms: um.rooms });
          if (availability.status === 'unavailable') continue;
          const quote = this.createQuote(property, um.unit, input.checkin!, input.checkout!, nights, guests, input.breakfast ?? false, availability, { rooms: um.rooms });
          offer = { quoteId: quote.id, rooms: um.rooms, total: quote.total, currency: quote.currency, totalIncludesAllMandatoryCosts: quote.complete, priceCertainty: quote.priceCertainty, availability: availability.status, bookingMode: quote.bookingMode, consent: quote.bookingMode === 'availability_request' ? consentFor(property, [quote]) : undefined };
          chosen = um;
          break;
        }
      }
      const fact = (key: string) => {
        const f = readFact(property.facts, key);
        return f.status === 'unknown' ? 'unknown' : { value: f.value, status: f.status };
      };
      this.track('details_view', property.id, agentClient, { via: 'compare' });
      rows.push({
        propertyId: property.id,
        name: property.name,
        location: property.address.city,
        unit: chosen ? { id: chosen.unit.id, name: chosen.unit.name, rooms: chosen.rooms } : null,
        matchQuality: chosen?.overall ?? 'not_met',
        criteria: chosen?.criteria ?? [],
        offer,
        available: nights ? Boolean(offer) : undefined,
        keyFacts: {
          dogsAllowed: fact('pets.dogsAllowed'),
          gardenFullyEnclosed: fact('garden.fullyEnclosed'),
          breakfastIncluded: fact('breakfast.included'),
          cancellation: fact('policy.cancellation'),
          parkingOnSite: fact('parking.onSite'),
          quiet: fact('location.quiet'),
        },
        unknownCriticalFacts: factSheet(property.facts, 'property').unknown.length,
        rating: this.rating(property),
      });
    }
    return { checkin: input.checkin, checkout: input.checkout, guests, requirements, rows, guidance: AGENT_GUIDANCE };
  }
}

export function normaliseGuests(g: Partial<Guests> | undefined): Guests {
  const adults = Math.floor(g?.adults ?? 2);
  const children = Math.floor(g?.children ?? 0);
  const dogs = Math.floor(g?.dogs ?? 0);
  if (adults < 1 || adults > 20) throw fail('cat.adultsRange');
  if (children < 0 || children > 20 || dogs < 0 || dogs > 5) throw fail('cat.invalidParty');
  return { adults, children, dogs };
}

export function factSheet(facts: FactMap, scope: FactScope, now = new Date(), currency: Currency = 'EUR'): AgentFactSheet {
  const sheet: AgentFactSheet = { facts: [], unknown: [] };
  for (const def of factDefinitionsFor(scope)) {
    const fact = readFact(facts, def.key);
    if (fact.status === 'unknown' || fact.value === null) {
      if (def.critical) sheet.unknown.push(def.agentDescription);
      continue;
    }
    sheet.facts.push({
      key: def.key,
      description: def.agentDescription,
      value: fact.value,
      // Money facts are in the property's own currency.
      unit: def.unit === 'EUR' ? currency : def.unit,
      status: fact.status,
      lastVerified: fact.verifiedAt?.slice(0, 10),
      needsRecheck: isStale(fact, now) || undefined,
      source: fact.status === 'unconfirmed' ? fact.source : undefined,
    });
  }
  return sheet;
}

/** How current the passport is: when the host last confirmed a fact, and how many facts are due for a recheck. */
export function passportAge(property: Property, now = new Date()) {
  const all = [property.facts, ...property.units.map((u) => u.facts)].flatMap((m) => Object.values(m));
  const dates = all.filter((f) => f.status === 'confirmed' && f.verifiedAt).map((f) => f.verifiedAt!).sort();
  return {
    lastVerifiedAt: dates.at(-1)?.slice(0, 10),
    oldestConfirmedAt: dates[0]?.slice(0, 10),
    confirmedFacts: dates.length,
    staleFacts: all.filter((f) => isStale(f, now)).length,
    updatedAt: property.updatedAt?.slice(0, 10),
  };
}

export function describeBooking(property: Property) {
  const kind = property.booking.connector.kind;
  return {
    availabilitySource: kind === 'live_api' ? 'live booking system' : kind === 'beds24' ? 'live booking system (Beds24)' : kind === 'ical' ? 'synced calendar(s) (indicative, not live)' : kind === 'manual' ? 'room calendar kept by the host (indicative, not live)' : 'not connected',
    howToBook:
      isLiveConnector(property.booking.connector) && property.booking.deeplinkTemplate
        ? 'Direct booking link to the property\'s own booking system (use prepare_booking after get_quote).'
        : 'Availability request to the host (use prepare_booking after get_quote). The host confirms.',
  };
}

function factOrUnknown(facts: FactMap, key: string) {
  const f = readFact(facts, key);
  return f.status === 'unknown' || f.value === null ? undefined : { value: f.value, status: f.status };
}

/** Practical conditions an agent should mention before the guest commits (of the chosen rate plan). */
export function stayPolicies(property: Property, ratePlanId?: string) {
  const keys: Record<string, string> = {
    cancellation: 'policy.cancellation',
    minNights: 'policy.minNights',
    checkInFrom: 'checkin.from',
    checkInUntil: 'checkin.until',
    checkOutUntil: 'checkout.until',
    breakfastTimes: 'breakfast.times',
    dogRules: 'pets.rules',
    dietsOnRequest: 'breakfast.dietsOnRequest',
    directBookingPerk: 'direct.perk',
  };
  const known: Record<string, unknown> = {};
  const unknown: string[] = [];
  for (const [name, key] of Object.entries(keys)) {
    const v = factOrUnknown(property.facts, key);
    if (v) known[name] = v;
    else unknown.push(name);
  }
  const plan = ratePlanId ? property.ratePlans?.find((p) => p.id === ratePlanId) : undefined;
  if (plan) {
    // The plan's own conditions take precedence: they are what the guest agrees to.
    if (plan.cancellation) known.cancellation = { value: plan.cancellation, status: 'confirmed' };
    known.ratePlan = { value: plan.name, status: 'confirmed' };
    known.refundable = { value: plan.refundable, status: 'confirmed' };
    return { ...known, unknown: unknown.filter((u) => !(u === 'cancellation' && plan.cancellation)) };
  }
  return { ...known, unknown };
}

/** Arrival weekdays and one-night supplement of a room, in words and as data, or undefined when there are none. */
function arrivalRules(u: Unit) {
  const seasons = (u.rates?.seasons ?? []).filter((s) => s.checkinDays?.length).map((s) => ({ season: s.name, from: s.from, to: s.to, checkinDays: s.checkinDays!, text: `${s.name}: ${weekdayNames(s.checkinDays!)}` }));
  const all = u.rates?.checkinDays?.length ? { checkinDays: u.rates.checkinDays, text: weekdayNames(u.rates.checkinDays) } : undefined;
  if (!seasons.length && !all && !u.rates?.singleNightSupplement) return undefined;
  return { checkinDays: all, seasons: seasons.length ? seasons : undefined, singleNightSupplement: u.rates?.singleNightSupplement };
}

function guestSummary(property: Property, unit: Unit | undefined, quote: Quote): string {
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const total = money(quote.total, 'en', quote.currency);
  const costs = quote.complete ? 'including all mandatory costs' : 'not all mandatory costs are known yet';
  const how =
    quote.bookingMode === 'booking_link'
      ? 'Availability was checked live; the guest books directly with the property.'
      : 'Availability is indicative; the guest sends a request and the host confirms by e-mail.';
  return `${(quote.rooms ?? 1) > 1 ? `${quote.rooms} × ` : ''}${unit?.name ?? 'Room'} at ${property.name}, ${quote.nights} night${quote.nights === 1 ? '' : 's'} (${fmt(quote.checkin)}–${fmt(quote.checkout)}): ${total} in total, ${costs}. ${how}`;
}
