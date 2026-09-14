//=============================================================================
// SkCellValueCoerce.mjs — coerce AI tool values to sker cell types (number, date, formula)
//=============================================================================

import { parseUsDateString, toVariantDateWire } from './SkeeptoLocale.mjs';

/**
 * @param {unknown} text
 * @returns {boolean}
 */
export function isFormulaText(text) {
  const wTrimmed = String(text ?? '').trim();
  return /^=+/.test(wTrimmed) && wTrimmed.length > 1;
}

/**
 * Remove one layer of surrounding quotes (", ', « »).
 * @param {unknown} text
 * @returns {string}
 */
export function stripOuterQuotes(text) {
  let wTrimmed = String(text ?? '').trim();
  const wPairs = [
    ['"', '"'],
    ["'", "'"],
    ['«', '»'],
  ];
  for (const [wOpen, wClose] of wPairs) {
    if (wTrimmed.startsWith(wOpen) && wTrimmed.endsWith(wClose) && wTrimmed.length > wOpen.length) {
      wTrimmed = wTrimmed.slice(wOpen.length, wClose.length ? -wClose.length : undefined).trim();
      break;
    }
  }
  return wTrimmed;
}

/**
 * @param {unknown} text
 * @returns {string|null}
 */
export function normalizeFormulaText(text) {
  let wTrimmed = stripOuterQuotes(String(text ?? '').trim());
  wTrimmed = wTrimmed.replace(/^(?:la\s+formule|formule)\s+/iu, '');
  if (/^=+/.test(wTrimmed) && wTrimmed.length > 1) {
    return '=' + wTrimmed.replace(/^=+/, '');
  }
  if (!isFormulaText(wTrimmed)) {
    return null;
  }
  return wTrimmed;
}

/**
 * Normalize AI-provided cell values (formulas, stray "la formule" prefix, ==SUM → =SUM).
 * @param {unknown} text
 * @returns {string}
 */
export function normalizeWriteCellValue(text) {
  let wTrimmed = stripOuterQuotes(String(text ?? '').trim());
  if (!wTrimmed) {
    return '';
  }
  const wFormula = normalizeFormulaText(wTrimmed);
  if (wFormula) {
    return wFormula;
  }
  return wTrimmed.replace(/^(?:la\s+formule|formule)\s+/iu, '').trim();
}

/**
 * @param {unknown} text
 * @returns {number|null}
 */
export function parseNumericCellString(text) {
  if (typeof text === 'number' && Number.isFinite(text)) {
    return text;
  }
  let wStr = String(text ?? '').trim();
  if (wStr === '') {
    return null;
  }
  if (isFormulaText(wStr)) {
    return null;
  }

  wStr = wStr.replace(/\s*(€|\$|£|EUR|USD|%)\s*$/i, '').trim();
  if (/^-?\d{1,3}(?:[ \u00a0.]\d{3})+,\d+$/.test(wStr)) {
    wStr = wStr.replace(/[ \u00a0.]/g, '').replace(',', '.');
  } else if (/^-?\d+,\d+$/.test(wStr)) {
    wStr = wStr.replace(',', '.');
  } else {
    wStr = wStr.replace(/[ \u00a0]/g, '');
  }

  if (!/^-?\d+(?:\.\d+)?$/.test(wStr)) {
    return null;
  }
  const wNum = Number(wStr);
  return Number.isFinite(wNum) ? wNum : null;
}

/**
 * @param {unknown} text
 * @returns {{ t: 'da', v: string }|null}
 */
export function dateTextToPasteCellValue(text) {
  const wTrimmed = String(text ?? '').trim();
  if (!wTrimmed || isFormulaText(wTrimmed)) {
    return null;
  }

  const wUs = parseUsDateString(wTrimmed);
  if (wUs) {
    return { t: 'da', v: toVariantDateWire(wUs) };
  }

  const wEuro = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(wTrimmed);
  if (!wEuro) {
    return null;
  }

  let wDay = Number(wEuro[1]);
  let wMonth = Number(wEuro[2]);
  const wYear = Number(wEuro[3]);
  if (wDay > 12 && wMonth <= 12) {
    // dd/mm/yyyy
  } else if (wMonth > 12 && wDay <= 12) {
    wMonth = Number(wEuro[1]);
    wDay = Number(wEuro[2]);
  }

  const wDate = new Date(wYear, wMonth - 1, wDay);
  if (
    wDate.getFullYear() !== wYear ||
    wDate.getMonth() !== wMonth - 1 ||
    wDate.getDate() !== wDay
  ) {
    return null;
  }
  return { t: 'da', v: toVariantDateWire({ year: wYear, month: wMonth, day: wDay }) };
}

/**
 * @param {unknown} value
 * @returns {{ kind: 'skip'|'number'|'date'|'formula'|'text', t?: string, v?: number|string, formula?: string, text?: string }}
 */
export function classifyPasteScalar(value) {
  if (value == null) {
    return { kind: 'skip' };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { kind: 'number', t: 'd', v: value };
  }

  const wFormula = normalizeFormulaText(value);
  if (wFormula) {
    return { kind: 'formula', formula: wFormula };
  }

  const wNum = parseNumericCellString(value);
  if (wNum != null) {
    return { kind: 'number', t: 'd', v: wNum };
  }

  const wDate = dateTextToPasteCellValue(value);
  if (wDate) {
    return { kind: 'date', t: wDate.t, v: wDate.v };
  }

  const wText = String(value);
  if (wText === '') {
    return { kind: 'skip' };
  }
  return { kind: 'text', text: wText };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function formatValueForWasmCall(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  const wFormula = normalizeFormulaText(value);
  if (wFormula) {
    return wFormula;
  }

  const wNum = parseNumericCellString(value);
  if (wNum != null) {
    return String(wNum);
  }

  const wDate = dateTextToPasteCellValue(value);
  if (wDate) {
    const [wMm, wDd, wYyyy] = wDate.v.split('-');
    return `${wMm}/${wDd}/${wYyyy}`;
  }

  return String(value ?? '');
}
