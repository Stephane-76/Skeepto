//=============================================================================
// SkCellClassSparkline
// In-cell line sparkline (Excel sparkline MVP)
//=============================================================================
import React from "react";
import SkCellClass from "./SkCellClass.js";

function Render(sCell, sSpInterface) {
    return (
        <SkCellClassSparkline
            Cell={sCell}
            key={sCell.c_k}
            SpInterface={sSpInterface}
        />
    );
}

class SkCellClassSparkline extends SkCellClass {
    static SPARKLINE_DEFAULTS = Object.freeze({
        lineColor: "#A6A6A6",
        markerColor: "#7F7F7F",
        lineWidth: 1.5,
        markerRadius: 2.5,
        paddingX: 4,
        paddingY: 4,
    });

    constructor(props) {
        super(props);
        this.canvasRef = React.createRef();
        this.m_Cell = props.Cell;
        this.m_SpInterface = props.SpInterface;
        this.state = {
            ...SkCellClassSparkline.initialStateFromCell(props.Cell),
            options: { ...SkCellClassSparkline.SPARKLINE_DEFAULTS },
        };
    }

    static ClassName() {
        return "SkCellClassSparkline";
    }

    static cellClassCapabilities() {
        return {
            ...SkCellClass.cellClassCapabilities(),
            inplaceEditBlocked: true,
        };
    }

    static Icon() {
        return (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%">
                <polyline
                    points="3,16 8,11 12,14 17,8 21,10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                <circle cx="8" cy="11" r="1.4" fill="currentColor" />
                <circle cx="12" cy="14" r="1.4" fill="currentColor" />
                <circle cx="17" cy="8" r="1.4" fill="currentColor" />
            </svg>
        );
    }

    static registerClassAttribute(sUISpreadSheet) {
        super.registerClassAttribute(sUISpreadSheet, "Sparkline", "Javascript", Render);
        let wOk = sUISpreadSheet.addProperty(
            "DataRange",
            "string",
            "Values range",
            0,
            "",
            "range",
        );
        if (!wOk) {
            console.error("AddProperty DataRange Error !");
        }
        wOk = sUISpreadSheet.addProperty(
            "showMarkers",
            "string",
            "Show markers",
            1,
            "true",
        );
        if (!wOk) {
            console.error("AddProperty showMarkers Error !");
        }
    }

    static hasDataRangeConfigured(sCell) {
        return Boolean(SkCellClass.readPropertyRangeRef(sCell, "DataRange"));
    }

    static parseShowMarkers(rawValue) {
        const wText = String(rawValue ?? "").trim().toLowerCase();
        if (wText === "false" || wText === "0" || wText === "no") {
            return false;
        }
        return true;
    }

    static initialStateFromCell(sCell) {
        return {
            values: [],
            hasError: false,
            dataRangeConfigured: SkCellClassSparkline.hasDataRangeConfigured(sCell),
            showMarkers: SkCellClassSparkline.parseShowMarkers(
                SkCellClass.readPropertyFromCellJson(sCell, "showMarkers") || "true",
            ),
        };
    }

    static sparklinePoints(sValues, sWidth, sHeight, sOptions) {
        if (!Array.isArray(sValues) || sValues.length === 0) {
            return [];
        }
        const wOptions = { ...SkCellClassSparkline.SPARKLINE_DEFAULTS, ...sOptions };
        const wPadX = wOptions.paddingX;
        const wPadY = wOptions.paddingY;
        const wInnerW = Math.max(1, sWidth - wPadX * 2);
        const wInnerH = Math.max(1, sHeight - wPadY * 2);
        let wMin = sValues[0];
        let wMax = sValues[0];
        for (const wVal of sValues) {
            wMin = Math.min(wMin, wVal);
            wMax = Math.max(wMax, wVal);
        }
        const wSpan = wMax - wMin;
        const wCount = sValues.length;
        const wPoints = [];
        for (let wIdx = 0; wIdx < wCount; wIdx++) {
            const wX =
                wCount === 1
                    ? wPadX + wInnerW / 2
                    : wPadX + (wIdx / (wCount - 1)) * wInnerW;
            let wRatio = 0.5;
            if (wSpan > 0) {
                wRatio = (sValues[wIdx] - wMin) / wSpan;
            }
            const wY = wPadY + (1 - wRatio) * wInnerH;
            wPoints.push({ x: wX, y: wY });
        }
        return wPoints;
    }

