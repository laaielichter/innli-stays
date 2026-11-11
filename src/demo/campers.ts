import { ownerSetFact } from '../domain/facts.ts';
import type { FactMap, Unit } from '../domain/types.ts';
import { createProperty, createUnit } from '../properties.ts';
import type { Store } from '../store.ts';

function confirm(facts: FactMap, values: Record<string, unknown>) {
  for (const [k, v] of Object.entries(values)) ownerSetFact(facts, k, v);
}

/**
 * A fictional camper rental company with three vehicles: a campervan anyone
 * with a car licence may drive, a family motorhome, and a large motorhome
 * that needs a C1 licence. Shows the rules a rental company has that a B&B
 * does not: who may drive, kilometres, deposit and insurance.
 */
export function seedCampers(store: Store): { property: string; id: string; ownerKey: string } {
  const { property: p, ownerKey } = createProperty({
    name: 'Veluwe Campers',
    slug: 'veluwe-campers',
    type: 'camper_rental',
    description: 'Camperverhuur aan de rand van de Veluwe. Drie campers, compleet ingericht met beddengoed, kookgerei en campingstoelen. Ophalen in Apeldoorn, tien minuten van het station.',
    address: { street: 'Laan van de Dierenriem 12', postalCode: '7324 AB', city: 'Apeldoorn', region: 'Veluwe', country: 'NL' },
  });
  p.id = 'prop_veluwecampers';
  p.published = true;
  p.language = 'nl';
  p.geo = { lat: 52.1876, lng: 5.9706 };
  p.website = 'https://veluwecampers.example';
  p.contactEmail = 'verhuur@veluwecampers.example';
  p.booking = { connector: { kind: 'manual' } };
  p.bookingRules = { instantBooking: false, minLeadDays: 2, maxNights: 28, holdHours: 24, autoAnswer: true };
  p.extras = [
    { id: 'fietsen', name: 'Twee fietsen op de drager', price: 8, per: 'night', max: 1 },
    { id: 'extra-bestuurder', name: 'Extra bestuurder', description: 'Een tweede bestuurder meeverzekerd.', price: 35, per: 'stay', max: 2 },
    { id: 'eindschoonmaak-toilet', name: 'Toilet laten legen bij inleveren', price: 45, per: 'stay', max: 1 },
  ];
  p.cancellationRules = [
    { daysBefore: 28, percent: 30 },
    { daysBefore: 7, percent: 100 },
  ];
  p.translations = {
    en: { description: 'Camper rental on the edge of the Veluwe. Three campers, fully equipped with bedding, cookware and camping chairs. Pick-up in Apeldoorn, ten minutes from the station.' },
    de: { description: 'Wohnmobilvermietung am Rand der Veluwe. Drei Wohnmobile, komplett ausgestattet mit Bettwäsche, Kochgeschirr und Campingstühlen. Abholung in Apeldoorn, zehn Minuten vom Bahnhof.' },
  };
  p.pointsOfInterest = [{ kind: 'station', name: 'Station Apeldoorn', distanceKm: 3.5 }];
  confirm(p.facts, {
    'rental.pickupLocation': 'Laan van de Dierenriem 12, Apeldoorn',
    'rental.pickupFrom': '14:00',
    'rental.returnUntil': '10:00',
    'rental.minDriverAge': 23,
    'rental.minLicenceYears': 2,
    'rental.securityDeposit': 1000,
    'rental.insuranceIncluded': true,
    'rental.insuranceDeductible': 1000,
    'rental.unlimitedKm': false,
    'rental.kmIncludedPerDay': 150,
    'rental.pricePerExtraKm': 0.3,
    'rental.abroadAllowed': true,
    'rental.countriesAllowed': ['NL', 'BE', 'DE', 'FR', 'LU', 'DK'],
    'rental.fuelPolicy': 'Ophalen en inleveren met een volle tank.',
    'pets.dogsAllowed': true,
    'pets.maxDogs': 1,
    'pets.feePerDogPerNight': 5,
    'pets.rules': 'Eén hond welkom in de buscamper en de gezinscamper, niet in de grote camper.',
    'policy.cancellation': 'Tot 28 dagen voor het ophalen kosteloos; daarna 30%; binnen 7 dagen het volledige bedrag.',
    'policy.minNights': 3,
    'policy.childrenWelcome': true,
    'fees.cleaningPerStay': 95,
    'rules.smokingAllowed': false,
  });
  const unit = (id: string, input: Parameters<typeof createUnit>[0], facts: Record<string, unknown>): Unit => {
    const u = createUnit(input, id);
    confirm(u.facts, facts);
    u.rates = { seasons: [{ name: 'Hoogseizoen', from: '07-01', to: '08-31', ratePerNight: input.baseRatePerNight + 40 }], discounts: { longStay: [{ minNights: 14, percent: 10 }] } };
    return u;
  };
  p.units.push(
    unit(
      'buscamper',
      { name: 'Buscamper voor twee', externalRef: 'VAN', description: 'Compacte buscamper met vast bed, keukenblok en buitendouche. Rijdt als een grote auto.', maxGuests: 2, includedGuests: 2, baseRatePerNight: 95, inventory: 2 },
      { 'vehicle.type': 'campervan', 'vehicle.beltedSeats': 2, 'vehicle.licenceCategory': 'B', 'vehicle.transmission': 'automatic', 'vehicle.fuel': 'diesel', 'vehicle.lengthM': 5.4, 'vehicle.heightM': 2.6, 'vehicle.year': 2024, 'vehicle.toilet': true, 'vehicle.shower': false, 'vehicle.kitchen': true, 'vehicle.heating': true, 'vehicle.winterReady': true, 'vehicle.bikeRack': true, 'vehicle.awning': true, 'bed.lengthCm': 195, 'bed.widthCm': 140 },
    ),
    unit(
      'gezinscamper',
      { name: 'Gezinscamper voor vier', externalRef: 'FAM', description: 'Halfintegraal met een vast bed achterin en een hefbed. Vier zitplaatsen met gordel, twee met isofix.', maxGuests: 4, includedGuests: 4, baseRatePerNight: 135, inventory: 1 },
      { 'vehicle.type': 'motorhome', 'vehicle.beltedSeats': 4, 'vehicle.licenceCategory': 'B', 'vehicle.transmission': 'manual', 'vehicle.fuel': 'diesel', 'vehicle.lengthM': 6.9, 'vehicle.heightM': 2.9, 'vehicle.year': 2023, 'vehicle.toilet': true, 'vehicle.shower': true, 'vehicle.kitchen': true, 'vehicle.heating': true, 'vehicle.winterReady': false, 'vehicle.bikeRack': true, 'vehicle.awning': true, 'bed.lengthCm': 200, 'bed.widthCm': 150 },
    ),
    unit(
      'grote-camper',
      { name: 'Grote camper voor zes', externalRef: 'XL', description: 'Alkoofcamper van 4.250 kg met zes slaapplaatsen en een grote garage. Hiervoor is rijbewijs C1 nodig.', maxGuests: 6, includedGuests: 6, baseRatePerNight: 175, inventory: 1 },
      { 'vehicle.type': 'motorhome', 'vehicle.beltedSeats': 6, 'vehicle.licenceCategory': 'C1', 'vehicle.transmission': 'automatic', 'vehicle.fuel': 'diesel', 'vehicle.lengthM': 7.4, 'vehicle.heightM': 3.2, 'vehicle.year': 2022, 'vehicle.toilet': true, 'vehicle.shower': true, 'vehicle.kitchen': true, 'vehicle.heating': true, 'vehicle.winterReady': true, 'vehicle.bikeRack': false, 'vehicle.awning': true, 'bed.lengthCm': 200, 'bed.widthCm': 140 },
    ),
  );
  store.saveProperty(p);
  return { property: p.name, id: p.id, ownerKey };
}
