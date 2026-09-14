//=============================================================================
// SkeeptoTools.mjs — server-side spreadsheet tools (no HTTP loopback)
//=============================================================================

import dependenciesContainer from '../Depency/SkDepencyManager.mjs';
import {
  checkFilePermissions,
  pathScopeErrorForUser,
} from '../SkVirtualDisk/SkVirtualDiskPermissions.mjs';
import {
  ensureSpreadsheetWorkbookLoaded,
  runSpreadsheetCall,
  runSpreadsheetWriteJson,
  shouldPersistAfterCall,
} from '../SkSpreadSheet/SkSpCall.mjs';
import {
  fetchSpreadsheetFileRecord,
  resolveWorkbookContentString,
} from '../SkSpreadSheet/SkSpreadSheetContent.mjs';
import {
  buildReadWorkbookResponse,
  filterWorkbookDocument,
  parseWriteJsonWorkbook,
} from '../SkSpreadSheet/SkReadWorkbook.mjs';
import { normalizeSpreadsheetVirtualPath } from '../SkSpreadSheet/SkSpreadSheetPathUtils.mjs';
import { runWithAiDispatchContext, handleWasmPostMessage } from './SkAiMessageBus.mjs';
import { buildPasteDoEnvelope } from '../SkSpreadSheet/SkPasteRange.mjs';
import {
  buildPasteClipboardFromGrid,
  computePasteDestRange,
  normalizePasteGridRows,
  parseA1Range,
} from '../SkSpreadSheet/SkBuildPasteClipboard.mjs';
import { normalizeClipboardFormatCss, normalizeSkerCss } from '../SkSpreadSheet/SkSkerCss.mjs';
import {
  absoluteRefFromPasteCell,
  isEmptySpreadsheetValue,
  repairClipboardPayload,
} from '../SkSpreadSheet/SkRepairClipboard.mjs';
import {
  buildChangeSizeDoEnvelope,
  parseColumnSpec,
  parseRowSpec,
  skMillimetersToPixels,
} from '../SkSpreadSheet/SkResizeRange.mjs';
import { classifyPasteScalar, formatValueForWasmCall } from '../SkSpreadSheet/SkCellValueCoerce.mjs';
import { SKER_WIRE_LOCALE, normalizeSpreadsheetLang } from '../SkSpreadSheet/SkeeptoLocale.mjs';
import {
  normalizeMergeWasmParams,
  parseRefAndSheet,
  validateA1RangeRef,
} from './SkeeptoToolUtils.mjs';
import {
  buildApplyTablePatchJson,
  buildCreateTableJson,
  buildFilterPatchFromMcpFilter,
  findTableByName,
  nextTableName,
  parseRangeNamesFromJson,
  parseTablesFromRangeData,
  resolveTableSheetColumn,
  summarizeTableForMcp,
  unwrapWasmJsonPayload,
} from '../SkSpreadSheet/SkTableRangeData.mjs';

/** Workbook paths that already received SetLang(us) this server process. */
const wireLocaleAppliedPaths = new Set();

/** Default US date mask applied when a bare date value is written (renders 07-17-2026). */
const SK_DEFAULT_DATE_FORMAT_CSS = 'format-string:"mm-dd-yyyy";';

export class SkeeptoTools {
  /**
   * @param {{ fastify: object, userEmail: string, group: string, gridFSBucket?: object|null, spreadsheetLang?: string }} ctx
   */
  constructor(ctx) {
    this.m_Fastify = ctx.fastify;
    this.m_UserEmail = ctx.userEmail;
    this.m_Group = ctx.group;
    this.m_GridFSBucket = ctx.gridFSBucket ?? null;
    this.m_UiLocale = normalizeSpreadsheetLang(ctx.spreadsheetLang);
  }

  _spreadSheet() {
    const wSs = dependenciesContainer.resolve('SkSpreadSheet');
    if (!wSs) {
      throw new Error('SkSpreadSheet not available');
    }
    return wSs;
  }

  /**
   * Persist the workbook after an AI/MCP edit.
   *
   * Default is DEFERRED: we schedule the same debounced "poll" persist the
   * collaborative path already uses, so a burst of tool calls coalesces into a
   * single WriteJson after a short idle instead of a full serialization per op.
   * Data is still flushed on workbook unload (grace period) and by the debounce.
   * Set SK_AI_IMMEDIATE_PERSIST=1 to restore the legacy synchronous persist.
   * @param {string} wPath
   * @param {{ immediate?: boolean }} [options]
   * @returns {Promise<boolean>} true once a persist has run or been scheduled
   */
  async _persist(wPath, options = {}) {
    const wSs = this._spreadSheet();
    const wImmediate = options.immediate === true || process.env.SK_AI_IMMEDIATE_PERSIST === '1';
    if (wImmediate) {
      await wSs.persistWorkBook(wPath, this.m_UserEmail);
      return true;
    }
    wSs.schedulePersistWorkBook(wPath, this.m_UserEmail);
    return true;
  }

  _normalizePath(virtualPath) {
    return normalizeSpreadsheetVirtualPath(virtualPath);
  }

  async _ensureSpreadsheetLocale(wPath) {
    if (wireLocaleAppliedPaths.has(wPath)) {
      return;
    }
    await runSpreadsheetCall(this._spreadSheet(), wPath, 'SetLang', {
      lang: SKER_WIRE_LOCALE,
    });
    wireLocaleAppliedPaths.add(wPath);
  }

