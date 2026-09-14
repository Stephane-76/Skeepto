// Table / RangeData helpers for autofilter UI (header row filter buttons + popup).

import {
  colLettersToIndex,
  indexToColLetters,
  parseA1Range,
  cellRefFromRowCol as cellRef,
} from "./SkA1Ref.js";

export { colLettersToIndex, indexToColLetters, parseA1Range, cellRef };

const FILTER_BTN = 14;
const FILTER_BTN_PAD = 2;

/** Match table column refs to wrapped Excel header cells (newlines -> spaces). */
export function normalizeTableColumnLabel(sLabel) {
  return String(sLabel ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/  +/g, " ")
    .trim();
}

/** Absolute sheet column from RangeData column descriptor. */
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
  const wAbsolute = wMaxStored > wMaxOffset;
  if (wAbsolute) {
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

/** 0-based offset within table range. */
export function columnOffset(sCol, sRange) {
  const wLeft = Number(sRange?.left) || 1;
  return sheetColFromColumn(sCol, sRange) - wLeft;
}

/** @deprecated Legacy helper — prefer sheetColFromColumn / columnOffset. */
export function usesAbsoluteColumnIndices(sColumns, sRange) {
  if (!sRange || !Array.isArray(sColumns) || sColumns.length === 0) {
    return false;
  }
  const wLeft = Number(sRange.left) || 1;
  const wRight = Number(sRange.right) || wLeft;
  const wMaxRelative = Math.max(0, wRight - wLeft);
  for (const wCol of sColumns) {
    if (wCol?.col != null) return true;
    if ((Number(wCol.index) || 0) > wMaxRelative) return true;
  }
  return false;
}

/** @deprecated Legacy helper — prefer columnOffset. */
export function rangeColumnIndex(sTableOrRange, sColumnIndex, sColumns = null) {
  const wRange = sTableOrRange?.range ?? sTableOrRange;
  const wCol = { index: sColumnIndex };
  if (Array.isArray(sColumns)) {
    const wMatch = sColumns.find(
      (c) => Number(c?.index) === Number(sColumnIndex) || Number(c?.col) === Number(sColumnIndex)
    );
    if (wMatch) {
      return columnOffset(wMatch, wRange);
    }
  }
  return columnOffset(wCol, wRange);
}

/** Sanitize filter metadata saved from a corrupted or partial session. */
export function sanitizeFilterColumn(sCol, sRange = null) {
  const wSheetCol = sheetColFromColumn(sCol, sRange);
  const copy = {
    col: wSheetCol,
    type: sCol.type || "Text",
    filterop: sCol.filterop ?? "None",
    filtervalue: sCol.filtervalue
      ? { ...sCol.filtervalue }
      : { t: "n", v: null },
    order: sCol.order ?? "None",
    filterButtonHidden: sCol.filterButtonHidden === true,
  };
  if (Array.isArray(sCol.filtervalues)) {
    copy.filtervalues = sCol.filtervalues
      .filter((item) => item && item.v != null && item.v !== "")
      .map((item) => ({ ...item }));
  }
  if (copy.filterop === "Unknown") {
    copy.filterop = "None";
  }
  const wVal = copy.filtervalue?.v;
  const wHasMulti =
    Array.isArray(copy.filtervalues) && copy.filtervalues.length > 0;
  if (
    copy.filterop !== "None" &&
    copy.filterop !== "IsEmpty" &&
    copy.filterop !== "IsNotEmpty" &&
    !wHasMulti &&
    (wVal == null || wVal === "")
  ) {
    copy.filterop = "None";
    copy.filtervalue = { t: "n", v: null };
    delete copy.filtervalues;
  }
  return copy;
}

/**
 * One RangeData column per sheet column in the table range.
 */
export function normalizeTableColumns(sTable) {
  const wRange = sTable?.range;
  if (!wRange) return sTable;
  const wLeft = Number(wRange.left) || 1;
  const wRight = Number(wRange.right) || wLeft;
  const wWidth = Math.max(1, wRight - wLeft + 1);
  const wBySheetCol = new Map();

  for (const wCol of sTable.data?.columns || []) {
    const wSheetCol = sheetColFromColumn(wCol, wRange);
    const wOff = wSheetCol - wLeft;
    if (wOff < 0 || wOff >= wWidth) continue;
    const wSan = sanitizeFilterColumn({ ...wCol, col: wSheetCol }, wRange);
    const wPrev = wBySheetCol.get(wSheetCol);
    if (!wPrev) {
      wBySheetCol.set(wSheetCol, wSan);
      continue;
    }
    const wPrevActive = wPrev.filterop && wPrev.filterop !== "None";
    const wNewActive = wSan.filterop && wSan.filterop !== "None";
    const wPickNew = wNewActive && !wPrevActive;
    wBySheetCol.set(wSheetCol, wPickNew ? wSan : wPrev);
  }

  const wColumns = [];
  for (let wOff = 0; wOff < wWidth; wOff++) {
    const wSheetCol = wLeft + wOff;
    if (wBySheetCol.has(wSheetCol)) {
      wColumns.push(wBySheetCol.get(wSheetCol));
    } else {
      wColumns.push({
        col: wSheetCol,
        type: "Text",
        filterop: "None",
        filtervalue: { t: "n", v: null },
        order: "None",
      });
    }
  }
  return {
    ...sTable,
    data: { ...sTable.data, columns: wColumns },
  };
}

export function parseSheetTables(sJson, sheetName) {
  const wSheet = String(sheetName || "");
  const wList = sJson?.namedranges;
  if (!Array.isArray(wList)) return [];
  const out = [];
  for (const entry of wList) {
    if (!entry?.data?.columns?.length) continue;
    if (String(entry.s || "") !== wSheet) continue;
    const wRange = parseA1Range(entry.r);
    if (!wRange) continue;
    out.push(
      normalizeTableColumns({
        name: String(entry.n || ""),
        sheet: wSheet,
        ref: String(entry.r || ""),
        range: wRange,
        data: entry.data,
        headerRow: wRange.top,
      })
    );
  }
  return out;
}

/** True when the OOXML header filter dropdown is hidden for this column. */
export function isFilterButtonHidden(sCol) {
  return sCol?.filterButtonHidden === true;
}

/** True when any column still shows a visible filter button. */
export function hasVisibleFilterButton(sTable) {
  return (sTable?.data?.columns || []).some((c) => !isFilterButtonHidden(c));
}

/** True when any column has an active filter or sort. */
export function hasActiveTableFilterOrSort(sTable) {
  return (sTable?.data?.columns || []).some(
    (c) =>
      (c.filterop && c.filterop !== "None" && c.filterop !== "Unknown") ||
      (c.order && c.order !== "None")
  );
}

/**
 * RangeData tables that should paint sker header filter/sort buttons.
 * Show by default for all tables with a header row; honor explicit
 * tableAutoFilter / showAutoFilter=false and per-column filterButtonHidden.
 */
export function isTableFilterEligible(sTable) {
  if (!sTable?.data?.columns?.length) return false;
  const wRange = sTable.range;
  if (!wRange || wRange.bottom <= wRange.top) return false;
  if (sTable.data?.firstrow === false) return false;
  if (!hasVisibleFilterButton(sTable)) return false;

  const wShowAutoFilter =
    sTable.data?.showAutoFilter ?? sTable.data?.tableAutoFilter;
  if (wShowAutoFilter === false) return false;
  return true;
}

/** Sheet column (1-based) for a RangeData column index or descriptor. */
export function sheetColForColumnIndex(sTable, sColumnIndex) {
  const wRange = sTable?.range;
  const wCol = (sTable?.data?.columns || []).find(
    (c) =>
      Number(c?.index) === Number(sColumnIndex) ||
      columnOffset(c, wRange) === Number(sColumnIndex)
  );
  if (wCol) {
    return sheetColFromColumn(wCol, wRange);
  }
  const wLeft = Number(wRange?.left) || 1;
  return wLeft + (Number(sColumnIndex) || 0);
}

/** Human-readable column title for the filter popup. */
export function columnDisplayTitle(sTable, sColumn) {
  const wOff = columnOffset(sColumn, sTable?.range);
  const wHeader = headerLabelFromSheet(sTable?._spInterface, sTable, wOff);
  if (wHeader && !/^Column\d+$/i.test(wHeader)) {
    return wHeader;
  }
  const wName = String(sColumn?.name || "").trim();
  if (wName && !/^Column\d+$/i.test(wName)) {
    return wName;
  }
  const wCol = indexToColLetters(sheetColFromColumn(sColumn, sTable?.range));
  return wCol ? `Colonne ${wCol}` : "Colonne";
}

/** Drop CSS format strings that must never appear in filter value lists. */
export function isFilterableDisplayValue(sValue) {
  const wText = String(sValue ?? "").trim();
  if (!wText) return false;
  if (
    /border-top:|border-left:|background-color:|format-string:|vertical-align:|font-weight:/i.test(
      wText
    )
  ) {
    return false;
  }
  return true;
}

export function normalizeFilterValues(sValues) {
  if (!Array.isArray(sValues)) return [];
  const wOut = [];
  const wSeen = new Set();
  for (const v of sValues) {
    const wText = String(v ?? "").trim();
    if (!isFilterableDisplayValue(wText) || wSeen.has(wText)) continue;
    wSeen.add(wText);
    wOut.push(wText);
  }
  return wOut.sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );
}

