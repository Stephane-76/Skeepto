//=============================================================================
// SkRepairClipboard.mjs — validate / repair malformed sker cp payloads
//=============================================================================

import {
  buildRelativeCellId,
  isFormulaText,
  normalizeFormulaText,
  parseA1Range,
  skerAlphaToBase10,
  skerBase10ToAlpha,
} from './SkBuildPasteClipboard.mjs';
import { classifyPasteScalar } from './SkCellValueCoerce.mjs';

/** Relative cp cell id: @0, A0, AB12, … */
const RELATIVE_CELL_ID_RE = /^[@A-Za-z]+\d+$/;

/**
 * @param {unknown} select
 * @returns {boolean}
 */
function isNativeSelect(select) {
  return (
    Array.isArray(select) &&
    select.length > 0 &&
    select[0] != null &&
    typeof select[0] === 'object' &&
    Array.isArray(select[0].r) &&
    select[0].r.length === 4
  );
}

/**
 * @param {unknown} cells
 * @returns {boolean}
 */
function isNativeCells(cells) {
  if (!Array.isArray(cells) || cells.length === 0) {
    return false;
  }
  const wFirst = cells[0];
  return wFirst != null && typeof wFirst === 'object' && !Array.isArray(wFirst) && 'c' in wFirst;
}

/**
 * @param {unknown} cell
 * @returns {boolean}
 */
function isGridRow(cell) {
  return Array.isArray(cell);
}

/**
 * Excel-style relative ids (A0 = top-left) → sker native (@0, A0, …).
 * @param {object[]} cells
 * @returns {{ cells: object[], repaired: boolean }}
 */
function repairExcelStyleRelativeIds(cells) {
  if (!Array.isArray(cells) || cells.length === 0) {
    return { cells, repaired: false };
  }
  if (cells.some((c) => typeof c?.c === 'string' && c.c.includes('@'))) {
    return { cells, repaired: false };
  }

  const colToNum = (col) => {
    let n = 0;
    for (const ch of col.toUpperCase()) {
      n = n * 26 + (ch.charCodeAt(0) - 64);
    }
    return n;
  };

  let wMinCol = Infinity;
  for (const wCell of cells) {
    const wMatch = /^([A-Za-z]+)(\d+)$/.exec(String(wCell?.c || ''));
    if (!wMatch) {
      return { cells, repaired: false };
    }
    wMinCol = Math.min(wMinCol, colToNum(wMatch[1]));
  }

  // Native cp never uses bare A for column 0; min column A (1) without @ means Excel-style.
  if (wMinCol !== 1) {
    return { cells, repaired: false };
  }

  const wRepaired = cells.map((wCell) => {
    const wMatch = /^([A-Za-z]+)(\d+)$/.exec(String(wCell.c));
    if (!wMatch) {
      return wCell;
    }
    const wOffset = colToNum(wMatch[1]) - 1;
    return { ...wCell, c: `${skerBase10ToAlpha(wOffset)}${wMatch[2]}` };
  });

  return { cells: wRepaired, repaired: true };
}

/**
 * Move formula strings wrongly stored in si[] to fi[] (common AI mistake).
 * @param {object} wCp
 * @returns {{ repaired: boolean }}
 */
function repairSiFormulasToFi(wCp) {
  const wStrings = Array.isArray(wCp.si) ? [...wCp.si] : [];
  const wFormulas = Array.isArray(wCp.fi) ? [...wCp.fi] : [];
  const wFormulaIndex = new Map(wFormulas.map((f, i) => [String(f), i]));
  let wRepaired = false;

  const wInternFormula = (text) => {
    const wKey = normalizeFormulaText(text) || String(text).trim();
    if (wFormulaIndex.has(wKey)) {
      return wFormulaIndex.get(wKey);
    }
    const wIdx = wFormulas.length;
    wFormulas.push(wKey);
    wFormulaIndex.set(wKey, wIdx);
    return wIdx;
  };

  if (!Array.isArray(wCp.cells)) {
    return { repaired: false };
  }

  for (const wCell of wCp.cells) {
    if (!wCell || typeof wCell !== 'object') {
      continue;
    }
    if (typeof wCell.fi === 'number') {
      continue;
    }
    if (typeof wCell.f === 'string' && isFormulaText(wCell.f)) {
      wCell.fi = wInternFormula(wCell.f);
      delete wCell.f;
      wRepaired = true;
      continue;
    }
    if (typeof wCell.si !== 'number') {
      continue;
    }
    const wText = wStrings[wCell.si];
    if (!isFormulaText(wText)) {
      continue;
    }
    wCell.fi = wInternFormula(wText);
    delete wCell.si;
    wRepaired = true;
  }

  if (wRepaired) {
    wCp.fi = wFormulas;
    if (wStrings.length === 0) {
      delete wCp.si;
    } else {
      wCp.si = wStrings;
    }
  }

  return { repaired: wRepaired };
}

