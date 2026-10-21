/** Collects device facts once and exposes feature support decisions. */
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Platform } from 'react-native';

import { voiceFollowAudioPlan, type AudioPlan } from '../features/platform/audioStrategy';
import { DeviceFacts, Support, burnInSupport, captionsSupport, voiceFollowSupport } from '../features/platform/support';
import { effectiveFlags, effectiveIosVoiceFollowAudio } from './diagnosticsOverrides';
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
  voiceFollow: (): Support => voiceFollowSupport(deviceFacts(), effectiveFlags()),
  captions: (): Support => captionsSupport(deviceFacts(), effectiveFlags()),
  burnIn: (): Support => burnInSupport(deviceFacts(), effectiveFlags()),
};

/** Microphone ownership for a take (DECISIONS D4), with the device override applied. */
export function audioPlan(voiceFollow: boolean): AudioPlan {
  const d = deviceFacts();
  return voiceFollowAudioPlan({
    voiceFollow,
    os: d.os,
    iosStrategy: effectiveIosVoiceFollowAudio(),
    mediaModuleAvailable: d.mediaModuleAvailable,
  });
}
