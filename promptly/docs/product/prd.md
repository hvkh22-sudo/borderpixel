# Product requirements (v1)

Promise: "Write it. Read it naturally. Record it beautifully. Publish it confidently." (provisional)
Positioning and evidence: `docs/research/market-positioning.md`.

Primary activation event: **first completed recording** (secondary: first export).

## Core journey
Open → paste script (or AI draft) → Record → script follows voice / scrolls → stop → preview →
Generate captions → adjust → Export (Photos / share / SRT). No account, no forced paywall.

## Feature register
Status: ✅ verified · 🟡 implemented, device-untested · ⬜ planned

| ID | Feature | User problem | Priority | Dependencies | Complexity | Op. cost | Acceptance criteria (summary) | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| SCR-1 | Script library + editor | Scripts scattered across apps | P0 | SQLite | M | 0 | Create/edit/rename/duplicate/delete(undo)/search/favorite; autosave ≤ 1 s; survives kill | repositories.test | 🟡 |
| SCR-3 | Script folders | Many scripts per series/client get lost in one list | P1 | SQLite (migration 3) | S | 0 | One optional folder per script; create/rename/delete (delete never deletes scripts — they move to No folder); folder chips with counts; move from menu and editor; search/sort inside a folder; empty states; en + he | repositories.test, folders.test | 🟡 |
| SCR-4 | Local script export / backup | Losing scripts when changing phones | P0 (storage) | expo-sharing, expo-file-system | S | 0 | Export one versioned JSON (scripts + versions + folders) via share sheet; import merges without overwriting (new ids on conflict) | backup.test, folders.test | 🟡 export · ⬜ import UI (expo-document-picker not installed) |
| SCR-2 | Word count + duration estimate | "How long is my video?" | P0 | — | S | 0 | Live estimate at chosen WPM | text utils | 🟡 |
| TP-1 | Teleprompter display | Unnatural reading | P0 | Reanimated | M | 0 | Size, spacing, width, reading line, backdrop, mirror, contrast, align; persisted | scrollModel.test | 🟡 |
| TP-2 | Manual + timed scroll | Racing the text | P0 | — | M | 0 | Play/pause/restart/speed ±10 WPM; drag with inertia; UI-thread animation | scrollModel.test | 🟡 |
| REC-1 | Camera recording | Lost takes, poor quality | P0 | VisionCamera | L | 0 | 1080p/30 default; countdown; timer; double-tap safe; stop on background; low-storage guard; file adopted into documents | recordingMachine.test + device | 🟡 |
| REC-2 | Overlay not recorded | Script visible in video | P0 | D3 | — | 0 | Exported file contains no prompter pixels on both platforms | device REC-02 | ⬜ |
| REC-3 | Recovery | Crash loses take | P0 | files | S | 0 | Orphan files re-registered at start; never auto-deleted | device | 🟡 |
| VF-1 | Voice Follow | Traditional prompters ignore pace | P0* | speech, D4 | L | 0 (on-device) | Follows normal speech within ~2 words; holds on silence; no backward jumps on repetition; skip recovery; manual override always | aligner.test (15), controller.test, device VF-* | 🟡 |
| CAP-1 | Auto captions | Extra apps to caption | P0* | speech, promptly-media (Android) | L | 0 | On-device transcript; script-aware spelling; editable text/timing; 3 styles; SRT export | captions.test, device CAP-* | 🟡 |
| CAP-2 | Burn-in export | Need captioned MP4 | P0 | promptly-media | L | 0 | Captioned copy rendered; original untouched; progress + cancel | device | 🟡 (flag off) |
| AI-1 | Script Studio | Writing scripts is hard | P0 | server/ | M | per request | 7 tools; drafts never overwrite without version history; quota shown | studio.test, server tests | 🟡 |
| MON-1 | Free / Pro / Lifetime | Business | P0 | RevenueCat | M | 1% > $2.5k MTR | Gates per pricing-model.md; restore; manage; no overlap purchases | entitlements.test, sandbox PUR-* | 🟡 |
| SET-1 | Settings, privacy, delete-all | Trust | P0 | — | S | 0 | Appearance, speech language, analytics opt-out, delete all data | manual | 🟡 |
| A11Y-1 | Accessibility | Inclusive | P0 | — | M | 0 | Labels/roles, 48 pt targets, adjustable steppers, live regions, reduced motion, Dynamic Type cap 1.8× | manual VoiceOver/TalkBack | 🟡 |
| P1-* | Take mode, mic pre-flight, Bluetooth remote, more caption themes, word highlight, more languages | | P1 | | | | | | ⬜ |
| P2-* | Eye-contact correction, AI editing, filler removal, sync, teams | | P2 | | | | | | ⬜ |

\* P0 subject to the device feasibility gate. If VF-1 or CAP-1 cannot pass on a platform, the feature is
hidden on that platform behind its flag and the founder is asked before changing launch scope.

## Non-goals (v1)
Timeline editor, multi-camera, direct posting to social platforms (system share sheet only), cloud sync,
accounts.
