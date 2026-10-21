import { formatDiagnosticsReport, type DiagnosticsData } from '../report';
import { createTapUnlock } from '../tapUnlock';

const data = (o: Partial<DiagnosticsData> = {}): DiagnosticsData => ({
  generatedAt: Date.UTC(2026, 9, 21, 12, 0, 0),
  app: { name: 'Promptly', version: '1.0.0', build: '7', runtime: 'bare, sdk 58.0.0, release' },
  os: { name: 'ios', version: '19.1' },
  device: {
    os: 'ios',
    androidApiLevel: 0,
    recognitionAvailable: true,
    recognizerCanPersistAudio: true,
    mediaModuleAvailable: true,
    onDeviceRecognition: false,
    remoteKeys: true,
  },
  support: { voiceFollow: { ok: true }, captions: { ok: true }, burnIn: { ok: false, reason: 'flag_off' } },
  voiceFollowAudio: { strategy: 'separate', source: 'override', plan: { separateAudio: true, reason: 'ios_separate_audio' } },
  speechLocales: { current: 'he-IL', supported: ['en-US', 'he-IL'], installed: [] },
  flags: {
    build: { voiceFollow: true, captions: true, burnIn: false, aiStudio: true },
    effective: { voiceFollow: true, captions: true, burnIn: false, aiStudio: true },
  },
  overrides: { iosVoiceFollowAudio: 'separate', burnIn: 'default', integrityHeaders: false },
  services: { purchasesConfigured: false, aiBaseUrlSet: true, playCloudProjectSet: false },
  errors: [
    { at: Date.UTC(2026, 9, 21, 11, 0, 0), source: 'recording', code: 'recorder_error' },
    { at: Date.UTC(2026, 9, 21, 11, 30, 0), source: 'mux', code: 'mux_failed_ios', message: 'Export failed' },
  ],
  ...o,
});

describe('formatDiagnosticsReport', () => {
  it('formats every section as plain text', () => {
    const r = formatDiagnosticsReport(data());
    expect(r).toContain('Promptly diagnostics report (2026-10-21T12:00:00.000Z)');
    expect(r).toContain('version: 1.0.0');
    expect(r).toContain('build: 7');
    expect(r).toContain('platform: ios');
    expect(r).toContain('promptly-media module: yes');
    expect(r).toContain('on-device recognition: no');
    expect(r).toContain('burn-in: unsupported (flag_off)');
    expect(r).toContain('voice follow audio: separate (camera video-only, recognizer audio muxed) — ios_separate_audio');
    expect(r).toContain('ios voice follow audio strategy: separate (override)');
    expect(r).toContain('current: he-IL (supported)');
    expect(r).toContain('supported (2): en-US, he-IL');
    expect(r).toContain('installed (0): —');
    expect(r).toContain('build: voiceFollow=on, captions=on, burnIn=off, aiStudio=on');
    expect(r).toContain('integrityHeaders=off');
    expect(r).toContain('purchases configured: no');
    expect(r).toContain('ai base url set: yes');
    expect(r).not.toContain('android api level');
  });

  it('lists errors newest first', () => {
    const r = formatDiagnosticsReport(data());
    const mux = r.indexOf('mux mux_failed_ios — Export failed');
    const rec = r.indexOf('recording recorder_error');
    expect(mux).toBeGreaterThan(-1);
    expect(rec).toBeGreaterThan(mux);
    expect(r).toContain('[Recent errors] (2)');
  });

  it('shows the Android API level and an empty error list', () => {
    const d = data({ errors: [] });
    d.device = { ...d.device, os: 'android', androidApiLevel: 34 };
    const r = formatDiagnosticsReport(d);
    expect(r).toContain('android api level: 34');
    expect(r).toMatch(/\[Recent errors\] \(0\)\nnone/);
  });

  it('flags a current locale missing from the supported list and a locale read error', () => {
    const r = formatDiagnosticsReport(data({ speechLocales: { current: 'xx-YY', supported: [], installed: [], error: 'timeout' } }));
    expect(r).toContain('current: xx-YY (not in supported list)');
    expect(r).toContain('error: timeout');
  });
});

describe('createTapUnlock', () => {
  it('unlocks on the 5th quick tap and then starts over', () => {
    const tap = createTapUnlock(5, 1000);
    expect([0, 100, 200, 300].map(tap)).toEqual([false, false, false, false]);
    expect(tap(400)).toBe(true);
    expect(tap(500)).toBe(false);
  });

  it('a slow tap restarts the count', () => {
    const tap = createTapUnlock(3, 1000);
    tap(0);
    tap(500);
    expect(tap(2000)).toBe(false); // too slow: this is tap 1 again
    tap(2100);
    expect(tap(2200)).toBe(true);
  });
});
