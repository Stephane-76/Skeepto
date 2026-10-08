//=============================================================================
// SkCellClassNumber
// One numeric field. Palette tools Int, Float and Currency set the mode
// and the cell number format. The host cell stores t_int or t_double.
//=============================================================================
import React from "react";
import SkCellClass from "./SkCellClass.js";
import { moveFormFocus } from "../SkFormInput.js";
import { getSpreadsheetLang } from "../SkeeptoLang.js";

export const NUMBER_CLASS_NAME = "SkCellClassNumber";

const NUMBER_MODES = ["int", "float", "currency"];

const NUMBER_FORMAT = {
    int: "#,##0",
    float: "#,##0.00",
};

// Same symbols as the format menu. Currency puts the symbol next to the number.
const LANG_MONEY_SYMBOL = {
    us: "$",
    en: "£",
    de: "€",
    fr: "€",
    sp: "€",
    it: "€",
};

function currencyFormatString() {
    const wLang = getSpreadsheetLang();
    const wSymbol = LANG_MONEY_SYMBOL[wLang] || "€";
    if (wLang === "us" || wLang === "en") {
        return `${wSymbol} #,##0.00`;
    }
    return `#,##0.00 ${wSymbol}`;
}

function normalizeMode(sMode) {
    const wMode = String(sMode || "").trim();
    return NUMBER_MODES.includes(wMode) ? wMode : "float";
}

function decimalSeparator() {
    try {
        const wParts = new Intl.NumberFormat(undefined).formatToParts(1.1);
        const wDec = wParts.find((wPart) => wPart.type === "decimal");
        return wDec?.value || ".";
    } catch (e) {
        return ".";
    }
}

function modeFromCell(sCell) {
    let wRaw = SkCellClass.readPropertyFromCellJson(sCell, "mode");
    if (!wRaw) {
        const wAttr = SkCellClass.readPropertyAttrEntry(sCell, "mode");
        if (wAttr != null && wAttr.f != null) {
            wRaw = String(wAttr.f).trim().replace(/^=/, "");
        }
    }
    return normalizeMode(wRaw);
}

function storedNumber(sCell) {
    const wClass = sCell?.c_v?.c;
    const wType = wClass && typeof wClass === "object" ? wClass.t : "";
    if (wType !== "i" && wType !== "d") {
        return null;
    }
    const wNum = Number(wClass.v);
    return Number.isFinite(wNum) ? wNum : null;
}

function intlCurrencyCode() {
    const wLang = getSpreadsheetLang();
    if (wLang === "us") {
        return "USD";
    }
    if (wLang === "en") {
        return "GBP";
    }
    return "EUR";
}

