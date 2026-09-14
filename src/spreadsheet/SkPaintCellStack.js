//=============================================================================
// Shared JsonView cell paint stack — same order as SkSpGridCanvas.paintCellStack:
//   1. backgrounds (+ conditional formatting)
//   2. text / cell ink
//   3. borders
//   4. overflowing text (clip_l / clip_r / c__l / c__r) on top of neighbor edges
//   5. optional table filter affordances
// Cell-class widgets (sparklines, charts) are painted afterward by paintCellClassInk
// (equivalent to SkSpGridPanel / SkSpFloatingLayer overlays above the grid canvas).
//=============================================================================

import {
  sheetColFromColumn,
  drawFilterButton,
  filterButtonRect,
  isTableFilterEligible,
  isFilterButtonHidden,
  FILTER_BTN_PAD,
} from "./SkTableFilter.js";

/** True when the JsonView cell carries a real value (not an empty formatted neighbor). */
function jsonViewCellHasContent(cell) {
  if (cell == null || typeof cell !== "object") return false;
  if (cell.c__l === true || cell.c__r === true) return false;
  const t = cell.c_t;
  if (t == null || t === "n") return false;
  if (!Object.prototype.hasOwnProperty.call(cell, "c_v")) return false;
  if (cell.c_v == null) return false;
  if (t === "s" && String(cell.c_v).length === 0) return false;
  return true;
}

/**
 * Excel General: numbers/dates spill left, not right. A clip_r on column I
 * would hide J's adjacency border-left (Excel stored that edge as I's right).
 * Explicit left align (f_ah === 2) still spills right.
 */
function jsonViewCellSpillsRight(cell) {
  if (!jsonViewCellHasContent(cell)) return false;
  const ah = Number(cell.f_ah);
  if (ah === 2) return true;
  if (ah === 3 || ah === 4) return false;
  const t = cell.c_t;
  if (t === "i" || t === "d" || t === "da" || t === "b") return false;
  return true;
}

/**
 * Left edge of the first empty cell past the immediate neighbor that carries
 * border-left (amount-column wall G after B10 "Immobilisations…"). WASM
 * clip_r used to walk those empty G–J cells; cap painting/hiding here.
 */
function firstRightOverflowWallX(rowCells, srcC) {
  let wall = Infinity;
  if (!Array.isArray(rowCells) || !Number.isFinite(srcC)) return wall;
  for (const cell of rowCells) {
    if (cell == null || typeof cell !== "object") continue;
    const c = Number(cell.c_c);
    const x = Number(cell.c_x);
    if (!Number.isFinite(c) || !Number.isFinite(x)) continue;
    if (c <= srcC) continue;
    if (c === srcC + 1) continue;
    if (jsonViewCellHasContent(cell)) {
      wall = Math.min(wall, x);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(cell, "f_bol")) {
      wall = Math.min(wall, x);
    }
  }
  return wall;
}

/**
 * clip_r of cells that spill to the right, keyed by 1-based row.
 * Used to drop the empty *next* column's border-left (adjacency: source
 * border-right → neighbor border-left) — not every empty cell under the spill,
 * or the table's outer left/top edges disappear (ACTIF column F / row hairlines).
 */
function collectOverflowClipRightByRow(rows, ctx, cellCanvas) {
  const byRow = new Map();
  const canMeasure =
    ctx != null &&
    cellCanvas != null &&
    typeof cellCanvas.textFitsInCellWidth === "function";
  for (const row of rows) {
    const cells = Array.isArray(row?.cells) ? row.cells : [];
    for (const cell of cells) {
      if (!jsonViewCellSpillsRight(cell)) continue;
      if (canMeasure && cellCanvas.textFitsInCellWidth(ctx, cell)) continue;
      if (!Object.prototype.hasOwnProperty.call(cell, "clip_r")) continue;
      const clipR = Number(cell.clip_r);
      const x = Number(cell.c_x);
      const w = Number(cell.c_w);
      const r = Number(cell.c_r);
      const c = Number(cell.c_c);
      if (
        !Number.isFinite(clipR) ||
        !Number.isFinite(x) ||
        !Number.isFinite(w) ||
        !Number.isFinite(r) ||
        !Number.isFinite(c)
      ) {
        continue;
      }
      if (clipR <= x + w + 0.5) continue;
      const wallX = firstRightOverflowWallX(cells, c);
      const cappedClipR =
        Number.isFinite(wallX) && wallX < clipR ? wallX : clipR;
      if (!byRow.has(r)) byRow.set(r, []);
      byRow.get(r).push({ c, clipR: cappedClipR, right: x + w });
    }
  }
  return byRow;
}

