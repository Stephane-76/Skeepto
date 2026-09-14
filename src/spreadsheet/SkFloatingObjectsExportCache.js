//=============================================================================
// Session cache for JsonFloatingObjectsForSheet (range/PDF export probes).
//=============================================================================

import { parseFloatingObjectsJson } from "./SkSpFloatingObject.js";

let cachedKey = "";
/** @type {object[] | null} */
let cachedObjects = null;

/** Drop cached floating-object lists (workbook reload / embed session end). */
export function invalidateFloatingObjectsExportCache() {
  cachedKey = "";
  cachedObjects = null;
}

/**
 * Floating objects on a sheet — one WASM round-trip per workbook+sheet until invalidation.
 * @param {string} sheet
 * @returns {Promise<object[]>}
 */
export async function getCachedFloatingObjectsForSheet(sheet) {
  const wSheet = String(sheet || "").trim();
  let wUri = "";
  try {
    wUri = String((window.SkUISpreadSheet?.getActiveWorkBook?.()) || "").trim();
  } catch (_err) {
    /* best effort */
  }
  const wKey = `${wUri}\0${wSheet}`;
  if (cachedKey === wKey && cachedObjects != null) {
    return cachedObjects;
  }

  if (!wSheet || typeof window.SkUISpreadSheet?.jsonFloatingObjectsForSheet !== "function") {
    cachedKey = wKey;
    cachedObjects = [];
    return cachedObjects;
  }

  const wJson = window.SkUISpreadSheet.jsonFloatingObjectsForSheet(wSheet, wSheet);
  cachedKey = wKey;
  cachedObjects = parseFloatingObjectsJson(wJson).filter(
    (o) => !o?.t || o.t === wSheet,
  );
  return cachedObjects;
}
