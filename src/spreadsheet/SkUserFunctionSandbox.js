//=============================================================================
// SkUserFunctionSandbox
// Secure compile / validate / invoke user-defined spreadsheet functions.
//=============================================================================

export const USER_FUNCTION_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;

export const USER_FUNCTION_ALLOWED_CAPABILITIES = Object.freeze(["pure"]);

/** Default wall-clock budget checked after each invocation (ms). */
export const USER_FUNCTION_INVOKE_DEADLINE_MS = 100;

/** Registration dry-run budget inside a Worker (ms). */
export const USER_FUNCTION_REGISTER_TEST_TIMEOUT_MS = 250;

const FORBIDDEN_SOURCE_PATTERNS = [
    /\beval\b/,
    /\bFunction\s*\(/,
    /\bimport\s*\(/,
    /\brequire\s*\(/,
    /\bfetch\b/,
    /\bXMLHttpRequest\b/,
    /\bwindow\b/,
    /\bdocument\b/,
    /\bglobalThis\b/,
    /\bprocess\b/,
    /\b__proto__\b/,
    /\bconstructor\s*\(/,
    /\basync\b/,
    /\bawait\b/,
    /\bPromise\b/,
    /\bWorker\b/,
    /\bSharedArrayBuffer\b/,
    /\bAtomics\b/,
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /\bindexedDB\b/,
];

const FORBIDDEN_SCRIPT_PATTERNS = [
    ...FORBIDDEN_SOURCE_PATTERNS,
    /\bregisterUserFunction\s*\.\s*constructor\b/,
    /\bFunctionContainer\b/,
    /\baddFunction\s*\(/,
];

const FUNCTION_EXPRESSION_PATTERN =
    /^\s*(?:function\s*\w*\s*\([^)]*\)|(?:\([^)]*\)|[$A-Z_][\w$]*)\s*=>)/i;

/**
 * Built-in spreadsheet functions — cannot be replaced by user code.
 * Mirrors SkSpreadSheet.cpp registration set (uppercase names).
 */
export const BUILTIN_FUNCTION_NAMES = new Set([
    "SUM", "MIN", "MAX", "ROUND", "TRUNC", "CEILING_MATH", "FLOOR_MATH", "CEILING_PRECISE", "FLOOR_PRECISE", "ISO_CEILING",
    "CEILING", "FLOOR", "MROUND", "GCD", "LCM",
    "ABS", "AVERAGE", "AVERAGEA", "MEDIAN", "STDEV_S", "STDEV",
    "MAXA", "MINA",
    "SIN", "COS", "TAN", "ACOS", "ASIN", "ATAN", "SQRT", "LOG", "LOG10", "LOG_10",
    "EXP", "LN", "PI", "RADIANS", "DEGREES",
    "SINH", "COSH", "TANH", "ASINH", "ACOSH", "ATANH",
    "COT", "COTH", "CSC", "CSCH", "SEC", "SECH", "ACOT", "ACOTH",
    "SIGN", "SQRTPI", "LARGE", "SMALL", "ATAN2", "QUOTIENT", "FACT", "FACTDOUBLE", "EVEN", "ODD", "COMBIN", "COMBINA",
    "BASE", "DECIMAL", "ROMAN", "ARABIC", "MULTINOMIAL", "SERIESSUM", "PERCENTOF",
    "BITAND", "BITOR", "BITXOR", "BITLSHIFT", "BITRSHIFT", "DELTA", "GESTEP",
    "BIN2DEC", "BIN2HEX", "BIN2OCT", "DEC2BIN", "DEC2HEX", "DEC2OCT",
    "HEX2BIN", "HEX2DEC", "HEX2OCT", "OCT2BIN", "OCT2DEC", "OCT2HEX",
    "STDEV_S", "STDEV", "STDEV_P", "VAR_S", "VAR", "VAR_P", "STDEVA", "STDEVPA", "VARA", "VARPA",
    "AVEDEV", "DEVSQ", "CORREL", "PEARSON", "COVARIANCE_P", "COVARIANCE_S",
    "SKEW", "SKEW_P", "KURT", "STANDARDIZE", "FISHER", "FISHERINV", "PHI", "GAUSS",
    "NORM_S_DIST", "NORMSDIST", "NORM_DIST", "NORMDIST",
    "NORM_S_INV", "NORMSINV", "NORM_INV", "NORMINV",
    "GAMMA", "GAMMALN", "GAMMALN_PRECISE",
    "PERCENTILE_INC", "PERCENTILE_EXC", "PERCENTILE", "QUARTILE_INC", "QUARTILE_EXC", "QUARTILE",
    "SLOPE", "INTERCEPT", "RSQ", "STEYX", "FORECAST", "FORECAST_LINEAR", "TREND", "GROWTH", "LINEST",
    "PERCENTRANK_INC", "PERCENTRANK_EXC", "PERCENTRANK",
    "PERMUT", "PERMUTATIONA", "GEOMEAN", "HARMEAN", "TRIMMEAN", "FREQUENCY",
    "MODE_SNGL", "MODE", "MODE_MULT", "RANK_EQ", "RANK", "RANK_AVG",
    "MOD", "POWER", "PRODUCT", "SUMPRODUCT", "SUMSQ", "SUMX2MY2", "SUMX2PY2", "SUMXMY2",
    "RAND", "RANDBETWEEN", "RANDARRAY",
    "COUNT", "COUNTA", "COUNTBLANK", "COUNTIF", "COUNTIFS", "SUMIFS",
    "MAXIFS", "MINIFS",
    "AVERAGEIF", "AVERAGEIFS", "SUMIF", "INDEX", "OFFSET", "DATARANGE",
    "JSON", "LOOKUP", "VLOOKUP", "HLOOKUP", "XLOOKUP", "XMATCH", "MATCH", "ROW", "COLUMN", "ROWS",
    "COLUMNS", "ADDRESS", "SUBTOTAL", "AGGREGATE",
    "CONCAT", "CONCATENATE", "LEFT", "RIGHT", "MID", "LEN", "FIND", "EXACT", "SEARCH",
    "REPLACE", "SUBSTITUTE", "UPPER", "LOWER", "PROPER", "TRIM", "CLEAN", "REPT",
    "TEXT", "T", "FIXED", "DOLLAR", "VALUETOTEXT", "ARRAYTOTEXT",
    "VALUE", "NUMBERVALUE", "CHAR", "CODE", "UNICHAR", "UNICODE",
    "TEXTJOIN", "TEXTSPLIT", "TEXTAFTER", "TEXTBEFORE",
    "IF", "IFERROR", "IFNA", "IFS", "ISBLANK", "ISNA", "ISERR", "ISERROR",
    "ISNUMBER", "ISLOGICAL", "ISTEXT", "ISNONTEXT", "ISREF", "ISFORMULA",
    "ISEVEN", "ISODD", "N", "TYPE", "ERROR_TYPE", "FORMULATEXT", "CELL", "INFO", "SHEET", "SHEETS", "NA",
    "TRUE", "FALSE", "AND", "OR", "XOR", "NOT",
    "TODAY", "NOW", "DATE", "DATEVALUE", "DAYS", "DAYS360", "ISOWEEKNUM", "TIMEVALUE", "DATEDIF", "YEARFRAC",
    "YEAR", "MONTH", "DAY", "WEEKDAY", "WEEKNUM",
    "NETWORKDAYS", "NETWORKDAYS_INTL", "WORKDAY", "WORKDAY_INTL", "TIME", "EDATE", "EOMONTH", "HOUR", "MINUTE", "SECOND",
    "SEQUENCE", "SORT", "SORTBY", "UNIQUE", "FILTER", "TRANSPOSE", "MMULT", "MDETERM", "MINVERSE", "MUNIT", "TRIMRANGE",
    "TOCOL", "TOROW", "CHOOSECOLS", "CHOOSEROWS", "EXPAND", "WRAPROWS", "WRAPCOLS",
    "TAKE", "DROP",
    "HSTACK", "VSTACK", "MAP", "REDUCE", "SCAN", "BYROW", "BYCOL", "MAKEARRAY",
    "REGEXTEST", "REGEXREPLACE", "REGEXEXTRACT",
    "PMT", "IPMT", "PPMT", "PV", "FV", "RATE", "NPER", "NPV", "IRR", "MIRR",
    "DB", "DDB", "SLN", "SYD", "CUMIPMT", "CUMPRINC", "EFFECT", "NOMINAL",
    "XIRR", "XNPV", "VDB", "FVSCHEDULE", "PDURATION", "RRI",
]);

/** Drop comments so validation does not flag words inside // or block comments. */
export function stripJsCommentsForValidation(sText) {
    let wOut = "";
    let wIndex = 0;
    const wText = String(sText || "");
    const wLength = wText.length;
    let wInLineComment = false;
    let wInBlockComment = false;
    let wInSingleQuote = false;
    let wInDoubleQuote = false;
    let wInTemplate = false;

    while (wIndex < wLength) {
        const wChar = wText[wIndex];
        const wNext = wText[wIndex + 1];

        if (wInLineComment) {
            if (wChar === "\n") {
                wInLineComment = false;
                wOut += wChar;
            }
            wIndex += 1;
            continue;
        }
        if (wInBlockComment) {
            if (wChar === "*" && wNext === "/") {
                wInBlockComment = false;
                wIndex += 2;
            } else {
                wIndex += 1;
            }
            continue;
        }
        if (wInSingleQuote) {
            wOut += wChar;
            if (wChar === "\\" && wIndex + 1 < wLength) {
                wOut += wText[wIndex + 1];
                wIndex += 2;
                continue;
            }
            if (wChar === "'") {
                wInSingleQuote = false;
            }
            wIndex += 1;
            continue;
        }
        if (wInDoubleQuote) {
            wOut += wChar;
            if (wChar === "\\" && wIndex + 1 < wLength) {
                wOut += wText[wIndex + 1];
                wIndex += 2;
                continue;
            }
            if (wChar === '"') {
                wInDoubleQuote = false;
            }
            wIndex += 1;
            continue;
        }
        if (wInTemplate) {
            wOut += wChar;
            if (wChar === "\\" && wIndex + 1 < wLength) {
                wOut += wText[wIndex + 1];
                wIndex += 2;
                continue;
            }
            if (wChar === "`") {
                wInTemplate = false;
            }
            wIndex += 1;
            continue;
        }

        if (wChar === "/" && wNext === "/") {
            wInLineComment = true;
            wIndex += 2;
            continue;
        }
        if (wChar === "/" && wNext === "*") {
            wInBlockComment = true;
            wIndex += 2;
            continue;
        }
        if (wChar === "'") {
            wInSingleQuote = true;
            wOut += wChar;
            wIndex += 1;
            continue;
        }
        if (wChar === '"') {
            wInDoubleQuote = true;
            wOut += wChar;
            wIndex += 1;
            continue;
        }
        if (wChar === "`") {
            wInTemplate = true;
            wOut += wChar;
            wIndex += 1;
            continue;
        }

        wOut += wChar;
        wIndex += 1;
    }
    return wOut;
}

function assertNoForbiddenPatterns(text, patterns, contextLabel) {
    for (const wPattern of patterns) {
        if (wPattern.test(text)) {
            throw new Error(`${contextLabel}: forbidden construct (${wPattern})`);
        }
    }
}

export function normalizeUserFunctionName(sName) {
    return String(sName || "").trim().toUpperCase();
}

export function validateUserFunctionName(sName) {
    const wName = normalizeUserFunctionName(sName);
    if (!USER_FUNCTION_NAME_PATTERN.test(wName)) {
        throw new Error(
            `Invalid function name "${sName}". Use A-Z, digits, underscore (2–32 chars, start with a letter).`
        );
    }
    if (BUILTIN_FUNCTION_NAMES.has(wName)) {
        throw new Error(`Function name "${wName}" is reserved (built-in).`);
    }
    return wName;
}

export function validateUserFunctionCapabilities(sCapabilities) {
    const wCaps = Array.isArray(sCapabilities) ? sCapabilities : ["pure"];
    for (const wCap of wCaps) {
        if (!USER_FUNCTION_ALLOWED_CAPABILITIES.includes(wCap)) {
            throw new Error(`Capability "${wCap}" is not allowed yet. Only "pure" is supported.`);
        }
    }
    if (!wCaps.includes("pure")) {
        throw new Error('User functions must declare the "pure" capability.');
    }
    return wCaps;
}

export function validateUserFunctionSource(sSource) {
    const wSource = String(sSource || "").trim();
    if (!wSource) {
        throw new Error("Function source is empty.");
    }
    if (wSource.length > 16_384) {
        throw new Error("Function source exceeds 16 KB limit.");
    }
    assertNoForbiddenPatterns(wSource, FORBIDDEN_SOURCE_PATTERNS, "Function source");
    if (!FUNCTION_EXPRESSION_PATTERN.test(wSource)) {
        throw new Error(
            'Function source must be a function expression, e.g. function(a, b) { return a + b; }'
        );
    }
    return wSource;
}

export function validateUserFunctionSpec(sSpec) {
    if (sSpec == null || typeof sSpec !== "object" || Array.isArray(sSpec)) {
        throw new Error("registerUserFunction expects a plain object.");
    }
    const wName = validateUserFunctionName(sSpec.name);
    const wLabel = String(sSpec.label || wName).trim();
    const wFamily = String(sSpec.family || "Script").trim();
    const wNbArg = Number(sSpec.nbArg);
    if (!Number.isInteger(wNbArg) || wNbArg < 0 || wNbArg > 64) {
        throw new Error(`Invalid nbArg for "${wName}" (expected 0–64).`);
    }
    const wSource = validateUserFunctionSource(sSpec.source);
    const wCapabilities = validateUserFunctionCapabilities(sSpec.capabilities);
    return {
        name: wName,
        label: wLabel,
        family: wFamily,
        nbArg: wNbArg,
        source: wSource,
        capabilities: wCapabilities,
    };
}

export function validateUserFunctionRegistrationScript(sScript) {
    const wScript = String(sScript || "");
    if (!wScript.trim()) {
        throw new Error("Script is empty.");
    }
    if (wScript.length > 65_536) {
        throw new Error("Script exceeds 64 KB limit.");
    }
    const wCodeOnly = stripJsCommentsForValidation(wScript);
    assertNoForbiddenPatterns(wCodeOnly, FORBIDDEN_SCRIPT_PATTERNS, "Registration script");
    return wScript;
}

/** Whitelisted globals exposed to pure user functions at runtime. */
export function createPureSandbox() {
    return Object.freeze({
        Math: Object.freeze({
            ...Math,
        }),
        Date,
        Number,
        String,
        Boolean,
        Array,
        Object: Object.freeze({
            keys: Object.keys,
            values: Object.values,
            entries: Object.entries,
            assign: Object.assign,
            freeze: Object.freeze,
        }),
        JSON: Object.freeze({
            parse: JSON.parse,
            stringify: JSON.stringify,
        }),
        isFinite,
        isNaN,
        parseFloat,
        parseInt,
    });
}

/**
 * Compile a validated pure function expression into an invokable wrapper.
 * The user function receives the sandbox as its `this` value.
 */
export function compilePureUserFunction(sSource) {
    const wSource = validateUserFunctionSource(sSource);
    const wSandbox = createPureSandbox();
    const wExpr = wSource.startsWith("function") ? wSource : `(${wSource})`;
    let wFactory;
    try {
        // Intentional: compile trusted user-function source in a sandbox factory.
        // eslint-disable-next-line no-new-func
        wFactory = new Function(
            "sandbox",
            `"use strict";
const __userFn = ${wExpr};
if (typeof __userFn !== "function") {
  throw new Error("Function source did not evaluate to a function.");
}
return function(...args) {
  return __userFn.apply(sandbox, args);
};`
        );
    } catch (wErr) {
        throw new Error(`Failed to compile user function: ${wErr.message || wErr}`);
    }
    return wFactory(wSandbox);
}

export function invokeUserFunction(sFn, sArgs, sDeadlineMs = USER_FUNCTION_INVOKE_DEADLINE_MS) {
    if (typeof sFn !== "function") {
        throw new Error("User function is not callable.");
    }
    const wArgs = Array.isArray(sArgs) ? sArgs : [];
    const wStart = typeof performance !== "undefined" ? performance.now() : Date.now();
    const wResult = sFn(...wArgs);
    const wElapsed =
        (typeof performance !== "undefined" ? performance.now() : Date.now()) - wStart;
    if (wElapsed > sDeadlineMs) {
        throw new Error(`User function exceeded ${sDeadlineMs} ms time limit.`);
    }
    if (wResult != null && typeof wResult === "object" && typeof wResult.then === "function") {
        throw new Error("Async return values are not supported in user functions.");
    }
    return wResult;
}

function buildRegistrationTestArgs(sNbArg) {
    const wArgs = [];
    for (let wIndex = 0; wIndex < sNbArg; wIndex += 1) {
        wArgs.push(wIndex + 1);
    }
    return wArgs;
}

/**
 * Dry-run a compiled function inside a Worker so infinite loops fail at registration time.
 */
export function testUserFunctionInWorker(sSource, sNbArg, sTimeoutMs = USER_FUNCTION_REGISTER_TEST_TIMEOUT_MS) {
    if (typeof Worker === "undefined") {
        const wFn = compilePureUserFunction(sSource);
        invokeUserFunction(wFn, buildRegistrationTestArgs(sNbArg), sTimeoutMs);
        return Promise.resolve();
    }

    const wWorkerSource = `
self.onmessage = function(event) {
  const spec = event.data || {};
  const forbidden = /\\beval\\b|Function\\s*\\(|\\bfetch\\b|\\bimport\\s*\\(/;
  if (forbidden.test(spec.source)) {
    self.postMessage({ ok: false, error: "Forbidden construct in worker test." });
    return;
  }
  try {
    const sandbox = Object.freeze({
      Math: Object.freeze({ ...Math }),
      Date: Date,
      Number: Number,
      String: String,
      Boolean: Boolean,
      Array: Array,
      JSON: Object.freeze({ parse: JSON.parse, stringify: JSON.stringify }),
      isFinite: isFinite,
      isNaN: isNaN,
      parseFloat: parseFloat,
      parseInt: parseInt,
    });
    const src = spec.source.trim();
    const expr = src.startsWith("function") ? src : "(" + src + ")";
    const factory = new Function(
      "sandbox",
      '"use strict"; const __userFn = ' + expr + '; return function(...args){ return __userFn.apply(sandbox, args); };'
    );
    const fn = factory(sandbox);
    fn.apply(null, spec.testArgs || []);
    self.postMessage({ ok: true });
  } catch (err) {
    self.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
  }
};`;

    return new Promise((resolve, reject) => {
        const wBlob = new Blob([wWorkerSource], { type: "text/javascript" });
        const wUrl = URL.createObjectURL(wBlob);
        const wWorker = new Worker(wUrl);
        let wSettled = false;

        const wFinish = (wError) => {
            if (wSettled) {
                return;
            }
            wSettled = true;
            clearTimeout(wTimer);
            wWorker.terminate();
            URL.revokeObjectURL(wUrl);
            if (wError) {
                reject(wError);
            } else {
                resolve();
            }
        };

        const wTimer = setTimeout(() => {
            wFinish(new Error(`Registration test exceeded ${sTimeoutMs} ms (possible infinite loop).`));
        }, sTimeoutMs);

        wWorker.onmessage = (wEvent) => {
            const wPayload = wEvent.data || {};
            if (wPayload.ok) {
                wFinish(null);
            } else {
                wFinish(new Error(wPayload.error || "Registration test failed."));
            }
        };

        wWorker.onerror = (wEvent) => {
            wFinish(new Error(wEvent.message || "Registration worker error."));
        };

        wWorker.postMessage({
            source: sSource,
            testArgs: buildRegistrationTestArgs(sNbArg),
        });
    });
}

/**
 * Execute a registration script that only calls registerUserFunction(spec).
 */
export function runUserFunctionRegistrationScript(sScript, sRegisterCallback) {
    validateUserFunctionRegistrationScript(sScript);
    if (typeof sRegisterCallback !== "function") {
        throw new Error("registerUserFunction callback is missing.");
    }
    // Intentional: run validated registration scripts that only call registerUserFunction.
    // eslint-disable-next-line no-new-func
    const wRunner = new Function(
        "registerUserFunction",
        `"use strict";\n${sScript}`
    );
    wRunner(sRegisterCallback);
}
