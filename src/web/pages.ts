import type { NightState } from '../connectors/availability.ts';
import { readFact } from '../domain/facts.ts';
import { REVIEW_ASPECTS, type BookingRequest, type Property, type Unit } from '../domain/types.ts';
import { timeZoneOf } from '../requests/service.ts';
import { MEDIA_URL } from '../http/media.ts';
import { buildJsonLd, publicFacts } from '../readiness/jsonld.ts';
import { currentLang, formatDate, LANG_NAMES, LANGS, LOCALE, money, t, type Lang } from '../i18n/index.ts';

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const longDate = (d: string, lang: Lang) => formatDate(d, lang, { day: 'numeric', month: 'long', year: 'numeric' });

const CSS = `
:root{--bg:#f6f4ef;--card:#fff;--ink:#1f2a24;--muted:#66706a;--line:#e3e0d8;--brand:#2f6b4f;--brand-ink:#fff;--ok:#e5f3ea;--busy:#e3e0d8;--bad:#a3322a;--bad-bg:#fbe5e3}
@media (prefers-color-scheme:dark){:root{--bg:#141816;--card:#1d2320;--ink:#e8ece9;--muted:#9aa49e;--line:#2f3833;--brand:#5fae86;--brand-ink:#0d1a13;--ok:#1e3327;--busy:#2f3833;--bad:#f2948c;--bad-bg:#3d2120}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px 64px}h1{font-size:30px;line-height:1.2;margin:4px 0 6px}h2{font-size:21px;margin:0 0 12px}h3{font-size:17px;margin:0 0 6px}
.muted{color:var(--muted)}.small{font-size:14px}.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin:16px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
dl.facts{display:grid;grid-template-columns:minmax(140px,1fr) 2fr;gap:6px 16px;margin:0}dl.facts dt{color:var(--muted)}dl.facts dd{margin:0}
.room{border:1px solid var(--line);border-radius:12px;padding:16px}.price{font-weight:700}
.cal{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin-top:10px}.m{font-size:13px}.m b{display:block;text-transform:capitalize;margin-bottom:4px}
.d{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}.d span{aspect-ratio:1;display:grid;place-items:center;border-radius:5px;font-size:12px}.d .f{background:var(--ok)}.d .b{background:var(--busy);color:var(--muted);text-decoration:line-through}.d .h{color:var(--muted);font-size:10px}
form .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}label{display:grid;gap:4px;font-size:14px;color:var(--muted);margin-bottom:12px}
input,select,textarea{font:inherit;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:9px 10px;width:100%}
.check{display:flex;gap:8px;align-items:center;color:var(--ink)}.check input{width:auto}
.extras{border:1px solid var(--line);border-radius:10px;padding:6px 12px 10px;margin:10px 0}.extras legend{font-size:14px;padding:0 4px}.extras .check{margin:4px 0}.extras select{width:auto}
button{font:inherit;font-weight:600;padding:12px 20px;border:0;border-radius:10px;background:var(--brand);color:var(--brand-ink);cursor:pointer}
.offer{background:var(--bg);border-radius:10px;padding:12px 14px;margin:8px 0 16px;font-size:15px}.offer table{width:100%;border-collapse:collapse}.offer td{padding:3px 0}.offer td:last-child{text-align:right}.offer .t td{border-top:1px solid var(--line);font-weight:700;padding-top:6px}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin:12px 0}.gallery figure{margin:0}.gallery img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;background:var(--line)}.gallery figcaption{font-size:13px;color:var(--muted)}
.review{border-top:1px solid var(--line);padding-top:8px;margin-top:8px}.stars{color:#c58b00;letter-spacing:1px}
.rating{display:flex;flex-direction:row-reverse;justify-content:flex-end;gap:4px}.rating input{display:none}.rating label{font-size:32px;color:var(--line);cursor:pointer;margin:0}.rating input:checked~label,.rating label:hover,.rating label:hover~label{color:#c58b00}
.err{background:var(--bad-bg);color:var(--bad);padding:10px 14px;border-radius:10px}.hp{position:absolute;left:-5000px}
.status{font-size:20px;font-weight:700}.foot{margin-top:32px;font-size:13px;color:var(--muted);text-align:center}
.langs{display:flex;gap:10px;justify-content:flex-end;font-size:13px;margin-bottom:4px}.langs a{color:var(--muted)}.langs a[aria-current]{color:var(--ink);font-weight:700;text-decoration:none}
@media (max-width:600px){dl.facts{grid-template-columns:1fr}h1{font-size:26px}}`;

