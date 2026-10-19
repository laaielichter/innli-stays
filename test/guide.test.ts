import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createGuideApp } from '../src/directory/app.ts';
import { Guide } from '../src/directory/guide.ts';
import { ensureInstanceId, registerWithGuide } from '../src/directory/register.ts';
import { generateVendorKeys, issueLicense } from '../src/licensing/license.ts';
import { freeWindow, ownerKey, startTestServer, type TestServer } from './helpers.ts';

type Json = Record<string, any>;

const keys = generateVendorKeys();
process.env.INNLI_LICENSE_PUBLIC_KEY = keys.publicKeyBase64;
const license = (id: string, maxProperties: number) => issueLicense(keys.privateKeyPem, { id, name: 'Test', maxProperties, updatesUntil: '2099-01-01' });

async function startGuide(): Promise<{ url: string; server: Server }> {
  const guide = new Guide({ fetcher: fetch, requireHttps: false });
  const server = createServer(createGuideApp(guide));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

async function call(client: Client, name: string, args: Json): Promise<Json> {
  const res = (await client.callTool({ name, arguments: args })) as Json;
  if (res.isError) throw new Error(res.content[0].text);
  return res.structuredContent;
}

describe('INNLI guide for self-hosted installations', () => {
  let guide: { url: string; server: Server };
  let instance: TestServer;
  let client: Client;

  before(async () => {
    guide = await startGuide();
    instance = await startTestServer();
    client = new Client({ name: 'agent', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${guide.url}/mcp`), { requestInit: { headers: { 'x-agent-name': 'Reisagent X' } } }));
  });
  after(async () => {
    await client.close();
    await instance.close();
    await new Promise((r) => guide.server.close(r));
  });

  it('does not list a trial installation', async () => {
    const r = await registerWithGuide(instance.store, guide.url, instance.url);
    assert.equal(r.ok, false);
    assert.equal((await (await fetch(`${guide.url}/api/gids/stays`)).json()).length, 0);
  });

  it('lists a licensed installation, up to the licensed number of stays', async () => {
    instance.store.updateSettings({ license: license('lic_a', 2) });
    const r = await registerWithGuide(instance.store, guide.url, instance.url);
    assert.equal(r.ok, true, r.message);
    const stays = await (await fetch(`${guide.url}/api/gids/stays`)).json();
    assert.equal(stays.length, 2);
    assert.match(stays[0].id, /^ins_[a-f0-9]{12}:prop_/);
  });

  it('answers agents live through the installation, with routable ids', async () => {
    const { checkin, checkout } = freeWindow(['hooiberg-tuinkamer'], 2);
    const search = await call(client, 'search_stays', { area: 'Veluwe', checkin, checkout, guests: { adults: 2, dogs: 1 }, requirements: ['enclosed_garden'] });
    assert.equal(search.installationsAsked, 1);
    const hooiberg = search.results.find((r: Json) => r.name === 'B&B De Hooiberg');
    assert.match(hooiberg.propertyId, /^ins_.*:prop_hooiberg$/);
    assert.match(hooiberg.offer.quoteId, /^ins_.*:q_/);

    const details = await call(client, 'get_stay_details', { propertyId: hooiberg.propertyId });
    assert.equal(details.name, 'B&B De Hooiberg');

    const booking = await call(client, 'prepare_booking', { quoteId: hooiberg.offer.quoteId });
    assert.ok(booking.url.startsWith(`${instance.url}/r/`), 'guest goes straight to the installation');

    const analytics = await (await fetch(`${instance.url}/api/owner/analytics`, { headers: { authorization: `Bearer ${ownerKey(instance, 'prop_hooiberg')}` } })).json();
    assert.ok(analytics.byAgent['Reisagent X via INNLI-gids'].requests >= 1);
  });

  it('hides stays outside the licence', async () => {
    const search = await call(client, 'search_stays', { country: 'NL' });
    assert.ok(!search.results.some((r: Json) => r.name === 'Pension Duinzicht'), 'third stay is beyond maxProperties');
    const res = (await client.callTool({ name: 'get_stay_details', arguments: { propertyId: `${search.results[0].propertyId.split(':')[0]}:prop_duinzicht` } })) as Json;
    assert.equal(res.isError, true);
  });

  it('refuses the same licence on a second installation', async () => {
    const copy = await startTestServer();
    try {
      copy.store.updateSettings({ license: license('lic_a', 2) });
      const r = await registerWithGuide(copy.store, guide.url, copy.url);
      assert.equal(r.ok, false);
      assert.match(r.message, /al in gebruik/);
    } finally {
      await copy.close();
    }
  });

  it('rejects registrations for a URL the sender does not run', async () => {
    const res = await fetch(`${guide.url}/api/gids/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: 'ins_000000000000', instanceUrl: instance.url, license: license('lic_b', 1), version: '0', properties: [] }),
    });
    assert.equal(res.status, 422);
  });

  it('owner can activate a licence from the dashboard API', async () => {
    const headers = { authorization: `Bearer ${ownerKey(instance, 'prop_hooiberg')}`, 'content-type': 'application/json' };
    const bad = await fetch(`${instance.url}/api/owner/license`, { method: 'PUT', headers, body: JSON.stringify({ license: 'INNLI-bad.sig' }) });
    assert.equal(bad.status, 400);
    const good = await (await fetch(`${instance.url}/api/owner/license`, { method: 'PUT', headers, body: JSON.stringify({ license: license('lic_c', 1) }) })).json();
    assert.equal(good.state, 'licensed');
  });
});

