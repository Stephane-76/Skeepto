//=============================================================================
// SkUtility
// SpreadSheet Utility  
//=============================================================================
import { jsonViewCellDisplayText } from './jsonViewCellText.js';
export function GetType(sElement) {
    if (Array.isArray(sElement)) return 'array';
    else if (typeof sElement == 'string') return 'string';
    else if (sElement != null && typeof sElement == 'object') return 'object';
    else return 'other';
}

export function Min(s1,s2) {
  if (s1<s2) {
    return(s1);
  }
  return(s2);
}


export function Max(s1,s2) {
  if (s1>s2) {
    return(s1);
  }
  return(s2);
}

/** Default UI / canvas font for the whole app. */
export const SK_DEFAULT_FONT = 'Roboto';

export const SK_FONT_STACK = "'Roboto', sans-serif";

/**
 * Build a CSS-safe font-family list usable both for Canvas 2D `ctx.font`
 * and for React inline `style.fontFamily`.
 *
 * Spreadsheet cells often carry Excel-style font names like
 *   "Calibri (Corps)" / "Calibri (Body)" / "Cambria (Headings)"
 * which are theme-font sentinels rather than installed font names. The
 * surrounding parentheses also break the CSS shorthand parser used by
 * `ctx.font`, which silently falls back to "10px sans-serif" — that's why
 * sizes/weights look wrong on canvas. We always quote the family, strip
 * the theme suffix to build a clean alias, and append a sensible fallback
 * chain so something legible is rendered everywhere.
 */
export function buildCanvasFontFamily(sFontName) {
  if (!sFontName) return SK_FONT_STACK;
  const wQuote = (n) => `"${String(n).replace(/"/g, '\\"')}"`;
  // Remove a trailing "(...)" theme tag, e.g. "Calibri (Corps)" -> "Calibri".
  const wPrimary = String(sFontName).replace(/\s*\([^)]*\)\s*$/, '').trim();
  const wList = [wQuote(sFontName)];
  if (wPrimary && wPrimary !== sFontName) {
    wList.push(wQuote(wPrimary));
  }
  for (const wFallback of [SK_DEFAULT_FONT, 'Helvetica', 'Arial', 'sans-serif']) {
    if (!wList.includes(wFallback) && !wList.includes(wQuote(wFallback))) {
      wList.push(wFallback);
    }
  }
  return wList.join(', ');
}
// thank contributor
// https://stackoverflow.com/questions/1255512/how-to-draw-a-rounded-rectangle-using-html-canvas
/**
 * Draws a rounded rectangle using the current state of the canvas.
 * If you omit the last three params, it will draw a rectangle
 * outline with a 5 pixel border radius
 * @param {CanvasRenderingContext2D} sContext
 * @param {Number} sX The top left x coordinate
 * @param {Number} sY The top left y coordinate
 * @param {Number} sWidth The width of the rectangle
 * @param {Number} sHeight The height of the rectangle
 * @param {Number} [sRadius = 5] The corner radius; It can also be an object 
 *                 to specify different radii for corners
 * @param {Number} [radius.tl = 0] Top left
 * @param {Number} [radius.tr = 0] Top right
 * @param {Number} [radius.br = 0] Bottom right
 * @param {Number} [radius.bl = 0] Bottom left
 * @param {Boolean} [sFill = false] Whether to fill the rectangle.
 * @param {Boolean} [sStroke = true] Whether to stroke the rectangle.
 */
export function SkRoundRect(
    sContext,
    sX,
    sY,
    sWidth,
    sHeight,
    sRadius = 5,
    sFill = false,
    sStroke = true
  ) {
    if (typeof sRadius === 'number') {
      sRadius = {tl: sRadius, tr: sRadius, br: sRadius, bl: sRadius};
    } else {
      sRadius = {...{tl: 0, tr: 0, br: 0, bl: 0}, ...sRadius};
    }
    sContext.beginPath();
    sContext.moveTo(sX + sRadius.tl, sY);
    sContext.lineTo(sX + sWidth - sRadius.tr, sY);
    sContext.quadraticCurveTo(sX + sWidth, sY, sX + sWidth, sY + sRadius.tr);
    sContext.lineTo(sX + sWidth, sY + sHeight - sRadius.br);
    sContext.quadraticCurveTo(sX + sWidth, sY + sHeight, sX + sWidth - sRadius.br, sY + sHeight);
    sContext.lineTo(sX + sRadius.bl, sY + sHeight);
    sContext.quadraticCurveTo(sX, sY + sHeight, sX, sY + sHeight - sRadius.bl);
    sContext.lineTo(sX, sY + sRadius.tl);
    sContext.quadraticCurveTo(sX, sY, sX + sRadius.tl, sY);
    sContext.closePath();
    if (sFill) {
      sContext.fill();
    }
    if (sStroke) {
      sContext.stroke();
    }
  }


 export function GetTextAlign(sValue) {
  switch (sValue) {
    case 1 : return(""); // none
    case 2 : return("start"); // left
    case 3 : return("end"); // right
    case 4 : return("center"); // center
    default : break;
  }
  return("");
 }

 export function GetVerticalTextAlign(sValue) {
  switch (sValue) {
    case 1 : return(""); // none
    case 2 : return("baseline");
    case 3 : return("sub");
    case 4 : return("super");
    case 5 : return("start"); // text-top
    case 6 : return("end"); // text-bottom
    case 7 : return("center"); // middle
    case 8 : return("start"); // top
    case 9 : return("end"); // bottom
    default : break;
  }
  return("");
 }

 export function GetFontStyle(sValue) {
  switch(sValue) {
    case 1 : return(""); // None
    case 2 : return("normal");
    case 3 : return("italic");
    case 4 : return("oblique");
    case 5 : return("deg");
    default : break;
  }
  return("");
 }
 
 export function GetFontWeight(sValue) {
  switch(sValue) {
    case 1 : return(""); // None
    case 2 : return("normal");
    case 3 : return("bold");
    case 4 : return("lighter");
    case 5 : return("bolder");
    case 6 : return(""); // numeric weight — use f_wi in SkFontPool.canvasWeightFromCell
    default : break;
  }
  return("");
 }
 
