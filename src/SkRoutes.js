import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import SkSpreadSheet from './spreadsheet/SkSpreadSheet.js';
import SkVirtualDisk from './SkVirtualdisk.js';
import SkUser from './SkUser.js';
import SkUserGrid from './SkUserGrid.js';
import SkGroup from './SkGroup.js';
import SkGroupGrid from './SkGroupGrid.js';
import SkRelationship from './SkRelationship.js';
import SkRelationshipType from './SkRelationshipType.js';
import SkTestGrid from './SkTestGrid.js';
import SkPoolStats from './SkPoolStats.js';
import SkLogin from './SkLogin.js';
import SkTextEditor from './SkTextEditor.js';
import {
  getSpreadsheetSession,
  getTextDocumentSession,
} from './SkActiveFile.js';
import { isDesktop } from './desktop/SkDesktopMode.js';

function RequireSpreadsheetSession({ children }) {
  const session = getSpreadsheetSession();
  if (!session?.path) {
    return <Navigate to="/virtualdisk" replace />;
  }
  return children;
}

function RequireTextDocumentSession({ children }) {
  const session = getTextDocumentSession();
  if (!session?.path) {
    return <Navigate to="/virtualdisk" replace />;
  }
  return children;
}

/**
 * ApplicationRoutes - Configured routes for the application
 * Note: /login route is handled in App.js to show login without layout
 */
export const AppRoutes = ({ isLoggedIn, showLogin, onLoginSuccess }) => {
  // If user is not logged in and showLogin is true, show login screen
  // (This should not happen as App.js handles this case, but keeping as fallback)
  if (!isLoggedIn && showLogin) {
    return (
      <SkLogin 
        show={showLogin}
        onLoginSuccess={onLoginSuccess}
      />
    );
  }

  // Main application routes (only when logged in)
  // /login is NOT here because it's handled in App.js to show without TopPanel
  return (
    <Routes>
      <Route
        path="/"
        element={<Navigate to={isDesktop ? '/spreadsheet' : '/virtualdisk'} replace />}
      />
      <Route path="/virtualdisk" element={<SkVirtualDisk />} />
      <Route
        path="/spreadsheet"
        element={(
          <RequireSpreadsheetSession>
            <SkSpreadSheet className="SkSpreadSheet" />
          </RequireSpreadsheetSession>
        )}
      />
      <Route
        path="/texteditor"
        element={(
          <RequireTextDocumentSession>
            <SkTextEditor />
          </RequireTextDocumentSession>
        )}
      />
      <Route path="/user" element={<SkUser />} />
      <Route path="/usergrid" element={<SkUserGrid />} />
      <Route path="/group" element={<SkGroup />} />
      <Route path="/groupgrid" element={<SkGroupGrid />} />
      <Route path="/relationship" element={<SkRelationship />} />
      <Route path="/relationshiptype" element={<SkRelationshipType />} />
      <Route path="/testgrid" element={<SkTestGrid />} />
      <Route path="/poolstats" element={<SkPoolStats />} />
    </Routes>
  );
};

export default AppRoutes;

