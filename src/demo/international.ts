import { randomBytes, randomUUID } from 'node:crypto';
import { addDays } from '../domain/dates.ts';
import { ownerSetFact, suggestFact } from '../domain/facts.ts';
import type { BookingRequest, FactMap, Property, Unit } from '../domain/types.ts';
import { createProperty, createUnit } from '../properties.ts';
import type { Store } from '../store.ts';

function confirm(facts: FactMap, values: Record<string, unknown>) {
  for (const [k, v] of Object.entries(values)) ownerSetFact(facts, k, v);
}

type Owner = { property: string; id: string; ownerKey: string };

/**
 * Seven fictional stays across Europe for the international demo. Together
 * they show every situation an agent meets: live booking systems and synced
 * calendars, confirmed and unverified facts, unknown costs, descriptions the
 * host wrote in their own language with translations, instant booking with a
 * deposit, room combinations for groups, and verified reviews.
 */
export function seedInternational(store: Store, engine: string): Owner[] {
  const owners: Owner[] = [];
  const add = (p: Property, ownerKey: string) => {
    p.published = true;
    store.saveProperty(p);
    owners.push({ property: p.name, id: p.id, ownerKey });
  };
  const live = (id: string) => ({
    connector: { kind: 'live_api' as const, baseUrl: engine },
    deeplinkTemplate: `${engine}/book?property=${id}&unit={unit}&checkin={checkin}&checkout={checkout}&adults={adults}&children={children}&dogs={dogs}&ref={ref}`,
  });
  const unit = (id: string, input: Parameters<typeof createUnit>[0], facts: Record<string, unknown>): Unit => {
    const u = createUnit(input, id);
    confirm(u.facts, facts);
    return u;
  };

  // 1. Tuscany: live booking system, everything confirmed, dog-friendly with an enclosed garden.
  {
    const { property: p, ownerKey } = createProperty({
      name: 'Agriturismo Il Poggio',
      slug: 'il-poggio',
      type: 'bnb',
      description: 'Family-run farm stay on a hill between vineyards and olive groves, 4 km from Montepulciano. Three rooms, a walled garden for dogs, and breakfast with our own olive oil, honey and pecorino.',
      address: { street: 'Strada del Poggio 7', postalCode: '53045', city: 'Montepulciano', region: 'Tuscany', country: 'IT' },
    });
    p.id = 'prop_ilpoggio';
    p.language = 'en';
    p.geo = { lat: 43.1132, lng: 11.7552 };
    p.website = 'https://ilpoggio.example';
    p.contactEmail = 'stay@ilpoggio.example';
    p.booking = live(p.id);
    p.translations = {
      de: { description: 'Familiengeführter Agriturismo auf einem Hügel zwischen Weinbergen und Olivenhainen, 4 km von Montepulciano. Drei Zimmer, ein ummauerter Garten für Hunde und Frühstück mit eigenem Olivenöl, Honig und Pecorino.' },
      fr: { description: "Agritourisme familial sur une colline entre vignes et oliviers, à 4 km de Montepulciano. Trois chambres, un jardin clos pour les chiens et un petit-déjeuner avec notre huile d'olive, notre miel et notre pecorino." },
      nl: { description: 'Familieboerderij op een heuvel tussen wijngaarden en olijfgaarden, 4 km van Montepulciano. Drie kamers, een ommuurde tuin voor honden en ontbijt met eigen olijfolie, honing en pecorino.' },
    };
    p.pointsOfInterest = [
      { kind: 'centre', name: 'Montepulciano old town', distanceKm: 4 },
      { kind: 'restaurant', name: 'Osteria del Borgo', distanceKm: 1.2, walkMinutes: 15 },
      { kind: 'nature', name: 'Val d’Orcia walking trails', distanceKm: 0.5, walkMinutes: 6 },
      { kind: 'station', name: 'Montepulciano Stazione', distanceKm: 9 },
    ];
    confirm(p.facts, {
      'pets.dogsAllowed': true,
      'pets.maxDogs': 2,
      'pets.feePerDogPerNight': 10,
      'pets.rules': 'Dogs welcome in the rooms and garden, not in the breakfast room. Towels for dogs available.',
      'garden.present': true,
      'garden.fullyEnclosed': true,
      'garden.shared': true,
      'breakfast.included': true,
      'breakfast.available': true,
      'breakfast.times': '08:00-10:30',
      'breakfast.contents': 'Own olive oil, honey and pecorino, fresh bread, fruit from the orchard, eggs on request.',
      'breakfast.dietsOnRequest': ['vegetarian', 'gluten-free'],
      'checkin.from': '15:00',
      'checkin.until': '21:00',
      'checkout.until': '10:30',
      'policy.cancellation': 'Free cancellation up to 14 days before arrival; after that 30% of the stay.',
      'policy.minNights': 2,
      'policy.childrenWelcome': true,
      'fees.cleaningPerStay': 0,
      'fees.touristTaxPerPersonPerNight': 2.5,
      'fees.touristTaxAppliesToChildren': false,
      'direct.perk': 'A bottle of our own Vino Nobile when you book direct.',
      'location.quiet': true,
      'location.noiseSources': 'Tractor in the vineyard on weekday mornings during harvest (September).',
      'parking.onSite': true,
      'parking.free': true,
      'access.stepFreeEntrance': true,
    });
    p.units.push(
      unit('ulivo', { name: 'Camera Ulivo', externalRef: 'poggio-ulivo', description: 'Ground-floor room opening onto the garden.', maxGuests: 2, includedGuests: 2, baseRatePerNight: 140 }, { 'unit.floor': 0, 'unit.privateBathroom': true, 'unit.privateEntrance': true, 'bed.lengthCm': 200, 'bed.widthCm': 180, 'access.stepsToUnit': 0, 'access.thresholdFree': true, 'access.doorWidthCm': 90, 'bathroom.walkInShower': true, 'bathroom.grabBars': true }),
      unit('vigna', { name: 'Camera Vigna', externalRef: 'poggio-vigna', description: 'First-floor room with a view over the vineyards.', maxGuests: 2, includedGuests: 2, baseRatePerNight: 120 }, { 'unit.floor': 1, 'unit.privateBathroom': true, 'bed.lengthCm': 200, 'access.stepsToUnit': 16, 'bathroom.walkInShower': false }),
      unit('torre', { name: 'Suite Torre', externalRef: 'poggio-torre', description: 'Family suite in the old tower: a double room and a bunk room.', maxGuests: 4, includedGuests: 2, baseRatePerNight: 190, extraGuestPerNight: 25 }, { 'unit.floor': 1, 'unit.privateBathroom': true, 'bed.lengthCm': 190, 'access.stepsToUnit': 12 }),
    );
    p.units[0].rates = { seasons: [], discounts: { longStay: [{ minNights: 7, percent: 10 }] } };
    p.units[1].rates = { seasons: [], discounts: { longStay: [{ minNights: 7, percent: 10 }] } };
    add(p, ownerKey);
  }

  // 2. Provence: the host writes in French; synced calendars (Airbnb, Booking.com); no dogs.
  {
    const { property: p, ownerKey } = createProperty({
      name: 'Le Mas des Lavandes',
      slug: 'mas-des-lavandes',
      type: 'bnb',
      description: 'Chambres d’hôtes dans un mas en pierre au pied de Gordes, entouré de champs de lavande. Piscine, petit-déjeuner provençal sous le mûrier, et le calme absolu du Luberon.',
      address: { street: 'Chemin des Lavandes 12', postalCode: '84220', city: 'Gordes', region: 'Provence, Luberon', country: 'FR' },
    });
    p.id = 'prop_lavandes';
    p.language = 'fr';
    p.geo = { lat: 43.9008, lng: 5.1932 };
    p.website = 'https://masdeslavandes.example';
    p.contactEmail = 'bonjour@masdeslavandes.example';
    p.booking = { connector: { kind: 'ical', calendars: { lavande: [`${engine}/calendar/lavandes-1.ics`], romarin: [`${engine}/calendar/lavandes-2.ics`] } } };
    p.translations = {
      en: { description: 'Guest rooms in a stone farmhouse below Gordes, surrounded by lavender fields. Pool, a Provençal breakfast under the mulberry tree, and the absolute quiet of the Luberon.' },
      de: { description: 'Gästezimmer in einem Steinbauernhaus unterhalb von Gordes, umgeben von Lavendelfeldern. Pool, provenzalisches Frühstück unter dem Maulbeerbaum und die vollkommene Ruhe des Luberon.' },
      nl: { description: 'Gastenkamers in een stenen boerderij onder Gordes, omringd door lavendelvelden. Zwembad, Provençaals ontbijt onder de moerbeiboom en de absolute rust van de Luberon.' },
    };
    p.pointsOfInterest = [
      { kind: 'centre', name: 'Gordes village', distanceKm: 1.8, walkMinutes: 25 },
      { kind: 'supermarket', name: 'Épicerie de Gordes', distanceKm: 2 },
      { kind: 'nature', name: 'Abbaye de Sénanque lavender fields', distanceKm: 4 },
    ];
    confirm(p.facts, {
      'pets.dogsAllowed': false,
      'breakfast.included': true,
      'breakfast.available': true,
      'breakfast.times': '08:30-10:00',
      'breakfast.contents': 'Pain de la boulangerie, confitures maison, fromage de chèvre, fruits de saison.',
      'checkin.from': '16:00',
      'checkout.until': '11:00',
      'policy.cancellation': 'Annulation gratuite jusqu’à 21 jours avant l’arrivée ; ensuite, l’acompte de 30 % est conservé.',
      'policy.minNights': 2,
      'policy.childrenWelcome': false,
      'fees.cleaningPerStay': 0,
      'fees.touristTaxPerPersonPerNight': 1.1,
      'location.quiet': true,
      'parking.onSite': true,
      'parking.free': true,
    });
    p.units.push(
      unit('lavande', { name: 'Chambre Lavande', externalRef: 'lavandes-1', maxGuests: 2, includedGuests: 2, baseRatePerNight: 135 }, { 'unit.floor': 0, 'unit.privateBathroom': true, 'unit.privateEntrance': true, 'bed.lengthCm': 200, 'bed.widthCm': 160 }),
      unit('romarin', { name: 'Chambre Romarin', externalRef: 'lavandes-2', maxGuests: 2, includedGuests: 2, baseRatePerNight: 125 }, { 'unit.floor': 1, 'unit.privateBathroom': true, 'bed.lengthCm': 190 }),
    );
    const seasons = { seasons: [{ name: 'Lavande', from: '06-15', to: '07-31', ratePerNight: 175, minNights: 3 }] };
    p.units[0].rates = seasons;
    p.units[1].rates = { seasons: [{ ...seasons.seasons[0], ratePerNight: 160 }] };
    add(p, ownerKey);
  }

  // 3. Black Forest: room calendar kept in INNLI, instant booking with a 30% deposit, accessible ground-floor room.
  {
    const { property: p, ownerKey } = createProperty({
      name: 'Gästehaus Am Schwarzwaldhang',
      slug: 'schwarzwaldhang',
      type: 'guesthouse',
      description: 'Kleines Gästehaus am Waldrand oberhalb des Titisees. Barrierefreies Zimmer im Erdgeschoss, Familienzimmer mit Seeblick, Wanderwege direkt ab Haus. Hunde willkommen.',
      address: { street: 'Waldweg 4', postalCode: '79822', city: 'Titisee-Neustadt', region: 'Schwarzwald, Baden-Württemberg', country: 'DE' },
    });
    p.id = 'prop_schwarzwald';
    p.language = 'de';
    p.geo = { lat: 47.9045, lng: 8.1462 };
    p.website = 'https://schwarzwaldhang.example';
    p.contactEmail = 'info@schwarzwaldhang.example';
    p.booking = { connector: { kind: 'manual' } };
    p.bookingRules = { instantBooking: true, minLeadDays: 1, maxNights: 14, holdHours: 24, deposit: { percent: 30, dueDays: 7, instructions: 'IBAN DE00 0000 0000 0000 0000 00, Verwendungszweck: Buchungsnummer' } };
    p.translations = {
      en: { description: 'Small guesthouse at the edge of the forest above Lake Titisee. Step-free room on the ground floor, family room with a lake view, hiking trails from the door. Dogs welcome.' },
      nl: { description: 'Klein gastenverblijf aan de bosrand boven de Titisee. Drempelvrije kamer op de begane grond, familiekamer met uitzicht op het meer, wandelroutes vanaf de deur. Honden welkom.' },
      fr: { description: "Petite maison d'hôtes en lisière de forêt au-dessus du lac Titisee. Chambre de plain-pied au rez-de-chaussée, chambre familiale avec vue sur le lac, sentiers de randonnée au départ de la maison. Chiens bienvenus." },
    };
    p.pointsOfInterest = [
      { kind: 'station', name: 'Bahnhof Titisee', distanceKm: 1.1, walkMinutes: 14 },
      { kind: 'nature', name: 'Titisee lakeshore', distanceKm: 0.6, walkMinutes: 8 },
      { kind: 'bus_stop', name: 'Waldweg (Bus 7300)', distanceKm: 0.2, walkMinutes: 3 },
      { kind: 'bike_rental', name: 'Radverleih am See', distanceKm: 1 },
    ];
    confirm(p.facts, {
      'pets.dogsAllowed': true,
      'pets.maxDogs': 1,
      'pets.feePerDogPerNight': 8,
      'garden.present': true,
      'garden.fullyEnclosed': false,
      'breakfast.included': true,
      'breakfast.available': true,
      'breakfast.times': '07:30-10:00',
      'breakfast.dietsOnRequest': ['vegetarisch', 'vegan', 'glutenfrei'],
      'checkin.from': '14:00',
      'checkin.until': '20:00',
      'checkout.until': '10:00',
      'policy.cancellation': 'Kostenlose Stornierung bis 7 Tage vor Anreise; danach 50 % des Reisepreises.',
      'policy.minNights': 1,
      'policy.childrenWelcome': true,
      'fees.cleaningPerStay': 0,
      'fees.touristTaxPerPersonPerNight': 2.9,
      'fees.touristTaxAppliesToChildren': false,
      'direct.perk': 'Kostenlose Hochschwarzwald Card (Bus, Bahn und über 80 Attraktionen) bei Direktbuchung.',
      'location.quiet': true,
      'parking.onSite': true,
      'parking.free': true,
      'access.stepFreeEntrance': true,
    });
    p.units.push(
      unit('tanne', { name: 'Doppelzimmer Tanne', externalRef: 'tanne', description: 'Barrierefrei, Erdgeschoss, Terrasse.', maxGuests: 2, includedGuests: 2, baseRatePerNight: 98 }, { 'unit.floor': 0, 'unit.privateBathroom': true, 'unit.privateEntrance': false, 'bed.lengthCm': 210, 'bed.widthCm': 180, 'bed.footboard': false, 'access.stepsToUnit': 0, 'access.thresholdFree': true, 'access.doorWidthCm': 95, 'bathroom.walkInShower': true, 'bathroom.grabBars': true }),
      unit('familie', { name: 'Familienzimmer Seeblick', externalRef: 'familie', description: 'Zwei Räume, Seeblick, für bis zu vier Personen.', maxGuests: 4, includedGuests: 2, baseRatePerNight: 135, extraGuestPerNight: 20 }, { 'unit.floor': 1, 'unit.privateBathroom': true, 'bed.lengthCm': 200, 'access.stepsToUnit': 18 }),
      unit('buche', { name: 'Einzelzimmer Buche', externalRef: 'buche', maxGuests: 1, includedGuests: 1, baseRatePerNight: 62 }, { 'unit.floor': 1, 'unit.privateBathroom': true, 'bed.lengthCm': 200 }),
    );
    for (const u of p.units) u.rates = { seasons: [], weekendSupplement: 10, discounts: { lastMinute: { withinDays: 3, percent: 10 } } };
    add(p, ownerKey);
  }

  // 4. Bruges: Flemish host, partly imported from the website and not yet confirmed.
  {
    const { property: p, ownerKey } = createProperty({
      name: 'B&B De Reiger',
      slug: 'de-reiger',
      type: 'bnb',
      description: 'Herenhuis uit 1890 aan een rustige reie, vijf minuten wandelen van de Markt in Brugge. Twee kamers met kanaalzicht en een ontbijt met Brugse specialiteiten.',
      address: { street: 'Groenerei 21', postalCode: '8000', city: 'Brugge', region: 'West-Vlaanderen', country: 'BE' },
    });
    p.id = 'prop_reiger';
    p.language = 'nl';
    p.geo = { lat: 51.2079, lng: 3.2295 };
    p.website = 'https://dereiger.example';
    p.contactEmail = 'info@dereiger.example';
    p.booking = { connector: { kind: 'ical', calendars: { kanaal: [`${engine}/calendar/reiger-1.ics`], tuin: [`${engine}/calendar/reiger-2.ics`] } } };
    p.translations = {
      en: { description: 'Town house from 1890 on a quiet canal, a five-minute walk from the Markt in Bruges. Two rooms with a canal view and a breakfast with Bruges specialities.' },
      fr: { description: 'Maison de maître de 1890 au bord d’un canal tranquille, à cinq minutes à pied du Markt de Bruges. Deux chambres avec vue sur le canal et un petit-déjeuner aux spécialités brugeoises.' },
    };
    p.pointsOfInterest = [
      { kind: 'centre', name: 'Markt', distanceKm: 0.4, walkMinutes: 5 },
      { kind: 'station', name: 'Station Brugge', distanceKm: 1.9, walkMinutes: 24 },
    ];
    confirm(p.facts, {
      'pets.dogsAllowed': true,
      'pets.maxDogs': 1,
      'breakfast.included': true,
      'checkin.from': '15:00',
      'checkout.until': '11:00',
      'fees.touristTaxPerPersonPerNight': 4,
      'location.quiet': true,
      'parking.onSite': false,
    });
    suggestFact(p.facts, 'garden.present', true, 'website', 'https://dereiger.example: "Stadstuin met terras aan het water"');
    suggestFact(p.facts, 'garden.fullyEnclosed', true, 'website', 'https://dereiger.example: "Ommuurde stadstuin"');
    suggestFact(p.facts, 'policy.cancellation', 'Kosteloos annuleren tot 7 dagen voor aankomst.', 'website', 'https://dereiger.example/voorwaarden');
    p.units.push(
      unit('kanaal', { name: 'Kamer Kanaalzicht', externalRef: 'reiger-1', maxGuests: 2, includedGuests: 2, baseRatePerNight: 155 }, { 'unit.floor': 1, 'unit.privateBathroom': true, 'bed.lengthCm': 200, 'access.stepsToUnit': 22 }),
      unit('tuin', { name: 'Tuinkamer', externalRef: 'reiger-2', maxGuests: 3, includedGuests: 2, baseRatePerNight: 145 }, { 'unit.floor': 0, 'unit.privateBathroom': true, 'bed.lengthCm': 210, 'access.stepsToUnit': 2 }),
    );
    add(p, ownerKey);
  }

  // 5. Tyrol: live booking system with winter season and weekend rates.
  {
    const { property: p, ownerKey } = createProperty({
      name: 'Pension Alpenblick',
      slug: 'alpenblick',
      type: 'pension',
      description: 'Familienpension mit Blick auf die Zillertaler Alpen, 600 m von der Penkenbahn. Im Winter Skikeller mit Schuhtrockner, im Sommer Wanderpass inklusive.',
      address: { street: 'Dorfstraße 31', postalCode: '6290', city: 'Mayrhofen', region: 'Zillertal, Tirol', country: 'AT' },
    });
    p.id = 'prop_alpenblick';
    p.language = 'de';
    p.geo = { lat: 47.1672, lng: 11.8615 };
    p.website = 'https://alpenblick.example';
    p.contactEmail = 'servus@alpenblick.example';
    p.booking = live(p.id);
    p.translations = {
      en: { description: 'Family guesthouse with a view of the Zillertal Alps, 600 m from the Penken cable car. Ski room with boot dryers in winter, hiking pass included in summer.' },
      nl: { description: 'Familiepension met uitzicht op de Zillertaler Alpen, 600 m van de Penkenbahn. In de winter een skikelder met schoenendrogers, in de zomer een wandelpas inbegrepen.' },
    };
    p.pointsOfInterest = [
      { kind: 'other', name: 'Penkenbahn cable car', distanceKm: 0.6, walkMinutes: 8 },
      { kind: 'station', name: 'Bahnhof Mayrhofen', distanceKm: 0.9, walkMinutes: 11 },
      { kind: 'supermarket', name: 'MPreis', distanceKm: 0.3 },
    ];
    confirm(p.facts, {
      'pets.dogsAllowed': false,
      'breakfast.included': true,
      'breakfast.times': '07:00-10:00',
      'checkin.from': '15:00',
      'checkout.until': '10:00',
      'policy.cancellation': 'Kostenlos stornierbar bis 30 Tage vor Anreise; danach 70 %.',
      'policy.minNights': 3,
      'policy.childrenWelcome': true,
      'fees.cleaningPerStay': 0,
      'fees.touristTaxPerPersonPerNight': 3.0,
      'fees.touristTaxAppliesToChildren': false,
      'location.quiet': false,
      'location.noiseSources': 'Dorfstraße: in der Wintersaison Après-Ski bis 22 Uhr hörbar.',
      'parking.onSite': true,
      'parking.free': true,
    });
    p.units.push(
      unit('ahorn', { name: 'Zimmer Ahorn', externalRef: 'alpenblick-1', maxGuests: 2, includedGuests: 2, baseRatePerNight: 110 }, { 'unit.floor': 1, 'unit.privateBathroom': true, 'bed.lengthCm': 200 }),
      unit('zirbe', { name: 'Zirbenzimmer', externalRef: 'alpenblick-2', maxGuests: 3, includedGuests: 2, baseRatePerNight: 130, extraGuestPerNight: 35 }, { 'unit.floor': 2, 'unit.privateBathroom': true, 'bed.lengthCm': 200 }),
      unit('appartement', { name: 'Appartement Gipfel', externalRef: 'alpenblick-3', maxGuests: 5, includedGuests: 2, baseRatePerNight: 160, extraGuestPerNight: 30 }, { 'unit.floor': 0, 'unit.privateBathroom': true, 'unit.privateEntrance': true, 'bed.lengthCm': 200, 'access.stepsToUnit': 0 }),
    );
    add(p, ownerKey);
  }

  // 6. Douro: room calendar in INNLI, but the dog policy and cleaning fee are unknown.
  {
    const { property: p, ownerKey } = createProperty({
      name: 'Quinta do Rio',
      slug: 'quinta-do-rio',
      type: 'unique_stay',
      description: 'A restored wine estate on the terraces above the Douro river near Pinhão. Two rooms in the old cellar house, port tastings at sunset, and the train along the river 10 minutes away.',
      address: { street: 'Estrada Municipal 323', postalCode: '5085-034', city: 'Pinhão', region: 'Douro Valley', country: 'PT' },
    });
    p.id = 'prop_quinta';
    p.language = 'en';
    p.geo = { lat: 41.1938, lng: -7.5367 };
    p.website = 'https://quintadorio.example';
    p.contactEmail = 'ola@quintadorio.example';
    p.booking = { connector: { kind: 'manual' } };
    p.pointsOfInterest = [
      { kind: 'station', name: 'Pinhão station (Douro line)', distanceKm: 2.5 },
      { kind: 'restaurant', name: 'Tasca do Rio', distanceKm: 2.3 },
    ];
    confirm(p.facts, {
      'breakfast.included': true,
      'breakfast.available': true,
      'checkin.from': '15:00',
      'checkout.until': '11:00',
      'policy.cancellation': 'Free cancellation up to 10 days before arrival.',
      'policy.minNights': 2,
      'fees.touristTaxPerPersonPerNight': 0,
      'location.quiet': true,
      'parking.onSite': true,
    });
    p.units.push(
      unit('adega', { name: 'Adega Room', externalRef: 'adega', maxGuests: 2, includedGuests: 2, baseRatePerNight: 165 }, { 'unit.floor': 0, 'unit.privateBathroom': true, 'bed.lengthCm': 200 }),
      unit('miradouro', { name: 'Miradouro Room', externalRef: 'miradouro', maxGuests: 2, includedGuests: 2, baseRatePerNight: 185 }, { 'unit.floor': 1, 'unit.privateBathroom': true, 'bed.lengthCm': 200 }),
    );
    add(p, ownerKey);
  }

  // 7. Kerry: synced calendar, garden only seen on the website, long bed.
  {
    const { property: p, ownerKey } = createProperty({
      name: 'Seaview House Dingle',
      slug: 'seaview-dingle',
      type: 'guesthouse',
      description: 'Family guesthouse overlooking Dingle Bay, a 10-minute walk from the harbour, pubs and live music. Full Irish breakfast, drying room for walkers on the Dingle Way.',
      address: { street: 'Conor Pass Road', postalCode: 'V92 XY12', city: 'Dingle', region: 'County Kerry', country: 'IE' },
    });
    p.id = 'prop_seaview';
    p.language = 'en';
    p.geo = { lat: 52.1445, lng: -10.2756 };
    p.website = 'https://seaviewdingle.example';
    p.contactEmail = 'hello@seaviewdingle.example';
    p.booking = { connector: { kind: 'ical', calendars: { bay: [`${engine}/calendar/seaview-1.ics`], harbour: [`${engine}/calendar/seaview-2.ics`], family: [`${engine}/calendar/seaview-3.ics`] } } };
    p.translations = {
      de: { description: 'Familiengeführtes Gästehaus mit Blick auf die Dingle Bay, 10 Gehminuten vom Hafen, den Pubs und der Livemusik. Full Irish Breakfast, Trockenraum für Wanderer auf dem Dingle Way.' },
      nl: { description: 'Familiegastenverblijf met uitzicht op Dingle Bay, 10 minuten lopen van de haven, de pubs en livemuziek. Full Irish breakfast en een droogruimte voor wandelaars op de Dingle Way.' },
    };
    p.pointsOfInterest = [
      { kind: 'centre', name: 'Dingle harbour', distanceKm: 0.8, walkMinutes: 10 },
      { kind: 'beach', name: 'Ventry beach', distanceKm: 6 },
      { kind: 'bus_stop', name: 'Dingle bus stop (Tralee line)', distanceKm: 0.7 },
    ];
    confirm(p.facts, {
      'pets.dogsAllowed': true,
      'pets.maxDogs': 1,
      'pets.feePerDogPerNight': 0,
      'breakfast.included': true,
      'breakfast.contents': 'Full Irish breakfast, porridge, home-baked brown bread.',
      'checkin.from': '14:00',
      'checkin.until': '22:00',
      'checkout.until': '11:00',
      'policy.cancellation': 'Free cancellation up to 7 days before arrival.',
      'policy.childrenWelcome': true,
      'fees.cleaningPerStay': 0,
      'fees.touristTaxPerPersonPerNight': 0,
      'location.quiet': true,
      'parking.onSite': true,
      'parking.free': true,
    });
    suggestFact(p.facts, 'garden.present', true, 'website', 'https://seaviewdingle.example: "Sea-facing garden"');
    suggestFact(p.facts, 'garden.fullyEnclosed', true, 'website', 'https://seaviewdingle.example: "fenced garden, perfect for dogs"');
    p.units.push(
      unit('bay', { name: 'Bay Room', externalRef: 'seaview-1', maxGuests: 2, includedGuests: 2, baseRatePerNight: 120 }, { 'unit.floor': 1, 'unit.privateBathroom': true, 'bed.lengthCm': 213, 'bed.footboard': false }),
      unit('harbour', { name: 'Harbour Room', externalRef: 'seaview-2', maxGuests: 2, includedGuests: 2, baseRatePerNight: 105 }, { 'unit.floor': 0, 'unit.privateBathroom': true, 'bed.lengthCm': 200 }),
      unit('family', { name: 'Family Room', externalRef: 'seaview-3', maxGuests: 4, includedGuests: 2, baseRatePerNight: 150, extraGuestPerNight: 20 }, { 'unit.floor': 1, 'unit.privateBathroom': true, 'bed.lengthCm': 200 }),
    );
    add(p, ownerKey);
  }

  return owners;
}

