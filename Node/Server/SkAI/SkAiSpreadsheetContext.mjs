//=============================================================================
// SkAiSpreadsheetContext.mjs — UI workbook / sheet / selection for agent prompts
//=============================================================================

import { normalizeWriteCellValue } from '../SkSpreadSheet/SkCellValueCoerce.mjs';

const CELL_REF_PATTERN = /^[A-Z]{1,4}\d{1,7}$/i;
const CELL_RANGE_PATTERN = /^([A-Z]{1,4}\d{1,7}):([A-Z]{1,4}\d{1,7})$/i;

/**
 * @param {string} text
 * @returns {string}
 */
function stripSheetPrefix(text) {
  const wRaw = String(text || '').trim();
  const wBang = wRaw.indexOf('!');
  return wBang > 0 ? wRaw.slice(wBang + 1).trim() : wRaw;
}

/**
 * @param {string} ref
 * @returns {string}
 */
function normalizeCellRef(ref) {
  const wRef = stripSheetPrefix(String(ref || '').trim());
  if (!wRef) {
    return '';
  }
  const wMatch = wRef.match(/^([A-Z]{1,4})(\d{1,7})$/i);
  if (!wMatch) {
    return wRef.toUpperCase();
  }
  return `${wMatch[1].toUpperCase()}${wMatch[2]}`;
}

/**
 * A1:D10 from "A1:D10", "A1-D10", or French "de A1 à D10".
 * @param {string} text
 * @returns {string}
 */
export function extractA1RangeFromText(text) {
  const wText = String(text || '').trim();
  if (!wText) {
    return '';
  }
  const wColon = wText.match(/\b([A-Za-z]{1,4}\d{1,7})\s*:\s*([A-Za-z]{1,4}\d{1,7})\b/);
  if (wColon) {
    return `${normalizeCellRef(wColon[1])}:${normalizeCellRef(wColon[2])}`;
  }
  const wDe = wText.match(
    /\b(?:de\s+)?([A-Za-z]{1,4}\d{1,7})\s+(?:à|a|-)\s+([A-Za-z]{1,4}\d{1,7})\b/i
  );
  if (wDe) {
    return `${normalizeCellRef(wDe[1])}:${normalizeCellRef(wDe[2])}`;
  }
  return '';
}

/**
 * Full UI selection range (A1:D11), else the active cell.
 * @param {{ selection?: string, cursorRef?: string }|null|undefined} ctx
 * @returns {string}
 */
export function resolveSpreadsheetTargetRange(ctx) {
  if (!ctx) {
    return '';
  }
  const wSelection = stripSheetPrefix(String(ctx.selection || '').split(';')[0].trim());
  const wRangeMatch = wSelection.match(CELL_RANGE_PATTERN);
  if (wRangeMatch) {
    return `${normalizeCellRef(wRangeMatch[1])}:${normalizeCellRef(wRangeMatch[2])}`;
  }
  if (CELL_REF_PATTERN.test(wSelection)) {
    return normalizeCellRef(wSelection);
  }
  return resolveSpreadsheetTargetRef(ctx);
}

/**
 * Best single-cell target from UI context (cursor wins over range top-left).
 * @param {{ selection?: string, cursorRef?: string }|null|undefined} ctx
 * @returns {string}
 */
export function resolveSpreadsheetTargetRef(ctx) {
  if (!ctx) {
    return '';
  }

  const wCursor = normalizeCellRef(ctx.cursorRef || '');
  if (CELL_REF_PATTERN.test(wCursor)) {
    return wCursor;
  }

  const wSelection = String(ctx.selection || '').trim();
  if (!wSelection) {
    return '';
  }

  const wFirstPart = wSelection.split(';')[0].trim();
  if (CELL_REF_PATTERN.test(wFirstPart)) {
    return normalizeCellRef(wFirstPart);
  }

  const wRangeMatch = wFirstPart.match(CELL_RANGE_PATTERN);
  if (wRangeMatch) {
    return normalizeCellRef(wRangeMatch[1]);
  }

  return '';
}

/**
 * User asked to write/read "the selected cell" without an explicit A1 ref.
 * @param {string} prompt
 * @returns {boolean}
 */
