/**
 * Application-wide active file path (virtual disk selection or open workbook).
 * Subscribe via subscribe() or the sk-active-file-change window event.
 */

import { SkVirtualDiskClient } from './SkVirtualDiskClient.js';

export const SK_ACTIVE_FILE_EVENT = 'sk-active-file-change';
const SPREADSHEET_SESSION_KEY = 'SkeeptoFile';
const LEGACY_SPREADSHEET_SESSION_KEY = 'SkSpreadsheetFile';
const TEXT_DOCUMENT_SESSION_KEY = 'SkTextDocumentFile';

function readSpreadsheetSessionRaw() {
  try {
    const current = sessionStorage.getItem(SPREADSHEET_SESSION_KEY);
    if (current) {
      return current;
    }
    const legacy = sessionStorage.getItem(LEGACY_SPREADSHEET_SESSION_KEY);
    if (!legacy) {
      return null;
    }
    sessionStorage.setItem(SPREADSHEET_SESSION_KEY, legacy);
    sessionStorage.removeItem(LEGACY_SPREADSHEET_SESSION_KEY);
    return legacy;
  } catch (e) {
    return null;
  }
}

export function clearSpreadsheetSession() {
  try {
    sessionStorage.removeItem(SPREADSHEET_SESSION_KEY);
    sessionStorage.removeItem(LEGACY_SPREADSHEET_SESSION_KEY);
  } catch (e) {
    console.warn('clearSpreadsheetSession failed:', e);
  }
}

let activePath = '';
let activeMeta = null;
const listeners = new Set();

function notify() {
  const detail = { path: activePath, meta: activeMeta };
  listeners.forEach((fn) => {
    try {
      fn(detail);
    } catch (e) {
      console.warn('SkActiveFile listener error:', e);
    }
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SK_ACTIVE_FILE_EVENT, { detail }));
  }
}

/** Current virtual path shown in the top bar (e.g. /New folder/Monetary.sker). */
export function getActiveFilePath() {
  return activePath;
}

export function getActiveFile() {
  return activeMeta ? { ...activeMeta } : null;
}

/** Open workbook metadata from session (path, name, canWrite, …). */
export function getSpreadsheetSession() {
  try {
    const raw = readSpreadsheetSessionRaw();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('getSpreadsheetSession failed:', e);
    return null;
  }
}

/** Open HTML editor metadata from session (path, name, canWrite, …). */
export function getTextDocumentSession() {
  try {
    const raw = sessionStorage.getItem(TEXT_DOCUMENT_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('getTextDocumentSession failed:', e);
    return null;
  }
}

/** True when a .sker workbook session exists (opened from Virtual disk). */
export function isSpreadsheetLoaded() {
  return Boolean(getSpreadsheetSession()?.path);
}

/** True when an HTML editor session exists (opened from Virtual disk). */
export function isTextDocumentLoaded() {
  return Boolean(getTextDocumentSession()?.path);
}

export function readWorkspaceSessionFlags() {
  return {
    spreadsheetLoaded: isSpreadsheetLoaded(),
    textDocumentLoaded: isTextDocumentLoaded(),
  };
}

/** True when the active .sker was opened without write permission. */
export function isActiveSpreadsheetReadOnly() {
  const session = getSpreadsheetSession();
  if (!session?.path) return false;
  return session.canWrite === false;
}

/**
 * Block HTTP POST that would mutate the open read-only workbook or spreadsheet API.
 * @param {string} uri
 * @param {string|object} [jsonBody]
 */
export function shouldBlockReadOnlyPost(uri, jsonBody) {
  if (!isActiveSpreadsheetReadOnly()) return false;
  const session = getSpreadsheetSession();
  const activePath = session?.path;
  if (!activePath) return false;

  const normalizedUri = String(uri || '').split('?')[0];
  if (normalizedUri.startsWith('/spreadsheet/pool/')) {
    return false;
  }
  if (normalizedUri === '/spreadsheet/open') {
    return false;
  }
  if (normalizedUri.startsWith('/spreadsheet')) {
    return true;
  }

  if (!normalizedUri.startsWith('/files')) {
    return false;
  }

  let body = jsonBody;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return false;
    }
  }
  if (!body || typeof body !== 'object') {
    return false;
  }

  const targetPath = body.path;
  if (typeof targetPath === 'string' && targetPath.length > 0) {
    return targetPath === activePath || targetPath.startsWith(`${activePath}/`);
  }

  return normalizedUri === '/files/chmod' || normalizedUri === '/files/chunk';
}

