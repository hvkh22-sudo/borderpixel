import { beforeEach, describe, expect, it } from 'vitest';

import { buf, fromBase64, sha256, toBase64, toHex, utf8 } from '../src/bytes';
import { handle, type Deps } from '../src/handler';
import {
  INTEGRITY_DEFAULTS,
  clientData,
  decideIntegrity,
  parseIntegrityMode,
  type IntegrityConfig,
  type IntegrityMode,
} from '../src/integrity';
import {
  decodeIntegrityToken,
  evaluatePlayVerdict,
  resetGoogleTokenCache,
  signServiceAccountJwt,
  type PlayIntegrityPayload,
} from '../src/playIntegrity';
import { MemoryQuotaStore } from '../src/quota';
import type { Entitlement } from '../src/types';
import { fakeAppAttestKey } from './fakeDevice';
import verdictFixture from './fixtures/play-verdict-ok.json';

const NOW = Date.UTC(2026, 9, 20, 12);
const USER = '$RCAnonymousID:abcdef0123456789';
const APP_ID = 'TEAMID1234.app.promptly.test';
const PKG = 'app.promptly.test';
const CERT = '6a6a1474b5cbbb2b1aa57e0bc3';
const FREE: Entitlement = { plan: 'free', creditPacks: 0 };
const PRO: Entitlement = { plan: 'subscription', creditPacks: 0 };

function setup(opts: { mode?: IntegrityMode; ent?: Entitlement; play?: (token: string) => PlayIntegrityPayload } = {}) {
  const logs: Record<string, string | number>[] = [];
  let now = NOW;
  const config: IntegrityConfig = {
    mode: opts.mode ?? 'report',
    appleAppId: APP_ID,
    allowDevelopmentKeys: false,
    androidPackage: PKG,
    androidCertDigests: [CERT],
    ...INTEGRITY_DEFAULTS,
    unverifiedPaidPerDay: 2,
  };
  const store = new MemoryQuotaStore();
  const deps: Deps = {
    store,
    llm: { complete: async () => ({ text: 'ok', inputTokens: 10, outputTokens: 10 }) },
    entitlement: async () => opts.ent ?? FREE,
    now: () => now,
    config: {
      freePerMonth: 100,
      proPerMonth: 100,
      lifetimeGrant: 100,
      creditPackSize: 10,
      ipPerDay: 1000,
      dailyBudgetUsd: 100,
      inputUsdPerMTok: 4,
      outputUsdPerMTok: 20,
    },
    log: (e) => logs.push(e),
    integrity: {
      config,
      decodePlayToken: opts.play ? async (t) => opts.play!(t) : undefined,
    },
  };
  return { deps, logs, store, advance: (ms: number) => (now += ms) };
}

