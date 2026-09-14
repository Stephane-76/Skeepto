//=============================================================================
// JsonView → off-screen canvas raster (shared by PDF export and range-to-image).
//=============================================================================

import { hydrateJsonViewCellFormats } from "../SkJsonViewFormatHydrate.js";
import { paintCellStack, resolveMergeBackgroundColors } from "../SkPaintCellStack.js";
import SkSpCellCanvas from "../SkSpCellCanvas.js";
import { jsonViewNeedsClassInk, paintCellClassInk } from "./SkPaintCellClassInk.js";

export const DEFAULT_EXPORT_DPR = 2;
export const JSON_VIEW_EXTENT_CAP_PX = 12000;
/** Flat export background when alpha is unsupported (JPEG). */
export const DEFAULT_OPAQUE_EXPORT_BG = "#ffffff";

/** Composite canvas onto an opaque background (JPEG has no alpha channel). */
export function flattenCanvasOpaque(canvas, background = DEFAULT_OPAQUE_EXPORT_BG) {
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
    return canvas;
  }
  const flat = document.createElement("canvas");
  flat.width = canvas.width;
  flat.height = canvas.height;
  const ctx = flat.getContext("2d");
  if (!ctx) {
    return canvas;
  }
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  return flat;
}

function canvasForMimeExport(canvas, mimeType) {
  const type = String(mimeType || "image/png").trim().toLowerCase();
  if (type === "image/jpeg" || type === "image/jpg") {
    return flattenCanvasOpaque(canvas);
  }
  return canvas;
}

/**
 * Sheet-pixel origin of the viewport left/top edge.
 * scrollLeftPx/scrollTopPx are the start of topcol/toprow; negative dX/dY is the
 * intra-column/row clip (same as SkSpInterface._viewOriginSheetPx).
 */
export function sheetScrollOriginPx(uiView) {
  let diffX = Number(uiView?.scrollLeftPx);
  let diffY = Number(uiView?.scrollTopPx);
  if (!Number.isFinite(diffX)) {
    diffX = 0;
  }
  if (!Number.isFinite(diffY)) {
    diffY = 0;
  }
  const dX = Number(uiView?.dX ?? 0);
  const dY = Number(uiView?.dY ?? 0);
  if (dX < 0) {
    diffX -= dX;
  }
  if (dY < 0) {
    diffY -= dY;
  }
  return { diffX, diffY };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} [mimeType]
 * @param {number} [quality] — 0–1 for jpeg/webp
 */
