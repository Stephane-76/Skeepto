/**
 * Canvas 2D font string cache for cell paint passes.
 */
import {
  buildCanvasFontFamily,
  GetFontStyle,
  GetFontWeight,
} from './SkUtility.js';

const g_fontStringCache = new Map();

/** CSS reference px per typographic point (96 dpi). */
export const CSS_PX_PER_PT = 96 / 72;

/** Read Excel/font JSON size as points (accepts number or "11"/"11pt"/"14px"). */
export function fontSizePtFromCell(sCell, defaultPt = 11) {
  const raw = sCell?.f_f_s;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    const match = trimmed.match(/^([\d.]+)\s*(pt|px)?$/i);
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > 0) {
        if ((match[2] || 'pt').toLowerCase() === 'px') {
          return (n * 72) / 96;
        }
        return n;
      }
    }
  }
  return defaultPt;
}

/** Typographic pt → CSS px for canvas `font` (matches Excel at 96 dpi). */
export function fontSizeCssPxFromPt(sizePt) {
  const pt = Number(sizePt);
  if (!Number.isFinite(pt) || pt <= 0) {
    return Math.round(11 * CSS_PX_PER_PT * 100) / 100;
  }
  return Math.round(pt * CSS_PX_PER_PT * 100) / 100;
}

function canvasWeightFromCell(sCell) {
  const we = sCell?.hasOwnProperty('f_we') ? Number(sCell.f_we) : 1;
  // Enum 6 = numeric weight in C++; JsonView may omit wi — never emit invalid "integer".
  if (we === 6) {
    const wi = Number(sCell?.f_wi ?? sCell?.wi ?? 0);
    if (Number.isFinite(wi) && wi >= 1 && wi <= 1000) {
      return String(Math.round(wi));
    }
    return '';
  }
  return GetFontWeight(we);
}

/** @param {object} sCell JsonView cell */
export function canvasFontKeyFromCell(sCell) {
  const n = sCell?.hasOwnProperty('f_f_n') ? String(sCell.f_f_n) : 'Roboto';
  const s = fontSizePtFromCell(sCell, 11);
  const st = sCell?.hasOwnProperty('f_st') ? Number(sCell.f_st) : 1;
  const we = sCell?.hasOwnProperty('f_we') ? Number(sCell.f_we) : 1;
  const wi =
    sCell?.hasOwnProperty('f_wi') || sCell?.hasOwnProperty('wi')
      ? Number(sCell.f_wi ?? sCell.wi)
      : 0;
  return `${st}|${we}|${wi}|${s}|${n}`;
}

function buildFontString(style, weight, sizePt, fontName) {
  const parts = [];
  if (style) {
    parts.push(style);
  }
  if (weight) {
    parts.push(weight);
  }
  parts.push(`${fontSizeCssPxFromPt(sizePt)}px`);
  parts.push(buildCanvasFontFamily(fontName));
  return parts.join(' ');
}

/** @param {object} sCell JsonView cell */
export function canvasFontStringFromCell(sCell) {
  const key = canvasFontKeyFromCell(sCell);
  const cached = g_fontStringCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const style = GetFontStyle(sCell?.hasOwnProperty('f_st') ? sCell.f_st : 1);
  const weight = canvasWeightFromCell(sCell);
  const sizePt = fontSizePtFromCell(sCell, 11);
  const fontName = sCell?.hasOwnProperty('f_f_n') ? sCell.f_f_n : 'Roboto';
  const font = buildFontString(style, weight, sizePt, fontName);
  g_fontStringCache.set(key, font);
  return font;
}

export function createFontPaintState() {
  return { lastKey: null };
}

/** @param {CanvasRenderingContext2D} sContext */
export function applyCanvasFontFromCell(sContext, sCell, sState) {
  const key = canvasFontKeyFromCell(sCell);
  const font = canvasFontStringFromCell(sCell);
  // Always assign: canvas.width reset clears ctx.font; skip caused 10px fallback on first cell.
  sContext.font = font;
  if (sState != null) {
    sState.lastKey = key;
  }
}
