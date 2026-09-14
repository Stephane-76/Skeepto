//=============================================================================
// SkWebInterface.mjs
// Interface With Server method Get and Post
// Author Stéphane ALLEZ 08/08/2024
//=============================================================================

import { shouldBlockReadOnlyPost } from './SkActiveFile.js';

/** Extract a server error string from JSON body or raw text. */
function extractHttpErrorMessage(body) {
  if (body == null || body === '') return '';
  if (typeof body === 'object') {
    if (typeof body.error === 'string') return body.error;
    if (typeof body.message === 'string' && body.message !== 'error') return body.message;
    return '';
  }
  const text = String(body);
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.error === 'string') return parsed.error;
    if (typeof parsed?.message === 'string' && parsed.message !== 'error') return parsed.message;
  } catch {
    /* raw body */
  }
  return text;
}

/**
 * 401 = not authenticated. 403 is often ACL ("Permission denied") and must NOT log out.
 * Legacy JWT hook may still return 403 Invalid token — treat those as auth failures.
 */
function shouldRedirectToLogin(status, body) {
  if (status === 401) return true;
  if (status !== 403) return false;
  const msg = extractHttpErrorMessage(body).toLowerCase();
  if (
    msg.includes('permission denied') ||
    msg.includes('read-only') ||
    msg.includes('access limited')
  ) {
    return false;
  }
  if (
    msg.includes('invalid token') ||
    msg.includes('no authorized') ||
    msg.includes('jwt required') ||
    msg.includes('unauthorized')
  ) {
    return true;
  }
  // Default: stay logged in (file/ACL forbidden is more common than auth 403).
  return false;
}

export class SkWebInterface {
  constructor() {
    this.email = sessionStorage.getItem("email");
    this.lastError = "";
    this.onAuthError = null; // Callback for authentication errors
  }

  // Set callback for authentication errors
  setOnAuthError(callback) {
    this.onAuthError = callback;
  }

  // Redirect to login on authentication error — flush editors and release locks first.
  redirectToLogin() {
    if (typeof window.__skerPerformAppLogout === 'function') {
      void window.__skerPerformAppLogout({ reason: 'auth' });
      return;
    }

    sessionStorage.removeItem("jwt");
    sessionStorage.removeItem("user");
    sessionStorage.removeItem("email");

    if (this.onAuthError) {
      this.onAuthError();
    }
    if (typeof window.__skerNavigateLogin === "function") {
      window.__skerNavigateLogin();
    } else {
      window.location.assign(`${window.location.origin}/`);
    }
  }

  error(message) {
    console.error(message);
  }

  /** GET request returning status + raw body (for streamed JSON endpoints). */
  getText = async (uri, jsonQuery) => {
    let options = {
      method: 'GET',
      mode: 'cors',
      credentials: 'include',
      headers: {
        authorization: 'Bearer ' + window.sessionStorage.getItem('jwt'),
      },
      user: window.sessionStorage.getItem('user'),
    };

    if (jsonQuery !== undefined) uri = uri + '/' + encodeURIComponent(jsonQuery);

    try {
      const response = await fetch(uri, options);
      const text = await response.text();
      if (shouldRedirectToLogin(response.status, text)) {
        this.redirectToLogin();
      }
      return { ok: response.ok, status: response.status, text };
    } catch (error) {
      console.error('Network error in getText:', error);
      return { ok: false, status: 0, text: '' };
    }
  };

  getJson = async(uri, jsonQuery) => {
    let options = {
      method: 'GET',
      mode: 'cors',
      credentials: 'include',
      headers: {
        authorization: 'Bearer ' + window.sessionStorage.getItem("jwt")
      },
      user: window.sessionStorage.getItem("user")
    };
    
    console.log("JWT-->", window.sessionStorage.getItem("jwt"));
    if (jsonQuery !== undefined) uri = uri + '/' + encodeURIComponent(jsonQuery);
    
    try {
      const response = await fetch(uri, options);
      const text = await response.text();
      if (!response.ok) {
        if (shouldRedirectToLogin(response.status, text)) {
          this.redirectToLogin();
        }
        const serverError = extractHttpErrorMessage(text);
        return JSON.stringify({
          message: 'error',
          error: serverError || `Web error:${response.status}`,
        });
      }
      return text;
    } catch (error) {
      console.error('Network error in getJson:', error);
      const returnObj = {
        message: 'error',
        error: error?.message || String(error),
      };
      return JSON.stringify(returnObj);
    }
  }

  postJson = async(uri, jsonBody, mode = 'insert', fetchExtras = {}) => {
    if (shouldBlockReadOnlyPost(uri, jsonBody)) {
      console.warn(`POST blocked (read-only workbook): ${uri}`);
      return JSON.stringify({
        message: 'error',
        error: 'Permission denied: workbook is read-only',
      });
    }

    let options = {
      method: 'POST',
      mode: 'cors',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Operation-Mode': mode,
        authorization: 'Bearer ' + window.sessionStorage.getItem("jwt")
      },
      user: window.sessionStorage.getItem("user"),
      body: jsonBody,
      ...fetchExtras,
    };

    try {
      const response = await fetch(uri, options);
      if (!response.ok) {
        let errorText = `Web error: ${response.status}`;
        let details;
        let hints;
        let rawForAuth = '';
        try {
          const wBody = await response.json();
          rawForAuth = wBody;
          if (wBody?.error) {
            errorText = typeof wBody.error === 'string' ? wBody.error : JSON.stringify(wBody.error);
          } else if (wBody?.message && wBody.message !== 'error') {
            errorText = wBody.message;
          }
          details = wBody?.details;
          hints = wBody?.hints;
        } catch {
          /* keep default errorText */
        }
        if (shouldRedirectToLogin(response.status, rawForAuth || errorText)) {
          this.redirectToLogin();
        }
        return JSON.stringify({
          message: 'error',
          error: errorText,
          details,
          hints,
        });
      }

      const obj = await response.json();
      let json = JSON.stringify(obj);
      return json;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw error;
      }
      console.error('Network error in postJson:', error);
      const returnObj = {
        message: 'error',
        error: error?.message || String(error),
      };
      return JSON.stringify(returnObj);
    }
  }

  deleteJson = async(uri, jsonQuery) => {
    let options = {
      method: 'DELETE',
      mode: 'cors',
      credentials: 'include',
      headers: {
        authorization: 'Bearer ' + window.sessionStorage.getItem("jwt"),
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      user: window.sessionStorage.getItem("user")
    };

    if (jsonQuery !== undefined) uri = uri + '/' + encodeURIComponent(jsonQuery);
    
    try {
      const response = await fetch(uri, options);
      const text = await response.text();
      if (!response.ok) {
        if (shouldRedirectToLogin(response.status, text)) {
          this.redirectToLogin();
        }
        const serverError = extractHttpErrorMessage(text);
        return JSON.stringify({
          message: 'error',
          error: serverError || `Web error:${response.status}`,
        });
      }
      try {
        return JSON.stringify(JSON.parse(text));
      } catch {
        return text;
      }
    } catch (error) {
      console.error('Network error in deleteJson:', error);
      const returnObj = {
        message: 'error',
        error: error?.message || String(error),
      };
      return JSON.stringify(returnObj);
    }
  }
}

export default SkWebInterface;
