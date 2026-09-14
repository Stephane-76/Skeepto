//=============================================================================
// Client-side WYSIWYG PDF export — same JsonView + paint path as SkSpGridCanvas scroll.
//=============================================================================

import { PDFDocument } from "pdf-lib";

import { hydrateJsonViewCellFormats } from "../SkJsonViewFormatHydrate.js";
import {
  DEFAULT_EXPORT_DPR,
  canvasToPngBytes,
  computeFitPaintScale,
  renderViewToCanvas,
  sheetScrollOriginPx,
  sheetViewportForPrintScale,
} from "./SkJsonViewRasterExport.js";
import {
  parseFloatingObjectsJson,
  resolveFloatingLayoutSheetPx,
} from "../SkSpFloatingObject.js";
import {
  JSON_VIEW_BOUNDS_SLACK_CSS_PX,
  computeJsonViewPixelBounds,
  computePdfFitPixelBounds,
  computeSubstantivePdfPixelBounds,
  jsonViewHasSubstantiveBodyInk,
  PDF_EXTENT_PROBE_VIEWPORT_W_INK_NARROW_PX,
  PDF_EXTENT_WIDE_INK_OVER_NARROW_MIN_GAP,
  shouldSkipPhantomHorizontalTile,
} from "./SkJsonViewPdfBounds.js";
import {
  cssPxToPdfPt,
  drawablePageCssPxFromPrintParameters,
  mmToPdfPt,
  printScaleFactor,
} from "./SkPrintLayout.js";

/** Same as SkSpInterface JSON_VIEW_SPILL_PAD_PX — JsonView viewport pad over drawable page. */
const JSON_VIEW_SPILL_PAD_PX = 40;
const JSON_VIEW_EXTENT_CAP_PX = 12000;

