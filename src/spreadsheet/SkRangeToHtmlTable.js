//=============================================================================
// Workbook/sheet/range → JsonView (sCss=true) → HTML table.
//=============================================================================
import SkCellClass from './CellClass/SkCellClass.js';
import { parseRangeBoundsSync } from './SkA1Ref.js';
import { hydrateJsonViewCellFormats } from './SkJsonViewFormatHydrate.js';
import { jsonViewToHtmlTable } from './SkJsonViewToHtmlTable.js';
import {
  ensureSpreadsheetEngine,
  ensureWorkbookLoaded,
  listWorkbookSheets,
} from './SkWasmBootstrap.js';
import { getSpreadsheetSession } from '../SkActiveFile.js';

const CELL_REF_RE = /^([A-Za-z]+\d+(?::[A-Za-z]+\d+)?)$/i;

function normalizeVirtualPath(path) {
  if (!path || typeof path !== 'string') return '';
  let out = path.replace(/\/+/g, '/');
  if (out.length > 1 && out.endsWith('/')) {
    out = out.slice(0, -1);
  }
  return out;
}

function resolveRelativePath(baseDir, relativePath) {
  const baseParts = normalizeVirtualPath(baseDir).split('/').filter(Boolean);
  const relParts = String(relativePath || '').split('/').filter(Boolean);
  for (const part of relParts) {
    if (part === '.') continue;
    if (part === '..') {
      baseParts.pop();
    } else {
      baseParts.push(part);
    }
  }
  return baseParts.length === 0 ? '/' : `/${baseParts.join('/')}`;
}

/**
 * Resolve workbook path for embed:
 * - `/Documents/foo.sker` → absolute
 * - `./foo.sker`, `../data/foo.sker` → relative to documentPath directory
 * @param {string} workbookPath
 * @param {string} [documentPath] — open .html path on virtual disk
 */
export function resolveWorkbookPath(workbookPath, documentPath = '') {
  const raw = String(workbookPath || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/')) {
    return normalizeVirtualPath(raw);
  }
  const docPath = normalizeVirtualPath(String(documentPath || '').trim());
  const docDir = docPath.includes('/')
    ? docPath.slice(0, docPath.lastIndexOf('/')) || '/'
    : '/';
  return normalizeVirtualPath(resolveRelativePath(docDir, raw));
}


/**
 * Parse A1 or A1:B2 into sheet indices (1-based).
 * @param {string} rangeRef
 * @returns {{ top: number, left: number, bottom: number, right: number } | null}
 */
export function parseRangeBounds(rangeRef) {
  return parseRangeBoundsSync(rangeRef);
}

/**
 * Parse refs like:
 * - B2:J10
 * - Sheet1!B2:J10
 * - /home/user/workbook.sker.Sheet1.B2:J10
 * @param {string} ref
 * @returns {{ workbookPath: string, sheet: string, range: string } | null}
 */
export function parseSkerRangeRef(ref) {
  const text = String(ref || '').trim();
  if (!text) return null;

  const bangIdx = SkCellClass.findSheetRangeSeparator(text);
  if (bangIdx >= 0) {
    const sheet = SkCellClass.unquoteSheetName(text.slice(0, bangIdx));
    const range = text.slice(bangIdx + 1).trim();
    if (!CELL_REF_RE.test(range)) return null;
    return { workbookPath: '', sheet, range };
  }

  const rangeMatch = text.match(/([A-Za-z]+\d+(?::[A-Za-z]+\d+)?)$/i);
  if (!rangeMatch) return null;
  const range = rangeMatch[1];
  let rest = text.slice(0, text.length - range.length).replace(/\.$/, '').trim();
  if (!rest) {
    return { workbookPath: '', sheet: '', range };
  }

  const lastDot = rest.lastIndexOf('.');
  if (lastDot < 0) {
    return { workbookPath: '', sheet: rest, range };
  }

  return {
    workbookPath: rest.slice(0, lastDot),
    sheet: rest.slice(lastDot + 1),
    range,
  };
}

