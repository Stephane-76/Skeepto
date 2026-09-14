//=============================================================================
// JsonView (sCss=true) → HTML <table> for TipTap / rich text embed.
//=============================================================================
import { mergeAttributes } from '@tiptap/core';
import { GetTextAlign, GetVerticalTextAlign } from '../utility/SkUtility.js';
import { jsonViewCellDisplayText } from '../utility/jsonViewCellText.js';
import {
  SKER_FORMAT_INDEX_ATTR,
  SKER_FORMATS_ATTR,
  SK_STYLE_ATTR,
  escapeSpreadsheetFormatPoolHtml,
  indexFormatStyleInPool,
  spacingFieldToDeclaration,
} from './SkeeptoTableFormatPool.js';

const CSS_PADDING_KEYS = ['f_p', 'f_pt', 'f_pl', 'f_pb', 'f_pr'];
const CSS_MARGIN_KEYS = ['f_m', 'f_mt', 'f_ml', 'f_mb', 'f_mr'];
const MIN_COLUMN_PX = 8;
/** Excel default when JsonView omits f_av (bottom). */
const EXCEL_DEFAULT_F_AV = 9;

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function excelGeneralHorizontalLeft(cell, displayText) {
  const text = String(displayText ?? '').trim();
  if (!text) return true;
  const t = cell?.c_t;
  return t !== 'i' && t !== 'd' && t !== 'da';
}

function spreadsheetHAlignKeyFromCell(cell) {
  if (cell && Object.prototype.hasOwnProperty.call(cell, 'f_ah')) {
    const align = GetTextAlign(Number(cell.f_ah));
    if (align === 'start') return 'left';
    if (align === 'end') return 'right';
    if (align === 'center') return 'center';
  }
  const displayText = jsonViewCellDisplayText(cell);
  return excelGeneralHorizontalLeft(cell, displayText) ? 'left' : 'right';
}

function cssTextAlignFromCell(cell) {
  return `text-align:${spreadsheetHAlignKeyFromCell(cell)}`;
}

function spreadsheetVAlignKeyFromCell(cell) {
  const raw = Object.prototype.hasOwnProperty.call(cell || {}, 'f_av')
    ? Number(cell.f_av)
    : EXCEL_DEFAULT_F_AV;
  const vAlign = GetVerticalTextAlign(Number.isFinite(raw) ? raw : EXCEL_DEFAULT_F_AV);
  if (vAlign === 'center') return 'middle';
  if (vAlign === 'end') return 'bottom';
  return 'top';
}

function cssVerticalAlignFromCell(cell) {
  const key = spreadsheetVAlignKeyFromCell(cell);
  if (key === 'middle') return 'vertical-align:middle';
  if (key === 'bottom') return 'vertical-align:bottom';
  return 'vertical-align:top';
}

function appendSpacingFields(styles, cell, keys) {
  for (const key of keys) {
    if (cell[key] == null || String(cell[key]).trim() === '') {
      continue;
    }
    const decl = spacingFieldToDeclaration(key, cell[key]);
    if (decl) {
      styles.push(decl);
    }
  }
}

/** JsonView sCss=true emits border values without property names — prefix them. */
function borderValueToDeclaration(property, raw) {
  if (raw == null) return null;
  const value = String(raw).trim().replace(/;+$/, '');
  if (!value) return null;
  if (/^border(-top|-right|-bottom|-left)?\s*:/i.test(value) || /^border\s*:/i.test(value)) {
    return value.endsWith(';') ? value : `${value};`;
  }
  return `${property}:${value};`;
}

function appendBorderStyles(styles, cell, cellMap, row, col) {
  const self = cell || {};
  if (self.f_bo) {
    const decl = borderValueToDeclaration('border', self.f_bo);
    if (decl) styles.push(decl);
  }

  const leftCell = cellMap.get(`${row},${col - 1}`);
  const topCell = cellMap.get(`${row - 1},${col}`);

  const leftDecl = borderValueToDeclaration(
    'border-left',
    self.f_bol || leftCell?.f_bor
  );
  if (leftDecl) styles.push(leftDecl);

  const topDecl = borderValueToDeclaration(
    'border-top',
    self.f_bot || topCell?.f_bob
  );
  if (topDecl) styles.push(topDecl);

  const rightDecl = borderValueToDeclaration('border-right', self.f_bor);
  if (rightDecl) styles.push(rightDecl);

  const bottomDecl = borderValueToDeclaration('border-bottom', self.f_bob);
  if (bottomDecl) styles.push(bottomDecl);
}

