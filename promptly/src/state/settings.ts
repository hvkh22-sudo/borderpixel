/**
 * User preferences (persisted in the local KV store). Teleprompter display
 * settings persist across sessions as required by the spec.
 */
import { create } from 'zustand';

export type ScrollMode = 'manual' | 'timed' | 'voice';
export type Appearance = 'system' | 'light' | 'dark';
export type TextAlign = 'left' | 'center';

export interface PrompterSettings {
  fontSize: number;
  lineHeight: number;
  /** Fraction of the screen width used by text (narrow = less eye movement). */
  textWidth: number;
  fontWeight: '500' | '700' | '800';
  align: TextAlign;
  textOpacity: number;
  /** Dim layer behind the text, over the camera preview. */
  backdropOpacity: number;
  mirror: boolean;
  /** Reading line position from top (0..1). Near top = closer to the lens. */
  readingLine: number;
  highContrast: boolean;
  showReadingGuide: boolean;
  wpm: number;
  countdownSec: 0 | 3 | 5 | 10;
  mode: ScrollMode;
}

export interface CameraSettings {
  position: 'front' | 'back';
  resolution: '1080p' | '720p';
  fps: 30 | 60;
}

export interface SettingsState {
  hydrated: boolean;
  appearance: Appearance;
  onboardingDone: boolean;
  analyticsEnabled: boolean;
  /** Explicit consent to send AI Studio text to the named AI provider (Apple 5.1.2(i)). */
  aiConsent: boolean;
  speechLocale: string;
  prompter: PrompterSettings;
  camera: CameraSettings;
}

export const DEFAULT_PROMPTER: PrompterSettings = {
  fontSize: 30,
  lineHeight: 1.35,
  textWidth: 0.86,
  fontWeight: '700',
  align: 'left',
  textOpacity: 1,
  backdropOpacity: 0.45,
  mirror: false,
  readingLine: 0.22,
  highContrast: false,
  showReadingGuide: true,
  wpm: 150,
  countdownSec: 3,
  mode: 'timed',
};

export const DEFAULT_SETTINGS: SettingsState = {
  hydrated: false,
  appearance: 'system',
  onboardingDone: false,
  analyticsEnabled: false,
  aiConsent: false,
  speechLocale: 'en-US',
  prompter: DEFAULT_PROMPTER,
  camera: { position: 'front', resolution: '1080p', fps: 30 },
};

interface SettingsActions {
  hydrate(saved: Partial<SettingsState>): void;
  set(patch: Partial<Omit<SettingsState, 'prompter' | 'camera' | 'hydrated'>>): void;
  setPrompter(patch: Partial<PrompterSettings>): void;
  setCamera(patch: Partial<CameraSettings>): void;
  reset(): void;
}

export type SettingsStore = SettingsState & SettingsActions;

export const useSettings = create<SettingsStore>((set) => ({
  ...DEFAULT_SETTINGS,
  hydrate: (saved) =>
    set({
      ...DEFAULT_SETTINGS,
      ...saved,
      prompter: { ...DEFAULT_PROMPTER, ...saved.prompter },
      camera: { ...DEFAULT_SETTINGS.camera, ...saved.camera },
      hydrated: true,
    }),
  set: (patch) => set(patch),
  setPrompter: (patch) => set((s) => ({ prompter: { ...s.prompter, ...patch } })),
  setCamera: (patch) => set((s) => ({ camera: { ...s.camera, ...patch } })),
  reset: () => set({ ...DEFAULT_SETTINGS, hydrated: true, onboardingDone: true }),
}));

export function persistableSettings(s: SettingsState): Omit<SettingsState, 'hydrated'> {
  const { hydrated: _h, ...rest } = s;
  return rest;
}
