//=============================================================================
// SkSpControlPanel
// Panel bottom 
//=============================================================================
import React from "react";

import SkComponent  from "../component/SkComponent";
import SkMenuPopUp from "../component/SkMenuPopup";
import SkMenuElement from "../component/SkMenuElement";
import './SkSpreadSheet.css'

import { ReactComponent as SvgPlus } from "../svg/plus.svg";
import { ReactComponent as SvgMenu } from "../svg/menu.svg";
import { ReactComponent as SvgAngleLeft } from "../svg/angle-left.svg";
import { ReactComponent as SvgAngleRight } from "../svg/angle-right.svg";

import SkTab from '../component/SkTab';
import SkTabs from '../component/SkTabs';
import {
  applySpreadsheetLang,
  getSpreadsheetLang,
  SPREADSHEET_LANGS,
} from "./SkeeptoLang.js";
import { loadFormatCatalog } from "./SkNumberFormatMenu.js";
import SkSpZoomControl from "./SkSpZoomControl.js";

/** Next default sheet name: Sheet1, Sheet2, … — first index not already used (case-insensitive). */
function suggestNewSheetName(existingSheets) {
  const wNames = (Array.isArray(existingSheets) ? existingSheets : []).filter(
    (name) => typeof name === "string" && name.trim().length > 0,
  );
  const wExistingLower = new Set(wNames.map((name) => name.trim().toLowerCase()));
  for (let wIndex = 1; wIndex < 1000; wIndex++) {
    const wName = `Sheet${wIndex}`;
    if (!wExistingLower.has(wName.toLowerCase())) {
      return wName;
    }
  }
  return `Sheet${Date.now()}`;
}


class SkSpSheetTab extends SkComponent {
  constructor(props) {
    super(props);
    this.m_SpInterface=props.SpInterface;
    this.state = ({ 
      invalidate : false,
      inlineRenameSheet: "",
      inlineRenameValue: "",
      activeLang: getSpreadsheetLang(),
      canScrollTabLeft : false,
      canScrollTabRight : false,
      sheetListMenuOpen: false,
      tabContextMenuOpen: false,
      contextSheetName: "",
      tabDragging: null,
      tabPreviewOrder: null,
    });
    this.m_TabDragPending = null;
    this.m_TabDragDidMove = false;
    this.m_SuppressTabClick = false;
    this.m_ScrollStripRef = React.createRef();
    this.m_RefSheetListMenu = React.createRef();
    this.m_RefTabContextMenu = React.createRef();
    this.m_SpInterface.m_SkSpSheetTab=this;
    this.m_TabComponent=null;
    this.m_Sheets=["Sheet1"];
    this.m_Sheet="Sheet1";
  }

  componentDidMount() {
    window.addEventListener("resize", this.updateTabStripScrollState);
    this.handleLangChange = (event) => {
      const lang = event?.detail?.lang || getSpreadsheetLang();
      this.setState({ activeLang: lang });
    };
    window.addEventListener("skeeptoLangChange", this.handleLangChange);
    requestAnimationFrame(() => this.updateTabStripScrollState());
  }

  componentWillUnmount() {
    window.removeEventListener("resize", this.updateTabStripScrollState);
    if (this.handleLangChange) {
      window.removeEventListener("skeeptoLangChange", this.handleLangChange);
    }
    this.endTabDragSession(false);
  }

  componentDidUpdate(prevProps, prevState) {
    if (prevState.invalidate !== this.state.invalidate) {
      requestAnimationFrame(() => this.updateTabStripScrollState());
    }
  }

  // Sync scroll arrow enabled state when tab strip overflows or scroll position changes.
  updateTabStripScrollState = () => {
    const el = this.m_ScrollStripRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const tol = 2;
    const canLeft = el.scrollLeft > tol;
    const canRight = el.scrollLeft < maxScroll - tol;
    if (
      canLeft !== this.state.canScrollTabLeft ||
      canRight !== this.state.canScrollTabRight
    ) {
      this.setState({
        canScrollTabLeft : canLeft,
        canScrollTabRight : canRight,
      });
    }
  };

