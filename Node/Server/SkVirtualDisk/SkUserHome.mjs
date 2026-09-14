//=============================================================================
// SkUserHome.mjs — ensure per-user home directory on the virtual disk
//=============================================================================

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeVirtualPath(p) {
  if (!p || typeof p !== 'string') return p;
  let out = p.replace(/\/+/g, '/');
  if (out.length > 1 && out.endsWith('/')) {
    out = out.slice(0, -1);
  }
  return out;
}

export function userHomeDirectoryPath(email) {
  const normalized = normalizeEmail(email);
  return normalized ? `/home/${normalized}` : '/home';
}

export function userDocumentsDirectoryPath(email) {
  return `${userHomeDirectoryPath(email)}/${HOME_USER_SUBDIR}`;
}

/** Standard subfolder under each /home/<email> (personal workspace). */
const HOME_USER_SUBDIR = 'document';

const HOME_SUBDIRS = [HOME_USER_SUBDIR];

/** /home root: rwx rw- r-- — listable by all users (see SKER_PUBLIC_DIRECTORY_PATHS). */
const HOME_ROOT_PERMISSIONS = 764;

/** Per-user home and standard subfolders: rwx rwx --- */
const HOME_DIR_PERMISSIONS = 760;

/** Shared folders at filesystem root, visible to every user. */
const GLOBAL_SHARED_DIRS = [
  { name: 'template', permissions: 755, sharedAccess: 'read' },
  { name: 'share', permissions: 775, sharedAccess: 'write' },
];

/** System directory at filesystem root (FHS-style), not under /home. */
const VAR_DIRECTORY_PATH = '/var';
const VAR_DIR_PERMISSIONS = 760;

export {
  HOME_SUBDIRS,
  HOME_USER_SUBDIR,
  HOME_ROOT_PERMISSIONS,
  HOME_DIR_PERMISSIONS,
  GLOBAL_SHARED_DIRS,
  VAR_DIRECTORY_PATH,
  VAR_DIR_PERMISSIONS,
};

/** @deprecated use GLOBAL_SHARED_DIRS */
export const GLOBAL_HOME_DIRS = GLOBAL_SHARED_DIRS;

export function globalSharedDirectoryPath(name) {
  const segment = String(name || '').trim().replace(/^\/+|\/+$/g, '');
  return segment ? `/${segment}` : '/';
}

/** @deprecated use globalSharedDirectoryPath */
export const globalHomeDirectoryPath = globalSharedDirectoryPath;

export function getGlobalSharedDirectoryPaths() {
  return GLOBAL_SHARED_DIRS.map((entry) => globalSharedDirectoryPath(entry.name));
}

/** @deprecated use getGlobalSharedDirectoryPaths */
export const getGlobalHomeDirectoryPaths = getGlobalSharedDirectoryPaths;

export function isPathWithinGlobalSharedDirectory(filePath) {
  const p = normalizeVirtualPath(filePath);
  if (!p) {
    return false;
  }
  return getGlobalSharedDirectoryPaths().some(
    (root) => p === root || p.startsWith(`${root}/`),
  );
}

/** @deprecated use isPathWithinGlobalSharedDirectory */
export const isPathWithinGlobalHomeDirectory = isPathWithinGlobalSharedDirectory;

async function resolveGlobalDirOwner(db) {
  const envOwner = normalizeEmail(process.env.SKER_ADMIN_EMAIL || 'admin@sker.com');
  const envUser = await db.collection('User').findOne({ Email: envOwner });
  if (envUser) {
    return envOwner;
  }
  const adminUser = await db.collection('User').findOne({
    Group: { $in: ['admin', 'admins'] },
  });
  return normalizeEmail(adminUser?.Email) || envOwner;
}

/**
 * Group code stored on system Directory rows.
 * Does not throw when Group metamodel is not seeded yet (server boot before SkFillData).
 */
async function resolveSystemDirectoryGroupCode(db, ownerEmail) {
  const ownerUser = await db.collection('User').findOne({
    Email: normalizeEmail(ownerEmail),
  });
  const preferred =
    ownerUser?.Group || process.env.SKER_DEFAULT_USER_GROUP || 'admin';
  const groupDoc = await db.collection('Group').findOne({ Code: preferred });
  if (groupDoc) {
    return groupDoc.Code;
  }
  const anyGroup = await db.collection('Group').findOne({}, { projection: { Code: 1 } });
  if (anyGroup?.Code) {
    return anyGroup.Code;
  }
  return preferred;
}

/**
 * Create /home if it does not exist.
 * Idempotent.
 */
export async function ensureHomeRootDirectory(db) {
  const directoryCol = db.collection('Directory');

  const owner = await resolveGlobalDirOwner(db);
  const groupCode = await resolveSystemDirectoryGroupCode(db, owner);

  const existing = await directoryCol.findOne({ path: '/home', isDirectory: true });
  if (existing) {
    return { ok: true, path: '/home' };
  }

  const now = new Date();
  await directoryCol.insertOne({
    name: 'home',
    path: '/home',
    owner,
    group: groupCode,
    isDirectory: true,
    permissions: HOME_ROOT_PERMISSIONS,
    parentId: null,
    content: null,
    size: 0,
    createdAt: now,
    updatedAt: now,
  });

  return { ok: true, path: '/home' };
}

/**
 * Create /template and /share at the virtual disk root.
 * Idempotent; backfills sharedAccess on existing folders when missing.
 */
