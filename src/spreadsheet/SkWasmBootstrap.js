//=============================================================================
// Minimal WASM bootstrap for JsonView embed (text editor, no full grid UI).
//=============================================================================
import SkUISpreadSheet from './SkUISpreadSheet.js';
import SkCellClassContainer from './CellClass/SkCellClassContainer.js';
import { invalidateFloatingObjectsExportCache } from './SkFloatingObjectsExportCache.js';
import {
  closeWorkbookOnServer,
  fetchWorkbookJsonAndOpenOnServer,
  fetchWorkbookJsonFromContentEndpoint,
} from './SkeeptoServerApi.js';
import { runCooperativeRecalculateAll } from './SkCooperativeRecalc.js';

let cellClassesReady = false;
let bootstrapPromise = null;
/** Workbook URIs present before text-editor embed touched WASM (for teardown). */
let embedBaselineUris = null;
/** URIs opened on server WASM during this embed session (must be closed on teardown). */
let embedServerOpenedUris = null;

function waitForWasmModule(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (window.__SkModuleReady && window.SpreadSheet?.UISpreadSheet) {
        resolve();
        return;
      }
      if (typeof window.SkCreateModule === 'function' && !window.__SkWasmLoading && !window.__SkModuleReady) {
        window.SkCreateModule().catch((err) => {
          console.error('[spreadsheetEngineBootstrap] SkCreateModule failed', err);
        });
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('Timeout en attente du module WASM tableur.'));
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

/** Ensure SkUISpreadSheet + cell classes are ready (safe to call from text editor). */
export async function ensureSpreadsheetEngine() {
  if (bootstrapPromise) {
    return bootstrapPromise;
  }
  bootstrapPromise = (async () => {
    if (!window.SkUISpreadSheet) {
      await waitForWasmModule();
      window.SkUISpreadSheet = new SkUISpreadSheet();
      window.SkUISpreadSheet.init();
    }
      await window.SkUISpreadSheet.whenEngineReady();
    if (!cellClassesReady) {
      // eslint-disable-next-line no-new
      new SkCellClassContainer();
      cellClassesReady = true;
    }
  })();
  try {
    await bootstrapPromise;
  } catch (err) {
    bootstrapPromise = null;
    throw err;
  }
}

function listWorkbookUrisInMemory() {
  return window.SkUISpreadSheet.listWorkBookUris?.() ?? [];
}

/**
 * Remember WASM workbooks before text-editor embed loads any .sker for JsonView.
 * Call from SkTextEditor mount; paired with endSpreadsheetEmbedSession on unmount.
 */
export async function beginSpreadsheetEmbedSession() {
  await ensureSpreadsheetEngine();
  if (embedBaselineUris !== null) {
    return;
  }
  embedBaselineUris = new Set(await listWorkbookUrisInMemory());
  embedServerOpenedUris = new Set();
  invalidateFloatingObjectsExportCache();
}

/**
 * Drop workbooks loaded only for text-editor embed (keeps pre-session URIs).
 * Also releases any server WASM opens tracked during the embed session.
 */
export async function releaseSpreadsheetEmbedWorkbooks() {
  const wClientUris = [];
  if (embedBaselineUris !== null && window.SkUISpreadSheet?.deleteWorkBook) {
    try {
      const current = await listWorkbookUrisInMemory();
      for (const uri of current) {
        if (!embedBaselineUris.has(uri)) {
          wClientUris.push(uri);
          try {
            window.SkUISpreadSheet.deleteWorkBook(uri);
          } catch (_err) {
            /* best effort */
          }
        }
      }
    } catch (_err) {
      /* ignore */
    }
  }

  // Close server copies: tracked opens + client-deleted URIs (covers legacy openOnServer embeds).
  const wServerClose = new Set([
    ...(embedServerOpenedUris ? Array.from(embedServerOpenedUris) : []),
    ...wClientUris,
  ]);
  for (const uri of wServerClose) {
    try {
      await closeWorkbookOnServer(uri, { immediate: true });
    } catch (_err) {
      /* best effort */
    }
  }
  if (embedServerOpenedUris) {
    embedServerOpenedUris.clear();
  }
}

/** End embed session and remove temporary workbooks from client + server WASM. */
export async function endSpreadsheetEmbedSession() {
  await releaseSpreadsheetEmbedWorkbooks();
  embedBaselineUris = null;
  embedServerOpenedUris = null;
  invalidateFloatingObjectsExportCache();
}

/**
 * Load workbook JSON into client WASM if needed and activate it.
 * Text-editor embeds default to content-only (no server WASM) so formats are not leaked.
 * @param {string} workbookPath — absolute virtual disk path
 * @param {{ forceReload?: boolean, skipRecalculate?: boolean, openOnServer?: boolean }} [options]
 */
export async function ensureWorkbookLoaded(workbookPath, options = {}) {
  await ensureSpreadsheetEngine();
  const uri = String(workbookPath || '').trim();
  if (!uri.startsWith('/')) {
    throw new Error('the workbook path must be absolute after resolution.');
  }

  const uris = await listWorkbookUrisInMemory();
  const inMemory = uris.includes(uri);
  const shouldReload = options.forceReload === true || !inMemory;
  // Embeds must not keep server WASM warm — only the full spreadsheet UI opens on server.
  const openOnServer = options.openOnServer === true;

  if (shouldReload) {
    try {
      window.SkUISpreadSheet.deleteWorkBook(uri);
    } catch (_err) {
      /* may not exist yet */
    }
    const added = window.SkUISpreadSheet.addWorkBook(uri);
    if (added !== true) {
      throw new Error(`Impossible d'ajouter le classeur : ${uri}`);
    }
    const json = openOnServer
      ? await fetchWorkbookJsonAndOpenOnServer(uri)
      : await fetchWorkbookJsonFromContentEndpoint(uri);
    if (openOnServer && embedServerOpenedUris) {
      embedServerOpenedUris.add(uri);
    }
    const readOk = window.SkUISpreadSheet.readJson(json);
    if (!readOk) {
      throw new Error('ReadJson a échoué pour le classeur.');
    }
    invalidateFloatingObjectsExportCache();
    if (
      options.skipRecalculate !== true &&
      typeof window.SkUISpreadSheet.recalculateAll === 'function'
    ) {
      await runCooperativeRecalculateAll({ budgetMs: 8 });
    }
  }

  window.SkUISpreadSheet.setActiveWorkBook(uri);
  return uri;
}

/** User-visible sheet names for the active workbook. */
export async function listWorkbookSheets() {
  await ensureSpreadsheetEngine();
  const raw = window.SkUISpreadSheet.sheetsList();
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const list = Array.isArray(data?.list) ? data.list : [];
  return list.filter((name) => typeof name === 'string' && !name.startsWith('_$$'));
}
