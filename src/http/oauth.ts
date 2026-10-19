import { createHash, randomBytes, randomUUID } from 'node:crypto';
import express, { type Request, type Response, type Router } from 'express';
import { z } from 'zod';
import type { AgentScope } from '../domain/types.ts';
import type { Store } from '../store.ts';
import { hashKey, safeEqual } from './auth.ts';

/**
 * OAuth 2.1 for agent platforms (the MCP authorization spec): metadata,
 * dynamic client registration, authorization code with PKCE (S256 only),
 * and a token that works exactly like an agent key with the granted scopes.
 *
 * Who may grant access: on an open installation anyone connecting a platform
 * (the catalog is public anyway); with INNLI_REQUIRE_AGENT_KEY=1 only the owner,
 * who confirms with their owner key on the consent page.
 */
export interface OAuthClient {
  clientId: string;
  name: string;
  redirectUris: string[];
  createdAt: string;
}

const TOKEN_DAYS = 90;
const CODE_MINUTES = 10;
const SCOPES = ['stays:read', 'stays:act'] as const;
const toAgentScopes = (scope: string[]): AgentScope[] => [...new Set(scope.map((s) => (s === 'stays:act' ? 'act' : 'read')))] as AgentScope[];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const validRedirect = (u: string) => {
  try {
    const url = new URL(u);
    // https everywhere; http only for a platform's local development callback.
    return !url.hash && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
  } catch {
    return false;
  }
};

