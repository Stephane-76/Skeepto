//=============================================================================
// SkDocumentLock.mjs — pessimistic edit locks for .html editor files (Mongo + TTL)
//=============================================================================

const LOCK_COLLECTION = 'DocumentLock';
export const DOCUMENT_LOCK_TTL_MS = 30 * 60 * 1000;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return '';
  }
  let out = filePath.replace(/\/+/g, '/');
  if (out.length > 1 && out.endsWith('/')) {
    out = out.slice(0, -1);
  }
  return out;
}

export function isTextEditorDocumentPath(filePath) {
  const path = normalizePath(filePath).toLowerCase();
  return path.endsWith('.html') || path.endsWith('.htm');
}

/** @deprecated Use isTextEditorDocumentPath */
export const isHtmlDocumentPath = isTextEditorDocumentPath;

/** @deprecated Use isTextEditorDocumentPath */
export const isDocVirtualPath = isTextEditorDocumentPath;

function lockCollection(db) {
  return db.collection(LOCK_COLLECTION);
}

export async function ensureDocumentLockIndexes(db) {
  const col = lockCollection(db);
  await col.createIndex({ path: 1 }, { unique: true });
  await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

async function deleteExpiredLockIfAny(db, path) {
  const col = lockCollection(db);
  const existing = await col.findOne({ path });
  if (!existing) {
    return null;
  }
  const expiresAt = existing.expiresAt ? new Date(existing.expiresAt) : null;
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    await col.deleteOne({ path });
    return null;
  }
  return existing;
}

export async function getDocumentLock(db, filePath) {
  const path = normalizePath(filePath);
  if (!path) {
    return null;
  }
  const existing = await deleteExpiredLockIfAny(db, path);
  if (!existing) {
    return null;
  }
  return {
    path: existing.path,
    lockedBy: existing.lockedBy,
    lockedAt: existing.lockedAt,
    expiresAt: existing.expiresAt,
  };
}

/**
 * Acquire or refresh a lock for the given user.
 * Returns { ok: true, lock } or { ok: false, status: 409, lock, error }.
 */
export async function acquireDocumentLock(db, filePath, userEmail) {
  const path = normalizePath(filePath);
  const email = normalizeEmail(userEmail);
  if (!path || !email) {
    return { ok: false, status: 400, error: 'path and user are required' };
  }
  if (!isTextEditorDocumentPath(path)) {
    return { ok: false, status: 400, error: 'Document lock applies to .html files only' };
  }

  const col = lockCollection(db);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DOCUMENT_LOCK_TTL_MS);
  const existing = await deleteExpiredLockIfAny(db, path);

  if (existing && normalizeEmail(existing.lockedBy) !== email) {
    return {
      ok: false,
      status: 409,
      error: `Document is locked by ${existing.lockedBy}`,
      lock: {
        path: existing.path,
        lockedBy: existing.lockedBy,
        lockedAt: existing.lockedAt,
        expiresAt: existing.expiresAt,
      },
    };
  }

  const doc = {
    path,
    lockedBy: email,
    lockedAt: now,
    expiresAt,
  };

  if (existing) {
    await col.updateOne({ path }, { $set: doc });
  } else {
    try {
      await col.insertOne(doc);
    } catch (error) {
      if (error?.code === 11000) {
        return acquireDocumentLock(db, path, email);
      }
      throw error;
    }
  }

  return { ok: true, lock: doc };
}

/** Release lock when the same user closes the editor (best-effort). */
export async function releaseDocumentLock(db, filePath, userEmail) {
  const path = normalizePath(filePath);
  const email = normalizeEmail(userEmail);
  if (!path || !email) {
    return { ok: false, status: 400, error: 'path and user are required' };
  }

  const col = lockCollection(db);
  const existing = await col.findOne({ path });
  if (!existing) {
    return { ok: true, released: false };
  }
  if (normalizeEmail(existing.lockedBy) !== email) {
    return {
      ok: false,
      status: 409,
      error: `Document is locked by ${existing.lockedBy}`,
      lock: existing,
    };
  }

  await col.deleteOne({ path });
  return { ok: true, released: true };
}

/**
 * Ensure the user holds a valid lock before POST /files update on a .html editor file.
 * Throws an Error with statusCode when blocked.
 */
export async function assertDocumentLockForWrite(db, filePath, userEmail) {
  const path = normalizePath(filePath);
  const email = normalizeEmail(userEmail);
  if (!isTextEditorDocumentPath(path)) {
    return;
  }

  const lock = await getDocumentLock(db, path);
  if (!lock) {
    const err = new Error('Document is not locked for editing');
    err.statusCode = 409;
    err.code = 'DOCUMENT_NOT_LOCKED';
    throw err;
  }
  if (normalizeEmail(lock.lockedBy) !== email) {
    const err = new Error(`Document is locked by ${lock.lockedBy}`);
    err.statusCode = 409;
    err.code = 'DOCUMENT_LOCKED';
    err.lock = lock;
    throw err;
  }

  const expiresAt = lock.expiresAt ? new Date(lock.expiresAt).getTime() : 0;
  if (expiresAt <= Date.now()) {
    const err = new Error('Document lock expired');
    err.statusCode = 409;
    err.code = 'DOCUMENT_LOCK_EXPIRED';
    throw err;
  }

  await lockCollection(db).updateOne(
    { path },
    { $set: { expiresAt: new Date(Date.now() + DOCUMENT_LOCK_TTL_MS) } }
  );
}
