// INNLI owner dashboard. Vanilla JS, no build step. All untrusted text goes through textContent.
import { LANG, LOCALE, setLang, startI18n, T } from './i18n.js';

startI18n();

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const state = { key: null, property: null, completeness: null, catalog: [] };

function getKey() {
  try { return sessionStorage.getItem('innli_owner_key'); } catch { return null; }
}
function setKey(k) {
  try { k ? sessionStorage.setItem('innli_owner_key', k) : sessionStorage.removeItem('innli_owner_key'); } catch { /* ignore */ }
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/owner${path}`, {
    method,
    headers: { authorization: `Bearer ${state.key}`, 'x-innli-lang': LANG, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); throw new Error(T('Sessie verlopen')); }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast${isError ? ' error' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

const guard = (fn) => async (...args) => {
  try { await fn(...args); } catch (err) { toast(err.message, true); }
};

const STATUS_LABEL = { confirmed: 'Bevestigd', unconfirmed: 'Niet bevestigd', unknown: 'Onbekend' };
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const currency = () => state.property?.currency || 'EUR';
const money = (n) => new Intl.NumberFormat(LOCALE, { style: 'currency', currency: currency() }).format(Number(n));
const currencySymbol = () => new Intl.NumberFormat(LOCALE, { style: 'currency', currency: currency() }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency();
/** Mo–Su in the dashboard language. */
const weekdays = () => Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(LOCALE, { weekday: 'short', timeZone: 'UTC' }).slice(0, 2));

// Language switch (Dutch / English) in the top bar and on the login screen.
for (const sel of $$('.lang-switch')) {
  sel.value = LANG;
  sel.addEventListener('change', () => setLang(sel.value));
}

// ------------------------------------------------------------------ Auth

async function login(key) {
  state.key = key;
  const [{ property, completeness }, catalog, me] = await Promise.all([api('/property'), fetch(`/api/fact-catalog?lang=${LANG}`).then((r) => r.json()), api('/me').catch(() => ({ role: 'owner' }))]);
  state.me = me;
  applyRole(me);
  state.property = property;
  state.completeness = completeness;
  state.catalog = catalog;
  setKey(key);
  $('#login').hidden = true;
  $('#app').hidden = false;
  renderAll();
  loadAnalytics();
  loadStats().catch(() => {});
  await Promise.all([loadLicense().catch(() => {}), loadRequests().catch(() => {}), loadInsights().catch(() => {}), loadWishes().catch(() => {})]);
  renderChecklist();
}

/** Staff see only what they may use: reception the daily work, a manager everything but keys and licence. */
function applyRole(me) {
  const reception = me.role === 'reception';
  const staff = me.role !== 'owner';
  for (const tab of ['passport', 'units', 'booking', 'audit']) $(`#tabs button[data-tab="${tab}"]`).hidden = reception;
  $$('[data-owner-only]').forEach((el) => (el.hidden = staff));
  $$('[data-manage]').forEach((el) => (el.hidden = reception));
  $('#license-card').hidden = reception;
  $('#license-form').classList.toggle('staff-hidden', staff);
  $('#backup').hidden = staff;
  $('#published').closest('label').hidden = reception;
  $('#who').hidden = !staff;
  $('#who').textContent = staff ? T(me.role === 'manager' ? '{0} · manager' : '{0} · receptie', me.name) : '';
}

function logout() {
  setKey(null);
  state.key = null;
  $('#app').hidden = true;
  $('#login').hidden = false;
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-error');
  err.hidden = true;
  try { await login($('#login-key').value.trim()); } catch (ex) { err.textContent = ex.message; err.hidden = false; }
});
$('#logout').addEventListener('click', logout);

// ------------------------------------------------------------------ Tabs

$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (!btn) return;
  showTab(btn.dataset.tab);
});
function showTab(tab) {
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== tab));
  if (tab === 'preview') loadPreview();
  if (tab === 'overview') { loadAnalytics(); renderChecklist(); loadInsights().catch(() => {}); loadStats().catch(() => {}); }
  if (tab === 'requests') { loadRequests(); loadAuditLog().catch(() => {}); loadReviews().catch(() => {}); }
  if (tab === 'wishes') loadWishes().catch((err) => toast(err.message, true));
  if (tab === 'audit') loadTrust().catch(() => {});
}

// ------------------------------------------------------------------ Render

function renderAll() {
  const p = state.property;
  $('#prop-name').textContent = p.name;
  $('#published').checked = p.published;
  const status = $('#prop-status');
  status.textContent = p.published ? 'Gepubliceerd' : 'Niet gepubliceerd';
  status.className = `chip ${p.published ? 'confirmed' : 'unknown'}`;
  renderCompleteness();
  renderPassport();
  renderUnits();
  renderBooking();
  $('#import-url').value = p.website || '';
  $('#audit-url').value = p.website || '';
  if (p.lastAudit) renderAudit(p.lastAudit);
  renderChecklist();
  renderStayPage();
}

function renderCompleteness() {
  const c = state.completeness;
  $('#score-bar').style.width = `${c.score}%`;
  $('#score-text').textContent = `${c.score}%`;
  const todo = $('#todo');
  todo.replaceChildren();
  const list = (title, items, cls) => {
    if (!items.length) return;
    todo.append(h('h3', {}, title, ' ', h('span', { class: `chip ${cls}` }, items.length)));
    todo.append(h('ul', { class: 'plain small' }, items.slice(0, 8).map((i) => h('li', {}, i)), items.length > 8 ? h('li', { class: 'muted' }, T('…en {0} meer', items.length - 8)) : null));
  };
  list('Te bevestigen', c.unconfirmed, 'unconfirmed');
  list('Beslissende gegevens die nog onbekend zijn', c.unknownCritical, 'unknown');
  list('Opnieuw controleren (ouder dan een jaar)', c.stale, 'warn');
  if (!c.unconfirmed.length && !c.unknownCritical.length) todo.append(h('p', {}, 'Alles wat telt is bevestigd. Top!'));
  if (c.unconfirmed.length || c.unknownCritical.length) todo.append(h('button', { class: 'btn small', onclick: () => showTab('passport') }, 'Naar paspoort'));
}

function factEditor(def, fact, unitId) {
  const value = fact?.value ?? null;
  let input;
  if (def.type === 'boolean') {
    input = h('select', {}, h('option', { value: '' }, '—'), h('option', { value: 'true' }, 'Ja'), h('option', { value: 'false' }, 'Nee'));
    input.value = value === null ? '' : String(value);
  } else if (def.type === 'number') {
    input = h('input', { type: 'number', step: 'any', min: '0', value: value ?? '' });
  } else if (def.type === 'string[]') {
    input = h('input', { value: Array.isArray(value) ? value.join(', ') : '', placeholder: 'kommagescheiden' });
  } else {
    input = (value && String(value).length > 60) || def.key.startsWith('policy.') || def.key.endsWith('rules') || def.key.endsWith('contents')
      ? h('textarea', { rows: 2 }, value ?? '')
      : h('input', { value: value ?? '' });
  }

  const status = fact?.status || 'unknown';
  const stale = fact?.verifiedAt && (Date.now() - Date.parse(fact.verifiedAt)) / 86400000 > 365;
  const body = unitId ? { unitId } : {};
  const key = encodeURIComponent(def.key);

  const save = guard(async () => {
    const raw = input.value.trim();
    if (raw === '') throw new Error(T('Vul een waarde in, of kies "Onbekend".'));
    const v = def.type === 'boolean' ? raw === 'true' : def.type === 'number' ? Number(raw) : raw;
    applyResult(await api(`/facts/${key}`, { method: 'PUT', body: { ...body, value: v } }), def, unitId);
    toast(T('{0}: bevestigd', def.label));
  });
  const confirm = guard(async () => {
    applyResult(await api(`/facts/${key}/confirm`, { method: 'POST', body }), def, unitId);
    toast(T('{0}: bevestigd', def.label));
  });
  const unknown = guard(async () => {
    applyResult(await api(`/facts/${key}/unknown`, { method: 'POST', body }), def, unitId);
    toast(T('{0}: op onbekend gezet', def.label));
  });

  return h('div', { class: 'fact' },
    h('div', {},
      h('div', { class: 'label' }, def.label, def.unit ? ` (${def.unit === 'EUR' ? currencySymbol() : def.unit})` : '', def.critical ? h('span', { class: 'crit', title: 'Beslissend gegeven voor gasten' }, '•') : null),
      def.hint ? h('div', { class: 'meta' }, def.hint) : null,
    ),
    h('div', {},
      input,
      h('div', { class: 'meta' },
        h('span', { class: `chip ${stale ? 'warn' : status}` }, stale ? 'Opnieuw controleren' : STATUS_LABEL[status]),
        fact?.verifiedAt ? ` ${T('gecontroleerd {0}', fmtDate(fact.verifiedAt))}` : '',
        status === 'unconfirmed' && fact.source ? ` · ${T('bron: {0}', fact.source)}` : '',
      ),
      status === 'unconfirmed' && fact.evidence ? h('div', { class: 'evidence', 'data-user-text': true }, fact.evidence) : null,
    ),
    h('div', { class: 'actions' },
      h('button', { class: 'btn small primary', onclick: save }, 'Opslaan'),
      status === 'unconfirmed' || stale ? h('button', { class: 'btn small', onclick: confirm }, 'Klopt') : null,
      status !== 'unknown' ? h('button', { class: 'btn small ghost', onclick: unknown }, 'Onbekend') : null,
    ),
  );
}

function applyResult(result, def, unitId) {
  const target = unitId ? state.property.units.find((u) => u.id === unitId).facts : state.property.facts;
  target[def.key] = result.fact;
  state.completeness = result.completeness;
  renderCompleteness();
  if (unitId) renderUnits(); else renderPassport();
}

function groupByCategory(defs) {
  const groups = new Map();
  for (const d of defs) {
    if (!groups.has(d.category)) groups.set(d.category, []);
    groups.get(d.category).push(d);
  }
  return groups;
}

function renderPassport() {
  const root = $('#passport-facts');
  root.replaceChildren();
  for (const [category, defs] of groupByCategory(state.catalog.filter((d) => d.scope === 'property'))) {
    root.append(h('div', { class: 'card' }, h('h2', {}, category), defs.map((d) => factEditor(d, state.property.facts[d.key]))));
  }
}

