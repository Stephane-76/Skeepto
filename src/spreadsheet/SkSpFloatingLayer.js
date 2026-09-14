//=============================================================================
// SkSpFloatingLayer — React overlay for workbook floating objects (option A)
//=============================================================================
import React from "react";
import SkComponent from "../component/SkComponent";
import SkCellClass, { GetRender } from "./CellClass/SkCellClass.js";
import { parseImageRotationDeg } from "./CellClass/SkCellClassImage.js";
import {
  buildFloatingSyntheticCell,
  clampFloatingSize,
  floatingObjectClassName,
  floatingObjectZIndex,
  resolveFloatingLayoutStacked,
  sortFloatingObjectsByZIndex,
} from "./SkSpFloatingObject.js";
import { layoutToScreenScale } from "../utility/SkViewZoom.js";

class SkSpFloatingLayer extends SkComponent {
  /** Hit band (layout px) for move on selection border only. */
  static MOVE_EDGE_HIT_PX = 6;
  constructor(props) {
    super(props);
    this.state = { layoutTick: false, selectionTick: false, displayTick: 0 };
    this.m_SpInterface = props.SpInterface;
    this.m_SpInterface.m_SkSpFloatingLayer = this;
    this.m_Drag = null;
    this.boundDragMove = this.onDragMove.bind(this);
    this.boundDragEnd = this.onDragEnd.bind(this);
  }

  componentWillUnmount() {
    if (this.m_SpInterface != null) {
      this.m_SpInterface.endFloatingObjectDrag();
    }
    this.endDragSession(false);
    if (this.m_SpInterface && this.m_SpInterface.m_SkSpFloatingLayer === this) {
      this.m_SpInterface.m_SkSpFloatingLayer = null;
    }
    this.m_SpInterface = null;
  }

  /** Layout / scroll reposition — does not reload chart range data. */
  invalidate() {
    this.setState({ layoutTick: !this.state.layoutTick });
  }

  /** After reloadView / invalidateAll — re-read chartData ranges from the sheet. */
  notifyDisplayRefresh() {
    this.setState((prev) => ({
      displayTick: prev.displayTick + 1,
      layoutTick: !prev.layoutTick,
    }));
  }

  /** Selection ring / z-index only — avoids reloading chart canvases. */
  notifySelectionChanged() {
    this.setState((prev) => ({ selectionTick: !prev.selectionTick }));
  }

  layoutBoxForEntry(sEntry, sAllObjects) {
    void this.state.layoutTick;
    const wObjects =
      Array.isArray(sAllObjects) && sAllObjects.length > 0
        ? sAllObjects
        : this.m_SpInterface?.m_FloatingObjects;
    return resolveFloatingLayoutStacked(this.m_SpInterface, sEntry, wObjects);
  }

  isSelected(sEntry) {
    return (
      sEntry?.n != null &&
      sEntry.n !== "" &&
      this.m_SpInterface?.m_SelectedFloatingObjectName === sEntry.n
    );
  }

  pointerLocalInBox(event, sLayoutWidth, sLayoutHeight) {
    const wEl = event.currentTarget;
    if (!(wEl instanceof Element)) {
      return null;
    }
    const wRect = wEl.getBoundingClientRect();
    if (wRect.width <= 0 || wRect.height <= 0) {
      return null;
    }
    return {
      x: ((event.clientX - wRect.left) / wRect.width) * sLayoutWidth,
      y: ((event.clientY - wRect.top) / wRect.height) * sLayoutHeight,
    };
  }

  /** Matches .SkSpFloatingObject-resize (right/bottom -4px, 12×12). */
  _isPointInFloatingResizeCorner(sLocalX, sLocalY, sWidth, sHeight) {
    const wLeft = sWidth - 8;
    const wTop = sHeight - 8;
    const wRight = sWidth + 4;
    const wBottom = sHeight + 4;
    return (
      sLocalX >= wLeft &&
      sLocalX <= wRight &&
      sLocalY >= wTop &&
      sLocalY <= wBottom
    );
  }