export function detectSelectionTargetIntent(prompt) {
  const wText = String(prompt || '').trim();
  if (!wText) {
    return false;
  }

  if (/\b(en|dans|to|in)\s+[A-Z]{1,4}\d{1,7}\b/i.test(wText)) {
    return false;
  }

  if (detectSelectionCorrectionIntent(wText)) {
    return true;
  }

  if (/^(?:juste\s+|uniquement\s+|seulement\s+)?=/i.test(wText)) {
    return true;
  }

  return (
    /\b(cellule\s+(de\s+)?s[ée]lection|la\s+s[ée]lection|dans\s+la\s+s[ée]lection|s[ée]lection\s+actuelle|cette\s+cellule|cellule\s+courante|cellule\s+active)\b/i.test(
      wText
    ) ||
    /\b(selected\s+cell|current\s+selection|here)\b/i.test(wText) ||
    /\b(écri(re|s|t)|ecri(re|s|t)|met(s|tre|tez)?|place(r|z)?|tape(r|z)?)\b[\s\S]{0,40}\b(s[ée]lection|ici)\b/i.test(
      wText
    )
  );
}

/**
 * User wants to fix a prior write (e.g. remove stray quotes around a formula).
 * @param {string} prompt
 * @returns {boolean}
 */
export function detectSelectionCorrectionIntent(prompt) {
  return /\b(sans\s+(?:les\s+)?guillemets?|enleve[rz]?\s+(?:les\s+)?guillemets?|retire[rz]?\s+(?:les\s+)?guillemets?|without\s+quotes?)\b/iu.test(
    String(prompt || '')
  );
}

/**
 * @param {string} ref
 * @returns {boolean}
 */
export function isValidCellRef(ref) {
  return CELL_REF_PATTERN.test(normalizeCellRef(ref));
}

/**
 * Extract a plain value from simple French "écrire X dans la sélection" prompts.
 * @param {string} prompt
 * @returns {string}
 */
export function extractSimpleWriteValueFromPrompt(prompt) {
  const wText = String(prompt || '').trim();
  if (!wText) {
    return '';
  }

  const wFormulaQuoted = wText.match(
    /\b(?:la\s+formule|formule)\s+(?:«([^»]+)»|"([^"]+)"|'([^']+)')/iu
  );
  if (wFormulaQuoted) {
    return normalizeWriteCellValue(wFormulaQuoted[1] || wFormulaQuoted[2] || wFormulaQuoted[3] || '');
  }

  const wQuoted =
    wText.match(/\b(?:écri|ecri)(?:re|s|t|re)?[\s\S]{0,48}?(?:«([^»]+)»|"([^"]+)"|'([^']+)')/iu) ||
    wText.match(/\bmet(?:s|tre|tez)?[\s\S]{0,48}?(?:«([^»]+)»|"([^"]+)"|'([^']+)')/iu) ||
    wText.match(/\btape(?:r|z)?[\s\S]{0,48}?(?:«([^»]+)»|"([^"]+)"|'([^']+)')/iu);
  if (wQuoted) {
    return normalizeWriteCellValue(wQuoted[1] || wQuoted[2] || wQuoted[3] || '');
  }

  const wBareFormula = wText.match(/^(?:juste\s+|uniquement\s+|seulement\s+)?(=.+)$/iu);
  if (wBareFormula) {
    return normalizeWriteCellValue(wBareFormula[1]);
  }

  const wFormulaUnquoted = wText.match(
    /\b(?:peux\s+tu\s+)?(?:écri|ecri|met)(?:re|s|t|re|tez)?\s+(?:la\s+formule\s+)?(=[^\s]+(?:\([^\)]*\))*)\s+(?:dans|en)\s+(?:la\s+)?(?:cellule\s+)?(?:de\s+)?(?:s[ée]lection|ici)\b/iu
  );
  if (wFormulaUnquoted) {
    return normalizeWriteCellValue(wFormulaUnquoted[1]);
  }

  const wUnquoted = wText.match(
    /\b(?:peux\s+tu\s+)?(?:écri|ecri)(?:re|s|t|re)?\s+(.+?)\s+(?:dans|en)\s+(?:la\s+)?(?:cellule\s+)?(?:de\s+)?s[ée]lection\b/iu
  );
  if (wUnquoted) {
    return normalizeWriteCellValue(wUnquoted[1]);
  }

  const wUnquotedHere = wText.match(
    /\b(?:peux\s+tu\s+)?(?:écri|ecri)(?:re|s|t|re)?\s+(.+?)\s+(?:dans|en|à)\s+(?:la\s+)?(?:cellule\s+)?ici\b/iu
  );
  if (wUnquotedHere) {
    return normalizeWriteCellValue(wUnquotedHere[1]);
  }

  return '';
}

