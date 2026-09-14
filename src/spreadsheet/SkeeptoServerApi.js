/**
 * Server-side spreadsheet open: content stream (no WASM) + background WASM load for collaboration.
 */

export function encodeSpreadsheetPathForUrl(virtualPath) {
  return String(virtualPath || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function parseServerErrorPayload(text, fallback) {
  try {
    const payload = JSON.parse(text);
    if (payload?.message === 'error' && payload?.error) {
      if (payload.error === 'Permission denied') {
        return 'You do not have permission to open this file.';
      }
      return payload.error;
    }
  } catch (_) {
    /* raw body */
  }
  return fallback;
}

/**
 * Fetch workbook JSON from GET /spreadsheet/content/* (Mongo/GridFS only, no server WASM).
 * @param {string} virtualPath
 * @returns {Promise<string>}
 */
export async function fetchWorkbookJsonFromContentEndpoint(virtualPath) {
  if (!window.WebInterface?.getText) {
    throw new Error('WebInterface is not available');
  }
  const encodedPath = encodeSpreadsheetPathForUrl(virtualPath);
  const maxAttempts = 4;
  let lastError = 'Failed to load workbook';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { ok, status, text } = await window.WebInterface.getText(`/spreadsheet/content${encodedPath}`);
    if (ok) {
      if (!text || text.trim() === '') {
        throw new Error('Workbook content is empty');
      }
      return text;
    }
    lastError = parseServerErrorPayload(text, `Failed to load workbook (HTTP ${status})`);
    const isTransientMissing = /FileNotFound|not found/i.test(lastError);
    if (!isTransientMissing || attempt === maxAttempts - 1) {
      throw new Error(lastError);
    }
    // Persist of a huge workbook may still be rewriting GridFS after a long recalc.
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  throw new Error(lastError);
}

/**
 * Start background server WASM load (POST /spreadsheet/open). Fire-and-forget friendly.
 * @param {string} virtualPath
 * @returns {Promise<{ taskId: string|null, status: string, path: string }>}
 */
export async function openWorkbookOnServer(virtualPath) {
  if (!window.WebInterface?.postJson) {
    throw new Error('WebInterface is not available');
  }
  const raw = await window.WebInterface.postJson(
    '/spreadsheet/open',
    JSON.stringify({ path: virtualPath })
  );
  const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (payload?.message === 'error') {
    throw new Error(payload.error || 'Server open failed');
  }
  return {
    taskId: payload.taskId ?? null,
    status: payload.status || 'loading',
    path: payload.path || virtualPath,
  };
}

/**
 * Release this user from a server-side workbook (schedules WASM unload when last user leaves).
 * Used by text-editor embeds that previously called /spreadsheet/open.
 * @param {string} virtualPath
 * @param {{ immediate?: boolean }} [options] — immediate=true skips unload grace (embed teardown)
 */
export async function closeWorkbookOnServer(virtualPath, options = {}) {
  if (!window.WebInterface?.postJson) {
    return false;
  }
  try {
    const raw = await window.WebInterface.postJson(
      '/spreadsheet/close',
      JSON.stringify({
        path: virtualPath,
        immediate: options.immediate === true,
      })
    );
    const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (payload?.message === 'error') {
      console.warn('[SkeeptoServerApi] close failed:', payload.error || payload);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[SkeeptoServerApi] close failed:', err?.message || err);
    return false;
  }
}

/**
 * Poll GET /spreadsheet/tasks/:taskId until ready, error, or timeout.
 * @param {string} taskId
 * @param {{ intervalMs?: number, timeoutMs?: number }} [options]
 */
export async function pollWorkbookLoadTask(taskId, options = {}) {
  const intervalMs = options.intervalMs ?? 500;
  const timeoutMs = options.timeoutMs ?? 120000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const raw = await window.WebInterface.getJson(`/spreadsheet/tasks/${encodeURIComponent(taskId)}`);
    const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (payload?.message === 'error' && payload?.error === 'Task not found') {
      throw new Error('Load task not found on server');
    }
    if (payload?.status === 'ready') {
      return payload;
    }
    if (payload?.status === 'error') {
      throw new Error(payload.error || 'Server workbook load failed');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timeout waiting for server workbook load');
}

/**
 * Load client WASM from content endpoint; start server WASM load in parallel (non-blocking).
 * Use for the full spreadsheet UI (collaboration). Text-editor embeds should use content only.
 * @param {string} virtualPath
 * @returns {Promise<string>} workbook JSON string for ReadJson
 */
export async function fetchWorkbookJsonAndOpenOnServer(virtualPath) {
  const contentPromise = fetchWorkbookJsonFromContentEndpoint(virtualPath);
  const serverOpenPromise = openWorkbookOnServer(virtualPath).catch((err) => {
    console.warn('[SkeeptoServerApi] background server open failed:', err?.message || err);
    return null;
  });

  const [json] = await Promise.all([contentPromise, serverOpenPromise]);
  return json;
}
