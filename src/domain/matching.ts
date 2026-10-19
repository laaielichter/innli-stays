import { factLabel } from '../i18n/facts.ts';
import { currentLang, formatDate, t } from '../i18n/index.ts';
import { getFactDefinition, isStale, readFact } from './facts.ts';
import type { FactMap, FactValue, Guests, Property, Unit } from './types.ts';

export const REQUIREMENTS = [
  'dogs_allowed',
  'enclosed_garden',
  'ground_floor_unit',
  'breakfast_included',
  'breakfast_available',
  'step_free_access',
  'walk_in_shower',
  'long_bed',
  'private_bathroom',
  'private_entrance',
  'quiet_location',
  'parking_on_site',
  'children_welcome',
  'non_smoking',
  'ev_charging',
  'eco_label',
  'car_free_reachable',
] as const;

export type Requirement = (typeof REQUIREMENTS)[number];

/**
 * - met:        confirmed by the owner (and not stale)
 * - unverified: the data suggests yes, but the owner has not (re)confirmed it
 * - unknown:    no reliable information — the guest should ask the host
 * - not_met:    confirmed that it does not meet the requirement
 */
export type MatchLevel = 'met' | 'unverified' | 'unknown' | 'not_met';

export interface CriterionResult {
  requirement: Requirement;
  level: MatchLevel;
  detail: string;
}

export interface MatchOptions {
  guests: Guests;
  minBedLengthCm?: number;
}

const LEVEL_ORDER: MatchLevel[] = ['met', 'unverified', 'unknown', 'not_met'];
const worst = (levels: MatchLevel[]) => levels.reduce((a, b) => (LEVEL_ORDER.indexOf(b) > LEVEL_ORDER.indexOf(a) ? b : a), 'met' as MatchLevel);

function describe(key: string, value: FactValue | null): string {
  const def = getFactDefinition(key);
  const label = factLabel(key, currentLang());
  if (value === null) return t('match.unknown', { label });
  const shown = typeof value === 'boolean' ? t(value ? 'match.yes' : 'match.no') : Array.isArray(value) ? value.join(', ') : `${value}${def?.unit ? ` ${def.unit}` : ''}`;
  return t('match.value', { label, value: shown });
}

/** Evaluates a single fact against a predicate, honouring status and staleness. */
function evaluateFact(facts: FactMap, key: string, predicate: (v: FactValue) => boolean, now: Date): { level: MatchLevel; detail: string } {
  const fact = readFact(facts, key);
  if (fact.value === null || fact.status === 'unknown') return { level: 'unknown', detail: describe(key, null) };
  const ok = predicate(fact.value);
  let detail = describe(key, fact.value);
  if (fact.status === 'unconfirmed') {
    detail += t('match.notConfirmed');
    // An unconfirmed "no" is not a reliable no either.
    return { level: ok ? 'unverified' : 'unknown', detail };
  }
  if (!ok) return { level: 'not_met', detail };
  if (isStale(fact, now)) return { level: 'unverified', detail: t('match.lastChecked', { detail, date: fact.verifiedAt ? formatDate(fact.verifiedAt) : '' }) };
  return { level: 'met', detail };
}

const isTrue = (v: FactValue) => v === true;

function combine(requirement: Requirement, parts: { level: MatchLevel; detail: string }[]): CriterionResult {
  return { requirement, level: worst(parts.map((p) => p.level)), detail: parts.map((p) => p.detail).join('; ') };
}

