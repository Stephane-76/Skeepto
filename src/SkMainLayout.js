import React from 'react';
import TopPanel from './SkTopPanel.js';
import LeftPanel from './SkLeftPanel.js';
import { AppRoutes } from './SkRoutes.js';

/**
 * MainLayout - Main application layout component
 * Handles the overall structure: top panel, left panel, and content area
 */
export class MainLayout extends React.Component {
  render() {
    const {
      menuItems,
      onMenuAction,
      isLoggedIn,
      user,
      panelLeft,
      leftPanelWidth,
      showLogin,
      currentPath,
      onToggleLeftPanel,
      onLogout,
      onLoginSuccess,
      onResizeStart,
      onFitWidth,
      panelRef,
      resizeHandleRef,
    } = this.props;

    return (
      <div className="app-container">
        <TopPanel
          menuItems={menuItems}
          onMenuAction={onMenuAction}
          isLoggedIn={isLoggedIn}
          user={user}
          panelLeft={panelLeft}
          currentPath={currentPath}
          onToggleLeftPanel={onToggleLeftPanel}
          onLogout={onLogout}
        />
        <div className="main-content">
          {panelLeft && (
            <LeftPanel
              isLoggedIn={isLoggedIn}
              onToggle={onToggleLeftPanel}
              onLogout={onLogout}
              width={leftPanelWidth}
              panelRef={panelRef}
              resizeHandleRef={resizeHandleRef}
              onResizeStart={onResizeStart}
              onFitWidth={onFitWidth}
            />
          )}
          <div className="content-area">
            <AppRoutes
              isLoggedIn={isLoggedIn}
              showLogin={showLogin}
              onLoginSuccess={onLoginSuccess}
            />
          </div>
        </div>
      </div>
    );
  }
}

export default MainLayout;

