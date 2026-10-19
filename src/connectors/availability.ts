import { t } from '../i18n/index.ts';
import { isLiveConnector, type AvailabilityResult, type ConnectorConfig, type Guests, type NightlyRate, type Property, type Unit } from '../domain/types.ts';
import type { Occupancy } from '../store.ts';
import { isNightBlocked, parseIcs, type BlockedRange } from './ical.ts';

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const ICAL_CACHE_TTL_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 8_000;

interface CacheEntry {
  ranges: BlockedRange[];
  fetchedAt: Date;
}

/** All calendar feeds connected for a unit (Airbnb, Booking.com, Google Calendar…). */
export function feedsFor(connector: ConnectorConfig, unitId: string): string[] {
  if (connector.kind !== 'ical') return [];
  const raw = connector.calendars[unitId];
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean);
}

export type NightState = 'open' | 'closed_by_owner' | 'booked_elsewhere' | 'held' | 'sold_out';

/** Rooms of a unit taken per night (held and sold); `ignore` excludes one request or quote hold. */
/** Rooms held and sold per night; `from`/`to` limit the count to the nights asked about. */
const nextNight = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export type HoldsProvider = (propertyId: string, unitId: string, ignore: { requestId?: string; requestIds?: string[]; quoteId?: string; from?: string; to?: string }) => Map<string, Occupancy>;

export interface CheckOptions {
  /** Do not count this request's own hold. */
  ignoreHoldOf?: string;
  /** Do not count this quote's own short hold. */
  ignoreQuoteHold?: string;
  /** Bypass the calendar cache (used before confirming instantly). */
  fresh?: boolean;
  /** Identical rooms wanted (default 1). */
  rooms?: number;
  /** A booking being changed: its own rooms and closed nights do not count against the new dates. */
  replacing?: { requestId: string; nights: string[] };
}

/** Number of calendar events covering a night (for room types with several rooms in one feed). */
const blockedCount = (ranges: BlockedRange[], night: string) => ranges.filter((r) => night >= r.start && night < r.end).length;

/**
 * Checks availability for a unit against whatever the property has connected.
 *
 * The result always says how certain it is. A synced calendar can be hours old
 * (Airbnb refreshes imported calendars roughly every three hours), so it is
 * reported as `synced` and never used as grounds for a booking confirmation.
 * Nights the owner closed in INNLI are always unavailable, whatever the source.
 */
export class AvailabilityService {
  private icalCache = new Map<string, CacheEntry>();
  private fetcher: Fetcher;
  private now: () => Date;
  private holds?: HoldsProvider;

  constructor(fetcher: Fetcher = fetch, now: () => Date = () => new Date(), holds?: HoldsProvider) {
    this.fetcher = fetcher;
    this.now = now;
    this.holds = holds;
  }

  setHoldsProvider(holds: HoldsProvider): void {
    this.holds = holds;
  }