/**
 * Load sheet list for a workbook path (relative paths resolved against documentPath).
 * @param {string} workbookPath
 * @param {string} [documentPath]
 */
export async function loadSheetsForWorkbookPath(workbookPath, documentPath = '') {
  const resolved = resolveWorkbookPath(workbookPath, documentPath);
  if (!resolved) {
    throw new Error('Enter the workbook path (.sker).');
  }
  if (!resolved.toLowerCase().endsWith('.sker')) {
    throw new Error('The file must have a .sker extension.');
  }
  await ensureWorkbookLoaded(resolved, { skipRecalculate: true });
  const sheets = await listWorkbookSheets();
  if (sheets.length === 0) {
    throw new Error('This workbook has no sheets.');
  }
  return { resolvedWorkbookPath: resolved, sheets };
}

/**
 * @param {{ workbookPath: string, sheet: string, range: string, documentPath?: string }} selection
 * @returns {Promise<string>} HTML table
 */
export async function rangeSelectionToHtmlTable(selection) {
  const workbookInput = String(selection?.workbookPath || '').trim();
  const sheet = String(selection?.sheet || '').trim();
  const range = String(selection?.range || '').trim();
  const documentPath = String(selection?.documentPath || '').trim();

  if (!workbookInput) {
    throw new Error('Enter the workbook path.');
  }
  if (!sheet) {
    throw new Error('Choose a sheet.');
  }
  if (!range) {
    throw new Error('Enter the range (e.g. B2:J10).');
  }

  const bounds = parseRangeBounds(range);
  if (!bounds) {
    throw new Error(`Invalid A1 range: ${range}`);
  }

  const resolvedWorkbook = resolveWorkbookPath(workbookInput, documentPath);
  await ensureWorkbookLoaded(resolvedWorkbook, { skipRecalculate: true });
  window.SkUISpreadSheet.setActiveSheet(sheet);

  const viewH = Number(window.SkUISpreadSheet.sumPixelHeight(bounds.top, bounds.bottom, sheet));
  const viewW = Number(window.SkUISpreadSheet.sumPixelWidth(bounds.left, bounds.right, sheet));
  if (!(viewH > 0) || !(viewW > 0)) {
    throw new Error('Unable to compute the pixel size of the range.');
  }

  const raw = window.SkUISpreadSheet.jsonView(
    bounds.top,
    bounds.left,
    viewH,
    viewW,
    0,
    0,
    sheet,
    true
  );
  if (!raw) {
    throw new Error('JsonView returned an empty response.');
  }

  let uiView;
  try {
    uiView = JSON.parse(raw);
  } catch (_err) {
    throw new Error('JsonView: invalid JSON.');
  }

  hydrateJsonViewCellFormats(uiView);
  const tableHtml = jsonViewToHtmlTable(uiView, bounds);
  return attachSpreadsheetSourceToTableHtml(tableHtml, {
    workbookPath: workbookInput,
    sheet,
    range,
  });
}

/**
 * Legacy single-string ref (Sheet!A1:B2 or dotted URI form).
 * @param {string} ref
 * @param {{ documentPath?: string, workbookPath?: string }} [options]
 */
export async function rangeRefToHtmlTable(ref, options = {}) {
  const parsed = parseSkerRangeRef(ref);
  if (!parsed) {
    throw new Error(`Invalid range reference: ${ref}`);
  }

  let workbookPath = parsed.workbookPath || options.workbookPath || '';
  await ensureSpreadsheetEngine();

  if (workbookPath) {
    workbookPath = resolveWorkbookPath(workbookPath, options.documentPath || '');
    await ensureWorkbookLoaded(workbookPath, { skipRecalculate: true });
  } else {
    workbookPath = window.SkUISpreadSheet.getActiveWorkBook();
    if (!workbookPath) {
      throw new Error('No workbook in memory — enter a .sker path.');
    }
  }

  let sheet = parsed.sheet;
  if (!sheet) {
    sheet = window.SkUISpreadSheet.getActiveSheet();
  }
  if (!sheet) {
    throw new Error('Choose a sheet.');
  }

  return rangeSelectionToHtmlTable({
    workbookPath,
    sheet,
    range: parsed.range,
    documentPath: options.documentPath || '',
  });
}

