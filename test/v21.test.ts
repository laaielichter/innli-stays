import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, verify, createPublicKey, type KeyObject } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { jwkThumbprint, parseDictionary, parseSignatureInput, signatureBase } from '../src/agent/botAuth.ts';
import { MAX_OPEN_HOLDS } from '../src/requests/agentActions.ts';
import { verifyRecord } from '../src/security/signing.ts';
import { addDays } from '../src/domain/dates.ts';
import { appLocals, freeWindow, ownerKey, startTestServer, type TestServer } from './helpers.ts';

type Json = Record<string, any>;

/** An agent platform with its own key directory, signing requests the Web Bot Auth way. */
async function startPlatform() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as { kty: string; crv: string; x: string };
  const keyId = jwkThumbprint(jwk);
  const received: { headers: Record<string, string>; body: string }[] = [];
  const server: Server = createServer((req, res) => {
    if (req.url === '/.well-known/http-message-signatures-directory') {
      res.setHeader('content-type', 'application/http-message-signatures-directory+json');
      res.end(JSON.stringify({ keys: [{ kty: jwk.kty, crv: jwk.crv, x: jwk.x }] }));
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers as Record<string, string>, body });
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let n = 0;
  /** Headers for a signed request to `url`. */
  const signed = (url: string, opts: { key?: KeyObject; nonce?: string; created?: number; dictionary?: boolean } = {}) => {
    const created = opts.created ?? Math.floor(Date.now() / 1000);
    const agent = opts.dictionary ? `sig1="${origin}"` : `"${origin}"`;
    const component = opts.dictionary ? '"signature-agent";key="sig1"' : '"signature-agent"';
    const params = `("@authority" ${component});created=${created};expires=${created + 60};keyid="${keyId}";alg="ed25519";nonce="${opts.nonce ?? `n${++n}-${created}`}";tag="web-bot-auth"`;
    const base = [`"@authority": ${new URL(url).host}`, `${component}: ${opts.dictionary ? `"${origin}"` : agent}`, `"@signature-params": ${params}`].join('\n');
    return { 'signature-agent': agent, 'signature-input': `sig1=${params}`, signature: `sig1=:${sign(null, Buffer.from(base), opts.key ?? privateKey).toString('base64')}:` };
  };
  return { origin, host: new URL(origin).host, signed, received, publicKey, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

describe('2.1: know your agent, protected holds and UCP lodging', () => {
  let server: TestServer;
  let platform: Awaited<ReturnType<typeof startPlatform>>;
  const guest = { name: 'Noor Bakker', email: 'noor@example.com' };
  const tool = async (name: string, args: Json, headers: Record<string, string> = {}) => {
    const url = `${server.url}/api/agent/v1/tools/${name}`;
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(args) });
    return { status: res.status, headers: res.headers, body: (await res.json()) as Json };
  };
  const asPlatform = (name: string) => platform.signed(`${server.url}/api/agent/v1/tools/${name}`);
  const owner = (id: string) => ({ authorization: `Bearer ${ownerKey(server, id)}`, 'content-type': 'application/json' });
  const setRules = (id: string, rules: Json) => fetch(`${server.url}/api/owner/property`, { method: 'PATCH', headers: owner(id), body: JSON.stringify({ bookingRules: rules }) });
  /** A window in which Duinzicht room 1 is free, far enough apart per test. */
  let cursor = 40;
  const window = (_n?: number) => {
    const w = freeWindow(['duinzicht-1', 'duinzicht-2'], 2, cursor);
    cursor = Math.round((Date.parse(w.checkout) - Date.parse(new Date().toISOString().slice(0, 10))) / 86_400_000) + 2;
    return w;
  };

  before(async () => {
    server = await startTestServer({ hotel: true });
    platform = await startPlatform();
  });
  after(async () => {
    await (appLocals(server).callbacks as { idle(): Promise<void> }).idle();
    await platform.close();
    await server.close();
  });

  describe('Web Bot Auth', () => {
    it('recognises a platform by its signature: own rate limit, no account', async () => {
      const anonymous = await tool('search_stays', { area: 'Egmond' });
      assert.equal(anonymous.headers.get('x-innli-agent-identity'), 'anonymous');
      assert.equal(anonymous.headers.get('ratelimit-policy'), '120;w=60');

      const res = await tool('search_stays', { area: 'Egmond' }, asPlatform('search_stays'));
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-innli-agent-identity'), `verified; agent="${platform.host}"`);
      assert.equal(res.headers.get('ratelimit-policy'), '600;w=60');
    });

    it('accepts the dictionary form of Signature-Agent too', async () => {
      const res = await tool('search_stays', { area: 'Egmond' }, platform.signed(`${server.url}/api/agent/v1/tools/search_stays`, { dictionary: true }));
      assert.match(String(res.headers.get('x-innli-agent-identity')), /^verified/);
    });

    it('treats a broken signature as anonymous and says why', async () => {
      const other = generateKeyPairSync('ed25519').privateKey;
      const forged = await tool('search_stays', { area: 'Egmond' }, platform.signed(`${server.url}/api/agent/v1/tools/search_stays`, { key: other }));
      assert.equal(forged.status, 200, 'the request is still served, as an anonymous one');
      assert.equal(forged.headers.get('x-innli-agent-identity'), 'invalid; reason="bad_signature"');
      assert.equal(forged.headers.get('ratelimit-policy'), '120;w=60');

      const old = await tool('search_stays', { area: 'Egmond' }, platform.signed(`${server.url}/api/agent/v1/tools/search_stays`, { created: Math.floor(Date.now() / 1000) - 3600 }));
      assert.equal(old.headers.get('x-innli-agent-identity'), 'invalid; reason="expired"');

      const headers = platform.signed(`${server.url}/api/agent/v1/tools/search_stays`, { nonce: 'only-once' });
      assert.match(String((await tool('search_stays', { area: 'Egmond' }, headers)).headers.get('x-innli-agent-identity')), /^verified/);
      assert.equal((await tool('search_stays', { area: 'Egmond' }, headers)).headers.get('x-innli-agent-identity'), 'invalid; reason="replayed_nonce"');

      // A signature made for another host is worthless here.
      const elsewhere = await tool('search_stays', { area: 'Egmond' }, platform.signed('https://other.example/api/agent/v1/tools/search_stays'));
      assert.equal(elsewhere.headers.get('x-innli-agent-identity'), 'invalid; reason="bad_signature"');
    });

    it('publishes its own keys in the standard directory', async () => {
      const res = await fetch(`${server.url}/.well-known/http-message-signatures-directory`);
      assert.match(String(res.headers.get('content-type')), /http-message-signatures-directory\+json/);
      const { keys } = (await res.json()) as Json;
      assert.equal(keys[0].kty, 'OKP');
      assert.equal(keys[0].kid, jwkThumbprint(keys[0]));
      const wellKnown = (await (await fetch(`${server.url}/.well-known/innli.json`)).json()) as Json;
      const spki = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: keys[0].x }, format: 'jwk' }).export({ type: 'spki', format: 'der' }).toString('base64');
      assert.ok(JSON.stringify(wellKnown).includes(spki), 'the same key that signs booking records');
    });

    it('puts the verified platform in the signed booking record, and signs callbacks with RFC 9421', async () => {
      const { checkin, checkout } = window(40);
      const q = (await tool('get_quote', { propertyId: 'prop_duinzicht', unitId: 'kamer-1', checkin, checkout }, asPlatform('get_quote'))).body;
      assert.equal(q.cancellation.refundability, 'unknown', 'a text-only policy is never classified by guessing');
      const r = (await tool('request_booking', { quoteId: q.quoteId, guest, guestConsent: true, consentHash: q.consent.hash, callbackUrl: `${platform.origin}/hook` }, asPlatform('request_booking'))).body;
      assert.equal(r.status, 'new');
      assert.equal(r.signedRecord.consent.agentIdentity, 'verified');
      assert.equal(r.signedRecord.consent.agentDomain, platform.host);
      assert.equal(r.signedRecord.consent.agentClient, platform.host);
      const key = ((await (await fetch(`${server.url}/.well-known/innli.json`)).json()) as Json).signingKey;
      assert.ok(verifyRecord(key, r.signedRecord, r.signature.value));

      await fetch(`${server.url}/api/owner/requests/${r.requestId}/accept`, { method: 'POST', headers: owner('prop_duinzicht'), body: '{}' });
      await (appLocals(server).callbacks as { idle(): Promise<void> }).idle();
      const hook = platform.received.at(-1)!;
      assert.equal(JSON.parse(hook.body).event.booked, true);
      // Verify like any RFC 9421 receiver would: digest, then the signature against the published directory.
      assert.equal(hook.headers['content-digest'], `sha-256=:${createHash('sha256').update(hook.body).digest('base64')}:`);
      const [input] = parseSignatureInput(hook.headers['signature-input']);
      assert.equal(input.params.tag, 'web-bot-auth');
      const base = signatureBase(input, { method: 'POST', path: '/hook', scheme: 'http', authorities: [platform.host], headers: hook.headers }, platform.host)!;
      const { keys } = (await (await fetch(`${JSON.parse(hook.headers['signature-agent'])}/.well-known/http-message-signatures-directory`)).json()) as Json;
      assert.equal(keys[0].kid, input.params.keyid);
      const sig = Buffer.from(parseDictionary(hook.headers.signature)[0].raw.slice(1, -1), 'base64');
      assert.ok(verify(null, Buffer.from(base), createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: keys[0].x }, format: 'jwk' }), sig));

      const { agents } = (await (await fetch(`${server.url}/api/owner/agents`, { headers: owner('prop_duinzicht') })).json()) as Json;
      const row = agents.find((a: Json) => a.agent === platform.host);
      assert.deepEqual([row.identity, row.requests, row.booked], ['verified', 1, 1]);
    });
  });

  describe('holds cannot be abused', () => {
    it('limits open requests of an anonymous agent, not of a verified one', async () => {
      const made: Json[] = [];
      for (let i = 0; i < MAX_OPEN_HOLDS.anonymous + 1; i++) {
        const { checkin, checkout } = window(60 + i * 7);
        const q = (await tool('get_quote', { propertyId: 'prop_duinzicht', unitId: 'kamer-1', checkin, checkout })).body;
        made.push(await tool('request_booking', { quoteId: q.quoteId, guest: { name: 'Bot Net', email: `bot${i}@example.com` }, guestConsent: true }));
      }
      assert.deepEqual(made.slice(0, MAX_OPEN_HOLDS.anonymous).map((m) => m.status), Array(MAX_OPEN_HOLDS.anonymous).fill(200));
      const refused = made.at(-1)!;
      assert.equal(refused.status, 429);
      assert.equal(refused.body.code, 'LIMIT_REACHED');
      assert.equal(refused.body.retryable, false);
      assert.deepEqual(refused.body.nextTools, ['check_status', 'cancel_request']);

      // Withdrawing one frees the place again.
      await tool('cancel_request', { statusToken: made[0].body.statusToken, guestConsent: true });
      const { checkin, checkout } = window(100);
      const q = (await tool('get_quote', { propertyId: 'prop_duinzicht', unitId: 'kamer-1', checkin, checkout })).body;
      assert.equal((await tool('request_booking', { quoteId: q.quoteId, guest: { name: 'Bot Net', email: 'bot9@example.com' }, guestConsent: true })).status, 200);

      // A platform that proved who it is works for many guests at once.
      for (let i = 0; i < MAX_OPEN_HOLDS.anonymous + 1; i++) {
        const w = window(120 + i * 7);
        const pq = (await tool('get_quote', { propertyId: 'prop_duinzicht', unitId: 'kamer-2', ...w }, asPlatform('get_quote'))).body;
        const pr = await tool('request_booking', { quoteId: pq.quoteId, guest: { name: 'Echte Gast', email: `gast${i}@example.com` }, guestConsent: true }, asPlatform('request_booking'));
        assert.equal(pr.status, 200, JSON.stringify(pr.body));
      }
    });

    it('limits open requests per guest address', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < MAX_OPEN_HOLDS.perGuest + 1; i++) {
        const w = window(200 + i * 7);
        const q = (await tool('get_quote', { propertyId: 'prop_duinzicht', unitId: 'kamer-1', ...w }, asPlatform('get_quote'))).body;
        statuses.push((await tool('request_booking', { quoteId: q.quoteId, guest: { name: 'Same Guest', email: 'Same@Example.com' }, guestConsent: true }, asPlatform('request_booking'))).status);
      }
      assert.deepEqual(statuses, [...Array(MAX_OPEN_HOLDS.perGuest).fill(200), 429]);
    });

    it('lets a host take requests from identified agents only', async () => {
      await setRules('prop_spaarne', { instantBooking: true, minLeadDays: 0, maxNights: 21, holdHours: 12, requireIdentifiedAgent: true });
      const checkin = addDays(new Date().toISOString().slice(0, 10), 50);
      const args = { propertyId: 'prop_spaarne', unitId: 'standaard', checkin, checkout: addDays(checkin, 2) };
      const q = (await tool('get_quote', args)).body;
      assert.ok(q.quoteId, 'anonymous agents may still search and quote');
      const refused = await tool('request_booking', { quoteId: q.quoteId, guest, guestConsent: true });
      assert.equal(refused.status, 403);
      assert.equal(refused.body.code, 'AGENT_IDENTITY_REQUIRED');
      assert.match(refused.body.hint, /Web Bot Auth/);

      const ok = await tool('request_booking', { quoteId: q.quoteId, guest, guestConsent: true }, asPlatform('request_booking'));
      assert.equal(ok.body.booked, true);
      const keyed = (await tool('get_quote', args, { authorization: `Bearer ${server.creds.agentKey}` })).body;
      assert.equal((await tool('request_booking', { quoteId: keyed.quoteId, guest, guestConsent: true }, { authorization: `Bearer ${server.creds.agentKey}` })).body.booked, true);
      await setRules('prop_spaarne', { instantBooking: true, minLeadDays: 0, maxNights: 21, holdHours: 12, requireIdentifiedAgent: false });
    });
  });

  describe('Idempotency-Key', () => {
    it('answers a retry with the first result, and refuses a reused key with another body', async () => {
      const checkin = addDays(new Date().toISOString().slice(0, 10), 70);
      const q = (await tool('get_quote', { propertyId: 'prop_spaarne', unitId: 'standaard', checkin, checkout: addDays(checkin, 1) })).body;
      const args = { quoteId: q.quoteId, guest: { name: 'Retry Guest', email: 'retry@example.com' }, guestConsent: true };
      const first = await tool('request_booking', args, { 'idempotency-key': 'key-1' });
      assert.equal(first.body.booked, true);
      assert.equal(first.headers.get('idempotent-replayed'), null);
      const again = await tool('request_booking', args, { 'idempotency-key': 'key-1' });
      assert.equal(again.headers.get('idempotent-replayed'), 'true');
      assert.equal(again.body.requestId, first.body.requestId);
      const other = await tool('request_booking', { ...args, guest: { name: 'Someone Else', email: 'else@example.com' } }, { 'idempotency-key': 'key-1' });
      assert.equal(other.status, 409);
      assert.equal(other.body.code, 'idempotency_key_reused');
      assert.equal(server.store.requestsFor('prop_spaarne').filter((r) => r.guest.email === 'retry@example.com').length, 1);
    });
  });

  describe('UCP lodging booking sessions', () => {
    const ucp = async (method: string, path: string, body?: Json, headers: Record<string, string> = {}) => {
      const res = await fetch(`${server.url}/ucp/v1${path}`, { method, headers: { 'content-type': 'application/json', 'ucp-agent': 'profile="https://platform.example/profile"', ...headers }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, headers: res.headers, body: (await res.json()) as Json };
    };
    const sumsToTotal = (totals: Json[]) => assert.equal(totals.filter((t) => t.type !== 'total').reduce((n, t) => n + t.amount, 0), totals.find((t) => t.type === 'total')!.amount);

    it('advertises the capability in /.well-known/ucp', async () => {
      const profile = (await (await fetch(`${server.url}/.well-known/ucp`)).json()) as Json;
      assert.equal(profile.ucp.services['dev.ucp.lodging'][0].transport, 'rest');
      assert.equal(profile.ucp.services['dev.ucp.lodging'][0].endpoint, `${server.url}/ucp/v1`);
      assert.ok(profile.ucp.capabilities['dev.ucp.lodging.booking']);
      assert.deepEqual(profile.ucp.capabilities['dev.ucp.lodging.policy.cancellation'][0].extends, ['dev.ucp.lodging.booking']);
      assert.deepEqual(profile.ucp.payment_handlers, {});
      const spaarne = profile.properties.find((p: Json) => p.id === 'prop_spaarne');
      assert.ok(spaarne.rate_plans.some((r: Json) => r.id === 'non-refundable'));
      const card = (await (await fetch(`${server.url}/.well-known/agent-card.json`)).json()) as Json;
      assert.ok(card.additionalInterfaces.some((i: Json) => i.transport === 'UCP'));
      assert.equal(card.agentIdentity.webBotAuth.accepted, true);
    });

    it('needs the UCP-Agent header', async () => {
      const res = await ucp('POST', '/booking-sessions', { property: { id: 'prop_spaarne' }, stays: [] }, { 'ucp-agent': '' });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'missing_ucp_agent');
    });

    it('hotel with instant booking: incomplete → ready_for_complete → completed', async () => {
      const checkin = addDays(new Date().toISOString().slice(0, 10), 80);
      const stay = { id: 'stay_a', accommodation_type: { id: 'standaard' }, rate_plan: { id: 'non-refundable' }, occupancy: { adults: 2, total: 2 }, stay_dates: { start_date: checkin, end_date: addDays(checkin, 3) } };
      const created = await ucp('POST', '/booking-sessions', { property: { id: 'prop_spaarne' }, stays: [stay] }, platform.signed(`${server.url}/ucp/v1/booking-sessions`));
      assert.equal(created.status, 201);
      const s = created.body;
      assert.equal(s.status, 'incomplete');
      assert.equal(s.ucp.status, 'success');
      assert.equal(s.currency, 'EUR');
      assert.equal(s.stays[0].id, 'stay_a');
      assert.deepEqual(s.stays[0].occupancy, { adults: 2, total: 2 });
      assert.equal(s.stays[0].rate_plan.title, 'Niet-restitueerbaar');
      sumsToTotal(s.totals);
      sumsToTotal(s.stays[0].totals);
      assert.ok(Number.isInteger(s.totals.at(-1).amount) && s.totals.at(-1).amount > 10000, 'minor units');
      assert.equal(s.policies[0].type, 'dev.ucp.lodging.policy.cancellation');
      assert.equal(s.policies[0].refundability, 'non_refundable');
      assert.ok(s.messages.some((m: Json) => m.code === 'dev.ucp.lodging.policy.cancellation' && m.presentation === 'disclosure'));
      assert.ok(s.messages.some((m: Json) => m.code === 'lead_guest_required' && m.severity === 'recoverable'));
      // Payment terms: schedules add up to the total; nothing is charged through the platform.
      const term = s.payment.terms.find((t: Json) => t.id === s.payment.selected_term_id);
      assert.equal(term.schedules.reduce((n: number, x: Json) => n + x.amount, 0), s.totals.at(-1).amount);
      assert.ok(Date.parse(s.expires_at) > Date.now() + 10 * 60_000, 'the rooms are held while the buyer decides');
      assert.ok(s.continue_url);

      // The hold is real: the session's room is off the market for others.
      const before = (await tool('check_availability', { propertyId: 'prop_spaarne', checkin, checkout: addDays(checkin, 3) })).body.units.find((u: Json) => u.unitId === 'standaard').roomsLeft;

      const early = await ucp('POST', `/booking-sessions/${s.id}/complete`, { payment: {} });
      assert.equal(early.body.status, 'incomplete', 'no completion without a lead guest');

      const guests = [{ id: 'gst_01', first_name: 'Jane', last_name: 'Doe', email: 'jane.doe@example.com' }];
      const updated = await ucp('PUT', `/booking-sessions/${s.id}`, { property: { id: 'prop_spaarne' }, stays: [{ ...stay, guest_assignments: [{ guest_id: 'gst_01', role: 'primary' }] }], guests });
      assert.equal(updated.body.status, 'ready_for_complete');
      assert.equal(updated.body.guests[0].id, 'gst_01', 'platform guest ids are kept as they are');
      assert.deepEqual(updated.body.totals, s.totals);

      const noPayment = await ucp('POST', `/booking-sessions/${s.id}/complete`, {});
      assert.ok(noPayment.body.messages.some((m: Json) => m.code === 'payment_required'));
      const card = await ucp('POST', `/booking-sessions/${s.id}/complete`, { payment: { instruments: [{ id: 'pi', type: 'card' }] } });
      assert.ok(card.body.messages.some((m: Json) => m.code === 'payment_instrument_not_supported'));

      const done = await ucp('POST', `/booking-sessions/${s.id}/complete`, { payment: {} }, { 'idempotency-key': 'complete-1' });
      assert.equal(done.body.status, 'completed');
      assert.match(done.body.confirmation.id, /^req_/);
      assert.equal(done.body.continue_url, undefined);
      const replay = await ucp('POST', `/booking-sessions/${s.id}/complete`, { payment: {} }, { 'idempotency-key': 'complete-1' });
      assert.equal(replay.headers.get('idempotent-replayed'), 'true');
      assert.equal(replay.body.confirmation.id, done.body.confirmation.id);
      assert.equal((await ucp('POST', `/booking-sessions/${s.id}/complete`, { payment: {} })).body.confirmation.id, done.body.confirmation.id, 'a repeated Complete never books twice');

      const after = (await tool('check_availability', { propertyId: 'prop_spaarne', checkin, checkout: addDays(checkin, 3) })).body.units.find((u: Json) => u.unitId === 'standaard').roomsLeft;
      assert.equal(after, before, 'the hold became the booking: one room, not two');

      // Behind it is the same signed record as any INNLI booking.
      const record = (await tool('check_status', { statusToken: done.body['io.innli'].status_token })).body;
      assert.equal(record.booked, true);
      assert.equal(record.signedRecord.consent.termsHash.startsWith('sha256:'), true);
      assert.equal(record.guest?.name ?? 'Jane Doe', 'Jane Doe');

      const canceled = await ucp('POST', `/booking-sessions/${s.id}/cancel`, {});
      assert.equal(canceled.body.status, 'canceled');
      assert.ok(canceled.body.messages.some((m: Json) => m.code === 'cancellation_result'));
      assert.equal((await ucp('GET', `/booking-sessions/${s.id}`)).body.status, 'canceled');
    });

    it('B&B where the host decides: complete_in_progress until the host confirms', async () => {
      const { checkin, checkout } = window(300);
      const body = {
        property: { id: 'prop_duinzicht' },
        stays: [
          { accommodation_type: { id: 'kamer-1' }, occupancy: { adults: 2, total: 2 }, stay_dates: { start_date: checkin, end_date: checkout } },
          { accommodation_type: { id: 'kamer-2' }, occupancy: { adults: 2, children: 1, total: 3 }, stay_dates: { start_date: checkin, end_date: checkout } },
        ],
        booker: { first_name: 'John', last_name: 'Doe', email: 'john.doe@example.com' },
      };
      const sign = () => platform.signed(`${server.url}/ucp/v1/booking-sessions`);
      const s = (await ucp('POST', '/booking-sessions', body, sign())).body;
      assert.equal(s.status, 'ready_for_complete');
      assert.equal(s.stays.length, 2);
      sumsToTotal(s.totals);
      assert.ok(s.totals.some((t: Json) => t.type === 'tax'), 'tourist tax is its own line');
      assert.equal(s.totals.at(-1).amount, s.stays.reduce((n: number, x: Json) => n + x.totals.at(-1).amount, 0));
      assert.deepEqual(s.policies, []);
      assert.ok(s.messages.some((m: Json) => m.code === 'cancellation_terms_not_structured' && /14 dagen/.test(m.content)));

      const done = (await ucp('POST', `/booking-sessions/${s.id}/complete`, { payment: {} }, sign())).body;
      assert.equal(done.status, 'complete_in_progress');
      assert.equal(done.confirmation, undefined, 'not a booking yet, so no confirmation');
      assert.ok(done.messages.some((m: Json) => m.code === 'awaiting_host_confirmation'));
      const changed = (await ucp('PUT', `/booking-sessions/${s.id}`, body)).body;
      assert.ok(changed.messages.some((m: Json) => m.code === 'session_not_editable'));

      const pending = server.store.requestsFor('prop_duinzicht').find((r) => r.guest.email === 'john.doe@example.com')!;
      await fetch(`${server.url}/api/owner/requests/${pending.id}/accept`, { method: 'POST', headers: owner('prop_duinzicht'), body: '{}' });
      const confirmed = (await ucp('GET', `/booking-sessions/${s.id}`)).body;
      assert.equal(confirmed.status, 'completed');
      assert.ok(confirmed.confirmation.id);
      assert.deepEqual(confirmed.totals, s.totals, 'the confirmed price is the price the buyer saw');
    });

    it('a property with its own booking system hands the buyer over', async () => {
      const w = freeWindow(['hooiberg-tuinkamer'], 2, 30);
      const s = (await ucp('POST', '/booking-sessions', { property: { id: 'prop_hooiberg' }, stays: [{ accommodation_type: { id: 'tuinkamer' }, occupancy: { adults: 2 }, stay_dates: { start_date: w.checkin, end_date: w.checkout } }], booker: { first_name: 'A', last_name: 'B', email: 'a@example.com' } })).body;
      assert.equal(s.status, 'requires_escalation');
      assert.match(s.continue_url, /\/r\//);
      assert.ok(s.messages.some((m: Json) => m.severity === 'requires_buyer_input'));
      assert.equal((await ucp('POST', `/booking-sessions/${s.id}/complete`, { payment: {} })).body.status, 'requires_escalation');
    });

    it('business outcomes come as messages, protocol errors as HTTP status', async () => {
      const checkin = addDays(new Date().toISOString().slice(0, 10), 90);
      const dates = { start_date: checkin, end_date: addDays(checkin, 1) };
      const unknown = await ucp('POST', '/booking-sessions', { property: { id: 'prop_nope' }, stays: [{ accommodation_type: { id: 'x' }, occupancy: { adults: 2 }, stay_dates: dates }] });
      assert.equal(unknown.status, 200);
      assert.equal(unknown.body.ucp.status, 'error');
      assert.equal(unknown.body.messages[0].severity, 'unrecoverable');
      const tooMany = await ucp('POST', '/booking-sessions', { property: { id: 'prop_spaarne' }, stays: [{ accommodation_type: { id: 'standaard' }, occupancy: { adults: 9 }, stay_dates: dates }] });
      assert.equal(tooMany.body.messages[0].code, 'occupancy_exceeded_capacity');
      const badGuest = await ucp('POST', '/booking-sessions', { property: { id: 'prop_spaarne' }, stays: [{ accommodation_type: { id: 'standaard' }, occupancy: { adults: 2 }, stay_dates: dates, guest_assignments: [{ guest_id: 'ghost', role: 'primary' }] }] });
      assert.match(badGuest.body.messages[0].content, /ghost/);
      assert.equal((await ucp('GET', '/booking-sessions/bks_unknown')).status, 404);

      // An abandoned session releases its rooms when it is cancelled.
      const open = (await ucp('POST', '/booking-sessions', { property: { id: 'prop_spaarne' }, stays: [{ accommodation_type: { id: 'standaard' }, occupancy: { adults: 2 }, stay_dates: dates }, { accommodation_type: { id: 'standaard' }, occupancy: { adults: 1 }, stay_dates: dates }] })).body;
      assert.equal(open.stays.length, 2, 'two identical rooms in one session');
      sumsToTotal(open.totals);
      assert.equal(open.totals.at(-1).amount, open.stays[0].totals.at(-1).amount + open.stays[1].totals.at(-1).amount);
      const left = async () => (await tool('check_availability', { propertyId: 'prop_spaarne', checkin, checkout: addDays(checkin, 1) })).body.units.find((u: Json) => u.unitId === 'standaard').roomsLeft;
      const held = await left();
      assert.equal((await ucp('POST', `/booking-sessions/${open.id}/cancel`, {})).body.status, 'canceled');
      assert.equal(await left(), held + 2);
    });
  });
});