  scrollTabsLeft = () => {
    const el = this.m_ScrollStripRef.current;
    if (!el) return;
    const step = Math.max(80, Math.floor(el.clientWidth * 0.45));
    el.scrollLeft -= step;
    requestAnimationFrame(() => this.updateTabStripScrollState());
  };

  scrollTabsRight = () => {
    const el = this.m_ScrollStripRef.current;
    if (!el) return;
    const step = Math.max(80, Math.floor(el.clientWidth * 0.45));
    el.scrollLeft += step;
    requestAnimationFrame(() => this.updateTabStripScrollState());
  };
  
  async invalidate() {
    // Relaunch render()
    this.m_Sheets=await this.m_SpInterface.loadSheetList();
    this.setState({ invalidate : !this.state.invalidate });
  }

  // CallBack with parent in SkTabs
  SetComponentTab = (sTabComponent) => {
    this.m_TabComponent=sTabComponent;
  }

  SetTab = async (sTab) => {
    this.m_Sheet=sTab;
    this.m_TabComponent.SetTab(sTab);
    await this.invalidate();
  }

  ChangeTab = async (sSheet) => {
    this.m_Sheet = sSheet;
    await this.m_SpInterface.setActiveSheet(sSheet);
  }

  addSheet = async () => {
    // Refresh from WASM so Sheet2/Sheet3… reflects the real workbook, not the boot default ["Sheet1"].
    this.m_Sheets = await this.m_SpInterface.loadSheetList();
    const wName = suggestNewSheetName(this.m_Sheets);
    const wActive = this.m_Sheet || this.m_SpInterface.m_UIView?.sheet || "";
    const wIdx = this.m_Sheets.indexOf(wActive);
    // WASM AddSheet inserts before sLeft; pass the next tab to land immediately after the active one.
    const wInsertBefore =
      wIdx >= 0 && wIdx < this.m_Sheets.length - 1 ? this.m_Sheets[wIdx + 1] : "";
    const wOk = await this.m_SpInterface.addSheet(wName, wInsertBefore);
    if (wOk) {
      this.m_Sheet = wName;
      await this.invalidate();
      if (this.m_TabComponent) {
        this.m_TabComponent.SetTab(wName);
      }
      this.scrollSheetTabIntoView(wName);
    }
  }

