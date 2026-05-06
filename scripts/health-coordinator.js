/**
 * Health Coordinator — Phase 33 single-owner SoT for system health.
 *
 * Owns:
 *   - In-memory health state (the canonical SoT; see /health/state shape).
 *   - HTTP endpoints: GET /health, GET /health/state, POST /signals, POST /health/refresh.
 *   - 5s tick scheduler (registered in plan 33-03; this skeleton creates the timer hook only).
 *   - Per-session LSL tracking with 15s staleness threshold and 5min eviction (D-10).
 *
 * Replaces the four legacy daemons:
 *   - system-monitor-watchdog.js
 *   - global-process-supervisor.js
 *   - global-service-coordinator.js
 *   - global-lsl-coordinator.js
 *
 * Pattern source: scripts/observations-api-server.mjs (single-owner HTTP gateway).
 * Bind: 0.0.0.0 (Linux Docker host-gateway requires this; loopback enforcement is at the
 * network layer per RESEARCH §3 — same reason obs-api binds 0.0.0.0).
 *
 * @module scripts/health-coordinator
 */

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runIfMain } from '../lib/utils/esm-cli.js';
import { createRotatingLogger } from '../lib/utils/log-rotator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.HEALTH_COORDINATOR_PORT || '3034', 10);
const TICK_MS = parseInt(process.env.HEALTH_COORDINATOR_TICK_MS || '5000', 10);
const STARTED_AT = Date.now();
const LOG_PATH = path.join(REPO_ROOT, '.logs', 'health-coordinator.log');

// Heartbeat staleness threshold (D-10): >15s without a heartbeat → status: 'stopped'
const HEARTBEAT_STALENESS_MS = 15_000;
// Eviction window after entering 'stopped' (D-10): drop after 5 min in stopped
const EVICT_AFTER_STOPPED_MS = 5 * 60 * 1000;

// Test-only injection hook (RESEARCH §10, used by injection.test.sh).
// When set, the named check throws on next tick. Coordinator surfaces 'unknown',
// never 'healthy' (SPEC R6). Comma-separated list of check names.
const INJECT_THROW = (process.env.HEALTH_COORDINATOR_INJECT_THROW || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// Ensure .logs/ exists (matches obs-api pattern).
try { fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true }); } catch { /* race-safe */ }
const log = createRotatingLogger({ logPath: LOG_PATH, prefix: 'HealthCoordinator' });

/**
 * In-memory canonical SoT. Single writer = this process; readers fetch via HTTP.
 *
 * Per SPEC AC #3, /health/state MUST contain top-level keys:
 *   container, services, lsl, lsl_by_project, processes, generated_at, coordinator_uptime_s
 *
 * `databases` is an additional top-level slot used by the injection test path
 * (HEALTH_COORDINATOR_INJECT_THROW=db_health → databases.status = 'unknown').
 *
 * @type {{
 *   container: { healthcheck: string, last_probe_end: string | null },
 *   services:  Array<{ name: string, status: string, last_seen: number | null }>,
 *   lsl: Record<string, {
 *     status: string,
 *     lastBeat: number,
 *     stoppedAt?: number,
 *     projectPath: string,
 *     projectName?: string,
 *     transcriptPath?: string,
 *     agent?: string,
 *     source?: string
 *   }>,
 *   lsl_by_project: Record<string, string>,
 *   processes: Array<{ name: string, pid: number | null, status: string }>,
 *   databases: { status: string },
 *   generated_at: string,
 *   coordinator_uptime_s: number
 * }}
 */
const currentState = {
  container: { healthcheck: 'unknown', last_probe_end: null },
  services: [],
  lsl: {},
  lsl_by_project: {},
  processes: [],
  databases: { status: 'unknown' },
  generated_at: new Date(STARTED_AT).toISOString(),
  coordinator_uptime_s: 0
};

