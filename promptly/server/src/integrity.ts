/**
 * Device integrity: binds AI requests to genuine installs (App Attest on iOS,
 * Play Integrity on Android). Runtime-independent and unit-tested; see
 * docs/architecture/ai-proxy.md ("Device integrity") for protocol and policy.
 */
import { AppAttestError, verifyAssertion, verifyAttestation } from './appAttest';
import { fromBase64, sha256, toBase64Url, toHex, utf8 } from './bytes';
import { evaluatePlayVerdict, type PlayIntegrityPayload } from './playIntegrity';
import type { QuotaStore } from './quota';
import type { Entitlement } from './types';

export type IntegrityMode = 'off' | 'report' | 'enforce';

export interface IntegrityConfig {
  mode: IntegrityMode;
  /** `<APPLE_TEAM_ID>.<IOS_BUNDLE_ID>`; null when not configured (iOS checks then fail). */
  appleAppId: string | null;
  /** Accept App Attest keys from the development environment (dev/ad-hoc builds). */
  allowDevelopmentKeys: boolean;
  androidPackage: string | null;
  /** Allowed app signing-cert SHA-256 digests (base64url, as in the Play verdict). */
  androidCertDigests: string[];
  challengeTtlMs: number;
  challengesPerDay: number;
  /** Paying users whose integrity fails under `enforce` are limited to this many requests/day. */
  unverifiedPaidPerDay: number;
}

export interface IntegrityDeps {
  config: IntegrityConfig;
  /** Decrypts a Play Integrity token via Google. Absent → Android checks fail with `not_configured`. */
  decodePlayToken?: (token: string, packageName: string) => Promise<PlayIntegrityPayload>;
  /** Test hook: alternative trust anchor for App Attest. */
  appAttestRootCa?: Uint8Array;
}

export const INTEGRITY_DEFAULTS = {
  challengeTtlMs: 5 * 60 * 1000,
  challengesPerDay: 300,
  unverifiedPaidPerDay: 30,
} as const;

const ATTESTED_KEY_TTL_MS = 400 * 24 * 60 * 60 * 1000;
const NONCE_RE = /^[A-Za-z0-9_-]{43}$/;
const KEY_ID_RE = /^[A-Za-z0-9+/]{43}=$/;

export function parseIntegrityMode(v: string | undefined): IntegrityMode {
  return v === 'off' || v === 'enforce' ? v : 'report';
}

export interface Ctx {
  store: QuotaStore;
  now: () => number;
  integrity: IntegrityDeps;
}

const userScope = (userId: string) => `user:${userId}`;

/** Issues a single-use, short-lived server nonce scoped to the user (stored in the Durable Object). */
export async function issueChallenge(ctx: Ctx, userId: string, day: string): Promise<{ challenge: string; expiresAt: number } | null> {
  const rate = await ctx.store.consume(userScope(userId), `chal_issued:${day}`, ctx.integrity.config.challengesPerDay);
  if (!rate.allowed) return null;
  const challenge = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = ctx.now() + ctx.integrity.config.challengeTtlMs;
  await ctx.store.cachePut(userScope(userId), `chal:${challenge}`, 1, expiresAt);
  return { challenge, expiresAt };
}

/** Atomically consumes a challenge: false if unknown, expired, already used, or issued to another user. */
export async function consumeChallenge(ctx: Ctx, userId: string, challenge: string): Promise<boolean> {
  if (!NONCE_RE.test(challenge)) return false;
  return (await ctx.store.cacheTake(userScope(userId), `chal:${challenge}`, ctx.now())) !== null;
}

interface StoredKey {
  publicKeySpki: string;
  environment: 'production' | 'development';
}

export type AttestResult = { ok: true } | { ok: false; reason: string };

/** One-time iOS key registration. The app calls attestKey(keyId, challenge); clientDataHash = SHA256(challenge). */
export async function registerAppAttestKey(
  ctx: Ctx,
  userId: string,
  input: { keyId: string; attestation: string; challenge: string },
): Promise<AttestResult> {
  const cfg = ctx.integrity.config;
  if (!cfg.appleAppId) return { ok: false, reason: 'not_configured' };
  if (!KEY_ID_RE.test(input.keyId)) return { ok: false, reason: 'key_id' };
  if (!(await consumeChallenge(ctx, userId, input.challenge))) return { ok: false, reason: 'challenge_invalid' };
  let attestation: Uint8Array;
  try {
    attestation = fromBase64(input.attestation);
  } catch {
    return { ok: false, reason: 'attestation_encoding' };
  }
  try {
    const key = await verifyAttestation({
      attestation,
      keyId: input.keyId,
      clientDataHash: await sha256(input.challenge),
      appId: cfg.appleAppId,
      allowDevelopment: cfg.allowDevelopmentKeys,
      now: ctx.now(),
      rootCaDer: ctx.integrity.appAttestRootCa,
    });
    // A key may only ever belong to one app user id (replay of a stolen attestation).
    const owner = await ctx.store.cacheGet<string>('integrity', `aakey_owner:${input.keyId}`, ctx.now());
    if (owner && owner !== userId) return { ok: false, reason: 'key_bound_to_other_user' };
    const expiresAt = ctx.now() + ATTESTED_KEY_TTL_MS;
    await ctx.store.cachePut('integrity', `aakey_owner:${input.keyId}`, userId, expiresAt);
    const stored: StoredKey = { publicKeySpki: key.publicKeySpki, environment: key.environment };
    await ctx.store.cachePut(userScope(userId), `aakey:${input.keyId}`, stored, expiresAt);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof AppAttestError ? e.reason : 'verify_error' };
  }
}

