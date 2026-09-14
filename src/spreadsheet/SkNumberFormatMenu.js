/** Format catalog for Format menu. Labels from WASM; previews via defaultFormatString where noted. */

import { getSpreadsheetLang } from './SkeeptoLang.js';

const NUMBER_FAMILY_ORDER = ['Numeric'];
const PERCENT_FAMILY = 'Percent';
const SCIENTIFIC_FAMILY = 'Scientific';
const DATE_FAMILY = 'Date';
const ACCOUNTING_FAMILY = 'Accounting';
const CURRENCY_FAMILY_ORDER = [ACCOUNTING_FAMILY];
const EXAMPLE_FAMILIES = new Set([PERCENT_FAMILY, SCIENTIFIC_FAMILY, DATE_FAMILY]);
const ALL_FAMILY_ORDER = [...NUMBER_FAMILY_ORDER, ...CURRENCY_FAMILY_ORDER, PERCENT_FAMILY, SCIENTIFIC_FAMILY, DATE_FAMILY];

/** Default locale currency symbol — mirrors SkLocale::Set() unit money mapping. */
const LANG_MONEY_SYMBOL = {
  us: '$',
  en: '£',
  de: '€',
  fr: '€',
  sp: '€',
  it: '€',
};

/** @type {{ family: string, key: string, label: string, example?: string, dateGroup?: string }[]} */
let formatCatalog = [];
let catalogLoaded = false;
let catalogRevision = 0;
/** @type {Promise<boolean>|null} */
let catalogLoadPromise = null;

function localizeAccountingLabel(label, family) {
  if (family !== ACCOUNTING_FAMILY || typeof label !== 'string' || !label.includes('$')) {
    return label;
  }
  const wSymbol = LANG_MONEY_SYMBOL[getSpreadsheetLang()] || '$';
  if (wSymbol === '$') {
    return label;
  }
  return label.replace(/\$/g, wSymbol);
}

function classifyDateGroup(formatKey) {
  const hasTime =
    /\bh:mm\b/i.test(formatKey) ||
    /AM\/PM/i.test(formatKey) ||
    /%H:%M/i.test(formatKey) ||
    /%p/i.test(formatKey);
  const hasDate =
    /yyyy|yy|mmmm|dddd|mm-dd|dd\/mm|%d|%m|%Y|%B|%A/i.test(formatKey);
  if (hasDate && hasTime) {
    return 'datetime';
  }
  if (hasTime) {
    return 'time';
  }
  return 'date';
}

function exampleLabel(entry) {
  return typeof entry.example === 'string' && entry.example.length > 0
    ? entry.example
    : entry.label;
}

export function isFormatCatalogLoaded() {
  return catalogLoaded;
}

export function getFormatCatalog() {
  return formatCatalog;
}

export function getFormatCatalogRevision() {
  return catalogRevision;
}

/**
 * Fill the catalog synchronously when WASM is ready (no wait on example previews).
 * @returns {boolean}
 */
export function ensureFormatCatalogSync() {
  if (catalogLoaded && formatCatalog.length > 0) {
    return true;
  }
  if (typeof window === 'undefined' || !window.SkUISpreadSheet) {
    return false;
  }
  try {
    const wJson = window.SkUISpreadSheet.jsonFormatString();
    const wObj = JSON.parse(wJson);
    const wFamilies = Array.isArray(wObj.formatstring) ? wObj.formatstring : [];
    const wByCode = new Map(wFamilies.map((family) => [family.code, family.fs || []]));

    const wNext = [];
    for (const familyCode of ALL_FAMILY_ORDER) {
      const wFormats = wByCode.get(familyCode) || [];
      for (const formatEntry of wFormats) {
        if (!formatEntry || typeof formatEntry.f !== 'string') {
          continue;
        }
        const wEntry = {
          family: familyCode,
          key: formatEntry.f,
          label: localizeAccountingLabel(
            typeof formatEntry.l === 'string' && formatEntry.l.length > 0
              ? formatEntry.l
              : formatEntry.f,
            familyCode
          ),
        };
        if (familyCode === DATE_FAMILY) {
          wEntry.dateGroup = classifyDateGroup(formatEntry.f);
        }
        wNext.push(wEntry);
      }
    }

    formatCatalog = wNext;
    catalogLoaded = formatCatalog.length > 0;
    if (catalogLoaded) {
      catalogRevision += 1;
      window.dispatchEvent(new CustomEvent('skFormatMenuReady'));
      // Prefetch example labels in background (Percent / Scientific / Date menus).
      if (!catalogLoadPromise) {
        loadFormatCatalog().catch(() => {});
      }
    }
    return catalogLoaded;
  } catch (error) {
    console.error('ensureFormatCatalogSync failed', error);
    return false;
  }
}

