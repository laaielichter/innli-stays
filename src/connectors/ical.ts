/**
 * Minimal iCalendar (RFC 5545) reader for availability calendars as exported by
 * Airbnb, Booking.com, and most channel managers. Only VEVENT DTSTART/DTEND
 * are relevant: every night in [DTSTART, DTEND) is blocked.
 */

export interface BlockedRange {
  start: string;
  end: string;
  summary?: string;
}

function unfold(ics: string): string[] {
  return ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseIcsDate(value: string): string | null {
  // 20261010, 20261010T150000Z, 20261010T150000
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function parseIcs(ics: string): BlockedRange[] {
  const ranges: BlockedRange[] = [];
  let current: Partial<BlockedRange> | null = null;
  for (const line of unfold(ics)) {
    if (line === 'BEGIN:VEVENT') current = {};
    else if (line === 'END:VEVENT') {
      if (current?.start) {
        // An event without DTEND covers a single day.
        const end = current.end ?? new Date(Date.parse(`${current.start}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
        if (end > current.start) ranges.push({ start: current.start, end, summary: current.summary });
      }
      current = null;
    } else if (current) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const name = line.slice(0, idx).split(';')[0].toUpperCase();
      const value = line.slice(idx + 1);
      if (name === 'DTSTART') current.start = parseIcsDate(value) ?? undefined;
      else if (name === 'DTEND') current.end = parseIcsDate(value) ?? undefined;
      else if (name === 'SUMMARY') current.summary = value;
    }
  }
  return ranges;
}

export function isNightBlocked(ranges: BlockedRange[], night: string): boolean {
  return ranges.some((r) => night >= r.start && night < r.end);
}
