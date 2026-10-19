/** Lightweight HTML helpers: enough to audit a small accommodation website without a DOM. */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', eacute: 'é', euml: 'ë', iuml: 'ï' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Text a visitor actually sees (scripts, styles and markup removed). */
export function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

export function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decodeEntities(m[1]).trim() || null : null;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : null;
}

export function metaContent(html: string, name: string): string | null {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if ((attr(tag, 'name') ?? attr(tag, 'property'))?.toLowerCase() === name.toLowerCase()) return attr(tag, 'content');
  }
  return null;
}

export function htmlLang(html: string): string | null {
  const m = /<html\b[^>]*>/i.exec(html);
  return m ? attr(m[0], 'lang') : null;
}

export function extractLinks(html: string, base: string): { href: string; text: string }[] {
  const links: { href: string; text: string }[] = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[1], 'href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
    try {
      links.push({ href: new URL(href, base).toString(), text: visibleText(m[2]) });
    } catch {
      // ignore malformed URLs
    }
  }
  return links;
}

/** All JSON-LD objects on the page, flattened (including @graph members). */
export function extractJsonLd(html: string): { items: Record<string, unknown>[]; errors: number } {
  const items: Record<string, unknown>[] = [];
  let errors = 0;
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const queue = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of queue) {
        if (item && typeof item === 'object') {
          if (Array.isArray(item['@graph'])) queue.push(...item['@graph']);
          else items.push(item);
        }
      }
    } catch {
      errors++;
    }
  }
  return { items, errors };
}

export function jsonLdTypes(item: Record<string, unknown>): string[] {
  const t = item['@type'];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string');
}
