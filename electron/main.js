// =============================================================================
// Sker Desktop — Electron main process
// Loads the existing web build (build/) in a native window, without any server,
// login or collaboration. Exposes native File menu + fs/dialog over IPC so the
// renderer can read/write local .sker (and, later, .xlsx) files.
// =============================================================================

const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const skExcel = require('./SkExcelConvert');

// Note: WebAssembly Memory64 is enabled by default from Chromium 133 (this
// Electron ships Chromium 150), so no V8 flag is needed. Older Electron (<= 32 /
// Chromium 128) required app.commandLine.appendSwitch('js-flags',
// '--experimental-wasm-memory64'); that flag is now unrecognized and must NOT be
// re-added, or Chromium logs "unrecognized flag" at startup.

// -----------------------------------------------------------------------------
// Minimal static file server for the CRA production build.
// We serve over http://127.0.0.1 (not file://) because the spreadsheet engine
// is loaded through a dynamic ES module import (SkReactSpreadSheet.mjs), which
// Chromium refuses to resolve over the file:// scheme.
// -----------------------------------------------------------------------------
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        let relPath = urlPath === '/' ? '/index.html' : urlPath;

        // Resolve inside rootDir and prevent path traversal.
        const absPath = path.normalize(path.join(rootDir, relPath));
        if (!absPath.startsWith(rootDir)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }

        fs.stat(absPath, (err, stat) => {
          // SPA fallback: unknown non-file routes serve index.html.
          if (err || !stat.isFile()) {
            const indexPath = path.join(rootDir, 'index.html');
            fs.readFile(indexPath, (indexErr, buf) => {
              if (indexErr) {
                res.statusCode = 404;
                res.end('Not found');
                return;
              }
              res.setHeader('Content-Type', MIME_TYPES['.html']);
              res.end(buf);
            });
            return;
          }

          const ext = path.extname(absPath).toLowerCase();
          res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
          fs.createReadStream(absPath).pipe(res);
        });
      } catch (e) {
        res.statusCode = 500;
        res.end('Server error');
      }
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

// -----------------------------------------------------------------------------
// Window + menu
// -----------------------------------------------------------------------------
let mainWindow = null;

// Common spreadsheet menu tree (Edit/Format/View/Named/Tools/Help) pushed by the
// renderer from the shared SkMenuModel (format submenus filled from the WASM
// catalog). null until the renderer sends it; only File/Window show meanwhile.
let menuModel = null;

// --- Recent files -----------------------------------------------------------
// Persisted list of recently opened workbooks, shown under File > Open Recent.
// Stored as JSON in the app's userData dir. Entries: { path, name, kind } where
// kind is 'sker' (native workbook) or 'xlsx' (imported Excel, original path).
const RECENT_FILES_MAX = 12;
let recentFiles = [];

function recentFilesStorePath() {
  return path.join(app.getPath('userData'), 'recent-files.json');
}

