import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { rateLimiter } from '../http/safeFetch.ts';
import { GuideError, type Guide } from './guide.ts';
import { createGuideMcpServer } from './proxy.ts';
import { parseProfile } from '../mcp/server.ts';
import { createHash } from 'node:crypto';
import type { Fetcher } from '../connectors/availability.ts';
import { BotAuthVerifier, DIRECTORY_PATH, DIRECTORY_TYPE, jwksOf } from '../agent/botAuth.ts';
import { agentCard, llmsTxt, mcpServerCard, type StayLink } from '../agent/discovery.ts';

export function createGuideApp(guide: Guide, opts: { fetcher?: Fetcher; insecureAgentDirectories?: boolean } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', Math.max(0, Math.min(5, Number(process.env.GIDS_TRUST_PROXY ?? 1) || 0)));
  app.use(express.json({ limit: '512kb' }));
  const mcpLimit = rateLimiter(120);
  const verifiedLimit = rateLimiter(600);
  const directoryLimit = rateLimiter(6);
  const botAuth = new BotAuthVerifier(opts.fetcher ?? fetch, { allowHttp: opts.insecureAgentDirectories ?? false });
  const registerLimit = rateLimiter(10);

  app.get('/health', (_req, res) => {
    res.json({ ok: true, installations: guide.active().length });
  });

  // Discovery documents for the guide: one MCP connection for all listed stays.
  const guideStays = (): StayLink[] => guide.active().flatMap((l) => l.properties.map((p) => ({ name: p.name, url: `${l.instanceUrl}/verblijf/${encodeURIComponent(p.id)}`, place: [p.city, p.country].join(', '), type: p.type })));
  const origin = (req: Request) => guide.publicUrl ?? `${req.protocol}://${req.get('host')}`;
  // The guide's own keys: installations verify relayed requests against them.
  app.get(DIRECTORY_PATH, (_req, res) => {
    res.set('cache-control', 'public, max-age=3600').type(DIRECTORY_TYPE).send(JSON.stringify(jwksOf(guide.signingKey())));
  });
  app.get('/.well-known/agent-card.json', (req, res) => {
    res.set('cache-control', 'public, max-age=3600').json(agentCard(guideStays(), origin(req), { guide: true }));
  });
  app.get(['/.well-known/mcp.json', '/.well-known/mcp/server-card.json'], (req, res) => {
    res.set('cache-control', 'public, max-age=3600').json(mcpServerCard(origin(req), { guide: true }));
  });
  app.get('/llms.txt', (req, res) => {
    res.set('cache-control', 'public, max-age=3600').type('text/markdown; charset=utf-8').send(llmsTxt(guideStays(), origin(req), { guide: true }));
  });

  /** Self-hosted installations announce their published stays here. */
  app.post('/api/gids/register', async (req, res) => {
    if (!registerLimit(req.ip ?? 'unknown')) {
      res.status(429).json({ error: 'Te veel aanmeldingen' });
      return;
    }
    res.json(await guide.register(req.body));
  });

  /** Public overview: which stays are in the guide (no prices or calendars). */
  app.get('/api/gids/stays', (_req, res) => {
    res.json(guide.active().flatMap((l) => l.properties.map((p) => ({ ...p, id: `${l.instanceId}:${p.id}` }))));
  });

  app.post('/mcp', async (req, res) => {
    const ip = req.ip ?? 'unknown';
    // A platform that signs its requests (Web Bot Auth) is recognised here too, and the guide passes that on.
    const signed = await botAuth.verify(
      { method: req.method, path: req.originalUrl, scheme: req.protocol, authorities: [guide.publicUrl ? new URL(guide.publicUrl).host : String(req.headers.host ?? '')], headers: req.headers },
      { mayFetch: () => directoryLimit(ip) },
    );
    const verified = signed.status === 'verified' ? signed.agent : undefined;
    res.set('x-innli-agent-identity', verified ? `verified; agent="${verified}"` : signed.status === 'invalid' ? `invalid; reason="${signed.reason}"` : 'anonymous');
    if (!(verified ? verifiedLimit(`wba:${verified}`) : mcpLimit(ip))) {
      res.status(429).set('retry-after', '60').json({ error: 'Too many requests', code: 'RATE_LIMITED', retryable: true, retryAfterSeconds: 60 });
      return;
    }
    const name = verified ?? String(req.headers['x-agent-name'] ?? 'agent').replace(/[^\p{L}\p{N} .\-_()]/gu, '').slice(0, 60);
    // Installations limit open requests per caller; they get a hash, never the address itself.
    const holder = createHash('sha256').update(verified ? `wba:${verified}` : `ip:${ip}`).digest('hex').slice(0, 24);
    const server = createGuideMcpServer(guide, { name: name || 'agent', verifiedDomain: verified, holder }, parseProfile(req.query.profile ?? req.headers['x-innli-profile']), origin(req));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.all('/mcp', (_req, res) => {
    res.status(405).set('allow', 'POST').end();
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof GuideError) res.status(err.status).json({ error: err.message });
    else if (err instanceof z.ZodError) res.status(400).json({ error: 'Ongeldige aanmelding' });
    else {
      console.error(err);
      res.status(500).json({ error: 'Interne fout' });
    }
  });
  return app;
}