/** Restore ListBox selection from an active column filter. */
export function selectedFilterValuesFromColumn(sColumn, sAllValues) {
  const wAll = Array.isArray(sAllValues) ? sAllValues : [];
  if (!sColumn?.filterop || sColumn.filterop === "None") {
    return wAll;
  }
  if (Array.isArray(sColumn.filtervalues) && sColumn.filtervalues.length > 0) {
    return normalizeFilterValues(
      sColumn.filtervalues.map((item) => item?.v)
    );
  }
  const wSingle = sColumn.filtervalue?.v;
  if (wSingle != null && wSingle !== "") {
    return normalizeFilterValues([wSingle]);
  }
  return [];
}

export function findTableHeaderColumn(sTables, sRow, sCol) {
  for (const wTable of sTables) {
    if (sRow !== wTable.headerRow) continue;
    const wOff = sCol - (Number(wTable.range?.left) || 1);
    if (wOff < 0) continue;
    const wTargetCol = (Number(wTable.range?.left) || 1) + wOff;
    const wCol = (wTable.data.columns || []).find(
      (c) => sheetColFromColumn(c, wTable.range) === wTargetCol
    );
    if (wCol) {
      return { table: wTable, column: wCol };
    }
  }
  return null;
}

const FILTER_BTN_MIN = 8;

