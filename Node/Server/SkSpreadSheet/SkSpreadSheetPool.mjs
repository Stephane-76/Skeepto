//=============================================================================
// SkSpreadSheetPool.mjs
// Pool management for multiple WebAssembly instances
// Version: 1.0.0
// One instance per workbook path uri 
// Author: Stéphane ALLEZ
//=============================================================================

import { EventEmitter } from 'events';
import { createWasmPostMessageHandler } from '../SkAI/SkAiMessageBus.mjs';
import { ensureSkWasmModule, createSkWasmBaseModuleConfig } from './skWasmSingleton.mjs';

// Global registry to route OnCellChange callbacks to the correct instance
// Since all instances share the same WASM module, we need to track which instance is "active"
const __instanceRegistry = new Map(); // instanceId -> instance
let __activeInstanceId = null; // Track which instance is currently executing

let sharedWasmModule = null;

const DEFAULT_MODULE_CONFIG = {
  ...createSkWasmBaseModuleConfig(),
  env: {
    abort(_msg, _file, line, column) {
      console.error('SkSpreadSheetPool abort ' + line + ':' + column);
    },
  },
  print(text) {
    console.log('C++ ->', text);
  },
  printErr(text) {
    console.error('C++ Error ->', text);
  },
  setStatus(text) {
    console.log('-->Status', text);
  },
  PostMessage: createWasmPostMessageHandler(),
  OnCellChange(msg) {
    // Route callback to the currently active instance
    if (__activeInstanceId && __instanceRegistry.has(__activeInstanceId)) {
      const activeInstance = __instanceRegistry.get(__activeInstanceId);
      if (activeInstance.config.onCellChange) {
        activeInstance.config.onCellChange(msg, __activeInstanceId);
      }
    } else {
      //console.warn(`[OnCellChange] No active instance for callback: ${msg}`);
    }
  },
};

/**
 * Individual WebAssembly instance wrapper
 */
class SkSpreadSheetInstance {
    constructor(id, wasmModule, config = {}) {
        this.id = id;
        this.wasm = wasmModule;
        this.uISpreadSheet = null;
        this.isBusy = false;
        this.lastUsed = Date.now();
        this.usageCount = 0;
        this.errorCount = 0;
        this.config = config;
        
        // Queue to handle concurrent access from multiple users
        this.taskQueue = [];
        this.isProcessingQueue = false;
        
        this.readyPromise = this._initialize();
    }

    /** Resolves when uISpreadSheet exists and cell classes are registered in WASM. */
    async whenReady() {
        await this.readyPromise;
        if (!this.uISpreadSheet) {
            throw new Error(`Instance ${this.id} failed to initialize`);
        }
    }
    
    async _initialize() {
        try {
            this.uISpreadSheet = new this.wasm.UISpreadSheet();

            // Register this instance in the global registry for callback routing
            __instanceRegistry.set(this.id, this);
            
            console.log(`Instance ${this.id} initialized successfully (registered in callback router)`);
        } catch (error) {
            console.error(`Error initializing instance ${this.id}:`, error);
            this.uISpreadSheet = null;
            this.errorCount++;
            throw error;
        }
    }
    
    /**
     * Execute a task on this instance (with queue support for multi-user access)
     */
    async execute(task, ...args) {
        return new Promise((resolve, reject) => {
            // Always queue the task for proper sequential processing
            this.taskQueue.push({ task, args, resolve, reject });
            
            // Start processing queue if not already processing
            if (!this.isProcessingQueue) {
                this._processQueue();
            }
        });
    }
    
    /**
     * Set this instance as active for callback routing
     */
    _setActive() {
        __activeInstanceId = this.id;
    }
    
    /**
     * Clear active instance
     */
    _clearActive() {
        if (__activeInstanceId === this.id) {
            __activeInstanceId = null;
        }
    }
    
    /**
     * Internal method to execute a task
     */
    async _executeTask(task, ...args) {
        try {
            await this.whenReady();
            this.isBusy = true;
            this.lastUsed = Date.now();
            this.usageCount++;
            
            // Set this instance as active for callback routing
            this._setActive();
            
            // Execute the task
            const result = await task(this.uISpreadSheet, ...args);
            
            return result;
        } catch (wError) {
            this.errorCount++;
            const wErrorMessage = `❌ Error executing task on instance ${this.id}: ${wError}`;
            throw new Error(wErrorMessage);
        } finally {
            // Clear active instance after task completion
            this._clearActive();
            this.isBusy = false;
        }
    }
    