/**
 * Convert si[] text that should be number/date/formula into typed cp cells.
 * @param {object} wCp
 * @returns {{ repaired: boolean }}
 */
function repairSiTypedScalars(wCp) {
  const wStrings = Array.isArray(wCp.si) ? wCp.si : [];
  const wFormulas = Array.isArray(wCp.fi) ? [...wCp.fi] : [];
  const wFormulaIndex = new Map(wFormulas.map((f, i) => [String(f), i]));
  let wRepaired = false;

  const wInternFormula = (text) => {
    const wKey = normalizeFormulaText(text) || String(text).trim();
    if (wFormulaIndex.has(wKey)) {
      return wFormulaIndex.get(wKey);
    }
    const wIdx = wFormulas.length;
    wFormulas.push(wKey);
    wFormulaIndex.set(wKey, wIdx);
    return wIdx;
  };

  if (!Array.isArray(wCp.cells)) {
    return { repaired: false };
  }

  for (const wCell of wCp.cells) {
    if (!wCell || typeof wCell !== 'object' || typeof wCell.si !== 'number') {
      continue;
    }
    if (wCell.t != null || wCell.fi != null) {
      continue;
    }
    const wText = wStrings[wCell.si];
    const wClass = classifyPasteScalar(wText);
    if (wClass.kind === 'formula') {
      wCell.fi = wInternFormula(wClass.formula);
      delete wCell.si;
      wRepaired = true;
    } else if (wClass.kind === 'number' || wClass.kind === 'date') {
      wCell.t = wClass.t;
      wCell.v = wClass.v;
      delete wCell.si;
      wRepaired = true;
    }
  }

  if (wRepaired && wFormulas.length > 0) {
    wCp.fi = wFormulas;
  }

  return { repaired: wRepaired };
}

/**
 * Repair common AI mistakes (flat select, 2D cells grid without c/id).
 * @param {string|object} clipboard
 * @returns {{ clipboard: object, repaired: boolean, repairs: string[] }}
 */
