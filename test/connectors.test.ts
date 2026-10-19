import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AvailabilityService } from '../src/connectors/availability.ts';
import { isNightBlocked, parseIcs } from '../src/connectors/ical.ts';
import { fillTemplate, validateDeeplinkTemplate } from '../src/booking/links.ts';
import { createProperty, createUnit } from '../src/properties.ts';
import type { Quote } from '../src/domain/types.ts';

const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20301010',
  'DTEND;VALUE=DATE:20301013',
  'SUMMARY:Airbnb (Not avail',
  ' able)',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20301020T140000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('ical', () => {
  it('parses blocked ranges with end-exclusive nights and folded lines', () => {
    const ranges = parseIcs(ICS);
    assert.equal(ranges.length, 2);
    assert.equal(ranges[0].summary, 'Airbnb (Not available)');
    assert.equal(isNightBlocked(ranges, '2030-10-09'), false);
    assert.equal(isNightBlocked(ranges, '2030-10-10'), true);
    assert.equal(isNightBlocked(ranges, '2030-10-12'), true);
    assert.equal(isNightBlocked(ranges, '2030-10-13'), false, 'checkout day is free');
    assert.equal(isNightBlocked(ranges, '2030-10-20'), true, 'event without DTEND blocks one night');
  });

  it('reports calendar availability as synced, never live', async () => {
    const { property } = createProperty({ name: 'X', address: { city: 'Ede', country: 'NL' } });
    const unit = createUnit({ name: 'K', maxGuests: 2, includedGuests: 2, baseRatePerNight: 80 }, 'k');
    property.booking.connector = { kind: 'ical', calendars: { k: 'https://cal.example/k.ics' } };
    const service = new AvailabilityService(async () => new Response(ICS));
    const free = await service.check(property, unit, ['2030-10-13', '2030-10-14'], { adults: 2, children: 0, dogs: 0 });
    assert.equal(free.status, 'available');
    assert.equal(free.certainty, 'synced');
    const busy = await service.check(property, unit, ['2030-10-12'], { adults: 2, children: 0, dogs: 0 });
    assert.equal(busy.status, 'unavailable');
  });

  it('degrades to unknown when the booking system fails', async () => {
    const { property } = createProperty({ name: 'X', address: { city: 'Ede', country: 'NL' } });
    const unit = createUnit({ name: 'K', maxGuests: 2, includedGuests: 2, baseRatePerNight: 80 }, 'k');
    property.booking.connector = { kind: 'live_api', baseUrl: 'https://pms.example/api' };
    const service = new AvailabilityService(async () => new Response('oops', { status: 503 }));
    const r = await service.check(property, unit, ['2030-10-13'], { adults: 2, children: 0, dogs: 0 });
    assert.equal(r.status, 'unknown');
    assert.match(r.note, /503/);
  });
});

describe('booking links', () => {
  const quote = { checkin: '2030-10-13', checkout: '2030-10-15', guests: { adults: 2, children: 1, dogs: 1 } } as Quote;
  const unit = createUnit({ name: 'K', externalRef: 'room 7', maxGuests: 3, includedGuests: 2, baseRatePerNight: 80 }, 'k');

  it('fills placeholders url-encoded and appends a ref when the template has none', () => {
    const url = fillTemplate('https://book.example/r?in={checkin}&out={checkout}&a={adults}&c={children}&room={unit}', quote, unit, 'abc');
    assert.equal(url, 'https://book.example/r?in=2030-10-13&out=2030-10-15&a=2&c=1&room=room%207&innli_ref=abc');
  });

  it('validates templates', () => {
    assert.equal(validateDeeplinkTemplate('https://book.example/?d={checkin}'), null);
    assert.match(validateDeeplinkTemplate('https://book.example/?d={date}')!, /date/);
    assert.ok(validateDeeplinkTemplate('javascript:alert(1)//{checkin}'));
  });
});
