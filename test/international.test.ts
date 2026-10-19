import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addDays, stayNights } from '../src/domain/dates.ts';
import { ownerSetFact } from '../src/domain/facts.ts';
import { currencyForCountry } from '../src/domain/types.ts';
import { buildQuote } from '../src/domain/pricing.ts';
import { fromAcceptLanguage, money, t, withLang } from '../src/i18n/index.ts';
import { createProperty, createUnit } from '../src/properties.ts';
import { extractFromHtml } from '../src/readiness/extract.ts';
import { ownerKey, startTestServer, type TestServer } from './helpers.ts';

type Json = Record<string, any>;
const today = () => new Date().toISOString().slice(0, 10);

describe('languages', () => {
  it('picks the language from Accept-Language with q-values, and falls back sensibly', () => {
    assert.equal(fromAcceptLanguage('de-DE,de;q=0.9,en;q=0.8'), 'de');
    assert.equal(fromAcceptLanguage('it-IT,fr;q=0.7,en;q=0.5'), 'fr');
    assert.equal(fromAcceptLanguage('ja,zh;q=0.9'), undefined);
    assert.equal(fromAcceptLanguage('*'), undefined);
  });

  it('translates with parameters and plurals, and falls back to English', () => {
    assert.equal(t('price.unitNights', { unit: 'Bay Room', n: 1 }, 'en'), 'Bay Room, 1 night');
    assert.equal(t('price.unitNights', { unit: 'Zimmer', n: 3 }, 'de'), 'Zimmer, 3 Nächte');
    assert.equal(t('req.unitGone', {}, 'fr'), t('req.unitGone', {}, 'en'), 'missing French text falls back to English');
  });

  it('formats money in the currency and the reader’s language', () => {
    assert.equal(money(1234.5, 'en', 'GBP'), '£1,234.50');
    assert.match(money(1234.5, 'de', 'EUR'), /1\.234,50\s€/);
    assert.match(money(98, 'fr', 'CHF'), /98,00\sCHF/);
  });

  it('builds the price breakdown in the language of the request', () => {
    const { property: p } = createProperty({ name: 'X', address: { city: 'Gordes', country: 'FR' } });
    ownerSetFact(p.facts, 'fees.cleaningPerStay', 20);
    const unit = createUnit({ name: 'Lavande', maxGuests: 2, includedGuests: 2, baseRatePerNight: 100 });
    const checkin = addDays(today(), 30);
    const q = withLang('fr', () =>
      buildQuote({ id: 'q', property: p, unit, checkin, checkout: addDays(checkin, 2), nights: stayNights(checkin, addDays(checkin, 2)), guests: { adults: 2, children: 0, dogs: 0 }, breakfast: false, availability: { unitId: unit.id, status: 'available', certainty: 'synced', checkedAt: '', note: '' } }),
    );
    assert.equal(q.lines[0].label, 'Lavande, 2 nuits');
    assert.equal(q.lines.find((l) => l.kind === 'fee')!.label, 'Frais de ménage');
    assert.ok(q.warnings.includes("La taxe de séjour n'est pas connue."));
    assert.deepEqual(q.issues, [], 'conditions are language independent codes');
  });
});

describe('website import in other languages', () => {
  const facts = (html: string) => Object.fromEntries(extractFromHtml(html).suggestions.map((x) => [x.key, x.value]));
  it('reads an English site', () => {
    const f = facts('<p>Dogs are welcome (up to two dogs), £10 per dog per night. Our fully fenced garden backs onto the fells. Breakfast is included, served from 8:00 to 10:00. Check-in from 15:00, check-out by 10:30. Free parking on site. Minimum stay of 2 nights.</p>');
    assert.equal(f['pets.dogsAllowed'], true);
    assert.equal(f['pets.maxDogs'], 2);
    assert.equal(f['pets.feePerDogPerNight'], 10);
    assert.equal(f['garden.fullyEnclosed'], true);
    assert.equal(f['breakfast.times'], '08:00-10:00');
    assert.equal(f['checkout.until'], '10:30');
    assert.equal(f['policy.minNights'], 2);
  });
  it('reads German and French sites, with the amount before the currency sign', () => {
    const de = facts('<p>Hunde sind herzlich willkommen, 8,00 € pro Hund pro Nacht. Vollständig eingezäunter Garten. Kurtaxe 2,90 € pro Person. Endreinigung 40 €. Anreise ab 14:00.</p>');
    assert.equal(de['pets.feePerDogPerNight'], 8);
    assert.equal(de['garden.fullyEnclosed'], true);
    assert.equal(de['fees.touristTaxPerPersonPerNight'], 2.9);
    assert.equal(de['fees.cleaningPerStay'], 40);
    assert.equal(de['checkin.from'], '14:00');
    const fr = facts("<p>Pas d'animaux. Taxe de séjour 1,10 € par personne. Départ avant 11h00.</p>");
    assert.equal(fr['pets.dogsAllowed'], false);
    assert.equal(fr['fees.touristTaxPerPersonPerNight'], 1.1);
    assert.equal(fr['checkout.until'], '11:00');
  });
});

