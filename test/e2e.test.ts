import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { signPayload } from '../src/http/auth.ts';
import { freeWindow, ownerKey, startTestServer, type TestServer } from './helpers.ts';

type Json = Record<string, any>;

async function mcpClient(server: TestServer, key = server.creds.agentKey): Promise<Client> {
  const client = new Client({ name: 'test-agent', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${key}` } } }));
  return client;
}

async function call(client: Client, name: string, args: Json): Promise<Json> {
  const res = (await client.callTool({ name, arguments: args })) as Json;
  if (res.isError) throw new Error(res.content[0].text);
  return res.structuredContent;
}

describe('agent flow over MCP', () => {
  let server: TestServer;
  let client: Client;

  before(async () => {
    server = await startTestServer();
    client = await mcpClient(server);
  });
  after(async () => {
    await client.close();
    await server.close();
  });

  it('exposes the agent tools', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      'answer_question', 'ask_host', 'cancel_request', 'check_availability', 'check_status', 'compare_stays', 'find_available_dates', 'get_availability_calendar',
      'get_quote', 'get_stay_details', 'get_wish_offers', 'join_waitlist', 'modify_request', 'post_stay_wish', 'prepare_booking', 'report_data_issue', 'request_booking', 'search_stays', 'withdraw_stay_wish',
    ]);
  });

  it('answers the dog + enclosed garden + ground floor + breakfast + budget question honestly', async () => {
    const { checkin, checkout } = freeWindow(['hooiberg-tuinkamer', 'kraaiennest-bos'], 2);
    const result = await call(client, 'search_stays', {
      area: 'Veluwe',
      checkin,
      checkout,
      guests: { adults: 2, children: 0, dogs: 1 },
      requirements: ['enclosed_garden', 'ground_floor_unit', 'breakfast_available'],
      breakfast: true,
      maxTotalPrice: 350,
    });
    const names = result.results.map((r: Json) => r.name);
    assert.deepEqual(names, ['B&B De Hooiberg', 'Logies Het Kraaiennest']);
    assert.ok(!names.includes('Pension Duinzicht'), 'not in the Veluwe and no dogs');

    const [hooiberg, kraaiennest] = result.results;
    assert.equal(hooiberg.matchQuality, 'met');
    assert.equal(hooiberg.unit.name, 'Tuinkamer');
    assert.equal(hooiberg.offer.totalIncludesAllMandatoryCosts, true);
    assert.equal(hooiberg.offer.priceCertainty, 'live');
    assert.equal(hooiberg.offer.bookingMode, 'booking_link');
    assert.ok(hooiberg.offer.total <= 350);

    // The garden was only seen on the website, and cleaning costs are unknown.
    assert.equal(kraaiennest.matchQuality, 'unverified');
    assert.equal(kraaiennest.criteria.find((c: Json) => c.requirement === 'enclosed_garden').level, 'unverified');
    assert.equal(kraaiennest.offer.totalIncludesAllMandatoryCosts, false);
    assert.ok(kraaiennest.offer.warnings.some((w: string) => w.includes('Cleaning fee')));

    const strict = await call(client, 'search_stays', { area: 'Veluwe', checkin, checkout, guests: { adults: 2, dogs: 1 }, requirements: ['enclosed_garden'], confirmedOnly: true });
    assert.deepEqual(strict.results.map((r: Json) => r.name), ['B&B De Hooiberg']);
  });

  it('lists unknowns explicitly in stay details', async () => {
    const details = await call(client, 'get_stay_details', { propertyId: 'prop_kraaiennest' });
    assert.ok(details.facts.unknown.includes('Mandatory cleaning fee per stay'));
    const garden = details.facts.facts.find((f: Json) => f.key === 'garden.fullyEnclosed');
    assert.equal(garden.status, 'unconfirmed');
    assert.equal(garden.source, 'website');
  });

  it('runs quote -> booking link -> click-through -> reported booking, and keeps them apart in analytics', async () => {
    const { checkin, checkout } = freeWindow(['hooiberg-tuinkamer'], 2);
    const quote = await call(client, 'get_quote', { propertyId: 'prop_hooiberg', unitId: 'tuinkamer', checkin, checkout, guests: { adults: 2, dogs: 1 }, breakfast: true });
    assert.equal(quote.bookingMode, 'booking_link');
    const booking = await call(client, 'prepare_booking', { quoteId: quote.quoteId });
    assert.equal(booking.status, 'not_booked');
    assert.match(booking.url, /\/r\//);

    const redirect = await fetch(booking.url, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0' } });
    assert.equal(redirect.status, 302);
    const target = new URL(redirect.headers.get('location')!);
    assert.equal(target.pathname, '/demo-engine/book');
    assert.equal(target.searchParams.get('checkin'), checkin);
    assert.equal(target.searchParams.get('unit'), 'hooiberg-tuinkamer');
    assert.equal(target.searchParams.get('dogs'), '1');
    assert.equal(target.searchParams.get('ref'), booking.reference);

    // A link preview bot does not count as a click-through.
    await fetch(booking.url, { redirect: 'manual', headers: { 'user-agent': 'Slackbot-LinkExpanding 1.0' } });

    const property = server.store.getProperty('prop_hooiberg')!;
    const body = JSON.stringify({ propertyId: property.id, ref: booking.reference, bookingReference: 'PMS-123', amount: quote.total });
    const forged = await fetch(`${server.url}/api/conversions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-innli-signature': 'deadbeef' }, body });
    assert.equal(forged.status, 401);
    const signed = { method: 'POST', headers: { 'content-type': 'application/json', 'x-innli-signature': signPayload(property.webhookSecret, body) }, body };
    assert.deepEqual(await (await fetch(`${server.url}/api/conversions`, signed)).json(), { recorded: true });
    assert.deepEqual(await (await fetch(`${server.url}/api/conversions`, signed)).json(), { recorded: false }, 'deduplicated');

    const analytics = await (await fetch(`${server.url}/api/owner/analytics`, { headers: { authorization: `Bearer ${ownerKey(server, 'prop_hooiberg')}` } })).json();
    assert.equal(analytics.clickThroughs, 1);
    assert.equal(analytics.confirmedBookings, 1);
    assert.equal(analytics.confirmedRevenue, quote.total);
    assert.ok(analytics.agentRequests.quotes >= 1);
    assert.equal(analytics.byAgent['Demo Reisagent'].bookings, 1);
  });

  it('offers only an availability request for calendar-synced stays', async () => {
    const { checkin, checkout } = freeWindow(['duinzicht-2'], 2);
    const avail = await call(client, 'check_availability', { propertyId: 'prop_duinzicht', checkin, checkout, guests: { adults: 2 } });
    const unit = avail.units.find((u: Json) => u.unitId === 'kamer-2');
    assert.equal(unit.status, 'available');
    assert.equal(unit.certainty, 'synced');
    const quote = await call(client, 'get_quote', { propertyId: 'prop_duinzicht', unitId: 'kamer-2', checkin, checkout, guests: { adults: 2 } });
    assert.equal(quote.bookingMode, 'availability_request');
    assert.equal(quote.priceCertainty, 'indicative');
    const booking = await call(client, 'prepare_booking', { quoteId: quote.quoteId });
    assert.match(booking.instructionsForGuest, /not a booking/);
  });

  it('returns tool errors for invalid input instead of crashing', async () => {
    const res = (await client.callTool({ name: 'get_quote', arguments: { propertyId: 'prop_hooiberg', unitId: 'tuinkamer', checkin: '2020-01-01', checkout: '2020-01-03' } })) as Json;
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /in the past/);
    const missing = (await client.callTool({ name: 'get_stay_details', arguments: { propertyId: 'nope' } })) as Json;
    assert.equal(missing.isError, true);
  });
});