function renderUnits() {
  const root = $('#units-list');
  root.replaceChildren();
  const defs = state.catalog.filter((d) => d.scope === 'unit');
  if (!state.property.units.length) root.append(h('div', { class: 'card muted' }, 'Nog geen kamers. Voeg hieronder je eerste kamer of verblijf toe.'));
  for (const unit of state.property.units) {
    const fields = ['name', 'externalRef', 'inventory', 'maxGuests', 'includedGuests', 'baseRatePerNight', 'extraGuestPerNight'];
    const labels = { name: 'Naam', externalRef: 'Code in boekingssysteem', inventory: 'Aantal kamers van dit type', maxGuests: 'Max. gasten per kamer', includedGuests: 'Gasten in basisprijs', baseRatePerNight: T('Basisprijs per nacht ({0})', currencySymbol()), extraGuestPerNight: T('Extra gast per nacht ({0})', currencySymbol()) };
    const form = h('form', { class: 'form-grid' },
      fields.map((f) => h('label', {}, labels[f], h('input', { name: f, value: f === 'inventory' ? unit.inventory ?? 1 : unit[f] ?? '', type: ['name', 'externalRef'].includes(f) ? 'text' : 'number', step: f === 'inventory' ? '1' : 'any', min: f === 'inventory' ? '1' : '0' }))),
      h('div', { class: 'row' }, h('button', { class: 'btn primary small' }, 'Opslaan'), h('button', { type: 'button', class: 'btn small danger', onclick: guard(async () => {
        if (!confirm(T('{0} verwijderen?', unit.name))) return;
        await api(`/units/${encodeURIComponent(unit.id)}`, { method: 'DELETE' });
        await refresh();
        toast('Kamer verwijderd');
      }) }, 'Verwijderen')),
    );
    const photosInput = h('textarea', { rows: 2, placeholder: 'https://…jpg | beschrijving (één per regel)' }, (unit.photos || []).map((x) => `${x.url} | ${x.caption}`).join('\n'));
    const unitFile = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
    form.insertBefore(h('label', { style: 'grid-column: 1 / -1' }, "Foto's van deze kamer", photosInput, h('div', { class: 'row' }, unitFile, h('button', { type: 'button', class: 'btn small', onclick: guard(() => uploadPhoto(unitFile, photosInput)) }, 'Foto uploaden'))), form.lastChild);
    form.addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const patch = { photos: parsePhotos(photosInput.value) };
      for (const f of fields) {
        const v = String(fd.get(f) ?? '').trim();
        if (v === '') continue;
        patch[f] = ['name', 'externalRef'].includes(f) ? v : Number(v);
      }
      Object.assign(unit, await api(`/units/${encodeURIComponent(unit.id)}`, { method: 'PATCH', body: patch }));
      toast('Kamer opgeslagen');
    }));
    const rates = ratesEditor(unit);
    const calendar = h('div');
    const details = h('details', { class: 'calendar-box' }, h('summary', {}, 'Kamerkalender: open en gesloten nachten'), calendar);
    details.addEventListener('toggle', () => { if (details.open) renderRoomCalendar(unit, calendar); });
    const count = (unit.inventory ?? 1) > 1 ? h('span', { class: 'chip info' }, T('{0} kamers', unit.inventory)) : null;
    const card = h('div', { class: 'card' }, h('h2', { 'data-user-text': true }, unit.name, ' ', count, ' ', h('span', { class: 'muted small' }, `id: ${unit.id}`)), form, rates, details);
    for (const [category, cdefs] of groupByCategory(defs)) {
      card.append(h('h3', {}, category), ...cdefs.map((d) => factEditor(d, unit.facts[d.key], unit.id)));
    }
    root.append(card);
  }
}

/** Weekdays as typed by the owner ("za", "vr, za", "sat") ↔ numbers (0 = Sunday). */
const DAY_WORDS = { zo: 0, ma: 1, di: 2, wo: 3, do: 4, vr: 5, za: 6, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const DAY_SHORT = () => (LANG === 'nl' ? ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'] : ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
const daysToText = (days) => (days?.length ? days.map((d) => DAY_SHORT()[d]).join(', ') : '');
function textToDays(text) {
  const words = String(text || '').toLowerCase().split(/[\s,;/]+/).filter(Boolean);
  const days = [...new Set(words.map((w) => DAY_WORDS[w.slice(0, 3)] ?? DAY_WORDS[w.slice(0, 2)]))];
  if (days.some((d) => d === undefined)) throw new Error(T('Aankomstdagen: gebruik bijv. "za" of "vr, za"'));
  return days.length ? days.sort() : undefined;
}

function ratesEditor(unit) {
  const seasons = (unit.rates?.seasons ?? []).map((x) => ({ ...x, checkinText: daysToText(x.checkinDays) }));
  const arrival = h('input', { value: daysToText(unit.rates?.checkinDays), placeholder: T('elke dag') });
  const single = h('input', { type: 'number', min: '0', step: '0.01', value: unit.rates?.singleNightSupplement ?? '', placeholder: '0' });
  const weekend = h('input', { type: 'number', min: '0', step: '0.01', value: unit.rates?.weekendSupplement ?? '', placeholder: '0' });
  const d = unit.rates?.discounts || {};
  const num = (v, ph) => h('input', { type: 'number', min: '0', value: v ?? '', placeholder: ph });
  const longNights = num(d.longStay?.[0]?.minNights, 'bijv. 7');
  const longPct = num(d.longStay?.[0]?.percent, '%');
  const lastDays = num(d.lastMinute?.withinDays, 'bijv. 3');
  const lastPct = num(d.lastMinute?.percent, '%');
  const earlyDays = num(d.earlyBird?.minDaysAhead, 'bijv. 90');
  const earlyPct = num(d.earlyBird?.percent, '%');
  const body = h('tbody');
  const cell = (season, key, attrs) => {
    const input = h('input', { ...attrs, value: season[key] ?? '' });
    input.addEventListener('input', () => { season[key] = attrs.type === 'number' ? (input.value === '' ? undefined : Number(input.value)) : input.value.trim(); });
    return h('td', {}, input);
  };
  const draw = () => body.replaceChildren(...seasons.map((season, i) => h('tr', {},
    cell(season, 'name', { placeholder: 'Zomer' }),
    cell(season, 'from', { placeholder: '07-01', pattern: '\\d{2}-\\d{2}', size: 5 }),
    cell(season, 'to', { placeholder: '08-31', pattern: '\\d{2}-\\d{2}', size: 5 }),
    cell(season, 'ratePerNight', { type: 'number', min: '0', step: '0.01' }),
    cell(season, 'minNights', { type: 'number', min: '1', placeholder: '–' }),
    cell(season, 'checkinText', { placeholder: T('elke dag'), size: 7 }),
    h('td', {}, h('button', { type: 'button', class: 'btn small ghost', onclick: () => { seasons.splice(i, 1); draw(); } }, '✕')),
  )));
  draw();
  const save = guard(async () => {
    const clean = seasons.filter((x) => x.name || x.ratePerNight !== undefined).map(({ checkinText, ...x }) => ({ ...x, checkinDays: textToDays(checkinText) }));
    if (clean.some((x) => !x.name || !/^\d{2}-\d{2}$/.test(x.from || '') || !/^\d{2}-\d{2}$/.test(x.to || '') || x.ratePerNight === undefined)) {
      throw new Error(T('Vul per seizoen een naam, van/tot als MM-DD (bijv. 07-01) en een prijs in'));
    }
    const discounts = {};
    if (longNights.value && longPct.value) discounts.longStay = [{ minNights: Number(longNights.value), percent: Number(longPct.value) }];
    if (lastDays.value !== '' && lastPct.value) discounts.lastMinute = { withinDays: Number(lastDays.value), percent: Number(lastPct.value) };
    if (earlyDays.value && earlyPct.value) discounts.earlyBird = { minDaysAhead: Number(earlyDays.value), percent: Number(earlyPct.value) };
    const updated = await api(`/units/${encodeURIComponent(unit.id)}`, { method: 'PATCH', body: { rates: { seasons: clean, ...(weekend.value !== '' ? { weekendSupplement: Number(weekend.value) } : {}), ...(Object.keys(discounts).length ? { discounts } : {}), ...(textToDays(arrival.value) ? { checkinDays: textToDays(arrival.value) } : {}), ...(Number(single.value) > 0 ? { singleNightSupplement: Number(single.value) } : {}) } } });
    unit.rates = updated.rates;
    toast(T('Tarieven {0} opgeslagen', unit.name));
  });
  return h('details', { class: 'calendar-box' },
    h('summary', {}, 'Tarieven: seizoenen en weekend'),
    h('p', { class: 'muted small' }, T('Zonder seizoen geldt de basisprijs ({0}). Een seizoen geldt elk jaar opnieuw; "Kerst" van 12-20 tot 01-02 mag over de jaargrens. Bij overlap wint het onderste seizoen.', money(unit.baseRatePerNight))),
    h('label', {}, T('Weekendtoeslag per nacht (vrijdag en zaterdag, {0})', currencySymbol()), weekend),
    h('table', { class: 'seasons' }, h('thead', {}, h('tr', {}, ['Seizoen', 'Van (MM-DD)', 'Tot (MM-DD)', T('Prijs/nacht {0}', currencySymbol()), 'Min. nachten', 'Aankomst op', ''].map((t) => h('th', {}, t)))), body),
    h('h3', {}, 'Aankomst en korte verblijven'),
    h('div', { class: 'form-grid' },
      h('label', {}, 'Aankomst alleen op (buiten seizoenen met eigen regel)', arrival),
      h('label', {}, T('Toeslag voor één nacht ({0})', currencySymbol()), single),
    ),
    h('p', { class: 'muted small' }, 'Bijv. "za" voor zaterdag tot zaterdag, of "vr, za". Leeg = elke dag. Aanvragen op een andere dag komen gewoon binnen, maar worden niet direct bevestigd.'),
    h('h3', {}, 'Kortingen'),
    h('p', { class: 'muted small' }, 'De hoogste korting die geldt wordt toegepast; kortingen stapelen niet. Alleen op je eigen tarieven (niet bij een live boekingssysteem).'),
    h('div', { class: 'form-grid' },
      h('label', {}, 'Lang verblijf vanaf (nachten)', longNights), h('label', {}, 'Korting %', longPct),
      h('label', {}, 'Last minute: binnen (dagen)', lastDays), h('label', {}, 'Korting %', lastPct),
      h('label', {}, 'Vroegboeken: minimaal (dagen vooruit)', earlyDays), h('label', {}, 'Korting %', earlyPct),
    ),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { type: 'button', class: 'btn small', onclick: () => { seasons.push({ name: '', from: '', to: '', ratePerNight: undefined }); draw(); } }, '+ Seizoen'),
      h('button', { type: 'button', class: 'btn small primary', onclick: save }, 'Tarieven opslaan'),
    ),
  );
}

const unsavedCalendars = new Set();
window.addEventListener('beforeunload', (e) => { if (unsavedCalendars.size) e.preventDefault(); });

const NIGHT_LABEL = { open: 'Open', closed_by_owner: 'Gesloten', booked_elsewhere: 'Bezet via agenda' };

const renderRoomCalendar = guard(async (unit, root) => {
  root.replaceChildren(h('p', { class: 'muted small' }, 'Kalender laden…'));
  const cal = await api(`/units/${encodeURIComponent(unit.id)}/calendar?days=120`);
  const closed = new Set(cal.nights.filter((n) => n.state === 'closed_by_owner').map((n) => n.date));
  const saveBtn = h('button', { class: 'btn primary small', disabled: true }, 'Opslaan');
  const months = new Map();
  for (const n of cal.nights) {
    const key = n.date.slice(0, 7);
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(n);
  }
  const grid = h('div', { class: 'months' }, [...months].map(([key, nights]) => {
    const first = new Date(`${nights[0].date}T00:00:00Z`);
    const offset = (first.getUTCDay() + 6) % 7; // weeks start on Monday
    const title = first.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return h('div', { class: 'month' },
      h('div', { class: 'month-title' }, title),
      h('div', { class: 'days' },
        weekdays().map((d) => h('span', { class: 'dow' }, d)),
        Array.from({ length: offset }, () => h('span')),
        nights.map((n) => {
          const day = Number(n.date.slice(8));
          if (n.state === 'booked_elsewhere') return h('span', { class: 'day booked', title: `${n.date}: ${T(NIGHT_LABEL.booked_elsewhere)}` }, day);
          if (n.state === 'sold_out') return h('span', { class: 'day booked', title: `${n.date}: ${T('uitverkocht')}` }, day);
          const free = n.free !== undefined ? h('small', { class: 'free' }, String(n.free)) : null;
          const btn = h('button', { type: 'button', class: `day ${closed.has(n.date) ? 'closed' : 'open'}`, title: n.free !== undefined ? T('{0}: {1} van {2} kamers vrij', n.date, n.free, unit.inventory) : n.date }, day, free);
          btn.addEventListener('click', () => {
            if (closed.has(n.date)) closed.delete(n.date); else closed.add(n.date);
            btn.className = `day ${closed.has(n.date) ? 'closed' : 'open'}`;
            unsavedCalendars.add(unit.id);
            saveBtn.disabled = false;
          });
          return btn;
        }),
      ),
    );
  }));
  saveBtn.addEventListener('click', guard(async () => {
    const r = await api(`/units/${encodeURIComponent(unit.id)}/closed`, { method: 'PUT', body: { closedNights: [...closed] } });
    unit.closedNights = r.closedNights;
    unsavedCalendars.delete(unit.id);
    saveBtn.disabled = true;
    toast(T('Kamerkalender {0} opgeslagen', unit.name));
  }));
  const exportInput = h('input', { readonly: true, value: cal.exportUrl });
  root.replaceChildren(h('div', {},
    (unit.inventory ?? 1) > 1
      ? h('p', { class: 'muted small' }, T('Het kleine getal is het aantal vrije kamers van dit type. Klik op een dag om de verkoop voor die nacht te stoppen (stop-sell) of weer te openen. Grijze dagen zijn uitverkocht.'))
      : h('p', { class: 'muted small' }, 'Klik op een dag om die nacht te sluiten of weer te openen. Grijze dagen zijn bezet volgens je gekoppelde agenda\'s.'),
    h('div', { class: 'legend small' },
      h('span', { class: 'day open' }, ' '), ` ${T('Open')} `,
      h('span', { class: 'day closed' }, ' '), ` ${T('Gesloten')} `,
      h('span', { class: 'day booked' }, ' '), ` ${T((unit.inventory ?? 1) > 1 ? 'Uitverkocht' : 'Bezet via agenda')}`),
    cal.feedErrors.length ? h('p', { class: 'error small' }, T('Agenda niet te lezen: {0}', cal.feedErrors.join('; '))) : null,
    grid,
    h('div', { class: 'row' }, saveBtn),
    h('h3', {}, 'Gesloten nachten doorzetten naar Airbnb of Booking.com'),
    h('p', { class: 'muted small' }, 'Importeer deze link als externe agenda in je kanalen. Alleen nachten die je hier sluit staan erin.'),
    h('div', { class: 'row' }, exportInput, h('button', { type: 'button', class: 'btn small', onclick: guard(async () => { await navigator.clipboard.writeText(exportInput.value); toast('Gekopieerd'); }) }, 'Kopiëren')),
  ));
});