  async check(property: Property, unit: Unit, nights: string[], guests: Guests, opts: CheckOptions = {}): Promise<AvailabilityResult> {
    const connector = property.booking.connector;
    const checkedAt = this.now().toISOString();
    const certainty = isLiveConnector(connector) ? 'live' : 'synced';
    const rooms = Math.max(1, Math.floor(opts.rooms ?? 1));
    const inventory = Math.max(1, Math.floor(unit.inventory ?? 1));
    if (rooms > inventory) return { unitId: unit.id, status: 'unavailable', certainty, checkedAt, note: t('avail.notEnoughRooms', { n: inventory }) };
    const closed = new Set(unit.closedNights ?? []);
    // A single room's accepted booking closed its nights; when that booking is being changed they are free for the change.
    if (inventory === 1) for (const n of opts.replacing?.nights ?? []) closed.delete(n);
    if (nights.some((n) => closed.has(n))) {
      return { unitId: unit.id, status: 'unavailable', certainty, checkedAt, note: t('avail.closedByOwner') };
    }
    // Rooms taken per night by INNLI itself: holds always, sales only for room types
    // (a single room is closed in the calendar when its booking is accepted).
    const occupancy = this.holds?.(property.id, unit.id, { requestId: opts.ignoreHoldOf, requestIds: opts.replacing ? [opts.replacing.requestId] : undefined, quoteId: opts.ignoreQuoteHold, from: nights[0], to: nights.length ? nextNight(nights[nights.length - 1]) : undefined }) ?? new Map<string, Occupancy>();
    const taken = nights.map((n) => {
      const o = occupancy.get(n);
      return { night: n, rooms: (o?.held ?? 0) + (inventory > 1 ? (o?.sold ?? 0) : 0), holdUntil: o?.holdUntil };
    });
    const tightest = taken.reduce((a, b) => (b.rooms > a.rooms ? b : a), taken[0] ?? { night: '', rooms: 0 });
    if (inventory - tightest.rooms < rooms) {
      const note = inventory === 1 && tightest.holdUntil ? t('avail.held', { until: tightest.holdUntil.slice(0, 16).replace('T', ' ') }) : t('avail.soldOut');
      return { unitId: unit.id, status: 'unavailable', certainty, checkedAt, roomsLeft: inventory > 1 ? Math.max(0, inventory - tightest.rooms) : undefined, note };
    }
    const left = (extra: (night: string) => number = () => 0) => Math.min(...taken.map((x) => inventory - x.rooms - extra(x.night)));
    if (opts.fresh) for (const feed of feedsFor(connector, unit.id)) this.icalCache.delete(feed);
    try {
      switch (connector.kind) {
        case 'none':
          return { unitId: unit.id, status: 'unknown', certainty: 'none', checkedAt, note: t('avail.noCalendar') };
        case 'manual':
          return { unitId: unit.id, status: 'available', certainty: 'synced', checkedAt, roomsLeft: inventory > 1 ? left() : undefined, note: t('avail.manualOpen') };
        case 'ical': {
          const feeds = feedsFor(connector, unit.id);
          if (!feeds.length) return { unitId: unit.id, status: 'unknown', certainty: 'none', checkedAt, note: t('avail.noCalendarUnit') };
          // If any feed cannot be read we cannot claim the room is free.
          const entries = await Promise.all(feeds.map((f) => this.loadIcal(f)));
          const oldest = entries.reduce((a, e) => (e.fetchedAt < a ? e.fetchedAt : a), entries[0].fetchedAt);
          // One room: any event blocks the night. A room type: every overlapping event is one room sold elsewhere.
          const free = inventory === 1 ? (nights.some((n) => entries.some((e) => isNightBlocked(e.ranges, n))) ? 0 : 1) : left((n) => entries.reduce((sum, e) => sum + blockedCount(e.ranges, n), 0));
          const blocked = free < rooms;
          return {
            unitId: unit.id,
            status: blocked ? 'unavailable' : 'available',
            certainty: 'synced',
            checkedAt,
            sourceFetchedAt: oldest.toISOString(),
            roomsLeft: inventory > 1 ? Math.max(0, free) : undefined,
            note: blocked ? t('avail.icalBlocked') : t('avail.icalFree', { n: feeds.length }),
          };
        }
        case 'live_api':
          return await this.checkLive(connector.baseUrl, connector.apiKey, unit, nights, guests, checkedAt, property.currency, rooms);
        case 'beds24':
          return await this.checkBeds24(connector, unit, nights, checkedAt, rooms);
      }
    } catch (err) {
      return { unitId: unit.id, status: 'unknown', certainty: 'none', checkedAt, note: t('avail.fetchFailed', { error: (err as Error).message }) };
    }
  }

  /** Per-night overview for the owner's room calendar (manual closures plus connected feeds; for room types also rooms free). */
  async overview(property: Property, unit: Unit, nights: string[], opts: { fresh?: boolean } = {}): Promise<{ nights: { date: string; state: NightState; free?: number }[]; feedErrors: string[] }> {
    if (opts.fresh) for (const feed of feedsFor(property.booking.connector, unit.id)) this.icalCache.delete(feed);
    const inventory = Math.max(1, Math.floor(unit.inventory ?? 1));
    const closed = new Set(unit.closedNights ?? []);
    const occupancy = this.holds?.(property.id, unit.id, { from: nights[0], to: nights.length ? nextNight(nights[nights.length - 1]) : undefined }) ?? new Map<string, Occupancy>();
    const feedErrors: string[] = [];
    const entries: CacheEntry[] = [];
    for (const feed of feedsFor(property.booking.connector, unit.id)) {
      try {
        entries.push(await this.loadIcal(feed));
      } catch (err) {
        feedErrors.push(`${new URL(feed).host}: ${(err as Error).message}`);
      }
    }
    return {
      nights: nights.map((date) => {
        const o = occupancy.get(date);
        if (inventory > 1) {
          const free = inventory - (o?.held ?? 0) - (o?.sold ?? 0) - entries.reduce((sum, e) => sum + blockedCount(e.ranges, date), 0);
          return { date, state: closed.has(date) ? 'closed_by_owner' : free <= 0 ? 'sold_out' : 'open', free: Math.max(0, free) };
        }
        return { date, state: closed.has(date) ? 'closed_by_owner' : entries.some((e) => isNightBlocked(e.ranges, date)) ? 'booked_elsewhere' : o?.held ? 'held' : 'open' };
      }),
      feedErrors,
    };
  }

