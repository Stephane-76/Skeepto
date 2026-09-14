// Virtual disk home path helpers (browser)

export const SK_VIRTUAL_DISK_PATH_KEY = 'SkVirtualDiskPath';

export function normalizeUserEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** Per-user home on the virtual disk, e.g. /home/sallez@skeema.fr */
export function userHomeDirectoryPath(email) {
  const normalized = normalizeUserEmail(email);
  return normalized ? `/home/${normalized}` : '/home';
}

export function isCurrentUserAdmin() {
  if (typeof sessionStorage === 'undefined') {
    return false;
  }
  const group = String(sessionStorage.getItem('group') || '').trim().toLowerCase();
  return group === 'admin' || group === 'admins';
}

export function isPathWithinUserHome(filePath, email) {
  const home = userHomeDirectoryPath(email);
  const path = String(filePath || '').replace(/\/+/g, '/').replace(/\/$/, '') || '';
  if (!home || !path) {
    return false;
  }
  return path === home || path.startsWith(`${home}/`);
}

const GLOBAL_SHARED_DIR_NAMES = ['template', 'share'];

export function getGlobalSharedDirectoryPaths() {
  return GLOBAL_SHARED_DIR_NAMES.map((name) => `/${name}`);
}

export function isPathWithinGlobalSharedDirectory(filePath) {
  const path = String(filePath || '').replace(/\/+/g, '/').replace(/\/$/, '') || '';
  if (!path) {
    return false;
  }
  return GLOBAL_SHARED_DIR_NAMES.some(
    (name) => path === `/${name}` || path.startsWith(`/${name}/`),
  );
}

/** @deprecated use isPathWithinGlobalSharedDirectory */
export const isPathWithinGlobalHomeDirectory = isPathWithinGlobalSharedDirectory;

export function isAllowedVirtualDiskPathForUser(filePath, email, isAdmin = false) {
  if (isAdmin) {
    return true;
  }
  return isPathWithinUserHome(filePath, email) || isPathWithinGlobalSharedDirectory(filePath);
}

function readStoredEntry() {
  try {
    const raw = localStorage.getItem(SK_VIRTUAL_DISK_PATH_KEY);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.email && parsed?.path) {
        return parsed;
      }
    } catch {
      /* legacy plain path string */
    }
    return { email: null, path: raw };
  } catch {
    return null;
  }
}

export function getStoredVirtualDiskPath() {
  const entry = readStoredEntry();
  if (!entry?.path) {
    return '';
  }
  const currentEmail = normalizeUserEmail(
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('email') : ''
  );
  if (entry.email && currentEmail && entry.email !== currentEmail) {
    return '';
  }
  return entry.path;
}

export function setStoredVirtualDiskPath(path, email) {
  try {
    const normalizedEmail = normalizeUserEmail(
      email ||
        (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('email') : '')
    );
    if (path && normalizedEmail) {
      localStorage.setItem(
        SK_VIRTUAL_DISK_PATH_KEY,
        JSON.stringify({ email: normalizedEmail, path })
      );
    }
  } catch {
    /* localStorage may be unavailable */
  }
}

/** Per-user documents folder, e.g. /home/sallez@skeema.fr/documents */
export function userDocumentsDirectoryPath(email) {
  return `${userHomeDirectoryPath(email)}/documents`;
}

/** Saved path for this user, or /home/<email>/documents when localStorage is empty. */
export function defaultVirtualDiskPathForSession() {
  const email =
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('email') : '';
  const home = userHomeDirectoryPath(email);
  const documents = userDocumentsDirectoryPath(email);

  if (!isCurrentUserAdmin()) {
    const stored = getStoredVirtualDiskPath();
    if (stored && isAllowedVirtualDiskPathForUser(stored, email, false)) {
      return stored;
    }
    return documents;
  }

  const stored = getStoredVirtualDiskPath();
  if (stored) {
    return stored;
  }
  return home;
}

/** Set documents path on first login when this user has no saved directory yet. */
export function ensureDefaultVirtualDiskPathForUser(email) {
  const documents = userDocumentsDirectoryPath(email);
  const home = userHomeDirectoryPath(email);
  if (!isCurrentUserAdmin()) {
    setStoredVirtualDiskPath(documents, email);
    return documents;
  }
  if (getStoredVirtualDiskPath()) {
    return getStoredVirtualDiskPath();
  }
  setStoredVirtualDiskPath(home, email);
  return home;
}
