//=============================================================================
// SkCellClassTextBox
// Shows the host cell text with that cell's font, color, and alignment.
// A click inside the box opens the in-place editor. The floating move edge
// still drags the object.
//=============================================================================
import React from "react";
import SkCellClass, { isSelfEditingCellClass } from "./SkCellClass.js";
import { moveFormFocus, setFormFocus } from "../SkFormInput.js";

function Render(sCell, sSpInterface) {
    return (
        <SkCellClassTextBox
            Cell={sCell}
            key={sCell.c_k}
            SpInterface={sSpInterface}
        />
    );
}

function textDecorationFromCell(sCell) {
    let wDecoration = "";
    if (sCell?.f_d_u) {
        wDecoration = "underline";
    }
    if (sCell?.f_d_l) {
        wDecoration = wDecoration ? `${wDecoration} line-through` : "line-through";
    }
    return wDecoration;
}

// The box shows the host cell text. A date scalar is the old coerced 01/01/1900, not the typed string.
function textBoxDisplayText(sCell, sStyles) {
    const wClass = sCell?.c_v?.c;
    const wType = wClass && typeof wClass === "object" ? wClass.t : "";
    if (wType === "s" || wType === "i" || wType === "d") {
        const wText = SkCellClass.normalizeWasmCellValue(wClass.v);
        if (wText) {
            return wText;
        }
    }
    if (sStyles.displayValue && sStyles.displayValue !== "[object Object]") {
        return sStyles.displayValue;
    }
    return "";
}

/** Display string and paint styles taken from the host cell. */
function textBoxFromCell(sCell) {
    const wStyles = SkCellClass.cellStylesForCanvasExport(sCell);
    return {
        text: textBoxDisplayText(sCell, wStyles),
        styles: wStyles,
        textDecoration: textDecorationFromCell(sCell),
    };
}

class SkCellClassTextBox extends SkCellClass {
    constructor(props) {
        super(props);
        const wText = textBoxFromCell(props.Cell).text;
        this.state = {
            keyboardEdit: false,
            inputValue: wText,
        };
        this.m_EditSessionActive = false;
        this.m_SuppressBlur = false;
        this.m_PlaceCaretAtEnd = false;
        this.m_OverlayLowered = false;
        this.m_OverlayZIndex = "";
        this.m_SelfEditKey = "";
        this.m_CommittedWire = wText;
        this.m_Draft = wText;
        this.inputRef = null;
    }

    static ClassName() {
        return "SkCellClassTextBox";
    }

    static cellClassCapabilities() {
        return {
            ...SkCellClass.cellClassCapabilities(),
            floatingObject: true,
            selfEditing: true,
            calculableModelValue: true,
            calculableWireType: "s",
        };
    }

    static Icon() {
        return (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%">
                <rect x="3" y="5" width="18" height="14" rx="1.5" ry="1.5"
                    fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
                <line x1="6" y1="10" x2="18" y2="10" stroke="currentColor" strokeWidth="1.5" />
                <line x1="6" y1="14" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" />
            </svg>
        );
    }

    static registerClassAttribute(sUISpreadSheet) {
        super.registerClassAttribute(sUISpreadSheet, "TextBox", "Javascript", Render);
        // Model type of CalculableValue. The engine keeps a string when this property is string.
        const wOk = sUISpreadSheet.addProperty("value", "string", "Value", 1, "");
        if (!wOk) {
            console.error("AddProperty value Error !");
        }
    }

