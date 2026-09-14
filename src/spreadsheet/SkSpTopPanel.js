//=============================================================================
// SkSpTopPanel
// SpreadSheet Panel top (column letters + optional outline band)
//=============================================================================
import React  from "react";
import './SkSpreadSheet.css'
import SkCanvas from "../component/SkCanvas";

import SkMenuPopUp from "../component/SkMenuPopup";
import SkMenuElement from "../component/SkMenuElement";

import { pointerToLayoutPx, layoutToScreenScale } from "../utility/SkViewZoom.js";
import {
  drawTreeViewTop,
  SK_TREE_VIEW_COLOR,
} from "./SkSpTreeViewPaint.js";

class SkSpTopPanel extends SkCanvas {
  constructor(props) {
    super(props);
    this.state = { cursor: "auto", menuPopUp: false, treeResizeVisible: false };
    this.mouseIsDown = false;
    this.spInterface = props.SpInterface;
    this.rangeSelect = false;
    this.spInterface.m_SkSpTopPanel = this; // for invalidate
    this._chromeResize = null;
    this._chromeResizeRaf = 0;

    this.m_RefMenu = React.createRef();
    this.insertCol = this.insertCol.bind(this);
    this.deleteCol = this.deleteCol.bind(this);

    this.closeMenuPopUp = this.closeMenuPopUp.bind(this);
    this.onChromeResizeDown = this.onChromeResizeDown.bind(this);
  }
 
  componentDidMount() {
    //console.log("SkTopPanel::componentDidMount()")
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
    console.log("SkTopPanel::componentWillUnmount()")

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
    if (this.spInterface && this.spInterface.m_SkSpTopPanel === this) {
      this.spInterface.m_SkSpTopPanel = null;
    }
    
    // Clean up other references
    this.spInterface = null;
  }