const post = (path: string, body: string, headers: Record<string, string> = {}, user = USER) =>
  new Request(`https://ai.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-app-user-id': user, 'cf-connecting-ip': '1.2.3.4', ...headers },
    body,
  });

const BODY = JSON.stringify({ tool: 'improve', script: 'My script about cats.' });

async function challenge(deps: Deps, user = USER): Promise<string> {
  const r = await handle(post('/v1/integrity/challenge', '', {}, user), deps);
  expect(r.status).toBe(200);
  const b = (await r.json()) as { challenge: string; expiresAt: number };
  expect(b.expiresAt).toBe(deps.now() + INTEGRITY_DEFAULTS.challengeTtlMs);
  return b.challenge;
}

/** Simulates an attested iOS install: registers the fake key the way /v1/integrity/attest stores it. */
async function iosDevice(ctx: ReturnType<typeof setup>) {
  const dev = await fakeAppAttestKey();
  await ctx.store.cachePut(`user:${USER}`, `aakey:${dev.keyId}`, { publicKeySpki: dev.publicKeySpki, environment: 'production' }, NOW + 1e10);
  let counter = 0;
  return {
    dev,
    async headers(body: string, nonce: string, opts: { counter?: number } = {}) {
      counter = opts.counter ?? counter + 1;
      const assertion = await dev.assert(APP_ID, counter, await sha256(clientData(body, nonce)));
      return { 'x-integrity-platform': 'ios', 'x-integrity-challenge': nonce, 'x-integrity-key-id': dev.keyId, 'x-integrity-assertion': toBase64(assertion) };
    },
  };
}

const lastIntegrityLog = (logs: Record<string, string | number>[]) => logs.filter((l) => l.event === 'integrity').at(-1);

describe('integrity mode parsing', () => {
  it('defaults to report', () => {
    expect(parseIntegrityMode(undefined)).toBe('report');
    expect(parseIntegrityMode('bogus')).toBe('report');
    expect(parseIntegrityMode('off')).toBe('off');
    expect(parseIntegrityMode('enforce')).toBe('enforce');
  });
});

describe('challenges', () => {
  it('are single use (replay rejected)', async () => {
    const ctx = setup({ mode: 'enforce' });
    const ios = await iosDevice(ctx);
    const nonce = await challenge(ctx.deps);
    expect((await handle(post('/v1/studio', BODY, await ios.headers(BODY, nonce)), ctx.deps)).status).toBe(200);
    const replay = await handle(post('/v1/studio', BODY, await ios.headers(BODY, nonce)), ctx.deps);
    expect(replay.status).toBe(403);
    expect(lastIntegrityLog(ctx.logs)).toMatchObject({ status: 'failed', reason: 'challenge_invalid' });
  });

  it('expire after the TTL', async () => {
    const ctx = setup({ mode: 'enforce' });
    const ios = await iosDevice(ctx);
    const nonce = await challenge(ctx.deps);
    ctx.advance(INTEGRITY_DEFAULTS.challengeTtlMs + 1);
    expect((await handle(post('/v1/studio', BODY, await ios.headers(BODY, nonce)), ctx.deps)).status).toBe(403);
    expect(lastIntegrityLog(ctx.logs)).toMatchObject({ reason: 'challenge_invalid' });
  });

  it('are bound to the user they were issued to', async () => {
    const ctx = setup({ mode: 'enforce' });
    const ios = await iosDevice(ctx);
    const nonce = await challenge(ctx.deps, '$RCAnonymousID:someoneelse0000');
    expect((await handle(post('/v1/studio', BODY, await ios.headers(BODY, nonce)), ctx.deps)).status).toBe(403);
  });

  it('are rate limited per user per day', async () => {
    const ctx = setup();
    ctx.deps.integrity!.config.challengesPerDay = 2;
    await challenge(ctx.deps);
    await challenge(ctx.deps);
    expect((await handle(post('/v1/integrity/challenge', ''), ctx.deps)).status).toBe(429);
  });

  it('endpoints are disabled in off mode', async () => {
    const ctx = setup({ mode: 'off' });
    expect((await handle(post('/v1/integrity/challenge', ''), ctx.deps)).status).toBe(404);
  });
});

describe('iOS App Attest requests', () => {
  it('verifies an assertion over SHA256(body + challenge) and advances the counter', async () => {
    const ctx = setup({ mode: 'enforce' });
    const ios = await iosDevice(ctx);
    const r = await handle(post('/v1/studio', BODY, await ios.headers(BODY, await challenge(ctx.deps))), ctx.deps);
    expect(r.status).toBe(200);
    expect(lastIntegrityLog(ctx.logs)).toMatchObject({ status: 'verified', platform: 'ios', decision: 'allow' });
    expect(await ctx.store.get(`user:${USER}`, `aactr:${ios.dev.keyId}`)).toBe(1);
  });

  it('rejects a non-increasing counter even with a fresh challenge', async () => {
    const ctx = setup({ mode: 'enforce' });
    const ios = await iosDevice(ctx);
    await handle(post('/v1/studio', BODY, await ios.headers(BODY, await challenge(ctx.deps), { counter: 7 })), ctx.deps);
    const r = await handle(post('/v1/studio', BODY, await ios.headers(BODY, await challenge(ctx.deps), { counter: 7 })), ctx.deps);
    expect(r.status).toBe(403);
    expect(lastIntegrityLog(ctx.logs)).toMatchObject({ reason: 'counter_not_increasing' });
  });

  it('rejects an assertion made for a different body', async () => {
    const ctx = setup({ mode: 'enforce' });
    const ios = await iosDevice(ctx);
    const headers = await ios.headers('{"tool":"generate","topic":"x"}', await challenge(ctx.deps));
    expect((await handle(post('/v1/studio', BODY, headers), ctx.deps)).status).toBe(403);
    expect(lastIntegrityLog(ctx.logs)).toMatchObject({ reason: 'bad_signature' });
  });

  it('rejects keys that were never attested', async () => {
    const ctx = setup({ mode: 'enforce' });
    const stranger = await fakeAppAttestKey();
    const nonce = await challenge(ctx.deps);
    const assertion = await stranger.assert(APP_ID, 1, await sha256(clientData(BODY, nonce)));
    const headers = { 'x-integrity-platform': 'ios', 'x-integrity-challenge': nonce, 'x-integrity-key-id': stranger.keyId, 'x-integrity-assertion': toBase64(assertion) };
    expect((await handle(post('/v1/studio', BODY, headers), ctx.deps)).status).toBe(403);
    expect(lastIntegrityLog(ctx.logs)).toMatchObject({ reason: 'key_not_attested' });
  });

  it('attest endpoint consumes the challenge and rejects invalid attestations', async () => {
    const ctx = setup();
    const dev = await fakeAppAttestKey();
    const nonce = await challenge(ctx.deps);
    const body = JSON.stringify({ keyId: dev.keyId, attestation: toBase64(new Uint8Array([0xa0])), challenge: nonce });
    expect((await handle(post('/v1/integrity/attest', body), ctx.deps)).status).toBe(400);
    expect(ctx.logs.at(-1)).toMatchObject({ event: 'integrity_attest', status: 'failed', reason: 'format' });
    expect((await handle(post('/v1/integrity/attest', body), ctx.deps)).status).toBe(400);
    expect(ctx.logs.at(-1)).toMatchObject({ reason: 'challenge_invalid' });
  });
});

describe('Android Play Integrity requests', () => {
  const verdictFor = (body: string, nonce: string, patch: (p: PlayIntegrityPayload) => void = () => {}) =>
    sha256(clientData(body, nonce)).then((h) => {
      const p = structuredClone(verdictFixture) as PlayIntegrityPayload;
      p.requestDetails!.requestHash = toHex(h);
      patch(p);
      return p;
    });

  async function androidRequest(patch?: (p: PlayIntegrityPayload) => void) {
    let payload: PlayIntegrityPayload | null = null;
    const ctx = setup({ mode: 'enforce', play: () => payload! });
    const nonce = await challenge(ctx.deps);
    payload = await verdictFor(BODY, nonce, patch);
    const headers = { 'x-integrity-platform': 'android', 'x-integrity-challenge': nonce, 'x-integrity-token': 'opaque-token-from-play-0123' };
    const r = await handle(post('/v1/studio', BODY, headers), ctx.deps);
    return { status: r.status, log: lastIntegrityLog(ctx.logs) };
  }

  it('accepts a PLAY_RECOGNIZED app on a device meeting device integrity', async () => {
    expect(await androidRequest()).toMatchObject({ status: 200, log: { status: 'verified', platform: 'android' } });
  });

  it('rejects bad verdicts (enforce, free tier)', async () => {
    expect((await androidRequest((p) => (p.deviceIntegrity = {}))).log).toMatchObject({ reason: 'device_integrity' });
    expect((await androidRequest((p) => (p.appIntegrity!.appRecognitionVerdict = 'UNRECOGNIZED_VERSION'))).log).toMatchObject({
      reason: 'app_unrecognized_version',
    });
    expect((await androidRequest((p) => (p.requestDetails!.requestHash = 'x'))).status).toBe(403);
  });
});

describe('Play verdict evaluation (fixture)', () => {
  const exp = { packageName: PKG, certDigests: [CERT], requestHash: 'REPLACED_IN_TEST', now: NOW, maxAgeMs: 300_000 };
  const v = () => structuredClone(verdictFixture) as PlayIntegrityPayload;

  it('passes the fixture and names each failure', () => {
    expect(evaluatePlayVerdict(v(), exp)).toBeNull();
    const cases: [(p: PlayIntegrityPayload) => void, string][] = [
      [(p) => (p.requestDetails!.requestPackageName = 'evil'), 'request_package_mismatch'],
      [(p) => (p.requestDetails!.timestampMillis = String(NOW - 600_000)), 'stale_token'],
      [(p) => (p.appIntegrity!.appRecognitionVerdict = 'UNEVALUATED'), 'app_unevaluated'],
      [(p) => (p.appIntegrity!.packageName = 'evil'), 'package_mismatch'],
      [(p) => (p.appIntegrity!.certificateSha256Digest = ['other']), 'cert_digest_mismatch'],
      [(p) => (p.deviceIntegrity!.deviceRecognitionVerdict = ['MEETS_BASIC_INTEGRITY']), 'device_integrity'],
      [(p) => delete p.requestDetails, 'request_details_missing'],
    ];
    for (const [patch, reason] of cases) {
      const p = v();
      patch(p);
      expect(evaluatePlayVerdict(p, exp)).toBe(reason);
    }
    expect(evaluatePlayVerdict(v(), { ...exp, certDigests: [] })).toBe('cert_digest_not_configured');
  });
});

describe('enforcement policy', () => {
  it('report mode verifies and logs but never blocks', async () => {
    const ctx = setup({ mode: 'report' });
    expect((await handle(post('/v1/studio', BODY), ctx.deps)).status).toBe(200);
    expect(lastIntegrityLog(ctx.logs)).toMatchObject({ status: 'missing', decision: 'allow' });
    const bad = { 'x-integrity-platform': 'ios', 'x-integrity-challenge': 'nope' };
    expect((await handle(post('/v1/studio', BODY, bad), ctx.deps)).status).toBe(200);
    expect(lastIntegrityLog(ctx.logs)).toMatchObject({ status: 'failed', reason: 'challenge_invalid', decision: 'allow' });
  });

  it('off mode skips verification entirely', async () => {
    const ctx = setup({ mode: 'off' });
    expect((await handle(post('/v1/studio', BODY), ctx.deps)).status).toBe(200);
    expect(lastIntegrityLog(ctx.logs)).toBeUndefined();
  });

  it('enforce blocks unverified free requests before charging quota', async () => {
    const ctx = setup({ mode: 'enforce' });
    const r = await handle(post('/v1/studio', BODY), ctx.deps);
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'integrity_required' });
    expect(await ctx.store.get(`user:${USER}`, 'm:2026-10')).toBe(0);
  });

  it('enforce never hard-blocks paying users: unverified requests are capped per day instead', async () => {
    const ctx = setup({ mode: 'enforce', ent: PRO });
    expect((await handle(post('/v1/studio', BODY), ctx.deps)).status).toBe(200);
    expect((await handle(post('/v1/studio', BODY), ctx.deps)).status).toBe(200);
    expect(lastIntegrityLog(ctx.logs)).toMatchObject({ status: 'missing', decision: 'limit', plan: 'subscription' });
    expect((await handle(post('/v1/studio', BODY), ctx.deps)).status).toBe(429);
    // A verified request from the same paying user is not subject to the cap.
    const ios = await iosDevice(ctx);
    expect((await handle(post('/v1/studio', BODY, await ios.headers(BODY, await challenge(ctx.deps))), ctx.deps)).status).toBe(200);
  });

  it('decision table', () => {
    const failed = { status: 'failed', platform: 'ios', reason: 'x' } as const;
    const ok = { status: 'verified', platform: 'ios' } as const;
    expect(decideIntegrity('report', failed, FREE)).toBe('allow');
    expect(decideIntegrity('enforce', ok, FREE)).toBe('allow');
    expect(decideIntegrity('enforce', failed, FREE)).toBe('block');
    expect(decideIntegrity('enforce', { status: 'missing' }, FREE)).toBe('block');
    expect(decideIntegrity('enforce', failed, PRO)).toBe('limit');
    expect(decideIntegrity('enforce', failed, { plan: 'lifetime', creditPacks: 0 })).toBe('limit');
    expect(decideIntegrity('enforce', failed, { plan: 'free', creditPacks: 1 })).toBe('limit');
  });
});

describe('Google service-account auth (RS256 via WebCrypto)', () => {
  beforeEach(() => resetGoogleTokenCache());

  async function fakeServiceAccount() {
    const pair = (await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const pkcs8 = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
    const pem = `-----BEGIN PRIVATE KEY-----\n${toBase64(pkcs8).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
    return { sa: { client_email: 'svc@proj.iam.gserviceaccount.com', private_key: pem }, publicKey: pair.publicKey };
  }

  it('signs a verifiable JWT with the playintegrity scope', async () => {
    const { sa, publicKey } = await fakeServiceAccount();
    const jwt = await signServiceAccountJwt(sa, 'https://www.googleapis.com/auth/playintegrity', NOW);
    const [h, c, s] = jwt.split('.') as [string, string, string];
    expect(JSON.parse(new TextDecoder().decode(fromBase64(h)))).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(new TextDecoder().decode(fromBase64(c)));
    expect(claims).toMatchObject({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/playintegrity', aud: 'https://oauth2.googleapis.com/token' });
    expect(claims.exp - claims.iat).toBe(3600);
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, buf(fromBase64(s)), buf(utf8(`${h}.${c}`)))).toBe(true);
  });

  it('exchanges the JWT and calls decodeIntegrityToken (token cached)', async () => {
    const { sa } = await fakeServiceAccount();
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('oauth2')) return Response.json({ access_token: 'ya29.test', expires_in: 3600 });
      return Response.json({ tokenPayloadExternal: verdictFixture });
    };
    const p = await decodeIntegrityToken('tok', PKG, sa, NOW, fetcher);
    await decodeIntegrityToken('tok2', PKG, sa, NOW + 1000, fetcher);
    expect(p.appIntegrity?.appRecognitionVerdict).toBe('PLAY_RECOGNIZED');
    expect(calls.map((c) => c.url)).toEqual([
      'https://oauth2.googleapis.com/token',
      `https://playintegrity.googleapis.com/v1/${PKG}:decodeIntegrityToken`,
      `https://playintegrity.googleapis.com/v1/${PKG}:decodeIntegrityToken`,
    ]);
    expect(String(calls[0]!.init.body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
    expect(calls[1]!.init.headers).toMatchObject({ authorization: 'Bearer ya29.test' });
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ integrity_token: 'tok' });
  });
});
