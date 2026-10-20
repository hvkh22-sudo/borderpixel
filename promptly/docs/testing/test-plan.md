# Test plan

## 0. Automated (run on every change)
`npm run typecheck && npm test` · `npx expo export --platform ios|android` · `cd server && npm test`.

## 1. Technical PoC on devices (release gate — not yet executed)
| ID | Test | Pass criteria |
|---|---|---|
| REC-01 | 60 s 1080p front-camera take | File plays in Photos/Gallery, correct orientation, ~30 fps |
| REC-02 | Overlay absence | Export frame-by-frame review: no prompter text/backdrop in any frame (both platforms) |
| REC-03 | A/V sync | Clap test: audio/video offset ≤ 45 ms (iOS); Android muxed path ≤ 80 ms (adjust after baseline) |
| REC-04 | Interruptions | Incoming call / Siri / app background during take → file finalized, take saved |
| REC-05 | Low storage | < 300 MB free → recording blocked with message; mid-take maxFileSize stop saves file |
| REC-06 | 10-minute take | No crash, file intact, thermal state noted |
| REC-07 | Rotation / orientation metadata | Portrait + landscape takes display correctly |
| REC-08 | Front-camera mirroring | Document whether saved file is mirrored; confirm product choice |
| REC-09 | Mic route change | Plug/unplug wired + Bluetooth mic mid-take: no crash; audio continues |
| MIC-01 | Mic check (setup screen) | iOS + Android, each with built-in, wired, USB-C/Lightning and Bluetooth (AirPods / earbuds) mic: normal speech at arm’s length → “Sounds good”; whisper / phone at 2 m → “Too quiet”; shouting into the mic from 5 cm → “Clipping”; mic covered or muted → “No sound detected”. Input name shown matches the connected mic (note Android USB reports “Unknown device type” but a product name). Bluetooth input shows the earbud-quality note. Live meter moves with the voice. Record the dBFS samples per case and calibrate `DEFAULT_MIC_THRESHOLDS` (initial values; iOS meter = average power, Android = peak). After the check, “Open camera” → the take has full-quality audio from the expected input (camera owns the session; no silent take, no “mic in use” error), and on iOS Voice Follow still works. The temporary clip is gone from the cache directory |
| REC-10 | YouTube preset (landscape) | Rotation lock off, phone sideways: camera controls in trailing column, prompter readable; saved file is 16:9 landscape ~1920×1080 and plays upright in Photos/Gallery (iOS + Android). With rotation lock on, the “Turn your phone sideways” hint shows and the file stays portrait |
| REC-11 | TikTok / Reels / Shorts preset | Saved file is 9:16 portrait ~1080×1920 at ~30 fps; tilting the phone mid-take does not flip the file orientation; reading line sits near the lens; new captions default to the lower safe position |
| REC-12 | Talking head 60 fps preset | Device with 60 fps format records ~60 fps (check metadata); device without it falls back to 30 fps with no error. Android: confirm CameraX picks a 16:9 size for the landscape target (sensor-coordinate handling of `targetResolution`) |
| VF-01 | VF + recording coexist (iOS) | Recording has full-quality audio AND prompter follows speech |
| VF-02 | VF + recording (Android 13/14/15/16) | Video-only + persisted WAV muxed; audio continuous across recognizer restarts |
| VF-03 | Latency | Word spoken → line moves: median measured and recorded (target to set from baseline) |
| VF-04 | Behaviors | Pause holds; repeat no back-jump; skip paragraph recovers; tap-to-resync works |
| VF-05 | Learned speaking rate | After 2+ Voice Follow takes ≥ 10 s, “Your pace” in setup is within ±10 % of words read ÷ time (stopwatch); tap-to-resync jumps do not inflate it; “Use my pace” sets Timed speed; app restart keeps it; Delete all data clears it |
| CAP-01 | Transcribe 60 s take | Captions produced on-device, ≤ 1× real time on recent devices |
| CAP-02 | No speech take | "We didn't hear any speech" shown; no fabricated text |
| CAP-03 | Burn-in | Captioned MP4 matches preview style/position; original unchanged |
| CAP-04 | SRT | Opens in a subtitle editor; timings match |
| PUR-01..12 | Sandbox purchases | monthly, annual, lifetime, cancel, decline, pending (Ask to Buy), expiry, renewal, refund, restore, sub→lifetime, offline after purchase, reinstall |
| AI-01 | Studio happy path | Each tool returns a draft; version history keeps original |
| AI-02 | Quota / offline / provider error | Correct messages; quota not charged on failure |
| A11Y-01 | VoiceOver + TalkBack | Full core journey operable |

## 2. Unit coverage map
aligner (15), voiceFollowController (3), scrollModel (6), captions (16), entitlements (11),
recordingMachine (7), studio (6), repositories (7), i18n (3); server handler/prompts/validation/
entitlements (16).

## 3. Voice Follow measurement protocol
Scripts: 3 lengths (60 / 300 / 1,500 words). Speakers: ≥ 5 incl. non-native accents. Conditions:
quiet, café noise (~60 dBA), AirPods, wired lav, built-in mic. Speech: normal, fast (~190 WPM), slow,
with 3 scripted ad-libs, one skipped paragraph, one repeated sentence. Record screen + log
`VoiceFollowSnapshot` with timestamps; compute: lag in words, false scrolls, backward jumps, recovery
time after skip/silence, battery % per 10 min. Define thresholds from the first baseline run.