/**
 * @param {string} path
 * @param {{ name?: string, isDirectory?: boolean, source?: string }} [meta]
 */
export function setActiveFilePath(path, meta = {}) {
  const normalized = path ? String(path) : '';
  activePath = normalized;
  activeMeta = normalized
    ? { path: normalized, ...meta }
    : null;
  notify();
}

export function clearActiveFile() {
  activePath = '';
  activeMeta = null;
  notify();
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Restore path from open workbook or document session after reload or login. */
export function hydrateActiveFileFromSession() {
  try {
    const spreadsheetRaw = readSpreadsheetSessionRaw();
    if (spreadsheetRaw) {
      const data = JSON.parse(spreadsheetRaw);
      if (data?.path) {
        setActiveFilePath(data.path, {
          name: data.name,
          source: 'spreadsheet',
          canWrite: data.canWrite !== false,
        });
        return;
      }
    }
    const documentRaw = sessionStorage.getItem(TEXT_DOCUMENT_SESSION_KEY);
    if (documentRaw) {
      const data = JSON.parse(documentRaw);
      if (data?.path) {
        setActiveFilePath(data.path, {
          name: data.name,
          source: 'textdocument',
          canWrite: data.canWrite !== false,
        });
      }
    }
  } catch (e) {
    console.warn('hydrateActiveFileFromSession failed:', e);
  }
}

export function syncSpreadsheetSession(fileData) {
  if (!fileData?.path) return;
  try {
    sessionStorage.setItem(SPREADSHEET_SESSION_KEY, JSON.stringify(fileData));
    sessionStorage.removeItem(LEGACY_SPREADSHEET_SESSION_KEY);
  } catch (e) {
    console.warn('syncSpreadsheetSession failed:', e);
  }
  setActiveFilePath(fileData.path, {
    name: fileData.name,
    source: 'spreadsheet',
    canWrite: fileData.canWrite !== false,
  });
}

export function syncTextDocumentSession(fileData) {
  if (!fileData?.path) return;
  try {
    sessionStorage.setItem(TEXT_DOCUMENT_SESSION_KEY, JSON.stringify(fileData));
  } catch (e) {
    console.warn('syncTextDocumentSession failed:', e);
  }
  setActiveFilePath(fileData.path, {
    name: fileData.name,
    source: 'textdocument',
    canWrite: fileData.canWrite !== false,
  });
}

export function clearTextDocumentSession() {
  try {
    sessionStorage.removeItem(TEXT_DOCUMENT_SESSION_KEY);
  } catch (e) {
    console.warn('clearTextDocumentSession failed:', e);
  }
  notify();
}

/** Best-effort lock release while JWT is still valid (logout, session teardown). */
export async function releaseTextDocumentLockIfAny() {
  const session = getTextDocumentSession();
  if (!session?.path || session.canWrite === false) {
    return;
  }
  if (!sessionStorage.getItem('jwt')) {
    return;
  }
  try {
    const client = new SkVirtualDiskClient();
    await client.releaseDocumentLock(session.path);
  } catch (error) {
    console.warn('releaseTextDocumentLockIfAny:', error?.message || error);
  }
}

/** WebSocket / PostMessage ops that persist or mutate workbook state on the server. */
export function isSpreadsheetWriteMessage(payload) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const mutatingOps = new Set(['Save', 'Do', 'Undo', 'Redo']);
  if (typeof payload.op === 'string' && mutatingOps.has(payload.op)) {
    return true;
  }
  if (payload.type === 'user' && typeof payload.action === 'string') {
    const passiveActions = new Set(['cursor', 'moveCell', 'leaveWorkBook']);
    return !passiveActions.has(payload.action);
  }
  return false;
}
