import { factDefinitionsFor, getFactDefinition, readFact } from '../domain/facts.ts';
import type { Currency, FactMap, Property } from '../domain/types.ts';
import { factLabel } from '../i18n/facts.ts';
import { currentLang, money, t, type Lang } from '../i18n/index.ts';

const SCHEMA_TYPE: Record<Property['type'], string> = {
  bnb: 'BedAndBreakfast',
  pension: 'BedAndBreakfast',
  guesthouse: 'LodgingBusiness',
  holiday_home: 'VacationRental',
  unique_stay: 'LodgingBusiness',
  hotel: 'Hotel',
};

const AMENITIES: { key: string; name: string }[] = [
  { key: 'garden.fullyEnclosed', name: 'Fully enclosed garden' },
  { key: 'garden.present', name: 'Garden' },
  { key: 'parking.onSite', name: 'Parking on site' },
  { key: 'parking.free', name: 'Free parking' },
  { key: 'breakfast.included', name: 'Breakfast included' },
  { key: 'access.stepFreeEntrance', name: 'Step-free entrance' },
];

function confirmed(facts: FactMap, key: string) {
  const f = readFact(facts, key);
  return f.status === 'confirmed' ? f.value : null;
}

/**
 * schema.org JSON-LD built from owner-confirmed facts only. The WordPress plugin
 * renders the same confirmed facts as visible text, so structured data and the
 * visible page say the same thing.
 */
export function buildJsonLd(property: Property): Record<string, unknown> {
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': SCHEMA_TYPE[property.type],
    name: property.name,
    description: property.description,
    address: {
      '@type': 'PostalAddress',
      streetAddress: property.address.street,
      postalCode: property.address.postalCode,
      addressLocality: property.address.city,
      addressRegion: property.address.region,
      addressCountry: property.address.country,
    },
    numberOfRooms: property.units.length,
  };
  if (property.website) ld.url = property.website;
  const photos = (property.photos ?? []).filter((ph) => ph.url.startsWith('https://'));
  if (photos.length) ld.image = photos.slice(0, 10).map((ph) => ph.url);
  if (property.phone) ld.telephone = property.phone;
  if (property.geo) ld.geo = { '@type': 'GeoCoordinates', latitude: property.geo.lat, longitude: property.geo.lng };
  const pets = confirmed(property.facts, 'pets.dogsAllowed');
  if (typeof pets === 'boolean') ld.petsAllowed = pets;
  const checkin = confirmed(property.facts, 'checkin.from');
  if (typeof checkin === 'string') ld.checkinTime = checkin;
  const checkout = confirmed(property.facts, 'checkout.until');
  if (typeof checkout === 'string') ld.checkoutTime = checkout;
  const amenities = AMENITIES.filter((a) => confirmed(property.facts, a.key) === true).map((a) => ({ '@type': 'LocationFeatureSpecification', name: a.name, value: true }));
  if (amenities.length) ld.amenityFeature = amenities;
  const rates = property.units.map((u) => u.baseRatePerNight).filter((r) => r > 0);
  if (rates.length) ld.priceRange = `${money(Math.min(...rates), 'en', property.currency)}–${money(Math.max(...rates), 'en', property.currency)} per night`;
  ld.currenciesAccepted = property.currency;
  if (property.language) ld.inLanguage = property.language;
  return JSON.parse(JSON.stringify(ld));
}

export interface PublicFact {
  key: string;
  label: string;
  value: unknown;
  display: string;
  verifiedAt?: string;
}

export function displayFact(key: string, value: unknown, currency: Currency, lang: Lang): string {
  const def = getFactDefinition(key);
  if (typeof value === 'boolean') {
    const word = t(value ? 'match.yes' : 'match.no', {}, lang);
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
  if (Array.isArray(value)) return value.join(', ');
  // Money facts are in the property's own currency.
  if (def?.unit === 'EUR') return money(Number(value), lang, currency);
  return def?.unit ? `${value} ${def.unit}` : String(value);
}

/** Confirmed facts with labels in the reader's language, ready for visible display on the owner's website. */
export function publicFacts(facts: FactMap, scope: 'property' | 'unit', currency: Currency = 'EUR', lang: Lang = currentLang()): PublicFact[] {
  return factDefinitionsFor(scope).flatMap((def) => {
    const f = readFact(facts, def.key);
    if (f.status !== 'confirmed' || f.value === null) return [];
    return [{ key: def.key, label: factLabel(def.key, lang), value: f.value, display: displayFact(def.key, f.value, currency, lang), verifiedAt: f.verifiedAt?.slice(0, 10) }];
  });
}