function loadRecentFiles() {
  try {
    const raw = fs.readFileSync(recentFilesStorePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    recentFiles = Array.isArray(parsed)
      ? parsed.filter((e) => e && typeof e.path === 'string' && e.path)
      : [];
  } catch {
    recentFiles = [];
  }
}

function persistRecentFiles() {
  try {
    fs.writeFileSync(
      recentFilesStorePath(),
      JSON.stringify(recentFiles, null, 2),
      'utf-8',
    );
  } catch (e) {
    console.warn('[recent] persist failed:', e?.message || e);
  }
}

// Push an entry to the front (most-recent-first), de-duplicated by path, and
// rebuild the native menu so File > Open Recent reflects the change.
function addRecentFile(entry) {
  if (!entry || !entry.path) return;
  const wKind = entry.kind === 'xlsx' ? 'xlsx' : 'sker';
  const wName = entry.name || path.basename(entry.path);
  recentFiles = [
    { path: entry.path, name: wName, kind: wKind },
    ...recentFiles.filter((e) => e.path !== entry.path),
  ].slice(0, RECENT_FILES_MAX);
  persistRecentFiles();
  try {
    app.addRecentDocument(entry.path);
  } catch {
    // Non-macOS or unsupported: the custom submenu still works.
  }
  buildMenu();
}

function clearRecentFiles() {
  recentFiles = [];
  persistRecentFiles();
  try {
    app.clearRecentDocuments();
  } catch {
    // no-op
  }
  buildMenu();
}

// Open a recent entry, recreating a window when needed. A missing file is
// dropped from the list with a notice instead of failing silently.
function openRecentEntry(entry) {
  if (!entry || !entry.path) return;
  if (!fs.existsSync(entry.path)) {
    dialog.showErrorBox('File not found', `"${entry.path}" no longer exists.`);
    recentFiles = recentFiles.filter((e) => e.path !== entry.path);
    persistRecentFiles();
    buildMenu();
    return;
  }
  ensureWindowThen('open-recent', { path: entry.path, kind: entry.kind });
}

// --- Last-used directory ----------------------------------------------------
// Remember, per file kind, the folder of the last Open/Save so the native
// dialog reopens there instead of the OS default. Persisted in userData.
let lastDirs = { sker: '', xlsx: '' };

function lastDirsStorePath() {
  return path.join(app.getPath('userData'), 'dialog-dirs.json');
}

function loadLastDirs() {
  try {
    const parsed = JSON.parse(fs.readFileSync(lastDirsStorePath(), 'utf-8'));
    lastDirs = {
      sker: typeof parsed?.sker === 'string' ? parsed.sker : '',
      xlsx: typeof parsed?.xlsx === 'string' ? parsed.xlsx : '',
    };
  } catch {
    lastDirs = { sker: '', xlsx: '' };
  }
}

function rememberDir(kind, filePath) {
  if (!filePath) return;
  const wKind = kind === 'xlsx' ? 'xlsx' : 'sker';
  lastDirs[wKind] = path.dirname(filePath);
  try {
    fs.writeFileSync(lastDirsStorePath(), JSON.stringify(lastDirs, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[dialog-dirs] persist failed:', e?.message || e);
  }
}

// Last folder for this kind, only if it still exists (else undefined → OS default).
function dialogDirFor(kind) {
  const wKind = kind === 'xlsx' ? 'xlsx' : 'sker';
  const wDir = lastDirs[wKind];
  return wDir && fs.existsSync(wDir) ? wDir : undefined;
}

// --- Memory diagnostics ------------------------------------------------------
// Poll app.getAppMetrics() to log each Electron process's working set. The 'Tab'
// process is the renderer that hosts the WASM engine; watch its size grow during
// heavy operations (e.g. _Pressure) to tell a slow CPU stall from a real OOM.
let memorySamplerTimer = null;

function formatMB(kib) {
  return `${Math.round((Number(kib) || 0) / 1024)} MB`;
}

// One-shot dump of current per-process memory (labelled with the trigger).
function logRendererMemory(tag) {
  try {
    for (const m of app.getAppMetrics()) {
      // memory.workingSetSize / peakWorkingSetSize are in KiB.
      const wWs = formatMB(m.memory?.workingSetSize);
      const wPeak = formatMB(m.memory?.peakWorkingSetSize);
      console.log(`[mem:${tag}] pid=${m.pid} type=${m.type} ws=${wWs} peak=${wPeak}`);
    }
  } catch (e) {
    console.warn('[mem] getAppMetrics failed:', e?.message || e);
  }
}

function startMemorySampler() {
  if (memorySamplerTimer) return;
  // 2 s cadence keeps the log readable while still catching a fast climb.
  memorySamplerTimer = setInterval(() => logRendererMemory('sample'), 2000);
}

function stopMemorySampler() {
  if (memorySamplerTimer) {
    clearInterval(memorySamplerTimer);
    memorySamplerTimer = null;
  }
}

function sendMenuAction(action, extra = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sker:menu', { action, ...extra });
  }
}

// Forward SkExcel conversion progress (0–100) to the renderer's busy overlay.
function sendXlsxProgress(pct) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sker:xlsx-progress', pct);
  }
}

