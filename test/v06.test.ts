import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { sendMonthlyReports } from '../src/analytics/reports.ts';
import { addDays, stayNights } from '../src/domain/dates.ts';
import { ownerSetFact } from '../src/domain/facts.ts';
import { matchRoomCombinations, splitParty } from '../src/domain/matching.ts';
import { buildQuote } from '../src/domain/pricing.ts';
import { createProperty, createUnit } from '../src/properties.ts';
import { pushToOwner } from '../src/requests/push.ts';
import type { ReviewService } from '../src/requests/reviews.ts';
import type { WaitlistService } from '../src/requests/waitlist.ts';
import { verifyRecord } from '../src/security/signing.ts';
import { Store } from '../src/store.ts';
import { freeWindow, ownerKey, startTestServer, type TestServer } from './helpers.ts';

type Json = Record<string, any>;
const guest = { name: 'Robin de Vries', email: 'robin@example.com' };

describe('pricing: discounts', () => {
  it('applies the best single discount to the owner rate, never to live rates', () => {
    const { property: p } = createProperty({ name: 'X', address: { city: 'Ede', country: 'NL' } });
    ownerSetFact(p.facts, 'fees.cleaningPerStay', 0);
    ownerSetFact(p.facts, 'fees.touristTaxPerPersonPerNight', 0);
    const unit = createUnit({ name: 'K', maxGuests: 2, includedGuests: 2, baseRatePerNight: 100 });
    unit.rates = { seasons: [], discounts: { longStay: [{ minNights: 7, percent: 10 }, { minNights: 14, percent: 20 }], earlyBird: { minDaysAhead: 90, percent: 5 } } };
    const checkin = addDays(new Date().toISOString().slice(0, 10), 120);
    const base = { id: 'q', property: p, unit, checkin, guests: { adults: 2, children: 0, dogs: 0 }, breakfast: false };
    const synced = { unitId: unit.id, status: 'available' as const, certainty: 'synced' as const, checkedAt: '', note: '' };
    const week = buildQuote({ ...base, checkout: addDays(checkin, 7), nights: stayNights(checkin, addDays(checkin, 7)), availability: synced });
    assert.equal(week.lines.find((l) => l.kind === 'discount')!.amount, -70, '10% beats 5% early bird');
    assert.equal(week.total, 630);
    const two = buildQuote({ ...base, checkout: addDays(checkin, 2), nights: stayNights(checkin, addDays(checkin, 2)), availability: synced });
    assert.equal(two.lines.find((l) => l.kind === 'discount')!.label, 'Vroegboekkorting');
    const live = buildQuote({ ...base, checkout: addDays(checkin, 7), nights: stayNights(checkin, addDays(checkin, 7)), availability: { ...synced, certainty: 'live', nightlyRates: stayNights(checkin, addDays(checkin, 7)).map((date) => ({ date, amount: 100 })) } });
    assert.equal(live.lines.some((l) => l.kind === 'discount'), false);
  });
});

describe('groups over several rooms', () => {
  it('splits a party with at least one adult per room', () => {
    const units = [createUnit({ name: 'A', maxGuests: 3, includedGuests: 2, baseRatePerNight: 1 }), createUnit({ name: 'B', maxGuests: 2, includedGuests: 2, baseRatePerNight: 1 })];
    assert.deepEqual(splitParty({ adults: 2, children: 3, dogs: 1 }, units), [{ adults: 1, children: 2, dogs: 1 }, { adults: 1, children: 1, dogs: 0 }]);
    assert.equal(splitParty({ adults: 1, children: 3, dogs: 0 }, units), null, 'children never alone in a room');
    assert.equal(splitParty({ adults: 6, children: 0, dogs: 0 }, units), null);
  });

  it('prefers two rooms over three and the fewest empty beds', () => {
    const { property: p } = createProperty({ name: 'X', address: { city: 'Ede', country: 'NL' } });
    p.units.push(createUnit({ name: 'Groot', maxGuests: 4, includedGuests: 2, baseRatePerNight: 1 }), createUnit({ name: 'Middel', maxGuests: 3, includedGuests: 2, baseRatePerNight: 1 }), createUnit({ name: 'Klein', maxGuests: 2, includedGuests: 2, baseRatePerNight: 1 }));
    const combos = matchRoomCombinations(p, [], { guests: { adults: 5, children: 0, dogs: 0 } });
    assert.deepEqual(combos[0].rooms.map((r) => r.unit.name), ['Middel', 'Klein']);
    assert.equal(combos[0].spareBeds, 0);
  });
});