describe('owner API', () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer({ requireAgentKey: true });
  });
  after(() => server.close());

  const api = (path: string, key: string | null, init: RequestInit = {}) =>
    fetch(`${server.url}/api/owner${path}`, { ...init, headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) } });

  it('rejects missing or wrong keys', async () => {
    assert.equal((await api('/property', null)).status, 401);
    assert.equal((await api('/property', 'innli_own_wrong')).status, 401);
    const mcp = await fetch(`${server.url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
    assert.equal(mcp.status, 401, 'agent key required when configured');
  });

  it('owner edits are confirmations; owners can also mark facts unknown', async () => {
    const key = ownerKey(server, 'prop_kraaiennest');
    const before = (await (await api('/property', key)).json()).completeness;
    const confirm = await api('/facts/garden.fullyEnclosed/confirm', key, { method: 'POST', body: '{}' });
    assert.equal((await confirm.json()).fact.status, 'confirmed');
    const set = await (await api('/facts/fees.cleaningPerStay', key, { method: 'PUT', body: JSON.stringify({ value: 0 }) })).json();
    assert.equal(set.fact.status, 'confirmed');
    assert.ok(set.completeness.score > before.score);
    const unit = await api('/facts/bed.lengthCm', key, { method: 'PUT', body: JSON.stringify({ value: 220 }) });
    assert.equal(unit.status, 400, 'unit fact without unitId');
    const unitOk = await api('/facts/bed.lengthCm', key, { method: 'PUT', body: JSON.stringify({ value: 220, unitId: 'boskamer' }) });
    assert.equal(unitOk.status, 200);
    const unknown = await (await api('/facts/location.quiet/unknown', key, { method: 'POST', body: '{}' })).json();
    assert.equal(unknown.fact.status, 'unknown');
  });

  it('validates booking configuration', async () => {
    const key = ownerKey(server, 'prop_hooiberg');
    const bad = await api('/property', key, { method: 'PATCH', body: JSON.stringify({ booking: { connector: { kind: 'none' }, deeplinkTemplate: 'https://x.example/?d={datum}' } }) });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /datum/);
  });

  it('previews what agents see, including for unpublished stays', async () => {
    const key = ownerKey(server, 'prop_duinzicht');
    await api('/property', key, { method: 'PATCH', body: JSON.stringify({ published: false }) });
    const preview = await (await api('/agent-preview', key)).json();
    assert.equal(preview.published, false);
    assert.equal(preview.details.name, 'Pension Duinzicht');
    const pub = await fetch(`${server.url}/api/public/properties/prop_duinzicht/passport`);
    assert.equal(pub.status, 404);
  });

  it('admin creates properties and agent keys', async () => {
    const res = await fetch(`${server.url}/api/admin/properties`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer admin-test-key' }, body: JSON.stringify({ name: 'Nieuwe B&B', address: { city: 'Zwolle', country: 'nl' } }) });
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.match(created.ownerKey, /^innli_own_/);
    assert.equal(created.property.ownerKeyHash, undefined);
    assert.equal((await api('/property', created.ownerKey)).status, 200);
    const noAdmin = await fetch(`${server.url}/api/admin/agents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"x"}' });
    assert.equal(noAdmin.status, 401);
  });
});
