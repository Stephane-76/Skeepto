//=============================================================================
// SkSpAiSpreadsheetContext.js — active workbook / sheet / selection for AI /ai/ask
//=============================================================================

import { getActiveFilePath, getSpreadsheetSession } from '../SkActiveFile.js';

const PLACEHOLDER_REF = 'Ref';
const PLACEHOLDER_SELECTION = 'Selection';
const CELL_REF_PATTERN = /^[A-Z]{1,4}\d{1,7}$/i;
const CELL_RANGE_START_PATTERN = /^([A-Z]{1,4}\d{1,7}):/i;
const AI_CURSOR_REF_KEY = 'sker:aiCursorRef';
const AI_SELECTION_KEY = 'sker:aiSelection';
const AI_SHEET_KEY = 'sker:aiSheet';

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
 * @param {string} text
 * @returns {string}
 */
function normalizeCellRef(text) {
  const wCore = stripSheetPrefix(text);
  const wMatch = wCore.match(/^([A-Z]{1,4})(\d{1,7})$/i);
  if (!wMatch) {
    return wCore.toUpperCase();
  }
  return `${wMatch[1].toUpperCase()}${wMatch[2]}`;
}

/**
 * @param {string} text
 * @returns {string}
 */
function parsePrimaryCellRef(text) {
  const wRaw = String(text || '').trim();
  if (!wRaw || wRaw === PLACEHOLDER_REF || wRaw === PLACEHOLDER_SELECTION) {
    return '';
  }
  const wFirst = stripSheetPrefix(wRaw.split(';')[0].trim());
  if (CELL_REF_PATTERN.test(wFirst)) {
    return normalizeCellRef(wFirst);
  }
  const wRangeMatch = wFirst.match(CELL_RANGE_START_PATTERN);
  if (wRangeMatch) {
    return normalizeCellRef(wRangeMatch[1]);
  }
  return '';
}

/**
 * @param {import('./SkSpInterface.js').default|null|undefined} spInterface
 * @returns {{ ref: string, selection: string }}
 */
function readControlPanelContext(spInterface) {
  const wPanel = spInterface?.m_SkSpControlPanel;
  if (!wPanel?.state) {
    return { ref: '', selection: '' };
  }
  const wRefRaw = wPanel.state.ref;
  const wRefText =
    wRefRaw instanceof Promise ? '' : String(wRefRaw || '').trim();
  const wRef = parsePrimaryCellRef(wRefText);
  const wSelectionRaw = String(wPanel.state.selection || '').trim();
  const wSelection =
    wSelectionRaw && wSelectionRaw !== PLACEHOLDER_SELECTION ? wSelectionRaw : '';
  return { ref: wRef, selection: wSelection };
}

/**
 * @returns {{ cursorRef: string, selection: string, sheet: string }}
 */
function readSessionSpreadsheetContext() {
  try {
    return {
      cursorRef: parsePrimaryCellRef(sessionStorage.getItem(AI_CURSOR_REF_KEY) || ''),
      selection: String(sessionStorage.getItem(AI_SELECTION_KEY) || '').trim(),
      sheet: String(sessionStorage.getItem(AI_SHEET_KEY) || '').trim(),
    };
  } catch {
    return { cursorRef: '', selection: '', sheet: '' };
  }
}

/**
 * Read formula bar ref/selection from the live DOM (last-resort fallback).
 * @returns {{ ref: string, selection: string }}
 */
function readDomSpreadsheetContext() {
  if (typeof document === 'undefined') {
    return { ref: '', selection: '' };
  }
  const wRefEl = document.querySelector('#ref.SkSpControlPanel-ref, .SkSpControlPanel-ref');
  const wSelEl = document.querySelector('#selection.SkSpControlPanel-selection, .SkSpControlPanel-selection');
  const wRef = wRefEl ? parsePrimaryCellRef(wRefEl.textContent || '') : '';
  const wSelectionRaw = wSelEl ? String(wSelEl.textContent || '').trim() : '';
  const wSelection =
    wSelectionRaw && wSelectionRaw !== PLACEHOLDER_SELECTION ? wSelectionRaw : '';
  return { ref: wRef, selection: wSelection };
}