  async listFiles(directory = '') {
    let wPath = directory || '';
    if (wPath === '/') {
      wPath = '';
    }

    const wScopeError = pathScopeErrorForUser(wPath || '/', this.m_UserEmail, this.m_Group);
    if (wScopeError) {
      throw new Error(wScopeError);
    }

    const wCollection = this.m_Fastify.mongo.db.collection('Directory');
    const wFiles = await wCollection
      .find({
        path: { $regex: `^${wPath}($|/)` },
      })
      .toArray();

    const wAccessible = wFiles.filter((file) =>
      checkFilePermissions(file, this.m_UserEmail, this.m_Group, 'read')
    );

    return {
      message: 'success',
      currentPath: wPath,
      contents: wAccessible.map((file) => ({
        name: file.name,
        path: file.path,
        isDirectory: file.isDirectory,
        owner: file.owner,
        group: file.group,
      })),
    };
  }

  async ensureWorkbook(virtualPath) {
    const wPath = this._normalizePath(virtualPath);
    await ensureSpreadsheetWorkbookLoaded(
      this.m_Fastify,
      this._spreadSheet(),
      this.m_GridFSBucket,
      wPath,
      this.m_UserEmail,
      this.m_Group
    );
    await this._ensureSpreadsheetLocale(wPath);
    return { path: wPath, status: 'ready', wireLocale: SKER_WIRE_LOCALE, uiLocale: this.m_UiLocale };
  }

  async spreadsheetCall(virtualPath, fn, params = {}, options = {}) {
    const wPath = this._normalizePath(virtualPath);
    if (options.ensureLoad !== false) {
      await this.ensureWorkbook(wPath);
    }

    let wParams = params && typeof params === 'object' ? { ...params } : {};
    if (fn === 'Format' && typeof wParams.value === 'string') {
      wParams.value = normalizeSkerCss(wParams.value);
    }
    if (fn === 'Merge') {
      wParams = normalizeMergeWasmParams(wParams);
    }

    const wResult = await runWithAiDispatchContext(
      { onBehalfOf: this.m_UserEmail, workbookPath: wPath },
      () => runSpreadsheetCall(this._spreadSheet(), wPath, fn, wParams)
    );

    let wPersisted = false;
    if (shouldPersistAfterCall(fn, options.persistAfter)) {
      await this._persist(wPath);
      wPersisted = true;
    }

    return { path: wPath, fn, result: wResult, persisted: wPersisted };
  }

  async readCell(virtualPath, ref, sheet = '') {
    const wParsed = { ref, sheet };
    const wRes = await this.spreadsheetCall(
      virtualPath,
      'GetValue',
      { ref: wParsed.ref, sheet: wParsed.sheet },
      { persistAfter: false }
    );
    return wRes.result;
  }

  async writeCell(virtualPath, ref, value, sheet = '') {
    const wSheet = typeof sheet === 'string' ? sheet.trim() : '';
    if (wSheet) {
      await this.ensureSheetExists(virtualPath, wSheet);
    }
    if (classifyPasteScalar(value).kind === 'date') {
      return this._writeDateCell(virtualPath, ref, value, wSheet);
    }
    const wRes = await this.spreadsheetCall(virtualPath, 'Value', {
      ref,
      value: formatValueForWasmCall(value),
      sheet: wSheet,
    });
    return wRes;
  }

  /**
   * Write a REAL date cell (t:'da'), then apply the US mm-dd-yyyy mask.
   * Value() stores a US date string ("07/17/2026") as text (t:'s'), so we paste a
   * typed cp (like paste_grid) to force the date type, then format it.
   * @param {string} virtualPath
   * @param {string} ref
   * @param {string|number} value
   * @param {string} [sheet]
   */
  async _writeDateCell(virtualPath, ref, value, sheet = '') {
    const wPath = this._normalizePath(virtualPath);
    await this.ensureWorkbook(wPath);
    const wRange = computePasteDestRange(ref, 1, 1);
    const wClipboard = buildPasteClipboardFromGrid({ rows: [[value]] });

    const wResult = await runWithAiDispatchContext(
      { onBehalfOf: this.m_UserEmail, workbookPath: wPath },
      () => this._applyPasteCollabMessage(wPath, wRange, wClipboard, sheet)
    );
    if (wResult !== true && wResult !== 'true') {
      throw new Error(`write_cell date failed for ${wPath} ${ref}`);
    }

    await this.formatRange(wPath, wRange, SK_DEFAULT_DATE_FORMAT_CSS, sheet, {
      persistAfter: false,
    });
    await this._persist(wPath);

    return {
      path: wPath,
      fn: 'Paste',
      ref: wRange,
      sheet: sheet || null,
      result: wResult,
      type: 'da',
      dateFormatApplied: true,
      persisted: true,
    };
  }