/**
 * Only the immediate right neighbor of an overflowing cell — that is the
 * projected C|D cutter through "Terrains", not B/F table-frame borders.
 */
function cellLeftBorderHiddenByOverflow(cell, overflowByRow) {
  if (cell == null || !Object.prototype.hasOwnProperty.call(cell, "f_bol")) {
    return false;
  }
  if (jsonViewCellHasContent(cell)) return false;
  const r = Number(cell.c_r);
  const c = Number(cell.c_c);
  const x = Number(cell.c_x);
  if (!Number.isFinite(r) || !Number.isFinite(c) || !Number.isFinite(x)) {
    return false;
  }
  const srcs = overflowByRow.get(r);
  if (!srcs) return false;
  for (const src of srcs) {
    if (c !== src.c + 1) continue;
    if (Math.abs(src.right - x) > 2) continue;
    if (src.clipR > x + 0.5) return true;
  }
  return false;
}

function withoutLeftBorder(cell) {
  const copy = { ...cell };
  delete copy.f_bol;
  return copy;
}

/** True when JsonView extended this cell's ink past its own box (Excel overflow). */
function cellHasHorizontalOverflowInk(cell, ctx, cellCanvas) {
  if (cell == null || typeof cell !== "object") return false;
  if (
    Object.prototype.hasOwnProperty.call(cell, "c__l") ||
    Object.prototype.hasOwnProperty.call(cell, "c__r")
  ) {
    return true;
  }
  const x = Number(cell.c_x);
  const w = Number(cell.c_w);
  if (!Number.isFinite(x) || !Number.isFinite(w)) return false;
  if (Object.prototype.hasOwnProperty.call(cell, "clip_l")) {
    const clipL = Number(cell.clip_l);
    if (Number.isFinite(clipL) && clipL < x - 0.5) return true;
  }
  // Right spill is for labels, not General-aligned numbers (those sit on
  // the I|J edge and would overdraw J's border-left in pass D).
  if (!jsonViewCellSpillsRight(cell)) return false;
  if (
    ctx != null &&
    cellCanvas != null &&
    typeof cellCanvas.textFitsInCellWidth === "function" &&
    cellCanvas.textFitsInCellWidth(ctx, cell)
  ) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(cell, "clip_r")) {
    const clipR = Number(cell.clip_r);
    if (Number.isFinite(clipR) && clipR > x + w + 0.5) return true;
  }
  return false;
}

/**
 * Smallest positive row.s in a JsonView; used for freeze-seam merge fill heuristic.
 * @param {object} sUI
 */
function minPositiveRowSFromUi(sUI) {
  let m = Infinity;
  if (sUI && Array.isArray(sUI.rows)) {
    for (const r of sUI.rows) {
      const s = Number(r.s);
      if (s > 0) m = Math.min(m, s);
    }
  }
  return Number.isFinite(m) ? m : 18;
}

/**
 * Walk every table header cell that carries a filter button, with its painted rect.
 * @param {object} uiView
 * @param {object} spInterface
 * @param {number} xOff
 * @param {number} yOff
 * @param {(cellRect: object, column: object, row: number, sheetCol: number) => void} fn
 */
function forEachFilterHeaderCell(uiView, spInterface, xOff, yOff, fn) {
  const wTables = spInterface?.m_TableFilterTables;
  if (!Array.isArray(wTables) || wTables.length === 0) return;
  for (const wTable of wTables) {
    if (!isTableFilterEligible(wTable)) continue;
    for (const wCol of wTable.data.columns || []) {
      if (isFilterButtonHidden(wCol)) continue;
      const wRow = wTable.headerRow;
      const wSheetCol = sheetColFromColumn(wCol, wTable.range);
      const wCellRect = spInterface._getFilterHeaderCellRectSync(
        uiView,
        wRow,
        wSheetCol,
        xOff,
        yOff,
      );
      if (wCellRect == null) continue;
      fn(wCellRect, wCol, wRow, wSheetCol);
    }
  }
}

/**
 * Reserve the dropdown gutter on header cells before the text pass. Excel shrinks
 * the header text area by the button width; without this the label is laid out on
 * the full cell width and the button is then painted over its last glyphs
 * ("Capital" showing as "Capita").
 * @param {object} uiView
 * @param {object} spInterface
 * @param {number} xOff
 * @param {number} yOff
 */
