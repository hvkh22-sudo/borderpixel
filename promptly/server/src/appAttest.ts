/**
 * Apple App Attest server verification (pure; WebCrypto only).
 * Follows Apple's "Validating apps that connect to your server" and the
 * "Attestation Object Validation Guide" (whose published example is used as a
 * test vector in test/appAttest.test.ts).
 */
import { decodeCbor, decodeCborItem, isBytes, isMap, type CborMap } from './cbor';
import { concat, equalBytes, fromBase64, sha256, toBase64, utf8 } from './bytes';
import { children, importEcKey, parseDer, verifyChain, verifyEcdsa } from './x509';

/** Apple App Attestation Root CA (https://www.apple.com/certificateauthority/private/), valid 2020-03-18 → 2045-03-15. */
export const APPLE_APP_ATTEST_ROOT_CA_B64 =
  'MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYwJAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwKQXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNaFw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlvbiBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9ybmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdhNbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9auYen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijVoyFraWVIyd/dganmrduC1bmTBGwD';

const NONCE_EXTENSION_OID = '1.2.840.113635.100.8.2';
const AAGUID_PROD = concat(utf8('appattest'), new Uint8Array(7));
const AAGUID_DEV = utf8('appattestdevelop');

export class AppAttestError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export interface AuthenticatorData {
  rpIdHash: Uint8Array;
  flags: number;
  counter: number;
  aaguid?: Uint8Array;
  credentialId?: Uint8Array;
  extensions?: CborMap;
}

/** WebAuthn authenticator data layout (App Attest uses the same format). */
export function parseAuthenticatorData(data: Uint8Array): AuthenticatorData {
  if (data.length < 37) throw new AppAttestError('auth_data_short');
  const rpIdHash = data.slice(0, 32);
  const flags = data[32]!;
  const counter = new DataView(data.buffer, data.byteOffset + 33, 4).getUint32(0, false);
  const out: AuthenticatorData = { rpIdHash, flags, counter };
  let pos = 37;
  if (flags & 0x40) {
    if (data.length < pos + 18) throw new AppAttestError('auth_data_short');
    out.aaguid = data.slice(pos, pos + 16);
    const idLen = (data[pos + 16]! << 8) | data[pos + 17]!;
    pos += 18;
    if (data.length < pos + idLen) throw new AppAttestError('auth_data_short');
    out.credentialId = data.slice(pos, pos + idLen);
    pos += idLen;
    pos = decodeCborItem(data, pos).end; // COSE credential public key (we trust the certificate's key)
  }
  // App Attest appends the extensions map without always setting the ED flag (observed in
  // Apple's published example: flags 0x40), so parse any remaining bytes as extensions.
  if (flags & 0x80 || pos < data.length) {
    const ext = decodeCborItem(data, pos);
    if (!isMap(ext.value)) throw new AppAttestError('auth_data_extensions');
    out.extensions = ext.value;
    pos = ext.end;
  }
  if (pos !== data.length) throw new AppAttestError('auth_data_trailing');
  return out;
}

/** nonce = SHA256(authData || clientDataHash) — the same formula for attestation and assertion. */
export async function appAttestNonce(authData: Uint8Array, clientDataHash: Uint8Array): Promise<Uint8Array> {
  return sha256(concat(authData, clientDataHash));
}

export interface AttestationInput {
  attestation: Uint8Array;
  /** Base64 key identifier returned by DCAppAttestService.generateKey(). */
  keyId: string;
  /** The exact bytes the app passed as clientDataHash to attestKey. */
  clientDataHash: Uint8Array;
  /** `<TeamID>.<BundleID>` */
  appId: string;
  allowDevelopment: boolean;
  now: number;
  rootCaDer?: Uint8Array;
}

export interface AttestedKey {
  keyId: string;
  /** DER SubjectPublicKeyInfo of the attested P-256 key, base64. */
  publicKeySpki: string;
  environment: 'production' | 'development';
  receipt: Uint8Array;
  bundleVersion?: string;
  validationCategory?: number;
}

function extractNonce(ext: Uint8Array): Uint8Array {
  // SEQUENCE { [1] EXPLICIT OCTET STRING nonce }
  const seq = parseDer(ext).node;
  const tagged = children(seq)[0];
  const octets = tagged && tagged.tag === 0xa1 ? children(tagged)[0] : undefined;
  if (!octets || octets.tag !== 0x04) throw new AppAttestError('nonce_extension_malformed');
  return octets.content;
}