$('#unit-form').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = { name: fd.get('name'), maxGuests: Number(fd.get('maxGuests')), includedGuests: Number(fd.get('includedGuests')), baseRatePerNight: Number(fd.get('baseRatePerNight')) };
  if (fd.get('externalRef')) body.externalRef = fd.get('externalRef');
  if (fd.get('extraGuestPerNight')) body.extraGuestPerNight = Number(fd.get('extraGuestPerNight'));
  if (Number(fd.get('inventory')) > 1) body.inventory = Number(fd.get('inventory'));
  await api('/units', { method: 'POST', body });
  e.target.reset();
  await refresh();
  toast('Kamer toegevoegd');
}));

async function refresh() {
  const { property, completeness } = await api('/property');
  state.property = property;
  state.completeness = completeness;
  renderAll();
}

// ------------------------------------------------------------------ Booking & basics

/** Rate plans next to the standard rate: a percentage on the price, refundable or not, optionally with breakfast. */
let ratePlanDraft = [];
function renderRatePlans() {
  const root = $('#rateplans-rows');
  if (!ratePlanDraft.length) {
    root.replaceChildren(h('p', { class: 'muted small' }, 'Alleen je standaardprijs.'));
    return;
  }
  root.replaceChildren(...ratePlanDraft.map((plan, i) => {
    const input = (key, attrs) => {
      const el = h('input', { ...attrs, value: plan[key] ?? '' });
      el.addEventListener('input', () => { plan[key] = attrs.type === 'number' ? (el.value === '' ? 0 : Number(el.value)) : el.value; });
      return el;
    };
    const check = (key) => {
      const el = h('input', { type: 'checkbox' });
      el.checked = Boolean(plan[key]);
      el.addEventListener('change', () => { plan[key] = el.checked; });
      return el;
    };
    return h('div', { class: 'rateplan' },
      h('div', { class: 'form-grid' },
        h('label', {}, 'Naam', input('name', { type: 'text', placeholder: 'bijv. Niet-restitueerbaar' })),
        h('label', {}, 'Prijsverschil t.o.v. standaard (%)', input('adjustmentPercent', { type: 'number', step: '1', min: '-90', max: '200', placeholder: '-10' })),
      ),
      h('label', { class: 'check-row' }, check('refundable'), h('span', {}, 'Kosteloos te annuleren volgens je gewone voorwaarden')),
      h('label', { class: 'check-row' }, check('breakfastIncluded'), h('span', {}, 'Ontbijt inbegrepen')),
      h('label', {}, 'Annuleringsvoorwaarden van dit plan (optioneel)', input('cancellation', { type: 'text', placeholder: 'bijv. Niet kosteloos te annuleren of te wijzigen.' })),
      h('div', { class: 'row' }, h('span', { class: 'muted small' }, `id: ${plan.id || T('(wordt gemaakt bij opslaan)')}`), h('button', { type: 'button', class: 'btn small danger', onclick: () => { ratePlanDraft.splice(i, 1); renderRatePlans(); } }, 'Verwijderen')),
    );
  }));
}

$('#rateplan-add').addEventListener('click', () => {
  ratePlanDraft.push({ id: '', name: '', adjustmentPercent: -10, refundable: false });
  renderRatePlans();
});

$('#rateplans-form').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const taken = new Set(['standard']);
  const ratePlans = ratePlanDraft.map((plan) => {
    const name = String(plan.name || '').trim();
    if (name.length < 2) throw new Error(T('Geef elk tariefplan een naam'));
    let id = plan.id || name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'plan';
    for (let n = 2; taken.has(id) || id.length < 2; n++) id = `${id.slice(0, 27)}-${n}`;
    taken.add(id);
    const out = { id, name, adjustmentPercent: Number(plan.adjustmentPercent) || 0, refundable: Boolean(plan.refundable) };
    if (plan.breakfastIncluded) out.breakfastIncluded = true;
    if (String(plan.cancellation || '').trim()) out.cancellation = String(plan.cancellation).trim();
    return out;
  });
  const { property } = await api('/property', { method: 'PATCH', body: { ratePlans } });
  state.property = property;
  renderBooking();
  toast('Tariefplannen opgeslagen');
}));

