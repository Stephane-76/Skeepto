import React from 'react';
import { Joyride, STATUS, EVENTS } from 'react-joyride';
import { tourSteps } from './tourSteps.js';
import { useGuidedTour } from './useGuidedTour.js';
import './tour.css';

// Sker-flavored Joyride styles. Kept here so the rest of the app does not
// need to know about Joyride internals.
const JOYRIDE_STYLES = {
  options: {
    primaryColor: '#4f46e5',
    backgroundColor: '#ffffff',
    textColor: '#1f2937',
    arrowColor: '#ffffff',
    overlayColor: 'rgba(0, 0, 0, 0.55)',
    zIndex: 100000,
  },
  tooltip: {
    borderRadius: 12,
    padding: 16,
    fontSize: 14,
    maxWidth: 420,
  },
  tooltipTitle: {
    fontSize: 16,
    fontWeight: 700,
    margin: 0,
    marginBottom: 6,
  },
  buttonNext: {
    borderRadius: 8,
    padding: '8px 14px',
    fontWeight: 600,
  },
  buttonBack: {
    color: '#4f46e5',
    marginRight: 8,
  },
  buttonSkip: {
    color: '#6b7280',
  },
};

// react-joyride v3 locale keys (see node_modules/react-joyride/dist/index.mjs).
const LOCALE_EN = {
  back: 'Back',
  close: 'Close',
  last: 'Finish',
  next: 'Next',
  nextWithProgress: 'Next ({current} / {total})',
  open: 'Open the tour',
  skip: 'Skip',
};

function escapeTourPathSelector(path) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(path);
  }
  return String(path).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Map tour hints (Budget.sker, /Budget.sker) to the real virtual-disk path.
function resolveTourSteps(steps) {
  const resolver =
    typeof window.__skerVirtualDiskResolveTourPath === 'function'
      ? window.__skerVirtualDiskResolveTourPath
      : null;

  return steps.map((step) => {
    const hint = step.demoFile || step.openFileOnNext;
    if (!hint || !resolver) return step;

    const resolved = resolver(hint);
    if (!resolved) return step;

    const next = { ...step };
    if (step.demoFile) next.demoFile = resolved;
    if (step.openFileOnNext) next.openFileOnNext = resolved;
    if (typeof step.target === 'string' && step.target.includes('[data-path=')) {
      next.target = `[data-path="${escapeTourPathSelector(resolved)}"]`;
    }
    return next;
  });
}

/**
 * GuidedTour - new-user onboarding tour.
 *
 * Mounts a Joyride driver bound to the steps in ./tourSteps.js. The
 * companion hook (useGuidedTour) handles persistence and run-state.
 *
 * react-joyride v3 owns the step state internally when `continuous` is set,
 * so we do NOT pass `stepIndex` (passing it would conflict with the lib's
 * own next/prev controls and stop the tour after the first click). We only
 * toggle `run` to start/stop. To replay, we bump a `runKey` to force-remount
 * the Joyride component so it restarts from step 0 cleanly.
 *
 * Exposes window.__skerStartTour() so any component (e.g. a Help menu item)
 * can trigger a replay without importing this file.
 *
 * @param {object} props
 * @param {boolean} props.enabled - whether the user is logged in / tour can run
 * @param {boolean} [props.autoStart=true] - whether to start automatically on first visit
 * @param {Function} [props.onBeforeStart] - called right before the tour
 *   starts, useful to ensure DOM targets exist (e.g. open the side panel).
 */
