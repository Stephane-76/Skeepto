//=============================================================================
// SkCellClass
// Class ancestor
//=============================================================================
import * as SkA1Ref from '../SkA1Ref.js';
import SkComponent from "../../component/SkComponent";
import { GetFontStyle, GetFontWeight, buildCanvasFontFamily, GetTextAlign, GetVerticalTextAlign } from '../../utility/SkUtility.js'
import { fontSizePtFromCell, fontSizeCssPxFromPt } from '../../utility/SkFontPool.js'

// Table of Classes Name and function render
const  wArrayOfClass = [ ]

function Register(sClass,sName,sRender,sIcon) {
    const wFound = wArrayOfClass.find((wElement) => wElement.Name===sName);
    if (wFound===undefined) {
        wArrayOfClass.push({ Class : sClass, Name : sName, Render : sRender, Icon : sIcon })
    } else {
        // Keep registry up to date if the class re-registers
        wFound.Class  = sClass;
        wFound.Render = sRender;
        wFound.Icon   = sIcon;
    }
}

export function GetRender(sName) {
    const wFound = wArrayOfClass.find((wElement) => wElement.Name===sName);
    if (wFound!==undefined) {
        return(wFound.Render)
    }
}

export function GetClass(sName) {
    const wFound = wArrayOfClass.find((wElement) => wElement.Name===sName);
    if (wFound!==undefined) {
        return(wFound.Class)
    }
}

/** Registered cell class that implements JsonView PDF export statics. */
export function GetPdfExportClass(sName) {
    const wClass = GetClass(sName);
    if (wClass == null) {
        return undefined;
    }
    if (typeof wClass.loadPaintStateFromCell !== "function") {
        return undefined;
    }
    if (typeof wClass.paintBackgroundAtJsonViewCell !== "function") {
        return undefined;
    }
    if (typeof wClass.paintInkAtJsonViewCell !== "function") {
        return undefined;
    }
    return wClass;
}

// Return the icon (React SVG element or function) representing a class
export function GetIcon(sName) {
    const wFound = wArrayOfClass.find((wElement) => wElement.Name===sName);
    if (wFound!==undefined) {
        return(wFound.Icon)
    }
}

// Return the full list of registered classes (useful for palettes / menus)
export function GetAllClasses() {
    return wArrayOfClass.slice();
}

const DEFAULT_CELL_CLASS_CAPABILITIES = Object.freeze({
    floatingObject: false,
    selfEditing: false,
    inplaceEditBlocked: false,
    calculableModelValue: false,
    calculableWireType: "",
});

function resolveCellClassCapabilities(sClassName) {
    if (!sClassName) {
        return DEFAULT_CELL_CLASS_CAPABILITIES;
    }
    const wClass = GetClass(sClassName);
    if (wClass && typeof wClass.cellClassCapabilities === "function") {
        return wClass.cellClassCapabilities();
    }
    return DEFAULT_CELL_CLASS_CAPABILITIES;
}

export function getCellClassCapabilities(sClassName) {
    return resolveCellClassCapabilities(sClassName);
}

export function canApplyAsFloatingObject(sClassName) {
    return resolveCellClassCapabilities(sClassName).floatingObject === true;
}

// c_v.n = React class TYPE (e.g. SkCellClassCheck). c_v.c.n = unique instance ref name — never use instance name for render/blocking.
export function reactCellClassTypeName(sCell) {
    if (!sCell || sCell.c_t !== "c" || !sCell.c_v || typeof sCell.c_v !== "object") {
        return "";
    }
    if (!Object.prototype.hasOwnProperty.call(sCell.c_v, "co")) {
        return "";
    }
    const wName = sCell.c_v.n;
    return typeof wName === "string" ? wName : "";
}

function reactCellClassName(sCell) {
    return reactCellClassTypeName(sCell);
}

export function isSelfEditingCellClass(sCell) {
    return resolveCellClassCapabilities(reactCellClassName(sCell)).selfEditing === true;
}

export function isInplaceEditBlockedCellClass(sCell) {
    return resolveCellClassCapabilities(reactCellClassName(sCell)).inplaceEditBlocked === true;
}

/** No generic SkSpInplaceEdit cell overlay (widget editor or toggle-only class). */
export function shouldBypassCellInplaceOverlay(sCell) {
    return isSelfEditingCellClass(sCell) || isInplaceEditBlockedCellClass(sCell);
}

/** True when the class scalar is CalculableValue (c_v.c.t / c_v.c.v), not c_v.c.a. */
export function usesCalculableModelValue(sClassName) {
    return resolveCellClassCapabilities(sClassName).calculableModelValue === true;
}

/** Expected tVariant::Json wire tag for each calculable-model class (runtime type on c_v.c.t). */
export function calculableModelValueWireType(sClassName) {
    return resolveCellClassCapabilities(sClassName).calculableWireType || "";
}

// Base class for spreadsheet components ======================================
class SkCellClass extends SkComponent {
    constructor(props) {
        super(props)
        this.m_Cell=this.props.Cell;
        this.m_SpInterface=this.props.SpInterface;
        this.m_Method = [];
        this.m_Event=  [function(sSender) {}]
    }

    static ClassName() { return("SkCellClass") }

    /** Declares cross-cutting CellClass behavior (floating, self-edit, calculable value, …). */
    static cellClassCapabilities() {
        return { ...DEFAULT_CELL_CLASS_CAPABILITIES };
    }

    // Default icon used when a subclass does not override Icon()
    static Icon() {
        return (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%">
                <rect x="3" y="3" width="18" height="18" rx="3" ry="3"
                      fill="none" stroke="currentColor" strokeWidth="1.5"/>
                <text x="12" y="16" textAnchor="middle" fontSize="10"
                      fill="currentColor" fontFamily="Roboto">?</text>
            </svg>
        );
    }

    static registerClassAttribute(sUISpreadSheet,sLabel,sFamily,sRender) {
        console.log( "Register " + this.ClassName() + ", " + sLabel + "," + sFamily);
        // Bind Icon() as a function so consumers can call it or render it on demand
        const wIcon = () => this.Icon();
        Register(this,this.ClassName(),sRender,wIcon);
        
        // CRITICAL: Check if sUISpreadSheet is defined before using it
        if (!sUISpreadSheet) {
            console.error( "RegisterClass " + this.ClassName() + "," + sLabel + " Error: sUISpreadSheet is undefined!");
            console.error( "  window.SkUISpreadSheet:", window.SkUISpreadSheet);
            console.error( "  This usually means SkUISpreadSheet was not initialized before RegisterClasses() was called");
            return false;
        }
        
        var wOk=sUISpreadSheet.registerClassAttribute(this.ClassName(),sLabel,sFamily);
        if (!wOk) console.error( "RegisterClass " + this.ClassName() + "," + sLabel + " Error !");
        return wOk;
    }

    RegisterMethod(sName,sFunction) {
        this.m_Method[sName]=sFunction;
    }

    RegisterEvent(sName,sFunction) {
        this.m_Event[sName]=sFunction;
    }

    Method(sName) {
        if (this.m_Method[sName]!==undefined) {
            return(this.m_Method[sName](this));
        }
    }

    FunctionOnChange(sFunctionOnChange) {
        this.m_FunctionOnChange=sFunctionOnChange;
    }

    HelloWorld() {
        console.log( "Hello World");
        this.m_OnChange(this);
        this.Method("onChange");
    }

    cellStr() {
        return window.SkUISpreadSheet.base10toAlphaSync(this.m_Cell.c_c) + this.m_Cell.c_r;
    }

    /** Host cell on _$$A for floating-object attributes; empty when not floating. */
    static floatingAttributeHost(sCell) {
        const wMeta = sCell?.c_foMeta;
        if (wMeta == null) {
            return { ref: "", sheet: "" };
        }
        return {
            ref: typeof wMeta.hostRef === "string" ? wMeta.hostRef.trim() : "",
            sheet: typeof wMeta.hostSheet === "string" ? wMeta.hostSheet.trim() : "",
        };
    }

    /** Host cell for class attribute I/O (floating _$$A host or grid c_r/c_c). */
    static attributeHostFromCell(sCell, sDefaultSheet = "") {
        const wFloating = SkCellClass.floatingAttributeHost(sCell);
        if (wFloating.ref) {
            return wFloating;
        }
        const wRow = Number(sCell?.c_r);
        const wCol = Number(sCell?.c_c);
        if (
            Number.isFinite(wRow) &&
            wRow > 0 &&
            Number.isFinite(wCol) &&
            wCol > 0 &&
            typeof window !== "undefined" &&
            window.SkUISpreadSheet
        ) {
            return {
                ref: window.SkUISpreadSheet.base10toAlphaSync(wCol) + wRow,
                sheet: typeof sDefaultSheet === "string" ? sDefaultSheet.trim() : "",
            };
        }
        return { ref: "", sheet: "" };
    }

    /** Shared context for reading range-backed class attributes (charts, gauges, …). */
    static buildRangeReadContext(sCell, sSpInterface) {
        const wMeta = sCell?.c_foMeta;
        const wDefaultSheet =
            (typeof wMeta?.targetSheet === "string" && wMeta.targetSheet) ||
            sSpInterface?.m_UIView?.sheet ||
            "";
        const wHost = SkCellClass.attributeHostFromCell(sCell, wDefaultSheet);
        return {
            defaultSheet: wDefaultSheet,
            hostRef: wHost.ref,
            hostSheet: wHost.sheet || wDefaultSheet,
        };
    }

    /** Parse literal/formula attribute wire into an A1 range ref (handles DATARANGE). */
    static extractRangeRefFromAttributeWire(sRaw) {
        const wText = String(sRaw || "").trim().replace(/^=/, "").trim();
        if (!wText) {
            return "";
        }
        const wFromDataRange = SkCellClass.rangeRefFromDataRangeEval(wText);
        if (wFromDataRange) {
            return wFromDataRange;
        }
        return SkCellClass.normalizeRangeRefInput(wText);
    }

    /** wasm GetValueAttribute / GetFormulaAttribute expect A11 + sheet _$$A, not _$$A!A11. */
    static splitHostAttributeRef(sHostRef, sHostSheet = "") {
        const wRef = typeof sHostRef === "string" ? sHostRef.trim() : "";
        const wSheet = typeof sHostSheet === "string" ? sHostSheet.trim() : "";
        if (!wRef) {
            return { ref: "", sheet: wSheet };
        }
        const wBang = wRef.indexOf("!");
        if (wBang >= 0) {
            return {
                ref: wRef.slice(wBang + 1).trim(),
                sheet: wSheet || wRef.slice(0, wBang).trim(),
            };
        }
        return { ref: wRef, sheet: wSheet };
    }

    /** True when attribute value must be read via GetProperty (formula on host or anchored cell). */
    static propertyNeedsLiveEval(sCell, sPropertyName, sFormulaBody, sAttr) {
        if (!sAttr) {
            return false;
        }
        if (sFormulaBody || sAttr.hasOwnProperty("f")) {
            return true;
        }
        const wLiteral = String(
            SkCellClass.readPropertyFromCellJson(sCell, sPropertyName) || "",
        ).trim();
        return wLiteral.startsWith("=");
    }

    /** Cell ref + sheet for wasm attribute read/write (host when floating). */
    attributeValueRef() {
        const wHost = SkCellClass.floatingAttributeHost(this.m_Cell);
        if (wHost.ref) {
            return SkCellClass.splitHostAttributeRef(wHost.ref, wHost.sheet);
        }
        return { ref: this.cellStr(), sheet: "" };
    }

    /**
     * Evaluated model attribute (literal from JsonView, or GetProperty on _$$A host when floating).
     * Works for Title, chartType, etc. — range attrs should use resolvePropertyRangeRef.
     */
    async readPropertyValue(sPropertyName, sFallback = "") {
        const wAttr = SkCellClass.readPropertyAttrEntry(this.m_Cell, sPropertyName);
        if (!wAttr) {
            return sFallback;
        }
        const wDefaultSheet =
            (this.m_SpInterface?.m_UIView?.sheet &&
                String(this.m_SpInterface.m_UIView.sheet).trim()) ||
            "";
        const wHost = SkCellClass.attributeHostFromCell(this.m_Cell, wDefaultSheet);
        const wFormulaBody = await SkCellClass.resolveLiveAttributeFormulaBody(
            wHost.ref,
            sPropertyName,
            wHost.sheet || wDefaultSheet,
            wAttr,
        );
        if (SkCellClass.propertyNeedsLiveEval(this.m_Cell, sPropertyName, wFormulaBody, wAttr)) {
            try {
                const wRaw = await this.GetProperty(sPropertyName);
                let wValue = SkCellClass.normalizeWasmCellValue(wRaw);
                const wBody =
                    wFormulaBody ||
                    (wAttr.f != null ? String(wAttr.f).trim() : "");
                if (
                    (!wValue || String(wRaw || "").trim().startsWith("=")) &&
                    wBody
                ) {
                    const wResolved = await SkCellClass.resolveScalarFromAttributeFormula(
                        this.m_Cell,
                        wBody,
                    );
                    if (wResolved) {
                        wValue = wResolved;
                    }
                }
                return wValue || sFallback;
            } catch (error) {
                console.error(`SkCellClass.readPropertyValue(${sPropertyName}) failed:`, error);
                return sFallback;
            }
        }
        return SkCellClass.readPropertyFromCellJson(this.m_Cell, sPropertyName) || sFallback;
    }

