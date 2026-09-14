//=============================================================================
// SkSpGridCanvas
// SpreadSheet Canvas of grid 
//=============================================================================
import React from "react";
import './SkSpreadSheet.css'
import SkScrollBar from "../component/SkScrollBar";
import SkCanvas from "../component/SkCanvas";
import { tRange } from "./SkSpSelect.js";
import SkSpGridPanel from "./SkSpGridPanel.js";
import SkSpFloatingLayer from "./SkSpFloatingLayer.js";
import SkSpInplaceEdit from "./SkSpInplaceEdit"
import SkSpCellCanvas from "./SkSpCellCanvas";
import { pointerToLayoutPx, layoutToScreenScale } from "../utility/SkViewZoom.js";
import {
  dataTransferHasImageFiles,
  firstImageFileFromDataTransfer,
  insertImageFloatingObject,
  openImageFilePicker,
  readImageFileForInsert,
} from "./SkSpInsertImage.js";
import SkMenuPopUp from "../component/SkMenuPopup";
import SkMenuElement from "../component/SkMenuElement";
import {
  luminanceFromCssColor,
  parseCssColor,
} from "../utility/skCssColorContrast.js";
import SkSpTableFilterPopup from "./SkSpTableFilterPopup.js";
import { paintCellStack as paintJsonViewCellStack } from "./SkPaintCellStack.js";

const SK_MAX_ROW = 1048576;
const SK_MAX_COL = 16384;

/**
 * Remove [cutL, cutR] from 1D intervals [a,b] (horizontal spans or vertical spans).
 * Used so dotted grid lines do not draw through merged cell interiors (Excel-like).
 */
function subtractInterval1D(intervals, cutL, cutR) {
  if (!(cutR > cutL) || intervals.length === 0) {
    return intervals;
  }
  const out = [];
  for (let i = 0; i < intervals.length; i++) {
    const a = intervals[i][0];
    const b = intervals[i][1];
    if (cutR <= a || cutL >= b) {
      out.push([a, b]);
    } else {
      if (cutL > a) {
        out.push([a, Math.min(b, cutL)]);
      }
      if (cutR < b) {
        out.push([Math.max(a, cutR), b]);
      }
    }
  }
  return out.filter(([a0, b0]) => b0 - a0 > 0.5);
}

/**
 * Index merge rects by sheet row/col for grid line subtraction (avoid O(rows × merges)).
 * @param {{ r_t: number, r_b: number, r_l: number, r_r: number, px: object }[]} merges
 */
function indexMergeRectsByRowAndCol(merges) {
  /** @type {Map<number, typeof merges>} */
  const byRow = new Map();
  /** @type {Map<number, typeof merges>} */
  const byCol = new Map();
  for (const m of merges) {
    const rT = Number(m.r_t);
    const rB = Number(m.r_b);
    const cL = Number(m.r_l);
    const cR = Number(m.r_r);
    if (!Number.isFinite(rT) || !Number.isFinite(rB)) continue;
    if (!Number.isFinite(cL) || !Number.isFinite(cR)) continue;
    for (let r = rT; r < rB; r++) {
      let bucket = byRow.get(r);
      if (!bucket) {
        bucket = [];
        byRow.set(r, bucket);
      }
      bucket.push(m);
    }
    for (let c = cL; c < cR; c++) {
      let bucket = byCol.get(c);
      if (!bucket) {
        bucket = [];
        byCol.set(c, bucket);
      }
      bucket.push(m);
    }
  }
  return { byRow, byCol };
}


/**
 * Merge sheet + pixel rects from JsonView "merges" (C++); avoids ReturnRangeMerged per paint.
 */
function mergeSheetAndPxFromJsonViewUi(sUI) {
  if (sUI == null || !Array.isArray(sUI.merges) || sUI.merges.length === 0) {
    return null;
  }
  const out = [];
  for (const wM of sUI.merges) {
    const wW = Number(wM.p_w);
    const wH = Number(wM.p_h);
    if (!(wW > 0) || !(wH > 0)) {
      continue;
    }
    out.push({
      r_t: Number(wM.r_t),
      r_l: Number(wM.r_l),
      r_b: Number(wM.r_b),
      r_r: Number(wM.r_r),
      px: {
        Left: Number(wM.p_l),
        Top: Number(wM.p_t),
        Width: wW,
        Height: wH,
      },
    });
  }
  return out.length > 0 ? out : null;
}


class SkSpGridCanvas extends SkCanvas {
  /** Hit band (layout px) for Excel-like move on the selection top edge only. */
  static MOVE_EDGE_HIT_PX = 3;
  /** Keep the fill handle corner out of the move hit zone. */
  static FILL_HANDLE_HIT_RADIUS = 8;
  static _parseCssColor(sColor) {
    return parseCssColor(sColor);
  }

  static _luminanceFromCssColor(sColor) {
    return luminanceFromCssColor(sColor);
  }

  async _resolveCellBackgroundLuminance(wRow, wCol) {
    let wBc = this.m_SpInterface.getJsonViewBackgroundColorSync(wRow, wCol);
    if (wBc == null) {
      wBc = await this.m_SpInterface.resolveJsonViewBackgroundColor(wRow, wCol);
    }
    if (wBc == null || wBc === "") {
      return null;
    }
    return luminanceFromCssColor(wBc);
  }

  async _cursorStrokeColorsForCell(wRow, wCol) {
    const wLum = await this._resolveCellBackgroundLuminance(wRow, wCol);
    const wDefault = this.m_ColorCursorBorder || "#0078d4";
    const wOnDark = wLum != null && wLum < 128;
    return {
      cursorColor: wOnDark ? "#FFFFFF" : wDefault,
      cursorHandleColor: wOnDark ? "#FFFFFF" : (this.m_ColorCursorHandle || wDefault),
      useContrastHalo: true,
    };
  }

  _strokeActiveCellOutline(sContext, wL, wT, wR, wB, innerColor, handleColor, drawHandle) {
    const wW = wR - wL;
    const wH = wB - wT;
    if (wW <= 0 || wH <= 0) {
      return;
    }

    // White halo keeps the cursor legible on dark fills even when f_bc is missing from JsonView.
    sContext.beginPath();
    sContext.strokeStyle = "#FFFFFF";
    sContext.lineWidth = 4;
    sContext.roundRect(wL - 1, wT - 1, wW + 2, wH + 2, 2);
    sContext.stroke();

    sContext.beginPath();
    sContext.strokeStyle = innerColor;
    sContext.lineWidth = 2;
    sContext.roundRect(wL, wT, wW, wH, 2);
    sContext.stroke();

    if (drawHandle) {
      sContext.beginPath();
      sContext.fillStyle = handleColor;
      sContext.strokeStyle = "#FFFFFF";
      sContext.lineWidth = 1;
      const wSize = 4;
      sContext.arc(wR, wB, wSize, 0, 2 * Math.PI);
      sContext.closePath();
      sContext.fill();
      sContext.stroke();
    }
  }

  /**
   * Intersect a cell/cursor pixel rect with the grid inner viewport.
   * Wide merged cells report a full merge c_w; clipping avoids giant paths (unreliable
   * stroke) and keeps the resize handle on the visible bottom-right corner.
   */
  static _clampRectToViewportCss(left, top, width, height, vpW, vpH) {
    const r = left + width;
    const b = top + height;
    const il = Math.max(0, left);
    const it = Math.max(0, top);
    const ir = Math.min(vpW, r);
    const ib = Math.min(vpH, b);
    return {
      Left: il,
      Top: it,
      Width: Math.max(0, ir - il),
      Height: Math.max(0, ib - it),
    };
  }

  constructor(props) {
    super(props);
    this.m_SpInterface=props.SpInterface;
    this.state = ({ invalidate : false, menuPopUp : false, tableFilterPopup : null });
    this.m_Id="GridCanvas";
    this.m_Cursor="cell";

    this.m_CellCanvas=new SkSpCellCanvas()
 
    this.m_SpInterface.m_SkSpGridCanvas=this; // for invalidate
    this.m_UIView=null
    this.m_MouseDown=false;
    this.m_DragSelecting=false;
    /** Excel-like range move drag (Copy → Raz → Paste via UndoMove). */
    this.m_DragMove = null;
    /** Excel-like fill-handle drag (auto-fill series). */
    this.m_FillDrag = null;
    /** Ignore wheel scrolling until this timestamp (trackpad inertia after drag-select). */
    this.m_SuppressWheelUntilMs=0;

    this.m_RefMenu=React.createRef();
    this.closeMenuPopUp=this.closeMenuPopUp.bind(this);
    this.insertRowByRect=this.insertRowByRect.bind(this);
    this.deleteRowByRect=this.deleteRowByRect.bind(this);
    this.insertColByRect=this.insertColByRect.bind(this);
    this.deleteColByRect=this.deleteColByRect.bind(this);
    this.contextCut=this.contextCut.bind(this);
    this.contextCopy=this.contextCopy.bind(this);
    this.contextPaste=this.contextPaste.bind(this);
    this.insertRowWhole=this.insertRowWhole.bind(this);
    this.insertColWhole=this.insertColWhole.bind(this);
    
    // Inertia variables
    this.lastTouchTime = 0;
    this.lastTouchX = 0;
    this.lastTouchY = 0;
    this.velocityX = 0;
    this.velocityY = 0;
    this.isInertialScrolling = false;
    this.animationFrame = null;

    // Double-tap variables
    this.lastTapTime = 0;
    this.lastTapX = 0;
    this.lastTapY = 0;
    this.doubleTapDelay = 300; // Max delay between two taps in milliseconds
    this.doubleTapDistance = 20; // Max distance between two taps in pixels

    // paint() runs async paintClient (await merge / json). Without a queue, overlapping paints
    // clear the canvas while a previous pass is mid-await → frozen pane can stay blank until scroll.
    this._paintChain = Promise.resolve();
    this.m_OverlayRef = React.createRef();
    /** @type {'full'|'cells'|'overlay'} */
    this._paintMode = "full";
    /** Coalesced wheel-scroll getView (trackpads / touch pan can emit many tiny deltas). */
    this._wheelScrollRaf = null;
    this._pendingWheelScroll = null;
    /** True while a wheel getView is in flight; serializes frames to avoid torn paints. */
    this._wheelScrollBusy = false;
  }

  _paintModeRank(mode) {
    if (mode === "full") return 2;
    if (mode === "cells") return 1;
    return 0;
  }

  _schedulePaintMode(mode) {
    if (this._paintModeRank(mode) > this._paintModeRank(this._paintMode)) {
      this._paintMode = mode;
    }
  }

  _consumePaintMode() {
    const mode = this._paintMode;
    this._paintMode = "full";
    return mode;
  }

