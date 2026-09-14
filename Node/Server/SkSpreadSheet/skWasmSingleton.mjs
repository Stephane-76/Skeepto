//=============================================================================
// skWasmSingleton.mjs — single SkReactSpreadSheet WASM module per Node process
//=============================================================================

import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';

const __wasmFactoryModule = await import('../SkReactSpreadSheet.mjs');
const createWasmModule =
  typeof __wasmFactoryModule.default === 'function'
    ? __wasmFactoryModule.default
    : typeof __wasmFactoryModule === 'function'
      ? __wasmFactoryModule
      : null;

if (!createWasmModule) {
  throw new TypeError('SkReactSpreadSheet.mjs did not export a factory function');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Absolute path to SkReactSpreadSheet.wasm (next to SkReactSpreadSheet.mjs). */
export const SK_WASM_PATH = path.join(__dirname, '..', 'SkReactSpreadSheet.wasm');

// Fail fast if the .wasm is missing; the glue itself resolves/reads it via locateFile below.
if (!fs.existsSync(SK_WASM_PATH)) {
  console.error('SkReactSpreadSheet.wasm not found at', SK_WASM_PATH);
}

let __wasmBuildId = null;
let __browserWasmBuildId = null;

function sha256File(filePath) {
  const wBytes = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(wBytes).digest('hex');
}

/**
 * SHA-256 of the Node-side SkReactSpreadSheet.wasm (SK_NODE build).
 * Pool stats / diagnostics — not the browser handshake (that binary is different).
 * @returns {string} lowercase hex digest, or '' if unreadable
 */
export function getSkWasmBuildId() {
  if (__wasmBuildId !== null) {
    return __wasmBuildId;
  }
  try {
    __wasmBuildId = sha256File(SK_WASM_PATH);
  } catch (wError) {
    console.error('Unable to compute SkReactSpreadSheet.wasm build id:', wError);
    __wasmBuildId = '';
  }
  return __wasmBuildId;
}

/**
 * SHA-256 of the .wasm the HTTP server actually serves to the browser
 * (STATIC_ROOT / build / public). compil2Wasm.sh produces a different Node
 * binary (SK_NODE=1) than the web module — comparing those two hashes always
 * mismatches and loops the "reload" dialog.
 * @returns {string} lowercase hex digest, or '' if no browser .wasm is found
 */
export function getBrowserWasmBuildId() {
  if (__browserWasmBuildId !== null) {
    return __browserWasmBuildId;
  }
  const wCandidates = [];
  const wStaticRoot = process.env.STATIC_ROOT?.trim();
  if (wStaticRoot) {
    wCandidates.push(path.join(wStaticRoot, 'SkReactSpreadSheet.wasm'));
  }
  wCandidates.push(path.resolve(__dirname, '..', '..', '..', 'build', 'SkReactSpreadSheet.wasm'));
  wCandidates.push(path.resolve(__dirname, '..', '..', '..', 'public', 'SkReactSpreadSheet.wasm'));
  for (const wPath of wCandidates) {
    try {
      if (!fs.existsSync(wPath)) {
        continue;
      }
      __browserWasmBuildId = sha256File(wPath);
      return __browserWasmBuildId;
    } catch (wError) {
      console.error('Unable to hash browser SkReactSpreadSheet.wasm at', wPath, wError);
    }
  }
  __browserWasmBuildId = '';
  return __browserWasmBuildId;
}

function createWasmByteStreamSink(nodeStream) {
  const dec = new StringDecoder('utf8');
  return function wasmByteSink(code) {
    if (code === null || code === 10) {
      const tail = dec.end();
      if (tail) nodeStream.write(tail);
      if (code === 10) nodeStream.write('\n');
    } else if (code !== 0) {
      const chunk = dec.write(Buffer.from([code]));
      if (chunk) nodeStream.write(chunk);
    }
  };
}

let wasmSingleton = null;
let wasmInitPromise = null;

/**
 * Base Emscripten module settings shared when callers do not override keys.
 * @returns {Record<string, unknown>}
 */
export function createSkWasmBaseModuleConfig() {
  return {
    preRun: [],
    postRun: [],
    env: {
      abort(_msg, _file, line, column) {
        console.error('SkWasm abort', line, column);
      },
    },
    // NOTE: do NOT pass `wasmBinary` here. This build's INCOMING_MODULE_JS_API does not
    // include it (ASSERTIONS aborts with "was supplied but not included in ..."). The glue
    // loads the .wasm itself in Node via `locateFile` (below), which returns SK_WASM_PATH.
    stdout: createWasmByteStreamSink(process.stdout),
    stderr: createWasmByteStreamSink(process.stderr),
    print(text) {
      console.log('C++ ->', text);
    },
    printErr(text) {
      console.error('C++ Error ->', text);
    },
    setStatus(text) {
      console.log('-->Status', text);
    },
    PostMessage(msg) {
      console.log('[PostMessage]', msg);
    },
    OnCellChange() {},
    locateFile(s) {
      if (typeof s === 'string' && s.endsWith('.wasm')) {
        return SK_WASM_PATH;
      }
      return s;
    },
  };
}

/**
 * Quiet defaults for batch scripts (PDF, CLI). First caller wins if WASM not loaded yet.
 * @returns {Record<string, unknown>}
 */
export function createSkWasmQuietModuleConfig() {
  const base = createSkWasmBaseModuleConfig();
  return {
    ...base,
    print() {},
    printErr() {},
    setStatus() {},
    PostMessage() {},
    OnCellChange() {},
  };
}

/**
 * Load SkSpreadSheet WASM once. Subsequent calls return the same module (ignore new config).
 *
 * @param {Record<string, unknown>} [moduleConfig] — shallow merge over base on first call only
 */
export async function ensureSkWasmModule(moduleConfig) {
  if (wasmSingleton) {
    return wasmSingleton;
  }
  if (!wasmInitPromise) {
    try {
      if (typeof globalThis.fetch === 'function') {
        globalThis.fetch = undefined;
      }
    } catch {
      /* ignore */
    }
    const base = createSkWasmBaseModuleConfig();
    const merged =
      moduleConfig && typeof moduleConfig === 'object'
        ? { ...base, ...moduleConfig }
        : { ...base };
    // Keys rejected by this build's INCOMING_MODULE_JS_API; supplying them aborts under ASSERTIONS.
    delete merged.wasmBinary;
    delete merged.wasmMemory;
    delete merged.INITIAL_MEMORY;
    wasmInitPromise = createWasmModule(merged);
  }
  wasmSingleton = await wasmInitPromise;
  return wasmSingleton;
}

/** @returns {boolean} */
export function isSkWasmLoaded() {
  return wasmSingleton != null;
}
