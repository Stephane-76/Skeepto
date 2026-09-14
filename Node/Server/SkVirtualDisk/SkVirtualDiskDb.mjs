/**
 * SkVirtualDisk.mjs
 * 
 * This module implements a virtual file system with the following features:
 * - File and directory management
 * - Unix-style permissions (rwx) for owner, group, and others
 * - Each user belongs to a group (User.Group / JWT group); files inherit the owner's group
 * - Group code "admin" bypasses all permission checks (full access)
 * - Hierarchical structure with parentId
 * - GridFS support for large files
 * 
 * Available routes:
 * 
 * POST /files
 * - Creates a new file or directory
 * - Verifies parent directory existence
 * - Sets default permissions (755 for directories, 644 for files)
 * - Uses GridFS for files larger than 16MB
 * 
 * GET /files/:id
 * - Retrieves file information (JSON metadata)
 * - Checks read permissions
 * - Streams file bytes when ?download=1 (.sker from Spreadsheet, else GridFS/inline)
 * 
 * GET /files/chmod/:id
 * - Modifies file permissions
 * - Only the owner can modify permissions
 * 
 * DELETE /files/:id
 * - Deletes a file or directory
 * - Recursively deletes directory contents
 * - Removes GridFS chunks for large files
 *
 * POST /files/rename
 * - Renames or moves a file/directory (Body: { oldPath, newPath })
 * - Refuses when the destination already exists
 * - Re-bases descendant paths for directories, moves .sker history, invalidates WASM cache
 * 
 * GET /files/list/:path
 * - Lists directory contents
 * - Filters based on user permissions
 * 
 * GET /files/tree
 * - Returns complete file tree
 * - Uses parentId for efficient hierarchical structure
 * 
 * GET /files/download/:id
 * - Downloads a file from MongoDB to disk
 * 
 * POST /files/new-spreadsheet
 * - Creates a blank .sker via WASM (NewWorkBook + WriteJson) and persists it through POST /files
 * - Body: { path: string, name?: string, owner?: string, group?: string, permissions?: number }
 *
 * POST /files/new-document
 * - Creates a blank .html (standalone HTML content) and persists it through POST /files
 * - Body: { path: string, name?: string, owner?: string, group?: string, permissions?: number }
 *
 * POST /files/lock
 * - Acquire or refresh a pessimistic edit lock on a .html file (TTL 30 minutes)
 *
 * DELETE /files/lock
 * - Release a .html edit lock held by the current user
 *
 * GET /files/lock/:id
 * - Query lock status (id = encodeURIComponent(JSON.stringify({ path })))
 *
 * POST /files/migrate-sker
 * - Admin migration of inline .sker content into Spreadsheet collection
 *
 * GET /files/history/:id
 * - List saved versions for a .sker file (id = encodeURIComponent(JSON.stringify({ path, limit? })))
 *
 * POST /files/history/snapshot
 * - Body: { path: string, label: string, comment?: string } — save a labeled manual snapshot
 *
 * GET /files/history/version/:versionId
 * - Fetch one historical snapshot (metadata + JSON content)
 *
 * POST /files/history/restore
 * - Body: { path: string, versionId: string } — restore a historical version
 *
 * POST /files/convert-xlsx
 * - Starts Excel → .sker conversion in background (202 + taskId)
 * - GET /files/convert-xlsx/tasks/:taskId — poll conversion status/result
 * - Body: { path: string, tmpDir?: string, fileName?: string }
 * - Calls SkExcel with parameter /f:filename
 * - Returns: { message: 'success', path: string, size: number, fileName: string, skExcelOutput: string, skExcelError: string }
 * 
 * Data structure:
 * 
 * File/Directory:
 * {
 *   name: string,           // File/directory name
 *   path: string,           // Full path
 *   content: string,        // Content (for small files)
 *   gridfsId: ObjectId,     // GridFS file ID (for large files)
 *   size: number,          // File size in bytes
 *   owner: string,          // Owner's email
 *   group: string,          // Group code
 *   isDirectory: boolean,   // true for directory, false for file
 *   parentId: ObjectId,     // Parent directory ID
 *   permissions: number,    // Unix permissions (e.g. 755)
 *   createdAt: Date,       // Creation date
 *   updatedAt: Date        // Last modification date
 * }
 * 
 * Permissions:
 * - Unix format (rwx)
 * - 4 = read (r)
 * - 2 = write (w)
 * - 1 = execute (x)
 * - Example: 755 = rwxr-xr-x
 * 
 * @author Stéphane ALLEZ
 * @version 1.1
 */

import { ObjectId } from '@fastify/mongodb'
import { GridFSBucket } from 'mongodb'
import dependenciesContainer from '../Depency/SkDepencyManager.mjs'
import { saveSkerToCollections, rebuildSkerContentFromRecord, listSkerHistory, getSkerHistoryVersion, restoreSkerFromHistory, createSkerHistorySnapshot } from '../SkSpreadSheet/SkSkerStorage.mjs'
import { promises as fs } from 'fs'
import path from 'path'
import { createWriteStream } from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'
import {
  checkFilePermissions,
  loadSharedDirectoryRoots,
  isAdminGroup,
  pathAllowedForUser,
  pathScopeErrorForUser,
  SKER_SHARED_ACCESS_READ,
  SKER_SHARED_ACCESS_WRITE,
} from './SkVirtualDiskPermissions.mjs'
import {
  userHomeDirectoryPath,
  ensureHomeRootDirectory,
  ensureGlobalSharedDirectories,
  ensureVarDirectory,
  getGlobalSharedDirectoryPaths,
} from './SkUserHome.mjs'
import {
  acquireDocumentLock,
  assertDocumentLockForWrite,
  ensureDocumentLockIndexes,
  getDocumentLock,
  isTextEditorDocumentPath,
  releaseDocumentLock,
} from './SkDocumentLock.mjs'
import { executeExcelConversion, executeSkerToExcelExport } from './SkExcelConversion.mjs'
import {
  createExcelConversionTask,
  getExcelConversionTask,
  setExcelConversionError,
  setExcelConversionReady,
} from './SkExcelConversionTasks.mjs'

/** Permission check with admin-declared shared directory roots loaded once per request. */
async function createPermissionChecker(db) {
  const sharedRoots = await loadSharedDirectoryRoots(db);
  return (file, userEmail, userGroup, perm) =>
    checkFilePermissions(file, userEmail, userGroup, perm, sharedRoots);
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// GridFS chunk payload must stay under MongoDB's 16MB BSON limit (metadata adds overhead).
const GRIDFS_CHUNK_SIZE = 14 * 1024 * 1024; // 14MB
const MAX_INLINE_SIZE = 16 * 1024 * 1024; // 16MB
// Fastify default is 1MB; large .sker uploads need more (convert-xlsx, data URLs).
const FILES_UPLOAD_BODY_LIMIT = 128 * 1024 * 1024; // 128MB
function calculateVirtualFileContentSize(content, ext) {
  if (Buffer.isBuffer(content)) {
    return Buffer.byteLength(content);
  }
  if (typeof content !== 'string' || content.length === 0) {
    return 0;
  }
  const binaryExt = ['xlsx', 'xls', 'xlsm', 'xlsb', 'zip', 'png', 'jpg', 'jpeg', 'gif', 'pdf'];
  let raw = content;
  if (raw.startsWith('data:')) {
    raw = raw.split(',')[1] || '';
  }
  if (ext === 'sker' || !binaryExt.includes(ext)) {
    return Buffer.byteLength(raw, 'utf8');
  }
  return Buffer.byteLength(Buffer.from(raw, 'base64'));
}

const DOWNLOAD_MIME_BY_EXT = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  xlsb: 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
  zip: 'application/zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  pdf: 'application/pdf',
  html: 'text/html',
  htm: 'text/html',
  txt: 'text/plain',
  json: 'application/json',
};

function isSkerVirtualFile(file) {
  const name = file?.name;
  const pathStr = file?.path;
  return (
    (typeof name === 'string' && name.toLowerCase().endsWith('.sker')) ||
    (typeof pathStr === 'string' && pathStr.toLowerCase().endsWith('.sker'))
  );
}

function virtualFileExtension(file) {
  const name = typeof file?.name === 'string' && file.name.includes('.')
    ? file.name
    : (typeof file?.path === 'string' ? file.path : '');
  return name.includes('.') ? name.split('.').pop().toLowerCase() : '';
}

function attachmentContentDisposition(fileName) {
  const safe = String(fileName || 'download').replace(/["\r\n]/g, '');
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

/** Decode Directory inline content (text, data URL, or JSON object) for a browser download. */
function decodeInlineDownloadContent(content) {
  if (content == null) {
    return null;
  }
  if (Buffer.isBuffer(content)) {
    return content;
  }
  if (typeof content === 'string') {
    if (content.startsWith('data:')) {
      const commaIdx = content.indexOf(',');
      const base64 = commaIdx >= 0 ? content.substring(commaIdx + 1) : '';
      return Buffer.from(base64, 'base64');
    }
    return content;
  }
  if (typeof content === 'object') {
    return JSON.stringify(content);
  }
  return String(content);
}

/** Collapse duplicate slashes; strip trailing slash except for root. */
function normalizeVirtualPath(p) {
  if (!p || typeof p !== 'string') return p;
  let out = p.replace(/\/+/g, '/');
  if (out.length > 1 && out.endsWith('/')) {
    out = out.slice(0, -1);
  }
  return out;
}

/** After POST /files overwrites a .sker in Mongo, drop SkSpSpreadSheet memory so GET /spreadsheet reloads. */
async function invalidateSkeeptoCacheForPath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return;
  }
  try {
    const sk = dependenciesContainer.resolve('SkSpreadSheet');
    if (sk && typeof sk.invalidateWorkBookCache === 'function') {
      await sk.invalidateWorkBookCache(filePath);
    }
  } catch (e) {
    console.warn('invalidateSkeeptoCacheForPath:', e?.message || e);
  }
}

/** Emails currently collaborating on a .sker workbook (empty when none or unavailable). */
function activeCollaboratorsForPath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return [];
  }
  try {
    const sk = dependenciesContainer.resolve('SkSpreadSheet');
    if (sk && typeof sk.getActiveUsersForWorkBook === 'function') {
      return sk.getActiveUsersForWorkBook(filePath) || [];
    }
  } catch (e) {
    console.warn('activeCollaboratorsForPath:', e?.message || e);
  }
  return [];
}


const SkFileSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    path: { type: 'string' },
    content: { type: 'string', nullable: true },
    size: { type: 'number', nullable: true },
    owner: { type: 'string' },
    group: { type: 'string' },
    isDirectory: { type: 'boolean' },
    parentId: { type: 'string', nullable: true },
    permissions: { type: 'number', nullable: true }
  },
  required: ['name', 'path', 'owner', 'group', 'isDirectory']
}

