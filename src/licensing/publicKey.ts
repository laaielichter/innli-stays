/**
 * Public half of the seller's licence signing key (Ed25519, SPKI DER, base64).
 * Set it once with `npm run licentie -- sleutelpaar`; the private half stays on
 * the seller's computer and is never committed.
 *
 * Empty = development build: licences are not checked.
 */
export const VENDOR_PUBLIC_KEY = '';
