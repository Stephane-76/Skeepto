import React from 'react';
import { getSpreadsheetSession, isActiveSpreadsheetReadOnly } from '../SkActiveFile.js';
import './SkReadOnlyBanner.css';

/**
 * Prominent banner when the open .sker workbook has no write permission.
 */
export default function SkReadOnlyBanner({ className = '' }) {
  if (!isActiveSpreadsheetReadOnly()) {
    return null;
  }

  const session = getSpreadsheetSession();
  const fileLabel = session?.name || session?.path || '';

  return (
    <div
      className={`sk-readonly-banner ${className}`.trim()}
      role="status"
      aria-live="polite"
      data-testid="sk-readonly-banner"
    >
      <div className="sk-readonly-banner__chip">
        <span className="sk-readonly-banner__lock" aria-hidden="true">
          &#128274;
        </span>
        <span className="sk-readonly-banner__title">Lecture seule</span>
        {fileLabel ? (
          <>
            <span className="sk-readonly-banner__sep" aria-hidden="true">
              ·
            </span>
            <span className="sk-readonly-banner__file" title={session?.path}>
              {fileLabel}
            </span>
          </>
        ) : null}
        <span className="sk-readonly-banner__sep" aria-hidden="true">
          ·
        </span>
        <span className="sk-readonly-banner__hint">Modifications non enregistrées</span>
      </div>
    </div>
  );
}
