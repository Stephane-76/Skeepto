//=====================================================================
// SkSpSpreadSheet.mjs - Adapted to use WebAssembly Instance Pool
//=====================================================================
import dependenciesContainer from '../Depency/SkDepencyManager.mjs';
import SkSpreadSheetPoolInterface from './SkSpreadSheetPoolInterface.mjs';
import { sanitizeWorkbookForServerLoad } from './sanitizeWorkbookForServerLoad.mjs';
import { ObjectId } from '@fastify/mongodb';
import { saveSkerToCollections, rebuildSkerContentFromRecord, loadSpreadsheetDataFromRecord } from './SkSkerStorage.mjs';
import { canWriteVirtualPath } from '../SkVirtualDisk/SkVirtualDiskWriteAccess.mjs';
import { getSkWasmBuildId } from './skWasmSingleton.mjs';

/** Yield the Node event loop so WebSocket pings/pongs can run before sync WASM work. */
function yieldEventLoop() {
    return new Promise((resolve) => setImmediate(resolve));
}

//=====================================================================
// SkWorkBook
//=====================================================================
class SkUser {
    constructor(sUserName, sPath, sTimestamp = Date.now()) {
        this.m_UserName = sUserName;
        this.m_Path = sPath;
        this.m_Timestamp = sTimestamp;
    }

    getUserName() {
        return this.m_UserName;
    }
    getPath() {
        return this.m_Path;
    }
    getTimestamp() {
        return this.m_Timestamp;
    }
}

class SkWorkBook {
    // Single User By WorkBook
    // Multi User By WorkBook Path
    constructor(sPath) {
        this.m_Path = sPath;
        this.m_Users = new Map();
    }
    addUser(sUserName) {
        let wObjUser = new SkUser(sUserName, this.m_Path);
        this.m_Users.set(sUserName,wObjUser);
    }
    deleteUser(sUserName) {
        this.m_Users.delete(sUserName);
    }
    getUser(    sUserName) {
        return this.m_Users.get(sUserName);
    }
    getUsers() {
        return Array.from(this.m_Users.values());
    }
    getPath() {
        return this.m_Path;
    }
    isUserEmpty() {
        return this.m_Users.size === 0;
    }
}

export class SkSpSpreadSheet {
    constructor(options = {}) {
        // Initialize the pool interface instead of single instance
        this.m_SpreadSheetPool = new SkSpreadSheetPoolInterface({
            minInstances: options.minInstances || 3,
            maxInstances: options.maxInstances || 10,
            instanceTimeout: options.instanceTimeout || 600000, // 10 minutes
            healthCheckInterval: options.healthCheckInterval || 60000, // 1 minute
            loadBalancingStrategy: options.loadBalancingStrategy || 'least-busy',
            onCellChange: options.onCellChange || this._defaultOnCellChange.bind(this),
            ...options
        });
        
        this.m_WorkBooks = new Map();
        this.m_Users = new Map();
        
        // Map to track which instance is handling which workbook
        // This ensures consistency: all operations on a workbook use the same instance
        this.m_WorkBookInstanceMap = new Map(); // Path -> Instance ID
        
        /** Debounced Mongo persist after collaborative Do/Undo/Redo. */
        this.m_PersistDebounceTimers = new Map();
        const wDebounceEnv = Number(process.env.SK_PERSIST_DEBOUNCE_MS);
        this.m_PersistDebounceMs =
            Number.isFinite(wDebounceEnv) && wDebounceEnv >= 0
                ? wDebounceEnv
                : options.persistDebounceMs ?? 3000;

        /** Delay DeleteWorkBook after last user leaves (WS refresh / brief disconnect). */
        this.m_WorkBookUnloadTimers = new Map();
        const wGraceEnv = Number(process.env.SK_WORKBOOK_UNLOAD_GRACE_MS);
        this.m_WorkBookUnloadGraceMs =
            Number.isFinite(wGraceEnv) && wGraceEnv >= 0
                ? wGraceEnv
                : options.workbookUnloadGraceMs ?? 45000;
        
        // Register in dependency container
        dependenciesContainer.register("SkSpreadSheet", this);
        dependenciesContainer.register("SkSpreadSheetPool", this.m_SpreadSheetPool.getPool());
        
        console.log('SkSpSpreadSheet initialized with WebAssembly instance pool');
    }

    // Default cell change handler
    _defaultOnCellChange(cellRef, instanceId) {
        //console.log(`Cell changed in instance ${instanceId}:`, cellRef);
    }

    /**
     * Persist workbook to Mongo after collaborative edits (debounced).
     * @param {string} sPath
     * @param {string|null} sUserEmail
     */
    /**
     * Public: request a debounced Mongo persist (coalesces rapid edits into a
     * single WriteJson after idle). Used by AI/MCP tools so a burst of tool calls
     * no longer triggers one full serialization per operation.
     * @param {string} sPath
     * @param {string|null} sUserEmail
     */
    schedulePersistWorkBook(sPath, sUserEmail = null) {
        this._schedulePersistWorkBook(sPath, sUserEmail);
    }

    _schedulePersistWorkBook(sPath, sUserEmail = null) {
        const wPath = this.normalizeWorkBookPath(sPath);
        if (!wPath) {
            return;
        }
        const wExisting = this.m_PersistDebounceTimers.get(wPath);
        if (wExisting) {
            clearTimeout(wExisting);
        }
        const wTimer = setTimeout(async () => {
            this.m_PersistDebounceTimers.delete(wPath);
            try {
                await this.persistWorkBook(wPath, sUserEmail);
            } catch (wErr) {
                console.error(`❌ Debounced persistWorkBook failed for ${wPath}:`, wErr);
            }
        }, this.m_PersistDebounceMs);
        this.m_PersistDebounceTimers.set(wPath, wTimer);
    }

    /**
     * Cancel a pending WASM unload for this workbook (user re-opened or rejoined).
     * @param {string} sPath
     */
    _cancelScheduledWorkBookUnload(sPath) {
        const wPath = this.normalizeWorkBookPath(sPath);
        const wTimer = this.m_WorkBookUnloadTimers.get(wPath);
        if (!wTimer) {
            return;
        }
        clearTimeout(wTimer);
        this.m_WorkBookUnloadTimers.delete(wPath);
        console.log(`↩️ Workbook unload cancelled (user rejoined): ${wPath}`);
    }

    /**
     * Schedule WASM DeleteWorkBook after grace period when no users remain on the workbook.
     * @param {string} sPath
     * @param {string|null} sUserEmail
     */
    _scheduleWorkBookUnload(sPath, sUserEmail = null) {
        const wPath = this.normalizeWorkBookPath(sPath);
        if (!wPath) {
            return;
        }
        this._cancelScheduledWorkBookUnload(wPath);
        const wGraceSec = Math.round(this.m_WorkBookUnloadGraceMs / 1000);
        console.log(
            `⏳ Workbook ${wPath} unload scheduled in ${wGraceSec}s (SK_WORKBOOK_UNLOAD_GRACE_MS)`
        );
        const wTimer = setTimeout(() => {
            this._finalizeWorkBookUnload(wPath, sUserEmail).catch((wErr) => {
                console.error(`❌ finalizeWorkBookUnload failed for ${wPath}:`, wErr);
            });
        }, this.m_WorkBookUnloadGraceMs);
        this.m_WorkBookUnloadTimers.set(wPath, wTimer);
    }

    /**
     * Persist and remove workbook from WASM after grace period (skip if users rejoined).
     * @param {string} sPath
     * @param {string|null} sUserEmail
     */
    async _finalizeWorkBookUnload(sPath, sUserEmail = null) {
        const wPath = this.normalizeWorkBookPath(sPath);
        this.m_WorkBookUnloadTimers.delete(wPath);

        const wWorkBook = this.m_WorkBooks.get(wPath);
        if (!wWorkBook || !wWorkBook.isUserEmpty()) {
            console.log(`⏭️ Workbook unload skipped — users active again: ${wPath}`);
            return;
        }

        if (!this.m_WorkBookInstanceMap.has(wPath)) {
            this.m_WorkBooks.delete(wPath);
            return;
        }

        try {
            await this.persistWorkBook(wPath, sUserEmail);
        } catch (sError) {
            console.error(`❌ Error persisting workbook before unload ${wPath}:`, sError);
        }

        try {
            await this.executeTaskForWorkBook(wPath, (uISpreadSheet) =>
                uISpreadSheet.DeleteWorkBook(wPath)
            );

            this.m_WorkBooks.delete(wPath);
            const wInstanceId = this.m_WorkBookInstanceMap.get(wPath);
            this.m_WorkBookInstanceMap.delete(wPath);

            if (wInstanceId) {
                const wHasOtherWorkbooks = Array.from(this.m_WorkBookInstanceMap.values()).includes(
                    wInstanceId
                );
                if (!wHasOtherWorkbooks) {
                    console.log(
                        `📭 Instance ${wInstanceId} has no more workbooks assigned (will be cleaned up by timeout if unused)`
                    );
                }
            }
            console.log(`🗑️ Workbook unloaded from WASM after grace period: ${wPath}`);
        } catch (error) {
            console.error(`❌ Error deleting workbook ${wPath}:`, error);
        }
    }

