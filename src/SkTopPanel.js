import React from 'react';
import { SkMenu } from './component/SkMenu.js';
import SkThemeFlipToggle from './component/SkThemeFlipToggle.js';
import {
  getActiveFilePath,
  subscribe,
  hydrateActiveFileFromSession,
  SK_ACTIVE_FILE_EVENT,
} from './SkActiveFile.js';
import { isDesktop } from './desktop/SkDesktopMode.js';

/**
 * TopPanel - Top navigation bar component
 * Displays menu, active file path, and user info
 */
export class TopPanel extends React.Component {
  constructor(props) {
    super(props);
    this.state = { activeFilePath: getActiveFilePath() };
  }

  componentDidMount() {
    hydrateActiveFileFromSession();
    this.setState({ activeFilePath: getActiveFilePath() });
    this._unsubscribe = subscribe(({ path }) => {
      this.setState({ activeFilePath: path });
    });
    this._onActiveFileEvent = (event) => {
      const path = event?.detail?.path ?? '';
      this.setState({ activeFilePath: path });
    };
    window.addEventListener(SK_ACTIVE_FILE_EVENT, this._onActiveFileEvent);
  }

  componentWillUnmount() {
    if (this._unsubscribe) this._unsubscribe();
    window.removeEventListener(SK_ACTIVE_FILE_EVENT, this._onActiveFileEvent);
  }

  render() {
    const { menuItems, onMenuAction, isLoggedIn, user, onToggleLeftPanel, panelLeft, onLogout } = this.props;
    const { activeFilePath } = this.state;
    const pathLabel = activeFilePath || 'No item selected';

    // Desktop (Electron) uses the native menu bar and moves the light/dark
    // theme toggle into the spreadsheet command toolbar (SkSpTopCommand), so
    // the whole top bar is hidden there.
    if (isDesktop) {
      return null;
    }

    return (
      <div className="top-panel">
        <div className="top-left-panel">
          <div className="top-left-toolbar">
            {isLoggedIn && (
              <button
                type="button"
                className="toggle-panel-btn"
                onClick={onToggleLeftPanel}
                title={panelLeft ? 'Hide menu' : 'Show menu'}
                style={{ flexShrink: 0 }}
                data-tour="toggle-menu"
              >
                {panelLeft ? '◀' : '▶'}
              </button>
            )}
            <div data-tour="top-menu" className="top-menu-wrap">
              <SkMenu items={menuItems} onAction={onMenuAction} />
            </div>
          </div>
          {isLoggedIn && (
            <h3
              className="top-active-file-title"
              title={pathLabel}
              data-tour="active-file-path"
            >
              {pathLabel}
            </h3>
          )}
        </div>
        <div className="top-right-panel">
          <div data-tour="user-info" className="top-user-info">
            {/* Desktop (Electron) has no login/session, so hide the user name. */}
            {!isDesktop && (
              <div className="top-user-name">{isLoggedIn ? user : 'Logout'}</div>
            )}
            {isLoggedIn && (
              <div className="top-user-actions">
                {/* No logout in desktop mode: there is no session to end. */}
                {!isDesktop && (
                  <button
                    type="button"
                    className="top-logout-btn"
                    onClick={onLogout}
                    title="Logout"
                  >
                    Logout
                  </button>
                )}
                <SkThemeFlipToggle className="SkThemeFlipToggle--compact" />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
}

export default TopPanel;
