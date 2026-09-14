// Pool of worker_threads, each hosting a reused SkExcel wasm instance (see SkExcelWasmWorker.mjs).
//
// Why a pool with recycling: reusing one wasm instance removes the per-request process spawn +
// module instantiate cost, but wasm linear memory only grows and is never returned to the OS
// within an instance. So we cap each worker's lifetime (N jobs, or right after a "heavy" file) and
// terminate + recreate it to reclaim memory. This keeps the throughput win while bounding RSS on a
// server that runs for days.
//
// Note: worker_threads share the host process. terminate() disposes the worker's V8 isolate and
// frees its wasm memory, but this is not OS-level process isolation. If you need a hard OS memory
// guarantee, a child_process variant of this pool is the stronger option.
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(__dirname, 'SkExcelWasmWorker.mjs');

const DEFAULTS = {
  size: Number(process.env.SKEXCEL_WASM_POOL_SIZE) || 1,
  maxJobsPerWorker: Number(process.env.SKEXCEL_WASM_MAX_JOBS) || 100,
  heavyBytes: Number(process.env.SKEXCEL_WASM_HEAVY_BYTES) || 8 * 1024 * 1024,
  verbose: process.env.SKEXCEL_WASM_VERBOSE === '1',
};

export class SkExcelWasmPool {
  constructor(options = {}) {
    this._opt = { ...DEFAULTS, ...options };
    this._workers = [];      // WorkerHandle[]
    this._queue = [];        // pending jobs
    this._nextJobId = 1;
    this._destroyed = false;
    for (let i = 0; i < this._opt.size; i++) this._spawnWorker();
  }

  _spawnWorker() {
    const wHandle = {
      worker: null,
      ready: false,
      jobCount: 0,
      current: null,       // { id, resolve, reject, heavy }
      recycleAfter: false, // set true when a heavy job must end this worker's life
    };
    const wWorker = new Worker(WORKER_PATH, {
      workerData: { libPath: this._opt.libPath, verbose: this._opt.verbose },
    });
    wHandle.worker = wWorker;

    wWorker.on('message', (msg) => this._onMessage(wHandle, msg));
    wWorker.on('error', (err) => this._onWorkerDown(wHandle, err));
    wWorker.on('exit', (code) => {
      if (code !== 0) this._onWorkerDown(wHandle, new Error(`worker exited with code ${code}`));
    });

    this._workers.push(wHandle);
    return wHandle;
  }

  _onMessage(wHandle, msg) {
    if (msg?.id === '__ready__') {
      wHandle.ready = true;
      this._drain();
      return;
    }
    const wJob = wHandle.current;
    if (!wJob || wJob.id !== msg.id) return; // stale / mismatched
    wHandle.current = null;
    wHandle.jobCount += 1;

    if (msg.ok) wJob.resolve({ ok: true, rc: msg.rc });
    else wJob.reject(Object.assign(new Error(msg.error || `SkExcel wasm job failed (rc=${msg.rc})`), { rc: msg.rc }));

    // Recycle if: fatal error, hit the job cap, or this was a heavy (large-file) job.
    const wMustRecycle = msg.fatal || wHandle.recycleAfter
      || wHandle.jobCount >= this._opt.maxJobsPerWorker;
    if (wMustRecycle) {
      const wReason = msg.fatal ? 'fatal error'
        : wHandle.recycleAfter ? 'heavy file'
        : `job cap (${this._opt.maxJobsPerWorker})`;
      this._recycle(wHandle, wReason);
    }
    this._drain();
  }

  _onWorkerDown(wHandle, err) {
    console.warn(`SkExcel worker pool: thread ${wHandle.worker?.threadId} down after ${wHandle.jobCount} job(s), respawning — ${err.message}`);
    if (wHandle.current) {
      wHandle.current.reject(Object.assign(err, { rc: wHandle.current.lastRc ?? -3 }));
      wHandle.current = null;
    }
    this._removeWorker(wHandle);
    if (!this._destroyed && this._workers.length < this._opt.size) {
      this._spawnWorker();
      this._drain();
    }
  }

  _recycle(wHandle, reason = 'job cap') {
    console.log(`SkExcel worker pool: recycling thread ${wHandle.worker.threadId} after ${wHandle.jobCount} job(s) (${reason})`);
    this._removeWorker(wHandle);
    try { wHandle.worker.terminate(); } catch (_) { /* best effort */ }
    if (!this._destroyed && this._workers.length < this._opt.size) this._spawnWorker();
  }

  _removeWorker(wHandle) {
    const i = this._workers.indexOf(wHandle);
    if (i !== -1) this._workers.splice(i, 1);
  }

  _drain() {
    if (this._destroyed) return;
    for (const wHandle of this._workers) {
      if (!wHandle.ready || wHandle.current) continue;
      const wJob = this._queue.shift();
      if (!wJob) break;
      wHandle.current = wJob;
      if (wJob.heavy) wHandle.recycleAfter = true;
      wHandle.worker.postMessage({ id: wJob.id, type: wJob.type, ...wJob.payload });
    }
  }

  _enqueue(type, payload, fileSize) {
    if (this._destroyed) return Promise.reject(new Error('SkExcelWasmPool destroyed'));
    return new Promise((resolve, reject) => {
      this._queue.push({
        id: this._nextJobId++,
        type,
        payload,
        heavy: (fileSize || 0) >= this._opt.heavyBytes,
        resolve,
        reject,
      });
      this._drain();
    });
  }

  /** xlsx -> .sker (written next to xlsxPath, or to the /u: uri via NODERAWFS). */
  convertXlsxToSker({ xlsxPath, uri, fileSize }) {
    return this._enqueue('import', { xlsxPath, uri }, fileSize);
  }

  /** .sker -> xlsx. */
  exportSkerToXlsx({ skerPath, xlsxPath, fileSize }) {
    return this._enqueue('export', { skerPath, xlsxPath }, fileSize);
  }

  async destroy() {
    this._destroyed = true;
    const wErr = new Error('SkExcelWasmPool destroyed');
    for (const wJob of this._queue) wJob.reject(wErr);
    this._queue = [];
    await Promise.all(this._workers.map((h) => {
      if (h.current) h.current.reject(wErr);
      return h.worker.terminate().catch(() => {});
    }));
    this._workers = [];
  }
}

let _singleton = null;

/** Lazily create a shared pool for the server process. */
export function getSkExcelWasmPool(options) {
  if (!_singleton) _singleton = new SkExcelWasmPool(options);
  return _singleton;
}