  /** True when the pointer sits on the object border (not interior). */
  isPointerOnFloatingMoveEdge(sLocalX, sLocalY, sWidth, sHeight) {
    if (sWidth <= 0 || sHeight <= 0) {
      return false;
    }
    const wHit = SkSpFloatingLayer.MOVE_EDGE_HIT_PX;
    const wLeft = 0;
    const wTop = 0;
    const wRight = sWidth;
    const wBottom = sHeight;

    if (
      sLocalX < wLeft - wHit ||
      sLocalX > wRight + wHit ||
      sLocalY < wTop - wHit ||
      sLocalY > wBottom + wHit
    ) {
      return false;
    }
    if (this._isPointInFloatingResizeCorner(sLocalX, sLocalY, sWidth, sHeight)) {
      return false;
    }

    const wInHorizSpan = sLocalX >= wLeft - wHit && sLocalX <= wRight + wHit;
    const wInVertSpan = sLocalY >= wTop - wHit && sLocalY <= wBottom + wHit;
    const wOnTop = wInHorizSpan && sLocalY >= wTop - wHit && sLocalY <= wTop + wHit;
    const wOnBottom = wInHorizSpan && sLocalY >= wBottom - wHit && sLocalY <= wBottom + wHit;
    const wOnLeft = wInVertSpan && sLocalX >= wLeft - wHit && sLocalX <= wLeft + wHit;
    const wOnRight = wInVertSpan && sLocalX >= wRight - wHit && sLocalX <= wRight + wHit;
    return wOnTop || wOnBottom || wOnLeft || wOnRight;
  }

  _applyFloatingObjectCursor(sShell, sCursor) {
    if (!(sShell instanceof Element)) {
      return;
    }
    const wCss = sCursor || "";
    sShell.style.cursor = wCss;
    // Canvas has pointer-events:auto and covers the shell; update it directly.
    sShell.querySelectorAll(".SkSpFloatingObject-body canvas").forEach((wCanvas) => {
      wCanvas.style.cursor = wCss || "default";
    });
  }

  updateFloatingMoveCursor(sEntry, sBox, event) {
    if (this.m_Drag != null) {
      return;
    }
    if (event.target instanceof Element && event.target.closest(".SkSpFloatingObject-resize")) {
      return;
    }
    const wLocal = this.pointerLocalInBox(event, sBox.width, sBox.height);
    const wOnEdge =
      wLocal != null &&
      this.isPointerOnFloatingMoveEdge(wLocal.x, wLocal.y, sBox.width, sBox.height);
    this._applyFloatingObjectCursor(event.currentTarget, wOnEdge ? "grab" : "");
  }

  bindDragSession() {
    if (typeof window === "undefined") {
      return;
    }
    window.addEventListener("mousemove", this.boundDragMove, true);
    window.addEventListener("mouseup", this.boundDragEnd, true);
  }

  unbindDragSession() {
    if (typeof window === "undefined") {
      return;
    }
    window.removeEventListener("mousemove", this.boundDragMove, true);
    window.removeEventListener("mouseup", this.boundDragEnd, true);
  }

  beginDragSession(sMode, sEntry, sClientX, sClientY) {
    if (sEntry?.n == null || sEntry.n === "") {
      return;
    }
    const wObjects = this.m_SpInterface?.m_FloatingObjects;
    const wBox = this.layoutBoxForEntry(sEntry, wObjects);
    if (this.m_SpInterface != null) {
      this.m_SpInterface.beginFloatingObjectDrag();
    }
    this.m_Drag = {
      mode: sMode,
      name: sEntry.n,
      startClientX: sClientX,
      startClientY: sClientY,
      origDx: Number(sEntry.dx) || 0,
      origDy: Number(sEntry.dy) || 0,
      origW: sMode === "resize" ? wBox.width : Number(sEntry.w) || 100,
      origH: sMode === "resize" ? wBox.height : Number(sEntry.h) || 100,
      origOp: Number(sEntry.op) || 1,
    };
    if (typeof document !== "undefined") {
      document.body.style.cursor = sMode === "resize" ? "nwse-resize" : "grabbing";
    }
    this.bindDragSession();
  }

