//=============================================================================
// SkSpreadSheet
// SpreadSheet Sker
//=============================================================================
import React from "react";
import SkComponent from "../component/SkComponent.js";
import './SkSpreadSheet.css'
import SkSpInterface from './SkSpInterface.js'
import SkSpTopPanel from "./SkSpTopPanel.js";
import SkSpControlPanel from "./SkSpControlPanel.js";
import SkSpSheetTab from "./SkSpSheetTab.js";
import SkSpClient from "./SkSpClient.js";
import SkSpTopCommand from "./SkSpTopCommand.js";
import SkSpCommand from "./SkSpCommand.js";
import SkLoadingSpinner from "../component/SkLoadingSpinner.js";
import { runCooperativeRecalculateAll, isCooperativeRecalcAvailable, SK_RECALC_UI_DELAY_MS, SK_RECALC_PROGRESS_POLL_MS } from "./SkCooperativeRecalc.js";
import { runCooperativePressure } from "./SkCooperativePressure.js";
import SkAboutModal from "../component/SkAboutModal.js";
import SkKeyboardShortcutsModal from "../component/SkKeyboardShortcutsModal.js";
import { setActiveFilePath, syncSpreadsheetSession, getSpreadsheetSession, clearSpreadsheetSession } from '../SkActiveFile.js';
import { showError, showConfirm } from '../skDialog.js';
import { checkWasmVersion } from './SkWasmVersionCheck.js';
import {
  getRibbonVisible,
  subscribeRibbonVisible,
} from './SkRibbonVisible.js';
import { applySpreadsheetLang, getSpreadsheetLang } from './SkeeptoLang.js';
import { fetchWorkbookJsonAndOpenOnServer } from './SkeeptoServerApi.js';
import { isDesktop, getDesktopBridge } from '../desktop/SkDesktopMode.js';
import { rememberWorkbookDiskPath } from '../desktop/SkDesktopBridge.js';
import { debugFormatOnServer } from './SkDebugFormatServer.js';
import { loadFormatCatalog, applyNumberFormatByIndex } from './SkNumberFormatMenu.js';
import {
  toggleBold,
  toggleItalic,
  toggleUnderline,
  toggleStrikethrough,
} from './SkCellTextFormat.js';


class SkSpreadSheet extends SkComponent {
  constructor(props) {
      super(props);
      this.m_SpInterface=new SkSpInterface();
      this.m_SpInterface.m_SkSpreadSheet=this;
     
      window.SkSpreadSheet=this; // for invalidate after Load Wasm
      const pendingSession = getSpreadsheetSession();
      this.state = ({ 
        invalidate : false,
        rightPanelWidth: 0,
        didMount: false,
        loadingFile: Boolean(pendingSession?.path),
        openingFileName: pendingSession?.name || 'Workbook',
        recalculating: false,
        recalcUiVisible: false,
        recalcProgress: 0,
        recalcOpLabel: "Recalculating",
        recalcFinalizing: false,
        error: null,
        ribbonVisible: getRibbonVisible(),
        aboutModalOpen: false,
        shortcutsModalOpen: false,
      })
   
      this.startX = React.createRef();
      this.startWidth = React.createRef();
      this.rightPanel = React.createRef();
      this.rightCommandRef = React.createRef();
      this.resizeHandle = React.createRef();
      this.isResizing = false;

      // Prevent duplicate asynchronous initialization sequences.
      this._readyPromise = null;
      this._readyDone = false;

      // Cooperative recalc driven off the input path (F9 and value edits share this).
      // A monotonic generation lets a newer edit supersede an in-flight recalc loop.
      this._recalcGen = 0;
      this._recalcActive = false;
      this._recalcTimer = null;
      this._recalcPromise = null;
  }

  // Execute one spreadsheet menu action from the top app menu.
  async applyMenuUnit(family, unitKey) {
    this.m_SpInterface.setExtraUndo();
    const ref = this.m_SpInterface.selectstr();
    window.SkUISpreadSheet.applyUnit(ref, family, unitKey);
    await this.m_SpInterface.reloadView();
  }

  async applyMenuLang(langId) {
    await applySpreadsheetLang(this.m_SpInterface, langId);
    await loadFormatCatalog();
  }