function fallbackFormat(sNumber, sMode) {
    const wMode = normalizeMode(sMode);
    try {
        if (wMode === "currency") {
            return new Intl.NumberFormat(undefined, {
                style: "currency",
                currency: intlCurrencyCode(),
            }).format(sNumber);
        }
        if (wMode === "int") {
            return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(sNumber);
        }
        return new Intl.NumberFormat(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(sNumber);
    } catch (e) {
        return String(sNumber);
    }
}

function displayText(sCell, sMode) {
    const wFormatted = sCell?.f_value != null ? String(sCell.f_value) : "";
    if (wFormatted && wFormatted !== "[object Object]") {
        return wFormatted;
    }
    const wNum = storedNumber(sCell);
    if (wNum == null) {
        return "";
    }
    return fallbackFormat(wNum, sMode);
}

// Edit text is the raw number. The currency symbol stays in the idle display.
function editTextFromCell(sCell, sMode) {
    const wNum = storedNumber(sCell);
    if (wNum == null) {
        return "";
    }
    const wMode = normalizeMode(sMode);
    if (wMode === "int") {
        return String(Math.trunc(wNum));
    }
    const wDec = decimalSeparator();
    const wText = String(wNum);
    return wDec === "." ? wText : wText.replace(".", wDec);
}

function sanitizeDraft(sText, sMode) {
    const wMode = normalizeMode(sMode);
    const wDec = decimalSeparator();
    const wGroup = wDec === "," ? "." : ",";
    let wOut = "";
    let wSawDigit = false;
    let wSawDec = false;
    const wChars = String(sText || "");
    for (let wIndex = 0; wIndex < wChars.length; wIndex += 1) {
        const wCh = wChars[wIndex];
        if (wCh >= "0" && wCh <= "9") {
            wOut += wCh;
            wSawDigit = true;
            continue;
        }
        if (wCh === "-" && wOut === "") {
            wOut = "-";
            continue;
        }
        if (wCh === " " || wCh === "\u00a0" || wCh === wGroup) {
            if (wMode === "int" && wCh === wGroup && !wSawDec) {
                wOut += wCh;
                wSawDec = true;
            }
            continue;
        }
        if (wCh === wDec && !wSawDec) {
            if (wMode === "int") {
                wOut += wCh;
                wSawDec = true;
                continue;
            }
            if (!wSawDigit) {
                wOut += "0";
            }
            wOut += wDec;
            wSawDec = true;
        }
    }
    return wOut;
}

// Canonical wire uses a dot so the engine does not depend on the locale.
function canonicalWire(sDraft, sMode) {
    const wMode = normalizeMode(sMode);
    const wText = String(sDraft || "").trim();
    if (!wText || wText === "-" || wText === decimalSeparator()) {
        return null;
    }
    if (wMode === "int") {
        if (!/^-?\d+$/.test(wText)) {
            return null;
        }
        return wText;
    }
    const wDec = decimalSeparator();
    let wWire = wText;
    if (wWire.endsWith(wDec)) {
        wWire = wWire.slice(0, -1);
    }
    if (wDec !== ".") {
        wWire = wWire.split(wDec).join(".");
    }
    if (!/^-?\d+(\.\d+)?$/.test(wWire)) {
        return null;
    }
    return wWire;
}

export function numberFormatForMode(sMode) {
    const wMode = normalizeMode(sMode);
    if (wMode === "currency") {
        return currencyFormatString();
    }
    return NUMBER_FORMAT[wMode];
}

const wModeFormatEnsured = new Set();

if (typeof window !== "undefined") {
    window.addEventListener("skeeptoLangChange", () => {
        wModeFormatEnsured.clear();
    });
}

function widgetSheet(sWidget) {
    const wSheet = sWidget?.m_SpInterface?.m_UIView?.sheet;
    return typeof wSheet === "string" ? wSheet : "";
}

function formatMatchesMode(sFormat, sMode) {
    const wFormat = String(sFormat || "").replace(/"/g, "");
    const wMode = normalizeMode(sMode);
    if (wMode === "currency") {
        return wFormat.includes(numberFormatForMode(wMode));
    }
    if (/[$€£¥]/.test(wFormat)) {
        return false;
    }
    if (wMode === "int") {
        return /#,##0(?!\.00)/.test(wFormat);
    }
    return wFormat.includes("#,##0.00");
}

// Idle display follows the cell format. Re-apply it when Mode changes.
// Skip when the view has no saved mode: guessing "float" would wipe the
// format applyNumberMode just wrote.
function ensureNumberCellFormat(sWidget) {
    const wRef = typeof sWidget.cellStr === "function" ? sWidget.cellStr() : "";
    const wStored = SkCellClass.readPropertyFromCellJson(sWidget.m_Cell, "mode");
    if (!NUMBER_MODES.includes(String(wStored || "").trim())) {
        return;
    }
    const wMode = modeFromCell(sWidget.m_Cell);
    const wSheet = widgetSheet(sWidget);
    // Language is part of the key: switching to US must replace a stored € format.
    const wKey = `${wSheet}:${wRef}:${wMode}:${getSpreadsheetLang()}`;
    if (!wRef || wModeFormatEnsured.has(wKey)) {
        return;
    }
    const wUi = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
    if (!wUi || typeof wUi.applyFormatString !== "function") {
        return;
    }
    if (
        typeof wUi.getFormat === "function" &&
        formatMatchesMode(wUi.getFormat(wRef, wSheet), wMode)
    ) {
        wModeFormatEnsured.add(wKey);
        return;
    }
    wModeFormatEnsured.add(wKey);
    wUi.applyFormatString(wRef, `"${numberFormatForMode(wMode)}"`, wSheet);
    const sp = sWidget.m_SpInterface;
    if (sp && typeof sp.reloadView === "function") {
        sp.reloadView();
    }
}

function alignSheet(sUi, sSheet) {
    const wSheet = typeof sSheet === "string" ? sSheet : "";
    if (wSheet && typeof sUi.setActiveSheet === "function") {
        sUi.setActiveSheet(wSheet);
    }
    return wSheet;
}

// Engine value of the mode attribute. Empty when the cell has no such token.
export function readStoredNumberMode(sUi, sRef, sSheet = "") {
    if (!sUi || !sRef || typeof sUi.getValueAttribute !== "function") {
        return "";
    }
    const wSheet = alignSheet(sUi, sSheet);
    const wRaw = String(sUi.getValueAttribute(sRef, "mode", wSheet) || "").trim();
    if (!wRaw || wRaw.startsWith("#") || wRaw === "Null") {
        return "";
    }
    const wToken = wRaw.replace(/^=/, "").replace(/^"+|"+$/g, "").trim();
    return NUMBER_MODES.includes(wToken) ? wToken : "";
}

export function applyNumberMode(sUi, sRef, sMode, sSheet = "") {
    if (!sUi || !sRef) {
        return false;
    }
    const wMode = normalizeMode(sMode);
    const wSheet = alignSheet(sUi, sSheet);
    let wOk = false;
    if (typeof sUi.valueAttribute === "function") {
        wOk = sUi.valueAttribute(sRef, "mode", wMode, wSheet) !== false;
    }
    if (typeof sUi.applyFormatString === "function") {
        sUi.applyFormatString(sRef, `"${numberFormatForMode(wMode)}"`, wSheet);
    }
    return wOk;
}

function iconFrame(sLabel) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%">
            <rect x="3" y="5" width="18" height="14" rx="1.5" ry="1.5"
                fill="none" stroke="currentColor" strokeWidth="1.5" />
            <text x="12" y="16" textAnchor="middle" fontSize="8"
                fill="currentColor" fontFamily="Roboto">{sLabel}</text>
        </svg>
    );
}

