#!/usr/bin/env bash
# =============================================================================
# build-unix.sh — Build the Skeepto Linux packages (AppImage and .deb).
#
# Run this on Linux. electron-builder packages the host architecture.
# Assumes the WASM engine was already (re)compiled:
#   browser module → public/SkReactSpreadSheet.{mjs,wasm,wasm.map}
#   Node module    → Node/Server/SkExcelLib.{cjs,wasm}
# `react-scripts build` copies public/ into build/, so the browser .wasm is
# picked up automatically. electron-builder also packs the Node module.
#
# Usage:
#   ./build-unix.sh
# =============================================================================

set -euo pipefail

# Always run from the directory that holds this script (the project root).
cd "$(dirname "$0")"

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

echo "==> Building the React app + packaging the Linux app"
npm run dist:linux

echo "==> Done. Artifacts in dist-electron/:"
ls -lh dist-electron/*.AppImage dist-electron/*.deb 2>/dev/null || true
