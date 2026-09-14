//=============================================================================
// sanitizeWorkbookForServerLoad.mjs
// Server WASM Check() fails when chart class attrs use raw R1C1 range formulas
// on anchored cells (spill / ClassAttribute loss). Prefer DATARANGE(Sheet!…)
// like _$$A hosts; strip R1C1 Title formulas to literals.
// Regression: TestSkCellClassAttribute::TestClassAttributeTitleRangeSpill.
//=============================================================================

const CHART_CLASS_NAMES = new Set([
    'SkCellClassPieChart',
    'SkCellClassLineChart',
]);

/** Range-backed chart attrs (not Title). */
const RANGE_CHART_ATTRS = new Set(['chartData', 'DataRange']);

/** Title must not carry range or R1C1 formulas on server load. */
const TITLE_ATTR = 'Title';

/**
 * @param {unknown} sValue attr.v e.g. '["C2:C7"]'
 * @returns {string} first A1 range or ""
 */
function firstRangeFromAttrValue(sValue) {
    if (typeof sValue !== 'string' || sValue.trim() === '') {
        return '';
    }
    try {
        const wParsed = JSON.parse(sValue);
        if (Array.isArray(wParsed) && typeof wParsed[0] === 'string') {
            return wParsed[0].trim();
        }
    } catch {
        return '';
    }
    return '';
}

/**
 * @param {object} sAttr
 * @param {string} sSheetName
 * @returns {boolean}
 */
function rewriteRangeChartAttrForServer(sAttr, sSheetName) {
    const wFormula = typeof sAttr.f === 'string' ? sAttr.f.trim() : '';
    if (!wFormula || !wFormula.includes(':') || /^DATARANGE\s*\(/i.test(wFormula)) {
        return false;
    }
    const wRange = firstRangeFromAttrValue(sAttr.v);
    if (!wRange || !sSheetName || sSheetName === '_$$A') {
        return false;
    }
    sAttr.f = `DATARANGE(${sSheetName}!${wRange})`;
    return true;
}

/**
 * @param {object} sAttr
 * @returns {boolean}
 */
function stripTitleFormulaForServer(sAttr) {
    const wFormula = typeof sAttr.f === 'string' ? sAttr.f.trim() : '';
    if (!wFormula) {
        return false;
    }
    if (wFormula.includes(':') || /R\[|C\[/.test(wFormula)) {
        delete sAttr.f;
        sAttr.t = 's';
        sAttr.v = typeof sAttr.v === 'string' ? sAttr.v : '';
        sAttr.e = 0;
        return true;
    }
    return false;
}

/**
 * @param {object} sCell
 * @param {string} sSheetName
 * @returns {boolean}
 */
function sanitizeChartClassCellForServer(sCell, sSheetName) {
    if (!sCell?.class || !CHART_CLASS_NAMES.has(sCell.class)) {
        return false;
    }
    const wAttrs = sCell?.cl?.a;
    if (!Array.isArray(wAttrs)) {
        return false;
    }
    let wChanged = false;
    for (const wAttr of wAttrs) {
        if (!wAttr || typeof wAttr.n !== 'string') {
            continue;
        }
        if (wAttr.n === TITLE_ATTR) {
            if (stripTitleFormulaForServer(wAttr)) {
                console.warn(
                    `[sanitizeWorkbook] ${sCell.c} ${sCell.class}.${wAttr.n}: `
                    + `strip formula for server load (keep literal)`,
                );
                wChanged = true;
            }
            continue;
        }
        if (RANGE_CHART_ATTRS.has(wAttr.n)) {
            if (rewriteRangeChartAttrForServer(wAttr, sSheetName)) {
                console.warn(
                    `[sanitizeWorkbook] ${sCell.c} ${sCell.class}.${wAttr.n}: `
                    + `→ DATARANGE(${sSheetName}!…) for server load`,
                );
                wChanged = true;
            }
        }
    }
    return wChanged;
}

/**
 * @param {unknown} sContent — workbook JSON string or object
 * @returns {string} sanitized JSON string
 */
export function sanitizeWorkbookForServerLoad(sContent) {
    let wDoc = sContent;
    if (typeof wDoc === 'string') {
        try {
            wDoc = JSON.parse(wDoc);
        } catch {
            return sContent;
        }
    }
    if (!wDoc || !Array.isArray(wDoc.sheets)) {
        return typeof sContent === 'string' ? sContent : JSON.stringify(sContent);
    }

    let wChanged = false;
    for (const wSheet of wDoc.sheets) {
        const wSheetName = typeof wSheet?.name === 'string' ? wSheet.name.trim() : '';
        const wCells = wSheet?.cells;
        if (!Array.isArray(wCells)) {
            continue;
        }
        for (const wCell of wCells) {
            if (sanitizeChartClassCellForServer(wCell, wSheetName)) {
                wChanged = true;
            }
        }
    }

    if (!wChanged) {
        return typeof sContent === 'string' ? sContent : JSON.stringify(sContent);
    }
    return JSON.stringify(wDoc);
}

export default sanitizeWorkbookForServerLoad;
