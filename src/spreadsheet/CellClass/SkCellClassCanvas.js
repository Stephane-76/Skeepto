//=============================================================================
// SkCellClassCanvas
// Class canvas
//=============================================================================
import SkCellClass from "./SkCellClass.js"

function Render(sCell, sSpInterface) {
    return (<SkCellClassCanvas Cell={sCell} key={sCell.c_k} SpInterface={sSpInterface}></SkCellClassCanvas>)
}

const CANVAS_VALUE_DEFAULT = 12;

class SkCellClassCanvas extends SkCellClass {
    static ClassName() { return ("SkCellClassCanvas") }

    static cellClassCapabilities() {
        return { ...SkCellClass.cellClassCapabilities(), floatingObject: true };
    }

    constructor(props) {
        super(props);
        this.m_SpInterface = props.SpInterface;
        this.m_Cursor = "move";
        this.boundResize = this.resize.bind(this);
        this.m_Value = CANVAS_VALUE_DEFAULT;
    }

    // SVG icon representing a canvas gauge (colored circle with value)
    static Icon() {
        return (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%">
                <circle cx="12" cy="12" r="9"
                        fill="none" stroke="currentColor" strokeWidth="1.5"/>
                <circle cx="12" cy="12" r="7" fill="#44ff44"/>
                <text x="12" y="15" textAnchor="middle" fontSize="8"
                      fontFamily="Roboto" fontWeight="bold" fill="#000000">42</text>
            </svg>
        );
    }

    static registerClassAttribute(sUISpreadSheet) {
        super.registerClassAttribute(sUISpreadSheet, "Canvas", "Javascript", Render);
        let wOk = sUISpreadSheet.addProperty("value", "int", "value int", 1, String(CANVAS_VALUE_DEFAULT));
        if (!wOk) console.error("AddProperty value Error !");
    }

    componentDidMount() {
        this.m_Cell = this.props.Cell;
        window.addEventListener("resize", this.boundResize);
        void this.loadValueProperty();
    }

    componentDidUpdate(prevProps) {
        this.m_Cell = this.props.Cell;
        void this.loadValueProperty(prevProps.Cell);
    }

    componentWillUnmount() {
        window.removeEventListener("resize", this.boundResize);
    }

    static parseValueProperty(sRaw, sDefault = CANVAS_VALUE_DEFAULT) {
        const wText = SkCellClass.normalizeWasmCellValue(sRaw);
        if (wText === "") {
            return sDefault;
        }
        const wParsed = parseInt(wText, 10);
        return Number.isFinite(wParsed) ? wParsed : sDefault;
    }

    async loadValueProperty(prevCell) {
        const wCell = this.props.Cell ?? this.m_Cell;
        const wAttr = SkCellClass.readPropertyAttrEntry(wCell, "value");
        const wPrevAttr = prevCell
            ? SkCellClass.readPropertyAttrEntry(prevCell, "value")
            : null;
        const wAttrKey = wAttr ? JSON.stringify(wAttr) : "";
        const wPrevKey = wPrevAttr ? JSON.stringify(wPrevAttr) : "";
        if (wAttrKey === wPrevKey && this.m_Value != null) {
            return;
        }

        if (wAttr && !wAttr.hasOwnProperty("f")) {
            const wNext = SkCellClassCanvas.parseValueProperty(wAttr.v);
            if (wNext !== this.m_Value) {
                this.m_Value = wNext;
                this.invalidate();
            }
            return;
        }

        try {
            const wRaw = await this.GetProperty("value");
            const wNext = SkCellClassCanvas.parseValueProperty(wRaw);
            if (wNext !== this.m_Value) {
                this.m_Value = wNext;
                this.invalidate();
            }
        } catch (error) {
            console.error("Canvas loadValueProperty failed:", error);
        }
    }

    resize() {
        this.invalidate();
    }

    invalidate() {
        this.Paint();
    }

    // Get the color based on the value
    getColorForvalue(value) {
        return SkCellClassCanvas.colorForCanvasValue(value);
    }

