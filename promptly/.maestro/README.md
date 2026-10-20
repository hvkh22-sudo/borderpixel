# Promptly end-to-end flows (Maestro)

Automated walk-throughs of the core journeys. They tap through the app and save screenshots;
a person watches and judges what automation cannot (overlay absent from the exported video,
audio/lip sync, Voice Follow quality, caption accuracy, Hebrew layout) using
`docs/testing/founder-checklist-he.md`.

**Status: written, never executed on a device.** Expect to fix a selector or a timeout on the
first run. YAML keys were checked against the Maestro source (`YamlFluentCommand`,
`YamlElementSelector`, `YamlCondition`, `WorkspaceConfig` on `main`, CLI 2.11.0) because
docs.maestro.dev was not reachable from the authoring environment.

## What runs where (read first)

| Flow | Android phone | iPhone (physical) | iOS Simulator |
|---|---|---|---|
| 01 first run, 02 scripts, 06 paywall | yes | **no** | yes |
| 03 record, 04 captions, 05 export | yes | **no** | no (no camera) |
| 07 Hebrew | yes (phone in Hebrew) | **no** | yes (`--device-locale he_IL`) |

Maestro does **not** drive physical iPhones ("Physical iOS devices are not yet supported",
Maestro README). On the iPhone, follow the same steps by hand using the flow files and
`docs/testing/device-poc-runbook.md` as the script.

## Files

```
.maestro/
  config.yaml              # which flows run, order, Hebrew flow excluded by tag
  01-first-run.yaml        # CLEARS APP DATA. onboarding → Home → sample script → setup
  02-script-crud.yaml      # type a script, rename via title, search, folder create/move, delete + undo, cleanup
  03-record-timed.yaml     # camera + permissions, 3 s countdown, ~8 s take, stop, take preview
  04-captions.yaml         # new take → Generate captions → wait → Save (tolerates "unsupported"/errors)
  05-export.yaml           # new take → Save to Photos → Share sheet opened and dismissed
  06-paywall.yaml          # Settings → Subscription → paywall → Restore → Close (never buys)
  07-hebrew-rtl.yaml       # CLEARS APP DATA. Hebrew screenshots; phone must already be in Hebrew
  shared/                  # helpers used with runFlow (launch, onboarding, dialogs, back, record)
```

Elements are found by `testID` (Maestro `id:`), never by English text, except: the folder-delete
alert's "Delete" button (02), the dev launcher, and OS dialogs. A jest test
(`src/__tests__/maestroTestIds.test.ts`) fails if a flow references a testID that no longer
exists in `src/`. The id `maestro-wait-never-present` is deliberate: an optional wait on it is
used as a pause.

## One-time setup (computer)

1. Install Java 17+ and Maestro: `curl -fsSL "https://get.maestro.mobile.dev" | bash`, then
   `maestro --version`.
2. Android phone: enable Developer options → USB debugging, connect by USB, accept the prompt,
   check `adb devices` lists it.
3. Install the **development build** of Promptly on the phone (see
   `docs/testing/device-poc-runbook.md` §2). The app id is the placeholder
   `app.promptly.placeholder` (same on iOS and Android). If it changes in `app.json`, update
   `appId:` in every `.yaml` file here.

## Each run

1. Start Metro for the dev client (phone and computer on the same Wi-Fi):
   ```bash
   cd promptly
   npx expo start --dev-client
   ```
   Leave it running. Open the app on the phone once by hand and confirm it loads the JS bundle.
2. In a second terminal, from `promptly/`:
   ```bash
   maestro test .maestro/                                  # 01–06 in order
   maestro test .maestro/03-record-timed.yaml              # one flow
   maestro test .maestro/07-hebrew-rtl.yaml                # Hebrew (phone set to Hebrew first)
   ```
   If the dev launcher does not find Metro on its own, pass the Metro URL (URL-encoded):
   ```bash
   maestro test -e METRO_URL=http%3A%2F%2F192.168.1.20%3A8081 .maestro/
   ```
   With several devices connected add `--device <id>` (from `adb devices`).
3. Screenshots are written under `screenshots/` relative to where Maestro runs
   (`promptly/screenshots/`; the folder is git-ignored). Maestro also prints a debug folder
   (`~/.maestro/tests/<date>/`) with logs and a screenshot of any failure.
   To keep a video of the screen, use the phone's own screen recorder (do not use
   `maestro record`: by default it renders the video on Maestro's servers).

Notes:
- 01 and 07 wipe Promptly's data on the phone (`clearState`). Scripts and takes inside the app
  are lost; videos already saved to Photos/Gallery are not touched.
- `launchApp` grants all permissions up front (`permissions: all: allow`), so OS dialogs
  normally do not appear. `shared/allow-system-dialogs.yaml` taps them away with
  `optional: true` steps if they do (Android permission controller ids, iOS "Allow"/"OK").
  To test the dialogs themselves, deny or reset permissions in system settings first.
- 03/04/05 each record their own ~8 s take. Read the on-screen text aloud while it records,
  otherwise 04 ends on "We didn’t hear any speech in this take" (screenshot taken, flow still passes).
- 05 saves a real video into Photos/Gallery each run.
- 06 taps Restore only. If the OS asks to sign in to the store it taps Cancel/Not Now.
- iOS back navigation (`shared/go-back.yaml`) taps "Back" or edge-swipes from the left; in a
  Hebrew (RTL) UI on the simulator this may need a manual back tap.

## Hebrew (07)

Maestro has no in-flow locale command; the locale is a device setting
(`maestro start-device --platform ios|android --device-locale he_IL` for simulators/emulators).
On a physical Android phone either switch the phone language to Hebrew, or on Android 13+ try
(unverified for this app, which declares no Android per-app locale list):
```bash
adb shell cmd locale set-app-locales app.promptly.placeholder --locales he-IL
```
Then force-stop and reopen Promptly so the layout flips to right-to-left. Switch back afterwards
(`--locales en-US`, or the phone's language setting).

## Adding a flow

Add a `testID` to the element (it is not visible and changes no behavior), reference it with
`id:`, run `npx jest src/__tests__/maestroTestIds.test.ts`, and name the file `0N-name.yaml`
so `config.yaml` picks it up (add it to `flowsOrder`).
