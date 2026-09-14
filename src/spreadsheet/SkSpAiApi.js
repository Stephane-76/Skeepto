/**
 * REST helpers for SkServer AI routes (/ai/status, /ai/ask).
 */

function parseJsonResponse(raw) {
  if (raw == null || raw === '') {
    return { message: 'error', error: 'Empty response' };
  }
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return { message: 'error', error: 'Invalid JSON response' };
  }
}

/**
 * @returns {Promise<object>}
 */
export async function fetchAiStatus() {
  if (!window.WebInterface?.getJson) {
    throw new Error('WebInterface is not available');
  }
  const wRaw = await window.WebInterface.getJson('/ai/status');
  return parseJsonResponse(wRaw);
}

/**
 * @param {{ prompt: string, workbookPath?: string, spreadsheetLang?: string, spreadsheetContext?: { sheet?: string, selection?: string, cursorRef?: string }, history?: Array<{ role: string, text?: string, content?: string }>, timeoutMs?: number, signal?: AbortSignal }} params
 * @returns {Promise<object>}
 */
export async function postAiAsk(params) {
  if (!window.WebInterface?.postJson) {
    throw new Error('WebInterface is not available');
  }
  const wBody = {
    prompt: params.prompt,
    workbookPath: params.workbookPath,
    spreadsheetLang: params.spreadsheetLang,
  };
  if (params.spreadsheetContext) {
    wBody.spreadsheetContext = params.spreadsheetContext;
  }
  if (Array.isArray(params.history) && params.history.length > 0) {
    wBody.history = params.history;
  }
  if (params.timeoutMs != null) {
    wBody.timeoutMs = params.timeoutMs;
  }
  const wFetchExtras = params.signal ? { signal: params.signal } : {};
  const wRaw = await window.WebInterface.postJson('/ai/ask', JSON.stringify(wBody), 'insert', wFetchExtras);
  return parseJsonResponse(wRaw);
}
