import { readFact } from './facts.ts';
import type { Driver, Guests, Property, Quote, Unit } from './types.ts';

/**
 * Camper rental. A camper is booked like a room (dates, a party, a price),
 * but a rental company has to know things a B&B never asks: who drives, with
 * which licence, how far, and what happens to the deposit. This module turns
 * the rental facts of the passport into what an agent needs before it asks.
 *
 * As everywhere in INNLI, a rule the company did not state is unknown, not
 * absent: an agent is told to ask instead of assuming there is no age limit.
 */

export const isCamperRental = (property: Property) => property.type === 'camper_rental';

/** Licence categories, lightest first. A heavier licence covers the lighter vehicles. */
const LICENCE_ORDER = ['B', 'C1', 'C'];

type Known<T> = { value: T | null; status: 'confirmed' | 'unconfirmed' | 'unknown' };
function fact<T>(facts: Property['facts'], key: string): Known<T> {
  const f = readFact(facts, key);
  return { value: (f.value ?? null) as T | null, status: f.value === null || f.value === undefined ? 'unknown' : f.status === 'confirmed' ? 'confirmed' : 'unconfirmed' };
}

export interface DriverCheck {
  /** true = meets every rule the company confirmed; false = breaks one; null = cannot be said yet. */
  eligible: boolean | null;
  /** Rules the driver breaks, in plain words. */
  reasons: string[];
  /** What the agent still has to ask the guest, or the company. */
  needs: string[];
}

/** Does this driver, with this party, fit this vehicle and this company's rules? */
export function checkDriver(property: Property, unit: Unit, driver: Driver | undefined, guests: Guests): DriverCheck {
  const reasons: string[] = [];
  const needs: string[] = [];
  const minAge = fact<number>(property.facts, 'rental.minDriverAge');
  const minYears = fact<number>(property.facts, 'rental.minLicenceYears');
  const category = fact<string>(unit.facts, 'vehicle.licenceCategory');
  const seats = fact<number>(unit.facts, 'vehicle.beltedSeats');

  const people = guests.adults + guests.children;
  if (seats.value !== null && people > seats.value) reasons.push(`${unit.name} has ${seats.value} seats with a seat belt; the party is ${people}.`);
  else if (seats.value === null) needs.push('Ask the rental company how many seats have a seat belt.');

  if (!driver) {
    needs.push("The driver's age and driving licence (category and years held): pass them as `driver`.");
  } else {
    if (minAge.value !== null && driver.age < minAge.value) reasons.push(`The driver must be at least ${minAge.value}; this driver is ${driver.age}.`);
    else if (minAge.value === null) needs.push('The company has not stated a minimum driver age: ask before booking.');

    if (minYears.value !== null) {
      if (driver.licenceYears === undefined) needs.push(`How many years the driver has held a licence (at least ${minYears.value} are needed).`);
      else if (driver.licenceYears < minYears.value) reasons.push(`The driver must have held a licence for at least ${minYears.value} years; this driver has ${driver.licenceYears}.`);
    }

    if (category.value !== null) {
      const needed = LICENCE_ORDER.indexOf(String(category.value).toUpperCase());
      const held = driver.licenceCategory ? LICENCE_ORDER.indexOf(driver.licenceCategory.toUpperCase()) : -1;
      if (!driver.licenceCategory) needs.push(`Which licence the driver holds (this vehicle needs category ${category.value}).`);
      else if (needed >= 0 && held < needed) reasons.push(`${unit.name} needs a category ${category.value} licence; the driver holds ${driver.licenceCategory}.`);
    } else needs.push('The company has not stated which driving licence this vehicle needs: ask before booking.');
  }
  return { eligible: reasons.length ? false : needs.length ? null : true, reasons, needs };
}

