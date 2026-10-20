import { renderHook } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';

import { announce, useAnnounce } from '../useAnnounce';

const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
const originalOS = Platform.OS;
const setOS = (os: typeof Platform.OS) => Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

afterEach(() => {
  spy.mockClear();
  setOS(originalOS);
});

describe('useAnnounce', () => {
  it('announces each new message once on iOS and stays quiet for null', async () => {
    setOS('ios');
    const { rerender } = await renderHook(({ m }: { m: string | null }) => useAnnounce(m), { initialProps: { m: null as string | null } });
    expect(spy).not.toHaveBeenCalled();
    await rerender({ m: 'Recording' });
    await rerender({ m: 'Recording' });
    expect(spy).toHaveBeenCalledTimes(1);
    await rerender({ m: 'Recording stopped' });
    expect(spy).toHaveBeenLastCalledWith('Recording stopped');
    // The same message after a gap is a new event.
    await rerender({ m: null });
    await rerender({ m: 'Recording stopped' });
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('leaves Android to live regions unless asked for all platforms', () => {
    setOS('android');
    announce('Saved');
    expect(spy).not.toHaveBeenCalled();
    announce('Preparing video… 50%', 'all');
    expect(spy).toHaveBeenCalledWith('Preparing video… 50%');
  });
});
