import { rebuildSkerContentFromRecord } from './SkSkerStorage.mjs';
import {
  checkFilePermissions,
  loadSharedDirectoryRoots,
} from '../SkVirtualDisk/SkVirtualDiskPermissions.mjs';

function isSkerFile(fileRecord) {
  const name = fileRecord?.name || '';
  const pathStr = typeof fileRecord?.path === 'string' ? fileRecord.path : '';
  return (
    (typeof name === 'string' && name.toLowerCase().endsWith('.sker')) ||
    pathStr.toLowerCase().endsWith('.sker')
  );
}

/**
 * Load Directory record with read permission check.
 * Uses sharedRoots so /share (and other shared dirs) match /files/access.
 */
export async function fetchSpreadsheetFileRecord(fastify, virtualPath, userEmail, group) {
  const collection = fastify.mongo.db.collection('Directory');
  const fileRecord = await collection.findOne({ path: virtualPath });
  if (!fileRecord) {
    return { fileRecord: null, error: 'File not found', statusCode: 404 };
  }
  const sharedRoots = await loadSharedDirectoryRoots(fastify.mongo.db);
  if (!checkFilePermissions(fileRecord, userEmail, group, 'read', sharedRoots)) {
    return { fileRecord: null, error: 'Permission denied', statusCode: 403 };
  }
  return { fileRecord, error: null, statusCode: 200 };
}

/**
 * Resolve workbook JSON string from Mongo (no WASM). Used by content stream and background open.
 */
export async function resolveWorkbookContentString(fastify, fileRecord, gridFSBucket) {
  if (!fileRecord || fileRecord.isDirectory) {
    return null;
  }

  // .sker payload lives in Spreadsheet (+ GridFS via record), not Directory.gridfsId.
  // Directory.gridfsId can go stale while persist rewrites Spreadsheet GridFS (FileNotFound on reopen).
  if (isSkerFile(fileRecord)) {
    const rebuilt = await rebuildSkerContentFromRecord(fastify, fileRecord);
    if (rebuilt?.content) {
      return rebuilt.content;
    }
    return null;
  }

  if (fileRecord.gridfsId && gridFSBucket) {
    const chunks = [];
    const stream = gridFSBucket.openDownloadStream(fileRecord.gridfsId);
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  if (typeof fileRecord.content === 'string' && fileRecord.content.length > 0) {
    return fileRecord.content;
  }

  if (fileRecord.content && typeof fileRecord.content === 'object') {
    return JSON.stringify(fileRecord.content);
  }

  return null;
}

/** True when GET /spreadsheet/content can stream GridFS bytes without rebuilding JSON. */
export function canStreamDirectoryGridFs(fileRecord) {
  return Boolean(fileRecord?.gridfsId && !isSkerFile(fileRecord));
}
