//=============================================================================
// SkCellClassGauge
// Circular gauge (arc or segmented ring) drawn on Canvas
//=============================================================================
import React from "react";
import SkCellClass from "./SkCellClass.js";

function Render(sCell, sSpInterface) {
    return (
        <SkCellClassGauge
            Cell={sCell}
            key={sCell.c_k}
            SpInterface={sSpInterface}
        />
    );
}

const GAUGE_DEFAULTS = {
    value: 59,
    label: "Speed",
    unit: "mph",
    dataRange: "59",
    min: 0,
    max: 100,
    gaugeType: "arc",
};

const GAUGE_TRACK_COLOR_DARK_BG = "rgba(255,255,255,0.28)";
const GAUGE_VALUE_COLOR_DARK_BG = "#FFFFFF";
const GAUGE_TEXT_COLOR_DARK_BG = "#FFFFFF";
const GAUGE_UNIT_COLOR_DARK_BG = "rgba(255,255,255,0.72)";
const GAUGE_TRACK_COLOR_LIGHT_BG = "rgba(0,0,0,0.14)";
const GAUGE_VALUE_COLOR_LIGHT_BG = "#378DAB";
const GAUGE_TEXT_COLOR_LIGHT_BG = "#333333";
const GAUGE_UNIT_COLOR_LIGHT_BG = "#666666";
const GAUGE_SEGMENT_COUNT = 48;
const GAUGE_ARC_START = (Math.PI * 3) / 4;
const GAUGE_ARC_SWEEP = (Math.PI * 3) / 2;

function clamp01(sRatio) {
    return Math.min(1, Math.max(0, sRatio));
}

function finiteNumber(sValue, sFallback) {
    const wText = String(sValue ?? "").trim();
    if (!wText) {
        return sFallback;
    }
    return SkCellClass.numericFromScalar(sValue);
}

function gaugeRatio(sValue, sMin, sMax) {
    const wSpan = sMax - sMin;
    if (!Number.isFinite(wSpan) || wSpan <= 0) {
        return 0;
    }
    return clamp01((sValue - sMin) / wSpan);
}

function formatGaugeValue(sValue) {
    const wNum = Number(sValue);
    if (!Number.isFinite(wNum)) {
        return "0";
    }
    if (Math.abs(wNum - Math.round(wNum)) < 0.05) {
        return String(Math.round(wNum));
    }
    return wNum.toFixed(1);
}

function parseGaugeType(sRaw) {
    return String(sRaw ?? "").trim().toLowerCase() === "segment" ? "segment" : "arc";
}

function readLiteralGaugeString(sCell, sName, sFallback) {
    const wText = SkCellClass.readPropertyFromCellJson(sCell, sName);
    const wTrimmed = String(wText ?? "").trim();
    return wTrimmed !== "" ? wTrimmed : sFallback;
}

/** Sync read from JsonView literals — avoids arc flash before async refresh on scroll/remount. */
function gaugeStateFromCell(sCell) {
    const wLabel = readLiteralGaugeString(sCell, "label", GAUGE_DEFAULTS.label);
    const wUnit = readLiteralGaugeString(sCell, "unit", GAUGE_DEFAULTS.unit);
    const wMin = finiteNumber(
        readLiteralGaugeString(sCell, "min", String(GAUGE_DEFAULTS.min)),
        GAUGE_DEFAULTS.min
    );
    const wMax = finiteNumber(
        readLiteralGaugeString(sCell, "max", String(GAUGE_DEFAULTS.max)),
        GAUGE_DEFAULTS.max
    );
    const wGaugeType = parseGaugeType(
        readLiteralGaugeString(sCell, "gaugeType", GAUGE_DEFAULTS.gaugeType)
    );

    let wValue = GAUGE_DEFAULTS.value;
    const wRangeRef = SkCellClass.readPropertyRangeRef(sCell, "DataRange");
    if (!wRangeRef) {
        const wDirect = SkCellClass.numericFromScalar(
            readLiteralGaugeString(sCell, "DataRange", String(GAUGE_DEFAULTS.dataRange))
        );
        if (Number.isFinite(wDirect)) {
            wValue = wDirect;
        }
    }

    return {
        value: wValue,
        min: wMin,
        max: wMax,
        label: wLabel,
        unit: wUnit,
        gaugeType: wGaugeType,
    };
}

