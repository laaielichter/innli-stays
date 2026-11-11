import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { checkReply, gradeTranscript, type Evidence, type Turn } from '../src/agent/guard.ts';
import { startTestServer, type TestServer } from './helpers.ts';

describe('the reply guard (check_reply)', () => {
  let server: TestServer;
  let search: Evidence, answer: Evidence, quote: Evidence, request: Evidence;
  let total: number;
  const codes = (message: string, evidence: Evidence[]) => checkReply({ message, evidence }).findings.map((f) => f.code);
  const tool = async (name: string, args: Record<string, unknown>) => {
    const res = await fetch(`${server.url}/api/agent/v1/tools/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${server.creds.agentKey}` }, body: JSON.stringify(args) });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };

  // Real answers from a running installation: the guard is tested against what INNLI actually returns.
  before(async () => {
    server = await startTestServer({ international: true });
    const call = async (name: string, args: Record<string, unknown>): Promise<Evidence> => ({ tool: name, args, result: (await tool(name, args)).body });
    let offset = 33;
    for (;;) {
      offset += 7;
      const d = new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      const dates = { checkin: d, checkout: new Date(Date.parse(d) + 3 * 86_400_000).toISOString().slice(0, 10) };
      quote = await call('get_quote', { propertyId: 'prop_seaview', unitId: 'harbour', ...dates, guests: { adults: 2, dogs: 1 }, hold: true });
      if (quote.result.quoteId) {
        search = await call('search_stays', { area: 'Dingle', ...dates, guests: { adults: 2, dogs: 1 }, requirements: ['enclosed_garden'], detail: 'brief' });
        break;
      }
      if (offset > 300) throw new Error('no free dates');
    }
    answer = await call('answer_question', { propertyId: 'prop_seaview', question: 'Is the garden fully enclosed for our dog?' });
    request = await call('request_booking', { quoteId: quote.result.quoteId, guest: { name: 'Emma Clarke', email: 'emma@example.com' }, guestConsent: true, consentHash: quote.result.consent.hash });
    total = quote.result.total;
    assert.equal(request.result.booked, false, 'this host decides, so the request is pending');
  });
  after(() => server.close());

  it('is an agent tool: over REST and MCP, nothing stored', async () => {
    const bad = await tool('check_reply', { message: 'Your stay is confirmed!', evidence: [quote, request] });
    assert.equal(bad.status, 200);
    assert.equal(bad.body.verdict, 'block');
    assert.equal(bad.body.findings[0].code, 'FALSE_BOOKING_CLAIM');
    const good = await tool('check_reply', { message: request.result.tellTheGuest, evidence: [quote, request] });
    assert.equal(good.body.verdict, 'ok');
    assert.equal((await tool('check_reply', { message: '', evidence: [] })).status, 400);
  });

  it('passes an honest reply', () => {
    const honest = `Seaview House Dingle fits your dates. The host confirmed that one dog is welcome. A fully enclosed garden is listed, but the host has not confirmed it, so I can't promise that. The total is €${total} for 3 nights, all mandatory costs included.`;
    assert.deepEqual(checkReply({ message: honest, evidence: [search, answer, quote] }), { verdict: 'ok', findings: [], language: 'en' });
    const pending = `Your request has been sent to Seaview House Dingle. This is not yet a booking: the room is held while the host decides.`;
    assert.deepEqual(checkReply({ message: pending, evidence: [search, answer, quote, request] }).findings, []);
    assert.deepEqual(checkReply({ message: request.result.tellTheGuest, evidence: [quote, request] }).findings, [], "INNLI's own wording passes");
    assert.deepEqual(checkReply({ message: quote.result.consent.summary, evidence: [quote] }).findings, [], 'and so does the consent summary');
  });

  it('blocks "it is booked" while the host has not confirmed', () => {
    const evidence = [quote, request];
    for (const claim of ['Great news: your stay is confirmed!', "I've booked the Harbour Room for you.", 'Your booking is confirmed. Enjoy Dingle!', "You're all set for December."]) {
      const v = checkReply({ message: claim, evidence });
      assert.equal(v.verdict, 'block', claim);
      assert.equal(v.findings[0].code, 'FALSE_BOOKING_CLAIM', claim);
      assert.match(v.findings[0].evidence, /booked: false/);
    }
    // Before any request there is nothing to confirm either.
    assert.deepEqual(codes('Done. Your room is booked.', [quote]), ['FALSE_BOOKING_CLAIM']);
    // Not claims: conditions, questions, and the host confirming a fact.
    for (const fine of ['It will be a booking once the host confirms.', 'Shall I book it?', 'The host confirmed that dogs are welcome.', 'Your stay is not confirmed yet.']) {
      assert.ok(!codes(fine, evidence).includes('FALSE_BOOKING_CLAIM'), fine);
    }
    // And once it is booked, saying so is right.
    const booked: Evidence = { tool: 'check_status', result: { status: 'accepted', booked: true } };
    assert.equal(checkReply({ message: 'Your stay is confirmed.', evidence: [quote, request, booked] }).verdict, 'ok');
  });

  it('blocks an amount the stay never gave', () => {
    const wrong = checkReply({ message: `The total is €${total - 16} for three nights.`, evidence: [quote] });
    assert.equal(wrong.findings[0].code, 'UNSUPPORTED_AMOUNT');
    assert.match(wrong.findings[0].fix, new RegExp(String(total)));
    assert.deepEqual(codes(`That is ${total} EUR in total, or €${Math.round((total / 3) * 100) / 100} a night.`, [quote]), [], 'the total and the price per night are both fair');
    assert.deepEqual(codes(`It comes to about €${total + 1}.`, [quote]), [], 'a rounded figure that says so is fine');
    assert.deepEqual(codes(`It comes to about €${total + 80}.`, [quote]), ['UNSUPPORTED_AMOUNT']);
  });

  it('blocks an unconfirmed fact told as certain', () => {
    const v = checkReply({ message: 'Good news: the garden is fully enclosed, so your dog can run free.', evidence: [search, answer] });
    assert.equal(v.verdict, 'block');
    assert.equal(v.findings[0].code, 'UNCONFIRMED_AS_FACT');
    assert.match(v.findings[0].fix, /not confirmed/);
    assert.deepEqual(codes('The garden is listed as enclosed, but the host has not confirmed that.', [search, answer]), []);
    assert.deepEqual(codes('The garden is fully enclosed. The host has not confirmed that, though.', [search, answer]), [], 'a hedge in the next sentence counts');
    assert.deepEqual(codes('Dogs are welcome: the host confirmed that.', [search, answer]), [], 'a confirmed fact may be stated');
    assert.deepEqual(codes('Is an enclosed garden a must for you?', [search, answer]), [], 'a question is not a claim');
  });

  it('flags a date the stay did not name, and a price without its disclosure', () => {
    const d = new Date(`${quote.args!.checkin}T12:00:00Z`);
    const right = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    const other = new Date(d.getTime() + 9 * 86_400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    assert.deepEqual(codes(`You arrive on ${right}.`, [quote]), []);
    assert.deepEqual(codes(`You arrive on ${other}.`, [quote]), ['WRONG_DATE']);
    const incomplete: Evidence = { tool: 'get_quote', result: { total: 200, currency: 'EUR', nights: 2, totalIncludesAllMandatoryCosts: false, cancellation: { refundability: 'non_refundable' }, lines: [] } };
    assert.deepEqual(codes('The total is €200.', [incomplete]), ['MISSING_PRICE_DISCLOSURE', 'MISSING_NON_REFUNDABLE']);
    assert.deepEqual(codes('It is €200, but not all mandatory costs are known, so it may be higher. This rate is non-refundable.', [incomplete]), []);
  });

  it('grades a whole conversation, including acting without a yes', () => {
    const good: Turn[] = [
      { role: 'guest', text: 'A B&B in Dingle with our dog, please.' },
      { role: 'tool', ...search },
      { role: 'agent', text: "Seaview House Dingle fits. Dogs are welcome; the enclosed garden is not confirmed by the host, so I can't promise it." },
      { role: 'tool', ...quote },
      { role: 'agent', text: `It is €${total} for 3 nights. Shall I send the request?` },
      { role: 'guest', text: 'Yes, book it.' },
      { role: 'tool', ...request },
      { role: 'agent', text: 'The request is sent. It is not a booking yet: the host decides.' },
    ];
    assert.deepEqual(gradeTranscript(good), { score: 100, verdict: 'ok', turns: [], counts: {} });

    const bad: Turn[] = [
      { role: 'guest', text: 'A B&B in Dingle with our dog, please.' },
      { role: 'tool', ...search },
      { role: 'agent', text: 'Seaview House Dingle is perfect: a fully enclosed garden for your dog.' },
      { role: 'tool', ...quote },
      { role: 'guest', text: 'Hmm, let me think about it.' },
      { role: 'tool', tool: 'request_booking', args: { quoteId: 'q', guestConsent: true }, result: request.result },
      { role: 'agent', text: `All done, your stay is confirmed for €${total - 20}!` },
      { role: 'tool', tool: 'cancel_request', args: {}, result: { status: 'cancelled', booked: false } },
    ];
    const grade = gradeTranscript(bad);
    assert.equal(grade.verdict, 'block');
    assert.deepEqual(grade.counts, { UNCONFIRMED_AS_FACT: 1, ACTED_WITHOUT_CONSENT: 1, NO_CONSENT_HASH: 1, FALSE_BOOKING_CLAIM: 1, UNSUPPORTED_AMOUNT: 1, CANCELLED_WITHOUT_REQUEST: 1 });
    assert.equal(grade.score, 0);
    assert.deepEqual(grade.turns.map((t) => t.turn), [2, 5, 6, 7]);
  });
});
