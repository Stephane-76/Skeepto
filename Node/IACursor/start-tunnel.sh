#!/usr/bin/env bash
# Start cloudflared for Cursor Cloud MCP (foreground — terminal stays open, c'est normal).
# Usage: bash Node/IACursor/start-tunnel.sh
#
# Dans un AUTRE terminal pendant que celui-ci tourne :
#   bash Node/IACursor/patch-tunnel-env.sh
#   cd Node/Server && npm start

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${SKER_PORT:-8000}"
CLOUDFLARED_LOG="${CLOUDFLARED_LOG:-/tmp/sker-cloudflared.log}"

cloudflared_find_https_url() {
  [[ -f "${CLOUDFLARED_LOG}" && -f "${SCRIPT_DIR}/skTunnelProbe.mjs" ]] || return 0
  node "${SCRIPT_DIR}/skTunnelProbe.mjs" --from-log "${CLOUDFLARED_LOG}" 2>/dev/null || true
}

cloudflared_process_running() {
  pgrep -f 'cloudflared tunnel' >/dev/null 2>&1
}

probe_tunnel_url() {
  local url="$1"
  [[ -n "${url}" ]] || return 1
  node "${SCRIPT_DIR}/skTunnelProbe.mjs" "${url}" >/dev/null 2>&1
}

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Installez cloudflared : brew install cloudflared"
  exit 1
fi

local_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:${PORT}/" 2>/dev/null || true)"
if [[ ! "${local_code}" =~ ^2 ]]; then
  echo "⚠ SkServer ne répond pas sur http://127.0.0.1:${PORT}/ (HTTP ${local_code:-000})"
  echo "  Lancez d'abord : cd Node/Server && npm start"
  echo ""
fi

existing_url="$(cloudflared_find_https_url)"
if cloudflared_process_running && [[ -n "${existing_url}" ]] && probe_tunnel_url "${existing_url}"; then
  echo "Tunnel cloudflared déjà actif et joignable : ${existing_url}"
  bash "${SCRIPT_DIR}/patch-tunnel-env.sh" "${existing_url}"
  echo ""
  echo "Ce terminal peut rester ouvert ailleurs — ne tuez pas cloudflared."
  exit 0
fi

if cloudflared_process_running; then
  echo "cloudflared tourne mais le tunnel est mort ou expiré (${existing_url:-URL inconnue})."
  echo "Arrêt et relance propre…"
  pkill -f 'cloudflared tunnel' 2>/dev/null || true
  sleep 1
fi

rm -f "${CLOUDFLARED_LOG}"

echo "════════════════════════════════════════════════════════════"
echo " cloudflared → http://127.0.0.1:${PORT}"
echo " Ce terminal RESTE OUVERT (c'est normal, ne pas Ctrl+C)."
echo " Quand l'URL s'affiche ci-dessous, dans un AUTRE terminal :"
echo "   bash Node/IACursor/patch-tunnel-env.sh"
echo "   cd Node/Server && npm start"
echo "════════════════════════════════════════════════════════════"
echo ""

# Foreground: logs visible; also tee to file for patch-tunnel-env.sh
exec cloudflared tunnel --url "http://127.0.0.1:${PORT}" 2>&1 | tee "${CLOUDFLARED_LOG}"
