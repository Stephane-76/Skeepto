import './App.css';
import React from 'react';
import { useLocation } from 'react-router-dom';
import SkWebInterface from './SkWebInterface.js';
import SkLogin from './SkLogin.js';
import SkSpreadSheetAbout from './SkSpreadSheetAbout.js';
import { getMenuItems } from './SkAppMenu.js';
import MainLayout from './SkMainLayout.js';
import { GuidedTour } from './tour';
import { SK_ACTIVE_FILE_EVENT, getSpreadsheetSession } from './SkActiveFile.js';
import SkDialogHost from './component/SkDialogHost.js';
import SkLoadingSpinner from './component/SkLoadingSpinner.js';
import { isDesktop } from './desktop/SkDesktopMode.js';
import { initDesktopBridge, seedInitialWorkbookSession } from './desktop/SkDesktopBridge.js';
import {
  performAppLogout,
  startIdleSessionMonitor,
  stopIdleSessionMonitor,
} from './SkSessionLifecycle.js';

// Wait for SkSpreadSheet WASM bootstrap (timeout was previously unused and could hang forever).
function waitForSkSpreadSheet(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (window.SpreadSheet) {
        resolve(window.SpreadSheet);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('Timeout waiting for SpreadSheet WASM'));
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

// Injects current location into render prop (SPA /login is wired in index.js via __skerNavigateLogin).
const LocationWrapper = ({ children }) => {
  const location = useLocation();
  return children(location);
};

/**
 * App - Main application component
 * Manages authentication state, routing, and layout
 */
class App extends React.Component {
  constructor(props) {
    super(props);

    // Desktop: seed an untitled workbook session so /spreadsheet resolves on
    // the very first render (before componentDidMount wires the bridge).
    seedInitialWorkbookSession();

    // Desktop (Electron) build has no server auth: always treat as logged in.
    const hasSession =
      isDesktop ||
      (typeof sessionStorage !== 'undefined' &&
        !!sessionStorage.getItem('jwt') &&
        !!sessionStorage.getItem('user'));

    this.state = {
      leftPanelWidth: 48,
      user: isDesktop ? 'desktop' : hasSession ? sessionStorage.getItem('user') : 'logout',
      showLogin: !hasSession,
      isLoggedIn: hasSession,
      panelleft: false,
      currentPath: '/',
      formatMenuTick: 0,
      viewMenuTick: 0,
      workspaceSessionTick: 0,
      busyText: null,
      busyProgress: null,
    };
    
    // Create the WebInterface
    window.WebInterface = new SkWebInterface();
    // Set callback for authentication errors to redirect to login
    // UI state only; performAppLogout() releases locks before clearing JWT.
    window.WebInterface.setOnAuthError(() => {
      this.setState({
        isLoggedIn: false,
        showLogin: true,
        user: 'logout',
        panelleft: false,
      });
    });

    window.__skerPerformAppLogout = (options) => this.handleLogout(options);

    // Refs for panel resizing
    this.startX = React.createRef();
    this.startWidth = React.createRef();
    this.leftPanel = React.createRef();
    this.resizeHandle = React.createRef();
    this.isResizing = false;
  }

  menuRequiresSpreadsheet = (id) => {
    if (typeof id === 'string' && id.startsWith('unit:')) {
      return true;
    }
    if (typeof id === 'string' && id.startsWith('format:apply:')) {
      return true;
    }
    if (typeof id === 'string' && id.startsWith('view-zoom-')) {
      return true;
    }
    const spreadsheetMenuActions = new Set([
      'new', 'browse', 'recent', 'exit',
      'undo', 'redo', 'cut', 'copy', 'paste', 'clear', 'find-text', 'replace',
      'insert-row', 'insert-column', 'insert-sheet', 'show-function',
      'format-bold', 'format-italic', 'format-underline', 'format-strikethrough',
      'format-font', 'format-borders', 'format-conditional', 'format-clear', 'format-print',
      'view-split-cursor-row', 'view-split-cursor-col', 'view-no-split', 'view-grid-lines',
      'data-sort', 'data-filter', 'data-validation',
      'sheet-create-table', 'sheet-tables', 'recalculate-all',
      'named-ranges', 'named-formulas',
      'tools-class', 'tools-function', 'tools-attribute', 'tools-unit',
      'tools-chat', 'tools-ai-assistant', 'tools-debug',
      'help-shortcuts', 'help-about'
    ]);
    return spreadsheetMenuActions.has(id);
  };
  
  // Block browser page zoom (Chrome: Ctrl/Cmd + wheel; Safari: pinch gestures).
  handleBlockBrowserZoomWheel = (event) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
    }
  };

  handleBlockBrowserZoomGesture = (event) => {
    event.preventDefault();
  };

  componentDidMount() {
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
    document.addEventListener('wheel', this.handleBlockBrowserZoomWheel, { passive: false });
    document.addEventListener('gesturestart', this.handleBlockBrowserZoomGesture, { passive: false });
    document.addEventListener('gesturechange', this.handleBlockBrowserZoomGesture, { passive: false });
    document.addEventListener('gestureend', this.handleBlockBrowserZoomGesture, { passive: false });
    this.handleFormatMenuReady = () => {
      this.setState((state) => ({ formatMenuTick: (state.formatMenuTick || 0) + 1 }));
    };
    this.handleViewMenuRefresh = () => {
      this.setState((state) => ({ viewMenuTick: (state.viewMenuTick || 0) + 1 }));
    };
    window.addEventListener('skFormatMenuReady', this.handleFormatMenuReady);
    window.addEventListener('skViewMenuRefresh', this.handleViewMenuRefresh);
    this.handleWorkspaceSessionChange = () => {
      this.setState((state) => ({
        workspaceSessionTick: (state.workspaceSessionTick || 0) + 1,
      }));
    };
    window.addEventListener(SK_ACTIVE_FILE_EVENT, this.handleWorkspaceSessionChange);

    // Global blocking spinner (used e.g. by the desktop Excel import/export,
    // which runs off-UI from the native menu). Pass a label to show, or a
    // falsy value to hide. progress is a 0–100 number for a determinate bar,
    // or null/undefined for an indeterminate spinner.
    window.__skerSetBusy = (text, progress) => {
      const wPct =
        typeof progress === 'number' && Number.isFinite(progress)
          ? Math.max(0, Math.min(100, progress))
          : null;
      this.setState({ busyText: text ? String(text) : null, busyProgress: wPct });
    };

    if (isDesktop) {
      // No login, no server session, no idle monitor: go straight to the sheet.
      this.setState({
        isLoggedIn: true,
        showLogin: false,
        user: 'desktop',
        panelleft: false,
      });
      initDesktopBridge();
    } else {
      const wUser = sessionStorage.getItem('user');
      const wJwt = sessionStorage.getItem('jwt');
      if (wUser && wJwt) {
        this.setState({
          isLoggedIn: true,
          showLogin: false,
          user: wUser,
          panelleft: true,
        });
        const path = window.location.pathname;
        if (path === '/' || path === '/login') {
          if (typeof window.__skerNavigate === 'function') {
            window.__skerNavigate('/virtualdisk', { replace: true });
          }
        }
        this.startSessionIdleMonitor();
      } else {
        this.setState({
          isLoggedIn: false,
          showLogin: true,
          user: 'logout',
        });
        if (typeof window.__skerNavigateLogin === 'function') {
          window.__skerNavigateLogin();
        }
      }
    }
    
    // Load WebAssembly module if not already loaded
    if (window.SkCreateModule && !window.SpreadSheet) {
      console.log("Loading WebAssembly module from componentDidMount...");
      window.SkCreateModule();
    }
  }

  componentDidUpdate(prevProps, prevState) {
    // Update current path when location changes
    // This is handled by LocationWrapper, so we track it here if needed
  }

  startSessionIdleMonitor = () => {
    stopIdleSessionMonitor();
    if (!sessionStorage.getItem('jwt')) {
      return;
    }
    this._stopIdleMonitor = startIdleSessionMonitor({
      onLogout: () => this.finishLogoutUi(),
    });
  };

  finishLogoutUi = () => {
    this.setState({
      isLoggedIn: false,
      showLogin: true,
      user: 'logout',
      currentPath: '/',
      panelleft: false,
    });
    if (typeof window.__skerNavigateLogin === 'function') {
      window.__skerNavigateLogin();
    }
  };

  handleLogout = async (options = {}) => {
    const reason = options?.reason || 'manual';
    await performAppLogout({
      reason,
      onComplete: () => this.finishLogoutUi(),
    });
  };

  componentWillUnmount() {
    delete window.__skerPerformAppLogout;
    delete window.__skerSetBusy;
    stopIdleSessionMonitor();
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);
    document.removeEventListener('wheel', this.handleBlockBrowserZoomWheel, { passive: false });
    document.removeEventListener('gesturestart', this.handleBlockBrowserZoomGesture, { passive: false });
    document.removeEventListener('gesturechange', this.handleBlockBrowserZoomGesture, { passive: false });
    document.removeEventListener('gestureend', this.handleBlockBrowserZoomGesture, { passive: false });
    if (this.handleFormatMenuReady) {
      window.removeEventListener('skFormatMenuReady', this.handleFormatMenuReady);
    }
    if (this.handleViewMenuRefresh) {
      window.removeEventListener('skViewMenuRefresh', this.handleViewMenuRefresh);
    }
    if (this.handleWorkspaceSessionChange) {
      window.removeEventListener(SK_ACTIVE_FILE_EVENT, this.handleWorkspaceSessionChange);
    }
  }

  // Handle panel resizing
  handleMouseDown = (e) => {
    this.isResizing = true;
    this.startX.current = e.clientX;
    this.startWidth.current = this.leftPanel.current.offsetWidth;
    
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  };

  handleMouseMove = (e) => {
    if (!this.isResizing) return;
    
    const diff = e.clientX - this.startX.current;
    const newWidth = Math.max(0, Math.min(500, this.startWidth.current + diff));
    
    // Direct DOM update for better performance during drag
    this.leftPanel.current.style.width = `${newWidth}px`;
    this.resizeHandle.current.style.left = `${newWidth}px`;
  };

  handleMouseUp = () => {
    if (!this.isResizing) return;
    
    this.isResizing = false;
    
    // Update state with new width
    this.setState({ 
      leftPanelWidth: this.leftPanel.current.offsetWidth 
    });
    
    // Reset cursor styles
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  // Handle login
  handleLoginSuccess = async () => {
    this.setState({
      showLogin: false,
      isLoggedIn: true,
      currentPath: '/',
      user: sessionStorage.getItem('user'),
      // Open the left navigation panel by default after login.
      panelleft: true,
    });
    this.startSessionIdleMonitor();

    try {
      await waitForSkSpreadSheet();
    } catch (e) {
      console.warn('SpreadSheet WASM not ready after login:', e);
    }

    // Queued .sker from Virtual Disk: routes were hidden while login was shown, so open spreadsheet after commit.
    const pendingSpreadsheet = getSpreadsheetSession();
    if (pendingSpreadsheet && typeof window.__skerNavigate === 'function') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.__skerNavigate('/spreadsheet', { replace: true });
        });
      });
      return;
    }

    const pendingDocument = sessionStorage.getItem('SkTextDocumentFile');
    if (pendingDocument && typeof window.__skerNavigate === 'function') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.__skerNavigate('/texteditor', { replace: true });
        });
      });
      return;
    }

    // Default landing page after login: Virtual Disk.
    if (typeof window.__skerNavigate === 'function') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.__skerNavigate('/virtualdisk', { replace: true });
        });
      });
    }
  };

  // Handle menu actions
  handleMenuAction = (id) => {
    //console.log('Menu action:', id);

    const isSpreadsheetAction = this.menuRequiresSpreadsheet(id);

    // If an action belongs to spreadsheet context, switch route first.
    if (isSpreadsheetAction && this.state.currentPath !== '/spreadsheet') {
      sessionStorage.setItem('SkPendingMenuAction', id);
      if (typeof window.__skerNavigate === 'function') {
        window.__skerNavigate('/spreadsheet');
      }
      return;
    }

    if (id === 'login') {
      this.setState({ 
        user: sessionStorage.getItem('user'),
        showLogin: true,
        currentPath: '/'
      });
      return;
    }

    if (id === 'virtualdisk') {
      if (typeof window.__skerNavigate === 'function') {
        window.__skerNavigate('/virtualdisk');
      }
      return;
    }

    if (id === 'debug-format-server') {
      void (async () => {
        const { debugFormatOnServer } = await import('./spreadsheet/SkDebugFormatServer.js');
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
            : `[Debug FormatApi] still has ${wResult.totalCount} format(s) across ${wResult.instances?.length || 0} instance(s)`
        );
        if (!wResult.empty) {
          const wBooks = Array.isArray(wResult.workbooks) ? wResult.workbooks : [];
          const wPending = Array.isArray(wResult.pendingUnloads) ? wResult.pendingUnloads : [];
          if (wBooks.length > 0) {
            console.log(
              `[Debug FormatApi] ${wBooks.length} workbook(s) still in server memory:`,
              wBooks.map((b) => b.path)
            );
          } else {
            console.warn(
              '[Debug FormatApi] count>0 but no workbook mapped — possible format leak (or unload race)'
            );
          }
          if (wPending.length > 0) {
            const wGrace = Number(wResult.unloadGraceMs) || 45000;
            console.log(
              `[Debug FormatApi] unload pending for ${wPending.length} workbook(s) (grace ${Math.round(wGrace / 1000)}s):`,
              wPending
            );
          }
        }
      })();
      return;
    }

    // If spreadsheet is already active, dispatch immediately.
    if (isSpreadsheetAction && typeof window.__skerHandleSpreadsheetMenuAction === 'function') {
      window.__skerHandleSpreadsheetMenuAction(id);
      return;
    }

    // Fallback: persist action for spreadsheet components to consume.
    if (isSpreadsheetAction) {
      sessionStorage.setItem('SkPendingMenuAction', id);
    }
  };

  // Fit left panel width to its content once when the panel opens.
  handleLeftPanelFitWidth = (measuredWidth) => {
    const width = Math.max(48, Math.min(500, Math.ceil(measuredWidth)));
    this.setState({ leftPanelWidth: width });
    if (this.leftPanel.current) {
      this.leftPanel.current.style.width = `${width}px`;
    }
    if (this.resizeHandle.current) {
      this.resizeHandle.current.style.left = `${width}px`;
    }
  };

  // Toggle left panel visibility
  toggleLeftPanel = () => {
    if (!this.state.isLoggedIn) return;
    this.setState({ panelleft: !this.state.panelleft });
  };

  // Force-open the left panel (used by the guided tour so its targets exist).
  openLeftPanel = () => {
    if (!this.state.isLoggedIn) return;
    if (!this.state.panelleft) {
      this.setState({ panelleft: true });
    }
  };

  render() {
    const { leftPanelWidth, showLogin, isLoggedIn, currentPath, panelleft, user } = this.state;

    return (
      <LocationWrapper>
        {(location) => {
          // Show login screen only (no layout) when on /login route or when showLogin is true
          const isLoginRoute = location.pathname === '/login';
          const isAboutRoute = location.pathname === '/about';
          // Always show login only when on /login route, or when showLogin is true (regardless of login status)
          const shouldShowLoginOnly = isLoginRoute || showLogin;
          
          // Update current path and showLogin state if needed
          if (location.pathname !== currentPath) {
            // Schedule state update after render
            requestAnimationFrame(() => {
              const newState = { currentPath: location.pathname };
              // If navigating to /login, also set showLogin to true
              if (location.pathname === '/login') {
                newState.showLogin = true;
              }
              this.setState(newState);
            });
          }
          
          if (isAboutRoute) {
            return <SkSpreadSheetAbout />;
          }

          if (shouldShowLoginOnly) {
            return (
              <SkLogin
                show={true}
                onLoginSuccess={this.handleLoginSuccess}
              />
            );
          }
          
          const menuItems = getMenuItems(
            location.pathname,
            this.handleMenuAction,
            this.state.formatMenuTick,
            this.state.viewMenuTick,
            this.state.workspaceSessionTick
          );
          
          // Show main layout with all panels
          return (
            <>
              <MainLayout
                menuItems={menuItems}
                onMenuAction={this.handleMenuAction}
                isLoggedIn={isLoggedIn}
                user={user}
                panelLeft={panelleft}
                leftPanelWidth={leftPanelWidth}
                showLogin={showLogin}
                currentPath={location.pathname}
                onToggleLeftPanel={this.toggleLeftPanel}
                onLogout={this.handleLogout}
                onLoginSuccess={this.handleLoginSuccess}
                onResizeStart={this.handleMouseDown}
                onFitWidth={this.handleLeftPanelFitWidth}
                panelRef={this.leftPanel}
                resizeHandleRef={this.resizeHandle}
              />
              <GuidedTour
                enabled={isLoggedIn}
                autoStart={false}
                onBeforeStart={this.openLeftPanel}
              />
              <SkDialogHost />
              {this.state.busyText ? (
                <div className="SkGlobalBusyOverlay">
                  <SkLoadingSpinner
                    size="large"
                    text={this.state.busyText}
                    showProgress={this.state.busyProgress != null}
                    progress={this.state.busyProgress || 0}
                  />
                </div>
              ) : null}
            </>
          );
        }}
      </LocationWrapper>
    );
  }
}
 
export default App;
