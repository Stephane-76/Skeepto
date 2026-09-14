#!/usr/bin/env bash
# start-ai-cursor.sh — SkServer + Cursor Cloud agent (MCP spreadsheet tools)
#
# All-in-one: cloudflared (background), SK_MCP_PUBLIC_URL patch, SkServer.
#
# Node/IACursor/ companions:
#   start-tunnel.sh     — foreground cloudflared (dedicated terminal)
#   patch-tunnel-env.sh — probe + write .env (called here after SkServer is up)
#   skTunnelProbe.mjs   — DNS (1.1.1.1/8.8.8.8) + HTTPS probe
#   Test.sh             — smoke test (login, spreadsheet/call, /ai/ask)
#
# Env:
#   SK_TUNNEL_AUTO=1    — auto cloudflared + patch .env (default)
#   SK_TUNNEL_AUTO=0    — warn only, start SkServer without fixing tunnel
#   SKER_PORT=8000
#   CLOUDFLARED_LOG=/tmp/sker-cloudflared.log
#   SKER_ENV_FILE       — override .env path
#
# Browser: Actualiser (AI panel) + Cmd+Shift+R (serve from build/).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
IA_DIR="${ROOT}/Node/IACursor"
PATCH_TUNNEL="${IA_DIR}/patch-tunnel-env.sh"
PROBE="${IA_DIR}/skTunnelProbe.mjs"
PORT="${SKER_PORT:-8000}"
CLOUDFLARED_LOG="${CLOUDFLARED_LOG:-/tmp/sker-cloudflared.log}"
SK_TUNNEL_AUTO="${SK_TUNNEL_AUTO:-1}"

cd "${SCRIPT_DIR}"
export SK_AI_PROVIDER=cursor

SERVER_PID=""

# Same rule as run-with-env.mjs: Node/Server/.env wins over sker-app/.env
resolve_server_env() {
  if [[ -n "${SKER_ENV_FILE:-}" ]]; then
    printf '%s\n' "${SKER_ENV_FILE}"
    return 0
  fi
  if [[ -f "${SCRIPT_DIR}/.env" ]]; then
    printf '%s\n' "${SCRIPT_DIR}/.env"
  elif [[ -f "${ROOT}/.env" ]]; then
    printf '%s\n' "${ROOT}/.env"
  else
    printf '%s\n' "${SCRIPT_DIR}/.env"
  fi
}

SERVER_ENV="$(resolve_server_env)"

env_var_from_file() {
  local key="$1"
  local file="$2"
  [[ -f "${file}" ]] || return 1
  grep -E "^[[:space:]]*${key}=" "${file}" 2>/dev/null \
    | tail -1 \
    | sed -E "s/^[[:space:]]*${key}=//" \
    | sed -E 's/[[:space:]]+$//'
}

cloudflared_installed() {
  command -v cloudflared >/dev/null 2>&1
}

cloudflared_find_https_url() {
  [[ -f "${CLOUDFLARED_LOG}" && -f "${PROBE}" ]] || return 0
  node "${PROBE}" --from-log "${CLOUDFLARED_LOG}" 2>/dev/null || true
}

cloudflared_log_quick_tunnel_failed() {
  [[ -f "${CLOUDFLARED_LOG}" ]] || return 1
  grep -q 'failed to request quick Tunnel' "${CLOUDFLARED_LOG}" 2>/dev/null
}

cloudflared_process_running() {
  pgrep -f 'cloudflared tunnel' >/dev/null 2>&1
}

probe_tunnel_url() {
  local url="$1"
  [[ -n "${url}" && -f "${PROBE}" ]] || return 1
  node "${PROBE}" "${url}" >/dev/null 2>&1
}

wait_for_tunnel_probe() {
  local url="$1"
  local tries="${2:-24}"
  local i
  [[ -n "${url}" ]] || return 1
  for ((i = 1; i <= tries; i++)); do
    if probe_tunnel_url "${url}"; then
      return 0
    fi
    if [[ "${i}" -lt "${tries}" ]]; then
      echo "  … probe tunnel ${i}/${tries} (DNS / propagation trycloudflare)…"
      sleep 5
    fi
  done
  return 1
}

