#!/usr/bin/env node

/**
 * Health Verifier — Reporter Mode (Phase 33)
 *
 * Reduced from a full daemon + auto-heal stack to a thin REPORTER that runs
 * health checks once per CLI invocation and POSTs a summary signal to the
 * health-coordinator HTTP endpoint. The coordinator (scripts/health-coordinator.js)
 * is now the sole writer of `/health/state`; this script no longer writes any
 * `.health/*.json` files of its own.
 *
 * Phase 33 deletions (per plan 33-04):
 *  - daemon mode (start/stop CLI cases) — coordinator owns lifecycle
 *  - in-container endpoint rewriting — coordinator runs on host only
 *  - bind-mount freshness check — D-06: rule cannot fix the cause
 *  - in-container supervisord status check — D-08: container-process supervision dropped
 *  - performAutoHealing() / executeRemediation arms — coordinator owns heals
 *  - .health/verifier-heartbeat.json writes — HTTP endpoint IS the heartbeat
 *  - inline 10MB log rotation — extracted to lib/utils/log-rotator.js
 *
 * Preserved:
 *  - verify CLI (one-shot run + POST signal)
 *  - report CLI (one-shot read of /health/state from coordinator)
 *  - status CLI (one-shot read of /health/state from coordinator)
 *  - rule loading from config/health-verification-rules.json
 *  - core check methods: verifyDatabases, verifyServices, verifyObservationQuality,
 *    verifyProcesses, verifyFiles
 *
 * Usage:
 *   health-verifier verify              # Run checks, POST verify_run signal, exit 0/1
 *   health-verifier report [--json]     # Read /health/state from coordinator
 *   health-verifier status              # Read /health/state from coordinator (compact)
 */

import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
import ProcessStateManager from './process-state-manager.js';
import { runIfMain } from '../lib/utils/esm-cli.js';
import { createRotatingLogger } from '../lib/utils/log-rotator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Phase 33: coordinator endpoint discovery (D-02). Single env var, host default.
const COORDINATOR = process.env.HEALTH_COORDINATOR_URL || 'http://localhost:3034';

/**
 * POST a signal to the coordinator's /signals endpoint.
 * SPEC R6: do NOT silently treat coordinator-unreachable as healthy. Caller
 * decides whether to surface the error to the CLI exit code.
 *
 * @param {Object} signal - { kind, source, status, payload?, ts, session_id? }
 * @returns {Promise<void>} resolves on 2xx response; throws otherwise.
 */
