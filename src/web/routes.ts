import express, { type Request, type Response, type Router } from 'express';
import { z } from 'zod';
import type { Catalog } from '../catalog.ts';
import { addDays, stayNights } from '../domain/dates.ts';
import type { Property } from '../domain/types.ts';
import { rateLimiter } from '../http/safeFetch.ts';
import { AnswerAgent } from '../requests/answers.ts';
import { RequestError, type RequestService } from '../requests/service.ts';
import type { ReviewService } from '../requests/reviews.ts';
import type { Store } from '../store.ts';
import { currentLang, explicitLang, LANGS, t, type Lang } from '../i18n/index.ts';
import { esc, layout, offerHtml, reviewPage, stayPage, statusPage, type FormValues, type OfferView } from './pages.ts';

const CALENDAR_DAYS = 90;

/**
 * Public pages of a self-hosted installation: one page per stay (readable for
 * guests and search crawlers, embeddable on the owner's website) with a
 * request form, and a status page per request.
 */
export function publicPages(store: Store, catalog: Catalog, requests: RequestService, publicUrlRaw: string, reviews: ReviewService): Router {
  const r = express.Router();
  const publicUrl = publicUrlRaw.replace(/\/$/, '');
  const formLimit = rateLimiter(5);
  const priceLimit = rateLimiter(60);

  // A language chosen with ?lang= sticks for the next pages (form posts, status page).
  r.use((req, res, next) => {
    const chosen = typeof req.query.lang === 'string' ? explicitLang(req) : undefined;
    if (chosen) res.cookie('innli_lang', chosen, { maxAge: 365 * 86_400_000, sameSite: 'lax', path: '/' });
    next();
  });
  /** Guest pages about one request follow the guest's language unless they chose another. */
  const guestLang = (req: Request, r: { language?: Lang }): Lang => explicitLang(req) ?? r.language ?? currentLang();
  const notFound = (lang: Lang = currentLang()) => layout(t('pg.notFound', {}, lang), `<h1>${esc(t('pg.notFound', {}, lang))}</h1><p>${esc(t('pg.notFoundText', {}, lang))}</p>`, { lang });

  const find = (req: Request, res: Response): Property | null => {
    const p = store.getProperty(String(req.params.slug));
    if (!p || !p.published) {
      res.status(404).type('html').send(notFound());
      return null;
    }
    return p;
  };

  const calendars = async (p: Property) => {
    const map = new Map<string, Awaited<ReturnType<Catalog['roomCalendar']>>['nights']>();
    if (p.booking.connector.kind !== 'manual' && p.booking.connector.kind !== 'ical') return map;
    const from = new Date().toISOString().slice(0, 10);
    const nights = stayNights(from, addDays(from, CALENDAR_DAYS), CALENDAR_DAYS + 1);
    for (const u of p.units) {
      const overview = await catalog.roomCalendar(p, u, nights);
      // A calendar that could not be read is not shown at all, rather than shown as free.
      if (!overview.feedErrors.length) map.set(u.id, overview.nights);
    }
    return map;
  };

  const offerFor = async (p: Property, v: FormValues): Promise<{ offer: OfferView | null; error?: string }> => {
    if (!v.unitId || !v.checkin || !v.checkout) return { offer: null };
    try {
      const rooms = Math.min(10, Math.max(1, Math.floor(Number(v.rooms) || 1)));
      const extras = Object.entries(v.extras ?? {}).filter(([, n]) => n > 0).map(([id, qty]) => ({ id, qty }));
      const o = await catalog.offer(p, v.unitId, v.checkin, v.checkout, { adults: Number(v.adults ?? 2), children: Number(v.children ?? 0), dogs: Number(v.dogs ?? 0) }, Boolean(v.breakfast), { rooms, ratePlanId: v.ratePlanId || undefined, extras, discountCode: v.discountCode || undefined });
      if (o.availability.status === 'unavailable') return { offer: null, error: t('cat.unitUnavailable', { unit: o.unit.name }) };
      return { offer: { currency: o.quote.currency, lines: o.quote.lines, total: o.quote.total, complete: o.quote.complete, available: o.availability.status, note: o.availability.note, warnings: o.quote.warnings } };
    } catch (err) {
      return { offer: null, error: (err as Error).message };
    }
  };

  /** Form fields extra_<id> = quantity (a checkbox sends 1). */
  const extrasFrom = (q: Record<string, unknown>): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [k, val] of Object.entries(q)) {
      if (!k.startsWith('extra_') || typeof val !== 'string') continue;
      const n = Math.floor(Number(val));
      if (n > 0 && n <= 50 && /^extra_[a-z0-9-]{2,30}$/.test(k)) out[k.slice(6)] = n;
    }
    return out;
  };

  const valuesFrom = (q: Record<string, unknown>): FormValues => {
    const s = (k: string) => (typeof q[k] === 'string' ? (q[k] as string).slice(0, 2000) : undefined);
    return { unitId: s('unitId') ?? s('unit'), checkin: s('checkin'), checkout: s('checkout'), adults: s('adults'), children: s('children'), dogs: s('dogs'), breakfast: ['1', 'on', 'true'].includes(s('breakfast') ?? ''), name: s('name'), email: s('email'), phone: s('phone'), message: s('message'), ref: s('ref'), rooms: s('rooms'), ratePlanId: s('ratePlanId'), discountCode: s('discountCode'), extras: extrasFrom(q) };
  };

  // English addresses for the same pages: /stay/<name>, /request/<token>, /review/<token>.
  const alias = (from: string, to: string) =>
    r.get(`/${from}/:id`, (req, res) => {
      const q = req.originalUrl.indexOf('?');
      res.redirect(308, `/${to}/${encodeURIComponent(String(req.params.id))}${q >= 0 ? req.originalUrl.slice(q) : ''}`);
    });
  alias('stay', 'verblijf');
  alias('request', 'aanvraag');
  alias('review', 'beoordeling');

  /** Crawlers may read stay pages; dashboards, APIs and guests' status pages stay out. */
  r.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send(`User-agent: *\nAllow: /verblijf/\nAllow: /stay/\nAllow: /llms.txt\nAllow: /.well-known/\nAllow: /api/agent/v1/openapi.json\nAllow: /api/public/\nDisallow: /dashboard/\nDisallow: /api/\nDisallow: /aanvraag/\nDisallow: /request/\nDisallow: /beoordeling/\nDisallow: /review/\nDisallow: /r/\nDisallow: /mcp\n\nSitemap: ${publicUrl}/sitemap.xml\n`);
  });
  r.get('/sitemap.xml', (_req, res) => {
    const urls = store
      .listProperties()
      .filter((p) => p.published)
      .map((p) => {
        const loc = `${publicUrl}/verblijf/${encodeURIComponent(p.slug)}`;
        const alternates = LANGS.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(`${loc}?lang=${l}`)}"/>`).join('');
        return `<url><loc>${esc(loc)}</loc><lastmod>${p.updatedAt.slice(0, 10)}</lastmod>${alternates}</url>`;
      })
      .join('');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`);
  });

  r.get('/verblijf/:slug', async (req, res) => {
    const p = find(req, res);
    if (!p) return;
    const values = valuesFrom(req.query as Record<string, unknown>);
    const { offer, error } = await offerFor(p, values);
    const embed = req.query.embed === '1';
    res.set('content-language', currentLang()).type('html').send(stayPage(p, { calendars: embed ? new Map() : await calendars(p), values, offer, error, embed, basePath: `/verblijf/${encodeURIComponent(p.slug)}`, reviews: reviews.summary(p), publicUrl }));
  });

  /** Price preview for the form, as an HTML fragment. */
  r.get('/verblijf/:slug/prijs', async (req, res) => {
    const p = store.getProperty(String(req.params.slug));
    if (!p || !p.published || !priceLimit(req.ip ?? '')) {
      res.status(404).end();
      return;
    }
    const { offer, error } = await offerFor(p, valuesFrom(req.query as Record<string, unknown>));
    res.type('html').send(offer ? offerHtml(offer) : error ? `<p class="err">${esc(error)}</p>` : '');
  });

  /** "Ask us": the answer agent on the stay page, as an HTML fragment. Only confirmed details, never a guess. */
  const answers = new AnswerAgent(store);
  r.get('/verblijf/:slug/vraag', (req, res) => {
    const p = store.getProperty(String(req.params.slug));
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 300) : '';
    if (!p || !p.published || !priceLimit(req.ip ?? '') || q.length < 3) {
      res.status(404).end();
      return;
    }
    const lang = currentLang();
    const a = answers.answer(p, q, { lang });
    const text = a.confidence === 'unknown' ? t('pg.askFallback', {}, lang) : a.answered ? a.answer : `${a.answer}\n\n${t('pg.askFallback', {}, lang)}`;
    res.type('html').set('cache-control', 'no-store').send(`<p class="small" style="white-space:pre-line">${esc(text)}</p>`);
  });

  r.post('/verblijf/:slug/aanvraag', express.urlencoded({ extended: false, limit: '20kb' }), async (req, res) => {
    const p = find(req, res);
    if (!p) return;
    const embed = req.query.embed === '1';
    const values = valuesFrom(req.body ?? {});
    const render = async (status: number, error: string) =>
      res
        .status(status)
        .type('html')
        .send(stayPage(p, { calendars: embed ? new Map() : await calendars(p), values, offer: (await offerFor(p, values)).offer, error, embed, basePath: `/verblijf/${encodeURIComponent(p.slug)}`, reviews: reviews.summary(p), publicUrl }));
    // Honeypot: real people never fill in the hidden field.
    if (req.body?.website) {
      res.redirect(303, `/verblijf/${encodeURIComponent(p.slug)}`);
      return;
    }
    if (!formLimit(req.ip ?? '')) {
      await render(429, t('pg.tooMany'));
      return;
    }
    try {
      const v = values;
      const request = await requests.create(p, { ...req.body, extras: Object.entries(v.extras ?? {}).filter(([, n]) => n > 0).map(([id, qty]) => ({ id, qty })), discountCode: v.discountCode });
      res.redirect(303, `/aanvraag/${request.publicToken}`);
    } catch (err) {
      if (err instanceof z.ZodError) await render(400, err.issues.map((i) => i.message).join(' · '));
      else if (err instanceof RequestError) await render(err.status, err.message);
      else throw err;
    }
  });

  r.post('/aanvraag/:token/annuleren', express.urlencoded({ extended: false, limit: '4kb' }), async (req, res) => {
    const token = String(req.params.token);
    try {
      await requests.cancelByToken(token, { reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined, by: 'guest' });
    } catch (err) {
      if (!(err instanceof RequestError)) throw err;
      res.status(err.status).type('html').send(layout(t('pg.failed'), `<h1>${esc(t('pg.failed'))}</h1><p>${esc(err.message)}</p><p><a href="/aanvraag/${esc(token)}">${esc(t('pg.back'))}</a></p>`));
      return;
    }
    res.redirect(303, `/aanvraag/${encodeURIComponent(token)}`);
  });

  r.get('/beoordeling/:token', (req, res) => {
    const request = store.getRequestByToken(String(req.params.token));
    const p = request ? store.getProperty(request.propertyId) : undefined;
    if (!request || !p) {
      res.status(404).type('html').send(notFound());
      return;
    }
    res.set('x-robots-tag', 'noindex').type('html').send(reviewPage(p, request, { canReview: reviews.canReview(request), lang: guestLang(req, request) }));
  });

  r.post('/beoordeling/:token', express.urlencoded({ extended: false, limit: '8kb' }), (req, res) => {
    const token = String(req.params.token);
    const request = store.getRequestByToken(token);
    const p = request ? store.getProperty(request.propertyId) : undefined;
    if (!request || !p) {
      res.status(404).type('html').send(notFound());
      return;
    }
    try {
      reviews.submit(token, { rating: Number(req.body?.rating), text: typeof req.body?.text === 'string' ? req.body.text : undefined, aspects: Object.fromEntries(Object.entries(req.body ?? {}).filter(([k]) => k.startsWith('aspect_')).map(([k, v]) => [k.slice(7), v])) });
    } catch (err) {
      if (!(err instanceof RequestError)) throw err;
      res.status(err.status).type('html').send(reviewPage(p, request, { canReview: reviews.canReview(request), error: err.message, lang: guestLang(req, request) }));
      return;
    }
    res.redirect(303, `/beoordeling/${encodeURIComponent(token)}`);
  });

  r.get('/aanvraag/:token', (req, res) => {
    const request = store.getRequestByToken(String(req.params.token));
    const p = request ? store.getProperty(request.propertyId) : undefined;
    if (!request || !p) {
      res.status(404).type('html').send(notFound());
      return;
    }
    res.set('x-robots-tag', 'noindex').type('html').send(statusPage(p, request, guestLang(req, request)));
  });

  return r;
}
