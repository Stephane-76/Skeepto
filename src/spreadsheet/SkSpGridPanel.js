//=============================================================================
// SkSpGridPanel
// SpreadSheet Panel of cell 
//=============================================================================
import React from "react";
import SkComponent  from "../component/SkComponent";
import { GetRender } from "./CellClass/SkCellClass";
import './SkSpreadSheet.css'

class SkSpGridPanel extends SkComponent  {
  constructor(props) {
    super(props);
    this.state = ({ invalidate : false });
    this.m_Border=false;
    this.m_SpInterface=props.SpInterface;
    this.m_SpInterface.m_SkSpGridPanel=this; // for invalidate

    this.m_SpInterface.syncHeaderChromeCss?.();
  }
   
  componentDidMount() {
    //console.log( "SkGridPanel::componentDidMount()")
    // Store bound event handler to properly remove it later
    this.boundResize = this.resize.bind(this);
    window.addEventListener('resize', this.boundResize);
  }

  /**
   * Clean up all resources when component unmounts to prevent memory leaks
   * - Removes resize event listener
   * - Cleans up circular references
   */
  componentWillUnmount(prevProps) {
    console.log( "SkGridPanel::componentWillUnmount()")
    
    // Clean up resize event listener
    window.removeEventListener('resize', this.boundResize);
    
    // Clean up circular references
    if (this.m_SpInterface && this.m_SpInterface.m_SkSpGridPanel === this) {
      this.m_SpInterface.m_SkSpGridPanel = null;
    }
    
    // Clean up other references
    this.m_SpInterface = null;
  }
  
  invalidate() {
    this.setState({ invalidate : !this.state.invalidate });
  }

  async resize() {
    await this.m_SpInterface.reloadView();
    this.invalidate();
  }
  
  RenderObject(sCell) {
    if (sCell.c_t==="c") {
      // Spill / overflow proxy cells: narrow geometry, duplicate c_v — would spawn a second tiny widget.
      if (sCell.hasOwnProperty("c__l") || sCell.hasOwnProperty("c__r")) {
        return undefined;
      }
      let wObj=sCell.c_v;
      if (wObj.hasOwnProperty("co")) {
        let wClassName=wObj.n;
        //console.log(sCell)
        let wRender=GetRender(wClassName)
        if (wRender!==undefined) {
          return(wRender(sCell,this.m_SpInterface))
        }    
      }
    }
  }

  mapRowsToCells(wUI) {
    const out = [];
    if (!wUI || !Array.isArray(wUI.rows)) {
      return out;
    }
    for (const wRow of wUI.rows) {
      const cells = wRow.cells;
      if (!Array.isArray(cells)) continue;
      for (const wCell of cells) {
        if (wCell == null || typeof wCell === "undefined") continue;
        const wNode = this.RenderObject(wCell);
        if (wNode != null) {
          out.push(wNode);
        }
      }
    }
    return out;
  }

  render() {
    let wUI=this.m_SpInterface.m_UIView ;
    if (wUI===null) {
      return(<div ref={this.m_Ref}/>);
    }
    
    // Match SkSpGridCanvas clip / JsonView: exclude scrollbar overlays from cell widget layout.
    const wTreeLeft = this.m_SpInterface.gridTreeViewLeft?.() ?? 0;
    const wTreeTop = this.m_SpInterface.gridTreeViewTop?.() ?? 0;
    const wStyle = {
      left: wTreeLeft,
      top: wTreeTop,
      width: `calc(100% - ${wTreeLeft}px - var(--sk-vscrollbar-size, 0px))`,
      height: `calc(100% - ${wTreeTop}px - var(--sk-hscrollbar-size, 0px))`,
    }

    const wFrozen = this.m_SpInterface.frozenUiForPaint();
    const wFrozenH =
      this.m_SpInterface.m_FrozenPixH > 0
        ? Math.ceil(Number(this.m_SpInterface.m_FrozenPixH) || 0)
        : 0;
    const wCorner = this.m_SpInterface.frozenCornerUiForPaint();
    const wFrozenW =
      this.m_SpInterface.m_FrozenPixW > 0
        ? Math.ceil(Number(this.m_SpInterface.m_FrozenPixW) || 0)
        : 0;
    const wFourPane =
      wCorner &&
      wFrozen &&
      wFrozenH > 0 &&
      wFrozenW > 0;
    const rowSplitOnly = wFrozen && wFrozenH > 0 && !wFourPane;
    const wFrozenLeft = this.m_SpInterface.frozenLeftUiForPaint();
    const colSplitOnly = wFrozenLeft && wFrozenW > 0 && !rowSplitOnly && !wFourPane;

    return (
    <div ref={this.m_Ref} className="SkSpGridPanel" style={wStyle}>
      {wFourPane ? (
        <>
          <div
            className="SkSpGridPanelFrozenCorner"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: wFrozenW + "px",
              height: wFrozenH + "px",
              overflow: "hidden",
              pointerEvents: "none",
            }}
          >
            {this.mapRowsToCells(wCorner)}
          </div>
          <div
            className="SkSpGridPanelFrozenTop"
            style={{
              position: "absolute",
              left: wFrozenW + "px",
              top: 0,
              right: 0,
              height: wFrozenH + "px",
              overflow: "hidden",
              pointerEvents: "none",
            }}
          >
            {this.mapRowsToCells(wFrozen)}
          </div>
          <div
            className="SkSpGridPanelFrozenLeft"
            style={{
              position: "absolute",
              left: 0,
              top: wFrozenH + "px",
              width: wFrozenW + "px",
              bottom: 0,
              overflow: "hidden",
              pointerEvents: "none",
            }}
          >
            {this.mapRowsToCells(wFrozenLeft)}
          </div>
          <div
            className="SkSpGridPanelScroll"
            style={{
              position: "absolute",
              left: wFrozenW + "px",
              top: wFrozenH + "px",
              right: 0,
              bottom: 0,
              overflow: "hidden",
              pointerEvents: "none",
            }}
          >
            {this.mapRowsToCells(wUI)}
          </div>
        </>
      ) : rowSplitOnly ? (
        <>
          <div
            className="SkSpGridPanelFrozen"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              right: 0,
              height: wFrozenH + "px",
              overflow: "hidden",
              pointerEvents: "none",
            }}
          >
            {this.mapRowsToCells(wFrozen)}
          </div>
          <div
            className="SkSpGridPanelScroll"
            style={{
              position: "absolute",
              left: 0,
              top: wFrozenH + "px",
              right: 0,
              bottom: 0,
              overflow: "hidden",
              pointerEvents: "none",
            }}
          >
            {this.mapRowsToCells(wUI)}
          </div>
        </>
      ) : colSplitOnly ? (
        <>
          <div
            className="SkSpGridPanelFrozenCol"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: wFrozenW + "px",
              bottom: 0,
              overflow: "hidden",
              pointerEvents: "none",
            }}
          >
            {this.mapRowsToCells(wFrozenLeft)}
          </div>
          <div
            className="SkSpGridPanelScroll"
            style={{
              position: "absolute",
              left: wFrozenW + "px",
              top: 0,
              right: 0,
              bottom: 0,
              overflow: "hidden",
              pointerEvents: "none",
            }}
          >
            {this.mapRowsToCells(wUI)}
          </div>
        </>
      ) : (
        this.mapRowsToCells(wUI)
      )}
    </div>  
    );
  }
    
}

  
// ========================================
export default SkSpGridPanel;
