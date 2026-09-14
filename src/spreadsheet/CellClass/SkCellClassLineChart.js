//=============================================================================
// SkCellClassLineChart
// Component to draw line, area, and bar charts using Canvas
//=============================================================================
import React from "react";
import SkCellClass from "./SkCellClass.js";
import { GetFontStyle, GetFontWeight, buildCanvasFontFamily } from "../../utility/SkUtility.js";
import { fontSizeCssPxFromPt } from "../../utility/SkFontPool.js";

function Render(sCell, sSpInterface) {
    return (<SkCellClassLineChart Cell={sCell} key={sCell.c_k} SpInterface={sSpInterface}></SkCellClassLineChart>)
}

/** Coerce chart data to a number (int/double wire only; else 0). */
function numericChartValue(v) {
    return SkCellClass.numericFromScalar(v);
}

/** Parse a matrix cell for chart series — labels pass through, numbers from calculable scalar. */
function lineChartNumericFromCell(sRaw) {
    return SkCellClass.numericFromScalar(sRaw);
}

const LINE_SIDE_PAD = 36;
const LINE_CHART_FRAME_PAD = 10;
const LINE_RIGHT_PAD = 12;
const LINE_VALUE_AXIS_LABEL_GAP = 12;
const LINE_TOP_GAP = 10;
const LINE_X_LABEL_BAND_MIN = 22;
const LINE_X_LABEL_SLANT_RAD = Math.PI / 4;
const LINE_LEGEND_BAND = 28;
const LINE_BOTTOM_MARGIN = 8;
const HBAR_VALUE_AXIS_BAND = 22;
const HBAR_CATEGORY_PAD_MIN = 96;
const HBAR_CATEGORY_PAD_MAX = 200;
const HBAR_RIGHT_PAD = 10;
const HBAR_LEGEND_AXIS_GAP = 4;
const TOOLTIP_PAD_X = 10;
const TOOLTIP_PAD_Y = 7;
const TOOLTIP_EDGE_PAD = 4;
const TOOLTIP_RADIUS = 5;
/** Excel-like floating chart size at 100% zoom (96 dpi reference). */
const LINE_CHART_REF_W = 480;
const LINE_CHART_REF_H = 300;
const LINE_CHART_UI_SCALE_MIN = 0.72;
const LINE_CHART_UI_SCALE_MAX = 1.28;
const LINE_AXIS_FONT_PT = 9;
const LINE_TITLE_FONT_PT = 10;
const LINE_TOOLTIP_FONT_PT = 9;

/** Scale chart chrome to container size (Excel proportions at any pixel size). */
function lineChartUiScale(sWidth, sHeight) {
    const wW = Math.max(1, Number(sWidth) || 1);
    const hH = Math.max(1, Number(sHeight) || 1);
    const wRaw = Math.sqrt((wW / LINE_CHART_REF_W) * (hH / LINE_CHART_REF_H));
    return Math.max(
        LINE_CHART_UI_SCALE_MIN,
        Math.min(LINE_CHART_UI_SCALE_MAX, wRaw)
    );
}

function chartPx(sValue, sScale) {
    return Math.max(1, Math.round(sValue * sScale * 10) / 10);
}

/** Scaled fonts, paddings, and bands for one paint/layout pass. */
function buildLineChartUi(sWidth, sHeight) {
    const wScale = lineChartUiScale(sWidth, sHeight);
    const px = (n) => chartPx(n, wScale);
    const wAxisPx = fontSizeCssPxFromPt(LINE_AXIS_FONT_PT) * wScale;
    const wTitlePx = fontSizeCssPxFromPt(LINE_TITLE_FONT_PT) * wScale;
    const wTooltipPx = fontSizeCssPxFromPt(LINE_TOOLTIP_FONT_PT) * wScale;
    const wFramePad = px(LINE_CHART_FRAME_PAD);
    return {
        scale: wScale,
        framePad: wFramePad,
        rightPad: px(LINE_RIGHT_PAD),
        valueAxisLabelGap: px(LINE_VALUE_AXIS_LABEL_GAP),
        topGap: px(LINE_TOP_GAP),
        xLabelBandMin: px(LINE_X_LABEL_BAND_MIN),
        legendBand: px(LINE_LEGEND_BAND),
        bottomMargin: px(LINE_BOTTOM_MARGIN),
        titleBandTitle: wFramePad + px(22),
        titleBandNoTitle: wFramePad + px(14),
        titleYOffset: wFramePad + px(4),
        xLabelAnchorGap: px(4),
        axisFont: `${wAxisPx}px Roboto`,
        axisFontSize: wAxisPx,
        titleFontSize: wTitlePx,
        tooltipFont: `${wTooltipPx}px Roboto`,
        tooltipFontSize: wTooltipPx,
        tooltipPadX: px(TOOLTIP_PAD_X),
        tooltipPadY: px(TOOLTIP_PAD_Y),
        tooltipEdgePad: px(TOOLTIP_EDGE_PAD),
        tooltipRadius: px(TOOLTIP_RADIUS),
    };
}

/** Tooltip box sized to label text. */
function measureTooltipBox(ctx, sLabel, sUi = null) {
    const wFont = sUi?.tooltipFont ?? "12px Roboto";
    const wPadX = sUi?.tooltipPadX ?? TOOLTIP_PAD_X;
    const wPadY = sUi?.tooltipPadY ?? TOOLTIP_PAD_Y;
    const wFontSize = sUi?.tooltipFontSize ?? 12;
    ctx.font = wFont;
    const wTextWidth = ctx.measureText(String(sLabel)).width;
    return {
        width: Math.ceil(wTextWidth) + 2 * wPadX,
        height: wFontSize + 2 * wPadY,
    };
}

/** Keep tooltip box inside the canvas (parent uses overflow:hidden). */
function clampTooltipRect(sBoxX, sBoxY, sBoxW, sBoxH, sCanvasW, sCanvasH, sUi = null) {
    const wPad = sUi?.tooltipEdgePad ?? TOOLTIP_EDGE_PAD;
    return {
        x: Math.max(wPad, Math.min(sBoxX, sCanvasW - sBoxW - wPad)),
        y: Math.max(wPad, Math.min(sBoxY, sCanvasH - sBoxH - wPad)),
    };
}

/** Shared centered tooltip paint (line, area, vertical bars). */
function paintCenteredTooltip(ctx, sLabel, sAnchorX, sAnchorY, sGapAbove, sCanvasW, sCanvasH, sUi = null) {
    const wBox = measureTooltipBox(ctx, sLabel, sUi);
    const wRadius = sUi?.tooltipRadius ?? TOOLTIP_RADIUS;
    const wClamped = clampTooltipRect(
        sAnchorX - wBox.width / 2,
        sAnchorY - wBox.height - sGapAbove,
        wBox.width,
        wBox.height,
        sCanvasW,
        sCanvasH,
        sUi
    );
    ctx.beginPath();
    ctx.roundRect(wClamped.x, wClamped.y, wBox.width, wBox.height, wRadius);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(sLabel, wClamped.x + wBox.width / 2, wClamped.y + wBox.height / 2);
}

/** Shared left-anchored tooltip paint (horizontal bars). */
function paintLeftTooltip(ctx, sLabel, sAnchorX, sAnchorY, sCanvasW, sCanvasH, sUi = null) {
    const wBox = measureTooltipBox(ctx, sLabel, sUi);
    const wRadius = sUi?.tooltipRadius ?? TOOLTIP_RADIUS;
    const wPadX = sUi?.tooltipPadX ?? TOOLTIP_PAD_X;
    const wClamped = clampTooltipRect(
        sAnchorX,
        sAnchorY - wBox.height / 2,
        wBox.width,
        wBox.height,
        sCanvasW,
        sCanvasH,
        sUi
    );
    ctx.beginPath();
    ctx.roundRect(wClamped.x, wClamped.y, wBox.width, wBox.height, wRadius);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(sLabel, wClamped.x + wPadX, wClamped.y + wBox.height / 2);
}

/** Max numeric value across every series point. */
function dataMaxFromSeries(sSeries) {
    if (!Array.isArray(sSeries) || sSeries.length === 0) {
        return 0;
    }
    return Math.max(
        0,
        ...sSeries.flatMap((s) =>
            (Array.isArray(s.data) ? s.data : []).map((d) => numericChartValue(d.value))
        )
    );
}

/** Excel-style "nice" tick step (1, 2, 5 × 10^n). */
function niceTickStep(sRange, sMaxTickCount = 6) {
    if (!Number.isFinite(sRange) || sRange <= 0) {
        return 1;
    }
    const wRough = sRange / Math.max(1, sMaxTickCount);
    const wPow = Math.pow(10, Math.floor(Math.log10(wRough)));
    const wRes = wRough / wPow;
    let wNiceRes;
    if (wRes <= 1) {
        wNiceRes = 1;
    } else if (wRes <= 2) {
        wNiceRes = 2;
    } else if (wRes <= 5) {
        wNiceRes = 5;
    } else {
        wNiceRes = 10;
    }
    return wNiceRes * wPow;
}

/** Round axis max up and build ticks from 0 (e.g. 281k → 0…300k step 50k). */
function computeNiceValueAxisScale(sDataMax, sMaxTickCount = 6) {
    if (!Number.isFinite(sDataMax) || sDataMax <= 0) {
        const wStep = 1;
        const wMax = 5 * wStep;
        return { max: wMax, ticks: [0, 1, 2, 3, 4, 5], step: wStep };
    }
    const wStep = niceTickStep(sDataMax, sMaxTickCount);
    const wMax = Math.ceil(sDataMax / wStep) * wStep;
    const wTicks = [];
    for (let v = 0; v <= wMax + wStep * 1e-6; v += wStep) {
        wTicks.push(Math.round(v * 1e9) / 1e9);
    }
    return { max: wMax, ticks: wTicks, step: wStep };
}

/** Y position for a value tick on the vertical value axis. */
function valueAxisTickY(sPlotTop, sChartHeight, sTickValue, sAxisMax) {
    const wMax = Math.max(1e-12, numericChartValue(sAxisMax));
    return sPlotTop + sChartHeight * (1 - numericChartValue(sTickValue) / wMax);
}

