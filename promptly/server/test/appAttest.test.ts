import { describe, expect, it } from 'vitest';

import { appAttestNonce, parseAuthenticatorData, verifyAssertion, verifyAttestation } from '../src/appAttest';
import { fromBase64, sha256, toBase64, utf8 } from '../src/bytes';
import { CborError, decodeCbor, decodeCborItem, isMap } from '../src/cbor';
import { decodeOid, ecdsaDerToRaw } from '../src/x509';
import { fakeAppAttestKey } from './fakeDevice';
import apple from './fixtures/app-attest-apple-example.json';

const hex = (s: string) => new Uint8Array(s.match(/../g)!.map((b) => parseInt(b, 16)));

describe('cbor', () => {
  it('decodes the types attestation objects use', () => {
    // {"fmt": "x", 1: -7, "a": [h'0102', true, null]}
    const m = decodeCbor(hex('a3' + '63666d74' + '6178' + '01' + '26' + '6161' + '83' + '420102' + 'f5' + 'f6'));
    expect(isMap(m)).toBe(true);
    const map = m as Map<string | number, unknown>;
    expect(map.get('fmt')).toBe('x');
    expect(map.get(1)).toBe(-7);
    expect(map.get('a')).toEqual([new Uint8Array([1, 2]), true, null]);
  });

  it('decodes multi-byte lengths and reports the end offset', () => {
    const big = new Uint8Array(300).fill(7);
    const enc = new Uint8Array([0x59, 0x01, 0x2c, ...big, 0x00]);
    const { value, end } = decodeCborItem(enc, 0);
    expect((value as Uint8Array).length).toBe(300);
    expect(end).toBe(303);
    expect(decodeCborItem(hex('1a000f4240')).value).toBe(1_000_000);
  });

  it('rejects truncated, trailing, indefinite-length and float input', () => {
    expect(() => decodeCbor(hex('43010203'.slice(0, 6)))).toThrow(CborError);
    expect(() => decodeCbor(hex('0101'))).toThrow('trailing');
    expect(() => decodeCbor(hex('5f'))).toThrow(CborError);
    expect(() => decodeCbor(hex('fb3ff0000000000000'))).toThrow(CborError);
  });
});

describe('x509 helpers', () => {
  it('decodes OIDs and DER ECDSA signatures', () => {
    expect(decodeOid(hex('2a864886f763640802'))).toBe('1.2.840.113635.100.8.2');
    const raw = ecdsaDerToRaw(hex('3008020200ff020201ff'), 32);
    expect(raw.length).toBe(64);
    expect(raw[31]).toBe(0xff);
    expect(raw[62]).toBe(0x01);
  });
});