/** Split a single line into chunks that fit within maxWidth (character-level break). */
function breakLineToWidth(ctx, line, maxWidth) {
  if (!line || maxWidth <= 0) {
    return line ? [line] : [''];
  }
  if (ctx.measureText(line).width <= maxWidth) {
    return [line];
  }
  const chunks = [];
  let chunk = '';
  for (const ch of line) {
    const test = chunk + ch;
    if (ctx.measureText(test).width > maxWidth && chunk.length > 0) {
      chunks.push(chunk);
      chunk = ch;
    } else {
      chunk = test;
    }
  }
  if (chunk.length > 0) {
    chunks.push(chunk);
  }
  return chunks.length > 0 ? chunks : [''];
}

/** Strikethrough Y for text drawn with textBaseline "alphabetic" at baselineY. */
export function strikeLineYAlphabeticBaseline(ctx, text, baselineY) {
  const m = ctx.measureText(text || "0");
  const asc = m.actualBoundingBoxAscent || 0;
  const desc = m.actualBoundingBoxDescent || 0;
  if (desc <= 0 && asc <= 0) {
    return baselineY;
  }
  return baselineY + (desc - asc) / 2;
}

/** Underline Y for text drawn with textBaseline "alphabetic" at baselineY. */
export function underlineLineYAlphabeticBaseline(ctx, text, baselineY) {
  const m = ctx.measureText(text || "0");
  const desc = m.actualBoundingBoxDescent || 0;
  return baselineY + desc + 1;
}

/** Strikethrough Y for text drawn with textBaseline "top" at textTopY. */
export function strikeLineYTopBaseline(ctx, text, textTopY, fallbackHeight) {
  const m = ctx.measureText(text || "0");
  const asc = m.actualBoundingBoxAscent || 0;
  const desc = m.actualBoundingBoxDescent || fallbackHeight * 0.72 || 0;
  if (desc <= 0 && asc <= 0) {
    return textTopY + (fallbackHeight || 0) * 0.45;
  }
  return textTopY + (desc - asc) / 2;
}

/** Underline Y for text drawn with textBaseline "top" at textTopY. */
export function underlineLineYTopBaseline(ctx, text, textTopY, fallbackHeight) {
  const m = ctx.measureText(text || "0");
  const desc = m.actualBoundingBoxDescent || fallbackHeight * 0.72 || 0;
  return textTopY + desc + 1;
}

/** Build display lines from cell text (manual breaks always; word wrap optional). */
export function splitCellTextLines(ctx, text, innerW, wordWrap) {
  const normalizedText = String(text).replace(/\u00a0/g, ' ');
  const paragraphs = normalizedText.split(/\r?\n/);
  const lines = [];

  for (const paragraph of paragraphs) {
    if (!wordWrap) {
      lines.push(paragraph);
      continue;
    }
    if (innerW <= 0) {
      lines.push(paragraph);
      continue;
    }
    if (ctx.measureText(paragraph).width <= innerW) {
      lines.push(paragraph);
      continue;
    }

    const words = paragraph.split(' ').filter((w, i, arr) => w.length > 0 || i < arr.length - 1);
    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let line = '';
    for (let n = 0; n < words.length; n++) {
      let word = words[n];
      while (word.length > 0) {
        const sep = line.length > 0 ? ' ' : '';
        const testLine = line + sep + word;
        if (ctx.measureText(testLine).width <= innerW) {
          line = testLine;
          word = '';
          continue;
        }
        if (line.length > 0) {
          lines.push(line);
          line = '';
          continue;
        }
        const wordChunks = breakLineToWidth(ctx, word, innerW);
        if (wordChunks.length > 1) {
          lines.push(...wordChunks.slice(0, -1));
          word = wordChunks[wordChunks.length - 1];
        } else {
          lines.push(word);
          word = '';
        }
      }
    }
    if (line.length > 0) {
      lines.push(line);
    }
  }

  return lines.length > 0 ? lines : [''];
}

