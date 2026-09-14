//=============================================================================
// SkServerWithPool.mjs
// Example of how to modify the main server to use the WebAssembly pool
// Author: Stéphane ALLEZ
//=============================================================================

import SkSpreadSheetPoolInterface from './SkSpreadSheetPoolInterface.mjs';
import fs from 'fs';
import path from 'path';

/**
 * Example of how to modify the main SkServer.mjs to use the pool
 * This shows the changes needed in the original server file
 */

// =============================================================================
// REPLACE THIS SECTION IN SkServer.mjs:
// =============================================================================

// OLD CODE (to replace):
/*
import SkSpSpreadSheet from './SkSpreadSheet/SkSpSpreadSheet.mjs';

// Initialize SkSpreadSheetServer
let wSkSpreadSheet = new SkSpSpreadSheet();
await wSkSpreadSheet.initializeSkerSpreadSheet();
*/

// NEW CODE (to add):
import SkSpreadSheetPoolInterface from './SkSpreadSheet/SkSpreadSheetPoolInterface.mjs';

// Load pool configuration based on environment
function loadPoolConfig() {
    try {
        const configPath = path.join(__dirname, './SkSpreadSheet/pool.config.json');
        const configData = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configData);
        
        const env = process.env.NODE_ENV || 'production';
        const poolConfig = config.environments[env] || config.environments.production;
        
        console.log(`Loading pool configuration for environment: ${env}`);
        return poolConfig;
    } catch (error) {
        console.warn('Could not load pool config, using defaults:', error.message);
        return {
            minInstances: 3,
            maxInstances: 10,
            instanceTimeout: 600000,
            healthCheckInterval: 60000,
            loadBalancingStrategy: 'least-busy'
        };
    }
}

// Initialize SkSpreadSheetPool
let wSkSpreadSheet = new SkSpreadSheetPoolInterface(loadPoolConfig());

// Initialize the pool
await wSkSpreadSheet.initializeSkerSpreadSheet();

// =============================================================================
// ADD THESE NEW ROUTES TO SkServer.mjs:
// =============================================================================

// Pool monitoring and management routes
fastify.get('/api/spreadsheet/pool/stats', async (request, reply) => {
    try {
        const stats = wSkSpreadSheet.getStats();
        const health = wSkSpreadSheet.getHealth();
        
        return {
            success: true,
            stats,
            health,
            timestamp: Date.now()
        };
    } catch (error) {
        console.error('Error getting pool stats:', error);
        return reply.status(500).send({
            success: false,
            error: 'Failed to get pool statistics'
        });
    }
});

fastify.get('/api/spreadsheet/pool/health', async (request, reply) => {
    try {
        const health = wSkSpreadSheet.getHealth();
        
        return {
            success: true,
            health,
            timestamp: Date.now()
        };
    } catch (error) {
        console.error('Error getting pool health:', error);
        return reply.status(500).send({
            success: false,
            error: 'Failed to get pool health'
        });
    }
});

fastify.post('/api/spreadsheet/pool/scale', async (request, reply) => {
    try {
        const { action, count = 1 } = request.body;
        
        if (!['scale-up', 'scale-down'].includes(action)) {
            return reply.status(400).send({
                success: false,
                error: 'Invalid action. Use "scale-up" or "scale-down"'
            });
        }
        
        const pool = wSkSpreadSheet.getPool();
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
        
        const newStats = wSkSpreadSheet.getStats();
        
        return {
            success: true,
            action,
            count,
            previousInstances: currentInstances,
            currentInstances: newStats.totalInstances,
            message: `Pool ${action === 'scale-up' ? 'scaled up' : 'scaled down'} by ${count} instances`
        };
    } catch (error) {
        console.error('Error scaling pool:', error);
        return reply.status(500).send({
            success: false,
            error: 'Failed to scale pool'
        });
    }
});

fastify.post('/api/spreadsheet/pool/reset', async (request, reply) => {
    try {
        const pool = wSkSpreadSheet.getPool();
        
        // Get current instances
        const currentInstances = Array.from(pool.instances.keys());
        
        // Remove all instances
        currentInstances.forEach(id => {
            pool._removeInstance(id);
        });
        
        // Recreate minimum instances
        await wSkSpreadSheet.initializeSkerSpreadSheet();
        
        return {
            success: true,
            message: 'Pool reset successfully',
            removedInstances: currentInstances.length,
            newInstances: pool.instances.size
        };
    } catch (error) {
        console.error('Error resetting pool:', error);
        return reply.status(500).send({
            success: false,
            error: 'Failed to reset pool'
        });
    }
});

