import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import type { BookingRequest, WaitlistEntry } from '../src/domain/types.ts';
import { createProperty } from '../src/properties.ts';
import { Store } from '../src/store.ts';

describe('personal data really leaves the disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'innli-privacy-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const everythingOnDisk = () => readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');

  it('removes name, e-mail, phone, message, driver and waiting-list address from the files, not only from memory', () => {
    const store = new Store(join(dir, 'innli.json'));
    const { property } = createProperty({ name: 'Bewaar', address: { city: 'Ede', country: 'NL' } });
    store.saveProperty(property);
    const long = '2020-01-01';
    store.saveRequest({
      id: 'req_old', publicToken: 'tok_old', propertyId: property.id, unitId: 'u', checkin: long, checkout: '2020-01-04', nights: 3,
      guests: { adults: 2, children: 0, dogs: 0 }, breakfast: false, total: 300, currency: 'EUR',
      guest: { name: 'Vera Voorbeeld', email: 'vera.voorbeeld@example.com', phone: '+31600000001', message: 'Wij komen met de trein uit Zwolle' },
      driver: { age: 41, licenceCategory: 'B', licenceCountry: 'NL' },
      status: 'accepted', createdAt: '2019-12-01T10:00:00Z', decidedAt: '2019-12-02T10:00:00Z',
    } as unknown as BookingRequest);
    store.saveWaitlist({ id: 'w_old', publicToken: 'wt_old', propertyId: property.id, checkin: long, checkout: '2020-01-04', guests: { adults: 2, children: 0, dogs: 0 }, email: 'wachter@example.com', agentClient: 'Test', status: 'waiting', createdAt: '2019-12-01T10:00:00Z' } as WaitlistEntry);
    // Copies of the same guest elsewhere: the quote, a checkout session, a question, a cancellation reason.
    store.saveQuote({ id: 'q_old', propertyId: property.id, unitId: 'u', checkin: long, checkout: '2020-01-04', driver: { age: 41, licenceCategory: 'B' }, destinations: ['FR'], validUntil: '2020-01-01T00:00:00Z' } as never);
    store.saveCheckoutSession({ id: 'cs_old', propertyId: property.id, items: [], quoteIds: ['q_old'], buyer: { first_name: 'Vera', last_name: 'Voorbeeld', email: 'vera.voorbeeld@example.com', phone_number: '+31600000001' }, agentClient: 'Test', createdAt: new Date().toISOString(), expiresAt: new Date().toISOString(), statusToken: 'tok_old' } as never);
    store.saveQuestion({ id: 'qu_old', publicToken: 'qt_old', propertyId: property.id, question: 'Is er parkeerplek?', replyEmail: 'Vera.Voorbeeld@example.com', status: 'open', agentClient: 'Test', createdAt: new Date().toISOString() } as never);
    store.getRequest('req_old')!.cancelReason = 'Mijn moeder Greet is ziek geworden';
    store.saveRequest(store.getRequest('req_old')!);
    store.flush();
    assert.match(everythingOnDisk(), /vera\.voorbeeld@example\.com/);

    assert.equal(store.anonymiseRequests(180), 2);
    assert.equal(store.getQuestion('qu_old')!.replyEmail, undefined);
    store.flush();
    const disk = everythingOnDisk();
    for (const gone of ['Vera Voorbeeld', 'vera.voorbeeld@example.com', '+31600000001', 'trein uit Zwolle', 'wachter@example.com', '"licenceCategory"', 'Vera.Voorbeeld', '"first_name"', 'Greet', '"destinations":["FR"]']) {
      assert.ok(!disk.includes(gone), `still on disk: ${gone}`);
    }
    // What the owner needs for the books stays: the stay itself, without the person.
    const kept = new Store(join(dir, 'innli.json')).getRequest('req_old')!;
    assert.equal(kept.checkin, long);
    assert.ok(kept.anonymisedAt);
    assert.equal(new Store(join(dir, 'innli.json')).waitlistFor(property.id)[0].status, 'expired');
  });

  it('removes one guest at once when they ask, but not while the booking is still to come', async () => {
    const { startTestServer, ownerKey, freeWindow } = await import('./helpers.ts');
    const server = await startTestServer({ hotel: true });
    try {
      const auth = { 'content-type': 'application/json', authorization: `Bearer ${ownerKey(server, 'prop_spaarne')}` };
      const agent = { 'content-type': 'application/json', authorization: `Bearer ${server.creds.agentKey}` };
      const tool = async (name: string, args: unknown) => (await (await fetch(`${server.url}/api/agent/v1/tools/${name}`, { method: 'POST', headers: agent, body: JSON.stringify(args) })).json()) as Record<string, any>;
      const q = await tool('get_quote', { propertyId: 'prop_spaarne', unitId: 'standaard', ...freeWindow([], 2, 30), guests: { adults: 2 } });
      const sent = await tool('request_booking', { quoteId: q.quoteId, guest: { name: 'Noor Test', email: 'noor@example.com' }, guestConsent: true });
      assert.equal(sent.booked, true, JSON.stringify(sent));
      const erase = () => fetch(`${server.url}/api/owner/requests/${sent.requestId}/erase`, { method: 'POST', headers: auth, body: '{}' });
      assert.equal((await erase()).status, 409, 'a booking still to come');
      const req = server.store.getRequest(sent.requestId)!;
      server.store.saveRequest({ ...req, status: 'cancelled' });
      const done = await erase();
      assert.deepEqual(await done.json(), { erased: 1 });
      assert.equal(server.store.getRequest(sent.requestId)!.guest.email, '');
      assert.equal((await fetch(`${server.url}/api/owner/requests/nope/erase`, { method: 'POST', headers: auth, body: '{}' })).status, 404);
    } finally {
      await server.close();
    }
  });
});
