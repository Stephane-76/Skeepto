//=============================================================================
// SkSpFloatingObject — layout + synthetic cell helpers for option A overlay
//=============================================================================
import SkCellClass from "./CellClass/SkCellClass.js";

/** Sort floating objects by persisted stack order (zi). */
export function sortFloatingObjectsByZIndex(sObjects) {
  if (!Array.isArray(sObjects)) {
    return [];
  }
  return [...sObjects].sort((a, b) => {
    const wZa = Number(a?.zi) || 0;
    const wZb = Number(b?.zi) || 0;
    if (wZa !== wZb) {
      return wZa - wZb;
    }
    const wNa = typeof a?.n === "string" ? a.n : "";
    const wNb = typeof b?.n === "string" ? b.n : "";
    return wNa.localeCompare(wNb);
  });
}

/** Resolve CSS z-index for a floating object entry. */
export function floatingObjectZIndex(sEntry, sSelected = false) {
  const wBase = Number(sEntry?.zi) > 0 ? Number(sEntry.zi) : 1;
  return sSelected ? wBase + 1000 : wBase;
}

/**
 * Parse wasm JsonFloatingObjectsForSheet payload.
 * @param {string} sJson
 * @returns {object[]}
 */
export function parseFloatingObjectsJson(sJson) {
  let wParsed = sJson;
  if (typeof sJson === "string") {
    if (sJson.length === 0) {
      return [];
    }
    try {
      wParsed = JSON.parse(sJson);
    } catch (_) {
      return [];
    }
  }
  if (wParsed == null || typeof wParsed !== "object") {
    return [];
  }
  if (wParsed.result !== undefined) {
    if (typeof wParsed.result === "string") {
      try {
        wParsed = JSON.parse(wParsed.result);
      } catch (_) {
        return [];
      }
    } else {
      wParsed = wParsed.result;
    }
  }
  return Array.isArray(wParsed?.objects) ? wParsed.objects : [];
}

/**
 * Resolve screen box for a floating object on the active sheet viewport.
 * Scroll-safe: uses sheet scroll offsets when the anchor is outside JsonView.
 * @param {object} sp SkSpInterface
 * @param {object} entry wasm object { ar, ac, dx, dy, w, h, op }
 */
export function resolveFloatingLayout(sp, entry) {
  const wAnchorRow = Number(entry?.ar) || 1;
  const wAnchorCol = Number(entry?.ac) || 1;
  let wLeft = 0;
  let wTop = 0;

  if (sp && typeof sp.getFloatingAnchorScreenOriginSync === "function") {
    const wOrigin = sp.getFloatingAnchorScreenOriginSync(wAnchorRow, wAnchorCol);
    if (wOrigin != null) {
      wLeft = Number(wOrigin.left) || 0;
      wTop = Number(wOrigin.top) || 0;
    }
  }

  wLeft += Number(entry?.dx) || 0;
  wTop += Number(entry?.dy) || 0;

  const wWidth = Number(entry?.w) > 0 ? Number(entry.w) : 100;
  const wHeight = Number(entry?.h) > 0 ? Number(entry.h) : 100;
  const wOpacity = Number(entry?.op);
  return {
    left: wLeft,
    top: wTop,
    width: wWidth,
    height: wHeight,
    opacity: Number.isFinite(wOpacity) && wOpacity > 0 ? wOpacity : 1,
    anchorRow: wAnchorRow,
    anchorCol: wAnchorCol,
  };
}

const FLOATING_STACK_GAP_PX = 2;
/** Excel-imported charts use small diffX/diffY; manual layouts use large pixel offsets. */
const ANCHOR_OFFSET_MAX_PX = 48;
/** Only shrink when import height clearly exceeds anchor row span (not user-resized). */
const ANCHOR_SPAN_OVERSHOOT_PX = 100;