/**
 * Thirty days of plausible history, so the demo dashboard shows a funnel,
 * demand insight and verified reviews instead of zeros.
 */
export function seedActivity(store: Store, propertyIds: string[], now = new Date()): void {
  const agents = ['ChatGPT', 'Claude', 'Gemini', 'Reisplatform X'];
  const requirementSets = [['dogs_allowed', 'enclosed_garden'], ['breakfast_included'], ['step_free_access', 'walk_in_shower'], ['quiet_location'], ['parking_on_site', 'children_welcome'], ['long_bed']];
  let seed = 7;
  const rnd = (n: number) => {
    seed = (seed * 9301 + 49297) % 233280;
    return Math.floor((seed / 233280) * n);
  };
  for (const [i, propertyId] of propertyIds.entries()) {
    const property = store.getProperty(propertyId);
    if (!property) continue;
    const scale = 1 + (i % 3);
    for (let d = 29; d >= 0; d--) {
      const day = new Date(now.getTime() - d * 86_400_000);
      const at = (h: number) => new Date(day.getTime() - h * 3_600_000).toISOString();
      const ev = (type: Parameters<Store['addEvent']>[0]['type'], h: number, meta?: Record<string, unknown>) =>
        store.addEvent({ id: randomUUID(), type, propertyId, agentClient: agents[rnd(agents.length)], at: at(h), meta });
      const impressions = 2 + rnd(4 * scale);
      for (let k = 0; k < impressions; k++) ev('search_impression', k % 12);
      for (let k = 0; k < Math.ceil(impressions / 2); k++) ev('details_view', k % 12);
      for (let k = 0; k < Math.ceil(impressions / 3); k++) ev('quote_issued', k % 12);
      if (rnd(3) === 0) ev('booking_link_created', 3);
      if (rnd(5) === 0) ev('click_through', 2);
      if (rnd(9) === 0) ev('booking_confirmed', 1, { amount: 180 + rnd(300), bookingReference: `DEMO-${d}-${i}`, mode: 'booking_link' });
      for (let k = 0; k < impressions + rnd(3); k++) {
        const outcome = ['shown', 'shown', 'ranked_lower', 'unavailable', 'requirement_not_met'][rnd(5)];
        const requirements = requirementSets[rnd(requirementSets.length)];
        store.recordDemand(propertyId, { requirements, outcome, failed: outcome === 'requirement_not_met' ? requirements.slice(0, 1) : [], unknown: rnd(3) === 0 ? requirements.slice(-1) : [] }, day);
      }
    }
  }
  // Verified reviews from completed stays (two properties), with a reply from the host.
  const reviews: [string, string, number, string, string?][] = [
    ['prop_ilpoggio', 'ulivo', 5, 'Our dog loved the walled garden and so did we. Breakfast with their own pecorino was unforgettable.', 'Grazie! Bella is welcome back any time.'],
    ['prop_ilpoggio', 'vigna', 5, 'Exactly as described: quiet, honest pricing, and Giulia answered our question about the stairs within an hour.'],
    ['prop_ilpoggio', 'torre', 4, 'Great for our family. The tower suite is cosy; the bunk beds are a bit short for teenagers.', 'Thank you — we have noted the bed length in the room details now.'],
    ['prop_schwarzwald', 'tanne', 5, 'Wirklich barrierefrei: ebenerdige Dusche, breite Türen, Rollstuhl kein Problem.'],
    ['prop_schwarzwald', 'familie', 4, 'Lovely lake view and very kind hosts. Instant booking worked perfectly.'],
  ];
  for (const [k, [propertyId, unitId, rating, text, ownerReply]] of reviews.entries()) {
    const checkout = addDays(now.toISOString().slice(0, 10), -(10 + k * 9));
    const checkin = addDays(checkout, -3);
    const r: BookingRequest = {
      id: `req_demo${k}`,
      publicToken: randomBytes(16).toString('base64url'),
      propertyId,
      unitId,
      checkin,
      checkout,
      guests: { adults: 2, children: 0, dogs: 0 },
      breakfast: true,
      quotedTotal: 400 + k * 35,
      quoteComplete: true,
      guest: { name: 'Demo guest', email: `guest${k}@example.com` },
      language: 'en',
      status: 'accepted',
      agentClient: agents[k % agents.length],
      decidedBy: 'owner',
      createdAt: new Date(Date.parse(checkin) - 20 * 86_400_000).toISOString(),
      decidedAt: new Date(Date.parse(checkin) - 19 * 86_400_000).toISOString(),
      reviewInvitedAt: new Date(Date.parse(checkout) + 86_400_000).toISOString(),
      review: { rating, text, createdAt: new Date(Date.parse(checkout) + 2 * 86_400_000).toISOString(), ownerReply },
    };
    store.saveRequest(r);
  }
  // A published answer to an earlier guest question.
  store.saveQuestion({
    id: 'vrg_demo1',
    publicToken: randomBytes(16).toString('base64url'),
    propertyId: 'prop_ilpoggio',
    question: 'Can we charge an electric car at the farm?',
    agentClient: 'Claude',
    status: 'answered',
    answer: 'Yes: a 11 kW wallbox in the courtyard, free for guests.',
    publishAsFaq: true,
    createdAt: new Date(now.getTime() - 12 * 86_400_000).toISOString(),
    answeredAt: new Date(now.getTime() - 12 * 86_400_000 + 3_600_000).toISOString(),
  });
}
