#!/bin/sh
# Repeats the camera flows; after each round prints any new app crash lines (incl. native
# backtraces) from the running logcat capture. Always exits 0: the output is the result.
ROUNDS=${1:-6}
CRASH='FATAL EXCEPTION|E/AndroidRuntime|Fatal signal|F/DEBUG|Process app.promptly.placeholder .* has died'
seen=0
i=1
while [ "$i" -le "$ROUNDS" ]; do
  for f in 03-record-timed 04-captions 05-export; do
    if maestro test ".maestro/$f.yaml" --test-output-dir "e2e/out-$i" >"e2e/round-$i-$f.log" 2>&1; then
      echo "round $i $f: passed"
    else
      echo "round $i $f: FAILED"; grep -E 'FAILED|Assertion|Exception' "e2e/round-$i-$f.log" | head -5
    fi
  done
  total=$(grep -c -E "$CRASH" e2e/logcat.txt || true)
  if [ "$total" -gt "$seen" ]; then
    echo "--- round $i: new crash lines"
    grep -E "$CRASH" e2e/logcat.txt | tail -n "$((total - seen))" | head -n 200
    seen=$total
  fi
  i=$((i + 1))
done
echo "--- stress done: $seen crash line(s) in total"
exit 0
