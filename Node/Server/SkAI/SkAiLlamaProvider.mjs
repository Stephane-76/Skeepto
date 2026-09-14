//=============================================================================
// SkAiLlamaProvider.mjs — local llama-server (OpenAI-compatible /v1/chat/completions)
//=============================================================================

const httpFetch = globalThis.fetch;
if (typeof httpFetch !== 'function') {
  throw new Error('global fetch is not available at SkAiLlamaProvider load time');
}

import {
  buildAgentLocalePromptLines,
  normalizeSpreadsheetLang,
} from '../SkSpreadSheet/SkeeptoLocale.mjs';
import { buildAgentCapabilitiesPromptLines, buildFrenchAgentCapabilitiesAnswer, buildFrenchExcelFunctionsAnswer } from './SkAiCapabilities.mjs';
import { createSkAiMcpToolExecutor } from './SkAiMcpToolExecutor.mjs';
import { buildKnownListGrid, matchKnownList } from './SkAiKnownLists.mjs';
import { isFormulaText, normalizeWriteCellValue } from '../SkSpreadSheet/SkCellValueCoerce.mjs';
import {
  applySpreadsheetContextToWriteToolArgs,
  buildSelectionAwareUserPrompt,
  buildSpreadsheetContextPromptLines,
  detectSelectionCorrectionIntent,
  detectSelectionTargetIntent,
  ensureActiveSheetOnWriteToolArgs,
  extractA1RangeFromText,
  extractSimpleWriteValueFromPrompt,
  resolveSpreadsheetTargetRange,
  resolveSpreadsheetTargetRef,
} from './SkAiSpreadsheetContext.mjs';

/**
 * @returns {boolean}
 */
export function isLlamaMcpEnabled() {
  return process.env.SK_LLAMA_MCP === '1';
}

/** OpenAI `model` id sent to llama-server (one-model servers ignore it). */
export const LLAMA_DEFAULT_MODEL = 'Qwen3.5-35B-A3B';

/** HuggingFace GGUF repo for `llama serve -hf` (matches launchQwen35.sh). */
export const LLAMA_DEFAULT_HF_REPO = 'unsloth/Qwen3.5-35B-A3B-GGUF:Q8_0';

/**
 * @param {number|string} [port]
 * @returns {string}
 */
export function getLlamaRecommendedServeCommand(port = 8080) {
  if (Number(port) === 8080) {
    return './launchQwen35.sh';
  }
  return `LLAMA_PORT=${port} ./launchQwen35.sh`;
}

const CELL_REF_PATTERN = /\b[A-Z]{1,4}\d{1,7}\b/;
const CELL_RANGE_PATTERN = /\b[A-Z]{1,4}\d{1,7}:[A-Z]{1,4}\d{1,7}\b/;
const LIST_DUMP_BLOCKED_TOOLS = new Set(['write_cell', 'write_formatted_cell', 'write_cells']);

