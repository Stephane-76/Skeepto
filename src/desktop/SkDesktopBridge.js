// =============================================================================
// Sker Desktop — renderer-side bridge.
// Wires the native File menu (new / open / save / save-as) to the local
// filesystem for .sker workbooks, using the spreadsheet engine already loaded
// in the browser (window.SkUISpreadSheet). No server involved.
// =============================================================================

import { isDesktop, getDesktopBridge } from './SkDesktopMode.js';
import {
  getSpreadsheetSession,
  syncSpreadsheetSession,
  getActiveFile,
  getActiveFilePath,
  subscribe,
} from '../SkActiveFile.js';
import { buildNativeFormatMenuTree } from '../spreadsheet/SkNumberFormatMenu.js';
import { getCommonSpreadsheetMenuModel, VIEW_ZOOM_PRESETS } from '../spreadsheet/SkMenuModel.js';

// Maps a workbook engine URI -> the real disk path it was opened from / saved to.
const workbookDiskPaths = new Map();

let initialized = false;

function baseName(filePath) {
  const parts = String(filePath || '').split(/[\\/]/);
  return parts[parts.length - 1] || 'Untitled.sker';
}

// Native window title: "<file> — Skeepto", or just "Skeepto" when nothing is open.
function desktopWindowTitle(detail) {
  const wName = detail?.meta?.name || (detail?.path ? baseName(detail.path) : '');
  return wName ? `${wName} — Skeepto` : 'Skeepto';
}

// Resolve the shared, serializable menu model (SkMenuModel) into a fully
// concrete tree the Electron main process can render natively: `dynamic` nodes
// (format families + zoom) are replaced by their actual leaf items. Kept free
// of icons/closures so it survives IPC. sFormatTree comes from the WASM catalog
// (buildNativeFormatMenuTree). See electron/main.js buildMenu (nodeToNative).
function resolveMenuModel(sFormatTree) {
  const wDynFormat = {
    'format-number': sFormatTree.number,
    'format-currency': sFormatTree.currency,
    'format-percent': sFormatTree.percent,
    'format-scientific': sFormatTree.scientific,
    'format-date-time': sFormatTree.dateTime,
  };
  // Format items arrive as { label, action } | { separator: true }.
  const wFmtItem = (item) =>
    item && item.separator ? { type: 'separator' } : { label: item.label, action: item.action };

  const wResolveNode = (node) => {
    if (node.type === 'separator') {
      return { type: 'separator' };
    }
    if (node.dynamic === 'zoom') {
      return {
        id: node.id,
        label: node.label,
        children: VIEW_ZOOM_PRESETS.map((percent) => ({
          id: `view-zoom-${percent}`,
          label: `${percent}%`,
          action: `view-zoom-${percent}`,
        })),
      };
    }
    if (node.dynamic && wDynFormat[node.dynamic]) {
      return {
        id: node.id,
        label: node.label,
        children: (wDynFormat[node.dynamic] || []).map(wFmtItem),
      };
    }
    if (Array.isArray(node.children)) {
      return { id: node.id, label: node.label, children: node.children.map(wResolveNode) };
    }
    return {
      id: node.id,
      label: node.label,
      action: node.action,
      ...(node.accelerator ? { accelerator: node.accelerator } : {}),
    };
  };

  return getCommonSpreadsheetMenuModel().map(wResolveNode);
}

// Record an opened/saved/imported file in the native File > Open Recent list.
// kind: 'sker' (native workbook) or 'xlsx' (original imported Excel path).
function recordRecentFile(filePath, kind) {
  const bridge = getDesktopBridge();
  if (!filePath || !bridge || typeof bridge.addRecentFile !== 'function') return;
  bridge.addRecentFile({ path: filePath, name: baseName(filePath), kind });
}

function navigateToSpreadsheet() {
  if (typeof window.__skerNavigate === 'function') {
    window.__skerNavigate('/spreadsheet');
  }
}

// Ask the mounted spreadsheet component to (re)load from the current session.
// Falls back to navigation, which triggers the same load on mount.
function requestSessionLoad() {
  if (typeof window.__skerDesktopLoadFromSession === 'function') {
    window.__skerDesktopLoadFromSession();
  } else {
    navigateToSpreadsheet();
  }
}

/** Remember which disk path backs a given workbook URI (used on save). */
export function rememberWorkbookDiskPath(uri, diskPath) {
  if (uri && diskPath) {
    workbookDiskPaths.set(uri, diskPath);
  }
}

export function getWorkbookDiskPath(uri) {
  return workbookDiskPaths.get(uri) || null;
}

/** Build (without navigating) an untitled-workbook session object. */
function makeNewWorkbookSession() {
  return {
    path: `untitled://${Date.now()}.sker`,
    name: 'Untitled.sker',
    canWrite: true,
    isNew: true,
  };
}

