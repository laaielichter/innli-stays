import { t } from '../i18n/index.ts';
import { isWeekendNight } from './dates.ts';
import type { Season, Unit } from './types.ts';

const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isValidMonthDay(s: string): boolean {
  return MMDD.test(s);
}

/** Whether a night (YYYY-MM-DD) falls in a recurring season, including seasons that wrap the year end. */
export function inSeason(season: Season, night: string): boolean {
  const md = night.slice(5);
  return season.from <= season.to ? md >= season.from && md <= season.to : md >= season.from || md <= season.to;
}

export interface NightPrice {
  date: string;
  amount: number;
  season?: string;
  weekend: boolean;
}

/** Price per night from the owner's rate table: season rate (or base rate), plus weekend supplement. */
export function nightPrices(unit: Unit, nights: string[]): NightPrice[] {
  const seasons = unit.rates?.seasons ?? [];
  const supplement = unit.rates?.weekendSupplement ?? 0;
  return nights.map((date) => {
    // The last matching season wins, so a short "Kerst" period can sit inside a longer "Winter".
    const season = [...seasons].reverse().find((s) => inSeason(s, date));
    const weekend = isWeekendNight(date);
    return { date, amount: (season?.ratePerNight ?? unit.baseRatePerNight) + (weekend ? supplement : 0), season: season?.name, weekend };
  });
}

/** Longest minimum stay of any season the stay touches. */
export function seasonMinNights(unit: Unit, nights: string[]): { minNights: number; season: string } | null {
  let best: { minNights: number; season: string } | null = null;
  for (const s of unit.rates?.seasons ?? []) {
    if (!s.minNights || !nights.some((n) => inSeason(s, n))) continue;
    if (!best || s.minNights > best.minNights) best = { minNights: s.minNights, season: s.name };
  }
  return best;
}

/** Best single discount for a stay (no stacking), or null. Only applies to the owner's own rates. */
export function bestDiscount(unit: Unit, checkin: string, nights: number, today = new Date().toISOString().slice(0, 10)): { label: string; percent: number } | null {
  const d = unit.rates?.discounts;
  if (!d) return null;
  const lead = Math.round((Date.parse(`${checkin}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const options: { label: string; percent: number }[] = [];
  for (const l of d.longStay ?? []) if (nights >= l.minNights) options.push({ label: t('disc.longStay', { n: l.minNights }), percent: l.percent });
  if (d.lastMinute && lead <= d.lastMinute.withinDays) options.push({ label: t('disc.lastMinute'), percent: d.lastMinute.percent });
  if (d.earlyBird && lead >= d.earlyBird.minDaysAhead) options.push({ label: t('disc.earlyBird'), percent: d.earlyBird.percent });
  return options.sort((a, b) => b.percent - a.percent)[0] ?? null;
}

/** Weekdays arrival is allowed on for this stay (season of the arrival night first, then the unit's rule), or null when any day is fine. */
export function checkinDaysFor(unit: Unit, checkin: string): { days: number[]; season?: string } | null {
  const season = [...(unit.rates?.seasons ?? [])].reverse().find((s) => s.checkinDays?.length && inSeason(s, checkin));
  if (season) return { days: season.checkinDays!, season: season.name };
  return unit.rates?.checkinDays?.length ? { days: unit.rates.checkinDays } : null;
}
