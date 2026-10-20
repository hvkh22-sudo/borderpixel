/**
 * One-tap recording presets. A preset is a partial settings patch; applying
 * it changes only the fields it names, and any later manual change simply
 * makes the setup "Custom" (detected, never stored).
 */
import type { TKey } from '../../localization/i18n';
import type { CaptionPosition } from '../captions/captionStyles';
import type { CameraSettings, PrompterSettings } from '../../state/settings';

export type PresetId = 'vertical' | 'youtube' | 'talkingHead60';

export interface RecordingPreset {
  id: PresetId;
  nameKey: TKey;
  detailKey: TKey;
  camera: Partial<CameraSettings>;
  prompter: Partial<PrompterSettings>;
  captionPosition?: CaptionPosition;
}

export const RECORDING_PRESETS: readonly RecordingPreset[] = [
  {
    id: 'vertical',
    nameKey: 'presets.vertical',
    detailKey: 'presets.verticalDetail',
    camera: { orientation: 'portrait', resolution: '1080p', fps: 30 },
    // Reading line high, close to the front lens, so eyes stay near the camera.
    prompter: { readingLine: 0.18 },
    // Lower safe area: above the platform UI at the bottom of 9:16 video.
    captionPosition: 'lower',
  },
  {
    id: 'youtube',
    nameKey: 'presets.youtube',
    detailKey: 'presets.youtubeDetail',
    camera: { orientation: 'landscape', resolution: '1080p', fps: 30 },
    prompter: {},
  },
  {
    id: 'talkingHead60',
    nameKey: 'presets.talkingHead60',
    detailKey: 'presets.talkingHead60Detail',
    // 60 fps is a camera constraint: devices without a 60 fps format fall back.
    camera: { orientation: 'portrait', resolution: '1080p', fps: 60 },
    prompter: {},
  },
];

export interface PresetTarget {
  camera: CameraSettings;
  prompter: PrompterSettings;
  captionPosition: CaptionPosition;
}

function matches<T extends object>(current: T, patch: Partial<T>): boolean {
  return (Object.keys(patch) as (keyof T)[]).every((k) => current[k] === patch[k]);
}

/** The preset the current settings correspond to, or null for "Custom". */
export function activePreset(s: PresetTarget): PresetId | null {
  const hit = RECORDING_PRESETS.find(
    (p) => matches(s.camera, p.camera) && matches(s.prompter, p.prompter) && (p.captionPosition == null || p.captionPosition === s.captionPosition),
  );
  return hit?.id ?? null;
}

export function getPreset(id: PresetId): RecordingPreset {
  const p = RECORDING_PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown preset ${id}`);
  return p;
}

/** Settings after applying a preset (fields it does not name are kept). */
export function applyPreset(s: PresetTarget, id: PresetId): PresetTarget {
  const p = getPreset(id);
  return {
    camera: { ...s.camera, ...p.camera },
    prompter: { ...s.prompter, ...p.prompter },
    captionPosition: p.captionPosition ?? s.captionPosition,
  };
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Recording target size. Portrait sizes are VisionCamera's CommonResolutions
 * (width < height); landscape swaps them. Results are module constants so the
 * video output is not recreated on re-render. (iOS negotiates by long/short
 * edge, so orientation there comes from the output orientation; Android
 * behaviour is verified on device, test REC-07.)
 */
const SIZES: Record<CameraSettings['orientation'], Record<CameraSettings['resolution'], Size>> = {
  portrait: { '1080p': { width: 1080, height: 1920 }, '720p': { width: 720, height: 1280 } },
  landscape: { '1080p': { width: 1920, height: 1080 }, '720p': { width: 1280, height: 720 } },
};

export function targetResolution(orientation: CameraSettings['orientation'], resolution: CameraSettings['resolution']): Size {
  return SIZES[orientation][resolution];
}
