/**
 * How results reach an agent: compact when asked, with the next useful calls
 * prefilled and with how fresh the data is. Agents pay for every token they
 * read and for every round trip; these three keep both low without hiding
 * anything an agent needs to be honest with the guest.
 */

type Json = Record<string, any>;

/** A next call with the arguments already known; `needs` lists what the agent must still get from the guest. */
export interface NextAction {
  tool: string;
  args: Json;
  why: string;
  needs?: string[];
  /** Only after the guest said yes to this (e.g. the consent summary). */
  requiresGuestApproval?: boolean;
}

/** Seconds a result stays reliable enough to show without asking again. */
const VALID_FOR: Record<string, number> = {
  search_stays: 300,
  get_stay_details: 3600,
  check_availability: 120,
  get_quote: 900,
  find_available_dates: 300,
  get_availability_calendar: 600,
  compare_stays: 300,
  answer_question: 3600,
  get_wish_offers: 60,
  check_status: 60,
};

export function freshness(tool: string, result: Json) {
  const checked: string[] = [];
  const visit = (v: any, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 6) return;
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1));
    if (typeof v.checkedAt === 'string') checked.push(v.checkedAt);
    if (typeof v.sourceFetchedAt === 'string') checked.push(v.sourceFetchedAt);
    for (const k of ['availability', 'units', 'results', 'offer', 'rooms', 'dates', 'rows']) if (k in v) visit(v[k], depth + 1);
  };
  visit(result, 0);
  checked.sort();
  return {
    generatedAt: new Date().toISOString(),
    validForSeconds: VALID_FOR[tool] ?? 300,
    // The oldest underlying availability source in this answer (a synced calendar can be older than the answer).
    oldestAvailabilityData: checked[0],
  };
}

const quoteAction = (offer: Json): NextAction | undefined => {
  if (!offer) return undefined;
  if (offer.bookingMode === 'booking_link') {
    return offer.quoteId ? { tool: 'prepare_booking', args: { quoteId: offer.quoteId }, why: 'Booking link to the property\'s own booking system.' } : undefined;
  }
  const ids = offer.quoteIds ? { quoteIds: offer.quoteIds } : { quoteId: offer.quoteId };
  if (!ids.quoteId && !ids.quoteIds) return undefined;
  return {
    tool: 'request_booking',
    args: { ...ids, guestConsent: true, consentHash: offer.consent?.hash },
    why: offer.consent?.summary ? `After the guest approves: "${offer.consent.summary}"` : 'Send the request after the guest approves the price and conditions.',
    needs: ['guest.name', 'guest.email'],
    requiresGuestApproval: true,
  };
};

const wishFromQuery = (q: Json | undefined): Json => {
  if (!q) return {};
  return Object.fromEntries(Object.entries({ checkin: q.checkin, checkout: q.checkout, flexibleDates: q.flexibleDates, guests: q.guests, requirements: q.requirements?.length ? q.requirements : undefined, maxTotalPrice: q.maxTotalPrice, currency: q.currency }).filter(([, v]) => v !== undefined));
};

