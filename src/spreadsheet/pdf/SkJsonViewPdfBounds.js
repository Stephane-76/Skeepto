//=============================================================================
// JsonView pixel bounds for PDF fit-to-page (mirrors Node jsonViewToPdf.mjs).
//=============================================================================

const JSON_VIEW_BOUNDS_SLACK_CSS_PX = 8;
const PDF_CLIP_R_ABUSE_GAP_CSS_PX = 160;
const PDF_INK_EXTENT_SLOP_COL = 8;
const PDF_INK_EXTENT_SLOP_ROW = 8;
const PDF_MIN_INK_COL_FOR_EXTENT_CLAMP = 3;
const PDF_MIN_INK_ROW_FOR_EXTENT_CLAMP = 3;
const PDF_SUSPICIOUS_LAST_COL_THRESHOLD = 1024;
const PDF_FALLBACK_LAST_COL_WHEN_PROBE_WEAK = 512;
const PDF_EXTENT_PROBE_VIEWPORT_W_INK_NARROW_PX = 2048;
const PDF_EXTENT_WIDE_INK_OVER_NARROW_MIN_GAP = 70;

function cellHasSubstantiveInk(cell) {
  if (!cell || typeof cell !== "object") return false;
  if (cell.c__l === true || cell.c__r === true) return false;
  const w = Number(cell.c_w) || 0;
  const h = Number(cell.c_h) || 0;
  if (w < 1e-6 || h < 1e-6) return false;
  if (cell.c_t === "c" && cell.c_v != null && typeof cell.c_v === "object") {
    if (Object.prototype.hasOwnProperty.call(cell.c_v, "co")) return true;
    if (cell.c_v.n) return true;
  }
  const v = cell.c_v;
  if (v != null && v !== "" && String(v).trim() !== "") return true;
  if (cell.c_mg === true && cell.f_bc) return true;
  return false;
}

function cellPdfFitRightPx(cell) {
  const cXPx = Number(cell.c_x) || 0;
  const boxR = cXPx + (Number(cell.c_w) || 0);
  if (typeof cell.clip_r !== "number") return boxR;
  const cr = cell.clip_r;
  if (cr <= boxR + 0.5) return cr;
  if (cr - boxR > PDF_CLIP_R_ABUSE_GAP_CSS_PX) return boxR;
  return cr;
}

function sumJsonViewAxisSizesPx(axis) {
  if (!Array.isArray(axis)) return 0;
  let sum = 0;
  for (const item of axis) {
    if (item && typeof item === "object" && typeof item.s === "number") sum += item.s;
  }
  return sum;
}

function computeColumnOverlapRightPx(view) {
  const cols = Array.isArray(view.cols) ? view.cols : [];
  const rows = Array.isArray(view.rows) ? view.rows : [];
  const dX = Number(view.dX) || 0;
  /** @type {{ left: number, right: number }[]} */
  const bands = [];
  let x = dX;
  for (const col of cols) {
    if (!col || typeof col !== "object") continue;
    const w = typeof col.s === "number" ? col.s : 0;
    bands.push({ left: x, right: x + w });
    x += w;
  }
  if (bands.length === 0) return 0;

  let usedRight = 0;
  for (const row of rows) {
    const cells = row && Array.isArray(row.cells) ? row.cells : [];
    for (const cell of cells) {
      if (!cell || typeof cell !== "object") continue;
      const l = Number(cell.c_x) || 0;
      const r = l + (Number(cell.c_w) || 0);
      if (!(r > l)) continue;
      for (const b of bands) {
        if (r > b.left + 1e-6 && l < b.right - 1e-6) {
          usedRight = Math.max(usedRight, b.right);
        }
      }
    }
  }
  return usedRight;
}

