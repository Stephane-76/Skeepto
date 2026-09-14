/**
 * @class SkUISpreadSheet
 * JavaScript wrapper for the C++ SkUISpreadSheet class
 */

import {
    parseCellRefSync,
    parseRangeBoundsSync,
} from './SkA1Ref.js';

class SkUISpreadSheet {
    constructor() {
        this.m_UISpreadSheet = null;
        this.m_ModuleReady = false;
        this.m_ModuleReadyCallbacks = [];
        this.m_InitError = null;

        // loadUI() awaits _waitForWasmModule() before constructing; create C++ instance synchronously.
        this._createUISpreadSheet();
    }

    /** Apply session user to the C++ engine (call once after construction from loadUI). */
    init() {
        const wUser = {
            email: sessionStorage.getItem('email'),
            name: sessionStorage.getItem('name'),
            firstname: sessionStorage.getItem('firstname'),
        };
        this.setUserInterface(wUser.email, wUser.name, wUser.firstname);
    }

    _isWasmRuntimeReady() {
        return !!(window.__SkModuleReady && window.SpreadSheet && window.SpreadSheet.UISpreadSheet);
    }

    /** Create the native UISpreadSheet instance and notify waiters. Returns false on failure. */
    _createUISpreadSheet() {
        if (this.m_UISpreadSheet) {
            return true;
        }
        if (!this._isWasmRuntimeReady()) {
            this.m_InitError = new Error(
                '[SkUISpreadSheet] WASM runtime not ready (call _waitForWasmModule before construction)',
            );
            console.error(this.m_InitError.message);
            return false;
        }
        try {
            this.m_UISpreadSheet = new window.SpreadSheet.UISpreadSheet();
            this.m_ModuleReady = true;
            this.m_InitError = null;
            console.log('[SkUISpreadSheet] UISpreadSheet created successfully');
            const wCallbacks = this.m_ModuleReadyCallbacks;
            this.m_ModuleReadyCallbacks = [];
            wCallbacks.forEach((callback) => callback());
            return true;
        } catch (error) {
            this.m_InitError = error;
            console.error('[SkUISpreadSheet] Error creating UISpreadSheet:', error);
            return false;
        }
    }

    // Ensure module is ready before executing operations
    async _ensureModuleReady() {
        if (this.m_InitError) {
            throw this.m_InitError;
        }
        if (this.m_ModuleReady && this.m_UISpreadSheet) {
            return true;
        }

        this._createUISpreadSheet();
        if (this.m_ModuleReady && this.m_UISpreadSheet) {
            return true;
        }
        if (this.m_InitError) {
            throw this.m_InitError;
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout waiting for WASM module to be ready'));
            }, 10000);

