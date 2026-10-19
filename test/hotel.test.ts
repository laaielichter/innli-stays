import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { addDays } from '../src/domain/dates.ts';
import type { OutboundWebhooks } from '../src/requests/webhooks.ts';
import { appLocals, ownerKey, startTestServer, type TestServer } from './helpers.ts';

type Json = Record<string, any>;

describe('hotels and busy properties', () => {
  let server: TestServer;
  let client: Client;
  const P = 'prop_spaarne';
  const today = new Date().toISOString().slice(0, 10);
  const checkin = addDays(today, 20);
  const checkout = addDays(today, 22);

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
  const guest = { name: 'Sam Jansen', email: 'sam@example.com' };
  const book = async (unitId: string, rooms: number, adults: number, extra: Json = {}, dates = { checkin, checkout }) => {
    const q = await call('get_quote', { propertyId: P, unitId, ...dates, guests: { adults }, rooms, ...extra });
    return call('request_booking', { quoteId: q.quoteId, guest, guestConsent: true });
  };
  const roomsLeft = async (unitId: string, dates = { checkin, checkout }) => {
    const a = await call('check_availability', { propertyId: P, ...dates, guests: { adults: 1 }, rooms: 1 });
    return a.units.find((u: Json) => u.unitId === unitId);
  };

  before(async () => {
    server = await startTestServer({ hotel: true });
    client = new Client({ name: 'agent', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${server.creds.agentKey}` } } }));
  });
  after(async () => {
    await client.close();
    await server.close();
  });

  it('room types with many identical rooms, and rate plans in the details', async () => {
    const d = await call('get_stay_details', { propertyId: P });
    const std = d.units.find((u: Json) => u.id === 'standaard' || u.unitId === 'standaard');
    assert.equal(std.roomsOfThisType, 24);
    assert.deepEqual(d.ratePlans.map((r: Json) => r.id), ['standard', 'non-refundable', 'breakfast']);
  });

  it('a party of six gets several rooms of one type, priced per room', async () => {
    const s = await call('search_stays', { area: 'Haarlem', checkin, checkout, guests: { adults: 6 } });
    const hit = s.results.find((r: Json) => r.propertyId === P);
    assert.ok(hit, 'hotel found');
    assert.ok(hit.unit.rooms >= 2, 'more than one room');
    const q = await call('get_quote', { propertyId: P, unitId: 'standaard', checkin, checkout, guests: { adults: 6 }, rooms: 3 });
    const single = await call('get_quote', { propertyId: P, unitId: 'standaard', checkin, checkout, guests: { adults: 2 } });
    const acc = (x: Json) => x.lines.find((l: Json) => l.kind === 'accommodation').amount;
    assert.equal(q.rooms, 3);
    assert.equal(acc(q), Math.round(acc(single) * 3 * 100) / 100);
    assert.match(q.summaryForGuest, /3 ×/);
    assert.match(await callError('check_availability', { propertyId: P, checkin, checkout, guests: { adults: 2 }, rooms: 11 }), /rooms|10/i);
  });

  it('rate plans: non-refundable is cheaper and says so, breakfast plan includes breakfast', async () => {
    const base = await call('get_quote', { propertyId: P, unitId: 'superior', checkin, checkout, guests: { adults: 2 } });
    assert.equal(base.ratePlanOptions.length, 3);
    const nr = await call('get_quote', { propertyId: P, unitId: 'superior', checkin, checkout, guests: { adults: 2 }, ratePlanId: 'non-refundable' });
    assert.ok(nr.total < base.total);
    assert.ok(nr.lines.some((l: Json) => l.kind === 'rate_plan' && l.amount < 0));
    assert.equal(nr.policies.refundable.value, false);
    const bb = await call('get_quote', { propertyId: P, unitId: 'superior', checkin, checkout, guests: { adults: 2 }, ratePlanId: 'breakfast' });
    assert.ok(bb.lines.some((l: Json) => l.kind === 'breakfast' && l.amount === 0));
    assert.match(await callError('get_quote', { propertyId: P, unitId: 'superior', checkin, checkout, ratePlanId: 'nope' }), /rate plan/i);
  });

  it('inventory: sells rooms one by one until the type is sold out', async () => {
    assert.equal((await roomsLeft('eenpersoons')).roomsLeft, 8);
    const first = await book('eenpersoons', 5, 5);
    assert.equal(first.booked, true, 'instant booking');
    assert.equal((await roomsLeft('eenpersoons')).roomsLeft, 3);
    await book('eenpersoons', 3, 3);
    const after = await roomsLeft('eenpersoons');
    assert.equal(after.status, 'unavailable');
    await callError('get_quote', { propertyId: P, unitId: 'eenpersoons', checkin, checkout, guests: { adults: 1 } });
    // Other dates and other room types are not affected.
    assert.equal((await roomsLeft('eenpersoons', { checkin: addDays(checkin, 5), checkout: addDays(checkin, 6) })).roomsLeft, 8);
    assert.equal((await roomsLeft('standaard')).status, 'available');
  });

  it('quote hold: rooms are kept 15 minutes for the guest, and the request keeps them', async () => {
    const dates = { checkin: addDays(today, 40), checkout: addDays(today, 41) };
    const q = await call('get_quote', { propertyId: P, unitId: 'familie', ...dates, guests: { adults: 2 }, rooms: 6, hold: true });
    assert.ok(q.holdUntil && Date.parse(q.holdUntil) > Date.now() + 14 * 60_000);
    assert.equal((await roomsLeft('familie', dates)).status, 'unavailable', 'held for this guest');
    const r = await call('request_booking', { quoteId: q.quoteId, guest, guestConsent: true });
    assert.equal(r.booked, true);
  });

  it('modify_request: a confirmed booking moves to other dates and frees the old ones', async () => {
    const r = await book('superior', 2, 4);
    assert.equal(r.booked, true);
    const before = (await roomsLeft('superior')).roomsLeft;
    const newDates = { checkin: addDays(today, 30), checkout: addDays(today, 33) };
    const changed = await call('modify_request', { statusToken: r.statusToken, ...newDates, guestConsent: true });
    assert.equal(changed.booked, true);
    assert.equal(changed.checkin, newDates.checkin);
    assert.equal(changed.roomCount, 2);
    assert.notEqual(changed.statusToken, r.statusToken);
    assert.equal((await call('check_status', { statusToken: r.statusToken })).status, 'cancelled');
    assert.equal((await roomsLeft('superior')).roomsLeft, before + 2, 'old nights free again');
    assert.equal((await roomsLeft('superior', newDates)).roomsLeft, 8);
    assert.match(await callError('modify_request', { statusToken: changed.statusToken, checkin: newDates.checkin, guestConsent: false }), /guest/i);
  });

  it('answer agent: answers from confirmed facts and the FAQ, and admits what it does not know', async () => {
    const dogs = await call('answer_question', { propertyId: P, question: 'Can we bring our dog?' });
    assert.equal(dogs.answered, true);
    assert.equal(dogs.confidence, 'confirmed');
    assert.ok(dogs.sources.some((s: Json) => s.key === 'pets.dogsAllowed'));
    const lift = await call('answer_question', { propertyId: P, question: 'Is er een lift in het hotel?', language: 'nl' });
    assert.equal(lift.confidence, 'faq');
    assert.match(lift.answer, /lift naar alle verdiepingen/);
    const pool = await call('answer_question', { propertyId: P, question: 'Do you have a swimming pool?' });
    assert.equal(pool.answered, false);
    assert.equal(pool.confidence, 'unknown');
    assert.match(pool.next, /ask_host/);
  });

  it('ask_host is answered instantly when the facts cover it, without bothering the hotel', async () => {
    const mails = server.mailer.sent.length;
    const a = await call('ask_host', { propertyId: P, question: 'Is there parking at the hotel?' });
    assert.equal(a.status, 'answered');
    assert.equal(a.answeredBy, 'assistant');
    assert.match(a.answer, /parking/i);
    assert.equal(server.mailer.sent.length, mails, 'no e-mail to the hotel');
    const s = await call('check_status', { statusToken: a.statusToken });
    assert.equal(s.answeredBy, 'assistant');
    const open = await call('ask_host', { propertyId: P, question: 'Can we store a surfboard somewhere?' });
    assert.equal(open.status, 'sent');
    assert.equal(server.mailer.sent.length, mails + 1, 'unknown questions still go to the hotel');
  });

  it('stay page: rooms and rate plan in the form, and "ask us" answered by the answer agent', async () => {
    const page = await (await fetch(`${server.url}/verblijf/het-spaarne?lang=en`)).text();
    assert.match(page, /name="rooms"/);
    assert.match(page, /name="ratePlanId"/);
    assert.match(page, /Ask us/);
    const dates = { checkin: addDays(today, 50), checkout: addDays(today, 51) };
    const price = await (await fetch(`${server.url}/verblijf/het-spaarne/prijs?${new URLSearchParams({ unitId: 'standaard', ...dates, adults: '4', rooms: '2', ratePlanId: 'non-refundable', lang: 'en' })}`)).text();
    assert.match(price, /2 × Standaard/);
    assert.match(price, /Niet-restitueerbaar/);
    const dog = await (await fetch(`${server.url}/verblijf/het-spaarne/vraag?q=${encodeURIComponent('Mag onze hond mee?')}&lang=nl`)).text();
    assert.match(dog, /Honden toegestaan|Ja/);
    const pool = await (await fetch(`${server.url}/verblijf/het-spaarne/vraag?q=${encodeURIComponent('Is there a swimming pool?')}&lang=en`)).text();
    assert.match(pool, /Not known yet/);
    const res = await fetch(`${server.url}/verblijf/het-spaarne/aanvraag`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ unitId: 'standaard', ...dates, adults: '4', rooms: '2', ratePlanId: 'breakfast', name: 'Kim de Vries', email: 'kim@example.com' }),
    });
    assert.equal(res.status, 303);
    const r = server.store.requestsFor(P).find((x) => x.guest.email === 'kim@example.com')!;
    assert.equal(r.rooms, 2);
    assert.equal(r.ratePlanId, 'breakfast');
  });

  it('report_data_issue reaches the hotel and never changes data by itself', async () => {
    const mails = server.mailer.sent.length;
    const r = await call('report_data_issue', { propertyId: P, factKey: 'parking.free', description: 'The hotel website says parking costs €25 per night.' });
    assert.equal(r.status, 'reported');
    assert.equal(server.mailer.sent.length, mails + 1);
    assert.equal((await call('check_status', { statusToken: r.statusToken })).type, 'data_issue');
    const d = await call('get_stay_details', { propertyId: P });
    assert.ok(JSON.stringify(d).includes('parking.free'));
  });

  it('staff keys: reception handles requests and questions, but cannot change the property or manage staff', async () => {
    const owner = { 'content-type': 'application/json', authorization: `Bearer ${ownerKey(server, P)}` };
    const api = (path: string, init: RequestInit = {}, headers: Record<string, string> = owner) => fetch(`${server.url}/api/owner${path}`, { ...init, headers });
    const created = await (await api('/staff', { method: 'POST', body: JSON.stringify({ name: 'Noor (receptie)', role: 'reception' }) })).json();
    assert.match(created.key, /^innli_stf_/);
    const desk = { 'content-type': 'application/json', authorization: `Bearer ${created.key}` };
    assert.deepEqual(await (await api('/me', {}, desk)).json(), { role: 'reception', name: 'Noor (receptie)', property: 'Hotel Het Spaarne' });
    const prop = await (await api('/property', {}, desk)).json();
    assert.equal(prop.property.webhookSecret, undefined, 'no secrets for reception');
    assert.equal((await api('/requests', {}, desk)).status, 200);
    assert.equal((await api('/property', { method: 'PATCH', body: JSON.stringify({ name: 'Hacked' }) }, desk)).status, 403);
    assert.equal((await api('/staff', { method: 'POST', body: JSON.stringify({ name: 'Extra', role: 'manager' }) }, desk)).status, 403);
    assert.equal((await api('/backup', {}, desk)).status, 403);

    // Reception declines a request; the owner sees who did it.
    const dates = { checkin: addDays(today, 70), checkout: addDays(today, 71) };
    const q = await call('get_quote', { propertyId: P, unitId: 'superior', ...dates, guests: { adults: 2 } });
    server.store.getProperty(P)!.bookingRules!.instantBooking = false;
    const r = await call('request_booking', { quoteId: q.quoteId, guest, guestConsent: true });
    server.store.getProperty(P)!.bookingRules!.instantBooking = true;
    assert.equal(r.status, 'new');
    assert.equal((await api(`/requests/${r.requestId}/decline`, { method: 'POST', body: JSON.stringify({ note: 'Sorry, vol' }) }, desk)).status, 200);
    assert.equal(server.store.getRequest(r.requestId)!.handledBy, 'Noor (receptie)');

    const manager = await (await api('/staff', { method: 'POST', body: JSON.stringify({ name: 'Mark', role: 'manager' }) })).json();
    const mgr = { 'content-type': 'application/json', authorization: `Bearer ${manager.key}` };
    assert.equal((await api('/property', { method: 'PATCH', body: JSON.stringify({ phone: '+31 23 000 0000' }) }, mgr)).status, 200);
    assert.equal((await api('/staff', {}, mgr)).status, 403);
    // Removing a key locks that person out at once.
    assert.equal((await api(`/staff/${created.staff.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await api('/requests', {}, desk)).status, 401);
    const list = await (await api('/staff')).json();
    assert.deepEqual(list.staff.map((m: Json) => m.name), ['Mark']);
    assert.ok(!JSON.stringify(list).includes('keyHash'));
  });

  it('outbound webhooks: signed booking events for the hotel PMS', async () => {
    const received: { headers: Record<string, any>; body: string }[] = [];
    const sink = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c)).on('end', () => {
        received.push({ headers: req.headers, body });
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((r) => sink.listen(0, '127.0.0.1', r));
    try {
      const owner = { 'content-type': 'application/json', authorization: `Bearer ${ownerKey(server, P)}` };
      const url = `http://127.0.0.1:${(sink.address() as AddressInfo).port}/innli`;
      const set = await (await fetch(`${server.url}/api/owner/webhook`, { method: 'PUT', headers: owner, body: JSON.stringify({ url }) })).json();
      const secret = set.outboundWebhook.secret;
      assert.match(secret, /^whsec_/);
      const test = await (await fetch(`${server.url}/api/owner/webhook/test`, { method: 'POST', headers: owner, body: '{}' })).json();
      assert.equal(test.ok, true);

      const booked = await book('familie', 2, 6, {}, { checkin: addDays(today, 80), checkout: addDays(today, 82) });
      await call('modify_request', { statusToken: booked.statusToken, checkin: addDays(today, 81), checkout: addDays(today, 83), guestConsent: true });
      await (appLocals(server).webhooks as OutboundWebhooks).idle();
      const events = received.slice(1).map((e) => JSON.parse(e.body));
      assert.deepEqual(events.map((e) => e.type), ['booking.confirmed', 'booking.cancelled', 'booking.confirmed']);
      assert.equal(events[0].data.rooms, 2);
      assert.equal(events[0].data.unitRef, 'FAM');
      assert.equal(events[0].data.guest.email, 'sam@example.com');
      assert.equal(events[2].data.replacesRequestId, events[0].data.requestId);
      for (const e of received) {
        const [t, v1] = String(e.headers['x-innli-signature']).split(',').map((x) => x.split('=')[1]);
        assert.equal(v1, createHmac('sha256', secret).update(`${t}.${e.body}`).digest('hex'), 'valid signature');
      }
      assert.ok(server.store.getProperty(P)!.outboundWebhook!.lastDeliveryAt);
    } finally {
      sink.close();
    }
  });
});