// =============================================================================
// MODIFY THE CHAT EVENT HANDLERS IN SkServer.mjs:
// =============================================================================

// OLD CODE (to replace):
/*
dependenciesContainer.resolve("SkSpreadSheet").chatJoin(data.username);
dependenciesContainer.resolve("SkSpreadSheet").chatLeave(data.username);
dependenciesContainer.resolve("SkSpreadSheet").chatReceiveMessage(payload);
*/

// NEW CODE (to add):
// Use the pool interface instead
wSkSpreadSheet.chatJoin(data.username);
wSkSpreadSheet.chatLeave(data.username);
wSkSpreadSheet.chatReceiveMessage(payload);

// =============================================================================
// ADD POOL CLEANUP IN THE SERVER SHUTDOWN:
// =============================================================================

// Add graceful shutdown handling
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...');
    
    try {
        if (wSkSpreadSheet) {
            await wSkSpreadSheet.cleanup();
        }
        
        if (skChat) {
            skChat.close();
        }
        
        console.log('Server shutdown complete');
        process.exit(0);
    } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
    }
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, shutting down gracefully...');
    
    try {
        if (wSkSpreadSheet) {
            await wSkSpreadSheet.cleanup();
        }
        
        if (skChat) {
            skChat.close();
        }
        
        console.log('Server shutdown complete');
        process.exit(0);
    } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
    }
});

// =============================================================================
// REGISTER THE POOL IN THE DEPENDENCY CONTAINER:
// =============================================================================

// OLD CODE (to replace):
// dependenciesContainer.register("SkSpreadSheet", wSkSpreadSheet);

// NEW CODE (to add):
dependenciesContainer.register("SkSpreadSheet", wSkSpreadSheet);
dependenciesContainer.register("SkSpreadSheetPool", wSkSpreadSheet.getPool());

// =============================================================================
// ADD POOL STATUS LOGGING:
// =============================================================================

// Log pool status periodically
setInterval(() => {
    try {
        const health = wSkSpreadSheet.getHealth();
        console.log(`📊 Pool Status: ${health.activeInstances}/${health.poolSize} instances active, ${health.successRate.toFixed(2)}% success rate`);
        
        // Alert if pool is unhealthy
        if (health.successRate < 90) {
            console.warn(`⚠️  Pool health warning: Low success rate (${health.successRate.toFixed(2)}%)`);
        }
        
        if (health.averageResponseTime > 10000) {
            console.warn(`⚠️  Pool performance warning: High response time (${health.averageResponseTime.toFixed(2)}ms)`);
        }
    } catch (error) {
        console.error('Error logging pool status:', error);
    }
}, 60000); // Log every minute

// =============================================================================
// EXAMPLE OF USING THE POOL FOR SPREADSHEET OPERATIONS:
// =============================================================================

// Add a route to demonstrate pool usage
fastify.post('/api/spreadsheet/operation', async (request, reply) => {
    try {
        const { operation, data } = request.body;
        
        let result;
        
        switch (operation) {
            case 'setCellValue':
                result = await wSkSpreadSheet.setCellValue(data.row, data.col, data.value);
                break;
                
            case 'getCellValue':
                result = await wSkSpreadSheet.getCellValue(data.row, data.col);
                break;
                
            case 'loadWorkbook':
                result = await wSkSpreadSheet.loadWorkbook(data.workbook);
                break;
                
            case 'saveWorkbook':
                result = await wSkSpreadSheet.saveWorkbook();
                break;
                
            default:
                return reply.status(400).send({
                    success: false,
                    error: `Unknown operation: ${operation}`
                });
        }
        
        return {
            success: true,
            operation,
            result,
            timestamp: Date.now()
        };
        
    } catch (error) {
        console.error('Error executing spreadsheet operation:', error);
        return reply.status(500).send({
            success: false,
            error: 'Failed to execute spreadsheet operation',
            details: error.message
        });
    }
});

console.log('SkServer with Pool integration ready');
console.log('Pool endpoints available:');
console.log('  GET  /api/spreadsheet/pool/stats');
console.log('  GET  /api/spreadsheet/pool/health');
console.log('  POST /api/spreadsheet/pool/scale');
console.log('  POST /api/spreadsheet/pool/reset');
console.log('  POST /api/spreadsheet/operation');