export function DrawTextWithAlignment(
  ctx,
  text,
  x,
  y,
  maxWidth,
  maxHeight,
  lineHeight,
  alignment,
  glyphPadPx = 0,
  options = {}
) {
  const pad = Math.max(0, Number(glyphPadPx) || 0);
  const innerW = Math.max(0, maxWidth - 2 * pad);
  const baseX = x + pad;
  const wordWrap = options.wordWrap !== false;
  const verticalAlign = options.verticalAlign || 'top';
  const underline = options.underline === true;
  const strikethrough = options.strikethrough === true;
  const lineInkHeight = Number(options.lineInkHeight) || lineHeight;
  const lines = splitCellTextLines(ctx, text, innerW, wordWrap);

  if (lines.length === 0 || maxHeight <= 0 || innerW <= 0) {
    return;
  }

  const lh = Math.max(1, lineHeight);
  let step = lh;
  let maxLines = Math.min(lines.length, Math.floor(maxHeight / step));
  // Small row + tall line step (wrap on, Times 8pt): still paint at least one line.
  if (maxLines < 1) {
    maxLines = 1;
    step = Math.max(1, maxHeight);
  }

  const blockHeight = maxLines * step;
  let inkTopY = y;
  if (verticalAlign === 'center') {
    inkTopY = y + Math.max(0, (maxHeight - blockHeight) / 2);
  } else if (verticalAlign === 'bottom') {
    inkTopY = y + Math.max(0, maxHeight - blockHeight);
  }

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.beginPath();
  ctx.rect(x + pad, y, innerW, maxHeight);
  ctx.clip();

  let lineInkTop = inkTopY;
  for (let i = 0; i < maxLines; i++) {
    const line = lines[i];
    const lm = ctx.measureText(line || 'Mg');
    let asc = lm.actualBoundingBoxAscent ?? lm.fontBoundingBoxAscent ?? 0;
    let desc = lm.actualBoundingBoxDescent ?? lm.fontBoundingBoxDescent ?? 0;
    const core = Math.max(asc + desc, lineInkHeight, 1);
    if (asc <= 0.5) {
      asc = core * 0.78;
    }
    if (desc <= 0.5) {
      desc = Math.max(0.5, core - asc);
    }
    const baselineY = lineInkTop + asc;

    const lineWidth = lm.width;
    let offsetX = baseX;
    if (alignment === 'right') {
      offsetX += innerW - lineWidth;
    } else if (alignment === 'center') {
      offsetX += (innerW - lineWidth) / 2;
    }

    ctx.fillText(line, offsetX, baselineY);
    if (underline) {
      ctx.fillRect(
        offsetX,
        underlineLineYAlphabeticBaseline(ctx, line, baselineY),
        lineWidth,
        1
      );
    }
    if (strikethrough) {
      ctx.fillRect(
        offsetX,
        strikeLineYAlphabeticBaseline(ctx, line, baselineY),
        lineWidth,
        1
      );
    }
    lineInkTop += step;
  }

  ctx.restore();
}

//=============================================================================
// Conditional Formatting (ItemCF) Drawing Functions
//=============================================================================

/**
 * Raw numeric cell magnitude for conditional formatting.
 * Never use f_value: a percentage display "50%" would parse as 50 instead of 0.5.
 * @param {Object} sCell
 * @returns {number|null}
 */
export function cfNumericCellValue(sCell) {
    if (!sCell) return null;
    let v = sCell.c_v;
    if (v && typeof v === 'object' && v.Type === 'tNumber') {
        v = v.n;
    }
    if (typeof v === 'number' && !Number.isNaN(v)) {
        return v;
    }
    if (typeof v === 'string') {
        const n = parseFloat(v);
        if (!Number.isNaN(n)) return n;
    }
    return null;
}

/**
 * Bar fill ratio when the engine did not attach a precomputed percent (e.g. UI preview).
 * @param {number} value
 * @param {number} minValue
 * @param {number} maxValue
 * @returns {number}
 */
function dataBarFillRatio(value, minValue, maxValue) {
    if (minValue < 0 && maxValue > 0) {
        const maxAbs = Math.max(Math.abs(minValue), Math.abs(maxValue));
        return maxAbs > 0 ? Math.min(Math.abs(value) / maxAbs, 1) : 0;
    }
    if (value >= 0) {
        return calculatePercentage(value, minValue, maxValue);
    }
    return minValue < 0 ? Math.min(Math.abs(value) / Math.abs(minValue), 1) : 0;
}

/**
 * Draws DataBars conditional formatting
 * @param {Object} itemCF - The conditional formatting item
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} cellRect - Cell rectangle {x, y, width, height}
 */
