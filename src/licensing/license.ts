import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { RELEASE_DATE } from '../version.ts';
import { t } from '../i18n/index.ts';
import { VENDOR_PUBLIC_KEY } from './publicKey.ts';

/**
 * Offline licences for the one-time purchase model.
 *
 * A licence is `INNLI-<payload>.<signature>` (both base64url). The seller signs
 * the payload with a private Ed25519 key that never leaves their computer; every
 * installation can check it with the public key, without contacting a server.
 *
 * Perpetual-fallback model: a licence never expires, but only covers versions
 * released on or before `updatesUntil`. Newer versions run as a trial until
 * the buyer renews their update period.
 */

export interface LicensePayload {
  v: 1;
  id: string;
  /** Buyer, usually the accommodation or web builder name. */
  name: string;
  email?: string;
  /** How many accommodations this licence may list in the INNLI guide. */
  maxProperties: number;
  /** Rooms per accommodation (all room types together). Absent: DEFAULT_MAX_ROOMS, enough for any B&B or guesthouse. */
  maxRooms?: number;
  /** Last date of included updates (YYYY-MM-DD). */
  updatesUntil: string;
  issuedAt: string;
}

export type LicenseStatus =
  | { state: 'licensed'; license: LicensePayload }
  | { state: 'updates_expired'; license: LicensePayload; reason: string }
  | { state: 'invalid'; reason: string }
  | { state: 'none' }
  /** No vendor key configured: development build, nothing is enforced. */
  | { state: 'unconfigured' };

const PREFIX = 'INNLI-';

/** Room limit per accommodation for licences without maxRooms (all small-accommodation packages). */
export const DEFAULT_MAX_ROOMS = 20;
/** maxRooms at or above this means: no room limit. */
export const UNLIMITED_ROOMS = 10_000;
export const roomLimit = (license: LicensePayload) => license.maxRooms ?? DEFAULT_MAX_ROOMS;

export function generateVendorKeys(): { privateKeyPem: string; publicKeyBase64: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

export function issueLicense(privateKeyPem: string, payload: Omit<LicensePayload, 'v' | 'issuedAt'> & { issuedAt?: string }): string {
  const full: LicensePayload = { v: 1, issuedAt: new Date().toISOString().slice(0, 10), ...payload };
  const body = Buffer.from(JSON.stringify(full));
  const signature = sign(null, body, createPrivateKey(privateKeyPem));
  return `${PREFIX}${body.toString('base64url')}.${signature.toString('base64url')}`;
}

function publicKey(base64: string): KeyObject {
  return createPublicKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'spki' });
}

export function verifyLicense(license: string | undefined, opts: { publicKeyBase64?: string; releaseDate?: string } = {}): LicenseStatus {
  const keyBase64 = opts.publicKeyBase64 ?? process.env.INNLI_LICENSE_PUBLIC_KEY ?? VENDOR_PUBLIC_KEY;
  if (!keyBase64) return { state: 'unconfigured' };
  if (!license?.trim()) return { state: 'none' };
  const raw = license.trim();
  if (!raw.startsWith(PREFIX)) return { state: 'invalid', reason: 'Geen INNLI-licentiesleutel' };
  const [bodyPart, sigPart] = raw.slice(PREFIX.length).split('.');
  if (!bodyPart || !sigPart) return { state: 'invalid', reason: 'Licentiesleutel is onvolledig' };
  let payload: LicensePayload;
  try {
    const body = Buffer.from(bodyPart, 'base64url');
    if (!verify(null, body, publicKey(keyBase64), Buffer.from(sigPart, 'base64url'))) {
      return { state: 'invalid', reason: 'Handtekening klopt niet' };
    }
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    return { state: 'invalid', reason: 'Licentiesleutel kon niet worden gelezen' };
  }
  if (payload.v !== 1 || typeof payload.updatesUntil !== 'string' || typeof payload.maxProperties !== 'number') {
    return { state: 'invalid', reason: 'Onbekend licentieformaat' };
  }
  const release = opts.releaseDate ?? RELEASE_DATE;
  if (release > payload.updatesUntil) {
    return { state: 'updates_expired', license: payload, reason: `Je updateperiode liep tot ${payload.updatesUntil}; deze versie is van ${release}.` };
  }
  return { state: 'licensed', license: payload };
}

/** Licence-holder facing summary, used by the dashboard and CLI. */
export function describeLicense(status: LicenseStatus): { state: LicenseStatus['state']; title: string; detail: string; canListInGuide: boolean; maxProperties: number | null; maxRooms?: number | null } {
  switch (status.state) {
    case 'licensed':
      return {
        state: status.state,
        title: t('lic.licensed', { name: status.license.name }),
        detail: `${t('lic.licensedDetail', { until: status.license.updatesUntil, n: status.license.maxProperties })} ${roomLimit(status.license) >= UNLIMITED_ROOMS ? t('lic.roomsUnlimited') : t('lic.roomsMax', { n: roomLimit(status.license) })}`,
        canListInGuide: true,
        maxProperties: status.license.maxProperties,
        maxRooms: roomLimit(status.license) >= UNLIMITED_ROOMS ? null : roomLimit(status.license),
      };
    case 'updates_expired':
      return { state: status.state, title: t('lic.expired'), detail: t('lic.expiredDetail', { reason: status.reason }), canListInGuide: false, maxProperties: status.license.maxProperties };
    case 'invalid':
      return { state: status.state, title: t('lic.invalid'), detail: status.reason, canListInGuide: false, maxProperties: null };
    case 'none':
      return { state: status.state, title: t('lic.trial'), detail: t('lic.trialDetail'), canListInGuide: false, maxProperties: null };
    case 'unconfigured':
      return { state: status.state, title: t('lic.dev'), detail: t('lic.devDetail'), canListInGuide: true, maxProperties: null };
  }
}
