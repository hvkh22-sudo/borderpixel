/** Hidden entry gesture: `taps` taps, each within `windowMs` of the previous one. */
export const DIAGNOSTICS_TAPS = 5;
export const DIAGNOSTICS_TAP_WINDOW_MS = 1500;

export function createTapUnlock(taps = DIAGNOSTICS_TAPS, windowMs = DIAGNOSTICS_TAP_WINDOW_MS) {
  let count = 0;
  let last = -Infinity;
  /** Register a tap at `now`; true when this tap completes the sequence (then it starts over). */
  return (now: number): boolean => {
    count = now - last <= windowMs ? count + 1 : 1;
    last = now;
    if (count < taps) return false;
    count = 0;
    last = -Infinity;
    return true;
  };
}
