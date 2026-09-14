//=============================================================================
// SkSpCellCanvas
// SpreadSheet Cell 
//=============================================================================
import './SkSpreadSheet.css'
import { DrawTextWithAlignment, GetFontWeight, drawIconSetsAlignedToCellText, measureIconSetBlockWidthPx, renderConditionalFormattingDataBars, splitCellTextLines, strikeLineYTopBaseline, underlineLineYTopBaseline } from '../utility/SkUtility.js'
import { applyCanvasFontFromCell, createFontPaintState, fontSizePtFromCell, fontSizeCssPxFromPt } from '../utility/SkFontPool.js'
import { jsonViewCellDisplayText } from '../utility/jsonViewCellText.js'

/** Line step ratio for wrapped strings (inter-line leading; Excel-like ~120%). */
const WRAPPED_STRING_LINE_STEP_RATIO = 1.22;

/** Minimum scale on font size for vertical layout (centering, stacked text); lower = tighter in tall rows. */
const CELL_TEXT_MIN_INK_SCALE = 1.04;

/**
 * Render exponent digits as Unicode superscript (e.g. m², m³, s⁻¹).
 */
function digitsToSuperscriptUnicode(n) {
  const map = {
    '0': '\u2070',
    '1': '\u00B9',
    '2': '\u00B2',
    '3': '\u00B3',
    '4': '\u2074',
    '5': '\u2075',
    '6': '\u2076',
    '7': '\u2077',
    '8': '\u2078',
    '9': '\u2079',
    '-': '\u207B'
  };
  return String(n)
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('');
}

/**
 * Read unit exponent from JSON: SkCellClassUnit::JsonJavaScript uses "p" / "fp";
 * tClassUnit::Json uses "pw" for the same field — accept both (merged payloads).
 * Engine may emit explicit p:1 for L/M/T units (linear dimension); absence still means 1.
 */
