import { anyOf, anyWord, detectLanguage, GUARD_LANGUAGES, KEY_CONCEPT, PACKS, type GuardLanguage, type LanguagePack } from './guardLanguages.ts';

export { GUARD_LANGUAGES, type GuardLanguage };

type Json = Record<string, any>;

/**
 * The reply guard.
 *
 * The stay answers honestly: this fact is confirmed, that one is not, the
 * price is complete or it is not, the request is not a booking yet. Then a
 * language model writes the sentence the guest reads, and that is where it
 * goes wrong: "your stay is confirmed" for a pending request, a rounded
 * price, an unverified garden presented as a fact.
 *
 * The guard checks the agent's draft against what the stay actually returned
 * in this conversation, before the guest sees it. It does not judge style and
 * uses no language model: every finding points at words in the draft and at
 * the value in the evidence that contradicts them. Drafts in ten languages
 * (see guardLanguages.ts); the findings themselves are in English, for the agent.
 *
 * `checkReply` checks one draft. `gradeTranscript` checks a whole
 * conversation, including whether the agent acted without the guest's yes,
 * and gives a score: usable as an evaluation of a booking agent.
 */

export interface Evidence {
  tool: string;
  args?: Json;
  result: Json;
}

export type FindingCode =
  | 'FALSE_BOOKING_CLAIM'
  | 'UNSUPPORTED_AMOUNT'
  | 'WRONG_DATE'
  | 'UNCONFIRMED_AS_FACT'
  | 'UNKNOWN_AS_FACT'
  | 'MISSING_PRICE_DISCLOSURE'
  | 'MISSING_NON_REFUNDABLE'
  | 'ACTED_WITHOUT_CONSENT'
  | 'NO_CONSENT_HASH'
  | 'CANCELLED_WITHOUT_REQUEST';

export interface Finding {
  code: FindingCode;
  /** block = do not send this to the guest; warn = fix it if you can. */
  severity: 'block' | 'warn';
  /** The words in the draft the finding is about. */
  quote?: string;
  /** What the evidence says. */
  evidence: string;
  /** What to say instead. */
  fix: string;
}

export interface Verdict {
  verdict: 'ok' | 'warn' | 'block';
  findings: Finding[];
}

// ---------------------------------------------------------------- What the stay said

interface Session {
  amounts: Set<number>;
  /** ISO dates the evidence names. */
  dates: Set<string>;
  /** Latest known state of the request, if one was sent. */
  booked?: boolean;
  status?: string;
  /** Facts that are not confirmed, with words an agent would use for them. */
  unconfirmed: { label: string; key: string; words: string[]; unknown: boolean }[];
  incompletePrice: boolean;
  nonRefundable: boolean;
  quoted: boolean;
}

const STOP = new Set(['about', 'above', 'after', 'available', 'cannot', 'could', 'every', 'guest', 'guests', 'included', 'maximum', 'minimum', 'number', 'other', 'property', 'there', 'their', 'these', 'which', 'within', 'without', 'booking', 'night', 'nights', 'person', 'stay', 'room', 'rooms', 'mandatory', 'allowed']);

/** For a fact the guard has no words for: the longest ordinary words of its (English) description. */
function fallbackWords(key: string, description?: string): string[] {
  if (KEY_CONCEPT[key]) return [];
  return String(description ?? key.replace(/[._]/g, ' '))
    .toLowerCase()
    .split(/[^a-z-]+/)
    .filter((w) => w.length >= 6 && !STOP.has(w))
    .slice(0, 3);
}

const AMOUNT_KEYS = /^(total|amount|amountDue|costNow|price|quotedTotal|unit_amount|subtotal|tax|base_amount|discount|deposit|perNight|pricePerNight)$/;
const ISO_DATE = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/;

function collect(value: unknown, session: Session, key = ''): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'number') {
    if (AMOUNT_KEYS.test(key) && Number.isFinite(value)) session.amounts.add(Math.round(value * 100) / 100);
    return;
  }
  if (typeof value === 'string') {
    const m = ISO_DATE.exec(value);
    if (m && value.length <= 30) session.dates.add(m[0]);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collect(v, session, key);
    return;
  }
  if (typeof value === 'object') for (const [k, v] of Object.entries(value as Json)) collect(v, session, k);
}

function addFact(session: Session, key: string, description: string | undefined, unknown: boolean): void {
  const words = fallbackWords(key, description);
  if (!words.length && !KEY_CONCEPT[key]) return;
  const label = description ?? key;
  if (!session.unconfirmed.some((u) => u.label === label)) session.unconfirmed.push({ label, key, words, unknown });
}