  /**
   * Write many cells in one MCP round-trip (single persist at end).
   * @param {string} virtualPath
   * @param {Record<string, string|number>|Array<{ ref: string, value: string|number }>} cells
   * @param {string} [sheet]
   */
  async writeCells(virtualPath, cells, sheet = '') {
    const wPath = this._normalizePath(virtualPath);
    await this.ensureWorkbook(wPath);
    const wSheet = typeof sheet === 'string' ? sheet.trim() : '';
    if (wSheet) {
      await this.ensureSheetExists(wPath, wSheet);
    }

    const wEntries = Array.isArray(cells)
      ? cells.map((entry) => ({ ref: entry.ref, value: entry.value }))
      : Object.entries(cells).map(([ref, value]) => ({ ref, value }));

    if (wEntries.length === 0) {
      throw new Error('write_cells: no cells provided');
    }

    const wDateRefs = [];
    await runWithAiDispatchContext(
      { onBehalfOf: this.m_UserEmail, workbookPath: wPath },
      async () => {
        for (const { ref, value } of wEntries) {
          if (classifyPasteScalar(value).kind === 'date') {
            // Value() would store the date as text; paste a typed cp (t:'da') instead.
            wDateRefs.push(ref);
            const wClipboard = buildPasteClipboardFromGrid({ rows: [[value]] });
            await this._applyPasteCollabMessage(
              wPath,
              computePasteDestRange(ref, 1, 1),
              wClipboard,
              wSheet
            );
          } else {
            await runSpreadsheetCall(this._spreadSheet(), wPath, 'Value', {
              ref,
              value: formatValueForWasmCall(value),
              sheet: wSheet,
            });
          }
        }
        // Apply the US date mask so typed dates render as dates (07-17-2026).
        for (const wRef of wDateRefs) {
          await runSpreadsheetCall(this._spreadSheet(), wPath, 'Format', {
            ref: wRef,
            value: SK_DEFAULT_DATE_FORMAT_CSS,
            sheet: wSheet,
          });
        }
      }
    );

    await this._persist(wPath);

    return {
      path: wPath,
      sheet: wSheet || null,
      count: wEntries.length,
      persisted: true,
    };
  }

