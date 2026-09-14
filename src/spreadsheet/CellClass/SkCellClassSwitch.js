//=============================================================================
// SkCellClassSwitch
// Class Switch
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
    return(<SkCellClassSwitch Cell={sCell} key={sCell.c_k} SpInterface={sSpInterface}></SkCellClassSwitch>)
}


class SkCellClassSwitch extends SkCellClass  {
    constructor(props) {
        super(props)
        this.state = {
            isChecked: false
        };
    }

    static ClassName() { return("SkCellClassSwitch") }

    static cellClassCapabilities() {
        return {
            ...SkCellClass.cellClassCapabilities(),
            inplaceEditBlocked: true,
            calculableModelValue: true,
            calculableWireType: SkCellClass.VARIANT_JSON_TYPE_BOOL,
        };
    }

    // SVG icon representing a toggle switch in "on" position
    static Icon() {
        return (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%">
                <rect x="2" y="8" width="20" height="10" rx="5" ry="5"
                      fill="#4caf50" stroke="currentColor" strokeWidth="1.2"/>
                <circle cx="17" cy="13" r="3.5" fill="#ffffff"
                        stroke="currentColor" strokeWidth="1"/>
            </svg>
        );
    }

    static registerClassAttribute(sUISpreadSheet) {
        super.registerClassAttribute(sUISpreadSheet, "Switch", "Javascript", Render);
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
            console.error("Error initializing switch state:", error);
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
                        console.error("Error persisting switch value:", error);
                        this.restoreGridKeyboardFocus();
                    });
            }
        );
    };

    renderSwitch(sWidthPx, sHeightPx) {
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
                width={sWidthPx}
                height={sHeightPx}
                viewBox="0 0 40 24"
                preserveAspectRatio="xMidYMid meet"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                onClick={this.handleClick}
                style={{ 
                    cursor: 'pointer',
                    flexShrink: 0,
                    pointerEvents: 'auto'
                }}
            >
                <rect
                    x="2"
                    y="4"
                    width="36"
                    height="16"
                    rx="8"
                    fill={wBackgroundColor}
                    stroke={wColor}
                    strokeWidth="2"
                    opacity={isChecked ? "1" : "0.5"}
                />
                <circle
                    cx={isChecked ? "30" : "10"}
                    cy="12"
                    r="8"
                    fill={wColor}
                />
            </svg>
        );
    }

    paintExportInk(ctx, width, height) {
        const wStyles = SkCellClass.cellStylesForCanvasExport(this.m_Cell);
        const wInset = wStyles.inset ?? 2;
        const wInnerW = Math.max(0, width - wInset * 2);
        const wInnerH = Math.max(0, height - wInset * 2);
        const wSwitchH = Math.min(
            wInnerH,
            Math.max(14, Math.round(wStyles.fontSizePx * 1.15)),
        );
        const wSwitchW = Math.min(
            wInnerW,
            Math.max(28, Math.round(wSwitchH * (40 / 24))),
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
            wSwitchW,
            wSwitchH,
            (wx, wy) => {
                const wRadius = wSwitchH / 2;
                ctx.save();
                ctx.globalAlpha = wChecked ? 1 : 0.5;
                ctx.fillStyle = wBg;
                SkCellClass.roundRectPath(ctx, wx, wy, wSwitchW, wSwitchH, wRadius);
                ctx.fill();
                ctx.strokeStyle = wColor;
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.restore();
                ctx.fillStyle = wColor;
                ctx.beginPath();
                const wCx = wChecked ? wx + wSwitchW - wRadius : wx + wRadius;
                ctx.arc(wCx, wy + wRadius, Math.max(2, wRadius - 2), 0, Math.PI * 2);
                ctx.fill();
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
        const wSwitchH = Math.min(
            wInnerH,
            Math.max(14, Math.round(wFontSizeCss * 1.15))
        );
        const wSwitchW = Math.min(
            wInnerW,
            Math.max(28, Math.round(wSwitchH * (40 / 24)))
        );

        const wCellStyleParent = {
            ...wOverlay.outerStyle,
            zIndex: 3,
            color: wColor,
            backgroundColor: wBackgroundColor,
            display: "flex",
            alignItems: flexAlignFromCellVertical(wVerticalTextAlign),
            justifyContent: flexJustifyFromCellAlign(wTextAlign),
            boxSizing: 'border-box',
            pointerEvents: 'auto',
            userSelect: 'none',
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
                onClick={this.handleClick}
                onMouseDown={(e) => e.preventDefault()}
            >
                <div style={wCellStyleInner}>
                    {this.renderWidgetWithCaption(
                        this.renderSwitch(wSwitchW, wSwitchH),
                        wCell,
                        wColor,
                        wFontSizeCss
                    )}
                </div>
            </div>
        );
    }
}

SkCellClass.installPdfExportStatics(SkCellClassSwitch, {
    initialState: () => ({ isChecked: false }),
    hydrate: SkCellClass.hydrateCalculableBoolExportPainter,
});

export default SkCellClassSwitch;