export function drawDataBars(itemCF, ctx, cellRect, sCell) {
    if (!itemCF.color || itemCF.minValue === itemCF.maxValue) return;
    
    ctx.save();
    try {
    // Set opacity to 50% (0.5)
    ctx.globalAlpha = 0.5;

    const wValue = cfNumericCellValue(sCell);
    if (wValue === null) {
        return;
    }
    // Calculate padding like DrawCell does
    let padding = 5; // Default padding
    if (sCell && sCell.hasOwnProperty("f_p")) {
        padding = sCell.f_p;
    }
    const paddingText = padding / 2; 
    
    // Calculate adjusted positions and dimensions with padding
    const adjustedX = cellRect.x + paddingText;
    const adjustedY = cellRect.y + paddingText;
    const adjustedWidth = cellRect.width - (paddingText * 2);
    const adjustedHeight = cellRect.height - (paddingText * 2);
    
    // Calculate the range
    const { minValue, maxValue } = itemCF;
    const range = maxValue - minValue;
    
    // Calculate zero position within the cell
    let zeroPosition;
    if (minValue < 0 && maxValue > 0) {
        // Zero is in the range, calculate its position
        zeroPosition = adjustedX + adjustedWidth * (0 - minValue) / range;
    } else if (minValue >= 0) {
        // All values are positive, zero is at the left edge
        zeroPosition = adjustedX;
    } else {
        // All values are negative, zero is at the right edge
        zeroPosition = adjustedX + adjustedWidth;
    }
    
    // Determine which color to use based on value sign
    let barColor;
    if (wValue >= 0) {
        barColor = itemCF.color ? normalizeHexColor(itemCF.color) : '#4A90E2';
    } else {
        // For negative values, use param6 if available, otherwise colorNegative
        if (itemCF.param6 && itemCF.param6 !== "") {
            barColor = normalizeHexColor(itemCF.param6);
        } else {
            barColor = itemCF.colorNegative ? normalizeHexColor(itemCF.colorNegative) : '#E24A4A';
        }
    }
    
    // Prefer engine-computed percent (handles % format 0.5 vs display "50%", auto min/max).
    let ratio;
    if (typeof itemCF.percent === 'number' && Number.isFinite(itemCF.percent)) {
        ratio = Math.max(0, Math.min(1, itemCF.percent));
    } else {
        ratio = dataBarFillRatio(wValue, minValue, maxValue);
    }

    // Calculate bar width and position based on value sign
    let barX, barY, barWidth_actual;
    barY = adjustedY;
    
    if (wValue >= 0) {
        // Positive value: bar goes from zero position to the right
        barWidth_actual = adjustedWidth * ratio;
        barX = zeroPosition;
        barWidth_actual = Math.min(barWidth_actual, adjustedX + adjustedWidth - barX);
    } else {
        // Negative value: bar goes from left of zero position towards zero
        barWidth_actual = adjustedWidth * ratio;
        barX = zeroPosition - barWidth_actual;
        // Ensure the bar doesn't go outside the cell
        if (barX < adjustedX) {
            barWidth_actual = zeroPosition - adjustedX;
            barX = adjustedX;
        }
    }
    
    // Ensure valid dimensions
    if (barWidth_actual <= 0) {
        return;
    }
    
    // Set up gradient if needed
    if (itemCF.style === "gradient") {
        // Always fade to white
        const endColor = 'rgb(255, 255, 255)';
        
        // Convert barColor to rgb format for consistency
        let rgbBarColor = barColor;
        if (barColor.startsWith('#')) {
            const rgb = hexToRgb(barColor);
            if (rgb) {
                rgbBarColor = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
            }
        }
        
        // Create gradient: normal for positive, inverted for negative
        const gradient = ctx.createLinearGradient(barX, barY, barX + barWidth_actual, barY);
        if (wValue < 0) {
            // For negative values, gradient goes from white to barColor (inverted)
            gradient.addColorStop(0, endColor);
            gradient.addColorStop(1, rgbBarColor);
        } else {
            // For positive values, gradient goes from barColor to white (normal)
            gradient.addColorStop(0, rgbBarColor);
            gradient.addColorStop(1, endColor);
        }
        
        ctx.fillStyle = gradient;
    } else {
        ctx.fillStyle = barColor;
    }
    
    // Fill the bar
    ctx.fillRect(barX, barY, barWidth_actual, adjustedHeight);
    
    // Add border if gradient style
    if (itemCF.style === "gradient") {
        ctx.strokeStyle = barColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barWidth_actual, adjustedHeight);
    }
    } finally {
        ctx.restore();
    }
}

// =============================================================================
// IconSets glyph + color mapping (Material Symbols Rounded)
//
// The C++ backend (tConditionalFormat::CalculateIconSetWithIndex) attaches both
// a 0-based `iconIndex` (position inside the set) and an `iconTotal` (3 or 5)
// to each cell. We use these to pick a tier-appropriate Material Symbols
// glyph and a semantic color, instead of rendering the raw OOXML iconString
// (which is not unique across tiers for several Excel built-ins, e.g. the
// 3-traffic-light Indicators set returns "●" for low/mid/high).
//
// The font itself is loaded from public/index.html. We render glyphs by their
// PUA codepoint (e.g. "\ue5d8" for arrow_upward) rather than by ligature name
// because canvas2d's text shaping does not consistently apply OpenType
// ligatures across browsers — codepoints work everywhere as long as the font
// is loaded.
// =============================================================================

// Material Symbols PUA codepoints (from MaterialSymbolsRounded.codepoints).
// Keep this table in sync with public/index.html's icon_names subset so the
// font request only ships glyphs we actually use.
const MS = {
    arrow_downward: "\ue5db",
    arrow_forward:  "\ue5c8",
    arrow_upward:   "\ue5d8",
    north_east:     "\uf1e1",
    south_east:     "\uf1e4",
    flag:           "\uf0c6",
    circle:         "\uef4a",
    change_history: "\ue86b",
    square:         "\ueb36",
    star:           "\uf09a",
    star_half:      "\ue839",
    check:          "\ue5ca",
    close:          "\ue5cd",
};

const MATERIAL_SYMBOLS_FONT = '"Material Symbols Rounded"';
/** Stroke-style icons (cross, check, triangle, arrows…). */
const ICON_SET_STROKE_WGHT = 700;
/** Circles stay at medium weight — they are already solid discs at FILL=1. */
const ICON_SET_CIRCLE_WGHT = 500;
/** Stroke glyphs need a larger em-box than filled circles. */
const ICON_SET_STROKE_SIZE_MULT = 1.4;
/** Legacy OOXML hollow circle (◯) → filled disc when Material font is not ready. */
const LEGACY_FILLED_CIRCLE = "\u2B24";

function isIconSetCircleGlyph(glyph) {
    return glyph === MS.circle;
}

/**
 * Canvas2d often ignores fontVariationSettings; pin FILL=1 via the Google Fonts
 * URL (index.html) and pick weight through the font shorthand instead.
 */
function applyMaterialSymbolsIconCanvasFont(ctx, iconFontSize, glyph) {
    const wght = isIconSetCircleGlyph(glyph) ? ICON_SET_CIRCLE_WGHT : ICON_SET_STROKE_WGHT;
    ctx.font = `${wght} ${iconFontSize}px ${MATERIAL_SYMBOLS_FONT}`;
}