    /**
     * Process queued tasks one by one
     */
    async _processQueue() {
        if (this.isProcessingQueue) {
            return; // Already processing
        }
        
        this.isProcessingQueue = true;
        
        // Process tasks one by one until queue is empty
        while (this.taskQueue.length > 0) {
            const queuedTask = this.taskQueue.shift();
            
            try {
                const result = await this._executeTask(queuedTask.task, ...queuedTask.args);
                queuedTask.resolve(result);
            } catch (error) {
                queuedTask.reject(error);
            }
        }
        
        this.isProcessingQueue = false;
    }
    
    /**
     * Get instance health status
     */
    getHealth() {
        return {
            id: this.id,
            isBusy: this.isBusy,
            lastUsed: this.lastUsed,
            usageCount: this.usageCount,
            errorCount: this.errorCount,
            isHealthy: this.errorCount < 10 // Consider unhealthy after 10 errors
        };
    }
    
    /**
     * Reset instance state
     */
    reset() {
        this.isBusy = false;
        this.lastUsed = Date.now();
        this.usageCount = 0;
        this.errorCount = 0;
    }
    
    /**
     * Cleanup instance
     */
    cleanup() {
        try {
            // Clear active instance if this is the active one
            this._clearActive();
            
            // Remove from registry
            __instanceRegistry.delete(this.id);
            
            // Reject any queued tasks
            this.taskQueue.forEach(queuedTask => {
                queuedTask.reject(new Error('Instance is being cleaned up'));
            });
            this.taskQueue = [];
            
            if (this.uISpreadSheet && typeof this.uISpreadSheet.cleanup === 'function') {
                this.uISpreadSheet.cleanup();
            }
            this.uISpreadSheet = null;
            this.wasm = null;
        } catch (error) {
            console.error(`Error cleaning up instance ${this.id}:`, error);
        }
    }
}

/**
 * Pool manager for WebAssembly instances
 */
