// SkSpFastify.mjs - Adapted for WebAssembly Instance Pool
// This file is used to manage the spreadsheets database and WebAssembly instance pool
// It provides REST API endpoints for:
// - Spreadsheet file management (CRUD operations)
// - Pool monitoring and management
// - Performance testing and metrics
// - Instance health monitoring
// - Load balancing and auto-scaling
import dependenciesContainer from '../Depency/SkDepencyManager.mjs';
import { ObjectId } from '@fastify/mongodb'

import path from 'path'
import { createWriteStream } from 'fs'
import { GridFSBucket } from 'mongodb'
import { saveSkerToCollections, rebuildSkerContentFromRecord } from './SkSkerStorage.mjs'
import { checkFilePermissions, loadSharedDirectoryRoots } from '../SkVirtualDisk/SkVirtualDiskPermissions.mjs'
import { canWriteVirtualPath } from '../SkVirtualDisk/SkVirtualDiskWriteAccess.mjs'
import {
  extractSpreadsheetVirtualPath,
  isReservedSpreadsheetUrlPath,
  parseSpreadsheetRequestUrl,
  normalizeSpreadsheetVirtualPath,
} from './SkSpreadSheetPathUtils.mjs'
import {
  createLoadTask,
  getLoadTask,
  setLoadTaskError,
  setLoadTaskReady,
} from './SkSpreadSheetLoadTasks.mjs'
import {
  canStreamDirectoryGridFs,
  fetchSpreadsheetFileRecord,
  resolveWorkbookContentString,
} from './SkSpreadSheetContent.mjs'
import {
  ensureSpreadsheetWorkbookLoaded,
  runSpreadsheetCall,
  shouldPersistAfterCall,
  SPREADSHEET_CALL_ALLOWLIST,
} from './SkSpCall.mjs'
import { SkeeptoTools } from '../SkAI/SkeeptoTools.mjs'
import { getBrowserWasmBuildId } from './skWasmSingleton.mjs'

const GRIDFS_CHUNK_SIZE = 14 * 1024 * 1024; // 14MB — must stay under MongoDB 16MB BSON limit per chunk doc
const MAX_INLINE_SIZE = 16 * 1024 * 1024; // 16MB
const SPREADSHEET_POST_BODY_LIMIT = 52 * 1024 * 1024; // 52MB — large .sker JSON payloads

/**
 * SkSpFastify - Fastify plugin for SkSpreadSheet with WebAssembly Instance Pool
 * 
 * This plugin provides comprehensive REST API endpoints for managing:
 * 1. Spreadsheet files (CRUD operations)
 * 2. WebAssembly instance pool monitoring and management
 * 3. Performance testing and metrics collection
 * 4. Pool health monitoring and auto-scaling
 * 5. Load balancing strategies and configuration
 * 
 * Pool Management Endpoints:
 * - GET  /spreadsheet/pool/stats          - Pool statistics and metrics
 * - GET  /spreadsheet/pool/health         - Pool health status
 * - GET  /format/debug                    - FormatApi dump (all pool instances, no workbook)
 * - GET  /spreadsheet/pool/instances     - Detailed instance information
 * - GET  /spreadsheet/pool/config         - Pool configuration
 * - POST /spreadsheet/pool/scale          - Scale pool up/down
 * - POST /spreadsheet/pool/reset          - Reset entire pool
 * - POST /spreadsheet/pool/performance-test - Performance testing
 * - PUT  /spreadsheet/pool/config         - Update configuration
 * 
 * Spreadsheet Operations:
 * - POST /spreadsheet/operation           - Execute spreadsheet operations
 * - GET  /spreadsheet/content/:path       - Stream workbook JSON (no server WASM)
 * - POST /spreadsheet/open                - Background server WASM load (202 + taskId)
 * - GET  /spreadsheet/tasks/:taskId       - Poll background load status
 * - GET  /spreadsheet/routes              - Available routes summary
 * 
 * @param {Object} fastify - Fastify instance
 * @param {Object} opts - Plugin options
 */
