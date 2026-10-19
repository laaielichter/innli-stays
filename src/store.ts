import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentClient, AnalyticsEvent, BookingLink, BookingRequest, HostQuestion, Property, Quote, StaffMember, StayWish, WaitlistEntry, WishOffer } from './domain/types.ts';

/** Installation-wide settings for a self-hosted install. */
export interface Settings {
  /** Stable public id of this installation, used by the INNLI guide. */
  instanceId?: string;
  license?: string;
  directory?: { lastRegisteredAt?: string; lastError?: string; listed?: number };
  /** Ed25519 private key (PKCS#8 PEM) this installation signs booking records with. */
  signingKey?: string;
  /** Last month (YYYY-MM) a monthly report was sent, per property. */
  monthlyReports?: Record<string, string>;
  /** Agent platforms registered through OAuth dynamic client registration. */
  oauthClients?: import('./http/oauth.ts').OAuthClient[];
}

/** Small, rarely changing data: rewritten as one snapshot file. */
interface Snapshot {
  settings: Settings;
  properties: Property[];
  agents: AgentClient[];
}

/** Older versions kept everything in the snapshot; these keys are migrated to logs on load. */
interface LegacySnapshot extends Snapshot {
  quotes?: Quote[];
  bookingLinks?: BookingLink[];
  events?: AnalyticsEvent[];
  requests?: BookingRequest[];
  questions?: HostQuestion[];
}

const QUOTE_RETENTION_MS = 7 * 86_400_000;
const DEMAND_RETENTION_DAYS = 400;

/** What agents searched for in a property's area on one day (aggregated). */
export interface DemandDay {
  id: string;
  propertyId: string;
  day: string;
  searches: number;
  outcomes: Record<string, number>;
  asked: Record<string, number>;
  unknown: Record<string, number>;
  failed: Record<string, number>;
}
const FLUSH_DELAY_MS = 50;

/**
 * An append-only JSON-lines log with an in-memory map: every save appends one
 * line (last write wins on load), so writing costs the size of one record
 * instead of the whole data set. Compacted when it grows well beyond its size.
 */
class LogCollection<T> {
  private items = new Map<string, T>();
  /** Latest state per key since the last flush; serialised once at flush time. */
  private pending = new Map<string, T | { __deleted: string }>();
  private lines = 0;
  readonly file?: string;
  private key: (item: T) => string;

  constructor(file: string | undefined, key: (item: T) => string) {
    this.file = file;
    this.key = key;
  }

  load(path: string | undefined): void {
    if (!path || !existsSync(path)) return;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line) continue;
      this.lines++;
      try {
        const item = JSON.parse(line) as T & { __deleted?: string };
        if (item.__deleted) this.items.delete(item.__deleted);
        else this.items.set(this.key(item), item);
      } catch {
        // A torn last line after a crash: skip it.
      }
    }
  }

  get size(): number {
    return this.items.size;
  }
  get(id: string): T | undefined {
    return this.items.get(id);
  }
  values(): IterableIterator<T> {
    return this.items.values();
  }
  upsert(item: T): void {
    const key = this.key(item);
    this.items.set(key, item);
    if (this.file) {
      this.pending.delete(key);
      this.pending.set(key, item);
    }
  }
  remove(id: string): void {
    if (!this.items.delete(id)) return;
    if (this.file) {
      this.pending.delete(id);
      this.pending.set(id, { __deleted: id });
    }
  }
  flush(): void {
    if (!this.file || !this.pending.size) return;
    const out: string[] = [];
    for (const v of this.pending.values()) out.push(JSON.stringify(v));
    appendFileSync(this.file, `${out.join('\n')}\n`);
    this.lines += this.pending.size;
    this.pending.clear();
  }
  needsCompaction(): boolean {
    return this.lines > this.items.size * 2 + 1000;
  }
  compact(): void {
    if (!this.file) return;
    this.pending.clear();
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, [...this.items.values()].map((i) => JSON.stringify(i)).join('\n') + (this.items.size ? '\n' : ''));
    renameSync(tmp, this.file);
    this.lines = this.items.size;
  }
}

