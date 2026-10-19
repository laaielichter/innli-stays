import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AvailabilityService } from '../src/connectors/availability.ts';
import { Catalog } from '../src/catalog.ts';
import { addDays } from '../src/domain/dates.ts';
import { isBooked } from '../src/demo/engine.ts';
import { seedDemo, type DemoCredentials } from '../src/demo/seed.ts';
import { createApp } from '../src/http/app.ts';
import { MemoryMailer } from '../src/requests/mailer.ts';
import type { RequestService } from '../src/requests/service.ts';
import { Store } from '../src/store.ts';

export interface TestServer {
  url: string;
  store: Store;
  creds: DemoCredentials;
  mailer: MemoryMailer;
  requests: RequestService;
  close: () => Promise<void>;
}

const locals = new WeakMap<TestServer, Record<string, unknown>>();

/** Services living on the app (waitlist, reviews…), for driving maintenance in tests. */
export function appLocals(server: TestServer): Record<string, unknown> {
  return locals.get(server)!;
}

/** Full app with demo data and the demo booking engine, on an ephemeral port. */
export async function startTestServer(opts: { requireAgentKey?: boolean; empty?: boolean; setupCode?: string; international?: boolean; hotel?: boolean; mediaDir?: string; backups?: { dir: string; run: () => { folder: string; files: number; removed: number } } } = {}): Promise<TestServer> {
  const server: Server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const store = new Store();
  const catalog = new Catalog(store, new AvailabilityService(fetch, () => new Date(), (p, u, ignore) => store.occupancy(p, u, ignore)), url);
  const creds = opts.empty ? { owners: [], agentKey: '' } : seedDemo(store, url, { international: opts.international, hotel: opts.hotel });
  const mailer = new MemoryMailer();
  const app = createApp({ store, catalog, fetcher: fetch, adminKey: 'admin-test-key', demo: true, requireAgentKey: opts.requireAgentKey, publicUrl: url, mailer, setupCode: opts.setupCode, mediaDir: opts.mediaDir, backups: opts.backups });
  server.on('request', app);
  const result: TestServer = { url, store, creds, mailer, requests: app.locals.requests as RequestService, close: () => new Promise((resolve) => server.close(() => resolve())) };
  locals.set(result, app.locals);
  return result;
}

/** First check-in date (from ~3 weeks out) where all given demo units are free for `nights` nights. */
export function freeWindow(units: string[], nights: number, startOffsetDays = 21): { checkin: string; checkout: string } {
  let checkin = addDays(new Date().toISOString().slice(0, 10), startOffsetDays);
  for (let i = 0; i < 365; i++) {
    const all = Array.from({ length: nights }, (_, n) => addDays(checkin, n));
    if (units.every((u) => all.every((night) => !isBooked(u, night)))) return { checkin, checkout: addDays(checkin, nights) };
    checkin = addDays(checkin, 1);
  }
  throw new Error('no free window');
}

export function ownerKey(server: TestServer, propertyId: string): string {
  return server.creds.owners.find((o) => o.id === propertyId)!.ownerKey;
}
