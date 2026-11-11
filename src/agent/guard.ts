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
 * the value in the evidence that contradicts them. English drafts only.
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
  unconfirmed: { label: string; words: string[]; unknown: boolean }[];
  incompletePrice: boolean;
  nonRefundable: boolean;
  quoted: boolean;
}

/** Words an agent uses for a fact, by key. Anything not listed falls back to the fact's own description. */
const FACT_WORDS: Record<string, string[]> = {
  'garden.fullyEnclosed': ['enclosed', 'fenced', 'fence', 'escape-proof', 'secure garden'],
  'garden.present': ['garden'],
  'pets.dogsAllowed': ['dogs are welcome', 'dog is welcome', 'dog-friendly', 'dog friendly', 'pet-friendly', 'pets allowed', 'dogs allowed', 'dogs are allowed'],
  'breakfast.included': ['breakfast is included', 'breakfast included', 'includes breakfast', 'with breakfast'],
  'parking.onSite': ['parking'],
  'parking.free': ['free parking'],
  'parking.evCharger': ['charger', 'ev charging', 'charging point'],
  'access.stepFree': ['step-free', 'step free', 'wheelchair', 'no steps', 'accessible'],
  'access.stepsToUnit': ['steps', 'stairs'],
  'bathroom.walkInShower': ['walk-in shower', 'walk in shower'],
  'unit.privateBathroom': ['private bathroom', 'en-suite', 'ensuite'],
  'unit.groundFloor': ['ground floor', 'ground-floor'],
  'location.quiet': ['quiet', 'peaceful'],
  'wifi.available': ['wifi', 'wi-fi'],
  'enclosed_garden': ['enclosed', 'fenced', 'fence'],
  'dogs_allowed': ['dogs are welcome', 'dog-friendly', 'dog friendly', 'dogs allowed', 'dogs are allowed'],
  'ground_floor_unit': ['ground floor', 'ground-floor'],
  'breakfast_included': ['breakfast is included', 'breakfast included', 'includes breakfast'],
  'step_free_access': ['step-free', 'step free', 'no steps', 'wheelchair'],
  'walk_in_shower': ['walk-in shower', 'walk in shower'],
  'quiet_location': ['quiet', 'peaceful'],
  'parking_on_site': ['parking'],
  'ev_charging': ['charger', 'ev charging', 'charging point'],
  'private_bathroom': ['private bathroom', 'en-suite', 'ensuite'],
};

const STOP = new Set(['about', 'above', 'after', 'available', 'cannot', 'could', 'every', 'guest', 'guests', 'included', 'maximum', 'minimum', 'number', 'other', 'property', 'there', 'their', 'these', 'which', 'within', 'without', 'booking', 'night', 'nights', 'person', 'stay', 'room', 'rooms', 'mandatory', 'allowed']);