    // Initialize the SpreadSheet WASM Pool
    async initializeSkerSpreadSheet() {
        try {
            console.log('Initializing WebAssembly instance pool...');
            await this.m_SpreadSheetPool.initializeSkerSpreadSheet();
            console.log('WebAssembly instance pool initialized successfully');
            
            // Set up pool event listeners
            this._setupPoolEventListeners();
            
        } catch (error) {
            console.error('Error initializing WebAssembly instance pool:', error);
            throw error;
        }
    }

    // Set up pool event listeners
    _setupPoolEventListeners() {
        const pool = this.m_SpreadSheetPool.getPool();
        
        pool.on('poolReady', () => {
            console.log('🚀 WebAssembly instance pool is ready');
        });
        
        pool.on('instanceCreated', ({ id }) => {
            console.log(`➕ New WebAssembly instance created: ${id}`);
        });
        
        pool.on('instanceRemoved', ({ id }) => {
            console.log(`➖ WebAssembly instance removed: ${id}`);
        });
        
        pool.on('poolError', (error) => {
            console.error('❌ Pool error:', error);
        });
    }

    // Get the SpreadSheet Pool Interface
    getSpreadSheetPool() {
        return this.m_SpreadSheetPool;
    }

    // Get a specific instance (for advanced usage)
    async getInstance() {
        return this.m_SpreadSheetPool.getInstance();
    }

    // Execute a task using an available instance from the pool
    async executeTask(task, ...args) {
        return this.m_SpreadSheetPool.executeTask(task, ...args);
    }

    normalizeWorkBookPath(sPath) {
        if (typeof sPath !== 'string') return '';
        let wPath = sPath.trim();
        if (wPath === '') return '';
        try {
            wPath = decodeURIComponent(wPath);
        } catch (_) {
            // Keep original path when it is not URI-encoded
        }
        if (!wPath.startsWith('/')) {
            wPath = `/${wPath}`;
        }
        return wPath;
    }

    /**
     * Create a blank workbook in WASM and return canonical .sker JSON for Virtual Disk persistence.
     * @param {string} sPath — Virtual Disk path used as workbook URI (e.g. /Documents/Untitled.sker)
     * @param {{ author?: string, email?: string }} sUserInfo — optional metadata for info.author / info.email
     */
    async createNewWorkBookJson(sPath, sUserInfo = {}) {
        const wPath = this.normalizeWorkBookPath(sPath);
        if (!wPath) {
            throw new Error('Workbook path is required');
        }

        const wJsonStr = await this.executeTask((uISpreadSheet) => {
            const wOk = uISpreadSheet.NewWorkBook(wPath);
            if (!wOk) {
                throw new Error(`NewWorkBook failed for ${wPath}`);
            }
            const wJson = uISpreadSheet.WriteJson(wPath);
            if (!wJson || typeof wJson !== 'string' || wJson.trim() === '') {
                throw new Error(`WriteJson returned empty for ${wPath}`);
            }
            return wJson;
        });

        let wParsed;
        try {
            wParsed = JSON.parse(wJsonStr);
        } catch (parseError) {
            throw new Error(`Invalid JSON from WriteJson: ${parseError.message}`);
        }

        // Canonical URI is the Virtual Disk path, not the user email.
        wParsed.uri = wPath;

        const wAuthor = typeof sUserInfo.author === 'string' ? sUserInfo.author.trim() : '';
        const wEmail = typeof sUserInfo.email === 'string' ? sUserInfo.email.trim() : '';
        if (wAuthor || wEmail) {
            wParsed.info = {
                ...(wParsed.info && typeof wParsed.info === 'object' ? wParsed.info : {}),
                ...(wAuthor ? { author: wAuthor } : {}),
                ...(wEmail ? { email: wEmail } : {}),
            };
        }

        if (!Array.isArray(wParsed.sheets) || wParsed.sheets.length === 0) {
            throw new Error(`New workbook has no sheets: ${wPath}`);
        }

        return JSON.stringify(wParsed);
    }
    
    // Execute a task on a specific workbook's assigned instance
    async executeTaskForWorkBook(sPath, task, ...args) {
        const wPath = this.normalizeWorkBookPath(sPath);
        const wInstanceId = this.m_WorkBookInstanceMap.get(wPath);
        
        if (!wInstanceId) {
            console.warn(`⚠️ No instance assigned for workbook ${wPath}, using pool`);
            try {
                // Try to (re)assign the workbook by reloading it from Directory/Spreadsheet storage.
                const wMongoDb = dependenciesContainer.resolve("MongoDb");
                if (wMongoDb) {
                    const wCollection = wMongoDb.db.collection('Directory');
                    const wExisting = await wCollection.findOne({ path: wPath });
                    if (wExisting) {
                        let wContent = null;
                        if (!wExisting.isDirectory && wExisting.name && wExisting.name.toLowerCase().endsWith('.sker') && wExisting.record) {
                            const wSpreadsheetCollection = wMongoDb.db.collection('Spreadsheet');
                            const wRecordDoc = await wSpreadsheetCollection.findOne({ _id: new ObjectId(String(wExisting.record)) });
                            const wSpreadsheetData = await loadSpreadsheetDataFromRecord(
                                { mongo: { db: wMongoDb.db } },
                                wRecordDoc
                            );
                            if (wSpreadsheetData) {
                                const wFull = { ...(wSpreadsheetData || {}), ...(wExisting.info ? { info: wExisting.info } : {}) };
                                if (!wFull.uri) wFull.uri = wPath;
                                wContent = JSON.stringify(wFull);
                            }
                        } else if (wExisting.content) {
                            wContent = wExisting.content;
                        }
                        if (wContent) {
                            await this.loadWorkBook(wPath, wContent);
                            const wNewInstanceId = this.m_WorkBookInstanceMap.get(wPath);
                            if (wNewInstanceId) {
                                const wPool = this.m_SpreadSheetPool.getPool();
                                const wNewInstance = wPool.instances.get(wNewInstanceId);
                                if (wNewInstance) {
                                    console.log(`✅ Successfully reassigned workbook ${wPath} to instance ${wNewInstanceId}`);
                                    return wNewInstance.execute(task, ...args);
                                }
                            }
                        }
                    }
                }
            } catch (reassignError) {
                console.error(`❌ Failed to reassign instance for workbook ${wPath}:`, reassignError);
            }
            
            // Fallback to pool
            return this.m_SpreadSheetPool.executeTask(task, ...args);
        }
        
        const wPool = this.m_SpreadSheetPool.getPool();
        const wInstances = wPool.instances;
        const wInstance = wInstances.get(wInstanceId);
        
        if (!wInstance) {
            console.warn(`⚠️ Instance ${wInstanceId} not found for workbook ${wPath}, using pool`);
            this.m_WorkBookInstanceMap.delete(wPath);
            return this.m_SpreadSheetPool.executeTask(task, ...args);
        }
        
        // Execute on the specific instance, ensuring the correct workbook is active
        return wInstance.execute((uISpreadSheet) => {
            // CRITICAL: Always set the active workbook before executing the task
            // This ensures isolation when multiple workbooks share the same instance
            const wOk = uISpreadSheet.SetActiveWorkBook(wPath);
            if (!wOk) {
                console.error(`❌ Error: SetActiveWorkBook failed for ${wPath} in instance ${wInstanceId}`);
            }
            // Execute the user's task
            return task(uISpreadSheet, ...args);
        });
    }

    // Get pool statistics (enriched with workbook paths assigned to each instance)
    getPoolStats() {
        const wStats = this.m_SpreadSheetPool.getStats();
        const wByInstance = new Map();
        for (const [wPath, wInstanceId] of this.m_WorkBookInstanceMap.entries()) {
            const wKey = String(wInstanceId);
            if (!wByInstance.has(wKey)) {
                wByInstance.set(wKey, []);
            }
            wByInstance.get(wKey).push(wPath);
        }

        const wInstanceDetails = (wStats.instanceDetails || []).map((wDetail) => {
            const wWorkbooks = wByInstance.get(String(wDetail.id)) || [];
            const wNames = wWorkbooks.map((p) => {
                const parts = String(p).split('/').filter(Boolean);
                return parts.length ? parts[parts.length - 1] : p;
            });
            return {
                ...wDetail,
                workbooks: wWorkbooks,
                workbook: wWorkbooks.join(', '),
                workbookName: wNames.join(', ') || '—',
            };
        });

        return {
            ...wStats,
            wasmVersion: getSkWasmBuildId() || null,
            instanceDetails: wInstanceDetails,
            workbooks: Array.from(this.m_WorkBookInstanceMap.entries()).map(([path, instanceId]) => ({
                path,
                instanceId: String(instanceId),
            })),
        };
    }

    // Get pool health status
    getPoolHealth() {
        return this.m_SpreadSheetPool.getHealth();
    }

