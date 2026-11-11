// Web Bot Auth for agent platforms: sign your requests so a stay knows who is calling.
// No dependencies; Node.js 20 or newer. MIT licence: copy it into your agent.
//
// 1. Create a key once and keep the private key secret:
//      node agent-kit/examples/web-bot-auth.mjs new-key
// 2. Serve the printed JWKS at
//      https://<your origin>/.well-known/http-message-signatures-directory
//    with content type application/http-message-signatures-directory+json.
// 3. Sign every request:
//      const signer = createSigner({ origin: 'https://agent.example', privateKeyPem });
//      await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...signer.sign(url) }, body });
//
// The response header x-innli-agent-identity then says: verified; agent="agent.example".
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

/** RFC 7638 thumbprint of an Ed25519 public JWK: the keyid of your signatures. */
export function thumbprint(jwk) {
  return createHash('sha256').update(`{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`).digest('base64url');
}

/** A new Ed25519 key: the private key as PEM, and the JWKS to publish. */
export function newKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  return { privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), jwks: { keys: [{ kty: jwk.kty, crv: jwk.crv, x: jwk.x, kid: thumbprint(jwk), use: 'sig', alg: 'EdDSA' }] } };
}

/**
 * @param {{ origin: string, privateKeyPem: string, validSeconds?: number }} options
 *   origin: where your key directory is served, e.g. https://agent.example
 */
export function createSigner({ origin, privateKeyPem, validSeconds = 60 }) {
  const key = createPrivateKey(privateKeyPem);
  const jwk = createPublicKey(key).export({ format: 'jwk' });
  const keyId = thumbprint(jwk);
  const agent = `"${origin.replace(/\/$/, '')}"`;
  return {
    keyId,
    jwks: { keys: [{ kty: jwk.kty, crv: jwk.crv, x: jwk.x, kid: keyId, use: 'sig', alg: 'EdDSA' }] },
    /** Headers for one request. Sign afresh for every request: the nonce is accepted once. */
    sign(url, method = 'POST') {
      const u = new URL(url);
      const created = Math.floor(Date.now() / 1000);
      const params = `("@method" "@authority" "@path" "signature-agent");created=${created};expires=${created + validSeconds};keyid="${keyId}";alg="ed25519";nonce="${randomBytes(16).toString('base64url')}";tag="web-bot-auth"`;
      const base = [`"@method": ${method.toUpperCase()}`, `"@authority": ${u.host.toLowerCase()}`, `"@path": ${u.pathname || '/'}`, `"signature-agent": ${agent}`, `"@signature-params": ${params}`].join('\n');
      return { 'signature-agent': agent, 'signature-input': `sig1=${params}`, signature: `sig1=:${sign(null, Buffer.from(base), key).toString('base64')}:` };
    },
  };
}

if (process.argv[2] === 'new-key') {
  const { privateKeyPem, jwks } = newKey();
  console.log('Private key (keep secret):\n');
  console.log(privateKeyPem);
  console.log('Publish this at /.well-known/http-message-signatures-directory:\n');
  console.log(JSON.stringify(jwks, null, 2));
}
