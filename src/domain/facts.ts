import { factLabel } from '../i18n/facts.ts';
import { currentLang, t, type Lang } from '../i18n/index.ts';
import type { Fact, FactMap, FactSource, FactValue } from './types.ts';

export type FactType = 'boolean' | 'number' | 'string' | 'string[]';
export type FactScope = 'property' | 'unit';

export interface FactDefinition {
  key: string;
  scope: FactScope;
  type: FactType;
  category: string;
  /** Dutch label for the owner dashboard. */
  label: string;
  /** English description for agents. */
  agentDescription: string;
  unit?: string;
  /**
   * Critical facts are the ones a guest makes a booking decision on (pets,
   * accessibility, mandatory costs). Agents only present them as fact when the
   * owner confirmed them.
   */
  critical: boolean;
  /** Owner hint shown in the dashboard. */
  hint?: string;
}

/** Facts older than this are flagged for re-verification. */
export const FACT_STALE_AFTER_DAYS = 365;

export const FACT_CATALOG: FactDefinition[] = [
  // Pets
  { key: 'pets.dogsAllowed', scope: 'property', type: 'boolean', category: 'Huisdieren', label: 'Honden toegestaan', agentDescription: 'Dogs are allowed', critical: true },
  { key: 'pets.maxDogs', scope: 'property', type: 'number', category: 'Huisdieren', label: 'Maximum aantal honden', agentDescription: 'Maximum number of dogs per booking', critical: true },
  { key: 'pets.feePerDogPerNight', scope: 'property', type: 'number', category: 'Huisdieren', label: 'Toeslag per hond per nacht', agentDescription: 'Mandatory fee per dog per night', unit: 'EUR', critical: true, hint: 'Vul 0 in als er geen toeslag is.' },
  { key: 'pets.rules', scope: 'property', type: 'string', category: 'Huisdieren', label: 'Huisregels voor honden', agentDescription: 'House rules for dogs', critical: false },
  { key: 'garden.present', scope: 'property', type: 'boolean', category: 'Buitenruimte', label: 'Tuin aanwezig', agentDescription: 'Garden available to guests', critical: false },
  { key: 'garden.fullyEnclosed', scope: 'property', type: 'boolean', category: 'Buitenruimte', label: 'Tuin volledig afgesloten', agentDescription: 'Garden is fully enclosed (a dog cannot get out)', critical: true, hint: 'Een foto van een tuin is geen bewijs: bevestig alleen als de tuin rondom dicht is, inclusief poort.' },
  { key: 'garden.shared', scope: 'property', type: 'boolean', category: 'Buitenruimte', label: 'Tuin gedeeld met andere gasten/eigenaar', agentDescription: 'Garden is shared with other guests or the owners', critical: false },

  // Breakfast
  { key: 'breakfast.included', scope: 'property', type: 'boolean', category: 'Ontbijt', label: 'Ontbijt inbegrepen in de prijs', agentDescription: 'Breakfast is included in the rate', critical: true },
  { key: 'breakfast.available', scope: 'property', type: 'boolean', category: 'Ontbijt', label: 'Ontbijt beschikbaar', agentDescription: 'Breakfast can be booked', critical: false },
  { key: 'breakfast.pricePerPerson', scope: 'property', type: 'number', category: 'Ontbijt', label: 'Prijs ontbijt per persoon per dag (indien niet inbegrepen)', agentDescription: 'Breakfast price per person per day when not included', unit: 'EUR', critical: true },
  { key: 'breakfast.times', scope: 'property', type: 'string', category: 'Ontbijt', label: 'Ontbijttijden', agentDescription: 'Breakfast serving times', critical: false },
  { key: 'breakfast.contents', scope: 'property', type: 'string', category: 'Ontbijt', label: 'Wat zit er in het ontbijt', agentDescription: 'What breakfast consists of', critical: false },
  { key: 'breakfast.dietsOnRequest', scope: 'property', type: 'string[]', category: 'Ontbijt', label: 'Dieetwensen (vooraf te bevestigen)', agentDescription: 'Dietary options that must be confirmed with the host before arrival', critical: false, hint: 'Bijv. vegetarisch, glutenvrij, lactosevrij. Deze worden altijd als "vooraf bevestigen" getoond.' },

  // Arrival & policies
  { key: 'checkin.from', scope: 'property', type: 'string', category: 'Aankomst & vertrek', label: 'Inchecken vanaf', agentDescription: 'Check-in from (local time)', critical: false },
  { key: 'checkin.until', scope: 'property', type: 'string', category: 'Aankomst & vertrek', label: 'Inchecken tot', agentDescription: 'Latest check-in (local time)', critical: false },
  { key: 'checkout.until', scope: 'property', type: 'string', category: 'Aankomst & vertrek', label: 'Uitchecken uiterlijk', agentDescription: 'Check-out until (local time)', critical: false },
  { key: 'policy.cancellation', scope: 'property', type: 'string', category: 'Voorwaarden', label: 'Annuleringsvoorwaarden', agentDescription: 'Cancellation policy', critical: true },
  { key: 'policy.minNights', scope: 'property', type: 'number', category: 'Voorwaarden', label: 'Minimum aantal nachten', agentDescription: 'Minimum length of stay in nights', critical: true },
  { key: 'policy.childrenWelcome', scope: 'property', type: 'boolean', category: 'Voorwaarden', label: 'Kinderen welkom', agentDescription: 'Children are welcome', critical: false },

  // Mandatory costs
  { key: 'fees.cleaningPerStay', scope: 'property', type: 'number', category: 'Verplichte kosten', label: 'Schoonmaakkosten per verblijf', agentDescription: 'Mandatory cleaning fee per stay', unit: 'EUR', critical: true, hint: 'Vul 0 in als er geen schoonmaakkosten zijn.' },
  { key: 'fees.touristTaxPerPersonPerNight', scope: 'property', type: 'number', category: 'Verplichte kosten', label: 'Toeristenbelasting per persoon per nacht', agentDescription: 'Tourist tax per person per night', unit: 'EUR', critical: true },
  { key: 'fees.touristTaxAppliesToChildren', scope: 'property', type: 'boolean', category: 'Verplichte kosten', label: 'Toeristenbelasting ook voor kinderen', agentDescription: 'Tourist tax also applies to children', critical: false },

  // Direct booking
  { key: 'direct.perk', scope: 'property', type: 'string', category: 'Direct boeken', label: 'Voordeel bij direct boeken', agentDescription: 'Perk when booking directly with the host instead of through a booking platform', critical: false, hint: 'Bijv. gratis late check-out, welkomstfles of 5% lager dan op boekingssites. Agents noemen dit aan gasten.' },

  // House rules
  { key: 'rules.smokingAllowed', scope: 'property', type: 'boolean', category: 'Huisregels', label: 'Roken toegestaan (binnen)', agentDescription: 'Smoking is allowed indoors', critical: false },
  { key: 'rules.partiesAllowed', scope: 'property', type: 'boolean', category: 'Huisregels', label: 'Feestjes toegestaan', agentDescription: 'Parties and events are allowed', critical: false },
  { key: 'rules.quietHours', scope: 'property', type: 'string', category: 'Huisregels', label: 'Stiltetijden', agentDescription: 'Quiet hours, e.g. 22:00-07:00', critical: false, hint: 'Bijv. 22:00-07:00.' },
  { key: 'rules.minAge', scope: 'property', type: 'number', category: 'Huisregels', label: 'Minimumleeftijd van wie boekt', agentDescription: 'Minimum age of the person booking', critical: false },
  { key: 'rules.other', scope: 'property', type: 'string', category: 'Huisregels', label: 'Overige huisregels', agentDescription: 'Other house rules', critical: false },

  // Sustainability
  { key: 'eco.label', scope: 'property', type: 'string', category: 'Duurzaamheid', label: 'Duurzaamheidskeurmerk', agentDescription: 'Sustainability label held (e.g. Green Key)', critical: false, hint: 'Alleen een keurmerk dat je echt hebt, bijv. Green Key of EU Ecolabel.' },
  { key: 'eco.renewableEnergy', scope: 'property', type: 'boolean', category: 'Duurzaamheid', label: 'Groene stroom of eigen zonnepanelen', agentDescription: 'Runs on renewable energy (green electricity or own solar panels)', critical: false },
  { key: 'eco.evCharging', scope: 'property', type: 'boolean', category: 'Duurzaamheid', label: 'Laadpaal voor elektrische auto', agentDescription: 'EV charging point for guests', critical: false },
  { key: 'eco.carFreeReachable', scope: 'property', type: 'boolean', category: 'Duurzaamheid', label: 'Goed bereikbaar zonder auto', agentDescription: 'Easy to reach without a car (public transport and a short walk or bike ride)', critical: false },

  // Location & surroundings
  { key: 'location.quiet', scope: 'property', type: 'boolean', category: 'Ligging', label: 'Rustig gelegen', agentDescription: 'Quiet location', critical: false },
  { key: 'location.noiseSources', scope: 'property', type: 'string', category: 'Ligging', label: 'Bekende geluidsbronnen', agentDescription: 'Known noise sources nearby (road, railway, bar, church bells...)', critical: false, hint: 'Eerlijk zijn loont: gasten die rust zoeken lezen dit.' },
  { key: 'parking.onSite', scope: 'property', type: 'boolean', category: 'Ligging', label: 'Parkeren op eigen terrein', agentDescription: 'Parking on the property', critical: false },
  { key: 'parking.free', scope: 'property', type: 'boolean', category: 'Ligging', label: 'Parkeren gratis', agentDescription: 'Parking is free of charge', critical: false },
  { key: 'access.stepFreeEntrance', scope: 'property', type: 'boolean', category: 'Toegankelijkheid', label: 'Drempelvrije hoofdingang', agentDescription: 'Main entrance is step-free', critical: true },

  // Unit-level facts
  { key: 'unit.floor', scope: 'unit', type: 'number', category: 'Kamer', label: 'Verdieping (0 = begane grond)', agentDescription: 'Floor of the unit (0 = ground floor)', critical: true },
  { key: 'unit.privateBathroom', scope: 'unit', type: 'boolean', category: 'Kamer', label: 'Eigen badkamer', agentDescription: 'Private bathroom', critical: false },
  { key: 'unit.privateEntrance', scope: 'unit', type: 'boolean', category: 'Kamer', label: 'Eigen ingang', agentDescription: 'Private entrance', critical: false },
  { key: 'unit.noiseNotes', scope: 'unit', type: 'string', category: 'Kamer', label: 'Geluid (ligging kamer, gedeelde ruimtes)', agentDescription: 'Noise notes for this unit (street side, shared walls, near breakfast room)', critical: false },
  { key: 'bed.lengthCm', scope: 'unit', type: 'number', category: 'Bed', label: 'Bedlengte', agentDescription: 'Bed length', unit: 'cm', critical: true },
  { key: 'bed.widthCm', scope: 'unit', type: 'number', category: 'Bed', label: 'Bedbreedte', agentDescription: 'Bed width', unit: 'cm', critical: false },
  { key: 'bed.footboard', scope: 'unit', type: 'boolean', category: 'Bed', label: 'Voetplank aan het bed', agentDescription: 'Bed has a footboard (relevant for tall guests)', critical: false },
  { key: 'access.stepsToUnit', scope: 'unit', type: 'number', category: 'Toegankelijkheid', label: 'Aantal treden naar de kamer', agentDescription: 'Number of steps from entrance to unit', critical: true },
  { key: 'access.thresholdFree', scope: 'unit', type: 'boolean', category: 'Toegankelijkheid', label: 'Drempelvrij binnen de kamer', agentDescription: 'No thresholds inside the unit', critical: true },
  { key: 'access.doorWidthCm', scope: 'unit', type: 'number', category: 'Toegankelijkheid', label: 'Smalste deurbreedte', agentDescription: 'Narrowest door width', unit: 'cm', critical: true },
  { key: 'bathroom.walkInShower', scope: 'unit', type: 'boolean', category: 'Toegankelijkheid', label: 'Inloopdouche zonder opstap', agentDescription: 'Walk-in shower without step', critical: true },
  { key: 'bathroom.grabBars', scope: 'unit', type: 'boolean', category: 'Toegankelijkheid', label: 'Beugels in badkamer', agentDescription: 'Grab bars in bathroom', critical: false },
];

