//=============================================================================
// SkSpCommand
// Anscestor Command
//=============================================================================
import React from "react";

import SkComponent from "../component/SkComponent";
import SkColorMaterials from "../component/SkColorMaterials";
import SkFontSelector from "../component/SkFontSelector";
import SkTextRotation from "../component/SkTextRotation";

import SkTab from '../component/SkTab';
import SkSpStackPanel from './SkSpStackPanel';

import SkInput from "../component/SkInput";
import SkButton from "../component/SkButton";

import SkSpClass from "./SkSpClass"
import SkSpClassAttribute from "./SkSpClassAttribute";
import SkSpUnit from "./SkSpUnit";
import SkSpFunction from "./SkSpFunction";
import SkFunctionSelector from "../component/SkFunctionSelector";
import SkSpRangeNamed from "./SkSpRangeNamed";
import SkSpTables from "./SkSpTables";
import SkSpFormulaNamed from "./SkSpFormulaNamed";
import SkSpPrintParameters from "./SkSpPrintParameters";
import SkChat from "../component/SkChatClient";
import SkSpAiChat from "./SkSpAiChat";
import SkBorder from "../component/SkBorder";
import SkSpConditionalFormat from "./SkSpConditionalFormat";
import SkSpFind from "./SkSpFind";
import { applyConditionalFormatFromUi } from "./SkConditionalFormatApply.js";

class SkSpCommand extends SkComponent {
  constructor(props) {
    super(props);
    this.state = { 
      fontName: "Roboto",
      fontSize: "11pt",
      color: "#000000",
      formatStringDebug: "",
      textAngle: 0,
      textVertical: false
    };
  
    this.commandRef = React.createRef();
    this.stackRef = React.createRef();
    this.classPanelRef = React.createRef();
    this.tablesPanelRef = React.createRef();
    this.findPanelRef = React.createRef();
    // Refs to child components we keep in sync with the cell under the cursor.
    this.fontSelectorRef = React.createRef();
    this.fontColorRef = React.createRef();
    this.backgroundColorRef = React.createRef();
    this.spInterface = props.SpInterface;

    this.spInterface.m_SkSpCommand=this;
  

    this.width = "0px";
   
    this.setBackgroundColor = this.setBackgroundColor.bind(this);
    this.setFontColor = this.setFontColor.bind(this);
    this.setFont = this.setFont.bind(this);
    this.handleBorderChange = this.handleBorderChange.bind(this);
    this.setTextRotation = this.setTextRotation.bind(this);

    this.col = 0;
    this.row = 0;

    this.load = this.load.bind(this);
    this.debugFormat = this.debugFormat.bind(this);
    this.debugFormatString = this.debugFormatString.bind(this);
    this.conditionalFormat = this.conditionalFormat.bind(this);

    this.pressure = this.pressure.bind(this);
    this.syncFromCursor = this.syncFromCursor.bind(this);
    this.rowChange = this.rowChange.bind(this);
    this.colChange = this.colChange.bind(this);
    this.resize = this.resize.bind(this);
    this.openTab = this.openTab.bind(this);
    this.handleCloseClick = this.handleCloseClick.bind(this);
    this.handleFunctionInsert = this.handleFunctionInsert.bind(this);
  }

  async handleFunctionInsert(formula, targetRef) {
    let wFormula = '';
    try {
      wFormula = formula.startsWith('=') ? formula : '=' + formula;
      this.spInterface.setExtraUndo && this.spInterface.setExtraUndo();

      const wTarget = (targetRef || '').trim();
      let wOk = true;
      if (wTarget) {
        wOk = window.SkUISpreadSheet.value(wTarget, wFormula);
      } else {
        wOk = await this.spInterface.setValue(wFormula);
        if (this.spInterface.m_SkSpInplaceEdit) {
          this.spInterface.m_SkSpInplaceEdit.setText(wFormula);
        }
      }
      if (!wOk) {
        if (typeof this.spInterface.notifyFormulaCompileFailure === 'function') {
          await this.spInterface.notifyFormulaCompileFailure(wFormula, null);
        }
        return;
      }
      await this.spInterface.reloadView();
    } catch (error) {
      console.error("SkSpCommand::handleFunctionInsert error", error);
      if (
        typeof this.spInterface.notifyFormulaCompileFailure === 'function' &&
        wFormula !== ''
      ) {
        await this.spInterface.notifyFormulaCompileFailure(wFormula, error);
      }
    }
  }