/** Default values when opening the insert dialog. */
export async function defaultRangeInsertDialogValues(documentPath = '') {
  let workbookPath = getSpreadsheetSession()?.path || '';

  if (!workbookPath && documentPath) {
    const base = documentPath.includes('/')
      ? documentPath.slice(documentPath.lastIndexOf('/') + 1)
      : documentPath;
    const stem = base.replace(/\.[^.]+$/, '');
    if (stem) {
      workbookPath = `./${stem}.sker`;
    }
  }

  let sheets = [];
  let sheet = '';
  if (workbookPath) {
    try {
      const loaded = await loadSheetsForWorkbookPath(workbookPath, documentPath);
      sheets = loaded.sheets;
      sheet = sheets[0] || '';
    } catch (_err) {
      sheets = [];
    }
  }

  return {
    workbookPath,
    sheet,
    range: 'A1:C3',
    sheets,
  };
}

function escapeSpreadsheetHtmlAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/** Embed workbook/sheet/range on imported table for chrome + round-trip edit. */
export function attachSpreadsheetSourceToTableHtml(tableHtml, source) {
  const workbookPath = String(source?.workbookPath || '').trim();
  const sheet = String(source?.sheet || '').trim();
  const range = String(source?.range || '').trim();
  if (!workbookPath && !sheet && !range) {
    return tableHtml;
  }
  const attrs = [
    workbookPath ? `data-sker-workbook="${escapeSpreadsheetHtmlAttr(workbookPath)}"` : '',
    sheet ? `data-sker-sheet="${escapeSpreadsheetHtmlAttr(sheet)}"` : '',
    range ? `data-sker-range="${escapeSpreadsheetHtmlAttr(range)}"` : '',
  ].filter(Boolean).join(' ');
  return String(tableHtml || '').replace(
    /<table\b/i,
    `<table ${attrs}`
  );
}

export function formatSpreadsheetSourceButtonLabel(source) {
  const workbookPath = String(source?.workbookPath || '').trim();
  const sheet = String(source?.sheet || '').trim();
  const range = String(source?.range || '').trim();
  if (!workbookPath && !sheet && !range) {
    return 'Range…';
  }
  const fileName = workbookPath.includes('/')
    ? workbookPath.slice(workbookPath.lastIndexOf('/') + 1)
    : workbookPath;
  const shortFile = fileName.length > 16 ? `${fileName.slice(0, 14)}…` : fileName;
  const shortSheet = sheet.length > 10 ? `${sheet.slice(0, 8)}…` : sheet;
  return [shortFile, shortSheet, range].filter(Boolean).join(' · ');
}

export function formatSpreadsheetSourceTooltip(source) {
  const workbookPath = String(source?.workbookPath || '').trim();
  const sheet = String(source?.sheet || '').trim();
  const range = String(source?.range || '').trim();
  if (!workbookPath && !sheet && !range) {
    return 'Set workbook / sheet / range source';
  }
  return [
    workbookPath ? `Workbook: ${workbookPath}` : '',
    sheet ? `Sheet: ${sheet}` : '',
    range ? `Range: ${range}` : '',
    '',
    'Click to edit',
  ].filter((line) => line !== '').join('\n');
}

export function readSpreadsheetTableSourceFromTableElement(tableEl) {
  if (!tableEl) {
    return null;
  }
  const workbookPath = tableEl.getAttribute('data-sker-workbook') || '';
  const sheet = tableEl.getAttribute('data-sker-sheet') || '';
  const range = tableEl.getAttribute('data-sker-range') || '';
  if (!workbookPath && !sheet && !range) {
    return null;
  }
  return { workbookPath, sheet, range };
}
