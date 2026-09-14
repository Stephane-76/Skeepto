import React from 'react';
import { Link } from 'react-router-dom';
import SkThemeFlipToggle from './component/SkThemeFlipToggle';
import SkAboutContent from './SkAboutContent';
import { ReactComponent as SkeeptoLogo } from './SkLogo.svg';

/**
 * Public marketing page — content from SkSpreadSheet_DESCRIPTION_COMMERCIALE.md
 */
function SkSpreadSheetAbout() {
  return (
    <div className="SkLogin-shell SkAbout-shell">
      <header className="SkLogin-brand">
        <div className="SkLogin-brandRow">
          <div className="SkLogin-brandIdentity">
            <SkeeptoLogo className="SkLogin-brandLogo" />
            <div className="SkLogin-brandText">
              <h1 className="SkLogin-brandTitle">Skeepto</h1>
              <p className="SkLogin-brandSubtitle">Embeddable spreadsheet engine</p>
            </div>
          </div>
          <SkThemeFlipToggle />
        </div>
      </header>

      <main className="SkAbout-main">
        <SkAboutContent />
      </main>

      <footer className="SkLogin-footer">
        <Link to="/login" className="SkLogin-footerLink">
          Sign in
        </Link>
        {' · '}
        Copyright Stéphane ALLEZ 2026 licence MIT
      </footer>
    </div>
  );
}

export default SkSpreadSheetAbout;
