import { parseIosVoiceFollowAudio, usesSeparateAudio, voiceFollowAudioPlan, type AudioPlanInput } from '../audioStrategy';

const input = (o: Partial<AudioPlanInput>): AudioPlanInput => ({
  voiceFollow: true,
  os: 'ios',
  iosStrategy: 'shared',
  mediaModuleAvailable: true,
  ...o,
});

describe('voice follow audio strategy (D4)', () => {
  it('parses only known strategies', () => {
    expect(parseIosVoiceFollowAudio('shared')).toBe('shared');
    expect(parseIosVoiceFollowAudio('separate')).toBe('separate');
    expect(parseIosVoiceFollowAudio(undefined)).toBeNull();
    expect(parseIosVoiceFollowAudio('SEPARATE')).toBeNull();
    expect(parseIosVoiceFollowAudio(1)).toBeNull();
  });

  it('never separates audio outside Voice Follow', () => {
    for (const os of ['ios', 'android', 'other'] as const) {
      expect(voiceFollowAudioPlan(input({ voiceFollow: false, os, iosStrategy: 'separate' }))).toEqual({
        separateAudio: false,
        reason: 'not_voice_follow',
      });
    }
  });

  it('Android always lets the recognizer own the mic, whatever the iOS strategy', () => {
    expect(usesSeparateAudio(input({ os: 'android', iosStrategy: 'shared' }))).toBe(true);
    expect(voiceFollowAudioPlan(input({ os: 'android' })).reason).toBe('android_recognizer_owns_mic');
  });

  it('iOS follows the strategy', () => {
    expect(voiceFollowAudioPlan(input({ iosStrategy: 'shared' }))).toEqual({ separateAudio: false, reason: 'ios_shared_session' });
    expect(voiceFollowAudioPlan(input({ iosStrategy: 'separate' }))).toEqual({ separateAudio: true, reason: 'ios_separate_audio' });
  });

  it('iOS separate without the media module falls back to camera audio (never a silent take)', () => {
    expect(voiceFollowAudioPlan(input({ iosStrategy: 'separate', mediaModuleAvailable: false }))).toEqual({
      separateAudio: false,
      reason: 'ios_separate_needs_media_module',
    });
  });

  it('other platforms record camera audio', () => {
    expect(usesSeparateAudio(input({ os: 'other', iosStrategy: 'separate' }))).toBe(false);
  });
});

describe('config.iosVoiceFollowAudio', () => {
  const env = process.env.EXPO_PUBLIC_IOS_VF_AUDIO;
  afterEach(() => {
    if (env === undefined) delete process.env.EXPO_PUBLIC_IOS_VF_AUDIO;
    else process.env.EXPO_PUBLIC_IOS_VF_AUDIO = env;
    jest.resetModules();
  });

  const load = () => {
    let value: string | undefined;
    jest.isolateModules(() => {
      value = (require('../../../services/config') as typeof import('../../../services/config')).config.iosVoiceFollowAudio;
    });
    return value;
  };

  it('defaults to shared and accepts separate from the environment', () => {
    delete process.env.EXPO_PUBLIC_IOS_VF_AUDIO;
    expect(load()).toBe('shared');
    process.env.EXPO_PUBLIC_IOS_VF_AUDIO = 'separate';
    expect(load()).toBe('separate');
    process.env.EXPO_PUBLIC_IOS_VF_AUDIO = 'bogus';
    expect(load()).toBe('shared');
  });
});
