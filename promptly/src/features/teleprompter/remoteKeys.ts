/**
 * Bluetooth page-turner / hardware keyboard → teleprompter action mapping.
 * Pure: the native layer (modules/promptly-media) forwards normalized key
 * names; the record screen applies the returned action. See
 * docs/architecture/remote-control.md.
 */
import type { ScrollMode } from '../../state/settings';

/** Key names the native layer emits (W3C-style `KeyboardEvent.key` names). */
export type RemoteKey =
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'PageUp'
  | 'PageDown'
  | 'Space'
  | 'Enter'
  | 'MediaPlayPause'
  | 'MediaTrackNext'
  | 'MediaTrackPrevious';

export type RemoteAction =
  | { type: 'nudge'; lines: number }
  | { type: 'togglePlay' }
  | { type: 'toggleRecord' }
  | { type: 'none' };

export interface RemoteContext {
  mode: ScrollMode;
  /** Opt-in setting "Remote can start/stop recording" (default off). */
  recordToggle: boolean;
}

export interface RemoteKeyEvent {
  key: string;
  /** True for auto-repeat while a key is held (Android only; iOS never repeats). */
  repeat?: boolean;
}

/** Lines moved per press: enough to turn a "page" of a short script without losing the place. */
export const REMOTE_NUDGE_LINES = 3;
/** Ignore a second record toggle this soon after the previous one (bouncy remotes, double taps). */
export const RECORD_TOGGLE_COOLDOWN_MS = 1500;

const ALIASES: Record<string, RemoteKey> = {
  ' ': 'Space',
  Spacebar: 'Space',
  Return: 'Enter',
  NumpadEnter: 'Enter',
};

const KNOWN = new Set<string>([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Space',
  'Enter',
  'MediaPlayPause',
  'MediaTrackNext',
  'MediaTrackPrevious',
]);

export function normalizeRemoteKey(key: string): RemoteKey | null {
  const k = ALIASES[key] ?? key;
  return KNOWN.has(k) ? (k as RemoteKey) : null;
}

const NONE: RemoteAction = { type: 'none' };
const forward: RemoteAction = { type: 'nudge', lines: REMOTE_NUDGE_LINES };
const back: RemoteAction = { type: 'nudge', lines: -REMOTE_NUDGE_LINES };

export function mapRemoteKey(event: RemoteKeyEvent, ctx: RemoteContext): RemoteAction {
  const key = normalizeRemoteKey(event.key);
  if (!key) return NONE;
  const timed = ctx.mode === 'timed';
  let action: RemoteAction;
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
    case 'PageDown':
    case 'MediaTrackNext':
      action = forward;
      break;
    case 'ArrowUp':
    case 'ArrowLeft':
    case 'PageUp':
    case 'MediaTrackPrevious':
      action = back;
      break;
    case 'Space':
      action = timed ? { type: 'togglePlay' } : forward;
      break;
    case 'MediaPlayPause':
      action = timed ? { type: 'togglePlay' } : NONE;
      break;
    case 'Enter':
      // Never start/stop a take from an ambiguous key unless the creator opted in.
      action = ctx.recordToggle ? { type: 'toggleRecord' } : NONE;
      break;
  }
  // Holding a key may scroll repeatedly, but must never flip play/record back and forth.
  if (event.repeat && action.type !== 'nudge') return NONE;
  return action;
}

/** Cooldown gate for record toggles; returns true when the toggle should run. */
export function acceptRecordToggle(lastToggleMs: number | null, nowMs: number): boolean {
  return lastToggleMs == null || nowMs - lastToggleMs >= RECORD_TOGGLE_COOLDOWN_MS;
}
