//=============================================================================
// SkSpInplaceEdit
// SpreadSheet Editor  
//=============================================================================
import React from "react";
import { createPortal } from "react-dom";
import './SkSpreadSheet.css'
import  SkComponent from "../component/SkComponent";
import { buildCanvasFontFamily } from "../utility/SkUtility.js";
import {
  jsonViewCellDisplayText,
  isUnusableInplaceWasmText,
} from "../utility/jsonViewCellText.js";
import { contrastInplaceEditColors } from "../utility/skCssColorContrast.js";
import SkCellClass from "./CellClass/SkCellClass.js";
import {
  loadFormulaFunctionCatalog,
  getFormulaFunctionCatalogSync,
  catalogWithUserFunctions,
  findFunctionSuggestToken,
  filterFunctionsByPrefix,
} from "./SkSpFormulaFunctionSuggest.js";

const INPLACE_STATIC_MIN_WIDTH_PX = 100;
const INPLACE_CELL_LINE_HEIGHT_RATIO = 1.25;

function cellTextWrapEnabled(cell) {
  return cell && cell.hasOwnProperty("f_tw") && Number(cell.f_tw) === 2;
}

/** Collapse width briefly so scrollWidth reflects full single-line content. */
function measureEditContentWidth(el) {
  if (!el) {
    return 0;
  }
  const wStyle = window.getComputedStyle(el);
  const wPad =
    (parseFloat(wStyle.paddingLeft) || 0) +
    (parseFloat(wStyle.paddingRight) || 0);
  const wSaved = {
    width: el.style.width,
    minWidth: el.style.minWidth,
    maxWidth: el.style.maxWidth,
    whiteSpace: el.style.whiteSpace,
  };
  el.style.whiteSpace = "pre";
  el.style.width = "1px";
  el.style.minWidth = "0";
  el.style.maxWidth = "none";
  const wContent = el.scrollWidth + wPad + 4;
  el.style.width = wSaved.width;
  el.style.minWidth = wSaved.minWidth;
  el.style.maxWidth = wSaved.maxWidth;
  el.style.whiteSpace = wSaved.whiteSpace;
  return wContent;
}

class SkSpInplaceEdit extends SkComponent {
  constructor(props) {
    super(props);
    this.state = ({ 
      Focus :false,
      Disabled : false,
      // Excel-like function name typeahead (formula bar / cell edit).
      functionSuggest: null,
      functionSuggestIndex: 0,
      functionSuggestRect: null,
    })
    this.m_FunctionSuggestToken = null;
    this.m_FunctionSuggestBlurTimer = null;
    // Before state
    this.m_Disabled=false;
    this.m_SpInterface=props.SpInterface;
    this.m_Id=props.Id;
    this.m_Ref=React.createRef();
    this.m_Property=null;
    if (props.Property !== undefined) {
      this.m_Property=props.Property;
    }
    this.m_Shift=false; 
    this.m_Cell=null;
    this.m_Static=(props.static==="true");
    // When true, grid selections (mouse drag or Shift+Arrows) are
    // propagated into this inplace edit even if the text does not
    // start with a formula '=', as long as the field is empty or
    // its whole content is currently selected. Useful for fields
    // that hold a raw cell/range reference (attributes, named ranges).
    this.m_AcceptSelection=(props.AcceptSelection==="true");
    // Attribute panel: grid range pick only when the value is a formula (=...).
    this.m_FormulaOnlyRangePick=(props.FormulaOnlyRangePick==="true");
    // Locked until explicit activation — same UX as the formula bar (toolbar).
    this.m_ToolbarLike=(props.ToolbarLike==="true");
    this.m_PropertyKind =
      props.PropertyKind != null ? String(props.PropertyKind) : "";
    this.m_FormulaPickCaretStart = null;
    this.m_FormulaPickCaretEnd = null;
    if (props.hasOwnProperty("Text")) {
      this.m_Text=props.Text;
    }
    if (!this.m_Static) {
      this.m_SpInterface.m_SkSpInplaceEdit=this; // for Mouse  Event
    } else {
      if (this.m_Property===null) {
        this.m_SpInterface.m_SkSpInplaceEditStatic=this; // for Mouse  Event
      }
    }
  }
  
  async componentDidMount() {
    //console.log( "SkInplaceEdit::componentDidMount()")
    // Bug adds multiple listeners.
    // Just add it once and it works.
    
    // Store bound event handlers to properly remove them later
    this.boundKeyDown = this.keyDown.bind(this);
    this.boundKeyUp = this.keyUp.bind(this);
    this.boundMouseDown = this.mouseDown.bind(this);
    this.boundMouseMove = this.mouseMove.bind(this);
    this.boundMouseUp = this.mouseUp.bind(this);
    this.boundFocus = this.focus.bind(this);
    this.boundBlur = this.blur.bind(this);
    this.boundContextMenu = this.contextMenu.bind(this);
    this.boundInput = this.input.bind(this);
    this.m_Ref.current.addEventListener('keydown', this.boundKeyDown);
    this.m_Ref.current.addEventListener('keyup', this.boundKeyUp);
    this.m_Ref.current.addEventListener('input', this.boundInput);
    this.m_Ref.current.addEventListener('mousedown', this.boundMouseDown);
    this.m_Ref.current.addEventListener('mousemove', this.boundMouseMove);
    this.m_Ref.current.addEventListener('mouseup', this.boundMouseUp);

    this.m_Ref.current.addEventListener('focus', this.boundFocus);
    this.m_Ref.current.addEventListener('blur', this.boundBlur);

    this.m_Ref.current.addEventListener('contextmenu', this.boundContextMenu);
    if (this.canOfferFunctionSuggest()) {
      loadFormulaFunctionCatalog()
        .then(() => {
          if (!this.m_Unmount) {
            this.refreshFunctionSuggest();
          }
        })
        .catch(() => {});
    }
    if (!this.m_Static) {
      this.m_SpInterface.m_SkSpInplaceEdit=this; // for Mouse  Event
      if (this.m_Cell === null) {
        const wCursor = this.m_SpInterface.cursor();
        this.m_Cell = await this.m_SpInterface.ensureCell(
          wCursor.row(),
          wCursor.col()
        );
      }
      const wRect = await this.m_SpInterface.getRectPixelCursor();

      {
        const wTreeLeft = this.m_SpInterface.gridTreeViewLeft?.() ?? 0;
        const wTreeTop = this.m_SpInterface.gridTreeViewTop?.() ?? 0;
        wRect.Left = wRect.Left + wTreeLeft;
        wRect.Top = wRect.Top + wTreeTop;
        wRect.Right = wRect.Right + wTreeLeft;
        wRect.Bottom = wRect.Bottom + wTreeTop;
      }

      this.m_Left = wRect.Left;
      this.m_Top = wRect.Top;
      this.m_Width = wRect.Width;
      this.m_Height = wRect.Height;

      if (this.m_Property === null) {
        await this.setTextByCursorCell();
      }

      this.setState({ editLayoutReady: true }, () => {
        this.focusCellEditAfterMount();
      });
    } else {
      // Property-level panel edits: enabled for range pickers; toolbar-like
      // fields stay locked until the host calls setDisabled(false).
      if (
        !(
          this.m_Property !== null &&
          (this.m_AcceptSelection ||
            this.m_FormulaOnlyRangePick ||
            this.m_ToolbarLike)
        )
      ) {
        this.setDisabled(true);
      }
      if (this.m_ToolbarLike && this.m_Property !== null) {
        this.setDisabled(true);
      }
      this.scheduleFitStaticEditWidth();
    }   
  }

  /** Semantic kind from attribute schema (e.g. range, enum:…). */
  resolveAttributePropertyKind() {
    const wProp = this.property();
    if (!this.isToolbarLikePropertyStatic() || wProp == null) {
      return "";
    }
    const wAttr = this.m_SpInterface?.m_SkSpClassAttribute;
    const wRow = wAttr?.state?.properties?.find((wItem) => wItem.n === wProp);
    if (wRow?.k != null) {
      return String(wRow.k);
    }
    return this.m_PropertyKind;
  }

