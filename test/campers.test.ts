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
    assert.equal(r.insurance.included, true);
    assert.equal(r.insurance.liabilityIncluded, true);
    assert.equal(r.insurance.deductiblePerClaim, 1000);
    assert.equal(r.insurance.chosen, null);
    assert.deepEqual(r.insurance.options.map((o: Json) => [o.id, o.deductiblePerClaim, o.securityDeposit]), [['verzekering-plus', 500, 1000], ['verzekering-top', 250, 500]]);
    assert.equal(r.depositByCreditCardOnly, true);
    assert.equal(r.jurisdiction.country, 'NL');
    assert.match(r.jurisdiction.carLicence, /3,500 kg/);
    assert.match(r.jurisdiction.disclaimer, /not legal advice/);
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
  it('lowers the deductible and the deposit when the guest takes an insurance package', async () => {
    const d = dates(5);
    const base = await tool('get_quote', { ...camper, unitId: 'buscamper', ...d, guests: { adults: 2 }, driver: goodDriver });
    const top = await tool('get_quote', { ...camper, unitId: 'buscamper', ...d, guests: { adults: 2 }, driver: goodDriver, extras: [{ id: 'verzekering-top' }] });
    assert.equal(top.status, 200, JSON.stringify(top.body));
    assert.equal(top.body.rental.insurance.chosen, 'verzekering-top');
    assert.equal(top.body.rental.insurance.deductiblePerClaim, 250);
    assert.equal(top.body.rental.securityDeposit, 500);
    assert.ok(Math.abs(top.body.total - base.body.total - 5 * 22) < 0.01);
    assert.match(top.body.consent.summary, /insurance "Verzekering Top" with a deductible of .*250/);
    assert.match(top.body.consent.summary, /credit card in the driver's name/);
    assert.notEqual(top.body.consent.hash, base.body.consent.hash);
    const both = await tool('get_quote', { ...camper, unitId: 'buscamper', ...d, guests: { adults: 2 }, extras: [{ id: 'verzekering-top' }, { id: 'verzekering-plus' }] });
    assert.equal(both.status, 400);
  });

  it('checks where the guest wants to drive against what the company and its insurance allow', async () => {
    const d = dates();
    const ok = await tool('get_quote', { ...camper, unitId: 'buscamper', ...d, guests: { adults: 2 }, driver: goodDriver, destinations: ['fr', 'BE'] });
    assert.deepEqual(ok.body.rental.trip, { ok: true, reasons: [], needs: [], destinations: ['FR', 'BE'] });
    const no = await tool('get_quote', { ...camper, unitId: 'buscamper', ...dates(), guests: { adults: 2 }, driver: goodDriver, destinations: ['FR', 'GB'] });
    assert.equal(no.body.rental.trip.ok, false);
    assert.match(no.body.rental.trip.reasons.join(' '), /may not be driven in GB/);
    assert.match(no.body.rental.trip.reasons.join(' '), /insurance is not valid in GB/);
    const sent = await tool('request_booking', { quoteId: no.body.quoteId, guest, guestConsent: true });
    assert.equal(sent.status, 400);
    assert.equal(sent.body.code, 'RENTAL_NOT_POSSIBLE');
  });

  it('treats a licence from outside Europe by the rules of the company', async () => {
    const q = (driver: Json) => tool('get_quote', { ...camper, unitId: 'buscamper', ...dates(), guests: { adults: 2 }, driver: { age: 40, licenceCategory: 'B', licenceYears: 10, ...driver } });
    // A German licence is not foreign for a Dutch company.
    assert.equal((await q({ licenceCountry: 'DE' })).body.rental.driver.eligible, true);
    const us = await q({ licenceCountry: 'US', licenceCategory: 'regular' });
    assert.equal(us.body.rental.driver.eligible, null);
    assert.match(us.body.rental.driver.needs.join(' '), /international driving permit/);
    assert.equal((await q({ licenceCountry: 'US', licenceCategory: 'regular', hasInternationalPermit: true })).body.rental.driver.eligible, true);
    const without = await q({ licenceCountry: 'US', licenceCategory: 'regular', hasInternationalPermit: false });
    assert.equal(without.body.rental.driver.eligible, false);
    assert.equal((await q({ age: 80 })).body.rental.driver.eligible, false);
  });

  it('does not rent out a vehicle whose inspection runs out before it is back', async () => {
    const key = ownerKey(server, 'prop_veluwecampers');
    const auth = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
    const d = dates();
    const set = (value: string) => fetch(`${server.url}/api/owner/facts/vehicle.inspectionValidUntil`, { method: 'PUT', headers: auth, body: JSON.stringify({ value, unitId: 'gezinscamper' }) });
    assert.equal((await set(addDays(d.checkin, 1))).status, 200);
    const q = await tool('get_quote', { ...camper, unitId: 'gezinscamper', ...d, guests: { adults: 2 }, driver: goodDriver });
    assert.match(q.body.rental.vehicle.notRentable[0], /inspection/);
    const sent = await tool('request_booking', { quoteId: q.body.quoteId, guest, guestConsent: true });
    assert.equal(sent.body.code, 'RENTAL_NOT_POSSIBLE');
    await set('2099-12-31');
  });

  it('tells the owner what must be in order, and keeps the company hidden until it is', async () => {
    const key = ownerKey(server, 'prop_veluwecampers');
    const auth = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
    const ready = (await (await fetch(`${server.url}/api/owner/rental-readiness`, { headers: auth })).json()) as Json;
    assert.equal(ready.ready, true, JSON.stringify(ready.items.filter((i: Json) => i.state !== 'done')));
    assert.match(ready.disclaimer, /geen juridisch advies/);

    // Hide the company, withdraw the statement about rental cover, and try to show it again.
    const patch = (body: Json) => fetch(`${server.url}/api/owner/property`, { method: 'PATCH', headers: auth, body: JSON.stringify(body) });
    assert.equal((await patch({ published: false })).status, 200);
    await fetch(`${server.url}/api/owner/facts/rental.rentalUseInsured`, { method: 'PUT', headers: auth, body: JSON.stringify({ value: false }) });
    const refused = await patch({ published: true });
    assert.equal(refused.status, 400);
    const body = (await refused.json()) as Json;
    assert.match(body.error, /insurer covers renting out|verzekeraar dekt verhuur/);
    assert.equal(body.rentalReadiness.items.find((i: Json) => i.key === 'rental.rentalUseInsured').state, 'problem');
    await fetch(`${server.url}/api/owner/facts/rental.rentalUseInsured`, { method: 'PUT', headers: auth, body: JSON.stringify({ value: true }) });
    assert.equal((await patch({ published: true })).status, 200);

    // A car licence stated for a vehicle too heavy for one is pointed out.
    await fetch(`${server.url}/api/owner/facts/vehicle.licenceCategory`, { method: 'PUT', headers: auth, body: JSON.stringify({ value: 'B', unitId: 'grote-camper' }) });
    const odd = (await (await fetch(`${server.url}/api/owner/rental-readiness`, { headers: auth })).json()) as Json;
    assert.ok(odd.items.some((i: Json) => i.state === 'problem' && /4250 kg/.test(i.why)));
    await fetch(`${server.url}/api/owner/facts/vehicle.licenceCategory`, { method: 'PUT', headers: auth, body: JSON.stringify({ value: 'C1', unitId: 'grote-camper' }) });
  });

  it('checks the driver on every way in, also the form on the public page', async () => {
    const page = await (await fetch(`${server.url}/verblijf/veluwe-campers?lang=en`)).text();
    assert.match(page, /name="driverAge"/);
    assert.match(page, /Security deposit/);
    assert.doesNotMatch(page, />Rooms</);
    const d = dates();
    const post = (extra: Json) =>
      fetch(`${server.url}/verblijf/veluwe-campers/aanvraag?lang=en`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ unitId: 'buscamper', ...d, adults: '2', name: 'Piet Proef', email: 'piet@example.com', ...extra }) });
    const none = await post({});
    assert.equal(none.status, 400);
    assert.match(await none.text(), /age and driving licence/);
    const young = await post({ driverAge: '20', driverLicence: 'B', driverLicenceYears: '2' });
    assert.equal(young.status, 400);
    assert.match(await young.text(), /at least 23/);
    const ok = await post({ driverAge: '30', driverLicence: 'B', driverLicenceYears: '8' });
    assert.equal(ok.status, 303);
    const made = server.store.requestsFor('prop_veluwecampers').find((r) => r.guest.email === 'piet@example.com')!;
    assert.deepEqual(made.driver, { age: 30, licenceCategory: 'B', licenceYears: 8, licenceCountry: undefined });
  });

  it('keeps the checks when a request is changed to a larger party', async () => {
    const q = await tool('get_quote', { ...camper, unitId: 'buscamper', ...dates(), guests: { adults: 2 }, driver: goodDriver });
    const sent = await tool('request_booking', { quoteId: q.body.quoteId, guest: { name: 'Mo Wissel', email: 'mo@example.com' }, guestConsent: true });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const changed = await tool('modify_request', { statusToken: sent.body.statusToken, guestConsent: true, unitId: 'grote-camper', guests: { adults: 4 } });
    assert.equal(changed.status, 400, JSON.stringify(changed.body));
    assert.equal(changed.body.code, 'DRIVER_NOT_ELIGIBLE');
  });
  it('does not send a request while the guest has not said which licence the driver holds', async () => {
    const q = await tool('get_quote', { ...camper, unitId: 'grote-camper', ...dates(), guests: { adults: 4 }, driver: { age: 30 } });
    assert.equal(q.body.rental.driver.eligible, null);
    assert.ok(q.body.rental.driver.missingFromGuest.length >= 2);
    const sent = await tool('request_booking', { quoteId: q.body.quoteId, guest, guestConsent: true });
    assert.equal(sent.status, 400, JSON.stringify(sent.body));
    assert.equal(sent.body.code, 'INVALID_INPUT');
    assert.match(sent.body.error ?? sent.body.message, /ask the guest/);
  });

  it('reads licence categories as they are: trailers and buses cover a car, a moped licence does not', async () => {
    const elig = async (unitId: string, licenceCategory: string, adults = 2) => (await tool('get_quote', { ...camper, unitId, ...dates(), guests: { adults }, driver: { age: 40, licenceYears: 10, licenceCategory } })).body.rental.driver.eligible;
    assert.equal(await elig('buscamper', 'BE'), true);
    assert.equal(await elig('buscamper', 'd'), true);
    assert.equal(await elig('buscamper', 'AM'), false);
    assert.equal(await elig('grote-camper', 'C1E', 4), true);
    assert.equal(await elig('grote-camper', 'CE', 4), true);
    assert.equal(await elig('grote-camper', 'BE', 4), false);
  });

  it('only accepts answers the checks can read', async () => {
    const auth = { 'content-type': 'application/json', authorization: `Bearer ${ownerKey(server, 'prop_veluwecampers')}` };
    const put = (key: string, value: unknown, unitId?: string) => fetch(`${server.url}/api/owner/facts/${key}`, { method: 'PUT', headers: auth, body: JSON.stringify({ value, unitId }) });
    assert.equal((await put('vehicle.inspectionValidUntil', '31-12-2030', 'buscamper')).status, 400);
    assert.equal((await put('vehicle.licenceCategory', 'Rijbewijs B', 'buscamper')).status, 400);
    assert.equal((await put('vehicle.licenceCategory', 'b', 'buscamper')).status, 200);
    assert.equal(server.store.getProperty('prop_veluwecampers')!.units[0].facts['vehicle.licenceCategory'].value, 'B');
    // An empty list of countries is "not answered", not "nowhere".
    assert.equal((await put('rental.countriesAllowed', '')).status, 200);
    const q = await tool('get_quote', { ...camper, unitId: 'buscamper', ...dates(), guests: { adults: 2 }, driver: goodDriver, destinations: ['DE'] });
    assert.equal(q.body.rental.trip.ok, true, JSON.stringify(q.body.rental.trip));
    assert.equal((await put('rental.countriesAllowed', ['NL', 'BE', 'DE', 'FR', 'LU', 'DK'])).status, 200);
  });

  it('hides a rental company the moment a required point is no longer in order, whichever way that happens', async () => {
    const auth = { 'content-type': 'application/json', authorization: `Bearer ${ownerKey(server, 'prop_veluwecampers')}` };
    const visible = async () => (await tool('search_stays', { kind: 'camper', country: 'NL' })).body.results.length === 1;
    assert.equal(await visible(), true);
    // The owner withdraws a required answer.
    await fetch(`${server.url}/api/owner/facts/rental.liabilityIncluded/unknown`, { method: 'POST', headers: auth, body: '{}' });
    assert.equal(server.store.getProperty('prop_veluwecampers')!.published, false);
    assert.equal(await visible(), false);
    const ready = (await (await fetch(`${server.url}/api/owner/rental-readiness`, { headers: auth })).json()) as Json;
    assert.deepEqual([ready.ready, ready.published], [false, false]);
    await fetch(`${server.url}/api/owner/facts/rental.liabilityIncluded`, { method: 'PUT', headers: auth, body: JSON.stringify({ value: true }) });
    assert.equal((await fetch(`${server.url}/api/owner/property`, { method: 'PATCH', headers: auth, body: JSON.stringify({ published: true }) })).status, 200);
    assert.equal(await visible(), true);
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

  it('cannot become a visible rental company by changing the type of a published stay', async () => {
    const setup = await fetch(`${server.url}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...base, name: 'Tweede' }) });
    // Only one set-up per installation: make the second property directly.
    assert.equal(setup.status, 409);
    const { createProperty } = await import('../src/properties.ts');
    const { property, ownerKey: key } = createProperty({ name: 'B&B Wissel', address: { city: 'Ede', country: 'NL' } });
    property.published = true;
    server.store.saveProperty(property);
    const auth = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
    const both = await fetch(`${server.url}/api/owner/property`, { method: 'PATCH', headers: auth, body: JSON.stringify({ type: 'camper_rental', published: true }) });
    assert.equal(both.status, 400);
    const typeOnly = await fetch(`${server.url}/api/owner/property`, { method: 'PATCH', headers: auth, body: JSON.stringify({ type: 'camper_rental' }) });
    assert.equal(typeOnly.status, 200);
    const after = server.store.getProperty(property.id)!;
    assert.deepEqual([after.type, after.published], ['camper_rental', false]);
  });
});
