import { AvailabilityService } from './connectors/availability.ts';
import { Catalog } from './catalog.ts';
import { safeFetcher } from './http/safeFetch.ts';
import { Store } from './store.ts';

export interface Config {
  port: number;
  host: string;
  dataFile: string;
  publicUrl: string;
  adminKey?: string;
  demo: boolean;
  requireAgentKey: boolean;
  /** Allow owner-supplied URLs on the local network, e.g. a booking system on the B&B's own network. */
  allowPrivateFetch: boolean;
  /** INNLI guide to announce published stays to; empty = not listed. */
  guideUrl?: string;
  /** Where users find the source of the version that runs here (AGPL-3.0, section 13). */
  sourceUrl?: string;
  /** SMTP URL for request e-mails, e.g. smtps://user:pass@mail.example.nl:465 */
  smtpUrl?: string;
  mailFrom?: string;
  /** Days after a stay (or decision) before guests' personal data is removed. */
  retentionDays: number;
  /** Second place for daily backups (USB disk, NAS, synced folder); empty = off. */
  backupDir?: string;
  /** Days of backups to keep. */
  backupKeep: number;
}

export function loadConfig(env = process.env): Config {
  const port = Number(env.PORT ?? 3000);
  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    dataFile: env.INNLI_DATA ?? 'data/innli.json',
    publicUrl: env.INNLI_PUBLIC_URL ?? `http://localhost:${port}`,
    adminKey: env.INNLI_ADMIN_KEY,
    demo: env.INNLI_DEMO === '1' || env.INNLI_DEMO === 'intl',
    requireAgentKey: env.INNLI_REQUIRE_AGENT_KEY === '1',
    allowPrivateFetch: env.INNLI_ALLOW_PRIVATE_FETCH === '1' || env.INNLI_DEMO === '1' || env.INNLI_DEMO === 'intl',
    guideUrl: env.INNLI_GIDS_URL || undefined,
    sourceUrl: env.INNLI_SOURCE_URL || undefined,
    smtpUrl: env.INNLI_SMTP_URL || undefined,
    mailFrom: env.INNLI_MAIL_FROM || undefined,
    retentionDays: Math.max(30, Number(env.INNLI_BEWAARTERMIJN_DAGEN ?? 180) || 180),
    backupDir: env.INNLI_BACKUP_DIR || undefined,
    backupKeep: Math.max(1, Number(env.INNLI_BACKUP_KEEP ?? 14) || 14),
  };
}

export function buildServices(config: Config, opts: { readOnly?: boolean } = {}) {
  const store = new Store(config.dataFile, opts);
  // Private network targets are refused unless explicitly allowed (demo mode, or a local install
  // whose booking system runs on the same network).
  const fetcher = safeFetcher(config.allowPrivateFetch);
  const availability = new AvailabilityService(fetcher, () => new Date(), (propertyId, unitId, ignore) => store.occupancy(propertyId, unitId, ignore));
  const catalog = new Catalog(store, availability, config.publicUrl);
  return { store, fetcher, catalog };
}
