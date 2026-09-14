import { useCallback, useEffect, useState } from 'react';

// Persistence key used to remember whether the user already completed/skipped
// the tour. Bumping the suffix is a cheap way to re-trigger the tour for
// every existing user after a major UI change.
export const TOUR_STORAGE_KEY = 'sker_app_tour_v3';

/**
 * useGuidedTour
 *
 * Tiny controller around the tour run state. When autoStart is enabled, the
 * tour runs once for new users (completion stored in localStorage). By default
 * the app starts with autoStart off — use the left-panel "Guided tour" entry
 * or window.__skerStartTour() to replay.
 *
 * @param {object} options
 * @param {boolean} options.enabled - whether the tour is allowed to run (e.g. user logged in)
 * @param {boolean} [options.autoStart=true] - auto-start on first visit
 */
export function useGuidedTour({ enabled, autoStart = true } = {}) {
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!enabled || !autoStart) return;
    let done = null;
    try {
      done = localStorage.getItem(TOUR_STORAGE_KEY);
    } catch (e) {
      // localStorage may be unavailable (private mode, sandboxed iframe, etc.).
      done = null;
    }
    if (!done) {
      // Defer slightly so layout/refs are mounted before Joyride probes them.
      const t = setTimeout(() => setRun(true), 600);
      return () => clearTimeout(t);
    }
  }, [enabled, autoStart]);

  const start = useCallback(() => {
    setStepIndex(0);
    setRun(true);
  }, []);

  const stop = useCallback(() => {
    setRun(false);
  }, []);

  const markCompleted = useCallback(() => {
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, String(Date.now()));
    } catch (e) {
      // Best-effort persistence; ignore storage errors.
    }
  }, []);

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(TOUR_STORAGE_KEY);
    } catch (e) {
      // Ignore storage errors.
    }
    setStepIndex(0);
    setRun(true);
  }, []);

  return { run, setRun, stepIndex, setStepIndex, start, stop, reset, markCompleted };
}

export default useGuidedTour;
