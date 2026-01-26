#!/usr/bin/env node

/**
 * System Health Dashboard API Server
 * Provides health verification data to the dashboard frontend
 * Port: 3033 (configured in .env.ports)
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, watch } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { spawn, execSync } from 'child_process';
import { parse as parseYaml } from 'yaml';
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
        this.lastValidWorkflowProgress = null; // Cache for last valid workflow progress (to avoid 0/0 race conditions)

        // WebSocket state for event-driven workflow updates
        this.wss = null; // WebSocket server instance
        this.wsClients = new Set(); // Connected WebSocket clients
        this.workflowEventBuffer = []; // Buffer for events before clients connect

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
        this.app.post('/api/ukb/cancel', this.handleCancelWorkflow.bind(this));
        this.app.post('/api/ukb/single-step-mode', this.handleSingleStepMode.bind(this));
        this.app.post('/api/ukb/step-advance', this.handleStepAdvance.bind(this));
        this.app.post('/api/ukb/mock-llm', this.handleMockLLM.bind(this));
        this.app.post('/api/ukb/start', this.handleStartUKBWorkflow.bind(this));
        this.app.get('/api/ukb/history', this.handleGetUKBHistory.bind(this));
        this.app.get('/api/ukb/history/:reportId', this.handleGetUKBHistoryDetail.bind(this));

        // SSE endpoint for real-time workflow state updates (LEGACY - kept for backward compatibility)
        this.app.get('/api/ukb/stream', this.handleUKBStream.bind(this));

        // Note: WebSocket endpoint /api/ukb/ws is handled via WebSocketServer upgrade (see start() method)

        // Workflow definitions endpoint (Single Source of Truth)
        this.app.get('/api/workflows/definitions', this.handleGetWorkflowDefinitions.bind(this));
        this.app.get('/api/workflows/definitions/:workflowName', this.handleGetWorkflowDefinition.bind(this));

        // Workflow timing statistics endpoint (for progress estimation)
        this.app.get('/api/workflows/statistics', this.handleGetWorkflowStatistics.bind(this));
        this.app.post('/api/workflows/statistics/update', this.handleUpdateWorkflowStatistics.bind(this));

        // Batch processing endpoints
        this.app.get('/api/batch/progress', this.handleGetBatchProgress.bind(this));
        this.app.get('/api/batch/history', this.handleGetBatchHistory.bind(this));
        this.app.get('/api/batch/dag', this.handleGetBatchDAG.bind(this));
        this.app.post('/api/batch/pause', this.handlePauseBatch.bind(this));
        this.app.post('/api/batch/resume', this.handleResumeBatch.bind(this));

        // Code Graph RAG cache endpoints
        this.app.get('/api/cgr/status', this.handleGetCGRStatus.bind(this));
        this.app.get('/api/cgr/progress', this.handleGetCGRProgress.bind(this));
        this.app.post('/api/cgr/reindex', this.handleCGRReindex.bind(this));

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
     * Check if the health-verifier daemon is alive via heartbeat file
     * Returns: { alive: boolean, staleMs: number, pid: number|null }
     */
    checkDaemonHeartbeat() {
        const heartbeatPath = join(codingRoot, '.health/verifier-heartbeat.json');

        try {
            if (!existsSync(heartbeatPath)) {
                return { alive: false, staleMs: Infinity, pid: null, reason: 'no heartbeat file' };
            }

            const heartbeat = JSON.parse(readFileSync(heartbeatPath, 'utf8'));
            const age = Date.now() - new Date(heartbeat.timestamp).getTime();

            // Check if process is still running
            let processAlive = false;
            if (heartbeat.pid) {
                try {
                    process.kill(heartbeat.pid, 0); // Signal 0 = check if process exists
                    processAlive = true;
                } catch (e) {
                    processAlive = false;
                }
            }

            // Daemon is alive if: process exists AND heartbeat is fresh (<60s)
            const isAlive = processAlive && age < 60000;

            return {
                alive: isAlive,
                staleMs: age,
                pid: heartbeat.pid,
                cycleCount: heartbeat.cycleCount,
                reason: !processAlive ? 'process dead' : (age >= 60000 ? 'heartbeat stale' : 'ok')
            };
        } catch (error) {
            return { alive: false, staleMs: Infinity, pid: null, reason: error.message };
        }
    }

    /**
     * Restart the health-verifier daemon
     */
    restartDaemon() {
        const verifierScript = join(codingRoot, 'scripts/health-verifier.js');

        if (!existsSync(verifierScript)) {
            console.warn('⚠️ Health verifier script not found:', verifierScript);
            return false;
        }

        console.log('🔄 Restarting health-verifier daemon...');

        try {
            // First try to stop any existing daemon
            execSync(`node "${verifierScript}" stop`, {
                cwd: codingRoot,
                timeout: 5000,
                stdio: 'ignore'
            });
        } catch (e) {
            // Ignore stop errors
        }

        try {
            // Start new daemon
            const daemonProcess = spawn('node', [verifierScript, 'start'], {
                cwd: codingRoot,
                detached: true,
                stdio: 'ignore'
            });
            daemonProcess.unref();
            console.log('✅ Health-verifier daemon restarted');
            return true;
        } catch (error) {
            console.error('❌ Failed to restart daemon:', error.message);
            return false;
        }
    }

    /**
     * Trigger health verification in the background (non-blocking)
     * Now includes watchdog: restarts daemon if heartbeat is stale
     */
    triggerBackgroundVerification() {
        const verifierScript = join(codingRoot, 'scripts/health-verifier.js');

        if (!existsSync(verifierScript)) {
            console.warn('⚠️ Health verifier script not found:', verifierScript);
            return;
        }

        // WATCHDOG: Check daemon heartbeat before triggering verification
        const heartbeatStatus = this.checkDaemonHeartbeat();

        if (!heartbeatStatus.alive) {
            console.log(`🚨 WATCHDOG: Daemon not healthy (${heartbeatStatus.reason}). Restarting...`);
            this.restartDaemon();
            return; // Daemon restart will run verification
        }

        // Daemon is alive, just trigger a one-time verification
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
            // Docker mode uses supervisorctl; native mode uses npm/bin commands
            const isDocker = existsSync('/.dockerenv');
            const restartCommands = isDocker ? {
                vkb_server: 'supervisorctl restart web-services:vkb-server',
                constraint_monitor: 'supervisorctl restart mcp-servers:constraint-monitor',
                dashboard_server: 'supervisorctl restart web-services:health-dashboard-frontend',
                health_dashboard_api: 'supervisorctl restart web-services:health-dashboard',
                health_dashboard_frontend: 'supervisorctl restart web-services:health-dashboard-frontend',
            } : {
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
     * Also checks workflow-progress.json for MCP-triggered workflows that run inline
     */
    async handleGetUKBStatus(req, res) {
        try {
            const ukbManager = new UKBProcessManager();
            const summary = ukbManager.getStatusSummary();

            // Also check workflow-progress.json for MCP-triggered inline workflows
            const progressPath = join(codingRoot, '.data', 'workflow-progress.json');
            let inlineWorkflowRunning = false;
            let inlineWorkflowStale = false;

            if (existsSync(progressPath)) {
                try {
                    const progress = JSON.parse(readFileSync(progressPath, 'utf8'));
                    if (progress.status === 'running') {
                        const lastUpdate = new Date(progress.lastUpdate).getTime();
                        const age = Date.now() - lastUpdate;
                        // Consider stale if no update in 2 minutes
                        if (age < 120000) {
                            inlineWorkflowRunning = true;
                        } else if (age < 300000) {
                            inlineWorkflowStale = true;
                        }
                    }
                } catch (e) {
                    // Ignore progress file read errors
                }
            }

            // Combine registered processes with inline workflow status
            const combinedSummary = {
                running: summary.running + (inlineWorkflowRunning ? 1 : 0),
                stale: summary.stale + (inlineWorkflowStale ? 1 : 0),
                frozen: summary.frozen,
                total: summary.total + (inlineWorkflowRunning || inlineWorkflowStale ? 1 : 0),
            };

            res.json({
                status: 'success',
                data: {
                    ...combinedSummary,
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
     * Includes both registered background processes AND inline MCP workflows
     */
    async handleGetUKBProcesses(req, res) {
        try {
            const ukbManager = new UKBProcessManager();
            const detailedStatus = ukbManager.getDetailedStatus();

            // Check workflow-progress.json for inline MCP-triggered workflows
            const progressPath = join(codingRoot, '.data', 'workflow-progress.json');
            let workflowProgress = null;

            if (existsSync(progressPath)) {
                try {
                    workflowProgress = JSON.parse(readFileSync(progressPath, 'utf8'));
                } catch (e) {
                    // Ignore progress file read errors
                }
            }

            // Check for active abort signal - if present, force cancelled status
            const abortPath = join(codingRoot, '.data', 'workflow-abort.json');
            let forceCancelled = false;
            if (existsSync(abortPath)) {
                try {
                    const abortSignal = JSON.parse(readFileSync(abortPath, 'utf8'));
                    if (abortSignal.abort) {
                        forceCancelled = true;
                        console.log('Active abort signal detected - forcing cancelled status');
                    }
                } catch {
                    // Ignore parse errors
                }
            }

            // Check if the workflow progress represents an inline workflow
            // that is NOT already in the registered processes list
            if (workflowProgress) {
                // ZOMBIE FIX: If abort signal exists, force cancelled status regardless of progress file
                if (forceCancelled) {
                    workflowProgress.status = 'cancelled';
                }

                const lastUpdate = new Date(workflowProgress.lastUpdate).getTime();
                const age = Date.now() - lastUpdate;
                const hasFailed = (workflowProgress.stepsFailed?.length || 0) > 0;

                // Check if this workflow is already represented in registered processes
                // Only consider ALIVE processes - dead/failed ones should not block detection
                const alreadyRegistered = detailedStatus.processes.some(
                    p => p.workflowName === workflowProgress.workflowName && p.pid !== 'mcp-inline' && p.isAlive
                );

                // Determine the actual status:
                // - If file says running but hasn't updated in 5+ minutes with failures, mark as failed
                // - If file says running but hasn't updated in 5+ minutes without failures, check completion
                let inferredStatus = workflowProgress.status;
                let health = 'healthy';

                if (workflowProgress.status === 'running') {
                    if (age > 300000) {
                        // Stale - hasn't updated in 5+ minutes
                        if (hasFailed) {
                            inferredStatus = 'failed';
                            health = 'dead';
                        } else if (workflowProgress.completedSteps >= workflowProgress.totalSteps) {
                            inferredStatus = 'completed';
                            health = 'dead';
                        } else {
                            health = 'frozen';
                        }
                    } else if (age > 120000) {
                        health = 'stale';
                    }
                }

                // FIXED: Only add workflows to active list if they are actually running
                // Terminal states (cancelled, completed, failed) should NOT appear in active list
                // They will appear in the History tab instead
                const isTerminalState = ['cancelled', 'completed', 'failed'].includes(inferredStatus);
                const isActiveState = inferredStatus === 'running' || inferredStatus === 'starting' || inferredStatus === 'cancelling';
                const isRelevant = !isTerminalState && (isActiveState || (age < 1800000 && !isTerminalState));

                if (isRelevant && !alreadyRegistered) {
                    // Compute totalSteps and completedSteps from stepsDetail if top-level fields are missing
                    // The workflow progress file stores step data in stepsDetail array, not as direct fields
                    let completedSteps = workflowProgress.completedSteps;
                    let totalSteps = workflowProgress.totalSteps;

                    if ((completedSteps === undefined || completedSteps === null || completedSteps === 0) &&
                        workflowProgress.stepsDetail && workflowProgress.stepsDetail.length > 0) {
                        totalSteps = workflowProgress.stepsDetail.length;
                        completedSteps = workflowProgress.stepsDetail.filter(s => s.status === 'completed').length;
                    }

                    completedSteps = completedSteps || 0;
                    totalSteps = totalSteps || 0;

                    // Check if we got invalid data (0/0 is not valid for a running workflow)
                    const isRaceCondition = totalSteps === 0 && inferredStatus === 'running';

                    if (isRaceCondition) {
                        // Use cached values from last valid read if available
                        if (this.lastValidWorkflowProgress &&
                            this.lastValidWorkflowProgress.workflowName === workflowProgress.workflowName &&
                            this.lastValidWorkflowProgress.totalSteps > 0) {
                            console.log('Using cached progress data (race condition detected - got 0/0 steps)');
                            completedSteps = this.lastValidWorkflowProgress.completedSteps;
                            totalSteps = this.lastValidWorkflowProgress.totalSteps;
                        } else {
                            console.warn('Race condition detected (0/0 steps) but no valid cache available');
                        }
                    } else if (totalSteps > 0) {
                        // Cache this valid progress for future race condition recovery
                        this.lastValidWorkflowProgress = {
                            workflowName: workflowProgress.workflowName,
                            completedSteps: completedSteps,
                            totalSteps: totalSteps,
                            timestamp: Date.now()
                        };
                    }

                    // Add a synthetic process entry for the inline MCP workflow
                    const inlineProcess = {
                        pid: 'mcp-inline',
                        workflowName: workflowProgress.workflowName,
                        team: workflowProgress.team || 'unknown',
                        repositoryPath: workflowProgress.repositoryPath || codingRoot,
                        startTime: workflowProgress.startTime,
                        lastHeartbeat: workflowProgress.lastUpdate,
                        status: inferredStatus,
                        completedSteps: completedSteps,
                        totalSteps: totalSteps,
                        currentStep: workflowProgress.currentStep,
                        stepsCompleted: workflowProgress.stepsCompleted || [],
                        stepsFailed: workflowProgress.stepsFailed || [],
                        elapsedSeconds: workflowProgress.elapsedSeconds || Math.round((Date.now() - new Date(workflowProgress.startTime).getTime()) / 1000),
                        logFile: null,
                        isAlive: inferredStatus === 'running',
                        health: health,
                        heartbeatAgeSeconds: Math.round(age / 1000),
                        progressPercent: totalSteps > 0
                            ? Math.round((completedSteps / totalSteps) * 100)
                            : 0,
                        steps: this.buildStepInfo(workflowProgress),
                        isInlineMCP: true, // Flag to indicate this is an inline MCP workflow
                        batchProgress: workflowProgress.batchProgress || null, // Batch progress for batch workflows
                        batchIterations: workflowProgress.batchIterations || null, // Per-batch step tracking for tracer
                        // Single-step debugging mode state
                        // CRITICAL: Preserve actual values - don't default to false as this causes UI sync issues
                        // The UI will handle undefined values appropriately
                        singleStepMode: workflowProgress.singleStepMode === true,  // Explicit boolean, false if undefined
                        stepPaused: workflowProgress.stepPaused === true,          // Explicit boolean
                        pausedAtStep: workflowProgress.pausedAtStep || null,
                        // LLM Mock mode for frontend testing
                        mockLLM: workflowProgress.mockLLM === true,
                        mockLLMDelay: workflowProgress.mockLLMDelay || 500,
                        // Batch phase step count (derived from workflow YAML)
                        batchPhaseStepCount: workflowProgress.batchPhaseStepCount || null,
                    };

                    detailedStatus.processes.push(inlineProcess);

                    // Update summary counts based on inferred status
                    if (inferredStatus === 'running' && health === 'healthy') {
                        detailedStatus.summary.running++;
                        detailedStatus.summary.total++;
                    } else if (inferredStatus === 'running' && health === 'stale') {
                        detailedStatus.summary.stale++;
                        detailedStatus.summary.total++;
                    } else if (health === 'frozen') {
                        detailedStatus.summary.frozen++;
                        detailedStatus.summary.total++;
                    }
                    // Don't count completed/failed in running totals
                }
            }

            // Enhance any other running registered processes with progress data
            if (workflowProgress && detailedStatus.processes) {
                for (const proc of detailedStatus.processes) {
                    if (proc.isInlineMCP) continue; // Skip inline processes, already enriched

                    // Match progress to process based on workflow name
                    if (proc.status === 'running' && workflowProgress.workflowName === proc.workflowName) {
                        proc.completedSteps = workflowProgress.completedSteps || 0;
                        proc.totalSteps = workflowProgress.totalSteps || 0;
                        proc.currentStep = workflowProgress.currentStep;
                        proc.stepsCompleted = workflowProgress.stepsCompleted || [];
                        proc.stepsFailed = workflowProgress.stepsFailed || [];
                        proc.elapsedSeconds = workflowProgress.elapsedSeconds || 0;
                        proc.batchProgress = workflowProgress.batchProgress || null;
                        proc.batchIterations = workflowProgress.batchIterations || null;

                        // Build step info array for the graph visualization
                        proc.steps = this.buildStepInfo(workflowProgress);
                    }
                }
            }

            // Add a unique refresh key to each process to force React re-renders
            // This ensures the UI updates even when the step data content is the same
            const timestamp = Date.now();
            if (detailedStatus.processes) {
                for (const proc of detailedStatus.processes) {
                    proc._refreshKey = `${proc.pid}-${timestamp}`;
                }
            }
            detailedStatus._lastRefresh = timestamp;

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
     * SSE endpoint for real-time workflow state updates
     * Uses file system watching to push updates immediately when workflow state changes
     */
    handleUKBStream(req, res) {
        // Set up SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
        res.flushHeaders();

        const progressPath = join(codingRoot, '.data', 'workflow-progress.json');
        let lastContent = '';
        let watcher = null;
        let debounceTimer = null;

        // Send initial state
        const sendUpdate = () => {
            try {
                if (existsSync(progressPath)) {
                    const content = readFileSync(progressPath, 'utf8');
                    // Only send if content changed
                    if (content !== lastContent) {
                        lastContent = content;
                        const progress = JSON.parse(content);
                        console.log(`[SSE-TX] ${new Date().toISOString().slice(11,23)} step=${progress.currentStep} details=${progress.stepsDetail?.length || 0}`);
                        res.write(`data: ${JSON.stringify(progress)}\n\n`);
                    }
                } else {
                    // No workflow running
                    if (lastContent !== 'null') {
                        lastContent = 'null';
                        res.write(`data: null\n\n`);
                    }
                }
            } catch (error) {
                // Ignore read errors during rapid updates
            }
        };

        // Send initial state immediately
        sendUpdate();

        // Use fast polling (100ms) instead of fs.watch which is unreliable on macOS
        // This provides responsive real-time updates for workflow visualization
        const pollInterval = setInterval(sendUpdate, 100);

        // Send heartbeat every 15 seconds to keep connection alive
        const heartbeat = setInterval(() => {
            try {
                res.write(': heartbeat\n\n');
            } catch {
                // Connection closed
            }
        }, 15000);

        // Cleanup on connection close
        req.on('close', () => {
            clearInterval(pollInterval);
            clearInterval(heartbeat);
        });
    }

    /**
     * Build step info array from workflow progress for visualization
     * Uses stepsDetail if available (new format with timing), falls back to basic info
     * Now includes ALL known workflow steps with their actual status
     */
    buildStepInfo(progress) {
        // If we have detailed step info, use it directly
        if (progress.stepsDetail && Array.isArray(progress.stepsDetail)) {
            return progress.stepsDetail;
        }

        // Known workflow steps in order (for complete-analysis workflow)
        const KNOWN_STEPS = [
            'analyze_git_history',
            'analyze_vibe_history',
            'semantic_analysis',
            'web_search',
            'generate_insights',
            'generate_observations',
            'classify_with_ontology',
            'index_codebase',
            'link_documentation',
            'transform_code_entities',
            'quality_assurance',
            'persist_results',
            'deduplicate_insights',
            'validate_content',
        ];

        const completed = new Set(progress.stepsCompleted || []);
        const failed = new Set(progress.stepsFailed || []);
        const currentStep = progress.currentStep;

        // Build a map of step outputs from batchIterations (for batch workflows)
        const stepOutputsMap = {};
        if (progress.batchIterations && Array.isArray(progress.batchIterations)) {
            // Search through all batches to collect step outputs
            for (const batch of progress.batchIterations) {
                for (const step of batch.steps || []) {
                    if (step.outputs && Object.keys(step.outputs).length > 0) {
                        // Keep the most recent outputs for each step
                        stepOutputsMap[step.name] = {
                            outputs: step.outputs,
                            duration: step.duration,
                            tokensUsed: step.tokensUsed,
                            llmProvider: step.llmProvider,
                            llmCalls: step.llmCalls
                        };
                    }
                }
            }
        }

        // Build steps array with status for all known steps
        const steps = [];
        let reachedCurrent = false;

        for (const stepName of KNOWN_STEPS) {
            let status = 'pending';

            if (completed.has(stepName)) {
                status = 'completed';
            } else if (failed.has(stepName)) {
                status = 'failed';
            } else if (currentStep === stepName) {
                status = 'running';
                reachedCurrent = true;
            } else if (!reachedCurrent && !currentStep) {
                // If no current step set but workflow is still running,
                // infer which step should be running based on completed count
                const completedCount = completed.size;
                const stepIndex = KNOWN_STEPS.indexOf(stepName);

                // The step immediately after all completed steps should be running
                // (unless workflow is finished or failed)
                if (stepIndex === completedCount && progress.status === 'running') {
                    status = 'running';
                    reachedCurrent = true;
                }
            }

            // Include outputs from batchIterations if available
            const stepData = { name: stepName, status };
            if (stepOutputsMap[stepName]) {
                Object.assign(stepData, stepOutputsMap[stepName]);
            }
            steps.push(stepData);
        }

        // Also add any steps from completed/failed that aren't in KNOWN_STEPS
        for (const stepName of completed) {
            if (!KNOWN_STEPS.includes(stepName)) {
                steps.push({ name: stepName, status: 'completed' });
            }
        }
        for (const stepName of failed) {
            if (!KNOWN_STEPS.includes(stepName)) {
                steps.push({ name: stepName, status: 'failed' });
            }
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
     * Cancel/kill a running or frozen workflow
     * Writes abort signal file AND resets workflow-progress.json
     * For MCP-inline workflows, uses abort signal file (no PID to kill)
     */
    async handleCancelWorkflow(req, res) {
        try {
            const { killProcesses = false } = req.body;
            const progressPath = join(codingRoot, '.data', 'workflow-progress.json');
            const abortPath = join(codingRoot, '.data', 'workflow-abort.json');

            let previousState = null;
            let killedProcesses = [];
            let killedWorkflowPid = null;
            let usedAbortSignal = false;

            // Read current state before resetting
            if (existsSync(progressPath)) {
                try {
                    previousState = JSON.parse(readFileSync(progressPath, 'utf8'));
                } catch (e) {
                    // Ignore parse errors
                }
            }

            // CRITICAL: Write abort signal file FIRST
            // This is checked by the coordinator before every progress write
            // Works for BOTH MCP-inline workflows and external processes
            if (previousState?.executionId || previousState?.workflowId) {
                const abortSignal = {
                    abort: true,
                    workflowId: previousState.executionId || previousState.workflowId,
                    workflowName: previousState.workflowName,
                    timestamp: new Date().toISOString(),
                    reason: 'User cancelled via dashboard'
                };
                writeFileSync(abortPath, JSON.stringify(abortSignal, null, 2));
                usedAbortSignal = true;
                console.log(`🛑 Wrote abort signal for workflow: ${abortSignal.workflowId}`);
            }

            // For numeric PIDs (non-MCP-inline), also try to kill the process
            if (killProcesses && previousState?.pid && typeof previousState.pid === 'number') {
                try {
                    const pid = previousState.pid;
                    // Check if process is still running
                    try {
                        process.kill(pid, 0); // Signal 0 = check if process exists
                        // Process exists, kill it with SIGTERM first
                        console.log(`🛑 Sending SIGTERM to workflow process PID ${pid}`);
                        process.kill(pid, 'SIGTERM');
                        killedWorkflowPid = pid;

                        // Give process time to terminate gracefully
                        await new Promise(resolve => setTimeout(resolve, 1000));

                        // Check if process is still running - if so, force kill with SIGKILL
                        try {
                            process.kill(pid, 0); // Check if still exists
                            console.log(`🛑 Process ${pid} still alive after SIGTERM, sending SIGKILL`);
                            process.kill(pid, 'SIGKILL');
                            await new Promise(resolve => setTimeout(resolve, 500));
                        } catch (checkErr) {
                            // Process terminated after SIGTERM - good
                            console.log(`✅ Process ${pid} terminated after SIGTERM`);
                        }
                    } catch (e) {
                        if (e.code !== 'ESRCH') {
                            // ESRCH = process doesn't exist, which is fine
                            console.warn(`Warning killing PID ${pid}: ${e.message}`);
                        }
                    }
                } catch (e) {
                    console.error(`Failed to kill workflow process: ${e.message}`);
                }
            }

            // Reset workflow progress to a CLEAN cancelled state
            // CRITICAL: All identifying fields must be cleared to prevent zombie detection
            const resetState = {
                status: 'cancelled',
                workflowName: previousState?.workflowName || null,
                workflowId: null, // Clear to prevent ghost detection
                executionId: null, // Clear to prevent ghost detection
                pid: null, // Clear to prevent process lookups
                previousStatus: previousState?.status || 'unknown',
                cancelledAt: new Date().toISOString(),
                stepsDetail: [],
                startTime: null, // Clear to prevent "Connecting..." state
                lastUpdate: new Date().toISOString(),
                // Keep some diagnostic info for history
                _cancelledWorkflowId: previousState?.executionId || previousState?.workflowId || null,
                _cancelledWorkflowName: previousState?.workflowName || null
            };

            writeFileSync(progressPath, JSON.stringify(resetState, null, 2));

            // Clear the cached valid workflow progress to prevent stale data
            this.lastValidWorkflowProgress = null;

            // Also cleanup any orphaned/stale processes
            if (killProcesses) {
                const ukbManager = new UKBProcessManager();
                killedProcesses = ukbManager.cleanupStaleProcesses(false);
            }

            // Clean up abort signal file after a longer delay (ensure coordinator sees it)
            // Extended to 15s to handle slow step completions
            setTimeout(() => {
                try {
                    if (existsSync(abortPath)) {
                        unlinkSync(abortPath);
                        console.log('🧹 Cleaned up abort signal file after cancellation');
                    }
                } catch (e) {
                    console.warn('Failed to cleanup abort signal file:', e.message);
                }
            }, 15000);

            console.log(`🛑 Workflow cancelled: ${previousState?.workflowName || 'unknown'} (was: ${previousState?.status || 'unknown'})${usedAbortSignal ? ' [abort signal sent]' : ''}`);

            res.json({
                status: 'success',
                data: {
                    cancelled: true,
                    previousWorkflow: previousState?.workflowName || null,
                    previousStatus: previousState?.status || 'unknown',
                    completedSteps: previousState?.completedSteps || 0,
                    totalSteps: previousState?.totalSteps || 0,
                    killedWorkflowPid,
                    killedStaleProcesses: killedProcesses.length,
                    usedAbortSignal,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            console.error('Failed to cancel workflow:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to cancel workflow',
                error: error.message
            });
        }
    }

    /**
     * Enable/disable single-step debugging mode for workflow execution
     * When enabled, workflow pauses after each step and waits for step-advance signal
     */
    async handleSingleStepMode(req, res) {
        try {
            const { enabled } = req.body;
            const progressPath = join(codingRoot, '.data', 'workflow-progress.json');

            // Read current progress (or create empty state)
            let progress = {};
            if (existsSync(progressPath)) {
                try {
                    progress = JSON.parse(readFileSync(progressPath, 'utf8'));
                } catch (e) {
                    // Start fresh
                }
            }

            // Update single-step mode state
            progress.singleStepMode = !!enabled;
            progress.singleStepUpdatedAt = new Date().toISOString();

            // If disabling, also clear any pause state
            if (!enabled) {
                progress.stepPaused = false;
                progress.pausedAtStep = null;
            }

            writeFileSync(progressPath, JSON.stringify(progress, null, 2));

            console.log(`🔧 Single-step mode ${enabled ? 'enabled' : 'disabled'}`);

            res.json({
                status: 'success',
                data: {
                    singleStepMode: progress.singleStepMode,
                    timestamp: progress.singleStepUpdatedAt
                }
            });
        } catch (error) {
            console.error('Failed to set single-step mode:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to set single-step mode',
                error: error.message
            });
        }
    }

    /**
     * Advance to next step when in single-step mode
     * Clears the stepPaused flag to allow workflow to continue to next step
     */
    async handleStepAdvance(req, res) {
        try {
            const progressPath = join(codingRoot, '.data', 'workflow-progress.json');

            if (!existsSync(progressPath)) {
                return res.status(404).json({
                    status: 'error',
                    message: 'No workflow in progress'
                });
            }

            const progress = JSON.parse(readFileSync(progressPath, 'utf8'));

            if (!progress.singleStepMode) {
                return res.json({
                    status: 'success',
                    message: 'Single-step mode not enabled, nothing to advance',
                    data: { singleStepMode: false }
                });
            }

            if (!progress.stepPaused) {
                return res.json({
                    status: 'success',
                    message: 'Not currently paused',
                    data: { stepPaused: false, singleStepMode: true }
                });
            }

            // Clear pause flag to allow advancement
            const previousStep = progress.pausedAtStep;
            progress.stepPaused = false;
            progress.resumeRequestedAt = new Date().toISOString();
            // Handle step-into substeps mode
            // "Into" button: Set stepIntoSubsteps=true to pause at each sub-step
            // "Step" button: Set stepIntoSubsteps=false to skip sub-steps and go to next main step
            if (req.body && req.body.stepInto === true) {
                progress.stepIntoSubsteps = true;
            } else if (req.body && req.body.stepInto === false) {
                progress.stepIntoSubsteps = false;
            }
            // Keep pausedAtStep for reference until next step starts

            writeFileSync(progressPath, JSON.stringify(progress, null, 2));

            console.log(`▶️ Step advance requested (was paused at: ${previousStep})`);

            res.json({
                status: 'success',
                data: {
                    advanced: true,
                    previousStep,
                    timestamp: progress.resumeRequestedAt
                }
            });
        } catch (error) {
            console.error('Failed to advance step:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to advance step',
                error: error.message
            });
        }
    }

    /**
     * Enable/disable LLM mock mode for workflow execution
     * When enabled, all LLM calls return plausible mock data instead of making real API calls
     * Useful for testing frontend logic without incurring API costs
     */
    async handleMockLLM(req, res) {
        try {
            const { enabled, delay } = req.body;
            const progressPath = join(codingRoot, '.data', 'workflow-progress.json');

            // Read current progress (or create empty state)
            let progress = {};
            if (existsSync(progressPath)) {
                try {
                    progress = JSON.parse(readFileSync(progressPath, 'utf8'));
                } catch (e) {
                    // Start fresh
                }
            }

            // Update mock LLM mode state
            progress.mockLLM = !!enabled;
            progress.mockLLMUpdatedAt = new Date().toISOString();

            // Optional: custom delay for mock responses (default 500ms)
            if (delay !== undefined && typeof delay === 'number') {
                progress.mockLLMDelay = Math.max(0, Math.min(5000, delay)); // Clamp between 0-5000ms
            }

            writeFileSync(progressPath, JSON.stringify(progress, null, 2));

            console.log(`🔧 LLM Mock mode ${enabled ? 'enabled' : 'disabled'}${delay ? ` (delay: ${delay}ms)` : ''}`);

            res.json({
                status: 'success',
                data: {
                    mockLLM: progress.mockLLM,
                    mockLLMDelay: progress.mockLLMDelay || 500,
                    timestamp: progress.mockLLMUpdatedAt
                }
            });
        } catch (error) {
            console.error('Failed to set LLM mock mode:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to set LLM mock mode',
                error: error.message
            });
        }
    }

    /**
     * Start a new UKB workflow
     */
    async handleStartUKBWorkflow(req, res) {
        try {
            const {
                workflowName = 'complete-analysis',
                team = 'coding',
                repositoryPath,
                // Debug/testing options
                singleStepMode = false,
                mockLLM = false,
                mockLLMDelay = 500,
                maxBatches
            } = req.body;
            const repoPath = repositoryPath || codingRoot;

            // Clean up any stale abort signal from previous cancelled workflow
            const abortPath = join(codingRoot, '.data', 'workflow-abort.json');
            if (existsSync(abortPath)) {
                try {
                    unlinkSync(abortPath);
                    console.log('🧹 Cleaned up stale abort signal file');
                } catch (e) {
                    console.warn('Failed to cleanup abort file:', e.message);
                }
            }

            // Initialize progress file with debug/test settings BEFORE starting workflow
            // This ensures the coordinator sees these settings from the very first step
            const progressPath = join(codingRoot, '.data', 'workflow-progress.json');
            const initialProgress = {
                status: 'starting',
                workflowName,
                team,
                repositoryPath: repoPath,
                // Debug/testing settings must be set BEFORE workflow starts
                singleStepMode: !!singleStepMode,
                mockLLM: !!mockLLM,
                mockLLMDelay: mockLLMDelay || 500,
                startTime: new Date().toISOString(),
                lastUpdate: new Date().toISOString()
            };
            writeFileSync(progressPath, JSON.stringify(initialProgress, null, 2));
            console.log(`🎬 Initialized progress file with singleStepMode=${singleStepMode}, mockLLM=${mockLLM}`);

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

    /**
     * Get list of known project paths that may contain workflow reports
     * Scans the Agentic directory for projects with .data/workflow-reports
     */
    getKnownProjectPaths() {
        const agenticRoot = join(codingRoot, '..');
        const projectPaths = [codingRoot]; // Always include coding

        try {
            const entries = readdirSync(agenticRoot, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name !== 'coding') {
                    const projectPath = join(agenticRoot, entry.name);
                    const reportsDir = join(projectPath, '.data', 'workflow-reports');
                    if (existsSync(reportsDir)) {
                        projectPaths.push(projectPath);
                    }
                }
            }
        } catch (error) {
            console.warn('Failed to scan for project paths:', error.message);
        }

        return projectPaths;
    }

    /**
     * Get list of historical UKB workflow reports
     * Aggregates reports from ALL known projects, not just coding
     */
    handleGetUKBHistory(req, res) {
        try {
            const allReports = [];
            const projectPaths = this.getKnownProjectPaths();

            for (const projectPath of projectPaths) {
                const reportsDir = join(projectPath, '.data', 'workflow-reports');
                const projectName = projectPath.split('/').pop();

                if (!existsSync(reportsDir)) continue;

                const files = readdirSync(reportsDir)
                    .filter(f => f.endsWith('.md'));

                for (const filename of files) {
                    try {
                        const filePath = join(reportsDir, filename);
                        const content = readFileSync(filePath, 'utf8');

                        // Parse basic metadata from markdown
                        const workflowMatch = content.match(/\*\*Workflow:\*\*\s*(.+)/);
                        const executionIdMatch = content.match(/\*\*Execution ID:\*\*\s*(.+)/);
                        const statusMatch = content.match(/\*\*Status:\*\*\s*.*?(COMPLETED|FAILED|RUNNING)/i);
                        const startTimeMatch = content.match(/\*\*Start Time:\*\*\s*(.+)/);
                        const endTimeMatch = content.match(/\*\*End Time:\*\*\s*(.+)/);
                        const durationMatch = content.match(/\*\*Duration:\*\*\s*(.+)/);
                        const stepsMatch = content.match(/Steps Completed \| (\d+)\/(\d+)/);
                        const teamMatch = content.match(/"team":\s*"([^"]+)"/);
                        const repoMatch = content.match(/"repositoryPath":\s*"([^"]+)"/);

                        allReports.push({
                            id: filename.replace('.md', ''),
                            filename,
                            project: projectName, // Add source project for clarity
                            workflowName: workflowMatch?.[1]?.trim() || 'unknown',
                            executionId: executionIdMatch?.[1]?.trim() || filename.replace('.md', ''),
                            status: statusMatch?.[1]?.toLowerCase() || 'unknown',
                            startTime: startTimeMatch?.[1]?.trim() || null,
                            endTime: endTimeMatch?.[1]?.trim() || null,
                            duration: durationMatch?.[1]?.trim() || null,
                            completedSteps: stepsMatch ? parseInt(stepsMatch[1]) : 0,
                            totalSteps: stepsMatch ? parseInt(stepsMatch[2]) : 0,
                            team: teamMatch?.[1] || projectName,
                            repositoryPath: repoMatch?.[1] || projectPath
                        });
                    } catch (parseError) {
                        console.warn(`Failed to parse report ${filename}:`, parseError.message);
                    }
                }
            }

            // Sort all reports by timestamp (newest first), ignoring workflow type
            // Filename format: {workflow-type}-{timestamp}.md
            // Extract timestamp for sorting: 2025-12-12T08-06-36-145Z
            allReports.sort((a, b) => {
                const extractTimestamp = (filename) => {
                    const match = filename.match(/(\d{4}-\d{2}-\d{2}T[\d-]+Z)/);
                    return match ? match[1] : '';
                };
                return extractTimestamp(b.filename).localeCompare(extractTimestamp(a.filename));
            });

            // Optional filtering
            const { limit = 50, team, status, workflowName, project } = req.query;
            let filteredReports = allReports;

            if (team) {
                filteredReports = filteredReports.filter(r => r.team === team);
            }
            if (status) {
                filteredReports = filteredReports.filter(r => r.status === status.toLowerCase());
            }
            if (workflowName) {
                filteredReports = filteredReports.filter(r => r.workflowName === workflowName);
            }
            if (project) {
                filteredReports = filteredReports.filter(r => r.project === project);
            }

            res.json({
                status: 'success',
                data: filteredReports.slice(0, parseInt(limit)),
                total: filteredReports.length,
                projectsScanned: projectPaths.map(p => p.split('/').pop())
            });
        } catch (error) {
            console.error('Failed to get UKB history:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to get UKB history',
                error: error.message
            });
        }
    }

    /**
     * Get detailed UKB workflow report by ID
     * Searches across all known project paths
     */
    handleGetUKBHistoryDetail(req, res) {
        try {
            const { reportId } = req.params;
            const projectPaths = this.getKnownProjectPaths();

            // Find the report file across all project paths
            let filePath = null;
            let projectName = null;

            // First try exact filename match
            for (const projectPath of projectPaths) {
                const candidatePath = join(projectPath, '.data', 'workflow-reports', `${reportId}.md`);
                if (existsSync(candidatePath)) {
                    filePath = candidatePath;
                    projectName = projectPath.split('/').pop();
                    break;
                }
            }

            // If not found by filename, search by execution ID inside report files
            if (!filePath) {
                for (const projectPath of projectPaths) {
                    const reportsDir = join(projectPath, '.data', 'workflow-reports');
                    if (!existsSync(reportsDir)) continue;

                    const files = readdirSync(reportsDir).filter(f => f.endsWith('.md'));
                    for (const file of files) {
                        const candidatePath = join(reportsDir, file);
                        try {
                            const content = readFileSync(candidatePath, 'utf8');
                            // Check if this report's execution ID matches
                            const executionIdMatch = content.match(/\*\*Execution ID:\*\*\s*(.+)/);
                            if (executionIdMatch && executionIdMatch[1].trim() === reportId) {
                                filePath = candidatePath;
                                projectName = projectPath.split('/').pop();
                                break;
                            }
                        } catch (e) {
                            // Skip unreadable files
                        }
                    }
                    if (filePath) break;
                }
            }

            if (!filePath) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Report not found',
                    projectsSearched: projectPaths.map(p => p.split('/').pop())
                });
            }

            const content = readFileSync(filePath, 'utf8');

            // Parse full report details
            const workflowMatch = content.match(/\*\*Workflow:\*\*\s*(.+)/);
            const executionIdMatch = content.match(/\*\*Execution ID:\*\*\s*(.+)/);
            const statusMatch = content.match(/\*\*Status:\*\*\s*.*?(COMPLETED|FAILED|RUNNING)/i);
            const startTimeMatch = content.match(/\*\*Start Time:\*\*\s*(.+)/);
            const endTimeMatch = content.match(/\*\*End Time:\*\*\s*(.+)/);
            const durationMatch = content.match(/\*\*Duration:\*\*\s*(.+)/);
            const stepsMatch = content.match(/Steps Completed \| (\d+)\/(\d+)/);
            const entitiesCreatedMatch = content.match(/Entities Created \| (\d+)/);
            const entitiesUpdatedMatch = content.match(/Entities Updated \| (\d+)/);
            const teamMatch = content.match(/"team":\s*"([^"]+)"/);
            const repoMatch = content.match(/"repositoryPath":\s*"([^"]+)"/);

            // Parse recommendations
            const recommendationsSection = content.match(/## Recommendations\n\n([\s\S]*?)(?=\n## |$)/);
            const recommendations = recommendationsSection?.[1]
                ?.split('\n')
                .filter(line => line.match(/^\d+\./))
                .map(line => line.replace(/^\d+\.\s*/, '').trim()) || [];

            // Parse step details - split content by step sections
            const stepSections = content.split(/(?=### \d+\. )/);
            const steps = [];

            for (const section of stepSections) {
                const headerMatch = section.match(/### (\d+)\. (\w+)\n\n\*\*Agent:\*\*\s*(\w+)\n\*\*Action:\*\*\s*(\w+)\n\*\*Status:\*\*\s*.*?(success|failed|skipped)\n\*\*Duration:\*\*\s*(.+)/i);
                if (headerMatch) {
                    // Extract errors if present
                    const errorsMatch = section.match(/#### Errors\n\n([\s\S]*?)(?=\n---|\n###|$)/);
                    const errors = errorsMatch?.[1]
                        ?.split('\n')
                        .filter(line => line.startsWith('- '))
                        .map(line => line.replace(/^- /, '').trim()) || [];

                    // Extract outputs JSON if present
                    const outputsMatch = section.match(/#### Outputs\n\n```json\n([\s\S]*?)\n```/);
                    let outputs = null;
                    if (outputsMatch?.[1]) {
                        try {
                            outputs = JSON.parse(outputsMatch[1]);
                        } catch (e) {
                            // Invalid JSON, skip outputs
                        }
                    }

                    steps.push({
                        index: parseInt(headerMatch[1]),
                        name: headerMatch[2],
                        agent: headerMatch[3],
                        action: headerMatch[4],
                        status: headerMatch[5].toLowerCase(),
                        duration: headerMatch[6],
                        errors: errors.length > 0 ? errors : undefined,
                        outputs: outputs
                    });
                }
            }

            // Load batch checkpoints for accumulated totals
            const projectDir = dirname(dirname(filePath)); // Go from workflow-reports to .data to project
            const checkpointsPath = join(projectDir, 'batch-checkpoints.json');
            let accumulatedStats = null;
            let batchSummary = null;
            let persistedKnowledge = null;

            if (existsSync(checkpointsPath)) {
                try {
                    const checkpointsData = JSON.parse(readFileSync(checkpointsPath, 'utf8'));
                    accumulatedStats = checkpointsData.accumulatedStats || null;

                    // Build batch summary - aggregate stats per agent across all batches
                    if (checkpointsData.completedBatches?.length > 0) {
                        const batches = checkpointsData.completedBatches;
                        batchSummary = {
                            totalBatches: batches.length,
                            totalCommits: batches.reduce((sum, b) => sum + (b.stats?.commits || 0), 0),
                            totalSessions: batches.reduce((sum, b) => sum + (b.stats?.sessions || 0), 0),
                            totalEntities: batches.reduce((sum, b) => sum + (b.stats?.entitiesCreated || 0), 0),
                            totalRelations: batches.reduce((sum, b) => sum + (b.stats?.relationsAdded || 0), 0),
                            batchesWithSessions: batches.filter(b => (b.stats?.sessions || 0) > 0).length,
                            dateRange: {
                                start: batches[0]?.dateRange?.start || null,
                                end: batches[batches.length - 1]?.dateRange?.end || null
                            }
                        };
                    }

                    // Load final persisted knowledge stats (after deduplication)
                    const team = checkpointsData.team || 'coding';
                    const exportPath = join(projectDir, 'knowledge-export', `${team}.json`);
                    if (existsSync(exportPath)) {
                        const exportData = JSON.parse(readFileSync(exportPath, 'utf8'));
                        const entityTypes = {};
                        (exportData.entities || []).forEach(e => {
                            entityTypes[e.entityType] = (entityTypes[e.entityType] || 0) + 1;
                        });
                        persistedKnowledge = {
                            entities: (exportData.entities || []).length,
                            relations: (exportData.relations || []).length,
                            entityTypes,
                            deduplicationRatio: batchSummary?.totalEntities > 0
                                ? ((1 - (exportData.entities || []).length / batchSummary.totalEntities) * 100).toFixed(1)
                                : null
                        };
                    }

                    // Build aggregated step data - totals across ALL batches for each agent type
                    if (checkpointsData.completedBatches?.length > 0) {
                        const batches = checkpointsData.completedBatches;
                        batchSummary.aggregatedSteps = {
                            git_history: {
                                totalCommits: batches.reduce((sum, b) => sum + (b.stats?.commits || 0), 0),
                                batchesProcessed: batches.length
                            },
                            vibe_history: {
                                totalSessions: batches.reduce((sum, b) => sum + (b.stats?.sessions || 0), 0),
                                batchesWithSessions: batches.filter(b => (b.stats?.sessions || 0) > 0).length,
                                batchesProcessed: batches.length
                            },
                            semantic_analysis: {
                                totalEntities: batches.reduce((sum, b) => sum + (b.stats?.entitiesCreated || 0), 0),
                                totalRelations: batches.reduce((sum, b) => sum + (b.stats?.relationsAdded || 0), 0),
                                batchesProcessed: batches.length
                            },
                            kg_operators: {
                                // conv: Convert raw entities to KG format
                                totalProcessed: batches.reduce((sum, b) => sum + (b.stats?.operatorResults?.conv?.processed || 0), 0),
                                // aggr: Classify entities as core vs non-core
                                totalCoreEntities: batches.reduce((sum, b) => sum + (b.stats?.operatorResults?.aggr?.core || 0), 0),
                                // embed: Generate embeddings for similarity
                                totalEmbedded: batches.reduce((sum, b) => sum + (b.stats?.operatorResults?.embed?.embedded || 0), 0),
                                // dedup: Merge duplicate entities
                                totalMerged: batches.reduce((sum, b) => sum + (b.stats?.operatorResults?.dedup?.merged || 0), 0),
                                // pred: Predict and add edges/relations
                                totalEdgesAdded: batches.reduce((sum, b) => sum + (b.stats?.operatorResults?.pred?.edgesAdded || 0), 0),
                                // merge: Final entity additions
                                totalEntitiesAdded: batches.reduce((sum, b) => sum + (b.stats?.operatorResults?.merge?.entitiesAdded || 0), 0),
                                batchesProcessed: batches.length
                            },
                            // content_validation: Uses persisted knowledge as source of truth
                            content_validation: persistedKnowledge ? {
                                entitiesValidated: persistedKnowledge.entities,
                                relationsValidated: persistedKnowledge.relations,
                                validationComplete: true
                            } : null
                        };
                    }
                } catch (e) {
                    console.warn('Could not load batch checkpoints:', e.message);
                }
            }

            // Extract completedBatches for tracer batch iteration display
            let completedBatches = null;
            if (existsSync(checkpointsPath)) {
                try {
                    const checkpointsData = JSON.parse(readFileSync(checkpointsPath, 'utf8'));
                    if (checkpointsData.completedBatches?.length > 0) {
                        completedBatches = checkpointsData.completedBatches;
                    }
                } catch (e) {
                    // Already loaded above, this is just a fallback
                }
            }

            res.json({
                status: 'success',
                data: {
                    id: reportId,
                    workflowName: workflowMatch?.[1]?.trim() || 'unknown',
                    executionId: executionIdMatch?.[1]?.trim() || reportId,
                    status: statusMatch?.[1]?.toLowerCase() || 'unknown',
                    startTime: startTimeMatch?.[1]?.trim() || null,
                    endTime: endTimeMatch?.[1]?.trim() || null,
                    duration: durationMatch?.[1]?.trim() || null,
                    completedSteps: stepsMatch ? parseInt(stepsMatch[1]) : 0,
                    totalSteps: stepsMatch ? parseInt(stepsMatch[2]) : 0,
                    entitiesCreated: entitiesCreatedMatch ? parseInt(entitiesCreatedMatch[1]) : 0,
                    entitiesUpdated: entitiesUpdatedMatch ? parseInt(entitiesUpdatedMatch[1]) : 0,
                    team: teamMatch?.[1] || 'unknown',
                    repositoryPath: repoMatch?.[1] || 'unknown',
                    recommendations,
                    steps,
                    rawContent: content,
                    // Aggregated data from all batches
                    accumulatedStats,
                    batchSummary,
                    // Final persisted knowledge (after deduplication)
                    persistedKnowledge,
                    // Raw completed batches for tracer batch iteration display
                    completedBatches
                }
            });
        } catch (error) {
            console.error('Failed to get UKB history detail:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to get UKB history detail',
                error: error.message
            });
        }
    }

    /**
     * Get current batch processing progress
     * Reads from .data/batch-progress.json written by BatchScheduler
     */
    async handleGetBatchProgress(req, res) {
        try {
            const progressPath = join(codingRoot, '.data', 'batch-progress.json');

            if (!existsSync(progressPath)) {
                return res.json({
                    status: 'success',
                    data: {
                        status: 'idle',
                        message: 'No batch processing in progress',
                        currentBatch: null,
                        completedBatches: 0,
                        totalBatches: 0,
                        accumulatedStats: {
                            entities: 0,
                            relations: 0,
                            tokensUsed: 0
                        }
                    }
                });
            }

            const progress = JSON.parse(readFileSync(progressPath, 'utf8'));
            const age = Date.now() - new Date(progress.lastUpdate || progress.startedAt).getTime();

            // Determine health status
            let health = 'healthy';
            if (progress.status === 'running') {
                if (age > 300000) {
                    health = 'frozen';
                } else if (age > 120000) {
                    health = 'stale';
                }
            }

            res.json({
                status: 'success',
                data: {
                    ...progress,
                    health,
                    ageMs: age,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            console.error('Failed to get batch progress:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to retrieve batch progress',
                error: error.message
            });
        }
    }

    /**
     * Get history of completed batches
     * Reads from batch checkpoint manager data
     */
    async handleGetBatchHistory(req, res) {
        try {
            const checkpointsPath = join(codingRoot, '.data', 'batch-checkpoints.json');

            if (!existsSync(checkpointsPath)) {
                return res.json({
                    status: 'success',
                    data: {
                        checkpoints: [],
                        total: 0
                    }
                });
            }

            const checkpointData = JSON.parse(readFileSync(checkpointsPath, 'utf8'));
            const { limit = 50, team } = req.query;

            let checkpoints = checkpointData.checkpoints || [];

            // Filter by team if specified
            if (team) {
                checkpoints = checkpoints.filter(c => c.team === team);
            }

            // Sort by completion time (newest first)
            checkpoints.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

            res.json({
                status: 'success',
                data: {
                    checkpoints: checkpoints.slice(0, parseInt(limit)),
                    total: checkpoints.length,
                    lastCompleted: checkpointData.lastCompletedBatch || null,
                    accumulatedStats: checkpointData.accumulatedStats || null
                }
            });
        } catch (error) {
            console.error('Failed to get batch history:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to retrieve batch history',
                error: error.message
            });
        }
    }

    /**
     * Get DAG structure for batch operator pipeline visualization
     * Returns the 6 Tree-KG operators and their relationships
     */
    async handleGetBatchDAG(req, res) {
        try {
            // Load model-tiers.yaml for operator tier information
            const configDir = join(codingRoot, 'integrations/mcp-server-semantic-analysis/config');
            const modelTiersPath = join(configDir, 'model-tiers.yaml');

            let operatorTiers = {};
            if (existsSync(modelTiersPath)) {
                const modelTiers = parseYaml(readFileSync(modelTiersPath, 'utf-8'));
                operatorTiers = modelTiers.operator_tiers || {};
            }

            // Define the operator DAG structure
            const operators = [
                {
                    id: 'conv',
                    name: 'Context Convolution',
                    shortName: 'Conv',
                    description: 'Enriches entity descriptions with temporal context from commits and sessions',
                    tier: operatorTiers.conv || 'premium',
                    position: { row: 0, col: 0 }
                },
                {
                    id: 'aggr',
                    name: 'Entity Aggregation',
                    shortName: 'Aggr',
                    description: 'Assigns core/non-core roles based on significance scoring',
                    tier: operatorTiers.aggr || 'standard',
                    position: { row: 0, col: 1 }
                },
                {
                    id: 'embed',
                    name: 'Node Embedding',
                    shortName: 'Embed',
                    description: 'Generates vector embeddings for similarity comparison',
                    tier: operatorTiers.embed || 'fast',
                    position: { row: 0, col: 2 }
                },
                {
                    id: 'dedup',
                    name: 'Deduplication',
                    shortName: 'Dedup',
                    description: 'Merges equivalent entities with role consistency',
                    tier: operatorTiers.dedup || 'standard',
                    position: { row: 1, col: 0 }
                },
                {
                    id: 'pred',
                    name: 'Edge Prediction',
                    shortName: 'Pred',
                    description: 'Predicts relationships using weighted scoring (α·cos + β·AA + γ·CA)',
                    tier: operatorTiers.pred || 'premium',
                    position: { row: 1, col: 1 }
                },
                {
                    id: 'merge',
                    name: 'Structure Merge',
                    shortName: 'Merge',
                    description: 'Fuses batch results into accumulated knowledge graph',
                    tier: operatorTiers.merge || 'standard',
                    position: { row: 1, col: 2 }
                }
            ];

            // Define the operator edges (pipeline flow)
            const edges = [
                { from: 'conv', to: 'aggr', type: 'pipeline' },
                { from: 'aggr', to: 'embed', type: 'pipeline' },
                { from: 'embed', to: 'dedup', type: 'pipeline' },
                { from: 'dedup', to: 'pred', type: 'pipeline' },
                { from: 'pred', to: 'merge', type: 'pipeline' }
            ];

            // Get current progress to annotate operator status
            const progressPath = join(codingRoot, '.data', 'batch-progress.json');
            let operatorStatuses = {};

            if (existsSync(progressPath)) {
                try {
                    const progress = JSON.parse(readFileSync(progressPath, 'utf8'));
                    if (progress.currentBatch?.operators) {
                        operatorStatuses = progress.currentBatch.operators;
                    }
                } catch (e) {
                    // Ignore parse errors
                }
            }

            // Annotate operators with status
            const annotatedOperators = operators.map(op => ({
                ...op,
                status: operatorStatuses[op.id]?.status || 'pending',
                duration: operatorStatuses[op.id]?.duration || null,
                progress: operatorStatuses[op.id]?.progress || null
            }));

            res.json({
                status: 'success',
                data: {
                    operators: annotatedOperators,
                    edges,
                    pipelineOrder: ['conv', 'aggr', 'embed', 'dedup', 'pred', 'merge']
                }
            });
        } catch (error) {
            console.error('Failed to get batch DAG:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to retrieve batch DAG',
                error: error.message
            });
        }
    }

    /**
     * Pause batch processing after current batch completes
     * Writes a pause flag to the progress file
     */
    async handlePauseBatch(req, res) {
        try {
            const progressPath = join(codingRoot, '.data', 'batch-progress.json');

            if (!existsSync(progressPath)) {
                return res.status(404).json({
                    status: 'error',
                    message: 'No batch processing in progress'
                });
            }

            const progress = JSON.parse(readFileSync(progressPath, 'utf8'));

            if (progress.status !== 'running') {
                return res.json({
                    status: 'success',
                    message: 'Batch processing is not running',
                    data: { status: progress.status }
                });
            }

            // Set pause flag
            progress.pauseRequested = true;
            progress.pauseRequestedAt = new Date().toISOString();
            progress.lastUpdate = new Date().toISOString();

            writeFileSync(progressPath, JSON.stringify(progress, null, 2));

            console.log('⏸️ Batch processing pause requested');

            res.json({
                status: 'success',
                message: 'Pause requested - will pause after current batch completes',
                data: {
                    pauseRequested: true,
                    currentBatch: progress.currentBatch?.id || null,
                    completedBatches: progress.completedBatches
                }
            });
        } catch (error) {
            console.error('Failed to pause batch processing:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to pause batch processing',
                error: error.message
            });
        }
    }

    /**
     * Resume paused batch processing
     * Clears pause flag and optionally triggers continuation
     */
    async handleResumeBatch(req, res) {
        try {
            const progressPath = join(codingRoot, '.data', 'batch-progress.json');

            if (!existsSync(progressPath)) {
                return res.status(404).json({
                    status: 'error',
                    message: 'No batch processing state found'
                });
            }

            const progress = JSON.parse(readFileSync(progressPath, 'utf8'));

            // Clear pause flag
            progress.pauseRequested = false;
            progress.pauseRequestedAt = null;
            progress.lastUpdate = new Date().toISOString();

            // If status was paused, update to running
            if (progress.status === 'paused') {
                progress.status = 'running';
                progress.resumedAt = new Date().toISOString();
            }

            writeFileSync(progressPath, JSON.stringify(progress, null, 2));

            console.log('▶️ Batch processing resumed');

            res.json({
                status: 'success',
                message: 'Batch processing resumed',
                data: {
                    status: progress.status,
                    currentBatch: progress.currentBatch?.id || null,
                    completedBatches: progress.completedBatches,
                    totalBatches: progress.totalBatches
                }
            });
        } catch (error) {
            console.error('Failed to resume batch processing:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to resume batch processing',
                error: error.message
            });
        }
    }

    /**
     * Get Code Graph RAG cache status
     * Runs the staleness check script and returns cache status
     * Falls back to cache-metadata.json if script fails (e.g., no .git in Docker)
     */
    async handleGetCGRStatus(req, res) {
        try {
            const cgrDir = join(codingRoot, 'integrations', 'code-graph-rag');
            const stalenessScript = join(cgrDir, 'scripts', 'check-cache-staleness.sh');
            const metadataFile = join(cgrDir, 'shared-data', 'cache-metadata.json');

            // Helper to read cache metadata as fallback
            const readCacheMetadata = () => {
                if (existsSync(metadataFile)) {
                    try {
                        const metadata = JSON.parse(readFileSync(metadataFile, 'utf-8'));
                        return {
                            available: true,
                            cacheStatus: 'unknown',
                            isStale: null,  // Can't determine without git
                            commitsBehind: null,
                            cachedCommit: metadata.commit_short || metadata.commit_hash?.substring(0, 7),
                            currentCommit: null,  // Can't get without git
                            indexedAt: metadata.indexed_at,
                            repoName: metadata.repo_name,
                            stats: metadata.stats,
                            message: 'Cache exists (staleness check unavailable - no git access)',
                            timestamp: new Date().toISOString()
                        };
                    } catch (e) {
                        return null;
                    }
                }
                return null;
            };

            if (!existsSync(stalenessScript)) {
                // No script - try reading metadata directly
                const metadata = readCacheMetadata();
                if (metadata) {
                    return res.json({ status: 'success', data: metadata });
                }
                return res.json({
                    status: 'success',
                    data: {
                        available: false,
                        message: 'CGR cache staleness script not found',
                        cacheStatus: 'unknown'
                    }
                });
            }

            try {
                const result = execSync(`"${stalenessScript}" "${codingRoot}"`, {
                    encoding: 'utf-8',
                    timeout: 10000
                });

                const staleness = JSON.parse(result);

                res.json({
                    status: 'success',
                    data: {
                        available: true,
                        cacheStatus: staleness.status,
                        isStale: staleness.is_stale,
                        commitsBehind: staleness.commits_behind,
                        cachedCommit: staleness.cached_commit,
                        currentCommit: staleness.current_commit,
                        indexedAt: staleness.indexed_at,
                        repoName: staleness.repo_name,
                        threshold: staleness.threshold,
                        message: staleness.message,
                        timestamp: new Date().toISOString()
                    }
                });
            } catch (execError) {
                // Script may exit with code 1 (stale) or 2 (no cache)
                if (execError.stdout) {
                    try {
                        const staleness = JSON.parse(execError.stdout);
                        res.json({
                            status: 'success',
                            data: {
                                available: true,
                                cacheStatus: staleness.status,
                                isStale: staleness.is_stale,
                                commitsBehind: staleness.commits_behind,
                                cachedCommit: staleness.cached_commit,
                                currentCommit: staleness.current_commit,
                                indexedAt: staleness.indexed_at,
                                repoName: staleness.repo_name,
                                threshold: staleness.threshold,
                                message: staleness.message,
                                timestamp: new Date().toISOString()
                            }
                        });
                        return;
                    } catch (parseError) {
                        // Fall through to fallback
                    }
                }

                // Fallback: try reading cache metadata directly (useful in Docker where .git isn't available)
                const metadata = readCacheMetadata();
                if (metadata) {
                    return res.json({ status: 'success', data: metadata });
                }

                res.json({
                    status: 'success',
                    data: {
                        available: true,
                        cacheStatus: 'error',
                        isStale: true,
                        message: `Check failed: ${execError.message}`,
                        timestamp: new Date().toISOString()
                    }
                });
            }
        } catch (error) {
            console.error('Failed to get CGR status:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to retrieve CGR cache status',
                error: error.message
            });
        }
    }

    /**
     * Get CGR reindex progress
     * Reads from the progress file written by reindex-with-metadata.sh
     */
    async handleGetCGRProgress(req, res) {
        try {
            const cgrDir = join(codingRoot, 'integrations', 'code-graph-rag');
            const progressPath = join(cgrDir, 'shared-data', 'reindex-progress.json');

            if (!existsSync(progressPath)) {
                return res.json({
                    status: 'success',
                    data: {
                        status: 'idle',
                        message: 'No reindexing in progress',
                        phase: null,
                        step: 0,
                        totalSteps: 0
                    }
                });
            }

            const progress = JSON.parse(readFileSync(progressPath, 'utf8'));
            const age = progress.updatedAt
                ? Date.now() - new Date(progress.updatedAt).getTime()
                : (progress.completedAt ? Date.now() - new Date(progress.completedAt).getTime() : 0);

            // If status is running but hasn't updated in >5 minutes, mark as stale
            let inferredStatus = progress.status;
            if (progress.status === 'running' && age > 300000) {
                inferredStatus = 'stale';
            }

            res.json({
                status: 'success',
                data: {
                    ...progress,
                    inferredStatus,
                    ageMs: age,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            console.error('Failed to get CGR progress:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to retrieve CGR reindex progress',
                error: error.message
            });
        }
    }

    /**
     * Trigger Code Graph RAG reindexing
     * Runs the indexing command AND updates cache metadata in the background
     */
    async handleCGRReindex(req, res) {
        try {
            const cgrDir = join(codingRoot, 'integrations', 'code-graph-rag');
            const reindexScript = join(cgrDir, 'scripts', 'reindex-with-metadata.sh');

            if (!existsSync(cgrDir)) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Code Graph RAG directory not found'
                });
            }

            if (!existsSync(reindexScript)) {
                return res.status(404).json({
                    status: 'error',
                    message: 'CGR reindex script not found',
                    path: reindexScript
                });
            }

            console.log('🔄 Starting CGR reindex with metadata update...');

            // Run the reindex script that handles both indexing AND metadata update
            // This ensures the cache-metadata.json gets updated after indexing completes
            const indexProcess = spawn('/bin/bash', [reindexScript, codingRoot, 'coding'], {
                cwd: cgrDir,
                detached: true,
                stdio: 'ignore'
            });
            indexProcess.unref();

            res.json({
                status: 'success',
                message: 'CGR reindexing started in background',
                data: {
                    startedAt: new Date().toISOString(),
                    targetRepo: codingRoot,
                    note: 'Indexing may take 20-30 minutes. Cache metadata will be updated automatically after completion. Check /api/cgr/status for updates.'
                }
            });
        } catch (error) {
            console.error('Failed to start CGR reindex:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to start CGR reindexing',
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

            // Setup WebSocket server for bidirectional workflow events
            this.setupWebSocketServer();

            this.server.listen(this.port, (error) => {
                if (error) {
                    console.error('❌ Failed to start System Health API server', { error: error.message, port: this.port });
                    reject(error);
                } else {
                    console.log('✅ System Health API server started', {
                        port: this.port,
                        dashboardUrl: `http://localhost:${this.dashboardPort}`,
                        apiUrl: `http://localhost:${this.port}/api`,
                        wsUrl: `ws://localhost:${this.port}/api/ukb/ws`
                    });
                    resolve();
                }
            });
        });
    }

    /**
     * Setup WebSocket server for bidirectional workflow event communication
     * Handles events from coordinator and commands from dashboard
     */
    setupWebSocketServer() {
        this.wss = new WebSocketServer({ noServer: true });

        // Handle WebSocket upgrade requests
        this.server.on('upgrade', (request, socket, head) => {
            const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

            if (pathname === '/api/ukb/ws') {
                this.wss.handleUpgrade(request, socket, head, (ws) => {
                    this.wss.emit('connection', ws, request);
                });
            } else {
                socket.destroy();
            }
        });

        // Handle new WebSocket connections
        this.wss.on('connection', (ws, request) => {
            console.log('[WebSocket] Client connected');
            this.wsClients.add(ws);

            // Send any buffered events to new client
            for (const event of this.workflowEventBuffer) {
                this.sendToClient(ws, event);
            }

            // Handle incoming commands from dashboard
            ws.on('message', (data) => {
                try {
                    const command = JSON.parse(data.toString());
                    this.handleWorkflowCommand(command);
                } catch (error) {
                    console.error('[WebSocket] Failed to parse command:', error);
                }
            });

            // Handle client disconnect
            ws.on('close', () => {
                console.log('[WebSocket] Client disconnected');
                this.wsClients.delete(ws);
            });

            ws.on('error', (error) => {
                console.error('[WebSocket] Client error:', error);
                this.wsClients.delete(ws);
            });

            // Send heartbeat every 30 seconds
            const heartbeatInterval = setInterval(() => {
                if (ws.readyState === ws.OPEN) {
                    this.sendToClient(ws, {
                        type: 'HEARTBEAT',
                        payload: {
                            workflowId: null,
                            status: 'idle',
                            timestamp: new Date().toISOString()
                        }
                    });
                }
            }, 30000);

            ws.on('close', () => clearInterval(heartbeatInterval));
        });

        // Setup file watcher to forward coordinator progress updates as events
        this.setupWorkflowProgressWatcher();
    }

    /**
     * Watch workflow progress file and convert changes to WebSocket events
     * This bridges the file-based coordinator with the event-driven dashboard
     */
    setupWorkflowProgressWatcher() {
        const progressPath = join(codingRoot, '.data', 'workflow-progress.json');
        let lastContent = '';
        let lastStepStatuses = {};

        // Poll progress file and emit events for changes
        const pollInterval = setInterval(() => {
            try {
                if (!existsSync(progressPath)) {
                    if (lastContent !== '') {
                        // Workflow ended - emit completion or reset
                        this.broadcastEvent({
                            type: 'WORKFLOW_COMPLETED',
                            payload: {
                                workflowId: 'unknown',
                                duration: 0,
                                timestamp: new Date().toISOString()
                            }
                        });
                        lastContent = '';
                        lastStepStatuses = {};
                    }
                    return;
                }

                const content = readFileSync(progressPath, 'utf8');
                if (content === lastContent) return;

                const progress = JSON.parse(content);
                const newContent = content;

                // Detect workflow start
                if (lastContent === '' && progress.status === 'running') {
                    this.broadcastEvent({
                        type: 'WORKFLOW_STARTED',
                        payload: {
                            workflowId: progress.workflowId || 'unknown',
                            workflowName: progress.workflowName || 'unknown',
                            team: progress.team || 'coding',
                            repositoryPath: progress.repositoryPath || '',
                            startTime: progress.startTime || new Date().toISOString(),
                            batchPhaseSteps: progress.batchPhaseSteps || [],
                            preferences: {
                                singleStepMode: progress.singleStepMode || false,
                                stepIntoSubsteps: progress.stepIntoSubsteps || false,
                                mockLLM: progress.mockLLM || false,
                                mockLLMDelay: progress.mockLLMDelay || 500
                            }
                        }
                    });
                }

                // Detect step changes from stepsDetail
                if (progress.stepsDetail) {
                    for (const step of progress.stepsDetail) {
                        const prevStatus = lastStepStatuses[step.name];

                        if (!prevStatus && step.status === 'running') {
                            // Step started
                            this.broadcastEvent({
                                type: 'STEP_STARTED',
                                payload: {
                                    workflowId: progress.workflowId || 'unknown',
                                    stepName: step.name,
                                    agent: step.agent || step.name,
                                    stepIndex: progress.stepsDetail.indexOf(step),
                                    timestamp: new Date().toISOString()
                                }
                            });
                        } else if (prevStatus === 'running' && step.status === 'completed') {
                            // Step completed
                            this.broadcastEvent({
                                type: 'STEP_COMPLETED',
                                payload: {
                                    workflowId: progress.workflowId || 'unknown',
                                    stepName: step.name,
                                    agent: step.agent || step.name,
                                    stepIndex: progress.stepsDetail.indexOf(step),
                                    duration: step.duration || 0,
                                    tokensUsed: step.tokensUsed,
                                    llmProvider: step.llmProvider,
                                    llmCalls: step.llmCalls,
                                    outputs: step.outputs,
                                    timestamp: new Date().toISOString()
                                }
                            });
                        } else if (prevStatus === 'running' && step.status === 'failed') {
                            // Step failed
                            this.broadcastEvent({
                                type: 'STEP_FAILED',
                                payload: {
                                    workflowId: progress.workflowId || 'unknown',
                                    stepName: step.name,
                                    agent: step.agent || step.name,
                                    stepIndex: progress.stepsDetail.indexOf(step),
                                    error: step.error || 'Unknown error',
                                    duration: step.duration || 0,
                                    timestamp: new Date().toISOString()
                                }
                            });
                        }

                        lastStepStatuses[step.name] = step.status;
                    }
                }

                // Detect pause state
                if (progress.stepPaused && !JSON.parse(lastContent || '{}').stepPaused) {
                    this.broadcastEvent({
                        type: 'WORKFLOW_PAUSED',
                        payload: {
                            workflowId: progress.workflowId || 'unknown',
                            pausedAtStep: progress.pausedAtStep || progress.currentStep || 'unknown',
                            reason: 'single_step',
                            timestamp: new Date().toISOString()
                        }
                    });
                } else if (!progress.stepPaused && JSON.parse(lastContent || '{}').stepPaused) {
                    this.broadcastEvent({
                        type: 'WORKFLOW_RESUMED',
                        payload: {
                            workflowId: progress.workflowId || 'unknown',
                            resumedAtStep: progress.currentStep || 'unknown',
                            timestamp: new Date().toISOString()
                        }
                    });
                }

                // Detect workflow completion
                if (progress.status === 'completed' && JSON.parse(lastContent || '{}').status !== 'completed') {
                    this.broadcastEvent({
                        type: 'WORKFLOW_COMPLETED',
                        payload: {
                            workflowId: progress.workflowId || 'unknown',
                            duration: progress.elapsedSeconds ? progress.elapsedSeconds * 1000 : 0,
                            timestamp: new Date().toISOString()
                        }
                    });
                }

                // Detect workflow failure
                if (progress.status === 'failed' && JSON.parse(lastContent || '{}').status !== 'failed') {
                    this.broadcastEvent({
                        type: 'WORKFLOW_FAILED',
                        payload: {
                            workflowId: progress.workflowId || 'unknown',
                            error: progress.error || 'Unknown error',
                            failedAtStep: progress.currentStep,
                            duration: progress.elapsedSeconds ? progress.elapsedSeconds * 1000 : 0,
                            timestamp: new Date().toISOString()
                        }
                    });
                }

                lastContent = newContent;
            } catch (error) {
                // Ignore read errors during rapid updates
            }
        }, 100);

        // Cleanup on server stop
        this.server.on('close', () => clearInterval(pollInterval));
    }

    /**
     * Send a message to a specific WebSocket client
     */
    sendToClient(ws, message) {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    /**
     * Broadcast an event to all connected WebSocket clients
     */
    broadcastEvent(event) {
        const message = JSON.stringify(event);
        console.log(`[WebSocket-TX] ${event.type}`);

        for (const client of this.wsClients) {
            if (client.readyState === client.OPEN) {
                client.send(message);
            }
        }

        // Buffer recent events for new clients (keep last 50)
        this.workflowEventBuffer.push(event);
        if (this.workflowEventBuffer.length > 50) {
            this.workflowEventBuffer.shift();
        }
    }

    /**
     * Handle workflow commands from dashboard
     * Writes to progress file for coordinator to read (temporary bridge)
     */
    async handleWorkflowCommand(command) {
        console.log(`[WebSocket-RX] Command: ${command.type}`);
        const progressPath = join(codingRoot, '.data', 'workflow-progress.json');

        try {
            switch (command.type) {
                case 'STEP_ADVANCE':
                    // Write resume signal to progress file (same as existing handleStepAdvance)
                    if (existsSync(progressPath)) {
                        const progress = JSON.parse(readFileSync(progressPath, 'utf8'));
                        progress.resumeRequestedAt = new Date().toISOString();
                        writeFileSync(progressPath, JSON.stringify(progress, null, 2));
                        console.log('[WebSocket] Step advance requested');
                    }
                    break;

                case 'SET_SINGLE_STEP_MODE':
                    if (existsSync(progressPath)) {
                        const progress = JSON.parse(readFileSync(progressPath, 'utf8'));
                        progress.singleStepMode = command.payload.enabled;
                        progress.singleStepUpdatedAt = new Date().toISOString();
                        writeFileSync(progressPath, JSON.stringify(progress, null, 2));
                        console.log(`[WebSocket] Single-step mode set to: ${command.payload.enabled}`);
                        // Confirm the change
                        this.broadcastEvent({
                            type: 'PREFERENCES_UPDATED',
                            payload: {
                                workflowId: progress.workflowId || 'unknown',
                                preferences: { singleStepMode: command.payload.enabled },
                                timestamp: new Date().toISOString()
                            }
                        });
                    }
                    break;

                case 'SET_STEP_INTO_SUBSTEPS':
                    if (existsSync(progressPath)) {
                        const progress = JSON.parse(readFileSync(progressPath, 'utf8'));
                        progress.stepIntoSubsteps = command.payload.enabled;
                        writeFileSync(progressPath, JSON.stringify(progress, null, 2));
                        console.log(`[WebSocket] Step-into-substeps set to: ${command.payload.enabled}`);
                        this.broadcastEvent({
                            type: 'PREFERENCES_UPDATED',
                            payload: {
                                workflowId: progress.workflowId || 'unknown',
                                preferences: { stepIntoSubsteps: command.payload.enabled },
                                timestamp: new Date().toISOString()
                            }
                        });
                    }
                    break;

                case 'SET_MOCK_LLM':
                    if (existsSync(progressPath)) {
                        const progress = JSON.parse(readFileSync(progressPath, 'utf8'));
                        progress.mockLLM = command.payload.enabled;
                        if (command.payload.delay !== undefined) {
                            progress.mockLLMDelay = command.payload.delay;
                        }
                        progress.mockLLMUpdatedAt = new Date().toISOString();
                        writeFileSync(progressPath, JSON.stringify(progress, null, 2));
                        console.log(`[WebSocket] Mock LLM set to: ${command.payload.enabled}`);
                        this.broadcastEvent({
                            type: 'PREFERENCES_UPDATED',
                            payload: {
                                workflowId: progress.workflowId || 'unknown',
                                preferences: {
                                    mockLLM: command.payload.enabled,
                                    mockLLMDelay: command.payload.delay
                                },
                                timestamp: new Date().toISOString()
                            }
                        });
                    }
                    break;

                case 'CANCEL_WORKFLOW':
                    // Write abort signal
                    const abortPath = join(codingRoot, '.data', 'workflow-abort.json');
                    writeFileSync(abortPath, JSON.stringify({
                        abort: true,
                        workflowId: command.payload.workflowId,
                        reason: command.payload.reason || 'User cancelled',
                        timestamp: new Date().toISOString()
                    }, null, 2));
                    console.log('[WebSocket] Workflow cancel requested');
                    break;

                case 'PAUSE_WORKFLOW':
                    if (existsSync(progressPath)) {
                        const progress = JSON.parse(readFileSync(progressPath, 'utf8'));
                        progress.singleStepMode = true;
                        progress.singleStepUpdatedAt = new Date().toISOString();
                        writeFileSync(progressPath, JSON.stringify(progress, null, 2));
                        console.log('[WebSocket] Workflow pause requested');
                    }
                    break;

                case 'RESUME_WORKFLOW':
                    if (existsSync(progressPath)) {
                        const progress = JSON.parse(readFileSync(progressPath, 'utf8'));
                        progress.resumeRequestedAt = new Date().toISOString();
                        writeFileSync(progressPath, JSON.stringify(progress, null, 2));
                        console.log('[WebSocket] Workflow resume requested');
                    }
                    break;

                default:
                    console.warn(`[WebSocket] Unknown command type: ${command.type}`);
            }
        } catch (error) {
            console.error(`[WebSocket] Failed to handle command ${command.type}:`, error);
        }
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

    /**
     * Get workflow definitions from YAML (Single Source of Truth)
     * Returns agents and workflow for dashboard DAG visualization
     */
    async handleGetWorkflowDefinitions(req, res) {
        try {
            const configDir = join(codingRoot, 'integrations/mcp-server-semantic-analysis/config');

            // Load agents.yaml
            const agentsPath = join(configDir, 'agents.yaml');
            if (!existsSync(agentsPath)) {
                return res.status(404).json({
                    status: 'error',
                    message: 'agents.yaml not found',
                    path: agentsPath
                });
            }

            const agentsYaml = parseYaml(readFileSync(agentsPath, 'utf-8'));

            // Load available workflows
            const workflowsDir = join(configDir, 'workflows');
            const workflows = [];

            if (existsSync(workflowsDir)) {
                const files = readdirSync(workflowsDir).filter(f => f.endsWith('.yaml'));
                for (const file of files) {
                    const workflowPath = join(workflowsDir, file);
                    const workflowYaml = parseYaml(readFileSync(workflowPath, 'utf-8'));
                    workflows.push({
                        name: file.replace('.yaml', ''),
                        ...workflowYaml
                    });
                }
            }

            res.json({
                status: 'success',
                data: {
                    orchestrator: agentsYaml.orchestrator,
                    agents: agentsYaml.agents,
                    stepMappings: agentsYaml.step_mappings,
                    substepIdMappings: agentsYaml.substep_id_mappings || {},
                    agentSubSteps: agentsYaml.agent_substeps || {},
                    workflows: workflows
                }
            });
        } catch (error) {
            console.error('Failed to load workflow definitions:', error);
            res.status(500).json({
                status: 'error',
                message: error.message
            });
        }
    }

    /**
     * Get a specific workflow definition by name
     */
    async handleGetWorkflowDefinition(req, res) {
        try {
            const { workflowName } = req.params;
            const configDir = join(codingRoot, 'integrations/mcp-server-semantic-analysis/config');

            // Load agents.yaml for context
            const agentsPath = join(configDir, 'agents.yaml');
            if (!existsSync(agentsPath)) {
                return res.status(404).json({
                    status: 'error',
                    message: 'agents.yaml not found'
                });
            }

            const agentsYaml = parseYaml(readFileSync(agentsPath, 'utf-8'));

            // Load specific workflow
            const workflowPath = join(configDir, 'workflows', `${workflowName}.yaml`);
            if (!existsSync(workflowPath)) {
                return res.status(404).json({
                    status: 'error',
                    message: `Workflow '${workflowName}' not found`,
                    availableWorkflows: this.getAvailableWorkflows(configDir)
                });
            }

            const workflowYaml = parseYaml(readFileSync(workflowPath, 'utf-8'));

            res.json({
                status: 'success',
                data: {
                    orchestrator: agentsYaml.orchestrator,
                    agents: agentsYaml.agents,
                    stepMappings: agentsYaml.step_mappings,
                    workflow: workflowYaml
                }
            });
        } catch (error) {
            console.error('Failed to load workflow definition:', error);
            res.status(500).json({
                status: 'error',
                message: error.message
            });
        }
    }

    /**
     * Get workflow timing statistics for progress estimation
     * Returns historical averages for step durations, batch times, etc.
     */
    async handleGetWorkflowStatistics(req, res) {
        try {
            const statisticsPath = join(codingRoot, '.data/step-timing-statistics.json');

            if (!existsSync(statisticsPath)) {
                return res.json({
                    status: 'success',
                    data: null,
                    message: 'No timing statistics available yet'
                });
            }

            const statistics = JSON.parse(readFileSync(statisticsPath, 'utf-8'));
            res.json({
                status: 'success',
                data: statistics
            });
        } catch (error) {
            console.error('Failed to load workflow statistics:', error);
            res.status(500).json({
                status: 'error',
                message: error.message
            });
        }
    }

    /**
     * Update workflow timing statistics after a workflow completes
     * Uses exponential moving average (EMA) for adaptive learning
     */
    async handleUpdateWorkflowStatistics(req, res) {
        try {
            const { workflowName, batchDurationMs, finalizationDurationMs, totalBatches, stepDurations } = req.body;

            if (!workflowName) {
                return res.status(400).json({
                    status: 'error',
                    message: 'workflowName is required'
                });
            }

            const statisticsPath = join(codingRoot, '.data/step-timing-statistics.json');
            const EMA_ALPHA = 0.2; // Weight for new samples

            // Load existing statistics or create new
            let statistics = {
                version: 1,
                lastUpdated: new Date().toISOString(),
                workflowTypes: {}
            };

            if (existsSync(statisticsPath)) {
                statistics = JSON.parse(readFileSync(statisticsPath, 'utf-8'));
            }

            // Initialize workflow type if not exists
            if (!statistics.workflowTypes[workflowName]) {
                statistics.workflowTypes[workflowName] = {
                    sampleCount: 0,
                    lastSampleDate: null,
                    steps: {},
                    avgBatchDurationMs: 0,
                    avgFinalizationDurationMs: 0,
                    avgTotalBatches: 0
                };
            }

            const workflowStats = statistics.workflowTypes[workflowName];

            // Update batch duration using EMA
            if (batchDurationMs !== undefined && totalBatches > 0) {
                const perBatchDuration = batchDurationMs / totalBatches;
                if (workflowStats.sampleCount === 0) {
                    workflowStats.avgBatchDurationMs = perBatchDuration;
                } else {
                    workflowStats.avgBatchDurationMs = Math.round(
                        EMA_ALPHA * perBatchDuration + (1 - EMA_ALPHA) * workflowStats.avgBatchDurationMs
                    );
                }
            }

            // Update finalization duration using EMA
            if (finalizationDurationMs !== undefined) {
                if (workflowStats.sampleCount === 0) {
                    workflowStats.avgFinalizationDurationMs = finalizationDurationMs;
                } else {
                    workflowStats.avgFinalizationDurationMs = Math.round(
                        EMA_ALPHA * finalizationDurationMs + (1 - EMA_ALPHA) * workflowStats.avgFinalizationDurationMs
                    );
                }
            }

            // Update total batches average
            if (totalBatches !== undefined) {
                if (workflowStats.sampleCount === 0) {
                    workflowStats.avgTotalBatches = totalBatches;
                } else {
                    workflowStats.avgTotalBatches = Math.round(
                        EMA_ALPHA * totalBatches + (1 - EMA_ALPHA) * workflowStats.avgTotalBatches
                    );
                }
            }

            // Update step-level statistics
            if (stepDurations && typeof stepDurations === 'object') {
                for (const [stepName, duration] of Object.entries(stepDurations)) {
                    if (!workflowStats.steps[stepName]) {
                        workflowStats.steps[stepName] = {
                            avgDurationMs: duration,
                            minDurationMs: duration,
                            maxDurationMs: duration,
                            sampleCount: 1,
                            recentDurations: [duration]
                        };
                    } else {
                        const step = workflowStats.steps[stepName];
                        step.avgDurationMs = Math.round(
                            EMA_ALPHA * duration + (1 - EMA_ALPHA) * step.avgDurationMs
                        );
                        step.minDurationMs = Math.min(step.minDurationMs, duration);
                        step.maxDurationMs = Math.max(step.maxDurationMs, duration);
                        step.sampleCount += 1;
                        step.recentDurations = [...(step.recentDurations || []), duration].slice(-10);
                    }
                }
            }

            // Update metadata
            workflowStats.sampleCount += 1;
            workflowStats.lastSampleDate = new Date().toISOString();
            statistics.lastUpdated = new Date().toISOString();

            // Save updated statistics
            writeFileSync(statisticsPath, JSON.stringify(statistics, null, 2));

            res.json({
                status: 'success',
                message: 'Statistics updated',
                data: {
                    workflowName,
                    sampleCount: workflowStats.sampleCount,
                    avgBatchDurationMs: workflowStats.avgBatchDurationMs,
                    avgFinalizationDurationMs: workflowStats.avgFinalizationDurationMs
                }
            });
        } catch (error) {
            console.error('Failed to update workflow statistics:', error);
            res.status(500).json({
                status: 'error',
                message: error.message
            });
        }
    }

    /**
     * Get list of available workflow names
     */
    getAvailableWorkflows(configDir) {
        const workflowsDir = join(configDir, 'workflows');
        if (!existsSync(workflowsDir)) {
            return [];
        }
        return readdirSync(workflowsDir)
            .filter(f => f.endsWith('.yaml'))
            .map(f => f.replace('.yaml', ''));
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
