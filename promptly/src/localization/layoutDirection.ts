/**
 * Keeps React Native's layout direction in step with the UI language.
 *
 * expo-localization (config plugin `supportsRTL: true`) allows RTL natively
 * before React loads, so a Hebrew device normally starts mirrored already.
 * This covers the remaining mismatches — e.g. an Arabic device (no Arabic UI
 * yet, so English text) that would otherwise get a mirrored English layout,
 * or a device that switched language since the last launch.
 * I18nManager changes only apply after the app restarts; we do not force a
 * reload at start-up, so a mismatch is corrected on the next launch.
 */
import { I18nManager } from 'react-native';

import { isRtl } from './i18n';

export interface DirectionManager {
  isRTL: boolean;
  allowRTL(allow: boolean): void;
  forceRTL(force: boolean): void;
}

/** Returns true when a change was scheduled (takes effect after restart). */
export function syncLayoutDirection(manager: DirectionManager = I18nManager): boolean {
  const wantRtl = isRtl();
  if (manager.isRTL === wantRtl) return false;
  manager.allowRTL(wantRtl);
  manager.forceRTL(wantRtl);
  return true;
}

/** Layout direction currently in effect (true = mirrored). */
export function layoutIsRtl(): boolean {
  return I18nManager.isRTL;
}

/** Transform for direction-bearing icons (chevrons, forward arrows, undo/redo) in a mirrored layout. */
export function flipInRtl(): { transform: { scaleX: number }[] } | undefined {
  return I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : undefined;
}
