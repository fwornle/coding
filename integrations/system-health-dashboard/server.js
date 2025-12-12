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
import { spawn, execSync } from 'child_process';
import { runIfMain } from '../../lib/utils/esm-cli.js';
import { UKBProcessManager } from '../../scripts/ukb-process-manager.js';

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
        this.lastAutoVerifyTime = null; // Track last auto-triggered verification to rate limit

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
        this.app.get('/api/health-verifier/api-quota', this.handleGetAPIQuota.bind(this));
        this.app.post('/api/health-verifier/verify', this.handleTriggerVerification.bind(this));
        this.app.post('/api/health-verifier/restart-service', this.handleRestartService.bind(this));

        // UKB (Update Knowledge Base) process management endpoints
        this.app.get('/api/ukb/status', this.handleGetUKBStatus.bind(this));
        this.app.get('/api/ukb/processes', this.handleGetUKBProcesses.bind(this));
        this.app.post('/api/ukb/cleanup', this.handleUKBCleanup.bind(this));
        this.app.post('/api/ukb/start', this.handleStartUKBWorkflow.bind(this));

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
     * Auto-triggers verification when data is stale to ensure freshness
     */
    async handleGetHealthStatus(req, res) {
        try {
            const statusPath = join(codingRoot, '.health/verification-status.json');

            if (!existsSync(statusPath)) {
                // No status file - trigger verification and return pending state
                this.triggerBackgroundVerification();
                return res.json({
                    status: 'success',
                    data: {
                        status: 'offline',
                        message: 'Health verifier is not running - verification triggered',
                        ageMs: 0,
                        autoHealingActive: false
                    }
                });
            }

            const statusData = JSON.parse(readFileSync(statusPath, 'utf8'));
            const age = Date.now() - new Date(statusData.lastUpdate).getTime();

            // Check if data is stale (>2 minutes)
            if (age > 120000) {
                statusData.status = 'stale';
                statusData.ageMs = age;

                // Auto-trigger verification when stale (but rate limit to avoid spam)
                // Only trigger if we haven't triggered recently (within 30 seconds)
                if (!this.lastAutoVerifyTime || (Date.now() - this.lastAutoVerifyTime) > 30000) {
                    console.log('🔄 Data is stale, auto-triggering health verification...');
                    this.triggerBackgroundVerification();
                    this.lastAutoVerifyTime = Date.now();
                }
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
     * Trigger health verification in the background (non-blocking)
     */
    triggerBackgroundVerification() {
        const verifierScript = join(codingRoot, 'scripts/health-verifier.js');

        if (!existsSync(verifierScript)) {
            console.warn('⚠️ Health verifier script not found:', verifierScript);
            return;
        }

        try {
            const verifyProcess = spawn('node', [verifierScript, 'verify'], {
                cwd: codingRoot,
                detached: true,
                stdio: 'ignore'
            });
            verifyProcess.unref();
            console.log('✅ Background health verification started');
        } catch (error) {
            console.error('❌ Failed to trigger background verification:', error.message);
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
     * Get API quota status for all configured providers
     */
    async handleGetAPIQuota(req, res) {
        try {
            // Dynamically import the API quota checker (ESM)
            const apiQuotaChecker = await import('../../lib/api-quota-checker.js');

            // Load live-logging config for API settings
            const configPath = join(codingRoot, 'config/live-logging-config.json');
            let config = {};

            if (existsSync(configPath)) {
                config = JSON.parse(readFileSync(configPath, 'utf8'));
            }

            // Check all active providers
            const providers = await apiQuotaChecker.checkAllProviders(config, {
                useCache: true,
                timeout: 5000
            });

            res.json({
                status: 'success',
                data: {
                    providers,
                    lastUpdate: new Date().toISOString()
                }
            });
        } catch (error) {
            console.error('Failed to get API quota:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to retrieve API quota',
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

    /**
     * Restart a service based on its check name
     */
    async handleRestartService(req, res) {
        try {
            const { serviceName, action } = req.body;

            if (!serviceName) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Service name is required'
                });
            }

            console.log(`🔄 Restart request received for service: ${serviceName}, action: ${action}`);

            // Map service check names to restart commands
            const restartCommands = {
                vkb_server: `cd "${codingRoot}" && bin/vkb restart`,
                constraint_monitor: `cd "${codingRoot}/integrations/mcp-constraint-monitor" && npm run restart`,
                dashboard_server: `cd "${codingRoot}/integrations/system-health-dashboard" && npm run restart`,
            };

            const command = restartCommands[serviceName];

            if (!command) {
                return res.status(400).json({
                    status: 'error',
                    message: `Unknown service: ${serviceName}`,
                    availableServices: Object.keys(restartCommands)
                });
            }

            // Execute restart command in background (non-blocking)
            console.log(`📝 Executing restart command: ${command}`);
            const restartProcess = spawn('/bin/bash', ['-c', command], {
                cwd: codingRoot,
                detached: true,
                stdio: 'ignore'
            });
            restartProcess.unref();

            // Schedule health verification to run after service has time to start
            setTimeout(() => {
                const verifierScript = join(codingRoot, 'scripts/health-verifier.js');
                if (existsSync(verifierScript)) {
                    const verifyProcess = spawn('node', [verifierScript, 'verify'], {
                        cwd: codingRoot,
                        detached: true,
                        stdio: 'ignore'
                    });
                    verifyProcess.unref();
                }
            }, 2000);

            res.json({
                status: 'success',
                message: `Service restart initiated: ${serviceName}`,
                data: {
                    service: serviceName,
                    action: action || 'restart',
                    triggered_at: new Date().toISOString(),
                    note: 'Health verification will run automatically to confirm service status'
                }
            });
        } catch (error) {
            console.error('Failed to restart service:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to restart service',
                error: error.message,
                details: error.stack
            });
        }
    }

    /**
     * Get UKB process status summary
     */
    async handleGetUKBStatus(req, res) {
        try {
            const ukbManager = new UKBProcessManager();
            const summary = ukbManager.getStatusSummary();

            res.json({
                status: 'success',
                data: {
                    ...summary,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            console.error('Failed to get UKB status:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to retrieve UKB status',
                error: error.message
            });
        }
    }

    /**
     * Get detailed UKB process list with step-level information
     */
    async handleGetUKBProcesses(req, res) {
        try {
            const ukbManager = new UKBProcessManager();
            const detailedStatus = ukbManager.getDetailedStatus();

            // Enhance processes with step-level detail from workflow progress file
            const progressPath = join(codingRoot, '.data', 'workflow-progress.json');
            let workflowProgress = null;

            if (existsSync(progressPath)) {
                try {
                    workflowProgress = JSON.parse(readFileSync(progressPath, 'utf8'));
                } catch (e) {
                    // Ignore progress file read errors
                }
            }

            // If we have progress data and running processes, enrich the process data
            if (workflowProgress && detailedStatus.processes) {
                for (const proc of detailedStatus.processes) {
                    // Match progress to process based on workflow name
                    if (proc.status === 'running' && workflowProgress.workflowName === proc.workflowName) {
                        proc.completedSteps = workflowProgress.completedSteps || 0;
                        proc.totalSteps = workflowProgress.totalSteps || 0;
                        proc.currentStep = workflowProgress.currentStep;
                        proc.stepsCompleted = workflowProgress.stepsCompleted || [];
                        proc.stepsFailed = workflowProgress.stepsFailed || [];
                        proc.elapsedSeconds = workflowProgress.elapsedSeconds || 0;

                        // Build step info array for the graph visualization
                        proc.steps = this.buildStepInfo(workflowProgress);
                    }
                }
            }

            res.json({
                status: 'success',
                data: detailedStatus
            });
        } catch (error) {
            console.error('Failed to get UKB processes:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to retrieve UKB processes',
                error: error.message
            });
        }
    }

    /**
     * Build step info array from workflow progress for visualization
     */
    buildStepInfo(progress) {
        const steps = [];
        const completed = new Set(progress.stepsCompleted || []);
        const failed = new Set(progress.stepsFailed || []);

        // Add completed steps
        for (const stepName of completed) {
            steps.push({
                name: stepName,
                status: 'completed',
            });
        }

        // Add failed steps
        for (const stepName of failed) {
            steps.push({
                name: stepName,
                status: 'failed',
            });
        }

        // Add current step
        if (progress.currentStep && !completed.has(progress.currentStep) && !failed.has(progress.currentStep)) {
            steps.push({
                name: progress.currentStep,
                status: 'running',
            });
        }

        return steps;
    }

    /**
     * Cleanup stale/frozen UKB processes
     */
    async handleUKBCleanup(req, res) {
        try {
            const { dryRun = false } = req.body;
            const ukbManager = new UKBProcessManager();
            const cleaned = ukbManager.cleanupStaleProcesses(dryRun);

            res.json({
                status: 'success',
                data: {
                    dryRun,
                    cleaned,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            console.error('Failed to cleanup UKB processes:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to cleanup UKB processes',
                error: error.message
            });
        }
    }

    /**
     * Start a new UKB workflow
     */
    async handleStartUKBWorkflow(req, res) {
        try {
            const { workflowName = 'complete-analysis', team = 'coding', repositoryPath } = req.body;
            const repoPath = repositoryPath || codingRoot;

            const ukbManager = new UKBProcessManager();
            const result = await ukbManager.startWorkflow(workflowName, team, repoPath);

            res.json({
                status: 'success',
                data: result
            });
        } catch (error) {
            console.error('Failed to start UKB workflow:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to start UKB workflow',
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
runIfMain(import.meta.url, () => {
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
});

export { SystemHealthAPIServer };