  private async loadIcal(url: string): Promise<CacheEntry> {
    const cached = this.icalCache.get(url);
    if (cached && this.now().getTime() - cached.fetchedAt.getTime() < ICAL_CACHE_TTL_MS) return cached;
    const res = await this.fetcher(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`agenda gaf HTTP ${res.status}`);
    const text = await res.text();
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('not a valid iCal calendar');
    const entry = { ranges: parseIcs(text), fetchedAt: this.now() };
    this.icalCache.set(url, entry);
    return entry;
  }

  private beds24Tokens = new Map<string, { token: string; until: number }>();

  /** A short-lived Beds24 access token from the owner's refresh token, cached until shortly before it expires. */
  private async beds24Token(apiUrl: string, refreshToken: string): Promise<string> {
    const cached = this.beds24Tokens.get(refreshToken);
    if (cached && cached.until > this.now().getTime()) return cached.token;
    const res = await this.fetcher(`${apiUrl}/authentication/token`, { headers: { accept: 'application/json', refreshToken }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Beds24 refused the refresh token (HTTP ${res.status})`);
    const body = (await res.json()) as { token?: unknown; expiresIn?: unknown };
    if (typeof body.token !== 'string') throw new Error('invalid token response from Beds24');
    const seconds = typeof body.expiresIn === 'number' ? body.expiresIn : 3600;
    this.beds24Tokens.set(refreshToken, { token: body.token, until: this.now().getTime() + Math.max(60, seconds - 120) * 1000 });
    return body.token;
  }

  /**
   * Beds24 API V2: per-night units available, price and minimum stay from
   * GET /inventory/rooms/calendar. Accepts both the per-day form
   * ({ roomId, date, numAvail, price1 }) and the range form
   * ({ roomId, calendar: [{ from, to, numAvail, price1 }] }).
   */
  private async checkBeds24(connector: { refreshToken: string; apiUrl?: string }, unit: Unit, nights: string[], checkedAt: string, rooms: number): Promise<AvailabilityResult> {
    const roomId = unit.externalRef;
    if (!roomId || !/^\d+$/.test(roomId)) return { unitId: unit.id, status: 'unknown', certainty: 'none', checkedAt, note: t('avail.beds24NoRoom') };
    const apiUrl = (connector.apiUrl ?? BEDS24_API).replace(/\/$/, '');
    const url = new URL(`${apiUrl}/inventory/rooms/calendar`);
    url.searchParams.set('roomId', roomId);
    url.searchParams.set('startDate', nights[0]);
    url.searchParams.set('endDate', nights[nights.length - 1]);
    url.searchParams.set('includeNumAvail', 'true');
    url.searchParams.set('includePrices', 'true');
    url.searchParams.set('includeMinStay', 'true');
    let res = await this.fetcher(url.toString(), { headers: { accept: 'application/json', token: await this.beds24Token(apiUrl, connector.refreshToken) }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (res.status === 401) {
      // The token may have been revoked early: fetch a fresh one once.
      this.beds24Tokens.delete(connector.refreshToken);
      res = await this.fetcher(url.toString(), { headers: { accept: 'application/json', token: await this.beds24Token(apiUrl, connector.refreshToken) }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    }
    if (!res.ok) throw new Error(`Beds24 returned HTTP ${res.status}`);
    const days = beds24Days((await res.json()) as unknown, roomId);
    const missing = nights.filter((n) => !days.has(n));
    if (missing.length) throw new Error(`Beds24 gave no calendar for ${missing[0]}`);
    const per = nights.map((n) => days.get(n)!);
    const free = Math.min(...per.map((d) => d.numAvail ?? 0));
    const minStay = Math.max(0, ...per.slice(0, 1).map((d) => d.minStay ?? 0));
    const prices = per.every((d) => typeof d.price1 === 'number' && d.price1 > 0) ? nights.map((date, i) => ({ date, amount: per[i].price1! })) : undefined;
    if (free < rooms) return { unitId: unit.id, status: 'unavailable', certainty: 'live', checkedAt, roomsLeft: Math.max(0, free), note: t('avail.liveTaken') };
    if (minStay > nights.length) return { unitId: unit.id, status: 'unavailable', certainty: 'live', checkedAt, note: t('avail.minStay', { n: minStay }) };
    return { unitId: unit.id, status: 'available', certainty: 'live', checkedAt, roomsLeft: free, nightlyRates: prices, note: t('avail.liveFree') };
  }

  private async checkLive(baseUrl: string, apiKey: string | undefined, unit: Unit, nights: string[], guests: Guests, checkedAt: string, currency = 'EUR', rooms = 1): Promise<AvailabilityResult> {
    const checkout = new Date(Date.parse(`${nights[nights.length - 1]}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const url = new URL('availability', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    url.searchParams.set('unit', unit.externalRef ?? unit.id);
    url.searchParams.set('checkin', nights[0]);
    url.searchParams.set('checkout', checkout);
    url.searchParams.set('adults', String(guests.adults));
    url.searchParams.set('children', String(guests.children));
    if (rooms > 1) url.searchParams.set('rooms', String(rooms));
    const res = await this.fetcher(url.toString(), {
      headers: { accept: 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`booking system returned HTTP ${res.status}`);
    const body = (await res.json()) as { available?: unknown; nightly?: unknown; currency?: unknown };
    if (typeof body.available !== 'boolean') throw new Error('invalid response from booking system');
    if (body.currency !== undefined && body.currency !== currency) throw new Error(`booking system prices in ${String(body.currency)}, the property in ${currency}`);
    const rates = parseRates(body.nightly, nights);
    return {
      unitId: unit.id,
      status: body.available ? 'available' : 'unavailable',
      certainty: 'live',
      checkedAt,
      nightlyRates: rates ?? undefined,
      note: body.available ? t('avail.liveFree') : t('avail.liveTaken'),
    };
  }
}

const BEDS24_API = 'https://api.beds24.com/v2';
type Beds24Day = { numAvail?: number; price1?: number; minStay?: number };

/** Normalises a Beds24 calendar response to one entry per night. */
export function beds24Days(body: unknown, roomId: string): Map<string, Beds24Day> {
  const out = new Map<string, Beds24Day>();
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) throw new Error('invalid calendar response from Beds24');
  const pick = (x: Record<string, unknown>): Beds24Day => ({
    numAvail: typeof x.numAvail === 'number' ? x.numAvail : undefined,
    price1: typeof x.price1 === 'number' ? x.price1 : undefined,
    minStay: typeof x.minStay === 'number' ? x.minStay : undefined,
  });
  for (const item of data as Record<string, unknown>[]) {
    if (item?.roomId !== undefined && String(item.roomId) !== roomId) continue;
    if (typeof item?.date === 'string') out.set(item.date, pick(item));
    for (const range of Array.isArray(item?.calendar) ? (item.calendar as Record<string, unknown>[]) : []) {
      if (typeof range?.from !== 'string') continue;
      const to = typeof range.to === 'string' ? range.to : range.from;
      for (let d = range.from; d <= to; d = nextNight(d)) out.set(d, pick(range));
    }
  }
  return out;
}

function parseRates(raw: unknown, nights: string[]): NightlyRate[] | null {
  if (!Array.isArray(raw)) return null;
  const rates = raw.filter((r): r is NightlyRate => typeof r?.date === 'string' && typeof r?.amount === 'number' && r.amount >= 0);
  const byDate = new Map(rates.map((r) => [r.date, r.amount]));
  if (!nights.every((n) => byDate.has(n))) return null;
  return nights.map((date) => ({ date, amount: byDate.get(date)! }));
}
