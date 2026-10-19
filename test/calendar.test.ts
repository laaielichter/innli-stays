import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { addDays } from '../src/domain/dates.ts';
import { AvailabilityService } from '../src/connectors/availability.ts';
import { exportIcs } from '../src/connectors/export.ts';
import { isNightBlocked, parseIcs } from '../src/connectors/ical.ts';
import { createProperty, createUnit, propertyPatchSchema } from '../src/properties.ts';
import { freeWindow, ownerKey, startTestServer, type TestServer } from './helpers.ts';

const guests = { adults: 2, children: 0, dogs: 0 };
const ics = (start: string, end: string) => `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${start}\r\nDTEND;VALUE=DATE:${end}\r\nEND:VEVENT\r\nEND:VCALENDAR`;

function setup() {
  const { property } = createProperty({ name: 'X', address: { city: 'Ede', country: 'NL' } });
  const unit = createUnit({ name: 'K', maxGuests: 2, includedGuests: 2, baseRatePerNight: 80 }, 'k');
  property.units.push(unit);
  return { property, unit };
}

describe('room calendars', () => {
  it('combines several feeds: a night booked on any channel is unavailable', async () => {
    const { property, unit } = setup();
    property.booking.connector = { kind: 'ical', calendars: { k: ['https://airbnb.example/k.ics', 'https://booking.example/k.ics'] } };
    const feeds: Record<string, string> = { 'airbnb.example': ics('20301001', '20301003'), 'booking.example': ics('20301010', '20301011') };
    const service = new AvailabilityService(async (url) => new Response(feeds[new URL(url).host]));
    assert.equal((await service.check(property, unit, ['2030-10-01'], guests)).status, 'unavailable');
    assert.equal((await service.check(property, unit, ['2030-10-10'], guests)).status, 'unavailable');
    const free = await service.check(property, unit, ['2030-10-05', '2030-10-06'], guests);
    assert.equal(free.status, 'available');
    assert.equal(free.certainty, 'synced');
    assert.match(free.note, /alle 2/);
  });

  it('does not claim a room is free when one feed cannot be read', async () => {
    const { property, unit } = setup();
    property.booking.connector = { kind: 'ical', calendars: { k: ['https://ok.example/k.ics', 'https://down.example/k.ics'] } };
    const service = new AvailabilityService(async (url) => (url.includes('down') ? new Response('', { status: 500 }) : new Response(ics('20301001', '20301002'))));
    const r = await service.check(property, unit, ['2030-10-05'], guests);
    assert.equal(r.status, 'unknown');
    const overview = await service.overview(property, unit, ['2030-10-01', '2030-10-05']);
    assert.deepEqual(overview.nights.map((n) => n.state), ['booked_elsewhere', 'open']);
    assert.equal(overview.feedErrors.length, 1);
  });

  it('accepts old single-URL calendar data', async () => {
    const { property, unit } = setup();
    property.booking.connector = { kind: 'ical', calendars: { k: 'https://old.example/k.ics' } };
    const service = new AvailabilityService(async () => new Response(ics('20301001', '20301002')));
    assert.equal((await service.check(property, unit, ['2030-10-01'], guests)).status, 'unavailable');
    const parsed = propertyPatchSchema.parse({ booking: { connector: { kind: 'ical', calendars: { k: 'https://a.example/x.ics' } } } });
    assert.deepEqual(parsed.booking?.connector, { kind: 'ical', calendars: { k: ['https://a.example/x.ics'] } });
  });

  it('manual room calendar: owner closures win, open nights are indicative', async () => {
    const { property, unit } = setup();
    property.booking.connector = { kind: 'manual' };
    unit.closedNights = ['2030-10-02'];
    const service = new AvailabilityService(async () => assert.fail('no fetch for manual'));
    assert.equal((await service.check(property, unit, ['2030-10-01', '2030-10-02'], guests)).status, 'unavailable');
    const open = await service.check(property, unit, ['2030-10-03'], guests);
    assert.equal(open.status, 'available');
    assert.equal(open.certainty, 'synced');
  });

  it('owner closures also apply on top of connected feeds', async () => {
    const { property, unit } = setup();
    property.booking.connector = { kind: 'ical', calendars: { k: ['https://a.example/k.ics'] } };
    unit.closedNights = ['2030-10-20'];
    const service = new AvailabilityService(async () => new Response(ics('20301001', '20301002')));
    assert.equal((await service.check(property, unit, ['2030-10-20'], guests)).status, 'unavailable');
  });

  it('exports closures as an iCal feed with merged ranges', () => {
    const { property, unit } = setup();
    unit.closedNights = ['2030-10-01', '2030-10-02', '2030-10-05', '2020-01-01'];
    const out = exportIcs(property, unit, '2026-01-01');
    const ranges = parseIcs(out);
    assert.deepEqual(ranges.map((r) => [r.start, r.end]), [['2030-10-01', '2030-10-03'], ['2030-10-05', '2030-10-06']]);
    assert.ok(isNightBlocked(ranges, '2030-10-02'));
  });
});

describe('room calendar via API and MCP', () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(() => server.close());

  it('owner closes a night; agents see it, the export feed contains it', async () => {
    const key = ownerKey(server, 'prop_duinzicht');
    const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
    const { checkin } = freeWindow(['duinzicht-2'], 2);
    const put = await fetch(`${server.url}/api/owner/units/kamer-2/closed`, { method: 'PUT', headers, body: JSON.stringify({ closedNights: [checkin, '2020-01-01'] }) });
    assert.deepEqual((await put.json()).closedNights, [checkin], 'past nights are dropped');

    const cal = await (await fetch(`${server.url}/api/owner/units/kamer-2/calendar?days=60`, { headers })).json();
    assert.equal(cal.nights.find((n: { date: string }) => n.date === checkin).state, 'closed_by_owner');
    assert.ok(cal.nights.some((n: { state: string }) => n.state === 'booked_elsewhere'), 'demo feed has bookings');

    const feed = await fetch(cal.exportUrl);
    assert.equal(feed.status, 200);
    assert.ok(isNightBlocked(parseIcs(await feed.text()), checkin));
    const forged = await fetch(cal.exportUrl.replace(/key=[^&]+/, 'key=wrong'));
    assert.equal(forged.status, 404);

    const client = new Client({ name: 't', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`)));
    const res = (await client.callTool({ name: 'check_availability', arguments: { propertyId: 'prop_duinzicht', checkin, checkout: addDays(checkin, 1) } })) as unknown as { structuredContent: { units: { unitId: string; status: string; note: string }[] } };
    await client.close();
    const unit = res.structuredContent.units.find((u) => u.unitId === 'kamer-2')!;
    assert.equal(unit.status, 'unavailable');
    assert.match(unit.note, /Closed by the host/);
  });
});
