/**
 * Privacy-conscious analytics. Events carry only enums, counts and durations:
 * never script text, transcripts, audio, video or personal data. The event
 * union is the allow-list — anything else does not compile.
 *
 * No provider is wired yet: choosing one (and its privacy-label impact) needs
 * founder approval. Until then events go to a sink that is a no-op in release.
 */
import type { StudioTool } from '../features/ai-script-studio/studio';
import type { RecordingErrorCode } from '../features/recording/recordingMachine';
import type { SpeechErrorCode } from '../features/voice-follow/voiceFollowController';
import type { TranscriptionErrorCode } from './transcription';

export type AnalyticsEvent =
  | { name: 'app_open' }
  | { name: 'onboarding_completed' }
  | { name: 'script_created'; source: 'blank' | 'paste' | 'ai' | 'sample' }
  | { name: 'recording_started'; mode: 'manual' | 'timed' | 'voice' }
  | { name: 'recording_completed'; mode: 'manual' | 'timed' | 'voice'; durationSec: number }
  | { name: 'recording_failed'; code: RecordingErrorCode | 'recorder_error' }
  | { name: 'export_completed'; captions: boolean; kind: 'video' | 'srt' }
  | { name: 'voice_follow_started' }
  | { name: 'voice_follow_failed'; code: SpeechErrorCode }
  | { name: 'captions_generated'; words: number; durationSec: number }
  | { name: 'captions_failed'; code: TranscriptionErrorCode }
  | { name: 'ai_request'; tool: StudioTool; ok: boolean }
  | { name: 'ai_output_reported'; tool: StudioTool }
  | { name: 'paywall_viewed'; trigger: 'voiceFollow' | 'captionStyle' | 'captionWordHighlight' | 'general' }
  | { name: 'purchase_completed'; product: 'monthly' | 'annual' | 'lifetime' | 'credits' }
  | { name: 'purchase_restored'; found: boolean };

type Sink = (e: AnalyticsEvent & { t: number }) => void;

let sink: Sink = (e) => {
  if (__DEV__) console.log('[analytics]', e.name, e);
};

export function setAnalyticsSink(next: Sink): void {
  sink = next;
}

let enabled = true;
export function setAnalyticsEnabled(v: boolean): void {
  enabled = v;
}

export function track(e: AnalyticsEvent): void {
  if (!enabled) return;
  try {
    sink({ ...e, t: Date.now() });
  } catch {
    // Analytics must never break the app.
  }
}
