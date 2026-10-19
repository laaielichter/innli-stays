import { createHash } from 'node:crypto';
import express, { type Router } from 'express';
import { recordConversion } from '../booking/conversions.ts';
import { addDays, isWeekendNight, stayNights } from '../domain/dates.ts';
import type { Store } from '../store.ts';
import { VERIFICATION_META } from '../agent/trust.ts';

/**
 * A fake booking system for demos and tests. It implements the INNLI live
 * availability contract (docs/connector-contract.md), serves iCal feeds, and
 * offers a booking page that reports confirmed bookings back to INNLI the way
 * a real booking system or the WordPress plugin would.
 */

export const DEMO_RATES: Record<string, number> = {
  'hooiberg-tuinkamer': 115,
  'hooiberg-zolder': 95,
  'kraaiennest-bos': 105,
  'duinzicht-1': 89,
  'duinzicht-2': 99,
  'poggio-ulivo': 140,
  'poggio-vigna': 120,
  'poggio-torre': 190,
  'alpenblick-1': 110,
  'alpenblick-2': 130,
  'alpenblick-3': 160,
};

export function isBooked(unit: string, night: string): boolean {
  const h = createHash('sha256').update(`${unit}:${night}`).digest();
  return h[0] % 6 === 0;
}

/** Fictional property websites, so website import and the readiness audit can be tried in the demo. */
const DEMO_SITES: Record<string, { title: string; body: string }> = {
  hooiberg: {
    title: 'B&B De Hooiberg – Ede, Veluwe',
    body: `<h1>B&amp;B De Hooiberg</h1>
<nav><a href="kamers/tuinkamer">Tuinkamer</a> <a href="kamers/zolderkamer">Zolderkamer</a> <a href="voorwaarden">Voorwaarden</a></nav>
<p>Kleinschalige B&amp;B in een verbouwde hooiberg aan de rand van de Veluwe.</p>
<p>Honden zijn van harte welkom (maximaal twee honden), € 7,50 per hond per nacht. Onze grote omheinde tuin grenst aan de heide.</p>
<p>Inclusief ontbijt met streekproducten, geserveerd van 8:00 tot 10:00.</p>
<p>De tuinkamer ligt op de begane grond, met bedden van 210 cm lang en een inloopdouche.</p>
<p>Inchecken vanaf 15:00, uitchecken voor 11:00. Toeristenbelasting € 2,15 per persoon per nacht. Kosteloos annuleren tot 7 dagen voor aankomst.</p>
<p>Kamers vanaf € 95 per nacht. Gratis parkeren op eigen terrein.</p>
<footer>Heideweg 12, 6718 AB Ede</footer>`,
  },
  kraaiennest: {
    title: 'Logies Het Kraaiennest – Otterlo',
    body: `<h1>Logies Het Kraaiennest</h1>
<nav><a href="kamers/boskamer">Boskamer</a></nav>
<p>Houten logeerhuis midden in het bos bij Otterlo. Hondvriendelijk: max. 1 hond, € 10 per hond per nacht.</p>
<p>Grote omheinde tuin aan de bosrand. Parkeren op eigen terrein.</p>
<p>Ontbijt op aanvraag, € 14,50 per persoon. Schoonmaakkosten € 35 per verblijf. Minimaal 2 nachten.</p>
<p>De boskamer ligt gelijkvloers en heeft een eigen badkamer.</p>
<p>Annuleren kan kosteloos tot 14 dagen voor aankomst.</p>`,
  },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function demoEngine(store: Store): Router {
  const r = express.Router();

  // A small stand-in for the Beds24 API V2 (refresh token → token → calendar in ranges), for the demo and tests.
  const BEDS24_REFRESH = 'demo-beds24-refresh-token';
  const beds24Tokens = new Set<string>();
  r.get('/beds24/v2/authentication/token', (req, res) => {
    if (req.headers.refreshtoken !== BEDS24_REFRESH) {
      res.status(401).json({ success: false, error: 'Token not valid' });
      return;
    }
    const token = `b24_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    beds24Tokens.add(token);
    res.json({ token, expiresIn: 86400 });
  });
  r.get('/beds24/v2/inventory/rooms/calendar', (req, res) => {
    if (!beds24Tokens.has(String(req.headers.token ?? ''))) {
      res.status(401).json({ success: false, error: 'Token not valid' });
      return;
    }
    const roomId = String(req.query.roomId ?? '');
    const start = String(req.query.startDate ?? '');
    const end = String(req.query.endDate ?? '');
    // Room 501: a type with 3 units; 502: a single room. Both have a 2-night minimum on Saturdays.
    const units = roomId === '501' ? 3 : roomId === '502' ? 1 : 0;
    if (!units || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      res.json({ success: true, data: [] });
      return;
    }
    const calendar: { from: string; to: string; numAvail: number; price1: number; minStay: number }[] = [];
    for (const night of stayNights(start, addDays(end, 1), 400)) {
      const numAvail = isBooked(`b24-${roomId}`, night) ? 0 : units;
      const price1 = (roomId === '501' ? 105 : 140) + (isWeekendNight(night) ? 20 : 0);
      const minStay = new Date(`${night}T00:00:00Z`).getUTCDay() === 6 ? 2 : 1;
      const last = calendar[calendar.length - 1];
      if (last && last.numAvail === numAvail && last.price1 === price1 && last.minStay === minStay && addDays(last.to, 1) === night) last.to = night;
      else calendar.push({ from: night, to: night, numAvail, price1, minStay });
    }
    res.json({ success: true, type: 'calendar', count: 1, data: [{ roomId: Number(roomId), calendar }] });
  });

  r.get('/availability', (req, res) => {
    const unit = String(req.query.unit ?? '');
    const rate = DEMO_RATES[unit];
    if (!rate) {
      res.status(404).json({ error: 'unknown unit' });
      return;
    }
    let nights: string[];
    try {
      nights = stayNights(String(req.query.checkin), String(req.query.checkout));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    const available = !nights.some((n) => isBooked(unit, n));
    res.json({
      unit,
      available,
      currency: 'EUR',
      nightly: available ? nights.map((date) => ({ date, amount: isWeekendNight(date) ? Math.round(rate * 1.2) : rate })) : [],
    });
  });

  r.get('/calendar/:unit.ics', (req, res) => {
    const unit = req.params.unit;
    const today = new Date().toISOString().slice(0, 10);
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//INNLI//Demo//NL'];
    for (let i = 0; i < 180; i++) {
      const night = addDays(today, i);
      if (!isBooked(unit, night)) continue;
      lines.push('BEGIN:VEVENT', `UID:${unit}-${night}@demo.innli`, `DTSTART;VALUE=DATE:${night.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(night, 1).replace(/-/g, '')}`, 'SUMMARY:Reserved', 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    res.type('text/calendar').send(lines.join('\r\n'));
  });

  r.get('/site/:slug', (req, res) => {
    const site = DEMO_SITES[req.params.slug];
    if (!site) {
      res.status(404).send('Niet gevonden');
      return;
    }
    // Like the WordPress plugin: the owner's verification token on their own site.
    const owner = store.listProperties().find((p) => p.website?.endsWith(`/site/${req.params.slug}`) && p.websiteVerification);
    const meta = owner ? `<meta name="${VERIFICATION_META}" content="${owner.websiteVerification!.token}">` : '';
    res.type('html').send(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${site.title}</title><meta name="description" content="Demo-website van een fictieve accommodatie">${meta}</head><body>${site.body}</body></html>`);
  });

  r.get('/book', (req, res) => {
    const q = Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, esc(String(v ?? ''))]));
    res.type('html').send(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Demo boekingsomgeving</title>
<style>body{font:16px system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;color:#1f2a24}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px}button{font:inherit;padding:10px 18px;border:0;border-radius:8px;background:#2f6b4f;color:#fff;cursor:pointer}.note{color:#666;font-size:14px}</style></head><body>
<p class="note">Dit is een gesimuleerd boekingssysteem van de accommodatie.</p>
<h1>Boeking afronden</h1>
<dl><dt>Accommodatie</dt><dd>${q.property}</dd><dt>Kamer</dt><dd>${q.unit}</dd><dt>Aankomst</dt><dd>${q.checkin}</dd><dt>Vertrek</dt><dd>${q.checkout}</dd><dt>Volwassenen</dt><dd>${q.adults}</dd><dt>Kinderen</dt><dd>${q.children}</dd><dt>Honden</dt><dd>${q.dogs}</dd></dl>
<form method="post"><input type="hidden" name="property" value="${q.property}"><input type="hidden" name="ref" value="${q.ref}"><label>Totaalbedrag (€) <input name="amount" type="number" step="0.01" value="0"></label><br><br><button>Boeking bevestigen</button></form>
</body></html>`);
  });

  r.post('/book', express.urlencoded({ extended: false }), (req, res) => {
    const property = store.getProperty(String(req.body.property ?? ''));
    if (!property) {
      res.status(404).send('Onbekende accommodatie');
      return;
    }
    const bookingReference = `DEMO-${Date.now().toString(36).toUpperCase()}`;
    try {
      recordConversion(store, { ref: String(req.body.ref ?? ''), bookingReference, amount: Number(req.body.amount) || undefined }, property.id);
    } catch (err) {
      res.status(400).send(esc((err as Error).message));
      return;
    }
    res.type('html').send(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Bevestigd</title></head><body style="font:16px system-ui;max-width:560px;margin:40px auto"><h1>Boeking bevestigd (demo)</h1><p>Referentie ${bookingReference}. Het boekingssysteem heeft deze boeking aan INNLI teruggemeld.</p></body></html>`);
  });

  return r;
}
