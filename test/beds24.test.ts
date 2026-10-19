import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { beds24Days } from '../src/connectors/availability.ts';
import { addDays } from '../src/domain/dates.ts';
import { isBooked } from '../src/demo/engine.ts';
import { ownerSetFact } from '../src/domain/facts.ts';
import { createProperty, createUnit } from '../src/properties.ts';
import { startTestServer, type TestServer } from './helpers.ts';

type Json = Record<string, any>;

describe('1.1: Beds24 connector', () => {
  let server: TestServer;
  let client: Client;
  const today = new Date().toISOString().slice(0, 10);
  const call = async (name: string, args: Json): Promise<Json> => {
    const res = (await client.callTool({ name, arguments: args })) as Json;
    if (res.isError) throw new Error(res.content[0].text);
    return res.structuredContent;
  };
  /** First stay of `nights` nights from `from` on where room `id` is free every night (and arrival not on Saturday). */
  const freeStay = (id: string, nights: number, from = addDays(today, 10)) => {
    for (let d = from; ; d = addDays(d, 1)) {
      const stay = Array.from({ length: nights }, (_, i) => addDays(d, i));
      if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 6 && stay.every((n) => !isBooked(`b24-${id}`, n))) return { checkin: d, checkout: addDays(d, nights) };
    }
  };

  before(async () => {
    server = await startTestServer();
    const { property: p } = createProperty({ name: 'Beds24 Pension', address: { city: 'Leiden', country: 'NL' } });
    p.id = 'prop_b24';
    p.published = true;
    p.booking = { connector: { kind: 'beds24', refreshToken: 'demo-beds24-refresh-token', apiUrl: `${server.url}/demo-engine/beds24/v2` }, deeplinkTemplate: 'https://beds24.example/booking?room={unit}&checkin={checkin}&checkout={checkout}' };
    for (const [k, v] of Object.entries({ 'fees.cleaningPerStay': 0, 'fees.touristTaxPerPersonPerNight': 0 })) ownerSetFact(p.facts, k, v);
    p.units.push(
      createUnit({ name: 'Tweepersoonskamer', externalRef: '501', maxGuests: 2, includedGuests: 2, baseRatePerNight: 90, inventory: 3 }, 'twee'),
      createUnit({ name: 'Suite', externalRef: '502', maxGuests: 2, includedGuests: 2, baseRatePerNight: 120 }, 'suite'),
      createUnit({ name: 'Niet gekoppeld', maxGuests: 2, includedGuests: 2, baseRatePerNight: 80 }, 'los'),
    );
    server.store.saveProperty(p);
    client = new Client({ name: 'agent', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${server.creds.agentKey}` } } }));
  });
  after(async () => {
    await client.close();
    await server.close();
  });

  it('reads live availability, units left and prices from Beds24, and books through the booking link', async () => {
    const stay = freeStay('501', 2);
    const a = await call('check_availability', { propertyId: 'prop_b24', ...stay, guests: { adults: 2 } });
    const twee = a.units.find((u: Json) => u.unitId === 'twee');
    assert.equal(twee.status, 'available');
    assert.equal(twee.certainty, 'live');
    assert.equal(twee.roomsLeft, 3);
    assert.equal(a.units.find((u: Json) => u.unitId === 'los').status, 'unknown', 'a room without Beds24 id is not guessed');
    const q = await call('get_quote', { propertyId: 'prop_b24', unitId: 'twee', ...stay, guests: { adults: 2 } });
    assert.equal(q.priceCertainty, 'live');
    assert.equal(q.bookingMode, 'booking_link');
    const expected = [stay.checkin, addDays(stay.checkin, 1)].reduce((s, n) => s + 105 + ([5, 6].includes(new Date(`${n}T00:00:00Z`).getUTCDay()) ? 20 : 0), 0);
    assert.equal(q.lines.find((l: Json) => l.kind === 'accommodation').amount, expected);

    let booked = addDays(today, 10);
    while (!isBooked('b24-502', booked)) booked = addDays(booked, 1);
    const taken = await call('check_availability', { propertyId: 'prop_b24', checkin: booked, checkout: addDays(booked, 1) });
    assert.equal(taken.units.find((u: Json) => u.unitId === 'suite').status, 'unavailable');
  });

  it('respects the minimum stay per arrival date, and reports a broken token honestly', async () => {
    let sat = addDays(today, 10);
    while (new Date(`${sat}T00:00:00Z`).getUTCDay() !== 6 || isBooked('b24-501', sat)) sat = addDays(sat, 1);
    const one = await call('check_availability', { propertyId: 'prop_b24', checkin: sat, checkout: addDays(sat, 1) });
    const row = one.units.find((u: Json) => u.unitId === 'twee');
    assert.equal(row.status, 'unavailable');
    assert.match(row.note, /2 nights/);

    const p = server.store.getProperty('prop_b24')!;
    p.booking.connector = { kind: 'beds24', refreshToken: 'wrong-refresh-token-123', apiUrl: `${server.url}/demo-engine/beds24/v2` };
    const broken = await call('check_availability', { propertyId: 'prop_b24', ...freeStay('501', 1) });
    const b = broken.units.find((u: Json) => u.unitId === 'twee');
    assert.equal(b.status, 'unknown');
    assert.match(b.note, /refresh token/);
  });

  it('understands both calendar forms Beds24 may return', () => {
    const perDay = beds24Days({ data: [{ roomId: 7, date: '2027-01-01', numAvail: 2, price1: 99 }, { roomId: 8, date: '2027-01-01', numAvail: 0 }] }, '7');
    assert.deepEqual(perDay.get('2027-01-01'), { numAvail: 2, price1: 99, minStay: undefined });
    const ranges = beds24Days({ data: [{ roomId: 7, calendar: [{ from: '2027-01-01', to: '2027-01-03', numAvail: 1, price1: 80, minStay: 2 }] }] }, '7');
    assert.equal(ranges.size, 3);
    assert.equal(ranges.get('2027-01-03')!.minStay, 2);
    assert.throws(() => beds24Days({ error: 'x' }, '7'), /invalid/);
  });
});
