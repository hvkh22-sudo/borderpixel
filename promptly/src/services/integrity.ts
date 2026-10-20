/**
 * Device integrity for AI requests (server: docs/architecture/ai-proxy.md, "Device integrity").
 * iOS: App Attest — one key per install, attested once, then one assertion per request over
 * (body + server challenge). Android: Play Integrity standard request with
 * requestHash = SHA-256(body + server challenge).
 *
 * Best effort by design: when the native module is missing (Jest, Expo Go, unsupported
 * device) or anything fails, no integrity headers are sent and the server decides
 * (INTEGRITY_MODE report/enforce). Never blocks or throws into the AI flow.
 */
import type { ExpoAppIntegrityModule } from '@expo/app-integrity/build/ExpoAppIntegrity.types';
import { requireOptionalNativeModule } from 'expo';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { config } from './config';

/** Server round-trips, supplied by the AI client (keeps this module free of URLs and user ids). */
export interface IntegrityTransport {
  challenge(): Promise<string | null>;
  attest(keyId: string, attestation: string, challenge: string): Promise<boolean>;
}

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

type Native = Pick<
  ExpoAppIntegrityModule,
  | 'isSupported'
  | 'generateKeyAsync'
  | 'attestKeyAsync'
  | 'generateAssertionAsync'
  | 'prepareIntegrityTokenProviderAsync'
  | 'requestIntegrityCheckAsync'
>;

export interface IntegrityEnv {
  platform: string;
  native: Native | null;
  storage: KeyValueStore;
  sha256Hex(data: string): Promise<string>;
  /** Google Cloud project number linked in Play Console (Android). */
  cloudProjectNumber: string;
  timeoutMs?: number;
}

const KEY_ID = 'promptly.appattest.keyId';
const KEY_REGISTERED = 'promptly.appattest.registered';

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('integrity timeout')), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

export function createIntegrityClient(env: IntegrityEnv) {
  let androidReady: Promise<void> | null = null;
  let iosKey: Promise<string | null> | null = null;

  /** App Attest key for this install, attested with the server once. */
  async function ensureIosKey(native: Native, transport: IntegrityTransport): Promise<string | null> {
    const stored = await env.storage.get(KEY_ID);
    const keyId = stored ?? (await native.generateKeyAsync());
    if (!stored) {
      await env.storage.set(KEY_ID, keyId);
      await env.storage.remove(KEY_REGISTERED);
    }
    if ((await env.storage.get(KEY_REGISTERED)) === keyId) return keyId;
    const challenge = await transport.challenge();
    if (!challenge) return null;
    let attestation: string;
    try {
      attestation = await native.attestKeyAsync(keyId, challenge);
    } catch (e) {
      // Keychain survives reinstall but App Attest keys do not: start over with a new key next time.
      await reset();
      throw e;
    }
    if (!(await transport.attest(keyId, attestation, challenge))) return null;
    await env.storage.set(KEY_REGISTERED, keyId);
    return keyId;
  }

  async function headersUnsafe(body: string, transport: IntegrityTransport): Promise<Record<string, string>> {
    const native = env.native;
    if (!native) return {};
    if (env.platform === 'ios') {
      if (!native.isSupported) return {};
      iosKey ??= ensureIosKey(native, transport).finally(() => {
        iosKey = null;
      });
      const keyId = await iosKey;
      if (!keyId) return {};
      const challenge = await transport.challenge();
      if (!challenge) return {};
      let assertion: string;
      try {
        // The module hashes its challenge argument: clientDataHash = SHA256(body + challenge).
        assertion = await native.generateAssertionAsync(keyId, body + challenge);
      } catch (e) {
        await reset();
        throw e;
      }
      return {
        'x-integrity-platform': 'ios',
        'x-integrity-challenge': challenge,
        'x-integrity-key-id': keyId,
        'x-integrity-assertion': assertion,
      };
    }
    if (env.platform === 'android') {
      if (!/^\d+$/.test(env.cloudProjectNumber)) return {};
      androidReady ??= native.prepareIntegrityTokenProviderAsync(env.cloudProjectNumber).catch((e: unknown) => {
        androidReady = null; // retry preparation on the next request
        throw e;
      });
      await androidReady;
      const challenge = await transport.challenge();
      if (!challenge) return {};
      const token = await native.requestIntegrityCheckAsync(await env.sha256Hex(body + challenge));
      return { 'x-integrity-platform': 'android', 'x-integrity-challenge': challenge, 'x-integrity-token': token };
    }
    return {};
  }

  /** Forget the local App Attest key (server rejected it, or the OS invalidated it). */
  async function reset(): Promise<void> {
    await env.storage.remove(KEY_ID).catch(() => {});
    await env.storage.remove(KEY_REGISTERED).catch(() => {});
  }

  return {
    /** Integrity headers for one request body, or {} when unavailable. Never throws. */
    async headersFor(body: string, transport: IntegrityTransport): Promise<Record<string, string>> {
      try {
        return await withTimeout(headersUnsafe(body, transport), env.timeoutMs ?? 10_000);
      } catch {
        return {};
      }
    },
    reset,
  };
}

const secureStorage: KeyValueStore = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v),
  remove: (k) => SecureStore.deleteItemAsync(k),
};

export const integrity = createIntegrityClient({
  platform: Platform.OS,
  native: requireOptionalNativeModule<ExpoAppIntegrityModule>('ExpoAppIntegrity'),
  storage: secureStorage,
  sha256Hex: (data) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, data),
  cloudProjectNumber: config.playCloudProjectNumber,
});
