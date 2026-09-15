//=============================================================================
// SkSpInterface
// Interface With SpreadSheet
//=============================================================================
import SkCellClassContainer  from "./CellClass/SkCellClassContainer.js";
import SkCellClass, {
    isInplaceEditBlockedCellClass,
    reactCellClassTypeName,
    shouldBypassCellInplaceOverlay,
    usesCalculableModelValue,
} from "./CellClass/SkCellClass.js";
import { SkFunctionContainer } from "./SkSpFunctionContainer.js";
import tSelect, { tPoint, tRange, tSizer,tColRowSelect } from "./SkSpSelect.js";
import SkUISpreadSheet from "./SkUISpreadSheet.js";   
import SkSpChat from "./SkSpChat.js";
import { persistSpreadsheetContextForAi } from "./SkSpAiSpreadsheetContext.js";
import {
  parseSheetTables,
  enrichTableFromSheetHeaders,
  filterButtonRect,
  pointInRect,
  columnDataRef,
  sheetColFromColumn,
  columnOffset,
  normalizeFilterValues,
  isTableFilterEligible,
  isFilterButtonHidden,
} from "./SkTableFilter.js";
import { createTableFromSelection } from "./SkCreateTableFromSelection.js";
import { isDesktop } from "../desktop/SkDesktopMode.js";
import { DrawCell } from "./SkDrawCell.js";
import {
  isActiveSpreadsheetReadOnly,
  isSpreadsheetWriteMessage,
} from '../SkActiveFile.js';
import SkSpClassAttribute from "./SkSpClassAttribute.js";
import { parseFloatingObjectsJson } from "./SkSpFloatingObject.js";
import { hydrateJsonViewCellFormats } from "./SkJsonViewFormatHydrate.js";
import {
  SK_BASE_LEFT_SIZE,
  SK_BASE_TOP_SIZE,
  SK_TREE_BAND_DEFAULT,
  SK_TREE_BAND_MIN,
  SK_TREE_BAND_MAX,
} from "./SkSpTreeViewPaint.js";
import { resolveCanvasPaintRatio } from "../utility/SkCanvasPaintRatio.js";
import { displayZoomFromUserZoom, excelViewBaselineScale, layoutToScreenScale } from "../utility/SkViewZoom.js";
import { isCooperativeRecalcAvailable } from "./SkCooperativeRecalc.js";

// Cap JsonView height/width (px) so full-sheet extent does not allocate extreme payloads.
const JSON_VIEW_EXTENT_CAP_PX = 12000;

// Spreadsheet hard limits (must match the WASM engine): scroll can reach the very last row/column.
const SK_MAX_ROW = 1048576;
const SK_MAX_COL = 16384;

/** Small JsonView pad over the on-screen viewport for text/merge spill (not sheet extent). */
const JSON_VIEW_SPILL_PAD_PX = 40;

// Extra JsonView size so WASM does not clip the last frozen row/column (ink / grid AA).
const FROZEN_JSON_HEIGHT_PAD_PX = 64;
const FROZEN_JSON_WIDTH_PAD_PX = 64;

// JsonView measured band sums can overshoot Wasm freeze seams; keep UI translate/clip (+ needScroll*)
// within ~few px of sumPixelHeight/Width(1..end) so four-pane raster does not detach from headers.
const FREEZE_SEAM_BAND_EXTRA_CAP_PX = 72;

// Frozen rows: m_FrozenRowEnd + m_UIViewFrozen (top strip) + optional TL corner when columns are frozen too.
// Frozen columns: m_FrozenColEnd + m_UIViewFrozenLeft (left strip) + optional TL corner.

// Modification on cell change
function OnCellChange(sText) {
  //console.log("Change -->",sText);
}

// Get User Information on 
export class SkSpUser {
  constructor(sEmail, sName, sFirstname) {
      this.m_Email = sEmail;
      this.m_Name = sName;
      this.m_Firstname = sFirstname;
  }
  getEmail() {
    return this.m_Email;
  }
  getName() {
    return this.m_Name;
  }
  getFirstname() {
    return this.m_Firstname;
  }
}

// Post Message from C++ Application  ==============================
function PostMessage(sJson, forceCursorBroadcast = false) {
  // Desktop (Electron) build has no chat/collaboration server behind the app's
  // static origin, so broadcasting is a pure no-op there. Bail out before logging
  // or touching the chat transport (which is disabled in desktop anyway). Read the
  // live global (window.skerDesktop) rather than the import-time const to avoid any
  // module-load ordering doubt.
  if (isDesktop || (typeof window !== "undefined" && !!window.skerDesktop)) {
    return;
  }

  // When applying remote Undo/Redo locally we mirror the operation by
  // calling window.SkUISpreadSheet.value(...). The C++ side answers with a
  // PostMessage broadcast that would loop the message forever between
  // collaborators, so we honor a suppression flag set by the receiver.
  if (window.__skSpSuppressBroadcast) {
    return;
  }

  if (isActiveSpreadsheetReadOnly()) {
    let wParsed = sJson;
    if (typeof sJson === 'string') {
      try {
        wParsed = JSON.parse(sJson);
      } catch {
        wParsed = null;
      }
    }
    if (isSpreadsheetWriteMessage(wParsed)) {
      return;
    }
  }

  const wChat = window.SkSpChatSpreadSheet;
  if (!wChat || typeof wChat.sendSpreadsheetMessage !== 'function') {
    return;
  }

  let wParsed = sJson;
  if (typeof sJson === 'string') {
    try {
      wParsed = JSON.parse(sJson);
    } catch (_) {
      wParsed = null;
    }
  }

  const wSkipCursorAlone =
    !forceCursorBroadcast &&
    typeof wChat.hasCollaboratorPeers === 'function' &&
    wParsed &&
    typeof wParsed === 'object' &&
    wParsed.type === 'user' &&
    (wParsed.action === 'cursor' || wParsed.action === 'moveCell') &&
    !wChat.hasCollaboratorPeers();

  if (wSkipCursorAlone) {
    return;
  }

  console.log("PostMessage to Node/Server-->",sJson);
  // Send Message to Node/Server (Chat SpreadSheet)
  wChat.sendSpreadsheetMessage(
    sJson,
    forceCursorBroadcast ? { forceCursorBroadcast: true } : {}
  );
}


// Attach functions to window object for global access (before WASM may invoke callbacks)
window.PostMessage = PostMessage;
window.OnCellChange = OnCellChange;

class SkSpInterface {
    constructor() {
      // User Interface
      this.m_UIView =null;
      this.m_UIViewFrozen = null;
      this.m_UIViewFrozenCorner = null;
      this.m_UIViewFrozenLeft = null;
      /** Frozen pixel height */
      this.m_FrozenPixH = 0;
      /** Frozen pixel width */
      this.m_FrozenPixW = 0;
      /** Last frozen sheet row when row split is on; 0 = no row split. */
      this.m_FrozenRowEnd = 0;
      /** Last frozen sheet column when column split is on; 0 = no column split. */
      this.m_FrozenColEnd = 0;
      // Class Container
      this.m_ClassContainer=null;
      // Function Container
      this.m_FunctionContainer=null

      // Connected Users
      this.m_ConnectedUsers=[];
      // Remote cursors by user email
      this.m_RemoteCursors=new Map();
      // Cursor label mode: 'firstname' | 'initials'
      this.m_CursorLabelMode='firstname';
      

      // Select 
      this.m_Select= new tSelect()
      this.m_Select.setCursor(new tPoint(1,1));
      this.m_GridWidth= 1;
      // Default grid color. Overridden by the --sk-color-grid CSS variable
      // as soon as the DOM is available (see refreshThemeColors()), so the
      // spreadsheet always paints its grid with the current theme color.
      this.m_GridColor="#d4d4d4";
      this.m_GridVisible=false;
      this.refreshThemeColors();

      // Render
      this.m_ClientWidth=0;
      this.m_ClientHeight=0;
      this.m_DiffX=0.0;
      this.m_DiffY=0.0;

      // Canvas — ratio = devicePixelRatio x display zoom, refreshed in getCanvasSize.
      this.m_Zoom=1; // Zoom 1 for Canvas
      this.m_Ratio = resolveCanvasPaintRatio(this.getDisplayZoom());

      // Sizer of col or row
      this.m_Sizer=new tSizer();
     
      this.m_UseEdit=false;
      this.m_CursorEdit=null;
      /** Cache for formula ref highlighting ({ key, data }). */
      this.m_FormulaRefsCache = null;
      /** Canvas cursor rect while editing (matches SkSpInplaceEdit overlay). */
      this.m_InplaceEditOverlayRect=null;
      // Select Mouse 
      this.m_Selected=false;
      this.m_MouseDown=false;
      // Select with Keyboard
      this.m_CursorKeyFloat=null;

      // Select panel Left
      this.m_SelectRow=new tColRowSelect(true);
      // First Key event for InplaceEdit
      this.m_LastChar="";

      // Select panel Top
      this.m_SelectCol=new tColRowSelect(false);

      // Input 
      this.m_SkSpInplaceEditStatic=null;
      this.m_SkSpInplaceEdit=null;

      this.m_SkSpInplaceEditProperty=null;

      // Scroll Bar
      this.m_BottomRight=new tPoint(10,10);
      this.m_BottomRightPixel=new tPoint(0,0);
      /** Full-sheet pixel extent (rows 1..MaxRow / cols 1..MaxCol); scroll can reach the sheet limits. */
      this.m_FullSheetPixel=new tPoint(0,0);
      /** When true, sheet scroll extents (m_BottomRightPixel) must be refreshed from WASM. */
      this.m_SheetExtentDirty = true;
      this.m_VScrollBar=null;
      this.m_setHScrollBar=null;
      /** Last setScrollBar inputs; skip SetView + WASM when unchanged. */
      this.m_ScrollBarSyncKey=null;
      /** Dynamic scroll extent (px) captured before a thumb drag, so the range stays stable while dragging. */
      this.m_ScrollExtentFrozenY=null;
      this.m_ScrollExtentFrozenX=null;

      this.m_TreeViewLeft=0;
      this.m_TreeViewTop=0;
      /** Last outline-band sizes restored when TreeView is turned back on. */
      this.m_TreeBandLeftSaved = SK_TREE_BAND_DEFAULT;
      this.m_TreeBandTopSaved = SK_TREE_BAND_DEFAULT;
     
      // Sheets ===============================================================
      this.m_SheetsList=[];
      // Save Selection ======================================================= 
      this.m_SheetSaveSelect=[];

      // Component ============================================================
      this.m_SkSpreadSheet=null;

      this.m_SkSpControlPanel=null; 
      this.m_SkSpGridCanvas=null;
      this.m_SkSpSheetTab=null;
      this.m_SkSpLeftPanel=null;
      this.m_SkSpTopPanel=null;
      this.m_SkSpGridPanel=null;
      this.m_SkSpFloatingLayer=null;
      this.m_SkSpFloatingEditor=null;
      this.m_FloatingObjects=[];
      this.m_SelectedFloatingObjectName=null;
      this.m_FloatingObjectDragging=false;
      // debug format
      this.m_SkSpCommand=null;
      this.m_SkSpTopCommand=null;

      this.m_SkSpClassAttribute=null;

      // Chat SpreadSheet
      this.m_SkSpChat=new SkSpChat();
      window.SkSpChatSpreadSheet=this.m_SkSpChat;
      this.m_SkSpChat.setSpInterface(this);

      // Users Information
      this.m_SkSpUsers=[];
      
      // Attach functions to window object for global access
      this.applyZoom();

      // Guard against duplicate WASM-side JS initialization (class registration, function container).
      this.m_LoadWebAssemblyPromise = null;
      this.m_LoadWebAssemblyDone = false;

      /** True while waiting for SkSpGridCanvas to get non-zero layout (first paint / flex). */
      this._reloadViewLayoutDeferScheduled = false;

      /** When true, wheel/overlay scroll must not reuse stale JsonView (after local paste/move). */
      this.m_JsonViewNeedsHardRefresh = false;
      /** Cached formula bar text keyed by cursor ref (Wasm JsonView omits c_f). */
      this.m_FormulaCacheRef = null;
      this.m_FormulaCacheValue = "";
      this._invalidateSelectionPending = false;
      this._invalidateSelectionRafId = null;
      /** True after leave/unmount — blocks async selection/WASM calls on torn-down workbook. */
      this.m_SpreadsheetDisposed = false;
      /** RangeData tables on the active sheet (autofilter headers). */
      this.m_TableFilterTables = [];
    }

    /** Cancel pending UI/WASM work when leaving or unmounting the spreadsheet view. */
    disposeSpreadsheet() {
      this.m_SpreadsheetDisposed = true;
      this._invalidateSelectionPending = false;
      if (this._invalidateSelectionRafId != null) {
        cancelAnimationFrame(this._invalidateSelectionRafId);
        this._invalidateSelectionRafId = null;
      }
      this.m_UIView = null;
      this.m_UIViewFrozen = null;
      this.m_UIViewFrozenCorner = null;
      this.m_UIViewFrozenLeft = null;
      this.m_FloatingObjects = [];
      this.m_SelectedFloatingObjectName = null;
      this.endFloatingObjectDrag();
    }

    isSpreadsheetDisposed() {
      return this.m_SpreadsheetDisposed === true;
    }

    /**
     * Defer reloadView until the grid canvas has real client dimensions — avoids JsonView/dX drift on open.
     */
    _scheduleReloadViewWhenSized() {
      if (this._reloadViewLayoutDeferScheduled) return;
      this._reloadViewLayoutDeferScheduled = true;
      let frames = 0;
      const maxFrames = 64;
      const tick = () => {
        frames++;
        const list = document.getElementsByClassName("SkSpGridCanvas");
        const el = list.length > 0 ? list[0] : null;
        const cw = el ? el.clientWidth : 0;
        const ch = el ? el.clientHeight : 0;
        const { width: innerW, height: innerH } = this.getGridInnerViewportCssPx(el);
        if (el && cw > 0 && ch > 0 && innerW > 1 && innerH > 1) {
          this._reloadViewLayoutDeferScheduled = false;
          this.reloadView().catch((err) => console.error("reloadView (deferred):", err));
          return;
        }
        if (frames < maxFrames) {
          requestAnimationFrame(tick);
        } else {
          this._reloadViewLayoutDeferScheduled = false;
        }
      };
      requestAnimationFrame(tick);
    }

    clear() {
      delete(this.m_Select);
      this.m_Select=null;
    }

    async loadUI() {
      // Load User Interface
      if (window.SkUISpreadSheet===undefined) {
        // CRITICAL: Wait for WASM module to be ready before creating SkUISpreadSheet
        // This prevents "ASM_CONSTS[code] is not a function" errors
        await this._waitForWasmModule();
        window.SkUISpreadSheet = new SkUISpreadSheet();
        window.SkUISpreadSheet.init();
        console.log('[SkSpInterface] SkUISpreadSheet created after WASM module is ready');
      }
    }

    // Wait for WASM module to be ready
    async _waitForWasmModule() {
      // Check if module is already ready
      if (window.__SkModuleReady && window.SpreadSheet && window.SpreadSheet.UISpreadSheet) {
        console.log('[SkSpInterface] WASM module already ready');
        return;
      }

      console.log('[SkSpInterface] Waiting for WASM module to be ready...');
      
      // If SkCreateModule exists and module is not loading, trigger it
      if (typeof window.SkCreateModule === 'function' && !window.__SkWasmLoading && !window.__SkModuleReady) {
        console.log('[SkSpInterface] Triggering WASM module loading via SkCreateModule...');
        window.SkCreateModule().catch(e => {
          console.error('[SkSpInterface] Error loading WASM module:', e);
        });
      }
      
      // Wait for module to be ready (polling with timeout)
      const maxAttempts = 100; // 10 seconds max wait (100 * 100ms)
      let attempts = 0;
      
      return new Promise((resolve, reject) => {
        const checkModule = () => {
          attempts++;
          
          if (window.__SkModuleReady && window.SpreadSheet && window.SpreadSheet.UISpreadSheet) {
            console.log('[SkSpInterface] WASM module is ready after', attempts * 100, 'ms');
            resolve();
          } else if (attempts < maxAttempts) {
            setTimeout(checkModule, 100);
          } else {
            const error = new Error('Timeout waiting for WASM module to be ready');
            console.error('[SkSpInterface]', error.message);
            console.error('[SkSpInterface] __SkModuleReady:', window.__SkModuleReady);
            console.error('[SkSpInterface] SpreadSheet:', window.SpreadSheet);
            console.error('[SkSpInterface] UISpreadSheet:', window.SpreadSheet?.UISpreadSheet);
            console.error('[SkSpInterface] SkModuleInstance:', window.SkModuleInstance);
            reject(error);
          }
        };
        
        checkModule();
      });
    }
    // Check if already connected to chat
    isChatConnected() {
      return this.m_SkSpChat && (
        (this.m_SkSpChat.hasJoined && this.m_SkSpChat.currentRoom === 'spreadsheet') ||
        this.m_SkSpChat.showChat ||
        this.m_SkSpChat.getConnectionStatus()
      );
    }
    
    // Load Chat 
    async joinChat() {
      // Desktop build has no collaboration server.
      if (isDesktop) {
        return;
      }
      // Skip if already connected to the same room
      if (this.isChatConnected()) {
        console.log('Already connected to chat, skipping join');
        return;
      }
      await this.m_SkSpChat.joinRoom('spreadsheet');
    }
    async leaveChat() {
      this.m_SkSpChat.leaveRoom('spreadsheet');
    }
    async waitRoomUsers() {
      if (isDesktop) {
        return;
      }
      return await this.m_SkSpChat.waitRoomUsers();
    }
    
    async loadConnectedUsers() {
      if (isDesktop) {
        this.m_ConnectedUsers = [];
        return(true);
      }
      const wConnectedUsers=this.m_SkSpChat.getConnectedUsers();
      // Reset and update Connected Users with proper mapping
      this.m_ConnectedUsers = [];
      for(const wUser of wConnectedUsers) {
        // In current chat model, username carries the email
        const wEmail = wUser.username || wUser.email || '';
        const wSkUser=new SkSpUser(wEmail, wUser.name || '', wUser.firstname || '');
        this.m_ConnectedUsers.push(wSkUser);
      }
      return(true);
    }

    // Update a remote user's cursor position
    async updateRemoteCursor(email, uri, sheet, row, col, firstname = "", lastname = "") {
      if (!email) return;
      const key = this._normEmail(email);
      const color = this._colorForUser(key);
      this.m_RemoteCursors.set(key, { email: key, firstname, lastname, uri, sheet, row, col, color });
      await this.invalidateCanvas();
    }

    // Get remote cursors for current active workbook and sheet
    async getRemoteCursorsForCurrent() {
      const activeUri = window.SkUISpreadSheet.getActiveWorkBook();
      const activeSheet = this.m_UIView?.sheet || '';
      const result = [];
      for (const rc of this.m_RemoteCursors.values()) {
        if (rc.uri === activeUri && rc.sheet === activeSheet) {
          result.push(rc);
        }
      }
      return result;
    }

    async removeRemoteCursorByEmail(email) {
      if (!email) return;
      const key = this._normEmail(email);
      if (this.m_RemoteCursors.has(key)) {
        this.m_RemoteCursors.delete(key);
        await this.invalidateCanvas();
      }
    }

    // Drop a remote cursor only if it currently points at the given workbook uri.
    // Useful when a user closes a workbook but stays connected to the chat room:
    // we cannot rely on user_left, so we explicitly clear stale cursor entries.
    async removeRemoteCursorByEmailAndUri(email, uri) {
      if (!email) return;
      const key = this._normEmail(email);
      const rc = this.m_RemoteCursors.get(key);
      if (!rc) return;
      if (!uri || rc.uri === uri) {
        this.m_RemoteCursors.delete(key);
        await this.invalidateCanvas();
      }
    }

