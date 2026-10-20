# Accessibility audit (code review pass)

Scope: `src/components/*`, every screen in `src/app/**`, and the feature components MicCheckSheet,
CaptionStylePicker, CaptionPreview, FolderChips and Sheet. Checked against iOS VoiceOver and Android
TalkBack conventions and WCAG 2.2 AA where it applies to native apps. Out of scope by agreement:
`src/features/teleprompter/Teleprompter.tsx`, `src/features/voice-follow/*`, `modules/*`.

**Status: code-level only.** Nothing below has been checked with VoiceOver or TalkBack on a device. Node
tests (`@testing-library/react-native`) confirm the props are set; they cannot confirm what a screen
reader announces, in what order, or where focus lands.

## Conventions introduced

| Need | How |
| --- | --- |
| Decorative icons / illustration circles | spread `decorative` from `src/components/a11y.ts` (`accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"`) |
| Async status | visible text keeps `accessibilityLiveRegion` (TalkBack); `useAnnounce(message)` from `src/hooks/useAnnounce.ts` announces the same message on iOS, where live regions do nothing. `useAnnounce(msg, 'all')` only when there is no live text (throttled progress, recording start) |
| Brand-hue text | `colors.primaryText` (not `colors.primary`) |
| Small controls | 44 pt visual + `hitSlop` that stays inside the parent (Android ignores slop outside the parent bounds) |
| Toggle rows | the native `Switch` is the element (label = title, hint = subtitle); the row text is hidden so it is not read twice |
| Containers | `radiogroup` views stay non-accessible (making them `accessible` would hide their radios on iOS) |

## Fixed

### Roles, labels, states
- **Library rows** now read as one element: "title, Favorite, ~duration, date, folder", hint "Opens the
  editor", and the row menu is offered as custom actions (Favorite/Remove favorite, Move to folder,
  Duplicate, Delete, More actions). Before, iOS hid the nested "More actions" button inside the row and
  only one generic long-press action existed. Deleting via the action shows the same Undo snackbar.
- **Caption cue rows** were one accessible `Pressable` wrapping a `TextInput` and three buttons, which on
  iOS made the text field and the Split/Merge/Delete buttons unreachable with VoiceOver. The row is now a
  plain container; the timestamp is its own "Play from 0:03" button (48 pt, selected when it is the
  current cue) and the field is labelled "Caption 2, starts at 0:03" (was "Edit 2").
- Caption "Shift all" buttons: "Shift all captions 0.1 seconds earlier/later" (was "Shift all −0.1s").
- Library sort control was labelled "Last edited" (one of its options); now "Sort by".
- Settings speech language: a `✓` character as the row value → `selected` state + hidden checkmark icon.
  `ListRow` gained `selected`, and pressable rows now expose their `value` as `accessibilityValue`
  (Subscription "Free", mic-check verdict).
- Home/Takes take cards: label now includes duration and "Captioned"; Home script cards include duration.
- Paywall: plan radiogroup labelled "Plans"; plan labels include the "Save …" badge; loading spinner labelled.
- Studio: tone chips get a labelled radiogroup and explicit labels; "Compare" exposes `selected`; tool and
  section titles are headers; added words in Compare are underlined as well as green (not colour alone).
- Record screen: record button reports `busy` while starting/stopping; the timer pill is a proper element
  (`accessible`) instead of a label on a non-accessible view; the speed readout reads "150 words/min".
- Headers: EmptyState titles, Help questions, record permission title, sheet titles, overline section
  labels (Section, captions "Style", Studio labels). Overlines keep their uppercase look but get a
  sentence-case `accessibilityLabel` so VoiceOver does not spell them out.
- Decorative icons hidden across Home, Takes, Create, Onboarding, Prepare presets, Paywall, Studio,
  Library search/favourite star, ListRow, Sheet rows, MicCheck verdict, EmptyState.
- CaptionPreview (the caption overlay on the video) is hidden from screen readers: it is a visual mirror
  of the burn-in and would talk over the video; cue text is available in the cue list.

### Touch targets
- Folder chips 40 → 44 pt + slop (52 pt hit area); Studio tone chips 40 → 48 pt; Segmented items keep
  44 pt and add a 4 pt slop inside the track padding (52 pt); caption timestamps are 48 pt buttons.
- Already compliant: IconButton (48), Button (48/58), ListRow (56), Sheet rows (52), Stepper +/− (48),
  presets (56), record button (82).

### Contrast (`src/theme/__tests__/contrast.test.ts`)
Ratios before → after (WCAG AA: 4.5 text, 3 icons/outlines):