  invalidate() {
  }
  
  componentDidMount(prevProps) {
    // Store bound event handler to properly remove it later
    this.boundResize = this.resize.bind(this);
    this.m_Ref.current.addEventListener('resize', this.boundResize);
    this.invalidate();
  }

  componentDidUpdate(prevProps) {
     this.invalidate();
  }

  /**
   * Clean up all resources when component unmounts to prevent memory leaks
   * - Removes resize event listener
   */
  componentWillUnmount(prevProps) {
    if (this.m_Ref.current) {
      this.m_Ref.current.removeEventListener('resize', this.boundResize);
    }
  }

  async resize() {
    await this.invalidate();
  }

  async setFormatStringDebug(formatString) {
    this.setState({ formatStringDebug: formatString });
  }

  async setBackgroundColor(event, color) {
    console.log("BackgroundColor On Click " + color);
    this.spInterface.setExtraUndo();
    let selection = this.spInterface.selectstr();
    window.SkUISpreadSheet.format(selection, "background-color:" + color + ";");
    await this.spInterface.reloadView();
  }

  async setFontColor(event, color) {
    this.spInterface.setExtraUndo();
    let selection = this.spInterface.selectstr();
    window.SkUISpreadSheet.format(selection, "color:" + color + ";");
    this.setState({ color });
    await this.spInterface.reloadView();
  }

  async setFont(event, fontName, fontSize) {
    this.setState({ fontName, fontSize });
    
    console.log("BackgroundColor On Click " + fontName + "," + fontSize);
    this.spInterface.setExtraUndo();
    let selection = this.spInterface.selectstr();
    window.SkUISpreadSheet.format(selection, "font:\"" + fontName + "\",serif " + fontSize + ";");
    await this.spInterface.reloadView();
  }

  handleBorderChange(color, style, size) {
    console.log(`Border changed: color=${color}, style=${style}, size=${size}`);
    // This method can be used to keep the border state in sync
    // or to run extra actions when a border changes
  }

  // Keep the side-panel controls (font, colors, rotation) in sync with the
  // cell currently under the cursor. Called by SkSpInterface every time the
  // selection/cursor moves. Silently ignores missing properties to remain
  // robust against partially-formatted cells.
  syncFromCursor(sCell) {
    if (!sCell) return;

    if (this.fontSelectorRef.current && this.fontSelectorRef.current.syncFont) {
      // Match Excel: when the cell has no explicit font or size, leave the
      // selector as-is. Only push values that are actually set on the cell.
      const wName = sCell.f_f_n || undefined;
      const wSize = (sCell.f_f_s !== undefined && sCell.f_f_s !== null)
        ? String(sCell.f_f_s)
        : undefined;
      this.fontSelectorRef.current.syncFont(wName, wSize);
    }

    // Fallback to the cell's default appearance when no explicit color is
    // set: black text on a white background.
    const wFontColor = sCell.f_c || "#000000";
    const wBackColor = sCell.f_bc || "#ffffff";
    if (this.fontColorRef.current && this.fontColorRef.current.setColor) {
      this.fontColorRef.current.setColor(wFontColor);
    }
    if (this.backgroundColorRef.current && this.backgroundColorRef.current.setColor) {
      this.backgroundColorRef.current.setColor(wBackColor);
    }

    // Text rotation (SkTextRotation syncs via props through getDerivedStateFromProps).
    let wAngle = 0;
    let wVertical = false;
    if (sCell.f_tr !== undefined && sCell.f_tr !== null) {
      const wTr = Number(sCell.f_tr);
      if (wTr === 255) wVertical = true;
      else if (!Number.isNaN(wTr)) wAngle = wTr;
    }
    if (wAngle !== this.state.textAngle || wVertical !== this.state.textVertical) {
      this.setState({ textAngle: wAngle, textVertical: wVertical });
    }

    // Keep local font state for consistency (used by setFont paths). Only
    // override when the cell carries an explicit font name/size, matching
    // Excel's behaviour of keeping the last-picked value otherwise.
    const wNextLocal = {};
    if (sCell.f_f_n && sCell.f_f_n !== this.state.fontName) {
      wNextLocal.fontName = sCell.f_f_n;
    }
    if (sCell.f_f_s !== undefined && sCell.f_f_s !== null) {
      const wSizeStr = sCell.f_f_s + "pt";
      if (wSizeStr !== this.state.fontSize) wNextLocal.fontSize = wSizeStr;
    }
    if (wFontColor !== this.state.color) wNextLocal.color = wFontColor;
    if (Object.keys(wNextLocal).length > 0) {
      this.setState(wNextLocal);
    }
  }

