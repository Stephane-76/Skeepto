//=============================================================================
// SkSpLeftPanel
// SpreadSheet Panel left (row numbers + optional outline band)
//=============================================================================
import React  from "react";
import './SkSpreadSheet.css'
import SkCanvas from "../component/SkCanvas";

import SkMenuPopUp from "../component/SkMenuPopup";
import SkMenuElement from "../component/SkMenuElement";

import { pointerToLayoutPx, layoutToScreenScale } from "../utility/SkViewZoom.js";
import {
  drawTreeViewLeft,
  SK_TREE_VIEW_COLOR,
} from "./SkSpTreeViewPaint.js";

class SkSpLeftPanel extends SkCanvas {
  constructor(props) {
    super(props);
    this.state = { cursor: "auto", menuPopUp: false, treeResizeVisible: false };
    this.mouseIsDown = false;
    this.spInterface = props.SpInterface;
    this.rangeSelect = false;
    this.spInterface.m_SkSpLeftPanel = this; // for invalidate
    this._chromeResize = null;
    this._chromeResizeRaf = 0;

    this.m_RefMenu = React.createRef();
    this.insertRow = this.insertRow.bind(this);
    this.deleteRow = this.deleteRow.bind(this);

    this.closeMenuPopUp = this.closeMenuPopUp.bind(this);
    this.onChromeResizeDown = this.onChromeResizeDown.bind(this);
  }
  
  componentDidMount() {
    //console.log("SkLeftPanel::componentDidMount()")
    this.refreshThemeColors();

    // Store bound event handlers to properly remove them later
    this.boundMouseDown = this.mouseDown.bind(this);
    this.boundMouseMove = this.mouseMove.bind(this);
    this.boundMouseUp = this.mouseUp.bind(this);
    this.boundContextMenu = this.oncontextMenu.bind(this);

    // Anchor on SpreadSheet parent
    const root = window; 
    root.addEventListener('mousedown', this.boundMouseDown);
    root.addEventListener('mousemove', this.boundMouseMove);
    root.addEventListener('mouseup', this.boundMouseUp);
    this.m_Ref.current.addEventListener('contextmenu', this.boundContextMenu);
  }

  refreshThemeColors() {
    const rootStyle = document.querySelector(':root');
    if (!rootStyle) return;
    const styleComputed = getComputedStyle(rootStyle);
    this.color = styleComputed.getPropertyValue('--sk-color-header-text').trim()
      || styleComputed.getPropertyValue('--sk-color-tool');
    this.font = styleComputed.getPropertyValue('--sk-font-lefttop');
    this.colorSelect = styleComputed.getPropertyValue('--sk-fill-select');
    this.colorSelectColRow = styleComputed.getPropertyValue('--sk-fill-select-colrow');
    this.colorSelectHeader = styleComputed.getPropertyValue('--sk-fill-select-header');
    this.headerBackground = styleComputed.getPropertyValue('--sk-color-header-background').trim()
      || styleComputed.getPropertyValue('--sk-color-background');
  }

  /**
   * Clean up all resources when component unmounts to prevent memory leaks
   * - Removes all event listeners (mouse events, context menu)
   * - Resets component state
   * - Cleans up circular references
   */
  componentWillUnmount(prevProps) {
    console.log("SkLeftPanel::componentWillUnmount()")
   
    // Clean up all event listeners using stored bound references
    if (this.m_Ref.current) {
      this.m_Ref.current.removeEventListener('contextmenu', this.boundContextMenu);
    }
    
    // Clean up window event listeners
    const root = window; 
    root.removeEventListener('mousedown', this.boundMouseDown);
    root.removeEventListener('mousemove', this.boundMouseMove);
    root.removeEventListener('mouseup', this.boundMouseUp);
    
    // Reset component state
    this.mouseIsDown = false;
    this.rangeSelect = false;
    this._chromeResize = null;
    if (this._chromeResizeRaf) {
      cancelAnimationFrame(this._chromeResizeRaf);
      this._chromeResizeRaf = 0;
    }
    
    // Clean up circular references
    if (this.spInterface && this.spInterface.m_SkSpLeftPanel === this) {
      this.spInterface.m_SkSpLeftPanel = null;
    }
    
    // Clean up other references
    this.spInterface = null;
  }