describe('App Attest attestation (Apple published example)', () => {
  const appId = `${apple.teamId}.${apple.bundleId}`;
  const validAt = Date.parse(apple.validAt);
  // In Apple's example the app passed the raw challenge bytes as clientDataHash.
  const clientDataHash = utf8(apple.challenge);
  const base = { attestation: fromBase64(apple.attestation), keyId: apple.keyId, clientDataHash, appId, allowDevelopment: false, now: validAt };

  it('computes nonce = SHA256(authData || clientDataHash) as Apple documents', async () => {
    const obj = decodeCbor(fromBase64(apple.attestation)) as Map<string, unknown>;
    const authData = obj.get('authData') as Uint8Array;
    expect(toBase64(await appAttestNonce(authData, clientDataHash))).toBe(apple.expectedNonce);
    const ad = parseAuthenticatorData(authData);
    expect(ad.counter).toBe(0);
    expect(toBase64(ad.credentialId!)).toBe(apple.keyId);
  });

  it('verifies the chain to the Apple root, nonce, key id, RP ID, counter and aaguid', async () => {
    const key = await verifyAttestation(base);
    expect(key.environment).toBe('production');
    expect(key.keyId).toBe(apple.keyId);
    expect(key.bundleVersion).toBe('1');
    expect(key.validationCategory).toBe(1);
    expect(fromBase64(key.publicKeySpki).length).toBe(91);
  });

  it('rejects a wrong challenge, app id, key id or an expired leaf', async () => {
    await expect(verifyAttestation({ ...base, clientDataHash: await sha256(apple.challenge) })).rejects.toThrow('nonce_mismatch');
    await expect(verifyAttestation({ ...base, appId: `${apple.teamId}.com.other.app` })).rejects.toThrow('rp_id_mismatch');
    const otherKey = toBase64(await sha256('other'));
    await expect(verifyAttestation({ ...base, keyId: otherKey })).rejects.toThrow('key_id_mismatch');
    await expect(verifyAttestation({ ...base, now: Date.parse('2026-05-01T00:00:00Z') })).rejects.toThrow('not valid at this time');
  });

  it('rejects a chain that does not end at the pinned root', async () => {
    const obj = decodeCbor(fromBase64(apple.attestation)) as Map<string, Map<string, Uint8Array[]>>;
    const intermediate = obj.get('attStmt')!.get('x5c')![1]!;
    // Pin the intermediate as "root": the intermediate's own issuer (Apple root) no longer links.
    await expect(verifyAttestation({ ...base, rootCaDer: intermediate })).rejects.toThrow(/chain/);
  });

  it('rejects malformed input', async () => {
    await expect(verifyAttestation({ ...base, attestation: new Uint8Array([0xa0]) })).rejects.toThrow('format');
    await expect(verifyAttestation({ ...base, attestation: new Uint8Array([0xff]) })).rejects.toThrow('cbor');
  });
});

describe('App Attest assertions (fake ES256 key)', () => {
  const appId = 'TEAMID1234.app.promptly.test';

  it('verifies a signature over SHA256(authenticatorData || clientDataHash)', async () => {
    const dev = await fakeAppAttestKey();
    const cdh = await sha256('{"tool":"improve"}challenge');
    const assertion = await dev.assert(appId, 1, cdh);
    const r = await verifyAssertion({ assertion, clientDataHash: cdh, publicKeySpki: dev.publicKeySpki, appId, previousCounter: 0 });
    expect(r.counter).toBe(1);
  });

  it('enforces counter monotonicity', async () => {
    const dev = await fakeAppAttestKey();
    const cdh = await sha256('body');
    const a5 = await dev.assert(appId, 5, cdh);
    const input = { clientDataHash: cdh, publicKeySpki: dev.publicKeySpki, appId };
    expect((await verifyAssertion({ ...input, assertion: a5, previousCounter: 4 })).counter).toBe(5);
    await expect(verifyAssertion({ ...input, assertion: a5, previousCounter: 5 })).rejects.toThrow('counter_not_increasing');
    await expect(verifyAssertion({ ...input, assertion: await dev.assert(appId, 3, cdh), previousCounter: 5 })).rejects.toThrow(
      'counter_not_increasing',
    );
  });

  it('rejects tampered bodies, foreign keys, corrupted signatures and other apps', async () => {
    const dev = await fakeAppAttestKey();
    const other = await fakeAppAttestKey();
    const cdh = await sha256('body');
    const a = await dev.assert(appId, 1, cdh);
    const input = { assertion: a, clientDataHash: cdh, publicKeySpki: dev.publicKeySpki, appId, previousCounter: 0 };
    await expect(verifyAssertion({ ...input, clientDataHash: await sha256('tampered') })).rejects.toThrow('bad_signature');
    await expect(verifyAssertion({ ...input, publicKeySpki: other.publicKeySpki })).rejects.toThrow('bad_signature');
    await expect(verifyAssertion({ ...input, assertion: await dev.assert(appId, 1, cdh, { corrupt: true }) })).rejects.toThrow(
      'bad_signature',
    );
    await expect(verifyAssertion({ ...input, assertion: await dev.assert('X.other', 1, cdh) })).rejects.toThrow('rp_id_mismatch');
  });
});
