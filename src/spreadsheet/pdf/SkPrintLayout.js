//=============================================================================
// Print layout helpers for client PDF export (mirrors Node printParametersToPdfOptions).
//=============================================================================

const MM_PER_INCH = 25.4;
const CSS_REFERENCE_PX_PER_INCH = 96;

/** Same defaults as tPrintParameters / SkSpPrintParameters (sparse JSON omits defaults). */
const PRINT_DEFAULTS = Object.freeze({
  paperSize: 9,
  orientation: 0,
  scale: 100,
  fitToPage: true,
  fitToWidthPages: 1,
  fitToHeightPages: 1,
  pageOrder: 0,
  marginLeft: 0.7,
  marginRight: 0.7,
  marginTop: 0.75,
  marginBottom: 0.75,
  horizontalCentered: false,
  verticalCentered: false,
});

/** ECMA-376 ST_PagePaperSize portrait mm; 12/13 use JIS (Excel xlsx interop). */
const OOXML_PAPER_PORTRAIT_MM = new Map([
  [1, [215.9, 279.4]],
  [2, [215.9, 279.4]],
  [3, [279.4, 431.8]],
  [4, [279.4, 431.8]],
  [5, [215.9, 355.6]],
  [6, [139.7, 215.9]],
  [7, [184.2, 266.7]],
  [8, [297, 420]],
  [9, [210, 297]],
  [10, [210, 297]],
  [11, [148, 210]],
  [12, [257, 364]],
  [13, [182, 257]],
  [14, [215.9, 330.2]],
  [15, [215, 275]],
  [16, [254, 355.6]],
  [17, [279.4, 431.8]],
  [18, [215.9, 279.4]],
]);

export function mergeSheetPrintParameters(raw) {
  const base = { ...PRINT_DEFAULTS };
  if (!raw || typeof raw !== "object") return base;
  const o = /** @type {Record<string, unknown>} */ (raw);
  for (const key of Object.keys(PRINT_DEFAULTS)) {
    if (Object.prototype.hasOwnProperty.call(o, key)) {
      base[key] = o[key];
    }
  }
  return base;
}

function marginsMmFromInches(pp) {
  const inch = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);
  return {
    left: inch(pp.marginLeft, PRINT_DEFAULTS.marginLeft) * MM_PER_INCH,
    right: inch(pp.marginRight, PRINT_DEFAULTS.marginRight) * MM_PER_INCH,
    top: inch(pp.marginTop, PRINT_DEFAULTS.marginTop) * MM_PER_INCH,
    bottom: inch(pp.marginBottom, PRINT_DEFAULTS.marginBottom) * MM_PER_INCH,
  };
}

/** OOXML pageSetup @orientation: 0 portrait, 1 landscape (tPrintOrientation). */
export function printOrientationIsLandscape(orientation) {
  return Number(orientation) === 1;
}

function paperToPageMm(paperSize, orientation) {
  const code = Number.isFinite(Number(paperSize)) ? Math.round(Number(paperSize)) : 9;
  const pair = OOXML_PAPER_PORTRAIT_MM.get(code) ?? OOXML_PAPER_PORTRAIT_MM.get(1);
  let w = pair[0];
  let h = pair[1];
  if (w > h) [w, h] = [h, w];
  if (printOrientationIsLandscape(orientation)) {
    return { widthMm: h, heightMm: w };
  }
  return { widthMm: w, heightMm: h };
}

export function mmToCssPx(mm) {
  return (Number(mm) * CSS_REFERENCE_PX_PER_INCH) / MM_PER_INCH;
}

export function cssPxToMm(px) {
  return (Number(px) * MM_PER_INCH) / CSS_REFERENCE_PX_PER_INCH;
}

export function mmToPdfPt(mm) {
  return (Number(mm) * 72) / MM_PER_INCH;
}

export function cssPxToPdfPt(px, scaleFactor = 1) {
  return mmToPdfPt(cssPxToMm(px) * scaleFactor);
}

export function drawablePageCssPxFromPrintParameters(sheetPrintParameters) {
  const merged = mergeSheetPrintParameters(sheetPrintParameters);
  const { widthMm, heightMm } = paperToPageMm(
    Number(merged.paperSize),
    Number(merged.orientation),
  );
  const mar = marginsMmFromInches(merged);
  const drawableWMm = Math.max(0, widthMm - mar.left - mar.right);
  const drawableHMm = Math.max(0, heightMm - mar.top - mar.bottom);
  return {
    widthPx: mmToCssPx(drawableWMm),
    heightPx: mmToCssPx(drawableHMm),
    pageSizeMm: { widthMm, heightMm },
    drawableMm: { width: drawableWMm, height: drawableHMm },
    marginsMm: mar,
    merged,
  };
}

export function printScaleFactor(merged) {
  const scale = Number(merged.scale);
  return Number.isFinite(scale) && scale >= 10 && scale <= 400 ? scale / 100 : 1;
}