| Pair | Before | After | Fix |
| --- | --- | --- | --- |
| Light `primary` as text on background (ghost buttons, Cancel) | 4.26 | 5.38 | new `primaryText` = violet 600 |
| Dark `primary` as text on background / surfaceRaised | 4.30 / 3.85 | 8+ | `primaryText` = violet 300 |
| Light PRO badge (violet on violet 100) | 3.87 | ≥ 4.5 | `primaryText` |
| Light `danger` on background | 3.86 | 5.02 | rec 700 `#C62F3B` |
| Light `success` on white | 2.38 | 4.96 | green 700 `#1C8049` |
| Light `warning` on white | 2.04 | 5.43 | amber 700 `#9A5B00` |
| White label on Record button | 3.25 | 4.80 | `record` = rec 600 `#D92C3A` (camera record button and REC dot keep rec 500) |
| Home hero subtitle (85 % white on violet) | ≈ 3.6 | 4.60 | full `onPrimary` |

The brand violet 500 is unchanged for fills, icons and selection outlines. Dark theme semantic colours
already passed except brand-hue text.

### Live regions and announcements
- Recording: start announced on both platforms; stop + "Saving your take…" (live text on Android,
  announcement on iOS); countdown digits (Android via the overlay's changing label, iOS via announce);
  Voice Follow status and camera notices announced on iOS too. The timer is no longer a live region (it
  updated twice a second and would have been read continuously by TalkBack).
- Export: the percentage text was a polite live region updating on every progress tick; now a
  `progressbar` with a value, plus announcements at 0/25/50/75 %; "Saved"/error announced on iOS.
- Captions: "Generating…" / part n of m / errors announced on iOS; "N captions ready to edit" when done.
- Studio: "Draft ready" when a result arrives; errors announced on iOS. Paywall messages, Library
  "Script deleted", mic check phases and verdict announced on iOS.
- Editor word count / "Saving…" is **no longer** a live region: it changed on every keystroke.

### Focus and modals
- `Sheet`: panel is `accessibilityViewIsModal` with `onAccessibilityEscape` (VoiceOver two-finger scrub
  closes it); focus is sent to the title ~350 ms after the modal shows; the dimmed backdrop is now
  touch-only (it was the first VoiceOver element, a full-screen "Close" button) — every sheet has its
  own Cancel/Done control and Android back closes it.
- Countdown overlay is `accessibilityViewIsModal`, so VoiceOver does not wander behind it.

### Dynamic Type and reduced motion
- `Text` caps scaling at 1.8× app-wide (unchanged). Fixed at large sizes: Button labels shrink/wrap
  instead of overflowing; Segmented labels may wrap to 2 lines; Stepper wraps its +/− control under the
  label; Sheet titles 3 lines and rows 2 lines; Sheet content scrolls (max 92 % height); ListRow values
  shrink instead of pushing the title. Countdown digits opt out of scaling (already 120 pt).
- Intentional `maxFontSizeMultiplier={1}`: caption style samples and CaptionPreview (they mirror the
  burned-in video size).
- `Sheet` slides in normally and fades with Reduce Motion (reanimated `useReducedMotion`). Native stack
  transitions follow the OS setting. Teleprompter already honours Reduce Motion (not changed here).

### RTL
Verified in code: chevrons, Home forward arrow, editor undo/redo and caption shift icons use
`flipInRtl()`; layouts use flex/start/end. Record "restart" (`play-skip-back`) is not flipped — media
transport icons are conventionally not mirrored (Material guidance), whereas the caption shift icons
are; this inconsistency is left for a design decision with a native Hebrew speaker.

## Needs on-device verification
1. VoiceOver/TalkBack read order on Home, Library (rows + chips + snackbar), Editor, Prepare, Record,
   Take, Captions, Export, Studio, Paywall, Settings.
2. Library custom actions appear in the VoiceOver rotor ("Actions") and TalkBack actions menu with the
   right labels; `longpress` is listed once on Android.
3. Sheet focus lands on the title on both platforms (timing may need tuning); escape gesture closes it;
   TalkBack stays inside the sheet.
4. Recording announcements do not collide with the countdown or with Voice Follow speech recognition
   (announcements are spoken aloud and could be picked up by the mic — consider muting them during takes
   if it shows up in testing).
5. Stepper as `adjustable`: swipe up/down on iOS, volume keys/actions on TalkBack.
6. Toggle rows: the hint (subtitle) is read after the switch on both platforms.
7. Large text (iOS AX5 / Android 200 %): Prepare, Paywall footer, Record controls in landscape.
8. Hebrew: new strings in `a11y.*` need native-speaker review with a screen reader.

## Not fixed / follow-ups
- **Input boundaries (WCAG 1.4.11):** text-field borders (`border` token, ≈ 1.2:1) are below 3:1.
  Fields are identified by placeholder and label, but a stronger field outline is a visual design change
  left for design review.
- Record screen text over the live camera (`ink200`, amber Voice Follow status) has no fixed background;
  contrast depends on the scene.
- Teleprompter internals (tap-to-jump, highlight) were not audited (owned by another change).
- Studio Compare: removed words use colour + strike-through, which screen readers do not convey;
  both versions are read in sequence. A spoken summary (e.g. "added: …") is a possible follow-up.