function computeRowOverlapBottomPx(view) {
  const axisRows = Array.isArray(view.rows) ? view.rows : [];
  const dY = Number(view.dY) || 0;
  /** @type {{ top: number, bottom: number }[]} */
  const bands = [];
  let y = dY;
  for (const row of axisRows) {
    if (!row || typeof row !== "object") continue;
    const h = typeof row.s === "number" ? row.s : 0;
    bands.push({ top: y, bottom: y + h });
    y += h;
  }
  if (bands.length === 0) return 0;

  let usedBottom = 0;
  for (const row of axisRows) {
    const cells = row && Array.isArray(row.cells) ? row.cells : [];
    for (const cell of cells) {
      if (!cell || typeof cell !== "object") continue;
      const t = Number(cell.c_y) || 0;
      const b = t + (Number(cell.c_h) || 0);
      if (!(b > t)) continue;
      for (const band of bands) {
        if (b > band.top + 1e-6 && t < band.bottom - 1e-6) {
          usedBottom = Math.max(usedBottom, band.bottom);
        }
      }
    }
  }
  return usedBottom;
}

/**
 * Full grid extent in JsonView pixel space (cell geometry + cols[]/rows[] span).
 * Use for pagination — unlike {@link computePdfFitPixelBounds}, does not cap to overlap bands.
 * @param {object} view
 * @returns {{ maxX: number, maxY: number }}
 */
export function computeJsonViewPixelBounds(view) {
  if (!view || typeof view !== "object") {
    return { maxX: 0, maxY: 0 };
  }
  let maxX = 0;
  let maxY = 0;
  const rows = Array.isArray(view.rows) ? view.rows : [];
  for (const row of rows) {
    const cells = row && Array.isArray(row.cells) ? row.cells : [];
    for (const cell of cells) {
      if (!cell || typeof cell !== "object") continue;
      const x = Number(cell.c_x) || 0;
      const y = Number(cell.c_y) || 0;
      const w = Number(cell.c_w) || 0;
      const h = Number(cell.c_h) || 0;
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }
  }
  const dX = Number(view.dX) || 0;
  const dY = Number(view.dY) || 0;
  const cols = Array.isArray(view.cols) ? view.cols : [];
  const gridRight = cols.length > 0 ? dX + sumJsonViewAxisSizesPx(cols) : 0;
  const gridBottom = rows.length > 0 ? dY + sumJsonViewAxisSizesPx(rows) : 0;
  maxX = Math.max(maxX, gridRight);
  maxY = Math.max(maxY, gridBottom);
  maxX += JSON_VIEW_BOUNDS_SLACK_CSS_PX;
  maxY += JSON_VIEW_BOUNDS_SLACK_CSS_PX;
  return { maxX, maxY };
}

/**
 * Tight bounds for uniform fit-to-page scale (same as server computePdfFitPixelBounds).
 * @param {object} view
 * @returns {{ maxX: number, maxY: number }}
 */
export function computePdfFitPixelBounds(view) {
  if (!view || typeof view !== "object") {
    return { maxX: 0, maxY: 0 };
  }

  let geomMaxX = 0;
  let geomMaxY = 0;
  const rows = Array.isArray(view.rows) ? view.rows : [];
  for (const row of rows) {
    const cells = row && Array.isArray(row.cells) ? row.cells : [];
    for (const cell of cells) {
      if (!cell || typeof cell !== "object") continue;
      const y = Number(cell.c_y) || 0;
      const h = Number(cell.c_h) || 0;
      geomMaxX = Math.max(geomMaxX, cellPdfFitRightPx(cell));
      geomMaxY = Math.max(geomMaxY, y + h);
    }
  }

  const dX = Number(view.dX) || 0;
  const dY = Number(view.dY) || 0;
  const cols = Array.isArray(view.cols) ? view.cols : [];
  const gridRight = cols.length > 0 ? dX + sumJsonViewAxisSizesPx(cols) : 0;
  const gridBottom = rows.length > 0 ? dY + sumJsonViewAxisSizesPx(rows) : 0;

  const colOverlapRight = computeColumnOverlapRightPx(view);
  const rowOverlapBottom = computeRowOverlapBottomPx(view);

  let maxX = geomMaxX > 0 ? geomMaxX : gridRight;
  if (colOverlapRight > 0) {
    maxX = Math.min(maxX, colOverlapRight);
  }
  let maxY = geomMaxY > 0 ? geomMaxY : gridBottom;
  if (rowOverlapBottom > 0) {
    maxY = Math.min(maxY, rowOverlapBottom);
  }

  maxX += JSON_VIEW_BOUNDS_SLACK_CSS_PX;
  maxY += JSON_VIEW_BOUNDS_SLACK_CSS_PX;
  return { maxX, maxY };
}