function isNearAnchorCell(entry) {
  const wDx = Math.abs(Number(entry?.dx) || 0);
  const wDy = Math.abs(Number(entry?.dy) || 0);
  return wDx <= ANCHOR_OFFSET_MAX_PX && wDy <= ANCHOR_OFFSET_MAX_PX;
}

function isExcelAnchoredChart(entry) {
  const wClass = typeof entry?.c === "string" ? entry.c : "";
  return wClass === "SkCellClassLineChart" || wClass === "SkCellClassPieChart";
}

/** When false, use persisted w/h only (user moved or resized the overlay). */
function floatingObjectUsesAnchorSpan(entry) {
  if (entry?.autoSpan === false || entry?.as === 0) {
    return false;
  }
  if (Number(entry?.tr ?? entry?.toRow) > 0) {
    return true;
  }
  return isNearAnchorCell(entry) && isExcelAnchoredChart(entry);
}

/** Infer Excel-style to-anchor rows for stacked near-anchor charts on one sheet. */
function inferFloatingToAnchorRows(sObjects, sTargetSheet) {
  const wMap = new Map();
  if (!Array.isArray(sObjects) || sTargetSheet == null || sTargetSheet === "") {
    return wMap;
  }
  const wSorted = sObjects
    .filter(
      (o) =>
        o?.t === sTargetSheet &&
        isNearAnchorCell(o) &&
        isExcelAnchoredChart(o),
    )
    .sort((a, b) => (Number(a?.ar) || 0) - (Number(b?.ar) || 0));
  for (let wIdx = 0; wIdx < wSorted.length; wIdx++) {
    const wEntry = wSorted[wIdx];
    const wName = typeof wEntry?.n === "string" ? wEntry.n : "";
    if (wName === "") {
      continue;
    }
    const wAnchorRow = Number(wEntry.ar) || 1;
    let wToRow = Number(wEntry.tr ?? wEntry.toRow) || 0;
    if (wToRow < wAnchorRow && wIdx + 1 < wSorted.length) {
      wToRow = (Number(wSorted[wIdx + 1].ar) || 0) - 1;
    }
    if (wToRow < wAnchorRow && wIdx > 0) {
      const wPrev = wSorted[wIdx - 1];
      const wPrevName = typeof wPrev?.n === "string" ? wPrev.n : "";
      const wPrevAnchor = Number(wPrev.ar) || 1;
      const wPrevTo = wMap.get(wPrevName) || wPrevAnchor;
      const wSpan = Math.max(1, wPrevTo - wPrevAnchor + 1);
      wToRow = wAnchorRow + wSpan - 1;
    }
    if (wToRow >= wAnchorRow) {
      wMap.set(wName, wToRow);
    }
  }
  return wMap;
}

/**
 * Resolve layout using runtime row heights (Excel anchor span) and stack clamping.
 * @param {object} sp SkSpInterface
 * @param {object} entry wasm object
 * @param {object[]} [allObjects] floating objects on the active sheet
 */
