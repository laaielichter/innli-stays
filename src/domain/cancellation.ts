import type { CancellationRule, Property } from './types.ts';

/**
 * Cancellation costs from the owner's structured rules: the strictest rule whose
 * "fewer than N days before arrival" applies. A non-refundable rate plan costs
 * the full amount. Without structured rules the cost is unknown, never guessed.
 */
export interface CancellationCost {
  /** null when the owner has no structured rules (only a text policy). */
  amount: number | null;
  percent: number | null;
  daysBeforeArrival: number;
  rule?: string;
  /** Free cancellation until this date (inclusive), when a later rule starts charging. */
  freeUntil?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Rules sorted from the furthest out to the closest to arrival. */
export function sortedRules(rules: CancellationRule[]): CancellationRule[] {
  return [...rules].filter((r) => r.daysBefore >= 0 && r.percent >= 0).sort((a, b) => b.daysBefore - a.daysBefore);
}

export function cancellationCost(property: Property, stay: { checkin: string; total: number; ratePlanId?: string }, today = new Date().toISOString().slice(0, 10)): CancellationCost {
  const days = Math.round((Date.parse(`${stay.checkin}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const plan = stay.ratePlanId ? property.ratePlans?.find((p) => p.id === stay.ratePlanId) : undefined;
  if (plan && !plan.refundable) return { amount: round2(stay.total), percent: 100, daysBeforeArrival: days, rule: plan.name };
  const rules = sortedRules(property.cancellationRules ?? []);
  if (!rules.length) return { amount: null, percent: null, daysBeforeArrival: days };
  // The rule with the fewest days that still applies is the strictest one that has started.
  const applying = rules.filter((r) => days < r.daysBefore);
  const percent = applying.length ? Math.max(...applying.map((r) => r.percent)) : 0;
  const first = rules.find((r) => r.percent > 0);
  return {
    amount: round2((stay.total * percent) / 100),
    percent,
    daysBeforeArrival: days,
    rule: applying.length ? `< ${Math.min(...applying.map((r) => r.daysBefore))}` : undefined,
    freeUntil: percent === 0 && first ? addDays(stay.checkin, -first.daysBefore) : undefined,
  };
}

/** The full schedule for a quote: what cancelling would cost from which date on. */
export function cancellationSchedule(property: Property, stay: { checkin: string; total: number; ratePlanId?: string }) {
  const plan = stay.ratePlanId ? property.ratePlans?.find((p) => p.id === stay.ratePlanId) : undefined;
  if (plan && !plan.refundable) return [{ from: 'booking', percent: 100, amount: round2(stay.total) }];
  return sortedRules(property.cancellationRules ?? []).map((r) => ({ from: addDays(stay.checkin, -r.daysBefore), percent: r.percent, amount: round2((stay.total * r.percent) / 100) }));
}
