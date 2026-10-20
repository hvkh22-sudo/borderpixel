/** Test-only helpers: a tiny CBOR encoder and a fake App Attest key (ES256, generated per test run). */
import { buf, concat, sha256, toBase64, utf8 } from '../src/bytes';

type Enc = number | string | Uint8Array | Enc[] | Map<string | number, Enc>;

function head(major: number, n: number): Uint8Array {
  if (n < 24) return new Uint8Array([(major << 5) | n]);
  if (n < 256) return new Uint8Array([(major << 5) | 24, n]);
  if (n < 65536) return new Uint8Array([(major << 5) | 25, n >> 8, n & 255]);
  return new Uint8Array([(major << 5) | 26, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
}

export function cborEncode(v: Enc): Uint8Array {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') {
    const b = utf8(v);
    return concat(head(3, b.length), b);
  }
  if (v instanceof Uint8Array) return concat(head(2, v.length), v);
  if (Array.isArray(v)) return concat(head(4, v.length), ...v.map(cborEncode));
  const parts: Uint8Array[] = [head(5, v.size)];
  for (const [k, val] of v) parts.push(cborEncode(k), cborEncode(val));
  return concat(...parts);
}

/** IEEE P1363 r||s → DER ECDSA-Sig-Value (App Attest assertions carry DER signatures). */
export function rawToDer(raw: Uint8Array): Uint8Array {
  const half = raw.length / 2;
  const int = (x: Uint8Array) => {
    let i = 0;
    while (i < x.length - 1 && x[i] === 0) i++;
    let v = x.subarray(i);
    if (v[0]! & 0x80) v = concat(new Uint8Array([0]), v);
    return concat(new Uint8Array([0x02, v.length]), v);
  };
  const body = concat(int(raw.subarray(0, half)), int(raw.subarray(half)));
  return concat(new Uint8Array([0x30, body.length]), body);
}

export async function fakeAppAttestKey() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const spki = new Uint8Array((await crypto.subtle.exportKey('spki', pair.publicKey)) as ArrayBuffer);
  const point = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const keyId = toBase64(await sha256(point));
  return {
    keyId,
    publicKeySpki: toBase64(spki),
    /** Builds an assertion exactly like DCAppAttestService.generateAssertion(keyId, clientDataHash). */
    async assert(appId: string, counter: number, clientDataHash: Uint8Array, opts: { corrupt?: boolean } = {}) {
      const ctr = new Uint8Array(4);
      new DataView(ctr.buffer).setUint32(0, counter, false);
      const authenticatorData = concat(await sha256(appId), new Uint8Array([0x00]), ctr);
      const nonce = await sha256(concat(authenticatorData, clientDataHash));
      const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, buf(nonce)));
      if (opts.corrupt) raw[5] = raw[5]! ^ 0xff;
      return cborEncode(new Map<string, Enc>([['signature', rawToDer(raw)], ['authenticatorData', authenticatorData]]));
    },
  };
}
