const STORAGE_KEY = 'sk-theme-preference';

/** @typedef {'light' | 'dark' | 'system'} ThemePreference */
/** @typedef {'light' | 'dark'} ResolvedTheme */

/**
 * Read stored theme preference (defaults to system).
 * @returns {ThemePreference}
 */
export function getThemePreference() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch (e) {
    /* localStorage may be unavailable */
  }
  return 'system';
}

/**
 * Resolve preference to an applied light/dark theme.
 * @param {ThemePreference} preference
 * @returns {ResolvedTheme}
 */
export function resolveTheme(preference) {
  if (preference === 'light' || preference === 'dark') {
    return preference;
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

/** Document root used for theme CSS custom properties. */
export function getThemeRoot() {
  return typeof document !== 'undefined' ? document.documentElement : null;
}

/**
 * Apply resolved theme on the document root and repaint spreadsheet chrome.
 * @param {ResolvedTheme} theme
 */
export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-bs-theme', theme);
  root.style.colorScheme = theme;
  notifySpreadsheetThemeChange();
  window.dispatchEvent(new CustomEvent('sk-theme-change', {
    detail: { theme, preference: getThemePreference() },
  }));
}

/**
 * Persist preference and apply the resolved theme.
 * @param {ThemePreference} preference
 */
export function setThemePreference(preference) {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch (e) {
    /* ignore */
  }
  applyTheme(resolveTheme(preference));
}

/** Apply stored preference (call before first paint). */
export function initTheme() {
  applyTheme(resolveTheme(getThemePreference()));
  if (typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      if (getThemePreference() === 'system') {
        applyTheme(resolveTheme('system'));
      }
    };
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onSystemChange);
    } else if (typeof mq.addListener === 'function') {
      mq.addListener(onSystemChange);
    }
  }
}

/** Label helper for menu radio-style entries. */
export function themeMenuLabel(id, label, preference) {
  const active =
    preference === id.replace('theme-', '') ||
    (id === 'theme-system' && preference === 'system');
  return active ? `${label} ✓` : label;
}

function notifySpreadsheetThemeChange() {
  const ss = typeof window !== 'undefined' ? window.SkSpreadSheet : null;
  if (!ss) return;
  if (ss.m_SpInterface && typeof ss.m_SpInterface.refreshThemeColors === 'function') {
    ss.m_SpInterface.refreshThemeColors();
  }
  if (typeof ss.applyThemeRefresh === 'function') {
    ss.applyThemeRefresh();
  } else if (typeof ss.invalidate === 'function') {
    ss.invalidate();
  }
}