/**
 * @param {string} prompt
 * @param {{ sheet?: string, selection?: string, cursorRef?: string }|null|undefined} ctx
 * @returns {string}
 */
export function buildSelectionAwareUserPrompt(prompt, ctx) {
  const wText = String(prompt || '').trim();
  if (!detectSelectionTargetIntent(wText)) {
    return wText;
  }
  const wRef = resolveSpreadsheetTargetRef(ctx);
  if (!wRef) {
    return wText;
  }
  const wSheet = ctx?.sheet ? String(ctx.sheet).trim() : '';
  const wSheetPart = wSheet ? ` on sheet "${wSheet}"` : '';
  return (
    `${wText}\n\n` +
    `[UI context — authoritative] Target cell: ${wRef}${wSheetPart}. ` +
    `Call write_cell with ref "${wRef}" — never A1, never the literal word "selection".`
  );
}

/**
 * @returns {string}
 */
export function buildMissingSelectionTargetMessage() {
  return (
    'Je n\'ai pas reçu de cellule active depuis le classeur.\n\n' +
    '1. Cliquez une cellule dans la grille (le panneau chat garde parfois une sélection vide).\n' +
    '2. Renvoyez votre message.\n\n' +
    'Ou précisez une référence explicite : « Écris Bonjour en H7 ».'
  );
}

/**
 * Inject active UI sheet on write tools when the model omits it (server WASM defaults to sheet 1).
 * @param {string} toolName
 * @param {Record<string, unknown>} args
 * @param {{ sheet?: string }|null|undefined} ctx
 * @returns {Record<string, unknown>}
 */
export function ensureActiveSheetOnWriteToolArgs(toolName, args, ctx) {
  if (!args || typeof args !== 'object' || !ctx?.sheet) {
    return args;
  }
  const wSheet = String(ctx.sheet).trim();
  if (!wSheet || String(args.sheet || '').trim()) {
    return args;
  }
  const wWriteTools = new Set([
    'write_cell',
    'write_formatted_cell',
    'write_cells',
    'paste_grid',
    'read_cell',
    'read_range',
    'resize_columns',
    'resize_rows',
    'get_column_width',
    'get_row_height',
    'apply_format',
  ]);
  if (!wWriteTools.has(toolName)) {
    return args;
  }
  return { ...args, sheet: wSheet };
}

/**
 * Apply UI spreadsheet context to MCP write tool args (sheet + selection ref patching).
 * @param {string} toolName
 * @param {Record<string, unknown>} args
 * @param {{ sheet?: string, selection?: string, cursorRef?: string }|null|undefined} ctx
 * @param {string} prompt
 * @returns {Record<string, unknown>}
 */
export function applySpreadsheetContextToWriteToolArgs(toolName, args, ctx, prompt) {
  let wOut = ensureActiveSheetOnWriteToolArgs(toolName, args, ctx);
  if (toolName === 'write_cell' || toolName === 'write_formatted_cell') {
    wOut = patchWriteToolArgsForSelectionContext(wOut, ctx, prompt);
  }
  if (toolName === 'apply_format') {
    wOut = patchFormatToolArgsForContext(wOut, ctx, prompt);
  }
  return wOut;
}

/**
 * Fill apply_format range from the prompt ("de A1 à D10") or the UI selection.
 * @param {Record<string, unknown>} args
 * @param {{ sheet?: string, selection?: string, cursorRef?: string }|null|undefined} ctx
 * @param {string} prompt
 * @returns {Record<string, unknown>}
 */
export function patchFormatToolArgsForContext(args, ctx, prompt) {
  if (!args || typeof args !== 'object') {
    return args;
  }
  const wCurrent = String(args.range || '').trim();
  const wFromPrompt = extractA1RangeFromText(prompt);
  const wFromUi = resolveSpreadsheetTargetRange(ctx);
  const wMissing = !wCurrent || /^a1(?::a1)?$/i.test(wCurrent);
  if (!wMissing && wCurrent.includes(':')) {
    return args;
  }
  const wRange = wFromPrompt || wFromUi;
  if (!wRange) {
    return args;
  }
  /** @type {Record<string, unknown>} */
  const wOut = { ...args, range: wRange };
  if (ctx?.sheet && !String(args.sheet || '').trim()) {
    wOut.sheet = ctx.sheet;
  }
  return wOut;
}