export function repairClipboardPayload(clipboard) {
  let wCp =
    typeof clipboard === 'string'
      ? JSON.parse(clipboard.trim())
      : structuredClone(clipboard);

  if (!wCp || typeof wCp !== 'object') {
    throw new Error('clipboard must be a JSON object');
  }

  const wRepairs = [];
  let wRepaired = false;

  if (!isNativeSelect(wCp.select)) {
    if (
      Array.isArray(wCp.select) &&
      wCp.select.length === 4 &&
      wCp.select.every((n) => typeof n === 'number')
    ) {
      wCp.select = [{ r: wCp.select.map((n) => Math.trunc(n)) }];
      wRepairs.push('select flat [r0,c0,r1,c1] → select[{r:[…]}]');
      wRepaired = true;
    } else if (
      wCp.select &&
      typeof wCp.select === 'object' &&
      Array.isArray(wCp.select.r) &&
      wCp.select.r.length === 4
    ) {
      wCp.select = [{ r: wCp.select.r.map((n) => Math.trunc(n)) }];
      wRepairs.push('select{r} → select[{r}]');
      wRepaired = true;
    } else {
      throw new Error(
        'clipboard.select must be [{ r: [topRow, leftCol, bottomRow, rightCol] }]'
      );
    }
  }

  if (Array.isArray(wCp.cells) && wCp.cells.length > 0 && isGridRow(wCp.cells[0])) {
    const wStrings = Array.isArray(wCp.si) ? [...wCp.si] : [];
    const wStringIndex = new Map(wStrings.map((s, i) => [String(s), i]));
    const wFormulas = Array.isArray(wCp.fi) ? [...wCp.fi] : [];
    const wFormulaIndex = new Map(wFormulas.map((f, i) => [String(f), i]));
    const wIntern = (text) => {
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
      const wKey = normalizeFormulaText(text) || String(text).trim();
      if (wFormulaIndex.has(wKey)) {
        return wFormulaIndex.get(wKey);
      }
      const wIdx = wFormulas.length;
      wFormulas.push(wKey);
      wFormulaIndex.set(wKey, wIdx);
      return wIdx;
    };

    const wFlat = [];
    for (let wRow = 0; wRow < wCp.cells.length; wRow++) {
      const wRowCells = wCp.cells[wRow];
      if (!Array.isArray(wRowCells)) {
        continue;
      }
      for (let wCol = 0; wCol < wRowCells.length; wCol++) {
        const wRaw = wRowCells[wCol];
        if (wRaw == null) {
          continue;
        }
        const wEntry = { c: buildRelativeCellId(wRow, wCol) };
        if (typeof wRaw === 'string' || typeof wRaw === 'number') {
          if (wRaw !== '') {
            const wClass = classifyPasteScalar(wRaw);
            if (wClass.kind === 'formula') {
              wEntry.fi = wInternFormula(wClass.formula);
            } else if (wClass.kind === 'number' || wClass.kind === 'date') {
              wEntry.t = wClass.t;
              wEntry.v = wClass.v;
            } else if (wClass.kind === 'text') {
              wEntry.si = wIntern(wClass.text);
            }
          }
        } else if (typeof wRaw === 'object') {
          Object.assign(wEntry, wRaw);
          if (!wEntry.c) {
            wEntry.c = buildRelativeCellId(wRow, wCol);
          }
          if (typeof wEntry.si === 'string') {
            const wFormula = normalizeFormulaText(wEntry.si);
            if (wFormula) {
              wEntry.fi = wInternFormula(wFormula);
              delete wEntry.si;
            } else {
              wEntry.si = wIntern(wEntry.si);
            }
          }
          if (typeof wEntry.formula === 'string' || typeof wEntry.f === 'string') {
            const wFormula = normalizeFormulaText(wEntry.formula ?? wEntry.f);
            if (wFormula) {
              wEntry.fi = wInternFormula(wFormula);
              delete wEntry.formula;
              delete wEntry.f;
            }
          }
        }
        wFlat.push(wEntry);
      }
    }

    wCp.cells = wFlat;
    if (wStrings.length > 0) {
      wCp.si = wStrings;
    } else {
      delete wCp.si;
    }
    if (wFormulas.length > 0) {
      wCp.fi = wFormulas;
    }
    wRepairs.push('cells[][] grid → flat cells[{c,si,fo,…}]');
    wRepaired = true;
  }

  const wRelRepair = repairExcelStyleRelativeIds(wCp.cells);
  if (wRelRepair.repaired) {
    wCp.cells = wRelRepair.cells;
    wRepairs.push('cells c:A0 (Excel-style) → c:@0 (sker native)');
    wRepaired = true;
  }

  const wTypedRepair = repairSiTypedScalars(wCp);
  if (wTypedRepair.repaired) {
    wRepairs.push('cells si:"500|date|formula" → typed t/v or fi');
    wRepaired = true;
  }

  if (!Array.isArray(wCp.cells)) {
    throw new Error('clipboard must include cells[]');
  }

  for (let wIdx = 0; wIdx < wCp.cells.length; wIdx++) {
    const wCell = wCp.cells[wIdx];
    if (!wCell || typeof wCell !== 'object' || Array.isArray(wCell)) {
      throw new Error(`clipboard.cells[${wIdx}] must be an object with property c`);
    }
    if (typeof wCell.c !== 'string' || !RELATIVE_CELL_ID_RE.test(wCell.c)) {
      throw new Error(
        `clipboard.cells[${wIdx}] missing relative id c (expected @0, A0, @1…)`
      );
    }
  }

  if (wCp.cells.length === 0) {
    throw new Error('clipboard.cells is empty');
  }

  return { clipboard: wCp, repaired: wRepaired, repairs: wRepairs };
}

/**
 * @param {string} destRange — e.g. A2:C102
 * @param {string} relativeCellId — e.g. @0
 * @returns {string}
 */
export function absoluteRefFromPasteCell(destRange, relativeCellId) {
  const wDest = parseA1Range(destRange);
  const wMatch = /^([@A-Za-z]+)(\d+)$/.exec(String(relativeCellId || '').trim());
  if (!wMatch) {
    throw new Error(`Invalid relative cell id: ${relativeCellId}`);
  }

  const numToCol = (n) => {
    let s = '';
    let x = n;
    while (x > 0) {
      const r = (x - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      x = Math.floor((x - 1) / 26);
    }
    return s;
  };

  const wRelCol = skerAlphaToBase10(wMatch[1]);
  const wRelRow = Number(wMatch[2]);
  const wAbsCol = wDest.left + wRelCol;
  const wAbsRow = wDest.top + wRelRow;
  return `${numToCol(wAbsCol)}${wAbsRow}`;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isEmptySpreadsheetValue(value) {
  if (value == null) {
    return true;
  }
  const wText = String(value).trim();
  return wText === '' || wText.toLowerCase() === 'null';
}