export function resolveFloatingLayoutStacked(sp, entry, allObjects) {
  const wBox = resolveFloatingLayout(sp, entry);
  if (sp == null || entry == null) {
    return wBox;
  }

  // During move/resize, honor patched dx/dy/w/h without Excel anchor span correction.
  if (typeof sp.isFloatingObjectDragging === "function" && sp.isFloatingObjectDragging()) {
    return wBox;
  }
  if (!floatingObjectUsesAnchorSpan(entry)) {
    return wBox;
  }

  const wStoredH = Number(entry?.h) || 0;
  const wStoredW = Number(entry?.w) || 0;
  const wTarget =
    typeof entry.t === "string" && entry.t !== ""
      ? entry.t
      : sp.m_UIView?.sheet || "";
  const wToRowMap = inferFloatingToAnchorRows(allObjects, wTarget);
  const wToRow = wToRowMap.get(entry.n) || Number(entry.tr ?? entry.toRow) || 0;

  let wTargetH = 0;
  if (wToRow >= wBox.anchorRow && typeof sp._sumPixelHeightSync === "function") {
    const wSpanH = sp._sumPixelHeightSync(wBox.anchorRow, wToRow, wTarget);
    if (wSpanH != null && wSpanH > 0) {
      const wToDy = Number(entry.tdy ?? entry.toDy) || 0;
      wTargetH = wSpanH + wToDy;
    }
  }

  const wToCol = Number(entry.tc ?? entry.toCol) || 0;
  let wTargetW = 0;
  if (wToCol >= wBox.anchorCol && typeof sp._sumPixelWidthSync === "function") {
    const wSpanW = sp._sumPixelWidthSync(wBox.anchorCol, wToCol, wTarget);
    if (wSpanW != null && wSpanW > 0) {
      const wToDx = Number(entry.tdx ?? entry.toDx) || 0;
      wTargetW = wSpanW + wToDx;
    }
  }

  if (Array.isArray(allObjects) && allObjects.length > 1 && isExcelAnchoredChart(entry)) {
    const wMyRow = Number(entry.ar) || 0;
    let wNextEntry = null;
    let wNextRow = Infinity;
    for (const o of allObjects) {
      if (o === entry || o?.t !== wTarget || !isNearAnchorCell(o) || !isExcelAnchoredChart(o)) {
        continue;
      }
      const oRow = Number(o.ar) || 0;
      if (oRow > wMyRow && oRow < wNextRow) {
        wNextRow = oRow;
        wNextEntry = o;
      }
    }
    if (wNextEntry != null && typeof sp.getFloatingAnchorScreenOriginSync === "function") {
      const wNextOrigin = sp.getFloatingAnchorScreenOriginSync(
        Number(wNextEntry.ar) || 1,
        Number(wNextEntry.ac) || 1,
      );
      if (wNextOrigin != null) {
        const wNextTop =
          (Number(wNextOrigin.top) || 0) + (Number(wNextEntry.dy) || 0);
        const wMaxH = wNextTop - wBox.top - FLOATING_STACK_GAP_PX;
        if (wMaxH >= MIN_FLOATING_SIZE_PX) {
          wTargetH = wTargetH > 0 ? Math.min(wTargetH, wMaxH) : wMaxH;
        }
      }
    }
  }

  // Only shrink oversized Excel imports; respect user-resized dimensions.
  if (
    wTargetH > 0 &&
    wStoredH > wTargetH + ANCHOR_SPAN_OVERSHOOT_PX
  ) {
    wBox.height = clampFloatingSize(wTargetH);
  }
  if (
    wTargetW > 0 &&
    wStoredW > wTargetW + ANCHOR_SPAN_OVERSHOOT_PX
  ) {
    wBox.width = clampFloatingSize(wTargetW);
  }

  return wBox;
}

/**
 * Anchor top-left in sheet pixel space (WASM SumPixel* — no SkSpInterface required).
 */
export function anchorSheetPxWasm(sRow, sCol, sSheet = "") {
  const wWasm = window.SkUISpreadSheet?.m_UISpreadSheet;
  if (wWasm == null) {
    return { x: 0, y: 0 };
  }
  const wRow = Number(sRow) || 1;
  const wCol = Number(sCol) || 1;
  let wAnchorX = 0;
  let wAnchorY = 0;
  if (wCol > 1 && typeof wWasm.SumPixelWidth === "function") {
    wAnchorX = Number(wWasm.SumPixelWidth(1, wCol - 1, sSheet)) || 0;
  }
  if (wRow > 1 && typeof wWasm.SumPixelHeight === "function") {
    wAnchorY = Number(wWasm.SumPixelHeight(1, wRow - 1, sSheet)) || 0;
  }
  return { x: wAnchorX, y: wAnchorY };
}

/**
 * Sheet-absolute pixel box for an anchor cell (no viewport / scroll).
 * @param {object} sp SkSpInterface
 * @param {number} sRow
 * @param {number} sCol
 * @param {string} [sSheet]
 */