const BY_KEY = new Map(FACT_CATALOG.map((d) => [d.key, d]));

export function getFactDefinition(key: string): FactDefinition | undefined {
  return BY_KEY.get(key);
}

export function factDefinitionsFor(scope: FactScope): FactDefinition[] {
  return FACT_CATALOG.filter((d) => d.scope === scope);
}

export function unknownFact(now = new Date()): Fact {
  return { value: null, status: 'unknown', updatedAt: now.toISOString() };
}

export function readFact(facts: FactMap, key: string): Fact {
  return facts[key] ?? { value: null, status: 'unknown', updatedAt: new Date(0).toISOString() };
}

export function isStale(fact: Fact, now = new Date()): boolean {
  if (fact.status !== 'confirmed' || !fact.verifiedAt) return false;
  const ageDays = (now.getTime() - new Date(fact.verifiedAt).getTime()) / 86_400_000;
  return ageDays > FACT_STALE_AFTER_DAYS;
}

export class FactValidationError extends Error {}

/** Validates and normalises a raw value against the fact catalog. */
export function coerceFactValue(key: string, raw: unknown): FactValue {
  const def = getFactDefinition(key);
  if (!def) throw new FactValidationError(t('own.unknownFact', { key }));
  switch (def.type) {
    case 'boolean':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 'ja') return true;
      if (raw === 'false' || raw === 'nee') return false;
      break;
    case 'number': {
      const n = typeof raw === 'string' ? Number(raw.replace(',', '.')) : raw;
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) return n;
      break;
    }
    case 'string':
      if (typeof raw === 'string' && raw.trim()) return raw.trim();
      break;
    case 'string[]': {
      const arr = typeof raw === 'string' ? raw.split(',') : raw;
      if (Array.isArray(arr) && arr.every((v) => typeof v === 'string')) {
        return arr.map((v) => v.trim()).filter(Boolean);
      }
      break;
    }
  }
  throw new FactValidationError(t('own.invalidValue', { label: factLabel(key, currentLang()), type: def.type }));
}

