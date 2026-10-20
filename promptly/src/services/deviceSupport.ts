/** Collects device facts once and exposes feature support decisions. */
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Platform } from 'react-native';

import { DeviceFacts, Support, burnInSupport, captionsSupport, voiceFollowSupport } from '../features/platform/support';
import { flags } from './config';
import { PromptlyMedia } from './nativeMedia';

let cached: DeviceFacts | null = null;

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function deviceFacts(): DeviceFacts {
  if (cached) return cached;
  cached = {
    os: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'other',
    androidApiLevel: Platform.OS === 'android' ? Number(Platform.Version) : 0,
    recognitionAvailable: safe(() => ExpoSpeechRecognitionModule.isRecognitionAvailable(), false),
    recognizerCanPersistAudio: safe(() => ExpoSpeechRecognitionModule.supportsRecording(), false),
    mediaModuleAvailable: PromptlyMedia.isAvailable(),
  };
  return cached;
}

export const support = {
  voiceFollow: (): Support => voiceFollowSupport(deviceFacts(), flags),
  captions: (): Support => captionsSupport(deviceFacts(), flags),
  burnIn: (): Support => burnInSupport(deviceFacts(), flags),
};
