//=============================================================================
// Create a RangeData table from the current spreadsheet selection.
//=============================================================================

import { parseA1Range } from "./SkA1Ref.js";

const DEFAULT_TABLE_STYLE = "TableStyleMedium2";

/** Collect existing named-range and table names (workbook-wide). */
function collectNamesFromJsonApi(sApiName) {
  if (!window.SkUISpreadSheet?.[sApiName]) return [];
  try {
    let wParsed = window.SkUISpreadSheet[sApiName]();
    if (typeof wParsed === "string") {
      wParsed = JSON.parse(wParsed || "{}");
    }
    if (wParsed?.result !== undefined) {
      wParsed =
        typeof wParsed.result === "string"
          ? JSON.parse(wParsed.result || "{}")
          : wParsed.result;
    }
    const wList = Array.isArray(wParsed?.namedranges) ? wParsed.namedranges : [];
    return wList.map((r) => String(r?.n || "")).filter(Boolean);
  } catch (_) {
    return [];
  }
}

/** Collect existing named-range + table names (workbook-wide). */
export function listNamedRangeNames() {
  // jsonRangeNamed skips IsData() tables; jsonRangeData lists them.
  const wNames = new Set([
    ...collectNamesFromJsonApi("jsonRangeNamed"),
    ...collectNamesFromJsonApi("jsonRangeData"),
  ]);
  return [...wNames];
}

/** Next free Excel-like name: Table1, Table2, … */
export function nextTableName(sExistingNames = null) {
  const wNames = new Set(
    (sExistingNames ?? listNamedRangeNames()).map((n) => n.toLowerCase())
  );
  let wIndex = 1;
  while (wNames.has(`table${wIndex}`)) {
    wIndex += 1;
  }
  return `Table${wIndex}`;
}

/**
 * Resolve a single rectangular selection (last area, else cursor cell).
 * @returns {{ ref: string, top: number, left: number, bottom: number, right: number } | null}
 */
export function selectionRect(sSpInterface) {
  if (!sSpInterface?.m_Select) return null;
  const wSelect = sSpInterface.m_Select;
  let wRef = null;
  const wLast = wSelect.last?.();
  if (wLast != null && typeof wSelect.strRange === "function") {
    wRef = wSelect.strRange(wLast);
  } else if (typeof wSelect.cursorStr === "function") {
    const wCursor = wSelect.cursorStr();
    wRef = `${wCursor}:${wCursor}`;
  }
  if (!wRef) return null;
  // Multi-area refs are not supported for table creation.
  if (String(wRef).includes(";")) {
    const wFirst = String(wRef).split(";")[0];
    wRef = wFirst;
  }
  const wBounds = parseA1Range(wRef);
  if (!wBounds) return null;
  return {
    ref: wRef,
    top: wBounds.top,
    left: wBounds.left,
    bottom: wBounds.bottom,
    right: wBounds.right,
  };
}

/** RangeData JSON with columns + default Excel table style (headers synced by engine). */
export function buildCreateTableJson(sLeft, sRight) {
  const wLeft = Number(sLeft) || 1;
  const wRight = Math.max(wLeft, Number(sRight) || wLeft);
  const wColumns = [];
  for (let wCol = wLeft; wCol <= wRight; wCol += 1) {
    wColumns.push({
      col: wCol,
      type: "Text",
      filterop: "None",
      filtervalue: { t: "n", v: null },
      order: "None",
    });
  }
  return JSON.stringify({
    columns: wColumns,
    tableStyleName: DEFAULT_TABLE_STYLE,
    tableShowRowStripes: true,
    tableAutoFilter: true,
  });
}

/**
 * Create a table on the current selection.
 * @returns {Promise<{ ok: boolean, name?: string, ref?: string, error?: string }>}
 */
export async function createTableFromSelection(sSpInterface) {
  if (!window.SkUISpreadSheet?.undoAddRangeData) {
    return { ok: false, error: "Spreadsheet engine not ready." };
  }
  const wRect = selectionRect(sSpInterface);
  if (!wRect) {
    return { ok: false, error: "No selection." };
  }
  const wHeight = wRect.bottom - wRect.top + 1;
  if (wHeight < 2) {
    return {
      ok: false,
      error: "Select at least two rows (header + data).",
    };
  }

  const wSheet =
    sSpInterface?.m_UIView?.sheet ||
    window.SkUISpreadSheet.getActiveSheet?.() ||
    "";
  const wName = nextTableName();
  const wJson = buildCreateTableJson(wRect.left, wRect.right);

  if (typeof sSpInterface?.setExtraUndo === "function") {
    await sSpInterface.setExtraUndo();
  }

  const wOk = window.SkUISpreadSheet.undoAddRangeData(
    wName,
    wRect.ref,
    wJson,
    wSheet
  );
  if (!wOk) {
    return { ok: false, error: `Failed to create table "${wName}".` };
  }

  if (typeof sSpInterface?.reloadViewAfterSpreadsheetMutation === "function") {
    await sSpInterface.reloadViewAfterSpreadsheetMutation();
  } else if (typeof sSpInterface?.reloadView === "function") {
    await sSpInterface.reloadView();
  }

  return { ok: true, name: wName, ref: wRect.ref };
}