    componentDidMount() {
        if (this.m_SpInterface) {
            this.m_SpInterface.m_SelfEditFlush = () => this.commitString();
        }
        this.registerSelfEditTarget();
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
        this.registerSelfEditTarget();
        const wText = this.textFromCell();
        if (this.state.keyboardEdit && !this.m_SpInterface?.getUseEdit?.()) {
            const wDraft = this.m_Draft != null ? String(this.m_Draft) : this.draftText();
            this.m_EditSessionActive = false;
            this.releaseEditOverlay();
            this.setState({ keyboardEdit: false, inputValue: wDraft });
            if (wDraft !== (this.m_CommittedWire || "")) {
                this.commitString(wDraft).catch((error) => {
                    console.error("Error committing text box after edit:", error);
                });
            }
            return;
        }
        if (!this.state.keyboardEdit && wText !== this.state.inputValue) {
            if (wText === "" && this.m_Draft) {
                return;
            }
            this.m_CommittedWire = wText;
            this.m_Draft = wText;
            this.setState({ inputValue: wText });
        }
        const wEditing = this.state.keyboardEdit || this.shouldActivateSelfEditingWidget();
        if (wEditing && !this.m_EditSessionActive) {
            this.m_EditSessionActive = true;
            this.focusInplaceEditor();
        } else if (!wEditing) {
            this.m_EditSessionActive = false;
        }
    }

    textFromCell(sCell) {
        return textBoxFromCell(sCell || this.m_Cell).text;
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
        const wText = sText != null ? String(sText) : "";
        sp.m_SelfEditFormulaBarBaseline = wText;
        const wStatic = sp.m_SkSpInplaceEditStatic;
        if (wStatic && typeof wStatic.setText === "function") {
            wStatic.setText(wText);
        }
    };

    draftText() {
        const wEditing = this.state.keyboardEdit || this.m_EditSessionActive;
        if (wEditing && this.inputRef && this.inputRef.value != null) {
            return String(this.inputRef.value);
        }
        if (this.m_Draft != null) {
            return String(this.m_Draft);
        }
        return this.state.inputValue != null ? String(this.state.inputValue) : "";
    }

    persistValue = async (sWire) => {
        const wWire = sWire != null ? String(sWire) : "";
        if (wWire === (this.m_CommittedWire || "") && wWire === this.textFromCell()) {
            return;
        }
        const wOk = await this.SetCalculableValue(wWire);
        if (!wOk) {
            console.error("SetCalculableValue failed for", this.cellStr(), wWire);
            return;
        }
        this.m_CommittedWire = wWire;
        this.m_Draft = wWire;
        const wClass = this.m_Cell?.c_v?.c;
        if (wClass && typeof wClass === "object") {
            wClass.t = "s";
            wClass.v = wWire;
        }
        if (this.m_SpInterface && typeof this.m_SpInterface.reloadView === "function") {
            await this.m_SpInterface.reloadView();
        }
    };

    commitString = async (sWire) => {
        const wWire = sWire != null ? String(sWire) : this.draftText();
        this.m_Draft = wWire;
        this.noteFormulaBarBaseline(wWire);
        await this.persistValue(wWire);
    };