export function anchorSheetPx(sp, sRow, sCol, sSheet = "") {
  const wRow = Number(sRow) || 1;
  const wCol = Number(sCol) || 1;
  const wSheet = sSheet || sp?.m_UIView?.sheet || "";
  if (sp != null && typeof sp._anchorSheetPxSync === "function") {
    const wAnchor = sp._anchorSheetPxSync(wRow, wCol, wSheet);
    if (wAnchor != null) {
      return { x: wAnchor.anchorX, y: wAnchor.anchorY };
    }
  }
  return anchorSheetPxWasm(wRow, wCol, wSheet);
}

/**
 * Floating object layout in sheet pixels (for PDF / offline canvas export).
 */
export function resolveFloatingLayoutSheetPx(sp, entry, sheet = "") {
  const wAnchorRow = Number(entry?.ar) || 1;
  const wAnchorCol = Number(entry?.ac) || 1;
  const wTargetSheet =
    sheet ||
    (typeof entry?.t === "string" && entry.t !== "" ? entry.t : "") ||
    sp?.m_UIView?.sheet ||
    "";
  const wOrigin = anchorSheetPx(sp, wAnchorRow, wAnchorCol, wTargetSheet);
  const wLeft = wOrigin.x + (Number(entry?.dx) || 0);
  const wTop = wOrigin.y + (Number(entry?.dy) || 0);
  const wWidth = Number(entry?.w) > 0 ? Number(entry.w) : 100;
  const wHeight = Number(entry?.h) > 0 ? Number(entry.h) : 100;
  const wOpacity = Number(entry?.op);
  return {
    left: wLeft,
    top: wTop,
    width: wWidth,
    height: wHeight,
    opacity: Number.isFinite(wOpacity) && wOpacity > 0 ? wOpacity : 1,
    anchorRow: wAnchorRow,
    anchorCol: wAnchorCol,
  };
}

/** Anchor top-left in sheet pixel space. */
function anchorOriginSheetPx(uiView, sp, entry, diffX, diffY, sheet) {
  const wRow = Number(entry?.ar) || 1;
  const wCol = Number(entry?.ac) || 1;
  for (const wRowObj of uiView?.rows || []) {
    const wCells = Array.isArray(wRowObj?.cells) ? wRowObj.cells : [];
    for (const wCell of wCells) {
      if (Number(wCell.c_r) === wRow && Number(wCell.c_c) === wCol) {
        return {
          x: (Number(wCell.c_x) || 0) + diffX,
          y: (Number(wCell.c_y) || 0) + diffY,
        };
      }
    }
  }
  const wSheet = anchorSheetPx(sp, wRow, wCol, sheet);
  return { x: wSheet.x, y: wSheet.y };
}

/**
 * Floating layout for PDF tiles — sheet pixels; subtract tile diffX/diffY when painting.
 */
export function resolveFloatingLayoutForExport(sp, uiView, entry, allObjects, diffX, diffY, sheet = "") {
  const wStacked = resolveFloatingLayoutStacked(sp, entry, allObjects);
  const wOrigin = anchorOriginSheetPx(uiView, sp, entry, diffX, diffY, sheet);
  return {
    ...wStacked,
    left: wOrigin.x + (Number(entry?.dx) || 0),
    top: wOrigin.y + (Number(entry?.dy) || 0),
  };
}

/**
 * Async layout for hosts where SumPixel* is only available through call_Result.
 * @param {object} sp SkSpInterface
 * @param {object} entry wasm object { ar, ac, dx, dy, w, h, op }
 */
