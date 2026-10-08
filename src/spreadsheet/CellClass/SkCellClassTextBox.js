//=============================================================================
// SkCellClassTextBox
// Shows the host cell text with that cell's font, color, and alignment.
//=============================================================================
import React from "react";
import SkCellClass from "./SkCellClass.js";

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
    static ClassName() {
        return "SkCellClassTextBox";
    }

    static cellClassCapabilities() {
        return {
            ...SkCellClass.cellClassCapabilities(),
            floatingObject: true,
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
        // Numbers default to "end". A text box with no explicit align stays left,
        // inside the visible box (the logical inner box can sit outside the clip).
        const wCssAlign = wCell?.hasOwnProperty("f_ah")
            ? SkCellClass.canvasExportTextAlign(wStyles.textAlign)
            : "left";
        const wJustify = wCell?.hasOwnProperty("f_av")
            ? (wStyles.verticalAlign || "center")
            : "flex-start";

        const wCellStyleParent = {
            ...wOverlay.outerStyle,
            display: "flex",
            flexDirection: "column",
            zIndex: 3,
            pointerEvents: "auto",
            justifyContent: wJustify,
            backgroundColor: wStyles.backgroundColor,
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
            userSelect: "none",
            lineHeight: 1.2,
        };

        return (
            <div
                style={wCellStyleParent}
                className={this.cellClassShellClassName("SkSpCellClassTextBox")}
                {...this.cellClassDomAttrs()}
                data-sk-form-kind="SkCellClassTextBox"
                onMouseDownCapture={this.onCellClassMouseDownCapture}
            >
                <div style={wTextStyle}>{wBox.text}</div>
            </div>
        );
    }
}

SkCellClass.installPdfExportStatics(SkCellClassTextBox);

export default SkCellClassTextBox;