function renderStaff() {
  const root = $('#staff-list');
  if (state.me?.role !== 'owner') return;
  const staff = state.property.staff || [];
  root.replaceChildren(staff.length
    ? h('table', { class: 'table small' }, h('tbody', {}, staff.map((m) => h('tr', {},
      h('td', { 'data-user-text': true }, m.name),
      h('td', {}, T(m.role === 'manager' ? 'Manager' : 'Receptie')),
      h('td', { class: 'muted' }, m.lastSeenAt ? T('laatst actief {0}', fmtDate(m.lastSeenAt)) : T('nog niet gebruikt')),
      h('td', {}, h('button', { type: 'button', class: 'btn small danger', onclick: guard(async () => {
        if (!confirm(T('Sleutel van {0} intrekken?', m.name))) return;
        await api(`/staff/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
        await refresh();
        toast('Sleutel ingetrokken');
      }) }, 'Intrekken')),
    ))))
    : h('p', { class: 'muted small' }, 'Nog geen personeel. Alleen jij logt in.'));
}

$('#staff-form').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const { staff, key } = await api('/staff', { method: 'POST', body: { name: f.name.value.trim(), role: f.role.value } });
  e.target.reset();
  const out = $('#staff-new');
  const input = h('input', { readonly: true, value: key });
  out.replaceChildren(
    h('p', {}, h('strong', {}, T('Sleutel voor {0}', staff.name)), ` ${T('Geef deze sleutel door; hij wordt maar één keer getoond.')}`),
    h('div', { class: 'row' }, input, h('button', { type: 'button', class: 'btn small', onclick: guard(async () => { await navigator.clipboard.writeText(key); toast('Gekopieerd'); }) }, 'Kopiëren')),
  );
  out.hidden = false;
  await refresh();
}));

function renderWebhook() {
  const hook = state.property.outboundWebhook;
  const form = $('#webhook-form');
  form.elements.url.value = hook?.url ?? '';
  $('#webhook-test').disabled = !hook;
  const info = $('#webhook-info');
  if (!hook) { info.textContent = ''; return; }
  info.replaceChildren(...[
    h('span', {}, `${T('Geheim voor de handtekening:')} `), h('code', {}, hook.secret),
    hook.lastDeliveryAt ? h('span', { class: 'muted' }, ` · ${T('laatst afgeleverd {0}', fmtDate(hook.lastDeliveryAt))}`) : null,
    hook.lastError ? h('div', { class: 'error' }, T('Laatste fout: {0}', hook.lastError)) : null,
  ].filter(Boolean));
}

$('#webhook-form').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const url = e.target.elements.url.value.trim();
  await api('/webhook', { method: 'PUT', body: { url: url || null } });
  await refresh();
  toast(url ? 'Webhook opgeslagen' : 'Webhook uitgezet');
}));

$('#webhook-test').addEventListener('click', guard(async () => {
  const r = await api('/webhook/test', { method: 'POST', body: {} });
  if (r.ok) toast(T('Testbericht afgeleverd (HTTP {0})', r.status));
  else toast(T('Testbericht mislukt: {0}', r.error), true);
}));

// ------------------------------------------------------------------ 1.1: options, codes, cancellation, photos, figures, backups

const slugId = (name, fallback) => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || fallback;

/** Editable list of small records (one card per row) with a remove button. */
function listEditor(root, rows, fields, empty) {
  const field = (row, f) => {
    if (f.options) {
      const el = h('select', {}, f.options.map(([v, label]) => h('option', { value: v }, label)));
      el.value = row[f.key] ?? f.options[0][0];
      el.addEventListener('change', () => { row[f.key] = el.value; });
      row[f.key] = el.value;
      return el;
    }
    if (f.type === 'checkbox') {
      const el = h('input', { type: 'checkbox' });
      el.checked = Boolean(row[f.key]);
      el.addEventListener('change', () => { row[f.key] = el.checked; });
      return el;
    }
    const el = h('input', { type: f.type || 'text', value: row[f.key] ?? '', placeholder: f.placeholder || '', step: f.type === 'number' ? 'any' : undefined, min: f.type === 'number' ? '0' : undefined });
    el.addEventListener('input', () => { row[f.key] = f.type === 'number' ? (el.value === '' ? undefined : Number(el.value)) : el.value; });
    return el;
  };
  const draw = () => {
    if (!rows.length) {
      root.replaceChildren(h('p', { class: 'muted small' }, empty));
      return;
    }
    root.replaceChildren(...rows.map((row, i) => h('div', { class: 'rateplan' },
      h('div', { class: 'form-grid' }, fields.map((f) => (f.type === 'checkbox' ? h('label', { class: 'check-row' }, field(row, f), h('span', {}, f.label)) : h('label', {}, f.label, field(row, f))))),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small danger', onclick: () => { rows.splice(i, 1); draw(); } }, 'Verwijderen')),
    )));
  };
  draw();
  return draw;
}

const PER_OPTIONS = () => [['stay', T('per verblijf')], ['night', T('per nacht')], ['person', T('per persoon')], ['person_night', T('per persoon per nacht')], ['room_night', T('per kamer per nacht')]];
let extrasDraft = [];
let codesDraft = [];
let cancelDraft = [];
let drawExtras = () => {};
let drawCodes = () => {};
let drawCancel = () => {};

function renderOffer() {
  const p = state.property;
  extrasDraft = (p.extras || []).map((x) => ({ ...x }));
  codesDraft = (p.discountCodes || []).map((x) => ({ ...x }));
  cancelDraft = (p.cancellationRules || []).map((x) => ({ ...x }));
  drawExtras = listEditor($('#extras-rows'), extrasDraft, [
    { key: 'name', label: 'Naam', placeholder: 'bijv. Fietshuur' },
    { key: 'price', label: T('Prijs ({0})', currencySymbol()), type: 'number' },
    { key: 'per', label: 'Prijs geldt', options: PER_OPTIONS() },
    { key: 'max', label: 'Maximaal aantal', type: 'number', placeholder: '1' },
    { key: 'description', label: 'Toelichting (optioneel)' },
  ], 'Nog geen opties.');
  drawCodes = listEditor($('#codes-rows'), codesDraft, [
    { key: 'code', label: 'Code', placeholder: 'bijv. WELKOMTERUG' },
    { key: 'percent', label: 'Korting %', type: 'number' },
    { key: 'validUntil', label: 'Geldig voor aankomst t/m (optioneel)', type: 'date' },
    { key: 'minNights', label: 'Vanaf aantal nachten (optioneel)', type: 'number' },
    { key: 'maxUses', label: 'Hoe vaak te gebruiken (optioneel)', type: 'number' },
    { key: 'active', label: 'Actief', type: 'checkbox' },
  ], 'Nog geen kortingscodes.');
  drawCancel = listEditor($('#cancel-rows'), cancelDraft, [
    { key: 'daysBefore', label: 'Minder dan … dagen voor aankomst', type: 'number' },
    { key: 'percent', label: 'Kosten % van de totaalprijs', type: 'number' },
  ], 'Geen annuleringsregels: agents noemen alleen je voorwaarden als tekst.');
}

$('#extra-add').addEventListener('click', () => { extrasDraft.push({ name: '', price: undefined, per: 'stay', max: 1 }); drawExtras(); });
$('#code-add').addEventListener('click', () => { codesDraft.push({ code: '', percent: 10, active: true }); drawCodes(); });
$('#cancel-add').addEventListener('click', () => { cancelDraft.push({ daysBefore: 7, percent: 50 }); drawCancel(); });

$('#offer-form').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const taken = new Set();
  const extras = extrasDraft.map((x) => {
    const name = String(x.name || '').trim();
    if (name.length < 2 || x.price === undefined) throw new Error(T('Geef elke optie een naam en een prijs'));
    let id = x.id || slugId(name, 'optie');
    for (let n = 2; taken.has(id) || id.length < 2; n++) id = `${id.slice(0, 27)}-${n}`;
    taken.add(id);
    const out = { id, name, price: Number(x.price), per: x.per || 'stay' };
    if (Number(x.max) > 1) out.max = Number(x.max);
    if (String(x.description || '').trim()) out.description = String(x.description).trim();
    return out;
  });
  const discountCodes = codesDraft.map((c) => {
    const code = String(c.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,30}$/.test(code) || !(Number(c.percent) >= 1)) throw new Error(T('Een kortingscode heeft 3 tot 30 letters of cijfers en een percentage'));
    const out = { code, percent: Number(c.percent), active: c.active !== false };
    if (c.validUntil) out.validUntil = c.validUntil;
    if (Number(c.minNights) > 0) out.minNights = Number(c.minNights);
    if (Number(c.maxUses) > 0) out.maxUses = Number(c.maxUses);
    return out;
  });
  const cancellationRules = cancelDraft.filter((r) => r.daysBefore !== undefined && r.percent !== undefined).map((r) => ({ daysBefore: Number(r.daysBefore), percent: Number(r.percent) }));
  const { property } = await api('/property', { method: 'PATCH', body: { extras, discountCodes, cancellationRules } });
  state.property = property;
  renderBooking();
  toast('Opgeslagen');
}));

/** Uploads the chosen photo and appends "url | " to the textarea, so the owner only adds the description. */
async function uploadPhoto(fileInput, textarea) {
  const file = fileInput.files?.[0];
  if (!file) throw new Error(T('Kies eerst een foto'));
  const res = await fetch('/api/owner/photos', { method: 'POST', headers: { authorization: `Bearer ${state.key}`, 'content-type': file.type || 'application/octet-stream' }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  textarea.value = `${textarea.value.trim() ? `${textarea.value.trimEnd()}\n` : ''}${data.url} | `;
  textarea.focus();
  fileInput.value = '';
  toast(T('Foto geüpload. Schrijf achter de | wat erop te zien is en sla op.'));
}
$('#photo-upload').addEventListener('click', guard(() => uploadPhoto($('#photo-file'), $('#content-form').elements.photos)));

const CAPTION_PROBLEM = { missing: 'geen beschrijving', filename: 'bestandsnaam in plaats van beschrijving', too_short: 'te kort om te begrijpen wat erop staat' };
async function loadPhotoCheck() {
  const root = $('#photo-check');
  if (!root || state.me?.role === 'reception') return;
  const r = await api('/photos/check');
  root.replaceChildren(...(r.problems.length
    ? [h('p', { class: 'small error' }, T('{0} foto(\'s) met een vage beschrijving. Agents en schermlezers weten dan niet wat erop staat:', r.problems.length)),
      h('ul', { class: 'plain small' }, r.problems.map((x) => h('li', {}, h('span', { 'data-user-text': true }, `${x.where}: "${x.caption}"`), ` – ${T(CAPTION_PROBLEM[x.problem])}`)))]
    : []));
}

async function loadStats() {
  const s = await api('/stats?months=12');
  const cur = (n) => new Intl.NumberFormat(LOCALE, { style: 'currency', currency: s.currency, maximumFractionDigits: 0 }).format(n);
  const month = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(LOCALE, { month: 'short', year: '2-digit', timeZone: 'UTC' });
  $('#stats').replaceChildren(
    h('div', { class: 'tiles' },
      h('div', { class: 'tile' }, h('div', { class: 'num' }, cur(s.totals.revenue.agent)), h('div', { class: 'small muted' }, T('via AI-agents ({0})', s.totals.bookings.agent))),
      h('div', { class: 'tile' }, h('div', { class: 'num' }, cur(s.totals.revenue.stay_page)), h('div', { class: 'small muted' }, T('via je verblijfspagina ({0})', s.totals.bookings.stay_page))),
      h('div', { class: 'tile' }, h('div', { class: 'num' }, cur(s.totals.revenue.website)), h('div', { class: 'small muted' }, T('via je website na een agent ({0})', s.totals.bookings.website))),
    ),
    h('table', { class: 'table small' },
      h('thead', {}, h('tr', {}, ['Maand', 'Bezetting', 'Agents', 'Verblijfspagina', 'Website'].map((x) => h('th', {}, x)))),
      h('tbody', {}, s.months.slice().reverse().map((m) => h('tr', {},
        h('td', {}, month(m.month)),
        h('td', {}, `${m.occupancyPercent.toLocaleString(LOCALE)}%`),
        h('td', {}, cur(m.revenue.agent)), h('td', {}, cur(m.revenue.stay_page)), h('td', {}, cur(m.revenue.website)),
      ))),
    ),
    h('p', { class: 'muted small' }, 'Bezetting: verkochte kamernachten gedeeld door de nachten die te boeken waren. Omzet per maand van aankomst, volgens de prijs bij de aanvraag. Website: boekingen op je eigen site die de WordPress-plugin terugmeldde (met bedrag als je site dat meegeeft).'),
  );
}

$('#feed-copy').addEventListener('click', guard(async () => {
  const { url } = await api('/bookings/feed');
  await navigator.clipboard.writeText(url).catch(() => prompt(T('Kopieer deze link:'), url));
  toast(T('Link gekopieerd. Voeg hem toe als agenda via URL.'));
}));
$('#csv-download').addEventListener('click', guard(async () => {
  const res = await fetch('/api/owner/export/requests.csv', { headers: { authorization: `Bearer ${state.key}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'innli-aanvragen.csv';
  const a = h('a', { href: URL.createObjectURL(await res.blob()), download: name });
  document.body.append(a);
  a.click();
  a.remove();
}));

async function loadBackups() {
  if (state.me?.role !== 'owner') return;
  const b = await api('/backups');
  $('#backup-now').hidden = !b.configured;
  $('#backups-status').textContent = b.configured
    ? (b.backups.length ? T('Automatische back-up elke dag naar {0}. Laatste: {1} ({2} bewaard).', b.dir, fmtDate(b.backups[0].day), b.backups.length) : T('Automatische back-up elke dag naar {0}. Nog geen back-up gemaakt.', b.dir))
    : T('Automatische back-ups staan uit. Zet INNLI_BACKUP_DIR op een map buiten de datamap (bijv. een USB-schijf of een gesynchroniseerde map). Download intussen zelf regelmatig een back-up (rechtsboven).');
}
$('#backup-now').addEventListener('click', guard(async () => {
  const r = await api('/backups/now', { method: 'POST', body: {} });
  toast(T('Back-up gemaakt in {0}', r.folder));
  await loadBackups();
}));
$('#restore-go').addEventListener('click', guard(async () => {
  const file = $('#restore-file').files?.[0];
  if (!file) throw new Error(T('Kies eerst een back-upbestand'));
  if (!confirm(T('Alles terugzetten naar de stand van deze back-up? Wijzigingen van daarna gaan verloren.'))) return;
  const res = await fetch('/api/owner/restore', { method: 'POST', headers: { authorization: `Bearer ${state.key}`, 'content-type': 'application/json' }, body: await file.text() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  toast(T('Teruggezet: {0} aanvragen en {1} vragen.', data.restored.requests, data.restored.questions));
  await refresh();
}));

function renderBooking() {
  const p = state.property;
  const basics = $('#basics-form');
  const set = (name, v) => { basics.elements[name].value = v ?? ''; };
  set('name', p.name); set('type', p.type); set('description', p.description);
  set('street', p.address.street); set('postalCode', p.address.postalCode); set('city', p.address.city); set('region', p.address.region); set('country', p.address.country);
  set('lat', p.geo?.lat); set('lng', p.geo?.lng); set('website', p.website); set('contactEmail', p.contactEmail); set('phone', p.phone);
  set('language', p.language || 'nl'); set('currency', p.currency || 'EUR');
  for (const el of $$('.cur')) el.textContent = `(${currencySymbol()})`;

  const bf = $('#booking-form');
  const c = p.booking.connector;
  bf.elements.kind.value = c.kind;
  bf.elements.baseUrl.value = c.kind === 'live_api' ? c.baseUrl : '';
  bf.elements.apiKey.value = c.kind === 'live_api' ? c.apiKey ?? '' : '';
  bf.elements.beds24Token.value = c.kind === 'beds24' ? c.refreshToken ?? '' : '';
  bf.elements.deeplinkTemplate.value = p.booking.deeplinkTemplate ?? '';
  bf.elements.requestUrl.value = p.booking.requestUrl ?? '';
  const ical = $('#ical-fields');
  const feeds = (id) => (c.kind === 'ical' ? [].concat(c.calendars[id] ?? []) : []);
  ical.replaceChildren(...p.units.map((u) => h('label', {}, T('Agenda-links {0}', u.name), h('textarea', { rows: 2, 'data-unit': u.id, placeholder: 'https://www.airbnb.nl/calendar/ical/….ics' }, feeds(u.id).join('\n')))));
  if (!p.units.length) ical.append(h('p', { class: 'muted small' }, 'Voeg eerst kamers toe.'));
  toggleKind();

  const cf = $('#content-form').elements;
  cf.photos.value = (p.photos || []).map((x) => `${x.url} | ${x.caption}`).join('\n');
  cf.pois.value = (p.pointsOfInterest || []).map((x) => [x.kind, x.name, String(x.distanceKm).replace('.', ','), x.walkMinutes ?? ''].join(' | ')).join('\n');
  const base = p.language || 'nl';
  for (const l of ['nl', 'en', 'de', 'fr']) {
    cf[l].value = p.translations?.[l]?.description ?? '';
    // No translation field for the language the description itself is written in.
    cf[l].closest('label').hidden = l === base;
  }
  cf.ntfyUrl.value = p.notify?.ntfyUrl ?? '';

  const rules = { instantBooking: false, minLeadDays: 2, maxNights: 14, holdHours: 48, ...(p.bookingRules || {}) };
  const rf = $('#rules-form').elements;
  rf.instantBooking.checked = rules.instantBooking;
  rf.autoAnswer.checked = rules.autoAnswer ?? true;
  rf.minLeadDays.value = rules.minLeadDays;
  rf.maxNights.value = rules.maxNights;
  rf.holdHours.value = rules.holdHours;
  rf.depositPercent.value = rules.deposit?.percent ?? '';
  rf.depositDueDays.value = rules.deposit?.dueDays ?? 7;
  rf.depositInstructions.value = rules.deposit?.instructions ?? '';
  rf.depositPaymentUrl.value = rules.deposit?.paymentUrl ?? '';

  $('#webhook-secret').value = p.webhookSecret ?? '';
  $('#prop-id').textContent = p.id;
  renderStaff();
  renderWebhook();
  ratePlanDraft = (p.ratePlans || []).map((x) => ({ ...x }));
  renderRatePlans();
  renderOffer();
  loadPhotoCheck().catch(() => {});
  loadBackups().catch(() => {});
}

function toggleKind() {
  const kind = $('#booking-form').elements.kind.value;
  $$('#booking-form [data-kind]').forEach((el) => (el.hidden = el.dataset.kind !== kind));
}
$('#booking-form').elements.kind.addEventListener('change', toggleKind);

$('#basics-form').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const val = (n) => f[n].value.trim();
  const opt = (n) => val(n) || undefined;
  const lat = val('lat'), lng = val('lng');
  const { property, completeness } = await api('/property', {
    method: 'PATCH',
    body: {
      name: val('name'), type: val('type'), description: val('description'), language: val('language'), currency: val('currency'),
      address: { street: opt('street'), postalCode: opt('postalCode'), city: val('city'), region: opt('region'), country: val('country') },
      geo: lat && lng ? { lat: Number(lat), lng: Number(lng) } : null,
      website: val('website') || null, contactEmail: val('contactEmail') || null, phone: val('phone') || null,
    },
  });
  state.property = property; state.completeness = completeness;
  renderAll();
  toast('Gegevens opgeslagen');
}));

$('#booking-form').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const kind = f.kind.value;
  let connector = { kind: 'none' };
  if (kind === 'ical') {
    const calendars = {};
    $$('#ical-fields textarea[data-unit]').forEach((i) => {
      const urls = i.value.split(/\s+/).map((u) => u.trim()).filter(Boolean);
      if (urls.length) calendars[i.dataset.unit] = urls;
    });
    connector = { kind, calendars };
  } else if (kind === 'manual') {
    connector = { kind };
  } else if (kind === 'live_api') {
    connector = { kind, baseUrl: f.baseUrl.value.trim(), ...(f.apiKey.value ? { apiKey: f.apiKey.value } : {}) };
  } else if (kind === 'beds24') {
    connector = { kind, refreshToken: f.beds24Token.value.trim() };
  }
  const { property } = await api('/property', { method: 'PATCH', body: { booking: { connector, deeplinkTemplate: f.deeplinkTemplate.value.trim() || null, requestUrl: f.requestUrl.value.trim() || null } } });
  state.property = property;
  renderBooking();
  toast('Boekingskoppeling opgeslagen');
}));

function parsePhotos(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [url, ...rest] = l.split('|');
    return { url: url.trim(), caption: rest.join('|').trim() };
  });
}

$('#content-form').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const pointsOfInterest = f.pois.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [kind, name, km, minutes] = l.split('|').map((x) => (x ?? '').trim());
    const poi = { kind, name, distanceKm: Number(String(km).replace(',', '.')) };
    if (minutes) poi.walkMinutes = Number(minutes);
    return poi;
  });
  const translations = {};
  for (const l of ['nl', 'en', 'de', 'fr']) if (f[l].value.trim() && l !== (state.property.language || 'nl')) translations[l] = { description: f[l].value.trim() };
  const { property } = await api('/property', { method: 'PATCH', body: { photos: parsePhotos(f.photos.value), pointsOfInterest, translations, notify: f.ntfyUrl.value.trim() ? { ntfyUrl: f.ntfyUrl.value.trim() } : {} } });
  state.property = property;
  renderBooking();
  toast('Opgeslagen');
}));

