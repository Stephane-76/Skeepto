//=============================================================================
// SkSpControlPanel
// Panel bottom 
//=============================================================================
import React from "react";
import SkComponent from "../component/SkComponent";
import SkSpInplaceEdit from "./SkSpInplaceEdit";
import './SkSpreadSheet.css'

import { ReactComponent as SvgValid } from "../svg/check.svg";
import { ReactComponent as SvgEdit } from "../svg/edit.svg";
import SkButton from "../component/SkButton";
import SkReadOnlyBanner from "../component/SkReadOnlyBanner.js";
import {
  isActiveSpreadsheetReadOnly,
  SK_ACTIVE_FILE_EVENT,
} from "../SkActiveFile.js";
import {
  getRibbonVisible,
  setRibbonVisible,
  subscribeRibbonVisible,
} from "./SkRibbonVisible.js";

class SkSpControlPanel extends SkComponent {
  constructor(props) {
    super(props);
    this.spInterface = props.SpInterface;
    this.state = { 
      invalidate: false,
      ref: "Ref",
      cellValue: "CellValue",
      selection: "Selection",
      showCFModal: false,
      cfInitial: null,
      editSyntaxError: "",
    };
    this.valid = this.valid.bind(this);
    this.edit = this.edit.bind(this);
    this.goToVirtualDisk = this.goToVirtualDisk.bind(this);
    
    this.spInterface.m_SkSpControlPanel = this;
  }

  componentDidMount() {
    this.setState({ ribbonVisible: getRibbonVisible() });
    this._onActiveFileEvent = () => {
      this.forceUpdate();
    };
    window.addEventListener(SK_ACTIVE_FILE_EVENT, this._onActiveFileEvent);
    this._unsubscribeRibbon = subscribeRibbonVisible((visible) => {
      this.setState({ ribbonVisible: visible });
    });
  }

  componentWillUnmount() {
    if (this._onActiveFileEvent) {
      window.removeEventListener(SK_ACTIVE_FILE_EVENT, this._onActiveFileEvent);
    }
    if (this._unsubscribeRibbon) {
      this._unsubscribeRibbon();
    }
  }

  toggleRibbon = () => {
    setRibbonVisible(!this.state.ribbonVisible);
  };

  setEditError(message) {
    const text = typeof message === "string" ? message : "";
    this.setState({ editSyntaxError: text });
  }

  valid() {
    this.spInterface.validEdit()
      .then((ok) => {
        this.setState((s) => ({
          invalidate: !s.invalidate,
        }));
      })
      .catch(error => {
        console.error("Error in validEdit:", error);
      });
  }
  
  edit() {
    if (isActiveSpreadsheetReadOnly()) {
      return;
    }
    this.spInterface
      .activateFormulaBarEdit()
      .then(() => {
        this.setState((s) => ({ invalidate: !s.invalidate }));
      })
      .catch((error) => {
        console.error('Error in edit:', error);
      });
  }

  openCFModal = () => {
    let ref = '';
    try {
      if (window.SkUISpreadSheet && typeof this.spInterface.selectstr === 'function') {
        ref = this.spInterface.selectstr();
      }
    } catch (e) {
      ref = '';
    }
    const sheet = (this.spInterface && this.spInterface.m_UIView && this.spInterface.m_UIView.sheet) ? this.spInterface.m_UIView.sheet : '';
    this.setState({ 
      showCFModal: true,
      cfInitial: { type: 'ColorScales', ref, sheet, params: [] }
    });
  }

  closeCFModal = () => {
    this.setState({ showCFModal: false });
  }

  openFunctionSelector = () => {
    // The selector now lives inside the right command stack panel (see
    // SkSpCommand "Insert function" tab). Delegate to the parent so the
    // right panel opens if closed, then activates the proper panel.
    if (typeof this.props.onOpenRightPanelTab === 'function') {
      this.props.onOpenRightPanelTab('Insert function');
    }
  }

  ref(ref) {
    if (ref instanceof Promise) {
      ref.then(value => {
        this.setState({ ref: value });
      }).catch(error => {
        console.error("Error resolving ref promise:", error);
        this.setState({ ref: '' });
      });
    } else {
      this.setState({ ref });
    }
  }

  cellValue(cellValue) {
    this.setState({ cellValue });
  }

  selection(selection) {
    this.setState({ selection });
  }

  goToVirtualDisk() {
    if (typeof window.__skerNavigate === 'function') {
      window.__skerNavigate('/virtualdisk', { replace: true });
    }
  }

  // Formula bar uses readOnly (not disabled) while idle; start edit when not in edit session yet.
  handleFormulaAreaMouseDown = (event) => {
    if (isActiveSpreadsheetReadOnly()) {
      return;
    }
    if (typeof this.spInterface.getUseEdit === 'function' && this.spInterface.getUseEdit()) {
      return;
    }
    event.preventDefault();
    this.edit();
  };

  render() {
    const svgStyle = {
      width: "20px",
      height: "20px",
      flexShrink: 0,
    };

    const editStyle = {
      width: "100%",
      minWidth: 0,
      height: "100%",
    };

    

    // Ensure ref is a string before rendering
    const refValue = this.state.ref instanceof Promise ? '' : this.state.ref;

    const readOnly = isActiveSpreadsheetReadOnly();
    const ribbonVisible =
      this.state.ribbonVisible !== undefined
        ? this.state.ribbonVisible
        : getRibbonVisible();

    return (
      <div ref={this.m_Ref} className="SkSpControlPanelWrap" style={{ position: "relative" }}>
        <div className={`SkSpControlPanel${readOnly ? ' SkSpControlPanel--readOnly' : ''}`}>
        <SkReadOnlyBanner className="sk-readonly-banner--in-control-panel" />
        <SvgEdit className="SkSvg" onClick={this.edit} style={svgStyle}/>
        <div id="ref" className="SkSpControlPanel-ref">{refValue}</div>
        <div
          className="SkSpControlPanel-formula"
          onMouseDownCapture={this.handleFormulaAreaMouseDown}
          title={readOnly ? undefined : 'Click to edit'}
        >
        <SkSpInplaceEdit
          static="true"
          SpInterface={this.spInterface}
          Id="InplaceEditStatic"
          style={editStyle}
        />
        </div>
        <SvgValid className="SkSvg" onClick={this.valid} style={svgStyle}/>
        <SkButton 
          className="SkSpControlPanel-fxBtn"
          onClick={this.openFunctionSelector}
        >
          fx
        </SkButton>
        <div id="selection" className="SkSpControlPanel-selection">{this.state.selection}</div>

        <div className="SkSpControlPanel-trailingActions">
          <button
            type="button"
            className="SkIconBtn SkSpControlPanel-ribbonToggle"
            onClick={this.toggleRibbon}
            title={ribbonVisible ? 'Hide ribbon' : 'Show ribbon'}
            aria-pressed={ribbonVisible}
          >
            {ribbonVisible ? '▲' : '▼'}
          </button>
          <button
            type="button"
            className="SkPanelCloseBtn SkSpControlPanel-close"
            title="Close and open Virtual disk"
            aria-label="Close and open Virtual disk"
            onClick={this.goToVirtualDisk}
          >
            ×
          </button>
        </div>
        </div>
        {this.state.editSyntaxError ? (
          <div className="SkSpControlPanel-error" role="alert">
            {this.state.editSyntaxError}
          </div>
        ) : null}
      </div>
    );
  }
}
// ========================================

export default SkSpControlPanel;