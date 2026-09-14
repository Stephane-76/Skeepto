/**
 * Parse / build CSS cell-format strings for HighlightCellsRules and CustomFormulas.
 * Uses the same property names as SkSpreadSheet format() / skCellTextFormat.js.
 */

import { normalizeHexColor } from '../utility/SkUtility';

/** Label shown in the CF format preview box (Highlight / Custom formula). */
export const CF_FORMAT_PREVIEW_SAMPLE = 'Sample text';

export function defaultCellFormatStyle(overrides = {}) {
  return {
    color: '#FF0000',
    textColor: '#000000',
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    id: 0,
    ...overrides,
  };
}

function readCssProperty(css, name) {
  const s = String(css || '');
  // Require a property boundary so "color" does not match "background-color".
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = s.match(new RegExp(`(?:^|[;\\s])${escaped}\\s*:\\s*([^;]+)`, 'i'));
  return match ? match[1].trim() : '';
}

/** Parse param2 CSS from the engine into UI format state. */
export function parseCssCellFormat(css, fallbackBackground = '#FF0000') {
  const background =
    readCssProperty(css, 'background-color') || fallbackBackground;
  const textColor = readCssProperty(css, 'color') || '#000000';
  const fontWeight = readCssProperty(css, 'font-weight');
  const fontStyle = readCssProperty(css, 'font-style');
  const decoration =
    readCssProperty(css, 'text-decoration-line') ||
    readCssProperty(css, 'text-decoration');

  return defaultCellFormatStyle({
    color: normalizeHexColor(background),
    textColor: normalizeHexColor(textColor),
    bold: /bold/i.test(fontWeight),
    italic: /italic/i.test(fontStyle),
    underline: /underline/i.test(decoration),
    strike: /line-through/i.test(decoration),
  });
}

/** Build CSS string sent as param2 to conditionalFormat() for HC / CF rules. */
export function buildCssCellFormat(format, fallbackBackground = '#FF0000') {
  const parts = [];
  const background = normalizeHexColor(format?.color || fallbackBackground);
  parts.push(`background-color:${background};`);

  const textColor = normalizeHexColor(format?.textColor || '#000000');
  parts.push(`color:${textColor};`);

  if (format?.bold) {
    parts.push('font-weight:bold;');
  }
  if (format?.italic) {
    parts.push('font-style:italic;');
  }

  if (format?.underline || format?.strike) {
    parts.push('text-decoration-line:none;');
    if (format.underline) {
      parts.push('text-decoration-line:underline;');
    }
    if (format.strike) {
      parts.push('text-decoration-line:line-through;');
    }
  }

  return parts.join('');
}

/** Inline styles for the format preview box in the CF panel. */
export function cellFormatPreviewStyle(format) {
  const decorations = [];
  if (format?.underline) decorations.push('underline');
  if (format?.strike) decorations.push('line-through');

  const backgroundColor = normalizeHexColor(format?.color || '#FF0000');
  let textColor = normalizeHexColor(format?.textColor || '#000000');
  if (textColor.toLowerCase() === backgroundColor.toLowerCase()) {
    textColor = '#000000';
  }

  return {
    container: {
      backgroundColor,
    },
    text: {
      color: textColor,
      fontWeight: format?.bold ? 'bold' : 'normal',
      fontStyle: format?.italic ? 'italic' : 'normal',
      textDecoration: decorations.length ? decorations.join(' ') : 'none',
    },
  };
}
