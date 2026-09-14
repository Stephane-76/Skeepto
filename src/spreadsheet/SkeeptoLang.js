/** Spreadsheet locale ids — mirror SkRoot tLang (SkLocale.hpp). */
export const SPREADSHEET_LANGS = [
  { id: 'us', label: 'English (US)' },
  { id: 'en', label: 'English (UK)' },
  { id: 'fr', label: 'Français' },
  { id: 'de', label: 'Deutsch' },
  { id: 'sp', label: 'Español' },
  { id: 'it', label: 'Italiano' },
];

const STORAGE_KEY = 'skeeptoLang';
const LEGACY_LOCAL_KEYS = ['skSpreadsheetLang'];
const LEGACY_SESSION_KEYS = ['skSpreadsheetLang', 'skeeptoLang'];
const LANG_IDS = new Set(SPREADSHEET_LANGS.map((item) => item.id));

function migrateStoredLang(stored) {
  if (!stored || typeof localStorage === 'undefined') {
    return stored;
  }
  localStorage.setItem(STORAGE_KEY, stored);
  for (const key of LEGACY_LOCAL_KEYS) {
    localStorage.removeItem(key);
  }
  if (typeof sessionStorage !== 'undefined') {
    for (const key of LEGACY_SESSION_KEYS) {
      sessionStorage.removeItem(key);
    }
  }
  return stored;
}

function readStoredLang() {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  let stored = normalizeSpreadsheetLang(localStorage.getItem(STORAGE_KEY));
  if (stored) {
    return stored;
  }
  for (const key of LEGACY_LOCAL_KEYS) {
    stored = normalizeSpreadsheetLang(localStorage.getItem(key));
    if (stored) {
      return migrateStoredLang(stored);
    }
  }
  // One-time migration from sessionStorage (previous builds).
  if (typeof sessionStorage !== 'undefined') {
    for (const key of LEGACY_SESSION_KEYS) {
      stored = normalizeSpreadsheetLang(sessionStorage.getItem(key));
      if (stored) {
        return migrateStoredLang(stored);
      }
    }
  }
  return null;
}

export function normalizeSpreadsheetLang(lang) {
  if (typeof lang !== 'string') {
    return null;
  }
  const normalized = lang.trim().toLowerCase();
  return LANG_IDS.has(normalized) ? normalized : null;
}

export function getSpreadsheetLang() {
  return readStoredLang() || 'fr';
}

export function setSpreadsheetLang(lang) {
  const normalized = normalizeSpreadsheetLang(lang);
  if (!normalized || typeof localStorage === 'undefined') {
    return false;
  }
  localStorage.setItem(STORAGE_KEY, normalized);
  return true;
}

/** Two-letter badge for the status bar (US, FR, DE, EN, SP, IT). */
export function spreadsheetLangBadge(lang) {
  const normalized = normalizeSpreadsheetLang(lang) || getSpreadsheetLang();
  return normalized.toUpperCase();
}

export function spreadsheetLangLabel(lang) {
  const normalized = normalizeSpreadsheetLang(lang) || getSpreadsheetLang();
  const entry = SPREADSHEET_LANGS.find((item) => item.id === normalized);
  return entry ? entry.label : normalized.toUpperCase();
}

export async function applySpreadsheetLang(spInterface, lang, options = {}) {
  const { reload = true } = options;
  const normalized = normalizeSpreadsheetLang(lang);
  if (!normalized) {
    return false;
  }
  setSpreadsheetLang(normalized);
  if (window.SkUISpreadSheet) {
    window.SkUISpreadSheet.setLang(normalized);
  }
  window.dispatchEvent(
    new CustomEvent('skeeptoLangChange', { detail: { lang: normalized } })
  );
  if (reload && spInterface && typeof spInterface.reloadView === 'function') {
    await spInterface.reloadView();
  }
  return true;
}
