/**
 * Plain-text diagnostics report the founder pastes into a chat with Claude.
 * Device facts, decisions, flags and error codes only — never script text,
 * transcripts, file names, user ids or URLs. The report is a technical
 * artifact, so it is English and not localized.
 */
import type { AudioPlan, IosVoiceFollowAudio } from '../platform/audioStrategy';
import type { DeviceFacts, Support } from '../platform/support';

export interface DiagnosticsErrorLine {
  at: number;
  source: string;
  code: string;
  message?: string;
}

export interface DiagnosticsData {
  generatedAt: number;
  app: { name: string; version: string; build: string; runtime: string };
  os: { name: string; version: string };
  device: DeviceFacts & { onDeviceRecognition: boolean; remoteKeys: boolean };
  support: { voiceFollow: Support; captions: Support; burnIn: Support };
  voiceFollowAudio: { strategy: IosVoiceFollowAudio; source: 'build' | 'override'; plan: AudioPlan };
  speechLocales: { current: string; supported: string[]; installed: string[]; error?: string };
  flags: { build: Record<string, boolean>; effective: Record<string, boolean> };
  overrides: { iosVoiceFollowAudio: string; burnIn: string; integrityHeaders: boolean };
  services: { purchasesConfigured: boolean; aiBaseUrlSet: boolean; playCloudProjectSet: boolean };
  errors: DiagnosticsErrorLine[];
}

const yn = (b: boolean) => (b ? 'yes' : 'no');
const decision = (s: Support) => (s.ok ? 'supported' : `unsupported (${s.reason})`);
const flagList = (f: Record<string, boolean>) =>
  Object.entries(f)
    .map(([k, v]) => `${k}=${v ? 'on' : 'off'}`)
    .join(', ');

export function formatDiagnosticsReport(d: DiagnosticsData): string {
  const lines: string[] = [];
  const push = (...l: string[]) => lines.push(...l);
  push(`Promptly diagnostics report (${new Date(d.generatedAt).toISOString()})`, '');

  push('[App]');
  push(`name: ${d.app.name}`, `version: ${d.app.version}`, `build: ${d.app.build}`, `runtime: ${d.app.runtime}`, '');

  push('[OS]');
  push(`platform: ${d.os.name}`, `version: ${d.os.version}`);
  if (d.device.os === 'android') push(`android api level: ${d.device.androidApiLevel}`);
  push('');

  push('[Device]');
  push(
    `speech recognizer available: ${yn(d.device.recognitionAvailable)}`,
    `on-device recognition: ${yn(d.device.onDeviceRecognition)}`,
    `recognizer can persist audio (supportsRecording): ${yn(d.device.recognizerCanPersistAudio)}`,
    `promptly-media module: ${yn(d.device.mediaModuleAvailable)}`,
    `remote keys: ${yn(d.device.remoteKeys)}`,
    '',
  );

  push('[Feature support]');
  push(
    `voice follow: ${decision(d.support.voiceFollow)}`,
    `captions: ${decision(d.support.captions)}`,
    `burn-in: ${decision(d.support.burnIn)}`,
    `voice follow audio: ${d.voiceFollowAudio.plan.separateAudio ? 'separate (camera video-only, recognizer audio muxed)' : 'camera records audio'} — ${d.voiceFollowAudio.plan.reason}`,
    `ios voice follow audio strategy: ${d.voiceFollowAudio.strategy} (${d.voiceFollowAudio.source})`,
    '',
  );

  push('[Speech locales]');
  push(`current: ${d.speechLocales.current} (${d.speechLocales.supported.includes(d.speechLocales.current) ? 'supported' : 'not in supported list'})`);
  if (d.speechLocales.error) push(`error: ${d.speechLocales.error}`);
  push(`supported (${d.speechLocales.supported.length}): ${d.speechLocales.supported.join(', ') || '—'}`);
  push(`installed (${d.speechLocales.installed.length}): ${d.speechLocales.installed.join(', ') || '—'}`, '');

  push('[Flags]');
  push(`build: ${flagList(d.flags.build)}`, `effective: ${flagList(d.flags.effective)}`);
  push(
    `overrides: iosVoiceFollowAudio=${d.overrides.iosVoiceFollowAudio}, burnIn=${d.overrides.burnIn}, integrityHeaders=${d.overrides.integrityHeaders ? 'on' : 'off'}`,
    '',
  );

  push('[Services]');
  push(
    `purchases configured: ${yn(d.services.purchasesConfigured)}`,
    `ai base url set: ${yn(d.services.aiBaseUrlSet)}`,
    `play cloud project number set: ${yn(d.services.playCloudProjectSet)}`,
    '',
  );

  push(`[Recent errors] (${d.errors.length})`);
  if (d.errors.length === 0) push('none');
  // Newest first: the last failure is usually the one being asked about.
  for (const e of [...d.errors].reverse()) {
    push(`${new Date(e.at).toISOString()} ${e.source} ${e.code}${e.message ? ` — ${e.message}` : ''}`);
  }
  return lines.join('\n');
}