  /** Attribute panel field bound to a class range property (A1 / A1:A10 pick). */
  isAttributeRangePropertyStatic() {
    return (
      this.isToolbarLikePropertyStatic() &&
      SkCellClass.isRangePropertyKind(this.resolveAttributePropertyKind())
    );
  }

  /** True when this field should route grid picks (formula mode). */
  isRangePickActive(sText) {
    if (this.m_AcceptSelection && !this.m_FormulaOnlyRangePick) {
      if (this.isToolbarLikePropertyStatic()) {
        if (this.isAttributeRangePropertyStatic()) {
          if (
            this.m_SpInterface == null ||
            typeof this.m_SpInterface.getUseEdit !== "function" ||
            !this.m_SpInterface.getUseEdit()
          ) {
            return false;
          }
          const wEl = this.m_Ref?.current;
          const wActiveEl =
            typeof document !== "undefined" ? document.activeElement : null;
          if (wEl != null && wActiveEl === wEl) {
            return true;
          }
          if (this.m_SpInterface.m_MouseDown) {
            return true;
          }
          return false;
        }
        const wText = sText != null ? String(sText) : this.text();
        if (!wText.trimStart().startsWith("=")) {
          return false;
        }
        return this.isFormulaPointMode();
      }
      return true;
    }
    if (this.m_FormulaOnlyRangePick) {
      const wText = sText != null ? String(sText) : this.text();
      return wText.trimStart().startsWith("=");
    }
    return false;
  }

  // Enter or leave property range-pick session when formula-only mode toggles.
  syncFormulaOnlyRangePick() {
    if (!this.m_FormulaOnlyRangePick || !this.m_Static || this.m_Property === null) {
      return;
    }
    if (!this.m_SpInterface) {
      return;
    }
    const wActive = this.isRangePickActive();
    const wPushed = this.m_SpInterface.m_SkSpInplaceEditProperty === this;
    if (wActive && !wPushed) {
      this.autoPushPropertyEdit();
    } else if (!wActive && wPushed) {
      void this.m_SpInterface.endEdit();
    }
  }

  /** Attribute panel: begin edit session when the field becomes a formula pick. */
  syncToolbarLikeAttributeFormulaPick() {
    if (!this.isToolbarLikePropertyStatic() || !this.m_SpInterface) {
      return;
    }
    const wAttr = this.m_SpInterface.m_SkSpClassAttribute;
    if (wAttr == null) {
      return;
    }
    if (this.isAttributeRangePropertyStatic()) {
      if (
        this.m_SpInterface.m_SkSpInplaceEditProperty === this &&
        this.m_SpInterface.getUseEdit()
      ) {
        if (typeof wAttr.ensureClassAnchorCell === "function") {
          wAttr.ensureClassAnchorCell();
        }
        if (typeof this.m_SpInterface.syncAttributeEditAnchorCursor === "function") {
          this.m_SpInterface.syncAttributeEditAnchorCursor();
        }
        return;
      }
      const wProp = this.property();
      if (wProp) {
        void wAttr.activatePropertyEdit(wProp);
      }
      return;
    }
    const wText = this.text();
    if (!wText.trimStart().startsWith("=")) {
      return;
    }
    if (
      this.m_SpInterface.m_SkSpInplaceEditProperty === this &&
      this.m_SpInterface.getUseEdit()
    ) {
      if (typeof wAttr.ensureClassAnchorCell === "function") {
        wAttr.ensureClassAnchorCell();
      }
      if (typeof this.m_SpInterface.syncAttributeEditAnchorCursor === "function") {
        this.m_SpInterface.syncAttributeEditAnchorCursor();
      }
      return;
    }
    const wProp = this.property();
    if (wProp) {
      void wAttr.activatePropertyEdit(wProp);
    }
  }

  // When this is a property-level static edit with AcceptSelection,
  // auto-push ourselves as the active property edit so that keyboard
  // and mouse selections in the grid are routed to this input.
  autoPushPropertyEdit() {
    if (!this.m_Static) return false;
    if (this.m_Property === null) return false;
    if (!this.m_AcceptSelection && !this.m_FormulaOnlyRangePick) return false;
    if (this.m_FormulaOnlyRangePick && !this.isRangePickActive()) return false;
    if (!this.m_SpInterface) return false;

    const wAlready = this.m_SpInterface.m_SkSpInplaceEditProperty === this;
    if (!wAlready) {
      this.m_SpInterface.pushInplaceEdit(this);
      this.m_SpInterface.beginEdit();
      // Notify the host component (e.g. SkSpRangeNamed) that an edit
      // just started so it can update its UI state (enable Apply, ...).
      if (typeof this.props.onEditStart === "function") {
        try {
          this.props.onEditStart(this);
        } catch (e) {
          console.error("SkSpInplaceEdit::onEditStart callback error", e);
        }
      }
      return true;
    }
    return false;
  }

  /**
   * Clean up all resources when component unmounts to prevent memory leaks
   * - Removes all event listeners (keyboard, mouse, focus, blur, context menu)
   * - Cleans up circular references
   */
  componentWillUnmount(prevProps) {
    console.log( "SkInplaceEdit::componentWillUnmount()")
    this.m_Unmount = true;
    if (this.m_FunctionSuggestBlurTimer != null) {
      clearTimeout(this.m_FunctionSuggestBlurTimer);
      this.m_FunctionSuggestBlurTimer = null;
    }
    
    // Clean up all event listeners using stored bound references
    if (this.m_Ref.current) {
      this.m_Ref.current.removeEventListener('keydown', this.boundKeyDown);
      this.m_Ref.current.removeEventListener('keyup', this.boundKeyUp);
      this.m_Ref.current.removeEventListener('input', this.boundInput);
      this.m_Ref.current.removeEventListener('mousedown', this.boundMouseDown);
      this.m_Ref.current.removeEventListener('mousemove', this.boundMouseMove);
      this.m_Ref.current.removeEventListener('mouseup', this.boundMouseUp);
      this.m_Ref.current.removeEventListener('focus', this.boundFocus);
      this.m_Ref.current.removeEventListener('blur', this.boundBlur);
      this.m_Ref.current.removeEventListener('contextmenu', this.boundContextMenu);
    }

    // Release property range-pick session when this field unmounts (e.g. CF panel closed).
    if (
      this.m_SpInterface &&
      this.m_SpInterface.m_SkSpInplaceEditProperty === this
    ) {
      void this.m_SpInterface.endEdit();
    }

    // Clean up circular references
    if (!this.m_Static) {
      if (this.m_SpInterface && this.m_SpInterface.m_SkSpInplaceEdit === this) {
        this.m_SpInterface.m_SkSpInplaceEdit = null; // for Event    
      }
    } else {
      if (this.m_Property === null) {
        if (this.m_SpInterface && this.m_SpInterface.m_SkSpInplaceEditStatic === this) {
          this.m_SpInterface.m_SkSpInplaceEditStatic = null;
        }
      }
    }
    
    // Clean up other references
    this.m_SpInterface = null;
  }
  
  property() { return(this.m_Property); }

  returnMirrorEdit() {
    if (this.m_Static) {
      if (this.isToolbarLikePropertyStatic()) {
        return null;
      }
      return(this.m_SpInterface.m_SkSpInplaceEdit);
    } else {
      if (this.m_SpInterface.m_SkSpInplaceEditProperty===null) {
        return(this.m_SpInterface.m_SkSpInplaceEditStatic);
      } else {
        return(this.m_SpInterface.m_SkSpInplaceEditProperty);  
      }
    }
  }

  type() {
    if (this.m_Static) {
      return("Static ");
    } else {
      return("Dynamic");
    }
  }

  setDisabled(sDisabled) {  
    this.m_Disabled=sDisabled;
    this.setState( { Disabled : sDisabled }) 
  }
  
  Disabled() { return(this.m_Disabled); }

  focusCellEditAfterMount() {
    const el = this.m_Ref.current;
    if (!el) {
      return;
    }
    el.focus();
    this.selectAll();
    this.scheduleFitCellEditToContent();
    const wChar = this.m_SpInterface.lastChar();
    if (wChar !== "") {
      this.setText(wChar);
      el.value = wChar;
      this.m_SpInterface.setLastChar("");
      const wLen = wChar.length;
      el.setSelectionRange(wLen, wLen);
    }
    this.refreshFunctionSuggest();
  }
  
