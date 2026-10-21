# Store screenshots: raw captures → store-ready images

`frame.py` turns raw device screenshots into framed marketing images (brand violet gradient,
headline + subline on top, the screenshot in a rounded device frame with a soft shadow) for
every locale and store size, plus the Google Play feature graphic. Offline, Python 3 + Pillow only.

> **Final store screenshots must be real captures of the app.** The two images in `sample/` are
> synthetic placeholders labelled "SAMPLE — replace with real screenshot". They exist only to
> demo the pipeline and must never be uploaded. Both stores reject screenshots that misrepresent
> the app; do not mock up screens that the app does not show.

## 1. Collect screenshots

Name the files exactly as in `manifest.json` (`01-camera-prompter.png` … `06-export.png`, the
6 shots planned in `docs/launch/store-listing-draft.md`) and put them in one folder per
platform/locale, e.g. `~/promptly-shots/ios-en/`.

- **Maestro (Android, iOS Simulator):** flows save screenshots with `takeScreenshot` into
  `promptly/screenshots/` (see `.maestro/README.md`). Copy the relevant ones and rename them.
  `07-hebrew-rtl.yaml` produces the Hebrew screens.
- **By hand (physical iPhone, or any phone):** take a normal screenshot (iPhone: side + volume up;
  Android: power + volume down) and AirDrop/USB them over. Use the largest phone available:
  the script scales the capture, it cannot add detail, so upscaling from a small phone looks soft.
- Before capturing: clean status bar (full battery, no notifications, Wi-Fi on), realistic but
  non-personal script text, light or dark theme consistently across all 6.
- Any aspect ratio works; the frame follows the capture's shape.

## 2. Run

From `promptly/`:

```bash
python3 scripts/store-screenshots/frame.py --input ~/promptly-shots/ios-en --locales en
python3 scripts/store-screenshots/frame.py --input ~/promptly-shots/ios-he --locales he
# subset of sizes, custom manifest/output:
python3 scripts/store-screenshots/frame.py --input DIR --sizes ios-6.9 play-phone --out /tmp/out
# demo with the synthetic samples (regenerate them with --make-samples):
python3 scripts/store-screenshots/frame.py --input scripts/store-screenshots/sample
```

Output (git-ignored): `store-assets/out/<locale>/<size>/NN.png`, `NN` = position in the
manifest, and `store-assets/out/<locale>/play-feature/feature-graphic.png`. Missing input files
are skipped with a message, so you can run it as soon as some captures exist. Look at every
output before uploading.

Edit headlines in `manifest.json`. Keep copy honest: no ratings, awards, download counts, "#1",
or features the build does not have. `claims_to_verify_before_upload` lists what still needs
checking on devices.

## Sizes (verified 2026-10-21)

| Key | Pixels | Source |
|---|---|---|
| `ios-6.9` | 1320 × 2868 | Apple "Screenshot specifications" (App Store Connect help): iPhone Dynamic Island large display; also accepts 1290 × 2796, 1260 × 2736 |
| `ios-6.5` | 1284 × 2778 | Same page, iPhone Face ID large display (also 1242 × 2688). "Required if app runs on iPhone and screenshots for [6.9"] aren't provided" |
| `ios-6.1` | 1206 × 2622 | Same page. Its summary of required sizes now reads "iPhone: At least one screenshot for iPhone with Dynamic Island (medium display)"; also accepts 1179 × 2556. Generated so this is covered either way |
| `play-phone` | 1080 × 1920 | Google Play phone screenshots, 9:16. Google's help page (support.google.com) was **not reachable** from the authoring environment; secondary sources give 320–3840 px per side, aspect between 1:1 and 2:1 (16:9/9:16 recommended, ≥ 1080 px for promotion), up to 8 per device type. Re-check in Play Console when uploading |
| feature graphic | 1024 × 500 | Google Play feature graphic (same caveat; JPEG or 24-bit PNG, no alpha) |

Apple: PNG/JPEG, no alpha channel, up to 10 per size. All outputs are RGB PNG (no alpha).
iPad sizes are not generated (the app is iPhone-first); add an entry to `SIZES` if needed.

## Hebrew / RTL

For `he` the text block is right-aligned and laid out right-to-left. Fonts: Inter (Latin, if
installed) or DejaVu Sans; Hebrew uses FreeSans or DejaVu Sans (Inter has no Hebrew glyphs).
The script prints whether Pillow has **libraqm**:

- **yes** (this environment): full Unicode bidi and shaping, mixed text like "AI" or "SRT" is correct.
- **no**: a simple fallback reorders each line into visual order (RTL runs reversed, Latin/digit
  runs kept left-to-right). It handles the manifest's copy, but it is not a full bidi
  implementation: no bracket mirroring, no nested levels, and punctuation between Latin words
  inside Hebrew may land on the wrong side. Check Hebrew outputs by eye; install Pillow with
  libraqm (`apt install libraqm0` / `brew install libraqm`) for production renders.
  Preview the fallback with `PROMPTLY_NO_RAQM=1`.

The product name "Promptly" (working name, not final) stays Latin in the Hebrew feature graphic.
