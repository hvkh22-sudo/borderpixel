/**
 * React binding for Voice Follow: owns one SpeechEngine + controller pair per
 * script, exposes a throttled snapshot for rendering and collects persisted
 * audio segments (Android) for muxing after the take.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { track } from '../../services/analytics';
import { ExpoSpeechEngine, contextualStringsFor, ensureSpeechPermission, getSpeechCapabilities } from '../../services/speechEngine';
import { PersistedAudio, VoiceFollowController, VoiceFollowSnapshot } from './voiceFollowController';

export interface VoiceFollowApi {
  snapshot: VoiceFollowSnapshot;
  start(opts: { locale: string; persistAudio: boolean }): Promise<boolean>;
  stop(): Promise<PersistedAudio[]>;
  resync(charOffset: number): void;
}

const IDLE: VoiceFollowSnapshot = { status: 'idle', cursor: -1, charOffset: 0, confidence: 0, error: null };

export function useVoiceFollow(script: string): VoiceFollowApi {
  const controller = useMemo(() => new VoiceFollowController(script), [script]);
  const engine = useMemo(() => new ExpoSpeechEngine(), []);
  const [snapshot, setSnapshot] = useState<VoiceFollowSnapshot>(IDLE);
  const persisted = useRef<PersistedAudio[]>([]);
  const active = useRef(false);

  useEffect(() => {
    // Only re-render when what the user sees changes.
    let last = '';
    const unsub = controller.subscribe((s) => {
      const key = `${s.status}|${s.charOffset}|${s.error}`;
      if (key !== last) {
        last = key;
        setSnapshot(s);
      }
    });
    const subs = [
      engine.onResult((e) => controller.handleResult(e, Date.now())),
      engine.onError((code) => {
        controller.handleError(code);
        track({ name: 'voice_follow_failed', code });
      }),
      engine.onEnd(() => controller.handleSessionEnd()),
      engine.onAudioPersisted((a) => persisted.current.push(a)),
    ];
    const tick = setInterval(() => active.current && controller.tick(Date.now()), 250);
    return () => {
      unsub();
      subs.forEach((u) => u());
      clearInterval(tick);
      if (active.current) void engine.stop();
    };
  }, [controller, engine]);

  const start = useCallback(
    async ({ locale, persistAudio }: { locale: string; persistAudio: boolean }) => {
      if (!(await ensureSpeechPermission())) {
        controller.handleError('not-allowed');
        return false;
      }
      persisted.current = [];
      controller.markStarting();
      try {
        await engine.start({
          locale,
          contextualStrings: contextualStringsFor(script),
          onDevice: getSpeechCapabilities().onDevice,
          persistAudio,
        });
        active.current = true;
        controller.markStarted(Date.now());
        track({ name: 'voice_follow_started' });
        return true;
      } catch {
        controller.handleError('unknown');
        return false;
      }
    },
    [controller, engine, script],
  );

  const stop = useCallback(async () => {
    active.current = false;
    await engine.stop();
    controller.stop();
    // audioend for the last file arrives shortly after stop.
    await new Promise((r) => setTimeout(r, 400));
    return [...persisted.current];
  }, [controller, engine]);

  const resync = useCallback((charOffset: number) => controller.resyncToChar(charOffset, Date.now()), [controller]);

  return { snapshot, start, stop, resync };
}
