/**
 * Minimal DER / X.509 parsing and ECDSA chain validation on WebCrypto.
 * Scope: exactly what App Attest needs — EC (P-256/P-384) keys, ecdsa-with-SHA256/384
 * signatures, validity periods, issuer/subject linkage, basicConstraints, and
 * reading an extension by OID. Not a general-purpose PKIX validator (no
 * revocation, name constraints or policy processing): trust is anchored on a
 * single pinned root, so the chain is short and fixed (root → CA 1 → leaf).
 */
import { buf, equalBytes } from './bytes';

export class X509Error extends Error {}

export interface Der {
  tag: number; // first identifier byte
  tagNumber: number;
  constructed: boolean;
  /** Full encoding (header + content). */
  raw: Uint8Array;
  content: Uint8Array;
}

export function parseDer(data: Uint8Array, offset = 0): { node: Der; end: number } {
  let pos = offset;
  const need = (n: number) => {
    if (pos + n > data.length) throw new X509Error('der truncated');
  };
  need(2);
  const tag = data[pos++]!;
  let tagNumber = tag & 0x1f;
  if (tagNumber === 0x1f) {
    tagNumber = 0;
    let b: number;
    do {
      need(1);
      b = data[pos++]!;
      tagNumber = tagNumber * 128 + (b & 0x7f);
    } while (b & 0x80);
  }
  need(1);
  let len = data[pos++]!;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new X509Error('der length');
    need(n);
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + data[pos++]!;
  }
  need(len);
  const end = pos + len;
  return {
    node: { tag, tagNumber, constructed: (tag & 0x20) !== 0, raw: data.subarray(offset, end), content: data.subarray(pos, end) },
    end,
  };
}

export function children(node: Der): Der[] {
  const out: Der[] = [];
  let pos = 0;
  while (pos < node.content.length) {
    const { node: child, end } = parseDer(node.content, pos);
    out.push(child);
    pos = end;
  }
  return out;
}

export function decodeOid(content: Uint8Array): string {
  if (content.length === 0) throw new X509Error('empty oid');
  const first = content[0]!;
  const parts = [Math.min(2, Math.floor(first / 40)), first - Math.min(2, Math.floor(first / 40)) * 40];
  let v = 0;
  for (let i = 1; i < content.length; i++) {
    v = v * 128 + (content[i]! & 0x7f);
    if (!(content[i]! & 0x80)) {
      parts.push(v);
      v = 0;
    }
  }
  return parts.join('.');
}

function decodeTime(node: Der): number {
  const s = new TextDecoder().decode(node.content);
  const m =
    node.tag === 0x17
      ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s)
      : node.tag === 0x18
        ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s)
        : null;
  if (!m) throw new X509Error('bad time');
  let year = Number(m[1]);
  if (node.tag === 0x17) year += year < 50 ? 2000 : 1900;
  return Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

const OID = {
  ecPublicKey: '1.2.840.10045.2.1',
  p256: '1.2.840.10045.3.1.7',
  p384: '1.3.132.0.34',
  ecdsaSha256: '1.2.840.10045.4.3.2',
  ecdsaSha384: '1.2.840.10045.4.3.3',
  basicConstraints: '2.5.29.19',
  keyUsage: '2.5.29.15',
  extKeyUsage: '2.5.29.37',
} as const;

const KNOWN_CRITICAL = new Set<string>([OID.basicConstraints, OID.keyUsage, OID.extKeyUsage]);

export interface Certificate {
  raw: Uint8Array;
  tbs: Uint8Array;
  sigAlg: string;
  signature: Uint8Array;
  issuer: Uint8Array;
  subject: Uint8Array;
  notBefore: number;
  notAfter: number;
  /** DER SubjectPublicKeyInfo (importable with WebCrypto 'spki'). */
  spki: Uint8Array;
  curve: 'P-256' | 'P-384';
  /** Uncompressed EC point (0x04 || X || Y). */
  publicKey: Uint8Array;
  isCa: boolean;
  extensions: Map<string, { critical: boolean; value: Uint8Array }>;
}