function wordsFor(key: string, description?: string): string[] {
  if (FACT_WORDS[key]) return FACT_WORDS[key];
  // The longest ordinary words of the description: enough to recognise the subject.
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
  const words = wordsFor(key, description);
  if (!words.length) return;
  const label = description ?? key;
  if (!session.unconfirmed.some((u) => u.label === label)) session.unconfirmed.push({ label, words, unknown });
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

const sentences = (text: string) => text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z"'(€£$\d])|\n+/).map((s) => s.trim()).filter(Boolean);

const BOOKING_CLAIM = [
  /\b(your|the|this|that|our)\s+(stay|booking|room|reservation|trip|request)\b[^.!?]{0,60}?\b(is|are|has been|have been|was|'s)\s+(now\s+|all\s+|fully\s+)?(booked|confirmed|reserved|secured)\b/i,
  /\b(i|we)('ve| have)?\s+(just\s+|now\s+|successfully\s+)?(booked|reserved|secured)\b/i,
  /\byou('re| are)\s+(all\s+)?(booked|confirmed|set)\b/i,
  /\bbooking\s+(is\s+)?(confirmed|complete|completed|done)\b/i,
  /^(booked|confirmed|all set|done)\b[.!]/i,
  /\bit('s| is)\s+(booked|confirmed|reserved)\b/i,
];
const NOT_A_CLAIM = /\b(not|n't|never|yet|pending|once|when|if|until|unless|will|would|shall|should|can|could|may|might|want|whether|awaiting|waiting|as soon as|after the host|to be confirmed)\b/i;
const HEDGE = /\b(not (been )?(recently )?confirmed|unconfirmed|unverified|not verified|hasn't confirmed|has not confirmed|haven't confirmed|did not confirm|didn't confirm|can't promise|cannot promise|can't guarantee|cannot guarantee|not sure|unknown|don't know|do not know|not stated|hasn't said|has not said|not certain|listed|according to (the|their) (website|listing)|i('ll| will) ask|ask the host|check with the host|to be confirmed|may|might|possibly|apparently)\b/i;
const QUESTION = /\?\s*$/;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** Dates a draft names, as month-day pairs (and the year when it gives one). */
function datesIn(text: string): { quote: string; month: number; day: number; year?: number }[] {
  const out: { quote: string; month: number; day: number; year?: number }[] = [];
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.push({ quote: m[0], year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) });
  const month = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${month}\\b\\.?(?:,?\\s+(\\d{4}))?`, 'gi'))) out.push({ quote: m[0], day: Number(m[1]), month: MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, year: m[3] ? Number(m[3]) : undefined });
  for (const m of text.matchAll(new RegExp(`\\b${month}\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*(?:night|day|guest|adult|room))(?:,?\\s+(\\d{4}))?`, 'gi'))) out.push({ quote: m[0], day: Number(m[2]), month: MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, year: m[3] ? Number(m[3]) : undefined });
  return out;
}

/** Money a draft names: a currency sign or code next to a number. */
function amountsIn(text: string): { quote: string; value: number }[] {
  const out: { quote: string; value: number }[] = [];
  const num = '(\\d{1,3}(?:[,.\\s]\\d{3})*(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)';
  const parse = (raw: string) => {
    let s = raw.replace(/\s/g, '');
    // 1,234.50 or 1.234,50 or 1,234 or 12,50
    if (/[.,]\d{3}(?:[.,]|$)/.test(s) && !/^\d+[.,]\d{3}$/.test(s)) s = s.replace(/[.,](?=\d{3}(?:[.,]|$))/g, '');
    else if (/^\d{1,3}[.,]\d{3}$/.test(s)) s = s.replace(/[.,]/, '');
    return Number(s.replace(',', '.'));
  };
  for (const m of text.matchAll(new RegExp(`(?:[€£$]|\\b(?:EUR|GBP|USD|CHF|DKK|SEK|NOK|PLN|CZK|HUF|RON|ISK|CAD|AUD|NZD)\\b)\\s?${num}`, 'g'))) out.push({ quote: m[0], value: parse(m[1]) });
  for (const m of text.matchAll(new RegExp(`${num}\\s?(?:€|\\b(?:EUR|GBP|USD|CHF|DKK|SEK|NOK|PLN|CZK|HUF|RON|ISK|CAD|AUD|NZD|euros?|pounds?|dollars?)\\b)`, 'gi'))) out.push({ quote: m[0], value: parse(m[1]) });
  return out.filter((a) => Number.isFinite(a.value));
}

// ---------------------------------------------------------------- The check

/** Checks one draft reply against what the stay said in this conversation. */
export function checkReply(input: { message: string; evidence: Evidence[] }): Verdict {
  const session = sessionOf(input.evidence);
  const findings: Finding[] = [];
  const parts = sentences(input.message);

  // 1. "It is booked" when it is not.
  if (session.booked !== true) {
    for (const s of parts) {
      if (QUESTION.test(s) || NOT_A_CLAIM.test(s)) continue;
      const hit = BOOKING_CLAIM.map((re) => re.exec(s)).find(Boolean);
      if (hit) {
        findings.push({
          code: 'FALSE_BOOKING_CLAIM',
          severity: 'block',
          quote: hit[0],
          evidence: session.booked === false ? `The request is "${session.status}", booked: false.` : 'No booking request was sent in this conversation.',
          fix: session.booked === false ? 'Say that the request was sent and the room is held, and that it is a booking only once the host confirms.' : 'Do not say it is booked: nothing was requested yet.',
        });
        break;
      }
    }
  }

  // 2. An amount the stay never gave.
  if (session.quoted) {
    for (const a of amountsIn(input.message)) {
      const known = [...session.amounts].some((n) => Math.abs(n - a.value) < 0.006);
      // A rounded figure is fine only when it says so and is close.
      const rounded = /\b(about|around|roughly|approximately|approx\.?|some|nearly|almost|just (over|under))\s*$/i.test(input.message.slice(0, input.message.indexOf(a.quote))) && [...session.amounts].some((n) => Math.abs(n - a.value) <= Math.max(1, n * 0.02));
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
      if (d.month < 1) continue;
      if (!known.some((k) => k.month === d.month && k.day === d.day && (d.year === undefined || d.year === k.year))) {
        findings.push({ code: 'WRONG_DATE', severity: 'warn', quote: d.quote, evidence: `Dates the stay named: ${[...session.dates].sort().join(', ')}.`, fix: 'Check the date against the quote or the request before sending.' });
      }
    }
  }

  // 4. Something the host did not confirm, told as a fact.
  for (const fact of session.unconfirmed) {
    for (let i = 0; i < parts.length; i++) {
      const s = parts[i];
      const word = fact.words.find((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[- ]/g, '[- ]')}`, 'i').test(s));
      if (!word || QUESTION.test(s)) continue;
      // The hedge may sit in the same sentence or the one right after ("…but the host has not confirmed that.").
      if (HEDGE.test(s) || (parts[i + 1] && HEDGE.test(parts[i + 1]) && /\b(that|this|it)\b/i.test(parts[i + 1]))) continue;
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
  const namesAmount = amountsIn(input.message).length > 0;
  if (namesAmount && session.incompletePrice && !/\b(not all|may be higher|might be higher|could be higher|additional|extra (costs|charges|fees)|excluding|excl\.|not included|plus (any|local|tourist)|incomplete)\b/i.test(input.message)) {
    findings.push({ code: 'MISSING_PRICE_DISCLOSURE', severity: 'block', evidence: 'The quote says totalIncludesAllMandatoryCosts: false.', fix: 'Add that not all mandatory costs are known and the total may be higher.' });
  }
  if (namesAmount && session.nonRefundable && !/\bnon[- ]?refundable|no refund|cannot be refunded|can't be refunded|not refundable\b/i.test(input.message)) {
    findings.push({ code: 'MISSING_NON_REFUNDABLE', severity: 'warn', evidence: 'The quote is non-refundable.', fix: 'Say that this rate is non-refundable before the guest agrees.' });
  }

  return { verdict: findings.some((f) => f.severity === 'block') ? 'block' : findings.length ? 'warn' : 'ok', findings };
}

// ---------------------------------------------------------------- A whole conversation

export type Turn = { role: 'guest'; text: string } | { role: 'agent'; text: string } | ({ role: 'tool' } & Evidence);

const YES = /\b(yes|yeah|yep|sure|ok(ay)?|please do|go ahead|book it|do it|confirm|sounds good|let's do it|perfect|great,? (book|do))\b/i;
const NO = /\b(no|not yet|wait|hold on|don't|do not|stop|let me think|maybe later)\b/i;
const CANCEL = /\b(cancel|withdraw|call it off|don't want it|do not want it)\b/i;

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
      findings.push(...checkReply({ message: t.text, evidence }).findings);
    } else {
      if (t.tool === 'get_quote' || t.tool === 'search_stays') guestSinceQuote = '';
      if (t.tool === 'request_booking' || t.tool === 'complete_booking_session' || t.tool === 'commit_trip') {
        // The guest must have said yes after seeing the price, and not no.
        if (!YES.test(guestSinceQuote) || NO.test(guestSinceQuote)) {
          findings.push({ code: 'ACTED_WITHOUT_CONSENT', severity: 'block', quote: guestSinceQuote || undefined, evidence: 'No clear yes from the guest between the quote and the booking request.', fix: 'Show the consent summary and wait for a clear yes before sending the request.' });
        }
        if (t.tool === 'request_booking' && !t.args?.consentHash) findings.push({ code: 'NO_CONSENT_HASH', severity: 'warn', evidence: 'request_booking was called without consentHash.', fix: 'Pass consent.hash from the quote, so the request fails if the terms changed.' });
      }
      if (t.tool === 'cancel_request' && !CANCEL.test(lastGuest)) {
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
