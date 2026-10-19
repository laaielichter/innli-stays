import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { Fetcher } from '../connectors/availability.ts';
import { haversineKm } from '../domain/matching.ts';
import { roomLimit, verifyLicense } from '../licensing/license.ts';
import type { ListingProperty, RegistrationRequest, WellKnown } from './types.ts';

export interface Listing {
  instanceId: string;
  instanceUrl: string;
  licenseId?: string;
  licenseName?: string;
  version: string;
  properties: ListingProperty[];
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Stays per installation in an open guide, so one installation cannot flood it. */
export const OPEN_MAX_PROPERTIES = 100;

/** Installations that stop checking in disappear from the guide. */
export const LISTING_TTL_MS = 3 * 86_400_000;

export class GuideError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const listingProperty = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  type: z.string().max(40),
  city: z.string().min(1).max(100),
  region: z.string().max(100).optional(),
  country: z.string().length(2),
  geo: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
  summary: z.string().max(400),
  rooms: z.number().int().min(0).max(100_000).optional(),
});

export const registrationSchema = z.object({
  instanceId: z.string().regex(/^ins_[a-f0-9]{12}$/),
  instanceUrl: z.string().url().max(300),
  license: z.string().max(4000).optional(),
  version: z.string().max(20),
  releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  properties: z.array(listingProperty).max(500),
});

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * The INNLI guide: a small public index of self-hosted installations. It holds
 * no passports, prices or calendars — only enough to route an agent's question
 * to the right installations, which answer live.
 */
export class Guide {
  private listings: Listing[];
  private path?: string;
  private fetcher: Fetcher;
  private requireHttps: boolean;
  private requireLicense: boolean;

  /**
   * requireLicense: only installations with a licence key are listed. Without it
   * (the public, donation-funded guide) every installation that proves it runs
   * at its address is listed, up to OPEN_MAX_PROPERTIES stays.
   */
  constructor(opts: { path?: string; fetcher: Fetcher; requireHttps: boolean; requireLicense?: boolean }) {
    this.path = opts.path;
    this.fetcher = opts.fetcher;
    this.requireHttps = opts.requireHttps;
    this.requireLicense = opts.requireLicense ?? true;
    this.listings = this.path && existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : [];
  }

  private save(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(`${this.path}.tmp`, JSON.stringify(this.listings, null, 2));
    renameSync(`${this.path}.tmp`, this.path);
  }

  active(now = Date.now()): Listing[] {
    return this.listings.filter((l) => now - Date.parse(l.lastSeenAt) < LISTING_TTL_MS);
  }

  get(instanceId: string): Listing | undefined {
    return this.active().find((l) => l.instanceId === instanceId);
  }

  private async fetchWellKnown(instanceUrl: string): Promise<WellKnown | null> {
    try {
      const res = await this.fetcher(`${instanceUrl}/.well-known/innli.json`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) });
      return res.ok ? ((await res.json()) as WellKnown) : null;
    } catch {
      return null;
    }
  }

  async register(raw: unknown): Promise<{ listed: number; overRoomLimit?: string[] }> {
    const req: RegistrationRequest = registrationSchema.parse(raw);
    const instanceUrl = req.instanceUrl.replace(/\/$/, '');
    if (this.requireHttps && !instanceUrl.startsWith('https://')) throw new GuideError('Installatie moet bereikbaar zijn via https');

    // Judge the licence against the installation's own version, not the guide's: buyers whose
    // update period ended keep their listing as long as they run a version it covered.
    const status = verifyLicense(req.license, { releaseDate: req.releaseDate ?? '0000-00-00' });
    if (status.state === 'invalid' || (this.requireLicense && (status.state === 'none' || status.state === 'updates_expired'))) {
      throw new GuideError(status.state === 'none' ? 'Licentie vereist voor opname in de gids' : `Licentie niet geldig: ${'reason' in status ? status.reason : ''}`, 403);
    }
    const license = status.state === 'licensed' ? status.license : undefined;

    // Proof that whoever registers actually runs this URL.
    const wk = await this.fetchWellKnown(instanceUrl);
    if (!wk || wk.instanceId !== req.instanceId) throw new GuideError('Installatie niet bereikbaar of instanceId komt niet overeen', 422);

    // One installation per licence: a copied key cannot list a second site.
    if (license) {
      const other = this.active().find((l) => l.licenseId === license.id && l.instanceId !== req.instanceId);
      if (other) {
        const otherWk = await this.fetchWellKnown(other.instanceUrl);
        if (otherWk && otherWk.instanceId === other.instanceId && otherWk.licenseId === license.id) {
          throw new GuideError('Deze licentie is al in gebruik door een andere installatie', 409);
        }
        this.listings = this.listings.filter((l) => l !== other);
      }
    }

    // The licence covers a number of accommodations, each up to a number of rooms (hotels need a hotel package).
    const limit = license ? roomLimit(license) : Infinity;
    const overRoomLimit = req.properties.filter((p) => (p.rooms ?? 1) > limit).map((p) => p.name);
    const fitting = req.properties.filter((p) => (p.rooms ?? 1) <= limit);
    const properties = fitting.slice(0, license ? license.maxProperties : OPEN_MAX_PROPERTIES);
    const now = new Date().toISOString();
    const existing = this.listings.find((l) => l.instanceId === req.instanceId);
    const listing: Listing = {
      instanceId: req.instanceId,
      instanceUrl,
      licenseId: license?.id,
      licenseName: license?.name,
      version: req.version,
      properties,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
    };
    this.listings = [...this.listings.filter((l) => l.instanceId !== req.instanceId && Date.now() - Date.parse(l.lastSeenAt) < LISTING_TTL_MS), listing];
    this.save();
    return { listed: properties.length, overRoomLimit: overRoomLimit.length ? overRoomLimit : undefined };
  }

  /** Installations with at least one stay that could match the location filter. */
  candidates(filter: { area?: string; country?: string; near?: { lat: number; lng: number; radiusKm: number } }): Listing[] {
    return this.active().filter((l) =>
      l.properties.some((p) => {
        if (filter.country && norm(filter.country) !== norm(p.country)) return false;
        if (filter.area && !norm([p.city, p.region ?? '', p.name, p.summary].join(' ')).includes(norm(filter.area))) return false;
        if (filter.near && (!p.geo || haversineKm(filter.near, p.geo) > filter.near.radiusKm)) return false;
        return true;
      }),
    );
  }
}