// Menu action to dispatch once a freshly created window's renderer signals it
// is ready (see the 'sker:renderer-ready' handler). Lets File > New/Open work
// even after the last window was closed (macOS keeps the app + menu bar alive).
let pendingMenuAction = null;

// Dispatch a menu action, recreating the window first when none is open.
async function ensureWindowThen(action, extra = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    sendMenuAction(action, extra);
    return;
  }
  pendingMenuAction = { action, extra };
  await createWindow();
}

function buildMenu() {
  const isMac = process.platform === 'darwin';

  // Helper: a menu item that dispatches a spreadsheet action id to the renderer
  // (same ids as the web top menu — handled by handleSpreadsheetMenuAction).
  const sp = (label, action, accelerator) => ({
    label,
    ...(accelerator ? { accelerator } : {}),
    click: () => sendMenuAction(action),
  });

  // Convert a serialized menu node (from the renderer's SkMenuModel, resolved by
  // SkDesktopBridge and pushed via 'sker:set-menu-model') into a native Electron
  // menu item. `dynamic` nodes (format families + zoom) are already expanded
  // into concrete `children` before they reach us.
  const nodeToNative = (node) => {
    if (!node || node.type === 'separator') {
      return { type: 'separator' };
    }
    if (Array.isArray(node.children)) {
      return { label: node.label, submenu: node.children.map(nodeToNative) };
    }
    return {
      label: node.label,
      ...(node.accelerator ? { accelerator: node.accelerator } : {}),
      click: () => sendMenuAction(node.action),
    };
  };

  // Platform-specific menus (not part of the shared model).
  const appMenu = {
    label: app.name,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };

  const fileMenu = {
    label: 'File',
    submenu: [
      {
        label: 'New',
        accelerator: 'CmdOrCtrl+N',
        click: () => ensureWindowThen('new'),
      },
      {
        label: 'Open…',
        accelerator: 'CmdOrCtrl+O',
        click: () => ensureWindowThen('open'),
      },
      {
        label: 'Open Recent',
        submenu:
          recentFiles.length === 0
            ? [{ label: 'No Recent Files', enabled: false }]
            : [
                ...recentFiles.map((entry) => ({
                  label: entry.name || path.basename(entry.path),
                  toolTip: entry.path,
                  click: () => openRecentEntry(entry),
                })),
                { type: 'separator' },
                { label: 'Clear Recent', click: () => clearRecentFiles() },
              ],
      },
      { type: 'separator' },
      {
        label: 'Save',
        accelerator: 'CmdOrCtrl+S',
        click: () => sendMenuAction('save'),
      },
      {
        label: 'Save As…',
        accelerator: 'CmdOrCtrl+Shift+S',
        click: () => sendMenuAction('save-as'),
      },
      { type: 'separator' },
      {
        label: 'Import Excel…',
        click: () => ensureWindowThen('import-xlsx'),
      },
      {
        label: 'Export Excel…',
        click: () => sendMenuAction('export-xlsx'),
      },
      { type: 'separator' },
      // Print lives under File on desktop (the web menu puts it under Edit).
      sp('Print…', 'format-print'),
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  };

  const windowMenu = {
    label: 'Window',
    submenu: [
      { role: 'resetZoom', label: 'Actual Size' },
      { role: 'zoomIn', label: 'Zoom In' },
      { role: 'zoomOut', label: 'Zoom Out' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'Full Screen' },
    ],
  };

  // Common menus (Edit / Format / View / Named / Tools / Help) come from the
  // shared model pushed by the renderer. Until it arrives (the native menu is
  // built before WASM loads), only the platform-specific menus show.
  const commonMenus = (menuModel || []).map((menu) => ({
    id: menu.id,
    native: { label: menu.label, submenu: (menu.children || []).map(nodeToNative) },
  }));
  const helpMenu = commonMenus.find((m) => m.id === 'help')?.native;
  const midMenus = commonMenus.filter((m) => m.id !== 'help').map((m) => m.native);

  const template = [
    ...(isMac ? [appMenu] : []),
    fileMenu,
    ...midMenus,
    windowMenu,
    ...(helpMenu ? [{ role: 'help', ...helpMenu }] : []),
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, '..', 'build-resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // The window title reflects the active workbook (set via sker:set-window-title
  // from the renderer). Prevent the page <title> ("Skeepto") from taking
  // it over on every navigation/reload.
  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
  });
  mainWindow.setTitle('Skeepto');

  // Diagnostics: surface renderer console + load failures in the terminal.
  // Electron >= 36 passes a single event object ({ level, message, lineNumber,
  // sourceId }). Use a single-arg listener to avoid the deprecation warning,
  // with a fallback to the old positional form for older Electron.
  mainWindow.webContents.on('console-message', (e) => {
    if (e && typeof e === 'object' && 'message' in e) {
      console.log(`[renderer:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
    }
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[did-fail-load] ${code} ${desc} ${url}`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    // details.reason === 'oom' means a true out-of-memory crash; 'crashed' is generic.
    console.error('[render-process-gone]', details);
    stopMemorySampler();
  });

  // --- Freeze vs OOM diagnostics ---------------------------------------------
  // 'unresponsive' fires when the renderer's main thread is blocked (e.g. a long
  // synchronous WASM call like _Pressure). Pairing it with 'responsive' tells us
  // how long the UI was frozen — a pure CPU stall, not necessarily memory.
  let unresponsiveSince = 0;
  mainWindow.webContents.on('unresponsive', () => {
    unresponsiveSince = Date.now();
    console.warn('[unresponsive] renderer main thread blocked — UI frozen');
    logRendererMemory('unresponsive');
  });
  mainWindow.webContents.on('responsive', () => {
    const wMs = unresponsiveSince ? Date.now() - unresponsiveSince : 0;
    unresponsiveSince = 0;
    console.warn(`[responsive] renderer recovered after ${wMs} ms frozen`);
  });

  // Sample per-process memory so we can watch the renderer RSS climb (toward the
  // 8 GiB wasm ceiling) during heavy operations, and correlate a freeze with OOM.
  startMemorySampler();

  const devUrl = process.env.ELECTRON_START_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const buildDir = path.join(__dirname, '..', 'build');
    const baseUrl = await startStaticServer(buildDir);
    await mainWindow.loadURL(baseUrl);
  }

  mainWindow.on('closed', () => {
    stopMemorySampler();
    mainWindow = null;
  });
}

// -----------------------------------------------------------------------------
// IPC: filesystem + native dialogs
// -----------------------------------------------------------------------------
const SKER_FILTERS = [{ name: 'Skeepto Workbook', extensions: ['sker'] }];
const XLSX_FILTERS = [{ name: 'Excel Workbook', extensions: ['xlsx'] }];

ipcMain.handle('sker:read-file', async (_evt, filePath) => {
  return fs.promises.readFile(filePath, 'utf-8');
});

ipcMain.handle('sker:write-file', async (_evt, { path: filePath, contents }) => {
  await fs.promises.writeFile(filePath, contents, 'utf-8');
  return true;
});

ipcMain.handle('sker:open-dialog', async (_evt, kind) => {
  const filters = kind === 'xlsx' ? XLSX_FILTERS : SKER_FILTERS;
  const wDir = dialogDirFor(kind);
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    ...(wDir ? { defaultPath: wDir } : {}),
    filters,
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  rememberDir(kind, result.filePaths[0]);
  return result.filePaths[0];
});

ipcMain.handle('sker:save-dialog', async (_evt, { kind, defaultName }) => {
  const filters = kind === 'xlsx' ? XLSX_FILTERS : SKER_FILTERS;
  const wDir = dialogDirFor(kind);
  // Seed both the folder (last used) and the file name so the dialog lands in
  // the right place with a sensible suggested name.
  const wDefaultPath = wDir
    ? path.join(wDir, defaultName || '')
    : defaultName || undefined;
  const result = await dialog.showSaveDialog(mainWindow, {
    ...(wDefaultPath ? { defaultPath: wDefaultPath } : {}),
    filters,
  });
  if (result.canceled || !result.filePath) return null;
  rememberDir(kind, result.filePath);
  return result.filePath;
});

// The renderer pushes the whole common spreadsheet menu (from the shared
// SkMenuModel) once the WASM engine is ready (and again when localized format
// labels arrive). Rebuild the native menu from it.
ipcMain.on('sker:set-menu-model', (_evt, model) => {
  menuModel = Array.isArray(model) ? model : null;
  buildMenu();
});

// The renderer's desktop bridge finished wiring its menu listener. Dispatch any
// action queued while the window was being (re)created (e.g. File > Open after
// the last window was closed).
ipcMain.on('sker:renderer-ready', () => {
  if (pendingMenuAction) {
    const { action: wAction, extra: wExtra } = pendingMenuAction;
    pendingMenuAction = null;
    sendMenuAction(wAction, wExtra);
  }
});

// The renderer records a freshly opened/saved/imported file so it appears under
// File > Open Recent. entry: { path, name, kind: 'sker' | 'xlsx' }.
ipcMain.on('sker:add-recent', (_evt, entry) => {
  addRecentFile(entry);
});

// Update the native window title to reflect the active workbook. The renderer
// sends the fully-formatted string (e.g. "Budget.xlsx — Skeepto").
ipcMain.on('sker:set-window-title', (_evt, title) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(title && String(title).trim() ? String(title) : 'Skeepto');
  }
});

