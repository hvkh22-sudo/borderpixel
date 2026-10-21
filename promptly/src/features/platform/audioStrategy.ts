/**
 * Who owns the microphone during a Voice Follow take (DECISIONS D4). Pure so
 * the decision is unit-tested.
 *
 *  - Android: always 'separate' — the camera records video only, the
 *    recognizer owns the mic and persists WAV, finalizeTake muxes.
 *  - iOS 'shared' (default): the camera records audio and the recognizer
 *    shares the AVAudioSession.
 *  - iOS 'separate' (fallback if device test VF-01 fails): same as Android,
 *    muxed by promptly-media's AVFoundation muxAudio. Needs the native module;
 *    without it the take falls back to 'shared' so it never ends up silent.
 */

export type IosVoiceFollowAudio = 'shared' | 'separate';

export const IOS_VOICE_FOLLOW_AUDIO_VALUES: readonly IosVoiceFollowAudio[] = ['shared', 'separate'];

/** A valid strategy, or null for anything else (unset env, stale stored value). */
export function parseIosVoiceFollowAudio(value: unknown): IosVoiceFollowAudio | null {
  return value === 'shared' || value === 'separate' ? value : null;
}

export type AudioPlanReason =
  | 'not_voice_follow'
  | 'android_recognizer_owns_mic'
  | 'ios_shared_session'
  | 'ios_separate_audio'
  | 'ios_separate_needs_media_module'
  | 'unsupported_os';

export interface AudioPlanInput {
  voiceFollow: boolean;
  os: 'ios' | 'android' | 'other';
  iosStrategy: IosVoiceFollowAudio;
  mediaModuleAvailable: boolean;
}

export interface AudioPlan {
  /** Camera records video only; the recognizer's persisted audio is muxed in after the take. */
  separateAudio: boolean;
  reason: AudioPlanReason;
}

export function voiceFollowAudioPlan(i: AudioPlanInput): AudioPlan {
  if (!i.voiceFollow) return { separateAudio: false, reason: 'not_voice_follow' };
  if (i.os === 'android') return { separateAudio: true, reason: 'android_recognizer_owns_mic' };
  if (i.os !== 'ios') return { separateAudio: false, reason: 'unsupported_os' };
  if (i.iosStrategy === 'shared') return { separateAudio: false, reason: 'ios_shared_session' };
  if (!i.mediaModuleAvailable) return { separateAudio: false, reason: 'ios_separate_needs_media_module' };
  return { separateAudio: true, reason: 'ios_separate_audio' };
}

export const usesSeparateAudio = (i: AudioPlanInput): boolean => voiceFollowAudioPlan(i).separateAudio;