export function numberPaletteEntries() {
    return [
        { mode: "int", label: "Int", icon: () => iconFrame("123") },
        { mode: "float", label: "Float", icon: () => iconFrame("1.2") },
        { mode: "currency", label: "Currency", icon: () => iconFrame("€") },
    ];
}

function Render(sCell, sSpInterface) {
    return (
        <SkCellClassNumber
            Cell={sCell}
            key={sCell.c_k}
            SpInterface={sSpInterface}
        />
    );
}

class SkCellClassNumber extends SkCellClass {
    constructor(props) {
        super(props);
        const wCell = props.Cell;
        const wMode = modeFromCell(wCell);
        this.state = {
            mode: wMode,
            keyboardEdit: false,
            inputValue: displayText(wCell, wMode),
        };
        this.m_EditSessionActive = false;
        this.m_SuppressBlur = false;
        this.m_PlaceCaretAtEnd = false;
        this.m_OverlayLowered = false;
        this.m_OverlayZIndex = "";
        this.m_SelfEditKey = "";
        this.m_CommittedWire = "";
        this.inputRef = null;
    }

    static ClassName() {
        return NUMBER_CLASS_NAME;
    }

    static cellClassCapabilities() {
        return {
            ...SkCellClass.cellClassCapabilities(),
            floatingObject: true,
            selfEditing: true,
            calculableModelValue: true,
        };
    }

    static Icon() {
        return iconFrame("123");
    }

