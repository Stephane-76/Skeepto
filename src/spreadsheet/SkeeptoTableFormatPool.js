//=============================================================================
// Per-table spreadsheet format pool (JsonView-style f_i) for TipTap HTML.
//=============================================================================

export const SKER_FORMATS_ATTR = 'data-sker-formats';
export const SKER_FORMAT_INDEX_ATTR = 'data-f-i';
export const SK_STYLE_ATTR = 'skstyle';
/** @deprecated legacy TipTap HTML attribute */
export const LEGACY_SPREADSHEET_STYLE_ATTR = 'spreadsheetstyle';
/** @deprecated legacy cell format attribute */
export const LEGACY_DATA_CELL_STYLE_ATTR = 'data-cell-style';

const SPACING_PROPERTY_BY_KEY = {
  f_p: 'padding',
  f_pt: 'padding-top',
  f_pl: 'padding-left',
  f_pb: 'padding-bottom',
  f_pr: 'padding-right',
  f_m: 'margin',
  f_mt: 'margin-top',
  f_ml: 'margin-left',
  f_mb: 'margin-bottom',
  f_mr: 'margin-right',
};

/** Normalize JsonView padding/margin fields to full CSS declarations. */
export function spacingFieldToDeclaration(key, raw) {
  const property = SPACING_PROPERTY_BY_KEY[key];
  if (!property || raw == null) {
    return null;
  }
  let value = String(raw).trim().replace(/;+$/, '');
  if (!value) {
    return null;
  }
  if (/^(padding|margin)(-|$)/i.test(value) || value.includes(':')) {
    return value.endsWith(';') ? value : `${value};`;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    value = `${value}px`;
  }
  return `${property}:${value};`;
}

export function escapeSpreadsheetFormatPoolHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function parseFormatPoolAttribute(raw) {
  if (raw == null || String(raw).trim() === '') {
    return [];
  }
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry ?? '')) : [];
  } catch (_err) {
    return [];
  }
}

export function readFormatPoolFromTableElement(tableEl) {
  if (!tableEl) {
    return [];
  }
  return parseFormatPoolAttribute(tableEl.getAttribute(SKER_FORMATS_ATTR));
}

/**
 * Resolve spreadsheet CSS for a cell element (pool index, legacy attrs, or inline).
 * @param {Element | null | undefined} cellEl
 * @returns {string | null}
 */
export function resolveSpreadsheetStyleFromCellElement(cellEl) {
  if (!cellEl) {
    return null;
  }

  const fromSkStyle = cellEl.getAttribute(SK_STYLE_ATTR);
  if (fromSkStyle) {
    return fromSkStyle;
  }

  const fromLegacySpreadsheetStyle = cellEl.getAttribute(LEGACY_SPREADSHEET_STYLE_ATTR);
  if (fromLegacySpreadsheetStyle) {
    return fromLegacySpreadsheetStyle;
  }

  const fromData = cellEl.getAttribute(LEGACY_DATA_CELL_STYLE_ATTR);
  if (fromData) {
    return fromData;
  }

  const indexRaw = cellEl.getAttribute(SKER_FORMAT_INDEX_ATTR);
  if (indexRaw != null && indexRaw !== '') {
    const index = Number(indexRaw);
    if (Number.isFinite(index) && index >= 0) {
      const pool = readFormatPoolFromTableElement(cellEl.closest('table'));
      const fromPool = pool[index];
      if (fromPool) {
        return fromPool;
      }
    }
  }

  const inline = cellEl.getAttribute('style') || '';
  if (!inline) {
    return null;
  }

  const kept = inline
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^height\s*:/i.test(part))
    .filter((part) => !/^min-height\s*:/i.test(part))
    .filter((part) => !/^width\s*:/i.test(part))
    .join(';');
  return kept || null;
}

function cssPropertyNamesFromStyle(styleText) {
  return new Set(
    String(styleText || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.split(':')[0]?.trim().toLowerCase())
      .filter(Boolean)
  );
}

function stripFormatDeclarationsFromInlineStyle(inlineStyle, formatStyle) {
  const formatProps = cssPropertyNamesFromStyle(formatStyle);
  if (formatProps.size === 0) {
    return String(inlineStyle || '').trim();
  }
  const kept = String(inlineStyle || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => {
      const prop = part.split(':')[0]?.trim().toLowerCase();
      return prop && !formatProps.has(prop);
    });
  return kept.join(';');
}

