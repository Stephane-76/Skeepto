//=============================================================================
// SkSpTreeViewPaint — shared outline drawing for LeftPanel / TopPanel
// File-explorer style: solid carets + leaf dots + indentation (no rails).
//=============================================================================

const DEEP_STEP = 22;
const SYMBOL_SIZE = 20;
const CARET_COLOR = "#555555";
const LEAF_COLOR = "#888888";
const PAD = 8;

/**
 * Solid disclosure triangle (Finder / sidebar style).
 * Closed → points right; open → points down.
 */
function drawCaret(sContext, sX, sY, sIsOpen, sSize = SYMBOL_SIZE) {
  sContext.beginPath();
  sContext.fillStyle = CARET_COLOR;
  if (sIsOpen) {
    const w = sSize * 0.55;
    const h = sSize * 0.42;
    sContext.moveTo(sX - w, sY - h * 0.25);
    sContext.lineTo(sX + w, sY - h * 0.25);
    sContext.lineTo(sX, sY + h * 0.75);
  } else {
    const w = sSize * 0.42;
    const h = sSize * 0.55;
    sContext.moveTo(sX - w * 0.25, sY - h);
    sContext.lineTo(sX + w * 0.75, sY);
    sContext.lineTo(sX - w * 0.25, sY + h);
  }
  sContext.closePath();
  sContext.fill();
}

/** Small bullet for leaf / child nodes (no disclosure caret). */
function drawLeafDot(sContext, sX, sY, sSize = SYMBOL_SIZE) {
  const r = Math.max(1.5, sSize * 0.18);
  sContext.beginPath();
  sContext.fillStyle = LEAF_COLOR;
  sContext.arc(sX, sY, r, 0, Math.PI * 2);
  sContext.fill();
}

function nodeAnchorX(sDeep) {
  return PAD + sDeep * DEEP_STEP + SYMBOL_SIZE / 2;
}

function nodeAnchorY(sDeep) {
  return PAD + sDeep * DEEP_STEP + SYMBOL_SIZE / 2;
}

/**
 * Paint the row outline gutter (vertical tree).
 * @param {CanvasRenderingContext2D} sContext
 * @param {Array} sRows JsonView rows ({ i, s, d?, c?, o? })
 * @param {number} sTreeViewTop Y origin of the row band
 * @param {number} sOffsetY scroll/frozen dY
 * @param {number} sBandWidth width of the outline band in CSS px
 */
export function drawTreeViewLeft(sContext, sRows, sTreeViewTop, sOffsetY, sBandWidth) {
  const maxX = Math.max(0, (Number(sBandWidth) || 0) - 0.5);

  sContext.save();
  sContext.beginPath();
  sContext.rect(0, sTreeViewTop, maxX + 0.5, 1e6);
  sContext.clip();

  let currentY = sTreeViewTop + sOffsetY;
  (sRows || []).forEach((row) => {
    const h = Number(row.s) || 0;
    if (h <= 0) {
      currentY += h;
      return;
    }
    const deep = Math.max(0, Number(row.d) || 0);
    const hasChildren = Object.prototype.hasOwnProperty.call(row, "c");
    const isOpen = !Object.prototype.hasOwnProperty.call(row, "o");
    const centerY = currentY + h / 2;
    const cx = nodeAnchorX(deep);

    if (cx <= maxX) {
      if (hasChildren) {
        drawCaret(sContext, cx, centerY, isOpen);
      } else if (deep > 0) {
        // Child / leaf nodes: keep a visible mark at their indent level.
        drawLeafDot(sContext, cx, centerY);
      }
    }
    currentY += h;
  });
  sContext.restore();
}

/**
 * Paint the column outline gutter (horizontal tree).
 * @param {CanvasRenderingContext2D} sContext
 * @param {Array} sCols JsonView cols ({ i, s, d?, c?, o? })
 * @param {number} sTreeViewLeft X origin of the column band
 * @param {number} sOffsetX scroll/frozen dX
 * @param {number} sBandHeight height of the outline band in CSS px
 */
export function drawTreeViewTop(sContext, sCols, sTreeViewLeft, sOffsetX, sBandHeight) {
  const maxY = Math.max(0, (Number(sBandHeight) || 0) - 0.5);

  sContext.save();
  sContext.beginPath();
  sContext.rect(sTreeViewLeft, 0, 1e6, maxY + 0.5);
  sContext.clip();

  let currentX = sTreeViewLeft + sOffsetX;
  (sCols || []).forEach((col) => {
    const w = Number(col.s) || 0;
    if (w <= 0) {
      currentX += w;
      return;
    }
    const deep = Math.max(0, Number(col.d) || 0);
    const hasChildren = Object.prototype.hasOwnProperty.call(col, "c");
    const isOpen = !Object.prototype.hasOwnProperty.call(col, "o");
    const centerX = currentX + w / 2;
    const cy = nodeAnchorY(deep);

    if (cy <= maxY) {
      if (hasChildren) {
        drawCaret(sContext, centerX, cy, isOpen);
      } else if (deep > 0) {
        drawLeafDot(sContext, centerX, cy);
      }
    }
    currentX += w;
  });
  sContext.restore();
}

export const SK_TREE_BAND_DEFAULT = 75;
export const SK_TREE_BAND_MIN = 30;
export const SK_TREE_BAND_MAX = 220;
export const SK_BASE_LEFT_SIZE = 60;
export const SK_BASE_TOP_SIZE = 30;
export const SK_TREE_VIEW_COLOR = "rgb(237, 237, 237)";
