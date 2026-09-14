//=============================================================================
// SkAiLocaleContext.mjs — per-user locale for MCP tool calls during an AI session
//=============================================================================

import { normalizeSpreadsheetLang } from '../SkSpreadSheet/SkeeptoLocale.mjs';

/** @type {Map<string, { lang: string, at: number }>} */
const aiLocaleByEmail = new Map();
const AI_LOCALE_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * @param {string} email
 * @param {unknown} lang
 */
export function setAiUserLocale(email, lang) {
  const wEmail = String(email || '').trim().toLowerCase();
  if (!wEmail) {
    return;
  }
  aiLocaleByEmail.set(wEmail, {
    lang: normalizeSpreadsheetLang(lang),
    at: Date.now(),
  });
}

/**
 * @param {string} email
 * @returns {string}
 */
export function getAiUserLocale(email) {
  const wEmail = String(email || '').trim().toLowerCase();
  const wEntry = aiLocaleByEmail.get(wEmail);
  if (!wEntry) {
    return normalizeSpreadsheetLang(process.env.SK_SPREADSHEET_LANG);
  }
  if (Date.now() - wEntry.at > AI_LOCALE_TTL_MS) {
    aiLocaleByEmail.delete(wEmail);
    return normalizeSpreadsheetLang(process.env.SK_SPREADSHEET_LANG);
  }
  return wEntry.lang;
}
