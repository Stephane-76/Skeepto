//=============================================================================
// SkSpTopCommand
// Panel bottom 
//=============================================================================
import React from "react";
import SkComponent  from "../component/SkComponent";
import './SkSpreadSheet.css'

import SkMenuPopUp from "../component/SkMenuPopup";
import SkFontSelector from "../component/SkFontSelector";
import SkColor from "../component/SkColor";
import SkBorder from "../component/SkBorder";
import SkConditionalFormat from "../component/SkConditionalFormat";
import { applyConditionalFormatFromUi } from "./SkConditionalFormatApply.js";
import {
  toggleBold,
  toggleItalic,
  toggleUnderline,
  toggleStrikethrough,
} from './SkCellTextFormat.js';
import SkSpFormatString from "./SkSpFormatString"
import SkSpNumberFormatMenu from "./SkSpNumberFormatMenu"

import SkSpUnit from "./SkSpUnit";

import { ReactComponent as SvgUndo } from "../svg/undo.svg";
import { ReactComponent as SvgRedo } from "../svg/redo.svg";

import { ReactComponent as SvgAlignLeft } from "../svg/align-left.svg";
import { ReactComponent as SvgAlignRight } from "../svg/align-right.svg";
import { ReactComponent as SvgAlignCenter } from "../svg/align-center.svg";

import { ReactComponent as SvgVerticalAlignTop } from "../svg/vertical_align_top.svg";
import { ReactComponent as SvgVerticalAlignBottom } from "../svg/vertical_align_bottom.svg";
import { ReactComponent as SvgVerticalAlignCenter } from "../svg/vertical_align_center.svg";
import { ReactComponent as SvgTextWrap } from "../svg/text-wrap.svg";

import { ReactComponent as SvgBold } from "../svg/bold.svg";
import { ReactComponent as SvgItalic } from "../svg/italic.svg";
import { ReactComponent as SvgUnderline } from "../svg/underline.svg";
import { ReactComponent as SvgStrikethrough } from "../svg/strikethrough.svg";


import { ReactComponent as SvgBorderAll } from "../svg/border_all.svg";
import { ReactComponent as SvgFormatColorFillBucket } from "../svg/format_color_fill_bucket.svg";


import { ReactComponent as SkPopUpCde } from "../svg/accordion-menu.svg";
import { ReactComponent as SvgIndent } from "../svg/indent.svg";
import { ReactComponent as SvgDeindent } from "../svg/deindent.svg";
import { ReactComponent as SvgIndentCol } from "../svg/indent-col.svg";
import { ReactComponent as SvgDeindentCol } from "../svg/deindent-col.svg";

import { ReactComponent as SvgCelllMerge } from "../svg/cell_merge.svg";

import { ReactComponent as SvgLineDelete } from "../svg/line-delete.svg";
import { ReactComponent as SvgLineInsert } from "../svg/line-insert.svg";

import { ReactComponent as SvgColumnDelete } from "../svg/column-delete.svg";
import { ReactComponent as SvgColumnInsert } from "../svg/column-insert.svg";

import { ReactComponent as SvgDollard } from "../svg/dollar.svg";

import { ReactComponent as SvgNumeric } from "../svg/number.svg"
import { ReactComponent as SvgAccounting } from "../svg/accounting-icon.svg";
import { ReactComponent as SvgCalendar } from "../svg/calendar-clock.svg";
import { ReactComponent as SvgScientific } from "../svg/science-atom-icon.svg";
import { ReactComponent as SvgPercent } from "../svg/percent.svg"

import { ReactComponent as SvgDecimalIncrease } from "../svg/decimal-increase.svg";
import { ReactComponent as SvgDecimalDecrease } from "../svg/decimal-decrease.svg";

import { alignPopupWithinViewport } from "../utility/SkUtility.js";
import { ImageToolbarIcon, openImageFilePicker } from "./SkSpInsertImage.js";
import SkThemeFlipToggle from "../component/SkThemeFlipToggle.js";
import SkToolbarHint from "../component/SkToolbarHint.js";
import { isDesktop } from "../desktop/SkDesktopMode.js";

