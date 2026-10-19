import type { Property, Quote, Unit } from '../domain/types.ts';

const PLACEHOLDERS = ['checkin', 'checkout', 'adults', 'children', 'dogs', 'unit', 'ref'] as const;

export function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:';
  } catch {
    return false;
  }
}

export function validateDeeplinkTemplate(template: string): string | null {
  const unknown = [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((p) => !(PLACEHOLDERS as readonly string[]).includes(p));
  if (unknown.length) return `Onbekende placeholder(s): ${unknown.join(', ')}`;
  const sample = template.replace(/\{(\w+)\}/g, 'x');
  if (!/^https?:\/\//.test(sample) || !isSafeUrl(sample)) return 'Template moet een geldige http(s)-URL zijn';
  return null;
}

/** Fills the property's booking URL template; data and guests are pre-filled where supported. */
export function fillTemplate(template: string, quote: Quote, unit: Unit, ref: string): string {
  const values: Record<string, string> = {
    checkin: quote.checkin,
    checkout: quote.checkout,
    adults: String(quote.guests.adults),
    children: String(quote.guests.children),
    dogs: String(quote.guests.dogs),
    unit: unit.externalRef ?? unit.id,
    ref,
  };
  let url = template.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(values[k] ?? ''));
  if (!template.includes('{ref}')) {
    // Append without re-serialising, so the template's own encoding is kept intact.
    const [beforeHash, hash] = url.split('#', 2);
    url = `${beforeHash}${beforeHash.includes('?') ? '&' : '?'}innli_ref=${encodeURIComponent(ref)}${hash !== undefined ? `#${hash}` : ''}`;
  }
  return url;
}

/**
 * Where the guest goes to finish. With a live-checked quote this is the
 * property's own booking environment; otherwise an availability request:
 * the owner's own request page if set, else INNLI's built-in stay page.
 */
export function bookingTarget(property: Property, unit: Unit, quote: Quote, ref: string, publicUrl: string): string {
  const { deeplinkTemplate, requestUrl } = property.booking;
  if (deeplinkTemplate) return fillTemplate(deeplinkTemplate, quote, unit, ref);
  const u = new URL(requestUrl ?? `${publicUrl.replace(/\/$/, '')}/verblijf/${encodeURIComponent(property.slug)}`);
  u.searchParams.set('unit', unit.id);
  u.searchParams.set('checkin', quote.checkin);
  u.searchParams.set('checkout', quote.checkout);
  u.searchParams.set('adults', String(quote.guests.adults));
  u.searchParams.set('children', String(quote.guests.children));
  u.searchParams.set('dogs', String(quote.guests.dogs));
  if (quote.breakfast) u.searchParams.set('breakfast', '1');
  u.searchParams.set(requestUrl ? 'innli_ref' : 'ref', ref);
  if (!requestUrl) u.hash = 'aanvragen';
  return u.toString();
}
