//=============================================================================
// SkAiCursorProvider.mjs — Cursor Cloud Agents API v1
//=============================================================================

// Spreadsheet WASM init clears globalThis.fetch (see skWasmSingleton.mjs); capture early.
const httpFetch = globalThis.fetch;
if (typeof httpFetch !== 'function') {
  throw new Error('global fetch is not available at SkAiCursorProvider load time');
}

import { createHash } from 'node:crypto';
import { isReservedTrycloudflareUrl, probeTunnelUrl } from '../../IACursor/skTunnelProbe.mjs';
import { buildAgentCapabilitiesPromptLines } from './SkAiCapabilities.mjs';
import { buildSpreadsheetContextPromptLines } from './SkAiSpreadsheetContext.mjs';
import { buildAgentLocalePromptLines, normalizeSpreadsheetLang } from '../SkSpreadSheet/SkeeptoLocale.mjs';

const CURSOR_API_BASE = 'https://api.cursor.com';

/** @type {Map<string, { agentId: string, agentUrl?: string, at: number }>} */
const agentPool = new Map();
const AGENT_POOL_TTL_MS = 30 * 60 * 1000;

function sessionKeyFromJwt(jwt) {
  return createHash('sha256').update(jwt).digest('hex').slice(0, 16);
}

function getPooledAgent(key) {
  const entry = agentPool.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > AGENT_POOL_TTL_MS) {
    agentPool.delete(key);
    return null;
  }
  return entry;
}

function poolAgent(key, agentId, agentUrl) {
  agentPool.set(key, { agentId, agentUrl, at: Date.now() });
}

function buildMcpServers(mcpUrl, userJwt) {
  return [
    {
      name: 'sker',
      type: 'http',
      url: mcpUrl,
      headers: {
        Authorization: `Bearer ${userJwt}`,
      },
    },
  ];
}

/**
 * @returns {string|null}
 */
export function getMcpPublicBaseUrl() {
  const wUrl =
    process.env.SK_MCP_PUBLIC_URL ||
    process.env.SKER_PUBLIC_URL ||
    process.env.SKER_SERVER_URL ||
    '';
  const wTrimmed = wUrl.trim().replace(/\/$/, '');
  if (!wTrimmed || wTrimmed.includes('127.0.0.1') || wTrimmed.includes('localhost')) {
    return null;
  }
  // Error logs mention https://api.trycloudflare.com — that is not a tunnel.
  if (isReservedTrycloudflareUrl(wTrimmed)) {
    return null;
  }
  return wTrimmed;
}

/**
 * @returns {string}
 */