  /**
   * @param {unknown} raw
   * @returns {string[]}
   */
  _parseSheetNames(raw) {
    let wData = raw;
    if (typeof raw === 'string') {
      try {
        wData = JSON.parse(raw);
      } catch {
        return raw.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    if (wData && typeof wData === 'object' && !Array.isArray(wData) && Array.isArray(wData.list)) {
      wData = wData.list;
    }
    if (!Array.isArray(wData)) {
      return [];
    }
    return wData
      .map((item) => {
        if (typeof item === 'string') {
          return item.trim();
        }
        if (item && typeof item === 'object' && typeof item.name === 'string') {
          return item.name.trim();
        }
        return '';
      })
      .filter(Boolean);
  }

  /**
   * Create a workbook sheet tab if it does not exist (WASM AddSheet).
   * @param {string} virtualPath
   * @param {string} name
   * @param {string} [insertAfter] — existing sheet name to insert after (optional)
   */
  async createSheet(virtualPath, name, insertAfter = '') {
    const wPath = this._normalizePath(virtualPath);
    const wName = String(name || '').trim();
    if (!wName) {
      throw new Error('create_sheet: name is required');
    }
    await this.ensureWorkbook(wPath);
    const wExisting = this._parseSheetNames(await this.listSheets(wPath));
    if (wExisting.some((n) => n.toLowerCase() === wName.toLowerCase())) {
      return {
        path: wPath,
        name: wName,
        created: false,
        sheets: wExisting,
      };
    }
    const wLeft = typeof insertAfter === 'string' ? insertAfter.trim() : '';
    const wRes = await this.spreadsheetCall(
      wPath,
      'AddSheet',
      { name: wName, left: wLeft },
      { persistAfter: true }
    );
    if (wRes.result !== true && wRes.result !== 'true') {
      throw new Error(`create_sheet failed for "${wName}"`);
    }
    const wSheets = this._parseSheetNames(await this.listSheets(wPath));
    console.log(`[create_sheet] added "${wName}" to ${wPath}`);
    return {
      path: wPath,
      name: wName,
      created: true,
      insertAfter: wLeft || null,
      sheets: wSheets,
    };
  }

  /**
   * @param {string} virtualPath
   * @param {string} sheetName
   * @param {string} [insertAfter]
   */
  async ensureSheetExists(virtualPath, sheetName, insertAfter = '') {
    return this.createSheet(virtualPath, sheetName, insertAfter);
  }

  /**
   * Apply paste via collab Do/tUndoPaste (GetMessage + WebSocket dispatch).
   * Must run inside runWithAiDispatchContext so peers receive the same message.
   * @param {string} wPath
   * @param {string} range
   * @param {object|string} clipboard
   * @param {string} sheet
   * @returns {Promise<boolean>}
   */
  async _applyPasteCollabMessage(wPath, range, clipboard, sheet = '') {
    const wEnvelope = buildPasteDoEnvelope(wPath, range, sheet, clipboard);
    const wResult = await runSpreadsheetCall(this._spreadSheet(), wPath, 'GetMessage', {
      message: JSON.stringify(wEnvelope),
    });
    handleWasmPostMessage(JSON.stringify(wEnvelope));
    return wResult;
  }

  /**
   * @param {string} wPath
   * @param {string} [sheet]
   * @returns {Promise<string>}
   */
  async _resolveSheetName(wPath, sheet = '') {
    const wTrimmed = typeof sheet === 'string' ? sheet.trim() : '';
    if (wTrimmed) {
      return wTrimmed;
    }
    const wNames = this._parseSheetNames(await this.listSheets(wPath));
    if (wNames.length > 0) {
      return wNames[0];
    }
    throw new Error('Could not resolve active sheet name (pass sheet explicitly)');
  }

  /**
   * Apply column/row resize via collab Do/tUndoChangeSize (GetMessage + WebSocket).
   * @param {string} wPath
   * @param {{ isRow: boolean, begin: number, end: number, sizePixels: number, sheet: string }} spec
   */
  async _applyChangeSizeCollabMessage(wPath, spec) {
    const wEnvelope = buildChangeSizeDoEnvelope(wPath, spec);
    const wResult = await runSpreadsheetCall(this._spreadSheet(), wPath, 'GetMessage', {
      message: JSON.stringify(wEnvelope),
    });
    handleWasmPostMessage(JSON.stringify(wEnvelope));
    return wResult;
  }

  /**
   * Set column width(s) in pixels (collab message path).
   * @param {string} virtualPath
   * @param {string} columns — e.g. B or B:D
   * @param {number} widthPixels
   * @param {string} [sheet]
   */
  async resizeColumns(virtualPath, columns, widthPixels, sheet = '') {
    const wPath = this._normalizePath(virtualPath);
    await this.ensureWorkbook(wPath);

    const wWidth = Number(widthPixels);
    if (!Number.isFinite(wWidth) || wWidth < 0) {
      throw new Error(`resize_columns: invalid widthPixels ${widthPixels}`);
    }

    const wRange = parseColumnSpec(columns);
    const wSheet = await this._resolveSheetName(wPath, sheet);

    const wResult = await runWithAiDispatchContext(
      { onBehalfOf: this.m_UserEmail, workbookPath: wPath },
      () =>
        this._applyChangeSizeCollabMessage(wPath, {
          isRow: false,
          begin: wRange.begin,
          end: wRange.end,
          sizePixels: wWidth,
          sheet: wSheet,
        })
    );

    if (wResult !== true && wResult !== 'true') {
      throw new Error(`resize_columns failed for ${columns}`);
    }

    await this._persist(wPath);

    return {
      path: wPath,
      columns,
      begin: wRange.begin,
      end: wRange.end,
      widthPixels: wWidth,
      sheet: wSheet,
      result: wResult,
      persisted: true,
    };
  }

  /**
   * Set row height(s) in pixels (collab message path).
   * @param {string} virtualPath
   * @param {string} rows — e.g. 2 or 2:10
   * @param {number} heightPixels
   * @param {string} [sheet]
   */
  async resizeRows(virtualPath, rows, heightPixels, sheet = '') {
    const wPath = this._normalizePath(virtualPath);
    await this.ensureWorkbook(wPath);

    const wHeight = Number(heightPixels);
    if (!Number.isFinite(wHeight) || wHeight < 0) {
      throw new Error(`resize_rows: invalid heightPixels ${heightPixels}`);
    }

    const wRange = parseRowSpec(rows);
    const wSheet = await this._resolveSheetName(wPath, sheet);

    const wResult = await runWithAiDispatchContext(
      { onBehalfOf: this.m_UserEmail, workbookPath: wPath },
      () =>
        this._applyChangeSizeCollabMessage(wPath, {
          isRow: true,
          begin: wRange.begin,
          end: wRange.end,
          sizePixels: wHeight,
          sheet: wSheet,
        })
    );

    if (wResult !== true && wResult !== 'true') {
      throw new Error(`resize_rows failed for ${rows}`);
    }

    await this._persist(wPath);

    return {
      path: wPath,
      rows,
      begin: wRange.begin,
      end: wRange.end,
      heightPixels: wHeight,
      sheet: wSheet,
      result: wResult,
      persisted: true,
    };
  }

  /**
   * Read column width in pixels.
   * @param {string} virtualPath
   * @param {string} column — e.g. B
   * @param {string} [sheet]
   */
  async getColumnWidth(virtualPath, column, sheet = '') {
    const wPath = this._normalizePath(virtualPath);
    await this.ensureWorkbook(wPath);
    const wIndex = parseColumnSpec(column).begin;
    const wSheet = await this._resolveSheetName(wPath, sheet);
    const wMm = await runSpreadsheetCall(this._spreadSheet(), wPath, 'GetSizeCol', {
      index: wIndex,
      sheet: wSheet,
    });
    return {
      path: wPath,
      column,
      index: wIndex,
      sheet: wSheet,
      widthPixels: skMillimetersToPixels(Number(wMm)),
    };
  }

  /**
   * Read row height in pixels.
   * @param {string} virtualPath
   * @param {string|number} row — e.g. 2 (1-based)
   * @param {string} [sheet]
   */
  async getRowHeight(virtualPath, row, sheet = '') {
    const wPath = this._normalizePath(virtualPath);
    await this.ensureWorkbook(wPath);
    const wIndex = parseRowSpec(String(row)).begin;
    const wSheet = await this._resolveSheetName(wPath, sheet);
    const wMm = await runSpreadsheetCall(this._spreadSheet(), wPath, 'GetSizeRow', {
      index: wIndex,
      sheet: wSheet,
    });
    return {
      path: wPath,
      row: wIndex,
      index: wIndex,
      sheet: wSheet,
      heightPixels: skMillimetersToPixels(Number(wMm)),
    };
  }

  /**
   * Paste sker clipboard JSON (cp) into a destination range — values, formats, styles, formulas.
   * Uses collab GetMessage (tUndoPaste + cp), not SetClipboard/Paste.
   */
  async pasteRange(virtualPath, range, clipboard, sheet = '') {
    const wPath = this._normalizePath(virtualPath);
    await this.ensureWorkbook(wPath);

    let wClipboard = clipboard;
    if (typeof wClipboard === 'string') {
      wClipboard = JSON.parse(wClipboard);
    }
    const wRepair = repairClipboardPayload(wClipboard);
    wClipboard = normalizeClipboardFormatCss(wRepair.clipboard);

    const wResult = await runWithAiDispatchContext(
      { onBehalfOf: this.m_UserEmail, workbookPath: wPath },
      () => this._applyPasteCollabMessage(wPath, range, wClipboard, sheet)
    );

    if (wResult !== true && wResult !== 'true') {
      throw new Error(`paste_range failed for ${wPath} ${range}`);
    }

    const wFirstCell = wClipboard.cells?.[0];
    if (wFirstCell?.c) {
      const wCheckRef = absoluteRefFromPasteCell(range, wFirstCell.c);
      const wCheckValue = await runSpreadsheetCall(this._spreadSheet(), wPath, 'GetValue', {
        ref: wCheckRef,
        sheet,
      });
      const wExpectedText =
        typeof wFirstCell.si === 'number' && Array.isArray(wClipboard.si)
          ? wClipboard.si[wFirstCell.si]
          : wFirstCell.v != null
            ? String(wFirstCell.v)
            : null;
      if (isEmptySpreadsheetValue(wCheckValue)) {
        throw new Error(
          `paste_range produced empty cells at ${wCheckRef}. Use paste_grid or copy_range cp (each cell needs c:@0 + si/t/v).`
        );
      }
      if (
        wExpectedText != null &&
        !isEmptySpreadsheetValue(wCheckValue) &&
        String(wCheckValue) !== wExpectedText &&
        String(wCheckValue).replace(/,/g, '') !== String(wExpectedText).replace(/,/g, '')
      ) {
        // Spot-check mismatch is non-fatal; values may be formatted differently.
      }
    }

    await this._persist(wPath);

    return {
      path: wPath,
      range,
      sheet: sheet || null,
      result: wResult,
      repaired: wRepair.repaired,
      repairs: wRepair.repairs,
      persisted: true,
    };
  }

  /**
   * Copy a range and return native sker cp JSON from the WASM clipboard.
   */
  async copyRange(virtualPath, range, sheet = '') {
    const wPath = this._normalizePath(virtualPath);
    await this.ensureWorkbook(wPath);

    await runWithAiDispatchContext(
      { onBehalfOf: this.m_UserEmail, workbookPath: wPath },
      () =>
        runSpreadsheetCall(this._spreadSheet(), wPath, 'Copy', { ref: range, sheet })
    );

    const wCpText = await runSpreadsheetCall(this._spreadSheet(), wPath, 'GetClipboard', {});
    if (!wCpText || typeof wCpText !== 'string') {
      throw new Error('copy_range: empty clipboard');
    }
    return JSON.parse(wCpText);
  }

  /**
   * Duplicate a formatted block via Copy + collab paste message (same workbook).
   */
  async duplicateRange(virtualPath, sourceRange, destRange, sheet = '') {
    const wPath = this._normalizePath(virtualPath);
    await this.ensureWorkbook(wPath);

    const wRun = async () => {
      await runSpreadsheetCall(this._spreadSheet(), wPath, 'Copy', {
        ref: sourceRange,
        sheet,
      });
      const wCpText = await runSpreadsheetCall(this._spreadSheet(), wPath, 'GetClipboard', {});
      if (!wCpText || typeof wCpText !== 'string') {
        throw new Error('duplicate_range: empty clipboard after copy');
      }
      return this._applyPasteCollabMessage(wPath, destRange, JSON.parse(wCpText), sheet);
    };

    const wResult = await runWithAiDispatchContext(
      { onBehalfOf: this.m_UserEmail, workbookPath: wPath },
      wRun
    );

    if (wResult !== true && wResult !== 'true') {
      throw new Error(`duplicate_range failed ${sourceRange} → ${destRange}`);
    }

    await this._persist(wPath);

    return {
      path: wPath,
      sourceRange,
      destRange,
      sheet: sheet || null,
      result: wResult,
      persisted: true,
    };
  }

  /**
   * Write a 2D grid via Value (A1 refs) — avoids native cp @0 cell ids when no row styles.
   * @param {string} virtualPath
   * @param {string} range
   * @param {Array<Array<string|number>>} rows
   * @param {string} [sheet]
   */
  async pasteGridViaWriteCells(virtualPath, range, rows, sheet = '') {
    const wPath = this._normalizePath(virtualPath);
    await this.ensureWorkbook(wPath);
    const wSheet = typeof sheet === 'string' ? sheet.trim() : '';
    if (wSheet) {
      await this.ensureSheetExists(wPath, wSheet);
    }
    const wRect = parseA1Range(range.includes(':') ? range : `${range}:${range}`);
    const wNumToCol = (n) => {
      let s = '';
      let x = n;
      while (x > 0) {
        const r = (x - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        x = Math.floor((x - 1) / 26);
      }
      return s;
    };
    /** @type {Array<{ ref: string, value: string|number }>} */
    const wEntries = [];
    for (let wR = 0; wR < rows.length; wR++) {
      const wRow = rows[wR];
      if (!Array.isArray(wRow)) {
        continue;
      }
      for (let wC = 0; wC < wRow.length; wC++) {
        const wVal = wRow[wC];
        if (wVal == null || wVal === '') {
          continue;
        }
        wEntries.push({
          ref: `${wNumToCol(wRect.left + wC)}${wRect.top + wR}`,
          value: wVal,
        });
      }
    }
    if (wEntries.length === 0) {
      throw new Error('paste_grid: no cell values after normalization');
    }
    const wWrite = await this.writeCells(wPath, wEntries, wSheet);
    return {
      path: wPath,
      range,
      sheet: wSheet || null,
      method: 'write_cells',
      cellCount: wEntries.length,
      persisted: wWrite.persisted,
    };
  }

  /**
   * Apply paste_grid row styles via Format API (A1 ranges), not cp @ cell ids.
   * @param {string} virtualPath
   * @param {string} range
   * @param {number} rowCount
   * @param {number} colCount
   * @param {{ header?: string, dataOdd?: string, dataEven?: string, default?: string }} styles
   * @param {string} sheet
   */
  async _applyPasteGridStyles(virtualPath, range, rowCount, colCount, styles, sheet = '') {
    const wRect = parseA1Range(range);
    const wNumToCol = (n) => {
      let s = '';
      let x = n;
      while (x > 0) {
        const r = (x - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        x = Math.floor((x - 1) / 26);
      }
      return s;
    };
    const wLeftCol = wNumToCol(wRect.left);
    const wRightCol = wNumToCol(wRect.left + colCount - 1);
    const wPath = this._normalizePath(virtualPath);

    if (styles.header && rowCount > 0) {
      const wHeaderRange = `${wLeftCol}${wRect.top}:${wRightCol}${wRect.top}`;
      await this.formatRange(wPath, wHeaderRange, styles.header, sheet, { persistAfter: false });
    }
    if (styles.dataOdd && rowCount > 1) {
      for (let wR = 1; wR < rowCount; wR += 2) {
        const wRowRange = `${wLeftCol}${wRect.top + wR}:${wRightCol}${wRect.top + wR}`;
        await this.formatRange(wPath, wRowRange, styles.dataOdd, sheet, { persistAfter: false });
      }
    }
    if (styles.dataEven && rowCount > 2) {
      for (let wR = 2; wR < rowCount; wR += 2) {
        const wRowRange = `${wLeftCol}${wRect.top + wR}:${wRightCol}${wRect.top + wR}`;
        await this.formatRange(wPath, wRowRange, styles.dataEven, sheet, { persistAfter: false });
      }
    }
    if (styles.default) {
      await this.formatRange(wPath, range, styles.default, sheet, { persistAfter: false });
    }
    await this._persist(wPath);
  }

  /**
   * Build a native sker cp from a grid spec and paste it in ONE collab operation.
   * A single tUndoPaste message + a single WriteJson/persist, instead of one Value
   * dispatch per cell (previous write_cells path).
   * @param {{ rows: Array<Array<string|number>>, styles?: object }} grid
   */
  async pasteGrid(virtualPath, destRange, grid, sheet = '') {
    const wRows = normalizePasteGridRows(grid?.rows);
    if (!Array.isArray(wRows) || wRows.length === 0) {
      throw new Error('paste_grid: rows array is required');
    }
    const wColCount = Math.max(...wRows.map((r) => (Array.isArray(r) ? r.length : 0)));
    const wRange = computePasteDestRange(destRange, wRows.length, wColCount);
    const wStyles = grid?.styles;
    const wHasStyles =
      wStyles &&
      typeof wStyles === 'object' &&
      Object.values(wStyles).some((v) => typeof v === 'string' && v.trim() !== '');

    const wPath = this._normalizePath(virtualPath);
    await this.ensureWorkbook(wPath);
    const wSheet = typeof sheet === 'string' ? sheet.trim() : '';
    if (wSheet) {
      await this.ensureSheetExists(wPath, wSheet);
    }

    // Values, formulas and row styles are packed into one cp clipboard, then pasted
    // through the same collab path as paste_range (single native Paste).
    const wClipboard = buildPasteClipboardFromGrid({
      rows: wRows,
      styles: wHasStyles ? wStyles : undefined,
    });

    console.log(
      `[paste_grid] ${wRange} via native Paste (cp, ${wRows.length}x${wColCount}, ${wClipboard.cells.length} cells${wHasStyles ? ', styles in cp' : ''})`
    );

    const wResult = await runWithAiDispatchContext(
      { onBehalfOf: this.m_UserEmail, workbookPath: wPath },
      () => this._applyPasteCollabMessage(wPath, wRange, wClipboard, wSheet)
    );

    if (wResult !== true && wResult !== 'true') {
      throw new Error(`paste_grid failed for ${wPath} ${wRange}`);
    }

    await this._persist(wPath);

    return {
      path: wPath,
      range: wRange,
      sheet: wSheet || null,
      method: 'paste',
      cellCount: wClipboard.cells.length,
      styled: wHasStyles || false,
      persisted: true,
    };
  }

  async formatRange(virtualPath, range, css, sheet = '', options = {}) {
    const wCss = normalizeSkerCss(css);
    const wPersist =
      typeof options.persistAfter === 'boolean' ? options.persistAfter : true;
    const wRes = await this.spreadsheetCall(
      virtualPath,
      'Format',
      {
        ref: range,
        value: wCss,
        sheet,
      },
      { persistAfter: wPersist }
    );
    if (wRes.result !== true && wRes.result !== 'true') {
      throw new Error(`format_range failed for ${range} (check range and CSS syntax)`);
    }
    return {
      path: wRes.path,
      range,
      sheet: sheet || null,
      css: wCss,
      result: wRes.result,
      persisted: wRes.persisted,
    };
  }

  /**
   * Merge a rectangular A1 range (e.g. H11:J13).
   * @param {string} virtualPath
   * @param {string} range
   * @param {string} [sheet]
   */
  async mergeCells(virtualPath, range, sheet = '') {
    const wParsed = parseRefAndSheet(range, sheet);
    const wRef = validateA1RangeRef(wParsed.ref);
    if (!wRef.includes(':')) {
      throw new Error(`merge_cells requires a multi-cell range (e.g. H11:J13), got ${wRef}`);
    }
    const wRes = await this.spreadsheetCall(virtualPath, 'Merge', {
      ref: wRef,
      sheet: wParsed.sheet,
    });
    if (wRes.result !== true && wRes.result !== 'true') {
      throw new Error(`merge_cells failed for ${wRef}`);
    }
    return {
      path: wRes.path,
      range: wRef,
      sheet: wParsed.sheet || null,
      result: wRes.result,
      persisted: wRes.persisted,
    };
  }

  /**
   * @param {string} virtualPath
   * @param {Array<{ range: string, css: string }>} items
   * @param {string} [sheet]
   */
  async formatRanges(virtualPath, items, sheet = '') {
    const wPath = this._normalizePath(virtualPath);
    await this.ensureWorkbook(wPath);

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('format_ranges: items array is required');
    }

    const wApplied = [];
    for (const wItem of items) {
      const wRes = await this.formatRange(wPath, wItem.range, wItem.css, sheet, {
        persistAfter: false,
      });
      wApplied.push({ range: wItem.range, css: wRes.css });
    }

    await this._persist(wPath);

    return {
      path: wPath,
      sheet: sheet || null,
      count: wApplied.length,
      items: wApplied,
      persisted: true,
    };
  }

  async listSheets(virtualPath) {
    const wRes = await this.spreadsheetCall(virtualPath, 'SheetsList', {}, {
      persistAfter: false,
    });
    return wRes.result;
  }

  /**
   * Load persisted .sker JSON from Mongo/GridFS (no WASM WriteJson).
   * @param {string} virtualPath
   */
  async _readWorkbookJsonFromStorage(virtualPath) {
    const { fileRecord, error, statusCode } = await fetchSpreadsheetFileRecord(
      this.m_Fastify,
      virtualPath,
      this.m_UserEmail,
      this.m_Group
    );
    if (!fileRecord) {
      const wErr = new Error(error || 'File not found');
      wErr.statusCode = statusCode || 404;
      throw wErr;
    }
    const wContent = await resolveWorkbookContentString(
      this.m_Fastify,
      fileRecord,
      this.m_GridFSBucket
    );
    if (!wContent || wContent.trim() === '') {
      throw new Error(`Workbook content not found for ${virtualPath}`);
    }
    return parseWriteJsonWorkbook(wContent);
  }

  /**
   * Full workbook or single-sheet snapshot (.sker JSON via WASM WriteJson).
   * @param {string} virtualPath
   * @param {{ sheet?: string, includeInternalSheets?: boolean }} [options]
   */
  async readWorkbook(virtualPath, options = {}) {
    const wSheet =
      typeof options.sheet === 'string' ? options.sheet.trim() : '';
    const wPath = this._normalizePath(virtualPath);
    await ensureSpreadsheetWorkbookLoaded(
      this.m_Fastify,
      this._spreadSheet(),
      this.m_GridFSBucket,
      wPath,
      this.m_UserEmail,
      this.m_Group
    );

    let wDoc;
    let wSource = 'wasm';
    try {
      const wRaw = await runWithAiDispatchContext(
        { onBehalfOf: this.m_UserEmail, workbookPath: wPath },
        () => runSpreadsheetWriteJson(this._spreadSheet(), wPath)
      );
      wDoc = parseWriteJsonWorkbook(wRaw);
    } catch (writeJsonErr) {
      console.warn(
        'SkeeptoTools.readWorkbook: WriteJson failed, falling back to Mongo content:',
        writeJsonErr?.message || writeJsonErr
      );
      wDoc = await this._readWorkbookJsonFromStorage(wPath);
      wSource = 'storage';
    }

    const wFiltered = filterWorkbookDocument(wDoc, {
      sheet: wSheet,
      includeInternalSheets: options.includeInternalSheets === true,
    });

    return buildReadWorkbookResponse(wFiltered, {
      path: wPath,
      sheet: wSheet || null,
      scope: wSheet ? 'sheet' : 'workbook',
      source: wSource,
    });
  }

  /**
   * Load RangeData tables (Excel ListObject / autofilter) from WASM JsonRangeData.
   * @param {string} virtualPath
   * @param {string} [sheet]
   */
  async _loadRangeDataTables(virtualPath, sheet = '') {
    const wRes = await this.spreadsheetCall(virtualPath, 'JsonRangeData', {}, {
      persistAfter: false,
    });
    const wPayload = unwrapWasmJsonPayload(wRes.result);
    return parseTablesFromRangeData(wPayload, sheet);
  }

  /**
   * Workbook-wide occupied names (tables + named ranges). Table names are global — not per sheet.
   * @param {string} virtualPath
   */
  async _loadWorkbookOccupiedNames(virtualPath) {
    const wNames = new Set();
    for (const wFn of ['JsonRangeData', 'JsonRangeNamed']) {
      const wRes = await this.spreadsheetCall(virtualPath, wFn, {}, { persistAfter: false });
      const wPayload = unwrapWasmJsonPayload(wRes.result);
      for (const wName of parseRangeNamesFromJson(wPayload)) {
        wNames.add(wName);
      }
    }
    return [...wNames];
  }

  /**
   * @param {string} virtualPath
   * @param {string} [sheet]
   */
  async listTables(virtualPath, sheet = '') {
    const wPath = this._normalizePath(virtualPath);
    const wTables = await this._loadRangeDataTables(wPath, sheet);
    return {
      path: wPath,
      sheet: sheet || null,
      count: wTables.length,
      tables: wTables.map((t) => summarizeTableForMcp(t)),
    };
  }

  /**
   * Promote a rectangular range to a RangeData table (header row + autofilter).
   * @param {string} virtualPath
   * @param {string} range — e.g. A1:D20
   * @param {{ name?: string, sheet?: string, tableStyleName?: string }} [options]
   */
  async createTable(virtualPath, range, options = {}) {
    const wPath = this._normalizePath(virtualPath);
    const wRef = String(range || '').trim();
    const wBounds = parseA1Range(wRef);
    const wSheet = typeof options.sheet === 'string' ? options.sheet : '';

    const wHeight = wBounds.bottom - wBounds.top + 1;
    if (wHeight < 2) {
      throw new Error('create_table: range must include at least two rows (header + data)');
    }

    const wOccupiedNames = await this._loadWorkbookOccupiedNames(wPath);
    const wExplicitName =
      typeof options.name === 'string' && options.name.trim() !== ''
        ? options.name.trim()
        : '';
    const wName = wExplicitName || nextTableName(wOccupiedNames);

    if (wOccupiedNames.some((n) => n.toLowerCase() === wName.toLowerCase())) {
      const wSuggested = nextTableName(wOccupiedNames);
      throw new Error(
        `create_table: name "${wName}" already exists in this workbook (names are global, not per sheet). ` +
          `Omit name to auto-assign "${wSuggested}", or pick another name. ` +
          `Reusing a name deletes the existing table.`
      );
    }

    const wJson = buildCreateTableJson(
      wBounds.left,
      wBounds.right,
      options.tableStyleName
    );

    const wRes = await this.spreadsheetCall(
      wPath,
      'UndoAddRangeData',
      {
        name: wName,
        ref: wRef,
        jsonData: wJson,
        sheet: wSheet,
      },
      { persistAfter: true }
    );

    if (wRes.result !== true) {
      throw new Error(`create_table: UndoAddRangeData failed for "${wName}"`);
    }

    return {
      path: wPath,
      name: wName,
      ref: wRef,
      sheet: wSheet || null,
      style: options.tableStyleName || 'TableStyleMedium2',
      persisted: true,
    };
  }

  /**
   * Apply sort and/or filter on one table column (RangeData / UndoApplyRangeData).
   * @param {string} virtualPath
   * @param {string} tableName
   * @param {string|number} column — column letter (B) or 0-based offset within table
   * @param {{ sheet?: string, sort?: string, filter?: object }} [options]
   */
  async applyTableFilterSort(virtualPath, tableName, column, options = {}) {
    const wPath = this._normalizePath(virtualPath);
    const wSheet = typeof options.sheet === 'string' ? options.sheet : '';
    const wTables = await this._loadRangeDataTables(wPath, wSheet);
    const wTable = findTableByName(wTables, tableName, wSheet);
    if (!wTable) {
      throw new Error(`apply_table_filter_sort: table "${tableName}" not found`);
    }

    const wTargetSheetCol = resolveTableSheetColumn(wTable, column);
    const wPatch = {};

    if (options.sort != null) {
      const wSort = String(options.sort);
      if (!['None', 'Ascending', 'Descending'].includes(wSort)) {
        throw new Error(
          'apply_table_filter_sort: sort must be None, Ascending, or Descending'
        );
      }
      wPatch.sortOrder = wSort;
    }

    if (options.filter != null) {
      Object.assign(wPatch, buildFilterPatchFromMcpFilter(options.filter));
    }

    if (wPatch.sortOrder == null && wPatch.filterop == null) {
      throw new Error('apply_table_filter_sort: provide sort and/or filter');
    }

    const wJson = buildApplyTablePatchJson(
      wTable.data,
      wTable.range,
      wTargetSheetCol,
      wPatch
    );

    const wRes = await this.spreadsheetCall(
      wPath,
      'UndoApplyRangeData',
      {
        name: wTable.name,
        jsonData: wJson,
        sheet: wTable.sheet,
      },
      { persistAfter: true }
    );

    if (wRes.result !== true) {
      throw new Error(
        `apply_table_filter_sort: UndoApplyRangeData failed for "${tableName}"`
      );
    }

    return {
      path: wPath,
      table: tableName,
      sheet: wTable.sheet || null,
      column: wTargetSheetCol,
      sort: wPatch.sortOrder ?? null,
      filter: wPatch.filterop ?? null,
      persisted: true,
    };
  }

  async persistWorkbook(virtualPath) {
    const wPath = this._normalizePath(virtualPath);
    const wSs = this._spreadSheet();
    if (!wSs.isWorkBookLoadedInWasm(wPath)) {
      throw new Error(`Workbook not loaded in WASM: ${wPath}`);
    }
    await wSs.persistWorkBook(wPath, this.m_UserEmail);
    return { path: wPath, persisted: true };
  }
}
