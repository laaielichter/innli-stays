import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeLicense, generateVendorKeys, issueLicense, verifyLicense } from '../src/licensing/license.ts';

const keys = generateVendorKeys();
const base = { id: 'lic_test', name: 'B&B Test', maxProperties: 1, updatesUntil: '2027-10-06' };

describe('licences', () => {
  it('accepts a licence signed with the vendor key', () => {
    const status = verifyLicense(issueLicense(keys.privateKeyPem, base), { publicKeyBase64: keys.publicKeyBase64, releaseDate: '2026-10-06' });
    assert.equal(status.state, 'licensed');
    assert.equal(describeLicense(status).canListInGuide, true);
  });

  it('rejects tampered licences and licences from another key', () => {
    const license = issueLicense(keys.privateKeyPem, base);
    const [body, sig] = license.slice(6).split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    payload.maxProperties = 50;
    const forged = `INNLI-${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`;
    assert.equal(verifyLicense(forged, { publicKeyBase64: keys.publicKeyBase64 }).state, 'invalid');
    const other = generateVendorKeys();
    assert.equal(verifyLicense(issueLicense(other.privateKeyPem, base), { publicKeyBase64: keys.publicKeyBase64 }).state, 'invalid');
    assert.equal(verifyLicense('nonsense', { publicKeyBase64: keys.publicKeyBase64 }).state, 'invalid');
  });

  it('covers versions released before the end of the update period only (perpetual fallback)', () => {
    const license = issueLicense(keys.privateKeyPem, base);
    assert.equal(verifyLicense(license, { publicKeyBase64: keys.publicKeyBase64, releaseDate: '2027-10-06' }).state, 'licensed');
    const newer = verifyLicense(license, { publicKeyBase64: keys.publicKeyBase64, releaseDate: '2027-10-07' });
    assert.equal(newer.state, 'updates_expired');
    assert.equal(describeLicense(newer).canListInGuide, false);
  });

  it('distinguishes no licence (trial) from a development build without vendor key', () => {
    assert.equal(verifyLicense(undefined, { publicKeyBase64: keys.publicKeyBase64 }).state, 'none');
    assert.equal(verifyLicense('INNLI-x.y', { publicKeyBase64: '' }).state, 'unconfigured');
  });
});
