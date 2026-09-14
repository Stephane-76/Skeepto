//=============================================================================
// Workbook/sheet/range → JsonView → canvas JPEG/Blob (WYSIWYG raster export).
//=============================================================================

import {
  DEFAULT_EXPORT_DPR,
  JSON_VIEW_EXTENT_CAP_PX,
  canvasToDataUrlSync,
  computeRangePaintLayout,
  renderViewToCanvas,
  sheetScrollOriginPx,
} from './pdf/SkJsonViewRasterExport.js';
import { resolveRangeExportInkPlan } from './pdf/SkPaintCellClassInk.js';
import {
  ensureSpreadsheetEngine,
  ensureWorkbookLoaded,
} from './SkWasmBootstrap.js';
import {
  parseRangeBounds,
  parseSkerRangeRef,
  resolveWorkbookPath,
} from './SkRangeToHtmlTable.js';

/** Default zoom for text-editor range snapshots (50%). */
export const DEFAULT_RANGE_IMAGE_ZOOM = 0.5;
/** JPEG quality for range snapshots (smaller/faster than PNG). */
export const DEFAULT_RANGE_IMAGE_JPEG_QUALITY = 0.92;
/** At or below this paint zoom, raster DPR drops to 1 (50% default → faster export). */
export const RANGE_IMAGE_LOW_ZOOM_DPR_THRESHOLD = 0.5;

const IMAGE_MIME = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

function resolveImageMime(format) {
  const key = String(format || 'jpeg').trim().toLowerCase();
  return IMAGE_MIME[key] || IMAGE_MIME.jpeg;
}

/** DPR 1 when zoom ≤ 50%; otherwise full export DPR (unless explicitly overridden). */
export function resolveRangeExportDpr(selection = {}) {
  if (selection.dpr != null && Number.isFinite(Number(selection.dpr))) {
    return Math.max(1, Number(selection.dpr));
  }
  const zoom = Number(selection.zoom);
  const effectiveZoom = Number.isFinite(zoom) ? zoom : DEFAULT_RANGE_IMAGE_ZOOM;
  return effectiveZoom <= RANGE_IMAGE_LOW_ZOOM_DPR_THRESHOLD ? 1 : DEFAULT_EXPORT_DPR;
}

function assertRangePixelExtent(viewW, viewH) {
  if (viewW > JSON_VIEW_EXTENT_CAP_PX || viewH > JSON_VIEW_EXTENT_CAP_PX) {
    throw new Error(
      `Range too large to rasterize (${Math.ceil(viewW)}×${Math.ceil(viewH)} px; max ${JSON_VIEW_EXTENT_CAP_PX}).`,
    );
  }
}

/** Sheet-pixel origin of a range viewport (for floating-object layout in embed export). */
async function resolveRangeViewportScrollOrigin(uiView, bounds, sheet) {
  const fromView = sheetScrollOriginPx(uiView);
  if (fromView.diffX > 0 || fromView.diffY > 0) {
    return fromView;
  }
  if (!bounds || !window.SkUISpreadSheet) {
    return fromView;
  }
  let diffX = 0;
  let diffY = 0;
  if (bounds.left > 1) {
    diffX = Number(window.SkUISpreadSheet.sumPixelWidth(1, bounds.left - 1, sheet)) || 0;
  }
  if (bounds.top > 1) {
    diffY = Number(window.SkUISpreadSheet.sumPixelHeight(1, bounds.top - 1, sheet)) || 0;
  }
  return { diffX, diffY };
}

/**
 * @param {object} uiView — hydrated JsonView for the range
 * @param {object | null} spInterface — optional; full grid paint when open
 * @param {number} viewW
 * @param {number} viewH
 * @param {object} [options]
 * @returns {Promise<{ canvas: HTMLCanvasElement, width: number, height: number, paintScale: number }>}
 */
export async function jsonViewToRasterCanvas(uiView, spInterface, viewW, viewH, options = {}) {
  const layout = computeRangePaintLayout(viewW, viewH, options);
  const dpr = options.dpr ?? resolveRangeExportDpr(options);
  const scrollOrigin = options.scrollOrigin ?? sheetScrollOriginPx(uiView);
  const inkPlan = await resolveRangeExportInkPlan(uiView, spInterface ?? null, {
    diffX: scrollOrigin.diffX,
    diffY: scrollOrigin.diffY,
    viewW,
    viewH,
  });
  const canvas = await renderViewToCanvas(
    uiView,
    spInterface ?? null,
    layout.sheetViewW,
    layout.sheetViewH,
    layout.canvasW,
    layout.canvasH,
    layout.paintScale,
    dpr,
    scrollOrigin,
    {},
    {
      needsClassInk: inkPlan.needsClassInk,
      skipFloatingObjects: inkPlan.skipFloatingObjects,
      prefetchedFloatingObjects: inkPlan.prefetchedFloatingObjects,
    },
  );
  return {
    canvas,
    width: layout.canvasW,
    height: layout.canvasH,
    paintScale: layout.paintScale,
  };
}

