import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ownerSetFact } from '../src/domain/facts.ts';
import { createProperty } from '../src/properties.ts';
import { auditWebsite } from '../src/readiness/audit.ts';
import { extractFromHtml } from '../src/readiness/extract.ts';
import { buildJsonLd } from '../src/readiness/jsonld.ts';
import { isAllowed, parseRobots } from '../src/readiness/robots.ts';

describe('robots.txt', () => {
  const robots = parseRobots(`
User-agent: *
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php

User-agent: GPTBot
User-agent: CCBot
Disallow: /

User-agent: OAI-SearchBot
Disallow: /kamers
Allow: /kamers/tuinkamer$

Sitemap: https://b.example/wp-sitemap.xml
`);

  it('applies the specific group, falling back to *', () => {
    assert.equal(isAllowed(robots, 'GPTBot', '/').allowed, false);
    assert.equal(isAllowed(robots, 'CCBot', '/').allowed, false);
    assert.equal(isAllowed(robots, 'ClaudeBot', '/').allowed, true);
    assert.equal(isAllowed(robots, 'ClaudeBot', '/wp-admin/x').allowed, false);
    assert.equal(isAllowed(robots, 'ClaudeBot', '/wp-admin/admin-ajax.php').allowed, true);
    // OAI-SearchBot has its own group, so the * rules do not apply to it.
    assert.equal(isAllowed(robots, 'OAI-SearchBot', '/wp-admin/x').allowed, true);
  });

  it('uses the longest match and honours $', () => {
    assert.equal(isAllowed(robots, 'OAI-SearchBot', '/kamers/zolder').allowed, false);
    assert.equal(isAllowed(robots, 'OAI-SearchBot', '/kamers/tuinkamer').allowed, true);
    assert.equal(isAllowed(robots, 'OAI-SearchBot', '/kamers/tuinkamer/foto').allowed, false);
  });

  it('collects sitemaps', () => {
    assert.deepEqual(robots.sitemaps, ['https://b.example/wp-sitemap.xml']);
  });
});

const SITE = `<!doctype html><html lang="nl"><head><title>B&amp;B De Hooiberg – Ede</title>
<meta name="description" content="Kleinschalige B&B op de Veluwe">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BedAndBreakfast","name":"B&B De Hooiberg","petsAllowed":false}</script>
</head><body>
<h1>B&amp;B De Hooiberg</h1>
<nav><a href="/kamers/tuinkamer">Tuinkamer</a><a href="/voorwaarden">Voorwaarden</a></nav>
<p>Honden zijn van harte welkom (maximaal twee honden), € 7,50 per hond per nacht.</p>
<p>Onze grote omheinde tuin ligt aan de heide. Inclusief ontbijt, geserveerd van 8:00 tot 10:00.</p>
<p>Inchecken vanaf 15:00, uitchecken voor 11.00 uur. Toeristenbelasting € 2,15 p.p.p.n.</p>
<p>De tuinkamer ligt op de begane grond en heeft bedden van 210 cm lang en een inloopdouche.</p>
<p>Kosteloos annuleren tot 7 dagen voor aankomst. Prijzen vanaf €115 per nacht.</p>
<p>Heideweg 12, 6718 AB Ede</p>
<script>var hidden = "geen honden";</script>
</body></html>`;

describe('website extraction', () => {
  it('drafts facts from Dutch website text, with evidence', () => {
    const { suggestions, unitHints } = extractFromHtml(SITE);
    const get = (k: string) => suggestions.find((s) => s.key === k)?.value;
    assert.equal(get('pets.dogsAllowed'), true, 'script content is not visible text');
    assert.equal(get('pets.maxDogs'), 2);
    assert.equal(get('pets.feePerDogPerNight'), 7.5);
    assert.equal(get('garden.fullyEnclosed'), true);
    assert.equal(get('breakfast.included'), true);
    assert.equal(get('breakfast.pricePerPerson'), undefined);
    assert.equal(get('breakfast.times'), '08:00-10:00');
    assert.equal(get('checkin.from'), '15:00');
    assert.equal(get('checkout.until'), '11:00');
    assert.equal(get('fees.touristTaxPerPersonPerNight'), 2.15);
    assert.match(String(get('policy.cancellation')), /Kosteloos annuleren/);
    assert.ok(suggestions.every((s) => s.evidence.length > 0));
    assert.deepEqual(new Set(unitHints.map((h) => h.topic)), new Set(['ground_floor', 'bed_length', 'walk_in_shower']));
    assert.equal(unitHints.find((h) => h.topic === 'bed_length')?.value, 210);
  });

  it('recognises an explicit no-pets policy', () => {
    const { suggestions } = extractFromHtml('<p>Helaas geen huisdieren. Max. 2 honden € 5 per hond per nacht</p>');
    assert.equal(suggestions.find((s) => s.key === 'pets.dogsAllowed')?.value, false);
    assert.equal(suggestions.find((s) => s.key === 'pets.feePerDogPerNight'), undefined);
  });
});

describe('website audit', () => {
  const fetcher = (robots: string, html = SITE) => async (url: string) => {
    const path = new URL(url).pathname;
    if (path === '/robots.txt') return new Response(robots);
    if (path === '/') return new Response(html, { headers: { 'content-type': 'text/html' } });
    return new Response('not found', { status: 404 });
  };

  it('separates blocked search crawlers (fail) from blocked training crawlers (info)', async () => {
    const report = await auditWebsite('https://hooiberg.example/', null, fetcher('User-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /\n'));
    const search = report.checks.find((c) => c.id === 'robots.search')!;
    const training = report.checks.find((c) => c.id === 'robots.training')!;
    assert.equal(search.status, 'fail');
    assert.match(search.detail, /OAI-SearchBot/);
    assert.equal(training.status, 'info');
    assert.match(training.detail, /GPTBot/);
    assert.equal(report.crawlers.find((c) => c.userAgent === 'Claude-SearchBot')?.allowed, true);
    assert.match(report.disclaimer, /nooit gegarandeerd/);
  });

  it('detects noindex and contradictions with the passport', async () => {
    const { property } = createProperty({ name: 'B&B De Hooiberg', address: { city: 'Ede', postalCode: '6718 AB', country: 'NL' } });
    ownerSetFact(property.facts, 'pets.dogsAllowed', true);
    const html = SITE.replace('<head>', '<head><meta name="robots" content="noindex,follow">');
    const report = await auditWebsite('https://hooiberg.example/', property, fetcher('', html));
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c.status]));
    assert.equal(byId['page.noindex'], 'fail');
    assert.equal(byId['sd.lodging'], 'pass');
    assert.equal(byId['sd.pets'], 'fail', 'JSON-LD says petsAllowed=false, owner confirmed dogs');
    assert.equal(byId['consistency.name'], 'pass');
    assert.equal(byId['consistency.address'], 'pass');
    assert.equal(byId['content.rooms'], 'pass');
    assert.equal(byId['robots.search'], 'pass');
  });

  it('JSON-LD only contains confirmed facts', () => {
    const { property } = createProperty({ name: 'X', address: { city: 'Ede', country: 'NL' } });
    ownerSetFact(property.facts, 'checkin.from', '15:00');
    property.facts['pets.dogsAllowed'] = { value: true, status: 'unconfirmed', updatedAt: '' };
    const ld = buildJsonLd(property);
    assert.equal(ld.checkinTime, '15:00');
    assert.equal(ld.petsAllowed, undefined);
  });
});
