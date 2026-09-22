#!/usr/bin/env bash
# =============================================================================
# build-mac.sh — Build the Skeepto macOS app (.app) and installer (.dmg).
#
# Assumes the WASM engine was already (re)compiled:
#   browser module → public/SkReactSpreadSheet.{mjs,wasm,wasm.map}
#   Node module    → Node/Server/SkExcelLib.{cjs,wasm}
# `react-scripts build` copies public/ into build/, so the browser .wasm is
# picked up automatically. electron-builder also packs the Node module.
#
# Usage:
#   ./build-mac.sh              # build for the host arch (Apple Silicon = arm64)
#   ./build-mac.sh --universal  # build a universal binary (Intel + Apple Silicon)
#   ./build-mac.sh --open       # build, then open the generated .dmg
# (flags can be combined, e.g. ./build-mac.sh --universal --open)
# =============================================================================

set -euo pipefail

# Always run from the directory that holds this script (the project root).
cd "$(dirname "$0")"

UNIVERSAL=0
OPEN_DMG=0
for arg in "$@"; do
  case "$arg" in
    --universal) UNIVERSAL=1 ;;
    --open)      OPEN_DMG=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

echo "==> Checking WASM artifacts"
check_wasm() {
  local path="$1"
  if [[ -f "$path" ]]; then
    echo "    $(ls -lh "$path" | awk '{print $5, $6, $7, $8}')  $path"
  else
    echo "    WARNING: $path not found — did the WASM compile succeed?" >&2
  fi
}
check_wasm "public/SkReactSpreadSheet.wasm"
check_wasm "Node/Server/SkExcelLib.wasm"

echo "==> Building the React app + packaging the macOS app"
if [[ "$UNIVERSAL" -eq 1 ]]; then
  npm run dist:mac:universal
else
  npm run dist:mac
fi

echo "==> Done. Artifacts in dist-electron/:"
ls -lh dist-electron/*.dmg dist-electron/*.zip 2>/dev/null || true

DMG="$(ls -t dist-electron/*.dmg 2>/dev/null | head -n1 || true)"
if [[ -n "$DMG" ]]; then
  echo ""
  echo "DMG: $(pwd)/$DMG"
  if [[ "$OPEN_DMG" -eq 1 ]]; then
    open "$DMG"
  fi
fi