/**
 * Override write_cell ref when the model ignores UI selection (often defaults to A1).
 * @param {Record<string, unknown>} args
 * @param {{ sheet?: string, selection?: string, cursorRef?: string }|null|undefined} ctx
 * @param {string} prompt
 * @returns {Record<string, unknown>}
 */
export function patchWriteToolArgsForSelectionContext(args, ctx, prompt) {
  if (!args || typeof args !== 'object') {
    return args;
  }
  if (!detectSelectionTargetIntent(prompt)) {
    return args;
  }

  const wTarget = resolveSpreadsheetTargetRef(ctx);
  if (!wTarget) {
    return args;
  }

  const wRef = normalizeCellRef(String(args.ref || ''));
  if (wRef === wTarget) {
    return args;
  }

  /** @type {Record<string, unknown>} */
  const wOut = { ...args, ref: wTarget };
  if (ctx?.sheet && !String(args.sheet || '').trim()) {
    wOut.sheet = ctx.sheet;
  }
  const wExtractedValue = extractSimpleWriteValueFromPrompt(prompt);
  if (wExtractedValue && !String(args.value ?? '').trim()) {
    wOut.value = wExtractedValue;
  } else if (String(args.value ?? '').trim()) {
    wOut.value = normalizeWriteCellValue(String(args.value));
  }
  if (!isValidCellRef(wRef) || wRef !== wTarget) {
    return wOut;
  }
  return args;
}

/**
 * @param {unknown} body
 * @returns {{ workbookPath: string, sheet: string, selection: string, cursorRef: string }|null}
 */
export function normalizeSpreadsheetContextFromRequest(body) {
  const wRaw = body?.spreadsheetContext;
  if (!wRaw || typeof wRaw !== 'object') {
    return null;
  }
  /** @type {Record<string, unknown>} */
  const wCtx = wRaw;
  const wWorkbook =
    String(body?.workbookPath || body?.path || wCtx.workbookPath || '').trim();
  const wSheet = String(wCtx.sheet || wCtx.activeSheet || '').trim();
  const wSelection = String(wCtx.selection || wCtx.select || '').trim();
  const wCursor = String(wCtx.cursorRef || wCtx.cursor || wCtx.activeCell || '').trim();

  if (!wWorkbook && !wSheet && !wSelection && !wCursor) {
    return null;
  }

  return {
    workbookPath: wWorkbook,
    sheet: wSheet,
    selection: wSelection,
    cursorRef: wCursor,
  };
}

/**
 * @param {{ workbookPath?: string, sheet?: string, selection?: string, cursorRef?: string }|null|undefined} ctx
 * @returns {string[]}
 */
export function buildSpreadsheetContextPromptLines(ctx) {
  if (!ctx) {
    return [];
  }

  const wLines = [
    'Active spreadsheet context from the user UI (authoritative for "here", "this sheet", "selection"):',
  ];

  if (ctx.workbookPath) {
    wLines.push(`- Workbook path: ${ctx.workbookPath}`);
  }
  if (ctx.sheet) {
    wLines.push(`- Active sheet tab: ${ctx.sheet}`);
  }
  if (ctx.selection) {
    wLines.push(`- Current selection: ${ctx.selection}`);
  }
  if (ctx.cursorRef) {
    wLines.push(`- Active cell (cursor): ${ctx.cursorRef}`);
  }
  const wTarget = resolveSpreadsheetTargetRef(ctx);
  if (wTarget) {
    wLines.push(`- Default single-cell write target: ${wTarget} (use this for "cellule de sélection", "ici", "here")`);
  }

  wLines.push(
    '- Pass path on every tool call. When Active sheet tab is set, pass the same sheet name on every write/read/paste tool — required (server defaults to first sheet otherwise).',
    '- When the user refers to "cellule de sélection", "ici", "here", or "selection", use Default single-cell write target — NEVER guess A1.',
    '- When the user refers to " cette plage ", use the full Current selection range unless they specify otherwise.'
  );

  return wLines;
}
