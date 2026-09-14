//=============================================================================
// SkSpreadSheetPoolInterface.mjs
// Interface using the WebAssembly instance pool
// Author: Stéphane ALLEZ
//=============================================================================

import SkSpreadSheetPool from './SkSpreadSheetPool.mjs';

/**
 * Interface that uses the WebAssembly instance pool
 * Provides the same API as the original interface but with pool management
 */
class SkSpreadSheetPoolInterface {
    constructor(options = {}) {
        this.pool = new SkSpreadSheetPool({
            minInstances: options.minInstances || 2,
            maxInstances: options.maxInstances || 10,
            instanceTimeout: options.instanceTimeout || 300000, // 5 minutes
            healthCheckInterval: options.healthCheckInterval || 60000, // 1 minute
            loadBalancingStrategy: options.loadBalancingStrategy || 'round-robin',
            onCellChange: options.onCellChange || this._defaultOnCellChange.bind(this),
            ...options
        });
        
        this.isInitialized = false;
        this.initializationPromise = null;
        
        // Bind methods to maintain context
        this.executeTask = this.executeTask.bind(this);
        this.getStats = this.getStats.bind(this);
        this.cleanup = this.cleanup.bind(this);
    }
    
    /**
     * Initialize the pool interface
     */
    async initializeSkerSpreadSheet() {
        if (this.isInitialized) {
            return;
        }
        
        if (this.initializationPromise) {
            return this.initializationPromise;
        }
        
        this.initializationPromise = this._initializePoolInterface();
        return this.initializationPromise;
    }
    
    async _initializePoolInterface() {
        try {
            console.log('Initializing SkSpreadSheetPoolInterface...');
            
            // Initialize the pool
            await this.pool.initialize();
            
            this.isInitialized = true;
            console.log('SkSpreadSheetPoolInterface initialized successfully');
            
            // Set up event listeners
            this._setupEventListeners();
            
        } catch (wError) {
            const wErrorMessage = `❌ Error initializing SkSpreadSheetPoolInterface: ${wError}`;
            throw new Error(wErrorMessage);
        }
    }
    
    /**
     * Set up event listeners for the pool
     */
    _setupEventListeners() {
        this.pool.on('poolReady', () => {
            console.log('Pool is ready for use');
        });
        
        this.pool.on('instanceCreated', ({ id, instance }) => {
            console.log(`New instance created: ${id}`);
        });
        
        this.pool.on('instanceRemoved', ({ id }) => {
            console.log(`Instance removed: ${id}`);
        });
        
        this.pool.on('poolError', (error) => {
            console.error('Pool error:', error);
        });
    }
    
    /**
     * Default cell change handler
     */
    _defaultOnCellChange(cellRef, instanceId) {
        console.log(`Cell changed in instance ${instanceId}:`, cellRef);
    }
    
    /**
     * Execute a task using an available instance from the pool
     */
    async executeTask(task, ...args) {
        if (!this.isInitialized) {
            await this.initializeSkerSpreadSheet();
        }
        
        return this.pool.executeTask(task, ...args);
    }
    
    /**
     * Get a specific instance (for advanced usage)
     */
    async getInstance() {
        if (!this.isInitialized) {
            await this.initializeSkerSpreadSheet();
        }
        
        return this.pool.getInstance();
    }
    
    /**
     * Execute a spreadsheet operation
     */
    async executeSpreadsheetOperation(operation, ...args) {
        return this.executeTask((uISpreadSheet) => {
            // Execute the operation on the UISpreadSheet instance
            if (typeof uISpreadSheet[operation] === 'function') {
                return uISpreadSheet[operation](...args);
            } else {
                throw new Error(`Operation ${operation} not found on UISpreadSheet`);
            }
        });
    }
    
    /**
     * Load a workbook
     */
    async loadWorkbook(workbookData) {
        return this.executeTask((uISpreadSheet) => {
            if (typeof uISpreadSheet.loadWorkbook === 'function') {
                return uISpreadSheet.loadWorkbook(workbookData);
            } else {
                throw new Error('loadWorkbook method not found on UISpreadSheet');
            }
        });
    }
    
    /**
     * Save a workbook
     */
    async saveWorkbook() {
        return this.executeTask((uISpreadSheet) => {
            if (typeof uISpreadSheet.saveWorkbook === 'function') {
                return uISpreadSheet.saveWorkbook();
            } else {
                throw new Error('saveWorkbook method not found on UISpreadSheet');
            }
        });
    }
    
    /**
     * Get cell value
     */
    async getCellValue(row, col) {
        return this.executeTask((uISpreadSheet) => {
            if (typeof uISpreadSheet.getCellValue === 'function') {
                return uISpreadSheet.getCellValue(row, col);
            } else {
                throw new Error('getCellValue method not found on UISpreadSheet');
            }
        }, row, col);
    }
    
    /**
     * Set cell value
     */
    async setCellValue(row, col, value) {
        return this.executeTask((uISpreadSheet) => {
            if (typeof uISpreadSheet.setCellValue === 'function') {
                return uISpreadSheet.setCellValue(row, col, value);
            } else {
                throw new Error('setCellValue method not found on UISpreadSheet');
            }
        }, row, col, value);
    }
    
    /**
     * Get spreadsheet dimensions
     */
    async getDimensions() {
        return this.executeTask((uISpreadSheet) => {
            if (typeof uISpreadSheet.getDimensions === 'function') {
                return uISpreadSheet.getDimensions();
            } else {
                throw new Error('getDimensions method not found on UISpreadSheet');
            }
        });
    }
    
    /**
     * Chat-related methods (forwarded to pool)
     */
    async chatJoin(username) {
        return this.executeTask((uISpreadSheet) => {
            if (typeof uISpreadSheet.chatJoin === 'function') {
                return uISpreadSheet.chatJoin(username);
            }
        });
    }
    
    async chatLeave(username) {
        return this.executeTask((uISpreadSheet) => {
            if (typeof uISpreadSheet.chatLeave === 'function') {
                return uISpreadSheet.chatLeave(username);
            }
        });
    }
    
    async chatReceiveMessage(message) {
        return this.executeTask((uISpreadSheet) => {
            if (typeof uISpreadSheet.chatReceiveMessage === 'function') {
                return uISpreadSheet.chatReceiveMessage(message);
            }
        });
    }
    
    /**
     * Get pool statistics
     */
    getStats() {
        return this.pool.getStats();
    }
    
    /**
     * Get pool health status
     */
    getHealth() {
        const stats = this.pool.getStats();
        return {
            isInitialized: this.isInitialized,
            poolSize: stats.totalInstances,
            activeInstances: stats.activeInstances,
            totalRequests: stats.totalRequests,
            successRate: stats.totalRequests > 0 ? (stats.successfulRequests / stats.totalRequests) * 100 : 0,
            averageResponseTime: stats.averageResponseTime
        };
    }
    
    /**
     * Cleanup the pool interface
     */
    async cleanup() {
        console.log('Cleaning up SkSpreadSheetPoolInterface...');
        
        if (this.pool) {
            await this.pool.cleanup();
        }
        
        this.isInitialized = false;
        this.initializationPromise = null;
        
        console.log('SkSpreadSheetPoolInterface cleaned up');
    }
    
    /**
     * Get the underlying pool (for advanced usage)
     */
    getPool() {
        return this.pool;
    }
}

export default SkSpreadSheetPoolInterface;
