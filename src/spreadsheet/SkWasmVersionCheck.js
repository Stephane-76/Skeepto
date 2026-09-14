/**
 * SkWasmVersionCheck.js
 *
 * Client<->server WASM build handshake.
 *
 * The collaborative spreadsheet replays operations across a browser WASM engine and a
 * pool of server-side WASM instances. When a client runs a different (stale) build of
 * SkReactSpreadSheet.wasm than the server, replayed ops are decoded against mismatched
 * memory layouts, which corrupts state and crashes instances with
 * "RuntimeError: memory access out of bounds".
 *
 * This module computes the SHA-256 of the .wasm the browser actually loaded and compares
 * it to the SHA-256 the server exposes for its own .wasm. On a definite mismatch the
 * caller can warn the user and force a reload.
 *
 * The check is fail-open: any error while fetching/hashing (offline, insecure context
 * without crypto.subtle, unexpected response) is treated as "cannot determine" and never
 * blocks the app.
 */

const SERVER_VERSION_URL = '/spreadsheet/wasm/version';

// Candidate URLs for the browser's own .wasm. The Emscripten glue resolves it next to
// SkReactSpreadSheet.mjs, which is served at the site root in the CRA build.
const CLIENT_WASM_URLS = [
  'SkReactSpreadSheet.wasm',
  '/SkReactSpreadSheet.wasm',
];

let __clientBuildIdPromise = null;

/**
 * @returns {boolean} true when the Web Crypto digest API is available (secure context)
 */
function hasSubtleCrypto() {
  return typeof crypto !== 'undefined'
    && typeof crypto.subtle !== 'undefined'
    && typeof crypto.subtle.digest === 'function';
}

/**
 * @param {ArrayBuffer} sBuffer
 * @returns {Promise<string>} lowercase hex SHA-256 digest
 */
async function sha256Hex(sBuffer) {
  const wDigest = await crypto.subtle.digest('SHA-256', sBuffer);
  const wBytes = new Uint8Array(wDigest);
  let wHex = '';
  for (let wIndex = 0; wIndex < wBytes.length; wIndex++) {
    wHex += wBytes[wIndex].toString(16).padStart(2, '0');
  }
  return wHex;
}

/**
 * SHA-256 of the .wasm loaded by this browser. Computed once and cached.
 * @returns {Promise<string|null>} hex digest, or null if it cannot be determined
 */
export function getClientWasmBuildId() {
  if (__clientBuildIdPromise) {
    return __clientBuildIdPromise;
  }
  __clientBuildIdPromise = (async () => {
    if (!hasSubtleCrypto()) {
      return null;
    }
    for (const wUrl of CLIENT_WASM_URLS) {
      try {
        const wResponse = await fetch(wUrl, { cache: 'force-cache' });
        if (!wResponse.ok) {
          continue;
        }
        const wBuffer = await wResponse.arrayBuffer();
        if (wBuffer.byteLength === 0) {
          continue;
        }
        return await sha256Hex(wBuffer);
      } catch {
        // Try the next candidate URL.
      }
    }
    return null;
  })();
  return __clientBuildIdPromise;
}

/**
 * SHA-256 of the server's .wasm, from GET /spreadsheet/wasm/version.
 * @returns {Promise<string|null>} hex digest, or null if it cannot be determined
 */
export async function getServerWasmBuildId() {
  try {
    const wJwt = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('jwt') : null;
    const wResponse = await fetch(SERVER_VERSION_URL, {
      credentials: 'include',
      headers: wJwt ? { Authorization: `Bearer ${wJwt}` } : {},
    });
    if (!wResponse.ok) {
      return null;
    }
    const wData = await wResponse.json();
    return (wData && typeof wData.wasmSha256 === 'string' && wData.wasmSha256) || null;
  } catch {
    return null;
  }
}

/**
 * Compare the client and server WASM builds.
 * @returns {Promise<{status: 'match'|'mismatch'|'unknown', client: string|null, server: string|null}>}
 */
export async function checkWasmVersion() {
  const [wClient, wServer] = await Promise.all([
    getClientWasmBuildId(),
    getServerWasmBuildId(),
  ]);
  if (!wClient || !wServer) {
    return { status: 'unknown', client: wClient, server: wServer };
  }
  return {
    status: wClient === wServer ? 'match' : 'mismatch',
    client: wClient,
    server: wServer,
  };
}