/**
 * Sheet-top Y offsets where each vertical page fits whole rows (no mid-row cuts).
 * @param {Map<number, number>} rowPx
 * @param {number} lastRow
 * @param {number} pageHeightPx
 * @param {number} contentHeightPx
 */
export function buildRowSnappedSheetTopPxList(rowPx, lastRow, pageHeightPx, contentHeightPx) {
  const tops = [0];
  let tr = 1;
  const lr = Math.max(1, Math.round(lastRow));
  const maxH = Math.max(1, pageHeightPx);
  const contentH = Math.max(0, contentHeightPx);
  while (tr <= lr) {
    const rb = computeRowBandPx(rowPx, tr, lr, maxH);
    if (!rb) break;
    tr = rb.bottomRow + 1;
    if (tr > lr) break;
    let nextTop = 0;
    for (let r = 1; r < tr; r++) {
      nextTop += rowPx.get(r) ?? 0;
    }
    if (nextTop >= contentH - 1e-6) break;
    tops.push(nextTop);
  }
  return tops;
}

/**
 * Horizontal scroll steps × row-snapped vertical bands (JsonView spill viewport stays page-sized).
 */
export function* iterateRowSnappedScrollPageOffsets(
  contentWidthPx,
  sheetTopPxList,
  pageWidthPx,
  pageOrder = 0,
) {
  const pw = Math.max(1, pageWidthPx);
  const cw = Math.max(0, contentWidthPx);
  /** @type {number[]} */
  const xStops = [];
  for (let x = 0; x < cw; x += pw) {
    xStops.push(x);
  }
  if (xStops.length === 0) {
    xStops.push(0);
  }
  const yStops = Array.isArray(sheetTopPxList) && sheetTopPxList.length > 0 ? sheetTopPxList : [0];

  if (pageOrder === 1) {
    for (const diffY of yStops) {
      for (const diffX of xStops) {
        yield { diffX, diffY };
      }
    }
  } else {
    for (const diffX of xStops) {
      for (const diffY of yStops) {
        yield { diffX, diffY };
      }
    }
  }
}

export function* iterateJsonViewPageOffsets(
  contentWidthPx,
  contentHeightPx,
  pageWidthPx,
  pageHeightPx,
  pageOrder = 0,
) {
  const pw = Math.max(1, pageWidthPx);
  const ph = Math.max(1, pageHeightPx);
  const cw = Math.max(0, contentWidthPx);
  const ch = Math.max(0, contentHeightPx);
  if (pageOrder === 1) {
    for (let x = 0; x < cw; x += pw) {
      for (let y = 0; y < ch; y += ph) {
        yield { diffX: x, diffY: y };
      }
    }
  } else {
    for (let y = 0; y < ch; y += ph) {
      for (let x = 0; x < cw; x += pw) {
        yield { diffX: x, diffY: y };
      }
    }
  }
}

export function buildAxisPixelMapsFromJsonView(view) {
  const colPx = new Map();
  for (const e of view.cols || []) {
    if (e && Number.isFinite(e.i) && Number.isFinite(e.s)) {
      colPx.set(Math.round(e.i), Number(e.s));
    }
  }
  const rowPx = new Map();
  for (const e of view.rows || []) {
    if (e && Number.isFinite(e.i) && Number.isFinite(e.s)) {
      rowPx.set(Math.round(e.i), Number(e.s));
    }
  }
  let lastCol = Number.isFinite(view.lastcol) ? Math.round(view.lastcol) : 0;
  let lastRow = Number.isFinite(view.lastrow) ? Math.round(view.lastrow) : 0;
  for (const k of colPx.keys()) {
    if (k > lastCol) lastCol = k;
  }
  for (const k of rowPx.keys()) {
    if (k > lastRow) lastRow = k;
  }
  return { colPx, rowPx, lastCol, lastRow };
}

export function computeUsedRangeBottomRightPx(view, brIdx) {
  if (!view || typeof view !== "object" || !brIdx || typeof brIdx !== "object") {
    return null;
  }
  const cr = Number(brIdx.c);
  const rr = Number(brIdx.r);
  if (!Number.isFinite(cr) || !Number.isFinite(rr) || cr < 1 || rr < 1) {
    return null;
  }

  const { colPx, rowPx, lastCol, lastRow } = buildAxisPixelMapsFromJsonView(view);
  const cLim = lastCol >= 1 ? Math.min(cr, lastCol) : cr;
  const rLim = lastRow >= 1 ? Math.min(rr, lastRow) : rr;
  const dX = Number(view.dX) || 0;
  const dY = Number(view.dY) || 0;

  let sumW = 0;
  for (let c = 1; c <= cLim; c++) sumW += colPx.get(c) ?? 0;
  let sumH = 0;
  for (let r = 1; r <= rLim; r++) sumH += rowPx.get(r) ?? 0;

  const maxX = dX + sumW;
  const maxY = dY + sumH;
  if (!(maxX > 1e-9) || !(maxY > 1e-9)) return null;
  return { maxX, maxY };
}

