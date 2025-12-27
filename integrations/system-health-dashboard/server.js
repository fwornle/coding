#!/usr/bin/env node

/**
 * System Health Dashboard API Server
 * Provides health verification data to the dashboard frontend
 * Port: 3033 (configured in .env.ports)
 */

import express from 'express';
import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
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
        this.app.post('/api/ukb/start', this.handleStartUKBWorkflow.bind(this));
        this.app.get('/api/ukb/history', this.handleGetUKBHistory.bind(this));
        this.app.get('/api/ukb/history/:reportId', this.handleGetUKBHistoryDetail.bind(this));

        // Workflow definitions endpoint (Single Source of Truth)
        this.app.get('/api/workflows/definitions', this.handleGetWorkflowDefinitions.bind(this));
        this.app.get('/api/workflows/definitions/:workflowName', this.handleGetWorkflowDefinition.bind(this));

        // Batch processing endpoints
        this.app.get('/api/batch/progress', this.handleGetBatchProgress.bind(this));
        this.app.get('/api/batch/history', this.handleGetBatchHistory.bind(this));
        this.app.get('/api/batch/dag', this.handleGetBatchDAG.bind(this));
        this.app.post('/api/batch/pause', this.handlePauseBatch.bind(this));
        this.app.post('/api/batch/resume', this.handleResumeBatch.bind(this));

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

            // Check if the workflow progress represents an inline workflow
            // that is NOT already in the registered processes list
            if (workflowProgress) {
                const lastUpdate = new Date(workflowProgress.lastUpdate).getTime();
                const age = Date.now() - lastUpdate;
                const hasFailed = (workflowProgress.stepsFailed?.length || 0) > 0;

                // Check if this workflow is already represented in registered processes
                const alreadyRegistered = detailedStatus.processes.some(
                    p => p.workflowName === workflowProgress.workflowName && p.pid !== 'mcp-inline'
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

                // Only show recent workflows (within last 30 minutes) or still "running"
                const isRelevant = age < 1800000 || inferredStatus === 'running';

                if (isRelevant && !alreadyRegistered) {
                    // Add a synthetic process entry for the inline MCP workflow
                    const inlineProcess = {
                        pid: 'mcp-inline',
                        workflowName: workflowProgress.workflowName,
                        team: workflowProgress.team || 'unknown',
                        repositoryPath: workflowProgress.repositoryPath || codingRoot,
                        startTime: workflowProgress.startTime,
                        lastHeartbeat: workflowProgress.lastUpdate,
                        status: inferredStatus,
                        completedSteps: workflowProgress.completedSteps || 0,
                        totalSteps: workflowProgress.totalSteps || 0,
                        currentStep: workflowProgress.currentStep,
                        stepsCompleted: workflowProgress.stepsCompleted || [],
                        stepsFailed: workflowProgress.stepsFailed || [],
                        elapsedSeconds: workflowProgress.elapsedSeconds || Math.round((Date.now() - new Date(workflowProgress.startTime).getTime()) / 1000),
                        logFile: null,
                        isAlive: inferredStatus === 'running',
                        health: health,
                        heartbeatAgeSeconds: Math.round(age / 1000),
                        progressPercent: workflowProgress.totalSteps > 0
                            ? Math.round((workflowProgress.completedSteps / workflowProgress.totalSteps) * 100)
                            : 0,
                        steps: this.buildStepInfo(workflowProgress),
                        isInlineMCP: true, // Flag to indicate this is an inline MCP workflow
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

            steps.push({ name: stepName, status });
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
     * Resets the workflow-progress.json and optionally kills stale processes
     */
    async handleCancelWorkflow(req, res) {
        try {
            const { killProcesses = false } = req.body;
            const progressPath = join(codingRoot, '.data', 'workflow-progress.json');

            let previousState = null;
            let killedProcesses = [];

            // Read current state before resetting
            if (existsSync(progressPath)) {
                try {
                    previousState = JSON.parse(readFileSync(progressPath, 'utf8'));
                } catch (e) {
                    // Ignore parse errors
                }
            }

            // Reset workflow progress to idle state
            const resetState = {
                status: 'cancelled',
                workflow: previousState?.workflowName || null,
                previousStatus: previousState?.status || 'unknown',
                cancelledAt: new Date().toISOString(),
                stepsDetail: [],
                lastUpdate: new Date().toISOString()
            };

            writeFileSync(progressPath, JSON.stringify(resetState, null, 2));

            // Optionally kill stale semantic-analysis processes
            if (killProcesses) {
                const ukbManager = new UKBProcessManager();
                killedProcesses = ukbManager.cleanupStaleProcesses(false);
            }

            console.log(`🛑 Workflow cancelled: ${previousState?.workflowName || 'unknown'} (was: ${previousState?.status || 'unknown'})`);

            res.json({
                status: 'success',
                data: {
                    cancelled: true,
                    previousWorkflow: previousState?.workflowName || null,
                    previousStatus: previousState?.status || 'unknown',
                    completedSteps: previousState?.completedSteps || 0,
                    totalSteps: previousState?.totalSteps || 0,
                    killedProcesses: killedProcesses.length,
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
                    rawContent: content
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