    static registerClassAttribute(sUISpreadSheet) {
        super.registerClassAttribute(sUISpreadSheet, "Number", "Javascript", Render);
        const wOk = sUISpreadSheet.addProperty(
            "mode",
            "string",
            "Mode",
            1,
            "float",
            "enum:int,float,currency",
        );
        if (!wOk) {
            console.error("AddProperty mode Error !");
        }
        // Model type of CalculableValue. Mode still picks int, float, or currency.
        const wValueOk = sUISpreadSheet.addProperty("value", "double", "Value", 2, "");
        if (!wValueOk) {
            console.error("AddProperty value Error !");
        }
    }

    mode() {
        return normalizeMode(this.state.mode);
    }

    displayTextFor(sCell) {
        return displayText(sCell || this.props.Cell || this.m_Cell, this.mode());
    }

    componentDidMount() {
        if (this.m_SpInterface) {
            this.m_SpInterface.m_SelfEditFlush = () => this.validateNumber();
        }
        this.registerSelfEditTarget();
        ensureNumberCellFormat(this);
        const wCell = this.m_Cell;
        const wStored = SkCellClass.readCalculableFromCellJson(wCell);
        this.m_CommittedWire = wStored && (wCell?.c_v?.c?.t === "i" || wCell?.c_v?.c?.t === "d")
            ? String(wStored).replace(",", ".")
            : "";
    }

    componentWillUnmount() {
        this.unregisterSelfEditTarget();
        this.releaseEditOverlay();
        if (this.m_SpInterface && this.m_SpInterface.m_SelfEditFlush != null) {
            this.m_SpInterface.m_SelfEditFlush = null;
        }
    }

    componentDidUpdate() {
        if (this.props.Cell) {
            this.m_Cell = this.props.Cell;
        }
        ensureNumberCellFormat(this);
        this.registerSelfEditTarget();
        const wMode = modeFromCell(this.m_Cell);
        if (this.state.keyboardEdit && !this.m_SpInterface?.getUseEdit?.()) {
            this.m_EditSessionActive = false;
            this.releaseEditOverlay();
            this.setState({
                keyboardEdit: false,
                mode: wMode,
                inputValue: displayText(this.m_Cell, wMode),
            });
            return;
        }
        if (!this.state.keyboardEdit) {
            const wDisplay = displayText(this.m_Cell, wMode);
            if (wMode !== this.state.mode || wDisplay !== this.state.inputValue) {
                this.setState({ mode: wMode, inputValue: wDisplay });
            }
        }
        const wEditing = this.state.keyboardEdit || this.shouldActivateSelfEditingWidget();
        if (wEditing && !this.m_EditSessionActive) {
            this.m_EditSessionActive = true;
            this.focusInplaceEditor();
        } else if (!wEditing) {
            this.m_EditSessionActive = false;
        }
    }

    selfEditCellKey() {
        const wCell = this.props.Cell || this.m_Cell;
        return `${Number(wCell?.c_r)}:${Number(wCell?.c_c)}`;
    }

    registerSelfEditTarget() {
        const sp = this.m_SpInterface;
        if (!sp) {
            return;
        }
        if (!sp.m_SelfEditTargets) {
            sp.m_SelfEditTargets = new Map();
        }
        const wKey = this.selfEditCellKey();
        if (this.m_SelfEditKey && this.m_SelfEditKey !== wKey) {
            const wPrev = sp.m_SelfEditTargets.get(this.m_SelfEditKey);
            if (wPrev === this) {
                sp.m_SelfEditTargets.delete(this.m_SelfEditKey);
            }
        }
        this.m_SelfEditKey = wKey;
        sp.m_SelfEditTargets.set(wKey, this);
    }

    unregisterSelfEditTarget() {
        const sp = this.m_SpInterface;
        if (!sp?.m_SelfEditTargets || !this.m_SelfEditKey) {
            return;
        }
        if (sp.m_SelfEditTargets.get(this.m_SelfEditKey) === this) {
            sp.m_SelfEditTargets.delete(this.m_SelfEditKey);
        }
        this.m_SelfEditKey = "";
    }

    bindShell = (el) => {
        this.m_Shell = el;
        if (el) {
            el.__skWidget = this;
            this.syncFormFocusShell(el);
        }
    };

