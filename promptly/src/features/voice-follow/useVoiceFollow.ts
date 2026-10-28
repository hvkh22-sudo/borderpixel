/**
 * React binding for Voice Follow: owns one SpeechEngine + controller pair per
 * script, exposes a throttled snapshot for rendering and collects persisted
 * audio segments (separate-audio takes) for muxing after the take.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { track } from '../../services/analytics';
import { logDiagnostic } from '../../services/diagnosticsLog';
import { ExpoSpeechEngine, contextualStringsFor, ensureSpeechPermission, getSpeechCapabilities } from '../../services/speechEngine';
import { PersistedAudio, VoiceFollowController, VoiceFollowSnapshot } from './voiceFollowController';

export interface VoiceFollowApi {
  snapshot: VoiceFollowSnapshot;
  start(opts: { locale: string; persistAudio: boolean }): Promise<boolean>;
  stop(): Promise<PersistedAudio[]>;
  /** Audio segments persisted so far (fallback when stop() does not settle). */
  collectedAudio(): PersistedAudio[];
  resync(charOffset: number): void;
}

/** Longer than stop()'s wait for the last audioend, so an unmount never drops it. */
const AUDIO_TAIL_MS = 2000;

const IDLE: VoiceFollowSnapshot = { status: 'idle', cursor: -1, charOffset: 0, confidence: 0, error: null };

export function useVoiceFollow(script: string): VoiceFollowApi {
  const controller = useMemo(() => new VoiceFollowController(script), [script]);
  const engine = useMemo(() => new ExpoSpeechEngine(), []);
  const [snapshot, setSnapshot] = useState<VoiceFollowSnapshot>(IDLE);
  const persisted = useRef<PersistedAudio[]>([]);
  const active = useRef(false);
  // Bumped by stop() and unmount: a start() that resolves afterwards must release the mic.
  const generation = useRef(0);

  useEffect(() => {
    const gen = generation;
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
      engine.onError((code, message) => {
        controller.handleError(code);
        logDiagnostic('speech', code, message);
        track({ name: 'voice_follow_failed', code });
      }),
      engine.onEnd(() => controller.handleSessionEnd()),
    ];
    const audioSub = engine.onAudioPersisted((a) => persisted.current.push(a));
    const tick = setInterval(() => active.current && controller.tick(Date.now()), 250);
    return () => {
      unsub();
      subs.forEach((u) => u());
      // The last file's audioend arrives after the recognizer stops; if the screen unmounts mid-take,
      // keep listening briefly so the take being finished still gets the speaker's audio.
      setTimeout(audioSub, AUDIO_TAIL_MS);
      clearInterval(tick);
      gen.current++;
      if (active.current) void engine.stop().catch(() => {});
      active.current = false;
    };
  }, [controller, engine]);

  const start = useCallback(
    async ({ locale, persistAudio }: { locale: string; persistAudio: boolean }) => {
      const gen = ++generation.current;
      let granted = false;
      try {
        granted = await ensureSpeechPermission();
      } catch {
        granted = false;
      }
      if (gen !== generation.current) return false;
      if (!granted) {
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
      } catch {
        controller.handleError('unknown');
        return false;
      }
      if (gen !== generation.current) {
        // Stopped (or unmounted) while the recognizer was starting.
        void engine.stop().catch(() => {});
        return false;
      }
      active.current = true;
      controller.markStarted(Date.now());
      track({ name: 'voice_follow_started' });
      return true;
    },
    [controller, engine, script],
  );

  const stop = useCallback(async () => {
    generation.current++;
    active.current = false;
    try {
      await engine.stop();
    } catch {
      // The recognizer may already be gone; persisted audio is still collected below.
    }
    controller.stop();
    // audioend for the last file arrives shortly after stop.
    await new Promise((r) => setTimeout(r, 400));
    return [...persisted.current];
  }, [controller, engine]);

  const collectedAudio = useCallback(() => [...persisted.current], []);

  const resync = useCallback((charOffset: number) => controller.resyncToChar(charOffset, Date.now()), [controller]);

  return { snapshot, start, stop, collectedAudio, resync };
}
