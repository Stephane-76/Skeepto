//=============================================================================
// SkResizeRange.mjs — column/row resize helpers for MCP (tUndoChangeSize collab)
//=============================================================================

import { generatePasteOpId } from './SkPasteRange.mjs';

/** sker WASM DPI (SkMetrics, 96) */
const SK_DPI = 96;

/**
 * @param {number} pixels
 * @returns {number}
 */
export function pixelsToSkMillimeters(pixels) {
  return (Number(pixels) * 25.4) / SK_DPI;
}

/**
 * @param {number} millimeters
 * @returns {number}
 */
export function skMillimetersToPixels(millimeters) {
  return (Number(millimeters) * SK_DPI) / 25.4;
}

/**
 * Column letters → sker index (A=1, B=2, …) — matches C++ AlphaToBase10.
 * @param {string} letters
 * @returns {number}
 */
export function colLettersToIndex(letters) {
  const wCol = String(letters || '').trim().toUpperCase();
  if (!wCol || !/^[A-Z]+$/.test(wCol)) {
    throw new Error(`Invalid column letters: ${letters}`);
  }
  let wResult = 0;
  let wRange = 1;
  let sValue = wCol;
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
 * @param {string} spec — e.g. B or B:D
 * @returns {{ begin: number, end: number }}
 */
export function parseColumnSpec(spec) {
  const wTrim = String(spec || '').trim().toUpperCase();
  const wMatch = /^([A-Z]+)(?::([A-Z]+))?$/.exec(wTrim);
  if (!wMatch) {
    throw new Error(`Invalid columns spec: ${spec} (expected B or B:D)`);
  }
  const wBegin = colLettersToIndex(wMatch[1]);
  const wEnd = colLettersToIndex(wMatch[2] || wMatch[1]);
  return {
    begin: Math.min(wBegin, wEnd),
    end: Math.max(wBegin, wEnd),
  };
}

/**
 * @param {string} spec — e.g. 2 or 2:10 (1-based row numbers)
 * @returns {{ begin: number, end: number }}
 */
export function parseRowSpec(spec) {
  const wTrim = String(spec || '').trim();
  const wMatch = /^(\d+)(?::(\d+))?$/.exec(wTrim);
  if (!wMatch) {
    throw new Error(`Invalid rows spec: ${spec} (expected 2 or 2:10)`);
  }
  const wBegin = Number(wMatch[1]);
  const wEnd = Number(wMatch[2] || wMatch[1]);
  if (!Number.isFinite(wBegin) || !Number.isFinite(wEnd) || wBegin < 1 || wEnd < 1) {
    throw new Error(`Invalid row numbers in: ${spec}`);
  }
  return {
    begin: Math.min(wBegin, wEnd),
    end: Math.max(wBegin, wEnd),
  };
}

/**
 * Build Do/tUndoChangeSize collab envelope for GetMessage().
 * @param {string} workbookPath
 * @param {{
 *   isRow: boolean,
 *   begin: number,
 *   end: number,
 *   sizePixels: number,
 *   sheet: string,
 * }} spec
 */
export function buildChangeSizeDoEnvelope(workbookPath, spec) {
  const wSheet = typeof spec.sheet === 'string' ? spec.sheet : '';
  if (!wSheet.trim()) {
    throw new Error('sheet name is required for resize collab message');
  }

  const wSizeMm = pixelsToSkMillimeters(spec.sizePixels);
  const wIsRow = spec.isRow === true;
  const wBegin = Math.trunc(spec.begin);
  const wEnd = Math.trunc(spec.end);
  const wLabel = wIsRow
    ? `SizeRow ${wBegin}:${wEnd}`
    : `SizeCol ${wBegin}:${wEnd}`;

  return {
    uri: workbookPath,
    op: 'Do',
    msg: {
      ud: 'tUndoChangeSize',
      op: wLabel,
      opid: generatePasteOpId(),
      sh: wSheet,
      ir: wIsRow,
      bg: wBegin,
      ed: wEnd,
      sz: wSizeMm,
    },
  };
}
