/**
 * Runtime configuration and feature flags. Only public values belong here
 * (EXPO_PUBLIC_* are embedded in the app bundle). Secrets live on the server.
 */
import { Platform } from 'react-native';

import { parseIosVoiceFollowAudio, type IosVoiceFollowAudio } from '../features/platform/audioStrategy';

/**
 * Script text and the purchase ID travel to the AI service: only over HTTPS. A plain-http URL is
 * accepted for a local dev server (localhost / 10.0.2.2 / 127.0.0.1) in development builds only;
 * anything else disables the AI Studio instead of sending text unencrypted.
 */
export function secureAiBaseUrl(raw: string | undefined, dev: boolean): string {
  const url = (raw ?? '').trim().replace(/\/+$/, '');
  if (!url) return '';
  if (/^https:\/\/[^/\s]+/i.test(url)) return url;
  if (dev && /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?(\/|$)/i.test(url)) return url;
  return '';
}

const SITE = process.env.EXPO_PUBLIC_SITE_URL || 'https://hvkh22-sudo.github.io/borderpixel/apps/promptly';

export const config = {
  revenueCatApiKey:
    Platform.select({
      ios: process.env.EXPO_PUBLIC_RC_IOS_KEY,
      android: process.env.EXPO_PUBLIC_RC_ANDROID_KEY,
    }) ?? '',
  aiBaseUrl: secureAiBaseUrl(process.env.EXPO_PUBLIC_AI_BASE_URL, typeof __DEV__ !== 'undefined' && __DEV__),
  /** Google Cloud project number linked to the Play app (Play Integrity). Public, not a secret. */
  playCloudProjectNumber: process.env.EXPO_PUBLIC_PLAY_CLOUD_PROJECT_NUMBER ?? '',
  supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL || 'hvkh22@gmail.com',
  // Hosted from this repository's static site (apps/promptly/*). Override per build if the domain changes.
  privacyUrl: process.env.EXPO_PUBLIC_PRIVACY_URL || `${SITE}/privacy/`,
  termsUrl: process.env.EXPO_PUBLIC_TERMS_URL || `${SITE}/terms/`,
  supportUrl: process.env.EXPO_PUBLIC_SUPPORT_URL || `${SITE}/support/`,
  /**
   * iOS Voice Follow microphone strategy (DECISIONS D4): 'shared' (camera records audio, recognizer
   * shares the session) or 'separate' (camera video-only, recognizer audio muxed after the take).
   * Build default; the diagnostics screen can override it per device.
   */
  iosVoiceFollowAudio: (parseIosVoiceFollowAudio(process.env.EXPO_PUBLIC_IOS_VF_AUDIO) ?? 'shared') as IosVoiceFollowAudio,
};

/**
 * Feature flags isolate capabilities that have not passed their on-device
 * acceptance gate. Flipping a flag must never be needed to record a video.
 */
export const flags = {
  /** Live speech following while recording. Gate: docs/testing/device-matrix.md VF-* rows. */
  voiceFollow: process.env.EXPO_PUBLIC_FLAG_VOICE_FOLLOW !== 'off',
  /** On-device caption transcription. Android requires the promptly-media module (audio extraction). */
  captions: process.env.EXPO_PUBLIC_FLAG_CAPTIONS !== 'off',
  /** Burn captions into exported video via native promptly-media module. */
  burnIn: process.env.EXPO_PUBLIC_FLAG_BURN_IN === 'on',
  /** Cloud AI Script Studio (requires deployed server + founder approval for billable use). */
  aiStudio: process.env.EXPO_PUBLIC_FLAG_AI_STUDIO !== 'off',
};