/** X position for a value tick on the horizontal value axis. */
function valueAxisTickX(sPlotLeft, sChartWidth, sTickValue, sAxisMax, sSpan = null) {
    const wMax = Math.max(1e-12, numericChartValue(sAxisMax));
    const wSpan = sSpan != null ? sSpan : sChartWidth;
    return sPlotLeft + (wSpan * numericChartValue(sTickValue)) / wMax;
}

/** Shared horizontal-bar slot geometry (category band + clustered bar Y). */
function horizontalBarSlotMetrics(
    sCategoryCount,
    sSeriesCount,
    sBarWidth,
    sChartHeight,
    sPlotTop,
    sPointIndex,
    sSeriesIndex
) {
    const wSafeCategories = Math.max(1, sCategoryCount);
    const wSafeSeries = Math.max(1, sSeriesCount);
    const wGroupHeight = sChartHeight / wSafeCategories;
    const wGroupY = sPlotTop + sPointIndex * wGroupHeight;
    const wClusterHeight = wGroupHeight * sBarWidth;
    const wSingleBarHeight = wClusterHeight / wSafeSeries;
    const wBarY =
        wGroupY +
        (wGroupHeight - wClusterHeight) / 2 +
        sSeriesIndex * wSingleBarHeight;
    return {
        groupHeight: wGroupHeight,
        barY: wBarY,
        barHeight: wSingleBarHeight,
        categoryCenterY: wGroupY + wGroupHeight / 2,
    };
}

/** Truncate long category labels like Excel axis ellipsis. */
function truncateCategoryLabel(sLabel, sMaxLen = 26) {
    const wText = String(sLabel ?? "").trim();
    if (wText.length <= sMaxLen) {
        return wText;
    }
    return `${wText.slice(0, Math.max(0, sMaxLen - 1))}…`;
}

/** Excel union charts skip blank rows, section headers, and Total* subtotal rows. */
function shouldIncludeHorizontalBarMatrixRow(sLabel, sValueRow) {
    const wLabel = String(
        Array.isArray(sLabel) ? sLabel[0] : sLabel ?? ""
    ).trim();
    if (wLabel === "") {
        return false;
    }
    const wCells = Array.isArray(sValueRow) ? sValueRow : [sValueRow];
    const wHasNumeric = wCells.some((wCell) => {
        const wText = wCell != null ? String(wCell).trim() : "";
        if (wText === "") {
            return false;
        }
        return Number.isFinite(lineChartNumericFromCell(wText));
    });
    if (!wHasNumeric) {
        return false;
    }
    if (/^Total\b/i.test(wLabel)) {
        return false;
    }
    // Skip row-index placeholders and orphan numeric cells from rectangular imports.
    if (/^\d{1,3}$/.test(wLabel)) {
        return false;
    }
    return true;
}

function isSingleHeaderRowMatrix(sMatrix) {
    return (
        Array.isArray(sMatrix) &&
        sMatrix.length === 1 &&
        Array.isArray(sMatrix[0]) &&
        sMatrix[0].length > 0
    );
}

function inferCategoryRangeRefFromValueRef(sValueRef) {
    const wQualified = SkCellClass.qualifyRangeRefWithSheet(sValueRef, "");
    const wBounds = SkCellClass.parseA1RangeBounds(wQualified);
    if (!wBounds || wBounds.left <= 1) {
        return "";
    }
    const wSheet = SkCellClass.parseSheetFromRangeRef(wQualified);
    const wLeftRef = SkCellClass.cellRefFromRowCol(wBounds.top, wBounds.left - 1);
    const wRightRef = SkCellClass.cellRefFromRowCol(wBounds.bottom, wBounds.left - 1);
    const wRange =
        wBounds.top === wBounds.bottom ? wLeftRef : `${wLeftRef}:${wRightRef}`;
    return wSheet ? `${wSheet}!${wRange}` : wRange;
}

/** One header row (series names) + value rows — e.g. C4:D4 + C5:D7 with labels in column B. */
function lineSeriesFromHeaderRowAndValueMatrix(
    sHeaderRow,
    sValueMatrix,
    sCategoryColumn
) {
    const wHeaders = Array.isArray(sHeaderRow) ? sHeaderRow : [];
    const wValues = Array.isArray(sValueMatrix) ? sValueMatrix : [];
    const wCategories = Array.isArray(sCategoryColumn) ? sCategoryColumn : [];
    if (wHeaders.length === 0 || wValues.length === 0) {
        return [];
    }
    const wSeries = [];
    for (let wCol = 0; wCol < wHeaders.length; wCol++) {
        const wName = wHeaders[wCol] != null ? String(wHeaders[wCol]).trim() : "";
        const wData = [];
        for (let wRow = 0; wRow < wValues.length; wRow++) {
            const wValueRow = wValues[wRow];
            const wRawValue = Array.isArray(wValueRow) ? wValueRow[wCol] : wValueRow;
            const wRawText = wRawValue != null ? String(wRawValue).trim() : "";
            const wValue = wRawText !== "" ? lineChartNumericFromCell(wRawText) : 0;
            const wCategoryRow = wCategories[wRow];
            const wCategoryCell = Array.isArray(wCategoryRow)
                ? wCategoryRow[0]
                : wCategoryRow;
            if (!shouldIncludeHorizontalBarMatrixRow(wCategoryCell, wValueRow)) {
                continue;
            }
            const wLabel =
                wCategoryCell != null && String(wCategoryCell).trim() !== ""
                    ? String(wCategoryCell).trim()
                    : String(wRow + 1);
            wData.push({
                label: wLabel,
                value: Number.isFinite(wValue) ? wValue : 0,
            });
        }
        if (wData.length > 0) {
            wSeries.push({
                name: wName !== "" ? wName : `Series ${wCol + 1}`,
                color: LINE_DEFAULT_COLORS[wCol % LINE_DEFAULT_COLORS.length],
                data: wData,
            });
        }
    }
    return wSeries;
}

// Same Excel Office palette as SkCellClassPieChart (teal, orange, green, …).
const LINE_DEFAULT_COLORS = [
    "#378DAB",
    "#ED7D31",
    "#548235",
    "#5B9BD5",
    "#7030A0",
    "#70AD47",
    "#1F4E79",
    "#385723",
    "#C65911",
    "#FFC000",
];

/** One { label, value } point from a matrix row. */
function linePointFromRow(sRow, sLabelCol, sValueCol) {
    if (!Array.isArray(sRow) || sRow.length <= sValueCol) {
        return null;
    }
    const wValue = lineChartNumericFromCell(sRow[sValueCol]);
    if (!Number.isFinite(wValue)) {
        return null;
    }
    const wLabel =
        sLabelCol >= 0 && sRow[sLabelCol] != null
            ? String(sRow[sLabelCol]).trim()
            : "";
    return { label: wLabel, value: wValue };
}

/** Split: label column + value matrix → one series per value column. */
function lineSeriesFromSplitLabelsAndValueColumns(sLabelColumn, sValueMatrix) {
    const wLabelRows = Array.isArray(sLabelColumn) ? sLabelColumn : [];
    const wValueRows = Array.isArray(sValueMatrix) ? sValueMatrix : [];
    const wRowCount = Math.min(wLabelRows.length, wValueRows.length);
    if (wRowCount === 0) {
        return [];
    }
    const wColCount = Math.max(
        ...wValueRows.map((row) => (Array.isArray(row) ? row.length : 0))
    );
    if (wColCount === 0) {
        return [];
    }
    const wSeries = [];
    for (let wCol = 0; wCol < wColCount; wCol++) {
        const wData = [];
        for (let wIdx = 0; wIdx < wRowCount; wIdx++) {
            const wLabelRow = wLabelRows[wIdx];
            const wValueRow = wValueRows[wIdx];
            const wLabel = Array.isArray(wLabelRow) ? wLabelRow[0] : wLabelRow;
            if (!shouldIncludeHorizontalBarMatrixRow(wLabel, wValueRow)) {
                continue;
            }
            const wRawValue = Array.isArray(wValueRow) ? wValueRow[wCol] : wValueRow;
            const wRawText = wRawValue != null ? String(wRawValue).trim() : "";
            const wValue = wRawText !== "" ? lineChartNumericFromCell(wRawText) : 0;
            wData.push({
                label: wLabel != null ? String(wLabel).trim() : "",
                value: Number.isFinite(wValue) ? wValue : 0,
            });
        }
        if (wData.length > 0) {
            wSeries.push({
                name: `Series ${wCol + 1}`,
                color: LINE_DEFAULT_COLORS[wCol % LINE_DEFAULT_COLORS.length],
                data: wData,
            });
        }
    }
    return wSeries;
}

/** Split label + value columns → single series (same layout as PieChart). */
function lineSeriesFromSplitColumns(sLabelColumn, sValueColumn) {
    const wLabelRows = Array.isArray(sLabelColumn) ? sLabelColumn : [];
    const wValueRows = Array.isArray(sValueColumn) ? sValueColumn : [];
    const wLen = Math.min(wLabelRows.length, wValueRows.length);
    const wData = [];
    for (let wIdx = 0; wIdx < wLen; wIdx++) {
        const wLabelRow = wLabelRows[wIdx];
        const wValueRow = wValueRows[wIdx];
        const wLabel = Array.isArray(wLabelRow) ? wLabelRow[0] : wLabelRow;
        const wRawValue = Array.isArray(wValueRow) ? wValueRow[0] : wValueRow;
        if (!shouldIncludeHorizontalBarMatrixRow(wLabel, wValueRow)) {
            continue;
        }
        const wRawText = wRawValue != null ? String(wRawValue).trim() : "";
        const wValue = wRawText !== "" ? lineChartNumericFromCell(wRawText) : 0;
        wData.push({
            label: wLabel != null ? String(wLabel).trim() : "",
            value: Number.isFinite(wValue) ? wValue : 0,
        });
    }
    if (wData.length === 0) {
        return [];
    }
    return [
        {
            name: "Series 1",
            color: LINE_DEFAULT_COLORS[0],
            data: wData,
        },
    ];
}

