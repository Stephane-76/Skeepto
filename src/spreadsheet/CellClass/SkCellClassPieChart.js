//=============================================================================
// SkCellClassPieChart
// Component to draw pie charts with Canvas
//=============================================================================
import React from "react";
import SkCellClass from "./SkCellClass.js";
import { GetFontStyle, GetFontWeight, buildCanvasFontFamily } from "../../utility/SkUtility.js";

function Render(sCell, sSpInterface) {
    return (<SkCellClassPieChart Cell={sCell} key={sCell.c_k} SpInterface={sSpInterface}></SkCellClassPieChart>)
}

// Excel Office chart palette (order matches typical theme: teal, orange, green, …).
const PIE_DEFAULT_COLORS = [
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

const PIE_LEGEND_BAND = 48;
const PIE_LEGEND_FONT = '11px "Segoe UI", Roboto, Arial, sans-serif';
const PIE_SLICE_EXPLODE_HOVER = 8;
const PIE_SLICE_EXPLODE_SELECTED = 18;

/** Clockwise angle from the top of the pie, in [0, 2π). */
function piePointerAngleFromDxDy(sDx, sDy) {
    let wAngle = Math.atan2(sDy, sDx) + Math.PI / 2;
    if (wAngle < 0) {
        wAngle += 2 * Math.PI;
    }
    return wAngle;
}

/** Map canvas arc start (-π/2 at top) into the same [0, 2π) top-clockwise space. */
function pieSegmentStartTopClockwise(sCanvasStartAngle) {
    let wAngle = sCanvasStartAngle + Math.PI / 2;
    if (wAngle < 0) {
        wAngle += 2 * Math.PI;
    }
    return wAngle;
}

function isPointerAngleInPieSegment(sPointerAngle, sCanvasStartAngle, sSegmentAngle) {
    const wStart = pieSegmentStartTopClockwise(sCanvasStartAngle);
    const wEnd = wStart + sSegmentAngle;
    if (wEnd <= 2 * Math.PI) {
        return sPointerAngle >= wStart && sPointerAngle <= wEnd;
    }
    const wWrapEnd = wEnd - 2 * Math.PI;
    return sPointerAngle >= wStart || sPointerAngle <= wWrapEnd;
}

/** Coerce pie segment value — prefer WASM calculable scalar; display text is fallback. */
function pieNumericFromCell(sRaw) {
    return SkCellClass.numericFromScalar(sRaw);
}

/** Zip single-column label and value ranges row by row. */
function pieDataFromSplitColumns(sLabelColumn, sValueColumn) {
    const wLabelRows = Array.isArray(sLabelColumn) ? sLabelColumn : [];
    const wValueRows = Array.isArray(sValueColumn) ? sValueColumn : [];
    const wLen = Math.min(wLabelRows.length, wValueRows.length);
    const wSegments = [];
    for (let wIdx = 0; wIdx < wLen; wIdx++) {
        const wLabelRow = wLabelRows[wIdx];
        const wValueRow = wValueRows[wIdx];
        const wLabel = Array.isArray(wLabelRow) ? wLabelRow[0] : wLabelRow;
        const wRawValue = Array.isArray(wValueRow) ? wValueRow[0] : wValueRow;
        const wRawText = wRawValue != null ? String(wRawValue).trim() : "";
        if (wRawText === "") {
            continue;
        }
        const wValue = pieNumericFromCell(wRawText);
        if (!Number.isFinite(wValue)) {
            continue;
        }
        wSegments.push({
            label: wLabel != null ? String(wLabel).trim() : "",
            value: wValue,
            color: PIE_DEFAULT_COLORS[wSegments.length % PIE_DEFAULT_COLORS.length],
        });
    }
    return wSegments;
}

/** Build pie segments from a range matrix (col 0 = label, col 1 = value). */
function pieDataFromRangeMatrix(sMatrix) {
    if (!Array.isArray(sMatrix) || sMatrix.length === 0) {
        return [];
    }
    const wColCount = Math.max(...sMatrix.map((row) => (Array.isArray(row) ? row.length : 0)));
    const wSegments = [];
    if (wColCount >= 2) {
        for (const wRow of sMatrix) {
            if (!Array.isArray(wRow) || wRow.length < 2) {
                continue;
            }
            const wValue = pieNumericFromCell(wRow[1]);
            if (!Number.isFinite(wValue)) {
                continue;
            }
            const wLabel = wRow[0] != null ? String(wRow[0]).trim() : "";
            wSegments.push({
                label: wLabel,
                value: wValue,
                color: PIE_DEFAULT_COLORS[wSegments.length % PIE_DEFAULT_COLORS.length],
            });
        }
        return wSegments;
    }
    for (let wIdx = 0; wIdx < sMatrix.length; wIdx++) {
        const wRow = sMatrix[wIdx];
        const wRaw = Array.isArray(wRow) ? wRow[0] : wRow;
        const wValue = pieNumericFromCell(wRaw);
        if (!Number.isFinite(wValue)) {
            continue;
        }
        wSegments.push({
            label: String(wIdx + 1),
            value: wValue,
            color: PIE_DEFAULT_COLORS[wSegments.length % PIE_DEFAULT_COLORS.length],
        });
    }
    return wSegments;
}

class SkCellClassPieChart extends SkCellClass {
    constructor(props) {
        super(props)
        this.canvasRef = React.createRef();
        this.state = {
            data: [],
            hoveredSegment: null,
            selectedSegment: null,
            zIndex: 0
        };
        this.m_Data = {};
        this.m_Title = "";
        this.m_SpInterface = props.SpInterface;
    }

    SetDirectProperty(sName, sValue) {
        this.m_Data[sName] = sValue;
    }

    GetDirectProperty(sName) {
        return this.m_Data[sName];
    }

    static ClassName() { return ("SkCellClassPieChart") }

    static cellClassCapabilities() {
        return { ...SkCellClass.cellClassCapabilities(), floatingObject: true };
    }

    // SVG icon representing a colored pie chart
    static Icon() {
        return (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%">
                <circle cx="12" cy="12" r="9" fill="#4caf50"
                        stroke="currentColor" strokeWidth="1"/>
                <path d="M12 12 L12 3 A9 9 0 0 1 20.8 14 Z"
                      fill="#2196f3" stroke="currentColor" strokeWidth="1"/>
                <path d="M12 12 L20.8 14 A9 9 0 0 1 15 20.5 Z"
                      fill="#ffc107" stroke="currentColor" strokeWidth="1"/>
                <path d="M12 12 L15 20.5 A9 9 0 0 1 6 19.5 Z"
                      fill="#e63946" stroke="currentColor" strokeWidth="1"/>
            </svg>
        );
    }

    static registerClassAttribute(sUISpreadSheet) {
        super.registerClassAttribute(sUISpreadSheet, "PieChart", "Javascript", Render);
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
        if (!sRangeRef || this.isUnsupportedR1C1RangeRef(sRangeRef)) {
            if (sRangeRef && this.isUnsupportedR1C1RangeRef(sRangeRef)) {
                console.warn(
                    "PieChart: R1C1 range refs are not supported yet; use A1 (e.g. =A15:B17)."
                );
            }
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

    applyPieSegments(sSegments) {
        return new Promise((resolve) => {
            this.setState({ data: sSegments }, () => {
                this.updateCanvas();
                resolve(true);
            });
        });
    }

    async loadPieDataFromRangeAttributes() {
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
            // Split mode: chartData = labels column, DataRange = values column.
            if (
                wLabelRef &&
                wValueRef &&
                !this.isCombinedRangeRef(wLabelRef) &&
                !this.isCombinedRangeRef(wValueRef)
            ) {
                const wLabelMatrix = await this.readRangeMatrixIfValid(wLabelRef);
                const wValueMatrix = await this.readRangeMatrixIfValid(wValueRef);
                const wSegments = pieDataFromSplitColumns(wLabelMatrix, wValueMatrix);
                if (wSegments.length > 0) {
                    return this.applyPieSegments(wSegments);
                }
            }

            // Combined A:B range — prefer DataRange, then chartData.
            for (const wRef of [wValueRef, wLabelRef]) {
                if (!wRef || !this.isCombinedRangeRef(wRef)) {
                    continue;
                }
                const wMatrix = await this.readRangeMatrixIfValid(wRef);
                const wSegments = pieDataFromRangeMatrix(wMatrix);
                if (wSegments.length > 0) {
                    return this.applyPieSegments(wSegments);
                }
            }

            // Values only in DataRange.
            if (wValueRef && !this.isCombinedRangeRef(wValueRef)) {
                const wMatrix = await this.readRangeMatrixIfValid(wValueRef);
                const wSegments = pieDataFromRangeMatrix(wMatrix);
                if (wSegments.length > 0) {
                    return this.applyPieSegments(wSegments);
                }
            }

            if (wLabelRef && !wValueRef) {
                const wMatrix = await this.readRangeMatrixIfValid(wLabelRef);
                const wSegments = pieDataFromRangeMatrix(wMatrix);
                if (wSegments.length > 0) {
                    return this.applyPieSegments(wSegments);
                }
            }
        } catch (error) {
            console.error("PieChart loadPieDataFromRangeAttributes failed:", error);
        }
        return false;
    }

    async refreshFromCell() {
        await this.loadPieDataFromRangeAttributes();
        await this.syncTitleFromCell();
        this.updateCanvas();
    }

    componentDidMount() {
        void this.refreshFromCell();

        // Add event listeners
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
        this.m_Cell = this.props.Cell;
        if (wAttrsChanged || wDataTickChanged || wDisplayTickChanged) {
            void this.refreshFromCell();
        } else {
            this.updateCanvas();
        }
    }

    componentWillUnmount() {
        // Clean up event listeners
        const canvas = this.canvasRef.current;
        if (canvas) {
            canvas.removeEventListener('mousemove', this.handleMouseMove);
            canvas.removeEventListener('click', this.handleClick);
            canvas.removeEventListener('mouseout', this.handleMouseOut);
        }
    }

    getTitleBand() {
        return this.readTitleFromCell().trim() ? 28 : 0;
    }

    /** Pie center/radius — plot area above the bottom legend band. */
    piePlotMetrics(sWidth, sHeight, sTitleBand) {
        const wPlotHeight = Math.max(0, sHeight - sTitleBand - PIE_LEGEND_BAND);
        return {
            centerX: sWidth / 2,
            centerY: sTitleBand + wPlotHeight / 2,
            radius: Math.min(sWidth, wPlotHeight) / 3,
        };
    }

    findSegmentAtPosition(x, y) {
        const canvas = this.canvasRef.current;
        if (!canvas) {
            return null;
        }
        const wWidth = canvas.offsetWidth;
        const wHeight = canvas.offsetHeight;
        const wTitleBand = this.getTitleBand();
        const { centerX, centerY, radius: baseRadius } = this.piePlotMetrics(
            wWidth,
            wHeight,
            wTitleBand
        );

        const { data, hoveredSegment, selectedSegment } = this.state;
        const n = (v) => {
            const wNum = Number(v);
            return Number.isFinite(wNum) ? wNum : 0;
        };
        const total = data.reduce((sum, item) => sum + n(item.value), 0);
        if (total <= 0) {
            return null;
        }

        let startAngle = -Math.PI / 2;
        const wSegments = data.map((item, i) => {
            const wSegmentAngle = (n(item.value) / total) * 2 * Math.PI;
            const wSeg = { index: i, startAngle, segmentAngle: wSegmentAngle };
            startAngle += wSegmentAngle;
            return wSeg;
        });

        const wSegmentPriority = (i) =>
            i === selectedSegment ? 2 : i === hoveredSegment ? 1 : 0;
        const wHitOrder = [...wSegments].sort(
            (a, b) => wSegmentPriority(b.index) - wSegmentPriority(a.index)
        );

        for (const wSeg of wHitOrder) {
            const wIndex = wSeg.index;
            const isHovered = wIndex === hoveredSegment;
            const isSelected = wIndex === selectedSegment;
            const wOffset = isSelected
                ? PIE_SLICE_EXPLODE_SELECTED
                : isHovered
                  ? PIE_SLICE_EXPLODE_HOVER
                  : 0;

            const wMidAngle = wSeg.startAngle + wSeg.segmentAngle / 2;
            const wCx = centerX + Math.cos(wMidAngle) * wOffset;
            const wCy = centerY + Math.sin(wMidAngle) * wOffset;

            const wDx = x - wCx;
            const wDy = y - wCy;
            const wDistance = Math.sqrt(wDx * wDx + wDy * wDy);
            if (wDistance > baseRadius) {
                continue;
            }

            const wPointerAngle = piePointerAngleFromDxDy(wDx, wDy);
            if (
                isPointerAngleInPieSegment(
                    wPointerAngle,
                    wSeg.startAngle,
                    wSeg.segmentAngle
                )
            ) {
                return wIndex;
            }
        }

        return null;
    }

    handleMouseMove = (event) => {
        const { x, y } = SkCellClass.canvasLogicalPointFromCanvas(
            this.canvasRef.current,
            event
        );
        const hoveredSegment = this.findSegmentAtPosition(x, y);
        
        if (hoveredSegment !== this.state.hoveredSegment) {
            this.setState({ hoveredSegment }, () => this.updateCanvas());
        }
    }

    handleClick = (event) => {
        event.stopPropagation();
        const { x, y } = SkCellClass.canvasLogicalPointFromCanvas(
            this.canvasRef.current,
            event
        );
        const clickedSegment = this.findSegmentAtPosition(x, y);

        this.setState(
            {
                selectedSegment:
                    clickedSegment === this.state.selectedSegment ? null : clickedSegment,
                hoveredSegment: clickedSegment,
            },
            () => this.updateCanvas()
        );
    }

    handleMouseOut = () => {
        this.setState({ hoveredSegment: null }, () => this.updateCanvas());
    }

    // Utility to lighten/darken colors
    adjustColor(color, percent) {
        // If the color is short format (#FFF), expand to long format (#FFFFFF)
        if (color.length === 4) {
            color = '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
        }

        const num = parseInt(color.replace('#', ''), 16);
        const R = (num >> 16);
        const G = ((num >> 8) & 0x00FF);
        const B = (num & 0x0000FF);

        // Compute luminance
        const luminance = (0.299 * R + 0.587 * G + 0.114 * B) / 255;

        // If the color is bright, darken it; otherwise, lighten it
        const amt = luminance > 0.5 ? -percent : percent;

        const newR = Math.min(255, Math.max(0, R + amt));
        const newG = Math.min(255, Math.max(0, G + amt));
        const newB = Math.min(255, Math.max(0, B + amt));

        return '#' + (
            (newR << 16) + 
            (newG << 8) + 
            newB
        ).toString(16).padStart(6, '0');
    }

    hasPieData() {
        const { data } = this.state;
        if (!Array.isArray(data) || data.length === 0) {
            return false;
        }
        return data.some((wItem) => {
            const wValue = Number(wItem?.value);
            return Number.isFinite(wValue) && wValue > 0;
        });
    }

    drawTitle(ctx, width) {
        const wTitle = this.readTitleFromCell().trim();
        if (!wTitle) {
            return 0;
        }

        const wCell = this.m_Cell || {};
        const wFontSize = 14;
        const wTitleBand = wFontSize + 14;
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
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(wTitle, width / 2, 6);
        return wTitleBand;
    }

    drawPieChart(ctx, width, height) {
        const { data, hoveredSegment, selectedSegment } = this.state;
        const n = (v) => {
            const x = Number(v);
            return Number.isFinite(x) ? x : 0;
        };
        const total = data.reduce((sum, item) => sum + n(item.value), 0);
        if (total <= 0) {
            return;
        }

        const wTitleBand = this.drawTitle(ctx, width);
        const { centerX, centerY, radius: baseRadius } = this.piePlotMetrics(
            width,
            height,
            wTitleBand
        );

        let startAngle = -Math.PI / 2;

        data.forEach((segment, index) => {
            const angle = (n(segment.value) / total) * 2 * Math.PI;
            const isHovered = index === hoveredSegment;
            const isSelected = index === selectedSegment;
            const offset = isSelected
                ? PIE_SLICE_EXPLODE_SELECTED
                : isHovered
                  ? PIE_SLICE_EXPLODE_HOVER
                  : 0;

            const midAngle = startAngle + angle / 2;
            const offsetX = Math.cos(midAngle) * offset;
            const offsetY = Math.sin(midAngle) * offset;

            ctx.beginPath();
            ctx.moveTo(centerX + offsetX, centerY + offsetY);
            ctx.arc(
                centerX + offsetX,
                centerY + offsetY,
                baseRadius,
                startAngle,
                startAngle + angle
            );
            ctx.lineTo(centerX + offsetX, centerY + offsetY);
            ctx.closePath();

            ctx.globalAlpha = isHovered ? 0.8 : 1;
            ctx.fillStyle = segment.color;
            ctx.strokeStyle = 'white';
            ctx.lineWidth = isHovered || isSelected ? 2 : 1;

            if (isHovered || isSelected) {
                ctx.shadowColor = 'rgba(0,0,0,0.5)';
                ctx.shadowBlur = 10;
                ctx.shadowOffsetX = 2;
                ctx.shadowOffsetY = 2;
            }

            ctx.fill();
            ctx.stroke();

            ctx.globalAlpha = 1;
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            if (angle > 0.3) {
                const textRadius = baseRadius * 0.7;
                const textX = centerX + offsetX + Math.cos(startAngle + angle / 2) * textRadius;
                const textY = centerY + offsetY + Math.sin(startAngle + angle / 2) * textRadius;

                ctx.fillStyle = 'white';
                ctx.font = '12px Roboto';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`${Math.round((n(segment.value) / total) * 100)}%`, textX, textY);
            }

            if (isHovered) {
                const tooltipRadius = baseRadius + 30;
                const tooltipX = centerX + Math.cos(midAngle) * tooltipRadius;
                const tooltipY = centerY + Math.sin(midAngle) * tooltipRadius;

                ctx.fillStyle = 'rgba(0,0,0,0.8)';
                ctx.fillRect(tooltipX - 60, tooltipY - 15, 120, 30);
                ctx.fillStyle = 'white';
                ctx.font = '12px Roboto';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`${segment.label}: ${n(segment.value)}`, tooltipX, tooltipY);
            }

            startAngle += angle;
        });

        this.drawLegend(ctx, width, height);
    }

    drawLegend(ctx, sWidth, sHeight) {
        const { data } = this.state;
        if (!data.length) {
            return;
        }

        const wBoxSize = 10;
        const wItemGap = 12;
        const wLabelGap = 4;
        const wRowHeight = 16;
        const wPadX = 8;
        const wLegendTop = sHeight - PIE_LEGEND_BAND;
        const wMaxX = sWidth - wPadX;

        ctx.font = PIE_LEGEND_FONT;
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";

        const wRows = [];
        let wCurrentRow = [];
        let wCurrentRowW = 0;
        data.forEach((item) => {
            const wLabel = item.label != null ? String(item.label) : "";
            const wTextW = ctx.measureText(wLabel).width;
            const wItemW = wBoxSize + wLabelGap + wTextW;
            const wNextRowW = wCurrentRowW === 0 ? wItemW : wCurrentRowW + wItemGap + wItemW;

            if (wNextRowW > wMaxX - wPadX && wCurrentRow.length > 0) {
                wRows.push({ items: wCurrentRow, width: wCurrentRowW });
                wCurrentRow = [];
                wCurrentRowW = 0;
            }

            wCurrentRow.push({ item, label: wLabel, width: wItemW });
            wCurrentRowW = wCurrentRowW === 0 ? wItemW : wCurrentRowW + wItemGap + wItemW;
        });
        if (wCurrentRow.length > 0) {
            wRows.push({ items: wCurrentRow, width: wCurrentRowW });
        }

        let wRowY =
            wLegendTop +
            PIE_LEGEND_BAND / 2 -
            ((wRows.length - 1) * wRowHeight) / 2;
        wRows.forEach((row) => {
            // Center the legend row in the chart area. Left anchoring made the legend
            // appear detached from the chart/background when wide chart cells were clipped.
            let wX = Math.max(wPadX, (sWidth - row.width) / 2);
            row.items.forEach(({ item, label, width }) => {
                const wBoxY = wRowY - wBoxSize / 2;
                ctx.fillStyle = item.color;
                ctx.fillRect(wX, wBoxY, wBoxSize, wBoxSize);
                ctx.strokeStyle = "#FFFFFF";
                ctx.lineWidth = 1;
                ctx.strokeRect(wX, wBoxY, wBoxSize, wBoxSize);

                ctx.fillStyle = "#333333";
                ctx.fillText(label, wX + wBoxSize + wLabelGap, wRowY);

                wX += width + wItemGap;
            });
            wRowY += wRowHeight;
        });
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
            empty: !this.hasPieData(),
        });

        // Draw the pie chart
        this.drawPieChart(ctx, wWidth, wHeight);
    }

    paintExportInk(ctx, width, height) {
        this.drawPieChart(ctx, width, height);
    }

    // Convert color to RGB
    static ColorToRGB(color) {
        // Remove # if present
        color = color.replace('#', '');
        
        // Parse the hex values with parentheses to clarify operation order
        const r = parseInt(((color >> 16) & 0xFF), 10);
        const g = parseInt(((color >> 8) & 0xFF), 10);
        const b = parseInt((color & 0xFF), 10);
        
        return { r, g, b };
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
}

SkCellClass.installPdfExportStatics(SkCellClassPieChart, {
    initialState: () => ({
        data: [],
        hoveredSegment: null,
        selectedSegment: null,
        zIndex: 0,
    }),
    extra: () => ({ m_Data: {}, m_Title: "" }),
    hydrate: async (painter) => {
        await painter.loadPieDataFromRangeAttributes();
        await painter.syncTitleFromCell();
    },
    exportBackgroundOptions: (painter) => ({
        empty: !painter.hasPieData(),
    }),
});

export default SkCellClassPieChart; 