function isImportedSpreadsheetTable(tableEl) {
  if (!tableEl || tableEl.tagName !== 'TABLE') {
    return false;
  }
  return (
    tableEl.classList.contains('SkTextEditor-spreadsheetTable--imported')
    || tableEl.hasAttribute('data-sker-workbook')
    || tableEl.hasAttribute('data-sker-sheet')
    || tableEl.hasAttribute('data-sker-range')
  );
}

/**
 * Build / reuse index for a format string inside a table-local pool.
 * @returns {number | null}
 */
export function indexFormatStyleInPool(formatPool, indexByStyle, formatStyle) {
  const key = String(formatStyle || '').trim();
  if (!key) {
    return null;
  }
  if (indexByStyle.has(key)) {
    return indexByStyle.get(key);
  }
  const index = formatPool.length;
  formatPool.push(key);
  indexByStyle.set(key, index);
  return index;
}

/** Merge spreadsheet format CSS into an existing inline layout style. */
export function mergeSpreadsheetFormatIntoInlineStyle(layoutStyle, formatStyle, dataBg) {
  let style = String(layoutStyle || '').trim();
  const format = String(formatStyle || '').trim();
  if (format) {
    format.split(';').forEach((part) => {
      const trimmed = part.trim();
      if (!trimmed) {
        return;
      }
      const prop = trimmed.split(':')[0]?.trim().toLowerCase();
      if (!prop || style.toLowerCase().includes(`${prop}:`)) {
        return;
      }
      style = style ? `${style};${trimmed}` : trimmed;
    });
  }
  const bg = String(dataBg || '').trim();
  if (bg && !/background(-color)?\s*:/i.test(style)) {
    style = style ? `${style};background-color:${bg}` : `background-color:${bg}`;
  }
  return style;
}

/** Expand one cell: pool index / skstyle -> inline style + skstyle attribute. */
export function expandSpreadsheetCellElement(cellEl) {
  if (!cellEl) {
    return false;
  }

  const formatStyle = resolveSpreadsheetStyleFromCellElement(cellEl);
  if (!formatStyle) {
    return false;
  }

  const mergedStyle = mergeSpreadsheetFormatIntoInlineStyle(
    cellEl.getAttribute('style') || '',
    formatStyle,
    cellEl.getAttribute('data-bg')
  );
  if (mergedStyle) {
    cellEl.setAttribute('style', mergedStyle);
  }
  cellEl.setAttribute(SK_STYLE_ATTR, formatStyle);
  cellEl.removeAttribute(SKER_FORMAT_INDEX_ATTR);
  cellEl.removeAttribute(LEGACY_SPREADSHEET_STYLE_ATTR);
  cellEl.removeAttribute(LEGACY_DATA_CELL_STYLE_ATTR);
  return true;
}

/** Expand one imported spreadsheet table: inline styles on cells, no format pool. */
export function expandSpreadsheetTableElement(tableEl) {
  if (!isImportedSpreadsheetTable(tableEl)) {
    return;
  }

  tableEl.querySelectorAll('td, th').forEach((cellEl) => {
    expandSpreadsheetCellElement(cellEl);
  });
  tableEl.removeAttribute(SKER_FORMATS_ATTR);
}

/** Expand all imported spreadsheet tables in a TipTap HTML fragment. */
export function expandSpreadsheetTablesInDocumentHtml(html) {
  const raw = String(html ?? '');
  if (!raw.includes('<table') && !raw.includes('<TABLE')) {
    return raw;
  }
  if (typeof DOMParser === 'undefined') {
    return raw;
  }

  const doc = new DOMParser().parseFromString(
    `<body>${raw}</body>`,
    'text/html'
  );
  doc.body.querySelectorAll('table').forEach((tableEl) => {
    expandSpreadsheetTableElement(tableEl);
  });
  return doc.body.innerHTML;
}

const STANDALONE_HTML_STYLES = `
body {
  margin: 1rem;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
table {
  border-collapse: collapse;
}
.SkTextEditor-spreadsheetTable--imported td > *,
.SkTextEditor-spreadsheetTable--imported th > * {
  margin: 0;
}
`.trim();

