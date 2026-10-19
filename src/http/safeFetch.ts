import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Fetcher } from '../connectors/availability.ts';

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

/**
 * Fetcher for owner-supplied URLs (websites, calendars, booking APIs). Refuses
 * non-http(s) schemes and private network targets so the server cannot be used
 * to probe internal infrastructure.
 */
export function safeFetcher(allowPrivate: boolean, base: Fetcher = fetch): Fetcher {
  if (allowPrivate) return base;
  return async (url, init) => {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('alleen http(s) toegestaan');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
    if (addresses.some(isPrivateAddress)) throw new Error('private network address not allowed');
    return base(url, { ...init, redirect: 'manual' }).then(async (res) => {
      // Follow at most a few redirects, re-checking each hop.
      let current = res;
      let hops = 0;
      let at = u;
      while (current.status >= 300 && current.status < 400 && current.headers.get('location') && hops < 3) {
        at = new URL(current.headers.get('location')!, at);
        if (at.protocol !== 'http:' && at.protocol !== 'https:') throw new Error('ongeldige redirect');
        const h = at.hostname.replace(/^\[|\]$/g, '');
        const addrs = isIP(h) ? [h] : (await lookup(h, { all: true })).map((a) => a.address);
        if (addrs.some(isPrivateAddress)) throw new Error('redirect to a private network not allowed');
        current = await base(at.toString(), { ...init, redirect: 'manual' });
        hops++;
      }
      return current;
    });
  };
}

export function rateLimiter(perMinute: number) {
  const window = rateWindow(perMinute);
  return (key: string): boolean => window(key).allowed;
}

export interface RateState {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets. */
  resetSeconds: number;
}

/** The same fixed one-minute window, with the numbers for RateLimit headers. */
export function rateWindow(perMinute: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (key: string): RateState => {
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + 60_000 };
      hits.set(key, entry);
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    }
    entry.count++;
    return { allowed: entry.count <= perMinute, limit: perMinute, remaining: Math.max(0, perMinute - entry.count), resetSeconds: Math.max(1, Math.ceil((entry.reset - now) / 1000)) };
  };
}
