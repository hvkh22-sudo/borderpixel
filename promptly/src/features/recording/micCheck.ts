/**
 * Mic pre-flight ("Mic check") — pure verdict logic.
 *
 * Input is a list of level samples in dBFS (0 = full scale, more negative =
 * quieter) polled from the recorder's meter while the creator speaks for a few
 * seconds. Platform meters are not identical:
 *  - iOS (AVAudioRecorder.averagePower) reports an *average* power per poll.
 *  - Android (MediaRecorder.getMaxAmplitude → 20·log10(amp/32767)) reports the
 *    *peak* since the previous poll, so it reads several dB hotter for the same voice.
 * Both use -160 for "no signal".
 *
 * THRESHOLDS ARE INITIAL ESTIMATES. They come from typical speech levels, not
 * from measurements on our devices, and must be calibrated on real iPhones and
 * Android phones (built-in, wired, USB and Bluetooth mics) — see MIC-01 in
 * docs/testing/test-plan.md. Platform-specific thresholds may be needed.
 */

export type MicVerdict = 'good' | 'quiet' | 'clipping' | 'silent';

export interface MicThresholds {
  /** Loudest sample below this → nothing reached the mic (muted, covered, wrong input). */
  silentPeakDb: number;
  /** Speech level (high percentile) below this → too quiet for clean video audio. */
  quietSpeechDb: number;
  /** A sample at or above this is treated as clipped / distorting. */
  clipDb: number;
  /** Share of samples at or above clipDb that counts as clipping (avoids one-off pops). */
  clipRatio: number;
  /** Percentile (0–1) used as the "speech level", so pauses between words don't drag it down. */
  speechPercentile: number;
}

export const DEFAULT_MIC_THRESHOLDS: MicThresholds = {
  silentPeakDb: -50,
  quietSpeechDb: -35,
  clipDb: -1,
  clipRatio: 0.05,
  speechPercentile: 0.9,
};

/** How long the check records. */
export const MIC_CHECK_DURATION_MS = 3000;
/** How often the screen polls the meter. */
export const MIC_CHECK_POLL_MS = 100;

/** Floor of the visual meter; anything quieter shows as empty. */
export const METER_FLOOR_DB = -60;

function clean(samples: readonly number[]): number[] {
  return samples.filter((s) => Number.isFinite(s)).map((s) => Math.min(0, Math.max(-160, s)));
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return -160;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx] ?? -160;
}

export interface MicAnalysis {
  verdict: MicVerdict;
  peakDb: number;
  speechDb: number;
  clippedRatio: number;
}

export function analyzeMicSamples(samples: readonly number[], th: MicThresholds = DEFAULT_MIC_THRESHOLDS): MicAnalysis {
  const s = clean(samples);
  if (s.length === 0) return { verdict: 'silent', peakDb: -160, speechDb: -160, clippedRatio: 0 };
  const sorted = [...s].sort((a, b) => a - b);
  const peakDb = sorted[sorted.length - 1] ?? -160;
  const speechDb = percentile(sorted, th.speechPercentile);
  const clippedRatio = s.filter((x) => x >= th.clipDb).length / s.length;

  let verdict: MicVerdict;
  if (peakDb < th.silentPeakDb) verdict = 'silent';
  else if (clippedRatio >= th.clipRatio) verdict = 'clipping';
  else if (speechDb < th.quietSpeechDb) verdict = 'quiet';
  else verdict = 'good';
  return { verdict, peakDb, speechDb, clippedRatio };
}

export function micVerdict(samples: readonly number[], th: MicThresholds = DEFAULT_MIC_THRESHOLDS): MicVerdict {
  return analyzeMicSamples(samples, th).verdict;
}

/** dBFS → 0…1 for the live meter (linear in dB between METER_FLOOR_DB and 0). */
export function meterFraction(db: number | undefined | null): number {
  if (db == null || !Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / -METER_FLOOR_DB));
}

export type MicInputKind = 'builtIn' | 'bluetooth' | 'wired' | 'usb' | 'other';

/**
 * Classify the input `type` reported by expo-audio's getCurrentInput():
 * iOS returns AVAudioSession.Port raw values (MicrophoneBuiltIn, BluetoothHFP,
 * MicrophoneWired, HeadsetMicrophone, USBAudio, LineIn, CarAudio…); Android
 * returns MicrophoneBuiltIn / BluetoothSCO / BluetoothA2DP / MicrophoneWired /
 * Telephony, and "Unknown device type" for anything else (including USB mics).
 */
export function classifyMicInput(type: string | null | undefined): MicInputKind {
  const t = (type ?? '').toLowerCase();
  if (t.includes('bluetooth')) return 'bluetooth';
  if (t.includes('usb')) return 'usb';
  if (t.includes('builtin')) return 'builtIn';
  if (t.includes('wired') || t.includes('headset') || t.includes('linein')) return 'wired';
  return 'other';
}
