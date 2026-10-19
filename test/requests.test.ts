import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { addDays } from '../src/domain/dates.ts';
import { freeWindow, ownerKey, startTestServer, type TestServer } from './helpers.ts';

type Json = Record<string, any>;

const form = (data: Record<string, string>) => new URLSearchParams(data).toString();
const post = (server: TestServer, path: string, data: Record<string, string>) =>
  fetch(`${server.url}${path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': String(Math.random()) }, body: form(data) });

describe('stay page and booking requests', () => {
  let server: TestServer;
  let headers: Record<string, string>;
  before(async () => {
    server = await startTestServer();
    headers = { authorization: `Bearer ${ownerKey(server, 'prop_duinzicht')}`, 'content-type': 'application/json' };
  });
  after(() => server.close());

  it('renders a public stay page with structured data, availability and a request form', async () => {
    const res = await fetch(`${server.url}/verblijf/duinzicht`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<h1>Pension Duinzicht<\/h1>/);
    assert.match(html, /application\/ld\+json/);
    assert.match(html, /Beschikbaarheid aanvragen/);
    assert.match(html, /class="d"/, 'mini calendar from the iCal feeds');
    assert.doesNotMatch(html, /name="dogs" min/, 'no dog field where dogs are not allowed');
    assert.equal((await fetch(`${server.url}/verblijf/bestaat-niet`)).status, 404);
  });

  it('serves a sitemap and robots.txt that keep private pages out', async () => {
    const sitemap = await (await fetch(`${server.url}/sitemap.xml`)).text();
    assert.match(sitemap, /\/verblijf\/duinzicht<\/loc>/);
    const robots = await (await fetch(`${server.url}/robots.txt`)).text();
    assert.match(robots, /Disallow: \/aanvraag\//);
    assert.match(robots, /Sitemap: .*\/sitemap\.xml/);
  });

  it('shows a live price for the chosen dates, using season rates', async () => {
    const { checkin } = freeWindow(['duinzicht-2'], 2);
    const html = await (await fetch(`${server.url}/verblijf/duinzicht/prijs?unitId=kamer-2&checkin=${checkin}&checkout=${addDays(checkin, 2)}&adults=2`)).text();
    assert.match(html, /Totaal/);
    assert.match(html, /Tarieven van de eigenaar/);
    assert.match(html, /Toeristenbelasting/);
  });

  it('turns an agent hand-off into a request that the owner accepts, closing the nights and counting the booking', async () => {
    const { checkin, checkout } = freeWindow(['duinzicht-2'], 2);
    const client = new Client({ name: 'agent', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${server.creds.agentKey}` } } }));
    const quote = ((await client.callTool({ name: 'get_quote', arguments: { propertyId: 'prop_duinzicht', unitId: 'kamer-2', checkin, checkout } })) as Json).structuredContent;
    const booking = ((await client.callTool({ name: 'prepare_booking', arguments: { quoteId: quote.quoteId } })) as Json).structuredContent;
    await client.close();
    assert.equal(booking.mode, 'availability_request');

    // The guest follows the agent's link to the built-in stay page, pre-filled.
    const landing = await fetch(booking.url, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0' } });
    const target = new URL(landing.headers.get('location')!);
    assert.equal(target.pathname, '/verblijf/duinzicht');
    assert.equal(target.searchParams.get('checkin'), checkin);
    const page = await (await fetch(target)).text();
    assert.match(page, new RegExp(`value="${checkin}"`));
    assert.match(page, new RegExp(`name="ref" value="${booking.reference}"`));

    const sent = await post(server, '/verblijf/duinzicht/aanvraag', { unitId: 'kamer-2', checkin, checkout, adults: '2', children: '0', dogs: '0', name: 'Sam Jansen', email: 'sam@example.com', message: 'Graag een rustige kamer', ref: booking.reference, website: '' });
    assert.equal(sent.status, 303);
    const statusUrl = sent.headers.get('location')!;
    assert.match(await (await fetch(`${server.url}${statusUrl}`)).text(), /Aanvraag ontvangen/);
    assert.deepEqual(server.mailer.sent.map((m) => m.to).sort(), ['pension@duinzicht.example', 'sam@example.com']);

    const list = await (await fetch(`${server.url}/api/owner/requests`, { headers })).json();
    const request = list.requests[0];
    assert.equal(request.status, 'new');
    assert.equal(request.agentClient, 'Demo Reisagent');
    assert.equal(request.publicToken, undefined, 'status token not exposed in owner list');

    const accepted = await (await fetch(`${server.url}/api/owner/requests/${request.id}/accept`, { method: 'POST', headers, body: JSON.stringify({ note: 'Welkom!' }) })).json();
    assert.equal(accepted.status, 'accepted');
    assert.match(await (await fetch(`${server.url}${statusUrl}`)).text(), /Bevestigd[\s\S]*Welkom!/);
    assert.match(server.mailer.sent.at(-1)!.subject, /Bevestigd/);

    const unit = server.store.getProperty('prop_duinzicht')!.units.find((u) => u.id === 'kamer-2')!;
    assert.ok(unit.closedNights!.includes(checkin), 'accepted nights are closed (and exported to other channels)');
    const again = await post(server, '/verblijf/duinzicht/aanvraag', { unitId: 'kamer-2', checkin, checkout, adults: '2', name: 'Ander', email: 'a@example.com' });
    assert.equal(again.status, 409, 'the room is no longer requestable for these nights');

    const analytics = await (await fetch(`${server.url}/api/owner/analytics`, { headers })).json();
    assert.equal(analytics.bookingRequests, 1);
    assert.equal(analytics.confirmedBookings, 1);
    assert.equal(analytics.byAgent['Demo Reisagent'].bookings, 1);
  });

  it('declines with a message, and handles each request only once', async () => {
    const { checkin } = freeWindow(['duinzicht-1'], 3);
    await post(server, '/verblijf/duinzicht/aanvraag', { unitId: 'kamer-1', checkin, checkout: addDays(checkin, 2), adults: '2', name: 'Kim', email: 'kim@example.com' });
    const req = (await (await fetch(`${server.url}/api/owner/requests`, { headers })).json()).requests.find((r: Json) => r.guest.name === 'Kim');
    const declined = await fetch(`${server.url}/api/owner/requests/${req.id}/decline`, { method: 'POST', headers, body: JSON.stringify({ note: 'Helaas vol' }) });
    assert.equal((await declined.json()).status, 'declined');
    const twice = await fetch(`${server.url}/api/owner/requests/${req.id}/accept`, { method: 'POST', headers, body: '{}' });
    assert.equal(twice.status, 409);
  });

  it('validates input and ignores bots', async () => {
    const { checkin } = freeWindow(['duinzicht-1'], 2);
    const bad = await post(server, '/verblijf/duinzicht/aanvraag', { unitId: 'kamer-1', checkin, checkout: addDays(checkin, 2), adults: '2', name: 'X', email: 'geen-mail' });
    assert.equal(bad.status, 400);
    assert.match(await bad.text(), /geldig e-mailadres/);
    const before = server.store.requestsFor('prop_duinzicht').length;
    const bot = await post(server, '/verblijf/duinzicht/aanvraag', { unitId: 'kamer-1', checkin, checkout: addDays(checkin, 2), adults: '2', name: 'Bot', email: 'bot@example.com', website: 'http://spam' });
    assert.equal(bot.status, 303);
    assert.equal(server.store.requestsFor('prop_duinzicht').length, before);
    const dogs = await post(server, '/verblijf/duinzicht/aanvraag', { unitId: 'kamer-1', checkin, checkout: addDays(checkin, 2), adults: '2', dogs: '1', name: 'Hond', email: 'h@example.com' });
    assert.equal(dogs.status, 400);
  });

  it('removes guests\' personal data after the retention period', () => {
    const before = server.store.requestsFor('prop_duinzicht').filter((r) => !r.anonymisedAt).length;
    assert.ok(before > 0);
    assert.equal(server.store.anonymiseRequests(180, new Date()), 0, 'recent requests are kept');
    const n = server.store.anonymiseRequests(180, new Date(Date.now() + 2 * 365 * 86_400_000));
    assert.equal(n, before);
    assert.ok(server.store.requestsFor('prop_duinzicht').every((r) => r.guest.email === '' && r.guest.name === '(verwijderd)'));
  });

  it('prunes old search insight events but keeps bookings', () => {
    server.store.addEvent({ id: 'old', type: 'search_consideration', propertyId: 'prop_duinzicht', at: '2020-01-01T00:00:00.000Z' });
    server.store.addEvent({ id: 'old-booking', type: 'booking_confirmed', propertyId: 'prop_duinzicht', at: '2020-01-01T00:00:00.000Z' });
    assert.equal(server.store.pruneEvents(90), 1);
    assert.ok(server.store.eventsFor('prop_duinzicht', new Date(0)).some((e) => e.id === 'old-booking'));
  });

  it('exports a backup of the accommodation without secrets', async () => {
    const res = await fetch(`${server.url}/api/owner/backup`, { headers });
    assert.match(res.headers.get('content-disposition') ?? '', /innli-duinzicht-/);
    const body = await res.json();
    assert.equal(body.property.id, 'prop_duinzicht');
    assert.equal(body.property.ownerKeyHash, undefined);
    assert.ok(Array.isArray(body.requests));
  });
});

