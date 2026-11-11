import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify, type KeyObject } from 'node:crypto';
import type { Fetcher } from '../connectors/availability.ts';
type JsonWebKey = { kty?: string; crv?: string; x?: string };
import { publicSigningKey } from '../security/signing.ts';
import type { Store } from '../store.ts';

/**
 * Know your agent. An accommodation cannot look an agent in the eye, and a
 * user-agent string proves nothing. Web Bot Auth lets an agent platform sign
 * each request (HTTP Message Signatures, RFC 9421) with a key it publishes on
 * its own domain; INNLI checks the signature and then knows, cryptographically,
 * which platform is asking. No account, no shared secret, no intermediary.
 *
 * - The agent sends `Signature-Agent` (where its keys are), `Signature-Input`
 *   and `Signature`, with `tag="web-bot-auth"`.
 * - Keys are a JWKS at `<origin>/.well-known/http-message-signatures-directory`.
 * - `keyid` is the JWK thumbprint (RFC 7638) of the Ed25519 key.
 *
 * A request without a signature is simply anonymous. A request with a broken
 * signature is treated as anonymous too, and told why.
 */

export const DIRECTORY_PATH = '/.well-known/http-message-signatures-directory';
export const DIRECTORY_TYPE = 'application/http-message-signatures-directory+json';
export const BOT_AUTH_TAG = 'web-bot-auth';

const MAX_VALIDITY_SECONDS = 86_400;
const CLOCK_SKEW_SECONDS = 60;

export type BotAuthResult =
  | { status: 'none' }
  | { status: 'verified'; agent: string; origin: string; keyId: string; /** Names of the signed components, lower case. */ covered: string[]; /** Signed with a nonce (single use). */ nonce: boolean; validitySeconds: number }
  | { status: 'invalid'; reason: string };

export interface SignedRequest {
  method: string;
  /** Path and query as received, e.g. /mcp?profile=core */
  path: string;
  scheme: string;
  /** Host names this server answers to (the Host header, the public URL). The signer used one of them. */
  authorities: string[];
  headers: Record<string, string | string[] | undefined>;
  /** The raw request body, when there is one: a signed Content-Digest is compared with it. */
  body?: Buffer;
}

interface Member {
  key: string;
  /** Raw serialised value after `key=`. */
  raw: string;
}