/**
 * Seed an initial untitled-workbook session if none exists yet.
 * Called from App's constructor so the /spreadsheet route resolves on first
 * render (avoids a transient bounce through the server-only virtual disk).
 */
export function seedInitialWorkbookSession() {
  if (!isDesktop) return;
  if (getSpreadsheetSession()?.path) return;
  syncSpreadsheetSession(makeNewWorkbookSession());
}

/** Create a fresh, empty untitled workbook and show it. */
export function newWorkbook() {
  syncSpreadsheetSession(makeNewWorkbookSession());
  requestSessionLoad();
}

/** Open a .sker via the native dialog. */
async function openSkerViaDialog() {
  const bridge = getDesktopBridge();
  if (!bridge) return;
  const filePath = await bridge.chooseOpenPath('sker');
  if (!filePath) return;
  openSkerFromDisk(filePath);
}

/** Point the session at a local .sker file and trigger the load. */
export function openSkerFromDisk(filePath) {
  // The engine keys a workbook by the "uri" field stored inside the .sker JSON
  // (see tApi::ReadJson). The disk path is kept separately (localPath) for
  // reading/saving; the engine URI is resolved from the JSON at load time.
  syncSpreadsheetSession({
    path: filePath,
    name: baseName(filePath),
    canWrite: true,
    localPath: filePath,
  });
  recordRecentFile(filePath, 'sker');
  requestSessionLoad();
}

// Show the busy overlay with a live percentage fed by SkExcel conversion
// progress ticks (sker:xlsx-progress). Returns an unsubscribe that also hides
// the overlay; call it in a finally block.
function beginXlsxBusy(label) {
  const bridge = getDesktopBridge();
  window.__skerSetBusy?.(label, 0);
  const off =
    bridge && typeof bridge.onXlsxProgress === 'function'
      ? bridge.onXlsxProgress((pct) => window.__skerSetBusy?.(label, pct))
      : null;
  return () => {
    if (off) off();
    window.__skerSetBusy?.(null);
  };
}

/** Import an .xlsx: convert to a temp .sker via SkExcelLib, then open it. */
async function importXlsxViaDialog() {
  const bridge = getDesktopBridge();
  if (!bridge || typeof bridge.importXlsx !== 'function') return;

  const xlsxPath = await bridge.chooseOpenPath('xlsx');
  if (!xlsxPath) return;
  await importXlsxFromPath(xlsxPath);
}

/** Convert a given .xlsx to a temp .sker and open it (no dialog). */
async function importXlsxFromPath(xlsxPath) {
  const bridge = getDesktopBridge();
  if (!bridge || typeof bridge.importXlsx !== 'function' || !xlsxPath) return;

  let result;
  const endBusy = beginXlsxBusy('Importing Excel workbook…');
  try {
    result = await bridge.importXlsx(xlsxPath);
  } finally {
    endBusy();
  }
  if (!result?.skerPath) return;

  // Open the converted workbook. localPath points at the temp .sker so Save
  // (to .sker) or Export (to .xlsx) both work from here.
  syncSpreadsheetSession({
    path: result.skerPath,
    name: result.name || baseName(result.skerPath),
    canWrite: true,
    localPath: result.skerPath,
  });
  // Recent list points at the original .xlsx (re-import on reopen), not the
  // throwaway temp .sker.
  recordRecentFile(xlsxPath, 'xlsx');
  requestSessionLoad();
}

/** Export the active workbook to a user-chosen .xlsx via SkExcelLib. */
async function exportActiveWorkbookXlsx() {
  const bridge = getDesktopBridge();
  if (!bridge || typeof bridge.exportXlsx !== 'function' || !window.SkUISpreadSheet) return;

  const session = getSpreadsheetSession();
  const activeUri = window.SkUISpreadSheet.getActiveWorkBook?.();
  const uri = activeUri || session?.path;
  if (!uri) return;

  // Drain any in-flight recalc so the exported workbook is fully consistent.
  await window.SkSpreadSheet?.waitForRecalcIdle?.();

  const json = window.SkUISpreadSheet.writeJson(uri);
  if (typeof json !== 'string' || json.length === 0) {
    console.error('[SkDesktopBridge] writeJson returned no content for export', uri);
    return;
  }

  const wDefaultName = `${(session?.name || 'workbook').replace(/\.sker$/i, '')}.xlsx`;
  const xlsxPath = await bridge.chooseSavePath('xlsx', wDefaultName);
  if (!xlsxPath) return;

  const endBusy = beginXlsxBusy('Exporting to Excel…');
  try {
    await bridge.exportXlsx(json, xlsxPath);
  } finally {
    endBusy();
  }
}