  async setTextByCursorCell() {
    const sp = this.m_SpInterface;
    if (
      sp.m_CursorEdit != null &&
      typeof sp.getEditAnchorCell === "function"
    ) {
      this.m_Cell = sp.getEditAnchorCell();
    } else {
      this.m_Cell = sp.GetCellcursor();
    }
    this.setText(""); 
    if (this.m_Cell!=null) {
      // if not static (InplaceEdit Dynamic) , get text from property
      if (!this.m_Static) {
        if (this.m_SpInterface.m_SkSpInplaceEditProperty!==null) {
          this.setText(this.m_SpInterface.m_SkSpInplaceEditProperty.text());
          return;
        }
      }
      // Else get text from cell: prefer JsonView c_f when present; Wasm omits c_f — use GetFormula then GetInputValue.
      const cursorStr = this.m_SpInterface.m_Select.cursorStr();
      if (this.m_Cell.hasOwnProperty("c_f")) {
        this.setText("="+this.m_Cell.c_f);
      } else {
        try {
          const fx = window.SkUISpreadSheet.getFormula(cursorStr, "", true);
          const fxs = fx != null ? String(fx).trim() : "";
          if (fxs.length > 0) {
            this.setText("="+fxs);
            return;
          }
        } catch (error) {
          console.error("Error getting formula:", error);
        }
        if (this.m_Cell.hasOwnProperty("c_v")) {
          // React class cells: GetInputValue = CalculableValue scalar (true/false/date), not c_v.c.n instance name.
          if (this.m_Cell.c_t === "c" && this.m_Cell.c_v && this.m_Cell.c_v.co) {
            const wCalc = SkCellClass.readCalculableFromCellJson(this.m_Cell);
            if (wCalc) {
              this.setText(wCalc);
              return;
            }
          }
          try {
            const wValue = window.SkUISpreadSheet.getInputvalue(cursorStr);
            const wText = isUnusableInplaceWasmText(wValue)
              ? jsonViewCellDisplayText(this.m_Cell)
              : String(wValue);
            this.setText(wText);
          } catch (error) {
            console.error("Error getting input value:", error);
            this.setText(jsonViewCellDisplayText(this.m_Cell));
          }
        }
      }
    }
  }

  setText(sText) {
    if (this.m_Ref.current!==null) {
      this.m_Ref.current.value=sText;
    } else {
      //console.error( "this.m_Ref.current!==null)");
    }
    this.m_Text=sText;
    if (this.m_Static) {
      this.scheduleFitStaticEditWidth();
      if (this.isFormulaBarStatic()) {
        requestAnimationFrame(() => {
          this.scrollCellEditCaretIntoView(this.m_Ref.current);
        });
      }
    } else {
      this.scheduleFitCellEditToContent();
    }
    this.fireTextChange(sText);
  }

  scheduleFitCellEditToContent() {
    if (this.m_Static) {
      return;
    }
    requestAnimationFrame(() => {
      this.fitCellEditToContent();
    });
  }

  fitCellEditToContent() {
    const el = this.m_Ref && this.m_Ref.current;
    if (!el || this.m_Static) {
      return;
    }

    const wStyle = window.getComputedStyle(el);
    const wPadTop = parseFloat(wStyle.paddingTop) || 0;
    const wPadBottom = parseFloat(wStyle.paddingBottom) || 0;
    let wLineHeight = parseFloat(wStyle.lineHeight);
    if (!Number.isFinite(wLineHeight) || wLineHeight <= 0) {
      const wFontSize = parseFloat(wStyle.fontSize) || 16;
      wLineHeight = wFontSize * INPLACE_CELL_LINE_HEIGHT_RATIO;
    }

    const wMinW = this.m_Width || 0;
    const wMaxW = this.getCellEditMaxWidthPx();
    const wMinH = this.m_Height || 0;
    const wrapOn = cellTextWrapEnabled(this.m_Cell);

    if (wrapOn) {
      el.style.whiteSpace = "pre-wrap";
      el.style.wordBreak = "break-word";
      el.style.minWidth = `${wMinW}px`;
      el.style.maxWidth = `${wMinW}px`;
      el.style.width = `${wMinW}px`;
      el.style.overflowX = "hidden";
      el.style.height = "auto";
      el.style.height = `${Math.max(wMinH, el.scrollHeight)}px`;
    } else {
      const wContentW = measureEditContentWidth(el);
      let wNextW = Math.max(wMinW, wContentW);
      if (wMaxW != null && Number.isFinite(wMaxW)) {
        wNextW = Math.min(wNextW, wMaxW);
      }

      el.style.whiteSpace = "pre";
      el.style.wordBreak = "";
      el.style.minWidth = `${wMinW}px`;
      el.style.maxWidth = wMaxW != null ? `${wMaxW}px` : "none";
      el.style.width = `${wNextW}px`;
      el.style.overflowX = "hidden";

      const wLineCount = Math.max(1, String(el.value || "").split(/\r?\n/).length);
      el.style.height = `${Math.max(
        wMinH,
        wLineCount * wLineHeight + wPadTop + wPadBottom
      )}px`;
    }

    if (this.m_SpInterface) {
      // m_Left/m_Top are DOM coords over the grid canvas (grid tree insets included).
      // Canvas cursor paint runs after translate(treeLeft, treeTop) — store cell-space.
      const wTreeLeft = this.m_SpInterface.gridTreeViewLeft?.() ?? 0;
      const wTreeTop = this.m_SpInterface.gridTreeViewTop?.() ?? 0;
      this.m_SpInterface.setInplaceEditOverlayRect({
        Left: this.m_Left - wTreeLeft,
        Top: this.m_Top - wTreeTop,
        Width: el.offsetWidth,
        Height: el.offsetHeight,
      });
      this.m_SpInterface.invalidateOverlays();
    }
  }

  /** Right edge of the grid viewport (CSS px) minus edit left — caps overlay width. */
  getCellEditMaxWidthPx() {
    if (!this.m_SpInterface) {
      return null;
    }
    const wCanvasList = document.getElementsByClassName("SkSpGridCanvas");
    if (!wCanvasList || wCanvasList.length === 0) {
      return null;
    }
    const wVp = this.m_SpInterface.getGridInnerViewportCssPx(wCanvasList[0]);
    const wTreeLeft = this.m_SpInterface.gridTreeViewLeft?.() ?? 0;
    const wRightEdge = wTreeLeft + wVp.width;
    const wLeft = this.m_Left || 0;
    return Math.max(this.m_Width || 0, wRightEdge - wLeft);
  }

  isFormulaBarStatic() {
    return this.m_Static && this.m_Property === null;
  }

  /** Property field that mirrors toolbar formula bar lock / activate UX. */
  isToolbarLikePropertyStatic() {
    return this.m_Static && this.m_Property !== null && this.m_ToolbarLike;
  }

  /** Function panel / side-panel range pickers (Target, Arguments, …). */
  isPanelCompactStatic() {
    if (!this.m_Static || !this.m_AcceptSelection) {
      return false;
    }
    if ((this.props.className || "").includes("SkSpInplaceEditStatic--panel")) {
      return true;
    }
    const wProp = this.m_Property;
    return (
      wProp === "functionTarget" ||
      (typeof wProp === "string" && wProp.startsWith("functionArg_"))
    );
  }

  lockPanelCompactEditLayout(el) {
    if (!el) {
      return;
    }
    el.style.width = "100%";
    el.style.minWidth = "0";
    el.style.maxWidth = "none";
    el.style.flex = "1 1 auto";
    el.style.height = "26px";
    el.style.minHeight = "26px";
    el.style.maxHeight = "26px";
    el.style.overflowY = "hidden";
    el.style.resize = "none";
  }

  scheduleFitStaticEditWidth() {
    if (!this.m_Static) {
      return;
    }
    requestAnimationFrame(() => {
      this.fitStaticEditWidth();
    });
  }