/** Prefilled follow-up calls for a result; at most four, most useful first. */
export function nextActions(tool: string, args: Json, result: Json): NextAction[] {
  const out: (NextAction | undefined)[] = [];
  switch (tool) {
    case 'search_stays': {
      const results = (result.results ?? []) as Json[];
      for (const r of results.slice(0, 2)) out.push(quoteAction(r.offer));
      if (results[0]) out.push({ tool: 'get_stay_details', args: { propertyId: results[0].propertyId }, why: 'Photos, all facts, reviews and FAQ of the best match.' });
      if (result.pending?.length) out.push({ tool: 'check_availability', args: { propertyId: result.pending[0].propertyId, checkin: args.checkin, checkout: args.checkout, guests: args.guests }, why: 'This booking system answered too late for the time budget.' });
      if (!results.length || results.every((r) => !r.offer && (args.checkin || args.flexibleDates))) {
        out.push({ tool: 'post_stay_wish', args: { area: args.area, country: args.country, near: args.near, ...wishFromQuery(result.query) }, why: 'Nothing fits right now: leave an anonymous stay wish so hosts can make an offer.' });
      }
      break;
    }
    case 'get_stay_details': {
      const unit = (result.units ?? [])[0];
      if (unit) out.push({ tool: 'get_quote', args: { propertyId: result.propertyId, unitId: unit.id }, why: 'Price and conditions for the guest\'s dates.', needs: ['checkin', 'checkout', 'guests'] });
      out.push({ tool: 'answer_question', args: { propertyId: result.propertyId }, why: 'Instant answer to a guest question from confirmed data.', needs: ['question'] });
      out.push({ tool: 'find_available_dates', args: { propertyId: result.propertyId }, why: 'Flexible dates.', needs: ['from', 'to', 'nights'] });
      break;
    }
    case 'get_quote':
      out.push(quoteAction(result));
      if (result.ratePlanOptions?.length > 1) out.push({ tool: 'get_quote', args: { ...args, ratePlanId: '<ratePlanId>' }, why: 'Same stay in another rate plan (see ratePlanOptions).', needs: ['ratePlanId'] });
      break;
    case 'check_availability': {
      const free = ((result.units ?? []) as Json[]).filter((u) => u.status !== 'unavailable');
      for (const u of free.slice(0, 2)) out.push({ tool: 'get_quote', args: { propertyId: result.propertyId, unitId: u.unitId, checkin: result.checkin, checkout: result.checkout, guests: result.guests, rooms: u.rooms > 1 ? u.rooms : undefined }, why: `Price for ${u.name}.` });
      if (!free.length) {
        for (const a of ((result.alternatives ?? []) as Json[]).slice(0, 1)) if (a.quoteId) out.push({ tool: 'get_stay_details', args: { propertyId: a.propertyId }, why: `Free alternative nearby: ${a.name}.` });
        out.push({ tool: 'find_available_dates', args: { propertyId: result.propertyId, guests: result.guests, nights: undefined }, why: 'Other dates at this stay.', needs: ['from', 'to', 'nights'] });
        out.push({ tool: 'join_waitlist', args: { propertyId: result.propertyId, checkin: result.checkin, checkout: result.checkout, guests: result.guests, guestConsent: true }, why: 'Notify the guest when a room frees up.', needs: ['email'], requiresGuestApproval: true });
      }
      break;
    }
    case 'compare_stays':
      for (const row of ((result.rows ?? []) as Json[]).slice(0, 2)) out.push(quoteAction(row.offer));
      break;
    case 'request_booking':
    case 'modify_request':
    case 'ask_host':
    case 'join_waitlist':
    case 'report_data_issue':
      if (result.statusToken) out.push({ tool: 'check_status', args: { statusToken: result.statusToken }, why: 'Follow up later; the host decides or answers.' });
      break;
    case 'answer_question':
      if (result.confidence === 'unknown' || result.confidence === 'partial') out.push({ tool: 'ask_host', args: { propertyId: args.propertyId, question: args.question }, why: 'Part of the answer is unknown; ask the host instead of guessing.' });
      break;
    case 'post_stay_wish':
      if (result.wishToken) out.push({ tool: 'get_wish_offers', args: { wishToken: result.wishToken }, why: 'Offers from hosts arrive over time; matching stays are already listed.' });
      break;
    case 'get_wish_offers':
      for (const o of ((result.offers ?? []) as Json[]).slice(0, 2)) out.push(quoteAction(o));
      break;
  }
  return out.filter((a): a is NextAction => Boolean(a)).map((a) => ({ ...a, args: Object.fromEntries(Object.entries(a.args).filter(([, v]) => v !== undefined)) })).slice(0, 4);
}

// ---------------------------------------------------------------- Brief output

const pick = (o: Json | null | undefined, keys: string[]) => (o ? Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== null).map((k) => [k, o[k]])) : undefined);

/** Criteria grouped by level: the same information as the full list in a fraction of the tokens. */
const criteriaBrief = (criteria: Json[] | undefined) => {
  if (!criteria?.length) return undefined;
  const by: Record<string, string[]> = {};
  for (const c of criteria) (by[c.level] ??= []).push(c.requirement);
  return by;
};

const offerBrief = (offer: Json | null | undefined) =>
  offer
    ? {
        ...pick(offer, ['quoteId', 'quoteIds', 'checkin', 'checkout', 'total', 'currency', 'totalIncludesAllMandatoryCosts', 'priceCertainty', 'bookingMode', 'validUntil', 'holdUntil']),
        consent: offer.consent ? { summary: offer.consent.summary, hash: offer.consent.hash } : undefined,
        warnings: offer.warnings?.length ? offer.warnings : undefined,
      }
    : null;