/** Wrap TipTap body HTML as a self-contained document for browser viewing. */
export function wrapStandaloneHtmlDocument(bodyHtml, options = {}) {
  const title = String(options.title || 'Document').trim() || 'Document';
  const body = String(bodyHtml ?? '');
  return [
    '<!DOCTYPE html>',
    '<html lang="fr">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeSpreadsheetFormatPoolHtml(title)}</title>`,
    `<style>${STANDALONE_HTML_STYLES}</style>`,
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
  ].join('\n');
}

/** Build standalone HTML (expanded cell styles) from a TipTap fragment. */
export function buildStandaloneHtmlDocumentFromFragment(html, options = {}) {
  return wrapStandaloneHtmlDocument(
    expandSpreadsheetTablesInDocumentHtml(html),
    options
  );
}

/** Extract TipTap-editable body HTML from a stored standalone document or fragment. */
export function extractHtmlFragmentFromStoredDocument(rawContent) {
  const raw = String(rawContent ?? '').trim();
  if (!raw) {
    return '';
  }
  if (typeof DOMParser === 'undefined' || !/<html[\s>]/i.test(raw)) {
    return raw;
  }
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  return doc.body?.innerHTML?.trim() || '';
}

/** Normalize stored HTML for in-app browser preview (expand format pools). */
export function prepareHtmlForBrowserPreview(rawContent, options = {}) {
  const raw = String(rawContent ?? '').trim();
  if (!raw) {
    return wrapStandaloneHtmlDocument('', options);
  }
  if (typeof DOMParser === 'undefined') {
    if (/<html[\s>]/i.test(raw)) {
      return raw;
    }
    return buildStandaloneHtmlDocumentFromFragment(raw, options);
  }

  if (/<html[\s>]/i.test(raw)) {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    doc.body.querySelectorAll('table').forEach((tableEl) => {
      expandSpreadsheetTableElement(tableEl);
    });
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  }

  return buildStandaloneHtmlDocumentFromFragment(raw, options);
}

/** Compact one imported spreadsheet table: pool on table, data-f-i on cells. */
export function compactSpreadsheetTableElement(tableEl) {
  if (!isImportedSpreadsheetTable(tableEl)) {
    return;
  }

  const formatPool = [];
  const indexByStyle = new Map();

  tableEl.querySelectorAll('td, th').forEach((cellEl) => {
    const formatStyle = resolveSpreadsheetStyleFromCellElement(cellEl);
    if (!formatStyle) {
      return;
    }

    const index = indexFormatStyleInPool(formatPool, indexByStyle, formatStyle);
    if (index == null) {
      return;
    }

    cellEl.setAttribute(SKER_FORMAT_INDEX_ATTR, String(index));
    cellEl.removeAttribute(SK_STYLE_ATTR);
    cellEl.removeAttribute(LEGACY_SPREADSHEET_STYLE_ATTR);
    cellEl.removeAttribute(LEGACY_DATA_CELL_STYLE_ATTR);

    const inlineStyle = cellEl.getAttribute('style') || '';
    const layoutOnly = stripFormatDeclarationsFromInlineStyle(inlineStyle, formatStyle);
    if (layoutOnly) {
      cellEl.setAttribute('style', layoutOnly);
    } else {
      cellEl.removeAttribute('style');
    }
  });

  if (formatPool.length > 0) {
    tableEl.setAttribute(SKER_FORMATS_ATTR, JSON.stringify(formatPool));
  } else {
    tableEl.removeAttribute(SKER_FORMATS_ATTR);
  }
}

/** Compact all imported spreadsheet tables in a TipTap HTML fragment. */
export function compactSpreadsheetTablesInDocumentHtml(html) {
  const raw = String(html ?? '');
  if (!raw.includes('<table') && !raw.includes('<TABLE')) {
    return raw;
  }
  if (typeof DOMParser === 'undefined') {
    return raw;
  }

  const doc = new DOMParser().parseFromString(
    `<body>${raw}</body>`,
    'text/html'
  );
  doc.body.querySelectorAll('table').forEach((tableEl) => {
    compactSpreadsheetTableElement(tableEl);
  });
  return doc.body.innerHTML;
}