  openRenameSheet = (sSheet) => {
    const wSheet = typeof sSheet === "string" ? sSheet.trim() : "";
    if (!wSheet) {
      return;
    }
    this.setState({
      inlineRenameSheet: wSheet,
      inlineRenameValue: wSheet,
    }, () => {
      requestAnimationFrame(() => {
        const wScroll = this.m_ScrollStripRef.current;
        if (!wScroll) {
          return;
        }
        const wTab = wScroll.querySelector(`[data-sheet-name="${CSS.escape(wSheet)}"]`);
        wTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    });
  };

  closeRenameSheet = () => {
    this.setState({
      inlineRenameSheet: "",
      inlineRenameValue: "",
    });
  };

  isRenameSheetNameValid(sOldName, sNewName) {
    const wTrim = String(sNewName ?? "").trim();
    if (wTrim.length === 0 || wTrim === sOldName) {
      return false;
    }
    return !this.m_Sheets.includes(wTrim);
  }

  commitInlineRename = async () => {
    const wOld = this.state.inlineRenameSheet;
    const wName = String(this.state.inlineRenameValue ?? "").trim();
    if (!wOld) {
      this.closeRenameSheet();
      return;
    }
    if (!this.isRenameSheetNameValid(wOld, wName)) {
      this.closeRenameSheet();
      return;
    }
    this.closeRenameSheet();
    const wOk = await this.m_SpInterface.renameSheet(wOld, wName);
    if (wOk) {
      await this.invalidate();
    }
  };

  cancelInlineRename = () => {
    this.closeRenameSheet();
  };

  onInlineRenameChange = (sValue) => {
    this.setState({ inlineRenameValue: sValue });
  };

  deleteSheet = async (sSheet) => {
    const wSheet = sSheet || this.m_Sheet;
    if (this.m_Sheets.length <= 1) {
      return;
    }
    await this.m_SpInterface.deleteSheet(wSheet);
    await this.invalidate();
  }

  sheetIndex(sSheet) {
    return this.m_Sheets.indexOf(sSheet);
  }

  sheetLeftOf(sSheet) {
    const wIndex = this.sheetIndex(sSheet);
    return wIndex > 0 ? this.m_Sheets[wIndex - 1] : "";
  }

  isSheetAlreadyAfter(sDragged, sAfter) {
    const wIndex = this.sheetIndex(sDragged);
    if (wIndex < 0) {
      return true;
    }
    const wCurrentAfter = wIndex > 0 ? this.m_Sheets[wIndex - 1] : "";
    return wCurrentAfter === (sAfter ?? "");
  }

  consumeTabClickSuppress = () => {
    if (!this.m_SuppressTabClick) {
      return false;
    }
    this.m_SuppressTabClick = false;
    return true;
  };

  bindTabDragSession = () => {
    document.addEventListener("pointermove", this.onTabPointerMove);
    document.addEventListener("pointerup", this.onTabPointerUp);
    document.addEventListener("pointercancel", this.onTabPointerUp);
  };

  unbindTabDragSession = () => {
    document.removeEventListener("pointermove", this.onTabPointerMove);
    document.removeEventListener("pointerup", this.onTabPointerUp);
    document.removeEventListener("pointercancel", this.onTabPointerUp);
  };

  onTabPointerDown = (event, sSheet) => {
    if (this.state.inlineRenameSheet) {
      return;
    }
    if (this.m_Sheets.length <= 1) {
      return;
    }
    this.endTabDragSession(false);
    this.m_TabDragPending = {
      sheet: sSheet,
      tabEl: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
    };
    this.m_TabDragDidMove = false;
    // Do not capture pointer here — it breaks double-click rename on the tab.
    this.bindTabDragSession();
  };

  onTabDoubleClick = (sSheet) => {
    this.endTabDragSession(false);
    this.openRenameSheet(sSheet);
  };

  createTabDragClone = (sTabEl, sClientX) => {
    this.removeTabDragClone();
    if (!sTabEl || typeof document === "undefined") {
      return;
    }
    const wRect = sTabEl.getBoundingClientRect();
    const wClone = sTabEl.cloneNode(true);
    wClone.classList.add("SkSpSheetTab-dragClone");
    wClone.classList.remove("SkTab-list-item--dragging");
    wClone.querySelector(".SkTab-menuBtn")?.remove();
    wClone.setAttribute("aria-hidden", "true");
    wClone.style.width = `${wRect.width}px`;
    wClone.style.height = `${wRect.height}px`;
    document.body.appendChild(wClone);
    this.m_TabDragClone = wClone;
    this.m_TabDragOffset = {
      x: sClientX - wRect.left,
    };
    this.m_TabDragLockedTop = wRect.top;
    this.updateTabDragClonePosition(sClientX);
    document.body.style.cursor = "grabbing";
  };

  updateTabDragClonePosition = (sClientX) => {
    const wClone = this.m_TabDragClone;
    const wOffset = this.m_TabDragOffset;
    const wScrollEl = this.m_ScrollStripRef.current;
    if (!wClone || !wOffset || this.m_TabDragLockedTop == null) {
      return;
    }
    const wStripRect = wScrollEl?.getBoundingClientRect();
    let wLeft = sClientX - wOffset.x;
    if (wStripRect) {
      const wWidth = wClone.offsetWidth || 0;
      wLeft = Math.max(wStripRect.left, Math.min(wLeft, wStripRect.right - wWidth));
    }
    wClone.style.left = `${wLeft}px`;
    wClone.style.top = `${this.m_TabDragLockedTop}px`;
  };

  removeTabDragClone = () => {
    if (this.m_TabDragClone?.parentNode) {
      this.m_TabDragClone.parentNode.removeChild(this.m_TabDragClone);
    }
    this.m_TabDragClone = null;
    this.m_TabDragOffset = null;
    this.m_TabDragLockedTop = null;
    if (typeof document !== "undefined") {
      document.body.style.cursor = "";
    }
  };

  computeTabInsertIndex = (clientX) => {
    const wScrollEl = this.m_ScrollStripRef.current;
    const wDragged = this.m_TabDragPending?.sheet;
    if (!wScrollEl || !wDragged) {
      return 0;
    }
    const wOrder = this.state.tabPreviewOrder || this.m_Sheets;
    const wOthers = wOrder.filter((name) => name !== wDragged);
    const wTabEls = wScrollEl.querySelectorAll(".SkTab-list-item:not(.SkTab-list-item--dragging)");
    let wInsertAt = 0;
    for (let wI = 0; wI < wTabEls.length; wI++) {
      const wRect = wTabEls[wI].getBoundingClientRect();
      const wMid = wRect.left + wRect.width / 2;
      if (clientX >= wMid) {
        wInsertAt = wI + 1;
      }
    }
    return Math.max(0, Math.min(wInsertAt, wOthers.length));
  };

  updateTabPreviewOrder = (clientX) => {
    const wDragged = this.m_TabDragPending?.sheet;
    if (!wDragged) {
      return;
    }
    const wOrder = this.state.tabPreviewOrder || this.m_Sheets;
    const wOthers = wOrder.filter((name) => name !== wDragged);
    const wInsertAt = this.computeTabInsertIndex(clientX);
    const wNewOrder = [...wOthers];
    wNewOrder.splice(wInsertAt, 0, wDragged);
    const wSame =
      wNewOrder.length === wOrder.length &&
      wNewOrder.every((name, index) => name === wOrder[index]);
    if (wSame) {
      return;
    }
    this.setState({ tabPreviewOrder: wNewOrder });
  };

  autoScrollTabStrip = (clientX) => {
    const wEl = this.m_ScrollStripRef.current;
    if (!wEl) {
      return;
    }
    const wRect = wEl.getBoundingClientRect();
    const wMargin = 48;
    if (clientX < wRect.left + wMargin) {
      wEl.scrollLeft -= 14;
    } else if (clientX > wRect.right - wMargin) {
      wEl.scrollLeft += 14;
    }
    requestAnimationFrame(() => this.updateTabStripScrollState());
  };

  onTabPointerMove = (event) => {
    if (!this.m_TabDragPending) {
      return;
    }
    const wDx = event.clientX - this.m_TabDragPending.startX;
    const wDy = event.clientY - this.m_TabDragPending.startY;
    if (!this.m_TabDragDidMove) {
      if (Math.hypot(wDx, wDy) < 6) {
        return;
      }
      this.m_TabDragDidMove = true;
      this.m_TabDragFromIndex = this.sheetIndex(this.m_TabDragPending.sheet);
      const wSheet = this.m_TabDragPending.sheet;
      if (wSheet && wSheet !== this.m_Sheet) {
        void this.ChangeTab(wSheet);
      }
      this.m_TabComponent?.SetTab(wSheet);
      try {
        this.m_TabDragPending.tabEl?.setPointerCapture(this.m_TabDragPending.pointerId);
      } catch (_error) {
        /* best effort */
      }
      this.createTabDragClone(this.m_TabDragPending.tabEl, event.clientX);
      this.setState({
        tabDragging: this.m_TabDragPending.sheet,
        tabPreviewOrder: this.m_Sheets.slice(),
      });
    }
    this.updateTabDragClonePosition(event.clientX);
    this.updateTabPreviewOrder(event.clientX);
    this.autoScrollTabStrip(event.clientX);
  };

  endTabDragSession = (sCommit) => {
    this.unbindTabDragSession();
    this.removeTabDragClone();
    const wPending = this.m_TabDragPending;
    if (wPending?.tabEl) {
      try {
        if (wPending.tabEl.hasPointerCapture(wPending.pointerId)) {
          wPending.tabEl.releasePointerCapture(wPending.pointerId);
        }
      } catch (_error) {
        /* best effort */
      }
    }
    const wPreviewOrder = this.state.tabPreviewOrder;
    const wDidMove = this.m_TabDragDidMove;
    const wFromIndex = this.m_TabDragFromIndex;
    this.m_TabDragPending = null;
    this.m_TabDragDidMove = false;
    this.m_TabDragFromIndex = undefined;
    this.setState({ tabDragging: null, tabPreviewOrder: null });
    if (wDidMove) {
      this.m_SuppressTabClick = true;
    }
    if (sCommit && wDidMove && wPending && wPreviewOrder) {
      void this.commitTabDrag(wPending.sheet, wPreviewOrder, wFromIndex);
    }
  };

  onTabPointerUp = () => {
    this.endTabDragSession(true);
  };

  commitTabDrag = async (sDragged, sPreviewOrder, sFromIndex) => {
    if (!sDragged || !Array.isArray(sPreviewOrder)) {
      return;
    }
    const wToIndex = sPreviewOrder.indexOf(sDragged);
    if (wToIndex < 0 || wToIndex === sFromIndex) {
      return;
    }
    const wAfter = wToIndex === 0 ? "" : sPreviewOrder[wToIndex - 1];
    if (this.isSheetAlreadyAfter(sDragged, wAfter)) {
      return;
    }
    const wOk = await this.m_SpInterface.swapSheet(sDragged, wAfter, { insertAfter: true });
    if (wOk) {
      await this.invalidate();
    }
  };

  openSheetListMenu = (event) => {
    event.stopPropagation();
    this.closeTabContextMenu();
    const wRect = event.currentTarget.getBoundingClientRect();
    this.m_RefSheetListMenu.current?.SetPosAnchor(wRect, { gap: 4 });
    this.setState({ sheetListMenuOpen: true });
  };

  closeSheetListMenu = () => {
    this.setState({ sheetListMenuOpen: false });
  };

  openTabContextMenu = (event, sSheet) => {
    event.stopPropagation();
    this.closeSheetListMenu();
    const wTabEl = event.currentTarget.closest(".SkTab-list-item");
    const wRect = (wTabEl || event.currentTarget).getBoundingClientRect();
    this.m_RefTabContextMenu.current?.SetPosAnchor(wRect, { gap: 4 });
    this.setState({
      tabContextMenuOpen: true,
      contextSheetName: sSheet,
    });
  };

  closeTabContextMenu = () => {
    this.setState({ tabContextMenuOpen: false, contextSheetName: "" });
  };

  selectSheetFromList = async (_event, sSheet) => {
    this.closeSheetListMenu();
    if (sSheet && sSheet !== this.m_Sheet) {
      await this.ChangeTab(sSheet);
      if (this.m_TabComponent) {
        this.m_TabComponent.SetTab(sSheet);
      }
      // Refresh the strip highlight and scroll the picked sheet into view: it may be off-screen
      // in the tab strip (unlike a direct tab click), so otherwise the selection stays hidden.
      await this.invalidate();
      this.scrollSheetTabIntoView(sSheet);
    }
  };

  scrollSheetTabIntoView = (sSheet) => {
    const wSheet = typeof sSheet === "string" ? sSheet.trim() : "";
    if (!wSheet) {
      return;
    }
    requestAnimationFrame(() => {
      const wScroll = this.m_ScrollStripRef.current;
      if (!wScroll) {
        return;
      }
      const wTab = wScroll.querySelector(
        `[data-sheet-name="${CSS.escape(wSheet)}"]`
      );
      wTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  };

  handleContextRename = (sSheet) => {
    const wSheet = String(sSheet ?? this.state.contextSheetName ?? "").trim();
    if (!wSheet) {
      return;
    }
    this.setState({
      tabContextMenuOpen: false,
      contextSheetName: "",
    });
    // Defer until after menu mousedown/mouseup so the rename input is not immediately blurred.
    window.setTimeout(() => {
      this.openRenameSheet(wSheet);
    }, 0);
  };

  handleContextDelete = async () => {
    const wSheet = this.state.contextSheetName;
    this.closeTabContextMenu();
    await this.deleteSheet(wSheet);
  };

  handleContextMoveLeft = async () => {
    const wSheet = this.state.contextSheetName;
    const wIndex = this.sheetIndex(wSheet);
    if (wIndex <= 0) {
      return;
    }
    this.closeTabContextMenu();
    await this.m_SpInterface.swapSheet(wSheet, this.m_Sheets[wIndex - 1]);
    await this.invalidate();
  };

  handleContextMoveRight = async () => {
    const wSheet = this.state.contextSheetName;
    const wIndex = this.sheetIndex(wSheet);
    if (wIndex < 0 || wIndex >= this.m_Sheets.length - 1) {
      return;
    }
    this.closeTabContextMenu();
    await this.m_SpInterface.swapSheet(wSheet, this.m_Sheets[wIndex + 1]);
    await this.invalidate();
  };

  renderSheetListMenu() {
    return (
      <SkMenuPopUp
        ref={this.m_RefSheetListMenu}
        Visible={this.state.sheetListMenuOpen}
        onClose={this.closeSheetListMenu}
      >
        <div className="SkMenuHeader">All sheets</div>
        {this.m_Sheets.map((wSheet) => (
          <SkMenuElement
            key={wSheet}
            id={wSheet}
            onSelect={this.selectSheetFromList}
            title={wSheet}
          >
            <span className={wSheet === this.m_Sheet ? "SkSpSheetTab-menuActive" : ""}>
              {wSheet}
            </span>
          </SkMenuElement>
        ))}
      </SkMenuPopUp>
    );
  }

  renderTabContextMenu() {
    const wSheet = this.state.contextSheetName;
    const wIndex = this.sheetIndex(wSheet);
    const wCanDelete = this.m_Sheets.length > 1;
    const wCanMoveLeft = wIndex > 0;
    const wCanMoveRight = wIndex >= 0 && wIndex < this.m_Sheets.length - 1;

    const wDisabledItem = (label) => (
      <div key={label} className="SkMenuElement SkMenuElement--disabled SkWidth100">
        {label}
      </div>
    );

    return (
      <SkMenuPopUp
        ref={this.m_RefTabContextMenu}
        Visible={this.state.tabContextMenuOpen}
        onClose={this.closeTabContextMenu}
      >
        <SkMenuElement
          id="rename"
          onSelect={() => this.handleContextRename(wSheet)}
          title="Rename"
        >
          Rename
        </SkMenuElement>
        {wCanDelete ? (
          <SkMenuElement id="delete" onSelect={this.handleContextDelete} title="Delete">
            Delete
          </SkMenuElement>
        ) : (
          wDisabledItem("Delete")
        )}
        <div className="SkMenuWindow-separator" />
        {wCanMoveLeft ? (
          <SkMenuElement id="move-left" onSelect={this.handleContextMoveLeft} title="Move left">
            Move left
          </SkMenuElement>
        ) : (
          wDisabledItem("Move left")
        )}
        {wCanMoveRight ? (
          <SkMenuElement id="move-right" onSelect={this.handleContextMoveRight} title="Move right">
            Move right
          </SkMenuElement>
        ) : (
          wDisabledItem("Move right")
        )}
      </SkMenuPopUp>
    );
  }

  handleLangSelect = async (event) => {
    const wLang = event.target.value;
    if (wLang === this.state.activeLang) {
      return;
    }
    await applySpreadsheetLang(this.m_SpInterface, wLang);
    await loadFormatCatalog();
  };

  render() {
    const wStyleSvg = {
      marginTop:"6px",
      width:"20px",
      height:"20px",
    }
    return (
      <div ref={this.m_Ref}  className="SkSpSheetTab">
      {this.renderSheetListMenu()}
      {this.renderTabContextMenu()}
      <div title="Add sheet" onClick={this.addSheet}>
        <SvgPlus className="SkSvg" style={wStyleSvg} />
      </div>
      <div
        className="SkSpSheetTab-allSheetsBtn"
        title="All sheets"
        role="button"
        tabIndex={0}
        onClick={this.openSheetListMenu}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            const wRect = e.currentTarget.getBoundingClientRect();
            this.closeTabContextMenu();
            this.m_RefSheetListMenu.current?.SetPosAnchor(wRect, { gap: 4 });
            this.setState({ sheetListMenuOpen: true });
          }
        }}
      >
        <SvgMenu className="SkSvg" style={wStyleSvg} />
      </div>
      {/* Scrollable tabs; both scroll chevrons grouped on the right */}
      <div className="SkSpSheetTab-strip">
      <div
        ref={this.m_ScrollStripRef}
        className={
          "SkSpSheetTab-scroll" +
          (this.state.tabDragging ? " SkSpSheetTab-scroll--dragging" : "")
        }
        onScroll={this.updateTabStripScrollState}
      >
      <SkTabs
        Parent={this}
        onChange={this.ChangeTab}
        onDoubleClick={this.onTabDoubleClick}
        onTabMenuClick={this.openTabContextMenu}
        onTabPointerDown={this.onTabPointerDown}
        tabDragging={this.state.tabDragging}
        inlineRenameSheet={this.state.inlineRenameSheet}
        inlineRenameValue={this.state.inlineRenameValue}
        onInlineRenameChange={this.onInlineRenameChange}
        onInlineRenameCommit={this.commitInlineRename}
        onInlineRenameCancel={this.cancelInlineRename}
        position="bottom"
        hideTabPanel
        activeTab="styles"
        defaultActiveKey="profile"
        id="uncontrolled-tab-example"
      >
      {(this.state.tabPreviewOrder || this.m_Sheets).map((wChild) => {
            return (
              <SkTab
                key={wChild}
                label={wChild}
              />
            );
          })}
      </SkTabs>
      </div>
      <div className="SkSpSheetTab-scrollNavGroup">
      <div
        className={
          "SkSpSheetTab-scrollNav" +
          (this.state.canScrollTabLeft ? "" : " SkSpSheetTab-scrollNav--disabled")
        }
        title="Previous sheets"
        role="button"
        tabIndex={0}
        onClick={this.state.canScrollTabLeft ? this.scrollTabsLeft : undefined}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && this.state.canScrollTabLeft) {
            e.preventDefault();
            this.scrollTabsLeft();
          }
        }}
      >
        <SvgAngleLeft
          className={
            "SkSvg" +
            (this.state.canScrollTabLeft ? "" : " disabled")
          }
          style={wStyleSvg}
        />
      </div>
      <div
        className={
          "SkSpSheetTab-scrollNav" +
          (this.state.canScrollTabRight ? "" : " SkSpSheetTab-scrollNav--disabled")
        }
        title="Next sheets"
        role="button"
        tabIndex={0}
        onClick={this.state.canScrollTabRight ? this.scrollTabsRight : undefined}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && this.state.canScrollTabRight) {
            e.preventDefault();
            this.scrollTabsRight();
          }
        }}
      >
        <SvgAngleRight
          className={
            "SkSvg" +
            (this.state.canScrollTabRight ? "" : " disabled")
          }
          style={wStyleSvg}
        />
      </div>
      </div>
      </div>
      <div className="SkSpSheetTab-status">
        <SkSpZoomControl SpInterface={this.m_SpInterface} />
        <select
          className="SkSpSheetTab-langSelect"
          value={this.state.activeLang}
          onChange={this.handleLangSelect}
          title="Language"
          aria-label="Language"
        >
          {SPREADSHEET_LANGS.map((lang) => (
            <option key={lang.id} value={lang.id}>
              {lang.label}
            </option>
          ))}
        </select>
      </div>
      </div>);
  }
}
// ========================================

export default SkSpSheetTab;