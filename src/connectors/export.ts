import { createHmac } from 'node:crypto';
import { addDays } from '../domain/dates.ts';
import type { Property, Unit } from '../domain/types.ts';

/** Unguessable per-unit token for the public calendar export URL. */
export function calendarToken(property: Property, unitId: string): string {
  return createHmac('sha256', property.webhookSecret).update(`calendar:${unitId}`).digest('base64url').slice(0, 24);
}

/** Unguessable token for the owner's own booking calendar feed. */
export function bookingsToken(property: Property): string {
  return createHmac('sha256', property.webhookSecret).update('bookings').digest('base64url').slice(0, 32);
}

/**
 * iCal feed of the nights the owner closed in INNLI, so Airbnb, Booking.com or
 * a channel manager can import them. Imported feeds are deliberately not
 * re-exported: that would let platforms block each other in a loop.
 */
export function exportIcs(property: Property, unit: Unit, today = new Date().toISOString().slice(0, 10)): string {
  const nights = [...new Set(unit.closedNights ?? [])].filter((n) => n >= today).sort();
  const ranges: { start: string; end: string }[] = [];
  for (const n of nights) {
    const last = ranges[ranges.length - 1];
    if (last && last.end === n) last.end = addDays(n, 1);
    else ranges.push({ start: n, end: addDays(n, 1) });
  }
  const d = (s: string) => s.replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//INNLI//Kamerkalender//NL', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${property.name} – ${unit.name}`];
  for (const r of ranges) {
    lines.push('BEGIN:VEVENT', `UID:${unit.id}-${r.start}@${property.id}.innli`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d(r.start)}`, `DTEND;VALUE=DATE:${d(r.end)}`, 'SUMMARY:Niet beschikbaar', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