export function parseCertificate(der: Uint8Array): Certificate {
  const { node: cert, end } = parseDer(der);
  if (end !== der.length || cert.tag !== 0x30) throw new X509Error('not a certificate');
  const [tbsNode, sigAlgNode, sigNode] = children(cert);
  if (!tbsNode || !sigAlgNode || !sigNode || sigNode.tag !== 0x03) throw new X509Error('certificate structure');
  const tbs = children(tbsNode);
  let i = 0;
  if (tbs[0]?.tag === 0xa0) i++; // explicit version
  const [, , issuer, validity, subject, spki] = tbs.slice(i);
  if (!issuer || !validity || !subject || !spki) throw new X509Error('tbs structure');
  const [nb, na] = children(validity);
  if (!nb || !na) throw new X509Error('validity');

  const [algId, keyBits] = children(spki);
  if (!algId || !keyBits || keyBits.tag !== 0x03) throw new X509Error('spki');
  const [keyOid, curveOid] = children(algId);
  if (!keyOid || decodeOid(keyOid.content) !== OID.ecPublicKey || !curveOid) throw new X509Error('not an EC key');
  const curveName = decodeOid(curveOid.content);
  const curve = curveName === OID.p256 ? 'P-256' : curveName === OID.p384 ? 'P-384' : null;
  if (!curve) throw new X509Error(`unsupported curve ${curveName}`);

  const extensions = new Map<string, { critical: boolean; value: Uint8Array }>();
  const extWrapper = tbs.find((n) => n.tag === 0xa3);
  if (extWrapper) {
    const [seq] = children(extWrapper);
    for (const ext of seq ? children(seq) : []) {
      const parts = children(ext);
      const oid = parts[0];
      const critical = parts.length === 3 && parts[1]!.tag === 0x01 && parts[1]!.content[0] !== 0;
      const value = parts[parts.length - 1];
      if (!oid || !value || value.tag !== 0x04) throw new X509Error('extension');
      extensions.set(decodeOid(oid.content), { critical, value: value.content });
    }
  }
  for (const [oid, e] of extensions) {
    if (e.critical && !KNOWN_CRITICAL.has(oid)) throw new X509Error(`unknown critical extension ${oid}`);
  }
  let isCa = false;
  const bc = extensions.get(OID.basicConstraints);
  if (bc) {
    const fields = children(parseDer(bc.value).node);
    isCa = fields[0]?.tag === 0x01 && fields[0].content[0] !== 0;
  }
  const [sigOid] = children(sigAlgNode);
  if (!sigOid) throw new X509Error('signature algorithm');
  return {
    raw: der,
    tbs: tbsNode.raw,
    sigAlg: decodeOid(sigOid.content),
    signature: sigNode.content.subarray(1), // drop unused-bits byte
    issuer: issuer.raw,
    subject: subject.raw,
    notBefore: decodeTime(nb),
    notAfter: decodeTime(na),
    spki: spki.raw,
    curve,
    publicKey: keyBits.content.subarray(1),
    isCa,
    extensions,
  };
}

/** DER ECDSA-Sig-Value → IEEE P1363 r||s (what WebCrypto expects). */
export function ecdsaDerToRaw(sig: Uint8Array, size: number): Uint8Array {
  const { node, end } = parseDer(sig);
  if (end !== sig.length || node.tag !== 0x30) throw new X509Error('ecdsa signature');
  const ints = children(node);
  if (ints.length !== 2 || ints.some((n) => n.tag !== 0x02)) throw new X509Error('ecdsa signature');
  const out = new Uint8Array(size * 2);
  ints.forEach((n, idx) => {
    let v = n.content;
    while (v.length > 1 && v[0] === 0) v = v.subarray(1);
    if (v.length > size) throw new X509Error('ecdsa integer too long');
    out.set(v, idx * size + (size - v.length));
  });
  return out;
}

export const curveSize = (curve: 'P-256' | 'P-384') => (curve === 'P-256' ? 32 : 48);

export async function importEcKey(spki: Uint8Array, curve: 'P-256' | 'P-384'): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', buf(spki), { name: 'ECDSA', namedCurve: curve }, false, ['verify']);
}

/** Verifies a DER-encoded ECDSA signature over `message` (hash applied by WebCrypto). */
export async function verifyEcdsa(
  key: CryptoKey,
  curve: 'P-256' | 'P-384',
  hash: 'SHA-256' | 'SHA-384',
  derSig: Uint8Array,
  message: Uint8Array,
): Promise<boolean> {
  let raw: Uint8Array;
  try {
    raw = ecdsaDerToRaw(derSig, curveSize(curve));
  } catch {
    return false;
  }
  return crypto.subtle.verify({ name: 'ECDSA', hash }, key, buf(raw), buf(message));
}

async function verifySignedBy(cert: Certificate, issuer: Certificate): Promise<boolean> {
  const hash = cert.sigAlg === OID.ecdsaSha256 ? 'SHA-256' : cert.sigAlg === OID.ecdsaSha384 ? 'SHA-384' : null;
  if (!hash) return false;
  const key = await importEcKey(issuer.spki, issuer.curve);
  return verifyEcdsa(key, issuer.curve, hash, cert.signature, cert.tbs);
}

/**
 * Validates leaf ← intermediates ← pinned root at time `now`. Certificates in
 * `chainDer` equal to the root are ignored (the root is never trusted from the wire).
 * Returns the parsed leaf.
 */
export async function verifyChain(chainDer: Uint8Array[], rootDer: Uint8Array, now: number): Promise<Certificate> {
  const root = parseCertificate(rootDer);
  const certs = chainDer.filter((c) => !equalBytes(c, rootDer)).map(parseCertificate);
  if (certs.length === 0) throw new X509Error('empty chain');
  const path = [...certs, root];
  for (let i = 0; i < path.length; i++) {
    const c = path[i]!;
    if (now < c.notBefore || now > c.notAfter) throw new X509Error(`certificate ${i} not valid at this time`);
    if (i > 0 && !c.isCa) throw new X509Error(`certificate ${i} is not a CA`);
    const issuer = path[i + 1] ?? root; // root is self-signed
    if (!equalBytes(c.issuer, issuer.subject)) throw new X509Error(`certificate ${i} issuer mismatch`);
    if (!(await verifySignedBy(c, issuer))) throw new X509Error(`certificate ${i} bad signature`);
  }
  return certs[0]!;
}