export async function ensureGlobalSharedDirectories(db) {
  const directoryCol = db.collection('Directory');

  const owner = await resolveGlobalDirOwner(db);
  const groupCode = await resolveSystemDirectoryGroupCode(db, owner);

  const now = new Date();

  async function findDirByPath(dirPath) {
    return directoryCol.findOne({ path: dirPath, isDirectory: true });
  }

  async function ensureDirectory(dirPath, dirName, permissions, extra = {}) {
    const existing = await findDirByPath(dirPath);
    if (existing) {
      const patch = {};
      if (extra.sharedAccess && existing.sharedAccess !== extra.sharedAccess) {
        patch.sharedAccess = extra.sharedAccess;
      }
      if (existing.permissions !== permissions) {
        patch.permissions = permissions;
      }
      if (Object.keys(patch).length > 0) {
        patch.updatedAt = now;
        await directoryCol.updateOne({ _id: existing._id }, { $set: patch });
      }
      return existing._id;
    }

    await directoryCol.insertOne({
      name: dirName,
      path: dirPath,
      owner,
      group: groupCode,
      isDirectory: true,
      permissions,
      parentId: null,
      content: null,
      size: 0,
      createdAt: now,
      updatedAt: now,
      ...extra,
    });
  }

  for (const entry of GLOBAL_SHARED_DIRS) {
    const dirPath = globalSharedDirectoryPath(entry.name);
    await ensureDirectory(dirPath, entry.name, entry.permissions, {
      sharedAccess: entry.sharedAccess,
    });
  }

  return { ok: true, paths: getGlobalSharedDirectoryPaths() };
}

/** Ensures /home plus root-level shared folders (legacy entry point). */
export async function ensureGlobalHomeDirectories(db) {
  await ensureHomeRootDirectory(db);
  return ensureGlobalSharedDirectories(db);
}

/**
 * Create /var at the virtual disk root (not under /home).
 * Idempotent.
 */
export async function ensureVarDirectory(db) {
  const directoryCol = db.collection('Directory');

  const owner = await resolveGlobalDirOwner(db);
  const groupCode = await resolveSystemDirectoryGroupCode(db, owner);

  const existing = await directoryCol.findOne({
    path: VAR_DIRECTORY_PATH,
    isDirectory: true,
  });
  if (existing) {
    return { ok: true, path: VAR_DIRECTORY_PATH };
  }

  const now = new Date();
  await directoryCol.insertOne({
    name: 'var',
    path: VAR_DIRECTORY_PATH,
    owner,
    group: groupCode,
    isDirectory: true,
    permissions: VAR_DIR_PERMISSIONS,
    parentId: null,
    content: null,
    size: 0,
    createdAt: now,
    updatedAt: now,
  });

  return { ok: true, path: VAR_DIRECTORY_PATH };
}

/**
 * Create /home/<email> and standard subfolders if they do not exist.
 * Idempotent: existing directories are left unchanged.
 */
export async function ensureUserHomeDirectory(db, options = {}) {
  await ensureHomeRootDirectory(db);
  await ensureGlobalSharedDirectories(db);

  const email = normalizeEmail(options.email);
  if (!email) {
    return { ok: false, homePath: null, reason: 'missing email' };
  }

  const directoryCol = db.collection('Directory');
  const groupCol = db.collection('Group');

  let groupCode = options.group;
  if (!groupCode) {
    const user = await db.collection('User').findOne({ Email: email });
    groupCode = user?.Group;
  }
  if (!groupCode) {
    groupCode = process.env.SKER_DEFAULT_USER_GROUP || 'user';
  }

  const groupDoc = await groupCol.findOne({ Code: groupCode });
  if (!groupDoc) {
    throw new Error(`Group "${groupCode}" not found`);
  }

  const owner = email;
  const homePath = userHomeDirectoryPath(email);
  const now = new Date();

  async function findDirByPath(dirPath) {
    return directoryCol.findOne({ path: dirPath, isDirectory: true });
  }

  async function resolveParentId(parentPath) {
    if (!parentPath || parentPath === '/') {
      return null;
    }
    const parent = await findDirByPath(parentPath);
    return parent?._id ?? null;
  }

  async function ensureDirectory(dirPath, dirName, permissions = HOME_DIR_PERMISSIONS) {
    const existing = await findDirByPath(dirPath);
    if (existing) {
      return existing._id;
    }

    const parentPath =
      dirPath === '/'
        ? null
        : dirPath.substring(0, dirPath.lastIndexOf('/')) || '/';
    const parentId = parentPath === '/' ? null : await resolveParentId(parentPath);

    if (parentPath && parentPath !== '/' && parentId == null) {
      throw new Error(`Parent directory "${parentPath}" does not exist`);
    }

    const doc = {
      name: dirName,
      path: dirPath,
      owner,
      group: groupDoc.Code,
      isDirectory: true,
      permissions,
      parentId,
      content: null,
      size: 0,
      createdAt: now,
      updatedAt: now,
    };

    const insertResult = await directoryCol.insertOne(doc);
    return insertResult.insertedId;
  }

  const homeRootId = (await findDirByPath('/home'))?._id ?? null;
  const homeId = await ensureDirectory(homePath, email, HOME_DIR_PERMISSIONS);

  if (homeRootId && homeId) {
    await directoryCol.updateOne(
      { _id: homeId, parentId: { $ne: homeRootId } },
      { $set: { parentId: homeRootId, updatedAt: now } },
    );
  }

  for (const subName of HOME_SUBDIRS) {
    const subPath = `${homePath}/${subName}`;
    const subExisting = await findDirByPath(subPath);
    if (subExisting) {
      continue;
    }
    await directoryCol.insertOne({
      name: subName,
      path: subPath,
      owner,
      group: groupDoc.Code,
      isDirectory: true,
      permissions: HOME_DIR_PERMISSIONS,
      parentId: homeId,
      content: null,
      size: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { ok: true, homePath, email };
}