describe('update period and the guide', () => {
  it('keeps listing buyers on a covered version after the guide itself is updated', async () => {
    const guide = await startGuide();
    const instance = await startTestServer();
    try {
      const expired = issueLicense(keys.privateKeyPem, { id: 'lic_old', name: 'Oud', maxProperties: 1, updatesUntil: '2026-12-31' });
      const register = (releaseDate: string) =>
        fetch(`${guide.url}/api/gids/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ instanceId: ensureInstanceId(instance.store), instanceUrl: instance.url, license: expired, version: '0.2.0', releaseDate, properties: [] }),
        });
      assert.equal((await register('2026-10-06')).status, 200, 'covered version');
      assert.equal((await register('2027-03-01')).status, 403, 'newer version than the update period');
    } finally {
      await instance.close();
      await new Promise((r) => guide.server.close(r));
    }
  });
});

describe('new agent tools through the guide', () => {
  it('routes compare_stays and request status across the guide', async () => {
    const guide = await startGuide();
    const instance = await startTestServer();
    const client = new Client({ name: 'agent', version: '1' });
    try {
      instance.store.updateSettings({ license: license('lic_tools', 5) });
      assert.equal((await registerWithGuide(instance.store, guide.url, instance.url)).ok, true);
      await client.connect(new StreamableHTTPClientTransport(new URL(`${guide.url}/mcp`)));
      const id = ensureInstanceId(instance.store);
      const cmp = await call(client, 'compare_stays', { propertyIds: [`${id}:prop_hooiberg`, `${id}:prop_duinzicht`], guests: { adults: 2 } });
      assert.deepEqual(cmp.rows.map((r: Json) => r.propertyId).sort(), [`${id}:prop_duinzicht`, `${id}:prop_hooiberg`]);

      const { checkin, checkout } = freeWindow(['duinzicht-1'], 2);
      const quote = await call(client, 'get_quote', { propertyId: `${id}:prop_duinzicht`, unitId: 'kamer-1', checkin, checkout });
      const req = await call(client, 'request_booking', { quoteId: quote.quoteId, guest: { name: 'Via Gids', email: 'gids@example.com' }, guestConsent: true });
      assert.match(req.statusToken, new RegExp(`^${id}:`));
      assert.equal((await call(client, 'check_status', { statusToken: req.statusToken })).status, 'new');
    } finally {
      await client.close();
      await instance.close();
      await new Promise((r) => guide.server.close(r));
    }
  });
});

describe('INNLI guide: room limit per licence', () => {
  it('a small-accommodation licence does not list a 48-room hotel; a hotel licence does', async () => {
    const guide = await startGuide();
    const instance = await startTestServer({ hotel: true });
    try {
      instance.store.updateSettings({ license: license('lic_small', 5) });
      const small = await registerWithGuide(instance.store, guide.url, instance.url);
      assert.equal(small.ok, true, small.message);
      assert.match(small.message, /Hotel Het Spaarne/);
      let stays = await (await fetch(`${guide.url}/api/gids/stays`)).json();
      assert.ok(!stays.some((s: Json) => s.name === 'Hotel Het Spaarne'));
      assert.ok(stays.some((s: Json) => s.name === 'B&B De Hooiberg'), 'small stays are listed');

      instance.store.updateSettings({ license: issueLicense(keys.privateKeyPem, { id: 'lic_small', name: 'Test', maxProperties: 5, maxRooms: 150, updatesUntil: '2099-01-01' }) });
      assert.equal((await registerWithGuide(instance.store, guide.url, instance.url)).ok, true);
      stays = await (await fetch(`${guide.url}/api/gids/stays`)).json();
      assert.ok(stays.some((s: Json) => s.name === 'Hotel Het Spaarne'));
    } finally {
      await instance.close();
      await new Promise((r) => guide.server.close(r));
    }
  });
});