describe('agent features of 0.6', () => {
  let server: TestServer;
  let client: Client;
  let owner: Record<string, string>;
  const call = async (name: string, args: Json): Promise<Json> => {
    const res = (await client.callTool({ name, arguments: args })) as Json;
    if (res.isError) throw new Error(res.content[0].text);
    return res.structuredContent;
  };
  const callError = async (name: string, args: Json): Promise<string> => {
    const res = (await client.callTool({ name, arguments: args })) as Json;
    assert.equal(res.isError, true, `${name} should fail`);
    return res.content[0].text;
  };
  const patch = (body: Json) => fetch(`${server.url}/api/owner/property`, { method: 'PATCH', headers: owner, body: JSON.stringify(body) }).then((r) => r.json());

  before(async () => {
    server = await startTestServer();
    client = new Client({ name: 'agent', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${server.creds.agentKey}` } } }));
    owner = { authorization: `Bearer ${ownerKey(server, 'prop_duinzicht')}`, 'content-type': 'application/json' };
  });
  after(async () => {
    await client.close();
    await server.close();
  });

  it('books a group of five over two rooms, all or nothing', async () => {
    const { checkin, checkout } = freeWindow(['duinzicht-1', 'duinzicht-2'], 2, 30);
    const r = await call('search_stays', { area: 'Egmond', checkin, checkout, guests: { adults: 5 } });
    const hit = r.results.find((x: Json) => x.name === 'Pension Duinzicht');
    assert.equal(hit.unit, null);
    assert.equal(hit.rooms.length, 2);
    assert.equal(hit.offer.quoteIds.length, 2);
    assert.equal(hit.offer.total, Math.round(hit.offer.rooms.reduce((s: number, x: Json) => s + x.total, 0) * 100) / 100);

    const req = await call('request_booking', { quoteIds: hit.offer.quoteIds, guest, guestConsent: true });
    assert.equal(req.rooms.length, 2);
    assert.equal(req.booked, false);
    assert.equal(req.total, hit.offer.total);
    const ownerMails = server.mailer.sent.filter((m) => m.to === 'pension@duinzicht.example' && /Nieuwe aanvraag/.test(m.subject));
    assert.equal(ownerMails.length, 1, 'one e-mail for the whole group');

    await fetch(`${server.url}/api/owner/requests/${req.requestId}/accept`, { method: 'POST', headers: owner, body: '{}' });
    const status = await call('check_status', { statusToken: req.statusToken });
    assert.equal(status.booked, true);
    const p = server.store.getProperty('prop_duinzicht')!;
    assert.ok(p.units.every((u) => u.closedNights!.includes(checkin)), 'both rooms closed');

    await call('cancel_request', { statusToken: req.statusToken, guestConsent: true });
    assert.ok(server.store.getProperty('prop_duinzicht')!.units.every((u) => !u.closedNights!.includes(checkin)), 'both rooms reopened');
  });

  it('flexible dates: the first available stay per property in a window', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await call('search_stays', { area: 'Egmond', flexibleDates: { from: addDays(today, 20), to: addDays(today, 50), nights: 2 }, guests: { adults: 2 } });
    const offer = r.results[0].offer;
    assert.ok(offer.checkin >= addDays(today, 20) && offer.checkout <= addDays(today, 50));
    assert.equal(offer.nights, 2);
  });

  it('places nearby, photos, translations and FAQ reach the agent', async () => {
    await patch({
      pointsOfInterest: [{ kind: 'beach', name: 'Strand Egmond aan Zee', distanceKm: 0.2, walkMinutes: 3 }, { kind: 'station', name: 'Station Alkmaar', distanceKm: 9 }],
      photos: [{ url: 'https://img.example/duinzicht/voorkant.jpg', caption: 'Voorgevel aan de boulevard' }],
      translations: { en: { description: 'Family-run guesthouse 200 m from the beach.' } },
    });
    const near = await call('search_stays', { country: 'NL', nearPlace: { kind: 'beach', maxKm: 1 } });
    assert.deepEqual(near.results.map((x: Json) => x.name), ['Pension Duinzicht']);

    const details = await call('get_stay_details', { propertyId: 'prop_duinzicht', language: 'en' });
    assert.equal(details.description, 'Family-run guesthouse 200 m from the beach.');
    assert.deepEqual(details.availableLanguages, ['nl', 'en']);
    assert.equal(details.photos[0].caption, 'Voorgevel aan de boulevard');
    assert.equal(details.pointsOfInterest.length, 2);

    const q = await call('ask_host', { propertyId: 'prop_duinzicht', question: 'Kun je fietsen huren in de buurt?' });
    const { questions } = await (await fetch(`${server.url}/api/owner/questions`, { headers: owner })).json();
    const qq = questions.find((x: Json) => x.question.includes('fietsen'));
    await fetch(`${server.url}/api/owner/questions/${qq.id}/answer`, { method: 'POST', headers: owner, body: JSON.stringify({ answer: 'Ja, 300 m verderop.', publishAsFaq: true }) });
    assert.equal((await call('check_status', { statusToken: q.statusToken })).status, 'answered');
    const after = await call('get_stay_details', { propertyId: 'prop_duinzicht' });
    assert.deepEqual(after.faq.map((f: Json) => f.answer), ['Ja, 300 m verderop.']);

    const page = await (await fetch(`${server.url}/verblijf/duinzicht`)).text();
    assert.match(page, /alt="Voorgevel aan de boulevard"/);
    assert.match(page, /Strand Egmond aan Zee/);
    assert.match(page, /"image":\["https:\/\/img\.example/);
  });

  it('waitlist: the guest hears as soon as a room frees up', async () => {
    const { checkin, checkout } = freeWindow(['duinzicht-1'], 2, 60);
    await fetch(`${server.url}/api/owner/units/kamer-1/closed`, { method: 'PUT', headers: owner, body: JSON.stringify({ closedNights: [checkin] }) });
    assert.match(await callError('join_waitlist', { propertyId: 'prop_duinzicht', unitId: 'kamer-1', checkin, checkout, email: 'wacht@example.com', guestConsent: false }), /guestConsent/);
    const w = await call('join_waitlist', { propertyId: 'prop_duinzicht', unitId: 'kamer-1', checkin, checkout, email: 'wacht@example.com', guestConsent: true });
    const svc = (await import('./helpers.ts')).appLocals(server).waitlist as WaitlistService;
    assert.equal(await svc.check(), 0, 'still closed');
    await fetch(`${server.url}/api/owner/units/kamer-1/closed`, { method: 'PUT', headers: owner, body: JSON.stringify({ closedNights: [] }) });
    assert.equal(await svc.check(), 1);
    const mail = server.mailer.sent.find((m) => m.to === 'wacht@example.com')!;
    assert.match(mail.text, new RegExp(`checkin=${checkin}`));
    assert.equal((await call('check_status', { statusToken: w.statusToken })).status, 'notified');
  });

  it('reviews only from confirmed, completed stays; signed booking records', async () => {
    const { checkin, checkout } = freeWindow(['duinzicht-2'], 2, 70);
    const q = await call('get_quote', { propertyId: 'prop_duinzicht', unitId: 'kamer-2', checkin, checkout });
    const req = await call('request_booking', { quoteId: q.quoteId, guest, guestConsent: true });

    // Signed record verifies against the published key, and fails when tampered with.
    const wk = await (await fetch(`${server.url}/.well-known/innli.json`)).json();
    assert.equal(verifyRecord(wk.signingKey, req.signedRecord, req.signature.value), true);
    assert.equal(verifyRecord(wk.signingKey, { ...req.signedRecord, total: 1 }, req.signature.value), false);

    const reviews = (await import('./helpers.ts')).appLocals(server).reviews as ReviewService;
    const notYet = await fetch(`${server.url}/beoordeling/${req.statusToken}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'rating=5' });
    assert.equal(notYet.status, 409, 'no review before the stay');

    await fetch(`${server.url}/api/owner/requests/${req.requestId}/accept`, { method: 'POST', headers: owner, body: '{}' });
    const stored = server.store.getRequest(req.requestId)!;
    stored.checkin = addDays(new Date().toISOString().slice(0, 10), -3);
    stored.checkout = addDays(new Date().toISOString().slice(0, 10), -1);
    assert.equal(await reviews.invite(), 1);
    const sent = await fetch(`${server.url}/beoordeling/${req.statusToken}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'rating=5&text=Heerlijk+rustig+en+schoon' });
    assert.equal(sent.status, 303);
    const twice = await fetch(`${server.url}/beoordeling/${req.statusToken}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'rating=1' });
    assert.equal(twice.status, 409);
    await fetch(`${server.url}/api/owner/reviews/${req.requestId}/reply`, { method: 'POST', headers: owner, body: JSON.stringify({ text: 'Dank je, tot ziens!' }) });
    const details = await call('get_stay_details', { propertyId: 'prop_duinzicht' });
    assert.equal(details.reviews.count, 1);
    assert.equal(details.reviews.average, 5);
    assert.equal(details.reviews.recent[0].ownerReply, 'Dank je, tot ziens!');
  });

  it('MCP resources and the plan_stay prompt', async () => {
    const { resources } = await client.listResources();
    assert.ok(resources.some((r) => r.uri === 'innli://stay/prop_hooiberg'));
    const res = await client.readResource({ uri: 'innli://stay/prop_hooiberg' });
    assert.equal(JSON.parse((res.contents[0] as { text: string }).text).name, 'B&B De Hooiberg');
    const prompt = await client.getPrompt({ name: 'plan_stay', arguments: { wish: 'rustig weekend met hond' } });
    assert.match((prompt.messages[0].content as { text: string }).text, /rustig weekend met hond[\s\S]*booked: true/);
  });

  it('REST + OpenAPI for agents without MCP', async () => {
    const spec = await (await fetch(`${server.url}/api/agent/v1/openapi.json`)).json();
    assert.equal(spec.openapi, '3.1.0');
    assert.ok(spec.paths['/api/agent/v1/tools/search_stays'].post.requestBody.content['application/json'].schema.properties.requirements);
    assert.equal(Object.keys(spec.paths).length, 19);
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${server.creds.agentKey}` };
    const ok = await fetch(`${server.url}/api/agent/v1/tools/search_stays`, { method: 'POST', headers, body: JSON.stringify({ area: 'Veluwe', guests: { adults: 2 } }) });
    assert.equal(ok.status, 200);
    assert.ok((await ok.json()).results.length >= 1);
    const bad = await fetch(`${server.url}/api/agent/v1/tools/get_quote`, { method: 'POST', headers, body: JSON.stringify({ propertyId: 'x' }) });
    assert.equal(bad.status, 400);
    assert.equal((await fetch(`${server.url}/api/agent/v1/tools/nope`, { method: 'POST', headers, body: '{}' })).status, 404);
  });

  it('reports: per agent partner, monthly owner summary, Google Business export', async () => {
    const report = await (await fetch(`${server.url}/api/admin/agents/report`, { headers: { authorization: 'Bearer admin-test-key' } })).json();
    const demo = report.agents.find((a: Json) => a.agent === 'Demo Reisagent');
    assert.ok(demo.requests > 0 && demo.bookingRequests > 0);
    const text = await (await fetch(`${server.url}/api/owner/export/google-business`, { headers: owner })).text();
    assert.match(text, /Naam: Pension Duinzicht/);
    assert.doesNotMatch(text, /Huisdieren toegestaan/, 'only confirmed true facts');
    const sent = await sendMonthlyReports(server.store, server.mailer, new Date(Date.UTC(2030, 0, 1)));
    assert.ok(sent >= 3);
    assert.equal(await sendMonthlyReports(server.store, server.mailer, new Date(Date.UTC(2030, 0, 2))), 0, 'once per month');
    assert.match(server.mailer.sent.at(-1)!.text, /Maandoverzicht/);
  });

  it('push messages to the owner phone via ntfy (never breaking the flow)', async () => {
    const { property } = createProperty({ name: 'X', address: { city: 'Ede', country: 'NL' } });
    assert.equal(await pushToOwner(property, 'T', 'm'), false, 'not configured');
    property.notify = { ntfyUrl: 'https://ntfy.sh/innli-geheim' };
    const calls: { url: string; body: string }[] = [];
    assert.equal(await pushToOwner(property, 'Nieuwe aanvraag', 'Robin: 1-3 mei', (async (url: string, init: RequestInit) => { calls.push({ url, body: String(init.body) }); return new Response('ok'); }) as typeof fetch), true);
    assert.deepEqual(calls, [{ url: 'https://ntfy.sh/innli-geheim', body: 'Robin: 1-3 mei' }]);
    assert.equal(await pushToOwner(property, 'T', 'm', (async () => { throw new Error('offline'); }) as typeof fetch), false);
  });
});

describe('store: append-only logs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'innli-store-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('survives a restart, a torn last line, and migrates the old single-file format', () => {
    const path = join(dir, 'a', 'innli.json');
    const a = new Store(path);
    const { property } = createProperty({ name: 'Bewaar', address: { city: 'Ede', country: 'NL' } });
    a.saveProperty(property);
    a.addEvent({ id: 'e1', type: 'details_view', propertyId: property.id, at: new Date().toISOString() });
    a.flush();
    appendFileSync(join(dir, 'a', 'innli.events.jsonl'), '{"id":"broken"'); // crash mid-write
    const b = new Store(path);
    assert.equal(b.getProperty(property.id)?.name, 'Bewaar');
    assert.equal(b.eventsFor(property.id, new Date(0)).length, 1);

    const legacyPath = join(dir, 'legacy.json');
    writeFileSync(legacyPath, JSON.stringify({ settings: { instanceId: 'ins_x' }, properties: [property], agents: [], quotes: [], bookingLinks: [], events: [{ id: 'old', type: 'details_view', propertyId: property.id, at: '2026-01-01T00:00:00.000Z' }], requests: [], questions: [] }));
    const c = new Store(legacyPath);
    assert.equal(c.eventsFor(property.id, new Date(0)).length, 1);
    const snap = JSON.parse(readFileSync(legacyPath, 'utf8'));
    assert.equal(snap.events, undefined, 'events moved out of the snapshot');
    assert.match(readFileSync(join(dir, 'legacy.events.jsonl'), 'utf8'), /"id":"old"/);
    assert.equal(new Store(legacyPath).eventsFor(property.id, new Date(0)).length, 1, 'no duplicates after reload');
  });
});

describe('operations', () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(() => server.close());

  it('health with version, request ids, and conditional GET on public data', async () => {
    const health = await fetch(`${server.url}/health`);
    const body = await health.json();
    assert.equal(body.ok, true);
    assert.equal(body.published, 3);
    assert.ok(health.headers.get('x-request-id'));
    const echoed = await fetch(`${server.url}/health`, { headers: { 'x-request-id': 'agent-trace-12345' } });
    assert.equal(echoed.headers.get('x-request-id'), 'agent-trace-12345');
    const first = await fetch(`${server.url}/api/public/properties/prop_hooiberg/passport`);
    const etag = first.headers.get('etag');
    assert.ok(etag);
    // Plain HTTP client: fetch() itself adds Cache-Control: no-cache when If-None-Match is set.
    const { get } = await import('node:http');
    const status = await new Promise<number>((resolve) => get(`${server.url}/api/public/properties/prop_hooiberg/passport`, { headers: { 'if-none-match': etag! } }, (res) => { res.resume(); resolve(res.statusCode!); }));
    assert.equal(status, 304, 'unchanged data is not sent again');
  });
});
