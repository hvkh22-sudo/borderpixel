#!/bin/sh
# Runs the screen tour (08) on the emulator in dark mode and copies its screenshots under e2e/ so
# print-failure-shots.sh prints them. Non-gating.
echo "--- Dark mode tour (08)"
adb shell cmd uimode night yes ; sleep 3
mkdir -p e2e/dark
maestro test -e SHOT=dark .maestro/08-tour.yaml --test-output-dir e2e/out-dark || echo "Dark tour failed (non-gating)"
find e2e/out-dark screenshots -name '08-*.png' 2>/dev/null | while read -r f; do cp "$f" "e2e/dark/screenshot-$(basename "$f")"; done
adb shell cmd uimode night no
exit 0