    // Broadcast that the local user is leaving the given workbook so that other
    // collaborators can immediately remove the stale remote cursor for this user.
    async broadcastLeaveWorkBook(uri) {
      if (isDesktop) return;
      if (!uri) return;
      try {
        const wEmail = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('email')) || '';
        if (!wEmail) return;
        const wFirstname = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('firstname')) || '';
        const wLastname = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('name')) || '';
        const wPayload = {
          type: 'user',
          action: 'leaveWorkBook',
          uri: uri,
          user: {
            m_Email: wEmail,
            m_Firstname: wFirstname,
            m_Name: wLastname
          }
        };
        if (window.SkSpChatSpreadSheet && typeof window.SkSpChatSpreadSheet.sendSpreadsheetMessage === 'function') {
          window.SkSpChatSpreadSheet.sendSpreadsheetMessage(wPayload);
        }
      } catch (error) {
        console.warn('broadcastLeaveWorkBook failed', error);
      }
    }

    _normEmail(email) {
      return String(email).trim().toLowerCase();
    }

    _colorForUser(email) {
      // Deterministic color from email
      let hash = 0;
      for (let i = 0; i < email.length; i++) {
        hash = ((hash << 5) - hash) + email.charCodeAt(i);
        hash |= 0;
      }
      const hue = Math.abs(hash) % 360;
      return `hsl(${hue}, 85%, 50%)`;
    }

    async setCursorLabelMode(mode) {
      if (mode === 'firstname' || mode === 'initials') {
        this.m_CursorLabelMode = mode;
        //await this.reloadView();
      }
    }
    // Load WebAssembly (C++ Module)
    // Launch Chat SpreadSheet
    async loadWebAssembly()  {
      if (this.m_LoadWebAssemblyDone) {
        return true;
      }
      if (this.m_LoadWebAssemblyPromise) {
        return this.m_LoadWebAssemblyPromise;
      }

      this.m_LoadWebAssemblyPromise = (async () => {
      // CRITICAL: Ensure SkUISpreadSheet is ready before creating SkCellClassContainer
      // SkCellClassContainer.RegisterClasses() needs window.SkUISpreadSheet to be defined
      if (!window.SkUISpreadSheet) {
        console.log('[SkSpInterface] Waiting for SkUISpreadSheet to be ready before loading WebAssembly...');
        await this._waitForSkUISpreadSheet();
      }
      
      // Class Container - now window.SkUISpreadSheet is guaranteed to be ready
      this.m_ClassContainer=new SkCellClassContainer();
      // Function Container
      this.m_FunctionContainer=new  SkFunctionContainer();

      window.OnCellChange = OnCellChange;
      // Join Chat SpreadSheet
     

      //await this.loadTest();
      /*
      this.m_SkSpGridCanvas.ready();
      await this.m_SkSpSheetTab.invalidate();
      */
        this.m_LoadWebAssemblyDone = true;
        return true;
      })();

      try {
        return await this.m_LoadWebAssemblyPromise;
      } finally {
        this.m_LoadWebAssemblyPromise = null;
      }
    }

    // Wait for SkUISpreadSheet to be ready
    async _waitForSkUISpreadSheet() {
      // Check if already ready
      if (window.SkUISpreadSheet) {
        console.log('[SkSpInterface] SkUISpreadSheet already ready');
        return;
      }

      console.log('[SkSpInterface] Waiting for SkUISpreadSheet to be ready...');
      
      // Wait for SkUISpreadSheet to be ready (polling with timeout)
      const maxAttempts = 100; // 10 seconds max wait (100 * 100ms)
      let attempts = 0;
      
      return new Promise((resolve, reject) => {
        const checkSkUISpreadSheet = () => {
          attempts++;
          
          if (window.SkUISpreadSheet) {
            console.log('[SkSpInterface] SkUISpreadSheet is ready after', attempts * 100, 'ms');
            resolve();
          } else if (attempts < maxAttempts) {
            setTimeout(checkSkUISpreadSheet, 100);
          } else {
            const error = new Error('Timeout waiting for SkUISpreadSheet to be ready');
            console.error('[SkSpInterface]', error.message);
            reject(error);
          }
        };
        
        checkSkUISpreadSheet();
      });
    }

    async loadTest() {
      /* Debug  Clip
      window.SkUISpreadSheet.format("D3:D7","background-color:yellow;");
      window.SkUISpreadSheet.border("H4:J6",1,"solid black 1px;");
      window.SkUISpreadSheet.border("I4:I6",1,"");
      window.SkUISpreadSheet.Undo();
      window.SkUISpreadSheet.Redo();
      */
        let wSheet="Sheet1";
    
        //* Begin auto
     
      window.SkUISpreadSheet.pressure(100,10,wSheet);
      
      
      
       window.SkUISpreadSheet.changeTreeRow(true, 2, 100);
       window.SkUISpreadSheet.changeTreeRow(true, 4, 50);
       window.SkUISpreadSheet.changeTreeRow(true, 9, 30);
       window.SkUISpreadSheet.changeTreeRow(true, 40, 30);
       
       window.SkUISpreadSheet.changeTreeCol(true, 2, 150);
       window.SkUISpreadSheet.changeTreeCol(true, 4, 7);
       window.SkUISpreadSheet.changeTreeCol(true, 15, 5);
       window.SkUISpreadSheet.changeTreeCol(true, 16, 2);
       window.SkUISpreadSheet.changeTreeCol(true, 20, 20);
      
       //window.SkUISpreadSheet.openCloseTreeCol(7);


       //window.SkUISpreadSheet.openCloseTreeRow(5);
       //window.SkUISpreadSheet.openCloseTreeRow(8);

        window.SkUISpreadSheet.merge("M3:P3");
        window.SkUISpreadSheet.cellClass("M3","SkCellClassPieChart");

        window.SkUISpreadSheet.merge("N6:Q9");
        window.SkUISpreadSheet.cellClass("N6","SkCellClassLineChart");
      
        window.SkUISpreadSheet.cellClass("L9","SkCellClassCanvas");   
        window.SkUISpreadSheet.cellClass("L10","SkCellClassCanvas");   
        window.SkUISpreadSheet.cellClass("L11","SkCellClassCanvas");   
        window.SkUISpreadSheet.cellClass("L12","SkCellClassCanvas");   
        window.SkUISpreadSheet.cellClass("L13","SkCellClassCanvas");   
        window.SkUISpreadSheet.cellClass("L14","SkCellClassCanvas");   
        window.SkUISpreadSheet.cellClass("L15","SkCellClassCanvas");   
        window.SkUISpreadSheet.cellClass("L16","SkCellClassCanvas");   

        window.SkUISpreadSheet.valueAttribute("L9","value","=M9+1");
        window.SkUISpreadSheet.valueAttribute("L10","value","=M10+1");
        window.SkUISpreadSheet.valueAttribute("L11","value","=M11+1");
        window.SkUISpreadSheet.valueAttribute("L12","value","=M12+1");
        window.SkUISpreadSheet.valueAttribute("L13","value","=M13+1");
        window.SkUISpreadSheet.valueAttribute("L14","value","=M14+1");
        window.SkUISpreadSheet.valueAttribute("L15","value","=M15+1");

        window.SkUISpreadSheet.value("M10","=M9+20");
        window.SkUISpreadSheet.value("M11","=M10+20");
        window.SkUISpreadSheet.value("M12","=M11+20");
        window.SkUISpreadSheet.value("M13","=M12+20");
        window.SkUISpreadSheet.value("M14","=M13+20");
        window.SkUISpreadSheet.value("M15","=M14+20");
        
        

       window.SkUISpreadSheet.cellClass("K8","SkCellClassCheck");   
       window.SkUISpreadSheet.cellClass("L8","SkCellClassSwitch"); 
       window.SkUISpreadSheet.value("M8","=L8");
       window.SkUISpreadSheet.value("M9","=M8*60");
  
       window.SkUISpreadSheet.cellClass("K9","SkCellClassButton");   
       window.SkUISpreadSheet.cellClass("K2","SkCellClassComboBox");   
       window.SkUISpreadSheet.cellClass("K4","SkCellClassCalendar");   
        window.SkUISpreadSheet.valueInt("A1",1);
        
        window.SkUISpreadSheet.format("D3:F20","background-color:yellow;");
        window.SkUISpreadSheet.format("E7:H10;B16:L17","background-color:lightblue;");
        
        window.SkUISpreadSheet.border("C2:E12;J18:O22",5,"dashed black 2px;");
        
        window.SkUISpreadSheet.border("D5:E7;J6:O9",5,"solid navy 2px;");
  
        window.SkUISpreadSheet.border("A20:G20",5,"solid red 5px;");
        window.SkUISpreadSheet.border("A12:Z22",5,"solid navy 3px;");
    
        window.SkUISpreadSheet.border("E1:E12",1,"solid red 3px;");
        
        window.SkUISpreadSheet.sizeRow(4,4, 30);
        window.SkUISpreadSheet.sizeRow(8,8, 120);
        window.SkUISpreadSheet.sizeRow(9,9, 120);
        window.SkUISpreadSheet.sizeCol(7,7, 230);
        window.SkUISpreadSheet.sizeCol(8,8, 130);
        window.SkUISpreadSheet.sizeCol(12,12, 180);
        window.SkUISpreadSheet.sizeCol(11,11, 120);
  
        window.SkUISpreadSheet.sizeRow(44,44, 30);
        //window.SkUISpreadSheet.sizeRow(64,65, 30);
  
        window.SkUISpreadSheet.sizeCol(window.SkUISpreadSheet.alphaToBase10("L"),window.SkUISpreadSheet.alphaToBase10("L"), 120);
        window.SkUISpreadSheet.sizeCol(window.SkUISpreadSheet.alphaToBase10("M"),window.SkUISpreadSheet.alphaToBase10("N"), 120);
        window.SkUISpreadSheet.sizeCol(window.SkUISpreadSheet.alphaToBase10("P"),window.SkUISpreadSheet.alphaToBase10("Q"), 120);
  
        //window.SkUISpreadSheet.sizeRow(144,145, 250);
      
        window.SkUISpreadSheet.merge("D5:E7");
        window.SkUISpreadSheet.format("D5","background-color:lightblue;font:\"Arial\",serif 32pt;");
        window.SkUISpreadSheet.format("A4:E4","background-color:red;");
  
        window.SkUISpreadSheet.merge("C35:J47");
        window.SkUISpreadSheet.format("C35","background-color:lightblue;font:\"Arial\",serif 64pt;");
  
        window.SkUISpreadSheet.merge("L42:O53");
        window.SkUISpreadSheet.format("L42","background-color:green;font:\"Courier New\",serif 64pt;");
  
        window.SkUISpreadSheet.merge("D53:F54");
        window.SkUISpreadSheet.format("D53","background-color:red;color:blue;font:\"Courier New\",serif 32pt;");
       
        window.SkUISpreadSheet.merge("B55:H60");
        window.SkUISpreadSheet.format("B55","background-color:yellow;font:\"Courier New\",serif 32pt;");
        
        window.SkUISpreadSheet.merge("J52:J59");
        window.SkUISpreadSheet.format("J52","background-color:yellow;font:\"Courier New\",serif 32pt;");
        /*
        this.addSheet("Feuille2","");
        window.SkUISpreadSheet.pressure(50,10);
        this.addSheet("Feuille3","");
        window.SkUISpreadSheet.pressure(50,10);
        */
        await this.setBottomRight();
        await this.reloadView();
        await this.loadSheetList();
        // Ensure we have at least one sheet before setting it as active
        if (this.m_SheetsList && this.m_SheetsList.length > 0 && typeof this.m_SheetsList[0] === 'string') {
          await this.setActiveSheet(this.m_SheetsList[0]);
        } else {
          console.warn('initWorkBook: No sheets available or invalid sheet name');
        }
      
        return(true);
    }

    isTreeView() {
      return((this.m_TreeViewLeft>0) || (this.m_TreeViewTop>0));
    }

    // Sync JS-driven colors with CSS custom properties. Call after the
    // document is ready (and again if the theme changes at runtime) so the
    // canvas renderers use the same palette as the HTML UI.
    refreshThemeColors() {
      if (typeof document==='undefined') return;
      const wRoot=document.querySelector(':root');
      if (!wRoot) return;
      const wComputed=getComputedStyle(wRoot);
      const wGrid=wComputed.getPropertyValue('--sk-color-grid');
      if (wGrid && wGrid.trim().length>0) {
        this.m_GridColor=wGrid.trim();
      }
    }

    applyZoom() {
      // Apply Zoom =================================================================
      const wRootStyle = document.querySelector(':root');
      wRootStyle.style.setProperty('--sk-zoom', `${this.m_Zoom}`);
      if (window.SkSpreadSheet) {
        window.SkSpreadSheet.invalidate();
      }
    }

    /** Menu zoom (100% = 1) — unchanged in the View label. */
    getUserZoom() {
      return Math.max(Number(this.m_Zoom) || 1, 0.001);
    }

    /**
     * CSS display scale = user zoom × Excel parity baseline (Retina HiDPI).
     * Use for transform scale and pointer coordinate unscale.
     */
    getDisplayZoom() {
      return displayZoomFromUserZoom(this.m_Zoom);
    }

    excelViewBaselineScale() {
      return excelViewBaselineScale();
    }

    /** Refreshed in getCanvasSize — devicePixelRatio x display zoom, capped. */
    refreshCanvasPaintRatio() {
      const next = resolveCanvasPaintRatio(this.getDisplayZoom());
      if (next !== this.m_Ratio) {
        this.m_Ratio = next;
      }
    }
    
    getCanvasSize(sCanvas) {
      this.refreshCanvasPaintRatio();
      const wContext = sCanvas.getContext("2d");
      const wWidth= sCanvas.offsetWidth;
      const wHeight= sCanvas.offsetHeight;
    
      sCanvas.width = wWidth * this.m_Ratio;
      sCanvas.height = wHeight * this.m_Ratio;

      wContext.scale(this.m_Ratio ,this.m_Ratio);

      // Return correct size
      const Width=wWidth;
      const Height=wHeight;
      return({Width,Height})
    }

    /**
     * Scrollbar gutters (CSS px) — same as SkVScrollBar / SksetHScrollBar overlay on SkSpGridCanvas.
     */
    getScrollBarChromePx() {
      try {
        const root = document.querySelector(":root");
        if (!root) {
          return { v: 0, h: 0 };
        }
        const cs = getComputedStyle(root);
        const v = parseFloat(cs.getPropertyValue("--sk-vscrollbar-size").trim()) || 0;
        const h = parseFloat(cs.getPropertyValue("--sk-hscrollbar-size").trim()) || 0;
        return { v: Math.max(0, v), h: Math.max(0, h) };
      } catch (e) {
        return { v: 0, h: 0 };
      }
    }

    /** Grid cells canvas — viewport metrics must come from here, not the header canvases. */
    getGridPaintCanvasEl() {
      return (
        this.m_SkSpGridCanvas?.m_Ref?.current ??
        document.querySelector(".SkSpGridCanvas")
      );
    }

    /** Row-number column width (without outline band). */
    getBaseLeftSize() {
      return SK_BASE_LEFT_SIZE;
    }

    /** Column-letter row height (without outline band). */
    getBaseTopSize() {
      return SK_BASE_TOP_SIZE;
    }

    _clampTreeBand(sPx) {
      return Math.max(
        SK_TREE_BAND_MIN,
        Math.min(SK_TREE_BAND_MAX, Math.round(Number(sPx) || 0))
      );
    }

    /**
     * Resize the row-outline band in LeftPanel (number column stays fixed).
     * @returns {boolean} true when the size changed
     */
    setTreeBandLeft(sPx) {
      if (!(Number(this.m_TreeViewLeft) > 0)) {
        return false;
      }
      const wNext = this._clampTreeBand(sPx);
      if (wNext === (Number(this.m_TreeViewLeft) || 0)) {
        return false;
      }
      this.m_TreeViewLeft = wNext;
      this.m_TreeBandLeftSaved = wNext;
      this.syncHeaderChromeCss();
      return true;
    }

    /**
     * Resize the column-outline band in TopPanel (letter row stays fixed).
     * @returns {boolean} true when the size changed
     */
    setTreeBandTop(sPx) {
      if (!(Number(this.m_TreeViewTop) > 0)) {
        return false;
      }
      const wNext = this._clampTreeBand(sPx);
      if (wNext === (Number(this.m_TreeViewTop) || 0)) {
        return false;
      }
      this.m_TreeViewTop = wNext;
      this.m_TreeBandTopSaved = wNext;
      this.syncHeaderChromeCss();
      return true;
    }

    /** After outline-band resize: refresh JsonView + repaint headers/grid. */
    async refreshAfterHeaderChromeResize() {
      await this.reloadView();
      this.m_SkSpLeftPanel?.invalidate?.();
      this.m_SkSpTopPanel?.invalidate?.();
      this.m_SkSpGridCanvas?.invalidate?.();
    }

    /**
     * Left inset inside SkSpGridCanvas for the row-outline band.
     * 0: row tree is painted in SkSpLeftPanel (--sk-left-size already includes the band).
     */
    gridTreeViewLeft() {
      return 0;
    }

    /**
     * Top inset inside SkSpGridCanvas for the column-outline band.
     * 0: column tree is painted in SkSpTopPanel (--sk-top-size already includes the band).
     */
    gridTreeViewTop() {
      return 0;
    }

    /** Enable/disable outline bands and sync header chrome CSS. */
    setTreeViewEnabled(sOn) {
      if (sOn) {
        this.m_TreeViewLeft = this._clampTreeBand(
          this.m_TreeBandLeftSaved || SK_TREE_BAND_DEFAULT
        );
        this.m_TreeViewTop = this._clampTreeBand(
          this.m_TreeBandTopSaved || SK_TREE_BAND_DEFAULT
        );
      } else {
        if (Number(this.m_TreeViewLeft) > 0) {
          this.m_TreeBandLeftSaved = this.m_TreeViewLeft;
        }
        if (Number(this.m_TreeViewTop) > 0) {
          this.m_TreeBandTopSaved = this.m_TreeViewTop;
        }
        this.m_TreeViewLeft = 0;
        this.m_TreeViewTop = 0;
      }
      this.syncHeaderChromeCss();
    }

    /**
     * Keep --sk-left-size / --sk-top-size in sync with outline bands.
     * Row tree → LeftPanel; column tree → TopPanel (chrome grows by band width).
     */
    syncHeaderChromeCss() {
      try {
        const root = document.querySelector(":root");
        if (!root) {
          return;
        }
        const treeLeft = Number(this.m_TreeViewLeft) || 0;
        const treeTop = Number(this.m_TreeViewTop) || 0;
        const left = this.getBaseLeftSize() + treeLeft;
        const top = this.getBaseTopSize() + treeTop;
        root.style.setProperty("--sk-left-size", `${left}px`);
        root.style.setProperty("--sk-top-size", `${top}px`);
        root.style.setProperty("--sk-treeview-left", String(treeLeft));
        root.style.setProperty("--sk-treeview-top", String(treeTop));
      } catch (_) {
        /* ignore */
      }
    }

    /** CSS px insets for the column/row header chrome (--sk-top-size / --sk-left-size). */
    gridChromeInsetsPx() {
      try {
        const root = document.querySelector(":root");
        if (!root) {
          return { top: 0, left: 0 };
        }
        const cs = getComputedStyle(root);
        const top =
          parseFloat(cs.getPropertyValue("--sk-top-size").trim()) || 0;
        const left =
          parseFloat(cs.getPropertyValue("--sk-left-size").trim()) || 0;
        return { top: Math.max(0, top), left: Math.max(0, left) };
      } catch (e) {
        return { top: 0, left: 0 };
      }
    }

    /** Y origin for row-number labels — aligned with the grid canvas top edge. */
    gridRowHeaderBandTopPx() {
      return this.gridTreeViewTop();
    }

    /**
     * Grid viewport in CSS pixels: canvas client rect minus tree headers and scrollbar overlays.
     * Must match JsonView width/height passed to getView and the clip rect in SkSpGridCanvas.paint.
     */
    getGridInnerViewportCssPx(canvasEl) {
      const el = canvasEl ?? this.getGridPaintCanvasEl();
      if (!el) {
        return { width: 1, height: 1 };
      }
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      const { v, h } = this.getScrollBarChromePx();
      const width = Math.max(1, cw - this.gridTreeViewLeft() - v);
      const height = Math.max(1, ch - this.gridTreeViewTop() - h);
      return { width, height };
    }

    /**
     * JsonView for the scrollable column-header band (right of the vertical split).
     * Four-pane: bottom-right pane (m_UIView), same role as frozenLeftUi for row headers.
     * Row-only split: top strip (m_UIViewFrozen) above the horizontal seam.
     */
    _scrollColumnHeaderUiForPaint() {
      if (this.isFrozenFourPaneActive()) {
        return this.m_UIView;
      }
      if (this.isFrozenSplitActive() && this.m_UIViewFrozen) {
        return this.frozenUiForPaint();
      }
      return this.m_UIView;
    }

    /**
     * JsonView for frozen column letters (left of the vertical split).
     * Four-pane: top-left corner (mirror of frozenUi for row headers).
     * Column-only: left strip.
     */
    _frozenColumnHeaderUiForPaint() {
      if (!this.isFrozenColSplitActive()) {
        return null;
      }
      if (this.isFrozenFourPaneActive()) {
        return this.frozenCornerUiForPaint() ?? this.frozenLeftUiForPaint();
      }
      return this.frozenLeftUiForPaint() ?? this.frozenCornerUiForPaint();
    }

    /** True when ui drives horizontal scroll column geometry (main or top frozen strip). */
    _isHorizontalScrollColumnUi(ui) {
      if (ui == null) {
        return false;
      }
      if (ui === this.m_UIView) {
        return true;
      }
      if (!this.isFrozenSplitActive() || !this.m_UIViewFrozen) {
        return false;
      }
      if (ui === this.m_UIViewFrozen) {
        return true;
      }
      const fu = this._frozenUiClampedToRowEnd(this.m_UIViewFrozen);
      return ui === fu;
    }

    /**
     * Column band for A,B,C… headers — scroll band matches the pane under the top bar
     * (top strip when row split is on, main pane otherwise).
     */
    columnHeaderLayoutForPaint() {
      const ui = this._scrollColumnHeaderUiForPaint();
      if (ui == null) {
        return null;
      }
      return this._columnHeaderLayoutFromUi(ui);
    }

    /** Column band for A,B,C… headers — same dX stepping as paintGridForPane. */
    _columnHeaderLayoutFromUi(ui) {
      if (ui == null || !Array.isArray(ui.cols)) {
        return null;
      }
      return {
        ui,
        cols: ui.cols,
        dX: this._uiPaneDX(ui),
      };
    }

    /** Row band for 1,2,3… headers — same dY stepping as paintGridForPane. */
    rowHeaderLayoutForPaint(uiBand = null) {
      const ui = uiBand ?? this.m_UIView;
      return this._rowHeaderLayoutFromUi(ui);
    }

    _rowHeaderLayoutFromUi(ui) {
      if (ui == null || !Array.isArray(ui.rows)) {
        return null;
      }
      return {
        ui,
        rows: ui.rows,
        dY: this._uiPaneDY(ui),
      };
    }

    async resetWorkBook() {
      await this.loadSheetList();
      // Ensure we have at least one sheet before setting it as active
      if (this.m_SheetsList && this.m_SheetsList.length > 0 && typeof this.m_SheetsList[0] === 'string') {
        await this.setActiveSheet(this.m_SheetsList[0]);
      } else {
        console.warn('resetWorkBook: No sheets available or invalid sheet name');
      }
      await this.reloadView();
      if (this.m_SkSpGridCanvas!==null) {
        this.m_SkSpGridCanvas.ready();
      }
      if (this.m_SkSpSheetTab!==null) {
        this.m_SkSpSheetTab.invalidate();
      }
    }

    async newWorkBook(sUri) {
      let wOk=window.SkUISpreadSheet.newWorkBook(sUri);
      this.invalidateSheetExtent();
      this.resetWorkBook();
      return(wOk);
    }
    
    async writeWorkBook() {
      // Drain any in-flight background recalc so the serialized JSON is fully consistent.
      await this.m_SkSpreadSheet?.waitForRecalcIdle?.();
      let wJson=window.SkUISpreadSheet.writeJson(window.SkUISpreadSheet.getActiveWorkBook());
      // Do not log the full workbook JSON: on large sheets it is multi-MB and, under Electron,
      // every renderer console message is forwarded over IPC to the main process (see electron/main.js),
      // which spikes memory and freezes the UI thread. Log only the payload size.
      console.log("writeWorkBook: JSON length =", wJson ? wJson.length : 0);
      return(wJson);
    }

    async loadWorkBook(sUri,sJson) {
      // Cell classes must be in tClassFactory before ReadJson (saved .sker with t:"c" cells).
      await this.loadUI();
      await this.loadWebAssembly();

      // Multi-workbook: only load/activate this URI; other in-memory workbooks (HTML editor embed) stay intact.
      // ReadJson clears and reloads the target workbook only (C++ WorkBook::Clear + Json).
      let wOk=window.SkUISpreadSheet.addWorkBook(sUri);
      if (wOk!==true) {
        console.error(`loadWorkBook: addWorkBook failed for ${sUri}`);
        return(false);
      }

      console.log("loadWorkBook: addWorkBook success for ",sUri);
      // Never log the full workbook JSON here: on large sheets (e.g. 20k rows) it is multi-MB and,
      // under Electron, the main process mirrors every renderer console message over IPC
      // (see electron/main.js), causing a big memory spike and a UI-thread freeze on open.
      console.log("loadWorkBook: JSON length =", sJson ? sJson.length : 0);

      wOk= window.SkUISpreadSheet.readJson(sJson);
      if (wOk) {
        this.m_SpreadsheetDisposed = false;
        this.invalidateSheetExtent();
        await this.resetWorkBook();
      }
      window.SkUISpreadSheet.setActiveWorkBook(sUri);
      // DrawCell expects a sheet name; empty string means "use current active sheet".
      DrawCell(this, "loadWorkBook", "", 1, 1, 23, 10, { showFormula: false });
      // Announce our cursor to peers as soon as the workbook is opened so
      // collaborators already in the room see us, and so any further
      // user_joined will be answered (see SkSpChat) by re-broadcasting it.
      try { await this.sendMoveCell(this.m_Select.cursor()); } catch (_) {}
      return(wOk)
    }

    /**
     * Reload active workbook JSON from server storage (after AI persist on server WASM).
     * Preserves the UI active sheet tab (resetWorkBook otherwise picks the first sheet).
     * @param {string} sUri virtual path e.g. /share/IA.sker
     */
    async reloadWorkbookFromServer(sUri) {
      let wPrevSheet = '';
      try {
        if (
          this.m_UIView?.sheet &&
          typeof this.m_UIView.sheet === 'string' &&
          !this.isSystemSheetName(this.m_UIView.sheet)
        ) {
          wPrevSheet = this.m_UIView.sheet;
        } else {
          const wActive = await this.getActiveSheet();
          if (wActive && !this.isSystemSheetName(wActive)) {
            wPrevSheet = wActive;
          }
        }
        if (wPrevSheet) {
          this.saveSheetSelection(wPrevSheet);
        }
      } catch (err) {
        console.warn('reloadWorkbookFromServer: could not save active sheet', err);
      }

      const { fetchWorkbookJsonFromContentEndpoint } = await import('./SkeeptoServerApi.js');
      const wJson = await fetchWorkbookJsonFromContentEndpoint(sUri);
      const wOk = await this.loadWorkBook(sUri, wJson);
      if (wOk) {
        await this.loadSheetList();
        if (wPrevSheet && this.m_SheetsList.includes(wPrevSheet)) {
          await this.setActiveSheet(wPrevSheet);
        }
      }
      return wOk;
    }

    async deleteWorkBook(sUri) {
      // Tell collaborators to drop our cursor for this workbook before it is gone.
      try {
        await this.broadcastLeaveWorkBook(sUri);
      } catch (_) { /* best effort */ }
      let wOk=window.SkUISpreadSheet.deleteWorkBook(sUri);
      return(wOk);
    }

    /** Workbook-internal sheets (_$$A, _$$N, …) must not appear in tabs or become UI-active. */
    isSystemSheetName(sSheet) {
      return typeof sSheet === "string" && sSheet.length >= 3 && sSheet.startsWith("_$$");
    }

    async setActiveSheet(sSheet) {
      if (this.isSystemSheetName(sSheet)) {
        return;
      }
      this.saveSheetSelection(window.SkUISpreadSheet.getActiveSheet());
      window.SkUISpreadSheet.setActiveSheet(sSheet);
      this.loadSheetSelection(sSheet);
      this.invalidateSheetExtent();
      await this.reloadView();
      // CallBack Tab
      if (this.m_SkSpSheetTab) {
        this.m_SkSpSheetTab.SetTab(sSheet);;
      }
    }
    
    async getActiveWorkBook() {
      if (!window.SkUISpreadSheet || typeof window.SkUISpreadSheet.getActiveWorkBook !== 'function') {
        return null;
      }
      try {
        return window.SkUISpreadSheet.getActiveWorkBook();
      } catch (error) {
        console.error('Failed to retrieve active workbook from SkUISpreadSheet', error);
        return null;
      }
    }

    async getActiveSheet(sSheet) {
      return window.SkUISpreadSheet.getActiveSheet();
    }

    async addSheet(sSheet,sLeft) {
      this.setExtraUndo();
      let wOk=window.SkUISpreadSheet.addSheet(sSheet,sLeft);
      await this.setActiveSheet(sSheet);
      return(wOk);
    }

    async deleteSheet(sSheet) {
      if (!sSheet || this.m_SheetsList.length <= 1) {
        return false;
      }
      this.setExtraUndo();
      const wActive = window.SkUISpreadSheet.getActiveSheet();
      const wIndex = this.m_SheetsList.indexOf(sSheet);
      window.SkUISpreadSheet.deleteSheet(sSheet);
      const wList = await this.loadSheetList();
      if (wActive === sSheet) {
        const wNewIndex = Math.min(Math.max(wIndex, 0), wList.length - 1);
        await this.setActiveSheet(wList[wNewIndex]);
      } else if (wList.includes(wActive)) {
        await this.setActiveSheet(wActive);
      }
      return true;
    }

    async swapSheet(sName1, sName2, sOpts) {
      if (!sName1) {
        return false;
      }
      const wInsertAfter = sOpts?.insertAfter === true;
      if (!wInsertAfter && (!sName2 || sName1 === sName2)) {
        return false;
      }
      this.setExtraUndo();
      const wOk = window.SkUISpreadSheet.swapSheet(sName1, sName2 ?? "", wInsertAfter);
      if (wOk) {
        await this.loadSheetList();
      }
      return wOk;
    }

    async renameSheet(sOldName, sNewName) {
      const wTrim = String(sNewName ?? "").trim();
      if (!sOldName || !wTrim || sOldName === wTrim) {
        return false;
      }
      if (this.isSystemSheetName(sOldName) || this.isSystemSheetName(wTrim)) {
        return false;
      }
      if (this.m_SheetsList.includes(wTrim)) {
        return false;
      }

      this.setExtraUndo();
      const wWasActive = window.SkUISpreadSheet.getActiveSheet() === sOldName;
      const wOk = window.SkUISpreadSheet.renameSheet(sOldName, wTrim);
      if (!wOk) {
        return false;
      }

      if (this.m_SheetSaveSelect[sOldName] !== undefined) {
        const wRaw = this.m_SheetSaveSelect[sOldName];
        delete this.m_SheetSaveSelect[sOldName];
        try {
          const wObj = JSON.parse(wRaw);
          wObj.name = wTrim;
          this.m_SheetSaveSelect[wTrim] = JSON.stringify(wObj);
        } catch (_error) {
          this.m_SheetSaveSelect[wTrim] = wRaw;
        }
      }

      await this.loadSheetList();

      if (this.m_SkSpSheetTab && this.m_SkSpSheetTab.m_Sheet === sOldName) {
        this.m_SkSpSheetTab.m_Sheet = wTrim;
      }
      if (this.m_UIView != null && this.m_UIView.sheet === sOldName) {
        this.m_UIView.sheet = wTrim;
      }

      if (wWasActive) {
        await this.setActiveSheet(wTrim);
      } else if (this.m_SkSpSheetTab) {
        await this.m_SkSpSheetTab.invalidate();
        if (this.m_SkSpSheetTab.m_TabComponent) {
          this.m_SkSpSheetTab.m_TabComponent.SetTab(this.m_SkSpSheetTab.m_Sheet);
        }
      }

      return true;
    }

    saveSheetSelection(sSheet) {
      if (this.m_UIView!==null) {
        const wSave = {
          name: sSheet,
          toprow: this.m_UIView.toprow,
          topcol: this.m_UIView.topcol,
          cursor: this.m_Select.m_Cursor,
          selections : this.m_Select.m_Selections,
          selectrows : this.m_SelectRow.m_Selections,
          selectcols : this.m_SelectCol.m_Selections
        }
        this.m_SheetSaveSelect[sSheet]=JSON.stringify(wSave);
      }
    }

    loadSheetSelection(sSheet) {
      if (this.m_UIView!==null) {
        const wSaveStr=this.m_SheetSaveSelect[sSheet];
        if (wSaveStr!==undefined) {
          const wSave=JSON.parse(wSaveStr);
          this.m_UIView.sheet=wSave.name;
          this.m_UIView.toprow=wSave.toprow;   
          this.m_UIView.topcol=wSave.topcol;
          this.m_Select.m_Cursor.clone(wSave.cursor);
          this.m_Select.selectionsClone(wSave.selections);
          this.m_SelectRow.selectionsClone(wSave.selectrows);
          this.m_SelectCol.selectionsClone(wSave.selectcols);      
        } else {
          this.m_UIView.sheet=sSheet;
          this.m_UIView.toprow=1;   
          this.m_UIView.topcol=1;
          this.m_Select.m_Cursor.clone(new tPoint(1,1));
          this.m_Select.raz();
          this.m_SelectRow.raz();
          this.m_SelectCol.raz();
        }
      }
    }

    async loadSheetList() {
      let wList=window.SkUISpreadSheet.sheetsList();
      let wListSheet=JSON.parse(wList);

      this.m_SheetsList = (Array.isArray(wListSheet.list) ? wListSheet.list : []).filter(
        (name) => typeof name === "string" && !this.isSystemSheetName(name)
      );
      return(this.m_SheetsList);
    }

    /** JsonView uses WASM ActiveSheet — realign before load when chart reads drifted it. */
    async ensureWasmActiveSheetMatchesUi() {
      const wUi = window.SkUISpreadSheet;
      const wTarget = this.m_UIView?.sheet;
      if (wUi == null || !wTarget || this.isSystemSheetName(wTarget)) {
        return;
      }
      try {
        const wNow = wUi.getActiveSheet();
        if (wNow !== wTarget) {
          wUi.setActiveSheet(wTarget);
        }
      } catch (_error) {
        /* best effort */
      }
    }

    /** Invalidate cached sheet scroll extents (total px width/height). Recomputed on next ensureSheetExtent(). */
    invalidateSheetExtent() {
      this.m_SheetExtentDirty = true;
    }

    /** JsonView viewport size in px — screen band only, not full sheet extent (scrollbars use m_BottomRightPixel). */
    _jsonViewExtentPx(sWidth, sHeight) {
      const jsonW = Math.min(
        Math.max(1, Number(sWidth) || 1) + JSON_VIEW_SPILL_PAD_PX,
        JSON_VIEW_EXTENT_CAP_PX
      );
      const jsonH = Math.min(
        Math.max(1, Number(sHeight) || 1) + JSON_VIEW_SPILL_PAD_PX,
        JSON_VIEW_EXTENT_CAP_PX
      );
      return { jsonW, jsonH };
    }

    /**
     * Load m_BottomRight / m_BottomRightPixel once per layout generation (row/col sizes).
     * Used for scrollbar max travel — not passed as JsonView window size.
     */
    async ensureSheetExtent(force = false) {
      if (
        !force &&
        !this.m_SheetExtentDirty &&
        this.m_BottomRightPixel != null &&
        this.m_BottomRight != null
      ) {
        return;
      }
      try {
        const wJson = window.SkUISpreadSheet.jsonBottomRight("");
        const wPoint = JSON.parse(wJson);
        this.m_BottomRight = new tPoint(wPoint.r, wPoint.c);

        const wJsonPixel = window.SkUISpreadSheet.jsonPixelBottomRight("");
        const wPointPixel = JSON.parse(wJsonPixel);
        this.m_BottomRightPixel = new tPoint(wPointPixel.r, wPointPixel.c);
        this.m_FullSheetPixel = this._computeFullSheetExtentPx();
        this.m_SheetExtentDirty = false;
      } catch (error) {
        console.error(error);
      }
    }

    /**
     * Full-sheet pixel extent (rows 1..MaxRow / cols 1..MaxCol) so scrolling can reach the sheet
     * limits like Excel. Computed O(1): used-range extent + default-sized empty rows/columns beyond
     * the last used cell (SumHeight/SumWidth are O(n), so a 1..MaxRow sum is never issued).
     */
    _computeFullSheetExtentPx() {
      const usedRow = Math.max(0, Number(this.m_BottomRightPixel?.row?.()) || 0);
      const usedCol = Math.max(0, Number(this.m_BottomRightPixel?.col?.()) || 0);
      const lastRow = Math.max(1, Number(this.m_BottomRight?.row?.()) || 1);
      const lastCol = Math.max(1, Number(this.m_BottomRight?.col?.()) || 1);
      let fullH = usedRow;
      let fullW = usedCol;
      try {
        if (lastRow < SK_MAX_ROW) {
          const defRow =
            Number(window.SkUISpreadSheet.sumPixelHeight(lastRow + 1, lastRow + 1)) || 0;
          fullH = usedRow + (SK_MAX_ROW - lastRow) * defRow;
        }
        if (lastCol < SK_MAX_COL) {
          const defCol =
            Number(window.SkUISpreadSheet.sumPixelWidth(lastCol + 1, lastCol + 1)) || 0;
          fullW = usedCol + (SK_MAX_COL - lastCol) * defCol;
        }
      } catch (error) {
        console.error(error);
      }
      return new tPoint(fullH, fullW);
    }

    async setBottomRight(force = false) {
      return this.ensureSheetExtent(force);
    }

    bottomRight() {
      return(this.m_BottomRight);
    }
  
    async loadFloatingObjectsForActiveSheet() {
      this.m_FloatingObjects = [];
      if (window.SkUISpreadSheet == null || this.m_UIView == null) {
        return;
      }
      const wSheet = this.m_UIView.sheet || "";
      if (wSheet === "") {
        return;
      }
      try {
        const wJson = window.SkUISpreadSheet.jsonFloatingObjectsForSheet(
          wSheet,
          wSheet
        );
        this.m_FloatingObjects = parseFloatingObjectsJson(wJson);
        if (
          this.m_SelectedFloatingObjectName != null &&
          !this.findFloatingObjectEntry(this.m_SelectedFloatingObjectName)
        ) {
          this.clearFloatingObjectSelection(false, true);
        }
      } catch (err) {
        console.error("loadFloatingObjectsForActiveSheet:", err);
        this.m_FloatingObjects = [];
      }
    }

    findFloatingObjectEntry(sName) {
      if (!Array.isArray(this.m_FloatingObjects) || sName == null || sName === "") {
        return null;
      }
      return this.m_FloatingObjects.find((o) => o?.n === sName) ?? null;
    }

    getSelectedFloatingObject() {
      return this.findFloatingObjectEntry(this.m_SelectedFloatingObjectName);
    }

    isFloatingObjectDragging() {
      return this.m_FloatingObjectDragging === true;
    }

    /** Suppress grid drag-select while moving or resizing a floating overlay. */
    beginFloatingObjectDrag() {
      this.m_FloatingObjectDragging = true;
      this.m_MouseDown = false;
      this.m_Selected = false;
      const wGrid = this.m_SkSpGridCanvas;
      if (wGrid != null) {
        wGrid.m_MouseDown = false;
        wGrid.m_DragSelecting = false;
      }
    }

    endFloatingObjectDrag() {
      this.m_FloatingObjectDragging = false;
      this.m_MouseDown = false;
      this.m_Selected = false;
      const wGrid = this.m_SkSpGridCanvas;
      if (wGrid != null) {
        wGrid.m_MouseDown = false;
        wGrid.m_DragSelecting = false;
      }
    }

    isPointerOverFloatingObject(event) {
      const wTarget = event?.target;
      if (wTarget == null || typeof wTarget.closest !== "function") {
        return false;
      }
      return wTarget.closest(".SkSpFloatingObject") != null;
    }

    selectFloatingObject(sName) {
      const wNext = typeof sName === "string" && sName.length > 0 ? sName : null;
      const wSame = this.m_SelectedFloatingObjectName === wNext;
      this.m_SelectedFloatingObjectName = wNext;
      if (wSame) {
        if (
          wNext != null &&
          this.m_SkSpClassAttribute != null &&
          !this.isAttributePanelPropertyEdit() &&
          !this.isPropertyRangePickerEdit()
        ) {
          this.m_SkSpClassAttribute.onFloatingObjectSelectionChanged(false);
        }
        return;
      }
      if (wNext != null) {
        void this.bringFloatingObjectToFront(wNext);
      }
      if (this.m_SkSpFloatingLayer != null) {
        this.m_SkSpFloatingLayer.notifySelectionChanged();
      }
      if (this.m_SkSpFloatingEditor != null) {
        this.m_SkSpFloatingEditor.onSelectionChanged();
      }
      if (
        this.m_SkSpClassAttribute != null &&
        !this.isAttributePanelPropertyEdit() &&
        !this.isPropertyRangePickerEdit()
      ) {
        this.m_SkSpClassAttribute.onFloatingObjectSelectionChanged(false);
      }
      if (this.m_SkSpClass != null && typeof this.m_SkSpClass.syncSelectionFromInterface === "function") {
        this.m_SkSpClass.syncSelectionFromInterface();
      }
    }

    clearFloatingObjectSelection(sInvalidate = true, sRefreshAttribute = false) {
      if (this.m_SelectedFloatingObjectName == null) {
        return;
      }
      this.m_SelectedFloatingObjectName = null;
      if (sInvalidate && this.m_SkSpFloatingLayer != null) {
        this.m_SkSpFloatingLayer.notifySelectionChanged();
      }
      if (this.m_SkSpFloatingEditor != null) {
        this.m_SkSpFloatingEditor.onSelectionChanged();
      }
      if (
        sRefreshAttribute &&
        this.m_SkSpClassAttribute != null &&
        !this.isAttributePanelPropertyEdit() &&
        !this.isPropertyRangePickerEdit()
      ) {
        void this.m_SkSpClassAttribute.Resetcursor();
      }
      if (this.m_SkSpClass != null && typeof this.m_SkSpClass.syncSelectionFromInterface === "function") {
        this.m_SkSpClass.syncSelectionFromInterface();
      }
    }

    patchFloatingObjectEntry(sName, sPatch) {
      if (!Array.isArray(this.m_FloatingObjects) || sName == null || sName === "") {
        return false;
      }
      const wIndex = this.m_FloatingObjects.findIndex((o) => o?.n === sName);
      if (wIndex < 0) {
        return false;
      }
      this.m_FloatingObjects[wIndex] = {
        ...this.m_FloatingObjects[wIndex],
        ...sPatch,
      };
      return true;
    }

    async commitFloatingObjectLayout(sName, sLayout = {}, sOptions = {}) {
      const wReload = sOptions.reload !== false;
      const wUseUndo = sOptions.undo !== false;
      const wEntry = this.findFloatingObjectEntry(sName);
      const wSheet = await this.getActiveSheet();
      const wUi = window.SkUISpreadSheet;
      if (wEntry == null || !wSheet || wUi == null || typeof wUi.floatingObjectLayout !== "function") {
        return false;
      }

      const wAnchorRef =
        typeof sLayout.anchorRef === "string" ? sLayout.anchorRef.trim() : "";
      const wNextDx = Number(sLayout.dx ?? wEntry.dx) || 0;
      const wNextDy = Number(sLayout.dy ?? wEntry.dy) || 0;
      const wNextW = Number(sLayout.w ?? wEntry.w) || 0;
      const wNextH = Number(sLayout.h ?? wEntry.h) || 0;
      const wNextOp = Number(sLayout.op ?? wEntry.op) || 1;
      // Compare against wasm baseline (pre-drag), not the locally patched entry.
      const wBaseline = sOptions.baseline ?? wEntry;
      const wLayoutUnchanged =
        sOptions.force !== true &&
        wAnchorRef === "" &&
        wNextDx === (Number(wBaseline.dx) || 0) &&
        wNextDy === (Number(wBaseline.dy) || 0) &&
        wNextW === (Number(wBaseline.w) || 0) &&
        wNextH === (Number(wBaseline.h) || 0) &&
        wNextOp === (Number(wBaseline.op) || 1);
      if (wLayoutUnchanged) {
        return true;
      }

      if (wUseUndo && typeof this.setExtraUndo === "function") {
        this.setExtraUndo();
      }

      const wOk = wUi.floatingObjectLayout(
        sName,
        wNextDx,
        wNextDy,
        wNextW,
        wNextH,
        wNextOp,
        wAnchorRef,
        wSheet,
      );
      if (!wOk) {
        return false;
      }

      if (wReload) {
        await this.loadFloatingObjectsForActiveSheet();
        const wSizeChanged =
          wNextW !== (Number(wBaseline.w) || 0) ||
          wNextH !== (Number(wBaseline.h) || 0);
        if (wSizeChanged) {
          this.patchFloatingObjectEntry(sName, { autoSpan: false });
        }
        await this.reloadView();
      } else {
        this.patchFloatingObjectEntry(sName, {
          dx: wNextDx,
          dy: wNextDy,
          w: wNextW,
          h: wNextH,
          op: wNextOp,
          ...(wNextW !== (Number(wBaseline.w) || 0) ||
          wNextH !== (Number(wBaseline.h) || 0)
            ? { autoSpan: false }
            : {}),
        });
        this.invalidateAll();
      }
      return true;
    }

    async bringFloatingObjectToFront(sName) {
      const wUi = window.SkUISpreadSheet;
      if (wUi == null || typeof wUi.floatingObjectBringToFront !== "function") {
        return false;
      }
      const wSheet = await this.getActiveSheet();
      if (!wSheet) {
        return false;
      }
      if (typeof this.setExtraUndo === "function") {
        this.setExtraUndo();
      }
      const wOk = wUi.floatingObjectBringToFront(sName, wSheet);
      if (!wOk) {
        return false;
      }
      await this.loadFloatingObjectsForActiveSheet();
      if (this.m_SkSpFloatingLayer != null) {
        this.m_SkSpFloatingLayer.notifySelectionChanged();
      }
      return true;
    }

    async commitFloatingObjectAttribute(sName, sAttribute, sValue, sOptions = {}) {
      const wOpts = sOptions && typeof sOptions === "object" ? sOptions : {};
      const wSheet = await this.getActiveSheet();
      const wUi = window.SkUISpreadSheet;
      if (!wSheet || wUi == null || typeof wUi.floatingObjectAttribute !== "function") {
        return false;
      }
      if (wOpts.undo !== false && typeof this.setExtraUndo === "function") {
        this.setExtraUndo();
      }
      let wWire = sValue != null ? String(sValue) : "";
      const wEntry = this.findFloatingObjectEntry(sName);
      const wTargetSheet =
        (typeof wEntry?.t === "string" && wEntry.t.trim()) || wSheet;
      const wHostRow = Number(wEntry?.hr) || Number(wEntry?.ar) || 0;
      const wHostCol = Number(wEntry?.hc) || Number(wEntry?.ac) || 0;
      const wKind = wOpts.kind != null ? String(wOpts.kind) : "";
      if (SkCellClass.looksLikeFloatingRangeAttributeInput(wWire, wKind)) {
        wWire = await SkCellClass.encodeFloatingRangeAttributeValue(
          wWire,
          wTargetSheet,
          wHostRow,
          wHostCol,
        );
      } else if (SkCellClass.looksLikeFloatingFormulaAttributeInput(wWire, wKind)) {
        wWire = await SkCellClass.encodeFloatingFormulaAttributeValue(wWire, wTargetSheet);
      }
      const wOk = wUi.floatingObjectAttribute(sName, sAttribute, wWire, wSheet);
      if (!wOk) {
        return false;
      }
      if (wOpts.refresh !== false) {
        await this.loadFloatingObjectsForActiveSheet();
        if (this.m_SkSpFloatingLayer != null) {
          this.m_SkSpFloatingLayer.notifyDisplayRefresh();
        }
        await this.reloadView();
      }
      return true;
    }

    async encodeCellClassAttributeWire(sItem, sTargetSheet, sHostRow = 0, sHostCol = 0) {
      if (!sItem?.n) {
        return null;
      }
      let wWire = sItem.v != null ? String(sItem.v) : "";
      const wKind = sItem.k != null ? String(sItem.k) : "";
      // comboOptions: JSON(A1:A3) without "=" must still compile as a formula.
      if (
        !SkCellClass.isRangePropertyKind(wKind) &&
        SkCellClass.looksLikeJsonOptionsFormulaBody(wWire)
      ) {
        wWire = SkCellClass.normalizeJsonOptionsAttributeInput(wWire);
      }
      if (SkCellClass.isRangePropertyKind(wKind)) {
        if (!String(sItem.v ?? "").trim()) {
          return null;
        }
        // Normalize host-relative R1C1 before validation (panel may still show legacy form).
        if (SkCellClass.looksLikeR1C1RangeRef(wWire)) {
          const wA1 = SkCellClass.coerceRangeTokenToA1(wWire, sHostRow, sHostCol);
          if (wA1) {
            wWire = wA1;
          }
        }
        const wValidation = SkCellClass.validateRangeAttributeValue(
          wWire,
          wKind,
          sItem.l || sItem.n,
        );
        if (!wValidation.ok) {
          return { error: wValidation.message };
        }
      }
      if (SkCellClass.looksLikeFloatingRangeAttributeInput(wWire, wKind)) {
        const wEncoded = await SkCellClass.encodeFloatingRangeAttributeValue(
          wWire,
          sTargetSheet,
          sHostRow,
          sHostCol,
        );
        console.log(
          "[SkSp] Attribute encode",
          sItem.n,
          wKind,
          wWire,
          "→",
          wEncoded,
        );
        wWire = wEncoded;
      } else if (SkCellClass.looksLikeFloatingFormulaAttributeInput(wWire, wKind)) {
        wWire = await SkCellClass.encodeFloatingFormulaAttributeValue(
          wWire,
          sTargetSheet,
        );
      } else if (SkCellClass.isEnumPropertyKind(wKind)) {
        wWire = SkCellClass.normalizeScalarAttributeInput(wWire, wKind);
      }
      return { n: sItem.n, v: wWire };
    }

    async commitAllFloatingObjectAttributes(sName, sAttributes) {
      if (!Array.isArray(sAttributes) || sAttributes.length === 0) {
        return false;
      }
      const wSheet = await this.getActiveSheet();
      const wUi = window.SkUISpreadSheet;
      if (!wSheet || wUi == null) {
        return false;
      }
      const wUseBatch = typeof wUi.floatingObjectAttributes === "function";
      if (!wUseBatch && typeof wUi.floatingObjectAttribute !== "function") {
        return false;
      }
      if (typeof this.setExtraUndo === "function") {
        this.setExtraUndo();
      }
      const wEntry = this.findFloatingObjectEntry(sName);
      const wTargetSheet =
        (typeof wEntry?.t === "string" && wEntry.t.trim()) || wSheet;
      // Host on _$$A — needed to resolve legacy R[n]C[m] range attrs to A1.
      const wHostRow = Number(wEntry?.hr) || Number(wEntry?.ar) || 0;
      const wHostCol = Number(wEntry?.hc) || Number(wEntry?.ac) || 0;
      const wWireBatch = [];
      for (const wItem of sAttributes) {
        const wWire = await this.encodeCellClassAttributeWire(
          wItem,
          wTargetSheet,
          wHostRow,
          wHostCol,
        );
        if (wWire?.error) {
          this.m_LastAttributeCommitError = wWire.error;
          await this.notifyOperationFailure(wWire.error);
          return false;
        }
        if (wWire != null) {
          wWireBatch.push(wWire);
        }
      }
      if (wWireBatch.length === 0) {
        return false;
      }
      let wOk = false;
      if (wUseBatch) {
        wOk = wUi.floatingObjectAttributes(sName, wWireBatch, wSheet);
        if (!wOk) {
          console.error(
            "commitAllFloatingObjectAttributes batch failed:",
            sName,
            wWireBatch,
          );
        }
      } else {
        wOk = true;
        for (const wWire of wWireBatch) {
          const wItemOk = wUi.floatingObjectAttribute(
            sName,
            wWire.n,
            wWire.v,
            wSheet,
          );
          if (!wItemOk) {
            console.error(
              "commitAllFloatingObjectAttributes failed:",
              sName,
              wWire.n,
              wWire.v,
            );
            wOk = false;
          }
        }
      }
      if (!wOk) {
        const wWasmMsg = await this.buildWasmErrorMessage(
          "Impossible d'appliquer les attributs de l'objet flottant.",
        );
        this.m_LastAttributeCommitError =
          wWasmMsg && !wWasmMsg.includes("empty !")
            ? wWasmMsg
            : "Impossible d'appliquer les attributs de l'objet flottant.";
        await this.notifyOperationFailure(
          this.m_LastAttributeCommitError,
          null,
          true,
        );
        return false;
      }
      this.m_LastAttributeCommitError = "";
      this.clearFormulaBarCompileError();
      await this.loadFloatingObjectsForActiveSheet();
      if (this.m_SkSpFloatingLayer != null) {
        this.m_SkSpFloatingLayer.notifyDisplayRefresh();
      }
      await this.reloadView();
      return true;
    }

    async commitAllCellClassAttributes(sCellRef, sAttributes, sSheet = "") {
      if (!sCellRef || !Array.isArray(sAttributes) || sAttributes.length === 0) {
        return false;
      }
      const wUi = window.SkUISpreadSheet;
      if (wUi == null) {
        return false;
      }
      const wUseBatch = typeof wUi.cellClassAttributes === "function";
      if (!wUseBatch && typeof wUi.valueAttribute !== "function") {
        return false;
      }
      const wSheet =
        (typeof sSheet === "string" && sSheet.trim()) ||
        (await this.getActiveSheet()) ||
        "";
      if (typeof this.setExtraUndo === "function") {
        this.setExtraUndo();
      }
      const wTargetSheet = wSheet;
      const wHostRc = SkCellClass.parseA1CellRef(sCellRef);
      const wHostRow = wHostRc?.row || 0;
      const wHostCol = wHostRc?.col || 0;
      const wWireBatch = [];
      for (const wItem of sAttributes) {
        const wWire = await this.encodeCellClassAttributeWire(
          wItem,
          wTargetSheet,
          wHostRow,
          wHostCol,
        );
        if (wWire?.error) {
          this.m_LastAttributeCommitError = wWire.error;
          await this.notifyOperationFailure(wWire.error);
          return false;
        }
        if (wWire != null) {
          wWireBatch.push(wWire);
        }
      }
      if (wWireBatch.length === 0) {
        return false;
      }
      let wOk = false;
      if (wUseBatch) {
        wOk = wUi.cellClassAttributes(sCellRef, wWireBatch, wSheet);
        if (!wOk) {
          console.error(
            "commitAllCellClassAttributes batch failed:",
            sCellRef,
            wWireBatch,
          );
        }
      } else {
        wOk = true;
        for (const wWire of wWireBatch) {
          const wItemOk = wUi.valueAttribute(
            sCellRef,
            wWire.n,
            wWire.v,
            wSheet,
          );
          if (!wItemOk) {
            console.error(
              "commitAllCellClassAttributes failed:",
              sCellRef,
              wWire.n,
              wWire.v,
            );
            wOk = false;
          }
        }
      }
      if (!wOk) {
        const wWasmMsg = await this.buildWasmErrorMessage(
          "Impossible d'appliquer les attributs.",
        );
        this.m_LastAttributeCommitError =
          wWasmMsg && !wWasmMsg.includes("empty !")
            ? wWasmMsg
            : "Impossible d'appliquer les attributs (formule invalide).";
        await this.notifyOperationFailure(
          this.m_LastAttributeCommitError,
          null,
          true,
        );
        return false;
      }
      this.m_LastAttributeCommitError = "";
      this.clearFormulaBarCompileError();
      await this.reloadView();
      if (typeof this.invalidateAll === "function") {
        this.invalidateAll();
      }
      return true;
    }

    async reloadView() {
      if (this.m_SpreadsheetDisposed) {
        return;
      }
      let wCanvas=document.getElementsByClassName("SkSpGridCanvas");
      let wCol=1;
      let wRow=1;
      if (wCanvas.length>0) {
        const cw = wCanvas[0].clientWidth;
        const ch = wCanvas[0].clientHeight;
        const { width: wWith, height: wHeight } = this.getGridInnerViewportCssPx(wCanvas[0]);
        // Opening / flex layout: first reloadView often runs before the canvas has a size — wasm JsonView then misaligns until the next interaction.
        if (cw <= 0 || ch <= 0 || wHeight <= 1 || wWith <= 1) {
          this._scheduleReloadViewWhenSized();
          return;
        }
        await this.syncFrozenPanesFromWasm();
        if (this.m_UIView!=null) {
          wRow=this.m_UIView.toprow;
          wCol=this.m_UIView.topcol;
        }
        await this.getView(wRow,wCol, wHeight,wWith);
        await this.refreshTableFilterTables();
        await this.resetView(this.m_Select.cursor());
        await this.snapScrollFirstRowAlignment();
        await this.loadFloatingObjectsForActiveSheet();
        await this.setScrollBar();
        this.invalidateAll();
        this.scheduleInvalidateSelection();
        try {
          if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
            window.dispatchEvent(new CustomEvent("sker:reloadView"));
          }
        } catch (_) {
          /* ignore */
        }
      }
    }

    /** Full workbook recalculation (cooperative WASM when available) then refresh JsonView. */
    async recalculateAllWorkbook(options = {}) {
      if (typeof window.SkUISpreadSheet?.recalculateAll !== "function") {
        throw new Error("SkUISpreadSheet.recalculateAll is not available.");
      }
      const { runCooperativeRecalculateAll } = await import("./SkCooperativeRecalc.js");
      await runCooperativeRecalculateAll({
        budgetMs: options.budgetMs != null ? options.budgetMs : 8,
        onProgress: options.onProgress,
      });
      await this.reloadViewAfterSpreadsheetMutation();
    }

    /**
     * After a local paste/move the originator can keep a stale JsonView while WASM + peers are OK.
     * Re-fetch JsonView twice (layout/recalc settle) and invalidate sheet scroll extents.
     */
    async reloadViewAfterSpreadsheetMutation() {
      this.m_JsonViewNeedsHardRefresh = true;
      this.invalidateSheetExtent();
      // Preserve the scroll anchor across the hard refresh. reloadView() reads toprow/topcol from
      // m_UIView; nulling it first would lose the position and snap the view back to A1 (e.g. F9).
      const wPrevTopRow = Number(this.m_UIView?.toprow);
      const wPrevTopCol = Number(this.m_UIView?.topcol);
      this.m_UIView = null;
      this.m_UIViewFrozen = null;
      this.m_UIViewFrozenCorner = null;
      this.m_UIViewFrozenLeft = null;
      if (Number.isFinite(wPrevTopRow) && Number.isFinite(wPrevTopCol)) {
        // Minimal anchor stub so reloadView() re-fetches JsonView at the same scroll origin.
        this.m_UIView = { toprow: wPrevTopRow, topcol: wPrevTopCol, rows: [], cols: [] };
      }
      await this.reloadView();
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      await this.reloadView();
      this.m_JsonViewNeedsHardRefresh = false;
      this.scheduleInvalidateSelection();
      this.invalidateAll();
    }

    /** Drop cached formula text (after edit or JsonView reload). */
    invalidateFormulaCache() {
      this.m_FormulaCacheRef = null;
      this.m_FormulaCacheValue = "";
    }

    /** Formula for the cursor cell; one Wasm GetFormula per ref until cache invalidation. */
    async getCursorFormulaCached() {
      const wRef = this.m_Select.cursorStr();
      if (this.m_FormulaCacheRef === wRef) {
        return this.m_FormulaCacheValue;
      }
      const wCell = this.GetCellcursor();
      let wFormulaBar = "";
      if (wCell != null && wCell.hasOwnProperty("c_f")) {
        wFormulaBar = wCell.c_f;
      } else {
        try {
          const fx = window.SkUISpreadSheet.getFormula(wRef, "", true);
          wFormulaBar = fx != null ? String(fx) : "";
        } catch (_) {
          wFormulaBar = "";
        }
      }
      this.m_FormulaCacheRef = wRef;
      this.m_FormulaCacheValue = wFormulaBar;
      return wFormulaBar;
    }

    /** Debug tab only — avoids GetFormat Wasm on every cursor move. */
    isDebugFormatEnabled() {
      return this.m_SkSpCommand?.isDebugTabActive?.() === true;
    }

    /**
     * Run invalidateSelection after the next paint frame so grid/cursor paint is not blocked.
     * Coalesces multiple requests into one rAF callback.
     */
    scheduleInvalidateSelection() {
      if (this.m_SpreadsheetDisposed || this.m_UIView === null) {
        return;
      }
      if (this._invalidateSelectionPending) {
        return;
      }
      this._invalidateSelectionPending = true;
      const wRun = () => {
        this._invalidateSelectionRafId = null;
        this._invalidateSelectionPending = false;
        if (this.m_SpreadsheetDisposed || this.m_UIView === null) {
          return;
        }
        this.invalidateSelection().catch((error) => {
          if (!this.m_SpreadsheetDisposed) {
            console.error("Error in invalidateSelection:", error);
          }
        });
      };
      if (typeof requestAnimationFrame === "function") {
        this._invalidateSelectionRafId = requestAnimationFrame(wRun);
      } else {
        queueMicrotask(wRun);
      }
    }

    /**
     * True when one or more whole rows/columns are selected via header click.
     */
    hasColRowSelect() {
      const wColN = this.m_SelectCol?.selections?.()?.length || 0;
      const wRowN = this.m_SelectRow?.selections?.()?.length || 0;
      return wColN > 0 || wRowN > 0;
    }

    /**
     * Full selection string for engine ops (format, border, raz, …).
     * When whole rows/cols are selected via headers, omit the orphan cursor cell
     * so ApplyColRowFormat runs on ColRow instead of a single cell.
     */
    selectstr() {
      if (this.hasColRowSelect()) {
        const wParts = [];
        if (this.m_Select.selections().length > 0) {
          wParts.push(this.m_Select.str());
        }
        if ((this.m_SelectCol?.selections?.()?.length || 0) > 0) {
          wParts.push(this.m_SelectCol.str());
        }
        if ((this.m_SelectRow?.selections?.()?.length || 0) > 0) {
          wParts.push(this.m_SelectRow.str());
        }
        return wParts.join(";");
      }
      return this.m_Select.str();
    }

    /**
     * Selection string for formula point-mode inserts.
     * Prefers structured table refs (@[Col] / [[Col]]) when applicable.
     * Uses the cell selection only (not col/row header selects).
     */
    formulaPickSelectstr() {
      try {
        // Primary cell/range selection only — selectstr() may append col/row
        // header picks (e.g. "D4:D8;D1:D1048576") which break formula inserts.
        let wSelect =
          this.m_Select != null && typeof this.m_Select.str === "function"
            ? this.m_Select.str()
            : this.selectstr();
        if (!wSelect) {
          return wSelect;
        }
        if (String(wSelect).includes(";")) {
          wSelect = String(wSelect).split(";")[0];
        }

        const wEdit = this.resolveInplaceEditForFormulaPick();
        if (wEdit != null) {
          let wText = "";
          try {
            const el = wEdit.m_Ref && wEdit.m_Ref.current;
            if (el && el.value != null) {
              wText = String(el.value);
            } else if (typeof wEdit.text === "function") {
              wText = String(wEdit.text() || "");
            }
          } catch (_) {
            wText = "";
          }
          const wIsFormula = wText.trimStart().startsWith("=");
          if (
            !wIsFormula &&
            wEdit.m_AcceptSelection &&
            !wEdit.m_FormulaOnlyRangePick
          ) {
            return wSelect;
          }
        }

        const wAnchor = this.editCellRef();
        if (
          !wAnchor ||
          !window.SkUISpreadSheet ||
          typeof window.SkUISpreadSheet.cellRef !== "function"
        ) {
          return wSelect;
        }
        const wRef = window.SkUISpreadSheet.cellRef(wAnchor, wSelect, "");
        return wRef != null && String(wRef).length > 0 ? String(wRef) : wSelect;
      } catch (error) {
        console.error("formulaPickSelectstr failed:", error);
        try {
          return this.m_Select != null && typeof this.m_Select.str === "function"
            ? this.m_Select.str()
            : this.selectstr();
        } catch (_) {
          return "";
        }
      }
    }

    async invalidateSelection(){
      if (this.m_SpreadsheetDisposed || this.m_UIView===null) {
        return;
      }
      if (this.m_UIView!==null) {
        const wExtendingRange = this.m_MouseDown && this.m_Selected === true;
        if (!wExtendingRange) {
          await this.syncCursorMergeHighlight();
        }
        // Place the cell value or its formula in the Edit Static edit box
        if ((this.m_Select.last()===null) && (this.m_CursorEdit===null)) {
          if (this.m_SkSpInplaceEditStatic.Disabled()) {
            await this.m_SkSpInplaceEditStatic.setTextByCursorCell();
          }
          // Attribute panel: follow cursor cell, or clear when no CellClass / no float.
          if (
            this.m_SkSpClassAttribute != null &&
            !this.isAttributePanelPropertyEdit() &&
            !this.isPropertyRangePickerEdit() &&
            this.m_Select.last() === null
          ) {
            void this.m_SkSpClassAttribute.Resetcursor();
          }
        }
        // Route range selection updates while dragging: property-level edits
        // (named range ref, attribute fields, ...) must take precedence over the
        // main cell inplace editor, which stays mounted as a hidden mirror.
        if (this.m_MouseDown) {
          if (this.isGridRangePickActive()) {
            const wInplaceEdit = this.resolveInplaceEditForFormulaPick();
            if (wInplaceEdit != null) {
              wInplaceEdit.mouseSelection(this.formulaPickSelectstr());
            }
          }
        }
        if (wExtendingRange) {
          this.m_SkSpControlPanel.selection(this.selectstr());
          persistSpreadsheetContextForAi(this);
          if (typeof this.m_SkSpAiChatSync === 'function') {
            try {
              this.m_SkSpAiChatSync();
            } catch (_) {
              /* ignore AI panel sync errors */
            }
          }
          return;
        }
        this.m_SkSpControlPanel.ref(this.m_Select.cursorStr());
       let wCell=this.GetCellcursor();
       if ((wCell!==null) && (wCell!==undefined)) {
        const wFormulaBar = await this.getCursorFormulaCached();
        this.m_SkSpControlPanel.cellValue(wFormulaBar);
        if (this.isDebugFormatEnabled()) {
          let wFormat = window.SkUISpreadSheet.getFormat(this.m_Select.cursorStr());
          if (wFormat !== "") {
            this.m_SkSpCommand.setFormatStringDebug(wFormat);
          } else {
            this.m_SkSpCommand.setFormatStringDebug("");
          }
        }
        // Keep the right-hand panel controls (font, colors, rotation) in sync
        // with the format of the cell currently under the cursor.
        if (this.m_SkSpCommand.syncFromCursor) {
          this.m_SkSpCommand.syncFromCursor(wCell);
        }
        // Same for the top toolbar (bold/italic/align/colors/font...).
        if (this.m_SkSpTopCommand && this.m_SkSpTopCommand.syncFromCursor) {
          this.m_SkSpTopCommand.syncFromCursor(wCell);
        }
       } else {
        this.m_SkSpControlPanel.cellValue("");            
       }

       this.m_SkSpControlPanel.selection(this.selectstr());
       persistSpreadsheetContextForAi(this);
       if (typeof this.m_SkSpAiChatSync === 'function') {
         try {
           this.m_SkSpAiChatSync();
         } catch (_) {
           /* ignore AI panel sync errors */
         }
       }
      }
    }

    getUseEdit() {  return(this.m_UseEdit); }

    /** Cell under the edit anchor (m_CursorEdit) — not the transient pick cursor during =SUM(A6). */
    getEditAnchorCell() {
        if (this.m_CursorEdit != null) {
            return this.getCell(this.m_CursorEdit.row(), this.m_CursorEdit.col());
        }
        return this.GetCellcursor();
    }

    /** True when the attribute panel is driving a property formula pick. */
    isAttributePanelPropertyEdit() {
      return SkSpClassAttribute.isAttributePanelPropertyEdit(this);
    }

    /** Cell overlay editor — false when the React widget already provides inplace text (Calendar, …). */
    shouldShowCellInplaceEdit() {
        if (!this.getUseEdit() || this.isPropertyRangePickerEdit()) {
            return false;
        }
        if (this.isAttributePanelPropertyEdit()) {
            return false;
        }
        const wCell = this.getEditAnchorCell();
        if (wCell == null) {
            return true;
        }
        return !shouldBypassCellInplaceOverlay(wCell);
    }

    /** Formula bar / F2 — Check & Switch are toggled in-cell only (attribute panel still allowed). */
    isCursorInplaceEditBlocked() {
        if (this.m_SkSpInplaceEditProperty != null) {
            return false;
        }
        const wCell = this.getEditAnchorCell();
        return isInplaceEditBlockedCellClass(wCell);
    }

    /** Inplace editor that currently has DOM focus (formula bar vs cell overlay). */
    getActiveInplaceEdit() {
        const wCandidates = [
            this.m_SkSpInplaceEditProperty,
            this.m_SkSpInplaceEditStatic,
            this.m_SkSpInplaceEdit,
        ].filter((wEd) => wEd != null);
        const wActiveEl =
            typeof document !== "undefined" ? document.activeElement : null;
        for (const wEd of wCandidates) {
            const el = wEd.m_Ref && wEd.m_Ref.current;
            if (el && wActiveEl === el) {
                return wEd;
            }
        }
        return null;
    }

    /** Any mounted editor caret is in formula point mode (=SUM(). */
    isAnyEditorInFormulaPointMode() {
        const wEditors = [
            this.m_SkSpInplaceEditProperty,
            this.m_SkSpInplaceEditStatic,
            this.m_SkSpInplaceEdit,
        ].filter((wEd) => wEd != null);
        return wEditors.some(
            (wEd) =>
                typeof wEd.isFormulaPointMode === "function" &&
                wEd.isFormulaPointMode()
        );
    }

    /** Editor that should receive A1 refs — focused first, else any editor in point mode. */
    resolveInplaceEditForFormulaPick() {
        const wFocused = this.getActiveInplaceEdit();
        if (wFocused != null) {
            return wFocused;
        }
        const wEditors = [
            this.m_SkSpInplaceEditStatic,
            this.m_SkSpInplaceEdit,
            this.m_SkSpInplaceEditProperty,
        ].filter((wEd) => wEd != null);
        for (const wEd of wEditors) {
            if (
                typeof wEd.isFormulaPointMode === "function" &&
                wEd.isFormulaPointMode()
            ) {
                return wEd;
            }
        }
        return this.getInplaceEditForGridMouse();
    }

    /** Text of the active property-level inplace editor, if any. */
    activePropertyEditText() {
        const wEd = this.m_SkSpInplaceEditProperty;
        if (wEd == null) {
            return "";
        }
        const el = wEd.m_Ref && wEd.m_Ref.current;
        if (el && el.value != null) {
            return String(el.value);
        }
        if (typeof wEd.text === "function") {
            const wText = wEd.text();
            return wText != null ? String(wText) : "";
        }
        return "";
    }

    /** True when a grid click should insert a ref into the active inplace editor (=SUM(A6)). */
    isFormulaPickActive() {
        if (!this.getUseEdit()) {
            return false;
        }
        if (this.isAnyEditorInFormulaPointMode()) {
            return true;
        }
        const wEd = this.m_SkSpInplaceEditProperty;
        if (wEd != null) {
            if (this.isAttributePanelPropertyEdit()) {
                if (
                    typeof wEd.isToolbarLikePropertyStatic === "function" &&
                    wEd.isToolbarLikePropertyStatic()
                ) {
                    if (
                        typeof wEd.isAttributeRangePropertyStatic === "function" &&
                        wEd.isAttributeRangePropertyStatic()
                    ) {
                        return (
                            typeof wEd.isRangePickActive === "function" &&
                            wEd.isRangePickActive()
                        );
                    }
                    if (
                        typeof wEd.isFormulaPointMode === "function" &&
                        wEd.isFormulaPointMode()
                    ) {
                        return true;
                    }
                    if (
                        this.m_MouseDown &&
                        typeof wEd.isFormulaPointModeFromCaret === "function" &&
                        wEd.m_FormulaPickCaretStart != null
                    ) {
                        const wText = this.activePropertyEditText();
                        return wEd.isFormulaPointModeFromCaret(
                            wEd.m_FormulaPickCaretStart,
                            wEd.m_FormulaPickCaretEnd,
                            wText
                        );
                    }
                    return false;
                }
                return this.activePropertyEditText().trimStart().startsWith("=");
            }
            if (wEd.m_FormulaOnlyRangePick) {
                return (
                    typeof wEd.isRangePickActive === "function" &&
                    wEd.isRangePickActive()
                );
            }
            if (wEd.m_AcceptSelection) {
                return false;
            }
            return true;
        }
        // Caret detection can fail while the pick cursor is on a class cell — still treat leading "=" as formula pick.
        if (this.m_CursorEdit != null) {
            const wEditors = [
                this.m_SkSpInplaceEditStatic,
                this.m_SkSpInplaceEdit,
            ].filter((wEditor) => wEditor != null);
            for (const wEditor of wEditors) {
                const el = wEditor.m_Ref && wEditor.m_Ref.current;
                const wText = el && el.value != null ? String(el.value) : "";
                if (wText.trimStart().startsWith("=")) {
                    return true;
                }
            }
        }
        return false;
    }

    /** True when grid clicks/arrows should feed A1 refs into a side-panel or formula editor. */
    isGridRangePickActive() {
        if (!this.getUseEdit()) {
            return false;
        }
        if (this.isFormulaPickActive()) {
            return true;
        }
        if (this.isPropertyRangePickerEdit()) {
            return true;
        }
        return false;
    }

    /** Insert picked cell/range into formula edit — used when clicking React cell-class widgets. */
    async pickCellRefForActiveEdit(sRow, sCol, sKeepSelection = false) {
        let wRow = Number(sRow);
        let wCol = Number(sCol);
        if (!Number.isFinite(wRow) || !Number.isFinite(wCol)) {
            return;
        }

        if (!sKeepSelection) {
            this.razAllselect();
        }

        const wMerged = await this.returnMerged(wRow, wCol);
        if (wMerged != null) {
            wRow = wMerged.r_t;
            wCol = wMerged.r_l;
        }
        this.applyCursorMergeHighlight(wMerged);
        this.m_Select.setCursor(new tPoint(wRow, wCol));
        this.invalidateOverlays();

        this.m_MouseDown = true;
        this.m_Selected = false;
        this.scheduleInvalidateSelection();
        this.m_MouseDown = false;

        this.focusActiveInplaceEdit();
        this.sendMoveCell(this.cursor());
        if (this.m_SkSpGridCanvas != null) {
            this.m_SkSpGridCanvas.invalidateAll();
        }
    }

    /** Editor that receives grid clicks during an edit session (fallback priority). */
    getInplaceEditForGridMouse() {
      if (this.m_SkSpInplaceEditProperty != null) {
        return this.m_SkSpInplaceEditProperty;
      }
      if (this.m_SkSpInplaceEdit != null) {
        return this.m_SkSpInplaceEdit;
      }
      return this.m_SkSpInplaceEditStatic;
    }

    /** Text from the active inplace editor during a grid edit session. */
    getFormulaEditText() {
      if (!this.getUseEdit()) {
        return "";
      }
      const wEd = this.getInplaceEditForGridMouse();
      if (wEd == null || typeof wEd.text !== "function") {
        return "";
      }
      const wText = wEd.text();
      return wText != null ? String(wText) : "";
    }

    /**
     * Resolved refs for the formula currently being edited (cached by formula + host cell).
     * @returns {Promise<{syntaxError:boolean,errorLine:number,errorColumn:number,refs:Array}>}
     */
    async getFormulaEditRefs() {
      const empty = { syntaxError: false, errorLine: 0, errorColumn: 0, refs: [] };
      if (!this.getUseEdit() || this.isPropertyRangePickerEdit()) {
        return empty;
      }
      const wText = this.getFormulaEditText();
      if (!wText.trimStart().startsWith("=")) {
        return empty;
      }
      if (this.m_CursorEdit == null) {
        return empty;
      }
      const wSheet = this.m_UIView != null ? String(this.m_UIView.sheet || "") : "";
      const wRow = this.m_CursorEdit.row();
      const wCol = this.m_CursorEdit.col();
      const wKey = `${wSheet}\0${wRow}\0${wCol}\0${wText}`;
      if (this.m_FormulaRefsCache != null && this.m_FormulaRefsCache.key === wKey) {
        return this.m_FormulaRefsCache.data;
      }
      const wApi = window.SkUISpreadSheet;
      if (wApi == null || typeof wApi.collectFormulaRefs !== "function") {
        return empty;
      }
      try {
        const wData = wApi.collectFormulaRefs(wText, wSheet, wRow, wCol);
        this.m_FormulaRefsCache = { key: wKey, data: wData ?? empty };
        return this.m_FormulaRefsCache.data;
      } catch (e) {
        console.error("getFormulaEditRefs failed:", e);
        return empty;
      }
    }

    /** Keep m_CursorEdit on the class host cell while the attribute panel picks on the grid. */
    syncAttributeEditAnchorCursor() {
        if (!this.isAttributePanelPropertyEdit()) {
            return false;
        }
        const wAttr = this.m_SkSpClassAttribute;
        if (wAttr == null) {
            return false;
        }
        if (typeof wAttr.ensureClassAnchorCell === "function") {
            wAttr.ensureClassAnchorCell();
        }
        if (wAttr.m_AnchorRow == null || wAttr.m_AnchorCol == null) {
            return false;
        }
        const wAnchorRow = wAttr.m_AnchorRow;
        const wAnchorCol = wAttr.m_AnchorCol;
        const wSame =
            this.m_CursorEdit != null &&
            this.m_CursorEdit.row() === wAnchorRow &&
            this.m_CursorEdit.col() === wAnchorCol;
        this.m_CursorEdit = new tPoint(wAnchorRow, wAnchorCol);
        return !wSame;
    }

    async refreshAttributeEditAnchorOverlay() {
        if (this.m_CursorEdit == null) {
            return;
        }
        try {
            const wRect = await this.getRectPixelByColRow(
                this.m_CursorEdit.row(),
                this.m_CursorEdit.col()
            );
            if (wRect != null && wRect.Width > 0 && wRect.Height > 0) {
                this.setInplaceEditOverlayRect(wRect);
            }
        } catch (error) {
            console.error("refreshAttributeEditAnchorOverlay failed:", error);
        }
    }

    /** Arrow keys on the grid while editing a formula — move cursor and insert A1 into the editor. */
    async cursorMoveKeyForFormulaEdit(event) {
        const wMoved = await this.cursorMoveKey(event);
        if (this.isAttributePanelPropertyEdit()) {
            const wResynced = this.syncAttributeEditAnchorCursor();
            if (wResynced) {
                await this.refreshAttributeEditAnchorOverlay();
            }
        }
        if (wMoved) {
            this.invalidateCanvas();
        }
        const wEdit = this.resolveInplaceEditForFormulaPick();
        if (wEdit == null) {
            return wMoved;
        }
        const wSelect = this.formulaPickSelectstr();
        if (
          wEdit.m_AcceptSelection &&
          !(
            typeof wEdit.isToolbarLikePropertyStatic === "function" &&
            wEdit.isToolbarLikePropertyStatic() &&
            !(
              typeof wEdit.isAttributeRangePropertyStatic === "function" &&
              wEdit.isAttributeRangePropertyStatic()
            )
          )
        ) {
            wEdit.applyPickedSelection(wSelect);
        } else if (typeof wEdit.mouseSelection === "function") {
            wEdit.mouseSelection(wSelect);
        }
        this.focusActiveInplaceEdit();
        if (this.m_SkSpGridCanvas != null) {
            this.m_SkSpGridCanvas.invalidateAll();
        }
        return wMoved;
    }

    /** Keep formula/cell editor focused after picking a ref from the grid (Excel-like). */
    focusActiveInplaceEdit() {
      let wEdit = this.resolveInplaceEditForFormulaPick();
      if (wEdit == null) {
        wEdit = this.getInplaceEditForGridMouse();
      }
      if (wEdit == null) {
        return false;
      }
      const wFocus = () => {
        const el = wEdit.m_Ref && wEdit.m_Ref.current;
        if (!el) {
          return;
        }
        const wSelStart = el.selectionStart;
        const wSelEnd = el.selectionEnd;
        const wHadSelection = wSelEnd > wSelStart;
        try {
          el.focus({ preventScroll: true });
        } catch (_) {
          el.focus();
        }
        // focus() collapses the picked A1 token — restore so the next grid move replaces it.
        if (wHadSelection) {
          el.setSelectionRange(wSelStart, wSelEnd);
        }
        if (typeof wEdit.scrollCellEditCaretIntoView === 'function') {
          wEdit.scrollCellEditCaretIntoView(el);
        }
      };
      wFocus();
      if (typeof window !== 'undefined' && window.requestAnimationFrame) {
        window.requestAnimationFrame(wFocus);
      }
      return true;
    }

    /** Resolve row/col for a grid click, including merged-cell top-left anchor. */
    async cellFromGridMouse(sX, sY) {
      let wCol = await this.colByPixel(sX);
      let wRow = await this.rowByPixel(sY);
      const wMerged = await this.returnMerged(wRow, wCol);
      if (wMerged != null) {
        wRow = wMerged.r_t;
        wCol = wMerged.r_l;
      }
      return { row: wRow, col: wCol };
    }

    /** Side-panel range picker (function target/args, named range ref, …). */
    isPropertyRangePickerEdit() {
      const wEd = this.m_SkSpInplaceEditProperty;
      if (wEd == null) {
        return false;
      }
      // Attribute panel keeps dual grid cursors (class anchor + pick cursor).
      if (this.isAttributePanelPropertyEdit()) {
        return false;
      }
      if (wEd.m_ToolbarLike && wEd.m_Property != null) {
        return true;
      }
      if (wEd.m_FormulaOnlyRangePick) {
        return (
          typeof wEd.isRangePickActive === "function" &&
          wEd.isRangePickActive()
        );
      }
      return wEd.m_AcceptSelection === true;
    }

    setInplaceEditOverlayRect(sRect) {
      this.m_InplaceEditOverlayRect = sRect;
    }

    clearInplaceEditOverlayRect() {
      this.m_InplaceEditOverlayRect = null;
    }

    /** Clear formula bar syntax banner (bottom panel). */
    clearFormulaBarCompileError() {
      if (
        this.m_SkSpControlPanel != null &&
        typeof this.m_SkSpControlPanel.setEditError === 'function'
      ) {
        this.m_SkSpControlPanel.setEditError('');
      }
    }

    /** Reads Lemon/compiler output after Value() failure (wasm CompileError* bindings). */
    async readWasmCompileDiagnostics() {
      if (window.SkUISpreadSheet == null) {
        return { summary: '', detail: '', line: 0, col: 0 };
      }
      try {
        const [summary, detail, lineRaw, colRaw] = await Promise.all([
          window.SkUISpreadSheet.compileError(),
          window.SkUISpreadSheet.compileErrorWithDetail(),
          window.SkUISpreadSheet.compileErrorLine(),
          window.SkUISpreadSheet.compileErrorColumn(),
        ]);
        return {
          summary: typeof summary === 'string' ? summary : '',
          detail: typeof detail === 'string' ? detail : '',
          line: Number(lineRaw),
          col: Number(colRaw),
        };
      } catch (_) {
        return { summary: '', detail: '', line: 0, col: 0 };
      }
    }

    /** Build a user-facing message from wasm diagnostics (formula or attribute undo failure). */
    async buildWasmErrorMessage(sFallback, jsError = null) {
      const diag = await this.readWasmCompileDiagnostics();
      const parts = [];
      if (diag.summary) {
        parts.push(diag.summary);
      }
      if (diag.detail && diag.detail !== diag.summary) {
        // Avoid duplicating a bare formula when summary already describes the error.
        const wDetail = String(diag.detail);
        const wLooksLikeBareFormula =
          !wDetail.includes(' ') &&
          (/^[A-Z_][A-Z0-9_]*\s*\(/i.test(wDetail) ||
            wDetail.startsWith('Formula error:'));
        if (wLooksLikeBareFormula && diag.summary) {
          // keep summary only
        } else {
          parts.push(wDetail);
        }
      }
      if (!diag.detail && !diag.summary && jsError != null && jsError.message) {
        parts.push(String(jsError.message));
      } else if (jsError != null && jsError.message) {
        parts.push(String(jsError.message));
      }
      let wBanner = parts.filter(Boolean).join(' — ') || '';
      if (wBanner.includes('empty !')) {
        wBanner = diag.summary || '';
      }
      const wFallback =
        typeof sFallback === 'string' && sFallback.trim() !== ''
          ? sFallback.trim()
          : 'Operation failed';
      return wBanner !== '' ? wBanner : wFallback;
    }

    /** Set formula-bar error banner without merging stale wasm compile diagnostics. */
    setEditErrorMessage(message) {
      if (
        this.m_SkSpControlPanel != null &&
        typeof this.m_SkSpControlPanel.setEditError === 'function'
      ) {
        this.m_SkSpControlPanel.setEditError(
          typeof message === 'string' ? message : ''
        );
      }
    }

    /** Show bottom banner after a failed undo/commit; returns the message shown. */
    async notifyOperationFailure(sFallback, jsError = null, sExact = false) {
      const wMessage = sExact
        ? (typeof sFallback === 'string' ? sFallback : '')
        : await this.buildWasmErrorMessage(sFallback, jsError);
      if (
        this.m_SkSpControlPanel != null &&
        typeof this.m_SkSpControlPanel.setEditError === 'function'
      ) {
        this.m_SkSpControlPanel.setEditError(wMessage);
      } else {
        console.warn('[Spreadsheet]', wMessage);
      }
      return wMessage;
    }

    /** Show banner + caret at error row/column after commit failure or wasm rejection. */
    async notifyFormulaCompileFailure(sourceText, jsError) {
      const diag = await this.readWasmCompileDiagnostics();
      const message = await this.buildWasmErrorMessage('Formula error', jsError);
      if (
        this.m_SkSpControlPanel != null &&
        typeof this.m_SkSpControlPanel.setEditError === 'function'
      ) {
        this.m_SkSpControlPanel.setEditError(message);
      } else {
        console.warn('[Spreadsheet]', message);
      }

      const editor =
        this.m_SkSpInplaceEditProperty != null && this.m_SkSpInplaceEditProperty !== undefined
          ? this.m_SkSpInplaceEditProperty
          : this.m_SkSpInplaceEditStatic;
      const line = diag.line;
      const col = Number.isFinite(diag.col) ? diag.col : 0;
      if (
        editor != null &&
        typeof editor.setCaretAtCompileError === 'function' &&
        Number.isFinite(line) &&
        line > 0
      ) {
        editor.setCaretAtCompileError(typeof sourceText === 'string' ? sourceText : '', line, col);
      }
    }

    // Property
    pushInplaceEdit(sInplaceEdit) {
      this.m_SkSpInplaceEditProperty=sInplaceEdit;
    }

    popInplaceEdit() {
      this.m_SkSpInplaceEditProperty=null;
    }

    // Kept async so callers can chain .then() symmetrically with
    // validEdit() (see SkSpControlPanel.edit); the body itself is
    // synchronous today but the contract is "returns a promise that
    // resolves when the edit session is ready".
    /** Formula bar / edit icon: enable edit, load cell value, focus caret. */
    async activateFormulaBarEdit() {
      if (isActiveSpreadsheetReadOnly()) {
        return false;
      }
      const wStatic = this.m_SkSpInplaceEditStatic;
      if (!wStatic || typeof wStatic.setTextByCursorCell !== 'function') {
        return false;
      }
      if (!this.getUseEdit()) {
        await this.beginEdit();
      }
      wStatic.setDisabled(false);
      await wStatic.setTextByCursorCell();
      const el = wStatic.m_Ref && wStatic.m_Ref.current;
      if (el) {
        el.readOnly = false;
        el.focus();
        const len = el.value != null ? el.value.length : 0;
        el.setSelectionRange(len, len);
        if (typeof wStatic.scrollCellEditCaretIntoView === 'function') {
          wStatic.scrollCellEditCaretIntoView(el);
        }
      }
      if (this.m_SkSpGridCanvas != null) {
        this.m_SkSpGridCanvas.invalidateAll();
      }
      return true;
    }

    async beginEdit() {
      if (isActiveSpreadsheetReadOnly()) {
        return;
      }
      this.clearFormulaBarCompileError();
      // Attribute panel: edit in the side field, but keep class-cell anchor + pick cursor on the grid.
      if (this.isAttributePanelPropertyEdit()) {
        if (
          !this.isGridRangePickActive() &&
          this.getUseEdit()
        ) {
          const wAttrEd = this.m_SkSpInplaceEditProperty;
          const wAttrEl = wAttrEd?.m_Ref?.current;
          const wActiveEl =
            typeof document !== "undefined" ? document.activeElement : null;
          if (wAttrEl == null || wActiveEl !== wAttrEl) {
            await this.endEdit();
          } else {
            this.m_UseEdit = true;
            this.syncAttributeEditAnchorCursor();
            await this.refreshAttributeEditAnchorOverlay();
            if (this.m_SkSpGridCanvas != null) {
              this.m_SkSpGridCanvas.invalidateAll();
            }
            return;
          }
        } else {
          this.m_UseEdit = true;
          this.syncAttributeEditAnchorCursor();
          await this.refreshAttributeEditAnchorOverlay();
          if (this.m_SkSpGridCanvas != null) {
            this.m_SkSpGridCanvas.invalidateAll();
          }
          return;
        }
      }
      // Range pickers in the right panel must not freeze a second "edit anchor"
      // cursor or mount the cell overlay — only the live selection is shown.
      // Keep m_UseEdit true so isGridRangePickActive() can route grid clicks
      // into the panel field (Target / Arguments / named-range Ref, …).
      if (this.isPropertyRangePickerEdit()) {
        this.m_UseEdit = true;
        this.m_CursorEdit = null;
        this.clearInplaceEditOverlayRect();
        if (this.m_SkSpGridCanvas != null) {
          this.m_SkSpGridCanvas.invalidateAll();
        }
        return;
      }
      this.m_UseEdit = true;
      // Scroll the edit anchor into view before mounting the cell overlay. Otherwise
      // getRectPixelCursor() returns an empty rect and InplaceEdit/cursor paint at (0,0).
      const wEditCursor = this.m_Select?.cursor?.();
      if (
        wEditCursor != null &&
        this.m_UIView != null &&
        !this.isRowColVisibleInGrid(wEditCursor.row(), wEditCursor.col())
      ) {
        await this.resetView(wEditCursor);
        await this.setScrollBar();
      }
      this.beginCursorEdit();
      if (this.m_SkSpInplaceEditProperty === null) {
        this.m_SkSpInplaceEditStatic.setDisabled(false);
      }
      if (this.m_SkSpGridCanvas != null) {
        this.m_SkSpGridCanvas.invalidateAll();
      }
      if (!this.shouldShowCellInplaceEdit()) {
        await this.activateFormulaBarEdit();
        const wChar = this.lastChar();
        if (wChar !== "") {
          const wStatic = this.m_SkSpInplaceEditStatic;
          const el = wStatic && wStatic.m_Ref && wStatic.m_Ref.current;
          if (el) {
            wStatic.setText(wChar);
            el.value = wChar;
            const wLen = wChar.length;
            el.setSelectionRange(wLen, wLen);
            this.setLastChar("");
          }
        }
      }
    }

    focusGridCanvas() {
      if (
        this.m_SkSpGridCanvas &&
        typeof this.m_SkSpGridCanvas.restoreCanvasFocus === 'function'
      ) {
        this.m_SkSpGridCanvas.restoreCanvasFocus();
      }
    }

    async endEdit() {
      this.clearFormulaBarCompileError();
      if (this.m_SkSpInplaceEditProperty===null) {
        this.m_SkSpInplaceEditStatic.setDisabled(true);
      } else {
        if (this.m_SkSpClassAttribute!==null) await this.m_SkSpClassAttribute.endEdit();
        const wPropEd = this.m_SkSpInplaceEditProperty;
        if (
          wPropEd != null &&
          typeof wPropEd.isToolbarLikePropertyStatic === "function" &&
          wPropEd.isToolbarLikePropertyStatic() &&
          typeof wPropEd.setDisabled === "function"
        ) {
          wPropEd.setDisabled(true);
        }
        this.popInplaceEdit();
      }
      this.m_UseEdit=false;
      this.m_FormulaRefsCache = null;
      this.clearInplaceEditOverlayRect();
      this.endCursorEdit();
    
      this.invalidateAll();
      this.scheduleInvalidateSelection();
      this.focusGridCanvas();
    }

    editCellRef() {
      if (this.m_CursorEdit != null) {
        return (
          window.SkUISpreadSheet.base10toAlphaSync(this.m_CursorEdit.col()) +
          this.m_CursorEdit.row()
        );
      }
      if (this.m_Select != null && typeof this.m_Select.cursorStr === "function") {
        return this.m_Select.cursorStr();
      }
      return null;
    }

    async validEdit() {
      let wText= "";
      if (this.m_SkSpInplaceEditProperty===null) {
        wText=this.m_SkSpInplaceEditStatic.text();
      } else {
        wText=this.m_SkSpInplaceEditProperty.text();
      }

      if (this.isAttributePanelPropertyEdit()) {
        this.syncAttributeEditAnchorCursor();
      } else if (this.m_CursorEdit == null) {
        this.beginCursorEdit();
      }

      if (this.isCursorInplaceEditBlocked()) {
        if (this.getUseEdit() && this.isFormulaPickActive()) {
          return true;
        }
        // Formulas on Check/Switch are allowed — UI block is for toggle/overlay only.
        const wTrim = (wText != null ? String(wText) : "").trim();
        if (!wTrim.startsWith("=")) {
          if (this.getUseEdit()) {
            await this.endEdit();
          }
          return true;
        }
      }

      let wCompilOk = false;
      try {
        wCompilOk = await this.setValue(wText);
      } catch (e) {
        console.error(e);
        await this.notifyFormulaCompileFailure(wText, e);
        return false;
      }
      if (!wCompilOk) {
        await this.notifyFormulaCompileFailure(wText, null);
        return false;
      }

      this.clearFormulaBarCompileError();
      await this.reloadView();
      await this.endEdit();
      return true;
    }


    setLastChar(sChar) { this.m_LastChar=sChar; }
    lastChar() { return(this.m_LastChar); }

    beginCursorEdit() {
      this.m_CursorEdit=new tPoint(this.m_Select.cursor().row(),this.m_Select.cursor().col());
    }

    endCursorEdit() {
      if (this.m_CursorEdit == null) {
        return;
      }
      this.setCursor(this.m_CursorEdit.row(), this.m_CursorEdit.col());
      this.m_CursorEdit = null;
    }

    select() { return(this.m_Select); }
    cursor() { return(this.m_Select.cursor()); }

    razAllselect() {
      this.m_Select.raz();
      this.m_SelectRow.raz();
      this.m_SelectCol.raz();
    }

    async _loadJsonViewSingle(sRow, sCol, sHeight, sWidth) {
      await this.ensureSheetExtent();
      await this.ensureWasmActiveSheetMatchesUi();
      const { jsonW, jsonH } = this._jsonViewExtentPx(sWidth, sHeight);
      const wJson = window.SkUISpreadSheet.jsonView(sRow, sCol, jsonH, jsonW, this.m_DiffY, this.m_DiffX, "");
      try {
        this.m_UIView = JSON.parse(wJson);
        this.m_UIViewFrozen = null;
        this.m_UIViewFrozenCorner = null;
        this.m_UIViewFrozenLeft = null;
        this.m_FrozenPixH = 0;
        this.m_FrozenPixW = 0;
        this.invalidateFormulaCache();
        if (this.m_UIView === null) {
          this.m_UIView = {
            toprow: sRow,
            topcol: sCol,
            lastrow: sRow,
            lastcol: sCol,
            rows: [],
            cols: [],
          };
        }
      } catch (error) {
        console.error(error);
        console.log(wJson);
      }
      this._hydrateAllJsonViewPanes();
    }

    /**
     * Pixel height of the frozen band as laid out in JsonView (must match clip + scroll translate).
     * SumPixelHeight(1..N) can differ from the JsonView row.s accumulation → split misalignment and
     * overlapped row labels (e.g. "5" over "28").
     */
    _frozenBandPixelHeightFromJson(frozenUi) {
      if (!frozenUi || !Array.isArray(frozenUi.rows) || frozenUi.rows.length === 0) {
        return 0;
      }
      // Grid line stroke and AA extend slightly past cell boxes; without padding the last frozen row can look clipped and the first scroll row overlaps ("à cheval").
      const gw = Number(this.m_GridWidth);
      const gridPad = Number.isFinite(gw) && gw > 0 ? Math.max(2, Math.ceil(gw * 2)) : 2;
      // Strokes are centered on row boundaries; the bottom line of the last frozen row extends below row.s sums.
      const lastRowStrokePad =
        Number.isFinite(gw) && gw > 0 ? Math.max(3, Math.ceil(gw * 4)) : 3;

      let h = Number(frozenUi.dY) || 0;
      for (const row of frozenUi.rows) {
        h += Number(row.s) || 0;
      }
      const rowSumBottom = h;
      let maxInk = h;
      for (const row of frozenUi.rows) {
        if (!row.cells) {
          continue;
        }
        for (const cell of row.cells) {
          if (cell == null || typeof cell !== "object") {
            continue;
          }
          const cy = Number(cell.c_y);
          const ch = Number(cell.c_h);
          if (Number.isFinite(cy) && Number.isFinite(ch)) {
            maxInk = Math.max(maxInk, cy + ch);
          }
        }
      }
      // Merged c_h can extend far below the last frozen row while ink is clipped at paint time.
      // Using that for the split band inflates SkSpGridPanelFrozen height and leaves a white gap above row fr+1.
      const maxInkClamped = Math.min(maxInk, rowSumBottom + lastRowStrokePad);
      // Ceil: avoid under-sized band when JsonView uses fractional geometry.
      return Math.ceil(Math.max(h, maxInkClamped) + gridPad + lastRowStrokePad);
    }

    /**
     * Frozen JsonView is requested with extra height (padding) so cells are not truncated; WASM may
     * then emit rows past m_FrozenRowEnd. Those rows must not be painted in the frozen pane or they
     * duplicate the scroll pane (splitY shows rows 16–18 twice).
     */
    _frozenUiClampedToRowEnd(frozenUi) {
      if (!frozenUi || !Array.isArray(frozenUi.rows)) {
        return frozenUi;
      }
      const fr = this.m_FrozenRowEnd;
      if (!(fr > 0)) {
        return frozenUi;
      }
      const rows = frozenUi.rows.filter((r) => Number(r.i) <= fr);
      if (rows.length === frozenUi.rows.length) {
        return frozenUi;
      }
      const lastI = rows.length ? Number(rows[rows.length - 1].i) : fr;
      return {
        ...frozenUi,
        rows,
        lastrow: lastI,
      };
    }

    /** Clamped frozen UI for painting, row headers, and band-height math (see _frozenUiClampedToRowEnd). */
    frozenUiForPaint() {
      return this._frozenUiClampedToRowEnd(this.m_UIViewFrozen);
    }

    /**
     * Pixel width of the frozen column band from JsonView column geometry (dX + cols[].s).
     * Do not add merged-cell c_w here: a merge like A1:N1 reports the full span in c_w and would
     * push m_FrozenPixW to ~client width — clipping the scroll headers (B, C, …) and the main pane.
     */
    _frozenBandPixelWidthFromJson(frozenUi) {
      if (!frozenUi || !Array.isArray(frozenUi.cols) || frozenUi.cols.length === 0) {
        return 0;
      }
      let w = Number(frozenUi.dX) || 0;
      for (const col of frozenUi.cols) {
        w += Number(col.s) || 0;
      }
      const gw = Number(this.m_GridWidth);
      const gridPad = Number.isFinite(gw) && gw > 0 ? Math.max(2, Math.ceil(gw * 2)) : 2;
      const lastColStrokePad = Number.isFinite(gw) && gw > 0 ? Math.max(3, Math.ceil(gw * 4)) : 3;
      return Math.ceil(w + gridPad + lastColStrokePad);
    }

    /**
     * JsonView for frozen columns may include columns past m_FrozenColEnd when padded; drop them for paint/hit-test.
     */
    _frozenUiClampedToColEnd(frozenUi) {
      if (!frozenUi || !Array.isArray(frozenUi.cols)) {
        return frozenUi;
      }
      const fc = this.m_FrozenColEnd;
      if (!(fc > 0)) {
        return frozenUi;
      }
      const cols = frozenUi.cols.filter((c) => Number(c.i) <= fc);
      if (cols.length === frozenUi.cols.length) {
        return frozenUi;
      }
      const lastI = cols.length ? Number(cols[cols.length - 1].i) : fc;
      return {
        ...frozenUi,
        cols,
        lastcol: lastI,
      };
    }

    /** Left / bottom-left frozen column strip (clamped). */
    frozenLeftUiForPaint() {
      return this._frozenUiClampedToColEnd(this.m_UIViewFrozenLeft);
    }

    /** Top-left corner when both row and column splits are active (clamped on both axes). */
    frozenCornerUiForPaint() {
      let u = this.m_UIViewFrozenCorner;
      if (!u) {
        return null;
      }
      u = this._frozenUiClampedToRowEnd(u);
      return this._frozenUiClampedToColEnd(u);
    }

    /** Column split is active only when we have a measured frozen band width (same idea as isFrozenSplitActive). */
    isFrozenColSplitActive() {
      return this.m_FrozenColEnd > 0 && this.m_FrozenPixW > 0;
    }

    isFrozenFourPaneActive() {
      return this.isFrozenSplitActive() && this.isFrozenColSplitActive();
    }

    /**
     * Frozen row band offset in canvas CSS px — must match SkSpGridCanvas (Math.ceil of stored band height).
     */
    _frozenBandOffsetYPx() {
      return this.m_FrozenPixH > 0 ? Math.ceil(Number(this.m_FrozenPixH) || 0) : 0;
    }

    /**
     * Frozen column band offset in canvas CSS px — must match SkSpGridCanvas (Math.ceil of stored band width).
     */
    _frozenBandOffsetXPx() {
      return this.m_FrozenPixW > 0 ? Math.ceil(Number(this.m_FrozenPixW) || 0) : 0;
    }

    /**
     * Pixel size of the JsonView pane that contains (sRow, sCol), in the same coordinate system as
     * cell c_x / c_y (grid inner CSS px). Used to clip cell-class React overlays when merges spill
     * past the visible edge so left/top/width/height match the clipped region.
     */
    getCellWidgetPaneClipSizeCssPx(sRow, sCol) {
      const cw = Math.max(0, Number(this.m_ClientWidth) || 0);
      const ch = Math.max(0, Number(this.m_ClientHeight) || 0);
      const fh = this._frozenBandOffsetYPx();
      const fw = this._frozenBandOffsetXPx();
      const r = Number(sRow);
      const c = Number(sCol);

      if (this.isFrozenFourPaneActive()) {
        const fr = this.m_FrozenRowEnd;
        const fc = this.m_FrozenColEnd;
        const inFrozenRow = fr > 0 && r >= 1 && r <= fr;
        const inFrozenCol = fc > 0 && c >= 1 && c <= fc;
        if (inFrozenRow && inFrozenCol) {
          return { width: fw, height: fh };
        }
        if (inFrozenRow && !inFrozenCol) {
          return { width: Math.max(1, cw - fw), height: fh };
        }
        if (!inFrozenRow && inFrozenCol) {
          return { width: fw, height: Math.max(1, ch - fh) };
        }
        return {
          width: Math.max(1, cw - fw),
          height: Math.max(1, ch - fh),
        };
      }
      if (this.isFrozenSplitActive() && !this.isFrozenColSplitActive()) {
        const fr = this.m_FrozenRowEnd;
        const inFrozenRow = fr > 0 && r >= 1 && r <= fr;
        if (inFrozenRow) {
          return { width: cw, height: fh };
        }
        return { width: cw, height: Math.max(1, ch - fh) };
      }
      if (this.isFrozenColSplitActive() && !this.isFrozenSplitActive()) {
        const fc = this.m_FrozenColEnd;
        const inFrozenCol = fc > 0 && c >= 1 && c <= fc;
        if (inFrozenCol) {
          return { width: fw, height: ch };
        }
        return { width: Math.max(1, cw - fw), height: ch };
      }
      return { width: cw, height: ch };
    }

    minHorizontalScrollCol() {
      return this.isFrozenColSplitActive() ? this.m_FrozenColEnd + 1 : 1;
    }

    /**
     * Horizontal extent (CSS px) passed to JsonView / jsonRightJustify for the scrollable pane
     * when frozen columns reserve the left band. Using full m_ClientWidth there desyncs m_DiffX
     * from jsonView(..., needScrollW) and skews the bottom-right pane vs the top-right strip.
     */
    effectiveJsonScrollWidthPx() {
      const cw = this.m_ClientWidth > 0 ? this.m_ClientWidth : 800;
      if (!this.isFrozenColSplitActive()) {
        return cw;
      }
      const fw = Number(this.m_FrozenPixW) || 0;
      return Math.max(1, cw - fw);
    }

    /**
     * Layout for A,B,… in the frozen column band (left of the vertical split). Null when no column split.
     */
    frozenColumnHeaderLayoutForPaint() {
      if (!this.isFrozenColSplitActive()) {
        return null;
      }
      const clamped = this._frozenColumnHeaderUiForPaint();
      if (!clamped || !Array.isArray(clamped.cols) || clamped.cols.length === 0) {
        return null;
      }
      const fw =
        this.m_FrozenPixW > 0 ? Math.ceil(Number(this.m_FrozenPixW) || 0) : 0;
      const layout = this._columnHeaderLayoutFromUi(clamped);
      if (layout == null) {
        return null;
      }
      return {
        ...layout,
        widthPx: fw,
      };
    }

    async getView(sRow, sCol, sHeight, sWidth) {
      if (window.SkUISpreadSheet == null) {
        return;
      }
      this.m_ClientWidth = sWidth;
      this.m_ClientHeight = sHeight;
      await this.ensureSheetExtent();

      const { jsonW } = this._jsonViewExtentPx(sWidth, sHeight);

      const rowFr = this.m_FrozenRowEnd > 0;
      const colFr = this.m_FrozenColEnd > 0;

      if (!rowFr && !colFr) {
        await this._loadJsonViewSingle(sRow, sCol, sHeight, sWidth);
        await this.setScrollBar();
        return;
      }

      const seamBleedPx = 1;

      // Column-only split: fixed left columns, main pane scrolls horizontally.
      if (!rowFr && colFr) {
        const fcEnd = this.m_FrozenColEnd;
        this.m_UIViewFrozen = null;
        this.m_UIViewFrozenCorner = null;
        this.m_FrozenPixH = 0;

        const frozenWRaw = window.SkUISpreadSheet.sumPixelWidth(1, fcEnd);
        if (!(frozenWRaw > 0) || sWidth <= frozenWRaw + 2) {
          await this._loadJsonViewSingle(sRow, sCol, sHeight, sWidth);
          await this.setScrollBar();
          return;
        }

        const frozenW = Math.min(frozenWRaw, sWidth - 2);
        const jsonWFrozen = Math.min(
          Math.max(frozenWRaw, frozenW, 1) + FROZEN_JSON_WIDTH_PAD_PX,
          JSON_VIEW_EXTENT_CAP_PX
        );

        const { jsonH } = this._jsonViewExtentPx(sHeight, sWidth);

        const wJsonLeft = window.SkUISpreadSheet.jsonView(
          sRow,
          1,
          jsonH,
          jsonWFrozen,
          this.m_DiffY,
          0,
          ""
        );
        try {
          this.m_UIViewFrozenLeft = JSON.parse(wJsonLeft);
        } catch (error) {
          console.error(error);
          this.m_UIViewFrozenLeft = null;
        }

        const leftOk =
          this.m_UIViewFrozenLeft &&
          Array.isArray(this.m_UIViewFrozenLeft.cols) &&
          this.m_UIViewFrozenLeft.cols.length > 0;

        if (!leftOk) {
          await this._loadJsonViewSingle(sRow, sCol, sHeight, sWidth);
          await this.setScrollBar();
          return;
        }

        const bandW = this._frozenBandPixelWidthFromJson(
          this._frozenUiClampedToColEnd(this.m_UIViewFrozenLeft)
        );
        const stripeBasePx = frozenWRaw;
        let bandMeasured = bandW > 0 ? bandW : stripeBasePx;
        bandMeasured = Math.min(
          bandMeasured,
          stripeBasePx + FREEZE_SEAM_BAND_EXTRA_CAP_PX
        );
        const mergedW = Math.max(stripeBasePx, bandMeasured, frozenW);
        this.m_FrozenPixW = Math.min(
          Math.max(Math.ceil(mergedW) + seamBleedPx, 1),
          sWidth - 2
        );

        const scNum = Number(sCol);
        const scrollCol = Number.isFinite(scNum)
          ? Math.max(fcEnd + 1, Math.floor(scNum))
          : fcEnd + 1;
        let needScrollW = Math.max(1, sWidth - this.m_FrozenPixW);
        needScrollW = Math.min(
          needScrollW + JSON_VIEW_SPILL_PAD_PX,
          JSON_VIEW_EXTENT_CAP_PX
        );

        const wJsonScroll = window.SkUISpreadSheet.jsonView(
          sRow,
          scrollCol,
          jsonH,
          needScrollW,
          this.m_DiffY,
          this.m_DiffX,
          ""
        );
        try {
          this.m_UIView = JSON.parse(wJsonScroll);
        } catch (error) {
          console.error(error);
          this.m_UIView = null;
        }

        if (this.m_UIView == null) {
          await this._loadJsonViewSingle(sRow, sCol, sHeight, sWidth);
          await this.setScrollBar();
          return;
        }

        await this.setScrollBar();
        return;
      }

      // Row-only split — clear column panes.
      if (rowFr && !colFr) {
        const frEnd = this.m_FrozenRowEnd;
        this.m_UIViewFrozenCorner = null;
        this.m_UIViewFrozenLeft = null;
        this.m_FrozenPixW = 0;

        const frozenHRaw = window.SkUISpreadSheet.sumPixelHeight(1, frEnd);
        if (!(frozenHRaw > 0) || sHeight <= frozenHRaw + 2) {
          await this._loadJsonViewSingle(sRow, sCol, sHeight, sWidth);
          await this.setScrollBar();
          return;
        }

        const frozenH = Math.min(frozenHRaw, sHeight - 2);
        const jsonHFrozen = Math.min(
          Math.max(frozenHRaw, frozenH, 1) + FROZEN_JSON_HEIGHT_PAD_PX,
          JSON_VIEW_EXTENT_CAP_PX
        );

        const scrollRow = Math.max(frEnd + 1, sRow);
        const wJsonFrozen = window.SkUISpreadSheet.jsonView(
          1,
          sCol,
          jsonHFrozen,
          jsonW,
          0,
          this.m_DiffX,
          ""
        );

        let frozenOk = false;
        try {
          this.m_UIViewFrozen = JSON.parse(wJsonFrozen);
          frozenOk =
            this.m_UIViewFrozen &&
            Array.isArray(this.m_UIViewFrozen.rows) &&
            this.m_UIViewFrozen.rows.length > 0;
        } catch (error) {
          console.error(error);
          this.m_UIViewFrozen = null;
        }

        if (!frozenOk) {
          await this._loadJsonViewSingle(sRow, sCol, sHeight, sWidth);
          await this.setScrollBar();
          return;
        }

        const bandH = this._frozenBandPixelHeightFromJson(
          this._frozenUiClampedToRowEnd(this.m_UIViewFrozen)
        );
        const stripeBaseHp = frozenHRaw;
        let bandMeasuredRow = bandH > 0 ? bandH : stripeBaseHp;
        bandMeasuredRow = Math.min(
          bandMeasuredRow,
          stripeBaseHp + FREEZE_SEAM_BAND_EXTRA_CAP_PX
        );
        const mergedBand = Math.max(stripeBaseHp, bandMeasuredRow, frozenH);
        this.m_FrozenPixH = Math.min(
          Math.max(Math.ceil(mergedBand) + seamBleedPx, 1),
          sHeight - 2
        );

        let needScrollH = Math.max(1, sHeight - this.m_FrozenPixH);
        needScrollH = Math.min(
          needScrollH + JSON_VIEW_SPILL_PAD_PX,
          JSON_VIEW_EXTENT_CAP_PX
        );

        const wJsonScroll = window.SkUISpreadSheet.jsonView(
          scrollRow,
          sCol,
          needScrollH,
          jsonW,
          this.m_DiffY,
          this.m_DiffX,
          ""
        );
        try {
          this.m_UIView = JSON.parse(wJsonScroll);
        } catch (error) {
          console.error(error);
          this.m_UIView = null;
        }

        if (this.m_UIView == null) {
          await this._loadJsonViewSingle(sRow, sCol, sHeight, sWidth);
          await this.setScrollBar();
          return;
        }

        await this.setScrollBar();
        return;
      }

      // Four panes: frozen rows and columns (top-left corner fixed in both axes).
      const frEnd = this.m_FrozenRowEnd;
      const fcEnd = this.m_FrozenColEnd;

      const frozenHRaw = window.SkUISpreadSheet.sumPixelHeight(1, frEnd);
      const frozenWRaw = window.SkUISpreadSheet.sumPixelWidth(1, fcEnd);

      if (
        !(frozenHRaw > 0) ||
        !(frozenWRaw > 0) ||
        sHeight <= frozenHRaw + 2 ||
        sWidth <= frozenWRaw + 2
      ) {
        await this._loadJsonViewSingle(sRow, sCol, sHeight, sWidth);
        await this.setScrollBar();
        return;
      }

      const frozenH = Math.min(frozenHRaw, sHeight - 2);
      const frozenW = Math.min(frozenWRaw, sWidth - 2);

      const jsonHFrozen = Math.min(
        Math.max(frozenHRaw, frozenH, 1) + FROZEN_JSON_HEIGHT_PAD_PX,
        JSON_VIEW_EXTENT_CAP_PX
      );
      const jsonWFrozen = Math.min(
        Math.max(frozenWRaw, frozenW, 1) + FROZEN_JSON_WIDTH_PAD_PX,
        JSON_VIEW_EXTENT_CAP_PX
      );

      const parseOrNull = (raw) => {
        try {
          return JSON.parse(raw);
        } catch (e) {
          console.error(e);
          return null;
        }
      };

      const wCorner = window.SkUISpreadSheet.jsonView(1, 1, jsonHFrozen, jsonWFrozen, 0, 0, "");
      this.m_UIViewFrozenCorner = parseOrNull(wCorner);

      const cornerOk =
        this.m_UIViewFrozenCorner &&
        Array.isArray(this.m_UIViewFrozenCorner.rows) &&
        this.m_UIViewFrozenCorner.rows.length > 0 &&
        Array.isArray(this.m_UIViewFrozenCorner.cols) &&
        this.m_UIViewFrozenCorner.cols.length > 0;

      if (!cornerOk) {
        this.m_UIViewFrozenCorner = null;
        await this._loadJsonViewSingle(sRow, sCol, sHeight, sWidth);
        await this.setScrollBar();
        return;
      }

      // Four panes: m_FrozenPix* must envelope corner JsonView ink (dX/col/row sums + grid pad).
      // Wasm sumPixel* alone can sit *below* that extent → clips crop paintCellStack to “nothing”.
      // Also cap_vs_stripe bands that overshoot Wasm seam (SCROLL pane needs room).
      const cornerClamped = this.frozenCornerUiForPaint();
      const bandH = this._frozenBandPixelHeightFromJson(cornerClamped);
      const bandW = this._frozenBandPixelWidthFromJson(cornerClamped);
      const stripeHp = frozenHRaw;
      const stripeWp = frozenWRaw;
      let bh = bandH > 0 ? bandH : stripeHp;
      let bw = bandW > 0 ? bandW : stripeWp;
      bh = Math.min(bh, stripeHp + FREEZE_SEAM_BAND_EXTRA_CAP_PX);
      bw = Math.min(bw, stripeWp + FREEZE_SEAM_BAND_EXTRA_CAP_PX);
      const mergedBandH = Math.max(stripeHp, bh, frozenH);
      const mergedBandW = Math.max(stripeWp, bw, frozenW);

      this.m_FrozenPixH = Math.min(
        Math.max(Math.ceil(mergedBandH) + seamBleedPx, 1),
        sHeight - 2
      );
      this.m_FrozenPixW = Math.min(
        Math.max(Math.ceil(mergedBandW) + seamBleedPx, 1),
        sWidth - 2
      );

      const scrollRow = Math.max(frEnd + 1, sRow);      const scNumFour = Number(sCol);
      const scrollCol = Number.isFinite(scNumFour)
        ? Math.max(fcEnd + 1, Math.floor(scNumFour))
        : fcEnd + 1;

      let needScrollH = Math.max(1, sHeight - this.m_FrozenPixH);
      let needScrollW = Math.max(1, sWidth - this.m_FrozenPixW);
      needScrollH = Math.min(
        needScrollH + JSON_VIEW_SPILL_PAD_PX,
        JSON_VIEW_EXTENT_CAP_PX
      );
      needScrollW = Math.min(
        needScrollW + JSON_VIEW_SPILL_PAD_PX,
        JSON_VIEW_EXTENT_CAP_PX
      );

      const wTop = window.SkUISpreadSheet.jsonView(
        1,
        scrollCol,
        jsonHFrozen,
        needScrollW,
        0,
        this.m_DiffX,
        ""
      );
      this.m_UIViewFrozen = parseOrNull(wTop);

      const wLeft = window.SkUISpreadSheet.jsonView(
        scrollRow,
        1,
        needScrollH,
        jsonWFrozen,
        this.m_DiffY,
        0,
        ""
      );
      this.m_UIViewFrozenLeft = parseOrNull(wLeft);

      const wMain = window.SkUISpreadSheet.jsonView(
        scrollRow,
        scrollCol,
        needScrollH,
        needScrollW,
        this.m_DiffY,
        this.m_DiffX,
        ""
      );
      this.m_UIView = parseOrNull(wMain);

      const ok =
        this.m_UIViewFrozen &&
        Array.isArray(this.m_UIViewFrozen.rows) &&
        this.m_UIViewFrozen.rows.length > 0 &&
        this.m_UIViewFrozenLeft &&
        Array.isArray(this.m_UIViewFrozenLeft.cols) &&
        this.m_UIViewFrozenLeft.cols.length > 0 &&
        this.m_UIView &&
        Array.isArray(this.m_UIView.rows) &&
        this.m_UIView.rows.length > 0;

      if (!ok) {
        await this._loadJsonViewSingle(sRow, sCol, sHeight, sWidth);
        await this.setScrollBar();
        return;
      }

      await this.setScrollBar();
    }

    /**
     * Keep {@link #m_FrozenRowEnd}/{@link #m_FrozenColEnd} aligned with WASM sheet split state
     * (peers receive split via GetMessage without running the local menu path).
     */
    async syncFrozenPanesFromWasm(sheetOpt) {
      const ui = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
      if (!ui || typeof ui.splitFreezeRow !== "function" || typeof ui.splitFreezeCol !== "function") {
        return;
      }
      let sheet = sheetOpt;
      if (sheet === undefined || sheet === null) {
        sheet = this.m_UIView != null ? this.m_UIView.sheet : "";
      }
      if (typeof sheet !== "string") {
        sheet = "";
      }
      try {
        const row = ui.splitFreezeRow(sheet);
        const col = ui.splitFreezeCol(sheet);
        const rOk = typeof row === "number" && Number.isFinite(row) && row >= 1;
        const cOk = typeof col === "number" && Number.isFinite(col) && col >= 1;
        this.m_FrozenRowEnd = rOk ? row : 0;
        this.m_FrozenColEnd = cOk ? col : 0;
      } catch (e) {
        console.warn("syncFrozenPanesFromWasm failed", e);
      }
    }

    /**
     * Persist split / freeze to the workbook via WASM (tUndoSplitView). C++ commands:
     * 1 = SplitV (freeze columns 1..position), 2 = SplitH (freeze rows 1..position), 3 = clear.
     * If SplitView is unavailable (old build), returns true so the UI-only freeze still works.
     */
    async _persistSplitViewToWasm(cde, position) {
      const ui = window.SkUISpreadSheet;
      if (!ui || typeof ui.splitView !== "function") {
        return true;
      }
      const sheet = this.m_UIView?.sheet ?? "";
      try {
        const r = ui.splitView(cde, position, sheet);
        if (r === false || r === 0) {
          return false;
        }
      } catch (e) {
        console.warn("splitView(WASM) failed; UI freeze may be out of sync with file state", e);
        return false;
      }
      return true;
    }

    /**
     * Freeze rows 1..cursor row (horizontal split bar under the active cell).
     * Naming follows the menu: "vertical split" for a vertical divider line on screen.
     */
    async applyVerticalSplitAtCursorRow() {
      const cr = this.cursor().row();
      if (!Number.isFinite(cr) || cr < 1) {
        return;
      }
      if (this.m_UIView) {
        await this.setExtraUndo();
      }
      if ((await this._persistSplitViewToWasm(2, cr)) === false) {
        return;
      }
      this.m_FrozenRowEnd = cr;
      const tc =
        this.m_UIView != null && Number.isFinite(this.m_UIView.topcol)
          ? this.m_UIView.topcol
          : this.cursor().col();
      let tr =
        this.m_UIView != null && Number.isFinite(this.m_UIView.toprow)
          ? this.m_UIView.toprow
          : cr + 1;
      tr = Math.max(cr + 1, tr);
      const ch = this.m_ClientHeight > 0 ? this.m_ClientHeight : 600;
      const cw = this.m_ClientWidth > 0 ? this.m_ClientWidth : 800;
      await this.getView(tr, tc, ch, cw);
      this.invalidateAll();
    }

    /**
     * Freeze columns 1..cursor column (vertical split bar to the right of the active cell).
     * Composable with {@link applyVerticalSplitAtCursorRow} for a four-pane freeze.
     */
    async applyHorizontalSplitAtCursorCol() {
      const cc = this.cursor().col();
      if (!Number.isFinite(cc) || cc < 1) {
        return;
      }
      if (this.m_UIView) {
        await this.setExtraUndo();
      }
      if ((await this._persistSplitViewToWasm(1, cc)) === false) {
        return;
      }
      this.m_FrozenColEnd = cc;
      const tr =
        this.m_UIView != null && Number.isFinite(this.m_UIView.toprow)
          ? this.m_UIView.toprow
          : this.cursor().row();
      let tc =
        this.m_UIView != null && Number.isFinite(this.m_UIView.topcol)
          ? this.m_UIView.topcol
          : cc + 1;
      tc = Math.max(cc + 1, tc);
      const ch = this.m_ClientHeight > 0 ? this.m_ClientHeight : 600;
      const cw = this.m_ClientWidth > 0 ? this.m_ClientWidth : 800;
      await this.getView(tr, tc, ch, cw);
      this.invalidateAll();
    }

    /** Turn off frozen panes (single viewport). */
    async clearFrozenSplit() {
      if (this.m_UIView) {
        await this.setExtraUndo();
      }
      if ((await this._persistSplitViewToWasm(3, 0)) === false) {
        return;
      }
      this.m_FrozenRowEnd = 0;
      this.m_FrozenColEnd = 0;
      const tr =
        this.m_UIView != null && Number.isFinite(this.m_UIView.toprow)
          ? this.m_UIView.toprow
          : this.cursor().row();
      const tc =
        this.m_UIView != null && Number.isFinite(this.m_UIView.topcol)
          ? this.m_UIView.topcol
          : this.cursor().col();
      const ch = this.m_ClientHeight > 0 ? this.m_ClientHeight : 600;
      const cw = this.m_ClientWidth > 0 ? this.m_ClientWidth : 800;
      await this._loadJsonViewSingle(tr, tc, ch, cw);
      await this.setScrollBar();
      this.invalidateAll();
    }

    /** Visible sheet row range for column highlights when frozen header rows are active. */
    visibleGridRowExtent() {
      if (this.m_UIView === null) {
        return { top: 1, bottom: 1 };
      }
      if (this.m_UIViewFrozen && this.m_FrozenPixH > 0) {
        return { top: 1, bottom: this._uiLastVisibleRow(this.m_UIView) };
      }
      return {
        top: this.m_UIView.toprow,
        bottom: this._uiLastVisibleRow(this.m_UIView),
      };
    }

    isRowColVisibleInGrid(sRow, sCol) {
      if (this.m_UIView === null) {
        return false;
      }
      const sc = this.m_UIView;
      const colFrozen = this.isFrozenColSplitActive();
      const fc = this.m_FrozenColEnd;
      const rowFrozen = this.isFrozenSplitActive();
      const fr = this.m_FrozenRowEnd;

      if (colFrozen && sCol >= 1 && sCol <= fc) {
        if (rowFrozen && sRow >= 1 && sRow <= fr) {
          const u = this.frozenCornerUiForPaint();
          return !!(
            u &&
            sRow >= u.toprow &&
            sRow <= u.lastrow &&
            sCol >= u.topcol &&
            sCol <= u.lastcol
          );
        }
        const u = this.frozenLeftUiForPaint();
        const sc = this.m_UIView;
        if (rowFrozen && this.isFrozenFourPaneActive() && sc) {
          return !!(
            u &&
            sc &&
            sRow >= sc.toprow &&
            sRow <= sc.lastrow &&
            sCol >= u.topcol &&
            sCol <= u.lastcol
          );
        }
        return !!(
          u &&
          sRow >= u.toprow &&
          sRow <= u.lastrow &&
          sCol >= u.topcol &&
          sCol <= u.lastcol
        );
      }

      if (sCol < sc.topcol || sCol > this._uiLastVisibleCol(sc)) {
        return false;
      }
      if (rowFrozen && sRow >= 1 && sRow <= fr) {
        const fu = this.frozenUiForPaint();
        if (!fu || sRow < fu.toprow) {
          return false;
        }
        return true;
      }
      return sRow >= sc.toprow && sRow <= this._uiLastVisibleRow(sc);
    }

    setView(sRow,sCol,sDiffY,sDiffX) {
      this.m_UIView.toprow=sRow;
      this.m_UIView.topcol=sCol;
      this.m_DiffY=sDiffY;
      this.m_DiffX=sDiffX;
    }

   async sizeCol(sCol) {
    if (window.SkUISpreadSheet!==null) {
      return window.SkUISpreadSheet.getSizeCol(sCol, "")
    }
    return Promise.resolve(0);
  }

    async sizeRow(sRow) {
      if (window.SkUISpreadSheet!==null) {
        return window.SkUISpreadSheet.getSizeRow(sRow,"")
      }
      return Promise.resolve(0);
    }
  
    // Select the entire column(s) spanned by the first (cell) selection and feed
    // the column-header selection (m_SelectCol) that insertCol()/deleteCol()
    // consume. Mirrors a column-header click (startColRowSelect) so it produces
    // the same full-height (rows 1..MaxRow) visual band, driven from the current
    // selection instead of a pixel position.
    selectAllColumn() {
      if (this.m_Select===null) return;
      const wRanges = this.m_Select.m_Selections || [];
      let wLeft;
      let wRight;
      if (wRanges.length > 0) {
        wLeft = Math.min(wRanges[0].m_Col, wRanges[0].m_Right);
        wRight = Math.max(wRanges[0].m_Col, wRanges[0].m_Right);
      } else {
        const wCol = this.cursor().col();
        wLeft = wRight = wCol > 0 ? wCol : 1;
      }
      const wRow = this.cursor().row();
      this.razAllselect();
      this.m_SelectCol.start(wLeft);
      this.m_SelectCol.move(wRight);
      this.m_SelectCol.end();
      // Keep the cursor inside the selected band (matches startColRowSelect).
      this.m_Select.setCursor(new tPoint(wRow > 0 ? wRow : 1, wLeft));
      this.scheduleInvalidateSelection();
      this.invalidateOverlays();
      this.focusGridCanvas();
    }

    // Symmetric to selectAllColumn(): entire row(s) of the first selection fed
    // into the row-header selection (m_SelectRow) used by insertRow()/deleteRow().
    selectAllRow() {
      if (this.m_Select===null) return;
      const wRanges = this.m_Select.m_Selections || [];
      let wTop;
      let wBottom;
      if (wRanges.length > 0) {
        wTop = Math.min(wRanges[0].m_Row, wRanges[0].m_Bottom);
        wBottom = Math.max(wRanges[0].m_Row, wRanges[0].m_Bottom);
      } else {
        const wRow = this.cursor().row();
        wTop = wBottom = wRow > 0 ? wRow : 1;
      }
      const wCol = this.cursor().col();
      this.razAllselect();
      this.m_SelectRow.start(wTop);
      this.m_SelectRow.move(wBottom);
      this.m_SelectRow.end();
      this.m_Select.setCursor(new tPoint(wTop, wCol > 0 ? wCol : 1));
      this.scheduleInvalidateSelection();
      this.invalidateOverlays();
      this.focusGridCanvas();
    }

    async insertRow() {
      if (this.m_SelectRow!==null) {
        this.setExtraUndo();
        let wLast=this.m_SelectRow.last();
        if (wLast!=null) {
          window.SkUISpreadSheet.insertRow(wLast.m_Begin,wLast.m_End,"");
          this.invalidateSheetExtent();
          await this.reloadView();
        }
      }
    }

    async deleteRow() {
      if (this.m_SelectRow!==null) {
        this.setExtraUndo();
        let wLast=this.m_SelectRow.last();
        if (wLast!=null) {
          window.SkUISpreadSheet.deleteRow(wLast.m_Begin,wLast.m_End,"");
          this.invalidateSheetExtent();
          await this.reloadView();
        }
      }
    }

    async insertCol() {
      if (this.m_SelectCol!==null) {
        this.setExtraUndo();
        let wLast=this.m_SelectCol.last();
        if (wLast!=null) {
          window.SkUISpreadSheet.insertCol(wLast.m_Begin,wLast.m_End,"");
          this.invalidateSheetExtent();
          await this.reloadView();
        }
      }
    }

    async deleteCol() {
      if (this.m_SelectCol!==null) {
        this.setExtraUndo();
        let wLast=this.m_SelectCol.last();
        if (wLast!=null) {
          window.SkUISpreadSheet.deleteCol(wLast.m_Begin,wLast.m_End,"");
          this.invalidateSheetExtent();
          await this.reloadView();
        }
      }
    }

    /**
     * Indent (sRight=true) / outdent (sRight=false) outline tree on the current selection.
     * Prefers row-header selection, then column-header, then cell range (taller → rows).
     * First index of the range becomes the parent for indent (DoTreeRight semantics).
     */
    /**
     * @param {boolean} sRight indent (true) / outdent (false)
     * @param {{ forceIsRow?: boolean|null }} [sOptions]
     *   forceIsRow true → rows, false → cols, omit/null → infer from selection
     */
    async changeTree(sRight, sOptions = {}) {
      const wIndent = !!sRight;
      const wForceIsRow = sOptions && Object.prototype.hasOwnProperty.call(sOptions, "forceIsRow")
        ? sOptions.forceIsRow
        : null;
      let wIsRow = true;
      let wBegin = 0;
      let wSize = 0;

      if (wForceIsRow === false) {
        // Dedicated column toolbar buttons — prefer col-header selection, else cell cols / cursor col.
        const wColSel = this.m_SelectCol !== null ? this.m_SelectCol.last() : null;
        if (wColSel != null) {
          wIsRow = false;
          wBegin = wColSel.m_Begin;
          wSize = wColSel.m_End - wColSel.m_Begin + 1;
        } else if (this.m_Select !== null) {
          const wRange = this.m_Select.last();
          if (wRange != null) {
            const wLeft = Math.min(wRange.m_Col, wRange.m_Right);
            const wRightCol = Math.max(wRange.m_Col, wRange.m_Right);
            wIsRow = false;
            wBegin = wLeft;
            wSize = wRightCol - wLeft + 1;
          } else {
            const wCursor = this.m_Select.cursor();
            if (wCursor != null) {
              wIsRow = false;
              wBegin = wCursor.col() > 0 ? wCursor.col() : 1;
              wSize = 1;
            }
          }
        }
      } else if (wForceIsRow === true) {
        const wRowSel = this.m_SelectRow !== null ? this.m_SelectRow.last() : null;
        if (wRowSel != null) {
          wIsRow = true;
          wBegin = wRowSel.m_Begin;
          wSize = wRowSel.m_End - wRowSel.m_Begin + 1;
        } else if (this.m_Select !== null) {
          const wRange = this.m_Select.last();
          if (wRange != null) {
            const wTop = Math.min(wRange.m_Row, wRange.m_Bottom);
            const wBottom = Math.max(wRange.m_Row, wRange.m_Bottom);
            wIsRow = true;
            wBegin = wTop;
            wSize = wBottom - wTop + 1;
          } else {
            const wCursor = this.m_Select.cursor();
            if (wCursor != null) {
              wIsRow = true;
              wBegin = wCursor.row() > 0 ? wCursor.row() : 1;
              wSize = 1;
            }
          }
        }
      } else {
        const wRowSel = this.m_SelectRow !== null ? this.m_SelectRow.last() : null;
        if (wRowSel != null) {
          wIsRow = true;
          wBegin = wRowSel.m_Begin;
          wSize = wRowSel.m_End - wRowSel.m_Begin + 1;
        } else {
          const wColSel = this.m_SelectCol !== null ? this.m_SelectCol.last() : null;
          if (wColSel != null) {
            wIsRow = false;
            wBegin = wColSel.m_Begin;
            wSize = wColSel.m_End - wColSel.m_Begin + 1;
          } else if (this.m_Select !== null) {
            const wRange = this.m_Select.last();
            if (wRange != null) {
              const wTop = Math.min(wRange.m_Row, wRange.m_Bottom);
              const wBottom = Math.max(wRange.m_Row, wRange.m_Bottom);
              const wLeft = Math.min(wRange.m_Col, wRange.m_Right);
              const wRightCol = Math.max(wRange.m_Col, wRange.m_Right);
              const wHeight = wBottom - wTop + 1;
              const wWidth = wRightCol - wLeft + 1;
              if (wHeight >= wWidth) {
                wIsRow = true;
                wBegin = wTop;
                wSize = wHeight;
              } else {
                wIsRow = false;
                wBegin = wLeft;
                wSize = wWidth;
              }
            } else {
              // Cursor only (no range) — use active cell row/col.
              const wCursor = this.m_Select.cursor();
              if (wCursor != null) {
                wIsRow = true;
                wBegin = wCursor.row() > 0 ? wCursor.row() : 1;
                wSize = 1;
              }
            }
          }
        }
      }

      if (wBegin < 1 || wSize < 1) {
        console.warn("[changeTree] no selection");
        return false;
      }

      // Indent needs parent+child. Single index → nest under the previous sibling.
      if (wIndent && wSize < 2) {
        if (wBegin <= 1) {
          console.warn("[changeTree] indent needs ≥2 rows/cols (or select a row/col after the first)");
          return false;
        }
        wBegin = wBegin - 1;
        wSize = 2;
      }

      this.setExtraUndo();
      console.log("[changeTree]", { indent: wIndent, isRow: wIsRow, begin: wBegin, size: wSize });
      const wOk = wIsRow
        ? !!window.SkUISpreadSheet.changeTreeRow(wIndent, wBegin, wSize, "")
        : !!window.SkUISpreadSheet.changeTreeCol(wIndent, wBegin, wSize, "");

      if (!wOk) {
        console.warn("[changeTree] WASM returned false",
          wIndent
            ? "(no same-level siblings to nest under the selection)"
            : "(nothing to outdent — no parent group / no children)");
        return false;
      }
      if (this.m_TreeViewLeft === 0) {
        this.setTreeViewEnabled(true);
      }
      await this.reloadView();
      return true;
    }

    // Cell-range (rectangular) insert/delete.
    // Mirrors Excel's "Insert..." / "Delete..." cell dialog:
    //   - insertRowByRect : shift cells down inside the selected column range
    //   - insertColByRect : shift cells right inside the selected row range
    //   - deleteRowByRect : shift cells up inside the selected column range
    //   - deleteColByRect : shift cells left inside the selected row range
    rangeRefForByRect() {
      if (this.m_Select===null) return null;
      const wLast=this.m_Select.last();
      if (wLast!==null) {
        return this.m_Select.strRange(wLast);
      }
      const wRef=this.m_Select.cursorStr();
      return wRef+":"+wRef;
    }

    async insertRowByRect() {
      const wRef=this.rangeRefForByRect();
      if (wRef===null) return;
      this.setExtraUndo();
      window.SkUISpreadSheet.insertRowByRect(wRef,"");
      this.invalidateSheetExtent();
      await this.reloadView();
      this.invalidateAll();
    }

    async deleteRowByRect() {
      const wRef=this.rangeRefForByRect();
      if (wRef===null) return;
      this.setExtraUndo();
      window.SkUISpreadSheet.deleteRowByRect(wRef,"");
      this.invalidateSheetExtent();
      await this.reloadView();
      this.invalidateAll();
    }

    async insertColByRect() {
      const wRef=this.rangeRefForByRect();
      if (wRef===null) return;
      this.setExtraUndo();
      window.SkUISpreadSheet.insertColByRect(wRef,"");
      this.invalidateSheetExtent();
      await this.reloadView();
      this.invalidateAll();
    }

    async deleteColByRect() {
      const wRef=this.rangeRefForByRect();
      if (wRef===null) return;
      this.setExtraUndo();
      window.SkUISpreadSheet.deleteColByRect(wRef,"");
      this.invalidateSheetExtent();
      await this.reloadView();
      this.invalidateAll();
    }

    async raz(sKeepFormat = false) {
      if (window.SkUISpreadSheet!==null) {
        this.setExtraUndo();
        // sKeepFormat: clear cell content only and keep the format (CSS).
        // Use selectstr() so whole-row/column header selections reach the engine
        // (m_Select.str() only carries the cell/range cursor, not the ColRow picks).
        window.SkUISpreadSheet.raz(this.selectstr(), sKeepFormat, "");
        await this.reloadView();
      }
    }

    // Clear only the CSS format of the selection; content, formula and class attributes are kept.
    async razFormat() {
      if (window.SkUISpreadSheet!==null) {
        this.setExtraUndo();
        // selectstr() includes whole-row/column header selections so a format-only
        // clear reaches ApplyColRowFormat instead of just the cursor cell.
        window.SkUISpreadSheet.razFormat(this.selectstr(), "");
        await this.reloadView();
      }
    }

    invalidateCanvas() {
      if (this.m_SkSpGridCanvas != null) {
        this.m_SkSpGridCanvas.invalidateOverlays();
      }
    }

    invalidateOverlays() {
      if (this.m_SkSpGridCanvas != null) {
        this.m_SkSpGridCanvas.invalidateOverlays();
      }
      if (this.m_SkSpFloatingLayer != null) {
        this.m_SkSpFloatingLayer.invalidate();
      }
    }

    invalidateAll() {
      if (this.m_SkSpGridCanvas != null) {
        this.m_SkSpGridCanvas.invalidateAll();
      }
      this.m_SkSpLeftPanel?.invalidate();
      this.m_SkSpTopPanel?.invalidate();
      this.m_SkSpGridPanel?.invalidate();
      if (this.m_SkSpFloatingLayer != null) {
        this.m_SkSpFloatingLayer.notifyDisplayRefresh();
      }
    }
    // Scroll Bar =============================================================
    initVScrollBar(sVScrollBar) {
      this.m_VScrollBar=sVScrollBar;
    }
  
    initHScrollBar(ssetHScrollBar) {
      this.m_setHScrollBar=ssetHScrollBar;
    }
  
    minVerticalScrollRow() {
      return this.m_FrozenPixH > 0 ? this.m_FrozenRowEnd + 1 : 1;
    }

    /** Split is "real" only when both row end and frozen band height exist (getView can fall back to single pane with m_FrozenRowEnd still > 0). */
    isFrozenSplitActive() {
      return this.m_FrozenRowEnd > 0 && this.m_FrozenPixH > 0;
    }

    /**
     * After vertical scroll: keep the first visible scroll row fully aligned (Excel-style).
     * Sub-row offset lives in JsonView dY / m_DiffY (folded into c_y).
     * With a frozen split, refresh both panes with m_DiffY = 0 on every vertical sync.
     */
    async snapScrollFirstRowAlignment() {
      if (window.SkUISpreadSheet == null || this.m_UIView == null) {
        return false;
      }
      const tr = Number(this.m_UIView.toprow);
      const tc = Number(this.m_UIView.topcol);
      if (!Number.isFinite(tr) || tr < 1 || !Number.isFinite(tc)) {
        return false;
      }
      const ch = this.m_ClientHeight > 0 ? this.m_ClientHeight : 600;
      const cw = this.m_ClientWidth > 0 ? this.m_ClientWidth : 800;

      const SUB_ROW_EPS = 1e-3;

      if (this.isFrozenSplitActive()) {
        this.m_DiffY = 0;
        await this.getView(tr, tc, ch, cw);
        return true;
      }

      const dy = Number(this.m_UIView.dY ?? 0);
      const ddy = Number(this.m_DiffY ?? 0);
      if (!(dy < -SUB_ROW_EPS || ddy < -SUB_ROW_EPS || Math.abs(ddy) > SUB_ROW_EPS)) {
        return false;
      }
      this.m_DiffY = 0;
      await this.getView(tr, tc, ch, cw);
      return true;
    }

    /**
     * When the horizontal scroll thumb is at the first scrollable column (e.g. A without column split),
     * a negative JsonView dX clips the leading edge of that column. Keyboard scroll cannot move
     * topcol below minHorizontalScrollCol(), so nudgeViewUntilCursorHorizontallyVisible stops early —
     * resync with m_DiffX = 0 like Excel-style full-column alignment.
     * @param {number} [sCursorCol] - Active cell column; snap only when it matches the leftmost scroll column.
     */
    async snapScrollFirstColAlignment(sCursorCol) {
      if (window.SkUISpreadSheet == null || this.m_UIView == null) {
        return false;
      }
      const minC = this.minHorizontalScrollCol();
      if (sCursorCol != null && Number.isFinite(sCursorCol) && sCursorCol !== minC) {
        return false;
      }
      const tr = Number(this.m_UIView.toprow);
      const tc = Number(this.m_UIView.topcol);
      if (!Number.isFinite(tr) || tr < 1 || !Number.isFinite(tc) || tc < minC) {
        return false;
      }
      if (tc !== minC) {
        return false;
      }
      const ch = this.m_ClientHeight > 0 ? this.m_ClientHeight : 600;
      const cw = this.m_ClientWidth > 0 ? this.m_ClientWidth : 800;
      const SUB_COL_EPS = 1e-2;
      const dx = Number(this.m_UIView.dX ?? 0);
      const ddx = Number(this.m_DiffX ?? 0);
      if (!(dx < -SUB_COL_EPS || ddx < -SUB_COL_EPS)) {
        return false;
      }
      this.m_DiffY = 0;
      this.m_DiffX = 0;
      await this.getView(tr, minC, ch, cw);
      return true;
    }

    /** Call after vertical scrollbar drag ends: snap row boundary + sync thumb. */
    async finishVerticalScrollSnap() {
      await this.snapScrollFirstRowAlignment();
      await this.setScrollBar();
      this.invalidateAll();
    }

    /** Call after horizontal scrollbar drag ends: snap column boundary + sync thumb. */
    async finishHorizontalScrollSnap() {
      await this.snapScrollFirstColAlignment();
      await this.setScrollBar();
      this.invalidateAll();
    }

    async setVScrollBar(sPos) {
      //console.log("SkSpInterface setVScrollBar(",sPos,")");
      // Reload View 
      let wJson=window.SkUISpreadSheet.jsonRowByPixel(1,sPos);
      //console.log(" JsonRowByPixel->",wJson);
      const wResult=JSON.parse(wJson);
      const wRow = Math.max(wResult.r, this.minVerticalScrollRow());
      // Excel-style: scroll thumb maps to whole rows; ignore sub-row pixel offset from jsonRowByPixel.
      this.m_DiffY = 0;
      await this.getView(wRow,this.m_UIView.topcol,this.m_ClientHeight,this.m_ClientWidth,"");
      this.invalidateAll();
    }
  
    async setHScrollBar(sPos) {
       // Reload View 
      let wJson=window.SkUISpreadSheet.jsonColByPixel(1,sPos);
      const wResult=JSON.parse(wJson);
      this.m_DiffX=wResult.d;
      const wCol = Math.max(Number(wResult.c) || 1, this.minHorizontalScrollCol());
      await this.getView(this.m_UIView.toprow, wCol, this.m_ClientHeight, this.m_ClientWidth,""); 
      this.invalidateAll();
    }

    _scrollFineOffsetFromDiff(sDiff) {
      const diff = Number(sDiff);
      if (!Number.isFinite(diff) || Math.abs(diff) < 1e-3) {
        return 0;
      }
      // Index*ByPixel returns 1 at an exact row/col boundary, then negative values as content is clipped.
      return 1 - diff;
    }

    _clampScrollPixelOffset(sPixel, sMinPixel, sViewportPx, sTotalPx) {
      let result = Math.max(sMinPixel, Number(sPixel) || 0);
      const total = Number(sTotalPx) || 0;
      const viewport = Math.max(1, Number(sViewportPx) || 1);
      if (total > 0) {
        result = Math.min(result, Math.max(sMinPixel, total - viewport));
      }
      return result;
    }

    /** True while the user is dragging either scrollbar thumb (freeze the dynamic extent then). */
    _isScrollbarDragActive() {
      return (
        this.m_VScrollBar?.m_InMouseProcess === true ||
        this.m_setHScrollBar?.m_InMouseProcess === true
      );
    }

    /**
     * Excel-style dynamic scroll extent (px) reported to the scrollbars and the wheel clamp.
     *
     * Excel recomputes the scrollbar range from the currently visible position rather than a fixed
     * content size: as you scroll past the used range the range grows (one screenful ahead of the
     * current view), so the thumb keeps shrinking/repositioning and you can keep scrolling all the
     * way down to the sheet limit (MaxRow / MaxCol). The extent is therefore:
     *   clamp( max(usedContent, currentOffset + viewport + oneScreen), fullSheetLimit )
     *
     * When everything already fits on screen the exact content extent is returned so no phantom
     * scrollbar appears.
     *
     * @param {"x"|"y"} sAxis - Scroll axis; "y" uses row heights, "x" uses column widths.
     * @param {number} sContentPx - Used-range extent in CSS px (m_BottomRightPixel row/col).
     * @param {number} sViewportPx - Scrollable viewport size in CSS px (excluding frozen band).
     * @param {number} sCurrentOffsetPx - Current scroll offset (top/left) in CSS px.
     * @param {boolean} [sForWheel=false] - When true (wheel/trackpad), always expose the overscroll
     *   range so the user can scroll into the empty grid even when the content fits and no scrollbar
     *   is shown. When false (scrollbar sizing), the exact content extent is returned at rest so no
     *   phantom scrollbar appears until the view is actually scrolled past the content.
     * @returns {number} Effective scroll extent in CSS px.
     */
    _scrollExtentWithOverscrollPx(sAxis, sContentPx, sViewportPx, sCurrentOffsetPx, sForWheel = false) {
      // Freeze the extent during a thumb drag: a growing range mid-drag would feed back into
      // PixelToPos and make the thumb rubber-band. Use the value captured just before the drag.
      const dragActive = this._isScrollbarDragActive();
      if (dragActive && !sForWheel) {
        const cached =
          sAxis === "y" ? this.m_ScrollExtentFrozenY : this.m_ScrollExtentFrozenX;
        if (cached != null && cached > 0) {
          return cached;
        }
      }

      const content = Math.max(1, Number(sContentPx) || 0);
      const viewport = Math.max(1, Number(sViewportPx) || 1);
      const current = Math.max(0, Number(sCurrentOffsetPx) || 0);

      let extent;
      if (content <= viewport && current <= 0 && !sForWheel) {
        // Content fits and we are at the origin: keep the scrollbar hidden at rest.
        extent = content;
      } else {
        // Grow the range one screenful ahead of the current view (Excel-style live recompute).
        extent = Math.max(content, current + viewport + viewport);
        const fullMax =
          sAxis === "y"
            ? Number(this.m_FullSheetPixel?.row?.()) || 0
            : Number(this.m_FullSheetPixel?.col?.()) || 0;
        if (fullMax > 0) {
          extent = Math.min(extent, fullMax);
        }
        // Never report less than what is needed to keep the current view valid.
        extent = Math.max(extent, current + viewport, content);
      }

      // Only the scrollbar-sizing path seeds the drag-freeze cache, so the frozen value mirrors the
      // thumb's own range (wheel-only overscroll extents must not leak into it).
      if (!dragActive && !sForWheel) {
        if (sAxis === "y") {
          this.m_ScrollExtentFrozenY = extent;
        } else {
          this.m_ScrollExtentFrozenX = extent;
        }
      }
      return extent;
    }

    _parseIndexByPixelResult(sJson, sIndexKey) {
      try {
        const result = JSON.parse(sJson);
        const index = Number(result?.[sIndexKey]);
        const diff = Number(result?.d);
        return {
          index: Number.isFinite(index) ? index : 1,
          diff: Number.isFinite(diff) ? diff : 0,
        };
      } catch (error) {
        console.error(error);
        return { index: 1, diff: 0 };
      }
    }

    async scrollViewByWheelDelta(sDeltaX, sDeltaY) {
      if (window.SkUISpreadSheet == null || this.m_UIView == null) {
        return false;
      }
      const dx = Number(sDeltaX) || 0;
      const dy = Number(sDeltaY) || 0;
      if (dx === 0 && dy === 0) {
        return false;
      }

      await this.ensureSheetExtent();
      const ch = this.m_ClientHeight > 0 ? this.m_ClientHeight : 600;
      const cw = this.m_ClientWidth > 0 ? this.m_ClientWidth : 800;
      const offsets = await this._resolveScrollBarOffsetsPx();

      let nextTopRow = Number(this.m_UIView.toprow) || 1;
      let nextTopCol = Number(this.m_UIView.topcol) || 1;
      let nextDiffY = Number(this.m_DiffY) || 0;
      let nextDiffX = Number(this.m_DiffX) || 0;

      if (dy !== 0) {
        const minRow = this.minVerticalScrollRow();
        const minTopPx =
          minRow > 1 ? window.SkUISpreadSheet.sumPixelHeight(1, minRow - 1) : 0;
        const viewHeight =
          this.m_FrozenPixH > 0 ? Math.max(1, ch - this.m_FrozenPixH) : ch;
        const currentTopPx = offsets.top;
        const targetTopPx = this._clampScrollPixelOffset(
          currentTopPx + dy,
          minTopPx,
          viewHeight,
          this._scrollExtentWithOverscrollPx(
            "y",
            this.m_BottomRightPixel?.row?.(),
            viewHeight,
            currentTopPx,
            true
          )
        );

        if (Math.abs(targetTopPx - minTopPx) < 1e-3) {
          nextTopRow = minRow;
          nextDiffY = 0;
        } else {
          const rowResult = this._parseIndexByPixelResult(
            window.SkUISpreadSheet.jsonRowByPixel(1, targetTopPx),
            "r"
          );
          nextTopRow = Math.max(rowResult.index, minRow);
          nextDiffY =
            nextTopRow === minRow && targetTopPx <= minTopPx
              ? 0
              : rowResult.diff;
        }
      }

      if (dx !== 0) {
        // Sub-column fluid scroll via negative m_DiffX: WASM JsonView folds the offset into c_x/c_y.
        const minCol = this.minHorizontalScrollCol();
        const minLeftPx =
          minCol > 1 ? window.SkUISpreadSheet.sumPixelWidth(1, minCol - 1) : 0;
        const viewWidth =
          this.m_FrozenPixW > 0 ? Math.max(1, cw - this.m_FrozenPixW) : cw;
        const currentLeftPx = offsets.left;
        const targetLeftPx = this._clampScrollPixelOffset(
          currentLeftPx + dx,
          minLeftPx,
          viewWidth,
          this._scrollExtentWithOverscrollPx(
            "x",
            this.m_BottomRightPixel?.col?.(),
            viewWidth,
            currentLeftPx,
            true
          )
        );

        if (Math.abs(targetLeftPx - minLeftPx) < 1e-3) {
          nextTopCol = minCol;
          nextDiffX = 0;
        } else {
          const colResult = this._parseIndexByPixelResult(
            window.SkUISpreadSheet.jsonColByPixel(1, targetLeftPx),
            "c"
          );
          nextTopCol = Math.max(colResult.index, minCol);
          nextDiffX =
            nextTopCol === minCol && targetLeftPx <= minLeftPx
              ? 0
              : colResult.diff;
        }
      }

      const changed =
        nextTopRow !== this.m_UIView.toprow ||
        nextTopCol !== this.m_UIView.topcol ||
        Math.abs(nextDiffY - (Number(this.m_DiffY) || 0)) > 1e-3 ||
        Math.abs(nextDiffX - (Number(this.m_DiffX) || 0)) > 1e-3;
      if (!changed && !this.m_JsonViewNeedsHardRefresh) {
        return false;
      }

      this.m_DiffY = nextDiffY;
      this.m_DiffX = nextDiffX;
      await this.getView(nextTopRow, nextTopCol, ch, cw);
      this.m_JsonViewNeedsHardRefresh = false;
      this.invalidateAll();
      return true;
    }
  
    /**
     * Sheet pixel offset of the scroll viewport origin (rows/cols above toprow/topcol).
     * Prefer scrollTopPx/scrollLeftPx from JsonView; fall back to WASM for older builds.
     */
    async _resolveScrollBarOffsetsPx() {
      const ui = this.m_UIView;
      if (ui == null) {
        return { top: 0, left: 0, toprow: 1, topcol: 1 };
      }
      const tr = Math.max(1, Number(ui.toprow) || 1);
      const tc = Math.max(1, Number(ui.topcol) || 1);
      let top = 0;
      let left = 0;
      if (tr > 1) {
        const stp = Number(ui.scrollTopPx);
        if (Number.isFinite(stp)) {
          top = stp;
        } else if (window.SkUISpreadSheet != null) {
          top = window.SkUISpreadSheet.sumPixelHeight(1, tr - 1);
        }
      }
      top += this._scrollFineOffsetFromDiff(this.m_DiffY);
      if (tc > 1) {
        const slp = Number(ui.scrollLeftPx);
        if (Number.isFinite(slp)) {
          left = slp;
        } else if (window.SkUISpreadSheet != null) {
          left = window.SkUISpreadSheet.sumPixelWidth(1, tc - 1);
        }
      }
      left += this._scrollFineOffsetFromDiff(this.m_DiffX);
      return { top, left, toprow: tr, topcol: tc };
    }

    _hydrateAllJsonViewPanes() {
      hydrateJsonViewCellFormats(this.m_UIView);
      hydrateJsonViewCellFormats(this.m_UIViewFrozen);
      hydrateJsonViewCellFormats(this.m_UIViewFrozenLeft);
      hydrateJsonViewCellFormats(this.m_UIViewFrozenCorner);
    }

    async setScrollBar() {
      if (this.m_UIView === null) {
        return;
      }
      this._hydrateAllJsonViewPanes();
      await this.ensureSheetExtent();
      if (this.m_BottomRight === null) {
        return;
      }
      const offsets = await this._resolveScrollBarOffsetsPx();
      const wViewHeight =
        this.m_FrozenPixH > 0 ? this.m_ClientHeight - this.m_FrozenPixH : this.m_ClientHeight;
      const wTop = offsets.top;
      const wLastRow = wTop + wViewHeight;
      const sizeTotalY = this._scrollExtentWithOverscrollPx(
        "y",
        this.m_BottomRightPixel.row(),
        wViewHeight,
        wTop
      );
      let wViewWidth = this.m_ClientWidth;
      if (this.m_FrozenPixW > 0) {
        wViewWidth = Math.max(1, this.m_ClientWidth - this.m_FrozenPixW);
      }
      const wLeft = offsets.left;
      const wLastCol = wLeft + wViewWidth;
      const sizeTotalX = this._scrollExtentWithOverscrollPx(
        "x",
        this.m_BottomRightPixel.col(),
        wViewWidth,
        wLeft
      );

      const syncKey = [
        offsets.top,
        offsets.left,
        sizeTotalY,
        sizeTotalX,
        wLastRow,
        wLastCol,
        wViewHeight,
        wViewWidth,
        offsets.toprow,
        offsets.topcol,
      ].join("|");
      if (this.m_ScrollBarSyncKey === syncKey) {
        return;
      }
      this.m_ScrollBarSyncKey = syncKey;

      if (this.m_VScrollBar !== null) {
        this.m_VScrollBar.SetView(wTop, wLastRow, sizeTotalY);
      }
      if (this.m_setHScrollBar !== null) {
        this.m_setHScrollBar.SetView(wLeft, wLastCol, sizeTotalX);
      }
    }

    async colByPixel(sX) {
      if (this.m_UIView === null) {
        return 0;
      }
      const fw = this.m_FrozenPixW > 0 ? this.m_FrozenPixW : 0;
      let wCol;
      const scrollUi = this._scrollColumnHeaderUiForPaint();
      if (fw > 0 && sX < fw) {
        const clamped = this._frozenColumnHeaderUiForPaint();
        if (clamped && Array.isArray(clamped.cols) && clamped.cols.length > 0) {
          wCol = this._colByPixelInView(sX, clamped);
        } else {
          wCol = this._colByPixelInView(sX - fw, scrollUi);
        }
      } else {
        wCol = this._colByPixelInView(sX - fw, scrollUi);
      }
      return wCol;
    }

    _colByPixelInView(sX, ui) {
      let wCol = 0;
      if (ui == null || !Array.isArray(ui.cols)) {
        return 0;
      }
      let wCalcWidth = this._uiPaneDX(ui);
      for (let wIndCol = 0; wIndCol < ui.cols.length; wIndCol++) {
        wCol = ui.cols[wIndCol].i;
        const wSize = Number(ui.cols[wIndCol].s) || 0;
        if (sX > wCalcWidth && sX < wCalcWidth + wSize + this.m_GridWidth) {
          break;
        }
        if (sX > 0) {
          wCol = ui.cols[wIndCol].i;
        }
        wCalcWidth += wSize;
      }
      return wCol;
    }

    _rowByPixelInView(sY, ui) {
      let wRow = 0;
      if (ui == null || ui.rows == null) {
        return 0;
      }
      let wCalcHeight = this._uiPaneDY(ui);
      for (let wIndRow = 0; wIndRow < ui.rows.length; wIndRow++) {
        wRow = ui.rows[wIndRow].i;
        const wSize = Number(ui.rows[wIndRow].s) || 0;
        if ((sY > wCalcHeight) && (sY < wCalcHeight + wSize + this.m_GridWidth)) {
          break;
        }
        if (sY > 0) {
          wRow = ui.rows[wIndRow].i;
        }
        wCalcHeight += wSize;
      }
      return wRow;
    }

    async rowByPixel(sY) {
      const fh = this.m_FrozenPixH > 0 ? this.m_FrozenPixH : 0;
      if (fh > 0 && sY < fh) {
        const topUi = this.m_UIViewFrozenCorner ?? this.m_UIViewFrozen;
        const u = this._frozenUiClampedToRowEnd(topUi ?? null) ?? topUi;
        if (u && Array.isArray(u.rows)) {
          return this._rowByPixelInView(sY, u);
        }
      }
      if (this.m_UIView === null) {
        return 0;
      }
      return this._rowByPixelInView(sY - fh, this.m_UIView);
    }

    setCursor(sRow,sCol) {
      /*
      window.SkSpChatSpreadSheet.sendSpreadsheetMessage({
        type: "setCursor",
        row: sRow,
        col: sCol
      });
      */
      this.m_Select.setCursor(new tPoint(sRow,sCol));
    }

   async returnMerged(sRow,sCol) {
      if (
        this.m_SpreadsheetDisposed ||
        this.m_UIView === null ||
        window.SkUISpreadSheet == null ||
        typeof window.SkUISpreadSheet.returnMerged !== "function"
      ) {
        return null;
      }
      const wRow = Number(sRow) || 0;
      const wCol = Number(sCol) || 0;
      if (wRow < 1 || wCol < 1) {
        return null;
      }
      try {
        let wString=window.SkUISpreadSheet.returnMerged(wRow,wCol);
        if (wString!=="") {
          const wReturnMerged=JSON.parse(wString);
          return(wReturnMerged);     
        }
      } catch (error) {
        if (!this.m_SpreadsheetDisposed) {
          console.warn("returnMerged failed:", error);
        }
      }
      return(null);
    }

    applyCursorMergeHighlight(merged) {
      if (
        merged != null &&
        (Number(merged.r_t) !== Number(merged.r_b) ||
          Number(merged.r_l) !== Number(merged.r_r))
      ) {
        this.m_Select.setCursorMergeBounds(
          merged.r_t,
          merged.r_l,
          merged.r_b,
          merged.r_r
        );
      } else {
        this.m_Select.clearCursorMergeBounds();
      }
    }

    async syncCursorMergeHighlight() {
      if (this.m_SpreadsheetDisposed || this.m_UIView === null || this.m_Select == null) {
        return;
      }
      const wCursor = this.m_Select.cursor();
      const wMerged = await this.returnMerged(wCursor.row(), wCursor.col());
      if (this.m_SpreadsheetDisposed) {
        return;
      }
      this.applyCursorMergeHighlight(wMerged);
    }

    async setCursorByMouse(sX,sY,sScroll) {
      let wCol=await this.colByPixel(sX);
      let wRow=await this.rowByPixel(sY);
   
      let wReturnMerged=await this.returnMerged(wRow,wCol);
      if (wReturnMerged!=null) {
        wRow=wReturnMerged.r_t;
        wCol=wReturnMerged.r_l;
      }
      this.applyCursorMergeHighlight(wReturnMerged);
      // if non Scroll only (verify position)
      if (!sScroll) {
        if (!this.isRowColVisibleInGrid(wRow, wCol)) {
          return;
        }
      }
      this.m_Select.setCursor(new tPoint(wRow,wCol));
      let wCursorReturn=await this.resetView(this.m_Select.cursor());
      let wSnapped = await this.snapScrollFirstRowAlignment();
      wSnapped =
        (await this.snapScrollFirstColAlignment(this.m_Select.cursor().col())) ||
        wSnapped;
      await this.setScrollBar();

      if (wCursorReturn!=null) {
        wSnapped =
          (await this.snapScrollFirstRowAlignment()) || wSnapped;
        wSnapped =
          (await this.snapScrollFirstColAlignment(this.m_Select.cursor().col())) ||
          wSnapped;
        await this.setScrollBar();
        this.invalidateAll();
      } else if (wSnapped) {
        this.invalidateAll();
      } else {
        this.invalidateOverlays();
      }
    }

    // Move cursor to a cell ref (row/col) — used when clicking React cell-class widgets.
    async selectCellAt(sRow, sCol) {
      let wRow = Number(sRow);
      let wCol = Number(sCol);
      if (!Number.isFinite(wRow) || !Number.isFinite(wCol)) {
        return;
      }

      const wReturnMerged = await this.returnMerged(wRow, wCol);
      if (wReturnMerged != null) {
        wRow = wReturnMerged.r_t;
        wCol = wReturnMerged.r_l;
      }
      this.applyCursorMergeHighlight(wReturnMerged);

      const wCurrent = this.m_Select.cursor();
      const wSameCell = wCurrent.row() === wRow && wCurrent.col() === wCol;
      if (!wSameCell) {
        this.m_Select.setCursor(new tPoint(wRow, wCol));
        const wCursorReturn = await this.resetView(this.m_Select.cursor());
        let wSnapped = await this.snapScrollFirstRowAlignment();
        wSnapped =
          (await this.snapScrollFirstColAlignment(this.m_Select.cursor().col())) ||
          wSnapped;
        await this.setScrollBar();

        if (wCursorReturn != null) {
          wSnapped =
            (await this.snapScrollFirstRowAlignment()) || wSnapped;
          wSnapped =
            (await this.snapScrollFirstColAlignment(this.m_Select.cursor().col())) ||
            wSnapped;
          await this.setScrollBar();
          this.invalidateAll();
        } else if (wSnapped) {
          this.invalidateAll();
        } else {
          this.invalidateOverlays();
        }
      } else {
        this.invalidateOverlays();
      }

      this.scheduleInvalidateSelection();
      this.sendMoveCell(this.cursor());
    }

    getCursor(sRow,sCol) {
      return(this.m_Select.cursor());
    }

    _getCellFromUi(ui, sRow, sCol) {
      if (ui == null || ui.rows == null) {
        return null;
      }
      const wantRow = Number(sRow);
      const wantCol = Number(sCol);
      let wIndRow = ui.rows.findIndex((row) => Number(row.i) === wantRow);
      if (wIndRow === undefined || wIndRow < 0) {
        return null;
      }
      let wRows = ui.rows[wIndRow];
      if (wRows != null && wRows.hasOwnProperty("cells")) {
        const cells = wRows.cells;
        const wViewport = cells.find(
          (col) =>
            Number(col.c_c) === wantCol &&
            col.c__l !== true &&
            col.c__r !== true,
        );
        if (wViewport != null) {
          return wViewport;
        }
        const wAny = cells.find((col) => Number(col.c_c) === wantCol);
        if (wAny != null) {
          return wAny;
        }
      }
      return null;
    }

    /**
     * Map sheet-space anchor to viewport pane px (same origin as JsonView c_x / c_y).
     * _viewOriginSheetPx folds negative dX into originX; only add positive inset once.
     */
    _sheetAnchorToPaneOrigin(ui, anchorX, anchorY, xOff, yOff) {
      const wViewOrigin = this._viewOriginSheetPx(ui);
      const wPaneDx = this._uiPaneDX(ui);
      const wPaneDy = this._uiPaneDY(ui);
      return {
        left:
          xOff +
          (anchorX - wViewOrigin.originX) +
          (wPaneDx > 0 ? wPaneDx : 0),
        top:
          yOff +
          (anchorY - wViewOrigin.originY) +
          (wPaneDy > 0 ? wPaneDy : 0),
      };
    }

    /**
     * Horizontal inset before the first visible column (JsonView dX / positive m_DiffX).
     * Same origin as paintGridForPane and column headers.
     */
    _uiPaneDX(ui) {
      if (ui == null) {
        return 0;
      }
      const dx = Number(ui.dX ?? 0);
      if (Math.abs(dx) > 1e-3) {
        return dx;
      }
      // Overlay-only repaints: positive m_DiffX when JsonView has not caught up yet.
      if (this._isHorizontalScrollColumnUi(ui)) {
        const md = Number(this.m_DiffX ?? 0);
        if (md > 1e-2) {
          return md;
        }
      }
      return dx;
    }

    /** Vertical inset before the first visible row (JsonView dY / m_DiffY). */
    _uiPaneDY(ui) {
      if (ui == null) {
        return 0;
      }
      const dy = Number(ui.dY ?? 0);
      if (Math.abs(dy) > 1e-3) {
        return dy;
      }
      if (ui === this.m_UIView) {
        const md = Number(this.m_DiffY ?? 0);
        if (md > 1e-2) {
          return md;
        }
      }
      return dy;
    }

    /**
     * Last sheet column covered by JsonView cols[] (may exceed lastcol when the trailing
     * column is only partially visible).
     */
    _uiLastVisibleCol(ui) {
      if (ui == null) {
        return 0;
      }
      let last = Number(ui.lastcol) || 0;
      const cols = Array.isArray(ui.cols) ? ui.cols : [];
      if (cols.length) {
        const lastI = Number(cols[cols.length - 1].i);
        if (Number.isFinite(lastI)) {
          last = Math.max(last, lastI);
        }
      }
      return last;
    }

    /** Same as _uiLastVisibleCol for rows. */
    _uiLastVisibleRow(ui) {
      if (ui == null) {
        return 0;
      }
      let last = Number(ui.lastrow) || 0;
      const rows = Array.isArray(ui.rows) ? ui.rows : [];
      if (rows.length) {
        const lastI = Number(rows[rows.length - 1].i);
        if (Number.isFinite(lastI)) {
          last = Math.max(last, lastI);
        }
      }
      return last;
    }

    /**
     * Cell origin/size from JsonView cols/rows stepping — dX/dY on origin, full row/col sizes.
     */
    _cellLayoutFromUi(ui, sRow, sCol) {
      if (ui == null) {
        return null;
      }
      const wantRow = Number(sRow);
      const wantCol = Number(sCol);
      let wPosX = this._uiPaneDX(ui);
      let wWidth = 0;
      let foundCol = false;
      const cols = Array.isArray(ui.cols) ? ui.cols : [];
      for (let wX = 0; wX < cols.length; wX++) {
        const colIdx = Number(cols[wX].i);
        const wSizeCol = Number(cols[wX].s) || 0;
        if (colIdx === wantCol) {
          wWidth = wSizeCol;
          foundCol = true;
          break;
        }
        wPosX += wSizeCol;
      }
      if (!foundCol || !(wWidth > 0)) {
        return null;
      }

      let wPosY = this._uiPaneDY(ui);
      let wHeight = 0;
      let foundRow = false;
      const rows = Array.isArray(ui.rows) ? ui.rows : [];
      for (let wY = 0; wY < rows.length; wY++) {
        const rowIdx = Number(rows[wY].i);
        const wSizeRow = Number(rows[wY].s) || 0;
        if (rowIdx === wantRow) {
          wHeight = wSizeRow;
          foundRow = true;
          break;
        }
        wPosY += wSizeRow;
      }
      if (!foundRow || !(wHeight > 0)) {
        return null;
      }
      return { left: wPosX, top: wPosY, width: wWidth, height: wHeight };
    }

    _applyPaneClipToRect(rect, xOff, yOff) {
      let wLeft = rect.Left;
      let wTop = rect.Top;
      let wWidth = rect.Width;
      let wHeight = rect.Height;
      if (yOff > 0) {
        const beforeTop = wTop;
        wTop = Math.max(yOff, wTop);
        const shaved = wTop - beforeTop;
        if (shaved > 0) {
          wHeight = Math.max(0, wHeight - shaved);
        }
      }
      if (xOff > 0) {
        const beforeLeft = wLeft;
        wLeft = Math.max(xOff, wLeft);
        const shaved = wLeft - beforeLeft;
        if (shaved > 0) {
          wWidth = Math.max(0, wWidth - shaved);
        }
      }
      if (wWidth <= 0 || wHeight <= 0) {
        return null;
      }
      return { Left: wLeft, Top: wTop, Width: wWidth, Height: wHeight };
    }

    /**
     * Range pixel rect from JsonView cols/rows layout (same stepping as paintGridForPane).
     */
    _rangeRectFromUiLayout(ui, r0, c0, r1, c1, xOff, yOff) {
      const tl = this._cellLayoutFromUi(ui, r0, c0);
      const br = this._cellLayoutFromUi(ui, r1, c1);
      if (tl == null || br == null) {
        return null;
      }
      return this._applyPaneClipToRect(
        {
          Left: xOff + tl.left,
          Top: yOff + tl.top,
          Width: Math.max(0, br.left + br.width - tl.left),
          Height: Math.max(0, br.top + br.height - tl.top),
        },
        xOff,
        yOff
      );
    }

    getCell(sRow, sCol) {
      return this.getJsonViewCellAt(sRow, sCol);
    }

    /**
     * JsonView cell record for (row, col): same pane as paint/cursor geometry, then other panes.
     * Empty formatted cells (row/col/sheet Css) are emitted by WASM with f_bc on the cell object.
     */
    getJsonViewCellAt(sRow, sCol) {
      const vp = this._viewportAndOffsetsForSheetCell(sRow, sCol);
      if (vp?.ui != null) {
        const wPrimary = this._getCellFromUi(vp.ui, sRow, sCol);
        if (wPrimary != null) {
          return wPrimary;
        }
      }

      const fr = this.m_FrozenRowEnd;
      const fc = this.m_FrozenColEnd;
      const inFrozenRow =
        this.m_FrozenPixH > 0 && fr > 0 && sRow >= 1 && sRow <= fr;
      const inFrozenCol =
        this.m_FrozenPixW > 0 && fc > 0 && sCol >= 1 && sCol <= fc;

      if (inFrozenRow && inFrozenCol && this.m_UIViewFrozenCorner) {
        const wFrozen = this._getCellFromUi(this.frozenCornerUiForPaint(), sRow, sCol);
        if (wFrozen != null) {
          return wFrozen;
        }
      }
      if (inFrozenRow && !inFrozenCol && this.m_UIViewFrozen) {
        const wFrozen = this._getCellFromUi(this.frozenUiForPaint(), sRow, sCol);
        if (wFrozen != null) {
          return wFrozen;
        }
      }
      if (!inFrozenRow && inFrozenCol && this.m_UIViewFrozenLeft) {
        const wFrozen = this._getCellFromUi(this.frozenLeftUiForPaint(), sRow, sCol);
        if (wFrozen != null) {
          return wFrozen;
        }
      }
      return this._getCellFromUi(this.m_UIView, sRow, sCol);
    }

    /** f_bc from JsonView for the cell record (sync, no merge walk). */
    getJsonViewBackgroundColorSync(sRow, sCol) {
      const wDirect = this.getJsonViewCellAt(sRow, sCol);
      if (wDirect?.f_bc != null && String(wDirect.f_bc).trim() !== "") {
        return wDirect.f_bc;
      }
      return null;
    }

    /** f_bc from JsonView (cell, then merged anchor cells). */
    async resolveJsonViewBackgroundColor(sRow, sCol) {
      const wSync = this.getJsonViewBackgroundColorSync(sRow, sCol);
      if (wSync != null) {
        return wSync;
      }

      const merged = await this.returnMerged(sRow, sCol);
      if (merged != null) {
        const rT = Number(merged.r_t);
        const rB = Number(merged.r_b);
        const cL = Number(merged.r_l);
        const cR = Number(merged.r_r);
        for (let rr = rT; rr <= rB; rr++) {
          for (let cc = cL; cc <= cR; cc++) {
            if (!this.isRowColVisibleInGrid(rr, cc)) {
              continue;
            }
            const wTry = this.getJsonViewCellAt(rr, cc);
            if (wTry?.f_bc != null && String(wTry.f_bc).trim() !== "") {
              return wTry.f_bc;
            }
          }
        }
      }
      return null;
    }
    
    async ensureCell(sRow,sCol) {
      let wCellStr = window.SkUISpreadSheet.base10toAlphaSync(sCol) + sRow;
      if (window.SkUISpreadSheet.ensureCell(wCellStr)) {
        // Reload View 
        await this.getView(this.m_UIView.toprow,this.m_UIView.topcol,this.m_ClientHeight,this.m_ClientWidth); 
      }
      return(this.getCell(sRow,sCol))
    }
    
    GetCellcursor() {
      let wCursor=this.m_Select.cursor();
      return(this.getCell(wCursor.row(),wCursor.col()));
    }

    async cursorMerged(sCursor) {
      let wReturnMerged=await this.returnMerged(sCursor.m_Row,sCursor.m_Col);
      if (wReturnMerged!=null) {
        sCursor.m_Row=wReturnMerged.r_t;
        sCursor.m_Col=wReturnMerged.r_l;
        return(true);
      }  
      return(false);
    }

    async CursorMergedRightbottom(sCursor,sIsRow) {
      let wReturnMerged=await this.returnMerged(sCursor.m_Row,sCursor.m_Col);
      if (wReturnMerged!=null) {
        if (sIsRow) {
          sCursor.m_Row=wReturnMerged.r_b;
        } else {
          sCursor.m_Col=wReturnMerged.r_r;
        }
        return(true);
      }  
      return(false);
    }

    async rangeSelect(sCursor) {
      let wTop=sCursor.row();
      let wLeft=sCursor.col();
      let wBottom=sCursor.row();
      let wRight=sCursor.col();
      let wReturnMerged=await this.returnMerged(wTop,wLeft);
      if (wReturnMerged!=null) {
        wTop=wReturnMerged.r_t;
        wLeft=wReturnMerged.r_l;
        wBottom=wReturnMerged.r_b;
        wRight=wReturnMerged.r_r;
      }
      return(new tRange(wTop,wLeft,wBottom,wRight));
    }

    async cursorSelect(sBottom,sRight) {
      let wRange=this.m_Select.last();
      let wCursor=this.cursor();
      let wRangeSelect=await this.rangeSelect(new tPoint(sBottom,sRight));

      let wLeft=wCursor.col();
      let wTop=wCursor.row();
      
      if (sRight<wLeft) {
        sRight=wLeft;
        wLeft=wRangeSelect.col();
      } else {
        sRight=wRangeSelect.right();
      }
      if (sBottom<wTop) {
        sBottom=wTop;
        wTop=wRangeSelect.row();
      } else {
        sBottom=wRangeSelect.bottom();
      }
      let wOldRangeStr="";
      let wRangeStr = window.SkUISpreadSheet.base10toAlphaSync(wLeft) + wTop + ":" + window.SkUISpreadSheet.base10toAlphaSync(sRight) + sBottom;
      while (wOldRangeStr!==wRangeStr) {
        wOldRangeStr=wRangeStr;
        let wResult=window.SkUISpreadSheet.returnRangeMergedFusion(wRangeStr);
        if (wResult==="") break;
 
        const wReturnRangeMerged=JSON.parse(wResult);
        wLeft=wReturnRangeMerged.r_l;
        wTop=wReturnRangeMerged.r_t;
        sBottom=wReturnRangeMerged.r_b;
        sRight=wReturnRangeMerged.r_r;
    
        wRangeStr = window.SkUISpreadSheet.base10toAlphaSync(wLeft) + wTop + ":" + window.SkUISpreadSheet.base10toAlphaSync(sRight) + sBottom;
      } 
      wRange.setRow(wTop);
      wRange.setCol(wLeft);
      wRange.setBottom(sBottom);
      wRange.setRight(sRight);

      await this.setScrollBar();
      
      //console.log("Select =",this.m_Select.str());
    }

    async initKey() {
      let wRange=this.m_Select.last();
      if (wRange===null) {
        //console.log("wRange===null");
        let wCursor=this.m_Select.cursor();
        let wRange=await this.rangeSelect(wCursor);
        this.m_Select.push(wRange);
        
        this.m_CursorKeyFloat=new tPoint(wCursor.m_Row,wCursor.m_Col)
      }
    }

    async sendMoveCell(sCursor, options = {}) {
      // Desktop build has no collaboration server: nothing to broadcast.
      if (isDesktop) {
        return;
      }
      const wUser=new SkSpUser(sessionStorage.getItem('email'),sessionStorage.getItem('name'),sessionStorage.getItem('firstname'));

      const wActiveWorkBook=window.SkUISpreadSheet.getActiveWorkBook();
      const wActiveSheet=window.SkUISpreadSheet.getActiveSheet();
      const wForce = !!(options && options.force);
      PostMessage({
        type: "user",
        action: "cursor",
        uri: wActiveWorkBook,
        sheet: wActiveSheet,
        user: wUser,
        row: sCursor.row(),
        col: sCursor.col(),
      }, wForce);
      
    }

    /**
     * Visible scroll-band row indices from the on-screen grid viewport (not JsonView lastrow,
     * which can cover the whole sheet extent when jsonH is inflated for WASM).
     */
    async visibleScrollRowBand() {
      const ui = this.m_UIView;
      if (ui == null) {
        return { topRow: 1, lastRow: 1, pageRows: 1 };
      }
      const topRow = Math.max(1, Number(ui.toprow) || 1);
      let lastRow = topRow;
      const canvas = this.m_SkSpGridCanvas?.m_Ref?.current;
      if (canvas) {
        const vp = this.getGridInnerViewportCssPx(canvas);
        if (vp.height > 1) {
          lastRow = await this.rowByPixel(vp.height - 1);
        }
      }
      if (!Number.isFinite(lastRow) || lastRow < topRow) {
        lastRow = topRow;
      }
      return {
        topRow,
        lastRow,
        pageRows: Math.max(1, lastRow - topRow + 1),
      };
    }

    async keyMovePage(event, sCursor) {
      const down = event.key === 'PageDown';
      const { topRow, lastRow, pageRows } = await this.visibleScrollRowBand();
      const wCol = sCursor.col();
      let curRow = sCursor.row();
      const merged = await this.returnMerged(curRow, wCol);
      if (merged != null) {
        curRow = down ? Number(merged.r_b) : Number(merged.r_t);
      }

      // Offset of the cursor inside the visible viewport (0 = top visible scroll row).
      let offsetInView = 0;
      if (curRow >= topRow && curRow <= lastRow) {
        offsetInView = curRow - topRow;
      }

      let nextTopRow;
      if (down) {
        nextTopRow = lastRow + 1;
      } else {
        nextTopRow = Math.max(this.minVerticalScrollRow(), topRow - pageRows);
      }

      let wRow = nextTopRow + offsetInView;
      wRow = Math.max(1, Math.min(wRow, 1048576));

      sCursor.setRow(wRow);
      sCursor.setCol(wCol);
      await this.cursorMerged(sCursor);
      await this.sendMoveCell(sCursor);
      return sCursor;
    }

    async keyMoveHomeEnd(event, sCursor) {
      const prevCol = sCursor.col();
      const prevRow = sCursor.row();
      const wKey = event.key === 'Home' ? 20 : 21;
      const wMetaKey = (event.metaKey || event.ctrlKey) ? 1 : 0;
      const wRes = window.SkUISpreadSheet.moveCell(
        prevRow,
        prevCol,
        wKey,
        wMetaKey,
        this.m_UIView.toprow,
        this.m_UIView.topcol,
        this.m_UIView.lastrow,
        this.m_UIView.lastcol
      );
      const wRect = JSON.parse(wRes);
      let nextCol = wRect.r_l;
      let nextRow = wRect.r_t;

      // Fallback when WASM MoveCell Home/End are not implemented yet.
      if (event.key === 'Home' && nextCol === prevCol) {
        nextCol = 1;
        nextRow = prevRow;
      } else if (event.key === 'End' && nextCol === prevCol) {
        try {
          const br = JSON.parse(window.SkUISpreadSheet.jsonBottomRight());
          nextCol = Math.max(1, br.c ?? 1);
          nextRow = prevRow;
        } catch {
          nextCol = prevCol;
          nextRow = prevRow;
        }
      }

      sCursor.setRow(nextRow);
      sCursor.setCol(nextCol);
      await this.cursorMerged(sCursor);
      await this.sendMoveCell(sCursor);
      return sCursor;
    }

    async keyMove(event,sCursor) {
      if (event.key === 'PageUp' || event.key === 'PageDown') {
        return this.keyMovePage(event, sCursor);
      }
      if (event.key === 'Home' || event.key === 'End') {
        return this.keyMoveHomeEnd(event, sCursor);
      }
      let wKey=1;
      let wMetaKey=0;
      switch(event.key) {
        case 'ArrowLeft' :  wKey=1; break;
        case 'ArrowRight' : wKey=3; break;
        case 'ArrowUp' : wKey=2; break;
        case 'ArrowDown' : wKey=4; break;
        default : break;
      }
      if (event.metaKey || event.ctrlKey) {
        wMetaKey=1;
      }
      // View can be null during a recalc (view reset): ignore the move instead of crashing.
      if (this.m_UIView == null) {
        return sCursor;
      }
      // Move Cell get new cursor
      let wRes = window.SkUISpreadSheet.moveCell(sCursor.row(), sCursor.col(), wKey, wMetaKey, this.m_UIView.toprow, this.m_UIView.topcol, this.m_UIView.lastrow, this.m_UIView.lastcol);
      const wRect = JSON.parse(wRes);
      sCursor.setRow(wRect.r_t);
      sCursor.setCol(wRect.r_l);

      await this.cursorMerged(sCursor);
      // resetView + full invalidate are done once in RangeKey — calling them here too
      // ran justify/getView twice per keypress and caused horizontal snap (e.g. ArrowUp held at row 1).
      await this.sendMoveCell(sCursor);
      return(sCursor);
    }

    async RangeKey(event) {
      let wCursor={}
      wCursor=this.m_Select.cursor();
      if (event.shiftKey) {
        // If shift key, we select the float cursor
        if (this.m_CursorKeyFloat!==null) {
          wCursor=this.m_CursorKeyFloat;
          switch(event.key) {
            case 'ArrowRight' : {
              await this.CursorMergedRightbottom(wCursor,false);        
              break;
            }
            case 'ArrowDown' : {
              await this.CursorMergedRightbottom(wCursor,true);
              break;
            }
            case 'PageDown' : {
              await this.CursorMergedRightbottom(wCursor,true);
              break;
            }
            default : break;
          }
        }
        // Set Deplacement beetween values ====================================== 
        wCursor=await this.keyMove(event,wCursor);
        
        // At the end of the key event, we get merged cursor
        let wRectMerged=await this.returnMerged(wCursor.m_Row,wCursor.m_Col);
        if (wRectMerged!=null) {
           switch(event.key) {  
            case 'ArrowRight' : {
              wCursor.m_Col=wRectMerged.r_r;
              break;
            }
            case 'ArrowDown' : {
              wCursor.m_Row=wRectMerged.r_b;
              break;
            }
            case 'Home' : {
              wCursor.m_Col=wRectMerged.r_l;
              break;
            }
            case 'End' : {
              wCursor.m_Col=wRectMerged.r_r;
              break;
            }
            default : break;
          }
        }

        // If shift key, we select the range
        if (event.shiftKey) {
          await this.cursorSelect(wCursor.m_Row,wCursor.m_Col)
          this.m_CursorKeyFloat=wCursor;
        } else {
          this.m_Select.setCursor(wCursor);
        }
        await this.syncCursorMergeHighlight();
        let wCursorReturn=await this.resetView(wCursor);
        if (wCursorReturn!=null) {
          await this.snapScrollFirstRowAlignment();
          await this.setScrollBar();
          this.invalidateAll();
          this.scheduleInvalidateSelection();
          return(false);
        }
        let wSnapped = await this.snapScrollFirstRowAlignment();
        wSnapped =
          (await this.snapScrollFirstColAlignment(wCursor.m_Col)) || wSnapped;
        await this.setScrollBar();
        if (wSnapped) {
          this.invalidateAll();
        } else {
          this.invalidateOverlays();
        }
        this.scheduleInvalidateSelection();
        return(true);
      }
        
       
      // Set Deplacement beetween values ====================================== 
      wCursor=await this.keyMove(event,wCursor);
      
      // At the end of the key event, we get merged cursor
      await this.cursorMerged(wCursor);

      // If shift key, we select the range
      if (event.shiftKey) {
        await this.cursorSelect(wCursor.m_Row,wCursor.m_Col)
        this.m_CursorKeyFloat=wCursor;
      } else {
        this.m_Select.setCursor(wCursor);
      }
      await this.syncCursorMergeHighlight();

      let wCursorReturn=await this.resetView(wCursor);
      if (wCursorReturn!=null) {
        await this.snapScrollFirstRowAlignment();
        await this.setScrollBar();
        this.invalidateAll();
        this.scheduleInvalidateSelection();
        return(false);
      }
      let wSnapped = await this.snapScrollFirstRowAlignment();
      wSnapped =
        (await this.snapScrollFirstColAlignment(wCursor.m_Col)) || wSnapped;
      await this.setScrollBar();
      if (wSnapped) {
        this.invalidateAll();
      } else {
        this.invalidateOverlays();
      }
      this.scheduleInvalidateSelection();
      return(true);
    }

    /**
     * When a whole-row/col header select is active, move the cursor to the band
     * origin before keyboard navigation: column A for a row band, row 1 for a col band.
     * @returns {boolean} True if the cursor was re-anchored.
     */
    anchorCursorFromColRowSelect() {
      if (!this.hasColRowSelect()) {
        return false;
      }
      const wColSels = this.m_SelectCol?.selections?.() || [];
      const wRowSels = this.m_SelectRow?.selections?.() || [];
      if (wColSels.length > 0) {
        let wCol = wColSels[0].m_Begin;
        for (const wInt of wColSels) {
          wCol = Math.min(wCol, wInt.m_Begin, wInt.m_End);
        }
        this.m_Select.setCursor(new tPoint(1, Math.max(1, wCol)));
        return true;
      }
      if (wRowSels.length > 0) {
        let wRow = wRowSels[0].m_Begin;
        for (const wInt of wRowSels) {
          wRow = Math.min(wRow, wInt.m_Begin, wInt.m_End);
        }
        this.m_Select.setCursor(new tPoint(Math.max(1, wRow), 1));
        return true;
      }
      return false;
    }

    async cursorMoveKey(event) {
        // Whole-row/col header select → first land on A{row} / {col}1, then apply the key.
        this.anchorCursorFromColRowSelect();
        if (event.shiftKey) {
          await this.initKey();
        } else {
          await this.razAllselect()
          this.m_CursorKeyFloat=null;
        }  
      let wRes=await this.RangeKey(event);
      return(wRes);
    }

    _emptyPixelRect() {
      return { Left: 0, Top: 0, Width: 0, Height: 0 };
    }

    _rectUnion(a, b) {
      const empty = this._emptyPixelRect();
      const aOk = a && a.Width > 0 && a.Height > 0;
      const bOk = b && b.Width > 0 && b.Height > 0;
      if (!aOk && !bOk) {
        return empty;
      }
      if (!aOk) {
        return b;
      }
      if (!bOk) {
        return a;
      }
      const L = Math.min(a.Left, b.Left);
      const T = Math.min(a.Top, b.Top);
      const R = Math.max(a.Left + a.Width, b.Left + b.Width);
      const B = Math.max(a.Top + a.Height, b.Top + b.Height);
      return { Left: L, Top: T, Width: R - L, Height: B - T };
    }

    /** When the range anchor is above/left of the JsonView band, clip paint to the pane origin. */
    _clipRangeRectToViewportOrigin(sRange, ui, rect, xPixelOffset, yPixelOffset) {
      if (rect == null || !(rect.Width > 0) || !(rect.Height > 0)) {
        return rect;
      }
      let wLeft = rect.Left;
      let wTop = rect.Top;
      let wWidth = rect.Width;
      let wHeight = rect.Height;
      const vpLeft = xPixelOffset + this._uiPaneDX(ui);
      const vpTop = yPixelOffset + this._uiPaneDY(ui);
      if (sRange.col() < ui.topcol) {
        const wRight = wLeft + wWidth;
        wLeft = vpLeft;
        wWidth = Math.max(0, wRight - wLeft);
      }
      if (sRange.row() < ui.toprow) {
        const wBottom = wTop + wHeight;
        wTop = vpTop;
        wHeight = Math.max(0, wBottom - wTop);
      }
      return { Left: wLeft, Top: wTop, Width: wWidth, Height: wHeight };
    }

    /**
     * Pixel rect for one cell using JsonView c_x/c_y/c_w/c_h in a specific viewport pane.
     * Matches cell paint geometry (dX/dY folded into c_*).
     */
    _getCellRectInViewport(ui, sRow, sCol, xOff, yOff) {
      const wCell = this._getCellFromUi(ui, sRow, sCol);
      const layout = this._cellLayoutFromUi(ui, sRow, sCol);
      if (wCell == null && layout == null) {
        return null;
      }

      let wWidth = 0;
      let wHeight = 0;
      if (wCell != null) {
        if (wCell.hasOwnProperty("c_w")) {
          const cw = Number(wCell.c_w);
          if (Number.isFinite(cw) && cw > 0) {
            wWidth = cw;
          }
        }
        if (wCell.hasOwnProperty("c_h")) {
          const ch = Number(wCell.c_h);
          if (Number.isFinite(ch) && ch > 0) {
            wHeight = ch;
          }
        }
      }
      if (wWidth <= 0 && layout != null) {
        wWidth = layout.width;
      }
      if (wHeight <= 0 && layout != null) {
        wHeight = layout.height;
      }
      if (wWidth <= 0 || wHeight <= 0) {
        return null;
      }

      let wLeft;
      let wTop;
      const isMergeInk =
        wCell != null &&
        layout != null &&
        (wWidth > layout.width + 0.5 || wHeight > layout.height + 0.5);
      const hasJsonOrigin =
        wCell != null &&
        Number.isFinite(Number(wCell.c_x)) &&
        Number.isFinite(Number(wCell.c_y));
      if (isMergeInk && hasJsonOrigin) {
        wLeft = xOff + Number(wCell.c_x);
        wTop = yOff + Number(wCell.c_y);
      } else if (hasJsonOrigin) {
        // JsonView c_* matches cell paint (fine scroll folded in); prefer over layout stepping.
        wLeft = xOff + Number(wCell.c_x);
        wTop = yOff + Number(wCell.c_y);
      } else if (layout != null) {
        wLeft = xOff + layout.left;
        wTop = yOff + layout.top;
      } else {
        return null;
      }
      return this._applyPaneClipToRect(
        { Left: wLeft, Top: wTop, Width: wWidth, Height: wHeight },
        xOff,
        yOff
      );
    }

    /** Sum-based pixel rect fallback when JsonView layout lookup misses (empty cells, partial view). */
    async _getRectPixelSumFallbackRange(sRange, ui, xPixelOffset, yPixelOffset) {
      const visC0 = Math.max(sRange.col(), ui.topcol);
      const visR0 = Math.max(sRange.row(), ui.toprow);

      let wTop;
      let wLeft;
      if (sRange.row() < ui.toprow) {
        wTop = yPixelOffset + this._uiPaneDY(ui);
      } else {
        const wSumTop = window.SkUISpreadSheet.sumPixelHeight(
          ui.toprow,
          sRange.row() - 1
        );
        wTop =
          yPixelOffset +
          this._uiPaneDY(ui) +
          wSumTop;
      }

      if (sRange.col() < ui.topcol) {
        wLeft = xPixelOffset + this._uiPaneDX(ui);
      } else {
        const wSumLeft = window.SkUISpreadSheet.sumPixelWidth(
          ui.topcol,
          sRange.col() - 1
        );
        wLeft =
          xPixelOffset +
          this._uiPaneDX(ui) +
          wSumLeft;
      }

      let wHeight = window.SkUISpreadSheet.sumPixelHeight(
        visR0,
        sRange.bottom()
      );
      if (sRange.row() < ui.toprow) {
        wHeight = window.SkUISpreadSheet.sumPixelHeight(
          ui.toprow,
          sRange.bottom()
        );
      }

      let wWidth = window.SkUISpreadSheet.sumPixelWidth(visC0, sRange.right());

      let rect = { Left: wLeft, Top: wTop, Width: wWidth, Height: wHeight };
      rect = this._clipRangeRectToViewportOrigin(
        sRange,
        ui,
        rect,
        xPixelOffset,
        yPixelOffset
      );
      const clipped = this._applyPaneClipToRect(
        rect,
        xPixelOffset,
        yPixelOffset
      );
      return clipped ?? this._emptyPixelRect();
    }

    /** Direct WASM SumPixel* when available (sync); null when the WASM engine is not ready. */
    _sumPixelWidthSync(sColStart, sColEnd, sSheet = "") {
      const wUi = window.SkUISpreadSheet;
      if (wUi == null) {
        return null;
      }
      const wWasm = wUi.m_UISpreadSheet;
      if (wWasm == null || typeof wWasm.SumPixelWidth !== "function") {
        return null;
      }
      const wStart = Math.min(Number(sColStart) || 0, Number(sColEnd) || 0);
      const wEnd = Math.max(Number(sColStart) || 0, Number(sColEnd) || 0);
      if (wStart < 1 || wEnd < wStart) {
        return 0;
      }
      return Number(wWasm.SumPixelWidth(wStart, wEnd, sSheet)) || 0;
    }

    _sumPixelHeightSync(sRowStart, sRowEnd, sSheet = "") {
      const wUi = window.SkUISpreadSheet;
      if (wUi == null) {
        return null;
      }
      const wWasm = wUi.m_UISpreadSheet;
      if (wWasm == null || typeof wWasm.SumPixelHeight !== "function") {
        return null;
      }
      const wStart = Math.min(Number(sRowStart) || 0, Number(sRowEnd) || 0);
      const wEnd = Math.max(Number(sRowStart) || 0, Number(sRowEnd) || 0);
      if (wStart < 1 || wEnd < wStart) {
        return 0;
      }
      return Number(wWasm.SumPixelHeight(wStart, wEnd, sSheet)) || 0;
    }

    /** Sheet-space origin of the viewport left/top edge (matches SKJsonView c_x / spill math). */
    _viewOriginSheetPx(ui) {
      let wOriginX = Number(ui?.scrollLeftPx) || 0;
      let wOriginY = Number(ui?.scrollTopPx) || 0;
      const wDx = Number(ui?.dX ?? 0);
      const wDy = Number(ui?.dY ?? 0);
      if (wDx < 0) {
        wOriginX -= wDx;
      }
      if (wDy < 0) {
        wOriginY -= wDy;
      }
      return { originX: wOriginX, originY: wOriginY };
    }

    /** Anchor top-left in sheet pixel space; null when sync SumPixel* is unavailable. */
    _anchorSheetPxSync(sRow, sCol, sSheet = "") {
      const wRow = Number(sRow) || 1;
      const wCol = Number(sCol) || 1;
      let wAnchorX = 0;
      let wAnchorY = 0;
      if (wCol > 1) {
        const wWidth = this._sumPixelWidthSync(1, wCol - 1, sSheet);
        if (wWidth == null) {
          return null;
        }
        wAnchorX = wWidth;
      }
      if (wRow > 1) {
        const wHeight = this._sumPixelHeightSync(1, wRow - 1, sSheet);
        if (wHeight == null) {
          return null;
        }
        wAnchorY = wHeight;
      }
      return { anchorX: wAnchorX, anchorY: wAnchorY };
    }

    /**
     * Top-left of an anchor cell in grid canvas coordinates (scroll-safe, synchronous).
     * Uses JsonView when the cell is visible; sheet scroll offsets when it is off-screen.
     */
    getFloatingAnchorScreenOriginSync(sRow, sCol) {
      if (this.m_UIView === null) {
        return { left: 0, top: 0 };
      }
      const wRow = Number(sRow) || 1;
      const wCol = Number(sCol) || 1;
      const vp = this._viewportAndOffsetsForSheetCell(wRow, wCol);
      const ui = vp?.ui;
      if (ui == null) {
        return { left: 0, top: 0 };
      }
      const xOff = Number(vp.xOff) || 0;
      const yOff = Number(vp.yOff) || 0;
      const inView =
        wCol >= ui.topcol &&
        wCol <= this._uiLastVisibleCol(ui) &&
        wRow >= ui.toprow &&
        wRow <= this._uiLastVisibleRow(ui);

      if (inView) {
        // A floating object positions itself at the anchor's LOGICAL top-left and clips
        // its own overflow (overflow:hidden on the shell + layer). We must therefore report
        // the true, negative-capable origin rather than the viewport-clamped visible rect:
        // JsonView c_x/c_y already include dX/dY (negative fine scroll included).
        const wAnchorCell = this._getCellFromUi(ui, wRow, wCol);
        if (
          wAnchorCell != null &&
          Number.isFinite(Number(wAnchorCell.c_x)) &&
          Number.isFinite(Number(wAnchorCell.c_y))
        ) {
          return {
            left: xOff + Number(wAnchorCell.c_x),
            top: yOff + Number(wAnchorCell.c_y),
          };
        }
        const layoutOnly = this._cellLayoutFromUi(ui, wRow, wCol);
        if (layoutOnly != null) {
          return {
            left: xOff + layoutOnly.left,
            top: yOff + layoutOnly.top,
          };
        }
      }

      const wSheet = ui.sheet || this.m_UIView.sheet || "";
      const wAnchorSheet = this._anchorSheetPxSync(wRow, wCol, wSheet);
      if (wAnchorSheet == null) {
        return null;
      }
      const wPane = this._sheetAnchorToPaneOrigin(
        ui,
        wAnchorSheet.anchorX,
        wAnchorSheet.anchorY,
        xOff,
        yOff,
      );
      return { left: wPane.left, top: wPane.top };
    }

    /** Sum-based single-cell fallback aligned with legacy getRectPixelByColRow. */
    async _getRectPixelSumFallbackCell(sRow, sCol, ui, xOff, yOff) {
      const wSyncOrigin = this.getFloatingAnchorScreenOriginSync(sRow, sCol);
      let wLeft;
      let wTop;
      if (wSyncOrigin != null) {
        wLeft = Number(wSyncOrigin.left) || 0;
        wTop = Number(wSyncOrigin.top) || 0;
      } else {
        const wSheet = ui?.sheet || this.m_UIView?.sheet || "";
        let wAnchorX = 0;
        let wAnchorY = 0;
        if (sCol > 1) {
          wAnchorX = window.SkUISpreadSheet.sumPixelWidth(1, sCol - 1, wSheet);
        }
        if (sRow > 1) {
          wAnchorY = window.SkUISpreadSheet.sumPixelHeight(1, sRow - 1, wSheet);
        }
        const wPane = this._sheetAnchorToPaneOrigin(
          ui,
          wAnchorX,
          wAnchorY,
          xOff,
          yOff,
        );
        wLeft = wPane.left;
        wTop = wPane.top;
      }

      let wWidth = await this.sizeCol(sCol);
      let wHeight = await this.sizeRow(sRow);
      const wCellFallback = this._getCellFromUi(ui, sRow, sCol);
      if (wCellFallback != null) {
        if (wCellFallback.hasOwnProperty("c_w")) {
          const cw = Number(wCellFallback.c_w);
          if (Number.isFinite(cw) && cw > 0) {
            wWidth = cw;
          }
        }
        if (wCellFallback.hasOwnProperty("c_h")) {
          const ch = Number(wCellFallback.c_h);
          if (Number.isFinite(ch) && ch > 0) {
            wHeight = ch;
          }
        }
      }
      const clipped = this._applyPaneClipToRect(
        { Left: wLeft, Top: wTop, Width: wWidth, Height: wHeight },
        xOff,
        yOff
      );
      return clipped ?? this._emptyPixelRect();
    }

    async _getRectPixelSingleViewport(sRange, ui, xPixelOffset, yPixelOffset) {
      if (ui === null) {
        return this._emptyPixelRect();
      }
      if (
        sRange.bottom() < ui.toprow ||
        sRange.row() > this._uiLastVisibleRow(ui) ||
        sRange.right() < ui.topcol ||
        sRange.col() > this._uiLastVisibleCol(ui)
      ) {
        return this._emptyPixelRect();
      }

      sRange.normalize();
      const brRow = Math.min(sRange.bottom(), this._uiLastVisibleRow(ui));
      const brCol = Math.min(sRange.right(), this._uiLastVisibleCol(ui));
      const visR0 = Math.max(sRange.row(), ui.toprow);
      const visC0 = Math.max(sRange.col(), ui.topcol);

      const tlVis = this._getCellRectInViewport(
        ui,
        visR0,
        visC0,
        xPixelOffset,
        yPixelOffset
      );
      const br = this._getCellRectInViewport(
        ui,
        brRow,
        brCol,
        xPixelOffset,
        yPixelOffset
      );
      const tl =
        tlVis ??
        (sRange.col() >= ui.topcol && sRange.row() >= ui.toprow
          ? this._getCellRectInViewport(
              ui,
              sRange.row(),
              sRange.col(),
              xPixelOffset,
              yPixelOffset
            )
          : null);

      const finishRange = (tlRect, brRect) => {
        if (brRect == null) {
          return null;
        }
        let wLeft;
        let wTop;
        let wWidth;
        let wHeight;
        if (tlRect != null) {
          wLeft = tlRect.Left;
          wTop = tlRect.Top;
          wWidth = Math.max(0, brRect.Left + brRect.Width - tlRect.Left);
          wHeight = Math.max(0, brRect.Top + brRect.Height - tlRect.Top);
        } else {
          wLeft = brRect.Left;
          wTop = brRect.Top;
          wWidth = brRect.Width;
          wHeight = brRect.Height;
        }
        let rect = { Left: wLeft, Top: wTop, Width: wWidth, Height: wHeight };
        rect = this._clipRangeRectToViewportOrigin(
          sRange,
          ui,
          rect,
          xPixelOffset,
          yPixelOffset
        );
        return (
          this._applyPaneClipToRect(
            rect,
            xPixelOffset,
            yPixelOffset
          ) ?? this._emptyPixelRect()
        );
      };

      if (br) {
        const out = finishRange(tl, br);
        if (out && out.Width > 0 && out.Height > 0) {
          return out;
        }
      }

      const layoutRange = this._rangeRectFromUiLayout(
        ui,
        visR0,
        visC0,
        brRow,
        brCol,
        xPixelOffset,
        yPixelOffset
      );
      if (layoutRange != null) {
        const clippedLayout = this._clipRangeRectToViewportOrigin(
          sRange,
          ui,
          layoutRange,
          xPixelOffset,
          yPixelOffset
        );
        const out =
          this._applyPaneClipToRect(
            clippedLayout,
            xPixelOffset,
            yPixelOffset
          ) ?? this._emptyPixelRect();
        if (out.Width > 0 && out.Height > 0) {
          return out;
        }
      }

      return this._getRectPixelSumFallbackRange(
        sRange,
        ui,
        xPixelOffset,
        yPixelOffset
      );
    }

    /**
     * Maps a sheet cell to the JsonView pane that contains it plus canvas offsets for that pane.
     */
    _viewportAndOffsetsForSheetCell(sRow, sCol) {
      const rowFrozenActive = this.isFrozenSplitActive();
      const colFrozenActive = this.isFrozenColSplitActive();
      const fr = this.m_FrozenRowEnd;
      const fc = this.m_FrozenColEnd;
      const fh = this._frozenBandOffsetYPx();
      const fw = this._frozenBandOffsetXPx();

      const inFrozenRow = rowFrozenActive && fr > 0 && sRow >= 1 && sRow <= fr;
      const inFrozenCol = colFrozenActive && fc > 0 && sCol >= 1 && sCol <= fc;

      if (rowFrozenActive && colFrozenActive) {
        if (inFrozenRow && inFrozenCol) {
          return { ui: this.frozenCornerUiForPaint(), xOff: 0, yOff: 0 };
        }
        if (inFrozenRow && !inFrozenCol) {
          return { ui: this.frozenUiForPaint(), xOff: fw, yOff: 0 };
        }
        if (!inFrozenRow && inFrozenCol) {
          return { ui: this.frozenLeftUiForPaint(), xOff: 0, yOff: fh };
        }
        return { ui: this.m_UIView, xOff: fw, yOff: fh };
      }
      if (rowFrozenActive && !colFrozenActive) {
        if (inFrozenRow) {
          return { ui: this.frozenUiForPaint(), xOff: 0, yOff: 0 };
        }
        return { ui: this.m_UIView, xOff: 0, yOff: fh };
      }
      if (!rowFrozenActive && colFrozenActive) {
        if (inFrozenCol) {
          return { ui: this.frozenLeftUiForPaint(), xOff: 0, yOff: 0 };
        }
        return { ui: this.m_UIView, xOff: fw, yOff: 0 };
      }
      return { ui: this.m_UIView, xOff: 0, yOff: 0 };
    }

    async getRectPixelByColRow(sRow, sCol) {
      if (this.m_UIView === null) {
        return this._emptyPixelRect();
      }
      const vp = this._viewportAndOffsetsForSheetCell(sRow, sCol);
      const ui = vp.ui;
      const xOff = vp.xOff;
      const yOff = vp.yOff;
      if (
        ui == null ||
        sCol < ui.topcol ||
        sCol > this._uiLastVisibleCol(ui) ||
        sRow < ui.toprow ||
        sRow > this._uiLastVisibleRow(ui)
      ) {
        return this._emptyPixelRect();
      }

      const wCellRect = this._getCellRectInViewport(ui, sRow, sCol, xOff, yOff);
      if (wCellRect != null) {
        return wCellRect;
      }

      const layoutOnly = this._cellLayoutFromUi(ui, sRow, sCol);
      if (layoutOnly != null) {
        let wTop = yOff + layoutOnly.top;
        let wLeft = xOff + layoutOnly.left;
        let wWidth = layoutOnly.width;
        let wHeight = layoutOnly.height;
        const wCellFallback = this._getCellFromUi(ui, sRow, sCol);
        if (wCellFallback != null) {
          if (wCellFallback.hasOwnProperty("c_w")) {
            const cw = Number(wCellFallback.c_w);
            if (Number.isFinite(cw) && cw > 0) {
              wWidth = cw;
            }
          }
          if (wCellFallback.hasOwnProperty("c_h")) {
            const ch = Number(wCellFallback.c_h);
            if (Number.isFinite(ch) && ch > 0) {
              wHeight = ch;
            }
          }
        }
        const clipped = this._applyPaneClipToRect(
          { Left: wLeft, Top: wTop, Width: wWidth, Height: wHeight },
          xOff,
          yOff
        );
        if (clipped != null) {
          return clipped;
        }
      }

      return this._getRectPixelSumFallbackCell(sRow, sCol, ui, xOff, yOff);
    }

    /**
     * Top-left of an anchor cell in grid canvas coordinates (scroll-safe).
     * Uses JsonView when the cell is visible; WASM sum fallback when it is off-screen.
     */
    async getFloatingAnchorScreenOrigin(sRow, sCol) {
      const wSync = this.getFloatingAnchorScreenOriginSync(sRow, sCol);
      if (wSync != null) {
        return wSync;
      }
      if (this.m_UIView === null) {
        return { left: 0, top: 0 };
      }
      const vp = this._viewportAndOffsetsForSheetCell(sRow, sCol);
      const ui = vp.ui;
      if (ui == null) {
        return { left: 0, top: 0 };
      }
      const wFallback = await this._getRectPixelSumFallbackCell(
        sRow,
        sCol,
        ui,
        vp.xOff,
        vp.yOff
      );
      return {
        left: Number(wFallback?.Left) || 0,
        top: Number(wFallback?.Top) || 0,
      };
    }

    /**
     * Pixel rect for the active cell outline. Uses the merge range when the anchor column
     * is left of the viewport but the merged span is still partially visible (getRectPixelByColRow empty).
     */
    async getOutlineRectForCursorPaint(sRow, sCol) {
      if (this.isRowColVisibleInGrid(sRow, sCol)) {
        return this.getRectPixelByColRow(sRow, sCol);
      }
      const merged = await this.returnMerged(sRow, sCol);
      if (merged != null) {
        const rng = new tRange(
          Number(merged.r_t),
          Number(merged.r_l),
          Number(merged.r_b),
          Number(merged.r_r)
        );
        return this.getRectPixel(rng);
      }
      return this._emptyPixelRect();
    }

    /** Like {@link #getOutlineRectForCursorPaint} but returns one rect per freeze pane (no spanning union). */
    async getOutlineRectFragmentsForCursorPaint(sRow, sCol) {
      if (
        this.m_UseEdit &&
        this.m_InplaceEditOverlayRect != null &&
        this.m_CursorEdit != null &&
        !this.isAttributePanelPropertyEdit() &&
        sRow === this.m_CursorEdit.row() &&
        sCol === this.m_CursorEdit.col()
      ) {
        const wRect = this.m_InplaceEditOverlayRect;
        if (wRect != null && wRect.Width > 0 && wRect.Height > 0) {
          return [wRect];
        }
      }

      const merged = await this.returnMerged(sRow, sCol);
      if (merged != null) {
        const rTop = Number(merged.r_t);
        const rBot = Number(merged.r_b);
        const cL = Number(merged.r_l);
        const cR = Number(merged.r_r);
        const rowFr = this.isFrozenSplitActive();
        const colFr = this.isFrozenColSplitActive();
        const fr = rowFr ? this.m_FrozenRowEnd : 0;
        const fc = colFr ? this.m_FrozenColEnd : 0;
        const crossesRows = rowFr && fr > 0 && rTop <= fr && rBot > fr;
        const crossesCols = colFr && fc > 0 && cL <= fc && cR > fc;
        const rng = new tRange(rTop, cL, rBot, cR);
        if (crossesRows || crossesCols) {
          return this.getRectPixelFragments(rng);
        }
        const px = await this.getRectPixel(rng);
        return px.Width > 0 && px.Height > 0 ? [px] : [];
      }
      if (this.isRowColVisibleInGrid(sRow, sCol)) {
        const r = await this.getRectPixelByColRow(sRow, sCol);
        return r.Width > 0 && r.Height > 0 ? [r] : [];
      }
      if (merged != null) {
        const rng = new tRange(
          Number(merged.r_t),
          Number(merged.r_l),
          Number(merged.r_b),
          Number(merged.r_r)
        );
        return this.getRectPixelFragments(rng);
      }
      return [];
    }

    async getRectPixelCursor() {
      let wRow;
      let wCol;
      if (this.m_UseEdit && this.m_CursorEdit != null) {
        wRow = this.m_CursorEdit.row();
        wCol = this.m_CursorEdit.col();
      } else {
        const wCursor = this.m_Select.cursor();
        wRow = wCursor.row();
        wCol = wCursor.col();
      }
      return await this.getOutlineRectForCursorPaint(wRow, wCol);
    }

    ReturnPositivevalue(sValue) {
      if(sValue<0) return 0;
      return(sValue);
    }
    
    /**
     * Horizontal freeze seam Y (CSS px), aligned with SkSpGridCanvas (ceil of band height).
     */
    _snapRowFreezeSeamYCanvasPx() {
      return this._frozenBandOffsetYPx();
    }

    /**
     * Remove small gaps at the row-freeze seam. Only runs when multiple panes produced rects
     * (length >= 2); snapping a single rect can mis-classify straddling and break row selection.
     */
    _snapFragmentsToRowFreezeSeam(fragments) {
      if (!this.isFrozenSplitActive() || fragments.length < 2) {
        return fragments;
      }
      const splitY = this._snapRowFreezeSeamYCanvasPx();
      if (!(splitY > 0)) {
        return fragments;
      }
      const eps = 1;

      let minTop = Infinity;
      let maxBottom = -Infinity;
      for (const f of fragments) {
        minTop = Math.min(minTop, f.Top);
        maxBottom = Math.max(maxBottom, f.Top + f.Height);
      }
      if (!(minTop < splitY + eps && maxBottom > splitY - eps)) {
        return fragments;
      }

      return fragments.map((f) => {
        const t = f.Top;
        const h0 = Math.max(0, f.Height);
        if (!(h0 > 0)) {
          return f;
        }
        const b = t + h0;

        if (t < splitY - eps) {
          if (b > splitY + eps) {
            return { ...f, Top: t, Height: Math.max(0, splitY - t) };
          }
          if (b < splitY - eps) {
            return { ...f, Top: t, Height: splitY - t };
          }
          return f;
        }
        if (t < splitY && t >= splitY - 48) {
          const dh = splitY - t;
          return { ...f, Top: splitY, Height: Math.max(0, h0 - dh) };
        }
        return f;
      });
    }

    /**
     * Pixel rectangles for range, one entry per freeze pane intersected (no cross-pane union).
     * Used so cursor/outline paint does not build one AABB bridging the horizontal/vertical seam.
     */
    async getRectPixelFragments(sRange) {
      sRange.normalize();
      if (this.m_UIView === null) {
        return [];
      }
      const rowFr = this.isFrozenSplitActive();
      const colFr = this.isFrozenColSplitActive();
      if (!rowFr && !colFr) {
        const p = await this._getRectPixelSingleViewport(sRange, this.m_UIView, 0, 0);
        return p.Width > 0 && p.Height > 0 ? [p] : [];
      }

      const fr = rowFr ? this.m_FrozenRowEnd : 0;
      const fc = colFr ? this.m_FrozenColEnd : 0;
      const fh = rowFr ? this._frozenBandOffsetYPx() : 0;
      const fw = colFr ? this._frozenBandOffsetXPx() : 0;

      const rowBands = [];
      if (rowFr) {
        if (sRange.row() <= fr) {
          rowBands.push({ r0: sRange.row(), r1: Math.min(sRange.bottom(), fr), yOff: 0, key: "top" });
        }
        if (sRange.bottom() > fr) {
          rowBands.push({
            r0: Math.max(sRange.row(), fr + 1),
            r1: sRange.bottom(),
            yOff: fh,
            key: "bot",
          });
        }
      } else {
        rowBands.push({ r0: sRange.row(), r1: sRange.bottom(), yOff: 0, key: "all" });
      }

      const colBands = [];
      if (colFr) {
        if (sRange.col() <= fc) {
          colBands.push({
            c0: sRange.col(),
            c1: Math.min(sRange.right(), fc),
            xOff: 0,
            key: "left",
          });
        }
        if (sRange.right() > fc) {
          colBands.push({
            c0: Math.max(sRange.col(), fc + 1),
            c1: sRange.right(),
            xOff: fw,
            key: "right",
          });
        }
      } else {
        colBands.push({ c0: sRange.col(), c1: sRange.right(), xOff: 0, key: "all" });
      }

      const out = [];

      for (const rb of rowBands) {
        for (const cb of colBands) {
          if (rb.r0 > rb.r1 || cb.c0 > cb.c1) {
            continue;
          }
          const sub = new tRange(rb.r0, cb.c0, rb.r1, cb.c1);
          let ui = this.m_UIView;
          let xo = cb.xOff;
          let yo = rb.yOff;

          if (rowFr && colFr) {
            if (rb.key === "top" && cb.key === "left") {
              ui = this.frozenCornerUiForPaint();
            } else if (rb.key === "top" && cb.key === "right") {
              ui = this.frozenUiForPaint();
            } else if (rb.key === "bot" && cb.key === "left") {
              ui = this.frozenLeftUiForPaint();
            } else {
              ui = this.m_UIView;
            }
          } else if (rowFr && !colFr) {
            ui = rb.key === "top" ? this.frozenUiForPaint() : this.m_UIView;
            xo = 0;
          } else if (!rowFr && colFr) {
            ui = cb.key === "left" ? this.frozenLeftUiForPaint() : this.m_UIView;
            yo = 0;
          }

          if (ui == null) {
            continue;
          }
          const px = await this._getRectPixelSingleViewport(sub, ui, xo, yo);
          if (px.Width > 0 && px.Height > 0) {
            out.push(px);
          }
        }
      }

      return this._snapFragmentsToRowFreezeSeam(out);
    }

    async getRectPixel(sRange) {
      const frags = await this.getRectPixelFragments(sRange);
      let acc = this._emptyPixelRect();
      for (const px of frags) {
        acc = this._rectUnion(acc, px);
      }
      return acc;
    }

    // Mouse Down treat Move  ( SkSpGridCanvas )===============================
    async mouseDownSelect(sPos) {
      if (this.isFloatingObjectDragging()) {
        return;
      }
      this.clearFloatingObjectSelection(true, false);
      if (this.isAttributePanelPropertyEdit()) {
        const wAttrEd = this.m_SkSpInplaceEditProperty;
        if (wAttrEd != null && typeof wAttrEd.captureFormulaPickCaret === "function") {
          wAttrEd.captureFormulaPickCaret();
        }
      }
      if (
        this.getUseEdit() &&
        !this.isPropertyRangePickerEdit() &&
        this.m_CursorEdit != null
      ) {
        const wTarget = await this.cellFromGridMouse(sPos.X, sPos.Y);
        const wAnchor = this.m_CursorEdit;
        const wOtherCell =
          wTarget.row !== wAnchor.row() || wTarget.col !== wAnchor.col();
        if (wOtherCell) {
          const wPointMode = this.isAnyEditorInFormulaPointMode();
          const wAttrRangePick =
            this.isAttributePanelPropertyEdit() && this.isGridRangePickActive();
          if (!wPointMode && !wAttrRangePick) {
            const wOk = await this.validEdit();
            if (!wOk) {
              return;
            }
          }
        }
      }
      await this.setCursorByMouse(sPos.X,sPos.Y,true);
      this.m_MouseDown=true;
      this.m_Selected=false;
      if (this.getUseEdit()) {
        this.scheduleInvalidateSelection();
        this.focusActiveInplaceEdit();
      } else {
        this.scheduleInvalidateSelection();
      }
      this.sendMoveCell(this.cursor());
    }

    // Shift+click: add a NEW discontiguous selection (Excel Ctrl+click style).
    // mouseDownSelect only moves the cursor and never pushes it, so shift needs its
    // own path: materialize the current active cell as a stored selection, then move
    // the cursor to the clicked cell. Repeating accumulates separate selections
    // (A1, C3, E5, …) instead of a single range.
    async mouseShiftSelect(sPos) {
      if (this.isFloatingObjectDragging()) {
        return;
      }
      const wCell = await this.cellFromGridMouse(sPos.X, sPos.Y);
      // Push the current cursor cell so it stays selected, then activate the new one.
      this.m_Select.push(await this.rangeSelect(this.cursor()));
      this.m_Select.setCursor(new tPoint(wCell.row, wCell.col));
      // A following drag starts a fresh range for the newly active cell.
      this.m_MouseDown = true;
      this.m_Selected = false;
      this.scheduleInvalidateSelection();
      this.invalidateOverlays();
      this.sendMoveCell(this.cursor());
    }

    async mouseMoveSelect(sPos) {
      if (this.isFloatingObjectDragging()) {
        return;
      }
      if (this.m_SkSpGridCanvas!=null) {
        if (this.m_MouseDown) {
          const canvas = this.m_SkSpGridCanvas.m_Ref.current;
          if (canvas && this.m_UIView) {
            const vp = this.getGridInnerViewportCssPx(canvas);
            const ch = this.m_ClientHeight > 0 ? this.m_ClientHeight : vp.height;
            const cw = this.m_ClientWidth > 0 ? this.m_ClientWidth : vp.width;
            const fh = this.m_FrozenPixH > 0 ? this.m_FrozenPixH : 0;
            const fw = this.m_FrozenPixW > 0 ? this.m_FrozenPixW : 0;
            let tr = Number(this.m_UIView.toprow);
            let tc = Number(this.m_UIView.topcol);
            let scrolled = false;

            if (sPos.Y >= vp.height) {
              tr += 1;
              scrolled = true;
            } else if (sPos.Y < fh) {
              tr = Math.max(this.minVerticalScrollRow(), tr - 1);
              scrolled = true;
            }
            if (sPos.X >= vp.width) {
              tc += 1;
              scrolled = true;
            } else if (sPos.X < fw) {
              tc = Math.max(this.minHorizontalScrollCol(), tc - 1);
              scrolled = true;
            }
            if (scrolled) {
              this.m_DiffY = 0;
              this.m_DiffX = 0;
              await this.getView(tr, tc, ch, cw);
              this.invalidateAll();
            }
          }

          const x = Math.max(0, sPos.X);
          const y = Math.max(0, sPos.Y);
          let wBottom=await this.rowByPixel(y);
          let wRight=await this.colByPixel(x);
          // First Select 
          if (this.m_Selected===false) {
            let wCursor=this.cursor();  
            if ((wBottom!==wCursor.row()) || (wRight!==wCursor.col())) {
              let wRange=await this.rangeSelect(wCursor);
              this.m_Select.push(wRange);
              this.m_Selected=true;
            }
          } else {
            await this.cursorSelect(wBottom,wRight);
          }
          this.scheduleInvalidateSelection();
          this.invalidateOverlays();
        }
      }
    }

   async mouseUpSelect(sPos) {
      if (this.isFloatingObjectDragging()) {
        return;
      }
      if (this.m_SkSpGridCanvas!=null) {
        if (this.m_Select.last()!=null) {
          let wCursor=this.cursor();  
          // If last selection == cursor => Delete
          let wRange=this.m_Select.last();
          if ((wRange.row()===wCursor.row()) &&
              (wRange.col()===wCursor.col()) &&
              (wRange.bottom()===wCursor.row()) &&
              (wRange.right()===wCursor.col()) ) {
                this.m_Select.deleteLast();
          }
        }
        this.m_MouseDown=false;
        this.m_Selected=false;
        this.scheduleInvalidateSelection();
        this.invalidateOverlays();
      }
    }
    
    // Size of Row or Col ======================================================
    async isChangeSizeCol(sX) {
      let wCols = [];
      let wResult = { ColRow: -1, Start: 0, Move: 0, Size: 0 };
      if (this.m_UIView === null) {
        return Promise.resolve(wResult);
      }

      const pushColsFromUi = async (ui, xBase) => {
        let wStart = xBase + this._uiPaneDX(ui);
        for (let wIndCol = 0; wIndCol < ui.cols.length; wIndCol++) {
          const wCol = ui.cols[wIndCol].i;
          let wSize = Number(ui.cols[wIndCol].s) || 0;
          const wMove = wStart + wSize;
          wCols.push({
            ColRow: wCol,
            Start: wStart,
            Move: wMove,
            Size: wSize,
          });
          wStart += wSize;
        }
      };

      const fw = this.m_FrozenPixW > 0 ? this.m_FrozenPixW : 0;
      const leftUi = this._frozenColumnHeaderUiForPaint();
      if (fw > 0 && leftUi && Array.isArray(leftUi.cols)) {
        await pushColsFromUi(leftUi, 0);
      }
      const scrollUi = this._scrollColumnHeaderUiForPaint();
      if (scrollUi && Array.isArray(scrollUi.cols)) {
        await pushColsFromUi(scrollUi, fw);
      }

      for (let wIndCol = wCols.length - 1; wIndCol >= 0; wIndCol--) {
        const wX = wCols[wIndCol].Move;
        const wDiff = sX - wX;
        if (Math.abs(wDiff) < 5) {
          return wCols[wIndCol];
        }
      }
      return wResult;
    }

    async isChangeSizeRow(sY) {
      let wRows = [];
      let wResult = { ColRow: -1, Start: 0, Move: 0, Size: 0 };
      if (this.m_UIView === null) return Promise.resolve(wResult);

      const appendRows = async (ui, yBase) => {
        let wStart = yBase + this._uiPaneDY(ui);
        for (let wIndRow = 0; wIndRow < ui.rows.length; wIndRow++) {
          let wRow = ui.rows[wIndRow].i;
          let wSize = Number(ui.rows[wIndRow].s) || 0;
          let wMove = wStart + wSize;
          wRows.push({ ColRow: wRow, Start: wStart, Move: wMove, Size: wSize });
          wStart += wSize;
        }
      };

      if (this.m_UIViewFrozen && this.m_FrozenPixH > 0) {
        const wFu = this._frozenUiClampedToRowEnd(this.m_UIViewFrozen) ?? this.m_UIViewFrozen;
        await appendRows(wFu, 0);
      }
      await appendRows(this.m_UIView, this.m_FrozenPixH);

      for (let wIndRow = wRows.length - 1; wIndRow >= 0; wIndRow--) {
        let wY = wRows[wIndRow].Move;
        let wDiff = sY - wY;
        if (Math.abs(wDiff) < 5) {
          return wRows[wIndRow];
        }
      }
      return wResult;
    }

    disableChangeSizeColRow() {
      this.m_Sizer.setActive(false);
    }
    
    startChangeSizeColRow(sTop, sSizeResult) {
      this.m_Sizer.setActive(true);
      this.m_Sizer.setTop(sTop);
      this.m_Sizer.setColRow(sSizeResult.ColRow);
      this.m_Sizer.setStart(sSizeResult.Start);
      this.m_Sizer.setMove(sSizeResult.Move);
      
      return this.m_SkSpGridCanvas.invalidate();
    }
    
    moveChangeSizeColRow(sPos) {    
      let wPosition = 0;
      if (this.m_Sizer.top()) {
        wPosition = sPos.X;
      } else {
        wPosition = sPos.Y;
      }
      if (wPosition >= this.m_Sizer.start()) {
        this.m_Sizer.setMove(wPosition);
      } else {
        this.m_Sizer.setMove(this.m_Sizer.start());
      }
      return this.m_SkSpGridCanvas.invalidate();
    }

    stopChangeSizeColRow() {
      if (this.m_Sizer.active()) {
        this.m_Sizer.setActive(false);
        let wSize = this.m_Sizer.move() - this.m_Sizer.start();
        if (wSize < 0) wSize = -1;
        this.setExtraUndo();

        const processSizeChange = async () => {
          const wColRow = this.m_Sizer.colRow();
          if (this.m_Sizer.top()) {
            // Resize the whole selection only when the dragged column actually
            // belongs to it; otherwise resize just the dragged column (Excel behavior).
            if (this.m_SelectCol.selected(wColRow)) {
              this.m_SelectCol.m_Selections.forEach((wInterval) => {
                window.SkUISpreadSheet.sizeCol(wInterval.m_Begin, wInterval.m_End, wSize);
              });
            } else {
              window.SkUISpreadSheet.sizeCol(wColRow, wColRow, wSize);
            }
          } else {
            // Same rule for rows: only apply to the selection if the dragged row is in it.
            if (this.m_SelectRow.selected(wColRow)) {
              this.m_SelectRow.m_Selections.forEach((wInterval) => {
                window.SkUISpreadSheet.sizeRow(wInterval.m_Begin, wInterval.m_End, wSize);
              });
            } else {
              window.SkUISpreadSheet.sizeRow(wColRow, wColRow, wSize);
            }
          }
          this.invalidateSheetExtent();
          await this.getView(this.m_UIView.toprow, this.m_UIView.topcol, this.m_ClientHeight, this.m_ClientWidth);
          return this.invalidateAll();
        };

        return processSizeChange();
      }
      return Promise.resolve();
    }
    
    async startColRowSelect(sIsRow, sPos, event) {
      if (sIsRow) {
        const wRow = await this.rowByPixel(sPos.Y);
        if (!event.shiftKey) {
          await this.razAllselect();
        }
        this.m_SelectRow.start(wRow);
        // Keep cursor inside the selected band (avoids orphan outline in another col).
        const wCol = this.cursor().col();
        this.m_Select.setCursor(new tPoint(wRow, wCol > 0 ? wCol : 1));
        this.scheduleInvalidateSelection();
        this.invalidateOverlays();
        this.focusGridCanvas();
      } else {
        const wCol = await this.colByPixel(sPos.X);
        if (!event.shiftKey) {
          await this.razAllselect();
        }
        this.m_SelectCol.start(wCol);
        // Keep cursor inside the selected band (avoids orphan outline in another row).
        const wRow = this.cursor().row();
        this.m_Select.setCursor(new tPoint(wRow > 0 ? wRow : 1, wCol));
        this.scheduleInvalidateSelection();
        this.invalidateOverlays();
        this.focusGridCanvas();
      }
    }

    async moveColRowSelect(sIsRow, wPos) {
      if (sIsRow) {
        const wRow = await this.rowByPixel(wPos.Y);
        const wInterval = this.m_SelectRow.last();
        wInterval.move(wRow);
        this.scheduleInvalidateSelection();
        this.invalidateOverlays();
      } else {
        const wCol = await this.colByPixel(wPos.X);
        const wInterval = this.m_SelectCol.last();
        wInterval.move(wCol);
        this.scheduleInvalidateSelection();
        this.invalidateOverlays();
      }
    }

    endColRowSelect(sIsRow,event) {
      if (sIsRow) { 
        this.m_SelectRow.end();
      } else {
        this.m_SelectCol.end();
      }
      this.invalidateOverlays();
      // Header panels steal focus on click — restore grid so arrow keys work.
      this.focusGridCanvas();
    }

    /**
     * If the selection outline + handle (paintCursor) extends past the grid canvas bottom, scroll down
     * one sheet row at a time until it fits or the view cannot advance (matches user "add a line on top").
     */
    async nudgeViewUntilCursorBottomVisible(sCursor) {
      if (window.SkUISpreadSheet == null || this.m_UIView == null || sCursor == null) {
        return false;
      }
      const wRow = sCursor.row();
      const wCol = sCursor.col();
      const band = await this.visibleScrollRowBand();
      if (
        this.isFrozenSplitActive() &&
        wRow >= 1 &&
        wRow <= this.m_FrozenRowEnd
      ) {
        return false;
      }
      // JsonView lastrow can extend past the painted band; nudge when cursor is below on-screen rows.
      if (wRow > band.lastRow) {
        // continue
      } else if (!this.isRowColVisibleInGrid(wRow, wCol)) {
        return false;
      }

      const ch = this.m_ClientHeight > 0 ? this.m_ClientHeight : 600;
      const cw = this.m_ClientWidth > 0 ? this.m_ClientWidth : 800;
      // paintCursor: lineWidth 1.5 + radius-3 dot at bottom-right → keep margin below cell box
      const CURSOR_PAINT_OUTSET_BOTTOM = 12;
      const canvasBottom = ch - 2;

      let changed = false;
      for (let i = 0; i < 120; i++) {
        const rect = await this.getRectPixelByColRow(wRow, wCol);
        if (!(rect.Height > 0 || rect.Width > 0)) {
          if (wRow > band.lastRow) {
            const prevTop = Number(this.m_UIView.toprow);
            const tc = Number(this.m_UIView.topcol);
            if (!Number.isFinite(prevTop) || !Number.isFinite(tc)) {
              break;
            }
            const tr = prevTop + 1;
            this.m_DiffY = 0;
            await this.getView(tr, tc, ch, cw);
            changed = true;
            const newTop = Number(this.m_UIView.toprow);
            if (!Number.isFinite(newTop) || newTop <= prevTop) {
              break;
            }
            continue;
          }
          break;
        }
        const effectiveBottom = rect.Top + rect.Height + CURSOR_PAINT_OUTSET_BOTTOM;
        if (effectiveBottom <= canvasBottom) {
          break;
        }
        const prevTop = Number(this.m_UIView.toprow);
        const tc = Number(this.m_UIView.topcol);
        if (!Number.isFinite(prevTop) || !Number.isFinite(tc)) {
          break;
        }
        const tr = prevTop + 1;
        this.m_DiffY = 0;
        await this.getView(tr, tc, ch, cw);
        changed = true;
        const newTop = Number(this.m_UIView.toprow);
        if (!Number.isFinite(newTop) || newTop <= prevTop) {
          break;
        }
      }

      if (changed) {
        await this.snapScrollFirstRowAlignment();
      }
      return changed;
    }

    /**
     * If the selection outline + handle extends past the grid canvas left/right, scroll one column at a time
     * (topcol ± 1) until it fits or the view cannot advance — mirror of nudgeViewUntilCursorBottomVisible.
     */
    async nudgeViewUntilCursorHorizontallyVisible(sCursor) {
      if (window.SkUISpreadSheet == null || this.m_UIView == null || sCursor == null) {
        return false;
      }
      const wRow = sCursor.row();
      const wCol = sCursor.col();
      if (
        this.isFrozenColSplitActive() &&
        wCol >= 1 &&
        wCol <= this.m_FrozenColEnd
      ) {
        return false;
      }

      const ch = this.m_ClientHeight > 0 ? this.m_ClientHeight : 600;
      const cw = this.m_ClientWidth > 0 ? this.m_ClientWidth : 800;
      const CURSOR_PAINT_OUTSET = 12;
      const canvasRight = cw - 2;
      const VIEW_EDGE_EPS = 2;
      // Match paintFreeze*: scrollable columns start to the right of the frozen band, not at x≈0.
      const fwFrozen =
        this.isFrozenColSplitActive() && Number(this.m_FrozenPixW) > 0
          ? Math.ceil(Number(this.m_FrozenPixW) || 0)
          : 0;
      const canvasLeft = fwFrozen + 2;

      const vp0 = this._viewportAndOffsetsForSheetCell(wRow, wCol);
      const u0 = vp0.ui;
      const dX0 = u0 ? vp0.xOff + (u0.dX ?? 0) : 0;

      const probe = await this.getOutlineRectForCursorPaint(wRow, wCol);
      if (!(probe.Height > 0 || probe.Width > 0)) {
        return false;
      }
      // Wide merged cell: do not scroll right to fit the right edge (would hide the anchor column, e.g. A).
      if (
        probe.Width > 0 &&
        Number.isFinite(cw) &&
        cw > 0 &&
        probe.Left <= dX0 + VIEW_EDGE_EPS &&
        probe.Left + probe.Width > cw + VIEW_EDGE_EPS
      ) {
        return false;
      }

      let changed = false;
      const maxSteps = 200;

      for (let i = 0; i < maxSteps; i++) {
        const rect = await this.getOutlineRectForCursorPaint(wRow, wCol);
        if (!(rect.Height > 0 || rect.Width > 0)) {
          break;
        }
        const effectiveRight = rect.Left + rect.Width + CURSOR_PAINT_OUTSET;
        if (effectiveRight <= canvasRight) {
          break;
        }
        const prevCol = Number(this.m_UIView.topcol);
        const tr = Number(this.m_UIView.toprow);
        if (!Number.isFinite(prevCol) || !Number.isFinite(tr)) {
          break;
        }
        const tc = prevCol + 1;
        this.m_DiffY = 0;
        this.m_DiffX = 0;
        await this.getView(tr, tc, ch, cw);
        changed = true;
        const newCol = Number(this.m_UIView.topcol);
        if (!Number.isFinite(newCol) || newCol <= prevCol) {
          break;
        }
      }

      for (let i = 0; i < maxSteps; i++) {
        const rect = await this.getOutlineRectForCursorPaint(wRow, wCol);
        if (!(rect.Height > 0 || rect.Width > 0)) {
          break;
        }
        const effectiveLeft = rect.Left - CURSOR_PAINT_OUTSET;
        if (effectiveLeft >= canvasLeft) {
          break;
        }
        const prevCol = Number(this.m_UIView.topcol);
        const tr = Number(this.m_UIView.toprow);
        const minC = this.minHorizontalScrollCol();
        if (!Number.isFinite(prevCol) || !Number.isFinite(tr) || prevCol <= minC) {
          break;
        }
        const tc = prevCol - 1;
        this.m_DiffY = 0;
        this.m_DiffX = 0;
        await this.getView(tr, tc, ch, cw);
        changed = true;
        const newCol = Number(this.m_UIView.topcol);
        if (!Number.isFinite(newCol) || newCol >= prevCol) {
          break;
        }
      }

      if (changed) {
        await this.snapScrollFirstRowAlignment();
      }
      return changed;
    }

    async resetView(sCursor) {
      if (this.m_UIView===null)  {
        return;
      }
      // JsonRightJustify / JsonBottomJustify: direct WASM returns a JSON string; SkUISpreadSheet.call_Result
      // may return an already-parsed object — JSON.parse(object) fails and blocked vertical scroll.
      const justifyPayload = (raw) => {
        if (raw == null || raw === '') return null;
        if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw;
        if (typeof raw === 'string') {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        }
        return null;
      };

      let wTopRow=this.m_UIView.toprow;
      let wTopCol=this.m_UIView.topcol;
      let wGetView=false;
      const cw = this.m_ClientWidth;
      const ch = this.m_ClientHeight;
      const wScrollBand = await this.visibleScrollRowBand();
      const visibleLastRow = wScrollBand.lastRow;
      const justifyScrollW = this.effectiveJsonScrollWidthPx();
      const scrollCh = this.m_FrozenPixH > 0 ? Math.max(1, ch - this.m_FrozenPixH) : ch;
      // Bottom inset for cursor stroke, grid AA, rounding (replaces old m_DiffY = jd - 20 after Excel-style row snap).
      const BOTTOM_SCROLL_PAD_PX = 24;
      // Right-edge inset applied to JsonRightJustify diff → m_DiffX (cursor stroke / grid edge); same role as BOTTOM_SCROLL_PAD_PX on the X axis.
      const H_SCROLL_INSET_PX = 20;
      const justifyScrollH = Math.max(1, scrollCh - BOTTOM_SCROLL_PAD_PX);
      const visibleBottomY = Math.max(1, ch - BOTTOM_SCROLL_PAD_PX);
      /** Avoid spurious json*Justify when geometry is equal within a few px (float / merged cells). */
      const VIEW_EDGE_EPS = 2;
      // Do not zero m_DiffX before getView: vertical-only paths (row justify, bottom spill) used to clear it
      // for any vertical-only wGetView tick and broke rect jsonRightJustify (column G: m_DiffX 0 vs -127).
      // Left/right/spill branches assign m_DiffX explicitly when they need to change it.
      // Right ==================================================================
      // Single pane: if JsonView lastcol is 0/NaN before the first stable load, `1 > 0` was true and
      // jsonRightJustify ran for A1 (spurious m_DiffX -63/-127).
      const lastColInView = this._uiLastVisibleCol(this.m_UIView);
      if (
        Number.isFinite(lastColInView) &&
        lastColInView >= 1 &&
        sCursor.col() > lastColInView
      ) {
        let wCol = sCursor.col();
        let wRaw = window.SkUISpreadSheet.jsonRightJustify(wCol, justifyScrollW);
        const wJustify = justifyPayload(wRaw);
        let ok = false;
        if (wJustify) {
          const jc = Number(wJustify.col);
          const jd = Number(wJustify.diff);
          if (Number.isFinite(jc) && Number.isFinite(jd)) {
            this.m_DiffX = jd - H_SCROLL_INSET_PX;
            wTopCol = jc;
            wGetView = true;
            ok = true;
          }
        }
        if (!ok) {
          this.m_DiffX = 0;
          wTopCol = wCol;
          wGetView = true;
        }
      }
      // Left ===================================================================
      if (sCursor.col()<this.m_UIView.topcol) {
        if (sCursor.col()<1) {
          sCursor.setCol(1);
        }
        wTopCol=sCursor.col();
        wGetView=true;
        this.m_DiffX=0;
      }

      // Bottom / top scroll bands: run before getRect-based horizontal spill so stepping with ArrowDown
      // does not call jsonRightJustify on stale viewport metrics (spurious m_DiffX on column A).
      // Use on-screen last row (visibleScrollRowBand), not JsonView lastrow — jsonH spill can extend lastrow
      // past the painted band (tall rows / formula pick on budget sheets).
      if (sCursor.row() > visibleLastRow) {
        let wRow = sCursor.row();
        let wRaw = window.SkUISpreadSheet.jsonBottomJustify(wRow, justifyScrollH);
        const wJustify = justifyPayload(wRaw);
        let ok = false;
        if (wJustify) {
          const jr = Number(wJustify.row);
          const jd = Number(wJustify.diff);
          if (Number.isFinite(jr) && Number.isFinite(jd)) {
            // Row from justify only; no vertical sub-pixel offset (Excel-style top row always full).
            this.m_DiffY = 0;
            wTopRow = jr;
            wGetView = true;
            ok = true;
          }
        }
        if (!ok) {
          this.m_DiffY = 0;
          wTopRow = wRow;
          wGetView = true;
        }
      }
      if (sCursor.row() < this.m_UIView.toprow) {
        const fr = this.m_FrozenRowEnd;
        const fc = this.m_FrozenColEnd;
        const inFrozenRow =
          this.m_FrozenPixH > 0 &&
          fr > 0 &&
          sCursor.row() >= 1 &&
          sCursor.row() <= fr;
        const inFrozenCol =
          this.m_FrozenPixW > 0 &&
          fc > 0 &&
          sCursor.col() >= 1 &&
          sCursor.col() <= fc;

        let frozenVisible = false;
        if (inFrozenRow && inFrozenCol && this.isFrozenFourPaneActive()) {
          const u = this.frozenCornerUiForPaint();
          frozenVisible =
            !!u &&
            sCursor.row() >= u.toprow &&
            sCursor.row() <= u.lastrow;
        } else if (inFrozenRow && !inFrozenCol && this.isFrozenSplitActive()) {
          const u = this.frozenUiForPaint();
          frozenVisible =
            !!u &&
            sCursor.row() >= u.toprow &&
            sCursor.row() <= u.lastrow;
        } else if (!inFrozenRow && inFrozenCol && this.isFrozenColSplitActive()) {
          // Four panes: vertical scroll is shared with m_UIView; frozen-left JSON can report a different
          // lastrow than the main pane (narrower col window) and wrongly skip getView when moving up from row 13→8.
          if (this.isFrozenFourPaneActive()) {
            const sc = this.m_UIView;
            frozenVisible =
              !!sc &&
              sCursor.row() >= sc.toprow &&
              sCursor.row() <= sc.lastrow;
          } else {
            const u = this.frozenLeftUiForPaint();
            frozenVisible =
              !!u &&
              sCursor.row() >= u.toprow &&
              sCursor.row() <= u.lastrow;
          }
        }

        if (!frozenVisible) {
          if (sCursor.row() < 1) {
            sCursor.setRow(1);
          }
          this.m_DiffY = 0;
          wTopRow = sCursor.row();
          wGetView = true;
        }
      }

      // Single rect: getView requests inflated jsonW/jsonH for WASM, so lastcol/lastrow span more
      // indices than fit in the on-screen client — scroll when the cell spills past cw/ch.
      let wRect = await this.getRectPixelByColRow(sCursor.row(), sCursor.col());
      const vpEdge = this._viewportAndOffsetsForSheetCell(sCursor.row(), sCursor.col());
      const uEdge = vpEdge.ui;
      const dX0 = uEdge ? vpEdge.xOff + (uEdge.dX ?? 0) : 0;
      const dY0 = uEdge ? vpEdge.yOff + (uEdge.dY ?? 0) : 0;
      const wCellCursor = this.getCell(sCursor.row(), sCursor.col());
      const minScrollCol = this.minHorizontalScrollCol();
      const cursorCol = Math.round(Number(sCursor.col()));
      // Rect-based jsonRightJustify on the first scrollable sheet column (A if no freeze) fights
      // snapScrollFirstColAlignment / WASM dX (double jsonView, m_DiffX toggling). Only require the
      // active column to match — comparing topcol===minScrollCol failed when topcol was float/string or
      // briefly out of sync after load, which re-enabled justify and produced diffX -63/-127.
      const skipRectRightJustifyForFirstScrollColumn = cursorCol === minScrollCol;
      // Merged anchor flush with viewport left/top but wider/taller than client — spill past cw/ch is normal (Excel shows leading edge).
      const mergedSpillsPastRight =
        wCellCursor != null &&
        wCellCursor.hasOwnProperty("c_w") &&
        wRect.Left <= dX0 + VIEW_EDGE_EPS &&
        wRect.Width > 0 &&
        Number.isFinite(cw) &&
        cw > 0 &&
        wRect.Left + wRect.Width > cw + VIEW_EDGE_EPS;
      const mergedSpillsPastBottom =
        wCellCursor != null &&
        wCellCursor.hasOwnProperty("c_h") &&
        wRect.Top <= dY0 + VIEW_EDGE_EPS &&
        wRect.Height > 0 &&
        Number.isFinite(ch) &&
        ch > 0 &&
        wRect.Top + wRect.Height > visibleBottomY + VIEW_EDGE_EPS;
      if (wRect.Left < -VIEW_EDGE_EPS) {
        this.m_DiffX = 0;
        wTopCol = sCursor.col();
        wGetView = true;
      }
      if (
        !wGetView &&
        !mergedSpillsPastRight &&
        !skipRectRightJustifyForFirstScrollColumn &&
        wRect.Width > 0 &&
        Number.isFinite(cw) &&
        cw > 0 &&
        wRect.Left + wRect.Width > cw + VIEW_EDGE_EPS
      ) {
        let wCol = sCursor.col();
        let wRaw = window.SkUISpreadSheet.jsonRightJustify(wCol, justifyScrollW);
        const wJustify = justifyPayload(wRaw);
        let ok = false;
        if (wJustify) {
          const jc = Number(wJustify.col);
          const jd = Number(wJustify.diff);
          if (Number.isFinite(jc) && Number.isFinite(jd)) {
            this.m_DiffX = jd - H_SCROLL_INSET_PX;
            wTopCol = jc;
            wGetView = true;
            ok = true;
          }
        }
        if (!ok) {
          this.m_DiffX = 0;
          wTopCol = wCol;
          wGetView = true;
        }
      }

      if (wRect.Top < -VIEW_EDGE_EPS) {
        this.m_DiffY = 0;
        wTopRow = sCursor.row();
        wGetView = true;
      }
      if (
        !wGetView &&
        !mergedSpillsPastBottom &&
        wRect.Height > 0 &&
        Number.isFinite(ch) &&
        ch > 0 &&
        wRect.Top + wRect.Height > visibleBottomY + VIEW_EDGE_EPS
      ) {
        let wRow = sCursor.row();
        let wRaw = window.SkUISpreadSheet.jsonBottomJustify(wRow, justifyScrollH);
        const wJustify = justifyPayload(wRaw);
        let ok = false;
        if (wJustify) {
          const jr = Number(wJustify.row);
          const jd = Number(wJustify.diff);
          if (Number.isFinite(jr) && Number.isFinite(jd)) {
            // Row from justify only; no vertical sub-pixel offset (Excel-style top row always full).
            this.m_DiffY = 0;
            wTopRow = jr;
            wGetView = true;
            ok = true;
          }
        }
        if (!ok) {
          this.m_DiffY = 0;
          wTopRow = wRow;
          wGetView = true;
        }
      }

      // Cursor in frozen top row band: anchor scroll panes at (fr+1). Otherwise the bottom strip can
      // keep a stale deep toprow (e.g. 13) while outlines/cursor paint in the top panes.
      if (this.isFrozenSplitActive()) {
        const frSnap = Number(this.m_FrozenRowEnd);
        if (
          Number.isFinite(frSnap) &&
          frSnap >= 1 &&
          sCursor.row() >= 1 &&
          sCursor.row() <= frSnap
        ) {
          const firstScrollRow = frSnap + 1;
          const trSnap = Number(wTopRow);
          if (Number.isFinite(trSnap) && trSnap > firstScrollRow) {
            this.m_DiffY = 0;
            wTopRow = firstScrollRow;
            wGetView = true;
          }
        }
      }

      // Reload View ============================================================
      // Return sCursor (if not null invalidateALL)
      if (wGetView) {
        await this.getView(wTopRow,wTopCol,this.m_ClientHeight,this.m_ClientWidth);
      }

      const nudgedV = await this.nudgeViewUntilCursorBottomVisible(sCursor);
      const nudgedH = await this.nudgeViewUntilCursorHorizontallyVisible(sCursor);
      const snappedFirstCol = await this.snapScrollFirstColAlignment(sCursor.col());
      if (wGetView || nudgedV || nudgedH || snappedFirstCol) {
        return(sCursor);
      }

      return(null);
    }


    // Json Extra Undo ===========================================================
    async setExtraUndo() {
      const wExtraUndo = {
        sheet: this.m_UIView.sheet, 
        toprow: this.m_UIView.toprow,
        topcol: this.m_UIView.topcol,
        cursor: this.m_Select.m_Cursor,
        selections : this.m_Select.m_Selections,
        selectrows : this.m_SelectRow.m_Selections,
        selectcols : this.m_SelectCol.m_Selections
      };
      window.SkUISpreadSheet.setExtraUndo(JSON.stringify(wExtraUndo));
    }

    async getExtraUndo() {
      const wExtra = window.SkUISpreadSheet.getExtraUndo();
      if (wExtra!=="") {
        const wExtraUndo = JSON.parse(wExtra);
        this.m_UIView.sheet=wExtraUndo.sheet;
        this.m_UIView.toprow=wExtraUndo.toprow;   
        this.m_UIView.topcol=wExtraUndo.topcol;
        this.m_Select.m_Cursor.clone(wExtraUndo.cursor);
        this.m_Select.selectionsClone(wExtraUndo.selections);
        this.m_SelectRow.selectionsClone(wExtraUndo.selectrows);
        this.m_SelectCol.selectionsClone(wExtraUndo.selectcols);
      }
    }

    // Command ===================================================================
   async SetUndoActiveSheet(sSheet) {
      this.invalidateSheetExtent();
      window.SkUISpreadSheet.setActiveSheet(sSheet);
      await this.reloadView();
      if (this.m_SkSpSheetTab) {
        // CallBack Tab
        this.m_SkSpSheetTab.invalidate();
        this.m_SkSpSheetTab.SetTab(sSheet);
      }
    }

    /** Resync sheet tab strip from WASM (multi-user remote ops, undo/redo, etc.). */
    async syncSheetTabsFromWasm(wBeforeList) {
      const wPrevList = Array.isArray(wBeforeList) ? wBeforeList.slice() : this.m_SheetsList.slice();
      const wPrevActive = this.m_UIView?.sheet ?? "";
      const wList = await this.loadSheetList();
      let wActive = "";
      try {
        wActive = window.SkUISpreadSheet.getActiveSheet();
      } catch (_error) {
        /* best effort */
      }
      if (this.isSystemSheetName(wActive)) {
        wActive = wList.includes(wPrevActive) ? wPrevActive : (wList[0] ?? "");
      }
      if (wActive && !wList.includes(wActive) && wList.length > 0) {
        wActive = wList[0];
        window.SkUISpreadSheet.setActiveSheet(wActive);
      }
      const wListChanged =
        wPrevList.length !== wList.length ||
        wPrevList.some((name, index) => name !== wList[index]);
      const wActiveChanged = wActive !== wPrevActive;
      if (!wListChanged && !wActiveChanged) {
        return false;
      }
      if (this.m_UIView != null && wActive && !this.isSystemSheetName(wActive)) {
        this.m_UIView.sheet = wActive;
      }
      if (this.m_SkSpSheetTab) {
        if (wActive) {
          this.m_SkSpSheetTab.m_Sheet = wActive;
        }
        await this.m_SkSpSheetTab.invalidate();
        if (this.m_SkSpSheetTab.m_TabComponent && wActive) {
          this.m_SkSpSheetTab.m_TabComponent.SetTab(wActive);
        }
      }
      return true;
    }

    /** Resync sheet tab strip when undo/redo changes sheet list or order. */
    async _refreshSheetTabsAfterHistory(wSheetsBefore) {
      return this.syncSheetTabsFromWasm(wSheetsBefore);
    }

    async undo() {
      const wSheetsBefore = this.m_SheetsList.slice();
      const wSheetName=this.m_UIView.sheet;
      // SkUISpreadSheet.undo() returns true when the snapshot heuristic
      // detects a real change. It can return false when nothing changed
      // (empty stack) or when the pre/post extra-undo snapshots happen to
      // match (e.g. cursor unchanged). We still broadcast the cursor
      // unconditionally so the remote pointer always lands on the
      // post-Undo cell; only the chat notification is gated by wApplied.
      const wApplied = window.SkUISpreadSheet.undo();
      if (wApplied) {
        this.invalidateSheetExtent();
      }
      await this.getExtraUndo();
      const wTabsChanged = await this._refreshSheetTabsAfterHistory(wSheetsBefore);
      if (wSheetName!==this.m_UIView.sheet) {
        await this.SetUndoActiveSheet(this.m_UIView.sheet);
      } else {
        await this.reloadView();
      }
      if (wTabsChanged && this.m_SkSpSheetTab) {
        this.m_SkSpSheetTab.invalidate();
      }
      this.scheduleInvalidateSelection();
      this.invalidateAll();
      try { await this.sendMoveCell(this.m_Select.cursor()); } catch (_) {}
      if (wApplied) this._notifyHistoryAction("Undo");
      return wApplied;
    }

    async redo() {
      const wSheetsBefore = this.m_SheetsList.slice();
      const wSheetName=this.m_UIView.sheet;
      const wApplied = window.SkUISpreadSheet.redo();
      if (wApplied) {
        this.invalidateSheetExtent();
      }
      await this.getExtraUndo();
      const wTabsChanged = await this._refreshSheetTabsAfterHistory(wSheetsBefore);
      if (wSheetName!==window.SkUISpreadSheet.getActiveSheet()) {
        await this.SetUndoActiveSheet(window.SkUISpreadSheet.getActiveSheet());
      } else if (wApplied) {
        await this.reloadViewAfterSpreadsheetMutation();
      } else {
        await this.reloadView();
        this.scheduleInvalidateSelection();
        this.invalidateAll();
      }
      if (wTabsChanged && this.m_SkSpSheetTab) {
        this.m_SkSpSheetTab.invalidate();
      }
      try { await this.sendMoveCell(this.m_Select.cursor()); } catch (_) {}
      if (wApplied) this._notifyHistoryAction("Redo");
      return wApplied;
    }

    // Post a short message in the SpreadSheet chat describing an Undo/Redo
    // action together with the sheet name and the cursor cell (A1 notation),
    // so collaborators can see exactly where the action landed. Best-effort:
    // any error is swallowed and never breaks the history command.
    _notifyHistoryAction(sLabel) {
      try {
        const wChat = (typeof window !== 'undefined') ? window.SkSpChatSpreadSheet : null;
        if (!wChat || typeof wChat.sendMessage !== 'function') return;
        const wCursorRef = this.m_Select && typeof this.m_Select.cursorStr === 'function'
          ? this.m_Select.cursorStr()
          : '';
        const wSheet = (this.m_UIView && this.m_UIView.sheet) ? this.m_UIView.sheet : '';
        const wWhere = wSheet ? `${wSheet}!${wCursorRef}` : wCursorRef;
        const wText = wWhere ? `${sLabel} at ${wWhere}` : sLabel;
        wChat.sendMessage(wText);
      } catch (e) {
        // Never let chat notification break the history command.
      }
    }

    // Set Value ================================================================
    async setValue(sValue) {
      if (this.isAttributePanelPropertyEdit()) {
        return true;
      }
      if (
        this.m_SkSpInplaceEditProperty != null &&
        this.m_SkSpClassAttribute != null &&
        typeof this.m_SkSpClassAttribute.isFloatingObjectAttributeMode === "function" &&
        this.m_SkSpClassAttribute.isFloatingObjectAttributeMode()
      ) {
        return true;
      }

      const wCellRef = this.editCellRef();
      if (wCellRef == null || wCellRef === "") {
        console.error("setValue: no edit cell reference available");
        return false;
      }
      this.invalidateFormulaCache();
      this.setExtraUndo();

      const wApplyMutation = () => {
        if (this.m_SkSpInplaceEditProperty !== null) {
          const wProperty = this.m_SkSpInplaceEditProperty.property();
          const wAnchorCell = this.getEditAnchorCell();
          const wClassName = reactCellClassTypeName(wAnchorCell);
          let wWire = sValue != null ? String(sValue) : "";
          const wPropRow = this.m_SkSpClassAttribute?.state?.properties?.find(
            (wItem) => wItem?.n === wProperty,
          );
          const wKind = wPropRow?.k != null ? String(wPropRow.k) : "";
          wWire = SkCellClass.normalizeScalarAttributeInput(wWire, wKind);
          if (wProperty === "value" && usesCalculableModelValue(wClassName)) {
            return window.SkUISpreadSheet.valueClassCalculable(wCellRef, wWire);
          }
          return window.SkUISpreadSheet.valueAttribute(wCellRef, wProperty, wWire);
        }
        return window.SkUISpreadSheet.value(wCellRef, sValue);
      };

      // Commit the write synchronously, then let dependent recalc run in the background so
      // the caller (Enter, formula bar, function insert) regains control immediately (F9-style).
      const wSpread = this.m_SkSpreadSheet;
      if (
        isCooperativeRecalcAvailable() &&
        typeof wSpread?.commitValueWithBackgroundRecalc === "function"
      ) {
        return wSpread.commitValueWithBackgroundRecalc(wApplyMutation);
      }
      return wApplyMutation();
    }

    async Raz(sValue) {
      this.setExtraUndo();
      let wSelection=this.selectstr();
      window.SkUISpreadSheet.Raz(wSelection);
      await this.reloadView();
    }
    
    async copy() {
      this.setExtraUndo();
      let wSelection=this.selectstr();
      window.SkUISpreadSheet.copy(wSelection);
      await this.reloadView();
      return true;
    }

    async cut() {
      this.setExtraUndo();
      let wSelection = this.selectstr();
      const wOk = window.SkUISpreadSheet.cut(wSelection);
      if (!wOk) {
        await this.notifyOperationFailure('Failed to cut');
        return false;
      }
      await this.reloadViewAfterSpreadsheetMutation();
      return true;
    }

    async paste() {
      this.setExtraUndo();
      let wSelection=this.selectstr();
      const wOk = window.SkUISpreadSheet.paste(wSelection);
      if (!wOk) {
        await this.notifyOperationFailure('Failed to copy-paste');
        return false;
      }
      await this.reloadViewAfterSpreadsheetMutation();
      return true;
    }

    async moveSelection(sourceRef, destRef) {
      if (!sourceRef || !destRef || sourceRef === destRef) {
        return true;
      }
      this.setExtraUndo();
      const wSheet = this.m_UIView?.sheet || "";
      const wOk = window.SkUISpreadSheet.move(sourceRef, destRef, wSheet);
      if (!wOk) {
        await this.notifyOperationFailure('Failed to move');
        return false;
      }
      await this.reloadViewAfterSpreadsheetMutation();
      return true;
    }

    applySelectionRange(sTop, sLeft, sBottom, sRight) {
      this.razAllselect();
      this.m_Select.setCursor(new tPoint(sTop, sLeft));
      if (sBottom !== sTop || sRight !== sLeft) {
        this.m_Select.push(new tRange(sTop, sLeft, sBottom, sRight));
      }
      this.scheduleInvalidateSelection();
    }

    async commitDragMove(sDrag) {
      if (sDrag == null || sDrag.destTop == null) {
        return false;
      }
      const wDestRef = this.m_Select.strRange(
        new tRange(sDrag.destTop, sDrag.destLeft, sDrag.destBottom, sDrag.destRight)
      );
      if (sDrag.sourceRef === wDestRef) {
        return true;
      }
      const wSheet = this.m_UIView?.sheet || "";
      let wOk = false;
      if (sDrag.copyMode) {
        this.setExtraUndo();
        wOk = window.SkUISpreadSheet.copy(sDrag.sourceRef, wSheet);
        if (wOk) {
          wOk = window.SkUISpreadSheet.paste(wDestRef, wSheet);
        }
        if (!wOk) {
          await this.notifyOperationFailure('Échec du copier-coller');
          return false;
        }
        await this.reloadViewAfterSpreadsheetMutation();
      } else {
        wOk = await this.moveSelection(sDrag.sourceRef, wDestRef);
      }
      if (!wOk) {
        return false;
      }
      this.applySelectionRange(
        sDrag.destTop,
        sDrag.destLeft,
        sDrag.destBottom,
        sDrag.destRight
      );
      await this.syncCursorMergeHighlight();
      this.invalidateAll();
      return true;
    }

    /** A1 reference for a single cell (1-based row/col). */
    _cellRef(sRow, sCol) {
      return window.SkUISpreadSheet.base10toAlphaSync(sCol) + sRow;
    }

    /**
     * Commit an Excel-like fill-handle drag: extrapolate the seed cells into the
     * extension range. One fill "line" per column (vertical) or row (horizontal).
     * Number/month/weekday/"prefix+number" series are written as values; lines
     * that contain a formula are continued via copy/paste so relative references
     * shift correctly.
     */
    async commitFill(sFill) {
      if (sFill == null || sFill.extTop == null || sFill.axis == null) {
        return false;
      }
      const wSheet = this.m_UIView?.sheet || "";
      // Source = original selection; destination = extension cells only. The
      // C++ engine (FillSeries) infers orientation/direction from the geometry,
      // extrapolates the series (numbers/months/weekdays/"prefix+number"/shifted
      // formulas) and applies everything as a single undo.
      const wSourceRef =
        this._cellRef(sFill.sourceTop, sFill.sourceLeft) +
        ":" +
        this._cellRef(sFill.sourceBottom, sFill.sourceRight);
      const wDestRef =
        this._cellRef(sFill.extTop, sFill.extLeft) +
        ":" +
        this._cellRef(sFill.extBottom, sFill.extRight);

      // Attach current selection so undo/redo restores it (FixUndoExtra C++ side).
      this.setExtraUndo();
      window.SkUISpreadSheet.fillSeries(wSourceRef, wDestRef, wSheet);

      await this.reloadViewAfterSpreadsheetMutation();
      this.applySelectionRange(
        sFill.destTop,
        sFill.destLeft,
        sFill.destBottom,
        sFill.destRight
      );
      await this.syncCursorMergeHighlight();
      this.invalidateAll();
      return true;
    }


    // Expand a single range string (e.g. "A1:B2") to cover any merged ranges
    // it overlaps. Iterates until the range is stable (merges can chain).
    async _expandRangeToMerges(sRangeStr) {
      let wOld = "";
      let wCur = sRangeStr;
      while (wOld !== wCur) {
        wOld = wCur;
        const wJson = window.SkUISpreadSheet.returnRangeMergedFusion(wCur);
        if (wJson === "") break;
        const wR = JSON.parse(wJson);
        const wLeft = window.SkUISpreadSheet.base10toAlphaSync(wR.r_l);
        const wRight = window.SkUISpreadSheet.base10toAlphaSync(wR.r_r);
        wCur = wLeft + wR.r_t + ":" + wRight + wR.r_b;
      }
      return wCur;
    }

    // Like selectstr() but each cell-range is expanded to include the merges
    // it covers. Required for border operations: applying border-right on the
    // anchor only writes to the cell to the right of the anchor (inside the
    // merge, invisible) instead of the cell to the right of the merge.
    async selectStrMerged() {
      const wParts = [];
      const wHasColRow = this.hasColRowSelect();
      const wSels = this.m_Select.selections();
      if (wSels.length > 0) {
        for (const wRange of wSels) {
          const wRangeStr = this.m_Select.strRange(wRange);
          const wExpanded = await this._expandRangeToMerges(wRangeStr);
          wParts.push(wExpanded);
        }
      } else if (!wHasColRow) {
        const wRange = await this.rangeSelect(this.m_Select.cursor());
        wParts.push(this.m_Select.strRange(wRange));
      }
      if ((this.m_SelectCol?.selections?.()?.length || 0) > 0) {
        wParts.push(this.m_SelectCol.str());
      }
      if ((this.m_SelectRow?.selections?.()?.length || 0) > 0) {
        wParts.push(this.m_SelectRow.str());
      }
      return wParts.join(";");
    }

    async applyBorder(sCde,sColor,sStyle,sSize) {
        this.setExtraUndo();
        // Expand selection to cover any merged ranges so border-right /
        // border-bottom land on the cells outside the merge (adjacency
        // model), not on invisible cells inside the merge.
        const wSelection = await this.selectStrMerged();
        // Not delete border 
        if (sCde!==0) {
          window.SkUISpreadSheet.border(wSelection,sCde,sColor+" "+sStyle+" "+sSize+";");
        } else {
          window.SkUISpreadSheet.border(wSelection,1,"");
        }
        this.reloadView();
    }

    async setPrecision(sPrecision) {
      this.setExtraUndo();
      // Sheet ="" for Active Sheet
      window.SkUISpreadSheet.precision(this.selectstr(),sPrecision,"");
     
      this.reloadView();
    }

    /** Create a RangeData table on the current selection (header + data rows). */
    async createTableFromSelection() {
      return createTableFromSelection(this);
    }

    /** Reload RangeData table metadata for autofilter header buttons. */
    async refreshTableFilterTables() {
      if (this.m_SpreadsheetDisposed || window.SkUISpreadSheet == null) {
        this.m_TableFilterTables = [];
        return;
      }
      try {
        const wRaw = window.SkUISpreadSheet.jsonRangeData();
        const wParsed =
          typeof wRaw === "string" && wRaw.length > 0
            ? JSON.parse(wRaw)
            : wRaw;
        const wSheet =
          this.m_UIView?.sheet || (await this.getActiveSheet()) || "";
        this.m_TableFilterTables = parseSheetTables(wParsed, wSheet).map((t) =>
          enrichTableFromSheetHeaders(t, this)
        );
      } catch (err) {
        console.warn("refreshTableFilterTables:", err);
        this.m_TableFilterTables = [];
      }
    }

    /**
     * Header cell rect for filter buttons using sheet-absolute Y (safe when filtered rows collapse).
     */
    _getFilterHeaderCellRectSync(sUI, sRow, sCol, xOff, yOff) {
      if (sUI == null) {
        return null;
      }
      const wRow = Number(sRow) || 1;
      const wCol = Number(sCol) || 1;
      const wInView = this._getCellRectInViewport(sUI, wRow, wCol, xOff, yOff);
      if (wInView != null) {
        return wInView;
      }
      const wSheet = sUI.sheet || this.m_UIView?.sheet || "";
      const wAnchor = this._anchorSheetPxSync(wRow, wCol, wSheet);
      if (wAnchor == null) {
        return null;
      }
      const wPane = this._sheetAnchorToPaneOrigin(
        sUI,
        wAnchor.anchorX,
        wAnchor.anchorY,
        xOff,
        yOff,
      );
      let wLeft = wPane.left;
      let wTop = wPane.top;
      let wWidth = 0;
      let wHeight = 0;
      const wCell = this._getCellFromUi(sUI, wRow, wCol);
      const wLayout = this._cellLayoutFromUi(sUI, wRow, wCol);
      if (wCell != null) {
        if (wCell.hasOwnProperty("c_w")) {
          const cw = Number(wCell.c_w);
          if (Number.isFinite(cw) && cw > 0) wWidth = cw;
        }
        if (wCell.hasOwnProperty("c_h")) {
          const ch = Number(wCell.c_h);
          if (Number.isFinite(ch) && ch > 0) wHeight = ch;
        }
      }
      if (wWidth <= 0 && wLayout != null) wWidth = wLayout.width;
      if (wHeight <= 0 && wLayout != null) wHeight = wLayout.height;
      if (wWidth <= 0 || wHeight <= 0) {
        return null;
      }
      return this._applyPaneClipToRect(
        { Left: wLeft, Top: wTop, Width: wWidth, Height: wHeight },
        xOff,
        yOff
      );
    }

    /**
     * Map grid layout coordinates (same space as SkSpGridCanvas.getCanvasCoordinates)
     * to viewport client pixels for fixed UI portaled outside the CSS-scaled grid.
     */
    _gridLayoutPointToClientPx(sGridX, sGridY, sCanvasEl = null) {
      const wCanvas = sCanvasEl || this.m_SkSpGridCanvas?.m_Ref?.current;
      const wGridX = Number(sGridX) || 0;
      const wGridY = Number(sGridY) || 0;
      if (!wCanvas) {
        return { x: wGridX, y: wGridY };
      }
      const wBounds = wCanvas.getBoundingClientRect();
      const wScale = layoutToScreenScale(wCanvas);
      return {
        x: wBounds.left + (wGridX + this.gridTreeViewLeft()) * wScale.x,
        y: wBounds.top + (wGridY + this.gridTreeViewTop()) * wScale.y,
      };
    }

    /** Returns table/column when (gridX, gridY) hits a header filter button. */
    async hitTestTableFilterButton(sGridX, sGridY) {
      const wTables = this.m_TableFilterTables || [];
      if (!wTables.length) return null;
      for (const wTable of wTables) {
        if (!isTableFilterEligible(wTable)) continue;
        for (const wCol of wTable.data.columns || []) {
          if (isFilterButtonHidden(wCol)) continue;
          const wRow = wTable.headerRow;
          const wSheetCol = sheetColFromColumn(wCol, wTable.range);
          const wVp = this._viewportAndOffsetsForSheetCell(wRow, wSheetCol);
          const wCellRect = this._getFilterHeaderCellRectSync(
            wVp.ui,
            wRow,
            wSheetCol,
            wVp.xOff,
            wVp.yOff
          );
          const wBtn = filterButtonRect(wCellRect);
          if (pointInRect(sGridX, sGridY, wBtn)) {
            return {
              table: wTable,
              column: wCol,
              row: wRow,
              col: wSheetCol,
              btnRect: wBtn,
              cellRect: wCellRect,
            };
          }
        }
      }
      return null;
    }

    /** Open sort/filter popup anchored under the filter button. */
    async openTableFilterPopup(sHit, sScreenX, sScreenY) {
      if (!sHit || this.m_SkSpGridCanvas == null) return;
      let wValues = [];
      const wRef = columnDataRef(
        sHit.table,
        columnOffset(sHit.column, sHit.table.range)
      );
      if (wRef && window.SkUISpreadSheet?.jsonFindUniqueValue) {
        try {
          const wRaw = window.SkUISpreadSheet.jsonFindUniqueValue(
            wRef,
            sHit.table.sheet,
            true
          );
          const wParsed =
            typeof wRaw === "string" && wRaw.length > 0
              ? JSON.parse(wRaw)
              : wRaw;
          wValues = normalizeFilterValues(
            Array.isArray(wParsed?.values) ? wParsed.values : []
          );
        } catch (err) {
          console.warn("jsonFindUniqueValue:", err);
        }
      }

      let wAnchorX = sScreenX;
      let wAnchorY = sScreenY;
      const wPopupW = 300;
      const wPopupH = 420;
      const wMargin = 8;
      const wCanvas = this.m_SkSpGridCanvas.m_Ref?.current;
      const wVp = this._viewportAndOffsetsForSheetCell(sHit.row, sHit.col);
      const wCellRect = this._getFilterHeaderCellRectSync(
        wVp.ui,
        sHit.row,
        sHit.col,
        wVp.xOff,
        wVp.yOff
      );
      let wAnchorHeight = 24;
      if (wCellRect && wCanvas) {
        const wScale = layoutToScreenScale(wCanvas);
        const wAnchorPt = this._gridLayoutPointToClientPx(
          wCellRect.Left,
          wCellRect.Top + wCellRect.Height + 2,
          wCanvas
        );
        wAnchorX = wAnchorPt.x;
        wAnchorY = wAnchorPt.y;
        wAnchorHeight = wCellRect.Height * wScale.y;
      }

      if (wAnchorX + wPopupW > window.innerWidth - wMargin) {
        wAnchorX = Math.max(wMargin, window.innerWidth - wPopupW - wMargin);
      }
      if (wAnchorX < wMargin) {
        wAnchorX = wMargin;
      }
      if (wAnchorY + wPopupH > window.innerHeight - wMargin) {
        wAnchorY = Math.max(
          wMargin,
          wAnchorY - wPopupH - wAnchorHeight - 4
        );
      }
      if (wAnchorY < wMargin) {
        wAnchorY = wMargin;
      }

      this.m_SkSpGridCanvas.setState({
        tableFilterPopup: {
          table: sHit.table,
          column: sHit.column,
          sheetCol: sHit.col,
          screenX: wAnchorX,
          screenY: wAnchorY,
          values: wValues,
        },
      });
    }

    closeTableFilterPopup() {
      if (this.m_SkSpGridCanvas != null) {
        this.m_SkSpGridCanvas.setState({ tableFilterPopup: null });
      }
    }

  }

  export default SkSpInterface;
