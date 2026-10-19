import { getFactDefinition, readFact } from '../domain/facts.ts';
import type { Requirement } from '../domain/matching.ts';
import type { Property } from '../domain/types.ts';
import type { Store } from '../store.ts';
import { factLabel } from '../i18n/facts.ts';
import { currentLang, type Lang } from '../i18n/index.ts';

/** Dutch labels for what guests ask agents for. */
export const REQUIREMENT_LABELS: Record<Requirement, string> = {
  dogs_allowed: 'Hond mee',
  enclosed_garden: 'Volledig afgesloten tuin',
  ground_floor_unit: 'Kamer op de begane grond',
  breakfast_included: 'Ontbijt inbegrepen',
  breakfast_available: 'Ontbijt mogelijk',
  step_free_access: 'Drempelvrij / zonder trappen',
  walk_in_shower: 'Inloopdouche',
  long_bed: 'Extra lang bed',
  private_bathroom: 'Eigen badkamer',
  private_entrance: 'Eigen ingang',
  quiet_location: 'Rustige ligging',
  parking_on_site: 'Parkeren bij de accommodatie',
  children_welcome: 'Kinderen welkom',
  non_smoking: 'Rookvrij',
  ev_charging: 'Laadpaal',
  eco_label: 'Duurzaamheidskeurmerk',
  car_free_reachable: 'Bereikbaar zonder auto',
};

const REQUIREMENT_LABELS_EN: Record<Requirement, string> = {
  dogs_allowed: 'Bringing a dog',
  enclosed_garden: 'Fully enclosed garden',
  ground_floor_unit: 'Ground-floor room',
  breakfast_included: 'Breakfast included',
  breakfast_available: 'Breakfast possible',
  step_free_access: 'Step-free / no stairs',
  walk_in_shower: 'Walk-in shower',
  long_bed: 'Extra-long bed',
  private_bathroom: 'Private bathroom',
  private_entrance: 'Private entrance',
  quiet_location: 'Quiet location',
  parking_on_site: 'Parking at the property',
  children_welcome: 'Children welcome',
  non_smoking: 'Non-smoking',
  ev_charging: 'EV charging',
  eco_label: 'Sustainability label',
  car_free_reachable: 'Reachable without a car',
};

export const requirementLabel = (r: Requirement, lang: Lang = currentLang()) => (lang === 'nl' ? REQUIREMENT_LABELS[r] : REQUIREMENT_LABELS_EN[r]) ?? r;

/** Passport facts that decide each requirement. */
const REQUIREMENT_FACTS: Record<Requirement, string[]> = {
  dogs_allowed: ['pets.dogsAllowed', 'pets.maxDogs'],
  enclosed_garden: ['garden.fullyEnclosed'],
  ground_floor_unit: ['unit.floor'],
  breakfast_included: ['breakfast.included'],
  breakfast_available: ['breakfast.available'],
  step_free_access: ['access.stepFreeEntrance', 'access.stepsToUnit', 'access.thresholdFree'],
  walk_in_shower: ['bathroom.walkInShower'],
  long_bed: ['bed.lengthCm'],
  private_bathroom: ['unit.privateBathroom'],
  private_entrance: ['unit.privateEntrance'],
  quiet_location: ['location.quiet'],
  parking_on_site: ['parking.onSite'],
  children_welcome: ['policy.childrenWelcome'],
  non_smoking: ['rules.smokingAllowed'],
  ev_charging: ['eco.evCharging'],
  eco_label: ['eco.label'],
  car_free_reachable: ['eco.carFreeReachable'],
};

const OUTCOME_LABELS_EN: Record<string, string> = {
  shown: 'Shown to the guest',
  ranked_lower: 'Found, but ranked below the maximum',
  requirement_not_met: 'Did not meet a requirement',
  too_small: 'No room large enough',
  not_confirmed: 'Requirement not confirmed (agent asked for confirmed facts only)',
  unavailable: 'Booked on the requested dates',
  over_budget: "Over the guest's budget",
};

