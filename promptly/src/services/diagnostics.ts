/** Gathers the facts shown on the diagnostics screen and in its copyable report. */
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Platform } from 'react-native';

import type { DiagnosticsData } from '../features/diagnostics/report';
import { config, flags } from './config';
import { audioPlan, deviceFacts, support } from './deviceSupport';
import { diagnosticsLog } from './diagnosticsLog';
import { effectiveFlags, effectiveIosVoiceFollowAudio, useDiagnosticsOverrides } from './diagnosticsOverrides';
import { PromptlyMedia } from './nativeMedia';
import { purchasesAvailable } from './purchases';

const LOCALES_TIMEOUT_MS = 5_000;

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export async function speechLocales(): Promise<{ supported: string[]; installed: string[]; error?: string }> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), LOCALES_TIMEOUT_MS);
    });
    const r = await Promise.race([ExpoSpeechRecognitionModule.getSupportedLocales({}), timeout]);
    return { supported: [...(r.locales ?? [])].sort(), installed: [...(r.installedLocales ?? [])].sort() };
  } catch (e) {
    return { supported: [], installed: [], error: e instanceof Error ? e.message.slice(0, 120) : 'unknown' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function collectDiagnostics(currentSpeechLocale: string): Promise<DiagnosticsData> {
  await diagnosticsLog.load();
  const facts = deviceFacts();
  const overrides = useDiagnosticsOverrides.getState();
  const locales = await speechLocales();
  return {
    generatedAt: Date.now(),
    app: {
      name: Constants.expoConfig?.name ?? 'Promptly',
      version: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '—',
      build: Application.nativeBuildVersion ?? '—',
      runtime: `${Constants.executionEnvironment ?? 'unknown'}, sdk ${Constants.expoConfig?.sdkVersion ?? '—'}, ${__DEV__ ? 'debug' : 'release'}`,
    },
    os: { name: Platform.OS, version: String(Platform.Version) },
    device: {
      ...facts,
      onDeviceRecognition: safe(() => ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(), false),
      remoteKeys: PromptlyMedia.remoteKeysAvailable(),
    },
    support: { voiceFollow: support.voiceFollow(), captions: support.captions(), burnIn: support.burnIn() },
    voiceFollowAudio: {
      strategy: effectiveIosVoiceFollowAudio(overrides),
      source: overrides.iosVoiceFollowAudio ? 'override' : 'build',
      plan: audioPlan(true),
    },
    speechLocales: { current: currentSpeechLocale, ...locales },
    flags: { build: { ...flags }, effective: { ...effectiveFlags(overrides) } },
    overrides: {
      iosVoiceFollowAudio: overrides.iosVoiceFollowAudio ?? 'default',
      burnIn: overrides.burnIn,
      integrityHeaders: overrides.integrityHeaders,
    },
    services: {
      purchasesConfigured: purchasesAvailable(),
      aiBaseUrlSet: config.aiBaseUrl.length > 0,
      playCloudProjectSet: /^\d+$/.test(config.playCloudProjectNumber),
    },
    errors: diagnosticsLog.entries(),
  };
}
