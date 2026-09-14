import React from 'react';
import { Link } from 'react-router-dom';
import SkButton from './component/SkButton.js';
import {
  SK_ACTIVE_FILE_EVENT,
  readWorkspaceSessionFlags,
} from './SkActiveFile.js';
import { isCurrentUserAdmin } from './virtualDiskHomePath.js';
import { ReactComponent as SvgTreeView } from './svg/tree-view48.svg';
import { ReactComponent as SvgSpreadsheet } from './svg/spreadsheet48.svg';
import { ReactComponent as SvgUser } from './svg/user48.svg';
import { ReactComponent as SvgGroup } from './svg/group48.svg';
import { ReactComponent as SvgLogin } from './svg/login48.svg';
import { ReactComponent as SvgHelp } from './svg/question-circle.svg';
import { ReactComponent as SvgPoolStats } from './svg/database.svg';
import { ReactComponent as SvgHtmlEditor } from './svg/html-editor48.svg';

const LEFT_PANEL_ICON_SIZE = 32;

const navLinkStyle = {
  textDecoration: 'none',
  color: 'inherit',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

function renderNavIcon(icon) {
  return (
    <svg
      width={LEFT_PANEL_ICON_SIZE}
      height={LEFT_PANEL_ICON_SIZE}
      aria-hidden="true"
    >
      {icon}
    </svg>
  );
}

/**
 * LeftPanel - Side navigation panel component
 * Displays navigation links when panel is open
 */
export class LeftPanel extends React.Component {
  constructor(props) {
    super(props);
    this.state = readWorkspaceSessionFlags();
  }

  componentDidMount() {
    this.syncWorkspaceSessions = () => {
      this.setState(readWorkspaceSessionFlags());
    };
    window.addEventListener(SK_ACTIVE_FILE_EVENT, this.syncWorkspaceSessions);
    this.syncWorkspaceSessions();
    this.scheduleFitWidthToContent();
  }

  scheduleFitWidthToContent() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.fitWidthToContent();
      });
    });
  }

  fitWidthToContent() {
    const { panelRef, onFitWidth } = this.props;
    const panel = panelRef?.current;
    if (!panel || typeof onFitWidth !== 'function') {
      return;
    }

    const previousWidth = panel.style.width;
    panel.style.width = 'max-content';
    const measured = Math.ceil(panel.getBoundingClientRect().width);
    panel.style.width = previousWidth;
    onFitWidth(measured);
  }

  componentWillUnmount() {
    window.removeEventListener(SK_ACTIVE_FILE_EVENT, this.syncWorkspaceSessions);
  }

  renderNavEntry({
    tour,
    to,
    disabled,
    disabledTitle,
    icon,
    label,
  }) {
    const hint = disabled ? disabledTitle : label;

    return (
      <div data-tour={tour}>
        <SkButton
          disabled={disabled}
          title={hint}
        >
          {disabled ? (
            <span
              style={{
                ...navLinkStyle,
                opacity: 0.45,
                cursor: 'not-allowed',
              }}
              title={hint}
              aria-label={label}
            >
              {renderNavIcon(icon)}
            </span>
          ) : (
            <Link
              style={navLinkStyle}
              to={to}
              title={label}
              aria-label={label}
            >
              {renderNavIcon(icon)}
            </Link>
          )}
        </SkButton>
      </div>
    );
  }

  render() {
    const { isLoggedIn, onToggle, width, onLogout } = this.props;
    const panelRef = this.props.panelRef;
    const resizeHandleRef = this.props.resizeHandleRef;
    const onMouseDown = this.props.onResizeStart;
    const { spreadsheetLoaded, textDocumentLoaded } = this.state;
    const isAdmin = isCurrentUserAdmin();

    if (!isLoggedIn) return null;

    return (
      <>
        <div 
          ref={panelRef}
          className="left-panel" 
          style={{ width: `${width}px` }}
        >
          <div className="left-panel-menu-header">
            <span className="left-panel-menu-title">
              Menu
            </span>
            <button
              type="button"
              className="SkPanelCloseBtn"
              onClick={onToggle}
              title="Hide menu"
              aria-label="Hide menu"
            >
              ×
            </button>
          </div>
          <nav className="left-panel-nav">
            <div className="SkFlex SkFlexColumn">
              {this.renderNavEntry({
                tour: 'virtualdisk',
                to: '/virtualdisk',
                icon: <SvgTreeView />,
                label: 'Virtual disk',
              })}
              {this.renderNavEntry({
                tour: 'spreadsheet',
                to: '/spreadsheet',
                disabled: !spreadsheetLoaded,
                disabledTitle: 'Open a .sker file from Virtual disk first',
                icon: <SvgSpreadsheet />,
                label: 'Spreadsheet',
              })}
              {this.renderNavEntry({
                tour: 'texteditor',
                to: '/texteditor',
                disabled: !textDocumentLoaded,
                disabledTitle: 'Open a .html file from Virtual disk first',
                icon: <SvgHtmlEditor />,
                label: 'HTML editor',
              })}
              {isAdmin && this.renderNavEntry({
                tour: 'user',
                to: '/user',
                icon: <SvgUser />,
                label: 'User',
              })}
              {isAdmin && this.renderNavEntry({
                tour: 'group',
                to: '/group',
                icon: <SvgGroup />,
                label: 'Group',
              })}
              {isAdmin && this.renderNavEntry({
                tour: 'poolstats',
                to: '/poolstats',
                icon: <SvgPoolStats />,
                label: 'Pool stats',
              })}
              <div data-tour="guided-tour">
                <SkButton
                  onClick={() => {
                    if (typeof window.__skerStartTour === 'function') {
                      window.__skerStartTour();
                    }
                  }}
                  title="Guided tour"
                >
                  <span style={navLinkStyle} aria-label="Guided tour">
                    {renderNavIcon(<SvgHelp />)}
                  </span>
                </SkButton>
              </div>

              <SkButton
                onClick={() => {
                  if (typeof onLogout === 'function') {
                    void onLogout();
                  }
                }}
                title="Logout"
              >
                <span style={navLinkStyle} aria-label="Logout">
                  {renderNavIcon(<SvgLogin />)}
                </span>
              </SkButton>
            </div>
          </nav>
        </div>
        <div 
          ref={resizeHandleRef}
          className="resize-handle"
          onMouseDown={onMouseDown}
          style={{ left: `${width}px` }}
        />
      </>
    );
  }
}

export default LeftPanel;
