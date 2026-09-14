import React, { useCallback, useEffect, useState } from 'react';
import {
  getThemePreference,
  resolveTheme,
  setThemePreference,
} from '../SkTheme';

function readResolvedTheme() {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'light' || attr === 'dark') {
      return attr;
    }
  }
  return resolveTheme(getThemePreference());
}

/**
 * Top-bar flip control: toggles between light and dark theme (persists choice).
 */
export default function SkThemeFlipToggle({ className = '' }) {
  const [theme, setTheme] = useState(readResolvedTheme);
  const [flipping, setFlipping] = useState(false);

  useEffect(() => {
    const sync = () => setTheme(readResolvedTheme());
    window.addEventListener('sk-theme-change', sync);
    return () => window.removeEventListener('sk-theme-change', sync);
  }, []);

  const toggle = useCallback(() => {
    const current = readResolvedTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    setFlipping(true);
    setThemePreference(next);
    setTheme(next);
    window.setTimeout(() => setFlipping(false), 420);
  }, []);

  const isDark = theme === 'dark';
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      type="button"
      className={`SkThemeFlipToggle${className ? ` ${className}` : ''}${flipping ? ' SkThemeFlipToggle--flip' : ''}${
        isDark ? ' SkThemeFlipToggle--dark' : ' SkThemeFlipToggle--light'
      }`}
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      <span className="SkThemeFlipToggle-face" aria-hidden="true">
        {isDark ? (
          <svg className="SkThemeFlipToggle-icon" viewBox="0 0 24 24" focusable="false">
            <circle cx="12" cy="12" r="4.5" fill="currentColor" />
            <g stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <line x1="12" y1="2.5" x2="12" y2="5" />
              <line x1="12" y1="19" x2="12" y2="21.5" />
              <line x1="2.5" y1="12" x2="5" y2="12" />
              <line x1="19" y1="12" x2="21.5" y2="12" />
              <line x1="5.8" y1="5.8" x2="7.6" y2="7.6" />
              <line x1="16.4" y1="16.4" x2="18.2" y2="18.2" />
              <line x1="16.4" y1="7.6" x2="18.2" y2="5.8" />
              <line x1="5.8" y1="18.2" x2="7.6" y2="16.4" />
            </g>
          </svg>
        ) : (
          <svg className="SkThemeFlipToggle-icon" viewBox="0 0 24 24" focusable="false">
            <path
              fill="currentColor"
              d="M14.5 2.2a9.2 9.2 0 1 0 7.3 7.3 7.4 7.4 0 0 1-7.3-7.3Z"
            />
          </svg>
        )}
      </span>
    </button>
  );
}
