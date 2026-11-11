import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { addDays } from '../src/domain/dates.ts';
import { StripeHandler } from '../src/payments/handlers.ts';
import { appLocals, freeWindow, ownerKey, startTestServer, type TestServer } from './helpers.ts';

type Json = Record<string, any>;

/** A stand-in for Stripe: records what it is asked and answers like the PaymentIntents API. */
async function fakeStripe() {
  const calls: { path: string; params: Record<string, string>; idempotencyKey?: string; auth?: string }[] = [];
  const intents = new Map<string, Json>();
  const byKey = new Map<string, Json>();
  let n = 0;
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const params = Object.fromEntries(new URLSearchParams(body));
      const key = String(req.headers['idempotency-key'] ?? '');
      calls.push({ path: req.url!, params, idempotencyKey: key, auth: String(req.headers.authorization) });
      const send = (status: number, json: Json) => {
        res.statusCode = status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(json));
      };
      if (byKey.has(key)) return send(200, byKey.get(key)!);
      let out: Json;
      if (req.url === '/v1/payment_intents') {
        if (params.shared_payment_granted_token === 'spt_declined') return send(402, { error: { code: 'card_declined', message: 'Your card was declined.' } });
        out = { id: `pi_${++n}`, status: 'requires_capture', amount: Number(params.amount), currency: params.currency };
        intents.set(out.id, out);
      } else {
        const [, , , id, action] = req.url!.split('/');
        const intent = intents.get(id);
        if (!intent) return send(404, { error: { message: 'No such payment_intent' } });
        intent.status = action === 'capture' ? 'succeeded' : 'canceled';
        out = intent;
      }
      byKey.set(key, out);
      send(200, out);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, intents, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe('ACP checkout sessions (Agentic Commerce Protocol)', () => {
  let server: TestServer;
  let paid: TestServer;
  let stripe: Awaited<ReturnType<typeof fakeStripe>>;
  let key = 0;
  const day = (n: number) => addDays(new Date().toISOString().slice(0, 10), n);
  const acp = (s: TestServer) => async (method: string, path: string, body?: Json, headers: Record<string, string> = {}) => {
    const res = await fetch(`${s.url}/acp${path}`, { method, headers: { 'content-type': 'application/json', 'api-version': '2026-04-17', authorization: `Bearer ${s.creds.agentKey}`, ...(method === 'POST' ? { 'idempotency-key': `k-${++key}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, headers: res.headers, body: (await res.json()) as Json };
  };
  const buyer = { first_name: 'John', last_name: 'Smith', email: 'john@example.com' };
  const idle = (s: TestServer) => (appLocals(s).acp as { idle(): Promise<void> }).idle();
  const accept = (s: TestServer, propertyId: string, email: string) => {
    const r = s.store.requestsFor(propertyId).find((x) => x.guest.email === email && x.status === 'new')!;
    return fetch(`${s.url}/api/owner/requests/${r.id}/accept`, { method: 'POST', headers: { authorization: `Bearer ${ownerKey(s, propertyId)}`, 'content-type': 'application/json' }, body: '{}' });
  };

  before(async () => {
    stripe = await fakeStripe();
    server = await startTestServer({ hotel: true });
    paid = await startTestServer({ hotel: true, paymentHandler: new StripeHandler({ secretKey: 'sk_test_123', account: 'acct_test', fetcher: fetch, apiBase: stripe.url }) });
  });
  after(async () => {
    await server.close();
    await paid.close();
    await stripe.close();
  });

  it('is discoverable and enforces the protocol headers', async () => {
    const disco = (await (await fetch(`${server.url}/.well-known/acp.json`)).json()) as Json;
    assert.equal(disco.protocol.name, 'acp');
    assert.equal(disco.api_base_url, `${server.url}/acp`);
    assert.deepEqual(disco.capabilities.services, ['checkout']);
    const call = acp(server);
    const item = { id: `prop_spaarne:standaard:${day(40)}:${day(42)}:2`, quantity: 1 };
    const noVersion = await call('POST', '/checkout_sessions', { items: [item] }, { 'api-version': '' });
    assert.deepEqual([noVersion.status, noVersion.body.code], [400, 'missing_api_version']);
    assert.ok(noVersion.body.supported_versions.includes('2026-04-17'));
    assert.equal((await call('POST', '/checkout_sessions', { items: [item] }, { 'api-version': '2020-01-01' })).body.code, 'unsupported_api_version');
    const noKey = await call('POST', '/checkout_sessions', { items: [item] }, { 'idempotency-key': '' });
    assert.deepEqual([noKey.status, noKey.body.type, noKey.body.code], [400, 'invalid_request', 'idempotency_key_required']);
    const first = await call('POST', '/checkout_sessions', { items: [item] }, { 'idempotency-key': 'same', 'request-id': 'req-1' });
    assert.equal(first.status, 201);
    assert.equal(first.headers.get('idempotency-key'), 'same');
    assert.equal(first.headers.get('request-id'), 'req-1');
    const replay = await call('POST', '/checkout_sessions', { items: [item] }, { 'idempotency-key': 'same' });
    assert.equal(replay.body.id, first.body.id);
    const conflict = await call('POST', '/checkout_sessions', { items: [{ ...item, quantity: 2 }] }, { 'idempotency-key': 'same' });
    assert.deepEqual([conflict.status, conflict.body.code], [422, 'idempotency_conflict']);
    const bad = await call('POST', '/checkout_sessions', { items: [{ id: 'nonsense', quantity: 1 }] });
    assert.deepEqual([bad.status, bad.body.type, bad.body.param], [400, 'invalid_request', '$.items[0].id']);
    assert.equal((await call('GET', '/checkout_sessions/cs_unknown')).status, 404);
  });

  it('without a payment handler: the stay is booked and the guest pays the property', async () => {
    const call = acp(server);
    // The item is a quote the agent already got over MCP or REST.
    const quote = (await (await fetch(`${server.url}/api/agent/v1/tools/get_quote`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${server.creds.agentKey}` }, body: JSON.stringify({ propertyId: 'prop_spaarne', unitId: 'standaard', checkin: day(50), checkout: day(53), guests: { adults: 2 }, ratePlanId: 'non-refundable' }) })).json()) as Json;
    const created = await call('POST', '/checkout_sessions', { items: [{ id: quote.quoteId, quantity: 1 }] });
    const s = created.body;
    assert.equal(s.status, 'not_ready_for_payment');
    assert.equal(s.currency, 'eur');
    assert.deepEqual(s.capabilities.payment.handlers, []);
    const li = s.line_items[0];
    assert.equal(li.subtotal, li.base_amount - li.discount);
    assert.equal(li.total, li.subtotal + li.tax);
    assert.equal(li.total, Math.round(quote.total * 100), 'the same price as the quote, in minor units');
    assert.equal(s.totals.at(-1).amount, li.total);
    assert.ok(li.custom_attributes.some((a: Json) => a.display_name === 'Check-in' && a.value === day(50)));
    assert.ok(li.disclosures.some((d: Json) => /Non-refundable/.test(d.content)));
    assert.equal(s.selected_fulfillment_options[0].option_id, s.fulfillment_options[0].id);
    assert.ok(s.messages.some((m: Json) => m.type === 'error' && m.code === 'missing' && m.param === '$.buyer'));

    const early = await call('POST', `/checkout_sessions/${s.id}/complete`, {});
    assert.deepEqual([early.status, early.body.code, early.body.param], [400, 'missing', '$.buyer']);
    const ready = await call('POST', `/checkout_sessions/${s.id}`, { fulfillment_details: { name: 'John Smith', email: 'john@example.com' } });
    assert.equal(ready.body.status, 'ready_for_payment');
    assert.equal(ready.body.buyer.last_name, 'Smith');
    const card = await call('POST', `/checkout_sessions/${s.id}/complete`, { payment_data: { handler_id: 'card_tokenized', instrument: { type: 'card', credential: { type: 'spt', token: 'spt_x' } } } });
    assert.deepEqual([card.status, card.body.param], [400, '$.payment_data']);

    const done = await call('POST', `/checkout_sessions/${s.id}/complete`, {});
    assert.equal(done.body.status, 'completed');
    assert.match(done.body.order.id, /^req_/);
    assert.equal(done.body.order.checkout_session_id, s.id);
    assert.ok(done.body.order.permalink_url.startsWith(server.url));
    assert.equal((await call('POST', `/checkout_sessions/${s.id}/complete`, {})).body.order.id, done.body.order.id, 'completing twice never books twice');
    assert.equal((await call('POST', `/checkout_sessions/${s.id}/cancel`)).status, 405);
    assert.equal(server.store.getRequest(done.body.order.id)!.consent!.termsHash!.startsWith('sha256:'), true);
  });

  it('with a payment handler: authorised at completion, captured only when the host confirms', async () => {
    const call = acp(paid);
    const w = freeWindow(['duinzicht-1', 'duinzicht-2'], 2, 40);
    const s = (await call('POST', '/checkout_sessions', { items: [{ id: `prop_duinzicht:kamer-1:${w.checkin}:${w.checkout}:2`, quantity: 1 }], buyer })).body;
    assert.equal(s.status, 'ready_for_payment');
    const handler = s.capabilities.payment.handlers[0];
    assert.deepEqual([handler.id, handler.psp, handler.requires_delegate_payment, handler.config.environment], ['card_tokenized', 'stripe', true, 'test']);
    assert.ok(s.messages.some((m: Json) => /only charged when the host confirms/.test(m.content)));

    const missing = await call('POST', `/checkout_sessions/${s.id}/complete`, {});
    assert.deepEqual([missing.status, missing.body.code, missing.body.param], [400, 'missing', '$.payment_data']);
    const declined = await call('POST', `/checkout_sessions/${s.id}/complete`, { payment_data: { handler_id: 'card_tokenized', instrument: { type: 'card', credential: { type: 'spt', token: 'spt_declined' } } } });
    assert.deepEqual([declined.status, declined.body.code], [402, 'payment_declined']);
    assert.equal(paid.store.requestsFor('prop_duinzicht').length, 0, 'a declined card makes no request');

    const done = await call('POST', `/checkout_sessions/${s.id}/complete`, { payment_data: { handler_id: 'card_tokenized', instrument: { type: 'card', credential: { type: 'spt', token: 'spt_ok' } } } });
    assert.equal(done.body.status, 'in_progress', 'the host still decides');
    assert.equal(done.body.order, undefined);
    assert.equal(done.body['io.innli'].card_payment.status, 'authorized');
    const authorize = stripe.calls.findLast((c) => c.path === '/v1/payment_intents')!;
    assert.equal(authorize.auth, 'Bearer sk_test_123');
    assert.deepEqual([authorize.params.capture_method, authorize.params.confirm, authorize.params.shared_payment_granted_token, authorize.params.currency], ['manual', 'true', 'spt_ok', 'eur']);
    assert.equal(Number(authorize.params.amount), done.body.totals.at(-1).amount);
    assert.ok(![...stripe.intents.values()].some((i) => i.status === 'succeeded'), 'nothing is taken before the host confirms');

    await accept(paid, 'prop_duinzicht', 'john@example.com');
    await idle(paid);
    const confirmed = (await call('GET', `/checkout_sessions/${s.id}`)).body;
    assert.equal(confirmed.status, 'completed');
    assert.equal(confirmed['io.innli'].card_payment.status, 'captured');
    assert.equal(stripe.intents.get(paid.store.getRequest(confirmed.order.id)!.cardPayment!.reference)!.status, 'succeeded');
  });

  it('releases the card when the host declines, and charges only the deposit when there is one', async () => {
    const call = acp(paid);
    const pay = { payment_data: { handler_id: 'card_tokenized', instrument: { type: 'card', credential: { type: 'spt', token: 'spt_ok' } } } };
    const w = freeWindow(['duinzicht-1', 'duinzicht-2'], 2, 70);
    const s = (await call('POST', '/checkout_sessions', { items: [{ id: `prop_duinzicht:kamer-2:${w.checkin}:${w.checkout}:2`, quantity: 1 }], buyer: { ...buyer, email: 'no@example.com' } })).body;
    await call('POST', `/checkout_sessions/${s.id}/complete`, pay);
    const r = paid.store.requestsFor('prop_duinzicht').find((x) => x.guest.email === 'no@example.com')!;
    await fetch(`${paid.url}/api/owner/requests/${r.id}/decline`, { method: 'POST', headers: { authorization: `Bearer ${ownerKey(paid, 'prop_duinzicht')}`, 'content-type': 'application/json' }, body: '{}' });
    await idle(paid);
    const after = (await call('GET', `/checkout_sessions/${s.id}`)).body;
    assert.equal(after.status, 'canceled');
    assert.equal(after['io.innli'].card_payment.status, 'released');
    assert.equal(stripe.intents.get(r.cardPayment!.reference)!.status, 'canceled');

    // Instant booking with a 30% deposit: captured at once, for the deposit only, and the deposit is marked paid.
    paid.store.getProperty('prop_spaarne')!.bookingRules = { instantBooking: true, minLeadDays: 0, maxNights: 21, holdHours: 12, deposit: { percent: 30, dueDays: 7 } };
    const h = (await call('POST', '/checkout_sessions', { items: [{ id: `prop_spaarne:standaard:${day(60)}:${day(62)}:2`, quantity: 2 }], buyer: { ...buyer, email: 'dep@example.com' } })).body;
    assert.match(h.line_items[0].name, /^2 × /);
    const booked = (await call('POST', `/checkout_sessions/${h.id}/complete`, pay)).body;
    assert.equal(booked.status, 'completed');
    assert.equal(booked['io.innli'].card_payment.status, 'captured');
    assert.equal(booked['io.innli'].card_payment.amount, Math.round(booked.totals.at(-1).amount * 0.3));
    assert.equal(paid.store.getRequest(booked.order.id)!.payment!.status, 'paid');
  });

  it('holds the rooms, and hands over when the property books in its own system', async () => {
    const call = acp(server);
    const left = async () => ((await (await fetch(`${server.url}/api/agent/v1/tools/check_availability`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ propertyId: 'prop_spaarne', checkin: day(80), checkout: day(81) }) })).json()) as Json).units.find((u: Json) => u.unitId === 'standaard').roomsLeft;
    const before = await left();
    const s = (await call('POST', '/checkout_sessions', { items: [{ id: `prop_spaarne:standaard:${day(80)}:${day(81)}:2`, quantity: 1 }] })).body;
    assert.equal(await left(), before - 1);
    assert.ok(Date.parse(s.expires_at) > Date.now() + 10 * 60_000);
    assert.equal((await call('POST', `/checkout_sessions/${s.id}/cancel`)).body.status, 'canceled');
    assert.equal(await left(), before);
    // Another caller cannot see a session an identified caller opened.
    assert.equal((await call('GET', `/checkout_sessions/${s.id}`, undefined, { authorization: '' })).status, 404);

    const w = freeWindow(['hooiberg-tuinkamer'], 2, 30);
    const own = (await call('POST', '/checkout_sessions', { items: [{ id: `prop_hooiberg:tuinkamer:${w.checkin}:${w.checkout}:2`, quantity: 1 }], buyer })).body;
    assert.equal(own.status, 'not_ready_for_payment');
    assert.ok(own.messages.some((m: Json) => m.code === 'intervention_required' && /\/r\//.test(m.content)));
    assert.equal((await call('POST', `/checkout_sessions/${own.id}/complete`, {})).body.code, 'intervention_required');
  });
});
