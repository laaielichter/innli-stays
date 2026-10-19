import { addDays, stayNights } from '../domain/dates.ts';
import type { BookingRequest, Property } from '../domain/types.ts';
import type { Store } from '../store.ts';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Escapes a text value for iCal (RFC 5545) and folds nothing longer than needed. */
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/**
 * The owner's own booking calendar: every confirmed stay (and pending requests,
 * marked tentative) as an event, to subscribe to in Google, Apple or Outlook
 * Calendar. Contains guest names, so the URL is secret.
 */
export function bookingsIcs(property: Property, requests: BookingRequest[], today = new Date().toISOString().slice(0, 10)): string {
  const d = (s: string) => s.replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//INNLI//Boekingen//NL', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsText(`${property.name} – boekingen`)}`];
  const since = addDays(today, -60);
  for (const r of requests) {
    if ((r.status !== 'accepted' && r.status !== 'new') || r.checkout < since) continue;
    const unit = property.units.find((u) => u.id === r.unitId)?.name ?? r.unitId;
    const rooms = (r.rooms ?? 1) > 1 ? `${r.rooms} × ` : '';
    const party = `${r.guests.adults + r.guests.children} pers.${r.guests.dogs ? ` + ${r.guests.dogs} hond(en)` : ''}`;
    const details = [`${rooms}${unit}`, party, `${property.currency} ${r.quotedTotal.toFixed(2)}`, r.guest.email, r.guest.phone, r.guest.message, r.agentClient ? `via ${r.agentClient}` : undefined].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${r.id}@${property.id}.innli`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d(r.checkin)}`,
      `DTEND;VALUE=DATE:${d(r.checkout)}`,
      `SUMMARY:${icsText(`${r.status === 'new' ? '(aanvraag) ' : ''}${r.guest.name} – ${rooms}${unit}`)}`,
      `DESCRIPTION:${icsText(details)}`,
      `STATUS:${r.status === 'new' ? 'TENTATIVE' : 'CONFIRMED'}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  // Formula injection guard for spreadsheet programs.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n,]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** All requests as CSV (semicolon-separated, opens directly in Dutch Excel). */
export function requestsCsv(property: Property, requests: BookingRequest[]): string {
  const head = ['reference', 'status', 'created', 'checkin', 'checkout', 'nights', 'room', 'rooms', 'rate_plan', 'adults', 'children', 'dogs', 'guest', 'email', 'phone', 'total', 'currency', 'deposit_due', 'deposit_status', 'channel', 'agent', 'extras', 'discount_code', 'cancel_reason'];
  const rows = requests
    .slice()
    .sort((a, b) => a.checkin.localeCompare(b.checkin))
    .map((r) => [
      r.id,
      r.status,
      r.createdAt.slice(0, 10),
      r.checkin,
      r.checkout,
      stayNights(r.checkin, r.checkout).length,
      property.units.find((u) => u.id === r.unitId)?.name ?? r.unitId,
      r.rooms ?? 1,
      r.ratePlanId ?? 'standard',
      r.guests.adults,
      r.guests.children,
      r.guests.dogs,
      r.guest.name,
      r.guest.email,
      r.guest.phone,
      r.quotedTotal.toFixed(2),
      property.currency,
      r.payment?.amountDue?.toFixed(2),
      r.payment?.status,
      channelOf(r),
      r.agentClient,
      r.extras?.map((x) => `${x.qty}x ${x.id}`).join(' '),
      r.discountCode,
      r.cancelReason,
    ]);
  return '\ufeff' + [head, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

export type Channel = 'agent' | 'stay_page' | 'website';
/** Agent: sent by an agent, or by a guest who arrived through an agent's link. Otherwise the stay page. */
export const channelOf = (r: BookingRequest): Channel => (r.agentClient ? 'agent' : 'stay_page');

/**
 * Occupancy per month (nights sold ÷ nights on sale, per room) and revenue per
 * channel: agent requests, the stay page, and bookings on the owner's own
 * website that came through an agent link (reported back by the plugin).
 */
export function monthlyStats(store: Store, property: Property, months = 12, today = new Date().toISOString().slice(0, 10)) {
  const start = `${addMonths(today.slice(0, 7), -(months - 1))}-01`;
  const end = `${addMonths(today.slice(0, 7), 1)}-01`;
  const out = new Map<string, { month: string; nightsOnSale: number; nightsSold: number; revenue: Record<Channel, number>; bookings: Record<Channel, number> }>();
  for (let m = start.slice(0, 7); m < end.slice(0, 7); m = addMonths(m, 1)) out.set(m, { month: m, nightsOnSale: 0, nightsSold: 0, revenue: { agent: 0, stay_page: 0, website: 0 }, bookings: { agent: 0, stay_page: 0, website: 0 } });

  for (const u of property.units) {
    const closed = new Set(u.closedNights ?? []);
    const inventory = Math.max(1, u.inventory ?? 1);
    for (const night of stayNights(start, end, 800)) {
      const row = out.get(night.slice(0, 7));
      // A single room closed by the owner might be a booking from another channel: not counted as on sale.
      if (row) row.nightsOnSale += inventory === 1 && closed.has(night) ? 0 : inventory;
    }
  }
  for (const r of store.requestsFor(property.id)) {
    if (r.status !== 'accepted') continue;
    const rooms = r.rooms ?? 1;
    for (const night of stayNights(r.checkin, r.checkout, 400)) {
      const row = out.get(night.slice(0, 7));
      if (row) {
        row.nightsSold += rooms;
        // Single rooms are closed on acceptance; put that night back on sale so occupancy is sold ÷ sellable.
        if ((property.units.find((u) => u.id === r.unitId)?.inventory ?? 1) === 1) row.nightsOnSale += rooms;
      }
    }
    const row = out.get(r.checkin.slice(0, 7));
    if (row) {
      const ch = channelOf(r);
      row.revenue[ch] = round2(row.revenue[ch] + r.quotedTotal);
      row.bookings[ch]++;
    }
  }
  for (const e of store.eventsFor(property.id, new Date(`${start}T00:00:00Z`))) {
    if (e.type !== 'booking_confirmed' || e.meta?.mode !== 'booking_link') continue;
    const row = out.get(e.at.slice(0, 7));
    if (!row) continue;
    row.bookings.website++;
    if (typeof e.meta?.amount === 'number') row.revenue.website = round2(row.revenue.website + e.meta.amount);
  }
  const rows = [...out.values()].map((r) => ({ ...r, occupancyPercent: r.nightsOnSale ? Math.round((Math.min(r.nightsSold, r.nightsOnSale) / r.nightsOnSale) * 1000) / 10 : 0 }));
  const sum = (ch: Channel) => round2(rows.reduce((s, r) => s + r.revenue[ch], 0));
  return { currency: property.currency, months: rows, totals: { revenue: { agent: sum('agent'), stay_page: sum('stay_page'), website: sum('website') }, bookings: { agent: rows.reduce((s, r) => s + r.bookings.agent, 0), stay_page: rows.reduce((s, r) => s + r.bookings.stay_page, 0), website: rows.reduce((s, r) => s + r.bookings.website, 0) } } };
}

function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