function unwrapWasmJson(raw) {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Mirrors SkSpInterface._jsonViewExtentPx — screen band + spill, not full sheet. */
function jsonViewExtentPx(clientW, clientH) {
  return {
    jsonW: Math.min(
      Math.max(1, Number(clientW) || 1) + JSON_VIEW_SPILL_PAD_PX,
      JSON_VIEW_EXTENT_CAP_PX,
    ),
    jsonH: Math.min(
      Math.max(1, Number(clientH) || 1) + JSON_VIEW_SPILL_PAD_PX,
      JSON_VIEW_EXTENT_CAP_PX,
    ),
  };
}

/**
 * JsonView load — same call shape as SkSpInterface._loadJsonViewSingle.
 * @param {boolean} [withSpillPad] — UI uses spill over drawable page (same as SkSpGridCanvas).
 */
async function fetchJsonViewLikeGrid(
  sheet,
  topRow,
  leftCol,
  clientW,
  clientH,
  diffY,
  diffX,
  withSpillPad = true,
) {
  if (window.SkUISpreadSheet == null) {
    throw new Error("Spreadsheet engine not ready");
  }
  let jsonW = Math.max(1, Number(clientW) || 1);
  let jsonH = Math.max(1, Number(clientH) || 1);
  if (withSpillPad) {
    const ext = jsonViewExtentPx(clientW, clientH);
    jsonW = ext.jsonW;
    jsonH = ext.jsonH;
  } else {
    jsonW = Math.min(jsonW, JSON_VIEW_EXTENT_CAP_PX);
    jsonH = Math.min(jsonH, JSON_VIEW_EXTENT_CAP_PX);
  }
  const raw = window.SkUISpreadSheet.jsonView(
    topRow,
    leftCol,
    jsonH,
    jsonW,
    diffY,
    diffX,
    sheet,
  );
  const parsed = unwrapWasmJson(raw);
  if (parsed == null || typeof parsed !== "object") {
    throw new Error("JsonView returned empty payload");
  }
  return parsed;
}

function mergeRangeKey(m) {
  return `${m.r_t}:${m.r_l}:${m.r_b}:${m.r_r}`;
}

function saveSpInterfaceViewState(spInterface) {
  return {
    m_UIView: spInterface.m_UIView,
    m_UIViewFrozen: spInterface.m_UIViewFrozen,
    m_UIViewFrozenCorner: spInterface.m_UIViewFrozenCorner,
    m_UIViewFrozenLeft: spInterface.m_UIViewFrozenLeft,
    m_DiffX: spInterface.m_DiffX,
    m_DiffY: spInterface.m_DiffY,
    m_ClientWidth: spInterface.m_ClientWidth,
    m_ClientHeight: spInterface.m_ClientHeight,
    m_FrozenPixH: spInterface.m_FrozenPixH,
    m_FrozenPixW: spInterface.m_FrozenPixW,
  };
}

function restoreSpInterfaceViewState(spInterface, saved) {
  if (saved == null || spInterface == null) return;
  spInterface.m_UIView = saved.m_UIView;
  spInterface.m_UIViewFrozen = saved.m_UIViewFrozen;
  spInterface.m_UIViewFrozenCorner = saved.m_UIViewFrozenCorner;
  spInterface.m_UIViewFrozenLeft = saved.m_UIViewFrozenLeft;
  spInterface.m_DiffX = saved.m_DiffX;
  spInterface.m_DiffY = saved.m_DiffY;
  spInterface.m_ClientWidth = saved.m_ClientWidth;
  spInterface.m_ClientHeight = saved.m_ClientHeight;
  spInterface.m_FrozenPixH = saved.m_FrozenPixH;
  spInterface.m_FrozenPixW = saved.m_FrozenPixW;
}

/**
 * Last row fully inside the drawable clip — uses JsonView row.s like SkSpGridCanvas layout.
 */
function lastFullyVisibleRowIndex(uiView, clipHPx) {
  const clipH = Math.max(1, Number(clipHPx) || 1);
  const topRow = Math.max(1, Number(uiView?.toprow) || 1);
  let yAcc = Number(uiView?.dY) || 0;
  let lastRow = topRow - 1;
  const rows = Array.isArray(uiView?.rows) ? uiView.rows : [];

  for (const wRow of rows) {
    const rowH = Number(wRow.s) || 0;
    const ri = Number(wRow.i);
    if (!Number.isFinite(ri) || !(rowH > 0)) continue;
    if (yAcc + rowH <= clipH + 1e-6) {
      lastRow = ri;
      yAcc += rowH;
    } else {
      break;
    }
  }

  if (lastRow < topRow && rows.length > 0) {
    return Math.max(topRow, Number(rows[0].i) || topRow);
  }
  return lastRow;
}

/**
 * Print-tile JsonView: same Index*ByPixel + DiffX as setHScrollBar, DiffY=0 like
 * setVScrollBar. Calls jsonView directly so freeze-pane getView splits are not applied.
 */
async function loadViewAtSheetScroll(spInterface, sheet, sheetTopPx, sheetLeftPx, viewW, viewH) {
  if (window.SkUISpreadSheet == null) {
    throw new Error("Spreadsheet engine not ready");
  }
  const rowRaw = window.SkUISpreadSheet.jsonRowByPixel(1, sheetTopPx, sheet);
  const colRaw = window.SkUISpreadSheet.jsonColByPixel(1, sheetLeftPx, sheet);
  const row = unwrapWasmJson(rowRaw);
  const col = unwrapWasmJson(colRaw);

  const uiView = await fetchJsonViewLikeGrid(
    sheet,
    Math.max(1, Math.round(Number(row?.r) || 1)),
    Math.max(1, Math.round(Number(col?.c) || 1)),
    viewW,
    viewH,
    0,
    Number(col?.d) || 0,
    true,
  );
  hydrateJsonViewCellFormats(uiView);
  return uiView;
}

/**
 * Page tiles from scroll positions — peek each vertical page via jsonView, advance like the scrollbar.
 */
async function buildScrollAlignedExportTiles(
  spInterface,
  sheet,
  pageW,
  pageH,
  paginateWidthPx,
  contentHeightPx,
  pageOrder,
) {
  const saved = saveSpInterfaceViewState(spInterface);
  /** @type {{ sheetTopPx: number, sheetLeftPx: number, viewW: number, viewH: number }[]} */
  const tiles = [];

  try {
    const pw = Math.max(1, pageW);
    const ph = Math.max(1, pageH);
    /** @type {number[]} */
    const xStops = [];
    for (let x = 0; x < paginateWidthPx; x += pw) {
      xStops.push(x);
    }
    if (xStops.length === 0) {
      xStops.push(0);
    }

    /** @type {number[]} */
    const verticalTops = [];
    let sheetTopPx = 0;
    let guard = 0;

    await spInterface.ensureSheetExtent();
    const brRow = Math.max(1, Math.round(Number(spInterface.m_BottomRight?.row()) || 1));

    while (sheetTopPx < contentHeightPx - 1e-6 && guard++ < 512) {
      const peek = await loadViewAtSheetScroll(spInterface, sheet, sheetTopPx, 0, pw, ph);
      if (!jsonViewHasSubstantiveBodyInk(peek)) {
        break;
      }
      verticalTops.push(sheetTopPx);
      const lastRow = lastFullyVisibleRowIndex(peek, ph);
      if (lastRow >= brRow) {
        break;
      }
      const nextTop = Number(window.SkUISpreadSheet.sumPixelHeight(1, lastRow, sheet));
      if (!(nextTop > sheetTopPx + 1e-6)) {
        break;
      }
      sheetTopPx = nextTop;
    }

    if (verticalTops.length === 0) {
      verticalTops.push(0);
    }

    const order = Number(pageOrder) === 1 ? 1 : 0;
    if (order === 1) {
      for (const top of verticalTops) {
        for (const left of xStops) {
          tiles.push({ sheetTopPx: top, sheetLeftPx: left, viewW: pw, viewH: ph });
        }
      }
    } else {
      for (const left of xStops) {
        for (const top of verticalTops) {
          tiles.push({ sheetTopPx: top, sheetLeftPx: left, viewW: pw, viewH: ph });
        }
      }
    }
  } finally {
    restoreSpInterfaceViewState(spInterface, saved);
  }

  return tiles;
}

function findMergeAnchorCellInView(uiView, rt, rl) {
  for (const row of uiView?.rows || []) {
    for (const cell of row?.cells || []) {
      if (Number(cell.c_r) === rt && Number(cell.c_c) === rl) {
        return cell;
      }
    }
  }
  return null;
}

/** Clip a sheet merge to tile viewport; anchor borders come from full-sheet catalog. */
async function clipMergeToTileViewport(merge, tile, sheet) {
  const rt = Math.round(Number(merge.r_t));
  const rl = Math.round(Number(merge.r_l));
  const rb = Math.round(Number(merge.r_b));
  const rr = Math.round(Number(merge.r_r));
  if (rt < 1 || rl < 1 || rb < rt || rr < rl) return null;

  const mTop = rt <= 1 ? 0 : Number(window.SkUISpreadSheet.sumPixelHeight(1, rt - 1, sheet));
  const mLeft = rl <= 1 ? 0 : Number(window.SkUISpreadSheet.sumPixelWidth(1, rl - 1, sheet));
  const mH = Number(window.SkUISpreadSheet.sumPixelHeight(rt, rb, sheet));
  const mW = Number(window.SkUISpreadSheet.sumPixelWidth(rl, rr, sheet));
  if (!(mH > 0) || !(mW > 0)) return null;

  const vL = tile.sheetLeftPx;
  const vT = tile.sheetTopPx;
  const vR = vL + tile.viewW;
  const vB = vT + tile.viewH;

  const iL = Math.max(mLeft, vL);
  const iT = Math.max(mTop, vT);
  const iR = Math.min(mLeft + mW, vR);
  const iB = Math.min(mTop + mH, vB);
  if (iR - iL < 1 || iB - iT < 1) return null;

  return {
    r_t: rt,
    r_l: rl,
    r_b: rb,
    r_r: rr,
    p_l: iL - vL,
    p_t: iT - vT,
    p_w: iR - iL,
    p_h: iB - iT,
  };
}

/** Inject merge slices missing from paginated JsonView (anchor row off-tile). */
async function augmentUiViewMergesForTile(uiView, mergeCatalog, tile, sheet) {
  const catalogMerges = mergeCatalog?.merges;
  if (!Array.isArray(catalogMerges) || catalogMerges.length === 0) return;

  const seen = new Set((uiView.merges || []).map(mergeRangeKey));
  /** @type {object[]} */
  const injected = [];

  for (const m of catalogMerges) {
    const key = mergeRangeKey(m);
    if (seen.has(key)) continue;
    const clipped = await clipMergeToTileViewport(m, tile, sheet);
    if (clipped == null) continue;
    clipped._pdf_anchor = findMergeAnchorCellInView(
      mergeCatalog,
      clipped.r_t,
      clipped.r_l,
    );
    injected.push(clipped);
    seen.add(key);
  }

  if (injected.length > 0) {
    uiView.merges = [...(uiView.merges || []), ...injected];
  }
}

/** Clamp horizontal pagination to main ink hull (drops far-right helper columns). */
function resolvePaginateWidthPx(contentWidthPx, narrowProbeView, wideProbeView) {
  if (!narrowProbeView || !wideProbeView) {
    return contentWidthPx;
  }
  const narrowSub = computeSubstantivePdfPixelBounds(narrowProbeView).maxX;
  const narrowGrid = computeJsonViewPixelBounds(narrowProbeView).maxX;
  const narrowMaxX = Math.max(narrowSub, narrowGrid);
  const wideMaxX = Math.max(
    computeSubstantivePdfPixelBounds(wideProbeView).maxX,
    computeJsonViewPixelBounds(wideProbeView).maxX,
  );
  if (
    !(narrowMaxX > 1) ||
    wideMaxX - narrowMaxX < PDF_EXTENT_WIDE_INK_OVER_NARROW_MIN_GAP
  ) {
    return contentWidthPx;
  }
  return Math.min(
    contentWidthPx,
    Math.ceil(narrowMaxX + JSON_VIEW_BOUNDS_SLACK_CSS_PX),
  );
}

async function fetchFloatingOverlayBoundsPx(spInterface, sheet) {
  /** @type {object[]} */
  let list = [];
  if (spInterface != null && typeof spInterface.loadFloatingObjectsForActiveSheet === "function") {
    await spInterface.loadFloatingObjectsForActiveSheet();
    list = Array.isArray(spInterface.m_FloatingObjects) ? spInterface.m_FloatingObjects : [];
  } else if (window.SkUISpreadSheet?.jsonFloatingObjectsForSheet) {
    const raw = window.SkUISpreadSheet.jsonFloatingObjectsForSheet(sheet, sheet);
    list = parseFloatingObjectsJson(raw);
  }
  list = list.filter((o) => !o?.t || o.t === sheet);

  let maxX = 0;
  let maxY = 0;
  for (const entry of list) {
    const box = resolveFloatingLayoutSheetPx(spInterface, entry, sheet);
    if (!(box.width > 0) || !(box.height > 0)) continue;
    maxX = Math.max(maxX, box.left + box.width);
    maxY = Math.max(maxY, box.top + box.height);
  }
  if (!(maxX > 1) && !(maxY > 1)) return null;
  return {
    maxX: maxX + JSON_VIEW_BOUNDS_SLACK_CSS_PX,
    maxY: maxY + JSON_VIEW_BOUNDS_SLACK_CSS_PX,
  };
}

function resolveMainInkHullPx(wideProbeView, narrowProbeView = null) {
  const wideSub = computeSubstantivePdfPixelBounds(wideProbeView);
  const wideGrid = computeJsonViewPixelBounds(wideProbeView);
  let maxX = Math.max(wideSub.maxX, wideGrid.maxX);
  let maxY = Math.max(wideSub.maxY, wideGrid.maxY);

  if (narrowProbeView) {
    const narrowSub = computeSubstantivePdfPixelBounds(narrowProbeView);
    const narrowGrid = computeJsonViewPixelBounds(narrowProbeView);
    const narrowMaxX = Math.max(narrowSub.maxX, narrowGrid.maxX);
    if (
      narrowMaxX > 1 &&
      maxX - narrowMaxX >= PDF_EXTENT_WIDE_INK_OVER_NARROW_MIN_GAP
    ) {
      maxX = narrowMaxX;
    }
  }
  return { maxX, maxY };
}

/**
 * Fit-to-page extent — full JsonView grid + merges (not ink-only colOverlap cap).
 * @param {object} uiView
 * @param {{ maxX?: number, maxY?: number } | null} overlayBounds
 */
function resolveFitToPagePaintBox(uiView, overlayBounds) {
  const grid = computeJsonViewPixelBounds(uiView);
  const ink = computePdfFitPixelBounds(uiView);
  const sub = computeSubstantivePdfPixelBounds(uiView);
  let maxX = Math.max(grid.maxX, ink.maxX, sub.maxX);
  let maxY = Math.max(grid.maxY, ink.maxY, sub.maxY);
  for (const m of uiView?.merges || []) {
    const pw = Number(m.p_w) || 0;
    const ph = Number(m.p_h) || 0;
    if (pw > 1e-6) {
      maxX = Math.max(maxX, (Number(m.p_l) || 0) + pw);
    }
    if (ph > 1e-6) {
      maxY = Math.max(maxY, (Number(m.p_t) || 0) + ph);
    }
  }
  if (!(maxX > 1) || !(maxY > 1)) {
    maxX = Math.max(maxX, grid.maxX);
    maxY = Math.max(maxY, grid.maxY);
  }
  if (overlayBounds?.maxX > 1) {
    maxX = Math.max(maxX, overlayBounds.maxX);
  }
  if (overlayBounds?.maxY > 1) {
    maxY = Math.max(maxY, overlayBounds.maxY);
  }
  return {
    widthPx: Math.max(1, Math.ceil(maxX)),
    heightPx: Math.max(1, Math.ceil(maxY)),
  };
}

/** Used-range bottom-right in sheet CSS px (m_BottomRight indices, not full grid extent). */
async function resolveUsedRangeBottomRightPx(spInterface, sheet) {
  await spInterface.ensureSheetExtent();
  const br = spInterface.m_BottomRight;
  if (!br) {
    return null;
  }
  const usedRow = Math.max(1, Math.round(Number(br.row()) || 1));
  const usedCol = Math.max(1, Math.round(Number(br.col()) || 1));
  try {
    const maxY = Number(window.SkUISpreadSheet.sumPixelHeight(1, usedRow, sheet));
    const maxX = Number(window.SkUISpreadSheet.sumPixelWidth(1, usedCol, sheet));
    if (!Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return null;
    }
    return { maxX: Math.max(1, maxX), maxY: Math.max(1, maxY) };
  } catch {
    return null;
  }
}

/**
 * Pagination extent — used-range pixels + ink hull (not full m_BottomRightPixel grid extent).
 * @param {{ forFitToPage?: boolean }} [options]
 */
async function resolvePrintContentPx(
  spInterface,
  sheet,
  overlayBounds,
  narrowProbeView,
  options = {},
) {
  await spInterface.ensureSheetExtent();
  const brPx = spInterface.m_BottomRightPixel;
  if (brPx == null) {
    return null;
  }
  const sheetW = Math.max(1, Math.ceil(Number(brPx.col()) || 1));
  const sheetH = Math.max(1, Math.ceil(Number(brPx.row()) || 1));

  if (options.forFitToPage === true) {
    let maxX = sheetW;
    let maxY = sheetH;
    if (overlayBounds?.maxX > 1) {
      maxX = Math.max(maxX, overlayBounds.maxX);
    }
    if (overlayBounds?.maxY > 1) {
      maxY = Math.max(maxY, overlayBounds.maxY);
    }
    maxX = Math.min(maxX + JSON_VIEW_BOUNDS_SLACK_CSS_PX, JSON_VIEW_EXTENT_CAP_PX);
    maxY = Math.min(maxY + JSON_VIEW_BOUNDS_SLACK_CSS_PX, JSON_VIEW_EXTENT_CAP_PX);
    return {
      widthPx: Math.ceil(maxX),
      heightPx: Math.ceil(maxY),
    };
  }

  const { jsonW, jsonH } = jsonViewExtentPx(
    spInterface.m_ClientWidth || 1200,
    spInterface.m_ClientHeight || 800,
  );
  const wideProbe = await fetchJsonViewLikeGrid(sheet, 1, 1, jsonW, jsonH, 0, 0);
  const inkHull = resolveMainInkHullPx(wideProbe, narrowProbeView);
  const usedPx = await resolveUsedRangeBottomRightPx(spInterface, sheet);
  let maxX = Math.max(inkHull.maxX, usedPx?.maxX ?? 0);
  let maxY = Math.max(inkHull.maxY, usedPx?.maxY ?? 0);
  if (!(maxY > 1)) {
    maxY = sheetH;
  }
  if (!(maxX > 1)) {
    maxX = sheetW;
  }

  if (overlayBounds?.maxX > 1) {
    maxX = Math.max(maxX, overlayBounds.maxX);
  }
  if (overlayBounds?.maxY > 1) {
    maxY = Math.max(maxY, overlayBounds.maxY);
  }
  maxX += JSON_VIEW_BOUNDS_SLACK_CSS_PX;
  maxY += JSON_VIEW_BOUNDS_SLACK_CSS_PX;
  return {
    widthPx: Math.ceil(maxX),
    heightPx: Math.ceil(maxY),
  };
}

/** Prefer JsonView scroll*Px folded with negative dX/dY; fall back to tile band origin. */
function resolveTileScrollOrigin(uiView, tile) {
  const fromView = sheetScrollOriginPx(uiView);
  return {
    diffX: Number.isFinite(Number(uiView?.scrollLeftPx))
      ? fromView.diffX
      : tile.sheetLeftPx,
    diffY: Number.isFinite(Number(uiView?.scrollTopPx))
      ? fromView.diffY
      : tile.sheetTopPx,
  };
}

/**
 * Render one sheet's pages into an existing PDFDocument.
 * @returns {Promise<number>} pages actually added (0 when the sheet has no ink).
 */
async function renderSheetIntoPdf(pdfDoc, spInterface, printParams, sheet, options = {}) {
  if (!sheet) {
    throw new Error("No sheet for PDF export");
  }

  const layout = drawablePageCssPxFromPrintParameters(printParams);
  const { merged, pageSizeMm, marginsMm } = layout;
  const pageWidthPt = mmToPdfPt(pageSizeMm.widthMm);
  const pageHeightPt = mmToPdfPt(pageSizeMm.heightMm);
  const marginLeftPt = mmToPdfPt(marginsMm.left);
  const marginTopPt = mmToPdfPt(marginsMm.top);
  const scaleFactor = printScaleFactor(merged);
  const paintScaleFactor = merged.fitToPage === true ? 1 : scaleFactor;
  const dpr = options.dpr ?? DEFAULT_EXPORT_DPR;

  const pageW = Math.max(1, layout.widthPx);
  const pageH = Math.max(1, layout.heightPx);
  const printVp = sheetViewportForPrintScale(pageW, pageH, paintScaleFactor);
  const sheetPageW = printVp.sheetW;
  const sheetPageH = printVp.sheetH;
  const canvasW = printVp.canvasW;
  const canvasH = printVp.canvasH;
  const tilePaintScale = printVp.paintScale;

  let narrowProbeView = null;
  const { jsonW: probeW } = jsonViewExtentPx(pageW, pageH);
  const wideForSanitize = await fetchJsonViewLikeGrid(sheet, 1, 1, probeW, pageH, 0, 0);
  if (probeW > PDF_EXTENT_PROBE_VIEWPORT_W_INK_NARROW_PX) {
    narrowProbeView = await fetchJsonViewLikeGrid(
      sheet,
      1,
      1,
      PDF_EXTENT_PROBE_VIEWPORT_W_INK_NARROW_PX,
      pageH,
      0,
      0,
    );
  }

  const overlayBounds = await fetchFloatingOverlayBoundsPx(spInterface, sheet);
  const contentPx =
    (await resolvePrintContentPx(spInterface, sheet, overlayBounds, narrowProbeView, {
      forFitToPage: merged.fitToPage === true,
    })) ?? {
      widthPx: pageW,
      heightPx: pageH,
    };

  /** @type {{ viewW: number, viewH: number, sheetTopPx: number, sheetLeftPx: number }[]} */
  let tiles = [];

  if (merged.fitToPage === true) {
    tiles.push({
      viewW: contentPx.widthPx,
      viewH: contentPx.heightPx,
      sheetTopPx: 0,
      sheetLeftPx: 0,
    });
  } else {
    const paginateWidthPx = resolvePaginateWidthPx(
      contentPx.widthPx,
      narrowProbeView,
      wideForSanitize,
    );
    const pageOrder = Number(merged.pageOrder) === 1 ? 1 : 0;
    tiles = await buildScrollAlignedExportTiles(
      spInterface,
      sheet,
      sheetPageW,
      sheetPageH,
      paginateWidthPx,
      contentPx.heightPx,
      pageOrder,
    );
    if (tiles.length === 0) {
      tiles.push({
        viewW: sheetPageW,
        viewH: sheetPageH,
        sheetTopPx: 0,
        sheetLeftPx: 0,
      });
    }
  }

  let mergeCatalog = null;
  if (merged.fitToPage !== true) {
    const catalogW = Math.min(
      Math.max(1, Math.ceil(contentPx.widthPx)),
      JSON_VIEW_EXTENT_CAP_PX,
    );
    const catalogH = Math.min(
      Math.max(1, Math.ceil(contentPx.heightPx)),
      JSON_VIEW_EXTENT_CAP_PX,
    );
    mergeCatalog = await fetchJsonViewLikeGrid(
      sheet,
      1,
      1,
      catalogW,
      catalogH,
      0,
      0,
      true,
    );
  }

  const total = tiles.length;
  let done = 0;
  let pagesAdded = 0;
  const viewStateSaved = saveSpInterfaceViewState(spInterface);

  try {
    for (const tile of tiles) {
      if (
        shouldSkipPhantomHorizontalTile(
          { diffX: tile.sheetLeftPx, diffY: tile.sheetTopPx },
          narrowProbeView,
          wideForSanitize,
        )
      ) {
        done += 1;
        options.onProgress?.(done, total, options.meta);
        continue;
      }

      const uiView = await loadViewAtSheetScroll(
        spInterface,
        sheet,
        tile.sheetTopPx,
        tile.sheetLeftPx,
        tile.viewW,
        tile.viewH,
      );

      if (!jsonViewHasSubstantiveBodyInk(uiView)) {
        done += 1;
        options.onProgress?.(done, total, options.meta);
        continue;
      }

      if (mergeCatalog != null) {
        await augmentUiViewMergesForTile(uiView, mergeCatalog, tile, sheet);
      }

      const scrollOrigin = resolveTileScrollOrigin(uiView, tile);
      const placement = {
        horizontalCentered: merged.horizontalCentered === true,
        verticalCentered: merged.verticalCentered === true,
      };

      let paintScale = tilePaintScale;
      let sheetViewW = tile.viewW;
      let sheetViewH = tile.viewH;
      if (merged.fitToPage === true) {
        const fitBox = resolveFitToPagePaintBox(uiView, overlayBounds);
        sheetViewW = fitBox.widthPx;
        sheetViewH = fitBox.heightPx;
        paintScale = computeFitPaintScale(
          sheetViewW,
          sheetViewH,
          canvasW,
          canvasH,
          {
            fitToWidthPages: merged.fitToWidthPages,
            fitToHeightPages: merged.fitToHeightPages,
          },
          true,
        );
        // Uniform fit-to-page: when height limits scale, center horizontally (Excel-like).
        const inkW = sheetViewW * paintScale;
        const inkH = sheetViewH * paintScale;
        if (
          merged.horizontalCentered !== true &&
          inkW < canvasW - 1 &&
          inkH <= canvasH + 1
        ) {
          placement.horizontalCentered = true;
        }
      }

      const canvas = await renderViewToCanvas(
        uiView,
        spInterface,
        sheetViewW,
        sheetViewH,
        canvasW,
        canvasH,
        paintScale,
        dpr,
        scrollOrigin,
        placement,
      );
      const pngBytes = await canvasToPngBytes(canvas);
      const pngImage = await pdfDoc.embedPng(pngBytes);
      const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);

      const drawWPt = cssPxToPdfPt(canvasW, 1);
      const drawHPt = cssPxToPdfPt(canvasH, 1);
      const xPt = marginLeftPt;
      const yPt = pageHeightPt - marginTopPt - drawHPt;

      page.drawImage(pngImage, {
        x: xPt,
        y: yPt,
        width: drawWPt,
        height: drawHPt,
      });

      pagesAdded += 1;
      done += 1;
      options.onProgress?.(done, total, options.meta);
    }
  } finally {
    restoreSpInterfaceViewState(spInterface, viewStateSaved);
  }

  return pagesAdded;
}

