//=============================================================================
// SkDebugFormatServer.js — dump FormatApi / FormatRoot on SkServer (no workbook)
//=============================================================================

/**
 * Ask SkServer to dump FormatApi (FormatRoot) on every WASM pool instance.
 * Does not load or touch any workbook — use after close to verify formats were released.
 * Output: SkServer terminal + JSON summary (count per instance).
 * @returns {Promise<{ ok: boolean, empty?: boolean, totalCount?: number, instances?: object[], error?: string }>}
 */
export async function debugFormatOnServer() {
  const wJwt = sessionStorage.getItem('jwt');
  if (!wJwt) {
    return { ok: false, error: 'Not logged in.' };
  }

  try {
    const wResponse = await fetch('/format/debug', {
      method: 'GET',
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${wJwt}`,
        Accept: 'application/json',
      },
    });

    const wBody = await wResponse.json().catch(() => ({}));
    if (!wResponse.ok || wBody.message === 'error') {
      return {
        ok: false,
        error: wBody.error || wBody.details || `HTTP ${wResponse.status}`,
      };
    }

    const wInstances = Array.isArray(wBody.instances) ? wBody.instances : [];
    const wTotal = Number(wBody.totalCount) || 0;
    console.log('[Debug Format / FormatApi]', {
      totalCount: wTotal,
      empty: wBody.empty === true,
      workbooks: wBody.workbooks || [],
      pendingUnloads: wBody.pendingUnloads || [],
      unloadGraceMs: wBody.unloadGraceMs,
      instances: wInstances,
    });
    for (const wInst of wInstances) {
      const wBooks = Array.isArray(wInst.workbooks) ? wInst.workbooks.join(', ') : '';
      console.log(
        `[FormatApi instance ${wInst.id}] count=${wInst.count}` +
          (wBooks ? ` workbooks=[${wBooks}]` : ' workbooks=[]')
      );
      if (wInst.debug) {
        console.log(wInst.debug);
      }
    }

    return {
      ok: true,
      empty: wBody.empty === true,
      totalCount: wTotal,
      hasFormatCount: wBody.hasFormatCount !== false,
      instances: wInstances,
      workbooks: wBody.workbooks || [],
      pendingUnloads: wBody.pendingUnloads || [],
      unloadGraceMs: wBody.unloadGraceMs,
    };
  } catch (wErr) {
    return { ok: false, error: wErr?.message || String(wErr) };
  }
}
