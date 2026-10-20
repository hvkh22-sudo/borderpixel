# Design system

Source of truth: `src/theme/tokens.ts`, components in `src/components/`.

## Principles
Calm, fast, one obvious next action per screen ("Create a video" on Home, "Record" in the editor,
"Open camera" in setup, "Export" on preview). Progressive disclosure: advanced display options live in
the setup screen, not the camera.

## Color
Ink neutrals (ink950 → ink50), one brand accent **violet 500 #6D5EF5**, and the rec reds used
only for recording state and the Record action (**rec 500 #FF4D5A** for the camera record button and
REC dot; **rec 600 #D92C3A** behind the white "Record"/"Open camera" label so it meets 4.5:1).
Semantic tokens (`background`, `surface`, `surfaceRaised`, `border`, `text`, `textMuted`, `primary`,
`primarySoft`, `primaryText`, `record`, `success`, `warning`, `danger`) have light and dark values;
Appearance setting: system / light / dark. The camera screen is always dark regardless of theme.
- `primary` is for fills, icons and outlines; **text in the brand hue uses `primaryText`** (violet 600 light /
  violet 300 dark), because violet 500 is only 4.1–4.3:1 as text on the backgrounds.
- Light `success` / `warning` / `danger` use the 700 shades (green, amber, rec): the 500s are 2.0–2.4:1 on white.
- `src/theme/__tests__/contrast.test.ts` checks every rendered text/background pair (≥ 4.5:1) and
  icon/outline pair (≥ 3:1) in both themes; add a pair there when introducing a new combination.

## Type
display 32/38 800 · title 22/28 700 · headline 17/22 600 · body 16/23 · callout 15/20 500 ·
caption 13/17 500 · overline 11/14 700 caps. System fonts. Dynamic Type honored up to 1.8×
(prompter text uses its own size control and ignores system scaling).

## Spacing, shape, touch
Spacing 2/4/8/12/16/24/32/48. Radius 8/12/16/24/pill. Minimum touch target 48 pt (controls drawn smaller,
like 44 pt chips and segments, add `hitSlop` inside their container to reach it).

## Components
Text, Button (primary/secondary/ghost/danger/record; lg size; haptic), IconButton, Screen (safe area,
keyboard avoiding, sticky footer), Card, Section, ListRow (toggle/value/chevron), Segmented (radio
semantics), Stepper (accessibilityRole adjustable with increment/decrement actions), EmptyState, ProBadge.

## States
Empty (Home first run with sample script, Library, Takes), loading (bootstrap spinner, caption progress,
export progress bar), error (inline text with live regions, retry buttons), success (export).

## Motion
150/220/320 ms; prompter glide 220–700 ms by distance; Reduced Motion → instant jumps.

## Accessibility guidelines
Every control has a label (and hint where useful); headers marked; decorative icons hidden with
`decorative` (`src/components/a11y.ts`); list rows are one element with their menu as
`accessibilityActions`; status changes use `accessibilityLiveRegion` on the visible text (TalkBack) plus
`useAnnounce` (`src/hooks/useAnnounce.ts`, VoiceOver); sheets are `accessibilityViewIsModal` and focus
their title; the prompter text is exposed as one text element; no information conveyed by color alone
(Pro badge has text). Full audit: `docs/design/accessibility-audit.md`.

## Localization & RTL
- UI strings: `src/localization/en.ts` (source) and `he.ts` (Hebrew), typed as `Strings` so a missing key
  fails typecheck; a test also checks every key path and placeholder. The UI language comes from the
  device (`getLocales()`); `iw` is treated as `he`.
- **UI language ≠ speech/caption/AI language.** A Hebrew UI does not imply Hebrew Voice Follow, captions
  or AI drafts; those follow the speech-language setting and recognizer/model support.
- Layout mirroring: `expo-localization` plugin with `supportsRTL: true` (Android `supportsRtl`, iOS RTL
  allowed) and `supportedLocales.ios: [en, he]` so iOS resolves the app's localization to Hebrew.
  `syncLayoutDirection()` aligns `I18nManager` with the UI language at start-up; changes apply on the
  next launch (no forced reload).
- Use `start`/`end` (`paddingStart`, `marginEnd`) instead of left/right; flex rows mirror automatically.
  Direction-bearing icons (chevrons, forward arrows, undo/redo, rewind/forward) use `flipInRtl()`.
- Script text (prompter, editor, caption cues) follows the **script's content direction**, not the UI
  (`detectDirection`, first strong character). The prompter's "Start" alignment means the script's
  start edge.
- Hebrew UI must not be marketed (store listing, screenshots) until a native speaker has reviewed it
  on device. Permission prompts (Info.plist / Android strings) are not yet localized.

## User journeys
1. First run: Onboarding → Home (empty) → Try sample → Setup → Camera → Take → Export.
2. Paste flow: Home → Create sheet → Paste → Editor → Record → Setup → Camera.
3. AI flow: Create → Write with AI → Studio (generate) → Editor → Record.
4. Caption flow: Take → Add captions → Generate → edit/style → Save → Export (burn-in/SRT).
5. Upgrade: gated action (Voice Follow after trial, premium caption style) → Paywall → purchase → back.

## Not done yet
Original icon/illustrations (template icons still in assets/), on-device visual QA, screenshots.