  dragDeltaCss(sClientX, sClientY) {
    const wEl = this.m_SpInterface?.m_SkSpGridCanvas?.m_Ref?.current;
    const wScale = layoutToScreenScale(wEl);
    return {
      dx: (sClientX - this.m_Drag.startClientX) / wScale.x,
      dy: (sClientY - this.m_Drag.startClientY) / wScale.y,
    };
  }

  onDragMove(event) {
    if (this.m_Drag == null || this.m_SpInterface == null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const wDelta = this.dragDeltaCss(event.clientX, event.clientY);
    if (this.m_Drag.mode === "move") {
      this.m_SpInterface.patchFloatingObjectEntry(this.m_Drag.name, {
        dx: this.m_Drag.origDx + wDelta.dx,
        dy: this.m_Drag.origDy + wDelta.dy,
      });
    } else if (this.m_Drag.mode === "resize") {
      this.m_SpInterface.patchFloatingObjectEntry(this.m_Drag.name, {
        w: clampFloatingSize(this.m_Drag.origW + wDelta.dx),
        h: clampFloatingSize(this.m_Drag.origH + wDelta.dy),
      });
    }
    this.invalidate();
  }

  async onDragEnd(event) {
    if (this.m_Drag == null) {
      return;
    }
    event?.preventDefault?.();
    event?.stopPropagation?.();
    await this.endDragSession(true);
  }

  async endDragSession(sCommit) {
    const wDrag = this.m_Drag;
    this.m_Drag = null;
    this.unbindDragSession();
    try {
      if (sCommit && wDrag != null && this.m_SpInterface != null) {
        const wEntry = this.m_SpInterface.findFloatingObjectEntry(wDrag.name);
        if (wEntry != null) {
          if (wDrag.mode === "resize") {
            this.m_SpInterface.patchFloatingObjectEntry(wDrag.name, {
              autoSpan: false,
            });
          }
          await this.m_SpInterface.commitFloatingObjectLayout(
            wDrag.name,
            {
              dx: Number(wEntry.dx) || 0,
              dy: Number(wEntry.dy) || 0,
              w: Number(wEntry.w) || 0,
              h: Number(wEntry.h) || 0,
              op: Number(wEntry.op) || 1,
            },
            {
              baseline: {
                dx: wDrag.origDx,
                dy: wDrag.origDy,
                w: wDrag.origW,
                h: wDrag.origH,
                op: wDrag.origOp,
              },
            },
          );
        }
      }
    } finally {
      if (typeof document !== "undefined") {
        document.body.style.cursor = "";
      }
      if (this.m_SpInterface != null) {
        this.m_SpInterface.endFloatingObjectDrag();
      }
    }
  }

  handleObjectMouseDown = (sEntry, sBox, event) => {
    if (event.button !== 0 || this.m_SpInterface == null) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    this.m_SpInterface.selectFloatingObject(sEntry.n);

    const wLocal = this.pointerLocalInBox(event, sBox.width, sBox.height);
    if (
      wLocal == null ||
      !this.isPointerOnFloatingMoveEdge(wLocal.x, wLocal.y, sBox.width, sBox.height)
    ) {
      return;
    }
    this.beginDragSession("move", sEntry, event.clientX, event.clientY);
  };

  handleObjectMouseMove = (sEntry, sBox, event) => {
    this.updateFloatingMoveCursor(sEntry, sBox, event);
  };

  handleObjectMouseLeave = (event) => {
    this._applyFloatingObjectCursor(event.currentTarget, "");
  };

  handleResizeMouseDown = (sEntry, event) => {
    if (event.button !== 0 || this.m_SpInterface == null) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    this.m_SpInterface.selectFloatingObject(sEntry.n);
    this.beginDragSession("resize", sEntry, event.clientX, event.clientY);
  };

  renderFloatingObject(sEntry, sAllObjects) {
    const wClassName = floatingObjectClassName(sEntry);
    const wRender = GetRender(wClassName);
    if (wRender === undefined) {
      return null;
    }
    const wBox = this.layoutBoxForEntry(sEntry, sAllObjects);
    if (wBox.width <= 0 || wBox.height <= 0) {
      return null;
    }
    const wCell = buildFloatingSyntheticCell(sEntry.n, sEntry.host, wBox, sEntry, this.m_SpInterface);
    if (wCell.c_t !== "c" || !wCell.c_v) {
      return null;
    }
    wCell.c_x = 0;
    wCell.c_y = 0;
    if (wCell.c_foMeta != null && typeof wCell.c_foMeta === "object") {
      wCell.c_foMeta.displayTick = this.state.displayTick;
    }
    const wSelected = this.isSelected(sEntry);
    const wRotationDeg = parseImageRotationDeg(
      SkCellClass.readPropertyFromCellJson(wCell, "rotation"),
    );
    const wAllowOverflow = Math.abs(wRotationDeg) > 0.05;
    const wStyle = {
      position: "absolute",
      left: wBox.left + "px",
      top: wBox.top + "px",
      width: wBox.width + "px",
      height: wBox.height + "px",
      opacity: wBox.opacity,
      pointerEvents: "auto",
      overflow: wAllowOverflow ? "visible" : "hidden",
      zIndex: floatingObjectZIndex(sEntry, wSelected),
    };
    return (
      <div
        key={`float:${sEntry.n}`}
        className={[
          "SkSpFloatingObject",
          wSelected ? "SkSpFloatingObject--selected" : "",
          wAllowOverflow ? "SkSpFloatingObject--overflowVisible" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={wStyle}
        onMouseDown={(event) => this.handleObjectMouseDown(sEntry, wBox, event)}
        onMouseMoveCapture={(event) => this.handleObjectMouseMove(sEntry, wBox, event)}
        onMouseLeave={this.handleObjectMouseLeave}
      >
        <div className="SkSpFloatingObject-body">
          {wRender(wCell, this.m_SpInterface)}
        </div>
        {wSelected ? (
          <>
            <div className="SkSpFloatingObject-frame" aria-hidden="true" />
            <div
              className="SkSpFloatingObject-resize"
              title="Resize"
              onMouseDown={(event) => this.handleResizeMouseDown(sEntry, event)}
            />
          </>
        ) : null}
      </div>
    );
  }

  render() {
    void this.state.layoutTick;
    void this.state.selectionTick;
    void this.state.displayTick;
    const wObjects = sortFloatingObjectsByZIndex(this.m_SpInterface?.m_FloatingObjects);
    if (!Array.isArray(wObjects) || wObjects.length === 0) {
      return null;
    }

    const wTreeLeft = this.m_SpInterface.gridTreeViewLeft?.() ?? 0;
    const wTreeTop = this.m_SpInterface.gridTreeViewTop?.() ?? 0;
    const wStyle = {
      left: wTreeLeft,
      top: wTreeTop,
      width: `calc(100% - ${wTreeLeft}px - var(--sk-vscrollbar-size, 0px))`,
      height: `calc(100% - ${wTreeTop}px - var(--sk-hscrollbar-size, 0px))`,
      position: "absolute",
      pointerEvents: "none",
      overflow: "hidden",
      zIndex: 3,
    };

    return (
      <div ref={this.m_Ref} className="SkSpFloatingLayer" style={wStyle}>
        {wObjects.map((wEntry) => this.renderFloatingObject(wEntry, wObjects))}
      </div>
    );
  }
}

export default SkSpFloatingLayer;
