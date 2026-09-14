//=============================================================================
// View zoom — user zoom (menu %) vs sheet display scale (Excel parity).
//=============================================================================

/**
 * Menu 100% → CSS zoom on HiDPI (Retina Mac). Tuned empirically vs Excel desktop at 100%.
 * Not shown in the View menu %.
 */
const EXCEL_VIEW_BASELINE_SCALE = 0.75;

/**
 * Excel desktop at 100% renders smaller than 1:1 browser CSS px on Retina.
 * @returns {number}
 */
export function excelViewBaselineScale() {
    if (typeof window === "undefined") {
        return 1;
    }
    const wDpr = window.devicePixelRatio || 1;
    if (wDpr <= 1) {
        return 1;
    }
    return EXCEL_VIEW_BASELINE_SCALE;
}

/**
 * CSS zoom for the whole sheet (.SkSpreadSheet): menu zoom × Excel baseline.
 * @param {number} userZoom m_Zoom from the View menu (1 = 100%).
 * @returns {number}
 */
export function displayZoomFromUserZoom(userZoom) {
    const wUser = Math.max(Number(userZoom) || 1, 0.001);
    return wUser * excelViewBaselineScale();
}

/**
 * Screen ↔ layout px when an ancestor uses CSS zoom or transform scale.
 * @param {HTMLElement} sEl
 * @returns {{ x: number, y: number }}
 */
export function layoutToScreenScale(sEl) {
    if (!sEl) {
        return { x: 1, y: 1 };
    }
    const wRect = sEl.getBoundingClientRect();
    const wLayoutW = sEl.offsetWidth || wRect.width || 1;
    const wLayoutH = sEl.offsetHeight || wRect.height || 1;
    const wRectW = wRect.width || wLayoutW;
    const wRectH = wRect.height || wLayoutH;
    return {
        x: wRectW / wLayoutW,
        y: wRectH / wLayoutH,
    };
}

/**
 * Pointer position in element layout space (matches JsonView / grid math).
 * @param {HTMLElement} sEl
 * @param {number} sClientX
 * @param {number} sClientY
 * @returns {{ x: number, y: number }}
 */
export function pointerToLayoutPx(sEl, sClientX, sClientY) {
    if (!sEl) {
        return { x: 0, y: 0 };
    }
    const wRect = sEl.getBoundingClientRect();
    const wScale = layoutToScreenScale(sEl);
    return {
        x: (sClientX - wRect.left) / wScale.x,
        y: (sClientY - wRect.top) / wScale.y,
    };
}
