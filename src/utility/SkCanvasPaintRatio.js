//=============================================================================
// Canvas paint ratio — match the physical screen grid, capped for paint cost.
//=============================================================================

/** Upper bound on bitmap px per layout px (paint cost guard). */
const MAX_PAINT_RATIO = 2;

/**
 * Bitmap scale for spreadsheet canvases: bitmap px per layout px.
 *
 * The grid canvases sit inside `.SkSpreadSheet`, which carries a CSS `zoom`
 * (menu zoom x Excel Retina baseline). One layout px therefore covers
 * `displayZoom * devicePixelRatio` physical pixels, and that product is the
 * only ratio mapping one bitmap pixel onto one screen pixel. Any other value
 * makes the browser resample: glyphs soften and 1px gridlines land on
 * fractional device rows, so rows of identical height can end up drawn a
 * physical pixel apart.
 *
 * @param {number} [sDisplayZoom] CSS zoom applied to the sheet (1 when unzoomed).
 * @returns {number}
 */
export function resolveCanvasPaintRatio(sDisplayZoom = 1) {
  if (typeof window === "undefined") {
    return MAX_PAINT_RATIO;
  }
  const wDpr = window.devicePixelRatio || 1;
  const wZoom = Number(sDisplayZoom) > 0 ? Number(sDisplayZoom) : 1;
  // Floor at 1: below that the bitmap would lose layout resolution, and hairline
  // strokes drop out entirely.
  return Math.min(MAX_PAINT_RATIO, Math.max(1, wDpr * wZoom));
}

export { MAX_PAINT_RATIO };