const factsBrief = (sheet: Json | undefined) => {
  if (!sheet) return undefined;
  const confirmed: Json = {};
  const unconfirmed: Json = {};
  for (const f of sheet.facts ?? []) (f.status === 'confirmed' ? confirmed : unconfirmed)[f.key] = f.unit && typeof f.value === 'number' ? `${f.value} ${f.unit}` : f.value;
  return { confirmed, unconfirmed: Object.keys(unconfirmed).length ? unconfirmed : undefined, unknown: sheet.unknown?.length ? sheet.unknown : undefined };
};

const BRIEF: Record<string, (r: Json) => Json> = {
  search_stays: (r) => ({
    results: (r.results ?? []).map((x: Json) => ({
      ...pick(x, ['propertyId', 'name', 'type', 'location', 'distanceKm', 'matchQuality']),
      unit: x.unit ? pick(x.unit, ['id', 'name', 'rooms']) : undefined,
      rooms: x.rooms?.map((y: Json) => pick(y, ['unitId', 'name', 'guests'])),
      requirements: criteriaBrief(x.criteria),
      rating: x.rating?.average !== undefined ? { average: x.rating.average, count: x.rating.count } : undefined,
      trust: x.trust ? pick(x.trust, ['level', 'websiteVerified', 'flags']) : undefined,
      offer: offerBrief(x.offer),
    })),
    excluded: r.excluded?.length || undefined,
    partial: r.partial,
    pending: r.pending,
  }),
  get_stay_details: (r) => ({
    ...pick(r, ['propertyId', 'name', 'type', 'website', 'currency', 'acceptsDiscountCodes']),
    description: typeof r.description === 'string' && r.description.length > 400 ? `${r.description.slice(0, 400)}…` : r.description,
    place: [r.address?.city, r.address?.region, r.address?.country].filter(Boolean).join(', '),
    facts: factsBrief(r.facts),
    units: (r.units ?? []).map((u: Json) => ({ ...pick(u, ['id', 'name', 'maxGuests', 'roomsOfThisType', 'indicativeRatePerNight']), facts: factsBrief(u.facts) })),
    ratePlans: r.ratePlans?.map((p: Json) => pick(p, ['id', 'name', 'adjustmentPercent', 'refundable'])),
    extras: r.extras?.map((e: Json) => pick(e, ['id', 'name', 'price', 'per'])),
    rating: r.reviews?.count ? { average: r.reviews.average, count: r.reviews.count } : undefined,
    faq: r.faq?.length ? r.faq.length : undefined,
    host: r.host ? pick(r.host, ['medianResponseHours', 'instantBooking']) : undefined,
    trust: r.trust ? pick(r.trust, ['level', 'websiteVerified', 'flags']) : undefined,
    passport: r.passport ? pick(r.passport, ['lastVerifiedAt', 'staleFacts']) : undefined,
    contentSafety: r.contentSafety,
  }),
  get_quote: (r) => ({
    ...offerBrief(r),
    unitId: r.unitId,
    rooms: r.rooms,
    ratePlanId: r.ratePlanId,
    lines: r.lines?.map((l: Json) => ({ label: l.label, amount: l.amount })),
    cancellationCosts: r.cancellationCosts,
    ratePlanOptions: r.ratePlanOptions?.map((p: Json) => pick(p, ['ratePlanId', 'name', 'total', 'refundable', 'selected'])),
  }),
  check_availability: (r) => ({
    ...pick(r, ['propertyId', 'checkin', 'checkout']),
    units: (r.units ?? []).map((u: Json) => pick(u, ['unitId', 'name', 'status', 'certainty', 'rooms', 'roomsLeft', 'fewLeft'])),
    alternatives: r.alternatives?.length ? r.alternatives : undefined,
  }),
  compare_stays: (r) => ({
    rows: (r.rows ?? []).map((x: Json) => ({ ...pick(x, ['propertyId', 'name', 'available', 'unknownCriticalFacts']), requirements: criteriaBrief(x.criteria), offer: offerBrief(x.offer) })),
  }),
};

export const BRIEF_TOOLS = Object.keys(BRIEF);

/** The agent-facing result: brief when asked, plus next actions and freshness. */
export function shapeResult(tool: string, args: Json, result: unknown): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const full = result as Json;
  const actions = nextActions(tool, args ?? {}, full);
  const body = args?.detail === 'brief' && BRIEF[tool] ? BRIEF[tool](full) : full;
  return { ...body, nextActions: actions.length ? actions : undefined, freshness: VALID_FOR[tool] ? freshness(tool, full) : undefined };
}
