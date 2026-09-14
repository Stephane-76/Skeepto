/**
 * JsonView string cells: `f_value` may be a shortened prefix of the literal `c_v`
 * (engine/format edge cases). Prefer the full literal when it clearly extends `f_value`.
 *
 * @param {{ c_t?: string, c_v?: unknown, f_value?: unknown }} cell
 * @returns {string|undefined} Full literal to draw when rule applies; otherwise undefined (caller uses f_value).
 */
export function jsonViewStringCellLiteralPrefer(cell) {
  if (!cell || cell.c_t !== 's') return undefined;
  const literal = cell.c_v;
  if (typeof literal !== 'string' || literal.length === 0) return undefined;
  const fvRaw = typeof cell.f_value === 'string' ? cell.f_value : '';
  const fv = fvRaw.trim();
  const lit = literal.trim();
  if (!fv || (lit.length > fv.length && lit.toLowerCase().startsWith(fv.toLowerCase()))) {
    return literal;
  }
  return undefined;
}

/** True when Wasm GetInputValue did not return usable inplace text. */
export function isUnusableInplaceWasmText(value) {
  if (value === null || value === undefined) {
    return true;
  }
  const wText = String(value).trim();
  return (
    wText === '' ||
    wText === 'None' ||
    wText === 'Null' ||
    wText === 'null' ||
    wText === 'Error Class'
  );
}

/**
 * Display text for a JsonView cell — same rules as the grid canvas (f_value first).
 *
 * @param {{ c_t?: string, c_v?: unknown, f_value?: unknown }} cell
 * @returns {string}
 */
export function jsonViewCellDisplayText(cell) {
  const preferLit = jsonViewStringCellLiteralPrefer(cell);
  if (preferLit !== undefined) {
    return preferLit;
  }
  if (cell && cell.hasOwnProperty('f_value') && cell.f_value != null && String(cell.f_value) !== '') {
    return String(cell.f_value);
  }
  if (cell && cell.hasOwnProperty('c_v') && cell.c_v != null && cell.c_t !== 'c') {
    const cv = cell.c_v;
    if (typeof cv === 'string' || typeof cv === 'number' || typeof cv === 'boolean') {
      return String(cv);
    }
  }
  return '';
}