/** Save the active workbook to disk (prompting when needed). */
async function saveActiveWorkbook({ saveAs = false } = {}) {
  const bridge = getDesktopBridge();
  if (!bridge || !window.SkUISpreadSheet) return;

  const session = getSpreadsheetSession();
  const activeUri = window.SkUISpreadSheet.getActiveWorkBook?.();
  const uri = activeUri || session?.path;
  if (!uri) return;

  let diskPath = workbookDiskPaths.get(uri);
  if (saveAs || !diskPath) {
    const defaultName = session?.name || baseName(diskPath || 'Untitled.sker');
    const chosen = await bridge.chooseSavePath('sker', defaultName);
    if (!chosen) return;
    diskPath = chosen;
  }

  // Drain any in-flight background recalc so the saved file is fully consistent.
  await window.SkSpreadSheet?.waitForRecalcIdle?.();

  const json = window.SkUISpreadSheet.writeJson(uri);
  if (typeof json !== 'string' || json.length === 0) {
    console.error('[SkDesktopBridge] writeJson returned no content for', uri);
    return;
  }

  await bridge.writeFile(diskPath, json);
  workbookDiskPaths.set(uri, diskPath);
  syncSpreadsheetSession({
    path: uri,
    name: baseName(diskPath),
    canWrite: true,
  });
  recordRecentFile(diskPath, 'sker');
}

async function handleMenuAction(payload) {
  const action = payload?.action;
  if (!action) return;
  try {
    switch (action) {
      case 'new':
        newWorkbook();
        break;
      case 'open':
        await openSkerViaDialog();
        break;
      case 'save':
        await saveActiveWorkbook({ saveAs: false });
        break;
      case 'save-as':
        await saveActiveWorkbook({ saveAs: true });
        break;
      case 'import-xlsx':
        await importXlsxViaDialog();
        break;
      case 'open-recent':
        if (payload.kind === 'xlsx') {
          await importXlsxFromPath(payload.path);
        } else {
          openSkerFromDisk(payload.path);
        }
        break;
      case 'export-xlsx':
        await exportActiveWorkbookXlsx();
        break;
      default:
        // Everything else is a spreadsheet menu action. It shares the exact
        // same action ids as the web top menu and is executed by the mounted
        // SkSpreadSheet component (see handleSpreadsheetMenuAction).
        if (typeof window.__skerHandleSpreadsheetMenuAction === 'function') {
          window.__skerHandleSpreadsheetMenuAction(action);
        } else {
          console.warn('[SkDesktopBridge] no spreadsheet handler for action:', action);
        }
        break;
    }
  } catch (err) {
    console.error('[SkDesktopBridge] menu action failed:', action, err);
  }
}

/** Install the desktop bridge (idempotent). No-op on the web build. */
export function initDesktopBridge() {
  if (!isDesktop || initialized) return;
  initialized = true;

  const bridge = getDesktopBridge();
  bridge.onMenu(handleMenuAction);

  // Signal the main process that the menu listener is live. It uses this to
  // dispatch any File > New/Open/Import action queued while this window was
  // being (re)created after the last one was closed (macOS keeps the app alive).
  if (typeof bridge.rendererReady === 'function') {
    bridge.rendererReady();
  }

  // Keep the native window title in sync with the active workbook (the top bar
  // that used to show the file path is hidden on desktop — see SkTopPanel).
  if (typeof bridge.setWindowTitle === 'function') {
    const pushWindowTitle = (detail) => {
      try {
        bridge.setWindowTitle(desktopWindowTitle(detail));
      } catch (err) {
        console.error('[SkDesktopBridge] setWindowTitle failed:', err);
      }
    };
    pushWindowTitle({ path: getActiveFilePath(), meta: getActiveFile() });
    subscribe(pushWindowTitle);
  }

  // Push the whole common spreadsheet menu (single source: SkMenuModel) to the
  // native menu. The format submenus come from the WASM catalog (renderer only),
  // so the main process cannot build them itself. 'skFormatMenuReady' fires when
  // the catalog fills and again when localized example labels arrive, keeping
  // the native Format submenu in sync.
  if (typeof bridge.setMenuModel === 'function') {
    // Returns true once the WASM catalog is populated (Numeric family present).
    const pushMenuModel = () => {
      try {
        const wTree = buildNativeFormatMenuTree();
        bridge.setMenuModel(resolveMenuModel(wTree));
        return Array.isArray(wTree.number) && wTree.number.length > 0;
      } catch (err) {
        console.error('[SkDesktopBridge] setMenuModel failed:', err);
        return false;
      }
    };
    window.addEventListener('skFormatMenuReady', pushMenuModel);
    // The native menu is built before WASM loads, so poll until the catalog is
    // ready (then the event keeps it in sync for locale/example updates).
    if (!pushMenuModel()) {
      let wTries = 0;
      const wTimer = setInterval(() => {
        wTries += 1;
        if (pushMenuModel() || wTries > 120) {
          clearInterval(wTimer);
        }
      }, 500);
    }
  }

  // Land on an empty workbook if nothing is open yet (session usually seeded
  // earlier by seedInitialWorkbookSession from App's constructor).
  if (!getSpreadsheetSession()?.path) {
    newWorkbook();
  }
}