/** Matrix: col 0 = X labels; cols 1..n = one series per column. */
function lineSeriesFromRangeMatrix(sMatrix) {
    if (!Array.isArray(sMatrix) || sMatrix.length === 0) {
        return [];
    }
    const wColCount = Math.max(
        ...sMatrix.map((row) => (Array.isArray(row) ? row.length : 0))
    );
    if (wColCount < 2) {
        const wData = [];
        for (let wIdx = 0; wIdx < sMatrix.length; wIdx++) {
            const wRow = sMatrix[wIdx];
            const wRaw = Array.isArray(wRow) ? wRow[0] : wRow;
            const wRawText = wRaw != null ? String(wRaw).trim() : "";
            if (wRawText === "") {
                continue;
            }
            const wValue = lineChartNumericFromCell(wRawText);
            if (!Number.isFinite(wValue)) {
                continue;
            }
            wData.push({ label: String(wIdx + 1), value: wValue });
        }
        if (wData.length === 0) {
            return [];
        }
        return [
            {
                name: "Series 1",
                color: LINE_DEFAULT_COLORS[0],
                data: wData,
            },
        ];
    }
    const wSeries = [];
    for (let wCol = 1; wCol < wColCount; wCol++) {
        const wData = [];
        for (let wRowIdx = 0; wRowIdx < sMatrix.length; wRowIdx++) {
            const wRow = sMatrix[wRowIdx];
            const wLabelCell = Array.isArray(wRow) ? wRow[0] : wRow;
            if (!shouldIncludeHorizontalBarMatrixRow(wLabelCell, wRow)) {
                continue;
            }
            const wPoint = linePointFromRow(wRow, 0, wCol);
            if (wPoint != null) {
                wData.push(wPoint);
            } else {
                const wLabel =
                    wLabelCell != null && String(wLabelCell).trim() !== ""
                        ? String(wLabelCell).trim()
                        : "";
                if (wLabel !== "") {
                    wData.push({ label: wLabel, value: 0 });
                }
            }
        }
        if (wData.length === 0) {
            continue;
        }
        wSeries.push({
            name: `Series ${wCol}`,
            color: LINE_DEFAULT_COLORS[(wCol - 1) % LINE_DEFAULT_COLORS.length],
            data: wData,
        });
    }
    return wSeries;
}

/** Flatten a label range (row or column) into series names left-to-right, top-to-bottom. */
function seriesNamesFromRangeMatrix(sMatrix) {
    if (!Array.isArray(sMatrix) || sMatrix.length === 0) {
        return [];
    }
    const wNames = [];
    for (const wRow of sMatrix) {
        const wCells = Array.isArray(wRow) ? wRow : [wRow];
        for (const wCell of wCells) {
            const wText = wCell != null ? String(wCell).trim() : "";
            if (wText !== "") {
                wNames.push(wText);
            }
        }
    }
    return wNames;
}

/** X/Y for each point in a line-like series (line / area). */
function seriesPointCoords(sSerie, sPad, sPlotTop, sChartWidth, sChartHeight, sMaxValue) {
    const wData = Array.isArray(sSerie?.data) ? sSerie.data : [];
    if (wData.length === 0) {
        return [];
    }
    const wDenom = Math.max(1, wData.length - 1);
    const wBaselineY = sPlotTop + sChartHeight;
    return wData.map((point, wIndex) => {
        const wX = sPad + (wIndex * sChartWidth) / wDenom;
        const wY =
            sPlotTop +
            sChartHeight * (1 - numericChartValue(point.value) / sMaxValue);
        return { x: wX, y: wY, index: wIndex, baselineY: wBaselineY };
    });
}

function applySeriesNames(sSeries, sNames) {
    if (!Array.isArray(sSeries) || sSeries.length === 0) {
        return sSeries;
    }
    if (!Array.isArray(sNames) || sNames.length === 0) {
        return sSeries;
    }
    return sSeries.map((serie, wIdx) => {
        const wName = sNames[wIdx] != null ? String(sNames[wIdx]).trim() : "";
        return {
            ...serie,
            name: wName !== "" ? wName : serie.name,
        };
    });
}

class SkCellClassLineChart extends SkCellClass {
    constructor(props) {
        super(props)
        this.canvasRef = React.createRef();
        this.m_SpInterface=props.SpInterface;
        this.state = {
            series: [],
            type: "line",
            barDirection: "vertical",
            hoveredPoint: null, // { seriesIndex, pointIndex }
            selectedPoint: null, // { seriesIndex, pointIndex }
            options: {
                showGrid: true,
                showPoints: true,
                showLegend: true,
                lineWidth: 2,
                pointRadius: 4,
                areaFillOpacity: 0.35,
                barWidth: 0.7,
                colors: {
                    grid: '#e0e0e0',
                    axis: '#333333'
                }
            },
            zIndex: 0,
            valueAxisWitness: { ref: "", sheet: "" },
            valueAxisTickLabels: [],
            valueAxisTicks: [],
            valueAxisMax: 0,
        };
        this.m_Data = {};
        this.m_Title = "";
        this.m_ChartType = "";
        this.m_BarDirection = "";
        this.m_SpInterface = props.SpInterface;
        this.m_valueFormatCache = new Map();
    }

    static ClassName() { return ("SkCellClassLineChart") }

    static cellClassCapabilities() {
        return { ...SkCellClass.cellClassCapabilities(), floatingObject: true };
    }

    // SVG icon representing axes with a line chart
    static Icon() {
        return (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%">
                <line x1="4" y1="4"  x2="4"  y2="20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="4" y1="20" x2="21" y2="20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <polyline points="6,16 10,11 13,14 17,6 20,9" fill="none"
                          stroke="#1976d2" strokeWidth="2"
                          strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="10" cy="11" r="1.3" fill="#1976d2"/>
                <circle cx="13" cy="14" r="1.3" fill="#1976d2"/>
                <circle cx="17" cy="6"  r="1.3" fill="#1976d2"/>
            </svg>
        );
    }

    static registerClassAttribute(sUISpreadSheet) {
        super.registerClassAttribute(sUISpreadSheet, "LineChart", "Javascript", Render);
        let wOk = sUISpreadSheet.addProperty("Title", "string", "Title", 0, "");
        if (!wOk) console.error("AddProperty Title Error !");
        wOk = sUISpreadSheet.addProperty(
            "chartData",
            "string",
            "Labels range (or A:B combined)",
            1,
            "",
            "range"
        );
        if (!wOk) console.error("AddProperty chartData Error !");
        wOk = sUISpreadSheet.addProperty(
            "DataRange",
            "string",
            "Values range (or A:B combined)",
            2,
            "",
            "range"
        );
        if (!wOk) console.error("AddProperty DataRange Error !");
        wOk = sUISpreadSheet.addProperty(
            "seriesLabels",
            "string",
            "Series labels range",
            3,
            "",
            "range"
        );
        if (!wOk) console.error("AddProperty seriesLabels Error !");
        wOk = sUISpreadSheet.addProperty(
            "chartType",
            "string",
            "Chart type",
            4,
            "line",
            "enum:line,bar,area"
        );
        if (!wOk) console.error("AddProperty chartType Error !");
        wOk = sUISpreadSheet.addProperty(
            "barDirection",
            "string",
            "Bar direction",
            5,
            "vertical",
            "enum:vertical,horizontal"
        );
        if (!wOk) console.error("AddProperty barDirection Error !");
    }

    SetDirectProperty(sName,sValue) {
        this.m_Data[sName]=sValue;
    }

    GetDirectProperty(sName) {
        return(this.m_Data[sName]);
    }

    readTitleFromCell() {
        return this.readPropertyCachedOrLiteral("Title", this.m_Title);
    }

    async syncTitleFromCell() {
        await this.syncPropertyFromCell("Title", this, "m_Title");
    }

    cellAttributesDigest(sCell) {
        const wAttrs = sCell?.c_v?.c?.a;
        return Array.isArray(wAttrs) ? JSON.stringify(wAttrs) : "";
    }