    /**
     * Draw sparkline ink in local canvas coordinates (0,0)–(width,height).
     * @param {CanvasRenderingContext2D} ctx
     * @param {number[]} values
     * @param {number} width
     * @param {number} height
     * @param {object} [options]
     * @param {boolean} [showMarkers=true]
     */
    static drawInk(ctx, values, width, height, options, showMarkers = true) {
        const wOptions = { ...SkCellClassSparkline.SPARKLINE_DEFAULTS, ...options };
        const wPoints = SkCellClassSparkline.sparklinePoints(values, width, height, wOptions);
        if (wPoints.length === 0) {
            return;
        }

        ctx.beginPath();
        ctx.moveTo(wPoints[0].x, wPoints[0].y);
        for (let wIdx = 1; wIdx < wPoints.length; wIdx++) {
            ctx.lineTo(wPoints[wIdx].x, wPoints[wIdx].y);
        }
        ctx.strokeStyle = wOptions.lineColor;
        ctx.lineWidth = wOptions.lineWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();

        if (!showMarkers) {
            return;
        }
        const wRadius = wOptions.markerRadius;
        for (const wPoint of wPoints) {
            ctx.beginPath();
            ctx.arc(wPoint.x, wPoint.y, wRadius, 0, Math.PI * 2);
            ctx.fillStyle = wOptions.markerColor;
            ctx.fill();
        }
    }

    /**
     * Resolve the host cell fill for export / flat canvas.
     *
     * The widget cell carries its OWN merged background: WASM fuses the
     * sheet / column / row / table-band / cell layers into f_bc for every
     * emitted cell (JsonFormatJavaScript), widgets included. So the widget's own
     * cell is the single source of truth. We must never look at sibling cells:
     * a whole-column fill elsewhere would otherwise leak its color into every
     * sparkline sharing that row. No own f_bc => no host fill (transparent over
     * the grid in live paint; white on opaque export).
     */
    static resolveHostBackgroundColor(cell, spInterface, uiView) {
        const direct = SkCellClass.readCellBackgroundColor(cell);
        if (direct) {
            return direct;
        }
        const cr = Math.round(Number(cell?.c_r));
        const cc = Math.round(Number(cell?.c_c));
        if (spInterface?.getJsonViewBackgroundColorSync && cr >= 1 && cc >= 1) {
            const sync = spInterface.getJsonViewBackgroundColorSync(cr, cc);
            if (sync != null && String(sync).trim() !== "") {
                return String(sync).trim();
            }
        }
        return "";
    }