export async function resolveFloatingLayoutAsync(sp, entry) {
  const wAnchorRow = Number(entry?.ar) || 1;
  const wAnchorCol = Number(entry?.ac) || 1;
  let wLeft = 0;
  let wTop = 0;

  if (sp && typeof sp.getFloatingAnchorScreenOrigin === "function") {
    const wOrigin = await sp.getFloatingAnchorScreenOrigin(wAnchorRow, wAnchorCol);
    if (wOrigin != null) {
      wLeft = Number(wOrigin.left) || 0;
      wTop = Number(wOrigin.top) || 0;
    }
  } else {
    const wSync = resolveFloatingLayout(sp, entry);
    wLeft = wSync.left - (Number(entry?.dx) || 0);
    wTop = wSync.top - (Number(entry?.dy) || 0);
  }

  wLeft += Number(entry?.dx) || 0;
  wTop += Number(entry?.dy) || 0;

  const wWidth = Number(entry?.w) > 0 ? Number(entry.w) : 100;
  const wHeight = Number(entry?.h) > 0 ? Number(entry.h) : 100;
  const wOpacity = Number(entry?.op);
  return {
    left: wLeft,
    top: wTop,
    width: wWidth,
    height: wHeight,
    opacity: Number.isFinite(wOpacity) && wOpacity > 0 ? wOpacity : 1,
    anchorRow: wAnchorRow,
    anchorCol: wAnchorCol,
  };
}

/**
 * Build a JsonView-shaped cell for GetRender(className).
 * @param {string} sName floating object name
 * @param {object|null} sHostJson { c_t, c_v } from wasm host payload
 * @param {object} sBox from resolveFloatingLayout
 * @param {object} [sEntry] full floating object entry (target sheet, host ref)
 * @param {object} [sSp] SkSpInterface for target-sheet fallback
 */
export function buildFloatingSyntheticCell(sName, sHostJson, sBox, sEntry = null, sSp = null) {
  const wCell = {
    c_k: `float:${sName}`,
    c_r: sBox.anchorRow,
    c_c: sBox.anchorCol,
    c_x: sBox.left,
    c_y: sBox.top,
    c_w: sBox.width,
    c_h: sBox.height,
    c_fo: true,
  };
  if (sHostJson && typeof sHostJson === "object") {
    if (Object.prototype.hasOwnProperty.call(sHostJson, "c_t")) {
      wCell.c_t = sHostJson.c_t;
    }
    if (Object.prototype.hasOwnProperty.call(sHostJson, "c_v")) {
      wCell.c_v = sHostJson.c_v;
    }
  }
  // Reload path: registry + layout can load without wasm "host" payload — still render from class id.
  if (wCell.c_t !== "c" || wCell.c_v == null) {
    const wClassName = floatingObjectClassName({ ...sEntry, host: sHostJson });
    if (wClassName) {
      wCell.c_t = "c";
      const wAttrs = sHostJson?.c_v?.c?.a;
      wCell.c_v = {
        n: wClassName,
        c: {
          n: (typeof sName === "string" && sName.length > 0) ? sName : wClassName,
          a: Array.isArray(wAttrs) ? wAttrs : [],
        },
      };
    }
  }
  if (sEntry != null && typeof sEntry === "object") {
    const wTargetSheet =
      (typeof sEntry.t === "string" && sEntry.t.trim()) ||
      (sSp?.m_UIView?.sheet || "");
    const wHostSheet =
      (typeof sEntry.hs === "string" && sEntry.hs.trim()) || "_$$A";
    const wHostRef = SkCellClass.buildHostCellRef(
      wHostSheet,
      sEntry.hr,
      sEntry.hc
    );
    wCell.c_foMeta = {
      targetSheet: wTargetSheet,
      hostSheet: wHostSheet,
      hostRef: wHostRef,
      dataTick: Number(sEntry.dataTick) || 0,
    };
  }
  return wCell;
}

/**
 * Resolve React class name: registry class id or host c_v.n fallback.
 */
export function floatingObjectClassName(sEntry) {
  if (sEntry?.c && typeof sEntry.c === "string" && sEntry.c.length > 0) {
    return sEntry.c;
  }
  const wHostName = sEntry?.host?.c_v?.n;
  return typeof wHostName === "string" ? wHostName : "";
}

