#!/usr/bin/env node

/**
 * Enhanced Operational Logger for Live Session Logging
 * 
 * Provides structured metrics, health monitoring, and alerting for the LSL system
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class EnhancedOperationalLogger {
    constructor(options = {}) {
        this.projectPath = options.projectPath || process.cwd();
        this.debug = options.debug || false;
        this.enableStructuredMetrics = options.enableStructuredMetrics !== false;
        this.enableHealthMonitoring = options.enableHealthMonitoring !== false;
        this.enableAlerting = options.enableAlerting !== false;
        this.logLevel = options.logLevel || 'info';
        
        // Metrics storage
        this.metrics = {
            operations: {},
            performance: {},
            errors: {},
            health: {}
        };
        
        // Health monitoring
        this.healthChecks = new Map();
        this.lastHealthCheck = null;
        
        // Alert thresholds
        this.alertThresholds = {
            errorRate: 0.05, // 5%
            responseTime: 1000, // 1 second
            memoryUsage: 0.8, // 80%
            diskUsage: 0.9 // 90%
        };
        
        // Initialize
        this.initialize();
    }
    
    initialize() {
        // Create logs directory
        const logsDir = path.join(this.projectPath, '.lsl', 'operational');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
        
        // Start health monitoring if enabled
        if (this.enableHealthMonitoring) {
            this.startHealthMonitoring();
        }
        
        if (this.debug) {
            console.log('[Enhanced Operational Logger] Initialized');
        }
    }
    
    // Logging methods
    log(level, message, metadata = {}) {
        const logLevels = { debug: 0, info: 1, warn: 2, error: 3 };
        const currentLevel = logLevels[this.logLevel] || 1;
        const messageLevel = logLevels[level] || 1;
        
        if (messageLevel < currentLevel) {
            return; // Skip logs below current level
        }
        
        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            metadata: {
                ...metadata,
                pid: process.pid,
                hostname: os.hostname(),
                memory: process.memoryUsage()
            }
        };
        
        // Output to console if debug
        if (this.debug || level === 'error') {
            const prefix = level.toUpperCase();
            console.log(`[${prefix}] ${message}`, metadata);
        }
        
        // Write to file if structured metrics enabled
        if (this.enableStructuredMetrics) {
            this.writeToFile('operational.jsonl', logEntry);
        }
        
        // Track metrics
        this.updateMetrics(level, message, metadata);
    }
    
    info(message, metadata = {}) {
        this.log('info', message, metadata);
    }
    
    warn(message, metadata = {}) {
        this.log('warn', message, metadata);
    }
    
    error(message, metadata = {}) {
        this.log('error', message, metadata);
    }
    
    debug(message, metadata = {}) {
        this.log('debug', message, metadata);
    }
    
    // Performance tracking
    startTimer(operationName) {
        const start = process.hrtime.bigint();
        return {
            operationName,
            start,
            end: () => {
                const end = process.hrtime.bigint();
                const duration = Number(end - start) / 1000000; // Convert to milliseconds
                this.recordPerformance(operationName, duration);
                return duration;
            }
        };
    }
    
    recordPerformance(operationName, duration, metadata = {}) {
        if (!this.metrics.performance[operationName]) {
            this.metrics.performance[operationName] = {
                count: 0,
                totalTime: 0,
                minTime: Infinity,
                maxTime: 0,
                avgTime: 0
            };
        }
        
        const perf = this.metrics.performance[operationName];
        perf.count++;
        perf.totalTime += duration;
        perf.minTime = Math.min(perf.minTime, duration);
        perf.maxTime = Math.max(perf.maxTime, duration);
        perf.avgTime = perf.totalTime / perf.count;
        
        // Log performance data
        this.log('debug', `Performance: ${operationName}`, {
            duration: `${duration.toFixed(2)}ms`,
            avgDuration: `${perf.avgTime.toFixed(2)}ms`,
            count: perf.count,
            ...metadata
        });
        
        // Check for performance alerts
        if (this.enableAlerting && duration > this.alertThresholds.responseTime) {
            this.alert('performance', `Slow operation: ${operationName} took ${duration.toFixed(2)}ms`, {
                operationName,
                duration,
                threshold: this.alertThresholds.responseTime
            });
        }
    }
    
    // Operation tracking
    recordOperation(operationName, status = 'success', metadata = {}) {
        if (!this.metrics.operations[operationName]) {
            this.metrics.operations[operationName] = {
                success: 0,
                error: 0,
                total: 0
            };
        }
        
        const op = this.metrics.operations[operationName];
        op.total++;
        op[status]++;
        
        this.log('info', `Operation: ${operationName}`, {
            status,
            successRate: `${((op.success / op.total) * 100).toFixed(1)}%`,
            totalCount: op.total,
            ...metadata
        });
        
        // Check error rate alerts
        if (this.enableAlerting && status === 'error') {
            const errorRate = op.error / op.total;
            if (errorRate > this.alertThresholds.errorRate) {
                this.alert('error_rate', `High error rate for ${operationName}: ${(errorRate * 100).toFixed(1)}%`, {
                    operationName,
                    errorRate,
                    threshold: this.alertThresholds.errorRate
                });
            }
        }
    }
    
    // Error tracking
    recordError(error, context = {}) {
        const errorKey = error.name || 'UnknownError';
        
        if (!this.metrics.errors[errorKey]) {
            this.metrics.errors[errorKey] = {
                count: 0,
                lastOccurrence: null,
                contexts: []
            };
        }
        
        const errorMetric = this.metrics.errors[errorKey];
        errorMetric.count++;
        errorMetric.lastOccurrence = new Date().toISOString();
        errorMetric.contexts.push({
            timestamp: new Date().toISOString(),
            message: error.message,
            stack: error.stack,
            context
        });
        
        // Keep only last 10 contexts
        if (errorMetric.contexts.length > 10) {
            errorMetric.contexts = errorMetric.contexts.slice(-10);
        }
        
        this.error(`Error occurred: ${error.message}`, {
            errorName: error.name,
            errorCount: errorMetric.count,
            stack: error.stack,
            context
        });
    }
    
    // Health monitoring
    startHealthMonitoring() {
        // Run health checks every 30 seconds
        setInterval(() => {
            this.runHealthChecks();
        }, 30000);
        
        // Initial health check
        setTimeout(() => this.runHealthChecks(), 1000);
    }
    
    registerHealthCheck(name, checkFunction) {
        this.healthChecks.set(name, checkFunction);
    }
    
    async runHealthChecks() {
        const results = {};
        
        try {
            // System health checks
            results.memory = await this.checkMemoryHealth();
            results.disk = await this.checkDiskHealth();
            results.process = await this.checkProcessHealth();
            
            // Custom health checks
            for (const [name, checkFn] of this.healthChecks) {
                try {
                    results[name] = await checkFn();
                } catch (error) {
                    results[name] = {
                        status: 'error',
                        message: error.message,
                        timestamp: new Date().toISOString()
                    };
                }
            }
            
            // Store health results
            this.metrics.health = {
                ...results,
                lastCheck: new Date().toISOString(),
                overallStatus: this.calculateOverallHealth(results)
            };
            
            this.lastHealthCheck = this.metrics.health;
            
            // Log health status
            this.log('debug', 'Health check completed', {
                overallStatus: this.metrics.health.overallStatus,
                checks: Object.keys(results).length
            });
            
            // Check for health alerts
            if (this.enableAlerting) {
                this.checkHealthAlerts(results);
            }
            
        } catch (error) {
            this.recordError(error, { context: 'health_monitoring' });
        }
    }
    
    async checkMemoryHealth() {
        const memUsage = process.memoryUsage();
        const totalMemory = os.totalmem();
        const freeMemory = os.freemem();
        const usedMemory = totalMemory - freeMemory;
        const memoryUtilization = usedMemory / totalMemory;
        
        return {
            status: memoryUtilization > 0.9 ? 'critical' : memoryUtilization > 0.8 ? 'warning' : 'healthy',
            utilization: memoryUtilization,
            process: memUsage,
            system: {
                total: totalMemory,
                used: usedMemory,
                free: freeMemory
            },
            timestamp: new Date().toISOString()
        };
    }
    
    async checkDiskHealth() {
        try {
            const stats = await fs.promises.statfs(this.projectPath);
            const total = stats.blocks * stats.bsize;
            const free = stats.bavail * stats.bsize;
            const used = total - free;
            const utilization = used / total;
            
            return {
                status: utilization > 0.95 ? 'critical' : utilization > 0.85 ? 'warning' : 'healthy',
                utilization,
                total,
                used,
                free,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                status: 'error',
                message: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
    
    async checkProcessHealth() {
        const uptime = process.uptime();
        const cpuUsage = process.cpuUsage();
        
        return {
            status: 'healthy',
            uptime,
            cpu: cpuUsage,
            pid: process.pid,
            version: process.version,
            platform: process.platform,
            timestamp: new Date().toISOString()
        };
    }
    
    calculateOverallHealth(results) {
        const statuses = Object.values(results).map(r => r.status);
        
        if (statuses.includes('critical')) return 'critical';
        if (statuses.includes('error')) return 'error';
        if (statuses.includes('warning')) return 'warning';
        return 'healthy';
    }
    
    checkHealthAlerts(results) {
        Object.entries(results).forEach(([check, result]) => {
            if (result.status === 'critical' || result.status === 'error') {
                this.alert('health', `Health check failed: ${check}`, {
                    check,
                    status: result.status,
                    message: result.message || 'Health check failed',
                    result
                });
            }
        });
    }
    
    // Alerting system
    alert(type, message, metadata = {}) {
        const alert = {
            id: this.generateAlertId(),
            type,
            message,
            metadata,
            timestamp: new Date().toISOString(),
            severity: this.getAlertSeverity(type, metadata)
        };
        
        // Log alert
        this.error(`ALERT [${type.toUpperCase()}]: ${message}`, metadata);
        
        // Write alert to file
        if (this.enableStructuredMetrics) {
            this.writeToFile('alerts.jsonl', alert);
        }
        
        // Could integrate with external alerting systems here
        this.processAlert(alert);
    }
    
    generateAlertId() {
        return `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
    getAlertSeverity(type, metadata) {
        switch (type) {
            case 'error_rate':
            case 'performance':
                return 'warning';
            case 'health':
                return metadata.status === 'critical' ? 'critical' : 'warning';
            default:
                return 'info';
        }
    }
    
    processAlert(alert) {
        // Placeholder for alert processing
        // Could send to external systems, Slack, email, etc.
        if (this.debug) {
            console.log(`🚨 Alert processed: ${alert.id}`);
        }
    }
    
    // File operations
    writeToFile(filename, data) {
        try {
            const filePath = path.join(this.projectPath, '.lsl', 'operational', filename);
            const logLine = JSON.stringify(data) + '\n';
            fs.appendFileSync(filePath, logLine, 'utf8');
        } catch (error) {
            // Avoid infinite loop by not using this.error here
            console.error('[Enhanced Operational Logger] File write error:', error.message);
        }
    }
    
    // Status and metrics
    getMetrics() {
        return {
            ...this.metrics,
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        };
    }
    
    getHealth() {
        return this.lastHealthCheck || { status: 'unknown', message: 'No health checks run yet' };
    }
    
    getStatus() {
        return {
            operational: true,
            health: this.getHealth(),
            metrics: this.getMetrics(),
            configuration: {
                enableStructuredMetrics: this.enableStructuredMetrics,
                enableHealthMonitoring: this.enableHealthMonitoring,
                enableAlerting: this.enableAlerting,
                logLevel: this.logLevel
            }
        };
    }
    
    // Cleanup
    async cleanup() {
        if (this.debug) {
            console.log('[Enhanced Operational Logger] Cleanup completed');
        }
    }
}

// Export for use in other modules
module.exports = EnhancedOperationalLogger;

// CLI usage when run directly
if (require.main === module) {
    const logger = new EnhancedOperationalLogger({
        debug: true,
        projectPath: process.cwd()
    });
    
    // Test functionality
    (async () => {
        console.log('🔧 Enhanced Operational Logger Test');
        console.log('===================================');
        
        // Test logging
        logger.info('Test info message', { test: true });
        logger.warn('Test warning message', { test: true });
        logger.error('Test error message', { test: true });
        
        // Test performance tracking
        const timer = logger.startTimer('test_operation');
        await new Promise(resolve => setTimeout(resolve, 100)); // Simulate work
        const duration = timer.end();
        
        console.log(`✅ Test operation completed in ${duration.toFixed(2)}ms`);
        
        // Test operation recording
        logger.recordOperation('test_operation', 'success', { testData: 'example' });
        
        // Test error recording
        try {
            throw new Error('Test error for demonstration');
        } catch (error) {
            logger.recordError(error, { context: 'test' });
        }
        
        // Show metrics
        const metrics = logger.getMetrics();
        console.log('\n📊 Current Metrics:');
        console.log('  Operations:', Object.keys(metrics.operations).length);
        console.log('  Performance metrics:', Object.keys(metrics.performance).length);
        console.log('  Errors tracked:', Object.keys(metrics.errors).length);
        
        // Show health
        const health = logger.getHealth();
        console.log('\n🏥 Health Status:');
        console.log('  Overall status:', health.overallStatus || 'unknown');
        console.log('  Last check:', health.lastCheck || 'never');
        
        // Show status
        const status = logger.getStatus();
        console.log('\n📈 Logger Status:');
        console.log('  Operational:', status.operational);
        console.log('  Structured metrics:', status.configuration.enableStructuredMetrics);
        console.log('  Health monitoring:', status.configuration.enableHealthMonitoring);
        console.log('  Alerting:', status.configuration.enableAlerting);
        
        // Cleanup
        await logger.cleanup();
        console.log('\n🧹 Cleanup completed');
        
    })().catch(console.error);
}