  async setTextRotation({ angle, vertical }) {
    // Excel-compatible encoding: 0..90 / -90..0 = rotation angle,
    // 255 = special sentinel for "vertical stacked text" (letters upright).
    const wAngle = vertical ? 255 : Number(angle) || 0;
    this.setState({ textAngle: vertical ? 0 : wAngle, textVertical: !!vertical });

    this.spInterface.setExtraUndo();
    const wSelection = this.spInterface.selectstr();
    window.SkUISpreadSheet.format(wSelection, `text-rotate:${wAngle};`);
    await this.spInterface.reloadView();
  }

  load() {
    let json = window.WebInterface.getJson('/robot', '');
    console.log("-->" + json);
  }

  async debugFormat() {
    window.SkUISpreadSheet.debugFormat();
  }

  async debugFormatString() {
    let json = window.SkUISpreadSheet.jsonFormatString();
    const returnObj = JSON.parse(json);
    console.log(returnObj);
  }

  async conditionalFormat(format) {
    try {
      await applyConditionalFormatFromUi(this.spInterface, format);
    } catch (error) {
      console.error("SkSpCommand::conditionalFormat error", error);
    }
  }

  rowChange(event) {
    this.row = event.target.value;
  }

  colChange(event) {
    this.col = event.target.value;
  }
  
  async pressure(event) {
    const wRows = Number(this.row) || 0;
    const wCols = Number(this.col) || 0;
    const wSpreadSheet = window.SkSpreadSheet;
    // Preferred path: cooperative generation with a live % in the recalc banner.
    if (wSpreadSheet && typeof wSpreadSheet.runPressure === "function") {
      await wSpreadSheet.runPressure(wRows, wCols);
      return;
    }
    // Fallback: single blocking call (no live progress).
    window.SkUISpreadSheet.pressure(wRows, wCols);
    await this.spInterface.reloadView();
  }

  openTab(label) {
    if (!label || !this.stackRef.current || typeof this.stackRef.current.openPanel !== 'function') {
      return;
    }
    this.stackRef.current.openPanel(label);
    if (label === "Class" && this.classPanelRef.current?.reloadClasses) {
      void this.classPanelRef.current.reloadClasses();
    }
    if (label === "Tables" && this.tablesPanelRef.current?.refresh) {
      void this.tablesPanelRef.current.refresh();
    }
    if (label === "Find" && this.findPanelRef.current?.focusSearchInput) {
      requestAnimationFrame(() => {
        this.findPanelRef.current?.focusSearchInput();
      });
    }
  }

  /** True when the Debug tab is the active right-panel view. */
  isDebugTabActive() {
    return this.stackRef?.current?.getActivePanel?.() === "Debug";
  }