    /**
     * Dump FormatApi / FormatRoot on every WASM pool instance (no workbook load).
     * Use after close to verify formats were released (empty === true / totalCount === 0).
     * Also reports JS-tracked workbooks still mapped to the pool (helps diagnose non-zero counts).
     * @returns {Promise<{ instances: Array<{id:string,count:number,debug:string,workbooks:string[]}>, totalCount: number, empty: boolean, hasFormatCount: boolean, workbooks: object[], pendingUnloads: string[] }>}
     */
    async debugFormatApiAllInstances() {
        const wPool = this.m_SpreadSheetPool?.getPool?.();
        if (!wPool || !wPool.instances) {
            throw new Error('WASM pool not available');
        }
        const wInstances = Array.from(wPool.instances.values());
        const wResults = [];

        // JS-side map: which workbook paths are still assigned to which pool instance.
        const wWorkbooksByInstance = new Map();
        for (const [wPath, wInstanceId] of this.m_WorkBookInstanceMap.entries()) {
            const wKey = String(wInstanceId);
            if (!wWorkbooksByInstance.has(wKey)) {
                wWorkbooksByInstance.set(wKey, []);
            }
            const wMeta = this.m_WorkBooks.get(wPath);
            const wUsers =
                wMeta && typeof wMeta.getUsers === 'function'
                    ? wMeta.getUsers()
                    : wMeta?.m_Users
                      ? Array.from(wMeta.m_Users)
                      : [];
            wWorkbooksByInstance.get(wKey).push({
                path: wPath,
                users: Array.isArray(wUsers) ? wUsers : [],
                userEmpty: wMeta && typeof wMeta.isUserEmpty === 'function' ? wMeta.isUserEmpty() : null,
            });
        }

        for (const wInstance of wInstances) {
            const wInstId = String(wInstance.id);
            const wOne = await wInstance.execute((uISpreadSheet) => {
                const wCount =
                    typeof uISpreadSheet.FormatCount === 'function'
                        ? Number(uISpreadSheet.FormatCount())
                        : -1;
                let wDebug = '';
                if (typeof uISpreadSheet.DebugFormat === 'function') {
                    const wRet = uISpreadSheet.DebugFormat();
                    wDebug = wRet == null ? '' : String(wRet);
                }
                return {
                    count: Number.isFinite(wCount) ? wCount : -1,
                    debug: wDebug,
                };
            });
            const wBooks = wWorkbooksByInstance.get(wInstId) || [];
            wResults.push({
                id: wInstId,
                count: wOne.count,
                debug: wOne.debug,
                workbooks: wBooks.map((b) => b.path),
                workbookDetails: wBooks,
            });
        }

        const wHasFormatCount =
            wResults.length > 0 && wResults.every((r) => r.count >= 0);
        const wTotal = wResults.reduce(
            (sum, r) => sum + (r.count > 0 ? r.count : 0),
            0
        );

        const wPendingUnloads = Array.from(this.m_WorkBookUnloadTimers.keys());
        const wAllWorkbooks = Array.from(this.m_WorkBooks.keys()).map((wPath) => ({
            path: wPath,
            instanceId: this.m_WorkBookInstanceMap.get(wPath) ?? null,
            pendingUnload: wPendingUnloads.includes(wPath),
        }));

        return {
            instances: wResults,
            totalCount: wTotal,
            hasFormatCount: wHasFormatCount,
            // Only claim empty when FormatCount is available and every instance reports 0.
            empty: wHasFormatCount && wResults.every((r) => r.count === 0),
            workbooks: wAllWorkbooks,
            pendingUnloads: wPendingUnloads,
            unloadGraceMs: this.m_WorkBookUnloadGraceMs,
        };
    }

    // Legacy method for backward compatibility
    getUISpreadSheet() {
        console.warn('getUISpreadSheet() is deprecated. Use executeTask() instead for better performance.');
        // Return a proxy that executes tasks through the pool
        return new Proxy({}, {
            get: (target, prop) => {
                if (typeof prop === 'string') {
                    return async (...args) => {
                        return this.executeTask((uISpreadSheet) => {
                            if (typeof uISpreadSheet[prop] === 'function') {
                                return uISpreadSheet[prop](...args);
                            } else {
                                throw new Error(`❌ Method ${prop} not found on UISpreadSheet`);
                            }
                        });
                    };
                }
            }
        });
    }   
    
    addUserWorkBook(sUser, sPath) {
        const wPath = this.normalizeWorkBookPath(sPath);
        this._cancelScheduledWorkBookUnload(wPath);

        let wWorkBook = this.m_WorkBooks.get(wPath);   
        if (!wWorkBook) {
            wWorkBook = new SkWorkBook(wPath);
            this.m_WorkBooks.set(wPath, wWorkBook);
            console.log(`📓 Created workbook entry in memory: ${wPath}`);
        }
        
        // If this user was attached to another workbook, detach so that book can unload.
        const wPrevUser = this.m_Users.get(sUser);
        if (wPrevUser) {
            const wPrevPath = this.normalizeWorkBookPath(wPrevUser.getPath());
            if (wPrevPath && wPrevPath !== wPath) {
                const wPrevBook = this.m_WorkBooks.get(wPrevPath);
                if (wPrevBook) {
                    wPrevBook.deleteUser(sUser);
                    if (wPrevBook.isUserEmpty()) {
                        if (this.m_WorkBookUnloadGraceMs === 0) {
                            void this._finalizeWorkBookUnload(wPrevPath, sUser);
                        } else {
                            this._scheduleWorkBookUnload(wPrevPath, sUser);
                        }
                    }
                }
            }
            wWorkBook.deleteUser(sUser);
        }

        const wUser = new SkUser(sUser, wPath);
        wWorkBook.addUser(sUser);
        this.m_Users.set(sUser, wUser);
        
        // Check if workbook has an instance assigned
        const wInstanceId = this.m_WorkBookInstanceMap.get(wPath);
        if (!wInstanceId) {
            console.log(`ℹ️ Workbook ${wPath} has no instance assigned yet (will be assigned on first access)`);
        }
    }

    /**
     * Detach a user from a workbook without requiring chat leave.
     * Schedules WASM DeleteWorkBook when no users remain (text-editor embed teardown).
     * @param {string} sUser
     * @param {string} sPath
     * @param {{ immediate?: boolean }} [options]
     */
    async releaseUserFromWorkBook(sUser, sPath, options = {}) {
        const wPath = this.normalizeWorkBookPath(sPath);
        if (!wPath || !sUser) {
            return { released: false, unloaded: false };
        }

        const wWorkBook = this.m_WorkBooks.get(wPath);
        if (wWorkBook) {
            wWorkBook.deleteUser(sUser);
        }

        const wUser = this.m_Users.get(sUser);
        if (wUser && this.normalizeWorkBookPath(wUser.getPath()) === wPath) {
            this.m_Users.delete(sUser);
        }

        if (!wWorkBook) {
            return { released: true, unloaded: false };
        }

        if (!wWorkBook.isUserEmpty()) {
            return { released: true, unloaded: false };
        }

        const wImmediate = options.immediate === true || this.m_WorkBookUnloadGraceMs === 0;
        if (wImmediate) {
            await this._finalizeWorkBookUnload(wPath, sUser);
            return { released: true, unloaded: true };
        }
        this._scheduleWorkBookUnload(wPath, sUser);
        return { released: true, unloaded: false, pendingUnload: true };
    }

    getSpreadSheetByPath(sPath) {
        return this.m_WorkBooks.get(sPath);
    }

    /** Emails currently attached to the given workbook (empty array when nobody is collaborating). */
    getActiveUsersForWorkBook(sPath) {
        const wPath = this.normalizeWorkBookPath(sPath);
        const wWorkBook = this.m_WorkBooks.get(wPath);
        if (!wWorkBook || wWorkBook.isUserEmpty()) {
            return [];
        }
        return Array.from(wWorkBook.m_Users.keys());
    }

    /** True when WASM already holds this workbook (server-side collaboration ready). */
    isWorkBookLoadedInWasm(sPath) {
        return this.m_WorkBookInstanceMap.has(sPath);
    }

    /**
     * Drop in-memory workbook entry and WASM copy so GET /spreadsheet reloads from Mongo.
     * Call after virtual disk overwrites a .sker (POST /files) so clients do not keep stale JSON.
     */
    async invalidateWorkBookCache(sPath) {
        if (!sPath || typeof sPath !== 'string') {
            return;
        }
        const normalized = sPath.startsWith('/') ? sPath : `/${sPath}`;
        this._cancelScheduledWorkBookUnload(normalized);
        const hasBook = this.m_WorkBooks.has(normalized);
        const hasInst = this.m_WorkBookInstanceMap.has(normalized);
        if (!hasBook && !hasInst) {
            return;
        }
        if (hasInst) {
            try {
                await this.executeTaskForWorkBook(normalized, (uISpreadSheet) => {
                    try {
                        uISpreadSheet.DeleteWorkBook(normalized);
                    } catch (e) {
                        console.warn(`invalidateWorkBookCache DeleteWorkBook ${normalized}:`, e?.message || e);
                    }
                    return true;
                });
            } catch (e) {
                console.warn(`invalidateWorkBookCache executeTaskForWorkBook ${normalized}:`, e?.message || e);
            }
        }
        this.m_WorkBooks.delete(normalized);
        this.m_WorkBookInstanceMap.delete(normalized);
        console.log(`🗑️ Invalidated spreadsheet cache for ${normalized}`);
    }