export function getCursorApiKey() {
  return (
    process.env.CURSOR_API_KEY ||
    process.env.SK_CURSOR_API_KEY ||
    ''
  ).trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function basicAuthHeader(apiKey) {
  return `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
}

function normalizeRunStatus(status) {
  return String(status || '').toUpperCase();
}

/**
 * Quick probe: Cursor cloud must reach SK_MCP_PUBLIC_URL (tunnel alive).
 * @param {string} publicBaseUrl
 */
export async function probeMcpPublicTunnel(publicBaseUrl) {
  const wResult = await probeTunnelUrl(publicBaseUrl);
  return wResult.ok;
}

/**
 * @param {string} userPrompt
 * @param {string|undefined} workbookPath
 * @param {string|undefined} spreadsheetLang
 * @param {{ workbookPath?: string, sheet?: string, selection?: string, cursorRef?: string }|null|undefined} [spreadsheetContext]
 */
export function buildAgentPromptText(userPrompt, workbookPath, spreadsheetLang, spreadsheetContext) {
  const wLang = normalizeSpreadsheetLang(spreadsheetLang);
  const wLines = [
    'You are a spreadsheet assistant for the sker application.',
    'You do NOT have access to the user\'s local filesystem or MongoDB directly.',
    'You DO read and edit workbooks via sker MCP tools on the virtual disk (same data as the open .sker file).',
    'Never tell the user you cannot read the workbook if you used read_workbook, read_cell, or read_range — cite MCP tool results.',
    ...buildAgentCapabilitiesPromptLines({ useExcelTables: true }),
    ...buildAgentLocalePromptLines(wLang),
    'General rules:',
    '- read_workbook to inspect fo/f.formats before editing.',
    'Efficiency (critical — minimize MCP round-trips):',
    '- NEW tabular data (any list, catalog, or document the user asked for): ONE paste_grid that ALREADY contains every requested value AND every total/subtotal formula (as "=…" strings) in the SAME call, THEN create_table on that exact range. You USE Excel tables by default.',
    '- Write the requested content — do not substitute an accounting, invoice, VAT, or balance-sheet template unless the user asked for it.',
    '- Totals/subtotals belong in the paste_grid rows on the FIRST pass (e.g. row "Total" → "=SUM(D5:D12)", "=D18-D27"). NEVER build the layout first and add formulas only after the user complains that they are missing.',
    '- Only tell the user formulas/values were added if THIS paste_grid/write_cells call actually contained them.',
    '- NEVER write header cells with write_cell then paste data — put everything in paste_grid rows.',
    '- LOOK: create_table + tableStyleName (TableStyleMedium2 default). Do NOT paint header/stripes with paste_grid styles or visual CSS when you create a table.',
    '- Always OK: number/display format-string (e.g. format-string:"#,##0.00"; currency, %, dates) on columns.',
    '- write_cells for bulk values only if paste_grid is impossible; never mix write_cell + paste_range for the same table.',
    '- MINIMIZE round-trips: every tool call persists (a full WriteJson). Group ALL styling into ONE format_ranges call (array of {range, css}) instead of many apply_format/format_range calls. Resize a whole span in ONE resize_columns (e.g. B:D) and ONE resize_rows (e.g. 2:45) — never one call per row/column.',
    'Paste / format rules:',
    '- paste_grid: values + formulas for any new tabular data. Then create_table — do not stop at a plain grid.',
    '- paste_grid formulas: put "=B14*C14" or "=SUM(D14:D20)" in grid cells (leading = required), from the FIRST pass. Server stores fi[] real formulas, not plain text.',
    '- paste_grid numbers: use JSON numbers (500, 1.5) not strings ("500"). Qty/price columns must be numeric.',
    '- paste_grid dates: ISO 2026-07-12 or US 07/12/2026 — stored as t:da, not text.',
    '- write_cell / write_cells: server coerces "500", "1 234,56", dates and =formulas automatically.',
    '- format_range / apply_format: format-string (number/date/currency display) OK on tables; colors/fonts/borders → prefer tableStyleName on create_table.',
    '- merge_cells: merge a rectangular range (e.g. H11:J13). Prefer over spreadsheet_call Merge.',
    '- duplicate_range: clone a formatted block (Copy+Paste native).',
    '- copy_range: returns native cp JSON — reuse with paste_range elsewhere.',
    '- paste_range: raw cp only if copied from copy_range. cp needs select:[{r:[top,left,bottom,right]}] and flat cells[{c:"@0",si:0},…] (sker native ids: @0 not Excel A0).',
    '- resize_columns / resize_rows: set width/height in pixels (e.g. columns B:D, widthPixels 140). Uses collab tUndoChangeSize.',
    '- get_column_width / get_row_height: read current column width or row height in pixels.',
    '- If paste_range fails or cells stay empty, switch to paste_grid — do not fall back to dozens of write_cell/format_range.',
    'Tables (RangeData — you USE these by default for every new data grid):',
    '- Table names are workbook-global (Table1 on sheet A blocks Table1 on sheet B). NEVER pass name unless the user explicitly requests it — omit name so the server picks Table2, Table3, …',
    '- Call list_tables before create_table when the workbook may already contain tables.',
    '- After paste_grid (header + data + formulas): create_table with EXACTLY the same A1 range as paste_grid (identical top-left and bottom-right).',
    '- Pass tableStyleName for look (TableStyleMedium2 default; Medium1–Medium28, Light1–Light21, Dark1–Dark11). Do NOT paint header/stripes with visual CSS.',
    '- Count rows: 1 header + N data rows. Example paste_grid H1:J42 → create_table H1:J42 — NOT H1:J41 (off-by-one excludes last data row from sort/filter).',
    '- list_tables before apply_table_filter_sort: verify ref covers every pasted row.',
    '- apply_table_filter_sort: column as letter (B) or 0-based offset; sort Ascending/Descending; filter { op, value } or { op: Equals, values: [...] }.',
    '- Do NOT claim global find/replace or chart tools — use tables for structured data analysis.',
    '- If Active workbook context is provided, skip open_workbook unless required.',
    '- Reply briefly in French when the user writes in French.',
    '- NEVER ask the user for language, locale, or date format — use the Locale block above and act immediately.',
  ];
  const wCtx = spreadsheetContext
    ? { ...spreadsheetContext, workbookPath: workbookPath || spreadsheetContext.workbookPath }
    : workbookPath
      ? { workbookPath }
      : null;
  const wCtxLines = buildSpreadsheetContextPromptLines(
    wCtx && (wCtx.workbookPath || wCtx.sheet || wCtx.selection || wCtx.cursorRef) ? wCtx : null
  );
  if (wCtxLines.length) {
    wLines.push('', ...wCtxLines);
  }
  wLines.push('', `User request: ${userPrompt}`);
  return wLines.join('\n');
}

function buildFollowUpPromptText(userPrompt, workbookPath, spreadsheetContext) {
  const wLines = [];
  const wCtx = spreadsheetContext
    ? { ...spreadsheetContext, workbookPath: workbookPath || spreadsheetContext.workbookPath }
    : workbookPath
      ? { workbookPath }
      : null;
  const wCtxLines = buildSpreadsheetContextPromptLines(
    wCtx && (wCtx.workbookPath || wCtx.sheet || wCtx.selection || wCtx.cursorRef) ? wCtx : null
  );
  if (wCtxLines.length) {
    wLines.push(...wCtxLines);
  } else if (workbookPath) {
    wLines.push(`Workbook: ${workbookPath}`);
  }
  wLines.push(
    'Reminder: for any new tabular data, paste_grid then create_table on the exact same range (Excel tables are the default).',
    userPrompt
  );
  return wLines.join('\n');
}

async function parseJsonResponse(res) {
  const wText = await res.text();
  try {
    return JSON.parse(wText);
  } catch {
    return { error: wText };
  }
}

async function pollRunUntilDone(apiKey, agentId, runId, timeoutMs) {
  const wPollMs = Number(process.env.SK_AI_POLL_MS) || 1000;
  const wPollStart = Date.now();
  const wDeadline = Date.now() + timeoutMs;

  const pollOnce = async () => {
    const wRunRes = await httpFetch(
      `${CURSOR_API_BASE}/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`,
      { headers: { Authorization: basicAuthHeader(apiKey) } }
    );
    return wRunRes.json();
  };

  while (Date.now() < wDeadline) {
    const wRun = await pollOnce();
    const wStatus = normalizeRunStatus(wRun?.status);

    if (wStatus === 'RUNNING' || wStatus === 'CREATING') {
      const wElapsed = Math.round((Date.now() - wPollStart) / 1000);
      if (wElapsed % 5 === 0 || wElapsed < 3) {
        console.log(`[ai/ask] run ${runId} status=${wStatus} (${wElapsed}s)`);
      }
    }

    if (wStatus === 'FINISHED') {
      const wText = wRun.result || wRun.text || '';
      const wTotalMs = Date.now() - wPollStart;
      console.log(`[ai/ask] run ${runId} FINISHED (${wText.length} chars, ${wTotalMs}ms)`);
      return {
        provider: 'cursor',
        agentId,
        runId,
        status: wStatus,
        result: wText,
        durationMs: wRun.durationMs ?? wTotalMs,
      };
    }

    if (wStatus === 'ERROR' || wStatus === 'CANCELLED' || wStatus === 'EXPIRED') {
      const wErr = new Error(
        `Cursor agent run ${wStatus}: ${wRun.result || wRun.text || 'no details'}`
      );
      wErr.statusCode = 502;
      wErr.run = wRun;
      throw wErr;
    }

    await sleep(wPollMs);
  }

  const wErr = new Error('Timeout waiting for Cursor agent run');
  wErr.statusCode = 504;
  wErr.agentId = agentId;
  wErr.runId = runId;
  throw wErr;
}

/**
 * @param {{
 *   prompt: string,
 *   workbookPath?: string,
 *   spreadsheetLang?: string,
 *   spreadsheetContext?: { workbookPath?: string, sheet?: string, selection?: string, cursorRef?: string },
 *   userJwt: string,
 *   timeoutMs?: number,
 * }} options
 */
export async function runCursorAgentAsk(options) {
  const wApiKey = getCursorApiKey();
  if (!wApiKey) {
    const wErr = new Error(
      'CURSOR_API_KEY is not configured on the server'
    );
    wErr.statusCode = 503;
    throw wErr;
  }

  const wMcpBase = getMcpPublicBaseUrl();
  if (!wMcpBase) {
    const wErr = new Error(
      'SK_MCP_PUBLIC_URL must be a public HTTPS URL reachable by Cursor cloud ' +
        '(localhost is not supported). Use ngrok for local tests.'
    );
    wErr.statusCode = 503;
    throw wErr;
  }

  const wMcpUrl = `${wMcpBase}/mcp`;
  const wModelId = process.env.CURSOR_MODEL_ID || process.env.SK_CURSOR_MODEL_ID || '';
  const wMcpServers = buildMcpServers(wMcpUrl, options.userJwt);
  const wSessionKey = sessionKeyFromJwt(options.userJwt);
  const wReuse = process.env.SK_AI_REUSE_AGENT !== '0';
  const wPooled = wReuse ? getPooledAgent(wSessionKey) : null;
  const wTimeout = options.timeoutMs ?? 300_000;

  let wAgentId;
  let wRunId;
  let wAgentUrl;

  if (wPooled) {
    const wFollowBody = {
      prompt: {
        text: buildFollowUpPromptText(
          options.prompt,
          options.workbookPath,
          options.spreadsheetContext
        ),
      },
      mcpServers: wMcpServers,
    };
    const wFollowRes = await httpFetch(
      `${CURSOR_API_BASE}/v1/agents/${encodeURIComponent(wPooled.agentId)}/runs`,
      {
        method: 'POST',
        headers: {
          Authorization: basicAuthHeader(wApiKey),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(wFollowBody),
      }
    );
    const wFollowJson = await parseJsonResponse(wFollowRes);
    if (wFollowRes.ok && wFollowJson?.run?.id) {
      wAgentId = wPooled.agentId;
      wRunId = wFollowJson.run.id;
      wAgentUrl = wPooled.agentUrl;
      console.log(`[ai/ask] Reusing agent ${wAgentId} — follow-up run ${wRunId}`);
    } else {
      console.log(
        `[ai/ask] Follow-up failed (${wFollowRes.status}), creating new agent…`
      );
      agentPool.delete(wSessionKey);
    }
  }

  if (!wAgentId || !wRunId) {
    const wBody = {
      prompt: {
        text: buildAgentPromptText(
          options.prompt,
          options.workbookPath,
          options.spreadsheetLang,
          options.spreadsheetContext
        ),
      },
      mcpServers: wMcpServers,
    };
    if (wModelId) {
      wBody.model = { id: wModelId };
    }

    const wCreateRes = await httpFetch(`${CURSOR_API_BASE}/v1/agents`, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(wApiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(wBody),
    });

    const wCreateJson = await parseJsonResponse(wCreateRes);
    if (!wCreateRes.ok) {
      const wErr = new Error(
        wCreateJson?.message || wCreateJson?.error || `Cursor API HTTP ${wCreateRes.status}`
      );
      wErr.statusCode = wCreateRes.status >= 500 ? 502 : wCreateRes.status;
      wErr.details = wCreateJson;
      throw wErr;
    }

    wAgentId = wCreateJson?.agent?.id;
    wRunId = wCreateJson?.run?.id;
    wAgentUrl = wCreateJson?.agent?.url;
    if (!wAgentId || !wRunId) {
      throw new Error('Cursor API did not return agent/run ids');
    }
    poolAgent(wSessionKey, wAgentId, wAgentUrl);
    console.log(`[ai/ask] New agent ${wAgentId} run ${wRunId} — polling…`);
  }

  const wResult = await pollRunUntilDone(wApiKey, wAgentId, wRunId, wTimeout);
  return { ...wResult, agentUrl: wAgentUrl };
}

/**
 * @returns {{ provider: string, configured: boolean, mcpPublicUrl: string|null, hints: string[] }}
 */
export function getAiProviderStatus() {
  const wHints = [];
  const wHasKey = Boolean(getCursorApiKey());
  const wMcpPublic = getMcpPublicBaseUrl();

  if (!wHasKey) {
    wHints.push('Set CURSOR_API_KEY on the server.');
  }
  if (!wMcpPublic) {
    wHints.push(
      'Set SK_MCP_PUBLIC_URL to a public HTTPS URL (ngrok on Mac, domain on Linux).'
    );
  }

  return {
    provider: process.env.SK_AI_PROVIDER || 'cursor',
    configured: wHasKey && Boolean(wMcpPublic),
    cursorApiKeySet: wHasKey,
    mcpPublicUrl: wMcpPublic ? `${wMcpPublic}/mcp` : null,
    hints: wHints,
  };
}