  async handleSpreadsheetMenuAction(actionId) {
    if (!actionId || !this.m_SpInterface) return;
    try {
      await this.waitForSpreadSheetReady();
      const wUnitMatch = /^unit:([^:]+):(.+)$/.exec(actionId);
      if (wUnitMatch) {
        await this.applyMenuUnit(wUnitMatch[1], wUnitMatch[2]);
        return;
      }
      const wLangMatch = /^lang:(.+)$/.exec(actionId);
      if (wLangMatch) {
        await this.applyMenuLang(wLangMatch[1]);
        return;
      }
      const wFormatMatch = /^format:apply:(\d+)$/.exec(actionId);
      if (wFormatMatch) {
        await applyNumberFormatByIndex(this.m_SpInterface, parseInt(wFormatMatch[1], 10));
        return;
      }
      switch (actionId) {
        case 'undo':
          await this.m_SpInterface.undo();
          break;
        case 'redo':
          await this.m_SpInterface.redo();
          break;
        case 'copy':
          await this.m_SpInterface.copy();
          break;
        case 'cut':
          await this.m_SpInterface.cut();
          break;
        case 'paste':
          await this.m_SpInterface.paste();
          break;
        case 'clear':
          await this.m_SpInterface.raz();
          break;
        case 'format-clear':
          await this.m_SpInterface.razFormat();
          break;
        case 'find-text':
          this.openRightPanelTab('Find');
          break;
        case 'insert-row':
          // Select the entire row(s) spanned by the first selection, then insert.
          this.m_SpInterface.selectAllRow();
          await this.m_SpInterface.insertRow();
          break;
        case 'insert-column':
          // Select the entire column(s) spanned by the first selection, then insert.
          this.m_SpInterface.selectAllColumn();
          await this.m_SpInterface.insertCol();
          break;
        case 'format-conditional':
          this.openRightPanelTab('Conditional');
          break;
        case 'format-print':
          this.openRightPanelTab('Print');
          break;
        case 'format-font':
          this.openRightPanelTab('Font & Material Color');
          break;
        case 'format-bold':
          await toggleBold(this.m_SpInterface);
          break;
        case 'format-italic':
          await toggleItalic(this.m_SpInterface);
          break;
        case 'format-underline':
          await toggleUnderline(this.m_SpInterface);
          break;
        case 'format-strikethrough':
          await toggleStrikethrough(this.m_SpInterface);
          break;
        case 'format-borders':
          this.openRightPanelTab('Border');
          break;
        case 'help-about':
          this.setState({ aboutModalOpen: true });
          break;
        case 'help-shortcuts':
          this.setState({ shortcutsModalOpen: true });
          break;
        case 'named-ranges':
          this.openRightPanelTab('Named ranges');
          break;
        case 'sheet-create-table': {
          const wResult = await this.m_SpInterface.createTableFromSelection();
          if (!wResult?.ok) {
            console.warn('Create table:', wResult?.error || 'failed');
            break;
          }
          this.openRightPanelTab('Tables');
          break;
        }
        case 'sheet-tables':
          this.openRightPanelTab('Tables');
          break;
        case 'named-formulas':
          this.openRightPanelTab('Named formulas');
          break;
        case 'tools-class':
          this.openRightPanelTab('Class');
          break;
        case 'tools-function':
          this.openRightPanelTab('Function');
          break;
        case 'show-function':
          this.openRightPanelTab('Insert function');
          break;
        case 'tools-attribute':
          this.openRightPanelTab('Attribute');
          break;
        case 'tools-unit':
          this.openRightPanelTab('Unit');
          break;
        case 'tools-chat':
          this.openRightPanelTab('Chat');
          break;
        case 'tools-ai-assistant':
          this.openRightPanelTab('AI Assistant');
          break;
        case 'tools-debug':
          this.openRightPanelTab('Debug');
          break;
        case 'debug-format-server':
          await this.debugFormatOnServer();
          break;
        case 'view-split-cursor-row':
          await this.m_SpInterface.applyVerticalSplitAtCursorRow();
          break;
        case 'view-split-cursor-col':
          await this.m_SpInterface.applyHorizontalSplitAtCursorCol();
          break;
        case 'view-no-split':
          await this.m_SpInterface.clearFrozenSplit();
          break;
        case 'view-grid-lines':
          this.m_SpInterface.m_GridVisible = !this.m_SpInterface.m_GridVisible;
          this.m_SpInterface.invalidateAll();
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('skViewMenuRefresh'));
          }
          break;
        case 'recalculate-all':
          await this.runRecalculateAll();
          break;
        default:
          if (typeof actionId === 'string' && actionId.startsWith('view-zoom-')) {
            const wPercent = Number(actionId.slice('view-zoom-'.length));
            if ([50, 75, 90, 100, 125, 150, 200].includes(wPercent)) {
              this.m_SpInterface.m_Zoom = wPercent / 100;
              this.m_SpInterface.applyZoom();
              this.m_SpInterface.reloadView();
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('skViewMenuRefresh'));
              }
            }
            break;
          }
          console.warn(`Spreadsheet menu action not implemented yet: ${actionId}`);
          break;
      }
    } catch (error) {
      console.error(`Failed to execute spreadsheet menu action "${actionId}"`, error);
    }
  }

  async consumePendingMenuAction() {
    const actionId = sessionStorage.getItem('SkPendingMenuAction');
    if (!actionId) return;
    sessionStorage.removeItem('SkPendingMenuAction');
    await this.handleSpreadsheetMenuAction(actionId);
  }

  /** Manual full recalc (menu Data or F9); cooperative WASM steps keep the UI responsive. */
  beginRecalcTracking = (label = "Recalculating") => {
    if (this._recalcUiTimer != null) {
      clearTimeout(this._recalcUiTimer);
      this._recalcUiTimer = null;
    }
    this.setState({
      recalculating: true,
      recalcUiVisible: false,
      recalcProgress: 0,
      recalcOpLabel: label,
      recalcFinalizing: false,
    });
    this._recalcUiTimer = setTimeout(() => {
      this._recalcUiTimer = null;
      if (this.state.recalculating) {
        this.setState({ recalcUiVisible: true });
      }
    }, SK_RECALC_UI_DELAY_MS);
  };

  updateRecalcProgress = (wPercent) => {
    const wRounded = Math.round(wPercent);
    this.setState((prev) =>
      prev.recalcProgress === wRounded ? null : { recalcProgress: wRounded },
    );
  };

  endRecalcTracking = () => {
    if (this._recalcUiTimer != null) {
      clearTimeout(this._recalcUiTimer);
      this._recalcUiTimer = null;
    }
    this.setState({
      recalculating: false,
      recalcUiVisible: false,
      recalcProgress: 0,
      recalcOpLabel: "Recalculating",
      recalcFinalizing: false,
    });
  };

  /**
   * Drive the cooperative recalc session already active in WASM to completion, off the
   * input path (time-budgeted steps that yield to the browser between calls). A monotonic
   * generation supersedes any previously running loop, so a newer edit or F9 can take over
   * cleanly. Resolves when this generation finishes or is superseded.
   */
  _driveCooperativeRecalc = () => {
    const wUi = window.SkUISpreadSheet;
    const wGen = ++this._recalcGen;
    if (this._recalcTimer != null) {
      clearTimeout(this._recalcTimer);
      this._recalcTimer = null;
    }
    this._recalcActive = true;
    this.beginRecalcTracking();
    // recalculateAllCooperativeProgress() is O(n) in the engine; throttle the
    // query so huge recalcs (millions of cells) aren't dominated by it and the
    // % keeps moving instead of appearing stuck (see SK_RECALC_PROGRESS_POLL_MS).
    let wLastPollAt = 0;
    const wPollProgress = (force) => {
      const wNow = Date.now();
      if (!force && wNow - wLastPollAt < SK_RECALC_PROGRESS_POLL_MS) return;
      wLastPollAt = wNow;
      this.updateRecalcProgress(wUi.recalculateAllCooperativeProgress());
    };
    wPollProgress(true);

    const wPromise = new Promise((resolve) => {
      const wFinish = async () => {
        try {
          await this.m_SpInterface.reloadViewAfterSpreadsheetMutation();
        } catch (wErr) {
          console.error("Recalc view refresh failed", wErr);
        } finally {
          if (wGen === this._recalcGen) {
            this._recalcActive = false;
            this._recalcPromise = null;
            this.endRecalcTracking();
          }
          resolve();
        }
      };
      const wTick = () => {
        this._recalcTimer = null;
        if (wGen !== this._recalcGen) {
          // Superseded by a newer edit/F9; that loop now owns the banner.
          resolve();
          return;
        }
        let wDone = false;
        try {
          wDone = wUi.stepRecalculateAllCooperative(8);
        } catch (wErr) {
          console.error("Recalc step failed", wErr);
          wDone = true;
        }
        if (wGen !== this._recalcGen) {
          resolve();
          return;
        }
        if (wDone) {
          this.updateRecalcProgress(100);
          this.setState({ recalcFinalizing: true });
          // Paint 100% / "finalizing" before the blocking JsonView reload.
          requestAnimationFrame(() => {
            wFinish();
          });
          return;
        }
        wPollProgress(false);
        this._recalcTimer = setTimeout(wTick, 0);
      };
      this._recalcTimer = setTimeout(wTick, 0);
    });
    this._recalcPromise = wPromise;
    return wPromise;
  };

  /**
   * Resolve once no background recalc is in flight, so callers (e.g. save/serialization)
   * observe a fully consistent model. Drains successive generations (an escalation to a
   * full recalc replaces the pending promise) with a guard against runaway loops.
   */
  waitForRecalcIdle = async () => {
    let wGuard = 0;
    while (this._recalcPromise != null && wGuard < 100000) {
      wGuard += 1;
      await this._recalcPromise;
    }
  };

  /** Stop an in-flight cooperative recalc before tearing down WASM (leave / unmount). */
  cancelCooperativeRecalc = () => {
    this._recalcGen += 1;
    this._recalcActive = false;
    this._recalcPromise = null;
    if (this._recalcTimer != null) {
      clearTimeout(this._recalcTimer);
      this._recalcTimer = null;
    }
    if (this._recalcUiTimer != null) {
      clearTimeout(this._recalcUiTimer);
      this._recalcUiTimer = null;
    }
    try {
      const wUi = window.SkUISpreadSheet;
      if (wUi?.isRecalculateAllCooperativeActive?.()) {
        // Enabling cooperative mode cancels the current WASM session (see SetCooperativeCalculateEnabled).
        wUi.setCooperativeCalculateEnabled(true);
        wUi.setCooperativeCalculateEnabled(false);
      }
    } catch (wErr) {
      console.warn('cancelCooperativeRecalc: WASM cancel failed', wErr);
    }
  };

  /**
   * Commit a cell mutation, then recalc its dependents in the background so the caller
   * regains control immediately (F9-style). Returns the mutation's success synchronously,
   * before the recalc runs. When a recalc from a previous edit (or F9) is still running, it
   * is cancelled and escalated to a full workbook recalc so no dependent is left stale.
   */
  commitValueWithBackgroundRecalc = (applyMutation) => {
    const wUi = window.SkUISpreadSheet;
    if (!isCooperativeRecalcAvailable() || wUi == null) {
      return applyMutation() === true;
    }
    const wWasRunning = this._recalcActive === true || this._recalcRunning === true;
    // Cooperative mode makes the WASM write build the dependent graph without calculating;
    // enabling it also cancels any stale WASM session.
    wUi.setCooperativeCalculateEnabled(true);
    let wOk = false;
    try {
      wOk = applyMutation() === true;
    } finally {
      wUi.setCooperativeCalculateEnabled(false);
    }
    if (!wOk) {
      return false;
    }
    if (wWasRunning) {
      // We interrupted an in-flight recalc: escalate to a full recalc for consistency.
      wUi.beginRecalculateAllCooperative();
    }
    if (wUi.isRecalculateAllCooperativeActive()) {
      // Fire-and-forget: do not await, so the edit handler returns control at once.
      this._driveCooperativeRecalc();
    }
    return true;
  };

  runRecalculateAll = async () => {
    if (this._recalcRunning) {
      return;
    }
    this._recalcRunning = true;
    try {
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      await this.waitForSpreadSheetReady();
      if (isCooperativeRecalcAvailable()) {
        // Build the full-workbook graph, then drive it off the input path.
        window.SkUISpreadSheet.beginRecalculateAllCooperative();
        await this._driveCooperativeRecalc();
      } else {
        this.beginRecalcTracking();
        try {
          await runCooperativeRecalculateAll({
            budgetMs: 8,
            onProgress: this.updateRecalcProgress,
          });
          await this.m_SpInterface.reloadViewAfterSpreadsheetMutation();
        } finally {
          this.endRecalcTracking();
        }
      }
    } catch (error) {
      console.error("Recalculate all failed", error);
    } finally {
      this._recalcRunning = false;
    }
  };

  /**
   * Debug _Pressure with a live progress % in the same recalc banner.
   * Generation runs in cooperative WASM steps (non-blocking); the JsonEnd finalize
   * (batch compile + cold calculate) stays a single blocking call.
   */
  runPressure = async (rows, cols, sheet = "") => {
    if (this._recalcRunning || this.state.recalculating) {
      return;
    }
    this._recalcRunning = true;
    this.beginRecalcTracking("Generating cells");
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    try {
      await this.waitForSpreadSheetReady();
      await runCooperativePressure(rows, cols, {
        sheet,
        rowBudget: 2000,
        onProgress: this.updateRecalcProgress,
        onFinalize: () => this.setState({ recalcFinalizing: true }),
      });
      await this.m_SpInterface.reloadViewAfterSpreadsheetMutation();
    } catch (error) {
      console.error("Pressure failed", error);
    } finally {
      this._recalcRunning = false;
      this.endRecalcTracking();
    }
  };

  debugFormatOnServer = async () => {
    const wResult = await debugFormatOnServer();
    if (!wResult.ok) {
      console.error('[Debug FormatApi]', wResult.error || 'failed');
      return;
    }
    if (wResult.hasFormatCount === false) {
      console.warn(
        '[Debug FormatApi] FormatCount missing on WASM — rebuild SkReactSpreadSheet, sync build/, restart SkServer'
      );
      return;
    }
    console.log(
      wResult.empty
        ? '[Debug FormatApi] empty on all WASM instances (count=0)'
        : `[Debug FormatApi] still has ${wResult.totalCount} format(s)`
    );
  };
  
  // Compare the browser's SkReactSpreadSheet.wasm against the server's build. On a
  // definite mismatch, prompt the user to reload so both sides run the same binary.
  // Fail-open: if the versions cannot be determined, do nothing.
  async verifyWasmVersion() {
    if (this._wasmVersionChecked) {
      return;
    }
    this._wasmVersionChecked = true;
    try {
      const wResult = await checkWasmVersion();
      if (wResult.status !== 'mismatch') {
        return;
      }
      console.warn(
        '[WASM] Build mismatch: client', wResult.client, 'vs server', wResult.server
      );
      // Remember this server hash so opening a sheet again does not loop the dialog.
      // A later deploy (different hash) shows it once more.
      const wAckKey = 'sk_wasm_mismatch_ack';
      try {
        if (localStorage.getItem(wAckKey) === wResult.server) {
          return;
        }
        localStorage.setItem(wAckKey, wResult.server);
      } catch {
        // Private mode: still show the dialog once for this component instance.
      }
      const wReload = await showConfirm({
        title: 'Update required',
        message:
          "A new version of the spreadsheet is available on the server. "
          + "Please reload the page to avoid synchronization errors.",
        detail: 'Reload now?',
        variant: 'warning',
        confirmLabel: 'Reload',
        cancelLabel: 'Later',
      });
      if (wReload) {
        try {
          await Promise.all([
            fetch('/SkReactSpreadSheet.wasm', { cache: 'reload' }),
            fetch('/SkReactSpreadSheet.mjs', { cache: 'reload' }),
          ]);
        } catch {
          // Reload anyway; cache bypass is best-effort.
        }
        window.location.reload();
      }
    } catch (wError) {
      console.error('[WASM] Version check failed:', wError);
    }
  }

  // Call when the SpreadSheet is ready to be used
  ready() {
    if (this._readyDone) {
      return Promise.resolve(true);
    }
    if (this._readyPromise) {
      return this._readyPromise;
    }

    console.log("SkSpreadSheet::ready()");
    // First time only ======================================================
    if (window.ResetSpreadSheet === 1) {
      this.m_SpInterface.loadUI();
      const initPromise = this.m_SpInterface.loadWebAssembly()
        .then(() => {
          console.log("[Main] WebAssembly loaded");
          return this.m_SpInterface.reloadView();
        })
        .catch(error => {
          console.error("[Main] Error in initialization:", error);
          this.setState({
            ready: true,
            error: error.message || 'Loading failed'
          });
        });

      this._readyPromise = Promise.resolve(initPromise).finally(() => {
        this._readyDone = true;
        this._readyPromise = null;
      });
      return this._readyPromise;
    }
    return Promise.resolve(true);
  }
  
  async componentDidMount() {
    //console.log( "SkSpreadSheet::componentDidMount()");
    //console.log("Initial state:", this.state);

    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
    this._unsubscribeRibbon = subscribeRibbonVisible((visible) => {
      this.setState({ ribbonVisible: visible }, () => {
        if (this.m_SpInterface && typeof this.m_SpInterface.reloadView === 'function') {
          this.m_SpInterface.reloadView();
        }
      });
    });
    window.__skerHandleSpreadsheetMenuAction = (actionId) => {
      this.handleSpreadsheetMenuAction(actionId);
    };
    // Desktop: let the native File menu ask us to (re)load from the current session.
    if (isDesktop) {
      window.__skerDesktopLoadFromSession = () => this.checkForVirtualDiskFile();
    }

    // =======================================================================
    const pendingSession = getSpreadsheetSession();
    this.setState({
      ready: false,
      loadingFile: Boolean(pendingSession?.path),
      openingFileName: pendingSession?.name || this.state.openingFileName,
      didMount: true,
      error: null,
    });
    
    try {
     
      // Check whether WASM is already loaded and call ready() if needed
      if (window.ResetSpreadSheet === 1) {
        console.log("WASM already loaded, calling ready() from componentDidMount");
        await this.ready();
      }
      // Initialize UI View
      this.m_SpInterface.m_UIView={
        toprow: 1,
        topcol: 1,
        lastrow: 1,
        lastcol: 1,
        rows: [],
        cols: []
      };
      this.setState({ loadingFile: true });
      const sessionForName = getSpreadsheetSession();
      if (sessionForName?.name) {
        this.setState({ openingFileName: sessionForName.name });
      }
       // Desktop build has no collaboration server: skip chat room / roster.
       if (!isDesktop) {
         // Detect a client/server WASM build mismatch (advisory, non-blocking):
         // replaying ops across mismatched binaries crashes the server instances.
         // Fire-and-forget so the app keeps loading behind the warning.
         this.verifyWasmVersion();
         // Join Chat SpreadSheet
         await this.m_SpInterface.joinChat();
         // Wait for roster then load users
         await this.m_SpInterface.waitRoomUsers();
         await this.m_SpInterface.loadConnectedUsers();
       }

       
      // Check if there's a file to load from Virtual Disk
      const wLoaded = await this.checkForVirtualDiskFile();
      if (wLoaded === false) {
        this.setState({ didMount: true });
        window.ResetSpreadSheet = window.ResetSpreadSheet + 1;
        return;
      }

      await this.waitForSpreadSheetReady();
      await applySpreadsheetLang(this.m_SpInterface, getSpreadsheetLang(), { reload: false });
      await loadFormatCatalog();

      // Set cursor label mode to initials or firstname
      await this.m_SpInterface.setCursorLabelMode('initials');
      await this.consumePendingMenuAction();

       
    } catch (error) {
      console.error("Error loading WebAssembly module:", error);
      this.setState({ 
        error: error.message || 'Failed to load WebAssembly module',
        ready: true,
        didMount: true,
      });
      window.ResetSpreadSheet=window.ResetSpreadSheet+1;
      return;
    }
    this.setState({ didMount: false });
    window.ResetSpreadSheet=window.ResetSpreadSheet+1;
  }
  
  async componentWillUnmount() {
      // Remove duplicate componentWillUnmount - already defined above
    console.log("SkSpreadSheet::componentWillUnmount()");
    this.cancelCooperativeRecalc();
    if (this.m_SpInterface != null) {
      this.m_SpInterface.disposeSpreadsheet();
    }
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);
    if (this._unsubscribeRibbon) {
      this._unsubscribeRibbon();
    }
    if (window.__skerHandleSpreadsheetMenuAction) {
      delete window.__skerHandleSpreadsheetMenuAction;
    }
    if (window.__skerDesktopLoadFromSession) {
      delete window.__skerDesktopLoadFromSession;
    }

    // Notify collaborators that we are leaving the active workbook so that our
    // remote cursor disappears from their view immediately, even if we stay
    // connected to the chat room briefly while teardown completes.
    try {
      if (window.SkUISpreadSheet?.getActiveWorkBook) {
        const wActiveUri = window.SkUISpreadSheet.getActiveWorkBook();
        if (wActiveUri && this.m_SpInterface?.broadcastLeaveWorkBook) {
          await this.m_SpInterface.broadcastLeaveWorkBook(wActiveUri);
        }
      }
    } catch (broadcastError) {
      console.warn('componentWillUnmount: broadcastLeaveWorkBook failed', broadcastError);
    }

    // Leave Chat SpreadSheet
    this.m_SpInterface?.leaveChat?.();

    // Remove Workbook in memory ===========================
    const wFileData = getSpreadsheetSession();

    if (window.SkUISpreadSheet?.jsonWorkBooks) {
      try {
        const wWorkBooksStr = window.SkUISpreadSheet.jsonWorkBooks();
        const wWorkBooks = JSON.parse(wWorkBooksStr);
        console.log('wWorkBooks', wWorkBooks);
        console.log('wFileData', wFileData);
      } catch (jsonError) {
        console.warn('componentWillUnmount: jsonWorkBooks failed', jsonError);
      }
    }

    // Drop every in-memory workbook (an empty leftover + the loaded file is common
    // after the first ready()/loadWorkBook). Leaving one behind makes the next open
    // hit SumPixelHeight divide-by-zero on a sheet with no layout.
    try {
      const wUris = window.SkUISpreadSheet?.listWorkBookUris?.() || [];
      for (const wUri of wUris) {
        if (this.m_SpInterface?.deleteWorkBook) {
          await this.m_SpInterface.deleteWorkBook(wUri);
        }
      }
    } catch (deleteError) {
      console.warn('componentWillUnmount: deleteWorkBook failed', deleteError);
    }
  }

  // Encode path for URL while preserving slashes
  encodePathForUrl(path) {
    if (!path) return path;
    // Split by slashes, encode each segment, then rejoin with slashes
    return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
  }

  /**
   * Ensure ReadJson receives a UTF-8 string (API may return parsed object or Buffer-like JSON).
   */
  normalizeWorkbookJsonStringForWasm(content) {
    if (content == null) return null;
    if (typeof content === 'string') return content;
    if (typeof content === 'object') {
      if (content.type === 'Buffer' && Array.isArray(content.data)) {
        return new TextDecoder('utf-8').decode(new Uint8Array(content.data));
      }
      return JSON.stringify(content);
    }
    return String(content);
  }

  // Desktop: load the active workbook from the local disk (or create a new one).
  // Read the workbook "uri" embedded in a .sker JSON payload. The engine uses
  // this value to key the workbook on load, so we must reuse it verbatim.
  extractWorkbookUri(sJson) {
    try {
      const wParsed = JSON.parse(sJson);
      const wUri = wParsed?.uri;
      return typeof wUri === 'string' && wUri.length > 0 ? wUri : null;
    } catch (wError) {
      console.warn('extractWorkbookUri: could not parse workbook JSON:', wError);
      return null;
    }
  }

  async loadDesktopWorkbook() {
    const wFileData = getSpreadsheetSession();
    if (!wFileData?.path || !this.m_SpInterface) {
      return;
    }
    try {
      this.setState({ loadingFile: true, openingFileName: wFileData.name });
      await this.waitForSpreadSheetReady();
      await this.m_SpInterface.loadWebAssembly();

      if (wFileData.isNew) {
        // Fresh, empty workbook — no file on disk yet.
        await this.m_SpInterface.newWorkBook(wFileData.path);
      } else {
        const wDiskPath = wFileData.localPath || wFileData.path;
        const bridge = getDesktopBridge();
        const wJsonRaw = await bridge.readFile(wDiskPath);
        const wJson = this.normalizeWorkbookJsonStringForWasm(wJsonRaw);
        if (!wJson || typeof wJson !== 'string') {
          throw new Error('Workbook content missing or invalid (expected JSON string)');
        }
        // tApi::ReadJson keys the workbook by the "uri" field embedded in the
        // .sker JSON, not by the URI we pass to addWorkBook. Loading under the
        // disk path would leave setActiveWorkBook pointing at an empty workbook
        // (the engine then divides by zero on the first cell move). Use the
        // JSON's own uri so add/read/setActive all target the same workbook,
        // exactly like the web path does.
        const wEngineUri = this.extractWorkbookUri(wJson) || wDiskPath;
        await this.m_SpInterface.loadWorkBook(wEngineUri, wJson);
        rememberWorkbookDiskPath(wEngineUri, wDiskPath);
      }

      syncSpreadsheetSession(wFileData);
      setActiveFilePath(wFileData.path, { name: wFileData.name, source: 'spreadsheet' });
    } catch (wError) {
      console.error('Error loading desktop workbook:', wError);
      this.setState({ error: wError?.message || 'Loading failed' });
    } finally {
      this.setState({ loadingFile: false });
    }
  }

  // Check for files from Virtual Disk and load them automatically
  async checkForVirtualDiskFile() {
    // Desktop build loads from the local filesystem, not the virtual disk.
    if (isDesktop) {
      await this.loadDesktopWorkbook();
      return;
    }
    // Wait for the SpreadSheet to be ready with a timeout
    try {
      this.setState({ loadingFile: true });
      const wFileData = getSpreadsheetSession();
      if (wFileData) {
        console.log('Found file data from Virtual Disk:', wFileData);
      
        // Load the file into the spreadsheet
        if (this.m_SpInterface) {
          try {
            // WASM engine + cell-class factory must be ready before ReadJson.
            await this.waitForSpreadSheetReady();
            await this.m_SpInterface.loadWebAssembly();

            // Workbook JSON from Mongo (no server WASM block); server WASM loads in background.
            const wJsonRaw = await fetchWorkbookJsonAndOpenOnServer(wFileData.path);
            const wJson = this.normalizeWorkbookJsonStringForWasm(wJsonRaw);
            if (!wJson || typeof wJson !== 'string') {
              throw new Error('Workbook content missing or invalid (expected JSON string)');
            }

            await this.m_SpInterface.loadWorkBook(wFileData.path, wJson);
            console.log('File loaded successfully from server:', wFileData.name);
            syncSpreadsheetSession(wFileData);
            setActiveFilePath(wFileData.path, {
              name: wFileData.name,
              source: 'spreadsheet',
            });

            this.setState({ loadingFile: false });
            return true;
            } catch (wError) {
              console.error('Error loading file from Virtual Disk:', wError);
              const wMessage = wError?.message || 'Loading failed';
              this.setState({
                loadingFile: false,
                error: wMessage,
              });
              // ACL denial: stay logged in, leave spreadsheet, show error on Virtual Disk.
              if (/permission/i.test(wMessage)) {
                try {
                  clearSpreadsheetSession();
                } catch (_) {
                  /* ignore */
                }
                if (typeof window.__skerNavigate === 'function') {
                  window.__skerNavigate('/virtualdisk', { replace: true });
                }
                void showError(wMessage);
              }
              return false;
          }
        }
      } 
    } catch (error) {
      console.error('Error checking for Virtual Disk files:', error);
      this.setState({ loadingFile: false });
      return false;
    }
    this.setState({ loadingFile: false });
    return true;
  }

  // Wait for SpreadSheet WASM engine (not only the JS wrapper — see SkUISpreadSheet.whenEngineReady).
  waitForSpreadSheetReady = () => {
    return new Promise((resolve, reject) => {
      const maxWaitTime = 30000;
      const checkInterval = 10;
      const startTime = Date.now();

      const checkReady = () => {
        const wUi = window.SkUISpreadSheet;
        if (wUi && typeof wUi.whenEngineReady === 'function') {
          wUi.whenEngineReady().then(() => resolve()).catch(reject);
          return;
        }
        if (Date.now() - startTime > maxWaitTime) {
          reject(new Error('Timeout waiting for SpreadSheet WASM engine'));
          return;
        }
        setTimeout(checkReady, checkInterval);
      };

      checkReady();
    });
  }

  // Handle loading errors gracefully
  handleLoadingError = (error) => {
    console.error("[Main] Loading error occurred:", error);
    // Set ready to true to prevent infinite loading, but show error state
    this.setState({ 
      ready: true, 
      error: error.message || 'Loading failed'
    });
  }

  // Update loading states in a single setState call
  updateLoadingState = (updates) => {
    this.setState(updates);
  }

  // Get appropriate loading text based on current state
  getLoadingText = () => {
    const { loadingFile, recalcUiVisible, recalcProgress, recalcOpLabel, recalcFinalizing, openingFileName } = this.state;
    if (recalcUiVisible) {
      const wLabel = recalcOpLabel || "Recalculating";
      if (recalcFinalizing) {
        return `${wLabel}: finalizing…`;
      }
      if (recalcProgress > 0 && recalcProgress < 100) {
        return `${wLabel}… ${Math.round(recalcProgress)}%`;
      }
      return `${wLabel}…`;
    }
    if (loadingFile) {
      return openingFileName ? `Loading ${openingFileName}…` : "Loading file…";
    }
    return "Loading…";
  }

  // Handle retry button click
  handleRetry = () => {
    this.setState({ 
      error: null, 
      loadingFile: false 
    });
    // Restart the initialization process
    this.ready();
  }
  
  componentDidUpdate(prevProps, prevState) {
    // Only refresh JsonView when invalidate toggles — not on recalcProgress ticks.
    if (prevState.invalidate !== this.state.invalidate) {
      this.m_SpInterface.reloadView();
    }
  }

  invalidate() {
    this.setState({ invalidate : !this.state.invalidate });
  }

  applyThemeRefresh() {
    const iface = this.m_SpInterface;
    if (iface?.refreshThemeColors) {
      iface.refreshThemeColors();
    }
    if (iface?.m_SkSpGridCanvas?.refreshThemeColors) {
      iface.m_SkSpGridCanvas.refreshThemeColors();
    }
    if (iface?.m_SkSpTopPanel?.refreshThemeColors) {
      iface.m_SkSpTopPanel.refreshThemeColors();
      iface.m_SkSpTopPanel.invalidate();
    }
    if (iface?.m_SkSpLeftPanel?.refreshThemeColors) {
      iface.m_SkSpLeftPanel.refreshThemeColors();
      iface.m_SkSpLeftPanel.invalidate();
    }
    this.invalidate();
  }
  
  handleMouseDown = (e) => {
    this.isResizing = true;
    this.startX.current = e.clientX;
    this.startWidth.current = this.rightPanel.current.offsetWidth;
    
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  };

  handleMouseMove = (e) => {
    if (!this.isResizing) return;
    
    const diff = this.startX.current - e.clientX;
    const newWidth = Math.max(0, Math.min(500, this.startWidth.current + diff));
    
    this.rightPanel.current.style.width = `${newWidth}px`;

    this.m_SpInterface.reloadView();
    // not Flicker on resize
    this.m_SpInterface.m_SkSpTopPanel.invalidate();
    this.m_SpInterface.m_SkSpGridCanvas.invalidate();
  };

  handleMouseUp = () => {
    if (!this.isResizing) return;
    
    this.isResizing = false;
    this.setState({ 
      rightPanelWidth: this.rightPanel.current.offsetWidth 
    });
    
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  closeRightPanel = () => {
    if (this.state.rightPanelWidth === 0) return;
    this.setState({ rightPanelWidth: 0 });
    this.m_SpInterface.reloadView();
  };

  closeAboutModal = () => {
    this.setState({ aboutModalOpen: false });
  };

  closeShortcutsModal = () => {
    this.setState({ shortcutsModalOpen: false });
  };

  openRightPanelTab = (tabLabel) => {
    const minPanelWidth = 250;
    const openTab = () => {
      requestAnimationFrame(() => {
        if (this.rightCommandRef.current?.openTab) {
          this.rightCommandRef.current.openTab(tabLabel);
        }
        this.m_SpInterface.reloadView();
      });
    };
    if (this.state.rightPanelWidth < minPanelWidth) {
      this.setState({ rightPanelWidth: minPanelWidth }, openTab);
    } else {
      openTab();
    }
  };

  render() {
    let wZoom = 1;
    if (this.m_SpInterface) {
      wZoom = this.m_SpInterface.getDisplayZoom();
    }
    const wStyle = {
      zoom: wZoom,
      width: "100%",
      height: "100%",
    };
    const { rightPanelWidth, loadingFile, recalcUiVisible, recalcProgress, didMount, error, ribbonVisible } = this.state;
    const wFullScreenLoad = loadingFile || (error !== null);
    return (
      <div className="SkSpContent">
        <div className="SkSpContainer" ref={this.m_Ref}>
          <div id="SkSpreadSheetColumn" className="SkSpContainerColumn"> 
            {ribbonVisible ? (
              <SkSpTopCommand SpInterface={this.m_SpInterface}></SkSpTopCommand>
            ) : null}
            <SkSpControlPanel 
              SpInterface={this.m_SpInterface}
              onOpenRightPanelTab={this.openRightPanelTab}
            ></SkSpControlPanel>
            <div className="SkSpGridAndRightPanel">
              <div className="SkSpContainerRow SkSpContainerRow--withRecalc">
                <div className="SkSpreadSheet" style={wStyle}>
                  <SkSpTopPanel SpInterface={this.m_SpInterface}></SkSpTopPanel>
                  {!didMount && (
                    <SkSpClient ref={this.m_SpreadSheetCanvas} id='canvas' SpInterface={this.m_SpInterface}></SkSpClient>
                  )}
                </div>
                {recalcUiVisible ? (
                  <div
                    className="SkRecalcProgressBanner"
                    role="status"
                    aria-live="polite"
                    aria-busy="true"
                  >
                    <span className="SkRecalcProgressBanner__label">
                      {this.getLoadingText()}
                    </span>
                    <div
                      className="SkRecalcProgressBanner__bar"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(recalcProgress)}
                    >
                      <div
                        className="SkRecalcProgressBanner__fill"
                        style={{ width: `${Math.max(0, Math.min(100, recalcProgress))}%` }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
              {rightPanelWidth > 0 ? (
                <div
                  ref={this.resizeHandle}
                  className="resize-handle-right"
                  onMouseDown={this.handleMouseDown}
                />
              ) : null}
              <div
                ref={this.rightPanel}
                className={`SkSpRight${rightPanelWidth === 0 ? ' SkSpRight--closed' : ''}`}
                style={{ width: `${rightPanelWidth}px` }}
              >
                <SkSpCommand
                  ref={this.rightCommandRef}
                  SpInterface={this.m_SpInterface}
                  onClose={this.closeRightPanel}
                ></SkSpCommand>
              </div>
            </div>
            <SkSpSheetTab SpInterface={this.m_SpInterface}></SkSpSheetTab>
          </div>

          {/* Full overlay only for file load / fatal error — recalc uses a non-blocking grid banner. */}
          {wFullScreenLoad && (
            <div className="SkLoadingOverlay">
              {error ? (
                <div className="SkLoadingSpinner__card SkLoadingSpinner__card--error">
                  <p className="SkLoadingSpinner__text SkLoadingSpinner__text--error">
                    <strong>Error:</strong> {error}
                  </p>
                  <button
                    type="button"
                    className="SkLoadingSpinner__retry"
                    onClick={this.handleRetry}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <SkLoadingSpinner
                  size="large"
                  text={this.getLoadingText()}
                  showText={true}
                  progress={recalcUiVisible ? recalcProgress : undefined}
                  showProgress={recalcUiVisible}
                />
              )}
            </div>
          )}
        </div>
        <SkAboutModal
          show={this.state.aboutModalOpen}
          onClose={this.closeAboutModal}
        />
        <SkKeyboardShortcutsModal
          show={this.state.shortcutsModalOpen}
          onClose={this.closeShortcutsModal}
        />
      </div>
    );
  }
}

// ============================================================================
export default SkSpreadSheet;