    //Chat Receive Message Reroute to the SpreadSheet
    async chatReceiveMessage(sMessage) {
        console.log("SpreadSheet Receive Message",sMessage);
        let wObjMessage = JSON.parse(sMessage);
        
        // Determine the workbook path from the message
        // For cursor messages, uri might be user email, so get path from user
        let wWorkBookPath = wObjMessage.uri;
        
        // If URI is already a valid file path (starts with /), use it directly
        if (wWorkBookPath && wWorkBookPath.startsWith('/')) {
            // Already a valid path, use it as-is
            console.log(`📁 Message URI is a file path: ${wWorkBookPath}`);
        }
        // If uri looks like an email (contains @), try to get path from user
        else if (wWorkBookPath && wWorkBookPath.includes('@')) {
            // Try with the URI as-is first
            let wUser = this.m_Users.get(wWorkBookPath);
            
            // If not found and message has user object with m_Email, try with that email
            if (!wUser && wObjMessage.user && wObjMessage.user.m_Email) {
                const wUserEmail = wObjMessage.user.m_Email;
                console.log(`📧 Trying with user email from message: ${wUserEmail} (URI was: ${wWorkBookPath})`);
                wUser = this.m_Users.get(wUserEmail);
                if (wUser) {
                    wWorkBookPath = wUser.getPath();
                    console.log(`✅ Found user with email ${wUserEmail}, using workbook path: ${wWorkBookPath}`);
                }
            }
            
            // If still not found, try to find user by searching all users
            if (!wUser) {
                // Search for user with similar email (might be a typo or variation)
                for (const [email, user] of this.m_Users.entries()) {
                    if (email.includes(wWorkBookPath.split('@')[0]) || wWorkBookPath.includes(email.split('@')[0])) {
                        wUser = user;
                        wWorkBookPath = user.getPath();
                        console.log(`📧 Found user with similar email ${email}, using workbook path: ${wWorkBookPath}`);
                        break;
                    }
                }
            }
            
            if (wUser) {
                wWorkBookPath = wUser.getPath();
                console.log(`📧 Message URI was email (${wObjMessage.uri}), using workbook path: ${wWorkBookPath}`);
            } else {
                console.warn(`⚠️ User ${wWorkBookPath} not found in m_Users, cannot determine workbook path`);
                console.warn(`   Available users: ${Array.from(this.m_Users.keys()).join(', ')}`);
                // Try to extract from message if it has sheet info
                if (wObjMessage.sheet) {
                    console.warn(`   Message has sheet: ${wObjMessage.sheet}, but cannot determine workbook path`);
                }
                // Don't return immediately - maybe we can still process if URI is actually a path
                // But log available workbooks for debugging
                console.warn(`   Available workbooks: ${Array.from(this.m_WorkBooks.keys()).join(', ')}`);
            }
        }
        
        // Validate workbook path
        if (!wWorkBookPath || wWorkBookPath === '') {
            console.warn(`⚠️ Cannot determine workbook path from message:`, wObjMessage);
            return;
        }
        wWorkBookPath = this.normalizeWorkBookPath(wWorkBookPath);
        
        if ((wObjMessage.op==="Do") || (wObjMessage.op==="Undo") || (wObjMessage.op==="Redo")) {
            // CRITICAL: Use the same instance assigned to this workbook
            try {
                await this.executeTaskForWorkBook(wWorkBookPath, (uISpreadSheet) => {
                    // Set active workbook
                    const wOk = uISpreadSheet.SetActiveWorkBook(wWorkBookPath);
                    if (!wOk) {  
                        console.error(`❌ Error: SetActiveWorkBook failed for ${wWorkBookPath}`);
                        return false;
                    }
                    
                    // Execute the message operation on the same instance
                    const wOk2 = uISpreadSheet.GetMessage(sMessage);
                    if (!wOk2) {
                        console.error("❌ Error: GetMessage failed");
                        return false;
                    }
                    // GetMessage already recalculates the undo's dependents. A full RecalculateAll
                    // on a million-cell book blocks the Node thread for minutes and delays persist
                    // (GridFS rewrite) so the next GET /spreadsheet/content can miss the file.
                    
                    return true;
                });
            } catch (error) {
                console.error(`❌ Error executing spreadsheet operation for ${wWorkBookPath}:`, error);
            }
            const wActorEmail =
                (wObjMessage.user && wObjMessage.user.m_Email) ||
                (wObjMessage.em && typeof wObjMessage.em === 'string' ? wObjMessage.em : null);
            this._schedulePersistWorkBook(wWorkBookPath, wActorEmail);
        }   
        
        if (wObjMessage.op==="Save") {
            const wSaveActor =
                (wObjMessage.user && wObjMessage.user.m_Email) ||
                (wWorkBookPath && wWorkBookPath.includes('@') ? wWorkBookPath : null);
            if (wSaveActor) {
                const wMongoDb = dependenciesContainer.resolve('MongoDb');
                const wMayWrite = await canWriteVirtualPath(
                    wMongoDb.db,
                    wWorkBookPath,
                    wSaveActor
                );
                if (!wMayWrite) {
                    console.log(
                        `⏭️ Save ignored (read-only): ${wWorkBookPath} user=${wSaveActor}`
                    );
                    return;
                }
            }
            // CRITICAL: Use the same instance assigned to this workbook
            try {
                // Get workbook content from the instance
                await this.executeTaskForWorkBook(wWorkBookPath, (uISpreadSheet) => {
                    const wWorkBookJson = uISpreadSheet.JsonWorkBooks();
                    console.log("SpreadSheet WorkBookJson",wWorkBookJson);
                    
                    const wJson = uISpreadSheet.WriteJson(wWorkBookPath);
                    let wObjFile = JSON.parse(wJson);
                    console.log("--->Save",wObjFile.uri); 
                    console.log("   Info=",wObjFile.info); 
                });
                
                // Persist the workbook to the virtual directory (MongoDB Directory collection)
                console.log(`💾 Persisting workbook to virtual directory: ${wWorkBookPath}`);
                await this.persistWorkBook(wWorkBookPath);
                console.log(`✅ Workbook saved successfully: ${wWorkBookPath}`);
            } catch (error) {
                console.error("❌ Error saving workbook:", error);
                throw error; // Re-throw to allow caller to handle the error
            }
        }
    }

    // Chat Join
    async chatJoin(sUser) { 
        console.log("Chat Join",sUser);
        if (this.m_Users.get(sUser)) {
            console.log("Warning: chatJoin User already exists",sUser);
            return;
        }
        const wUser = new SkUser(sUser,"");
        this.m_Users.set(sUser,wUser);
    }

    // Chat Leave
    async chatLeave(sUser) {
        console.log("Chat Leave", sUser);
        const wUser = this.m_Users.get(sUser);
        if (!wUser) {
            console.log("❌ Error: chatLeave User not found",sUser);
            return;
        }
        const sPath = wUser.getPath();
        this.m_Users.delete(sUser);

        const wWorkBook = this.m_WorkBooks.get(sPath);
        if (!wWorkBook) {
            return;
        }
        wWorkBook.deleteUser(sUser);
        if (wWorkBook.isUserEmpty()) {
            try {
                await this.persistWorkBook(sPath, sUser);
            } catch (sError) {
                console.error("❌ Error persisting workbook:", sError);
            }

            if (this.m_WorkBookUnloadGraceMs === 0) {
                await this._finalizeWorkBookUnload(sPath, sUser);
            } else {
                this._scheduleWorkBookUnload(sPath, sUser);
            }
        }
    }
    //Chat Send Message
    async chatSendMessage(sMessage) {
        console.log("Chat Send Message",sMessage);
    }

