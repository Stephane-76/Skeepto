#!/usr/bin/env bash
# start-ai-llama.sh — SkServer with local llama-server (chat only, no MCP tools)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LLAMA_DIR="${LLAMA_CPP_DIR:-${HOME}/Projects/llama.cpp}"
LLAMA_PORT="${SK_LLAMA_PORT:-8080}"
LLAMA_HOST="http://127.0.0.1:${LLAMA_PORT}"

cd "${SCRIPT_DIR}"

export SK_AI_PROVIDER=llama
export SK_LLAMA_BASE_URL="${SK_LLAMA_BASE_URL:-${LLAMA_HOST}/v1}"

if [[ ! -f "${ROOT}/.env" ]] && [[ ! -f "${SCRIPT_DIR}/.env" ]]; then
  echo "Missing .env — copy .env.example to sker-app/.env (Mongo, JWT, etc.)."
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Running npm install in Node/Server..."
  npm install
fi

if curl -sf "${LLAMA_HOST}/health" >/dev/null 2>&1; then
  echo "llama-server OK at ${LLAMA_HOST}"
else
  echo "WARNING: llama-server not reachable at ${LLAMA_HOST}/health"
  echo "  Start it first: cd ${LLAMA_DIR} && ./launch.sh"
  echo "  Or set LLAMA_CPP_DIR / SK_LLAMA_PORT if your setup differs."
  echo ""
fi

echo "SkServer — AI provider: llama (local chat, no spreadsheet MCP)"
echo "  For MCP agent mode use: bash Node/Server/start-ai-llama-agent.sh"
echo "  Base URL: ${SK_LLAMA_BASE_URL}"
echo ""

exec node run-with-env.mjs
