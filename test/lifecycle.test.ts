import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { addDays } from '../src/domain/dates.ts';
import { ownerSetFact } from '../src/domain/facts.ts';
import { freeWindow, ownerKey, startTestServer, type TestServer } from './helpers.ts';

type Json = Record<string, any>;
const guest = { name: 'Robin de Vries', email: 'robin@example.com' };

async function agent(server: TestServer, key?: string): Promise<Client> {
  const c = new Client({ name: 'agent', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), key ? { requestInit: { headers: { authorization: `Bearer ${key}` } } } : undefined));
  return c;
}
async function call(c: Client, name: string, args: Json): Promise<Json> {
  const res = (await c.callTool({ name, arguments: args })) as Json;
  if (res.isError) throw new Error(res.content[0].text);
  return res.structuredContent;
}
async function callError(c: Client, name: string, args: Json): Promise<string> {
  const res = (await c.callTool({ name, arguments: args })) as Json;
  assert.equal(res.isError, true, `${name} should fail`);
  return res.content[0].text;
}

describe('booking lifecycle for agents', () => {
  let server: TestServer;
  let client: Client;
  let owner: Record<string, string>;
  const api = (path: string, init: RequestInit = {}) => fetch(`${server.url}/api/owner${path}`, { ...init, headers: owner });
  const setRules = (rules: Json) => api('/property', { method: 'PATCH', body: JSON.stringify({ bookingRules: rules }) });

  before(async () => {
    server = await startTestServer();
    client = await agent(server, server.creds.agentKey);
    owner = { authorization: `Bearer ${ownerKey(server, 'prop_duinzicht')}`, 'content-type': 'application/json' };
  });
  after(async () => {
    await client.close();
    await server.close();
  });
  beforeEach(() => {
    server.mailer.sent.length = 0;
  });

  it('holds the nights while the host decides, so a second guest cannot be promised the same room', async () => {
    const { checkin, checkout } = freeWindow(['duinzicht-1'], 2, 30);
    const q = await call(client, 'get_quote', { propertyId: 'prop_duinzicht', unitId: 'kamer-1', checkin, checkout });
    const r = await call(client, 'request_booking', { quoteId: q.quoteId, guest, guestConsent: true });
    assert.equal(r.status, 'new');
    assert.equal(r.booked, false);
    assert.ok(Date.parse(r.holdUntil) > Date.now() + 47 * 3_600_000);
    assert.match(r.tellTheGuest, /not yet a booking/);

    const other = await call(client, 'check_availability', { propertyId: 'prop_duinzicht', checkin, checkout });
    const room = other.units.find((u: Json) => u.unitId === 'kamer-1');
    assert.equal(room.status, 'unavailable');
    assert.match(room.note, /held for another request/);

    // The host can still accept the held request itself.
    const accepted = await (await api(`/requests/${r.requestId}/accept`, { method: 'POST', body: '{}' })).json();
    assert.equal(accepted.status, 'accepted');
  });

  it('expires unanswered requests, releases the hold and tells guest and agent', async () => {
    const { checkin, checkout } = freeWindow(['duinzicht-2'], 2, 40);
    const q = await call(client, 'get_quote', { propertyId: 'prop_duinzicht', unitId: 'kamer-2', checkin, checkout });
    const r = await call(client, 'request_booking', { quoteId: q.quoteId, guest, guestConsent: true });
    const stored = server.store.getRequest(r.requestId)!;
    stored.createdAt = new Date(Date.now() - 13 * 3_600_000).toISOString();
    const first = await server.requests.maintain();
    assert.equal(first.ownerReminders >= 1, true, 'owner reminded after 12 hours');

    stored.holdUntil = new Date(Date.now() - 1000).toISOString();
    const second = await server.requests.maintain();
    assert.equal(second.expired, 1);
    const status = await call(client, 'check_status', { statusToken: r.statusToken });
    assert.equal(status.status, 'expired');
    assert.match(status.next, /Nothing is booked/);
    assert.ok(server.mailer.sent.some((m) => m.to === guest.email && /verlopen/.test(m.subject)));
    const again = await call(client, 'check_availability', { propertyId: 'prop_duinzicht', checkin, checkout });
    assert.equal(again.units.find((u: Json) => u.unitId === 'kamer-2').status, 'available', 'hold released');
  });

  it('instant booking within the owner\'s rules: booked at once, with deposit and both parties informed', async () => {
    await setRules({ instantBooking: true, minLeadDays: 2, maxNights: 7, holdHours: 48, deposit: { percent: 30, dueDays: 7, instructions: 'NL00BANK0123456789 o.v.v. je naam', paymentUrl: 'https://betaal.example/duinzicht' } });
    const { checkin, checkout } = freeWindow(['duinzicht-2'], 2, 50);
    const q = await call(client, 'get_quote', { propertyId: 'prop_duinzicht', unitId: 'kamer-2', checkin, checkout });
    const r = await call(client, 'request_booking', { quoteId: q.quoteId, guest, guestConsent: true });
    assert.equal(r.booked, true);
    assert.equal(r.decidedBy, 'instant');
    assert.equal(r.payment.amountDue, Math.round(q.total * 30) / 100);
    assert.equal(r.payment.status, 'pending');
    assert.match(r.tellTheGuest, /confirmed \(instant booking\).*deposit/);
    assert.ok(server.mailer.sent.some((m) => m.to === 'pension@duinzicht.example' && /Direct geboekt/.test(m.subject)));
    assert.ok(server.mailer.sent.some((m) => m.to === guest.email && /betaal\.example/.test(m.text)));

    const details = await call(client, 'get_stay_details', { propertyId: 'prop_duinzicht' });
    assert.equal(details.host.instantBooking, true);
    assert.deepEqual(details.host.deposit, { percent: 30, dueDaysAfterConfirmation: 7 });

    const paid = await (await api(`/requests/${r.requestId}/paid`, { method: 'POST', body: '{}' })).json();
    assert.equal(paid.payment.status, 'paid');
    assert.equal((await call(client, 'check_status', { statusToken: r.statusToken })).payment.status, 'paid');
  });

  it('no instant booking outside the rules: the host decides', async () => {
    await setRules({ instantBooking: true, minLeadDays: 2, maxNights: 1, holdHours: 24 });
    const { checkin, checkout } = freeWindow(['duinzicht-1'], 2, 60);
    const q = await call(client, 'get_quote', { propertyId: 'prop_duinzicht', unitId: 'kamer-1', checkin, checkout });
    const r = await call(client, 'request_booking', { quoteId: q.quoteId, guest, guestConsent: true });
    assert.equal(r.booked, false, 'two nights exceed maxNights 1');
    assert.ok(Date.parse(r.holdUntil) < Date.now() + 25 * 3_600_000, 'owner-chosen hold time');
    await setRules({ instantBooking: false, minLeadDays: 2, maxNights: 14, holdHours: 48 });
  });

  it('cancels only with the guest\'s consent, reopens the nights and quotes the agreed conditions', async () => {
    const { checkin, checkout } = freeWindow(['duinzicht-1'], 2, 70);
    const q = await call(client, 'get_quote', { propertyId: 'prop_duinzicht', unitId: 'kamer-1', checkin, checkout });
    const r = await call(client, 'request_booking', { quoteId: q.quoteId, guest, guestConsent: true });
    await api(`/requests/${r.requestId}/accept`, { method: 'POST', body: '{}' });
    assert.match(await callError(client, 'cancel_request', { statusToken: r.statusToken, guestConsent: false }), /explicitly asked/);

    const c = await call(client, 'cancel_request', { statusToken: r.statusToken, reason: 'Ziek', guestConsent: true });
    assert.equal(c.status, 'cancelled');
    assert.match(c.tellTheGuest, /Kosteloos annuleren tot 14 dagen/);
    assert.equal(c.record.conditions.cancellation.value, 'Kosteloos annuleren tot 14 dagen voor aankomst.');
    const unit = server.store.getProperty('prop_duinzicht')!.units.find((u) => u.id === 'kamer-1')!;
    assert.ok(!unit.closedNights!.includes(checkin), 'nights reopened');
    assert.ok(server.mailer.sent.some((m) => m.to === 'pension@duinzicht.example' && /geannuleerd/.test(m.subject)));
    assert.match(await callError(client, 'cancel_request', { statusToken: r.statusToken, guestConsent: true }), /already cancelled/);

    const log = await (await api('/audit-log')).json();
    const actions = log.entries.filter((e: Json) => e.requestId === r.requestId).map((e: Json) => e.action);
    assert.deepEqual(actions.sort(), ['cancel_request', 'request_booking']);
  });

  it('lets the guest withdraw a request from the status page', async () => {
    const { checkin, checkout } = freeWindow(['duinzicht-2'], 2, 80);
    const q = await call(client, 'get_quote', { propertyId: 'prop_duinzicht', unitId: 'kamer-2', checkin, checkout });
    const r = await call(client, 'request_booking', { quoteId: q.quoteId, guest, guestConsent: true });
    const res = await fetch(`${server.url}/aanvraag/${r.statusToken}/annuleren`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'reason=Andere+plannen' });
    assert.equal(res.status, 303);
    assert.match(await (await fetch(`${server.url}/aanvraag/${r.statusToken}`)).text(), /Geannuleerd/);
  });

  it('sends a pre-arrival message with check-in details', async () => {
    await setRules({ instantBooking: false, minLeadDays: 0, maxNights: 14, holdHours: 48 });
    const { checkin, checkout } = freeWindow(['duinzicht-2'], 2, 1);
    const q = await call(client, 'get_quote', { propertyId: 'prop_duinzicht', unitId: 'kamer-2', checkin, checkout });
    const r = await call(client, 'request_booking', { quoteId: q.quoteId, guest, guestConsent: true });
    await api(`/requests/${r.requestId}/accept`, { method: 'POST', body: '{}' });
    // Housekeeping as it runs two days before arrival (the demo calendar decides which nights are free).
    const twoDaysBefore = new Date(Math.max(Date.now(), Date.parse(`${addDays(checkin, -2)}T08:00:00Z`)));
    const m = await server.requests.maintain(twoDaysBefore);
    assert.ok(m.preArrival >= 1);
    assert.ok(server.mailer.sent.some((x) => x.to === guest.email && /Tot snel/.test(x.subject)));
    assert.equal((await server.requests.maintain(twoDaysBefore)).preArrival, 0, 'only once');
  });

  it('warns the owner about a double booking with another channel, once', async () => {
    // Accept (forced) on nights the demo Airbnb/Booking feed already has booked.
    const p = server.store.getProperty('prop_duinzicht')!;
    const busy = (await server.requests['catalog'].roomCalendar(p, p.units[0], Array.from({ length: 60 }, (_, i) => addDays(new Date().toISOString().slice(0, 10), 90 + i)))).nights.find((n: Json) => n.state === 'booked_elsewhere')!.date;
    const req = { ...server.store.getRequest(server.store.requestsFor('prop_duinzicht')[0].id)!, id: 'req_clash', publicToken: 'clash-token', unitId: p.units[0].id, checkin: busy, checkout: addDays(busy, 1), status: 'accepted' as const, conflictNotifiedAt: undefined };
    server.store.saveRequest(req);
    const conflicts = await (await api('/conflicts')).json();
    assert.ok(conflicts.conflicts.some((c: Json) => c.requestId === 'req_clash'));
    assert.ok((await server.requests.notifyConflicts()) >= 1);
    assert.ok(server.mailer.sent.some((m) => /dubbele boeking/.test(m.subject)));
    assert.equal(await server.requests.notifyConflicts(), 0, 'not repeated');
  });

  it('read-only agent keys cannot act for guests', async () => {
    const created = await (await fetch(`${server.url}/api/admin/agents`, { method: 'POST', headers: { authorization: 'Bearer admin-test-key', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Vergelijker', scopes: ['read'] }) })).json();
    const ro = await agent(server, created.key);
    try {
      const { checkin, checkout } = freeWindow(['duinzicht-1'], 2, 100);
      const q = await call(ro, 'get_quote', { propertyId: 'prop_duinzicht', unitId: 'kamer-1', checkin, checkout });
      assert.match(await callError(ro, 'request_booking', { quoteId: q.quoteId, guest, guestConsent: true }), /read-only/);
      assert.match(await callError(ro, 'ask_host', { propertyId: 'prop_duinzicht', question: 'Mag ik mijn fiets binnen zetten?' }), /read-only/);
    } finally {
      await ro.close();
    }
  });

  it('shows the host\'s response time to agents', async () => {
    const details = await call(client, 'get_stay_details', { propertyId: 'prop_duinzicht' });
    assert.equal(typeof details.host.medianResponseHours, 'number');
    assert.ok(details.host.requestsLast180Days >= 3);
  });
});

describe('owner insights: what agents look for', () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(() => server.close());

  it('shows which unknown facts cost the owner guests, and what to confirm', async () => {
    const c = await agent(server, server.creds.agentKey);
    try {
      for (let i = 0; i < 3; i++) await call(c, 'search_stays', { area: 'Egmond', requirements: ['enclosed_garden'], confirmedOnly: true });
      await call(c, 'search_stays', { area: 'Egmond', guests: { adults: 2, dogs: 1 } });
    } finally {
      await c.close();
    }
    const res = await (await fetch(`${server.url}/api/owner/insights`, { headers: { authorization: `Bearer ${ownerKey(server, 'prop_duinzicht')}` } })).json();
    assert.equal(res.searchesInYourArea, 4);
    assert.equal(res.shown, 0);
    const garden = res.missedBecauseUnknown.find((x: Json) => x.requirement === 'enclosed_garden');
    assert.equal(garden.count, 3);
    assert.deepEqual(garden.factsToConfirm.map((f: Json) => f.key), ['garden.fullyEnclosed']);
    assert.match(garden.advice, /3× vroegen agents naar "Volledig afgesloten tuin"/);
    assert.equal(res.missedBecauseNotOffered.find((x: Json) => x.requirement === 'dogs_allowed').count, 1);
    assert.ok(res.outcomes.some((o: Json) => o.outcome === 'not_confirmed' && o.count === 3));
  });

  it('flags website text that contradicts the passport', async () => {
    const p = server.store.getProperty('prop_hooiberg')!;
    ownerSetFact(p.facts, 'checkin.from', '14:00');
    const report = await (await fetch(`${server.url}/api/owner/audit`, { method: 'POST', headers: { authorization: `Bearer ${ownerKey(server, 'prop_hooiberg')}`, 'content-type': 'application/json' }, body: '{}' })).json();
    const clash = report.checks.find((x: Json) => x.id === 'consistency.checkin.from');
    assert.equal(clash.status, 'fail');
    assert.match(clash.detail, /Website: 15:00.*paspoort: 14:00/);
    assert.ok(report.checks.some((x: Json) => x.id === 'consistency.facts' && x.status === 'pass'));
  });
});