describe('currencies', () => {
  it('chooses the usual currency for the country and prices in it', () => {
    assert.equal(currencyForCountry('GB'), 'GBP');
    assert.equal(currencyForCountry('ch'), 'CHF');
    assert.equal(currencyForCountry('IE'), 'EUR');
    const { property: p } = createProperty({ name: 'Lake View', address: { city: 'Keswick', country: 'GB' } });
    assert.equal(p.currency, 'GBP');
    ownerSetFact(p.facts, 'fees.cleaningPerStay', 0);
    ownerSetFact(p.facts, 'fees.touristTaxPerPersonPerNight', 0);
    const unit = createUnit({ name: 'Fell Room', maxGuests: 2, includedGuests: 2, baseRatePerNight: 95 });
    const checkin = addDays(today(), 30);
    const q = withLang('en', () =>
      buildQuote({ id: 'q', property: p, unit, checkin, checkout: addDays(checkin, 1), nights: [checkin], guests: { adults: 2, children: 0, dogs: 0 }, breakfast: false, availability: { unitId: unit.id, status: 'available', certainty: 'synced', checkedAt: '', note: '' } }),
    );
    assert.equal(q.currency, 'GBP');
    assert.match(q.lines[0].basis, /£95\.00/);
  });
});

describe('international installation', () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer({ international: true });
    // A stay in the UK, priced in pounds.
    const { property: p } = createProperty({ name: 'Fellside B&B', slug: 'fellside', address: { city: 'Keswick', region: 'Lake District', country: 'GB' } });
    p.id = 'prop_fellside';
    p.language = 'en';
    p.published = true;
    p.booking = { connector: { kind: 'manual' } };
    for (const [k, v] of Object.entries({ 'fees.cleaningPerStay': 0, 'fees.touristTaxPerPersonPerNight': 0, 'pets.dogsAllowed': true, 'garden.fullyEnclosed': true })) ownerSetFact(p.facts, k, v);
    p.units.push(createUnit({ name: 'Fell Room', maxGuests: 2, includedGuests: 2, baseRatePerNight: 95 }, 'fell'));
    server.store.saveProperty(p);
  });
  after(() => server.close());

  const tool = async (name: string, args: Json) => {
    const res = await fetch(`${server.url}/api/agent/v1/tools/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) });
    return { status: res.status, body: (await res.json()) as Json };
  };

  it('answers agents in English, whatever the language of the host', async () => {
    const checkin = addDays(today(), 40);
    const { body } = await tool('search_stays', { country: 'DE', checkin, checkout: addDays(checkin, 2), guests: { adults: 2, dogs: 1 }, requirements: ['step_free_access'] });
    const hit = body.results.find((r: Json) => r.propertyId === 'prop_schwarzwald');
    assert.ok(hit, 'the accessible Black Forest room is found');
    assert.match(hit.criteria.find((c: Json) => c.requirement === 'step_free_access').detail, /Step-free main entrance: yes/);
    assert.ok(hit.offer.lines.some((l: Json) => l.label === 'Tourist tax'));
    const err = await tool('get_quote', { propertyId: 'prop_ilpoggio', unitId: 'ulivo', checkin: '2020-01-01', checkout: '2020-01-03' });
    assert.equal(err.status, 400);
    assert.match(err.body.error, /in the past/);
  });

  it('returns the description in the guest language when the host wrote one', async () => {
    const { body } = await tool('get_stay_details', { propertyId: 'prop_lavandes', language: 'en' });
    assert.equal(body.descriptionLanguage, 'en');
    assert.match(body.description, /stone farmhouse/);
    assert.deepEqual(body.availableLanguages.sort(), ['de', 'en', 'fr', 'nl']);
    const original = await tool('get_stay_details', { propertyId: 'prop_lavandes' });
    assert.equal(original.body.descriptionLanguage, 'fr');
  });

  it('never compares a budget across currencies', async () => {
    const checkin = addDays(today(), 45);
    const eur = await tool('search_stays', { area: 'Lake District', checkin, checkout: addDays(checkin, 2), guests: { adults: 2 }, maxTotalPrice: 1000 });
    assert.equal(eur.body.results.length, 0);
    assert.match(eur.body.excluded[0].reason, /Priced in GBP; the budget is in EUR/);
    const gbp = await tool('search_stays', { area: 'Lake District', checkin, checkout: addDays(checkin, 2), guests: { adults: 2 }, maxTotalPrice: 1000, currency: 'GBP' });
    assert.equal(gbp.body.results[0].offer.currency, 'GBP');
    assert.equal(gbp.body.results[0].offer.total, 190);
    assert.match(gbp.body.results[0].offer.summaryForGuest, /£190 in total/);
  });

  it('shows the stay page in the browser language, with hreflang and a language switch', async () => {
    const html = await (await fetch(`${server.url}/verblijf/schwarzwaldhang`, { headers: { 'accept-language': 'en-GB,en;q=0.9' } })).text();
    assert.match(html, /<html lang="en">/);
    assert.match(html, /Small guesthouse at the edge of the forest/, 'English translation of the German description');
    assert.match(html, /Request availability/);
    assert.match(html, /hreflang="de"/);
    const de = await (await fetch(`${server.url}/verblijf/schwarzwaldhang`, { headers: { 'accept-language': 'de' } })).text();
    assert.match(de, /Kleines Gästehaus am Waldrand/, 'the original description in its own language');
    assert.match(de, /Verfügbarkeit anfragen/);
    const alias = await fetch(`${server.url}/stay/fellside?lang=en`, { redirect: 'manual' });
    assert.equal(alias.status, 308);
    assert.equal(alias.headers.get('location'), '/verblijf/fellside?lang=en', 'English address for the same page');
    const fr = await fetch(`${server.url}/verblijf/fellside?lang=fr`);
    assert.match(fr.headers.get('set-cookie') ?? '', /innli_lang=fr/);
    const frHtml = await fr.text();
    assert.match(frHtml, /Demander la disponibilité/);
    assert.match(frHtml, /95,00\s£/, 'pounds, formatted the French way');
  });

  it('mails the guest in their language and the host in theirs', async () => {
    server.mailer.sent.length = 0;
    const checkin = addDays(today(), 50);
    const form = new URLSearchParams({ unitId: 'fell', checkin, checkout: addDays(checkin, 2), adults: '2', name: 'Lena Fischer', email: 'lena@example.com' });
    const res = await fetch(`${server.url}/verblijf/fellside/aanvraag?lang=de`, { method: 'POST', body: form, redirect: 'manual' });
    assert.equal(res.status, 303);
    const request = server.store.allRequests().find((r) => r.guest.email === 'lena@example.com')!;
    assert.equal(request.language, 'de');
    const guestMail = server.mailer.sent.find((m) => m.to === 'lena@example.com')!;
    assert.match(guestMail.subject, /Ihre Anfrage bei Fellside B&B ist eingegangen/);
    assert.match(guestMail.text, /Gesamtpreis: 190\s£/);
    const status = await (await fetch(`${server.url}${res.headers.get('location')}`)).text();
    assert.match(status, /Anfrage eingegangen/, 'status page follows the guest language');
  });

  it('gives the owner dashboard API, fact catalog and website check in English on request', async () => {
    const catalog = (await (await fetch(`${server.url}/api/fact-catalog?lang=en`)).json()) as Json[];
    const dogs = catalog.find((d) => d.key === 'pets.dogsAllowed')!;
    assert.equal(dogs.label, 'Dogs allowed');
    assert.equal(dogs.category, 'Pets');
    const key = ownerKey(server, 'prop_ilpoggio');
    const ins = (await (await fetch(`${server.url}/api/owner/insights`, { headers: { authorization: `Bearer ${key}`, 'x-innli-lang': 'en' } })).json()) as Json;
    assert.ok(ins.searchesInYourArea > 0, 'sample history is there');
    assert.ok(ins.mostAskedFor.every((x: Json) => !/Hond mee|Ontbijt/.test(x.label)));
    const prop = (await (await fetch(`${server.url}/api/owner/property`, { headers: { authorization: `Bearer ${key}`, 'x-innli-lang': 'en' } })).json()) as Json;
    assert.ok(prop.completeness.unknownCritical.some((x: string) => /door width/.test(x)));
    const lic = (await (await fetch(`${server.url}/api/owner/license`, { headers: { authorization: `Bearer ${key}`, 'x-innli-lang': 'en' } })).json()) as Json;
    assert.doesNotMatch(lic.title, /versie|Proef/i);
  });

  it('lists verified reviews and published FAQ in the sample data', async () => {
    const { body } = await tool('get_stay_details', { propertyId: 'prop_ilpoggio' });
    assert.equal(body.reviews.count, 3);
    assert.equal(body.faq[0].question, 'Can we charge an electric car at the farm?');
  });
});