/** Label stem for a unique floating object name (SkCellClassPieChart → PieChart). */
export function floatingObjectNameStem(sClassName) {
  const wPrefix = "SkCellClass";
  if (typeof sClassName === "string" && sClassName.startsWith(wPrefix)) {
    return sClassName.slice(wPrefix.length);
  }
  return sClassName || "Float";
}

/**
 * Pick a unused floating object name on the target sheet.
 * @param {string} sClassName
 * @param {string} sTargetSheetName
 * @param {object[]} sExistingObjects from parseFloatingObjectsJson
 */
export function suggestFloatingObjectName(sClassName, sExistingObjects) {
  const wStem = floatingObjectNameStem(sClassName);
  const wUsed = new Set(
    (Array.isArray(sExistingObjects) ? sExistingObjects : [])
      .map((o) => o?.n)
      .filter((n) => typeof n === "string" && n.length > 0),
  );
  if (!wUsed.has(wStem)) {
    return wStem;
  }
  let wIndex = 2;
  while (wUsed.has(`${wStem}${wIndex}`)) {
    wIndex += 1;
  }
  return `${wStem}${wIndex}`;
}

/** Build Sheet!A1 anchor ref for UndoFloatingObjectLayout. */
export function buildFloatingAnchorCellRef(sSheetName, sCellRef) {
  const wCell = typeof sCellRef === "string" ? sCellRef.trim() : "";
  const wSheet = typeof sSheetName === "string" ? sSheetName.trim() : "";
  if (!wCell) {
    return "";
  }
  if (wCell.includes("!")) {
    return wCell;
  }
  return wSheet ? `${wSheet}!${wCell}` : wCell;
}

/** Default layout when applying a class as a floating object from the palette. */
export const DEFAULT_FLOATING_LAYOUT = Object.freeze({
  diffX: 8,
  diffY: 8,
  width: 420,
  height: 280,
  opacity: 1,
});

/** Find one floating object entry by registry name. */
export function findFloatingObjectEntry(sObjects, sName) {
  if (!Array.isArray(sObjects) || sName == null || sName === "") {
    return null;
  }
  return sObjects.find((o) => o?.n === sName) ?? null;
}

/** True when entry is a floating object with a React cell class (attrs may still be empty). */
export function hasFloatingObjectAttributes(sEntry) {
  if (sEntry == null || typeof sEntry !== "object") {
    return false;
  }
  const wClassName =
    (typeof sEntry.c === "string" && sEntry.c) ||
    (typeof sEntry.host?.c_v?.n === "string" && sEntry.host.c_v.n) ||
    "";
  if (!wClassName.startsWith("SkCellClass")) {
    return false;
  }
  const wHost = sEntry.host?.c_v;
  if (wHost == null) {
    return true;
  }
  return (
    wHost.co === true &&
    typeof wHost.n === "string" &&
    wHost.n.length > 0 &&
    wHost.c != null
  );
}

/** Display anchor as A1-style label (no sheet prefix). */
export function floatingAnchorCellLabel(sEntry) {
  const wRow = Number(sEntry?.ar) || 1;
  const wCol = Number(sEntry?.ac) || 1;
  const wUi = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
  const wColLabel =
    wUi != null && typeof wUi.base10toAlphaSync === "function"
      ? wUi.base10toAlphaSync(wCol)
      : String(wCol);
  return `${wColLabel}${wRow}`;
}

/** Build Sheet!A1 anchor ref for layout API. */
export function buildFloatingLayoutAnchorRef(sSheetName, sCellRef) {
  return buildFloatingAnchorCellRef(sSheetName, sCellRef);
}

const MIN_FLOATING_SIZE_PX = 40;

/** Clamp floating object width/height during resize. */
export function clampFloatingSize(sValue) {
  const wNum = Number(sValue);
  if (!Number.isFinite(wNum)) {
    return MIN_FLOATING_SIZE_PX;
  }
  return Math.max(MIN_FLOATING_SIZE_PX, Math.round(wNum));
}
