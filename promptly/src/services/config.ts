/**
 * Runtime configuration and feature flags. Only public values belong here
 * (EXPO_PUBLIC_* are embedded in the app bundle). Secrets live on the server.
 */
import { Platform } from 'react-native';

const SITE = process.env.EXPO_PUBLIC_SITE_URL || 'https://hvkh22-sudo.github.io/borderpixel/apps/promptly';

export const config = {
  revenueCatApiKey:
    Platform.select({
      ios: process.env.EXPO_PUBLIC_RC_IOS_KEY,
      android: process.env.EXPO_PUBLIC_RC_ANDROID_KEY,
    }) ?? '',
  aiBaseUrl: process.env.EXPO_PUBLIC_AI_BASE_URL ?? '',
  supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL || 'hvkh22@gmail.com',
  // Hosted from this repository's static site (apps/promptly/*). Override per build if the domain changes.
  privacyUrl: process.env.EXPO_PUBLIC_PRIVACY_URL || `${SITE}/privacy/`,
  termsUrl: process.env.EXPO_PUBLIC_TERMS_URL || `${SITE}/terms/`,
  supportUrl: process.env.EXPO_PUBLIC_SUPPORT_URL || `${SITE}/support/`,
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
