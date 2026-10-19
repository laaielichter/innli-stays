import { t } from '../i18n/index.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class DateRangeError extends Error {}

function toUtc(date: string): number {
  if (!DATE_RE.test(date)) throw new DateRangeError(t('date.invalidFormat', { date }));
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== date) {
    throw new DateRangeError(t('date.invalid', { date }));
  }
  return ms;
}

export function addDays(date: string, days: number): string {
  return new Date(toUtc(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** All nights of a stay, identified by the date the night starts. */
export function stayNights(checkin: string, checkout: string, maxNights = 60): string[] {
  const start = toUtc(checkin);
  const end = toUtc(checkout);
  const nights = Math.round((end - start) / 86_400_000);
  if (nights < 1) throw new DateRangeError(t('date.checkoutBeforeCheckin'));
  if (nights > maxNights) throw new DateRangeError(t('date.tooManyNights', { n: maxNights }));
  return Array.from({ length: nights }, (_, i) => addDays(checkin, i));
}

export function assertNotInPast(checkin: string, now = new Date()): void {
  const today = now.toISOString().slice(0, 10);
  if (toUtc(checkin) < toUtc(today)) throw new DateRangeError(t('date.inPast'));
}

export function isWeekendNight(date: string): boolean {
  const day = new Date(toUtc(date)).getUTCDay();
  return day === 5 || day === 6;
}
