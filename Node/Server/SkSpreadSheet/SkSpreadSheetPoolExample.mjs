//=============================================================================
// SkSpreadSheetPoolExample.mjs
// Example usage of the WebAssembly instance pool
// Author: Stéphane ALLEZ
//=============================================================================

import SkSpreadSheetPoolInterface from './SkSpreadSheetPoolInterface.mjs';

/**
 * Example demonstrating how to use the WebAssembly instance pool
 */
async function exampleUsage() {
    console.log('=== SkSpreadSheet Pool Example ===');
    
    // Create pool interface with custom configuration
    const poolInterface = new SkSpreadSheetPoolInterface({
        minInstances: 3,           // Start with 3 instances
        maxInstances: 8,           // Maximum 8 instances
        instanceTimeout: 600000,   // 10 minutes timeout
        healthCheckInterval: 30000, // 30 seconds health check
        loadBalancingStrategy: 'least-busy', // Use least busy strategy
        onCellChange: (cellRef, instanceId) => {
            console.log(`Cell changed in instance ${instanceId}:`, cellRef);
        }
    });
    
    try {
        // Initialize the pool
        console.log('Initializing pool...');
        await poolInterface.initializeSkerSpreadSheet();
        
        // Example 1: Execute multiple tasks concurrently
        console.log('\n--- Example 1: Concurrent task execution ---');
        const concurrentTasks = [
            poolInterface.executeTask((uISpreadSheet) => {
                console.log('Task 1 executing...');
                // Simulate some work
                return new Promise(resolve => setTimeout(() => resolve('Task 1 completed'), 1000));
            }),
            poolInterface.executeTask((uISpreadSheet) => {
                console.log('Task 2 executing...');
                return new Promise(resolve => setTimeout(() => resolve('Task 2 completed'), 800));
            }),
            poolInterface.executeTask((uISpreadSheet) => {
                console.log('Task 3 executing...');
                return new Promise(resolve => setTimeout(() => resolve('Task 3 completed'), 1200));
            })
        ];
        
        const results = await Promise.all(concurrentTasks);
        console.log('Concurrent results:', results);
        
        // Example 2: Spreadsheet operations
        console.log('\n--- Example 2: Spreadsheet operations ---');
        
        // Load a workbook
        const workbookData = { name: 'Example.xlsx', sheets: [{ name: 'Sheet1' }] };
        await poolInterface.loadWorkbook(workbookData);
        console.log('Workbook loaded');
        
        // Set some cell values
        await poolInterface.setCellValue(1, 1, 'Hello');
        await poolInterface.setCellValue(1, 2, 'World');
        console.log('Cell values set');
        
        // Get cell values
        const value1 = await poolInterface.getCellValue(1, 1);
        const value2 = await poolInterface.getCellValue(1, 2);
        console.log('Cell values:', value1, value2);
        
        // Example 3: Monitor pool health
        console.log('\n--- Example 3: Pool monitoring ---');
        
        // Get pool statistics
        const stats = poolInterface.getStats();
        console.log('Pool statistics:', {
            totalInstances: stats.totalInstances,
            activeInstances: stats.activeInstances,
            totalRequests: stats.totalRequests,
            successfulRequests: stats.successfulRequests,
            failedRequests: stats.failedRequests,
            averageResponseTime: `${stats.averageResponseTime.toFixed(2)}ms`
        });
        
        // Get health status
        const health = poolInterface.getHealth();
        console.log('Pool health:', health);
        
        // Example 4: Stress test
        console.log('\n--- Example 4: Stress test ---');
        
        const stressTestTasks = [];
        for (let i = 0; i < 20; i++) {
            stressTestTasks.push(
                poolInterface.executeTask((uISpreadSheet) => {
                    return new Promise(resolve => {
                        setTimeout(() => resolve(`Stress test task ${i + 1} completed`), Math.random() * 2000);
                    });
                })
            );
        }
        
        console.log('Executing 20 stress test tasks...');
        const stressResults = await Promise.all(stressTestTasks);
        console.log(`Stress test completed: ${stressResults.length} tasks`);
        
        // Final statistics
        console.log('\n--- Final statistics ---');
        const finalStats = poolInterface.getStats();
        console.log('Final pool statistics:', {
            totalInstances: finalStats.totalInstances,
            activeInstances: finalStats.activeInstances,
            totalRequests: finalStats.totalRequests,
            successRate: `${((finalStats.successfulRequests / finalStats.totalRequests) * 100).toFixed(2)}%`,
            averageResponseTime: `${finalStats.averageResponseTime.toFixed(2)}ms`
        });
        
        // Example 5: Chat operations
        console.log('\n--- Example 5: Chat operations ---');
        
        await poolInterface.chatJoin('user1');
        console.log('User joined chat');
        
        await poolInterface.chatReceiveMessage('Hello from user1');
        console.log('Chat message received');
        
        await poolInterface.chatLeave('user1');
        console.log('User left chat');
        
    } catch (error) {
        console.error('Example execution failed:', error);
    } finally {
        // Cleanup
        console.log('\n--- Cleanup ---');
        await poolInterface.cleanup();
        console.log('Pool cleaned up');
    }
}