  componentDidMount() {
    //console.log( "SkGridCanvas::componentDidMount()")

    this.refreshThemeColors();
    
    // Store bound event handlers to properly remove them later
    this.boundKeyDown = this.keyDown.bind(this);
    this.boundContextMenu = this.contextMenu.bind(this);
    this.boundMouseDown = this.mouseDown.bind(this);
    this.boundMouseMove = this.mouseMove.bind(this);
    this.boundMouseUp = this.mouseUp.bind(this);
    this.boundMouseWheel = this.mouseWheel.bind(this);
    this.boundBlockBrowserZoomGesture = this.blockBrowserZoomGesture.bind(this);
    
    this.m_Ref.current.addEventListener('keydown', this.boundKeyDown);
    this.m_Ref.current.addEventListener('contextmenu', this.boundContextMenu);
    
    // Anchor on Window
    const wRoot = window; 
    wRoot.addEventListener('mousedown', this.boundMouseDown);
    wRoot.addEventListener('mousemove', this.boundMouseMove);
    wRoot.addEventListener('mouseup', this.boundMouseUp);
    wRoot.addEventListener("wheel", this.boundMouseWheel, { passive : false });
    // Safari trackpad pinch page-zoom on the grid canvas (touch pinch still uses m_Zoom).
    if (this.m_Ref.current) {
      this.m_Ref.current.addEventListener('gesturestart', this.boundBlockBrowserZoomGesture, { passive: false });
      this.m_Ref.current.addEventListener('gesturechange', this.boundBlockBrowserZoomGesture, { passive: false });
      this.m_Ref.current.addEventListener('gestureend', this.boundBlockBrowserZoomGesture, { passive: false });
    }
    // Repaint once Material Symbols Rounded finishes loading. drawIconSets()
    // falls back to the OOXML iconString while the font is unavailable, so we
    // need this to flip the rendering to actual Material Symbols glyphs after
    // first load (see public/index.html font preload + SkUtility.js fallback).
    this.boundMaterialSymbolsLoaded = () => {
      try { this.paint(); } catch (e) { /* canvas may have been unmounted */ }
    };
    wRoot.addEventListener("sk-material-symbols-loaded", this.boundMaterialSymbolsLoaded);
    this.m_Ref.current.focus();

    // Grid container often gets clientWidth/Height only after flex + zoom settle; reload JsonView once layout is stable (fixes misaligned headers/body until first click).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          if (this.m_SpInterface && this.m_Ref.current && !this.m_SpInterface.isSpreadsheetDisposed?.()) {
            this.m_SpInterface.reloadView();
          }
        } catch (e) {
          console.error("SkSpGridCanvas deferred reloadView:", e);
        }
      });
    });
  }

  refreshThemeColors() {
    const wRootStyle = document.querySelector(':root');
    if (!wRootStyle) return;
    const wStyleComputed = getComputedStyle(wRootStyle);
    this.m_ColorSelect = wStyleComputed.getPropertyValue('--sk-fill-select');
    this.m_ColorCursorBorder = wStyleComputed.getPropertyValue('--sk-color-cursor-border').trim() || '#0078d4';
    this.m_ColorCursorHandle = wStyleComputed.getPropertyValue('--sk-color-cursor-handle').trim() || '#0078d4';
  }

  /**
   * Clean up all resources when component unmounts to prevent memory leaks
   * - Removes all event listeners (keyboard, mouse, wheel, context menu)
   * - Cancels animation frames and timers
   * - Resets touch state and gesture variables
   * - Cleans up circular references
   */
  componentWillUnmount(prevProps) {
    console.log( "SkGridCanvas::componentwillUnmount()")
    
    // Clean up all event listeners using stored bound references
    if (this.m_Ref.current) {
      this.m_Ref.current.removeEventListener('keydown', this.boundKeyDown);
      this.m_Ref.current.removeEventListener('contextmenu', this.boundContextMenu);
    }
    
    // Clean up window event listeners
    const wRoot = window;
    wRoot.removeEventListener('mousedown', this.boundMouseDown);
    wRoot.removeEventListener('mousemove', this.boundMouseMove);
    wRoot.removeEventListener('mouseup', this.boundMouseUp);
    wRoot.removeEventListener("wheel", this.boundMouseWheel, { passive : false });
    if (this.m_Ref.current && this.boundBlockBrowserZoomGesture) {
      this.m_Ref.current.removeEventListener('gesturestart', this.boundBlockBrowserZoomGesture, { passive: false });
      this.m_Ref.current.removeEventListener('gesturechange', this.boundBlockBrowserZoomGesture, { passive: false });
      this.m_Ref.current.removeEventListener('gestureend', this.boundBlockBrowserZoomGesture, { passive: false });
    }
    if (this.boundMaterialSymbolsLoaded) {
      wRoot.removeEventListener("sk-material-symbols-loaded", this.boundMaterialSymbolsLoaded);
    }
    // Clean up animation frame to prevent memory leaks
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    if (this._wheelScrollRaf != null) {
      cancelAnimationFrame(this._wheelScrollRaf);
      this._wheelScrollRaf = null;
    }
    this._pendingWheelScroll = null;
    this._wheelScrollBusy = false;
    
    // Clean up any remaining timers or intervals if they exist
    if (this.touchTimer) {
      clearTimeout(this.touchTimer);
      this.touchTimer = null;
    }
    
    // Reset touch state
    this.m_MouseDown = false;
    this.m_DragSelecting = false;
    this.m_SuppressWheelUntilMs = 0;
    this.isInertialScrolling = false;
    this.lastTouchTime = 0;
    this.lastTouchX = 0;
    this.lastTouchY = 0;
    this.velocityX = 0;
    this.velocityY = 0;
    
    // Reset touch gesture variables
    this.initialDistance = null;
    this.initialTouch = null;
    this.initialTouch1 = null;
    this.initialTouch2 = null;
    // Clean up circular references
    if (this.m_SpInterface && this.m_SpInterface.m_SkSpGridCanvas === this) {
      this.m_SpInterface.m_SkSpGridCanvas = null;
    }
    
    // Clean up other references
    this.m_UIView = null;
    this.m_SpInterface = null;
  }

  async ready() {
    this.m_SpInterface.invalidateAll();
    this.m_SpInterface.scheduleInvalidateSelection();
  }


  invalidateAll() {
    this._schedulePaintMode("full");
    this.m_SpInterface.m_SkSpTopPanel.invalidate();
    this.m_SpInterface.m_SkSpLeftPanel.invalidate();
    // Relaunch render()
    this.setState({ invalidate : !this.state.invalidate });
  }

  /** Repaint selection, cursor, and sizer only (no cell text/grid). */
  invalidateOverlays() {
    this._schedulePaintMode("overlay");
    this.m_SpInterface.m_SkSpTopPanel.invalidate();
    this.m_SpInterface.m_SkSpLeftPanel.invalidate();
    this.setState({ invalidate: !this.state.invalidate });
  }

  async keyDown(event) {
    // m_SpInterface is nulled on unmount; a lingering listener from a fast
    // mount/unmount cycle (e.g. StrictMode) can still fire — bail out safely.
    if (!this.m_SpInterface) {
      return;
    }
    //("Grid Canvas :",event.key, " ",event.srcElement.id);
    // This GridCanvas ========================================================
    if (this.m_Id===event.srcElement.id)  {
      if ((event.metaKey) || (event.ctrlKey)) {
        if (
          event.shiftKey &&
          (event.key === "i" || event.key === "I")
        ) {
          event.preventDefault();
          event.stopPropagation();
          openImageFilePicker(this.m_SpInterface);
          return;
        }
        switch(event.key) {
          case 'c':
          case 'C': {
              if (!await this.m_SpInterface.copy()) {
                console.error("Copy failed");
              }
              return;
          }

          case 'x':
          case 'X': {
              event.preventDefault();
              event.stopPropagation();
              if (!await this.m_SpInterface.cut()) {
                console.error("Cut failed");
              }
              this.m_SpInterface.invalidateAll();
              return;
          }
    
          case 'v':
          case 'V': {
              if (!await this.m_SpInterface.paste()) {
                console.error("Paste failed");
              }
              this.m_SpInterface.invalidateAll();
              return;
          }
    
          case 'z':
          case 'Z': {
                if (event.shiftKey) {
                  await this.m_SpInterface.redo();
                  return;
                } else {
                  await this.m_SpInterface.undo();
                  return;
                }
          }
          case 'Backspace' :
          case 'Delete' : {
              event.preventDefault();
              event.stopPropagation();
              // Ctrl/Cmd + Shift + Backspace: clear the format only (keep content).
              // Ctrl/Cmd + Backspace/Delete: clear content AND format.
              if (event.shiftKey && event.key === 'Backspace') {
                await this.m_SpInterface.razFormat();
              } else {
                await this.m_SpInterface.raz(false);
              }
              return;
          }
          case 'ArrowLeft' : 
          case 'ArrowRight' : 
          case 'ArrowUp' : 
          case 'ArrowDown' : {
            if (this.m_SpInterface.isGridRangePickActive()) {
              await this.m_SpInterface.cursorMoveKeyForFormulaEdit(event);
            } else {
              await this.m_SpInterface.cursorMoveKey(event);
            }
            event.stopPropagation();
            event.preventDefault();
            return;
          }
          default : break;
        }
        
      }
      switch(event.key) {
        case 'ArrowLeft' : 
        case 'ArrowRight' : 
        case 'ArrowUp' : 
        case 'ArrowDown' : 
        case 'PageUp' :
        case 'PageDown' :
        case 'Home' :
        case 'End' : {
          event.preventDefault();
          if (this.m_SpInterface.isGridRangePickActive()) {
            await this.m_SpInterface.cursorMoveKeyForFormulaEdit(event);
          } else {
            await this.m_SpInterface.cursorMoveKey(event);
          }
          break;
        }
        case 'F2' : {
          await this.m_SpInterface.beginEdit();
          this.m_SpInterface.invalidateAll();
          break;
        }
        case 'F9' : {
          event.preventDefault();
          await this.m_SpInterface.m_SkSpreadSheet?.runRecalculateAll?.();
          break;
        }

      
        case 'Backspace' :
        case 'Delete' : {
          // Plain Backspace/Delete: clear cell content only, keep the format.
          await this.m_SpInterface.raz(true);
          break;
        }
        case 'CapsLock' :
        case 'Escape' : 
        case 'Control' :
        case 'Meta' :
        case 'Alt'  :
        case 'Shift' : break;
        default : {
          if (!event.ctrlKey && event.key.length === 1) {
            this.m_SpInterface.setLastChar(event.key);
            await this.m_SpInterface.beginEdit();
            event.preventDefault();
            this.m_SpInterface.invalidateAll();
          }
          break;
        }
        }
    } 
    // InplaceEdit ============================================================
    if ((event.srcElement.id==="InplaceEdit") || (event.srcElement.id==="InplaceEditStatic")) {
      switch(event.key) {
        case 'Escape' : {
          await this.m_SpInterface.endEdit();
          this.m_Ref.current.focus();
          break;
      }
        case 'Enter' : {
          if (event.altKey) {
            break;
          }
          try {
            await this.m_SpInterface.validEdit();
          } catch (e) {
            console.error(e);
          }
          this.m_Ref.current.focus();
          break;
        }
        default : {
          break;
        }
      }  
    }
    event.preventDefault();
    event.stopPropagation();
  }
  
  /** Canvas-local layout coords (includes TreeView gutters; zoom-aware). */
  offsetMousePos(event) {
    const wCanvas = this.m_Ref.current;
    if (!wCanvas || !this.m_SpInterface) {
      return { X: 0, Y: 0 };
    }
    const wPt = pointerToLayoutPx(wCanvas, event.clientX, event.clientY);
    return { X: wPt.x, Y: wPt.y };
  }

  MouseTreeViewRelative(event) {
    // offsetX/offsetY are relative to event.target. While drag-selecting, the
    // pointer often leaves the grid canvas (toolbar, sheet tabs, side panels).
    return this.getCanvasCoordinates(event);
  }

  _isPointInFillHandleCorner(wPos, wPx) {
    const wHx = wPx.Left + wPx.Width;
    const wHy = wPx.Top + wPx.Height;
    const wDx = wPos.X - wHx;
    const wDy = wPos.Y - wHy;
    return (
      wDx * wDx + wDy * wDy <=
      SkSpGridCanvas.FILL_HANDLE_HIT_RADIUS * SkSpGridCanvas.FILL_HANDLE_HIT_RADIUS
    );
  }

  /** True when the pointer sits on the selection top edge (move handle). */
  isPointerOnSelectionMoveEdge(wPos, wPx) {
    if (wPx == null || wPx.Width <= 0 || wPx.Height <= 0) {
      return false;
    }
    const wHit = SkSpGridCanvas.MOVE_EDGE_HIT_PX;
    const wLeft = wPx.Left;
    const wTop = wPx.Top;
    const wRight = wPx.Left + wPx.Width;
    const wX = wPos.X;
    const wY = wPos.Y;

    // Move drag is only available on the top edge of the selection.
    if (wX < wLeft - wHit || wX > wRight + wHit) {
      return false;
    }
    if (this._isPointInFillHandleCorner(wPos, wPx)) {
      return false;
    }

    return wY >= wTop - wHit && wY <= wTop + wHit;
  }

  _setGridCanvasCursor(wCursor) {
    const wCss = wCursor === "cell" ? "" : wCursor;
    if (this.m_Cursor === wCursor) {
      const wCanvas = this.m_Ref.current;
      if (wCanvas && wCanvas.style.cursor !== wCss) {
        wCanvas.style.cursor = wCss;
      }
      return;
    }
    this.m_Cursor = wCursor;
    const wCanvas = this.m_Ref.current;
    if (wCanvas) {
      wCanvas.style.cursor = wCss;
    }
  }

  resetSelectionMoveCursor() {
    this._setGridCanvasCursor("cell");
  }

  async updateSelectionMoveCursor(wPos) {
    if (this.m_DragMove != null || this.m_FillDrag != null || this.m_MouseDown || this.m_SpInterface?.getUseEdit?.()) {
      return;
    }
    if (!this.canBeginDragMove()) {
      this.resetSelectionMoveCursor();
      return;
    }
    const wRange = await this.resolveDragMoveSourceRange();
    if (wRange == null) {
      this.resetSelectionMoveCursor();
      return;
    }
    const wPx = await this.m_SpInterface.getRectPixel(wRange);
    if (wPx != null && this._isPointInFillHandleCorner(wPos, wPx)) {
      this._setGridCanvasCursor("crosshair");
      return;
    }
    const wOnEdge = this.isPointerOnSelectionMoveEdge(wPos, wPx);
    this._setGridCanvasCursor(wOnEdge ? "grab" : "cell");
  }

  /** True when a single rectangular cell range can be dragged (not row/col bands). */
  canBeginDragMove() {
    const sp = this.m_SpInterface;
    if (sp == null || sp.getUseEdit?.()) {
      return false;
    }
    if (
      typeof sp.hasColRowSelect === "function"
        ? sp.hasColRowSelect()
        : sp.m_SelectCol?.last?.() != null || sp.m_SelectRow?.last?.() != null
    ) {
      return false;
    }
    if (sp.m_Select.selections().length > 1) {
      return false;
    }
    return true;
  }

  async resolveDragMoveSourceRange() {
    const sp = this.m_SpInterface;
    let wRange = sp.m_Select.last();
    if (wRange == null) {
      wRange = await sp.rangeSelect(sp.cursor());
    }
    return wRange;
  }

  async tryBeginDragMove(wPos, event) {
    if (!this.canBeginDragMove()) {
      return false;
    }
    const wRange = await this.resolveDragMoveSourceRange();
    if (wRange == null) {
      return false;
    }
    const wPx = await this.m_SpInterface.getRectPixel(wRange);
    if (!this.isPointerOnSelectionMoveEdge(wPos, wPx)) {
      return false;
    }
    const wAnchor = await this.m_SpInterface.cellFromGridMouse(wPos.X, wPos.Y);
    this.m_DragMove = {
      sourceRef: this.m_SpInterface.m_Select.strRange(wRange),
      sourceTop: wRange.row(),
      sourceLeft: wRange.col(),
      sourceBottom: wRange.bottom(),
      sourceRight: wRange.right(),
      rowOff: wAnchor.row - wRange.row(),
      colOff: wAnchor.col - wRange.col(),
      copyMode: !!(event.ctrlKey || event.metaKey),
      destTop: null,
      destLeft: null,
      destBottom: null,
      destRight: null,
    };
    this._setGridCanvasCursor(this.m_DragMove.copyMode ? "copy" : "grabbing");
    return true;
  }

  async updateDragMove(wPos) {
    const dm = this.m_DragMove;
    if (dm == null) {
      return;
    }
    const wCell = await this.m_SpInterface.cellFromGridMouse(wPos.X, wPos.Y);
    const wHeight = dm.sourceBottom - dm.sourceTop + 1;
    const wWidth = dm.sourceRight - dm.sourceLeft + 1;
    let wTop = wCell.row - dm.rowOff;
    let wLeft = wCell.col - dm.colOff;
    wTop = Math.max(1, Math.min(SK_MAX_ROW - wHeight + 1, wTop));
    wLeft = Math.max(1, Math.min(SK_MAX_COL - wWidth + 1, wLeft));
    dm.destTop = wTop;
    dm.destLeft = wLeft;
    dm.destBottom = wTop + wHeight - 1;
    dm.destRight = wLeft + wWidth - 1;
    this.invalidateOverlays();
  }

  endDragMoveSession() {
    this.m_DragMove = null;
    this.resetSelectionMoveCursor();
  }

  // Fill handle (Excel-like auto-fill) =====================================

  /** Begin a fill-handle drag when the pointer grabs the selection corner. */
  async tryBeginFill(wPos, event) {
    if (event.shiftKey || !this.canBeginDragMove()) {
      return false;
    }
    const wRange = await this.resolveDragMoveSourceRange();
    if (wRange == null) {
      return false;
    }
    const wPx = await this.m_SpInterface.getRectPixel(wRange);
    if (wPx == null || wPx.Width <= 0 || wPx.Height <= 0) {
      return false;
    }
    if (!this._isPointInFillHandleCorner(wPos, wPx)) {
      return false;
    }
    this.m_FillDrag = {
      sourceTop: wRange.row(),
      sourceLeft: wRange.col(),
      sourceBottom: wRange.bottom(),
      sourceRight: wRange.right(),
      // Full preview union (source + extension) and the extension-only range.
      destTop: null,
      destLeft: null,
      destBottom: null,
      destRight: null,
      extTop: null,
      extLeft: null,
      extBottom: null,
      extRight: null,
      axis: null,
      dir: null,
    };
    this._setGridCanvasCursor("crosshair");
    return true;
  }

  async updateFillDrag(wPos) {
    const fd = this.m_FillDrag;
    if (fd == null) {
      return;
    }
    const wCell = await this.m_SpInterface.cellFromGridMouse(wPos.X, wPos.Y);
    const wRow = Math.max(1, Math.min(SK_MAX_ROW, wCell.row));
    const wCol = Math.max(1, Math.min(SK_MAX_COL, wCell.col));

    // How far the pointer sits outside the source box on each axis.
    let wOverV = 0;
    if (wRow > fd.sourceBottom) {
      wOverV = wRow - fd.sourceBottom;
    } else if (wRow < fd.sourceTop) {
      wOverV = fd.sourceTop - wRow;
    }
    let wOverH = 0;
    if (wCol > fd.sourceRight) {
      wOverH = wCol - fd.sourceRight;
    } else if (wCol < fd.sourceLeft) {
      wOverH = fd.sourceLeft - wCol;
    }

    // Reset extension until an axis is engaged.
    fd.axis = null;
    fd.dir = null;
    fd.extTop = fd.extLeft = fd.extBottom = fd.extRight = null;
    fd.destTop = fd.sourceTop;
    fd.destLeft = fd.sourceLeft;
    fd.destBottom = fd.sourceBottom;
    fd.destRight = fd.sourceRight;

    if (wOverV === 0 && wOverH === 0) {
      this.invalidateOverlays();
      return;
    }

    // Excel constrains the fill to a single dominant axis (vertical wins ties).
    if (wOverV >= wOverH) {
      fd.axis = "v";
      if (wRow > fd.sourceBottom) {
        fd.dir = "down";
        fd.destBottom = wRow;
        fd.extTop = fd.sourceBottom + 1;
        fd.extBottom = wRow;
      } else {
        fd.dir = "up";
        fd.destTop = wRow;
        fd.extTop = wRow;
        fd.extBottom = fd.sourceTop - 1;
      }
      fd.extLeft = fd.sourceLeft;
      fd.extRight = fd.sourceRight;
    } else {
      fd.axis = "h";
      if (wCol > fd.sourceRight) {
        fd.dir = "right";
        fd.destRight = wCol;
        fd.extLeft = fd.sourceRight + 1;
        fd.extRight = wCol;
      } else {
        fd.dir = "left";
        fd.destLeft = wCol;
        fd.extLeft = wCol;
        fd.extRight = fd.sourceLeft - 1;
      }
      fd.extTop = fd.sourceTop;
      fd.extBottom = fd.sourceBottom;
    }
    this.invalidateOverlays();
  }

  endFillSession() {
    this.m_FillDrag = null;
    this.resetSelectionMoveCursor();
  }

  // Wheel is on window; pointer may be over SkSpCellClass overlays above the canvas.
  isPointerOverGridCanvas(event) {
    const wCanvas = this.m_Ref.current;
    if (!wCanvas) {
      return false;
    }
    const wRect = wCanvas.getBoundingClientRect();
    const wX = event.clientX;
    const wY = event.clientY;
    return (
      wX >= wRect.left &&
      wX <= wRect.right &&
      wY >= wRect.top &&
      wY <= wRect.bottom
    );
  }

  /**
   * True when the event target is a scrollbar overlay canvas. The scrollbars sit on top of the grid
   * canvas, so a purely geometric hit test (isPointerOverGridCanvas) also matches the scrollbar area;
   * this lets the window mousemove handler skip grid hover work while the pointer is on a scrollbar.
   */
  isEventOnScrollbar(event) {
    const wTarget = event?.target;
    if (!wTarget) {
      return false;
    }
    const wClass =
      typeof wTarget.className === "string"
        ? wTarget.className
        : wTarget.className && typeof wTarget.className.baseVal === "string"
          ? wTarget.className.baseVal
          : "";
    return wClass === "SkVScrollBar" || wClass === "SksetHScrollBar";
  }

  async mouseDown(event) {
    // m_SpInterface is nulled on unmount; a lingering window listener from a fast
    // mount/unmount cycle (e.g. StrictMode) can still fire — bail out safely.
    if (!this.m_SpInterface) {
      return;
    }
    if (this.state.menuPopUp) {
      return;
    }
    if (this.state.tableFilterPopup) {
      this.m_SpInterface?.closeTableFilterPopup?.();
    }
    if (this.m_SpInterface?.isFloatingObjectDragging?.()) {
      return;
    }
    if (this.m_SpInterface?.isPointerOverFloatingObject?.(event)) {
      return;
    }
    // Right-click is reserved for the cell context menu (Insert/Delete by rect).
    // Let the browser's `contextmenu` event drive the popup and keep canvas focus.
    if (event.button === 2) {
      if (this.isEventOnClass(event)) {
        this.m_Ref.current.focus();
      }
      return;
    }
    if (this.isEventOnClass(event)) {
      this.m_MouseDown=true;
      // Use zoom-aware coords (CSS zoom breaks event.offsetX/Y).
      let wPos = this.offsetMousePos(event);
      // Row/column outlines live in LeftPanel / TopPanel — no tree gutters on the grid.
      const wTreeLeft = this.m_SpInterface.gridTreeViewLeft?.() ?? 0;
      const wTreeTop = this.m_SpInterface.gridTreeViewTop?.() ?? 0;

      if ((wPos.X < wTreeLeft) || (wPos.Y < wTreeTop)) {
        return;
      }
      // Convert for client coordinates
      wPos = this.MouseTreeViewRelative(event);
      if (!event.shiftKey && !event.metaKey && !this.m_SpInterface.getUseEdit()) {
        const wFilterHit = await this.m_SpInterface.hitTestTableFilterButton(
          wPos.X,
          wPos.Y
        );
        if (wFilterHit) {
          this.m_MouseDown = false;
          if (this.m_SpInterface) {
            this.m_SpInterface.m_MouseDown = false;
          }
          await this.m_SpInterface.openTableFilterPopup(
            wFilterHit,
            event.clientX,
            event.clientY
          );
          event.stopPropagation();
          event.preventDefault();
          return;
        }
      }
      if (!event.shiftKey && !event.metaKey && !this.m_SpInterface.getUseEdit()) {
        const wStartedFill = await this.tryBeginFill(wPos, event);
        if (wStartedFill) {
          this.m_MouseDown = true;
          await this.updateFillDrag(wPos);
          this.invalidateOverlays();
          if (!this.m_SpInterface.getUseEdit()) {
            this.m_Ref.current.focus();
          }
          event.stopPropagation();
          event.preventDefault();
          return;
        }
      }
      if (!event.shiftKey && !event.metaKey && !this.m_SpInterface.getUseEdit()) {
        const wStartedMove = await this.tryBeginDragMove(wPos, event);
        if (wStartedMove) {
          this.m_MouseDown = true;
          await this.updateDragMove(wPos);
          this.invalidateOverlays();
          if (!this.m_SpInterface.getUseEdit()) {
            this.m_Ref.current.focus();
          }
          event.stopPropagation();
          event.preventDefault();
          return;
        }
      }
      // Shift+click or Cmd (Meta)+click: add a discontiguous selection. Bypass
      // mouseDownSelect (which would re-anchor the cursor and drop the other cells).
      if ((event.shiftKey || event.metaKey) && !this.m_SpInterface.getUseEdit()) {
        await this.m_SpInterface.mouseShiftSelect(wPos);
        this.m_MouseDown = true;
        this.m_SpInterface.invalidateAll();
        this.m_Ref.current.focus();
        event.stopPropagation();
        event.preventDefault();
        return;
      }
      if (!event.shiftKey && !event.metaKey) {
        this.m_SpInterface.razAllselect();
      }

      // Make sure MouseDownSelect returns a promise
      await this.m_SpInterface.mouseDownSelect(wPos);

      this.m_SpInterface.invalidateAll();
      if (!this.m_SpInterface.getUseEdit()) {
        this.m_Ref.current.focus();
      }
      event.stopPropagation();
      event.preventDefault();
    }
  }

  async mouseMove(event) {
    // m_SpInterface is nulled on unmount; a lingering window listener from a fast
    // mount/unmount cycle (e.g. StrictMode) can still fire — bail out safely.
    if (!this.m_SpInterface) {
      return;
    }
    if (this.m_SpInterface?.isFloatingObjectDragging?.()) {
      return;
    }
    if (this.m_FillDrag != null) {
      const wPos = this.MouseTreeViewRelative(event);
      await this.updateFillDrag(wPos);
      return;
    }
    if (this.m_DragMove != null) {
      const wPos = this.MouseTreeViewRelative(event);
      await this.updateDragMove(wPos);
      return;
    }
    if (this.m_SpInterface.m_SkSpGridCanvas!==null) {
      if (this.m_MouseDown) {
        this.m_DragSelecting=true;
        let wPos=this.MouseTreeViewRelative(event);
        await this.m_SpInterface.mouseMoveSelect(wPos);
        // mouseMoveSelect already repaints overlays; full cell/grid paint only when auto-scroll reloads the view.
      } else if (
        this.isPointerOverGridCanvas(event) &&
        !this.isEventOnScrollbar(event) &&
        !this.m_SpInterface?._isScrollbarDragActive?.()
      ) {
        const wPos = this.MouseTreeViewRelative(event);
        await this.updateSelectionMoveCursor(wPos);
      } else {
        this.resetSelectionMoveCursor();
      }
    }
  }

  async mouseUp(event) {
    // m_SpInterface is nulled on unmount; a lingering window listener from a fast
    // mount/unmount cycle (e.g. StrictMode) can still fire — bail out safely.
    if (!this.m_SpInterface) {
      return;
    }
    if (this.m_SpInterface?.isFloatingObjectDragging?.()) {
      return;
    }
    if (this.m_SpInterface?.isSpreadsheetDisposed?.()) {
      return;
    }
    if (this.m_FillDrag != null) {
      const wFill = this.m_FillDrag;
      try {
        await this.m_SpInterface.commitFill(wFill);
      } finally {
        this.endFillSession();
        this.m_MouseDown = false;
        if (this.m_SpInterface) {
          this.m_SpInterface.m_MouseDown = false;
        }
        this.m_SpInterface.invalidateAll();
      }
      return;
    }
    if (this.m_DragMove != null) {
      const wDrag = this.m_DragMove;
      try {
        await this.m_SpInterface.commitDragMove(wDrag);
      } finally {
        this.endDragMoveSession();
        this.m_MouseDown = false;
        if (this.m_SpInterface) {
          this.m_SpInterface.m_MouseDown = false;
        }
        this.m_SpInterface.invalidateAll();
      }
      return;
    }
    const wasDragSelecting=this.m_DragSelecting;
    try {
      if (this.m_SpInterface.m_SkSpGridCanvas!==null) {
        let wPos=this.MouseTreeViewRelative(event);
        await this.m_SpInterface.mouseUpSelect(wPos);
        this.invalidateOverlays();
      }
    } finally {
      this.m_MouseDown=false;
      this.m_DragSelecting=false;
      if (this.m_SpInterface) {
        this.m_SpInterface.m_MouseDown=false;
      }
      if (wasDragSelecting) {
        this.m_SuppressWheelUntilMs=Date.now()+300;
      }
    }
  }

  _normalizeWheelDelta(value, deltaMode, pageSizePx) {
    if (!Number.isFinite(value) || value === 0) {
      return 0;
    }
    if (deltaMode === 1) {
      return value * 40;
    }
    if (deltaMode === 2) {
      return value * Math.max(1, pageSizePx || 0);
    }
    return value;
  }

  /** Suppress cross-axis noise on one scroll sample (wheel or touch pan). */
  _applyScrollAxisDominance(sDeltaX, sDeltaY, sShiftKey = false) {
    let wValueH = sDeltaX;
    let wValueV = sDeltaY;
    if (sShiftKey) {
      wValueV = 0;
    } else {
      const wAbsX = Math.abs(wValueH);
      const wAbsY = Math.abs(wValueV);
      const wAxisDominanceRatio = 1.25;
      if (wAbsY >= wAbsX * wAxisDominanceRatio) {
        wValueH = 0;
      } else if (wAbsX >= wAbsY * wAxisDominanceRatio) {
        wValueV = 0;
      }
    }
    return { deltaX: wValueH, deltaY: wValueV };
  }

  _scheduleWheelScroll(deltaX, deltaY) {
    const pending = this._pendingWheelScroll || { deltaX: 0, deltaY: 0 };
    pending.deltaX += deltaX;
    pending.deltaY += deltaY;
    this._pendingWheelScroll = pending;
    // Serialize: one RAF and one in-flight getView at a time. Overlapping scrollViewByWheelDelta
    // (async getView + invalidateAll) across frames could tear the paint (rows at different scroll
    // offsets) and race m_DiffX/m_UIView. Coalesced deltas are flushed after the current one settles.
    if (this._wheelScrollRaf != null || this._wheelScrollBusy) {
      return;
    }
    this._wheelScrollRaf = requestAnimationFrame(async () => {
      this._wheelScrollRaf = null;
      const next = this._pendingWheelScroll;
      this._pendingWheelScroll = null;
      if (!next || !this.m_SpInterface) {
        return;
      }
      this._wheelScrollBusy = true;
      try {
        await this.m_SpInterface.scrollViewByWheelDelta(next.deltaX, next.deltaY);
      } catch (err) {
        console.error("wheel scroll getView:", err);
      } finally {
        this._wheelScrollBusy = false;
        if (this._pendingWheelScroll) {
          this._scheduleWheelScroll(0, 0);
        }
      }
    });
  }

  async mouseWheel(event) {
    // m_SpInterface is nulled on unmount; a lingering window listener from a fast
    // mount/unmount cycle (e.g. StrictMode) can still fire — bail out safely.
    if (!this.m_SpInterface) {
      return;
    }
    // Let floating/overlay UI scroll on its own: the wheel listener sits on the
    // spreadsheet root, so events bubbling up from a modal/menu that sits over
    // the grid would otherwise be preventDefault()ed here and scroll the sheet
    // instead of the overlay (isPointerOverGridCanvas is purely geometric and
    // can't tell an overlay is on top).
    if (
      event.target?.closest?.(
        ".SkTableFilterPopup, .SkListBox, .SkModal-overlay, .SkMenuPopUp, .SkSpFormulaFuncSuggest"
      )
    ) {
      return;
    }
    if (!this.isPointerOverGridCanvas(event)) {
      return;
    }
    // Block browser page zoom (Ctrl/Cmd + wheel); plain wheel still scrolls the grid below.
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      return;
    }
    // Ignore wheel while selecting (button down) and briefly after drag-select
    // ends: trackpad inertia emits small wheel deltas on mouseup.
    if (
      this.m_MouseDown ||
      this.m_DragSelecting ||
      this.m_SpInterface?.m_MouseDown ||
      Date.now() < this.m_SuppressWheelUntilMs
    ) {
      event.preventDefault();
      return;
    }

    let wValueV = this._normalizeWheelDelta(
      event.deltaY,
      event.deltaMode,
      this.m_SpInterface?.m_ClientHeight
    );
    let wValueH = this._normalizeWheelDelta(
      event.deltaX,
      event.deltaMode,
      this.m_SpInterface?.m_ClientWidth
    );
    // Shift+wheel horizontal scroll: macOS browsers may emit deltaX or keep deltaY.
    if (event.shiftKey && Math.abs(wValueV) > Math.abs(wValueH)) {
      wValueH = wValueV;
      wValueV = 0;
    }
    if (wValueH === 0 && wValueV === 0) {
      event.preventDefault();
      return;
    }
    const wLocked = this._applyScrollAxisDominance(wValueH, wValueV, event.shiftKey);
    wValueH = wLocked.deltaX;
    wValueV = wLocked.deltaY;
    if (wValueH === 0 && wValueV === 0) {
      event.preventDefault();
      return;
    }

    this._scheduleWheelScroll(wValueH, wValueV);
    event.preventDefault();
  }

  /** Prevent Safari trackpad pinch from zooming the whole page over the grid. */
  blockBrowserZoomGesture(event) {
    event.preventDefault();
  }

  getCanvasCoordinates(e) {
    const wCanvas = this.m_Ref.current;
    if (!wCanvas || !this.m_SpInterface) {
      return { X: 0, Y: 0 };
    }
    const wPt = pointerToLayoutPx(wCanvas, e.clientX, e.clientY);
    return {
      X: wPt.x - (this.m_SpInterface.gridTreeViewLeft?.() ?? 0),
      Y: wPt.y - (this.m_SpInterface.gridTreeViewTop?.() ?? 0),
    };
  }

  CalculateTouchDistance = (touches) => {
    const [touch1, touch2] = touches;
    const dx = (touch1.pageX - touch2.pageX) - (this.m_SpInterface.gridTreeViewLeft?.() ?? 0);
    const dy = (touch1.pageY - touch2.pageY) - (this.m_SpInterface.gridTreeViewTop?.() ?? 0);
    return Math.sqrt(dx * dx + dy * dy);
  };

  /** Layout-pixel scroll delta from a touch pan sample (finger drag inverts to sheet motion). */
  _touchPanScrollDelta(sIncX, sIncY) {
    const wLocked = this._applyScrollAxisDominance(-sIncX, -sIncY, false);
    return wLocked;
  }

  handleTouchStart = async (e) => {
    if (e.touches.length === 2) {
      // Two-finger zoom
      this.initialDistance = this.CalculateTouchDistance(e.touches);
      this.initialTouch1 = { x: e.touches[0].pageX, y: e.touches[0].pageY };
      this.initialTouch2 = { x: e.touches[1].pageX, y: e.touches[1].pageY };
    } else {
      // Gestion du double-tap
      const touch = e.touches[0];
      const currentTime = Date.now();
      const currentX = touch.pageX;
      const currentY = touch.pageY;

      // Check whether it is a double-tap
      if (currentTime - this.lastTapTime < this.doubleTapDelay) {
        const distance = Math.sqrt(
          Math.pow(currentX - this.lastTapX, 2) + 
          Math.pow(currentY - this.lastTapY, 2)
        );

        if (distance < this.doubleTapDistance) {
          try {
            const wPos = this.getCanvasCoordinates({
              clientX: currentX,
              clientY: currentY,
            });
            await this.m_SpInterface.mouseDownSelect(wPos);
            this.m_SpInterface.m_MouseDown = false;
          } catch (selectError) {
            console.warn('mouseDownSelect on double-tap failed', selectError);
            this.m_SpInterface.m_MouseDown = false;
          }
          try {
            await this.m_SpInterface.beginEdit();
          } catch (editError) {
            console.warn('beginEdit on double-tap failed', editError);
          }
          this.m_SpInterface.invalidateAll();
          // Reset tap tracking so the touchend that follows this second tap
          // does not also move the cursor again.
          this.lastTapTime = 0;
          this.tapStartClientX = undefined;
          e.preventDefault();
          return;
        }
      }

      // Update the coordinates of the last tap
      this.lastTapTime = currentTime;
      this.lastTapX = currentX;
      this.lastTapY = currentY;

      // Single-finger movement
      this.initialTouch = { x: touch.pageX, y: touch.pageY };
      this._lastScrollTouchX = touch.clientX;
      this._lastScrollTouchY = touch.clientY;

      // Tap-vs-drag tracking: a finger that touches and lifts without
      // travelling more than `tapMoveThreshold` and within `tapMaxDuration`
      // ms is interpreted as a tap and places the cursor on the touched
      // cell (handled in handleTouchEnd). A move beyond the threshold
      // promotes the gesture to a scroll/drag.
      this.tapStartTime = currentTime;
      this.tapStartClientX = touch.clientX;
      this.tapStartClientY = touch.clientY;
      this.didMove = false;
      this.tapMoveThreshold = 8;     // pixels
      this.tapMaxDuration = 350;     // ms
      
      // Reset inertia variables
      this.lastTouchTime = Date.now();
      this.lastTouchX = touch.pageX;
      this.lastTouchY = touch.pageY;
      this.velocityX = 0;
      this.velocityY = 0;
      this.isInertialScrolling = false;
      
      // Cancel any running inertial scroll; snap like wheel/scrollbar so the top scroll row is not stuck half-visible.
      const wCancelledInertia = this.animationFrame != null;
      if (wCancelledInertia) {
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
        void this.m_SpInterface.finishVerticalScrollSnap();
      }
    }
    e.preventDefault();
  };

  handleTouchMove = async (e) => {
    if (e.touches.length === 2) {
      // Gestion du zoom
      const currentDistance = this.CalculateTouchDistance(e.touches);
      const scaleFactor = currentDistance / this.initialDistance;
      
      // Clamp the zoom between 0.5 and 3
      const newZoom = Math.min(Math.max(this.m_SpInterface.m_Zoom * scaleFactor, 0.5), 3);
      this.m_SpInterface.m_Zoom = newZoom;
      this.m_SpInterface.applyZoom();
      
      // Refresh the view
      await this.m_SpInterface.reloadView();
      
      // Update initial distances
      this.initialDistance = currentDistance;
    } else if (e.touches.length === 1) {
      // Handle the drag
      const touch = e.touches[0];
      const currentTime = Date.now();
      const deltaTime = Math.max(1, currentTime - this.lastTouchTime);

      // Promote tap to drag once the finger has moved enough so the upcoming
      // touchend is no longer interpreted as a cursor-placing tap.
      if (!this.didMove && this.tapStartClientX !== undefined) {
        const moveDX = touch.clientX - this.tapStartClientX;
        const moveDY = touch.clientY - this.tapStartClientY;
        if (Math.hypot(moveDX, moveDY) > (this.tapMoveThreshold || 8)) {
          this.didMove = true;
        }
      }
      
      // Compute velocity in layout px/ms for inertial scroll after lift.
      const wScale = layoutToScreenScale(this.m_Ref.current);
      const incX = (touch.clientX - this._lastScrollTouchX) / wScale.x;
      const incY = (touch.clientY - this._lastScrollTouchY) / wScale.y;
      this.velocityX = incX / deltaTime;
      this.velocityY = incY / deltaTime;
      
      // Update the last positions
      this._lastScrollTouchX = touch.clientX;
      this._lastScrollTouchY = touch.clientY;
      this.lastTouchX = touch.pageX;
      this.lastTouchY = touch.pageY;
      this.lastTouchTime = currentTime;
      
      if (this.didMove) {
        const wPan = this._touchPanScrollDelta(incX, incY);
        if (wPan.deltaX !== 0 || wPan.deltaY !== 0) {
          this._scheduleWheelScroll(wPan.deltaX, wPan.deltaY);
        }
      }
    }
    e.preventDefault();
  };

  handleTouchEnd = async (e) => {
    if (e.touches.length === 0) {
      // Tap detection: lift without significant movement and within a short
      // window -> place the cursor on the cell under the finger.
      const now = Date.now();
      const tapDuration = now - (this.tapStartTime || 0);
      const wasTap =
        this.tapStartClientX !== undefined &&
        !this.didMove &&
        tapDuration < (this.tapMaxDuration || 350);

      if (wasTap) {
        try {
          const wPos = this.getCanvasCoordinates({
            clientX: this.tapStartClientX,
            clientY: this.tapStartClientY,
          });
          // Use the same path as a desktop mouse click so that:
          //  - the cursor moves (setCursorByMouse)
          //  - the formula bar (InplaceEditStatic) gets the cell value
          //    (invalidateSelection -> setTextByCursorCell)
          //  - peers see our new cursor position (sendMoveCell)
          // We then immediately release the m_MouseDown flag because there
          // is no "touchmove + touchend" sequence to clear it like the
          // mouse handlers do (no global mouseup on touch).
          await this.m_SpInterface.mouseDownSelect(wPos);
          this.m_SpInterface.m_MouseDown = false;
          this.m_SpInterface.invalidateAll();
        } catch (err) {
          // Best-effort: never let a tap break the touch loop.
          this.m_SpInterface.m_MouseDown = false;
        }
        this.tapStartClientX = undefined;
        e.preventDefault();
        return;
      }
      this.tapStartClientX = undefined;

      // Start inertial scrolling
      this.isInertialScrolling = true;
      
      const animate = () => {
        if (!this.isInertialScrolling) return;
        
        this.velocityX *= 0.85;
        this.velocityY *= 0.85;
        
        if (Math.abs(this.velocityX) < 0.02 && Math.abs(this.velocityY) < 0.02) {
          this.isInertialScrolling = false;
          try {
            void this.m_SpInterface.finishVerticalScrollSnap();
          } catch (err) {
            console.error('finishVerticalScrollSnap after inertial scroll:', err);
          }
          return;
        }
        
        const wFrameMs = 16;
        const wPan = this._touchPanScrollDelta(
          this.velocityX * wFrameMs,
          this.velocityY * wFrameMs
        );
        if (wPan.deltaX !== 0 || wPan.deltaY !== 0) {
          this._scheduleWheelScroll(wPan.deltaX, wPan.deltaY);
        }
        
        this.animationFrame = requestAnimationFrame(animate);
      };
      
      // Start the animation
      this.animationFrame = requestAnimationFrame(animate);
    }
    
    // Reset variables
    this.initialDistance = null;
    this.initialTouch = null;
    this.initialTouch1 = null;
    this.initialTouch2 = null;
    e.preventDefault();
  };

  contextMenu(event) {
    event.preventDefault();
    if (this.m_RefMenu.current) {
      this.m_RefMenu.current.SetPos(event);
      this.setState({ menuPopUp : true });
    }
  }

  closeMenuPopUp() {
    this.setState({ menuPopUp : false });
    this.restoreCanvasFocus();
  }

  // Focus restoration must happen AFTER React commits any pending renders
  // triggered by reloadView/invalidateAll, otherwise the <canvas> ends up
  // blurred and keyboard shortcuts become inactive.
  restoreCanvasFocus() {
    const wFocus = () => {
      if (this.m_Ref && this.m_Ref.current) {
        this.m_Ref.current.focus();
      }
    };
    wFocus();
    if (typeof window !== 'undefined' && window.requestAnimationFrame) {
      window.requestAnimationFrame(wFocus);
    } else {
      setTimeout(wFocus, 0);
    }
  }

  insertRowByRect() {
    this.closeMenuPopUp();
    this.m_SpInterface.insertRowByRect()
      .catch(error => { console.error("Error in insertRowByRect:", error); })
      .finally(() => { this.restoreCanvasFocus(); });
  }

  deleteRowByRect() {
    this.closeMenuPopUp();
    this.m_SpInterface.deleteRowByRect()
      .catch(error => { console.error("Error in deleteRowByRect:", error); })
      .finally(() => { this.restoreCanvasFocus(); });
  }

  insertColByRect() {
    this.closeMenuPopUp();
    this.m_SpInterface.insertColByRect()
      .catch(error => { console.error("Error in insertColByRect:", error); })
      .finally(() => { this.restoreCanvasFocus(); });
  }

  deleteColByRect() {
    this.closeMenuPopUp();
    this.m_SpInterface.deleteColByRect()
      .catch(error => { console.error("Error in deleteColByRect:", error); })
      .finally(() => { this.restoreCanvasFocus(); });
  }

  // Clipboard actions from the right-click menu (mirror the keyboard handlers).
  async contextCopy() {
    this.closeMenuPopUp();
    try {
      await this.m_SpInterface.copy();
    } catch (error) {
      console.error("Error in copy:", error);
    }
  }

  async contextCut() {
    this.closeMenuPopUp();
    try {
      await this.m_SpInterface.cut();
      this.m_SpInterface.invalidateAll();
    } catch (error) {
      console.error("Error in cut:", error);
    }
  }

  async contextPaste() {
    this.closeMenuPopUp();
    try {
      await this.m_SpInterface.paste();
      this.m_SpInterface.invalidateAll();
    } catch (error) {
      console.error("Error in paste:", error);
    }
  }

  // Insert a whole row / column (not a shifted rectangle) from the cursor.
  // Select the entire row/column of the current selection first so insertRow()/
  // insertCol() have a header selection to act on (otherwise m_SelectRow/Col is
  // empty and nothing happens).
  insertRowWhole() {
    this.closeMenuPopUp();
    this.m_SpInterface.selectAllRow();
    this.m_SpInterface.insertRow()
      .then(() => this.m_SpInterface.reloadView())
      .catch(error => { console.error("Error in insertRow:", error); });
  }

  insertColWhole() {
    this.closeMenuPopUp();
    this.m_SpInterface.selectAllColumn();
    this.m_SpInterface.insertCol()
      .then(() => this.m_SpInterface.reloadView())
      .catch(error => { console.error("Error in insertCol:", error); });
  }

  DrawJustifiedText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    const lines = [];
  
    // First pass: compute text lines
    for (let n = 0; n < words.length; n++) {
      let testLine = line + words[n] + ' ';
      let metrics = ctx.measureText(testLine);
      let testWidth = metrics.width;
  
      if (testWidth > maxWidth && n > 0) {
        lines.push(line.trim());
        line = words[n] + ' ';
      } else {
        line = testLine;
      }
    }
    lines.push(line.trim());
  
    // Second pass: draw the text
    lines.forEach((line, index) => {
      let wordsInLine = line.split(' ');
      let lineWidth = ctx.measureText(line).width;
  
      // Compute the spacing to add between words
      let gapCount = wordsInLine.length - 1;
      let totalGapWidth = maxWidth - lineWidth;
      let gapWidth = gapCount > 0 ? totalGapWidth / gapCount : 0;
  
      if (index === lines.length - 1) {
        // Draw the last line without justification
        ctx.fillText(line, x, y);
      } else {
        // Draw the justified lines
        let currentX = x;
        wordsInLine.forEach((word, i) => {
          ctx.fillText(word, currentX, y);
          currentX += ctx.measureText(word).width + gapWidth;
        });
      }
  
      y += lineHeight; // Vertically align the lines
    });
  }
 
  async paintCursor(sContext, sUI, vpWidth, vpHeight, absOffX = 0, absOffY = 0)  {
    const vpW = Number(vpWidth);
    const vpH = Number(vpHeight);
    const clampVp =
      Number.isFinite(vpW) &&
      vpW > 0 &&
      Number.isFinite(vpH) &&
      vpH > 0;

    // Whole-row / whole-column header selections: band highlight only (no local cell cursor).
    const hideLocalCursor =
      typeof this.m_SpInterface.hasColRowSelect === "function"
        ? this.m_SpInterface.hasColRowSelect()
        : (this.m_SpInterface.m_SelectRow?.selections?.()?.length || 0) > 0 ||
          (this.m_SpInterface.m_SelectCol?.selections?.()?.length || 0) > 0;

    let wCol = this.m_SpInterface.cursor().col();
    let wRow = this.m_SpInterface.cursor().row();

    if (!hideLocalCursor) {
    const fragments = await this.m_SpInterface.getOutlineRectFragmentsForCursorPaint(
      wRow,
      wCol
    );
    if (fragments.length > 0) {
     const { cursorColor, cursorHandleColor } = await this._cursorStrokeColorsForCell(
       wRow,
       wCol
     );
    const legacyFrozenClamp = fragments.length <= 1;
    sContext.save();
    const drawableFrags = fragments.filter(
      (f) => f.Width > 0 && f.Height > 0
    );
    drawableFrags.forEach((wCursorRect, idx) => {
      const isLastDrawn = idx === drawableFrags.length - 1;

     // Fine vertical scroll can make the first visible row fragment very short (c_h small).
     // A near-zero roundRect collapses to a horizontal stroke; expand toward top/left inside the cell band.
     const wMinStroke = 4;
     let crL = wCursorRect.Left - absOffX;
     let crT = wCursorRect.Top - absOffY;
     let crW = wCursorRect.Width;
     let crH = wCursorRect.Height;
     if (crW > 0 && crW < wMinStroke) {
       crL = crL + crW - wMinStroke;
       crW = wMinStroke;
     }
     if (crH > 0 && crH < wMinStroke) {
       crT = crT + crH - wMinStroke;
       crH = wMinStroke;
     }

      // Do not let the expanded cursor sit in the frozen band when the active cell is in the scroll pane.
      const fh = this.m_SpInterface.m_FrozenPixH;
      const frEnd = this.m_SpInterface.m_FrozenRowEnd;
      const fw = this.m_SpInterface.m_FrozenPixW;
      const fcEnd = this.m_SpInterface.m_FrozenColEnd;
      if (legacyFrozenClamp && fh > 0 && wRow > frEnd) {
        crT = Math.max(Math.ceil(Number(fh) || 0) - absOffY, crT);
      }
      if (legacyFrozenClamp && fw > 0 && wCol > fcEnd) {
        crL = Math.max(Math.ceil(Number(fw) || 0) - absOffX, crL);
      }

      if (clampVp) {
        const clipped = SkSpGridCanvas._clampRectToViewportCss(
          crL,
          crT,
          crW,
          crH,
          vpW,
          vpH
        );
        crL = clipped.Left;
        crT = clipped.Top;
        crW = clipped.Width;
        crH = clipped.Height;
      }

      if (crW > 0 && crH > 0) {
        const wPad = 1;
        const wL = crL - wPad;
        const wT = crT - wPad;
        const wR = crL + crW + wPad;
        const wB = crT + crH + wPad;
        this._strokeActiveCellOutline(
          sContext,
          wL,
          wT,
          wR,
          wB,
          cursorColor,
          cursorHandleColor,
          // The fill handle is drawn separately at the selection bottom-right
          // (paintFillHandle) so it is consistent for multi-cell selections.
          false && isLastDrawn
        );
      }
    });
     sContext.restore();
    }
    }

    // While editing a cell, expanded outline on the edited cell (matches inplace overlay).
    // Skip for side-panel range pickers (function dialog, named ranges, …).
    const wAttributePanelEdit =
      typeof this.m_SpInterface.isAttributePanelPropertyEdit === "function" &&
      this.m_SpInterface.isAttributePanelPropertyEdit();
    if (
      !hideLocalCursor &&
      this.m_SpInterface.getUseEdit() &&
      !this.m_SpInterface.isPropertyRangePickerEdit() &&
      this.m_SpInterface.m_CursorEdit != null &&
      (wAttributePanelEdit ||
        this.m_SpInterface.m_InplaceEditOverlayRect != null)
    ) {
      const wEditRow = this.m_SpInterface.m_CursorEdit.row();
      const wEditCol = this.m_SpInterface.m_CursorEdit.col();
      if (wRow !== wEditRow || wCol !== wEditCol) {
        const wEditFrags = await this.m_SpInterface.getOutlineRectFragmentsForCursorPaint(
          wEditRow,
          wEditCol
        );
        if (wEditFrags.length > 0) {
          const { cursorColor: wEditColor, cursorHandleColor: wEditHandle } =
            await this._cursorStrokeColorsForCell(wEditRow, wEditCol);
          sContext.save();
          wEditFrags.forEach((wCursorRect, idx) => {
            const isLastDrawn = idx === wEditFrags.length - 1;
            let crL = wCursorRect.Left - absOffX;
            let crT = wCursorRect.Top - absOffY;
            let crW = wCursorRect.Width;
            let crH = wCursorRect.Height;
            if (clampVp) {
              const clipped = SkSpGridCanvas._clampRectToViewportCss(
                crL,
                crT,
                crW,
                crH,
                vpW,
                vpH
              );
              crL = clipped.Left;
              crT = clipped.Top;
              crW = clipped.Width;
              crH = clipped.Height;
            }
            if (crW > 0 && crH > 0) {
              const wPad = 1;
              this._strokeActiveCellOutline(
                sContext,
                crL - wPad,
                crT - wPad,
                crL + crW + wPad,
                crT + crH + wPad,
                wEditColor,
                wEditHandle,
                false && isLastDrawn
              );
            }
          });
          sContext.restore();
        }
      }
    }

    // Draw remote cursors (same workbook/sheet only)
    try {
      const remotes = await this.m_SpInterface.getRemoteCursorsForCurrent();
      const selfEmail = sessionStorage.getItem('email');
      for (const rc of remotes) {
        if (!rc || rc.email === selfEmail) continue;
        const r = rc.row, c = rc.col;
        const rFrags = await this.m_SpInterface.getOutlineRectFragmentsForCursorPaint(r, c);
        if (rFrags.length === 0) {
          continue;
        }
        const legacyR = rFrags.length <= 1;
        sContext.save();
        const fhR = this.m_SpInterface.m_FrozenPixH;
        const frR = this.m_SpInterface.m_FrozenRowEnd;
        const fwR = this.m_SpInterface.m_FrozenPixW;
        const fcR = this.m_SpInterface.m_FrozenColEnd;
        let lastRb = null;
        for (let fi = 0; fi < rFrags.length; fi++) {
          const rect = rFrags[fi];
          if (rect.Width <= 0 || rect.Height <= 0) {
            continue;
          }
          sContext.strokeStyle = rc.color || '#ff4081';
          sContext.lineWidth = 1.5;
          const wMinRm = 4;
          let rl = rect.Left - absOffX;
          let rt = rect.Top - absOffY;
          let rw = rect.Width;
          let rh = rect.Height;
          if (rw > 0 && rw < wMinRm) {
            rl = rl + rw - wMinRm;
            rw = wMinRm;
          }
          if (rh > 0 && rh < wMinRm) {
            rt = rt + rh - wMinRm;
            rh = wMinRm;
          }
          if (legacyR && fhR > 0 && r > frR) {
            rt = Math.max(Math.ceil(Number(fhR) || 0) - absOffY, rt);
          }
          if (legacyR && fwR > 0 && c > fcR) {
            rl = Math.max(Math.ceil(Number(fwR) || 0) - absOffX, rl);
          }
          if (clampVp) {
            const cl = SkSpGridCanvas._clampRectToViewportCss(rl, rt, rw, rh, vpW, vpH);
            rl = cl.Left;
            rt = cl.Top;
            rw = cl.Width;
            rh = cl.Height;
          }
          if (rw > 0 && rh > 0) {
            const L = rl - sContext.lineWidth / 2;
            const T = rt - sContext.lineWidth / 2;
            const R = rl + rw + sContext.lineWidth / 2;
            const B = rt + rh + sContext.lineWidth / 2;
            lastRb = { R, B };
            sContext.beginPath();
            sContext.roundRect(L, T, R - L, B - T, 3);
            sContext.closePath();
            sContext.stroke();
          }
        }
        if (lastRb != null) {
            sContext.beginPath();
            sContext.fillStyle = rc.color || '#ff4081';
            const size = 3;
            sContext.arc(lastRb.R, lastRb.B, size, 0, 2 * Math.PI);
            sContext.closePath();
            sContext.fill();
            sContext.stroke();
            const mode = this.m_SpInterface.m_CursorLabelMode || 'firstname';
            if (mode === 'firstname') {
              const label = (rc.firstname && rc.firstname.length > 0)
                ? rc.firstname
                : (rc.email ? rc.email.split('@')[0] : '');
              if (label) {
                sContext.font = '12px sans-serif';
                sContext.fillStyle = rc.color || '#ff4081';
                sContext.textBaseline = 'bottom';
                sContext.fillText(label, lastRb.R + 6, lastRb.B - 2);
              }
            } else {
              const f = (rc.firstname || '').trim();
              const l = (rc.lastname || '').trim();
              let initials = '';
              if (f) initials += f[0].toUpperCase();
              if (l) initials += l[0].toUpperCase();
              if (!initials) {
                const local = (rc.email || '').split('@')[0] || '';
                initials = local.substring(0, 2).toUpperCase();
              }
              const radius = 10;
              const cx = lastRb.R + radius + 6;
              const cy = lastRb.B - radius - 2;
              sContext.beginPath();
              sContext.fillStyle = rc.color || '#ff4081';
              sContext.arc(cx, cy, radius, 0, 2 * Math.PI);
              sContext.closePath();
              sContext.fill();
              sContext.fillStyle = '#ffffff';
              sContext.font = '10px sans-serif';
              sContext.textAlign = 'center';
              sContext.textBaseline = 'middle';
              sContext.fillText(initials, cx, cy + 0.5);
            }
        }
          sContext.restore();
      }
    } catch(_) {}
  };

  async paintSelection (sContext, sUI, sWidth, sHeight, absOffX = 0, absOffY = 0) {
    sContext.save();
    
    sContext.fillStyle = this.m_ColorSelect;
    sContext.strokeStyle = this.m_ColorSelect;
    sContext.globalAlpha = 1;

    const splitActive =
      this.m_SpInterface.isFrozenSplitActive() ||
      this.m_SpInterface.isFrozenColSplitActive();

    const drawPx = (px, sStrokeOnDark = false) => {
      if (px && px.Width > 0 && px.Height > 0) {
        const wLeft = px.Left - absOffX;
        const wTop = px.Top - absOffY;
        if (sStrokeOnDark) {
          sContext.fillStyle = "rgba(0, 120, 212, 0.38)";
        } else {
          sContext.fillStyle = this.m_ColorSelect;
        }
        sContext.fillRect(wLeft, wTop, px.Width, px.Height);
        if (sStrokeOnDark) {
          sContext.strokeStyle = "#FFFFFF";
          sContext.lineWidth = 1;
          sContext.strokeRect(wLeft + 0.5, wTop + 0.5, px.Width - 1, px.Height - 1);
        }
      }
    };

    const isDarkSelectionRect = async (wRange) => {
      const wLum = await this._resolveCellBackgroundLuminance(
        wRange.row(),
        wRange.col()
      );
      return wLum != null && wLum < 128;
    };

    const fillRangePx = async (wRange) => {
      if (splitActive) {
        const parts = await this.m_SpInterface.getRectPixelFragments(wRange);
        const wStrokeOnDark = await isDarkSelectionRect(wRange);
        for (const px of parts) {
          drawPx(px, wStrokeOnDark);
        }
        return;
      }
      const wRangePx = await this.m_SpInterface.getRectPixel(wRange);
      const wStrokeOnDark = await isDarkSelectionRect(wRange);
      drawPx(wRangePx, wStrokeOnDark);
    };
    
    // Handle normal selections
    for (const wRange of this.m_SpInterface.m_Select.selections()) {
      await fillRangePx(wRange);
    }

    // Handle row selections
    if (this.m_SpInterface.m_SelectRow !== null) {
      const rowFrOnly = this.m_SpInterface.isFrozenSplitActive();
      const colFrOnly =
        this.m_SpInterface.isFrozenColSplitActive() && !rowFrOnly;
      const fc = Number(this.m_SpInterface.m_FrozenColEnd) || 0;
      for (const wInterval of this.m_SpInterface.m_SelectRow.selections()) {
        let cStart = sUI.topcol;
        let cEnd = this.m_SpInterface._uiLastVisibleCol(sUI);
        if (colFrOnly && fc > 0) {
          // paintSelection is called with scroll UI only; widen column span so fragments
          // include frozen A..fc and scroll cols. Drawing full-width fillRect below would paint
          // selection over the frozen band and hide grid/cell raster.
          cStart = 1;
          cEnd = Math.max(fc, this.m_SpInterface._uiLastVisibleCol(sUI) || fc);
        }
        const wRange = new tRange(
          wInterval.m_Begin,
          cStart,
          wInterval.m_End,
          cEnd
        );
        if (splitActive) {
          const parts = await this.m_SpInterface.getRectPixelFragments(wRange);
          for (const px of parts) {
            drawPx(px);
          }
        } else {
          const wRangePx = await this.m_SpInterface.getRectPixel(wRange);
          sContext.fillRect(
              0,
              wRangePx.Top - absOffY,
              sWidth,
              wRangePx.Height);
        }
      }
    }

    // Handle column selections
    if (this.m_SpInterface.m_SelectCol !== null) {
      const { top: wRowTop, bottom: wRowBottom } = this.m_SpInterface.visibleGridRowExtent();
      for (const wInterval of this.m_SpInterface.m_SelectCol.selections()) {
        const wRange = new tRange(wRowTop, wInterval.m_Begin, wRowBottom, wInterval.m_End);
        if (splitActive) {
          const parts = await this.m_SpInterface.getRectPixelFragments(wRange);
          for (const px of parts) {
            drawPx(px);
          }
        } else {
          const wRangePx = await this.m_SpInterface.getRectPixel(wRange);
          sContext.fillRect(    
              wRangePx.Left - absOffX,
              0,
              wRangePx.Width,
              sHeight);
        }
      }
    }

    sContext.restore();
  };

  /**
   * @param {"off"|"frozenRowBandY0"} rowFreezeSeamMode
   *        frozenRowBandY0: y=0 is sheet top; extend likely-merge fills down to the horizontal freeze seam
   *        so JsonView merge clamps do not leave a white gap above the split bar (issue is horizontal spill).
   */
  paintCellStack = (sContext, sUI, rowFreezeSeamMode = "off") => {
    const sp = this.m_SpInterface;
    paintJsonViewCellStack(sContext, sUI, this.m_CellCanvas, {
      rowFreezeSeamMode,
      frozenPixH: sp?.m_FrozenPixH,
      isFrozenSplitActive: sp?.isFrozenSplitActive?.() === true,
      spInterface: sp,
    });
  };

  paintSizerOverlay = (sContext, sWidth, sHeight, absOffX = 0, absOffY = 0) => {
    sContext.save();
    let wSizer=this.m_SpInterface.m_Sizer;
    if (wSizer.active()) {
      sContext.beginPath();
      sContext.strokeStyle='blue';
      sContext.setLineDash([2, 2]);
      sContext.lineWidth =2;
      if (wSizer.top()) {
          sContext.moveTo(wSizer.move() - absOffX, 0);
          sContext.lineTo(wSizer.move() - absOffX, sHeight);
          sContext.stroke();
        } else {
          sContext.moveTo(0, wSizer.move() - absOffY);
          sContext.lineTo(sWidth, wSizer.move() - absOffY);
          sContext.stroke();
        }
        sContext.setLineDash([]);
    }
    sContext.restore();
  };

  paintGridForPane = async (
    sContext,
    sUI,
    sWidth,
    paneTop,
    paneHeight,
    xLineOffset = 0,
    xSpanLo = null,
    xSpanHi = null
  ) => {
    const xLo = xSpanLo != null ? xSpanLo : 0;
    const xHi = xSpanHi != null ? xSpanHi : sWidth;
    sContext.save();
    sContext.beginPath();
    sContext.rect(xLo, paneTop, xHi - xLo, paneHeight);
    sContext.clip();
    if (this.m_SpInterface.m_GridVisible) {
      // Merge rects (sheet + pixels): omit dotted grid segments inside merged blocks so borderless
      // merges do not show a false "internal grid". Do not use clip-to-merges-only (that hid the rest).
      let mergeSheetAndPx = mergeSheetAndPxFromJsonViewUi(sUI);
      if (mergeSheetAndPx == null && window.SkUISpreadSheet != null) {
        mergeSheetAndPx = [];
        const refStr =
          window.SkUISpreadSheet.base10toAlphaSync(sUI.topcol) +
          sUI.toprow +
          ":" +
          window.SkUISpreadSheet.base10toAlphaSync(sUI.lastcol) +
          sUI.lastrow;
        const mergedJson = window.SkUISpreadSheet.returnRangeMerged(refStr);
        if (mergedJson !== "") {
          try {
            const parsed = JSON.parse(mergedJson);
            if (parsed.rs && Array.isArray(parsed.rs)) {
              for (const wR of parsed.rs) {
                const wRange = new tRange(wR.r_t, wR.r_l, wR.r_b, wR.r_r);
                const px = await this.m_SpInterface.getRectPixel(wRange);
                if (px.Width > 0 && px.Height > 0) {
                  mergeSheetAndPx.push({
                    r_t: Number(wR.r_t),
                    r_l: Number(wR.r_l),
                    r_b: Number(wR.r_b),
                    r_r: Number(wR.r_r),
                    px,
                  });
                }
              }
            }
          } catch (e) {
            console.error("paintGridForPane: merge JSON", e);
          }
        }
      }
      if (mergeSheetAndPx == null) {
        mergeSheetAndPx = [];
      }

      const mergeIndex =
        mergeSheetAndPx.length > 0
          ? indexMergeRectsByRowAndCol(mergeSheetAndPx)
          : null;

      sContext.beginPath();
      sContext.lineWidth = this.m_SpInterface.m_GridWidth;
      sContext.strokeStyle = this.m_SpInterface.m_GridColor;
      sContext.setLineDash([]);
      // Grid stepping matches JsonView: dX/dY on origin, full row/col sizes.
      let wPosY = paneTop + this.m_SpInterface._uiPaneDY(sUI);
      for(let wY=0; wY< sUI.rows.length; wY++) {
        let wSizeRow=sUI.rows[wY].s;
        wPosY += wSizeRow;
        if (wSizeRow!==0) {
          let intervals = [[xLo, xHi]];
          const rA = sUI.rows[wY].i;
          // byRow indexes bottoms that are internal to a merge (r_t <= r < r_b).
          // Do not require the next *visible* row to be rA+1 — collapsed tree rows
          // skip indices and would otherwise leave grid strokes through the merge.
          if (mergeIndex != null) {
            const rowMerges = mergeIndex.byRow.get(rA);
            if (rowMerges) {
              for (const m of rowMerges) {
                const L = m.px.Left;
                const R = m.px.Left + m.px.Width;
                intervals = subtractInterval1D(intervals, L, R);
              }
            }
          }
          for (const [x0, x1] of intervals) {
            if (x1 - x0 > 0.5) {
              sContext.moveTo(x0, wPosY);
              sContext.lineTo(x1, wPosY);
            }
          }
        }
      }
      let wPosX = this.m_SpInterface._uiPaneDX(sUI);
      for(let wX=0; wX< sUI.cols.length; wX++) {
        let wSizeCol=sUI.cols[wX].s;
        wPosX+=wSizeCol;
        if (wSizeCol!==0) {
          let yInts = [[paneTop, paneTop + paneHeight]];
          const cA = sUI.cols[wX].i;
          // Same as rows: byCol already stores internal edges only; collapsed
          // outline columns must not reintroduce vertical grid through merges.
          if (mergeIndex != null) {
            const colMerges = mergeIndex.byCol.get(cA);
            if (colMerges) {
              for (const m of colMerges) {
                const T = m.px.Top;
                const B = m.px.Top + m.px.Height;
                yInts = subtractInterval1D(yInts, T, B);
              }
            }
          }
          for (const [y0, y1] of yInts) {
            if (y1 - y0 > 0.5) {
              sContext.moveTo(xLineOffset + wPosX, y0);
              sContext.lineTo(xLineOffset + wPosX, y1);
            }
          }
        }
      }
      sContext.stroke();
    }
    sContext.restore();
  };

  paintFreezeColumnSplit = async (
    sContext,
    leftUI,
    scrollUI,
    sWidth,
    fullH,
    frozenW,
    scrollW
  ) => {
    // JsonView emission keeps c_x in [0, viewWidth] for this pane (SKJsonView.cpp). Match
    // getRectPixelByColRow (xOff + c_x with xOff = frozenW for the scroll strip).
    // Do not skip translate based on probing c_x: local c_x can still be a large fraction of
    // frozenW (narrow freeze + wide first column / fine scroll), which would clip all ink if
    // we used scrollTx=0 with rect(frozenW,…).
    sContext.save();
    sContext.translate(frozenW, 0);
    sContext.beginPath();
    sContext.rect(0, 0, scrollW, fullH);
    sContext.clip();
    this.paintCellStack(sContext, scrollUI, "off");
    sContext.restore();

    sContext.save();
    sContext.beginPath();
    sContext.rect(0, 0, frozenW, fullH);
    sContext.clip();
    this.paintCellStack(sContext, leftUI, "off");
    sContext.restore();

    const splitBarW = 3;
    sContext.save();
    sContext.fillStyle = "rgba(90, 90, 90, 0.92)";
    sContext.fillRect(
      frozenW - Math.floor(splitBarW / 2),
      0,
      splitBarW,
      fullH
    );
    sContext.restore();

    await this.paintGridForPane(
      sContext,
      leftUI,
      sWidth,
      0,
      fullH,
      0,
      0,
      frozenW
    );
    await this.paintGridForPane(
      sContext,
      scrollUI,
      sWidth,
      0,
      fullH,
      frozenW,
      frozenW,
      sWidth
    );
  };

  paintFreezeFourPane = async (
    sContext,
    cornerUI,
    topUI,
    leftUI,
    mainUI,
    sWidth,
    sHeight,
    frozenH,
    frozenW
  ) => {
    const scrollH = Math.max(1, sHeight - frozenH);
    const scrollW = Math.max(1, sWidth - frozenW);

    // Default: canvas cell ink in every quadrant ("off" avoids row-split-only merged-fill seam tweaks).
    // Back-to-front: paint scroll (main) last.
    sContext.save();
    sContext.beginPath();
    sContext.rect(0, 0, frozenW, frozenH);
    sContext.clip();
    this.paintCellStack(sContext, cornerUI, "off");
    sContext.restore();

    sContext.save();
    sContext.translate(frozenW, 0);
    sContext.beginPath();
    sContext.rect(0, 0, scrollW, frozenH);
    sContext.clip();
    this.paintCellStack(sContext, topUI, "off");
    sContext.restore();

    sContext.save();
    sContext.translate(0, frozenH);
    sContext.beginPath();
    sContext.rect(0, 0, frozenW, scrollH);
    sContext.clip();
    this.paintCellStack(sContext, leftUI, "off");
    sContext.restore();

    sContext.save();
    sContext.translate(frozenW, frozenH);
    sContext.beginPath();
    sContext.rect(0, 0, scrollW, scrollH);
    sContext.clip();
    this.paintCellStack(sContext, mainUI, "off");
    sContext.restore();

    const barW = 3;
    const barH = 3;
    sContext.save();
    sContext.fillStyle = 'rgba(90, 90, 90, 0.92)';
    sContext.fillRect(frozenW - Math.floor(barW / 2), 0, barW, sHeight);
    sContext.fillRect(0, frozenH - Math.floor(barH / 2), sWidth, barH);
    sContext.restore();

    await this.paintGridForPane(
      sContext,
      cornerUI,
      sWidth,
      0,
      frozenH,
      0,
      0,
      frozenW
    );
    await this.paintGridForPane(
      sContext,
      topUI,
      sWidth,
      0,
      frozenH,
      frozenW,
      frozenW,
      sWidth
    );
    await this.paintGridForPane(
      sContext,
      leftUI,
      sWidth,
      frozenH,
      scrollH,
      0,
      0,
      frozenW
    );
    await this.paintGridForPane(
      sContext,
      mainUI,
      sWidth,
      frozenH,
      scrollH,
      frozenW,
      frozenW,
      sWidth
    );
  };

  paintFreezeSplit = async (sContext, frozenUI, scrollUI, sWidth, frozenH, scrollH) => {
    // Scroll first with a strict local clip (no y < 0): negative dY must NOT extend the clip upward,
    // or the lower pane repaints over rows 1..5 while scrolling (overlapping labels and cell text).
    sContext.save();
    sContext.translate(0, frozenH);
    sContext.beginPath();
    sContext.rect(0, 0, sWidth, scrollH);
    sContext.clip();
    this.paintCellStack(sContext, scrollUI, "off");
    sContext.restore();

    // Frozen on top of the seam so any rasterization bleed stays hidden.
    sContext.save();
    sContext.beginPath();
    sContext.rect(0, 0, sWidth, frozenH);
    sContext.clip();
    this.paintCellStack(sContext, frozenUI, "frozenRowBandY0");
    sContext.restore();

    // Splitter between panes: filled bar for a visible, adjustable seam (stroke-only was too thin).
    const splitBarH = 3;
    sContext.save();
    sContext.fillStyle = 'rgba(90, 90, 90, 0.92)';
    sContext.fillRect(0, frozenH - Math.floor(splitBarH / 2), sWidth, splitBarH);
    sContext.restore();

    await this.paintGridForPane(
      sContext,
      frozenUI,
      sWidth,
      0,
      frozenH,
      0,
      null,
      null
    );
    await this.paintGridForPane(
      sContext,
      scrollUI,
      sWidth,
      frozenH,
      scrollH,
      0,
      null,
      null
    );
  };

  paintDragMoveOverlay = async (sContext, absOffX = 0, absOffY = 0) => {
    const dm = this.m_DragMove;
    if (dm == null || dm.destTop == null) {
      return;
    }
    const wRange = new tRange(dm.destTop, dm.destLeft, dm.destBottom, dm.destRight);
    const wPx = await this.m_SpInterface.getRectPixel(wRange);
    if (wPx == null || wPx.Width <= 0 || wPx.Height <= 0) {
      return;
    }
    const wLeft = wPx.Left - absOffX;
    const wTop = wPx.Top - absOffY;
    sContext.save();
    sContext.fillStyle = dm.copyMode
      ? "rgba(0, 120, 212, 0.18)"
      : "rgba(0, 120, 212, 0.24)";
    sContext.fillRect(wLeft, wTop, wPx.Width, wPx.Height);
    sContext.strokeStyle = "#0078D4";
    sContext.lineWidth = 2;
    sContext.setLineDash([4, 3]);
    sContext.strokeRect(wLeft + 1, wTop + 1, wPx.Width - 2, wPx.Height - 2);
    sContext.setLineDash([]);
    sContext.restore();
  };

  /** Small square at the selection bottom-right corner (Excel fill handle). */
  paintFillHandle = async (sContext, absOffX = 0, absOffY = 0) => {
    const sp = this.m_SpInterface;
    if (
      sp == null ||
      sp.getUseEdit?.() ||
      this.m_FillDrag != null ||
      this.m_DragMove != null ||
      !this.canBeginDragMove()
    ) {
      return;
    }
    const wRange = await this.resolveDragMoveSourceRange();
    if (wRange == null) {
      return;
    }
    const wPx = await sp.getRectPixel(wRange);
    if (wPx == null || wPx.Width <= 0 || wPx.Height <= 0) {
      return;
    }
    const wX = wPx.Left + wPx.Width - absOffX;
    const wY = wPx.Top + wPx.Height - absOffY;
    sContext.save();
    sContext.beginPath();
    sContext.rect(wX - 3, wY - 3, 6, 6);
    sContext.fillStyle = this.m_ColorCursorHandle || "#0078D4";
    sContext.strokeStyle = "#FFFFFF";
    sContext.lineWidth = 1;
    sContext.fill();
    sContext.stroke();
    sContext.restore();
  };

  /** Fill-handle preview: dashed union outline + shaded extension cells. */
  paintFillPreviewOverlay = async (sContext, absOffX = 0, absOffY = 0) => {
    const fd = this.m_FillDrag;
    if (fd == null || fd.destTop == null) {
      return;
    }
    sContext.save();
    // Shade the cells that will be filled (extension only).
    if (fd.extTop != null && fd.extBottom >= fd.extTop && fd.extRight >= fd.extLeft) {
      const wExtPx = await this.m_SpInterface.getRectPixel(
        new tRange(fd.extTop, fd.extLeft, fd.extBottom, fd.extRight)
      );
      if (wExtPx != null && wExtPx.Width > 0 && wExtPx.Height > 0) {
        sContext.fillStyle = "rgba(0, 120, 212, 0.14)";
        sContext.fillRect(wExtPx.Left - absOffX, wExtPx.Top - absOffY, wExtPx.Width, wExtPx.Height);
      }
    }
    // Dashed outline around the whole preview union.
    const wPx = await this.m_SpInterface.getRectPixel(
      new tRange(fd.destTop, fd.destLeft, fd.destBottom, fd.destRight)
    );
    if (wPx != null && wPx.Width > 0 && wPx.Height > 0) {
      sContext.strokeStyle = "#0078D4";
      sContext.lineWidth = 1;
      sContext.setLineDash([3, 2]);
      sContext.strokeRect(
        wPx.Left - absOffX + 0.5,
        wPx.Top - absOffY + 0.5,
        wPx.Width - 1,
        wPx.Height - 1
      );
      sContext.setLineDash([]);
    }
    sContext.restore();
  };

  /** Outline cells/ranges referenced by the formula being edited (Excel-like). */
  paintFormulaRefHighlights = async (sContext, sUI, absOffX = 0, absOffY = 0) => {
    const sp = this.m_SpInterface;
    if (
      sp == null ||
      !sp.getUseEdit?.() ||
      sp.isPropertyRangePickerEdit?.() ||
      sp.m_CursorEdit == null
    ) {
      return;
    }
    const wText = sp.getFormulaEditText?.();
    if (wText == null || !String(wText).trimStart().startsWith("=")) {
      return;
    }
    let wPayload;
    try {
      wPayload = await sp.getFormulaEditRefs();
    } catch (e) {
      return;
    }
    const wRefs = Array.isArray(wPayload?.refs) ? wPayload.refs : [];
    if (wRefs.length === 0) {
      return;
    }
    const wViewSheet = sUI?.sheet || sp.m_UIView?.sheet || "";
    const wColors = [
      "#0078D4",
      "#107C10",
      "#8764B8",
      "#CA5010",
      "#038387",
      "#986F0B",
    ];
    sContext.save();
    sContext.lineWidth = 2;
    sContext.setLineDash([]);
    let wColorIdx = 0;
    for (const wRef of wRefs) {
      if (wRef == null || wRef.resolved !== true) {
        continue;
      }
      const wRefSheet = wRef.sheet != null ? String(wRef.sheet) : "";
      if (wRefSheet !== "" && wRefSheet !== wViewSheet) {
        continue;
      }
      const wTop = Number(wRef.top);
      const wLeft = Number(wRef.left);
      const wBottom = Number(wRef.bottom);
      const wRight = Number(wRef.right);
      if (!(wTop > 0 && wLeft > 0 && wBottom >= wTop && wRight >= wLeft)) {
        continue;
      }
      const wRange = new tRange(wTop, wLeft, wBottom, wRight);
      const wColor = wColors[wColorIdx % wColors.length];
      wColorIdx += 1;
      sContext.strokeStyle = wColor;
      const wParts = sp.isFrozenSplitActive?.() || sp.isFrozenColSplitActive?.()
        ? await sp.getRectPixelFragments(wRange)
        : [await sp.getRectPixel(wRange)];
      for (const wPx of wParts) {
        if (wPx == null || wPx.Width <= 0 || wPx.Height <= 0) {
          continue;
        }
        const wLeftPx = wPx.Left - absOffX;
        const wTopPx = wPx.Top - absOffY;
        sContext.strokeRect(wLeftPx + 0.5, wTopPx + 0.5, wPx.Width - 1, wPx.Height - 1);
      }
    }
    sContext.restore();
  };

  /**
   * Draw multi-cell spill / dynamic-array bounds from JsonView "spills" (sheet cell coords).
   * Excel-like dashed outline; pixels via getRectPixel / fragments (split panes).
   */
  async paintSpillRanges(sContext, sUI, absOffX = 0, absOffY = 0) {
    if (sUI == null || !Array.isArray(sUI.spills) || sUI.spills.length === 0) {
      return;
    }
    const sp = this.m_SpInterface;
    if (sp == null) {
      return;
    }
    const splitActive =
      sp.isFrozenSplitActive?.() || sp.isFrozenColSplitActive?.();
    sContext.save();
    sContext.strokeStyle = "#66A9E8";
    sContext.lineWidth = 1;
    sContext.setLineDash([3, 2]);
    for (const wSpill of sUI.spills) {
      const wTop = Number(wSpill?.r_t);
      const wLeft = Number(wSpill?.r_l);
      const wBottom = Number(wSpill?.r_b);
      const wRight = Number(wSpill?.r_r);
      if (!(wTop > 0 && wLeft > 0 && wBottom >= wTop && wRight >= wLeft)) {
        continue;
      }
      // Single-cell spills are omitted by C++; keep guard for stale payloads.
      if (wTop === wBottom && wLeft === wRight) {
        continue;
      }
      const wRange = new tRange(wTop, wLeft, wBottom, wRight);
      const wParts = splitActive
        ? await sp.getRectPixelFragments(wRange)
        : [await sp.getRectPixel(wRange)];
      for (const wPx of wParts) {
        if (wPx == null || !(wPx.Width > 0) || !(wPx.Height > 0)) {
          continue;
        }
        const wLeftPx = wPx.Left - absOffX;
        const wTopPx = wPx.Top - absOffY;
        sContext.strokeRect(
          wLeftPx + 0.5,
          wTopPx + 0.5,
          wPx.Width - 1,
          wPx.Height - 1
        );
      }
    }
    sContext.restore();
  }

  paintOverlayLayer = async (sContext, sUI, sWidth, sHeight, absOffX = 0, absOffY = 0) => {
    this.paintSizerOverlay(sContext, sWidth, sHeight, absOffX, absOffY);
    await this.paintDragMoveOverlay(sContext, absOffX, absOffY);
    await this.paintFillPreviewOverlay(sContext, absOffX, absOffY);
    await this.paintSelection(sContext, sUI, sWidth, sHeight, absOffX, absOffY);
    await this.paintSpillRanges(sContext, sUI, absOffX, absOffY);
    await this.paintFormulaRefHighlights(sContext, sUI, absOffX, absOffY);
    await this.paintCursor(sContext, sUI, sWidth, sHeight, absOffX, absOffY);
    await this.paintFillHandle(sContext, absOffX, absOffY);
  };

  paintOverlayInPane = async (sContext, sUI, paneW, paneH, absOffX, absOffY) => {
    sContext.save();
    sContext.translate(absOffX, absOffY);
    sContext.beginPath();
    sContext.rect(0, 0, paneW, paneH);
    sContext.clip();
    await this.paintOverlayLayer(sContext, sUI, paneW, paneH, absOffX, absOffY);
    sContext.restore();
  };

  paintOverlayClient = async (sContext, sUI, sWidth, sHeight) => {
    const sp = this.m_SpInterface;
    const corner = sp.frozenCornerUiForPaint();
    const fhRaw = Number(sp.m_FrozenPixH) || 0;
    const fwRaw = Number(sp.m_FrozenPixW) || 0;
    const fh = fhRaw > 0 ? Math.ceil(fhRaw) : 0;
    const fw = fwRaw > 0 ? Math.ceil(fwRaw) : 0;

    if (corner && fh > 0 && fw > 0 && sUI === sp.m_UIView) {
      const top = sp.frozenUiForPaint();
      const left = sp.frozenLeftUiForPaint();
      if (top && left) {
        const sh = Math.max(1, sHeight - fh);
        const sw = Math.max(1, sWidth - fw);
        await this.paintOverlayInPane(sContext, corner, fw, fh, 0, 0);
        await this.paintOverlayInPane(sContext, top, sw, fh, fw, 0);
        await this.paintOverlayInPane(sContext, left, fw, sh, 0, fh);
        await this.paintOverlayInPane(sContext, sUI, sw, sh, fw, fh);
        return;
      }
    }

    const frozenRowUI = sp.frozenUiForPaint();
    if (frozenRowUI && fh > 0 && fw <= 0 && sUI === sp.m_UIView) {
      const sh = Math.max(1, sHeight - fh);
      await this.paintOverlayInPane(sContext, frozenRowUI, sWidth, fh, 0, 0);
      await this.paintOverlayInPane(sContext, sUI, sWidth, sh, 0, fh);
      return;
    }

    const frozenColUI = sp.frozenLeftUiForPaint();
    if (frozenColUI && fw > 0 && fh <= 0 && sUI === sp.m_UIView) {
      const sw = Math.max(1, sWidth - fw);
      await this.paintOverlayInPane(sContext, frozenColUI, fw, sHeight, 0, 0);
      await this.paintOverlayInPane(sContext, sUI, sw, sHeight, fw, 0);
      return;
    }

    await this.paintOverlayLayer(sContext, sUI, sWidth, sHeight, 0, 0);
  };

  paintCellsClient = async (sContext, sUI, sWidth, sHeight) => {
    const sp = this.m_SpInterface;
    const corner = sp.frozenCornerUiForPaint();
    const fhRaw = Number(sp.m_FrozenPixH) || 0;
    const fwRaw = Number(sp.m_FrozenPixW) || 0;
    const fh = fhRaw > 0 ? Math.ceil(fhRaw) : 0;
    const fw = fwRaw > 0 ? Math.ceil(fwRaw) : 0;
    // frozen four pane ===================================================
    if (corner && fh > 0 && fw > 0 && sUI === sp.m_UIView) {
      const top = sp.frozenUiForPaint();
      const left = sp.frozenLeftUiForPaint();
      if (top && left) {
        await this.paintFreezeFourPane(
          sContext,
          corner,
          top,
          left,
          sUI,
          sWidth,
          sHeight,
          fh,
          fw
        );
        return;
      }
    }
    // frozen row split ===================================================
    const frozenRowUI = sp.frozenUiForPaint();
    if (frozenRowUI && fh > 0 && fw <= 0 && sUI === sp.m_UIView) {
      const sh = Math.max(1, sHeight - fh);
      await this.paintFreezeSplit(sContext, frozenRowUI, sUI, sWidth, fh, sh);
      return;
    }
    // frozen column split ==================================================
    const frozenColUI = sp.frozenLeftUiForPaint();
    if (frozenColUI && fw > 0 && fh <= 0 && sUI === sp.m_UIView) {
      const sw = Math.max(1, sWidth - fw);
      await this.paintFreezeColumnSplit(
        sContext,
        frozenColUI,
        sUI,
        sWidth,
        sHeight,
        fw,
        sw
      );
      return;
    }
    // not frozen ========================================================
    await this.paintCellsForExport(sContext, sUI, sWidth, sHeight);
  };

  /**
   * Cell + grid paint for off-screen export (PDF). Same stack as the non-frozen paintCellsClient path.
   */
  paintCellsForExport = async (sContext, sUI, sWidth, sHeight) => {
    this.paintCellStack(sContext, sUI);
    if (this.m_SpInterface?.m_GridVisible) {
      await this.paintGridForPane(
        sContext,
        sUI,
        sWidth,
        0,
        sHeight,
        0,
        null,
        null
      );
    }
  };

  paint() {
    const mode = this._consumePaintMode();
    this._paintChain = this._paintChain
      .then(() => this._paintOneFrame(mode))
      .catch((error) => {
        console.error("SkSpGridCanvas paint:", error);
      });
  }

  async _paintCellsFrame() {
    const wCanvas = this.m_Ref.current;
    if (!wCanvas || !this.m_SpInterface) {
      return;
    }

    this.m_UIView = this.m_SpInterface.m_UIView;
    if (this.m_UIView === null) {
      return;
    }

    const wSize = this.m_SpInterface.getCanvasSize(wCanvas);
    const vp = this.m_SpInterface.getGridInnerViewportCssPx(wCanvas);

    const wContext = wCanvas.getContext("2d");
    wContext.save();
    try {
      // clearRect actually wipes the previous frame; fillRect with a "transparent"
      // fillStyle is a no-op (source-over), which let overflowing text over empty
      // (bg-less) cells ghost across vertical scroll (e.g. the B3 title spilling into
      // empty C/D). Backgrounds are fully repainted below each frame.
      wContext.clearRect(0, 0, wSize.Width, wSize.Height);

      // Outlines live in LeftPanel / TopPanel; grid paints cells only.
      const wTreeLeft = this.m_SpInterface.gridTreeViewLeft?.() ?? 0;
      const wTreeTop = this.m_SpInterface.gridTreeViewTop?.() ?? 0;
      if (wTreeLeft > 0 || wTreeTop > 0) {
        wContext.translate(wTreeLeft, wTreeTop);
      }
      wContext.beginPath();
      wContext.rect(0, 0, vp.width, vp.height);
      wContext.clip();
      await this.paintCellsClient(wContext, this.m_UIView, vp.width, vp.height);
    } catch (error) {
      console.error("Error in paintCellsClient:", error);
    } finally {
      wContext.restore();
    }
  }

  async _paintOverlayFrame() {
    const baseCanvas = this.m_Ref.current;
    const overlayCanvas = this.m_OverlayRef?.current;
    if (!baseCanvas || !overlayCanvas || !this.m_SpInterface) {
      return;
    }

    this.refreshThemeColors();
    this.m_UIView = this.m_SpInterface.m_UIView;
    if (this.m_UIView === null) {
      return;
    }

    const ratio = this.m_SpInterface.m_Ratio;
    if (baseCanvas.width === 0 || baseCanvas.height === 0) {
      this.m_SpInterface.getCanvasSize(baseCanvas);
    }
    overlayCanvas.width = baseCanvas.width;
    overlayCanvas.height = baseCanvas.height;
    const wSize = {
      Width: baseCanvas.clientWidth,
      Height: baseCanvas.clientHeight,
    };
    const vp = this.m_SpInterface.getGridInnerViewportCssPx(baseCanvas);
    const wContext = overlayCanvas.getContext("2d");
    wContext.setTransform(1, 0, 0, 1, 0, 0);
    wContext.scale(ratio, ratio);
    wContext.save();
    try {
      wContext.clearRect(0, 0, wSize.Width, wSize.Height);

      const wTreeLeft = this.m_SpInterface.gridTreeViewLeft?.() ?? 0;
      const wTreeTop = this.m_SpInterface.gridTreeViewTop?.() ?? 0;
      if (wTreeLeft > 0 || wTreeTop > 0) {
        wContext.translate(wTreeLeft, wTreeTop);
      }
      wContext.beginPath();
      wContext.rect(0, 0, vp.width, vp.height);
      wContext.clip();
      await this.paintOverlayClient(
        wContext,
        this.m_UIView,
        vp.width,
        vp.height
      );
    } catch (error) {
      console.error("Error in paintOverlayLayer:", error);
    } finally {
      wContext.restore();
    }
  }

  async _paintOneFrame(mode) {
    const paintCells = mode === "full" || mode === "cells";
    const paintOverlay = mode === "full" || mode === "overlay";
    if (paintCells) {
      await this._paintCellsFrame();
    }
    if (paintOverlay) {
      await this._paintOverlayFrame();
    }
  }

  DragOffset(event) {
    const wCanvas = event.currentTarget;
    const wPt = pointerToLayoutPx(wCanvas, event.clientX, event.clientY);
    let x = wPt.x;
    let y = wPt.y;
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    x -= this.m_SpInterface.gridTreeViewLeft?.() ?? 0;
    y -= this.m_SpInterface.gridTreeViewTop?.() ?? 0;
    return { x, y };
  }

  onDragOver = (event) => {
    event.preventDefault();
    if (dataTransferHasImageFiles(event.dataTransfer)) {
      event.dataTransfer.dropEffect = "copy";
    }
    event.currentTarget.classList.add("SkDroppable.droppable-hover");

    let wPos = this.DragOffset(event);
    this.m_SpInterface.setCursorByMouse(wPos.x, wPos.y);
  };

  onDragLeave = (event) => {
    event.preventDefault();
    event.currentTarget.classList.remove("SkDroppable.droppable-hover");
  };

  onDrop = async (event) => {
    event.preventDefault();

    event.currentTarget.classList.remove("SkDroppable.droppable-hover");

    const wPos = this.DragOffset(event);
    this.m_SpInterface.setCursorByMouse(wPos.x, wPos.y);

    const wImageFile = firstImageFileFromDataTransfer(event.dataTransfer);
    if (wImageFile != null) {
      try {
        const wImage = await readImageFileForInsert(wImageFile);
        const wCellRef = this.m_SpInterface.m_Select.cursorStr();
        await insertImageFloatingObject(this.m_SpInterface, {
          dataUrl: wImage.dataUrl,
          altText: wImageFile.name || "Image",
          cellRef: wCellRef,
          width: wImage.width,
          height: wImage.height,
        });
      } catch (err) {
        console.error("SkSpGridCanvas: image drop failed", err);
      }
      return;
    }

    const wClass = event.dataTransfer.getData("Class"); // Get the class
    if (!wClass) {
      return;
    }

    let wCellStr=this.m_SpInterface.m_Select.cursorStr();
    // Apply Class in Cell wCellStr
    this.setCellClass(wCellStr, wClass);   
  
    this.m_SpInterface.reloadView()
    this.m_SpInterface.invalidateAll();
  };
  

  render() {
    return (
    <div className="SkSpGridContainer">
    <canvas 
      style={{cursor: this.m_Cursor}} 
      ref={this.m_Ref} 
      id={this.m_Id} className="SkSpGridCanvas" 
      tabIndex="1"
      onDragOver={this.onDragOver}
      onDragLeave={this.onDragLeave}
      onDrop={this.onDrop}
      /* Ipad, iphone */
      onTouchStart={this.handleTouchStart}
      onTouchMove={this.handleTouchMove}
      onTouchEnd={this.handleTouchEnd}></canvas>
    <canvas
      ref={this.m_OverlayRef}
      id="GridCanvasOverlay"
      className="SkSpGridOverlay"
      aria-hidden="true"></canvas>
    <SkSpGridPanel id="SkSpGridPanel"  SpInterface={this.m_SpInterface}></SkSpGridPanel>
    <SkSpFloatingLayer id="SkSpFloatingLayer" SpInterface={this.m_SpInterface}></SkSpFloatingLayer>
    {this.m_SpInterface.shouldShowCellInplaceEdit()
      ? <SkSpInplaceEdit SpInterface={this.m_SpInterface} Id="InplaceEdit"/>
      : null}
    <SkScrollBar ParentInterface={this.m_SpInterface} ParentView={this} id="vScrollBar" ClassName="SkVScrollBar"></SkScrollBar>
    <SkScrollBar ParentInterface={this.m_SpInterface} ParentView={this} id="hScrollBar" ClassName="SksetHScrollBar"></SkScrollBar>
    <SkMenuPopUp ref={this.m_RefMenu} onClose={this.closeMenuPopUp} Visible={this.state.menuPopUp}>
      <SkMenuElement onSelect={this.contextCut}><span>Cut</span></SkMenuElement>
      <SkMenuElement onSelect={this.contextCopy}><span>Copy</span></SkMenuElement>
      <SkMenuElement onSelect={this.contextPaste}><span>Paste</span></SkMenuElement>

      <div className="SkMenuSeparator" />

      {/* Nested flyout (CSS :hover) with the shifted insert/delete-cells actions. */}
      <div className="SkMenuSubmenu">
        <div className="SkMenuElement SkWidth100 SkMenuSubmenu__label">
          <span>Insert / Delete cells</span>
          <span className="SkMenuSubmenu__arrow">▸</span>
        </div>
        <div className="SkMenuSubmenu__flyout SkFlexColumn">
          <SkMenuElement onSelect={this.insertRowByRect}><span>Insert rows (shift down)</span></SkMenuElement>
          <SkMenuElement onSelect={this.insertColByRect}><span>Insert columns (shift right)</span></SkMenuElement>
          <SkMenuElement onSelect={this.deleteRowByRect}><span>Delete rows (shift up)</span></SkMenuElement>
          <SkMenuElement onSelect={this.deleteColByRect}><span>Delete columns (shift left)</span></SkMenuElement>
        </div>
      </div>

      <div className="SkMenuSeparator" />

      <SkMenuElement onSelect={this.insertRowWhole}><span>Insert entire row</span></SkMenuElement>
      <SkMenuElement onSelect={this.insertColWhole}><span>Insert entire column</span></SkMenuElement>
    </SkMenuPopUp>
    {this.state.tableFilterPopup ? (
      <SkSpTableFilterPopup
        SpInterface={this.m_SpInterface}
        popup={this.state.tableFilterPopup}
        onClose={() => this.m_SpInterface.closeTableFilterPopup()}
      />
    ) : null}
    </div>
    );
  }

  async openCloseTreeCol(wCol) {
    const wOk = !!window.SkUISpreadSheet.openCloseTreeCol(wCol);
    if (wOk) {
      this.m_SpInterface.invalidateSheetExtent();
      await this.m_SpInterface.reloadView();
      this.m_SpInterface.invalidateAll();
    }
    return wOk;
  }

  async openCloseTreeRow(wRow) {
    // Guard against LeftPanel + GridCanvas both firing on the same gesture.
    if (this._openCloseTreeRowBusy) {
      return false;
    }
    const wNow = Date.now();
    if (this._lastOpenCloseTreeRow === wRow && wNow - (this._lastOpenCloseTreeAt || 0) < 250) {
      return false;
    }
    this._openCloseTreeRowBusy = true;
    try {
      const wOk = !!window.SkUISpreadSheet.openCloseTreeRow(wRow);
      if (wOk) {
        this._lastOpenCloseTreeRow = wRow;
        this._lastOpenCloseTreeAt = Date.now();
        this.m_SpInterface.invalidateSheetExtent();
        await this.m_SpInterface.reloadView();
        // After collapse, park the cursor on the parent if it was inside the hidden block.
        try {
          const wCursor = this.m_SpInterface.cursor?.();
          const wView = this.m_SpInterface.m_UIView;
          const wVisible = new Set((wView?.rows || []).map((r) => r.i));
          if (wCursor != null && !wVisible.has(wCursor.row())) {
            this.m_SpInterface.setCursor(wRow, wCursor.col() > 0 ? wCursor.col() : 1);
            this.m_SpInterface.scheduleInvalidateSelection?.();
          }
        } catch (_) { /* ignore */ }
        this.m_SpInterface.invalidateAll();
      } else {
        console.warn("openCloseTreeRow failed for row", wRow);
      }
      return wOk;
    } finally {
      this._openCloseTreeRowBusy = false;
    }
  }

  async moveCell(wCursor, wKey, wMetaKey) {
    // m_UIView is only populated on paint; during a recalc (view reset) it can be null.
    // Fall back to the interface view, and bail out (null) rather than dereferencing null.
    const wView = this.m_UIView ?? this.m_SpInterface?.m_UIView;
    if (wView == null) {
      return null;
    }
    let wRes = window.SkUISpreadSheet.moveCell(wCursor.row(), wCursor.col(), wKey, wMetaKey, wView.toprow, wView.topcol, wView.lastrow, wView.lastcol);
    return wRes;
  }

  async setCellClass(wCellStr, wClass) {
    window.SkUISpreadSheet.cellClass(wCellStr, wClass);
  }
}
// ========================================

export default SkSpGridCanvas;
