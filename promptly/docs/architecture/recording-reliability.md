# Recording reliability review

Principle: a reliable recording engine matters more than impressive AI. This is an adversarial
review of the recording path (camera screen → recorder → Voice Follow → finalize → storage →
recovery) against VisionCamera 5.2.3 as installed (`node_modules/react-native-vision-camera`:
`src/specs/outputs/{Recorder,CameraVideoOutput}.nitro.ts`, `src/hooks/useCamera.ts`,
`ios/Delegates/VideoDelegate.swift`, `ios/.../HybridVideoRecorder.swift`,
`android/.../HybridVideoRecorder.kt`).

## Structure after the change

- `src/features/recording/recordingSession.ts` — `RecordingSession`, a plain class that owns the
  take lifecycle. Recorder, Voice Follow, finalize, file sizes, free space and clock are injected;
  all races below are unit-tested with fakes (`__tests__/recordingSession.test.ts`).
- `src/features/recording/useRecordingSession.ts` — React binding with production deps
  (`videoOutput.createRecorder`, `finalizeTake`, documents-dir paths). Disposes on unmount.
- `src/app/record/[id].tsx` — maps UI/camera events onto the session; no lifecycle logic left.
- `src/features/recording/orphanRecovery.ts` — single-flight, dedupe-safe orphan registration.
- `recordingMachine.ts` gained a `starting` status (`START_REQUESTED` / `START_ABORTED`).

## Verified VisionCamera facts (from source, not guessed)

| Fact | Where | Consequence |
|---|---|---|
| `onRecordingFinished(path, reason)`; size/duration limits are delivered as *finished* with `max-file-size-reached` / `max-duration-reached` | `Recorder.nitro.ts`, `VideoDelegate.swift`, `HybridVideoRecorder.kt` | Size limit = normal finalize + notice |
| `RecorderSettings.filePath` may be any absolute path; parent dirs are created | `CameraVideoOutput.nitro.ts`, iOS `HybridVideoRecorder.init` | Record straight into documents |
| Default path is the OS temp dir | same | Old code lost a take if the app died mid-take |
| iOS: `Int64(maxFileSize)` | `HybridVideoRecorder.swift` | `Infinity` (unknown free space) would trap → pass `undefined` |
| iOS: any other AVFoundation error at finish → `onRecordingError` (incl. session interrupted, where AVFoundation often still wrote a playable file) | `VideoDelegate.swift` | Salvage the file on error |
| Android: `ERROR_SOURCE_INACTIVE` (Activity stopped) → finished `'stopped'`; other finalize errors → `onRecordingError`; `stopRecording()` throws "Not currently recording!" once finalized | `HybridVideoRecorder.kt` | stop-throws ≠ failure; wait for callback |
| Android: `dispose()` closes the recording | `HybridVideoRecorder.kt` | Unmount finalizes natively too |
| Camera `onError` covers all session/config errors; `onInterruptionStarted(reason)` with reasons incl. other-client mic/camera use, multitasking, system pressure; `onStopped` exists | `useCamera.ts`, `CameraSession.nitro.ts` | Map to stop-and-keep during a take |
| `outputOrientation` is set on the output connection whenever the interface orientation changes | `useCamera.ts`, iOS `HybridCameraVideoOutput` | Mid-take rotation behaviour needs device test REC-07 |

## Findings and fixes

