//=============================================================================
// SkPasteRange.mjs — build collaboration paste (tUndoPaste) messages for MCP
//=============================================================================

import { repairClipboardPayload } from './SkRepairClipboard.mjs';

/** @param {string} range */
function assertRangeNotation(range) {
  const wTrimmed = String(range || '').trim();
  if (!/^([A-Za-z]+\d+):([A-Za-z]+\d+)$/.test(wTrimmed)) {
    throw new Error(`Invalid range: ${range} (expected e.g. G2:U7)`);
  }
  return wTrimmed;
}

/**
 * Unique op id for collab Do messages (matches client scale).
 * @returns {number}
 */
export function generatePasteOpId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

/**
 * Normalize sker clipboard payload (cp) to the JSON string WASM expects in msg.cp.
 * @param {string|object} clipboard
 * @returns {string}
 */
export function normalizeClipboardPayload(clipboard) {
  if (typeof clipboard === 'string') {
    const wTrimmed = clipboard.trim();
    if (!wTrimmed) {
      throw new Error('clipboard string is empty');
    }
    clipboard = JSON.parse(wTrimmed);
  }

  if (!clipboard || typeof clipboard !== 'object') {
    throw new Error('clipboard must be a JSON string or object');
  }

  const wRepaired = repairClipboardPayload(clipboard);
  return JSON.stringify(wRepaired.clipboard);
}

/**
 * Build Do/tUndoPaste collab envelope for GetMessage().
 * @param {string} workbookPath
 * @param {string} range — destination A1 range, e.g. G2:U7
 * @param {string} sheet
 * @param {string|object} clipboard — sker cp payload
 * @returns {{ uri: string, op: string, msg: object }}
 */
export function buildPasteDoEnvelope(workbookPath, range, sheet, clipboard) {
  const wRange = assertRangeNotation(range);
  const wCp = normalizeClipboardPayload(clipboard);
  const wSheet = typeof sheet === 'string' ? sheet : '';

  return {
    uri: workbookPath,
    op: 'Do',
    msg: {
      ud: 'tUndoPaste',
      op: `Paste ${wRange}`,
      opid: generatePasteOpId(),
      sh: wSheet,
      rf: wRange,
      cp: wCp,
    },
  };
}