function reserveTableFilterGutters(uiView, spInterface, xOff, yOff) {
  if (uiView == null || spInterface?._getCellFromUi == null) return;
  // Release the previous pass' reserves: a hidden or removed button must give
  // its gutter back even when the same JsonView object is repainted.
  for (const wPrev of uiView.__skFilterGutterCells || []) {
    delete wPrev.c_fbw;
  }
  /** @type {object[]} */
  const wStamped = [];
  forEachFilterHeaderCell(
    uiView,
    spInterface,
    xOff,
    yOff,
    (wCellRect, wCol, wRow, wSheetCol) => {
      const wBtn = filterButtonRect(wCellRect);
      if (wBtn == null) return;
      const wCell = spInterface._getCellFromUi(uiView, wRow, wSheetCol);
      if (wCell == null || typeof wCell !== "object") return;
      wCell.c_fbw = wBtn.Width + FILTER_BTN_PAD * 2;
      wStamped.push(wCell);
    },
  );
  uiView.__skFilterGutterCells = wStamped;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} uiView
 * @param {object} spInterface
 * @param {number} xOff
 * @param {number} yOff
 */
function paintTableFilterButtons(ctx, uiView, spInterface, xOff, yOff) {
  forEachFilterHeaderCell(uiView, spInterface, xOff, yOff, (wCellRect, wCol) => {
    const wActive =
      (wCol.filterop && wCol.filterop !== "None") ||
      (wCol.order && wCol.order !== "None");
    drawFilterButton(ctx, wCellRect, wActive);
  });
}

/**
 * Merge fills on paginated tiles: anchor cell may be off-tile; JsonView merges[] has viewport px rects.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} uiView
 * @param {object | null} spInterface
 */
/**
 * Resolve merge anchor backgrounds when anchor is off-tile (async WASM merge walk).
 * @param {object} uiView
 * @param {object | null} spInterface
 */
export async function resolveMergeBackgroundColors(uiView, spInterface) {
  const merges = uiView?.merges;
  if (!Array.isArray(merges) || merges.length === 0) return;
  if (spInterface?.resolveJsonViewBackgroundColor == null) return;

  for (const m of merges) {
    const rt = Number(m.r_t);
    const rl = Number(m.r_l);
    if (!Number.isFinite(rt) || !Number.isFinite(rl)) continue;

    let bg = null;
    for (const wRow of uiView.rows || []) {
      const cells = Array.isArray(wRow?.cells) ? wRow.cells : [];
      for (const wCell of cells) {
        const cr = Number(wCell.c_r);
        const cc = Number(wCell.c_c);
        if (!wCell.f_bc) continue;
        if (cr === rt && cc === rl) {
          bg = wCell.f_bc;
          break;
        }
        if (
          wCell.c_mg === true &&
          cr >= rt &&
          cr <= Number(m.r_b) &&
          cc >= rl &&
          cc <= Number(m.r_r)
        ) {
          bg = wCell.f_bc;
          break;
        }
      }
      if (bg) break;
    }
    if (!bg && spInterface.getJsonViewBackgroundColorSync) {
      bg = spInterface.getJsonViewBackgroundColorSync(rt, rl);
    }
    if (!bg) {
      bg = await spInterface.resolveJsonViewBackgroundColor(rt, rl);
    }
    if (bg) {
      m._pdf_bg = bg;
    }
  }
}

function findMergeAnchorCell(uiView, rt, rl) {
  for (const row of uiView?.rows || []) {
    for (const cell of row?.cells || []) {
      if (Number(cell.c_r) === rt && Number(cell.c_c) === rl) {
        return cell;
      }
    }
  }
  return null;
}

/**
 * Stroke full merge outline from JsonView merges[] (p_l/p_t/p_w/p_h).
 * Per-cell coalesced borders use viewport slices (c_w) and miss outer merge edges on tiles.
 */
