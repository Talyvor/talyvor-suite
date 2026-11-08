#!/usr/bin/env bash
# B57.79 — rebuild the logo kit from build/logo.py and copy the files this repo serves. Every PNG and ICO
# comes from export.py, never by hand. Needs: pip install fonttools uharfbuzz scipy numpy pillow pyclipper,
# and playwright where node can find it (npm i playwright). apps/web/src/logoSwap.test.ts checks the copies.
set -euo pipefail
kit=$(cd "$(dirname "$0")/.." && pwd)
root=$(cd "$kit/../.." && pwd)
out=$(mktemp -d)
python3 "$kit/build/export.py" "$out"
python3 "$kit/build/check_identical.py" "$out/svg"

cp "$out"/svg/*.svg "$kit/svg/"
web="$root/apps/web/public"
for f in "$web"/brand/logo/*.svg; do cp "$out/svg/$(basename "$f")" "$f"; done
cp "$out"/svg/talyvor-symbol-small-on-{dark,light}.svg "$root/apps/bff/brand/"
cp "$out"/png/favicon/favicon.{ico,svg} "$web/"
cp "$out"/png/app-icon/{apple-touch-icon,icon-192,icon-512,icon-maskable-512}.png "$web/"
cp "$out/png/social/og-image-dark-1200x630.png" "$web/og-image.png"
echo "logo kit rebuilt; the full set of PNGs is in $out"