class SkCellClassGauge extends SkCellClass {
    constructor(props) {
        super(props);
        this.canvasRef = React.createRef();
        this.m_Cell = props.Cell;
        this.m_SpInterface = props.SpInterface;
        this.state = {
            ...gaugeStateFromCell(props.Cell),
            options: {},
            zIndex: 0,
        };
    }

    static ClassName() {
        return "SkCellClassGauge";
    }

    static cellClassCapabilities() {
        return { ...SkCellClass.cellClassCapabilities(), floatingObject: true };
    }

    static Icon() {
        return (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%">
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
                <path
                    d="M6.8 16.2 A9 9 0 0 1 17.2 16.2"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                />
                <text x="12" y="13.5" textAnchor="middle" fontSize="6" fill="currentColor" fontFamily="Roboto">
                    59
                </text>
            </svg>
        );
    }

    static registerClassAttribute(sUISpreadSheet) {
        super.registerClassAttribute(sUISpreadSheet, "Gauge", "Javascript", Render);
        let wOk = sUISpreadSheet.addProperty(
            "label",
            "string",
            "Label",
            0,
            GAUGE_DEFAULTS.label
        );
        if (!wOk) console.error("AddProperty label Error !");
        wOk = sUISpreadSheet.addProperty("unit", "string", "Unit", 1, GAUGE_DEFAULTS.unit);
        if (!wOk) console.error("AddProperty unit Error !");
        wOk = sUISpreadSheet.addProperty(
            "DataRange",
            "string",
            "Value cell (or range)",
            2,
            GAUGE_DEFAULTS.dataRange,
            "range"
        );
        if (!wOk) console.error("AddProperty DataRange Error !");
        wOk = sUISpreadSheet.addProperty(
            "min",
            "string",
            "Min",
            3,
            String(GAUGE_DEFAULTS.min)
        );
        if (!wOk) console.error("AddProperty min Error !");
        wOk = sUISpreadSheet.addProperty(
            "max",
            "string",
            "Max",
            4,
            String(GAUGE_DEFAULTS.max)
        );
        if (!wOk) console.error("AddProperty max Error !");
        wOk = sUISpreadSheet.addProperty(
            "gaugeType",
            "string",
            "Gauge type",
            5,
            GAUGE_DEFAULTS.gaugeType,
            "enum:arc,segment"
        );
        if (!wOk) console.error("AddProperty gaugeType Error !");
        wOk = sUISpreadSheet.addProperty("gaugeOptions", "string", "GaugeOptions (JSON)", 6, "");
        if (!wOk) console.error("AddProperty gaugeOptions Error !");
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

    async readRangeMatrixIfValid(sRangeRef) {
        if (!sRangeRef || this.isUnsupportedR1C1RangeRef(sRangeRef)) {
            return null;
        }
        const wQualified = SkCellClass.qualifyRangeRefWithSheet(
            sRangeRef,
            this.rangeReadContext().defaultSheet
        );
        if (!SkCellClass.parseA1RangeBounds(wQualified)) {
            return null;
        }
        const wCtx = this.rangeReadContext();
        return SkCellClass.readA1RangeMatrix(
            sRangeRef,
            "",
            wCtx.defaultSheet,
            this.m_SpInterface
        );
    }

    async readGaugeStringProperty(sName, sFallback) {
        const wRaw = await this.readPropertyValue(sName, "");
        const wText = String(wRaw ?? "").trim();
        return wText !== "" ? wText : sFallback;
    }

    resolveGaugeDrawOptions() {
        const wBg = SkCellClass.readCellBackgroundColor(this.m_Cell);
        const wLight = !wBg || SkCellClass.isLightBackgroundColor(wBg);
        const wBase = wLight
            ? {
                  trackColor: GAUGE_TRACK_COLOR_LIGHT_BG,
                  valueColor: GAUGE_VALUE_COLOR_LIGHT_BG,
                  textColor: GAUGE_TEXT_COLOR_LIGHT_BG,
                  unitColor: GAUGE_UNIT_COLOR_LIGHT_BG,
              }
            : {
                  trackColor: GAUGE_TRACK_COLOR_DARK_BG,
                  valueColor: GAUGE_VALUE_COLOR_DARK_BG,
                  textColor: GAUGE_TEXT_COLOR_DARK_BG,
                  unitColor: GAUGE_UNIT_COLOR_DARK_BG,
              };
        return { ...wBase, ...this.state.options };
    }

    async loadValueFromDataRange() {
        const wCtx = this.rangeReadContext();
        const wRef = await SkCellClass.resolvePropertyRangeRef(this.m_Cell, "DataRange", {
            hostRef: wCtx.hostRef,
            hostSheet: wCtx.hostSheet,
            defaultSheet: wCtx.defaultSheet,
        });
        if (!wRef) {
            const wLiteral = await this.readGaugeStringProperty(
                "DataRange",
                String(GAUGE_DEFAULTS.dataRange)
            );
            const wDirect = SkCellClass.numericFromScalar(wLiteral);
            if (Number.isFinite(wDirect)) {
                this.setState({ value: wDirect });
                return true;
            }
            this.setState({ value: GAUGE_DEFAULTS.value });
            return false;
        }

        try {
            const wValue = await SkCellClass.readFirstNumericFromRangeRef(
                wRef,
                "",
                wCtx.defaultSheet,
                this.m_SpInterface,
            );
            this.setState({ value: wValue });
            return true;
        } catch (error) {
            console.error("Gauge loadValueFromDataRange failed:", error);
            return false;
        }
    }

    loadGaugeOptionsFromCell() {
        const wRaw = SkCellClass.readPropertyFromCellJson(this.m_Cell, "gaugeOptions");
        if (!wRaw) {
            return;
        }
        try {
            const wParsed = JSON.parse(wRaw);
            if (wParsed && typeof wParsed === "object") {
                this.setState((prev) => ({
                    options: { ...prev.options, ...wParsed },
                }));
            }
        } catch (error) {
            console.error("Gauge parse gaugeOptions JSON failed:", error);
        }
    }

    async refreshFromCell() {
        const wLabel = await this.readGaugeStringProperty("label", GAUGE_DEFAULTS.label);
        const wUnit = await this.readGaugeStringProperty("unit", GAUGE_DEFAULTS.unit);
        const wMin = finiteNumber(
            await this.readGaugeStringProperty("min", String(GAUGE_DEFAULTS.min)),
            GAUGE_DEFAULTS.min
        );
        const wMax = finiteNumber(
            await this.readGaugeStringProperty("max", String(GAUGE_DEFAULTS.max)),
            GAUGE_DEFAULTS.max
        );
        const wGaugeType = parseGaugeType(
            await this.readGaugeStringProperty("gaugeType", GAUGE_DEFAULTS.gaugeType)
        );

        this.setState({
            label: wLabel,
            unit: wUnit,
            min: wMin,
            max: wMax,
            gaugeType: wGaugeType,
        });

        this.loadGaugeOptionsFromCell();
        const wLoaded = await this.loadValueFromDataRange();
        if (!wLoaded) {
            this.setState({ value: GAUGE_DEFAULTS.value });
        }
    }

    resolveGaugeRenderState() {
        const wSync = gaugeStateFromCell(this.m_Cell);
        const wRender = {
            ...this.state,
            label: wSync.label,
            unit: wSync.unit,
            min: wSync.min,
            max: wSync.max,
            gaugeType: wSync.gaugeType,
        };
        // Formula/range-bound value comes from async refresh; literals stay sync.
        if (SkCellClass.readPropertyRangeRef(this.m_Cell, "DataRange")) {
            wRender.value = this.state.value;
        } else {
            wRender.value = wSync.value;
        }
        return wRender;
    }

    componentDidMount() {
        void this.refreshFromCell().then(() => this.scheduleCanvasUpdate());
        this.scheduleCanvasUpdate();
    }

    componentDidUpdate(prevProps) {
        const wAttrsChanged =
            this.cellAttributesDigest(this.props.Cell) !==
            this.cellAttributesDigest(prevProps.Cell);
        const wDisplayTick = this.props.Cell?.c_foMeta?.displayTick;
        const wPrevDisplayTick = prevProps.Cell?.c_foMeta?.displayTick;
        const wDisplayTickChanged = wDisplayTick !== wPrevDisplayTick;
        this.m_Cell = this.props.Cell;
        if (wAttrsChanged || wDisplayTickChanged) {
            this.setState(gaugeStateFromCell(this.m_Cell), () => {
                this.scheduleCanvasUpdate();
                void this.refreshFromCell().then(() => this.scheduleCanvasUpdate());
            });
            return;
        }
        this.scheduleCanvasUpdate();
    }

    gaugeMetrics(sWidth, sHeight) {
        const wSize = Math.min(sWidth, sHeight);
        const wCx = sWidth / 2;
        const wCy = sHeight / 2 + wSize * 0.06;
        const wRadius = wSize * 0.36;
        const wLineWidth = Math.max(6, wSize * 0.075);
        return { cx: wCx, cy: wCy, radius: wRadius, lineWidth: wLineWidth, size: wSize };
    }

    drawBackground(ctx, sWidth, sHeight) {
        this.fillCanvasBackground(ctx, sWidth, sHeight);
    }

    drawArcGauge(ctx, sMetrics, sRatio, sOptions) {
        const { cx, cy, radius, lineWidth } = sMetrics;
        const wTrack = sOptions.trackColor || GAUGE_TRACK_COLOR_LIGHT_BG;
        const wValue = sOptions.valueColor || GAUGE_VALUE_COLOR_LIGHT_BG;

        ctx.beginPath();
        ctx.arc(cx, cy, radius, GAUGE_ARC_START, GAUGE_ARC_START + GAUGE_ARC_SWEEP);
        ctx.strokeStyle = wTrack;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = "round";
        ctx.stroke();

        if (sRatio > 0) {
            ctx.beginPath();
            ctx.arc(cx, cy, radius, GAUGE_ARC_START, GAUGE_ARC_START + GAUGE_ARC_SWEEP * sRatio);
            ctx.strokeStyle = wValue;
            ctx.lineWidth = lineWidth;
            ctx.lineCap = "round";
            ctx.stroke();
        }
    }

    drawSegmentGauge(ctx, sMetrics, sRatio, sOptions) {
        const { cx, cy, radius } = sMetrics;
        const wActiveCount = Math.round(sRatio * GAUGE_SEGMENT_COUNT);
        const wActiveColor = sOptions.valueColor || GAUGE_VALUE_COLOR_LIGHT_BG;
        const wTrackColor = sOptions.trackColor || GAUGE_TRACK_COLOR_LIGHT_BG;
        const wInner = radius * 0.7;
        const wOuterActive = radius * 0.96;
        const wOuterInactive = radius * 0.86;
        const wSegWidth = (Math.PI * 2) / GAUGE_SEGMENT_COUNT;
        const wGap = wSegWidth * 0.35;

        for (let wIdx = 0; wIdx < GAUGE_SEGMENT_COUNT; wIdx++) {
            const wActive = wIdx < wActiveCount;
            const wAngle = -Math.PI / 2 + (wIdx / GAUGE_SEGMENT_COUNT) * Math.PI * 2;
            const wInnerR = wInner;
            const wOuterR = wActive ? wOuterActive : wOuterInactive;
            const wHalf = (wSegWidth - wGap) / 2;

            const wX1 = cx + Math.cos(wAngle - wHalf) * wInnerR;
            const wY1 = cy + Math.sin(wAngle - wHalf) * wInnerR;
            const wX2 = cx + Math.cos(wAngle - wHalf) * wOuterR;
            const wY2 = cy + Math.sin(wAngle - wHalf) * wOuterR;
            const wX3 = cx + Math.cos(wAngle + wHalf) * wOuterR;
            const wY3 = cy + Math.sin(wAngle + wHalf) * wOuterR;
            const wX4 = cx + Math.cos(wAngle + wHalf) * wInnerR;
            const wY4 = cy + Math.sin(wAngle + wHalf) * wInnerR;

            ctx.beginPath();
            ctx.moveTo(wX1, wY1);
            ctx.lineTo(wX2, wY2);
            ctx.lineTo(wX3, wY3);
            ctx.lineTo(wX4, wY4);
            ctx.closePath();
            ctx.fillStyle = wActive ? wActiveColor : wTrackColor;
            ctx.fill();
        }
    }

    drawCenterText(ctx, sMetrics, sState) {
        const { cx, cy, size } = sMetrics;
        const { value, unit, label, options } = sState;
        const wText = options.textColor || GAUGE_TEXT_COLOR_LIGHT_BG;
        const wUnitColor = options.unitColor || GAUGE_UNIT_COLOR_LIGHT_BG;
        const wValueText = formatGaugeValue(value);
        const wValueFont = Math.max(14, size * 0.22);
        const wUnitFont = Math.max(9, size * 0.1);
        const wLabelFont = Math.max(9, size * 0.09);

        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = wText;
        ctx.font = `600 ${wValueFont}px "Segoe UI", Roboto, Arial, sans-serif`;
        const wValueW = ctx.measureText(wValueText).width;

        ctx.fillText(wValueText, cx - wValueW / 2, cy - size * 0.02);

        if (unit) {
            ctx.fillStyle = wUnitColor;
            ctx.font = `400 ${wUnitFont}px "Segoe UI", Roboto, Arial, sans-serif`;
            ctx.fillText(unit, cx - wValueW / 2 + wValueW + size * 0.02, cy - size * 0.01);
        }

        if (label) {
            ctx.fillStyle = wText;
            ctx.textAlign = "center";
            ctx.font = `400 ${wLabelFont}px "Segoe UI", Roboto, Arial, sans-serif`;
            ctx.fillText(label, cx, cy + size * 0.16);
        }
    }

    drawGauge(ctx, sWidth, sHeight) {
        const wRender = this.resolveGaugeRenderState();
        const { value, min, max, gaugeType } = wRender;
        const wOptions = this.resolveGaugeDrawOptions();
        const wRatio = gaugeRatio(value, min, max);
        const wMetrics = this.gaugeMetrics(sWidth, sHeight);

        if (sWidth <= 0 || sHeight <= 0) {
            return;
        }

        this.drawBackground(ctx, sWidth, sHeight);

        if (gaugeType === "segment") {
            this.drawSegmentGauge(ctx, wMetrics, wRatio, wOptions);
        } else {
            this.drawArcGauge(ctx, wMetrics, wRatio, wOptions);
        }

        this.drawCenterText(ctx, wMetrics, { ...wRender, options: wOptions });
    }

    paintExportInk(ctx, width, height) {
        if (width <= 0 || height <= 0) {
            return;
        }
        const wRender = this.resolveGaugeRenderState();
        const wOptions = this.resolveGaugeDrawOptions();
        const wRatio = gaugeRatio(wRender.value, wRender.min, wRender.max);
        const wMetrics = this.gaugeMetrics(width, height);
        if (wRender.gaugeType === "segment") {
            this.drawSegmentGauge(ctx, wMetrics, wRatio, wOptions);
        } else {
            this.drawArcGauge(ctx, wMetrics, wRatio, wOptions);
        }
        this.drawCenterText(ctx, wMetrics, { ...wRender, options: wOptions });
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
        this.drawGauge(wCtx, wWidth, wHeight);
    }

    render() {
        const wLayout = this.CellPosSizeChart();
        this.state.zIndex = 3;
        const wIsFloating = this.m_Cell?.c_fo === true;

        const wCellStyleParent = {
            position: "absolute",
            margin: "0px",
            padding: "0px",
            left: wLayout.X + "px",
            top: wLayout.Y + "px",
            width: wLayout.W + "px",
            height: wLayout.H + "px",
            overflow: "hidden",
            ...(wIsFloating ? {} : { zIndex: this.state.zIndex }),
        };

        return (
            <div
                style={wCellStyleParent}
                className="SkSpCellClass"
                onMouseDownCapture={this.onCellClassMouseDownCapture}
            >
                <canvas
                    ref={this.canvasRef}
                    width={wLayout.canvasW}
                    height={wLayout.canvasH}
                    onMouseDownCapture={this.onFloatingObjectCanvasMouseDownCapture}
                    style={{
                        width: wLayout.canvasW + "px",
                        height: wLayout.canvasH + "px",
                        marginLeft: wLayout.offsetX + "px",
                        marginTop: wLayout.offsetY + "px",
                        display: "block",
                        cursor: wIsFloating ? "default" : "pointer",
                    }}
                />
            </div>
        );
    }
}

SkCellClass.installPdfExportStatics(SkCellClassGauge, {
    initialState: (cell) => ({
        ...gaugeStateFromCell(cell),
        options: {},
        zIndex: 0,
    }),
    hydrate: async (painter) => {
        await painter.refreshFromCell();
    },
});

export default SkCellClassGauge;