/**
 * Apply a heartbeat / status signal to the in-memory state.
 *
 * Plan 33-02 (skeleton) accepts three discriminator kinds:
 *   - 'lsl_heartbeat'  — per-session LSL beat (D-09 + D-10)
 *   - 'service_status' — generic service heartbeat (registry filled in 33-03)
 *   - 'db_health'      — DB-health rollup
 *
 * Unknown kinds are tolerated at this stage (logged as WARN); plan 33-03 tightens
 * the schema once the full check registry lands.
 *
 * @param {{ kind: string, session_id?: string, source?: string, status?: string, payload?: any, ts?: number }} signal
 */
function ingestSignal(signal) {
  if (!signal || typeof signal !== 'object') {
    throw new Error('signal body must be an object');
  }
  if (typeof signal.kind !== 'string' || signal.kind.length === 0) {
    throw new Error('signal requires a string `kind`');
  }
  const ts = typeof signal.ts === 'number' ? signal.ts : Date.now();
  switch (signal.kind) {
    case 'lsl_heartbeat': {
      if (!signal.session_id) throw new Error('lsl_heartbeat requires session_id');
      const sid = String(signal.session_id);
      const projectPath = signal.payload?.projectPath || 'unknown';
      const projectName = path.basename(projectPath);
      const status = signal.status === 'stopped' ? 'stopped' : 'running';
      currentState.lsl[sid] = {
        status,
        lastBeat: ts,
        ...(status === 'stopped' ? { stoppedAt: ts } : {}),
        projectPath,
        projectName,
        transcriptPath: signal.payload?.transcriptPath,
        agent: signal.payload?.agent,
        source: signal.source
      };
      break;
    }
    case 'service_status': {
      // Plan 33-03 fills in the full service registry; skeleton accepts and stores
      // by source name so observability is available immediately.
      if (!signal.source) throw new Error('service_status requires source');
      const idx = currentState.services.findIndex(s => s.name === signal.source);
      const entry = {
        name: signal.source,
        status: signal.status || 'unknown',
        last_seen: ts
      };
      if (idx >= 0) currentState.services[idx] = entry;
      else currentState.services.push(entry);
      break;
    }
    case 'db_health': {
      currentState.databases = { status: signal.status || 'unknown' };
      break;
    }
    default:
      // Tolerant: accept unknown kinds in the skeleton stage; later plans tighten.
      log(`ingestSignal: unknown kind '${signal.kind}'`, 'WARN');
  }
}

/**
 * Refresh per-session LSL state staleness / eviction (D-10).
 * Called at every tick:
 *   - running session with heartbeat older than HEARTBEAT_STALENESS_MS → status='stopped'
 *   - stopped session older than EVICT_AFTER_STOPPED_MS → removed
 *   - lsl_by_project rollup recomputed
 */
function refreshLslStaleness() {
  const now = Date.now();
  for (const [sid, entry] of Object.entries(currentState.lsl)) {
    const age = now - entry.lastBeat;
    if (entry.status === 'running' && age > HEARTBEAT_STALENESS_MS) {
      entry.status = 'stopped';
      entry.stoppedAt = now;
    }
    if (
      entry.status === 'stopped' &&
      entry.stoppedAt &&
      (now - entry.stoppedAt) > EVICT_AFTER_STOPPED_MS
    ) {
      delete currentState.lsl[sid];
    }
  }
  // Recompute project rollup: a project is healthy iff ≥1 running session under that project.
  const rollup = {};
  for (const entry of Object.values(currentState.lsl)) {
    const name = entry.projectName || 'unknown';
    if (entry.status === 'running') {
      rollup[name] = 'healthy';
    } else if (!(name in rollup)) {
      rollup[name] = 'degraded';
    }
  }
  currentState.lsl_by_project = rollup;
}

/**
 * The 5s tick. Plan 33-03 fills in the check registry; this skeleton runs the
 * staleness pass and updates the timestamp.
 *
 * SPEC R6: a check that throws MUST surface as 'unknown', never 'healthy'.
 * Per-check error handling lives in the check registry (plan 33-03); the outer
 * tick boundary here only logs the error and refreshes the timestamp — the
 * relevant slice keeps its last value (initialised to 'unknown').
 */