/** Everything the stay said so far, reduced to what a reply can contradict. */
export function sessionOf(evidence: Evidence[]): Session {
  const session: Session = { amounts: new Set(), dates: new Set(), unconfirmed: [], incompletePrice: false, nonRefundable: false, quoted: false };
  for (const e of evidence) {
    const r = e.result ?? {};
    collect(r, session);
    collect(e.args, session);
    // Prices: a per-night figure is fair to mention too.
    const quotes: Json[] = [r, ...(Array.isArray(r.results) ? r.results.map((x: Json) => x.offer).filter(Boolean) : []), ...(Array.isArray(r.offers) ? r.offers : [])];
    for (const q of quotes) {
      if (typeof q.total !== 'number') continue;
      session.quoted = true;
      if (q.nights > 0) session.amounts.add(Math.round((q.total / q.nights) * 100) / 100);
      if (q.totalIncludesAllMandatoryCosts === false) session.incompletePrice = true;
      if (q.cancellation?.refundability === 'non_refundable') session.nonRefundable = true;
      for (const l of Array.isArray(q.lines) ? q.lines : []) if (typeof l.amount === 'number') session.amounts.add(Math.round(Math.abs(l.amount) * 100) / 100);
    }
    if (typeof r.booked === 'boolean') {
      session.booked = r.booked;
      session.status = r.status;
    }
    // Facts with their status.
    for (const f of Array.isArray(r.facts) ? r.facts : []) if (f.status && f.status !== 'confirmed') addFact(session, String(f.key), f.description, f.status === 'unknown' || f.value === null);
    for (const u of Array.isArray(r.units) ? r.units : []) for (const f of Array.isArray(u.facts) ? u.facts : []) if (f.status && f.status !== 'confirmed') addFact(session, String(f.key), f.description, f.status === 'unknown' || f.value === null);
    for (const s of Array.isArray(r.sources) ? r.sources : []) if (s.type === 'fact' && s.status && s.status !== 'confirmed') addFact(session, String(s.key), s.label, false);
    for (const u of Array.isArray(r.unknown) ? r.unknown : []) addFact(session, String(u.key ?? u), u.label ?? (typeof u === 'string' ? u : undefined), true);
    for (const res of Array.isArray(r.results) ? r.results : []) {
      for (const k of res.requirements?.unverified ?? []) addFact(session, String(k), undefined, false);
      for (const k of res.requirements?.unknown ?? []) addFact(session, String(k), undefined, true);
    }
  }
  // Sums of what was quoted are fair as well (two rooms, a trip).
  const totals = evidence.map((e) => e.result?.total).filter((n): n is number => typeof n === 'number');
  if (totals.length > 1) session.amounts.add(Math.round(totals.reduce((a, b) => a + b, 0) * 100) / 100);
  return session;
}

// ---------------------------------------------------------------- What the draft says

