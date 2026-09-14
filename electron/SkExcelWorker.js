// =============================================================================
// Sker Desktop — SkExcel conversion worker (CommonJS, worker_threads).
// Hosts ONE SkExcelLib wasm instance for a single conversion job, then exits.
// Running in a worker isolates the app from the converter: a wasm abort or an
// exit() from callMain() terminates only this worker, never the Electron app.
//   - import : xlsx -> .sker via skexcel_convert(uri, xlsxPath) (writes next to xlsx)
//   - export : .sker -> xlsx via callMain(['/m:sker2xlsx', '/f:...', '/x:...'])
// =============================================================================

const { parentPort, workerData } = require('worker_threads');
const { existsSync } = require('fs');

// The C++ converter calls globalThis.__skExcelProgress(pct) periodically (via
// EM_JS). Relay each tick to the main process. This runs synchronously inside
// the blocking skexcel_convert / callMain call, which is fine for postMessage.
let gLastPct = -1;
globalThis.__skExcelProgress = (pct) => {
  const wPct = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  if (wPct === gLastPct) return;
  gLastPct = wPct;
  parentPort.postMessage({ type: 'progress', pct: wPct });
};

(async () => {
  try {
    // Emscripten MODULARIZE factory (CJS). NODERAWFS writes to the real FS.
    const createSkExcel = require(workerData.libPath);
    const mod = await createSkExcel({
      noExitRuntime: true,
      print: () => {},
      printErr: () => {},
    });

    const job = workerData.job || {};
    let result;

    if (job.type === 'import') {
      if (!job.xlsxPath || !existsSync(job.xlsxPath)) {
        result = { ok: false, rc: 2, error: `xlsx not found: ${job.xlsxPath}` };
      } else {
        const convert = mod.cwrap('skexcel_convert', 'number', ['string', 'string']);
        const rc = convert(job.uri || '', job.xlsxPath);
        result = { ok: rc === 0, rc };
      }
    } else if (job.type === 'export') {
      if (!job.skerPath || !existsSync(job.skerPath)) {
        result = { ok: false, rc: 2, error: `sker not found: ${job.skerPath}` };
      } else {
        const args = ['/m:sker2xlsx', `/f:${job.skerPath}`];
        if (job.xlsxPath) args.push(`/x:${job.xlsxPath}`);
        const rc = mod.callMain(args) | 0;
        result = { ok: rc === 0, rc };
      }
    } else {
      result = { ok: false, rc: -1, error: `unknown job type: ${job.type}` };
    }

    parentPort.postMessage(result);
  } catch (wError) {
    parentPort.postMessage({ ok: false, rc: -2, error: String(wError?.message || wError) });
  }
})();