/** Formatting only — width/height come from colwidth / data-row-h (TipTap-safe). */
function buildFormatStyle(cell, cellMap, row, col) {
  const styles = [];
  if (cell?.f_bc) {
    styles.push(`background-color:${cell.f_bc}`);
  }
  if (cell?.f_c) {
    styles.push(`color:${cell.f_c}`);
  }
  appendBorderStyles(styles, cell, cellMap, row, col);
  appendSpacingFields(styles, cell, CSS_PADDING_KEYS);
  appendSpacingFields(styles, cell, CSS_MARGIN_KEYS);
  styles.push(cssTextAlignFromCell(cell));
  const vAlign = cssVerticalAlignFromCell(cell);
  if (vAlign) styles.push(vAlign);
  if (cell?.f_f_n) {
    styles.push(`font-family:"${String(cell.f_f_n).replace(/"/g, '\\"')}"`);
  }
  if (cell?.f_f_s != null && cell.f_f_s !== '') {
    styles.push(`font-size:${cell.f_f_s}pt`);
  }
  if (Number(cell?.f_we) === 3) {
    styles.push('font-weight:bold');
  }
  if (Number(cell?.f_st) === 3) {
    styles.push('font-style:italic');
  }
  const decorations = [];
  if (Object.prototype.hasOwnProperty.call(cell || {}, 'f_d_u')) decorations.push('underline');
  if (Object.prototype.hasOwnProperty.call(cell || {}, 'f_d_l')) decorations.push('line-through');
  if (decorations.length > 0) {
    styles.push(`text-decoration:${decorations.join(' ')}`);
  }
  if (Number(cell?.f_tw) === 2) {
    styles.push('white-space:normal');
  } else if (Number(cell?.f_tw) === 3) {
    styles.push('white-space:nowrap');
  }
  return styles.join(';');
}

function buildCellMap(uiView) {
  const map = new Map();
  for (const row of uiView?.rows || []) {
    for (const cell of row?.cells || []) {
      if (cell?.c__l || cell?.c__r) continue;
      const r = Number(cell?.c_r);
      const c = Number(cell?.c_c);
      if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
      map.set(`${r},${c}`, cell);
    }
  }
  return map;
}

function buildMergeAnchorMap(uiView) {
  const anchors = new Map();
  const covered = new Set();
  const merges = Array.isArray(uiView?.merges) ? uiView.merges : [];
  for (const merge of merges) {
    const top = Number(merge.r_t);
    const left = Number(merge.r_l);
    const bottom = Number(merge.r_b);
    const right = Number(merge.r_r);
    if (![top, left, bottom, right].every(Number.isFinite)) continue;
    anchors.set(`${top},${left}`, { top, left, bottom, right });
    for (let r = top; r <= bottom; r += 1) {
      for (let c = left; c <= right; c += 1) {
        if (r !== top || c !== left) {
          covered.add(`${r},${c}`);
        }
      }
    }
  }
  return { anchors, covered };
}

function columnsFromJsonView(uiView, bounds, cellMap) {
  const raw = (Array.isArray(uiView?.cols) ? uiView.cols : [])
    .map((entry) => ({
      col: Number(entry?.i),
      width: Math.round(Number(entry?.s) || 0),
    }))
    .filter((entry) => (
      Number.isFinite(entry.col)
      && entry.col >= bounds.left
      && entry.col <= bounds.right
    ));

  const list = raw.length > 0
    ? raw
    : Array.from({ length: bounds.right - bounds.left + 1 }, (_, idx) => ({
      col: bounds.left + idx,
      width: 0,
    }));

  return list.filter((entry) => {
    if (entry.width >= MIN_COLUMN_PX) return true;
    for (let row = bounds.top; row <= bounds.bottom; row += 1) {
      const cell = cellMap.get(`${row},${entry.col}`);
      if (!cell) continue;
      if (jsonViewCellDisplayText(cell)) return true;
      if (cell.f_bc || cell.f_bor || cell.f_bot || cell.f_bol || cell.f_bob || cell.f_bo) return true;
    }
    return false;
  });
}

function rowsFromJsonView(uiView, bounds) {
  const raw = (Array.isArray(uiView?.rows) ? uiView.rows : [])
    .map((entry) => ({
      row: Number(entry?.i),
      height: Math.round(Number(entry?.s) || 0),
    }))
    .filter((entry) => (
      Number.isFinite(entry.row)
      && entry.row >= bounds.top
      && entry.row <= bounds.bottom
    ));

  if (raw.length > 0) return raw;

  return Array.from({ length: bounds.bottom - bounds.top + 1 }, (_, idx) => ({
    row: bounds.top + idx,
    height: 0,
  }));
}

function sumRowHeights(rows, merge, startRow) {
  if (!merge) {
    const hit = rows.find((r) => r.row === startRow);
    return hit?.height || 0;
  }
  let total = 0;
  for (let r = merge.top; r <= merge.bottom; r += 1) {
    const hit = rows.find((row) => row.row === r);
    total += hit?.height || 0;
  }
  return total;
}

function colwidthAttribute(columns, merge, col) {
  if (!merge) {
    const w = columns.find((c) => c.col === col)?.width || 0;
    return w > 0 ? String(w) : '';
  }
  const parts = [];
  for (let c = merge.left; c <= merge.right; c += 1) {
    const w = columns.find((entry) => entry.col === c)?.width || 0;
    parts.push(w > 0 ? w : 1);
  }
  return parts.join(',');
}

/**
 * @param {object} uiView — parsed JsonView (hydrate formats[] first)
 * @param {{ top: number, left: number, bottom: number, right: number }} bounds
 * @returns {string} HTML table fragment
 */