/** Pixel rect of the filter dropdown button inside a cell rect. */
export function filterButtonRect(sCellRect) {
  if (sCellRect == null) return null;
  const w = Number(sCellRect.Width) || 0;
  const h = Number(sCellRect.Height) || 0;
  if (w < FILTER_BTN_MIN || h < FILTER_BTN_MIN) return null;
  const maxW = Math.max(0, w - FILTER_BTN_PAD * 2);
  const maxH = Math.max(0, h - FILTER_BTN_PAD * 2);
  const btnSize = Math.min(FILTER_BTN, maxW, maxH);
  if (btnSize < FILTER_BTN_MIN) return null;
  const left = sCellRect.Left + w - btnSize - FILTER_BTN_PAD;
  const top = sCellRect.Top + Math.max(FILTER_BTN_PAD, (h - btnSize) / 2);
  return {
    Left: left,
    Top: top,
    Width: btnSize,
    Height: btnSize,
  };
}

export function pointInRect(x, y, rect) {
  if (rect == null) return false;
  return (
    x >= rect.Left &&
    x <= rect.Left + rect.Width &&
    y >= rect.Top &&
    y <= rect.Top + rect.Height
  );
}

/** Data rows ref for JsonFindUniqueValue (skip header). @param {boolean} [onlyDataVisible] when true, C++ skips filter-hidden rows */
export function columnDataRef(sTable, sColumnIndex) {
  const wCol = sheetColForColumnIndex(sTable, sColumnIndex);
  const wTop = sTable.range.top + 1;
  const wBottom = sTable.range.bottom;
  if (wTop > wBottom) return null;
  return `${cellRef(wTop, wCol)}:${cellRef(wBottom, wCol)}`;
}