    // Load a WorkBook from the WebInterface
    async loadWorkBook(sPath, sContent) {
        try {
            // Check if workbook already has an instance assigned
            const wExistingInstanceId = this.m_WorkBookInstanceMap.get(sPath);
            if (wExistingInstanceId) {
                console.log(`ℹ️ Workbook ${sPath} already has instance ${wExistingInstanceId} assigned`);
                return;
            }
            
            // CRITICAL: Force creation of a new instance for each workbook to ensure isolation
            const wPool = this.m_SpreadSheetPool.getPool();
            let wInstance = null;
            let wInstanceId = null;
            
            // Get all currently assigned instance IDs
            const wAssignedInstanceIds = new Set(this.m_WorkBookInstanceMap.values());
            const wAllInstances = Array.from(wPool.instances.values());
            const wMaxInstances = wPool.config?.maxInstances || 10;
            
            // Try to find an instance that has no workbooks assigned to it
            const wUnassignedInstance = wAllInstances.find(inst => 
                !inst.isBusy && 
                inst.getHealth().isHealthy && 
                !wAssignedInstanceIds.has(inst.id)
            );
            
            if (wUnassignedInstance) {
                wInstance = wUnassignedInstance;
                wInstanceId = wInstance.id;
                console.log(`📌 Using unassigned instance ${wInstanceId} for workbook ${sPath}`);
            } else if (wPool.instances.size < wMaxInstances) {
                // Force creation of a new instance for this workbook
                console.log(`🆕 Creating NEW instance for workbook ${sPath} (current: ${wPool.instances.size}/${wMaxInstances})`);
                wInstance = await wPool._createInstance();
                wInstanceId = wInstance.id;
                console.log(`✅ Created instance ${wInstanceId} for workbook ${sPath}`);
            } else {
                // At max capacity - we have to share, but log a warning
                console.warn(`⚠️ Max instances reached (${wPool.instances.size}/${wMaxInstances}), workbook ${sPath} will share an instance`);
                // Find the instance with the fewest workbooks assigned
                const wInstanceWorkbookCount = new Map();
                for (const [path, instId] of this.m_WorkBookInstanceMap.entries()) {
                    wInstanceWorkbookCount.set(instId, (wInstanceWorkbookCount.get(instId) || 0) + 1);
                }
                
                // Get available instances sorted by workbook count
                const wAvailableInstances = wAllInstances
                    .filter(inst => !inst.isBusy && inst.getHealth().isHealthy)
                    .sort((a, b) => {
                        const countA = wInstanceWorkbookCount.get(a.id) || 0;
                        const countB = wInstanceWorkbookCount.get(b.id) || 0;
                        return countA - countB;
                    });
                
                if (wAvailableInstances.length > 0) {
                    wInstance = wAvailableInstances[0];
                    wInstanceId = wInstance.id;
                    const wWorkbookCount = wInstanceWorkbookCount.get(wInstanceId) || 0;
                    console.log(`📊 Assigning workbook ${sPath} to instance ${wInstanceId} (already has ${wWorkbookCount} workbook(s))`);
                } else {
                    // Fallback to pool strategy
                    wInstance = await this.m_SpreadSheetPool.getInstance();
                    wInstanceId = wInstance.id;
                    console.log(`⚠️ Using pool strategy for workbook ${sPath}, assigned to instance ${wInstanceId}`);
                }
            }
            
            // Log content details before loading
            const wContentLength = typeof sContent === 'string' ? sContent.length : JSON.stringify(sContent).length;
            const wContentSize = Buffer.byteLength(typeof sContent === 'string' ? sContent : JSON.stringify(sContent), 'utf8');
            console.log(`📥 loadWorkBook for ${sPath}:`);
            console.log(`   Content length: ${wContentLength} chars`);
            console.log(`   Content size: ${wContentSize} bytes`);
            console.log(`   Content type: ${typeof sContent}`);
            if (typeof sContent === 'string' && sContent.length > 0) {
                try {
                    const wParsed = JSON.parse(sContent);
                    console.log(`   JSON keys: ${Object.keys(wParsed).join(', ')}`);
                    if (wParsed.sheets) {
                        console.log(`   Number of sheets: ${Array.isArray(wParsed.sheets) ? wParsed.sheets.length : 'N/A'}`);
                    }
                } catch (parseError) {
                    console.log(`   Could not parse JSON: ${parseError.message}`);
                }
            }
            
            const wSanitizedContent = sanitizeWorkbookForServerLoad(sContent);

            // Let pending I/O (WebSocket keep-alive, HTTP) run before blocking WASM ReadJson.
            await yieldEventLoop();

            // Execute all operations on the reserved instance
            await wInstance.execute((uISpreadSheet) => {
                uISpreadSheet.AddWorkBook(sPath);
                const wReadResult = uISpreadSheet.ReadJson(wSanitizedContent);
                if (!wReadResult) {
                    console.error(`❌ ReadJson failed for ${sPath}`);
                    throw new Error(`ReadJson failed for ${sPath}`);
                }
                
                // CRITICAL: Set the workbook as active after ReadJson
                // This ensures WriteJson can retrieve the sheets correctly
                const wOk = uISpreadSheet.SetActiveWorkBook(sPath);
                if (!wOk) {
                    console.error(`❌ SetActiveWorkBook failed for ${sPath} after ReadJson`);
                    throw new Error(`SetActiveWorkBook failed for ${sPath} after ReadJson`);
                }
                console.log(`✅ SetActiveWorkBook succeeded for ${sPath}`);
                //console.log("SetActiveWorkBook result:",sContent);
                // Verify that sheets were loaded correctly
                try {
                    const wSheetsListStr = uISpreadSheet.SheetsList();
                    if (wSheetsListStr) {
                        try {
                            const wSheetsListParsed = JSON.parse(wSheetsListStr);
                            const wSheetsList = wSheetsListParsed.list || wSheetsListParsed;
                            if (Array.isArray(wSheetsList) && wSheetsList.length > 0) {
                                console.log(`✅ SheetsList verified: ${wSheetsList.length} sheet(s) loaded for ${sPath}`);
                            } else {
                                console.warn(`⚠️ SheetsList is empty after ReadJson for ${sPath}`);
                            }
                        } catch (parseError) {
                            console.warn(`⚠️ Could not parse SheetsList: ${parseError.message}`);
                        }
                    } else {
                        console.warn(`⚠️ SheetsList returned empty/null after ReadJson for ${sPath}`);
                    }
                } catch (sheetsListError) {
                    console.warn(`⚠️ Could not get SheetsList: ${sheetsListError.message}`);
                }
            });
            
            // Associate this workbook with this specific instance
            this.m_WorkBookInstanceMap.set(sPath, wInstanceId);
            console.log(`✅ Workbook ${sPath} assigned to instance ${wInstanceId} (total workbooks: ${this.m_WorkBookInstanceMap.size}, total instances: ${wPool.instances.size})`);
            
        } catch (wError) {
            const wErrorMessage="❌ Error loading workbook:"+wError
            console.error(wErrorMessage);
            throw wErrorMessage;
        }
    }