    Paint() {
        const wCanvas = this.m_Ref.current;
        if (!wCanvas) return;

        const wContext = wCanvas.getContext("2d");
        wContext.save();

        // Configure the canvas with the correct device pixel ratio
        const wWidth = wCanvas.offsetWidth;
        const wHeight = wCanvas.offsetHeight;
        const wRatio = this.m_SpInterface.m_Ratio;

        wCanvas.width = wWidth * wRatio;
        wCanvas.height = wHeight * wRatio;
        wContext.scale(wRatio, wRatio);

        // Clear the canvas
        wContext.clearRect(0, 0, wWidth, wHeight);

        // Compute center and radius
        const centerX = wWidth / 2;
        const centerY = wHeight / 2;
        const radius = Math.min(wWidth, wHeight) * 0.4; // 40% of the smallest dimension

        const value = this.m_Value ?? CANVAS_VALUE_DEFAULT;
        const color = this.getColorForvalue(value);

        // Draw the outer circle (outline)
        wContext.beginPath();
        wContext.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        wContext.strokeStyle = '#333333';
        wContext.lineWidth = 2;
        wContext.stroke();
        if (radius > 4) {
            // Draw the colored inner circle
            wContext.beginPath();
            wContext.arc(centerX, centerY, radius - 2, 0, 2 * Math.PI);
            wContext.fillStyle = color;
            wContext.fill();

            // Render the value text
            wContext.font = `${radius / 2}px Roboto`;
            wContext.fillStyle = '#000000';
            wContext.textAlign = 'center';
            wContext.textBaseline = 'middle';
            wContext.fillText(String(value), centerX, centerY);
        }
        wContext.restore();
    }

    static colorForCanvasValue(value) {
        const wNormalized = Math.min(Math.max(Number(value) || 0, 0), 100);
        if (wNormalized < 33) {
            return "#FF4444";
        }
        if (wNormalized < 66) {
            return "#FFAA00";
        }
        return "#44FF44";
    }

    static drawValueCircle(ctx, width, height, value) {
        if (width <= 0 || height <= 0) {
            return;
        }
        const wCenterX = width / 2;
        const wCenterY = height / 2;
        const wRadius = Math.min(width, height) * 0.4;
        const wNum = value ?? CANVAS_VALUE_DEFAULT;
        const wFill = SkCellClassCanvas.colorForCanvasValue(wNum);

        ctx.beginPath();
        ctx.arc(wCenterX, wCenterY, wRadius, 0, 2 * Math.PI);
        ctx.strokeStyle = "#333333";
        ctx.lineWidth = 2;
        ctx.stroke();
        if (wRadius > 4) {
            ctx.beginPath();
            ctx.arc(wCenterX, wCenterY, wRadius - 2, 0, 2 * Math.PI);
            ctx.fillStyle = wFill;
            ctx.fill();
            ctx.font = `${wRadius / 2}px Roboto`;
            ctx.fillStyle = "#000000";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(String(wNum), wCenterX, wCenterY);
        }
    }

    paintExportInk(ctx, width, height) {
        SkCellClassCanvas.drawValueCircle(ctx, width, height, this.m_Value);
    }

    render() {
        const wPosSize = this.CellPosSizeChart();
        let wCell = this.props.Cell;
        let wBackgroundColor = "transparent";

        // Background Color
        if (wCell.hasOwnProperty("f_bc")) {
            wBackgroundColor = wCell.f_bc;
        }

        const wCellStyle = {
            position: "absolute",
            backgroundColor: wBackgroundColor,
            display: "flex",
            margin: "0px",
            left: wPosSize.X + "px",
            top: wPosSize.Y + "px",
            width: wPosSize.W + "px",
            height: wPosSize.H + "px",
            overflow: "hidden",
        };

        return (
            <div
                style={wCellStyle}
                onMouseDownCapture={this.onCellClassMouseDownCapture}
            >
                <canvas
                    style={{
                        cursor: this.m_Cursor,
                        width: wPosSize.canvasW + "px",
                        height: wPosSize.canvasH + "px",
                        marginLeft: wPosSize.offsetX + "px",
                        marginTop: wPosSize.offsetY + "px",
                        display: "block",
                    }}
                    ref={this.m_Ref}
                ></canvas>
            </div>
        );
    }
}

SkCellClass.installPdfExportStatics(SkCellClassCanvas, {
    extra: () => ({ m_Value: CANVAS_VALUE_DEFAULT }),
    hydrate: async (painter) => {
        await painter.loadValueProperty();
    },
});

export default SkCellClassCanvas;
