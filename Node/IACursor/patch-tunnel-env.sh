#!/usr/bin/env bash
# Patch SK_MCP_PUBLIC_URL in Node/Server/.env from a running cloudflared log or URL arg.
# Usage:
#   bash Node/IACursor/patch-tunnel-env.sh                    # read /tmp/sker-cloudflared.log
#   bash Node/IACursor/patch-tunnel-env.sh https://xxx.trycloudflare.com

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_ENV="${SKER_ENV_FILE:-${SCRIPT_DIR}/../Server/.env}"
PROBE_SCRIPT="${SCRIPT_DIR}/skTunnelProbe.mjs"
CLOUDFLARED_LOG="${CLOUDFLARED_LOG:-/tmp/sker-cloudflared.log}"

if [[ ! -f "${PROBE_SCRIPT}" ]]; then
  echo "skTunnelProbe.mjs introuvable : ${PROBE_SCRIPT}"
  exit 1
fi

url="${1:-}"
if [[ -z "${url}" && -f "${CLOUDFLARED_LOG}" ]]; then
  url="$(node "${PROBE_SCRIPT}" --from-log "${CLOUDFLARED_LOG}" 2>/dev/null || true)"
fi

if [[ -z "${url}" ]]; then
  echo "URL introuvable. Passez l'URL en argument ou lancez cloudflared avec start-tunnel.sh"
  exit 1
fi

url="${url%/}"

probe_json="$(node "${PROBE_SCRIPT}" "${url}" --json)"
probe_ok="$(node -pe "JSON.parse(process.argv[1]).ok" "${probe_json}")"
probe_error="$(node -pe "JSON.parse(process.argv[1]).error||''" "${probe_json}")"
probe_code="$(node -pe "JSON.parse(process.argv[1]).httpCode||'000'" "${probe_json}")"

node -e "
  const fs = require('fs');
  const path = process.argv[1];
  const url = process.argv[2];
  let text = fs.readFileSync(path, 'utf8');
  const line = 'SK_MCP_PUBLIC_URL=' + url;
  text = /^SK_MCP_PUBLIC_URL=/m.test(text)
    ? text.replace(/^SK_MCP_PUBLIC_URL=.*$/m, line)
    : text.replace(/\s*$/, '') + '\n' + line + '\n';
  fs.writeFileSync(path, text);
" "${SERVER_ENV}" "${url}"

echo "SK_MCP_PUBLIC_URL=${url}"
echo "→ ${SERVER_ENV}"

if [[ "${probe_ok}" == "true" ]]; then
  echo "Tunnel OK (HTTP ${probe_code})"
else
  echo "⚠ Tunnel NON joignable : ${probe_error:-HTTP ${probe_code}}"
  echo ""
  echo "Causes fréquentes :"
  echo "  • URL trycloudflare expirée (quick tunnel mort) — relancez :"
  echo "      pkill -f 'cloudflared tunnel'; bash Node/IACursor/start-tunnel.sh"
  echo "  • cloudflared en boucle d'erreur — voir : tail -20 ${CLOUDFLARED_LOG}"
  echo "  • SkServer arrêté : curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/"
  echo ""
  echo "Ne redémarrez SkServer qu'après « Tunnel OK » ci-dessus."
  exit 1
fi

if [[ "${SK_SKIP_RESTART_HINT:-0}" != "1" ]]; then
  echo ""
  SERVER_DIR="$(cd "${SCRIPT_DIR}/../Server" && pwd)"
  echo "Redémarrez SkServer : cd ${SERVER_DIR} && npm start"
fi