export async function verifyAttestation(input: AttestationInput): Promise<AttestedKey> {
  let obj;
  try {
    obj = decodeCbor(input.attestation);
  } catch {
    throw new AppAttestError('cbor');
  }
  if (!isMap(obj) || obj.get('fmt') !== 'apple-appattest') throw new AppAttestError('format');
  const stmt = obj.get('attStmt');
  const authData = obj.get('authData');
  if (!isMap(stmt) || !isBytes(authData)) throw new AppAttestError('format');
  const x5c = stmt.get('x5c');
  const receipt = stmt.get('receipt');
  if (!Array.isArray(x5c) || x5c.length < 2 || !x5c.every(isBytes) || !isBytes(receipt)) throw new AppAttestError('format');

  // 1. Certificate chain to the pinned Apple App Attestation Root CA.
  let leaf;
  try {
    leaf = await verifyChain(x5c as Uint8Array[], input.rootCaDer ?? fromBase64(APPLE_APP_ATTEST_ROOT_CA_B64), input.now);
  } catch (e) {
    throw new AppAttestError(`chain: ${(e as Error).message}`);
  }
  if (leaf.curve !== 'P-256') throw new AppAttestError('leaf_key_type');

  // 2–4. nonce = SHA256(authData || clientDataHash) must equal the credCert extension.
  const nonce = await appAttestNonce(authData, input.clientDataHash);
  const ext = leaf.extensions.get(NONCE_EXTENSION_OID);
  if (!ext) throw new AppAttestError('nonce_extension_missing');
  if (!equalBytes(extractNonce(ext.value), nonce)) throw new AppAttestError('nonce_mismatch');

  // 5. SHA256(public key, X9.62 uncompressed) == keyId.
  let keyIdBytes: Uint8Array;
  try {
    keyIdBytes = fromBase64(input.keyId);
  } catch {
    throw new AppAttestError('key_id');
  }
  if (!equalBytes(await sha256(leaf.publicKey), keyIdBytes)) throw new AppAttestError('key_id_mismatch');

  const ad = parseAuthenticatorData(authData);
  // 6. RP ID hash.
  if (!equalBytes(ad.rpIdHash, await sha256(input.appId))) throw new AppAttestError('rp_id_mismatch');
  // 7. counter == 0.
  if (ad.counter !== 0) throw new AppAttestError('counter_not_zero');
  // 8. aaguid environment.
  let environment: AttestedKey['environment'];
  if (ad.aaguid && equalBytes(ad.aaguid, AAGUID_PROD)) environment = 'production';
  else if (ad.aaguid && equalBytes(ad.aaguid, AAGUID_DEV)) environment = 'development';
  else throw new AppAttestError('aaguid');
  if (environment === 'development' && !input.allowDevelopment) throw new AppAttestError('development_key_rejected');
  // 9. credentialId == keyId.
  if (!ad.credentialId || !equalBytes(ad.credentialId, keyIdBytes)) throw new AppAttestError('credential_id_mismatch');

  // Extensions (reported, not enforced: Apple does not publish the value table for App Store builds).
  const bundleVersion = ad.extensions?.get('apple_bundle_version_01');
  const category = ad.extensions?.get('apple_validation_category_01');
  return {
    keyId: input.keyId,
    publicKeySpki: toBase64(leaf.spki),
    environment,
    receipt,
    bundleVersion: typeof bundleVersion === 'string' ? bundleVersion : undefined,
    validationCategory:
      isBytes(category) && category.length === 4
        ? new DataView(category.buffer, category.byteOffset, 4).getUint32(0, true)
        : typeof category === 'number'
          ? category
          : undefined,
  };
}

export interface AssertionInput {
  assertion: Uint8Array;
  clientDataHash: Uint8Array;
  publicKeySpki: string;
  appId: string;
  previousCounter: number;
}

/** Returns the new counter; the caller must persist it atomically (counter monotonicity). */
export async function verifyAssertion(input: AssertionInput): Promise<{ counter: number }> {
  let obj;
  try {
    obj = decodeCbor(input.assertion);
  } catch {
    throw new AppAttestError('cbor');
  }
  if (!isMap(obj)) throw new AppAttestError('format');
  const signature = obj.get('signature');
  const authenticatorData = obj.get('authenticatorData');
  if (!isBytes(signature) || !isBytes(authenticatorData)) throw new AppAttestError('format');
  const nonce = await appAttestNonce(authenticatorData, input.clientDataHash);
  const key = await importEcKey(fromBase64(input.publicKeySpki), 'P-256');
  if (!(await verifyEcdsa(key, 'P-256', 'SHA-256', signature, nonce))) throw new AppAttestError('bad_signature');
  const ad = parseAuthenticatorData(authenticatorData);
  if (!equalBytes(ad.rpIdHash, await sha256(input.appId))) throw new AppAttestError('rp_id_mismatch');
  if (ad.counter <= input.previousCounter) throw new AppAttestError('counter_not_increasing');
  return { counter: ad.counter };
}
