import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { addDays } from '../src/domain/dates.ts';
import type { AgentCallbacks } from '../src/requests/agentCallbacks.ts';
import { publicSigningKey, verifyRecord } from '../src/security/signing.ts';
import { appLocals, ownerKey, startTestServer, type TestServer } from './helpers.ts';

type Json = Record<string, any>;

describe('1.1: OAuth 2.1 for agent platforms, and signed status callbacks', () => {
  let server: TestServer;
  const redirect = 'https://platform.example/oauth/callback';
  before(async () => {
    server = await startTestServer({ requireAgentKey: true, hotel: true });
  });
  after(() => server.close());

  /** Runs the whole OAuth flow like an MCP client would; returns the access token. */
  const connect = async (scope: string, withOwnerKey = true) => {
    const reg = await (await fetch(`${server.url}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Test Platform', redirect_uris: [redirect] }) })).json();
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const params = { response_type: 'code', client_id: reg.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', scope };
    const page = await (await fetch(`${server.url}/oauth/authorize?${new URLSearchParams(params)}`)).text();
    assert.match(page, /Connect Test Platform/);
    assert.match(page, /owner_key/, 'this installation requires the owner to approve');
    const approve = await fetch(`${server.url}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...params, decision: 'allow', owner_key: withOwnerKey ? ownerKey(server, 'prop_spaarne') : 'wrong' }) });
    if (!withOwnerKey) return { status: approve.status };
    const back = new URL(approve.headers.get('location')!);
    assert.equal(back.searchParams.get('state'), 'xyz');
    const code = back.searchParams.get('code')!;
    const bad = await fetch(`${server.url}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: reg.client_id, code_verifier: randomBytes(32).toString('base64url') }) });
    assert.equal(bad.status, 400, 'a wrong PKCE verifier is refused (and the code is used up)');
    return { reg, params, verifier };
  };

  it('publishes metadata and points unauthenticated MCP clients to it', async () => {
    const meta = await (await fetch(`${server.url}/.well-known/oauth-authorization-server`)).json();
    assert.deepEqual(meta.code_challenge_methods_supported, ['S256']);
    assert.equal(meta.registration_endpoint, `${server.url}/oauth/register`);
    const pr = await (await fetch(`${server.url}/.well-known/oauth-protected-resource`)).json();
    assert.equal(pr.resource, `${server.url}/mcp`);
    const res = await fetch(`${server.url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
    assert.equal(res.status, 401);
    assert.match(res.headers.get('www-authenticate')!, /resource_metadata=".*oauth-protected-resource"/);
    const unknownRedirect = await fetch(`${server.url}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }) });
    assert.equal(unknownRedirect.status, 400, 'plain http redirects are refused');
  });

  it('issues a token after the owner approves, with PKCE; the token works like an agent key with its scopes', async () => {
    assert.equal((await connect('stays:read', false)).status, 403, 'wrong owner key');
    const { reg, params, verifier } = (await connect('stays:read')) as Json;
    // Second round with a fresh code and the right verifier.
    const approve = await fetch(`${server.url}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...params, decision: 'allow', owner_key: ownerKey(server, 'prop_spaarne') }) });
    const code = new URL(approve.headers.get('location')!).searchParams.get('code')!;
    const token = await (await fetch(`${server.url}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: reg.client_id, code_verifier: verifier }) })).json();
    assert.match(token.access_token, /^innli_oat_/);
    assert.equal(token.scope, 'stays:read');
    const reuse = await fetch(`${server.url}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: reg.client_id, code_verifier: verifier }) });
    assert.equal(reuse.status, 400, 'a code works once');

    const client = new Client({ name: 'platform', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token.access_token}` } } }));
    const details = (await client.callTool({ name: 'get_stay_details', arguments: { propertyId: 'prop_spaarne' } })) as Json;
    assert.equal(details.isError, undefined);
    const q = (await client.callTool({ name: 'get_quote', arguments: { propertyId: 'prop_spaarne', unitId: 'standaard', checkin: addDays(new Date().toISOString().slice(0, 10), 30), checkout: addDays(new Date().toISOString().slice(0, 10), 31) } })) as Json;
    const act = (await client.callTool({ name: 'request_booking', arguments: { quoteId: q.structuredContent.quoteId, guest: { name: 'A B', email: 'a@example.com' }, guestConsent: true } })) as Json;
    assert.equal(act.isError, true, 'stays:read cannot act for guests');
    await client.close();

    const agent = server.store.listAgents().find((a) => a.oauthClientId === reg.client_id)!;
    agent.expiresAt = '2000-01-01T00:00:00.000Z';
    const expired = await fetch(`${server.url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
    assert.equal(expired.status, 401);
  });

  it('pushes signed status changes to the callbackUrl of the platform that sent the request', async () => {
    const received: Json[] = [];
    const sink = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c)).on('end', () => {
        received.push(JSON.parse(body));
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((r) => sink.listen(0, '127.0.0.1', r));
    try {
      const client = new Client({ name: 'agent', version: '1' });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${server.creds.agentKey}` } } }));
      const today = new Date().toISOString().slice(0, 10);
      const q = (await client.callTool({ name: 'get_quote', arguments: { propertyId: 'prop_spaarne', unitId: 'superior', checkin: addDays(today, 33), checkout: addDays(today, 35) } })) as Json;
      const callbackUrl = `http://127.0.0.1:${(sink.address() as AddressInfo).port}/innli`;
      const r = (await client.callTool({ name: 'request_booking', arguments: { quoteId: q.structuredContent.quoteId, guest: { name: 'C D', email: 'c@example.com' }, guestConsent: true, callbackUrl } })) as Json;
      assert.equal(r.structuredContent.booked, true);
      await client.callTool({ name: 'cancel_request', arguments: { statusToken: r.structuredContent.statusToken, guestConsent: true } });
      await (appLocals(server).callbacks as AgentCallbacks).idle();
      assert.deepEqual(received.map((m) => m.event.type), ['booking.confirmed', 'booking.cancelled']);
      const key = publicSigningKey(server.store);
      for (const m of received) assert.equal(verifyRecord(key, m.event, m.signature.value), true, 'verifiable with the published key');
      await client.close();
    } finally {
      sink.close();
    }
  });
});
