import {
  checkFilePermissions,
  loadSharedDirectoryRoots,
} from './SkVirtualDiskPermissions.mjs';

/** Resolve MongoDB User.Group for virtual disk permission checks. */
export async function resolveUserGroup(db, userEmail) {
  if (!userEmail) {
    return 'guest';
  }
  const user = await db.collection('User').findOne({ Email: userEmail });
  return user?.Group ?? 'guest';
}

/** True when userEmail may write the virtual file at path. */
export async function canWriteVirtualPath(db, path, userEmail) {
  if (!db || !path || !userEmail) {
    return false;
  }
  const [file, sharedRoots, group] = await Promise.all([
    db.collection('Directory').findOne({ path }),
    loadSharedDirectoryRoots(db),
    resolveUserGroup(db, userEmail),
  ]);
  if (!file) {
    return false;
  }
  return checkFilePermissions(file, userEmail, group, 'write', sharedRoots);
}