/** Preserve table metadata when applying RangeData patches (filters, styles, …). */
export function appendTableMetadataToPayload(payload, sTableData, sOptions = {}) {
  if (!sTableData || typeof sTableData !== "object") return;

  const wFirstRow =
    sOptions.firstrow != null ? sOptions.firstrow : sTableData.firstrow;
  if (wFirstRow === false) {
    payload.firstrow = false;
  }

  const wHasTotalsOption =
    sOptions.lastrow != null || sOptions.totalsRowCount != null;
  if (wHasTotalsOption) {
    const wOn =
      sOptions.lastrow != null
        ? !!sOptions.lastrow
        : Number(sOptions.totalsRowCount) > 0;
    if (wOn) {
      payload.lastrow = true;
      payload.totalsRowCount =
        Number(sOptions.totalsRowCount) > 0
          ? Number(sOptions.totalsRowCount)
          : 1;
    } else {
      payload.lastrow = false;
      payload.totalsRowCount = 0;
    }
  } else {
    if (sTableData.lastrow === true) payload.lastrow = true;
    if (Number(sTableData.totalsRowCount) > 0) {
      payload.totalsRowCount = Number(sTableData.totalsRowCount);
    }
  }

  if (sTableData.tableDisplayName) {
    payload.tableDisplayName = sTableData.tableDisplayName;
  }
  const wStyleName =
    sOptions.tableStyleName != null
      ? sOptions.tableStyleName
      : sTableData.tableStyleName;
  if (wStyleName) payload.tableStyleName = String(wStyleName);

  const wPickBool = (sKey) =>
    sOptions[sKey] != null ? sOptions[sKey] : sTableData[sKey];
  const wWriteBool = (sKey, sValue) => {
    if (sOptions.explicitBools || sOptions[sKey] != null) {
      payload[sKey] = !!sValue;
    } else if (sValue) {
      payload[sKey] = true;
    }
  };
  wWriteBool("tableShowRowStripes", wPickBool("tableShowRowStripes"));
  wWriteBool("tableShowColumnStripes", wPickBool("tableShowColumnStripes"));
  wWriteBool("tableShowFirstColumn", wPickBool("tableShowFirstColumn"));
  wWriteBool("tableShowLastColumn", wPickBool("tableShowLastColumn"));

  // Keep AutoFilter on when applying a table style (header filter/sort buttons).
  const wAutoFilter =
    sOptions.tableAutoFilter != null
      ? !!sOptions.tableAutoFilter
      : sTableData.tableAutoFilter != null
        ? !!sTableData.tableAutoFilter
        : sOptions.tableStyleName != null
          ? true
          : null;
  if (wAutoFilter === true) payload.tableAutoFilter = true;
  else if (wAutoFilter === false) payload.tableAutoFilter = false;
  if (
    !sOptions.omitStyleElements &&
    sTableData.tableStyleElements &&
    typeof sTableData.tableStyleElements === "object" &&
    !sOptions.tableStyleName
  ) {
    payload.tableStyleElements = { ...sTableData.tableStyleElements };
  }
}

export function buildRangeDataJson(
  sTableData,
  sColumnIndex,
  sPatch,
  sTableRange = null,
  sTargetSheetCol = null
) {
  const wLeft = Number(sTableRange?.left) || 1;
  const wRight = Number(sTableRange?.right) || wLeft;
  const wWidth = Math.max(1, wRight - wLeft + 1);
  const wColumnsIn = sTableData.columns || [];
  const wTargetSheetCol =
    sTargetSheetCol != null && Number.isFinite(Number(sTargetSheetCol))
      ? Number(sTargetSheetCol)
      : sheetColForColumnIndex(
          { range: sTableRange, data: { columns: wColumnsIn } },
          sColumnIndex
        );
  const wTargetIdx = wTargetSheetCol - wLeft;

  const wBySheetCol = new Map();
  for (const col of wColumnsIn) {
    const wSheetCol = sheetColFromColumn(col, sTableRange);
    if (wSheetCol >= wLeft && wSheetCol <= wRight) {
      wBySheetCol.set(wSheetCol, sanitizeFilterColumn({ ...col, col: wSheetCol }, sTableRange));
    }
  }

  const columns = [];
  for (let wOff = 0; wOff < wWidth; wOff++) {
    const wSheetCol = wLeft + wOff;
    const copy = wBySheetCol.get(wSheetCol) || {
      col: wSheetCol,
      type: "Text",
      filterop: "None",
      filtervalue: { t: "n", v: null },
      order: "None",
    };
    if (wOff === wTargetIdx) {
      if (sPatch.sortOrder != null) copy.order = sPatch.sortOrder;
      if (sPatch.filterop != null) copy.filterop = sPatch.filterop;
      if (sPatch.filterop === "None") {
        copy.filtervalue = sPatch.filtervalue ?? { t: "n", v: null };
        delete copy.filtervalues;
      } else if (sPatch.filtervalues != null) {
        copy.filtervalues = sPatch.filtervalues;
        copy.filterop = sPatch.filterop ?? "Equals";
        copy.filtervalue =
          sPatch.filtervalue ??
          (sPatch.filtervalues[0] || { t: "n", v: null });
      } else if (sPatch.filtervalue != null) {
        copy.filtervalue = sPatch.filtervalue;
        delete copy.filtervalues;
      }
    } else if (sPatch.sortOrder && sPatch.sortOrder !== "None") {
      copy.order = "None";
    }
    columns.push(copy);
  }

  const payload = { columns };
  appendTableMetadataToPayload(payload, sTableData, {});
  return JSON.stringify(payload);
}

