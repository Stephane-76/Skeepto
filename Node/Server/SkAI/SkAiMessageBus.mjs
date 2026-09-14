//=============================================================================
// SkAiMessageBus.mjs — dispatch WASM PostMessage to collab WebSocket as AI user
//=============================================================================

import { AsyncLocalStorage } from 'node:async_hooks';
import dependenciesContainer from '../Depency/SkDepencyManager.mjs';

/** @type {import('node:async_hooks').AsyncLocalStorage<{ onBehalfOf?: string, workbookPath?: string }>} */
const aiDispatchContext = new AsyncLocalStorage();

const WRITE_OPS = new Set(['Do', 'Undo', 'Redo']);

/**
 * @returns {{ userId: string, email: string, firstName: string, lastName: string }}
 */
export function getAiUserIdentity() {
  return {
    userId: process.env.SK_AI_USER_ID || 'sker-ai',
    email: process.env.SK_AI_USER_EMAIL || 'assistant@sker.ai',
    firstName: process.env.SK_AI_USER_FIRSTNAME || 'Sker',
    lastName: process.env.SK_AI_USER_LASTNAME || 'Assistant',
  };
}

/**
 * Run spreadsheet automation with collab dispatch enabled (PostMessage → WebSocket).
 * @template T
 * @param {{ onBehalfOf?: string, workbookPath?: string }} context
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function runWithAiDispatchContext(context, fn) {
  return aiDispatchContext.run(context ?? {}, fn);
}

/** @returns {{ onBehalfOf?: string, workbookPath?: string }|undefined} */
export function getAiDispatchContext() {
  return aiDispatchContext.getStore();
}

/**
 * @param {string} rawMessage
 */
export function handleWasmPostMessage(rawMessage) {
  const wCtx = aiDispatchContext.getStore();
  if (!wCtx) {
    return;
  }

  if (!rawMessage || typeof rawMessage !== 'string') {
    return;
  }

  let wEnvelope;
  try {
    wEnvelope = JSON.parse(rawMessage);
  } catch {
    return;
  }

  if (!wEnvelope || typeof wEnvelope !== 'object') {
    return;
  }

  const wOp = wEnvelope.op;
  if (!WRITE_OPS.has(wOp)) {
    return;
  }

  if (!wEnvelope.msg || typeof wEnvelope.msg !== 'object') {
    return;
  }

  const wAi = getAiUserIdentity();
  wEnvelope.em = wAi.email;
  wEnvelope.nm = wAi.lastName;
  wEnvelope.fn = wAi.firstName;

  if (!wEnvelope.uri && wCtx.workbookPath) {
    wEnvelope.uri = wCtx.workbookPath;
  }

  wEnvelope.sk_src = 'ai';
  if (wCtx.onBehalfOf) {
    wEnvelope.sk_onBehalfOf = wCtx.onBehalfOf;
  }

  const wChat = dependenciesContainer.resolve('SkChat');
  if (!wChat || typeof wChat.dispatchSpreadsheetMessageAsUser !== 'function') {
    console.warn('[SkAiMessageBus] SkChat not ready — PostMessage not dispatched');
    return;
  }

  const wRoomId = process.env.SK_AI_SPREADSHEET_ROOM || 'spreadsheet';
  const wOk = wChat.dispatchSpreadsheetMessageAsUser({
    userId: wAi.userId,
    username: wAi.email,
    roomId: wRoomId,
    message: wEnvelope,
    skipServerApply: true,
  });

  if (wOk) {
    console.log(
      `[SkAiMessageBus] dispatched ${wOp} uri=${wEnvelope.uri || '?'} onBehalfOf=${wCtx.onBehalfOf || '-'}`
    );
  }
}

/**
 * Emscripten PostMessage hook shared by the WASM pool.
 * @returns {(msg: string) => void}
 */
export function createWasmPostMessageHandler() {
  return function wasmPostMessage(msg) {
    console.log('[PostMessage]', msg);
    handleWasmPostMessage(msg);
  };
}

/**
 * Register the virtual AI user in SkSpreadSheet (workbook routing / chatJoin).
 */
export async function registerAiSpreadsheetUser() {
  const wAi = getAiUserIdentity();
  try {
    const wSs = dependenciesContainer.resolve('SkSpreadSheet');
    if (wSs && typeof wSs.chatJoin === 'function') {
      await wSs.chatJoin(wAi.email);
      console.log(`[SkAiMessageBus] registered AI user ${wAi.email}`);
    }
  } catch (err) {
    console.warn('[SkAiMessageBus] registerAiSpreadsheetUser failed:', err?.message || err);
  }
}
