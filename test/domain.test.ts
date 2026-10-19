import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { completeness, ownerConfirmFact, ownerSetFact, suggestFact } from '../src/domain/facts.ts';
import { evaluateRequirement, impliedRequirements, matchUnits } from '../src/domain/matching.ts';
import { buildQuote } from '../src/domain/pricing.ts';
import { stayNights } from '../src/domain/dates.ts';
import type { AvailabilityResult, Property } from '../src/domain/types.ts';
import { createProperty, createUnit } from '../src/properties.ts';

function fixture(): Property {
  const { property } = createProperty({ name: 'Test B&B', address: { city: 'Ede', country: 'NL' } });
  property.units.push(createUnit({ name: 'Kamer 1', maxGuests: 2, includedGuests: 2, baseRatePerNight: 100 }, 'k1'));
  return property;
}

const guests = { adults: 2, children: 0, dogs: 1 };
const live = (rates?: number[]): AvailabilityResult => ({
  unitId: 'k1',
  status: 'available',
  certainty: 'live',
  checkedAt: new Date().toISOString(),
  nightlyRates: rates?.map((amount, i) => ({ date: `2030-05-0${i + 1}`, amount })),
  note: '',
});

describe('facts', () => {
  it('automated suggestions never overwrite owner-confirmed values', () => {
    const p = fixture();
    ownerSetFact(p.facts, 'garden.fullyEnclosed', false);
    assert.equal(suggestFact(p.facts, 'garden.fullyEnclosed', true, 'website', 'omheinde tuin'), false);
    assert.equal(p.facts['garden.fullyEnclosed'].value, false);
    assert.equal(p.facts['garden.fullyEnclosed'].status, 'confirmed');
  });

  it('suggestions stay unconfirmed until the owner confirms', () => {
    const p = fixture();
    suggestFact(p.facts, 'garden.fullyEnclosed', true, 'website', 'omheinde tuin');
    assert.equal(p.facts['garden.fullyEnclosed'].status, 'unconfirmed');
    ownerConfirmFact(p.facts, 'garden.fullyEnclosed');
    assert.equal(p.facts['garden.fullyEnclosed'].status, 'confirmed');
    assert.ok(p.facts['garden.fullyEnclosed'].verifiedAt);
  });

  it('rejects values of the wrong type', () => {
    const p = fixture();
    assert.throws(() => ownerSetFact(p.facts, 'bed.lengthCm', 'lang'));
    assert.throws(() => ownerSetFact(p.facts, 'does.not.exist', true));
    assert.equal(ownerSetFact(p.facts, 'bed.lengthCm', '210').value, 210);
  });

  it('completeness counts confirmed critical facts', () => {
    const p = fixture();
    const before = completeness(p);
    ownerSetFact(p.facts, 'pets.dogsAllowed', true);
    const after = completeness(p);
    assert.equal(after.criticalConfirmed, before.criticalConfirmed + 1);
    assert.ok(after.unknownCritical.length < before.unknownCritical.length);
  });
});

describe('matching', () => {
  it('distinguishes met, unverified, unknown and not_met', () => {
    const p = fixture();
    const u = p.units[0];
    const opts = { guests };
    assert.equal(evaluateRequirement('enclosed_garden', p, u, opts).level, 'unknown');
    suggestFact(p.facts, 'garden.fullyEnclosed', true, 'website', 'x');
    assert.equal(evaluateRequirement('enclosed_garden', p, u, opts).level, 'unverified');
    ownerConfirmFact(p.facts, 'garden.fullyEnclosed');
    assert.equal(evaluateRequirement('enclosed_garden', p, u, opts).level, 'met');
    ownerSetFact(p.facts, 'garden.fullyEnclosed', false);
    assert.equal(evaluateRequirement('enclosed_garden', p, u, opts).level, 'not_met');
  });

  it('an unconfirmed "no" is treated as unknown, not as a reliable no', () => {
    const p = fixture();
    suggestFact(p.facts, 'pets.dogsAllowed', false, 'website', 'geen huisdieren');
    assert.equal(evaluateRequirement('dogs_allowed', p, p.units[0], { guests }).level, 'unknown');
  });

  it('flags stale confirmations as unverified', () => {
    const p = fixture();
    ownerSetFact(p.facts, 'garden.fullyEnclosed', true, new Date('2020-01-01'));
    const r = evaluateRequirement('enclosed_garden', p, p.units[0], { guests });
    assert.equal(r.level, 'unverified');
    assert.match(r.detail, /laatst gecontroleerd 1 jan 2020/);
  });

  it('checks the number of dogs against the maximum', () => {
    const p = fixture();
    ownerSetFact(p.facts, 'pets.dogsAllowed', true);
    ownerSetFact(p.facts, 'pets.maxDogs', 1);
    assert.equal(evaluateRequirement('dogs_allowed', p, p.units[0], { guests: { ...guests, dogs: 2 } }).level, 'not_met');
  });

  it('adds implied requirements from the party and excludes units that fail', () => {
    assert.deepEqual(impliedRequirements({ adults: 2, children: 1, dogs: 1 }, []).sort(), ['children_welcome', 'dogs_allowed']);
    const p = fixture();
    ownerSetFact(p.units[0].facts, 'unit.floor', 1);
    assert.equal(matchUnits(p, ['ground_floor_unit'], { guests }).length, 0);
    ownerSetFact(p.units[0].facts, 'unit.floor', 0);
    assert.equal(matchUnits(p, ['ground_floor_unit'], { guests })[0].overall, 'met');
    assert.equal(matchUnits(p, [], { guests: { adults: 3, children: 0, dogs: 0 } }).length, 0, 'capacity');
  });
});