/**
 * Cache last known cursor/selection for AI requests (survives panel focus changes).
 * @param {import('./SkSpInterface.js').default|null|undefined} spInterface
 */
export function persistSpreadsheetContextForAi(spInterface) {
  if (!spInterface) {
    return;
  }
  try {
    let wRef = '';
    let wSelection = '';
    if (spInterface.m_Select && typeof spInterface.m_Select.cursorStr === 'function') {
      wRef = parsePrimaryCellRef(spInterface.m_Select.cursorStr());
    }
    if (typeof spInterface.selectstr === 'function') {
      wSelection = String(spInterface.selectstr() || '').trim();
    }
    const wPanelCtx = readControlPanelContext(spInterface);
    if (!wRef && wPanelCtx.ref) {
      wRef = wPanelCtx.ref;
    }
    if (!wSelection && wPanelCtx.selection) {
      wSelection = wPanelCtx.selection;
    }
    if (wRef) {
      sessionStorage.setItem(AI_CURSOR_REF_KEY, wRef);
    }
    if (wSelection) {
      sessionStorage.setItem(AI_SELECTION_KEY, wSelection);
    }
    const wSheet = String(spInterface.m_UIView?.sheet || '').trim();
    if (wSheet) {
      sessionStorage.setItem(AI_SHEET_KEY, wSheet);
    }
  } catch {
    /* ignore storage / WASM errors */
  }
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
 * @param {import('./SkSpInterface.js').default|null|undefined} spInterface
 * @returns {{ workbookPath: string, sheet: string, selection: string, cursorRef: string }}
 */
export function getSpreadsheetContextForAi(spInterface) {
  const wWorkbookPath =
    getActiveFilePath() ||
    getSpreadsheetSession()?.path ||
    '';

  let wSheet = '';
  let wSelection = '';
  let wCursorRef = '';

  if (spInterface) {
    try {
      wSheet = String(spInterface.m_UIView?.sheet || '').trim();
    } catch {
      wSheet = '';
    }

    if (spInterface.m_Select) {
      try {
        if (typeof spInterface.m_Select.cursorStr === 'function') {
          wCursorRef = parsePrimaryCellRef(spInterface.m_Select.cursorStr());
        }
        if (typeof spInterface.m_Select.str === 'function') {
          wSelection = String(spInterface.m_Select.str() || '').trim();
        }
      } catch {
        // fall through to other sources
      }
    }

    try {
      if (!wSelection && typeof spInterface.selectstr === 'function') {
        wSelection = String(spInterface.selectstr() || '').trim();
      }
    } catch {
      wSelection = '';
    }

    try {
      if (!wCursorRef && typeof spInterface.editCellRef === 'function') {
        wCursorRef = parsePrimaryCellRef(spInterface.editCellRef());
      }
    } catch {
      wCursorRef = '';
    }

    const wPanelCtx = readControlPanelContext(spInterface);
    if (!wCursorRef && wPanelCtx.ref) {
      wCursorRef = wPanelCtx.ref;
    }
    if (!wSelection && wPanelCtx.selection) {
      wSelection = wPanelCtx.selection;
    }

    if (!wCursorRef && wSelection) {
      wCursorRef = parsePrimaryCellRef(wSelection);
    }
  }

  const wSessionCtx = readSessionSpreadsheetContext();
  if (!wSheet && wSessionCtx.sheet) {
    wSheet = wSessionCtx.sheet;
  }
  if (!wSelection && wSessionCtx.selection) {
    wSelection = wSessionCtx.selection;
  }
  if (!wCursorRef && wSessionCtx.cursorRef) {
    wCursorRef = wSessionCtx.cursorRef;
  }

  const wDomCtx = readDomSpreadsheetContext();
  if (!wCursorRef && wDomCtx.ref) {
    wCursorRef = wDomCtx.ref;
  }
  if (!wSelection && wDomCtx.selection) {
    wSelection = wDomCtx.selection;
  }
  if (!wCursorRef && wSelection) {
    wCursorRef = parsePrimaryCellRef(wSelection);
  }

  return {
    workbookPath: wWorkbookPath,
    sheet: wSheet,
    selection: wSelection,
    cursorRef: wCursorRef,
  };
}