export type IntegrityOutcome =
  | { status: 'verified'; platform: 'ios' | 'android' }
  | { status: 'missing' }
  | { status: 'failed'; platform: 'ios' | 'android' | 'unknown'; reason: string };

/**
 * Client data bound by both platforms: the exact raw request body followed by the
 * challenge. iOS: generateAssertion(keyId, body + challenge) → clientDataHash = SHA256(body + challenge).
 * Android: requestHash = hex(SHA256(body + challenge)).
 */
export const clientData = (rawBody: string, challenge: string) => rawBody + challenge;

export async function verifyRequestIntegrity(ctx: Ctx, userId: string, headers: Headers, rawBody: string): Promise<IntegrityOutcome> {
  const platform = headers.get('x-integrity-platform');
  const challenge = headers.get('x-integrity-challenge') ?? '';
  if (!platform) return { status: 'missing' };
  if (platform !== 'ios' && platform !== 'android') return { status: 'failed', platform: 'unknown', reason: 'platform' };
  const fail = (reason: string): IntegrityOutcome => ({ status: 'failed', platform, reason });
  if (!(await consumeChallenge(ctx, userId, challenge))) return fail('challenge_invalid');
  const cfg = ctx.integrity.config;
  const dataHash = await sha256(utf8(clientData(rawBody, challenge)));

  if (platform === 'ios') {
    if (!cfg.appleAppId) return fail('not_configured');
    const keyId = headers.get('x-integrity-key-id') ?? '';
    const assertion = headers.get('x-integrity-assertion') ?? '';
    if (!KEY_ID_RE.test(keyId)) return fail('key_id');
    const scope = userScope(userId);
    const stored = await ctx.store.cacheGet<StoredKey>(scope, `aakey:${keyId}`, ctx.now());
    if (!stored) return fail('key_not_attested');
    // Keys registered while development keys were allowed stop working once the flag is off.
    if (stored.environment === 'development' && !cfg.allowDevelopmentKeys) return fail('development_key_rejected');
    try {
      const previous = await ctx.store.get(scope, `aactr:${keyId}`);
      const { counter } = await verifyAssertion({
        assertion: fromBase64(assertion),
        clientDataHash: dataHash,
        publicKeySpki: stored.publicKeySpki,
        appId: cfg.appleAppId,
        previousCounter: previous,
      });
      // Atomic compare-and-advance closes the race between two concurrent replays.
      if (!(await ctx.store.advance(scope, `aactr:${keyId}`, counter))) return fail('counter_not_increasing');
      return { status: 'verified', platform };
    } catch (e) {
      return fail(e instanceof AppAttestError ? e.reason : 'assertion_error');
    }
  }

  if (!cfg.androidPackage || !ctx.integrity.decodePlayToken) return fail('not_configured');
  const token = headers.get('x-integrity-token') ?? '';
  if (token.length < 16 || token.length > 8192) return fail('token');
  let payload: PlayIntegrityPayload;
  try {
    payload = await ctx.integrity.decodePlayToken(token, cfg.androidPackage);
  } catch {
    return fail('verifier_unavailable');
  }
  const reason = evaluatePlayVerdict(payload, {
    packageName: cfg.androidPackage,
    certDigests: cfg.androidCertDigests,
    requestHash: toHex(dataHash),
    now: ctx.now(),
    maxAgeMs: cfg.challengeTtlMs,
  });
  return reason ? fail(reason) : { status: 'verified', platform };
}

export const isPaying = (e: Entitlement) => e.plan !== 'free' || e.creditPacks > 0;

export type IntegrityDecision = 'allow' | 'block' | 'limit';

/**
 * Policy. off/report never block. enforce: free tier without a verified install is
 * blocked; paying users are never hard-blocked by integrity (they get a daily cap instead).
 */
export function decideIntegrity(mode: IntegrityMode, outcome: IntegrityOutcome, ent: Entitlement): IntegrityDecision {
  if (mode !== 'enforce' || outcome.status === 'verified') return 'allow';
  return isPaying(ent) ? 'limit' : 'block';
}
