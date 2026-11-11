import { readFact } from './facts.ts';
import { isForeignLicence, JURISDICTION_DISCLAIMER, jurisdictionOf, kmToMiles } from './jurisdictions.ts';
import type { Driver, Extra, Guests, Property, Quote, Unit } from './types.ts';

/**
 * Camper rental. A camper is booked like a room (dates, a party, a price),
 * but a rental company has to know things a B&B never asks: who drives, with
 * which licence, how far and where to, how the vehicle is insured, and what
 * happens to the deposit. This module turns the rental facts of the passport
 * into what an agent needs before it asks, and what an owner needs before
 * renting out.
 *
 * As everywhere in INNLI, a rule the company did not state is unknown, not
 * absent: an agent is told to ask instead of assuming there is no age limit.
 */

export const isCamperRental = (property: Property) => property.type === 'camper_rental';

/**
 * How heavy a vehicle a licence covers: 0 = a car (B), 1 = up to 7,500 kg (C1), 2 = heavier (C).
 * -1 = a licence that does not cover a camper, or one INNLI does not recognise.
 * Trailer variants (BE, C1E, CE) cover what the plain category covers; a bus licence (D) includes B.
 * Names for an ordinary car licence outside Europe count as a car licence.
 */
export const licenceRank = (category: string): number => {
  const c = category.trim().toUpperCase().replace(/[\s.-]/g, '');
  if (/^(B|BE|B96|D1|D1E|D|DE|CAR|REGULAR|STANDARD|ORDINARY|CLASS1|CLASSC|CLASSD|CLASS5|G)$/.test(c)) return 0;
  if (/^(C1|C1E)$/.test(c)) return 1;
  if (/^(C|CE)$/.test(c)) return 2;
  return -1;
};

type Known<T> = { value: T | null; status: 'confirmed' | 'unconfirmed' | 'unknown' };
function fact<T>(facts: Property['facts'], key: string): Known<T> {
  const f = readFact(facts, key);
  // An empty list says nothing: it is not "no country", it is not answered.
  const empty = f.value === null || f.value === undefined || (Array.isArray(f.value) && f.value.length === 0);
  return { value: (empty ? null : f.value) as T | null, status: empty ? 'unknown' : f.status === 'confirmed' ? 'confirmed' : 'unconfirmed' };
}

export interface RuleCheck {
  /** true = meets every rule the company stated; false = breaks one; null = cannot be said yet. */
  ok: boolean | null;
  /** Rules that are broken, in plain words. */
  reasons: string[];
  /** What the agent still has to ask the guest, or the company. */
  needs: string[];
}
export interface DriverCheck extends RuleCheck {
  /** Same as `ok`: kept under this name because agents read it as a question about the driver. */
  eligible: boolean | null;
  /** The part of `needs` that only the guest can answer. A request is not sent while this is not empty. */
  missingFromGuest: string[];
}
const countryOf = (property: Property) => (property.address?.country ?? '').toUpperCase();
const verdict = (reasons: string[], needs: string[]) => (reasons.length ? false : needs.length ? null : true);

