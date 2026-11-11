/**
 * The website in every language.
 *
 *   npm run site             writes site/<lang>/index.html for every site/i18n/<lang>.json
 *   npm run site -- --units  writes site/i18n/en.json: the English texts to translate
 *
 * site/index.html is the English page and the only one edited by hand. A
 * translation file maps each English text (with its inline tags) to the same
 * text in another language. A text without a translation stays English, and
 * the script says which ones are missing.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', 'site');
const source = readFileSync(join(root, 'index.html'), 'utf8');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const hasWords = (s: string) => /\p{L}{2,}/u.test(s.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ''));

/** Walks the page and hands every translatable text to `swap`, which returns what to put there. */
function walk(html: string, swap: (unit: string) => string): string {
  const kept: string[] = [];
  const keep = (text: string) => `\u0000${kept.push(text) - 1}\u0000`;
  // Never translated: code, drawings, the language names.
  let out = html.replace(/<(script|style|pre|svg|select)\b[\s\S]*?<\/\1>/g, (m) => keep(m));
  // Whole blocks, with their inline tags.
  out = out.replace(/<(title|h1|h2|h3|p|li|td|th|button)(\s[^>]*)?>([\s\S]*?)<\/\1>/g, (m, tag, attrs = '', inner) => (hasWords(inner) && !/^\s*<code>[^<]*<\/code>(\s*·\s*<code>[^<]*<\/code>)*\s*$/.test(inner) ? keep(`<${tag}${attrs}>${swap(norm(inner))}</${tag}>`) : keep(m)));
  // Texts that stand on their own between tags.
  out = out.replace(/>([^<>\u0000]+)</g, (m, text) => (hasWords(text) ? `>${text.match(/^\s*/)![0]}${swap(norm(text))}${text.match(/\s*$/)![0]}<` : m));
  // Texts in attributes.
  out = out.replace(/\b(aria-label|alt)="([^"]+)"/g, (_m, name, text) => `${name}="${swap(text)}"`);
  out = out.replace(/(<meta (?:name="description"|property="og:(?:title|description)") content=")([^"]+)(")/g, (_m, a, text, b) => `${a}${swap(text)}${b}`);
  // eslint-disable-next-line no-control-regex
  for (let i = 0; i < 3; i++) out = out.replace(/\u0000(\d+)\u0000/g, (_m, n) => kept[Number(n)]);
  return out;
}

export function units(): string[] {
  const list: string[] = [];
  walk(source, (u) => {
    if (!list.includes(u)) list.push(u);
    return u;
  });
  return list;
}

export function translate(lang: string, dictionary: Record<string, string>): { html: string; missing: string[] } {
  const missing: string[] = [];
  let html = walk(source, (u) => {
    const t = dictionary[u];
    if (!t && !missing.includes(u)) missing.push(u);
    return t || u;
  });
  html = html
    .replace('<html lang="en" data-root="./">', `<html lang="${lang}" data-root="../">`)
    .replace(/\b(href|src|poster)="(favicon\.svg|demo\.mp4|demo-poster\.jpg|og\.png|fonts\/fonts\.css|privacy\.html)"/g, '$1="../$2"');
  return { html, missing };
}

if (process.argv[1]?.endsWith('site.ts')) {
  const dir = join(root, 'i18n');
  mkdirSync(dir, { recursive: true });
  if (process.argv.includes('--units')) {
    writeFileSync(join(dir, 'en.json'), `${JSON.stringify(units(), null, 2)}\n`);
    console.log(`${units().length} texts written to site/i18n/en.json`);
  } else {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'en.json')) {
      const lang = file.replace('.json', '');
      const { html, missing } = translate(lang, JSON.parse(readFileSync(join(dir, file), 'utf8')));
      mkdirSync(join(root, lang), { recursive: true });
      writeFileSync(join(root, lang, 'index.html'), html);
      console.log(`${lang}: written${missing.length ? `, ${missing.length} texts still in English` : ''}`);
      for (const m of missing.slice(0, 5)) console.log(`   missing: ${m.slice(0, 90)}`);
    }
    if (!existsSync(join(dir, 'en.json'))) console.log('Run with --units first to list the English texts.');
  }
}