export function jsonViewToHtmlTable(uiView, bounds) {
  if (!uiView || !bounds) return '';

  const cellMap = buildCellMap(uiView);
  const { anchors, covered } = buildMergeAnchorMap(uiView);
  const columns = columnsFromJsonView(uiView, bounds, cellMap);
  const rows = rowsFromJsonView(uiView, bounds);

  if (columns.length === 0 || rows.length === 0) return '';

  const formatPool = [];
  const formatIndexByStyle = new Map();

  const colgroup = columns
    .map((entry) => {
      const w = entry.width > 0 ? entry.width : 1;
      return `<col style="width:${w}px" width="${w}" />`;
    })
    .join('');

  const rowsHtml = [];
  for (const rowEntry of rows) {
    const row = rowEntry.row;
    const cellsHtml = [];

    for (const colEntry of columns) {
      const col = colEntry.col;
      const key = `${row},${col}`;
      if (covered.has(key)) continue;

      const cell = cellMap.get(key) || { c_r: row, c_c: col };
      const merge = anchors.get(key);
      const rowspan = merge ? merge.bottom - merge.top + 1 : 1;
      const colspan = merge ? merge.right - merge.left + 1 : 1;
      const rowHeightPx = sumRowHeights(rows, merge, row);
      const formatStyle = buildFormatStyle(cell, cellMap, row, col);
      const formatIndex = indexFormatStyleInPool(formatPool, formatIndexByStyle, formatStyle);
      const colwidth = colwidthAttribute(columns, merge, col);
      const vAlignKey = spreadsheetVAlignKeyFromCell(cell);
      const hAlignKey = spreadsheetHAlignKeyFromCell(cell);
      const text = escapeHtml(jsonViewCellDisplayText(cell));
      const layoutStyle = rowHeightPx > 0
        ? `height:${rowHeightPx}px;min-height:${rowHeightPx}px`
        : '';

      const attrs = [
        'class="SkSpCell"',
        cell?.f_bc ? `data-bg="${escapeHtml(cell.f_bc)}"` : '',
        `data-v-align="${vAlignKey}"`,
        `data-h-align="${hAlignKey}"`,
        colwidth ? `colwidth="${colwidth}"` : '',
        rowHeightPx > 0 ? `data-row-h="${rowHeightPx}"` : '',
        formatIndex != null ? `${SKER_FORMAT_INDEX_ATTR}="${formatIndex}"` : '',
        layoutStyle ? `style="${escapeHtml(layoutStyle)}"` : '',
        rowspan > 1 ? `rowspan="${rowspan}"` : '',
        colspan > 1 ? `colspan="${colspan}"` : '',
      ].filter(Boolean).join(' ');

      cellsHtml.push(`<td ${attrs}><p>${text || '<br>'}</p></td>`);
    }

    rowsHtml.push(`<tr>${cellsHtml.join('')}</tr>`);
  }

  const tableAttrs = [
    'class="SkTextEditor-spreadsheetTable SkTextEditor-spreadsheetTable--imported"',
    formatPool.length > 0
      ? `${SKER_FORMATS_ATTR}="${escapeSpreadsheetFormatPoolHtml(JSON.stringify(formatPool))}"`
      : '',
  ].filter(Boolean).join(' ');

  return [
    `<table ${tableAttrs}>`,
    `<colgroup>${colgroup}</colgroup>`,
    `<tbody>${rowsHtml.join('')}</tbody>`,
    '</table>',
  ].join('');
}

/** TipTap cell extension helpers — merged styles for round-trip. */
export function mergeSpreadsheetCellHtmlAttributes(node, baseAttributes, optionsAttributes) {
  const styles = [];
  if (node.attrs.rowHeight) {
    styles.push(`height:${node.attrs.rowHeight}px`, `min-height:${node.attrs.rowHeight}px`);
  }
  if (node.attrs.backgroundColor) {
    styles.push(`background-color:${node.attrs.backgroundColor}`);
  }
  if (node.attrs.skStyle) {
    styles.push(node.attrs.skStyle);
  }

  const attrs = mergeAttributes(optionsAttributes, baseAttributes);
  if (styles.length > 0) {
    attrs.style = [attrs.style, styles.join(';')].filter(Boolean).join(';');
  }
  if (node.attrs.rowHeight) {
    attrs['data-row-h'] = node.attrs.rowHeight;
  }
  if (node.attrs.skStyle) {
    attrs[SK_STYLE_ATTR] = node.attrs.skStyle;
  }
  if (node.attrs.vAlign) {
    attrs['data-v-align'] = node.attrs.vAlign;
  }
  if (node.attrs.hAlign) {
    attrs['data-h-align'] = node.attrs.hAlign;
  }
  if (Array.isArray(node.attrs.colwidth) && node.attrs.colwidth.length > 0) {
    attrs.colwidth = node.attrs.colwidth.join(',');
  }
  if (node.attrs.backgroundColor) {
    attrs['data-bg'] = node.attrs.backgroundColor;
  }
  return attrs;
}