/**
 * Example of pool configuration for different scenarios
 */
function getPoolConfigurations() {
    return {
        // Development configuration - minimal instances
        development: {
            minInstances: 1,
            maxInstances: 3,
            instanceTimeout: 300000, // 5 minutes
            healthCheckInterval: 120000, // 2 minutes
            loadBalancingStrategy: 'round-robin'
        },
        
        // Production configuration - balanced performance
        production: {
            minInstances: 5,
            maxInstances: 15,
            instanceTimeout: 600000, // 10 minutes
            healthCheckInterval: 60000, // 1 minute
            loadBalancingStrategy: 'least-busy'
        },
        
        // High-performance configuration - maximum instances
        highPerformance: {
            minInstances: 10,
            maxInstances: 50,
            instanceTimeout: 900000, // 15 minutes
            healthCheckInterval: 30000, // 30 seconds
            loadBalancingStrategy: 'least-used'
        },
        
        // Memory-optimized configuration - minimal memory usage
        memoryOptimized: {
            minInstances: 2,
            maxInstances: 5,
            instanceTimeout: 180000, // 3 minutes
            healthCheckInterval: 90000, // 1.5 minutes
            loadBalancingStrategy: 'round-robin'
        }
    };
}

/**
 * Example of monitoring and alerting
 */
function setupMonitoring(poolInterface) {
    // Monitor pool events
    const pool = poolInterface.getPool();
    
    pool.on('poolReady', () => {
        console.log('🚀 Pool is ready for production use');
    });
    
    pool.on('instanceCreated', ({ id }) => {
        console.log(`➕ New instance created: ${id}`);
    });
    
    pool.on('instanceRemoved', ({ id }) => {
        console.log(`➖ Instance removed: ${id}`);
    });
    
    pool.on('poolError', (error) => {
        console.error('❌ Pool error:', error);
        // Here you could send alerts to monitoring systems
    });
    
    // Set up periodic health monitoring
    setInterval(() => {
        const health = poolInterface.getHealth();
        
        // Alert if success rate drops below 95%
        if (health.successRate < 95) {
            console.warn(`⚠️  Low success rate: ${health.successRate.toFixed(2)}%`);
        }
        
        // Alert if response time is too high
        if (health.averageResponseTime > 5000) {
            console.warn(`⚠️  High response time: ${health.averageResponseTime.toFixed(2)}ms`);
        }
        
        // Log health status
        console.log(`📊 Pool health: ${health.activeInstances}/${health.poolSize} instances active, ${health.successRate.toFixed(2)}% success rate`);
    }, 30000); // Check every 30 seconds
}

// Export functions for use in other modules
export {
    exampleUsage,
    getPoolConfigurations,
    setupMonitoring
};

// Run example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    exampleUsage().catch(console.error);
}
