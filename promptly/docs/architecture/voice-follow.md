# Voice Follow

## Components (independently testable)
1. **Recognition** — `ExpoSpeechEngine` (continuous, interim results, on-device when supported,
   contextual strings from the script, auto-restart on session end).
2. **Alignment** — `ScriptAligner` (pure).
3. **Status / policy** — `VoiceFollowController` (silence → "listening", no progress while speaking
   → "lost", errors keep position).
4. **Scrolling** — `Teleprompter` maps `charOffset` → line → offset; glides with duration scaled by distance.

## Alignment algorithm
- Normalize: NFKD, strip marks, lowercase, drop apostrophes/hyphens, small number words → digits.
- Take the last 8 hypothesis words; search script window [cursor−40, cursor+80].
- Local alignment (Smith–Waterman), match score = 2 × similarity (≥ 0.7, edit-distance based; words
  ≤ 3 chars must match exactly), mismatch/gap −1. Best end cell = last matched script word, penalized
  for trailing unmatched spoken words and distance from cursor.
- Decision:
  - forward ≤ 6 words (+ newly spoken words): accept with ≥ 2 matches (1 at script start);
  - larger forward jump: ≥ 3 matches, ≥ 50% confidence, confirmed on two consecutive updates;
  - backward: ignored if ≤ 3 words or < 5 matches; otherwise confirmed twice;
  - nothing nearby: search the rest of the script with a stricter threshold (skipped paragraphs).
- Manual override (`setCursor`) and tap-to-resync always win.

## Tested scenarios (src/features/voice-follow/__tests__)
Exact reading (≤ 2 words lag, monotonic), first word, recognition errors, silence, repeated phrase
(no backward move), skipped sentence (jump after confirmation), coincidental far match ignored,
restart from earlier passage, repeated phrase in script (nearest wins), empty inputs, Hebrew text,
noisy simulation with utterance resets, final-only bulk results, long-script performance.

## Not yet measured (device)
Recognition-to-scroll latency, accuracy by accent/noise/mic, battery, thermal, long sessions,
Bluetooth mics, other languages. Protocol: `docs/testing/test-plan.md` §3.