/**
 * Drop the cached catalog and rebuild it from the WASM engine.
 * Format labels (e.g. the accounting currency symbol) and localized examples
 * depend on the active spreadsheet language, so the cached catalog is stale
 * after SkUISpreadSheet.setLang(). Rebuilding bumps the revision and dispatches
 * 'skFormatMenuReady', which refreshes the web Format submenus and re-pushes the
 * native (Electron) menu via SkDesktopBridge.
 */
export function invalidateFormatCatalog() {
  formatCatalog = [];
  catalogLoaded = false;
  catalogLoadPromise = null;
  ensureFormatCatalogSync();
}

// Rebuild the catalog whenever the spreadsheet locale changes. applySpreadsheetLang
// updates the WASM engine first, then fires this event, so jsonFormatString()
// already returns localized data by the time we rebuild.
if (typeof window !== 'undefined') {
  window.addEventListener('skeeptoLangChange', () => {
    invalidateFormatCatalog();
  });
}

export async function loadFormatCatalog() {
  if (catalogLoaded && formatCatalog.length > 0) {
    // Still refresh examples if missing
    const wNeedExamples = formatCatalog.some(
      (entry) => EXAMPLE_FAMILIES.has(entry.family) && entry.example == null
    );
    if (!wNeedExamples) {
      return true;
    }
  }
  if (catalogLoadPromise) {
    return catalogLoadPromise;
  }

  catalogLoadPromise = (async () => {
    if (typeof window === 'undefined' || !window.SkUISpreadSheet) {
      return false;
    }
    try {
      if (!catalogLoaded || formatCatalog.length === 0) {
        if (!ensureFormatCatalogSync()) {
          return false;
        }
      }

      const wExampleEntries = formatCatalog.filter((entry) => EXAMPLE_FAMILIES.has(entry.family));
      await Promise.all(
        wExampleEntries.map(async (entry) => {
          try {
            entry.example = window.SkUISpreadSheet.defaultFormatString(entry.key);
          } catch (error) {
            console.error('defaultFormatString failed', entry.key, error);
            entry.example = null;
          }
        })
      );

      catalogRevision += 1;
      window.dispatchEvent(new CustomEvent('skFormatMenuReady'));
      return catalogLoaded;
    } catch (error) {
      console.error('loadFormatCatalog failed', error);
      return false;
    } finally {
      catalogLoadPromise = null;
    }
  })();

  return catalogLoadPromise;
}

function buildLoadingItem() {
  return [
    {
      id: 'format-number-loading',
      label: 'Loading formats…',
      disabled: true,
    },
  ];
}

function buildEmptyItem() {
  return [
    {
      id: 'format-number-empty',
      label: 'No formats available',
      disabled: true,
    },
  ];
}

function buildMenuItems(onMenuClick, filterFn, groupFn, labelFn) {
  // Prefer sync fill so Format → Number works on first hover after WASM is ready.
  if (!ensureFormatCatalogSync()) {
    loadFormatCatalog().catch(() => {});
    return buildLoadingItem();
  }

  if (formatCatalog.length === 0) {
    return buildEmptyItem();
  }

  const wItems = [];
  let wLastGroup = null;

  for (let wIndex = 0; wIndex < formatCatalog.length; wIndex++) {
    const wEntry = formatCatalog[wIndex];
    if (!filterFn(wEntry)) {
      continue;
    }
    const wGroup = groupFn(wEntry);
    if (wLastGroup !== null && wGroup !== wLastGroup) {
      wItems.push({ type: 'separator' });
    }
    wLastGroup = wGroup;
    wItems.push({
      id: `format:apply:${wIndex}`,
      label: labelFn(wEntry),
      onClick: () => onMenuClick(`format:apply:${wIndex}`),
    });
  }

  if (wItems.length === 0) {
    return buildEmptyItem();
  }

  return wItems;
}

export function buildNumberFormatMenuItems(onMenuClick) {
  return buildMenuItems(
    onMenuClick,
    (entry) => entry.family === 'Numeric',
    () => 'Numeric',
    (entry) => entry.label
  );
}

