import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, verify, createPublicKey, type KeyObject } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { jwkThumbprint, parseDictionary, parseSignatureInput, signatureBase } from '../src/agent/botAuth.ts';
import { MAX_OPEN_HOLDS, MAX_QUOTE_HOLDS } from '../src/requests/agentActions.ts';
import { report, runConformance } from '../src/conformance.ts';
import { verifyRecord } from '../src/security/signing.ts';
import { addDays } from '../src/domain/dates.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createGuideApp } from '../src/directory/app.ts';
import { Guide } from '../src/directory/guide.ts';
import { registerWithGuide } from '../src/directory/register.ts';
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

      // Nor does it help to claim another host name: only this installation's public host counts.
      const claimed = await fetch(`${server.url}/api/agent/v1/tools/search_stays`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-host': 'other.example', ...platform.signed('https://other.example/api/agent/v1/tools/search_stays') }, body: '{"area":"Egmond"}' });
      assert.equal(claimed.headers.get('x-innli-agent-identity'), 'invalid; reason="bad_signature"');
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

    it('limits short quote holds per caller, also through UCP sessions', async () => {
      const fresh = await startTestServer({ hotel: true });
      try {
        const post = async (path: string, body: Json, headers: Record<string, string> = {}) => {
          const res = await fetch(`${fresh.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
          return { status: res.status, body: (await res.json()) as Json };
        };
        const checkin = addDays(new Date().toISOString().slice(0, 10), 45);
        const quote = { propertyId: 'prop_spaarne', unitId: 'standaard', checkin, checkout: addDays(checkin, 1), hold: true };
        for (let i = 0; i < MAX_QUOTE_HOLDS.anonymous; i++) assert.ok((await post('/api/agent/v1/tools/get_quote', quote)).body.holdUntil);
        const refused = await post('/api/agent/v1/tools/get_quote', quote);
        assert.equal(refused.status, 429);
        assert.equal(refused.body.code, 'LIMIT_REACHED');
        assert.ok(refused.body.retryAfterSeconds > 0);
        assert.ok((await post('/api/agent/v1/tools/get_quote', { ...quote, hold: false })).body.quoteId, 'quoting without a hold is never limited');
        const session = await post('/ucp/v1/booking-sessions', { property: { id: 'prop_spaarne' }, stays: [{ accommodation_type: { id: 'standaard' }, occupancy: { adults: 2 }, stay_dates: { start_date: checkin, end_date: addDays(checkin, 1) } }] }, { 'ucp-agent': 'profile="https://platform.example/profile"' });
        assert.equal(session.status, 429);
        assert.equal(session.body.code, 'hold_limit_reached');
        const key = { authorization: `Bearer ${fresh.creds.agentKey}` };
        assert.ok((await post('/api/agent/v1/tools/get_quote', quote, key)).body.holdUntil, 'an identified agent has its own, larger budget');
      } finally {
        await fresh.close();
      }
    });

    it('a change counts as a hold, and questions follow the identified-agents rule too', async () => {
      const fresh = await startTestServer({ hotel: true });
      try {
        const post = async (name: string, body: Json, headers: Record<string, string> = {}) => {
          const res = await fetch(`${fresh.url}/api/agent/v1/tools/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
          return { status: res.status, body: (await res.json()) as Json };
        };
        const day = (n: number) => addDays(new Date().toISOString().slice(0, 10), n);
        const tokens: string[] = [];
        for (let i = 0; i < MAX_OPEN_HOLDS.anonymous; i++) {
          const w = freeWindow(['duinzicht-1'], 2, 40 + i * 10);
          const q = (await post('get_quote', { propertyId: 'prop_duinzicht', unitId: 'kamer-1', ...w })).body;
          tokens.push((await post('request_booking', { quoteId: q.quoteId, guest: { name: 'Mo Di', email: `mo${i}@example.com` }, guestConsent: true })).body.statusToken);
        }
        // Changing one is fine (it replaces its own request) and records who holds the nights.
        const w = freeWindow(['duinzicht-1'], 2, 90);
        const changed = await post('modify_request', { statusToken: tokens[0], ...w, guestConsent: true });
        assert.equal(changed.status, 200, JSON.stringify(changed.body));
        assert.match(String(fresh.store.getRequestByToken(changed.body.statusToken)!.holder), /^h_/);
        // But the change is a hold of its own: no new request fits beside it.
        const w2 = freeWindow(['duinzicht-1'], 2, 120);
        const q = (await post('get_quote', { propertyId: 'prop_duinzicht', unitId: 'kamer-1', ...w2 })).body;
        assert.equal((await post('request_booking', { quoteId: q.quoteId, guest: { name: 'Mo Di', email: 'mo9@example.com' }, guestConsent: true })).body.code, 'LIMIT_REACHED');

        // Two anonymous callers never share an idempotency key.
        fresh.store.getProperty('prop_spaarne')!.bookingRules = { instantBooking: true, minLeadDays: 0, maxNights: 21, holdHours: 12, requireIdentifiedAgent: true };
        for (const name of ['ask_host', 'join_waitlist', 'modify_request']) {
          const args: Json = name === 'ask_host' ? { propertyId: 'prop_spaarne', question: 'Is there a lift to the rooms?' } : name === 'join_waitlist' ? { propertyId: 'prop_spaarne', checkin: day(30), checkout: day(31), email: 'w@example.com', guestConsent: true } : null as never;
          if (args) assert.equal((await post(name, args)).body.code, 'AGENT_IDENTITY_REQUIRED', name);
        }
        assert.equal((await post('ask_host', { propertyId: 'prop_spaarne', question: 'Is there a lift to the rooms?' }, { authorization: `Bearer ${fresh.creds.agentKey}` })).status, 200);
      } finally {
        await fresh.close();
      }
    });

    it('anonymous callers do not share idempotency keys', async () => {
      const fresh = await startTestServer({ hotel: true });
      try {
        const checkin = addDays(new Date().toISOString().slice(0, 10), 60);
        const book = async (ip: string, email: string) => {
          const headers = { 'content-type': 'application/json', 'x-forwarded-for': ip };
          const q = (await (await fetch(`${fresh.url}/api/agent/v1/tools/get_quote`, { method: 'POST', headers, body: JSON.stringify({ propertyId: 'prop_spaarne', unitId: 'standaard', checkin, checkout: addDays(checkin, 1) }) })).json()) as Json;
          return (await (await fetch(`${fresh.url}/api/agent/v1/tools/request_booking`, { method: 'POST', headers, body: JSON.stringify({ quoteId: q.quoteId, guest: { name: 'Guest One', email }, guestConsent: true, idempotencyKey: 'order-1' }) })).json()) as Json;
        };
        const a = await book('203.0.113.1', 'a@example.com');
        const b = await book('203.0.113.2', 'b@example.com');
        assert.notEqual(a.requestId, b.requestId, 'each caller gets their own booking');
        assert.equal((await book('203.0.113.1', 'a@example.com')).requestId, a.requestId, 'a retry by the same caller is the same booking');
      } finally {
        await fresh.close();
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
      assert.equal(server.store.requestsFor('prop_spaarne').find((r) => r.guest.email === 'retry@example.com')!.idempotencyKey!.endsWith(':key-1'), true, 'stored with the request (scoped to the caller), so it survives a restart');
    });
  });

  describe('UCP lodging booking sessions', () => {
    const ucp = async (method: string, path: string, body?: Json, headers: Record<string, string> = {}) => {
      const res = await fetch(`${server.url}/ucp/v1${path}`, { method, headers: { 'content-type': 'application/json', 'ucp-agent': 'profile="https://platform.example/profile"', authorization: `Bearer ${server.creds.agentKey}`, ...headers }, body: body ? JSON.stringify(body) : undefined });
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
      for (const bad of [{ property: { id: 'prop_spaarne' }, stays: [null] }, { property: null, stays: 'x' }, []]) assert.equal((await ucp('POST', '/booking-sessions', bad as Json)).body.ucp.status, 'error', 'malformed input is an outcome, not a crash');
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'missing_ucp_agent');
    });

    it('hotel with instant booking: incomplete → ready_for_complete → completed', async () => {
      const checkin = addDays(new Date().toISOString().slice(0, 10), 80);
      const stay = { id: 'stay_a', accommodation_type: { id: 'standaard' }, rate_plan: { id: 'non-refundable' }, occupancy: { adults: 2, total: 2 }, stay_dates: { start_date: checkin, end_date: addDays(checkin, 3) } };
      const created = await ucp('POST', '/booking-sessions', { property: { id: 'prop_spaarne' }, stays: [stay] });
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
      const s = (await ucp('POST', '/booking-sessions', body)).body;
      assert.equal(s.status, 'ready_for_complete');
      assert.equal(s.stays.length, 2);
      sumsToTotal(s.totals);
      assert.ok(s.totals.some((t: Json) => t.type === 'tax'), 'tourist tax is its own line');
      assert.equal(s.totals.at(-1).amount, s.stays.reduce((n: number, x: Json) => n + x.totals.at(-1).amount, 0));
      assert.deepEqual(s.policies, []);
      assert.ok(s.messages.some((m: Json) => m.code === 'cancellation_terms_not_structured' && /14 dagen/.test(m.content)));

      const done = (await ucp('POST', `/booking-sessions/${s.id}/complete`, { payment: {} })).body;
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

    it('the same operations over MCP (/ucp/mcp)', async () => {
      const profile = (await (await fetch(`${server.url}/.well-known/ucp`)).json()) as Json;
      const service = profile.ucp.services['dev.ucp.lodging'].find((x: Json) => x.transport === 'mcp');
      assert.equal(service.endpoint, `${server.url}/ucp/mcp`);
      const client = new Client({ name: 'platform', version: '1' });
      await client.connect(new StreamableHTTPClientTransport(new URL(service.endpoint), { requestInit: { headers: { authorization: `Bearer ${server.creds.agentKey}` } } }));
      const mcp = async (name: string, args: Json) => (await client.callTool({ name, arguments: { meta: { 'ucp-agent': { profile: 'https://platform.example/profile' } }, ...args } })) as Json;
      try {
        assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), ['cancel_booking_session', 'complete_booking_session', 'create_booking_session', 'get_booking_session', 'update_booking_session']);
        const checkin = addDays(new Date().toISOString().slice(0, 10), 110);
        const booking = { property: { id: 'prop_spaarne' }, stays: [{ accommodation_type: { id: 'standaard' }, occupancy: { adults: 2 }, stay_dates: { start_date: checkin, end_date: addDays(checkin, 2) } }] };
        const meta = { 'ucp-agent': { profile: 'https://platform.example/profile' }, 'idempotency-key': 'create-1' };
        const created = (await mcp('create_booking_session', { meta, booking })).structuredContent;
        assert.equal(created.status, 'incomplete');
        assert.match(created.id, /^bks_/);
        assert.equal((await mcp('create_booking_session', { meta, booking })).structuredContent.id, created.id, 'a retried create is the same session');
        const ready = (await mcp('update_booking_session', { id: created.id, booking: { ...booking, booker: { first_name: 'Ada', last_name: 'Byron', email: 'ada@example.com' } } })).structuredContent;
        assert.equal(ready.status, 'ready_for_complete');
        const done = (await mcp('complete_booking_session', { id: created.id, booking: { payment: {} } })).structuredContent;
        assert.equal(done.status, 'completed');
        assert.equal((await mcp('get_booking_session', { id: created.id })).structuredContent.confirmation.id, done.confirmation.id);
        assert.equal((await mcp('cancel_booking_session', { id: created.id })).structuredContent.status, 'canceled');

        const soldOut = await mcp('create_booking_session', { booking: { ...booking, property: { id: 'prop_nope' } } });
        assert.equal(soldOut.isError, undefined, 'a business outcome is a result, not a tool error');
        assert.equal(soldOut.structuredContent.ucp.status, 'error');
        const unknown = await mcp('get_booking_session', { id: 'bks_nope' });
        assert.equal(unknown.isError, true);
        assert.equal(unknown.structuredContent.code, 'not_found');
      } finally {
        await client.close();
      }
    });

    it('a session belongs to its caller; a failed update leaves it untouched; mixed rate plans are judged per room', async () => {
      const checkin = addDays(new Date().toISOString().slice(0, 10), 130);
      const dates = { start_date: checkin, end_date: addDays(checkin, 2) };
      const stays = [
        { id: 'a', accommodation_type: { id: 'standaard' }, occupancy: { adults: 2 }, stay_dates: dates },
        { id: 'b', accommodation_type: { id: 'standaard' }, occupancy: { adults: 2 }, stay_dates: dates },
        { id: 'c', accommodation_type: { id: 'standaard' }, occupancy: { adults: 1 }, stay_dates: dates },
      ];
      const s = (await ucp('POST', '/booking-sessions', { property: { id: 'prop_spaarne' }, stays, booker: { first_name: 'Eva', last_name: 'Smit', email: 'eva@example.com' } })).body;
      assert.equal(s.status, 'ready_for_complete');
      // Every stay adds up on its own, and the stays add up to the session, line by line.
      for (const stay of s.stays) sumsToTotal(stay.totals);
      for (const t of s.totals) assert.equal(s.stays.reduce((n: number, x: Json) => n + x.totals.filter((y: Json) => y.type === t.type && y.display_text === t.display_text).reduce((m: number, y: Json) => m + y.amount, 0), 0), t.amount, t.type);

      // Someone else, even with the id, does not see it.
      assert.equal((await ucp('GET', `/booking-sessions/${s.id}`, undefined, { authorization: '' })).status, 404);
      assert.equal((await ucp('POST', `/booking-sessions/${s.id}/cancel`, {}, { authorization: '' })).status, 404);

      // An update that cannot be priced changes nothing.
      const failed = await ucp('PUT', `/booking-sessions/${s.id}`, { property: { id: 'prop_spaarne' }, stays: [{ ...stays[0], rate_plan: { id: 'does-not-exist' } }] });
      assert.equal(failed.body.messages[0].code, 'rate_plan_not_found');
      const still = (await ucp('GET', `/booking-sessions/${s.id}`)).body;
      assert.equal(still.status, 'ready_for_complete');
      assert.deepEqual(still.totals, s.totals);
      assert.equal(still.stays.length, 3);
      assert.ok(Date.parse(still.expires_at) > Date.now(), 'the rooms are still held');
      await ucp('POST', `/booking-sessions/${s.id}/cancel`, {});

      // One refundable room and one non-refundable room: not "refundable", and the buyer is told which.
      const units = server.store.getProperty('prop_spaarne')!.units.map((u) => u.id);
      const other = units.find((u) => u !== 'standaard')!;
      const mixed = (await ucp('POST', '/booking-sessions', { property: { id: 'prop_spaarne' }, stays: [
        { accommodation_type: { id: 'standaard' }, occupancy: { adults: 2 }, stay_dates: dates },
        { accommodation_type: { id: other }, rate_plan: { id: 'non-refundable' }, occupancy: { adults: 2 }, stay_dates: dates },
      ] })).body;
      assert.notEqual(mixed.policies[0]?.refundability, 'refundable');
      assert.ok(mixed.messages.some((m: Json) => m.code === 'dev.ucp.lodging.policy.cancellation' && /Non-refundable: /.test(m.content)));
      await ucp('POST', `/booking-sessions/${mixed.id}/cancel`, {});
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

  describe('identity through the INNLI guide', () => {
    let guideServer: Server;
    let guideUrl: string;
    let instance: TestServer;
    const mcp = async (headers: Record<string, string>) => {
      const client = new Client({ name: 'agent', version: '1' });
      // Sign every request afresh, as a platform would.
      const signing: typeof fetch = (input, init) => fetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), ...(headers.sign ? platform.signed(`${guideUrl}/mcp`) : headers) } });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${guideUrl}/mcp`), { fetch: signing }));
      return client;
    };
    const call = async (client: Client, name: string, args: Json) => ((await client.callTool({ name, arguments: args })) as Json).structuredContent as Json;

    before(async () => {
      const guide = new Guide({ fetcher: fetch, requireHttps: false, requireLicense: false });
      guideServer = createServer(createGuideApp(guide, { insecureAgentDirectories: true }));
      await new Promise<void>((r) => guideServer.listen(0, '127.0.0.1', r));
      guideUrl = `http://127.0.0.1:${(guideServer.address() as AddressInfo).port}`;
      instance = await startTestServer({ hotel: true, guideUrl });
      assert.equal((await registerWithGuide(instance.store, guideUrl, instance.url)).ok, true);
    });
    after(async () => {
      await instance.close();
      await new Promise((r) => guideServer.close(r));
    });

    it('the guide signs what it relays, and a verified platform stays verified at the installation', async () => {
      const keys = (await (await fetch(`${guideUrl}/.well-known/http-message-signatures-directory`)).json()) as Json;
      assert.equal(keys.keys[0].crv, 'Ed25519');
      const client = await mcp({ sign: '1' });
      try {
        const today = new Date().toISOString().slice(0, 10);
        const found = await call(client, 'search_stays', { area: 'Haarlem', checkin: addDays(today, 30), checkout: addDays(today, 31) });
        const offer = found.results[0].offer;
        const booked = await call(client, 'request_booking', { quoteId: offer.quoteId, guest, guestConsent: true });
        assert.equal(booked.booked, true);
        assert.equal(booked.signedRecord.consent.agentIdentity, 'verified');
        assert.equal(booked.signedRecord.consent.agentDomain, platform.host);
        assert.match(booked.signedRecord.consent.agentClient, /via INNLI-gids$/);
      } finally {
        await client.close();
      }
    });

    it('an anonymous agent through the guide stays anonymous, counted per caller', async () => {
      const client = await mcp({ 'x-agent-name': 'Reisbot' });
      try {
        const today = new Date().toISOString().slice(0, 10);
        const found = await call(client, 'search_stays', { area: 'Haarlem', checkin: addDays(today, 33), checkout: addDays(today, 34) });
        const booked = await call(client, 'request_booking', { quoteId: found.results[0].offer.quoteId, guest, guestConsent: true });
        assert.equal(booked.signedRecord.consent.agentIdentity, 'anonymous');
        assert.equal(booked.signedRecord.consent.agentClient, 'Reisbot via INNLI-gids');
        const stored = instance.store.getRequest(booked.requestId)!;
        assert.match(String(stored.holder), /^h_/);
      } finally {
        await client.close();
      }
    });

    it('relay headers count only when the guide signed them', async () => {
      const direct = (headers: Record<string, string>) => fetch(`${instance.url}/api/agent/v1/tools/search_stays`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{"area":"Haarlem"}' });
      const spoof = { 'x-innli-agent': 'Trusted', 'x-innli-relay-identity': 'bigplatform.example', 'x-innli-relay-holder': 'abc' };
      assert.equal((await direct(spoof)).headers.get('x-innli-agent-identity'), 'anonymous');
      // Another signer than the guide is itself, whatever it claims to relay.
      const own = await direct({ ...spoof, ...platform.signed(`${instance.url}/api/agent/v1/tools/search_stays`) });
      assert.equal(own.headers.get('x-innli-agent-identity'), `verified; agent="${platform.host}"`);
    });
  });

  describe('conformance check', () => {
    it('an installation passes every check, and a plain web server does not', async () => {
      const fresh = await startTestServer({ hotel: true });
      try {
        const checks = await runConformance(fresh.url);
        assert.deepEqual(checks.filter((c) => !c.ok), [], report(checks));
        assert.ok(checks.length >= 12);
        assert.match(report(checks), /All \d+ checks passed/);
        assert.equal(fresh.store.requestsFor('prop_spaarne').length, 0, 'the check never books');
      } finally {
        await fresh.close();
      }
      const failing = await runConformance(platform.origin);
      assert.ok(failing.filter((c) => !c.ok).length >= 8);
    });
  });
});

