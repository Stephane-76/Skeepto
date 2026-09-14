/**
 * App-wide session teardown and idle timeout.
 * Ensures document locks are released while the JWT is still valid.
 */
import {
  clearActiveFile,
  clearSpreadsheetSession,
  clearTextDocumentSession,
  releaseTextDocumentLockIfAny,
} from './SkActiveFile.js';
import { showAlert } from './skDialog.js';

/** Logout after this much idle time. */
export const SESSION_IDLE_LOGOUT_MS = 15 * 60 * 1000;

/** Show idle warning this many ms before logout (15 min − 1 min → warning at 14 min). */
export const SESSION_IDLE_WARNING_MS = 1 * 60 * 1000;

const beforeLogoutCallbacks = new Set();

let idleMonitorStop = null;
let idleWarningTimer = null;
let idleLogoutTimer = null;
let jwtLogoutTimer = null;
let warningShown = false;
let logoutInProgress = false;

export function registerBeforeLogoutCallback(fn) {
  beforeLogoutCallbacks.add(fn);
  return () => beforeLogoutCallbacks.delete(fn);
}

function clearSessionStorage() {
  sessionStorage.removeItem('jwt');
  sessionStorage.removeItem('user');
  sessionStorage.removeItem('email');
  sessionStorage.removeItem('group');
  sessionStorage.removeItem('name');
  sessionStorage.removeItem('firstname');
  sessionStorage.removeItem('SkPendingMenuAction');
  clearSpreadsheetSession();
  sessionStorage.removeItem('SkTextDocumentFile');
}

function decodeJwtExpiryMs(jwt) {
  if (!jwt) {
    return null;
  }
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1]));
    if (typeof payload.exp === 'number') {
      return payload.exp * 1000;
    }
  } catch (error) {
    console.warn('decodeJwtExpiryMs failed:', error);
  }
  return null;
}

function scheduleJwtExpiryLogout(onLogout) {
  if (jwtLogoutTimer) {
    clearTimeout(jwtLogoutTimer);
    jwtLogoutTimer = null;
  }
  const jwt = sessionStorage.getItem('jwt');
  const expMs = decodeJwtExpiryMs(jwt);
  if (!expMs) {
    return;
  }
  const delay = expMs - Date.now() - 60 * 1000;
  if (delay <= 0) {
    void performAppLogout({ reason: 'jwt-expired', onComplete: onLogout });
    return;
  }
  jwtLogoutTimer = setTimeout(() => {
    jwtLogoutTimer = null;
    void performAppLogout({ reason: 'jwt-expired', onComplete: onLogout });
  }, delay);
}

function resetIdleTimers(onLogout, onWarning) {
  if (idleWarningTimer) {
    clearTimeout(idleWarningTimer);
    idleWarningTimer = null;
  }
  if (idleLogoutTimer) {
    clearTimeout(idleLogoutTimer);
    idleLogoutTimer = null;
  }
  warningShown = false;

  if (!sessionStorage.getItem('jwt')) {
    return;
  }

  const warningDelay = SESSION_IDLE_LOGOUT_MS - SESSION_IDLE_WARNING_MS;
  if (warningDelay > 0 && typeof onWarning === 'function') {
    idleWarningTimer = setTimeout(() => {
      idleWarningTimer = null;
      if (warningShown || logoutInProgress) {
        return;
      }
      warningShown = true;
      void onWarning();
    }, warningDelay);
  }

  idleLogoutTimer = setTimeout(() => {
    idleLogoutTimer = null;
    void performAppLogout({ reason: 'idle', onComplete: onLogout });
  }, SESSION_IDLE_LOGOUT_MS);
}

/**
 * Start idle + JWT-expiry monitors. Returns a stop function.
 * @param {{ onLogout?: () => void, onWarning?: () => Promise<void> }} handlers
 */
export function startIdleSessionMonitor(handlers = {}) {
  stopIdleSessionMonitor();

  const onLogout = handlers.onLogout || (() => {});
  const onWarning = handlers.onWarning || (async () => {
    await showAlert({
      title: 'Session timeout',
      message: 'You have been inactive. You will be signed out in a few minutes unless you continue working.',
      variant: 'warning',
    });
  });

  const onActivity = (event) => {
    if (logoutInProgress) {
      return;
    }
    if (event && event.isTrusted === false) {
      return;
    }
    // Ignore passive layout scroll while the idle warning is visible; only explicit input resets.
    if (warningShown) {
      const type = event?.type;
      if (type !== 'mousedown' && type !== 'keydown' && type !== 'touchstart') {
        return;
      }
    }
    resetIdleTimers(onLogout, onWarning);
    scheduleJwtExpiryLogout(onLogout);
  };

  // Deliberate user input only — scroll/wheel from the spreadsheet reset idle too often.
  const activityEvents = ['mousedown', 'keydown', 'touchstart'];
  activityEvents.forEach((eventName) => {
    document.addEventListener(eventName, onActivity, true);
  });
  window.addEventListener('focus', onActivity);

  onActivity();

  idleMonitorStop = () => {
    activityEvents.forEach((eventName) => {
      document.removeEventListener(eventName, onActivity, true);
    });
    window.removeEventListener('focus', onActivity);
    if (idleWarningTimer) {
      clearTimeout(idleWarningTimer);
      idleWarningTimer = null;
    }
    if (idleLogoutTimer) {
      clearTimeout(idleLogoutTimer);
      idleLogoutTimer = null;
    }
    if (jwtLogoutTimer) {
      clearTimeout(jwtLogoutTimer);
      jwtLogoutTimer = null;
    }
    idleMonitorStop = null;
  };

  return idleMonitorStop;
}

export function stopIdleSessionMonitor() {
  if (typeof idleMonitorStop === 'function') {
    idleMonitorStop();
  }
}

/**
 * Ordered logout: flush open editors, release locks, clear session, return to login.
 * @param {{ reason?: string, onComplete?: () => void }} [options]
 */
export async function performAppLogout(options = {}) {
  const { reason = 'manual', onComplete } = options;
  if (logoutInProgress) {
    return;
  }
  logoutInProgress = true;
  stopIdleSessionMonitor();

  try {
    for (const fn of beforeLogoutCallbacks) {
      try {
        await fn({ reason });
      } catch (error) {
        console.warn('beforeLogout callback failed:', error);
      }
    }
    await releaseTextDocumentLockIfAny();
    clearSessionStorage();
    clearActiveFile();
    clearTextDocumentSession();
    if (typeof onComplete === 'function') {
      onComplete();
    }
  } finally {
    logoutInProgress = false;
  }
}
