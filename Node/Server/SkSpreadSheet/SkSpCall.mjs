//=============================================================================
// SkSpCall.mjs — programmatic WASM Call() for MCP / automation
//=============================================================================

import {
  fetchSpreadsheetFileRecord,
  resolveWorkbookContentString,
} from './SkSpreadSheetContent.mjs';
import { recoverWriteJsonCallEnvelope } from './SkReadWorkbook.mjs';
import { normalizeSkerCss } from './SkSkerCss.mjs';
import { normalizeMergeWasmParams } from '../SkAI/SkeeptoToolUtils.mjs';

/** WASM Call() names allowed through POST /spreadsheet/call */
export const SPREADSHEET_CALL_ALLOWLIST = new Set([
  'Value',
  'GetValue',
  'GetInputValue',
  'GetFormula',
  'RecalculateAll',
  'SheetsList',
  'SetActiveSheet',
  'Base10toAlpha',
  'InsertRow',
  'InsertCol',
  'DeleteRow',
  'DeleteCol',
  'Format',
  'Merge',
  'Copy',
  'Cut',
  'Paste',
  'Move',
  'JsonView',
  'GetMessage',
  'GetClipboard',
  'SetClipboard',
  'SizeCol',
  'SizeRow',
  'GetSizeCol',
  'GetSizeRow',
  'SetLang',
  'JsonRangeData',
  'JsonRangeNamed',
  'UndoAddRangeData',
  'UndoApplyRangeData',
]);

const PERSIST_AFTER_CALL = new Set([
  'Value',
  'InsertRow',
  'InsertCol',
  'DeleteRow',
  'DeleteCol',
  'Format',
  'Merge',
  'Paste',
  'Move',
  'Cut',
  'SizeCol',
  'SizeRow',
  'AddSheet',
  'DeleteSheet',
  'RenameSheet',
  'UndoAddRangeData',
  'UndoApplyRangeData',
]);

/**
 * Load workbook into server WASM pool when not already present.
 * @param {object} fastify
 * @param {import('./SkSpSpreadSheet.mjs').SkSpSpreadSheet} wSpreadSheet
 * @param {import('mongodb').GridFSBucket|null} gridFSBucket
 * @param {string} virtualPath
 * @param {string} userEmail
 * @param {string} group
 * @returns {Promise<string>} normalized virtual path
 */
export async function ensureSpreadsheetWorkbookLoaded(
  fastify,
  wSpreadSheet,
  gridFSBucket,
  virtualPath,
  userEmail,
  group
) {
  const wPath = wSpreadSheet.normalizeWorkBookPath(virtualPath);
  if (!wPath) {
    throw new Error('Invalid workbook path');
  }

  if (wSpreadSheet.isWorkBookLoadedInWasm(wPath)) {
    if (userEmail) {
      wSpreadSheet.addUserWorkBook(userEmail, wPath);
    }
    return wPath;
  }

  const { fileRecord, error, statusCode } = await fetchSpreadsheetFileRecord(
    fastify,
    wPath,
    userEmail,
    group
  );

  if (!fileRecord) {
    const wErr = new Error(error || 'File not found');
    wErr.statusCode = statusCode || 404;
    throw wErr;
  }

  const wContent = await resolveWorkbookContentString(fastify, fileRecord, gridFSBucket);
  if (!wContent) {
    const wErr = new Error('Workbook content not found');
    wErr.statusCode = 404;
    throw wErr;
  }

  await wSpreadSheet.loadWorkBook(wPath, wContent);
  if (userEmail) {
    wSpreadSheet.addUserWorkBook(userEmail, wPath);
  }
  return wPath;
}

/**
 * Invoke tUISpreadSheet.Call on the active workbook instance.
 * @param {object} uISpreadSheet
 * @param {string} workbookPath
 * @param {string} fn
 * @param {object} params
 */
export function executeWasmCall(uISpreadSheet, workbookPath, fn, params) {
  const wActive = uISpreadSheet.SetActiveWorkBook(workbookPath);
  if (!wActive) {
    throw new Error(`SetActiveWorkBook failed for ${workbookPath}`);
  }

  let wParams = params && typeof params === 'object' ? { ...params } : {};
  if (fn === 'Format' && typeof wParams.value === 'string') {
    wParams.value = normalizeSkerCss(wParams.value);
  }
  if (fn === 'Merge') {
    wParams = normalizeMergeWasmParams(wParams);
  }

  const wResultString = uISpreadSheet.Call(fn, JSON.stringify(wParams ?? {}));
  if (!wResultString || typeof wResultString !== 'string') {
    throw new Error(`Call(${fn}) returned empty result`);
  }

  let wParsed;
  try {
    wParsed = JSON.parse(wResultString);
  } catch (parseError) {
    if (fn === 'WriteJson') {
      wParsed = recoverWriteJsonCallEnvelope(wResultString);
      if (!wParsed) {
        throw new Error(`Call(${fn}) returned invalid JSON: ${parseError.message}`);
      }
    } else if (fn === 'SetLang') {
      // Legacy WASM: JsonStringResult("{\"result\":true}") produced malformed JSON; _SetLang still ran.
      return true;
    } else {
      throw new Error(`Call(${fn}) returned invalid JSON: ${parseError.message}`);
    }
  }

  if (wParsed?.error != null && wParsed.error !== '') {
    throw new Error(String(wParsed.error));
  }

  return wParsed?.result;
}

/**
 * Raw workbook JSON via WASM WriteJson() binding (bypasses Call() envelope).
 * @param {object} uISpreadSheet
 * @param {string} workbookPath
 * @returns {string}
 */
export function executeWasmWriteJson(uISpreadSheet, workbookPath) {
  const wActive = uISpreadSheet.SetActiveWorkBook(workbookPath);
  if (!wActive) {
    throw new Error(`SetActiveWorkBook failed for ${workbookPath}`);
  }
  const wJson = uISpreadSheet.WriteJson(workbookPath);
  if (!wJson || typeof wJson !== 'string' || wJson.trim() === '') {
    throw new Error(`WriteJson returned empty for ${workbookPath}`);
  }
  return wJson;
}

/**
 * @param {import('./SkSpSpreadSheet.mjs').SkSpSpreadSheet} wSpreadSheet
 * @param {string} workbookPath
 * @returns {Promise<string>}
 */
export async function runSpreadsheetWriteJson(wSpreadSheet, workbookPath) {
  return wSpreadSheet.executeTaskForWorkBook(workbookPath, (uISpreadSheet) =>
    executeWasmWriteJson(uISpreadSheet, workbookPath)
  );
}

/**
 * Run Call() on the workbook-bound WASM instance.
 * @param {import('./SkSpSpreadSheet.mjs').SkSpSpreadSheet} wSpreadSheet
 * @param {string} workbookPath
 * @param {string} fn
 * @param {object} params
 */
export async function runSpreadsheetCall(wSpreadSheet, workbookPath, fn, params) {
  return wSpreadSheet.executeTaskForWorkBook(workbookPath, (uISpreadSheet) =>
    executeWasmCall(uISpreadSheet, workbookPath, fn, params)
  );
}

/**
 * @param {string} fn
 * @param {boolean|undefined} explicitPersist
 */
export function shouldPersistAfterCall(fn, explicitPersist) {
  if (typeof explicitPersist === 'boolean') {
    return explicitPersist;
  }
  return PERSIST_AFTER_CALL.has(fn);
}