/** Does this driver, with this party, fit this vehicle and this company's rules? */
export function checkDriver(property: Property, unit: Unit, driver: Driver | undefined, guests: Guests): DriverCheck {
  const reasons: string[] = [];
  const needs: string[] = [];
  const minAge = fact<number>(property.facts, 'rental.minDriverAge');
  const maxAge = fact<number>(property.facts, 'rental.maxDriverAge');
  const minYears = fact<number>(property.facts, 'rental.minLicenceYears');
  const category = fact<string>(unit.facts, 'vehicle.licenceCategory');
  const seats = fact<number>(unit.facts, 'vehicle.beltedSeats');

  const people = guests.adults + guests.children;
  const missingFromGuest: string[] = [];
  const ask = (text: string) => {
    needs.push(text);
    missingFromGuest.push(text);
  };
  if (seats.value !== null && people > seats.value) reasons.push(`${unit.name} has ${seats.value} seats with a seat belt; the party is ${people}.`);
  else if (seats.value === null) needs.push('Ask the rental company how many seats have a seat belt.');

  if (!driver) {
    ask("The driver's age and driving licence (category, years held, country of issue): pass them as `driver`.");
  } else {
    if (minAge.value !== null && driver.age < minAge.value) reasons.push(`The driver must be at least ${minAge.value}; this driver is ${driver.age}.`);
    else if (minAge.value === null) needs.push('The company has not stated a minimum driver age: ask before booking.');
    if (maxAge.value !== null && driver.age > maxAge.value) reasons.push(`The driver may be at most ${maxAge.value}; this driver is ${driver.age}.`);

    if (minYears.value !== null) {
      if (driver.licenceYears === undefined) ask(`How many years the driver has held a licence (at least ${minYears.value} are needed).`);
      else if (driver.licenceYears < minYears.value) reasons.push(`The driver must have held a licence for at least ${minYears.value} years; this driver has ${driver.licenceYears}.`);
    }

    if (category.value !== null) {
      const needed = licenceRank(String(category.value));
      const held = driver.licenceCategory ? licenceRank(driver.licenceCategory) : -1;
      if (needed < 0) needs.push(`The company states "${category.value}" as the licence needed, which INNLI cannot compare: ask the company before booking.`);
      else if (!driver.licenceCategory) ask(`Which licence the driver holds (this vehicle needs category ${category.value}).`);
      else if (held < needed) reasons.push(`${unit.name} needs a category ${category.value} licence; the driver holds ${driver.licenceCategory}.`);
    } else needs.push('The company has not stated which driving licence this vehicle needs: ask before booking.');

    // A licence from another part of the world: accepted or not is the company's (and its insurer's) call.
    const home = countryOf(property);
    if (driver.licenceCountry && isForeignLicence(driver.licenceCountry, home)) {
      const accepted = fact<boolean>(property.facts, 'rental.foreignLicencesAccepted');
      const idp = fact<boolean>(property.facts, 'rental.idpRequired');
      const from = driver.licenceCountry.toUpperCase();
      if (accepted.value === false) reasons.push(`The company does not accept a driving licence issued in ${from}.`);
      else if (accepted.value === null) needs.push(`Ask the company whether a driving licence issued in ${from} is accepted.`);
      if (accepted.value !== false) {
        if (idp.value === true && driver.hasInternationalPermit === false) reasons.push(`With a licence issued in ${from} the company also needs an international driving permit.`);
        else if (idp.value === true && driver.hasInternationalPermit === undefined) ask('Whether the driver has an international driving permit: the company needs one with this licence.');
        else if (idp.value === null && !driver.hasInternationalPermit) needs.push('Ask the company whether an international driving permit is needed with this licence.');
      }
    }
  }
  const ok = verdict(reasons, needs);
  return { ok, eligible: ok, reasons, needs, missingFromGuest };
}