    // Save a WorkBook to the WebInterface
    async getWorkBookContent(sPath) {
        try {
            // Try to get content directly, and reload if WriteJson returns incomplete data
            let wJsonContent = null;
            let wAttempts = 0;
            const wMaxAttempts = 3; // Increased from 2 to 3 to allow more retry attempts
            
            while (wAttempts < wMaxAttempts && !wJsonContent) {
                wAttempts++;
                
                try {
                    // CRITICAL: Use the same instance assigned to this workbook
                    wJsonContent = await this.executeTaskForWorkBook(sPath, (uISpreadSheet) => {
                        // Ensure the workbook is active before reading
                        const wOk = uISpreadSheet.SetActiveWorkBook(sPath);
                        if (!wOk) {
                            console.error(`❌ Error: SetActiveWorkBook failed for ${sPath}`);
                            throw new Error(`SetActiveWorkBook failed for ${sPath}`);
                        }
                        
                        // Get the JSON content directly - don't rely on JsonWorkBooks()
                        const wJson = uISpreadSheet.WriteJson(sPath);
                        //console.log("Received JSON: ",wJson);
                        // Validate immediately
                        if (!wJson || (typeof wJson === 'string' && wJson.length === 0)) {
                            console.error(`❌ WriteJson returned empty or invalid content for ${sPath}`);
                            throw new Error(`WriteJson returned empty content for ${sPath}`);
                        }
                        
                        // Validate that the JSON contains sheets data
                        try {
                            const wParsed = JSON.parse(wJson);
                            const wSheets = wParsed.sheets || [];
                            if (!Array.isArray(wSheets) || wSheets.length === 0) {
                                console.warn(`⚠️ WriteJson returned JSON with no sheets for ${sPath} (attempt ${wAttempts})`);
                                console.warn(`   JSON keys present: ${Object.keys(wParsed).join(', ')}`);
                                // Return null to trigger reload
                                return null;
                            }
                            console.log(`✅ WriteJson returned valid content with ${wSheets.length} sheet(s)`);
                        } catch (parseError) {
                            console.warn(`⚠️ Could not parse WriteJson result: ${parseError.message}`);
                            // If it's valid JSON but no sheets, return null to trigger reload
                            return null;
                        }
                        
                        return wJson;
                    });
                    
                    // If we got content with sheets, break out of the loop
                    if (wJsonContent) {
                        try {
                            const wParsed = JSON.parse(wJsonContent);
                            const wSheets = wParsed.sheets || [];
                            if (Array.isArray(wSheets) && wSheets.length > 0) {
                                break; // Success!
                            }
                        } catch (e) {
                            // Continue to reload
                        }
                    }
                } catch (error) {
                    console.warn(`⚠️ Attempt ${wAttempts} failed: ${error.message}`);
                    wJsonContent = null;
                }
                
                // If we don't have valid content, try to reload from database
                if (!wJsonContent && wAttempts < wMaxAttempts) {
                    console.log(`🔄 Workbook ${sPath} content incomplete or missing, reloading from database (attempt ${wAttempts + 1})...`);
                    const wMongoDb = dependenciesContainer.resolve("MongoDb");
                    if (wMongoDb) {
                        const wCollection = wMongoDb.db.collection('Directory');
                        const wFile = await wCollection.findOne({ path: sPath });
                        if (wFile && !wFile.isDirectory) {
                            // Rebuild content for .sker files
                            let wContent = null;
                            if (typeof wFile.name === 'string' && wFile.name.toLowerCase().endsWith('.sker') && wFile.record) {
                                const fastifyMock = { mongo: { db: wMongoDb.db } };
                                const wRebuilt = await rebuildSkerContentFromRecord(fastifyMock, wFile);
                                if (wRebuilt && wRebuilt.content) {
                                    wContent = wRebuilt.content;
                                }
                            } else if (wFile.content) {
                                wContent = wFile.content;
                            }
                            
                            if (wContent) {
                                // Validate JSON format and that it has sheets before loading
                                let wParsedContent = null;
                                try {
                                    wParsedContent = JSON.parse(wContent);
                                    const wContentSheets = wParsedContent.sheets || [];
                                    if (!Array.isArray(wContentSheets) || wContentSheets.length === 0) {
                                        console.error(`❌ Content from database has no sheets for ${sPath}`);
                                        console.error(`   JSON keys in database content: ${Object.keys(wParsedContent).join(', ')}`);
                                        throw new Error(`Content from database has no sheets for ${sPath}`);
                                    }
                                    console.log(`✅ Database content validated: ${wContentSheets.length} sheet(s) found`);
                                    console.log(`✅ Content is valid JSON with ${wParsedContent.sheets?.length || 0} sheet(s)`);
                                } catch (parseError) {
                                    console.error(`❌ Could not parse content from database: ${parseError.message}`);
                                    throw new Error(`Invalid content format in database for ${sPath}: ${parseError.message}`);
                                }
                                
                                const wContentSize = Buffer.byteLength(wContent, 'utf8');
                                console.log(`📥 Reloading workbook content (${wContentSize} bytes)`);
                                
                                // Store parsed content for use in callback
                                const wParsedContentForCallback = wParsedContent;
                                
                                await this.executeTaskForWorkBook(sPath, (uISpreadSheet) => {
                                    // CRITICAL: Completely remove existing workbook before reloading
                                    // Check if workbook exists first
                                    try {
                                        const wWorkBooksJson = uISpreadSheet.JsonWorkBooks();
                                        if (wWorkBooksJson) {
                                            try {
                                                const wWorkBooks = JSON.parse(wWorkBooksJson);
                                                const wWorkBookExists = wWorkBooks.list?.some(wb => wb.uri === sPath);
                                                if (wWorkBookExists) {
                                                    console.log(`🗑️ Deleting existing workbook ${sPath} before reload...`);
                                                    const wDeleteResult = uISpreadSheet.DeleteWorkBook(sPath);
                                                    console.log(`   DeleteWorkBook result: ${wDeleteResult}`);
                                                    
                                                    // Verify deletion
                                                    const wWorkBooksAfterDelete = uISpreadSheet.JsonWorkBooks();
                                                    if (wWorkBooksAfterDelete) {
                                                        try {
                                                            const wWorkBooksParsed = JSON.parse(wWorkBooksAfterDelete);
                                                            const wStillExists = wWorkBooksParsed.list?.some(wb => wb.uri === sPath);
                                                            if (wStillExists) {
                                                                console.error(`⚠️ Workbook still exists after DeleteWorkBook - this may cause issues`);
                                                            } else {
                                                                console.log(`✅ Workbook successfully deleted`);
                                                            }
                                                        } catch (e) {
                                                            // Ignore parse errors
                                                        }
                                                    }
                                                } else {
                                                    console.log(`ℹ️ Workbook ${sPath} does not exist in instance, will create new`);
                                                }
                                            } catch (parseError) {
                                                console.warn(`⚠️ Could not parse JsonWorkBooks: ${parseError.message}`);
                                                // Try to delete anyway
                                                try {
                                                    uISpreadSheet.DeleteWorkBook(sPath);
                                                } catch (e) {
                                                    // Ignore
                                                }
                                            }
                                        }
                                    } catch (e) {
                                        console.warn(`⚠️ Could not check existing workbooks: ${e.message}`);
                                        // Try to delete anyway
                                        try {
                                            uISpreadSheet.DeleteWorkBook(sPath);
                                        } catch (e2) {
                                            // Ignore
                                        }
                                    }
                                    
                                    // Add the workbook fresh
                                    console.log(`➕ Adding workbook ${sPath}...`);
                                    uISpreadSheet.AddWorkBook(sPath);
                                    
                                    // Try ReadJson WITHOUT SetActiveWorkBook first (like in loadWorkBook)
                                    // This matches the initial load pattern
                                    const wReloadContent = sanitizeWorkbookForServerLoad(wContent);
                                    console.log(`📖 Calling ReadJson with content (${wReloadContent.length} chars, ${wParsedContentForCallback.sheets?.length || 0} sheets)...`);
                                    const wReadResult = uISpreadSheet.ReadJson(wReloadContent);
                                    if (!wReadResult) {
                                        console.error(`❌ ReadJson failed during reload (returned false)`);
                                        throw new Error(`ReadJson failed during reload (returned false)`);
                                    }
                                    console.log(`✅ ReadJson returned true`);
                                    
                                    // Set as active AFTER ReadJson (like in loadWorkBook, but we do it explicitly)
                                    const wOk = uISpreadSheet.SetActiveWorkBook(sPath);
                                    if (!wOk) {
                                        console.error(`❌ SetActiveWorkBook failed after ReadJson`);
                                        throw new Error(`SetActiveWorkBook failed after ReadJson`);
                                    }
                                    console.log(`✅ SetActiveWorkBook succeeded`);
                                    
                                    // Verify SetActiveWorkBook is still active (double-check)
                                    const wOk2 = uISpreadSheet.SetActiveWorkBook(sPath);
                                    if (!wOk2) {
                                        console.error(`❌ SetActiveWorkBook failed on second check after ReadJson`);
                                        throw new Error(`SetActiveWorkBook failed on second check after ReadJson`);
                                    }
                                    
                                    // Try to get sheets list to verify they were loaded
                                    try {
                                        const wSheetsListStr = uISpreadSheet.SheetsList();
                                        console.log(`📋 SheetsList after ReadJson: ${wSheetsListStr}`);
                                        if (wSheetsListStr) {
                                            try {
                                                const wSheetsListParsed = JSON.parse(wSheetsListStr);
                                                const wSheetsList = wSheetsListParsed.list || wSheetsListParsed;
                                                if (Array.isArray(wSheetsList) && wSheetsList.length > 0) {
                                                    console.log(`✅ SheetsList verified: ${wSheetsList.length} sheet(s) found`);
                                                } else {
                                                    console.error(`❌ SheetsList is empty after ReadJson - sheets were not loaded`);
                                                    console.error(`   Expected ${wParsedContentForCallback.sheets?.length || 0} sheet(s) from database content`);
                                                    console.error(`   This suggests ReadJson did not properly load the sheets from the JSON`);
                                                    // Don't throw here - let WriteJson verification catch it
                                                }
                                            } catch (parseError) {
                                                // If it's not JSON, it might be a direct array or string
                                                console.warn(`⚠️ Could not parse SheetsList as JSON: ${parseError.message}`);
                                                // Continue to WriteJson verification
                                            }
                                        } else {
                                            console.error(`❌ SheetsList returned empty/null after ReadJson`);
                                            console.error(`   Expected ${wParsedContentForCallback.sheets?.length || 0} sheet(s) from database content`);
                                        }
                                    } catch (sheetsListError) {
                                        console.error(`❌ Could not get SheetsList: ${sheetsListError.message}`);
                                        // Don't throw here, continue to WriteJson verification
                                    }
                                    
                                    // Verify the workbook was loaded correctly by checking WriteJson immediately
                                    const wVerifyJson = uISpreadSheet.WriteJson(sPath);
                                    if (wVerifyJson) {
                                        try {
                                            const wVerifyParsed = JSON.parse(wVerifyJson);
                                            const wVerifySheets = wVerifyParsed.sheets || [];
                                            if (Array.isArray(wVerifySheets) && wVerifySheets.length > 0) {
                                                console.log(`✅ Workbook verified after reload: ${wVerifySheets.length} sheet(s)`);
                                            } else {
                                                console.error(`❌ Workbook reloaded but WriteJson shows no sheets`);
                                                console.error(`   WriteJson keys: ${Object.keys(wVerifyParsed).join(', ')}`);
                                                console.error(`   WriteJson content preview: ${wVerifyJson.substring(0, 500)}`);
                                                throw new Error(`Workbook reloaded but WriteJson shows no sheets`);
                                            }
                                        } catch (verifyError) {
                                            console.error(`❌ Could not verify reloaded workbook: ${verifyError.message}`);
                                            throw new Error(`Could not verify reloaded workbook: ${verifyError.message}`);
                                        }
                                    } else {
                                        console.error(`❌ WriteJson returned empty after reload`);
                                        throw new Error(`WriteJson returned empty after reload`);
                                    }
                                });
                                
                                console.log(`✅ Workbook reloaded and verified successfully`);
                                // Wait a bit for the instance to process
                                await new Promise(resolve => setTimeout(resolve, 200));
                                
                                // Immediately retry getting content after reload
                                try {
                                    wJsonContent = await this.executeTaskForWorkBook(sPath, (uISpreadSheet) => {
                                        // Ensure the workbook is active before reading
                                        const wOk = uISpreadSheet.SetActiveWorkBook(sPath);
                                        if (!wOk) {
                                            console.error(`❌ Error: SetActiveWorkBook failed for ${sPath} after reload`);
                                            throw new Error(`SetActiveWorkBook failed for ${sPath} after reload`);
                                        }
                                        
                                        // Get the JSON content directly
                                        const wJson = uISpreadSheet.WriteJson(sPath);
                                        
                                        // Validate immediately
                                        if (!wJson || (typeof wJson === 'string' && wJson.length === 0)) {
                                            console.error(`❌ WriteJson returned empty or invalid content for ${sPath} after reload`);
                                            throw new Error(`WriteJson returned empty content for ${sPath} after reload`);
                                        }
                                        
                                        // Validate that the JSON contains sheets data
                                        try {
                                            const wParsed = JSON.parse(wJson);
                                            const wSheets = wParsed.sheets || [];
                                            if (!Array.isArray(wSheets) || wSheets.length === 0) {
                                                console.error(`❌ WriteJson returned JSON with no sheets for ${sPath} after reload`);
                                                console.error(`   JSON keys present: ${Object.keys(wParsed).join(', ')}`);
                                                throw new Error(`WriteJson returned JSON with no sheets after reload`);
                                            }
                                            console.log(`✅ WriteJson returned valid content with ${wSheets.length} sheet(s) after reload`);
                                        } catch (parseError) {
                                            console.error(`❌ Could not parse WriteJson result after reload: ${parseError.message}`);
                                            throw new Error(`Could not parse WriteJson result after reload: ${parseError.message}`);
                                        }
                                        
                                        return wJson;
                                    });
                                    
                                    // If we got valid content, break out of the loop
                                    if (wJsonContent) {
                                        try {
                                            const wParsed = JSON.parse(wJsonContent);
                                            const wSheets = wParsed.sheets || [];
                                            if (Array.isArray(wSheets) && wSheets.length > 0) {
                                                console.log(`✅ Successfully retrieved workbook content after reload`);
                                                break; // Success!
                                            }
                                        } catch (e) {
                                            // Continue to next attempt
                                            wJsonContent = null;
                                        }
                                    }
                                } catch (retryError) {
                                    console.warn(`⚠️ Retry after reload failed: ${retryError.message}`);
                                    wJsonContent = null;
                                }
                            } else {
                                throw new Error(`Could not get content from database for ${sPath}`);
                            }
                        } else {
                            throw new Error(`File not found in database: ${sPath}`);
                        }
                    }
                }
            }
            
            // Final validation
            if (!wJsonContent) {
                // Try one more time with detailed diagnostics
                console.error(`❌ Final attempt failed. Running diagnostics for ${sPath}...`);
                try {
                    await this.executeTaskForWorkBook(sPath, (uISpreadSheet) => {
                        const wOk = uISpreadSheet.SetActiveWorkBook(sPath);
                        console.error(`   SetActiveWorkBook result: ${wOk}`);
                        
                        // Try to get workbook list
                        try {
                            const wWorkBooksJson = uISpreadSheet.JsonWorkBooks();
                            console.error(`   JsonWorkBooks result: ${wWorkBooksJson ? wWorkBooksJson.substring(0, 200) : 'null'}...`);
                        } catch (e) {
                            console.error(`   JsonWorkBooks error: ${e.message}`);
                        }
                        
                        // Try WriteJson one more time
                        const wFinalJson = uISpreadSheet.WriteJson(sPath);
                        if (wFinalJson) {
                            try {
                                const wFinalParsed = JSON.parse(wFinalJson);
                                console.error(`   Final WriteJson keys: ${Object.keys(wFinalParsed).join(', ')}`);
                                console.error(`   Final WriteJson sheets count: ${Array.isArray(wFinalParsed.sheets) ? wFinalParsed.sheets.length : 'N/A'}`);
                            } catch (e) {
                                console.error(`   Final WriteJson parse error: ${e.message}`);
                            }
                        } else {
                            console.error(`   Final WriteJson returned null/empty`);
                        }
                    });
                } catch (diagError) {
                    console.error(`   Diagnostics error: ${diagError.message}`);
                }
                
                throw new Error(`Failed to get workbook content after ${wMaxAttempts} attempts. ` +
                    `The workbook may not be properly loaded in WebAssembly memory. ` +
                    `Check logs above for detailed diagnostics.`);
            }
            
            // Validate the returned content
            if (wJsonContent === null || wJsonContent === undefined) {
                throw new Error("❌ WriteJson returned null or undefined");
            }
            
            // Log content details for debugging
            const wContentLength = typeof wJsonContent === 'string' ? wJsonContent.length : JSON.stringify(wJsonContent).length;
            const wContentSize = Buffer.byteLength(typeof wJsonContent === 'string' ? wJsonContent : JSON.stringify(wJsonContent), 'utf8');
            console.log(`📄 getWorkBookContent for ${sPath}:`);
            console.log(`   Content length: ${wContentLength} chars`);
            console.log(`   Content size: ${wContentSize} bytes`);
            console.log(`   Content type: ${typeof wJsonContent}`);
            if (typeof wJsonContent === 'string' && wJsonContent.length > 0) {
                const wPreview = wJsonContent.substring(0, Math.min(200, wJsonContent.length));
                console.log(`   Content preview (first 200 chars): ${wPreview}${wJsonContent.length > 200 ? '...' : ''}`);
            }
            
            console.log("Loaded Document from memory :"+sPath);
            
            // Ensure we return a string
            if (typeof wJsonContent === 'string') {
                return wJsonContent;
            } else {
                // If it's not a string, convert it
                return JSON.stringify(wJsonContent);
            }
        } catch (wError) {
            const wErrorMesage = `❌ Error in getWorkBookContent: ${sPath}: ${wError}`;
            console.error(wErrorMesage);
            throw new Error(wErrorMesage);
        }
    }