    /**
     * Sync read for canvas paint — cached eval after readPropertyValue, else JsonView literal.
     * @param {string} sCachedEval e.g. this.m_Title updated by syncPropertyFromCell
     */
    readPropertyCachedOrLiteral(sPropertyName, sCachedEval = "") {
        const wAttr = SkCellClass.readPropertyAttrEntry(this.m_Cell, sPropertyName);
        if (!wAttr) {
            return sCachedEval || "";
        }
        if (
            wAttr.hasOwnProperty("f") ||
            (SkCellClass.floatingAttributeHost(this.m_Cell).ref &&
                String(SkCellClass.readPropertyFromCellJson(this.m_Cell, sPropertyName) || "")
                    .trim()
                    .startsWith("="))
        ) {
            return sCachedEval || "";
        }
        return SkCellClass.readPropertyFromCellJson(this.m_Cell, sPropertyName);
    }

    /** Refresh one cached formula/literal property and repaint if changed. */
    async syncPropertyFromCell(sPropertyName, sCacheHolder, sCacheKey) {
        const wNext = await this.readPropertyValue(sPropertyName, "");
        if (wNext !== sCacheHolder[sCacheKey]) {
            sCacheHolder[sCacheKey] = wNext;
            this.updateCanvas();
        }
    }

    /**
     * Visible box for React overlays (SkSpGridPanel). Non-merged cells use JsonView row/col stepping
     * (rows[].s / cols[].s) so widgets keep full band height on the last partial viewport row.
     * Merged ink keeps c_* with viewport intersection — wide/tall merges can extend past the pane.
     */
    CellPosSize() {
        const wCell = this.m_Cell;
        const sp = this.m_SpInterface;
        const wRow = Number(wCell.c_r);
        const wCol = Number(wCell.c_c);
        const isMergedInk =
            Object.prototype.hasOwnProperty.call(wCell, "c_mg") && wCell.c_mg === true;

        if (
            !isMergedInk &&
            sp &&
            typeof sp._cellLayoutFromUi === "function" &&
            typeof sp._viewportAndOffsetsForSheetCell === "function" &&
            Number.isFinite(wRow) &&
            Number.isFinite(wCol)
        ) {
            const vp = sp._viewportAndOffsetsForSheetCell(wRow, wCol);
            const layout = vp?.ui ? sp._cellLayoutFromUi(vp.ui, wRow, wCol) : null;
            if (layout && layout.width > 0 && layout.height > 0) {
                return {
                    X: layout.left,
                    Y: layout.top,
                    W: layout.width,
                    H: layout.height,
                };
            }
        }

        let X = Number(wCell.c_x);
        let Y = Number(wCell.c_y);
        if (!Number.isFinite(X)) X = 0;
        if (!Number.isFinite(Y)) Y = 0;
        let W = Number(wCell.c_w);
        let H = Number(wCell.c_h);

        if (
            sp &&
            typeof sp.getCellWidgetPaneClipSizeCssPx === "function" &&
            Number.isFinite(wRow) &&
            Number.isFinite(wCol)
        ) {
            const clip = sp.getCellWidgetPaneClipSizeCssPx(wRow, wCol);
            const vpW = Math.max(0, clip.width);
            const vpH = Math.max(0, clip.height);
            if (
                vpW > 0 &&
                vpH > 0 &&
                Number.isFinite(W) &&
                W > 0 &&
                Number.isFinite(H) &&
                H > 0
            ) {
                const r = X + W;
                const b = Y + H;
                const iL = Math.max(0, X);
                const iT = Math.max(0, Y);
                const iR = Math.min(vpW, r);
                const iB = Math.min(vpH, b);
                return {
                    X: iL,
                    Y: iT,
                    W: Math.max(0, iR - iL),
                    H: Math.max(0, iB - iT),
                };
            }
        }

        if (!Number.isFinite(W) || W <= 0) W = 0;
        if (!Number.isFinite(H) || H <= 0) H = 0;
        return { X, Y, W, H };
    }

    /**
     * Logical cell box for chart widgets. JsonView may clamp merged ink to a visible slice; duplicate
     * overflow cells (c__l / c__r) must not spawn extra tiny widgets without this.
     * Merged anchors: c_mg, c_ox / c_oy = visible slice minus full merge width/height, c_ml / c_mt when merge starts left/top of view.
     */
    CellPosSizeLogical() {
        const wCell = this.m_Cell;
        let X = Number(wCell.c_x);
        let Y = Number(wCell.c_y);
        let W = Number(wCell.c_w);
        let H = Number(wCell.c_h);
        const cellHasOx = Object.prototype.hasOwnProperty.call(wCell, "c_ox");
        const cOxRaw = cellHasOx ? Number(wCell.c_ox) : 0;
        const cOx = cellHasOx && Number.isFinite(cOxRaw) ? cOxRaw : 0;
        const mergeLayoutOx =
            cellHasOx &&
            Object.prototype.hasOwnProperty.call(wCell, "c_mg") &&
            wCell.c_mg === true;
        const mergeClampedLeft =
            mergeLayoutOx &&
            Object.prototype.hasOwnProperty.call(wCell, "c_ml") &&
            wCell.c_ml === true;
        const cellHasOy = Object.prototype.hasOwnProperty.call(wCell, "c_oy");
        const cOyRaw = cellHasOy ? Number(wCell.c_oy) : 0;
        const cOy = cellHasOy && Number.isFinite(cOyRaw) ? cOyRaw : 0;
        const mergeLayoutOy =
            cellHasOy &&
            Object.prototype.hasOwnProperty.call(wCell, "c_mg") &&
            wCell.c_mg === true;
        const mergeClampedTop =
            mergeLayoutOy &&
            Object.prototype.hasOwnProperty.call(wCell, "c_mt") &&
            wCell.c_mt === true;
        if (!Number.isFinite(X)) X = 0;
        if (!Number.isFinite(Y)) Y = 0;
        if (!Number.isFinite(W) || W <= 0) W = 0;
        if (!Number.isFinite(H) || H <= 0) H = 0;

        if (cellHasOx && Number.isFinite(cOxRaw)) {
            if (mergeLayoutOx) {
                W -= cOx;
                if (mergeClampedLeft) {
                    X += cOx;
                }
            } else {
                X += cOx;
                W -= cOx;
            }
        }
        if (cellHasOy && Number.isFinite(cOyRaw)) {
            if (mergeLayoutOy) {
                H -= cOy;
                if (mergeClampedTop) {
                    Y += cOy;
                }
            } else {
                Y += cOy;
                H -= cOy;
            }
        }
        return {
            X,
            Y,
            W: Math.max(0, W),
            H: Math.max(0, H),
        };
    }

    /**
     * Chart / wide canvas widgets: visible container matches JsonView c_x/c_w (same as DrawBackground
     * on the grid canvas); inner canvas uses the logical cell box with margin offset so content
     * scrolls off-screen correctly during merged horizontal clamp (c_ox, c_ml) and vertical (c_oy, c_mt).
     */
    CellPosSizeChart() {
        const wCell = this.m_Cell;
        const visX = Number(wCell.c_x) || 0;
        const visY = Number(wCell.c_y) || 0;
        const visW = Number(wCell.c_w) || 0;
        const visH = Number(wCell.c_h) || 0;

        const cellHasOx = Object.prototype.hasOwnProperty.call(wCell, "c_ox");
        const cOxRaw = cellHasOx ? Number(wCell.c_ox) : 0;
        const cOx = cellHasOx && Number.isFinite(cOxRaw) ? cOxRaw : 0;
        const mergeLayoutOx =
            cellHasOx &&
            Object.prototype.hasOwnProperty.call(wCell, "c_mg") &&
            wCell.c_mg === true;
        const mergeClampedLeft =
            mergeLayoutOx &&
            Object.prototype.hasOwnProperty.call(wCell, "c_ml") &&
            wCell.c_ml === true;
        const cellHasOy = Object.prototype.hasOwnProperty.call(wCell, "c_oy");
        const cOyRaw = cellHasOy ? Number(wCell.c_oy) : 0;
        const cOy = cellHasOy && Number.isFinite(cOyRaw) ? cOyRaw : 0;
        const mergeLayoutOy =
            cellHasOy &&
            Object.prototype.hasOwnProperty.call(wCell, "c_mg") &&
            wCell.c_mg === true;
        const mergeClampedTop =
            mergeLayoutOy &&
            Object.prototype.hasOwnProperty.call(wCell, "c_mt") &&
            wCell.c_mt === true;

        let logX = visX;
        let logY = visY;
        let logW = visW;
        let logH = visH;

        if (cellHasOx && Number.isFinite(cOxRaw)) {
            logW -= cOx;
            if (mergeLayoutOx) {
                if (mergeClampedLeft) {
                    logX += cOx;
                }
            } else {
                logX += cOx;
            }
        }
        if (cellHasOy && Number.isFinite(cOyRaw)) {
            logH -= cOy;
            if (mergeLayoutOy) {
                if (mergeClampedTop) {
                    logY += cOy;
                }
            } else {
                logY += cOy;
            }
        }

        return {
            X: visX,
            Y: visY,
            W: Math.max(0, visW),
            H: Math.max(0, visH),
            canvasW: Math.max(0, logW),
            canvasH: Math.max(0, logH),
            offsetX: logX - visX,
            offsetY: logY - visY,
        };
    }

    /**
     * Shared layout for in-cell React widgets during fine scroll.
     * The outer box is the visible clipped slice; the inner box keeps the logical cell size
     * and moves with offsetX/offsetY so controls scroll out instead of being squeezed.
     */
    CellClassClippedOverlayLayout(options = {}) {
        const wLayout = this.CellPosSizeChart();
        const wInset = Math.max(0, Number(options.inset) || 0);
        const wOverflow = options.overflow || "hidden";
        const wInnerW = Math.max(0, wLayout.canvasW - wInset * 2);
        const wInnerH = Math.max(0, wLayout.canvasH - wInset * 2);

        return {
            layout: wLayout,
            innerW: wInnerW,
            innerH: wInnerH,
            outerStyle: {
                position: "absolute",
                margin: "0px",
                padding: options.outerPadding ?? "0px",
                left: wLayout.X + "px",
                top: wLayout.Y + "px",
                width: wLayout.W + "px",
                height: wLayout.H + "px",
                overflow: wOverflow,
            },
            innerStyle: {
                position: options.innerPosition || "relative",
                width: wInnerW + "px",
                height: wInnerH + "px",
                marginLeft: (wLayout.offsetX + wInset) + "px",
                marginTop: (wLayout.offsetY + wInset) + "px",
                padding: options.innerPadding ?? "0px",
                flexShrink: 0,
            },
        };
    }

    /** Spreadsheet cell fill color (JsonView f_bc) for canvas-backed widgets. */
    static readCellBackgroundColor(sCell) {
        const wBg = sCell?.f_bc;
        if (wBg != null && String(wBg).trim() !== "") {
            return String(wBg).trim();
        }
        return "";
    }

    /** Light placeholder for empty chart/sparkline widgets (static or floating). */
    static EMPTY_CHART_PLACEHOLDER_BG = "#eef3f8";

    /** JsonView cell box in sheet/export pixel space. */
    static jsonViewCellRect(cell) {
        const x = Number(cell?.c_x) || 0;
        const y = Number(cell?.c_y) || 0;
        const w = Number(cell?.c_w) || 0;
        const h = Number(cell?.c_h) || 0;
        if (!(w > 0 && h > 0)) {
            return null;
        }
        return { x, y, w, h };
    }