wait_for_local_server() {
  local tries="${1:-60}"
  local i code
  for ((i = 1; i <= tries; i++)); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${PORT}/" 2>/dev/null || echo 000)"
    if [[ "${code}" =~ ^2 ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_cloudflared_url() {
  local tries="${1:-60}"
  local i url
  for ((i = 1; i <= tries; i++)); do
    url="$(cloudflared_find_https_url)"
    if [[ -n "${url}" ]]; then
      printf '%s\n' "${url}"
      return 0
    fi
    # Error logs contain https://api.trycloudflare.com — that is not a tunnel URL.
    if cloudflared_log_quick_tunnel_failed && ! cloudflared_process_running; then
      return 1
    fi
    sleep 1
  done
  return 1
}

start_cloudflared_background() {
  echo "  cloudflared → http://127.0.0.1:${PORT} (background, logs ${CLOUDFLARED_LOG})"
  nohup cloudflared tunnel --url "http://127.0.0.1:${PORT}" >>"${CLOUDFLARED_LOG}" 2>&1 &
}

print_tunnel_manual_steps() {
  echo ""
  echo "Procédure manuelle :"
  echo "  1. Terminal 1 : bash ${IA_DIR}/start-tunnel.sh"
  echo "  2. Terminal 2 : bash ${PATCH_TUNNEL}              # « Tunnel OK »"
  echo "  3. Terminal 2 : bash ${SCRIPT_DIR}/start-ai-cursor.sh"
  echo "  4. Navigateur   : Actualiser + Cmd+Shift+R"
  echo "  Smoke test      : bash ${IA_DIR}/Test.sh"
  echo ""
}

# Ensure cloudflared is running with a reachable public URL (not just a stale PID + log line).
# Quick tunnels die while the process keeps reconnecting — always probe before reuse.
ensure_cloudflared_url() {
  local log_url
  local attempt

  log_url="$(cloudflared_find_https_url)"
  if cloudflared_process_running && [[ -n "${log_url}" ]] && probe_tunnel_url "${log_url}"; then
    echo "  cloudflared actif : ${log_url}"
    return 0
  fi

  if cloudflared_process_running; then
    if [[ -n "${log_url}" ]]; then
      echo "  cloudflared mort / URL expirée (${log_url}) — relance…"
    else
      echo "  cloudflared sans URL — relance…"
    fi
    pkill -f 'cloudflared tunnel' 2>/dev/null || true
    sleep 1
  fi

  for ((attempt = 1; attempt <= 3; attempt++)); do
    : >"${CLOUDFLARED_LOG}"
    start_cloudflared_background
    log_url="$(wait_for_cloudflared_url 60)" && {
      echo "  URL cloudflared : ${log_url}"
      return 0
    }
    echo "  ✗ tentative ${attempt}/3 — quick tunnel refusé (DNS / api.trycloudflare)…"
    pkill -f 'cloudflared tunnel' 2>/dev/null || true
    sleep 2
  done
  echo "  ✗ URL cloudflared introuvable — tail ${CLOUDFLARED_LOG}"
  return 1
}

patch_tunnel_from_log() {
  local log_url
  log_url="$(cloudflared_find_https_url)"
  [[ -n "${log_url}" && -f "${PATCH_TUNNEL}" ]] || return 1
  SKER_ENV_FILE="${SERVER_ENV}" SK_SKIP_RESTART_HINT=1 bash "${PATCH_TUNNEL}" "${log_url}"
}

write_sk_mcp_public_url() {
  local url="$1"
  node -e "
    const fs = require('fs');
    const path = process.argv[1];
    const url = process.argv[2];
    let text = fs.readFileSync(path, 'utf8');
    const line = 'SK_MCP_PUBLIC_URL=' + url;
    text = /^SK_MCP_PUBLIC_URL=/m.test(text)
      ? text.replace(/^SK_MCP_PUBLIC_URL=.*\$/m, line)
      : text.replace(/\s*\$/, '') + '\n' + line + '\n';
    fs.writeFileSync(path, text);
  " "${SERVER_ENV}" "${url%/}"
}

cleanup() {
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
  fi
}

# ── preflight ───────────────────────────────────────────────────────────────

if [[ ! -f "${SERVER_ENV}" ]]; then
  echo "Missing .env — CURSOR_API_KEY + SK_MCP_PUBLIC_URL in Node/Server/.env"
  echo "  (Node/Server/.env is used when present, else sker-app/.env — same as npm start)"
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "npm install in Node/Server…"
  npm install
fi

echo "════════════════════════════════════════════════════════════"
echo " SkServer — Cursor Cloud + MCP sker"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "  .env : ${SERVER_ENV}"
echo ""

if [[ -z "$(env_var_from_file CURSOR_API_KEY "${SERVER_ENV}" || true)" ]]; then
  echo "  ✗ CURSOR_API_KEY missing in ${SERVER_ENV}"
else
  echo "  ✓ CURSOR_API_KEY set"
fi

NEED_TUNNEL_PATCH=0
wMcpUrl="$(env_var_from_file SK_MCP_PUBLIC_URL "${SERVER_ENV}" || true)"

if [[ -n "${wMcpUrl}" ]] && probe_tunnel_url "${wMcpUrl}"; then
  echo "  ✓ Tunnel OK : ${wMcpUrl}"
else
  if [[ -n "${wMcpUrl}" ]]; then
    echo "  ⚠ Tunnel injoignable : ${wMcpUrl}"
  else
    echo "  ✗ SK_MCP_PUBLIC_URL absent"
  fi

  if [[ "${SK_TUNNEL_AUTO}" != "1" ]]; then
    print_tunnel_manual_steps
    echo "  (SK_TUNNEL_AUTO=0 — SkServer démarre sans corriger le tunnel)"
  else
    if ! cloudflared_installed; then
      echo "  ✗ Installez cloudflared : brew install cloudflared"
      print_tunnel_manual_steps
      exit 1
    fi
    NEED_TUNNEL_PATCH=1
    echo "  → cloudflared + probe après démarrage SkServer (port ${PORT} doit répondre)"
  fi
fi

echo ""
if [[ -n "${wMcpUrl}" ]]; then
  echo "  MCP endpoint : ${wMcpUrl}/mcp"
else
  echo "  MCP endpoint : ${wMcpUrl:-$(env_var_from_file SK_MCP_PUBLIC_URL "${SERVER_ENV}" || echo '<pending>')}/mcp"
fi
echo ""

# ── SkServer ──────────────────────────────────────────────────────────────────

trap cleanup EXIT INT TERM

echo "Démarrage SkServer…"
node run-with-env.mjs &
SERVER_PID=$!

echo "Attente http://127.0.0.1:${PORT}/ …"
if ! wait_for_local_server 60; then
  echo "  ✗ SkServer ne répond pas sur le port ${PORT}"
  exit 1
fi
echo "  ✓ SkServer prêt"

if [[ "${NEED_TUNNEL_PATCH}" == "1" ]]; then
  echo "Démarrage cloudflared (SkServer actif sur :${PORT})…"
  if ! ensure_cloudflared_url; then
    echo "  ✗ cloudflared indisponible — tail ${CLOUDFLARED_LOG}"
    print_tunnel_manual_steps
    echo ""
    echo "SkServer reste actif (pid ${SERVER_PID}) — corrigez le tunnel puis patch-tunnel-env.sh"
    trap - EXIT INT TERM
    wait "${SERVER_PID}"
    exit 0
  fi
  wLogUrl="$(cloudflared_find_https_url)"
  if [[ -n "${wLogUrl}" ]]; then
    write_sk_mcp_public_url "${wLogUrl}"
    wMcpUrl="${wLogUrl}"
    echo "  SK_MCP_PUBLIC_URL → ${wMcpUrl}"
  fi
  echo "Vérification tunnel public (probe, retries DNS)…"
  if wait_for_tunnel_probe "${wMcpUrl}" 24; then
    if [[ -f "${PATCH_TUNNEL}" ]]; then
      SKER_ENV_FILE="${SERVER_ENV}" SK_SKIP_RESTART_HINT=1 bash "${PATCH_TUNNEL}" "${wMcpUrl}" || true
    fi
    echo "  ✓ Tunnel OK : ${wMcpUrl}"
    # SkServer was started before .env was patched — reload process.env
    echo "Relance SkServer pour charger SK_MCP_PUBLIC_URL…"
    if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
      kill "${SERVER_PID}" 2>/dev/null || true
      wait "${SERVER_PID}" 2>/dev/null || true
    fi
    node run-with-env.mjs &
    SERVER_PID=$!
    if ! wait_for_local_server 60; then
      echo "  ✗ SkServer ne répond pas après relance (port ${PORT})"
      exit 1
    fi
    echo "  ✓ SkServer relancé (pid ${SERVER_PID}) avec ${wMcpUrl}"
  else
    echo "  ✗ Tunnel public injoignable après démarrage SkServer"
    print_tunnel_manual_steps
    echo ""
    echo "SkServer reste actif (pid ${SERVER_PID}). Dans un autre terminal :"
    echo "  bash ${PATCH_TUNNEL}"
    echo "  puis Actualiser le panneau IA + Cmd+Shift+R"
    trap - EXIT INT TERM
    wait "${SERVER_PID}"
    exit 0
  fi
fi

echo ""
echo "SkServer actif (pid ${SERVER_PID})."
echo "  Navigateur : Actualiser (panneau IA) + Cmd+Shift+R"
echo "  MCP endpoint : ${wMcpUrl:-$(env_var_from_file SK_MCP_PUBLIC_URL "${SERVER_ENV}" || echo '?')}/mcp"
echo "  cloudflared  : ne pas arrêter (logs ${CLOUDFLARED_LOG})"
echo "  Test         : bash ${IA_DIR}/Test.sh"
echo ""

trap - EXIT INT TERM
wait "${SERVER_PID}"