/** Paint one Material Symbol; stroke icons get a synthetic bold pass (double draw). */
function paintMaterialSymbolIcon(ctx, glyph, x, y, iconFontSize) {
    applyMaterialSymbolsIconCanvasFont(ctx, iconFontSize, glyph);
    const rx = Math.round(x);
    const ry = y;
    ctx.fillText(glyph, rx, ry);
    if (!isIconSetCircleGlyph(glyph)) {
        // Variable-font axes are unreliable on canvas — offset redraw thickens check/cross/triangle.
        ctx.fillText(glyph, rx + 0.65, ry);
        ctx.fillText(glyph, rx, ry + 0.45);
    }
}

// Excel OOXML preset names (param6 from C++). Overrides generic iconType mapping.
const EXCEL_ICON_SET_GLYPHS = {
    "3Signs": {
        3: [MS.close, MS.change_history, MS.check],
    },
    "3Symbols2": {
        3: [MS.circle, MS.change_history, MS.circle],
    },
    "3Symbols": {
        3: [MS.circle, MS.change_history, MS.circle],
    },
};

// Glyph table per (iconType, iconTotal). Each entry maps iconIndex → glyph.
// Both 3- and 5-icon variants are supplied so a cell stays visually consistent
// regardless of which Excel preset the workbook chose.
const ICON_SET_GLYPHS = {
    Arrows: {
        3: [MS.arrow_downward, MS.arrow_forward, MS.arrow_upward],
        5: [MS.arrow_downward, MS.south_east, MS.arrow_forward, MS.north_east, MS.arrow_upward],
    },
    Flags: {
        // Excel "3Flags" displays one flag glyph in red / amber / green. We
        // reuse the same Material Symbols flag codepoint for every tier and
        // let ICON_SET_COLORS provide the semantic color (matches Excel).
        3: [MS.flag, MS.flag, MS.flag],
        5: [MS.flag, MS.flag, MS.flag, MS.flag, MS.flag],
    },
    Shapes: {
        3: [MS.circle, MS.change_history, MS.square],
        5: [MS.circle, MS.change_history, MS.square, MS.change_history, MS.circle],
    },
    Indicators: {
        // 3-traffic-lights / 4-arrows / 5-arrows. Filled circles in tier color
        // (red / amber / green / teal / blue) keep the Excel semantics readable.
        3: [MS.circle, MS.circle, MS.circle],
        5: [MS.circle, MS.circle, MS.circle, MS.circle, MS.circle],
    },
    Ratings: {
        3: [MS.star_half, MS.star_half, MS.star],
        5: [MS.star_half, MS.star_half, MS.star_half, MS.star_half, MS.star],
    },
};

// Tier color per (iconTotal, iconIndex). Same red→green ramp as Excel.
const ICON_SET_COLORS = {
    3: ["#D7263D", "#F5A623", "#2E933C"],
    5: ["#D7263D", "#E8743C", "#F5A623", "#7CB342", "#2E933C"],
};

/**
 * Resolve (glyph, color) for an IconSets item. Falls back to the legacy
 * iconString rendering when the C++ side didn't provide an index/total
 * (e.g. older .sker files written before the field was added).
 */
export function resolveIconSetVisual(itemCF) {
    const excelSet = itemCF.param6 || itemCF.excelIconSet || "";
    const type = itemCF.iconsettype || itemCF.iconType;
    const idx = typeof itemCF.iconIndex === "number" ? itemCF.iconIndex : -1;
    const total = typeof itemCF.iconTotal === "number" && (itemCF.iconTotal === 3 || itemCF.iconTotal === 5)
        ? itemCF.iconTotal
        : 0;

    if (idx >= 0 && total > 0 && excelSet && EXCEL_ICON_SET_GLYPHS[excelSet]) {
        const excelFamily = EXCEL_ICON_SET_GLYPHS[excelSet][total];
        const ramp = ICON_SET_COLORS[total];
        if (excelFamily && ramp) {
            const safeIdx = Math.max(0, Math.min(idx, excelFamily.length - 1));
            return { glyph: excelFamily[safeIdx], color: ramp[safeIdx] };
        }
    }

    if (idx < 0 || total === 0 || !ICON_SET_GLYPHS[type]) {
        return { glyph: null, color: itemCF.color || "#222" };
    }

    const family = ICON_SET_GLYPHS[type][total];
    const ramp = ICON_SET_COLORS[total];
    if (!family || !ramp) return { glyph: null, color: itemCF.color || "#222" };

    const safeIdx = Math.max(0, Math.min(idx, family.length - 1));
    return { glyph: family[safeIdx], color: ramp[safeIdx] };
}

/** Gap between IconSet glyph and the formatted value (Excel-like). */
const ICON_SET_TEXT_GAP_PX = 5;
/** Extra px above cell text size so icons read clearly beside values. */
const ICON_SET_SIZE_BONUS_PX = 4;
/** Hard cap — keeps icons inside typical row height without dominating the cell. */
const ICON_SET_MAX_SIZE_PX = 22;
const ICON_SET_STROKE_MAX_SIZE_PX = 26;

/** Icon size — match cell text; never exceed the cell ink box. */
function iconFontSizePx(fontSizeCssPx, inkAscent, inkDescent, cellHeightPx = 0, glyph = null) {
    const inkH = inkAscent + inkDescent;
    const inkCap = inkH > 0 ? Math.round(inkH) + 2 : fontSizeCssPx;
    const heightCap = cellHeightPx > 0 ? Math.max(10, cellHeightPx - 4) : ICON_SET_MAX_SIZE_PX;
    const maxPx = glyph && !isIconSetCircleGlyph(glyph) ? ICON_SET_STROKE_MAX_SIZE_PX : ICON_SET_MAX_SIZE_PX;
    const cap = Math.min(inkCap, heightCap, maxPx);
    let target = fontSizeCssPx + ICON_SET_SIZE_BONUS_PX;
    if (glyph && !isIconSetCircleGlyph(glyph)) {
        target = Math.round(target * ICON_SET_STROKE_SIZE_MULT);
    }
    return Math.min(Math.max(target, 11), cap);
}

