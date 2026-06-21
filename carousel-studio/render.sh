#!/usr/bin/env bash
# =============================================================================
# CAROUSEL STUDIO — render.sh  (entry point)
# Screenshots every frame of every slide with headless Chrome
# (force-device-scale-factor=1, allow-file-access-from-files) and ffmpeg-encodes
# each slide to its own MP4 at 1080x1350. Robust: low parallelism + retry pass.
#
# This wraps render.js, which drives Chrome over DevTools so frames are
# deterministic and the offline sandbox is handled. It auto-detects Chrome and
# ffmpeg; override with env vars if needed.
#
#   ./render.sh            # full render  -> output/<slide>.mp4
#   ./render.sh --qa       # fast QA      -> output/qa/<slide>.png  (static frames)
#   PAR=3 ./render.sh      # bump parallelism (default 2 = robust)
#
#   CHROME_BIN=/path/to/google-chrome  ./render.sh   # force a Chrome
#   FFMPEG=/path/to/ffmpeg             ./render.sh   # force an ffmpeg
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

# --- dependency checks (be loud and helpful) --------------------------------
command -v node >/dev/null || { echo "ERROR: node is required."; exit 1; }
if [ ! -f slides/manifest.json ]; then
  echo "ERROR: no slides/manifest.json. Run:  node gen.js carousel.json"; exit 1
fi
if [ ! -d node_modules/playwright-core ]; then
  echo "Installing renderer deps (playwright-core, ffmpeg-static)…"
  npm install --no-audit --no-fund playwright-core ffmpeg-static >/dev/null
fi

# --- Chrome detection (informational; render.js does the real detection) ----
detect_chrome() {
  [ -n "${CHROME_BIN:-}" ] && { echo "$CHROME_BIN"; return; }
  for c in google-chrome google-chrome-stable chromium chromium-browser \
           "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    command -v "$c" >/dev/null 2>&1 && { echo "$c"; return; }
  done
  find .chrome -name chrome -type f 2>/dev/null | head -1
}
CH="$(detect_chrome || true)"
if [ -z "$CH" ]; then
  echo "WARNING: no system Chrome found; render.js will use bundled .chrome/ if present."
  echo "         (Install Google Chrome, or set CHROME_BIN, for your own machine.)"
fi

exec node render.js "$@"