function unitExponentFromJson(c, primaryKey, alternateKey) {
  if (c == null || typeof c !== 'object') {
    return 1;
  }
  let raw;
  if (Object.prototype.hasOwnProperty.call(c, primaryKey)) {
    raw = c[primaryKey];
  } else if (Object.prototype.hasOwnProperty.call(c, alternateKey)) {
    raw = c[alternateKey];
  } else {
    return 1;
  }
  if (raw === null || raw === '') {
    return 1;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : 1;
}

/**
 * Unit suffix for tCellUnit JavaScript JSON (SkCellClassUnit::JsonJavaScript): u, p, fu, fp;
 * mirrors C++ tClassUnit::Str() with superscript exponents for display.
 */
function cellUnitSuffixFromJson(c) {
  if (!c || typeof c !== 'object') {
    return '';
  }
  if (c.hasOwnProperty('e')) {
    return ' ' + (c.se != null && c.se !== '' ? c.se : '');
  }
  let s = ' ' + (c.u != null ? c.u : '');
  const pNum = unitExponentFromJson(c, 'p', 'pw');
  if (pNum !== 1) {
    s += digitsToSuperscriptUnicode(pNum);
  }
  if (c.hasOwnProperty('fu')) {
    s += '/' + c.fu;
    const fpNum = unitExponentFromJson(c, 'fp', 'fpw');
    if (fpNum !== 1) {
      s += digitsToSuperscriptUnicode(fpNum);
    }
  }
  return s;
}

/**
 * Advance width from measureText() is often narrower than painted ink (currency symbols).
 * Inset text horizontally inside the padded content box so glyphs are not clipped at cell edges.
 * @param {number} fontSizePt
 * @param {number} contentWidthPx
 */
function horizontalGlyphPadPx(fontSizePt, contentWidthPx) {
  if (!(contentWidthPx > 0)) return 0;
  const minFromFont = Math.max(1, fontSizePt * 0.1);
  return Math.min(contentWidthPx / 5, minFromFont * 1.6);
}

/**
 * Canvas JsonView padding: f_p is the 4-side default; f_pl / f_pr override one side (Excel indent).
 */
function cellPadPx(sCell, key, fallback) {
  if (sCell && Object.prototype.hasOwnProperty.call(sCell, key)) {
    const n = Number(sCell[key]);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** Some fonts (e.g. Times New Roman at small sizes) return bogus measureText ink boxes. */
function inkCoreHeightPx(rawCore, fontSizeCssPx) {
  const maxReasonable = Math.max(fontSizeCssPx * 2.5, 6);
  if (!Number.isFinite(rawCore) || rawCore <= 0.5 || rawCore > maxReasonable) {
    return fontSizeCssPx * CELL_TEXT_MIN_INK_SCALE;
  }
  return rawCore;
}

/** Vertical text top Y inside the padded inner box; clamps so ink stays visible. */
function textTopYForVerticalAlign(innerTop, innerHeight, layoutHeight, fAv) {
  const layoutH = Math.min(Math.max(1, layoutHeight), Math.max(1, innerHeight));
  let textTopY = innerTop + (innerHeight - layoutH) / 2;
  if (fAv != null) {
    switch (Number(fAv)) {
      case 5:
      case 8: textTopY = innerTop; break;
      case 6:
      case 9: textTopY = innerTop + innerHeight - layoutH; break;
      case 7: textTopY = innerTop + (innerHeight - layoutH) / 2; break;
      default: break;
    }
  }
  return Math.max(innerTop, Math.min(innerTop + innerHeight - layoutH, textTopY));
}

/** Alphabetic ink box from measureText (ctx.textBaseline must be "alphabetic"). */
function alphabeticInkFromMeasure(measure, fontSizeCssPx) {
  let asc = measure.actualBoundingBoxAscent ?? measure.fontBoundingBoxAscent ?? 0;
  let desc = measure.actualBoundingBoxDescent ?? measure.fontBoundingBoxDescent ?? 0;
  const core = inkCoreHeightPx(asc + desc, fontSizeCssPx);
  if (asc <= 0.5) {
    asc = core * 0.78;
  }
  if (desc <= 0.5) {
    desc = Math.max(0.5, core - asc);
  }
  return { asc, desc, core };
}

/** IconSets items for DrawCell — own c_cf (Excel sqref column) or optional _skIconCf override. */
function iconSetsCfFromCell(sCell) {
  if (Array.isArray(sCell?._skIconCf) && sCell._skIconCf.length > 0) {
    return sCell._skIconCf;
  }
  const cf = sCell?.c_cf;
  if (!Array.isArray(cf)) {
    return null;
  }
  const items = cf.filter((it) => it?.type === "IconSets");
  return items.length > 0 ? items : null;
}

/** Excel General horizontal when JsonView omits f_ah: numbers right, text/empty left. */
function excelGeneralHorizontalLeft(sCell, isEmptyDisplay) {
  if (isEmptyDisplay) {
    // Icon-only cells: align like currency values on the right.
    if (iconSetsCfFromCell(sCell)?.length) {
      return false;
    }
    return true;
  }
  const t = sCell.c_t;
  return t !== 'i' && t !== 'd' && t !== 'da';
}

/** Excel default vertical alignment when f_av is omitted (bottom). */
const EXCEL_DEFAULT_F_AV = 9;

/**
 * Draw cell text rotated ~±90° (Excel textRotation 45..135).
 * Local layout: X = line direction (max = cell inner height), Y = stack (max = cell inner width).
 * Excel horizontal align (f_ah) → stack axis (local Y); vertical align (f_av) → line axis (local X).
 */
function drawRotatedNearVerticalCellText(
  ctx,
  {
    text,
    rotateDeg,
    x,
    y,
    width,
    height,
    lineHeight,
    glyphPad,
    textWrapOn,
    alignment,
    verticalAlignCode,
    color,
    underline,
    strikethrough,
    lineInkHeight,
  }
) {
  const pad = Math.max(0, Number(glyphPad) || 0);
  const lineWrapW = Math.max(0, height - 2 * pad);
  const stackLimit = Math.max(0, width - 2 * pad);
  if (lineWrapW <= 0 || stackLimit <= 0 || !text) {
    return;
  }

  const step = Math.max(1, lineHeight);
  const lines = textWrapOn
    ? splitCellTextLines(ctx, text, lineWrapW, true)
    : [text];

  let useLineCount = lines.length;
  let blockStackH = useLineCount * step;
  if (blockStackH > stackLimit) {
    useLineCount = Math.max(1, Math.floor(stackLimit / step));
    blockStackH = useLineCount * step;
  }

  const lineLayouts = [];
  let blockMinX = Infinity;
  let blockMaxX = -Infinity;
  const blockMinY = 0;
  const blockMaxY = blockStackH;

  for (let i = 0; i < useLineCount; i += 1) {
    const line = lines[i];
    const lm = ctx.measureText(line || 'Mg');
    const lineW = lm.width;
    let lineX = 0;

    let asc = lm.actualBoundingBoxAscent ?? lm.fontBoundingBoxAscent ?? 0;
    const desc = lm.actualBoundingBoxDescent ?? lm.fontBoundingBoxDescent ?? 0;
    const core = Math.max(asc + desc, lineInkHeight, 1);
    if (asc <= 0.5) {
      asc = core * 0.78;
    }
    const baselineY = i * step + asc;

    lineLayouts.push({ line, lineX, baselineY, lineW });
    blockMinX = Math.min(blockMinX, lineX);
    blockMaxX = Math.max(blockMaxX, lineX + lineW);
  }

  if (!Number.isFinite(blockMinX)) {
    return;
  }

  const fav = verticalAlignCode ?? EXCEL_DEFAULT_F_AV;

  // Per-line offset along local X (cell height) from f_av.
  blockMinX = Infinity;
  blockMaxX = -Infinity;
  for (const layout of lineLayouts) {
    if (fav === 7) {
      layout.lineX = (lineWrapW - layout.lineW) / 2;
    } else {
      layout.lineX = 0;
    }
    blockMinX = Math.min(blockMinX, layout.lineX);
    blockMaxX = Math.max(blockMaxX, layout.lineX + layout.lineW);
  }

  const blockH = blockMaxY - blockMinY;
  const positiveRotate = rotateDeg >= 0;

  // f_av → block shift along local X (cell height); flip top/bottom for -90°.
  let avShiftX = 0;
  if (fav === 5 || fav === 8) {
    avShiftX = positiveRotate ? lineWrapW - blockMaxX : -blockMinX;
  } else if (fav === 7) {
    avShiftX = 0;
  } else {
    avShiftX = positiveRotate ? -blockMinX : lineWrapW - blockMaxX;
  }

  // f_ah → block shift along local Y (cell width); flip left/right for -90°.
  let ahShiftY = 0;
  if (alignment === 'left') {
    ahShiftY = positiveRotate ? -blockMinY : stackLimit - blockMaxY;
  } else if (alignment === 'center') {
    ahShiftY = (stackLimit - blockH) / 2 - blockMinY;
  } else {
    ahShiftY = positiveRotate ? stackLimit - blockMaxY : -blockMinY;
  }

  const contentCx = x + width / 2;
  const contentCy = y + height / 2;

  ctx.save();
  ctx.fillStyle = color;
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
  ctx.translate(contentCx, contentCy);
  ctx.rotate((-rotateDeg * Math.PI) / 180);
  ctx.translate(-lineWrapW / 2, -stackLimit / 2);

  for (const layout of lineLayouts) {
    const drawX = layout.lineX + avShiftX;
    const drawY = layout.baselineY + ahShiftY;
    ctx.fillText(layout.line, drawX, drawY);
    if (underline) {
      ctx.fillRect(
        drawX,
        underlineLineYTopBaseline(ctx, layout.line, drawY, lineInkHeight),
        layout.lineW,
        1
      );
    }
    if (strikethrough) {
      ctx.fillRect(
        drawX,
        strikeLineYTopBaseline(ctx, layout.line, drawY, lineInkHeight),
        layout.lineW,
        1
      );
    }
  }

  ctx.restore();
}

class SkSpCellCanvas  {

 beginFontPaintPass() {
   this.m_FontPaintState = createFontPaintState();
 }

 GetCellText(sCell) {
    if (sCell.c_t==="c") {
      if (sCell.c_v.n==="tCellUnit") {
        return String(sCell.f_value) + cellUnitSuffixFromJson(sCell.c_v.c);
      }
    }
    return jsonViewCellDisplayText(sCell);
 }

 /**
  * JsonView emits clip_r for any string without border-right, even when the
  * label already fits (Bilan actif B8:B10). Excel only spills when ink is
  * wider than the cell.
  */
 textFitsInCellWidth(sContext, sCell) {
  if (sCell == null || typeof sCell !== "object") return true;
  if (Number(sCell.f_tw) === 2) return true;
  const text = this.GetCellText(sCell);
  if (!text) return true;
  const w = Number(sCell.c_w);
  if (!(w > 0)) return true;
  applyCanvasFontFromCell(sContext, sCell, this.m_FontPaintState);
  const ink = sContext.measureText(String(text)).width;
  let pad = 4;
  if (Object.prototype.hasOwnProperty.call(sCell, "f_p")) {
    const n = Number(sCell.f_p);
    if (Number.isFinite(n)) pad = n;
  }
  let padL = pad;
  let padR = pad;
  if (Object.prototype.hasOwnProperty.call(sCell, "f_pl")) {
    const n = Number(sCell.f_pl);
    if (Number.isFinite(n)) padL = n;
  }
  if (Object.prototype.hasOwnProperty.call(sCell, "f_pr")) {
    const n = Number(sCell.f_pr);
    if (Number.isFinite(n)) padR = n;
  }
  return ink + padL + padR + 1 < w;
 }

 /* En C++ {
  string tBorderCss::BorderStyleStr() {
		switch (m_BorderStyle)	{
			case tBorderStyle::none: return("none");
			case tBorderStyle::hidden: return("hidden");
			case tBorderStyle::dotted: return("dotted");
			case tBorderStyle::dashed: return("dashed");
			case tBorderStyle::solid: return("solid");
			case tBorderStyle::_double: return("double");
			case tBorderStyle::groove: return("groove");
			case tBorderStyle::ridge: return("ridge");
			case tBorderStyle::inset: return("inset");
			case tBorderStyle::outset: return("outset");
            case tBorderStyle::Count:break;
		}
		return("");
	}} */
 returnStyleBorder(sProperty) {
  // Return array for setLineDash() - Canvas 2D API requires array of numbers
  switch(sProperty.s) {
  case 0: return []; // none - solid line
  case 1: return []; // hidden - solid line (same as none)
  case 2: return [2, 2]; // dotted - short dashes
  case 3: return [5, 5]; // dashed - longer dashes
  case 4: return []; // solid - continuous line
  case 5: return []; // double - handled differently, use solid for now
  case 6: return []; // groove - use solid (3D effect would need gradient)
  case 7: return []; // ridge - use solid (3D effect would need gradient)
  case 8: return []; // inset - use solid (3D effect would need gradient)
  case 9: return []; // outset - use solid (3D effect would need gradient)
  default: return [];
  }
 }

 PaintBorder(sContext, sCell, sBorder,sProperty) {
  const isDouble = (sProperty.s === 5); // Double border style
  
  if (isDouble) {
    // For double borders: each line should be thinner with visible gap between them
    const totalWidth = sProperty.w;
    // For better visibility: use 1/3 of width for each line, leaving 1/3 for gap
    const singleLineWidth = Math.max(1, Math.ceil(totalWidth / 3)); // Each line gets 1/3 of width
    const gapWidth = Math.max(1, totalWidth - (singleLineWidth * 2)); // Remaining space for gap
    
    // Create modified property for thinner lines
    const outerProperty = { ...sProperty, w: singleLineWidth };
    const innerProperty = { ...sProperty, w: singleLineWidth };
    const innerOffset = singleLineWidth + gapWidth; // Offset for inner line
    
    if (sBorder === 0) {
      // For "All" borders, draw outer rectangle complete, inner rectangle with shortened corners
      this.drawSingleBorder(sContext, sCell, 0, outerProperty, 0);
      this.drawInnerDoubleBorder(sContext, sCell, innerProperty, innerOffset);
    } else {
      // For individual borders, shorten inner line only at corners where another border exists
      this.drawSingleBorder(sContext, sCell, sBorder, outerProperty, 0);
      this.drawShortenedBorder(sContext, sCell, sBorder, innerProperty, innerOffset, innerOffset);
    }
  } else {
    // Draw single line
    this.drawSingleBorder(sContext, sCell, sBorder, sProperty, 0);
  }
 }

 drawShortenedBorder(sContext, sCell, sBorder, sProperty, offset, shortenBy) {
  // Draw a border line with shortened ends only at corners where another border exists
  sContext.beginPath();
  sContext.strokeStyle = sProperty.c;
  sContext.lineWidth = sProperty.w;
  let wStyle = this.returnStyleBorder(sProperty);
  sContext.setLineDash(wStyle);

  // Check which adjacent borders exist
  const hasLeft = sCell.hasOwnProperty("f_bol");
  const hasTop = sCell.hasOwnProperty("f_bot");
  const hasRight = sCell.hasOwnProperty("f_bor");
  const hasBottom = sCell.hasOwnProperty("f_bob");

  switch(sBorder) {
    case  1 : { // Left - shorten at top only if Top exists, at bottom only if Bottom exists
      const topShorten = hasTop ? shortenBy : 0;
      const bottomShorten = hasBottom ? shortenBy : 0;
      sContext.moveTo(sCell.c_x + offset, sCell.c_y + topShorten);
      sContext.lineTo(sCell.c_x + offset, sCell.c_y + sCell.c_h - bottomShorten);
      break;
    } 
    case  2 : { // Top - shorten at left only if Left exists, at right only if Right exists
      const leftShorten = hasLeft ? shortenBy : 0;
      const rightShorten = hasRight ? shortenBy : 0;
      sContext.moveTo(sCell.c_x + leftShorten, sCell.c_y + offset);
      sContext.lineTo(sCell.c_x + sCell.c_w - rightShorten, sCell.c_y + offset);
      break;
    } 
    case  3 : { // Right - shorten at top only if Top exists, at bottom only if Bottom exists
      const topShorten = hasTop ? shortenBy : 0;
      const bottomShorten = hasBottom ? shortenBy : 0;
      sContext.moveTo(sCell.c_x + sCell.c_w - offset, sCell.c_y + topShorten);
      sContext.lineTo(sCell.c_x + sCell.c_w - offset, sCell.c_y + sCell.c_h - bottomShorten);
      break;
    } 
    case  4 : { // Bottom - shorten at left only if Left exists, at right only if Right exists
      const leftShorten = hasLeft ? shortenBy : 0;
      const rightShorten = hasRight ? shortenBy : 0;
      sContext.moveTo(sCell.c_x + leftShorten, sCell.c_y + sCell.c_h - offset);
      sContext.lineTo(sCell.c_x + sCell.c_w - rightShorten, sCell.c_y + sCell.c_h - offset);
      break;
    } 
    default : break;
  }
  sContext.stroke();
 }

 drawInnerDoubleBorder(sContext, sCell, sProperty, offset) {
  // Draw inner rectangle with shortened corners to avoid overlap
  const shortenBy = offset; // Shorten by the offset amount
  const x1 = sCell.c_x + offset;
  const y1 = sCell.c_y + offset;
  const x2 = sCell.c_x + sCell.c_w - offset;
  const y2 = sCell.c_y + sCell.c_h - offset;
  
  let wStyle = this.returnStyleBorder(sProperty);
  
  // Draw each side separately with shortened ends
  // Left side
  sContext.beginPath();
  sContext.strokeStyle = sProperty.c;
  sContext.lineWidth = sProperty.w;
  sContext.setLineDash(wStyle);
  sContext.moveTo(x1, y1 + shortenBy);
  sContext.lineTo(x1, y2 - shortenBy);
  sContext.stroke();
  
  // Top side
  sContext.beginPath();
  sContext.strokeStyle = sProperty.c;
  sContext.lineWidth = sProperty.w;
  sContext.setLineDash(wStyle);
  sContext.moveTo(x1 + shortenBy, y1);
  sContext.lineTo(x2 - shortenBy, y1);
  sContext.stroke();
  
  // Right side
  sContext.beginPath();
  sContext.strokeStyle = sProperty.c;
  sContext.lineWidth = sProperty.w;
  sContext.setLineDash(wStyle);
  sContext.moveTo(x2, y1 + shortenBy);
  sContext.lineTo(x2, y2 - shortenBy);
  sContext.stroke();
  
  // Bottom side
  sContext.beginPath();
  sContext.strokeStyle = sProperty.c;
  sContext.lineWidth = sProperty.w;
  sContext.setLineDash(wStyle);
  sContext.moveTo(x1 + shortenBy, y2);
  sContext.lineTo(x2 - shortenBy, y2);
  sContext.stroke();
 }

 /**
  * Visible ink box for border strokes — uses JsonView c_x/c_w (viewport slice), not merge text rails (c_ox/c_ax).
  * c_ax is for glyph layout when a merge is clamped left; using it here draws vertical borders mid-cell on scroll.
  * @param {object} sCell
  * @returns {{ x: number, y: number, w: number, h: number } | null}
  */
 cellBorderBox(sCell) {
  let x = Number(sCell.c_x);
  let y = Number(sCell.c_y);
  let w = Number(sCell.c_w);
  let h = Number(sCell.c_h);
  if (!(w > 0) || !(h > 0)) return null;
  if (!Number.isFinite(x)) x = 0;
  if (!Number.isFinite(y)) y = 0;
  return { x, y, w, h };
 }

 mergeInterval1D(intervals) {
  if (intervals.length === 0) return [];
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  const out = [sorted[0].slice()];
  for (let i = 1; i < sorted.length; i++) {
    const [a0, a1] = sorted[i];
    const prev = out[out.length - 1];
    if (a0 <= prev[1] + 1.5) {
      prev[1] = Math.max(prev[1], a1);
    } else {
      out.push([a0, a1]);
    }
  }
  return out;
 }

 /**
  * @param {object} box
  * @param {number} [dashPhaseOrigin]
  */
 drawSingleBorderOnBox(sContext, box, sBorder, sProperty, offset, dashPhaseOrigin = 0) {
  sContext.beginPath();
  sContext.strokeStyle = sProperty.c;
  sContext.lineWidth = sProperty.w;

  const wStyle = this.returnStyleBorder(sProperty);
  sContext.setLineDash(wStyle);
  if (wStyle.length > 0) {
    const period = wStyle.reduce((a, b) => a + b, 0);
    if (period > 0) {
      sContext.lineDashOffset = -((Number(dashPhaseOrigin) || 0) % period);
    }
  }

  const x1 = box.x + offset;
  const y1 = box.y + offset;
  const x2 = box.x + box.w - offset;
  const y2 = box.y + box.h - offset;

  switch (sBorder) {
    case 0: {
      sContext.moveTo(x1, y1);
      sContext.lineTo(x1, y2);
      sContext.lineTo(x2, y2);
      sContext.lineTo(x2, y1);
      sContext.lineTo(x1, y1);
      break;
    }
    case 1:
      sContext.moveTo(x1, y1);
      sContext.lineTo(x1, y2);
      break;
    case 2:
      sContext.moveTo(x1, y1);
      sContext.lineTo(x2, y1);
      break;
    case 3:
      sContext.moveTo(x2, y1);
      sContext.lineTo(x2, y2);
      break;
    case 4:
      sContext.moveTo(x1, y2);
      sContext.lineTo(x2, y2);
      break;
    default:
      break;
  }
  sContext.stroke();
  sContext.setLineDash([]);
  sContext.lineDashOffset = 0;
 }

 drawSingleBorder(sContext, sCell, sBorder, sProperty, offset) {
  const box = this.cellBorderBox(sCell);
  if (box == null) return;
  const phase = sBorder === 2 || sBorder === 4 ? box.x : box.y;
  this.drawSingleBorderOnBox(sContext, box, sBorder, sProperty, offset, phase);
 }

 DrawBackground(sContext,sCell,opts) {
  // Class widgets with co (sparkline, etc.) still need host fill on flat export canvases.
  // Ink is painted separately via paintCellClassInk; DrawCell already skips co widgets.

  const rawX = Number(sCell.c_x) || 0;
  const rawW = Number(sCell.c_w) || 0;
  let drawY = Number(sCell.c_y) || 0;
  let drawH = Number(sCell.c_h) || 0;
  const isLeftSpill = Object.prototype.hasOwnProperty.call(sCell, "c__l");
  const columnLeft = rawX;
  const columnRight = rawX + rawW;

  // Column fill band — clip_l/clip_r may extend for text ink only; never widen past c_w.
  let clipLeft = columnLeft;
  let clipRight = columnRight;
  if (sCell.hasOwnProperty("clip_l")) {
    const clipL = Number(sCell.clip_l);
    if (Number.isFinite(clipL) && clipL > clipLeft) {
      clipLeft = clipL;
    }
  }
  if (sCell.hasOwnProperty("clip_r")) {
    const clipR = Number(sCell.clip_r);
    if (Number.isFinite(clipR) && clipR < clipRight) {
      clipRight = clipR;
    }
  }
  if (isLeftSpill && rawX < 0) {
    clipLeft = Math.max(clipLeft, 0);
  } else if (rawX < 0) {
    // Partial first column after horizontal scroll: c_x < 0 without c__l.
    clipLeft = Math.max(clipLeft, 0);
  }
  let drawX = clipLeft;
  let drawW = Math.max(0, clipRight - clipLeft);

  // Gridline inset: JsonView c_h is often row.s minus bottom border — extend fill to row band.
  if (opts != null) {
    const rowS = Number(opts.rowS);
    if (rowS > 0 && drawH > 0) {
      const gap = rowS - drawH;
      if (gap > 0.05 && gap <= 2.5) {
        drawH = rowS;
      }
    }
  }

  const bgColor = this._resolveBackgroundColorForPaint(sCell, opts);

  // Freeze panes: JsonView clamps merged c_h to viewport while m_FrozenPixH includes grid padding,
  // so fills can stop shy of the canvas seam — extend likely merges by a small gap only.
  if (opts != null && bgColor != null) {
    const seamY = Number(opts.rowFreezeSeamY);
    const minRowS = Number(opts.minRowS) > 0 ? Number(opts.minRowS) : 18;
    const rowS = Number(opts.rowS) || 0;
    if (Number.isFinite(seamY) && seamY > 0 && drawH > 0) {
      const bottom = drawY + drawH;
      const gap = seamY - bottom;
      const likelyMerge =
        drawH >= minRowS * 1.65 || (rowS > 0 && drawH > rowS + 1.5);
      if (likelyMerge && gap > 0.2 && gap < 52 && bottom < seamY) {
        drawH += gap;
      }
    }
  }

  if (!(drawW > 0) || !(drawH > 0)) {
    return;
  }

  if (bgColor != null) {
    // Background color first (conditional-format CSS backgrounds land here too).
    sContext.save();
    sContext.beginPath();
    sContext.fillStyle = bgColor;
    sContext.strokeStyle = "transparent";
    sContext.fillRect(drawX, drawY, drawW, drawH);
    sContext.stroke();
    sContext.restore();
  }

  // DataBars only — IconSets are painted in DrawCell (same ink anchors as text).
  if (sCell.hasOwnProperty("c_cf")) {
    this._paintCfVisualsInCellRect(sContext, sCell, rawX, rawW, renderConditionalFormattingDataBars);
  }

 }

 /** @private Paint IconSets after cell text using DrawCell ink layout. */
 _drawCellIconSetsInk(sContext, sCell, inkLayout) {
  const cf = iconSetsCfFromCell(sCell);
  if (!Array.isArray(cf) || cf.length === 0) {
    return;
  }
  drawIconSetsAlignedToCellText(sContext, cf, inkLayout);
 }

 /** @private Shared JsonView cell rect for CF visuals (DataBars). */
 _paintCfVisualsInCellRect(sContext, sCell, rawX, rawW, paintFn) {
  const logicalX = rawX;
  const logicalY = Number(sCell.c_y) || 0;
  const logicalW = rawW;
  const logicalH = Number(sCell.c_h) || 0;
  if (!(logicalW > 0) || !(logicalH > 0)) {
    return;
  }
  sContext.save();
  const visX0 = Math.max(0, logicalX);
  const visY0 = Math.max(0, logicalY);
  const visX1 = logicalX + logicalW;
  const visY1 = logicalY + logicalH;
  if (visX1 > visX0 && visY1 > visY0) {
    sContext.beginPath();
    sContext.rect(visX0, visY0, visX1 - visX0, visY1 - visY0);
    sContext.clip();
  }
  paintFn(sCell, sContext, {
    x: logicalX,
    y: logicalY,
    width: logicalW,
    height: logicalH,
  });
  sContext.restore();
 }

 /** Resolve f_bc for paint — spill proxies may carry the wrong column format. */
 _resolveBackgroundColorForPaint(sCell, opts) {
  const sp = opts?.spInterface;
  const cr = Math.round(Number(sCell.c_r));
  const cc = Math.round(Number(sCell.c_c));
  const isLeftSpill = Object.prototype.hasOwnProperty.call(sCell, "c__l");

  if (isLeftSpill && sp?.getJsonViewBackgroundColorSync && cr >= 1 && cc >= 1) {
    const spillBg = sp.getJsonViewBackgroundColorSync(cr, cc);
    if (spillBg != null && String(spillBg).trim() !== "") {
      return spillBg;
    }
  }
  if (sCell.hasOwnProperty("f_bc")) {
    const direct = sCell.f_bc;
    if (direct != null && String(direct).trim() !== "") {
      return direct;
    }
  }
  return null;
 }
 

 DrawCell(sContext,sCell) {
  // Class don't draw (Draw with SkCellClass.js)
  // f_Value formated string
  if (sCell.c_t==="c") {
    let wObj=sCell.c_v;
    if (wObj.hasOwnProperty("co")) {
      return;
    }
  }
    
  // Set defalut value ========================================================
  let wCellText = jsonViewCellDisplayText(sCell);
  let wPadding=4;
  let wColor="black"
  
  let wFontWeight=""

  // Padding 
  if (sCell.hasOwnProperty("f_p")) {
    wPadding=sCell.f_p;
  }
 
  
  // Color font
  if (sCell.hasOwnProperty("f_c")) {
    wColor=sCell.f_c; 
  }
 
  // Bold (for textWeight; font string comes from pool)
  if (sCell.hasOwnProperty("f_we")) {
    wFontWeight=GetFontWeight(sCell.f_we); 
  }
  const wFontSizePt = fontSizePtFromCell(sCell, 11);
  const wFontSizeCssPx = fontSizeCssPxFromPt(wFontSizePt);
  // Text rotation: angle in degrees (-90..+90), or special sentinel 255 for
  // Excel-like "vertical stacked text" (letters upright, one per line).
  let wRotate=0;
  let wVertical=false;
  if (sCell.hasOwnProperty("f_tr")) {
    const wTr=Number(sCell.f_tr);
    if (wTr===255) {
      wVertical=true;
    } else if (!Number.isNaN(wTr)) {
      wRotate=wTr;
    }
  }
  // Dense sheets: skip canvas font/measure work when the cell has no ink to draw.
  const wIconCfEarly = iconSetsCfFromCell(sCell);
  const wHasMo =
    sCell.f_mo != null && String(sCell.f_mo).trim() !== "";
  const wIsUnitCell =
    sCell.c_t === "c" && sCell.c_v?.n === "tCellUnit";
  if (
    wCellText.length === 0 &&
    !wHasMo &&
    !wIsUnitCell &&
    (!wIconCfEarly || wIconCfEarly.length === 0) &&
    wRotate === 0 &&
    !wVertical &&
    !sCell.hasOwnProperty("f_d_u") &&
    !sCell.hasOwnProperty("f_d_l")
  ) {
    const cw = Number(sCell.c_w) || 0;
    const ch = Number(sCell.c_h) || 0;
    if (!(cw > 0) || !(ch > 0)) {
      return;
    }
    return;
  }
  /*
  // Exclude zone value in c_v (Value Text of variant)
  if ((sCell.hasOwnProperty("c__l")) || (sCell.hasOwnProperty("c__r"))) {
      wCellText=String(sCell.c_v);
  }
  */
  // Save Context ==============================================================
  sContext.save()

  applyCanvasFontFromCell(sContext, sCell, this.m_FontPaintState);
  sContext.textAlign="start"
  // Alphabetic baseline for measure + draw — one measureText per cell (width + ink box).
  sContext.textBaseline = "alphabetic";
  sContext.textWeight=wFontWeight
  
  let wUnitWidth=0;
  let wUnitHeight=0;
  let wUnitChar="";
  // Is tCellUnit ==============================================================
  if (sCell.c_t==="c") {
    if (sCell.c_v.n==="tCellUnit") {
      wUnitChar = cellUnitSuffixFromJson(sCell.c_v.c);
      if (wUnitChar !== '') {
        const wUnitMeasure=sContext.measureText(wUnitChar);
        wUnitHeight = wUnitMeasure.fontBoundingBoxAscent + wUnitMeasure.fontBoundingBoxDescent;
        wUnitWidth=Math.round(wUnitMeasure.width);
      }
    }
  }
  if (
    wUnitChar === "" &&
    sCell.f_mo != null &&
    String(sCell.f_mo).trim() !== ""
  ) {
    wUnitChar = " " + sCell.f_mo;
    const wUnitMeasure=sContext.measureText(wUnitChar);
    wUnitHeight = wUnitMeasure.fontBoundingBoxAscent + wUnitMeasure.fontBoundingBoxDescent;
    wUnitWidth=Math.round(wUnitMeasure.width);
  }

  const textForMeasure = wCellText.length > 0 ? wCellText : "Mg";
  const isEmptyDisplay = wCellText.length === 0;
  const wMeasure = sContext.measureText(textForMeasure);
  const wInk = alphabeticInkFromMeasure(wMeasure, wFontSizeCssPx);
  let wTextWidth =
    wCellText.length > 0 ? Math.round(wMeasure.width) + wUnitWidth : wUnitWidth;
  const wIconCf = iconSetsCfFromCell(sCell);
  // Excel IconSets: glyph in the left gutter; value keeps its own horizontal align.
  const wIconPlacement = wIconCf ? "cellLeft" : "before";
  const wIconBlock = wIconCf
    ? measureIconSetBlockWidthPx(
        wIconCf,
        sContext,
        wFontSizeCssPx,
        wMeasure.fontBoundingBoxAscent || wMeasure.actualBoundingBoxAscent || 0,
        wMeasure.fontBoundingBoxDescent || wMeasure.actualBoundingBoxDescent || 0
      )
    : 0;
  // measureIconSetBlockWidthPx switches ctx.font — restore cell font before ink layout / draw.
  applyCanvasFontFromCell(sContext, sCell, this.m_FontPaintState);
  sContext.textBaseline = "alphabetic";
  // Prefer font bounding box; fall back to actual bounds when metrics are zero (some fonts/browsers).
  let wAscent = wMeasure.fontBoundingBoxAscent || wMeasure.actualBoundingBoxAscent || 0;
  let wDescent = wMeasure.fontBoundingBoxDescent || wMeasure.actualBoundingBoxDescent || 0;
  let wTextHeight = wAscent + wDescent;
  if (wTextHeight === 0) {
    wTextHeight = wUnitHeight;
  }
  let wTextHeightLayout = Math.max(
    wTextHeight,
    wInk.core,
    wFontSizeCssPx * CELL_TEXT_MIN_INK_SCALE
  );


  const wPaddingBase = Number(wPadding) + 0.1;
  // Horizontal padding: f_p default; f_pl / f_pr are Excel indent (padding-left/right).
  // Never clamp these by cell height — vertical clamp used to collapse left padding on scroll.
  const wPadLeft = cellPadPx(sCell, "f_pl", Number(wPadding)) + 0.1;
  const wPadRight = cellPadPx(sCell, "f_pr", Number(wPadding)) + 0.1;
  // Vertical (top/bottom) padding: clamp so the text ink still fits inside the cell.
  let wPaddingV = wPaddingBase;
  const minInkRoom = Math.max(4, wFontSizeCssPx * 0.85);
  // Full logical merge height — viewport clamp is c_oy (same role as c_ox for width).
  const wLogicalH = Number(sCell.c_h);
  const maxPad = Math.max(0, (wLogicalH - minInkRoom) / 2 - 0.1);
  if (Number.isFinite(maxPad) && wPaddingV > maxPad) {
    wPaddingV = Math.max(0.5, maxPad);
  }
  const cellHasOx = Object.prototype.hasOwnProperty.call(sCell, "c_ox");
  const cOxRaw = cellHasOx ? Number(sCell.c_ox) : 0;
  const cOx = cellHasOx && Number.isFinite(cOxRaw) ? cOxRaw : 0;
  const mergeLayoutOx =
    cellHasOx &&
    Object.prototype.hasOwnProperty.call(sCell, "c_mg") &&
    sCell.c_mg === true;
  const mergeClampedLeft =
    mergeLayoutOx &&
    Object.prototype.hasOwnProperty.call(sCell, "c_ml") &&
    sCell.c_ml === true;
  const mergeTruncatedRight =
    mergeLayoutOx && cellHasOx && Number.isFinite(cOxRaw) && cOx < -0.5;
  const visibleMergeRight =
    mergeTruncatedRight
      ? Number(sCell.c_x) + Math.max(0, Number(sCell.c_w) + cOx)
      : null;
  const cellHasOy = Object.prototype.hasOwnProperty.call(sCell, "c_oy");
  const cOyRaw = cellHasOy ? Number(sCell.c_oy) : 0;
  const cOy = cellHasOy && Number.isFinite(cOyRaw) ? cOyRaw : 0;
  const mergeLayoutOy =
    cellHasOy &&
    Object.prototype.hasOwnProperty.call(sCell, "c_mg") &&
    sCell.c_mg === true;
  const mergeClampedTop =
    mergeLayoutOy &&
    Object.prototype.hasOwnProperty.call(sCell, "c_mt") &&
    sCell.c_mt === true;
  const mergeTruncatedBottom =
    mergeLayoutOy && cellHasOy && Number.isFinite(cOyRaw) && cOy < -0.5;
  const visibleMergeBottom =
    mergeTruncatedBottom
      ? Number(sCell.c_y) + Math.max(0, Number(sCell.c_h) + cOy)
      : null;
  const isLeftSpill = Object.prototype.hasOwnProperty.call(sCell, "c__l");
  // Table header dropdown gutter (c_fbw, stamped by SkPaintCellStack): keep the
  // label inside the remaining width instead of letting the button paint over it.
  const wFilterGutterRaw = Number(sCell.c_fbw);
  const wFilterGutter =
    Number.isFinite(wFilterGutterRaw) && wFilterGutterRaw > 0
      ? Math.min(
          wFilterGutterRaw,
          Math.max(0, Number(sCell.c_w) - wPadLeft - wPadRight - 1),
        )
      : 0;
  const visibleInnerLeft = sCell.c_x + wPadLeft;
  const visibleInnerRight = sCell.c_x + sCell.c_w - wPadRight - wFilterGutter;
  let wPosX = isLeftSpill
    ? visibleInnerLeft
    : sCell.c_x + wPadLeft + cOx;
  let wWidth = sCell.c_w - wPadLeft - wPadRight - wFilterGutter;
  // Merge anchors: c_ox === visible slice minus full merge width; wWidth stays the full merge
  // inner rail (c_w - c_ox). Rail X: visible inner left when only truncated on the right; add c_ox
  // when truncated on the left (scroll strip) so glyphs line up across panes.
  if (cellHasOx && Number.isFinite(cOxRaw) && !isLeftSpill) {
    if (mergeLayoutOx) {
      wWidth = Math.max(
        0.001,
        sCell.c_w - cOx - wPadLeft - wPadRight - wFilterGutter,
      );
      if (
        mergeClampedLeft &&
        Object.prototype.hasOwnProperty.call(sCell, "c_ax")
      ) {
        const ax = Number(sCell.c_ax);
        if (Number.isFinite(ax)) {
          wPosX = ax + wPadLeft;
        } else {
          wPosX = visibleInnerLeft + cOx;
        }
      } else {
        wPosX = mergeClampedLeft ? visibleInnerLeft + cOx : visibleInnerLeft;
      }
    } else {
      wPosX = visibleInnerLeft + cOx;
      wWidth = Math.max(0.001, visibleInnerRight - wPosX);
    }
  }
  const visibleInnerTop = sCell.c_y + wPaddingV;
  let wPosY = visibleInnerTop;
  // Merge anchors: c_oy === visible slice minus full merge height; wHeight stays the full merge
  // inner rail (c_h - c_oy). Rail Y: visible inner top when only truncated on the bottom; add c_oy
  // when truncated on the top (scroll strip) so glyphs line up across panes.
  let wHeight = wLogicalH - (wPaddingV * 2);
  if (cellHasOy && Number.isFinite(cOyRaw)) {
    if (mergeLayoutOy) {
      wHeight = Math.max(0.001, sCell.c_h - cOy - wPaddingV * 2);
      if (
        mergeClampedTop &&
        Object.prototype.hasOwnProperty.call(sCell, "c_ay")
      ) {
        const ay = Number(sCell.c_ay);
        if (Number.isFinite(ay)) {
          wPosY = ay + wPaddingV;
        } else {
          wPosY = visibleInnerTop + cOy;
        }
      } else {
        wPosY = mergeClampedTop ? visibleInnerTop + cOy : visibleInnerTop;
      }
    } else {
      wPosY = visibleInnerTop + cOy;
      const visibleInnerBottom = sCell.c_y + sCell.c_h - wPaddingV;
      wHeight = Math.max(0.001, visibleInnerBottom - wPosY);
    }
  }
  // Vertical layout box uses the full logical height so alignment stays anchored to the whole
  // cell while a partial top scroll only shifts wPosY (clip still bounds paint to visible slice).
  
  if ((wHeight<=0) || (wWidth<=0)) { 
    sContext.restore();
    return 
  }

  // Nothing visible to paint — unless an Excel IconSet is mirrored on this Réel cell.
  if (isEmptyDisplay && wUnitWidth === 0 && !wIconCf?.length) {
    sContext.restore();
    return;
  }

  const hGlyphPad = horizontalGlyphPadPx(wFontSizePt, wWidth);

  // Clip region (use spill bounds before numeric overflow check; c_w can be a narrow
  // viewport slice after horizontal scroll while clip_l / clip_r still span empty neighbors).
  let wClipLeft = sCell.c_x;
  let wClipRight = sCell.c_x + sCell.c_w;
  let wClipTop = sCell.c_y;
  let wClipBottom = sCell.c_y + sCell.c_h;
  if (sCell.hasOwnProperty("clip_l")) {
    wClipLeft = sCell.clip_l;
  }
  if (sCell.hasOwnProperty("clip_r")) {
    wClipRight = sCell.clip_r;
  }
  if (wFilterGutter > 0) {
    wClipRight = Math.min(wClipRight, sCell.c_x + sCell.c_w - wFilterGutter);
  }
  // c__l: source cell is left of viewport; clip at pane origin, keep negative c_x anchor.
  if (isLeftSpill && sCell.c_x < 0) {
    wClipLeft = Math.max(wClipLeft, 0);
  }
  if (mergeTruncatedRight && visibleMergeRight != null) {
    wClipRight = Math.min(wClipRight, visibleMergeRight);
  }
  if (mergeTruncatedBottom && visibleMergeBottom != null) {
    wClipBottom = Math.min(wClipBottom, visibleMergeBottom);
  }

  // Excel General (f_ah absent): numbers right, text/empty left.
  let wAlignment = "right";
  if (sCell.hasOwnProperty("f_ah")) {
      switch (sCell.f_ah) {
      case 1 :
        if (excelGeneralHorizontalLeft(sCell, isEmptyDisplay)) {
          wAlignment = "left";
        }
        break; // none — General for text/empty, else right
      case 2 : wAlignment = "left"; break; // left
      case 3 : break; // right (default)
      case 4 : wAlignment = "center"; break; // center
      default : break;
      }
  } else if (excelGeneralHorizontalLeft(sCell, isEmptyDisplay)) {
    wAlignment = "left";
  }
  // IconSets use a fixed left gutter; left-aligned values must start after the glyph block.
  const wIconLeftPad =
    wIconCf && wIconBlock > 0 && wAlignment === "left" ? wIconBlock : 0;
  let wIconLeftX = 0;

  let wTextPosX = wPosX + wWidth - wTextWidth - hGlyphPad;
  if (wAlignment === "left") {
    wTextPosX = wPosX + hGlyphPad + wIconLeftPad;
  } else if (wAlignment === "center") {
    wTextPosX =
      wPosX +
      hGlyphPad +
      (wWidth - 2 * hGlyphPad) / 2 -
      wTextWidth / 2;
  }
  if (wIconCf) {
    wIconLeftX = wPosX + hGlyphPad;
  }
  // Merged anchors: horizontal align uses the logical merge box (c_x/c_w), not the scroll rail.
  let mergeDrawX = wPosX;
  let mergeDrawW = wWidth;
  let mergeDrawY = wPosY;
  let mergeDrawH = wHeight;
  if (mergeLayoutOx || sCell.c_mg === true) {
    const logInnerLeft = Number(sCell.c_x) + wPadLeft;
    const logInnerRight =
      Number(sCell.c_x) + Number(sCell.c_w) - wPadRight - wFilterGutter;
    const logCenterX =
      Number(sCell.c_x) + (Number(sCell.c_w) - wFilterGutter) / 2;
    mergeDrawX = logInnerLeft;
    mergeDrawW = Math.max(
      0.001,
      Number(sCell.c_w) - wPadLeft - wPadRight - wFilterGutter,
    );
    mergeDrawY = Number(sCell.c_y) + wPaddingV;
    mergeDrawH = Math.max(0.001, Number(sCell.c_h) - wPaddingV * 2);
    if (wAlignment === "left") {
      wTextPosX = logInnerLeft + hGlyphPad + wIconLeftPad;
    } else if (wAlignment === "center") {
      wTextPosX = logCenterX - wTextWidth / 2;
    } else if (wAlignment === "right") {
      wTextPosX = logInnerRight - wTextWidth - hGlyphPad;
    }
    if (wIconCf) {
      wIconLeftX = logInnerLeft + hGlyphPad;
    }
  }

  if (wIconCf && wIconBlock > 0) {
    wClipLeft = Math.min(wClipLeft, wIconLeftX - 1);
  }

  // Left-aligned spill: extend clip for glyph ink that sits left of the nominal origin.
  if (wAlignment === "left" && wTextWidth > 0) {
    const inkLeft = wMeasure.actualBoundingBoxLeft || hGlyphPad;
    if (wTextPosX - inkLeft < wClipLeft) {
      wClipLeft = Math.max(0, wTextPosX - inkLeft);
    }
  }
  // Never let overflow/glyph-bearing paint cover this cell's own left border
  // (pass D redraws labels after borders; Bilan actif B8:B10).
  if (
    !isLeftSpill &&
    Object.prototype.hasOwnProperty.call(sCell, "f_bol")
  ) {
    const bw = Math.max(1, Number(sCell.f_bol?.w) || 1);
    wClipLeft = Math.max(wClipLeft, Number(sCell.c_x) + bw * 0.5);
  }

  const wLayoutForAlign = Math.min(wTextHeightLayout, Math.max(1, wHeight));
  const wFav = sCell.hasOwnProperty("f_av") ? sCell.f_av : EXCEL_DEFAULT_F_AV;
  let wInkTopY = textTopYForVerticalAlign(wPosY, wHeight, wLayoutForAlign, wFav);
  // Merged anchors: vertical align uses logical c_y/c_h (same idea as horizontal c_x/c_w).
  if (mergeLayoutOy || sCell.c_mg === true) {
    const logInnerTop = Number(sCell.c_y) + wPaddingV;
    const logInnerBottom = Number(sCell.c_y) + Number(sCell.c_h) - wPaddingV;
    const logInnerH = Math.max(0.001, logInnerBottom - logInnerTop);
    const logCenterY = Number(sCell.c_y) + Number(sCell.c_h) / 2;
    const favNum = Number(wFav);
    if (favNum === 5 || favNum === 8) {
      wInkTopY = logInnerTop;
    } else if (favNum === 7) {
      wInkTopY = logCenterY - wLayoutForAlign / 2;
    } else if (
      !sCell.hasOwnProperty("f_av") ||
      favNum === 6 ||
      favNum === 9
    ) {
      wInkTopY = logInnerBottom - wLayoutForAlign;
    } else {
      wInkTopY = textTopYForVerticalAlign(
        logInnerTop,
        logInnerH,
        wLayoutForAlign,
        wFav
      );
    }
  }
  const wBaselineY = wInkTopY + wInk.asc;
  const wTextPosY = wInkTopY;
    /*
    sContext.beginPath();
    sContext.lineWidth = 1;
    sContext.arc(wTextPosX,wTextPosY, 3, 0, 2 * Math.PI);
    sContext.stroke();
    sContext.lineWidth = 1;
    */
   
    //wCellText+=" /p="+wTextPosY+"/h="+wTextHeight;  
    /*
    sContext.strokeStyle="blue";
    sContext.strokeRect(wTextPosX, 
              wTextPosY, 
              wMeasure.actualBoundingBoxLeft + wMeasure.actualBoundingBoxRight, 
              wMeasure.actualBoundingBoxAscent + wMeasure.actualBoundingBoxDescent);
    */

    const textWrapOn =
      sCell.hasOwnProperty("f_tw") && Number(sCell.f_tw) === 2;
    const hasManualBreak = /[\r\n]/.test(wCellText);
    const innerContentW = Math.max(0, wWidth - 2 * hGlyphPad);
    // f_tw absent => nowrap (Excel default). Multiline only for f_tw=2 or Alt+Enter breaks.
    const needsWordBreak = wMeasure.width > innerContentW;
    const overflowWrap =
      textWrapOn &&
      needsWordBreak &&
      wTextWidth > wClipRight - wClipLeft;
    const useMultilineLayout =
      wCellText.length > 0 &&
      !wVertical &&
      wRotate === 0 &&
      (hasManualBreak || (textWrapOn && needsWordBreak) || overflowWrap);

    if (useMultilineLayout) {
      let wrapVerticalAlign = "bottom";
      if (sCell.hasOwnProperty("f_av")) {
        switch (Number(sCell.f_av)) {
          case 5:
          case 8: wrapVerticalAlign = "top"; break;
          case 6:
          case 9: wrapVerticalAlign = "bottom"; break;
          case 7: wrapVerticalAlign = "center"; break;
          default: break;
        }
      }
      sContext.strokeStyle = "transparent";
      sContext.fillStyle = wColor;
      const wrapLineH = Math.max(
        wTextHeightLayout,
        Math.ceil(
          wFontSizeCssPx * WRAPPED_STRING_LINE_STEP_RATIO
        )
      );
      DrawTextWithAlignment(
        sContext,
        wCellText,
        mergeDrawX,
        mergeDrawY,
        mergeDrawW,
        mergeDrawH,
        wrapLineH,
        wAlignment,
        hGlyphPad + wIconLeftPad,
        {
          wordWrap: textWrapOn,
          verticalAlign: wrapVerticalAlign,
          underline: sCell.hasOwnProperty("f_d_u"),
          strikethrough: sCell.hasOwnProperty("f_d_l"),
          lineInkHeight: wTextHeightLayout,
        }
      );
      this._drawCellIconSetsInk(sContext, sCell, {
        textPosX: wTextPosX,
        baselineY: wBaselineY,
        textWidth: wTextWidth,
        alignment: wAlignment,
        fontSizeCssPx: wFontSizeCssPx,
        inkAscent: wInk.asc,
        inkDescent: wInk.desc,
        iconBlock: wIconBlock,
        iconPlacement: wIconPlacement,
        iconLeftX: wIconLeftX,
      });
      sContext.restore();
      return;
    }

    sContext.beginPath();
    let wClipLength=wClipRight-wClipLeft;
    let wClipHeight = wClipBottom - wClipTop;
    sContext.rect(wClipLeft, wClipTop, wClipLength, wClipHeight);
    sContext.clip();
    sContext.strokeStyle='transparent';
    sContext.fillStyle=wColor

    if (wVertical) {
      // Vertical stacked text; alignment codes: 5,8 top ; 7 center ; 6,9 bottom. Excel default: bottom.
      const wCenterX = mergeDrawX + mergeDrawW / 2;
      const wStackHeight = wTextHeightLayout * wCellText.length;
      let wCharY = mergeDrawY + mergeDrawH - wStackHeight;
      if (sCell.hasOwnProperty("f_av")) {
        switch (sCell.f_av) {
          case 5:
          case 8: wCharY = mergeDrawY; break;
          case 6:
          case 9: wCharY = mergeDrawY + mergeDrawH - wStackHeight; break;
          case 7: wCharY = mergeDrawY + (mergeDrawH - wStackHeight) / 2; break;
          default: break;
        }
      }
      for (let i = 0; i < wCellText.length; i++) {
        const wChar = wCellText[i];
        const wCharWidth = sContext.measureText(wChar).width;
        sContext.fillText(wChar, wCenterX - wCharWidth / 2, wCharY);
        // Per-character underline and strikethrough, aligned on the character's
        // own alphabetic baseline (Excel-like behavior for stacked text).
        if (sCell.hasOwnProperty("f_d_u")) {
          sContext.fillRect(
            wCenterX - wCharWidth / 2,
            underlineLineYTopBaseline(sContext, wChar, wCharY, wTextHeightLayout),
            wCharWidth, 1);
        }
        if (sCell.hasOwnProperty("f_d_l")) {
          sContext.fillRect(
            wCenterX - wCharWidth / 2,
            strikeLineYTopBaseline(sContext, wChar, wCharY, wTextHeightLayout),
            wCharWidth, 1);
        }
        wCharY += wTextHeightLayout;
      }
    } else if (wRotate !== 0) {
      const absRot = Math.abs(wRotate);
      const nearVertical = absRot >= 45 && absRot <= 135;

      if (nearVertical) {
        const wrapLineH = Math.max(
          wTextHeightLayout,
          Math.ceil(wFontSizeCssPx * WRAPPED_STRING_LINE_STEP_RATIO)
        );
        drawRotatedNearVerticalCellText(sContext, {
          text: wCellText,
          rotateDeg: wRotate,
          x: mergeDrawX,
          y: mergeDrawY,
          width: mergeDrawW,
          height: mergeDrawH,
          lineHeight: wrapLineH,
          glyphPad: hGlyphPad,
          textWrapOn,
          alignment: wAlignment,
          verticalAlignCode: wFav,
          color: wColor,
          underline: sCell.hasOwnProperty('f_d_u'),
          strikethrough: sCell.hasOwnProperty('f_d_l'),
          lineInkHeight: wTextHeightLayout,
        });
      } else {
      // Rotate around the center of the text box. Spreadsheet convention:
      // positive angle = counter-clockwise; Canvas rotate() is clockwise,
      // hence the sign inversion.
      const wCenterX = wTextPosX + wTextWidth / 2;
      const wCenterY = wTextPosY + wTextHeightLayout / 2;
      sContext.save();
      sContext.translate(wCenterX, wCenterY);
      sContext.rotate((-wRotate * Math.PI) / 180);
      const halfLayout = wTextHeightLayout / 2;
      sContext.fillText(wCellText, -wTextWidth / 2, -halfLayout);
      if (wUnitWidth !== 0) {
        sContext.fillText(wUnitChar, (wTextWidth / 2) - wUnitWidth, -halfLayout);
      }
      if (sCell.hasOwnProperty("f_d_u")) {
        sContext.fillRect(
          -wTextWidth / 2,
          underlineLineYTopBaseline(sContext, wCellText, -halfLayout, wTextHeightLayout),
          wTextWidth, 1);
      }
      if (sCell.hasOwnProperty("f_d_l")) {
        sContext.fillRect(
          -wTextWidth / 2,
          strikeLineYTopBaseline(sContext, wCellText, -halfLayout, wTextHeightLayout),
          wTextWidth, 1);
      }
      sContext.restore();
      }
    } else {
      sContext.textBaseline = "alphabetic";
      sContext.fillText(wCellText, wTextPosX, wBaselineY);
      if (wUnitWidth !== 0) {
        sContext.fillText(wUnitChar, wTextPosX + wTextWidth - wUnitWidth, wBaselineY);
      }
      if (sCell.hasOwnProperty("f_d_u")) {
        sContext.fillRect(wTextPosX, wBaselineY + wInk.desc + 1, wTextWidth, 1);
      }
      if (sCell.hasOwnProperty("f_d_l")) {
        sContext.fillRect(
          wTextPosX,
          wBaselineY + (wInk.desc - wInk.asc) / 2,
          wTextWidth,
          1
        );
      }
    }
    this._drawCellIconSetsInk(sContext, sCell, {
      textPosX: wTextPosX,
      baselineY: wBaselineY,
      textWidth: wTextWidth,
      alignment: wAlignment,
      fontSizeCssPx: wFontSizeCssPx,
      inkAscent: wInk.asc,
      inkDescent: wInk.desc,
      iconBlock: wIconBlock,
      iconPlacement: wIconPlacement,
      iconLeftX: wIconLeftX,
    });
    sContext.stroke()
  
    sContext.restore()
}

DrawBorder(sContext,sCell) {
  const cw = Number(sCell.c_w);
  const ch = Number(sCell.c_h);
  if (!(cw > 0) || !(ch > 0)) {
    return;
  }
  sContext.save() 
  // Border ====================================================================
  if (sCell.hasOwnProperty("f_bo")) {
    this.PaintBorder(sContext, sCell,0,sCell.f_bo)
  }
  if (sCell.hasOwnProperty("f_bol")) {
  this.PaintBorder(sContext, sCell,1,sCell.f_bol)
  }
  if (sCell.hasOwnProperty("f_bot")) {
  this.PaintBorder(sContext, sCell,2,sCell.f_bot)
  }
  if (sCell.hasOwnProperty("f_bor")) {
  this.PaintBorder(sContext, sCell,3,sCell.f_bor)
  }
  if (sCell.hasOwnProperty("f_bob")) {
  this.PaintBorder(sContext, sCell,4,sCell.f_bob)
  }
  sContext.restore()
}

/**
 * Coalesce collinear borders (merged ranges + table edges) into continuous strokes.
 * @param {CanvasRenderingContext2D} sContext
 * @param {object[]} cells
 */
DrawBordersCoalesced(sContext, cells) {
  /** @type {Map<string, { side: number, prop: object, pos: number, intervals: number[][] }>} */
  const vertical = new Map();
  /** @type {Map<string, { side: number, prop: object, pos: number, intervals: number[][] }>} */
  const horizontal = new Map();

  const addVertical = (pos, y0, y1, side, prop) => {
    if (!(y1 > y0)) return;
    const key = `${side}|${prop.c}|${prop.w}|${prop.s}|${Math.round(pos * 2) / 2}`;
    let bucket = vertical.get(key);
    if (!bucket) {
      bucket = { side, prop, pos, intervals: [] };
      vertical.set(key, bucket);
    }
    bucket.intervals.push([y0, y1]);
  };

  const addHorizontal = (pos, x0, x1, side, prop) => {
    if (!(x1 > x0)) return;
    const key = `${side}|${prop.c}|${prop.w}|${prop.s}|${Math.round(pos * 2) / 2}`;
    let bucket = horizontal.get(key);
    if (!bucket) {
      bucket = { side, prop, pos, intervals: [] };
      horizontal.set(key, bucket);
    }
    bucket.intervals.push([x0, x1]);
  };

  for (const sCell of cells) {
    if (sCell == null || typeof sCell !== "object") continue;
    const box = this.cellBorderBox(sCell);
    if (box == null) continue;

    const sideKeys = ["f_bo", "f_bol", "f_bot", "f_bor", "f_bob"];
    let needsIndividual = false;
    for (const key of sideKeys) {
      if (sCell.hasOwnProperty(key) && sCell[key]?.s === 5) {
        needsIndividual = true;
        break;
      }
    }
    if (needsIndividual) {
      this.DrawBorder(sContext, sCell);
      continue;
    }

    const { x, y, w, h } = box;
    const emitSide = (side, prop) => {
      if (prop == null) return;
      switch (side) {
        case 1:
          addVertical(x, y, y + h, side, prop);
          break;
        case 2:
          addHorizontal(y, x, x + w, side, prop);
          break;
        case 3:
          addVertical(x + w, y, y + h, side, prop);
          break;
        case 4:
          addHorizontal(y + h, x, x + w, side, prop);
          break;
        case 0:
          addVertical(x, y, y + h, 1, prop);
          addHorizontal(y, x, x + w, 2, prop);
          addVertical(x + w, y, y + h, 3, prop);
          addHorizontal(y + h, x, x + w, 4, prop);
          break;
        default:
          break;
      }
    };

    if (sCell.hasOwnProperty("f_bo")) emitSide(0, sCell.f_bo);
    if (sCell.hasOwnProperty("f_bol")) emitSide(1, sCell.f_bol);
    if (sCell.hasOwnProperty("f_bot")) emitSide(2, sCell.f_bot);
    if (sCell.hasOwnProperty("f_bor")) emitSide(3, sCell.f_bor);
    if (sCell.hasOwnProperty("f_bob")) emitSide(4, sCell.f_bob);
  }

  sContext.save();
  for (const bucket of vertical.values()) {
    const merged = this.mergeInterval1D(bucket.intervals);
    for (const [y0, y1] of merged) {
      this.drawSingleBorderOnBox(
        sContext,
        { x: bucket.pos, y: y0, w: 0, h: y1 - y0 },
        bucket.side,
        bucket.prop,
        0,
        y0,
      );
    }
  }
  for (const bucket of horizontal.values()) {
    const merged = this.mergeInterval1D(bucket.intervals);
    for (const [x0, x1] of merged) {
      this.drawSingleBorderOnBox(
        sContext,
        { x: x0, y: bucket.pos, w: x1 - x0, h: 0 },
        bucket.side,
        bucket.prop,
        0,
        x0,
      );
    }
  }
  sContext.restore();
}

}
export default SkSpCellCanvas