    lowerEditOverlay() {
        if (this.m_OverlayLowered || typeof document === "undefined") {
            return;
        }
        const wOverlay = document.getElementById("GridCanvasOverlay");
        if (!wOverlay) {
            return;
        }
        this.m_OverlayZIndex = wOverlay.style.zIndex;
        wOverlay.style.zIndex = "1";
        this.m_OverlayLowered = true;
    }

    releaseEditOverlay() {
        if (!this.m_OverlayLowered || typeof document === "undefined") {
            return;
        }
        const wOverlay = document.getElementById("GridCanvasOverlay");
        if (wOverlay) {
            wOverlay.style.zIndex = this.m_OverlayZIndex || "";
        }
        this.m_OverlayLowered = false;
    }

    noteFormulaBarBaseline = (sText) => {
        const sp = this.m_SpInterface;
        if (!sp) {
            return;
        }
        const wStatic = sp.m_SkSpInplaceEditStatic;
        let wText = sText != null ? String(sText) : null;
        if (wText == null && wStatic && typeof wStatic.text === "function") {
            wText = String(wStatic.text() ?? "");
        }
        if (wText == null) {
            return;
        }
        sp.m_SelfEditFormulaBarBaseline = wText;
        if (sText != null && wStatic && typeof wStatic.setText === "function") {
            wStatic.setText(wText);
        }
    };

    persistValue = async (sWire) => {
        const wWire = sWire != null ? String(sWire) : "";
        if (wWire === (this.m_CommittedWire || "")) {
            return;
        }
        const wOk = await this.SetCalculableValue(wWire);
        if (!wOk) {
            console.error("SetCalculableValue failed for", this.cellStr(), wWire);
            return;
        }
        this.m_CommittedWire = wWire;
        if (this.m_SpInterface && typeof this.m_SpInterface.reloadView === "function") {
            await this.m_SpInterface.reloadView();
        }
    };

    validateNumber = async () => {
        const wMode = this.mode();
        const wDraft = sanitizeDraft(this.state.inputValue, wMode);
        if (!wDraft || wDraft === "-") {
            this.noteFormulaBarBaseline("");
            await this.persistValue("");
            this.setState({ inputValue: "" });
            return;
        }
        const wWire = canonicalWire(wDraft, wMode);
        if (!wWire) {
            this.setState({ inputValue: this.displayTextFor(this.props.Cell) });
            return;
        }
        this.noteFormulaBarBaseline(wWire);
        await this.persistValue(wWire);
        const wCell = this.props.Cell || this.m_Cell;
        this.setState({ inputValue: displayText(wCell, wMode) });
    };

    beginKeyboardEdit = (sChar) => {
        const wChar = sChar != null ? String(sChar) : "";
        const wMode = modeFromCell(this.m_Cell);
        const wSan = wChar ? sanitizeDraft(wChar, wMode) : "";
        const wSeed = wChar
            ? (wSan !== "" ? wSan : editTextFromCell(this.m_Cell, wMode))
            : editTextFromCell(this.m_Cell, wMode);
        this.m_EditSessionActive = true;
        this.m_PlaceCaretAtEnd = wChar !== "" && wSan !== "";
        this.m_SuppressBlur = true;
        if (wSeed) {
            this.noteFormulaBarBaseline(wSeed);
        }
        this.lowerEditOverlay();
        this.setState({ keyboardEdit: true, mode: wMode, inputValue: wSeed }, () => {
            const wInput = this.inputRef;
            if (!wInput) {
                this.m_SuppressBlur = false;
                this.m_PlaceCaretAtEnd = false;
                return;
            }
            wInput.readOnly = false;
            wInput.tabIndex = 0;
            wInput.focus();
            if (wSeed && wChar) {
                const wLen = String(wInput.value || "").length;
                wInput.setSelectionRange(wLen, wLen);
            } else if (typeof wInput.select === "function") {
                wInput.select();
            }
            this.m_PlaceCaretAtEnd = false;
            const sp = this.m_SpInterface;
            if (wChar && sp && typeof sp.setLastChar === "function") {
                sp.setLastChar("");
            }
            window.setTimeout(() => {
                this.m_SuppressBlur = false;
            }, 0);
        });
    };

