import { DEFAULT_SETTINGS } from '../../../state/settings';
import { activePreset, applyPreset, RECORDING_PRESETS, targetResolution, type PresetTarget } from '../presets';

const defaults: PresetTarget = { camera: DEFAULT_SETTINGS.camera, prompter: DEFAULT_SETTINGS.prompter, captionPosition: DEFAULT_SETTINGS.captionPosition };

describe('recording presets', () => {
  it('default settings are Custom', () => {
    expect(activePreset(defaults)).toBeNull();
  });

  it('applying each preset makes exactly that preset active', () => {
    for (const p of RECORDING_PRESETS) expect(activePreset(applyPreset(defaults, p.id))).toBe(p.id);
    // Switching between presets also lands on the chosen one.
    expect(activePreset(applyPreset(applyPreset(defaults, 'vertical'), 'talkingHead60'))).toBe('talkingHead60');
    expect(activePreset(applyPreset(applyPreset(defaults, 'youtube'), 'vertical'))).toBe('vertical');
  });

  it('vertical: portrait 1080p 30 fps, reading line high, captions in the lower safe area', () => {
    const v = applyPreset({ ...defaults, captionPosition: 'upper' }, 'vertical');
    expect(v.camera).toMatchObject({ orientation: 'portrait', resolution: '1080p', fps: 30 });
    expect(v.prompter.readingLine).toBeLessThan(DEFAULT_SETTINGS.prompter.readingLine);
    expect(v.captionPosition).toBe('lower');
  });

  it('youtube: landscape 1080p; keeps fields it does not name', () => {
    const custom = { ...defaults, camera: { ...defaults.camera, position: 'back' as const }, prompter: { ...defaults.prompter, fontSize: 40 } };
    const y = applyPreset(custom, 'youtube');
    expect(y.camera).toEqual({ position: 'back', orientation: 'landscape', resolution: '1080p', fps: 30 });
    expect(y.prompter.fontSize).toBe(40);
  });

  it('talking head sets 60 fps', () => {
    expect(applyPreset(defaults, 'talkingHead60').camera.fps).toBe(60);
  });

  it('a manual change afterwards turns the setup into Custom', () => {
    const v = applyPreset(defaults, 'vertical');
    expect(activePreset({ ...v, camera: { ...v.camera, resolution: '720p' } })).toBeNull();
    expect(activePreset({ ...v, prompter: { ...v.prompter, readingLine: 0.3 } })).toBeNull();
    // Display changes the preset does not own keep it active.
    expect(activePreset({ ...v, prompter: { ...v.prompter, fontSize: 44 } })).toBe('vertical');
  });

  it('target resolution follows the frame orientation and is a stable reference', () => {
    expect(targetResolution('portrait', '1080p')).toEqual({ width: 1080, height: 1920 });
    expect(targetResolution('landscape', '1080p')).toEqual({ width: 1920, height: 1080 });
    expect(targetResolution('landscape', '720p')).toEqual({ width: 1280, height: 720 });
    expect(targetResolution('portrait', '720p')).toBe(targetResolution('portrait', '720p'));
  });
});