export function buildCurrencyFormatMenuItems(onMenuClick) {
  return buildMenuItems(
    onMenuClick,
    (entry) => entry.family === ACCOUNTING_FAMILY,
    () => ACCOUNTING_FAMILY,
    (entry) => entry.label
  );
}

/** Catalog rows for Numeric only (ribbon number popup). */
export function getNumberFormatCatalogEntries() {
  if (!catalogLoaded || formatCatalog.length === 0) {
    return [];
  }

  const wEntries = [];
  for (let wIndex = 0; wIndex < formatCatalog.length; wIndex++) {
    const wEntry = formatCatalog[wIndex];
    if (wEntry.family !== 'Numeric') {
      continue;
    }
    wEntries.push({
      ...wEntry,
      catalogIndex: wIndex,
    });
  }
  return wEntries;
}

/** Catalog rows for Accounting / currency formats. */
export function getCurrencyFormatCatalogEntries() {
  if (!catalogLoaded || formatCatalog.length === 0) {
    return [];
  }

  const wEntries = [];
  for (let wIndex = 0; wIndex < formatCatalog.length; wIndex++) {
    const wEntry = formatCatalog[wIndex];
    if (wEntry.family !== ACCOUNTING_FAMILY) {
      continue;
    }
    wEntries.push({
      ...wEntry,
      catalogIndex: wIndex,
    });
  }
  return wEntries;
}

export function buildPercentFormatMenuItems(onMenuClick) {
  return buildMenuItems(
    onMenuClick,
    (entry) => entry.family === PERCENT_FAMILY,
    () => PERCENT_FAMILY,
    exampleLabel
  );
}

export function buildScientificFormatMenuItems(onMenuClick) {
  return buildMenuItems(
    onMenuClick,
    (entry) => entry.family === SCIENTIFIC_FAMILY,
    () => SCIENTIFIC_FAMILY,
    exampleLabel
  );
}

export function buildDateTimeFormatMenuItems(onMenuClick) {
  return buildMenuItems(
    onMenuClick,
    (entry) => entry.family === DATE_FAMILY,
    (entry) => entry.dateGroup || 'date',
    exampleLabel
  );
}

/**
 * Serializable format items for one family — mirrors buildMenuItems() but emits
 * plain { label, action } / { separator: true } objects (no closures) so the tree
 * can be sent over IPC to the Electron main process for the native Format menu.
 */
function serializeFormatItems(filterFn, groupFn, labelFn) {
  if (!ensureFormatCatalogSync() || formatCatalog.length === 0) {
    return [];
  }
  const wItems = [];
  let wLastGroup = null;
  for (let wIndex = 0; wIndex < formatCatalog.length; wIndex++) {
    const wEntry = formatCatalog[wIndex];
    if (!filterFn(wEntry)) {
      continue;
    }
    const wGroup = groupFn(wEntry);
    if (wLastGroup !== null && wGroup !== wLastGroup) {
      wItems.push({ separator: true });
    }
    wLastGroup = wGroup;
    wItems.push({ label: labelFn(wEntry), action: `format:apply:${wIndex}` });
  }
  return wItems;
}

/**
 * Full number-format tree (all families) for the native desktop menu.
 * Each leaf action id (format:apply:N) is handled by the same renderer path as
 * the web menu (see SkSpreadSheet.handleSpreadsheetMenuAction).
 */
export function buildNativeFormatMenuTree() {
  return {
    number: serializeFormatItems((e) => e.family === 'Numeric', () => 'Numeric', (e) => e.label),
    currency: serializeFormatItems((e) => e.family === ACCOUNTING_FAMILY, () => ACCOUNTING_FAMILY, (e) => e.label),
    percent: serializeFormatItems((e) => e.family === PERCENT_FAMILY, () => PERCENT_FAMILY, exampleLabel),
    scientific: serializeFormatItems((e) => e.family === SCIENTIFIC_FAMILY, () => SCIENTIFIC_FAMILY, exampleLabel),
    dateTime: serializeFormatItems((e) => e.family === DATE_FAMILY, (e) => e.dateGroup || 'date', exampleLabel),
  };
}

export async function applyNumberFormatByIndex(spInterface, index) {
  const wEntry = formatCatalog[index];
  if (!wEntry || !spInterface) {
    return false;
  }
  const wFormatString = `"${wEntry.key}"`;
  spInterface.setExtraUndo && spInterface.setExtraUndo();
  const wRef = spInterface.selectstr();
  window.SkUISpreadSheet.applyFormatString(wRef, wFormatString);
  await spInterface.reloadView();
  return true;
}