$('#google-export').addEventListener('click', guard(async () => {
  const res = await fetch('/api/owner/export/google-business', { headers: { authorization: `Bearer ${state.key}`, 'x-innli-lang': LANG } });
  const out = $('#google-export-text');
  out.textContent = await res.text();
  out.hidden = false;
}));

$('#rules-form').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const percent = Number(f.depositPercent.value || 0);
  const bookingRules = {
    instantBooking: f.instantBooking.checked,
    autoAnswer: f.autoAnswer.checked,
    minLeadDays: Number(f.minLeadDays.value || 0),
    maxNights: Number(f.maxNights.value || 14),
    holdHours: Number(f.holdHours.value || 48),
    deposit: percent > 0 ? {
      percent,
      dueDays: Number(f.depositDueDays.value || 7),
      ...(f.depositInstructions.value.trim() ? { instructions: f.depositInstructions.value.trim() } : {}),
      ...(f.depositPaymentUrl.value.trim() ? { paymentUrl: f.depositPaymentUrl.value.trim() } : {}),
    } : null,
  };
  if (bookingRules.instantBooking && !['manual', 'ical'].includes(state.property.booking.connector.kind)) {
    toast(T("Direct bevestigen werkt met je kamerkalender of gekoppelde agenda's; met een live boekingssysteem boeken gasten daar al direct."), true);
  }
  const { property } = await api('/property', { method: 'PATCH', body: { bookingRules } });
  state.property = property;
  renderBooking();
  toast('Regels opgeslagen');
}));

$('#connector-test').addEventListener('click', guard(async () => {
  const out = $('#connector-result');
  out.hidden = false;
  out.textContent = T('Bezig…');
  const r = await api('/connector/test', { method: 'POST', body: {} });
  out.textContent = [
    T('Test voor {0} t/m {1}:', fmtDate(r.checkin), fmtDate(r.checkout)),
    ...r.units.map((u) => `• ${u.name}: ${u.status} (${u.certainty}) – ${u.note}`),
    '',
    T('Agents zien: {0}', r.booking.howToBook),
  ].join('\n');
}));

$('#copy-secret').addEventListener('click', guard(async () => {
  await navigator.clipboard.writeText($('#webhook-secret').value);
  toast('Gekopieerd');
}));

$('#published').addEventListener('change', guard(async (e) => {
  const { property } = await api('/property', { method: 'PATCH', body: { published: e.target.checked } });
  state.property = property;
  renderAll();
  renderChecklist();
  renderStayPage();
  toast(T(property.published ? 'Je verblijf is zichtbaar voor aangesloten agents' : 'Je verblijf is verborgen voor agents'));
}));

// ------------------------------------------------------------------ Import

const HINT_LABEL = { ground_floor: 'Begane grond genoemd', bed_length: 'Bedlengte genoemd', walk_in_shower: 'Inloopdouche genoemd', private_bathroom: 'Eigen badkamer genoemd' };

$('#import-form').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const out = $('#import-result');
  out.replaceChildren(h('p', { class: 'muted' }, 'Website wordt ingelezen…'));
  const r = await api('/import', { method: 'POST', body: { url: $('#import-url').value.trim() || undefined } });
  state.completeness = r.completeness;
  await refresh();
  out.replaceChildren(h('div', {},
    h('p', {}, T('{0} gegeven(s) als concept ingevuld', r.applied.length), r.skippedBecauseConfirmed.length ? T(', {0} overgeslagen omdat je ze al bevestigd had', r.skippedBecauseConfirmed.length) : '', T('. Controleer ze hieronder en klik op "Klopt" of pas ze aan.')),
    r.unitHints.length ? h('div', {}, h('h3', {}, 'Gevonden bij kamers — wijs zelf toe in "Kamers"'), h('ul', { class: 'plain small' }, r.unitHints.map((hint) => h('li', {}, h('strong', {}, HINT_LABEL[hint.topic] || hint.topic), hint.value ? ` (${hint.value})` : '', ': ', h('em', { 'data-user-text': true }, hint.evidence))))) : null,
  ));
}));

// ------------------------------------------------------------------ Audit

const CHECK_LABEL = { pass: 'In orde', warn: 'Aandacht', fail: 'Probleem', info: 'Info' };
const PURPOSE_LABEL = { search: 'Zoeken', user_request: 'Op verzoek gebruiker', training: 'Modeltraining' };

$('#audit-form').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  $('#audit-result').replaceChildren(h('div', { class: 'card muted' }, 'Website wordt gecontroleerd…'));
  renderAudit(await api('/audit', { method: 'POST', body: { url: $('#audit-url').value.trim() || undefined } }));
}));

function renderAudit(report) {
  $('#audit-disclaimer').textContent = report.disclaimer;
  const order = { fail: 0, warn: 1, info: 2, pass: 3 };
  const checks = [...report.checks].sort((a, b) => order[a.status] - order[b.status]);
  $('#audit-result').replaceChildren(
    h('div', { class: 'card' },
      h('h2', {}, 'Resultaat ', h('span', { class: 'muted small' }, `${report.url} · ${fmtDate(report.checkedAt)}`)),
      h('div', { class: 'row' }, ['fail', 'warn', 'pass', 'info'].map((s) => h('span', { class: `chip ${s}` }, `${T(CHECK_LABEL[s])}: ${report.summary[s]}`))),
      checks.map((c) => h('div', { class: 'check' },
        h('div', {}, h('span', { class: `chip ${c.status}` }, CHECK_LABEL[c.status])),
        h('div', {}, h('strong', {}, c.title), h('div', { class: 'small' }, c.detail), c.advice ? h('div', { class: 'advice' }, c.advice) : null),
      )),
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'AI-crawlers in je robots.txt'),
      h('p', { class: 'muted small' }, 'Zoekcrawlers bepalen of je in AI-zoekresultaten kunt verschijnen. Trainingscrawlers mag je gerust blokkeren: dat heeft geen invloed op zoeken.'),
      h('table', { class: 'table' },
        h('tr', {}, h('th', {}, 'Crawler'), h('th', {}, 'Doel'), h('th', {}, 'Status'), h('th', {}, 'Wat het betekent')),
        report.crawlers.map((c) => h('tr', {},
          h('td', {}, h('strong', {}, c.userAgent), h('div', { class: 'muted small' }, c.operator)),
          h('td', {}, PURPOSE_LABEL[c.purpose]),
          h('td', {}, h('span', { class: `chip ${c.allowed ? 'pass' : c.purpose === 'training' ? 'info' : 'fail'}` }, c.allowed ? 'Toegestaan' : 'Geblokkeerd'), c.rule ? h('div', { class: 'muted small' }, c.rule) : null),
          h('td', { class: 'small' }, c.explanation),
        )),
      ),
    ),
  );
}

// ------------------------------------------------------------------ Requests

const REQ_STATUS = { new: ['Nieuw', 'unconfirmed'], accepted: ['Geboekt', 'confirmed'], declined: ['Afgewezen', 'unknown'], expired: ['Verlopen', 'unknown'], cancelled: ['Geannuleerd', 'fail'] };
const dayNl = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

async function loadRequests() {
  const [data, qs] = await Promise.all([api('/requests'), api('/questions')]);
  state.requests = data.requests;
  state.questions = qs.questions;
  state.stayPageUrl = data.stayPageUrl;
  const open = data.requests.filter((r) => r.status === 'new').length + qs.questions.filter((q) => q.status === 'open').length;
  $('#req-badge').textContent = open;
  $('#req-badge').hidden = !open;
  $('#requests-note').textContent = T(data.mailEnabled
    ? 'Je krijgt bij iedere nieuwe aanvraag een e-mail; de gast krijgt automatisch bericht als je accepteert of afwijst.'
    : 'E-mail staat uit: kijk hier regelmatig, en laat de gast zelf weten wat je besluit (of stel INNLI_SMTP_URL in).');
  renderRequests();
  renderQuestions();
  renderStayPage();
}