export interface LayoutOptions {
  jsonLd?: unknown;
  embed?: boolean;
  description?: string;
  lang?: Lang;
  /** Absolute URL of this page without ?lang=, to offer the other languages (and hreflang for search engines). */
  url?: string;
}

const withLang = (url: string, l: Lang) => `${url}${url.includes('?') ? '&' : '?'}lang=${l}`;

export function layout(title: string, body: string, opts: LayoutOptions = {}): string {
  const lang = opts.lang ?? currentLang();
  const alternates = opts.url ? `${LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(withLang(opts.url!, l))}">`).join('')}<link rel="alternate" hreflang="x-default" href="${esc(opts.url)}">` : '';
  const switcher = opts.url && !opts.embed ? `<nav class="langs" aria-label="${esc(t('pg.language', {}, lang))}">${LANGS.map((l) => `<a href="${esc(withLang(opts.url!, l))}" hreflang="${l}" lang="${l}"${l === lang ? ' aria-current="true"' : ''}>${LANG_NAMES[l]}</a>`).join('')}</nav>` : '';
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${opts.description ? `<meta name="description" content="${esc(opts.description.slice(0, 160))}">` : ''}${alternates}
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}">${opts.description ? `<meta property="og:description" content="${esc(opts.description.slice(0, 200))}">` : ''}
<style>${CSS}${opts.embed ? 'main{padding:8px}' : ''}</style>
${opts.jsonLd ? `<script type="application/ld+json">${JSON.stringify(opts.jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head><body><main>${switcher}${body}${opts.embed ? '' : `<p class="foot">${esc(t('pg.foot', {}, lang))}</p>`}</main>${opts.embed ? `<script>(function(){function h(){parent.postMessage({innli:'height',height:Math.ceil(document.querySelector('main').getBoundingClientRect().bottom)+16},'*')}if(parent!==window){new ResizeObserver(h).observe(document.querySelector('main'));addEventListener('load',h)}})();</script>` : ''}</body></html>`;
}

function fromPrice(unit: Unit): number {
  return Math.min(unit.baseRatePerNight, ...(unit.rates?.seasons ?? []).map((s) => s.ratePerNight));
}

function miniCalendar(nights: { date: string; state: NightState }[], lang: Lang): string {
  const months = new Map<string, { date: string; state: NightState }[]>();
  for (const n of nights) {
    const k = n.date.slice(0, 7);
    if (!months.has(k)) months.set(k, []);
    months.get(k)!.push(n);
  }
  return `<div class="cal">${[...months.values()]
    .map((ns) => {
      const first = new Date(`${ns[0].date}T00:00:00Z`);
      const offset = (first.getUTCDay() + 6) % 7;
      const title = first.toLocaleDateString(LOCALE[lang], { month: 'long', year: 'numeric', timeZone: 'UTC' });
      return `<div class="m"><b>${esc(title)}</b><div class="d">${t('pg.weekdays', {}, lang).split(',').map((d) => `<span class="h">${esc(d)}</span>`).join('')}${'<span></span>'.repeat(offset)}${ns
        .map((n) => `<span class="${n.state === 'open' || n.state === 'held' ? 'f' : 'b'}" title="${n.date}">${Number(n.date.slice(8))}</span>`)
        .join('')}</div></div>`;
    })
    .join('')}</div>`;
}

export interface FormValues {
  unitId?: string;
  checkin?: string;
  checkout?: string;
  adults?: string | number;
  children?: string | number;
  dogs?: string | number;
  breakfast?: boolean;
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
  ref?: string;
  rooms?: string | number;
  ratePlanId?: string;
  /** Chosen paid options: id → quantity. */
  extras?: Record<string, number>;
  discountCode?: string;
}

export interface OfferView {
  currency: string;
  lines: { label: string; amount: number; basis: string }[];
  total: number;
  complete: boolean;
  available: string;
  note: string;
  warnings: string[];
}

export function offerHtml(o: OfferView, lang: Lang = currentLang()): string {
  const m = (n: number) => money(n, lang, o.currency);
  const indicative = t('price.indicative', {}, lang);
  return `<div class="offer"><table>${o.lines.map((l) => `<tr><td>${esc(l.label)}<br><span class="muted small">${esc(l.basis)}</span></td><td>${m(l.amount)}</td></tr>`).join('')}
<tr class="t"><td>${esc(t('pg.total', {}, lang))}${o.complete ? '' : esc(t('sum.incomplete', {}, lang))}</td><td>${m(o.total)}</td></tr></table>
<p class="small muted" style="margin:8px 0 0">${esc(o.note)}</p>${o.warnings.filter((w) => w !== indicative).map((w) => `<p class="small" style="margin:4px 0 0">⚠ ${esc(w)}</p>`).join('')}</div>`;
}

export interface ReviewSummary {
  count: number;
  average?: number;
  aspects?: Partial<Record<string, { average: number; count: number }>>;
  recent?: { rating: number; text?: string; month: string; ownerReply?: string }[];
}

const stars = (n: number) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));

/** The owner's description in the reader's language when they wrote one. */
export function descriptionIn(property: Property, lang: Lang): string {
  if (lang === (property.language ?? 'nl')) return property.description;
  return property.translations?.[lang]?.description || property.description;
}

const km = (n: number, lang: Lang) => new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 1 }).format(n);

export function stayPage(
  property: Property,
  opts: { calendars: Map<string, { date: string; state: NightState }[]>; values?: FormValues; offer?: OfferView | null; error?: string; embed?: boolean; basePath: string; reviews?: ReviewSummary; lang?: Lang; publicUrl?: string },
): string {
  const lang = opts.lang ?? currentLang();
  const tr = (key: Parameters<typeof t>[0], params: Parameters<typeof t>[1] = {}) => esc(t(key, params, lang));
  const m = (n: number) => money(n, lang, property.currency);
  const v = opts.values ?? {};
  const facts = publicFacts(property.facts, 'property', property.currency, lang);
  const dogsAllowed = readFact(property.facts, 'pets.dogsAllowed').value === true;
  const breakfastIncluded = readFact(property.facts, 'breakfast.included').value === true;
  const breakfastAvailable = breakfastIncluded || readFact(property.facts, 'breakfast.available').value === true;
  const place = [property.address.city, property.address.region].filter(Boolean).join(', ');
  const today = new Date().toISOString().slice(0, 10);

  const rooms = property.units
    .map((u) => {
      const uf = publicFacts(u.facts, 'unit', property.currency, lang).slice(0, 6);
      const cal = opts.calendars.get(u.id);
      return `<div class="room"><h3>${esc(u.name)}</h3>${u.description ? `<p class="small">${esc(u.description)}</p>` : ''}
<p class="small muted">${tr('pg.roomMax', { n: u.maxGuests, price: '\u0000' }).replace('\u0000', `<span class="price">${m(fromPrice(u))}</span>`)}</p>
${uf.length ? `<dl class="facts small">${uf.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.display)}</dd>`).join('')}</dl>` : ''}
${cal ? `<details><summary class="small">${tr('pg.availability')}</summary>${miniCalendar(cal, lang)}<p class="small muted">${tr('pg.calLegend')}</p></details>` : ''}</div>`;
    })
    .join('');

  // Hotels: several identical rooms per type, and rate plans next to the standard rate.
  const maxRooms = Math.min(10, Math.max(1, ...property.units.map((u) => u.inventory ?? 1)));
  const roomChoice = maxRooms > 1 ? `<label>${tr('pg.roomsCount')}<select name="rooms">${Array.from({ length: maxRooms }, (_, i) => `<option value="${i + 1}"${Number(v.rooms ?? 1) === i + 1 ? ' selected' : ''}>${i + 1}</option>`).join('')}</select></label>` : '';
  const planChoice = property.ratePlans?.length
    ? `<label>${tr('pg.ratePlan')}<select name="ratePlanId"><option value="">${tr('pg.ratePlanStandard')}</option>${property.ratePlans.map((rp) => `<option value="${esc(rp.id)}"${v.ratePlanId === rp.id ? ' selected' : ''}>${esc(rp.name)}${rp.refundable ? '' : ` (${tr('pg.nonRefundable')})`}</option>`).join('')}</select></label>`
    : '';
  const extrasChoice = property.extras?.length
    ? `<fieldset class="extras"><legend>${tr('pg.extras')}</legend>${property.extras
        .map((x) => {
          const chosen = v.extras?.[x.id] ?? 0;
          const price = `${m(x.price)} ${esc(t(`extra.per.${x.per}` as Parameters<typeof t>[0], { amount: '' }, lang).trim())}`;
          const control = (x.max ?? 1) > 1
            ? `<select name="extra_${esc(x.id)}">${Array.from({ length: (x.max ?? 1) + 1 }, (_, i) => `<option value="${i}"${chosen === i ? ' selected' : ''}>${i}</option>`).join('')}</select>`
            : `<input type="checkbox" name="extra_${esc(x.id)}" value="1"${chosen ? ' checked' : ''}>`;
          return `<label class="check">${control} ${esc(x.name)} <span class="small muted">${x.price > 0 ? price : esc(t('pg.free', {}, lang))}</span></label>`;
        })
        .join('')}</fieldset>`
    : '';
  const ask = `<div class="card" id="vraag"><h2>${tr('pg.askTitle')}</h2><p class="small muted">${tr('pg.askIntro', { property: property.name })}</p>
<form id="ask" class="row"><label style="flex:3">${tr('pg.askTitle')}<input name="q" maxlength="300" placeholder="${tr('pg.askPlaceholder')}" required></label><button style="align-self:end">${tr('pg.askButton')}</button></form><div id="answer" aria-live="polite"></div></div>
<script>
(function(){var f=document.getElementById('ask'),a=document.getElementById('answer');f.addEventListener('submit',function(e){e.preventDefault();var q=new URLSearchParams({q:f.q.value,lang:${JSON.stringify(lang)}});
fetch(${JSON.stringify(opts.basePath)}+'/vraag?'+q).then(function(r){return r.text()}).then(function(h){a.innerHTML=h}).catch(function(){})});})();
</script>`;

  const form = `<div class="card" id="aanvragen"><h2>${tr('pg.formTitle')}</h2>
<p class="small muted">${tr('pg.formIntro', { property: property.name })}</p>
${opts.error ? `<p class="err">${esc(opts.error)}</p>` : ''}
<form method="post" action="${esc(opts.basePath)}/aanvraag?lang=${lang}${opts.embed ? '&amp;embed=1' : ''}" id="req">
<div class="row">
<label>${tr('pg.room')}<select name="unitId" required>${property.units.map((u) => `<option value="${esc(u.id)}"${v.unitId === u.id ? ' selected' : ''}>${esc(u.name)} (max. ${u.maxGuests})</option>`).join('')}</select></label>
<label>${tr('pg.checkin')}<input type="date" name="checkin" min="${today}" value="${esc(v.checkin)}" required></label>
<label>${tr('pg.checkout')}<input type="date" name="checkout" min="${today}" value="${esc(v.checkout)}" required></label>
</div><div class="row">
<label>${tr('pg.adults')}<input type="number" name="adults" min="1" max="20" value="${esc(v.adults ?? 2)}" required></label>
<label>${tr('pg.children')}<input type="number" name="children" min="0" max="20" value="${esc(v.children ?? 0)}"></label>
${dogsAllowed ? `<label>${tr('pg.dogs')}<input type="number" name="dogs" min="0" max="5" value="${esc(v.dogs ?? 0)}"></label>` : '<input type="hidden" name="dogs" value="0">'}
</div>
${roomChoice || planChoice ? `<div class="row">${roomChoice}${planChoice}</div>` : ''}
${extrasChoice}
${property.discountCodes?.some((c) => c.active) ? `<label>${tr('pg.discountCode')}<input name="discountCode" maxlength="40" autocomplete="off" value="${esc(v.discountCode)}"></label>` : ''}
${breakfastAvailable && !breakfastIncluded ? `<label class="check"><input type="checkbox" name="breakfast" value="1"${v.breakfast ? ' checked' : ''}> ${tr('pg.withBreakfast')}</label>` : ''}
${breakfastIncluded ? `<input type="hidden" name="breakfast" value="1"><p class="small muted">${tr('pg.breakfastIncluded')}</p>` : ''}
<div id="offer">${opts.offer ? offerHtml(opts.offer, lang) : ''}</div>
<div class="row">
<label>${tr('pg.name')}<input name="name" autocomplete="name" value="${esc(v.name)}" required></label>
<label>${tr('pg.email')}<input type="email" name="email" autocomplete="email" value="${esc(v.email)}" required></label>
<label>${tr('pg.phone')}<input name="phone" autocomplete="tel" value="${esc(v.phone)}"></label>
</div>
<label>${tr('pg.message')}<textarea name="message" rows="3">${esc(v.message)}</textarea></label>
<label class="hp" aria-hidden="true">${tr('pg.leaveEmpty')}<input name="website" tabindex="-1" autocomplete="off"></label>
<input type="hidden" name="ref" value="${esc(v.ref)}">
<p class="small muted">${tr('pg.privacy')}</p>
<button>${tr('pg.send')}</button>
</form></div>
<script>
(function(){var f=document.getElementById('req'),o=document.getElementById('offer'),t;
function upd(){var d=new FormData(f);if(!d.get('checkin')||!d.get('checkout'))return;var q=new URLSearchParams();['unitId','checkin','checkout','adults','children','dogs','rooms','ratePlanId','discountCode'].forEach(function(k){q.set(k,d.get(k)||'')});d.forEach(function(val,k){if(k.indexOf('extra_')===0&&val&&val!=='0')q.set(k,val)});if(d.get('breakfast'))q.set('breakfast','1');
q.set('lang',${JSON.stringify(lang)});fetch(${JSON.stringify(opts.basePath)}+'/prijs?'+q).then(function(r){return r.text()}).then(function(h){o.innerHTML=h}).catch(function(){})}
f.addEventListener('change',function(){clearTimeout(t);t=setTimeout(upd,250)});
f.checkin.addEventListener('change',function(){f.checkout.min=f.checkin.value});})();
</script>`;

  if (opts.embed) return layout(t('pg.embedTitle', { property: property.name }, lang), form, { embed: true, lang });

  const photos = (property.photos ?? []).filter((ph) => /^https:\/\//.test(ph.url) || MEDIA_URL.test(ph.url)).slice(0, 6);
  const gallery = photos.length ? `<div class="gallery">${photos.map((ph) => `<figure><img src="${esc(ph.url)}" alt="${esc(ph.caption)}" loading="lazy"><figcaption>${esc(ph.caption)}</figcaption></figure>`).join('')}</div>` : '';
  const pois = property.pointsOfInterest ?? [];
  const poiHtml = pois.length ? `<div class="card"><h2>${tr('pg.nearby')}</h2><dl class="facts">${pois.map((x) => `<dt>${tr(`poi.${x.kind}`)}</dt><dd>${esc(x.name)}, ${km(x.distanceKm, lang)} km${x.walkMinutes ? ` ${tr('pg.walk', { n: x.walkMinutes })}` : ''}</dd>`).join('')}</dl></div>` : '';
  const rv = opts.reviews;
  const month = (ym: string) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString(LOCALE[lang], { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const reviewHtml = rv && rv.count ? `<div class="card"><h2>${tr('pg.reviews')} <span class="muted small">${stars(rv.average ?? 0)} ${km(rv.average ?? 0, lang)} · ${rv.count}</span></h2>${rv.aspects ? `<dl class="facts small">${Object.entries(rv.aspects).map(([a, v]) => `<dt>${tr(`rv.aspect.${a}` as Parameters<typeof t>[0])}</dt><dd>${km(v!.average, lang)} / 5</dd>`).join('')}</dl>` : ''}${(rv.recent ?? []).map((x) => `<div class="review"><p><span class="stars">${stars(x.rating)}</span> <span class="muted small">${esc(month(x.month))}</span></p>${x.text ? `<p>${esc(x.text)}</p>` : ''}${x.ownerReply ? `<p class="small muted">${tr('pg.reply', { property: property.name, text: x.ownerReply })}</p>` : ''}</div>`).join('')}<p class="small muted">${tr('pg.reviewsNote')}</p></div>` : '';
  const description = descriptionIn(property, lang);
  const body = `<p class="muted small">${esc(place)}</p><h1>${esc(property.name)}</h1>${gallery}<p>${esc(description)}</p>
<div class="card"><h2>${tr('pg.rooms')}</h2><div class="grid">${rooms}</div></div>
${poiHtml}${reviewHtml}
${facts.length ? `<div class="card"><h2>${tr('pg.goodToKnow')}</h2><dl class="facts">${facts.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.display)}</dd>`).join('')}</dl><p class="small muted">${tr('pg.factsNote')}</p></div>` : ''}
${ask}
${form}`;
  return layout(`${property.name} – ${place}`, body, { jsonLd: buildJsonLd(property), description, lang, url: opts.publicUrl ? `${opts.publicUrl}${opts.basePath}` : undefined });
}

export function statusPage(property: Property, r: BookingRequest, lang: Lang = currentLang()): string {
  const tr = (key: Parameters<typeof t>[0], params: Parameters<typeof t>[1] = {}) => esc(t(key, params, lang));
  const m = (n: number) => money(n, lang, property.currency);
  const title = t(`st.${r.status}.title`, {}, lang);
  const c = (r.terms?.policies as { cancellation?: { value?: unknown } } | undefined)?.cancellation?.value;
  const cancellation = c ? String(c) : '';
  const unit = property.units.find((u) => u.id === r.unitId);
  const party = [t('party.adults', { n: r.guests.adults }, lang), r.guests.children ? t('party.children', { n: r.guests.children }, lang) : '', r.guests.dogs ? t('price.dogs', { n: r.guests.dogs }, lang) : ''].filter(Boolean).join(', ');
  const held = r.holdUntil ? new Date(r.holdUntil).toLocaleString(LOCALE[lang], { dateStyle: 'medium', timeStyle: 'short', timeZone: timeZoneOf(property) }) : '';
  return layout(
    `${title} – ${property.name}`,
    `<p class="muted small">${esc(property.name)}</p><p class="status">${esc(title)}</p><p>${tr(`st.${r.status}.text`)}</p>
${r.status === 'new' && r.holdUntil ? `<p class="small muted">${tr('st.held', { time: held })}</p>` : ''}
${r.ownerNote ? `<div class="card"><h3>${tr('st.message', { property: property.name })}</h3><p>${esc(r.ownerNote)}</p></div>` : ''}
${r.status === 'accepted' && r.payment ? `<div class="card"><h3>${tr('st.deposit')}</h3>${r.payment.status === 'paid' ? `<p>${tr('st.paid')}</p>` : `<p>${tr('st.due', { amount: m(r.payment.amountDue), date: longDate(r.payment.dueDate, lang) })}</p>${r.payment.instructions ? `<p class="small">${esc(r.payment.instructions)}</p>` : ''}${r.payment.paymentUrl && /^https:\/\//.test(r.payment.paymentUrl) ? `<p><a href="${esc(r.payment.paymentUrl)}" rel="noopener">${tr('st.payNow')}</a></p>` : ''}`}</div>` : ''}
<div class="card"><dl class="facts"><dt>${tr('pg.room')}</dt><dd>${(r.rooms ?? 1) > 1 ? `${r.rooms} × ` : ''}${esc(unit?.name ?? r.unitId)}</dd><dt>${tr('pg.checkin')}</dt><dd>${esc(longDate(r.checkin, lang))}</dd><dt>${tr('pg.checkout')}</dt><dd>${esc(longDate(r.checkout, lang))}</dd><dt>${tr('st.guests')}</dt><dd>${esc(party)}${r.breakfast ? tr('sum.withBreakfast') : ''}</dd><dt>${tr('st.total')}</dt><dd>${m(r.quotedTotal)}${r.quoteComplete ? '' : tr('sum.incomplete')}</dd></dl></div>
${(r.status === 'new' || (r.status === 'accepted' && r.checkin > new Date().toISOString().slice(0, 10))) ? `<details class="card"><summary>${r.status === 'new' ? tr('st.withdraw') : tr('st.cancelBooking')}</summary>
${r.status === 'accepted' && cancellation ? `<p class="small">${tr('st.cancelTerms', { policy: cancellation })}</p>` : ''}
<form method="post" action="/aanvraag/${esc(r.publicToken)}/annuleren?lang=${lang}"><label>${tr('st.reason')}<input name="reason" maxlength="500"></label><button>${r.status === 'new' ? tr('st.withdrawBtn') : tr('st.cancelBtn')}</button></form></details>` : ''}
${property.contactEmail ? `<p class="small">${tr('st.questions')} <a href="mailto:${esc(property.contactEmail)}">${esc(property.contactEmail)}</a>.</p>` : ''}`,
    { lang },
  );
}

export function reviewPage(property: Property, r: BookingRequest, opts: { canReview: boolean; error?: string; lang?: Lang }): string {
  const lang = opts.lang ?? currentLang();
  const tr = (key: Parameters<typeof t>[0], params: Parameters<typeof t>[1] = {}) => esc(t(key, params, lang));
  if (r.review) {
    return layout(`${t('rv.thanksTitle', {}, lang)} – ${property.name}`, `<p class="muted small">${esc(property.name)}</p><p class="status">${tr('rv.thanks')}</p><p><span class="stars">${stars(r.review.rating)}</span></p>${r.review.text ? `<p>${esc(r.review.text)}</p>` : ''}`, { lang });
  }
  if (!opts.canReview) {
    return layout(`${t('rv.title', {}, lang)} – ${property.name}`, `<p class="muted small">${esc(property.name)}</p><h1>${tr('rv.notYetTitle')}</h1><p>${tr('rv.notYet')}</p>`, { lang });
  }
  return layout(
    `${t('rv.how', {}, lang)} – ${property.name}`,
    `<p class="muted small">${esc(property.name)} · ${esc(longDate(r.checkin, lang))} – ${esc(longDate(r.checkout, lang))}</p><h1>${tr('rv.how')}</h1>
${opts.error ? `<p class="err">${esc(opts.error)}</p>` : ''}
<form method="post" class="card">
<div class="rating">${[5, 4, 3, 2, 1].map((n) => `<input type="radio" id="r${n}" name="rating" value="${n}" required><label for="r${n}" title="${tr('rv.star', { n })}">★</label>`).join('')}</div>
<fieldset class="extras"><legend>${tr('rv.aspects')}</legend><div class="row">${REVIEW_ASPECTS.map((a) => `<label>${tr(`rv.aspect.${a}` as Parameters<typeof t>[0])}<select name="aspect_${a}"><option value="">–</option>${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${'★'.repeat(n)}</option>`).join('')}</select></label>`).join('')}</div></fieldset>
<label>${tr('rv.tell')}<textarea name="text" rows="4" maxlength="1500"></textarea></label>
<p class="small muted">${tr('rv.anon')}</p>
<button>${tr('rv.send')}</button></form>`,
    { lang },
  );
}