/** The rental terms of a quote: everything a guest agrees to besides the price. */
export function rentalTerms(property: Property, unit: Unit, quote: Pick<Quote, 'nights' | 'guests'>, driver?: Driver) {
  const p = property.facts;
  const u = unit.facts;
  const days = quote.nights;
  const unlimited = fact<boolean>(p, 'rental.unlimitedKm');
  const perDay = fact<number>(p, 'rental.kmIncludedPerDay');
  const extraKm = fact<number>(p, 'rental.pricePerExtraKm');
  const deposit = fact<number>(p, 'rental.securityDeposit');
  const insured = fact<boolean>(p, 'rental.insuranceIncluded');
  const deductible = fact<number>(p, 'rental.insuranceDeductible');
  const watched: [string, Known<unknown>][] = [
    ['rental.securityDeposit', deposit],
    ['rental.insuranceIncluded', insured],
    ['rental.insuranceDeductible', deductible],
    ['rental.minDriverAge', fact(p, 'rental.minDriverAge')],
    ['vehicle.licenceCategory', fact(u, 'vehicle.licenceCategory')],
    ['vehicle.beltedSeats', fact(u, 'vehicle.beltedSeats')],
  ];
  // Kilometres are known when the company says "unlimited", or gives a number.
  if (unlimited.value !== true) watched.push(['rental.kmIncludedPerDay', perDay], ['rental.pricePerExtraKm', extraKm]);
  return {
    vehicle: {
      type: fact<string>(u, 'vehicle.type').value,
      sleeps: unit.maxGuests,
      beltedSeats: fact<number>(u, 'vehicle.beltedSeats').value,
      licenceCategory: fact<string>(u, 'vehicle.licenceCategory').value,
      transmission: fact<string>(u, 'vehicle.transmission').value,
    },
    pickup: { location: fact<string>(p, 'rental.pickupLocation').value, from: fact<string>(p, 'rental.pickupFrom').value },
    return: { until: fact<string>(p, 'rental.returnUntil').value },
    kilometres:
      unlimited.value === true
        ? { unlimited: true }
        : { unlimited: false, includedPerDay: perDay.value, includedForThisRental: perDay.value === null ? null : perDay.value * days, pricePerExtraKm: extraKm.value },
    // Not part of the total: paid at pick-up and returned when the vehicle comes back undamaged.
    securityDeposit: deposit.value,
    insurance: { included: insured.value, deductiblePerClaim: deductible.value },
    driverRules: { minAge: fact<number>(p, 'rental.minDriverAge').value, minLicenceYears: fact<number>(p, 'rental.minLicenceYears').value },
    driver: checkDriver(property, unit, driver, quote.guests),
    abroad: { allowed: fact<boolean>(p, 'rental.abroadAllowed').value, countries: fact<string[]>(p, 'rental.countriesAllowed').value },
    fuelPolicy: fact<string>(p, 'rental.fuelPolicy').value,
    // The honest part: which of these the company did not confirm, and which it did not state at all.
    notConfirmed: watched.filter(([, f]) => f.status === 'unconfirmed').map(([k]) => k),
    unknown: watched.filter(([, f]) => f.status === 'unknown').map(([k]) => k),
  };
}

/** One sentence for the consent summary: what the guest agrees to besides the price. */
export function rentalSentence(property: Property, unit: Unit, quote: Pick<Quote, 'nights' | 'guests' | 'currency'>, money: (n: number) => string): string {
  const r = rentalTerms(property, unit, quote);
  const parts: string[] = [];
  if (r.kilometres.unlimited) parts.push('unlimited kilometres');
  else if (r.kilometres.includedForThisRental !== null && r.kilometres.includedForThisRental !== undefined) parts.push(`${r.kilometres.includedForThisRental} km included${r.kilometres.pricePerExtraKm !== null && r.kilometres.pricePerExtraKm !== undefined ? `, then ${money(r.kilometres.pricePerExtraKm)} per km` : ''}`);
  else parts.push('kilometres included: not stated');
  parts.push(r.securityDeposit !== null ? (r.securityDeposit > 0 ? `a refundable deposit of ${money(r.securityDeposit)} at pick-up` : 'no deposit') : 'deposit: not stated');
  if (r.insurance.included === true) parts.push(`insurance included${r.insurance.deductiblePerClaim !== null ? ` with a deductible of ${money(r.insurance.deductiblePerClaim)} per claim` : ''}`);
  else if (r.insurance.included === false) parts.push('insurance not included');
  else parts.push('insurance: not stated');
  return `Rental terms: ${parts.join('; ')}.`;
}