/**
 * Persistent store of a self-hosted installation.
 *
 * - Properties, agents and settings: one small JSON snapshot.
 * - Requests, questions, quotes, booking links and events: append-only logs
 *   (`innli.<name>.jsonl`) with indexes in memory, so a write appends one line
 *   and lookups by token, property or unit are direct.
 *
 * The interface is narrow on purpose so it can be swapped for a database later.
 */
/** Rooms taken on one night. */
export interface Occupancy {
  held: number;
  sold: number;
  /** Latest end of a hold on this night. */
  holdUntil?: string;
}

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export class Store {
  private snapshot: Snapshot = { settings: {}, properties: [], agents: [] };
  private snapshotPath?: string;
  private snapshotDirty = false;
  private writeTimer?: NodeJS.Timeout;

  private quotes: LogCollection<Quote>;
  private links: LogCollection<BookingLink>;
  private requests: LogCollection<BookingRequest>;
  private questions: LogCollection<HostQuestion>;
  private events: LogCollection<AnalyticsEvent>;
  private demand: LogCollection<DemandDay>;
  private waitlist: LogCollection<WaitlistEntry>;
  private waitlistByToken = new Map<string, WaitlistEntry>();
  private wishes: LogCollection<StayWish>;
  private wishesByToken = new Map<string, StayWish>();
  private wishOffers: LogCollection<WishOffer>;

  // Indexes
  private propertyIndex = new Map<string, Property>();
  private ownerKeyIndex = new Map<string, Property>();
  private agentKeyIndex = new Map<string, AgentClient>();
  private requestsByToken = new Map<string, BookingRequest>();
  private requestsByProperty = new Map<string, Map<string, BookingRequest>>();
  private questionsByToken = new Map<string, HostQuestion>();
  private questionsByProperty = new Map<string, Map<string, HostQuestion>>();
  private eventsByProperty = new Map<string, AnalyticsEvent[]>();
  /** Requests that occupy rooms (new or accepted), per property and unit. */
  private activeByUnit = new Map<string, Map<string, BookingRequest>>();
  /** Quotes with a short hold on rooms, per property and unit. */
  private quoteHolds = new Map<string, Map<string, Quote>>();

  /** Without a path the store is in-memory only. With readOnly, the files are loaded but never written. */
  constructor(path?: string, opts: { readOnly?: boolean } = {}) {
    const writable = path && !opts.readOnly ? path : undefined;
    const base = path?.replace(/\.json$/, '');
    const logPath = (name: string) => (base ? `${base}.${name}.jsonl` : undefined);
    const logFile = (name: string) => (writable ? logPath(name) : undefined);
    this.snapshotPath = writable;
    this.quotes = new LogCollection(logFile('quotes'), (q) => q.id);
    this.links = new LogCollection(logFile('links'), (l) => l.token);
    this.requests = new LogCollection(logFile('requests'), (r) => r.id);
    this.questions = new LogCollection(logFile('questions'), (q) => q.id);
    this.events = new LogCollection(logFile('events'), (e) => e.id);
    this.demand = new LogCollection(logFile('demand'), (d) => d.id);
    this.waitlist = new LogCollection(logFile('waitlist'), (w) => w.id);
    this.wishes = new LogCollection(logFile('wishes'), (w) => w.id);
    this.wishOffers = new LogCollection(logFile('wish-offers'), (o) => o.id);
    if (!path) return;

    if (writable) mkdirSync(dirname(writable), { recursive: true });
    for (const [c, name] of [[this.quotes, 'quotes'], [this.links, 'links'], [this.requests, 'requests'], [this.questions, 'questions'], [this.events, 'events'], [this.demand, 'demand'], [this.waitlist, 'waitlist'], [this.wishes, 'wishes'], [this.wishOffers, 'wish-offers']] as const) {
      (c as LogCollection<unknown>).load(logPath(name));
    }
    let migrated = false;
    if (existsSync(path)) {
      const legacy = JSON.parse(readFileSync(path, 'utf8')) as LegacySnapshot;
      this.snapshot = { settings: legacy.settings ?? {}, properties: legacy.properties ?? [], agents: legacy.agents ?? [] };
      // Migrate data from older single-file versions into the logs.
      for (const q of legacy.quotes ?? []) this.quotes.upsert(q);
      for (const l of legacy.bookingLinks ?? []) this.links.upsert(l);
      for (const r of legacy.requests ?? []) this.requests.upsert(r);
      for (const q of legacy.questions ?? []) this.questions.upsert(q);
      for (const e of legacy.events ?? []) this.events.upsert(e);
      migrated = [legacy.quotes, legacy.bookingLinks, legacy.requests, legacy.questions, legacy.events].some((a) => a?.length);
    }
    this.reindex();
    if (writable) {
      for (const c of this.collections()) if (c.needsCompaction() || migrated) c.compact();
      if (migrated) {
        this.snapshotDirty = true;
        this.flush();
      }
    }
  }

  private collections(): LogCollection<unknown>[] {
    return [this.quotes, this.links, this.requests, this.questions, this.events, this.demand, this.waitlist, this.wishes, this.wishOffers] as LogCollection<unknown>[];
  }

  private reindex(): void {
    this.reindexProperties();
    for (const a of this.snapshot.agents) this.agentKeyIndex.set(a.keyHash, a);
    for (const r of this.requests.values()) this.indexRequest(r);
    for (const q of this.quotes.values()) if (q.hold) this.indexQuoteHold(q);
    for (const q of this.questions.values()) this.indexQuestion(q);
    for (const e of this.events.values()) this.indexEvent(e);
    for (const w of this.waitlist.values()) this.waitlistByToken.set(w.publicToken, w);
    for (const w of this.wishes.values()) this.wishesByToken.set(w.token, w);
  }

  private reindexProperties(): void {
    this.propertyIndex.clear();
    this.ownerKeyIndex.clear();
    for (const p of this.snapshot.properties) {
      this.propertyIndex.set(p.id, p);
      this.propertyIndex.set(p.slug, p);
      this.ownerKeyIndex.set(p.ownerKeyHash, p);
    }
  }

  private indexRequest(r: BookingRequest): void {
    const key = `${r.propertyId}|${r.unitId}`;
    let active = this.activeByUnit.get(key);
    if (r.status === 'new' || r.status === 'accepted') {
      if (!active) this.activeByUnit.set(key, (active = new Map()));
      active.set(r.id, r);
    } else active?.delete(r.id);
    this.requestsByToken.set(r.publicToken, r);
    let m = this.requestsByProperty.get(r.propertyId);
    if (!m) this.requestsByProperty.set(r.propertyId, (m = new Map()));
    m.set(r.id, r);
  }

  private indexQuestion(q: HostQuestion): void {
    this.questionsByToken.set(q.publicToken, q);
    let m = this.questionsByProperty.get(q.propertyId);
    if (!m) this.questionsByProperty.set(q.propertyId, (m = new Map()));
    m.set(q.id, q);
  }

  private indexEvent(e: AnalyticsEvent): void {
    let list = this.eventsByProperty.get(e.propertyId);
    if (!list) this.eventsByProperty.set(e.propertyId, (list = []));
    list.push(e);
  }

  private persist(): void {
    if (!this.snapshotPath || this.writeTimer) return;
    this.writeTimer = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
    this.writeTimer.unref?.();
  }

  private touchSnapshot(): void {
    this.snapshotDirty = true;
    this.persist();
  }

  /** Writes pending changes now (also called on shutdown). */
  flush(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = undefined;
    if (!this.snapshotPath) return;
    if (this.snapshotDirty) {
      const tmp = `${this.snapshotPath}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.snapshot, null, 2));
      renameSync(tmp, this.snapshotPath);
      this.snapshotDirty = false;
    }
    for (const c of this.collections()) c.flush();
  }

  // Settings
  getSettings(): Settings {
    return this.snapshot.settings;
  }
  updateSettings(patch: Partial<Settings>): Settings {
    this.snapshot.settings = { ...this.snapshot.settings, ...patch };
    this.touchSnapshot();
    return this.snapshot.settings;
  }

  // Properties
  listProperties(): Property[] {
    return this.snapshot.properties;
  }
  getProperty(id: string): Property | undefined {
    return this.propertyIndex.get(id);
  }
  findPropertyByOwnerKeyHash(hash: string): Property | undefined {
    return this.ownerKeyIndex.get(hash);
  }
  /** A staff member's key: the property and who it is. */
  findStaffByKeyHash(hash: string): { property: Property; staff: StaffMember } | undefined {
    for (const property of this.snapshot.properties) {
      const staff = property.staff?.find((m) => m.keyHash === hash);
      if (staff) return { property, staff };
    }
    return undefined;
  }
  saveProperty(property: Property): void {
    property.updatedAt = new Date().toISOString();
    const idx = this.snapshot.properties.findIndex((p) => p.id === property.id);
    if (idx >= 0) this.snapshot.properties[idx] = property;
    else this.snapshot.properties.push(property);
    this.reindexProperties();
    this.touchSnapshot();
  }

  // Agent clients
  listAgents(): AgentClient[] {
    return this.snapshot.agents;
  }
  findAgentByKeyHash(hash: string): AgentClient | undefined {
    return this.agentKeyIndex.get(hash);
  }
  saveAgent(agent: AgentClient): void {
    this.snapshot.agents.push(agent);
    this.agentKeyIndex.set(agent.keyHash, agent);
    this.touchSnapshot();
  }

  // Quotes
  saveQuote(quote: Quote): void {
    this.quotes.upsert(quote);
    this.indexQuoteHold(quote);
    this.persist();
  }

  private indexQuoteHold(q: Quote): void {
    const key = `${q.propertyId}|${q.unitId}`;
    let holds = this.quoteHolds.get(key);
    if (q.hold && q.hold.until > new Date().toISOString()) {
      if (!holds) this.quoteHolds.set(key, (holds = new Map()));
      holds.set(q.id, q);
    } else holds?.delete(q.id);
  }
  getQuote(id: string): Quote | undefined {
    return this.quotes.get(id);
  }

  // Booking links
  saveBookingLink(link: BookingLink): void {
    this.links.upsert(link);
    this.persist();
  }
  getBookingLink(token: string): BookingLink | undefined {
    return this.links.get(token);
  }

  // Booking requests
  saveRequest(request: BookingRequest): void {
    this.requests.upsert(request);
    this.indexRequest(request);
    this.persist();
  }
  getRequest(id: string): BookingRequest | undefined {
    return this.requests.get(id);
  }
  getRequestByToken(token: string): BookingRequest | undefined {
    return this.requestsByToken.get(token);
  }
  findRequestByIdempotencyKey(propertyId: string, agentClient: string, key: string): BookingRequest | undefined {
    for (const r of this.requestsByProperty.get(propertyId)?.values() ?? []) if (r.agentClient === agentClient && r.idempotencyKey === key) return r;
    return undefined;
  }
  /**
   * Rooms of a unit taken per night: held by open requests and by short quote
   * holds, and sold through accepted requests. Uses an index of active
   * requests per unit, so a busy hotel's history does not slow availability.
   */
  occupancy(propertyId: string, unitId: string, ignore: { requestId?: string; requestIds?: string[]; quoteId?: string; from?: string; to?: string } = {}, now = new Date()): Map<string, Occupancy> {
    const out = new Map<string, Occupancy>();
    const iso = now.toISOString();
    const today = iso.slice(0, 10);
    const lo = ignore.from && ignore.from > today ? ignore.from : today;
    const hi = ignore.to;
    const add = (from: string, to: string, rooms: number, kind: 'held' | 'sold', until?: string) => {
      if (to <= lo || (hi && from >= hi)) return;
      const end = hi && hi < to ? hi : to;
      for (let d = from < lo ? lo : from; d < end; d = nextDay(d)) {
        const o = out.get(d) ?? { held: 0, sold: 0 };
        o[kind] += rooms;
        if (until && (!o.holdUntil || until > o.holdUntil)) o.holdUntil = until;
        out.set(d, o);
      }
    };
    const key = `${propertyId}|${unitId}`;
    for (const r of this.activeByUnit.get(key)?.values() ?? []) {
      if (r.id === ignore.requestId || ignore.requestIds?.includes(r.id) || r.checkout <= today) continue;
      if (r.status === 'accepted') add(r.checkin, r.checkout, r.rooms ?? 1, 'sold');
      else if (r.status === 'new' && r.holdUntil && r.holdUntil > iso) add(r.checkin, r.checkout, r.rooms ?? 1, 'held', r.holdUntil);
    }
    const holds = this.quoteHolds.get(key);
    for (const q of holds?.values() ?? []) {
      if (!q.hold || q.hold.until <= iso) {
        holds!.delete(q.id);
        continue;
      }
      if (q.id !== ignore.quoteId) add(q.checkin, q.checkout, q.rooms ?? 1, 'held', q.hold.until);
    }
    return out;
  }

  /** Nights held by open requests for a unit, mapped to when the hold ends. */
  heldNights(propertyId: string, unitId: string, ignoreRequestId?: string, now = new Date()): Map<string, string> {
    const held = new Map<string, string>();
    const iso = now.toISOString();
    for (const r of this.requestsByProperty.get(propertyId)?.values() ?? []) {
      if (r.unitId !== unitId || r.status !== 'new' || r.id === ignoreRequestId) continue;
      if (!r.holdUntil || r.holdUntil <= iso) continue;
      for (let d = r.checkin; d < r.checkout; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) held.set(d, r.holdUntil);
    }
    return held;
  }
  allRequests(): BookingRequest[] {
    return [...this.requests.values()];
  }
  requestsFor(propertyId: string): BookingRequest[] {
    return [...(this.requestsByProperty.get(propertyId)?.values() ?? [])];
  }
  /**
   * Removes guests' personal data from requests whose stay ended more than
   * `days` ago (or that were declined that long ago). Returns how many were anonymised.
   */
  anonymiseRequests(days: number, now = new Date()): number {
    const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
    let count = 0;
    for (const r of this.requests.values()) {
      if (r.anonymisedAt) continue;
      const end = r.status === 'accepted' ? r.checkout : (r.decidedAt ?? r.createdAt).slice(0, 10);
      if (end >= cutoff) continue;
      r.guest = { name: '(verwijderd)', email: '' };
      r.anonymisedAt = now.toISOString();
      this.requests.upsert(r);
      count++;
    }
    for (const q of this.questions.values()) {
      if (q.anonymisedAt || !q.replyEmail) continue;
      if ((q.answeredAt ?? q.createdAt).slice(0, 10) >= cutoff) continue;
      q.replyEmail = undefined;
      q.anonymisedAt = now.toISOString();
      this.questions.upsert(q);
      count++;
    }
    if (count) this.persist();
    return count;
  }

  // Questions to the host
  saveQuestion(question: HostQuestion): void {
    this.questions.upsert(question);
    this.indexQuestion(question);
    this.persist();
  }
  getQuestion(id: string): HostQuestion | undefined {
    return this.questions.get(id);
  }
  getQuestionByToken(token: string): HostQuestion | undefined {
    return this.questionsByToken.get(token);
  }
  questionsFor(propertyId: string): HostQuestion[] {
    return [...(this.questionsByProperty.get(propertyId)?.values() ?? [])];
  }

  /**
   * Housekeeping: drops search-insight events older than `days` and quotes past
   * their retention, then compacts the logs on disk.
   */
  pruneEvents(days: number, now = new Date()): number {
    const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
    let removed = 0;
    for (const [propertyId, list] of this.eventsByProperty) {
      const keep = list.filter((e) => e.type !== 'search_consideration' || e.at >= cutoff);
      for (const e of list) if (e.type === 'search_consideration' && e.at < cutoff) this.events.remove(e.id);
      removed += list.length - keep.length;
      this.eventsByProperty.set(propertyId, keep);
    }
    const demandCutoff = new Date(now.getTime() - DEMAND_RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
    for (const d of [...this.demand.values()]) if (d.day < demandCutoff) this.demand.remove(d.id);
    const quoteCutoff = new Date(now.getTime() - QUOTE_RETENTION_MS).toISOString();
    for (const q of [...this.quotes.values()]) if (q.createdAt < quoteCutoff) this.quotes.remove(q.id);
    if (this.snapshotPath) {
      this.flush();
      for (const c of this.collections()) if (c.needsCompaction()) c.compact();
    }
    return removed;
  }

  // Waitlist
  saveWaitlist(entry: WaitlistEntry): void {
    this.waitlist.upsert(entry);
    this.waitlistByToken.set(entry.publicToken, entry);
    this.persist();
  }
  getWaitlistByToken(token: string): WaitlistEntry | undefined {
    return this.waitlistByToken.get(token);
  }
  activeWaitlist(): WaitlistEntry[] {
    return [...this.waitlist.values()].filter((w) => w.status === 'waiting');
  }
  waitlistFor(propertyId: string): WaitlistEntry[] {
    return [...this.waitlist.values()].filter((w) => w.propertyId === propertyId);
  }

  // Stay wishes and the offers hosts make on them
  saveWish(wish: StayWish): void {
    this.wishes.upsert(wish);
    this.wishesByToken.set(wish.token, wish);
    this.persist();
  }
  getWish(id: string): StayWish | undefined {
    return this.wishes.get(id);
  }
  getWishByToken(token: string): StayWish | undefined {
    return this.wishesByToken.get(token);
  }
  listWishes(): StayWish[] {
    return [...this.wishes.values()];
  }
  saveWishOffer(offer: WishOffer): void {
    this.wishOffers.upsert(offer);
    this.persist();
  }
  getWishOffer(id: string): WishOffer | undefined {
    return this.wishOffers.get(id);
  }
  offersForWish(wishId: string): WishOffer[] {
    return [...this.wishOffers.values()].filter((o) => o.wishId === wishId);
  }
  offersByProperty(propertyId: string): WishOffer[] {
    return [...this.wishOffers.values()].filter((o) => o.propertyId === propertyId);
  }

  // Demand (search insights)
  recordDemand(propertyId: string, c: { requirements: string[]; outcome: string; failed: string[]; unknown: string[] }, now = new Date()): void {
    const day = now.toISOString().slice(0, 10);
    const id = `${propertyId}:${day}`;
    const d = this.demand.get(id) ?? { id, propertyId, day, searches: 0, outcomes: {}, asked: {}, unknown: {}, failed: {} };
    d.searches++;
    d.outcomes[c.outcome] = (d.outcomes[c.outcome] ?? 0) + 1;
    for (const r of c.requirements) d.asked[r] = (d.asked[r] ?? 0) + 1;
    for (const r of c.unknown) d.unknown[r] = (d.unknown[r] ?? 0) + 1;
    for (const r of c.failed) d.failed[r] = (d.failed[r] ?? 0) + 1;
    this.demand.upsert(d);
    this.persist();
  }
  demandFor(propertyId: string, since: Date): DemandDay[] {
    const sinceDay = since.toISOString().slice(0, 10);
    const out: DemandDay[] = [];
    for (let t = Date.parse(`${sinceDay}T00:00:00Z`), end = Date.now(); t <= end; t += 86_400_000) {
      const d = this.demand.get(`${propertyId}:${new Date(t).toISOString().slice(0, 10)}`);
      if (d) out.push(d);
    }
    return out;
  }

  // Events
  addEvent(event: AnalyticsEvent): void {
    this.events.upsert(event);
    this.indexEvent(event);
    this.persist();
  }
  eventsFor(propertyId: string, since: Date): AnalyticsEvent[] {
    const s = since.toISOString();
    return (this.eventsByProperty.get(propertyId) ?? []).filter((e) => e.at >= s);
  }
  hasEvent(propertyId: string, predicate: (e: AnalyticsEvent) => boolean): boolean {
    return (this.eventsByProperty.get(propertyId) ?? []).some(predicate);
  }
}
