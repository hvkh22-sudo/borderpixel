#!/bin/sh
# Runs the screen tour (08) on the emulator in dark mode, then with large text, and copies its screenshots under e2e/ so
# print-failure-shots.sh prints them. Non-gating.
echo "--- Dark mode tour (08)"
adb shell cmd uimode night yes ; sleep 3
mkdir -p e2e/dark
# A configuration change (night mode, font scale) can restart the app slowly: one retry.
maestro test -e SHOT=dark .maestro/08-tour.yaml --test-output-dir e2e/out-dark \
  || { echo "Dark tour: retrying once"; maestro test -e SHOT=dark .maestro/08-tour.yaml --test-output-dir e2e/out-dark; } \
  || echo "Dark tour failed (non-gating)"
find e2e/out-dark screenshots -name '08-dark-*.png' 2>/dev/null | while read -r f; do cp "$f" "e2e/dark/screenshot-$(basename "$f")"; done
adb shell cmd uimode night no
echo "--- Large text tour (08, font scale 1.3)"
adb shell settings put system font_scale 1.3 ; sleep 3
mkdir -p e2e/bigfont
maestro test -e SHOT=bigfont .maestro/08-tour.yaml --test-output-dir e2e/out-bigfont \
  || { echo "Large text tour: retrying once"; maestro test -e SHOT=bigfont .maestro/08-tour.yaml --test-output-dir e2e/out-bigfont; } \
  || echo "Large text tour failed (non-gating)"
find e2e/out-bigfont screenshots -name '08-bigfont-*.png' 2>/dev/null | while read -r f; do cp "$f" "e2e/bigfont/screenshot-$(basename "$f")"; done
adb shell settings put system font_scale 1.0
exit 0
