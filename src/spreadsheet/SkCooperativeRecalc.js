/**
 * Cooperative recalc: yields to the browser between WASM ReduceStep calls.
 */

export const SK_RECALC_UI_DELAY_MS = 50;

// recalculateAllCooperativeProgress() is O(n) in the engine (it walks the whole
// remaining path list). Polling it every step dominates the cost on very large
// recalcs (millions of cells) and makes the % look frozen. Poll it on this time
// interval instead; stepping itself stays cheap and keeps advancing.
export const SK_RECALC_PROGRESS_POLL_MS = 250;

export function isCooperativeRecalcAvailable() {
    const wUi = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
    return (
        wUi != null
        && typeof wUi.beginRecalculateAllCooperative === "function"
        && typeof wUi.stepRecalculateAllCooperative === "function"
        && typeof wUi.setCooperativeCalculateEnabled === "function"
    );
}

/**
 * Advance an already-started cooperative session (full workbook or cell-edit graph).
 *
 * @param {{ budgetMs?: number, onProgress?: (percent: number) => void }} [options]
 */
export async function runCooperativeRecalculateSteps(options = {}) {
    const wBudgetMs = options.budgetMs != null ? options.budgetMs : 8;
    const wOnProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    const wUi = window.SkUISpreadSheet;

    if (!isCooperativeRecalcAvailable()) {
        return;
    }
    if (!wUi.isRecalculateAllCooperativeActive()) {
        wOnProgress?.(100);
        return;
    }

    // Throttle the O(n) progress query (see SK_RECALC_PROGRESS_POLL_MS).
    let wLastPollAt = 0;
    const wPoll = (force) => {
        if (!wOnProgress) return;
        const wNow = Date.now();
        if (!force && wNow - wLastPollAt < SK_RECALC_PROGRESS_POLL_MS) return;
        wLastPollAt = wNow;
        wOnProgress(wUi.recalculateAllCooperativeProgress());
    };

    wPoll(true);
    await new Promise((resolve) => requestAnimationFrame(resolve));

    return new Promise((resolve, reject) => {
        const tick = () => {
            try {
                const wDone = wUi.stepRecalculateAllCooperative(wBudgetMs);
                if (wDone) {
                    wOnProgress?.(100);
                    resolve();
                    return;
                }
                wPoll(false);
                setTimeout(tick, 0);
            } catch (wErr) {
                reject(wErr);
            }
        };
        setTimeout(tick, 0);
    });
}

/**
 * Run RecalculateAll in time-budgeted steps.
 * Falls back to synchronous recalculateAll when the WASM build lacks cooperative APIs.
 *
 * @param {{ budgetMs?: number, onProgress?: (percent: number) => void }} [options]
 */
export async function runCooperativeRecalculateAll(options = {}) {
    const wOnProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    const wUi = window.SkUISpreadSheet;

    if (!isCooperativeRecalcAvailable()) {
        if (typeof wUi?.recalculateAll === "function") {
            wOnProgress?.(0);
            await new Promise((resolve) => requestAnimationFrame(resolve));
            wUi.recalculateAll();
            wOnProgress?.(100);
        }
        return;
    }

    wUi.beginRecalculateAllCooperative();
    await runCooperativeRecalculateSteps(options);
}

/**
 * Apply a cell mutation with cooperative dependent recalc when WASM supports it.
 *
 * @param {() => boolean} applyMutation synchronous WASM call (e.g. value / attribute)
 * @param {{ budgetMs?: number, onProgress?: (percent: number) => void }} [options]
 * @returns {boolean}
 */
export async function runCooperativeValueMutation(applyMutation, options = {}) {
    const wUi = window.SkUISpreadSheet;
    const wUseCoop = isCooperativeRecalcAvailable();

    if (wUseCoop) {
        wUi.setCooperativeCalculateEnabled(true);
    }
    let wOk = false;
    try {
        wOk = applyMutation() === true;
        if (wOk && wUseCoop && wUi.isRecalculateAllCooperativeActive()) {
            await runCooperativeRecalculateSteps(options);
        }
    } finally {
        if (wUseCoop) {
            wUi.setCooperativeCalculateEnabled(false);
        }
    }
    return wOk;
}