export function evaluateRequirement(requirement: Requirement, property: Property, unit: Unit, opts: MatchOptions, now = new Date()): CriterionResult {
  const p = property.facts;
  const u = unit.facts;
  switch (requirement) {
    case 'dogs_allowed': {
      const parts = [evaluateFact(p, 'pets.dogsAllowed', isTrue, now)];
      if (opts.guests.dogs > 1 || readFact(p, 'pets.maxDogs').value !== null) {
        parts.push(evaluateFact(p, 'pets.maxDogs', (v) => typeof v === 'number' && v >= Math.max(1, opts.guests.dogs), now));
      }
      return combine(requirement, parts);
    }
    case 'enclosed_garden':
      return combine(requirement, [evaluateFact(p, 'garden.fullyEnclosed', isTrue, now)]);
    case 'ground_floor_unit':
      return combine(requirement, [evaluateFact(u, 'unit.floor', (v) => v === 0, now)]);
    case 'breakfast_included':
      return combine(requirement, [evaluateFact(p, 'breakfast.included', isTrue, now)]);
    case 'breakfast_available': {
      const included = evaluateFact(p, 'breakfast.included', isTrue, now);
      if (included.level === 'met') return combine(requirement, [included]);
      const available = evaluateFact(p, 'breakfast.available', isTrue, now);
      return LEVEL_ORDER.indexOf(available.level) < LEVEL_ORDER.indexOf(included.level)
        ? combine(requirement, [available])
        : combine(requirement, [included]);
    }
    case 'step_free_access':
      return combine(requirement, [
        evaluateFact(p, 'access.stepFreeEntrance', isTrue, now),
        evaluateFact(u, 'access.stepsToUnit', (v) => v === 0, now),
        evaluateFact(u, 'access.thresholdFree', isTrue, now),
      ]);
    case 'walk_in_shower':
      return combine(requirement, [evaluateFact(u, 'bathroom.walkInShower', isTrue, now)]);
    case 'long_bed': {
      const min = opts.minBedLengthCm ?? 210;
      const parts = [evaluateFact(u, 'bed.lengthCm', (v) => typeof v === 'number' && v >= min, now)];
      const footboard = readFact(u, 'bed.footboard');
      if (footboard.value === true) parts.push({ level: 'met', detail: t('match.footboard') });
      return combine(requirement, parts);
    }
    case 'private_bathroom':
      return combine(requirement, [evaluateFact(u, 'unit.privateBathroom', isTrue, now)]);
    case 'private_entrance':
      return combine(requirement, [evaluateFact(u, 'unit.privateEntrance', isTrue, now)]);
    case 'quiet_location': {
      const parts = [evaluateFact(p, 'location.quiet', isTrue, now)];
      const noise = readFact(p, 'location.noiseSources');
      if (typeof noise.value === 'string') parts.push({ level: 'met', detail: t('match.noise', { value: noise.value }) });
      const unitNoise = readFact(u, 'unit.noiseNotes');
      if (typeof unitNoise.value === 'string') parts.push({ level: 'met', detail: t('match.unitNoise', { value: unitNoise.value }) });
      return combine(requirement, parts);
    }
    case 'parking_on_site':
      return combine(requirement, [evaluateFact(p, 'parking.onSite', isTrue, now)]);
    case 'children_welcome':
      return combine(requirement, [evaluateFact(p, 'policy.childrenWelcome', isTrue, now)]);
    case 'non_smoking':
      return combine(requirement, [evaluateFact(p, 'rules.smokingAllowed', (v) => v === false, now)]);
    case 'ev_charging':
      return combine(requirement, [evaluateFact(p, 'eco.evCharging', isTrue, now)]);
    case 'eco_label':
      return combine(requirement, [evaluateFact(p, 'eco.label', (v) => typeof v === 'string' && v.trim().length > 1, now)]);
    case 'car_free_reachable':
      return combine(requirement, [evaluateFact(p, 'eco.carFreeReachable', isTrue, now)]);
  }
}

export interface UnitMatch {
  unit: Unit;
  criteria: CriterionResult[];
  overall: MatchLevel;
  /** Identical rooms of this type the party needs (1 for a single room; more for a group in a hotel room type). */
  rooms: number;
}

/** Most identical rooms one search result may combine. */
export const MAX_ROOMS_PER_TYPE = 10;

/**
 * Rooms of this type the party needs: one if it fits, otherwise several
 * identical rooms (each with at least one adult), when the type has them.
 */
export function roomsNeeded(unit: Unit, guests: Guests): number | null {
  const persons = guests.adults + guests.children;
  const rooms = Math.max(1, Math.ceil(persons / unit.maxGuests));
  if (rooms === 1) return 1;
  const available = Math.min(unit.inventory ?? 1, MAX_ROOMS_PER_TYPE);
  return rooms <= available && guests.adults >= rooms ? rooms : null;
}

/** Requirements implied by the guest party, so an agent cannot forget them. */
export function impliedRequirements(guests: Guests, explicit: Requirement[]): Requirement[] {
  const set = new Set(explicit);
  if (guests.dogs > 0) set.add('dogs_allowed');
  if (guests.children > 0) set.add('children_welcome');
  return [...set];
}