    // Persist workbook to DB directly (no HTTP call needed)
    async persistWorkBook(sPath, sUserEmail = null) {
        try {
            // Get the MongoDB collection from the dependency container
            const wMongoDb = dependenciesContainer.resolve("MongoDb");
            if (!wMongoDb) {
                throw new Error("❌ MongoDB not available");
            }

            if (sUserEmail) {
                const wMayWrite = await canWriteVirtualPath(wMongoDb.db, sPath, sUserEmail);
                if (!wMayWrite) {
                    console.log(
                        `⏭️ persistWorkBook skipped (read-only): ${sPath} user=${sUserEmail}`
                    );
                    return;
                }
            }
            
            const wCollection = wMongoDb.db.collection('Directory');
            
            // Create a fastify-like object for utility functions
            const fastifyMock = {
                mongo: {
                    db: wMongoDb.db
                }
            };
            
            // Read existing record before modifying
            const wExisting = await wCollection.findOne({ path: sPath });
            if (!wExisting) {
                throw new Error(`❌ Workbook not found in DB: ${sPath}`);
            }
            
            // Get workbook content with proper error handling
            let wJsonContent;
            try {
                wJsonContent = await this.getWorkBookContent(sPath);
            } catch (contentError) {
                const wErrorMesage = `❌ Failed to get workbook content for ${sPath}: ${contentError}`;
                console.error(wErrorMesage);
                throw new Error(wErrorMesage);
            }
            if (wJsonContent === "") {
                throw new Error(`❌ Invalid workbook content for ${sPath}`);
            }
            // Validate the content before saving
            if (!wJsonContent || typeof wJsonContent !== 'string') {
                throw new Error(`❌ Invalid workbook content for ${sPath}`);
            }
            
            // Compare with what's currently stored
            try {
                const wCurrentRebuilt = await rebuildSkerContentFromRecord(fastifyMock, wExisting);
                if (wCurrentRebuilt && wCurrentRebuilt.content) {
                    const wCurrentSize = Buffer.byteLength(wCurrentRebuilt.content, 'utf8');
                    const wNewSize = Buffer.byteLength(wJsonContent, 'utf8');
                    console.log(`🔍 Content comparison for ${sPath}:`);
                    console.log(`   Current stored size: ${wCurrentSize} bytes`);
                    console.log(`   New content size: ${wNewSize} bytes`);
                    console.log(`   Difference: ${wNewSize - wCurrentSize} bytes`);
                    
                    const wSizeDifference = wCurrentSize - wNewSize;
                    
                    // Check if content is significantly smaller (likely incomplete)
                    if (wSizeDifference > 1000) { // More than 1KB difference
                        console.error(`❌ CRITICAL: Content appears incomplete!`);
                        console.error(`   Size reduction: ${wSizeDifference} bytes (${Math.round(wSizeDifference/wCurrentSize*100)}%)`);
                        
                        try {
                            const wCurrentParsed = JSON.parse(wCurrentRebuilt.content);
                            const wNewParsed = JSON.parse(wJsonContent);
                            
                            const wCurrentSheets = wCurrentParsed.sheets || [];
                            const wNewSheets = wNewParsed.sheets || [];
                            
                            console.error(`   Current sheets count: ${Array.isArray(wCurrentSheets) ? wCurrentSheets.length : 'N/A'}`);
                            console.error(`   New sheets count: ${Array.isArray(wNewSheets) ? wNewSheets.length : 'N/A'}`);
                            
                            const wCurrentKeys = Object.keys(wCurrentParsed);
                            const wNewKeys = Object.keys(wNewParsed);
                            const wMissingKeys = wCurrentKeys.filter(k => !wNewKeys.includes(k));
                            
                            if (wMissingKeys.length > 0) {
                                console.error(`   Missing keys: ${wMissingKeys.join(', ')}`);
                            }
                            
                            // If sheets are missing, this is a critical error
                            if (Array.isArray(wCurrentSheets) && wCurrentSheets.length > 0 && 
                                (!Array.isArray(wNewSheets) || wNewSheets.length === 0)) {
                                console.error(`❌ CRITICAL ERROR: All sheet data is missing from WriteJson result!`);
                                console.error(`   This indicates WriteJson is not returning complete workbook data.`);
                                console.error(`   Aborting save to prevent data loss.`);
                                
                                throw new Error(`WriteJson returned incomplete content: missing ${wCurrentSheets.length} sheet(s). ` +
                                    `Content size reduced from ${wCurrentSize} to ${wNewSize} bytes. ` +
                                    `This suggests the workbook is not fully loaded in WebAssembly memory.`);
                            }
                        } catch (parseError) {
                            console.error(`   Could not parse JSON for detailed comparison: ${parseError.message}`);
                            // Still throw error if size difference is too large
                            if (wSizeDifference > wCurrentSize * 0.5) { // More than 50% reduction
                                throw new Error(`Content size reduced by ${Math.round(wSizeDifference/wCurrentSize*100)}% ` +
                                    `(${wCurrentSize} -> ${wNewSize} bytes). Content may be corrupted or incomplete.`);
                            }
                        }
                    } else if (Math.abs(wSizeDifference) > 100) {
                        console.warn(`⚠️ Size difference detected: ${wSizeDifference} bytes`);
                        console.warn(`   This may indicate minor content changes`);
                    }
                }
            } catch (compareError) {
                // If comparison failed but it's a validation error, re-throw it
                if (compareError.message && (compareError.message.includes('incomplete') || compareError.message.includes('missing') || compareError.message.includes('reduced'))) {
                    throw compareError;
                }
                console.warn(`⚠️ Could not compare content: ${compareError.message}`);
            }
            
            // Common computed values
            const wFileName = (typeof sPath === 'string' && sPath.length > 0)
                ? sPath.split('/').pop()
                : 'unknown';
            
            // Check if this is a .sker file - use saveSkerToCollections for proper handling
            const isSkerFile = typeof wFileName === 'string' && wFileName.toLowerCase().endsWith('.sker');
            
            if (isSkerFile) {
                // Use saveSkerToCollections for .sker files to properly handle Spreadsheet collection
                console.log(`📝 Persisting .sker file using saveSkerToCollections: ${sPath}`);
                
                // fastifyMock already created above
                try {
                    // Get current size and data before update to detect changes
                    const wCurrentSize = wExisting.size || 0;
                    
                    // Rebuild current content to compare with new content
                    let wCurrentRebuiltSize = wCurrentSize;
                    try {
                        if (wExisting.record) {
                            const wRebuilt = await rebuildSkerContentFromRecord(fastifyMock, wExisting);
                            if (wRebuilt && wRebuilt.size) {
                                wCurrentRebuiltSize = wRebuilt.size;
                            }
                        }
                    } catch (rebuildError) {
                        console.warn("⚠️ Could not rebuild current content for comparison:", rebuildError);
                    }
                    
                    const { recordId, info, spreadsheetData, size: skerSize } = await saveSkerToCollections(
                        fastifyMock,
                        wExisting,
                        sPath,
                        wJsonContent
                    );
                    
                    // Calculate the size that will be used when rebuilding (same as rebuildSkerContentFromRecord)
                    // This is the size of the data stored in Spreadsheet collection
                    let wCalculatedSize = skerSize || 0;
                    
                    // Verify: calculate size from the data that will be stored
                    // This should match what rebuildSkerContentFromRecord will calculate
                    try {
                        const wSizeFromData = Buffer.byteLength(JSON.stringify(spreadsheetData), 'utf8');
                        if (wSizeFromData !== wCalculatedSize) {
                            console.warn(`⚠️ Size mismatch: skerSize=${wCalculatedSize}, calculated=${wSizeFromData}, using calculated`);
                            wCalculatedSize = wSizeFromData;
                        }
                    } catch (sizeError) {
                        console.warn("⚠️ Could not verify size calculation:", sizeError);
                    }
                    
                    console.log("📊 Size comparison:");
                    console.log("   - Current size in Directory:", wCurrentSize);
                    console.log("   - Current rebuilt size:", wCurrentRebuiltSize);
                    console.log("   - New calculated size:", wCalculatedSize);
                    console.log("   - Original content size:", Buffer.byteLength(wJsonContent, 'utf8'));
                    
                    // Prepare update payload for Directory collection
                    // Only include fields that have actually changed
                    const wSet = {};
                    let wHasChanges = false;
                    
                    // Update record reference if a new one was created
                    if (recordId && String(wExisting.record) !== String(recordId)) {
                        wSet.record = recordId;
                        wHasChanges = true;
                    }
                    
                    // Update info if it has changed
                    const wInfoChanged = info && JSON.stringify(wExisting.info) !== JSON.stringify(info);
                    if (wInfoChanged) {
                        wSet.info = info;
                        wHasChanges = true;
                    }
                    
                    // Only update size if it has changed
                    // Use the calculated size which matches rebuildSkerContentFromRecord
                    if (wCalculatedSize !== wCurrentSize && wCalculatedSize !== wCurrentRebuiltSize) {
                        wSet.size = wCalculatedSize;
                        wHasChanges = true;
                        console.log(`📏 Size changed: ${wCurrentSize} -> ${wCalculatedSize}`);
                    } else {
                        console.log(`📏 Size unchanged: ${wCurrentSize} (calculated: ${wCalculatedSize})`);
                    }
                    
                    // Always ensure content and gridfsId are cleared for .sker files
                    if (wExisting.content !== null || wExisting.gridfsId !== null) {
                        wSet.content = null;
                        wSet.gridfsId = null;
                        wHasChanges = true;
                    }
                    
                    // Only update updatedAt if there are actual changes
                    if (wHasChanges) {
                        wSet.updatedAt = new Date();
                    }
                    
                    console.log("📝 Persist WorkBook (.sker) - Size from saveSkerToCollections:", skerSize);
                    console.log("📝 Persist WorkBook (.sker) - Has changes:", wHasChanges);
                    console.log("📝 Persist WorkBook (.sker) - Fields to update:", Object.keys(wSet));
                    
                    if (!wHasChanges) {
                        console.log("ℹ️ No changes detected, skipping Directory update");
                        console.log(`✅ Workbook (.sker) Spreadsheet collection updated (no Directory changes): ${sPath}`);
                        // Spreadsheet collection was already updated by saveSkerToCollections
                        return; // Exit early, no Directory update needed
                    }
                    
                    const wUpdateResult = await wCollection.updateOne(
                        { _id: wExisting._id },
                        { $set: wSet }
                    );
                    
                    console.log(`📝 Update result - Matched: ${wUpdateResult.matchedCount}, Modified: ${wUpdateResult.modifiedCount}`);
                    
                    if (wUpdateResult.modifiedCount === 0 && wUpdateResult.matchedCount === 1) {
                        console.warn("⚠️ Workbook was matched but not modified - this should not happen if wHasChanges is true");
                    }
                    
                    console.log(`✅ Workbook (.sker) updated in Directory and Spreadsheet collections: ${sPath}`);
                } catch (skerError) {
                    console.error("❌ Error saving .sker file:", skerError);
                    throw new Error(`Failed to save .sker file: ${skerError.message}`);
                }
            } else {
                // For non-.sker files, use the standard update approach
                const wContentSize = Buffer.byteLength(wJsonContent, 'utf8');
                
                // Prepare set payload, always refresh content/size
                const wSet = {
                    content: wJsonContent,
                    size: wContentSize,
                    updatedAt: new Date(),
                };
                console.log("📝 Persist WorkBook - Content length:", wJsonContent.length);
                console.log("📝 Persist WorkBook - Size:", wContentSize);
                console.log("📝 Persist WorkBook - UpdatedAt:", wSet.updatedAt);
                
                const wUpdateResult = await wCollection.updateOne(
                    { _id: wExisting._id },
                    { $set: wSet }
                );
                
                console.log(`📝 Update result - Matched: ${wUpdateResult.matchedCount}, Modified: ${wUpdateResult.modifiedCount}`);
                
                if (wUpdateResult.modifiedCount === 0 && wUpdateResult.matchedCount === 1) {
                    console.warn("⚠️ Workbook was matched but not modified - content may be identical");
                }
                
                console.log(`✅ Workbook updated in Directory collection: ${sPath}`);
            }
           
        } catch (wError) {
            const wErrorMesage = `❌ Error persisting workbook to MongoDB: ${wError}`;
            console.error(wErrorMesage);
            throw new Error(wErrorMesage);
        }
    }