    isUnsupportedR1C1RangeRef(sRangeRef) {
        return /R\[|C\[/.test(String(sRangeRef || ""));
    }

    isCombinedRangeRef(sRangeRef) {
        const wBounds = SkCellClass.parseA1RangeBounds(sRangeRef);
        return wBounds != null && wBounds.right > wBounds.left;
    }

    rangeReadContext() {
        return SkCellClass.buildRangeReadContext(this.m_Cell, this.m_SpInterface);
    }

    async readRangeMatrixIfValid(sRangeRef) {
        if (!sRangeRef) {
            return null;
        }
        if (this.isUnsupportedR1C1RangeRef(sRangeRef)) {
            const wCtx = this.rangeReadContext();
            const wHost = SkCellClass.splitHostAttributeRef(wCtx.hostRef, wCtx.hostSheet);
            const wHostRc = SkCellClass.parseA1CellRef(wHost.ref);
            if (wHostRc) {
                sRangeRef = SkCellClass.convertR1C1RangeRefToA1(
                    sRangeRef,
                    wHostRc.row,
                    wHostRc.col
                );
            }
            if (this.isUnsupportedR1C1RangeRef(sRangeRef)) {
                console.warn(
                    "LineChart: R1C1 range refs are not supported yet; use A1 (e.g. =A15:B17)."
                );
                return null;
            }
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

    async loadSeriesLabelNames() {
        const wCtx = this.rangeReadContext();
        const wResolveOpts = {
            hostRef: wCtx.hostRef,
            hostSheet: wCtx.hostSheet,
            defaultSheet: wCtx.defaultSheet,
        };
        const wSeriesLabelsRef = await SkCellClass.resolvePropertyRangeRef(
            this.m_Cell,
            "seriesLabels",
            wResolveOpts
        );
        if (!wSeriesLabelsRef) {
            return [];
        }
        const wMatrix = await this.readRangeMatrixIfValid(wSeriesLabelsRef);
        return seriesNamesFromRangeMatrix(wMatrix);
    }

    commitSeriesState(sSeries) {
        if (!Array.isArray(sSeries) || sSeries.length === 0) {
            return false;
        }
        this.setState({ series: sSeries });
        return true;
    }

    displayChartValue(sValue) {
        const wNum = numericChartValue(sValue);
        const wCached = this.m_valueFormatCache.get(wNum);
        if (wCached != null) {
            return wCached;
        }
        if (Number.isFinite(wNum) && Math.abs(wNum - Math.round(wNum)) < 1e-9) {
            return String(Math.round(wNum));
        }
        return String(wNum);
    }

    async loadValueAxisWitness() {
        const wCtx = this.rangeReadContext();
        const wResolveOpts = {
            hostRef: wCtx.hostRef,
            hostSheet: wCtx.hostSheet,
            defaultSheet: wCtx.defaultSheet,
        };
        let wValueRef = await SkCellClass.resolvePropertyRangeRef(
            this.m_Cell,
            "DataRange",
            wResolveOpts
        );
        if (!wValueRef) {
            wValueRef = await SkCellClass.resolvePropertyRangeRef(
                this.m_Cell,
                "chartData",
                wResolveOpts
            );
        }
        if (!wValueRef) {
            return { ref: "", sheet: "" };
        }
        const wSheet = SkCellClass.resolveRangeReadSheet(
            wValueRef,
            "",
            wCtx.defaultSheet,
            this.m_SpInterface
        );
        return SkCellClass.firstValueWitnessCellRef(wValueRef, wSheet);
    }

    async cacheFormattedChartValue(sWitness, sValue) {
        const wNum = numericChartValue(sValue);
        if (this.m_valueFormatCache.has(wNum)) {
            return this.m_valueFormatCache.get(wNum);
        }
        let wText;
        if (sWitness?.ref) {
            wText = await SkCellClass.formatValueWithCellFormat(
                sWitness.ref,
                wNum,
                sWitness.sheet
            );
        } else if (Number.isFinite(wNum) && Math.abs(wNum - Math.round(wNum)) < 1e-9) {
            wText = String(Math.round(wNum));
        } else {
            wText = String(wNum);
        }
        this.m_valueFormatCache.set(wNum, wText);
        return wText;
    }

    async rebuildValueAxisLabels() {
        const wWitness = await this.loadValueAxisWitness();
        const { series } = this.state;
        if (!Array.isArray(series) || series.length === 0) {
            this.setState({
                valueAxisWitness: wWitness,
                valueAxisTickLabels: [],
                valueAxisTicks: [],
                valueAxisMax: 0,
            });
            return;
        }

        this.m_valueFormatCache.clear();
        const wScale = computeNiceValueAxisScale(dataMaxFromSeries(series));
        const wTickLabels = [];
        for (const wValue of wScale.ticks) {
            // eslint-disable-next-line no-await-in-loop
            wTickLabels.push(await this.cacheFormattedChartValue(wWitness, wValue));
        }

        for (const wSerie of series) {
            for (const wPoint of wSerie.data) {
                // eslint-disable-next-line no-await-in-loop
                await this.cacheFormattedChartValue(wWitness, wPoint.value);
            }
        }

        this.setState(
            {
                valueAxisWitness: wWitness,
                valueAxisTickLabels: wTickLabels,
                valueAxisTicks: wScale.ticks,
                valueAxisMax: wScale.max,
            },
            () => this.updateCanvas()
        );
    }

    resolveValueAxisScale() {
        const wTicks = Array.isArray(this.state.valueAxisTicks)
            ? this.state.valueAxisTicks
            : [];
        const wMax = numericChartValue(this.state.valueAxisMax);
        if (wTicks.length >= 2 && Number.isFinite(wMax) && wMax > 0) {
            const wStep =
                wTicks.length >= 2 ? wTicks[1] - wTicks[0] : wMax;
            return { max: wMax, ticks: wTicks, step: wStep };
        }
        return computeNiceValueAxisScale(dataMaxFromSeries(this.state.series));
    }

    async applySeriesLabelNames(sSeries) {
        const wNames = await this.loadSeriesLabelNames();
        return applySeriesNames(sSeries, wNames);
    }

    async loadSeriesFromRangeAttributes() {
        const wCtx = this.rangeReadContext();
        const wResolveOpts = {
            hostRef: wCtx.hostRef,
            hostSheet: wCtx.hostSheet,
            defaultSheet: wCtx.defaultSheet,
        };
        const wLabelRef = await SkCellClass.resolvePropertyRangeRef(
            this.m_Cell,
            "chartData",
            wResolveOpts
        );
        const wValueRef = await SkCellClass.resolvePropertyRangeRef(
            this.m_Cell,
            "DataRange",
            wResolveOpts
        );

        if (!wLabelRef && !wValueRef) {
            return false;
        }

        try {
            if (
                wLabelRef &&
                wValueRef &&
                !this.isCombinedRangeRef(wLabelRef) &&
                !this.isCombinedRangeRef(wValueRef)
            ) {
                const wLabelMatrix = await this.readRangeMatrixIfValid(wLabelRef);
                const wValueMatrix = await this.readRangeMatrixIfValid(wValueRef);
                const wSeries = await this.applySeriesLabelNames(
                    lineSeriesFromSplitColumns(wLabelMatrix, wValueMatrix)
                );
                if (wSeries.length > 0) {
                    return this.commitSeriesState(wSeries);
                }
            }

            // Labels column + multi-column values (e.g. chartData=A15:A21, DataRange=B15:D21).
            if (
                wLabelRef &&
                wValueRef &&
                !this.isCombinedRangeRef(wLabelRef) &&
                this.isCombinedRangeRef(wValueRef)
            ) {
                const wLabelMatrix = await this.readRangeMatrixIfValid(wLabelRef);
                const wValueMatrix = await this.readRangeMatrixIfValid(wValueRef);
                const wSeries = await this.applySeriesLabelNames(
                    lineSeriesFromSplitLabelsAndValueColumns(
                        wLabelMatrix,
                        wValueMatrix
                    )
                );
                if (wSeries.length > 0) {
                    return this.commitSeriesState(wSeries);
                }
            }

            // Series header row + value block (e.g. chartData=C4:D4, DataRange=C5:D7, labels in B).
            if (
                wLabelRef &&
                wValueRef &&
                this.isCombinedRangeRef(wLabelRef) &&
                this.isCombinedRangeRef(wValueRef)
            ) {
                const wLabelMatrix = await this.readRangeMatrixIfValid(wLabelRef);
                const wValueMatrix = await this.readRangeMatrixIfValid(wValueRef);
                if (
                    isSingleHeaderRowMatrix(wLabelMatrix) &&
                    Array.isArray(wValueMatrix) &&
                    wValueMatrix.length > 0 &&
                    wLabelMatrix[0].length ===
                        Math.max(
                            ...wValueMatrix.map((row) =>
                                Array.isArray(row) ? row.length : 0
                            )
                        )
                ) {
                    const wCategoryRef = inferCategoryRangeRefFromValueRef(wValueRef);
                    const wCategoryMatrix = wCategoryRef
                        ? await this.readRangeMatrixIfValid(wCategoryRef)
                        : null;
                    const wSeries = lineSeriesFromHeaderRowAndValueMatrix(
                        wLabelMatrix[0],
                        wValueMatrix,
                        wCategoryMatrix
                    );
                    if (wSeries.length > 0) {
                        return this.commitSeriesState(wSeries);
                    }
                }
            }

            for (const wRef of [wValueRef, wLabelRef]) {
                if (!wRef || !this.isCombinedRangeRef(wRef)) {
                    continue;
                }
                const wMatrix = await this.readRangeMatrixIfValid(wRef);
                const wSeries = await this.applySeriesLabelNames(
                    lineSeriesFromRangeMatrix(wMatrix)
                );
                if (wSeries.length > 0) {
                    return this.commitSeriesState(wSeries);
                }
            }

            if (wValueRef && !this.isCombinedRangeRef(wValueRef)) {
                const wMatrix = await this.readRangeMatrixIfValid(wValueRef);
                const wSeries = await this.applySeriesLabelNames(
                    lineSeriesFromRangeMatrix(wMatrix)
                );
                if (wSeries.length > 0) {
                    return this.commitSeriesState(wSeries);
                }
            }

            // chartData only: combined A:B or single-column numeric range.
            if (wLabelRef && !wValueRef) {
                const wMatrix = await this.readRangeMatrixIfValid(wLabelRef);
                const wSeries = await this.applySeriesLabelNames(
                    lineSeriesFromRangeMatrix(wMatrix)
                );
                if (wSeries.length > 0) {
                    return this.commitSeriesState(wSeries);
                }
            }
        } catch (error) {
            console.error("LineChart loadSeriesFromRangeAttributes failed:", error);
        }
        return false;
    }

    /** Normalize enum wire (trim + lowercase) for chartType / barDirection. */
    normalizeChartEnum(sRaw) {
        return String(sRaw ?? "").trim().toLowerCase();
    }

    /** chartType from JsonView literal, cached eval, or React state. */
    resolveChartType() {
        const wRaw = this.normalizeChartEnum(
            this.readPropertyCachedOrLiteral(
                "chartType",
                this.m_ChartType || this.state.type
            )
        );
        if (wRaw === "line" || wRaw === "bar" || wRaw === "area") {
            return wRaw;
        }
        return this.state.type;
    }

    /** barDirection from JsonView literal, cached eval, or React state. */
    resolveBarDirection() {
        const wRaw = this.normalizeChartEnum(
            this.readPropertyCachedOrLiteral(
                "barDirection",
                this.m_BarDirection || this.state.barDirection
            )
        );
        if (wRaw === "horizontal" || wRaw === "vertical") {
            return wRaw;
        }
        return this.state.barDirection;
    }

    async loadChartLayoutFromCell() {
        const wChartType = this.normalizeChartEnum(
            await this.readPropertyValue("chartType", "")
        );
        const wBarDirection = this.normalizeChartEnum(
            await this.readPropertyValue("barDirection", "")
        );
        const wPatch = {};
        if (wChartType === "line" || wChartType === "bar" || wChartType === "area") {
            wPatch.type = wChartType;
            this.m_ChartType = wChartType;
        }
        if (wBarDirection === "horizontal" || wBarDirection === "vertical") {
            wPatch.barDirection = wBarDirection;
            this.m_BarDirection = wBarDirection;
        }
        if (Object.keys(wPatch).length === 0) {
            return;
        }
        await new Promise((resolve) => this.setState(wPatch, resolve));
    }

    /** Horizontal layout only when chartType is bar and barDirection is horizontal. */
    isHorizontalBar() {
        return this.resolveChartType() === "bar" && this.resolveBarDirection() === "horizontal";
    }

    /** Same row count for every series — avoids vertical drift between series. */
    horizontalCategoryCount() {
        const { series } = this.state;
        if (!Array.isArray(series) || series.length === 0) {
            return 0;
        }
        return Math.max(...series.map((s) => (Array.isArray(s.data) ? s.data.length : 0)));
    }

    /** Left gutter for vertical value-axis tick labels (currency, thousands, etc.). */
    measureValueAxisLabelPad(ctx, sTickLabels, sSeries, sUi = null) {
        const wUi = sUi ?? this._chartUi;
        const wLabelGap = wUi?.valueAxisLabelGap ?? LINE_VALUE_AXIS_LABEL_GAP;
        const wLabels = Array.isArray(sTickLabels) ? sTickLabels.filter((l) => l != null) : [];
        if (wLabels.length === 0 && Array.isArray(sSeries) && sSeries.length > 0) {
            const wScale = computeNiceValueAxisScale(dataMaxFromSeries(sSeries));
            for (const wValue of wScale.ticks) {
                wLabels.push(String(wValue));
            }
        }
        let wMax = 0;
        for (const wLabel of wLabels) {
            const wText = String(wLabel);
            if (ctx != null) {
                ctx.font = wUi?.axisFont ?? "11px Roboto";
                wMax = Math.max(wMax, ctx.measureText(wText).width);
            } else {
                const wCharPx = (wUi?.axisFontSize ?? 11) * 0.64;
                wMax = Math.max(wMax, wText.length * wCharPx);
            }
        }
        return Math.max(
            chartPx(LINE_SIDE_PAD, wUi?.scale ?? 1),
            Math.ceil(wMax) + wLabelGap
        );
    }

    /** Bottom band for Excel-style slanted category labels on the X axis. */
    measureSlantedXLabelBand(ctx, sSeries, sUi = null) {
        const wUi = sUi ?? this._chartUi;
        const wBandMin = wUi?.xLabelBandMin ?? LINE_X_LABEL_BAND_MIN;
        const wFirst = Array.isArray(sSeries) && sSeries.length > 0 ? sSeries[0] : null;
        const wData = Array.isArray(wFirst?.data) ? wFirst.data : [];
        if (wData.length === 0) {
            return wBandMin;
        }
        const wFontSize = wUi?.axisFontSize ?? 11;
        let wMaxWidth = 0;
        if (ctx != null) {
            ctx.font = wUi?.axisFont ?? "11px Roboto";
            for (const wPoint of wData) {
                const wLabel = wPoint?.label != null ? String(wPoint.label) : "";
                wMaxWidth = Math.max(wMaxWidth, ctx.measureText(wLabel).width);
            }
        } else {
            for (const wPoint of wData) {
                const wLabel = wPoint?.label != null ? String(wPoint.label) : "";
                wMaxWidth = Math.max(wMaxWidth, wLabel.length * wFontSize * 0.64);
            }
        }
        const wSlantHeight = Math.ceil(
            wMaxWidth * Math.sin(LINE_X_LABEL_SLANT_RAD) +
                wFontSize * Math.cos(LINE_X_LABEL_SLANT_RAD) +
                chartPx(8, wUi?.scale ?? 1)
        );
        return Math.max(wBandMin, wSlantHeight);
    }

    measureCategoryLabelPad(ctx, sSeries, sCanvasWidth = 0) {
        const wFirst = Array.isArray(sSeries) && sSeries.length > 0 ? sSeries[0] : null;
        const wData = Array.isArray(wFirst?.data) ? wFirst.data : [];
        if (wData.length === 0) {
            return HBAR_CATEGORY_PAD_MIN;
        }
        ctx.font = "11px Roboto";
        let wMax = 0;
        for (const wPoint of wData) {
            wMax = Math.max(
                wMax,
                ctx.measureText(truncateCategoryLabel(wPoint.label)).width
            );
        }
        const wPad = Math.min(
            HBAR_CATEGORY_PAD_MAX,
            Math.max(HBAR_CATEGORY_PAD_MIN, Math.ceil(wMax) + 12)
        );
        const wWidth = Number(sCanvasWidth);
        if (Number.isFinite(wWidth) && wWidth > 0) {
            return Math.min(wPad, Math.max(HBAR_CATEGORY_PAD_MIN, Math.floor(wWidth * 0.38)));
        }
        return wPad;
    }

    async refreshFromCell() {
        await this.loadSeriesFromRangeAttributes();
        await this.loadChartLayoutFromCell();
        await this.syncTitleFromCell();
        await this.rebuildValueAxisLabels();
    }

    syncChartUi(sWidth, sHeight) {
        this._chartUi = buildLineChartUi(sWidth, sHeight);
        return this._chartUi;
    }

    getTitleBand() {
        const wUi = this._chartUi;
        const wHasTitle = this.readTitleFromCell().trim() !== "";
        if (wUi) {
            return wHasTitle ? wUi.titleBandTitle : wUi.titleBandNoTitle;
        }
        return wHasTitle
            ? LINE_CHART_FRAME_PAD + 22
            : LINE_CHART_FRAME_PAD + 14;
    }

    getPlotLayout(width, height, sCtx = null) {
        const wUi = this.syncChartUi(width, height);
        const wHorizontal = this.isHorizontalBar();
        const wTitleBand = this.getTitleBand();
        const wLegendBand = this.state.options.showLegend ? wUi.legendBand : 0;

        if (wHorizontal) {
            const wCategoryPad =
                sCtx != null
                    ? this.measureCategoryLabelPad(sCtx, this.state.series, width)
                    : HBAR_CATEGORY_PAD_MIN;
            const wLegendTop = wTitleBand;
            const wValueAxisTop =
                wLegendTop + wLegendBand + (wLegendBand > 0 ? HBAR_LEGEND_AXIS_GAP : 0);
            const wPlotTop = wValueAxisTop + HBAR_VALUE_AXIS_BAND;
            const wChartHeight = Math.max(0, height - wPlotTop - wUi.bottomMargin);
            return {
                plotLeft: wCategoryPad,
                plotTop: wPlotTop,
                chartWidth: Math.max(0, width - wCategoryPad - HBAR_RIGHT_PAD),
                chartHeight: wChartHeight,
                legendBand: wLegendBand,
                legendBandTop: wLegendTop,
                headerBand: wTitleBand,
                valueAxisTop: wValueAxisTop,
                valueAxisBand: HBAR_VALUE_AXIS_BAND,
                xLabelY: 0,
                isHorizontal: true,
                ui: wUi,
            };
        }

        const wPlotTop = wTitleBand + wUi.topGap;
        const wXLabelBand =
            sCtx != null
                ? this.measureSlantedXLabelBand(sCtx, this.state.series, wUi)
                : wUi.xLabelBandMin;
        const wBottomStack =
            wXLabelBand + wLegendBand + wUi.bottomMargin + wUi.framePad;
        const wChartHeight = Math.max(0, height - wPlotTop - wBottomStack);
        const wLegendBandTop =
            height - wLegendBand - wUi.bottomMargin - wUi.framePad;
        const wValueAxisPad = this.measureValueAxisLabelPad(
            sCtx,
            this.state.valueAxisTickLabels,
            this.state.series,
            wUi
        );
        const wPlotLeft = wUi.framePad + wValueAxisPad;
        return {
            plotLeft: wPlotLeft,
            plotTop: wPlotTop,
            chartWidth: Math.max(
                0,
                width - wPlotLeft - wUi.rightPad - wUi.framePad
            ),
            chartHeight: wChartHeight,
            legendBand: wLegendBand,
            legendBandTop: wLegendBandTop,
            headerBand: wTitleBand,
            valueAxisBand: 0,
            xLabelY: wPlotTop + wChartHeight + wUi.xLabelAnchorGap,
            xLabelBand: wXLabelBand,
            isHorizontal: false,
            ui: wUi,
        };
    }

    drawTitle(ctx, width) {
        const wTitle = this.readTitleFromCell().trim();
        if (!wTitle) {
            return 0;
        }

        const wCell = this.m_Cell || {};
        const wUi = this._chartUi ?? buildLineChartUi(width, LINE_CHART_REF_H);
        const wFontSize = wUi.titleFontSize;
        let wFontName = "Roboto";
        let wFontWeight = "bold";
        let wFontStyle = "";
        if (wCell.hasOwnProperty("f_f_n")) {
            wFontName = wCell.f_f_n;
        }
        if (wCell.hasOwnProperty("f_we")) {
            wFontWeight = GetFontWeight(wCell.f_we) || "bold";
        }
        if (wCell.hasOwnProperty("f_st")) {
            wFontStyle = GetFontStyle(wCell.f_st);
        }
        ctx.fillStyle = wCell.f_c || "#333333";
        ctx.font = `${wFontStyle} ${wFontWeight} ${wFontSize}px ${buildCanvasFontFamily(wFontName)}`.trim();
        ctx.textBaseline = "top";
        if (this.isHorizontalBar()) {
            ctx.textAlign = "left";
            ctx.fillText(wTitle, 8, 6);
        } else {
            ctx.textAlign = "center";
            ctx.fillText(wTitle, width / 2, wUi.titleYOffset);
        }
        return this.getTitleBand();
    }

    componentDidMount() {
        this.setupEventListeners();
        void this.refreshFromCell().then(() => this.updateCanvas());

        const canvas = this.canvasRef.current;
        if (canvas) {
            canvas.addEventListener('mousemove', this.handleMouseMove);
            canvas.addEventListener('click', this.handleClick);
            canvas.addEventListener('mouseout', this.handleMouseOut);
        }
    }

    componentDidUpdate(prevProps) {
        this.m_SpInterface = this.props.SpInterface;
        const wAttrsChanged =
            this.cellAttributesDigest(this.props.Cell) !==
            this.cellAttributesDigest(prevProps.Cell);
        const wDataTick = this.props.Cell?.c_foMeta?.dataTick;
        const wPrevDataTick = prevProps.Cell?.c_foMeta?.dataTick;
        const wDataTickChanged = wDataTick !== wPrevDataTick;
        const wDisplayTick = this.props.Cell?.c_foMeta?.displayTick;
        const wPrevDisplayTick = prevProps.Cell?.c_foMeta?.displayTick;
        const wDisplayTickChanged = wDisplayTick !== wPrevDisplayTick;
        if (wAttrsChanged || wDataTickChanged || wDisplayTickChanged) {
            this.m_Cell = this.props.Cell;
            void this.refreshFromCell().then(() => this.updateCanvas());
            return;
        }
        this.m_Cell = this.props.Cell;
        this.updateCanvas();
    }

    componentWillUnmount() {
        this.removeEventListeners();

        const canvas = this.canvasRef.current;
        if (canvas) {
            canvas.removeEventListener('mousemove', this.handleMouseMove);
            canvas.removeEventListener('click', this.handleClick);
            canvas.removeEventListener('mouseout', this.handleMouseOut);
        }
    }

    setupEventListeners() {
        if (this.canvasRef.current) {
            this.canvasRef.current.onmousemove = this.handleMouseMove;
            this.canvasRef.current.onclick = this.handleClick;
            this.canvasRef.current.onmouseout = this.handleMouseOut;
        }
    }

    removeEventListeners() {
        if (this.canvasRef.current) {
            this.canvasRef.current.onmousemove = null;
            this.canvasRef.current.onclick = null;
            this.canvasRef.current.onmouseout = null;
        }
    }

    findItemAtPosition(x, y) {
        const canvas = this.canvasRef.current;
        if (!canvas) {
            return null;
        }
        const width = canvas.offsetWidth;
        const height = canvas.offsetHeight;
        const { series } = this.state;
        const wType = this.resolveChartType();
        const wLayout = this.getPlotLayout(width, height);
        const {
            plotLeft,
            plotTop,
            chartWidth,
            chartHeight,
            isHorizontal,
        } = wLayout;
        const wScale = this.resolveValueAxisScale();
        const maxValue = wScale.max;
        if (!series.length || !series[0]?.data?.length || maxValue <= 0) {
            return null;
        }

        if (isHorizontal) {
            const wCategoryCount = this.horizontalCategoryCount();

            for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex++) {
                const serie = series[seriesIndex];
                for (let pointIndex = 0; pointIndex < wCategoryCount; pointIndex++) {
                    const wPoint = serie.data?.[pointIndex];
                    if (!wPoint) {
                        continue;
                    }
                    const wSlot = horizontalBarSlotMetrics(
                        wCategoryCount,
                        series.length,
                        this.state.options.barWidth,
                        chartHeight,
                        plotTop,
                        pointIndex,
                        seriesIndex
                    );
                    const barWidth =
                        (numericChartValue(wPoint.value) / maxValue) * chartWidth;
                    if (barWidth <= 0) {
                        continue;
                    }

                    if (
                        x >= plotLeft &&
                        x <= plotLeft + barWidth &&
                        y >= wSlot.barY &&
                        y <= wSlot.barY + wSlot.barHeight
                    ) {
                        return { seriesIndex, pointIndex };
                    }
                }
            }
            return null;
        }

        if (wType === "line" || wType === "area") {
            // Much wider hit area for a better user experience
            const hitRadius = 20;

            for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex++) {
                const serie = series[seriesIndex];
                const points = seriesPointCoords(
                    serie,
                    plotLeft,
                    plotTop,
                    chartWidth,
                    chartHeight,
                    maxValue
                );

                // Find the point closest to the mouse
                let closestPoint = null;
                let minDistance = Infinity;

                points.forEach(point => {
                    const distance = Math.sqrt(
                        Math.pow(x - point.x, 2) + 
                        Math.pow(y - point.y, 2)
                    );
                    
                    if (distance < minDistance) {
                        minDistance = distance;
                        closestPoint = point;
                    }
                });

                // If we are close enough to a point, select it
                if (closestPoint && minDistance <= hitRadius) {
                    return {
                        seriesIndex,
                        pointIndex: closestPoint.index
                    };
                }
            }
        } else {
            // Existing code for bars
            const groupWidth = chartWidth / series[0].data.length;
            const singleBarWidth = (groupWidth * this.state.options.barWidth) / series.length;

            for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex++) {
                const serie = series[seriesIndex];
                
                for (let pointIndex = 0; pointIndex < serie.data.length; pointIndex++) {
                    const groupX = plotLeft + (pointIndex * groupWidth);
                    const barX = groupX + (seriesIndex * singleBarWidth) + 
                               (groupWidth * (1 - this.state.options.barWidth) / 2);
                    
                    const value = numericChartValue(serie.data[pointIndex].value);
                    const barHeight = (value / maxValue) * chartHeight;
                    const barY = plotTop + chartHeight - barHeight;

                    if (x >= barX && x <= barX + singleBarWidth &&
                        y >= barY && y <= barY + barHeight) {
                        return { seriesIndex, pointIndex };
                    }
                }
            }
        }

        return null;
    }

    handleMouseMove = (event) => {
        const canvas = this.canvasRef.current;
        if (!canvas) return;

        const { x, y } = SkCellClass.canvasLogicalPointFromCanvas(canvas, event);
        const hoveredPoint = this.findItemAtPosition(x, y);
        
        // Update only when the hovered point changes
        if (JSON.stringify(hoveredPoint) !== JSON.stringify(this.state.hoveredPoint)) {
            this.setState({ hoveredPoint }, () => this.updateCanvas());
        }
    }

    handleClick = (event) => {
        event.stopPropagation();
        const canvas = this.canvasRef.current;
        if (!canvas) return;

        const { x, y } = SkCellClass.canvasLogicalPointFromCanvas(canvas, event);
        const clickedPoint = this.findItemAtPosition(x, y);
        
        this.setState({ 
            selectedPoint: JSON.stringify(clickedPoint) === JSON.stringify(this.state.selectedPoint) 
                ? null 
                : clickedPoint 
        }, () => this.updateCanvas());
    }

    handleMouseOut = () => {
        this.setState({ hoveredPoint: null }, () => this.updateCanvas());
    }

    drawChart(ctx, width, height) {
        const { series, options } = this.state;
        const wType = this.resolveChartType();
        const wLayout = this.getPlotLayout(width, height, ctx);
        const {
            plotLeft,
            plotTop,
            chartWidth,
            chartHeight,
            legendBand,
            legendBandTop,
            valueAxisBand,
            xLabelY,
            isHorizontal,
        } = wLayout;

        this.drawTitle(ctx, width);

        if (!Array.isArray(series) || series.length === 0 || !series[0]?.data?.length) {
            return;
        }

        if (options.showLegend && legendBand > 0) {
            if (isHorizontal) {
                this.drawLegend(ctx, width, legendBandTop, legendBand, true, plotLeft);
            }
        }

        if (options.showGrid) {
            this.drawGrid(ctx, plotLeft, plotTop, chartWidth, chartHeight, isHorizontal);
        }

        this.drawAxes(ctx, plotLeft, plotTop, chartWidth, chartHeight, isHorizontal);

        series.forEach((serie, index) => {
            if (wType === "line") {
                this.drawLine(ctx, serie, index, plotLeft, plotTop, chartWidth, chartHeight);
            } else if (wType === "area") {
                this.drawArea(ctx, serie, index, plotLeft, plotTop, chartWidth, chartHeight);
            } else if (isHorizontal) {
                this.drawHorizontalBars(
                    ctx,
                    serie,
                    index,
                    plotLeft,
                    plotTop,
                    chartWidth,
                    chartHeight
                );
            } else {
                this.drawBars(ctx, serie, index, plotLeft, plotTop, chartWidth, chartHeight);
            }
        });

        this.drawHoverTooltip(
            ctx,
            plotLeft,
            plotTop,
            chartWidth,
            chartHeight,
            isHorizontal,
            width,
            height
        );

        this.drawLabels(
            ctx,
            plotLeft,
            plotTop,
            chartWidth,
            chartHeight,
            xLabelY,
            valueAxisBand,
            isHorizontal
        );

        if (options.showLegend && legendBand > 0 && !isHorizontal) {
            this.drawLegend(ctx, width, legendBandTop, legendBand, false, plotLeft);
        }
    }

    drawGrid(ctx, plotLeft, plotTop, chartWidth, chartHeight, sHorizontal = false) {
        ctx.strokeStyle = this.state.options.colors.grid;
        ctx.lineWidth = 0.5;
        const wScale = this.resolveValueAxisScale();
        const wTicks = wScale.ticks;

        for (let i = 0; i < wTicks.length; i++) {
            if (sHorizontal) {
                const x = valueAxisTickX(plotLeft, chartWidth, wTicks[i], wScale.max);
                ctx.beginPath();
                ctx.moveTo(x, plotTop);
                ctx.lineTo(x, plotTop + chartHeight);
                ctx.stroke();
            } else {
                const y = valueAxisTickY(plotTop, chartHeight, wTicks[i], wScale.max);
                ctx.beginPath();
                ctx.moveTo(plotLeft, y);
                ctx.lineTo(plotLeft + chartWidth, y);
                ctx.stroke();
            }
        }
    }

    drawAxes(ctx, plotLeft, plotTop, chartWidth, chartHeight, sHorizontal = false) {
        ctx.strokeStyle = this.state.options.colors.axis;
        ctx.lineWidth = 1;

        if (sHorizontal) {
            ctx.beginPath();
            ctx.moveTo(plotLeft, plotTop);
            ctx.lineTo(plotLeft, plotTop + chartHeight);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(plotLeft, plotTop);
            ctx.lineTo(plotLeft + chartWidth, plotTop);
            ctx.stroke();
            return;
        }

        ctx.beginPath();
        ctx.moveTo(plotLeft, plotTop);
        ctx.lineTo(plotLeft, plotTop + chartHeight);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(plotLeft, plotTop + chartHeight);
        ctx.lineTo(plotLeft + chartWidth, plotTop + chartHeight);
        ctx.stroke();
    }

    drawHorizontalBars(ctx, serie, seriesIndex, plotLeft, plotTop, chartWidth, chartHeight) {
        const { series, hoveredPoint, selectedPoint, options } = this.state;
        const wScale = this.resolveValueAxisScale();
        const maxValue = wScale.max;
        if (maxValue <= 0) {
            return;
        }
        const wCategoryCount = this.horizontalCategoryCount();
        if (wCategoryCount <= 0) {
            return;
        }

        for (let pointIndex = 0; pointIndex < wCategoryCount; pointIndex++) {
            const point = serie.data?.[pointIndex];
            if (!point) {
                continue;
            }
            const wSlot = horizontalBarSlotMetrics(
                wCategoryCount,
                series.length,
                options.barWidth,
                chartHeight,
                plotTop,
                pointIndex,
                seriesIndex
            );
            const isHovered =
                hoveredPoint?.seriesIndex === seriesIndex &&
                hoveredPoint?.pointIndex === pointIndex;
            const isSelected =
                selectedPoint?.seriesIndex === seriesIndex &&
                selectedPoint?.pointIndex === pointIndex;

            const barWidth = (numericChartValue(point.value) / maxValue) * chartWidth;
            if (barWidth <= 0) {
                continue;
            }
            const offset = isHovered ? 4 : isSelected ? 6 : 0;

            ctx.beginPath();
            ctx.fillStyle = serie.color;

            if (isHovered || isSelected) {
                ctx.shadowColor = "rgba(0,0,0,0.25)";
                ctx.shadowBlur = 8;
                ctx.shadowOffsetX = 1;
                ctx.shadowOffsetY = 1;
                ctx.globalAlpha = 0.85;
            }

            ctx.fillRect(plotLeft, wSlot.barY, barWidth + offset, wSlot.barHeight);

            ctx.globalAlpha = 1;
            ctx.shadowColor = "transparent";
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
        }
    }

    drawBars(ctx, serie, seriesIndex, plotLeft, plotTop, chartWidth, chartHeight) {
        const { series, hoveredPoint, selectedPoint, options } = this.state;
        const wScale = this.resolveValueAxisScale();
        const maxValue = wScale.max;
        const groupWidth = chartWidth / (serie.data.length);
        const singleBarWidth = (groupWidth * options.barWidth) / series.length;
        
        serie.data.forEach((point, pointIndex) => {
            const isHovered = hoveredPoint?.seriesIndex === seriesIndex && 
                            hoveredPoint?.pointIndex === pointIndex;
            const isSelected = selectedPoint?.seriesIndex === seriesIndex && 
                             selectedPoint?.pointIndex === pointIndex;

            const groupX = plotLeft + (pointIndex * groupWidth);
            const barX = groupX + (seriesIndex * singleBarWidth) + (groupWidth * (1 - options.barWidth) / 2);
            const height = (numericChartValue(point.value) / maxValue) * chartHeight;
            const y = plotTop + chartHeight - height;

            // "Pop-out" effect for hovered bars
            const offset = isHovered ? 5 : isSelected ? 7 : 0;
            
            ctx.beginPath();
            ctx.fillStyle = serie.color;
            
            // Add visual effects for hover
            if (isHovered || isSelected) {
                // Drop shadow
                ctx.shadowColor = 'rgba(0,0,0,0.3)';
                ctx.shadowBlur = 10;
                ctx.shadowOffsetX = 2;
                ctx.shadowOffsetY = 2;
                
                // Opacity
                ctx.globalAlpha = 0.8;
            }

            // Draw the bar with the "pop-out" effect
            ctx.fillRect(
                Math.max(barX, plotLeft + 1),
                y - offset,
                Math.min(singleBarWidth, barX + singleBarWidth - plotLeft),
                height + offset
            );

            ctx.strokeStyle = 'white';
            ctx.lineWidth = isHovered ? 2 : 1;
            ctx.strokeRect(
                Math.max(barX, plotLeft + 1),
                y - offset,
                Math.min(singleBarWidth, barX + singleBarWidth - plotLeft),
                height + offset
            );

            // Reset the effects
            ctx.globalAlpha = 1;
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
        });
    }

    drawLine(ctx, serie, seriesIndex, plotLeft, plotTop, chartWidth, chartHeight) {
        const { hoveredPoint, selectedPoint, options } = this.state;
        const wScale = this.resolveValueAxisScale();
        const maxValue = wScale.max;
        const wPoints = seriesPointCoords(
            serie,
            plotLeft,
            plotTop,
            chartWidth,
            chartHeight,
            maxValue
        );
        if (wPoints.length === 0) {
            return;
        }

        ctx.beginPath();
        ctx.strokeStyle = serie.color;
        ctx.lineWidth = options.lineWidth;

        wPoints.forEach((point, pointIndex) => {
            if (pointIndex === 0) {
                ctx.moveTo(point.x, point.y);
            } else {
                ctx.lineTo(point.x, point.y);
            }
        });

        ctx.stroke();

        this.drawLineSeriesMarkers(ctx, serie, seriesIndex, wPoints, hoveredPoint, selectedPoint, options);
    }

    drawArea(ctx, serie, seriesIndex, plotLeft, plotTop, chartWidth, chartHeight) {
        const { hoveredPoint, selectedPoint, options } = this.state;
        const wScale = this.resolveValueAxisScale();
        const maxValue = wScale.max;
        const wPoints = seriesPointCoords(
            serie,
            plotLeft,
            plotTop,
            chartWidth,
            chartHeight,
            maxValue
        );
        if (wPoints.length === 0) {
            return;
        }

        const wBaselineY = plotTop + chartHeight;

        ctx.beginPath();
        ctx.moveTo(wPoints[0].x, wBaselineY);
        wPoints.forEach((point) => {
            ctx.lineTo(point.x, point.y);
        });
        ctx.lineTo(wPoints[wPoints.length - 1].x, wBaselineY);
        ctx.closePath();
        ctx.fillStyle = serie.color;
        ctx.globalAlpha = options.areaFillOpacity != null ? options.areaFillOpacity : 0.35;
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.beginPath();
        ctx.strokeStyle = serie.color;
        ctx.lineWidth = options.lineWidth;
        wPoints.forEach((point, pointIndex) => {
            if (pointIndex === 0) {
                ctx.moveTo(point.x, point.y);
            } else {
                ctx.lineTo(point.x, point.y);
            }
        });
        ctx.stroke();

        this.drawLineSeriesMarkers(ctx, serie, seriesIndex, wPoints, hoveredPoint, selectedPoint, options);
    }

    drawLineSeriesMarkers(ctx, serie, seriesIndex, sPoints, hoveredPoint, selectedPoint, options) {
        sPoints.forEach((point) => {
            const pointIndex = point.index;
            const isHovered =
                hoveredPoint?.seriesIndex === seriesIndex &&
                hoveredPoint?.pointIndex === pointIndex;
            const isSelected =
                selectedPoint?.seriesIndex === seriesIndex &&
                selectedPoint?.pointIndex === pointIndex;

            const radius = isHovered || isSelected ? 6 : options.pointRadius || 4;

            ctx.beginPath();
            ctx.fillStyle = serie.color;
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 2;

            if (isHovered || isSelected) {
                ctx.shadowColor = 'rgba(0,0,0,0.3)';
                ctx.shadowBlur = 10;
                ctx.shadowOffsetX = 2;
                ctx.shadowOffsetY = 2;
            }

            ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
        });
    }

    /** Paint the active hover/selection tooltip above every series layer. */
    drawHoverTooltip(
        ctx,
        plotLeft,
        plotTop,
        chartWidth,
        chartHeight,
        sHorizontal = false,
        sCanvasWidth = 0,
        sCanvasHeight = 0
    ) {
        const { series, hoveredPoint, selectedPoint, options } = this.state;
        const wType = this.resolveChartType();
        const wActive = hoveredPoint || selectedPoint;
        if (!wActive || !series[wActive.seriesIndex]) {
            return;
        }

        const wSerie = series[wActive.seriesIndex];
        const wPoint = wSerie.data[wActive.pointIndex];
        if (!wPoint) {
            return;
        }

        const wScale = this.resolveValueAxisScale();
        const wMaxValue = wScale.max;
        const wLabel = `${wSerie.name}: ${this.displayChartValue(wPoint.value)}`;
        const wIsSelected =
            selectedPoint?.seriesIndex === wActive.seriesIndex &&
            selectedPoint?.pointIndex === wActive.pointIndex;
        const wCanvasW = sCanvasWidth > 0 ? sCanvasWidth : plotLeft + chartWidth;
        const wCanvasH = sCanvasHeight > 0 ? sCanvasHeight : plotTop + chartHeight;

        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.88)";
        ctx.font = "12px Roboto";

        if (wType === "line" || wType === "area") {
            const wDenom = Math.max(1, wSerie.data.length - 1);
            const wX = plotLeft + (wActive.pointIndex * chartWidth) / wDenom;
            const wY =
                plotTop +
                chartHeight *
                    (1 - numericChartValue(wPoint.value) / wMaxValue);
            const wGap = wIsSelected ? 12 : 10;
            paintCenteredTooltip(ctx, wLabel, wX, wY, wGap, wCanvasW, wCanvasH);
        } else if (sHorizontal) {
            const wCategoryCount = this.horizontalCategoryCount();
            const wSlot = horizontalBarSlotMetrics(
                wCategoryCount,
                series.length,
                options.barWidth,
                chartHeight,
                plotTop,
                wActive.pointIndex,
                wActive.seriesIndex
            );
            const wBarWidth =
                (numericChartValue(wPoint.value) / wMaxValue) * chartWidth;
            const wAnchorX = plotLeft + wBarWidth + 8;
            const wAnchorY = wSlot.barY + wSlot.barHeight / 2;
            paintLeftTooltip(ctx, wLabel, wAnchorX, wAnchorY, wCanvasW, wCanvasH);
        } else {
            const wGroupWidth = chartWidth / wSerie.data.length;
            const wSingleBarWidth =
                (wGroupWidth * options.barWidth) / series.length;
            const wGroupX = plotLeft + wActive.pointIndex * wGroupWidth;
            const wBarX =
                wGroupX +
                wActive.seriesIndex * wSingleBarWidth +
                (wGroupWidth * (1 - options.barWidth)) / 2;
            const wBarHeight =
                (numericChartValue(wPoint.value) / wMaxValue) * chartHeight;
            const wBarY = plotTop + chartHeight - wBarHeight;
            const wGap = wIsSelected ? 7 : 5;
            const wAnchorX = wBarX + wSingleBarWidth / 2;
            paintCenteredTooltip(ctx, wLabel, wAnchorX, wBarY, wGap, wCanvasW, wCanvasH);
        }

        ctx.restore();
    }

