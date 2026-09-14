//=============================================================================
// DrawCell.js — debug dump of cell values (browser / CRA; mirrors Node DrawCell.mjs)
//=============================================================================

/**
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
 * C++ _GetValue uses "Null" for empty; normalize for logs.
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
 * A1-style ref (1-based row/col). Uses SkUISpreadSheet.base10toAlphaSync when available.
 * @param {{ base10toAlphaSync?: (n: number) => string, m_UISpreadSheet?: object }} wrapper
 * @param {number} row
 * @param {number} col
 */
export function cellRefFromRowCol(wrapper, row, col) {
  if (wrapper && typeof wrapper.base10toAlphaSync === 'function') {
    return `${wrapper.base10toAlphaSync(col)}${row}`;
  }
  const ui = wrapper?.m_UISpreadSheet;
  if (ui && typeof ui.Base10toAlpha === 'function') {
    return `${ui.Base10toAlpha(col)}${row}`;
  }
  return `?${col}${row}`;
}

/**
 * Print a rectangular range to the console (tab-separated), like SkExcel DrawCell.
 *
 * @param {object} _skSpInterface SkSpInterface instance (unused; engine is window.SkUISpreadSheet)
 * @param {string} title
 * @param {string} sheetName empty = active sheet
 * @param {number} rowBegin 1-based
 * @param {number} colBegin 1-based
 * @param {number} rowEnd 1-based inclusive
 * @param {number} colEnd 1-based inclusive
 * @param {{ showFormula?: boolean, separator?: string }} [options]
 */
export function DrawCell(_skSpInterface, title, sheetName, rowBegin, colBegin, rowEnd, colEnd, options = {}) {
  const wrapper = typeof window !== 'undefined' ? window.SkUISpreadSheet : null;
  const ui = wrapper?.m_UISpreadSheet;
  if (!ui) {
    console.warn('DrawCell: WASM not ready (window.SkUISpreadSheet.m_UISpreadSheet is null)');
    return;
  }

  const showFormula = options.showFormula !== false;
  const sep = options.separator ?? '\t';

  if (sheetName) {
    const ok = ui.SetActiveSheet(sheetName);
    if (!ok) {
      console.warn(`DrawCell: SetActiveSheet("${sheetName}") failed`);
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
      const ref = cellRefFromRowCol(wrapper, row, col);
      const val = displayCellValue(ui.GetValue(ref, sheetForApi));
      if (showFormula) {
        const fx = hasGetFormula ? displayCellValue(ui.GetFormula(ref, sheetForApi)) : '';
        const input = displayCellValue(ui.GetInputValue(ref, sheetForApi));
        const secondary = fx !== '' ? `fx:${fx}` : `in:${input}`;
        parts.push(`${ref}=${val}  [${secondary}]`);
      } else {
        parts.push(`${ref}:${val}`);
      }
    }
    console.log(parts.join(sep));
  }
}

/** @deprecated use DrawCell — alias for Node-style name */
export function drawCell(...args) {
  return DrawCell(...args);
}
