//=============================================================================
// SkCellClassTextBox
// Floating object that renders plain text from host cell attributes
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

function textBoxStateFromCell(sCell) {
    const wText = SkCellClass.readPropertyFromCellJson(sCell, "text") || "";
    const wColor = SkCellClass.readPropertyFromCellJson(sCell, "color") || "#000000";
    const wFontSize = SkCellClass.readPropertyFromCellJson(sCell, "fontSize") || "12";
    const wFontFamily = SkCellClass.readPropertyFromCellJson(sCell, "fontFamily") || "";
    const wTextAlign = SkCellClass.readPropertyFromCellJson(sCell, "textAlign") || "left";
    const wBold = SkCellClass.readPropertyFromCellJson(sCell, "bold") || "false";
    return {
        text: typeof wText === "string" ? wText : String(wText || ""),
        color: typeof wColor === "string" ? wColor : String(wColor || "#000000"),
        fontSize: typeof wFontSize === "string" ? wFontSize : String(wFontSize || "12"),
        fontFamily: typeof wFontFamily === "string" ? wFontFamily : String(wFontFamily || ""),
        textAlign: typeof wTextAlign === "string" ? wTextAlign : String(wTextAlign || "left"),
        bold: String(wBold).toLowerCase() === "true",
    };
}

class SkCellClassTextBox extends SkCellClass {
    constructor(props) {
        super(props);
        this.m_Cell = props.Cell;
        this.m_SpInterface = props.SpInterface;
        this.state = textBoxStateFromCell(props.Cell);
    }

    cellAttributesDigest(sCell) {
        const wAttrs = sCell?.c_v?.c?.a;
        return Array.isArray(wAttrs) ? JSON.stringify(wAttrs) : "";
    }

    async refreshTextFromCell() {
        let wText = SkCellClass.readPropertyFromCellJson(this.m_Cell, "text") || "";
        let wColor = SkCellClass.readPropertyFromCellJson(this.m_Cell, "color") || "#000000";
        let wFontSize = SkCellClass.readPropertyFromCellJson(this.m_Cell, "fontSize") || "12";
        let wFontFamily = SkCellClass.readPropertyFromCellJson(this.m_Cell, "fontFamily") || "";
        let wTextAlign = SkCellClass.readPropertyFromCellJson(this.m_Cell, "textAlign") || "left";
        let wBold = SkCellClass.readPropertyFromCellJson(this.m_Cell, "bold") || "false";

        if (!wText) {
            wText = await this.readPropertyValue("text", "");
        }
        if (!wColor || wColor === "#000000") {
            const wLoadedColor = await this.readPropertyValue("color", "");
            if (wLoadedColor) wColor = wLoadedColor;
        }
        if (!wFontSize || wFontSize === "12") {
            const wLoadedSize = await this.readPropertyValue("fontSize", "");
            if (wLoadedSize) wFontSize = wLoadedSize;
        }
        if (!wFontFamily) {
            wFontFamily = await this.readPropertyValue("fontFamily", "");
        }
        if (!wTextAlign || wTextAlign === "left") {
            const wLoadedAlign = await this.readPropertyValue("textAlign", "");
            if (wLoadedAlign) wTextAlign = wLoadedAlign;
        }
        if (String(wBold).toLowerCase() !== "true") {
            const wLoadedBold = await this.readPropertyValue("bold", "");
            if (wLoadedBold) wBold = wLoadedBold;
        }

        const wNext = {
            text: typeof wText === "string" ? wText : String(wText || ""),
            color: typeof wColor === "string" ? wColor : String(wColor || "#000000"),
            fontSize: typeof wFontSize === "string" ? wFontSize : String(wFontSize || "12"),
            fontFamily: typeof wFontFamily === "string" ? wFontFamily : String(wFontFamily || ""),
            textAlign: typeof wTextAlign === "string" ? wTextAlign : String(wTextAlign || "left"),
            bold: String(wBold).toLowerCase() === "true",
        };

        this.setState((prev) => {
            if (
                prev.text === wNext.text &&
                prev.color === wNext.color &&
                prev.fontSize === wNext.fontSize &&
                prev.fontFamily === wNext.fontFamily &&
                prev.textAlign === wNext.textAlign &&
                prev.bold === wNext.bold
            ) {
                return null;
            }
            return wNext;
        });
    }

    static ClassName() {
        return "SkCellClassTextBox";
    }