function paintMergeBordersFromJsonView(ctx, uiView, cellCanvas, spInterface) {
  const merges = uiView?.merges;
  if (!Array.isArray(merges) || merges.length === 0) return;

  for (const m of merges) {
    const pl = Number(m.p_l);
    const pt = Number(m.p_t);
    const pw = Number(m.p_w);
    const ph = Number(m.p_h);
    if (!(pw > 1) || !(ph > 1)) continue;

    const rt = Number(m.r_t);
    const rl = Number(m.r_l);
    let anchor = findMergeAnchorCell(uiView, rt, rl);
    if (anchor == null && m._pdf_anchor != null) {
      anchor = m._pdf_anchor;
    }
    if (anchor == null) {
      for (const row of uiView.rows || []) {
        for (const cell of row?.cells || []) {
          if (cell.c_mg !== true) continue;
          const cr = Number(cell.c_r);
          const cc = Number(cell.c_c);
          if (cr >= rt && cr <= Number(m.r_b) && cc >= rl && cc <= Number(m.r_r)) {
            if (cell.f_bo || cell.f_bol || cell.f_bot || cell.f_bor || cell.f_bob) {
              anchor = cell;
              break;
            }
          }
        }
        if (anchor) break;
      }
    }
    if (anchor == null) continue;

    const box = { x: pl, y: pt, w: pw, h: ph };
    if (anchor.f_bo) {
      cellCanvas.drawSingleBorderOnBox(ctx, box, 0, anchor.f_bo, 0, pl);
      continue;
    }
    if (anchor.f_bol) {
      cellCanvas.drawSingleBorderOnBox(ctx, box, 1, anchor.f_bol, 0, pt);
    }
    if (anchor.f_bot) {
      cellCanvas.drawSingleBorderOnBox(ctx, box, 2, anchor.f_bot, 0, pl);
    }
    if (anchor.f_bor) {
      cellCanvas.drawSingleBorderOnBox(ctx, box, 3, anchor.f_bor, 0, pt);
    }
    if (anchor.f_bob) {
      cellCanvas.drawSingleBorderOnBox(ctx, box, 4, anchor.f_bob, 0, pl);
    }
  }
}

/** One pass over viewport cells — avoids O(merges × rows × cells) on large sheets. */
function buildBackgroundColorBySheetCell(uiView) {
  /** @type {Map<string, string>} */
  const bgByRc = new Map();
  for (const wRow of uiView?.rows || []) {
    const cells = Array.isArray(wRow?.cells) ? wRow.cells : [];
    for (const wCell of cells) {
      if (wCell == null || !wCell.f_bc) continue;
      const cr = Number(wCell.c_r);
      const cc = Number(wCell.c_c);
      if (!Number.isFinite(cr) || !Number.isFinite(cc)) continue;
      bgByRc.set(`${cr},${cc}`, wCell.f_bc);
    }
  }
  return bgByRc;
}

function mergeBackgroundFromMap(bgByRc, rt, rl, rb, rr) {
  const anchor = bgByRc.get(`${rt},${rl}`);
  if (anchor) return anchor;
  for (let rr_i = rt; rr_i <= rb; rr_i++) {
    for (let cc_i = rl; cc_i <= rr; cc_i++) {
      const bg = bgByRc.get(`${rr_i},${cc_i}`);
      if (bg) return bg;
    }
  }
  return null;
}