| Scenario | Previous behaviour | Fix | Test / needs device |
|---|---|---|---|
| Stop pressed while `createRecorder` is pending | Ignored (status still `ready`); recording then started anyway with no way to know the user stopped | `starting` status; stop is queued; start is abandoned before the recorder starts | `recordingSession.test` "stop while creating the recorder" |
| Stop pressed while `startRecording` is pending | Ignored; take kept recording | Queued stop runs right after start resolves; take is finalized | "stop while startRecording is pending" |
| Second Record tap while starting | Second `createRecorder` (status was still `ready`) | Single in-flight take; reducer blocks `START_REQUESTED` in `starting` | "ignores a second start", reducer test |
| Duplicate finished callback / error after finish | `finishRecording` could run twice → two DB rows; a late error flipped a saved take to "failed" | First terminal callback wins; later ones ignored | "finalizes only once…" |
| Recorder error mid-take | `FAILED` + "your take was saved" — but the file was in temp and never registered | If the file has bytes it is finalized as `recovered` and opened with an "interrupted" notice; otherwise honest failure | "salvages the file…", "reports a failure…" |
| `stopRecording()` throws (Android, already finalized by size limit) | Immediate `write_failed` while the finished callback was still coming | Grace period (3 s) for the callback, then salvage | "when stopRecording throws…", "a finished callback … wins" |
| Recorder never reports finished after stop | Stuck on "Saving your take…" forever | 15 s watchdog salvages the file; a late callback is ignored (finalize is idempotent per file name) | "salvages when the recorder never reports…" |
| Unmount (Android back) during a take | Recorder left running until native dispose; JS callbacks then `setState`/navigated on an unmounted screen | `dispose()` stops the take; finalize still runs; no UI callbacks/navigation | "unmount while recording…", "unmount during finalize…", "unmount while creating…" |
| Voice Follow start fails after recording started | Exception hit the outer `catch` → `FAILED` while the recorder **kept recording** with no Stop button | VF start isolated; recording unaffected; VF status shows the error | "a Voice Follow start failure never stops the recording" |
| VF start resolves after the take ended (slow permission prompt) | Recognizer started after the take and held the mic | Session stops it again; `useVoiceFollow` uses a generation counter so a stale start releases the engine | "releases the recognizer…" |
| `vf.stop()` hangs | Finalize never ran | 3 s timeout, then finalize with the audio persisted so far (`collectedAudio()`) | "does not let a hanging Voice Follow stop block finalizing" |
| Final recognizer result after `vf.stop()` | `stop()` lets the recognizer deliver a last result; it moved the cursor and set status back to `speaking`/`finished` after the take | Controller ignores results (and late errors) while `idle` | `voiceFollowController.test` "after stop" |
| Late `end` from a stopped recognizer session (quick retake, Android) | Triggered a second `startNative()` while the new session ran → busy/`unknown` error | Engine counts `end` events owed by stopped sessions; only the current session's end restarts | `speechEngine.test` |
| Recorder temp path vs documents dir | Temp dir; app killed mid-take = take lost (orphan recovery only scans documents) | Recorder writes `recordings/take_<uuid>.mp4`; finalize registers in place (no copy) | `finalizeTake.test` "in place"; **device**: kill app mid-take → recovered on launch |
| finalize failure paths | Copy-then-delete already safe; muxed output written directly into recordings dir | Mux writes to cache `scratch/`, moved into place only when complete; raw deleted only after the muxed file is in place; DB failure leaves the file for recovery; source never deleted on copy failure | `finalizeTake.test` (copy fail, DB fail, mux fail, move fail) |
| Android separate-audio WAVs | Preserved on mux failure (copied); originals left in cache; deleted on success | Unchanged on success; on failure the cache original is deleted only after the documents copy is verified | `finalizeTake.test` |
| Android VF take with zero audio segments | Saved as video-only silently | Flagged `audioMergeFailed` → existing take-screen notice | `finalizeTake.test` "flags a video-only take" |
| Max file size reached | Finalized but no explanation | Finalized normally; take screen shows `record.savedStorageFull` | "finalizes normally with a notice…"; **device** |
| Free space unknown (`availableDiskSpace` throws → Infinity) | `maxFileSize: Infinity` → iOS `Int64(Double)` trap | `recorderMaxFileSize()` returns `undefined` for non-finite values | reducer + session tests |
| Low storage during take | Size limit only (kept) | Kept; plus the notice above | — |
| Orphan recovery registering twice | StrictMode double effect ran two loops concurrently → duplicates; a second run overwrote the banner count with 0; half-written mux output looked like a take | Single-flight; dedupe; muxed twin preferred over raw; mux never half-written in recordings dir; banner count only set when > 0 | `orphanRecovery.test` |
| Phone call / Siri (`onInterruptionStarted`) | Stop, but the notice was lost on navigation to the take | Stop and keep; take screen shows `record.savedInterrupted` | "an interruption…"; **device** REC interruption tests |
| App background | Stopped the take (kept); a running countdown kept ticking and could start recording on return | `'background'` only (not `'inactive'`) stops; also cancels a countdown | "an interruption cancels a countdown…"; **device** |
| Camera `onError` during a take (e.g. permission revoked while backgrounded, media services reset) | `camera_unavailable` (unrecoverable) and the take was abandoned | During a take: stop and keep the file (recorder reports finished or error → salvage). Outside a take: unchanged | "a camera error during a take…"; **device**. Note: iOS and Android normally terminate the app when a permission is revoked — the take is then recovered on next launch because it is now in documents |
| Retry after a recoverable failure | `RETRY` → `preparing`, waiting for `onStarted`, which a running camera never re-fires → stuck | Session tracks `onStarted`/`onStopped`; retry/prepare go straight to `ready` when the camera runs | "keeps the file and reports write_failed… retry works" |
| Flip camera mid-take | Disabled while busy | Unchanged; `starting` counts as busy | — |
| Keep-awake, timers, listeners | `useKeepAwake` for the screen; timers cleaned | Unchanged; script-load and bootstrap async results no longer set state after unmount; purchases listener released if unmounted mid-fetch | review |

## Needs device verification

- Partial-file playability after a kill / interruption (iOS `.mp4` without a finished `moov`
  atom may be unreadable; it is still registered as `recovered` so the user decides).
- iOS session interruption: whether VisionCamera reports *finished* or *error* (either is handled).
- Android `ERROR_INSUFFICIENT_STORAGE` file validity; size-limit notice end-to-end.
- Mid-take rotation with `orientationSource="interface"` (REC-07).
- Back gesture/hardware back during a take: the take is saved headlessly and appears in the
  library; the screen does not block navigation (possible UX follow-up).
- Voice Follow permission prompt appearing mid-take on first use (start is best effort; requesting
  speech permission before the take would be a UX change, not made here).