function renderQuestions() {
  const root = $('#questions-list');
  if (!state.questions.length) {
    root.replaceChildren(h('p', { class: 'muted' }, 'Nog geen vragen.'));
    return;
  }
  root.replaceChildren(...state.questions.map((q) => {
    const def = q.factKey ? state.catalog.find((d) => d.key === q.factKey) : null;
    const head = h('div', { class: 'head' },
      h('span', { class: `chip ${q.status === 'open' ? 'unconfirmed' : 'confirmed'}` }, q.status === 'open' ? 'Open' : q.answeredBy === 'assistant' ? 'Beantwoord door assistent' : 'Beantwoord'),
      q.kind === 'issue' ? h('span', { class: 'chip unknown' }, 'Melding: gegeven klopt mogelijk niet') : null,
      h('span', { class: 'muted small' }, T('via {0} · {1}', q.agentClient, fmtDate(q.createdAt)) + (def ? T(' · over: {0}', `${def.label}${q.unitName ? ` (${q.unitName})` : ''}`) : '')),
    );
    const box = h('div', { class: `request${q.status === 'open' ? ' is-new' : ''}` }, head, h('div', { class: 'msg', 'data-user-text': true }, q.question));
    if (q.status === 'answered') {
      box.append(h('div', { class: 'small pre-line' }, h('strong', {}, `${T(q.answeredBy === 'assistant' ? 'Antwoord van de assistent (uit je bevestigde gegevens):' : 'Jouw antwoord:')} `), h('span', { 'data-user-text': true }, q.answer)));
      return box;
    }
    const answer = h('textarea', { rows: q.draft ? 4 : 2, placeholder: 'Je antwoord aan de gast' }, q.draft ?? '');
    if (q.draft) box.append(h('p', { class: 'muted small' }, 'De assistent heeft alvast ingevuld wat bekend is. Vul aan wat ontbreekt.'));
    const faqBox = h('input', { type: 'checkbox' });
    let valueInput = null;
    if (def) {
      valueInput = def.type === 'boolean'
        ? h('select', {}, h('option', { value: '' }, '— niet in paspoort zetten —'), h('option', { value: 'true' }, 'Ja'), h('option', { value: 'false' }, 'Nee'))
        : h('input', { type: def.type === 'number' ? 'number' : 'text', placeholder: 'leeg = niet in paspoort zetten' });
    }
    const send = guard(async () => {
      if (!answer.value.trim()) throw new Error(T('Vul een antwoord in'));
      let factValue;
      if (valueInput && valueInput.value !== '') factValue = def.type === 'boolean' ? valueInput.value === 'true' : def.type === 'number' ? Number(valueInput.value) : valueInput.value;
      await api(`/questions/${encodeURIComponent(q.id)}/answer`, { method: 'POST', body: { answer: answer.value, factValue, publishAsFaq: faqBox.checked } });
      toast(T(factValue !== undefined ? 'Beantwoord en bevestigd in je paspoort' : 'Beantwoord'));
      await refresh();
      await loadRequests();
    });
    box.append(...[
      h('label', {}, q.replyEmail ? 'Antwoord (wordt naar de gast gemaild)' : 'Antwoord (agents zien dit bij check_status)', answer),
      valueInput ? h('label', {}, T('{0}: ook als bevestigd gegeven in je paspoort zetten', `${def.label}${def.unit ? ` (${def.unit === 'EUR' ? currencySymbol() : def.unit})` : ''}`), valueInput) : null,
      h('label', { class: 'check-row' }, faqBox, h('span', {}, 'Ook tonen als veelgestelde vraag, voor alle agents en gasten')),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary small', onclick: send }, 'Beantwoorden')),
    ].filter(Boolean));
    return box;
  }));
}

function renderRequests() {
  const root = $('#requests-list');
  if (!state.requests.length) {
    root.replaceChildren(h('p', { class: 'muted' }, 'Nog geen aanvragen. Gasten die via een AI-agent of je verblijfspagina komen, verschijnen hier.'));
    return;
  }
  // A group (several rooms, one stay) is shown as one card: decided together.
  const seenGroups = new Set();
  const list = state.requests.filter((r) => !r.groupId || (!seenGroups.has(r.groupId) && seenGroups.add(r.groupId)));
  root.replaceChildren(...list.map((r) => {
    const members = r.groupId ? state.requests.filter((x) => x.groupId === r.groupId) : [r];
    const [label, cls] = REQ_STATUS[r.status];
    const nights = Math.round((Date.parse(r.checkout) - Date.parse(r.checkin)) / 86400000);
    const sum = (k) => members.reduce((n, m) => n + m.guests[k], 0);
    const party = [T('{0} volw.', sum('adults')), sum('children') ? T('{0} kind.', sum('children')) : '', sum('dogs') ? T('{0} hond(en)', sum('dogs')) : ''].filter(Boolean).join(', ');
    const unitNames = members.map((m) => ((m.rooms ?? 1) > 1 ? `${m.rooms} × ${m.unitName}` : m.unitName)).join(' + ');
    const plan = r.ratePlanId ? state.property.ratePlans?.find((x) => x.id === r.ratePlanId) : null;
    const total = members.reduce((n, m) => n + m.quotedTotal, 0);
    const decide = (action) => guard(async () => {
      const note = prompt(T(action === 'accept' ? 'Bericht aan de gast (optioneel):' : 'Reden of alternatief voor de gast (optioneel):'), '');
      if (note === null) return;
      try {
        await api(`/requests/${encodeURIComponent(r.id)}/${action}`, { method: 'POST', body: { note } });
      } catch (err) {
        if (action === 'accept' && /Toch accepteren|Accept anyway/.test(err.message) && confirm(err.message)) {
          await api(`/requests/${encodeURIComponent(r.id)}/accept`, { method: 'POST', body: { note, force: true } });
        } else throw err;
      }
      toast(T(action === 'accept' ? 'Geaccepteerd: de nachten zijn gesloten in je kamerkalender' : 'Afgewezen'));
      await refresh();
      await loadRequests();
    });
    return h('div', { class: `request${r.status === 'new' ? ' is-new' : ''}` },
      h('div', { class: 'head' },
        h('span', { class: `chip ${cls}` }, label),
        h('strong', { 'data-user-text': true }, r.guest.name),
        h('span', { class: 'muted small', 'data-user-text': true }, [unitNames, `${dayNl(r.checkin)} – ${dayNl(r.checkout)} (${T(nights === 1 ? '{0} nacht' : '{0} nachten', nights)})`, party, r.breakfast ? T('ontbijt') : ''].filter(Boolean).join(' · ')),
      ),
      h('div', { class: 'small' },
        `${money(total)}${members.every((m) => m.quoteComplete) ? '' : ` ${T('(niet alle kosten bekend)')}`} · `,
        r.guest.email ? h('a', { href: `mailto:${r.guest.email}` }, r.guest.email) : h('span', { class: 'muted' }, T('gegevens verwijderd')),
        r.guest.phone ? ` · ${r.guest.phone}` : '',
        ` · ${T('ontvangen {0}', fmtDate(r.createdAt))}`,
        r.agentClient ? h('span', { class: 'muted' }, ` · ${T('via {0}', r.agentClient)}`) : '',
        r.handledBy ? h('span', { class: 'muted', 'data-user-text': true }, ` · ${T('afgehandeld door {0}', r.handledBy)}`) : '',
      ),
      r.guest.message ? h('div', { class: 'msg', 'data-user-text': true }, r.guest.message) : null,
      r.status === 'new' && r.holdUntil ? h('div', { class: 'small' }, T('Kamer vastgehouden tot {0}; daarna vervalt de aanvraag.', new Date(r.holdUntil).toLocaleString(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }))) : null,
      r.decidedBy === 'instant' ? h('div', { class: 'small muted' }, 'Direct bevestigd volgens je regels.') : null,
      plan ? h('div', { class: 'small' }, h('span', { class: 'chip info', 'data-user-text': true }, plan.name), plan.refundable ? '' : ` ${T('niet-restitueerbaar')}`) : null,
      r.extras?.length || r.discountCode ? h('div', { class: 'small', 'data-user-text': true }, [
        r.extras?.length ? `${T('Opties:')} ${r.extras.map((x) => `${x.qty > 1 ? `${x.qty} × ` : ''}${state.property.extras?.find((e) => e.id === x.id)?.name ?? x.id}`).join(', ')}` : '',
        r.discountCode ? `${T('Kortingscode:')} ${r.discountCode}` : '',
      ].filter(Boolean).join(' · ')) : null,
      r.replacesRequestId ? h('div', { class: 'small' }, h('span', { class: 'chip info' }, 'Wijziging'), ` ${T(r.status === 'new' ? 'Vervangt een eerdere boeking zodra je accepteert; tot dan blijft die gewoon staan.' : 'Vervangt een eerdere boeking of aanvraag.')}`) : null,
      r.groupId ? h('div', { class: 'small' }, h('span', { class: 'chip info' }, T('Groep van {0} kamers', members.length)), ` ${T('Je bevestigt of weigert alle kamers samen.')}`) : null,
      r.cancelReason ? h('div', { class: 'small muted' }, r.cancelReason === 'changed' ? T('Vervangen door een wijziging van de gast.') : T('Reden annulering: {0}', r.cancelReason)) : null,
      r.payment ? h('div', { class: 'small' },
        h('span', { class: `chip ${r.payment.status === 'paid' ? 'confirmed' : 'unconfirmed'}` }, r.payment.status === 'paid' ? 'Aanbetaling ontvangen' : 'Aanbetaling open'),
        ` ${money(r.payment.amountDue)} · ${T('uiterlijk {0}', dayNl(r.payment.dueDate))} `,
        r.payment.status === 'pending' && r.status === 'accepted' ? h('button', { class: 'btn small', onclick: guard(async () => {
          await api(`/requests/${encodeURIComponent(r.id)}/paid`, { method: 'POST', body: {} });
          toast('Aanbetaling als ontvangen gemarkeerd');
          await loadRequests();
        }) }, 'Ontvangen') : null,
      ) : null,
      r.ownerNote ? h('div', { class: 'small muted', 'data-user-text': true }, T('Jouw bericht: {0}', r.ownerNote)) : null,
      r.status === 'new' ? h('div', { class: 'actions' },
        h('button', { class: 'btn primary small', onclick: decide('accept') }, 'Accepteren'),
        h('button', { class: 'btn small', onclick: decide('decline') }, 'Afwijzen'),
      ) : null,
    );
  }));
}

function renderStayPage() {
  if (!state.stayPageUrl) return;
  $('#stay-url').value = state.stayPageUrl;
  $('#stay-open').href = state.stayPageUrl;
  $('#embed-code').value = `<iframe src="${state.stayPageUrl}?embed=1&lang=${state.property.language || 'nl'}" title="${T('Beschikbaarheid aanvragen bij {0}', state.property.name.replace(/"/g, ''))}" style="width:100%;min-height:950px;border:0"></iframe>`;
  $('#stay-page-card').hidden = !state.property.published;
}

// ------------------------------------------------------------------ Insights, conflicts, audit log