    measureHorizontalLegendWidth(ctx) {
        const { series, options } = this.state;
        if (!options.showLegend || !Array.isArray(series) || series.length === 0) {
            return 0;
        }
        ctx.font = "11px Roboto";
        let wWidth = 8;
        for (const serie of series) {
            const wLabel = serie.name != null ? String(serie.name) : "";
            wWidth += 8 + 6 + ctx.measureText(wLabel).width + 14;
        }
        return wWidth;
    }

    drawLabels(
        ctx,
        plotLeft,
        plotTop,
        chartWidth,
        chartHeight,
        xLabelY,
        valueAxisBand,
        sHorizontal = false
    ) {
        const { series, valueAxisTickLabels } = this.state;
        const firstSerie = series[0];
        if (!firstSerie?.data?.length) {
            return;
        }

        ctx.fillStyle = '#333';
        ctx.font = '11px Roboto';

        if (sHorizontal) {
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            const wAxisY = plotTop - 4;
            const wScale = this.resolveValueAxisScale();
            const wTicks = wScale.ticks;
            const wCategoryCount = this.horizontalCategoryCount();
            const wLegendReserve = this.measureHorizontalLegendWidth(ctx);
            const wTickSpan = Math.max(0, chartWidth - wLegendReserve);
            for (let i = 0; i < wTicks.length; i++) {
                const x = valueAxisTickX(
                    plotLeft,
                    chartWidth,
                    wTicks[i],
                    wScale.max,
                    wTickSpan
                );
                const wLabel =
                    Array.isArray(valueAxisTickLabels) &&
                    valueAxisTickLabels[i] != null
                        ? valueAxisTickLabels[i]
                        : String(wTicks[i]);
                ctx.fillText(wLabel, x, wAxisY);
            }

            ctx.textAlign = "right";
            ctx.textBaseline = "middle";
            const wLabelSource = firstSerie.data;
            for (let index = 0; index < wCategoryCount; index++) {
                const wPoint = wLabelSource[index];
                const wSlot = horizontalBarSlotMetrics(
                    wCategoryCount,
                    series.length,
                    this.state.options.barWidth,
                    chartHeight,
                    plotTop,
                    index,
                    0
                );
                const wLabel =
                    wPoint?.label != null && String(wPoint.label).trim() !== ""
                        ? String(wPoint.label).trim()
                        : String(index + 1);
                ctx.fillText(
                    truncateCategoryLabel(wLabel),
                    plotLeft - 8,
                    wSlot.categoryCenterY
                );
            }
            return;
        }

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const groupWidth = chartWidth / firstSerie.data.length;
        firstSerie.data.forEach((point, index) => {
            const x = plotLeft + index * groupWidth + groupWidth / 2;
            ctx.save();
            ctx.translate(x, xLabelY);
            ctx.rotate(LINE_X_LABEL_SLANT_RAD);
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            ctx.fillText(point.label, 0, 0);
            ctx.restore();
        });

        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        const wScale = this.resolveValueAxisScale();
        const wTicks = wScale.ticks;
        for (let i = 0; i < wTicks.length; i++) {
            const y = valueAxisTickY(plotTop, chartHeight, wTicks[i], wScale.max);
            const wLabel =
                Array.isArray(valueAxisTickLabels) && valueAxisTickLabels[i] != null
                    ? valueAxisTickLabels[i]
                    : String(wTicks[i]);
            ctx.fillText(wLabel, plotLeft - LINE_VALUE_AXIS_LABEL_GAP, y);
        }
    }