class SkSpreadSheetPool extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.config = {
            minInstances: options.minInstances || 2,
            maxInstances: options.maxInstances || 10,
            instanceTimeout: options.instanceTimeout || 300000, // 5 minutes
            healthCheckInterval: options.healthCheckInterval || 60000, // 1 minute
            loadBalancingStrategy: options.loadBalancingStrategy || 'round-robin', // 'round-robin', 'least-busy', 'least-used'
            ...options
        };
        
        this.instances = new Map(); // id -> instance
        this.instanceQueue = []; // Queue for round-robin
        this.currentInstanceIndex = 0;
        this.isInitialized = false;
        this.initializationPromise = null;
        
        // Statistics
        this.stats = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            averageResponseTime: 0,
            activeInstances: 0,
            totalInstances: 0
        };
        
        // Start health monitoring
        this._startHealthMonitoring();
    }
    
    /**
     * Initialize the pool with minimum instances
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }
        
        if (this.initializationPromise) {
            return this.initializationPromise;
        }
        
        this.initializationPromise = this._initializePool();
        return this.initializationPromise;
    }
    
    async _initializePool() {
        try {
            console.log('Initializing SkSpreadSheetPool...');
            
            // Initialize WASM module first (process-wide singleton via skWasmSingleton.mjs)
            if (!sharedWasmModule) {
                try {
                    if (typeof globalThis.fetch === 'function') {
                        globalThis.fetch = undefined;
                    }
                } catch {}
                sharedWasmModule = await ensureSkWasmModule(DEFAULT_MODULE_CONFIG);
                console.log('WASM module loaded successfully');
            }
            
            // Create minimum instances
            const promises = [];
            for (let i = 0; i < this.config.minInstances; i++) {
                promises.push(this._createInstance());
            }
            
            await Promise.all(promises);
            
            this.isInitialized = true;
            console.log(`Pool initialized with ${this.instances.size} instances`);
            
            this.emit('poolReady');
            
        } catch (wError) {
            const wErrorMessage = `❌ Error initializing pool: ${wError}`;
            this.emit('poolError', wError);
            throw new Error(wErrorMessage);
        }
    }
    
    /**
     * Create a new instance
     */
    async _createInstance() {
        try {
            const id = `instance_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            const instance = new SkSpreadSheetInstance(id, sharedWasmModule, {
                onCellChange: this.config.onCellChange
            });
            await instance.whenReady();
            
            this.instances.set(id, instance);
            this.instanceQueue.push(id);
            this.stats.totalInstances++;
            this.stats.activeInstances++;
            
            console.log(`Created instance ${id}, total instances: ${this.instances.size}`);
            
            this.emit('instanceCreated', { id, instance });
            
            return instance;
            
        } catch (wError) {
            const wErrorMessage = `❌ Error creating instance: ${wError}`;
            console.error(wErrorMessage);
            throw new Error(wErrorMessage);
        }
    }
    
    /**
     * Get an available instance based on load balancing strategy
     */
    async getInstance() {
        if (!this.isInitialized) {
            await this.initialize();
        }
        
        const availableInstances = Array.from(this.instances.values())
            .filter(instance => !instance.isBusy && instance.getHealth().isHealthy);
        
        if (availableInstances.length === 0) {
            // Try to create a new instance if under max limit
            if (this.instances.size < this.config.maxInstances) {
                console.log('No available instances, creating new one...');
                await this._createInstance();
                return this.getInstance(); // Recursive call to get the new instance
            }
            
            // Wait for an instance to become available
            return this._waitForAvailableInstance();
        }
        
        let selectedInstance;
        
        switch (this.config.loadBalancingStrategy) {
            case 'round-robin':
                selectedInstance = this._getRoundRobinInstance(availableInstances);
                break;
            case 'least-busy':
                selectedInstance = this._getLeastBusyInstance(availableInstances);
                break;
            case 'least-used':
                selectedInstance = this._getLeastUsedInstance(availableInstances);
                break;
            default:
                selectedInstance = availableInstances[0];
        }
        
        return selectedInstance;
    }
    
    /**
     * Round-robin load balancing
     */
    _getRoundRobinInstance(availableInstances) {
        if (this.currentInstanceIndex >= availableInstances.length) {
            this.currentInstanceIndex = 0;
        }
        
        const instance = availableInstances[this.currentInstanceIndex];
        this.currentInstanceIndex++;
        
        return instance;
    }
    
    /**
     * Least busy load balancing
     */
    _getLeastBusyInstance(availableInstances) {
        return availableInstances.reduce((least, current) => 
            current.usageCount < least.usageCount ? current : least
        );
    }
    
    /**
     * Least used load balancing
     */
    _getLeastUsedInstance(availableInstances) {
        return availableInstances.reduce((least, current) => 
            current.lastUsed < least.lastUsed ? current : least
        );
    }
    
    /**
     * Wait for an available instance
     */
    async _waitForAvailableInstance(timeout = 30000) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Timeout waiting for available instance'));
            }, timeout);
            
            const checkInterval = setInterval(() => {
                const availableInstance = Array.from(this.instances.values())
                    .find(instance => !instance.isBusy && instance.getHealth().isHealthy);
                
                if (availableInstance) {
                    clearInterval(checkInterval);
                    clearTimeout(timeoutId);
                    resolve(availableInstance);
                }
            }, 100);
        });
    }
    
    /**
     * Execute a task using an available instance
     */
    async executeTask(task, ...args) {
        const startTime = Date.now();
        this.stats.totalRequests++;
        
        try {
            const instance = await this.getInstance();
            const result = await instance.execute(task, ...args);
            
            this.stats.successfulRequests++;
            this._updateResponseTime(Date.now() - startTime);
            
            return result;
            
        } catch (error) {
            this.stats.failedRequests++;
            console.error('Task execution failed:', error);
            
            // Si c'est une erreur WASM, tenter la récupération
            if (this._isWasmError(error)) {
                console.log('WASM error detected, attempting recovery...');
                try {
                    await this._recoverWasmModule();
                    const instance = await this.getInstance();
                    const result = await instance.execute(task, ...args);
                    
                    this.stats.successfulRequests++;
                    this._updateResponseTime(Date.now() - startTime);
                    
                    console.log('Task executed successfully after WASM recovery');
                    return result;
                } catch (wRecoveryError) {
                    const wErrorMessage = `❌ WASM recovery failed: ${wRecoveryError}`;
                    throw new Error(wErrorMessage);
                }
            }
            
            throw error;
        }
    }
    
    /**
     * Check if error is related to WASM module
     */
    _isWasmError(error) {
        const errorMessage = error.message || error.toString();
        return errorMessage.includes('WASM') || 
               errorMessage.includes('memory') ||
               errorMessage.includes('WebAssembly') ||
               this.instances.size === 0;
    }
    
    /**
     * Recover WASM module after critical error
     */
    async _recoverWasmModule() {
        console.log('Recovering WASM module...');
        
        try {
            // Cleanup existing instances
            for (const [id, instance] of this.instances) {
                instance.cleanup();
            }
            this.instances.clear();
            this.instanceQueue = [];
            
            // IMPORTANT: Do not re-register embind types by recreating the Module.
            // Reuse the existing singleton if available, otherwise initialize once.
            if (!sharedWasmModule) {
                sharedWasmModule = await ensureSkWasmModule(DEFAULT_MODULE_CONFIG);
            }
            
            console.log('WASM module recovered successfully');
            
            // Re-create minimum instances
            const promises = [];
            for (let i = 0; i < this.config.minInstances; i++) {
                promises.push(this._createInstance());
            }
            
            await Promise.all(promises);
            
            this.emit('wasmModuleRecovered');
            console.log(`Pool recovered with ${this.instances.size} instances`);
            
        } catch (wError) {
            const wErrorMessage = `❌ Failed to recover WASM module: ${wError}`;
            this.emit('wasmModuleRecoveryFailed', wError);
            throw new Error(wErrorMessage);
        }
    }
    
    /**
     * Update average response time
     */
    _updateResponseTime(responseTime) {
        const total = this.stats.averageResponseTime * (this.stats.successfulRequests - 1) + responseTime;
        this.stats.averageResponseTime = total / this.stats.successfulRequests;
    }
    
    /**
     * Start health monitoring
     */
    _startHealthMonitoring() {
        setInterval(() => {
            this._performHealthCheck();
        }, this.config.healthCheckInterval);
    }
    
    /**
     * Perform health check on all instances
     */
    _performHealthCheck() {
        const now = Date.now();
        const instancesToRemove = [];
        
        for (const [id, instance] of this.instances) {
            const health = instance.getHealth();
            
            // Check if instance is too old
            if (now - health.lastUsed > this.config.instanceTimeout) {
                instancesToRemove.push(id);
                continue;
            }
            
            // Check if instance is unhealthy
            if (!health.isHealthy) {
                instancesToRemove.push(id);
                continue;
            }
        }
        
        // Remove unhealthy/old instances, but respect minimum instances
        // Only remove if we have more than minInstances
        const wCurrentSize = this.instances.size;
        const wTargetMinSize = this.config.minInstances;
        
        // Calculate how many we can safely remove
        const wCanRemove = Math.max(0, wCurrentSize - wTargetMinSize);
        const wToRemove = instancesToRemove.slice(0, wCanRemove);
        
        wToRemove.forEach(id => {
            console.log(`🧹 Health check: Removing unused instance ${id} (${wCurrentSize} -> ${wCurrentSize - 1} instances)`);
            this._removeInstance(id);
        });
        
        // Ensure minimum instances
        if (this.instances.size < this.config.minInstances) {
            const wNeeded = this.config.minInstances - this.instances.size;
            console.log(`➕ Health check: Creating ${wNeeded} instance(s) to maintain minimum (${this.config.minInstances})`);
            for (let i = 0; i < wNeeded; i++) {
                this._createInstance().catch(error => {
                    console.error('Error creating replacement instance:', error);
                });
            }
        }
        
        // Update active instances count
        this.stats.activeInstances = Array.from(this.instances.values())
            .filter(instance => !instance.isBusy).length;
    }
    
    /**
     * Remove an instance from the pool
     */
    _removeInstance(id) {
        const instance = this.instances.get(id);
        if (instance) {
            instance.cleanup();
            this.instances.delete(id);
            
            // Remove from queue
            const queueIndex = this.instanceQueue.indexOf(id);
            if (queueIndex > -1) {
                this.instanceQueue.splice(queueIndex, 1);
            }
            
            this.stats.activeInstances--;
            this.stats.totalInstances--;
            
            console.log(`Removed instance ${id}, remaining instances: ${this.instances.size}`);
            this.emit('instanceRemoved', { id });
        }
    }
    
    /**
     * Get pool statistics
     */
    getStats() {
        // Calculate real-time statistics from actual instances
        const wAllInstances = Array.from(this.instances.values());
        const wActiveInstances = wAllInstances.filter(inst => !inst.isBusy && inst.getHealth().isHealthy);
        
        return {
            ...this.stats,
            // Override with real-time values
            totalInstances: wAllInstances.length,
            activeInstances: wActiveInstances.length,
            instanceDetails: wAllInstances.map(instance => instance.getHealth()),
            config: this.config
        };
    }
    
    /**
     * Get all instances (for debugging)
     */
    getAllInstances() {
        return Array.from(this.instances.values());
    }
    
    /**
     * Cleanup the entire pool
     */
    async cleanup() {
        console.log('Cleaning up SkSpreadSheetPool...');
        
        // Cleanup all instances
        for (const [id, instance] of this.instances) {
            instance.cleanup();
        }
        
        this.instances.clear();
        this.instanceQueue = [];
        this.isInitialized = false;
        this.initializationPromise = null;
        
        console.log('SkSpreadSheetPool cleaned up');
        this.emit('poolCleaned');
    }
}

export default SkSpreadSheetPool;
