#!/usr/bin/env node

/**
 * StatusLine Health Monitor — Reader + Reporter Hybrid (Phase 33)
 *
 * Reduced from a self-healing daemon to a thin reader+reporter that:
 *  - GETs /health/state from the coordinator (every 2s — SPEC Constraints)
 *  - Writes the tmux statusline cache file from the coordinator's view
 *  - POSTs a service_status heartbeat so the coordinator knows we're alive
 *  - SPEC R6: writes 'unknown' (not 'healthy') on coordinator-unreachable
 *
 * Phase 33 deletions (per plan 33-04):
 *  - heal-arm CLI flag and all heal-action invocations
 *  - Inline 10MB log block — extracted to lib/utils/log-rotator.js
 *  - global-coding-monitor probe (calls a now-deleted host daemon)
 *  - transcript-monitor scan (replaced by /health/state.lsl_by_project)
 *  - centralized health-file path utility + any .health/*.json reads
 *  - All in-process aggregation (database, VKB, dashboard, MCP probes) —
 *    coordinator owns the SoT now; this daemon is a pure projection of it.
 *
 * Preserved:
 *  - --daemon CLI flag
 *  - Cache file path (.logs/statusline-health-status.txt) — file SHAPE may
 *    change per SPEC Boundaries (cache format NOT a backward-compat commitment).
 *  - runIfMain entry point
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runIfMain } from '../lib/utils/esm-cli.js';
import { createRotatingLogger } from '../lib/utils/log-rotator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Phase 33 D-02: single env var for coordinator endpoint discovery.
const COORDINATOR = process.env.HEALTH_COORDINATOR_URL || 'http://localhost:3034';

/**
 * POST a heartbeat / service_status signal to the coordinator.
 * Failure is logged but never thrown — the GET /health/state path is the
 * authoritative read; the POST is just liveness telemetry.
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
    process.stderr.write(`[StatuslineHealthMonitor] signal POST failed: ${err.message}\n`);
  }
}

class StatusLineHealthMonitor {
  constructor(options = {}) {
    this.codingRepoPath = options.codingRepoPath || path.resolve(__dirname, '..');
    // SPEC Constraints: prompt-hook + statusline cache TTL fixed at 2s.
    this.updateInterval = options.updateInterval || 2000;
    this.isDebug = options.debug || false;

    this.logPath = path.join(this.codingRepoPath, '.logs', 'statusline-health.log');
    this.cachePath = path.join(this.codingRepoPath, '.logs', 'statusline-health-status.txt');

    this.lastStatus = null;
    this.updateTimer = null;

    this.ensureLogDirectory();
    this.log = createRotatingLogger({
      logPath: this.logPath,
      prefix: 'StatusLineHealth',
      debug: this.isDebug
    });
  }

  ensureLogDirectory() {
    const logDir = path.dirname(this.logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  /**
   * Build a small statusline summary from /health/state.
   * SPEC Boundaries: cache file format NOT preserved — free to rewrite.
   */
  deriveStatuslineFromState(state) {
    const container = state.container?.healthcheck?.status || state.container?.healthcheck || 'unknown';
    const dbStatus = state.databases?.status || 'unknown';
    const lslByProject = state.lsl_by_project || {};
    const projectsHealthy = Object.values(lslByProject).filter(s => s === 'healthy').length;
    const projectsTotal = Object.keys(lslByProject).length;

    const containerIcon = container === 'healthy' ? '✅' : container === 'unhealthy' ? '❌' : '❓';
    const dbIcon = dbStatus === 'healthy' ? '✅' : dbStatus === 'degraded' ? '⚠️' : '❓';

    return {
      state: 'live',
      line: `[Container:${containerIcon}] [DB:${dbIcon}] [LSL:${projectsHealthy}/${projectsTotal}]`,
      generated_at: state.generated_at || new Date().toISOString(),
      coordinator_uptime_s: state.coordinator_uptime_s
    };
  }

  /**
   * Atomic-rename write of the cache file so consumers always see a complete
   * snapshot. Cache file shape may freely change (SPEC Boundaries).
   */
  writeCache(payload) {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const tmp = this.cachePath + '.tmp.' + process.pid;
    try {
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, this.cachePath);
      if (typeof payload === 'object' && payload && payload.line !== this.lastStatus) {
        this.lastStatus = payload.line;
        this.log(`Status updated: ${payload.line}`);
      }
    } catch (err) {
      this.log(`Failed to write cache: ${err.message}`, 'ERROR');
    }
  }

  /**
   * Reader half: GET /health/state, derive statusline, write cache.
   * SPEC R6: NEVER 'healthy' on exception — write an 'unknown' marker so
   * the tmux statusline shows a grey badge, not green.
   */
  async pollAndCache() {
    try {
      const r = await fetch(`${COORDINATOR}/health/state`);
      if (!r.ok) {
        this.writeCache({ state: 'unknown', reason: `coordinator HTTP ${r.status}` });
        return;
      }
      const state = await r.json();
      this.writeCache(this.deriveStatuslineFromState(state));
    } catch (err) {
      this.writeCache({ state: 'unknown', reason: 'coordinator unreachable', error: err.message });
    }
  }

  /**
   * Reporter half: POST a service_status heartbeat so the coordinator
   * knows the statusline daemon is alive.
   */
  async postHeartbeat() {
    await postSignal({
      kind: 'service_status',
      source: 'statusline-health-monitor',
      status: 'running',
      ts: Date.now()
    });
  }

  /**
   * One pull-and-push tick: read /health/state, write cache, POST heartbeat.
   */
  async updateStatusLine() {
    await this.pollAndCache();
    await this.postHeartbeat();
  }

  /**
   * Daemon mode: poll every 2s.
   */
  async start() {
    this.log('StatusLineHealthMonitor starting (reader+reporter mode)');
    await this.updateStatusLine();
    this.updateTimer = setInterval(() => {
      this.updateStatusLine().catch(err => this.log(`tick error: ${err.message}`, 'ERROR'));
    }, this.updateInterval);
  }

  stop() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  async gracefulShutdown() {
    this.log('Shutting down StatusLineHealthMonitor');
    this.stop();
    process.exit(0);
  }
}

// CLI interface — Phase 33 reduced surface.
async function main() {
  const args = process.argv.slice(2);
  const isDebug = args.includes('--debug');
  const isDaemon = args.includes('--daemon');

  if (args.includes('--help')) {
    process.stdout.write(`
StatusLine Health Monitor (Phase 33 reader+reporter)

Usage:
  node statusline-health-monitor.js [--daemon] [--debug] [--help]

Options:
  --daemon      Run in daemon mode (poll /health/state every 2s)
  --debug       Enable debug output
  --help        Show this help

The monitor reads health from the coordinator at:
  ${COORDINATOR}/health/state

And writes the tmux statusline cache to:
  .logs/statusline-health-status.txt

Heartbeat (kind=service_status, source=statusline-health-monitor) is POSTed
to the coordinator on every tick so the SoT knows this daemon is alive.
`);
    process.exit(0);
  }

  const monitor = new StatusLineHealthMonitor({ debug: isDebug });

  process.on('SIGTERM', () => monitor.gracefulShutdown());
  process.on('SIGINT', () => monitor.gracefulShutdown());

  if (isDaemon) {
    await monitor.start();
  } else {
    await monitor.updateStatusLine();
    process.stdout.write(`Status: ${monitor.lastStatus || '(unknown)'}\n`);
  }
}

runIfMain(import.meta.url, () => {
  main().catch(err => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  });
});

export default StatusLineHealthMonitor;
export { postSignal };