    drawLegend(ctx, width, legendBandTop, legendBandHeight, sTopRight = false, sPlotLeft = LINE_SIDE_PAD) {
        const { series } = this.state;
        const wLegendY = legendBandTop + legendBandHeight / 2;

        ctx.font = '11px Roboto';
        ctx.textBaseline = 'middle';

        if (sTopRight) {
            const wMarker = 8;
            const wGap = 6;
            let wRight = width - 8;
            for (let index = series.length - 1; index >= 0; index--) {
                const serie = series[index];
                const wLabel = serie.name != null ? String(serie.name) : "";
                const wTextWidth = ctx.measureText(wLabel).width;
                const wBlockWidth = wMarker + wGap + wTextWidth + 14;
                wRight -= wBlockWidth;
                const wSquareX = wRight;
                const wTextX = wSquareX + wMarker + wGap;

                ctx.fillStyle = serie.color;
                ctx.fillRect(wSquareX, wLegendY - wMarker / 2, wMarker, wMarker);

                ctx.fillStyle = '#333';
                ctx.textAlign = 'left';
                ctx.fillText(wLabel, wTextX, wLegendY);
            }
            return;
        }

        const wItemWidth =
            (width - sPlotLeft - LINE_RIGHT_PAD - LINE_CHART_FRAME_PAD) / series.length;
        const wLegendLeft = sPlotLeft;

        series.forEach((serie, index) => {
            const wCenterX = wLegendLeft + wItemWidth * index + wItemWidth / 2;
            const wLabel = serie.name != null ? String(serie.name) : "";
            const wTextWidth = ctx.measureText(wLabel).width;
            const wMarkerR = 5;
            const wGap = 6;
            const wBlockWidth = wMarkerR * 2 + wGap + wTextWidth;
            const wBlockLeft = wCenterX - wBlockWidth / 2;
            const wDotX = wBlockLeft + wMarkerR;

            ctx.beginPath();
            ctx.fillStyle = serie.color;
            ctx.arc(wDotX, wLegendY, wMarkerR, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = '#333';
            ctx.textAlign = 'left';
            ctx.fillText(wLabel, wDotX + wMarkerR + wGap, wLegendY);
        });
    }

    hasChartData() {
        const { series } = this.state;
        if (!Array.isArray(series) || series.length === 0) {
            return false;
        }
        return series.some(
            (wSerie) => Array.isArray(wSerie?.data) && wSerie.data.length > 0,
        );
    }

    paintExportInk(ctx, width, height) {
        this.drawChart(ctx, width, height);
    }

    static defaultExportState() {
        return {
            series: [],
            type: "line",
            barDirection: "vertical",
            hoveredPoint: null,
            selectedPoint: null,
            options: {
                showGrid: true,
                showPoints: true,
                showLegend: true,
                lineWidth: 2,
                pointRadius: 4,
                areaFillOpacity: 0.35,
                barWidth: 0.7,
                colors: {
                    grid: '#e0e0e0',
                    axis: '#333333'
                }
            },
            zIndex: 0,
            valueAxisWitness: { ref: "", sheet: "" },
            valueAxisTickLabels: [],
            valueAxisTicks: [],
            valueAxisMax: 0,
        };
    }

    adjustBrightness(color, percent) {
        return color; // For now we return the original color
    }

    updateCanvas() {
        const canvas = this.canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const wRatio=this.m_SpInterface.m_Ratio;
        const wWidth=canvas.offsetWidth;
        const wHeight=canvas.offsetHeight;
      
        canvas.width=wWidth*wRatio;
        canvas.height=wHeight*wRatio;
        ctx.scale(wRatio,wRatio);

        this.fillCanvasBackground(ctx, wWidth, wHeight, {
            empty: !this.hasChartData(),
        });

        // Draw the chart
        this.drawChart(ctx, wWidth, wHeight);
    }

    render() {
        const wLayout = this.CellPosSizeChart();

        this.state.zIndex = 3;
        const wIsFloating = this.m_Cell?.c_fo === true;

        const wCellStyleParent = {
            position: 'absolute',
            margin: "0px",
            padding: "0px",
            left: wLayout.X + "px",
            top: wLayout.Y + "px",
            width: wLayout.W + "px",
            height: wLayout.H + "px",
            overflow: 'hidden',
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
                        cursor: wIsFloating ? 'default' : 'pointer',
                    }}
                />
            </div>
        );
    }

    // Improve distance-to-line computation accuracy
    distanceToLine(x, y, x1, y1, x2, y2) {
        const A = x - x1;
        const B = y - y1;
        const C = x2 - x1;
        const D = y2 - y1;

        const dot = A * C + B * D;
        const len_sq = C * C + D * D;
        const param = len_sq !== 0 ? dot / len_sq : -1;

        let xx, yy;

        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }

        const dx = x - xx;
        const dy = y - yy;
        return Math.sqrt(dx * dx + dy * dy);
    }
}

SkCellClass.installPdfExportStatics(SkCellClassLineChart, {
    initialState: () => SkCellClassLineChart.defaultExportState(),
    extra: () => ({
        m_Data: {},
        m_Title: "",
        m_ChartType: "",
        m_BarDirection: "",
        m_valueFormatCache: new Map(),
    }),
    hydrate: async (painter) => {
        await painter.refreshFromCell();
    },
    exportBackgroundOptions: (painter) => ({
        empty: !painter.hasChartData(),
    }),
});

export default SkCellClassLineChart; 