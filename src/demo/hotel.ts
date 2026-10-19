import { randomBytes, randomUUID } from 'node:crypto';
import { ownerSetFact } from '../domain/facts.ts';
import type { FactMap, Unit } from '../domain/types.ts';
import { createProperty, createUnit } from '../properties.ts';
import type { Store } from '../store.ts';

function confirm(facts: FactMap, values: Record<string, unknown>) {
  for (const [k, v] of Object.entries(values)) ownerSetFact(facts, k, v);
}

/**
 * A fictional 48-room city hotel: room types with several identical rooms,
 * rate plans (flexible, non-refundable, with breakfast), instant booking and
 * a published FAQ for the answer agent. Shows how INNLI handles a busy hotel.
 */
export function seedHotel(store: Store): { property: string; id: string; ownerKey: string } {
  const { property: p, ownerKey } = createProperty({
    name: 'Hotel Het Spaarne',
    slug: 'het-spaarne',
    type: 'hotel',
    description: 'Stadshotel met 48 kamers aan het Spaarne, op vijf minuten lopen van de Grote Markt en het station van Haarlem. Ontbijtbuffet, 24 uur per dag een receptie, fietsverhuur en een eigen parkeergarage.',
    address: { street: 'Spaarne 40', postalCode: '2011 CH', city: 'Haarlem', region: 'Noord-Holland', country: 'NL' },
  });
  p.id = 'prop_spaarne';
  p.published = true;
  p.language = 'nl';
  p.geo = { lat: 52.3812, lng: 4.6403 };
  p.website = 'https://hetspaarne.example';
  p.contactEmail = 'reservations@hetspaarne.example';
  p.booking = { connector: { kind: 'manual' } };
  p.bookingRules = { instantBooking: true, minLeadDays: 0, maxNights: 21, holdHours: 12, autoAnswer: true };
  p.ratePlans = [
    { id: 'non-refundable', name: 'Niet-restitueerbaar', adjustmentPercent: -12, refundable: false, cancellation: 'Niet kosteloos te annuleren of te wijzigen; het volledige bedrag is verschuldigd.' },
    { id: 'breakfast', name: 'Inclusief ontbijt', adjustmentPercent: 14, refundable: true, breakfastIncluded: true },
  ];
  p.extras = [
    { id: 'fiets', name: 'Fietshuur', description: 'Stadsfiets met slot, op te halen bij de receptie.', price: 15, per: 'night', max: 6 },
    { id: 'lunchpakket', name: 'Lunchpakket', description: 'Broodjes, fruit en water voor onderweg.', price: 12.5, per: 'person', max: 1 },
    { id: 'late-checkout', name: 'Late check-out (14:00)', price: 25, per: 'stay', max: 1 },
    { id: 'kinderbed', name: 'Kinderbedje', price: 0, per: 'stay', max: 2 },
  ];
  p.discountCodes = [{ code: 'WELKOMTERUG', percent: 10, active: true }];
  p.cancellationRules = [{ daysBefore: 1, percent: 50 }];
  p.translations = {
    en: { description: 'City hotel with 48 rooms on the river Spaarne, a five-minute walk from the Grote Markt and Haarlem station. Breakfast buffet, 24-hour reception, bike rental and its own car park.' },
    de: { description: 'Stadthotel mit 48 Zimmern am Spaarne, fünf Gehminuten vom Grote Markt und vom Bahnhof Haarlem. Frühstücksbuffet, Rezeption rund um die Uhr, Fahrradverleih und eigenes Parkhaus.' },
    fr: { description: 'Hôtel de ville de 48 chambres au bord de la Spaarne, à cinq minutes à pied de la Grote Markt et de la gare de Haarlem. Petit-déjeuner buffet, réception 24h/24, location de vélos et parking privé.' },
  };
  p.pointsOfInterest = [
    { kind: 'station', name: 'Station Haarlem', distanceKm: 0.5, walkMinutes: 6 },
    { kind: 'centre', name: 'Grote Markt', distanceKm: 0.4, walkMinutes: 5 },
    { kind: 'beach', name: 'Zandvoort aan Zee', distanceKm: 9 },
    { kind: 'bike_rental', name: 'Fietsverhuur in het hotel', distanceKm: 0 },
  ];
  confirm(p.facts, {
    'pets.dogsAllowed': true,
    'pets.maxDogs': 1,
    'pets.feePerDogPerNight': 15,
    'pets.rules': 'Honden welkom in de Standaard kamers, niet in het restaurant.',
    'garden.present': false,
    'breakfast.included': false,
    'breakfast.available': true,
    'breakfast.pricePerPerson': 19.5,
    'breakfast.times': '06:30-10:30',
    'breakfast.contents': 'Ontbijtbuffet met brood van bakkerij Van Vessem, eieren, kaas, fruit en warme gerechten.',
    'breakfast.dietsOnRequest': ['vegetarisch', 'veganistisch', 'glutenvrij', 'lactosevrij'],
    'checkin.from': '15:00',
    'checkin.until': '23:59',
    'checkout.until': '11:00',
    'policy.cancellation': 'Flexibel tarief: kosteloos annuleren tot 24 uur voor aankomst; daarna de eerste nacht.',
    'policy.minNights': 1,
    'policy.childrenWelcome': true,
    'fees.cleaningPerStay': 0,
    'fees.touristTaxPerPersonPerNight': 5.95,
    'fees.touristTaxAppliesToChildren': false,
    'parking.onSite': true,
    'parking.free': false,
    'location.quiet': false,
    'location.noiseSources': 'Kamers aan de voorkant kijken uit op het Spaarne; in het weekend is er uitgaansgeluid tot middernacht.',
    'access.stepFreeEntrance': true,
    'rules.smokingAllowed': false,
    'rules.partiesAllowed': false,
    'rules.quietHours': '23:00-07:00',
    'eco.label': 'Green Key',
    'eco.renewableEnergy': true,
    'eco.evCharging': true,
    'eco.carFreeReachable': true,
    'direct.perk': 'Bij direct boeken: late check-out tot 13:00 en gratis fietshuur voor één dag.',
  });
  const unit = (id: string, input: Parameters<typeof createUnit>[0], facts: Record<string, unknown>): Unit => {
    const u = createUnit(input, id);
    confirm(u.facts, facts);
    u.rates = { weekendSupplement: 25, seasons: [{ name: 'Hoogseizoen', from: '04-01', to: '09-30', ratePerNight: input.baseRatePerNight + 30 }], discounts: { longStay: [{ minNights: 5, percent: 10 }], earlyBird: { minDaysAhead: 60, percent: 8 } } };
    return u;
  };
  p.units.push(
    unit('standaard', { name: 'Standaard tweepersoonskamer', externalRef: 'STD', description: 'Tweepersoonsbed of twee aparte bedden, aan de binnenplaats.', maxGuests: 2, includedGuests: 2, baseRatePerNight: 119, inventory: 24 }, { 'unit.floor': 1, 'unit.privateBathroom': true, 'bed.lengthCm': 200, 'bed.widthCm': 160, 'access.stepsToUnit': 0, 'bathroom.walkInShower': true }),
    unit('superior', { name: 'Superior kamer met Spaarnezicht', externalRef: 'SUP', description: 'Ruime kamer aan de voorkant met uitzicht op het Spaarne en een kingsize bed.', maxGuests: 2, includedGuests: 2, baseRatePerNight: 159, inventory: 10 }, { 'unit.floor': 2, 'unit.privateBathroom': true, 'bed.lengthCm': 210, 'bed.widthCm': 180, 'bed.footboard': false, 'access.stepsToUnit': 0 }),
    unit('familie', { name: 'Familiekamer', externalRef: 'FAM', description: 'Tweepersoonsbed en een stapelbed, voor maximaal vier personen.', maxGuests: 4, includedGuests: 2, baseRatePerNight: 179, extraGuestPerNight: 25, inventory: 6 }, { 'unit.floor': 3, 'unit.privateBathroom': true, 'bed.lengthCm': 200, 'access.stepsToUnit': 0 }),
    unit('eenpersoons', { name: 'Eenpersoonskamer', externalRef: 'SGL', maxGuests: 1, includedGuests: 1, baseRatePerNight: 89, inventory: 8 }, { 'unit.floor': 1, 'unit.privateBathroom': true, 'bed.lengthCm': 200, 'bed.widthCm': 90 }),
  );
  store.saveProperty(p);
  // Questions the hotel answered before and published: the answer agent reuses them.
  const faq: [string, string][] = [
    ['Is er een lift in het hotel?', 'Ja, er is een lift naar alle verdiepingen, ook naar de familiekamers op de derde verdieping.'],
    ['Kunnen we onze fietsen binnen stallen?', 'Ja, er is een afgesloten fietsenstalling op de binnenplaats, gratis voor hotelgasten.'],
  ];
  for (const [question, answer] of faq) {
    store.saveQuestion({ id: `q_${randomUUID().slice(0, 8)}`, publicToken: randomBytes(16).toString('base64url'), propertyId: p.id, question, answer, answeredBy: 'owner', status: 'answered', publishAsFaq: true, agentClient: 'Demo', language: 'nl', createdAt: new Date().toISOString(), answeredAt: new Date().toISOString() });
  }
  return { property: p.name, id: p.id, ownerKey };
}
