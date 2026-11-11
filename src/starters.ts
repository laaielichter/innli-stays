import { suggestFact } from './domain/facts.ts';
import type { Property, PropertyType } from './domain/types.ts';
import { createUnit } from './properties.ts';

/**
 * Starter packs for small owners. Someone with one campervan or two guest
 * rooms should not face sixty empty questions: a pack fills the passport with
 * what is usual for that kind of business, and gives the rooms or vehicles a
 * sensible shape.
 *
 * Nothing a pack fills in counts as the owner's word. Every value is stored
 * as a suggestion (status unconfirmed, source "starter"), and a suggestion
 * never replaces a fact the owner confirmed. The owner reads each one in the
 * passport and presses "Correct", or changes it. Prices are never suggested.
 */
export interface StarterPack {
  id: string;
  type: PropertyType;
  name: { nl: string; en: string };
  summary: { nl: string; en: string };
  facts: Record<string, unknown>;
  units: { name: { nl: string; en: string }; maxGuests: number; includedGuests: number; facts: Record<string, unknown> }[];
}

const stay = {
  'checkin.from': '15:00',
  'checkin.until': '20:00',
  'checkout.until': '11:00',
  'policy.minNights': 1,
  'policy.childrenWelcome': true,
  'rules.smokingAllowed': false,
  'rules.partiesAllowed': false,
  'rules.quietHours': '22:00-07:00',
  'pets.dogsAllowed': false,
};
const rental = {
  'rental.pickupFrom': '14:00',
  'rental.returnUntil': '10:00',
  'rental.minDriverAge': 23,
  'rental.minLicenceYears': 2,
  'rental.insuranceIncluded': true,
  'rental.unlimitedKm': false,
  'rental.kmIncludedPerDay': 150,
  'rental.abroadAllowed': true,
  'policy.minNights': 3,
  'policy.childrenWelcome': true,
  'rules.smokingAllowed': false,
  'pets.dogsAllowed': false,
};

export const STARTER_PACKS: StarterPack[] = [
  {
    id: 'bnb-two-rooms',
    type: 'bnb',
    name: { nl: 'B&B met twee kamers', en: 'B&B with two rooms' },
    summary: { nl: 'Twee tweepersoonskamers met eigen badkamer, ontbijt inbegrepen.', en: 'Two double rooms with a private bathroom, breakfast included.' },
    facts: { ...stay, 'breakfast.included': true, 'breakfast.available': true, 'breakfast.times': '08:00-10:00', 'parking.onSite': true, 'parking.free': true },
    units: [
      { name: { nl: 'Kamer 1', en: 'Room 1' }, maxGuests: 2, includedGuests: 2, facts: { 'unit.privateBathroom': true } },
      { name: { nl: 'Kamer 2', en: 'Room 2' }, maxGuests: 2, includedGuests: 2, facts: { 'unit.privateBathroom': true } },
    ],
  },
  {
    id: 'holiday-home',
    type: 'holiday_home',
    name: { nl: 'Eén vakantiewoning', en: 'One holiday home' },
    summary: { nl: 'Een hele woning voor vier personen, zonder ontbijt, minimaal twee nachten.', en: 'A whole home for four, no breakfast, at least two nights.' },
    facts: { ...stay, 'checkin.from': '16:00', 'checkout.until': '10:00', 'policy.minNights': 2, 'breakfast.included': false, 'breakfast.available': false, 'parking.onSite': true, 'parking.free': true },
    units: [{ name: { nl: 'De woning', en: 'The home' }, maxGuests: 4, includedGuests: 4, facts: { 'unit.privateBathroom': true } }],
  },
  {
    id: 'camper-one-van',
    type: 'camper_rental',
    name: { nl: 'Eén buscamper', en: 'One campervan' },
    summary: { nl: 'Een buscamper voor twee, te rijden met rijbewijs B.', en: 'A campervan for two, driven on a car licence.' },
    facts: rental,
    units: [
      {
        name: { nl: 'Buscamper', en: 'Campervan' },
        maxGuests: 2,
        includedGuests: 2,
        facts: { 'vehicle.type': 'campervan', 'vehicle.beltedSeats': 2, 'vehicle.licenceCategory': 'B', 'vehicle.fuel': 'diesel', 'vehicle.kitchen': true, 'vehicle.heating': true },
      },
    ],
  },
  {
    id: 'camper-one-family',
    type: 'camper_rental',
    name: { nl: 'Eén gezinscamper', en: 'One family motorhome' },
    summary: { nl: 'Een camper voor vier met toilet en douche, te rijden met rijbewijs B.', en: 'A motorhome for four with toilet and shower, driven on a car licence.' },
    facts: rental,
    units: [
      {
        name: { nl: 'Gezinscamper', en: 'Family motorhome' },
        maxGuests: 4,
        includedGuests: 4,
        facts: { 'vehicle.type': 'motorhome', 'vehicle.beltedSeats': 4, 'vehicle.licenceCategory': 'B', 'vehicle.fuel': 'diesel', 'vehicle.toilet': true, 'vehicle.shower': true, 'vehicle.kitchen': true, 'vehicle.heating': true },
      },
    ],
  },
];

export const getStarterPack = (id: string | undefined) => STARTER_PACKS.find((p) => p.id === id);

const EVIDENCE = { nl: 'Voorstel uit het startpakket: gebruikelijk voor dit soort verhuur. Pas aan of bevestig.', en: 'Suggested by the starter pack: usual for this kind of business. Change it or confirm it.' };

/**
 * Fills a property from a pack. Facts become suggestions; units are added only
 * when `addUnits` is set (a new property), each at `ratePerNight`.
 * Returns how many suggestions were stored.
 */
export function applyStarterPack(property: Property, pack: StarterPack, opts: { lang?: string; addUnits?: boolean; ratePerNight?: number } = {}): { suggested: number; unitsAdded: number } {
  const lang = opts.lang === 'nl' ? 'nl' : 'en';
  let suggested = 0;
  const suggest = (facts: Property['facts'], values: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(values)) if (suggestFact(facts, key, value, 'starter', EVIDENCE[lang])) suggested++;
  };
  suggest(property.facts, pack.facts);
  let unitsAdded = 0;
  if (opts.addUnits) {
    for (const u of pack.units) {
      const unit = createUnit({ name: u.name[lang], maxGuests: u.maxGuests, includedGuests: u.includedGuests, baseRatePerNight: opts.ratePerNight ?? 0 });
      suggest(unit.facts, u.facts);
      property.units.push(unit);
      unitsAdded++;
    }
  } else {
    // An existing property: suggest the unit facts on the units it already has, in order.
    pack.units.forEach((u, i) => property.units[i] && suggest(property.units[i].facts, u.facts));
  }
  return { suggested, unitsAdded };
}
