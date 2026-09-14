// Worker thread hosting ONE reused SkExcel wasm instance.
//
// It instantiates SkExcelLib.js exactly once, then serves conversion jobs on that single instance
// (no per-request process spawn / module instantiate). Two job kinds:
//   - 'import'  : xlsx -> .sker, via the exported skexcel_convert() (fast ccall path). That C
//                 function already does try/catch + DoneFormatRoot/DoneSpreadSheet teardown, so a
//                 malformed file returns an error code without corrupting the next conversion.
//   - 'export'  : .sker -> xlsx, via callMain(['/m:sker2xlsx', ...]) (main() also tears down).
//
// The pool (SkExcelWasmPool.mjs) owns the recycling policy: the wasm linear memory only grows and
// is never returned to the OS within a single instance, so the pool periodically terminates this
// worker and starts a fresh one to reclaim memory. Nothing here needs to track that.
import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);

// Deployed as .cjs so Node always loads it as CommonJS (require -> module.exports = factory),
// regardless of the package's "type" field.
const wLibPath = workerData?.libPath || require.resolve('./SkExcelLib.cjs');
const wVerbose = !!workerData?.verbose;

// Emscripten MODULARIZE factory (CJS). Instantiated once for the life of this worker.
const createSkExcel = require(wLibPath);

const mod = await createSkExcel({
  // Silence the converter's own stdout/stderr (NODERAWFS still writes files to the real FS).
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
  // callMain runs main(); for sker2xlsx it converts and tears down the singletons on return.
  const args = ['/m:sker2xlsx', `/f:${skerPath}`];
  if (xlsxPath) args.push(`/x:${xlsxPath}`);
  const rc = mod.callMain(args) | 0;
  return { ok: rc === 0, rc };
}

parentPort.on('message', (msg) => {
  const { id, type } = msg || {};
  let result;
  try {
    if (type === 'import') {
      result = handleImport(msg);
    } else if (type === 'export') {
      result = handleExport(msg);
    } else if (type === 'ping') {
      result = { ok: true, rc: 0 };
    } else {
      result = { ok: false, rc: -1, error: `unknown job type: ${type}` };
    }
  } catch (wError) {
    // A thrown exception here means the module may be in an undefined state: report and let the
    // pool recycle this worker rather than risk a poisoned instance.
    result = { ok: false, rc: -2, error: String(wError?.message || wError), fatal: true };
  }
  parentPort.postMessage({ id, ...result });
});

// Signal readiness after the module is fully instantiated.
parentPort.postMessage({ id: '__ready__', ok: true });
