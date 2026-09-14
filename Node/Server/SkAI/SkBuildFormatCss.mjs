//=============================================================================
// SkBuildFormatCss.mjs — build sker CSS for apply_format / write_formatted_cell (llama-safe)
//=============================================================================

import { normalizeSkerCss } from '../SkSpreadSheet/SkSkerCss.mjs';

/** US English color names → hex (CSS-style). */
const NAMED_COLORS = {
  lightblue: '#ADD8E6',
  lightgreen: '#90EE90',
  lightyellow: '#FFFFE0',
  lightgray: '#D3D3D3',
  lightgrey: '#D3D3D3',
  white: '#FFFFFF',
  black: '#000000',
  red: '#FF0000',
  blue: '#0000FF',
  green: '#008000',
  yellow: '#FFFF00',
  orange: '#FFA500',
  gray: '#808080',
  grey: '#808080',
};

/**
 * @param {string|undefined} color
 * @returns {string|undefined}
 */
export function normalizeCssColor(color) {
  if (color == null || color === '') {
    return undefined;
  }
  const wRaw = String(color).trim();
  if (/^#[0-9A-Fa-f]{3,8}$/.test(wRaw)) {
    return wRaw;
  }
  const wKey = wRaw.toLowerCase();
  if (NAMED_COLORS[wKey]) {
    return NAMED_COLORS[wKey];
  }
  const wCompact = wKey.replace(/\s+/g, '');
  if (NAMED_COLORS[wCompact]) {
    return NAMED_COLORS[wCompact];
  }
  return wRaw;
}

/**
 * Build CSS from structured flags — avoids fragile css strings in LLM JSON.
 * @param {{
 *   bold?: boolean,
 *   italic?: boolean,
 *   underline?: boolean,
 *   backgroundColor?: string,
 *   color?: string,
 *   fontFamily?: string,
 *   fontSizePt?: number,
 *   textAlign?: string,
 *   verticalAlign?: string,
 *   border?: string,
 *   wrap?: boolean,
 * }} opts
 * @returns {string}
 */
export function buildFormatCssFromStructuredArgs(opts) {
  const wParts = [];
  if (opts.bold === true) {
    wParts.push('font-weight:bold');
  }
  if (opts.italic === true) {
    wParts.push('font-style:italic');
  }
  if (opts.underline === true) {
    wParts.push('text-decoration:underline');
  }
  const wBg = normalizeCssColor(opts.backgroundColor);
  if (wBg) {
    wParts.push(`background-color:${wBg}`);
  }
  const wFg = normalizeCssColor(opts.color);
  if (wFg) {
    wParts.push(`color:${wFg}`);
  }
  if (opts.fontFamily) {
    wParts.push(`font-family:${String(opts.fontFamily).trim()}`);
  }
  const wSize = Number(opts.fontSizePt);
  if (Number.isFinite(wSize) && wSize > 0) {
    wParts.push(`font-size:${wSize}pt`);
  }
  const wAlign = String(opts.textAlign || '').trim().toLowerCase();
  if (wAlign === 'left' || wAlign === 'center' || wAlign === 'right') {
    wParts.push(`text-align:${wAlign}`);
  }
  const wVAlign = String(opts.verticalAlign || '').trim().toLowerCase();
  if (wVAlign === 'top' || wVAlign === 'middle' || wVAlign === 'bottom') {
    wParts.push(`vertical-align:${wVAlign}`);
  }
  if (opts.border) {
    wParts.push(`border:${String(opts.border).trim()}`);
  }
  if (opts.wrap === true) {
    wParts.push('white-space:normal');
  } else if (opts.wrap === false) {
    wParts.push('white-space:nowrap');
  }
  if (wParts.length === 0) {
    return '';
  }
  return `${wParts.join(';')};`;
}

/**
 * Merge css string, properties[] and structured flags for apply_format.
 * @param {Record<string, unknown>} args
 * @returns {string}
 */
export function buildFormatCssFromApplyFormatArgs(args) {
  const wChunks = [];
  const wFromFlags = buildFormatCssFromStructuredArgs({
    bold: args.bold === true,
    italic: args.italic === true,
    underline: args.underline === true,
    backgroundColor: args.backgroundColor != null ? String(args.backgroundColor) : undefined,
    color: args.color != null ? String(args.color) : undefined,
    fontFamily: args.fontFamily != null ? String(args.fontFamily) : undefined,
    fontSizePt: args.fontSizePt,
    textAlign: args.textAlign != null ? String(args.textAlign) : undefined,
    verticalAlign: args.verticalAlign != null ? String(args.verticalAlign) : undefined,
    border: args.border != null ? String(args.border) : undefined,
    wrap: typeof args.wrap === 'boolean' ? args.wrap : undefined,
  });
  if (wFromFlags) {
    wChunks.push(wFromFlags.replace(/;+$/, ''));
  }

  if (Array.isArray(args.properties)) {
    for (const wProp of args.properties) {
      const wLine = String(wProp ?? '')
        .trim()
        .replace(/;+$/, '');
      if (wLine) {
        wChunks.push(wLine);
      }
    }
  }

  const wCss = String(args.css ?? '')
    .trim()
    .replace(/;+$/, '');
  if (wCss) {
    wChunks.push(wCss);
  }

  if (wChunks.length === 0) {
    throw new Error(
      'apply_format: provide css, properties[], or style flags (bold, backgroundColor, textAlign, …)'
    );
  }

  return normalizeSkerCss(wChunks.join(';'));
}