    /** Widget background in local canvas coordinates. */
    static fillBackground(ctx, cell, width, height, values, rangeConfigured, hostBackground = "", options = {}) {
        const wValues = Array.isArray(values) ? values : [];
        const wEmpty = wValues.length === 0 && !rangeConfigured;
        if (wEmpty) {
            ctx.fillStyle = SkCellClass.EMPTY_CHART_PLACEHOLDER_BG;
            ctx.fillRect(0, 0, width, height);
            return;
        }
        const wBg = String(hostBackground || "").trim() || SkCellClass.readCellBackgroundColor(cell);
        if (wBg) {
            ctx.fillStyle = wBg;
            ctx.fillRect(0, 0, width, height);
            return;
        }
        if (options.opaque === true) {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, width, height);
            return;
        }
        // Live overlay: stay transparent over the grid. Never clearRect on flat export.
    }

    /**
     * Full widget paint in local coordinates — shared by React canvas and PDF export.
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} cell — JsonView cell (for host fill)
     * @param {number} width
     * @param {number} height
     * @param {{ values?: number[], rangeConfigured?: boolean, showMarkers?: boolean, options?: object }} paintState
     */
    static paintCanvas(ctx, cell, width, height, paintState = {}) {
        const wValues = Array.isArray(paintState.values) ? paintState.values : [];
        const wShowMarkers = paintState.showMarkers !== false;
        const wOptions = paintState.options ?? SkCellClassSparkline.SPARKLINE_DEFAULTS;

        SkCellClassSparkline.fillBackground(
            ctx,
            cell,
            width,
            height,
            paintState.values,
            paintState.rangeConfigured,
            paintState.hostBackground,
        );
        // A dependent cell in error (e.g. #N/A) suppresses the curve entirely.
        if (paintState.hasError === true) {
            return;
        }
        SkCellClassSparkline.drawInk(
            ctx,
            wValues,
            width,
            height,
            wOptions,
            wShowMarkers,
        );
    }

    /** JsonView cell box in export/sheet pixel space. */
    static jsonViewCellRect(cell) {
        return SkCellClass.jsonViewCellRect(cell);
    }

    static paintBackgroundAtJsonViewCell(ctx, cell, paintState) {
        SkCellClass.paintAtJsonViewCell(ctx, cell, (c, cell, w, h) => {
            SkCellClassSparkline.fillBackground(
                c,
                cell,
                w,
                h,
                paintState.values,
                paintState.rangeConfigured,
                paintState.hostBackground,
                { opaque: true },
            );
        });
    }

    static paintInkAtJsonViewCell(ctx, cell, paintState) {
        if (paintState.hasError === true) {
            return;
        }
        SkCellClass.paintAtJsonViewCell(ctx, cell, (c, _cell, w, h) => {
            SkCellClassSparkline.drawInk(
                c,
                paintState.values,
                w,
                h,
                paintState.options,
                paintState.showMarkers,
            );
        });
    }

    /**
     * Load evaluated range values + display flags for export or offline paint.
     * @param {object} cell
     * @param {object} spInterface
     * @returns {Promise<{ values: number[], rangeConfigured: boolean, showMarkers: boolean, options: object }>}
     */
    static async loadPaintStateFromCell(cell, spInterface) {
        const wShowMarkers = SkCellClassSparkline.parseShowMarkers(
            SkCellClass.readPropertyFromCellJson(cell, "showMarkers") || "true",
        );
        const wCtx = SkCellClass.buildRangeReadContext(cell, spInterface);
        const wRef = await SkCellClass.resolvePropertyRangeRef(cell, "DataRange", {
            hostRef: wCtx.hostRef,
            hostSheet: wCtx.hostSheet,
            defaultSheet: wCtx.defaultSheet,
        });
        if (!wRef) {
            return {
                values: [],
                hasError: false,
                rangeConfigured: false,
                showMarkers: wShowMarkers,
                options: { ...SkCellClassSparkline.SPARKLINE_DEFAULTS },
                hostBackground: "",
            };
        }
        const wResult = await SkCellClass.numericValuesWithErrorFromRangeRef(
            wRef,
            "",
            wCtx.defaultSheet,
            spInterface,
        );
        return {
            values: Array.isArray(wResult?.values) ? wResult.values : [],
            hasError: wResult?.hasError === true,
            rangeConfigured: true,
            showMarkers: wShowMarkers,
            options: { ...SkCellClassSparkline.SPARKLINE_DEFAULTS },
            hostBackground: "",
        };
    }

    cellAttributesDigest(sCell) {
        const wAttrs = sCell?.c_v?.c?.a;
        return Array.isArray(wAttrs) ? JSON.stringify(wAttrs) : "";
    }

    isUnsupportedR1C1RangeRef(sRangeRef) {
        return /R\[|C\[/.test(String(sRangeRef || ""));
    }

    rangeReadContext() {
        return SkCellClass.buildRangeReadContext(this.m_Cell, this.m_SpInterface);
    }

    async readNumericValuesIfValid(sRangeRef) {
        if (!sRangeRef || this.isUnsupportedR1C1RangeRef(sRangeRef)) {
            return { values: [], hasError: false };
        }
        const wQualified = SkCellClass.qualifyRangeRefWithSheet(
            sRangeRef,
            this.rangeReadContext().defaultSheet,
        );
        if (!SkCellClass.parseA1RangeBounds(wQualified)) {
            return { values: [], hasError: false };
        }
        const wCtx = this.rangeReadContext();
        return SkCellClass.numericValuesWithErrorFromRangeRef(
            sRangeRef,
            "",
            wCtx.defaultSheet,
            this.m_SpInterface,
        );
    }

    async readShowMarkersFromCell() {
        const wRaw = await this.readPropertyValue("showMarkers", "true");
        return SkCellClassSparkline.parseShowMarkers(wRaw);
    }

    async loadValuesFromDataRange() {
        const wCtx = this.rangeReadContext();
        const wRef = await SkCellClass.resolvePropertyRangeRef(this.m_Cell, "DataRange", {
            hostRef: wCtx.hostRef,
            hostSheet: wCtx.hostSheet,
            defaultSheet: wCtx.defaultSheet,
        });
        if (!wRef) {
            this.setState({ values: [], hasError: false, dataRangeConfigured: false });
            return false;
        }
        try {
            const wResult = await this.readNumericValuesIfValid(wRef);
            const wValues = Array.isArray(wResult?.values) ? wResult.values : [];
            const wHasError = wResult?.hasError === true;
            this.setState({ values: wValues, hasError: wHasError, dataRangeConfigured: true });
            return wValues.length > 0;
        } catch (error) {
            console.error("Sparkline loadValuesFromDataRange failed:", error);
            this.setState({ values: [], hasError: false, dataRangeConfigured: false });
            return false;
        }
    }

    async refreshFromCell() {
        const wShowMarkers = await this.readShowMarkersFromCell();
        this.setState({ showMarkers: wShowMarkers });
        await this.loadValuesFromDataRange();
    }

    componentDidMount() {
        void this.refreshFromCell().then(() => this.scheduleCanvasUpdate());
        this.scheduleCanvasUpdate();
    }

    componentDidUpdate(prevProps) {
        const wAttrsChanged =
            this.cellAttributesDigest(this.props.Cell) !==
            this.cellAttributesDigest(prevProps.Cell);
        const wDataTick = this.props.Cell?.c_foMeta?.dataTick;
        const wPrevDataTick = prevProps.Cell?.c_foMeta?.dataTick;
        const wDataTickChanged = wDataTick !== wPrevDataTick;
        const wDisplayTick = this.props.Cell?.c_foMeta?.displayTick;
        const wPrevDisplayTick = prevProps.Cell?.c_foMeta?.displayTick;
        const wDisplayTickChanged = wDisplayTick !== wPrevDisplayTick;
        this.m_Cell = this.props.Cell;
        if (wAttrsChanged || wDataTickChanged || wDisplayTickChanged) {
            this.setState(SkCellClassSparkline.initialStateFromCell(this.m_Cell), () => {
                this.scheduleCanvasUpdate();
                void this.refreshFromCell().then(() => this.scheduleCanvasUpdate());
            });
            return;
        }
        this.scheduleCanvasUpdate();
    }

    resolveDrawOptions() {
        return { ...SkCellClassSparkline.SPARKLINE_DEFAULTS, ...this.state.options };
    }

    buildPaintState() {
        return {
            values: Array.isArray(this.state.values) ? this.state.values : [],
            hasError: this.state.hasError === true,
            rangeConfigured: this.state.dataRangeConfigured === true,
            showMarkers: this.state.showMarkers !== false,
            options: this.resolveDrawOptions(),
            hostBackground: SkCellClassSparkline.resolveHostBackgroundColor(
                this.m_Cell,
                this.m_SpInterface,
                this.m_SpInterface?.m_UIView,
            ),
        };
    }

    updateCanvas() {
        const wCanvas = this.canvasRef.current;
        if (!wCanvas || !this.m_SpInterface) {
            return;
        }
        const wCtx = wCanvas.getContext("2d");
        const wRatio = this.m_SpInterface.m_Ratio;
        const wWidth = wCanvas.offsetWidth;
        const wHeight = wCanvas.offsetHeight;
        wCanvas.width = wWidth * wRatio;
        wCanvas.height = wHeight * wRatio;
        wCtx.scale(wRatio, wRatio);
        wCtx.clearRect(0, 0, wWidth, wHeight);
        SkCellClassSparkline.paintCanvas(
            wCtx,
            this.m_Cell,
            wWidth,
            wHeight,
            this.buildPaintState(),
        );
    }

    render() {
        const wPosSize = this.CellPosSizeChart();
        const wCellInset = 1;
        const wOuterW = Math.max(0, wPosSize.W - wCellInset * 2);
        const wOuterH = Math.max(0, wPosSize.H - wCellInset * 2);
        const wCanvasW = Math.max(0, wPosSize.canvasW - wCellInset * 2);
        const wCanvasH = Math.max(0, wPosSize.canvasH - wCellInset * 2);
        const wCellStyleParent = {
            position: "absolute",
            margin: "0px",
            padding: "0px",
            left: wPosSize.X + wCellInset + "px",
            top: wPosSize.Y + wCellInset + "px",
            width: wOuterW + "px",
            height: wOuterH + "px",
            overflow: "hidden",
            pointerEvents: "none",
            zIndex: 2,
        };

        return (
            <div
                style={wCellStyleParent}
                className="SkSpCellClass"
                onMouseDownCapture={this.onCellClassMouseDownCapture}
            >
                <canvas
                    ref={this.canvasRef}
                    width={wCanvasW}
                    height={wCanvasH}
                    style={{
                        width: wCanvasW + "px",
                        height: wCanvasH + "px",
                        marginLeft: wPosSize.offsetX + "px",
                        marginTop: wPosSize.offsetY + "px",
                        display: "block",
                    }}
                />
            </div>
        );
    }
}

export default SkCellClassSparkline;
