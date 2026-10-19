import { currentLang, money as fmt, t } from '../i18n/index.ts';
import { readFact } from './facts.ts';
import { bestDiscount, checkinDaysFor, nightPrices, seasonMinNights } from './rates.ts';
import type { AvailabilityResult, BookingMode, Guests, Property, Quote, QuoteLine, Unit } from './types.ts';

/** A choice in the quote input that the property does not offer (rate plan, extra, discount code). */
export class QuoteInputError extends Error {}
/** A rate plan id that the property does not offer. */
export class RatePlanError extends QuoteInputError {}

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export const weekdayNames = (days: number[]) => days.map((d) => t(`day.${WEEKDAY_KEYS[d]}` as Parameters<typeof t>[0])).join(', ');

const QUOTE_TTL_LIVE_MIN = 30;
const QUOTE_TTL_INDICATIVE_MIN = 15;

export interface QuoteInput {
  property: Property;
  unit: Unit;
  checkin: string;
  checkout: string;
  nights: string[];
  guests: Guests;
  breakfast: boolean;
  availability: AvailabilityResult;
  id: string;
  now?: Date;
  /** Identical rooms of this type (default 1). */
  rooms?: number;
  /** Rate plan (default: the standard rate). */
  ratePlanId?: string;
  /** Paid options with quantity. */
  extras?: { id: string; qty?: number }[];
  /** A discount code from the owner. Usage limits are checked by the caller (they need the stored requests). */
  discountCode?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function numberFact(property: Property, key: string): number | null {
  const fact = readFact(property.facts, key);
  return typeof fact.value === 'number' ? fact.value : null;
}

function boolFact(property: Property, key: string): boolean | null {
  const fact = readFact(property.facts, key);
  return typeof fact.value === 'boolean' ? fact.value : null;
}

/**
 * Builds an itemised total price including all mandatory costs.
 *
 * When a mandatory cost is unknown the quote is marked incomplete instead of
 * silently leaving it out — the agent must tell the guest the total may be higher.
 */
export function buildQuote(input: QuoteInput): Quote {
  const { property, unit, nights, guests, availability } = input;
  const money = (amount: number) => fmt(amount, currentLang(), property.currency);
  const now = input.now ?? new Date();
  const lines: QuoteLine[] = [];
  const warnings: string[] = [];
  const issues: string[] = [];
  let complete = true;
  const persons = guests.adults + guests.children;
  const n = nights.length;
  const rooms = Math.max(1, Math.floor(input.rooms ?? 1));
  const plan = input.ratePlanId && input.ratePlanId !== 'standard' ? property.ratePlans?.find((p) => p.id === input.ratePlanId) : undefined;
  if (input.ratePlanId && input.ratePlanId !== 'standard' && !plan) throw new RatePlanError(t('cat.unknownRatePlan', { id: input.ratePlanId, list: ['standard', ...(property.ratePlans ?? []).map((p) => p.id)].join(', ') }));

  // Accommodation: live nightly rates when the booking system gave them, else the owner's rate table.
  const liveRates = availability.certainty === 'live' && availability.nightlyRates?.length === n ? availability.nightlyRates : null;
  const ownerRates = liveRates ? null : nightPrices(unit, nights);
  // Live nightly rates and owner rates are per room.
  const accommodation = rooms * (liveRates ? liveRates.reduce((s, r) => s + r.amount, 0) : ownerRates!.reduce((s, r) => s + r.amount, 0));
  let basis = t('price.liveBasis');
  if (ownerRates) {
    const seasons = [...new Set(ownerRates.map((r) => r.season).filter(Boolean))];
    const weekendNights = ownerRates.filter((r) => r.weekend).length;
    const parts = [seasons.length ? t('price.season', { names: seasons.join(', ') }) : t('price.baseRate', { amount: money(unit.baseRatePerNight) })];
    if (weekendNights && unit.rates?.weekendSupplement) parts.push(t('price.weekend', { amount: money(unit.rates.weekendSupplement), n: weekendNights }));
    basis = t('price.ownerRates', { parts: parts.join(', ') });
  }
  lines.push({ kind: 'accommodation', label: rooms > 1 ? t('price.roomsNights', { rooms, unit: unit.name, n }) : t('price.unitNights', { unit: unit.name, n }), amount: round2(accommodation), basis });
  // Discounts belong to the owner's rate table; a live booking system prices its own discounts.
  const discount = ownerRates ? bestDiscount(unit, input.checkin, n, now.toISOString().slice(0, 10)) : null;
  if (discount && discount.percent > 0) {
    lines.push({ kind: 'discount', label: discount.label, amount: -round2((accommodation * Math.min(discount.percent, 90)) / 100), basis: t('price.discountBasis', { percent: discount.percent }) });
  }

  // Discount code from the owner, on the room price; it stacks with an automatic discount up to 90% in total.
  let code: string | undefined;
  if (input.discountCode?.trim()) {
    const wanted = input.discountCode.trim().toUpperCase();
    const offer = (property.offerCodes ?? []).find((c) => c.code === wanted);
    const dc = offer ?? (property.discountCodes ?? []).find((c) => c.code.toUpperCase() === wanted);
    if (!dc || !dc.active) throw new QuoteInputError(t('price.codeInvalid', { code: input.discountCode.trim() }));
    if (dc.validUntil && input.checkin > dc.validUntil) throw new QuoteInputError(t('price.codeExpired', { code: dc.code, date: dc.validUntil }));
    if (dc.minNights && n < dc.minNights) throw new QuoteInputError(t('price.codeMinNights', { code: dc.code, n: dc.minNights }));
    const already = discount && discount.percent > 0 ? Math.min(discount.percent, 90) : 0;
    const percent = Math.max(0, Math.min(dc.percent, 90 - already));
    if (percent > 0) lines.push({ kind: 'code_discount', label: offer ? t('price.offerLabel') : t('price.codeLabel', { code: dc.code }), amount: -round2((accommodation * percent) / 100), basis: t('price.discountBasis', { percent }) });
    code = dc.code;
  }

  if (plan && plan.adjustmentPercent !== 0) {
    lines.push({ kind: 'rate_plan', label: plan.name, amount: round2((accommodation * plan.adjustmentPercent) / 100), basis: t('price.ratePlanBasis', { percent: plan.adjustmentPercent > 0 ? `+${plan.adjustmentPercent}` : plan.adjustmentPercent }) });
  }

  // One-night stays: the owner's supplement per room.
  const single = ownerRates && n === 1 ? unit.rates?.singleNightSupplement : undefined;
  if (single && single > 0) lines.push({ kind: 'supplement', label: t('price.singleNight'), amount: round2(single * rooms), basis: t('price.perRoom', { amount: money(single) }) });

  const extraGuests = Math.max(0, persons - unit.includedGuests * rooms);
  if (extraGuests > 0) {
    if (unit.extraGuestPerNight === undefined) {
      complete = false;
      warnings.push(t('price.extraGuestUnknown', { n: extraGuests }));
    } else if (unit.extraGuestPerNight > 0) {
      lines.push({ kind: 'extra_guest', label: t('price.extraGuests', { n: extraGuests }), amount: round2(extraGuests * unit.extraGuestPerNight * n), basis: t('price.perGuestNight', { amount: money(unit.extraGuestPerNight) }) });
    }
  }

  const cleaning = numberFact(property, 'fees.cleaningPerStay');
  if (cleaning === null) {
    complete = false;
    warnings.push(t('price.cleaningUnknown'));
  } else if (cleaning > 0) {
    lines.push({ kind: 'fee', label: t('price.cleaning'), amount: round2(cleaning), basis: t('price.perStay') });
  }

  const tax = numberFact(property, 'fees.touristTaxPerPersonPerNight');
  if (tax === null) {
    complete = false;
    warnings.push(t('price.taxUnknown'));
  } else if (tax > 0) {
    const childrenPay = boolFact(property, 'fees.touristTaxAppliesToChildren');
    const taxed = guests.adults + (childrenPay === false ? 0 : guests.children);
    if (guests.children > 0 && childrenPay === null) warnings.push(t('price.taxChildrenAssumed'));
    lines.push({ kind: 'tax', label: t('price.tax'), amount: round2(tax * taxed * n), basis: t('price.taxBasis', { amount: money(tax), n: taxed }) });
  }

  if (guests.dogs > 0) {
    const dogsAllowed = boolFact(property, 'pets.dogsAllowed');
    if (dogsAllowed === false) {
      warnings.push(t('price.noDogs'));
      issues.push('no_dogs');
    }
    const maxDogs = numberFact(property, 'pets.maxDogs');
    if (maxDogs !== null && guests.dogs > maxDogs) {
      warnings.push(t('price.maxDogs', { n: maxDogs }));
      issues.push('max_dogs');
    }
    const fee = numberFact(property, 'pets.feePerDogPerNight');
    if (fee === null) {
      complete = false;
      warnings.push(t('price.dogFeeUnknown'));
    } else if (fee > 0) {
      lines.push({ kind: 'pet', label: t('price.dogs', { n: guests.dogs }), amount: round2(fee * guests.dogs * n), basis: t('price.perDogNight', { amount: money(fee) }) });
    }
  }

  if (plan?.breakfastIncluded) {
    lines.push({ kind: 'breakfast', label: t('price.breakfast'), amount: 0, basis: t('price.includedInRate', { plan: plan.name }) });
  } else if (input.breakfast) {
    const included = boolFact(property, 'breakfast.included');
    if (included === true) {
      lines.push({ kind: 'breakfast', label: t('price.breakfast'), amount: 0, basis: t('price.included') });
    } else {
      const price = numberFact(property, 'breakfast.pricePerPerson');
      if (price === null) {
        complete = false;
        warnings.push(t('price.breakfastUnknown'));
      } else {
        lines.push({ kind: 'breakfast', label: t('price.breakfast'), amount: round2(price * persons * n), basis: t('price.perPersonMorning', { amount: money(price) }) });
      }
    }
  }

  // Paid options the guest chose.
  const chosen: { id: string; qty: number }[] = [];
  for (const sel of input.extras ?? []) {
    const extra = (property.extras ?? []).find((e) => e.id === sel.id);
    if (!extra) throw new QuoteInputError(t('price.unknownExtra', { id: sel.id, list: (property.extras ?? []).map((e) => e.id).join(', ') || '-' }));
    const qty = Math.max(1, Math.floor(sel.qty ?? 1));
    if (qty > (extra.max ?? 1)) throw new QuoteInputError(t('price.extraMax', { name: extra.name, n: extra.max ?? 1 }));
    const factor = { stay: 1, night: n, person: persons, person_night: persons * n, room_night: rooms * n }[extra.per];
    lines.push({ kind: 'extra', label: qty > 1 ? `${qty} × ${extra.name}` : extra.name, amount: round2(extra.price * qty * factor), basis: t(`extra.per.${extra.per}` as Parameters<typeof t>[0], { amount: money(extra.price) }) });
    chosen.push({ id: extra.id, qty });
  }

  // Arrival rules: some owners only take arrivals on certain weekdays (e.g. Saturday to Saturday in summer).
  const arrival = checkinDaysFor(unit, input.checkin);
  if (arrival && !arrival.days.includes(new Date(`${input.checkin}T00:00:00Z`).getUTCDay())) {
    warnings.push(arrival.season ? t('price.checkinDaysSeason', { days: weekdayNames(arrival.days), season: arrival.season }) : t('price.checkinDays', { days: weekdayNames(arrival.days) }));
    issues.push('checkin_day');
  }

  const minNights = numberFact(property, 'policy.minNights');
  if (minNights !== null && n < minNights) {
    warnings.push(t('price.minNights', { n: minNights }));
    issues.push('min_nights');
  }
  const seasonMin = seasonMinNights(unit, nights);
  if (seasonMin && n < seasonMin.minNights && (minNights === null || seasonMin.minNights > minNights)) {
    warnings.push(t('price.seasonMinNights', { season: seasonMin.season, n: seasonMin.minNights }));
    issues.push('min_nights');
  }
  if (persons > unit.maxGuests * rooms) {
    warnings.push(t('price.maxGuests', { unit: unit.name, n: unit.maxGuests * rooms }));
    issues.push('max_guests');
  }

  const priceCertainty = liveRates ? 'live' : 'indicative';
  if (priceCertainty === 'indicative') warnings.push(t('price.indicative'));

  const bookingMode = resolveBookingMode(property, availability);
  const ttl = priceCertainty === 'live' ? QUOTE_TTL_LIVE_MIN : QUOTE_TTL_INDICATIVE_MIN;

  return {
    id: input.id,
    propertyId: property.id,
    unitId: unit.id,
    checkin: input.checkin,
    checkout: input.checkout,
    nights: n,
    rooms: rooms > 1 ? rooms : undefined,
    guests,
    breakfast: input.breakfast || Boolean(plan?.breakfastIncluded),
    ratePlanId: plan?.id,
    extras: chosen.length ? chosen : undefined,
    discountCode: code,
    lines,
    total: round2(lines.reduce((s, l) => s + l.amount, 0)),
    currency: property.currency,
    complete,
    warnings,
    issues,
    priceCertainty,
    availability,
    bookingMode,
    createdAt: now.toISOString(),
    validUntil: new Date(now.getTime() + ttl * 60_000).toISOString(),
  };
}

/**
 * A direct booking link is only offered when availability was checked live and a
 * booking environment exists. Calendar-synced or unconnected properties get an
 * availability request instead — never a booking promise on possibly stale data.
 */
export function resolveBookingMode(property: Property, availability: AvailabilityResult): BookingMode {
  if (availability.certainty === 'live' && availability.status === 'available' && property.booking.deeplinkTemplate) {
    return 'booking_link';
  }
  return 'availability_request';
}
