/**
 * Cooperative _Pressure generation: yields to the browser between WASM step calls
 * so the UI can show a live progress %, then runs the (blocking) JsonEnd finalize.
 * Mirrors SkCooperativeRecalc.
 */

export function isCooperativePressureAvailable() {
    const wUi = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
    return (
        wUi != null
        && typeof wUi.hasCooperativePressure === "function"
        && wUi.hasCooperativePressure()
    );
}

/**
 * Run _Pressure with cooperative, row-budgeted generation steps.
 * Falls back to the blocking pressure() when the WASM build lacks the cooperative APIs.
 *
 * @param {number} rows target row count
 * @param {number} cols target column count
 * @param {{ sheet?: string, rowBudget?: number, onProgress?: (percent:number)=>void, onFinalize?: ()=>void }} [options]
 */
export async function runCooperativePressure(rows, cols, options = {}) {
    const wSheet = options.sheet != null ? options.sheet : "";
    const wRowBudget = options.rowBudget != null ? options.rowBudget : 2000;
    const wOnProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    const wOnFinalize = typeof options.onFinalize === "function" ? options.onFinalize : null;
    const wUi = window.SkUISpreadSheet;

    if (!isCooperativePressureAvailable()) {
        // Blocking fallback (older WASM build): single call, no live %.
        wOnProgress?.(0);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        wUi.pressure(rows, cols, wSheet);
        wOnProgress?.(100);
        return;
    }

    wUi.beginPressureCooperative(rows, cols, wSheet);
    wOnProgress?.(wUi.pressureCooperativeProgress());
    await new Promise((resolve) => requestAnimationFrame(resolve));

    // Generation phase: step + yield until the whole grid is queued.
    await new Promise((resolve, reject) => {
        const tick = () => {
            try {
                const wDone = wUi.stepPressureCooperative(wRowBudget);
                wOnProgress?.(wUi.pressureCooperativeProgress());
                if (wDone) {
                    resolve();
                    return;
                }
                setTimeout(tick, 0);
            } catch (wErr) {
                reject(wErr);
            }
        };
        setTimeout(tick, 0);
    });

    // Finalize phase: blocking JsonEnd (batch compile + cold calculate). Push the bar to
    // 100% and switch the banner to a "finalizing" state, then FORCE an actual paint before
    // the blocking call freezes the renderer. A single requestAnimationFrame is not always
    // painted in a production build, which is what left the bar stuck at a stale % during
    // the freeze. Two frames + a short timeout give the compositor time to draw.
    wOnProgress?.(100);
    wOnFinalize?.();
    await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 80))),
    );
    wUi.endPressureCooperative();
}