  onChromeResizeDown(event) {
    if (!this.spInterface || event.button !== 0) {
      return;
    }
    if (!(this.treeBandHeight() > 0)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this._chromeResize = {
      startClientY: event.clientY,
      startBand: this.treeBandHeight(),
    };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  }

  async _applyChromeResize(event) {
    if (!this._chromeResize || !this.spInterface) {
      return;
    }
    const el = this.m_Ref.current;
    const scaleY = layoutToScreenScale(el).y || 1;
    const dy = (event.clientY - this._chromeResize.startClientY) / scaleY;
    const changed = this.spInterface.setTreeBandTop(
      this._chromeResize.startBand + dy
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

  /** Column-letter band height (CSS px). */
  letterBandHeight() {
    return this.spInterface?.getBaseTopSize?.() ?? 30;
  }

  /** Outline band height (CSS px); 0 when TreeView is off. */
  treeBandHeight() {
    return Number(this.spInterface?.m_TreeViewTop) || 0;
  }

  offsetMousePos(event) {
    const el = this.m_Ref.current;
    if (!el || !this.spInterface) {
      return { X: 0, Y: 0 };
    }
    // Layout px (JsonView / col boundaries) — compensates CSS zoom on .SkSpreadSheet.
    const wPt = pointerToLayoutPx(el, event.clientX, event.clientY);
    return {
      X: wPt.x - (this.spInterface.gridTreeViewLeft?.() ?? 0),
      Y: wPt.y,
    };
  }

  async openCloseColAtX(sX) {
    const wCol = await this.spInterface.colByPixel(sX);
    console.log("TopPanel tree click open/close col " + wCol);
    const wCanvas = this.spInterface.m_SkSpGridCanvas;
    if (wCanvas?.openCloseTreeCol) {
      const wOk = await wCanvas.openCloseTreeCol(wCol);
      if (!wOk) {
        console.warn("TopPanel openCloseTreeCol returned false for col", wCol);
      }
      return;
    }
    if (window.SkUISpreadSheet?.openCloseTreeCol?.(wCol)) {
      this.spInterface.invalidateSheetExtent();
      await this.spInterface.reloadView();
      this.spInterface.invalidateAll();
    }
  }

  async mouseDown(event) {
    if (this.state.menuPopUp) {
      return;
    }
    if (this.isEventOnClass(event)) {
      if (event.button === 2) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      let pos = this.offsetMousePos(event);
      const wLetterH = this.letterBandHeight();
      const wTreeH = this.treeBandHeight();

      // Outline band below letters: single click toggles open/close.
      if (wTreeH > 0 && pos.Y >= wLetterH) {
        if (event.detail === 1) {
          try {
            await this.openCloseColAtX(pos.X);
          } catch (error) {
            console.error("Error in tree open/close from TopPanel:", error);
          }
        }
        return;
      }

      this.spInterface.disableChangeSizeColRow();
      this.mouseIsDown = true;

      try {
        const result = await this.spInterface.isChangeSizeCol(pos.X);
        if (result.ColRow !== -1) {
          this.setState({ cursor: "col-resize" });
          this.spInterface.startChangeSizeColRow(true, result); // true for col
        } else {
          this.setState({ cursor: "grab" });
          // Select — keep grid keyboard focus (header canvas is not tabbable).
          event.preventDefault();
          this.rangeSelect = true;
          await this.spInterface.startColRowSelect(false, pos, event); // false for col
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
            console.error("Error in moveChangeSizeColRow:", error);
          }
        } else {
          // Select
          if (this.rangeSelect === true) {
            try {
              await this.spInterface.moveColRowSelect(false, pos);
              this.spInterface.m_SkSpGridCanvas.invalidate();
              this.invalidate();
            } catch (error) {
              console.error("Error in moveColRowSelect:", error);
            }
          }
        }
      } else {
        try {
          const wTreeH = this.treeBandHeight();
          const wLetterH = this.letterBandHeight();
          if (wTreeH > 0 && pos.Y >= wLetterH) {
            this.setState({ cursor: "pointer" });
            return;
          }
          const result = await this.spInterface.isChangeSizeCol(pos.X);
          let col = result.ColRow;
          if (col !== -1) {
            this.setState({ cursor: "col-resize" });
          } else {
            this.setState({ cursor: "auto" });
          }
        } catch (error) {
          console.error("Error in changeSizeCol:", error);
        }
      }
    }
  }

  async mouseUp(event) {
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
        await this.spInterface.endColRowSelect(false, event);
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
  
  insertCol(event) {
    this.closeMenuPopUp();
    this.spInterface.insertCol().catch(error => {
      console.error("Error in insertCol:", error);
    });
  }

  deleteCol(event) {
    this.closeMenuPopUp();
    this.spInterface.deleteCol().catch(error => {
      console.error("Error in deleteCol:", error);
    });
  }

  invalidate() {
    const wTreeOn = this.treeBandHeight() > 0;
    if (this.state.treeResizeVisible !== wTreeOn) {
      this.setState({ treeResizeVisible: wTreeOn });
    }
    this.paint();  
  }

  paint() {
    const canvas = this.m_Ref.current;
    // spInterface is nulled on unmount; a deferred paint can still fire after
    // a fast mount/unmount cycle (e.g. StrictMode) — bail out instead of crashing.
    if (!canvas || !this.spInterface) {
      return;
    }
    const context = canvas.getContext("2d");
    const size = this.spInterface.getCanvasSize(canvas);
    const gridCanvas = this.spInterface.getGridPaintCanvasEl();
    const vp = this.spInterface.getGridInnerViewportCssPx(gridCanvas);
    const wLetterH = this.letterBandHeight();
    const wTreeH = this.treeBandHeight();
    const top = 0;
    const bottom = wLetterH;

    context.clearRect(0, 0, size.Width, size.Height);
    context.fillStyle = this.headerBackground || "transparent";
    context.fillRect(0, 0, size.Width, size.Height);

    const ui = this.spInterface.m_UIView;
    if (ui == null) {
      return;
    }

    const paintColLetters = (uiBand, xOff) => {
      const layout = this.spInterface._columnHeaderLayoutFromUi(uiBand);
      if (layout == null) {
        return;
      }
      const wUi = layout.ui ?? null;
      const dX =
        wUi != null
          ? this.spInterface._uiPaneDX(wUi)
          : Number(layout.dX) || 0;

      context.save();
      context.translate(xOff + dX, 0);

      let posX = 0;
      context.beginPath();
      for (let x = 0; x < layout.cols.length; x++) {
        const lastPosX = posX;
        const sizeCol = layout.cols[x].s;
        if (sizeCol !== 0) {
          posX += sizeCol;
          const text = window.SkUISpreadSheet.base10toAlphaSync(layout.cols[x].i);
          const textSize = context.measureText(text);

          if (this.spInterface.m_SelectCol !== null) {
            if (this.spInterface.m_SelectCol.selected(layout.cols[x].i)) {
              context.fillStyle = this.colorSelectHeader || this.colorSelect;
              context.fillRect(lastPosX, top, posX - lastPosX, bottom - top);
            }
          }
          // Cursor-column tint only when not in whole-col/row header selection mode.
          if (
            this.spInterface.m_Select !== null &&
            !(typeof this.spInterface.hasColRowSelect === "function" &&
              this.spInterface.hasColRowSelect())
          ) {
            if (this.spInterface.m_Select.selectedCol(layout.cols[x].i)) {
              context.fillStyle = this.colorSelectColRow;
              context.fillRect(lastPosX, top, posX - lastPosX, bottom - top);
            }
          }

          context.fillStyle = this.color;
          context.strokeStyle = this.color;
          context.fillText(
            text,
            lastPosX + (sizeCol / 2) - (textSize.width / 2),
            (wLetterH / 2) + textSize.fontBoundingBoxDescent
          );

          context.strokeStyle = this.spInterface.m_GridColor;

          context.moveTo(lastPosX, top);
          context.lineTo(posX, top);
          context.lineTo(posX, bottom);
          context.lineTo(lastPosX, bottom);
          context.lineTo(lastPosX, top);
        }
      }
      context.stroke();
      context.restore();
    };

    const paintTreeBand = (uiBand, xOff, clipW) => {
      if (wTreeH <= 0 || !uiBand?.cols) {
        return;
      }
      const dX = this.spInterface._uiPaneDX(uiBand);
      context.save();
      context.beginPath();
      context.rect(xOff, wLetterH, clipW, wTreeH);
      context.clip();
      context.fillStyle = SK_TREE_VIEW_COLOR;
      context.fillRect(xOff, wLetterH, clipW, wTreeH);
      context.translate(xOff, wLetterH);
      drawTreeViewTop(context, uiBand.cols, 0, dX, wTreeH);
      context.restore();
    };

    context.save();
    context.translate(this.spInterface.gridTreeViewLeft?.() ?? 0, 0);

    context.beginPath();
    context.rect(0, 0, vp.width, size.Height);
    context.clip();

    context.lineWidth = this.spInterface.m_GridWidth;
    context.font = this.font;
    context.strokeStyle = this.color;

    // Mirror SkSpLeftPanel row-header split logic (frozen band + scroll band).
    const frozenColUi = this.spInterface._frozenColumnHeaderUiForPaint();
    const frozenTopUi = this.spInterface.frozenUiForPaint();
    const fw =
      this.spInterface.m_FrozenPixW > 0
        ? Math.ceil(Number(this.spInterface.m_FrozenPixW) || 0)
        : 0;
    const fourPane =
      typeof this.spInterface.isFrozenFourPaneActive === "function" &&
      this.spInterface.isFrozenFourPaneActive();

    if (frozenColUi && fw > 0) {
      const scrollW = Math.max(0, vp.width - fw);
      context.save();
      context.beginPath();
      context.rect(0, 0, fw, size.Height);
      context.clip();
      paintColLetters(frozenColUi, 0);
      paintTreeBand(frozenColUi, 0, fw);
      context.restore();

      context.save();
      context.beginPath();
      context.rect(fw, 0, scrollW, size.Height);
      context.clip();
      const scrollBandUi =
        fourPane && ui
          ? ui
          : this.spInterface._scrollColumnHeaderUiForPaint();
      paintColLetters(scrollBandUi, fw);
      paintTreeBand(scrollBandUi, fw, scrollW);
      context.restore();
    } else if (frozenTopUi && this.spInterface.isFrozenSplitActive()) {
      const scrollUi = this.spInterface._scrollColumnHeaderUiForPaint();
      paintColLetters(scrollUi, 0);
      paintTreeBand(scrollUi, 0, vp.width);
    } else {
      paintColLetters(ui, 0);
      paintTreeBand(ui, 0, vp.width);
    }

    context.restore();
  }

  render() {
    return (
      <div>
        <canvas ref={this.m_Ref} style={{cursor: this.state.cursor}} className="SkSpTopPanel"></canvas>
        {this.state.treeResizeVisible || this.treeBandHeight() > 0 ? (
          <div
            className="SkSpTopPanel-resize"
            title="Resize column outline"
            onMouseDown={this.onChromeResizeDown}
          />
        ) : null}
        <SkMenuPopUp ref={this.m_RefMenu} onClose={this.closeMenuPopUp} Visible={this.state.menuPopUp}>
          <SkMenuElement onSelect={this.insertCol}><div>Insert column(s)</div></SkMenuElement>
          <SkMenuElement onSelect={this.deleteCol}><div>Delete column(s)</div></SkMenuElement>
        </SkMenuPopUp>
      </div>
    );
  }
}
// ========================================

export default SkSpTopPanel;