/** Owner sets a value: this is a confirmation by definition. */
export function ownerSetFact(facts: FactMap, key: string, raw: unknown, now = new Date()): Fact {
  const value = coerceFactValue(key, raw);
  const fact: Fact = { value, status: 'confirmed', source: 'owner', verifiedAt: now.toISOString(), updatedAt: now.toISOString() };
  facts[key] = fact;
  return fact;
}

/** Owner confirms a suggested value without changing it. */
export function ownerConfirmFact(facts: FactMap, key: string, now = new Date()): Fact {
  const fact = facts[key];
  if (!fact || fact.value === null) throw new FactValidationError(t('own.noValueToConfirm'));
  fact.status = 'confirmed';
  fact.verifiedAt = now.toISOString();
  fact.updatedAt = now.toISOString();
  return fact;
}

export function ownerMarkUnknown(facts: FactMap, key: string, now = new Date()): Fact {
  if (!getFactDefinition(key)) throw new FactValidationError(`Onbekend gegeven: ${key}`);
  const fact = unknownFact(now);
  facts[key] = fact;
  return fact;
}

/**
 * Stores a suggestion from an automated source. Never overwrites a value the
 * owner already confirmed or set, and never produces a confirmed fact.
 */
export function suggestFact(
  facts: FactMap,
  key: string,
  raw: unknown,
  source: FactSource,
  evidence: string,
  now = new Date(),
): boolean {
  const existing = facts[key];
  if (existing && existing.status === 'confirmed') return false;
  const value = coerceFactValue(key, raw);
  facts[key] = { value, status: 'unconfirmed', source, evidence, updatedAt: now.toISOString() };
  return true;
}

