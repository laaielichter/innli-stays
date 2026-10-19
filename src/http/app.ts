import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { funnel, track } from '../analytics/funnel.ts';
import { insights } from '../analytics/insights.ts';
import { CatalogError, PREVIEW_CLIENT, type Catalog } from '../catalog.ts';
import { factCategory, factHint, factLabel } from '../i18n/facts.ts';
import { currentLang, langMiddleware, pickLang, t } from '../i18n/index.ts';
import { ConversionError, recordConversion } from '../booking/conversions.ts';
import type { Fetcher } from '../connectors/availability.ts';
import { bookingsToken, calendarToken, exportIcs } from '../connectors/export.ts';
import { bookingsIcs, monthlyStats, requestsCsv } from '../analytics/bookings.ts';
import { addDays, DateRangeError, stayNights } from '../domain/dates.ts';
import { completeness, FACT_CATALOG, FactValidationError, getFactDefinition, ownerConfirmFact, ownerMarkUnknown, ownerSetFact, suggestFact } from '../domain/facts.ts';
import { LANGUAGES, type BookingRequest, type FactMap, type Property } from '../domain/types.ts';
import { demoEngine } from '../demo/engine.ts';
import { registerWithGuide, wellKnown } from '../directory/register.ts';
import { GUIDE_AGENT_HEADER } from '../directory/types.ts';
import { describeLicense, verifyLicense } from '../licensing/license.ts';
import { RELEASE_DATE, VERSION } from '../version.ts';
import { createMailer, type Mailer } from '../requests/mailer.ts';
import { RequestError, RequestService, rulesOf } from '../requests/service.ts';
import { QuestionService } from '../requests/questions.ts';
import { AgentActions } from '../requests/agentActions.ts';
import { WaitlistService } from '../requests/waitlist.ts';
import { ReviewService } from '../requests/reviews.ts';
import { OutboundWebhooks } from '../requests/webhooks.ts';
import { AgentCallbacks } from '../requests/agentCallbacks.ts';
import { WishService } from '../requests/wishes.ts';
import { agentReport, googleBusinessExport } from '../analytics/reports.ts';
import { publicPages } from '../web/routes.ts';
import { createMcpServer, parseProfile, runTool, toolHandlers, TOOLS, type ToolName } from '../mcp/server.ts';
import { applyPatch, createProperty, createUnit, ownerView, propertyPatchSchema, unitSchema } from '../properties.ts';
import { auditWebsite } from '../readiness/audit.ts';
import { extractFromHtml } from '../readiness/extract.ts';
import { buildJsonLd, publicFacts } from '../readiness/jsonld.ts';
import type { Store } from '../store.ts';
import { bearer, hashKey, newKey, requireAdmin, requireOwner, safeEqual, signPayload, type OwnerRequest } from './auth.ts';
import { rateLimiter, rateWindow } from './safeFetch.ts';
import { errorBody } from '../agentErrors.ts';
import { listBackups } from '../backup.ts';
import { agentCard, llmsTxt, mcpServerCard, staysOf } from '../agent/discovery.ts';
import { checkWebsite, signedPassport, VERIFICATION_FILE, VERIFICATION_META, verificationToken, websiteVerified } from '../agent/trust.ts';
import { oauthRouter, wwwAuthenticate } from './oauth.ts';
import { captionProblem, contentTypeOf, MAX_PHOTO_BYTES, MEDIA_FILE, MediaError, savePhoto } from './media.ts';

export interface AppOptions {
  store: Store;
  catalog: Catalog;
  /** Fetcher for owner-supplied URLs. */
  fetcher: Fetcher;
  adminKey?: string;
  requireAgentKey?: boolean;
  /** Public base URL, used for calendar export links. */
  publicUrl: string;
  /** INNLI guide this installation announces itself to. */
  guideUrl?: string;
  /** Source of the running version (AGPL-3.0, section 13); a modified installation points to its own public code. */
  sourceUrl?: string;
  /** Whether agents without a key may act for guests (requests, questions). Default true. */
  anonymousActions?: boolean;
  /** Notifications for booking requests; without it requests only show in the dashboard. */
  mailer?: Mailer;
  /**
   * One-time code required to create the first accommodation from the browser.
   * Printed in the server console, so only whoever runs the installation can claim it.
   */
  setupCode?: string;
  /** Automatic backups: where they go and how to make one now. */
  backups?: { dir: string; run: () => { folder: string; files: number; removed: number } };
  /** Folder for uploaded photos; without it uploads are switched off. */
  mediaDir?: string;
  /** Retry delays for outbound webhooks (tests use short ones). */
  webhookRetryDelaysMs?: number[];
  demo?: boolean;
}

type RawRequest = Request & { rawBody?: Buffer };

/** HTTP status for an agent error code on the REST endpoint. */
const STATUS_OF: Record<string, number> = { NOT_FOUND: 404, QUOTE_NOT_FOUND: 404, QUOTE_EXPIRED: 410, UNAVAILABLE: 409, CONFLICT: 409, TERMS_CHANGED: 409, FORBIDDEN: 403, RATE_LIMITED: 429, UPSTREAM_ERROR: 502, CONSENT_REQUIRED: 400, INVALID_INPUT: 400, LIMIT_REACHED: 400 };

const publicDir = fileURLToPath(new URL('../../public/', import.meta.url));

function owner(req: Request): Property {
  return (req as OwnerRequest).property;
}

/** Records which staff member decided, so the owner can see who did what. */
function handledBy(store: Store, req: Request, r: BookingRequest): BookingRequest {
  const name = (req as OwnerRequest).staffName;
  if (name) {
    r.handledBy = name;
    store.saveRequest(r);
  }
  return r;
}

function unitFacts(property: Property, unitId: string | undefined): FactMap {
  if (!unitId) return property.facts;
  const unit = property.units.find((u) => u.id === unitId);
  if (!unit) throw new FactValidationError(t('own.unitNotFound'));
  return unit.facts;
}

function checkScope(key: string, unitId: string | undefined): void {
  const def = getFactDefinition(key);
  if (!def) throw new FactValidationError(t('own.unknownFact', { key }));
  if (def.scope === 'unit' && !unitId) throw new FactValidationError(t('own.factIsUnit'));
  if (def.scope === 'property' && unitId) throw new FactValidationError(t('own.factIsProperty'));
}