export function GuidedTour({ enabled, autoStart = true, onBeforeStart }) {
  const { run, setRun, reset, markCompleted } = useGuidedTour({ enabled, autoStart });
  const [runKey, setRunKey] = React.useState(0);
  const [steps, setSteps] = React.useState(tourSteps);

  // Resolve Budget.sker (or any hint) once the Virtual Disk tree is loaded.
  React.useEffect(() => {
    if (!run) {
      setSteps(tourSteps);
      return undefined;
    }

    let attempts = 0;
    const id = setInterval(() => {
      attempts += 1;
      const resolved = resolveTourSteps(tourSteps);
      const resolvedPath =
        typeof window.__skerVirtualDiskResolveTourPath === 'function'
          ? window.__skerVirtualDiskResolveTourPath('/share/Budget.sker')
          : null;

      if (resolvedPath || attempts >= 40) {
        setSteps(resolved);
        clearInterval(id);
      }
    }, 150);

    return () => clearInterval(id);
  }, [run, runKey]);

  // Run side-effects (e.g. open the left panel) right before showing the
  // first step so that target elements are present in the DOM.
  React.useEffect(() => {
    if (run && typeof onBeforeStart === 'function') {
      onBeforeStart();
    }
  }, [run, onBeforeStart]);

  // Expose a global hook for menus / settings to relaunch the tour.
  React.useEffect(() => {
    window.__skerStartTour = () => {
      if (typeof onBeforeStart === 'function') onBeforeStart();
      // Reset per-step tracking so previously-handled steps re-run.
      lastHandledStepRef.current = -1;
      // Force a fresh Joyride instance so it restarts at step 0.
      setRunKey((k) => k + 1);
      reset();
    };
    window.__skerStopTour = () => setRun(false);
    return () => {
      delete window.__skerStartTour;
      delete window.__skerStopTour;
    };
  }, [reset, setRun, onBeforeStart]);

  // Track auto-click timers so we can cancel them when stepping or stopping.
  const autoClickTimerRef = React.useRef(null);
  const cancelAutoClick = React.useCallback(() => {
    if (autoClickTimerRef.current) {
      clearTimeout(autoClickTimerRef.current);
      autoClickTimerRef.current = null;
    }
  }, []);

  // Briefly add a CSS class on the target to make the simulated click visible
  // (a quick "pressed" pulse). The class is auto-removed after the animation.
  const pulseStepTarget = React.useCallback((selector) => {
    const root = typeof selector === 'string' ? document.querySelector(selector) : null;
    if (!root) return;
    root.classList.add('sker-tour-pulse');
    setTimeout(() => root.classList.remove('sker-tour-pulse'), 700);
  }, []);

  // Try to trigger the actual element click first (this exercises the real
  // <Link> handler in react-router). If the route does not change shortly
  // after, fall back to programmatic SPA navigation. This is robust against
  // invalid HTML nesting like <button><a/></button> where Chrome may route
  // the click to the outer button.
  // Click on the step target with a visual pulse, then guarantee navigation
  // via the SPA router as a fallback (handles invalid HTML nesting like
  // <button><a/></button> where the click may be absorbed by the wrapper).
  const triggerStepAction = React.useCallback(
    (step) => {
      pulseStepTarget(step.target);

      const root = typeof step.target === 'string' ? document.querySelector(step.target) : null;
      const link = root ? root.querySelector('a[href]') || root.querySelector('a') : null;
      if (link && typeof link.click === 'function') {
        link.click();
      }

      if (step.route) {
        setTimeout(() => {
          const current = window.location && window.location.pathname;
          if (current !== step.route && typeof window.__skerNavigate === 'function') {
            window.__skerNavigate(step.route);
          }
        }, 100);
      }

      // Optional follow-up demo: select and/or double-click a file in the
      // Virtual Disk view to showcase the open workflow.
      // Step fields:
      //   demoFile             file path to act on (required)
      //   demoFileSelectDelay  ms before selecting the row
      //   demoFileOpenDelay    ms between selection and double-click;
      //                        explicit null disables the auto-open
      //   demoFileSkipSelect   true to skip the select+scroll (when the file
      //                        was already selected by a previous step)
      if (step.demoFile) {
        const skipSelect = !!step.demoFileSkipSelect;
        const selectDelay = typeof step.demoFileSelectDelay === 'number'
          ? step.demoFileSelectDelay
          : (skipSelect ? 0 : 500);
        const hasOpenDelay = Object.prototype.hasOwnProperty.call(step, 'demoFileOpenDelay');
        const openDelay = hasOpenDelay
          ? (typeof step.demoFileOpenDelay === 'number' ? step.demoFileOpenDelay : null)
          : 3000;

        const callOpen = () => {
          window.__skerVirtualDiskOpen(step.demoFile, { selectDelay, openDelay, skipSelect });
        };

        if (typeof window.__skerVirtualDiskOpen === 'function') {
          callOpen();
        } else {
          let attempts = 0;
          const id = setInterval(() => {
            attempts += 1;
            if (typeof window.__skerVirtualDiskOpen === 'function') {
              callOpen();
              clearInterval(id);
            } else if (attempts >= 30) {
              clearInterval(id);
            }
          }, 100);
        }

        // When the demo will trigger a navigation (double-click opens the
        // spreadsheet), advance Joyride to the next step at the same time so
        // the current target does not orphan and break the tour.
        if (openDelay !== null) {
          const totalDelay = selectDelay + openDelay;
          setTimeout(() => {
            const c = controlsRef.current;
            if (c && typeof c.next === 'function') {
              c.next();
            }
          }, totalDelay);
        }
      }
    },
    [pulseStepTarget]
  );

  // Track which step index has already been "auto-handled" so we don't
  // schedule the click multiple times when several lifecycle events fire
  // for the same step.
  const lastHandledStepRef = React.useRef(-1);

  // Latest Joyride controls object (passed as 2nd arg to onEvent). Used to
  // programmatically advance the tour when a step triggers a navigation that
  // would otherwise unmount the target and break the transition.
  const controlsRef = React.useRef(null);

  // Open or close the Virtual Disk actions FAB menu (targets live inside the panel).
  const setActionsMenuOpen = React.useCallback((open) => {
    const fn = open
      ? window.__skerVirtualDiskOpenActionsMenu
      : window.__skerVirtualDiskCloseActionsMenu;
    if (typeof fn === 'function') fn();
  }, []);

  const handleEvent = React.useCallback(
    (data, controls) => {
      controlsRef.current = controls || controlsRef.current;
      const { status, type, step, index } = data;

      if (type === EVENTS.STEP_BEFORE && step && lastHandledStepRef.current !== index) {
        lastHandledStepRef.current = index;

        if (step.closeActionsMenu) {
          setActionsMenuOpen(false);
        }
        if (step.openActionsMenu) {
          setActionsMenuOpen(true);
        }

        if (step.autoClick) {
          cancelAutoClick();
          const delay = typeof step.autoClickDelay === 'number' ? step.autoClickDelay : 900;
          autoClickTimerRef.current = setTimeout(() => triggerStepAction(step), delay);
        } else if (step.demoFile) {
          // Demo-only step (no menu auto-click): pulse the target and run the
          // demo helper after a short pause so the tooltip is visible first.
          cancelAutoClick();
          autoClickTimerRef.current = setTimeout(() => triggerStepAction(step), 200);
        } else if (step.route) {
          const current = window.location && window.location.pathname;
          if (current !== step.route && typeof window.__skerNavigate === 'function') {
            window.__skerNavigate(step.route);
          }
        }
      }

      if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
        cancelAutoClick();
      }

      // When the user clicks Next on a step that defines openFileOnNext, run
      // the open helper. We do it here (not on STEP_BEFORE) so the tooltip
      // stays visible at the user's pace. STEP_AFTER also fires for Back /
      // Close / Skip, so we explicitly require the "next" action.
      const action = data.action;
      if (
        type === EVENTS.STEP_AFTER &&
        action === 'next' &&
        step &&
        step.openFileOnNext
      ) {
        const hint = step.openFileOnNext;
        const path =
          typeof window.__skerVirtualDiskResolveTourPath === 'function'
            ? (window.__skerVirtualDiskResolveTourPath(hint) || hint)
            : hint;
        const tryOpen = () => {
          if (typeof window.__skerVirtualDiskOpen === 'function') {
            window.__skerVirtualDiskOpen(path, {
              skipSelect: false,
              selectDelay: 0,
              openDelay: 200,
            });
            return true;
          }
          return false;
        };
        if (!tryOpen()) {
          let attempts = 0;
          const id = setInterval(() => {
            attempts += 1;
            if (tryOpen() || attempts >= 30) clearInterval(id);
          }, 100);
        }
      }

      const finished = [STATUS.FINISHED, STATUS.SKIPPED];
      if (type === EVENTS.TOUR_END || finished.includes(status)) {
        cancelAutoClick();
        markCompleted();
        setRun(false);
        lastHandledStepRef.current = -1;
      }
    },
    [markCompleted, setRun, cancelAutoClick, triggerStepAction, setActionsMenuOpen]
  );

  // Clean up on unmount.
  React.useEffect(() => () => cancelAutoClick(), [cancelAutoClick]);

  if (!enabled) return null;

  return (
    <Joyride
      key={runKey}
      steps={steps}
      run={run}
      continuous
      showProgress
      showSkipButton
      scrollToFirstStep
      disableScrolling={false}
      onEvent={handleEvent}
      locale={LOCALE_EN}
      styles={JOYRIDE_STYLES}
    />
  );
}

export default GuidedTour;