function paintMergeBackgroundsFromJsonView(ctx, uiView, spInterface) {
  const merges = uiView?.merges;
  if (!Array.isArray(merges) || merges.length === 0) return;

  const bgByRc = buildBackgroundColorBySheetCell(uiView);

  for (const m of merges) {
    const pl = Number(m.p_l);
    const pt = Number(m.p_t);
    const pw = Number(m.p_w);
    const ph = Number(m.p_h);
    if (!(pw > 0) || !(ph > 0)) continue;

    const rt = Number(m.r_t);
    const rl = Number(m.r_l);
    const rb = Number(m.r_b);
    const rr = Number(m.r_r);

    let bg = mergeBackgroundFromMap(bgByRc, rt, rl, rb, rr);
    if (!bg && typeof m._pdf_bg === "string") {
      bg = m._pdf_bg;
    }
    if (!bg && spInterface?.getJsonViewBackgroundColorSync) {
      bg = spInterface.getJsonViewBackgroundColorSync(rt, rl);
    }
    if (!bg) continue;

    ctx.save();
    ctx.fillStyle = bg;
    ctx.fillRect(pl, pt, pw, ph);
    ctx.restore();
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} uiView
 * @param {object} cellCanvas — SkSpCellCanvas instance
 * @param {{
 *   rowFreezeSeamMode?: "off" | "frozenRowBandY0",
 *   frozenPixH?: number,
 *   isFrozenSplitActive?: boolean,
 *   spInterface?: object | null,
 * }} [options]
 */
export function paintCellStack(ctx, uiView, cellCanvas, options = {}) {
  const rowFreezeSeamMode = options.rowFreezeSeamMode ?? "off";
  const frozenPixH = Number(options.frozenPixH) || 0;
  const isFrozenSplitActive = options.isFrozenSplitActive === true;
  const spInterface = options.spInterface ?? null;

  const rowFreezeSeamY =
    rowFreezeSeamMode === "frozenRowBandY0" && isFrozenSplitActive
      ? Math.ceil(frozenPixH)
      : 0;
  const minRowS = minPositiveRowSFromUi(uiView);
  const bgOptsBase = rowFreezeSeamY > 0 ? { rowFreezeSeamY, minRowS } : null;

  const rows = Array.isArray(uiView?.rows) ? uiView.rows : [];
  cellCanvas.beginFontPaintPass();
  ctx.save();
  try {
    paintMergeBackgroundsFromJsonView(ctx, uiView, spInterface);
    // Pass A — backgrounds
    for (const wRow of rows) {
      const cells = Array.isArray(wRow?.cells) ? wRow.cells : [];
      const rowS = Number(wRow.s) || 0;
      for (const wCell of cells) {
        if (wCell == null || typeof wCell !== "object") continue;
        // Spill proxies (c__l / c__r) are text ink — column f_bc comes from viewport cells.
        if (
          Object.prototype.hasOwnProperty.call(wCell, "c__l") ||
          Object.prototype.hasOwnProperty.call(wCell, "c__r")
        ) {
          continue;
        }
        /** @type {Record<string, unknown>} */
        const bgOpts = { ...(bgOptsBase ?? {}) };
        if (rowS > 0) {
          bgOpts.rowS = rowS;
        }
        if (spInterface != null) {
          bgOpts.spInterface = spInterface;
        }
        cellCanvas.DrawBackground(
          ctx,
          wCell,
          Object.keys(bgOpts).length > 0 ? bgOpts : null,
        );
      }
    }
    if (spInterface != null) {
      reserveTableFilterGutters(uiView, spInterface, 0, 0);
    }
    // Pass B — foreground text (+ IconSets from c_cf on the CF cell, e.g. column F / Écart)
    for (const wRow of rows) {
      const cells = Array.isArray(wRow?.cells) ? wRow.cells : [];
      for (const wCell of cells) {
        if (wCell == null || typeof wCell !== "object") continue;
        cellCanvas.DrawCell(ctx, wCell);
      }
    }
    // Pass C — borders (coalesced strokes for merges / table edges)
    const overflowByRow = collectOverflowClipRightByRow(rows, ctx, cellCanvas);
    /** @type {object[]} */
    const borderCells = [];
    for (const wRow of rows) {
      const cells = Array.isArray(wRow?.cells) ? wRow.cells : [];
      for (const wCell of cells) {
        if (wCell == null || typeof wCell !== "object") continue;
        if (Object.prototype.hasOwnProperty.call(wCell, "c__l")) {
          continue;
        }
        // Merge anchor uses merges[] outline — c_w is a viewport slice.
        if (wCell.c_mg === true) continue;
        // Excel overflow crosses empty neighbors; Sker stored the source right
        // edge as the next cell's border-left — do not stroke it under the label.
        if (cellLeftBorderHiddenByOverflow(wCell, overflowByRow)) {
          borderCells.push(withoutLeftBorder(wCell));
          continue;
        }
        borderCells.push(wCell);
      }
    }
    cellCanvas.DrawBordersCoalesced(ctx, borderCells);
    paintMergeBordersFromJsonView(ctx, uiView, cellCanvas, spInterface);
    // Pass D — Excel paints spilled labels above a thin vertical edge that lives
    // on the empty neighbor (adjacency model: source border-right → neighbor
    // border-left). Without this pass the edge clips "Terrains" after the first letter.
    for (const wRow of rows) {
      const cells = Array.isArray(wRow?.cells) ? wRow.cells : [];
      for (const wCell of cells) {
        if (wCell == null || typeof wCell !== "object") continue;
        if (!cellHasHorizontalOverflowInk(wCell, ctx, cellCanvas)) continue;
        const c = Number(wCell.c_c);
        const clipR = Number(wCell.clip_r);
        const wallX = firstRightOverflowWallX(cells, c);
        if (
          Number.isFinite(clipR) &&
          Number.isFinite(wallX) &&
          wallX < clipR
        ) {
          cellCanvas.DrawCell(ctx, { ...wCell, clip_r: wallX });
          continue;
        }
        cellCanvas.DrawCell(ctx, wCell);
      }
    }
    if (spInterface != null) {
      paintTableFilterButtons(ctx, uiView, spInterface, 0, 0);
    }
  } finally {
    ctx.restore();
  }
}