async function loadInsights() {
  const [ins, con] = await Promise.all([api('/insights'), api('/conflicts').catch(() => ({ conflicts: [] }))]);
  const alert = $('#conflicts');
  alert.hidden = !con.conflicts.length;
  alert.replaceChildren(
    h('h2', {}, 'Let op: mogelijke dubbele boeking'),
    h('ul', { class: 'plain' }, con.conflicts.map((c) => h('li', {}, T('{0}: {1} heeft via INNLI geboekt, maar {2} {3} ook bezet in een gekoppelde agenda.', c.unit, c.guest, c.nights.join(', '), T(c.nights.length === 1 ? 'is' : 'zijn'))))),
    h('p', { class: 'small' }, 'Tip: zet de exportlink van je kamerkalender (Kamers → Kamerkalender) in je andere kanalen, dan gebeurt dit niet meer.'),
  );

  const root = $('#insights');
  const host = ins.host;
  const hostLine = host.medianResponseHours !== null
    ? T('Je reageert gemiddeld binnen {0} uur{1}. Agents zien dit.', host.medianResponseHours, host.confirmationRate !== null ? T(' en bevestigt {0}% van de aanvragen', Math.round(host.confirmationRate * 100)) : '')
    : host.requestsLast180Days
      ? T('{0} aanvraag/aanvragen afgehandeld, zonder dat je zelf hoefde te reageren (direct bevestigen of verlopen).', host.requestsLast180Days)
      : T('Nog geen aanvragen afgehandeld. Snel reageren (of direct bevestigen) maakt je aantrekkelijker voor agents.');
  if (!ins.searchesInYourArea) {
    root.replaceChildren(h('p', { class: 'muted' }, 'Nog geen zoekopdrachten van agents in jouw omgeving. Zodra agents zoeken, zie je hier waar ze naar vragen en wat je kansen kost.'), h('p', { class: 'small' }, hostLine));
    return;
  }
  const max = Math.max(...ins.mostAskedFor.map((x) => x.count), 1);
  root.replaceChildren(
    h('p', {}, h('strong', {}, T('{0} zoekopdrachten', ins.searchesInYourArea)), T(' in jouw omgeving; {0}× werd je aan de gast getoond.', ins.shown)),
    h('p', { class: 'small' }, hostLine),
    h('div', { class: 'insight-grid' },
      h('div', {},
        h('h3', {}, 'Hier vragen gasten naar'),
        ins.mostAskedFor.length ? ins.mostAskedFor.map((x) => h('div', { class: 'bar' }, h('span', {}, x.label), h('span', { class: 'muted' }, x.count), h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${Math.round((x.count / max) * 100)}%` })))) : h('p', { class: 'muted small' }, 'Geen specifieke eisen.'),
      ),
      h('div', {},
        h('h3', {}, 'Dit kostte je gasten'),
        ins.missedBecauseUnknown.length
          ? h('ul', { class: 'plain small advice-list' }, ins.missedBecauseUnknown.map((x) => h('li', {}, x.advice, x.factsToConfirm.length ? [' ', h('button', { class: 'btn small', onclick: () => showTab(x.factsToConfirm.some((f) => /^(unit|bed|bathroom)\./.test(f.key) || f.key === 'access.stepsToUnit' || f.key === 'access.thresholdFree' || f.key === 'access.doorWidthCm') ? 'units' : 'passport') }, 'Bevestigen')] : null)))
          : h('p', { class: 'muted small' }, 'Niets onbekends: mooi.'),
        ins.missedBecauseNotOffered.length ? h('p', { class: 'small' }, h('strong', {}, `${T('Niet aangeboden:')} `), ins.missedBecauseNotOffered.map((x) => `${x.label} (${x.count}×)`).join(', '), '. Bewuste keuze? Dan is dat prima.') : null,
        ins.outcomes.filter((o) => o.outcome !== 'shown').length ? h('ul', { class: 'plain small' }, ins.outcomes.filter((o) => o.outcome !== 'shown').map((o) => h('li', {}, `${o.count}× ${o.label.toLowerCase()}`))) : null,
      ),
    ),
  );
}

const ASPECT_LABEL = { clean: 'Schoon', breakfast: 'Ontbijt', quiet: 'Rust', location: 'Ligging', value: 'Prijs/kwaliteit', host: 'Gastheer/-vrouw' };

async function loadReviews() {
  const [{ summary, reviews }, { entries }] = await Promise.all([api('/reviews'), api('/waitlist')]);
  const root = $('#reviews-list');
  const head = summary.count ? h('p', {}, h('strong', {}, `${'★'.repeat(Math.round(summary.average))} ${summary.average.toLocaleString(LOCALE)}`), T(' uit {0} beoordeling(en)', summary.count)) : h('p', { class: 'muted' }, 'Nog geen beoordelingen.');
  root.replaceChildren(...[head,
    ...reviews.map((r) => {
      const reply = h('input', { value: r.ownerReply ?? '', placeholder: 'Jouw reactie (optioneel)' });
      return h('div', { class: 'request' },
        h('div', { class: 'head' }, h('strong', {}, '★'.repeat(r.rating)), h('span', { class: 'muted small' }, T('{0} · verblijf {1}', r.guest, fmtDate(r.checkin)))),
        r.aspects ? h('div', { class: 'small muted' }, Object.entries(r.aspects).map(([a, v]) => `${T(ASPECT_LABEL[a] ?? a)} ${'★'.repeat(v)}`).join(' · ')) : null,
        r.text ? h('div', { class: 'msg', 'data-user-text': true }, r.text) : null,
        h('div', { class: 'row' }, reply, h('button', { class: 'btn small', onclick: guard(async () => { await api(`/reviews/${encodeURIComponent(r.requestId)}/reply`, { method: 'POST', body: { text: reply.value } }); toast(T('Reactie opgeslagen')); }) }, 'Reageren')),
      );
    }),
    entries.length ? h('p', { class: 'small' }, h('span', { class: 'chip info' }, 'Wachtlijst'), ` ${T('{0} gast(en) wachten op een vrije kamer; zij krijgen automatisch bericht zodra er iets vrijkomt.', entries.length)}`) : null,
  ].filter(Boolean));
}

async function loadAuditLog() {
  const { entries } = await api('/audit-log');
  const LABEL = { request_booking: 'Aanvraag verstuurd', cancel_request: 'Geannuleerd', ask_host: 'Vraag gesteld', join_waitlist: 'Op wachtlijst gezet', answer_question: 'Vraag beantwoord door assistent', modify_request: 'Wijziging gevraagd', report_data_issue: 'Fout gegeven gemeld' };
  $('#audit-log').replaceChildren(entries.length
    ? h('table', { class: 'table' }, h('tr', {}, h('th', {}, 'Moment'), h('th', {}, 'Agent'), h('th', {}, 'Actie'), h('th', {}, 'Details')),
        entries.slice(0, 50).map((e) => h('tr', {},
          h('td', { class: 'small' }, new Date(e.at).toLocaleString(LOCALE, { dateStyle: 'short', timeStyle: 'short' })),
          h('td', {}, e.agent),
          h('td', {}, LABEL[e.action] ? T(LABEL[e.action]) : e.action),
          h('td', { class: 'small muted' }, [e.requestId, e.questionId, e.result && T('resultaat: {0}', e.result), e.wasBooked ? T('was geboekt') : ''].filter(Boolean).join(' · ')),
        )))
    : h('p', { class: 'muted' }, 'Nog geen acties van agents.'));
}

// ------------------------------------------------------------------ Checklist

function renderChecklist() {
  const p = state.property;
  if (!p) return;
  if (state.me && state.me.role !== 'owner') { $('#checklist').hidden = true; return; }
  const lic = state.license?.state;
  const steps = [
    [p.units.length > 0, 'Kamers toevoegen', 'units'],
    [p.booking.connector.kind !== 'none', 'Beschikbaarheid regelen: kamerkalender, agenda\'s of boekingssysteem', 'booking'],
    [state.completeness.score >= 80, T('Beslissende gegevens bevestigen (nu {0}%, doel 80%)', state.completeness.score), 'passport'],
    [Boolean(p.contactEmail), 'E-mailadres voor aanvragen invullen', 'booking'],
    [p.published, 'Zichtbaar maken voor agents (schakelaar rechtsboven)', null],
    [lic === 'licensed' || lic === 'unconfigured', 'Licentie activeren voor de INNLI-gids', null],
  ];
  const todo = steps.filter(([done]) => !done).length;
  $('#checklist').hidden = todo === 0;
  $('#steps').replaceChildren(...steps.map(([done, text, tab]) => h('li', { class: done ? 'done' : '' },
    h('span', { class: 'tick' }, done ? '✓' : ''),
    h('span', { class: 'text' }, text),
    !done && tab ? h('button', { class: 'btn small', onclick: () => showTab(tab) }, 'Doen') : null,
  )));
}

$('#backup').addEventListener('click', guard(async () => {
  const res = await fetch('/api/owner/backup', { headers: { authorization: `Bearer ${state.key}` } });
  if (!res.ok) throw new Error(T('Back-up mislukt'));
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'innli-backup.json';
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  toast(T('Back-up gedownload. Bewaar hem op een veilige plek.'));
}));

// ------------------------------------------------------------------ Licence & guide

const LICENSE_CHIP = { licensed: 'confirmed', unconfigured: 'unknown', none: 'unconfirmed', updates_expired: 'warn', invalid: 'fail' };

function renderLicense(l) {
  state.license = l;
  renderChecklist();
  $('#license-state').textContent = l.title;
  $('#license-state').className = `chip ${LICENSE_CHIP[l.state] || 'unknown'}`;
  $('#license-detail').textContent = T('{0} Versie {1}.', l.detail, l.version);
  const g = l.guide || {};
  let text;
  if (!g.configured) text = T('Geen INNLI-gids ingesteld: agents vinden je alleen als ze rechtstreeks met deze installatie verbonden zijn.');
  else if (g.lastError) text = T('Gids: niet aangemeld ({0}).', g.lastError);
  else if (g.lastRegisteredAt) text = T('Gids: {0} accommodatie(s) vindbaar, laatst aangemeld {1}.', g.listed ?? 0, fmtDate(g.lastRegisteredAt));
  else text = T('Gids: nog niet aangemeld.');
  $('#guide-status').textContent = text;
  $('#guide-register').hidden = !g.configured;
  $('#license-form').hidden = l.state === 'unconfigured';
}

async function loadLicense() {
  renderLicense(await api('/license'));
}

$('#license-form').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const key = $('#license-key').value.trim();
  if (!key) throw new Error(T('Plak eerst je licentiesleutel'));
  renderLicense(await api('/license', { method: 'PUT', body: { license: key } }));
  $('#license-key').value = '';
  toast(T('Licentie geactiveerd'));
}));

$('#guide-register').addEventListener('click', guard(async () => {
  const r = await api('/guide/register', { method: 'POST', body: {} });
  renderLicense(r);
  toast(r.message, !r.ok);
}));

// ------------------------------------------------------------------ Analytics & preview

async function loadAnalytics() {
  if (!state.key) return;
  const f = await api('/analytics?days=30').catch(() => null);
  if (!f) return;
  const tile = (n, l) => h('div', { class: 'tile' }, h('div', { class: 'n' }, n), h('div', { class: 'l' }, l));
  const requests = f.agentRequests.searchImpressions + f.agentRequests.detailViews + f.agentRequests.availabilityChecks + f.agentRequests.quotes;
  $('#funnel').replaceChildren(
    tile(requests, 'Agentaanvragen'),
    tile(f.agentRequests.quotes, 'Prijsopgaven'),
    tile(f.clickThroughs, 'Doorkliks door gasten'),
    tile(f.confirmedBookings, 'Bevestigde boekingen'),
  );
  $('#funnel-note').textContent = `${f.note}${f.confirmedRevenue ? ` ${T('Gemelde omzet: {0}.', money(f.confirmedRevenue))}` : ''}`;
  const rows = Object.entries(f.byAgent);
  $('#by-agent').replaceChildren(
    rows.length ? h('tr', {}, h('th', {}, 'Agent'), h('th', {}, 'Aanvragen'), h('th', {}, 'Doorkliks'), h('th', {}, 'Boekingen')) : h('tr', {}, h('td', { class: 'muted' }, 'Nog geen agentactiviteit.')),
    ...rows.map(([name, r]) => h('tr', {}, h('td', {}, name), h('td', {}, r.requests), h('td', {}, r.clickThroughs), h('td', {}, r.bookings))),
  );
}

// ------------------------------------------------------------------ Stay wishes (2.0)

const LEVEL_CHIP = { met: 'confirmed', unverified: 'unconfirmed', unknown: 'unknown', not_met: 'unknown' };
const LEVEL_LABEL = { met: 'Bevestigd', unverified: 'Niet bevestigd', unknown: 'Onbekend', not_met: 'Niet aanwezig' };
const OFFER_STATUS = { open: 'Open', requested: 'Aanvraag ontvangen', withdrawn: 'Ingetrokken', expired: 'Verlopen' };

async function loadWishes() {
  const { wishes } = await api('/wishes');
  const fresh = wishes.filter((w) => !w.offers.some((o) => o.status === 'open' || o.status === 'requested')).length;
  $('#wish-badge').textContent = fresh;
  $('#wish-badge').hidden = !fresh;
  const root = $('#wishes-list');
  if (!wishes.length) {
    root.replaceChildren(h('p', { class: 'muted' }, 'Op dit moment zoekt geen agent iets dat bij jouw verblijf past. Nieuwe wensen verschijnen hier vanzelf, en met pushmeldingen aan krijg je bericht.'));
    return;
  }
  const canOffer = state.me?.role !== 'reception';
  root.replaceChildren(...wishes.map((w) => {
    const party = [T('{0} volw.', w.guests.adults), w.guests.children ? T('{0} kind(eren)', w.guests.children) : null, w.guests.dogs ? T('{0} hond(en)', w.guests.dogs) : null].filter(Boolean).join(', ');
    const when = w.checkin ? `${fmtDate(w.checkin)} – ${fmtDate(w.checkout)}` : T('tussen {0} en {1}{2}', fmtDate(w.flexibleDates.from), fmtDate(w.flexibleDates.to), w.flexibleDates.nights ? T(', {0} nachten', w.flexibleDates.nights) : w.flexibleDates.pattern ? ` (${T(w.flexibleDates.pattern === 'weekend' ? 'weekend' : w.flexibleDates.pattern === 'long_weekend' ? 'lang weekend' : 'midweek')})` : '');
    const budget = w.maxTotalPrice !== undefined ? new Intl.NumberFormat(LOCALE, { style: 'currency', currency: w.currency }).format(w.maxTotalPrice) : null;
    const unit = h('select', {}, state.property.units.map((u) => h('option', { value: u.id, selected: u.id === w.fit.unitId }, u.name)));
    const checkin = h('input', { type: 'date', value: w.checkin ?? w.flexibleDates?.from, min: w.flexibleDates?.from, max: w.flexibleDates?.to, disabled: Boolean(w.checkin) });
    // Flexible wishes: arrival and departure within the window, departure follows the wished number of nights.
    const nights = w.flexibleDates?.nights ?? { weekend: 2, long_weekend: 3, midweek: 4 }[w.flexibleDates?.pattern] ?? 1;
    const plusNights = (d) => (d ? new Date(Date.parse(`${d}T12:00:00Z`) + nights * 86_400_000).toISOString().slice(0, 10) : '');
    const checkout = h('input', { type: 'date', value: w.checkout ?? plusNights(checkin.value), min: w.flexibleDates?.from, max: w.flexibleDates?.to, disabled: Boolean(w.checkout) });
    if (!w.checkin) checkin.addEventListener('change', () => (checkout.value = plusNights(checkin.value)));
    const discount = h('input', { type: 'number', min: 0, max: 50, step: 1, value: 0 });
    const message = h('input', { maxlength: 500, placeholder: 'Persoonlijke boodschap (optioneel), bijv. "Ook de omheinde tuin is voor u alleen"' });
    const days = h('input', { type: 'number', min: 1, max: 14, value: 7 });
    const send = guard(async () => {
      const body = { unitId: unit.value, discountPercent: Number(discount.value) || 0, message: message.value || undefined, validDays: Number(days.value) || 7 };
      if (!w.checkin) Object.assign(body, { checkin: checkin.value, checkout: checkout.value });
      const { offer } = await api(`/wishes/${encodeURIComponent(w.id)}/offer`, { method: 'POST', body });
      toast(T('Aanbieding verstuurd: {0}', money(offer.total)));
      await loadWishes();
    });
    return h('div', { class: 'request' },
      h('div', { class: 'head' }, h('strong', {}, when), h('span', {}, ` · ${party}`), w.where ? h('span', { class: 'muted' }, ` · ${w.where}`) : null, h('span', { class: 'muted small' }, T(' · open tot {0} · via {1}', fmtDate(w.expiresAt), w.agent))),
      h('div', { class: 'small' }, w.requirements.length ? w.requirements.map((r) => h('span', { class: `chip ${LEVEL_CHIP[r.level] ?? 'unknown'}`, title: T(LEVEL_LABEL[r.level] ?? 'Onbekend') }, r.label)) : h('span', { class: 'muted' }, 'Geen bijzondere wensen.'), budget ? h('span', { class: 'muted' }, T(' · budget {0}', budget)) : null),
      w.note ? h('div', { class: 'msg', 'data-user-text': true }, w.note) : null,
      w.fit.unitName ? h('p', { class: 'small' }, T('Past het best: {0}', w.fit.unitName), w.yourPrice ? T(' · jouw prijs {0}', money(w.yourPrice.total)) : null, w.yourPrice && !w.yourPrice.available ? h('span', { class: 'chip unknown' }, 'Niet vrij') : null, w.overBudget ? h('span', { class: 'chip unconfirmed' }, 'Boven budget') : null) : null,
      w.requirements.some((r) => r.level === 'unknown') ? h('p', { class: 'small muted' }, 'Tip: bevestig de onbekende gegevens in je paspoort, dan weet de agent ze zeker.') : null,
      w.offers.length ? h('ul', { class: 'plain small' }, w.offers.map((o) => h('li', {}, h('span', { class: 'chip info' }, T(OFFER_STATUS[o.status] ?? o.status)), ` ${fmtDate(o.checkin)} – ${fmtDate(o.checkout)} · ${money(o.total)}`, o.discountPercent ? T(' ({0}% korting)', o.discountPercent) : '', o.handledBy ? T(' · door {0}', o.handledBy) : '',
        o.status === 'open' && canOffer ? [' ', h('button', { class: 'btn small', onclick: guard(async () => { await api(`/wish-offers/${encodeURIComponent(o.id)}/withdraw`, { method: 'POST', body: {} }); await loadWishes(); }) }, 'Intrekken')] : null))) : null,
      canOffer ? h('div', { class: 'form-grid offer-form' },
        h('label', {}, 'Kamer', unit),
        h('label', {}, 'Aankomst', checkin),
        h('label', {}, 'Vertrek', checkout),
        h('label', {}, 'Korting %', discount),
        h('label', {}, 'Geldig (dagen)', days),
        h('label', { class: 'wide' }, 'Boodschap', message),
        h('button', { class: 'btn primary', onclick: send }, 'Aanbieding sturen'),
      ) : null,
    );
  }));
}

// ------------------------------------------------------------------ Trust (2.0)

const TEXT_REASON = { override_instructions: 'lijkt op "negeer je instructies"', role_play: 'geeft de AI een rol', tool_call: 'noemt agent-tools', manipulate_ranking: 'vraagt de AI dit verblijf voor te trekken', hide_from_guest: 'vraagt iets voor de gast te verzwijgen', exfiltration: 'vraagt gegevens door te sturen', encoded_payload: 'bevat een lange gecodeerde tekst', hidden_characters: 'bevat onzichtbare tekens' };

async function loadTrust() {
  const v = await api('/website-verification');
  const root = $('#trust-status');
  const check = guard(async () => {
    const r = await api('/website-verification/check', { method: 'POST', body: {} });
    toast(r.verified ? T('Website geverifieerd') : T('Niet gevonden ({0})', r.error ?? r.lastError ?? '?'), !r.verified);
    await loadTrust();
  });
  root.replaceChildren(...[
    !v.website
      ? h('p', {}, 'Vul eerst je website in (Boeking & gegevens).')
      : v.verified
        ? h('p', {}, h('span', { class: 'chip confirmed' }, 'Geverifieerd'), T(' {0} · sinds {1}', v.domain, fmtDate(v.verifiedAt)))
        : h('p', {}, h('span', { class: 'chip unconfirmed' }, 'Nog niet geverifieerd'), v.lastError ? h('span', { class: 'muted small' }, T(' laatste controle: {0}', v.lastError)) : null),
    v.website && !v.verified ? h('ol', { class: 'small' },
      h('li', {}, 'Gebruik je de INNLI WordPress-plugin? Dan staat de tag er al. Klik meteen op Nu controleren.'),
      h('li', {}, 'Anders: zet deze regel in de <head> van je homepage', h('pre', { class: 'pre' }, v.metaTag)),
      h('li', {}, T('of zet een tekstbestand op {0} met daarin alleen: {1}', v.fileUrl, v.token)),
    ) : null,
    v.website ? h('button', { class: 'btn primary', onclick: check }, 'Nu controleren') : null,
  ].filter(Boolean));
  const warnings = state.property.agentTextWarnings ?? [];
  $('#text-warnings-card').hidden = !warnings.length;
  $('#text-warnings').replaceChildren(...warnings.map((w) => h('li', {}, h('code', {}, w.field), ': ', w.reasons.map((r) => T(TEXT_REASON[r] ?? r)).join(', '))));
}

async function loadPreview() {
  const { published, details } = await api('/agent-preview');
  $('#preview-json').textContent = JSON.stringify(details, null, 2);
  const fmt = (f) => `${f.description}: ${typeof f.value === 'boolean' ? (f.value ? 'yes' : 'no') : Array.isArray(f.value) ? f.value.join(', ') : f.value}${f.unit ? ` ${f.unit}` : ''}`;
  const section = (title, sheet) => h('div', {},
    h('h3', {}, title),
    h('ul', { class: 'plain small' }, sheet.facts.map((f) => h('li', {}, h('span', { class: `chip ${f.status}` }, STATUS_LABEL[f.status]), ' ', fmt(f)))),
    sheet.unknown.length ? h('p', { class: 'small' }, h('span', { class: 'chip unknown' }, 'Onbekend voor agents'), ' ', sheet.unknown.join(' · ')) : null,
  );
  $('#preview-summary').replaceChildren(h('div', {},
    published ? null : h('p', { class: 'chip warn' }, 'Let op: je verblijf is nog niet gepubliceerd. Agents zien het pas na publicatie.'),
    h('p', { class: 'small' }, h('strong', {}, `${T('Beschikbaarheid:')} `), details.booking.availabilitySource, ' · ', h('strong', {}, `${T('Boeken:')} `), details.booking.howToBook),
    section(T('Accommodatie'), details.facts),
    details.units.map((u) => section(T('{0} (max. {1} gasten, vanaf {2})', u.name, u.maxGuests, money(u.indicativeRatePerNight)), u.facts)),
  ));
}

// ------------------------------------------------------------------ Boot

async function boot() {
  const saved = getKey();
  if (saved) {
    try { await login(saved); return; } catch { logout(); }
  }
  $('#login').hidden = false;
  const setup = await fetch('/api/setup').then((r) => r.json()).catch(() => ({ needsSetup: false }));
  if (setup.needsSetup) $('#setup-form').elements.language.value = LANG;
  if (setup.needsSetup) {
    $('#login-form').hidden = true;
    $('#setup-form').hidden = false;
  }
}

$('#setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const err = $('#setup-error');
  err.hidden = true;
  const res = await fetch('/api/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-innli-lang': LANG },
    body: JSON.stringify({
      code: f.code.value, name: f.name.value, type: f.type.value, city: f.city.value, country: f.country.value.toUpperCase(), language: f.language.value,
      contactEmail: f.contactEmail.value, website: f.website.value,
      room: { name: f.roomName.value, maxGuests: Number(f.maxGuests.value), baseRatePerNight: Number(f.rate.value) },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { err.textContent = data.error || T('Er ging iets mis'); err.hidden = false; return; }
  $('#setup-form').hidden = true;
  $('#setup-done').hidden = false;
  $('#setup-key').value = data.ownerKey;
});
$('#setup-copy').addEventListener('click', guard(async () => { await navigator.clipboard.writeText($('#setup-key').value); toast(T('Gekopieerd')); }));
$('#setup-continue').addEventListener('click', guard(async () => {
  $('#setup-done').hidden = true;
  $('#login-form').hidden = false;
  await login($('#setup-key').value);
}));

boot();