async function SkVirtualDiskDb(fastify, opts) {
    console.log('\n=== Registering SkVirtualDisk plugin ===');
    
    // Initialize GridFS bucket after MongoDB is ready
    let gridFSBucket;
    try {
        gridFSBucket = new GridFSBucket(fastify.mongo.db, {
            chunkSizeBytes: GRIDFS_CHUNK_SIZE,
            bucketName: 'files'
        });
        console.log('GridFS bucket initialized');
        await ensureDocumentLockIndexes(fastify.mongo.db);
        try {
          await ensureHomeRootDirectory(fastify.mongo.db);
          await ensureGlobalSharedDirectories(fastify.mongo.db);
          await ensureVarDirectory(fastify.mongo.db);
        } catch (provisionError) {
          console.warn(
            'Virtual disk system directories deferred:',
            provisionError?.message || provisionError,
          );
        }
    } catch (wError) {
        const wErrorMessage = `❌ Error initializing GridFS: ${wError}`;
        console.error(wErrorMessage);
        throw new Error(wErrorMessage);
    }

    /** Persist .sker without HTTP inject (avoids Fastify bodyLimit on large JSON payloads). */
    async function persistSkerVirtualFileDirect({ name, path: filePath, content, owner, permissions }) {
      const wCollection = fastify.mongo.db.collection('Directory');
      const wUsersCollection = fastify.mongo.db.collection('User');
      const wGroupCollection = fastify.mongo.db.collection('Group');

      const wNormalizedPath = normalizeVirtualPath(filePath);
      const wPermissions = permissions ?? 644;

      const wOwner = await wUsersCollection.findOne({ Email: owner });
      if (!wOwner) {
        throw new Error(`Owner ${owner} not found`);
      }
      const wGroup = await wGroupCollection.findOne({ Code: wOwner.Group });
      if (!wGroup) {
        throw new Error(`Group ${wOwner.Group} not found`);
      }

      let wParentId = null;
      if (wNormalizedPath !== '/' && wNormalizedPath.includes('/')) {
        const wParentPath = wNormalizedPath.substring(0, wNormalizedPath.lastIndexOf('/'));
        if (wParentPath !== '') {
          const wParentDir = await wCollection.findOne({
            path: wParentPath,
            isDirectory: true,
          });
          if (!wParentDir) {
            throw new Error(
              `Cannot create file '${name}': Parent directory '${wParentPath}' does not exist`,
            );
          }
          wParentId = wParentDir._id;
        }
      }

      const wFileExist = await wCollection.findOne({ path: wNormalizedPath });
      const wSize = calculateVirtualFileContentSize(content, 'sker');

      const { recordId, info, size: skerSize } = await saveSkerToCollections(
        fastify,
        wFileExist,
        wNormalizedPath,
        content,
      );

      const wNewFile = {
        name,
        path: wNormalizedPath,
        permissions: wPermissions,
        group: wGroup.Code,
        owner,
        parentId: wParentId,
        content: null,
        gridfsId: null,
        size: skerSize || wSize,
        isDirectory: false,
        updatedAt: new Date(),
        ...(info ? { info } : {}),
        ...(recordId ? { record: recordId } : {}),
      };

      if (wFileExist) {
        if (wFileExist.gridfsId) {
          await gridFSBucket.delete(wFileExist.gridfsId);
        }
        await wCollection.updateOne({ path: wNormalizedPath }, { $set: wNewFile });
        await invalidateSkeeptoCacheForPath(wNormalizedPath);
        return { message: 'success', id: wFileExist._id };
      }

      wNewFile.createdAt = new Date();
      const wInsert = await wCollection.insertOne(wNewFile);
      await invalidateSkeeptoCacheForPath(wNormalizedPath);
      return { message: 'success', id: wInsert.insertedId };
    }

    /** Persist a binary virtual file (e.g. .xlsx) without HTTP body limits. */
    async function persistBinaryVirtualFileDirect({
      name,
      path: filePath,
      buffer,
      owner,
      permissions,
      mimeType = 'application/octet-stream',
    }) {
      const wCollection = fastify.mongo.db.collection('Directory');
      const wUsersCollection = fastify.mongo.db.collection('User');
      const wGroupCollection = fastify.mongo.db.collection('Group');

      if (!Buffer.isBuffer(buffer)) {
        throw new Error('Binary file content must be a Buffer');
      }

      const wNormalizedPath = normalizeVirtualPath(filePath);
      const wPermissions = permissions ?? 644;

      const wOwner = await wUsersCollection.findOne({ Email: owner });
      if (!wOwner) {
        throw new Error(`Owner ${owner} not found`);
      }
      const wGroup = await wGroupCollection.findOne({ Code: wOwner.Group });
      if (!wGroup) {
        throw new Error(`Group ${wOwner.Group} not found`);
      }

      let wParentId = null;
      if (wNormalizedPath !== '/' && wNormalizedPath.includes('/')) {
        const wParentPath = wNormalizedPath.substring(0, wNormalizedPath.lastIndexOf('/'));
        if (wParentPath !== '') {
          const wParentDir = await wCollection.findOne({
            path: wParentPath,
            isDirectory: true,
          });
          if (!wParentDir) {
            throw new Error(
              `Cannot create file '${name}': Parent directory '${wParentPath}' does not exist`,
            );
          }
          wParentId = wParentDir._id;
        }
      }

      const wFileExist = await wCollection.findOne({ path: wNormalizedPath });
      const wSize = buffer.length;
      let wContent = null;
      let wGridFSId = null;

      if (wSize > MAX_INLINE_SIZE) {
        const wUploadStream = gridFSBucket.openUploadStream(wNormalizedPath, {
          metadata: {
            owner,
            group: wGroup.Code,
            permissions: wPermissions,
            size: wSize,
          },
        });
        await new Promise((resolve, reject) => {
          wUploadStream.on('error', reject);
          wUploadStream.end(buffer, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
        wGridFSId = wUploadStream.id;
      } else {
        wContent = `data:${mimeType};base64,${buffer.toString('base64')}`;
      }

      const wNewFile = {
        name,
        path: wNormalizedPath,
        permissions: wPermissions,
        group: wGroup.Code,
        owner,
        parentId: wParentId,
        content: wContent,
        gridfsId: wGridFSId,
        size: wSize,
        isDirectory: false,
        updatedAt: new Date(),
      };

      if (wFileExist) {
        if (wFileExist.gridfsId) {
          await gridFSBucket.delete(wFileExist.gridfsId);
        }
        await wCollection.updateOne({ path: wNormalizedPath }, { $set: wNewFile });
        return { message: 'success', id: wFileExist._id };
      }

      wNewFile.createdAt = new Date();
      const wInsert = await wCollection.insertOne(wNewFile);
      return { message: 'success', id: wInsert.insertedId };
    }
   
    // Utility function to convert permissions number to Unix format string
   const FormatUnixPermissions = (sPermissions) => {
      if (sPermissions === null || sPermissions === undefined) return '---------';
      
      const getPermString = (n) => {
        let perm = '';
        // Check bits in correct order: 4 (read), 2 (write), 1 (execute)
        perm += (n & 4) ? 'r' : '-';
        perm += (n & 2) ? 'w' : '-';
        perm += (n & 1) ? 'x' : '-';
        return perm;
      };

      // The input should be treated as if it were already in octal format
      // For example: 755 should be treated as 7, 5, 5
      // We need to extract each digit separately
      const wOwner = Math.floor(sPermissions / 100) % 10;
      const wGroup = Math.floor(sPermissions / 10) % 10;
      const wOthers = sPermissions % 10;
      
      return `${getPermString(wOwner)} ${getPermString(wGroup)} ${getPermString(wOthers)}`;
  } ;

    function parseRouteJsonParam(raw) {
      let s = String(raw ?? '');
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          return JSON.parse(s);
        } catch {
          try {
            const next = decodeURIComponent(s);
            if (next === s) {
              break;
            }
            s = next;
          } catch {
            break;
          }
        }
      }
      throw new Error('Invalid JSON parameter');
    }

    async function applyChmodUpdate(sRequest, wObject) {
      const wCollection = fastify.mongo.db.collection('Directory');
      const wId = wObject.id;
      const wPath = wObject.path ? normalizeVirtualPath(wObject.path) : null;
      const wPermissions = wObject.permissions ?? wObject.permission;
      const wUserMail = sRequest.user.userEmail;
      const wGroup = sRequest.user.group;
      const checkPermissions = await createPermissionChecker(fastify.mongo.db);

      let wFile = null;
      if (wId) {
        wFile = await wCollection.findOne({ _id: new ObjectId(String(wId)) });
      } else if (wPath) {
        wFile = await wCollection.findOne({ path: wPath });
      } else {
        return { message: 'error', error: 'Missing file id or path' };
      }

      if (!wFile) {
        return { message: 'error', error: 'File not found' };
      }

      if (wPermissions == null || wPermissions === '') {
        return { message: 'error', error: 'Missing permissions value' };
      }

      if (!checkPermissions(wFile, wUserMail, wGroup, 'write')) {
        return { message: 'error', error: 'Permission denied' };
      }

      const wSharedAccessRaw = wObject.sharedAccess;
      const wUpdate = { $set: { permissions: wPermissions, updatedAt: new Date() } };

      if (wSharedAccessRaw !== undefined) {
        if (!isAdminGroup(wGroup)) {
          return { message: 'error', error: 'Only administrators can configure shared areas' };
        }
        if (!wFile.isDirectory) {
          return { message: 'error', error: 'Shared access applies to directories only' };
        }
        if (
          wSharedAccessRaw === '' ||
          wSharedAccessRaw === null ||
          wSharedAccessRaw === 'off' ||
          wSharedAccessRaw === false
        ) {
          wUpdate.$unset = { sharedAccess: '' };
        } else if (
          wSharedAccessRaw === SKER_SHARED_ACCESS_READ ||
          wSharedAccessRaw === SKER_SHARED_ACCESS_WRITE
        ) {
          wUpdate.$set.sharedAccess = wSharedAccessRaw;
        } else {
          return { message: 'error', error: 'Invalid sharedAccess value' };
        }
      }

      await wCollection.updateOne({ _id: wFile._id }, wUpdate);
      return { message: 'success' };
    }

    // Routes — specific /files/* paths before /files/:id
    fastify.post('/files/chmod', async function (sRequest, sReply) {
      try {
        let wBody = sRequest.body;
        if (typeof wBody === 'string') {
          wBody = JSON.parse(wBody);
        }
        if (!wBody || typeof wBody !== 'object') {
          return sReply.status(400).send({ message: 'error', error: 'Invalid request body' });
        }
        const wResult = await applyChmodUpdate(sRequest, wBody);
        if (wResult.message === 'error') {
          return sReply.status(400).send(wResult);
        }
        return wResult;
      } catch (error) {
        console.error('Error in POST /files/chmod:', error);
        return sReply.status(500).send({ message: 'error', error: error.message });
      }
    });

    fastify.get('/files/chmod/:id', async function (sRequest, sReply) {
      try {
        const wObject = parseRouteJsonParam(sRequest.params.id);
        const wResult = await applyChmodUpdate(sRequest, wObject);
        if (wResult.message === 'error') {
          return sReply.status(400).send(wResult);
        }
        return wResult;
      } catch (error) {
        console.error('Error in GET /files/chmod:', error);
        return sReply.status(400).send({ message: 'error', error: error.message });
      }
    });

    fastify.post('/files', {
      bodyLimit: FILES_UPLOAD_BODY_LIMIT,
      schema: {
        body: SkFileSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              id: { type: ['string', 'object', 'null'] },
              error: { type: ['string', 'null'] }
            }
          }
        }
      },
      preValidation: async (sRequest, sReply) => {
        console.log('\n=== Pre-processing POST /files request ===');
        console.log('Content-Type:', sRequest.headers['content-type']);
        try {
          let rawStr = '';
          if (typeof sRequest.body === 'string') {
            rawStr = sRequest.body;
          } else if (sRequest.body !== undefined && sRequest.body !== null) {
            try { rawStr = JSON.stringify(sRequest.body); } catch { rawStr = String(sRequest.body); }
          }
          const preview = rawStr.length > 50 ? rawStr.substring(0,50) + '…' : rawStr;
          console.log('Raw body (first 50):', preview);
        } catch (e) {
          console.log('Raw body (first 50): [unavailable]', e?.message || e);
        }
        console.log('Body type:', typeof sRequest.body);

        // If body is a string, try to parse it
        if (typeof sRequest.body === 'string') {
          try {
            sRequest.body = JSON.parse(sRequest.body);
          } catch (e) {
            console.error('Error parsing body:', e);
            return sReply.status(400).send({ message: 'error', error: 'Invalid JSON in request body' });
          }
        }

        // If body is undefined, try to read raw body
        if (sRequest.body === undefined) {
          try {
            // Fastify already parsed the body if content-type is application/json
            // Ensure it is an object at this point
            if (!sRequest.body) {
              return sReply.status(400).send({ message: 'error', error: 'Empty request body' });
            }
          } catch (error) {
            console.error('Error reading body:', error);
            return sReply.status(400).send({ message: 'error', error: 'Could not read request body' });
          }
        }
      },
      handler: async function (sRequest, sReply) {
        try {
          console.log('\n=== Processing POST /files request ===');
        

          const wCollection = fastify.mongo.db.collection('Directory')
          
          let wFile = "";
          if (typeof sRequest.body === 'string') {
            try {
              wFile = JSON.parse(sRequest.body);
            } catch (error) {
              console.error('Error parsing file data:', error);
              return sReply.status(400).send({ message: 'error', error: 'Invalid file data format' });
            }
          } else {
            wFile = sRequest.body;
          }
          if (wFile?.path) {
            wFile.path = normalizeVirtualPath(wFile.path);
          }
          const wScopeError = pathScopeErrorForUser(
            wFile.path,
            sRequest.user.userEmail,
            sRequest.user.group
          );
          if (wScopeError) {
            return sReply.status(403).send({ message: 'error', error: wScopeError });
          }
          console.log('Validating schema...');
          
       
          const wDefaultPerms = wFile.isDirectory ? 770 : 600;
          const wPermissions = wFile.permissions ? wFile.permissions : wDefaultPerms;
          console.log('Calculated permissions:', wPermissions);

          const wFileExist = await wCollection.findOne({ path: wFile.path });

          // Search for the owner for find  group in the users collection
          const wUsersCollection = fastify.mongo.db.collection('User');
          console.log('Path:', wFile.path);
          console.log('owner:', wFile.owner);
          console.log('grouo:', wFile.group);
          console.log('permissions:', wPermissions);

          // Fill the owner and group if not present
          const wOwner = await wUsersCollection.findOne({ Email: wFile.owner });
          if (!wOwner) {
            return sReply.status(400).send({ message: 'error', error: `Owner ${wFile.owner} not found` });
          }

          const wGroupCollection = fastify.mongo.db.collection('Group');
          const wGroup = await wGroupCollection.findOne({ Code : wOwner.Group });         
          if (!wGroup) {
            return sReply.status(400).send({ message: 'error', error: `Group ${wOwner.group} not found` });
          }

          // Get parent directory ID if file is not in root
          let wParentId = null;
          if (wFile.path !== '/' && wFile.path.includes('/')) {
            const wParentPath = wFile.path.substring(0, wFile.path.lastIndexOf('/'));
            
            // Si le chemin parent est vide, c'est la racine
            if (wParentPath === '') {
              wParentId = null;
            } else {
              const wParentDir = await wCollection.findOne({ 
                path: wParentPath,
                isDirectory: true 
              });
              if (wParentDir) {
                wParentId = wParentDir._id;
                console.log(`Found parent directory: ${wParentPath} with ID: ${wParentId}`);
              } else {
                console.error(`Parent directory not found: ${wParentPath}`);
                return sReply.status(400).send({ 
                  message: 'error', 
                  error: `Cannot create ${wFile.isDirectory ? 'directory' : 'file'} '${wFile.name}': Parent directory '${wParentPath}' does not exist` 
                });
              }
            }
          }

          // Handle file content based on size
          let wGridFSId = null;
          let wContent = null;
          let wSize = 0;

          if (!wFile.isDirectory && wFile.content) {
            // Determine extension and mime (for inline normalization)
            const binaryExt = ['xlsx','xls','xlsm','xlsb','zip','png','jpg','jpeg','gif','pdf'];
            const mimeByExt = {
              xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              xls: 'application/vnd.ms-excel',
              xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
              xlsb: 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
              zip: 'application/zip',
              png: 'image/png',
              jpg: 'image/jpeg',
              jpeg: 'image/jpeg',
              gif: 'image/gif',
              pdf: 'application/pdf'
            };
            const nameLower = (typeof wFile.name === 'string' ? wFile.name.toLowerCase() : '');
            const ext = nameLower.includes('.') ? nameLower.split('.').pop() : '';
            const isSkerFile = ext === 'sker';
            // Calculate file size from content
            try {
              let wContentForSize = wFile.content;
              if (typeof wContentForSize === 'string' && wContentForSize.startsWith('data:')) {
                wContentForSize = wContentForSize.split(',')[1];
              }
              wSize = calculateVirtualFileContentSize(wContentForSize, ext);
              console.log('File size calculated:', wSize, 'bytes');
              console.log('MAX_INLINE_SIZE:', MAX_INLINE_SIZE, 'bytes');
              console.log('Is file larger than MAX_INLINE_SIZE?', wSize > MAX_INLINE_SIZE);
            } catch (error) {
              console.error('Error calculating file size:', error);
              wSize = 0;
            }
            /* Debug
            if (wFile.path === '/home/abilger@sinequa.com/Downloads/system-backup.tar.gz') {
              console.log('File name:', wFile.name);
              console.log('File size:', wSize);
            }
            */
           
            if (isSkerFile) {
              // .sker payload is stored in Spreadsheet collection (inline JSON or GridFS), not Directory.
              wContent = null;
              wGridFSId = null;
              console.log('Skipping Directory inline/GridFS for .sker (Spreadsheet collection will persist content)');
            } else if (wSize > MAX_INLINE_SIZE) {
              try {
                console.log('File is larger than MAX_INLINE_SIZE, storing in GridFS');
                // Store large file in GridFS
                const wUploadStream = gridFSBucket.openUploadStream(wFile.path, {
                  metadata: {
                    owner: wFile.owner,
                    group: wFile.group,
                    permissions: wPermissions,
                    size: wSize  // Store actual size in metadata
                  }
                });
                
                // Recompute buffer to ensure valid scope
                let wContentForBuffer = wFile.content;
                if (typeof wContentForBuffer === 'string' && wContentForBuffer.startsWith('data:')) {
                  wContentForBuffer = wContentForBuffer.split(',')[1];
                }
                const wBufferToWrite = Buffer.isBuffer(wContentForBuffer)
                  ? wContentForBuffer
                  : (binaryExt.includes(ext)
                    ? Buffer.from(wContentForBuffer, 'base64')
                    : Buffer.from(wContentForBuffer, 'utf8'));
                await new Promise((resolve, reject) => {
                  wUploadStream.on('error', reject);
                  wUploadStream.end(wBufferToWrite, (error) => {
                    if (error) reject(error);
                    else resolve();
                  });
                });
                
                wGridFSId = wUploadStream.id;
                console.log('File stored in GridFS with ID:', wGridFSId, 'Size:', wSize);
              } catch (wError) {
                const wErrorMessage = `❌ Error storing file in GridFS: ${wError}`;
                throw new Error(wErrorMessage);
              }
            } else {
              // Store small file inline
              // Normalize to data URL for binary extensions to preserve integrity
              if (typeof wFile.content === 'string') {
                if (wFile.content.startsWith('data:')) {
                  wContent = wFile.content;
                } else if (binaryExt.includes(ext)) {
                  const mime = mimeByExt[ext] || 'application/octet-stream';
                  wContent = `data:${mime};base64,${wFile.content}`;
                } else {
                  // text content as-is
                  wContent = wFile.content;
                }
              } else {
                wContent = wFile.content;
              }
              console.log('File stored inline (size:', wSize, 'bytes)');
            }
          } else if (wFile.isDirectory) {
            wSize = 0;  // Directories have size 0
            console.log('Directory created with size 0');
          }

          // Special handling for .sker files via shared util
          let wRecordId = null;
          let wInfoObject = null;
          if (!wFile.isDirectory && typeof wFile.name === 'string' && wFile.name.toLowerCase().endsWith('.sker')) {
            try {
              const { recordId, info, spreadsheetData, size: skerSize } = await saveSkerToCollections(
                fastify,
                wFileExist,
                wFile.path,
                typeof wContent !== 'undefined' && wContent !== null ? wContent : wFile.content
              )
              if (recordId) {
                wRecordId = recordId
                wInfoObject = info
                wContent = null
                wGridFSId = null
                if (skerSize) { wSize = skerSize }
              }
            } catch (wErrSker) {
              console.error('Error handling .sker content:', wErrSker);
              return sReply.status(400).send({ message: 'error', error: wErrSker.message });
            }
          }

          const wNewFile = {
            ...wFile,
            permissions: wPermissions,
            group: wGroup.Code,
            parentId: wParentId,
            content: wContent,
            gridfsId: wGridFSId,
            size: wSize,
            // For .sker files, store metadata and a reference to Spreadsheet record
            ...(wInfoObject ? { info: wInfoObject } : {}),
            ...(wRecordId ? { record: wRecordId } : {}),
            createdAt: new Date(),
            updatedAt: new Date()
          }

          if (wFileExist) {
            try {
              const checkPermissions = await createPermissionChecker(fastify.mongo.db);
              const wUserEmail = sRequest.user.userEmail;
              const wUserGroup = sRequest.user.group;
              if (!checkPermissions(wFileExist, wUserEmail, wUserGroup, 'write')) {
                return sReply.status(403).send({ message: 'error', error: 'Permission denied' });
              }
              if (
                !wFile.isDirectory &&
                typeof wFile.name === 'string' &&
                wFile.name.toLowerCase().endsWith('.html')
                || wFile.name.toLowerCase().endsWith('.htm')
              ) {
                try {
                  await assertDocumentLockForWrite(fastify.mongo.db, wFile.path, wUserEmail);
                } catch (lockErr) {
                  return sReply.status(lockErr.statusCode || 409).send({
                    message: 'error',
                    error: lockErr.message,
                    code: lockErr.code,
                    lock: lockErr.lock,
                  });
                }
              }

              // If updating a file that was in GridFS, delete the old chunks
              if (wFileExist.gridfsId) {
                await gridFSBucket.delete(wFileExist.gridfsId);
              }
              
              const wResultUpdate = await wCollection.updateOne(
                { path: wFile.path }, 
                { $set: wNewFile }
              );
              console.log('Update result:', wResultUpdate);
              if (!wFile.isDirectory && typeof wFile.name === 'string' && wFile.name.toLowerCase().endsWith('.sker')) {
                await invalidateSkeeptoCacheForPath(wFile.path);
              }
              let wResult = {
                message: 'success',
                id: wFileExist._id
              };
              console.log('Response sent:', wResult);
              return sReply.send(wResult);
            } catch (sError) {
              console.error('Error updating file:', sError);
              return sReply.status(500).send({ message: 'error', error: sError.message });
            }
          }

          console.log('File to insert:')
          console.log('Name:', JSON.stringify(wNewFile.name, null, 2));
          console.log('Path', JSON.stringify(wNewFile.path, null, 2));
          try {
            let contentStr = '';
            if (typeof wNewFile.content === 'string') {
              contentStr = wNewFile.content;
            } else if (wNewFile.content !== undefined && wNewFile.content !== null) {
              try { contentStr = JSON.stringify(wNewFile.content); } catch { contentStr = String(wNewFile.content); }
            }
            const preview = contentStr.length > 50 ? contentStr.substring(0,50) + '…' : contentStr;
            console.log('Content (first 50):', preview);
          } catch (e) {
            console.log('Content (first 50): [unavailable]', e?.message || e);
          }
          console.log('GridFSId:', JSON.stringify(wNewFile.gridfsId, null, 2));
          console.log('Size:', JSON.stringify(wNewFile.size, null, 2));
          console.log('Info:', JSON.stringify(wNewFile.info, null, 2));
          console.log('Record:', JSON.stringify(wNewFile.record, null, 2));
          console.log('CreatedAt:', JSON.stringify(wNewFile.createdAt, null, 2));
          console.log('UpdatedAt:', JSON.stringify(wNewFile.updatedAt, null, 2));
          

          const result = await wCollection.insertOne(wNewFile);
          console.log('Insertion result:', result);

          if (!wFile.isDirectory && typeof wFile.name === 'string' && wFile.name.toLowerCase().endsWith('.sker')) {
            await invalidateSkeeptoCacheForPath(wFile.path);
          }

          let wResult = {
            message: 'success',
            id: result.insertedId
          };
          console.log('Response sent:', wResult);
          return sReply.send(wResult);
        } catch (error) {
          console.error('Error creating file:', error);
          return sReply.status(500).send({ message: 'error', error: error.message });
        }
      }
    })

    fastify.post('/files/new-spreadsheet', {
      preValidation: async (sRequest, sReply) => {
        try {
          if (typeof sRequest.body === 'string') {
            sRequest.body = JSON.parse(sRequest.body);
          }
          if (!sRequest.body || typeof sRequest.body !== 'object') {
            return sReply.status(400).send({ message: 'error', error: 'Invalid request body' });
          }
        } catch (e) {
          return sReply.status(400).send({ message: 'error', error: 'Invalid JSON in request body' });
        }
      },
      handler: async function (sRequest, sReply) {
        try {
          const wCollection = fastify.mongo.db.collection('Directory');
          const wBody = sRequest.body;
          const wPath = typeof wBody.path === 'string' ? wBody.path.trim() : '';
          const wName = typeof wBody.name === 'string' && wBody.name.trim()
            ? wBody.name.trim()
            : (wPath.includes('/') ? wPath.split('/').pop() : wPath);

          if (!wPath || !wName) {
            return sReply.status(400).send({ message: 'error', error: 'path and name are required' });
          }
          if (!wName.toLowerCase().endsWith('.sker')) {
            return sReply.status(400).send({ message: 'error', error: 'File must have .sker extension' });
          }

          const wExist = await wCollection.findOne({ path: wPath });
          if (wExist) {
            return sReply.status(400).send({ message: 'error', error: 'File already exists' });
          }

          if (wPath !== '/' && wPath.includes('/')) {
            const wParentPath = wPath.substring(0, wPath.lastIndexOf('/'));
            if (wParentPath !== '') {
              const wParentDir = await wCollection.findOne({
                path: wParentPath,
                isDirectory: true,
              });
              if (!wParentDir) {
                return sReply.status(400).send({
                  message: 'error',
                  error: `Cannot create file '${wName}': Parent directory '${wParentPath}' does not exist`,
                });
              }
            }
          }

          const wOwnerEmail = wBody.owner || sRequest.user?.userEmail;
          const wGroup = wBody.group || sRequest.user?.group;
          if (!wOwnerEmail) {
            return sReply.status(400).send({ message: 'error', error: 'Owner is required' });
          }

          const wUsersCollection = fastify.mongo.db.collection('User');
          const wOwnerDoc = await wUsersCollection.findOne({ Email: wOwnerEmail });
          if (!wOwnerDoc) {
            return sReply.status(400).send({ message: 'error', error: `Owner ${wOwnerEmail} not found` });
          }
          const wAuthorName = `${String(wOwnerDoc.Name || '').trim()} ${String(wOwnerDoc.FirstName || '').trim()}`.trim();

          let wSkSpreadSheet;
          try {
            wSkSpreadSheet = dependenciesContainer.resolve('SkSpreadSheet');
          } catch (_) {
            return sReply.status(503).send({ message: 'error', error: 'Spreadsheet engine not available' });
          }

          let wJsonContent;
          try {
            wJsonContent = await wSkSpreadSheet.createNewWorkBookJson(wPath, {
              author: wAuthorName,
              email: wOwnerEmail,
            });
          } catch (createError) {
            console.error('createNewWorkBookJson failed:', createError);
            return sReply.status(500).send({
              message: 'error',
              error: createError?.message || 'Failed to create workbook',
            });
          }

          const injectHeaders = {
            'content-type': 'application/json',
            authorization: sRequest.headers.authorization || '',
          };
          const postBody = {
            name: wName,
            path: wPath,
            content: wJsonContent,
            owner: wOwnerEmail,
            group: wGroup,
            isDirectory: false,
            permissions: wBody.permissions ?? 770,
          };

          const injectRes = await fastify.inject({
            method: 'POST',
            url: '/files',
            headers: injectHeaders,
            payload: JSON.stringify(postBody),
          });

          let injected;
          try {
            injected = JSON.parse(injectRes.body || '{}');
          } catch {
            injected = { message: 'error', error: 'Invalid response from /files' };
          }

          if (injectRes.statusCode >= 400 || injected.message === 'error') {
            return sReply.status(injectRes.statusCode >= 400 ? injectRes.statusCode : 500).send({
              message: 'error',
              error: injected.error || 'Failed to persist spreadsheet',
            });
          }

          return sReply.send({
            message: 'success',
            id: injected.id,
            path: wPath,
            name: wName,
          });
        } catch (error) {
          console.error('Error creating new spreadsheet:', error);
          return sReply.status(500).send({ message: 'error', error: error.message });
        }
      },
    });

    const DEFAULT_TEXT_DOCUMENT = '';

    fastify.post('/files/new-document', {
      preValidation: async (sRequest, sReply) => {
        try {
          if (typeof sRequest.body === 'string') {
            sRequest.body = JSON.parse(sRequest.body);
          }
          if (!sRequest.body || typeof sRequest.body !== 'object') {
            return sReply.status(400).send({ message: 'error', error: 'Invalid request body' });
          }
        } catch (e) {
          return sReply.status(400).send({ message: 'error', error: 'Invalid JSON in request body' });
        }
      },
      handler: async function (sRequest, sReply) {
        try {
          const wCollection = fastify.mongo.db.collection('Directory');
          const wBody = sRequest.body;
          const wPath = typeof wBody.path === 'string' ? wBody.path.trim() : '';
          const wName = typeof wBody.name === 'string' && wBody.name.trim()
            ? wBody.name.trim()
            : (wPath.includes('/') ? wPath.split('/').pop() : wPath);

          if (!wPath || !wName) {
            return sReply.status(400).send({ message: 'error', error: 'path and name are required' });
          }
          if (!wName.toLowerCase().endsWith('.html')) {
            return sReply.status(400).send({ message: 'error', error: 'File must have .html extension' });
          }

          const wExist = await wCollection.findOne({ path: wPath });
          if (wExist) {
            return sReply.status(400).send({ message: 'error', error: 'File already exists' });
          }

          if (wPath !== '/' && wPath.includes('/')) {
            const wParentPath = wPath.substring(0, wPath.lastIndexOf('/'));
            if (wParentPath !== '') {
              const wParentDir = await wCollection.findOne({
                path: wParentPath,
                isDirectory: true,
              });
              if (!wParentDir) {
                return sReply.status(400).send({
                  message: 'error',
                  error: `Cannot create file '${wName}': Parent directory '${wParentPath}' does not exist`,
                });
              }
            }
          }

          const wOwnerEmail = wBody.owner || sRequest.user?.userEmail;
          const wGroup = wBody.group || sRequest.user?.group;
          if (!wOwnerEmail) {
            return sReply.status(400).send({ message: 'error', error: 'Owner is required' });
          }

          const wUsersCollection = fastify.mongo.db.collection('User');
          const wOwnerDoc = await wUsersCollection.findOne({ Email: wOwnerEmail });
          if (!wOwnerDoc) {
            return sReply.status(400).send({ message: 'error', error: `Owner ${wOwnerEmail} not found` });
          }

          const injectHeaders = {
            'content-type': 'application/json',
            authorization: sRequest.headers.authorization || '',
          };
          const postBody = {
            name: wName,
            path: wPath,
            content: DEFAULT_TEXT_DOCUMENT,
            owner: wOwnerEmail,
            group: wGroup,
            isDirectory: false,
            permissions: wBody.permissions ?? 770,
          };

          const injectRes = await fastify.inject({
            method: 'POST',
            url: '/files',
            headers: injectHeaders,
            payload: JSON.stringify(postBody),
          });

          let injected;
          try {
            injected = JSON.parse(injectRes.body || '{}');
          } catch {
            injected = { message: 'error', error: 'Invalid response from /files' };
          }

          if (injectRes.statusCode >= 400 || injected.message === 'error') {
            return sReply.status(injectRes.statusCode >= 400 ? injectRes.statusCode : 500).send({
              message: 'error',
              error: injected.error || 'Failed to persist document',
            });
          }

          return sReply.send({
            message: 'success',
            id: injected.id,
            path: wPath,
            name: wName,
          });
        } catch (error) {
          console.error('Error creating new document:', error);
          return sReply.status(500).send({ message: 'error', error: error.message });
        }
      },
    });

    fastify.post('/files/lock', {
      handler: async function (sRequest, sReply) {
        try {
          let wBody = sRequest.body;
          if (typeof wBody === 'string') {
            wBody = JSON.parse(wBody);
          }
          const wPath = normalizeVirtualPath(typeof wBody?.path === 'string' ? wBody.path.trim() : '');
          const wUserEmail = sRequest.user?.userEmail;
          const wGroup = sRequest.user?.group;

          if (!wPath) {
            return sReply.status(400).send({ message: 'error', error: 'path is required' });
          }
          const wScopeError = pathScopeErrorForUser(wPath, wUserEmail, wGroup);
          if (wScopeError) {
            return sReply.status(403).send({ message: 'error', error: wScopeError });
          }
          if (!isTextEditorDocumentPath(wPath)) {
            return sReply.status(400).send({ message: 'error', error: 'Lock applies to .html files only' });
          }

          const wCollection = fastify.mongo.db.collection('Directory');
          const wFile = await wCollection.findOne({ path: wPath, isDirectory: false });
          if (!wFile) {
            return sReply.status(404).send({ message: 'error', error: 'File not found' });
          }

          const checkPermissions = await createPermissionChecker(fastify.mongo.db);
          if (!checkPermissions(wFile, wUserEmail, wGroup, 'write')) {
            return sReply.status(403).send({ message: 'error', error: 'Permission denied' });
          }

          const result = await acquireDocumentLock(fastify.mongo.db, wPath, wUserEmail);
          if (!result.ok) {
            return sReply.status(result.status || 409).send({
              message: 'error',
              error: result.error,
              lock: result.lock,
            });
          }

          return sReply.send({
            message: 'success',
            lock: result.lock,
          });
        } catch (error) {
          console.error('Error acquiring document lock:', error);
          return sReply.status(500).send({ message: 'error', error: error.message });
        }
      },
    });

    fastify.delete('/files/lock', {
      handler: async function (sRequest, sReply) {
        try {
          let wBody = sRequest.body;
          if (typeof wBody === 'string') {
            wBody = JSON.parse(wBody);
          }
          const wPath = normalizeVirtualPath(typeof wBody?.path === 'string' ? wBody.path.trim() : '');
          const wUserEmail = sRequest.user?.userEmail;

          if (!wPath) {
            return sReply.status(400).send({ message: 'error', error: 'path is required' });
          }

          const result = await releaseDocumentLock(fastify.mongo.db, wPath, wUserEmail);
          if (!result.ok) {
            return sReply.status(result.status || 409).send({
              message: 'error',
              error: result.error,
              lock: result.lock,
            });
          }

          return sReply.send({
            message: 'success',
            released: result.released,
          });
        } catch (error) {
          console.error('Error releasing document lock:', error);
          return sReply.status(500).send({ message: 'error', error: error.message });
        }
      },
    });

    fastify.get('/files/lock/:id', async function (sRequest, sReply) {
      try {
        const wQueryObj = JSON.parse(decodeURIComponent(sRequest.params.id));
        const wPath = normalizeVirtualPath(wQueryObj?.path);
        if (!wPath) {
          return sReply.status(400).send({ message: 'error', error: 'path is required' });
        }

        const lock = await getDocumentLock(fastify.mongo.db, wPath);
        return sReply.send({
          message: 'success',
          locked: Boolean(lock),
          lock: lock || null,
        });
      } catch (error) {
        console.error('Error reading document lock:', error);
        return sReply.status(400).send({ message: 'error', error: error.message });
      }
    });

    fastify.get('/files/:id', async function(sRequest, sReply)  {
      const wCollection = fastify.mongo.db.collection('Directory')
      const wQuery =sRequest.params.id
      // decode the query
      const wQueryObj = JSON.parse(decodeURIComponent(wQuery))
      const wUserEmail = sRequest.user.userEmail
      const wGroup = sRequest.user.group
      const checkPermissions = await createPermissionChecker(fastify.mongo.db)

      const wFile = await wCollection.findOne(wQueryObj)
      
      if (!wFile) {
        return({ message: 'error', error: 'File not found' })
      }

      if (!checkPermissions(wFile, wUserEmail,wGroup, 'read')) {
        return({ message: 'error', error: 'Permission denied' })
      }

      // Stream file bytes only when the client explicitly asks to download.
      // Default GET /files is metadata (chmod, loadFile) and must stay JSON —
      // otherwise a 56MB xlsx stream is parsed as JSON and the UI reports upload failure.
      const wWantDownload = sRequest.query?.download === '1' || sRequest.query?.download === 'true';
      if (wWantDownload) {
        try {
          const ext = virtualFileExtension(wFile);
          const fileName = wFile.name || 'download';
          // .sker lives in Spreadsheet (+ GridFS via record), not Directory.gridfsId.
          // Directory.gridfsId can be stale; opening already ignores it.
          // Send octet-stream so the browser does not treat the body as the JSON API wrapper.
          if (isSkerVirtualFile(wFile)) {
            const rebuilt = await rebuildSkerContentFromRecord(fastify, wFile);
            if (!rebuilt?.content) {
              return sReply.status(404).send({ message: 'error', error: 'Workbook content not found' });
            }
            sReply.header('Content-Type', 'application/octet-stream');
            sReply.header('Content-Disposition', attachmentContentDisposition(fileName));
            return sReply.send(rebuilt.content);
          }

          if (wFile.gridfsId) {
            const downloadStream = gridFSBucket.openDownloadStream(wFile.gridfsId);
            downloadStream.on('error', (err) => {
              console.error('GridFS download error:', err);
              if (!sReply.raw.headersSent) {
                sReply.status(404).send({ message: 'error', error: 'File content not found' });
              }
            });
            sReply.header('Content-Type', DOWNLOAD_MIME_BY_EXT[ext] || 'application/octet-stream');
            sReply.header('Content-Disposition', attachmentContentDisposition(fileName));
            return sReply.send(downloadStream);
          }

          const payload = decodeInlineDownloadContent(wFile.content);
          if (payload == null) {
            return sReply.status(404).send({ message: 'error', error: 'File content not found' });
          }
          sReply.header('Content-Type', DOWNLOAD_MIME_BY_EXT[ext] || 'application/octet-stream');
          sReply.header('Content-Disposition', attachmentContentDisposition(fileName));
          return sReply.send(payload);
        } catch (downloadErr) {
          console.error('Error preparing file download:', downloadErr);
          return sReply.status(500).send({
            message: 'error',
            error: downloadErr?.message || 'Download failed',
          });
        }
      }
      
      // Rebuild content for .sker files from Spreadsheet if needed (shared util)
      try {
        if (!wFile.isDirectory && typeof wFile.name === 'string' && wFile.name.toLowerCase().endsWith('.sker')) {
          const rebuilt = await rebuildSkerContentFromRecord(fastify, wFile)
          if (rebuilt && rebuilt.content) {
            wFile.content = rebuilt.content
            if (rebuilt.size) { wFile.size = rebuilt.size }
          }
        }
      } catch (wErrGetSker) {
        console.error('Error rebuilding .sker content:', wErrGetSker);
        let wResult={ message: 'error', error: wErrGetSker };
        return wResult
      }

      let wResult={}
      wResult.message='success'
      wResult.file=wFile
      return wResult
    })

    fastify.get('/files/access/:id', async function (sRequest, sReply) {
      const wCollection = fastify.mongo.db.collection('Directory');
      const wQueryObj = JSON.parse(decodeURIComponent(sRequest.params.id));
      const wUserEmail = sRequest.user.userEmail;
      const wGroup = sRequest.user.group;
      const checkPermissions = await createPermissionChecker(fastify.mongo.db);

      const wFile = await wCollection.findOne(wQueryObj);
      if (!wFile) {
        return sReply.status(404).send({ message: 'error', error: 'File not found' });
      }

      const wCanRead = checkPermissions(wFile, wUserEmail, wGroup, 'read');
      const wCanWrite = checkPermissions(wFile, wUserEmail, wGroup, 'write');

      console.log(
        `Access check ${wFile.path}: user=${wUserEmail} owner=${wFile.owner} ` +
        `perms=${wFile.permissions} canRead=${wCanRead} canWrite=${wCanWrite}`
      );

      if (!wCanRead) {
        return sReply.status(403).send({
          message: 'error',
          error: 'Permission denied',
          canRead: false,
          canWrite: false,
          path: wFile.path,
        });
      }

      return {
        message: 'success',
        canRead: true,
        canWrite: wCanWrite,
        path: wFile.path,
        name: wFile.name,
        group: wFile.group,
        owner: wFile.owner,
        permissions: wFile.permissions,
      };
    });

    // Delete file or directory
    fastify.delete('/files/:id', async function(sRequest, sReply) {
      try {
        const wCollection = fastify.mongo.db.collection('Directory')
        const wUserId = sRequest.user?.userEmail;
        // Search the user in the users collection
        const wUsersCollection = fastify.mongo.db.collection('User');
        const wUser = await wUsersCollection.findOne({ Email: wUserId });
        if (!wUser) {
          return({ message: 'error', error: 'User not found' })
        }
        const wGroup = sRequest.user?.group || wUser.Group;
        const checkPermissions = await createPermissionChecker(fastify.mongo.db);
        const wQuery = decodeURIComponent(sRequest.params.id)

        // Find the file/directory to delete
        const file = await wCollection.findOne(JSON.parse(wQuery))
        
        if (!file) {
          return({ message: 'error', error: 'File not found' })
        }

     
        // Check if user has permission to delete
        if (!checkPermissions(file, wUserId,wGroup, 'write')) {
          return({ message: 'error', error: 'Permission denied' })
        }
        

        if (file.isDirectory) {
          // If it's a directory, delete the directory and all children 
          const children = await wCollection.find({ 
            path: { 
              $regex: `^${file.path}($|/)` 
            }
          }).toArray()

          // Delete all children and the directory itself
          for (const child of children) {
            if (child.gridfsId) {
              await gridFSBucket.delete(child.gridfsId);
            }
            await wCollection.deleteOne({ _id: child._id })
          }
        } else {
          // If file is in GridFS, delete its chunks
          if (file.gridfsId) {
            await gridFSBucket.delete(file.gridfsId);
          }
          // Delete the file itself
          const wResult = await wCollection.deleteOne(JSON.parse(wQuery))
          if (wResult.deletedCount === 0) {
            return({ message: 'error', error: 'File not found' })
          }
        }

     
        
        return({ message: 'success'})
      } catch (error) {
        console.error('Error deleting file:', error)
        return({ message: 'error', error: error.message });
      }
    })

    // Rename or move a file/directory (destination must not already exist)
    fastify.post('/files/rename', async function (sRequest, sReply) {
      try {
        const wCollection = fastify.mongo.db.collection('Directory')

        let wBody = sRequest.body
        if (typeof wBody === 'string') {
          try {
            wBody = JSON.parse(wBody)
          } catch {
            return sReply.status(400).send({ message: 'error', error: 'Invalid JSON in request body' })
          }
        }
        if (!wBody || typeof wBody !== 'object') {
          return sReply.status(400).send({ message: 'error', error: 'Missing request body' })
        }

        const wOldPath = normalizeVirtualPath(wBody.oldPath)
        const wNewPath = normalizeVirtualPath(wBody.newPath)
        if (!wOldPath || !wNewPath || typeof wOldPath !== 'string' || typeof wNewPath !== 'string') {
          return sReply.status(400).send({ message: 'error', error: 'oldPath and newPath are required' })
        }
        if (wOldPath === '/') {
          return sReply.status(400).send({ message: 'error', error: 'Cannot rename the root directory' })
        }
        if (wOldPath === wNewPath) {
          return sReply.status(400).send({ message: 'error', error: 'Source and destination are identical' })
        }

        // Resolve the caller and derive the effective group.
        const wUserEmail = sRequest.user?.userEmail
        const wUsersCollection = fastify.mongo.db.collection('User')
        const wUser = await wUsersCollection.findOne({ Email: wUserEmail })
        if (!wUser) {
          return sReply.status(400).send({ message: 'error', error: 'User not found' })
        }
        const wGroup = sRequest.user?.group || wUser.Group

        // Both endpoints of the rename must stay inside the caller's allowed scope.
        const wOldScopeError = pathScopeErrorForUser(wOldPath, wUserEmail, wGroup)
        if (wOldScopeError) {
          return sReply.status(403).send({ message: 'error', error: wOldScopeError })
        }
        const wNewScopeError = pathScopeErrorForUser(wNewPath, wUserEmail, wGroup)
        if (wNewScopeError) {
          return sReply.status(403).send({ message: 'error', error: wNewScopeError })
        }

        // A directory cannot be moved inside itself or one of its descendants.
        if (wNewPath.startsWith(`${wOldPath}/`)) {
          return sReply.status(400).send({ message: 'error', error: 'Cannot move a directory into itself' })
        }

        const wFile = await wCollection.findOne({ path: wOldPath })
        if (!wFile) {
          return sReply.status(404).send({ message: 'error', error: 'File not found' })
        }

        const checkPermissions = await createPermissionChecker(fastify.mongo.db)
        if (!checkPermissions(wFile, wUserEmail, wGroup, 'write')) {
          return sReply.status(403).send({ message: 'error', error: 'Permission denied' })
        }

        // Conflict policy: refuse when the destination already exists.
        const wDestExist = await wCollection.findOne({ path: wNewPath })
        if (wDestExist) {
          return sReply.status(409).send({ message: 'error', error: 'Destination already exists' })
        }

        // The destination parent directory must exist (except at the virtual root).
        let wNewParentId = null
        const wNewParentPath = wNewPath.substring(0, wNewPath.lastIndexOf('/'))
        if (wNewParentPath !== '') {
          const wNewParentDir = await wCollection.findOne({ path: wNewParentPath, isDirectory: true })
          if (!wNewParentDir) {
            return sReply.status(400).send({ message: 'error', error: `Parent directory '${wNewParentPath}' does not exist` })
          }
          wNewParentId = wNewParentDir._id
        }

        // A text document (.html/.htm) held by another user must not be renamed.
        if (!wFile.isDirectory && isTextEditorDocumentPath(wOldPath)) {
          try {
            await assertDocumentLockForWrite(fastify.mongo.db, wOldPath, wUserEmail)
          } catch (lockErr) {
            return sReply.status(lockErr.statusCode || 409).send({
              message: 'error',
              error: lockErr.message,
              code: lockErr.code,
              lock: lockErr.lock,
            })
          }
        }

        // Refuse the rename while the workbook is open in a live collaboration session.
        const wCollaborators = activeCollaboratorsForPath(wOldPath)
        if (wCollaborators.length > 0) {
          return sReply.status(409).send({
            message: 'error',
            error: `Cannot rename: the workbook is open in collaboration (${wCollaborators.length} active user(s)).`,
          })
        }
        // For a directory, also refuse if any workbook it contains is open in collaboration.
        if (wFile.isDirectory) {
          const wEscapedOldCheck = wOldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const wDescendants = await wCollection
            .find({ path: { $regex: `^${wEscapedOldCheck}/` }, isDirectory: { $ne: true } })
            .toArray()
          for (const wChild of wDescendants) {
            if (activeCollaboratorsForPath(wChild.path).length > 0) {
              return sReply.status(409).send({
                message: 'error',
                error: `Cannot rename: a workbook inside this folder is open in collaboration (${wChild.path}).`,
              })
            }
          }
        }

        const wHistoryCollection = fastify.mongo.db.collection('SpreadsheetHistory')
        const wNewName = path.posix.basename(wNewPath)
        const wNow = new Date()

        // Rename the target node itself.
        await wCollection.updateOne(
          { _id: wFile._id },
          { $set: { path: wNewPath, name: wNewName, parentId: wNewParentId, updatedAt: wNow } }
        )
        await wHistoryCollection.updateMany({ path: wOldPath }, { $set: { path: wNewPath } })
        await invalidateSkeeptoCacheForPath(wOldPath)

        // For a directory, re-base every descendant path from oldPath onto newPath.
        if (wFile.isDirectory) {
          const wEscapedOld = wOldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const wChildren = await wCollection
            .find({ path: { $regex: `^${wEscapedOld}/` } })
            .toArray()
          // Shallowest first so each child's new parent already exists when we look it up.
          wChildren.sort((a, b) => a.path.length - b.path.length)
          for (const wChild of wChildren) {
            const wChildOldPath = wChild.path
            const wChildNewPath = wNewPath + wChildOldPath.substring(wOldPath.length)
            const wChildParentPath = wChildNewPath.substring(0, wChildNewPath.lastIndexOf('/'))
            let wChildParentId = wNewParentId
            const wChildParentDir = await wCollection.findOne({ path: wChildParentPath, isDirectory: true })
            if (wChildParentDir) {
              wChildParentId = wChildParentDir._id
            }
            await wCollection.updateOne(
              { _id: wChild._id },
              { $set: { path: wChildNewPath, parentId: wChildParentId, updatedAt: wNow } }
            )
            await wHistoryCollection.updateMany({ path: wChildOldPath }, { $set: { path: wChildNewPath } })
            await invalidateSkeeptoCacheForPath(wChildOldPath)
          }
        }

        const wUpdated = await wCollection.findOne({ _id: wFile._id })
        return sReply.send({ message: 'success', file: wUpdated })
      } catch (error) {
        console.error('Error renaming file:', error)
        return sReply.status(500).send({ message: 'error', error: error.message })
      }
    })

    // List directory contents
    fastify.get('/files/list/:path', async function(sRequest, sReply) {
        try {
            const wCollection = fastify.mongo.db.collection('Directory');
            let wPath = decodeURIComponent(sRequest.params.path);
            const wUserEmail = decodeURIComponent(sRequest.user.userEmail);
            const wGroup = decodeURIComponent(sRequest.user.group);
            const checkPermissions = await createPermissionChecker(fastify.mongo.db);

            console.log('Listing directory:', wPath);

            if (wPath === '/') {
              wPath = ''
            }

            const wListScopeError = pathScopeErrorForUser(wPath || '/', wUserEmail, wGroup);
            if (wListScopeError) {
              return { message: 'error', error: wListScopeError };
            }

            // Find all files and directories in the specified path
            const files = await wCollection.find({ 
                path: { 
                   $regex: `^${wPath}($|/)` 
                }
            }).toArray();

            // Filter files based on permissions
            const accessibleFiles = files.filter(file => {
                return checkPermissions(file, wUserEmail,wGroup, 'read');
            });

            // Group files by directory
            const result = {
                message: 'success',
                currentPath: wPath,
                contents: accessibleFiles.map(file => ({
                    name: file.name,
                    path: file.path,
                    isDirectory: file.isDirectory,
                    owner: file.owner,
                    group: file.group,
                    permissions: file.permissions,
                    createdAt: file.createdAt,
                    updatedAt: file.updatedAt
                }))
            };

            return result;
        } catch (error) {
            console.error('Error listing directory:', error);
            return({ message: 'error', error: 'Failed to list directory contents' });
        }
    });

    // List admin-declared shared directory roots
    fastify.get('/files/shared-areas', async function (sRequest, sReply) {
      const wGroup = sRequest.user.group;
      if (!isAdminGroup(wGroup)) {
        return sReply.status(403).send({ message: 'error', error: 'Admin only' });
      }
      const roots = await loadSharedDirectoryRoots(fastify.mongo.db);
      return {
        message: 'success',
        areas: roots.map((r) => ({
          path: r.path,
          sharedAccess: r.sharedAccess,
        })),
      };
    });

    // Get complete file tree
    fastify.get('/files/tree', async function(sRequest, sReply) {
        try {
            const wUserEmail = sRequest.user.userEmail;
            const wGroup = sRequest.user.group;
            const wCollection = fastify.mongo.db.collection('Directory');
            const checkPermissions = await createPermissionChecker(fastify.mongo.db);

            // Function to build tree structure
            const buildTreeNode = async (item) => {
                let wSize = item.size || 0;

                if (!item.isDirectory && item.gridfsId) {
                    try {
                        const wGridFSFile = await gridFSBucket.find({ _id: item.gridfsId }).toArray();
                        if (wGridFSFile.length > 0) {
                            wSize = wGridFSFile[0].length;
                        }
                    } catch (error) {
                        console.error('Error getting GridFS file size:', error);
                    }
                }

                const node = {
                    name: item.name,
                    path: item.path,
                    isDirectory: item.isDirectory,
                    owner: item.owner,
                    group: item.group,
                    permissions: item.permissions,
                    sharedAccess: item.sharedAccess || null,
                    size: wSize,
                    createdAt: item.createdAt,
                    updatedAt: item.updatedAt,
                };

                if (item.isDirectory) {
                    node.children = await buildTree(item._id);
                }

                return node;
            };

            const buildTree = async (parentId = null) => {
                const tree = [];

                const query = { parentId: parentId };
                const currentItems = await wCollection.find(query).toArray();

                currentItems.sort((a, b) => {
                    if (a.isDirectory && !b.isDirectory) return -1;
                    if (!a.isDirectory && b.isDirectory) return 1;
                    return a.name.localeCompare(b.name);
                });

                for (const item of currentItems) {
                    if (!checkPermissions(item, wUserEmail, wGroup, 'read')) {
                        continue;
                    }
                    tree.push(await buildTreeNode(item));
                }

                return tree;
            };

            let tree = [];
            let scopePath = null;

            if (!isAdminGroup(wGroup)) {
              scopePath = userHomeDirectoryPath(wUserEmail);
              const visibleRoots = [...getGlobalSharedDirectoryPaths(), scopePath];

              for (const rootPath of visibleRoots) {
                const rootDir = await wCollection.findOne({
                  path: rootPath,
                  isDirectory: true,
                });
                if (!rootDir || !checkPermissions(rootDir, wUserEmail, wGroup, 'read')) {
                  continue;
                }
                tree.push(await buildTreeNode(rootDir));
              }
            } else {
              tree = await buildTree(null);
            }

            return {
                message: 'success',
                tree: tree,
                scopePath,
            };
        } catch (error) {
            console.error('Error building file tree:', error);
            return({ message: 'error', error: 'Failed to build file tree' });
        }
    });

    // Download file from MongoDB to disk
    fastify.get('/files/download/:id', async function(sRequest, sReply) {
        try {
            const wCollection = fastify.mongo.db.collection('Directory');
            const wQuery = sRequest.params.id;
            const wQueryObj = JSON.parse(decodeURIComponent(wQuery));
            const wUserId = sRequest.user?.userEmail || sRequest.headers['user-id'];
            const wGroup = sRequest.user?.group || sRequest.headers['group'];
            const checkPermissions = await createPermissionChecker(fastify.mongo.db);
            // Use local tmp directory
            const wDownloadPath = path.join(process.cwd(), sRequest.query.path || 'tmp');

            // Find the file in MongoDB
            const file = await wCollection.findOne(wQueryObj);
            
            if (!file) {
                return { message: 'error', error: 'File not found' };
            }

            // Check read permissions
            if (!checkPermissions(file, wUserId,wGroup, 'read')) {
                return { message: 'error', error: 'Permission denied' };
            }

            // Create full path for the file
            const fullPath = path.join(wDownloadPath, file.name);

            try {
                // Ensure the download directory exists
                await fs.mkdir(wDownloadPath, { recursive: true });

                if (isSkerVirtualFile(file)) {
                    const rebuilt = await rebuildSkerContentFromRecord(fastify, file);
                    if (!rebuilt?.content) {
                        throw new Error('Workbook content not found');
                    }
                    await fs.writeFile(fullPath, rebuilt.content);
                } else if (file.gridfsId) {
                    // Handle large files stored in GridFS
                    const downloadStream = gridFSBucket.openDownloadStream(file.gridfsId);
                    const writeStream = createWriteStream(fullPath);
                    
                    await new Promise((resolve, reject) => {
                        downloadStream.pipe(writeStream)
                            .on('error', reject)
                            .on('finish', resolve);
                    });
                } else {
                    // Handle small files stored inline
                    const content = file.content;
                    if (typeof content === 'string') {
                        if (content.startsWith('data:')) {
                            // Handle base64 encoded content
                            const base64Data = content.split(',')[1];
                            await fs.writeFile(fullPath, Buffer.from(base64Data, 'base64'));
                        } else {
                            // Handle text content
                            await fs.writeFile(fullPath, content);
                        }
                    } else if (Buffer.isBuffer(content)) {
                        // Handle binary content directly
                        await fs.writeFile(fullPath, content);
                    } else {
                        throw new Error('❌ Don\'t know how to handle this content type');
                    }
                }

                return {
                    message: 'success',
                    path: fullPath,
                    size: file.size
                };
            } catch (wError) {
                const wErrorMessage = `❌ Error writing file to disk: ${wError}`;
                console.error(wErrorMessage);
                return { message: 'error', error: wErrorMessage };
            }
        } catch (error) {
            console.error('Error downloading file:', error);
            return { message: 'error', error: error.message };
        }
    });

    // Excel → .sker conversion (async background job)
    async function runBackgroundExcelConversion(taskId, conversionContext) {
        try {
            const result = await executeExcelConversion(conversionContext);
            setExcelConversionReady(taskId, result);
            console.log(`✅ Excel conversion complete (task ${taskId}): ${conversionContext.filePath}`);
        } catch (err) {
            console.error(`❌ Excel conversion failed (task ${taskId}):`, err?.message || err);
            setExcelConversionError(taskId, err?.message || String(err), {
                skExcelCode: err.skExcelCode ?? null,
                skExcelSignal: err.skExcelSignal ?? null,
                skExcelStderr: err.skExcelStderr || '',
                skExcelStdout: err.skExcelStdout || '',
                path: err.path,
                fileName: err.fileName,
            });
        }
    }

    // .sker → s_*.xlsx export (async background job)
    async function runBackgroundSkerExport(taskId, exportContext) {
        try {
            const result = await executeSkerToExcelExport(exportContext);
            setExcelConversionReady(taskId, result);
            console.log(`✅ Sker export complete (task ${taskId}): ${exportContext.filePath}`);
        } catch (err) {
            console.error(`❌ Sker export failed (task ${taskId}):`, err?.message || err);
            setExcelConversionError(taskId, err?.message || String(err), {
                skExcelCode: err.skExcelCode ?? null,
                skExcelSignal: err.skExcelSignal ?? null,
                skExcelStderr: err.skExcelStderr || '',
                skExcelStdout: err.skExcelStdout || '',
                path: err.path,
                fileName: err.fileName,
            });
        }
    }

    fastify.get('/files/convert-xlsx/tasks/:taskId', async function (sRequest, sReply) {
        try {
            const { taskId } = sRequest.params;
            const task = getExcelConversionTask(taskId);
            if (!task) {
                return sReply.status(404).send({
                    message: 'error',
                    error: 'Task not found',
                    taskId,
                });
            }
            return sReply.send({
                message: 'success',
                ...task,
            });
        } catch (error) {
            console.error('Error reading Excel conversion task:', error);
            return sReply.status(500).send({ message: 'error', error: error.message });
        }
    });

    fastify.post('/files/convert-xlsx', {
        config: { skExcelConversion: true },
        preValidation: async (sRequest, sReply) => {
            try {
                if (typeof sRequest.body === 'string') {
                    sRequest.body = JSON.parse(sRequest.body);
                }
                if (!sRequest.body || typeof sRequest.body !== 'object') {
                    return sReply.status(400).send({ message: 'error', error: 'Invalid request body' });
                }
            } catch (e) {
                return sReply.status(400).send({ message: 'error', error: 'Invalid JSON in request body' });
            }
        },
        handler: async function (sRequest, sReply) {
            try {
                const wCollection = fastify.mongo.db.collection('Directory');
                const { path: filePath } = sRequest.body;
                const wUserEmail = sRequest.user?.userEmail;
                const wGroup = sRequest.user?.group;
                const checkPermissions = await createPermissionChecker(fastify.mongo.db);

                if (!filePath) {
                    return sReply.status(400).send({ message: 'error', error: 'File path is required' });
                }

                const file = await wCollection.findOne({ path: filePath });

                if (!file) {
                    return sReply.status(404).send({ message: 'error', error: 'File not found' });
                }

                if (file.isDirectory) {
                    return sReply.status(400).send({ message: 'error', error: 'Cannot convert a directory' });
                }

                if (!checkPermissions(file, wUserEmail, wGroup, 'read')) {
                    return sReply.status(403).send({ message: 'error', error: 'Permission denied' });
                }

                const task = createExcelConversionTask(filePath, file.name);
                const conversionContext = {
                    file,
                    filePath,
                    userEmail: wUserEmail,
                    gridFSBucket,
                    persistSkerVirtualFileDirect,
                    tmpDir: sRequest.body.tmpDir,
                    fileNameOverride: sRequest.body.fileName,
                };

                setImmediate(() => {
                    runBackgroundExcelConversion(task.taskId, conversionContext);
                });

                console.log(`⏳ Excel conversion accepted (task ${task.taskId}): ${filePath}`);
                return sReply.status(202).send({
                    message: 'accepted',
                    taskId: task.taskId,
                    status: 'converting',
                    path: filePath,
                    fileName: file.name,
                });
            } catch (error) {
                console.error('Error starting Excel conversion:', error);
                return sReply.status(500).send({ message: 'error', error: error.message });
            }
        },
    });

    fastify.get('/files/export-xlsx/tasks/:taskId', async function (sRequest, sReply) {
        try {
            const { taskId } = sRequest.params;
            const task = getExcelConversionTask(taskId);
            if (!task) {
                return sReply.status(404).send({
                    message: 'error',
                    error: 'Task not found',
                    taskId,
                });
            }
            return sReply.send({
                message: 'success',
                ...task,
            });
        } catch (error) {
            console.error('Error reading Sker export task:', error);
            return sReply.status(500).send({ message: 'error', error: error.message });
        }
    });

    fastify.post('/files/export-xlsx', {
        config: { skExcelConversion: true },
        preValidation: async (sRequest, sReply) => {
            try {
                if (typeof sRequest.body === 'string') {
                    sRequest.body = JSON.parse(sRequest.body);
                }
                if (!sRequest.body || typeof sRequest.body !== 'object') {
                    return sReply.status(400).send({ message: 'error', error: 'Invalid request body' });
                }
            } catch (e) {
                return sReply.status(400).send({ message: 'error', error: 'Invalid JSON in request body' });
            }
        },
        handler: async function (sRequest, sReply) {
            try {
                const wCollection = fastify.mongo.db.collection('Directory');
                const { path: filePath } = sRequest.body;
                const wUserEmail = sRequest.user?.userEmail;
                const wGroup = sRequest.user?.group;
                const checkPermissions = await createPermissionChecker(fastify.mongo.db);

                if (!filePath) {
                    return sReply.status(400).send({ message: 'error', error: 'File path is required' });
                }

                const file = await wCollection.findOne({ path: filePath });

                if (!file) {
                    return sReply.status(404).send({ message: 'error', error: 'File not found' });
                }

                if (file.isDirectory) {
                    return sReply.status(400).send({ message: 'error', error: 'Cannot export a directory' });
                }

                const isSker = typeof file.name === 'string' && file.name.toLowerCase().endsWith('.sker');
                if (!isSker) {
                    return sReply.status(400).send({ message: 'error', error: 'Only .sker files can be exported to Excel' });
                }

                if (!checkPermissions(file, wUserEmail, wGroup, 'read')) {
                    return sReply.status(403).send({ message: 'error', error: 'Permission denied' });
                }

                const task = createExcelConversionTask(filePath, file.name);
                const exportContext = {
                    fastify,
                    file,
                    filePath,
                    userEmail: wUserEmail,
                    gridFSBucket,
                    persistBinaryVirtualFileDirect,
                    tmpDir: sRequest.body.tmpDir,
                };

                setImmediate(() => {
                    runBackgroundSkerExport(task.taskId, exportContext);
                });

                console.log(`⏳ Sker export accepted (task ${task.taskId}): ${filePath}`);
                return sReply.status(202).send({
                    message: 'accepted',
                    taskId: task.taskId,
                    status: 'converting',
                    path: filePath,
                    fileName: file.name,
                });
            } catch (error) {
                console.error('Error starting Sker export:', error);
                return sReply.status(500).send({ message: 'error', error: error.message });
            }
        },
    });

    // Handle file chunks
    fastify.post('/files/chunk', {
      bodyLimit: FILES_UPLOAD_BODY_LIMIT,
      handler: async function (sRequest, sReply) {
        try {
          const wCollection = fastify.mongo.db.collection('Directory');
          const { path, content, chunkIndex, totalChunks } = sRequest.body;

          // Find the file
          const file = await wCollection.findOne({ path });
          if (!file) {
            return { message: 'error', error: 'File not found' };
          }

          // If this is the first chunk, initialize GridFS
          if (chunkIndex === 0) {
            const uploadStream = gridFSBucket.openUploadStream(path, {
              metadata: {
                owner: file.owner,
                group: file.group,
                permissions: file.permissions
              }
            });
            
            // Store the upload stream ID in the file document
            await wCollection.updateOne(
              { path },
              { $set: { gridfsId: uploadStream.id } }
            );
          }

          // Get the upload stream
          const uploadStream = gridFSBucket.openUploadStreamWithId(
            file.gridfsId,
            path,
            { append: true }
          );

          // Write the chunk
          uploadStream.write(Buffer.from(content));
          
          // If this is the last chunk, close the stream
          if (chunkIndex === totalChunks - 1) {
            await new Promise((resolve, reject) => {
              uploadStream.end((error) => {
                if (error) reject(error);
                else resolve();
              });
            });
          }

          return { message: 'success' };
        } catch (error) {
          console.error('Error handling file chunk:', error);
          return { message: 'error', error: error.message };
        }
      }
    });

    fastify.post('/files/history/snapshot', {
      preValidation: async (sRequest, sReply) => {
        try {
          if (typeof sRequest.body === 'string') {
            sRequest.body = JSON.parse(sRequest.body);
          }
          if (!sRequest.body || typeof sRequest.body !== 'object') {
            return sReply.status(400).send({ message: 'error', error: 'Invalid request body' });
          }
        } catch (e) {
          return sReply.status(400).send({ message: 'error', error: 'Invalid JSON in request body' });
        }
      },
      handler: async function (sRequest, sReply) {
        try {
          const wPath = typeof sRequest.body.path === 'string' ? sRequest.body.path.trim() : '';
          const wLabel = typeof sRequest.body.label === 'string' ? sRequest.body.label.trim() : '';
          const wComment = typeof sRequest.body.comment === 'string' ? sRequest.body.comment.trim() : '';
          const wUserEmail = sRequest.user?.userEmail;
          const wGroup = sRequest.user?.group;
          const checkPermissions = await createPermissionChecker(fastify.mongo.db);

          if (!wPath || !wLabel) {
            return sReply.status(400).send({ message: 'error', error: 'path and label are required' });
          }

          const wCollection = fastify.mongo.db.collection('Directory');
          const wFile = await wCollection.findOne({ path: wPath, isDirectory: false });
          if (!wFile) {
            return sReply.status(404).send({ message: 'error', error: 'File not found' });
          }
          if (!checkPermissions(wFile, wUserEmail, wGroup, 'write')) {
            return sReply.status(403).send({ message: 'error', error: 'Permission denied' });
          }

          const wUsersCollection = fastify.mongo.db.collection('User');
          const wOwnerDoc = wUserEmail
            ? await wUsersCollection.findOne({ Email: wUserEmail })
            : null;
          const wAuthorName = wOwnerDoc
            ? `${String(wOwnerDoc.Name || '').trim()} ${String(wOwnerDoc.FirstName || '').trim()}`.trim()
            : '';

          const entry = await createSkerHistorySnapshot(fastify, wPath, {
            label: wLabel,
            comment: wComment,
            author: wAuthorName,
            email: wUserEmail,
          });

          return sReply.send({
            message: 'success',
            path: wPath,
            version: entry,
          });
        } catch (error) {
          console.error('Error creating .sker history snapshot:', error);
          return sReply.status(500).send({ message: 'error', error: error.message });
        }
      },
    });

    fastify.get('/files/history/:id', async function (sRequest, sReply) {
      try {
        const wQueryObj = JSON.parse(decodeURIComponent(sRequest.params.id));
        const wPath = typeof wQueryObj.path === 'string' ? wQueryObj.path.trim() : '';
        const wLimit = wQueryObj.limit;
        const wUserEmail = sRequest.user?.userEmail;
        const wGroup = sRequest.user?.group;
        const checkPermissions = await createPermissionChecker(fastify.mongo.db);

        if (!wPath) {
          return sReply.status(400).send({ message: 'error', error: 'path is required' });
        }

        const wCollection = fastify.mongo.db.collection('Directory');
        const wFile = await wCollection.findOne({ path: wPath, isDirectory: false });
        if (!wFile) {
          return sReply.status(404).send({ message: 'error', error: 'File not found' });
        }
        if (!checkPermissions(wFile, wUserEmail, wGroup, 'read')) {
          return sReply.status(403).send({ message: 'error', error: 'Permission denied' });
        }

        const versions = await listSkerHistory(fastify, wPath, wLimit);
        return sReply.send({
          message: 'success',
          path: wPath,
          maxVersions: Math.max(1, parseInt(process.env.SKER_HISTORY_MAX_VERSIONS || '50', 10) || 50),
          versions,
        });
      } catch (error) {
        console.error('Error listing .sker history:', error);
        return sReply.status(500).send({ message: 'error', error: error.message });
      }
    });

    fastify.get('/files/history/version/:versionId', async function (sRequest, sReply) {
      try {
        const wUserEmail = sRequest.user?.userEmail;
        const wGroup = sRequest.user?.group;
        const checkPermissions = await createPermissionChecker(fastify.mongo.db);
        const wVersion = await getSkerHistoryVersion(fastify, sRequest.params.versionId);

        if (!wVersion) {
          return sReply.status(404).send({ message: 'error', error: 'History version not found' });
        }

        const wCollection = fastify.mongo.db.collection('Directory');
        const wFile = await wCollection.findOne({ path: wVersion.path, isDirectory: false });
        if (!wFile) {
          return sReply.status(404).send({ message: 'error', error: 'File not found' });
        }
        if (!checkPermissions(wFile, wUserEmail, wGroup, 'read')) {
          return sReply.status(403).send({ message: 'error', error: 'Permission denied' });
        }

        let wContent = null;
        if (wVersion.data) {
          const wDataOut = { ...wVersion.data, uri: wVersion.path };
          wContent = JSON.stringify(wDataOut);
        }

        return sReply.send({
          message: 'success',
          version: {
            id: wVersion._id,
            path: wVersion.path,
            revision: wVersion.revision,
            label: wVersion.label || '',
            comment: wVersion.comment || '',
            size: wVersion.size,
            author: wVersion.author,
            email: wVersion.email,
            source: wVersion.source,
            createdAt: wVersion.createdAt,
          },
          content: wContent,
        });
      } catch (error) {
        console.error('Error reading .sker history version:', error);
        return sReply.status(500).send({ message: 'error', error: error.message });
      }
    });

    fastify.post('/files/history/restore', {
      preValidation: async (sRequest, sReply) => {
        try {
          if (typeof sRequest.body === 'string') {
            sRequest.body = JSON.parse(sRequest.body);
          }
          if (!sRequest.body || typeof sRequest.body !== 'object') {
            return sReply.status(400).send({ message: 'error', error: 'Invalid request body' });
          }
        } catch (e) {
          return sReply.status(400).send({ message: 'error', error: 'Invalid JSON in request body' });
        }
      },
      handler: async function (sRequest, sReply) {
        try {
          const wPath = typeof sRequest.body.path === 'string' ? sRequest.body.path.trim() : '';
          const wVersionId = sRequest.body.versionId;
          const wUserEmail = sRequest.user?.userEmail;
          const wGroup = sRequest.user?.group;
          const checkPermissions = await createPermissionChecker(fastify.mongo.db);

          if (!wPath || !wVersionId) {
            return sReply.status(400).send({ message: 'error', error: 'path and versionId are required' });
          }

          const wCollection = fastify.mongo.db.collection('Directory');
          const wFile = await wCollection.findOne({ path: wPath, isDirectory: false });
          if (!wFile) {
            return sReply.status(404).send({ message: 'error', error: 'File not found' });
          }
          if (!checkPermissions(wFile, wUserEmail, wGroup, 'write')) {
            return sReply.status(403).send({ message: 'error', error: 'Permission denied' });
          }

          const wUsersCollection = fastify.mongo.db.collection('User');
          const wOwnerDoc = wUserEmail
            ? await wUsersCollection.findOne({ Email: wUserEmail })
            : null;
          const wAuthorName = wOwnerDoc
            ? `${String(wOwnerDoc.Name || '').trim()} ${String(wOwnerDoc.FirstName || '').trim()}`.trim()
            : '';

          const restored = await restoreSkerFromHistory(fastify, wPath, wVersionId, {
            author: wAuthorName,
            email: wUserEmail,
          });

          await wCollection.updateOne(
            { _id: wFile._id },
            {
              $set: {
                info: restored.info || wFile.info,
                record: restored.recordId,
                size: restored.size || wFile.size,
                content: null,
                gridfsId: null,
                updatedAt: new Date(),
              },
            }
          );

          await invalidateSkeeptoCacheForPath(wPath);

          return sReply.send({
            message: 'success',
            path: wPath,
            restoredRevision: restored.version?.revision,
            historyEntry: restored.historyEntry,
          });
        } catch (error) {
          console.error('Error restoring .sker history version:', error);
          return sReply.status(500).send({ message: 'error', error: error.message });
        }
      },
    });

    // Admin: migrate existing .sker files to Spreadsheet collection (idempotent)
    fastify.post('/files/migrate-sker', async function(sRequest, sReply) {
        try {
            const wDirCollection = fastify.mongo.db.collection('Directory');

            const wLimit = Number(sRequest.query?.limit || 0);
            const wFilter = {
                isDirectory: false,
                name: { $regex: /\.sker$/i }
            };

            const wCursor = wDirCollection.find(wFilter);
            let migrated = 0;
            let skipped = 0;
            let errors = 0;

            while (await wCursor.hasNext()) {
                if (wLimit && migrated >= wLimit) break;
                const file = await wCursor.next();

                try {
                    // Skip if already migrated (record set and content cleared)
                    if (file.record && (file.content === null || file.content === undefined)) {
                        skipped++;
                        continue;
                    }

                    // Handle inline content as string or object
                    let parsed = null;
                    if (typeof file.content === 'string') {
                        parsed = JSON.parse(file.content);
                    } else if (file.content && typeof file.content === 'object') {
                        parsed = file.content;
                    }
                    if (!parsed) {
                        skipped++;
                        continue;
                    }
                    const { recordId } = await saveSkerToCollections(
                        fastify,
                        file,
                        file.path,
                        parsed
                    );
                    if (!recordId) {
                        skipped++;
                        continue;
                    }

                    const info = parsed.info || null;

                    // Update Directory file: keep only info + record, clear content/gridfsId
                    await wDirCollection.updateOne(
                        { _id: file._id },
                        { $set: { info: info, record: recordId, content: null, gridfsId: null, updatedAt: new Date() } }
                    );

                    migrated++;
                } catch (e) {
                    console.error('Error migrating .sker file', file?._id, e);
                    errors++;
                }
            }

            return { message: 'success', migrated, skipped, errors };
        } catch (error) {
            console.error('Error in migrate-sker:', error);
            return { message: 'error', error: error.message };
        }
    });

}

export { SkVirtualDiskDb,SkFileSchema }

