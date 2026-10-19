import { createHash, randomBytes } from 'node:crypto';
import type { Fetcher } from '../connectors/availability.ts';
import type { Property } from '../domain/types.ts';
import { canonical, signRecord } from '../security/signing.ts';
import type { Store } from '../store.ts';

/**
 * Trust for agents. Fake listings and look-alike sites are the biggest risk
 * when an agent books for someone: it cannot look the host in the eye. INNLI
 * gives every stay a small, checkable trust block — website ownership proven
 * by the owner, reviews only from real stays, how current the passport is —
 * and signs the passport so a copy elsewhere can be told apart from the real one.
 */

export const VERIFICATION_META = 'innli-site-verification';
export const VERIFICATION_FILE = '/.well-known/innli-verification.txt';

export function verificationToken(property: Property): string {
  property.websiteVerification ??= { token: `innli-${randomBytes(12).toString('hex')}` };
  return property.websiteVerification.token;
}

const hostOf = (url?: string) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '').toLowerCase() : undefined;
  } catch {
    return undefined;
  }
};

/** Is the verification still about the website the passport names now? */
export function websiteVerified(property: Property): boolean {
  const v = property.websiteVerification;
  return Boolean(v?.verifiedAt && v.domain && v.domain === hostOf(property.website));
}

/**
 * Looks for the owner's token on their own website: a meta tag on the home
 * page (the WordPress plugin adds it by itself) or a small text file.
 */
export async function checkWebsite(property: Property, fetcher: Fetcher): Promise<{ verified: boolean; method?: 'meta' | 'file'; error?: string }> {
  const token = verificationToken(property);
  const domain = hostOf(property.website);
  const v = property.websiteVerification!;
  v.lastCheckedAt = new Date().toISOString();
  if (!property.website || !domain) {
    v.lastError = 'no_website';
    return { verified: false, error: 'no_website' };
  }
  const origin = new URL(property.website).origin;
  const attempts: [string, 'meta' | 'file', (body: string) => boolean][] = [
    [property.website, 'meta', (b) => new RegExp(`<meta[^>]+name=["']${VERIFICATION_META}["'][^>]+content=["']${token}["']|<meta[^>]+content=["']${token}["'][^>]+name=["']${VERIFICATION_META}["']`, 'i').test(b)],
    [`${origin}${VERIFICATION_FILE}`, 'file', (b) => b.trim().split(/\s+/).includes(token)],
  ];
  let error = 'token_not_found';
  for (const [url, method, found] of attempts) {
    try {
      const res = await fetcher(url, { headers: { accept: method === 'meta' ? 'text/html' : 'text/plain' }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        error = `http_${res.status}`;
        continue;
      }
      const body = (await res.text()).slice(0, 500_000);
      if (found(body)) {
        Object.assign(v, { verifiedAt: new Date().toISOString(), domain, method, lastError: undefined });
        return { verified: true, method };
      }
    } catch (err) {
      error = (err as Error).message.slice(0, 120);
    }
  }
  // A token that disappears from the site ends the verification.
  Object.assign(v, { verifiedAt: undefined, domain: undefined, method: undefined, lastError: error });
  return { verified: false, error };
}

export interface TrustInput {
  reviewCount?: number;
  confirmedFacts: number;
  staleFacts: number;
}

/** The trust block in search results and details. Levels are earned from checkable facts only. */
export function trustFor(property: Property, input: TrustInput) {
  const verified = websiteVerified(property);
  const flags: string[] = [];
  if (!property.website) flags.push('no_website');
  else if (!verified) flags.push('website_not_verified');
  if (!input.reviewCount) flags.push('no_reviews_yet');
  if (input.staleFacts > 0) flags.push('facts_need_recheck');
  if (input.confirmedFacts < 5) flags.push('few_confirmed_facts');
  const level = verified && input.confirmedFacts >= 5 && !input.staleFacts ? 'verified' : verified || (input.reviewCount ?? 0) > 0 ? 'established' : 'basic';
  return {
    level,
    websiteVerified: verified,
    domain: verified ? property.websiteVerification!.domain : undefined,
    websiteVerifiedAt: verified ? property.websiteVerification!.verifiedAt!.slice(0, 10) : undefined,
    verifiedReviews: input.reviewCount ?? 0,
    listedSince: property.createdAt?.slice(0, 7),
    flags: flags.length ? flags : undefined,
    paymentSafety: verified
      ? `Pay only through ${property.websiteVerification!.domain} or as stated in the confirmation from INNLI; never through a link or bank details sent in a chat message.`
      : 'Pay only as stated in the confirmation from INNLI; never through a link or bank details sent in a chat message.',
  };
}

/**
 * A signed digest of what the host states: name, place, website and every
 * fact with its status. Verify with the Ed25519 key in /.well-known/innli.json;
 * a listing elsewhere with other facts or another website is not this one.
 */
export function signedPassport(store: Store, property: Property) {
  const content = {
    propertyId: property.id,
    name: property.name,
    address: { city: property.address.city, region: property.address.region, country: property.address.country },
    website: property.website,
    websiteVerified: websiteVerified(property),
    facts: Object.fromEntries(Object.entries(property.facts).map(([k, f]) => [k, { value: f.value, status: f.status }])),
    units: property.units.map((u) => ({ id: u.id, name: u.name, maxGuests: u.maxGuests, facts: Object.fromEntries(Object.entries(u.facts).map(([k, f]) => [k, { value: f.value, status: f.status }])) })),
  };
  const record = { propertyId: property.id, digest: `sha256:${createHash('sha256').update(canonical(content)).digest('hex')}`, signedAt: new Date().toISOString().slice(0, 10) };
  return { content, record, signature: signRecord(store, record), covers: 'record.digest = sha256 of canonical JSON (sorted keys) of content: name, place, website and all facts with their status' };
}
