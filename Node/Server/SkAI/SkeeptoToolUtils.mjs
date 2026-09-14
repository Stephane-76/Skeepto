//=============================================================================
// SkeeptoToolUtils.mjs — shared helpers for MCP / AI tools
//=============================================================================

/**
 * Parse A1 or Sheet!A1 into { ref, sheet }.
 * @param {string} refArg
 * @param {string} [sheetArg]
 */
export function parseRefAndSheet(refArg, sheetArg) {
  if (sheetArg && sheetArg.trim() !== '') {
    return { ref: refArg, sheet: sheetArg };
  }
  const wBang = refArg.indexOf('!');
  if (wBang > 0) {
    return {
      sheet: refArg.slice(0, wBang).replace(/^'|'$/g, ''),
      ref: refArg.slice(wBang + 1),
    };
  }
  return { ref: refArg, sheet: '' };
}

/**
 * @param {string} range — e.g. A1, H11:J13
 * @returns {string} trimmed range
 */
export function validateA1RangeRef(range) {
  const wTrimmed = String(range ?? '').trim();
  if (!wTrimmed) {
    throw new Error('Range is required (e.g. H11:J13)');
  }
  const wOk = /^[A-Za-z]+\d+(?::[A-Za-z]+\d+)?$/.test(wTrimmed);
  if (!wOk) {
    throw new Error(`Invalid A1 range: ${range} (expected e.g. H11:J13)`);
  }
  return wTrimmed;
}

/**
 * WASM Merge expects { ref, sheet? } — agents often send range or omit ref.
 * @param {Record<string, unknown>} params
 * @returns {Record<string, unknown>}
 */
export function normalizeMergeWasmParams(params) {
  const wSrc = params && typeof params === 'object' ? params : {};
  const wRef = validateA1RangeRef(
    typeof wSrc.ref === 'string' ? wSrc.ref : typeof wSrc.range === 'string' ? wSrc.range : ''
  );
  const wOut = { ...wSrc, ref: wRef };
  delete wOut.range;
  return wOut;
}

/**
 * @param {string} range — e.g. A1:C3
 * @returns {string[]}
 */
export function expandRange(range) {
  const wMatch = /^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/.exec(range.trim());
  if (!wMatch) {
    throw new Error(`Invalid range: ${range} (expected e.g. A1:C3)`);
  }

  const colToNum = (col) => {
    let n = 0;
    for (const ch of col.toUpperCase()) {
      n = n * 26 + (ch.charCodeAt(0) - 64);
    }
    return n;
  };

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

  const c1 = colToNum(wMatch[1]);
  const r1 = Number(wMatch[2]);
  const c2 = colToNum(wMatch[3]);
  const r2 = Number(wMatch[4]);
  const wCells = [];

  for (let row = Math.min(r1, r2); row <= Math.max(r1, r2); row++) {
    for (let col = Math.min(c1, c2); col <= Math.max(c1, c2); col++) {
      wCells.push(`${numToCol(col)}${row}`);
    }
  }
  return wCells;
}

/**
 * @param {unknown} value
 */
export function formatToolText(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