/**
 * Last 1-based column/row from cell anchors (skip overflow proxies c__l / c__r).
 * @param {object} view
 */
export function scanJsonViewMaxInkCellIndices(view) {
  let maxC = 1;
  let maxR = 1;
  if (!view || typeof view !== "object") return { maxC, maxR };
  for (const row of view.rows || []) {
    const cells = row?.cells;
    if (!Array.isArray(cells)) continue;
    for (const cell of cells) {
      if (!cell || typeof cell !== "object") continue;
      if (cell.c__l === true || cell.c__r === true) continue;
      const cc = Number(cell.c_c);
      const cr = Number(cell.c_r);
      if (Number.isFinite(cc) && cc >= 1) maxC = Math.max(maxC, Math.round(cc));
      if (Number.isFinite(cr) && cr >= 1) maxR = Math.max(maxR, Math.round(cr));
    }
  }
  for (const m of view.merges || []) {
    const rr = Number(m.r_r);
    const rb = Number(m.r_b);
    if (Number.isFinite(rr) && rr >= 1) maxC = Math.max(maxC, Math.round(rr));
    if (Number.isFinite(rb) && rb >= 1) maxR = Math.max(maxR, Math.round(rb));
  }
  return { maxC, maxR };
}

/**
 * Tight pixel hull of substantive ink only (ignores empty formatted filler rows/cols).
 * @param {object} view
 */
export function computeSubstantivePdfPixelBounds(view) {
  if (!view || typeof view !== "object") {
    return { maxX: 0, maxY: 0 };
  }
  let maxX = 0;
  let maxY = 0;
  for (const row of view.rows || []) {
    for (const cell of row?.cells || []) {
      if (!cellHasSubstantiveInk(cell)) continue;
      maxY = Math.max(maxY, (Number(cell.c_y) || 0) + (Number(cell.c_h) || 0));
      maxX = Math.max(maxX, cellPdfFitRightPx(cell));
    }
  }
  for (const m of view.merges || []) {
    const pw = Number(m.p_w) || 0;
    const ph = Number(m.p_h) || 0;
    if (pw > 1e-6 && ph > 1e-6) {
      maxX = Math.max(maxX, (Number(m.p_l) || 0) + pw);
      maxY = Math.max(maxY, (Number(m.p_t) || 0) + ph);
    }
  }
  if (maxX > 0) maxX += JSON_VIEW_BOUNDS_SLACK_CSS_PX;
  if (maxY > 0) maxY += JSON_VIEW_BOUNDS_SLACK_CSS_PX;
  return { maxX, maxY };
}

/**
 * Clamp JsonBottomRight toward last ink cell — avoids phantom column/row bands (server parity).
 * @param {{ c: number, r: number } | null} rawBr
 * @param {object | null} probeView
 */
