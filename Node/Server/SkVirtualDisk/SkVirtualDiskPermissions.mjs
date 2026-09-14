import {
  userHomeDirectoryPath,
  isPathWithinGlobalSharedDirectory,
  getGlobalSharedDirectoryPaths,
} from './SkUserHome.mjs';

const SKER_ADMIN_GROUP_CODES = new Set(['admin', 'admins']);

/** Default groups — no cross-user access via group bits alone. */
const SKER_GENERIC_GROUP_CODES = new Set(['user', 'guest']);

/** Directories any logged-in user may list and traverse (like Unix /home). */
const SKER_PUBLIC_DIRECTORY_PATHS = new Set(['/home']);

function isPublicDirectoryPath(filePath) {
  const p = normalizeVirtualPath(filePath);
  if (!p) {
    return false;
  }
  if (SKER_PUBLIC_DIRECTORY_PATHS.has(p)) {
    return true;
  }
  return getGlobalSharedDirectoryPaths().includes(p);
}

export const SKER_SHARED_ACCESS_READ = 'read';
export const SKER_SHARED_ACCESS_WRITE = 'write';

function normalizeVirtualPath(p) {
  if (!p || typeof p !== 'string') {
    return p;
  }
  let out = p.replace(/\/+/g, '/');
  if (out.length > 1 && out.endsWith('/')) {
    out = out.slice(0, -1);
  }
  return out;
}

export function normalizeGroupCode(groupCode) {
  return String(groupCode || '').trim().toLowerCase();
}

export function normalizeUserEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isAdminGroup(groupCode) {
  return SKER_ADMIN_GROUP_CODES.has(normalizeGroupCode(groupCode));
}

/** Guest accounts: may browse shared folders as readers, never as writers via sharedAccess. */
export function isGuestGroup(groupCode) {
  return normalizeGroupCode(groupCode) === 'guest';
}

/**
 * Permissions are stored as three octal digits (e.g. 644, 770).
 * Legacy rows may store the JS numeric value of an octal literal (0o644 → 420).
 */
export function normalizePermissionMode(permissions) {
  const numeric = Number(permissions);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }

  if (numeric <= 511) {
    const octalDigits = numeric.toString(8);
    if (/^[0-7]{1,3}$/.test(octalDigits)) {
      return parseInt(octalDigits.padStart(3, '0'), 10);
    }
  }

  return Math.trunc(numeric);
}

function getPermissionBits(permissions) {
  const mode = normalizePermissionMode(permissions);
  return {
    owner: Math.floor(mode / 100) % 10,
    group: Math.floor(mode / 10) % 10,
    others: mode % 10,
  };
}

function getRequiredPermissionBit(requestedPermission) {
  switch (requestedPermission) {
    case 'read':
      return 4;
    case 'write':
      return 2;
    case 'execute':
      return 1;
    default:
      return 0;
  }
}

function hasPermissionBit(bits, requiredBit) {
  return (bits & requiredBit) === requiredBit;
}

/**
 * Load directory roots marked as shared by an admin ({ path, sharedAccess }).
 */
export async function loadSharedDirectoryRoots(db) {
  return db
    .collection('Directory')
    .find({
      isDirectory: true,
      sharedAccess: { $in: [SKER_SHARED_ACCESS_READ, SKER_SHARED_ACCESS_WRITE] },
    })
    .project({ path: 1, sharedAccess: 1 })
    .toArray();
}

/**
 * Longest matching admin-shared directory ancestor for a path.
 */
export function getInheritedSharedAccess(filePath, sharedRoots = []) {
  const p = normalizeVirtualPath(filePath);
  if (!p || !Array.isArray(sharedRoots) || sharedRoots.length === 0) {
    return null;
  }

  let best = null;
  let bestLen = -1;

  for (const root of sharedRoots) {
    const rp = normalizeVirtualPath(root.path);
    if (!rp || !root.sharedAccess) {
      continue;
    }
    if (p === rp || p.startsWith(`${rp}/`)) {
      if (rp.length > bestLen) {
        bestLen = rp.length;
        best = root.sharedAccess;
      }
    }
  }

  return best;
}