/** May the vehicle go where the guest wants to drive, and is it insured there? */
export function checkTrip(property: Property, destinations: string[] | undefined): RuleCheck & { destinations: string[] } {
  const reasons: string[] = [];
  const needs: string[] = [];
  const home = countryOf(property);
  const wanted = [...new Set((destinations ?? []).map((c) => c.toUpperCase()))];
  const abroad = wanted.filter((c) => c !== home);
  const allowed = fact<boolean>(property.facts, 'rental.abroadAllowed');
  const countries = fact<string[]>(property.facts, 'rental.countriesAllowed');
  const insured = fact<string[]>(property.facts, 'rental.insuranceCountries');
  const upper = (list: string[] | null) => (list ?? []).map((c) => String(c).toUpperCase());
  if (abroad.length) {
    if (allowed.value === false) reasons.push(`The vehicle may not leave ${home}; the guest wants to drive in ${abroad.join(', ')}.`);
    else {
      if (allowed.value === null && countries.value === null) needs.push(`Ask the company whether the vehicle may be driven in ${abroad.join(', ')}.`);
      const notAllowed = countries.value === null ? [] : abroad.filter((c) => !upper(countries.value).includes(c));
      if (notAllowed.length) reasons.push(`The vehicle may not be driven in ${notAllowed.join(', ')}. Allowed: ${upper(countries.value).join(', ')}.`);
      const notInsured = insured.value === null ? [] : abroad.filter((c) => !upper(insured.value).includes(c));
      if (notInsured.length) reasons.push(`The insurance is not valid in ${notInsured.join(', ')}. Valid in: ${upper(insured.value).join(', ')}.`);
      else if (insured.value === null && !notAllowed.length) needs.push(`Ask the company whether the insurance is valid in ${abroad.join(', ')}.`);
    }
  }
  return { ok: verdict(reasons, needs), reasons, needs, destinations: wanted };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Is the vehicle itself fit to be rented for these dates? */
export function checkVehicle(unit: Unit, checkout: string): RuleCheck {
  const until = fact<string>(unit.facts, 'vehicle.inspectionValidUntil').value;
  if (until && !ISO_DATE.test(until)) return { ok: false, reasons: [`The roadworthiness inspection date of ${unit.name} cannot be read ("${until}"); the company has to correct it first.`], needs: [] };
  if (until && until < checkout) {
    return { ok: false, reasons: [`The roadworthiness inspection of ${unit.name} is valid until ${until}; this rental ends on ${checkout}.`], needs: [] };
  }
  return { ok: true, reasons: [], needs: [] };
}

/** Insurance packages are paid options with an `insurance` block. */
export const insuranceOptions = (property: Property): Extra[] => (property.extras ?? []).filter((e) => e.insurance);
export function chosenInsurance(property: Property, extras: Quote['extras']): Extra | undefined {
  return insuranceOptions(property).find((e) => extras?.some((x) => x.id === e.id));
}

type RentalQuote = Pick<Quote, 'nights' | 'guests'> & Partial<Pick<Quote, 'extras' | 'checkout' | 'destinations'>>;

/** The rental terms of a quote: everything a guest agrees to besides the price. */
export function rentalTerms(property: Property, unit: Unit, quote: RentalQuote, driver?: Driver) {
  const p = property.facts;
  const u = unit.facts;
  const days = quote.nights;
  const place = jurisdictionOf(countryOf(property));
  const unlimited = fact<boolean>(p, 'rental.unlimitedKm');
  const perDay = fact<number>(p, 'rental.kmIncludedPerDay');
  const extraKm = fact<number>(p, 'rental.pricePerExtraKm');
  const deposit = fact<number>(p, 'rental.securityDeposit');
  const insured = fact<boolean>(p, 'rental.insuranceIncluded');
  const deductible = fact<number>(p, 'rental.insuranceDeductible');
  const liability = fact<boolean>(p, 'rental.liabilityIncluded');
  const card = fact<boolean>(p, 'rental.creditCardRequired');
  const mass = fact<number>(u, 'vehicle.maxMassKg');
  const plan = chosenInsurance(property, quote.extras);
  const watched: [string, Known<unknown>][] = [
    ['rental.securityDeposit', deposit],
    ['rental.insuranceIncluded', insured],
    ['rental.insuranceDeductible', deductible],
    ['rental.liabilityIncluded', liability],
    ['rental.creditCardRequired', card],
    ['rental.minDriverAge', fact(p, 'rental.minDriverAge')],
    ['vehicle.licenceCategory', fact(u, 'vehicle.licenceCategory')],
    ['vehicle.beltedSeats', fact(u, 'vehicle.beltedSeats')],
  ];
  // Kilometres are known when the company says "unlimited", or gives a number.
  if (unlimited.value !== true) watched.push(['rental.kmIncludedPerDay', perDay], ['rental.pricePerExtraKm', extraKm]);
  const included = perDay.value === null ? null : perDay.value * days;
  const trip = checkTrip(property, quote.destinations);
  const vehicle = quote.checkout ? checkVehicle(unit, quote.checkout) : { ok: true, reasons: [], needs: [] };
  return {
    vehicle: {
      type: fact<string>(u, 'vehicle.type').value,
      sleeps: unit.maxGuests,
      beltedSeats: fact<number>(u, 'vehicle.beltedSeats').value,
      licenceCategory: fact<string>(u, 'vehicle.licenceCategory').value,
      maxMassKg: mass.value,
      transmission: fact<string>(u, 'vehicle.transmission').value,
      ...(vehicle.ok === false ? { notRentable: vehicle.reasons } : {}),
    },
    pickup: { location: fact<string>(p, 'rental.pickupLocation').value, from: fact<string>(p, 'rental.pickupFrom').value },
    return: { until: fact<string>(p, 'rental.returnUntil').value },
    kilometres: (unlimited.value === true
        ? { unlimited: true }
        : {
            unlimited: false,
            includedPerDay: perDay.value,
            includedForThisRental: included,
            pricePerExtraKm: extraKm.value,
            // Where people think in miles, say it in miles too.
            ...(place.distanceUnit === 'mi' && included !== null ? { includedMilesForThisRental: kmToMiles(included) } : {}),
          }) as { unlimited: boolean; includedPerDay?: number | null; includedForThisRental?: number | null; pricePerExtraKm?: number | null; includedMilesForThisRental?: number },
    // Not part of the total: paid at pick-up and returned when the vehicle comes back undamaged.
    securityDeposit: plan?.insurance?.securityDeposit ?? deposit.value,
    depositByCreditCardOnly: card.value,
    insurance: {
      included: insured.value,
      liabilityIncluded: liability.value,
      // What the guest pays at most per claim, with the package they chose.
      deductiblePerClaim: plan?.insurance ? plan.insurance.deductible : deductible.value,
      chosen: plan?.id ?? null,
      // Packages that lower the risk; add one to `extras` only when the guest wants it.
      options: insuranceOptions(property).map((e) => ({ id: e.id, name: e.name, price: e.price, per: e.per, deductiblePerClaim: e.insurance!.deductible, securityDeposit: e.insurance!.securityDeposit ?? deposit.value, covers: e.insurance!.covers })),
      validIn: fact<string[]>(p, 'rental.insuranceCountries').value,
      roadsideAssistance: fact<boolean>(p, 'rental.roadsideAssistance').value,
    },
    driverRules: {
      minAge: fact<number>(p, 'rental.minDriverAge').value,
      maxAge: fact<number>(p, 'rental.maxDriverAge').value,
      minLicenceYears: fact<number>(p, 'rental.minLicenceYears').value,
      foreignLicencesAccepted: fact<boolean>(p, 'rental.foreignLicencesAccepted').value,
      internationalPermitNeeded: fact<boolean>(p, 'rental.idpRequired').value,
    },
    driver: checkDriver(property, unit, driver, quote.guests),
    abroad: { allowed: fact<boolean>(p, 'rental.abroadAllowed').value, countries: fact<string[]>(p, 'rental.countriesAllowed').value },
    // Only when the guest said where they want to drive.
    trip: trip.destinations.length ? trip : undefined,
    fuelPolicy: fact<string>(p, 'rental.fuelPolicy').value,
    termsUrl: fact<string>(p, 'rental.termsUrl').value,
    atPickup: {
      licenceAndIdentityChecked: fact<boolean>(p, 'rental.idCheckAtPickup').value,
      damageReport: fact<boolean>(p, 'rental.handoverReport').value,
      emergencyPhone: fact<string>(p, 'rental.emergencyPhone').value,
    },
    pricesIncludeVat: fact<boolean>(p, 'rental.pricesIncludeVat').value,
    // What is usual in this country. Never a substitute for the company's own answer.
    jurisdiction: { country: countryOf(property), distanceUnit: place.distanceUnit, carLicence: place.licenceNote, disclaimer: JURISDICTION_DISCLAIMER },
    // The honest part: which of these the company did not confirm, and which it did not state at all.
    notConfirmed: watched.filter(([, f]) => f.status === 'unconfirmed').map(([k]) => k),
    unknown: watched.filter(([, f]) => f.status === 'unknown').map(([k]) => k),
  };
}

/** Why a request for this quote cannot be sent, if it cannot. */
export function rentalBlockers(property: Property, unit: Unit, quote: Quote): { code: 'DRIVER_NOT_ELIGIBLE' | 'RENTAL_NOT_POSSIBLE' | 'INVALID_INPUT'; message: string } | undefined {
  const driver = checkDriver(property, unit, quote.driver, quote.guests);
  if (driver.ok === false) return { code: 'DRIVER_NOT_ELIGIBLE', message: driver.reasons.join(' ') };
  // "Cannot be said yet" because the guest did not say: ask the guest, do not send the request.
  if (driver.missingFromGuest.length) return { code: 'INVALID_INPUT', message: `Before this can be requested, ask the guest: ${driver.missingFromGuest.join(' ')} Then get a fresh quote with the complete driver.` };
  const other = [...checkVehicle(unit, quote.checkout).reasons, ...checkTrip(property, quote.destinations).reasons];
  if (other.length) return { code: 'RENTAL_NOT_POSSIBLE', message: other.join(' ') };
  return undefined;
}

/** What only the company can answer for this rental; such a request is never confirmed automatically. */
export function rentalOpenQuestions(property: Property, unit: Unit, quote: Pick<Quote, 'driver' | 'guests' | 'destinations'>): string[] {
  const driver = checkDriver(property, unit, quote.driver, quote.guests);
  return [...driver.needs.filter((n) => !driver.missingFromGuest.includes(n)), ...checkTrip(property, quote.destinations).needs];
}

/** One sentence for the consent summary: what the guest agrees to besides the price. */
export function rentalSentence(property: Property, unit: Unit, quote: RentalQuote, money: (n: number) => string): string {
  const r = rentalTerms(property, unit, quote);
  const parts: string[] = [];
  if (r.kilometres.unlimited) parts.push('unlimited kilometres');
  else if (r.kilometres.includedForThisRental !== null && r.kilometres.includedForThisRental !== undefined) parts.push(`${r.kilometres.includedForThisRental} km included${r.kilometres.pricePerExtraKm !== null && r.kilometres.pricePerExtraKm !== undefined ? `, then ${money(r.kilometres.pricePerExtraKm)} per km` : ''}`);
  else parts.push('kilometres included: not stated');
  parts.push(r.securityDeposit !== null ? (r.securityDeposit > 0 ? `a refundable deposit of ${money(r.securityDeposit)} at pick-up${r.depositByCreditCardOnly ? " (credit card in the driver's name)" : ''}` : 'no deposit') : 'deposit: not stated');
  const pack = r.insurance.chosen ? insuranceOptions(property).find((e) => e.id === r.insurance.chosen)?.name : undefined;
  if (r.insurance.included === true || pack) parts.push(`${pack ? `insurance "${pack}"` : 'insurance included'}${r.insurance.deductiblePerClaim !== null ? ` with a deductible of ${money(r.insurance.deductiblePerClaim)} per claim` : ''}`);
  else if (r.insurance.included === false) parts.push('insurance not included');
  else parts.push('insurance: not stated');
  if (r.trip?.destinations.length) parts.push(`driving in ${r.trip.destinations.join(', ')}`);
  if (r.termsUrl) parts.push(`the company's rental terms apply (${r.termsUrl})`);
  return `Rental terms: ${parts.join('; ')}.`;
}

export interface ReadinessItem {
  key: string;
  /** done = confirmed by the owner; open = not answered or not confirmed; problem = answered in a way that stops renting. */
  state: 'done' | 'open' | 'problem';
  what: string;
  why: string;
}

const READINESS_NL: Record<string, string> = {
  'Your insurer covers renting out to others': 'Je verzekeraar dekt verhuur aan anderen',
  'An ordinary motorhome policy usually excludes rental. Without rental cover a claim can be refused, and you may be driving renters around uninsured.': 'Een gewone camperverzekering sluit verhuur meestal uit. Zonder verhuurdekking kan een schade worden geweigerd en rijdt je huurder mogelijk onverzekerd.',
  'Third-party liability insurance is in place': 'Er is een aansprakelijkheidsverzekering (WA)',
  'Liability insurance for the vehicle is compulsory in nearly every country.': 'Een WA-verzekering voor het voertuig is in bijna elk land verplicht.',
  'Your rental terms are online': 'Je huurvoorwaarden staan online',
  'The renter agrees to your terms before paying. Agents pass the link on, and it is recorded with the booking.': 'De huurder gaat akkoord met je voorwaarden voordat hij betaalt. Agents geven de link door en hij wordt bij de boeking vastgelegd.',
  'Minimum driver age': 'Minimumleeftijd bestuurder',
  'Your insurer sets it. A younger driver is not insured.': 'Je verzekeraar bepaalt die. Een jongere bestuurder is niet verzekerd.',
  'Security deposit': 'Borg',
  'The renter must know the amount before booking.': 'De huurder moet het bedrag kennen voordat hij boekt.',
  'Deductible per claim': 'Eigen risico per schade',
  'What the renter pays at most when something happens must be clear before booking.': 'Wat de huurder hoogstens betaalt als er iets gebeurt, moet vóór het boeken duidelijk zijn.',
  'You check licence and identity at pick-up': 'Je controleert rijbewijs en identiteit bij het ophalen',
  'Handing a vehicle to someone without a valid licence can make you liable.': 'Een voertuig meegeven aan iemand zonder geldig rijbewijs kan je aansprakelijk maken.',
  'A damage report at pick-up and return': 'Een schaderapport bij ophalen en inleveren',
  'Without one, a dispute about damage cannot be settled.': 'Zonder rapport is een geschil over schade niet op te lossen.',
  'A phone number for breakdown or damage': 'Een telefoonnummer bij pech of schade',
  'Renters need to reach someone while on the road.': 'Huurders moeten onderweg iemand kunnen bereiken.',
  'Countries where the insurance is valid': 'Landen waar de verzekering geldt',
  'Agents refuse a trip to a country your insurance does not cover.': 'Agents weigeren een reis naar een land waar je verzekering niet geldt.',
  'Whether your prices include VAT': 'Of je prijzen inclusief btw zijn',
  'Consumers must see the price they will actually pay.': 'Consumenten moeten de prijs zien die ze echt betalen.',
  'roadworthiness inspection valid': 'keuring (APK) geldig',
  'A vehicle without a valid inspection may not be on the road, and is often not insured.': 'Een voertuig zonder geldige keuring mag de weg niet op en is vaak niet verzekerd.',
  'driving licence needed': 'vereist rijbewijs',
  'Agents refuse a driver without the right licence.': 'Agents weigeren een bestuurder zonder het juiste rijbewijs.',
  'seats with a seat belt': 'zitplaatsen met gordel',
  'No more people may travel than there are belted seats.': 'Er mogen niet meer mensen mee dan er zitplaatsen met gordel zijn.',
  'maximum authorised mass': 'toegestane maximummassa',
  'It decides which licence is needed.': 'Die bepaalt welk rijbewijs nodig is.',
  'check the licence needed': 'controleer het vereiste rijbewijs',
};

/**
 * What a rental company has to have in order before it rents out: the things
 * that make a rental lawful and insured in most countries. INNLI cannot check
 * any of them; it asks the owner to confirm each one, and does not show the
 * company to agents until the ones marked `required` are confirmed.
 */
export function rentalReadiness(property: Property, lang: string = 'en', today = new Date().toISOString().slice(0, 10)): { ready: boolean; items: (ReadinessItem & { required: boolean })[]; disclaimer: string } {
  const place = jurisdictionOf(countryOf(property));
  const tr = (text: string) => (lang === 'nl' ? (READINESS_NL[text] ?? text) : text);
  const items: (ReadinessItem & { required: boolean })[] = [];
  const confirmed = (facts: Property['facts'], key: string) => readFact(facts, key).status === 'confirmed';
  const add = (required: boolean, key: string, facts: Property['facts'], what: string, why: string, problem?: (value: unknown) => boolean) => {
    const value = readFact(facts, key).value;
    const state: ReadinessItem['state'] = !confirmed(facts, key) || value === null || (Array.isArray(value) && value.length === 0) ? 'open' : problem?.(value) ? 'problem' : 'done';
    const [name, rest] = what.includes(': ') ? [what.slice(0, what.indexOf(': ') + 2), what.slice(what.indexOf(': ') + 2)] : ['', what];
    items.push({ key, state, what: name + tr(rest), why: tr(why), required });
  };
  const p = property.facts;
  add(true, 'rental.rentalUseInsured', p, 'Your insurer covers renting out to others', 'An ordinary motorhome policy usually excludes rental. Without rental cover a claim can be refused, and you may be driving renters around uninsured.', (v) => v !== true);
  add(true, 'rental.liabilityIncluded', p, 'Third-party liability insurance is in place', 'Liability insurance for the vehicle is compulsory in nearly every country.', (v) => v !== true);
  add(true, 'rental.termsUrl', p, 'Your rental terms are online', 'The renter agrees to your terms before paying. Agents pass the link on, and it is recorded with the booking.');
  add(true, 'rental.minDriverAge', p, 'Minimum driver age', 'Your insurer sets it. A younger driver is not insured.');
  add(true, 'rental.securityDeposit', p, 'Security deposit', 'The renter must know the amount before booking.');
  add(true, 'rental.insuranceDeductible', p, 'Deductible per claim', 'What the renter pays at most when something happens must be clear before booking.');
  add(false, 'rental.idCheckAtPickup', p, 'You check licence and identity at pick-up', 'Handing a vehicle to someone without a valid licence can make you liable.', (v) => v !== true);
  add(false, 'rental.handoverReport', p, 'A damage report at pick-up and return', 'Without one, a dispute about damage cannot be settled.', (v) => v !== true);
  add(false, 'rental.emergencyPhone', p, 'A phone number for breakdown or damage', 'Renters need to reach someone while on the road.');
  add(false, 'rental.insuranceCountries', p, 'Countries where the insurance is valid', 'Agents refuse a trip to a country your insurance does not cover.');
  add(false, 'rental.pricesIncludeVat', p, 'Whether your prices include VAT', 'Consumers must see the price they will actually pay.');
  for (const unit of property.units) {
    const u = unit.facts;
    add(true, 'vehicle.inspectionValidUntil', u, `${unit.name}: roadworthiness inspection valid`, 'A vehicle without a valid inspection may not be on the road, and is often not insured.', (v) => !ISO_DATE.test(String(v)) || String(v) < today);
    add(true, 'vehicle.licenceCategory', u, `${unit.name}: driving licence needed`, 'Agents refuse a driver without the right licence.');
    add(true, 'vehicle.beltedSeats', u, `${unit.name}: seats with a seat belt`, 'No more people may travel than there are belted seats.');
    add(false, 'vehicle.maxMassKg', u, `${unit.name}: maximum authorised mass`, 'It decides which licence is needed.');
    if (typeof readFact(u, 'vehicle.licenceCategory').value === 'string' && licenceRank(String(readFact(u, 'vehicle.licenceCategory').value)) < 0) {
      items.push({ key: 'vehicle.licenceCategory', state: 'problem', required: true, what: `${unit.name}: ${tr('driving licence needed')}`, why: lang === 'nl' ? 'Gebruik B, C1 of C (of "car" buiten Europa), zonder extra woorden.' : 'Use B, C1 or C (or "car" outside Europe), without other words.' });
    }
    // A stated licence that looks too light for the weight, by the usual rule in this country.
    const mass = readFact(u, 'vehicle.maxMassKg').value;
    const category = readFact(u, 'vehicle.licenceCategory').value;
    if (typeof mass === 'number' && place.carLicenceMaxKg !== null && mass > place.carLicenceMaxKg && typeof category === 'string' && licenceRank(category) === 0) {
      items.push({ key: 'vehicle.licenceCategory', state: 'problem', required: false, what: `${unit.name}: ${tr('check the licence needed')}`, why: lang === 'nl' ? `Je noemt rijbewijs ${category} voor een voertuig van ${mass} kg. In dit land dekt een gewoon autorijbewijs meestal tot ${place.carLicenceMaxKg} kg.` : `You state a ${category} licence for a vehicle of ${mass} kg. ${place.licenceNote}` });
    }
  }
  return { ready: items.every((i) => !i.required || i.state === 'done'), items, disclaimer: lang === 'nl' ? `INNLI kan dit niet controleren: jij bevestigt het. Deze lijst bevat wat in de meeste landen gebruikelijk is en is geen juridisch advies. Vraag je verzekeraar, en waar nodig een jurist, naar de regels in ${countryOf(property) || 'je land'}.` : `INNLI cannot check these: you confirm them. This list covers what is usual in most countries; it is not legal advice. Ask your insurer and, where needed, a lawyer about the rules in ${countryOf(property) || 'your country'}.` };
}
