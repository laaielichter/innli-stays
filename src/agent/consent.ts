import { createHash } from 'node:crypto';
import { cancellationSchedule } from '../domain/cancellation.ts';
import { readFact } from '../domain/facts.ts';
import type { Property, Quote } from '../domain/types.ts';
import { isCamperRental, rentalSentence, rentalTerms } from '../domain/rental.ts';
import { money } from '../i18n/index.ts';
import { canonical } from '../security/signing.ts';

/**
 * Human approval in one step. An agent shows the guest `summary`, the guest
 * says yes, and the agent passes `hash` to request_booking. If anything the
 * guest agreed to changed in between (price, dates, party, conditions), the
 * hash no longer matches and nothing is sent: the guest never commits to
 * terms they did not see. The hash and summary go into the signed record.
 */
/** The rental terms a guest agrees to; a company that changes its deposit or kilometres changes the hash. */
function rentalConsent(property: Property, quote: Quote) {
  const unit = property.units.find((u) => u.id === quote.unitId);
  if (!unit || !isCamperRental(property)) return undefined;
  const { kilometres, securityDeposit, depositByCreditCardOnly, insurance, driverRules, abroad, fuelPolicy, termsUrl } = rentalTerms(property, unit, quote);
  const { options: _offered, ...cover } = insurance;
  return { kilometres, securityDeposit, depositByCreditCardOnly, insurance: cover, driverRules, abroad, fuelPolicy, termsUrl, driver: quote.driver ?? null, destinations: quote.destinations ?? [] };
}

export function consentTerms(property: Property, quote: Quote) {
  const plan = quote.ratePlanId ? property.ratePlans?.find((p) => p.id === quote.ratePlanId) : undefined;
  const cancellation = plan?.cancellation ?? (readFact(property.facts, 'policy.cancellation').value as string | null) ?? null;
  return {
    propertyId: property.id,
    unitId: quote.unitId,
    rooms: quote.rooms ?? 1,
    checkin: quote.checkin,
    checkout: quote.checkout,
    guests: quote.guests,
    breakfast: quote.breakfast,
    ratePlanId: quote.ratePlanId ?? 'standard',
    refundable: plan ? plan.refundable : true,
    extras: quote.extras ?? [],
    total: quote.total,
    currency: quote.currency,
    totalIncludesAllMandatoryCosts: quote.complete,
    cancellation,
    cancellationRules: property.cancellationRules ?? [],
    // Absent for stays, so their hashes stay what they were.
    ...(isCamperRental(property) ? { rental: rentalConsent(property, quote) } : {}),
  };
}

export function consentHash(property: Property, quotes: Quote[]): string {
  const terms = quotes.map((q) => consentTerms(property, q));
  return `sha256:${createHash('sha256').update(canonical(terms.length === 1 ? terms[0] : terms)).digest('hex')}`;
}

/** One plain sentence per thing the guest commits to. */
export function consentSummary(property: Property, quotes: Quote[]): string {
  const q = quotes[0];
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const total = Math.round(quotes.reduce((s, x) => s + x.total, 0) * 100) / 100;
  const rooms = quotes
    .map((x) => {
      const unit = property.units.find((u) => u.id === x.unitId);
      return `${(x.rooms ?? 1) > 1 ? `${x.rooms} × ` : ''}${unit?.name ?? x.unitId}`;
    })
    .join(' + ');
  const party = `${q.guests.adults} adult${q.guests.adults === 1 ? '' : 's'}${q.guests.children ? `, ${q.guests.children} child${q.guests.children === 1 ? '' : 'ren'}` : ''}${q.guests.dogs ? `, ${q.guests.dogs} dog${q.guests.dogs === 1 ? '' : 's'}` : ''}`;
  const terms = consentTerms(property, q);
  const schedule = cancellationSchedule(property, q);
  const firstFee = schedule.find((s) => s.percent > 0);
  const cancel = !terms.refundable ? 'Non-refundable: cancelling costs the full amount.' : terms.cancellation ? `Cancellation: ${terms.cancellation}` : firstFee?.from ? `Cancellation costs apply from ${firstFee.from}.` : 'Cancellation conditions: not stated by the host; ask before booking.';
  return [
    `${rooms} at ${property.name}, ${fmt(q.checkin)} to ${fmt(q.checkout)} (${q.nights} night${q.nights === 1 ? '' : 's'}), ${party}.`,
    `Total ${money(total, 'en', q.currency)}${q.complete ? ', all mandatory costs included' : '; not all mandatory costs are known yet'}${q.priceCertainty === 'indicative' ? ', indicative until the host confirms' : ''}.`,
    cancel,
    ...quotes.flatMap((x) => {
      const unit = property.units.find((u) => u.id === x.unitId);
      return unit && isCamperRental(property) ? [rentalSentence(property, unit, x, (n) => money(n, 'en', x.currency))] : [];
    }).slice(0, 1),
    // Say exactly what leaves the guest's hands: for a rental that includes who drives.
    isCamperRental(property) && q.driver ? `Name, e-mail and the driver's age and licence details are shared with ${property.name}.` : `Name and e-mail are shared with ${property.name}.`,
  ].join(' ');
}

export function consentFor(property: Property, quotes: Quote[]) {
  return {
    summary: consentSummary(property, quotes),
    hash: consentHash(property, quotes),
    howTo: 'Show the guest this summary. Only after a clear yes: request_booking with guestConsent: true and this consentHash.',
  };
}
