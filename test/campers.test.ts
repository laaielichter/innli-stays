import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addDays } from '../src/domain/dates.ts';
import { completeness, FACT_CATALOG, factApplies } from '../src/domain/facts.ts';
import { ownerKey, startTestServer, type TestServer } from './helpers.ts';

type Json = Record<string, any>;

describe('camper rental', () => {
  let server: TestServer;
  let day = 40;
  /** Each test rents on its own dates, so holds never get in each other's way. */
  const dates = (nights = 5) => {
    const checkin = addDays(new Date().toISOString().slice(0, 10), day);
    day += nights + 2;
    return { checkin, checkout: addDays(checkin, nights) };
  };
  const tool = async (name: string, args: Json) => {
    const res = await fetch(`${server.url}/api/agent/v1/tools/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${server.creds.agentKey}` }, body: JSON.stringify(args) });
    return { status: res.status, body: (await res.json()) as Json };
  };
  const camper = { propertyId: 'prop_veluwecampers' };
  const guest = { name: 'Sanne de Vries', email: 'sanne@example.com' };
  const goodDriver = { age: 34, licenceCategory: 'B', licenceYears: 12 };

  before(async () => {
    server = await startTestServer({ campers: true });
  });
  after(() => server.close());

  it('keeps campers out of a search for a place to stay, and stays out of a camper search', async () => {
    const stays = await tool('search_stays', { country: 'NL', limit: 10 });
    assert.ok(stays.body.results.length > 0);
    assert.ok(stays.body.results.every((r: Json) => r.propertyId !== 'prop_veluwecampers'));
    const campers = await tool('search_stays', { kind: 'camper', country: 'NL', limit: 10 });
    assert.deepEqual(campers.body.results.map((r: Json) => r.propertyId), ['prop_veluwecampers']);
  });

  it('finds the vehicle a guest can drive: automatic, car licence, toilet on board', async () => {
    const res = await tool('search_stays', { kind: 'camper', ...dates(), guests: { adults: 2 }, requirements: ['automatic_transmission', 'car_licence_ok', 'toilet_on_board'] });
    assert.equal(res.status, 200);
    const text = JSON.stringify(res.body.results);
    assert.match(text, /buscamper/);
    assert.doesNotMatch(text, /"unitId":"(gezinscamper|grote-camper)"/);
  });

  it('puts the rental terms in the quote and says the deposit is not part of the total', async () => {
    const res = await tool('get_quote', { ...camper, unitId: 'gezinscamper', ...dates(5), guests: { adults: 2, children: 2 }, driver: goodDriver });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const r = res.body.rental;
    assert.deepEqual(r.kilometres, { unlimited: false, includedPerDay: 150, includedForThisRental: 750, pricePerExtraKm: 0.3 });
    assert.equal(r.securityDeposit, 1000);
    assert.deepEqual(r.insurance, { included: true, deductiblePerClaim: 1000 });
    assert.equal(r.driver.eligible, true);
    assert.deepEqual(r.unknown, []);
    // No tourist tax line, and the price is complete without one.
    assert.equal(res.body.totalIncludesAllMandatoryCosts, true);
    assert.ok(!res.body.lines.some((l: Json) => l.kind === 'tax'));
    assert.ok(Math.abs(res.body.lines.reduce((s: number, l: Json) => s + l.amount, 0) - res.body.total) < 0.01);
    assert.match(res.body.consent.summary, /750 km included/);
    assert.match(res.body.consent.summary, /deposit of .*1[.,]?000/);
  });

  it('says what to ask when the driver is not known yet', async () => {
    const res = await tool('get_quote', { ...camper, unitId: 'buscamper', ...dates(), guests: { adults: 2 } });
    assert.equal(res.body.rental.driver.eligible, null);
    assert.match(res.body.rental.driver.needs.join(' '), /driver/);
  });

  it('refuses a driver who is too young, and one without the right licence', async () => {
    const young = await tool('get_quote', { ...camper, unitId: 'buscamper', ...dates(), guests: { adults: 2 }, driver: { age: 21, licenceCategory: 'B', licenceYears: 3 } });
    assert.equal(young.body.rental.driver.eligible, false);
    assert.match(young.body.rental.driver.reasons[0], /at least 23/);
    const sent = await tool('request_booking', { quoteId: young.body.quoteId, guest, guestConsent: true });
    assert.equal(sent.status, 400, JSON.stringify(sent.body));
    assert.equal(sent.body.code, 'DRIVER_NOT_ELIGIBLE');

    const big = await tool('get_quote', { ...camper, unitId: 'grote-camper', ...dates(), guests: { adults: 4 }, driver: goodDriver });
    assert.equal(big.body.rental.driver.eligible, false);
    assert.match(big.body.rental.driver.reasons[0], /C1/);
    const c1 = await tool('get_quote', { ...camper, unitId: 'grote-camper', ...dates(), guests: { adults: 4 }, driver: { age: 40, licenceCategory: 'C', licenceYears: 10 } });
    assert.equal(c1.body.rental.driver.eligible, true);
  });

  it('will not send a request without a driver', async () => {
    const q = await tool('get_quote', { ...camper, unitId: 'buscamper', ...dates(), guests: { adults: 2 } });
    const sent = await tool('request_booking', { quoteId: q.body.quoteId, guest, guestConsent: true });
    assert.equal(sent.status, 400);
    assert.equal(sent.body.code, 'INVALID_INPUT');
    assert.match(sent.body.error ?? sent.body.message, /driver/);
  });

  it('sends the request with the driver, and the company sees who drives', async () => {
    const q = await tool('get_quote', { ...camper, unitId: 'buscamper', ...dates(), guests: { adults: 2 }, driver: goodDriver });
    const sent = await tool('request_booking', { quoteId: q.body.quoteId, guest, guestConsent: true, consentHash: q.body.consent.hash });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const stored = server.store.getRequest(sent.body.requestId)!;
    assert.deepEqual(stored.driver, goodDriver);
    // Retention removes the driver with the rest of the guest's personal data.
    server.store.anonymiseRequests(0, new Date(Date.now() + 400 * 86_400_000));
    assert.equal(server.store.getRequest(sent.body.requestId)!.driver, undefined);
  });

  it('asks again when the company changes the deposit after the guest agreed', async () => {
    const q = await tool('get_quote', { ...camper, unitId: 'buscamper', ...dates(), guests: { adults: 2 }, driver: goodDriver });
    const key = ownerKey(server, 'prop_veluwecampers');
    const put = await fetch(`${server.url}/api/owner/facts/rental.securityDeposit`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ value: 1500 }) });
    assert.equal(put.status, 200, await put.text());
    const sent = await tool('request_booking', { quoteId: q.body.quoteId, guest, guestConsent: true, consentHash: q.body.consent.hash });
    assert.equal(sent.body.code, 'TERMS_CHANGED');
    assert.match(sent.body.error ?? sent.body.message, /1[.,]?500/);
  });

  it('gives a rental company its own passport questions', async () => {
    const all = (await (await fetch(`${server.url}/api/fact-catalog`)).json()) as Json[];
    const forCampers = (await (await fetch(`${server.url}/api/fact-catalog?type=camper_rental`)).json()) as Json[];
    const forBnb = (await (await fetch(`${server.url}/api/fact-catalog?type=bnb`)).json()) as Json[];
    assert.equal(all.length, FACT_CATALOG.length);
    assert.ok(forCampers.some((f) => f.key === 'rental.securityDeposit'));
    assert.ok(!forCampers.some((f) => f.key === 'breakfast.included' || f.key === 'fees.touristTaxPerPersonPerNight'));
    assert.ok(!forBnb.some((f) => f.key.startsWith('rental.') || f.key.startsWith('vehicle.')));
    assert.ok(forBnb.every((f) => factApplies(FACT_CATALOG.find((d) => d.key === f.key)!, 'bnb')));
    // The sample company answered everything that matters for a rental.
    const p = server.store.getProperty('prop_veluwecampers')!;
    assert.deepEqual(completeness(p, new Date(), 'en').unknownCritical, []);
  });
});

