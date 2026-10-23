#!/bin/sh
# Runs the Hebrew / RTL flow (07) on the emulator with the system language set to Hebrew, then copies
# its screenshots under e2e/ so print-failure-shots.sh prints them. Non-gating.
echo "--- Hebrew / RTL (07)"
adb root >/dev/null 2>&1 ; sleep 3
# A font-scale change earlier in the job saves the configuration, including its en-US locale list, to
# system settings; that list wins over persist.sys.locale on restart, so set both.
adb shell settings put system system_locales he-IL
adb shell "setprop persist.sys.locale he-IL; setprop ctl.restart zygote"
sleep 20 ; adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ]; do sleep 3; done
sleep 10 ; adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1
echo "system locale: $(adb shell getprop persist.sys.locale)"
# The first launch after the zygote restart can be slow enough to miss launch.yaml's assert, leaving the
# launcher on screen: warm the app up once, and give the flow one retry.
adb shell monkey -p app.promptly.placeholder -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 ; sleep 15
mkdir -p e2e/he
if ! maestro test .maestro/07-hebrew-rtl.yaml --test-output-dir e2e/out-he \
  && ! { echo "Hebrew flow: retrying once"; maestro test .maestro/07-hebrew-rtl.yaml --test-output-dir e2e/out-he; }; then
  echo "Hebrew flow failed (non-gating); screen at failure:"
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb shell cat /sdcard/ui.xml | grep -o -E 'text="[^"]+"' | head -40
  adb exec-out screencap -p > e2e/he/screenshot-he-failure.png
fi
find e2e/out-he screenshots -name '07-*.png' 2>/dev/null | while read -r f; do cp "$f" "e2e/he/screenshot-$(basename "$f")"; done
exit 0
