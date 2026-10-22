import { setLanguage } from '../i18n';
import { contentDirectionStyle, syncLayoutDirection, type DirectionManager } from '../layoutDirection';

function manager(isRTL: boolean): DirectionManager & { allowRTL: jest.Mock; forceRTL: jest.Mock } {
  return { isRTL, allowRTL: jest.fn(), forceRTL: jest.fn() };
}

describe('syncLayoutDirection', () => {
  afterEach(() => setLanguage('en'));

  it('does nothing when layout already matches the UI language', () => {
    setLanguage('he');
    const m = manager(true);
    expect(syncLayoutDirection(m)).toBe(false);
    expect(m.allowRTL).not.toHaveBeenCalled();
    setLanguage('en');
    expect(syncLayoutDirection(manager(false))).toBe(false);
  });

  it('enables RTL for a Hebrew UI', () => {
    setLanguage('he');
    const m = manager(false);
    expect(syncLayoutDirection(m)).toBe(true);
    expect(m.allowRTL).toHaveBeenCalledWith(true);
    expect(m.forceRTL).toHaveBeenCalledWith(true);
  });

  it('disables mirroring when the UI falls back to English on an RTL device', () => {
    setLanguage('ar');
    const m = manager(true);
    expect(syncLayoutDirection(m)).toBe(true);
    expect(m.allowRTL).toHaveBeenCalledWith(false);
    expect(m.forceRTL).toHaveBeenCalledWith(false);
  });
});

describe('contentDirectionStyle', () => {
  it('aligns inputs to the physical edge of the text direction (TextInput does not swap in RTL)', () => {
    expect(contentDirectionStyle('שלום עולם', true)).toEqual({ writingDirection: 'rtl', textAlign: 'right' });
    expect(contentDirectionStyle('Hello', true)).toEqual({ writingDirection: 'ltr', textAlign: 'left' });
    expect(contentDirectionStyle('שלום עולם', false)).toEqual({ writingDirection: 'rtl', textAlign: 'right' });
    expect(contentDirectionStyle('Hello', false)).toEqual({ writingDirection: 'ltr', textAlign: 'left' });
  });

  it('empty text follows the UI direction so the placeholder reads right', () => {
    expect(contentDirectionStyle('', true)).toEqual({ writingDirection: 'rtl', textAlign: 'right' });
    expect(contentDirectionStyle('', false)).toEqual({ writingDirection: 'ltr', textAlign: 'left' });
  });
});