  onChromeResizeDown(event) {
    if (!this.spInterface || event.button !== 0) {
      return;
    }
    if (!(this.treeBandWidth() > 0)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this._chromeResize = {
      startClientX: event.clientX,
      startBand: this.treeBandWidth(),
    };
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  }

  async _applyChromeResize(event) {
    if (!this._chromeResize || !this.spInterface) {
      return;
    }
    const el = this.m_Ref.current;
    const scaleX = layoutToScreenScale(el).x || 1;
    const dx = (event.clientX - this._chromeResize.startClientX) / scaleX;
    const changed = this.spInterface.setTreeBandLeft(
      this._chromeResize.startBand + dx
    );
    if (!changed) {
      return;
    }
    if (this._chromeResizeRaf) {
      return;
    }
    this._chromeResizeRaf = requestAnimationFrame(() => {
      this._chromeResizeRaf = 0;
      this.spInterface?.refreshAfterHeaderChromeResize?.();
    });
  }

  _endChromeResize() {
    if (!this._chromeResize) {
      return false;
    }
    this._chromeResize = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    if (this._chromeResizeRaf) {
      cancelAnimationFrame(this._chromeResizeRaf);
      this._chromeResizeRaf = 0;
    }
    this.spInterface?.refreshAfterHeaderChromeResize?.();
    return true;
  }

  /** Row-number band width (CSS px). */
  numberBandWidth() {
    return this.spInterface?.getBaseLeftSize?.() ?? 60;
  }

  /** Outline band width (CSS px); 0 when TreeView is off. */
  treeBandWidth() {
    return Number(this.spInterface?.m_TreeViewLeft) || 0;
  }

  offsetMousePos(event) {
    const el = this.m_Ref.current;
    if (!el || !this.spInterface) {
      return { X: 0, Y: 0 };
    }
    const wPt = pointerToLayoutPx(el, event.clientX, event.clientY);
    return {
      X: wPt.x,
      Y: wPt.y - (this.spInterface.gridTreeViewTop?.() ?? 0),
    };
  }

  async openCloseRowAtY(sY) {
    const wRow = await this.spInterface.rowByPixel(sY);
    console.log("LeftPanel tree click open/close row " + wRow);
    const wCanvas = this.spInterface.m_SkSpGridCanvas;
    if (wCanvas?.openCloseTreeRow) {
      const wOk = await wCanvas.openCloseTreeRow(wRow);
      if (!wOk) {
        console.warn("LeftPanel openCloseTreeRow returned false for row", wRow);
      }
      return;
    }
    if (window.SkUISpreadSheet?.openCloseTreeRow?.(wRow)) {
      this.spInterface.invalidateSheetExtent();
      await this.spInterface.reloadView();
      this.spInterface.invalidateAll();
    }
  }

  async mouseDown(event) {
    if (this.isEventOnClass(event)) {
      if (this.state.menuPopUp) {
        return;
      }

      if (event.button === 2) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      let wPos = this.offsetMousePos(event);
      const wNumW = this.numberBandWidth();
      const wTreeW = this.treeBandWidth();

      // Outline band: single click toggles open/close (Excel-like).
      if (wTreeW > 0 && wPos.X >= wNumW && wPos.Y >= 0) {
        if (event.detail === 1) {
          try {
            await this.openCloseRowAtY(wPos.Y);
          } catch (error) {
            console.error("Error in tree open/close from LeftPanel:", error);
          }
        }
        return;
      }

      // Double-click row-number band also toggles outline when TreeView is on.
      if (event.detail === 2 && this.spInterface.isTreeView?.()) {
        try {
          await this.openCloseRowAtY(wPos.Y);
        } catch (error) {
          console.error("Error in tree open/close from row header:", error);
        }
        return;
      }

      this.spInterface.disableChangeSizeColRow();
      this.mouseIsDown = true;

      try {
        const result = await this.spInterface.isChangeSizeRow(wPos.Y);
        if (result.ColRow !== -1) {
          this.setState({ cursor: "row-resize" });
          this.spInterface.startChangeSizeColRow(false, result); // false for row
        } else {
          this.setState({ cursor: "grab" });
          // Select — keep grid keyboard focus (header canvas is not tabbable).
          event.preventDefault();
          this.rangeSelect = true;
          await this.spInterface.startColRowSelect(true, wPos, event);
          this.invalidate();
        }
      } catch (error) {
        console.error("Error in mouseDown:", error);
      }
    }
  }

  async mouseMove(event) {
    if (this.state.menuPopUp) {
      return;
    }
    if (this._chromeResize) {
      await this._applyChromeResize(event);
      return;
    }
    if (this.spInterface != null) {
      let pos = this.offsetMousePos(event);

      if (this.mouseIsDown) {
        if (this.spInterface.m_Sizer.active()) {
          try {
            await this.spInterface.moveChangeSizeColRow(pos);
          } catch (error) {
            console.error("Error in moveChangeSizeRow:", error);
          }
        } else {
          // Select
          if (this.rangeSelect === true) {
            try {
              await this.spInterface.moveColRowSelect(true, pos);
              this.spInterface.m_SkSpGridCanvas.invalidate();
              this.invalidate();
            } catch (error) {
              console.error("Error in moveColRowSelect:", error);
            }
          }
        }
      } else {
        try {
          const wTreeW = this.treeBandWidth();
          const wNumW = this.numberBandWidth();
          if (wTreeW > 0 && pos.X >= wNumW) {
            this.setState({ cursor: "pointer" });
            return;
          }
          const result = await this.spInterface.isChangeSizeRow(pos.Y);
          let row = result.ColRow;
          if (row !== -1) {
            this.setState({ cursor: "row-resize" });
          } else {
            this.setState({ cursor: "auto" });
          }
        } catch (error) {
          console.error("Error in changeSizeRow:", error);
        }
      }
    }
  }

  async mouseUp(event) {
    if (this.state.menuPopUp) {
      return;
    }
    if (this._endChromeResize()) {
      this.setState({ cursor: "auto" });
      return;
    }
    this.mouseIsDown = false;
    if (this.spInterface != null) {
      try {
        await this.spInterface.stopChangeSizeColRow(event);
      } catch (error) {
        console.error("Error in stopChangeSizeColRow:", error);
      }
    }
    // Select
    if (this.rangeSelect === true) {
      try {
        await this.spInterface.endColRowSelect(true, event);
        this.rangeSelect = false;
      } catch (error) {
        console.error("Error in endColRowSelect:", error);
      }
    }
    this.setState({ cursor: "auto" });
  }  

  closeMenuPopUp() {
    this.setState({ menuPopUp: false });
  }
  
  oncontextMenu(event) {
    console.log('oncontextMenu')
    this.m_RefMenu.current.SetPos(event);
    this.setState({ menuPopUp: true });
    event.preventDefault(); 
  }
  
    insertRow(event) {
    this.closeMenuPopUp();
    this.spInterface.insertRow().catch(error => {
      console.error("Error in insertRow:", error);
    });
  }

  deleteRow(event) {
    this.closeMenuPopUp();
    this.spInterface.deleteRow().catch(error => {
      console.error("Error in deleteRow:", error);
    });
  }

  async invalidate() {
    const wTreeOn = this.treeBandWidth() > 0;
    if (this.state.treeResizeVisible !== wTreeOn) {
      this.setState({ treeResizeVisible: wTreeOn });
    }
    await this.paint();  
  }

  async paint() {
    // spInterface is nulled on unmount; a deferred paint can still fire after
    // a fast mount/unmount cycle (e.g. StrictMode) — bail out instead of crashing.
    const canvas = this.m_Ref.current;
    if (!canvas || !this.spInterface) {
      return;
    }
    let ui = this.spInterface.m_UIView;
    if (ui == null) return;
    const context = canvas.getContext("2d");
  
    let size = this.spInterface.getCanvasSize(canvas)
    const width = size.Width;
    const wNumW = this.numberBandWidth();
    const wTreeW = this.treeBandWidth();

    context.clearRect(0, 0, size.Width, size.Height);
    context.fillStyle = this.headerBackground || "transparent";
    context.fillRect(0, 0, size.Width, size.Height);
  
    context.save();

    // Column outline lives in TopPanel; client/grid share the same Y origin.
    context.translate(0, this.spInterface.gridTreeViewTop?.() ?? 0);

    const gridCanvas = this.spInterface.getGridPaintCanvasEl();
    const gridVp = this.spInterface.getGridInnerViewportCssPx(gridCanvas);

    context.beginPath();
    context.rect(0, 0, size.Width, gridVp.height);
    context.clip();
    
    const left = 0;
    const right = wNumW;
   
    context.lineWidth = this.spInterface.m_GridWidth;
    context.font = this.font;
    context.strokeStyle = this.color;
    context.textAlign = "center";

    const paintRowNumbers = (uiBand, yOff) => {
      const layout = this.spInterface.rowHeaderLayoutForPaint(uiBand);
      if (layout == null) {
        return;
      }
      const wUi = layout.ui ?? null;
      const dY =
        wUi != null
          ? this.spInterface._uiPaneDY(wUi)
          : Number(layout.dY) || 0;

      context.save();
      context.translate(0, yOff + dY);

      let posY = 0;
      context.beginPath();
      for (let y = 0; y < layout.rows.length; y++) {
        const lastPosY = posY;
        const sizeRow = layout.rows[y].s;
        if (sizeRow !== 0) {
          posY += sizeRow;
          let text = layout.rows[y].i.toString();
          let textSize = context.measureText(text);

          if (this.spInterface.m_SelectRow !== null) {
            if (this.spInterface.m_SelectRow.selected(layout.rows[y].i)) {
              context.fillStyle = this.colorSelectHeader || this.colorSelect;
              context.fillRect(left, lastPosY, right - left, posY - lastPosY);
            }
          }
          if (
            this.spInterface.m_Select !== null &&
            !(typeof this.spInterface.hasColRowSelect === "function" &&
              this.spInterface.hasColRowSelect())
          ) {
            if (this.spInterface.m_Select.selectedRow(layout.rows[y].i)) {
              context.fillStyle = this.colorSelectColRow;
              context.fillRect(left, lastPosY, right - left, posY - lastPosY);
            }
          }

          context.fillStyle = this.color;
          context.strokeStyle = this.color;
          context.fillText(
            text,
            wNumW / 2,
            posY + (lastPosY - posY) / 2 + textSize.fontBoundingBoxDescent
          );

          context.strokeStyle = this.spInterface.m_GridColor;

          context.moveTo(left, posY);
          context.lineTo(right, posY);
          context.lineTo(right, lastPosY);
        }
      }
      context.stroke();
      context.restore();
    };

    const paintTreeBand = (uiBand, yOff, clipH) => {
      if (wTreeW <= 0 || !uiBand?.rows) {
        return;
      }
      const dY = this.spInterface._uiPaneDY(uiBand);
      context.save();
      context.beginPath();
      context.rect(wNumW, yOff, wTreeW, clipH);
      context.clip();
      context.fillStyle = SK_TREE_VIEW_COLOR;
      context.fillRect(wNumW, yOff, wTreeW, clipH);
      context.translate(wNumW, yOff);
      drawTreeViewLeft(context, uiBand.rows, 0, dY, wTreeW);
      context.restore();
    };

    const frozenUi = this.spInterface.frozenUiForPaint();
    const frozenH =
      this.spInterface.m_FrozenPixH > 0
        ? Math.ceil(Number(this.spInterface.m_FrozenPixH) || 0)
        : 0;
    const frozenLeftUi = this.spInterface.frozenLeftUiForPaint();
    const fourPane =
      typeof this.spInterface.isFrozenFourPaneActive === "function" &&
      this.spInterface.isFrozenFourPaneActive();
    if (frozenUi && frozenH > 0) {
      const scrollH = Math.max(0, gridVp.height - frozenH);
      context.save();
      context.beginPath();
      context.rect(0, 0, width, frozenH);
      context.clip();
      paintRowNumbers(frozenUi, 0);
      paintTreeBand(frozenUi, 0, frozenH);
      context.restore();

      context.save();
      context.beginPath();
      context.rect(0, frozenH, width, scrollH);
      context.clip();
      const scrollBandUi =
        fourPane && frozenLeftUi ? frozenLeftUi : ui;
      paintRowNumbers(scrollBandUi, frozenH);
      paintTreeBand(scrollBandUi, frozenH, scrollH);
      context.restore();
    } else {
      paintRowNumbers(ui, 0);
      paintTreeBand(ui, 0, gridVp.height);
    }

    context.restore();
  }

  render() {
    return (
      <div>
        <canvas ref={this.m_Ref} style={{cursor: this.state.cursor}} className="SkSpLeftPanel"></canvas>
        {this.state.treeResizeVisible || this.treeBandWidth() > 0 ? (
          <div
            className="SkSpLeftPanel-resize"
            title="Resize row outline"
            onMouseDown={this.onChromeResizeDown}
          />
        ) : null}
        <SkMenuPopUp ref={this.m_RefMenu} onClose={this.closeMenuPopUp} Visible={this.state.menuPopUp}>
          <SkMenuElement onSelect={this.insertRow}><span>Insert row(s)</span></SkMenuElement>
          <SkMenuElement onSelect={this.deleteRow}><span>Delete row(s)</span></SkMenuElement>
        </SkMenuPopUp>
      </div>
    );
  }
}
// ========================================

export default SkSpLeftPanel;
