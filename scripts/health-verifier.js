#!/usr/bin/env node

/**
 * Health Verifier - Layer 3 Health Monitoring
 *
 * Comprehensive health verification system that:
 * - Runs periodic health checks (60s default)
 * - Detects database locks, service failures, process issues
 * - Provides auto-healing capabilities
 * - Generates structured health reports
 * - Integrates with StatusLine and Dashboard
 *
 * Usage:
 *   health-verifier verify              # One-time verification
 *   health-verifier start               # Start daemon mode
 *   health-verifier stop                # Stop daemon
 *   health-verifier status              # Show latest report
 *   health-verifier report [--json]     # Detailed report
 *   health-verifier history [--limit N] # Historical reports
 */

import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import ProcessStateManager from './process-state-manager.js';
import HealthRemediationActions from './health-remediation-actions.js';
import { runIfMain } from '../lib/utils/esm-cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class HealthVerifier extends EventEmitter {
  constructor(options = {}) {
    super();

    this.codingRoot = options.codingRoot || path.resolve(__dirname, '..');
    this.debug = options.debug || false;

    // Load configuration
    this.rulesPath = path.join(this.codingRoot, 'config', 'health-verification-rules.json');
    this.rules = this.loadRules();

    // Initialize Process State Manager
    this.psm = new ProcessStateManager({ codingRoot: this.codingRoot });

    // Initialize Remediation Actions
    this.remediation = new HealthRemediationActions({
      codingRoot: this.codingRoot,
      debug: this.debug
    });

    // Paths from rules config
    this.reportPath = path.join(this.codingRoot, this.rules.reporting.report_path);
    this.statusPath = path.join(this.codingRoot, this.rules.reporting.status_path);
    this.historyPath = path.join(this.codingRoot, this.rules.reporting.history_path);
    this.logPath = path.join(this.codingRoot, this.rules.reporting.log_path);

    // State tracking
    this.running = false;
    this.timer = null;
    this.lastReport = null;
    this.healingHistory = new Map(); // Track healing attempts per action
    this.autoHealingEnabled = this.rules.auto_healing.enabled;

    // Ensure directories exist
    this.ensureDirectories();
  }

  /**
   * Load health verification rules
   */
  loadRules() {
    try {
      const rulesFile = path.join(__dirname, '..', 'config', 'health-verification-rules.json');
      const rulesData = fsSync.readFileSync(rulesFile, 'utf8');
      return JSON.parse(rulesData);
    } catch (error) {
      console.error(`Failed to load health rules: ${error.message}`);
      throw new Error('Health verification rules not found or invalid');
    }
  }

  /**
   * Ensure required directories exist
   */
  ensureDirectories() {
    const dirs = [
      path.dirname(this.reportPath),
      path.dirname(this.statusPath),
      this.historyPath,
      path.dirname(this.logPath)
    ];

    for (const dir of dirs) {
      if (!fsSync.existsSync(dir)) {
        fsSync.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Log message to file and console
   */
  log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level}] [HealthVerifier] ${message}\n`;

    if (this.debug || level === 'ERROR') {
      console.log(logEntry.trim());
    }

    try {
      fsSync.appendFileSync(this.logPath, logEntry);
    } catch (error) {
      console.error(`Failed to write log: ${error.message}`);
    }
  }

  /**
   * Run comprehensive health verification
   */
  async verify() {
    const startTime = Date.now();
    this.log('Starting health verification');

    try {
      let checks = [];  // Use let since checks may be reassigned during auto-healing recheck

      // Priority Check 1: Database Health
      this.log('Checking database health...');
      const databaseChecks = await this.verifyDatabases();
      checks.push(...databaseChecks);

      // Priority Check 2: Service Availability
      this.log('Checking service availability...');
      const serviceChecks = await this.verifyServices();
      checks.push(...serviceChecks);

      // Priority Check 3: Process Health
      this.log('Checking process health...');
      const processChecks = await this.verifyProcesses();
      checks.push(...processChecks);

      // Auto-Healing: Attempt to fix violations
      if (this.autoHealingEnabled) {
        this.log('Starting auto-healing for detected issues...');
        const healingResults = await this.performAutoHealing(checks);

        // Re-verify after healing
        if (healingResults.attemptedActions > 0) {
          this.log(`Auto-healing completed: ${healingResults.successCount}/${healingResults.attemptedActions} successful`);

          // Re-run checks to verify fixes
          await this.sleep(2000); // Wait for services to stabilize

          const recheckResults = [];
          recheckResults.push(...await this.verifyDatabases());
          recheckResults.push(...await this.verifyServices());
          recheckResults.push(...await this.verifyProcesses());

          // CRITICAL FIX: Replace old checks with recheck results instead of appending
          // This prevents duplicate violations when a service becomes healthy after auto-healing
          const recheckIds = new Set(recheckResults.map(c => c.check_id));
          checks = checks.filter(c => !recheckIds.has(c.check_id)); // Remove old checks
          checks.push(...recheckResults); // Add new checks
        }
      }

      // Generate comprehensive report
      const duration = Date.now() - startTime;
      const report = this.generateReport(checks, duration);

      // Save report
      await this.saveReport(report);

      // Update status for StatusLine
      await this.updateStatus(report);

      // Log summary
      this.logReportSummary(report);

      // Emit event
      this.emit('verification-complete', report);

      return report;

    } catch (error) {
      this.log(`Verification failed: ${error.message}`, 'ERROR');
      throw error;
    }
  }

  /**
   * Verify database health
   */
  async verifyDatabases() {
    const checks = [];
    const dbRules = this.rules.rules.databases;

    // Get database health from ProcessStateManager
    const psmHealth = await this.psm.getHealthStatus();
    const dbHealth = psmHealth.databases;

    // Check 1: Level DB Lock Status
    if (dbRules.leveldb_lock_check.enabled) {
      if (dbHealth.levelDB.locked && dbHealth.levelDB.lockedBy) {
        // Check if lock holder is registered
        const lockHolderPid = dbHealth.levelDB.lockedBy;
        const isRegistered = await this.isProcessRegistered(lockHolderPid, psmHealth);

        if (!isRegistered) {
          checks.push({
            category: 'databases',
            check: 'leveldb_lock_check',
            status: 'critical',
            severity: dbRules.leveldb_lock_check.severity,
            message: `Level DB locked by unregistered process (PID: ${lockHolderPid})`,
            details: {
              lock_holder_pid: lockHolderPid,
              lock_path: path.join(this.codingRoot, '.data/knowledge-graph/LOCK')
            },
            auto_heal: dbRules.leveldb_lock_check.auto_heal,
            auto_heal_action: dbRules.leveldb_lock_check.auto_heal_action,
            recommendation: `Stop VKB server: vkb server stop\nOr kill process: kill ${lockHolderPid}`,
            timestamp: new Date().toISOString()
          });
        } else {
          checks.push({
            category: 'databases',
            check: 'leveldb_lock_check',
            status: 'passed',
            severity: 'info',
            message: `Level DB locked by registered process (PID: ${lockHolderPid})`,
            details: { lock_holder_pid: lockHolderPid },
            timestamp: new Date().toISOString()
          });
        }
      } else {
        checks.push({
          category: 'databases',
          check: 'leveldb_lock_check',
          status: 'passed',
          severity: 'info',
          message: 'Level DB not locked',
          timestamp: new Date().toISOString()
        });
      }
    }

    // Check 2: Qdrant Availability
    if (dbRules.qdrant_availability.enabled) {
      if (!dbHealth.qdrant.available) {
        checks.push({
          category: 'databases',
          check: 'qdrant_availability',
          status: 'warning',
          severity: dbRules.qdrant_availability.severity,
          message: 'Qdrant vector database unavailable',
          details: {
            endpoint: dbRules.qdrant_availability.endpoint
          },
          auto_heal: dbRules.qdrant_availability.auto_heal,
          recommendation: dbRules.qdrant_availability.recommendation,
          timestamp: new Date().toISOString()
        });
      } else {
        checks.push({
          category: 'databases',
          check: 'qdrant_availability',
          status: 'passed',
          severity: 'info',
          message: 'Qdrant vector database available',
          timestamp: new Date().toISOString()
        });
      }
    }

    return checks;
  }

  /**
   * Verify service availability
   */
  async verifyServices() {
    const checks = [];
    const serviceRules = this.rules.rules.services;

    // Check VKB Server
    if (serviceRules.vkb_server.enabled) {
      const vkbCheck = await this.checkHTTPHealth(
        'vkb_server',
        serviceRules.vkb_server.endpoint,
        serviceRules.vkb_server.timeout_ms
      );
      checks.push({
        ...vkbCheck,
        auto_heal: serviceRules.vkb_server.auto_heal,
        auto_heal_action: serviceRules.vkb_server.auto_heal_action,
        severity: serviceRules.vkb_server.severity
      });
    }

    // Check Constraint Monitor
    if (serviceRules.constraint_monitor.enabled) {
      const constraintCheck = await this.checkPortListening(
        'constraint_monitor',
        serviceRules.constraint_monitor.port,
        serviceRules.constraint_monitor.timeout_ms
      );
      checks.push({
        ...constraintCheck,
        auto_heal: serviceRules.constraint_monitor.auto_heal,
        auto_heal_action: serviceRules.constraint_monitor.auto_heal_action,
        severity: serviceRules.constraint_monitor.severity
      });
    }

    // Check Dashboard Server
    if (serviceRules.dashboard_server.enabled) {
      const dashboardCheck = await this.checkPortListening(
        'dashboard_server',
        serviceRules.dashboard_server.port,
        serviceRules.dashboard_server.timeout_ms
      );
      checks.push({
        ...dashboardCheck,
        auto_heal: serviceRules.dashboard_server.auto_heal,
        auto_heal_action: serviceRules.dashboard_server.auto_heal_action,
        severity: serviceRules.dashboard_server.severity
      });
    }

    // Check Health Dashboard API (self-monitoring)
    if (serviceRules.health_dashboard_api.enabled) {
      const healthAPICheck = await this.checkHTTPHealth(
        'health_dashboard_api',
        serviceRules.health_dashboard_api.endpoint,
        serviceRules.health_dashboard_api.timeout_ms
      );
      checks.push({
        ...healthAPICheck,
        auto_heal: serviceRules.health_dashboard_api.auto_heal,
        auto_heal_action: serviceRules.health_dashboard_api.auto_heal_action,
        severity: serviceRules.health_dashboard_api.severity
      });
    }

    // Check Enhanced Transcript Monitor (LSL system - CRITICAL for session history)
    if (serviceRules.enhanced_transcript_monitor?.enabled) {
      const rule = serviceRules.enhanced_transcript_monitor;
      const transcriptCheck = await this.checkPSMService(
        'enhanced_transcript_monitor',
        rule.service_name,
        rule.service_type,
        rule.project_path
      );
      checks.push({
        ...transcriptCheck,
        auto_heal: rule.auto_heal,
        auto_heal_action: rule.auto_heal_action,
        severity: rule.severity
      });
    }

    return checks;
  }

  /**
   * Check if a service is running via PSM
   */
  async checkPSMService(checkName, serviceName, serviceType, projectPath) {
    const check = {
      category: 'services',
      check: checkName,
      check_id: `${checkName}_${Date.now()}`,
      timestamp: new Date().toISOString()
    };

    try {
      const psmHealth = await this.psm.getHealthStatus();
      let serviceFound = false;
      let serviceAlive = false;
      let servicePid = null;

      if (serviceType === 'global') {
        const service = psmHealth.details.global[serviceName];
        if (service) {
          serviceFound = true;
          serviceAlive = service.alive;
          servicePid = service.pid;
        }
      } else if (serviceType === 'per-project' && projectPath) {
        const projectServices = psmHealth.details.projects[projectPath] || [];
        const service = projectServices.find(s => s.name === serviceName);
        if (service) {
          serviceFound = true;
          serviceAlive = service.alive;
          servicePid = service.pid;
        }
      }

      if (!serviceFound) {
        return {
          ...check,
          status: 'failed',
          message: `${serviceName} not registered in PSM`,
          details: { service_name: serviceName, service_type: serviceType, project_path: projectPath }
        };
      }

      if (!serviceAlive) {
        return {
          ...check,
          status: 'failed',
          message: `${serviceName} registered but not running (PID ${servicePid} is dead)`,
          details: { service_name: serviceName, pid: servicePid, status: 'dead' }
        };
      }

      return {
        ...check,
        status: 'passed',
        message: `${serviceName} is healthy`,
        details: { service_name: serviceName, pid: servicePid, status: 'alive' }
      };

    } catch (error) {
      return {
        ...check,
        status: 'failed',
        message: `Failed to check ${serviceName}: ${error.message}`,
        details: { error: error.message }
      };
    }
  }

  /**
   * Verify process health
   */
  async verifyProcesses() {
    const checks = [];
    const processRules = this.rules.rules.processes;

    // Get all registered services
    const psmHealth = await this.psm.getHealthStatus();

    // Check for stale PIDs
    if (processRules.stale_pids.enabled) {
      const stalePids = [];

      // Check global services
      for (const [name, service] of Object.entries(psmHealth.details.global)) {
        if (!service.alive) {
          stalePids.push({ name, pid: service.pid, type: 'global' });
        }
      }

      // Check per-project services
      for (const [projectPath, services] of Object.entries(psmHealth.details.projects)) {
        for (const service of services) {
          if (!service.alive) {
            stalePids.push({ name: service.name, pid: service.pid, type: 'project', projectPath });
          }
        }
      }

      // Check session services
      for (const [sessionId, services] of Object.entries(psmHealth.details.sessions)) {
        for (const service of services) {
          if (!service.alive) {
            stalePids.push({ name: service.name, pid: service.pid, type: 'session', sessionId });
          }
        }
      }

      if (stalePids.length > 0) {
        checks.push({
          category: 'processes',
          check: 'stale_pids',
          status: 'warning',
          severity: processRules.stale_pids.severity,
          message: `Found ${stalePids.length} stale PID(s) in registry`,
          details: { stale_pids: stalePids },
          auto_heal: processRules.stale_pids.auto_heal,
          auto_heal_action: processRules.stale_pids.auto_heal_action,
          recommendation: 'Clean up registry with PSM.cleanupDeadProcesses()',
          timestamp: new Date().toISOString()
        });
      } else {
        checks.push({
          category: 'processes',
          check: 'stale_pids',
          status: 'passed',
          severity: 'info',
          message: 'No stale PIDs detected',
          timestamp: new Date().toISOString()
        });
      }
    }

    return checks;
  }

  /**
   * Check if process is registered in PSM
   */
  async isProcessRegistered(pid, psmHealth) {
    // Check global services
    for (const service of Object.values(psmHealth.details.global)) {
      if (service.pid === pid) return true;
    }

    // Check per-project services
    for (const services of Object.values(psmHealth.details.projects)) {
      for (const service of services) {
        if (service.pid === pid) return true;
      }
    }

    // Check session services
    for (const services of Object.values(psmHealth.details.sessions)) {
      for (const service of services) {
        if (service.pid === pid) return true;
      }
    }

    return false;
  }

  /**
   * Check HTTP health endpoint
   */
  async checkHTTPHealth(serviceName, endpoint, timeout) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(endpoint, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return {
          category: 'services',
          check: serviceName,
          status: 'passed',
          message: `${serviceName} is healthy`,
          details: { endpoint, status_code: response.status },
          timestamp: new Date().toISOString()
        };
      } else {
        return {
          category: 'services',
          check: serviceName,
          status: 'error',
          message: `${serviceName} returned error status`,
          details: { endpoint, status_code: response.status },
          recommendation: `Check ${serviceName} logs and restart if needed`,
          timestamp: new Date().toISOString()
        };
      }
    } catch (error) {
      return {
        category: 'services',
        check: serviceName,
        status: 'error',
        message: `${serviceName} is unavailable`,
        details: { endpoint, error: error.message },
        recommendation: `Start ${serviceName} service`,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Check if port is listening
   */
  async checkPortListening(serviceName, port, timeout) {
    return this.checkHTTPHealth(serviceName, `http://localhost:${port}`, timeout);
  }

  /**
   * Generate comprehensive health report
   */
  generateReport(checks, duration) {
    // Categorize checks
    const passed = checks.filter(c => c.status === 'passed');
    const violations = checks.filter(c => c.status !== 'passed');

    // Count by severity (only for violations, not all checks)
    const bySeverity = {
      info: violations.filter(c => c.severity === 'info').length,
      warning: violations.filter(c => c.severity === 'warning').length,
      error: violations.filter(c => c.severity === 'error').length,
      critical: violations.filter(c => c.severity === 'critical').length
    };

    // Determine overall status (based on actual violations)
    let overallStatus = 'healthy';
    if (bySeverity.critical > 0) {
      overallStatus = 'unhealthy';
    } else if (bySeverity.error > 0) {
      overallStatus = 'degraded';
    } else if (bySeverity.warning >= this.rules.alert_thresholds.violation_count_warning) {
      overallStatus = 'degraded';
    }

    // Generate recommendations
    const recommendations = violations
      .filter(v => v.recommendation)
      .map(v => v.recommendation);

    return {
      version: this.rules.version,
      timestamp: new Date().toISOString(),
      overallStatus,
      summary: {
        total_checks: checks.length,
        passed: passed.length,
        violations: violations.length,
        by_severity: bySeverity
      },
      checks,
      violations,
      recommendations: [...new Set(recommendations)], // Remove duplicates
      metadata: {
        verification_duration_ms: duration,
        rules_version: this.rules.version,
        last_verification: this.lastReport?.timestamp || null
      }
    };
  }

  /**
   * Save report to disk
   */
  async saveReport(report) {
    try {
      // Save latest report
      await fs.writeFile(this.reportPath, JSON.stringify(report, null, 2), 'utf8');

      // Save to history
      const historyFile = path.join(
        this.historyPath,
        `report-${Date.now()}.json`
      );
      await fs.writeFile(historyFile, JSON.stringify(report, null, 2), 'utf8');

      // Clean old history files (keep last N days)
      await this.cleanHistoryFiles();

      this.lastReport = report;
      this.log('Report saved successfully');

    } catch (error) {
      this.log(`Failed to save report: ${error.message}`, 'ERROR');
      throw error;
    }
  }

  /**
   * Update status file for StatusLine integration
   */
  async updateStatus(report) {
    const status = {
      overallStatus: report.overallStatus,
      violationCount: report.violations.length,
      criticalCount: report.summary.by_severity.critical,
      lastUpdate: report.timestamp,
      autoHealingActive: false // Will be updated when auto-healing is implemented
    };

    try {
      await fs.writeFile(this.statusPath, JSON.stringify(status, null, 2), 'utf8');
    } catch (error) {
      this.log(`Failed to update status: ${error.message}`, 'ERROR');
    }
  }

  /**
   * Clean old history files
   */
  async cleanHistoryFiles() {
    try {
      const files = await fs.readdir(this.historyPath);
      const retentionMs = this.rules.verification.report_retention_days * 24 * 60 * 60 * 1000;
      const cutoffTime = Date.now() - retentionMs;

      for (const file of files) {
        if (!file.startsWith('report-') || !file.endsWith('.json')) continue;

        const filePath = path.join(this.historyPath, file);
        const stats = await fs.stat(filePath);

        if (stats.mtimeMs < cutoffTime) {
          await fs.unlink(filePath);
          this.log(`Deleted old history file: ${file}`);
        }
      }
    } catch (error) {
      this.log(`Failed to clean history: ${error.message}`, 'ERROR');
    }
  }

  /**
   * Log report summary
   */
  logReportSummary(report) {
    const { summary, overallStatus, violations } = report;
    const status = overallStatus.toUpperCase();

    this.log(`Health Status: ${status}`);
    this.log(`Checks: ${summary.total_checks} total, ${summary.passed} passed, ${summary.violations} violations`);
    this.log(`Severity: ${summary.by_severity.critical} critical, ${summary.by_severity.error} errors, ${summary.by_severity.warning} warnings`);

    if (violations.length > 0) {
      this.log(`Top violations:`, 'WARN');
      violations.slice(0, 3).forEach(v => {
        this.log(`  - [${v.severity.toUpperCase()}] ${v.message}`, 'WARN');
      });
    }
  }

  /**
   * Check if another health-verifier instance is already running
   * @returns {Promise<{running: boolean, pid?: number}>}
   */
  async checkExistingInstance() {
    try {
      // Check PSM for existing instance
      const isRunning = await this.psm.isServiceRunning('health-verifier', 'global');
      if (isRunning) {
        const services = await this.psm.getServicesByType('global');
        const existing = services.find(s => s.name === 'health-verifier');
        if (existing && existing.pid) {
          // Verify the process is actually running
          try {
            process.kill(existing.pid, 0); // Signal 0 just checks if process exists
            return { running: true, pid: existing.pid };
          } catch (e) {
            // Process doesn't exist, clean up stale entry
            this.log(`Cleaning up stale PSM entry for health-verifier (PID: ${existing.pid})`);
            await this.psm.unregisterService('health-verifier', 'global');
            return { running: false };
          }
        }
      }
      return { running: false };
    } catch (error) {
      this.log(`Error checking existing instance: ${error.message}`, 'WARN');
      return { running: false };
    }
  }

  /**
   * Write heartbeat file to prove daemon is alive and timer is firing
   */
  async writeHeartbeat() {
    const heartbeatPath = path.join(this.codingRoot, '.health', 'verifier-heartbeat.json');
    const heartbeat = {
      pid: process.pid,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage().heapUsed,
      cycleCount: this.cycleCount || 0
    };
    try {
      await fs.writeFile(heartbeatPath, JSON.stringify(heartbeat, null, 2));
    } catch (error) {
      this.log(`Failed to write heartbeat: ${error.message}`, 'ERROR');
    }
  }

  /**
   * Start daemon mode with robust error handling
   */
  async start() {
    if (this.running) {
      this.log('Health verifier already running');
      return;
    }

    // Check for existing instance (singleton enforcement)
    const existing = await this.checkExistingInstance();
    if (existing.running) {
      this.log(`Another health-verifier instance is already running (PID: ${existing.pid})`);
      console.log(`⚠️  Health verifier already running (PID: ${existing.pid})`);
      console.log('   Use "health-verifier stop" first if you want to restart.');
      return;
    }

    this.running = true;
    this.cycleCount = 0;
    this.log('Starting health verifier daemon mode');

    // Install global error handlers to prevent silent failures
    process.on('uncaughtException', (error) => {
      this.log(`UNCAUGHT EXCEPTION: ${error.message}\n${error.stack}`, 'ERROR');
      // Don't exit - try to keep running
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.log(`UNHANDLED REJECTION: ${reason}`, 'ERROR');
      // Don't exit - try to keep running
    });

    // Register this instance with PSM
    try {
      await this.psm.registerService({
        name: 'health-verifier',
        pid: process.pid,
        type: 'global',
        script: 'scripts/health-verifier.js'
      });
      this.log(`Registered with PSM (PID: ${process.pid})`);
    } catch (error) {
      this.log(`Failed to register with PSM: ${error.message}`, 'WARN');
    }

    // Run initial verification
    await this.verify();
    await this.writeHeartbeat();

    // Schedule periodic verification with robust error handling
    const interval = this.rules.verification.interval_seconds * 1000;

    const runCycle = async () => {
      this.cycleCount++;
      const cycleStart = Date.now();

      try {
        // Write heartbeat BEFORE verify to prove timer fired
        await this.writeHeartbeat();
        this.log(`Timer cycle ${this.cycleCount} started`);

        await this.verify();

        const cycleDuration = Date.now() - cycleStart;
        this.log(`Timer cycle ${this.cycleCount} completed in ${cycleDuration}ms`);
      } catch (error) {
        this.log(`Verification error in cycle ${this.cycleCount}: ${error.message}\n${error.stack}`, 'ERROR');
        // Write heartbeat even on error to prove we're still running
        await this.writeHeartbeat().catch(() => {});
      }
    };

    this.timer = setInterval(runCycle, interval);

    // Additional safety: use setInterval reference check
    this.timerCheckInterval = setInterval(() => {
      if (!this.timer) {
        this.log('CRITICAL: Main timer was cleared unexpectedly! Restarting...', 'ERROR');
        this.timer = setInterval(runCycle, interval);
      }
    }, interval * 2); // Check every 2 cycles

    this.log(`Health verifier running (interval: ${this.rules.verification.interval_seconds}s)`);
  }

  /**
   * Stop daemon mode
   */
  async stop() {
    if (!this.running) {
      this.log('Health verifier not running');
      return;
    }

    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.timerCheckInterval) {
      clearInterval(this.timerCheckInterval);
      this.timerCheckInterval = null;
    }

    // Unregister from PSM
    try {
      await this.psm.unregisterService('health-verifier', 'global');
      this.log('Unregistered from PSM');
    } catch (error) {
      this.log(`Failed to unregister from PSM: ${error.message}`, 'WARN');
    }

    this.log('Health verifier stopped');
  }

  /**
   * Perform auto-healing for detected violations
   */
  async performAutoHealing(checks) {
    const results = {
      attemptedActions: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      actions: []
    };

    // Find all violations that have auto_heal enabled
    const healableViolations = checks.filter(c =>
      c.status !== 'passed' && c.auto_heal && c.auto_heal_action
    );

    if (healableViolations.length === 0) {
      this.log('No auto-healable violations found');
      return results;
    }

    this.log(`Found ${healableViolations.length} auto-healable violation(s)`);

    // Execute remediation actions
    for (const violation of healableViolations) {
      results.attemptedActions++;

      this.log(`Attempting to heal: ${violation.check} (${violation.auto_heal_action})`);

      try {
        const actionResult = await this.remediation.executeAction(
          violation.auto_heal_action,
          violation.details || {}
        );

        results.actions.push({
          violation: violation.check,
          action: violation.auto_heal_action,
          result: actionResult
        });

        if (actionResult.success) {
          results.successCount++;
          this.log(`✓ Healing successful: ${violation.check}`);
        } else if (actionResult.reason === 'cooldown') {
          results.skippedCount++;
          this.log(`⏸ Healing skipped (cooldown): ${violation.check}`);
        } else {
          results.failedCount++;
          this.log(`✗ Healing failed: ${violation.check} - ${actionResult.message}`, 'WARN');
        }

      } catch (error) {
        results.failedCount++;
        this.log(`✗ Healing error: ${violation.check} - ${error.message}`, 'ERROR');
      }

      // Small delay between actions to avoid overwhelming the system
      await this.sleep(1000);
    }

    return results;
  }

  /**
   * Helper: Sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// CLI Interface
runIfMain(import.meta.url, () => {
  const command = process.argv[2] || 'verify';
  const verifier = new HealthVerifier({ debug: true });

  switch (command) {
    case 'verify':
      verifier.verify()
        .then(report => {
          console.log('\n✅ Health Verification Complete');
          console.log(`Overall Status: ${report.overallStatus.toUpperCase()}`);
          console.log(`Violations: ${report.violations.length}`);
          process.exit(report.overallStatus === 'healthy' ? 0 : 1);
        })
        .catch(error => {
          console.error('❌ Verification failed:', error.message);
          process.exit(1);
        });
      break;

    case 'start':
      verifier.start()
        .then(() => {
          console.log('✅ Health verifier started');
          // Keep process alive
          process.on('SIGINT', async () => {
            await verifier.stop();
            process.exit(0);
          });
        })
        .catch(error => {
          console.error('❌ Failed to start:', error.message);
          process.exit(1);
        });
      break;

    case 'stop':
      verifier.stop()
        .then(() => {
          console.log('✅ Health verifier stopped');
          process.exit(0);
        })
        .catch(error => {
          console.error('❌ Failed to stop:', error.message);
          process.exit(1);
        });
      break;

    case 'status':
      try {
        const statusPath = path.join(verifier.codingRoot, '.health/verification-status.json');
        const statusData = fsSync.readFileSync(statusPath, 'utf8');
        const status = JSON.parse(statusData);
        console.log('\n📊 Health Status:');
        console.log(JSON.stringify(status, null, 2));
        process.exit(0);
      } catch (error) {
        console.error('❌ Failed to read status:', error.message);
        process.exit(1);
      }
      break;

    case 'report':
      try {
        const reportPath = path.join(verifier.codingRoot, '.health/verification-report.json');
        const reportData = fsSync.readFileSync(reportPath, 'utf8');
        const report = JSON.parse(reportData);

        if (process.argv.includes('--json')) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log('\n📋 Health Report:');
          console.log(`Status: ${report.overallStatus.toUpperCase()}`);
          console.log(`Timestamp: ${report.timestamp}`);
          console.log(`\nSummary:`);
          console.log(`  Total Checks: ${report.summary.total_checks}`);
          console.log(`  Passed: ${report.summary.passed}`);
          console.log(`  Violations: ${report.summary.violations}`);
          console.log(`\nBy Severity:`);
          console.log(`  Critical: ${report.summary.by_severity.critical}`);
          console.log(`  Errors: ${report.summary.by_severity.error}`);
          console.log(`  Warnings: ${report.summary.by_severity.warning}`);

          if (report.violations.length > 0) {
            console.log(`\n⚠️  Violations:`);
            report.violations.forEach((v, i) => {
              console.log(`  ${i + 1}. [${v.severity.toUpperCase()}] ${v.message}`);
              if (v.recommendation) {
                console.log(`     → ${v.recommendation}`);
              }
            });
          }
        }
        process.exit(0);
      } catch (error) {
        console.error('❌ Failed to read report:', error.message);
        process.exit(1);
      }
      break;

    default:
      console.error('Unknown command:', command);
      console.log('\nUsage:');
      console.log('  health-verifier verify              # One-time verification');
      console.log('  health-verifier start               # Start daemon mode');
      console.log('  health-verifier stop                # Stop daemon');
      console.log('  health-verifier status              # Show latest status');
      console.log('  health-verifier report [--json]     # Show detailed report');
      process.exit(1);
  }
});

export default HealthVerifier;