/** Width of formatted cell text ink (matches DrawCell measure, incl. f_mo suffix). */
export function cellDisplayInkWidthPx(ctx, sCell, fontSizeCssPx) {
    const cellText = jsonViewCellDisplayText(sCell);
    ctx.font = `${fontSizeCssPx}px ${SK_DEFAULT_FONT}`;
    const textWidth = cellText.length > 0 ? ctx.measureText(cellText).width : 0;
    let unitWidth = 0;
    if (
        cellText.length > 0 &&
        sCell &&
        sCell.f_mo != null &&
        String(sCell.f_mo).trim() !== ""
    ) {
        unitWidth = ctx.measureText(" " + sCell.f_mo).width;
    }
    return Math.round(textWidth) + Math.round(unitWidth);
}

/** Horizontal space reserved for IconSets beside the value (icon + gap). */
export function measureIconSetBlockWidthPx(cfList, ctx, fontSizeCssPx, inkAscent = 0, inkDescent = 0) {
    if (!cfList?.length) {
        return 0;
    }
    ctx.save();
    try {
        const fontReady =
            (typeof window !== "undefined" && window.__SkMaterialSymbolsReady === true) ||
            (typeof document !== "undefined" &&
                document.fonts &&
                typeof document.fonts.check === "function" &&
                document.fonts.check('16px "Material Symbols Rounded"'));
        const asc = inkAscent > 0 ? inkAscent : fontSizeCssPx * 0.78;
        const desc = inkDescent > 0 ? inkDescent : fontSizeCssPx * 0.22;
        let maxBlock = 0;
        for (const itemCF of cfList) {
            if (itemCF?.type !== "IconSets") {
                continue;
            }
            const { glyph } = resolveIconSetVisual(itemCF);
            if (!glyph) {
                continue;
            }
            const iconFontSize = iconFontSizePx(fontSizeCssPx, asc, desc, 0, glyph);
            if (fontReady) {
                applyMaterialSymbolsIconCanvasFont(ctx, iconFontSize, glyph);
            } else {
                ctx.font = `${fontSizeCssPx}px ${SK_DEFAULT_FONT}`;
            }
            maxBlock = Math.max(
                maxBlock,
                Math.ceil(ctx.measureText(glyph).width) + ICON_SET_TEXT_GAP_PX
            );
        }
        return maxBlock;
    } finally {
        ctx.restore();
    }
}

/**
 * Paint IconSets using the same ink anchors as DrawCell (no coordinate drift).
 * @param {CanvasRenderingContext2D} ctx
 * @param {object[]} cfList - IconSets items (usually mirrored from column F onto E)
 * @param {{ textPosX: number, baselineY: number, textWidth?: number, alignment?: string, fontSizeCssPx?: number, inkAscent?: number, inkDescent?: number, iconBlock?: number, iconPlacement?: 'before'|'after'|'cellLeft', iconLeftX?: number }} layout
 */
export function drawIconSetsAlignedToCellText(ctx, cfList, layout) {
    if (!cfList?.length || !layout) {
        return;
    }
    const textPosX = Number(layout.textPosX);
    const baselineY = Number(layout.baselineY);
    if (!Number.isFinite(textPosX) || !Number.isFinite(baselineY)) {
        return;
    }
    const alignment = layout.alignment || "right";
    const iconPlacement = layout.iconPlacement === "after"
        ? "after"
        : layout.iconPlacement === "cellLeft"
          ? "cellLeft"
          : "before";
    const textWidth = Number(layout.textWidth) >= 0 ? Number(layout.textWidth) : 0;
    const fontSizeCssPx = Number(layout.fontSizeCssPx) > 0 ? Number(layout.fontSizeCssPx) : 11;
    const inkAscent = Number(layout.inkAscent) > 0 ? Number(layout.inkAscent) : fontSizeCssPx * 0.78;
    const inkDescent = Number(layout.inkDescent) > 0 ? Number(layout.inkDescent) : fontSizeCssPx * 0.22;

    const fontReady =
        (typeof window !== "undefined" && window.__SkMaterialSymbolsReady === true) ||
        (typeof document !== "undefined" &&
            document.fonts &&
            typeof document.fonts.check === "function" &&
            document.fonts.check('16px "Material Symbols Rounded"'));

    ctx.save();
    for (const itemCF of cfList) {
        if (itemCF?.type !== "IconSets") {
            continue;
        }
        const { glyph, color } = resolveIconSetVisual(itemCF);
        if (!glyph && !itemCF.iconString) {
            continue;
        }

        const iconFontSize = iconFontSizePx(fontSizeCssPx, inkAscent, inkDescent, 0, glyph);
        let iconWidth = 12;
        if (glyph && fontReady) {
            applyMaterialSymbolsIconCanvasFont(ctx, iconFontSize, glyph);
            iconWidth = ctx.measureText(glyph).width;
        } else if (glyph) {
            ctx.font = `${fontSizeCssPx}px ${SK_DEFAULT_FONT}`;
            iconWidth = ctx.measureText(glyph).width;
        }

        let iconX;
        if (iconPlacement === "cellLeft") {
            const leftX = Number(layout.iconLeftX);
            iconX = Number.isFinite(leftX) ? leftX : textPosX;
        } else if (iconPlacement === "after") {
            iconX = textPosX + textWidth + ICON_SET_TEXT_GAP_PX;
        } else if (alignment === "left") {
            iconX = textPosX - iconWidth - ICON_SET_TEXT_GAP_PX;
        } else if (alignment === "center") {
            iconX = textPosX - iconWidth - ICON_SET_TEXT_GAP_PX;
        } else {
            iconX = textPosX - ICON_SET_TEXT_GAP_PX - iconWidth;
        }

        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = color;

        if (glyph && fontReady) {
            const iconY = baselineY - inkDescent * 0.08;
            paintMaterialSymbolIcon(ctx, glyph, iconX, iconY, iconFontSize);
        } else {
            ctx.font = `${fontSizeCssPx}px ${SK_DEFAULT_FONT}`;
            const legacy =
                glyph === MS.circle ? LEGACY_FILLED_CIRCLE : (itemCF.iconString || "");
            ctx.fillText(legacy, Math.round(iconX), baselineY);
        }
    }
    ctx.restore();
}

