/**
 * Load benchmark: a large installation (or the guide-side pilot scale) with
 * many stays, requests and analytics events. Measures what agents and owners
 * actually wait for.
 *
 *   npm run bench
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { funnel } from '../src/analytics/funnel.ts';
import { insights } from '../src/analytics/insights.ts';
import { Catalog } from '../src/catalog.ts';
import { AvailabilityService } from '../src/connectors/availability.ts';
import { addDays } from '../src/domain/dates.ts';
import { ownerSetFact } from '../src/domain/facts.ts';
import { createProperty, createUnit } from '../src/properties.ts';
import { Store } from '../src/store.ts';

const PROPERTIES = Number(process.env.BENCH_PROPERTIES ?? 300);
const REQUESTS = Number(process.env.BENCH_REQUESTS ?? 20_000);
const EVENTS = Number(process.env.BENCH_EVENTS ?? 200_000);

const dir = mkdtempSync(join(tmpdir(), 'innli-bench-'));
const store = new Store(join(dir, 'innli.json'));
// Live booking systems answer in ~40 ms each, like a real PMS/channel manager API.
const LIVE_LATENCY_MS = 40;
const slowLiveApi = async (url: string) => {
  await new Promise((r) => setTimeout(r, LIVE_LATENCY_MS));
  const u = new URL(url);
  const nights: { date: string; amount: number }[] = [];
  for (let d = u.searchParams.get('checkin')!; d < u.searchParams.get('checkout')!; d = addDays(d, 1)) nights.push({ date: d, amount: 120 });
  return new Response(JSON.stringify({ available: true, currency: 'EUR', nightly: nights }), { headers: { 'content-type': 'application/json' } });
};
const availability = new AvailabilityService(slowLiveApi, () => new Date(), (p, u, ignore) => store.occupancy(p, u, ignore));
const catalog = new Catalog(store, availability, 'http://localhost');
const today = new Date().toISOString().slice(0, 10);
const regions = ['Veluwe', 'Texel', 'Zeeland', 'Drenthe', 'Limburg'];

for (let i = 0; i < PROPERTIES; i++) {
  const { property: p } = createProperty({ name: `B&B ${i}`, address: { city: `Plaats ${i}`, region: regions[i % regions.length], country: 'NL' } });
  p.published = true;
  p.booking = { connector: { kind: 'manual' } };
  for (const [k, v] of Object.entries({ 'pets.dogsAllowed': i % 2 === 0, 'garden.fullyEnclosed': i % 3 === 0, 'fees.cleaningPerStay': 0, 'fees.touristTaxPerPersonPerNight': 2, 'breakfast.included': true })) ownerSetFact(p.facts, k, v);
  for (let u = 0; u < 3; u++) {
    const unit = createUnit({ name: `Kamer ${u}`, maxGuests: 2 + u, includedGuests: 2, baseRatePerNight: 80 + u * 10 });
    ownerSetFact(unit.facts, 'unit.floor', u);
    unit.closedNights = Array.from({ length: 30 }, (_, n) => addDays(today, n * 3 + u));
    p.units.push(unit);
  }
  store.saveProperty(p);
}
// A region where every stay is connected to a live booking system.
for (let i = 0; i < 12; i++) {
  const { property: p } = createProperty({ name: `Live ${i}`, address: { city: `Live ${i}`, region: 'Wadden', country: 'NL' } });
  p.published = true;
  p.booking = { connector: { kind: 'live_api', baseUrl: 'https://pms.example/api' }, deeplinkTemplate: 'https://pms.example/book?d={checkin}' };
  for (const [k, v] of Object.entries({ 'fees.cleaningPerStay': 0, 'fees.touristTaxPerPersonPerNight': 2 })) ownerSetFact(p.facts, k, v);
  for (let u = 0; u < 2; u++) p.units.push(createUnit({ name: `Kamer ${u}`, maxGuests: 2, includedGuests: 2, baseRatePerNight: 100 }));
  store.saveProperty(p);
}
const props = store.listProperties().filter((p) => p.booking.connector.kind === 'manual');
for (let i = 0; i < REQUESTS; i++) {
  const p = props[i % props.length];
  const checkin = addDays(today, 5 + (i % 200));
  store.saveRequest({
    id: `req_${i}`, publicToken: randomUUID(), propertyId: p.id, unitId: p.units[i % 3].id, checkin, checkout: addDays(checkin, 2),
    guests: { adults: 2, children: 0, dogs: 0 }, breakfast: false, quotedTotal: 200, quoteComplete: true,
    guest: { name: 'Gast', email: 'g@example.com' }, status: i % 5 === 0 ? 'new' : 'accepted', holdUntil: i % 5 === 0 ? new Date(Date.now() + 86_400_000).toISOString() : undefined,
    createdAt: new Date(Date.now() - (i % 100) * 3_600_000).toISOString(),
  });
}
// A busy city hotel: 300 rooms in five room types, a year of bookings.
const HOTEL_BOOKINGS = Number(process.env.BENCH_HOTEL_BOOKINGS ?? 10_000);
const { property: hotel } = createProperty({ name: 'Bench Hotel', type: 'hotel', address: { city: 'Amsterdam', region: 'Noord-Holland', country: 'NL' } });
hotel.published = true;
hotel.booking = { connector: { kind: 'manual' } };
hotel.ratePlans = [{ id: 'non-refundable', name: 'Non-refundable', adjustmentPercent: -10, refundable: false }];
for (let u = 0; u < 5; u++) hotel.units.push(createUnit({ name: `Type ${u}`, maxGuests: 2 + (u % 3), includedGuests: 2, baseRatePerNight: 120 + u * 20, inventory: 60 }, `type-${u}`));
store.saveProperty(hotel);
for (let i = 0; i < HOTEL_BOOKINGS; i++) {
  const checkin = addDays(today, 1 + (i % 365));
  store.saveRequest({
    id: `hreq_${i}`, publicToken: randomUUID(), propertyId: hotel.id, unitId: `type-${i % 5}`, checkin, checkout: addDays(checkin, 1 + (i % 4)), rooms: 1 + (i % 3),
    guests: { adults: 2, children: 0, dogs: 0 }, breakfast: false, quotedTotal: 300, quoteComplete: true,
    guest: { name: 'Gast', email: 'g@example.com' }, status: 'accepted', createdAt: new Date().toISOString(),
  });
}

const types = ['search_consideration', 'search_impression', 'details_view', 'quote_issued'] as const;
for (let i = 0; i < EVENTS; i++) {
  const p = props[i % props.length];
  store.addEvent({ id: `e${i}`, type: types[i % types.length], propertyId: p.id, agentClient: 'Bench', at: new Date(Date.now() - (i % 1000) * 60_000).toISOString(), meta: { requirements: ['enclosed_garden'], outcome: 'shown', failed: [], unknown: ['enclosed_garden'] } });
}

async function time(label: string, runs: number, fn: () => unknown | Promise<unknown>) {
  await fn();
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) await fn();
  const ms = (performance.now() - t0) / runs;
  console.log(`${label.padEnd(44)} ${ms.toFixed(2).padStart(9)} ms`);
  return ms;
}

console.log(`Bench: ${PROPERTIES} accommodaties, ${REQUESTS} aanvragen, ${EVENTS} gebeurtenissen, hotel met 300 kamers en ${HOTEL_BOOKINGS} boekingen\n`);
const results: Record<string, number> = {};
const w = { checkin: addDays(today, 250), checkout: addDays(today, 252) };
results.search = await time('search_stays (regio, met datums)', 20, () => catalog.search({ location: { area: 'Veluwe' }, ...w, guests: { adults: 2, children: 0, dogs: 0 }, requirements: ['ground_floor_unit'] }, 'Bench'));
results.searchAll = await time('search_stays (heel NL, met datums)', 10, () => catalog.search({ location: { country: 'NL' }, ...w, guests: { adults: 2, children: 0, dogs: 0 }, limit: 10 }, 'Bench'));
results.searchLive = await time('search_stays (12 live systemen, 40 ms elk)', 5, () => catalog.search({ location: { area: 'Wadden' }, ...w, guests: { adults: 2, children: 0, dogs: 0 }, limit: 10 }, 'Bench'));
const liveProp = store.listProperties().find((p) => p.booking.connector.kind === 'live_api')!;
results.datesLive = await time('find_available_dates (live systeem)', 3, () => catalog.findAvailableDates(liveProp.id, { from: addDays(today, 3), to: addDays(today, 20), nights: 2, guests: { adults: 2, children: 0, dogs: 0 } }, 'Bench'));
results.quote = await time('get_quote', 200, () => catalog.quote(props[7].id, props[7].units[1].id, w.checkin, w.checkout, { adults: 2, children: 0, dogs: 0 }, false, 'Bench'));
results.dates = await time('find_available_dates (30 dagen)', 20, () => catalog.findAvailableDates(props[9].id, { from: addDays(today, 3), to: addDays(today, 33), nights: 2, guests: { adults: 2, children: 0, dogs: 0 } }, 'Bench'));
const hw = { checkin: addDays(today, 100), checkout: addDays(today, 103) };
results.hotelAvailability = await time('hotel: check_availability (3 kamers)', 200, () => catalog.checkAvailability(hotel.id, hw.checkin, hw.checkout, { adults: 6, children: 0, dogs: 0 }, 'Bench', { rooms: 3 }));
results.hotelQuote = await time('hotel: get_quote (3 kamers, tariefplan)', 200, () => catalog.quote(hotel.id, 'type-1', hw.checkin, hw.checkout, { adults: 6, children: 0, dogs: 0 }, false, 'Bench', { rooms: 3, ratePlanId: 'non-refundable' }));
results.hotelCalendar = await time('hotel: kamerkalender 120 dagen', 50, () => catalog.roomCalendar(hotel, hotel.units[0], Array.from({ length: 120 }, (_, n) => addDays(today, n))));
results.funnel = await time('dashboard: funnel', 50, () => funnel(store, props[3].id, 30));
results.insights = await time('dashboard: wat agents zoeken', 50, () => insights(store, props[3], 30));
results.lookup = await time('statuslink opzoeken (token)', 2000, () => store.getRequestByToken(store.getRequest(`req_${REQUESTS - 1}`)!.publicToken));
results.write = await time('1 gebeurtenis opslaan (incl. schijf)', 20, () => {
  store.addEvent({ id: randomUUID(), type: 'details_view', propertyId: props[0].id, at: new Date().toISOString() });
  store.flush();
});
rmSync(dir, { recursive: true, force: true });
if (process.env.BENCH_JSON) console.log(JSON.stringify(results));
process.exit(0);