  handleCloseClick() {
    if (typeof this.props.onClose === 'function') {
      this.props.onClose();
    }
  }

  render() {
    return (
      <div className="SkSpCommand" ref={this.m_Ref}>
        <SkSpStackPanel
          ref={this.stackRef}
          defaultPanel="Font & Material Color"
          onClose={this.handleCloseClick}
        >
          <SkTab label="Font & Material Color">
            <div className="SkSpTopTool">
              <SkFontSelector ref={this.fontSelectorRef} SelectFont={this.setFont} />
            </div>
            <SkTextRotation
              angle={this.state.textAngle}
              vertical={this.state.textVertical}
              previewText="Text"
              onChange={this.setTextRotation}
            />
            <SkColorMaterials 
              ref={this.fontColorRef}
              id="SkFontColor" 
              title="Font color"
              SelectColor={this.setFontColor}
            />
            <SkColorMaterials 
              ref={this.backgroundColorRef}
              id="SkBackgroundColor" 
              title="Background color"
              SelectColor={this.setBackgroundColor}
            />
          </SkTab>
          <SkTab label="Border">
            <div className="SkSpCommand-borderSection">
              <SkBorder 
                embedded
                SpInterface={this.spInterface} 
                onBorderChange={this.handleBorderChange}
              />
            </div>
          </SkTab>
          <SkTab label="Class">
            <SkSpClass ref={this.classPanelRef} SpInterface={this.spInterface} />
          </SkTab>
          <SkTab label="Function">
            <SkSpFunction SpInterface={this.spInterface} />
          </SkTab>
          <SkTab label="Insert function">
            <SkFunctionSelector
              embedded
              label="Function Selector"
              SpInterface={this.spInterface}
              onSelect={this.handleFunctionInsert}
            />
          </SkTab>
          <SkTab label="Attribute">
            <SkSpClassAttribute SpInterface={this.spInterface} />
          </SkTab>
            <SkTab label="Unit">
              <SkSpUnit SpInterface={this.spInterface} />
            </SkTab>
          <SkTab label="Named ranges">
            <SkSpRangeNamed SpInterface={this.spInterface} />
          </SkTab>
          <SkTab label="Tables">
            <SkSpTables ref={this.tablesPanelRef} SpInterface={this.spInterface} />
          </SkTab>
          <SkTab label="Print">
            <SkSpPrintParameters SpInterface={this.spInterface} />
          </SkTab>
          <SkTab label="Named formulas">
            <SkSpFormulaNamed SpInterface={this.spInterface} />
          </SkTab>
          <SkTab label="Chat">
            <SkChat />
          </SkTab>
          <SkTab label="Assistant IA">
            <SkSpAiChat SpInterface={this.spInterface} />
          </SkTab>
          <SkTab label="Conditional">
            <SkSpConditionalFormat SpInterface={this.spInterface} />
          </SkTab>
          <SkTab label="Find">
            <SkSpFind ref={this.findPanelRef} SpInterface={this.spInterface} />
          </SkTab>
          <SkTab label="Debug">
            <div>Format String=</div>
            <div>{this.state.formatStringDebug}</div>
            <SkButton className="SkMargin" onClick={this.debugFormat}>Debug Format</SkButton>
            <SkButton className="SkMargin" onClick={this.debugFormatString}>Debug FormatString</SkButton>
            <div className="SkAutoSizePanel" />
            <div>Rows</div>
            <SkInput 
              placeholder="Enter number of row" 
              id="idRow" 
              key="keyRow"
              onChange={this.rowChange}
              type="number"
            />
            <div>Cols</div>
            <SkInput 
              placeholder="Enter number of col" 
              id="idCol" 
              key="keyCol"
              onChange={this.colChange}
              type="number"
            />
            <SkButton className="SkMargin" onClick={this.pressure}>Debug Pressure</SkButton>
          </SkTab>
        </SkSpStackPanel>
      </div>
    );
  }
}
// ============================================================================
export default SkSpCommand;