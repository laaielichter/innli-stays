import { t } from '../i18n/index.ts';
import { randomBytes } from 'node:crypto';
import type { Fetcher } from '../connectors/availability.ts';
import { describeLicense, verifyLicense } from '../licensing/license.ts';
import type { Store } from '../store.ts';
import { publicSigningKey } from '../security/signing.ts';
import { RELEASE_DATE, VERSION } from '../version.ts';
import type { RegistrationRequest, WellKnown } from './types.ts';

const REGISTER_EVERY_MS = 12 * 3_600_000;

export function ensureInstanceId(store: Store): string {
  const existing = store.getSettings().instanceId;
  if (existing) return existing;
  const instanceId = `ins_${randomBytes(6).toString('hex')}`;
  store.updateSettings({ instanceId });
  return instanceId;
}

export function wellKnown(store: Store): WellKnown {
  const status = verifyLicense(store.getSettings().license);
  return {
    instanceId: ensureInstanceId(store),
    licenseId: 'license' in status ? status.license.id : undefined,
    version: VERSION,
    signingKey: publicSigningKey(store),
  };
}

export function buildRegistration(store: Store, publicUrl: string): RegistrationRequest {
  return {
    instanceId: ensureInstanceId(store),
    instanceUrl: publicUrl.replace(/\/$/, ''),
    license: store.getSettings().license,
    version: VERSION,
    releaseDate: RELEASE_DATE,
    properties: store
      .listProperties()
      .filter((p) => p.published)
      .map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        city: p.address.city,
        region: p.address.region,
        country: p.address.country,
        geo: p.geo,
        summary: p.description.slice(0, 280),
        rooms: p.units.reduce((n, u) => n + Math.max(1, u.inventory ?? 1), 0),
      })),
  };
}

/**
 * Announces this installation's published stays to the INNLI guide, so agents
 * connected to the guide can find them. Only names, places and a short summary
 * are shared; the guide asks this installation for everything else live.
 */
export async function registerWithGuide(store: Store, guideUrl: string, publicUrl: string, fetcher: Fetcher = fetch): Promise<{ ok: boolean; message: string }> {
  const license = describeLicense(verifyLicense(store.getSettings().license));
  if (!license.canListInGuide) {
    store.updateSettings({ directory: { lastError: license.title.toLowerCase() } });
    return { ok: false, message: license.detail };
  }
  const body = buildRegistration(store, publicUrl);
  try {
    const res = await fetcher(`${guideUrl.replace(/\/$/, '')}/api/gids/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; listed?: number; overRoomLimit?: string[] };
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    store.updateSettings({ directory: { lastRegisteredAt: new Date().toISOString(), listed: data.listed ?? body.properties.length } });
    const over = data.overRoomLimit?.length ? ` ${t('own.guideOverRooms', { names: data.overRoomLimit.join(', ') })}` : '';
    return { ok: true, message: `${t('own.guideListed', { n: data.listed ?? body.properties.length })}${over}` };
  } catch (err) {
    const message = (err as Error).message;
    store.updateSettings({ directory: { ...store.getSettings().directory, lastError: message } });
    return { ok: false, message };
  }
}

export function startGuideRegistration(store: Store, guideUrl: string, publicUrl: string): NodeJS.Timeout {
  const tick = () =>
    registerWithGuide(store, guideUrl, publicUrl).then((r) => {
      console.log(`INNLI-gids: ${r.message}`);
    });
  setTimeout(tick, 5_000).unref();
  const timer = setInterval(tick, REGISTER_EVERY_MS);
  timer.unref();
  return timer;
}
