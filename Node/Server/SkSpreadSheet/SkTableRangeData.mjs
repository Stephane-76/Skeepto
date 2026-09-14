//=============================================================================
// SkTableRangeData.mjs — RangeData / Excel table helpers for MCP (server-side)
//=============================================================================

import { parseA1Range } from './SkBuildPasteClipboard.mjs';

const DEFAULT_TABLE_STYLE = 'TableStyleMedium2';

function colToNum(col) {
  let n = 0;
  for (const ch of String(col || '').toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

/**
 * @param {unknown} result — WASM Call() result field
 */
export function unwrapWasmJsonPayload(result) {
  if (result == null) {
    return {};
  }
  if (typeof result === 'string') {
    try {
      const wParsed = JSON.parse(result);
      if (wParsed?.namedranges) {
        return wParsed;
      }
      if (wParsed?.result != null) {
        const wInner =
          typeof wParsed.result === 'string'
            ? JSON.parse(wParsed.result || '{}')
            : wParsed.result;
        return wInner && typeof wInner === 'object' ? wInner : {};
      }
      return wParsed && typeof wParsed === 'object' ? wParsed : {};
    } catch {
      return {};
    }
  }
  if (typeof result === 'object') {
    if (result.namedranges) {
      return result;
    }
    if (result.result != null) {
      const wInner =
        typeof result.result === 'string'
          ? JSON.parse(result.result || '{}')
          : result.result;
      return wInner && typeof wInner === 'object' ? wInner : {};
    }
    return result;
  }
  return {};
}

/** @param {object} sCol @param {object|null} sRange */
export function sheetColFromColumn(sCol, sRange) {
  if (sCol?.col != null && Number.isFinite(Number(sCol.col))) {
    return Number(sCol.col);
  }
  const wLeft = Number(sRange?.left) || 1;
  const wRight = Number(sRange?.right) || wLeft;
  const wMaxOffset = Math.max(0, wRight - wLeft);
  const wIdx = Number(sCol?.index) || 0;
  const wColumns = sRange?.data?.columns;
  let wMaxStored = wIdx;
  if (Array.isArray(wColumns)) {
    for (const wC of wColumns) {
      const wRaw =
        wC?.col != null && Number.isFinite(Number(wC.col))
          ? Number(wC.col)
          : Number(wC?.index) || 0;
      wMaxStored = Math.max(wMaxStored, wRaw);
    }
  }
  if (wMaxStored > wMaxOffset) {
    return wIdx;
  }
  const wHasZero = Array.isArray(wColumns)
    ? wColumns.some((wC) => Number(wC?.index) === 0)
    : wIdx === 0;
  if (wHasZero) {
    return wLeft + wIdx;
  }
  return wLeft + wIdx - 1;
}

/** @param {object} sCol @param {object} sRange */
export function columnOffset(sCol, sRange) {
  const wLeft = Number(sRange?.left) || 1;
  return sheetColFromColumn(sCol, sRange) - wLeft;
}

/** @param {object} sCol @param {object|null} sRange */
export function sanitizeFilterColumn(sCol, sRange = null) {
  const wSheetCol = sheetColFromColumn(sCol, sRange);
  const wCopy = {
    col: wSheetCol,
    type: sCol.type || 'Text',
    filterop: sCol.filterop ?? 'None',
    filtervalue: sCol.filtervalue ? { ...sCol.filtervalue } : { t: 'n', v: null },
    order: sCol.order ?? 'None',
    filterButtonHidden: sCol.filterButtonHidden === true,
  };
  if (Array.isArray(sCol.filtervalues)) {
    wCopy.filtervalues = sCol.filtervalues
      .filter((item) => item && item.v != null && item.v !== '')
      .map((item) => ({ ...item }));
  }
  if (wCopy.filterop === 'Unknown') {
    wCopy.filterop = 'None';
  }
  return wCopy;
}

/**
 * @param {object} sTable
 * @returns {object}
 */
export function normalizeTableColumns(sTable) {
  const wRange = sTable?.range;
  if (!wRange) {
    return sTable;
  }
  const wLeft = Number(wRange.left) || 1;
  const wRight = Number(wRange.right) || wLeft;
  const wWidth = Math.max(1, wRight - wLeft + 1);
  const wBySheetCol = new Map();

  for (const wCol of sTable.data?.columns || []) {
    const wSheetCol = sheetColFromColumn(wCol, wRange);
    const wOff = wSheetCol - wLeft;
    if (wOff < 0 || wOff >= wWidth) {
      continue;
    }
    wBySheetCol.set(wSheetCol, sanitizeFilterColumn({ ...wCol, col: wSheetCol }, wRange));
  }

  const wColumns = [];
  for (let wOff = 0; wOff < wWidth; wOff += 1) {
    const wSheetCol = wLeft + wOff;
    wColumns.push(
      wBySheetCol.get(wSheetCol) || {
        col: wSheetCol,
        type: 'Text',
        filterop: 'None',
        filtervalue: { t: 'n', v: null },
        order: 'None',
      }
    );
  }
  return {
    ...sTable,
    data: { ...sTable.data, columns: wColumns },
  };
}

/**
 * All named-range / table names from JsonRangeData or JsonRangeNamed payload.
 * @param {object} sJson
 */
export function parseRangeNamesFromJson(sJson) {
  const wList = sJson?.namedranges;
  if (!Array.isArray(wList)) {
    return [];
  }
  return wList.map((wEntry) => String(wEntry?.n || '')).filter(Boolean);
}

/**
 * @param {object} sJson
 * @param {string} [sheetName]
 */
export function parseTablesFromRangeData(sJson, sheetName = '') {
  const wSheetFilter = String(sheetName || '');
  const wList = sJson?.namedranges;
  if (!Array.isArray(wList)) {
    return [];
  }
  const wOut = [];
  for (const wEntry of wList) {
    if (!wEntry?.data?.columns?.length) {
      continue;
    }
    if (wSheetFilter && String(wEntry.s || '') !== wSheetFilter) {
      continue;
    }
    const wRange = parseA1Range(String(wEntry.r || ''));
    wOut.push(
      normalizeTableColumns({
        name: String(wEntry.n || ''),
        sheet: String(wEntry.s || ''),
        ref: String(wEntry.r || ''),
        range: wRange,
        data: wEntry.data,
        headerRow: wRange.top,
      })
    );
  }
  return wOut;
}

/**
 * @param {string[]} sExistingNames
 */
export function nextTableName(sExistingNames = []) {
  const wNames = new Set(sExistingNames.map((n) => String(n).toLowerCase()));
  let wIndex = 1;
  while (wNames.has(`table${wIndex}`)) {
    wIndex += 1;
  }
  return `Table${wIndex}`;
}

/**
 * @param {number} sLeft
 * @param {number} sRight
 * @param {string} [sStyleName]
 */
export function buildCreateTableJson(sLeft, sRight, sStyleName = DEFAULT_TABLE_STYLE) {
  const wLeft = Number(sLeft) || 1;
  const wRight = Math.max(wLeft, Number(sRight) || wLeft);
  const wColumns = [];
  for (let wCol = wLeft; wCol <= wRight; wCol += 1) {
    wColumns.push({
      col: wCol,
      type: 'Text',
      filterop: 'None',
      filtervalue: { t: 'n', v: null },
      order: 'None',
    });
  }
  return JSON.stringify({
    columns: wColumns,
    tableStyleName: sStyleName || DEFAULT_TABLE_STYLE,
    tableShowRowStripes: true,
    tableAutoFilter: true,
  });
}

/**
 * Resolve column arg: 0-based offset, column letter, or 1-based sheet column number.
 * @param {object} sTable
 * @param {string|number} sColumn
 */
export function resolveTableSheetColumn(sTable, sColumn) {
  const wRange = sTable.range;
  const wLeft = Number(wRange?.left) || 1;
  const wRight = Number(wRange?.right) || wLeft;

  if (typeof sColumn === 'number' && Number.isFinite(sColumn)) {
    if (sColumn >= wLeft && sColumn <= wRight) {
      return Math.floor(sColumn);
    }
    const wOffset = Math.floor(sColumn);
    const wSheetCol = wLeft + wOffset;
    if (wSheetCol >= wLeft && wSheetCol <= wRight) {
      return wSheetCol;
    }
    throw new Error(
      `Column offset ${wOffset} is outside table range (${wLeft}-${wRight})`
    );
  }

  const wText = String(sColumn || '').trim();
  if (/^[A-Za-z]+$/.test(wText)) {
    const wSheetCol = colToNum(wText);
    if (wSheetCol < wLeft || wSheetCol > wRight) {
      throw new Error(`Column ${wText.toUpperCase()} is outside table ${sTable.ref}`);
    }
    return wSheetCol;
  }

  throw new Error(`Invalid column: ${sColumn} (use letter e.g. B or 0-based offset)`);
}

/**
 * Build RangeData JSON for UndoApplyRangeData (sort + filter on one column).
 * @param {object} sTableData
 * @param {object} sTableRange
 * @param {number} sTargetSheetCol — 1-based sheet column
 * @param {object} sPatch
 */
export function buildApplyTablePatchJson(sTableData, sTableRange, sTargetSheetCol, sPatch) {
  const wLeft = Number(sTableRange?.left) || 1;
  const wRight = Number(sTableRange?.right) || wLeft;
  const wWidth = Math.max(1, wRight - wLeft + 1);
  const wTargetIdx = sTargetSheetCol - wLeft;
  const wColumnsIn = sTableData.columns || [];
  const wBySheetCol = new Map();

  for (const wCol of wColumnsIn) {
    const wSheetCol = sheetColFromColumn(wCol, sTableRange);
    if (wSheetCol >= wLeft && wSheetCol <= wRight) {
      wBySheetCol.set(
        wSheetCol,
        sanitizeFilterColumn({ ...wCol, col: wSheetCol }, sTableRange)
      );
    }
  }

  const wColumns = [];
  for (let wOff = 0; wOff < wWidth; wOff += 1) {
    const wSheetCol = wLeft + wOff;
    const wCopy = wBySheetCol.get(wSheetCol) || {
      col: wSheetCol,
      type: 'Text',
      filterop: 'None',
      filtervalue: { t: 'n', v: null },
      order: 'None',
    };
    if (wOff === wTargetIdx) {
      if (sPatch.sortOrder != null) {
        wCopy.order = sPatch.sortOrder;
      }
      if (sPatch.filterop != null) {
        wCopy.filterop = sPatch.filterop;
      }
      if (sPatch.filterop === 'None') {
        wCopy.filtervalue = sPatch.filtervalue ?? { t: 'n', v: null };
        delete wCopy.filtervalues;
      } else if (sPatch.filtervalues != null) {
        wCopy.filtervalues = sPatch.filtervalues;
        wCopy.filterop = sPatch.filterop ?? 'Equals';
        wCopy.filtervalue =
          sPatch.filtervalue ??
          (sPatch.filtervalues[0] || { t: 'n', v: null });
      } else if (sPatch.filtervalue != null) {
        wCopy.filtervalue = sPatch.filtervalue;
        delete wCopy.filtervalues;
      }
    } else if (sPatch.sortOrder && sPatch.sortOrder !== 'None') {
      wCopy.order = 'None';
    }
    wColumns.push(wCopy);
  }

  const wPayload = { columns: wColumns };
  if (sTableData.tableStyleName) {
    wPayload.tableStyleName = sTableData.tableStyleName;
  }
  if (sTableData.tableShowRowStripes != null) {
    wPayload.tableShowRowStripes = !!sTableData.tableShowRowStripes;
  }
  if (sTableData.tableAutoFilter != null) {
    wPayload.tableAutoFilter = !!sTableData.tableAutoFilter;
  } else {
    wPayload.tableAutoFilter = true;
  }
  if (sTableData.lastrow === true) {
    wPayload.lastrow = true;
  }
  if (Number(sTableData.totalsRowCount) > 0) {
    wPayload.totalsRowCount = Number(sTableData.totalsRowCount);
  }
  return JSON.stringify(wPayload);
}

/**
 * @param {object} sFilter
 * @returns {object}
 */
export function buildFilterPatchFromMcpFilter(sFilter) {
  if (!sFilter || typeof sFilter !== 'object') {
    return { filterop: 'None', filtervalue: { t: 'n', v: null } };
  }
  const wOp = String(sFilter.op || sFilter.filterop || 'None');
  if (wOp === 'None') {
    return { filterop: 'None', filtervalue: { t: 'n', v: null } };
  }
  if (wOp === 'IsEmpty' || wOp === 'IsNotEmpty') {
    return { filterop: wOp, filtervalue: { t: 'n', v: null } };
  }
  const wValues = Array.isArray(sFilter.values)
    ? sFilter.values.map((v) => String(v)).filter(Boolean)
    : [];
  if (wValues.length > 1) {
    const wFilterValues = wValues.map((v) => ({ t: 's', v }));
    return {
      filterop: 'Equals',
      filtervalues: wFilterValues,
      filtervalue: wFilterValues[0],
    };
  }
  if (wValues.length === 1) {
    return {
      filterop: wOp === 'Contains' ? 'Contains' : 'Equals',
      filtervalue: { t: 's', v: wValues[0] },
    };
  }
  const wVal = sFilter.value;
  if (wVal != null && String(wVal).trim() !== '') {
    const wType = typeof wVal === 'number' ? 'n' : 's';
    return {
      filterop: wOp === 'Contains' ? 'Contains' : wOp === 'Equals' ? 'Equals' : wOp,
      filtervalue: { t: wType, v: wVal },
    };
  }
  return { filterop: wOp, filtervalue: { t: 'n', v: null } };
}

/**
 * @param {object} sTable
 */
export function summarizeTableForMcp(sTable) {
  const wRange = sTable.range;
  return {
    name: sTable.name,
    sheet: sTable.sheet,
    ref: sTable.ref,
    range: wRange
      ? { top: wRange.top, left: wRange.left, bottom: wRange.bottom, right: wRange.right }
      : null,
    style: sTable.data?.tableStyleName || null,
    totalsRow: sTable.data?.lastrow === true,
    columns: (sTable.data?.columns || []).map((col) => ({
      col: col.col,
      sort: col.order || 'None',
      filter: col.filterop || 'None',
    })),
  };
}

/**
 * @param {object[]} sTables
 * @param {string} sTableName
 * @param {string} [sSheet]
 */
export function findTableByName(sTables, sTableName, sSheet = '') {
  const wName = String(sTableName || '').trim();
  const wSheet = String(sSheet || '').trim();
  return sTables.find((t) => {
    if (String(t.name) !== wName) {
      return false;
    }
    if (wSheet && String(t.sheet) !== wSheet) {
      return false;
    }
    return true;
  });
}
