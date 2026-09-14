// =============================================================================
// Desktop (Electron) mode detection.
// window.skerDesktop is injected by electron/preload.js. When absent, the app
// runs as the regular web/server build.
// =============================================================================

export const isDesktop =
  typeof window !== 'undefined' && !!window.skerDesktop;

/** Convenience accessor for the preload bridge (undefined on web). */
export function getDesktopBridge() {
  return typeof window !== 'undefined' ? window.skerDesktop : undefined;
}
