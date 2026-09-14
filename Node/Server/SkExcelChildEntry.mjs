// Child process hosting ONE reused SkExcel wasm instance, talking to the pool over Node IPC.
//
// Same job model as SkExcelWasmWorker.mjs, but this runs in a SEPARATE OS process. That gives hard
// OS-level isolation: when the pool kills this process to recycle it, the kernel reclaims ALL of
// its memory unconditionally (including the wasm linear-memory high-water mark), and a native crash
// here cannot take down the server process.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);

// Deployed as .cjs so Node loads it as CommonJS (require -> module.exports = factory).
const wLibPath = process.env.SKEXCEL_LIB_PATH || require.resolve('./SkExcelLib.cjs');
const wVerbose = process.env.SKEXCEL_WASM_VERBOSE === '1';

const createSkExcel = require(wLibPath);
const mod = await createSkExcel({
  print: wVerbose ? undefined : () => {},
  printErr: wVerbose ? undefined : () => {},
});

const convertImport = mod.cwrap('skexcel_convert', 'number', ['string', 'string']);

function handleImport({ xlsxPath, uri }) {
  if (!xlsxPath || !existsSync(xlsxPath)) {
    return { ok: false, rc: 2, error: `xlsx not found: ${xlsxPath}` };
  }
  const rc = convertImport(uri || '', xlsxPath);
  return { ok: rc === 0, rc };
}

function handleExport({ skerPath, xlsxPath }) {
  if (!skerPath || !existsSync(skerPath)) {
    return { ok: false, rc: 2, error: `sker not found: ${skerPath}` };
  }
  const args = ['/m:sker2xlsx', `/f:${skerPath}`];
  if (xlsxPath) args.push(`/x:${xlsxPath}`);
  const rc = mod.callMain(args) | 0;
  return { ok: rc === 0, rc };
}

process.on('message', (msg) => {
  const { id, type } = msg || {};
  let result;
  try {
    if (type === 'import') result = handleImport(msg);
    else if (type === 'export') result = handleExport(msg);
    else if (type === 'ping') result = { ok: true, rc: 0 };
    else result = { ok: false, rc: -1, error: `unknown job type: ${type}` };
  } catch (wError) {
    result = { ok: false, rc: -2, error: String(wError?.message || wError), fatal: true };
  }
  process.send({ id, ...result });
});

// Signal readiness once the module is fully instantiated.
process.send({ id: '__ready__', ok: true });