/** Prefer header cell text over stale RangeData column names. */
export function headerLabelFromSheet(sSpInterface, sTable, sOffset) {
  if (!sSpInterface?._getCellFromUi || !sTable?.range) {
    return "";
  }
  const wRow = sTable.headerRow ?? sTable.range.top;
  const wCol = (Number(sTable.range.left) || 1) + (Number(sOffset) || 0);
  const wUi = sSpInterface.m_UIView;
  const wCell = sSpInterface._getCellFromUi(wUi, wRow, wCol);
  const wText =
    wCell?.f_value != null ? normalizeTableColumnLabel(String(wCell.f_value)) : "";
  return wText;
}

/** Rebuild column metadata from grid headers + normalized RangeData filters. */
export function enrichTableFromSheetHeaders(sTable, sSpInterface) {
  const wNormalized = normalizeTableColumns(sTable);
  if (!wNormalized?.range || !sSpInterface) {
    return wNormalized;
  }
  const wLeft = Number(wNormalized.range.left) || 1;
  const wRight = Number(wNormalized.range.right) || wLeft;
  const wWidth = Math.max(1, wRight - wLeft + 1);
  const wBySheetCol = new Map();
  for (const wCol of wNormalized.data?.columns || []) {
    wBySheetCol.set(sheetColFromColumn(wCol, wNormalized.range), wCol);
  }
  const wColumns = [];
  for (let wOff = 0; wOff < wWidth; wOff++) {
    const wSheetCol = wLeft + wOff;
    const wExisting = wBySheetCol.get(wSheetCol);
    wColumns.push(
      sanitizeFilterColumn(
        {
          ...(wExisting || {}),
          col: wSheetCol,
        },
        wNormalized.range
      )
    );
  }
  return {
    ...wNormalized,
    _spInterface: sSpInterface,
    data: { ...wNormalized.data, columns: wColumns },
  };
}

export function drawFilterButton(sContext, sCellRect, sActive) {
  const wBtn = filterButtonRect(sCellRect);
  if (wBtn == null) return;
  const cx = wBtn.Left + wBtn.Width / 2;
  const cy = wBtn.Top + wBtn.Height / 2;
  sContext.save();
  sContext.fillStyle = sActive ? "rgba(0, 120, 215, 0.2)" : "rgba(0, 0, 0, 0.06)";
  sContext.fillRect(wBtn.Left, wBtn.Top, wBtn.Width, wBtn.Height);
  sContext.strokeStyle = sActive ? "#0078d7" : "#444";
  sContext.lineWidth = 1;
  const sz = Math.max(2, Math.min(3, wBtn.Width * 0.22));
  sContext.beginPath();
  sContext.moveTo(cx - sz, cy - sz * 0.5);
  sContext.lineTo(cx + sz, cy - sz * 0.5);
  sContext.lineTo(cx, cy + sz);
  sContext.closePath();
  sContext.stroke();
  sContext.restore();
}

export { FILTER_BTN, FILTER_BTN_PAD, FILTER_BTN_MIN };
