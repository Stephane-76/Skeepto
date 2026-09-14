#!/usr/bin/env bash
# start-ai-llama-agent.sh — SkServer + local llama (Qwen3.5-35B-A3B) with in-process MCP tools
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LLAMA_DIR="${LLAMA_CPP_DIR:-${HOME}/Projects/llama.cpp}"
LLAMA_PORT="${SK_LLAMA_PORT:-8080}"
LLAMA_HOST="http://127.0.0.1:${LLAMA_PORT}"
LLAMA_MODEL="${SK_LLAMA_MODEL:-Qwen3.5-35B-A3B}"
LLAMA_HF_REPO="${SK_LLAMA_HF_REPO:-unsloth/Qwen3.5-35B-A3B-GGUF:Q8_0}"

cd "${SCRIPT_DIR}"

export SK_AI_PROVIDER=llama
export SK_LLAMA_MCP=1
export SK_LLAMA_BASE_URL="${SK_LLAMA_BASE_URL:-${LLAMA_HOST}/v1}"
export SK_LLAMA_MODEL="${LLAMA_MODEL}"
export SK_LLAMA_MAX_TOKENS="${SK_LLAMA_MAX_TOKENS:-8192}"
export SK_LLAMA_MCP_JSON_RETRY_MAX_TOKENS="${SK_LLAMA_MCP_JSON_RETRY_MAX_TOKENS:-16384}"
export SK_LLAMA_MCP_MAX_STEPS="${SK_LLAMA_MCP_MAX_STEPS:-16}"
export SK_LLAMA_TEMPERATURE="${SK_LLAMA_TEMPERATURE:-0.1}"

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
  echo "  Recommended launch (Qwen3.5-35B-A3B Q8, reasoning off):"
  echo "    cd ${LLAMA_DIR} && ./launchQwen35.sh"
  echo "    # or: LLAMA_PORT=${LLAMA_PORT} ./launchQwen35.sh"
  echo ""
fi

echo "SkServer — AI provider: llama + MCP local (no Cursor cloud, no tunnel)"
echo "  Model:    ${SK_LLAMA_MODEL}"
echo "  max_tokens: ${SK_LLAMA_MAX_TOKENS} (JSON tool calls; retry ${SK_LLAMA_MCP_JSON_RETRY_MAX_TOKENS})"
echo "  Base URL: ${SK_LLAMA_BASE_URL}"
echo ""

exec node run-with-env.mjs