export function oauthRouter(store: Store, opts: { publicUrl: string; ownerApproval: boolean; isOwnerKey: (key: string) => boolean }): Router {
  const r = express.Router();
  const base = opts.publicUrl.replace(/\/$/, '');
  const codes = new Map<string, { clientId: string; redirectUri: string; challenge: string; scope: string[]; expires: number }>();
  const clients = () => store.getSettings().oauthClients ?? [];
  const client = (id: string) => clients().find((c) => c.clientId === id);

  const protectedResource = { resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: SCOPES, bearer_methods_supported: ['header'], resource_name: 'INNLI' };
  r.get('/.well-known/oauth-protected-resource', (_req, res) => res.json(protectedResource));
  r.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => res.json(protectedResource));
  r.get('/.well-known/oauth-authorization-server', (_req, res) =>
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: SCOPES,
    }),
  );

  // RFC 7591 dynamic client registration: public clients (PKCE, no secret).
  r.post('/oauth/register', express.json({ limit: '20kb' }), (req, res) => {
    const body = z.object({ client_name: z.string().trim().min(1).max(80).optional(), redirect_uris: z.array(z.string().max(500)).min(1).max(5) }).safeParse(req.body);
    if (!body.success || !body.data.redirect_uris.every(validRedirect)) {
      res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris must be https (or http://localhost)' });
      return;
    }
    if (clients().length >= 500) {
      res.status(429).json({ error: 'too_many_clients' });
      return;
    }
    const c: OAuthClient = { clientId: `cl_${randomUUID()}`, name: (body.data.client_name ?? 'Agent platform').replace(/[^\p{L}\p{N} .\-_()]/gu, ''), redirectUris: body.data.redirect_uris, createdAt: new Date().toISOString() };
    store.updateSettings({ oauthClients: [...clients(), c] });
    res.status(201).json({ client_id: c.clientId, client_name: c.name, redirect_uris: c.redirectUris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] });
  });

  const authParams = z.object({
    response_type: z.literal('code'),
    client_id: z.string(),
    redirect_uri: z.string(),
    code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
    code_challenge_method: z.literal('S256'),
    state: z.string().max(500).optional(),
    scope: z.string().max(200).optional(),
    resource: z.string().max(500).optional(),
  });
  const parseAuth = (q: unknown, res: Response) => {
    const p = authParams.safeParse(q);
    const c = p.success ? client(p.data.client_id) : undefined;
    // Never redirect to an unregistered address: show the error here instead.
    if (!p.success || !c || !c.redirectUris.includes(p.data.redirect_uri)) {
      res.status(400).type('html').send('<!doctype html><meta charset="utf-8"><title>INNLI</title><p>Invalid authorization request (unknown client, redirect address or missing PKCE S256).</p>');
      return null;
    }
    const scope = (p.data.scope ?? 'stays:read stays:act').split(/\s+/).filter((s) => (SCOPES as readonly string[]).includes(s));
    return { ...p.data, client: c, scope: scope.length ? scope : ['stays:read'] };
  };

  r.get('/oauth/authorize', (req: Request, res: Response) => {
    const a = parseAuth(req.query, res);
    if (!a) return;
    const hidden = Object.entries({ response_type: 'code', client_id: a.client_id, redirect_uri: a.redirect_uri, code_challenge: a.code_challenge, code_challenge_method: 'S256', state: a.state ?? '', scope: a.scope.join(' ') })
      .map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`)
      .join('');
    const acts = a.scope.includes('stays:act');
    res
      .type('html')
      .set('x-frame-options', 'DENY')
      .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect ${esc(a.client.name)} – INNLI</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 16px;color:#1d2a24}button{font:inherit;padding:10px 18px;border-radius:8px;border:0;background:#2f6b4f;color:#fff;cursor:pointer}button.no{background:#e5e7e4;color:#1d2a24}input[type=password]{font:inherit;width:100%;padding:8px;border:1px solid #ccd;border-radius:8px}</style></head><body>
<h1>Connect ${esc(a.client.name)}</h1>
<p><strong>${esc(a.client.name)}</strong> wants to use the stays on this INNLI installation for its users:</p>
<ul><li>search stays, check availability and prices</li>${acts ? '<li>send booking requests, questions and cancellations on behalf of guests, only with each guest’s consent</li>' : ''}</ul>
<p>It gets no access to the owner dashboard or to guests’ data beyond the requests it sends itself. Access can be revoked at any time.</p>
<form method="post">${hidden}${opts.ownerApproval ? '<p><label>Owner key (only the owner can connect platforms here)<br><input type="password" name="owner_key" autocomplete="off" required></label></p>' : ''}
<p><button name="decision" value="allow">Allow</button> <button class="no" name="decision" value="deny">Deny</button></p></form></body></html>`);
  });

  r.post('/oauth/authorize', express.urlencoded({ extended: false, limit: '10kb' }), (req, res) => {
    const a = parseAuth(req.body, res);
    if (!a) return;
    const back = new URL(a.redirect_uri);
    if (a.state) back.searchParams.set('state', a.state);
    if (req.body.decision !== 'allow') {
      back.searchParams.set('error', 'access_denied');
      res.redirect(303, back.toString());
      return;
    }
    if (opts.ownerApproval && !(typeof req.body.owner_key === 'string' && opts.isOwnerKey(req.body.owner_key))) {
      res.status(403).type('html').send('<!doctype html><meta charset="utf-8"><title>INNLI</title><p>Wrong owner key. Go back and try again.</p>');
      return;
    }
    const code = randomBytes(24).toString('base64url');
    codes.set(code, { clientId: a.client_id, redirectUri: a.redirect_uri, challenge: a.code_challenge, scope: a.scope, expires: Date.now() + CODE_MINUTES * 60_000 });
    back.searchParams.set('code', code);
    res.redirect(303, back.toString());
  });

  r.post('/oauth/token', express.urlencoded({ extended: false, limit: '10kb' }), express.json({ limit: '10kb' }), (req, res) => {
    res.set('cache-control', 'no-store');
    const b = req.body ?? {};
    if (b.grant_type !== 'authorization_code') {
      res.status(400).json({ error: 'unsupported_grant_type' });
      return;
    }
    const entry = typeof b.code === 'string' ? codes.get(b.code) : undefined;
    if (entry) codes.delete(b.code); // single use
    const verifier = typeof b.code_verifier === 'string' ? b.code_verifier : '';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    if (!entry || entry.expires < Date.now() || entry.clientId !== b.client_id || entry.redirectUri !== b.redirect_uri || verifier.length < 43 || !safeEqual(challenge, entry.challenge)) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }
    const token = `innli_oat_${randomBytes(32).toString('base64url')}`;
    const c = client(entry.clientId)!;
    store.saveAgent({ id: `agt_${randomUUID().slice(0, 8)}`, name: c.name, keyHash: hashKey(token), scopes: toAgentScopes(entry.scope), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + TOKEN_DAYS * 86_400_000).toISOString(), oauthClientId: c.clientId });
    res.json({ access_token: token, token_type: 'Bearer', expires_in: TOKEN_DAYS * 86_400, scope: entry.scope.join(' ') });
  });

  return r;
}

/** Header that tells an MCP client where to find the authorization server (RFC 9728). */
export const wwwAuthenticate = (publicUrl: string) => `Bearer resource_metadata="${publicUrl.replace(/\/$/, '')}/.well-known/oauth-protected-resource"`;