    beginKeyboardEdit = (sChar) => {
        const wChar = sChar != null ? String(sChar) : "";
        const wSeed = wChar !== "" ? wChar : this.textFromCell();
        this.m_Draft = wSeed;
        this.m_EditSessionActive = true;
        this.m_PlaceCaretAtEnd = wChar !== "";
        this.m_SuppressBlur = true;
        this.noteFormulaBarBaseline(wSeed);
        this.lowerEditOverlay();
        this.setState({ keyboardEdit: true, inputValue: wSeed }, () => {
            const wInput = this.inputRef;
            // A cancelled session must not focus a read-only field and then blur onto body.
            if (!wInput || !this.m_EditSessionActive) {
                this.m_SuppressBlur = false;
                this.m_PlaceCaretAtEnd = false;
                return;
            }
            wInput.readOnly = false;
            wInput.tabIndex = 0;
            wInput.focus();
            if (wChar) {
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
        if (wChar && !this.state.keyboardEdit) {
            this.beginKeyboardEdit(wChar);
            return;
        }
        if (!this.state.keyboardEdit) {
            const wEdit = this.textFromCell();
            this.setState({ keyboardEdit: true, inputValue: wEdit }, () => {
                wInput.focus();
                if (typeof wInput.select === "function") {
                    wInput.select();
                }
            });
            return;
        }
        wInput.focus();
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
            const wText = this.textFromCell(this.props.Cell);
            this.m_Draft = wText;
            this.setState({ keyboardEdit: false, inputValue: wText });
        } else {
            await this.commitString();
            if (this.state.keyboardEdit) {
                this.setState({ keyboardEdit: false });
            }
        }
        this.releaseInplaceEditorFocus();
        const sp = this.m_SpInterface;
        try {
            if (sp && typeof sp.getUseEdit === "function" && sp.getUseEdit()) {
                await sp.endEdit();
            }
            if (sp?.isForm?.() && !keepFormFocus) {
                await this.reassertCursorAfterWidgetEdit();
            }
        } finally {
            this.restoreGridKeyboardFocus();
            window.setTimeout(() => {
                this.m_SuppressBlur = false;
            }, 0);
        }
    };

    leaveEditForNavigation = (e) => {
        const sp = this.m_SpInterface;
        if (!sp || e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) {
            return false;
        }
        e.preventDefault();
        e.stopPropagation();
        const wBack = e.shiftKey;
        this.exitEditSession({ cancel: false, keepFormFocus: true }).then(async () => {
            if (sp.isForm?.()) {
                await moveFormFocus(sp, wBack ? -1 : 1);
            }
        }).catch((error) => {
            console.error("Error leaving text box for navigation:", error);
        });
        return true;
    };

    handleKeyDown = (e) => {
        if (this.leaveEditForNavigation(e)) {
            return;
        }
        // Alt+Enter inserts a newline. Enter commits, same as the grid editor.
        if (e.key === "Enter" && !e.altKey) {
            e.preventDefault();
            e.stopPropagation();
            this.exitEditSession({ cancel: false }).catch((error) => {
                console.error("Error finishing text box entry:", error);
            });
        } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            this.exitEditSession({ cancel: true }).catch((error) => {
                console.error("Error cancelling text box entry:", error);
            });
        }
    };

    handleInputChange = (e) => {
        const wText = e.target.value != null ? String(e.target.value) : "";
        this.m_Draft = wText;
        this.noteFormulaBarBaseline(wText);
        this.setState({ inputValue: wText });
    };

    handleBlur = () => {
        if (this.m_SuppressBlur) {
            return;
        }
        this.commitString().catch((error) => {
            console.error("Error committing text box on blur:", error);
        });
    };

    handleFocus = (e) => {
        const wEditing = this.state.keyboardEdit
            || this.m_EditSessionActive
            || this.shouldActivateSelfEditingWidget();
        if (!wEditing) {
            // blur() with nowhere to go leaves focus on body and the canvas
            // listener stops receiving keys.
            this.m_SuppressBlur = true;
            e.target.blur();
            this.restoreGridKeyboardFocus();
            window.setTimeout(() => {
                this.m_SuppressBlur = false;
            }, 0);
            return;
        }
        if (this.m_PlaceCaretAtEnd) {
            return;
        }
        e.target.select();
    };

    /** Border band of a floating text box: let SkSpFloatingLayer drag it. */
    isFloatingMoveEdgeClick(event) {
        if (this.m_Cell?.c_fo !== true || this.m_SpInterface?.isForm?.()) {
            return false;
        }
        const wLayer = this.m_SpInterface?.m_SkSpFloatingLayer;
        const wName = SkCellClass.floatingObjectNameFromCell(this.m_Cell);
        if (!wLayer || !wName) {
            return false;
        }
        const wEntry = this.m_SpInterface.findFloatingObjectEntry?.(wName);
        const wShell = event.currentTarget?.closest?.(".SkSpFloatingObject");
        if (wEntry == null || !(wShell instanceof Element)) {
            return false;
        }
        const wBox = wLayer.layoutBoxForEntry(wEntry);
        const wRect = wShell.getBoundingClientRect();
        if (wRect.width <= 0 || wRect.height <= 0 || wBox.width <= 0 || wBox.height <= 0) {
            return false;
        }
        const wX = ((event.clientX - wRect.left) / wRect.width) * wBox.width;
        const wY = ((event.clientY - wRect.top) / wRect.height) * wBox.height;
        return wLayer.isPointerOnFloatingMoveEdge(wX, wY, wBox.width, wBox.height);
    }

    liveEditWidget() {
        const sp = this.m_SpInterface;
        const wLive = sp?.m_SelfEditTargets?.get(this.selfEditCellKey());
        return wLive || this;
    }

    enterEditFromPointer = async () => {
        const sp = this.m_SpInterface;
        if (sp && !this.isCursorOnThisCell()) {
            await this.focusCursorOnCell(null, { drag: false });
        }
        if (sp && typeof sp.getUseEdit === "function" && !sp.getUseEdit()) {
            await sp.beginEdit();
        }
        const wWidget = this.liveEditWidget();
        if (!wWidget.state?.keyboardEdit && !wWidget.m_EditSessionActive) {
            wWidget.beginKeyboardEdit("");
        }
        if (sp?.isForm?.()) {
            const wRow = Number(this.m_Cell?.c_r);
            const wCol = Number(this.m_Cell?.c_c);
            const wEl = Number.isFinite(wRow) && Number.isFinite(wCol)
                ? document.querySelector(
                    `.SkSpCellClass[data-cell-row="${wRow}"][data-cell-col="${wCol}"]`
                )
                : null;
            if (wEl) {
                setFormFocus(sp, wEl);
            }
        }
    };

    // Capture runs before the floating shell can swallow the click.
    onTextBoxMouseDownCapture = (event) => {
        if (event.button != null && event.button !== 0) {
            return;
        }
        if (this.isFloatingMoveEdgeClick(event)) {
            return;
        }
        if (this.isFormulaPickActive() || this.isGridRangePickActive()) {
            this.onCellClassMouseDownCapture(event);
            return;
        }
        if (this.shouldActivateSelfEditingWidget() || this.state.keyboardEdit) {
            return;
        }
        const spEdit = this.m_SpInterface;
        if (spEdit && typeof spEdit.getUseEdit === "function" && spEdit.getUseEdit()) {
            const wAnchor = typeof spEdit.getEditAnchorCell === "function"
                ? spEdit.getEditAnchorCell()
                : null;
            if (isSelfEditingCellClass(wAnchor) && !this.isEditAnchorOnThisCell()) {
                event.preventDefault();
                event.stopPropagation();
                void this.leaveSelfEditingSessionFor(event).then(() => this.enterEditFromPointer());
                return;
            }
            if (!isSelfEditingCellClass(wAnchor)) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
        }
        event.preventDefault();
        event.stopPropagation();
        const sp = this.m_SpInterface;
        if (sp?.isForm?.()) {
            setFormFocus(sp, event.currentTarget);
        }
        void this.enterEditFromPointer();
    };

    // While editing, keep the caret click and block the floating move handler.
    onTextBoxMouseDown = (event) => {
        if (this.isFloatingMoveEdgeClick(event)) {
            return;
        }
        if (this.shouldActivateSelfEditingWidget() || this.state.keyboardEdit) {
            event.stopPropagation();
        }
    };

    paintExportInk(ctx, width, height) {
        const wBox = textBoxFromCell(this.m_Cell);
        const wStyles = wBox.styles;
        const wPad = 4;
        const wAlign = this.m_Cell?.hasOwnProperty("f_ah")
            ? SkCellClass.canvasExportTextAlign(wStyles.textAlign)
            : "left";
        SkCellClass.applyCanvasFont(ctx, wStyles);
        ctx.textAlign = wAlign;
        ctx.textBaseline = "top";
        const wLineHeight = (wStyles.fontSizePx || 12) * 1.2;
        const wMaxW = Math.max(0, width - wPad * 2);
        const wMaxH = Math.max(0, height - wPad * 2);
        let wX = wPad;
        if (wAlign === "center") {
            wX = width / 2;
        } else if (wAlign === "right") {
            wX = width - wPad;
        }
        const wWords = String(wBox.text || "").split(/\s+/);
        let wLine = "";
        let wCy = wPad;
        for (const wWord of wWords) {
            const wTest = wLine ? `${wLine} ${wWord}` : wWord;
            if (ctx.measureText(wTest).width > wMaxW && wLine) {
                ctx.fillText(wLine, wX, wCy);
                wCy += wLineHeight;
                wLine = wWord;
                if (wCy + wLineHeight > wPad + wMaxH) {
                    break;
                }
            } else {
                wLine = wTest;
            }
        }
        if (wLine && wCy + wLineHeight <= wPad + wMaxH) {
            ctx.fillText(wLine, wX, wCy);
        }
    }

    render() {
        const wCell = this.props.Cell;
        const wBox = textBoxFromCell(wCell);
        const wStyles = wBox.styles;
        const wOverlay = this.CellClassClippedOverlayLayout({ inset: 2 });
        const wEditing = this.state.keyboardEdit || this.shouldActivateSelfEditingWidget();
        // Numbers default to "end". A text box with no explicit align stays left.
        const wCssAlign = wCell?.hasOwnProperty("f_ah")
            ? SkCellClass.canvasExportTextAlign(wStyles.textAlign)
            : "left";
        const wJustify = wCell?.hasOwnProperty("f_av")
            ? (wStyles.verticalAlign || "center")
            : "flex-start";

        const wCellStyleParent = {
            ...wOverlay.outerStyle,
            zIndex: wEditing ? 6 : 3,
            pointerEvents: "auto",
            backgroundColor: wStyles.backgroundColor,
            boxSizing: "border-box",
            overflow: "hidden",
        };
        // Full logical box. The outer slice only clips; zoom must not reflow the text into the visible part.
        const wInnerStyle = {
            ...wOverlay.innerStyle,
            display: "flex",
            flexDirection: "column",
            justifyContent: wJustify,
            pointerEvents: "auto",
            boxSizing: "border-box",
        };

        const wTextStyle = {
            width: "100%",
            padding: "4px",
            boxSizing: "border-box",
            color: wStyles.color || "black",
            fontSize: `${wStyles.fontSizePx || 12}px`,
            fontFamily: wStyles.fontFamily || "inherit",
            fontWeight: wStyles.fontWeight || "normal",
            fontStyle: wStyles.fontStyle || "normal",
            textDecoration: wBox.textDecoration,
            textAlign: wCssAlign,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            userSelect: wEditing ? "text" : "none",
            lineHeight: 1.2,
        };

        const wEditorStyle = {
            ...wTextStyle,
            height: "100%",
            flex: "1 1 auto",
            minHeight: 0,
            margin: 0,
            border: "none",
            outline: "none",
            resize: "none",
            background: "transparent",
            pointerEvents: "auto",
            overflow: "auto",
        };

        return (
            <div
                style={wCellStyleParent}
                className={this.cellClassShellClassName("SkSpCellClassTextBox")}
                {...this.cellClassDomAttrs()}
                data-sk-form-kind="SkCellClassTextBox"
                ref={this.bindShell}
                onMouseDownCapture={this.onTextBoxMouseDownCapture}
                onMouseDown={this.onTextBoxMouseDown}
            >
                <div style={wInnerStyle}>
                {wEditing ? (
                    <textarea
                        ref={(ref) => { this.inputRef = ref; }}
                        value={this.state.inputValue}
                        readOnly={!wEditing}
                        tabIndex={wEditing ? 0 : -1}
                        spellCheck={false}
                        onChange={this.handleInputChange}
                        onBlur={this.handleBlur}
                        onKeyDown={this.handleKeyDown}
                        onFocus={this.handleFocus}
                        style={wEditorStyle}
                    />
                ) : (
                    <div style={wTextStyle}>{wBox.text}</div>
                )}
                </div>
            </div>
        );
    }
}

SkCellClass.installPdfExportStatics(SkCellClassTextBox);

export default SkCellClassTextBox;
