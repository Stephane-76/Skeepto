# SkSpreadSheet WebAssembly Instance Pool

This module provides a pooling solution to manage multiple WebAssembly instances of SkSpreadSheet, improving performance and load handling.

## 🚀 Features

### Instance pool
- **Automatic management** of WebAssembly instances
- **Auto-scaling** based on load
- **Real-time health monitoring**
- **Automatic cleanup** of failing instances

### Load Balancing
- **Round-robin**: Sequential distribution of requests
- **Least-busy**: Routes to the least busy instance
- **Least-used**: Routes to the least recently used instance

### Monitoring and metrics
- Real-time performance statistics
- Success rate and response time
- Instance health status
- Configurable alerts

## 📁 File structure

```
SkSpreadSheet/
├── SkSpreadSheetPool.mjs           # Main pool manager
├── SkSpreadSheetPoolInterface.mjs  # Pool user interface
├── SkSpreadSheetPoolExample.mjs    # Usage examples
├── pool.config.json                # Predefined configurations
└── README_Pool.md                  # This file
```

## 🔧 Installation and usage

### 1. Import the pool

```javascript
import SkSpreadSheetPoolInterface from './SkSpreadSheet/SkSpreadSheetPoolInterface.mjs';
```

### 2. Create an instance

```javascript
const poolInterface = new SkSpreadSheetPoolInterface({
    minInstances: 3,           // Minimum instances at startup
    maxInstances: 10,          // Maximum allowed instances
    instanceTimeout: 600000,   // Instance timeout (10 min)
    healthCheckInterval: 30000, // Health check (30 sec)
    loadBalancingStrategy: 'least-busy', // Distribution strategy
    onCellChange: (cellRef, instanceId) => {
        console.log(`Cell changed in instance ${instanceId}:`, cellRef);
    }
});
```

### 3. Initialization

```javascript
await poolInterface.initializeSkerSpreadSheet();
```

### 4. Usage

```javascript
// Execute a task
const result = await poolInterface.executeTask((uISpreadSheet) => {
    // Your code here
    return uISpreadSheet.someMethod();
});

// Spreadsheet operations
await poolInterface.setCellValue(1, 1, 'Hello');
const value = await poolInterface.getCellValue(1, 1);
```

## ⚙️ Configuration

### Predefined configurations

The `pool.config.json` file contains configurations for different environments:

- **development**: Minimal instances for development
- **staging**: Balanced configuration for testing
- **production**: Optimized configuration for production
- **high-performance**: Maximum performance
- **memory-optimized**: Memory optimization

### Custom configuration

```javascript
const customConfig = {
    minInstances: 5,
    maxInstances: 20,
    instanceTimeout: 900000,        // 15 minutes
    healthCheckInterval: 45000,     // 45 seconds
    loadBalancingStrategy: 'least-used',
    onCellChange: customCellChangeHandler
};
```

## 📊 Monitoring and metrics

### Pool statistics

```javascript
const stats = poolInterface.getStats();
console.log({
    totalInstances: stats.totalInstances,
    activeInstances: stats.activeInstances,
    totalRequests: stats.totalRequests,
    successRate: `${(stats.successfulRequests / stats.totalRequests * 100).toFixed(2)}%`,
    averageResponseTime: `${stats.averageResponseTime.toFixed(2)}ms`
});
```

### Health status

```javascript
const health = poolInterface.getHealth();
console.log({
    isInitialized: health.isInitialized,
    poolSize: health.poolSize,
    activeInstances: health.activeInstances,
    successRate: health.successRate,
    averageResponseTime: health.averageResponseTime
});
```

## 🔄 Load balancing strategies

### Round-robin
```javascript
loadBalancingStrategy: 'round-robin'
```
- Sequential distribution of requests
- Ideal for balanced loads
- Predictable behavior

### Least-busy
```javascript
loadBalancingStrategy: 'least-busy'
```
- Routes to the least busy instance
- Optimizes load distribution
- Ideal for production

### Least-used
```javascript
loadBalancingStrategy: 'least-used'
```
- Routes to the least recently used instance
- Prevents instance starvation
- Ideal for variable workloads

## 🚨 Error handling

### Automatic handling
- Failing instances are automatically removed
- New instances are created to maintain the minimum
- Automatic retry on failure

### Manual handling

```javascript
try {
    const result = await poolInterface.executeTask(task);
} catch (error) {
    console.error('Task failed:', error);
    // Handle the error
}
```

## 🧹 Cleanup and maintenance

### Automatic cleanup
- Inactive instances removed after timeout
- Instances with too many errors removed
- Periodic health checks

### Manual cleanup

```javascript
// Full cleanup
await poolInterface.cleanup();

// Access the underlying pool for more control
const pool = poolInterface.getPool();
```

## 📈 Advanced usage examples

### Concurrent execution

```javascript
const tasks = [
    poolInterface.executeTask(task1),
    poolInterface.executeTask(task2),
    poolInterface.executeTask(task3)
];

const results = await Promise.all(tasks);
```

### Real-time monitoring

```javascript
import { setupMonitoring } from './SkSpreadSheetPoolExample.mjs';

setupMonitoring(poolInterface);
```

### Environment-based configuration

```javascript
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('./pool.config.json', 'utf8'));
const env = process.env.NODE_ENV || 'development';
const poolConfig = config.environments[env];

const poolInterface = new SkSpreadSheetPoolInterface(poolConfig);
```

## 🔍 Debugging

### Detailed logs
The pool generates detailed logs for debugging:
- Instance creation/removal
- Instance health status
- Performance statistics
- Errors and exceptions

### Instance inspection

```javascript
// Get all instances
const instances = poolInterface.getAllInstances();

// Inspect a specific instance
const instance = await poolInterface.getInstance();
console.log(instance.getHealth());
```

## ⚠️ Important considerations

### Memory
- Each WebAssembly instance consumes memory
- Monitor memory usage with `maxInstances`
- Use `instanceTimeout` to release memory

### Performance
- More instances = more parallelism
- But also more memory overhead
- Test to find the right balance

### Stability
- The pool automatically manages failing instances
- Regular health checks maintain stability
- Real-time monitoring detects issues

## 🆘 Support and troubleshooting

### Common issues

1. **Instances are not created**
   - Check the `minInstances` configuration
   - Check error logs

2. **Degraded performance**
   - Increase `maxInstances`
   - Check the load balancing strategy

3. **Excessive memory**
   - Reduce `maxInstances`
   - Lower `instanceTimeout`

### Useful logs

```javascript
// Enable detailed logs
pool.on('instanceCreated', ({ id }) => console.log(`Instance created: ${id}`));
pool.on('instanceRemoved', ({ id }) => console.log(`Instance removed: ${id}`));
pool.on('poolError', (error) => console.error('Pool error:', error));
```

## 📚 References

- [Documentation WebAssembly](https://webassembly.org/)
- [Node.js EventEmitter](https://nodejs.org/api/events.html)
- [Pool Pattern](https://en.wikipedia.org/wiki/Object_pool_pattern)
