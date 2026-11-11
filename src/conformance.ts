#!/usr/bin/env node
import { generateKeyPairSync } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { DIRECTORY_PATH, jwkThumbprint, signRequest } from './agent/botAuth.ts';
import { verifyRecord } from './security/signing.ts';

/**
 * Conformance check: does an address behave the way an agent platform may
 * expect from an INNLI installation? It only reads and never books, so it is
 * safe to run against a live installation:
 *
 *   npx innli-conformance https://stay.example
 *
 * Every check names what an agent relies on. Exit code 1 when one fails.
 */

export interface Check {
  id: string;
  title: string;
  ok: boolean;
  detail?: string;
}

type Json = Record<string, any>;

export async function runConformance(baseUrl: string, opts: { fetcher?: typeof fetch; agentKey?: string } = {}): Promise<Check[]> {
  const base = baseUrl.replace(/\/$/, '');
  const f = opts.fetcher ?? fetch;
  const auth: Record<string, string> = opts.agentKey ? { authorization: `Bearer ${opts.agentKey}` } : {};
  const checks: Check[] = [];
  const check = async (id: string, title: string, run: () => Promise<string | void>) => {
    try {
      checks.push({ id, title, ok: true, detail: (await run()) ?? undefined });
    } catch (err) {
      checks.push({ id, title, ok: false, detail: (err as Error).message });
    }
  };
  const expect = (condition: unknown, message: string) => {
    if (!condition) throw new Error(message);
  };
  const getJson = async (path: string): Promise<Json> => {
    const res = await f(`${base}${path}`, { headers: auth, signal: AbortSignal.timeout(15_000) });
    expect(res.ok, `GET ${path} answered ${res.status}`);
    return (await res.json()) as Json;
  };
  const tool = (name: string, args: Json, headers: Record<string, string> = {}) =>
    f(`${base}/api/agent/v1/tools/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth, ...headers }, body: JSON.stringify(args), signal: AbortSignal.timeout(30_000) });

  let signingKey = '';
  await check('health', 'Health and version', async () => {
    const h = await getJson('/health');
    expect(h.ok === true && typeof h.version === 'string', 'no { ok: true, version }');
    return `version ${h.version}`;
  });
  await check('signing-key', 'Signing key at /.well-known/innli.json', async () => {
    const w = await getJson('/.well-known/innli.json');
    expect(typeof w.signingKey === 'string' && w.signingKey.length > 40, 'signingKey missing');
    signingKey = w.signingKey;
  });
  await check('discovery', 'Agent card, MCP server card and llms.txt', async () => {
    const card = await getJson('/.well-known/agent-card.json');
    expect(Array.isArray(card.skills) && card.skills.length > 0, 'agent card has no skills');
    const mcp = await getJson('/.well-known/mcp.json');
    expect(String(mcp.endpoints?.streamableHttp).endsWith('/mcp'), 'server card has no MCP endpoint');
    const llms = await f(`${base}/llms.txt`);
    expect(llms.ok && (await llms.text()).startsWith('# '), 'llms.txt missing');
  });
  await check('key-directory', 'Key directory (RFC 9421) matches the signing key', async () => {
    const dir = await getJson(DIRECTORY_PATH);
    const key = dir.keys?.[0];
    expect(key?.kty === 'OKP' && key.crv === 'Ed25519', 'no Ed25519 key in the directory');
    expect(key.kid === jwkThumbprint(key), 'kid is not the RFC 7638 thumbprint');
  });
  await check('openapi', 'OpenAPI 3.1 description of the tools', async () => {
    const api = await getJson('/api/agent/v1/openapi.json');
    const paths = Object.keys(api.paths ?? {});
    for (const t of ['search_stays', 'get_quote', 'request_booking', 'check_status']) expect(paths.some((p) => p.endsWith(`/${t}`)), `tool ${t} is not described`);
    return `${paths.length} tools`;
  });
  await check('mcp', 'MCP: full and core profile', async () => {
    const list = async (path: string) => {
      const client = new Client({ name: 'innli-conformance', version: '1' });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}${path}`), { requestInit: { headers: auth } }));
      try {
        return (await client.listTools()).tools;
      } finally {
        await client.close();
      }
    };
    const full = await list('/mcp');
    const core = await list('/mcp?profile=core');
    expect(full.length > core.length && core.length > 0, `full ${full.length} tools, core ${core.length}`);
    expect(full.every((t) => t.annotations && typeof t.annotations.readOnlyHint === 'boolean'), 'a tool has no readOnlyHint');
    return `${full.length} tools, core ${core.length}`;
  });
  await check('typed-errors', 'Typed errors and RateLimit headers', async () => {
    const res = await tool('get_stay_details', { propertyId: 'prop_conformance_does_not_exist' });
    const body = (await res.json()) as Json;
    expect(res.status === 404 && body.code === 'NOT_FOUND', `expected 404 NOT_FOUND, got ${res.status} ${body.code}`);
    expect(typeof body.retryable === 'boolean' && typeof body.error === 'string', 'error has no retryable flag or readable message');
    expect(res.headers.get('ratelimit-policy') && res.headers.get('ratelimit'), 'no RateLimit headers');
    expect(res.headers.get('x-request-id'), 'no x-request-id');
  });
  await check('agent-identity', 'Web Bot Auth signatures are checked', async () => {
    const plain = await tool('search_stays', { limit: 1 });
    await plain.arrayBuffer();
    expect(plain.headers.get('x-innli-agent-identity'), 'no x-innli-agent-identity header');
    // A signature whose key directory cannot exist: a verifying server says so; one that ignores signatures does not.
    const signed = signRequest(generateKeyPairSync('ed25519').privateKey, 'https://conformance.invalid', `${base}/api/agent/v1/tools/search_stays`);
    const res = await tool('search_stays', { limit: 1 }, signed);
    await res.arrayBuffer();
    const identity = String(res.headers.get('x-innli-agent-identity'));
    expect(res.status === 200, `a request with an unverifiable signature must still be served, got ${res.status}`);
    expect(identity.startsWith('invalid'), `expected "invalid; reason=…", got "${identity}"`);
    return identity;
  });
  await check('idempotency', 'Idempotency-Key: replay and conflict', async () => {
    const key = `conformance-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const first = await tool('search_stays', { limit: 1 }, { 'idempotency-key': key });
    await first.arrayBuffer();
    const again = await tool('search_stays', { limit: 1 }, { 'idempotency-key': key });
    await again.arrayBuffer();
    expect(again.headers.get('idempotent-replayed') === 'true', 'a retry was not answered from the first result');
    const other = await tool('search_stays', { limit: 2 }, { 'idempotency-key': key });
    await other.arrayBuffer();
    expect(other.status === 409, `the same key with another body must give 409, got ${other.status}`);
  });
  let propertyId = '';
  await check('search', 'Search answers with freshness, trust and next actions', async () => {
    const res = await tool('search_stays', { limit: 3 });
    const body = (await res.json()) as Json;
    expect(res.ok && Array.isArray(body.results), 'search_stays has no results array');
    if (!body.results.length) return 'no published stays: the remaining stay checks are skipped';
    const r = body.results[0];
    propertyId = r.propertyId;
    expect(r.trust?.level, 'a result has no trust block');
    expect(body.freshness, 'no freshness');
    expect(Array.isArray(body.nextActions ?? r.nextActions), 'no nextActions');
    return `${body.results.length} stay(s)`;
  });
  await check('passport', 'Signed passport verifies', async () => {
    if (!propertyId) return 'skipped';
    const p = await getJson(`/api/public/properties/${encodeURIComponent(propertyId)}/passport`);
    const signed = p.signed ?? p;
    expect(signed.record && signed.signature?.value, 'passport has no record and signature');
    expect(verifyRecord(signingKey, signed.record, signed.signature.value), 'the signature does not verify with the published key');
  });
  await check('quote', 'Details state facts with a status and unknowns', async () => {
    if (!propertyId) return 'skipped';
    const d = (await (await tool('get_stay_details', { propertyId })).json()) as Json;
    expect(Array.isArray(d.units) && d.units.length, 'no units');
    expect(JSON.stringify(d).includes('"confirmed"') || JSON.stringify(d).includes('unknown'), 'facts carry no status');
  });
  await check('ucp', 'UCP profile and booking sessions', async () => {
    const profile = await getJson('/.well-known/ucp');
    const service = profile.ucp?.services?.['dev.ucp.lodging']?.[0];
    expect(service?.transport === 'rest' && typeof service.endpoint === 'string', 'no dev.ucp.lodging REST service');
    expect(profile.ucp.capabilities?.['dev.ucp.lodging.booking'], 'capability dev.ucp.lodging.booking not advertised');
    const endpoint = String(service.endpoint).replace(/^https?:\/\/[^/]+/, base);
    const noAgent = await f(`${endpoint}/booking-sessions`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: '{}' });
    expect(noAgent.status === 400 && ((await noAgent.json()) as Json).code === 'missing_ucp_agent', 'a request without UCP-Agent must give 400 missing_ucp_agent');
    const headers = { 'content-type': 'application/json', 'ucp-agent': 'profile="https://conformance.invalid/profile"', ...auth };
    const missing = await f(`${endpoint}/booking-sessions/bks_conformance_unknown`, { headers });
    expect(missing.status === 404, `an unknown session must give 404, got ${missing.status}`);
    const outcome = await f(`${endpoint}/booking-sessions`, { method: 'POST', headers, body: JSON.stringify({ property: { id: 'prop_conformance_does_not_exist' }, stays: [{ accommodation_type: { id: 'x' }, occupancy: { adults: 2 }, stay_dates: { start_date: '2099-01-01', end_date: '2099-01-02' } }] }) });
    const body = (await outcome.json()) as Json;
    expect(outcome.status === 200 && body.ucp?.status === 'error' && body.messages?.[0]?.severity, 'a business outcome must come as HTTP 200 with ucp.status "error" and messages');
    const viaMcp = profile.ucp.services['dev.ucp.lodging'].find((x: Json) => x.transport === 'mcp');
    if (viaMcp) {
      const client = new Client({ name: 'innli-conformance', version: '1' });
      await client.connect(new StreamableHTTPClientTransport(new URL(String(viaMcp.endpoint).replace(/^https?:\/\/[^/]+/, base)), { requestInit: { headers: auth } }));
      try {
        const names = (await client.listTools()).tools.map((t) => t.name);
        for (const t of ['create_booking_session', 'get_booking_session', 'update_booking_session', 'complete_booking_session', 'cancel_booking_session']) expect(names.includes(t), `UCP over MCP lacks ${t}`);
      } finally {
        await client.close();
      }
    }
    return `UCP ${profile.ucp.version}${viaMcp ? ', REST and MCP' : ', REST'}`;
  });
  await check('acp', 'ACP discovery and checkout sessions', async () => {
    const disco = await getJson('/.well-known/acp.json');
    expect(disco.protocol?.name === 'acp' && Array.isArray(disco.protocol.supported_versions), 'no ACP protocol block');
    expect(disco.capabilities?.services?.includes('checkout'), 'checkout is not advertised');
    const api = String(disco.api_base_url).replace(/^https?:\/\/[^/]+/, base);
    const headers = { 'content-type': 'application/json', 'api-version': disco.protocol.supported_versions[0], ...auth };
    const noVersion = await f(`${api}/checkout_sessions`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: '{}' });
    expect(noVersion.status === 400 && Array.isArray(((await noVersion.json()) as Json).supported_versions), 'a call without API-Version must give 400 with supported_versions');
    const noKey = await f(`${api}/checkout_sessions`, { method: 'POST', headers, body: '{}' });
    expect(noKey.status === 400 && ((await noKey.json()) as Json).code === 'idempotency_key_required', 'a POST without Idempotency-Key must give 400 idempotency_key_required');
    const bad = await f(`${api}/checkout_sessions`, { method: 'POST', headers: { ...headers, 'idempotency-key': `conformance-${Date.now()}` }, body: JSON.stringify({ items: [{ id: 'conformance-not-a-stay', quantity: 1 }] }) });
    const body = (await bad.json()) as Json;
    expect(bad.status === 400 && body.type === 'invalid_request' && typeof body.message === 'string', 'errors must be flat: { type, code, message }');
    const missing = await f(`${api}/checkout_sessions/cs_conformance_unknown`, { headers });
    expect(missing.status === 404, `an unknown session must give 404, got ${missing.status}`);
    return `ACP ${disco.protocol.version}`;
  });
  return checks;
}

export function report(checks: Check[]): string {
  const lines = checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.title}${c.detail ? `  (${c.detail})` : ''}`);
  const failed = checks.filter((c) => !c.ok).length;
  return [...lines, '', failed ? `${failed} of ${checks.length} checks failed.` : `All ${checks.length} checks passed.`].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.argv[2];
  if (!url || !/^https?:\/\//.test(url)) {
    console.error('Usage: innli-conformance <https://address-of-an-installation> [agent key]\nReads only; nothing is booked.');
    process.exit(2);
  }
  const checks = await runConformance(url, { agentKey: process.argv[3] ?? process.env.INNLI_AGENT_KEY });
  console.log(report(checks));
  process.exit(checks.some((c) => !c.ok) ? 1 : 0);
}
