# Design system

Source of truth: `src/theme/tokens.ts`, components in `src/components/`.

## Principles
Calm, fast, one obvious next action per screen ("Create a video" on Home, "Record" in the editor,
"Open camera" in setup, "Export" on preview). Progressive disclosure: advanced display options live in
the setup screen, not the camera.

## Color
Ink neutrals (ink950 → ink50), one brand accent **violet 500 #6D5EF5**, and **rec 500 #FF4D5A** used
only for recording state and the Record action. Semantic tokens (`background`, `surface`,
`surfaceRaised`, `border`, `text`, `textMuted`, `primary`, `primarySoft`, `record`, `success`,
`warning`, `danger`) have light and dark values; Appearance setting: system / light / dark.
The camera screen is always dark regardless of theme.

## Type
display 32/38 800 · title 22/28 700 · headline 17/22 600 · body 16/23 · callout 15/20 500 ·
caption 13/17 500 · overline 11/14 700 caps. System fonts. Dynamic Type honored up to 1.8×
(prompter text uses its own size control and ignores system scaling).

## Spacing, shape, touch
Spacing 2/4/8/12/16/24/32/48. Radius 8/12/16/24/pill. Minimum touch target 48 pt.

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
Every control has a label (and hint where useful); headers marked; status changes announced via
`accessibilityLiveRegion`; the prompter text is exposed as one text element; no information conveyed
by color alone (Pro badge has text).

## User journeys
1. First run: Onboarding → Home (empty) → Try sample → Setup → Camera → Take → Export.
2. Paste flow: Home → Create sheet → Paste → Editor → Record → Setup → Camera.
3. AI flow: Create → Write with AI → Studio (generate) → Editor → Record.
4. Caption flow: Take → Add captions → Generate → edit/style → Save → Export (burn-in/SRT).
5. Upgrade: gated action (Voice Follow after trial, premium caption style) → Paywall → purchase → back.

## Not done yet
Original icon/illustrations (template icons still in assets/), on-device visual QA, screenshots.