export async function SkSpFastify(fastify,opts) {
  
  // Helper function to validate and format responses
  function validateResponse(response, source = 'unknown') {
    if (!response) {
      console.error(`❌ Invalid response from ${source}: response is null/undefined`);
      return {
        message: 'error',
        error: 'Invalid response format',
        source: source,
        timestamp: new Date().toISOString()
      };
    }
    
    if (typeof response !== 'object') {
      console.error(`❌ Invalid response type from ${source}: ${typeof response}`);
      return {
        message: 'error',
        error: 'Response must be an object',
        source: source,
        receivedType: typeof response,
        timestamp: new Date().toISOString()
      };
    }
    
    if (!response.message) {
      console.warn(`⚠️ Response missing 'message' field from ${source}, adding default`);
      response.message = 'success';
    }
    
    // Add metadata
    response.timestamp = new Date().toISOString();
    response.source = source;
    
    console.log(`✅ Validated response from ${source}:`, {
      message: response.message,
      hasContent: !!response.content,
      hasFile: !!response.file,
      hasFileContent: !!(response.file && response.file.content),
      timestamp: response.timestamp
    });
    
    return response;
  }
  
  // Initialize GridFS bucket for this plugin
  let gridFSBucket;
  try {
    gridFSBucket = new GridFSBucket(fastify.mongo.db, {
      chunkSizeBytes: GRIDFS_CHUNK_SIZE,
      bucketName: 'files'
    });
  } catch (err) {
    console.error('❌ Error initializing GridFS in SkSpFastify:', err);
    return validateResponse({ message: 'error', error: err.message }, 'gridfs-error')
  }

  function getSpreadsheetUserContext(request) {
    const userEmail = (request?.user?.userEmail) ? request.user.userEmail : 'anonymous@local';
    const group = (request?.user?.group) ? request.user.group : 'default';
    return { userEmail, group };
  }
  
  fastify.post('/spreadsheet/post', { bodyLimit: SPREADSHEET_POST_BODY_LIMIT }, async function (req, reply) {
    try {
      const wDirectory = fastify.mongo.db.collection('Directory')
      const wSpreadsheet = fastify.mongo.db.collection('Spreadsheet')
      const wObj = typeof req.body === 'string' ? JSON.parse(req.body) : req.body

      if (!wObj || !wObj.path) {
        return validateResponse({ message: 'error', error: 'Missing path in body' }, 'post-validate')
      }

      // load existing file if any
      const wExisting = await wDirectory.findOne({ path: wObj.path })

      const wUserEmail = (req.user && req.user.userEmail) ? req.user.userEmail : null
      const hasMutatingContent =
        (typeof wObj.content === 'string' && wObj.content.trim() !== '') ||
        (wObj.content && typeof wObj.content === 'object')

      if (wExisting && wUserEmail && hasMutatingContent) {
        const wAllowed = await canWriteVirtualPath(fastify.mongo.db, wObj.path, wUserEmail)
        if (!wAllowed) {
          return validateResponse(
            { message: 'error', error: 'Permission denied: read-only' },
            'post-read-only'
          )
        }
      }

      // Default update payload mirrors incoming
      let wUpdateSet = { ...wObj, updatedAt: new Date() }

      // Resolve file basename from name or path so .sker handling works when only path is sent
      const effectiveFileName = (() => {
        if (typeof wObj.name === 'string' && wObj.name.trim()) return wObj.name.trim()
        if (typeof wObj.path === 'string') {
          const segs = wObj.path.split('/').filter(Boolean)
          return segs.length ? segs[segs.length - 1] : ''
        }
        return ''
      })()
      if (effectiveFileName && !wUpdateSet.name) {
        wUpdateSet.name = effectiveFileName
      }

      let skerContentPersisted = false

      // Special handling for .sker via shared util
      if (effectiveFileName.toLowerCase().endsWith('.sker')) {
        // If content is provided (non-empty), parse and persist into Spreadsheet collection
        // Accept content as string or object
        const hasStringContent = (typeof wObj.content === 'string') && (wObj.content.trim() !== '')
        const hasObjectContent = (wObj.content && typeof wObj.content === 'object')
        if (hasStringContent || hasObjectContent) {
          try {
            const { recordId, info, spreadsheetData, size } = await saveSkerToCollections(
              fastify,
              wExisting,
              wObj.path,
              hasObjectContent ? JSON.stringify(wObj.content) : wObj.content
            )
            if (recordId) {
              wUpdateSet.info = info
              wUpdateSet.record = recordId
              wUpdateSet.content = null
              wUpdateSet.gridfsId = null
              if (size) { wUpdateSet.size = size }
              skerContentPersisted = true
            }
          } catch (skerErr) {
            console.error('❌ Error handling .sker in /spreadsheet/post:', skerErr)
            return validateResponse({ message: 'error', error: skerErr.message }, 'post-sker')
          }
        } else {
          // No content provided for .sker → never overwrite existing content/size/gridfsId
          delete wUpdateSet.content
          delete wUpdateSet.gridfsId
          delete wUpdateSet.size
        }
      }

      // GridFS explicitly désactivé pour Spreadsheet
      // On conserve content inline tel quel pour les fichiers non .sker

      if (wExisting) {
        await wDirectory.updateOne({ path: wObj.path }, { $set: wUpdateSet })
        if (skerContentPersisted) {
          try {
            const sk = dependenciesContainer.resolve('SkSpreadSheet')
            if (sk && typeof sk.invalidateWorkBookCache === 'function') {
              await sk.invalidateWorkBookCache(wObj.path)
            }
          } catch (invErr) {
            console.warn('invalidateWorkBookCache after /spreadsheet/post update:', invErr?.message || invErr)
          }
        }
        return validateResponse({ message: 'updated', id: wExisting._id, path: wObj.path }, 'post-update')
      } else {
        wUpdateSet.createdAt = new Date()
        const wResult = await wDirectory.insertOne(wUpdateSet)
        if (skerContentPersisted) {
          try {
            const sk = dependenciesContainer.resolve('SkSpreadSheet')
            if (sk && typeof sk.invalidateWorkBookCache === 'function') {
              await sk.invalidateWorkBookCache(wObj.path)
            }
          } catch (invErr) {
            console.warn('invalidateWorkBookCache after /spreadsheet/post insert:', invErr?.message || invErr)
          }
        }
        return validateResponse({ message: 'inserted', id: wResult.insertedId, path: wObj.path }, 'post-insert')
      }
    } catch (e) {
      console.error('❌ Error in /spreadsheet/post:', e)
      return validateResponse({ message: 'error', error: e.message }, 'post-error')
    }
  })

  // WASM version handshake: exposes the SHA-256 of the server's SkReactSpreadSheet.wasm
  // so clients can detect when they are running a different (stale) WASM build and
  // force a reload. A mismatch between client and server binaries corrupts collaborative
  // ops and crashes instances with "memory access out of bounds".
  fastify.get('/spreadsheet/wasm/version', async function (request, reply) {
    try {
      const wBuildId = getBrowserWasmBuildId();
      return validateResponse({
        message: 'success',
        wasmSha256: wBuildId || null,
      }, 'wasm-version');
    } catch (error) {
      console.error('❌ Error getting WASM version:', error);
      return validateResponse({
        message: 'error',
        error: 'Failed to get WASM version',
        details: error.message,
      }, 'wasm-version-error');
    }
  });

  // Pool monitoring and management routes
  fastify.get('/spreadsheet/pool/stats', async function (request, reply) {
    try {
      const wSpreadSheet = dependenciesContainer.resolve('SkSpreadSheet');
      if (!wSpreadSheet) {
        return validateResponse({ 
          message: 'error', 
          error: 'SkSpreadSheet not available' 
        }, 'pool-stats-error');
      }

      const stats = wSpreadSheet.getPoolStats();
      const health = wSpreadSheet.getPoolHealth();
      
      const result = {
        message: 'success',
        stats,
        health,
        timestamp: new Date().toISOString()
      };
      
      console.log('📊 Pool statistics requested');
      return validateResponse(result, 'pool-stats');
      
    } catch (error) {
      console.error('❌ Error getting pool stats:', error);
      return validateResponse({ 
        message: 'error', 
        error: 'Failed to get pool statistics',
        details: error.message 
      }, 'pool-stats-error');
    }
  });

  fastify.get('/spreadsheet/pool/health', async function (request, reply) {
    try {
      const wSpreadSheet = dependenciesContainer.resolve('SkSpreadSheet');
      if (!wSpreadSheet) {
        return validateResponse({ 
          message: 'error', 
          error: 'SkSpreadSheet not available' 
        }, 'pool-health-error');
      }

      const health = wSpreadSheet.getPoolHealth();
      
      const result = {
        message: 'success',
        health,
        timestamp: new Date().toISOString()
      };
      
      console.log('🏥 Pool health check requested');
      return validateResponse(result, 'pool-health');
      
    } catch (error) {
      console.error('❌ Error getting pool health:', error);
      return validateResponse({ 
        message: 'error', 
        error: 'Failed to get pool health',
        details: error.message 
      }, 'pool-health-error');
    }
  });

  fastify.post('/spreadsheet/pool/scale', async function (request, reply) {
    try {
      const { action, count = 1 } = request.body;
      
      if (!['scale-up', 'scale-down'].includes(action)) {
        return validateResponse({ 
          message: 'error', 
          error: 'Invalid action. Use "scale-up" or "scale-down"' 
        }, 'pool-scale-error');
      }
      
      const wSpreadSheet = dependenciesContainer.resolve('SkSpreadSheet');
      if (!wSpreadSheet) {
        return validateResponse({ 
          message: 'error', 
          error: 'SkSpreadSheet not available' 
        }, 'pool-scale-error');
      }

      const result = await wSpreadSheet.scalePool(action, count);
      
      console.log(`🔄 Pool scaling: ${action} by ${count} instances`);
      return validateResponse({
        message: 'success',
        ...result,
        timestamp: new Date().toISOString()
      }, 'pool-scale');
      
    } catch (error) {
      console.error('❌ Error scaling pool:', error);
      return validateResponse({ 
        message: 'error', 
        error: 'Failed to scale pool',
        details: error.message 
      }, 'pool-scale-error');
    }
  });

  fastify.post('/spreadsheet/pool/reset', async function (request, reply) {
    try {
      const wSpreadSheet = dependenciesContainer.resolve('SkSpreadSheet');
      if (!wSpreadSheet) {
        return validateResponse({ 
          message: 'error', 
          error: 'SkSpreadSheet not available' 
        }, 'pool-reset-error');
      }

      const pool = wSpreadSheet.getSpreadSheetPool();
      const currentInstances = pool.instances.size;
      
      // Reset the pool
      await wSpreadSheet.cleanup();
      await wSpreadSheet.initializeSkerSpreadSheet();
      
      const newStats = wSpreadSheet.getPoolStats();
      
      console.log('🔄 Pool reset completed');
      return validateResponse({
        message: 'success',
        info: 'Pool reset successfully',
        previousInstances: currentInstances,
        newInstances: newStats.totalInstances,
        timestamp: new Date().toISOString()
      }, 'pool-reset');
      
    } catch (error) {
      console.error('❌ Error resetting pool:', error);
      return validateResponse({ 
        message: 'error', 
        error: 'Failed to reset pool',
        details: error.message 
      }, 'pool-reset-error');
    }
  });

  fastify.post('/spreadsheet/operation', async function (request, reply) {
    try {
      const { operation, data } = request.body;
      
      if (!operation) {
        return validateResponse({ 
          message: 'error', 
          error: 'Operation is required' 
        }, 'spreadsheet-operation-error');
      }
      
      const wSpreadSheet = dependenciesContainer.resolve('SkSpreadSheet');
      if (!wSpreadSheet) {
        return validateResponse({ 
          message: 'error', 
          error: 'SkSpreadSheet not available' 
        }, 'spreadsheet-operation-error');
      }

      let result;
      
      switch (operation) {
        case 'setCellValue':
          if (!data || !data.row || !data.col || data.value === undefined) {
            return validateResponse({ 
              message: 'error', 
              error: 'setCellValue requires row, col, and value' 
            }, 'spreadsheet-operation-error');
          }
          result = await wSpreadSheet.executeTask((uISpreadSheet) => {
            if (typeof uISpreadSheet.setCellValue === 'function') {
              return uISpreadSheet.setCellValue(data.row, data.col, data.value);
            } else {
              throw new Error('setCellValue method not found on UISpreadSheet');
            }
          });
          break;
          
        case 'getCellValue':
          if (!data || !data.row || !data.col) {
            return validateResponse({ 
              message: 'error', 
              error: 'getCellValue requires row and col' 
            }, 'spreadsheet-operation-error');
          }
          result = await wSpreadSheet.executeTask((uISpreadSheet) => {
            if (typeof uISpreadSheet.getCellValue === 'function') {
              return uISpreadSheet.getCellValue(data.row, data.col);
            } else {
              throw new Error('getCellValue method not found on UISpreadSheet');
            }
          });
          break;
          
        case 'loadWorkbook':
          if (!data || !data.path || !data.content) {
            return validateResponse({ 
              message: 'error', 
              error: 'loadWorkbook requires path and content' 
            }, 'spreadsheet-operation-error');
          }
          result = await wSpreadSheet.loadWorkBook(data.path, data.content);
          break;
          
        case 'saveWorkbook':
          if (!data || !data.path) {
            return validateResponse({ 
              message: 'error', 
              error: 'saveWorkbook requires path' 
            }, 'spreadsheet-operation-error');
          }
          result = await wSpreadSheet.getWorkBookContent(data.path);
          break;
          
        default:
          return validateResponse({ 
            message: 'error', 
            error: `Unknown operation: ${operation}` 
          }, 'spreadsheet-operation-error');
      }
      
      console.log(`✅ Spreadsheet operation completed: ${operation}`);
      return validateResponse({
        message: 'success',
        operation,
        result,
        timestamp: new Date().toISOString()
      }, 'spreadsheet-operation');
      
    } catch (error) {
      console.error('❌ Error executing spreadsheet operation:', error);
      return validateResponse({ 
        message: 'error', 
        error: 'Failed to execute spreadsheet operation',
        details: error.message 
      }, 'spreadsheet-operation-error');
    }
  });

  // FormatApi / FormatRoot dump on all WASM pool instances (no workbook path).
  // Use after closing a document to verify formats were released (count === 0).
  fastify.get('/format/debug', async function (request, reply) {
    try {
      const wSpreadSheet = dependenciesContainer.resolve('SkSpreadSheet');
      if (!wSpreadSheet || typeof wSpreadSheet.debugFormatApiAllInstances !== 'function') {
        return reply.status(503).send({ message: 'error', error: 'SkSpreadSheet not available' });
      }

      const wDump = await wSpreadSheet.debugFormatApiAllInstances();
      console.log(
        `[FormatApi debug] instances=${wDump.instances.length} totalCount=${wDump.totalCount} empty=${wDump.empty} workbooks=${wDump.workbooks?.length ?? 0} pendingUnloads=${wDump.pendingUnloads?.length ?? 0}`
      );
      if (Array.isArray(wDump.workbooks) && wDump.workbooks.length > 0) {
        for (const wBook of wDump.workbooks) {
          console.log(
            `  workbook ${wBook.path} → instance=${wBook.instanceId} pendingUnload=${wBook.pendingUnload}`
          );
        }
      }

      return validateResponse(
        {
          message: 'success',
          ...wDump,
        },
        'format-debug'
      );
    } catch (error) {
      console.error('❌ Error in GET /format/debug:', error);
      return reply.status(500).send({
        message: 'error',
        error: 'Failed to dump FormatApi',
        details: error?.message || String(error),
      });
    }
  });

  // Programmatic WASM Call() — used by MCP and automation (Value, GetValue, …)
  fastify.post('/spreadsheet/call', async function (request, reply) {
    try {
      const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      const { path: rawPath, fn, params, ensureLoad, persistAfter } = body ?? {};

      if (!rawPath || typeof rawPath !== 'string') {
        return reply.status(400).send({ message: 'error', error: 'path is required' });
      }
      if (!fn || typeof fn !== 'string') {
        return reply.status(400).send({ message: 'error', error: 'fn is required' });
      }
      if (!SPREADSHEET_CALL_ALLOWLIST.has(fn)) {
        return reply.status(400).send({
          message: 'error',
          error: `fn not allowed: ${fn}`,
          allowed: Array.from(SPREADSHEET_CALL_ALLOWLIST),
        });
      }

      const wSpreadSheet = dependenciesContainer.resolve('SkSpreadSheet');
      if (!wSpreadSheet) {
        return reply.status(503).send({ message: 'error', error: 'SkSpreadSheet not available' });
      }

      const virtualPath = normalizeSpreadsheetVirtualPath(rawPath);
      const { userEmail, group } = getSpreadsheetUserContext(request);

      if (ensureLoad !== false) {
        try {
          await ensureSpreadsheetWorkbookLoaded(
            fastify,
            wSpreadSheet,
            gridFSBucket,
            virtualPath,
            userEmail,
            group
          );
        } catch (loadErr) {
          const wStatus = loadErr.statusCode || 500;
          return reply.status(wStatus).send({
            message: 'error',
            error: loadErr.message || 'Failed to load workbook',
            path: virtualPath,
          });
        }
      }

      const wResult = await runSpreadsheetCall(
        wSpreadSheet,
        virtualPath,
        fn,
        params && typeof params === 'object' ? params : {}
      );

      let wPersisted = false;
      if (shouldPersistAfterCall(fn, persistAfter)) {
        await wSpreadSheet.persistWorkBook(virtualPath, userEmail);
        wPersisted = true;
      }

      return validateResponse(
        {
          message: 'success',
          path: virtualPath,
          fn,
          result: wResult,
          persisted: wPersisted,
        },
        'spreadsheet-call'
      );
    } catch (error) {
      console.error('❌ Error in POST /spreadsheet/call:', error);
      return reply.status(500).send({
        message: 'error',
        error: 'Failed to execute spreadsheet call',
        details: error?.message || String(error),
      });
    }
  });

  // Full workbook / single-sheet JSON for AI (WASM WriteJson + optional sheet filter)
  fastify.post('/spreadsheet/read-workbook', async function (request, reply) {
    try {
      const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      const rawPath = body?.path;

      if (!rawPath || typeof rawPath !== 'string') {
        return reply.status(400).send({ message: 'error', error: 'path is required' });
      }

      const { userEmail, group } = getSpreadsheetUserContext(request);
      const wTools = new SkeeptoTools({
        fastify,
        userEmail,
        group,
        gridFSBucket,
      });

      const wResult = await wTools.readWorkbook(rawPath, {
        sheet: typeof body?.sheet === 'string' ? body.sheet : '',
        includeInternalSheets: body?.includeInternalSheets === true,
      });

      return validateResponse(
        {
          message: 'success',
          ...wResult,
        },
        'spreadsheet-read-workbook'
      );
    } catch (error) {
      console.error('❌ Error in POST /spreadsheet/read-workbook:', error);
      return reply.status(error?.statusCode || 500).send({
        message: 'error',
        error: 'Failed to read workbook',
        details: error?.message || String(error),
      });
    }
  });

  // Paste sker cp clipboard into a range (values + formats + styles + formulas)
  fastify.post('/spreadsheet/paste-range', async function (request, reply) {
    try {
      const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      const rawPath = body?.path;
      const wRange = body?.range;
      const wClipboard = body?.clipboard;

      if (!rawPath || typeof rawPath !== 'string') {
        return reply.status(400).send({ message: 'error', error: 'path is required' });
      }
      if (!wRange || typeof wRange !== 'string') {
        return reply.status(400).send({ message: 'error', error: 'range is required' });
      }
      if (wClipboard == null) {
        return reply.status(400).send({ message: 'error', error: 'clipboard is required' });
      }

      const { userEmail, group } = getSpreadsheetUserContext(request);
      const wTools = new SkeeptoTools({
        fastify,
        userEmail,
        group,
        gridFSBucket,
      });

      const wResult = await wTools.pasteRange(
        rawPath,
        wRange,
        wClipboard,
        typeof body?.sheet === 'string' ? body.sheet : ''
      );

      return validateResponse(
        {
          message: 'success',
          ...wResult,
        },
        'spreadsheet-paste-range'
      );
    } catch (error) {
      console.error('❌ Error in POST /spreadsheet/paste-range:', error);
      return reply.status(error?.statusCode || 500).send({
        message: 'error',
        error: 'Failed to paste range',
        details: error?.message || String(error),
      });
    }
  });

  fastify.post('/spreadsheet/paste-grid', async function (request, reply) {
    try {
      const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      const rawPath = body?.path;
      const wRange = body?.range;
      const wRows = body?.rows;

      if (!rawPath || !wRange || !Array.isArray(wRows)) {
        return reply.status(400).send({
          message: 'error',
          error: 'path, range and rows are required',
        });
      }

      const { userEmail, group } = getSpreadsheetUserContext(request);
      const wTools = new SkeeptoTools({
        fastify,
        userEmail,
        group,
        gridFSBucket,
      });

      const wResult = await wTools.pasteGrid(
        rawPath,
        wRange,
        { rows: wRows, styles: body?.styles },
        typeof body?.sheet === 'string' ? body.sheet : ''
      );

      return validateResponse({ message: 'success', ...wResult }, 'spreadsheet-paste-grid');
    } catch (error) {
      console.error('❌ Error in POST /spreadsheet/paste-grid:', error);
      return reply.status(error?.statusCode || 500).send({
        message: 'error',
        error: 'Failed to paste grid',
        details: error?.message || String(error),
      });
    }
  });

  fastify.post('/spreadsheet/write-cells', async function (request, reply) {
    try {
      const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      const rawPath = body?.path;
      const wCells = body?.cells;

      if (!rawPath || wCells == null) {
        return reply.status(400).send({
          message: 'error',
          error: 'path and cells are required',
        });
      }

      const { userEmail, group } = getSpreadsheetUserContext(request);
      const wTools = new SkeeptoTools({
        fastify,
        userEmail,
        group,
        gridFSBucket,
      });

      const wResult = await wTools.writeCells(
        rawPath,
        wCells,
        typeof body?.sheet === 'string' ? body.sheet : ''
      );

      return validateResponse({ message: 'success', ...wResult }, 'spreadsheet-write-cells');
    } catch (error) {
      console.error('❌ Error in POST /spreadsheet/write-cells:', error);
      return reply.status(error?.statusCode || 500).send({
        message: 'error',
        error: 'Failed to write cells',
        details: error?.message || String(error),
      });
    }
  });

  fastify.post('/spreadsheet/format-ranges', async function (request, reply) {
    try {
      const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      const rawPath = body?.path;
      const wItems = body?.items;

      if (!rawPath || !Array.isArray(wItems)) {
        return reply.status(400).send({
          message: 'error',
          error: 'path and items array are required',
        });
      }

      const { userEmail, group } = getSpreadsheetUserContext(request);
      const wTools = new SkeeptoTools({
        fastify,
        userEmail,
        group,
        gridFSBucket,
      });

      const wResult = await wTools.formatRanges(
        rawPath,
        wItems,
        typeof body?.sheet === 'string' ? body.sheet : ''
      );

      return validateResponse({ message: 'success', ...wResult }, 'spreadsheet-format-ranges');
    } catch (error) {
      console.error('❌ Error in POST /spreadsheet/format-ranges:', error);
      return reply.status(error?.statusCode || 500).send({
        message: 'error',
        error: 'Failed to format ranges',
        details: error?.message || String(error),
      });
    }
  });

  fastify.post('/spreadsheet/duplicate-range', async function (request, reply) {
    try {
      const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      const rawPath = body?.path;
      const wSource = body?.sourceRange;
      const wDest = body?.destRange;

      if (!rawPath || !wSource || !wDest) {
        return reply.status(400).send({
          message: 'error',
          error: 'path, sourceRange and destRange are required',
        });
      }

      const { userEmail, group } = getSpreadsheetUserContext(request);
      const wTools = new SkeeptoTools({
        fastify,
        userEmail,
        group,
        gridFSBucket,
      });

      const wResult = await wTools.duplicateRange(
        rawPath,
        wSource,
        wDest,
        typeof body?.sheet === 'string' ? body.sheet : ''
      );

      return validateResponse({ message: 'success', ...wResult }, 'spreadsheet-duplicate-range');
    } catch (error) {
      console.error('❌ Error in POST /spreadsheet/duplicate-range:', error);
      return reply.status(error?.statusCode || 500).send({
        message: 'error',
        error: 'Failed to duplicate range',
        details: error?.message || String(error),
      });
    }
  });

  fastify.post('/spreadsheet/format-range', async function (request, reply) {
    try {
      const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      const rawPath = body?.path;
      const wRange = body?.range;
      const wCss = body?.css;

      if (!rawPath || typeof rawPath !== 'string') {
        return reply.status(400).send({ message: 'error', error: 'path is required' });
      }
      if (!wRange || typeof wRange !== 'string') {
        return reply.status(400).send({ message: 'error', error: 'range is required' });
      }
      if (!wCss || typeof wCss !== 'string') {
        return reply.status(400).send({ message: 'error', error: 'css is required' });
      }

      const { userEmail, group } = getSpreadsheetUserContext(request);
      const wTools = new SkeeptoTools({
        fastify,
        userEmail,
        group,
        gridFSBucket,
      });

      const wResult = await wTools.formatRange(
        rawPath,
        wRange,
        wCss,
        typeof body?.sheet === 'string' ? body.sheet : ''
      );

      return validateResponse(
        {
          message: 'success',
          ...wResult,
        },
        'spreadsheet-format-range'
      );
    } catch (error) {
      console.error('❌ Error in POST /spreadsheet/format-range:', error);
      return reply.status(error?.statusCode || 500).send({
        message: 'error',
        error: 'Failed to format range',
        details: error?.message || String(error),
      });
    }
  });

  // Persist in-memory WASM workbook to Mongo (after MCP edits)
  fastify.post('/spreadsheet/persist', async function (request, reply) {
    try {
      const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      const rawPath = body?.path;

      if (!rawPath || typeof rawPath !== 'string') {
        return reply.status(400).send({ message: 'error', error: 'path is required' });
      }

      const wSpreadSheet = dependenciesContainer.resolve('SkSpreadSheet');
      if (!wSpreadSheet) {
        return reply.status(503).send({ message: 'error', error: 'SkSpreadSheet not available' });
      }

      const virtualPath = normalizeSpreadsheetVirtualPath(rawPath);
      const { userEmail } = getSpreadsheetUserContext(request);

      if (!wSpreadSheet.isWorkBookLoadedInWasm(virtualPath)) {
        return reply.status(404).send({
          message: 'error',
          error: 'Workbook not loaded in WASM',
          path: virtualPath,
        });
      }

      await wSpreadSheet.persistWorkBook(virtualPath, userEmail);

      return validateResponse(
        { message: 'success', path: virtualPath, persisted: true },
        'spreadsheet-persist'
      );
    } catch (error) {
      console.error('❌ Error in POST /spreadsheet/persist:', error);
      return reply.status(500).send({
        message: 'error',
        error: 'Failed to persist workbook',
        details: error?.message || String(error),
      });
    }
  });

  // Get detailed information about pool instances
  fastify.get('/spreadsheet/pool/instances', async function (request, reply) {
    try {
      const wSpreadSheet = dependenciesContainer.resolve('SkSpreadSheet');
      if (!wSpreadSheet) {
        return validateResponse({ 
          message: 'error', 
          error: 'SkSpreadSheet not available' 
        }, 'pool-instances-error');
      }

      const pool = wSpreadSheet.getSpreadSheetPool();
      const instances = pool.getAllInstances();
      
      const instanceDetails = instances.map(instance => ({
        id: instance.id,
        health: instance.getHealth(),
        isBusy: instance.isBusy,
        lastUsed: instance.lastUsed,
        usageCount: instance.usageCount,
        errorCount: instance.errorCount
      }));
      
      const result = {
        message: 'success',
        totalInstances: instances.length,
        instances: instanceDetails,
        timestamp: new Date().toISOString()
      };
      
      console.log(`🔍 Pool instances details requested: ${instances.length} instances`);
      return validateResponse(result, 'pool-instances');
      
    } catch (error) {
      console.error('❌ Error getting pool instances:', error);
      return validateResponse({ 
        message: 'error', 
        error: 'Failed to get pool instances',
        details: error.message 
      }, 'pool-instances-error');
    }
  });

  // Get pool configuration
  fastify.get('/spreadsheet/pool/config', async function (request, reply) {
    try {
      const wSpreadSheet = dependenciesContainer.resolve('SkSpreadSheet');
      if (!wSpreadSheet) {
        return validateResponse({ 
          message: 'error', 
          error: 'SkSpreadSheet not available' 
        }, 'pool-config-error');
      }

      const pool = wSpreadSheet.getSpreadSheetPool();
      const config = pool.config;
      
      const result = {
        message: 'success',
        config: {
          minInstances: config.minInstances,
          maxInstances: config.maxInstances,
          instanceTimeout: config.instanceTimeout,
          healthCheckInterval: config.healthCheckInterval,
          loadBalancingStrategy: config.loadBalancingStrategy
        },
        timestamp: new Date().toISOString()
      };
      
      console.log('⚙️ Pool configuration requested');
      return validateResponse(result, 'pool-config');
      
    } catch (error) {
      console.error('❌ Error getting pool config:', error);
      return validateResponse({ 
        message: 'error', 
        error: 'Failed to get pool configuration',
        details: error.message 
      }, 'pool-config-error');
    }
  });

  // Update pool configuration
  fastify.put('/spreadsheet/pool/config', async function (request, reply) {
    try {
      const { minInstances, maxInstances, instanceTimeout, healthCheckInterval, loadBalancingStrategy } = request.body;
      
      const wSpreadSheet = dependenciesContainer.resolve('SkSpreadSheet');
      if (!wSpreadSheet) {
        return validateResponse({ 
          message: 'error', 
          error: 'SkSpreadSheet not available' 
        }, 'pool-config-update-error');
      }

      // Note: This would require adding a method to update pool configuration
      // For now, we'll return the current config
      const pool = wSpreadSheet.getSpreadSheetPool();
      const currentConfig = pool.config;
      
      console.log('⚠️ Pool configuration update requested (not yet implemented)');
      return validateResponse({
        message: 'info',
        info: 'Pool configuration update not yet implemented',
        currentConfig: {
          minInstances: currentConfig.minInstances,
          maxInstances: currentConfig.maxInstances,
          instanceTimeout: currentConfig.instanceTimeout,
          healthCheckInterval: currentConfig.healthCheckInterval,
          loadBalancingStrategy: currentConfig.loadBalancingStrategy
        },
        requestedChanges: request.body,
        timestamp: new Date().toISOString()
      }, 'pool-config-update');
      
    } catch (error) {
      console.error('❌ Error updating pool config:', error);
      return validateResponse({ 
        message: 'error', 
        error: 'Failed to update pool configuration',
        details: error.message 
      }, 'pool-config-update-error');
    }
  });

  // Performance testing route
  fastify.post('/spreadsheet/pool/performance-test', async function (request, reply) {
    try {
      const { testType = 'basic', iterations = 10 } = request.body;
      
      const wSpreadSheet = dependenciesContainer.resolve('SkSpreadSheet');
      if (!wSpreadSheet) {
        return validateResponse({ 
          message: 'error', 
          error: 'SkSpreadSheet not available' 
        }, 'pool-performance-test-error');
      }

      const startTime = Date.now();
      const results = [];
      
      switch (testType) {
        case 'basic':
          // Basic performance test with multiple concurrent operations
          for (let i = 0; i < iterations; i++) {
            const taskStart = Date.now();
            try {
              await wSpreadSheet.executeTask((uISpreadSheet) => {
                // Simulate a simple operation
                return `Task ${i + 1} completed`;
              });
              const taskTime = Date.now() - taskStart;
              results.push({ task: i + 1, success: true, time: taskTime });
            } catch (error) {
              const taskTime = Date.now() - taskStart;
              results.push({ task: i + 1, success: false, error: error.message, time: taskTime });
            }
          }
          break;
          
        case 'stress':
          // Stress test with many concurrent operations
          const promises = [];
          for (let i = 0; i < iterations; i++) {
            promises.push(
              wSpreadSheet.executeTask((uISpreadSheet) => {
                return `Stress test task ${i + 1}`;
              }).then(result => ({ task: i + 1, success: true, result }))
                .catch(error => ({ task: i + 1, success: false, error: error.message }))
            );
          }
          
          const stressResults = await Promise.all(promises);
          results.push(...stressResults);
          break;
          
        default:
          return validateResponse({ 
            message: 'error', 
            error: `Unknown test type: ${testType}. Use 'basic' or 'stress'` 
          }, 'pool-performance-test-error');
      }
      
      const totalTime = Date.now() - startTime;
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.filter(r => !r.success).length;
      const avgTime = results.length > 0 ? results.reduce((sum, r) => sum + (r.time || 0), 0) / results.length : 0;
      
      const poolStats = wSpreadSheet.getPoolStats();
      const poolHealth = wSpreadSheet.getPoolHealth();
      
      const result = {
        message: 'success',
        testType,
        iterations,
        totalTime,
        successCount,
        failureCount,
        avgTime: Math.round(avgTime * 100) / 100,
        results,
        poolStats,
        poolHealth,
        timestamp: new Date().toISOString()
      };
      
      console.log(`🚀 Performance test completed: ${testType} test with ${iterations} iterations in ${totalTime}ms`);
      return validateResponse(result, 'pool-performance-test');
      
    } catch (error) {
      console.error('❌ Error during performance test:', error);
      return validateResponse({ 
        message: 'error', 
        error: 'Failed to execute performance test',
        details: error.message 
      }, 'pool-performance-test-error');
    }
  });

  // Get available routes summary
  fastify.get('/spreadsheet/routes', async function (request, reply) {
    try {
      const routes = {
        message: 'success',
        routes: {
          'GET /spreadsheet/routes': 'Get available routes summary',
          'GET /spreadsheet/pool/stats': 'Get pool statistics',
          'GET /spreadsheet/pool/health': 'Get pool health status',
          'GET /spreadsheet/pool/instances': 'Get detailed pool instances information',
          'GET /spreadsheet/pool/config': 'Get pool configuration',
          'POST /spreadsheet/pool/scale': 'Scale pool up or down',
          'POST /spreadsheet/pool/reset': 'Reset the entire pool',
          'POST /spreadsheet/pool/performance-test': 'Run performance tests',
          'PUT /spreadsheet/pool/config': 'Update pool configuration (not yet implemented)',
          'POST /spreadsheet/operation': 'Execute spreadsheet operations',
          'POST /spreadsheet/call': 'WASM Call() for automation (Value, GetValue, …)',
          'GET /format/debug': 'Dump FormatApi/FormatRoot on all WASM pool instances (no workbook)',
          'POST /spreadsheet/read-workbook': 'Full .sker JSON snapshot (optional sheet filter, for AI)',
          'POST /spreadsheet/paste-range': 'Paste sker cp clipboard (values, formats, formulas) into a range',
          'POST /spreadsheet/paste-grid': 'Paste 2D grid with optional row styles (preferred for new tables)',
          'POST /spreadsheet/write-cells': 'Batch cell writes with single persist',
          'POST /spreadsheet/format-ranges': 'Batch CSS formatting with single persist',
          'POST /spreadsheet/format-range': 'Apply sker CSS formatting to a cell range',
          'POST /spreadsheet/persist': 'Persist WASM workbook to MongoDB',
          'POST /spreadsheet/post': 'Create or update spreadsheet file',
          'GET /spreadsheet/content/:path': 'Stream workbook JSON from Mongo (no server WASM)',
          'POST /spreadsheet/open': 'Start background server WASM load (202 + taskId)',
          'POST /spreadsheet/close': 'Release user from server workbook (embed / teardown)',
          'GET /spreadsheet/tasks/:taskId': 'Poll background load task status',
          'GET /spreadsheet/:path': 'Get spreadsheet by path (legacy, loads server WASM)'
        },
        poolFeatures: [
          'WebAssembly instance pooling',
          'Automatic load balancing',
          'Health monitoring',
          'Auto-scaling',
          'Performance metrics',
          'Graceful error handling'
        ],
        timestamp: new Date().toISOString()
      };
      
      console.log('📋 Routes summary requested');
      return validateResponse(routes, 'routes-summary');
      
    } catch (error) {
      console.error('❌ Error getting routes summary:', error);
      return validateResponse({ 
        message: 'error', 
        error: 'Failed to get routes summary',
        details: error.message 
      }, 'routes-summary-error');
    }
  });

  async function runBackgroundServerWorkbookLoad(fastify, taskId, virtualPath, userEmail, fileRecord) {
    const wSkSpreadSheet = dependenciesContainer.resolve('SkSpreadSheet');
    try {
      if (wSkSpreadSheet.isWorkBookLoadedInWasm(virtualPath)) {
        wSkSpreadSheet.addUserWorkBook(userEmail, virtualPath);
        setLoadTaskReady(taskId);
        console.log(`✅ Workbook already in WASM (task ${taskId}): ${virtualPath}`);
        return;
      }

      const content = await resolveWorkbookContentString(fastify, fileRecord, gridFSBucket);
      if (!content) {
        throw new Error('Workbook content not found');
      }

      console.log(`🔄 Background loadWorkBook (task ${taskId}): ${virtualPath}`);
      await wSkSpreadSheet.loadWorkBook(virtualPath, content);
      wSkSpreadSheet.addUserWorkBook(userEmail, virtualPath);
      setLoadTaskReady(taskId);
      console.log(`✅ Background load complete (task ${taskId}): ${virtualPath}`);
    } catch (err) {
      console.error(`❌ Background load failed (task ${taskId}): ${err?.message || err}`);
      setLoadTaskError(taskId, err?.message || String(err));
    }
  }

  // Raw workbook JSON from Mongo/GridFS — no server WASM (non-blocking for other requests).
  fastify.get('/spreadsheet/content/*', async function (request, reply) {
    try {
      const virtualPath = extractSpreadsheetVirtualPath(request.url, 'content');
      if (!virtualPath) {
        return reply.status(400).send({ message: 'error', error: 'Missing workbook path' });
      }

      const { userEmail, group } = getSpreadsheetUserContext(request);
      const { fileRecord, error, statusCode } = await fetchSpreadsheetFileRecord(
        fastify,
        virtualPath,
        userEmail,
        group
      );

      if (!fileRecord) {
        return reply.status(statusCode || 404).send({
          message: 'error',
          error: error || 'File not found',
          path: virtualPath,
        });
      }

      if (canStreamDirectoryGridFs(fileRecord)) {
        console.log(`📦 Streaming workbook content (GridFS): ${virtualPath}`);
        reply.header('Content-Type', 'application/json; charset=utf-8');
        return reply.send(gridFSBucket.openDownloadStream(fileRecord.gridfsId));
      }

      const content = await resolveWorkbookContentString(fastify, fileRecord, gridFSBucket);
      if (!content) {
        return reply.status(404).send({
          message: 'error',
          error: 'Workbook content not found',
          path: virtualPath,
        });
      }

      console.log(`📄 Serving workbook content (no WASM): ${virtualPath}`);
      return reply
        .header('Content-Type', 'application/json; charset=utf-8')
        .send(content);
    } catch (err) {
      console.error('❌ Error in GET /spreadsheet/content:', err);
      return reply.status(500).send({
        message: 'error',
        error: err?.message || 'Internal server error',
      });
    }
  });

  // Start server-side WASM load in background (collaboration); returns immediately.
  fastify.post('/spreadsheet/open', async function (request, reply) {
    try {
      const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      const rawPath = body?.path;
      if (!rawPath || typeof rawPath !== 'string') {
        return reply.status(400).send({ message: 'error', error: 'Missing path in body' });
      }

      const virtualPath = normalizeSpreadsheetVirtualPath(rawPath);
      const { userEmail, group } = getSpreadsheetUserContext(request);

      const { fileRecord, error, statusCode } = await fetchSpreadsheetFileRecord(
        fastify,
        virtualPath,
        userEmail,
        group
      );

      if (!fileRecord) {
        return reply.status(statusCode || 404).send({
          message: 'error',
          error: error || 'File not found',
          path: virtualPath,
        });
      }

      const wSkSpreadSheet = dependenciesContainer.resolve('SkSpreadSheet');
      if (wSkSpreadSheet.isWorkBookLoadedInWasm(virtualPath)) {
        wSkSpreadSheet.addUserWorkBook(userEmail, virtualPath);
        return reply.send({
          message: 'success',
          taskId: null,
          status: 'ready',
          path: virtualPath,
        });
      }

      const task = createLoadTask(virtualPath);
      setImmediate(() => {
        runBackgroundServerWorkbookLoad(fastify, task.taskId, virtualPath, userEmail, fileRecord);
      });

      console.log(`⏳ Accepted background open (task ${task.taskId}): ${virtualPath}`);
      return reply.status(202).send({
        message: 'accepted',
        taskId: task.taskId,
        status: 'loading',
        path: virtualPath,
      });
    } catch (err) {
      console.error('❌ Error in POST /spreadsheet/open:', err);
      return reply.status(500).send({
        message: 'error',
        error: err?.message || 'Internal server error',
      });
    }
  });

  // Detach current user from a server workbook (text-editor embed teardown).
  // When last user leaves, schedules DeleteWorkBook after unload grace period.
  fastify.post('/spreadsheet/close', async function (request, reply) {
    try {
      const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      const rawPath = body?.path;
      if (!rawPath || typeof rawPath !== 'string') {
        return reply.status(400).send({ message: 'error', error: 'Missing path in body' });
      }

      const virtualPath = normalizeSpreadsheetVirtualPath(rawPath);
      const { userEmail } = getSpreadsheetUserContext(request);
      const wSkSpreadSheet = dependenciesContainer.resolve('SkSpreadSheet');
      if (!wSkSpreadSheet || typeof wSkSpreadSheet.releaseUserFromWorkBook !== 'function') {
        return reply.status(503).send({ message: 'error', error: 'SkSpreadSheet not available' });
      }

      const result = await wSkSpreadSheet.releaseUserFromWorkBook(userEmail, virtualPath, {
        immediate: body?.immediate === true,
      });
      console.log(
        `📕 /spreadsheet/close ${virtualPath} user=${userEmail} released=${result.released} pendingUnload=${Boolean(result.pendingUnload)} unloaded=${Boolean(result.unloaded)}`
      );
      return reply.send({
        message: 'success',
        path: virtualPath,
        ...result,
      });
    } catch (err) {
      console.error('❌ Error in POST /spreadsheet/close:', err);
      return reply.status(500).send({
        message: 'error',
        error: err?.message || 'Internal server error',
      });
    }
  });

  fastify.get('/spreadsheet/tasks/:taskId', async function (request, reply) {
    try {
      const { taskId } = request.params;
      const task = getLoadTask(taskId);
      if (!task) {
        return reply.status(404).send({
          message: 'error',
          error: 'Task not found',
          taskId,
        });
      }
      return reply.send({
        message: 'success',
        ...task,
      });
    } catch (err) {
      console.error('❌ Error in GET /spreadsheet/tasks:', err);
      return reply.status(500).send({
        message: 'error',
        error: err?.message || 'Internal server error',
      });
    }
  });

  // Route handler for spreadsheet files - MUST be registered LAST (after all specific routes)
  // Use a catch-all approach with request.url to handle paths with multiple segments
  fastify.get('/spreadsheet/*', async function (sRequest, sReply) {
    try {
      // Extract full path directly from request URL
      const wUrlPath = parseSpreadsheetRequestUrl(sRequest.url);
      
      // Skip special routes - these should be handled by specific route handlers
      if (isReservedSpreadsheetUrlPath(wUrlPath)) {
        return validateResponse({ 
          message: 'error', 
          error: 'Route not found',
          path: wUrlPath
        }, 'route-skip');
      }
      
      const normalizedPath = normalizeSpreadsheetVirtualPath(wUrlPath);
      
      console.log(`📂 Processing spreadsheet request - Original URL: ${sRequest.url}, Normalized: ${normalizedPath}`);
      
      // Set Query
      const wQuery = { path: normalizedPath }
      const wCollection = fastify.mongo.db.collection('Directory')

      // User context (optional auth)
      const wUserEmail = (sRequest && sRequest.user && sRequest.user.userEmail) ? sRequest.user.userEmail : 'anonymous@local'
      const wGroup = (sRequest && sRequest.user && sRequest.user.group) ? sRequest.user.group : 'default'
      const wSpreadSheet = dependenciesContainer.resolve('SkSpreadSheet');

      const wFileRecord = await wCollection.findOne(wQuery);
      if (!wFileRecord) {
        console.log(`❌ Workbook not found in database: ${wQuery.path}`);
        return validateResponse({
          message: 'error',
          error: 'File not found',
          path: wQuery.path,
        }, 'database-not-found');
      }

      const sharedRoots = await loadSharedDirectoryRoots(fastify.mongo.db);
      if (!checkFilePermissions(wFileRecord, wUserEmail, wGroup, 'read', sharedRoots)) {
        return validateResponse({
          message: 'error',
          error: 'Permission denied',
          path: wQuery.path,
        }, 'permission-denied');
      }

      // Is in memory - Check if workbook exists in memory
      let wWorkBook = wSpreadSheet.getSpreadSheetByPath(wQuery.path);
      if (wWorkBook) {
         try {
           console.log(`📖 Workbook found in memory: ${wQuery.path}`);
           let wFile = await wSpreadSheet.getWorkBookContent(wQuery.path);
           
           // Create a file object with the appropriate structure
           const wFileObj = {
             name: wQuery.path.split('/').pop() || wQuery.path,
             path: wQuery.path,
             content: wFile,
             size: wFile ? wFile.length : 0,
             owner: wUserEmail,
             group: wGroup || 'default',
             isDirectory: false,
             parentId: null,
             permissions: 644,
             createdAt: new Date(),
             updatedAt: new Date()
           };
           
           // Add user to workbook
           wSpreadSheet.addUserWorkBook(wUserEmail, wQuery.path);
           
           // Prepare response
           let wResult = {
             message: 'success',
             file: wFileObj,
             source: 'memory'
           };
           
           console.log(`✅ Returning workbook from memory: ${wQuery.path}`);
           return validateResponse(wResult, 'memory');
         } catch (memoryError) {
           console.error(`❌ Error getting workbook content from memory: ${memoryError.message}`);
           // Fall through to database lookup
         }
      }
    
      // Not in memory - Try to load from database
      try {
        console.log(`🔍 Loading workbook from database: ${wQuery.path}`);
        const wFile = wFileRecord;
      
        if (!wFile) {
          console.log(`❌ Workbook not found in database: ${wQuery.path}`);
          return validateResponse({ 
            message: 'error', 
            error: 'File not found',
            path: wQuery.path
          }, 'database-not-found');
        }

        console.log(`📚 Workbook found in database: ${wQuery.path}`);

        // If file is stored in GridFS, stream it
        if (wFile.gridfsId) {
          console.log(`📦 Streaming GridFS file: ${wQuery.path}`);
          const downloadStream = gridFSBucket.openDownloadStream(wFile.gridfsId);
          return sReply.send(downloadStream);
        }

        // For .sker files: rebuild content from Spreadsheet record (single, canonical path)

        // For .sker files: rebuild content from Spreadsheet record then load (shared util)
        try {
          const isSkerByName = (typeof wFile.name === 'string') && wFile.name.toLowerCase().endsWith('.sker')
          const isSkerByPath = (typeof wFile.path === 'string') && wFile.path.toLowerCase().endsWith('.sker')
          if (!wFile.isDirectory && (isSkerByName || isSkerByPath)) {
            const rebuilt = await rebuildSkerContentFromRecord(fastify, wFile)
            if (rebuilt && rebuilt.content) {
              wFile.content = rebuilt.content
              // Update size if it has changed (e.g., due to info merging)
              // This ensures consistency between load and save operations
              if (rebuilt.size && rebuilt.size !== wFile.size) {
                console.log(`📏 Size changed during rebuild: ${wFile.size} -> ${rebuilt.size}, updating Directory`)
                wFile.size = rebuilt.size
                // Update size in Directory collection to maintain consistency
                await wCollection.updateOne(
                  { _id: wFile._id },
                  { $set: { size: rebuilt.size } }
                )
              } else if (rebuilt.size) {
                wFile.size = rebuilt.size
              }
            }
          }
        } catch (wErrGetSker) {
          console.error('Error rebuilding .sker content in SkSpFastify:', wErrGetSker)
          return validateResponse({ message: 'error', error: wErrGetSker.message, path: wQuery.path }, 'database-rebuild-sker-error')
        }

        // Load the file into the spreadsheet
        console.log(`🔄 Loading workbook into spreadsheet: ${wQuery.path}`);
        let wSkSpreadSheet = dependenciesContainer.resolve('SkSpreadSheet');
        await wSkSpreadSheet.loadWorkBook(wFile.path, wFile.content);

        // Add the user to the workbook & SkChat Server
        wSkSpreadSheet.addUserWorkBook(wUserEmail, wFile.path);

        let wResult = {
          message: 'success',
          file: wFile,
          source: 'database'
        };
        
        console.log(`✅ Returning workbook from database: ${wQuery.path}`);
        return validateResponse(wResult, 'database-loaded');
        
      } catch (wErrorMsg) {
        console.error(`❌ Database operation failed: ${wErrorMsg.message}`);
        // Return error with details
        let wError = {
          message: 'error',
          error: wErrorMsg.message || 'Database operation failed',
          path: wQuery.path,
          details: wErrorMsg.stack
        };
        return validateResponse(wError, 'database-error');
      }
    } catch (outerError) {
      console.error('❌ Critical error in spreadsheet endpoint:', outerError);
      let errorPath = 'unknown';
      try {
        if (sRequest.url) {
          errorPath = sRequest.url.replace(/^\/spreadsheet/, '').replace(/^\//, '');
        }
      } catch (e) {
        // Ignore error in error handling
      }
      return validateResponse({ 
        message: 'error', 
        error: outerError.message || 'Internal server error',
        path: errorPath,
        details: outerError.stack
      }, 'critical-error');
    }
  });


}

export default SkSpFastify;