// Import: convert a user-chosen .xlsx to a temp .sker (via SkExcelLib in a
// worker) and return the .sker path for the renderer to open.
ipcMain.handle('sker:import-xlsx', async (_evt, xlsxPath) => {
  if (!xlsxPath) return null;
  try {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sker-xlsx-'));
    const wBase = path.basename(xlsxPath, path.extname(xlsxPath));
    // Copy into the temp dir so the generated .sker lands there, not next to the
    // user's original file (skexcel_convert writes the .sker beside the xlsx).
    const wTmpXlsx = path.join(tmpDir, `${wBase}.xlsx`);
    await fs.promises.copyFile(xlsxPath, wTmpXlsx);

    const wSkerName = `${wBase}.sker`;
    const wSkerPath = path.join(tmpDir, wSkerName);
    const wResult = await skExcel.importXlsx({ xlsxPath: wTmpXlsx, uri: wSkerName }, sendXlsxProgress);
    if (!wResult.ok || !fs.existsSync(wSkerPath)) {
      throw new Error(`rc=${wResult.rc}${wResult.error ? `: ${wResult.error}` : ''}`);
    }
    return { skerPath: wSkerPath, name: wSkerName };
  } catch (err) {
    dialog.showErrorBox(
      'Excel import failed',
      `Could not import "${path.basename(xlsxPath)}".\n\n${err?.message || err}`,
    );
    return { error: String(err?.message || err) };
  }
});

// Export: write the current workbook JSON to a temp .sker, convert it to xlsx
// at the chosen destination path.
ipcMain.handle('sker:export-xlsx', async (_evt, { skerContent, xlsxPath }) => {
  if (!skerContent || !xlsxPath) return { ok: false };
  try {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sker-xlsx-'));
    const wSkerPath = path.join(tmpDir, 'workbook.sker');
    await fs.promises.writeFile(wSkerPath, skerContent, 'utf8');

    const wResult = await skExcel.exportXlsx({ skerPath: wSkerPath, xlsxPath }, sendXlsxProgress);
    if (!wResult.ok || !fs.existsSync(xlsxPath)) {
      throw new Error(`rc=${wResult.rc}${wResult.error ? `: ${wResult.error}` : ''}`);
    }
    return { ok: true, xlsxPath };
  } catch (err) {
    dialog.showErrorBox(
      'Excel export failed',
      `Could not export to "${path.basename(xlsxPath)}".\n\n${err?.message || err}`,
    );
    return { ok: false, error: String(err?.message || err) };
  }
});

// -----------------------------------------------------------------------------
// App lifecycle
// -----------------------------------------------------------------------------
app.whenReady().then(() => {
  loadRecentFiles();
  loadLastDirs();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