/**
 * @param {{ workbookPath: string, sheet: string, range: string, documentPath?: string, spInterface?: object, zoom?: number, maxWidth?: number, maxHeight?: number, allowUpscale?: boolean, dpr?: number, format?: 'png' | 'jpeg' | 'webp', jpegQuality?: number }} selection
 */
export async function rangeSelectionToImage(selection) {
  const workbookInput = String(selection?.workbookPath || '').trim();
  const sheet = String(selection?.sheet || '').trim();
  const range = String(selection?.range || '').trim();
  const documentPath = String(selection?.documentPath || '').trim();
  const spInterface = selection?.spInterface ?? null;

  if (!workbookInput) {
    throw new Error('Enter the workbook path.');
  }
  if (!sheet) {
    throw new Error('Choose a sheet.');
  }
  if (!range) {
    throw new Error('Enter the range (e.g. B2:J10).');
  }

  const bounds = parseRangeBounds(range);
  if (!bounds) {
    throw new Error(`Invalid A1 range: ${range}`);
  }

  const resolvedWorkbook = resolveWorkbookPath(workbookInput, documentPath);
  const mimeType = resolveImageMime(selection?.format);
  const jpegQuality =
    mimeType === IMAGE_MIME.jpeg
      ? Math.max(0.1, Math.min(1, Number(selection?.jpegQuality) || DEFAULT_RANGE_IMAGE_JPEG_QUALITY))
      : undefined;
  const exportDpr = resolveRangeExportDpr(selection);

  await ensureWorkbookLoaded(resolvedWorkbook, { skipRecalculate: true });
  window.SkUISpreadSheet.setActiveSheet(sheet);

  const viewH = Number(
    window.SkUISpreadSheet.sumPixelHeight(bounds.top, bounds.bottom, sheet),
  );
  const viewW = Number(
    window.SkUISpreadSheet.sumPixelWidth(bounds.left, bounds.right, sheet),
  );
  if (!(viewH > 0) || !(viewW > 0)) {
    throw new Error('Unable to compute the pixel size of the range.');
  }
  assertRangePixelExtent(viewW, viewH);

  const raw = window.SkUISpreadSheet.jsonView(
    bounds.top,
    bounds.left,
    viewH,
    viewW,
    0,
    0,
    sheet,
    true,
  );
  if (!raw) {
    throw new Error('JsonView returned an empty response.');
  }

  let uiView;
  try {
    uiView = JSON.parse(raw);
  } catch (_err) {
    throw new Error('JsonView: invalid JSON.');
  }

  const scrollOrigin = await resolveRangeViewportScrollOrigin(uiView, bounds, sheet);
  const raster = await jsonViewToRasterCanvas(uiView, spInterface, viewW, viewH, {
    zoom: selection?.zoom,
    maxWidth: selection?.maxWidth,
    maxHeight: selection?.maxHeight,
    allowUpscale: selection?.allowUpscale,
    dpr: exportDpr,
    scrollOrigin,
  });

  const dataUrl = canvasToDataUrlSync(raster.canvas, mimeType, jpegQuality);

  return {
    blob: null,
    dataUrl,
    canvas: raster.canvas,
    width: raster.width,
    height: raster.height,
    paintScale: raster.paintScale,
    bounds,
    source: {
      workbookPath: workbookInput,
      sheet,
      range,
    },
  };
}

/**
 * Legacy single-string ref (Sheet!A1:B2 or dotted URI form).
 * @param {string} ref
 * @param {object} [options]
 */
export async function rangeRefToImage(ref, options = {}) {
  const parsed = parseSkerRangeRef(ref);
  if (!parsed) {
    throw new Error(`Invalid range reference: ${ref}`);
  }

  let workbookPath = parsed.workbookPath || options.workbookPath || '';
  await ensureSpreadsheetEngine();

  if (workbookPath) {
    workbookPath = resolveWorkbookPath(workbookPath, options.documentPath || '');
    await ensureWorkbookLoaded(workbookPath);
  } else {
    workbookPath = window.SkUISpreadSheet.getActiveWorkBook();
    if (!workbookPath) {
      throw new Error('No workbook in memory — enter a .sker path.');
    }
  }

  let sheet = parsed.sheet;
  if (!sheet) {
    sheet = window.SkUISpreadSheet.getActiveSheet();
  }
  if (!sheet) {
    throw new Error('Choose a sheet.');
  }

  return rangeSelectionToImage({
    workbookPath,
    sheet,
    range: parsed.range,
    documentPath: options.documentPath || '',
    spInterface: options.spInterface,
    zoom: options.zoom,
    maxWidth: options.maxWidth,
    maxHeight: options.maxHeight,
    allowUpscale: options.allowUpscale,
    dpr: options.dpr,
    format: options.format,
    jpegQuality: options.jpegQuality,
  });
}