class SkSpTopCommand extends SkComponent {
  constructor(props) {
    super(props);
    this.state = ({ invalidate : false ,  
                    menuPopUpMoney : false,
                    menuPopUpNumber : false,
                    menuPopUpBorder : false,
                    menuPopUpFormatAccounting : false,
                    menuPopUpFormatDate : false,
                    menuPopUpFormatScientific : false,
                    menuPopUpPercent : false,
                    textColor: '#000000',
                    backgroundColor: '#ffffff', // Add background color state
                    recentColors: ['#000000', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'], // Add recent colors array
                    menuPopUpTextColor: false,
                    menuPopUpBackgroundColor: false, // Add background color picker state
                    // Active-state flags mirrored from the cell under the cursor
                    // (bold/italic/underline/strike and horizontal/vertical alignments).
                    isBold: false,
                    isItalic: false,
                    isUnderline: false,
                    isStrike: false,
                    hAlign: 0,
                    vAlign: 0,
                    isWrap: false });

    this.spInterface = props.SpInterface;
    // Expose this instance to SkSpInterface so its invalidateSelection hook
    // can push cell-format updates to the toolbar on every cursor move.
    this.spInterface.m_SkSpTopCommand = this;
    this.fontSelectorRef = React.createRef();
    this.undo = this.undo.bind(this);
    this.redo = this.redo.bind(this);

    this.textLeft = this.textLeft.bind(this);
    this.textRight = this.textRight.bind(this);
    this.textCenter = this.textCenter.bind(this);

    this.textTop = this.textTop.bind(this);
    this.textBottom = this.textBottom.bind(this);
    this.textVCenter = this.textVCenter.bind(this);
    this.textWrap = this.textWrap.bind(this);

    this.fontBold = this.fontBold.bind(this);
    this.fontItalic = this.fontItalic.bind(this);
    this.fontUnderLine = this.fontUnderLine.bind(this);
    this.fontStrikethrough = this.fontStrikethrough.bind(this);
    this.insertImage = this.insertImage.bind(this);

    this.fontFamily = this.fontFamily.bind(this);
    this.fontSize = this.fontSize.bind(this);
    this.textColor = this.textColor.bind(this);
    this.backgroundColor = this.backgroundColor.bind(this);

    this.cellMerge = this.cellMerge.bind(this);

    this.insertRow = this.insertRow.bind(this);
    this.deleteRow = this.deleteRow.bind(this);

    this.insertCol = this.insertCol.bind(this);
    this.deleteCol = this.deleteCol.bind(this);

    // Border popup
    this.border = this.border.bind(this);

    this.m_RefMenuFormatNumber = React.createRef();
    this.closeMenuPopUpFormatNumber = this.closeMenuPopUpFormatNumber.bind(this);
    this.formatNumber = this.formatNumber.bind(this);
   
    this.m_RefMenuFormatAccounting = React.createRef();
    this.closeMenuPopUpFormatAccounting = this.closeMenuPopUpFormatAccounting.bind(this);
    this.formatAccounting = this.formatAccounting.bind(this);

    this.m_RefMenuFormatDate = React.createRef();
    this.closeMenuPopUpFormatDate = this.closeMenuPopUpFormatDate.bind(this);
    this.formatDate = this.formatDate.bind(this);

    this.m_RefMenuFormatScientific = React.createRef();
    this.closeMenuPopUpFormatScientific = this.closeMenuPopUpFormatScientific.bind(this);
    this.formatScientific = this.formatScientific.bind(this);

    this.m_RefMenuFormatPercent = React.createRef();
    this.closeMenuPopUpFormatPercent = this.closeMenuPopUpFormatPercent.bind(this);
    this.formatPercent = this.formatPercent.bind(this);

    this.decimalPrecision = this.decimalPrecision.bind(this);


    this.m_RefTextColor = React.createRef();
    this.openTextColorPicker = this.openTextColorPicker.bind(this);
    this.closeTextColorPicker = this.closeTextColorPicker.bind(this);
    this.openBackgroundColorPicker = this.openBackgroundColorPicker.bind(this);
    this.closeBackgroundColorPicker = this.closeBackgroundColorPicker.bind(this);

    this.conditionalFormat = this.conditionalFormat.bind(this);

    this.m_RefMenuMoney = React.createRef();
    this.closeMenuPopUpMoney = this.closeMenuPopUpMoney.bind(this);
    this.money = this.money.bind(this);

    this.switchTreeView = this.switchTreeView.bind(this);
    this.treeIndent = this.treeIndent.bind(this);
    this.treeOutdent = this.treeOutdent.bind(this);
    this.treeIndentCol = this.treeIndentCol.bind(this);
    this.treeOutdentCol = this.treeOutdentCol.bind(this);
    this.syncFromCursor = this.syncFromCursor.bind(this);
  }

  // Keep the toolbar's interactive buttons (bold/italic/align/...) and visual
  // swatches (text color, background color, font selector) in sync with the
  // cell currently under the cursor. Called by SkSpInterface on every cursor
  // move. Missing properties are treated as "off" so the toolbar reflects the
  // actual state, including when a cell has no formatting at all.
  syncFromCursor(sCell) {
    if (!sCell) return;

    const wNext = {
      isBold: sCell.hasOwnProperty("f_we") && Number(sCell.f_we) === 3,
      isItalic: sCell.hasOwnProperty("f_st") && Number(sCell.f_st) === 3,
      isUnderline: sCell.hasOwnProperty("f_d_u"),
      isStrike: sCell.hasOwnProperty("f_d_l"),
      hAlign: sCell.hasOwnProperty("f_ah") ? Number(sCell.f_ah) : 0,
      vAlign: sCell.hasOwnProperty("f_av") ? Number(sCell.f_av) : 0,
      isWrap: sCell.hasOwnProperty("f_tw") && Number(sCell.f_tw) === 2,
      // Fallback to the cell's default appearance when no explicit color is
      // set: black text on a white background.
      textColor: sCell.f_c || "#000000",
      backgroundColor: sCell.f_bc || "#ffffff",
    };

    this.setState(wNext);

    if (this.fontSelectorRef.current && this.fontSelectorRef.current.syncFont) {
      // Match Excel: when the cell has no explicit font or size, leave the
      // selector as-is. Only push values that are actually set on the cell.
      const wName = sCell.f_f_n || undefined;
      const wSize = (sCell.f_f_s !== undefined && sCell.f_f_s !== null)
        ? String(sCell.f_f_s) : undefined;
      this.fontSelectorRef.current.syncFont(wName, wSize);
    }
  }

  componentDidMount() {
    // Add click outside handler for color picker and border popup
    document.addEventListener('mousedown', this.handleClickOutside);
    this.boundResizeToolbarPopups = () => this.scheduleAlignToolbarPopups();
    window.addEventListener('resize', this.boundResizeToolbarPopups);
  }

  componentDidUpdate(prevProps, prevState) {
    if (
      this.state.menuPopUpTextColor !== prevState.menuPopUpTextColor ||
      this.state.menuPopUpBackgroundColor !== prevState.menuPopUpBackgroundColor ||
      this.state.menuPopUpBorder !== prevState.menuPopUpBorder
    ) {
      this.scheduleAlignToolbarPopups();
    }
  }

  componentWillUnmount() {
    // Remove click outside handler
    document.removeEventListener('mousedown', this.handleClickOutside);
    window.removeEventListener('resize', this.boundResizeToolbarPopups);
  }

  scheduleAlignToolbarPopups() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.alignOpenToolbarPopups();
      });
    });
  }

  alignOpenToolbarPopups() {
    if (!this.m_Ref.current) {
      return;
    }
    const popups = this.m_Ref.current.querySelectorAll('.SkSpTopCommand-popup');
    popups.forEach((el) => alignPopupWithinViewport(el));
  }

  handleClickOutside = (event) => {
    // Native color picker UI is outside the popup DOM tree
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.type === 'color') {
      return;
    }
    if (event.target instanceof HTMLInputElement && event.target.type === 'color') {
      return;
    }
    if (event.target instanceof Element && event.target.closest('input[type="color"]')) {
      return;
    }

    // Shared detector: clicks inside the toolbar floating popup (font color,
    // background color, borders) must not close it. Since the popup chrome
    // is now a pure CSS class, we match on the class rather than on an inline
    // position:absolute style.
    const popupContainer = event.target.closest('.SkSpTopCommand-popup');

    // Close color picker if clicking outside
    if (this.state.menuPopUpTextColor) {
      const textColorButton = event.target.closest('.SkTextColorButton');
      if (!popupContainer && !textColorButton) {
        this.setState({ menuPopUpTextColor: false });
      }
    }

    // Close background color picker if clicking outside
    if (this.state.menuPopUpBackgroundColor) {
      const backgroundColorButton = event.target.closest('.SkBackgroundColorButton');
      if (!popupContainer && !backgroundColorButton) {
        this.setState({ menuPopUpBackgroundColor: false });
      }
    }

    // Close border popup if clicking outside
    if (this.state.menuPopUpBorder) {
      const borderButton = event.target.closest('[data-sk-toolbar-border-popup]');
      if (!popupContainer && !borderButton) {
        this.setState({ menuPopUpBorder: false });
      }
    }
  }

  undo() {
    console.log(this);
    this.spInterface.undo().then(() => {
      // Nothing to do after
    });
  }

  redo() {
    this.spInterface.redo().then(() => {
      // Nothing to do after
    });
  }

  textLeft() {
    this.spInterface.setExtraUndo();
    let selection = this.spInterface.selectstr();
    this.setState({ hAlign: 2 });
    window.SkUISpreadSheet.format(selection, "text-align: left;")
    this.spInterface.reloadView()
      .catch(error => {
        console.error("Error in reloadView:", error);
      });
  }
  
  textRight() {
    this.spInterface.setExtraUndo();
    let selection = this.spInterface.selectstr();
    this.setState({ hAlign: 3 });
    window.SkUISpreadSheet.format(selection, "text-align: right;")
    this.spInterface.reloadView()
      .catch(error => {
        console.error("Error in reloadView:", error);
      });   
  }
  
  textCenter() {
    this.spInterface.setExtraUndo();
    let selection = this.spInterface.selectstr();
    this.setState({ hAlign: 4 });
    window.SkUISpreadSheet.format(selection, "text-align: center;")
    this.spInterface.reloadView()
      .catch(error => {
        console.error("Error in reloadView:", error);
      });   
  }

  textTop() {
    this.spInterface.setExtraUndo();
    let selection = this.spInterface.selectstr();
    this.setState({ vAlign: 5 });
    window.SkUISpreadSheet.format(selection, "vertical-align:top;")
    this.spInterface.reloadView()
      .catch(error => {
        console.error("Error in reloadView:", error);
      });
  }
  
  textBottom() {
    this.spInterface.setExtraUndo();
    let selection = this.spInterface.selectstr();
    this.setState({ vAlign: 9 });
    window.SkUISpreadSheet.format(selection, "vertical-align:bottom;")
    this.spInterface.reloadView()
      .catch(error => {
        console.error("Error in reloadView:", error);
      });   
  }
  
  textVCenter() {
    this.spInterface.setExtraUndo();
    let selection = this.spInterface.selectstr();
    this.setState({ vAlign: 7 });
    window.SkUISpreadSheet.format(selection, "vertical-align:middle;")
    this.spInterface.reloadView()
      .catch(error => {
        console.error("Error in reloadView:", error);
      });   
  }

  buildTextWrapCommand(cell, wantWrap) {
    let command = wantWrap ? "text-wrap: wrap;" : "text-wrap: nowrap;";
    if (cell) {
      if (cell.f_bc) {
        command += `background-color:${cell.f_bc};`;
      }
      if (cell.f_c) {
        command += `color:${cell.f_c};`;
      }
    }
    return command;
  }

  /** Toggle Excel-like automatic line wrap (text-wrap: wrap / nowrap). f_tw: 2=wrap, 3=nowrap. */
  textWrap() {
    this.spInterface.setExtraUndo();
    const selection = this.spInterface.selectstr();
    const cell = this.spInterface.GetCellcursor();
    const wantWrap = !(cell.hasOwnProperty("f_tw") && Number(cell.f_tw) === 2);
    this.setState({ isWrap: wantWrap });
    const command = this.buildTextWrapCommand(cell, wantWrap);
    window.SkUISpreadSheet.format(selection, command);
    this.spInterface.reloadView().catch((error) => {
      console.error("Error in reloadView:", error);
    });
  }

  fontBold() {
    toggleBold(this.spInterface).catch((error) => {
      console.error('Error in fontBold:', error);
    });
  }

  fontItalic() {
    toggleItalic(this.spInterface).catch((error) => {
      console.error('Error in fontItalic:', error);
    });
  }

  fontUnderLine() {
    toggleUnderline(this.spInterface).catch((error) => {
      console.error('Error in fontUnderLine:', error);
    });
  }

  fontStrikethrough() {
    toggleStrikethrough(this.spInterface).catch((error) => {
      console.error('Error in fontStrikethrough:', error);
    });
  }
  
  fontFamily(event, fontName, fontSize) {
    this.spInterface.setExtraUndo();
    let selection = this.spInterface.selectstr();
    let command = `font-family: "${fontName}";`;
    
    try {
      window.SkUISpreadSheet.format(selection, command);
      
      this.spInterface.reloadView()
        .then(() => {
        })
        .catch(error => {
          console.error("Error in reloadView after font family change:", error);
        });
    } catch (error) {
      console.error("Error applying font family:", error);
    }
  }

  fontSize(event, fontName, fontSize) {
    this.spInterface.setExtraUndo();
    let selection = this.spInterface.selectstr();
    let command = `font-size: ${fontSize};`;
    
    try {
      window.SkUISpreadSheet.format(selection, command);
      
      this.spInterface.reloadView()
        .then(() => {
        })
        .catch(error => {
          console.error("Error in reloadView after font size change:", error);
        });
    } catch (error) {
      console.error("Error applying font size:", error);
    }
  }
  
  // Generic color method that can handle both text and background colors
  applyColor(color, colorType = 'text', { closePopup = true } = {}) {
    // Add color to recent colors (max 10 colors)
    this.setState(prevState => ({
      recentColors: [
        color, 
        ...prevState.recentColors.filter(c => c !== color)
      ].slice(0, 10)
    }));
    
    this.spInterface.setExtraUndo();
    let selection = this.spInterface.selectstr();
    // Whole-col/row header select must reach ApplyColRowFormat (e.g. H0:H1048576).
    if (!selection) {
      return;
    }
    let command = '';
    
    if (colorType === 'text') {
      command = `color: ${color};`;
      this.setState({
        textColor: color,
        ...(closePopup ? { menuPopUpTextColor: false } : {}),
      });
    } else if (colorType === 'background') {
      command = `background-color: ${color};`;
      this.setState({
        backgroundColor: color,
        ...(closePopup ? { menuPopUpBackgroundColor: false } : {}),
      });
    }
    
    try {
      window.SkUISpreadSheet.format(selection, command);
      
      this.spInterface.reloadView()
        .then(() => {
        })
        .catch(error => {
          console.error("Error in reloadView after color change:", error);
        });
    } catch (error) {
      console.error("Error applying color:", error);
    }
  }

  // Text color method (now calls the generic method)
  textColor(color, options = {}) {
    this.applyColor(color, 'text', options);
  }

  // Background color method
  backgroundColor(color, options = {}) {
    this.applyColor(color, 'background', options);
  }
  
  async cellMerge() {
    this.spInterface.setExtraUndo();
    let selection = await this.spInterface.select().strMerged(this.spInterface);
    // Must await: in call (collaborative) mode merge returns a Promise that
    // resolves only after the server roundtrip. Reloading before resolution
    // fetches stale JsonView and can miss merged outer borders on the anchor.
    window.SkUISpreadSheet.merge(selection);
    this.spInterface.reloadView()
      .catch(error => {
        console.error("Error in reloadView:", error);
      });
  }

  insertImage() {
    openImageFilePicker(this.spInterface);
  }

  insertRow() {
    this.spInterface.insertRow()
      .then(() => {
        this.spInterface.reloadView();
      })
      .catch(error => {
        console.error("Error in insertRow:", error);
      });
  }

  deleteRow() {
    this.spInterface.deleteRow()
      .then(() => {
        this.spInterface.reloadView();
      })
      .catch(error => {
        console.error("Error in deleteRow:", error);
      });
  }

  insertCol() {
    this.spInterface.insertCol()
      .then(() => {
        this.spInterface.reloadView();
      })
      .catch(error => {
        console.error("Error in insertCol:", error);
      });
  }

  deleteCol() {
    this.spInterface.deleteCol()
      .then(() => {
        this.spInterface.reloadView();
      })
      .catch(error => {
        console.error("Error in deleteCol:", error);
      });
  }


  border(event) {
    // Close other popups first
    this.setState({ 
      menuPopUpTextColor: false,
      menuPopUpBackgroundColor: false,
      menuPopUpMoney: false,
      menuPopUpFormatNumber: false,
      menuPopUpFormatAccounting: false,
      menuPopUpFormatDate: false,
      menuPopUpFormatScientific: false,
      menuPopUpFormatPercent: false,
      menuPopUpBorder: !this.state.menuPopUpBorder 
    });
  }

  closeMenuPopUpMoney() {
    this.setState({ menuPopUpMoney: false });
  }

  money(event) {
    // Close other popups first
    this.setState({ 
      menuPopUpTextColor: false,
      menuPopUpBackgroundColor: false,
      menuPopUpBorder: false,
      menuPopUpFormatNumber: false,
      menuPopUpFormatAccounting: false,
      menuPopUpFormatDate: false,
      menuPopUpFormatScientific: false,
      menuPopUpFormatPercent: false,
      menuPopUpMoney: true 
    });
    this.m_RefMenuMoney.current.SetPos(event);
  }
  
  closeMenuPopUpFormatNumber() {
    this.setState({ menuPopUpFormatNumber: false })
  }

  formatNumber(event) {
    // Close other popups first
    this.setState({ 
      menuPopUpTextColor: false,
      menuPopUpBackgroundColor: false,
      menuPopUpBorder: false,
      menuPopUpMoney: false,
      menuPopUpFormatAccounting: false,
      menuPopUpFormatDate: false,
      menuPopUpFormatScientific: false,
      menuPopUpFormatPercent: false,
      menuPopUpFormatNumber: true 
    });
    this.m_RefMenuFormatNumber.current.SetPos(event);
  }

  closeMenuPopUpFormatAccounting() {
    this.setState({ menuPopUpFormatAccounting: false })
  }

  formatAccounting(event) {
    this.setState({ menuPopUpFormatAccounting: true });
    this.m_RefMenuFormatAccounting.current.SetPos(event);
  }
 
  closeMenuPopUpFormatDate() {
    this.setState({ menuPopUpFormatDate: false })
  }

  formatDate(event) {
    this.setState({ menuPopUpFormatDate: true });
    this.m_RefMenuFormatDate.current.SetPos(event);
  }

  closeMenuPopUpFormatScientific() {
    this.setState({ menuPopUpFormatScientific: false })
  }

  formatScientific(event) {
    this.setState({ menuPopUpFormatScientific: true });
    this.m_RefMenuFormatScientific.current.SetPos(event);
  }

  closeMenuPopUpFormatPercent() {
    this.setState({ menuPopUpFormatPercent: false })
  }

  formatPercent(event) {
    this.setState({ menuPopUpFormatPercent: true });
    this.m_RefMenuFormatPercent.current.SetPos(event);
  }

  decimalPrecision(precision) {
    this.spInterface.setPrecision(precision);
  }

  openTextColorPicker(event) {
    // Close other popups first
    this.setState({ 
      menuPopUpBorder: false,
      menuPopUpMoney: false,
      menuPopUpFormatNumber: false,
      menuPopUpFormatAccounting: false,
      menuPopUpFormatDate: false,
      menuPopUpFormatScientific: false,
      menuPopUpFormatPercent: false,
      menuPopUpBackgroundColor: false,
      menuPopUpTextColor: true 
    });
  }

  closeTextColorPicker() {
    this.setState({ menuPopUpTextColor: false });
  }

  openBackgroundColorPicker(event) {
    // Close other popups first
    this.setState({ 
      menuPopUpBorder: false,
      menuPopUpMoney: false,
      menuPopUpFormatNumber: false,
      menuPopUpFormatAccounting: false,
      menuPopUpFormatDate: false,
      menuPopUpFormatScientific: false,
      menuPopUpFormatPercent: false,
      menuPopUpTextColor: false,
      menuPopUpBackgroundColor: true 
    });
  }

  closeBackgroundColorPicker() {
    this.setState({ menuPopUpBackgroundColor: false });
  }

  async conditionalFormat(format) {
    if (!format || !format.type) return;

    try {
      await applyConditionalFormatFromUi(this.spInterface, format);
    } catch (error) {
      console.error("Error applying conditional format:", error);
    }
  }

  switchTreeView(event) {
    const wOn = this.spInterface.m_TreeViewLeft === 0;
    this.spInterface.setTreeViewEnabled(wOn);
    this.spInterface.m_SkSpLeftPanel?.invalidate?.();
    this.spInterface.m_SkSpTopPanel?.invalidate?.();
    this.spInterface.reloadView();
  }

  treeIndent() {
    this.spInterface.changeTree(true, { forceIsRow: true })
      .catch(error => {
        console.error("Error in treeIndent:", error);
      });
  }

  treeOutdent() {
    this.spInterface.changeTree(false, { forceIsRow: true })
      .catch(error => {
        console.error("Error in treeOutdent:", error);
      });
  }

  treeIndentCol() {
    this.spInterface.changeTree(true, { forceIsRow: false })
      .catch(error => {
        console.error("Error in treeIndentCol:", error);
      });
  }

  treeOutdentCol() {
    this.spInterface.changeTree(false, { forceIsRow: false })
      .catch(error => {
        console.error("Error in treeOutdentCol:", error);
      });
  }

  render() {
    return (
      <div ref={this.m_Ref} className="SkSpTopCommand">
        <SkToolbarHint />
        {/* Undo/Redo Group */}
        <div className="SkSpTopTool">
          <div title="Redo last action" onClick={this.redo}><SvgRedo className="SkSvg"/></div>
          <div title="Undo last action" onClick={this.undo}><SvgUndo className="SkSvg"/></div>
        </div>
        
        <div className="SkSeparator_Svg"/>
        
        {/* Font Formatting Group */}
        <div className="SkSpTopTool">
          <div title="Bold text" className={this.state.isBold ? "active" : ""} onClick={this.fontBold}><SvgBold className="SkSvg"/></div>
          <div title="Italic text" className={this.state.isItalic ? "active" : ""} onClick={this.fontItalic}><SvgItalic className="SkSvg"/></div>
          <div title="Underline text" className={this.state.isUnderline ? "active" : ""} onClick={this.fontUnderLine}><SvgUnderline className="SkSvg"/></div>
          <div title="Strikethrough text" className={this.state.isStrike ? "active" : ""} onClick={this.fontStrikethrough}><SvgStrikethrough className="SkSvg"/></div>
        </div>
        
        <div className="SkSeparator_Svg"/>
        
        {/* Text Alignment Group — horizontal align codes: 2=left, 3=right, 4=center. */}
        <div className="SkSpTopTool">
          <div title="Align text left" className={this.state.hAlign === 2 ? "active" : ""} onClick={this.textLeft}><SvgAlignLeft className="SkSvg"/></div>
          <div title="Align text right" className={this.state.hAlign === 3 ? "active" : ""} onClick={this.textRight}><SvgAlignRight className="SkSvg"/></div>
          <div title="Align text center" className={this.state.hAlign === 4 ? "active" : ""} onClick={this.textCenter}><SvgAlignCenter className="SkSvg"/></div>
          <div title="Wrap text" className={this.state.isWrap ? "active" : ""} onClick={this.textWrap}><SvgTextWrap className="SkSvg"/></div>
        </div>
        
        <div className="SkSeparator_Svg"/>
        
        {/* Vertical Alignment Group — vertical align codes: 5/8=top, 6/9=bottom, 7=middle. */}
        <div className="SkSpTopTool">
          <div title="Align text to top" className={(this.state.vAlign === 5 || this.state.vAlign === 8) ? "active" : ""} onClick={this.textTop}><SvgVerticalAlignTop className="SkSvg"/></div>
          <div title="Align text to bottom" className={(this.state.vAlign === 6 || this.state.vAlign === 9) ? "active" : ""} onClick={this.textBottom}><SvgVerticalAlignBottom className="SkSvg"/></div>
          <div title="Align text vertically center" className={this.state.vAlign === 7 ? "active" : ""} onClick={this.textVCenter}><SvgVerticalAlignCenter className="SkSvg"/></div>
        </div>
        
        <div className="SkSeparator_Svg"/>
        {/* Cell Operations Group */}
          <div className="SkSpTopTool">
          <div title="Merge cells" onClick={this.cellMerge}><SvgCelllMerge className="SkSvg"/></div>
        </div>
        
        <div className="SkSeparator_Svg"/>
        
        {/* Font Selection Group */}
        <div className="SkSpTopTool">
          <SkFontSelector ref={this.fontSelectorRef} SelectFont={this.fontFamily} SelectFontSize={this.fontSize}/>
        </div>
        
        <div className="SkSeparator_Svg"/>
        
        {/* Color Tools Group */}
        <div className="SkSpTopTool">
          {/* Text Color */}
          <div style={{ position: 'relative' }} title="Text color">
            <div className="SkTextColorButton" onClick={this.openTextColorPicker}>
              <span className="SkTextColorLetter" style={{ color: this.state.textColor || 'var(--sk-color-tool)' }}>A</span>
            </div>
            {this.state.menuPopUpTextColor && (
              <div className="SkSpTopCommand-popup">
                <SkColor 
                  defaultColor={this.state.textColor || '#000000'} 
                  onColorChange={this.textColor}
                  size="medium"
                  title="Text Color"
                  inline={true}
                  recentColors={this.state.recentColors}
                />
              </div>
            )}
          </div>
          
          {/* Background Color */}
          <div style={{ position: 'relative' }} title="Background color">
            <div className="SkBackgroundColorButton" onClick={this.openBackgroundColorPicker}>
              <span className="SkBackgroundColorFill">
                <SvgFormatColorFillBucket className="SkBackgroundColorFill-bucket" aria-hidden="true" />
                <span
                  className="SkBackgroundColorFill-bar"
                  style={{ backgroundColor: this.state.backgroundColor || '#ffffff' }}
                />
              </span>
            </div>
            {this.state.menuPopUpBackgroundColor && (
              <div className="SkSpTopCommand-popup">
                <SkColor 
                  defaultColor={this.state.backgroundColor || '#ffffff'} 
                  onColorChange={this.backgroundColor}
                  size="medium"
                  title="Background Color"
                  inline={true}
                  recentColors={this.state.recentColors}
                />
              </div>
            )}
          </div>
          
          {/* Border — same pattern as Undo/Bold: plain SkSvg, no bordered wrapper */}
          <div style={{ position: 'relative' }} title="Cell borders">
            <div data-sk-toolbar-border-popup onClick={this.border}>
              <SvgBorderAll className="SkSvg"/>
            </div>
            {this.state.menuPopUpBorder && (
              <div className="SkSpTopCommand-popup SkSpTopCommand-popup--border">
                <SkBorder SpInterface={this.spInterface}
                          onApply={() => this.setState({ menuPopUpBorder: false })}/>
              </div>
            )}
          </div>
          
          {/* Conditional Formatting */}
          <div title="Conditional formatting">
            <SkConditionalFormat 
              SpInterface={this.spInterface}
              onFormatChange={this.conditionalFormat}
            />
          </div>

          <div title="Insert image (Ctrl+Shift+I)" onClick={this.insertImage}>
            <ImageToolbarIcon />
          </div>
        </div>
        
        <div className="SkSeparator_Svg"/>
        
        {/* Formatting Tools Group */}
        <div className="SkSpTopTool">
          
          <div onClick={this.formatNumber} title="Number format">
            <SvgNumeric className="SkSvg"/>
            <SkMenuPopUp ref={this.m_RefMenuFormatNumber}
                         onClose={this.closeMenuPopUpFormatNumber}
                         Visible={this.state.menuPopUpFormatNumber}>
              <SkSpNumberFormatMenu SpInterface={this.spInterface}/>
            </SkMenuPopUp>
          </div>
          
          <div onClick={this.formatAccounting} title="Accounting format">
            <SvgAccounting className="SkSvg"/>
            <SkMenuPopUp ref={this.m_RefMenuFormatAccounting}
                         onClose={this.closeMenuPopUpFormatAccounting}
                         Visible={this.state.menuPopUpFormatAccounting}>
              <div className="SkMenuHeader">Accounting</div>
              <SkSpFormatString Family="Accounting" SpInterface={this.spInterface}/>
            </SkMenuPopUp>
          </div>
          
          <div onClick={this.money} title="Currency format">
            <SvgDollard className="SkSvg"/>
            <SkMenuPopUp ref={this.m_RefMenuMoney}
                         onClose={this.closeMenuPopUpMoney}
                         Visible={this.state.menuPopUpMoney}>
              <SkSpUnit SpInterface={this.spInterface}/>
            </SkMenuPopUp>
          </div>
          
          <div onClick={this.formatDate} title="Date format">
            <SvgCalendar className="SkSvg"/>
            <SkMenuPopUp ref={this.m_RefMenuFormatDate}
                         onClose={this.closeMenuPopUpFormatDate}
                         Visible={this.state.menuPopUpFormatDate}>
              <div className="SkMenuHeader">Date</div>
              <SkSpFormatString Family="Date" SpInterface={this.spInterface}/>
            </SkMenuPopUp>
          </div>
          
          <div onClick={this.formatScientific} title="Scientific format">
            <SvgScientific className="SkSvg"/>
            <SkMenuPopUp ref={this.m_RefMenuFormatScientific}
                         onClose={this.closeMenuPopUpFormatScientific}
                         Visible={this.state.menuPopUpFormatScientific}>
              <div className="SkMenuHeader">Scientific</div>
              <SkSpFormatString Family="Scientific" SpInterface={this.spInterface}/>
            </SkMenuPopUp>
          </div>
          
          <div onClick={this.formatPercent} title="Percent format">
            <SvgPercent className="SkSvg"/>
            <SkMenuPopUp ref={this.m_RefMenuFormatPercent}
                         onClose={this.closeMenuPopUpFormatPercent}
                         Visible={this.state.menuPopUpFormatPercent}>
              <div className="SkMenuHeader">Percent</div>
              <SkSpFormatString Family="Percent" SpInterface={this.spInterface}/>
            </SkMenuPopUp>
          </div>
        </div>
        
        <div className="SkSeparator_Svg"/>

        {/* Decimal Increase/Decrease Group */}
        <div className="SkSpTopTool">
          <div title="Increase decimal places" onClick={() => this.decimalPrecision(true)}><SvgDecimalIncrease className="SkSvg"/></div>
          <div title="Decrease decimal places" onClick={() => this.decimalPrecision(false)}><SvgDecimalDecrease className="SkSvg"/></div>
        </div>
        
        <div className="SkSeparator_Svg"/>
        
        {/* Row Operations Group */}
        <div className="SkSpTopTool">
          <div title="Insert row" onClick={this.insertRow}><SvgLineInsert className="SkSvg"/></div>
          <div title="Delete row" onClick={this.deleteRow}><SvgLineDelete className="SkSvg"/></div>
        </div>
        
        <div className="SkSeparator_Svg"/>
        
        {/* Column Operations Group */}
        <div className="SkSpTopTool">
          <div title="Insert column" onClick={this.insertCol}><SvgColumnInsert className="SkSvg"/></div>
          <div title="Delete column" onClick={this.deleteCol}><SvgColumnDelete className="SkSvg"/></div>
        </div>
        
        <div className="SkSeparator_Svg"/>
        
        {/* Tree outline Group — rows then columns */}
        <div className="SkSpTopTool">
          <div title="Group / indent rows" onClick={this.treeIndent}><SvgIndent className="SkSvg"/></div>
          <div title="Ungroup / outdent rows" onClick={this.treeOutdent}><SvgDeindent className="SkSvg"/></div>
          <div title="Group / indent columns" onClick={this.treeIndentCol}><SvgIndentCol className="SkSvg"/></div>
          <div title="Ungroup / outdent columns" onClick={this.treeOutdentCol}><SvgDeindentCol className="SkSvg"/></div>
          <div title="Toggle tree view" onClick={this.switchTreeView}><SkPopUpCde className="SkSvg"/></div>
        </div>

        {/* Desktop (Electron) has no top bar, so the light/dark theme toggle
            lives here in the command toolbar instead. */}
        {isDesktop && (
          <>
            <div className="SkSeparator_Svg"/>
            <div className="SkSpTopTool">
              <SkThemeFlipToggle className="SkThemeFlipToggle--compact" />
            </div>
          </>
        )}
      </div>
    );
  }
}
// ========================================

export default SkSpTopCommand;