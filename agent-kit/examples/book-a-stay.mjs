// The honest booking flow over REST, end to end. No dependencies; Node.js 20 or newer. MIT licence.
//
//   INNLI_URL=http://localhost:3000 node agent-kit/examples/book-a-stay.mjs "Haarlem"
//   ... add --book to really send the request (try it on the sample stays: npm run demo:intl)
//
// What it shows: search with requirements, facts with their status, an itemised quote, the consent
// summary the guest must see, a safe retry with Idempotency-Key, and an exact status afterwards.
import { randomUUID } from 'node:crypto';

const base = (process.env.INNLI_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const area = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'Haarlem';
const reallyBook = process.argv.includes('--book');
const key = process.env.INNLI_AGENT_KEY;

async function tool(name, args, headers = {}) {
  const res = await fetch(`${base}/api/agent/v1/tools/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers }, body: JSON.stringify(args) });
  const body = await res.json();
  if (!res.ok) {
    // Errors are typed: code, retryable, hint and nextTools say what to do, so there is nothing to guess.
    const error = new Error(`${name}: ${body.error} [${body.code}${body.retryable ? ', retryable' : ''}]${body.hint ? `\n  hint: ${body.hint}` : ''}`);
    error.code = body.code;
    throw error;
  }
  return body;
}

const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

// 1. Search once, briefly. Dates make it check availability and price.
const found = await tool('search_stays', { area, checkin: day(30), checkout: day(32), guests: { adults: 2 }, detail: 'brief', timeBudgetMs: 8000 });
if (!found.results?.length) {
  console.log(`Nothing found in ${area}. An agent would now offer post_stay_wish, so hosts can make an offer.`);
  process.exit(0);
}
const stay = found.results[0];
console.log(`Found: ${stay.name} (${stay.propertyId}), trust: ${stay.trust?.level}${stay.trust?.flags ? `, flags: ${stay.trust.flags.join(', ')}` : ''}`);

// 2. A quote with every mandatory cost, and a hold while the guest decides.
const quote = await tool('get_quote', { propertyId: stay.propertyId, unitId: stay.unit.id, checkin: day(30), checkout: day(32), guests: { adults: 2 }, hold: true });
console.log(`\nQuote ${quote.quoteId}: ${quote.total} ${quote.currency}${quote.totalIncludesAllMandatoryCosts ? ' (all mandatory costs included)' : ' (NOT all mandatory costs known: say so)'}`);
for (const line of quote.lines) console.log(`  ${String(line.amount).padStart(8)}  ${line.label}`);
console.log(`Cancellation: ${quote.cancellation?.refundability}${quote.cancellation?.freeUntil ? `, free until ${quote.cancellation.freeUntil}` : ''}`);

if (quote.bookingMode === 'booking_link') {
  // This property sells in its own booking system: the guest finishes there.
  const link = await tool('prepare_booking', { quoteId: quote.quoteId });
  console.log(`\nGive the guest this link: ${link.url}`);
  process.exit(0);
}

// 3. Show the guest this text word for word, and only continue after a clear yes.
console.log(`\nShow the guest:\n  ${quote.consent.summary}`);
if (!reallyBook) {
  console.log('\nStopped before booking. Run again with --book to send the request.');
  process.exit(0);
}

// 4. Book. The consent hash proves which terms the guest approved; the Idempotency-Key makes a retry safe.
const idempotencyKey = randomUUID();
const send = () => tool('request_booking', { quoteId: quote.quoteId, guest: { name: 'Example Guest', email: 'guest@example.com' }, guestConsent: true, consentHash: quote.consent.hash }, { 'idempotency-key': idempotencyKey });
const result = await send();
const retried = await send(); // e.g. after a timeout: the same booking, never a second one
console.log(`\n${result.tellTheGuest}`);
console.log(`Same request on retry: ${retried.requestId === result.requestId}`);

// 5. Be exact about the status. It is a booking only when booked is true.
const status = await tool('check_status', { statusToken: result.statusToken });
console.log(`Status: ${status.status}, booked: ${status.booked}. Signed record: ${status.signature.alg}, key ${status.signature.keyId}`);