async function postSignal(signal) {
  try {
    const r = await fetch(`${COORDINATOR}/signals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signal)
    });
    if (!r.ok) throw new Error(`signal POST ${r.status}`);
  } catch (err) {
    // SPEC R6: log + propagate. Never fall back to "healthy".
    process.stderr.write(`[HealthVerifier] coordinator unreachable: ${err.message}\n`);
    throw err;
  }
}

class HealthVerifier extends EventEmitter {
  constructor(options = {}) {
    super();

    this.codingRoot = options.codingRoot || path.resolve(__dirname, '..');
    this.debug = options.debug || false;

    // Load configuration
    this.rulesPath = path.join(this.codingRoot, 'config', 'health-verification-rules.json');
    this.rules = this.loadRules();

    // Initialize Process State Manager (read-only use; we never restart it)
    this.psm = new ProcessStateManager({ codingRoot: this.codingRoot });

    // Log path comes from rules config; rotating logger handles 10MB rollover.
    this.logPath = path.join(this.codingRoot, this.rules.reporting.log_path);
    this.ensureDirectories();

    // Phase 33: rotating logger from lib/utils/log-rotator.js (no inline 10MB block).
    this.log = createRotatingLogger({
      logPath: this.logPath,
      prefix: 'HealthVerifier',
      debug: this.debug
    });
  }

  /**
   * Load health verification rules.
   * Phase 33: in-container endpoint rewriting removed — coordinator runs on host only,
   * the host.docker.internal -> localhost rewrite is no longer needed.
   */
  loadRules() {
    try {
      const rulesData = fsSync.readFileSync(this.rulesPath || path.join(__dirname, '..', 'config', 'health-verification-rules.json'), 'utf8');
      return JSON.parse(rulesData);
    } catch (error) {
      process.stderr.write(`[HealthVerifier] Failed to load health rules: ${error.message}\n`);
      throw new Error('Health verification rules not found or invalid');
    }
  }

  /**
   * Ensure log directory exists (we still write to .logs for rotation).
   */
  ensureDirectories() {
    const dir = path.dirname(this.logPath);
    if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
  }

  /**
   * Run comprehensive health verification (one shot — no daemon loop).
   * Returns a report object; caller is responsible for posting the summary
   * signal to the coordinator.
   */
  async verify() {
    const startTime = Date.now();
    this.log('Starting health verification');

    try {
      const checks = [];

      // Database health
      this.log('Checking database health...');
      checks.push(...await this.verifyDatabases());

      // Service availability
      this.log('Checking service availability...');
      checks.push(...await this.verifyServices());

      // Observation quality
      this.log('Checking observation quality...');
      checks.push(...await this.verifyObservationQuality());

      // Process health
      this.log('Checking process health...');
      checks.push(...await this.verifyProcesses());

      // File health
      this.log('Checking file health...');
      checks.push(...await this.verifyFiles());

      // Phase 33: NO auto-heal arm — coordinator owns narrow heals.
      //          NO supervisord check — D-08 (container-process supervision dropped).
      //          NO bind-mount freshness check — D-06 (heal cannot fix the cause).

      const duration = Date.now() - startTime;
      const report = this.generateReport(checks, duration);

      this.logReportSummary(report);
      this.emit('verification-complete', report);
      return report;
    } catch (error) {
      this.log(`Verification failed: ${error.message}`, 'ERROR');
      throw error;
    }
  }

  /**
   * Verify database health via PSM (read-only).
   */
  async verifyDatabases() {
    const checks = [];
    const dbRules = this.rules.rules.databases || {};

    let psmHealth;
    try {
      psmHealth = await this.psm.getHealthStatus();
    } catch (err) {
      // SPEC R6: surface unknown, not healthy.
      this.log(`PSM health unavailable: ${err.message}`, 'WARN');
      checks.push({
        category: 'databases', check: 'psm_health', check_id: 'psm_health',
        status: 'warning', severity: 'warning',
        message: `PSM health unavailable: ${err.message}`,
        timestamp: new Date().toISOString()
      });
      return checks;
    }

    const dbHealth = psmHealth.databases || {};

    if (dbRules.leveldb_lock_check && dbRules.leveldb_lock_check.enabled) {
      const lev = dbHealth.levelDB || {};
      if (lev.locked && lev.lockedBy) {
        checks.push({
          category: 'databases', check: 'leveldb_lock_check', check_id: 'leveldb_lock_check',
          status: 'warning', severity: dbRules.leveldb_lock_check.severity || 'warning',
          message: `Level DB locked by PID ${lev.lockedBy}`,
          details: { lock_holder_pid: lev.lockedBy },
          timestamp: new Date().toISOString()
        });
      } else {
        checks.push({
          category: 'databases', check: 'leveldb_lock_check', check_id: 'leveldb_lock_check',
          status: 'passed', severity: 'info',
          message: 'Level DB not locked',
          timestamp: new Date().toISOString()
        });
      }
    }

    if (dbRules.qdrant_availability && dbRules.qdrant_availability.enabled) {
      const qd = dbHealth.qdrant || {};
      if (qd.available) {
        checks.push({
          category: 'databases', check: 'qdrant_availability', check_id: 'qdrant_availability',
          status: 'passed', severity: 'info',
          message: 'Qdrant available',
          timestamp: new Date().toISOString()
        });
      } else {
        checks.push({
          category: 'databases', check: 'qdrant_availability', check_id: 'qdrant_availability',
          status: 'warning', severity: dbRules.qdrant_availability.severity || 'warning',
          message: 'Qdrant unavailable',
          details: { endpoint: dbRules.qdrant_availability.endpoint },
          timestamp: new Date().toISOString()
        });
      }
    }

    return checks;
  }

  /**
   * Verify services declared in rules.services via simple HTTP probes.
   */
  async verifyServices() {
    const checks = [];
    const serviceRules = this.rules.rules.services || {};

    for (const [name, rule] of Object.entries(serviceRules)) {
      if (!rule || !rule.enabled) continue;

      const endpoint = rule.endpoint;
      if (!endpoint) {
        checks.push({
          category: 'services', check: name, check_id: name,
          status: 'warning', severity: rule.severity || 'warning',
          message: `Service ${name} has no endpoint`,
          timestamp: new Date().toISOString()
        });
        continue;
      }

      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), rule.timeout_ms || 5000);
        const r = await fetch(endpoint, { signal: ctrl.signal });
        clearTimeout(t);
        if (r.ok) {
          checks.push({
            category: 'services', check: name, check_id: name,
            status: 'passed', severity: 'info',
            message: `${name} healthy`,
            details: { endpoint, http_status: r.status },
            timestamp: new Date().toISOString()
          });
        } else {
          checks.push({
            category: 'services', check: name, check_id: name,
            status: 'warning', severity: rule.severity || 'warning',
            message: `${name} HTTP ${r.status}`,
            details: { endpoint, http_status: r.status },
            timestamp: new Date().toISOString()
          });
        }
      } catch (err) {
        // SPEC R6: surface unknown / warning, never healthy on exception.
        checks.push({
          category: 'services', check: name, check_id: name,
          status: 'warning', severity: rule.severity || 'warning',
          message: `${name} unreachable: ${err.message}`,
          details: { endpoint, error: err.message },
          timestamp: new Date().toISOString()
        });
      }
    }

    return checks;
  }

  /**
   * Verify observation quality — minimal placeholder; real quality metrics
   * stay with the obs-api. Reporter mode does not need to duplicate them.
   */
  async verifyObservationQuality() {
    return [];
  }

  /**
   * Verify processes registered in PSM.
   */
  async verifyProcesses() {
    const checks = [];
    let psmHealth;
    try {
      psmHealth = await this.psm.getHealthStatus();
    } catch (err) {
      this.log(`PSM health unavailable for processes: ${err.message}`, 'WARN');
      return checks;
    }

    const processes = psmHealth.processes || {};
    for (const [name, info] of Object.entries(processes)) {
      const alive = info && info.alive !== false;
      checks.push({
        category: 'processes', check: name, check_id: name,
        status: alive ? 'passed' : 'warning',
        severity: alive ? 'info' : 'warning',
        message: alive ? `${name} alive` : `${name} not alive`,
        details: info,
        timestamp: new Date().toISOString()
      });
    }
    return checks;
  }

  /**
   * Verify files declared in rules.files (existence + freshness).
   */
  async verifyFiles() {
    const checks = [];
    const fileRules = this.rules.rules.files || {};

    for (const [name, rule] of Object.entries(fileRules)) {
      if (!rule || !rule.enabled) continue;
      const paths = rule.paths || (rule.path ? [rule.path] : []);
      let allPresent = true;
      const details = { paths: [] };
      for (const p of paths) {
        const abs = path.isAbsolute(p) ? p : path.join(this.codingRoot, p);
        if (fsSync.existsSync(abs)) {
          const st = fsSync.statSync(abs);
          details.paths.push({ path: abs, present: true, mtime: st.mtimeMs });
        } else {
          allPresent = false;
          details.paths.push({ path: abs, present: false });
        }
      }
      checks.push({
        category: 'files', check: name, check_id: name,
        status: allPresent ? 'passed' : 'warning',
        severity: allPresent ? 'info' : (rule.severity || 'warning'),
        message: allPresent ? `${name} present` : `${name} missing one or more paths`,
        details,
        timestamp: new Date().toISOString()
      });
    }
    return checks;
  }

  /**
   * Aggregate per-check entries into a report.
   */
  generateReport(checks, duration) {
    const passed = checks.filter(c => c.status === 'passed');
    const violations = checks.filter(c => c.status !== 'passed');

    const bySeverity = {
      info: violations.filter(c => c.severity === 'info').length,
      warning: violations.filter(c => c.severity === 'warning').length,
      error: violations.filter(c => c.severity === 'error').length,
      critical: violations.filter(c => c.severity === 'critical').length
    };

    let overallStatus = 'healthy';
    if (bySeverity.critical > 0) overallStatus = 'unhealthy';
    else if (bySeverity.error > 0) overallStatus = 'degraded';
    else if (bySeverity.warning >= (this.rules.alert_thresholds?.violation_count_warning ?? 99))
      overallStatus = 'degraded';

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
      metadata: { verification_duration_ms: duration }
    };
  }

  logReportSummary(report) {
    const status = report.overallStatus.toUpperCase();
    this.log(`Health Status: ${status}`);
    this.log(`Checks: ${report.summary.total_checks} total, ${report.summary.passed} passed, ${report.summary.violations} violations`);
  }
}

// CLI Interface — Phase 33 reporter mode.
runIfMain(import.meta.url, () => {
  const command = process.argv[2] || 'verify';
  const verifier = new HealthVerifier({ debug: true });

  switch (command) {
    case 'verify':
      verifier.verify()
        .then(async (report) => {
          // Phase 33: POST a verify_run signal to the coordinator instead
          // of writing .health/verification-status.json. SPEC R6: if the
          // coordinator is unreachable, exit non-zero.
          const anyFailures = report.violations.length > 0;
          try {
            await postSignal({
              kind: 'verify_run',
              source: 'health-verifier-cli',
              status: anyFailures ? 'unhealthy' : 'healthy',
              payload: { results: report.checks, summary: report.summary },
              ts: Date.now()
            });
          } catch {
            // postSignal already wrote a stderr message; surface non-zero
            // to caller so CI / shell knows the coordinator path failed.
            process.exit(2);
          }
          process.stderr.write(`Health Verification Complete\n`);
          process.stderr.write(`Overall Status: ${report.overallStatus.toUpperCase()}\n`);
          process.stderr.write(`Violations: ${report.violations.length}\n`);
          process.exit(anyFailures ? 1 : 0);
        })
        .catch(err => {
          process.stderr.write(`Verification failed: ${err.message}\n`);
          process.exit(1);
        });
      break;

    case 'status':
      // Phase 33: read /health/state from the coordinator (no more .health/*.json reads).
      (async () => {
        try {
          const r = await fetch(`${COORDINATOR}/health/state`);
          if (!r.ok) {
            process.stderr.write(`coordinator HTTP ${r.status}\n`);
            process.exit(1);
          }
          const state = await r.json();
          process.stdout.write(JSON.stringify(state, null, 2) + '\n');
          process.exit(0);
        } catch (err) {
          process.stderr.write(`coordinator unreachable: ${err.message}\n`);
          process.exit(1);
        }
      })();
      break;

    case 'report':
      // Phase 33: same source as `status` (coordinator /health/state),
      // optionally rendered compactly without --json.
      (async () => {
        try {
          const r = await fetch(`${COORDINATOR}/health/state`);
          if (!r.ok) {
            process.stderr.write(`coordinator HTTP ${r.status}\n`);
            process.exit(1);
          }
          const state = await r.json();
          if (process.argv.includes('--json')) {
            process.stdout.write(JSON.stringify(state, null, 2) + '\n');
          } else {
            process.stdout.write(`Health Report\n`);
            process.stdout.write(`Generated: ${state.generated_at || '(unknown)'}\n`);
            process.stdout.write(`Container: ${state.container?.healthcheck?.status || state.container?.healthcheck || 'unknown'}\n`);
            process.stdout.write(`Databases: ${state.databases?.status || 'unknown'}\n`);
            process.stdout.write(`Services tracked: ${(state.services || []).length}\n`);
            process.stdout.write(`LSL sessions: ${Object.keys(state.lsl || {}).length}\n`);
          }
          process.exit(0);
        } catch (err) {
          process.stderr.write(`coordinator unreachable: ${err.message}\n`);
          process.exit(1);
        }
      })();
      break;

    default:
      process.stderr.write(`Unknown command: ${command}\n`);
      process.stderr.write(`\nUsage:\n`);
      process.stderr.write(`  health-verifier verify              # Run checks, POST verify_run signal\n`);
      process.stderr.write(`  health-verifier status              # Read /health/state from coordinator\n`);
      process.stderr.write(`  health-verifier report [--json]     # Read /health/state from coordinator\n`);
      process.exit(1);
  }
});

export default HealthVerifier;
export { postSignal };
