// =============================================================================
// Sker Desktop — preload
// Exposes a minimal, safe bridge (window.skerDesktop) to the renderer.
// No Node APIs leak into the page: everything goes through IPC to the main
// process (contextIsolation on, nodeIntegration off).
// =============================================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('skerDesktop', {
  // Native File-menu actions pushed from the main process.
  // callback receives { action: 'new' | 'open' | 'save' | 'save-as', ... }.
  onMenu(callback) {
    const listener = (_evt, payload) => callback(payload);
    ipcRenderer.on('sker:menu', listener);
    return () => ipcRenderer.removeListener('sker:menu', listener);
  },

  // Read a local file as UTF-8 text (used for .sker JSON).
  readFile(filePath) {
    return ipcRenderer.invoke('sker:read-file', filePath);
  },

  // Write UTF-8 text to a local file.
  writeFile(filePath, contents) {
    return ipcRenderer.invoke('sker:write-file', { path: filePath, contents });
  },

  // Native open dialog. kind: 'sker' | 'xlsx'. Resolves to a path or null.
  chooseOpenPath(kind = 'sker') {
    return ipcRenderer.invoke('sker:open-dialog', kind);
  },

  // Native save dialog. Resolves to a path or null.
  chooseSavePath(kind = 'sker', defaultName = '') {
    return ipcRenderer.invoke('sker:save-dialog', { kind, defaultName });
  },

  // Push the whole common spreadsheet menu tree (single source: SkMenuModel,
  // resolved in the renderer where the WASM format catalog lives) so the main
  // process can render the native menu. Each node is serializable:
  //   { id, label, action, accelerator? } | { type: 'separator' } | { children }.
  setMenuModel(model) {
    ipcRenderer.send('sker:set-menu-model', model);
  },

  // Import an .xlsx (converted locally via SkExcelLib). Resolves to
  // { skerPath, name } — a temp .sker the renderer can open.
  importXlsx(xlsxPath) {
    return ipcRenderer.invoke('sker:import-xlsx', xlsxPath);
  },

  // Export the current workbook JSON to an .xlsx at xlsxPath. Resolves to
  // { ok, xlsxPath }.
  exportXlsx(skerContent, xlsxPath) {
    return ipcRenderer.invoke('sker:export-xlsx', { skerContent, xlsxPath });
  },

  // Subscribe to SkExcel conversion progress ticks (0–100). Returns an
  // unsubscribe function. Emitted during import/export while the worker runs.
  onXlsxProgress(callback) {
    const listener = (_evt, pct) => callback(pct);
    ipcRenderer.on('sker:xlsx-progress', listener);
    return () => ipcRenderer.removeListener('sker:xlsx-progress', listener);
  },

  // Tell the main process the menu listener is wired, so it can dispatch any
  // action queued while a (re)created window finished loading.
  rendererReady() {
    ipcRenderer.send('sker:renderer-ready');
  },

  // Set the native window title (desktop only), e.g. "Budget.xlsx — Skeepto".
  setWindowTitle(title) {
    ipcRenderer.send('sker:set-window-title', title);
  },

  // Record a freshly opened/saved/imported file so it shows under
  // File > Open Recent. entry: { path, name, kind: 'sker' | 'xlsx' }.
  addRecentFile(entry) {
    ipcRenderer.send('sker:add-recent', entry);
  },
});