describe('pricing', () => {
  const nights = stayNights('2030-05-01', '2030-05-03');

  it('itemises all mandatory costs and uses live rates', () => {
    const p = fixture();
    ownerSetFact(p.facts, 'fees.cleaningPerStay', 25);
    ownerSetFact(p.facts, 'fees.touristTaxPerPersonPerNight', 2);
    ownerSetFact(p.facts, 'pets.dogsAllowed', true);
    ownerSetFact(p.facts, 'pets.feePerDogPerNight', 5);
    ownerSetFact(p.facts, 'breakfast.included', true);
    const q = buildQuote({ id: 'q', property: p, unit: p.units[0], checkin: '2030-05-01', checkout: '2030-05-03', nights, guests, breakfast: true, availability: live([100, 120]) });
    assert.equal(q.complete, true);
    assert.equal(q.priceCertainty, 'live');
    assert.equal(q.total, 220 + 25 + 8 + 10);
    assert.deepEqual(q.lines.map((l) => l.kind), ['accommodation', 'fee', 'tax', 'pet', 'breakfast']);
  });

  it('marks the quote incomplete when a mandatory cost is unknown', () => {
    const p = fixture();
    const q = buildQuote({ id: 'q', property: p, unit: p.units[0], checkin: '2030-05-01', checkout: '2030-05-03', nights, guests, breakfast: false, availability: live() });
    assert.equal(q.complete, false);
    assert.equal(q.priceCertainty, 'indicative');
    assert.ok(q.warnings.some((w) => w.includes('Schoonmaakkosten')));
    assert.ok(q.warnings.some((w) => w.includes('Toeristenbelasting')));
    assert.ok(q.warnings.some((w) => w.includes('honden')));
  });

  it('only offers a booking link with live availability and a booking environment', () => {
    const p = fixture();
    const args = { id: 'q', property: p, unit: p.units[0], checkin: '2030-05-01', checkout: '2030-05-03', nights, guests, breakfast: false };
    assert.equal(buildQuote({ ...args, availability: live() }).bookingMode, 'availability_request');
    p.booking.deeplinkTemplate = 'https://example.com/book?in={checkin}';
    assert.equal(buildQuote({ ...args, availability: live() }).bookingMode, 'booking_link');
    assert.equal(buildQuote({ ...args, availability: { ...live(), certainty: 'synced' } }).bookingMode, 'availability_request');
  });
});

describe('owner rate table', () => {
  it('applies seasons (also across the year end), weekend supplement and season minimum stay', async () => {
    const { nightPrices, seasonMinNights } = await import('../src/domain/rates.ts');
    const p = fixture();
    const unit = p.units[0];
    unit.rates = { weekendSupplement: 20, seasons: [{ name: 'Zomer', from: '07-01', to: '08-31', ratePerNight: 150, minNights: 3 }, { name: 'Kerst', from: '12-24', to: '01-01', ratePerNight: 200 }] };
    // 2030-07-04 is a Thursday, 2030-07-05 a Friday.
    assert.deepEqual(nightPrices(unit, ['2030-06-30', '2030-07-04', '2030-07-05', '2030-12-31', '2031-01-01', '2031-01-02']).map((n) => n.amount), [100, 150, 170, 200, 200, 100]);
    assert.deepEqual(seasonMinNights(unit, ['2030-08-30', '2030-08-31']), { minNights: 3, season: 'Zomer' });
    ownerSetFact(p.facts, 'fees.cleaningPerStay', 0);
    ownerSetFact(p.facts, 'fees.touristTaxPerPersonPerNight', 0);
    const nights = stayNights('2030-07-04', '2030-07-06');
    const q = buildQuote({ id: 'q', property: p, unit, checkin: '2030-07-04', checkout: '2030-07-06', nights, guests: { adults: 2, children: 0, dogs: 0 }, breakfast: false, availability: { ...live(), certainty: 'synced' } });
    assert.equal(q.total, 320);
    assert.match(q.lines[0].basis, /seizoen Zomer.*weekendtoeslag/);
    assert.ok(q.warnings.some((w) => w.includes('Minimum verblijf in seizoen Zomer is 3 nachten')));
  });
});
