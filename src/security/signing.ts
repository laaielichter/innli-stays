import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import type { Store } from '../store.ts';

/** JSON with sorted keys and without undefined values, so the same record always signs the same. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonical(v))).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

function signingKey(store: Store): { privatePem: string; publicKeyBase64: string } {
  let pem = store.getSettings().signingKey;
  if (!pem) {
    pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    store.updateSettings({ signingKey: pem });
  }
  const publicKeyBase64 = createPublicKey(createPrivateKey(pem)).export({ type: 'spki', format: 'der' }).toString('base64');
  return { privatePem: pem, publicKeyBase64 };
}

export function publicSigningKey(store: Store): string {
  return signingKey(store).publicKeyBase64;
}

/**
 * Signs a booking record with this installation's key, so an agent (or a
 * dispute handler) can prove later exactly what the property confirmed.
 * The public key is published at /.well-known/innli.json.
 */
export function signRecord(store: Store, record: unknown): { alg: 'Ed25519'; keyId: string | undefined; value: string } {
  const { privatePem } = signingKey(store);
  return { alg: 'Ed25519', keyId: store.getSettings().instanceId, value: sign(null, Buffer.from(canonical(record)), createPrivateKey(privatePem)).toString('base64url') };
}

export function verifyRecord(publicKeyBase64: string, record: unknown, signature: string): boolean {
  try {
    return verify(null, Buffer.from(canonical(record)), createPublicKey({ key: Buffer.from(publicKeyBase64, 'base64'), format: 'der', type: 'spki' }), Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}
