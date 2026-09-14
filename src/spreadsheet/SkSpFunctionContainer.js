//=============================================================================
// SkFunction
// Secure JavaScript functions for Spreadsheet (WASM bridge + sandbox).
//=============================================================================

import {
    compilePureUserFunction,
    invokeUserFunction,
    runUserFunctionRegistrationScript,
    testUserFunctionInWorker,
    USER_FUNCTION_INVOKE_DEADLINE_MS,
    validateUserFunctionSpec,
} from "./SkUserFunctionSandbox.js";

function skGetValue(value) {
    switch (value.t) {
        case "n":
            return null;
        case "s":
            return value.v;
        case "b":
            return value.v;
        case "i":
            return value.v;
        case "d":
            return value.v;
        case "c": {
            const wClassObj = JSON.parse(value.v);
            return wClassObj;
        }
        default:
            return value.v;
    }
}

function formatUsDate(sDate) {
    const wMonth = sDate.getMonth() + 1;
    const wDay = sDate.getDate();
    const wYear = sDate.getFullYear();
    return `${wMonth}/${wDay}/${wYear}`;
}

export function skSetValue(value) {
    const wReturnObj = {};
    if (value == null) {
        wReturnObj.t = "n";
        wReturnObj.v = null;
    } else if (typeof value === "string") {
        wReturnObj.t = "s";
        wReturnObj.v = value;
    } else if (typeof value === "boolean") {
        wReturnObj.t = "b";
        wReturnObj.v = value;
    } else if (typeof value === "number") {
        if (Number.isInteger(value)) {
            wReturnObj.t = "i";
            wReturnObj.v = value;
        } else {
            wReturnObj.t = "d";
            wReturnObj.v = value;
        }
    } else if (value instanceof Date) {
        wReturnObj.t = "da";
        wReturnObj.v = formatUsDate(value);
    } else {
        wReturnObj.t = "n";
        wReturnObj.v = null;
    }
    return wReturnObj;
}

export function skSetError(sMessage, sCode = 0) {
    return {
        t: "e",
        v: {
            c: sCode,
            m: String(sMessage || "User function error"),
        },
    };
}

/** WASM/embind returns tBool as 0/1, not always literal true/false. */
export function isWasmOk(sValue) {
    return sValue === true || sValue === 1;
}

function resolveCellFormulaFromWorkbookJson(sCell, sSharedFormulas) {
    if (sCell == null || typeof sCell !== "object") {
        return "";
    }
    if (typeof sCell.f === "string" && sCell.f.length > 0) {
        return sCell.f;
    }
    if (Number.isInteger(sCell.fi) && Array.isArray(sSharedFormulas)) {
        const wShared = sSharedFormulas[sCell.fi];
        if (typeof wShared === "string") {
            return wShared;
        }
    }
    if (sCell.t === "s" && typeof sCell.v === "string" && sCell.v.startsWith("=")) {
        return sCell.v.slice(1);
    }
    return "";
}

export function formulaUsesRegisteredNames(sFormula, sRegisteredNames) {
    const wUpper = String(sFormula || "").toUpperCase();
    if (!wUpper) {
        return false;
    }
    for (const wName of sRegisteredNames) {
        if (wUpper.includes(`${wName}(`)) {
            return true;
        }
    }
    return false;
}

// Generic Function Call Back C++
function genericFunction(arg) {
    try {
        const wParsedArg = JSON.parse(arg);
        const wJavaArg = [];
        for (let wIndex = 0; wIndex < wParsedArg.a.length; wIndex += 1) {
            wJavaArg.push(skGetValue(wParsedArg.a[wIndex]));
        }
        const wContainer = typeof window !== "undefined" ? window.FunctionContainer : null;
        if (wContainer == null) {
            return JSON.stringify(skSetError("FunctionContainer is not initialized."));
        }
        const wFunctionObj = wContainer.getFunction(wParsedArg.n);
        if (typeof wFunctionObj !== "function") {
            return JSON.stringify(skSetError(`Unknown user function: ${wParsedArg.n}`));
        }
        const wResult = invokeUserFunction(
            wFunctionObj,
            wJavaArg,
            USER_FUNCTION_INVOKE_DEADLINE_MS
        );
        return JSON.stringify(skSetValue(wResult));
    } catch (wErr) {
        return JSON.stringify(skSetError(wErr.message || String(wErr)));
    }
}

export function mySum(a, b) {
    return (a + b) * 2;
}

export function yourSum(a, b) {
    return a * b + a * b;
}

export function myIf(a, b, c) {
    if (a) {
        return b;
    }
    return c;
}

// Function names already pushed to the shared WASM FunctionDictionary (page session).
const gWasmBuiltInFunctionsRegistered = new Set();

// Function Container =========================================================
export class SkFunctionContainer {
    constructor() {
        this.functions = {};
        this.functionMeta = {};
        if (typeof window !== "undefined") {
            window.GenericFunction = genericFunction;
            window.FunctionContainer = this;
        }
        this.registerBuiltInFunctions();
    }

    registerBuiltInFunctions() {
        this.registerTrustedFunction("MYSUM", "My sum", "JavaScript", mySum, 2);
        this.registerTrustedFunction("YOURSUM", "Your Sum", "JavaScript", yourSum, 2);
        this.registerTrustedFunction("MYIF", "My If", "JavaScript", myIf, 3);
    }

