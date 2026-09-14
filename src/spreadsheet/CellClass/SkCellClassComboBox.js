//=============================================================================
// SkCellClassComboBox
// Class ComboBox
//=============================================================================
import React from "react";
import {
    GetTextAlign,
    GetVerticalTextAlign,
    GetFontStyle,
    GetFontWeight,
    buildCanvasFontFamily,
} from '../../utility/SkUtility.js'
import { fontSizePtFromCell, fontSizeCssPxFromPt } from '../../utility/SkFontPool.js'
import SkCellClass from "./SkCellClass.js"
import SkComboBox from '../../component/SkComboBox.js'

function cssTextAlignFromCellAlign(cellAlign) {
    if (cellAlign === 'start') return 'left';
    if (cellAlign === 'end') return 'right';
    if (cellAlign === 'center') return 'center';
    return 'right';
}

function flexAlignFromCellVertical(cellVertical) {
    if (cellVertical === 'start') return 'flex-start';
    if (cellVertical === 'end') return 'flex-end';
    if (cellVertical === 'center') return 'center';
    return 'center';
}

/** Built-in list when comboOptions is empty or invalid. */
const COMBOBOX_DEFAULT_OPTIONS = [
    "Option 1",
    "Option 2",
    "Option 3",
    "Option 4",
    "Option 5",
    "Option 6" ];

function comboOptionsFromParsedList(sParsed) {
    if (!Array.isArray(sParsed)) {
        return null;
    }
    const wOptions = [];
    for (const wItem of sParsed) {
        if (typeof wItem === "string" || typeof wItem === "number") {
            wOptions.push(String(wItem));
            continue;
        }
        if (wItem && typeof wItem === "object") {
            const wValue = wItem.value ?? wItem.label ?? "";
            const wLabel = wItem.label ?? wItem.value ?? "";
            if (wValue !== "" || wLabel !== "") {
                wOptions.push({
                    value: String(wValue),
                    label: String(wLabel),
                });
            }
        }
    }
    return wOptions.length > 0 ? wOptions : null;
}

