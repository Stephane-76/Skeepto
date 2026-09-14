// =============================================================================
// Sker Desktop — SkExcel conversion (main process side).
// Runs each xlsx <-> sker conversion in a short-lived worker_thread that hosts
// the SkExcelLib wasm module. One worker per job keeps memory bounded (the wasm
// linear memory only grows) and isolates the app from converter aborts/exit().
// =============================================================================

const path = require('path');
const { Worker } = require('worker_threads');
const { app } = require('electron');

// SkExcelLib.cjs + SkExcelLib.wasm are shipped unpacked (see package.json
// build.asarUnpack) so Emscripten can read the .wasm from the real filesystem.
function libDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'Node', 'Server');
  }
  return path.join(__dirname, '..', 'Node', 'Server');
}

function runJob(job, onProgress) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(path.join(__dirname, 'SkExcelWorker.js'), {
      workerData: {
        libPath: path.join(libDir(), 'SkExcelLib.cjs'),
        job,
      },
    });
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      fn(arg);
    };
    // Progress ticks arrive as { type: 'progress', pct }; the final result is
    // the only non-progress message and settles the promise.
    worker.on('message', (msg) => {
      if (msg && msg.type === 'progress') {
        if (typeof onProgress === 'function') onProgress(msg.pct);
        return;
      }
      finish(resolve, msg);
    });
    worker.once('error', (err) => finish(reject, err));
    worker.once('exit', (code) => {
      if (!settled) finish(reject, new Error(`SkExcel worker exited early (code ${code})`));
    });
  });
}

// xlsx -> .sker. The .sker is written next to xlsxPath (same basename).
function importXlsx({ xlsxPath, uri }, onProgress) {
  return runJob({ type: 'import', xlsxPath, uri }, onProgress);
}

// .sker -> xlsx at xlsxPath.
function exportXlsx({ skerPath, xlsxPath }, onProgress) {
  return runJob({ type: 'export', skerPath, xlsxPath }, onProgress);
}

module.exports = { importXlsx, exportXlsx };