            this.m_ModuleReadyCallbacks.push(() => {
                clearTimeout(timeout);
                if (this.m_InitError) {
                    reject(this.m_InitError);
                } else {
                    resolve(true);
                }
            });
        });
    }

    /**
     * Wait until the native UISpreadSheet (WASM) instance exists.
     * The JS wrapper may exist before m_UISpreadSheet is constructed (_createUISpreadSheet).
     */
    async whenEngineReady() {
        await this._ensureModuleReady();
        if (!this.m_UISpreadSheet) {
            throw new Error('UISpreadSheet WASM engine not initialized');
        }
    }

    /**
     * Ensure the native WASM engine exists before any strict API call.
     * Soft-read methods (getvalue, getActiveSheet, compileError*, …) return empty
     * fallbacks instead of calling this helper.
     */
    _requireEngine(methodName = 'operation') {
        if (this.m_InitError) {
            throw this.m_InitError;
        }
        if (!this.m_UISpreadSheet) {
            throw new Error(`UISpreadSheet WASM engine not initialized. Cannot call ${methodName}.`);
        }
        return this.m_UISpreadSheet;
    }

    // Helper method to safely call UISpreadSheet methods
    _safeCall(methodName, ...args) {
        const wEngine = this._requireEngine(methodName);
        const method = wEngine[methodName];
        if (typeof method !== 'function') {
            throw new Error(`Method ${methodName} does not exist on UISpreadSheet`);
        }
        
        return method.apply(wEngine, args);
    }

    // call_Result returns the result of the function
    call_Result(functionName, jsonParams) {
        const wEngine = this._requireEngine('call_Result');
        try {
            let wResultString = wEngine.Call(functionName, JSON.stringify(jsonParams));
            if (functionName !== "GetSizeRow" && functionName !== "GetSizeCol"
                && functionName !== "SplitFreezeRow" && functionName !== "SplitFreezeCol") {
                console.log("Call " + functionName + "(" + JSON.stringify(jsonParams) + ") = " + wResultString);
            }
            let wResult = JSON.parse(wResultString);
            return wResult.result;
        } catch (e) {
            console.error("[MAIN] Error in call:" + functionName + "(" + JSON.stringify(jsonParams) + ")", e);
            throw e;
        }
    }

    // call returns the JSON string of the function
    call(functionName, jsonParams) {
        const wEngine = this._requireEngine('call');
        try {
            let wResultString = wEngine.Call(functionName, JSON.stringify(jsonParams));
            if (functionName !== "GetSizeRow" && functionName !== "GetSizeCol"
                && functionName !== "SplitFreezeRow" && functionName !== "SplitFreezeCol") {
                console.log("Call " + functionName + "(" + JSON.stringify(jsonParams) + ") = " + wResultString);
            }
            return wResultString;
        } catch (e) {
            console.error("[MAIN] Error in call:" + functionName + "(" + JSON.stringify(jsonParams) + ")", e);
            throw e;
        }
    }
    base10toAlphaSync(value) {
        return this._requireEngine('base10toAlpha').Base10toAlpha(Number(value) || 0);
    }

    base10toAlpha(value) {
        if (this.m_UISpreadSheet === null) {
            return this.call_Result("Base10toAlpha", { value });
        }
        return this.base10toAlphaSync(value);
    }

    alphaToBase10(value) {
        const wEngine = this._requireEngine('alphaToBase10');
        return wEngine.AlphaToBase10(value);
    }

    /** Parse A1 / $B$2 → { row, col } (sync; WASM lexer when ready). */
    parseCellSync(ref) {
        return parseCellRefSync(ref);
    }

    /** Parse A1:B2 → { top, left, bottom, right } (sync; WASM lexer when ready). */
    parseRangeSync(ref) {
        return parseRangeBoundsSync(ref);
    }

    /** Prefix unqualified A1 refs with sSheet (C++ Lexer; supports formulas). */
    qualifyRefsForSheet(sheet, text) {
        const wEngine = this._requireEngine('qualifyRefsForSheet');
        return wEngine.QualifyRefsForSheet(sheet, text);
    }

    /** Remove sSheet! from refs on sSheet; other sheets unchanged. */
    stripTargetSheetFromRefs(sheet, text) {
        const wEngine = this._requireEngine('stripTargetSheetFromRefs');
        return wEngine.StripTargetSheetFromRefs(sheet, text);
    }

    /** Collect cell/range/table/name refs from a formula string (for in-formula highlighting). */
    collectFormulaRefs(formula, sheet, row, col) {
        const wEngine = this._requireEngine('collectFormulaRefs');
        let raw;

        raw = wEngine.CollectFormulaRefs(formula, sheet, row, col);

        if (typeof raw === "string") {
            try {
                return JSON.parse(raw);
            } catch (e) {
                return { syntaxError: true, errorLine: 0, errorColumn: 0, refs: [] };
            }
        }
        return raw ?? { syntaxError: false, errorLine: 0, errorColumn: 0, refs: [] };
    }

    // User Interface email, name, firstName
    setUserInterface(email, name, firstName) {
        // C++ expects keys: email, name, firstname (lowercase 'n') when jsondebug; or short keys otherwise.
        const json = JSON.stringify({ email, name, firstname: firstName });
        return this._requireEngine('setUserInterface').SetUserInterface(json);
    }
    getUserInterface() {
        return this._requireEngine('getUserInterface').GetUserInterface();
    }

    // WorkBook operations
    getActiveWorkBook() {
        const wEngine = this._requireEngine('getActiveWorkBook');
        return wEngine.GetActiveWorkBook();
    }

    setActiveWorkBook(uri) {
        const wEngine = this._requireEngine('setActiveWorkBook');
        return wEngine.SetActiveWorkBook(uri);
    }

    newWorkBook(uri) {
        const wEngine = this._requireEngine('newWorkBook');
        return wEngine.NewWorkBook(uri);
    }

    addWorkBook(uri) {
        return this._requireEngine('addWorkBook').AddWorkBook(uri);
    }

    deleteWorkBook(uri) {
        const wEngine = this._requireEngine('deleteWorkBook');
        return wEngine.DeleteWorkBook(uri);
    }

    renameWorkBook(uri, uriTo) {
        const wEngine = this._requireEngine('renameWorkBook');
        return wEngine.RenameWorkBook(uri, uriTo);
    }

    jsonWorkBook(uri) {   
        const wEngine = this._requireEngine('jsonWorkBook');

        return wEngine.JsonWorkBook(uri);
    }

    jsonWorkBooks() {
        const wEngine = this._requireEngine('jsonWorkBooks');
        return wEngine.JsonWorkBooks();
    }

    /** URIs of workbooks currently loaded in WASM (JsonWorkBooks list entries are { uri, info }). */
    listWorkBookUris() {
        const wRaw = this.jsonWorkBooks();
        const wData = typeof wRaw === 'string' ? JSON.parse(wRaw) : wRaw;
        const wList = Array.isArray(wData?.list) ? wData.list : [];
        return wList
            .map((entry) => (typeof entry === 'string' ? entry : entry?.uri || ''))
            .filter(Boolean);
    }

    writeJson(uri) {
        const wEngine = this._requireEngine('writeJson');
        return wEngine.WriteJson(uri);
    }

    readJson(json) {
        return this._requireEngine('readJson').ReadJson(json);
    }

    /** Full workbook recalculation (native RecalculateAll); required after ReadJson for some dependency orders. */
    recalculateAll() {
        return this._requireEngine('recalculateAll').RecalculateAll();
    }

    /** Build the calculation graph without blocking (pair with stepRecalculateAllCooperative). */
    beginRecalculateAllCooperative() {
        this._requireEngine('beginRecalculateAllCooperative').BeginRecalculateAllCooperative();
    }

    /** Advance cooperative recalc; returns true when finished. */
    stepRecalculateAllCooperative(maxMs = 8) {
        return this._requireEngine('stepRecalculateAllCooperative').StepRecalculateAllCooperative(maxMs);
    }

    /** Progress 0..100 while cooperative recalc is active. */
    recalculateAllCooperativeProgress() {
        return this._requireEngine('recalculateAllCooperativeProgress').RecalculateAllCooperativeProgress();
    }

    isRecalculateAllCooperativeActive() {
        return this._requireEngine('isRecalculateAllCooperativeActive').IsRecalculateAllCooperativeActive();
    }

    setCooperativeCalculateEnabled(enabled) {
        this._requireEngine('setCooperativeCalculateEnabled').SetCooperativeCalculateEnabled(!!enabled);
    }

    cooperativeCalculateEnabled() {
        return this._requireEngine('cooperativeCalculateEnabled').CooperativeCalculateEnabled();
    }

    // Undo Redo operations
    //
    // The native binding exposes a void Undo()/Redo(), but the C++
    // implementation (tUISpreadSheet::_Undo) is a no-op when the history
    // stack is empty (`if (wUndo == nullptr) return;`). When something is
    // actually undone, the C++ side replaces `m_UIExtraUndo` with the saved
    // pre-op state, which we read back via getExtraUndo(). We therefore
    // snapshot the JSON before and after to return a boolean indicating
    // whether the call had any effect, so callers can avoid side-effects
    // (e.g. posting in chat) when nothing changed.
    undo() {
        const wEngine = this._requireEngine('undo');
        let wBefore = '';
        try { wBefore = this.getExtraUndo() || ''; } catch (_) {}
        wEngine.Undo();
        let wAfter = '';
        try { wAfter = this.getExtraUndo() || ''; } catch (_) {}
        return wBefore !== wAfter;
    }

    redo() {
        const wEngine = this._requireEngine('redo');
        let wBefore = '';
        try { wBefore = this.getExtraUndo() || ''; } catch (_) {}
        wEngine.Redo();
        let wAfter = '';
        try { wAfter = this.getExtraUndo() || ''; } catch (_) {}
        return wBefore !== wAfter;
    }

    setExtraUndo(json) {
        const wEngine = this._requireEngine('setExtraUndo');
        wEngine.SetExtraUndo(json);
    }

    getExtraUndo() {
        const wEngine = this._requireEngine('getExtraUndo');
        return wEngine.GetExtraUndo();
    }

    // Sheet operations
    // Synchronous: native binding is blocking; engine is ready after bootstrap.
    setActiveSheet(name) {
        if (!this.m_UISpreadSheet) {
            return undefined;
        }
        return this.m_UISpreadSheet.SetActiveSheet(name);
    }

    getActiveSheet() {
        if (!this.m_UISpreadSheet) {
            return "";
        }
        return this.m_UISpreadSheet.GetActiveSheet();
    }

    addSheet(name, left = "") {
        const wEngine = this._requireEngine('addSheet');
        return wEngine.AddSheet(name, left);
    }

    renameSheet(name, newName) {
        const wEngine = this._requireEngine('renameSheet');
        return wEngine.RenameSheet(name, newName);
    }

    swapSheet(name1, name2, insertAfter = false) {
        const wEngine = this._requireEngine('swapSheet');
        return wEngine.SwapSheet(name1, name2, insertAfter);
    }

    deleteSheet(name) {
        const wEngine = this._requireEngine('deleteSheet');
        return wEngine.DeleteSheet(name);
    }

    sheetsList() {
        const wEngine = this._requireEngine('sheetsList');
        return wEngine.SheetsList();
    }

    // Cell operations
    value(ref, value, sheet = "") {
        return this._requireEngine('value').Value(ref, value, sheet);
    }

    // Excel-like fill handle: extends the seed range into the extension range
    // (series/formulas) as a single undo. sourceRef = original selection,
    // destRef = cells to fill (extension only).
    fillSeries(sourceRef, destRef, sheet = "") {
        return this._requireEngine('fillSeries').FillSeries(sourceRef, destRef, sheet);
    }

    valueAttribute(ref, name, value, sheet = "") {
        const wEngine = this._requireEngine('valueAttribute');
        return wEngine.ValueAttribute(ref, name, value, sheet);
    }

    cellClassAttributes(ref, attributesJson, sheet = "") {
        const wEngine = this._requireEngine('cellClassAttributes');
        const wJson =
            typeof attributesJson === "string"
                ? attributesJson
                : JSON.stringify(attributesJson);

        return wEngine.CellClassAttributes(ref, wJson, sheet);
    }

    valueClassCalculable(ref, value, sheet = "") {
        if (!this.m_UISpreadSheet) {
            return false;
        }
        return this.m_UISpreadSheet.ValueClassCalculable(ref, value, sheet);
    }

    valueString(ref, value, sheet = "") {
        const wEngine = this._requireEngine('valueString');
        return wEngine.ValueString(ref, value, sheet);
    }

    valueInt(ref, value, sheet = "") {
        const wEngine = this._requireEngine('valueInt');
        return wEngine.ValueInt(ref, value, sheet);
    }

    valueDouble(ref, value, sheet = "") {
        const wEngine = this._requireEngine('valueDouble');
        return wEngine.ValueDouble(ref, value, sheet);
    }

    getvalue(ref, sheet = "") {
        if (!this.m_UISpreadSheet) {
            return "Null";
        }
        return this.m_UISpreadSheet.GetValue(ref, sheet);
    }

    /** CalculableValue scalar — unwraps tCellUnit magnitude (5 € → 5). */
    getCalculableScalar(ref, sheet = "") {
        if (!this.m_UISpreadSheet) {
            return "";
        }
        return this.m_UISpreadSheet.GetCalculableScalar(ref, sheet);
    }

    getInputvalue(ref, sheet = "") {
        if (!this.m_UISpreadSheet) {
            return "";
        }
        return this.m_UISpreadSheet.GetInputValue(ref, sheet);
    }

    /** Formula text for ref (no leading '='); empty if the cell is not a formula. JsonView may omit c_f on Wasm. */
    getFormula(ref, sheet = "", user = false) {
        const wEngine = this._requireEngine('getFormula');
        return wEngine.GetFormula(ref, sheet, user);
    }

    /**
     * Formula-pick reference relative to the edit anchor.
     * Returns @[Col] / structured table form when both cells share a table data row; else A1.
     */
    cellRef(anchor, ref, sheet = "") {
        const wEngine = this._requireEngine('cellRef');
        if (typeof wEngine.CellRef !== 'function') {
            return ref;
        }
        return wEngine.CellRef(anchor, ref, sheet);
    }

    /** Last lexer/parser short error label (tLemonInterface), after a failed Value/compile. */
    compileError() {
        if (!this.m_UISpreadSheet) {
            return "";
        }
        return this.m_UISpreadSheet.CompileError();
    }

    /** 1-based line in the formula text (see tUISpreadSheet::_ErrorLine). */
    compileErrorLine() {
        if (!this.m_UISpreadSheet) {
            return 0;
        }
        return this.m_UISpreadSheet.CompileErrorLine();
    }

    /** 1-based column index on the error line (see tUISpreadSheet::_ErrorColumn). */
    compileErrorColumn() {
        if (!this.m_UISpreadSheet) {
            return 0;
        }
        return this.m_UISpreadSheet.CompileErrorColumn();
    }

    /** Full error with formula snippet and caret hint (tUISpreadSheet::_ErrorWithDetail). */
    compileErrorWithDetail() {
        if (!this.m_UISpreadSheet) {
            return "";
        }
        return this.m_UISpreadSheet.CompileErrorWithDetail();
    }

    getValueAttribute(ref, name, sheet = "") {
        const wEngine = this._requireEngine('getValueAttribute');
        return wEngine.GetValueAttribute(ref, name, sheet);
    }

    getFormulaAttribute(ref, name, sheet = "") {
        const wEngine = this._requireEngine('getFormulaAttribute');
        return wEngine.GetFormulaAttribute(ref, name, sheet);
    }

    // Row & Column operations
    sizeRow(begin, end, size, sheet = "") {
        const wEngine = this._requireEngine('sizeRow');

      return wEngine.SizeRow(begin, end, size, sheet);
    }

    getSizeRow(index, sSheet = "") {
        const wEngine = this._requireEngine('getSizeRow');
        return wEngine.GetSizeRow(index, sSheet);
    }

    sizeCol(begin, end, size, sheet = "") {
        const wEngine = this._requireEngine('sizeCol');
        return wEngine.SizeCol(begin, end, size, sheet);
    }

    getSizeCol(index, sheet = "") {
        const wEngine = this._requireEngine('getSizeCol');

      return wEngine.GetSizeCol(index, sheet);
    }

    insertRow(begin, end, sheet = "") {
        const wEngine = this._requireEngine('insertRow');
        return wEngine.InsertRow(begin, end, sheet);
    }

    deleteRow(begin, end, sheet = "") {
        const wEngine = this._requireEngine('deleteRow');
        return wEngine.DeleteRow(begin, end, sheet);
    }

    insertCol(begin, end, sheet = "") {
        const wEngine = this._requireEngine('insertCol');
        return wEngine.InsertCol(begin, end, sheet);
    }

    deleteCol(begin, end, sheet = "") {
        const wEngine = this._requireEngine('deleteCol');
        return wEngine.DeleteCol(begin, end, sheet);
    }

    // Copy & Paste operations
    copy(ref, sheet = "") {
        const wEngine = this._requireEngine('copy');
        return wEngine.Copy(ref, sheet);
    }

    cut(ref, sheet = "") {
        const wEngine = this._requireEngine('cut');
        return wEngine.Cut(ref, sheet);
    }

    paste(ref, sheet = "") {
        const wEngine = this._requireEngine('paste');
        return wEngine.Paste(ref, sheet);
    }

    move(sourceRef, destRef, sheet = "") {
        const wEngine = this._requireEngine('move');
        return wEngine.Move(sourceRef, destRef, sheet);
    }

    // Format operations
    format(ref, value, sheet = "") {
        const wEngine = this._requireEngine('format');
        return wEngine.Format(ref, value, sheet);
    }
    
    precision(ref, precision, sheet = "") {
        const wEngine = this._requireEngine('precision');
        return wEngine.Precision(ref, precision, sheet);
    }

  

    conditionalFormat(type, ref, param1,param2, param3, param4, param5, param6, param7, param8, param9, param10, sheet = "") {
        const wEngine = this._requireEngine('conditionalFormat');
        // Normalize params to exactly 10 string slots: param1..param10

        const payload = {
            type,
            ref,
            param1: param1 || "",
            param2: param2 || "",
            param3: param3 || "",
            param4: param4 || "",
            param5: param5 || "",
            param6: param6 || "",
            param7: param7 || "",
            param8: param8 || "",
            param9: param9 || "",
            param10: param10 || "",
            sheet
        };

        // Direct C++ binding expects 12 strings: type, ref, param1..param10, sheet
        return wEngine.ConditionalFormat(
            type,
            ref,
            payload.param1,
            payload.param2,
            payload.param3,
            payload.param4,
            payload.param5,
            payload.param6,
            payload.param7,
            payload.param8,
            payload.param9,
            payload.param10,
            sheet
        );
    }

    deleteConditionalFormat(type, ref, sheet = "") {
        const wEngine = this._requireEngine('deleteConditionalFormat');
        return wEngine.DeleteConditionalFormat(type, ref, sheet);
    }

    jsonConditionalFormat(sheet = "") {
        const wEngine = this._requireEngine('jsonConditionalFormat');
        return wEngine.JsonConditionalFormat(sheet);
    }

    // Insert/Delete by rectangular selection (Rect)
    insertRowByRect(ref, sheet = "") {
        const wEngine = this._requireEngine('insertRowByRect');
        return wEngine.InsertRowByRect(ref, sheet);
    }

    /** Insert a row by rect and write a label in the same undo entry. */
    insertRowByRectWithLabel(ref, labelRef, labelValue = "Total", sheet = "") {
        const wEngine = this._requireEngine('insertRowByRectWithLabel');
        return wEngine.InsertRowByRectWithLabel(ref, labelRef, labelValue, sheet);
    }

    deleteRowByRect(ref, sheet = "") {
        const wEngine = this._requireEngine('deleteRowByRect');
        return wEngine.DeleteRowByRect(ref, sheet);
    }

    insertColByRect(ref, sheet = "") {
        const wEngine = this._requireEngine('insertColByRect');
        return wEngine.InsertColByRect(ref, sheet);
    }

    deleteColByRect(ref, sheet = "") {
        const wEngine = this._requireEngine('deleteColByRect');
        return wEngine.DeleteColByRect(ref, sheet);
    }

    debugFormat() {
        const wEngine = this._requireEngine('debugFormat');
        wEngine.DebugFormat();
    }

    border(ref, border, value, sheet = "") {
        const wEngine = this._requireEngine('border');
        return wEngine.Border(ref, border, value, sheet);
    }

    getFormat(ref, sheet = "") {
        const wEngine = this._requireEngine('getFormat');
        return wEngine.GetFormat(ref, sheet);
    }

    jsonFormatString() {
        const wEngine = this._requireEngine('jsonFormatString');
        return wEngine.JsonFormatString();
    }

    // Named ranges ==========================================================
    jsonRangeNamed() {
        const wEngine = this._requireEngine('jsonRangeNamed');
        return wEngine.JsonRangeNamed();
    }

    jsonRangeData() {
        const wEngine = this._requireEngine('jsonRangeData');
        return wEngine.JsonRangeData();
    }

    jsonFindUniqueValue(ref, sheet = "", onlyDataVisible = false) {
        const wEngine = this._requireEngine('jsonFindUniqueValue');
        return wEngine.JsonFindUniqueValue(ref, sheet, onlyDataVisible);
    }

    /** Find cells on the active sheet, or the whole workbook when sheet is "". */
    jsonFindCell(search, matchCase = false, matchEntireCell = false, sheet = "") {
        const wEngine = this._requireEngine('jsonFindCell');
        return wEngine.JsonFindCell(search, matchCase, matchEntireCell, sheet);
    }

    undoApplyRangeData(name, jsonData, sheet = "") {
        const wEngine = this._requireEngine('undoApplyRangeData');
        return wEngine.UndoApplyRangeData(name, jsonData, sheet);
    }

    undoAddRangeData(name, ref, jsonData = "", sheet = "") {
        const wEngine = this._requireEngine('undoAddRangeData');
        return wEngine.UndoAddRangeData(name, ref, jsonData, sheet);
    }

    insertNamedRange(name, ref, sheet = "") {
        const wEngine = this._requireEngine('insertNamedRange');
        return wEngine.InsertNamedRange(name, ref, sheet);
    }

    deleteNamedRange(name, sheet = "") {
        const wEngine = this._requireEngine('deleteNamedRange');
        return wEngine.DeleteNamedRange(name, sheet);
    }

    // Atomic rename-and/or-reselect of a named range.
    // The engine keeps the underlying tRange* (and therefore every formula
    // that references it) alive whenever possible, instead of the old
    // delete + insert fallback that would break VectorRef entries.
    // Returns false if the backend refuses the operation (e.g. multi-user
    // mode and oldName !== newName: see tApi::IsRenameAllowed).
    updateNamedRange(oldname, newname, newref, sheet = "") {
        const wEngine = this._requireEngine('updateNamedRange');
        return wEngine.UpdateNamedRange(
            oldname, newname, newref, sheet
        );
    }

    // Return true when identifier renames (sheet / named range) are safe to
    // propose in the UI. Default is true in local mode; turns false as soon
    // as MultiUserActive is set by the presence layer.
    isRenameAllowed() {
        const wEngine = this._requireEngine('isRenameAllowed');
        return wEngine.IsRenameAllowed();
    }

    // Forward the collaborative state to the C++ layer. The caller is
    // expected to invoke this whenever another user joins (active=true) or
    // when the user becomes the sole author again (active=false).
    setMultiUserActive(active) {
        const wEngine = this._requireEngine('setMultiUserActive');
        const wActive = Boolean(active);

        return wEngine.SetMultiUserActive(wActive);
    }

    // Named formulas ========================================================
    jsonFormulaNamed() {
        const wEngine = this._requireEngine('jsonFormulaNamed');
        return wEngine.JsonFormulaNamed();
    }

    insertFormulaNamed(name, formula, sheet = "") {
        const wEngine = this._requireEngine('insertFormulaNamed');
        return wEngine.InsertFormulaNamed(name, formula, sheet);
    }

    deleteFormulaNamed(name, sheet = "") {
        const wEngine = this._requireEngine('deleteFormulaNamed');
        return wEngine.DeleteFormulaNamed(name, sheet);
    }

    // Floating objects ======================================================
    insertFloatingObject(
        name,
        className,
        targetSheetName,
        sheet = "",
        diffX = 0,
        diffY = 0,
        width = 0,
        height = 0,
        opacity = 0,
        anchorCellRef = "",
    ) {
        const wEngine = this._requireEngine('insertFloatingObject');
        return wEngine.InsertFloatingObject(
            name,
            className,
            targetSheetName,
            sheet,
            diffX,
            diffY,
            width,
            height,
            opacity,
            anchorCellRef,
        );
    }

    deleteFloatingObject(name, sheet = "") {
        const wEngine = this._requireEngine('deleteFloatingObject');
        return wEngine.DeleteFloatingObject(name, sheet);
    }

    floatingObjectLayout(name, diffX, diffY, width, height, opacity, anchorCellRef = "", sheet = "") {
        const wEngine = this._requireEngine('floatingObjectLayout');
        return wEngine.FloatingObjectLayout(
            name,
            diffX,
            diffY,
            width,
            height,
            opacity,
            anchorCellRef,
            sheet,
        );
    }

    floatingObjectBringToFront(name, sheet = "") {
        const wEngine = this._requireEngine('floatingObjectBringToFront');
        return wEngine.FloatingObjectBringToFront(name, sheet);
    }

    floatingObjectAttribute(name, attribute, value, sheet = "") {
        const wEngine = this._requireEngine('floatingObjectAttribute');
        return wEngine.FloatingObjectAttribute(name, attribute, value, sheet);
    }

    floatingObjectAttributes(name, attributesJson, sheet = "") {
        const wEngine = this._requireEngine('floatingObjectAttributes');
        const wJson =
            typeof attributesJson === "string"
                ? attributesJson
                : JSON.stringify(attributesJson);

        return wEngine.FloatingObjectAttributes(name, wJson, sheet);
    }

    // Sheet print layout (tPrintParameters JSON — keys match SkPrintParameters::JsonWrite)
    jsonPrintParameters(sheet = "") {
        const wEngine = this._requireEngine('jsonPrintParameters');
        return wEngine.JsonPrintParameters(sheet);
    }

    setJsonPrintParameters(json, sheet = "") {
        const wEngine = this._requireEngine('setJsonPrintParameters');
        const wJson = typeof json === "string" ? json : JSON.stringify(json);

        return wEngine.SetJsonPrintParameters(wJson, sheet);
    }

    defaultFormatString(formatString) {
        const wEngine = this._requireEngine('defaultFormatString');
        return wEngine.DefaultFormatString(formatString);
    }

    formatValueWithCellFormat(ref, value, sheet = "") {
        const wEngine = this._requireEngine('formatValueWithCellFormat');
        return wEngine.FormatValueWithCellFormat(ref, String(value), sheet);
    }

    applyFormatString(ref, value, sheet = "") {
        const wEngine = this._requireEngine('applyFormatString');
        return wEngine.ApplyFormatString(ref, value, sheet);
    }

    // Merge operations
    merge(ref, sheet = "") {
        const wEngine = this._requireEngine('merge');
        return wEngine.Merge(ref, sheet);
    }

    returnMerged(row, col, sheet = "") {
        const wEngine = this._requireEngine('returnMerged');
        return wEngine.ReturnMerged(row, col, sheet);
    }

    returnRangeMerged(ref, sheet = "") {
        const wEngine = this._requireEngine('returnRangeMerged');
        return wEngine.ReturnRangeMerged(ref, sheet);
    }

    returnRangeMergedFusion(ref, sheet = "") {
        const wEngine = this._requireEngine('returnRangeMergedFusion');
        return wEngine.ReturnRangeMergedFusion(ref, sheet);
    }

    // View operations
    jsonView(row, col, viewHeight, viewWidth, diffY, diffX, sheet = '', sCss = false) {
        const wEngine = this._requireEngine('jsonView');
        return wEngine.JsonView(row, col, viewHeight, viewWidth, diffY, diffX, sheet, sCss);
    }

    jsonFloatingObjectsForSheet(targetSheetName, sheet = "") {
        const wEngine = this._requireEngine('jsonFloatingObjectsForSheet');
        return wEngine.JsonFloatingObjectsForSheet(targetSheetName, sheet);
    }

    jsonFloatingObjects(sheet = "") {
        const wEngine = this._requireEngine('jsonFloatingObjects');
        return wEngine.JsonFloatingObjects(sheet);
    }

    jsonRightJustify(col, viewWidth, sheet = "") {
        const wEngine = this._requireEngine('jsonRightJustify');
        return wEngine.JsonRightJustify(col, viewWidth, sheet);
    }

    jsonBottomJustify(row, viewHeight, sheet = "") {
        const wEngine = this._requireEngine('jsonBottomJustify');
        return wEngine.JsonBottomJustify(row, viewHeight, sheet);
    }

    jsonColByPixel(colStart, pixel, sheet = "") {
        const wEngine = this._requireEngine('jsonColByPixel');
        return wEngine.JsonColByPixel(colStart, pixel, sheet);
    }

    jsonRowByPixel(rowStart, pixel, sheet = "") {
        const wEngine = this._requireEngine('jsonRowByPixel');
        return wEngine.JsonRowByPixel(rowStart, pixel, sheet);
    }

    jsonBottomRight(sheet = "") {
        const wEngine = this._requireEngine('jsonBottomRight');
        return wEngine.JsonBottomRight(sheet);
    }

    jsonPixelBottomRight(sheet = "") {
        const wEngine = this._requireEngine('jsonPixelBottomRight');
        return wEngine.JsonPixelBottomRight(sheet);
    }

    // Tree operations
    openCloseTreeRow(row, sheet = "") {
        const wEngine = this._requireEngine('openCloseTreeRow');
        return wEngine.OpenCloseTreeRow(row, sheet);
    }

    openCloseTreeCol(row, sheet = "") {
        const wEngine = this._requireEngine('openCloseTreeCol');
        return wEngine.OpenCloseTreeCol(row, sheet);
    }

    changeTreeRow(right, row, size, sheet = "") {
        const wEngine = this._requireEngine('changeTreeRow');
        const wResult = wEngine.ChangeTreeRow(!!right, row | 0, size | 0, sheet || "");
        console.log("changeTreeRow", { right: !!right, row: row | 0, size: size | 0 }, "→", wResult);
        return wResult;
    }

    changeTreeCol(right, col, size, sheet = "") {
        const wEngine = this._requireEngine('changeTreeCol');
        return wEngine.ChangeTreeCol(right, col, size, sheet);
    }

    /** Freeze panes: cde 1 = SplitV (column), 2 = SplitH (row), 3 = clear. */
    splitView(cde, position = 0, sheet = "") {
        const wEngine = this._requireEngine('splitView');
        return wEngine.SplitView(cde, position, sheet);
    }

    /** @returns {number} tSheet.SplitV (-1 if none); empty sheet = WASM active sheet. */
    splitFreezeCol(sheet = "") {
        const wEngine = this._requireEngine('splitFreezeCol');
        return wEngine.SplitFreezeCol(sheet);
    }

    /** @returns {number} tSheet.SplitH (-1 if none); empty sheet = WASM active sheet. */
    splitFreezeRow(sheet = "") {
        const wEngine = this._requireEngine('splitFreezeRow');
        return wEngine.SplitFreezeRow(sheet);
    }

    // Class operations
    registerClassAttribute(className, label, family) {
        const wEngine = this._requireEngine('registerClassAttribute');
        return wEngine.RegisterClassAttribute(className, label, family);
    }

    addProperty(name, type, label, order, defaultValue, kind = "") {
        const wEngine = this._requireEngine('addProperty');
        const wKind = kind != null ? String(kind) : "";

        return wEngine.AddProperty(name, type, label, order, defaultValue, wKind);
    }

    cellClass(ref, className) {
        const wEngine = this._requireEngine('cellClass');
        return wEngine.CellClass(ref, className);
    }

    jsonCellClass() {
        const wEngine = this._requireEngine('jsonCellClass');
        return wEngine.JsonCellClass();
    }

    jsonCellClassByName(className) {
        const wEngine = this._requireEngine('jsonCellClassByName');
        return wEngine.JsonCellClassByName(className);
    }

    applyUnit(ref, family, unit, sheet = "") {
        const wEngine = this._requireEngine('applyUnit');
        return wEngine.ApplyUnit(ref, family, unit, sheet);
    }

    // Movement operations
    moveCell(row, col, key, meta, top, left, bottom, right, sheet = "") {
        const wEngine = this._requireEngine('moveCell');
        return wEngine.MoveCell(row, col, key, meta, top, left, bottom, right, sheet);
    }

    moveToCell(row, col, direction, sheet = "") {
        const wEngine = this._requireEngine('moveToCell');
        return wEngine.MoveToCell(row, col, direction, sheet);
    }

    // Pixel operations
    sumPixelHeight(rowStart, rowEnd, sheet = "") {
        const wEngine = this._requireEngine('sumPixelHeight');
        return wEngine.SumPixelHeight(rowStart, rowEnd, sheet);
    }

    sumPixelWidth(colStart, colEnd, sheet = "") {
        const wEngine = this._requireEngine('sumPixelWidth');
        return wEngine.SumPixelWidth(colStart, colEnd, sheet);
    }

    maxcol() {
        const wEngine = this._requireEngine('maxcol');
        return wEngine.Maxcol();
    }

    maxrow() {
        const wEngine = this._requireEngine('maxrow');
        return wEngine.Maxrow();
    }

    ensureCell(ref, sheet = "") {
        const wEngine = this._requireEngine('ensureCell');
        return wEngine.EnsureCell(ref, sheet);
    }

    setLang(lang) {
        const wEngine = this._requireEngine('setLang');
        wEngine.SetLang(lang);
    }

    addFunction(name, label, family, nbArg) {
        return this._requireEngine('addFunction').AddFunction(name, label, family, nbArg);
    }


    raz(ref, keepFormat = false, sheet = '') {
        const wEngine = this._requireEngine('raz');
        return wEngine.Raz(ref, keepFormat, sheet);
    }

    razFormat(ref, sheet = '') {
        const wEngine = this._requireEngine('razFormat');
        return wEngine.RazFormat(ref, sheet);
    }

    getMessage(message) {
        const wEngine = this._requireEngine('getMessage');
        console.log("GetMessage " + message);
        return wEngine.GetMessage(message);
    }

    // Performance Testing
    pressure(dynamicRow, dynamicCol, sheet = '') {
        const wEngine = this._requireEngine('pressure');
        return wEngine.Pressure(dynamicRow, dynamicCol, sheet);
    }

    /** True when the WASM build exposes the cooperative _Pressure generation API. */
    hasCooperativePressure() {
        return (
            !!this.m_UISpreadSheet
            && typeof this.m_UISpreadSheet.BeginPressureCooperative === 'function'
            && typeof this.m_UISpreadSheet.StepPressureCooperative === 'function'
            && typeof this.m_UISpreadSheet.PressureCooperativeProgress === 'function'
            && typeof this.m_UISpreadSheet.EndPressureCooperative === 'function'
        );
    }

    /** Begin cooperative (non-blocking) _Pressure generation; pair with stepPressureCooperative. */
    beginPressureCooperative(dynamicRow, dynamicCol, sheet = '') {
        this._requireEngine('beginPressureCooperative').BeginPressureCooperative(dynamicRow, dynamicCol, sheet);
    }

    /** Generate up to maxRows rows; returns true once the whole grid is queued. */
    stepPressureCooperative(maxRows = 2000) {
        return this._requireEngine('stepPressureCooperative').StepPressureCooperative(maxRows);
    }

    /** Generation progress 0..100 (the blocking JsonEnd finalize runs separately). */
    pressureCooperativeProgress() {
        return this._requireEngine('pressureCooperativeProgress').PressureCooperativeProgress();
    }

    isPressureCooperativeActive() {
        return this._requireEngine('isPressureCooperativeActive').IsPressureCooperativeActive();
    }

    /** Run the blocking batch compile + cold calculate after generation completes. */
    endPressureCooperative() {
        this._requireEngine('endPressureCooperative').EndPressureCooperative();
    }
}

// Export the class
export default SkUISpreadSheet; 