describe('starter packs', () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer({ empty: true, setupCode: 'ABC123' });
  });
  after(() => server.close());
  const base = { code: 'ABC123', name: 'Camper van Daan', city: 'Zwolle', country: 'NL', language: 'nl', room: { name: '-', maxGuests: 2, baseRatePerNight: 89 } };

  it('lists the packs, and refuses one that does not exist', async () => {
    const packs = (await (await fetch(`${server.url}/api/starter-packs`)).json()) as Json[];
    assert.ok(packs.some((p) => p.id === 'camper-one-van' && p.type === 'camper_rental'));
    const bad = await fetch(`${server.url}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...base, starter: 'nope' }) });
    assert.equal(bad.status, 400);
  });

  it('sets up a one-camper company with suggestions the owner still has to confirm', async () => {
    const res = await fetch(`${server.url}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...base, starter: 'camper-one-van' }) });
    assert.equal(res.status, 201, await res.clone().text());
    const { ownerKey: key, propertyId, starter } = (await res.json()) as Json;
    assert.equal(starter.unitsAdded, 1);
    const p = server.store.getProperty(propertyId)!;
    assert.equal(p.type, 'camper_rental');
    assert.equal(p.published, false);
    assert.equal(p.units[0].baseRatePerNight, 89);
    // Suggested, never confirmed; and no price or deposit is made up.
    assert.deepEqual({ value: p.facts['rental.minDriverAge'].value, status: p.facts['rental.minDriverAge'].status, source: p.facts['rental.minDriverAge'].source }, { value: 23, status: 'unconfirmed', source: 'starter' });
    assert.equal(p.units[0].facts['vehicle.licenceCategory'].status, 'unconfirmed');
    assert.equal(p.facts['rental.securityDeposit'], undefined);
    assert.ok(Object.values(p.facts).every((f) => f.status !== 'confirmed'));

    // What the owner confirmed stays when the pack is applied again.
    const auth = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
    const put = await fetch(`${server.url}/api/owner/facts/rental.minDriverAge`, { method: 'PUT', headers: auth, body: JSON.stringify({ value: 25 }) });
    assert.equal(put.status, 200);
    const again = await fetch(`${server.url}/api/owner/starter-pack`, { method: 'POST', headers: auth, body: JSON.stringify({ id: 'camper-one-van' }) });
    assert.equal(again.status, 200, await again.clone().text());
    const after = server.store.getProperty(propertyId)!;
    assert.deepEqual([after.facts['rental.minDriverAge'].value, after.facts['rental.minDriverAge'].status], [25, 'confirmed']);
    assert.equal(after.units.length, 1);
    // A pack for another kind of property is refused.
    const wrong = await fetch(`${server.url}/api/owner/starter-pack`, { method: 'POST', headers: auth, body: JSON.stringify({ id: 'bnb-two-rooms' }) });
    assert.equal(wrong.status, 400);
  });
});