/**
 * Group access for dedicated (non-generic) groups only.
 */
export function groupMembershipGrantsAccess(fileGroup, userGroup) {
  const fileCode = normalizeGroupCode(fileGroup);
  const userCode = normalizeGroupCode(userGroup);
  if (!fileCode || !userCode || fileCode !== userCode) {
    return false;
  }
  return !SKER_GENERIC_GROUP_CODES.has(fileCode);
}

function resolveEffectiveSharedAccess(sFile, sharedRoots) {
  if (sFile._effectiveSharedAccess) {
    return sFile._effectiveSharedAccess;
  }
  if (sFile.sharedAccess) {
    return sFile.sharedAccess;
  }
  return getInheritedSharedAccess(sFile.path, sharedRoots);
}

/**
 * Unix-style Virtual Disk permission check.
 * @param {object} sFile — Directory document (may include _effectiveSharedAccess)
 * @param {Array} [sharedRoots] — from loadSharedDirectoryRoots(), optional
 */
export function checkFilePermissions(
  sFile,
  sUserId,
  sUserGroup,
  sRequestedPermission,
  sharedRoots = []
) {
  if (isAdminGroup(sUserGroup)) {
    return true;
  }

  const requiredBit = getRequiredPermissionBit(sRequestedPermission);
  const filePath = normalizeVirtualPath(sFile.path);

  if (
    sFile.isDirectory &&
    isPublicDirectoryPath(filePath) &&
    (requiredBit === 4 || requiredBit === 1)
  ) {
    return true;
  }

  const sharedRaw = resolveEffectiveSharedAccess(sFile, sharedRoots);
  // Guests: shared roots only allow listing/traversing directories.
  // File open/read/write always follows Unix owner/group/others bits
  // (so rw-rw---- blocks guest even under /share).
  let shared = sharedRaw;
  if (isGuestGroup(sUserGroup)) {
    if (!sFile.isDirectory) {
      shared = null;
    } else if (sharedRaw === SKER_SHARED_ACCESS_WRITE) {
      shared = SKER_SHARED_ACCESS_READ;
    }
  }

  if (shared === SKER_SHARED_ACCESS_WRITE) {
    return true;
  }
  if (
    shared === SKER_SHARED_ACCESS_READ &&
    (requiredBit === 4 || (sFile.isDirectory && requiredBit === 1))
  ) {
    return true;
  }

  const wPermBits = getPermissionBits(sFile.permissions);
  if (normalizeUserEmail(sFile.owner) === normalizeUserEmail(sUserId)) {
    return hasPermissionBit(wPermBits.owner, requiredBit);
  }

  if (groupMembershipGrantsAccess(sFile.group, sUserGroup)) {
    return hasPermissionBit(wPermBits.group, requiredBit);
  }

  if (hasPermissionBit(wPermBits.others, requiredBit)) {
    return true;
  }

  return false;
}

export function isPathWithinUserHome(filePath, email) {
  const home = userHomeDirectoryPath(email);
  const p = normalizeVirtualPath(filePath);
  if (!home || !p) {
    return false;
  }
  return p === home || p.startsWith(`${home}/`);
}

/** Non-admin users: personal home + root /template and /share. */
export function pathAllowedForUser(filePath, userEmail, userGroup) {
  if (isAdminGroup(userGroup)) {
    return true;
  }
  if (isPathWithinUserHome(filePath, userEmail)) {
    return true;
  }
  return isPathWithinGlobalSharedDirectory(filePath);
}

export function pathScopeErrorForUser(filePath, userEmail, userGroup) {
  if (pathAllowedForUser(filePath, userEmail, userGroup)) {
    return null;
  }
  return 'Access limited to your home directory and shared folders';
}
