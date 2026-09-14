//=============================================================================
// SkeeptoLocale.mjs — locale metadata + US wire dates (sker canonical format)
//=============================================================================

/** @typedef {'us'|'en'|'fr'|'de'|'sp'|'it'} SkeeptoLangId */

/** sker date wire + MCP server locale — always US (matches C++ tClassDate::UsDate / t:da). */
export const SKER_WIRE_LOCALE = 'us';

export const SPREADSHEET_LANG_IDS = new Set(['us', 'en', 'fr', 'de', 'sp', 'it']);

/** @type {Record<SkeeptoLangId, { label: string, decimalSep: string, thousandsSep: string, currency: string }>} */
export const SPREADSHEET_LOCALE_META = {
  fr: {
    label: 'Français',
    decimalSep: ',',
    thousandsSep: ' ',
    currency: '€',
  },
  us: {
    label: 'English (US)',
    decimalSep: '.',
    thousandsSep: ',',
    currency: '$',
  },
  en: {
    label: 'English (UK)',
    decimalSep: '.',
    thousandsSep: ',',
    currency: '£',
  },
  de: {
    label: 'Deutsch',
    decimalSep: ',',
    thousandsSep: '.',
    currency: '€',
  },
  sp: {
    label: 'Español',
    decimalSep: ',',
    thousandsSep: '.',
    currency: '€',
  },
  it: {
    label: 'Italiano',
    decimalSep: ',',
    thousandsSep: '.',
    currency: '€',
  },
};

/**
 * @param {unknown} lang
 * @returns {SkeeptoLangId}
 */
export function normalizeSpreadsheetLang(lang) {
  if (typeof lang !== 'string') {
    return 'fr';
  }
  const wNormalized = lang.trim().toLowerCase();
  return SPREADSHEET_LANG_IDS.has(wNormalized) ? /** @type {SkeeptoLangId} */ (wNormalized) : 'fr';
}

/**
 * sker tVariant date wire (MM-DD-YYYY) — matches SkCellClass.formatVariantDateWire.
 * @param {{ year: number, month: number, day: number }} parts — month 1-12
 * @returns {string}
 */
export function toVariantDateWire(parts) {
  const wMonth = String(parts.month).padStart(2, '0');
  const wDay = String(parts.day).padStart(2, '0');
  return `${wMonth}-${wDay}-${parts.year}`;
}

/**
 * Parse a date string using sker US wire rules only (month/day/year for slash dates).
 * Also accepts ISO yyyy-mm-dd (unambiguous).
 * @param {string} text
 * @returns {{ year: number, month: number, day: number }|null}
 */
export function parseUsDateString(text) {
  const wTrimmed = String(text ?? '').trim();
  if (!wTrimmed) {
    return null;
  }

  const wIso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(wTrimmed);
  if (wIso) {
    return wValidParts(Number(wIso[1]), Number(wIso[2]), Number(wIso[3]));
  }

  const wWire = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(wTrimmed);
  if (wWire) {
    return wValidParts(Number(wWire[3]), Number(wWire[1]), Number(wWire[2]));
  }

  const wSlash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(wTrimmed);
  if (wSlash) {
    return wValidParts(Number(wSlash[3]), Number(wSlash[1]), Number(wSlash[2]));
  }

  return null;
}

/**
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @returns {{ year: number, month: number, day: number }|null}
 */
function wValidParts(year, month, day) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const wDate = new Date(year, month - 1, day);
  if (
    wDate.getFullYear() !== year ||
    wDate.getMonth() !== month - 1 ||
    wDate.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/**
 * @param {unknown} text
 * @returns {{ t: 'da', v: string }|null}
 */
export function usDateToPasteCellValue(text) {
  const wParts = parseUsDateString(text);
  if (!wParts) {
    return null;
  }
  return { t: 'da', v: toVariantDateWire(wParts) };
}

/**
 * Lines for the Cursor agent prompt.
 * User locale affects UI display only; storage/wire is always US.
 * @param {SkeeptoLangId} lang
 * @returns {string[]}
 */
export function buildAgentLocalePromptLines(lang) {
  const wLang = normalizeSpreadsheetLang(lang);
  const wMeta = SPREADSHEET_LOCALE_META[wLang];
  return [
    'Locale (already configured — NEVER ask the user which language or locale to use):',
    `- Reply in French when the user writes in French; do not ask "quelle langue?" or "US vs FR?".`,
    `- User UI locale: ${wLang} (${wMeta.label}) — browser display only.`,
    '- Wire dates (paste_grid / write_cell): always US — MM/DD/YYYY or ISO yyyy-mm-dd (e.g. 07/12/2026 = July 12). Never dd/mm European in tool args.',
    '- Server MCP already uses SetLang(us); just write cells and proceed.',
  ];
}
