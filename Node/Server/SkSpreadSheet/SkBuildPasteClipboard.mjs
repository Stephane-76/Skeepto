//=============================================================================
// SkBuildPasteClipboard.mjs — build native sker cp JSON for paste_range
//=============================================================================

import { normalizeClipboardFormatCss, normalizeSkerCss } from './SkSkerCss.mjs';
import {
  classifyPasteScalar,
  normalizeFormulaText,
} from './SkCellValueCoerce.mjs';

export { isFormulaText, normalizeFormulaText } from './SkCellValueCoerce.mjs';

/**
 * sker relative column letters (matches C++ Base10ToAlpha): 0 → @, 1 → A, 2 → B, …
 * @param {number} colOffset — 0-based column offset inside the cp block
 * @returns {string}
 */
export function skerBase10ToAlpha(colOffset) {
  if (colOffset === 0) {
    return '@';
  }
  let sValue = colOffset;
  sValue--;
  let wReturn = '';
  let wRest = Math.floor(sValue / 26);
  while (wRest > 0) {
    wRest--;
    const wChar = wRest % 26;
    wReturn = String.fromCharCode(65 + wChar) + wReturn;
    wRest = Math.floor(wRest / 26);
  }
  const wChar = sValue % 26;
  wReturn += String.fromCharCode(65 + wChar);
  return wReturn;
}

/**
 * Parse sker relative column letters (matches C++ AlphaToBase10).
 * @param {string} colLetters
 * @returns {number}
 */
export function skerAlphaToBase10(colLetters) {
  if (colLetters === '@') {
    return 0;
  }
  let wRange = 1;
  let wResult = 0;
  let sValue = colLetters;
  while (sValue.length > 0) {
    const wLength = sValue.length;
    const wVal = sValue.charCodeAt(wLength - 1) - 64;
    sValue = sValue.slice(0, -1);
    if (wRange > 1) {
      wResult += wVal * 26 ** (wRange - 1);
    } else {
      wResult += wVal;
    }
    wRange++;
  }
  return wResult;
}

/**
 * @param {string} range — e.g. A1:C5
 * @returns {{ top: number, left: number, bottom: number, right: number }}
 */
export function parseA1Range(range) {
  const wMatch = /^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/.exec(String(range || '').trim());
  if (!wMatch) {
    throw new Error(`Invalid range: ${range}`);
  }
  const colToNum = (col) => {
    let n = 0;
    for (const ch of col.toUpperCase()) {
      n = n * 26 + (ch.charCodeAt(0) - 64);
    }
    return n;
  };
  const top = Number(wMatch[2]);
  const bottom = Number(wMatch[4]);
  const left = colToNum(wMatch[1]);
  const right = colToNum(wMatch[3]);
  return {
    top: Math.min(top, bottom),
    left: Math.min(left, right),
    bottom: Math.max(top, bottom),
    right: Math.max(left, right),
  };
}

/**
 * sker cp select rect: [topRow, leftCol, bottomRow, rightCol] (see tTempoRect::Json).
 * @param {string} range
 * @returns {[{ r: number[] }]}
 */
export function buildSelectFromRange(range) {
  const wRect = parseA1Range(range);
  return [{ r: [wRect.top, wRect.left, wRect.bottom, wRect.right] }];
}

/**
 * Relative cell id inside cp (@0, A0, @1, …) — matches native Copy JSON (see tCell::Json + Base10ToAlpha).
 * @param {number} rowOffset — 0-based row in block
 * @param {number} colOffset — 0-based col in block
 */
export function buildRelativeCellId(rowOffset, colOffset) {
  return `${skerBase10ToAlpha(colOffset)}${rowOffset}`;
}

/**
 * @param {{ header?: string, dataOdd?: string, dataEven?: string, default?: string }} [styles]
 * @returns {{ formats: string[], foForRow: (rowIndex: number) => number|undefined }}
 */
function buildStyleFormatTable(styles) {
  const wFormats = [];
  const wIndexByKey = new Map();

  const wAdd = (key, css) => {
    if (!css || typeof css !== 'string') {
      return undefined;
    }
    if (wIndexByKey.has(key)) {
      return wIndexByKey.get(key);
    }
    const wIdx = wFormats.length;
    wIndexByKey.set(key, wIdx);
    wFormats.push(normalizeSkerCss(css));
    return wIdx;
  };

  const wHeaderFo = wAdd('header', styles?.header);
  const wDataOddFo = wAdd('dataOdd', styles?.dataOdd);
  const wDataEvenFo = wAdd('dataEven', styles?.dataEven);
  const wDefaultFo = wAdd('default', styles?.default);

  return {
    formats: wFormats,
    foForRow(rowIndex) {
      if (rowIndex === 0 && wHeaderFo != null) {
        return wHeaderFo;
      }
      if (rowIndex >= 1) {
        const wDataRow = rowIndex - 1;
        if (wDataRow % 2 === 0 && wDataOddFo != null) {
          return wDataOddFo;
        }
        if (wDataRow % 2 === 1 && wDataEvenFo != null) {
          return wDataEvenFo;
        }
      }
      return wDefaultFo;
    },
  };
}