describe('first-run setup in the browser', () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer({ empty: true, setupCode: 'AB12CD34' });
  });
  after(() => server.close());

  const setup = (body: Json) => fetch(`${server.url}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const input = { name: 'B&B Het Veerhuis', city: 'Zwolle', country: 'NL', contactEmail: 'info@veerhuis.example', room: { name: 'Rivierkamer', maxGuests: 2, baseRatePerNight: 110 } };

  it('requires the installation code and only works once', async () => {
    assert.deepEqual(await (await fetch(`${server.url}/api/setup`)).json(), { needsSetup: true, version: '2.0.0' });
    assert.equal((await setup({ ...input, code: 'WRONG' })).status, 403);
    const ok = await setup({ ...input, code: 'ab12cd34' });
    assert.equal(ok.status, 201);
    const { ownerKey: key } = await ok.json();
    const me = await (await fetch(`${server.url}/api/owner/property`, { headers: { authorization: `Bearer ${key}` } })).json();
    assert.equal(me.property.name, 'B&B Het Veerhuis');
    assert.equal(me.property.units[0].name, 'Rivierkamer');
    assert.equal(me.property.booking.connector.kind, 'manual');
    assert.equal((await setup({ ...input, code: 'AB12CD34' })).status, 409);
    assert.equal((await (await fetch(`${server.url}/api/setup`)).json()).needsSetup, false);
  });
});
