//=============================================================================
// Paint in-cell widgets + floating objects on an export canvas after paintCellStack.
// Grid canvas order: backgrounds → text → borders; then overlays like SkSpGridPanel;
// pass 4c redraws borders on widget cells (opaque widget fill covers pass C).
//=============================================================================

import { GetPdfExportClass } from "../CellClass/SkCellClass.js";
import SkSpCellCanvas from "../SkSpCellCanvas.js";
import {
  buildFloatingSyntheticCell,
  floatingObjectClassName,
  parseFloatingObjectsJson,
  resolveFloatingLayoutForExport,
  sortFloatingObjectsByZIndex,
} from "../SkSpFloatingObject.js";
import { getCachedFloatingObjectsForSheet } from "../SkFloatingObjectsExportCache.js";

function isClassWidgetCell(cell) {
  if (!cell || cell.c_t !== "c") return false;
  if (Object.prototype.hasOwnProperty.call(cell, "c__l")) return false;
  if (Object.prototype.hasOwnProperty.call(cell, "c__r")) return false;
  const cv = cell.c_v;
  return cv != null && typeof cv === "object" && Object.prototype.hasOwnProperty.call(cv, "co");
}

function cellCacheKey(cell) {
  return String(cell.c_k ?? `${cell.c_r}:${cell.c_c}`);
}

function exportClassForCell(cell) {
  const name = cell?.c_v?.n;
  if (!name) return null;
  return GetPdfExportClass(name) ?? null;
}

function collectClassWidgetCells(rows) {
  const out = [];
  for (const wRow of rows) {
    const cells = Array.isArray(wRow?.cells) ? wRow.cells : [];
    for (const cell of cells) {
      if (!isClassWidgetCell(cell)) continue;
      if (!exportClassForCell(cell)) continue;
      out.push(cell);
    }
  }
  return out;
}

/**
 * Whether JsonView rows contain in-cell class widgets (sparkline, checkbox, …).
 */
export function jsonViewHasClassWidgets(uiView) {
  const rows = Array.isArray(uiView?.rows) ? uiView.rows : [];
  return collectClassWidgetCells(rows).length > 0;
}

/**
 * Whether class-ink pass is needed (in-cell widgets and/or floating objects).
 * Prefer resolveRangeExportInkPlan for range snapshots (intersection probe first).
 */
export function jsonViewNeedsClassInk(uiView, inkOptions = {}) {
  if (jsonViewHasClassWidgets(uiView)) {
    return true;
  }
  if (inkOptions.needsClassInk === false) {
    return false;
  }
  return inkOptions.skipFloatingObjects !== true;
}

/** Floating entries with export painter that intersect the export tile. */
export function filterFloatingObjectsIntersectingTile(list, spInterface, uiView, tile) {
  const wDiffX = Number(tile.diffX) || 0;
  const wDiffY = Number(tile.diffY) || 0;
  const wViewW = Number(tile.viewW) > 0 ? Number(tile.viewW) : Infinity;
  const wViewH = Number(tile.viewH) > 0 ? Number(tile.viewH) : Infinity;
  const wSheet = uiView?.sheet || spInterface?.m_UIView?.sheet || "";
  const wSorted = sortFloatingObjectsByZIndex(Array.isArray(list) ? list : []);
  const wOut = [];
  for (const wEntry of wSorted) {
    if (exportClassForFloatingEntry(wEntry) == null) {
      continue;
    }
    const wBox = resolveFloatingLayoutForExport(
      spInterface,
      uiView,
      wEntry,
      wSorted,
      wDiffX,
      wDiffY,
      wSheet,
    );
    if (wBox.width <= 0 || wBox.height <= 0) {
      continue;
    }
    if (boxIntersectsTile(wBox, wDiffX, wDiffY, wViewW, wViewH)) {
      wOut.push(wEntry);
    }
  }
  return wOut;
}