export function canvasToBlob(canvas, mimeType = "image/png", quality) {
  return new Promise((resolve, reject) => {
    const source = canvasForMimeExport(canvas, mimeType);
    source.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Canvas export failed"));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

export async function canvasToPngBytes(canvas) {
  const blob = await canvasToBlob(canvas, "image/png");
  return new Uint8Array(await blob.arrayBuffer());
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Blob data URL export failed"));
    reader.readAsDataURL(blob);
  });
}

export async function canvasToDataUrl(canvas, mimeType = "image/png", quality) {
  const blob = await canvasToBlob(canvas, mimeType, quality);
  return blobToDataUrl(blob);
}

/** Synchronous data URL — faster for small range snapshots (avoids Blob + FileReader). */
export function canvasToDataUrlSync(canvas, mimeType = "image/png", quality) {
  const source = canvasForMimeExport(canvas, mimeType);
  return source.toDataURL(mimeType, quality);
}

/** OOXML print scale — larger sheet viewport, paint scaled to fill drawable page (Excel-like). */
export function sheetViewportForPrintScale(pageW, pageH, scaleFactor) {
  const s = Math.max(0.1, Math.min(4, Number(scaleFactor) || 1));
  const pw = Math.max(1, Number(pageW) || 1);
  const ph = Math.max(1, Number(pageH) || 1);
  return {
    sheetW: Math.max(1, pw / s),
    sheetH: Math.max(1, ph / s),
    canvasW: pw,
    canvasH: ph,
    paintScale: s,
  };
}

export function computeFitPaintScale(
  contentWPx,
  contentHPx,
  canvasWPx,
  canvasHPx,
  fitPages = {},
  allowUpscale = false,
) {
  const cw = Math.max(1, Number(contentWPx) || 1);
  const ch = Math.max(1, Number(contentHPx) || 1);
  const pw = Math.max(1, Number(canvasWPx) || 1);
  const ph = Math.max(1, Number(canvasHPx) || 1);
  const sx = pw / cw;
  const sy = ph / ch;

  const wPages = Math.max(0, Math.round(Number(fitPages.fitToWidthPages) || 0));
  const hPages = Math.max(0, Math.round(Number(fitPages.fitToHeightPages) || 0));

  let fit = 1;
  if (wPages > 0 && hPages > 0) {
    fit = Math.min(sx / wPages, sy / hPages);
  } else if (wPages > 0) {
    fit = sx / wPages;
  } else if (hPages > 0) {
    fit = sy / hPages;
  } else {
    fit = Math.min(sx, sy);
  }
  if (!allowUpscale) {
    fit = Math.min(fit, 1);
  }
  return fit;
}

/**
 * Output canvas size + paint scale for a fixed sheet-pixel range.
 * @param {number} viewW — range width in sheet CSS px
 * @param {number} viewH — range height in sheet CSS px
 * @param {{ zoom?: number, maxWidth?: number, maxHeight?: number, allowUpscale?: boolean }} [options]
 */
export function computeRangePaintLayout(viewW, viewH, options = {}) {
  const vw = Math.max(1, Number(viewW) || 1);
  const vh = Math.max(1, Number(viewH) || 1);
  const maxW = Number(options.maxWidth);
  const maxH = Number(options.maxHeight);
  const hasMaxW = Number.isFinite(maxW) && maxW > 0;
  const hasMaxH = Number.isFinite(maxH) && maxH > 0;

  if (hasMaxW || hasMaxH) {
    const fitBoxW = hasMaxW ? maxW : vw;
    const fitBoxH = hasMaxH ? maxH : vh;
    const fit = computeFitPaintScale(
      vw,
      vh,
      fitBoxW,
      fitBoxH,
      {},
      options.allowUpscale === true,
    );
    return {
      sheetViewW: vw,
      sheetViewH: vh,
      canvasW: Math.max(1, Math.ceil(vw * fit)),
      canvasH: Math.max(1, Math.ceil(vh * fit)),
      paintScale: fit,
    };
  }

  const zoom = Math.max(0.01, Math.min(8, Number(options.zoom) || 1));
  return {
    sheetViewW: vw,
    sheetViewH: vh,
    canvasW: Math.max(1, Math.ceil(vw * zoom)),
    canvasH: Math.max(1, Math.ceil(vh * zoom)),
    paintScale: zoom,
  };
}

/**
 * Raster one JsonView viewport — SkSpGridCanvas.paintCellsForExport + paintCellClassInk.
 * @param {number} sheetViewW — JsonView width in sheet CSS px
 * @param {number} sheetViewH — JsonView height in sheet CSS px
 * @param {number} canvasW — output bitmap width (CSS px)
 * @param {number} canvasH — output bitmap height
 * @param {number} paintScale — ctx scale applied before paint
 * @param {{ horizontalCentered?: boolean, verticalCentered?: boolean }} [placement]
 */
export async function renderViewToCanvas(
  uiView,
  spInterface,
  sheetViewW,
  sheetViewH,
  canvasW,
  canvasH,
  paintScale,
  dpr,
  scrollOrigin = null,
  placement = {},
  inkOptions = {},
) {
  hydrateJsonViewCellFormats(uiView);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(canvasW * dpr));
  canvas.height = Math.max(1, Math.ceil(canvasH * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D unavailable");
  }
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvasW, canvasH);
  ctx.clip();
  const s = Number(paintScale) || 1;
  const inkW = Math.max(1, Number(sheetViewW) || 1) * s;
  const inkH = Math.max(1, Number(sheetViewH) || 1) * s;
  let offX = 0;
  let offY = 0;
  if (placement.horizontalCentered === true && inkW < canvasW) {
    offX = (canvasW - inkW) / 2;
  }
  if (placement.verticalCentered === true && inkH < canvasH) {
    offY = (canvasH - inkH) / 2;
  }
  if (offX !== 0 || offY !== 0) {
    ctx.translate(offX, offY);
  }
  if (Math.abs(s - 1) > 1e-6) {
    ctx.scale(s, s);
  }

  await resolveMergeBackgroundColors(uiView, spInterface);

  const grid = spInterface?.m_SkSpGridCanvas;
  if (grid != null && typeof grid.paintCellsForExport === "function") {
    await grid.paintCellsForExport(ctx, uiView, sheetViewW, sheetViewH);
  } else {
    paintCellStack(ctx, uiView, new SkSpCellCanvas(), { spInterface });
  }

  const origin = scrollOrigin ?? sheetScrollOriginPx(uiView);
  const wNeedsInk =
    inkOptions.needsClassInk === true
    || (inkOptions.needsClassInk !== false
      && jsonViewNeedsClassInk(uiView, inkOptions));
  if (wNeedsInk) {
    await paintCellClassInk(ctx, uiView, spInterface, {
      diffX: origin.diffX,
      diffY: origin.diffY,
      viewW: sheetViewW,
      viewH: sheetViewH,
      skipFloatingObjects: inkOptions.skipFloatingObjects === true,
      prefetchedFloatingObjects: inkOptions.prefetchedFloatingObjects,
    });
  }
  ctx.restore();
  return canvas;
}
