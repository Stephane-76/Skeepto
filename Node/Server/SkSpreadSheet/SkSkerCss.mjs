//=============================================================================
// SkSkerCss.mjs — normalize sker CSS strings for Format / paste cp payloads
//=============================================================================

/**
 * Sker Format() rejects CSS without a trailing semicolon. Normalize before WASM Call().
 * @param {string} css
 * @returns {string}
 */
export function normalizeSkerCss(css) {
  const wTrimmed = String(css ?? '').trim();
  if (!wTrimmed) {
    throw new Error('CSS value is empty');
  }
  const wFormatString = normalizeFormatStringDeclaration(wTrimmed);
  if (wFormatString) {
    return wFormatString;
  }
  return wTrimmed.endsWith(';') ? wTrimmed : `${wTrimmed};`;
}

/**
 * A `format-string` declaration must carry the whole mask as ONE double-quoted
 * string: format-string:"<mask>";. Agents frequently send it unquoted or with
 * Excel-style inner quotes around the currency symbol
 * (e.g. format-string: #,##0.00 "€";), which the WASM CSS parser rejects with a
 * "Syntax error". Rebuild it into the canonical quoted form. Returns null when
 * the CSS is not a lone format-string declaration (other properties untouched).
 * @param {string} trimmedCss
 * @returns {string|null}
 */
function normalizeFormatStringDeclaration(trimmedCss) {
  const wMatch = /^format-string\s*:\s*([\s\S]*?);?\s*$/i.exec(trimmedCss);
  if (!wMatch) {
    return null;
  }
  let wMask = wMatch[1].trim();
  // Drop a single pair of surrounding quotes if the agent already added them.
  if (wMask.length >= 2 && wMask.startsWith('"') && wMask.endsWith('"')) {
    wMask = wMask.slice(1, -1);
  }
  // sker masks embed literals (currency symbol) directly, without inner quotes.
  wMask = wMask.replace(/"/g, '').trim();
  if (!wMask) {
    throw new Error('format-string value is empty');
  }
  return `format-string:"${wMask}";`;
}

/**
 * Ensure every f.formats[].f string in a cp clipboard ends with ';'.
 * @param {object} clipboard
 * @returns {object}
 */
export function normalizeClipboardFormatCss(clipboard) {
  if (!clipboard || typeof clipboard !== 'object') {
    return clipboard;
  }
  const wFormats = clipboard.f?.formats;
  if (!Array.isArray(wFormats)) {
    return clipboard;
  }
  return {
    ...clipboard,
    f: {
      ...clipboard.f,
      formats: wFormats.map((entry) => {
        if (!entry || typeof entry !== 'object' || typeof entry.f !== 'string') {
          return entry;
        }
        return { ...entry, f: normalizeSkerCss(entry.f) };
      }),
    },
  };
}
