# Device PoC runbook (first build on a real phone)

Goal: run test-plan §1 (REC-01..05, VF-01..04, CAP-01) on one iPhone and one Android 13+ phone.

## 1. Accounts (founder)
- Expo account (free) — `npx eas-cli@latest login`
- iOS: Apple Developer Program membership ($99/yr — approval) for installing on a device
- Android: none needed for an internal APK

## 2. Build a development client (cloud, no Mac required)
```bash
cd promptly
npx eas-cli@latest init                    # links the project, writes the EAS projectId
npx eas-cli@latest device:create           # iOS only: register the test iPhone (opens a link on the phone)
npx eas-cli@latest build --profile development --platform android
npx eas-cli@latest build --profile development --platform ios
```
Install from the links EAS prints. The `development` profile turns caption burn-in on
(`EXPO_PUBLIC_FLAG_BURN_IN=on`) so the native module is exercised.

Expected first-build risk: `modules/promptly-media` has never been compiled. If the build fails in
that module, send the build log; the rest of the app does not depend on it at compile time except
through autolinking (temporarily removing `modules/promptly-media` unblocks the rest).

## 3. Run the app
```bash
npx expo start --dev-client     # phone and computer on the same network, or use --tunnel
```

## 4. Test order (stop at the first failure and report)
1. REC-01 record 60 s (Timed mode) → play in Takes.
2. REC-02 export to Photos → scrub the file: **no script text visible**.
3. REC-03 clap test: clap on camera at start and end; check sync in the exported file.
4. VF-01/02 Voice Follow take: script follows; resulting file has full audio.
5. VF-04 pause / repeat / skip a paragraph / tap a line.
6. CAP-01 Add captions → Generate → Save → Export with burn-in + SRT.
7. REC-04 background the app mid-take → take still saved.

Record results in `device-matrix.md` (device, OS, pass/fail, notes, screen recording link).

## 4a. Diagnostics screen (attach to every failure report)
Open it either way:
- **Settings → tap the “Version …” line at the bottom 5 times quickly** (within ~1.5 s per tap), or
- deep link `promptly://settings/diagnostics` (e.g. `npx uri-scheme open promptly://settings/diagnostics --ios`
  / `--android`, or paste it into Safari / Chrome on the phone).

It shows app version/build, OS, recognizer facts (available, on-device, can save audio), whether the
native media module is in the build, Android API level, each feature's support decision with its
reason, the speech languages the recognizer reports, flags (build vs. effective), whether purchases
and the AI server address are configured, and the last 30 failures (recording, speech, captions
transcription, export, audio merge — codes and short messages only).

**Copy report** puts a plain-text report on the clipboard (no scripts, transcripts, file names or
ids). Paste it into the message to Claude together with the failing test id.

Test settings on that screen (per device, kept across launches, “Reset test settings” undoes them):
- **iOS Voice Follow audio**: Default (build value, `EXPO_PUBLIC_IOS_VF_AUDIO`, default `shared`) /
  Shared / Separate.
- **Burn-in captions**: Default / On / Off (overrides `EXPO_PUBLIC_FLAG_BURN_IN`).
- **Send integrity headers**: off sends AI requests without App Attest / Play Integrity headers, to
  check the server's `INTEGRITY_MODE` handling.

### If VF-01 fails on iOS (silent/broken audio or recording stops while Voice Follow runs)
1. Note the symptom, then Diagnostics → **Copy report** (the recent errors usually show it).
2. Diagnostics → iOS Voice Follow audio → **Separate**. The *Voice Follow audio* row must now read
   “Recorded separately, merged after the take”. If it says the native media module is needed,
   the build lacks `promptly-media` and the fallback cannot run.
3. Record the VF-01 take again. The camera now records video only, the recognizer owns the mic and
   saves WAV, and the take is merged (AVFoundation, AAC in .mp4) while “Finalizing…” shows —
   this re-encodes the video, so expect a few seconds per minute of video (measure it: **VF-01b**).
4. Check: the take has full audio, clap-test sync (REC-03) is within ±1 frame of the video, and
   the take screen shows no “audio issue” notice. If the merge failed, the video is kept and the
   WAVs are saved next to it (`*_audio_N.wav`); the report shows `mux mux_failed_ios — …`.
5. Report both results. If *Separate* passes and *Shared* fails, the next build sets
   `EXPO_PUBLIC_IOS_VF_AUDIO=separate` in `eas.json` (DECISIONS D4).

## 5. Automated flows (Maestro)
`promptly/.maestro/` holds Maestro flows for the core journeys (first run, scripts, Timed
recording, captions, export, paywall, Hebrew). With Metro running (`npx expo start --dev-client`),
run `maestro test .maestro/` from `promptly/` against the development build; setup, per-flow notes
and limits are in `.maestro/README.md`. The flows tap through the app and save screenshots under
`promptly/screenshots/`; they do not judge video content. Maestro drives Android phones,
emulators and the iOS Simulator, **not physical iPhones**: on the iPhone, do the same steps by
hand. Not yet executed on any device.

What a person must still judge on each phone is in `founder-checklist-he.md` (Hebrew): overlay
absent from the exported file, clap-test sync, Voice Follow behaviour, caption accuracy, Hebrew
screens.