/**
 * Probe floating objects once; only enable heavy hydrate when something intersects the range.
 * @param {object} uiView
 * @param {object | null} spInterface
 * @param {{ diffX?: number, diffY?: number, viewW?: number, viewH?: number }} tile
 * @param {{ forceIncludeFloatingObjects?: boolean }} [options]
 * @returns {Promise<{ needsClassInk: boolean, skipFloatingObjects: boolean, prefetchedFloatingObjects: object[] }>}
 */
export async function resolveRangeExportInkPlan(uiView, spInterface, tile) {
  const wHasWidgets = jsonViewHasClassWidgets(uiView);
  const wSheet = uiView?.sheet || spInterface?.m_UIView?.sheet || "";
  const wList = await getCachedFloatingObjectsForSheet(wSheet);
  const wIntersecting =
    wList.length > 0
      ? filterFloatingObjectsIntersectingTile(wList, spInterface, uiView, tile)
      : [];
  return {
    needsClassInk: wHasWidgets || wIntersecting.length > 0,
    skipFloatingObjects: wIntersecting.length === 0,
    prefetchedFloatingObjects: wList,
  };
}

function boxIntersectsTile(box, diffX, diffY, viewW, viewH) {
  const wX0 = diffX;
  const wY0 = diffY;
  const wX1 = diffX + viewW;
  const wY1 = diffY + viewH;
  return (
    box.left < wX1 &&
    box.left + box.width > wX0 &&
    box.top < wY1 &&
    box.top + box.height > wY0
  );
}

async function floatingObjectsForSheet(spInterface, sheet, prefetched) {
  if (!sheet) {
    return [];
  }
  if (Array.isArray(prefetched)) {
    return prefetched.filter((o) => !o?.t || o.t === sheet);
  }
  if (spInterface != null) {
    if (typeof spInterface.loadFloatingObjectsForActiveSheet === "function") {
      await spInterface.loadFloatingObjectsForActiveSheet();
    } else if (window.SkUISpreadSheet?.jsonFloatingObjectsForSheet) {
      const wJson = window.SkUISpreadSheet.jsonFloatingObjectsForSheet(sheet, sheet);
      spInterface.m_FloatingObjects = parseFloatingObjectsJson(wJson);
    }
    const wList = Array.isArray(spInterface.m_FloatingObjects)
      ? spInterface.m_FloatingObjects
      : [];
    return wList.filter((o) => !o?.t || o.t === sheet);
  }
  if (window.SkUISpreadSheet?.jsonFloatingObjectsForSheet) {
    const wJson = window.SkUISpreadSheet.jsonFloatingObjectsForSheet(sheet, sheet);
    const wList = parseFloatingObjectsJson(wJson);
    return wList.filter((o) => !o?.t || o.t === sheet);
  }
  return [];
}

function exportClassForFloatingEntry(entry) {
  return GetPdfExportClass(floatingObjectClassName(entry)) ?? null;
}

function cellHasBorderFormat(cell) {
  if (!cell || typeof cell !== "object") return false;
  return (
    Object.prototype.hasOwnProperty.call(cell, "f_bo") ||
    Object.prototype.hasOwnProperty.call(cell, "f_bol") ||
    Object.prototype.hasOwnProperty.call(cell, "f_bot") ||
    Object.prototype.hasOwnProperty.call(cell, "f_bor") ||
    Object.prototype.hasOwnProperty.call(cell, "f_bob")
  );
}

/** Widget opaque backgrounds in pass 4a cover pass C borders — redraw on top (live grid keeps borders on canvas below React overlay). */
function paintClassWidgetBorders(ctx, cells) {
  const bordered = cells.filter(cellHasBorderFormat);
  if (bordered.length === 0) {
    return;
  }
  const cellCanvas = new SkSpCellCanvas();
  cellCanvas.DrawBordersCoalesced(ctx, bordered);
}

async function ensurePaintState(cache, cell, klass, spInterface, uiView) {
  const key = cellCacheKey(cell);
  if (!cache.has(key) && klass?.loadPaintStateFromCell) {
    const state = await klass.loadPaintStateFromCell(cell, spInterface);
    if (state && typeof klass.resolveHostBackgroundColor === "function") {
      state.hostBackground = klass.resolveHostBackgroundColor(cell, spInterface, uiView);
    }
    cache.set(key, state);
  }
  return cache.get(key);
}

