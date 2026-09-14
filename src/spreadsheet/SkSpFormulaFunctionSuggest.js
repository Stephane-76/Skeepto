//=============================================================================
// SkSpFormulaFunctionSuggest
// Excel-like function name typeahead while editing a formula (= / operators).
//=============================================================================

const SUGGEST_LIMIT = 40;

/** Characters that may precede a function name token (Excel-like). */
const FUNCTION_PREFIX_TRIGGERS = new Set([
  "=",
  "+",
  "-",
  "*",
  "/",
  "^",
  "&",
  "%",
  "(",
  ",",
  ";",
  "<",
  ">",
]);

let gCatalogPromise = null;
/** @type {{ name: string, syntax: string, description: string }[] | null} */
let gCatalog = null;

/**
 * Load and flatten public/functions.json once per session.
 * @returns {Promise<{ name: string, syntax: string, description: string }[]>}
 */
export function loadFormulaFunctionCatalog() {
  if (gCatalog) {
    return Promise.resolve(gCatalog);
  }
  if (gCatalogPromise) {
    return gCatalogPromise;
  }
  const wUrl = `${process.env.PUBLIC_URL || ""}/functions.json`;
  gCatalogPromise = fetch(wUrl)
    .then((wResponse) => {
      if (!wResponse.ok) {
        throw new Error(`functions.json HTTP ${wResponse.status}`);
      }
      return wResponse.json();
    })
    .then((wData) => {
      const wFlat = [];
      const wByName = new Map();
      const wCategories =
        wData && wData.functions && typeof wData.functions === "object"
          ? wData.functions
          : {};
      for (const wList of Object.values(wCategories)) {
        if (!Array.isArray(wList)) {
          continue;
        }
        for (const wFn of wList) {
          const wName = String(wFn?.name || "")
            .trim()
            .toUpperCase();
          if (!wName || wByName.has(wName)) {
            continue;
          }
          const wEntry = {
            name: wName,
            syntax: String(wFn.syntax || `${wName}()`),
            description: String(wFn.description || ""),
          };
          wByName.set(wName, wEntry);
          wFlat.push(wEntry);
        }
      }
      wFlat.sort((a, b) => a.name.localeCompare(b.name));
      gCatalog = wFlat;
      return gCatalog;
    })
    .catch((wErr) => {
      console.error("SkSpFormulaFunctionSuggest: failed to load catalog", wErr);
      gCatalogPromise = null;
      gCatalog = [];
      return gCatalog;
    });
  return gCatalogPromise;
}

/** @returns {{ name: string, syntax: string, description: string }[]} */
export function getFormulaFunctionCatalogSync() {
  return gCatalog || [];
}

/**
 * Merge session user-defined functions into a catalog copy.
 * @param {{ name: string, syntax: string, description: string }[]} sCatalog
 * @param {object|null|undefined} sSpInterface
 */
export function catalogWithUserFunctions(sCatalog, sSpInterface) {
  const wBase = Array.isArray(sCatalog) ? sCatalog : [];
  const wContainer = sSpInterface?.m_FunctionContainer;
  if (!wContainer || typeof wContainer.listUserFunctions !== "function") {
    return wBase;
  }
  let wUser = [];
  try {
    wUser = wContainer.listUserFunctions() || [];
  } catch (e) {
    return wBase;
  }
  if (!wUser.length) {
    return wBase;
  }
  const wByName = new Map(wBase.map((wEntry) => [wEntry.name, wEntry]));
  for (const wMeta of wUser) {
    const wName = String(wMeta?.name || "")
      .trim()
      .toUpperCase();
    if (!wName || wByName.has(wName)) {
      continue;
    }
    wByName.set(wName, {
      name: wName,
      syntax: `${wName}(...)`,
      description: String(wMeta.label || "User function"),
    });
  }
  return Array.from(wByName.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

/**
 * True when caret is inside a double-quoted string (simple Excel-like scan).
 * @param {string} sText
 * @param {number} sCaret
 */
export function isInsideFormulaString(sText, sCaret) {
  let wInString = false;
  const wEnd = Math.min(sCaret, sText.length);
  for (let i = 0; i < wEnd; i++) {
    const wCh = sText[i];
    if (wCh === '"') {
      // Excel doubles quotes inside strings: ""
      if (wInString && sText[i + 1] === '"') {
        i += 1;
        continue;
      }
      wInString = !wInString;
    }
  }
  return wInString;
}

/**
 * Find the function-name radical being typed before the caret.
 * @returns {{ start: number, end: number, prefix: string } | null}
 */
export function findFunctionSuggestToken(sText, sCaret) {
  if (typeof sText !== "string" || !sText.startsWith("=")) {
    return null;
  }
  const wCaret = Math.max(0, Math.min(Number(sCaret) || 0, sText.length));
  if (wCaret < 1 || isInsideFormulaString(sText, wCaret)) {
    return null;
  }

  let wStart = wCaret;
  while (wStart > 0 && /[A-Za-z0-9._]/.test(sText[wStart - 1])) {
    wStart -= 1;
  }
  if (wStart === wCaret) {
    return null;
  }
  const wPrefix = sText.substring(wStart, wCaret);
  if (!/^[A-Za-z]/.test(wPrefix)) {
    return null;
  }

  let wBefore = wStart - 1;
  while (wBefore >= 0 && /\s/.test(sText[wBefore])) {
    wBefore -= 1;
  }
  if (wBefore < 0) {
    return null;
  }
  if (!FUNCTION_PREFIX_TRIGGERS.has(sText[wBefore])) {
    return null;
  }

  return { start: wStart, end: wCaret, prefix: wPrefix };
}

/**
 * Filter catalog by case-insensitive prefix (names that start with radical).
 * @param {{ name: string, syntax: string, description: string }[]} sCatalog
 * @param {string} sPrefix
 * @param {number} [sLimit]
 */
export function filterFunctionsByPrefix(sCatalog, sPrefix, sLimit = SUGGEST_LIMIT) {
  const wPrefix = String(sPrefix || "").toUpperCase();
  if (!wPrefix || !Array.isArray(sCatalog)) {
    return [];
  }
  const wOut = [];
  for (const wFn of sCatalog) {
    if (wFn.name.startsWith(wPrefix)) {
      wOut.push(wFn);
      if (wOut.length >= sLimit) {
        break;
      }
    }
  }
  return wOut;
}

export const FORMULA_FUNCTION_SUGGEST_LIMIT = SUGGEST_LIMIT;
