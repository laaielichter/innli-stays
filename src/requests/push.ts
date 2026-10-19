import type { Property } from '../domain/types.ts';

/**
 * Push message to the owner's phone through ntfy (free app; the topic URL acts
 * as the secret). Never throws: a failing push must not break a booking.
 */
export async function pushToOwner(property: Property, title: string, message: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const url = property.notify?.ntfyUrl;
  if (!url || !url.startsWith('https://')) return false;
  try {
    const res = await fetcher(url, {
      method: 'POST',
      headers: { title: encodeURIComponent(title).length > 200 ? 'INNLI' : title.replace(/[^\x20-\x7E]/g, ''), tags: 'house', 'content-type': 'text/plain; charset=utf-8' },
      body: message.slice(0, 2000),
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
