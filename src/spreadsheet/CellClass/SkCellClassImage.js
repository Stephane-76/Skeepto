//=============================================================================
// SkCellClassImage
// Floating object that renders an embedded image from a data URL attribute
//=============================================================================
import React from "react";
import SkCellClass from "./SkCellClass.js";

function Render(sCell, sSpInterface) {
    return (
        <SkCellClassImage
            Cell={sCell}
            key={sCell.c_k}
            SpInterface={sSpInterface}
        />
    );
}

/** Opacity 0–1. Values 1–100 are treated as percent. */
export function parseImageOpacity(sRaw) {
    const wText = String(sRaw ?? "").trim().replace(",", ".");
    if (!wText) {
        return 1;
    }
    const wNum = Number(wText);
    if (!Number.isFinite(wNum)) {
        return 1;
    }
    if (wNum > 1 && wNum <= 100) {
        return Math.min(1, Math.max(0, wNum / 100));
    }
    return Math.min(1, Math.max(0, wNum));
}

/** Rotation in degrees (clockwise, CSS/canvas). */
export function parseImageRotationDeg(sRaw) {
    const wText = String(sRaw ?? "").trim().replace(",", ".");
    if (!wText) {
        return 0;
    }
    const wNum = Number(wText);
    return Number.isFinite(wNum) ? wNum : 0;
}

function imageStateFromCell(sCell) {
    const wDataUrl = SkCellClass.readPropertyFromCellJson(sCell, "dataUrl") || "";
    const wAltText = SkCellClass.readPropertyFromCellJson(sCell, "altText") || "";
    return {
        dataUrl: typeof wDataUrl === "string" ? wDataUrl : String(wDataUrl || ""),
        altText: typeof wAltText === "string" ? wAltText : String(wAltText || ""),
        opacity: parseImageOpacity(SkCellClass.readPropertyFromCellJson(sCell, "opacity")),
        rotationDeg: parseImageRotationDeg(SkCellClass.readPropertyFromCellJson(sCell, "rotation")),
    };
}

class SkCellClassImage extends SkCellClass {
    constructor(props) {
        super(props);
        this.m_Cell = props.Cell;
        this.m_SpInterface = props.SpInterface;
        this.state = {
            ...imageStateFromCell(props.Cell),
            loadError: false,
        };
    }

    cellAttributesDigest(sCell) {
        const wAttrs = sCell?.c_v?.c?.a;
        return Array.isArray(wAttrs) ? JSON.stringify(wAttrs) : "";
    }

    async refreshImageFromCell() {
        let wDataUrl = SkCellClass.readPropertyFromCellJson(this.m_Cell, "dataUrl") || "";
        let wAltText = SkCellClass.readPropertyFromCellJson(this.m_Cell, "altText") || "";
        let wOpacityRaw = SkCellClass.readPropertyFromCellJson(this.m_Cell, "opacity") || "";
        let wRotationRaw = SkCellClass.readPropertyFromCellJson(this.m_Cell, "rotation") || "";
        if (!wDataUrl) {
            wDataUrl = await this.readPropertyValue("dataUrl", "");
        }
        if (!wAltText) {
            wAltText = await this.readPropertyValue("altText", "");
        }
        if (!wOpacityRaw) {
            wOpacityRaw = await this.readPropertyValue("opacity", "");
        }
        if (!wRotationRaw) {
            wRotationRaw = await this.readPropertyValue("rotation", "");
        }
        const wNextDataUrl = typeof wDataUrl === "string" ? wDataUrl : String(wDataUrl || "");
        const wNextAltText = typeof wAltText === "string" ? wAltText : String(wAltText || "");
        const wNextOpacity = parseImageOpacity(wOpacityRaw);
        const wNextRotation = parseImageRotationDeg(wRotationRaw);
        this.setState((prev) => {
            if (
                prev.dataUrl === wNextDataUrl &&
                prev.altText === wNextAltText &&
                prev.opacity === wNextOpacity &&
                prev.rotationDeg === wNextRotation &&
                prev.loadError === false
            ) {
                return null;
            }
            return {
                dataUrl: wNextDataUrl,
                altText: wNextAltText,
                opacity: wNextOpacity,
                rotationDeg: wNextRotation,
                loadError: false,
            };
        });
    }

    static ClassName() {
        return "SkCellClassImage";
    }

    static cellClassCapabilities() {
        return { ...SkCellClass.cellClassCapabilities(), floatingObject: true };
    }

    static Icon() {
        return (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%">
                <rect x="3" y="5" width="18" height="14" rx="1.5" ry="1.5"
                    fill="#ffffff" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="8.5" cy="10" r="1.8" fill="#f9c74f" />
                <polygon points="5,17 10,12 13,15 16,11 19,17"
                    fill="#90be6d" stroke="currentColor" strokeWidth="1" />
            </svg>
        );
    }

