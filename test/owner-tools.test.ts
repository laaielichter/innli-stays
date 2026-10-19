import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { backupNow, listBackups } from '../src/backup.ts';
import { addDays } from '../src/domain/dates.ts';
import { Store } from '../src/store.ts';
import { ownerKey, startTestServer, type TestServer } from './helpers.ts';

type Json = Record<string, any>;

describe('1.1: owner tools: photos, booking calendar, export, figures, backups', () => {
  let server: TestServer;
  let client: Client;
  const dir = mkdtempSync(join(tmpdir(), 'innli-owner-'));
  const media = join(dir, 'media');
  const P = 'prop_spaarne';
  const today = new Date().toISOString().slice(0, 10);
  let headers: Record<string, string>;
  const api = (path: string, init: RequestInit = {}) => fetch(`${server.url}/api/owner${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  const call = async (name: string, args: Json): Promise<Json> => {
    const res = (await client.callTool({ name, arguments: args })) as Json;
    if (res.isError) throw new Error(res.content[0].text);
    return res.structuredContent;
  };

  before(async () => {
    server = await startTestServer({ hotel: true, mediaDir: media, backups: { dir: join(dir, 'backups'), run: () => ({ folder: 'x', files: 0, removed: 0 }) } });
    headers = { 'content-type': 'application/json', authorization: `Bearer ${ownerKey(server, P)}` };
    client = new Client({ name: 'agent', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${server.creds.agentKey}` } } }));
    // A confirmed booking via an agent, and one from the stay page.
    const q = await call('get_quote', { propertyId: P, unitId: 'standaard', checkin: addDays(today, 5), checkout: addDays(today, 7), guests: { adults: 2 } });
    await call('request_booking', { quoteId: q.quoteId, guest: { name: 'Anna, "Annie" Smit', email: 'anna@example.com' }, guestConsent: true });
    await fetch(`${server.url}/verblijf/het-spaarne/aanvraag`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ unitId: 'superior', checkin: addDays(today, 8), checkout: addDays(today, 9), adults: '2', name: '=HYPERLINK("x")', email: 'evil@example.com' }) });
  });
  after(async () => {
    await client.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('uploads a photo (checked on its bytes), serves it, and flags vague descriptions', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const up = await api('/photos', { method: 'POST', headers: { 'content-type': 'image/png' }, body: png });
    assert.equal(up.status, 201);
    const { url } = await up.json();
    assert.match(url, /\/media\/prop_spaarne\/[a-f0-9]{24}\.png$/);
    const got = await fetch(url);
    assert.equal(got.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await got.arrayBuffer()), png);
    const fake = await api('/photos', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: Buffer.from('<?php echo 1; ?>') });
    assert.equal(fake.status, 415, 'a script with an image header is refused');
    assert.equal((await fetch(`${server.url}/media/prop_spaarne/..%2F..%2Finnli.json`)).status, 404);

    const patch = await api('/property', { method: 'PATCH', body: JSON.stringify({ photos: [{ url, caption: 'IMG_2031' }, { url, caption: 'Ontbijtzaal met uitzicht op het Spaarne' }] }) });
    assert.equal(patch.status, 200, 'an uploaded photo may be used even on http while testing');
    const check = await (await api('/photos/check')).json();
    assert.deepEqual(check.problems.map((p: Json) => p.problem), ['filename']);
  });

  it('booking calendar (secret iCal), CSV export without formula injection, and monthly figures', async () => {
    const { url } = await (await api('/bookings/feed')).json();
    const ics = await (await fetch(url)).text();
    assert.match(ics, /BEGIN:VCALENDAR/);
    assert.match(ics, /SUMMARY:Anna\\, "Annie" Smit – Standaard tweepersoonskamer/);
    assert.match(ics, /STATUS:CONFIRMED/);
    assert.equal((await fetch(url.replace(/key=[^&]+/, 'key=wrong'))).status, 404);

    const raw = Buffer.from(await (await api('/export/requests.csv')).arrayBuffer());
    assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM, so Excel shows accents correctly');
    const csv = raw.toString('utf8').slice(1);
    assert.ok(csv.startsWith('reference;status;'));
    assert.match(csv, /"Anna, ""Annie"" Smit"/);
    assert.match(csv, /'=HYPERLINK/, 'a cell starting with = is neutralised');
    assert.ok(!/;=HYPERLINK/.test(csv));

    const stats = await (await api('/stats?months=3')).json();
    assert.equal(stats.months.length, 3);
    const thisMonth = stats.months.find((m: Json) => m.month === addDays(today, 5).slice(0, 7));
    assert.ok(thisMonth.nightsSold >= 2);
    assert.ok(thisMonth.occupancyPercent > 0);
    assert.ok(stats.totals.revenue.agent > 0);
    assert.equal(stats.totals.bookings.agent, 1);
  });

  it('daily backups to a second folder with retention, and restoring a downloaded backup', async () => {
    const data = mkdtempSync(join(tmpdir(), 'innli-data-'));
    const target = join(data, '..', `innli-backups-${Date.now()}`);
    try {
      const store = new Store(join(data, 'innli.json'));
      store.updateSettings({ license: 'x' });
      store.flush();
      writeFileSync(join(data, 'licentie-prive-sleutel.pem'), 'secret');
      for (let i = 0; i < 4; i++) backupNow(store, join(data, 'innli.json'), target, { keep: 2, now: new Date(Date.UTC(2026, 0, 1 + i)) });
      const days = listBackups(target);
      assert.deepEqual(days.map((d) => d.day), ['2026-01-04', '2026-01-03']);
      assert.ok(readdirSync(days[0].folder).includes('innli.json'));
      assert.ok(!readdirSync(days[0].folder).some((f) => f.endsWith('.pem')), 'never copies the licence key');
      assert.throws(() => backupNow(store, join(data, 'innli.json'), join(data, 'b')), /outside/);
    } finally {
      rmSync(data, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }

    const backup = await (await api('/backup')).json();
    const p = server.store.getProperty(P)!;
    p.name = 'Per ongeluk hernoemd';
    p.units = p.units.slice(0, 1);
    const restored = await (await api('/restore', { method: 'POST', body: JSON.stringify(backup) })).json();
    assert.ok(restored.restored.requests >= 2);
    assert.equal(server.store.getProperty(P)!.name, 'Hotel Het Spaarne');
    assert.equal(server.store.getProperty(P)!.units.length, 4);
    assert.equal((await api('/property')).status, 200, 'the owner key keeps working');
    const other = await api('/restore', { method: 'POST', body: JSON.stringify({ ...backup, property: { ...backup.property, id: 'prop_hooiberg' } }) });
    assert.equal(other.status, 409);
    assert.ok(existsSync(media));
  });
});