/** Excel General horizontal when JsonView omits f_ah: numbers right, text/empty left. */
function iconSetCellUsesLeftAlign(sCell, isEmptyDisplay) {
    if (!sCell) {
        return isEmptyDisplay;
    }
    if (sCell.hasOwnProperty("f_ah")) {
        switch (sCell.f_ah) {
            case 2:
                return true;
            case 3:
                return false;
            case 4:
                return false;
            case 1:
            default:
                break;
        }
    }
    if (isEmptyDisplay) {
        return true;
    }
    const t = sCell.c_t;
    return t !== "i" && t !== "d" && t !== "da";
}

/**
 * Excel draws IconSets immediately left of the formatted cell value (same
 * horizontal anchor as DrawCell), not flush against the cell's left border.
 */
function iconSetHorizontalAnchorX(ctx, sCell, innerLeft, innerWidth, glyph, iconFontSize, baseFontSize, fontReady) {
    const glyphPad = 2;
    const iconGap = 3;
    const textWidth = cellDisplayInkWidthPx(ctx, sCell, baseFontSize);
    const isEmptyDisplay = jsonViewCellDisplayText(sCell).length === 0 && textWidth === 0;
    const iconBlock = measureIconSetBlockWidthPx(sCell, ctx, baseFontSize);

    let textAnchorX;
    if (iconSetCellUsesLeftAlign(sCell, isEmptyDisplay)) {
        textAnchorX = innerLeft + glyphPad + iconBlock;
    } else if (sCell && sCell.f_ah === 4) {
        textAnchorX = innerLeft + Math.max(glyphPad, (innerWidth - textWidth - iconBlock) / 2) + iconBlock;
    } else {
        textAnchorX = innerLeft + innerWidth - textWidth - glyphPad - iconBlock;
    }

    let iconWidth = 12;
    if (glyph && fontReady) {
        applyMaterialSymbolsIconCanvasFont(ctx, iconFontSize, glyph);
        iconWidth = ctx.measureText(glyph).width;
    } else if (glyph) {
        iconWidth = ctx.measureText(glyph).width;
    }

    if (iconSetCellUsesLeftAlign(sCell, isEmptyDisplay)) {
        return innerLeft + glyphPad;
    }
    return Math.max(innerLeft, textAnchorX - iconGap - iconWidth);
}

/**
 * Draws IconSets conditional formatting using Material Symbols Rounded.
 * @param {Object} itemCF - The conditional formatting item (iconType, iconIndex, iconTotal, iconString)
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} cellRect - Cell rectangle {x, y, width, height}
 * @param {Object} sCell - The cell descriptor (used for padding & alignment)
 */
export function drawIconSets(itemCF, ctx, cellRect, sCell) {
    if (!itemCF || (itemCF.iconsettype || itemCF.iconType) === "None") return;

    const { glyph, color } = resolveIconSetVisual(itemCF);
    // If we have neither a Material Symbols glyph nor a legacy iconString,
    // there is nothing to draw — skip silently rather than blanking the cell.
    if (!glyph && !itemCF.iconString) return;

    ctx.save();

    const baseFontSize = (sCell && sCell.hasOwnProperty("f_f_s")) ? sCell.f_f_s : 10;
    const iconFontSize = iconFontSizePx(baseFontSize, baseFontSize * 0.78, baseFontSize * 0.22, cellRect.height, glyph);

    let padding = 5;
    if (sCell && sCell.hasOwnProperty("f_p")) {
        padding = sCell.f_p;
    }
    const paddingText = padding + 0.1;

    const adjustedX = cellRect.x + paddingText;
    const adjustedY = cellRect.y + paddingText;
    const adjustedWidth = cellRect.width - (paddingText * 2);
    const adjustedHeight = cellRect.height - (paddingText * 2);

    const fontReady =
        (typeof window !== "undefined" && window.__SkMaterialSymbolsReady === true) ||
        (typeof document !== "undefined" &&
            document.fonts &&
            typeof document.fonts.check === "function" &&
            document.fonts.check('16px "Material Symbols Rounded"'));

    const iconX = iconSetHorizontalAnchorX(
        ctx,
        sCell,
        adjustedX,
        adjustedWidth,
        glyph,
        iconFontSize,
        baseFontSize,
        fontReady
    );

    // Excel default vertical align is bottom when f_av is omitted (matches DrawCell).
    const fav = sCell && sCell.hasOwnProperty("f_av") ? Number(sCell.f_av) : 9;
    let iconY = adjustedY + adjustedHeight / 2;
    let textBaseline = "middle";
    switch (fav) {
        case 5:
        case 8:
            iconY = adjustedY;
            textBaseline = "top";
            break;
        case 9:
        case 6:
            iconY = adjustedY + adjustedHeight;
            textBaseline = "bottom";
            break;
        case 7:
            iconY = adjustedY + adjustedHeight / 2;
            textBaseline = "middle";
            break;
        default:
            iconY = adjustedY + adjustedHeight / 2;
            textBaseline = "middle";
            break;
    }

    ctx.textAlign = "left";
    ctx.textBaseline = textBaseline;
    ctx.fillStyle = color;

    if (glyph && fontReady) {
        paintMaterialSymbolIcon(ctx, glyph, iconX, iconY, iconFontSize);
    } else {
        // Older .sker / font not ready: avoid hollow ◯ from OOXML Shapes preset.
        ctx.font = `${baseFontSize}px ${SK_DEFAULT_FONT}`;
        ctx.fillStyle = color;
        const legacy =
            glyph === MS.circle ? LEGACY_FILLED_CIRCLE : (itemCF.iconString || "");
        ctx.fillText(legacy, iconX, iconY);
    }

    ctx.restore();
}

