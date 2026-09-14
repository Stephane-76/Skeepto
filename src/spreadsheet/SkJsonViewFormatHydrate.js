//=============================================================================
// Expand JsonView formats[] entries (f_i) onto cells — required before canvas/PDF paint.
//=============================================================================

/**
 * @param {object | null | undefined} sUI — parsed JsonView
 */
export function hydrateJsonViewCellFormats(sUI) {
  if (sUI == null || !Array.isArray(sUI.formats) || sUI.formats.length === 0) {
    return;
  }
  const rows = Array.isArray(sUI.rows) ? sUI.rows : [];
  for (const wRow of rows) {
    const cells = Array.isArray(wRow?.cells) ? wRow.cells : [];
    for (const wCell of cells) {
      if (wCell == null || wCell.f_i == null) {
        continue;
      }
      const wFmt = sUI.formats[wCell.f_i];
      if (wFmt == null || typeof wFmt !== "object") {
        continue;
      }
      const wHadValue = Object.prototype.hasOwnProperty.call(wCell, "f_value");
      const wHadMo = Object.prototype.hasOwnProperty.call(wCell, "f_mo");
      const wHadCf = Object.prototype.hasOwnProperty.call(wCell, "c_cf");
      const wSavedValue = wCell.f_value;
      const wSavedMo = wCell.f_mo;
      const wSavedCf = wCell.c_cf;
      Object.assign(wCell, wFmt);
      if (wHadValue) {
        wCell.f_value = wSavedValue;
      } else {
        delete wCell.f_value;
      }
      if (wHadMo && wSavedMo != null && String(wSavedMo) !== "") {
        wCell.f_mo = wSavedMo;
      } else {
        delete wCell.f_mo;
      }
      if (wHadCf) {
        wCell.c_cf = wSavedCf;
      } else {
        delete wCell.c_cf;
      }
      delete wCell.f_i;
    }
  }
}