export function sanitizePdfSheetBottomRightFromProbe(rawBr, probeView, narrowProbeView = null) {
  if (!rawBr || typeof rawBr !== "object") return null;
  let effC = Math.round(Number(rawBr.c));
  let effR = Math.round(Number(rawBr.r));
  if (!Number.isFinite(effC) || !Number.isFinite(effR) || effC < 1 || effR < 1) {
    return null;
  }

  const suspiciousCol = effC >= PDF_SUSPICIOUS_LAST_COL_THRESHOLD;
  let maxInkC = 1;
  let maxInkR = 1;
  const probeOk = probeView && typeof probeView === "object";
  if (probeOk) {
    const ink = scanJsonViewMaxInkCellIndices(probeView);
    maxInkC = ink.maxC;
    maxInkR = ink.maxR;
    if (suspiciousCol && narrowProbeView && typeof narrowProbeView === "object") {
      const inkNarrow = scanJsonViewMaxInkCellIndices(narrowProbeView);
      if (
        inkNarrow.maxC >= PDF_MIN_INK_COL_FOR_EXTENT_CLAMP &&
        maxInkC - inkNarrow.maxC >= PDF_EXTENT_WIDE_INK_OVER_NARROW_MIN_GAP
      ) {
        maxInkC = inkNarrow.maxC;
      }
    }
  }

  if (probeOk && maxInkC >= PDF_MIN_INK_COL_FOR_EXTENT_CLAMP) {
    effC = Math.min(effC, maxInkC + PDF_INK_EXTENT_SLOP_COL);
  } else if (suspiciousCol) {
    effC = Math.min(effC, PDF_FALLBACK_LAST_COL_WHEN_PROBE_WEAK);
  }
  if (probeOk && maxInkR >= PDF_MIN_INK_ROW_FOR_EXTENT_CLAMP) {
    effR = Math.min(effR, maxInkR + PDF_INK_EXTENT_SLOP_ROW);
  }

  return { c: Math.max(1, effC), r: Math.max(1, effR) };
}

/**
 * True when JsonView has printable content (text, numbers, merge paint, etc.).
 * @param {object} view
 */
export function jsonViewHasSubstantiveBodyInk(view) {
  for (const m of view?.merges || []) {
    const pw = Number(m.p_w) || 0;
    const ph = Number(m.p_h) || 0;
    if (pw > 1e-6 && ph > 1e-6) return true;
  }
  for (const row of view?.rows || []) {
    for (const cell of row?.cells || []) {
      if (cellHasSubstantiveInk(cell)) return true;
    }
  }
  return false;
}

/**
 * True when JsonView carries at least one cell body box (skip blank paper tiles).
 * @param {object} view
 */
export function jsonViewHasRenderableBodyInk(view) {
  for (const m of view?.merges || []) {
    const pw = Number(m.p_w) || 0;
    const ph = Number(m.p_h) || 0;
    if (pw > 1e-6 && ph > 1e-6) return true;
  }
  for (const row of view?.rows || []) {
    for (const cell of row?.cells || []) {
      if (!cell || typeof cell !== "object") continue;
      const w = Number(cell.c_w) || 0;
      const h = Number(cell.c_h) || 0;
      if (w > 1e-6 && h > 1e-6) return true;
    }
  }
  return false;
}

/**
 * Skip horizontal tiles past the dashboard hull (helper columns far right of main ink).
 * @param {{ diffX: number, diffY: number }} tile
 * @param {object | null} narrowProbeView
 * @param {object} wideProbeView
 */
export function shouldSkipPhantomHorizontalTile(tile, narrowProbeView, wideProbeView) {
  if (!narrowProbeView || !(Number(tile.diffX) > 0)) return false;
  const narrowMaxX = computeSubstantivePdfPixelBounds(narrowProbeView).maxX;
  const wideMaxX = computeSubstantivePdfPixelBounds(wideProbeView).maxX;
  if (!(narrowMaxX > 1) || !(wideMaxX > narrowMaxX + 48)) return false;
  return Number(tile.diffX) >= narrowMaxX - JSON_VIEW_BOUNDS_SLACK_CSS_PX;
}

export {
  JSON_VIEW_BOUNDS_SLACK_CSS_PX,
  PDF_EXTENT_PROBE_VIEWPORT_W_INK_NARROW_PX,
  PDF_EXTENT_WIDE_INK_OVER_NARROW_MIN_GAP,
  PDF_SUSPICIOUS_LAST_COL_THRESHOLD,
};
