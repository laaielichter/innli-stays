import { randomBytes } from 'node:crypto';
import { addDays } from '../domain/dates.ts';
import { ownerSetFact, suggestFact } from '../domain/facts.ts';
import type { FactMap, Property } from '../domain/types.ts';
import { hashKey, newKey } from '../http/auth.ts';
import { createProperty, createUnit } from '../properties.ts';
import type { Store } from '../store.ts';
import { seedHotel } from './hotel.ts';
import { seedActivity, seedInternational } from './international.ts';

function confirm(facts: FactMap, values: Record<string, unknown>, verifiedAt = new Date()) {
  for (const [k, v] of Object.entries(values)) ownerSetFact(facts, k, v, verifiedAt);
}

export interface DemoCredentials {
  owners: { property: string; id: string; ownerKey: string }[];
  agentKey: string;
}

/** Three fictional stays that together show confirmed, unverified and unknown data, live vs calendar sync. */
export function seedDemo(store: Store, baseUrl: string, opts: { international?: boolean; hotel?: boolean } = {}): DemoCredentials {
  const engine = `${baseUrl.replace(/\/$/, '')}/demo-engine`;
  const owners: DemoCredentials['owners'] = [];
  const add = (p: Property, ownerKey: string) => {
    store.saveProperty(p);
    owners.push({ property: p.name, id: p.id, ownerKey });
  };

  // 1. Fully verified, live booking system.
  {
    const { property: p, ownerKey } = createProperty({
      name: 'B&B De Hooiberg',
      slug: 'hooiberg',
      type: 'bnb',
      description: 'Kleinschalige B&B in een verbouwde hooiberg aan de rand van de Veluwe, met twee kamers, een grote omheinde tuin en ontbijt met producten uit de streek.',
      address: { street: 'Heideweg 12', postalCode: '6718 AB', city: 'Ede', region: 'Veluwe, Gelderland', country: 'NL' },
    });
    p.id = 'prop_hooiberg';
    p.geo = { lat: 52.0402, lng: 5.6649 };
    p.website = `${engine}/site/hooiberg`;
    // The demo site carries the token (as the WordPress plugin would), so a re-check in the dashboard passes too.
    p.websiteVerification = { token: 'innli-demo-hooiberg', domain: new URL(p.website).hostname, verifiedAt: new Date().toISOString(), method: 'meta' };
    p.contactEmail = 'info@hooiberg.example';
    p.published = true;
    p.booking = {
      connector: { kind: 'live_api', baseUrl: engine },
      deeplinkTemplate: `${engine}/book?property=prop_hooiberg&unit={unit}&checkin={checkin}&checkout={checkout}&adults={adults}&children={children}&dogs={dogs}&ref={ref}`,
    };
    confirm(p.facts, {
      'pets.dogsAllowed': true,
      'pets.maxDogs': 2,
      'pets.feePerDogPerNight': 7.5,
      'pets.rules': 'Honden niet op bed en niet in de ontbijtruimte. Hondenmand en bakjes aanwezig.',
      'garden.present': true,
      'garden.fullyEnclosed': true,
      'garden.shared': false,
      'breakfast.included': true,
      'breakfast.available': true,
      'breakfast.times': '08:00-10:00',
      'breakfast.contents': 'Brood van de bakker in Ede, eieren van eigen kippen, kaas en jam uit de streek.',
      'breakfast.dietsOnRequest': ['vegetarisch', 'glutenvrij', 'lactosevrij'],
      'checkin.from': '15:00',
      'checkin.until': '20:00',
      'checkout.until': '11:00',
      'policy.cancellation': 'Kosteloos annuleren tot 7 dagen voor aankomst; daarna 50% van de verblijfskosten.',
      'policy.minNights': 1,
      'policy.childrenWelcome': true,
      'fees.cleaningPerStay': 0,
      'fees.touristTaxPerPersonPerNight': 2.15,
      'fees.touristTaxAppliesToChildren': false,
      'location.quiet': true,
      'location.noiseSources': 'Overdag af en toe landbouwverkeer; geen doorgaande weg.',
      'parking.onSite': true,
      'parking.free': true,
      'access.stepFreeEntrance': true,
    });
    const tuin = createUnit({ name: 'Tuinkamer', externalRef: 'hooiberg-tuinkamer', description: 'Op de begane grond met eigen terras aan de tuin.', maxGuests: 2, includedGuests: 2, baseRatePerNight: 115 }, 'tuinkamer');
    confirm(tuin.facts, { 'unit.floor': 0, 'unit.privateBathroom': true, 'unit.privateEntrance': true, 'bed.lengthCm': 210, 'bed.widthCm': 180, 'bed.footboard': false, 'access.stepsToUnit': 0, 'access.thresholdFree': true, 'access.doorWidthCm': 90, 'bathroom.walkInShower': true, 'bathroom.grabBars': false, 'unit.noiseNotes': 'Aan de tuinzijde, niet naast de ontbijtruimte.' });
    const zolder = createUnit({ name: 'Zolderkamer', externalRef: 'hooiberg-zolder', description: 'Ruime kamer onder de nok, met uitzicht over de heide.', maxGuests: 3, includedGuests: 2, baseRatePerNight: 95, extraGuestPerNight: 25 }, 'zolderkamer');
    confirm(zolder.facts, { 'unit.floor': 2, 'unit.privateBathroom': true, 'unit.privateEntrance': false, 'bed.lengthCm': 200, 'bed.widthCm': 160, 'bed.footboard': true, 'access.stepsToUnit': 14, 'access.thresholdFree': false, 'bathroom.walkInShower': false });
    p.units.push(tuin, zolder);
    add(p, ownerKey);
  }

  // 2. Partly imported from the website, not yet fully confirmed.
  {
    const { property: p, ownerKey } = createProperty({
      name: 'Logies Het Kraaiennest',
      slug: 'kraaiennest',
      type: 'guesthouse',
      description: 'Houten logeerhuis midden in het bos bij Otterlo, op loopafstand van het Nationaal Park De Hoge Veluwe.',
      address: { street: 'Boslaan 3', postalCode: '6731 BC', city: 'Otterlo', region: 'Veluwe, Gelderland', country: 'NL' },
    });
    p.id = 'prop_kraaiennest';
    p.geo = { lat: 52.1003, lng: 5.7714 };
    p.website = `${engine}/site/kraaiennest`;
    p.contactEmail = 'logies@kraaiennest.example';
    p.published = true;
    p.booking = {
      connector: { kind: 'live_api', baseUrl: engine },
      deeplinkTemplate: `${engine}/book?property=prop_kraaiennest&unit={unit}&checkin={checkin}&checkout={checkout}&adults={adults}&children={children}&dogs={dogs}&ref={ref}`,
    };
    confirm(p.facts, {
      'pets.dogsAllowed': true,
      'pets.maxDogs': 1,
      'pets.feePerDogPerNight': 10,
      'breakfast.included': false,
      'breakfast.available': true,
      'breakfast.pricePerPerson': 14.5,
      'fees.touristTaxPerPersonPerNight': 1.9,
      'location.quiet': true,
      'checkin.from': '16:00',
      'checkout.until': '10:30',
    });
    const site = p.website;
    suggestFact(p.facts, 'garden.present', true, 'website', `${site}: "Grote omheinde tuin aan de bosrand"`);
    suggestFact(p.facts, 'garden.fullyEnclosed', true, 'website', `${site}: "Grote omheinde tuin aan de bosrand"`);
    suggestFact(p.facts, 'parking.onSite', true, 'website', `${site}: "Parkeren op eigen terrein"`);
    const bos = createUnit({ name: 'Boskamer', externalRef: 'kraaiennest-bos', maxGuests: 2, includedGuests: 2, baseRatePerNight: 105 }, 'boskamer');
    confirm(bos.facts, { 'unit.floor': 0, 'unit.privateBathroom': true, 'bed.lengthCm': 200, 'bed.widthCm': 160 });
    p.units.push(bos);
    add(p, ownerKey);
  }

  // 3. Calendar sync only (iCal): availability is indicative, booking via request.
  {
    const { property: p, ownerKey } = createProperty({
      name: 'Pension Duinzicht',
      slug: 'duinzicht',
      type: 'pension',
      description: 'Familiepension op 200 meter van het strand van Egmond aan Zee, met uitzicht op de duinen.',
      address: { street: 'Boulevard 8', postalCode: '1931 CD', city: 'Egmond aan Zee', region: 'Noord-Holland', country: 'NL' },
    });
    p.id = 'prop_duinzicht';
    p.geo = { lat: 52.6205, lng: 4.6262 };
    p.website = 'https://duinzicht.example';
    p.contactEmail = 'pension@duinzicht.example';
    p.published = true;
    p.booking = {
      connector: { kind: 'ical', calendars: { 'kamer-1': `${engine}/calendar/duinzicht-1.ics`, 'kamer-2': `${engine}/calendar/duinzicht-2.ics` } },
    };
    confirm(p.facts, {
      'pets.dogsAllowed': false,
      'breakfast.included': true,
      'breakfast.times': '08:30-10:30',
      'fees.cleaningPerStay': 0,
      'fees.touristTaxPerPersonPerNight': 3.25,
      'policy.cancellation': 'Kosteloos annuleren tot 14 dagen voor aankomst.',
      'policy.minNights': 2,
      'location.quiet': false,
      'location.noiseSources': 'Boulevard met terrassen; in de zomer tot laat in de avond.',
      'parking.onSite': false,
    });
    const k1 = createUnit({ name: 'Kamer Zeezicht', externalRef: 'duinzicht-1', maxGuests: 2, includedGuests: 2, baseRatePerNight: 89 }, 'kamer-1');
    confirm(k1.facts, { 'unit.floor': 1, 'unit.privateBathroom': true, 'bed.lengthCm': 200 });
    const k2 = createUnit({ name: 'Kamer Duin', externalRef: 'duinzicht-2', maxGuests: 3, includedGuests: 2, baseRatePerNight: 99, extraGuestPerNight: 30 }, 'kamer-2');
    const seasons = { weekendSupplement: 15, seasons: [{ name: 'Zomer', from: '06-15', to: '08-31', ratePerNight: 129, minNights: 3 }, { name: 'Kerst', from: '12-20', to: '01-02', ratePerNight: 139, minNights: 2 }] };
    k1.rates = seasons;
    k2.rates = { ...seasons, seasons: seasons.seasons.map((x) => ({ ...x, ratePerNight: x.ratePerNight + 10 })) };
    confirm(k2.facts, { 'unit.floor': 0, 'unit.privateBathroom': true, 'bed.lengthCm': 220, 'access.stepsToUnit': 1 });
    p.units.push(k1, k2);
    add(p, ownerKey);
  }

  if (opts.hotel) owners.push(seedHotel(store));
  if (opts.international) {
    owners.push(...seedInternational(store, engine));
    seedActivity(store, owners.map((o) => o.id));
  }

  // A stay wish from an agent, so "Wanted" in the dashboard shows how hosts can make an offer.
  const from = addDays(new Date().toISOString().slice(0, 10), 30);
  store.saveWish({
    id: 'wish_demo_veluwe',
    token: `wt_${randomBytes(18).toString('base64url')}`,
    agentClient: 'Demo Reisagent',
    area: 'Veluwe',
    flexibleDates: { from, to: addDays(from, 21), pattern: 'long_weekend' },
    guests: { adults: 2, children: 0, dogs: 1 },
    requirements: ['dogs_allowed', 'enclosed_garden'],
    maxTotalPrice: 450,
    currency: 'EUR',
    note: 'Rustig, met een tuin waar de hond los kan. Graag wandelen vanaf de deur.',
    status: 'open',
    createdAt: new Date().toISOString(),
    expiresAt: `${addDays(from, 18)}T23:59:59.000Z`,
  });

  const agentKey = newKey('innli_agt');
  store.saveAgent({ id: 'agt_demo', name: 'Demo Reisagent', keyHash: hashKey(agentKey), createdAt: new Date().toISOString() });
  store.flush();
  return { owners, agentKey };
}