const OUTCOME_LABELS: Record<string, string> = {
  shown: 'Getoond aan de gast',
  ranked_lower: 'Gevonden, maar lager gerangschikt dan het maximum',
  requirement_not_met: 'Voldeed niet aan een eis',
  too_small: 'Geen kamer groot genoeg',
  not_confirmed: 'Eis niet bevestigd (agent vroeg alleen bevestigde gegevens)',
  unavailable: 'Bezet op de gevraagde data',
  over_budget: 'Boven het budget van de gast',
};

interface Consideration {
  requirements: Requirement[];
  outcome: string;
  failed: Requirement[];
  unknown: Requirement[];
}

/**
 * What agents looked for in this property's area, how often the property made
 * it into the answer, and — most useful — which unknown facts cost it guests.
 */
export function insights(store: Store, property: Property, days = 30, lang: Lang = currentLang()) {
  const nl = lang === 'nl';
  const since = new Date(Date.now() - days * 86_400_000);
  const outcomes: Record<string, number> = {};
  const asked: Partial<Record<Requirement, number>> = {};
  const unknownCost: Partial<Record<Requirement, number>> = {};
  const failed: Partial<Record<Requirement, number>> = {};
  const add = (target: Record<string, number>, key: string, n = 1) => (target[key] = (target[key] ?? 0) + n);
  let searches = 0;
  for (const d of store.demandFor(property.id, since)) {
    searches += d.searches;
    for (const [k, n] of Object.entries(d.outcomes)) add(outcomes, k, n);
    for (const [k, n] of Object.entries(d.asked)) add(asked, k, n);
    for (const [k, n] of Object.entries(d.unknown)) add(unknownCost, k, n);
    for (const [k, n] of Object.entries(d.failed)) add(failed, k, n);
  }
  // Data recorded by version 0.5 (one event per search) still counts.
  for (const e of store.eventsFor(property.id, since)) {
    if (e.type !== 'search_consideration') continue;
    const r = e.meta as unknown as Consideration;
    searches++;
    add(outcomes, r.outcome);
    for (const q of r.requirements ?? []) add(asked, q);
    for (const q of r.unknown ?? []) add(unknownCost, q);
    for (const q of r.failed ?? []) add(failed, q);
  }
  const top = (m: Partial<Record<Requirement, number>>) =>
    (Object.entries(m) as [Requirement, number][]).sort((a, b) => b[1] - a[1]).map(([requirement, count]) => ({ requirement, label: requirementLabel(requirement, lang), count }));

  // Actionable: unknown facts that agents asked about, which the owner can confirm today.
  const actions = top(unknownCost).map(({ requirement, label, count }) => {
    const facts = REQUIREMENT_FACTS[requirement] ?? [];
    const open = facts.filter((key) => {
      const def = getFactDefinition(key);
      if (!def) return false;
      if (def.scope === 'property') return readFact(property.facts, key).status !== 'confirmed';
      return property.units.some((u) => readFact(u.facts, key).status !== 'confirmed');
    });
    return {
      requirement,
      label,
      count,
      factsToConfirm: open.map((key) => ({ key, label: factLabel(key, lang) })),
      advice: open.length
        ? nl
          ? `${count}× vroegen agents naar "${label}" en was dat bij jou onbekend. Bevestig ${open.map((k) => `"${factLabel(k, lang)}"`).join(', ')} in je paspoort.`
          : `${count}× agents asked for "${label}" and it was unknown for you. Confirm ${open.map((k) => `"${factLabel(k, lang)}"`).join(', ')} in your passport.`
        : nl
          ? `${count}× vroegen agents naar "${label}". Je hebt het inmiddels bevestigd.`
          : `${count}× agents asked for "${label}". You have confirmed it since.`,
    };
  });

  return {
    periodDays: days,
    searchesInYourArea: searches,
    shown: outcomes.shown ?? 0,
    outcomes: Object.entries(outcomes).map(([outcome, count]) => ({ outcome, label: (nl ? OUTCOME_LABELS : OUTCOME_LABELS_EN)[outcome] ?? outcome, count })).sort((a, b) => b.count - a.count),
    mostAskedFor: top(asked).slice(0, 8),
    missedBecauseUnknown: actions.slice(0, 6),
    missedBecauseNotOffered: top(failed).slice(0, 6),
  };
}