    // Cleanup method for graceful shutdown
    async cleanup() {
        try {
            console.log('Cleaning up SkSpSpreadSheet...');
            
            if (this.m_SpreadSheetPool) {
                await this.m_SpreadSheetPool.cleanup();
            }
            
            // Clear local data
            this.m_WorkBooks.clear();
            this.m_Users.clear();
            
            console.log('SkSpSpreadSheet cleaned up successfully');
        } catch (error) {
            console.error('Error during SkSpSpreadSheet cleanup:', error);
        }
    }

    // Method to scale the pool
    async scalePool(action, count = 1) {
        try {
            const pool = this.m_SpreadSheetPool.getPool();
            const currentInstances = pool.instances.size;
            
            if (action === 'scale-up') {
                // Create additional instances
                for (let i = 0; i < count; i++) {
                    if (pool.instances.size < pool.config.maxInstances) {
                        await pool._createInstance();
                    }
                }
            } else if (action === 'scale-down') {
                // Remove instances (keep minimum)
                const instancesToRemove = Math.min(count, currentInstances - pool.config.minInstances);
                const instances = Array.from(pool.instances.keys()).slice(0, instancesToRemove);
                
                instances.forEach(id => {
                    pool._removeInstance(id);
                });
            }
            
            return {
                success: true,
                action,
                count,
                previousInstances: currentInstances,
                currentInstances: pool.instances.size
            };
        } catch (wError) {
            const wErrorMesage = `❌ Error scaling pool: ${wError}`;
            console.error(wErrorMesage);
            throw new Error(wErrorMesage);
        }
    }
}
export default SkSpSpreadSheet;