    static registerClassAttribute(sUISpreadSheet) {
        super.registerClassAttribute(sUISpreadSheet, "Image", "Javascript", Render);
        let wOk = sUISpreadSheet.addProperty("dataUrl", "string", "Image data URL", 0, "");
        if (!wOk) console.error("AddProperty dataUrl Error !");
        wOk = sUISpreadSheet.addProperty("altText", "string", "Alt text", 1, "");
        if (!wOk) console.error("AddProperty altText Error !");
        wOk = sUISpreadSheet.addProperty("opacity", "string", "Opacity (0-1)", 2, "1");
        if (!wOk) console.error("AddProperty opacity Error !");
        wOk = sUISpreadSheet.addProperty("rotation", "string", "Rotation (degrees)", 3, "0");
        if (!wOk) console.error("AddProperty rotation Error !");
    }

    paintExportInk(ctx, width, height) {
        const wImg = this._exportImage;
        if (wImg && wImg.width > 0 && wImg.height > 0) {
            const wOpacity = parseImageOpacity(this.state?.opacity);
            const wRotationDeg = parseImageRotationDeg(this.state?.rotationDeg);
            const wRad = (wRotationDeg * Math.PI) / 180;
            const wAbsCos = Math.abs(Math.cos(wRad));
            const wAbsSin = Math.abs(Math.sin(wRad));
            const wBbW = wImg.width * wAbsCos + wImg.height * wAbsSin;
            const wBbH = wImg.width * wAbsSin + wImg.height * wAbsCos;
            const wScale = Math.min(width / Math.max(wBbW, 1), height / Math.max(wBbH, 1));
            const wDw = wImg.width * wScale;
            const wDh = wImg.height * wScale;
            ctx.save();
            ctx.globalAlpha = wOpacity;
            ctx.translate(width / 2, height / 2);
            if (wRotationDeg) {
                ctx.rotate(wRad);
            }
            ctx.drawImage(wImg, -wDw / 2, -wDh / 2, wDw, wDh);
            ctx.restore();
            return;
        }
        SkCellClass.applyCanvasFont(ctx, {
            color: "#888888",
            fontSizePx: 12,
            fontFamily: "Roboto",
            fontStyle: "",
            fontWeight: "",
        });
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const wMsg = this._exportImageError ? "Image unavailable" : "No image";
        ctx.fillText(wMsg, width / 2, height / 2);
    }

    componentDidMount() {
        void this.refreshImageFromCell();
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
            this.setState(
                {
                    ...imageStateFromCell(this.props.Cell),
                    loadError: false,
                },
                () => {
                    void this.refreshImageFromCell();
                },
            );
        }
    }

    handleImageError = () => {
        this.setState({ loadError: true });
    };

    renderImageBody() {
        const { dataUrl, altText, loadError, opacity, rotationDeg } = this.state;
        if (loadError || !dataUrl) {
            return (
                <div
                    style={{
                        width: "100%",
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#888",
                        fontSize: "12px",
                        textAlign: "center",
                        padding: "4px",
                    }}
                >
                    {loadError ? "Image unavailable" : "No image"}
                </div>
            );
        }
        const wTransforms = [];
        if (rotationDeg) {
            wTransforms.push(`rotate(${rotationDeg}deg)`);
        }
        return (
            <img
                src={dataUrl}
                alt={altText || "Embedded image"}
                draggable={false}
                onError={this.handleImageError}
                style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    display: "block",
                    userSelect: "none",
                    opacity,
                    transform: wTransforms.length ? wTransforms.join(" ") : "none",
                    transformOrigin: "center center",
                }}
            />
        );
    }

    render() {
        const wLayout = this.CellPosSizeChart();
        const wRotated = Math.abs(Number(this.state.rotationDeg) || 0) > 0.05;
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
            overflow: wRotated ? "visible" : "hidden",
            alignItems: "center",
            justifyContent: "center",
        };

        return (
            <div
                style={wCellStyleParent}
                className="SkSpCellClass SkSpCellClassImage"
                onMouseDownCapture={this.onCellClassMouseDownCapture}
            >
                <div
                    style={{
                        width: wLayout.canvasW + "px",
                        height: wLayout.canvasH + "px",
                        marginLeft: wLayout.offsetX + "px",
                        marginTop: wLayout.offsetY + "px",
                        flexShrink: 0,
                    }}
                >
                    {this.renderImageBody()}
                </div>
            </div>
        );
    }
}

SkCellClass.installPdfExportStatics(SkCellClassImage, {
    initialState: (cell) => ({ ...imageStateFromCell(cell), loadError: false }),
    hydrate: async (painter) => {
        await painter.refreshImageFromCell();
        painter._exportImage = await SkCellClass.loadImageFromDataUrl(painter.state.dataUrl);
        painter._exportImageError = !painter._exportImage && !!painter.state.dataUrl;
    },
});

export default SkCellClassImage;
