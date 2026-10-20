/**
 * Google Play Integrity (standard requests), server side.
 * The token is decrypted by Google (`playintegrity.googleapis.com/v1/{package}:decodeIntegrityToken`)
 * using an OAuth access token minted from a service-account JWT signed here with
 * WebCrypto RS256. Verdict evaluation is pure and unit-tested.
 */
import { buf, fromBase64, toBase64Url, utf8 } from './bytes';

export const PLAY_INTEGRITY_SCOPE = 'https://www.googleapis.com/auth/playintegrity';

export interface ServiceAccount {
  client_email: string;
  private_key: string; // PKCS#8 PEM
  token_uri?: string;
}

export function parseServiceAccount(json: string): ServiceAccount | null {
  try {
    const sa = JSON.parse(json) as Partial<ServiceAccount>;
    if (typeof sa.client_email !== 'string' || typeof sa.private_key !== 'string') return null;
    return { client_email: sa.client_email, private_key: sa.private_key, token_uri: sa.token_uri };
  } catch {
    return null;
  }
}

async function importRsaPrivateKey(pem: string): Promise<CryptoKey> {
  const b64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  return crypto.subtle.importKey('pkcs8', buf(fromBase64(b64)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/** Signed JWT assertion for the OAuth 2.0 JWT-bearer grant (RFC 7523). */
export async function signServiceAccountJwt(sa: ServiceAccount, scope: string, nowMs: number): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const header = toBase64Url(utf8(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = toBase64Url(
    utf8(JSON.stringify({ iss: sa.client_email, scope, aud: sa.token_uri ?? 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 })),
  );
  const input = `${header}.${claims}`;
  const key = await importRsaPrivateKey(sa.private_key);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, buf(utf8(input))));
  return `${input}.${toBase64Url(sig)}`;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

let tokenCache: { email: string; token: string; expiresAt: number } | null = null;

export async function googleAccessToken(sa: ServiceAccount, nowMs: number, fetcher: Fetch = fetch): Promise<string> {
  if (tokenCache && tokenCache.email === sa.client_email && tokenCache.expiresAt > nowMs + 60_000) return tokenCache.token;
  const assertion = await signServiceAccountJwt(sa, PLAY_INTEGRITY_SCOPE, nowMs);
  const res = await fetcher(sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion}`,
  });
  if (!res.ok) throw new Error(`google token ${res.status}`);
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('google token missing');
  tokenCache = { email: sa.client_email, token: body.access_token, expiresAt: nowMs + (body.expires_in ?? 3600) * 1000 };
  return body.access_token;
}

export function resetGoogleTokenCache() {
  tokenCache = null;
}

/** Decoded verdict (subset we evaluate). Field names per developer.android.com/google/play/integrity/verdicts. */
export interface PlayIntegrityPayload {
  requestDetails?: { requestPackageName?: string; requestHash?: string; timestampMillis?: string };
  appIntegrity?: { appRecognitionVerdict?: string; packageName?: string; certificateSha256Digest?: string[]; versionCode?: string };
  deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
  accountDetails?: { appLicensingVerdict?: string };
}

export async function decodeIntegrityToken(
  token: string,
  packageName: string,
  sa: ServiceAccount,
  nowMs: number,
  fetcher: Fetch = fetch,
): Promise<PlayIntegrityPayload> {
  const access = await googleAccessToken(sa, nowMs, fetcher);
  const res = await fetcher(`https://playintegrity.googleapis.com/v1/${encodeURIComponent(packageName)}:decodeIntegrityToken`, {
    method: 'POST',
    headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
    body: JSON.stringify({ integrity_token: token }),
  });
  if (!res.ok) throw new Error(`play integrity ${res.status}`);
  const body = (await res.json()) as { tokenPayloadExternal?: PlayIntegrityPayload };
  if (!body.tokenPayloadExternal) throw new Error('play integrity payload missing');
  return body.tokenPayloadExternal;
}

export interface PlayExpectations {
  packageName: string;
  /** Allowed signing-certificate SHA-256 digests (base64url, as Play reports them). */
  certDigests: string[];
  requestHash: string;
  now: number;
  maxAgeMs: number;
}

/** Pure verdict check. Returns null when trustworthy, otherwise a short reason. */
export function evaluatePlayVerdict(p: PlayIntegrityPayload, exp: PlayExpectations): string | null {
  const rd = p.requestDetails;
  if (!rd) return 'request_details_missing';
  if (rd.requestPackageName !== exp.packageName) return 'request_package_mismatch';
  if (rd.requestHash !== exp.requestHash) return 'request_hash_mismatch';
  const ts = Number(rd.timestampMillis);
  if (!Number.isFinite(ts) || ts > exp.now + 60_000 || exp.now - ts > exp.maxAgeMs) return 'stale_token';
  const app = p.appIntegrity;
  if (app?.appRecognitionVerdict !== 'PLAY_RECOGNIZED') return `app_${(app?.appRecognitionVerdict ?? 'missing').toLowerCase()}`;
  if (app.packageName !== exp.packageName) return 'package_mismatch';
  const norm = (d: string) => d.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const allowed = new Set(exp.certDigests.map(norm));
  if (allowed.size === 0) return 'cert_digest_not_configured';
  if (!(app.certificateSha256Digest ?? []).some((d) => allowed.has(norm(d)))) return 'cert_digest_mismatch';
  if (!(p.deviceIntegrity?.deviceRecognitionVerdict ?? []).includes('MEETS_DEVICE_INTEGRITY')) return 'device_integrity';
  return null;
}