    static cellClassCapabilities() {
        return { ...SkCellClass.cellClassCapabilities(), floatingObject: true };
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
        let wOk = sUISpreadSheet.addProperty("text", "string", "Text content", 0, "");
        if (!wOk) console.error("AddProperty text Error !");
        wOk = sUISpreadSheet.addProperty("color", "string", "Text color", 1, "#000000");
        if (!wOk) console.error("AddProperty color Error !");
        wOk = sUISpreadSheet.addProperty("fontSize", "string", "Font size (pt)", 2, "12");
        if (!wOk) console.error("AddProperty fontSize Error !");
        wOk = sUISpreadSheet.addProperty("fontFamily", "string", "Font family", 3, "");
        if (!wOk) console.error("AddProperty fontFamily Error !");
        wOk = sUISpreadSheet.addProperty("textAlign", "string", "Text alignment", 4, "left");
        if (!wOk) console.error("AddProperty textAlign Error !");
        wOk = sUISpreadSheet.addProperty("bold", "string", "Bold text", 5, "false");
        if (!wOk) console.error("AddProperty bold Error !");
    }

    paintExportInk(ctx, width, height) {
        const wPad = 4;
        const wStyles = {
            color: this.state?.color || "#000000",
            fontSizePx: parseFloat(this.state?.fontSize) || 12,
            fontFamily: this.state?.fontFamily || "Roboto",
            fontStyle: "",
            fontWeight: this.state?.bold ? "bold" : "normal",
        };
        SkCellClass.applyCanvasFont(ctx, wStyles);
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        const wLineHeight = wStyles.fontSizePx * 1.2;
        const wMaxW = width - wPad * 2;
        const wMaxH = height - wPad * 2;
        const wWords = String(this.state?.text || "").split(/\s+/);
        let wLine = "";
        let wCy = wPad;
        for (const wWord of wWords) {
            const wTest = wLine ? `${wLine} ${wWord}` : wWord;
            if (ctx.measureText(wTest).width > wMaxW && wLine) {
                ctx.fillText(wLine, wPad, wCy);
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
            ctx.fillText(wLine, wPad, wCy);
        }
    }

    componentDidMount() {
        void this.refreshTextFromCell();
    }

    componentDidUpdate(prevProps) {
        const wAttrsChanged =
            this.cellAttributesDigest(this.props.Cell) !==
            this.cellAttributesDigest(prevProps.Cell);
        const wDataTick = this.props.Cell?.c_foMeta?.dataTick;
        const wPrevDataTick = prevProps.Cell?.c_foMeta?.dataTick;
        const wDisplayTick = this.props.Cell?.c_foMeta?.displayTick;
        const wPrevDisplayTick = prevProps.Cell?.c_foMeta?.displayTick;
        if (
            prevProps.Cell !== this.props.Cell ||
            wAttrsChanged ||
            wDataTick !== wPrevDataTick ||
            wDisplayTick !== wPrevDisplayTick
        ) {
            this.m_Cell = this.props.Cell;
            this.setState(textBoxStateFromCell(this.props.Cell), () => {
                void this.refreshTextFromCell();
            });
        }
    }

    render() {
        const { text, color, fontSize, fontFamily, textAlign, bold } = this.state;
        const wLayout = this.CellPosSizeChart();
        const wFontSizePx = (parseFloat(fontSize) || 12) + "px";

        const wCellStyleParent = {
            position: "absolute",
            display: "flex",
            flexDirection: "column",
            margin: "0px",
            padding: "0px",
            left: wLayout.X + "px",
            top: wLayout.Y + "px",
            width: wLayout.W + "px",
            height: wLayout.H + "px",
            backgroundColor: "transparent",
            overflow: "hidden",
            boxSizing: "border-box",
        };

        const wTextStyle = {
            width: wLayout.canvasW + "px",
            height: wLayout.canvasH + "px",
            marginLeft: wLayout.offsetX + "px",
            marginTop: wLayout.offsetY + "px",
            padding: "4px",
            boxSizing: "border-box",
            color: color || "#000000",
            fontSize: wFontSizePx,
            fontFamily: fontFamily || "inherit",
            fontWeight: bold ? "bold" : "normal",
            textAlign: textAlign || "left",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            userSelect: "none",
            lineHeight: 1.2,
            flexShrink: 0,
        };

        return (
            <div
                style={wCellStyleParent}
                className="SkSpCellClass SkSpCellClassTextBox"
                onMouseDownCapture={this.onCellClassMouseDownCapture}
            >
                <div style={wTextStyle}>{text || ""}</div>
            </div>
        );
    }
}

SkCellClass.installPdfExportStatics(SkCellClassTextBox, {
    initialState: (cell) => textBoxStateFromCell(cell),
    hydrate: async (painter) => {
        await painter.refreshTextFromCell();
    },
});

export default SkCellClassTextBox;
