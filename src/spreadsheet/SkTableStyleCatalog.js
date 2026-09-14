// Excel built-in ListObject table styles — names + UI preview helpers.

import {
  appendTableMetadataToPayload,
  sanitizeFilterColumn,
} from "./SkTableFilter.js";

function applyTintHex(sHex, sTint) {
  const wRgb = parseInt(sHex, 16);
  let wR = (wRgb >> 16) & 0xff;
  let wG = (wRgb >> 8) & 0xff;
  let wB = wRgb & 0xff;
  const wApply = (c) => {
    let v = c / 255;
    if (sTint > 0) v = v * (1 - sTint) + sTint;
    else v = v * (1 + sTint);
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  };
  wR = wApply(wR);
  wG = wApply(wG);
  wB = wApply(wB);
  return `#${((1 << 24) + (wR << 16) + (wG << 8) + wB).toString(16).slice(1)}`;
}

const OFFICE_THEME = [
  "FFFFFF",
  "000000",
  "E7E6E6",
  "44546A",
  "4472C4",
  "ED7D31",
  "A5A5A5",
  "FFC000",
  "5B9BD5",
  "70AD47",
];

function themeAccentHex(sAccentIndex, sTint = 0) {
  const wIdx = sAccentIndex <= 0 ? 1 : 3 + sAccentIndex;
  const wBase = OFFICE_THEME[wIdx] || OFFICE_THEME[4];
  return sTint ? applyTintHex(wBase, sTint) : `#${wBase}`;
}

export const TABLE_STYLE_FAMILIES = [
  { id: "medium", label: "Medium", prefix: "TableStyleMedium", count: 28 },
  { id: "light", label: "Light", prefix: "TableStyleLight", count: 21 },
  { id: "dark", label: "Dark", prefix: "TableStyleDark", count: 11 },
];

export function parseTableStyleName(sName) {
  const wText = String(sName || "").trim();
  for (const wFamily of TABLE_STYLE_FAMILIES) {
    if (wText.startsWith(wFamily.prefix)) {
      const wNum = Number.parseInt(wText.slice(wFamily.prefix.length), 10);
      if (Number.isFinite(wNum) && wNum > 0) {
        return { family: wFamily.id, number: wNum, name: wText };
      }
    }
  }
  return { family: "medium", number: 2, name: wText || "TableStyleMedium2" };
}

export function builtinStyleName(sFamilyId, sNumber) {
  const wFamily = TABLE_STYLE_FAMILIES.find((f) => f.id === sFamilyId);
  if (!wFamily || sNumber < 1 || sNumber > wFamily.count) {
    return null;
  }
  return `${wFamily.prefix}${sNumber}`;
}

export function listBuiltinStyles(sFamilyId) {
  const wFamily = TABLE_STYLE_FAMILIES.find((f) => f.id === sFamilyId);
  if (!wFamily) return [];
  const out = [];
  for (let wI = 1; wI <= wFamily.count; wI++) {
    out.push({
      name: `${wFamily.prefix}${wI}`,
      number: wI,
      family: wFamily.id,
      preview: previewColorsForStyle(wFamily.id, wI),
    });
  }
  return out;
}


/** Mini swatch colors aligned with SkTableStyle.cpp built-in palette. */
export function previewColorsForStyle(sFamilyId, sNumber) {
  const wOffset = ((sNumber - 1) % 7) + 1;
  const wAccentIdx = wOffset - 1;

  if (sFamilyId === "light") {
    return {
      header: "#ffffff",
      headerBorder: themeAccentHex(wAccentIdx, 0),
      rowA: "#ffffff",
      rowB: sNumber >= 8 ? themeAccentHex(wAccentIdx, 0.8) : "#ffffff",
      border: themeAccentHex(wAccentIdx, 0),
    };
  }
  if (sFamilyId === "dark") {
    return {
      header: themeAccentHex(wAccentIdx, -0.5),
      headerText: "#ffffff",
      rowA: themeAccentHex(wAccentIdx, -0.5),
      rowB: themeAccentHex(wAccentIdx, 0.4),
      border: themeAccentHex(wAccentIdx, -0.5),
    };
  }
  return {
    header: themeAccentHex(wAccentIdx, 0),
    headerText: "#ffffff",
    rowA: "#ffffff",
    rowB: wAccentIdx <= 0 ? "#f2f2f2" : themeAccentHex(wAccentIdx, 0.6),
    border: themeAccentHex(wAccentIdx, 0),
  };
}

/**
 * Full RangeData JSON for undoApplyRangeData (columns + table metadata).
 * @param {object} sTable normalized table from parseSheetTables
 * @param {object} [sStylePatch] tableStyleName, tableShowRowStripes, omitStyleElements, …
 */
export function buildFullRangeDataJson(sTable, sStylePatch = {}) {
  const wData = sTable?.data || {};
  const wRange = sTable?.range;
  const wColumns = (wData.columns || []).map((c) =>
    sanitizeFilterColumn(c, wRange)
  );
  const payload = { columns: wColumns };
  appendTableMetadataToPayload(payload, wData, {
    ...sStylePatch,
    explicitBools: true,
    omitStyleElements:
      sStylePatch.omitStyleElements === true || sStylePatch.tableStyleName != null,
  });
  return JSON.stringify(payload);
}
