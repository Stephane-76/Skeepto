import React from 'react';
import { SkGridTreeView } from './component/SkGridTreeView';
import { showConfirm, showError, showSuccess } from './skDialog.js';

/** Same-origin API as SkLogin / VirtualDisk (works in prod behind :8000 or reverse proxy). */
const POOL_API_BASE = '/spreadsheet/pool';

function poolFetch(path, options = {}) {
    const jwt = sessionStorage.getItem('jwt');
    const method = (options.method || 'GET').toUpperCase();
    const needsJsonBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
    let body = options.body;
    if (needsJsonBody && (body === undefined || body === null || body === '')) {
        body = '{}';
    }
    const headers = {
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        ...options.headers,
    };
    if (body != null && body !== '') {
        headers['Content-Type'] = 'application/json';
    }
    return fetch(`${POOL_API_BASE}${path}`, {
        credentials: 'include',
        ...options,
        method,
        body: needsJsonBody ? body : options.body,
        headers,
    });
}

export class SkPoolStats extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            selectedRow: null,
            data: [],
            expandedNodes: new Set(),
            refreshInterval: null,
            lastRefresh: null,
            isLoading: false,
            error: null,
            poolStats: null // Store raw pool statistics
        };

        // Add gridRef for the SkGridTreeView component
        this.gridRef = React.createRef();

        this.m_data = {
            columns: [
                { header: 'Workbook', field: 'workbookName', width: '200px' },
                { header: 'Path', field: 'workbook', width: '280px' },
                { header: 'Instance ID', field: 'id', width: '240px' },
                { header: 'Status', field: 'status', width: '100px' },
                { header: 'Health', field: 'health', width: '110px' },
                { header: 'Usage', field: 'usageCount', width: '90px', align: 'right' },
                { header: 'Errors', field: 'errorCount', width: '90px', align: 'right' },
                { header: 'Last Used', field: 'lastUsed', width: '120px' },
                { header: 'Resp.', field: 'responseTime', width: '90px', align: 'right' }
            ],
            data: []
        };

        // Status icons definition
        this.statusIcons = {
            // Active instance
            active: (
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="8" cy="8" r="6" fill="#4CAF50" stroke="#2E7D32" strokeWidth="2"/>
                    <path d="M6 8L7.5 9.5L10 7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            ),
            // Busy instance
            busy: (
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="8" cy="8" r="6" fill="#FF9800" stroke="#F57C00" strokeWidth="2"/>
                    <path d="M8 2V8L11 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            ),
            // Error instance
            error: (
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="8" cy="8" r="6" fill="#F44336" stroke="#D32F2F" strokeWidth="2"/>
                    <path d="M10 6L6 10M6 6L10 10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                </svg>
            ),
            // Inactive instance
            inactive: (
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="8" cy="8" r="6" fill="#9E9E9E" stroke="#757575" strokeWidth="2"/>
                    <path d="M5 8H11" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                </svg>
            )
        };

        // Health icons definition
        this.healthIcons = {
            // Excellent health
            excellent: (
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 1L10 5L14 6L10 7L8 11L6 7L2 6L6 5L8 1Z" fill="#4CAF50"/>
                </svg>
            ),
            // Good health
            good: (
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 1L10 5L14 6L10 7L8 11L6 7L2 6L6 5L8 1Z" fill="#8BC34A"/>
                </svg>
            ),
            // Warning health
            warning: (
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 1L10 5L14 6L10 7L8 11L6 7L2 6L6 5L8 1Z" fill="#FF9800"/>
                </svg>
            ),
            // Poor health
            poor: (
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 1L10 5L14 6L10 7L8 11L6 7L2 6L6 5L8 1Z" fill="#F44336"/>
                </svg>
            )
        };
    }

    getStatusIcon = (instance) => {
        if (instance.errorCount > 5) {
            return this.statusIcons.error;
        } else if (instance.isBusy) {
            return this.statusIcons.busy;
        } else if (instance.isHealthy) {
            return this.statusIcons.active;
        } else {
            return this.statusIcons.inactive;
        }
    }

    getHealthIcon = (instance) => {
        if (instance.errorCount === 0) {
            return this.healthIcons.excellent;
        } else if (instance.errorCount <= 2) {
            return this.healthIcons.good;
        } else if (instance.errorCount <= 5) {
            return this.healthIcons.warning;
        } else {
            return this.healthIcons.poor;
        }
    }

    getStatusText = (instance) => {
        if (instance.errorCount > 5) {
            return 'Error';
        } else if (instance.isBusy) {
            return 'Busy';
        } else if (instance.isHealthy) {
            return 'Active';
        } else {
            return 'Inactive';
        }
    }

    getHealthText = (instance) => {
        if (instance.errorCount === 0) {
            return 'Excellent';
        } else if (instance.errorCount <= 2) {
            return 'Good';
        } else if (instance.errorCount <= 5) {
            return 'Warning';
        } else {
            return 'Poor';
        }
    }

    // Utility function to format date
    formatDate = (timestamp) => {
        if (!timestamp) return 'Never';
        
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) {
            return 'Just now';
        } else if (diffMins < 60) {
            return `${diffMins}m ago`;
        } else if (diffHours < 24) {
            return `${diffHours}h ago`;
        } else if (diffDays < 7) {
            return `${diffDays}d ago`;
        } else {
            return date.toLocaleDateString('fr-FR', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    }

    // Format response time
    formatResponseTime = (ms) => {
        if (!ms || ms === 0) return 'N/A';
        
        if (ms < 1000) {
            return `${Math.round(ms)}ms`;
        } else if (ms < 60000) {
            return `${(ms / 1000).toFixed(1)}s`;
        } else {
            return `${(ms / 60000).toFixed(1)}m`;
        }
    }

    processPoolData = (poolStats) => {
        console.log('Processing pool data:', poolStats); // Debug log
        
        // Handle different response formats
        let instances = [];
        let responseTime = 0;
        
        // If poolStats is already an array, use it directly
        if (Array.isArray(poolStats)) {
            instances = poolStats;
        }
        // If poolStats has a specific structure, extract instances
        else if (poolStats && typeof poolStats === 'object') {
            // Check for stats.instanceDetails (most common structure from server)
            if (poolStats.stats && poolStats.stats.instanceDetails && Array.isArray(poolStats.stats.instanceDetails)) {
                instances = poolStats.stats.instanceDetails;
                responseTime = poolStats.stats.averageResponseTime || 0;
            }
            // Check for direct instanceDetails
            else if (poolStats.instanceDetails && Array.isArray(poolStats.instanceDetails)) {
                instances = poolStats.instanceDetails;
                responseTime = poolStats.averageResponseTime || 0;
            }
            // Check for stats.instances
            else if (poolStats.stats && poolStats.stats.instances && Array.isArray(poolStats.stats.instances)) {
                instances = poolStats.stats.instances;
                responseTime = poolStats.stats.averageResponseTime || 0;
            }
            // Check for direct instances
            else if (poolStats.instances && Array.isArray(poolStats.instances)) {
                instances = poolStats.instances;
                responseTime = poolStats.averageResponseTime || 0;
            }
            // Check for data array
            else if (poolStats.data && Array.isArray(poolStats.data)) {
                instances = poolStats.data;
                responseTime = poolStats.averageResponseTime || 0;
            }
            // Check for stats as array
            else if (poolStats.stats && Array.isArray(poolStats.stats)) {
                instances = poolStats.stats;
                responseTime = poolStats.averageResponseTime || 0;
            } else {
                // Try to extract any array from the response
                console.log('Searching for array data in response...');
                for (const key in poolStats) {
                    if (Array.isArray(poolStats[key])) {
                        console.log(`Found array in key: ${key} with ${poolStats[key].length} items`);
                        instances = poolStats[key];
                        break;
                    }
                }
            }
        }
        
        // If still no instances found, try to create from the response itself
        if (instances.length === 0) {
            console.warn('No instances array found, checking if response can be processed directly...');
            
            // Check if the response itself looks like instance data
            if (poolStats && typeof poolStats === 'object' && poolStats.id) {
                // Single instance
                instances = [poolStats];
            } else if (poolStats && typeof poolStats === 'object') {
                // Try to create instance from poolStats properties
                const mockInstance = {
                    id: 'pool_overview',
                    isBusy: false,
                    lastUsed: Date.now(),
                    usageCount: poolStats.totalInstances || 0,
                    errorCount: poolStats.errorInstances || 0,
                    isHealthy: true
                };
                instances = [mockInstance];
            }
        }

        if (!Array.isArray(instances)) {
            console.error('Instances is not an array:', instances);
            return [];
        }

        console.log(`Processing ${instances.length} instances`);

        // Optional top-level workbook → instance map (server enrichment).
        const workbookByInstance = {};
        const workbookList =
            (poolStats && poolStats.stats && poolStats.stats.workbooks) ||
            (poolStats && poolStats.workbooks) ||
            [];
        if (Array.isArray(workbookList)) {
            for (const entry of workbookList) {
                if (!entry || entry.instanceId == null || !entry.path) continue;
                const key = String(entry.instanceId);
                if (!workbookByInstance[key]) workbookByInstance[key] = [];
                workbookByInstance[key].push(String(entry.path));
            }
        }

        const basename = (path) => {
            const parts = String(path || '').split('/').filter(Boolean);
            return parts.length ? parts[parts.length - 1] : String(path || '');
        };

        return instances.map(instance => {
            if (!instance || typeof instance !== 'object') {
                console.warn('Invalid instance data:', instance);
                return null;
            }
            
            try {
                const instanceId = String(instance.id || `unknown_${Math.random()}`);
                let workbooks = Array.isArray(instance.workbooks) ? instance.workbooks.slice() : [];
                if (workbooks.length === 0 && workbookByInstance[instanceId]) {
                    workbooks = workbookByInstance[instanceId].slice();
                }
                const workbookPath =
                    instance.workbook ||
                    (workbooks.length ? workbooks.join(', ') : '');
                const workbookName =
                    (instance.workbookName && instance.workbookName !== '—')
                        ? instance.workbookName
                        : (workbooks.length ? workbooks.map(basename).join(', ') : '');

                return {
                    ...instance,
                    id: instanceId,
                    workbookName: workbookName || '—',
                    workbook: workbookPath || '—',
                    workbooks,
                    status: this.getStatusText(instance),
                    health: this.getHealthText(instance),
                    lastUsed: this.formatDate(instance.lastUsed),
                    responseTime: this.formatResponseTime(responseTime),
                    usageCount: instance.usageCount ?? 0,
                    errorCount: instance.errorCount ?? 0,
                    children: []
                };
            } catch (error) {
                console.error('Error processing instance:', instance, error);
                return null;
            }
        }).filter(Boolean); // Remove null entries
    }

    async fetchPoolStats() {
        try {
            this.setState({ isLoading: true, error: null });
            
            const response = await poolFetch('/stats', { method: 'GET' });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            console.log('Pool stats response:', result); // Debug log
            
            // Try to process the result regardless of format
            console.log('Processing result:', result);
            const processedData = this.processPoolData(result);
            
            // Store raw pool statistics for summary display
            const poolStats = result.stats || result;
            
            if (processedData && processedData.length > 0) {
                this.m_data.data = processedData;
                
                this.setState({ 
                    data: processedData,
                    poolStats: poolStats,
                    lastRefresh: new Date(),
                    error: null
                });
            } else if (process.env.NODE_ENV === 'development') {
                // Fallback for development - create mock data
                console.warn('No valid data found, using mock data for development');
                const mockData = this.createMockPoolData();
                this.m_data.data = mockData;
                
                this.setState({ 
                    data: mockData,
                    lastRefresh: new Date(),
                    error: null
                });
            } else {
                console.error('No valid data found in response:', result);
                throw new Error('No valid pool data found in response');
            }
        } catch (error) {
            console.error('Error fetching pool stats:', error);
            
            // Don't show "Error: success" - that's confusing
            let errorMessage = error.message;
            if (errorMessage === 'success') {
                errorMessage = 'Unexpected response format';
            }
            
            if (process.env.NODE_ENV === 'development') {
                // Use mock data in development on error
                console.warn('Using mock data due to error in development');
                const mockData = this.createMockPoolData();
                this.m_data.data = mockData;
                
                this.setState({ 
                    data: mockData,
                    lastRefresh: new Date(),
                    error: null
                });
            } else {
                this.setState({ 
                    error: `Error: ${errorMessage}. Check console for details.`,
                    lastRefresh: new Date()
                });
            }
        } finally {
            this.setState({ isLoading: false });
        }
    }

    createMockPoolData() {
        // Create mock data for development/testing
        const mockInstances = [];
        for (let i = 0; i < 5; i++) {
            mockInstances.push({
                id: `mock_instance_${i + 1}`,
                isBusy: Math.random() > 0.7,
                lastUsed: Date.now() - Math.random() * 300000, // Random time within 5 minutes
                usageCount: Math.floor(Math.random() * 100),
                errorCount: Math.floor(Math.random() * 5),
                isHealthy: Math.random() > 0.2
            });
        }
        
        return mockInstances.map(instance => ({
            ...instance,
            id: instance.id,
            status: this.getStatusText(instance),
            statusIcon: this.getStatusIcon(instance),
            health: this.getHealthText(instance),
            healthIcon: this.getHealthIcon(instance),
            lastUsed: this.formatDate(instance.lastUsed),
            responseTime: this.formatResponseTime(150 + Math.random() * 200), // Random response time
            children: []
        }));
    }

    async componentDidMount() {
        // Initial fetch
        await this.fetchPoolStats();
        
        // Set up auto-refresh every 5 seconds
        const interval = setInterval(() => {
            this.fetchPoolStats();
        }, 5000);
        
        this.setState({ refreshInterval: interval });
    }

    componentWillUnmount() {
        // Clean up interval
        if (this.state.refreshInterval) {
            clearInterval(this.state.refreshInterval);
        }
    }

    handleRowSelect = (row) => {
        this.setState({ selectedRow: row });
        console.log('Row selected:', row);
    }

    handleRefresh = async () => {
        await this.fetchPoolStats();
    }

    handleScaleUp = async () => {
        try {
            const response = await poolFetch('/scale', {
                method: 'POST',
                body: JSON.stringify({
                    action: 'scale-up',
                    count: 1
                })
            });

            if (response.ok) {
                await this.fetchPoolStats();
                await showSuccess('Pool scaled up successfully!');
            } else {
                const error = await response.json();
                await showError(`Error scaling up: ${error.error}`);
            }
        } catch (error) {
            console.error('Error scaling up:', error);
            await showError('Error scaling up pool');
        }
    }

    handleScaleDown = async () => {
        try {
            const response = await poolFetch('/scale', {
                method: 'POST',
                body: JSON.stringify({
                    action: 'scale-down',
                    count: 1
                })
            });

            if (response.ok) {
                await this.fetchPoolStats();
                await showSuccess('Pool scaled down successfully!');
            } else {
                const error = await response.json();
                await showError(`Error scaling down: ${error.error}`);
            }
        } catch (error) {
            console.error('Error scaling down:', error);
            await showError('Error scaling down pool');
        }
    }

    handleReset = async () => {
        const confirmed = await showConfirm({
            title: 'Reset pool',
            message: 'Are you sure you want to reset the entire pool?',
            detail: 'This will restart all instances.',
            confirmLabel: 'Reset',
            danger: true,
        });
        if (!confirmed) {
            return;
        }
        try {
            const response = await poolFetch('/reset', { method: 'POST' });

            if (response.ok) {
                await this.fetchPoolStats();
                await showSuccess('Pool reset successfully!');
            } else {
                const error = await response.json();
                await showError(`Error resetting pool: ${error.error}`);
            }
        } catch (error) {
            console.error('Error resetting pool:', error);
            await showError('Error resetting pool');
        }
    }

    render() {
        const { isLoading, error, lastRefresh, selectedRow } = this.state;

        return (
            <div className="SkPoolStats" style={{ paddingBottom: '80px' }}>
                {/* Header with summary stats */}
                <div style={{
                    backgroundColor: '#f8f9fa',
                    padding: '20px',
                    marginBottom: '20px',
                    borderRadius: '8px',
                    border: '1px solid #dee2e6'
                }}>
                    <h2 style={{ margin: '0 0 15px 0', color: '#495057' }}>
                        🚀 WebAssembly Instance Pool Statistics
                    </h2>
                    
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: '15px',
                        marginBottom: '15px'
                    }}>
                        <div style={{
                            backgroundColor: '#e8f5e8',
                            padding: '15px',
                            borderRadius: '6px',
                            border: '1px solid #c8e6c9'
                        }}>
                            <h4 style={{ margin: '0 0 5px 0', color: '#2e7d32' }}>Total Instances</h4>
                            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#2e7d32' }}>
                                {this.state.poolStats?.totalInstances ?? this.m_data.data.length}
                            </div>
                        </div>
                        
                        <div style={{
                            backgroundColor: '#fff3e0',
                            padding: '15px',
                            borderRadius: '6px',
                            border: '1px solid #ffcc80'
                        }}>
                            <h4 style={{ margin: '0 0 5px 0', color: '#f57c00' }}>Active Instances</h4>
                            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#f57c00' }}>
                                {this.state.poolStats?.activeInstances ?? this.m_data.data.filter(inst => inst.status === 'Active').length}
                            </div>
                        </div>

                        <div style={{
                            backgroundColor: '#ffebee',
                            padding: '15px',
                            borderRadius: '6px',
                            border: '1px solid #ffcdd2'
                        }}>
                            <h4 style={{ margin: '0 0 5px 0', color: '#d32f2f' }}>Error Instances</h4>
                            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#d32f2f' }}>
                                {this.m_data.data.filter(inst => inst.status === 'Error').length}
                            </div>
                        </div>

                        <div style={{
                            backgroundColor: '#e3f2fd',
                            padding: '15px',
                            borderRadius: '6px',
                            border: '1px solid #bbdefb'
                        }}>
                            <h4 style={{ margin: '0 0 5px 0', color: '#1976d2' }}>Last Refresh</h4>
                            <div style={{ fontSize: '14px', color: '#1976d2' }}>
                                {lastRefresh ? lastRefresh.toLocaleTimeString('fr-FR') : 'Never'}
                            </div>
                        </div>

                        <div style={{
                            backgroundColor: '#ede7f6',
                            padding: '15px',
                            borderRadius: '6px',
                            border: '1px solid #d1c4e9'
                        }}>
                            <h4 style={{ margin: '0 0 5px 0', color: '#5e35b1' }}>WASM Version</h4>
                            <div
                                style={{ fontSize: '14px', fontFamily: 'monospace', color: '#5e35b1' }}
                                title={this.state.poolStats?.wasmVersion || ''}
                            >
                                {this.state.poolStats?.wasmVersion
                                    ? this.state.poolStats.wasmVersion.slice(0, 12)
                                    : '—'}
                            </div>
                        </div>
                    </div>
                    
                    {error && (
                        <div style={{
                            backgroundColor: '#ffebee',
                            color: '#c62828',
                            padding: '10px',
                            borderRadius: '4px',
                            border: '1px solid #ffcdd2',
                            marginBottom: '15px'
                        }}>
                            ⚠️ Error: {error}
                        </div>
                    )}
                </div>

                {/* Pool instances grid */}
                <SkGridTreeView 
                    ref={this.gridRef}
                    columns={this.m_data.columns}
                    data={this.m_data.data}
                    onRowSelect={this.handleRowSelect}
                    selectedRow={selectedRow}
                    columnWidthsKey="SkPoolStatsColumnWidths"
                />

                {/* Control panel */}
                <div style={{
                    position: 'fixed',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    backgroundColor: '#f5f5f5',
                    padding: '15px',
                    borderTop: '1px solid #ddd',
                    boxShadow: '0 -2px 5px rgba(0,0,0,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                }}>
                    <div style={{ flex: 1 }}>
                        <h3 style={{ margin: 0, color: '#495057' }}>
                            {selectedRow ? `Instance: ${selectedRow.id}` : 'No instance selected'}
                        </h3>
                        {selectedRow && (
                            <div style={{ fontSize: '12px', color: '#6c757d', marginTop: '5px' }}>
                                Workbook: {selectedRow.workbookName || '—'}
                                {selectedRow.workbook ? ` (${selectedRow.workbook})` : ''}
                                {' | '}
                                Status: {selectedRow.status} | Health: {selectedRow.health} |
                                Usage: {selectedRow.usageCount} | Errors: {selectedRow.errorCount}
                            </div>
                        )}
                    </div>
                    
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button 
                            onClick={this.handleRefresh}
                            disabled={isLoading}
                            style={{
                                padding: '8px 16px',
                                backgroundColor: '#2196F3',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: isLoading ? 'not-allowed' : 'pointer',
                                opacity: isLoading ? 0.6 : 1
                            }}
                        >
                            {isLoading ? '🔄 Refreshing...' : '🔄 Refresh'}
                        </button>
                        
                        <button 
                            onClick={this.handleScaleUp}
                            style={{
                                padding: '8px 16px',
                                backgroundColor: '#4CAF50',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                        >
                            ⬆️ Scale Up
                        </button>
                        
                        <button 
                            onClick={this.handleScaleDown}
                            style={{
                                padding: '8px 16px',
                                backgroundColor: '#FF9800',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                        >
                            ⬇️ Scale Down
                        </button>
                        
                        <button 
                            onClick={this.handleReset}
                            style={{
                                padding: '8px 16px',
                                backgroundColor: '#f44336',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                        >
                            🔄 Reset Pool
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}

export default SkPoolStats;
