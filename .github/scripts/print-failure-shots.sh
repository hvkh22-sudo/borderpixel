#!/bin/sh
# Prints small JPEG copies of Maestro failure screenshots as base64 into the job log, so they can be
# read from the log alone (artifact downloads are not reachable from every environment).
# Usage: print-failure-shots.sh <maestro output dir>
DIR="$1"
CONVERT=$(command -v magick || command -v convert || true)
# Maestro names its automatic failure screenshots "screenshot-<status>-<time>-(<flow>).png".
find "$DIR" -name '*.png' \( -path '*screenshot-*' -o -name 'last.png' -o -name 'launch.png' \) | head -n 8 | while read -r f; do
  if [ -n "$CONVERT" ]; then
    "$CONVERT" "$f" -resize 360x -quality 60 /tmp/shot.jpg
  elif command -v sips >/dev/null 2>&1; then
    sips -s format jpeg -s formatOptions 50 -Z 800 "$f" --out /tmp/shot.jpg >/dev/null
  else
    cp "$f" /tmp/shot.jpg
  fi
  echo "=== SHOT-BEGIN $f"
  base64 < /tmp/shot.jpg | tr -d '\n'
  echo
  echo "=== SHOT-END"
done