    /** Host cell fill in local widget coordinates (0,0)–(width,height). */
    static fillWidgetBackgroundLocal(ctx, cell, width, height, options = {}) {
        if (options.empty === true) {
            ctx.fillStyle = SkCellClass.EMPTY_CHART_PLACEHOLDER_BG;
            ctx.fillRect(0, 0, width, height);
            return;
        }
        const wBg = SkCellClass.readCellBackgroundColor(cell);
        if (wBg) {
            ctx.fillStyle = wBg;
            ctx.fillRect(0, 0, width, height);
        } else if (options.opaque === true) {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, width, height);
        } else {
            ctx.clearRect(0, 0, width, height);
        }
    }

    /**
     * Paint a widget callback in JsonView cell coordinates.
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} cell
     * @param {(localCtx: CanvasRenderingContext2D, cell: object, width: number, height: number) => void} paintFn
     */
    static paintAtJsonViewCell(ctx, cell, paintFn) {
        const rect = SkCellClass.jsonViewCellRect(cell);
        if (rect == null) {
            return;
        }
        ctx.save();
        ctx.translate(rect.x, rect.y);
        paintFn(ctx, cell, rect.w, rect.h);
        ctx.restore();
    }

    /**
     * Headless instance for PDF export: mutates `.state` instead of React setState.
     * @param {object} prototype — e.g. SkCellClassLineChart.prototype
     */
    static createExportPainter(prototype, cell, spInterface, initialState, extra = {}) {
        const p = Object.create(prototype);
        p.m_Cell = cell;
        p.m_SpInterface = spInterface;
        p.props = { Cell: cell, SpInterface: spInterface };
        p.state = { ...initialState };
        Object.assign(p, extra);
        p.setState = (update, cb) => {
            const next =
                typeof update === "function" ? update(p.state, p.props) : update;
            p.state = { ...p.state, ...next };
            if (typeof cb === "function") {
                cb();
            }
        };
        p.scheduleCanvasUpdate = () => {};
        p.canvasRef = { current: null };
        return p;
    }

    /** JsonView format fields → canvas font/layout (PDF export + offline paint). */
    static cellStylesForCanvasExport(cell) {
        let wColor = "black";
        let wBackgroundColor = "transparent";
        let wFontName = "Roboto";
        let wTextAlign = "end";
        let wVerticalAlign = "center";
        let wFontStyle = "";
        let wFontWeight = "";
        const wFontSizePt = fontSizePtFromCell(cell, 12);

        if (cell?.hasOwnProperty("f_c")) {
            wColor = cell.f_c;
        }
        if (cell?.hasOwnProperty("f_bc")) {
            wBackgroundColor = cell.f_bc;
        }
        if (cell?.hasOwnProperty("f_ah")) {
            wTextAlign = GetTextAlign(cell.f_ah) || wTextAlign;
        }
        if (cell?.hasOwnProperty("f_av")) {
            wVerticalAlign = GetVerticalTextAlign(cell.f_av) || wVerticalAlign;
        }
        if (cell?.hasOwnProperty("f_st")) {
            wFontStyle = GetFontStyle(cell.f_st);
        }
        if (cell?.hasOwnProperty("f_we")) {
            wFontWeight = GetFontWeight(cell.f_we);
        }
        if (cell?.hasOwnProperty("f_f_n")) {
            wFontName = cell.f_f_n;
        }

        const wFontSizePx = fontSizeCssPxFromPt(wFontSizePt);
        const wDisplayValue =
            cell?.f_value != null && cell.f_value !== "" ? String(cell.f_value) : "";

        return {
            color: wColor,
            backgroundColor: wBackgroundColor,
            fontName: wFontName,
            fontSizePt: wFontSizePt,
            fontSizePx: wFontSizePx,
            fontFamily: buildCanvasFontFamily(wFontName),
            textAlign: wTextAlign,
            verticalAlign: wVerticalAlign,
            fontStyle: wFontStyle,
            fontWeight: wFontWeight,
            inset: 2,
            displayValue: wDisplayValue,
        };
    }

    static applyCanvasFont(ctx, styles) {
        ctx.fillStyle = styles.color || "#333333";
        ctx.font =
            `${styles.fontStyle || ""} ${styles.fontWeight || ""} ${styles.fontSizePx}px ${styles.fontFamily}`
                .trim();
    }

    static canvasExportTextAlign(flexAlign) {
        if (flexAlign === "start") {
            return "left";
        }
        if (flexAlign === "end") {
            return "right";
        }
        return "center";
    }

    static canvasExportTextY(verticalAlign, height) {
        if (verticalAlign === "start") {
            return Math.max(8, height * 0.35);
        }
        if (verticalAlign === "end") {
            return Math.max(8, height * 0.72);
        }
        return height / 2;
    }

    static roundRectPath(ctx, x, y, w, h, r) {
        const wRadius = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + wRadius, y);
        ctx.lineTo(x + w - wRadius, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + wRadius);
        ctx.lineTo(x + w, y + h - wRadius);
        ctx.quadraticCurveTo(x + w, y + h, x + w - wRadius, y + h);
        ctx.lineTo(x + wRadius, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - wRadius);
        ctx.lineTo(x, y + wRadius);
        ctx.quadraticCurveTo(x, y, x + wRadius, y);
        ctx.closePath();
    }

    /**
     * Horizontally align a widget + optional caption (Check, Switch, …).
     * @param {(widgetX: number, widgetY: number) => void} paintWidget
     */
    static paintWidgetWithCaption(ctx, cell, innerW, innerH, widgetW, widgetH, paintWidget, styles) {
        const wCaption = SkCellClass.readPropertyFromCellJson(cell, "label");
        const wCenterY = SkCellClass.canvasExportTextY(styles.verticalAlign, innerH);
        const wGap = 4;
        let wCaptionW = 0;
        if (wCaption) {
            SkCellClass.applyCanvasFont(ctx, styles);
            wCaptionW = ctx.measureText(String(wCaption)).width;
        }
        const wTotalW = widgetW + (wCaption ? wGap + wCaptionW : 0);
        let wStartX = 0;
        if (styles.textAlign === "end") {
            wStartX = innerW - wTotalW;
        } else if (styles.textAlign === "center") {
            wStartX = (innerW - wTotalW) / 2;
        }
        paintWidget(wStartX, wCenterY - widgetH / 2);
        if (wCaption) {
            SkCellClass.applyCanvasFont(ctx, styles);
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(String(wCaption), wStartX + widgetW + wGap, wCenterY);
        }
    }

    static async loadImageFromDataUrl(dataUrl) {
        return new Promise((resolve) => {
            const wUrl = String(dataUrl || "").trim();
            if (!wUrl) {
                resolve(null);
                return;
            }
            const wImg = new Image();
            wImg.onload = () => resolve(wImg);
            wImg.onerror = () => resolve(null);
            wImg.src = wUrl;
        });
    }

    /**
     * Headless painter for PDF export.
     * @param {typeof SkCellClass} klass
     */
    static async loadExportPainter(klass, cell, spInterface, options = {}) {
        const wInitial =
            typeof options.initialState === "function"
                ? options.initialState(cell)
                : options.initialState ?? {};
        const wExtra =
            typeof options.extra === "function" ? options.extra(cell) : options.extra ?? {};
        const p = SkCellClass.createExportPainter(
            klass.prototype,
            cell,
            spInterface,
            wInitial,
            wExtra,
        );
        if (typeof options.hydrate === "function") {
            await options.hydrate(p, cell, spInterface);
        } else if (typeof klass.hydrateExportPainter === "function") {
            await klass.hydrateExportPainter(p, cell, spInterface);
        }
        return p;
    }

    static exportBackgroundOptionsFor(klass, painter, cell) {
        if (typeof klass.exportBackgroundOptions === "function") {
            return klass.exportBackgroundOptions(painter, cell);
        }
        return {};
    }

    /** Pass 4a — widget background (subclass may set exportBackgroundOptions). */
    static paintBackgroundAtJsonViewCellFor(klass, ctx, cell, painter) {
        SkCellClass.paintAtJsonViewCell(ctx, cell, (c, cell, w, h) => {
            const wOpts = {
                ...SkCellClass.exportBackgroundOptionsFor(klass, painter, cell),
                opaque: true,
            };
            if (painter && typeof painter.fillCanvasBackground === "function") {
                painter.fillCanvasBackground(c, w, h, wOpts);
            } else {
                SkCellClass.fillWidgetBackgroundLocal(c, cell, w, h, wOpts);
            }
        });
    }

    /** Pass 4b — widget ink via painter.paintExportInk (or subclass override). */
    static paintInkAtJsonViewCellFor(klass, ctx, cell, painter) {
        SkCellClass.paintAtJsonViewCell(ctx, cell, (c, _cell, w, h) => {
            if (painter && typeof painter.paintExportInk === "function") {
                painter.paintExportInk(c, w, h);
            }
        });
    }

    static async hydrateCalculableBoolExportPainter(painter, cell, spInterface) {
        const wStoredSync = SkCellClass.readCalculableFromCellJson(cell);
        const wLegacy = SkCellClass.readLegacyCheckedAttribute(cell);
        if (wStoredSync) {
            painter.state.isChecked = SkCellClass.parseCalculableBool(wStoredSync);
            return;
        }
        if (wLegacy !== null) {
            painter.state.isChecked = wLegacy;
            return;
        }
        const wStored = await painter.GetCalculableValue();
        painter.state.isChecked = SkCellClass.parseCalculableBool(wStored);
    }

    /**
     * Wire the three PDF export statics on a cell class.
     * Subclasses implement prototype.paintExportInk; optional exportBackgroundOptions / hydrateExportPainter.
     */
    static installPdfExportStatics(klass, options = {}) {
        klass.loadPaintStateFromCell = async (cell, spInterface) =>
            SkCellClass.loadExportPainter(klass, cell, spInterface, options);
        klass.paintBackgroundAtJsonViewCell = (ctx, cell, painter) =>
            SkCellClass.paintBackgroundAtJsonViewCellFor(klass, ctx, cell, painter);
        klass.paintInkAtJsonViewCell = (ctx, cell, painter) =>
            SkCellClass.paintInkAtJsonViewCellFor(klass, ctx, cell, painter);
        if (typeof options.exportBackgroundOptions === "function") {
            klass.exportBackgroundOptions = options.exportBackgroundOptions;
        }
    }

    /** Paint canvas background from the host cell fill, or clear when unset. */
    fillCanvasBackground(ctx, sWidth, sHeight, sOptions = {}) {
        if (sOptions?.empty === true) {
            ctx.fillStyle = SkCellClass.EMPTY_CHART_PLACEHOLDER_BG;
            ctx.fillRect(0, 0, sWidth, sHeight);
            return;
        }
        const wBg = SkCellClass.readCellBackgroundColor(this.m_Cell);
        if (wBg) {
            ctx.fillStyle = wBg;
            ctx.fillRect(0, 0, sWidth, sHeight);
        } else if (sOptions?.opaque === true) {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, sWidth, sHeight);
        } else {
            ctx.clearRect(0, 0, sWidth, sHeight);
        }
    }

    /** Parse #RGB / #RRGGBB into { r, g, b } or null. */
    static parseCssColorRgb(sColor) {
        const wText = String(sColor || "").trim();
        if (!wText.startsWith("#")) {
            return null;
        }
        let wHex = wText.slice(1);
        if (wHex.length === 3) {
            wHex = wHex
                .split("")
                .map((ch) => ch + ch)
                .join("");
        }
        if (wHex.length !== 6) {
            return null;
        }
        const wNum = Number.parseInt(wHex, 16);
        if (!Number.isFinite(wNum)) {
            return null;
        }
        return {
            r: (wNum >> 16) & 0xff,
            g: (wNum >> 8) & 0xff,
            b: wNum & 0xff,
        };
    }

    /** True when the cell fill reads as a light background (chart ink should be dark). */
    static isLightBackgroundColor(sColor) {
        const wRgb = SkCellClass.parseCssColorRgb(sColor);
        if (!wRgb) {
            return true;
        }
        const wLum = (0.299 * wRgb.r + 0.587 * wRgb.g + 0.114 * wRgb.b) / 255;
        return wLum > 0.62;
    }

    /** Default literal from JsonCellClass model property entry (`d.v`). */
    static readModelPropertyDefault(sModelItem) {
        const wDefault = sModelItem?.d;
        if (!wDefault || wDefault.v == null) {
            return "";
        }
        return SkCellClass.normalizeWasmCellValue(wDefault.v);
    }

    /**
     * Pointer position in canvas logical space (matches updateCanvas after ctx.scale(m_Ratio)).
     * getBoundingClientRect includes ancestor CSS zoom; offsetWidth/Height do not.
     */
    static canvasLogicalPointFromCanvas(sCanvas, sEvent) {
        if (!sCanvas || !sEvent) {
            return { x: 0, y: 0 };
        }
        const wRect = sCanvas.getBoundingClientRect();
        const wLayoutW = sCanvas.offsetWidth || wRect.width || 1;
        const wLayoutH = sCanvas.offsetHeight || wRect.height || 1;
        const wRectW = wRect.width || wLayoutW;
        const wRectH = wRect.height || wLayoutH;
        return {
            x: (sEvent.clientX - wRect.left) * (wLayoutW / wRectW),
            y: (sEvent.clientY - wRect.top) * (wLayoutH / wRectH),
        };
    }

    /** Repaint after layout — canvas offsetWidth/Height are often 0 on first mount. */
    scheduleCanvasUpdate() {
        this.updateCanvas();
        requestAnimationFrame(() => {
            this.updateCanvas();
        });
    }

    async GetProperty(sName) {
        const wApi = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
        if (wApi == null || typeof wApi.getValueAttribute !== "function") {
            return "";
        }
        const wTarget = this.attributeValueRef();
        const wReturn = wApi.getValueAttribute(wTarget.ref, sName, wTarget.sheet);
        console.log("GetProperty " + wTarget.ref + " " + sName + "=" + wReturn);
        return wReturn;
    }

    // tVariant::Json / JsonJavaScript type tag for dates (SkVariant.cpp, "da").
    static VARIANT_JSON_TYPE_DATE = "da";
    // tVariant::Json type tag for booleans (SkVariant.cpp, "b").
    static VARIANT_JSON_TYPE_BOOL = "b";

    // C++ GetValue prints "Null" for t_null — never show that in UI.
    static normalizeWasmCellValue(sValue) {
        if (sValue === null || sValue === undefined) {
            return "";
        }
        const wText = String(sValue);
        if (wText === "Null" || wText === "null") {
            return "";
        }
        if (wText.startsWith("#")) {
            return "";
        }
        return wText;
    }

    // tVariant::Json date wire: tClassDate::UsDate() → MM-DD-YYYY (same as {"t":"da","v":...}).
    static formatVariantDateWire(date) {
        if (!date) return "";
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        const year = date.getFullYear();
        return `${month}-${day}-${year}`;
    }

    static parseVariantDateWire(dateStr) {
        if (!dateStr) return null;
        const wMatch = String(dateStr).trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
        if (!wMatch) return null;
        const month = parseInt(wMatch[1], 10) - 1;
        const day = parseInt(wMatch[2], 10);
        const year = parseInt(wMatch[3], 10);
        const date = new Date(year, month, day);
        if (
            date.getFullYear() === year &&
            date.getMonth() === month &&
            date.getDate() === day
        ) {
            return date;
        }
        return null;
    }

    // Read calculable scalar from JsonView (tCellClassAttribute::Json → t + v keys on c_v.c).
    static readCalculableFromCellJson(sCell) {
        const wClass = sCell?.c_v?.c;
        if (!wClass || typeof wClass !== "object") {
            return "";
        }
        const wType = wClass.t;
        const wVal = wClass.v;
        if (wType === "n" || wVal === null || wVal === undefined) {
            return "";
        }
        if (wType === SkCellClass.VARIANT_JSON_TYPE_DATE) {
            return SkCellClass.normalizeWasmCellValue(String(wVal));
        }
        if (wType === SkCellClass.VARIANT_JSON_TYPE_BOOL) {
            return SkCellClass.formatVariantBoolWire(SkCellClass.parseCalculableBool(wVal));
        }
        if (wType === "s" || wType === "i" || wType === "d") {
            return SkCellClass.normalizeWasmCellValue(String(wVal));
        }
        return "";
    }

    static parseCalculableBool(value) {
        if (value === true || value === "true" || value === "1" || value === 1) {
            return true;
        }
        if (value === false || value === "false" || value === "0" || value === 0) {
            return false;
        }
        return false;
    }

    static formatVariantBoolWire(isChecked) {
        return isChecked ? "true" : "false";
    }

    // Legacy workbooks stored Check/Switch state in a "checked" attribute (0/1).
    static readLegacyCheckedAttribute(sCell) {
        const wAttrs = sCell?.c_v?.c?.a;
        if (!Array.isArray(wAttrs)) {
            return null;
        }
        const wCheckedAttr = wAttrs.find((item) => item?.n === "checked");
        if (!wCheckedAttr || wCheckedAttr.hasOwnProperty("f")) {
            return null;
        }
        return SkCellClass.parseCalculableBool(wCheckedAttr.v);
    }

    static readCalculableVariantType(sCell) {
        return sCell?.c_v?.c?.t || "";
    }

    // Named model property from JsonView c_v.c.a (literal values only — formulas need GetProperty).
    static readPropertyAttrEntry(sCell, sPropertyName) {
        const wAttrs = sCell?.c_v?.c?.a;
        if (!Array.isArray(wAttrs)) {
            return null;
        }
        return wAttrs.find((item) => item?.n === sPropertyName) ?? null;
    }

    static readPropertyFromCellJson(sCell, sPropertyName) {
        const wAttr = SkCellClass.readPropertyAttrEntry(sCell, sPropertyName);
        if (!wAttr || wAttr.hasOwnProperty("f")) {
            return "";
        }
        return SkCellClass.normalizeWasmCellValue(wAttr.v);
    }

    /** Formula or literal range ref stored on a class attribute (no leading "="). */
    static readPropertyRangeRef(sCell, sPropertyName, sHostRow = 0, sHostCol = 0) {
        const wAttr = SkCellClass.readPropertyAttrEntry(sCell, sPropertyName);
        if (!wAttr) {
            return "";
        }
        const wWire = wAttr.hasOwnProperty("f")
            ? wAttr.f
            : SkCellClass.normalizeWasmCellValue(wAttr.v);
        const wBody = String(wWire || "").trim().replace(/^=/, "").trim();
        if (!wBody) {
            return "";
        }
        const wResolved = SkCellClass.resolveRangeRefFromFormulaBody(
            wBody,
            sHostRow,
            sHostCol
        );
        if (wResolved) {
            return wResolved;
        }
        const wFromWire = SkCellClass.extractRangeRefFromAttributeWire(wWire);
        if (wFromWire && !SkCellClass.parseSheetFromRangeRef(wFromWire)) {
            const wSheetFromFormula = SkCellClass.parseSheetFromRangeRef(
                SkCellClass.parseDataRangeFormulaBody(wBody) || wBody
            );
            if (wSheetFromFormula) {
                return `${SkCellClass.formatSheetRangePrefix(wSheetFromFormula)}${wFromWire}`;
            }
        }
        return wFromWire;
    }

    /** Strip "=", optional sheet prefix helpers, and "A=" / "Labels=" style prefixes. */
    static normalizeRangeRefInput(sRaw) {
        let wText = String(sRaw || "").trim().replace(/^=/, "").trim();
        wText = wText.replace(/^[A-Za-z]+\s*=\s*/, "");
        wText = wText.replace(/::+/g, ":");
        return wText.trim();
    }

    /**
     * Coerce a WASM / JsonView scalar to a number.
     * Only integer or double wire values are accepted; anything else returns 0.
     */
    static numericFromScalar(sValue) {
        if (sValue == null) {
            return 0;
        }
        if (typeof sValue === "number") {
            return Number.isFinite(sValue) ? sValue : 0;
        }
        const wText = String(sValue).trim();
        if (
            !wText ||
            wText.startsWith("#") ||
            SkCellClass.looksLikeWasmClassPlaceholder(wText)
        ) {
            return 0;
        }
        if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(wText)) {
            const wDirect = Number(wText);
            return Number.isFinite(wDirect) ? wDirect : 0;
        }
        return 0;
    }

    /** @deprecated Use numericFromScalar — kept for existing call sites. */
    static parseLocalizedNumber(sText) {
        return SkCellClass.numericFromScalar(sText);
    }

    /** Raw numeric magnitude from JsonView when c_t / payload is integer or double only. */
    static numericMagnitudeFromJsonViewCell(sCell) {
        if (!sCell || typeof sCell !== "object") {
            return 0;
        }
        const wType = sCell.c_t;
        if (wType === "i" || wType === "d") {
            return SkCellClass.numericFromScalar(sCell.c_v);
        }
        if (wType === "c" && sCell.c_v && typeof sCell.c_v === "object") {
            const wPayload = sCell.c_v.c ?? sCell.c_v;
            if (wPayload && typeof wPayload === "object") {
                if (wPayload.t === "i" || wPayload.t === "d") {
                    return SkCellClass.numericFromScalar(wPayload.v);
                }
            }
        }
        return 0;
    }

    /** True when wasm GetValue returned a class placeholder instead of a scalar. */
    static looksLikeWasmClassPlaceholder(sText) {
        const wText = String(sText || "").trim();
        return /^\{[^}]+\}$/.test(wText);
    }

    static alphaToBase10Sync(sLetters) {
        return SkA1Ref.alphaToBase10Sync(sLetters);
    }

    static unquoteSheetName(sName) {
        let wText = String(sName || "").trim();
        if (wText.length >= 2 && wText.startsWith("'") && wText.endsWith("'")) {
            wText = wText.slice(1, -1);
        }
        return wText;
    }

    static sheetNameNeedsQuotes(sSheetName) {
        const wName = String(sSheetName || "");
        if (!wName) {
            return false;
        }
        return !/^[A-Za-z0-9_]+$/.test(wName);
    }

    static formatSheetRangePrefix(sSheetName) {
        const wName = SkCellClass.unquoteSheetName(sSheetName);
        if (!wName) {
            return "";
        }
        if (SkCellClass.sheetNameNeedsQuotes(wName)) {
            return `'${wName}'!`;
        }
        return `${wName}!`;
    }

    /** Index of sheet/cell separator outside quoted sheet names. */
    static findSheetRangeSeparator(sText) {
        const wText = String(sText || "");
        let wInQuote = false;
        for (let wIdx = 0; wIdx < wText.length; wIdx++) {
            if (wText[wIdx] === "'") {
                wInQuote = !wInQuote;
            } else if (wText[wIdx] === "!" && !wInQuote) {
                return wIdx;
            }
        }
        return -1;
    }

    static stripSheetPrefixFromRangeRef(sRef) {
        const wText = String(sRef || "").trim();
        const wSep = SkCellClass.findSheetRangeSeparator(wText);
        if (wSep < 0) {
            return wText;
        }
        return wText.substring(wSep + 1).trim();
    }

    /** Split union refs without breaking commas inside 'Sheet, Name'. */
    static splitRangeUnionAreas(sText) {
        const wAreas = [];
        let wPart = "";
        let wInQuote = false;
        const wText = String(sText || "");
        for (let wIdx = 0; wIdx <= wText.length; wIdx++) {
            const wCh = wIdx < wText.length ? wText[wIdx] : ",";
            if (wCh === "'") {
                wInQuote = !wInQuote;
            }
            if ((wCh === "," || wCh === ";") && !wInQuote) {
                const wTrim = wPart.trim();
                if (wTrim) {
                    wAreas.push(wTrim);
                }
                wPart = "";
            } else {
                wPart += wCh;
            }
        }
        return wAreas;
    }

    static parseA1CellRef(sRef) {
        return SkA1Ref.parseCellRefSync(sRef);
    }

    /** Parse "A1", "A1:B10", or "Sheet1!A1:B10" into inclusive 1-based bounds. */
    static parseA1RangeBounds(sRangeRef) {
        const wText = SkCellClass.normalizeRangeRefInput(sRangeRef);
        if (!wText) {
            return null;
        }
        return SkA1Ref.parseRangeBoundsSync(wText);
    }

    static cellRefFromRowCol(sRow, sCol) {
        return SkA1Ref.cellRefFromRowCol(sRow, sCol);
    }

    static looksLikeR1C1RangeRef(sRangeRef) {
        return /R(\[|-?\d)/i.test(String(sRangeRef || ""));
    }

    /** Resolve one R1C1 cell token against the attribute host (Excel-style relative brackets). */
    static parseR1C1CellRef(sCellRef, sHostRow, sHostCol) {
        const wText = SkCellClass.stripSheetPrefixFromRangeRef(sCellRef);
        const wMatch = wText.match(
            /^R(\[(-?\d+)\]|(-?\d+))?C(\[(-?\d+)\]|(-?\d+))?$/i
        );
        if (!wMatch || !Number.isFinite(sHostRow) || !Number.isFinite(sHostCol)) {
            return null;
        }
        let wRow = sHostRow;
        if (wMatch[2] != null) {
            wRow = sHostRow + Number(wMatch[2]);
        } else if (wMatch[3] != null) {
            wRow = Number(wMatch[3]);
        }
        let wCol = sHostCol;
        if (wMatch[5] != null) {
            wCol = sHostCol + Number(wMatch[5]);
        } else if (wMatch[6] != null) {
            wCol = Number(wMatch[6]);
        }
        if (!Number.isFinite(wRow) || !Number.isFinite(wCol) || wRow < 1 || wCol < 1) {
            return null;
        }
        return { row: wRow, col: wCol };
    }

    /** Convert R1C1 range notation stored on floating hosts into A1 for chart reads. */
    static convertR1C1RangeRefToA1(sRangeRef, sHostRow, sHostCol) {
        const wSheet = SkCellClass.parseSheetFromRangeRef(sRangeRef) || "";
        const wBody = SkCellClass.stripSheetPrefixFromRangeRef(sRangeRef);
        if (!wBody || !SkCellClass.looksLikeR1C1RangeRef(wBody)) {
            return SkCellClass.normalizeRangeRefInput(sRangeRef);
        }
        const wConvertOne = (sPart) => {
            const wParsed = SkCellClass.parseR1C1CellRef(sPart, sHostRow, sHostCol);
            if (!wParsed) {
                return "";
            }
            return SkCellClass.cellRefFromRowCol(wParsed.row, wParsed.col);
        };
        const wColon = wBody.indexOf(":");
        let wRange = "";
        if (wColon < 0) {
            wRange = wConvertOne(wBody);
        } else {
            const wStart = wConvertOne(wBody.slice(0, wColon));
            const wEnd = wConvertOne(wBody.slice(wColon + 1));
            wRange = wStart && wEnd ? `${wStart}:${wEnd}` : "";
        }
        if (!wRange) {
            return "";
        }
        return wSheet ? `${SkCellClass.formatSheetRangePrefix(wSheet)}${wRange}` : wRange;
    }

    static qualifyRangeRefWithSheetFromFormula(sRangeRef, sFormulaBody, sDefaultSheet = "") {
        let wRef = String(sRangeRef || "").trim();
        if (!wRef) {
            return "";
        }
        if (!SkCellClass.parseSheetFromRangeRef(wRef)) {
            const wInner = SkCellClass.parseDataRangeFormulaBody(sFormulaBody);
            const wSheetFromFormula = SkCellClass.parseSheetFromRangeRef(wInner || sFormulaBody);
            if (wSheetFromFormula) {
                wRef = `${SkCellClass.formatSheetRangePrefix(wSheetFromFormula)}${wRef}`;
            }
        }
        return SkCellClass.qualifyRangeRefWithSheet(wRef, sDefaultSheet);
    }

    static resolveRangeRefFromFormulaBody(sFormulaBody, sHostRow = 0, sHostCol = 0) {
        const wBody = String(sFormulaBody || "").trim();
        if (!wBody) {
            return "";
        }
        if (wBody.startsWith("[")) {
            return SkCellClass.rangeRefFromDataRangeEval(wBody);
        }
        const wInner = SkCellClass.parseDataRangeFormulaBody(wBody);
        const wRangeBody = wInner !== "" ? wInner : wBody;
        const wFirstArg = (SkCellClass.splitRangeUnionAreas(wRangeBody)[0] || "").trim();
        let wNorm = SkCellClass.normalizeRangeRefInput(wFirstArg);
        if (
            wNorm &&
            !SkCellClass.parseA1RangeBounds(wNorm) &&
            Number.isFinite(sHostRow) &&
            sHostRow > 0 &&
            Number.isFinite(sHostCol) &&
            sHostCol > 0 &&
            SkCellClass.looksLikeR1C1RangeRef(wNorm)
        ) {
            wNorm = SkCellClass.convertR1C1RangeRefToA1(wNorm, sHostRow, sHostCol);
        }
        if (wNorm && SkCellClass.parseA1RangeBounds(wNorm)) {
            if (!SkCellClass.parseSheetFromRangeRef(wNorm)) {
                const wSheetFromFormula = SkCellClass.parseSheetFromRangeRef(wRangeBody);
                if (wSheetFromFormula) {
                    wNorm = `${SkCellClass.formatSheetRangePrefix(wSheetFromFormula)}${wNorm}`;
                }
            }
            return wNorm;
        }
        return SkCellClass.rangeRefFromDataRangeEval(wBody);
    }

    /** Extract sheet name from "Sheet1!A1:B2" (empty when unqualified). */
    static parseSheetFromRangeRef(sRangeRef) {
        const wText = SkCellClass.normalizeRangeRefInput(sRangeRef);
        if (!wText) {
            return "";
        }
        const wBang = SkCellClass.findSheetRangeSeparator(wText);
        if (wBang < 0) {
            return "";
        }
        return SkCellClass.unquoteSheetName(wText.substring(0, wBang).trim());
    }

    /** Prefix unqualified refs with the data sheet (floating host lives on _$$A). */
    static qualifyRangeRefWithSheet(sRangeRef, sSheet) {
        const wText = SkCellClass.normalizeRangeRefInput(sRangeRef);
        const wSheet = typeof sSheet === "string" ? sSheet.trim() : "";
        if (!wText || !wSheet || wText.includes("!")) {
            return wText;
        }
        return `${wSheet}!${wText}`;
    }

    /** Resolve sheet + default for reading range-backed chart attributes. */
    static resolveRangeReadSheet(sRangeRef, sSheet = "", sDefaultSheet = "", sSpInterface = null) {
        const wExplicit = typeof sSheet === "string" ? sSheet.trim() : "";
        if (wExplicit) {
            return wExplicit;
        }
        const wFromRef = SkCellClass.parseSheetFromRangeRef(sRangeRef);
        if (wFromRef) {
            return wFromRef;
        }
        const wDefault = typeof sDefaultSheet === "string" ? sDefaultSheet.trim() : "";
        if (wDefault) {
            return wDefault;
        }
        if (sSpInterface?.m_UIView?.sheet) {
            return sSpInterface.m_UIView.sheet;
        }
        return "";
    }

    /** Scalar display from JsonView when wasm GetValue returns empty (in-viewport cells). */
    static readJsonViewCellScalar(sSpInterface, sRow, sCol, sSheet) {
        if (sSpInterface == null || typeof sSpInterface.getJsonViewCellAt !== "function") {
            return "";
        }
        if (sSheet && sSpInterface.m_UIView?.sheet && sSpInterface.m_UIView.sheet !== sSheet) {
            return "";
        }
        const wCell = sSpInterface.getJsonViewCellAt(sRow, sCol);
        if (wCell == null) {
            return "";
        }
        const wType = wCell.c_t;
        const wVal = wCell.c_v;
        if (wVal == null || wType === "n" || wType === "c") {
            return "";
        }
        if (wType === "i" || wType === "d" || wType === "s" || wType === "da" || wType === "b") {
            return SkCellClass.normalizeWasmCellValue(wVal);
        }
        if (wType === "c" && wVal && typeof wVal === "object") {
            const wClassName = typeof wVal.n === "string" ? wVal.n.trim() : "";
            if (
                wClassName === "tCellUnit" ||
                wClassName === "SkCellClassUnit" ||
                wClassName === "tCellClassUnit"
            ) {
                const wNum = SkCellClass.numericMagnitudeFromJsonViewCell(wCell);
                if (Number.isFinite(wNum)) {
                    return String(wNum);
                }
            }
        }
        return "";
    }

    /** True when text looks like an A1 range ref (not inline JSON). */
    static looksLikeA1RangeRef(sText) {
        const wNorm = SkCellClass.normalizeRangeRefInput(sText);
        return wNorm !== "" && SkCellClass.parseA1RangeBounds(wNorm) != null;
    }

    /** True when chartData/chartOptions literal is JSON object or array text. */
    static looksLikeJsonPayload(sText) {
        const wTrim = String(sText || "").trim();
        return wTrim.startsWith("[") || wTrim.startsWith("{");
    }

    /** Build Sheet!A1 host ref for floating-object attribute evaluation. */
    static buildHostCellRef(sHostSheet, sHostRow, sHostCol) {
        const wSheet = typeof sHostSheet === "string" ? sHostSheet.trim() : "";
        const wRow = Number(sHostRow);
        const wCol = Number(sHostCol);
        if (!wSheet || !Number.isFinite(wRow) || wRow < 1 || !Number.isFinite(wCol) || wCol < 1) {
            return "";
        }
        const wCell = SkCellClass.cellRefFromRowCol(wRow, wCol);
        return wCell ? `${wSheet}!${wCell}` : "";
    }

    /** Semantic kind on tModelProperty (JsonCellClass p[].k) — not a tVariant type. */
    static PROPERTY_KIND_RANGE = "range";
    static PROPERTY_KIND_ENUM_PREFIX = "enum:";

    static propertyKindFromSchemaItem(sItem) {
        return typeof sItem?.k === "string" ? sItem.k.trim() : "";
    }

    static isEnumPropertyKind(sKind) {
        return String(sKind || "").trim().startsWith(SkCellClass.PROPERTY_KIND_ENUM_PREFIX);
    }

    static enumChoicesFromKind(sKind) {
        const wKind = String(sKind || "").trim();
        if (!wKind.startsWith(SkCellClass.PROPERTY_KIND_ENUM_PREFIX)) {
            return [];
        }
        const wBody = wKind.slice(SkCellClass.PROPERTY_KIND_ENUM_PREFIX.length);
        if (!wBody) {
            return [];
        }
        return wBody
            .split(",")
            .map((wPart) => wPart.trim())
            .filter((wPart) => wPart.length > 0);
    }

    static coerceEnumAttributeValue(sValue, sKind) {
        const wChoices = SkCellClass.enumChoicesFromKind(sKind);
        if (wChoices.length === 0) {
            return sValue != null ? String(sValue) : "";
        }
        const wText = String(sValue ?? "").trim();
        if (wChoices.includes(wText)) {
            return wText;
        }
        return wChoices[0];
    }

    static isRangePropertyKind(sKind) {
        return String(sKind || "").trim() === SkCellClass.PROPERTY_KIND_RANGE;
    }

    static isRangeProperty(sPropertyKindOrSchemaItem) {
        if (sPropertyKindOrSchemaItem != null && typeof sPropertyKindOrSchemaItem === "object") {
            return SkCellClass.isRangePropertyKind(
                SkCellClass.propertyKindFromSchemaItem(sPropertyKindOrSchemaItem),
            );
        }
        return SkCellClass.isRangePropertyKind(sPropertyKindOrSchemaItem);
    }

    static parseDataRangeFormulaBody(sFormulaBody) {
        const wText = String(sFormulaBody || "").trim();
        const wMatch = wText.match(/^DATARANGE\s*\(([\s\S]*)\)\s*$/i);
        return wMatch ? wMatch[1].trim() : "";
    }

    static looksLikeFloatingRangeAttributeInput(sUserText, sPropertyKind = "") {
        if (!SkCellClass.isRangePropertyKind(sPropertyKind)) {
            return false;
        }
        const wTrim = String(sUserText || "").trim();
        if (!wTrim || SkCellClass.looksLikeJsonPayload(wTrim)) {
            return false;
        }
        const wBody = SkCellClass.normalizeRangeRefInput(wTrim);
        if (!wBody) {
            return false;
        }
        if (/^DATARANGE\s*\(/i.test(wBody)) {
            return true;
        }
        if (SkCellClass.looksLikeA1RangeRef(wBody)) {
            return true;
        }
        return SkCellClass.splitRangeUnionAreas(wBody).some((wPart) =>
            SkCellClass.looksLikeA1RangeRef(wPart.trim())
        );
    }

    /**
     * Client-side validation before committing a range attribute.
     * @returns {{ ok: true } | { ok: false, message: string }}
     */
    static validateRangeAttributeValue(sUserText, sPropertyKind = "", sPropertyName = "") {
        if (!SkCellClass.isRangePropertyKind(sPropertyKind)) {
            return { ok: true };
        }
        const wTrim = String(sUserText || "").trim();
        if (!wTrim || SkCellClass.looksLikeJsonPayload(wTrim)) {
            return { ok: true };
        }

        const wBody = SkCellClass.normalizeRangeRefInput(wTrim);
        if (!wBody) {
            return { ok: true };
        }

        const wLabel = sPropertyName ? String(sPropertyName) : "Plage";
        const wFail = (sDetail) => ({
            ok: false,
            message: `${wLabel} : plage invalide (${sDetail})`,
        });

        const wSplitParts = (sInner) => SkCellClass.splitRangeUnionAreas(String(sInner || ""));

        if (/^DATARANGE\s*\(/i.test(wBody)) {
            const wInner = SkCellClass.parseDataRangeFormulaBody(wBody);
            const wParts = wSplitParts(wInner);
            if (wParts.length === 0) {
                return wFail(wTrim);
            }
            for (const wPart of wParts) {
                if (!SkCellClass.looksLikeA1RangeRef(wPart)) {
                    return wFail(wPart);
                }
            }
            return { ok: true };
        }

        const wParts = wSplitParts(wBody);
        const wCandidates = wParts.length > 0 ? wParts : [wBody];
        for (const wPart of wCandidates) {
            if (!SkCellClass.looksLikeA1RangeRef(wPart)) {
                return wFail(wTrim);
            }
        }
        return { ok: true };
    }

    /** Non-range formula on floating host (_$$A): =J4 must become =Sheet1!J4 at commit. */
    static looksLikeFloatingFormulaAttributeInput(sUserText, sPropertyKind = "") {
        if (SkCellClass.isRangePropertyKind(sPropertyKind)) {
            return false;
        }
        const wTrim = String(sUserText || "").trim();
        if (wTrim.startsWith("=")) {
            return true;
        }
        // Panel / wasm may surface formula bodies without leading "=" (e.g. JSON(A1:A3)).
        return SkCellClass.looksLikeJsonOptionsFormulaBody(wTrim);
    }

    /** True when text is a JSON(...) options formula body, with or without leading "=". */
    static looksLikeJsonOptionsFormulaBody(sText) {
        const wTrim = String(sText || "").trim().replace(/^=/, "").trim();
        return /^JSON\s*\(/i.test(wTrim);
    }

    /**
     * Normalize comboOptions / scalar JSON(...) attribute input before wasm commit.
     * Ensures a single leading "=" so CellValue() treats it as a formula.
     */
    static normalizeJsonOptionsAttributeInput(sUserText) {
        const wTrim = String(sUserText || "").trim();
        if (!wTrim) {
            return wTrim;
        }
        if (SkCellClass.looksLikeJsonPayload(wTrim)) {
            return wTrim;
        }
        if (SkCellClass.looksLikeJsonOptionsFormulaBody(wTrim)) {
            const wBody = wTrim.replace(/^=/, "").trim();
            return `=${wBody}`;
        }
        return wTrim;
    }

    /** Bare A9 / Sheet1!A9 typed in a scalar attribute field (not a range). */
    static looksLikeScalarCellRefInput(sText) {
        const wTrim = String(sText || "").trim();
        if (!wTrim || wTrim.startsWith("=")) {
            return false;
        }
        const wParts = SkCellClass.splitHostAttributeRef(wTrim, "");
        const wRef = wParts.ref || wTrim;
        const wBounds = SkCellClass.parseA1RangeBounds(wRef);
        return (
            wBounds != null &&
            wBounds.left === wBounds.right &&
            wBounds.top === wBounds.bottom
        );
    }

    /** Anchored class attrs: bare A9 → =A9 before valueAttribute. */
    static normalizeScalarAttributeInput(sUserText, sPropertyKind = "") {
        if (SkCellClass.isRangePropertyKind(sPropertyKind)) {
            return String(sUserText || "");
        }
        const wTrim = String(sUserText || "").trim();
        if (!wTrim || wTrim.startsWith("=")) {
            return wTrim;
        }
        if (SkCellClass.looksLikeScalarCellRefInput(wTrim)) {
            return `=${wTrim}`;
        }
        return wTrim;
    }

    static async encodeFloatingFormulaAttributeValue(sUserText, sTargetSheet) {
        const wTargetSheet = typeof sTargetSheet === "string" ? sTargetSheet.trim() : "";
        const wText = String(sUserText || "").trim();
        if (!wText || !wTargetSheet || !wText.startsWith("=")) {
            return wText;
        }
        const wApi = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
        if (wApi != null && typeof wApi.qualifyRefsForSheet === "function") {
            const wQualified = wApi.qualifyRefsForSheet(wTargetSheet, wText);
            return wQualified.startsWith("=") ? wQualified : `=${wQualified}`;
        }
        return wText;
    }

    /** Panel display: Sheet1!J4 → =J4 (refs on target sheet, attribute cell on _$$A). */
    static async decodeFloatingFormulaAttributeValue(sFormulaBody, sTargetSheet) {
        const wTargetSheet = typeof sTargetSheet === "string" ? sTargetSheet.trim() : "";
        let wBody = String(sFormulaBody || "").trim();
        if (!wBody) {
            return "";
        }
        if (!wBody.startsWith("=")) {
            wBody = `=${wBody}`;
        }
        const wApi = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
        if (wTargetSheet && wApi != null && typeof wApi.stripTargetSheetFromRefs === "function") {
            const wInner = wBody.slice(1).trim();
            const wStripped = wApi.stripTargetSheetFromRefs(wTargetSheet, wInner);
            const wNorm = String(wStripped || wInner).trim();
            return wNorm.startsWith("=") ? wNorm : `=${wNorm}`;
        }
        return wBody;
    }

    /**
     * Evaluate a simple cell-ref formula on a floating host (=A9 / =Sheet1!A9).
     * GetValueAttribute may leave Value() empty for cross-sheet refs on _$$A; read the target cell directly.
     */
    static async resolveScalarFromAttributeFormula(sCell, sFormulaBody) {
        let wBody = String(sFormulaBody || "").trim().replace(/^=/, "").trim();
        if (!wBody || /^DATARANGE\s*\(/i.test(wBody) || wBody.includes("(")) {
            return "";
        }
        const wCtx = SkCellClass.buildRangeReadContext(sCell, null);
        const wTargetSheet =
            (typeof sCell?.c_foMeta?.targetSheet === "string" && sCell.c_foMeta.targetSheet.trim()) ||
            wCtx.defaultSheet ||
            "";
        const wQualified = wBody.includes("!")
            ? wBody
            : wTargetSheet
              ? `${wTargetSheet}!${wBody}`
              : wBody;
        const wParts = SkCellClass.splitHostAttributeRef(wQualified, wTargetSheet);
        if (!wParts.ref) {
            return "";
        }
        const wBounds = SkCellClass.parseA1RangeBounds(wParts.ref);
        if (
            !wBounds ||
            wBounds.left !== wBounds.right ||
            wBounds.top !== wBounds.bottom
        ) {
            return "";
        }
        const wApi = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
        if (wApi == null || typeof wApi.getInputvalue !== "function") {
            return "";
        }
        return SkCellClass.normalizeWasmCellValue(
            wApi.getInputvalue(wParts.ref, wParts.sheet),
        );
    }

    /** Live formula attr for floating panel (Title, etc.) — not DATARANGE ranges. */
    static async resolveLiveFormulaAttributeDisplayValue(
        sHostRef,
        sPropertyName,
        sHostSheet,
        sTargetSheet,
        sFallbackAttr = null,
    ) {
        const wFormulaBody = await SkCellClass.resolveLiveAttributeFormulaBody(
            sHostRef,
            sPropertyName,
            sHostSheet,
            sFallbackAttr,
        );
        if (wFormulaBody) {
            return SkCellClass.decodeFloatingFormulaAttributeValue(wFormulaBody, sTargetSheet);
        }
        if (sFallbackAttr != null && !sFallbackAttr.hasOwnProperty("f")) {
            return sFallbackAttr.v != null ? String(sFallbackAttr.v) : "";
        }
        return "";
    }

    /**
     * Normalize one range token to A1 for the attribute panel.
     * Relative R1C1 (R[n]C[m]) is resolved against the attribute host cell.
     * The engine accepts Sheet1!R[n]C[m]; we still coerce to A1 for a stable UI wire.
     */
    static coerceRangeTokenToA1(sRangeToken, sHostRow = 0, sHostCol = 0) {
        const wToken = String(sRangeToken || "").trim();
        if (!wToken) {
            return "";
        }
        if (SkCellClass.looksLikeA1RangeRef(wToken)) {
            return SkCellClass.normalizeRangeRefInput(wToken);
        }
        if (
            SkCellClass.looksLikeR1C1RangeRef(wToken) &&
            Number.isFinite(sHostRow) &&
            sHostRow > 0 &&
            Number.isFinite(sHostCol) &&
            sHostCol > 0
        ) {
            return SkCellClass.convertR1C1RangeRefToA1(wToken, sHostRow, sHostCol);
        }
        return wToken;
    }

    /** Floating save: =A1:A10 → =Sheet1!A1:A10; multi-ref → =DATARANGE(Sheet1!A1,Sheet1!B1). */
    static async encodeFloatingRangeAttributeValue(
        sUserText,
        sTargetSheet,
        sHostRow = 0,
        sHostCol = 0,
    ) {
        const wTargetSheet = typeof sTargetSheet === "string" ? sTargetSheet.trim() : "";
        const wText = String(sUserText || "").trim();
        if (!wText || !wTargetSheet) {
            return wText;
        }

        const wApi = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
        const wQualify =
            wApi != null && typeof wApi.qualifyRefsForSheet === "function"
                ? (sBody) => wApi.qualifyRefsForSheet(wTargetSheet, sBody)
                : async (sBody) => SkCellClass.qualifyRangeRefWithSheet(sBody, wTargetSheet);

        const wHasEq = wText.startsWith("=");
        const wBody = wHasEq ? wText.slice(1).trim() : wText;

        const wAsQualifiedFormula = async (sRefBody) => {
            const wTrim = String(sRefBody || "").trim();
            if (!wTrim) {
                return wText;
            }
            const wQualified = await wQualify(wTrim.startsWith("=") ? wTrim : `=${wTrim}`);
            return wQualified.startsWith("=") ? wQualified : `=${wQualified}`;
        };

        const wSplitRangeParts = (sInner) =>
            String(sInner || "")
                .split(/[,;]/)
                .map((wPart) => wPart.trim())
                .filter(Boolean);

        const wToA1 = (sPart) =>
            SkCellClass.coerceRangeTokenToA1(sPart, sHostRow, sHostCol);

        if (/^DATARANGE\s*\(/i.test(wBody)) {
            const wInner = SkCellClass.parseDataRangeFormulaBody(wBody);
            const wParts = wSplitRangeParts(wInner).map(wToA1).filter(Boolean);
            if (wParts.length <= 1) {
                const wRef = String(wParts[0] || wToA1(wInner)).trim();
                if (SkCellClass.looksLikeA1RangeRef(wRef)) {
                    return wAsQualifiedFormula(`DATARANGE(${wRef})`);
                }
                return wAsQualifiedFormula(wRef);
            }
            return wAsQualifiedFormula(`DATARANGE(${wParts.join(",")})`);
        }

        const wParts = wSplitRangeParts(wBody).map(wToA1).filter(Boolean);
        if (wParts.length <= 1) {
            const wRef = String(wParts[0] || wToA1(wBody)).trim();
            if (SkCellClass.looksLikeA1RangeRef(wRef)) {
                return wAsQualifiedFormula(`DATARANGE(${wRef})`);
            }
            return wAsQualifiedFormula(wRef);
        }

        const wQualifiedBody = await wQualify(wParts.join(","));
        return `=DATARANGE(${wQualifiedBody})`;
    }

    /**
     * Live formula body from the host attribute cell (rebased after insert/delete).
     * Falls back to JsonView snapshot or a stored "=DATARANGE(...)" literal value.
     */
    static async resolveLiveAttributeFormulaBody(
        sHostRef,
        sPropertyName,
        sHostSheet,
        sFallbackAttr = null,
    ) {
        const wHostRef = typeof sHostRef === "string" ? sHostRef.trim() : "";
        const wHostSheet = typeof sHostSheet === "string" ? sHostSheet.trim() : "";
        const wApi = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
        const wWasmTarget = SkCellClass.splitHostAttributeRef(wHostRef, wHostSheet);
        if (wWasmTarget.ref && wApi != null && typeof wApi.getFormulaAttribute === "function") {
            const wLive = String(
                wApi.getFormulaAttribute(
                    wWasmTarget.ref,
                    sPropertyName,
                    wWasmTarget.sheet,
                ),
            ).trim();
            if (wLive) {
                return wLive;
            }
        }
        if (sFallbackAttr != null && sFallbackAttr.hasOwnProperty("f")) {
            const wSnapshot = sFallbackAttr.f != null ? String(sFallbackAttr.f).trim() : "";
            if (wSnapshot) {
                return wSnapshot;
            }
        }
        if (sFallbackAttr?.v != null) {
            const wRawV = String(sFallbackAttr.v).trim();
            if (wRawV.startsWith("=")) {
                const wBody = wRawV.slice(1).trim();
                if (wBody) {
                    return wBody;
                }
            }
        }
        return "";
    }

    /** Panel display for range attrs: live rebased formula decoded for the target sheet. */
    static async resolveLiveRangeAttributeDisplayValue(
        sHostRef,
        sPropertyName,
        sHostSheet,
        sTargetSheet,
        sFallbackAttr = null,
    ) {
        const wFormulaBody = await SkCellClass.resolveLiveAttributeFormulaBody(
            sHostRef,
            sPropertyName,
            sHostSheet,
            sFallbackAttr,
        );
        if (!wFormulaBody) {
            return "";
        }
        const wHost = SkCellClass.splitHostAttributeRef(sHostRef, sHostSheet);
        const wHostRc = SkCellClass.parseA1CellRef(wHost.ref);
        return SkCellClass.decodeFloatingRangeAttributeValue(
            wFormulaBody,
            sTargetSheet,
            wHostRc?.row || 0,
            wHostRc?.col || 0,
        );
    }

    /** Floating display: DATARANGE(Sheet1!A1:A10) → A1:A10 (no leading "=" — range attrs are not formulas). */
    static async decodeFloatingRangeAttributeValue(
        sFormulaBody,
        sTargetSheet,
        sHostRow = 0,
        sHostCol = 0,
    ) {
        const wTargetSheet = typeof sTargetSheet === "string" ? sTargetSheet.trim() : "";
        const wBody = String(sFormulaBody || "").trim();
        if (!wBody) {
            return "";
        }

        const wApi = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
        const wStrip =
            wTargetSheet && wApi != null && typeof wApi.stripTargetSheetFromRefs === "function"
                ? (sText) => wApi.stripTargetSheetFromRefs(wTargetSheet, sText)
                : async (sText) => sText;

        const wNormalizeDisplay = (sText) => {
            const wNorm = SkCellClass.normalizeRangeRefInput(sText);
            if (SkCellClass.looksLikeA1RangeRef(wNorm)) {
                return wNorm;
            }
            // Host-relative R1C1 from FormulaStr(true) / paste — show A1 in the panel.
            const wA1 = SkCellClass.coerceRangeTokenToA1(wNorm, sHostRow, sHostCol);
            return SkCellClass.looksLikeA1RangeRef(wA1)
                ? SkCellClass.normalizeRangeRefInput(wA1)
                : wNorm;
        };

        const wInner = SkCellClass.parseDataRangeFormulaBody(wBody);
        if (wInner !== "") {
            const wStripped = await wStrip(wInner);
            const wParts = SkCellClass.splitRangeUnionAreas(String(wStripped || ""))
                .map((wPart) => wNormalizeDisplay(wPart))
                .filter(Boolean);
            if (wParts.length > 1) {
                return wParts.join(",");
            }
            return wNormalizeDisplay(wStripped);
        }

        const wStripped = await wStrip(wBody);
        return wNormalizeDisplay(wStripped);
    }

    /** First A1 ref from a DATARANGE JSON eval result or formula body. */
    static rangeRefFromDataRangeEval(sEvalText) {
        const wTrim = String(sEvalText || "").trim();
        if (!wTrim || wTrim.startsWith("#")) {
            return "";
        }
        if (wTrim.startsWith("[")) {
            try {
                const wRefs = JSON.parse(wTrim);
                if (Array.isArray(wRefs) && wRefs.length > 0) {
                    const wFirst = SkCellClass.normalizeRangeRefInput(String(wRefs[0]));
                    if (wFirst && SkCellClass.parseA1RangeBounds(wFirst)) {
                        return wFirst;
                    }
                }
            } catch (_error) {
                return "";
            }
        }
        const wInner = SkCellClass.parseDataRangeFormulaBody(wTrim);
        if (wInner !== "") {
            const wFirstArg = (SkCellClass.splitRangeUnionAreas(wInner)[0] || "").trim();
            const wNorm = SkCellClass.normalizeRangeRefInput(wFirstArg);
            if (wNorm && SkCellClass.parseA1RangeBounds(wNorm)) {
                if (!SkCellClass.parseSheetFromRangeRef(wNorm)) {
                    const wSheetFromFormula = SkCellClass.parseSheetFromRangeRef(wInner);
                    if (wSheetFromFormula) {
                        return `${SkCellClass.formatSheetRangePrefix(wSheetFromFormula)}${wNorm}`;
                    }
                }
                return wNorm;
            }
        }
        const wResolved = SkCellClass.normalizeRangeRefInput(wTrim);
        if (wResolved && SkCellClass.parseA1RangeBounds(wResolved)) {
            return wResolved;
        }
        return "";
    }

    /**
     * Literal or formula range ref from c_v.c.a (formula attrs evaluated on host when known).
     * @param {object} sCell JsonView-shaped cell
     * @param {string} sPropertyName attribute name
     * @param {{ hostRef?: string, hostSheet?: string, defaultSheet?: string }} [sOptions]
     */
    static _preserveActiveSheetChain = Promise.resolve();

    /**
     * Wasm GetValue / GetValueAttribute call SetSheet and leave ActiveSheet changed.
     * Serialize cross-sheet reads and restore the user's sheet so tabs/JsonView stay aligned.
     */
    static async runWithPreservedActiveSheet(sTask) {
        const wRun = async () => {
            const wApi = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
            const wSp =
                typeof window !== "undefined" ? window.SkSpreadSheet?.m_SpInterface : null;
            let wPrevSheet = "";
            // Prefer UI sheet — WASM may already be on _$$A after a prior attribute read.
            if (wSp?.m_UIView?.sheet && !wSp.isSystemSheetName?.(wSp.m_UIView.sheet)) {
                wPrevSheet = wSp.m_UIView.sheet;
            } else if (wApi != null && typeof wApi.getActiveSheet === "function") {
                try {
                    wPrevSheet = wApi.getActiveSheet();
                } catch (_error) {
                    wPrevSheet = "";
                }
            }
            if (wSp?.isSystemSheetName?.(wPrevSheet)) {
                wPrevSheet = "";
            }
            try {
                return await sTask();
            } finally {
                if (
                    wPrevSheet &&
                    wApi != null &&
                    typeof wApi.setActiveSheet === "function"
                ) {
                    try {
                        const wNow = wApi.getActiveSheet();
                        if (wNow !== wPrevSheet) {
                            wApi.setActiveSheet(wPrevSheet);
                        }
                    } catch (_error) {
                        /* best effort */
                    }
                }
            }
        };
        const wQueued = SkCellClass._preserveActiveSheetChain.then(wRun, wRun);
        SkCellClass._preserveActiveSheetChain = wQueued.catch(() => {});
        return wQueued;
    }

    static async resolvePropertyRangeRef(sCell, sPropertyName, sOptions = {}) {
        const wAttr = SkCellClass.readPropertyAttrEntry(sCell, sPropertyName);
        if (!wAttr) {
            return "";
        }
        const wDefaultSheet =
            typeof sOptions.defaultSheet === "string" ? sOptions.defaultSheet.trim() : "";
        const wHostRef = typeof sOptions.hostRef === "string" ? sOptions.hostRef.trim() : "";
        const wHostSheet = typeof sOptions.hostSheet === "string" ? sOptions.hostSheet.trim() : "";
        const wApi = typeof window !== "undefined" ? window.SkUISpreadSheet : null;

        const wWasmTarget = SkCellClass.splitHostAttributeRef(wHostRef, wHostSheet);
        const wHostRc = SkCellClass.parseA1CellRef(wWasmTarget.ref);

        // Prefer live rebased formula on the host attribute (survives insert/delete rows/cols).
        if (wHostRef && wApi != null) {
            const wFromWasm = await SkCellClass.runWithPreservedActiveSheet(async () => {
                const wFormulaBody = await SkCellClass.resolveLiveAttributeFormulaBody(
                    wHostRef,
                    sPropertyName,
                    wHostSheet,
                    wAttr,
                );
                if (wFormulaBody) {
                    const wFromFormula = SkCellClass.resolveRangeRefFromFormulaBody(
                        wFormulaBody,
                        wHostRc?.row ?? 0,
                        wHostRc?.col ?? 0
                    );
                    if (wFromFormula) {
                        return SkCellClass.qualifyRangeRefWithSheetFromFormula(
                            wFromFormula,
                            wFormulaBody,
                            wDefaultSheet
                        );
                    }
                }

                if (typeof wApi.getValueAttribute === "function") {
                    const wEval = SkCellClass.normalizeWasmCellValue(
                        wApi.getValueAttribute(
                            wWasmTarget.ref,
                            sPropertyName,
                            wWasmTarget.sheet,
                        ),
                    );
                    if (wEval && !wEval.startsWith("#")) {
                        const wFromDataRange = SkCellClass.rangeRefFromDataRangeEval(wEval);
                        if (wFromDataRange) {
                            return SkCellClass.qualifyRangeRefWithSheetFromFormula(
                                wFromDataRange,
                                wFormulaBody || "",
                                wDefaultSheet
                            );
                        }
                        const wResolved = SkCellClass.normalizeRangeRefInput(wEval);
                        if (wResolved && SkCellClass.parseA1RangeBounds(wResolved)) {
                            return SkCellClass.qualifyRangeRefWithSheetFromFormula(
                                wResolved,
                                wFormulaBody || "",
                                wDefaultSheet
                            );
                        }
                    }
                }
                return "";
            });
            if (wFromWasm) {
                return wFromWasm;
            }
        }

        const wLiteral = SkCellClass.readPropertyRangeRef(
            sCell,
            sPropertyName,
            wHostRc?.row ?? 0,
            wHostRc?.col ?? 0
        );
        const wFormulaWire = wAttr.hasOwnProperty("f")
            ? String(wAttr.f || "")
            : "";
        return SkCellClass.qualifyRangeRefWithSheetFromFormula(
            wLiteral,
            wFormulaWire,
            wDefaultSheet
        );
    }

    /** Top-left cell of a range — witness for inheriting numeric format on chart axes. */
    static firstValueWitnessCellRef(sRangeRef, sDefaultSheet = "") {
        const wQualified = SkCellClass.qualifyRangeRefWithSheet(sRangeRef, sDefaultSheet);
        const wBounds = SkCellClass.parseA1RangeBounds(wQualified);
        if (!wBounds) {
            return { ref: "", sheet: "" };
        }
        const wSheet =
            SkCellClass.parseSheetFromRangeRef(wQualified) ||
            (typeof sDefaultSheet === "string" ? sDefaultSheet.trim() : "");
        const wCell = SkCellClass.cellRefFromRowCol(wBounds.top, wBounds.left);
        return { ref: wCell, sheet: wSheet };
    }

    /** Format a number using the resolved format of a source cell (SkFormat cascade). */
    static async formatValueWithCellFormat(sRef, sValue, sSheet = "") {
        const wApi = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
        if (!wApi || typeof wApi.formatValueWithCellFormat !== "function") {
            const wNum = Number(sValue);
            return Number.isFinite(wNum) ? String(wNum) : "";
        }
        const wRef = String(sRef || "").trim();
        if (!wRef) {
            const wNum = Number(sValue);
            return Number.isFinite(wNum) ? String(wNum) : "";
        }
        const wResult = wApi.formatValueWithCellFormat(
            wRef,
            String(sValue),
            sSheet || ""
        );
        if (wResult == null || wResult === "" || String(wResult).startsWith("Error")) {
            const wNum = Number(sValue);
            return Number.isFinite(wNum) ? String(wNum) : "";
        }
        return String(wResult);
    }

    /**
     * Read one cell scalar from WASM (calculable first) with JsonView fallback.
     * @returns {string}
     */
    static readA1RangeCellScalar(wRef, wReadSheet, sSpInterface, wRow, wCol) {
        const wApi = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
        if (!wApi) {
            return "";
        }
        // All three reads are synchronous native bindings (see SkUISpreadSheet).
        let wText = "";
        if (typeof wApi.getCalculableScalar === "function") {
            wText = SkCellClass.normalizeWasmCellValue(
                wApi.getCalculableScalar(wRef, wReadSheet),
            );
        }
        if (!wText && typeof wApi.getvalue === "function") {
            wText = SkCellClass.normalizeWasmCellValue(
                wApi.getvalue(wRef, wReadSheet),
            );
        }
        if (
            (!wText || SkCellClass.looksLikeWasmClassPlaceholder(wText)) &&
            typeof wApi.getInputvalue === "function"
        ) {
            wText = SkCellClass.normalizeWasmCellValue(
                wApi.getInputvalue(wRef, wReadSheet),
            );
        }
        if (!wText && sSpInterface) {
            wText = SkCellClass.readJsonViewCellScalar(
                sSpInterface,
                wRow,
                wCol,
                wReadSheet,
            );
        }
        return wText;
    }

    /** Read a rectangular A1 range from the spreadsheet engine (evaluated values). */
    static async readA1RangeMatrix(sRangeRef, sSheet = "", sDefaultSheet = "", sSpInterface = null) {
        return SkCellClass.runWithPreservedActiveSheet(async () => {
            let wReadSheet = SkCellClass.resolveRangeReadSheet(
                sRangeRef,
                sSheet,
                sDefaultSheet,
                sSpInterface
            );
            if (!wReadSheet && sSpInterface != null && typeof sSpInterface.getActiveSheet === "function") {
                wReadSheet = (await sSpInterface.getActiveSheet()) || "";
            }

            let wRangeRef = SkCellClass.normalizeRangeRefInput(sRangeRef);
            if (!wRangeRef) {
                return null;
            }
            wRangeRef = SkCellClass.qualifyRangeRefWithSheet(wRangeRef, wReadSheet);

            const wBounds = SkCellClass.parseA1RangeBounds(wRangeRef);
            if (!wBounds) {
                return null;
            }

            const wApi = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
            if (!wApi || typeof wApi.getvalue !== "function") {
                return null;
            }

            const wMatrix = [];
            for (let wRow = wBounds.top; wRow <= wBounds.bottom; wRow++) {
                const wLine = [];
                for (let wCol = wBounds.left; wCol <= wBounds.right; wCol++) {
                    const wRef = SkCellClass.cellRefFromRowCol(wRow, wCol);
                    const wText = SkCellClass.readA1RangeCellScalar(
                        wRef,
                        wReadSheet,
                        sSpInterface,
                        wRow,
                        wCol,
                    );
                    wLine.push(wText);
                }
                wMatrix.push(wLine);
            }
            return wMatrix;
        });
    }

    /** True when a raw scalar is a spreadsheet error (e.g. #N/A, #REF!, #DIV/0!). */
    static isErrorScalar(sValue) {
        if (sValue == null || typeof sValue === "number") {
            return false;
        }
        const wText = String(sValue).trim();
        return wText.startsWith("#");
    }

    /**
     * True when a cell evaluates to a spreadsheet error (e.g. #N/A).
     * Reads the UN-normalized engine scalar: normalizeWasmCellValue() strips the
     * leading "#", so error detection must happen on the raw value.
     */
    static readA1RangeCellIsError(wRef, wReadSheet) {
        const wApi = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
        if (!wApi) {
            return false;
        }
        if (typeof wApi.getCalculableScalar === "function") {
            if (SkCellClass.isErrorScalar(wApi.getCalculableScalar(wRef, wReadSheet))) {
                return true;
            }
        }
        if (typeof wApi.getvalue === "function") {
            if (SkCellClass.isErrorScalar(wApi.getvalue(wRef, wReadSheet))) {
                return true;
            }
        }
        return false;
    }

    /**
     * Flat numeric series from an A1 range — uses getCalculableScalar per cell.
     * Skips empty / non-numeric cells (sparklines, gauge single value, etc.).
     */
    static async numericValuesFromRangeRef(
        sRangeRef,
        sSheet = "",
        sDefaultSheet = "",
        sSpInterface = null,
    ) {
        const wResult = await SkCellClass.numericValuesWithErrorFromRangeRef(
            sRangeRef,
            sSheet,
            sDefaultSheet,
            sSpInterface,
        );
        return wResult.values;
    }

    /**
     * Same as numericValuesFromRangeRef, but also reports whether any cell holds
     * a spreadsheet error (e.g. #N/A). Callers such as sparklines use hasError to
     * suppress rendering when a dependent cell is in error.
     * @returns {Promise<{ values: number[], hasError: boolean }>}
     */
    static async numericValuesWithErrorFromRangeRef(
        sRangeRef,
        sSheet = "",
        sDefaultSheet = "",
        sSpInterface = null,
    ) {
        return SkCellClass.runWithPreservedActiveSheet(async () => {
            let wReadSheet = SkCellClass.resolveRangeReadSheet(
                sRangeRef,
                sSheet,
                sDefaultSheet,
                sSpInterface,
            );
            if (!wReadSheet && sSpInterface != null && typeof sSpInterface.getActiveSheet === "function") {
                wReadSheet = (await sSpInterface.getActiveSheet()) || "";
            }

            let wRangeRef = SkCellClass.normalizeRangeRefInput(sRangeRef);
            if (!wRangeRef) {
                return { values: [], hasError: false };
            }
            wRangeRef = SkCellClass.qualifyRangeRefWithSheet(wRangeRef, wReadSheet);

            const wBounds = SkCellClass.parseA1RangeBounds(wRangeRef);
            if (!wBounds) {
                return { values: [], hasError: false };
            }

            const wValues = [];
            let wHasError = false;
            for (let wRow = wBounds.top; wRow <= wBounds.bottom; wRow++) {
                for (let wCol = wBounds.left; wCol <= wBounds.right; wCol++) {
                    const wRef = SkCellClass.cellRefFromRowCol(wRow, wCol);
                    if (SkCellClass.readA1RangeCellIsError(wRef, wReadSheet)) {
                        wHasError = true;
                    }
                    const wRaw = SkCellClass.readA1RangeCellScalar(
                        wRef,
                        wReadSheet,
                        sSpInterface,
                        wRow,
                        wCol,
                    );
                    wValues.push(SkCellClass.numericFromScalar(wRaw));
                }
            }
            return { values: wValues, hasError: wHasError };
        });
    }

    /** First numeric cell in a range (gauge DataRange = single cell). */
    static async readFirstNumericFromRangeRef(
        sRangeRef,
        sSheet = "",
        sDefaultSheet = "",
        sSpInterface = null,
    ) {
        const wValues = await SkCellClass.numericValuesFromRangeRef(
            sRangeRef,
            sSheet,
            sDefaultSheet,
            sSpInterface,
        );
        return wValues.length > 0 ? wValues[0] : 0;
    }

    /** Extract numbers from a range matrix (row-major); non int/double cells become 0. */
    static numericScalarsFromMatrix(sMatrix) {
        if (!Array.isArray(sMatrix) || sMatrix.length === 0) {
            return [];
        }
        const wValues = [];
        for (const wRow of sMatrix) {
            const wCells = Array.isArray(wRow) ? wRow : [wRow];
            for (const wRaw of wCells) {
                wValues.push(SkCellClass.numericFromScalar(wRaw));
            }
        }
        return wValues;
    }

    // Legacy workbooks stored Calendar "value" as a named attribute instead of calculable scalar.
    static readLegacyValueAttribute(sCell) {
        return SkCellClass.readPropertyFromCellJson(sCell, "value");
    }

    // Scalar exposed to formulas (=H6) — backed by tCellClassAttribute::CalculableValue().
    async GetCalculableValue() {
        const wFromJson = SkCellClass.readCalculableFromCellJson(this.m_Cell);
        if (wFromJson) {
            return wFromJson;
        }
        const wRaw = window.SkUISpreadSheet.getvalue(this.cellStr());
        return SkCellClass.normalizeWasmCellValue(wRaw);
    }

    async SetCalculableValue(sValue) {
        const wNext = SkCellClass.normalizeWasmCellValue(sValue);
        return window.SkUISpreadSheet.valueClassCalculable(this.cellStr(), wNext);
    }

    isCursorOnThisCell() {
        const sp = this.m_SpInterface;
        if (!sp || typeof sp.cursor !== "function") {
            return false;
        }
        const wCur = sp.cursor();
        const wRow = Number(this.m_Cell?.c_r);
        const wCol = Number(this.m_Cell?.c_c);
        return (
            Number.isFinite(wRow) &&
            Number.isFinite(wCol) &&
            wCur.row() === wRow &&
            wCur.col() === wCol
        );
    }

    /** Cell where the edit session started (m_CursorEdit) — not the formula pick cursor. */
    isEditAnchorOnThisCell() {
        const sp = this.m_SpInterface;
        if (!sp || sp.m_CursorEdit == null) {
            return false;
        }
        const wRow = Number(this.m_Cell?.c_r);
        const wCol = Number(this.m_Cell?.c_c);
        return (
            Number.isFinite(wRow) &&
            Number.isFinite(wCol) &&
            sp.m_CursorEdit.row() === wRow &&
            sp.m_CursorEdit.col() === wCol
        );
    }

    /** True when a self-editing widget (Calendar, ComboBox) should open its inline editor. */
    shouldActivateSelfEditingWidget() {
        const sp = this.m_SpInterface;
        if (!sp || typeof sp.getUseEdit !== "function" || !sp.getUseEdit()) {
            return false;
        }
        if (this.isFormulaPickActive()) {
            return false;
        }
        return this.isEditAnchorOnThisCell();
    }

    async focusCursorOnCell(event) {
        const sp = this.m_SpInterface;
        if (!sp || typeof sp.selectCellAt !== "function") {
            return;
        }
        const wRow = Number(this.m_Cell?.c_r);
        const wCol = Number(this.m_Cell?.c_c);
        if (!Number.isFinite(wRow) || !Number.isFinite(wCol)) {
            return;
        }

        // Synchronous: drag-select from class widgets until global mouseup clears flags.
        // Do not set m_MouseDown after awaits — mouseup may have fired already and would leave wheel blocked.
        sp.m_MouseDown = true;
        sp.m_Selected = false;
        const wGrid = sp.m_SkSpGridCanvas;
        if (wGrid) {
            wGrid.m_MouseDown = true;
            wGrid.m_DragSelecting = false;
        }

        const wExtendSelection = event?.shiftKey === true;
        if (wExtendSelection) {
            if (typeof sp.initKey === "function") {
                await sp.initKey();
            }
            if (typeof sp.cursorSelect === "function") {
                await sp.cursorSelect(wRow, wCol);
            }
        } else if (typeof sp.razAllselect === "function") {
            await sp.razAllselect();
        }

        await sp.selectCellAt(wRow, wCol);
    }

    // Return keyboard to the grid canvas so arrow keys keep working after widget clicks.
    restoreGridKeyboardFocus() {
        const sp = this.m_SpInterface;
        if (!sp || typeof sp.focusGridCanvas !== "function") {
            return;
        }
        // Match SkSpGridCanvas.restoreCanvasFocus — reloadView may re-render after persist.
        const wFocus = () => sp.focusGridCanvas();
        wFocus();
        requestAnimationFrame(wFocus);
    }

    isFormulaPickActive() {
        const sp = this.m_SpInterface;
        return (
            sp != null &&
            typeof sp.isFormulaPickActive === "function" &&
            sp.isFormulaPickActive()
        );
    }

    isGridRangePickActive() {
        const sp = this.m_SpInterface;
        return (
            sp != null &&
            typeof sp.isGridRangePickActive === "function" &&
            sp.isGridRangePickActive()
        );
    }

    // Shared wrapper attrs: grid picks use c_r/c_c (A6), not c_v.c.n instance ref name.
    cellClassDomAttrs() {
        const wRow = this.m_Cell?.c_r;
        const wCol = this.m_Cell?.c_c;
        return {
            "data-cell-row": wRow,
            "data-cell-col": wCol,
        };
    }

    /** Floating object registry name from a synthetic overlay cell (c_fo). */
    static floatingObjectNameFromCell(sCell) {
        if (!sCell || sCell.c_fo !== true) {
            return "";
        }
        if (typeof sCell.c_k === "string" && sCell.c_k.startsWith("float:")) {
            return sCell.c_k.slice(6);
        }
        return sCell?.c_v?.c?.n || "";
    }

    /** Select on canvas click; edge clicks pass through to SkSpFloatingLayer for grab-move. */
    onFloatingObjectCanvasMouseDownCapture = (event) => {
        if (this.m_Cell?.c_fo !== true || event.button !== 0) {
            return;
        }
        const wName = SkCellClass.floatingObjectNameFromCell(this.m_Cell);
        const wLayer = this.m_SpInterface?.m_SkSpFloatingLayer;
        if (wName && wLayer != null) {
            const wEntry = this.m_SpInterface.findFloatingObjectEntry?.(wName);
            if (wEntry != null) {
                const wBox = wLayer.layoutBoxForEntry(wEntry);
                const wLocal = wLayer.pointerLocalInBox(event, wBox.width, wBox.height);
                if (
                    wLocal != null &&
                    wLayer.isPointerOnFloatingMoveEdge(
                        wLocal.x,
                        wLocal.y,
                        wBox.width,
                        wBox.height
                    )
                ) {
                    return;
                }
            }
        }
        event.stopPropagation();
        if (wName && this.m_SpInterface?.selectFloatingObject) {
            this.m_SpInterface.selectFloatingObject(wName);
        }
    };

    // Capture phase: place grid cursor on this class cell before widget handlers run.
    onCellClassMouseDownCapture = (event) => {
        // Floating overlays (SkSpFloatingLayer) handle move/resize themselves.
        if (this.m_Cell?.c_fo === true) {
            return;
        }
        const sp = this.m_SpInterface;
        if (event.target?.closest?.(
            ".SkCellClassComboBox-toggle, .SkComboBox-list, .SkComboBox-option, "
            + ".SkCellClassCalendar-toggle, .SkCellClassCalendar-popup, .SkCellClassCalendar-input"
        )) {
            return;
        }
        if (this.isGridRangePickActive()) {
            event.preventDefault();
            event.stopPropagation();
            if (sp && typeof sp.pickCellRefForActiveEdit === "function") {
                void sp.pickCellRefForActiveEdit(
                    this.m_Cell?.c_r,
                    this.m_Cell?.c_c,
                    event.shiftKey
                );
            }
            return;
        }
        // Self-editing widget (Calendar, ComboBox) on its edit anchor — allow in-cell interaction.
        if (this.shouldActivateSelfEditingWidget()) {
            return;
        }
        // Other edit sessions: keep focus in the formula/cell editor (never steal to canvas).
        if (sp && typeof sp.getUseEdit === "function" && sp.getUseEdit()) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        void this.focusCursorOnCell(event).then(() => {
            this.restoreGridKeyboardFocus();
        });
    };

    buildCaptionFontStyle(sCell, sColor, sFontSizeCss) {
        let wFontName = "Roboto";
        let wFontWeight = "";
        let wFontStyle = "";
        if (sCell.hasOwnProperty("f_f_n")) {
            wFontName = sCell.f_f_n;
        }
        if (sCell.hasOwnProperty("f_we")) {
            wFontWeight = GetFontWeight(sCell.f_we);
        }
        if (sCell.hasOwnProperty("f_st")) {
            wFontStyle = GetFontStyle(sCell.f_st);
        }
        return {
            color: sColor,
            fontFamily: buildCanvasFontFamily(wFontName),
            fontSize: sFontSizeCss + "px",
            fontWeight: wFontWeight,
            fontStyle: wFontStyle,
        };
    }

    // Optional caption after in-cell widgets (Check/Switch "label" attribute).
    renderWidgetWithCaption(sWidget, sCell, sColor, sFontSizeCss) {
        const wCaption = SkCellClass.readPropertyFromCellJson(sCell, "label");
        if (!wCaption) {
            return sWidget;
        }
        const wFontStyle = this.buildCaptionFontStyle(sCell, sColor, sFontSizeCss);
        return (
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    maxWidth: '100%',
                    minWidth: 0,
                }}
            >
                {sWidget}
                <span
                    style={{
                        ...wFontStyle,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        userSelect: 'none',
                        pointerEvents: 'none',
                    }}
                >
                    {wCaption}
                </span>
            </div>
        );
    }

    OnClick() {
        this.m_OnClick(this);
    }
        
    async SetProperty(sName, sValue) {
        const wApi = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
        if (wApi == null || typeof wApi.valueAttribute !== "function") {
            return false;
        }
        const wTarget = this.attributeValueRef();
        console.log("SetProperty " + wTarget.ref + " " + sName + "=" + sValue);
        return wApi.valueAttribute(wTarget.ref, sName, sValue, wTarget.sheet);
    }

    static async Code() {
        let wJson = window.SkUISpreadSheet.jsonCellClassByName(this.ClassName()); 
        let wClasse = JSON.parse(wJson);

        let wResult = "// _" + this.ClassName() + "=============================\n";
        wResult += "class _" + this.ClassName() + " {\n";
        wResult += "    constructor() {\n";
        let wArrayInstance = wClasse.p;
        wArrayInstance.forEach((wItem, index) => {
            if (index < wArrayInstance.length) {
              wResult += "        this." + wItem.n + "=null; //" + wItem.l + "\n"; 
            }
          }); 
    
        wResult += "    }\n";
        wResult += "    static ClassName() { return(\"" + this.ClassName() + "\") }\n";
       
        wResult += "}\n"

        return(wResult);
    }
};

// ============================================================================
export default SkCellClass;