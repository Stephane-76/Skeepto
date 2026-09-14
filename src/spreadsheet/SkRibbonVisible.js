/** Persisted visibility for SkSpTopCommand (spreadsheet ribbon). Shown by default. */

export const SK_RIBBON_VISIBILITY_EVENT = 'sk-ribbon-visibility-change';
const STORAGE_KEY = 'SkRibbonVisible';

/** True unless the user explicitly hid the ribbon (stored as "hidden"). */
export function getRibbonVisible() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw !== 'hidden';
  } catch {
    return true;
  }
}

export function setRibbonVisible(visible) {
  try {
    if (visible) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, 'hidden');
    }
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(SK_RIBBON_VISIBILITY_EVENT, { detail: { visible: !!visible } })
    );
  }
}

export function subscribeRibbonVisible(listener) {
  if (typeof window === 'undefined') {
    return () => {};
  }
  const handler = (event) => {
    listener(event?.detail?.visible ?? getRibbonVisible());
  };
  window.addEventListener(SK_RIBBON_VISIBILITY_EVENT, handler);
  return () => window.removeEventListener(SK_RIBBON_VISIBILITY_EVENT, handler);
}
