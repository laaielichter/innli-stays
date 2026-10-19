import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { addDays } from '../src/domain/dates.ts';
import { startTestServer, type TestServer } from './helpers.ts';

type Json = Record<string, any>;

describe('1.1: options, discount codes, arrival rules, cancellation costs', () => {
  let server: TestServer;
  let client: Client;
  const P = 'prop_spaarne';
  const today = new Date().toISOString().slice(0, 10);
  const guest = { name: 'Ruth de Wit', email: 'ruth@example.com' };
  /** First date from `from` on that falls on the given weekday (0 = Sunday). */
  const nextWeekday = (from: string, day: number) => {
    let d = from;
    while (new Date(`${d}T00:00:00Z`).getUTCDay() !== day) d = addDays(d, 1);
    return d;
  };

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
  const line = (q: Json, kind: string) => q.lines.find((l: Json) => l.kind === kind);

  before(async () => {
    server = await startTestServer({ hotel: true });
    client = new Client({ name: 'agent', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${server.creds.agentKey}` } } }));
  });
  after(async () => {
    await client.close();
    await server.close();
  });

  it('paid options: listed in the details, priced per night/person/stay, kept in the request', async () => {
    const d = await call('get_stay_details', { propertyId: P });
    assert.deepEqual(d.extras.map((x: Json) => x.id), ['fiets', 'lunchpakket', 'late-checkout', 'kinderbed']);
    assert.equal(d.acceptsDiscountCodes, true);
    assert.ok(!JSON.stringify(d).includes('WELKOMTERUG'), 'codes stay private');
    const dates = { checkin: addDays(today, 30), checkout: addDays(today, 32) };
    const q = await call('get_quote', { propertyId: P, unitId: 'standaard', ...dates, guests: { adults: 2 }, extras: [{ id: 'fiets', qty: 2 }, { id: 'lunchpakket' }, { id: 'late-checkout' }] });
    const extras = q.lines.filter((l: Json) => l.kind === 'extra');
    assert.deepEqual(extras.map((l: Json) => l.amount), [60, 25, 25], 'bikes 15 × 2 × 2 nights, lunch 12.50 × 2 persons, late check-out once');
    assert.equal(q.extrasAvailable.find((x: Json) => x.id === 'fiets').chosen, 2);
    assert.match(await callError('get_quote', { propertyId: P, unitId: 'standaard', ...dates, extras: [{ id: 'jacuzzi' }] }), /jacuzzi/);
    assert.match(await callError('get_quote', { propertyId: P, unitId: 'standaard', ...dates, extras: [{ id: 'fiets', qty: 9 }] }), /6/);
    const r = await call('request_booking', { quoteId: q.quoteId, guest, guestConsent: true });
    assert.deepEqual(r.extras, [{ id: 'fiets', qty: 2 }, { id: 'lunchpakket', qty: 1 }, { id: 'late-checkout', qty: 1 }]);
    assert.equal(r.total, q.total);
  });

  it('discount codes: case-insensitive, on the room price, invalid and used-up codes are refused', async () => {
    const dates = { checkin: addDays(today, 40), checkout: addDays(today, 42) };
    const plain = await call('get_quote', { propertyId: P, unitId: 'superior', ...dates, guests: { adults: 2 } });
    const coded = await call('get_quote', { propertyId: P, unitId: 'superior', ...dates, guests: { adults: 2 }, discountCode: 'welkomterug' });
    assert.equal(line(coded, 'code_discount').amount, -Math.round(line(plain, 'accommodation').amount * 10) / 100);
    assert.equal(coded.discountCode, 'WELKOMTERUG');
    assert.match(await callError('get_quote', { propertyId: P, unitId: 'superior', ...dates, discountCode: 'GRATIS' }), /GRATIS/);

    const property = server.store.getProperty(P)!;
    property.discountCodes!.push({ code: 'EENMALIG', percent: 20, maxUses: 1, active: true });
    const first = await call('get_quote', { propertyId: P, unitId: 'superior', ...dates, guests: { adults: 2 }, discountCode: 'EENMALIG' });
    await call('request_booking', { quoteId: first.quoteId, guest, guestConsent: true });
    assert.match(await callError('get_quote', { propertyId: P, unitId: 'superior', checkin: addDays(today, 50), checkout: addDays(today, 51), discountCode: 'EENMALIG' }), /EENMALIG/);
  });

  it('arrival rules and the one-night supplement', async () => {
    const property = server.store.getProperty(P)!;
    const superior = property.units.find((u) => u.id === 'superior')!;
    superior.rates = { ...superior.rates!, checkinDays: [6] };
    const standaard = property.units.find((u) => u.id === 'standaard')!;
    standaard.rates = { ...standaard.rates!, singleNightSupplement: 20 };
    try {
      const tuesday = nextWeekday(addDays(today, 20), 2);
      const q = await call('get_quote', { propertyId: P, unitId: 'superior', checkin: tuesday, checkout: addDays(tuesday, 2), guests: { adults: 2 } });
      assert.ok(q.warnings.some((w: string) => /Saturday/.test(w)), 'says arrival is only on Saturday');
      const r = await call('request_booking', { quoteId: q.quoteId, guest, guestConsent: true });
      assert.equal(r.status, 'new', 'the owner decides, no instant booking against their rules');
      const saturday = nextWeekday(addDays(today, 20), 6);
      const ok = await call('get_quote', { propertyId: P, unitId: 'superior', checkin: saturday, checkout: addDays(saturday, 2), guests: { adults: 2 } });
      assert.ok(!ok.warnings.some((w: string) => /Saturday/.test(w)));
      const details = await call('get_stay_details', { propertyId: P });
      assert.deepEqual(details.units.find((u: Json) => u.id === 'superior').arrivalRules.checkinDays.checkinDays, [6]);

      const one = await call('get_quote', { propertyId: P, unitId: 'standaard', checkin: addDays(today, 60), checkout: addDays(today, 61), guests: { adults: 2 }, rooms: 2 });
      assert.equal(line(one, 'supplement').amount, 40, '20 per room');
      const two = await call('get_quote', { propertyId: P, unitId: 'standaard', checkin: addDays(today, 60), checkout: addDays(today, 62), guests: { adults: 2 } });
      assert.equal(line(two, 'supplement'), undefined);
    } finally {
      delete superior.rates!.checkinDays;
      delete standaard.rates!.singleNightSupplement;
    }
  });

  it('cancellation costs: schedule in the quote, cost now in check_status and cancel_request', async () => {
    const checkin = addDays(today, 10);
    const q = await call('get_quote', { propertyId: P, unitId: 'familie', checkin, checkout: addDays(checkin, 2), guests: { adults: 2 } });
    assert.deepEqual(q.cancellationCosts, [{ from: addDays(checkin, -1), percent: 50, amount: Math.round(q.total * 50) / 100 }]);
    const r = await call('request_booking', { quoteId: q.quoteId, guest, guestConsent: true });
    assert.equal(r.booked, true);
    const s = await call('check_status', { statusToken: r.statusToken });
    assert.equal(s.cancellationCostIfCancelledNow.amount, 0);
    assert.equal(s.cancellationCostIfCancelledNow.freeUntil, addDays(checkin, -1));
    const c = await call('cancel_request', { statusToken: r.statusToken, guestConsent: true });
    assert.equal(c.cancellationCost.amount, 0);
    assert.match(c.tellTheGuest, /free of charge/);

    const nr = await call('get_quote', { propertyId: P, unitId: 'familie', checkin, checkout: addDays(checkin, 2), guests: { adults: 2 }, ratePlanId: 'non-refundable' });
    const booked = await call('request_booking', { quoteId: nr.quoteId, guest, guestConsent: true });
    const cost = (await call('check_status', { statusToken: booked.statusToken })).cancellationCostIfCancelledNow;
    assert.equal(cost.percent, 100);
    assert.equal(cost.amount, nr.total);
  });

  it('stay page: options and discount code in the form, price and request', async () => {
    const page = await (await fetch(`${server.url}/verblijf/het-spaarne?lang=en`)).text();
    assert.match(page, /name="extra_fiets"/);
    assert.match(page, /name="discountCode"/);
    const dates = { checkin: addDays(today, 90), checkout: addDays(today, 91) };
    const price = await (await fetch(`${server.url}/verblijf/het-spaarne/prijs?${new URLSearchParams({ unitId: 'standaard', ...dates, adults: '2', extra_fiets: '2', 'extra_late-checkout': '1', discountCode: 'welkomterug', lang: 'en' })}`)).text();
    assert.match(price, /2 × Fietshuur/);
    assert.match(price, /Late check-out/);
    assert.match(price, /Discount code WELKOMTERUG/);
    const res = await fetch(`${server.url}/verblijf/het-spaarne/aanvraag`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ unitId: 'standaard', ...dates, adults: '2', extra_fiets: '2', discountCode: 'welkomterug', name: 'Bo Visser', email: 'bo@example.com' }),
    });
    assert.equal(res.status, 303);
    const r = server.store.requestsFor(P).find((x) => x.guest.email === 'bo@example.com')!;
    assert.deepEqual(r.extras, [{ id: 'fiets', qty: 2 }]);
    assert.equal(r.discountCode, 'WELKOMTERUG');
  });
});

describe('1.1: house rules, sustainability and reviews per aspect', () => {
  let server: TestServer;
  let client: Client;
  const today = new Date().toISOString().slice(0, 10);
  const call = async (name: string, args: Json): Promise<Json> => {
    const res = (await client.callTool({ name, arguments: args })) as Json;
    if (res.isError) throw new Error(res.content[0].text);
    return res.structuredContent;
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

  it('searches on non-smoking, EV charging, an eco label and car-free reach', async () => {
    const s = await call('search_stays', { country: 'NL', requirements: ['non_smoking', 'ev_charging', 'eco_label', 'car_free_reachable'] });
    const hotel = s.results.find((r: Json) => r.propertyId === 'prop_spaarne');
    assert.equal(hotel.matchQuality, 'met');
    assert.ok(!s.results.some((r: Json) => r.matchQuality === 'met' && r.propertyId !== 'prop_spaarne'), 'others do not claim what they did not confirm');
    const a = await call('answer_question', { propertyId: 'prop_spaarne', question: 'Is there a charging point for our electric car?' });
    assert.equal(a.answered, true);
    assert.ok(a.sources.some((x: Json) => x.key === 'eco.evCharging'));
    const smoke = await call('answer_question', { propertyId: 'prop_spaarne', question: 'Mag er gerookt worden?', language: 'nl' });
    assert.ok(smoke.sources.some((x: Json) => x.key === 'rules.smokingAllowed'));
  });

  it('reviews per aspect: averages for agents, in search results and on the stay page', async () => {
    const r = server.store.requestsFor('prop_hooiberg')[0] ?? server.store.allRequests()[0];
    const past = { ...r, id: 'req_review1', publicToken: 'tok_review_1', propertyId: 'prop_hooiberg', status: 'accepted' as const, checkin: '2026-01-02', checkout: '2026-01-04', review: undefined };
    server.store.saveRequest(past);
    const res = await fetch(`${server.url}/beoordeling/tok_review_1`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ rating: '5', aspect_clean: '5', aspect_breakfast: '4', aspect_quiet: '9', text: 'Heerlijk rustig.' }),
    });
    assert.equal(res.status, 303);
    assert.deepEqual(server.store.getRequest('req_review1')!.review!.aspects, { clean: 5, breakfast: 4 }, 'out-of-range scores are ignored');
    const d = await call('get_stay_details', { propertyId: 'prop_hooiberg' });
    assert.deepEqual(d.reviews.aspects.clean, { average: 5, count: 1 });
    const s = await call('search_stays', { area: 'Veluwe' });
    const hit = s.results.find((x: Json) => x.propertyId === 'prop_hooiberg');
    assert.equal(hit.rating.aspects.breakfast, 4);
    const page = await (await fetch(`${server.url}/verblijf/hooiberg?lang=en`)).text();
    assert.match(page, /Cleanliness/);
    assert.ok(today);
  });
});

describe('1.1: alternatives when full, honest scarcity', () => {
  let server: TestServer;
  let client: Client;
  const today = new Date().toISOString().slice(0, 10);
  const call = async (name: string, args: Json): Promise<Json> => {
    const res = (await client.callTool({ name, arguments: args })) as Json;
    if (res.isError) throw new Error(res.content[0].text);
    return res.structuredContent;
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

  it('a full property suggests other free stays; demand is counted, few rooms left is flagged', async () => {
    const checkin = addDays(today, 45);
    const dates = { propertyId: 'prop_spaarne', checkin, checkout: addDays(checkin, 1), guests: { adults: 2 } };
    const free = await call('check_availability', dates);
    assert.equal(free.alternatives, undefined, 'no alternatives while rooms are free');
    for (let i = 0; i < 3; i++) await call('check_availability', dates);
    const busy = await call('check_availability', dates);
    assert.equal(busy.demand.popularDates, true);
    assert.ok(busy.demand.checksLast7Days >= 3);

    const hotel = server.store.getProperty('prop_spaarne')!;
    for (const u of hotel.units) u.closedNights = [checkin];
    const full = await call('check_availability', dates);
    assert.ok(full.units.every((u: Json) => u.status === 'unavailable'));
    assert.ok(full.alternatives.length > 0, 'other free stays are suggested');
    assert.ok(full.alternatives.every((a: Json) => a.propertyId !== 'prop_spaarne' && typeof a.total === 'number'));
    for (const u of hotel.units) u.closedNights = [];

    const fam = hotel.units.find((u) => u.id === 'familie')!;
    const q = await call('get_quote', { propertyId: 'prop_spaarne', unitId: 'familie', checkin, checkout: addDays(checkin, 1), guests: { adults: 2 }, rooms: 5 });
    await call('request_booking', { quoteId: q.quoteId, guest: { name: 'Groep Jansen', email: 'groep@example.com' }, guestConsent: true });
    const after = await call('check_availability', dates);
    const famRow = after.units.find((u: Json) => u.unitId === fam.id);
    assert.equal(famRow.roomsLeft, 1);
    assert.equal(famRow.fewLeft, true);
  });
});

describe('1.1: flexible search across stays', () => {
  let server: TestServer;
  let client: Client;
  const today = new Date().toISOString().slice(0, 10);
  const call = async (name: string, args: Json): Promise<Json> => {
    const res = (await client.callTool({ name, arguments: args })) as Json;
    if (res.isError) throw new Error(res.content[0].text);
    return res.structuredContent;
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

  it('"a long weekend" across all stays, and a budget per night', async () => {
    const s = await call('search_stays', { country: 'NL', flexibleDates: { from: addDays(today, 14), to: addDays(today, 60), pattern: 'long_weekend' }, limit: 10 });
    assert.ok(s.results.length >= 2, 'several stays at once');
    for (const r of s.results) {
      const offer = r.offer ?? r.offers?.[0];
      if (!offer) continue;
      assert.equal(new Date(`${offer.checkin}T00:00:00Z`).getUTCDay(), 5, 'arrives on Friday');
      assert.equal(offer.nights, 3, 'Friday to Monday');
    }
    const cheap = await call('search_stays', { country: 'NL', flexibleDates: { from: addDays(today, 14), to: addDays(today, 60), pattern: 'weekend' }, maxPricePerNight: 150, limit: 10 });
    for (const r of cheap.results) if (r.offer) assert.ok(r.offer.total / r.offer.nights <= 150);
    assert.ok(cheap.excluded.some((e: Json) => /per night/.test(e.reason)), 'expensive stays are explained');
    const bad = (await client.callTool({ name: 'search_stays', arguments: { country: 'NL', flexibleDates: { from: addDays(today, 14), to: addDays(today, 60) } } })) as Json;
    assert.equal(bad.isError, true, 'nights or a pattern is needed');
  });
});
