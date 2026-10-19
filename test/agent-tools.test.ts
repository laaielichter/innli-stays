import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { addDays } from '../src/domain/dates.ts';
import { freeWindow, ownerKey, startTestServer, type TestServer } from './helpers.ts';

type Json = Record<string, any>;

describe('agent tools beyond search', () => {
  let server: TestServer;
  let client: Client;
  const today = new Date().toISOString().slice(0, 10);

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

  before(async () => {
    server = await startTestServer();
    client = new Client({ name: 'agent', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${server.creds.agentKey}` } } }));
  });
  after(async () => {
    await client.close();
    await server.close();
  });

  it('find_available_dates: flexible dates with prices, and weekends only', async () => {
    const r = await call('find_available_dates', { propertyId: 'prop_duinzicht', from: addDays(today, 7), to: addDays(today, 40), nights: 2, guests: { adults: 2 } });
    assert.ok(r.options.length > 0);
    for (const o of r.options) {
      assert.equal(o.checkout, addDays(o.checkin, 2));
      assert.ok(o.units.every((u: Json) => typeof u.total === 'number' && u.certainty === 'synced'));
    }
    const weekends = await call('find_available_dates', { propertyId: 'prop_duinzicht', from: addDays(today, 7), to: addDays(today, 60), nights: 2, weekendsOnly: true });
    assert.ok(weekends.options.every((o: Json) => new Date(`${o.checkin}T00:00:00Z`).getUTCDay() === 5));
    const live = await call('find_available_dates', { propertyId: 'prop_hooiberg', from: addDays(today, 7), to: addDays(today, 60), nights: 2 });
    assert.ok(live.checkedCheckinDates <= 14, 'live systems are queried a bounded number of times');
    assert.match(await callError('find_available_dates', { propertyId: 'prop_duinzicht', from: addDays(today, 7), to: addDays(today, 8), nights: 3 }), /shorter/);
  });

  it('get_availability_calendar: nights and prices per room, or a pointer for live systems', async () => {
    const month = addDays(today, 40).slice(0, 7);
    const cal = await call('get_availability_calendar', { propertyId: 'prop_duinzicht', month });
    const room = cal.units.find((u: Json) => u.unitId === 'kamer-2');
    assert.ok(room.calendar.length >= 28);
    const friday = room.calendar.find((n: Json) => new Date(`${n.date}T00:00:00Z`).getUTCDay() === 5);
    const monday = room.calendar.find((n: Json) => new Date(`${n.date}T00:00:00Z`).getUTCDay() === 1);
    assert.equal(friday.price - monday.price, 15, 'weekend supplement');
    assert.ok(room.calendar.some((n: Json) => !n.available), 'demo feed has bookings');
    const live = await call('get_availability_calendar', { propertyId: 'prop_hooiberg', month });
    assert.equal(live.units[0].calendar, null);
    assert.match(live.units[0].reason, /find_available_dates/);
  });

  it('compare_stays: side by side with verification status and unknowns', async () => {
    const { checkin, checkout } = freeWindow(['hooiberg-tuinkamer', 'kraaiennest-bos'], 2);
    const r = await call('compare_stays', { propertyIds: ['prop_hooiberg', 'prop_kraaiennest', 'prop_duinzicht'], checkin, checkout, guests: { adults: 2, dogs: 1 } });
    const byName = Object.fromEntries(r.rows.map((x: Json) => [x.name, x]));
    assert.equal(byName['B&B De Hooiberg'].keyFacts.gardenFullyEnclosed.status, 'confirmed');
    assert.equal(byName['Logies Het Kraaiennest'].keyFacts.gardenFullyEnclosed.status, 'unconfirmed');
    assert.equal(byName['Pension Duinzicht'].matchQuality, 'not_met', 'no dogs at Duinzicht');
    assert.ok(byName['B&B De Hooiberg'].offer.total > 0);
    assert.ok(byName['Logies Het Kraaiennest'].unknownCriticalFacts > byName['B&B De Hooiberg'].unknownCriticalFacts);
  });

  it('get_quote: nightly breakdown, policies and a sentence for the guest', async () => {
    const { checkin, checkout } = freeWindow(['hooiberg-tuinkamer'], 2);
    const q = await call('get_quote', { propertyId: 'prop_hooiberg', unitId: 'tuinkamer', checkin, checkout });
    assert.equal(q.nightly.length, 2);
    assert.equal(q.policies.cancellation.status, 'confirmed');
    assert.equal(q.policies.checkInFrom.value, '15:00');
    assert.match(q.summaryForGuest, /Tuinkamer at B&B De Hooiberg, 2 nights.*including all mandatory costs/);
  });

  it('search_stays: sort by price', async () => {
    const { checkin, checkout } = freeWindow(['hooiberg-tuinkamer', 'kraaiennest-bos', 'duinzicht-1', 'duinzicht-2'], 2);
    const r = await call('search_stays', { country: 'NL', checkin, checkout, sort: 'price', limit: 10 });
    const totals = r.results.map((x: Json) => x.offer.total);
    assert.deepEqual(totals, [...totals].sort((a, b) => a - b));
  });

  it('request_booking: needs consent, is idempotent, and becomes booked only when the host accepts', async () => {
    const { checkin, checkout } = freeWindow(['duinzicht-1'], 2);
    const quote = await call('get_quote', { propertyId: 'prop_duinzicht', unitId: 'kamer-1', checkin, checkout });
    const guest = { name: 'Robin de Vries', email: 'robin@example.com' };
    assert.match(await callError('request_booking', { quoteId: quote.quoteId, guest, guestConsent: false }), /guestConsent/);

    const first = await call('request_booking', { quoteId: quote.quoteId, guest, message: 'Aankomst rond 17:00', guestConsent: true, idempotencyKey: 'conv-42' });
    assert.equal(first.status, 'new');
    assert.ok(first.holdUntil, 'room is held while the host decides');
    assert.equal(first.record.consent.via, 'agent');
    assert.equal(first.booked, false);
    const retry = await call('request_booking', { quoteId: quote.quoteId, guest, guestConsent: true, idempotencyKey: 'conv-42' });
    assert.equal(retry.requestId, first.requestId, 'no duplicate on retry');

    assert.equal((await call('check_status', { statusToken: first.statusToken })).booked, false);
    const headers = { authorization: `Bearer ${ownerKey(server, 'prop_duinzicht')}`, 'content-type': 'application/json' };
    await fetch(`${server.url}/api/owner/requests/${first.requestId}/accept`, { method: 'POST', headers, body: JSON.stringify({ note: 'Tot dan!' }) });
    const status = await call('check_status', { statusToken: first.statusToken });
    assert.equal(status.booked, true);
    assert.equal(status.hostMessage, 'Tot dan!');

    const live = await call('get_quote', { propertyId: 'prop_hooiberg', unitId: 'tuinkamer', ...freeWindow(['hooiberg-tuinkamer'], 2) });
    assert.match(await callError('request_booking', { quoteId: live.quoteId, guest, guestConsent: true }), /prepare_booking/);
  });

  it('ask_host: an unknown fact becomes a confirmed fact through the host\'s answer', async () => {
    const before = await call('get_stay_details', { propertyId: 'prop_duinzicht' });
    assert.ok(before.facts.unknown.includes('Garden is fully enclosed (a dog cannot get out)'));
    assert.match(await callError('ask_host', { propertyId: 'prop_duinzicht', question: 'Is de tuin helemaal omheind?', replyEmail: 'robin@example.com' }), /guestConsent/);
    const asked = await call('ask_host', { propertyId: 'prop_duinzicht', question: 'Is de tuin helemaal omheind?', factKey: 'garden.fullyEnclosed', replyEmail: 'robin@example.com', guestConsent: true });
    assert.equal(asked.status, 'sent');

    const headers = { authorization: `Bearer ${ownerKey(server, 'prop_duinzicht')}`, 'content-type': 'application/json' };
    const { questions } = await (await fetch(`${server.url}/api/owner/questions`, { headers })).json();
    const q = questions.find((x: Json) => x.question.includes('omheind'));
    const answered = await fetch(`${server.url}/api/owner/questions/${q.id}/answer`, { method: 'POST', headers, body: JSON.stringify({ answer: 'Ja, met een poort die dicht kan.', factValue: true }) });
    assert.equal(answered.status, 200);

    const status = await call('check_status', { statusToken: asked.statusToken });
    assert.equal(status.status, 'answered');
    assert.match(status.answer, /poort/);
    assert.ok(server.mailer.sent.some((m) => m.to === 'robin@example.com' && /poort/.test(m.text)));
    const after = await call('get_stay_details', { propertyId: 'prop_duinzicht' });
    const garden = after.facts.facts.find((f: Json) => f.key === 'garden.fullyEnclosed');
    assert.equal(garden.status, 'confirmed');
    assert.equal(garden.value, true);
  });
});
