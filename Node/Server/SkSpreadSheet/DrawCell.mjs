//=============================================================================
// DrawCell.mjs — debug dump of cell values (Node tests, mirrors SkExcel DrawCell)
//=============================================================================

/**
 * Normalize WASM / embind return values for logging (strings, numbers, bigint).
 * @param {unknown} v
 * @returns {string}
 */
export function wasmString(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : String(v);
  if (typeof v === 'string') return v;
  return String(v);
}

/**
 * C++ _GetValue prints "Null" for t_null; empty cells read cleaner as blank in logs.
 * @param {unknown} v
 * @returns {string}
 */
export function displayCellValue(v) {
  const s = wasmString(v);
  if (s === 'Null' || s === 'None') {
    return '';
  }
  return s;
}

/**
 * Build A1-style ref from 1-based row and column (same convention as C++ DrawCell).
 * @param {object} ui — UISpreadSheet instance (WASM)
 * @param {number} row — 1-based
 * @param {number} col — 1-based
 */
export function cellRefFromRowCol(ui, row, col) {
  const alpha = ui.Base10toAlpha(col);
  return `${alpha}${row}`;
}

/**
 * Print a rectangular range of cells (values, tab-separated), like SkExcel DrawCell.
 *
 * @param {import('./SkSpreadSheet.mjs').SkSpreadSheet} sheet
 * @param {string} title — label printed on the first line
 * @param {string} sheetName — sheet name (e.g. "JANVIER"); empty string keeps current active sheet
 * @param {number} rowBegin — 1-based
 * @param {number} colBegin — 1-based
 * @param {number} rowEnd — 1-based inclusive
 * @param {number} colEnd — 1-based inclusive
 * @param {{ showFormula?: boolean, separator?: string }} [options]
 */
export function drawCell(sheet, title, sheetName, rowBegin, colBegin, rowEnd, colEnd, options = {}) {
  const ui = sheet.m_UISpreadSheet;
  if (!ui) {
    throw new Error('drawCell: call initializeSkerSpreadSheet and load a workbook first');
  }

  // Default: show formula / input line (debug helper). Pass showFormula: false to hide.
  const showFormula = options.showFormula !== false;
  const sep = options.separator ?? '\t';

  if (sheetName) {
    const ok = ui.SetActiveSheet(sheetName);
    if (!ok) {
      console.warn(`drawCell: SetActiveSheet("${sheetName}") failed`);
      return;
    }
  }

  const activeName = typeof ui.GetActiveSheet === 'function' ? wasmString(ui.GetActiveSheet()) : '';
  const sheetForApi = activeName || '';

  console.log(`DrawCell ${title} — sheet="${activeName}" rows ${rowBegin}..${rowEnd} cols ${colBegin}..${colEnd}`);

  const hasGetFormula = typeof ui.GetFormula === 'function';

  for (let row = rowBegin; row <= rowEnd; row++) {
    const parts = [];
    for (let col = colBegin; col <= colEnd; col++) {
      const ref = cellRefFromRowCol(ui, row, col);
      const val = displayCellValue(ui.GetValue(ref, sheetForApi));
      if (showFormula) {
        const fx = hasGetFormula ? displayCellValue(ui.GetFormula(ref, sheetForApi)) : '';
        const input = displayCellValue(ui.GetInputValue(ref, sheetForApi));
        // Prefer real formula text (FormulaStr), like SkExcel DrawCell; fallback to typed input string.
        const secondary = fx !== '' ? `fx:${fx}` : `in:${input}`;
        parts.push(`${ref}=${val}  [${secondary}]`);
      } else {
        parts.push(`${ref}:${val}`);
      }
    }
    console.log(parts.join(sep));
  }
}

/**
 * Dump one cell (value + optional formula line).
 */
export function drawCellOne(sheet, sheetName, row, col, options = {}) {
  drawCell(sheet, 'single', sheetName, row, col, row, col, options);
}

// Alias for C++-style imports: import { DrawCell } from './DrawCell.mjs'
export { drawCell as DrawCell };
