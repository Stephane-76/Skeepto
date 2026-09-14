//=============================================================================
// SkCellClassCheck
// Class Check
//=============================================================================
import React from "react";
import { GetTextAlign, GetVerticalTextAlign } from '../../utility/SkUtility.js'
import { fontSizePtFromCell, fontSizeCssPxFromPt } from '../../utility/SkFontPool.js'
import SkCellClass from "./SkCellClass.js"

function flexJustifyFromCellAlign(cellAlign) {
    if (cellAlign === 'start') return 'flex-start';
    if (cellAlign === 'end') return 'flex-end';
    if (cellAlign === 'center') return 'center';
    return 'center';
}

function flexAlignFromCellVertical(cellVertical) {
    if (cellVertical === 'start') return 'flex-start';
    if (cellVertical === 'end') return 'flex-end';
    if (cellVertical === 'center') return 'center';
    return 'center';
}

function Render(sCell,sSpInterface) {
    return(<SkCellClassCheck Cell={sCell} key={sCell.c_k} SpInterface={sSpInterface}></SkCellClassCheck>)
}

class SkCellClassCheck extends SkCellClass  {
    constructor(props) {
        super(props)
        this.state = {
            isChecked: false
        };
    }

    static ClassName() { return("SkCellClassCheck") }

    static cellClassCapabilities() {
        return {
            ...SkCellClass.cellClassCapabilities(),
            inplaceEditBlocked: true,
            calculableModelValue: true,
            calculableWireType: SkCellClass.VARIANT_JSON_TYPE_BOOL,
        };
    }

    // SVG icon representing a checkbox with a check mark
    static Icon() {
        return (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%">
                <rect x="4" y="4" width="16" height="16" rx="2" ry="2"
                      fill="#ffffff" stroke="currentColor" strokeWidth="1.5"/>
                <polyline points="7,12 11,16 17,8" fill="none"
                          stroke="currentColor" strokeWidth="2.2"
                          strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
        );
    }

    static registerClassAttribute(sUISpreadSheet) {
        super.registerClassAttribute(sUISpreadSheet, "Check", "Javascript", Render);
        // Value lives in CalculableValue() (c_v.c.t / c_v.c.v) — edited in-cell, not Attribute panel.
        const wOk = sUISpreadSheet.addProperty("label", "string", "Label", 0, "");
        if (!wOk) {
            console.error("AddProperty label Error !");
        }
    }

    persistValue = async (isChecked, options = {}) => {
        const wReloadView = options.reloadView !== false;
        const wVariantWire = SkCellClass.formatVariantBoolWire(!!isChecked);
        if (wVariantWire === (this.m_CalculableValue || "")) {
            return;
        }
        const wOk = await this.SetCalculableValue(wVariantWire);
        if (!wOk) {
            console.error("SetCalculableValue failed for", this.cellStr(), wVariantWire);
            return;
        }
        this.m_CalculableValue = wVariantWire;
        if (!wReloadView) {
            return;
        }
        if (this.m_SpInterface && typeof this.m_SpInterface.reloadView === "function") {
            await this.m_SpInterface.reloadView();
        }
    }

    async componentDidMount() {
        try {
            const wStoredSync = SkCellClass.readCalculableFromCellJson(this.m_Cell);
            const wLegacy = SkCellClass.readLegacyCheckedAttribute(this.m_Cell);
            const wStored = wStoredSync || (wLegacy !== null ? SkCellClass.formatVariantBoolWire(wLegacy) : "")
                || await this.GetCalculableValue();
            this.m_CalculableValue = wStored;
            const wChecked = SkCellClass.parseCalculableBool(wStored);
            this.setState({ isChecked: wChecked });

            const wVariantType = SkCellClass.readCalculableVariantType(this.m_Cell);
            const wNeedsBoolMigration =
                wVariantType !== SkCellClass.VARIANT_JSON_TYPE_BOOL &&
                (wLegacy !== null
                    || wVariantType === SkCellClass.VARIANT_JSON_TYPE_DATE
                    || wVariantType === "i");
            if (wNeedsBoolMigration) {
                await this.persistValue(wChecked, { reloadView: false });
            }
        } catch (error) {
            console.error("Error initializing checkbox state:", error);
            this.setState({ isChecked: false });
        }
    }

    handleClick = (event) => {
        if (this.isFormulaPickActive() || event.shiftKey) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();

        this.setState(
            (prevState) => ({ isChecked: !prevState.isChecked }),
            () => {
                if (this.props.onChange) {
                    this.props.onChange(this.state.isChecked);
                }
                this.persistValue(this.state.isChecked)
                    .then(() => this.restoreGridKeyboardFocus())
                    .catch((error) => {
                        console.error("Error persisting checkbox value:", error);
                        this.restoreGridKeyboardFocus();
                    });
            }
        );
    };