  // Formula bar: fixed slot, internal scroll only (no canvas-style grow).
  lockFormulaBarEditLayout(el) {
    if (!el) {
      return;
    }
    el.style.width = "100%";
    el.style.minWidth = "0";
    el.style.maxWidth = "none";
    el.style.flex = "1 1 auto";
    el.style.height = "";
    el.style.minHeight = "";
    el.style.maxHeight = "";
  }

  // Widen dialog/property static edits when text is longer than the slot.
  fitStaticEditWidth() {
    const el = this.m_Ref && this.m_Ref.current;
    if (!el || !this.m_Static) {
      return;
    }

    if (this.isFormulaBarStatic()) {
      this.lockFormulaBarEditLayout(el);
      return;
    }

    if (this.isPanelCompactStatic()) {
      this.lockPanelCompactEditLayout(el);
      return;
    }

    const wWrap =
      el.closest(".SkSpControlPanel-formula") || el.parentElement;
    const wSlot = wWrap ? wWrap.clientWidth : 0;

    el.style.width = "auto";
    el.style.minWidth = "0";
    const wContent = Math.max(
      INPLACE_STATIC_MIN_WIDTH_PX,
      measureEditContentWidth(el)
    );

    if (wSlot > 0 && wContent > wSlot) {
      el.style.width = `${wContent}px`;
      el.style.minWidth = `${wContent}px`;
      el.style.flex = "0 0 auto";
    } else {
      el.style.width = "100%";
      el.style.minWidth = `${INPLACE_STATIC_MIN_WIDTH_PX}px`;
      el.style.flex = "1 1 auto";
    }
  }

  input(event) {
    this.m_Text = event.target.value;
    if (this.m_Static) {
      this.scheduleFitStaticEditWidth();
      if (this.isFormulaBarStatic()) {
        this.scrollCellEditCaretIntoView(event.target);
      }
      if (this.isToolbarLikePropertyStatic()) {
        this.captureFormulaPickCaret();
      }
      this.syncFormulaOnlyRangePick();
    } else {
      this.scheduleFitCellEditToContent();
      this.scrollCellEditCaretIntoView(event.target);
    }
    this.fireTextChange(this.m_Text);
    this.refreshFunctionSuggest();
  }

  scrollCellEditCaretIntoView(el) {
    if (!el) {
      return;
    }
    const wStyle = window.getComputedStyle(el);
    const wPadLeft = parseFloat(wStyle.paddingLeft) || 0;
    const wPadRight = parseFloat(wStyle.paddingRight) || 0;
    const wCanvas = document.createElement("canvas");
    const wCtx = wCanvas.getContext("2d");
    if (!wCtx) {
      return;
    }
    wCtx.font = wStyle.font;
    const wCaret = el.selectionStart ?? el.value.length;
    const wCaretX =
      wCtx.measureText(el.value.substring(0, wCaret)).width + wPadLeft;
    const wViewLeft = el.scrollLeft;
    const wViewRight = wViewLeft + el.clientWidth - wPadRight;
    if (wCaretX > wViewRight - 8) {
      el.scrollLeft = wCaretX - el.clientWidth + wPadRight + 8;
    } else if (wCaretX < wViewLeft + 8) {
      el.scrollLeft = Math.max(0, wCaretX - wPadLeft - 8);
    }
  }

  // Notify host about text changes (typing, grid picks, ...). Used by
  // parent components to keep reactive state in sync with this
  // uncontrolled input (e.g. SkSpRangeNamed button enablement).
  fireTextChange(sText) {
    if (typeof this.props.onTextChange === "function") {
      try {
        this.props.onTextChange(sText);
      } catch (e) {
        console.error("SkSpInplaceEdit::onTextChange callback error", e);
      }
    }
  }

  /** Formula bar or cell overlay — not property / fx-arg fields. */
  canOfferFunctionSuggest() {
    return this.m_Property == null;
  }

  isFunctionSuggestOpen() {
    return Array.isArray(this.state.functionSuggest) && this.state.functionSuggest.length > 0;
  }

  clearFunctionSuggest() {
    this.m_FunctionSuggestToken = null;
    if (
      this.state.functionSuggest != null ||
      this.state.functionSuggestRect != null
    ) {
      this.setState({
        functionSuggest: null,
        functionSuggestIndex: 0,
        functionSuggestRect: null,
      });
    }
  }

  /**
   * Position the suggest popup below the editor, or above when it would
   * overflow the viewport bottom (Excel-like flip).
   */
  measureFunctionSuggestRect(sItemCount = 0) {
    const el = this.m_Ref?.current;
    if (!el || typeof el.getBoundingClientRect !== "function") {
      return null;
    }
    const wRect = el.getBoundingClientRect();
    const wGap = 2;
    const wMaxH = 280;
    const wItemH = 40;
    const wWidth = Math.max(220, Math.min(360, wRect.width || 220));
    const wEstH = Math.min(
      wMaxH,
      Math.max(wItemH, (Number(sItemCount) || 1) * wItemH)
    );
    const wViewportH =
      typeof window !== "undefined" ? window.innerHeight : wEstH * 2;
    const wSpaceBelow = Math.max(0, wViewportH - wRect.bottom - wGap);
    const wSpaceAbove = Math.max(0, wRect.top - wGap);
    const wPlaceAbove = wSpaceBelow < wEstH && wSpaceAbove > wSpaceBelow;

    if (wPlaceAbove) {
      return {
        placement: "above",
        bottom: wViewportH - wRect.top + wGap,
        left: wRect.left,
        width: wWidth,
        maxHeight: Math.min(wMaxH, Math.max(80, wSpaceAbove)),
      };
    }
    return {
      placement: "below",
      top: wRect.bottom + wGap,
      left: wRect.left,
      width: wWidth,
      maxHeight: Math.min(wMaxH, Math.max(80, wSpaceBelow || wMaxH)),
    };
  }

  refreshFunctionSuggest() {
    if (!this.canOfferFunctionSuggest()) {
      this.clearFunctionSuggest();
      return;
    }
    const el = this.m_Ref?.current;
    if (!el) {
      this.clearFunctionSuggest();
      return;
    }
    const wText = el.value != null ? String(el.value) : "";
    const wCaret = el.selectionStart ?? wText.length;
    const wToken = findFunctionSuggestToken(wText, wCaret);
    if (!wToken) {
      this.clearFunctionSuggest();
      return;
    }
    const wCatalog = catalogWithUserFunctions(
      getFormulaFunctionCatalogSync(),
      this.m_SpInterface
    );
    const wMatches = filterFunctionsByPrefix(wCatalog, wToken.prefix);
    if (wMatches.length === 0) {
      this.clearFunctionSuggest();
      return;
    }
    this.m_FunctionSuggestToken = wToken;
    this.setState({
      functionSuggest: wMatches,
      functionSuggestIndex: 0,
      functionSuggestRect: this.measureFunctionSuggestRect(wMatches.length),
    });
  }

  acceptFunctionSuggest(sFunction) {
    const el = this.m_Ref?.current;
    const wToken = this.m_FunctionSuggestToken;
    const wFn = sFunction || this.state.functionSuggest?.[this.state.functionSuggestIndex];
    if (!el || !wToken || !wFn) {
      return;
    }
    const wText = el.value != null ? String(el.value) : "";
    const wInsert = `${wFn.name}(`;
    const wBefore = wText.substring(0, wToken.start);
    const wAfter = wText.substring(wToken.end);
    el.value = `${wBefore}${wInsert}${wAfter}`;
    const wCaret = wBefore.length + wInsert.length;
    el.focus();
    el.setSelectionRange(wCaret, wCaret);
    this.m_Text = el.value;
    this.m_Shift = false;
    this.m_FunctionSuggestToken = null;
    this.setState({
      functionSuggest: null,
      functionSuggestIndex: 0,
      functionSuggestRect: null,
    });

    if (this.m_Static) {
      this.scheduleFitStaticEditWidth();
      if (this.isFormulaBarStatic()) {
        this.scrollCellEditCaretIntoView(el);
      }
    } else {
      this.scheduleFitCellEditToContent();
      this.scrollCellEditCaretIntoView(el);
    }

    const wMirrorEdit = this.returnMirrorEdit();
    if (wMirrorEdit != null && wMirrorEdit !== this) {
      wMirrorEdit.setText(this.m_Text);
    }
    this.fireTextChange(this.m_Text);
    if (this.isToolbarLikePropertyStatic()) {
      this.captureFormulaPickCaret();
    }
  }

