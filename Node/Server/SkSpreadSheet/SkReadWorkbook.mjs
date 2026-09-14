//=============================================================================
// SkReadWorkbook.mjs — serialize .sker workbook JSON for AI / MCP read_workbook
//=============================================================================

/** Internal sker host sheets (cell-class registry) — hidden from full reads by default. */
export const SK_INTERNAL_SHEET_PREFIX = '_$$';

/**
 * Extract a balanced {...} JSON object from raw text (string-aware).
 * @param {string} text
 * @param {number} startIndex — index of opening {
 * @returns {string|null}
 */
export function extractBalancedJsonObject(text, startIndex) {
  if (typeof text !== 'string' || startIndex < 0 || text[startIndex] !== '{') {
    return null;
  }
  let wDepth = 0;
  let wInString = false;
  let wEscape = false;
  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (wInString) {
      if (wEscape) {
        wEscape = false;
      } else if (ch === '\\') {
        wEscape = true;
      } else if (ch === '"') {
        wInString = false;
      }
      continue;
    }
    if (ch === '"') {
      wInString = true;
      continue;
    }
    if (ch === '{') {
      wDepth += 1;
    } else if (ch === '}') {
      wDepth -= 1;
      if (wDepth === 0) {
        return text.slice(startIndex, i + 1);
      }
    }
  }
  return null;
}

/**
 * Recover Call(WriteJson) envelope when outer JSON.parse fails (legacy WASM glue).
 * @param {string} rawString
 * @returns {{ result: unknown }|null}
 */
export function recoverWriteJsonCallEnvelope(rawString) {
  if (typeof rawString !== 'string' || rawString.trim() === '') {
    return null;
  }
  const wText = rawString.trim();

  const wDirect = /^\{"result"\s*:\s*\{/.exec(wText);
  if (wDirect) {
    const wStart = wDirect.index + wDirect[0].length - 1;
    const wInner = extractBalancedJsonObject(wText, wStart);
    if (wInner) {
      try {
        return { result: JSON.parse(wInner) };
      } catch {
        return { result: wInner };
      }
    }
  }

  const wMarker = '"result":"';
  const wIdx = wText.indexOf(wMarker);
  if (wIdx >= 0) {
    const wStart = wIdx + wMarker.length;
    if (wText[wStart] === '{') {
      const wInner = extractBalancedJsonObject(wText, wStart);
      if (wInner) {
        try {
          return { result: JSON.parse(wInner) };
        } catch {
          return { result: wInner };
        }
      }
    }
  }

  return null;
}

/**
 * @param {unknown} writeJsonResult — WASM Call(WriteJson) result (object or JSON string)
 * @returns {object}
 */
export function parseWriteJsonWorkbook(writeJsonResult) {
  if (writeJsonResult == null) {
    throw new Error('WriteJson returned empty result');
  }
  if (typeof writeJsonResult === 'object') {
    return writeJsonResult;
  }
  if (typeof writeJsonResult !== 'string') {
    throw new Error('WriteJson returned unexpected type');
  }
  const wTrimmed = writeJsonResult.trim();
  if (wTrimmed === '') {
    throw new Error('WriteJson returned empty string');
  }
  try {
    return JSON.parse(wTrimmed);
  } catch (parseError) {
    throw new Error(`WriteJson returned invalid JSON: ${parseError.message}`);
  }
}

/**
 * @param {string} sheetName
 */
function namedRangeSheetName(entry) {
  if (entry == null || typeof entry !== 'object') {
    return '';
  }
  return typeof entry.s === 'string' ? entry.s : typeof entry.sheet === 'string' ? entry.sheet : '';
}

/**
 * Filter a parsed .sker document for AI consumption.
 * @param {object} doc
 * @param {{ sheet?: string, includeInternalSheets?: boolean }} [options]
 * @returns {object}
 */
export function filterWorkbookDocument(doc, options = {}) {
  if (doc == null || typeof doc !== 'object') {
    return doc;
  }

  const wSheetFilter = typeof options.sheet === 'string' ? options.sheet.trim() : '';
  const wIncludeInternal = options.includeInternalSheets === true;
  const wFiltered = { ...doc };

  if (Array.isArray(wFiltered.sheets)) {
    if (wSheetFilter !== '') {
      const wMatched = wFiltered.sheets.filter((s) => s?.name === wSheetFilter);
      if (wMatched.length === 0) {
        const wAvailable = wFiltered.sheets
          .map((s) => s?.name)
          .filter((n) => typeof n === 'string' && n !== '');
        throw new Error(
          `Sheet not found: ${wSheetFilter}${
            wAvailable.length > 0 ? ` (available: ${wAvailable.join(', ')})` : ''
          }`
        );
      }
      wFiltered.sheets = wMatched;
    } else if (!wIncludeInternal) {
      wFiltered.sheets = wFiltered.sheets.filter(
        (s) => !String(s?.name || '').startsWith(SK_INTERNAL_SHEET_PREFIX)
      );
    }
  }

  if (wSheetFilter !== '' && Array.isArray(wFiltered.namedranges)) {
    wFiltered.namedranges = wFiltered.namedranges.filter(
      (nr) => namedRangeSheetName(nr) === wSheetFilter
    );
  }

  return wFiltered;
}

/**
 * @param {object} workbook
 * @param {{ path: string, sheet?: string|null, scope?: string }} meta
 */
export function buildReadWorkbookResponse(workbook, meta) {
  const wJsonText = JSON.stringify(workbook);
  return {
    path: meta.path,
    scope: meta.scope || (meta.sheet ? 'sheet' : 'workbook'),
    sheet: meta.sheet ?? null,
    source: meta.source || 'wasm',
    sheetCount: Array.isArray(workbook?.sheets) ? workbook.sheets.length : 0,
    jsonChars: wJsonText.length,
    workbook,
    _hint:
      'Native .sker JSON: si[]=shared strings, fi[]=formulas (R1C1), fo[]=format index into f.formats (CSS).',
  };
}