    renderCheckbox(sSizePx) {
        const { isChecked } = this.state;
        let wCell = this.props.Cell;
        let wColor = "green";
        let wBackgroundColor = "white";
        
        if (wCell.hasOwnProperty("f_c")) {
            wColor = wCell.f_c; 
        }
        if (wCell.hasOwnProperty("f_bc")) {
            wBackgroundColor = wCell.f_bc; 
        }
        
        return (
            <svg
                width={sSizePx}
                height={sSizePx}
                viewBox="0 0 24 24"
                preserveAspectRatio="xMidYMid meet"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                onClick={this.handleClick}
                style={{ 
                    cursor: 'pointer',
                    flexShrink: 0,
                }}
            >
                <rect
                    x="2"
                    y="2"
                    width="20"
                    height="20"
                    rx="3"
                    fill={wBackgroundColor}
                    stroke={isChecked ? wColor : '#ccc'}
                    strokeWidth="2"
                />
                {isChecked && (
                    <path
                        d="M6 12L10 16L18 8"
                        stroke={wColor}
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{
                            transition: 'all 0.2s ease-in-out'
                        }}
                    />
                )}
            </svg>
        );
    }

    paintExportInk(ctx, width, height) {
        const wStyles = SkCellClass.cellStylesForCanvasExport(this.m_Cell);
        const wInset = wStyles.inset ?? 2;
        const wInnerW = Math.max(0, width - wInset * 2);
        const wInnerH = Math.max(0, height - wInset * 2);
        const wCheckSize = Math.min(
            wInnerW,
            wInnerH,
            Math.max(12, Math.round(wStyles.fontSizePx * 1.35)),
        );
        const wColor = wStyles.color || "green";
        const wBg =
            wStyles.backgroundColor !== "transparent" ? wStyles.backgroundColor : "white";
        const wChecked = !!this.state?.isChecked;

        ctx.save();
        ctx.translate(wInset, wInset);
        SkCellClass.paintWidgetWithCaption(
            ctx,
            this.m_Cell,
            wInnerW,
            wInnerH,
            wCheckSize,
            wCheckSize,
            (wx, wy) => {
                const wRadius = Math.min(3, wCheckSize * 0.12);
                ctx.fillStyle = wBg;
                SkCellClass.roundRectPath(ctx, wx, wy, wCheckSize, wCheckSize, wRadius);
                ctx.fill();
                ctx.strokeStyle = wChecked ? wColor : "#cccccc";
                ctx.lineWidth = 2;
                ctx.stroke();
                if (wChecked) {
                    ctx.strokeStyle = wColor;
                    ctx.lineWidth = 2.5;
                    ctx.lineCap = "round";
                    ctx.lineJoin = "round";
                    ctx.beginPath();
                    ctx.moveTo(wx + wCheckSize * 0.2, wy + wCheckSize * 0.52);
                    ctx.lineTo(wx + wCheckSize * 0.42, wy + wCheckSize * 0.74);
                    ctx.lineTo(wx + wCheckSize * 0.82, wy + wCheckSize * 0.28);
                    ctx.stroke();
                }
            },
            wStyles,
        );
        ctx.restore();
    }

    render() {
        let wCell = this.props.Cell;
        let wBackgroundColor = "transparent";
        let wColor = "green";
        let wTextAlign = "center";
        let wVerticalTextAlign = "center";
        
        if (wCell.hasOwnProperty("f_c")) {
            wColor = wCell.f_c; 
        }
        if (wCell.hasOwnProperty("f_bc")) {
            wBackgroundColor = wCell.f_bc; 
        }
        if (wCell.hasOwnProperty("f_ah")) {
            const wAlign = GetTextAlign(wCell.f_ah);
            if (wAlign) {
                wTextAlign = wAlign;
            }
        }
        if (wCell.hasOwnProperty("f_av")) {
            const wVAlign = GetVerticalTextAlign(wCell.f_av);
            if (wVAlign) {
                wVerticalTextAlign = wVAlign;
            }
        }

        const wCellInset = 2;
        const wOverlay = this.CellClassClippedOverlayLayout({ inset: wCellInset });
        const wInnerW = wOverlay.innerW;
        const wInnerH = wOverlay.innerH;
        const wFontSizeCss = fontSizeCssPxFromPt(fontSizePtFromCell(wCell, 11));
        const wCheckSize = Math.min(
            wInnerW,
            wInnerH,
            Math.max(12, Math.round(wFontSizeCss * 1.35))
        );

        const wCellStyleParent = {
            ...wOverlay.outerStyle,
            zIndex: 3,
            color: wColor,
            backgroundColor: wBackgroundColor,
            display: 'flex',
            alignItems: flexAlignFromCellVertical(wVerticalTextAlign),
            justifyContent: flexJustifyFromCellAlign(wTextAlign),
            boxSizing: 'border-box',
            pointerEvents: "auto",
            userSelect: "none",
        };

        const wCellStyleInner = {
            ...wOverlay.innerStyle,
            display: "flex",
            alignItems: flexAlignFromCellVertical(wVerticalTextAlign),
            justifyContent: flexJustifyFromCellAlign(wTextAlign),
        };

        return (
            <div
                style={wCellStyleParent}
                className="SkSpCellClass"
                {...this.cellClassDomAttrs()}
                onMouseDownCapture={this.onCellClassMouseDownCapture}
            >
                <div style={wCellStyleInner}>
                    {this.renderWidgetWithCaption(
                        this.renderCheckbox(wCheckSize),
                        wCell,
                        wColor,
                        wFontSizeCss
                    )}
                </div>
            </div>
        );
    }
}

SkCellClass.installPdfExportStatics(SkCellClassCheck, {
    initialState: () => ({ isChecked: false }),
    hydrate: SkCellClass.hydrateCalculableBoolExportPainter,
});

export default SkCellClassCheck;