export function createApp(opts: AppOptions) {
  const { store, catalog } = opts;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  const json = express.json({ limit: '1mb', verify: (req, _res, buf) => ((req as RawRequest).rawBody = buf) });
  // A restored backup can be larger; that route parses its own body.
  app.use((req, res, next) => (req.path === '/api/owner/restore' ? next() : json(req, res, next)));

  const mailer = opts.mailer ?? createMailer(undefined, undefined);
  const requests = new RequestService(store, catalog, mailer, opts.publicUrl);
  const questions = new QuestionService(store, mailer, opts.publicUrl);
  const agentActions = new AgentActions(store, requests, questions, catalog, opts.publicUrl);
  catalog.setHostInfoProvider((p) => {
    const rules = rulesOf(p);
    const kind = p.booking.connector.kind;
    return {
      ...requests.hostStats(p.id),
      instantBooking: rules.instantBooking && (kind === 'manual' || kind === 'ical'),
      requestsHeldForHours: kind === 'live_api' || kind === 'beds24' ? undefined : rules.holdHours,
      deposit: rules.deposit && rules.deposit.percent > 0 ? { percent: rules.deposit.percent, dueDaysAfterConfirmation: rules.deposit.dueDays } : null,
    };
  });
  const waitlist = new WaitlistService(store, catalog, mailer, opts.publicUrl);
  const reviews = new ReviewService(store, mailer, opts.publicUrl);
  catalog.setReviewsProvider((p) => reviews.summary(p));
  const webhooks = new OutboundWebhooks(store, opts.fetcher, { retryDelaysMs: opts.webhookRetryDelaysMs });
  requests.listeners.push((p, type, r) => webhooks.emit(p, type, r));
  const callbacks = new AgentCallbacks(store, opts.fetcher, { retryDelaysMs: opts.webhookRetryDelaysMs });
  requests.listeners.push((p, type, r) => callbacks.emit(p, type, r));
  const wishes = new WishService(store, catalog, callbacks);
  requests.listeners.push((p, type, r) => wishes.onBookingEvent(p, type, r));
  app.locals.wishes = wishes;
  app.locals.callbacks = callbacks;
  app.locals.webhooks = webhooks;
  app.locals.requests = requests;
  app.locals.waitlist = waitlist;
  app.locals.reviews = reviews;
  const setupLimit = rateLimiter(10);

  const mcpLimit = rateWindow(120);
  const auditLimit = rateLimiter(10);

  // Every response carries a request id (the caller's, or a new one), also in error bodies.
  app.use((req, res, next) => {
    const incoming = String(req.headers['x-request-id'] ?? '');
    const id = /^[\w.-]{8,80}$/.test(incoming) ? incoming : randomUUID();
    res.locals.requestId = id;
    res.set('x-request-id', id);
    next();
  });
  // Agents, guests and owners each get text in their own language (see pickLang).
  app.use(langMiddleware(pickLang));

  const startedAt = Date.now();
  app.get('/health', (_req, res) => {
    const props = store.listProperties();
    res.json({ ok: true, version: VERSION, license: 'AGPL-3.0-only', sourceCode: opts.sourceUrl, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000), properties: props.length, published: props.filter((p) => p.published).length });
  });

  /** Who is calling: an agent key, a name relayed by the INNLI guide, or anonymous. Null = refused (response sent). */
  const identifyAgent = (req: Request, res: Response): { name: string; canAct: boolean } | null => {
    // IETF RateLimit headers on every agent response, so a polite agent can pace itself before it hits the limit.
    const rate = mcpLimit(req.ip ?? 'unknown');
    res.set('ratelimit-policy', `${rate.limit};w=60`).set('ratelimit', `limit=${rate.limit}, remaining=${rate.remaining}, reset=${rate.resetSeconds}`);
    res.set('ratelimit-limit', String(rate.limit)).set('ratelimit-remaining', String(rate.remaining)).set('ratelimit-reset', String(rate.resetSeconds));
    if (!rate.allowed) {
      res.status(429).set('retry-after', String(rate.resetSeconds)).json({ error: 'Too many requests', ...errorBody('Too many requests', { code: 'RATE_LIMITED', retryAfterSeconds: rate.resetSeconds }), retryAfterSeconds: rate.resetSeconds });
      return null;
    }
    const key = bearer(req);
    const found = key ? store.findAgentByKeyHash(hashKey(key)) : undefined;
    const agent = found && (!found.expiresAt || found.expiresAt > new Date().toISOString()) ? found : undefined;
    if (key && !agent) {
      res.status(401).set('www-authenticate', `${wwwAuthenticate(opts.publicUrl)}, error="invalid_token"`).json({ error: found ? 'Token expired' : 'Invalid agent key' });
      return null;
    }
    if (opts.requireAgentKey && !agent) {
      res.status(401).set('www-authenticate', wwwAuthenticate(opts.publicUrl)).json({ error: 'Agent key required. Connect through OAuth (see /.well-known/oauth-protected-resource) or request a key via INNLI.' });
      return null;
    }
    // Requests relayed by the INNLI guide carry the agent's name, for the owner's statistics.
    const relayed = String(req.headers[GUIDE_AGENT_HEADER] ?? '').replace(/[^\p{L}\p{N} .\-_()]/gu, '').slice(0, 80);
    return { name: agent?.name ?? (relayed || 'anoniem'), canAct: agent ? (agent.scopes ?? ['read', 'act']).includes('act') : opts.anonymousActions !== false };
  };

  // OAuth 2.1 for agent platforms (ChatGPT, Claude and others connecting over MCP).
  app.use(oauthRouter(store, { publicUrl: opts.publicUrl, ownerApproval: Boolean(opts.requireAgentKey), isOwnerKey: (k) => Boolean(store.findPropertyByOwnerKeyHash(hashKey(k))) }));

  // ---------------------------------------------------------------- Agents (MCP)
  app.post('/mcp', async (req, res) => {
    const who = identifyAgent(req, res);
    if (!who) return;
    // Stateless: a fresh server per request keeps horizontal scaling trivial.
    // ?profile=core (or the x-innli-profile header): only the core tools, answering briefly; saves agents context on every turn.
    const profile = parseProfile(req.query.profile ?? req.headers['x-innli-profile']);
    const server = createMcpServer(catalog, who.name, agentActions, { canAct: who.canAct, waitlist, wishes, profile });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  // ---------------------------------------------------------------- Agents (REST, for platforms without MCP)
  /** OpenAPI 3.1 description of the same tools, e.g. for ChatGPT GPT Actions. */
  app.get('/api/agent/v1/openapi.json', (_req, res) => {
    const paths: Record<string, unknown> = {};
    for (const [name, def] of Object.entries(TOOLS)) {
      paths[`/api/agent/v1/tools/${name}`] = {
        post: {
          operationId: name,
          summary: def.title,
          description: def.description,
          requestBody: { required: true, content: { 'application/json': { schema: z.toJSONSchema(z.object(def.inputSchema as z.ZodRawShape), { io: 'input', unrepresentable: 'any' }) } } },
          responses: { '200': { description: 'Result', content: { 'application/json': { schema: { type: 'object' } } } }, '400': { description: 'Error: { error (readable message), code, retryable, retryAfterSeconds, hint, nextTools }; other codes use 403, 404, 409, 410, 429 or 502' } },
        },
      };
    }
    res.json({
      openapi: '3.1.0',
      info: { title: 'INNLI agent API', version: VERSION, description: 'Same tools as the MCP endpoint (/mcp). Facts carry a status: confirmed, unconfirmed or unknown. Nothing is booked unless a result says booked: true.' },
      servers: [{ url: opts.publicUrl.replace(/\/$/, '') }],
      components: { securitySchemes: { agentKey: { type: 'http', scheme: 'bearer' } } },
      security: opts.requireAgentKey ? [{ agentKey: [] }] : [],
      paths,
    });
  });

  app.post('/api/agent/v1/tools/:name', async (req, res) => {
    const who = identifyAgent(req, res);
    if (!who) return;
    const name = String(req.params.name) as ToolName;
    const def = TOOLS[name];
    if (!def) {
      res.status(404).json({ error: `Unknown tool: ${name}`, ...errorBody(`Unknown tool: ${name}`, { code: 'NOT_FOUND', hint: 'See /api/agent/v1/openapi.json for the tools.' }) });
      return;
    }
    const parsed = z.object(def.inputSchema as z.ZodRawShape).safeParse(req.body ?? {});
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
      res.status(400).json({ error: message, ...errorBody(message, { code: 'INVALID_INPUT' }) });
      return;
    }
    const result = (await runTool(toolHandlers({ catalog, agentClient: who.name, actions: agentActions, waitlist, wishes, canAct: who.canAct }), name, parsed.data)) as { isError?: boolean; content: { text: string }[]; structuredContent?: { error?: { code: string; message: string } } };
    // REST keeps `error` as the readable message (as before 2.0) and adds code, retryable, hint and nextTools beside it.
    if (result.isError) {
      const e = result.structuredContent!.error!;
      res.status(STATUS_OF[e.code] ?? 400).json({ ...e, error: e.message });
    } else res.json(result.structuredContent);
  });

  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).set('allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  };
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);

  // ---------------------------------------------------------------- Public
  app.get('/api/public/properties/:id/passport', (req, res) => {
    const p = store.getProperty(req.params.id);
    if (!p || !p.published) {
      res.status(404).json({ error: t('own.notFound') });
      return;
    }
    res.set('cache-control', 'public, max-age=300').json({
      id: p.id,
      name: p.name,
      facts: publicFacts(p.facts, 'property', p.currency),
      units: p.units.map((u) => ({ id: u.id, name: u.name, maxGuests: u.maxGuests, facts: publicFacts(u.facts, 'unit', p.currency) })),
      completeness: completeness(p).score,
      // What the signature in get_stay_details covers, so anyone can check a copy against the original.
      signed: signedPassport(store, p),
    });
  });

  /** The owner's website verification token, public on purpose: only the owner can put it on their own site (the WordPress plugin does). */
  app.get('/api/public/properties/:id/site-verification', (req, res) => {
    const p = store.getProperty(req.params.id);
    if (!p || !p.published) {
      res.status(404).json({ error: t('own.notFound') });
      return;
    }
    const fresh = !p.websiteVerification;
    const token = verificationToken(p);
    if (fresh) store.saveProperty(p);
    res.set('cache-control', 'public, max-age=300').json({ meta: VERIFICATION_META, token, verified: websiteVerified(p) });
  });

  app.get('/api/public/properties/:id/jsonld', (req, res) => {
    const p = store.getProperty(req.params.id);
    if (!p || !p.published) {
      res.status(404).json({ error: t('own.notFound') });
      return;
    }
    res.set('cache-control', 'public, max-age=300').json(buildJsonLd(p));
  });

  /** Tracked hand-off from an agent to the property's own booking environment. */
  app.get('/r/:token', (req, res) => {
    const link = store.getBookingLink(req.params.token);
    if (!link) {
      res.status(404).type('text').send(t('own.linkNotFound'));
      return;
    }
    // Link previews by chat apps and crawlers are not guests.
    const ua = String(req.headers['user-agent'] ?? '');
    if (!/bot|crawler|spider|preview|slurp|facebookexternalhit|embedly/i.test(ua)) {
      track(store, 'click_through', link.propertyId, link.agentClient, { token: link.token, mode: link.mode });
    }
    res.redirect(302, link.targetUrl);
  });

  /**
   * Booking confirmations from the property's website or booking system.
   * Body is signed with the property's webhook secret: X-Innli-Signature = hex(HMAC-SHA256(secret, rawBody)).
   */
  app.post('/api/conversions', (req, res) => {
    const body = z.object({ propertyId: z.string(), ref: z.string().min(1).max(100), bookingReference: z.string().min(1).max(100), amount: z.number().min(0).optional() }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: t('own.invalidReport') });
      return;
    }
    const property = store.getProperty(body.data.propertyId);
    const signature = String(req.headers['x-innli-signature'] ?? '');
    const raw = (req as RawRequest).rawBody?.toString('utf8') ?? '';
    if (!property || !signature || !safeEqual(signature, signPayload(property.webhookSecret, raw))) {
      res.status(401).json({ error: t('own.invalidSignature') });
      return;
    }
    try {
      res.json(recordConversion(store, body.data, property.id));
    } catch (err) {
      if (err instanceof ConversionError) res.status(err.status).json({ error: err.message });
      else throw err;
    }
  });

  /** Room closures made in INNLI, for import into Airbnb, Booking.com or a channel manager. */
  app.get('/media/:propertyId/:file', (req, res) => {
    const file = String(req.params.file);
    const dir = String(req.params.propertyId).replace(/[^A-Za-z0-9_-]/g, '');
    if (!opts.mediaDir || !MEDIA_FILE.test(file)) {
      res.status(404).end();
      return;
    }
    res.type(contentTypeOf(file)).set('cache-control', 'public, max-age=31536000, immutable').set('x-content-type-options', 'nosniff').sendFile(file, { root: join(opts.mediaDir, dir) }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  app.get('/api/public/bookings/:file', (req, res) => {
    const p = store.getProperty(String(req.params.file).replace(/\.ics$/, ''));
    if (!p || typeof req.query.key !== 'string' || !safeEqual(req.query.key, bookingsToken(p))) {
      res.status(404).end();
      return;
    }
    res.type('text/calendar').set('cache-control', 'no-store').set('x-robots-tag', 'noindex').send(bookingsIcs(p, store.requestsFor(p.id)));
  });

  app.get('/api/public/calendar/:propertyId/:unitFile', (req, res) => {
    const p = store.getProperty(req.params.propertyId);
    const unitId = req.params.unitFile.replace(/\.ics$/, '');
    const unit = p?.units.find((u) => u.id === unitId);
    const key = String(req.query.key ?? '');
    if (!p || !unit || !key || !safeEqual(key, calendarToken(p, unit.id))) {
      res.status(404).type('text').send(t('own.notFound'));
      return;
    }
    res.type('text/calendar').set('cache-control', 'no-cache').send(exportIcs(p, unit));
  });

  /** Lets the INNLI guide verify that this installation really runs at this address. */
  app.get('/.well-known/innli.json', (_req, res) => {
    res.json({ ...wellKnown(store), license: 'AGPL-3.0-only', sourceCode: opts.sourceUrl });
  });

  // Discovery: where agent platforms and crawlers look for an agent-ready service.
  const discoveryCache = 'public, max-age=3600';
  app.get('/.well-known/agent-card.json', (_req, res) => {
    res.set('cache-control', discoveryCache).json(agentCard(staysOf(store, opts.publicUrl), opts.publicUrl, { requireAgentKey: opts.requireAgentKey }));
  });
  app.get(['/.well-known/mcp.json', '/.well-known/mcp/server-card.json'], (_req, res) => {
    res.set('cache-control', discoveryCache).json(mcpServerCard(opts.publicUrl, { requireAgentKey: opts.requireAgentKey }));
  });
  app.get('/llms.txt', (_req, res) => {
    res.set('cache-control', discoveryCache).type('text/markdown; charset=utf-8').send(llmsTxt(staysOf(store, opts.publicUrl), opts.publicUrl));
  });

  // ---------------------------------------------------------------- First-run setup (browser wizard)
  app.get('/api/setup', (_req, res) => {
    res.json({ needsSetup: store.listProperties().length === 0 && Boolean(opts.setupCode), version: VERSION });
  });

  app.post('/api/setup', (req, res) => {
    if (!setupLimit(req.ip ?? 'unknown')) {
      res.status(429).json({ error: t('own.tooManyAttempts') });
      return;
    }
    if (store.listProperties().length > 0 || !opts.setupCode) {
      res.status(409).json({ error: t('own.alreadySetUp') });
      return;
    }
    const input = z
      .object({
        code: z.string(),
        name: z.string().trim().min(2, { error: () => t('own.nameRequired') }).max(120),
        type: z.enum(['bnb', 'pension', 'guesthouse', 'holiday_home', 'unique_stay', 'hotel']).default('bnb'),
        city: z.string().trim().min(1, { error: () => t('own.cityRequired') }).max(100),
        country: z.string().trim().length(2).default('NL'),
        language: z.enum(LANGUAGES).optional(),
        contactEmail: z.string().trim().email({ error: () => t('own.invalidEmail') }).optional().or(z.literal('')),
        website: z.string().trim().url().optional().or(z.literal('')),
        room: z.object({ name: z.string().trim().min(1).max(120), maxGuests: z.number().int().min(1).max(30), baseRatePerNight: z.number().min(0).max(10_000) }),
      })
      .parse(req.body);
    if (!safeEqual(input.code.trim().toUpperCase(), opts.setupCode.toUpperCase())) {
      res.status(403).json({ error: t('own.wrongCode') });
      return;
    }
    const { property, ownerKey } = createProperty({ name: input.name, type: input.type, address: { city: input.city, country: input.country.toUpperCase() } });
    if (input.language) property.language = input.language;
    if (input.contactEmail) property.contactEmail = input.contactEmail;
    if (input.website) property.website = input.website;
    property.booking = { connector: { kind: 'manual' } };
    property.units.push(createUnit({ name: input.room.name, maxGuests: input.room.maxGuests, includedGuests: Math.min(2, input.room.maxGuests), baseRatePerNight: input.room.baseRatePerNight }));
    store.saveProperty(property);
    res.status(201).json({ ownerKey, propertyId: property.id });
  });

  /** The fact catalog with labels, categories and hints in the requested language (?lang=). */
  app.get('/api/fact-catalog', (_req, res) => {
    const lang = currentLang();
    res.json(FACT_CATALOG.map((d) => ({ ...d, label: factLabel(d.key, lang), category: factCategory(d.category, lang), hint: factHint(d.key, lang) })));
  });

  // ---------------------------------------------------------------- Owner dashboard API
  const ownerApi = express.Router();
  ownerApi.use(requireOwner(store));

  ownerApi.get('/property', (req, res) => {
    const p = owner(req);
    const view = ownerView(p);
    // Reception staff do not need the secrets.
    if ((req as OwnerRequest).role === 'reception') {
      res.json({ property: { ...view, webhookSecret: undefined, outboundWebhook: undefined, staff: undefined, notify: undefined, discountCodes: undefined, booking: { ...view.booking, connector: { kind: view.booking.connector.kind } } }, completeness: completeness(p) });
      return;
    }
    res.json({ property: view, completeness: completeness(p) });
  });

  /** Who is logged in: the owner or a staff member, and what they may do. */
  ownerApi.get('/me', (req, res) => {
    const r = req as OwnerRequest;
    res.json({ role: r.role, name: r.staffName, property: r.property.name });
  });

  // Staff keys (owner only): reception and managers each get their own key, and can be removed one by one.
  ownerApi.get('/staff', (req, res) => {
    res.json({ staff: (owner(req).staff ?? []).map(({ keyHash: _k, ...m }) => m) });
  });
  ownerApi.post('/staff', (req, res) => {
    const p = owner(req);
    const input = z.object({ name: z.string().trim().min(2).max(80), role: z.enum(['manager', 'reception']) }).parse(req.body);
    if ((p.staff?.length ?? 0) >= 50) throw new RequestError('Maximum 50 staff keys', 400);
    const key = newKey('innli_stf');
    const member = { id: `stf_${randomUUID().slice(0, 8)}`, name: input.name, role: input.role, keyHash: hashKey(key), createdAt: new Date().toISOString() };
    p.staff = [...(p.staff ?? []), member];
    store.saveProperty(p);
    const { keyHash: _k, ...view } = member;
    res.status(201).json({ staff: view, key });
  });
  ownerApi.delete('/staff/:id', (req, res) => {
    const p = owner(req);
    const before = p.staff?.length ?? 0;
    p.staff = (p.staff ?? []).filter((m) => m.id !== req.params.id);
    if (p.staff.length === before) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    store.saveProperty(p);
    res.json({ ok: true });
  });

  // Outbound webhook: signed booking events to the property's own system (PMS, channel manager, Zapier/Make).
  ownerApi.put('/webhook', (req, res) => {
    const p = owner(req);
    const { url } = z.object({ url: z.string().url().max(500).refine((u) => /^https:\/\//.test(u) || opts.demo === true, { error: () => t('own.useHttps') }).nullable() }).parse(req.body);
    if (!url) p.outboundWebhook = undefined;
    else p.outboundWebhook = { url, secret: p.outboundWebhook?.secret ?? newKey('whsec') };
    store.saveProperty(p);
    res.json({ outboundWebhook: p.outboundWebhook ?? null });
  });
  ownerApi.post('/webhook/test', async (req, res) => {
    res.json(await webhooks.test(owner(req)));
  });

  ownerApi.patch('/property', (req, res) => {
    const p = owner(req);
    const patch = propertyPatchSchema.parse(req.body);
    applyPatch(p, patch);
    store.saveProperty(p);
    res.json({ property: ownerView(p), completeness: completeness(p) });
  });

  ownerApi.put('/facts/:key', (req, res) => {
    const p = owner(req);
    const unitId = typeof req.body.unitId === 'string' ? req.body.unitId : undefined;
    checkScope(req.params.key, unitId);
    const fact = ownerSetFact(unitFacts(p, unitId), req.params.key, req.body.value);
    store.saveProperty(p);
    res.json({ fact, completeness: completeness(p) });
  });

  ownerApi.post('/facts/:key/confirm', (req, res) => {
    const p = owner(req);
    const unitId = typeof req.body?.unitId === 'string' ? req.body.unitId : undefined;
    checkScope(req.params.key, unitId);
    const fact = ownerConfirmFact(unitFacts(p, unitId), req.params.key);
    store.saveProperty(p);
    res.json({ fact, completeness: completeness(p) });
  });

  ownerApi.post('/facts/:key/unknown', (req, res) => {
    const p = owner(req);
    const unitId = typeof req.body?.unitId === 'string' ? req.body.unitId : undefined;
    checkScope(req.params.key, unitId);
    const fact = ownerMarkUnknown(unitFacts(p, unitId), req.params.key);
    store.saveProperty(p);
    res.json({ fact, completeness: completeness(p) });
  });

  ownerApi.post('/units', (req, res) => {
    const p = owner(req);
    const unit = createUnit(unitSchema.parse(req.body));
    p.units.push(unit);
    store.saveProperty(p);
    res.status(201).json(unit);
  });

  ownerApi.patch('/units/:unitId', (req, res) => {
    const p = owner(req);
    const unit = p.units.find((u) => u.id === req.params.unitId);
    if (!unit) {
      res.status(404).json({ error: t('own.unitNotFound') });
      return;
    }
    Object.assign(unit, unitSchema.partial().parse(req.body));
    store.saveProperty(p);
    res.json(unit);
  });

  /** The owner's own room calendar ("open kamers"): which nights are closed in INNLI. */
  ownerApi.get('/units/:unitId/calendar', async (req, res) => {
    const p = owner(req);
    const unit = p.units.find((u) => u.id === req.params.unitId);
    if (!unit) {
      res.status(404).json({ error: t('own.unitNotFound') });
      return;
    }
    const days = Math.min(365, Math.max(7, Number(req.query.days) || 90));
    const from = new Date().toISOString().slice(0, 10);
    const overview = await catalog.roomCalendar(p, unit, stayNights(from, addDays(from, days), 366));
    const exportUrl = `${opts.publicUrl.replace(/\/$/, '')}/api/public/calendar/${encodeURIComponent(p.id)}/${encodeURIComponent(unit.id)}.ics?key=${calendarToken(p, unit.id)}`;
    res.json({ unitId: unit.id, from, ...overview, exportUrl });
  });

  // Photo upload: the raw image as the request body; the type is checked on the bytes themselves.
  ownerApi.post('/photos', express.raw({ type: () => true, limit: MAX_PHOTO_BYTES + 1024 }), (req, res) => {
    if (!opts.mediaDir) {
      res.status(503).json({ error: 'Uploads are switched off on this installation (no media folder).' });
      return;
    }
    const p = owner(req);
    try {
      const file = savePhoto(opts.mediaDir, p.id, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
      res.status(201).json({ url: `${opts.publicUrl.replace(/\/$/, '')}/media/${encodeURIComponent(p.id)}/${file}` });
    } catch (err) {
      if (err instanceof MediaError) res.status(err.status).json({ error: err.message });
      else throw err;
    }
  });
  /** Photo descriptions that do not tell agents or screen readers what is shown. */
  ownerApi.get('/photos/check', (req, res) => {
    const p = owner(req);
    const all = [...(p.photos ?? []).map((ph) => ({ ...ph, where: p.name })), ...p.units.flatMap((u) => (u.photos ?? []).map((ph) => ({ ...ph, where: u.name })))];
    res.json({ photos: all.length, problems: all.map((ph) => ({ url: ph.url, where: ph.where, caption: ph.caption, problem: captionProblem(ph.caption) })).filter((x) => x.problem) });
  });

  /** The owner's booking calendar (secret iCal link), CSV export and monthly figures. */
  ownerApi.get('/bookings/feed', (req, res) => {
    const p = owner(req);
    res.json({ url: `${opts.publicUrl.replace(/\/$/, '')}/api/public/bookings/${encodeURIComponent(p.id)}.ics?key=${bookingsToken(p)}` });
  });
  ownerApi.get('/export/requests.csv', (req, res) => {
    const p = owner(req);
    res.set('content-disposition', `attachment; filename="innli-${p.slug}-aanvragen-${new Date().toISOString().slice(0, 10)}.csv"`).type('text/csv; charset=utf-8').send(requestsCsv(p, store.requestsFor(p.id)));
  });
  ownerApi.get('/stats', (req, res) => {
    const months = Math.min(24, Math.max(1, Number(req.query.months) || 12));
    res.json(monthlyStats(store, owner(req), months));
  });

  ownerApi.put('/units/:unitId/closed', (req, res) => {
    const p = owner(req);
    const unit = p.units.find((u) => u.id === req.params.unitId);
    if (!unit) {
      res.status(404).json({ error: t('own.unitNotFound') });
      return;
    }
    const { closedNights } = z.object({ closedNights: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(1000) }).parse(req.body);
    const today = new Date().toISOString().slice(0, 10);
    unit.closedNights = [...new Set(closedNights)].filter((n) => n >= today).sort();
    store.saveProperty(p);
    res.json({ unitId: unit.id, closedNights: unit.closedNights });
  });

  ownerApi.delete('/units/:unitId', (req, res) => {
    const p = owner(req);
    p.units = p.units.filter((u) => u.id !== req.params.unitId);
    if (p.booking.connector.kind === 'ical') delete p.booking.connector.calendars[req.params.unitId];
    store.saveProperty(p);
    res.status(204).end();
  });

  /** Draft passport from the owner's website. Suggestions only; nothing becomes confirmed. */
  // Website verification: proof for agents that this passport belongs to the owner of the website it names.
  ownerApi.get('/website-verification', (req, res) => {
    const p = owner(req);
    const fresh = !p.websiteVerification;
    const token = verificationToken(p);
    if (fresh) store.saveProperty(p);
    res.json({ ...p.websiteVerification, token, verified: websiteVerified(p), website: p.website, metaTag: `<meta name="${VERIFICATION_META}" content="${token}">`, fileUrl: p.website ? `${new URL(p.website).origin}${VERIFICATION_FILE}` : undefined });
  });
  ownerApi.post('/website-verification/check', async (req, res) => {
    const p = owner(req);
    const result = await checkWebsite(p, opts.fetcher);
    store.saveProperty(p);
    res.json({ ...result, ...p.websiteVerification });
  });

  ownerApi.post('/import', async (req, res) => {
    const p = owner(req);
    const { url } = z.object({ url: z.string().url().optional() }).parse(req.body ?? {});
    const target = url ?? p.website;
    if (!target) {
      res.status(400).json({ error: t('own.noWebsite') });
      return;
    }
    let html: string;
    try {
      const r = await opts.fetcher(target, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      html = await r.text();
    } catch (err) {
      res.status(502).json({ error: t('own.fetchFailed', { error: (err as Error).message }) });
      return;
    }
    const result = extractFromHtml(html);
    const applied: string[] = [];
    const skipped: string[] = [];
    for (const s of result.suggestions) {
      if (suggestFact(p.facts, s.key, s.value, 'website', `${target}: "${s.evidence}"`)) applied.push(s.key);
      else skipped.push(s.key);
    }
    store.saveProperty(p);
    res.json({ source: target, suggestions: result.suggestions, applied, skippedBecauseConfirmed: skipped, unitHints: result.unitHints, completeness: completeness(p) });
  });

  ownerApi.post('/audit', async (req, res) => {
    const p = owner(req);
    if (!auditLimit(p.id)) {
      res.status(429).json({ error: t('own.auditLimit') });
      return;
    }
    const { url } = z.object({ url: z.string().url().optional() }).parse(req.body ?? {});
    const target = url ?? p.website;
    if (!target) {
      res.status(400).json({ error: t('own.noWebsite') });
      return;
    }
    const report = await auditWebsite(target, p, opts.fetcher);
    p.lastAudit = report;
    store.saveProperty(p);
    res.json(report);
  });

  ownerApi.get('/analytics', (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    res.json(funnel(store, owner(req).id, days));
  });

  /** Exactly what an agent receives from get_stay_details, without counting as an agent view. */
  ownerApi.get('/agent-preview', (req, res) => {
    const p = owner(req);
    res.json({ published: p.published, details: catalog.details(p.id, PREVIEW_CLIENT) });
  });

  ownerApi.post('/connector/test', async (req, res) => {
    const p = owner(req);
    const unit = p.units[0];
    if (!unit) {
      res.status(400).json({ error: t('own.addRoomFirst') });
      return;
    }
    const checkin = addDays(new Date().toISOString().slice(0, 10), 14);
    const checkout = addDays(checkin, 2);
    res.json(await catalog.checkAvailability(p.id, checkin, checkout, { adults: Math.min(2, unit.maxGuests), children: 0, dogs: 0 }, PREVIEW_CLIENT));
  });

  // Booking requests from the stay page
  ownerApi.get('/requests', (req, res) => {
    const p = owner(req);
    const list = store
      .requestsFor(p.id)
      .slice()
      .sort((a, b) => (a.status === 'new') === (b.status === 'new') ? b.createdAt.localeCompare(a.createdAt) : a.status === 'new' ? -1 : 1)
      .map((r) => ({ ...r, unitName: p.units.find((u) => u.id === r.unitId)?.name ?? r.unitId, publicToken: undefined }));
    res.json({ requests: list, mailEnabled: Boolean(opts.mailer?.enabled), stayPageUrl: `${opts.publicUrl.replace(/\/$/, '')}/verblijf/${encodeURIComponent(p.slug)}` });
  });
  ownerApi.post('/requests/:id/accept', async (req, res) => {
    const { note, force } = z.object({ note: z.string().max(2000).optional(), force: z.boolean().optional() }).parse(req.body ?? {});
    res.json(handledBy(store, req, await requests.accept(owner(req), String(req.params.id), { note, force })));
  });
  ownerApi.post('/requests/:id/paid', (req, res) => {
    res.json(requests.markPaid(owner(req), String(req.params.id)));
  });
  ownerApi.get('/reviews', (req, res) => {
    const p = owner(req);
    res.json({
      summary: reviews.summary(p),
      reviews: store
        .requestsFor(p.id)
        .filter((r) => r.review)
        .sort((a, b) => b.review!.createdAt.localeCompare(a.review!.createdAt))
        .map((r) => ({ requestId: r.id, guest: r.guest.name, checkin: r.checkin, ...r.review })),
    });
  });
  ownerApi.post('/reviews/:requestId/reply', (req, res) => {
    const { text } = z.object({ text: z.string().max(1000) }).parse(req.body);
    res.json(reviews.reply(owner(req), String(req.params.requestId), text).review);
  });
  // Stay wishes from agents that this stay could answer, and the host's offers on them.
  ownerApi.get('/wishes', async (req, res) => {
    res.json({ wishes: await wishes.forProperty(owner(req)) });
  });
  ownerApi.post('/wishes/:id/offer', async (req, res) => {
    const input = z
      .object({
        unitId: z.string().min(1).max(80),
        checkin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        checkout: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        rooms: z.number().int().min(1).max(10).optional(),
        discountPercent: z.number().min(0).max(50).optional(),
        message: z.string().max(500).optional(),
        validDays: z.number().int().min(1).max(14).optional(),
      })
      .parse(req.body);
    res.status(201).json({ offer: await wishes.makeOffer(owner(req), String(req.params.id), input, (req as Request as OwnerRequest).staffName) });
  });
  ownerApi.post('/wish-offers/:id/withdraw', (req, res) => {
    res.json({ offer: wishes.withdrawOffer(owner(req), String(req.params.id)) });
  });
  ownerApi.get('/waitlist', (req, res) => {
    res.json({ entries: store.waitlistFor(owner(req).id).filter((w) => w.status === 'waiting').map(({ email: _e, publicToken: _t, ...w }) => w) });
  });
  ownerApi.get('/export/google-business', (req, res) => {
    res.type('text/plain').send(googleBusinessExport(owner(req)));
  });
  ownerApi.get('/insights', (req, res) => {
    res.json({ ...insights(store, owner(req), Math.min(365, Math.max(1, Number(req.query.days) || 30))), host: requests.hostStats(owner(req).id) });
  });
  ownerApi.get('/conflicts', async (req, res) => {
    res.json({ conflicts: await requests.conflicts(owner(req)) });
  });
  /** Everything agents did for guests at this property: who, what, when. */
  ownerApi.get('/audit-log', (req, res) => {
    const p = owner(req);
    const entries = store
      .eventsFor(p.id, new Date(Date.now() - 90 * 86_400_000))
      .filter((e) => e.type === 'agent_action')
      .map((e) => ({ at: e.at, agent: e.agentClient, ...e.meta }))
      .reverse();
    res.json({ entries });
  });
  ownerApi.post('/requests/:id/decline', async (req, res) => {
    const { note } = z.object({ note: z.string().max(2000).optional() }).parse(req.body ?? {});
    res.json(handledBy(store, req, await requests.decline(owner(req), String(req.params.id), note)));
  });

  // Questions agents asked on behalf of guests
  ownerApi.get('/questions', (req, res) => {
    const p = owner(req);
    const list = store
      .questionsFor(p.id)
      .slice()
      .sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : a.status === 'open' ? -1 : 1))
      .map((q) => ({ ...q, publicToken: undefined, unitName: q.unitId ? p.units.find((u) => u.id === q.unitId)?.name : undefined }));
    res.json({ questions: list });
  });
  ownerApi.post('/questions/:id/answer', async (req, res) => {
    const { answer, factValue, publishAsFaq } = z.object({ answer: z.string().min(1).max(2000), factValue: z.unknown().optional(), publishAsFaq: z.boolean().optional() }).parse(req.body);
    res.json(await questions.answer(owner(req), String(req.params.id), { answer, factValue, publishAsFaq }));
  });

  /** Everything of this accommodation in one file, for the owner's own backup. */
  ownerApi.get('/backup', (req, res) => {
    const p = owner(req);
    const { ownerKeyHash: _omit, ...property } = p;
    const day = new Date().toISOString().slice(0, 10);
    res
      .set('content-disposition', `attachment; filename="innli-${p.slug}-${day}.json"`)
      .json({ exportedAt: new Date().toISOString(), version: VERSION, property, requests: store.requestsFor(p.id), questions: store.questionsFor(p.id), waitlist: store.waitlistFor(p.id), demand: store.demandFor(p.id, new Date(0)), events: store.eventsFor(p.id, new Date(0)) });
  });

  // Automatic backups (INNLI_BACKUP_DIR) and restoring this accommodation from a downloaded backup file.
  ownerApi.get('/backups', (_req, res) => {
    res.json(opts.backups ? { configured: true, dir: opts.backups.dir, backups: listBackups(opts.backups.dir).slice(0, 30) } : { configured: false, backups: [] });
  });
  ownerApi.post('/backups/now', (_req, res) => {
    if (!opts.backups) {
      res.status(409).json({ error: 'Set INNLI_BACKUP_DIR to a folder outside the data folder to switch on automatic backups.' });
      return;
    }
    res.json(opts.backups.run());
  });
  ownerApi.post('/restore', express.json({ limit: '50mb' }), (req, res) => {
    const p = owner(req);
    const backup = z
      .object({
        version: z.string(),
        property: z.object({ id: z.string(), name: z.string(), units: z.array(z.object({ id: z.string() }).passthrough()), facts: z.record(z.string(), z.unknown()) }).passthrough(),
        requests: z.array(z.object({ id: z.string(), propertyId: z.string(), publicToken: z.string() }).passthrough()),
        questions: z.array(z.object({ id: z.string(), propertyId: z.string() }).passthrough()).default([]),
        waitlist: z.array(z.object({ id: z.string(), propertyId: z.string() }).passthrough()).default([]),
      })
      .parse(req.body);
    if (backup.property.id !== p.id) {
      res.status(409).json({ error: `This backup is of another accommodation (${backup.property.name}).` });
      return;
    }
    // Everything from the file, but the owner key stays the one in use now.
    const ownerKeyHash = p.ownerKeyHash;
    for (const k of Object.keys(p)) delete (p as unknown as Record<string, unknown>)[k];
    Object.assign(p, backup.property, { id: backup.property.id, ownerKeyHash });
    store.saveProperty(p);
    const own = <T extends { propertyId: string }>(xs: T[]) => xs.filter((x) => x.propertyId === p.id);
    for (const r of own(backup.requests)) store.saveRequest(r as unknown as BookingRequest);
    for (const q of own(backup.questions)) store.saveQuestion(q as unknown as Parameters<typeof store.saveQuestion>[0]);
    for (const w of own(backup.waitlist)) store.saveWaitlist(w as unknown as Parameters<typeof store.saveWaitlist>[0]);
    store.flush();
    res.json({ restored: { requests: own(backup.requests).length, questions: own(backup.questions).length, waitlist: own(backup.waitlist).length }, from: backup.version });
  });

  /** Licence and INNLI-guide status of this installation. */
  const licenseView = () => {
    const settings = store.getSettings();
    return {
      ...describeLicense(verifyLicense(settings.license)),
      version: VERSION,
      releaseDate: RELEASE_DATE,
      guide: { configured: Boolean(opts.guideUrl), url: opts.guideUrl, ...settings.directory },
    };
  };
  ownerApi.get('/license', (_req, res) => {
    res.json(licenseView());
  });
  ownerApi.put('/license', async (req, res) => {
    const { license } = z.object({ license: z.string().trim().max(4000) }).parse(req.body);
    const status = verifyLicense(license);
    if (status.state === 'invalid') {
      res.status(400).json({ error: t('own.licenseInvalid', { reason: status.reason }) });
      return;
    }
    store.updateSettings({ license });
    if (opts.guideUrl) await registerWithGuide(store, opts.guideUrl, opts.publicUrl, opts.fetcher);
    res.json(licenseView());
  });
  ownerApi.post('/guide/register', async (_req, res) => {
    if (!opts.guideUrl) {
      res.status(400).json({ error: t('own.noGuide') });
      return;
    }
    const result = await registerWithGuide(store, opts.guideUrl, opts.publicUrl, opts.fetcher);
    res.json({ ...licenseView(), ok: result.ok, message: result.message });
  });

  app.use('/api/owner', ownerApi);

  // ---------------------------------------------------------------- Admin
  const adminApi = express.Router();
  adminApi.use(requireAdmin(opts.adminKey));
  adminApi.get('/agents/report', (req, res) => {
    res.json(agentReport(store, Math.min(365, Math.max(1, Number(req.query.days) || 90))));
  });
  adminApi.get('/properties', (_req, res) => {
    res.json(store.listProperties().map((p) => ({ id: p.id, slug: p.slug, name: p.name, published: p.published, completeness: completeness(p).score })));
  });
  adminApi.post('/properties', (req, res) => {
    const input = z.object({ name: z.string().min(2), type: z.enum(['bnb', 'pension', 'guesthouse', 'holiday_home', 'unique_stay', 'hotel']).optional(), address: z.object({ city: z.string(), country: z.string().length(2) }).passthrough() }).parse(req.body);
    const { property, ownerKey } = createProperty(input as Parameters<typeof createProperty>[0]);
    if (store.getProperty(property.slug)) property.slug = `${property.slug}-${randomUUID().slice(0, 4)}`;
    store.saveProperty(property);
    res.status(201).json({ property: ownerView(property), ownerKey, note: t('own.keepOwnerKey') });
  });
  adminApi.post('/agents', (req, res) => {
    const { name, scopes } = z.object({ name: z.string().min(2).max(80), scopes: z.array(z.enum(['read', 'act'])).min(1).default(['read', 'act']) }).parse(req.body);
    const key = newKey('innli_agt');
    const agent = { id: `agt_${randomUUID().slice(0, 8)}`, name, keyHash: hashKey(key), scopes, createdAt: new Date().toISOString() };
    store.saveAgent(agent);
    res.status(201).json({ id: agent.id, name, scopes, key, note: t('own.keepKey') });
  });
  app.use('/api/admin', adminApi);

  if (opts.demo) app.use('/demo-engine', demoEngine(store));
  app.use(publicPages(store, catalog, requests, opts.publicUrl, reviews));

  app.use('/dashboard', express.static(`${publicDir}dashboard`, { index: 'index.html' }));
  app.get('/', (_req, res) => {
    res.redirect('/dashboard/');
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.') || t('err.input')}: ${i.message}`).join('; ') });
    } else if (err instanceof RequestError) {
      res.status(err.status).json({ error: err.message });
    } else if (err instanceof FactValidationError || err instanceof CatalogError || err instanceof DateRangeError) {
      res.status(400).json({ error: err.message });
    } else if (err instanceof SyntaxError && 'body' in (err as object)) {
      res.status(400).json({ error: t('err.json') });
    } else {
      console.error(`[${res.locals.requestId}]`, err);
      res.status(500).json({ error: t('err.internal'), requestId: res.locals.requestId });
    }
  });

  return app;
}