/** Splits a structured-field dictionary into members, respecting quotes, byte sequences and inner lists. */
export function parseDictionary(header: string): Member[] {
  const members: Member[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  const push = (end: number) => {
    const part = header.slice(start, end).trim();
    if (!part) return;
    const eq = part.indexOf('=');
    if (eq <= 0) members.push({ key: part.toLowerCase(), raw: '?1' });
    else members.push({ key: part.slice(0, eq).trim().toLowerCase(), raw: part.slice(eq + 1).trim() });
  };
  for (let i = 0; i < header.length; i++) {
    const c = header[i];
    if (quoted) {
      if (c === '\\') i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  push(header.length);
  return members;
}

const unquote = (s: string) => (s.startsWith('"') && s.endsWith('"') && s.length >= 2 ? s.slice(1, -1).replace(/\\(["\\])/g, '$1') : s);

interface SignatureInput {
  label: string;
  /** Everything after `label=`: the inner list with its parameters, exactly as sent. */
  raw: string;
  /** Component identifiers as serialised in the list, e.g. `"@authority"` or `"signature-agent";key="a"`. */
  components: string[];
  params: Record<string, string>;
}

export function parseSignatureInput(header: string): SignatureInput[] {
  return parseDictionary(header).flatMap(({ key, raw }) => {
    const close = raw.indexOf(')');
    if (!raw.startsWith('(') || close < 0) return [];
    const components = raw.slice(1, close).match(/"[^"]*"(?:;[a-z*][a-z0-9_.*-]*(?:="[^"]*"|=[^\s;]+)?)*/g) ?? [];
    const params: Record<string, string> = {};
    for (const m of raw.slice(close + 1).matchAll(/;\s*([a-z*][a-z0-9_.*-]*)(?:=("(?:[^"\\]|\\.)*"|[^;\s]+))?/g)) params[m[1]] = m[2] === undefined ? '?1' : unquote(m[2]);
    return [{ label: key, raw, components, params }];
  });
}

const headerValue = (headers: SignedRequest['headers'], name: string): string | undefined => {
  const v = headers[name.toLowerCase()];
  if (v === undefined) return undefined;
  return (Array.isArray(v) ? v : [v]).map((x) => x.trim()).join(', ');
};

/** The signature base of RFC 9421 section 2.5, for one candidate authority. */
export function signatureBase(input: SignatureInput, req: SignedRequest, authority: string): string | null {
  const lines: string[] = [];
  for (const component of input.components) {
    const name = component.slice(1, component.indexOf('"', 1)).toLowerCase();
    const keyParam = /;key="([^"]*)"/.exec(component)?.[1];
    let value: string | undefined;
    if (name === '@authority') value = authority.toLowerCase();
    else if (name === '@method') value = req.method.toUpperCase();
    else if (name === '@scheme') value = req.scheme;
    else if (name === '@path') value = req.path.split('?')[0] || '/';
    else if (name === '@query') value = req.path.includes('?') ? `?${req.path.split('?')[1]}` : '?';
    else if (name === '@target-uri') value = `${req.scheme}://${authority.toLowerCase()}${req.path}`;
    else if (name === '@request-target') value = req.path;
    else if (name.startsWith('@')) return null;
    else {
      const header = headerValue(req.headers, name);
      if (header === undefined) return null;
      value = keyParam === undefined ? header : parseDictionary(header).find((m) => m.key === keyParam.toLowerCase())?.raw;
    }
    if (value === undefined) return null;
    lines.push(`${component}: ${value}`);
  }
  lines.push(`"@signature-params": ${input.raw}`);
  return lines.join('\n');
}

/** RFC 7638 thumbprint of an Ed25519 JWK: the `keyid` an agent signs with. */
export function jwkThumbprint(jwk: { kty?: string; crv?: string; x?: string }): string {
  return createHash('sha256').update(`{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`).digest('base64url');
}

/** Where the agent says its keys are: `"https://agent.example"` or, in newer drafts, `label="https://agent.example"`. */
export function signatureAgentOrigin(header: string | undefined, label: string): string | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  const raw = trimmed.startsWith('"') ? trimmed : (parseDictionary(trimmed).find((m) => m.key === label) ?? parseDictionary(trimmed)[0])?.raw;
  if (!raw) return undefined;
  try {
    const url = new URL(unquote(raw.split(';')[0]));
    return url.origin;
  } catch {
    return undefined;
  }
}

interface CachedDirectory {
  keys: Map<string, KeyObject>;
  until: number;
  error?: string;
}

export interface BotAuthOptions {
  /** Accept key directories over plain http (tests, local networks). Production: https only. */
  allowHttp?: boolean;
  now?: () => number;
}

export class BotAuthVerifier {
  private fetcher: Fetcher;
  private allowHttp: boolean;
  private now: () => number;
  private directories = new Map<string, CachedDirectory>();
  private nonces = new Map<string, number>();

  constructor(fetcher: Fetcher, opts: BotAuthOptions = {}) {
    this.fetcher = fetcher;
    this.allowHttp = opts.allowHttp ?? false;
    this.now = opts.now ?? Date.now;
  }

  /** @param opts.mayFetch asked before an unknown key directory is fetched; false = not now (rate limit). */
  async verify(req: SignedRequest, opts: { mayFetch?: () => boolean } = {}): Promise<BotAuthResult> {
    const inputHeader = headerValue(req.headers, 'signature-input');
    const signatureHeader = headerValue(req.headers, 'signature');
    if (!inputHeader || !signatureHeader) return { status: 'none' };
    const inputs = parseSignatureInput(inputHeader);
    const input = inputs.find((i) => i.params.tag === BOT_AUTH_TAG);
    // Signatures for another purpose are not ours to judge.
    if (!input) return { status: 'none' };
    const fail = (reason: string): BotAuthResult => ({ status: 'invalid', reason });

    const { keyid, alg, created, expires, nonce } = input.params;
    if (!keyid) return fail('missing_keyid');
    if (alg && alg.toLowerCase() !== 'ed25519') return fail('unsupported_alg');
    const nowSeconds = Math.floor(this.now() / 1000);
    const createdAt = Number(created);
    const expiresAt = Number(expires);
    if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) return fail('missing_created_or_expires');
    if (createdAt > nowSeconds + CLOCK_SKEW_SECONDS) return fail('created_in_future');
    if (expiresAt < nowSeconds) return fail('expired');
    if (expiresAt - createdAt > MAX_VALIDITY_SECONDS) return fail('validity_too_long');
    const names = input.components.map((c) => c.slice(1, c.indexOf('"', 1)).toLowerCase());
    if (!names.includes('@authority') && !names.includes('@target-uri')) return fail('authority_not_signed');
    const agentHeader = headerValue(req.headers, 'signature-agent');
    if (!agentHeader) return fail('missing_signature_agent');
    if (!names.includes('signature-agent')) return fail('signature_agent_not_signed');
    const origin = signatureAgentOrigin(agentHeader, input.label);
    if (!origin) return fail('bad_signature_agent');
    if (!origin.startsWith('https://') && !this.allowHttp) return fail('signature_agent_not_https');

    const rawSignature = parseDictionary(signatureHeader).find((m) => m.key === input.label)?.raw;
    const signature = rawSignature && /^:[A-Za-z0-9+/=]+:$/.test(rawSignature) ? Buffer.from(rawSignature.slice(1, -1), 'base64') : undefined;
    if (!signature) return fail('missing_signature');

    const directory = await this.directory(origin, opts.mayFetch);
    const key = directory.keys.get(keyid);
    if (!key) return fail(directory.error ?? 'unknown_key');

    const ok = req.authorities.some((authority) => {
      const base = signatureBase(input, req, authority);
      return base !== null && verify(null, Buffer.from(base), key, signature);
    });
    if (!ok) return fail('bad_signature');
    // A signed digest that does not match the body means the body was swapped.
    if (names.includes('content-digest') && req.body !== undefined) {
      const digest = headerValue(req.headers, 'content-digest') ?? '';
      const expected = /sha-256=:([A-Za-z0-9+/=]+):/.exec(digest)?.[1];
      if (!expected || expected !== createHash('sha256').update(req.body).digest('base64')) return fail('content_digest_mismatch');
    }

    // A nonce makes a captured request useless a second time.
    if (nonce) {
      const id = `${keyid}:${nonce}`;
      if ((this.nonces.get(id) ?? 0) >= nowSeconds) return fail('replayed_nonce');
      this.nonces.set(id, expiresAt);
      if (this.nonces.size > 20_000) {
        for (const [k, until] of this.nonces) if (until < nowSeconds) this.nonces.delete(k);
        // Still full: drop the oldest. The map must never grow without bound.
        for (const k of this.nonces.keys()) if (this.nonces.size > 15_000) this.nonces.delete(k);
          else break;
      }
    }
    return { status: 'verified', agent: new URL(origin).host, origin, keyId: keyid, covered: names, nonce: Boolean(nonce), validitySeconds: expiresAt - createdAt };
  }

  private async directory(origin: string, mayFetch?: () => boolean): Promise<CachedDirectory> {
    const cached = this.directories.get(origin);
    if (cached && cached.until > this.now()) return cached;
    if (mayFetch && !mayFetch()) return { keys: new Map(), until: 0, error: 'directory_lookup_rate_limited' };
    const entry: CachedDirectory = { keys: new Map(), until: this.now() + 300_000 };
    try {
      const res = await this.fetcher(`${origin}${DIRECTORY_PATH}`, { headers: { accept: `${DIRECTORY_TYPE}, application/json` }, signal: AbortSignal.timeout(5000) });
      if (!res.ok) entry.error = `directory_http_${res.status}`;
      else {
        const body = JSON.parse((await res.text()).slice(0, 200_000)) as { keys?: JsonWebKey[] };
        for (const jwk of (body.keys ?? []).slice(0, 20)) {
          if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') continue;
          try {
            entry.keys.set(jwkThumbprint(jwk), createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, format: 'jwk' }));
          } catch {
            // skip a malformed key
          }
        }
        if (entry.keys.size) entry.until = this.now() + 3_600_000;
        else entry.error = 'directory_has_no_ed25519_key';
      }
    } catch {
      entry.error = 'directory_unreachable';
    }
    this.directories.set(origin, entry);
    if (this.directories.size > 500) this.directories.delete(this.directories.keys().next().value!);
    return entry;
  }
}

// ---------------------------------------------------------------- Signing (INNLI as the sender)

function installationKey(store: Store): KeyObject {
  // The same key as booking records and passports; publicSigningKey creates it on first use.
  publicSigningKey(store);
  return createPrivateKey(store.getSettings().signingKey!);
}

/** This installation's own key directory: the same Ed25519 key that signs records, as a JWKS. */
export function keyDirectory(store: Store) {
  return jwksOf(installationKey(store));
}

/**
 * Headers that sign an outbound request the standard way (RFC 9421), so the
 * receiver can verify it with any library: who sent it (Signature-Agent), the
 * body through Content-Digest when there is one, and any extra headers named.
 */
export function signRequest(key: KeyObject, agentOrigin: string, target: string, opts: { now?: number; method?: string; body?: string; headers?: Record<string, string> } = {}): Record<string, string> {
  const keyId = jwkThumbprint(createPublicKey(key).export({ format: 'jwk' }));
  const url = new URL(target);
  const created = Math.floor((opts.now ?? Date.now()) / 1000);
  const out: Record<string, string> = { ...opts.headers, 'signature-agent': `"${agentOrigin.replace(/\/$/, '')}"` };
  if (opts.body !== undefined) out['content-digest'] = `sha-256=:${createHash('sha256').update(opts.body).digest('base64')}:`;
  const derived: [string, string][] = [['@method', (opts.method ?? 'POST').toUpperCase()], ['@authority', url.host.toLowerCase()], ['@path', url.pathname || '/']];
  const fields = Object.keys(out).sort().map((name): [string, string] => [name.toLowerCase(), out[name].trim()]);
  const all = [...derived, ...fields];
  const params = `(${all.map(([n]) => `"${n}"`).join(' ')});created=${created};expires=${created + 300};keyid="${keyId}";alg="ed25519";nonce="${randomBytes(12).toString('base64url')}";tag="${BOT_AUTH_TAG}"`;
  const base = [...all.map(([n, v]) => `"${n}": ${v}`), `"@signature-params": ${params}`].join('\n');
  return { ...out, 'signature-input': `sig1=${params}`, signature: `sig1=:${sign(null, Buffer.from(base), key).toString('base64')}:` };
}

/** A JWKS with one Ed25519 public key, as served from the key directory. */
export function jwksOf(key: KeyObject) {
  const jwk = createPublicKey(key).export({ format: 'jwk' });
  return { keys: [{ kty: jwk.kty, crv: jwk.crv, x: jwk.x, kid: jwkThumbprint(jwk), use: 'sig', alg: 'EdDSA' }] };
}

/** Signs a status callback or webhook with this installation's key. */
export function signOutbound(store: Store, publicUrl: string, target: string, body: string, opts: { now?: number; method?: string } = {}): Record<string, string> {
  return signRequest(installationKey(store), publicUrl, target, { ...opts, body });
}
