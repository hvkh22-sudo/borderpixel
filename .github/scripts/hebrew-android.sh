#!/bin/sh
# Runs the Hebrew / RTL flow (07) on the emulator with the system language set to Hebrew, then copies
# its screenshots under e2e/ so print-failure-shots.sh prints them. Non-gating.
echo "--- Hebrew / RTL (07)"
adb root >/dev/null 2>&1 ; sleep 3
adb shell "setprop persist.sys.locale he-IL; setprop ctl.restart zygote"
sleep 20 ; adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ]; do sleep 3; done
sleep 10 ; adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1
echo "system locale: $(adb shell getprop persist.sys.locale)"
maestro test .maestro/07-hebrew-rtl.yaml --test-output-dir e2e/out-he || echo "Hebrew flow failed (non-gating)"
mkdir -p e2e/he
for f in screenshots/07-*.png; do [ -f "$f" ] && cp "$f" "e2e/he/screenshot-$(basename "$f")"; done
exit 0