    /** Trusted built-ins registered at startup (no sandbox recompile). */
    registerTrustedFunction(sName, sLabel, sFamily, sFunctionObj, sNbArg) {
        const wName = String(sName || "").toUpperCase();
        this.functions[wName] = sFunctionObj;
        this.functionMeta[wName] = {
            name: wName,
            label: sLabel,
            family: sFamily,
            nbArg: sNbArg,
            trusted: true,
        };
        if (typeof window === "undefined" || !window.SkUISpreadSheet) {
            return;
        }
        // Shared WASM dictionary survives spreadsheet remounts — register once per name.
        if (gWasmBuiltInFunctionsRegistered.has(wName)) {
            return;
        }
        try {
            const wOk = window.SkUISpreadSheet.addFunction(wName, sLabel, sFamily, sNbArg);
            if (isWasmOk(wOk)) {
                gWasmBuiltInFunctionsRegistered.add(wName);
            } else {
                // Already present from a previous sheet open in this session.
                gWasmBuiltInFunctionsRegistered.add(wName);
            }
        } catch (wErr) {
            console.warn("[SkFunctionContainer] built-in AddFunction failed:", wName, wErr);
        }
    }

    /**
     * Secure API for user-defined functions (validated + sandboxed).
     * @returns {Promise<object>} registered metadata
     */
    async registerUserFunction(sSpec) {
        const wSpec = validateUserFunctionSpec(sSpec);
        if (typeof window === "undefined" || window.SkUISpreadSheet == null) {
            throw new Error("SkUISpreadSheet is not ready. Open a spreadsheet first.");
        }
        await testUserFunctionInWorker(wSpec.source, wSpec.nbArg);
        const wCompiled = compilePureUserFunction(wSpec.source);
        const wOk = window.SkUISpreadSheet.addFunction(
            wSpec.name,
            wSpec.label,
            wSpec.family,
            wSpec.nbArg
        );
        if (!isWasmOk(wOk)) {
            throw new Error(`Function "${wSpec.name}" already exists or is reserved.`);
        }
        this.functions[wSpec.name] = wCompiled;
        this.functionMeta[wSpec.name] = {
            ...wSpec,
            trusted: false,
        };
        return { ...wSpec };
    }

    /**
     * Parse and run a Monaco script that calls registerUserFunction({...}).
     * @returns {Promise<object[]>} list of registered specs
     */
    async runRegistrationScript(sScript) {
        const wSpecs = [];
        runUserFunctionRegistrationScript(sScript, (sSpec) => {
            wSpecs.push(validateUserFunctionSpec(sSpec));
        });
        const wResults = [];
        for (const wSpec of wSpecs) {
            wResults.push(await this.registerUserFunction(wSpec));
        }
        await this.recompileFormulasUsingUserFunctions(wResults.map((wEntry) => wEntry.name));
        return wResults;
    }

    /**
     * Re-run CompilCell for workbook formulas that call newly registered user functions.
     * Required when the formula was entered before Run (compile failed with "not a function").
     */
    async recompileFormulasUsingUserFunctions(sRegisteredNames) {
        if (typeof window === "undefined" || window.SkUISpreadSheet == null) {
            return 0;
        }
        const wNames = (sRegisteredNames || [])
            .map((wName) => String(wName || "").trim().toUpperCase())
            .filter(Boolean);
        if (wNames.length === 0) {
            return 0;
        }

        const wUri = window.SkUISpreadSheet.getActiveWorkBook();
        const wJsonRaw = window.SkUISpreadSheet.writeJson(wUri);
        const wWorkbook =
            typeof wJsonRaw === "string" ? JSON.parse(wJsonRaw) : wJsonRaw;
        const wSharedFormulas = Array.isArray(wWorkbook?.fi) ? wWorkbook.fi : [];
        let wCount = 0;

        for (const wSheet of wWorkbook?.sheets || []) {
            const wSheetName = typeof wSheet?.name === "string" ? wSheet.name : "";
            for (const wCell of wSheet?.cells || []) {
                const wRef = typeof wCell?.c === "string" ? wCell.c : "";
                if (!wRef) {
                    continue;
                }
                const wFormula = resolveCellFormulaFromWorkbookJson(wCell, wSharedFormulas);
                if (!formulaUsesRegisteredNames(wFormula, wNames)) {
                    continue;
                }
                window.SkUISpreadSheet.value(wRef, `=${wFormula}`, wSheetName);
                wCount += 1;
            }
        }
        return wCount;
    }

    /** @deprecated Use registerUserFunction — kept for internal/trusted paths. */
    async addFunction(sName, sLabel, sFamily, sFunctionObj, sNbArg) {
        const wOk = window.SkUISpreadSheet.addFunction(sName, sLabel, sFamily, sNbArg);
        if (!isWasmOk(wOk)) {
            throw new Error(`Function "${sName}" already exists or is reserved.`);
        }
        this.functions[sName] = sFunctionObj;
        this.functionMeta[sName] = {
            name: sName,
            label: sLabel,
            family: sFamily,
            nbArg: sNbArg,
            trusted: true,
        };
        return true;
    }

    getFunction(sName) {
        const wName = String(sName || "").toUpperCase();
        return this.functions[wName] ?? this.functions[sName];
    }

    getFunctionMeta(sName) {
        const wName = String(sName || "").toUpperCase();
        return this.functionMeta[wName] || this.functionMeta[sName] || null;
    }

    listUserFunctions() {
        return Object.values(this.functionMeta).filter((wEntry) => wEntry.trusted !== true);
    }
}