/**
 * @param {object} target
 * @param {ReturnType<classifyPasteScalar>} classified
 */
function applyClassifiedScalar(target, classified) {
  delete target.text;
  delete target.value;
  delete target.formula;
  delete target.f;
  delete target.fi;
  delete target.si;
  delete target.t;
  delete target.v;

  if (classified.kind === 'number' || classified.kind === 'date') {
    target.t = classified.t;
    target.v = classified.v;
  } else if (classified.kind === 'formula') {
    target.formula = classified.formula;
  } else if (classified.kind === 'text') {
    target.text = classified.text;
  }
}

/**
 * @param {unknown} cell
 * @param {number} rowIndex
 * @param {ReturnType<typeof buildStyleFormatTable>|null} styleTable
 * @returns {object|null}
 */
function normalizeGridCellSpec(cell, rowIndex, styleTable) {
  if (cell == null) {
    return null;
  }

  if (typeof cell === 'object' && !Array.isArray(cell)) {
    const wCopy = { ...cell };
    if (typeof wCopy.value === 'string' && isFormulaText(wCopy.value)) {
      wCopy.formula = normalizeFormulaText(wCopy.value);
      delete wCopy.value;
      delete wCopy.text;
    } else if (typeof wCopy.text === 'string' && isFormulaText(wCopy.text)) {
      wCopy.formula = normalizeFormulaText(wCopy.text);
      delete wCopy.text;
    } else if (typeof wCopy.value === 'string') {
      const wClass = classifyPasteScalar(wCopy.value);
      applyClassifiedScalar(wCopy, wClass);
    } else if (typeof wCopy.text === 'string') {
      const wClass = classifyPasteScalar(wCopy.text);
      applyClassifiedScalar(wCopy, wClass);
    }
    if (typeof wCopy.fo !== 'number' && styleTable) {
      const wFo = styleTable.foForRow(rowIndex);
      if (wFo != null) {
        wCopy.fo = wFo;
      }
    }
    return wCopy;
  }

  const wEntry = {};
  const wFo = styleTable?.foForRow(rowIndex);
  if (wFo != null) {
    wEntry.fo = wFo;
  }

  if (typeof cell === 'number') {
    wEntry.t = 'd';
    wEntry.v = cell;
    return wEntry;
  }

  const wClass = classifyPasteScalar(cell);
  if (wClass.kind === 'number' || wClass.kind === 'date') {
    wEntry.t = wClass.t;
    wEntry.v = wClass.v;
    return wEntry;
  }
  if (wClass.kind === 'formula') {
    wEntry.formula = wClass.formula;
    return wEntry;
  }
  if (wClass.kind === 'text') {
    wEntry.text = wClass.text;
  }
  return wEntry;
}

/**
 * Qwen often sends header row + one field per column (cities as columns). Fix to one entity per row.
 * @param {Array<Array<unknown>>|undefined} rows
 * @returns {Array<Array<unknown>>}
 */
export function normalizePasteGridRows(rows) {
  if (!Array.isArray(rows) || rows.length < 2) {
    return rows ?? [];
  }
  const wColCount = Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 0)));
  const wRowCount = rows.length;
  // Wide-and-short grids are usually one record per COLUMN; transpose to one item per ROW.
  if (wColCount < 4 || wRowCount > 5 || wColCount <= wRowCount * 2) {
    return rows;
  }
  const wFirstColAllLabels = rows.every((r) => {
    const wStr = String(Array.isArray(r) ? r[0] ?? '' : '').trim();
    return wStr !== '' && !/^-?\d+([.,]\d+)?$/.test(wStr);
  });
  if (!wFirstColAllLabels) {
    return rows;
  }
  /** @type {Array<Array<unknown>>} */
  const wTransposed = [];
  for (let wCol = 0; wCol < wColCount; wCol++) {
    wTransposed.push(rows.map((r) => (Array.isArray(r) ? r[wCol] ?? '' : '')));
  }
  return wTransposed;
}

/**
 * @param {string} destRange
 * @param {number} rowCount
 * @param {number} colCount
 * @returns {string}
 */
export function computePasteDestRange(destRange, rowCount, colCount) {
  const wTrim = String(destRange || '').trim();
  const wSingle = /^([A-Za-z]+)(\d+)$/.exec(wTrim);
  const wRange = wSingle ? `${wSingle[1]}${wSingle[2]}:${wSingle[1]}${wSingle[2]}` : wTrim;
  const wRect = parseA1Range(wRange);
  const wEndRow = wRect.top + rowCount - 1;
  const wEndColNum = wRect.left + colCount - 1;
  let wEndCol = '';
  let wN = wEndColNum;
  while (wN > 0) {
    const wRem = (wN - 1) % 26;
    wEndCol = String.fromCharCode(65 + wRem) + wEndCol;
    wN = Math.floor((wN - 1) / 26);
  }
  const wStartCol = wSingle?.[1] ?? wRange.match(/^([A-Za-z]+)/)?.[1] ?? 'A';
  return `${wStartCol}${wRect.top}:${wEndCol}${wEndRow}`;
}