//=============================================================================
// Utility Functions for Conditional Formatting
//=============================================================================

/**
 * Calculates percentage for data bars
 * @param {Number} value - Current value
 * @param {Number} minValue - Minimum value
 * @param {Number} maxValue - Maximum value
 * @returns {Number} Percentage between 0 and 1
 */
export function calculatePercentage(value, minValue, maxValue) {
    if (maxValue === minValue) return 0.5;
    return Math.max(0, Math.min(1, (value - minValue) / (maxValue - minValue)));
}

/**
 * Lightens a color by a given factor
 * @param {String} hexColor - Hex color string
 * @param {Number} factor - Lightening factor (0-1)
 * @returns {String} Lightened hex color
 */
export function lightenColor(hexColor, factor) {
    const rgb = hexToRgb(hexColor);
    if (!rgb) return hexColor;
    
    const r = Math.round(rgb.r + (255 - rgb.r) * factor);
    const g = Math.round(rgb.g + (255 - rgb.g) * factor);
    const b = Math.round(rgb.b + (255 - rgb.b) * factor);
    
    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Normalizes hex color string to ensure it starts with #
 * @param {String} color - Color string (with or without #)
 * @returns {String} Normalized color string with #
 */
export function normalizeHexColor(color) {
    if (!color || typeof color !== 'string') return color;
    // Check if it's a valid hex color (6 hex digits)
    if (/^[0-9A-Fa-f]{6}$/.test(color)) {
        return `#${color}`;
    }
    // Return as is if already has # or is rgba, etc.
    return color;
}

/**
 * Converts hex color to RGB object
 * @param {String} hex - Hex color string
 * @returns {Object|null} RGB object or null if invalid
 */
export function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

/**
 * Interpolates between two colors
 * @param {String} color1 - First hex color
 * @param {String} color2 - Second hex color
 * @param {Number} factor - Interpolation factor (0-1)
 * @returns {String} Interpolated RGB color
 */
export function interpolateColor(color1, color2, factor) {
    const rgb1 = hexToRgb(color1);
    const rgb2 = hexToRgb(color2);
    
    if (!rgb1 || !rgb2) return color1;
    
    const r = Math.round(rgb1.r + (rgb2.r - rgb1.r) * factor);
    const g = Math.round(rgb1.g + (rgb2.g - rgb1.g) * factor);
    const b = Math.round(rgb1.b + (rgb2.b - rgb1.b) * factor);
    
    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * DataBars paint behind cell text (Pass A background).
 */
export function renderConditionalFormattingDataBars(sCell, ctx, cellRect) {
    if (!sCell || !Array.isArray(sCell.c_cf)) {
        return;
    }
    ctx.save();
    sCell.c_cf.forEach((itemCF) => {
        if (itemCF?.type === "DataBars") {
            drawDataBars(itemCF, ctx, cellRect, sCell);
        }
    });
    ctx.restore();
}

/**
 * IconSets paint on top of cell text (Pass B2 foreground).
 */
export function renderConditionalFormattingIconSets(sCell, ctx, cellRect) {
    if (!sCell || !Array.isArray(sCell.c_cf)) {
        return;
    }
    ctx.save();
    sCell.c_cf.forEach((itemCF) => {
        if (itemCF?.type === "IconSets") {
            drawIconSets(itemCF, ctx, cellRect, sCell);
        }
    });
    ctx.restore();
}

/**
 * Main function to render all conditional formatting for a cell
 * @param {Object} sCell - Cell object with c_cf array
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} cellRect - Cell rectangle {x, y, width, height}
 */
export function renderConditionalFormatting(sCell, ctx, cellRect) {
    renderConditionalFormattingDataBars(sCell, ctx, cellRect);
    renderConditionalFormattingIconSets(sCell, ctx, cellRect);
}

/**
 * Keep a position:absolute popup inside the viewport by applying a horizontal
 * translateX shift. Preserves the anchor (left: 0) and works for toolbar cards.
 */
export function alignPopupWithinViewport(popupEl, margin = 8) {
    if (!popupEl || typeof popupEl.getBoundingClientRect !== 'function') {
        return;
    }

    popupEl.style.transform = '';

    const rect = popupEl.getBoundingClientRect();
    const vw = window.innerWidth;
    let shiftX = 0;

    if (rect.right > vw - margin) {
        shiftX = (vw - margin) - rect.right;
    }
    if (rect.left + shiftX < margin) {
        shiftX = margin - rect.left;
    }
    if (shiftX !== 0) {
        popupEl.style.transform = `translateX(${shiftX}px)`;
    }
}