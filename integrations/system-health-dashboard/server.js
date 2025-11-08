#!/usr/bin/env node

/**
 * System Health Dashboard API Server
 * Provides health verification data to the dashboard frontend
 * Port: 3033 (configured in .env.ports)
 */

import express from 'express';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const codingRoot = process.env.CODING_REPO || join(__dirname, '../..');

/**
 * Load port configuration from centralized .env.ports file
 */
function loadPortConfiguration() {
    const portsFilePath = join(codingRoot, '.env.ports');
    const config = {
        dashboardPort: 3032,
        apiPort: 3033
    };

    try {
        const portsFileContent = readFileSync(portsFilePath, 'utf8');
        const lines = portsFileContent.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('SYSTEM_HEALTH_DASHBOARD_PORT=')) {
                config.dashboardPort = parseInt(trimmed.split('=')[1]) || 3032;
            } else if (trimmed.startsWith('SYSTEM_HEALTH_API_PORT=')) {
                config.apiPort = parseInt(trimmed.split('=')[1]) || 3033;
            }
        }

        console.log('✅ Loaded port configuration from .env.ports', config);
        return config;
    } catch (error) {
        console.warn('⚠️ Could not load centralized port configuration, using defaults', {
            error: error.message,
            portsFile: portsFilePath,
            defaultConfig: config
        });
        return config;
    }
}

class SystemHealthAPIServer {
    constructor(port = 3033, dashboardPort = 3032) {
        this.port = port;
        this.dashboardPort = dashboardPort;
        this.app = express();
        this.server = null;

        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        // Enable CORS for all origins
        this.app.use(cors());

        // Parse JSON bodies
        this.app.use(express.json());

        // Redirect root to dashboard
        this.app.get('/', (req, res) => {
            res.redirect(`http://localhost:${this.dashboardPort}`);
        });

        // Logging middleware
        this.app.use((req, res, next) => {
            console.log(`${req.method} ${req.path}`);
            next();
        });
    }

    setupRoutes() {
        // Health check endpoint
        this.app.get('/api/health', this.handleHealthCheck.bind(this));

        // System health verifier endpoints
        this.app.get('/api/health-verifier/status', this.handleGetHealthStatus.bind(this));
        this.app.get('/api/health-verifier/report', this.handleGetHealthReport.bind(this));
        this.app.post('/api/health-verifier/verify', this.handleTriggerVerification.bind(this));

        // Error handling
        this.app.use(this.handleError.bind(this));
    }

    /**
     * Basic health check
     */
    async handleHealthCheck(req, res) {
        res.json({
            status: 'success',
            service: 'system-health-api',
            port: this.port,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Get current health verifier status
     */
    async handleGetHealthStatus(req, res) {
        try {
            const statusPath = join(codingRoot, '.health/verification-status.json');

            if (!existsSync(statusPath)) {
                return res.json({
                    status: 'success',
                    data: {
                        status: 'offline',
                        message: 'Health verifier is not running'
                    }
                });
            }

            const statusData = JSON.parse(readFileSync(statusPath, 'utf8'));
            const age = Date.now() - new Date(statusData.lastUpdate).getTime();

            // Check if data is stale (>2 minutes)
            if (age > 120000) {
                statusData.status = 'stale';
                statusData.ageMs = age;
            } else {
                statusData.status = 'operational';
                statusData.ageMs = age;
            }

            res.json({
                status: 'success',
                data: statusData
            });
        } catch (error) {
            console.error('Failed to get health status:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to retrieve health status',
                error: error.message
            });
        }
    }

    /**
     * Get detailed health verification report
     */
    async handleGetHealthReport(req, res) {
        try {
            const reportPath = join(codingRoot, '.health/verification-report.json');

            if (!existsSync(reportPath)) {
                return res.json({
                    status: 'success',
                    data: {
                        message: 'No health report available',
                        checks: [],
                        violations: []
                    }
                });
            }

            const reportData = JSON.parse(readFileSync(reportPath, 'utf8'));

            res.json({
                status: 'success',
                data: reportData
            });
        } catch (error) {
            console.error('Failed to get health report:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to retrieve health report',
                error: error.message
            });
        }
    }

    /**
     * Trigger a health verification run
     */
    async handleTriggerVerification(req, res) {
        try {
            const verifierScript = join(codingRoot, 'scripts/health-verifier.js');

            if (!existsSync(verifierScript)) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Health verifier script not found'
                });
            }

            // Run verification in background
            execSync(`node "${verifierScript}" verify > /dev/null 2>&1 &`, {
                cwd: codingRoot,
                timeout: 1000
            });

            res.json({
                status: 'success',
                message: 'Health verification triggered',
                data: {
                    triggered_at: new Date().toISOString()
                }
            });
        } catch (error) {
            console.error('Failed to trigger verification:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to trigger health verification',
                error: error.message
            });
        }
    }

    handleError(err, req, res, next) {
        console.error('Unhandled error in System Health API server:', {
            error: err.message,
            stack: err.stack,
            url: req.url,
            method: req.method
        });

        res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    }

    async start() {
        return new Promise((resolve, reject) => {
            this.server = createServer(this.app);

            this.server.listen(this.port, (error) => {
                if (error) {
                    console.error('❌ Failed to start System Health API server', { error: error.message, port: this.port });
                    reject(error);
                } else {
                    console.log('✅ System Health API server started', {
                        port: this.port,
                        dashboardUrl: `http://localhost:${this.dashboardPort}`,
                        apiUrl: `http://localhost:${this.port}/api`
                    });
                    resolve();
                }
            });
        });
    }

    async stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    console.log('🛑 System Health API server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

// Start the server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const portConfig = loadPortConfiguration();
    const server = new SystemHealthAPIServer(portConfig.apiPort, portConfig.dashboardPort);

    server.start().catch(error => {
        console.error('Failed to start System Health API server:', error);
        process.exit(1);
    });

    // Handle shutdown signals
    const shutdown = (signal) => {
        console.log(`Received ${signal}, shutting down System Health API server...`);
        server.stop().then(() => {
            console.log('System Health API server shutdown complete');
            process.exit(0);
        });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

export { SystemHealthAPIServer };