export interface Completeness {
  criticalTotal: number;
  criticalConfirmed: number;
  unconfirmed: string[];
  unknownCritical: string[];
  stale: string[];
  score: number;
}

/** How complete and trustworthy the passport is, from a guest-decision perspective. */
export function completeness(property: { facts: FactMap; units: { id: string; name: string; facts: FactMap }[] }, now = new Date(), lang: Lang = currentLang()): Completeness {
  const result: Completeness = { criticalTotal: 0, criticalConfirmed: 0, unconfirmed: [], unknownCritical: [], stale: [], score: 0 };
  const visit = (facts: FactMap, scope: FactScope, prefix: string) => {
    for (const def of factDefinitionsFor(scope)) {
      const fact = readFact(facts, def.key);
      const label = factLabel(def.key, lang);
      const name = prefix ? `${prefix}: ${label}` : label;
      if (fact.status === 'unconfirmed') result.unconfirmed.push(name);
      if (isStale(fact, now)) result.stale.push(name);
      if (!def.critical) continue;
      result.criticalTotal++;
      if (fact.status === 'confirmed') result.criticalConfirmed++;
      else if (fact.status === 'unknown') result.unknownCritical.push(name);
    }
  };
  visit(property.facts, 'property', '');
  for (const unit of property.units) visit(unit.facts, 'unit', unit.name);
  result.score = result.criticalTotal === 0 ? 0 : Math.round((result.criticalConfirmed / result.criticalTotal) * 100);
  return result;
}