/**
 * Build sker cp from a 2D grid.
 * @param {{
 *   rows: Array<Array<string|number|object>>,
 *   formats?: string[],
 *   styles?: { header?: string, dataOdd?: string, dataEven?: string, default?: string },
 * }} spec
 * @returns {object}
 */
export function buildPasteClipboardFromGrid(spec) {
  const wSourceRows = normalizePasteGridRows(spec?.rows);
  if (!Array.isArray(wSourceRows) || wSourceRows.length === 0) {
    throw new Error('rows array is required');
  }

  const wExplicitFormats = (spec.formats || []).map((css) => normalizeSkerCss(css));
  const wStyleTable =
    spec?.styles && typeof spec.styles === 'object' ? buildStyleFormatTable(spec.styles) : null;

  if (wStyleTable && wExplicitFormats.length > 0) {
    const wOrigFoForRow = wStyleTable.foForRow.bind(wStyleTable);
    const wOffset = wExplicitFormats.length;
    wStyleTable.foForRow = (rowIndex) => {
      const wFo = wOrigFoForRow(rowIndex);
      return wFo == null ? undefined : wFo + wOffset;
    };
  }

  const wRows = wSourceRows.map((row, rowIndex) => {
    if (!Array.isArray(row)) {
      throw new Error('each row must be an array');
    }
    return row.map((cell) => normalizeGridCellSpec(cell, rowIndex, wStyleTable));
  });

  const wColCount = Math.max(...wRows.map((r) => r.length));
  const wRowCount = wRows.length;

  const wTop = 1;
  const wLeft = 1;
  const wBottom = wRowCount;
  const wRight = wColCount;

  const wStrings = [];
  const wStringIndex = new Map();
  const wFormulas = [];
  const wFormulaIndex = new Map();
  const wCells = [];

  const wInternString = (text) => {
    const wKey = String(text);
    if (wStringIndex.has(wKey)) {
      return wStringIndex.get(wKey);
    }
    const wIdx = wStrings.length;
    wStrings.push(wKey);
    wStringIndex.set(wKey, wIdx);
    return wIdx;
  };

  const wInternFormula = (text) => {
    // Native sker cp/fi stores the formula BODY without the leading "=" (see
    // tFormula::Str / tVariant::Formula in C++). The paste compiler receives the
    // fi string as-is, so a leading "=" triggers "Syntax error [1]->=^…". Strip it.
    const wNorm = normalizeFormulaText(text) || String(text).trim();
    const wKey = wNorm.replace(/^=+/, '');
    if (wFormulaIndex.has(wKey)) {
      return wFormulaIndex.get(wKey);
    }
    const wIdx = wFormulas.length;
    wFormulas.push(wKey);
    wFormulaIndex.set(wKey, wIdx);
    return wIdx;
  };

  for (let wRow = 0; wRow < wRowCount; wRow++) {
    for (let wCol = 0; wCol < wColCount; wCol++) {
      const wCell = wRows[wRow][wCol];
      if (wCell == null) {
        continue;
      }
      const wEntry = { c: buildRelativeCellId(wRow, wCol) };

      if (typeof wCell.fo === 'number') {
        wEntry.fo = wCell.fo;
      }
      if (wCell.t != null && wCell.v != null) {
        wEntry.t = wCell.t;
        wEntry.v = wCell.v;
      } else if (typeof wCell.fi === 'number') {
        wEntry.fi = wCell.fi;
      } else if (typeof wCell.formula === 'string' || typeof wCell.f === 'string') {
        const wFormula = normalizeFormulaText(wCell.formula ?? wCell.f);
        if (wFormula) {
          wEntry.fi = wInternFormula(wFormula);
        }
      } else if (typeof wCell.value === 'number') {
        wEntry.t = 'd';
        wEntry.v = wCell.value;
      } else {
        const wText = wCell.text ?? wCell.value ?? '';
        if (wText !== '') {
          const wClass = classifyPasteScalar(wText);
          if (wClass.kind === 'formula') {
            wEntry.fi = wInternFormula(wClass.formula);
          } else if (wClass.kind === 'number' || wClass.kind === 'date') {
            wEntry.t = wClass.t;
            wEntry.v = wClass.v;
          } else if (wClass.kind === 'text') {
            wEntry.si = wInternString(wClass.text);
          }
        }
      }

      wCells.push(wEntry);
    }
  }

  const wFormats = [...wExplicitFormats, ...(wStyleTable?.formats || [])].map((css) => ({
    f: css,
  }));

  const wClipboard = {
    select: [{ r: [wTop, wLeft, wBottom, wRight] }],
    cells: wCells,
  };

  if (wStrings.length > 0) {
    wClipboard.si = wStrings;
  }
  if (wFormulas.length > 0) {
    wClipboard.fi = wFormulas;
  }
  if (wFormats.length > 0) {
    wClipboard.f = { formats: wFormats };
  }

  return normalizeClipboardFormatCss(wClipboard);
}
