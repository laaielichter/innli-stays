import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { MESSAGES, type MessageKey, type Params } from './messages.ts';

/**
 * Languages INNLI speaks. Owners: nl/en. Guests: all four. Agents: English by
 * default (INNLI_AGENT_LANG), since tool descriptions are English and agents
 * translate for the guest themselves.
 */
export const LANGS = ['nl', 'en', 'de', 'fr'] as const;
export type Lang = (typeof LANGS)[number];

export const LOCALE: Record<Lang, string> = { nl: 'nl-NL', en: 'en-GB', de: 'de-DE', fr: 'fr-FR' };
export const LANG_NAMES: Record<Lang, string> = { nl: 'Nederlands', en: 'English', de: 'Deutsch', fr: 'Français' };

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v);

/** Language of the installation (owner dashboard, e-mails to the owner, pages without a preference). */
export function defaultLang(): Lang {
  const v = process.env.INNLI_LANG;
  return isLang(v) ? v : 'nl';
}

export function agentLang(): Lang {
  const v = process.env.INNLI_AGENT_LANG;
  return isLang(v) ? v : 'en';
}

/** Owners read Dutch or English: the description language when that is one of them, else the installation language. */
export function ownerLang(property: { language?: string }): Lang {
  if (property.language === 'nl' || property.language === 'en') return property.language;
  const d = defaultLang();
  return d === 'nl' || d === 'en' ? d : 'en';
}

const context = new AsyncLocalStorage<Lang>();

/** The language of the request being handled, so domain code does not need a language parameter. */
export function currentLang(): Lang {
  return context.getStore() ?? defaultLang();
}

export function withLang<T>(lang: Lang, fn: () => T): T {
  return context.run(lang, fn);
}

/** Express middleware: runs the rest of the request in the language `pick` chooses. */
export function langMiddleware(pick: (req: Request) => Lang) {
  return (req: Request, _res: Response, next: NextFunction) => context.run(pick(req), next);
}

/**
 * Language for an HTTP request: an explicit choice (x-innli-lang header, ?lang=
 * or the innli_lang cookie) first; agents get the agent language; pages follow
 * the browser; everything else the installation language.
 */
/** A language the caller chose explicitly (x-innli-lang header, ?lang= or the innli_lang cookie). */
export function explicitLang(req: Request): Lang | undefined {
  const explicit = req.headers['x-innli-lang'] ?? req.query?.lang ?? /(?:^|;\s*)innli_lang=(\w+)/.exec(req.headers.cookie ?? '')?.[1];
  return isLang(explicit) ? explicit : undefined;
}

export function pickLang(req: Request): Lang {
  const explicit = explicitLang(req);
  if (explicit) return explicit;
  if (req.path === '/mcp' || req.path.startsWith('/api/agent/')) return agentLang();
  if (req.path.startsWith('/api/')) return defaultLang();
  return fromAcceptLanguage(req.headers['accept-language']) ?? defaultLang();
}

/** First supported language from an Accept-Language header, honouring q-values. */
export function fromAcceptLanguage(header: string | undefined): Lang | undefined {
  if (!header) return undefined;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';q=');
      return { lang: tag.slice(0, 2).toLowerCase(), q: q === undefined ? 1 : Number(q) };
    })
    .filter((x) => x.q > 0)
    .sort((a, b) => b.q - a.q);
  return ranked.find((x) => isLang(x.lang))?.lang as Lang | undefined;
}

/** Translate; falls back to English, then Dutch, then the key itself. */
export function t(key: MessageKey, params: Params = {}, lang: Lang = currentLang()): string {
  const msg = MESSAGES[lang][key] ?? MESSAGES.en[key] ?? MESSAGES.nl[key];
  if (msg === undefined) return key;
  const text = typeof msg === 'function' ? msg(params) : msg;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (params[name] === undefined ? m : String(params[name])));
}

export function money(amount: number, lang: Lang = currentLang(), currency = 'EUR'): string {
  return new Intl.NumberFormat(LOCALE[lang], { style: 'currency', currency, maximumFractionDigits: Number.isInteger(amount) && Math.abs(amount) >= 100 ? 0 : 2 }).format(amount);
}

export function formatDate(iso: string, lang: Lang = currentLang(), opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(LOCALE[lang], { ...opts, timeZone: 'UTC' });
}

export type { MessageKey, Params };
