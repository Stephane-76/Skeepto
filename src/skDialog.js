/**
 * Global Sker alert / confirm dialogs (SkDialogHost mounted in App.js).
 */

let dialogHost = null;

export function registerSkDialogHost(hostApi) {
  dialogHost = hostApi;
}

export function unregisterSkDialogHost() {
  dialogHost = null;
}

function normalizeOptions(options, fallbackMessage) {
  if (typeof options === 'string') {
    return { message: options };
  }
  return options || { message: fallbackMessage || '' };
}

/** Information or error dialog with a single OK button. Returns a Promise. */
export function showAlert(options) {
  const payload = normalizeOptions(options);
  if (dialogHost) {
    return dialogHost.showAlert(payload);
  }
  window.alert(payload.message || '');
  return Promise.resolve();
}

/** Confirmation dialog. Resolves true (confirm) or false (cancel). */
export function showConfirm(options) {
  const payload = normalizeOptions(options);
  if (dialogHost) {
    return dialogHost.showConfirm(payload);
  }
  return Promise.resolve(window.confirm(payload.message || ''));
}

export function showError(message, title = 'Error') {
  return showAlert({ title, message, variant: 'error' });
}

export function showSuccess(message, title = 'Success') {
  return showAlert({ title, message, variant: 'success' });
}
