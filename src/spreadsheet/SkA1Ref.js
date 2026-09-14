//=============================================================================
// SkA1Ref — A1 ref encode/decode via WASM lexer (SkTools::ParseCell/ParseRange).
//=============================================================================

function wasmEngine() {
  const ui = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
  if (!ui) {
    throw new Error("SkA1Ref: SkUISpreadSheet not available");
  }
  return ui._requireEngine("SkA1Ref");
}

function parseWasmJson(raw) {
  if (typeof raw !== "string" || !raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/** Index of sheet/cell separator outside quoted sheet names. */
export function findSheetRefSeparator(sText) {
  const wText = String(sText || "");
  let wInQuote = false;
  for (let wIdx = 0; wIdx < wText.length; wIdx++) {
    if (wText[wIdx] === "'") {
      wInQuote = !wInQuote;
    } else if (wText[wIdx] === "!" && !wInQuote) {
      return wIdx;
    }
  }
  return -1;
}

/** Drop optional sheet prefix: Sheet1!A1 → A1. */
export function stripSheetPrefixFromRef(sRef) {
  const wText = String(sRef || "").trim();
  const wSep = findSheetRefSeparator(wText);
  if (wSep < 0) {
    return wText;
  }
  return wText.substring(wSep + 1).trim();
}

/** First union area (commas/semicolons outside 'Sheet, Name'). */
export function firstUnionArea(sText) {
  let wPart = "";
  let wInQuote = false;
  const wText = String(sText || "");
  for (let wIdx = 0; wIdx <= wText.length; wIdx++) {
    const wCh = wIdx < wText.length ? wText[wIdx] : ",";
    if (wCh === "'") {
      wInQuote = !wInQuote;
    }
    if ((wCh === "," || wCh === ";") && !wInQuote) {
      const wTrim = wPart.trim();
      return wTrim || wText.trim();
    }
    wPart += wCh;
  }
  return wText.trim();
}

/** Column letters → 1-based index (A=1). WASM AlphaToBase10. */
export function alphaToBase10Sync(sLetters) {
  return wasmEngine().AlphaToBase10(String(sLetters || ""));
}

/** 1-based index → column letters. WASM Base10toAlpha. */
export function base10toAlphaSync(sIndex) {
  return wasmEngine().Base10toAlpha(Number(sIndex) || 0);
}

export const colLettersToIndex = alphaToBase10Sync;
export const indexToColLetters = base10toAlphaSync;

/** Build A1 cell ref from 1-based row/col. */
export function cellRefFromRowCol(sRow, sCol) {
  const wRow = Number(sRow) || 0;
  const wCol = Number(sCol) || 0;
  if (wRow < 1 || wCol < 1) {
    return "";
  }
  return `${base10toAlphaSync(wCol)}${wRow}`;
}

/** Parse one cell ref (A1, $B$2, Sheet1!C3) → { row, col } (1-based). */
export function parseCellRefSync(sRef) {
  const wBody = stripSheetPrefixFromRef(sRef);
  if (!wBody) {
    return null;
  }
  const wJson = parseWasmJson(wasmEngine().ParseCell(wBody));
  if (wJson?.ok !== true) {
    return null;
  }
  const wRow = Number(wJson.row);
  const wCol = Number(wJson.col);
  if (!Number.isFinite(wRow) || !Number.isFinite(wCol) || wRow < 1 || wCol < 1) {
    return null;
  }
  return { row: wRow, col: wCol };
}

/** Parse range ref → { top, left, bottom, right }; first union area only. */
export function parseRangeBoundsSync(sRangeRef) {
  const wText = firstUnionArea(stripSheetPrefixFromRef(String(sRangeRef || "").trim()));
  if (!wText) {
    return null;
  }
  const wJson = parseWasmJson(wasmEngine().ParseRange(wText));
  if (wJson?.ok !== true) {
    return null;
  }
  const top = Number(wJson.top);
  const left = Number(wJson.left);
  const bottom = Number(wJson.bottom);
  const right = Number(wJson.right);
  if (![top, left, bottom, right].every((n) => Number.isFinite(n) && n >= 1)) {
    return null;
  }
  return {
    top: Math.min(top, bottom),
    left: Math.min(left, right),
    bottom: Math.max(top, bottom),
    right: Math.max(left, right),
  };
}

/** Legacy alias for SkTableFilter.parseA1Range. */
export const parseA1Range = parseRangeBoundsSync;