    focusInplaceEditor = () => {
        if (!this.state.keyboardEdit && !this.shouldActivateSelfEditingWidget()) {
            return;
        }
        const sp = this.m_SpInterface;
        const wInput = this.inputRef;
        if (!wInput) {
            return;
        }
        const wChar = sp && typeof sp.lastChar === "function" ? sp.lastChar() : "";
        if (wChar) {
            const wSan = sanitizeDraft(wChar, this.mode());
            const wSeed = wSan !== "" ? wSan : editTextFromCell(this.m_Cell, this.mode());
            this.noteFormulaBarBaseline(wSeed);
            this.setState({ keyboardEdit: true, inputValue: wSeed }, () => {
                wInput.focus();
                const wLen = String(wSeed || "").length;
                if (wLen > 0) {
                    wInput.setSelectionRange(wLen, wLen);
                }
                if (sp && typeof sp.setLastChar === "function") {
                    sp.setLastChar("");
                }
            });
            return;
        }
        if (!this.state.keyboardEdit) {
            const wEdit = editTextFromCell(this.m_Cell, this.mode());
            this.setState({ keyboardEdit: true, inputValue: wEdit }, () => {
                wInput.focus();
                if (typeof wInput.select === "function") {
                    wInput.select();
                }
            });
            return;
        }
        wInput.focus();
        if (typeof wInput.select === "function" && !this.m_PlaceCaretAtEnd) {
            wInput.select();
        }
    };

    releaseInplaceEditorFocus = () => {
        const wInput = this.inputRef;
        if (wInput && document.activeElement === wInput) {
            wInput.blur();
        }
    };

    exitEditSession = async ({ cancel = false, keepFormFocus = false } = {}) => {
        this.m_SuppressBlur = true;
        this.m_EditSessionActive = false;
        this.releaseEditOverlay();
        if (cancel) {
            this.setState({
                keyboardEdit: false,
                inputValue: this.displayTextFor(this.props.Cell),
            });
        } else {
            await this.validateNumber();
            if (this.state.keyboardEdit) {
                this.setState({ keyboardEdit: false });
            }
        }
        this.releaseInplaceEditorFocus();
        const sp = this.m_SpInterface;
        if (sp && typeof sp.getUseEdit === "function" && sp.getUseEdit()) {
            await sp.endEdit();
        }
        if (sp?.isForm?.() && !keepFormFocus) {
            await this.reassertCursorAfterWidgetEdit();
        }
        this.restoreGridKeyboardFocus();
        this.m_SuppressBlur = false;
    };

    leaveEditForNavigation = (e) => {
        const sp = this.m_SpInterface;
        if (!sp || e.altKey || e.ctrlKey || e.metaKey) {
            return false;
        }
        const wForm = sp.isForm?.() === true;
        const wArrow = e.key === "ArrowLeft" || e.key === "ArrowRight"
            || e.key === "ArrowUp" || e.key === "ArrowDown";
        const wTab = e.key === "Tab";
        if (wForm) {
            if (!wTab && !wArrow) {
                return false;
            }
        } else if (!wArrow) {
            return false;
        }
        e.preventDefault();
        e.stopPropagation();
        const wBack = e.key === "ArrowLeft" || e.key === "ArrowUp" || (wTab && e.shiftKey);
        this.exitEditSession({ cancel: false, keepFormFocus: true }).then(async () => {
            if (wForm) {
                await moveFormFocus(sp, wBack ? -1 : 1);
            } else if (typeof sp.cursorMoveKey === "function") {
                await sp.cursorMoveKey(e);
            }
        }).catch((error) => {
            console.error("Error leaving number field for navigation:", error);
        });
        return true;
    };