/** Accept {'a','b'} / {a,b} set notation and single-quoted pseudo-JSON. */
function parseRelaxedComboOptionsText(sText) {
    const wTrim = String(sText || "").trim();
    if (!wTrim) {
        return null;
    }
    if (wTrim.startsWith("{") && wTrim.endsWith("}")) {
        const wInner = wTrim.slice(1, -1).trim();
        if (!wInner) {
            return [];
        }
        return wInner
            .split(/[,;]/)
            .map((wPart) => wPart.trim().replace(/^['"]|['"]$/g, ""))
            .filter(Boolean);
    }
    if (wTrim.includes("'")) {
        try {
            return JSON.parse(wTrim.replace(/'/g, '"'));
        } catch (_error) {
            return null;
        }
    }
    return null;
}

/**
 * Parse comboOptions JSON into SkComboBox options (strings or { value, label }).
 * Supports: [1,2,3], ["a","b"], {'a','b'}, [{ "value": "1", "label": "One" }], { "1": "One" }.
 */
function parseComboOptionsJson(sRaw) {
    let wText = String(sRaw || "").trim();
    if (!wText) {
        return null;
    }
    if (wText.startsWith("=")) {
        wText = wText.slice(1).trim();
    }
    // Unevaluated formula body (GetProperty did not resolve) — not a JSON payload.
    if (/^JSON\s*\(/i.test(wText)) {
        console.error(
            "ComboBox comboOptions is still a formula, not evaluated JSON:",
            wText,
        );
        return null;
    }
    try {
        const wParsed = JSON.parse(wText);
        if (Array.isArray(wParsed)) {
            return comboOptionsFromParsedList(wParsed);
        }
        if (wParsed && typeof wParsed === "object") {
            const wOptions = Object.entries(wParsed).map(([wKey, wVal]) => ({
                value: String(wKey),
                label: String(wVal),
            }));
            return wOptions.length > 0 ? wOptions : null;
        }
    } catch (_error) {
        const wRelaxed = parseRelaxedComboOptionsText(wText);
        if (Array.isArray(wRelaxed)) {
            return comboOptionsFromParsedList(wRelaxed);
        }
        console.error("ComboBox parse comboOptions JSON failed:", wText);
    }
    return null;
}

function comboOptionsEqual(sLeft, sRight) {
    return JSON.stringify(sLeft) === JSON.stringify(sRight);
}

function Render(sCell,sSpInterface) {
    return(
        <SkCellClassComboBox
            Cell={sCell}
            key={`${sCell.c_r}_${sCell.c_c}`}
            SpInterface={sSpInterface}
        />
    )
}

class SkCellClassComboBox extends SkCellClass {
    constructor(props) {
        super(props)
        this.state = {
            selectedValue: '',
            comboOpen: false,
            comboInputEpoch: 0,
            options: [...COMBOBOX_DEFAULT_OPTIONS],
        };
        this.m_EditSessionActive = false;
        this.m_ComboContainerRef = React.createRef();
    }

    static ClassName() { return("SkCellClassComboBox") }

    static cellClassCapabilities() {
        return {
            ...SkCellClass.cellClassCapabilities(),
            selfEditing: true,
            calculableModelValue: true,
            calculableWireType: "s",
        };
    }

    // SVG icon representing a combobox (field + dropdown arrow)
    static Icon() {
        return (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%">
                <rect x="3" y="7" width="18" height="10" rx="1.5" ry="1.5"
                      fill="#ffffff" stroke="currentColor" strokeWidth="1.5"/>
                <line x1="16" y1="7" x2="16" y2="17"
                      stroke="currentColor" strokeWidth="1.2"/>
                <polyline points="17.5,10.5 18.5,12 19.5,10.5" fill="none"
                          stroke="currentColor" strokeWidth="1.6"
                          strokeLinecap="round" strokeLinejoin="round"/>
                <line x1="6" y1="12" x2="14" y2="12"
                      stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
        );
    }

    static registerClassAttribute(sUISpreadSheet) {
        super.registerClassAttribute(sUISpreadSheet, "ComboBox", "Javascript", Render);
        // Value lives in CalculableValue() (c_v.c.t / c_v.c.v) — edited in-cell, not Attribute panel.
        const wDefaultJson = JSON.stringify(COMBOBOX_DEFAULT_OPTIONS);
        const wOk = sUISpreadSheet.addProperty(
            "comboOptions",
            "string",
            "Options (JSON array or =JSON(range))",
            0,
            wDefaultJson,
        );
        if (!wOk) {
            console.error("AddProperty comboOptions Error !");
        }
    }

    cellAttributesDigest(sCell) {
        const wAttrs = sCell?.c_v?.c?.a;
        return Array.isArray(wAttrs) ? JSON.stringify(wAttrs) : "";
    }

    resolveComboOptionsFromRaw(sRaw) {
        const wParsed = parseComboOptionsJson(sRaw);
        return wParsed && wParsed.length > 0 ? wParsed : [...COMBOBOX_DEFAULT_OPTIONS];
    }

    async refreshComboOptionsFromCell() {
        const wRaw = await this.readPropertyValue("comboOptions", "");
        const wNext = this.resolveComboOptionsFromRaw(wRaw);
        if (!comboOptionsEqual(wNext, this.state.options)) {
            this.setState({ options: wNext });
        }
    }

    isCorruptComboCalculable(cell = this.props.Cell) {
        const wType = SkCellClass.readCalculableVariantType(cell);
        return (
            wType === SkCellClass.VARIANT_JSON_TYPE_DATE ||
            wType === "i" ||
            wType === "d"
        );
    }

    readComboValueFromCell(cell = this.props.Cell) {
        const wFromAttr = SkCellClass.readLegacyValueAttribute(cell);
        if (!this.isCorruptComboCalculable(cell)) {
            const wFromCalculable = SkCellClass.readCalculableFromCellJson(cell);
            if (wFromCalculable) {
                return wFromCalculable;
            }
        }
        if (wFromAttr) {
            return wFromAttr;
        }
        return "";
    }

    isExcelDateArtifact(rawValue) {
        if (!rawValue || typeof rawValue !== "string") {
            return false;
        }
        return /^\d{2}[-/]\d{2}[-/]\d{4}$/.test(rawValue.trim());
    }

    normalizeComboDisplayValue(rawValue) {
        if (!rawValue) {
            return "";
        }
        if (this.isExcelDateArtifact(rawValue) && !this.state.options.includes(rawValue)) {
            return "";
        }
        return rawValue;
    }

    applyStoredComboValue(rawValue) {
        const wDisplayValue = this.normalizeComboDisplayValue(rawValue);
        this.setState({ selectedValue: wDisplayValue });
        return wDisplayValue;
    }

    persistValue = async (value, options = {}) => {
        const wReloadView = options.reloadView !== false;
        const wLabel = this.normalizeComboDisplayValue(value);
        if (!wLabel) {
            return;
        }
        if (wLabel === (this.m_CalculableValue || "")) {
            return;
        }
        const wOk = await this.SetCalculableValue(wLabel);
        if (!wOk) {
            console.error("SetCalculableValue failed for", this.cellStr(), wLabel);
            return;
        }
        this.m_CalculableValue = wLabel;
        this.setState({ selectedValue: wLabel });
        if (!wReloadView) {
            return;
        }
        if (this.m_SpInterface && typeof this.m_SpInterface.reloadView === "function") {
            await this.m_SpInterface.reloadView();
        }
    };

    repairCorruptCalculableIfNeeded = async (rawValue) => {
        if (!this.isCorruptComboCalculable(this.m_Cell)) {
            return;
        }
        const wLabel = this.normalizeComboDisplayValue(
            rawValue || this.readComboValueFromCell(this.m_Cell)
        );
        if (!wLabel) {
            return;
        }
        try {
            await this.persistValue(wLabel, { reloadView: true });
        } catch (error) {
            console.error("ComboBox calculable repair failed:", error);
        }
    };

    resolveSelectedValue() {
        const wFromCell = this.normalizeComboDisplayValue(
            this.readComboValueFromCell(this.props.Cell)
        );
        const wStateValue = this.normalizeComboDisplayValue(this.state.selectedValue || "");
        // Keep optimistic selection until reloadView refreshes JsonView after SetProperty.
        if (wStateValue && wStateValue !== wFromCell) {
            return wStateValue;
        }
        return wFromCell || wStateValue;
    }

    async componentDidMount() {
        this.m_Cell = this.props.Cell;
        await this.refreshComboOptionsFromCell();
        const wStoredSync = this.readComboValueFromCell(this.m_Cell);
        const wStored = wStoredSync || await this.GetCalculableValue();
        this.m_CalculableValue = this.normalizeComboDisplayValue(wStored);
        this.applyStoredComboValue(wStored);
        void this.repairCorruptCalculableIfNeeded(wStored);
    }

    componentDidUpdate(prevProps) {
        const wPrevCell = prevProps.Cell;
        const wNextCell = this.props.Cell;
        const wCellIdentityChanged =
            wPrevCell?.c_r !== wNextCell?.c_r || wPrevCell?.c_c !== wNextCell?.c_c;
        const wAttrsChanged =
            this.cellAttributesDigest(wPrevCell) !== this.cellAttributesDigest(wNextCell);
        const wDataTick = wNextCell?.c_foMeta?.dataTick;
        const wPrevDataTick = wPrevCell?.c_foMeta?.dataTick;
        const wDataTickChanged = wDataTick !== wPrevDataTick;
        const wDisplayTick = wNextCell?.c_foMeta?.displayTick;
        const wPrevDisplayTick = wPrevCell?.c_foMeta?.displayTick;
        const wDisplayTickChanged = wDisplayTick !== wPrevDisplayTick;

        if (wAttrsChanged || wDataTickChanged || wDisplayTickChanged) {
            void this.refreshComboOptionsFromCell();
        }

        if (wCellIdentityChanged) {
            this.m_Cell = wNextCell;
            const wStored = this.readComboValueFromCell(wNextCell);
            this.applyStoredComboValue(wStored);
            this.setState({ comboOpen: false });
            void this.repairCorruptCalculableIfNeeded(wStored);
        } else if (wPrevCell !== wNextCell) {
            this.m_Cell = wNextCell;
            void this.refreshComboOptionsFromCell();
            const wStored = this.readComboValueFromCell(wNextCell);
            const wDisplayValue = this.normalizeComboDisplayValue(wStored);
            this.m_CalculableValue = wDisplayValue;
            if (wDisplayValue !== this.state.selectedValue) {
                this.setState({ selectedValue: wDisplayValue });
            }
            void this.repairCorruptCalculableIfNeeded(wStored);
        }

        const wEditing = this.shouldActivateSelfEditingWidget();
        if (wEditing && !this.m_EditSessionActive) {
            this.m_EditSessionActive = true;
            requestAnimationFrame(() => this.focusInplaceEditor());
        } else if (!wEditing && this.m_EditSessionActive) {
            this.m_EditSessionActive = false;
            if (this.state.comboOpen) {
                this.setState({ comboOpen: false });
            }
        }
    }

    focusInplaceEditor = () => {
        if (!this.shouldActivateSelfEditingWidget()) {
            return;
        }
        const sp = this.m_SpInterface;
        const wRoot = this.m_ComboContainerRef.current;
        if (!wRoot) {
            return;
        }
        const wInput = wRoot.querySelector(".SkComboBox-input");
        if (!wInput) {
            return;
        }
        const wChar =
            sp && typeof sp.lastChar === "function" ? sp.lastChar() : "";
        if (wChar) {
            wInput.value = wChar;
            const wLen = wChar.length;
            wInput.focus();
            wInput.setSelectionRange(wLen, wLen);
            if (sp && typeof sp.setLastChar === "function") {
                sp.setLastChar("");
            }
            return;
        }
        wInput.focus();
        if (typeof wInput.select === "function") {
            wInput.select();
        }
    };

    releaseInplaceEditorFocus = () => {
        const wRoot = this.m_ComboContainerRef.current;
        const wInput = wRoot ? wRoot.querySelector(".SkComboBox-input") : null;
        if (wInput && document.activeElement === wInput) {
            wInput.blur();
        }
    };

    handleComboOpenChange = (open) => {
        this.setState({ comboOpen: open });
    };

    toggleComboDropdown = (event) => {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (this.isFormulaPickActive()) {
            return;
        }
        this.setState((prevState) => ({ comboOpen: !prevState.comboOpen }));
    };

    handleComboBoxChange = (event) => {
        if (this.isFormulaPickActive()) {
            return;
        }
        const value = event.target.value;
        this.setState({ comboOpen: false });
        this.persistValue(value)
            .catch((error) => {
                console.error("Error persisting ComboBox value:", error);
            });
    }

    exitComboEditSession = async ({ cancel = false } = {}) => {
        this.m_EditSessionActive = false;

        if (cancel) {
            const wRevert = this.m_CalculableValue || this.resolveSelectedValue() || "";
            this.setState((prevState) => ({
                comboOpen: false,
                selectedValue: wRevert,
                comboInputEpoch: (prevState.comboInputEpoch || 0) + 1,
            }));
        } else {
            this.setState({ comboOpen: false });
            const wRoot = this.m_ComboContainerRef.current;
            const wInput = wRoot ? wRoot.querySelector(".SkComboBox-input") : null;
            const wTyped = wInput && typeof wInput.value === "string" ? wInput.value.trim() : "";
            if (wTyped) {
                await this.persistValue(wTyped, { reloadView: true });
            }
        }

        this.releaseInplaceEditorFocus();
        const sp = this.m_SpInterface;
        if (sp && typeof sp.getUseEdit === "function" && sp.getUseEdit()) {
            await sp.endEdit();
        }
        this.restoreGridKeyboardFocus();
    };

    handleComboKeyDown = (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            this.exitComboEditSession({ cancel: true }).catch((error) => {
                console.error("Error cancelling ComboBox edit:", error);
            });
            return;
        }
        if (event.key !== "Enter" || event.shiftKey) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.exitComboEditSession({ cancel: false }).catch((error) => {
            console.error("Error finishing ComboBox edit:", error);
        });
    };

    paintExportInk(ctx, width, height) {
        const wStyles = SkCellClass.cellStylesForCanvasExport(this.m_Cell);
        const wInset = wStyles.inset ?? 2;
        const wInnerW = Math.max(0, width - wInset * 2);
        const wInnerH = Math.max(0, height - wInset * 2);
        const wText = this.resolveSelectedValue?.() || this.state?.selectedValue || "";

        ctx.save();
        ctx.translate(wInset, wInset);
        SkCellClass.applyCanvasFont(ctx, wStyles);
        ctx.textAlign = SkCellClass.canvasExportTextAlign(wStyles.textAlign);
        ctx.textBaseline = "middle";
        const wPadL = 4;
        const wPadR = 26;
        const wX =
            wStyles.textAlign === "start"
                ? wPadL
                : wStyles.textAlign === "end"
                  ? wInnerW - wPadR
                  : wInnerW / 2;
        const wY = SkCellClass.canvasExportTextY(wStyles.verticalAlign, wInnerH);
        let wDisplay = String(wText);
        const wMaxW = Math.max(0, wInnerW - wPadL - wPadR);
        if (wMaxW > 0 && ctx.measureText(wDisplay).width > wMaxW) {
            while (wDisplay.length > 0 && ctx.measureText(`${wDisplay}…`).width > wMaxW) {
                wDisplay = wDisplay.slice(0, -1);
            }
            wDisplay += "…";
        }
        ctx.fillText(wDisplay, wX, wY);
        const wBtnW = 18;
        const wBtnH = Math.max(12, Math.min(wInnerH - 4, wInnerH * 0.9));
        const wBtnX = wInnerW - wBtnW - 2;
        const wBtnY = (wInnerH - wBtnH) / 2;
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        SkCellClass.roundRectPath(ctx, wBtnX, wBtnY, wBtnW, wBtnH, 3);
        ctx.fill();
        ctx.fillStyle = wStyles.color || "#333333";
        ctx.font = "12px Roboto";
        ctx.textAlign = "center";
        ctx.fillText("▾", wBtnX + wBtnW / 2, wBtnY + wBtnH / 2 + 0.5);
        ctx.restore();
    }

    renderComboBox(cellStyles, sComboEditActive) {
        const { options, comboOpen, comboInputEpoch } = this.state;
        const selectedValue = this.resolveSelectedValue();
        const wTextAlignCss = cssTextAlignFromCellAlign(cellStyles.textAlign);
        const wIconPad = '26px';

        const wInputStyle = {
            color: cellStyles.color || 'black',
            backgroundColor: 'transparent',
            fontFamily: cellStyles.fontFamily || 'Roboto',
            fontSize: cellStyles.fontSize || '14px',
            fontWeight: cellStyles.fontWeight || 'normal',
            fontStyle: cellStyles.fontStyle || 'normal',
            textDecoration: cellStyles.textDecoration || 'none',
            textAlign: wTextAlignCss,
            paddingLeft: '4px',
            paddingRight: wIconPad,
            cursor: sComboEditActive ? 'text' : 'default',
        };

        const wContainerStyle = {
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: flexAlignFromCellVertical(cellStyles.verticalAlign),
            position: 'relative',
            overflow: 'visible',
        };

        const wToggleStyle = {
            position: 'absolute',
            right: '2px',
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 10,
            background: 'rgba(255, 255, 255, 0.85)',
            border: 'none',
            borderRadius: '3px',
            padding: '0 4px',
            height: '90%',
            minWidth: '18px',
            cursor: 'pointer',
            fontSize: '12px',
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: cellStyles.color || 'black',
            pointerEvents: 'auto',
        };

        return (
            <div ref={this.m_ComboContainerRef} style={wContainerStyle}>
                <SkComboBox
                    key={`combo-input-${comboInputEpoch}`}
                    className="SkComboBox--cell"
                    options={options}
                    value={selectedValue}
                    onChange={this.handleComboBoxChange}
                    placeholder=""
                    style={{
                        width: '100%',
                        height: '100%',
                        alignItems: flexAlignFromCellVertical(cellStyles.verticalAlign),
                    }}
                    inputStyle={wInputStyle}
                    openOnFocus={false}
                    isOpen={comboOpen}
                    onOpenChange={this.handleComboOpenChange}
                    onKeyDown={this.handleComboKeyDown}
                    readOnly={!sComboEditActive}
                    showToggleButton={false}
                    listZIndex={200}
                    outsideClickRoot={this.m_ComboContainerRef}
                />
                <button
                    type="button"
                    className="SkCellClassComboBox-toggle"
                    tabIndex={-1}
                    aria-label="Open list"
                    onMouseDown={this.toggleComboDropdown}
                    style={wToggleStyle}
                >
                    ▾
                </button>
            </div>
        );
    }

    render() {
        this.m_Cell = this.props.Cell;
        let wCell = this.props.Cell;
        const wZIndex = 3;

        let wFontName = "Roboto";
        let wFontSizePt = 12;
        let wColor = "black";
        let wTextAlign = "end";
        let wVerticalTextAlign = "end";
        let wBackgroundColor = "white";
        let wTextDecoration = "";
        let wFontStyle = "";
        let wFontWeight = "";
        let wPadding = "0px";

        if (wCell.f_p !== "") {
            wPadding = wCell.f_p;
        }

        if (wCell.hasOwnProperty("f_c")) {
            wColor = wCell.f_c; 
        }
        if (wCell.hasOwnProperty("f_bc")) {
            wBackgroundColor = wCell.f_bc; 
        }
        if (wCell.hasOwnProperty("f_ah")) {
            wTextAlign = GetTextAlign(wCell.f_ah); 
        }
        if (wCell.hasOwnProperty("f_av")) {
            wVerticalTextAlign = GetVerticalTextAlign(wCell.f_av); 
        }
        if (wCell.hasOwnProperty("f_d_u")) {
            wTextDecoration = "underline"; 
        }
        if (wCell.hasOwnProperty("f_d_l")) {
            if (wTextDecoration !== "") {
                wTextDecoration = wTextDecoration + " line-through";
            } else {
                wTextDecoration = "line-through";
            } 
        }
        if (wCell.hasOwnProperty("f_st")) {
            wFontStyle = GetFontStyle(wCell.f_st); 
        }
        if (wCell.hasOwnProperty("f_we")) {
            wFontWeight = GetFontWeight(wCell.f_we); 
        }
        if (wCell.hasOwnProperty("f_f_n")) {
            wFontName = wCell.f_f_n;
        }
        wFontSizePt = fontSizePtFromCell(wCell, 12);
        const wFontSizeCss = fontSizeCssPxFromPt(wFontSizePt);
        const wFontFamily = buildCanvasFontFamily(wFontName);

        const wComboEditActive = this.shouldActivateSelfEditingWidget();
        const wCellInset = 2;
        const wOverlay = this.CellClassClippedOverlayLayout({
            inset: wCellInset,
            innerPadding: wPadding,
            overflow: this.state.comboOpen ? 'visible' : 'hidden',
        });

        let wCellStyleParent = {
            ...wOverlay.outerStyle,
            pointerEvents: 'auto',
            backgroundColor: wBackgroundColor,
            userSelect: wComboEditActive ? 'text' : 'none',
            zIndex: this.state.comboOpen ? 100 : wZIndex,
        };

        const wCellStyleInner = {
            ...wOverlay.innerStyle,
            backgroundColor: wBackgroundColor,
        };

        const cellStyles = {
            verticalAlign: wVerticalTextAlign,
            textAlign: wTextAlign,
            color: wColor,
            backgroundColor: wBackgroundColor,
            textDecoration: wTextDecoration,
            fontStyle: wFontStyle,
            fontWeight: wFontWeight,
            fontFamily: wFontFamily,
            fontSize: wFontSizeCss + "px",
        };

        return (
            <div
                style={wCellStyleParent}
                className="SkSpCellClass"
                {...this.cellClassDomAttrs()}
                onMouseDownCapture={this.onCellClassMouseDownCapture}
            >
                <div style={wCellStyleInner}>
                    {this.renderComboBox(cellStyles, wComboEditActive)}
                </div>
            </div>
        );
    }
}

SkCellClass.installPdfExportStatics(SkCellClassComboBox, {
    initialState: () => ({
        selectedValue: "",
        comboOpen: false,
        comboInputEpoch: 0,
        options: [...COMBOBOX_DEFAULT_OPTIONS],
    }),
    hydrate: async (painter, cell) => {
        await painter.refreshComboOptionsFromCell();
        const wStoredSync = painter.readComboValueFromCell(cell);
        const wStored = wStoredSync || (await painter.GetCalculableValue());
        painter.m_CalculableValue = painter.normalizeComboDisplayValue(wStored);
        painter.applyStoredComboValue(wStored);
    },
});

// ============================================================================
export default SkCellClassComboBox;