const LLAMA_CAPABILITY_QUESTION =
  /\b(qu\s*'?est\s+ce\s+que\s+tu\s+(sais|peux|fait)|que\s+sais?[- ]tu\s+faire|tes\s+capacit[ée]s|what\s+can\s+you\s+do|qu\s*'?est\s+ce\s+qu\s*'?il\s+manque)\b/i;

/** Concrete edit verbs — "peux-tu mettre/créer" is an action, not a capability question. */
const STRONG_WRITE_VERB =
  /\b(mett\w*|met(s|tre|tez)?|écri\w*|ecri\w*|coll\w*|ins[èe]r\w*|g[ée]n[ée]r\w*|cr[ée][eé]\w*|rempl\w*|colori\w*|format\w*|ajout\w*|supprim\w*|effac\w*)\b/i;

/**
 * User is asking what the agent can do / knows — do not paste a grid.
 * "Peux-tu mettre la liste…" is an action; "est-ce que tu sais faire une table" is meta.
 * @param {string} text
 * @returns {boolean}
 */
export function detectMetaQuestion(text) {
  const wText = String(text || '').trim();
  if (!wText) {
    return false;
  }
  if (LLAMA_CAPABILITY_QUESTION.test(wText)) {
    return true;
  }
  const wAbilityAsk =
    /\best[\s-]*ce[\s-]*que\s+tu\s+(sais|connais|peux|arrives?)\b/i.test(wText) ||
    /^(sais|connais|peux|arrives?)[\s-]*tu\b/i.test(wText) ||
    /\b(connais|sais)[\s-]*tu\b/i.test(wText);
  if (!wAbilityAsk) {
    return false;
  }
  if (STRONG_WRITE_VERB.test(wText)) {
    return false;
  }
  if (/\bfaire\b/i.test(wText) && /\b(tableau|table|grille|feuille|facture)\b/i.test(wText)) {
    return /\b(sais|connais)\b/i.test(wText);
  }
  return true;
}

const LLAMA_WHY_CANT_WRITE =
  /\b(pourquoi|comment\s+se\s+fait)\b[\s\S]{0,120}\b(n\s+'?y\s+arrive\s+pas|n'?arrive\s+pas|peux?\s+pas|impossible|ne\s+peux?\s+pas)\b/i;

const LLAMA_WHY_WRITE_EXPLANATION =
  'Vous êtes en mode llama chat (start-ai-llama.sh) : texte seulement — pas d\'outils MCP.\n\n' +
  '• Le mode chat n\'est pas branché sur le WASM tableur.\n' +
  '• Un petit modèle invente parfois Excel/Google Sheets — ce n\'est pas sker.\n\n' +
  'Pour écrire dans le classeur (liste, tableau, cellule) en local avec Qwen3.5-35B-A3B + MCP :\n' +
  '1. llama serve avec Qwen3.5-35B-A3B sur le port 8080\n' +
  '2. `bash Node/Server/start-ai-llama-agent.sh`\n' +
  '3. Cmd+Shift+R, classeur .sker ouvert, renvoyez la demande.\n\n' +
  'Alternative cloud : `start-ai-cursor.sh` + tunnel MCP.';

/**
 * @param {string} text
 * @returns {boolean}
 */
function hasSpreadsheetWriteIntent(text) {
  return (
    /(écrire|ecrire|écris|ecris|écri|ecri)/i.test(text) ||
    /\b(met(s|tre|tez)?|place(r|z)?|tape(r|z)?|rempl(i|is|ir)|ins[èe]r|modif\w*|effac\w*|supprim\w*|copi\w*|coll\w*|lis\b|lit\b|lire|envoy\w*|format\w*|remplis|colori\w*|colorer|surlign\w*)\b/i.test(
      text
    )
  );
}

/**
 * Spreadsheet/MCP action requests must not go to the small local model (it hallucinates).
 * @param {string} prompt
 * @returns {boolean}
 */
export function detectSpreadsheetActionRequest(prompt) {
  const wText = String(prompt || '').trim();
  if (!wText) {
    return false;
  }
  if (detectMetaQuestion(wText)) {
    return false;
  }

  if (/\b(mcp|read_workbook|write_cell|write_cells|paste_grid|paste_range|list_sheets|format_range|apply_format|create_table)\b/i.test(wText)) {
    return true;
  }
  if (detectTableCreationIntent(wText)) {
    return true;
  }
  if (detectFormatColorIntent(wText)) {
    return true;
  }

  const wHasCell =
    CELL_REF_PATTERN.test(wText) ||
    CELL_RANGE_PATTERN.test(wText) ||
    Boolean(extractA1RangeFromText(wText));
  const wActionVerb = hasSpreadsheetWriteIntent(wText);
  const wCellContext =
    /\b(cellule|plage|colonne|ligne|feuille|classeur|tab\w*au|tableur|spreadsheet|\.sker)\b/i.test(wText);

  if (/(écrire|ecrire|écris|ecris)\s+(directement\s+)?(dans\s+)?(le\s+)?(tableur|classeur|fichier)/i.test(wText)) {
    return true;
  }
  if (/\b(dans|en)\s+(la\s+)?cellule\s+[A-Z]{1,4}\d{1,7}\b/i.test(wText)) {
    return true;
  }
  if (/\b(dans|en)\s+[A-Z]{1,4}\d{1,7}\b/i.test(wText) && wActionVerb) {
    return true;
  }
  if (/^(écri|ecri|Ecrit|ecrit|met(s|tez)?|place|tape|remplis)\b/i.test(wText) && wHasCell) {
    return true;
  }
  if (wHasCell && wActionVerb) {
    return true;
  }
  if (wActionVerb && (wHasCell || wCellContext)) {
    return true;
  }
  if (/\b(modif\w*|rempl\w*)\s+(le\s+)?(tableur|classeur|fichier)\b/i.test(wText)) {
    return true;
  }
  if (/\.sker\b/i.test(wText) && wActionVerb) {
    return true;
  }
  if (/(dis|dire)\b/i.test(wText) && wCellContext && wHasCell) {
    return true;
  }

  return false;
}

/**
 * User wants a new table/grid pasted into the sheet (not just an explanation).
 * @param {string} text
 * @returns {boolean}
 */
export function detectTableCreationIntent(text) {
  const wText = String(text || '').trim();
  if (!wText) {
    return false;
  }
  if (detectMetaQuestion(wText)) {
    return false;
  }
  const wTableWord = /\b(tableau|table|tabelau|grille|grid|spreadsheet)\b/i.test(wText);
  const wCreateVerb =
    /\b(g[ée]n[ée]r\w*|cr[ée][eé]\w*|faire|fabriqu\w*|construi\w*|produi\w*|rempl\w*|mett\w*|met(s|tre|tez)?|col+e(r|z)?)\b/i.test(
      wText
    );
  if (wCreateVerb && wTableWord) {
    return true;
  }
  if (/\bdans\s+(un\s+)?tableau\b/i.test(wText) || /\bsous\s+forme\s+de\s+tableau\b/i.test(wText)) {
    return true;
  }
  return /\b(tableau|table|tabelau)\b[\s\S]{0,48}\b(villes?|r[ée]gions?|d[ée]partements?|pays|produits?|clients?|donn[ée]es|liste)\b/i.test(
    wText
  );
}

/**
 * User wants a list/catalog written as a grid (not a chat enumeration).
 * @param {string} text
 * @returns {boolean}
 */
export function detectListDumpIntent(text) {
  const wText = String(text || '').trim();
  if (!wText) {
    return false;
  }
  if (detectMetaQuestion(wText)) {
    return false;
  }
  if (detectTableCreationIntent(wText)) {
    return true;
  }
  return /\b(liste|listing|énum[ée]r\w*)\s+(des?|du|les|de\s+la)\b/i.test(wText);
}

/**
 * Color / format an existing grid (not a new paste_grid).
 * @param {string} text
 * @returns {boolean}
 */
export function detectFormatColorIntent(text) {
  const wText = String(text || '').trim();
  if (!wText) {
    return false;
  }
  return (
    /\b(colori\w*|colorer|couleur|surlign\w*|mise\s+en\s+forme)\b/i.test(wText) ||
    /\b(fond|en)\s+(bleu|rouge|vert|jaune|gris)\b/i.test(wText)
  );
}

/**
 * Bare range follow-up like "de A1 à D10" or "A1:D10".
 * @param {string} text
 * @returns {boolean}
 */
function isRangeOnlyPrompt(text) {
  const wText = String(text || '').trim();
  if (!wText) {
    return false;
  }
  if (extractA1RangeFromText(wText) && wText.length < 40) {
    return !detectTableCreationIntent(wText) && !hasSpreadsheetWriteIntent(wText);
  }
  return false;
}

/**
 * Invoice / billing document the agent should build via generic tools (not a dedicated tool).
 * @param {string} text
 * @returns {boolean}
 */
function detectInvoiceIntent(text) {
  const wText = String(text || '').trim();
  if (!wText) {
    return false;
  }
  if (detectMetaQuestion(wText)) {
    return false;
  }
  if (/\bfacture\b/i.test(wText)) {
    return true;
  }
  return (
    /\b(tva|ht|ttc|euro|€)\b/i.test(wText) &&
    /\b([ée]metteur|emetteur|client|vends?|vendu|prestation|travaux)\b/i.test(wText)
  );
}

/** Tool names the llama agent may invoke (for embedded-json recovery). */
const LLAMA_AGENT_TOOL_NAMES = new Set([
  'read_cell',
  'write_cell',
  'write_formatted_cell',
  'write_cells',
  'read_range',
  'list_files',
  'paste_file_list',
  'list_sheets',
  'create_sheet',
  'read_workbook',
  'paste_grid',
  'list_tables',
  'create_table',
  'merge_cells',
  'apply_format',
  'resize_columns',
  'resize_rows',
  'apply_table_filter_sort',
]);

/**
 * Qwen sometimes prints {"name":"paste_grid","arguments":{…}} in text instead of tool_calls.
 * @param {string} content
 * @returns {Array<{ name: string, args: Record<string, unknown> }>}
 */
export function extractEmbeddedToolCallsFromContent(content) {
  /** @type {Array<{ name: string, args: Record<string, unknown> }>} */
  const wOut = [];
  const wSeen = new Set();

  /** @param {string} name @param {Record<string, unknown>} args */
  const wPush = (name, args) => {
    const wName = String(name || '').trim();
    if (!LLAMA_AGENT_TOOL_NAMES.has(wName)) {
      return;
    }
    const wArgs = args && typeof args === 'object' ? args : {};
    const wKey = `${wName}\0${JSON.stringify(wArgs)}`;
    if (wSeen.has(wKey)) {
      return;
    }
    wSeen.add(wKey);
    wOut.push({ name: wName, args: wArgs });
  };

  /** @param {unknown} obj */
  const wParseObject = (obj) => {
    if (!obj || typeof obj !== 'object') {
      return;
    }
    /** @type {Record<string, unknown>} */
    const wRec = obj;
    if (typeof wRec.name === 'string' && wRec.arguments && typeof wRec.arguments === 'object') {
      wPush(wRec.name, /** @type {Record<string, unknown>} */ (wRec.arguments));
      return;
    }
    const wFn = wRec.function;
    if (wFn && typeof wFn === 'object' && typeof wFn.name === 'string') {
      let wArgs = wFn.arguments;
      if (typeof wArgs === 'string') {
        try {
          wArgs = JSON.parse(wArgs);
        } catch {
          wArgs = {};
        }
      }
      wPush(wFn.name, /** @type {Record<string, unknown>} */ (wArgs && typeof wArgs === 'object' ? wArgs : {}));
    }
  };

  /** @param {string} blob */
  const wParseBlob = (blob) => {
    const wTrim = String(blob || '').trim();
    if (!wTrim) {
      return;
    }
    try {
      const wParsed = JSON.parse(wTrim);
      if (Array.isArray(wParsed)) {
        for (const wItem of wParsed) {
          wParseObject(wItem);
        }
      } else {
        wParseObject(wParsed);
      }
    } catch {
      // ignore invalid JSON fragments
    }
  };

  const wText = String(content || '');
  for (const wMatch of wText.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    wParseBlob(wMatch[1]);
  }
  if (wOut.length === 0 && /"name"\s*:\s*"(paste_grid|write_cell|write_formatted_cell)"/i.test(wText)) {
    wParseBlob(wText);
  }
  return wOut;
}

/**
 * @param {string} prompt
 * @returns {string|null}
 */
function buildLlamaCannedReply(prompt) {
  const wText = String(prompt || '').trim();

  if (LLAMA_WHY_CANT_WRITE.test(wText)) {
    return LLAMA_WHY_WRITE_EXPLANATION;
  }

  if (/\bmcp\b/i.test(wText)) {
    return (
      'En mode llama chat, je n\'ai pas accès au MCP (read_cell, paste_grid, etc.).\n\n' +
      'Pour MCP local avec Qwen3.5-35B-A3B (sans Cursor) :\n' +
      '1. Qwen3.5-35B-A3B sur llama-server :8080\n' +
      '2. `bash Node/Server/start-ai-llama-agent.sh`\n' +
      '3. Cmd+Shift+R, puis renvoyez votre demande.\n\n' +
      'Alternative cloud : `start-ai-cursor.sh` + tunnel MCP.'
    );
  }

  if (detectSpreadsheetActionRequest(prompt)) {
    const wCellMatch = String(prompt).match(/\b([A-Z]{1,4}\d{1,7})\b/);
    const wCell = wCellMatch ? wCellMatch[1] : null;
    const wCellPart = wCell ? ` dans ${wCell}` : ' sur le classeur';
    return (
      `Je ne peux pas écrire ni modifier${wCellPart} en mode llama chat — texte seulement.\n\n` +
      'Pour coller une liste, un tableau ou une cellule avec Qwen3.5-35B-A3B + MCP local :\n' +
      '1. Arrêtez SkServer (Ctrl+C)\n' +
      `2. Lancez Qwen3.5-35B-A3B : \`${getLlamaRecommendedServeCommand()}\`\n` +
      '3. `bash Node/Server/start-ai-llama-agent.sh`\n' +
      '4. Cmd+Shift+R, puis renvoyez la même demande.'
    );
  }

  if (LLAMA_CAPABILITY_QUESTION.test(prompt)) {
    return (
      'Mode llama chat (actuel) — je peux :\n' +
      '• Répondre en texte à des questions générales (listes, définitions, compta si vous la posez)\n' +
      '• Expliquer des concepts ou donner des exemples chiffrés\n\n' +
      'Je ne peux pas lire/écrire des cellules en mode chat.\n\n' +
      'Pour coller un tableau ou éditer le classeur : `bash Node/Server/start-ai-llama-agent.sh` (Qwen3.5-35B-A3B local) ' +
      'ou `start-ai-cursor.sh` (Cursor cloud).'
    );
  }

  return null;
}

/**
 * @returns {string}
 */
export function getLlamaBaseUrl() {
  return (process.env.SK_LLAMA_BASE_URL || 'http://127.0.0.1:8080/v1').trim().replace(/\/$/, '');
}

/**
 * @returns {string}
 */
function getLlamaHealthUrl() {
  const wBase = getLlamaBaseUrl();
  if (wBase.endsWith('/v1')) {
    return `${wBase.slice(0, -3)}/health`;
  }
  return `${wBase}/health`;
}

/**
 * @returns {string}
 */
function getLlamaModelId() {
  return (process.env.SK_LLAMA_MODEL || LLAMA_DEFAULT_MODEL).trim();
}

/** Max completion tokens for MCP tool-call JSON (llama-server max_tokens). */
export function getLlamaAgentMaxTokens() {
  const wVal = Number(process.env.SK_LLAMA_MAX_TOKENS);
  if (Number.isFinite(wVal) && wVal > 0) {
    return wVal;
  }
  return 8192;
}

/** Larger budget when llama-server fails to parse truncated tool JSON. */
function getLlamaJsonRetryMaxTokens() {
  const wOverride = Number(process.env.SK_LLAMA_MCP_JSON_RETRY_MAX_TOKENS);
  if (Number.isFinite(wOverride) && wOverride > 0) {
    return wOverride;
  }
  return Math.max(getLlamaAgentMaxTokens(), 16384);
}

/** After a successful paste_grid, cap the French summary so the model cannot dump every cell. */
function getLlamaAfterToolsMaxTokens() {
  const wOverride = Number(process.env.SK_LLAMA_AFTER_TOOLS_MAX_TOKENS);
  if (Number.isFinite(wOverride) && wOverride > 0) {
    return wOverride;
  }
  return 768;
}

/**
 * Qwen3.5 thinking tokens steal the budget and truncate tool JSON (e.g. "Auver).
 * @param {Record<string, unknown>} body
 * @returns {Record<string, unknown>}
 */
function applyLlamaCompletionOptions(body) {
  const wOut = { ...body };
  delete wOut.parallel_tool_calls;
  const wPrev =
    wOut.chat_template_kwargs && typeof wOut.chat_template_kwargs === 'object'
      ? /** @type {Record<string, unknown>} */ (wOut.chat_template_kwargs)
      : {};
  wOut.chat_template_kwargs = { ...wPrev, enable_thinking: false };
  wOut.enable_thinking = false;
  if (typeof wOut.max_tokens === 'number' && Number.isFinite(wOut.max_tokens)) {
    wOut.n_predict = wOut.max_tokens;
  }
  return wOut;
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isLlamaToolJsonError(err) {
  const wMsg = String(err?.message || err?.details?.error?.message || '');
  return /parse tool call|parse_error|invalid string|missing closing quote|unexpected end of input|unterminated/i.test(
    wMsg
  );
}

/**
 * @param {string} toolName
 * @param {Record<string, unknown>} args
 * @param {{ selection?: string, cursorRef?: string }|null|undefined} spreadsheetContext
 * @param {string} prompt
 * @returns {Record<string, unknown>}
 */
function applySelectionContextToWriteToolArgs(toolName, args, spreadsheetContext, prompt) {
  if (
    toolName === 'write_cell' ||
    toolName === 'write_formatted_cell' ||
    toolName === 'write_cells' ||
    toolName === 'paste_grid' ||
    toolName === 'apply_format'
  ) {
    const wBeforeRef = String(args.ref || '').trim();
    const wBeforeSheet = String(args.sheet || '').trim();
    const wPatched = applySpreadsheetContextToWriteToolArgs(
      toolName,
      args,
      spreadsheetContext,
      prompt
    );
    const wAfterRef = String(wPatched.ref || '').trim();
    const wAfterSheet = String(wPatched.sheet || '').trim();
    if (wAfterRef && wBeforeRef.toUpperCase() !== wAfterRef.toUpperCase()) {
      console.log(
        `[ai/ask] llama MCP patched ${toolName} ref ${wBeforeRef || '(empty)'} -> ${wAfterRef} (UI selection context)`
      );
    }
    if (wAfterSheet && wBeforeSheet !== wAfterSheet) {
      console.log(
        `[ai/ask] llama MCP patched ${toolName} sheet ${wBeforeSheet || '(empty)'} -> ${wAfterSheet} (UI active sheet)`
      );
    }
    return wPatched;
  }
  return ensureActiveSheetOnWriteToolArgs(toolName, args, spreadsheetContext);
}

/**
 * Read active cell and strip stray quotes / formula prefix for correction prompts.
 * @param {{
 *   workbookPath?: string,
 *   spreadsheetTools?: import('./SkeeptoTools.mjs').SkeeptoTools,
 *   spreadsheetContext?: { sheet?: string },
 * }} options
 * @param {string} ref
 * @param {string} sheet
 * @returns {Promise<string>}
 */
async function resolveCorrectedSelectionValue(options, ref, sheet) {
  if (!options.spreadsheetTools || !options.workbookPath) {
    return '';
  }
  try {
    const wCurrent = await options.spreadsheetTools.readCell(options.workbookPath, ref, sheet);
    const wRaw = String(wCurrent ?? '').trim();
    if (!wRaw) {
      return '';
    }
    const wFixed = normalizeWriteCellValue(wRaw);
    return wFixed && wFixed !== wRaw ? wFixed : '';
  } catch (err) {
    console.warn('[ai/ask] selection correction read failed:', err?.message || err);
    return '';
  }
}

/**
 * Direct write_cell for simple "écrire X dans la cellule de sélection" (bypasses Qwen).
 * @param {{
 *   prompt: string,
 *   workbookPath?: string,
 *   spreadsheetContext?: { sheet?: string, selection?: string, cursorRef?: string },
 *   spreadsheetTools?: import('./SkeeptoTools.mjs').SkeeptoTools,
 *   userEmail?: string,
 * }} options
 * @returns {Promise<object|null>}
 */
async function tryDirectSelectionWrite(options) {
  if (!detectSelectionTargetIntent(options.prompt)) {
    return null;
  }
  const wRef = resolveSpreadsheetTargetRef(options.spreadsheetContext);
  if (!wRef || !options.spreadsheetTools || !options.workbookPath) {
    return null;
  }
  const wSheet = options.spreadsheetContext?.sheet ? String(options.spreadsheetContext.sheet) : '';
  let wValue = extractSimpleWriteValueFromPrompt(options.prompt);
  if (!wValue && detectSelectionCorrectionIntent(options.prompt)) {
    wValue = await resolveCorrectedSelectionValue(options, wRef, wSheet);
  }
  if (!wValue) {
    return null;
  }

  const wExecutor = createSkAiMcpToolExecutor(options.spreadsheetTools, {
    defaultWorkbookPath: options.workbookPath,
    userEmail: options.userEmail,
  });
  const wStart = Date.now();
  console.log(`[ai/ask] llama MCP direct write_cell ${wRef}`, wValue);
  try {
    await wExecutor.callTool('write_cell', {
      path: options.workbookPath,
      ref: wRef,
      value: wValue,
      sheet: wSheet,
    });
  } catch (err) {
    console.warn('[ai/ask] direct selection write failed:', err?.message || err);
    return null;
  }

  const wSheetNote = wSheet ? ` (feuille ${wSheet})` : '';
  const wResultText = isFormulaText(wValue)
    ? `Formule ${wValue} écrite en ${wRef}${wSheetNote}.`
    : `« ${wValue} » écrit en ${wRef}${wSheetNote}.`;
  return {
    provider: 'llama',
    llamaMcp: true,
    status: 'FINISHED',
    result: wResultText,
    durationMs: Date.now() - wStart,
    model: 'sker-selection-write',
    toolCalls: 1,
    steps: 1,
    direct: true,
  };
}

/**
 * Top-left cell for a catalog paste: explicit "en B2" / A1:D10, else A1.
 * @param {string} prompt
 * @returns {string}
 */
function extractListPasteStartRef(prompt) {
  const wRange = extractA1RangeFromText(prompt);
  if (wRange) {
    return String(wRange).split(':')[0];
  }
  const wEn = String(prompt || '').match(/\b(?:en|dans|à)\s+([A-Za-z]{1,4}\d{1,7})\b/i);
  if (wEn) {
    return String(wEn[1]).toUpperCase();
  }
  return 'A1';
}

/**
 * @param {string} pasteText
 * @returns {string}
 */
function extractPasteGridRangeFromToolResult(pasteText) {
  try {
    const wParsed = JSON.parse(String(pasteText || ''));
    if (wParsed && typeof wParsed.range === 'string' && wParsed.range.trim()) {
      return wParsed.range.trim();
    }
  } catch {
    /* tool result may already be a short sentence */
  }
  return '';
}

/**
 * Paste a built-in catalog (départements, régions) in one paste_grid — Qwen cannot
 * emit 101 complete JSON rows without truncating names.
 * @param {{
 *   prompt: string,
 *   workbookPath?: string,
 *   spreadsheetContext?: { sheet?: string, selection?: string, cursorRef?: string },
 *   spreadsheetTools?: import('./SkeeptoTools.mjs').SkeeptoTools,
 *   userEmail?: string,
 * }} options
 * @returns {Promise<object|null>}
 */
async function tryDirectKnownListPaste(options) {
  if (detectMetaQuestion(options.prompt)) {
    return null;
  }
  const wList = matchKnownList(options.prompt);
  if (!wList || !options.spreadsheetTools || !options.workbookPath) {
    return null;
  }

  const wStartRef = extractListPasteStartRef(options.prompt);
  const wSheet = options.spreadsheetContext?.sheet ? String(options.spreadsheetContext.sheet) : '';
  const wExecutor = createSkAiMcpToolExecutor(options.spreadsheetTools, {
    defaultWorkbookPath: options.workbookPath,
    userEmail: options.userEmail,
  });
  const wStart = Date.now();
  console.log(`[ai/ask] llama MCP direct paste_grid catalog ${wList.id} at ${wStartRef}`);
  let wToolResult;
  try {
    wToolResult = await wExecutor.callTool('paste_grid', {
      path: options.workbookPath,
      startRef: wStartRef,
      rows: buildKnownListGrid(wList),
      sheet: wSheet,
      styles: {
        header: 'background-color:#4472C4;color:#ffffff;font-weight:bold;',
        dataOdd: 'background-color:#D6EAF8;',
        dataEven: 'background-color:#ffffff;',
      },
    });
  } catch (err) {
    console.warn('[ai/ask] direct known-list paste failed:', err?.message || err);
    return null;
  }

  const wRange = extractPasteGridRangeFromToolResult(wToolResult) || wStartRef;
  const wSheetNote = wSheet ? ` (feuille ${wSheet})` : '';
  return {
    provider: 'llama',
    llamaMcp: true,
    status: 'FINISHED',
    result: `${wList.title} (${wList.rows.length} lignes) collé en ${wRange}${wSheetNote}.`,
    durationMs: Date.now() - wStart,
    model: 'sker-known-list',
    toolCalls: 1,
    steps: 1,
    direct: true,
  };
}

/**
 * Per-cell writes cannot carry a 100-row catalog through Qwen JSON.
 * @param {string} prompt
 * @param {string} toolName
 * @returns {boolean}
 */
function isListDumpPerCellWrite(prompt, toolName) {
  return detectListDumpIntent(prompt) && LIST_DUMP_BLOCKED_TOOLS.has(String(toolName));
}

/**
 * @param {unknown} messages
 * @returns {string}
 */
function extractOriginalUserPrompt(messages) {
  if (!Array.isArray(messages)) {
    return '';
  }
  for (const wMsg of messages) {
    if (wMsg?.role === 'user' && typeof wMsg.content === 'string') {
      return wMsg.content;
    }
  }
  return '';
}

/**
 * @param {AbortSignal[]} signals
 * @returns {AbortSignal}
 */
function mergeAbortSignals(signals) {
  const wController = new AbortController();
  for (const wSig of signals) {
    if (!wSig) {
      continue;
    }
    if (wSig.aborted) {
      wController.abort(wSig.reason);
      return wController.signal;
    }
    wSig.addEventListener('abort', () => wController.abort(wSig.reason), { once: true });
  }
  return wController.signal;
}

/**
 * @param {AbortSignal|undefined} abortSignal
 */
function throwIfAborted(abortSignal) {
  if (abortSignal?.aborted) {
    const wErr = new Error('Requête annulée.');
    wErr.statusCode = 499;
    wErr.code = 'ABORTED';
    throw wErr;
  }
}

function buildLlamaToolJsonRetryHint(err, userPrompt = '') {
  const wMsg = String(err?.message || err?.details?.error?.message || '');
  const wTruncated = /missing closing quote|unterminated|unexpected end|truncated/i.test(wMsg);
  if (detectListDumpIntent(userPrompt) || detectInvoiceIntent(userPrompt) || wTruncated) {
    return (
      'JSON tool call TRONQUÉ (ex. "Auver sans guillemet fermant). Relance UN paste_grid COMPLET et COURT : ' +
      'pas de styles, 15 lignes max par appel, chaque string fermée. ' +
      'Si la liste est longue : 1er paste_grid A1:B16, 2e paste_grid A17:B33. ' +
      'Exemple: {"range":"A1:B3","rows":[["Code","Nom"],["84","PACA"],["93","PACA"]]}'
    );
  }
  if (/background|format_range|apply_format|css|format/i.test(wMsg)) {
    return (
      'Le JSON tool call a échoué. Pour UNE cellule stylée utilise write_formatted_cell avec des flags ' +
      '(bold, italic, backgroundColor, fontFamily, fontSizePt). Pour une PLAGE utilise apply_format avec properties[] ' +
      '(ex. ["background-color:#4472C4","color:white","font-weight:bold"]) — PAS format_range ni css brut long. ' +
      'Exemple: {"range":"A1:C1","properties":["background-color:#4472C4","color:white","font-weight:bold"]}'
    );
  }
  return (
    'Le tool call précédent avait un JSON invalide ou tronqué. ' +
    'Appelle UN seul outil avec JSON minimal (paste_grid range+rows, ou write_cell). ' +
    'Omet path si workbook actif. Pas de guillemets dans les valeurs.'
  );
}

/**
 * @param {Record<string, unknown>} body
 * @param {number} timeoutMs
 * @param {(mode: 'default'|'safe'|'full') => unknown[]} getTools
 * @param {AbortSignal} [abortSignal]
 */
async function callLlamaChatCompletionsWithRetry(body, timeoutMs, getTools, abortSignal) {
  const wMaxRetries = Number(process.env.SK_LLAMA_MCP_JSON_RETRIES) || 2;
  /** @type {Record<string, unknown>} */
  let wBody = { ...body };
  delete wBody.parallel_tool_calls;
  let wLastErr;

  for (let wAttempt = 0; wAttempt <= wMaxRetries; wAttempt++) {
    throwIfAborted(abortSignal);
    try {
      return await callLlamaChatCompletions(wBody, timeoutMs, abortSignal);
    } catch (err) {
      wLastErr = err;
      if (wAttempt >= wMaxRetries || !isLlamaToolJsonError(err)) {
        throw err;
      }
      console.warn(`[ai/ask] llama tool JSON parse error — retry ${wAttempt + 1}/${wMaxRetries}`);
      const wMessages = Array.isArray(wBody.messages) ? [...wBody.messages] : [];
      wMessages.push({
        role: 'user',
        content: buildLlamaToolJsonRetryHint(err, extractOriginalUserPrompt(wBody.messages)),
      });
      wBody = {
        ...wBody,
        messages: wMessages,
        tools: getTools('compact'),
        max_tokens: getLlamaJsonRetryMaxTokens(),
        n_predict: getLlamaJsonRetryMaxTokens(),
        tool_choice: 'required',
        temperature: 0,
      };
    }
  }
  throw wLastErr;
}

/**
 * @returns {Promise<boolean>}
 */
export async function probeLlamaHealth() {
  try {
    const wRes = await httpFetch(getLlamaHealthUrl(), {
      signal: AbortSignal.timeout(3000),
    });
    return wRes.ok;
  } catch {
    return false;
  }
}

/**
 * @param {string|undefined} workbookPath
 * @param {string|undefined} spreadsheetLang
 * @returns {string}
 */
export function buildLlamaChatSystemPrompt(workbookPath, spreadsheetLang) {
  const wLang = normalizeSpreadsheetLang(spreadsheetLang);
  const wLines = [
    'Tu es un assistant général pour l\'application sker (tableur).',
    'Mode: llama-server local — TEXTE UNIQUEMENT. Tu n\'as aucun outil, aucun MCP, aucun accès au classeur.',
    '',
    'INTERDIT (ne jamais prétendre le contraire):',
    '- Lire ou écrire une cellule, une plage, un classeur',
    '- Appeler MCP, read_workbook, paste_grid, write_cell ou tout autre outil',
    '- Voir le contenu du fichier — le chemin ci-dessous est une info contextuelle, pas un accès',
    '- Inventer une liste de capacités techniques',
    '- Remplacer la demande par un autre sujet (compta, facture, TVA, bilan) si ce n\'est pas ce qui a été demandé',
    '',
    'AUTORISÉ:',
    '- Répondre à toute question (listes, définitions, calculs, compta seulement si on te la pose)',
    '- Donner des listes ou tableaux en texte (markdown) si l\'utilisateur ne demande pas d\'écrire dans le classeur',
    '- Dire comment faire manuellement dans sker',
    '',
    'Si l\'utilisateur demande d\'écrire/modifier/lire une cellule, de coller un tableau dans le classeur, ou d\'utiliser MCP:',
    'Réponds brièvement en français: tu ne peux pas le faire en mode llama chat. Pour éditer le classeur,',
    'utilisez bash Node/Server/start-ai-llama-agent.sh (MCP local) ou start-ai-cursor.sh (Cursor cloud).',
    '',
    'Style: réponses courtes et honnêtes (sauf si l\'utilisateur demande un développement).',
    `Langue UI sker: ${wLang} — réponds en français si l'utilisateur écrit en français.`,
  ];
  if (workbookPath) {
    wLines.push('', `Classeur ouvert (tu ne peux PAS le lire ni le modifier): ${workbookPath}`);
  }
  return wLines.join('\n');
}

/**
 * Static agent system prompt (no workbook/selection). Volatile UI context must stay in
 * the user message so llama.cpp can reuse the KV-cache prefix (system + tool schemas).
 * @param {string|undefined} spreadsheetLang
 * @returns {string}
 */
export function buildLlamaAgentSystemPrompt(spreadsheetLang) {
  const wLang = normalizeSpreadsheetLang(spreadsheetLang);
  const wLines = [
    'You are a spreadsheet assistant for the sker application.',
    'You edit workbooks via the provided function tools (same MCP tools as Cursor, executed locally).',
    'Always include path on every tool call — use the active workbook path from the user-message UI context block.',
    'The user message ends with an "Active spreadsheet context" block (path, sheet, selection, cursor). Treat it as authoritative for "here", "this sheet", and "selection".',
    'Agent rules:',
    '- You HAVE MCP tools on the open workbook and /share/ virtual disk. Use them.',
    '- Never say you lack internet, web access, or cannot touch the workbook — that is false in this mode.',
    '- When the user asks to write, read, format, list, or put something in a table: call the tool immediately — do not reply with a capability disclaimer first.',
    '- The user request is the spec: write THAT content. Never substitute a different template (accounting entries, amortization, VAT, balance sheet, invoice) unless they asked for it.',
    '- Only list capabilities when the user explicitly asks (e.g. "que peux-tu faire", "est-ce que tu sais faire une table", "connais-tu les fonctions Excel") — answer in French, do NOT paste a grid.',
    '- After a tool succeeds, summarize in one short French sentence what changed (cell ref, sheet, range).',
    ...buildAgentCapabilitiesPromptLines(),
    ...buildAgentLocalePromptLines(wLang),
    'Efficiency:',
    '- Single plain cell: write_cell (e.g. ref H7, value Allez).',
    '- Single STYLED cell (bold, colors, font): write_formatted_cell — ONLY when the user asks for custom formatting on a non-table cell.',
    '- STYLED range or "color this table": ONE apply_format on the range — never read_range first.',
    '- Several cells: write_cells or one paste_grid — never dozens of write_cell.',
    '- NEW tabular data (any list, catalog, or document the user asked for): ONE paste_grid that ALREADY contains every requested value AND every total/subtotal formula (as "=…" strings) in the SAME call. This is the default — do NOT create an Excel table unless the user explicitly asks for one.',
    '- Lists and catalogs (departments, cities, products, files, …): row 0 = headers, one item per row — NOT one item per column.',
    '- Totals/subtotals go in the paste_grid rows on the FIRST pass (e.g. row "Total" → "=SUM(D5:D12)"). NEVER produce the layout first and add formulas only after the user complains.',
    '- Only claim formulas were added if this paste_grid/write_cells call actually contained the "=…" strings.',
    '- CRITICAL: invoke tools via function calling API only. NEVER paste tool JSON or markdown tables as a substitute for calling paste_grid.',
    '- For a nice LOOK by default, use paste_grid styles (header/dataOdd/dataEven) or apply_format on the header. format-string (number/date/currency) via apply_format is OK on columns. Only switch to create_table + tableStyleName if the user explicitly asked for an Excel table.',
    '- Column/row sizes: only if the user asks — resize_columns / resize_rows (whole span, one call).',
    '- No copy_range/paste_range unless SK_LLAMA_MCP_FULL_TOOLS=1.',
    '- Range must cover header + all data rows (e.g. 1 header + 100 data → A1:C101).',
    '- Formulas in paste_grid: strings starting with = (e.g. "=B2*C2", "=SUM(D5:D12)", "=D18-D27"). Numbers as JSON numbers. Include them from the first pass.',
    '- Copy formatted block: duplicate_range only if needed (avoid paste_range cp JSON).',
    '- ONLY when the user explicitly asked for an Excel table: after paste_grid, create_table with EXACTLY the same range (not off-by-one) and tableStyleName.',
    '- Example (table requested): paste_grid H1:J42 → create_table H1:J42 tableStyleName TableStyleMedium2 (NOT H1:J41).',
    '- Table names are workbook-global. Omit name on create_table (auto Table2, Table3, …). NEVER reuse Table1 if it already exists.',
    '- list_tables before create_table when tables may exist; list_tables before apply_table_filter_sort.',
    '- To describe/summarize a workbook: list_sheets first, then read_range on the used area — avoid read_workbook on large files unless necessary.',
    '- list_files: .sker files on virtual disk (/share/…). list_sheets: tabs inside the open workbook.',
    '- New sheet tab: create_sheet BEFORE write/paste on that name (exact name, including # if requested), or pass sheet on paste_grid (server auto-creates if missing). Skip list_sheets.',
    '- Structured layouts (invoice, form, quote, …): MAX 4 tools — (1) create_sheet if a new tab, (2) ONE paste_grid with every value AND English formulas (=SUM, =B5*C5, never SOMME), (3) optional ONE apply_format for extra rows (e.g. Total TTC), (4) optional ONE resize_columns for the used span. Never write_cell / write_formatted_cell in a loop. Never read_range.',
    '- To list files IN the spreadsheet: paste_file_list (not invented rows).',
    'Tool JSON: keep arguments small and valid. create_table example: {"range":"B2:F42","tableStyleName":"TableStyleMedium2"}. Number format OK: apply_format with properties ["format-string:\\"#,##0.00\\";"]. Escape quotes in values.',
    'Speed: NEVER list cell values one by one. NEVER call read_range before coloring. New grid = ONE paste_grid — omit styles if the JSON would be long. Tool JSON must be complete (never cut a string like "Auver). Split long lists into two paste_grid. Color existing grid = ONE apply_format. After tools: one short French sentence.',
    'Reply briefly in French when the user writes in French.',
  ];
  return wLines.join('\n');
}

/**
 * User turn: prompt + volatile UI context (selection/sheet/path). Kept out of system
 * so Qwen's tool dump stays a stable prefix for llama.cpp LCP / KV cache.
 * @param {string} prompt
 * @param {string|undefined} workbookPath
 * @param {{ workbookPath?: string, sheet?: string, selection?: string, cursorRef?: string }|null|undefined} spreadsheetContext
 * @param {Array<{ role: string, content: string }>} [history]
 * @returns {string}
 */
export function buildLlamaAgentUserPrompt(prompt, workbookPath, spreadsheetContext, history) {
  const wText = buildSelectionAwareUserPrompt(prompt, spreadsheetContext);
  const wCtx = spreadsheetContext
    ? { ...spreadsheetContext, workbookPath: workbookPath || spreadsheetContext.workbookPath }
    : workbookPath
      ? { workbookPath }
      : null;
  const wHasCtx = Boolean(wCtx && (wCtx.workbookPath || wCtx.sheet || wCtx.selection || wCtx.cursorRef));
  const wCtxLines = wHasCtx ? buildSpreadsheetContextPromptLines(wCtx) : [];
  const wHintLines = buildLlamaTurnSpeedHints(prompt, wCtx, history);
  const wExtra = [...wCtxLines, ...wHintLines];
  if (!wExtra.length) {
    return wText;
  }
  return `${wText}\n\n${wExtra.join('\n')}`;
}

/**
 * @param {unknown} raw
 * @returns {Array<{ role: 'user'|'assistant', content: string }>}
 */
export function normalizeLlamaChatHistory(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  /** @type {Array<{ role: 'user'|'assistant', content: string }>} */
  const wOut = [];
  for (const wItem of raw) {
    if (!wItem || typeof wItem !== 'object') {
      continue;
    }
    const wRole = wItem.role === 'assistant' ? 'assistant' : wItem.role === 'user' ? 'user' : '';
    if (!wRole) {
      continue;
    }
    const wContent = String(wItem.content || wItem.text || '').trim().slice(0, 600);
    if (!wContent) {
      continue;
    }
    wOut.push({ role: wRole, content: wContent });
  }
  return wOut.slice(-6);
}

/**
 * @param {Array<{ role: string, content: string }>} history
 * @returns {boolean}
 */
function historyMentionsFormat(history) {
  if (!Array.isArray(history)) {
    return false;
  }
  const wBlob = history
    .slice(-4)
    .map((m) => m.content)
    .join('\n');
  return detectFormatColorIntent(wBlob);
}

/**
 * Per-turn speed hints (user message — volatile, not system).
 * @param {string} prompt
 * @param {{ selection?: string, cursorRef?: string }|null|undefined} ctx
 * @param {Array<{ role: string, content: string }>} [history]
 * @returns {string[]}
 */
function buildLlamaTurnSpeedHints(prompt, ctx, history) {
  /** @type {string[]} */
  const wLines = [];
  const wFormatFollowUp = isRangeOnlyPrompt(prompt) && historyMentionsFormat(history);
  if (detectInvoiceIntent(prompt)) {
    wLines.push(
      '[Speed] Document layout: at most 4 tools.',
      '1) create_sheet with the EXACT tab name if a new sheet is requested — do not list_sheets first.',
      '2) ONE paste_grid on that sheet with ALL rows: headers, line items, AND English formulas in the same call (e.g. "=B5*C5", "=SUM(D5:D8)", "=D10*0.2", "=D10+D11"). Never SOMME.',
      '3) Optional ONE apply_format for extra row styles (Total TTC yellow). Header look = paste_grid styles.header.',
      '4) Optional ONE resize_columns (e.g. A:D) if the user asked to fit widths.',
      'Never write_cell / write_formatted_cell per cell. After tools: one short French sentence.'
    );
  } else if (detectListDumpIntent(prompt)) {
    wLines.push(
      '[Speed] ONE paste_grid with the content the user asked for (row 0 = headers, one item per row).',
      'Keep JSON small and complete: omit styles if more than 12 rows; never cut a string (close every quote).',
      'If more than 15 rows: first paste_grid 15 rows, then a second paste_grid starting on the next row.',
      'Do NOT substitute a different table. Do NOT call resize/read_range unless asked.',
      'After the tool: one short French sentence. Never list cell values in chat.'
    );
  }
  if (!detectInvoiceIntent(prompt) && (detectFormatColorIntent(prompt) || wFormatFollowUp)) {
    const wRange =
      extractA1RangeFromText(prompt) || resolveSpreadsheetTargetRange(ctx) || 'Current selection';
    wLines.push(
      `[Speed] Call apply_format NOW on range ${wRange}. Do NOT call read_range. Do NOT list cells.`,
      'Default look if unspecified: header bold white on #4472C4, data rows striped #D6EAF8 / white.',
      'One short French sentence after the tool.'
    );
  }
  return wLines;
}

/**
 * @param {unknown} err
 * @param {AbortSignal|undefined} abortSignal
 * @returns {never}
 */
function rethrowLlamaFetchError(err, abortSignal) {
  if (err?.name === 'AbortError') {
    const wErr = new Error(
      abortSignal?.aborted
        ? 'Requête annulée.'
        : 'Timeout llama-server (réponse trop lente). Réessayez une demande plus courte.'
    );
    wErr.statusCode = abortSignal?.aborted ? 499 : 504;
    wErr.code = abortSignal?.aborted ? 'ABORTED' : 'TIMEOUT';
    throw wErr;
  }
  const wBase = getLlamaBaseUrl();
  const wHealth = getLlamaHealthUrl();
  const wDetail = String(err?.message || err || 'unknown error');
  const wErr = new Error(
    `Impossible de joindre llama-server (${wBase}). ` +
      `Vérifiez qu'il tourne et réponde : curl ${wHealth}. ` +
      `Détail : ${wDetail}`
  );
  wErr.statusCode = 502;
  wErr.cause = err;
  throw wErr;
}

/**
 * @param {Record<string, unknown>} body
 * @param {number} timeoutMs
 * @param {AbortSignal} [abortSignal]
 */
async function callLlamaChatCompletions(body, timeoutMs, abortSignal) {
  throwIfAborted(abortSignal);
  let wRes;
  try {
    wRes = await httpFetch(`${getLlamaBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(applyLlamaCompletionOptions(body)),
      signal: mergeAbortSignals([AbortSignal.timeout(timeoutMs), abortSignal]),
    });
  } catch (err) {
    rethrowLlamaFetchError(err, abortSignal);
  }

  const wText = await wRes.text();
  let wJson;
  try {
    wJson = JSON.parse(wText);
  } catch {
    wJson = { error: wText };
  }

  if (!wRes.ok) {
    const wErr = new Error(
      wJson?.error?.message || wJson?.error || `llama-server HTTP ${wRes.status}`
    );
    wErr.statusCode = wRes.status >= 500 ? 502 : wRes.status;
    wErr.details = wJson;
    throw wErr;
  }

  return wJson;
}

/**
 * @param {{
 *   prompt: string,
 *   workbookPath?: string,
 *   spreadsheetLang?: string,
 *   spreadsheetContext?: { workbookPath?: string, sheet?: string, selection?: string, cursorRef?: string },
 *   timeoutMs?: number,
 *   spreadsheetTools?: import('./SkeeptoTools.mjs').SkeeptoTools,
 *   userEmail?: string,
 *   abortSignal?: AbortSignal,
 *   history?: unknown,
 * }} options
 */
async function runLlamaAgentAsk(options) {
  throwIfAborted(options.abortSignal);
  if (!options.spreadsheetTools) {
    const wErr = new Error('SkeeptoTools is required for llama MCP agent mode');
    wErr.statusCode = 500;
    throw wErr;
  }
  if (!options.workbookPath) {
    const wErr = new Error('workbookPath is required for llama MCP agent mode');
    wErr.statusCode = 400;
    throw wErr;
  }

  if (detectMetaQuestion(options.prompt)) {
    const wExcelFns = /\bfonctions?\s+excel\b/i.test(options.prompt);
    console.log(`[ai/ask] llama MCP canned ${wExcelFns ? 'excel-functions' : 'capabilities'} answer`);
    return {
      provider: 'llama',
      llamaMcp: true,
      status: 'FINISHED',
      result: wExcelFns ? buildFrenchExcelFunctionsAnswer() : buildFrenchAgentCapabilitiesAnswer(),
      durationMs: 0,
      model: wExcelFns ? 'sker-excel-functions' : 'sker-capabilities',
      canned: true,
    };
  }

  const wKnownListPaste = await tryDirectKnownListPaste(options);
  if (wKnownListPaste) {
    return wKnownListPaste;
  }

  if (detectSelectionTargetIntent(options.prompt)) {
    const wTargetRef = resolveSpreadsheetTargetRef(options.spreadsheetContext);
    if (wTargetRef) {
      const wDirect = await tryDirectSelectionWrite(options);
      if (wDirect) {
        return wDirect;
      }
    } else {
      console.log(
        '[ai/ask] llama MCP selection intent without UI cell — falling back to Qwen',
        JSON.stringify({
          sheet: options.spreadsheetContext?.sheet || '',
          selection: options.spreadsheetContext?.selection || '',
          cursorRef: options.spreadsheetContext?.cursorRef || '',
        })
      );
    }
  }

  const wReachable = await probeLlamaHealth();
  if (!wReachable) {
    const wErr = new Error(
      `llama-server is not reachable at ${getLlamaHealthUrl().replace(/\/health$/, '')}. ` +
        'Start Qwen3.5-35B-A3B with llama serve on port 8080.'
    );
    wErr.statusCode = 503;
    throw wErr;
  }

  const wExecutor = createSkAiMcpToolExecutor(options.spreadsheetTools, {
    defaultWorkbookPath: options.workbookPath,
    userEmail: options.userEmail,
  });

  const wStart = Date.now();
  const wTimeout = options.timeoutMs ?? 300_000;
  const wTemperature = Number(process.env.SK_LLAMA_TEMPERATURE) || 0.1;
  const wMaxTokens = getLlamaAgentMaxTokens();
  const wMaxSteps = Number(process.env.SK_LLAMA_MCP_MAX_STEPS) || 16;
  const wHistory = normalizeLlamaChatHistory(options.history);
  const wFormatFollowUp = isRangeOnlyPrompt(options.prompt) && historyMentionsFormat(wHistory);
  /** @type {Array<Record<string, unknown>>} */
  const wMessages = [
    {
      role: 'system',
      content: buildLlamaAgentSystemPrompt(options.spreadsheetLang),
    },
    ...wHistory,
    {
      role: 'user',
      content: buildLlamaAgentUserPrompt(
        options.prompt,
        options.workbookPath,
        options.spreadsheetContext,
        wHistory
      ),
    },
  ];

  const wStartAgent = wStart;
  let wToolCalls = 0;
  let wActionRetryDone = false;
  let wUsedPasteGrid = false;
  let wPasteGridSucceeded = false;
  let wLastPasteResult = '';
  let wCompactHintDone = false;

  const finishIfListDumpPasted = (wStep, wJson) => {
    if (!wPasteGridSucceeded || !detectListDumpIntent(options.prompt)) {
      return null;
    }
    const wRange = extractPasteGridRangeFromToolResult(wLastPasteResult);
    return {
      provider: 'llama',
      llamaMcp: true,
      status: 'FINISHED',
      result: wRange ? `Liste collée en ${wRange}.` : 'Liste collée dans le classeur.',
      durationMs: Date.now() - wStartAgent,
      model: wJson?.model || getLlamaModelId(),
      toolCalls: wToolCalls,
      steps: wStep + 1,
    };
  };

  const runOneAgentTool = async (wName, wArgs) => {
    if (isListDumpPerCellWrite(options.prompt, wName)) {
      console.warn(`[ai/ask] llama MCP skipped ${wName} (list dump requires paste_grid)`);
      return 'Rejected: do not use write_cell for a list. Call ONE paste_grid with all remaining rows now.';
    }
    try {
      return await wExecutor.callTool(String(wName), wArgs);
    } catch (err) {
      return `Tool error (${wName}): ${err?.message || err}`;
    }
  };

  const notePasteGridOutcome = (wName, wToolResult) => {
    if (String(wName) !== 'paste_grid') {
      return;
    }
    wUsedPasteGrid = true;
    if (!String(wToolResult).startsWith('Tool error')) {
      wPasteGridSucceeded = true;
      wLastPasteResult = String(wToolResult);
    }
  };

  for (let wStep = 0; wStep < wMaxSteps; wStep++) {
    throwIfAborted(options.abortSignal);
    const wForceTool =
      wStep === 0 &&
      !detectMetaQuestion(options.prompt) &&
      (detectListDumpIntent(options.prompt) ||
        detectInvoiceIntent(options.prompt) ||
        detectSpreadsheetActionRequest(options.prompt) ||
        detectFormatColorIntent(options.prompt) ||
        wFormatFollowUp ||
        detectSelectionTargetIntent(options.prompt));
    const wToolMode =
      detectListDumpIntent(options.prompt) || detectInvoiceIntent(options.prompt) || detectTableCreationIntent(options.prompt)
        ? 'compact'
        : 'default';
    // Keep the full token budget for tool JSON — a 768 cap truncates names ("Auver", "Loir").
    const wStepMaxTokens = wMaxTokens;
    let wJson;
    try {
      wJson = await callLlamaChatCompletionsWithRetry(
        {
          model: getLlamaModelId(),
          messages: wMessages,
          tools: wExecutor.getOpenAiTools(wToolMode),
          tool_choice: wForceTool ? 'required' : 'auto',
          temperature: wTemperature,
          max_tokens: wStepMaxTokens,
          n_predict: wStepMaxTokens,
          stream: false,
        },
        wTimeout,
        (mode) => wExecutor.getOpenAiTools(mode),
        options.abortSignal
      );
    } catch (err) {
      if (isLlamaToolJsonError(err)) {
        const wErr = new Error(
          'llama-server n\'a pas pu parser le tool call JSON (réponse tronquée ou guillemets invalides). ' +
            'Réessayez une demande plus courte (ex. « Écris bonjour en B2 »). ' +
            `Détail: ${err?.message || err}`
        );
        wErr.statusCode = 502;
        throw wErr;
      }
      throw err;
    }

    const wMessage = wJson?.choices?.[0]?.message ?? {};
    wMessages.push(wMessage);

    const wToolCallsList = Array.isArray(wMessage.tool_calls) ? wMessage.tool_calls : [];
    if (wToolCallsList.length > 0) {
      for (const wTc of wToolCallsList) {
        throwIfAborted(options.abortSignal);
        const wName = wTc?.function?.name;
        let wArgs = {};
        try {
          wArgs = JSON.parse(wTc?.function?.arguments || '{}');
        } catch (parseErr) {
          console.warn('[ai/ask] tool arguments JSON parse failed:', parseErr?.message);
          wArgs = {};
        }
        wArgs = applySelectionContextToWriteToolArgs(
          String(wName),
          wArgs,
          options.spreadsheetContext,
          options.prompt
        );
        console.log(`[ai/ask] llama MCP tool ${wName}`, wArgs?.ref || wArgs?.range || '');
        const wToolResult = await runOneAgentTool(wName, wArgs);
        wToolCalls += 1;
        notePasteGridOutcome(wName, wToolResult);
        wMessages.push({
          role: 'tool',
          tool_call_id: wTc.id,
          content: wToolResult,
        });
      }
      const wListDone = finishIfListDumpPasted(wStep, wJson);
      if (wListDone) {
        console.log(`[ai/ask] llama MCP list dump done after paste_grid (${wToolCalls} tools)`);
        return wListDone;
      }
      if (
        !wCompactHintDone &&
        !wUsedPasteGrid &&
        wToolCalls >= 2 &&
        (detectInvoiceIntent(options.prompt) ||
          detectTableCreationIntent(options.prompt) ||
          detectListDumpIntent(options.prompt))
      ) {
        wCompactHintDone = true;
        console.warn('[ai/ask] llama MCP compact hint — forcing paste_grid');
        wMessages.push({
          role: 'user',
          content:
            'Stop write_cell / write_formatted_cell. Next tool MUST be ONE paste_grid with the full remaining layout and English formulas (=SUM, =B5*C5). Then at most apply_format and resize_columns.',
        });
      }
      continue;
    }

    const wEmbeddedTools = extractEmbeddedToolCallsFromContent(
      typeof wMessage.content === 'string' ? wMessage.content : ''
    );
    if (wEmbeddedTools.length > 0) {
      console.warn(
        `[ai/ask] llama returned ${wEmbeddedTools.length} tool(s) in text — executing recovered call(s)`
      );
      for (const wEmb of wEmbeddedTools) {
        throwIfAborted(options.abortSignal);
        const wEmbArgs = applySelectionContextToWriteToolArgs(
          wEmb.name,
          wEmb.args,
          options.spreadsheetContext,
          options.prompt
        );
        console.log(`[ai/ask] llama MCP tool ${wEmb.name} (recovered)`, wEmbArgs?.range || wEmbArgs?.ref || '');
        const wToolResult = await runOneAgentTool(wEmb.name, wEmbArgs);
        wToolCalls += 1;
        notePasteGridOutcome(wEmb.name, wToolResult);
        wMessages.push({
          role: 'user',
          content:
            `Tool ${wEmb.name} was executed server-side. Result:\n${wToolResult}\n` +
            'Summarize briefly in French what was done. Do not repeat JSON or markdown tables.',
        });
      }
      const wEmbListDone = finishIfListDumpPasted(wStep, wJson);
      if (wEmbListDone) {
        console.log(`[ai/ask] llama MCP list dump done after recovered paste_grid (${wToolCalls} tools)`);
        return wEmbListDone;
      }
      continue;
    }

    const wResult = typeof wMessage.content === 'string' ? wMessage.content : '';
    const wWantsAction =
      detectSpreadsheetActionRequest(options.prompt) ||
      detectListDumpIntent(options.prompt) ||
      detectSelectionTargetIntent(options.prompt);
    const wCapabilityOnly = detectMetaQuestion(options.prompt);
    if (
      !wActionRetryDone &&
      wWantsAction &&
      !wCapabilityOnly &&
      wToolCalls === 0 &&
      wEmbeddedTools.length === 0
    ) {
      wActionRetryDone = true;
      console.warn('[ai/ask] llama MCP answered with text instead of tools — retrying with tool_choice required');
      wMessages.push({
        role: 'user',
        content: wFormatFollowUp || detectFormatColorIntent(options.prompt)
          ? 'Exécute apply_format maintenant sur la plage (prompt ou sélection UI). Pas de read_range, pas de liste de cellules.'
          : 'Ne décris pas tes capacités — exécute la demande maintenant avec paste_grid (ou write_cell). Écris le contenu demandé, pas un autre modèle de tableau. Pas de read_range sauf si l\'utilisateur demande explicitement de lire.',
      });
      try {
        wJson = await callLlamaChatCompletionsWithRetry(
          {
            model: getLlamaModelId(),
            messages: wMessages,
            tools: wExecutor.getOpenAiTools(wToolMode),
            tool_choice: 'required',
            temperature: wTemperature,
            max_tokens: wMaxTokens,
            n_predict: wMaxTokens,
            stream: false,
          },
          wTimeout,
          (mode) => wExecutor.getOpenAiTools(mode),
          options.abortSignal
        );
      } catch (err) {
        if (isLlamaToolJsonError(err)) {
          const wErr = new Error(
            'llama-server n\'a pas pu parser le tool call JSON (réponse tronquée ou guillemets invalides). ' +
              'Réessayez une demande plus courte (ex. « Écris bonjour en B2 »). ' +
              `Détail: ${err?.message || err}`
          );
          wErr.statusCode = 502;
          throw wErr;
        }
        throw err;
      }
      const wRetryMessage = wJson?.choices?.[0]?.message ?? {};
      wMessages.push(wRetryMessage);
      const wRetryTools = Array.isArray(wRetryMessage.tool_calls) ? wRetryMessage.tool_calls : [];
      if (wRetryTools.length > 0) {
        for (const wTc of wRetryTools) {
          throwIfAborted(options.abortSignal);
          const wName = wTc?.function?.name;
          let wArgs = {};
          try {
            wArgs = JSON.parse(wTc?.function?.arguments || '{}');
          } catch (parseErr) {
            console.warn('[ai/ask] tool arguments JSON parse failed:', parseErr?.message);
            wArgs = {};
          }
          wArgs = applySelectionContextToWriteToolArgs(
            String(wName),
            wArgs,
            options.spreadsheetContext,
            options.prompt
          );
          console.log(`[ai/ask] llama MCP tool ${wName} (retry)`, wArgs?.ref || wArgs?.range || '');
          const wToolResult = await runOneAgentTool(wName, wArgs);
          wToolCalls += 1;
          notePasteGridOutcome(wName, wToolResult);
          wMessages.push({
            role: 'tool',
            tool_call_id: wTc.id,
            content: wToolResult,
          });
        }
        const wRetryListDone = finishIfListDumpPasted(wStep, wJson);
        if (wRetryListDone) {
          console.log(`[ai/ask] llama MCP list dump done after retry paste_grid (${wToolCalls} tools)`);
          return wRetryListDone;
        }
        continue;
      }
    }

    const wDurationMs = Date.now() - wStartAgent;
    console.log(
      `[ai/ask] llama MCP FINISHED (${wResult.length} chars, ${wToolCalls} tools, ${wDurationMs}ms)`
    );
    return {
      provider: 'llama',
      llamaMcp: true,
      status: 'FINISHED',
      result: wResult,
      durationMs: wDurationMs,
      model: wJson?.model || getLlamaModelId(),
      toolCalls: wToolCalls,
      steps: wStep + 1,
    };
  }

  return {
    provider: 'llama',
    llamaMcp: true,
    status: 'FINISHED',
    result: `Limite d'étapes MCP atteinte (${wMaxSteps}). ${wToolCalls} outil(s) exécuté(s).`,
    durationMs: Date.now() - wStartAgent,
    model: getLlamaModelId(),
    toolCalls: wToolCalls,
    steps: wMaxSteps,
  };
}

/**
 * @param {{
 *   prompt: string,
 *   workbookPath?: string,
 *   spreadsheetLang?: string,
 *   spreadsheetContext?: { workbookPath?: string, sheet?: string, selection?: string, cursorRef?: string },
 *   timeoutMs?: number,
 *   spreadsheetTools?: import('./SkeeptoTools.mjs').SkeeptoTools,
 *   userEmail?: string,
 * }} options
 */
export async function runLlamaAsk(options) {
  if (isLlamaMcpEnabled()) {
    return runLlamaAgentAsk(options);
  }

  const wCanned = buildLlamaCannedReply(options.prompt);
  if (wCanned) {
    console.log('[ai/ask] llama canned refusal (spreadsheet/MCP action or capability question)');
    return {
      provider: 'llama',
      status: 'FINISHED',
      result: wCanned,
      durationMs: 0,
      model: 'sker-canned',
      canned: true,
    };
  }

  const wReachable = await probeLlamaHealth();
  if (!wReachable) {
    const wErr = new Error(
      `llama-server is not reachable at ${getLlamaHealthUrl().replace(/\/health$/, '')}. ` +
        'Start it with launch.sh in your llama.cpp directory.'
    );
    wErr.statusCode = 503;
    throw wErr;
  }

  const wTimeout = options.timeoutMs ?? 120_000;
  const wTemperature = Number(process.env.SK_LLAMA_TEMPERATURE) || 0.1;
  const wMaxTokens = Number(process.env.SK_LLAMA_MAX_TOKENS) || 384;
  const wStart = Date.now();
  const wJson = await callLlamaChatCompletions(
    {
      model: getLlamaModelId(),
      messages: [
        {
          role: 'system',
          content: buildLlamaChatSystemPrompt(options.workbookPath, options.spreadsheetLang),
        },
        { role: 'user', content: options.prompt },
      ],
      temperature: wTemperature,
      max_tokens: wMaxTokens,
      stream: false,
    },
    wTimeout,
    options.abortSignal
  );

  const wResult = wJson?.choices?.[0]?.message?.content ?? '';
  const wDurationMs = Date.now() - wStart;
  console.log(`[ai/ask] llama chat FINISHED (${wResult.length} chars, ${wDurationMs}ms)`);

  return {
    provider: 'llama',
    llamaMcp: false,
    status: 'FINISHED',
    result: wResult,
    durationMs: wDurationMs,
    model: wJson?.model || getLlamaModelId(),
  };
}

/**
 * @returns {Promise<{ provider: string, configured: boolean, llamaMcp: boolean, llamaBaseUrl: string, llamaHealthUrl: string, llamaReachable: boolean, hints: string[] }>}
 */
export async function getLlamaProviderStatus() {
  const wHints = [];
  const wBase = getLlamaBaseUrl();
  const wReachable = await probeLlamaHealth();
  const wMcp = isLlamaMcpEnabled();

  if (wReachable) {
    if (wMcp) {
      wHints.push(
        'Mode llama + MCP local (port 8080) : édition classeur via outils génériques (paste_grid, write_cell, …) — sans Cursor ni tunnel. ' +
          'Modèle : Qwen3.5-35B-A3B (MoE 35B / 3B actifs) avec function calling.'
      );
    } else {
      wHints.push(
        'Mode llama chat (port 8080) : texte seulement. ' +
          'Pour coller un tableau / éditer le classeur : bash Node/Server/start-ai-llama-agent.sh'
      );
    }
  } else {
    wHints.push(
      'llama-server injoignable sur le port 8080. Lancez llama serve (Qwen3.5-35B-A3B), ' +
        'puis redémarrez SkServer.'
    );
  }

  return {
    provider: 'llama',
    configured: wReachable,
    llamaMcp: wMcp,
    llamaBaseUrl: wBase,
    llamaHealthUrl: getLlamaHealthUrl(),
    llamaReachable: wReachable,
    hints: wHints,
  };
}