/** Returns units that can host the party and do not fail any requirement, best first. */
export function matchUnits(property: Property, requirements: Requirement[], opts: MatchOptions, now = new Date()): UnitMatch[] {
  const matches: UnitMatch[] = [];
  for (const unit of property.units) {
    const rooms = roomsNeeded(unit, opts.guests);
    if (rooms === null) continue;
    const criteria = requirements.map((r) => evaluateRequirement(r, property, unit, opts, now));
    const overall = worst(criteria.map((c) => c.level));
    if (overall === 'not_met') continue;
    matches.push({ unit, criteria, overall, rooms });
  }
  // Best match first; with equal quality, fewer rooms first.
  return matches.sort((a, b) => matchScore(b.criteria) - matchScore(a.criteria) || a.rooms - b.rooms);
}

export function matchScore(criteria: CriterionResult[]): number {
  return criteria.reduce((s, c) => s + (c.level === 'met' ? 3 : c.level === 'unverified' ? 1 : 0), 0);
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export interface LocationFilter {
  area?: string;
  country?: string;
  near?: { lat: number; lng: number; radiusKm: number };
}

export function matchesLocation(property: Property, filter: LocationFilter | undefined): { ok: boolean; distanceKm?: number } {
  if (!filter) return { ok: true };
  if (filter.country && norm(filter.country) !== norm(property.address.country)) return { ok: false };
  if (filter.area) {
    const needle = norm(filter.area);
    const hay = [property.address.city, property.address.region ?? '', property.name, property.description].map(norm).join(' ');
    if (!hay.includes(needle)) return { ok: false };
  }
  if (filter.near) {
    if (!property.geo) return { ok: false };
    const distanceKm = Math.round(haversineKm(filter.near, property.geo) * 10) / 10;
    return { ok: distanceKm <= filter.near.radiusKm, distanceKm };
  }
  return { ok: true };
}

export interface RoomAssignment {
  unit: Unit;
  guests: Guests;
  criteria: CriterionResult[];
}

export interface CombinationMatch {
  rooms: RoomAssignment[];
  overall: MatchLevel;
  spareBeds: number;
}

/**
 * Splits a party over rooms: every room gets at least one adult, then the
 * remaining adults and children fill rooms in order of capacity. Dogs stay
 * with the first room. Returns null when the party does not fit.
 */
export function splitParty(guests: Guests, units: Unit[]): Guests[] | null {
  if (guests.adults < units.length) return null;
  const capacity = units.map((u) => u.maxGuests);
  const parts = units.map(() => ({ adults: 1, children: 0, dogs: 0 }));
  let adults = guests.adults - units.length;
  let children = guests.children;
  for (let i = 0; i < units.length; i++) {
    const free = () => capacity[i] - parts[i].adults - parts[i].children;
    if (free() < 0) return null;
    const a = Math.min(adults, free());
    parts[i].adults += a;
    adults -= a;
    const c = Math.min(children, free());
    parts[i].children += c;
    children -= c;
  }
  if (adults > 0 || children > 0) return null;
  parts[0].dogs = guests.dogs;
  return parts;
}

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  const out: T[][] = [];
  items.forEach((item, i) => {
    for (const rest of combinations(items.slice(i + 1), k - 1)) out.push([item, ...rest]);
  });
  return out;
}

/**
 * For groups too large for any single room: the best combinations of two or
 * three rooms in one property, fewest rooms and fewest empty beds first.
 */
export function matchRoomCombinations(property: Property, requirements: Requirement[], opts: MatchOptions, now = new Date(), limit = 3): CombinationMatch[] {
  const persons = opts.guests.adults + opts.guests.children;
  const out: CombinationMatch[] = [];
  for (const size of [2, 3]) {
    if (property.units.length < size) break;
    for (const combo of combinations([...property.units].sort((a, b) => b.maxGuests - a.maxGuests), size)) {
      const capacity = combo.reduce((s, u) => s + u.maxGuests, 0);
      if (capacity < persons) continue;
      const parts = splitParty(opts.guests, combo);
      if (!parts) continue;
      const rooms = combo.map((unit, i) => ({
        unit,
        guests: parts[i],
        criteria: requirements.map((r) => evaluateRequirement(r, property, unit, { ...opts, guests: parts[i] }, now)),
      }));
      const overall = worst(rooms.flatMap((r) => r.criteria.map((c) => c.level)));
      if (overall === 'not_met') continue;
      out.push({ rooms, overall, spareBeds: capacity - persons });
    }
    if (out.length) break;
  }
  const rank = (m: CombinationMatch) => LEVEL_ORDER.indexOf(m.overall) * 100 + m.spareBeds;
  return out.sort((a, b) => rank(a) - rank(b)).slice(0, limit);
}
