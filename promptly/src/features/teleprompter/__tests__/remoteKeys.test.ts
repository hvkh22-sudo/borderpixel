import {
  acceptRecordToggle,
  mapRemoteKey,
  normalizeRemoteKey,
  RECORD_TOGGLE_COOLDOWN_MS,
  REMOTE_NUDGE_LINES,
  type RemoteContext,
} from '../remoteKeys';

const manual: RemoteContext = { mode: 'manual', recordToggle: false };
const timed: RemoteContext = { mode: 'timed', recordToggle: false };
const voice: RemoteContext = { mode: 'voice', recordToggle: false };

describe('remoteKeys', () => {
  it('normalizes aliases and rejects unknown keys', () => {
    expect(normalizeRemoteKey(' ')).toBe('Space');
    expect(normalizeRemoteKey('Spacebar')).toBe('Space');
    expect(normalizeRemoteKey('NumpadEnter')).toBe('Enter');
    expect(normalizeRemoteKey('PageDown')).toBe('PageDown');
    expect(normalizeRemoteKey('a')).toBeNull();
    expect(normalizeRemoteKey('AudioVolumeUp')).toBeNull();
    expect(mapRemoteKey({ key: 'Escape' }, manual)).toEqual({ type: 'none' });
  });

  it.each(['ArrowDown', 'ArrowRight', 'PageDown', 'MediaTrackNext'])('%s moves forward in every mode', (key) => {
    for (const ctx of [manual, timed, voice]) {
      expect(mapRemoteKey({ key }, ctx)).toEqual({ type: 'nudge', lines: REMOTE_NUDGE_LINES });
    }
  });

  it.each(['ArrowUp', 'ArrowLeft', 'PageUp', 'MediaTrackPrevious'])('%s moves back in every mode', (key) => {
    for (const ctx of [manual, timed, voice]) {
      expect(mapRemoteKey({ key }, ctx)).toEqual({ type: 'nudge', lines: -REMOTE_NUDGE_LINES });
    }
  });

  it('Space toggles play in Timed and scrolls forward otherwise', () => {
    expect(mapRemoteKey({ key: 'Space' }, timed)).toEqual({ type: 'togglePlay' });
    expect(mapRemoteKey({ key: ' ' }, manual)).toEqual({ type: 'nudge', lines: REMOTE_NUDGE_LINES });
    expect(mapRemoteKey({ key: 'Space' }, voice)).toEqual({ type: 'nudge', lines: REMOTE_NUDGE_LINES });
  });

  it('MediaPlayPause only toggles play in Timed', () => {
    expect(mapRemoteKey({ key: 'MediaPlayPause' }, timed)).toEqual({ type: 'togglePlay' });
    expect(mapRemoteKey({ key: 'MediaPlayPause' }, manual)).toEqual({ type: 'none' });
  });

  it('Enter never toggles recording unless opted in', () => {
    for (const ctx of [manual, timed, voice]) {
      expect(mapRemoteKey({ key: 'Enter' }, ctx)).toEqual({ type: 'none' });
      expect(mapRemoteKey({ key: 'Enter' }, { ...ctx, recordToggle: true })).toEqual({ type: 'toggleRecord' });
    }
  });

  it('key repeat scrolls but never repeats a toggle', () => {
    expect(mapRemoteKey({ key: 'ArrowDown', repeat: true }, manual)).toEqual({ type: 'nudge', lines: REMOTE_NUDGE_LINES });
    expect(mapRemoteKey({ key: 'Space', repeat: true }, timed)).toEqual({ type: 'none' });
    expect(mapRemoteKey({ key: 'Enter', repeat: true }, { ...manual, recordToggle: true })).toEqual({ type: 'none' });
  });

  it('record toggles have a cooldown', () => {
    expect(acceptRecordToggle(null, 1000)).toBe(true);
    expect(acceptRecordToggle(1000, 1000 + RECORD_TOGGLE_COOLDOWN_MS - 1)).toBe(false);
    expect(acceptRecordToggle(1000, 1000 + RECORD_TOGGLE_COOLDOWN_MS)).toBe(true);
  });
});