const BAND_EPS = 1e-6;

export function computeColBandPx(colPx, leftCol, lastCol, maxWPx) {
  if (leftCol > lastCol) return null;
  let acc = 0;
  let rightCol = leftCol - 1;
  for (let c = leftCol; c <= lastCol; c++) {
    const w = colPx.get(c) ?? 0;
    if (acc > BAND_EPS && acc + w > maxWPx + BAND_EPS) break;
    acc += w;
    rightCol = c;
  }
  if (rightCol < leftCol) return null;
  return { widthPx: acc, rightCol };
}

export function computeRowBandPx(rowPx, topRow, lastRow, maxHPx) {
  if (topRow > lastRow) return null;
  let acc = 0;
  let bottomRow = topRow - 1;
  for (let r = topRow; r <= lastRow; r++) {
    const h = rowPx.get(r) ?? 0;
    if (acc > BAND_EPS && acc + h > maxHPx + BAND_EPS) break;
    acc += h;
    bottomRow = r;
  }
  if (bottomRow < topRow) return null;
  return { heightPx: acc, bottomRow };
}

/**
 * Excel-like paper tiling aligned to column/row bands (native PDFMetrics).
 */
export function* iteratePaperTileBands(args) {
  const {
    colPx,
    rowPx,
    lastCol,
    lastRow,
    maxWPx,
    maxHPx,
    pageOrder = 0,
  } = args;
  if (lastCol < 1 || lastRow < 1 || !(maxWPx > 0) || !(maxHPx > 0)) {
    return;
  }
  if (pageOrder === 1) {
    for (let tr = 1; tr <= lastRow; ) {
      const rb = computeRowBandPx(rowPx, tr, lastRow, maxHPx);
      if (!rb) break;
      const { heightPx, bottomRow } = rb;
      for (let lc = 1; lc <= lastCol; ) {
        const cb = computeColBandPx(colPx, lc, lastCol, maxWPx);
        if (!cb) break;
        yield {
          topRow: tr,
          leftCol: lc,
          viewWPx: cb.widthPx,
          viewHPx: heightPx,
          bottomRow,
          rightCol: cb.rightCol,
        };
        lc = cb.rightCol + 1;
      }
      tr = bottomRow + 1;
    }
  } else {
    for (let lc = 1; lc <= lastCol; ) {
      const cb = computeColBandPx(colPx, lc, lastCol, maxWPx);
      if (!cb) break;
      for (let tr = 1; tr <= lastRow; ) {
        const rb = computeRowBandPx(rowPx, tr, lastRow, maxHPx);
        if (!rb) break;
        yield {
          topRow: tr,
          leftCol: lc,
          viewWPx: cb.widthPx,
          viewHPx: rb.heightPx,
          bottomRow: rb.bottomRow,
          rightCol: cb.rightCol,
        };
        tr = rb.bottomRow + 1;
      }
      lc = cb.rightCol + 1;
    }
  }
}

export function clampPaperTileAxesToUsedRange(axisLastCol, axisLastRow, brIdx) {
  let lastCol = axisLastCol;
  let lastRow = axisLastRow;
  if (brIdx && brIdx.c >= 1) lastCol = Math.min(lastCol, brIdx.c);
  if (brIdx && brIdx.r >= 1) lastRow = Math.min(lastRow, brIdx.r);
  return { lastCol, lastRow };
}

export function sheetPixelOriginForBand(colPx, rowPx, leftCol, topRow) {
  let diffX = 0;
  for (let c = 1; c < leftCol; c++) diffX += colPx.get(c) ?? 0;
  let diffY = 0;
  for (let r = 1; r < topRow; r++) diffY += rowPx.get(r) ?? 0;
  return { diffX, diffY };
}

/**
 * Build export tiles on column/row bands (not arbitrary pixel slices).
 */
export function buildPaperExportTiles(probeView, brIdx, pageW, pageH, pageOrder = 0) {
  const { colPx, rowPx, lastCol: lc0, lastRow: lr0 } = buildAxisPixelMapsFromJsonView(probeView);
  const { lastCol, lastRow } = clampPaperTileAxesToUsedRange(lc0, lr0, brIdx);
  /** @type {{ topRow: number, leftCol: number, viewW: number, viewH: number, diffX: number, diffY: number }[]} */
  const tiles = [];
  for (const band of iteratePaperTileBands({
    colPx,
    rowPx,
    lastCol,
    lastRow,
    maxWPx: pageW,
    maxHPx: pageH,
    pageOrder,
  })) {
    const origin = sheetPixelOriginForBand(colPx, rowPx, band.leftCol, band.topRow);
    tiles.push({
      topRow: band.topRow,
      leftCol: band.leftCol,
      viewW: band.viewWPx,
      viewH: band.viewHPx,
      diffX: origin.diffX,
      diffY: origin.diffY,
    });
  }
  return tiles;
}
