import { DeviceFacts, burnInSupport, captionsSupport, voiceFollowSupport } from '../support';

const flags = { voiceFollow: true, captions: true, burnIn: true };
const ios: DeviceFacts = { os: 'ios', androidApiLevel: 0, recognitionAvailable: true, recognizerCanPersistAudio: true, mediaModuleAvailable: true };
const android = (api: number, extra: Partial<DeviceFacts> = {}): DeviceFacts => ({
  os: 'android',
  androidApiLevel: api,
  recognitionAvailable: true,
  recognizerCanPersistAudio: api >= 33,
  mediaModuleAvailable: true,
  ...extra,
});

describe('platform support', () => {
  it('supports everything on a capable iPhone', () => {
    expect(voiceFollowSupport(ios, flags)).toEqual({ ok: true });
    expect(captionsSupport(ios, flags)).toEqual({ ok: true });
    expect(burnInSupport(ios, flags)).toEqual({ ok: true });
  });

  it('iOS Voice Follow does not need the media module (camera records audio)', () => {
    expect(voiceFollowSupport({ ...ios, mediaModuleAvailable: false }, flags)).toEqual({ ok: true });
    expect(captionsSupport({ ...ios, mediaModuleAvailable: false }, flags)).toEqual({ ok: true });
  });

  it('gates Android below API 33', () => {
    expect(voiceFollowSupport(android(32), flags)).toEqual({ ok: false, reason: 'os_too_old' });
    expect(captionsSupport(android(31), flags)).toEqual({ ok: false, reason: 'os_too_old' });
    expect(voiceFollowSupport(android(33), flags)).toEqual({ ok: true });
  });

  it('requires the media module on Android', () => {
    expect(voiceFollowSupport(android(34, { mediaModuleAvailable: false }), flags)).toEqual({ ok: false, reason: 'native_module_missing' });
    expect(captionsSupport(android(34, { mediaModuleAvailable: false }), flags)).toEqual({ ok: false, reason: 'native_module_missing' });
  });

  it('requires a recognizer and respects flags', () => {
    expect(voiceFollowSupport({ ...ios, recognitionAvailable: false }, flags)).toEqual({ ok: false, reason: 'no_recognizer' });
    expect(voiceFollowSupport(ios, { ...flags, voiceFollow: false })).toEqual({ ok: false, reason: 'flag_off' });
    expect(burnInSupport(ios, { ...flags, burnIn: false })).toEqual({ ok: false, reason: 'flag_off' });
    expect(captionsSupport({ ...ios, os: 'other' }, flags)).toEqual({ ok: false, reason: 'no_recognizer' });
  });
});