async function tick() {
  try {
    if (INJECT_THROW.includes('tick')) {
      throw new Error('forced (HEALTH_COORDINATOR_INJECT_THROW=tick)');
    }
    refreshLslStaleness();
    // Plan 33-03 inserts: docker healthcheck poll, service liveness checks, rules iteration.
    currentState.generated_at = new Date().toISOString();
    currentState.coordinator_uptime_s = Math.floor((Date.now() - STARTED_AT) / 1000);
  } catch (err) {
    log(`tick failed: ${err.message}`, 'ERROR');
    // SPEC R6: do NOT silently mark healthy. The relevant slice remains at its
    // last value; the per-check error path in plan 33-03 surfaces 'unknown'.
    // Never overwrite to 'healthy' on error.
  }
}

let tickTimer = null;
function startTickLoop() {
  tickTimer = setInterval(() => { tick(); }, TICK_MS);
  // Run once immediately so /health/state returns a fresh generated_at right away.
  tick();
}
function stopTickLoop() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

/**
 * Out-of-band immediate poll. Used by the dashboard's "Run Verification" button (D-04).
 */
async function forceTick() {
  await tick();
}

// ============================================
// HTTP server
// ============================================
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', port: PORT, role: 'health-coordinator' });
});

app.get('/health/state', (_req, res) => {
  // Mutate uptime on read so /health/state always shows fresh wall-clock uptime
  // even between ticks. generated_at is owned by the tick.
  currentState.coordinator_uptime_s = Math.floor((Date.now() - STARTED_AT) / 1000);
  res.json(currentState);
});

app.post('/signals', (req, res) => {
  try {
    ingestSignal(req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/health/refresh', async (_req, res) => {
  try {
    await forceTick();
    res.json(currentState);
  } catch (err) {
    // SPEC R6: surface failure, never mask as healthy.
    res.status(500).json({ ok: false, error: err.message });
  }
});

// RESEARCH §3: bind 0.0.0.0 (not 127.0.0.1) so Linux Docker containers reaching
// via host-gateway can connect — same reason obs-api binds 0.0.0.0. Localhost
// scoping is enforced at the network layer (Docker Desktop loopback / firewall),
// not at the listen address.
const server = app.listen(PORT, '0.0.0.0', () => {
  log(`listening on http://0.0.0.0:${PORT}`);
  process.stderr.write(`[HealthCoordinator] listening on http://0.0.0.0:${PORT}\n`);
  startTickLoop();
});

// RESEARCH §1 + §9 pitfall: EADDRINUSE on launchd respawn. Exit non-zero with
// a diagnosable stderr message so launchd's StandardErrorPath is useful.
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    process.stderr.write(`[HealthCoordinator] FATAL: port ${PORT} already in use (EADDRINUSE)\n`);
    log(`FATAL: port ${PORT} already in use (EADDRINUSE)`, 'ERROR');
    process.exit(1);
  }
  process.stderr.write(`[HealthCoordinator] server error: ${err.message}\n`);
  log(`server error: ${err.message}`, 'ERROR');
  process.exit(1);
});

/**
 * Graceful shutdown — mirrors obs-api shutdown pattern (5s force-exit ceiling).
 * The coordinator has no DB or in-flight LLM work to drain, so the timeout is
 * tighter than obs-api's 25s.
 *
 * @param {string} signal
 */
async function shutdown(signal) {
  log(`${signal} — shutting down`, 'INFO');
  process.stderr.write(`[HealthCoordinator] ${signal} — shutting down\n`);
  stopTickLoop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

runIfMain(import.meta.url, () => {
  /* server already started above on import; runIfMain is a no-op here but
   * preserves the project's CLI-entry convention (lib/utils/esm-cli.js). */
});

// Exported for unit-testability in plan 33-03 and beyond.
export { currentState, ingestSignal, refreshLslStaleness, forceTick, tick };