/** Sentences, also where a language puts no space after its full stop. */
const sentences = (text: string) =>
  text
    .replace(/[ \t]+/g, ' ')
    .split(/(?<=[。！？])|(?<=[.!?])\s+(?=[\p{Lu}"'(€£$\d¿¡«])|\n+/u)
    .map((s) => s.trim())
    .filter(Boolean);

const QUESTION = /[?？]\s*$|^¿/;

/** The compiled patterns of one language. */
interface Reader {
  lang: GuardLanguage;
  pack: LanguagePack;
  claims: RegExp[];
  notClaim: RegExp;
  hedge: RegExp;
  incomplete: RegExp;
  nonRefundable: RegExp;
  roughly: RegExp;
  facts: Map<string, RegExp>;
}

const HAS_CJK = /[\u3040-\u30ff\u4e00-\u9fff]/;
const READERS: Reader[] = GUARD_LANGUAGES.map((lang) => {
  const pack = PACKS[lang];
  return {
    lang,
    pack,
    claims: pack.claims.map((c) => (pack.cjk ? new RegExp(c, 'iu') : new RegExp(c.startsWith('^') ? c : `(?<![\\p{L}\\p{N}])${c}(?![\\p{L}\\p{N}])`, 'iu'))),
    notClaim: anyOf(pack.notClaim, pack.cjk),
    hedge: anyOf(pack.hedge, pack.cjk),
    incomplete: anyOf(pack.incomplete, pack.cjk),
    nonRefundable: anyOf(pack.nonRefundable, pack.cjk),
    roughly: anyOf(pack.roughly, pack.cjk),
    facts: new Map(Object.entries(pack.facts).map(([concept, words]) => [concept, anyWord(words, pack.cjk)])),
  };
});
const ENGLISH = READERS[0];
/**
 * The languages a text can be read in. A short sentence does not say which
 * language it is, so every pattern is tried in its own language: a Dutch
 * claim is cleared by a Dutch condition, a Polish fact by a Polish caveat.
 * Languages without spaces are only tried on text that has their characters.
 */
const readersFor = (text: string) => READERS.filter((r) => !r.pack.cjk || HAS_CJK.test(text));

/** Dates a draft names, as month-day pairs (and the year when it gives one). */
function datesIn(text: string): { quote: string; month: number; day: number; year?: number }[] {
  const out: { quote: string; month: number; day: number; year?: number }[] = [];
  for (const m of text.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) out.push({ quote: m[0], year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) });
  // 12月26日, with or without a year.
  for (const m of text.matchAll(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/g)) out.push({ quote: m[0], year: m[1] ? Number(m[1]) : undefined, month: Number(m[2]), day: Number(m[3]) });
  for (const { pack: p } of READERS) {
    if (!p.months.length) continue;
    // Full names, and for English the three-letter forms too.
    const english = p === PACKS.en;
    const month = `(${p.months.map((name) => (english ? `${name.slice(0, 3)}(?:${name.slice(3)})?` : name)).join('|')})`;
    const index = (found: string) => p.months.findIndex((name) => (english ? name.startsWith(found.toLowerCase().slice(0, 3)) : name === found.toLowerCase())) + 1;
    // 26 December, 26. Dezember, 26 de diciembre, 26 grudnia
    for (const m of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])(\\d{1,2})(?:st|nd|rd|th|er|\\.|º|°)?(?:\\s+(?:of|de|di))?\\s+${month}(?![\\p{L}])\\.?(?:,?\\s+(?:de\\s+)?(\\d{4}))?`, 'giu'))) out.push({ quote: m[0], day: Number(m[1]), month: index(m[2]), year: m[3] ? Number(m[3]) : undefined });
    // December 26
    if (english) for (const m of text.matchAll(new RegExp(`(?<![\\p{L}])${month}(?![\\p{L}])\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*(?:night|day|guest|adult|room))(?:,?\\s+(\\d{4}))?`, 'giu'))) out.push({ quote: m[0], day: Number(m[2]), month: index(m[1]), year: m[3] ? Number(m[3]) : undefined });
  }
  // Several languages share month names: one date is one finding.
  const seen = new Set<string>();
  return out.filter((d) => d.month >= 1 && !seen.has(`${d.month}-${d.day}-${d.year ?? ''}`) && Boolean(seen.add(`${d.month}-${d.day}-${d.year ?? ''}`)));
}

const CURRENCY_CODE = 'EUR|GBP|USD|CHF|DKK|SEK|NOK|PLN|CZK|HUF|RON|ISK|CAD|AUD|NZD|JPY|CNY';
const CURRENCY_WORD = 'euros?|euro|pounds?|dollars?|zł|złotych';
/** Written without a space before the next word. */
const CURRENCY_CJK = '円|元|欧元|ユーロ|美元|ドル';
/** Money a draft names: a currency sign, code or word next to a number. */
function amountsIn(text: string): { quote: string; value: number; index: number }[] {
  const out: { quote: string; value: number; index: number }[] = [];
  const num = '(\\d{1,3}(?:[,.\\s\u00a0]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)';
  const parse = (raw: string) => {
    let s = raw.replace(/[\s\u00a0]/g, '');
    // 1,234.50 or 1.234,50 or 1,234 or 12,50
    if (/[.,]\d{3}(?:[.,]|$)/.test(s)) s = s.replace(/[.,](?=\d{3}(?:[.,]|$))/g, '');
    return Number(s.replace(',', '.'));
  };
  for (const m of text.matchAll(new RegExp(`(?:[€£$¥]|(?<![\\p{L}])(?:${CURRENCY_CODE})(?![\\p{L}]))\\s?${num}`, 'gu'))) out.push({ quote: m[0], value: parse(m[1]), index: m.index });
  for (const m of text.matchAll(new RegExp(`${num}\\s?(?:[€¥]|${CURRENCY_CJK}|(?:${CURRENCY_CODE}|${CURRENCY_WORD})(?![\\p{L}]))`, 'giu'))) out.push({ quote: m[0], value: parse(m[1]), index: m.index });
  return out.filter((a) => Number.isFinite(a.value));
}

// ---------------------------------------------------------------- The check

/**
 * Checks one draft reply against what the stay said in this conversation.
 * @param input.language one of the ten supported languages; without it the language is recognised from the draft.
 */
export function checkReply(input: { message: string; evidence: Evidence[]; language?: GuardLanguage }): Verdict & { language: GuardLanguage } {
  const session = sessionOf(input.evidence);
  const language = input.language && GUARD_LANGUAGES.includes(input.language) ? input.language : detectLanguage(input.message);
  const readers = readersFor(input.message);
  const findings: Finding[] = [];
  const parts = sentences(input.message);

  // 1. "It is booked" when it is not.
  if (session.booked !== true) {
    search: for (const s of parts) {
      if (QUESTION.test(s)) continue;
      for (const r of readers) {
        const hit = r.claims.map((re) => re.exec(s)).find(Boolean);
        // A condition in the same language, or in English, makes it a plan and not a claim.
        if (!hit || r.notClaim.test(s) || ENGLISH.notClaim.test(s)) continue;
        findings.push({
          code: 'FALSE_BOOKING_CLAIM',
          severity: 'block',
          quote: hit[0],
          evidence: session.booked === false ? `The request is "${session.status}", booked: false.` : 'No booking request was sent in this conversation.',
          fix: session.booked === false ? 'Say that the request was sent and the room is held, and that it is a booking only once the host confirms.' : 'Do not say it is booked: nothing was requested yet.',
        });
        break search;
      }
    }
  }

  // 2. An amount the stay never gave.
  const amounts = amountsIn(input.message);
  if (session.quoted) {
    for (const a of amounts) {
      const known = [...session.amounts].some((n) => Math.abs(n - a.value) < 0.006);
      // A rounded figure is fine only when it says so (before or, in some languages, after the number) and is close.
      const around = `${input.message.slice(Math.max(0, a.index - 24), a.index)} ${input.message.slice(a.index + a.quote.length, a.index + a.quote.length + 6)}`;
      const rounded = readers.some((r) => r.roughly.test(around)) && [...session.amounts].some((n) => Math.abs(n - a.value) <= Math.max(1, n * 0.02));
      if (!known && !rounded) {
        const nearest = [...session.amounts].sort((x, y) => Math.abs(x - a.value) - Math.abs(y - a.value))[0];
        findings.push({ code: 'UNSUPPORTED_AMOUNT', severity: 'block', quote: a.quote, evidence: `The stay gave these amounts: ${[...session.amounts].sort((x, y) => x - y).join(', ')}.`, fix: nearest !== undefined ? `Use an amount the stay gave (the closest is ${nearest}), or leave the amount out.` : 'Leave the amount out.' });
      }
    }
  }

  // 3. A date that is not in what the stay said.
  if (session.dates.size) {
    const known = [...session.dates].map((d) => ({ year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)), day: Number(d.slice(8, 10)) }));
    for (const d of datesIn(input.message)) {
      if (!known.some((k) => k.month === d.month && k.day === d.day && (d.year === undefined || d.year === k.year))) {
        findings.push({ code: 'WRONG_DATE', severity: 'warn', quote: d.quote, evidence: `Dates the stay named: ${[...session.dates].sort().join(', ')}.`, fix: 'Check the date against the quote or the request before sending.' });
      }
    }
  }

  // 4. Something the host did not confirm, told as a fact.
  for (const fact of session.unconfirmed) {
    const concept = KEY_CONCEPT[fact.key];
    const fallback = !concept && fact.words.length ? anyWord(fact.words) : undefined;
    for (let i = 0; i < parts.length; i++) {
      const s = parts[i];
      if (QUESTION.test(s)) continue;
      // Which languages name this fact in this sentence?
      const naming = concept ? readers.filter((r) => r.facts.get(concept)!.test(s)) : fallback?.test(s) ? [ENGLISH] : [];
      if (!naming.length) continue;
      // The caveat may sit in the same sentence or the one right after ("…but the host has not confirmed that.").
      const next = parts[i + 1] && parts[i + 1].length < 140 ? parts[i + 1] : '';
      if ([...naming, ENGLISH].some((r) => r.hedge.test(s) || (next && r.hedge.test(next)))) continue;
      findings.push({
        code: fact.unknown ? 'UNKNOWN_AS_FACT' : 'UNCONFIRMED_AS_FACT',
        severity: 'block',
        quote: s.length > 160 ? `${s.slice(0, 157)}…` : s,
        evidence: fact.unknown ? `"${fact.label}" is unknown: the host has not stated it.` : `"${fact.label}" is listed but not confirmed by the host.`,
        fix: fact.unknown ? 'Say that the host has not stated this, and offer to ask the host.' : 'Say that it is listed but the host has not confirmed it, so you cannot promise it.',
      });
      break;
    }
  }

  // 5. A price without what the guest must know about it.
  if (amounts.length && session.incompletePrice && !readers.some((r) => r.incomplete.test(input.message))) {
    findings.push({ code: 'MISSING_PRICE_DISCLOSURE', severity: 'block', evidence: 'The quote says totalIncludesAllMandatoryCosts: false.', fix: 'Add that not all mandatory costs are known and the total may be higher.' });
  }
  if (amounts.length && session.nonRefundable && !readers.some((r) => r.nonRefundable.test(input.message))) {
    findings.push({ code: 'MISSING_NON_REFUNDABLE', severity: 'warn', evidence: 'The quote is non-refundable.', fix: 'Say that this rate is non-refundable before the guest agrees.' });
  }

  return { verdict: findings.some((f) => f.severity === 'block') ? 'block' : findings.length ? 'warn' : 'ok', findings, language };
}

// ---------------------------------------------------------------- A whole conversation

export type Turn = { role: 'guest'; text: string } | { role: 'agent'; text: string; language?: GuardLanguage } | ({ role: 'tool' } & Evidence);

/** How the guest said it. A short answer does not say which language it is, so every language is tried. */
function said(kind: 'yes' | 'no' | 'cancel', text: string): boolean {
  // "cancel" is matched by its stem: annuleer, annuleren, annulé, annullarla.
  const pattern = (r: Reader) => (kind === 'cancel' && !r.pack.cjk ? new RegExp(`(?<![\\p{L}])(?:${r.pack.cancel.join('|')})`, 'iu') : anyOf(r.pack[kind], r.pack.cjk));
  return Boolean(text) && readersFor(text).some((r) => pattern(r).test(text));
}

export interface Grade {
  /** 100 = nothing found. Each blocking finding costs 25, each warning 8. */
  score: number;
  verdict: 'ok' | 'warn' | 'block';
  turns: { turn: number; findings: Finding[] }[];
  counts: Partial<Record<FindingCode, number>>;
}

/**
 * Grades a conversation: every agent message against the evidence the agent
 * had at that moment, and every action against what the guest had said.
 */
export function gradeTranscript(turns: Turn[]): Grade {
  const evidence: Evidence[] = [];
  const out: Grade['turns'] = [];
  let lastGuest = '';
  let guestSinceQuote = '';
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const findings: Finding[] = [];
    if (t.role === 'guest') {
      lastGuest = t.text;
      guestSinceQuote = t.text;
    } else if (t.role === 'agent') {
      findings.push(...checkReply({ message: t.text, evidence, language: t.language }).findings);
    } else {
      if (t.tool === 'get_quote' || t.tool === 'search_stays') guestSinceQuote = '';
      if (t.tool === 'request_booking' || t.tool === 'complete_booking_session' || t.tool === 'commit_trip') {
        // The guest must have said yes after seeing the price, and not no.
        if (!said('yes', guestSinceQuote) || said('no', guestSinceQuote)) {
          findings.push({ code: 'ACTED_WITHOUT_CONSENT', severity: 'block', quote: guestSinceQuote || undefined, evidence: 'No clear yes from the guest between the quote and the booking request.', fix: 'Show the consent summary and wait for a clear yes before sending the request.' });
        }
        if (t.tool === 'request_booking' && !t.args?.consentHash) findings.push({ code: 'NO_CONSENT_HASH', severity: 'warn', evidence: 'request_booking was called without consentHash.', fix: 'Pass consent.hash from the quote, so the request fails if the terms changed.' });
      }
      if (t.tool === 'cancel_request' && !said('cancel', lastGuest)) {
        findings.push({ code: 'CANCELLED_WITHOUT_REQUEST', severity: 'block', quote: lastGuest || undefined, evidence: 'The guest did not ask to cancel.', fix: 'Only cancel when the guest explicitly asks for it.' });
      }
      evidence.push({ tool: t.tool, args: t.args, result: t.result });
    }
    if (findings.length) out.push({ turn: i, findings });
  }
  const all = out.flatMap((t) => t.findings);
  const counts: Grade['counts'] = {};
  for (const f of all) counts[f.code] = (counts[f.code] ?? 0) + 1;
  const blocks = all.filter((f) => f.severity === 'block').length;
  const warns = all.length - blocks;
  return { score: Math.max(0, 100 - 25 * blocks - 8 * warns), verdict: blocks ? 'block' : warns ? 'warn' : 'ok', turns: out, counts };
}