/**
 * Cell-class + floating-object overlay pass — after paintCellStack borders.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} uiView
 * @param {object} spInterface
 * @param {{ diffX?: number, diffY?: number, viewW?: number, viewH?: number }} [tile]
 */
export async function paintCellClassInk(ctx, uiView, spInterface, tile = {}) {
  const wDiffX = Number(tile.diffX) || 0;
  const wDiffY = Number(tile.diffY) || 0;
  const wViewW = Number(tile.viewW) > 0 ? Number(tile.viewW) : Infinity;
  const wViewH = Number(tile.viewH) > 0 ? Number(tile.viewH) : Infinity;
  const wSheet = uiView?.sheet || spInterface?.m_UIView?.sheet || "";

  const rows = Array.isArray(uiView?.rows) ? uiView.rows : [];
  const cells = collectClassWidgetCells(rows);
  const wSkipFloating = tile.skipFloatingObjects === true;
  /** @type {Map<string, unknown>} */
  const paintStateCache = new Map();

  for (const cell of cells) {
    const klass = exportClassForCell(cell);
    await ensurePaintState(paintStateCache, cell, klass, spInterface, uiView);
  }

  // 4a — in-cell widget backgrounds
  for (const cell of cells) {
    const klass = exportClassForCell(cell);
    const state = paintStateCache.get(cellCacheKey(cell));
    if (state && klass?.paintBackgroundAtJsonViewCell) {
      klass.paintBackgroundAtJsonViewCell(ctx, cell, state);
    }
  }

  // 4b — in-cell widget ink
  for (const cell of cells) {
    const klass = exportClassForCell(cell);
    const state = paintStateCache.get(cellCacheKey(cell));
    if (state && klass?.paintInkAtJsonViewCell) {
      klass.paintInkAtJsonViewCell(ctx, cell, state);
    }
  }

  // 5 — floating objects (SkSpFloatingLayer equivalent: images, anchored charts, …)
  /** @type {Array<{ cell: object, klass: object, box: object }>} */
  const wFloatPaint = [];

  if (!wSkipFloating) {
  const wFloating = sortFloatingObjectsByZIndex(
    await floatingObjectsForSheet(spInterface, wSheet, tile.prefetchedFloatingObjects),
  );

  for (const wEntry of wFloating) {
    const wKlass = exportClassForFloatingEntry(wEntry);
    if (wKlass == null) {
      continue;
    }
    const wBox = resolveFloatingLayoutForExport(
      spInterface,
      uiView,
      wEntry,
      wFloating,
      wDiffX,
      wDiffY,
      wSheet,
    );
    if (wBox.width <= 0 || wBox.height <= 0) {
      continue;
    }
    if (!boxIntersectsTile(wBox, wDiffX, wDiffY, wViewW, wViewH)) {
      continue;
    }
    const wCell = buildFloatingSyntheticCell(
      wEntry.n,
      wEntry.host,
      wBox,
      wEntry,
      spInterface,
    );
    wCell.c_x = wBox.left - wDiffX;
    wCell.c_y = wBox.top - wDiffY;
    wCell.c_w = wBox.width;
    wCell.c_h = wBox.height;
    wFloatPaint.push({ cell: wCell, klass: wKlass, box: wBox });
    await ensurePaintState(paintStateCache, wCell, wKlass, spInterface, uiView);
  }
  }

  for (const { cell, klass } of wFloatPaint) {
    const state = paintStateCache.get(cellCacheKey(cell));
    if (state && klass?.paintBackgroundAtJsonViewCell) {
      klass.paintBackgroundAtJsonViewCell(ctx, cell, state);
    }
  }

  for (const { cell, klass } of wFloatPaint) {
    const state = paintStateCache.get(cellCacheKey(cell));
    if (state && klass?.paintInkAtJsonViewCell) {
      klass.paintInkAtJsonViewCell(ctx, cell, state);
    }
  }

  paintClassWidgetBorders(ctx, [
    ...cells,
    ...wFloatPaint.map(({ cell }) => cell),
  ]);
}