  moveFunctionSuggest(sDelta) {
    const wList = this.state.functionSuggest;
    if (!Array.isArray(wList) || wList.length === 0) {
      return;
    }
    const wLen = wList.length;
    let wIndex = Number(this.state.functionSuggestIndex) || 0;
    wIndex = (wIndex + sDelta + wLen) % wLen;
    this.setState({ functionSuggestIndex: wIndex }, () => {
      if (typeof document === "undefined") {
        return;
      }
      const wActive = document.querySelector(
        ".SkSpFormulaFuncSuggest-item.is-active"
      );
      if (wActive && typeof wActive.scrollIntoView === "function") {
        wActive.scrollIntoView({ block: "nearest" });
      }
    });
  }

  /** Handle keys while the function suggest popup is open. @returns {boolean} */
  handleFunctionSuggestKeyDown(event) {
    if (!this.isFunctionSuggestOpen()) {
      return false;
    }
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        event.stopPropagation();
        this.moveFunctionSuggest(1);
        return true;
      }
      case "ArrowUp": {
        event.preventDefault();
        event.stopPropagation();
        this.moveFunctionSuggest(-1);
        return true;
      }
      case "Tab": {
        event.preventDefault();
        event.stopPropagation();
        this.acceptFunctionSuggest();
        return true;
      }
      case "Enter": {
        if (this.isManualLineBreakShortcut(event)) {
          return false;
        }
        event.preventDefault();
        event.stopPropagation();
        this.acceptFunctionSuggest();
        return true;
      }
      case "Escape": {
        event.preventDefault();
        event.stopPropagation();
        this.clearFunctionSuggest();
        return true;
      }
      default:
        return false;
    }
  }

  renderFunctionSuggestPortal() {
    if (!this.isFunctionSuggestOpen() || !this.state.functionSuggestRect) {
      return null;
    }
    if (typeof document === "undefined" || !document.body) {
      return null;
    }
    const wRect = this.state.functionSuggestRect;
    const wIndex = this.state.functionSuggestIndex;
    const wItems = this.state.functionSuggest;
    const wStyle = {
      left: wRect.left,
      width: wRect.width,
      maxHeight: wRect.maxHeight,
    };
    if (wRect.placement === "above") {
      wStyle.bottom = wRect.bottom;
      wStyle.top = "auto";
    } else {
      wStyle.top = wRect.top;
      wStyle.bottom = "auto";
    }
    return createPortal(
      <div
        className={[
          "SkSpFormulaFuncSuggest",
          wRect.placement === "above" ? "is-above" : "is-below",
        ].join(" ")}
        style={wStyle}
        onMouseDown={(e) => {
          // Keep textarea focus so blur does not dismiss before click.
          e.preventDefault();
        }}
        onWheel={(e) => {
          // Stop grid canvas (non-passive wheel) from stealing this scroll.
          e.stopPropagation();
        }}
      >
        <ul className="SkSpFormulaFuncSuggest-list" role="listbox">
          {wItems.map((wFn, wIdx) => (
            <li
              key={wFn.name}
              role="option"
              aria-selected={wIdx === wIndex}
              className={
                wIdx === wIndex
                  ? "SkSpFormulaFuncSuggest-item is-active"
                  : "SkSpFormulaFuncSuggest-item"
              }
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                this.acceptFunctionSuggest(wFn);
              }}
              onMouseEnter={() => {
                if (wIdx !== this.state.functionSuggestIndex) {
                  this.setState({ functionSuggestIndex: wIdx });
                }
              }}
            >
              <span className="SkSpFormulaFuncSuggest-name">{wFn.name}</span>
              {wFn.syntax ? (
                <span className="SkSpFormulaFuncSuggest-syntax">{wFn.syntax}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>,
      document.body
    );
  }

  text() {
    return(this.m_Ref.current.value);
  }

  // Match tLemonInterface::ErrorWithDetail geometry: global index = sum(prev lines + newline) + error column.
  setCaretAtCompileError(text, errorLine, errorColumn) {
    const el = this.m_Ref && this.m_Ref.current;
    if (!el || typeof text !== "string") return;
    let pos = 0;
    if (errorLine > 0 && errorColumn >= 0) {
      const lines = text.split("\n");
      if (errorLine <= lines.length) {
        for (let i = 0; i < errorLine - 1; i++) {
          pos += lines[i].length + 1;
        }
        pos += errorColumn;
      }
    }
    const len = text.length;
    pos = Math.max(0, Math.min(pos, len));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  shiftCharacters(sChar) {
    switch(sChar) {
        case '=':
        case '+':
        case '-':
        case '*':
        case '/':
        case '(':
        case ';' : 
        case ',' :
        case ':' : return(true);  
        default: return(false);
      }
  }

  /** Excel-like formula point mode: grid click/arrows insert A1 refs instead of committing. */
  isFormulaPointModeFromCaret(wStart, wEnd, wText) {
    if (wText.substr(0, 1) !== "=") {
      return false;
    }
    if (this.m_AcceptSelection && !this.isToolbarLikePropertyStatic()) {
      return false;
    }
    // Keep replacing the previously inserted pick while it stays selected.
    if (this.m_Shift && wStart !== wEnd) {
      return true;
    }
    // Attribute panel: point mode at any pick anchor (=, (, :, …), not only at EOL.
    if (this.isToolbarLikePropertyStatic()) {
      if (wStart !== wEnd) {
        const wChar = wText.substr(wStart - 1, 1);
        return wStart > 0 && this.shiftCharacters(wChar);
      }
      if (wStart > 0) {
        const wChar = wText.substr(wStart - 1, 1);
        return this.shiftCharacters(wChar);
      }
      return false;
    }
    if (((wStart > 0) && (wEnd === wText.length)) || (wStart !== wEnd)) {
      const wChar = wText.substr(wStart - 1, 1);
      return this.shiftCharacters(wChar);
    }
    return false;
  }

  captureFormulaPickCaret() {
    const el = this.m_Ref?.current;
    if (!el) {
      return;
    }
    this.m_FormulaPickCaretStart = el.selectionStart;
    this.m_FormulaPickCaretEnd = el.selectionEnd;
  }

  formulaPickCaret() {
    const el = this.m_Ref?.current;
    if (!el) {
      return { start: 0, end: 0 };
    }
    const wActiveEl =
      typeof document !== "undefined" ? document.activeElement : null;
    if (el === wActiveEl) {
      return { start: el.selectionStart, end: el.selectionEnd };
    }
    if (
      this.m_FormulaPickCaretStart != null &&
      this.m_FormulaPickCaretEnd != null
    ) {
      return {
        start: this.m_FormulaPickCaretStart,
        end: this.m_FormulaPickCaretEnd,
      };
    }
    return { start: el.selectionStart, end: el.selectionEnd };
  }

  isFormulaPointMode() {
    const el = this.m_Ref && this.m_Ref.current;
    if (!el) {
      return false;
    }
    const wText = el.value != null ? el.value : "";
    const wCaret = this.formulaPickCaret();
    return this.isFormulaPointModeFromCaret(wCaret.start, wCaret.end, wText);
  }

  shift(event) {
    // AcceptSelection mode: plain arrows move the grid cursor; Shift+Arrow
    // keeps native in-field selection (named-range ref, etc.) like the main
    // formula bar when the caret is in plain text.
    if (this.m_AcceptSelection && !this.m_FormulaOnlyRangePick) {
      // Attribute panel (ToolbarLike): range attrs always pick A1 refs; formulas use point mode.
      if (this.isToolbarLikePropertyStatic()) {
        if (this.isAttributeRangePropertyStatic()) {
          const wNavKey =
            event.key === "ArrowLeft" ||
            event.key === "ArrowRight" ||
            event.key === "ArrowUp" ||
            event.key === "ArrowDown" ||
            event.key === "PageUp" ||
            event.key === "PageDown" ||
            event.key === "Home" ||
            event.key === "End";
          if (wNavKey) {
            return true;
          }
        }
        const wNavKey =
          event.key === "ArrowLeft" ||
          event.key === "ArrowRight" ||
          event.key === "ArrowUp" ||
          event.key === "ArrowDown" ||
          event.key === "PageUp" ||
          event.key === "PageDown" ||
          event.key === "Home" ||
          event.key === "End";
        if (wNavKey) {
          const wText = event.target.value != null ? String(event.target.value) : "";
          if (wText.trimStart().startsWith("=")) {
            return this.isFormulaPointModeFromCaret(
              event.target.selectionStart,
              event.target.selectionEnd,
              wText
            );
          }
          return false;
        }
      }
      if (
        event.shiftKey &&
        (event.key === "ArrowLeft" ||
          event.key === "ArrowRight" ||
          event.key === "ArrowUp" ||
          event.key === "ArrowDown")
      ) {
        return false;
      }
      return true;
    }
    if (this.m_FormulaOnlyRangePick && !this.isRangePickActive(event.target.value)) {
      return false;
    }
    if (
      this.m_FormulaOnlyRangePick &&
      event.shiftKey &&
      (event.key === "ArrowLeft" ||
        event.key === "ArrowRight" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowDown")
    ) {
      return false;
    }
    return this.isFormulaPointModeFromCaret(
      event.target.selectionStart,
      event.target.selectionEnd,
      event.target.value
    );
  }

  /** Highlight the freshly picked A1/range token so the next grid move replaces it. */
  selectInsertedReference(sStart, sInserted) {
    const wRef = this.m_Ref.current;
    if (!wRef || sInserted == null) {
      return;
    }
    const wLen = String(sInserted).length;
    const wEnd = sStart + wLen;
    wRef.setSelectionRange(sStart, wEnd);
    if (typeof this.captureFormulaPickCaret === "function") {
      this.captureFormulaPickCaret();
    }
    if (typeof window !== "undefined" && window.requestAnimationFrame) {
      window.requestAnimationFrame(() => {
        if (this.m_Ref.current) {
          this.m_Ref.current.setSelectionRange(sStart, wEnd);
          if (typeof this.captureFormulaPickCaret === "function") {
            this.captureFormulaPickCaret();
          }
        }
      });
    }
  }

  insertText(event,sText) {
    let wStart=event.target.selectionStart;
    let wEnd=event.target.selectionEnd;
    let wText=event.target.value;
    let wTextBefore = wText.substring(0, wStart);
    let wTextAfter = wText.substring(wEnd, wText.length);
    event.target.value=wTextBefore+sText+wTextAfter;
    this.selectInsertedReference(wStart, sText);
    this.m_Shift=true;
    this.m_Text = event.target.value;
    if (!this.m_Static) {
      this.scheduleFitCellEditToContent();
    }
  }

  // Excel-like manual line break: Alt+Enter (Win/Linux) or Ctrl+Option+Enter (Mac).
  isManualLineBreakShortcut(event) {
    if (event.key !== "Enter" || event.shiftKey) {
      return false;
    }
    if (!event.altKey) {
      return false;
    }
    return true;
  }

  insertLineBreakAtCaret(event) {
    const el = this.m_Ref && this.m_Ref.current;
    if (!el) {
      return;
    }
    const wStart = el.selectionStart;
    const wEnd = el.selectionEnd;
    const wText = el.value;
    const wBefore = wText.substring(0, wStart);
    const wAfter = wText.substring(wEnd);
    el.value = `${wBefore}\n${wAfter}`;
    const wCaret = wStart + 1;
    el.setSelectionRange(wCaret, wCaret);
    this.m_Text = el.value;

    if (this.m_Static) {
      this.scheduleFitStaticEditWidth();
      if (this.isFormulaBarStatic()) {
        this.scrollCellEditCaretIntoView(el);
      }
    } else {
      this.scheduleFitCellEditToContent();
      this.scrollCellEditCaretIntoView(el);
    }

    const wMirrorEdit = this.returnMirrorEdit();
    if (wMirrorEdit != null && wMirrorEdit !== this) {
      wMirrorEdit.setText(this.text());
    }
    this.fireTextChange(this.text());
  }

  selectAll() {
    this.m_Ref.current.setSelectionRange(0,this.m_Ref.current.value.length);
  }

  insertSelect(event,sText) {
    this.insertText(event, sText);
    const wSelStart = event.target.selectionStart;
    const wSelEnd = event.target.selectionEnd;
    const wMirrorEdit = this.returnMirrorEdit();
    if (wMirrorEdit != null && wMirrorEdit !== this) {
      wMirrorEdit.setText(this.text());
      const wMirrorEl = wMirrorEdit.m_Ref && wMirrorEdit.m_Ref.current;
      if (wMirrorEl && wSelEnd > wSelStart) {
        wMirrorEl.setSelectionRange(wSelStart, wSelEnd);
      }
    }
  }

  // Range-picker: apply a grid selection to the current field contents.
  // Three cases, in order:
  //   1. An explicit in-field selection (wStart !== wEnd) -> replace
  //      only the selected portion (lets the user re-pick the last
  //      reference after an append).
  //   2. Cursor sits right after a list separator (';' or ',')
  //      -> insert the new selection at the cursor, keeping the text
  //      before it intact. This is how multi-area references are built,
  //      e.g. "B2:B3;C2:C3".
  //   3. Otherwise -> replace the whole content.
  applyPickedSelection(sSelection) {
    const wRef=this.m_Ref.current;
    if (!wRef) return;
    const wText=wRef.value;
    const wStart=wRef.selectionStart;
    const wEnd=wRef.selectionEnd;

    let wNewText;
    let wNewStart;
    let wNewEnd;

    if (wStart !== wEnd) {
      const wBefore=wText.substring(0, wStart);
      const wAfter=wText.substring(wEnd);
      wNewText=wBefore+sSelection+wAfter;
      wNewStart=wStart;
      wNewEnd=wStart+sSelection.length;
    } else if (wStart > 0 && this.isListSeparator(wText.charAt(wStart-1))) {
      const wBefore=wText.substring(0, wStart);
      const wAfter=wText.substring(wStart);
      wNewText=wBefore+sSelection+wAfter;
      wNewStart=wStart;
      wNewEnd=wStart+sSelection.length;
    } else {
      wNewText=sSelection;
      wNewStart=0;
      wNewEnd=sSelection.length;
    }

    this.insertMouseText(wNewText);
    wRef.setSelectionRange(wNewStart, wNewEnd);
    this.m_Shift=true;
    if (typeof window !== "undefined" && window.requestAnimationFrame) {
      const wStart = wNewStart;
      const wEnd = wNewEnd;
      window.requestAnimationFrame(() => {
        if (this.m_Ref.current) {
          this.m_Ref.current.setSelectionRange(wStart, wEnd);
        }
      });
    }
  }

  isListSeparator(sChar) {
    return (sChar === ";" || sChar === ",");
  }

  insertMouseText(sText) {
    this.setText(sText)
    const wMirrorEdit=this.returnMirrorEdit();
    if (wMirrorEdit != null && wMirrorEdit !== this) {
      wMirrorEdit.setText(sText);
    }
  }

  mouseSelection(sSelection) {
    if (!this.m_Ref?.current || sSelection == null) {
      return false;
    }
    let wStart=this.m_Ref.current.selectionStart;
    let wEnd=this.m_Ref.current.selectionEnd;
    let wText=this.m_Ref.current.value;
    if (this.isToolbarLikePropertyStatic()) {
      const wCaret = this.formulaPickCaret();
      wStart = wCaret.start;
      wEnd = wCaret.end;
    }
    //console.log("Input:",wStart,',',wEnd,",",wText);
    // AcceptSelection mode: range-picker behaviour — replace / insert /
    // append depending on cursor context (see applyPickedSelection).
    if (this.m_AcceptSelection && !this.m_FormulaOnlyRangePick) {
      if (this.isToolbarLikePropertyStatic()) {
        if (this.isAttributeRangePropertyStatic()) {
          this.applyPickedSelection(sSelection);
          return false;
        }
        if (this.isFormulaPointModeFromCaret(wStart, wEnd, wText)) {
          const wTextBefore = wText.substring(0, wStart);
          const wTextAfter = wText.substring(wEnd, wText.length);
          this.insertMouseText(wTextBefore + sSelection + wTextAfter);
          this.selectInsertedReference(wStart, sSelection);
          this.m_Shift = true;
        }
        return false;
      }
      this.applyPickedSelection(sSelection);
      return(false);
    }
    if (this.m_FormulaOnlyRangePick) {
      if (!this.isRangePickActive(wText)) {
        return false;
      }
      if (this.isFormulaPointModeFromCaret(wStart, wEnd, wText)) {
        const wTextBefore = wText.substring(0, wStart);
        const wTextAfter = wText.substring(wEnd, wText.length);
        this.insertMouseText(wTextBefore + sSelection + wTextAfter);
        this.selectInsertedReference(wStart, sSelection);
        this.m_Shift = true;
        return false;
      }
      this.applyPickedSelection(sSelection);
      return false;
    }
    if (this.isFormulaPointModeFromCaret(wStart, wEnd, wText)) {
      let wTextBefore = wText.substring(0, wStart);
      let wTextAfter = wText.substring(wEnd, wText.length);
      this.insertMouseText(wTextBefore+sSelection+wTextAfter);  
      this.selectInsertedReference(wStart, sSelection);
      this.m_Shift = true;
    } else if (wStart !== wEnd) {
      let wTextBefore = wText.substring(0, wStart);
      let wTextAfter = wText.substring(wEnd, wText.length);
      this.insertMouseText(wTextBefore+sSelection+wTextAfter);
      this.selectInsertedReference(wStart, sSelection);
      this.m_Shift = true;
    }
    return(false);
  }

  async keyDown(event) {
    if (this.m_Unmount) {
      event.stopPropagation()
      return
    }
    //re-render when input changes
    if (this.m_Static) {
      //this.setState({ Text : event.target.value});
    }
    //console.log( "KeyDown InplaceEdit :" + event.key + " " + event.srcElement.id);

    if (this.handleFunctionSuggestKeyDown(event)) {
      return;
    }
    
    if (this.m_Id===event.srcElement.id) {
      if (this.shift(event)) {
      let wShift=false;
      switch(event.key) {
          case 'ArrowLeft' : 
          case 'ArrowRight' : 
          case 'ArrowUp' : 
          case 'ArrowDown' : 
          case 'PageUp' :
          case 'PageDown' :
          case 'Home' :
          case 'End' : {
            if (
              this.m_SpInterface.isGridRangePickActive &&
              this.m_SpInterface.isGridRangePickActive()
            ) {
              await this.m_SpInterface.cursorMoveKeyForFormulaEdit(event);
              event.preventDefault();
              return;
            }
            const wResult = await this.m_SpInterface.cursorMoveKey(event);
            if (wResult) {
              this.m_SpInterface.invalidateCanvas();
            }
            wShift=true;
            break;
          }
          case 'Shift' :
          case 'Control' :
          case 'Alt' :
          case 'Meta' : {
             return;
          }
          default: { 
            // Raz Selection
            event.target.setSelectionRange(event.target.selectionEnd,event.target.selectionEnd); 
            break;
          }
        }
        if (wShift) {
          event.preventDefault();
          let wSelect =
            typeof this.m_SpInterface.formulaPickSelectstr === "function"
              ? this.m_SpInterface.formulaPickSelectstr()
              : this.m_SpInterface.selectstr();
          if (this.m_AcceptSelection) {
            this.applyPickedSelection(wSelect);
          } else {
            this.insertSelect(event,wSelect);
          }
          return;
        }
      }
    }
    if ((!event.shiftKey) && (!event.ctrlKey) && (!event.altKey) && (!event.metaKey)) {
      if (this.m_Shift) {
        if (this.shiftCharacters(event.key)) {
          event.target.setSelectionRange(event.target.selectionEnd,event.target.selectionEnd);
        }      
      }
    }
   
    this.m_Shift=false;
 
    switch(event.key) {
      case 'ArrowUp' :
      case 'ArrowDown' :
      case 'PageUp' :
      case 'PageDown' : {
        if (this.isToolbarLikePropertyStatic()) {
          break;
        }
        // Range-picker fields need default Up/Down when Shift extends selection.
        if (!(this.m_AcceptSelection && event.shiftKey)) {
          event.preventDefault();
        }
        break;
      }
      // See SkGridCanvas
      case 'Escape' : 
      case 'Enter' : {
        if (this.isManualLineBreakShortcut(event)) {
          event.preventDefault();
          event.stopPropagation();
          this.insertLineBreakAtCaret(event);
          return;
        }
        await this.m_SpInterface.m_SkSpGridCanvas.keyDown(event);
        break;
      }
      default : {
        break;
      }
     }    
  }

  keyUp(event) {
    //console.log( "KeyUp InplaceEdit :" + event.key + " " + event.srcElement.id);
    const wText=this.text();
    if (this.m_Static) {
      this.scheduleFitStaticEditWidth();
      if (this.isFormulaBarStatic()) {
        this.scrollCellEditCaretIntoView(this.m_Ref.current);
      }
    } else {
      this.scheduleFitCellEditToContent();
    }
    let wMirrorEdit=this.returnMirrorEdit();
    if (wMirrorEdit != null && wMirrorEdit !== this) {
      wMirrorEdit.setText(wText);
    }
    this.syncFormulaOnlyRangePick();
    this.syncToolbarLikeAttributeFormulaPick();
    if (this.isToolbarLikePropertyStatic()) {
      this.captureFormulaPickCaret();
    }
    this.fireTextChange(wText);
    // Caret moves (arrows) while typing a radical — keep list in sync.
    if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      this.refreshFunctionSuggest();
    }
  }

  mouseDown(event) {
    if (this.m_Static) {
      if (this.isToolbarLikePropertyStatic()) {
        return;
      }
      if (this.autoPushPropertyEdit()) {
        // autoPushPropertyEdit has already called beginEdit().
        return;
      }
      if (
        this.isFormulaBarStatic() &&
        this.m_SpInterface &&
        typeof this.m_SpInterface.getUseEdit === 'function' &&
        !this.m_SpInterface.getUseEdit()
      ) {
        event.preventDefault();
        this.m_SpInterface.activateFormulaBarEdit().catch((error) => {
          console.error('activateFormulaBarEdit failed:', error);
        });
        return;
      }
      this.m_SpInterface.beginEdit();
    }
  }

  mouseMove(event) {
  }

  mouseUp(event) {
    if (this.m_Static && this.isFormulaBarStatic()) {
      this.scrollCellEditCaretIntoView(this.m_Ref.current);
    }
    this.refreshFunctionSuggest();
  }

  focus(event) {
    this.setState({ Focus: true });
    if (this.isFormulaBarStatic()) {
      this.scrollCellEditCaretIntoView(this.m_Ref.current);
    }
    if (this.isToolbarLikePropertyStatic()) {
      this.captureFormulaPickCaret();
      return;
    }
    // Property panel: route grid picks only for formulas (=...).
    if (this.m_FormulaOnlyRangePick) {
      this.syncFormulaOnlyRangePick();
    } else {
      this.autoPushPropertyEdit();
    }
  }

  blur(event) {
    this.setState( { Focus : false })
    if (this.m_FunctionSuggestBlurTimer != null) {
      clearTimeout(this.m_FunctionSuggestBlurTimer);
    }
    this.m_FunctionSuggestBlurTimer = setTimeout(() => {
      this.m_FunctionSuggestBlurTimer = null;
      this.clearFunctionSuggest();
    }, 120);
  }

  contextMenu(event) {
    event.preventDefault();
  }

  // True when an external property-level inplace edit (attribute panel,
  // named ranges tab, ...) is currently driving the edit. In that case
  // the canvas cell overlay must stay mounted (it still acts as a mirror
  // for keyUp / insertSelect) but it must be visually hidden and must
  // not intercept pointer events.
  isPropertyEditActive() {
    return (
      this.m_SpInterface &&
      this.m_SpInterface.m_SkSpInplaceEditProperty !== undefined &&
      this.m_SpInterface.m_SkSpInplaceEditProperty !== null &&
      this.m_SpInterface.m_SkSpInplaceEditProperty !== this
    );
  }

  /** Row/col whose format paints the cell overlay (edit anchor, not pick cursor). */
  resolveStyleAnchorRowCol() {
    const sp = this.m_SpInterface;
    if (sp == null) {
      return null;
    }
    if (sp.m_CursorEdit != null) {
      return { row: sp.m_CursorEdit.row(), col: sp.m_CursorEdit.col() };
    }
    if (typeof sp.getUseEdit === "function" && sp.getUseEdit()) {
      const wCur = typeof sp.cursor === "function" ? sp.cursor() : null;
      if (wCur != null) {
        return { row: wCur.row(), col: wCur.col() };
      }
    }
    return null;
  }

  resolveRenderCellJson() {
    const sp = this.m_SpInterface;
    let wCell = this.m_Cell;
    const wAnchorPos = this.resolveStyleAnchorRowCol();

    if (wAnchorPos != null && sp != null) {
      if (typeof sp.getEditAnchorCell === "function") {
        const wAnchorCell = sp.getEditAnchorCell();
        if (wAnchorCell != null && typeof wAnchorCell === "object") {
          wCell = wAnchorCell;
        }
      }
      if (
        (wCell == null || typeof wCell !== "object") &&
        typeof sp.getJsonViewCellAt === "function"
      ) {
        wCell = sp.getJsonViewCellAt(wAnchorPos.row, wAnchorPos.col);
      }
    } else if (
      (wCell == null || typeof wCell !== "object") &&
      sp != null &&
      typeof sp.cursor === "function" &&
      typeof sp.getJsonViewCellAt === "function"
    ) {
      const wCursor = sp.cursor();
      wCell = sp.getJsonViewCellAt(wCursor.row(), wCursor.col());
    }
    return wCell;
  }

  renderCell() {
    let wCell = this.resolveRenderCellJson();
    const wHidden = this.isPropertyEditActive();
    const wHasLayout =
      Number.isFinite(this.m_Left) &&
      Number.isFinite(this.m_Top) &&
      Number.isFinite(this.m_Width) &&
      Number.isFinite(this.m_Height);
    if (
      wCell === null ||
      typeof wCell !== "object" ||
      typeof wCell.then === "function"
    ) {
      const wFallbackStyle = wHasLayout
        ? {
            top: this.m_Top,
            left: this.m_Left,
            minHeight: this.m_Height,
            minWidth: this.m_Width,
            margin: "0px",
            padding: "3px",
            resize: "none",
            overflow: "auto",
            whiteSpace: "pre",
            lineHeight: INPLACE_CELL_LINE_HEIGHT_RATIO,
            boxSizing: "border-box",
            visibility: wHidden ? "hidden" : "visible",
            pointerEvents: wHidden ? "none" : "auto",
          }
        : wHidden
          ? { visibility: "hidden", pointerEvents: "none" }
          : undefined;
      return (
        <textarea
          className="SkSpInplaceEdit"
          ref={this.m_Ref}
          id={this.m_Id}
          defaultValue={this.m_Text}
          disabled={this.state.Disabled}
          autoComplete="off"
          placeholder={this.props.placeholder}
          rows={1}
          style={wFallbackStyle}
        />
      );
    }
    let wFontName="Roboto";
    let wFontSize=12;
    let wPadding="3px";
    let wColor="black";
    let wBackgroundColor="white";

    if (wCell.hasOwnProperty("f_p")) {
      wPadding=wCell.f_p;
    }
    const wPaddingLeft = wCell.hasOwnProperty("f_pl") ? wCell.f_pl : undefined;
    const wPaddingRight = wCell.hasOwnProperty("f_pr") ? wCell.f_pr : undefined;
    if (wCell.hasOwnProperty("f_c")) {
      wColor=wCell.f_c; 
    }
    if (wCell.hasOwnProperty("f_bc")) {
      wBackgroundColor=wCell.f_bc; 
    } else if (
      this.m_SpInterface != null &&
      typeof this.m_SpInterface.getJsonViewBackgroundColorSync === "function"
    ) {
      const wAnchorPos = this.resolveStyleAnchorRowCol();
      const wCur =
        wAnchorPos != null
          ? wAnchorPos
          : (() => {
              const wLive = this.m_SpInterface.cursor();
              return { row: wLive.row(), col: wLive.col() };
            })();
      const wBc = this.m_SpInterface.getJsonViewBackgroundColorSync(
        wCur.row,
        wCur.col
      );
      if (wBc != null) {
        wBackgroundColor = wBc;
      }
    }
    if (wCell.hasOwnProperty("f_f_n")) {
      wFontName=wCell.f_f_n;
    }
    if (wCell.hasOwnProperty("f_f_s")) {
      wFontSize=wCell.f_f_s;
    }

    const { textColor: wContrastColor, caretColor: wCaretColor } =
      contrastInplaceEditColors(wColor, wBackgroundColor);

    const wCellStyle = {
      top : this.m_Top,
      left : this.m_Left,
      minHeight : this.m_Height,
      minWidth : this.m_Width,
      color: wContrastColor,
      caretColor: wCaretColor,
      backgroundColor: wBackgroundColor,
      fontFamily : buildCanvasFontFamily(wFontName),
      fontSize: `${wFontSize}pt`,
      border: wCell.f_bo,
      borderTop: wCell.f_bot,
      borderLeft: wCell.f_bol,
      borderBottom: wCell.f_bob,
      borderRight: wCell.f_bor,
      margin:"0px",
      padding: wPadding,
      ...(wPaddingLeft !== undefined ? { paddingLeft: wPaddingLeft } : {}),
      ...(wPaddingRight !== undefined ? { paddingRight: wPaddingRight } : {}),
      resize: "none",
      overflow: "auto",
      whiteSpace: cellTextWrapEnabled(wCell) ? "pre-wrap" : "pre",
      wordBreak: cellTextWrapEnabled(wCell) ? "break-word" : "normal",
      lineHeight: INPLACE_CELL_LINE_HEIGHT_RATIO,
      boxSizing: "border-box",
      visibility: wHidden ? "hidden" : "visible",
      pointerEvents: wHidden ? "none" : "auto",
    };
    return (
    <textarea className="SkSpInplaceEdit"
      defaultValue={this.m_Text}
      disabled={this.state.Disabled}
      autoComplete="off"
      placeholder={this.props.placeholder}
      ref={this.m_Ref} 
      id={this.m_Id}
      rows={1}
      style={wCellStyle} 
      />
    );
  }

  renderStatic() {
      const wFormulaBar = this.isFormulaBarStatic();
      const wToolbarLike = this.isToolbarLikePropertyStatic();
      const wLocked = Boolean(this.state.Disabled);
      const wClassName = [
        'SkSpInplaceEditStatic',
        (wFormulaBar || wToolbarLike) && wLocked ? 'SkSpInplaceEditStatic--locked' : '',
        this.props.className,
      ].filter(Boolean).join(' ');
      const wPropRows = this.props.rows != null ? Number(this.props.rows) : null;
      const wPanelCompact = this.isPanelCompactStatic();
      const wRows = wFormulaBar
        ? 1
        : wPanelCompact
          ? 1
          : (Number.isFinite(wPropRows) && wPropRows > 0 ? wPropRows : 2);
      const wStyle = wPanelCompact
        ? { ...this.props.style, margin: 0, padding: "2px 6px" }
        : this.props.style;
      return (
        <textarea 
          className={wClassName}
          defaultValue={this.m_Text}
          disabled={wFormulaBar || wToolbarLike ? false : wLocked}
          readOnly={(wFormulaBar || wToolbarLike) && wLocked}
          autoComplete="off"
          placeholder={this.props.placeholder}
          ref={this.m_Ref} 
          id={this.m_Id}
          rows={wRows}
          style={wStyle}
          />
        );
  }
  
  render() {
    const wEditor = !this.m_Static ? this.renderCell() : this.renderStatic();
    return (
      <>
        {wEditor}
        {this.renderFunctionSuggestPortal()}
      </>
    );
  }
}

// ========================================

export default SkSpInplaceEdit;