    handleKeyDown = (e) => {
        if (this.leaveEditForNavigation(e)) {
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            this.exitEditSession({ cancel: false }).catch((error) => {
                console.error("Error finishing number entry:", error);
            });
        } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            this.exitEditSession({ cancel: true }).catch((error) => {
                console.error("Error cancelling number entry:", error);
            });
        }
    };

    handleInputChange = (e) => {
        const wDraft = sanitizeDraft(e.target.value, this.mode());
        this.noteFormulaBarBaseline(wDraft);
        this.setState({ inputValue: wDraft });
    };

    handleBlur = () => {
        if (this.m_SuppressBlur) {
            return;
        }
        this.validateNumber().catch((error) => {
            console.error("Error validating number on blur:", error);
        });
    };

    handleFocus = (e) => {
        const wEditing = this.state.keyboardEdit
            || this.m_EditSessionActive
            || this.shouldActivateSelfEditingWidget();
        if (!wEditing) {
            e.target.blur();
            return;
        }
        if (this.m_PlaceCaretAtEnd) {
            return;
        }
        e.target.select();
    };

    handleZoneMouseDown = (event) => {
        if (event.button !== 0) {
            return;
        }
        if (this.isFormulaPickActive()) {
            return;
        }
        if (this.shouldActivateSelfEditingWidget() || this.state.keyboardEdit) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const sp = this.m_SpInterface;
        void (async () => {
            if (sp && !this.isCursorOnThisCell()) {
                await this.focusCursorOnCell(null, { drag: false });
            }
            if (sp && typeof sp.getUseEdit === "function" && !sp.getUseEdit()) {
                await sp.beginEdit();
            }
            this.beginKeyboardEdit("");
        })();
    };

    paintExportInk(ctx, width, height) {
        const wStyles = SkCellClass.cellStylesForCanvasExport(this.m_Cell);
        const wText = displayText(this.m_Cell, this.mode());
        const wPad = 4;
        SkCellClass.applyCanvasFont(ctx, wStyles);
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(wText, Math.max(0, width - wPad), height / 2);
    }

    render() {
        const wCell = this.props.Cell;
        const wStyles = SkCellClass.cellStylesForCanvasExport(wCell);
        const wOverlay = this.CellClassClippedOverlayLayout({ inset: 2 });
        const wEditing = this.state.keyboardEdit || this.shouldActivateSelfEditingWidget();
        const wCellStyleParent = {
            ...wOverlay.outerStyle,
            zIndex: wEditing ? 6 : (wOverlay.outerStyle?.zIndex || 3),
            pointerEvents: "auto",
            backgroundColor: wStyles.backgroundColor,
            boxSizing: "border-box",
        };
        return (
            <div
                style={wCellStyleParent}
                className={this.cellClassShellClassName()}
                {...this.cellClassDomAttrs()}
                data-sk-form-kind={NUMBER_CLASS_NAME}
                ref={this.bindShell}
                onMouseDownCapture={this.onCellClassMouseDownCapture}
            >
                <input
                    ref={(ref) => { this.inputRef = ref; }}
                    type="text"
                    inputMode={this.mode() === "int" ? "numeric" : "decimal"}
                    value={this.state.inputValue}
                    readOnly={!wEditing}
                    tabIndex={wEditing ? 0 : -1}
                    onChange={this.handleInputChange}
                    onBlur={this.handleBlur}
                    onKeyDown={this.handleKeyDown}
                    onFocus={this.handleFocus}
                    onMouseDown={this.handleZoneMouseDown}
                    style={{
                        width: "100%",
                        height: "100%",
                        border: "none",
                        outline: "none",
                        background: "transparent",
                        color: wStyles.color || "black",
                        fontSize: `${wStyles.fontSizePx || 12}px`,
                        fontFamily: wStyles.fontFamily || "inherit",
                        fontWeight: wStyles.fontWeight || "normal",
                        fontStyle: wStyles.fontStyle || "normal",
                        textAlign: "right",
                        padding: "0 4px",
                        boxSizing: "border-box",
                    }}
                />
            </div>
        );
    }
}

SkCellClass.installPdfExportStatics(SkCellClassNumber);

export default SkCellClassNumber;