/** Export the active sheet only (paginated across all its pages). */
export async function exportActiveSheetToPdfBytes(spInterface, printParams, options = {}) {
  const sheet = spInterface?.m_UIView?.sheet || "";
  if (!sheet) {
    throw new Error("No active sheet for PDF export");
  }
  const pdfDoc = await PDFDocument.create();
  const pagesAdded = await renderSheetIntoPdf(
    pdfDoc,
    spInterface,
    printParams,
    sheet,
    options,
  );
  if (pagesAdded === 0) {
    throw new Error("PDF export: no printable content on sheet");
  }
  return pdfDoc.save();
}

/**
 * Export every (non-system) sheet of the workbook into a single PDF, each sheet
 * paginated with its own print parameters.
 * @param {(sheet: string) => (object | Promise<object>)} resolveParamsForSheet
 *   Returns the print parameters to use for a given sheet.
 */
export async function exportWorkbookToPdfBytes(spInterface, resolveParamsForSheet, options = {}) {
  if (spInterface == null || typeof spInterface.loadSheetList !== "function") {
    throw new Error("Spreadsheet not ready for workbook PDF export");
  }
  const ui = window.SkUISpreadSheet;
  if (ui == null || typeof ui.setActiveSheet !== "function") {
    throw new Error("Spreadsheet engine not ready for workbook PDF export");
  }
  const sheets = await spInterface.loadSheetList();
  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new Error("No sheets to export");
  }

  // Sheet the user is viewing — restored (with a real on-screen repaint) at the end.
  const originalActive =
    spInterface?.m_UIView?.sheet ||
    (typeof ui.getActiveSheet === "function" ? ui.getActiveSheet() : "");

  const pdfDoc = await PDFDocument.create();
  let totalPages = 0;

  try {
    for (let wI = 0; wI < sheets.length; wI += 1) {
      const wSheet = sheets[wI];
      // Switch the ENGINE's active sheet only. spInterface.setActiveSheet() would
      // run reloadView() + SetTab(), repainting the visible grid and flashing the
      // tab for every sheet. The PDF pipeline reads each sheet via explicit `sheet`
      // args plus the now-current engine active sheet for extent/getView, and never
      // calls invalidateAll(), so nothing is drawn on screen during the export.
      ui.setActiveSheet(wSheet);
      spInterface.invalidateSheetExtent?.();

      const wParams = await resolveParamsForSheet(wSheet);
      const wMeta = { sheet: wSheet, sheetIndex: wI + 1, sheetCount: sheets.length };
      totalPages += await renderSheetIntoPdf(pdfDoc, spInterface, wParams, wSheet, {
        ...options,
        meta: wMeta,
      });
    }
  } finally {
    // Restore the original sheet AND repaint it on screen (full setActiveSheet).
    if (originalActive) {
      if (typeof spInterface.setActiveSheet === "function") {
        await spInterface.setActiveSheet(originalActive);
      } else {
        ui.setActiveSheet(originalActive);
      }
    }
  }

  if (totalPages === 0) {
    throw new Error("PDF export: no printable content in workbook");
  }
  return pdfDoc.save();
}

function triggerPdfDownload(bytes, fileName) {
  const safeName =
    (fileName || "export").replace(/[/\\?%*:|"<>]/g, "_").replace(/\.pdf$/i, "") + ".pdf";
  const blob = new Blob([bytes], { type: "application/pdf" });
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objUrl);
}

export async function downloadActiveSheetPdf(spInterface, printParams, fileName, options = {}) {
  const bytes = await exportActiveSheetToPdfBytes(spInterface, printParams, options);
  triggerPdfDownload(bytes, fileName);
}

/** Download a single PDF covering every sheet of the workbook. */
export async function downloadWorkbookPdf(spInterface, resolveParamsForSheet, fileName, options = {}) {
  const bytes = await exportWorkbookToPdfBytes(spInterface, resolveParamsForSheet, options);
  triggerPdfDownload(bytes, fileName);
}
