// Pool of child processes, each hosting a reused SkExcel wasm instance (see SkExcelChildEntry.mjs).
// Same public API as SkExcelWasmPool (convertXlsxToSker / exportSkerToXlsx), but each worker is a
// separate OS process instead of a worker_thread.
//
// Why prefer this for a multi-day server: recycling here is a real process kill, so the kernel
// reclaims ALL of the child's memory unconditionally (the wasm linear-memory high-water mark can
// never accumulate across the whole server), and a native crash is isolated to the child. The cost
// is a heavier startup per child than a thread, which recycling-after-N-jobs amortizes.
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHILD_ENTRY = path.join(__dirname, 'SkExcelChildEntry.mjs');

const DEFAULTS = {
  size: Number(process.env.SKEXCEL_WASM_POOL_SIZE) || 1,
  maxJobsPerWorker: Number(process.env.SKEXCEL_WASM_MAX_JOBS) || 100,
  heavyBytes: Number(process.env.SKEXCEL_WASM_HEAVY_BYTES) || 8 * 1024 * 1024,
  verbose: process.env.SKEXCEL_WASM_VERBOSE === '1',
};

export class SkExcelChildPool {
  constructor(options = {}) {
    this._opt = { ...DEFAULTS, ...options };
    this._children = [];   // ChildHandle[]
    this._queue = [];
    this._nextJobId = 1;
    this._destroyed = false;
    for (let i = 0; i < this._opt.size; i++) this._spawnChild();
  }

  _spawnChild() {
    const wHandle = {
      child: null,
      ready: false,
      jobCount: 0,
      current: null,       // { id, resolve, reject, heavy }
      recycleAfter: false,
    };
    const wEnv = { ...process.env };
    if (this._opt.libPath) wEnv.SKEXCEL_LIB_PATH = this._opt.libPath;
    if (this._opt.verbose) wEnv.SKEXCEL_WASM_VERBOSE = '1';

    // stdio: drop the converter's stdout chatter (fd1), keep stderr for real errors, plus the IPC channel.
    const wChild = fork(CHILD_ENTRY, [], {
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      env: wEnv,
    });
    wHandle.child = wChild;

    wChild.on('message', (msg) => this._onMessage(wHandle, msg));
    wChild.on('error', (err) => this._onChildDown(wHandle, err));
    wChild.on('exit', (code, signal) => {
      // A kill during recycle is expected; only treat unexpected exits (with a live job) as failures.
      if (wHandle.current) {
        this._onChildDown(wHandle, new Error(`child exited (code=${code}, signal=${signal})`));
      } else {
        this._removeChild(wHandle);
        if (!this._destroyed && this._children.length < this._opt.size) {
          this._spawnChild();
          this._drain();
        }
      }
    });

    this._children.push(wHandle);
    return wHandle;
  }

  _onMessage(wHandle, msg) {
    if (msg?.id === '__ready__') {
      wHandle.ready = true;
      this._drain();
      return;
    }
    const wJob = wHandle.current;
    if (!wJob || wJob.id !== msg.id) return;
    wHandle.current = null;
    wHandle.jobCount += 1;

    if (msg.ok) wJob.resolve({ ok: true, rc: msg.rc });
    else wJob.reject(Object.assign(new Error(msg.error || `SkExcel child job failed (rc=${msg.rc})`), { rc: msg.rc }));

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

  _onChildDown(wHandle, err) {
    console.warn(`SkExcel child pool: child pid ${wHandle.child?.pid} down after ${wHandle.jobCount} job(s), respawning — ${err.message}`);
    if (wHandle.current) {
      wHandle.current.reject(Object.assign(err, { rc: -3 }));
      wHandle.current = null;
    }
    this._removeChild(wHandle);
    try { wHandle.child.kill('SIGKILL'); } catch (_) { /* already gone */ }
    if (!this._destroyed && this._children.length < this._opt.size) {
      this._spawnChild();
      this._drain();
    }
  }

  _recycle(wHandle, reason = 'job cap') {
    console.log(`SkExcel child pool: recycling pid ${wHandle.child.pid} after ${wHandle.jobCount} job(s) (${reason})`);
    this._removeChild(wHandle);
    // kill -> the OS reclaims the child's full memory (wasm heap included).
    try { wHandle.child.kill(); } catch (_) { /* best effort */ }
    if (!this._destroyed && this._children.length < this._opt.size) this._spawnChild();
  }

  _removeChild(wHandle) {
    const i = this._children.indexOf(wHandle);
    if (i !== -1) this._children.splice(i, 1);
  }

  _drain() {
    if (this._destroyed) return;
    for (const wHandle of this._children) {
      if (!wHandle.ready || wHandle.current) continue;
      const wJob = this._queue.shift();
      if (!wJob) break;
      wHandle.current = wJob;
      if (wJob.heavy) wHandle.recycleAfter = true;
      wHandle.child.send({ id: wJob.id, type: wJob.type, ...wJob.payload });
    }
  }

  _enqueue(type, payload, fileSize) {
    if (this._destroyed) return Promise.reject(new Error('SkExcelChildPool destroyed'));
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
    const wErr = new Error('SkExcelChildPool destroyed');
    for (const wJob of this._queue) wJob.reject(wErr);
    this._queue = [];
    for (const wHandle of this._children) {
      if (wHandle.current) wHandle.current.reject(wErr);
      try { wHandle.child.kill('SIGKILL'); } catch (_) { /* already gone */ }
    }
    this._children = [];
  }
}

let _singleton = null;

/** Lazily create a shared child-process pool for the server process. */
export function getSkExcelChildPool(options) {
  if (!_singleton) _singleton = new SkExcelChildPool(options);
  return _singleton;
}
