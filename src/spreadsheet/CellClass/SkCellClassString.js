//=============================================================================
// SkCellClassString
// In-cell text. The host cell stores t_string. The grid formula editor stays closed.
//=============================================================================
import React from "react";
import SkCellClass from "./SkCellClass.js";
import { moveFormFocus } from "../SkFormInput.js";

export const STRING_CLASS_NAME = "SkCellClassString";

function Render(sCell, sSpInterface) {
    return (
        <SkCellClassString
            Cell={sCell}
            key={sCell.c_k}
            SpInterface={sSpInterface}
        />
    );
}

function stringFromCell(sCell) {
    return SkCellClass.readCalculableFromCellJson(sCell) || "";
}

function iconFrame() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%">
            <rect x="3" y="5" width="18" height="14" rx="1.5" ry="1.5"
                fill="none" stroke="currentColor" strokeWidth="1.5" />
            <text x="12" y="16" textAnchor="middle" fontSize="7"
                fill="currentColor" fontFamily="Roboto">Abc</text>
        </svg>
    );
}

class SkCellClassString extends SkCellClass {
    constructor(props) {
        super(props);
        const wText = stringFromCell(props.Cell);
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
        return STRING_CLASS_NAME;
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
        return iconFrame();
    }

    static registerClassAttribute(sUISpreadSheet) {
        super.registerClassAttribute(sUISpreadSheet, "String", "Javascript", Render);
        // Model type of CalculableValue, same as SkCellClassNumber's "value".
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
        const wText = stringFromCell(this.m_Cell);
        if (this.state.keyboardEdit && !this.m_SpInterface?.getUseEdit?.()) {
            const wDraft = this.m_Draft != null ? String(this.m_Draft) : this.draftText();
            this.m_EditSessionActive = false;
            this.releaseEditOverlay();
            this.setState({ keyboardEdit: false, inputValue: wDraft });
            if (wDraft !== (this.m_CommittedWire || "")) {
                this.commitString(wDraft).catch((error) => {
                    console.error("Error committing string after edit:", error);
                });
            }
            return;
        }
        if (!this.state.keyboardEdit && wText !== this.state.inputValue) {
            // A reload can arrive before the scalar is visible. Keep the typed text.
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
        if (wWire === (this.m_CommittedWire || "") && wWire === stringFromCell(this.m_Cell)) {
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
        const wSeed = wChar !== "" ? wChar : stringFromCell(this.m_Cell);
        this.m_Draft = wSeed;
        this.m_EditSessionActive = true;
        this.m_PlaceCaretAtEnd = wChar !== "";
        this.m_SuppressBlur = true;
        this.noteFormulaBarBaseline(wSeed);
        this.lowerEditOverlay();
        this.setState({ keyboardEdit: true, inputValue: wSeed }, () => {
            const wInput = this.inputRef;
            if (!wInput) {
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
            const wEdit = stringFromCell(this.m_Cell);
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
            const wText = stringFromCell(this.props.Cell);
            this.setState({ keyboardEdit: false, inputValue: wText });
        } else {
            await this.commitString();
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
            console.error("Error leaving string field for navigation:", error);
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
                console.error("Error finishing string entry:", error);
            });
        } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            this.exitEditSession({ cancel: true }).catch((error) => {
                console.error("Error cancelling string entry:", error);
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
            console.error("Error committing string on blur:", error);
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
        const wText = stringFromCell(this.m_Cell);
        const wPad = 4;
        SkCellClass.applyCanvasFont(ctx, wStyles);
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(wText, wPad, height / 2);
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
                data-sk-form-kind={STRING_CLASS_NAME}
                ref={this.bindShell}
                onMouseDownCapture={this.onCellClassMouseDownCapture}
            >
                <input
                    ref={(ref) => { this.inputRef = ref; }}
                    type="text"
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
                        textAlign: "left",
                        padding: "0 4px",
                        boxSizing: "border-box",
                    }}
                />
            </div>
        );
    }
}

SkCellClass.installPdfExportStatics(SkCellClassString);

export default SkCellClassString;
