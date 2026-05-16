/**
 * Health Coordinator — Phase 33 single-owner SoT for system health.
 *
 * Owns:
 *   - In-memory health state (the canonical SoT; see /health/state shape).
 *   - HTTP endpoints: GET /health, GET /health/state, POST /signals, POST /health/refresh.
 *   - 5s tick scheduler that runs the full check registry: docker .State.Health.Status
 *     passthrough (R7), PSM-backed db_health + service liveness, LSL staleness pass,
 *     and per-rule iteration over all four categories (databases/services/processes/files)
 *     in `config/health-verification-rules.json` (D-05). Per-check error isolation: a
 *     throwing check tags its slice as 'unknown' — never 'healthy' (SPEC R6).
 *   - Per-session LSL tracking with 15s staleness threshold and 5min eviction (D-10).
 *
 * Replaces the four legacy host daemons (deleted in plan 33-07):
 *   - the system watchdog (legacy launchd: com.coding.system-watchdog)
 *   - the per-session process supervisor
 *   - the global service coordinator
 *   - the per-project LSL coordinator
 *
 * Defense-in-depth: the rules `bind_mount_freshness` (D-06) and `supervisord_status`
 * (D-08) are SKIPPED with a WARN log even if config still contains them — plan 33-06
 * deletes them from config; coordinator must not process them in any plan ordering.
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
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runIfMain } from '../lib/utils/esm-cli.js';
import { createRotatingLogger } from '../lib/utils/log-rotator.js';
import { probeHttpHealth, probeTcpPort } from '../lib/utils/service-probe.js';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import os from 'node:os';
import ProcessStateManager from './process-state-manager.js';
import { getTimeWindow, utcToLocalTime } from './timezone-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.HEALTH_COORDINATOR_PORT || '3034', 10);
const TICK_MS = parseInt(process.env.HEALTH_COORDINATOR_TICK_MS || '5000', 10);
const STARTED_AT = Date.now();
const LOG_PATH = path.join(REPO_ROOT, '.logs', 'health-coordinator.log');
const RULES_PATH = path.join(REPO_ROOT, 'config', 'health-verification-rules.json');
const DOCKER_INSPECT_TIMEOUT_MS = 5_000;

// Rules whose presence is an error per Phase 33 design (D-06, D-08).
// Defense-in-depth: even if config still contains them (plan 33-06 deletes them),
// the coordinator MUST NOT process them. Per SPEC R5 (narrow heals only) and
// R7 (Docker owns container health) + D-08 (drop container-process supervision).
const FORBIDDEN_RULE_NAMES = new Set(['bind_mount_freshness', 'supervisord_status']);

// Heartbeat staleness threshold (D-10): >15s without a heartbeat → status: 'stopped'
const HEARTBEAT_STALENESS_MS = 15_000;
// Eviction window after entering 'stopped' (D-10): drop after 5 min in stopped
const EVICT_AFTER_STOPPED_MS = 5 * 60 * 1000;

// Phase 36-01: cache session_duration once at module init. timezone-utils'
// getTimeWindow() re-reads config/live-logging-config.json on EVERY call — at
// 5s tick × 24h = 17 280 reads/day. This cached value is used as a fallback
// when getTimeWindow throws AND is wired as a future hand-off for any consumer
// that needs the value without paying the per-call I/O cost. The standalone
// callers of getTimeWindow (statusline, LSL filename generation) are
// unchanged — per CLAUDE.md "Never modify working APIs for TypeScript
// compliance; fix types instead" we don't touch timezone-utils.js.
// Default: 60 min = 3 600 000 ms. Matches config/live-logging-config.json.
let LSL_SESSION_DURATION_MS = 3_600_000;
try {
  const _lslConfigPath = path.join(
    process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || REPO_ROOT,
    'config',
    'live-logging-config.json'
  );
  const _lslConfig = JSON.parse(fs.readFileSync(_lslConfigPath, 'utf8'));
  if (_lslConfig?.live_logging?.session_duration) {
    LSL_SESSION_DURATION_MS = _lslConfig.live_logging.session_duration;
  }
} catch (_err) {
  // Keep default; bootstrap log not yet available at this point in module init.
}

// Test-only injection hook (RESEARCH §10, used by injection.test.sh).
// When set, the named check throws on next tick. Coordinator surfaces 'unknown',
// never 'healthy' (SPEC R6). Comma-separated list of check names.
//
// LEGACY: process.env.HEALTH_COORDINATOR_INJECT_THROW set via launchctl setenv.
// Phase 33-12 empirically falsified launchd's plist-vs-domain env precedence —
// `launchctl setenv` does NOT override plist-declared empty defaults on macOS
// Sequoia (Darwin 25.4.0). See 33-12-SUMMARY for the 3 independent reproductions.
// The env-var path is kept for backward compat / dev-time use, but production
// AC#13 testing now goes through POST /test/inject (loopback-gated).
const INJECT_THROW = (process.env.HEALTH_COORDINATOR_INJECT_THROW || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// Phase 33-15: in-memory injection flags for AC#13 (replaces 33-12's plist
// propagation approach which was falsified empirically — see 33-12-SUMMARY).
// POST /test/inject sets these; POST /test/reset clears them. Loopback only.
// Keys are check kinds: 'db_health' | 'docker_health' | 'container' (alias for
// docker_health) | 'lsl' | 'services' | 'tick' | `services.${name}`.
// Values are modes: 'throw' (raise) | 'fail' (return degraded result).
const injectionFlags = new Map();

/**
 * Unified injection-flag lookup. Honors BOTH the in-memory flag map (set by
 * POST /test/inject — preferred AC#13 path) AND the legacy env var (kept for
 * backward compat / dev-time use). Either path triggers the injection.
 *
 * Returns the mode ('throw' | 'fail') if active for the kind, otherwise null.
 *
 * Kind aliases:
 *   - 'container' → 'docker_health' (SPEC R7 names .container.healthcheck;
 *     the existing INJECT_THROW kind is docker_health). A POST /test/inject
 *     with kind='container' lights up the docker_health check site as well.
 *
 * @param {string} kind - Check kind to query.
 * @returns {string|null} Mode if active, else null.
 */
function shouldInject(kind) {
  // In-memory flag wins (newer + per-process; no env propagation issues).
  const memMode = injectionFlags.get(kind);
  if (memMode) return memMode;
  // 'container' ↔ 'docker_health' alias: if either is set in memory, the
  // docker_health check site fires (and vice versa for callers querying
  // 'container' directly — though no production caller does this today).
  if (kind === 'docker_health' && injectionFlags.has('container')) {
    return injectionFlags.get('container');
  }
  if (kind === 'container' && injectionFlags.has('docker_health')) {
    return injectionFlags.get('docker_health');
  }
  // Legacy env-var path: comma-separated list of kinds, mode is always 'throw'.
  if (INJECT_THROW.includes(kind)) return 'throw';
  // Honor the alias for the env-var path too.
  if (kind === 'docker_health' && INJECT_THROW.includes('container')) return 'throw';
  if (kind === 'container' && INJECT_THROW.includes('docker_health')) return 'throw';
  return null;
}

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
  // Phase 36-01: canonical LSL time-window for the current poll tick (HHMM-HHMM,
  // e.g. '0900-1000'). Published so future consumers (LLM proxy / dashboard /
  // statusline) can drop their per-call getTimeWindow() reads in favour of a
  // single canonical source. Wave 1 is observation-only — existing consumers
  // continue local computation (see CONTEXT.md "Out of scope"). Reads 'unknown'
  // on any compute error (SPEC R6 — never substitute synthetic 'healthy').
  // Top-level sibling of `lsl` and `lsl_by_project` to avoid colliding with the
  // sid:project keys inside `lsl` (PATTERNS.md Section 1 anomaly).
  lsl_meta: { current_window: 'unknown' },
  processes: [],
  databases: { status: 'unknown' },
  files: [],
  // Observation/digest/insight pipeline freshness — drives the [📚] statusline
  // badge. Replaces the legacy `knowledgeExtraction` field that was read from
  // a per-project health file the ETM stopped writing at the Phase 33 cutover.
  // Status: 'unknown' before first probe · 'healthy' / 'stale' / 'stalled' /
  // 'unreachable' / 'disabled' after.
  knowledge_pipeline: {
    status: 'unknown',
    lastObservationAt: null,
    lastDigestAt: null,
    lastInsightAt: null,
    totals: null,
    last_probe_end: null
  },
  // Proxy semantic-readiness — drives the [🧠] statusline badge (Plan 34-05)
  // and the dashboard proxy-health card (Plan 34-05). semantic_ok=true only
  // after a successful POST /api/complete round-trip with content containing
  // "OK". networkMode mirrors the proxy's published value (vpn|public|unknown).
  // auto_heal_status follows D-06 cooldown FSM (wired in Plan 34-03).
  proxy: {
    semantic_ok: null,                   // null until first probe; true|false after
    last_round_trip_ms: null,            // int, last completion latency
    networkMode: 'unknown',              // 'vpn' | 'corporate' | 'public' | 'unknown'
    auto_heal_status: 'healthy',         // 'healthy'|'kickstart_pending'|'cooldown'|'disabled' (Plan 34-03 transitions)
    kickstart_count: 0,                  // running counter since coordinator boot (D-14 soak gate)
    kickstart_timestamps: [],            // sliding window for D-06 cooldown FSM
    consecutive_failures: 0,             // resets on success
    last_probe_end: null,                // ISO timestamp of last semantic probe completion
    reason: null                         // last failure classification: 'http_<code>'|'timeout'|'empty_content'|'oksub_missing'|null
  },
  // Network environment detection — single source of truth for CN/VPN/home
  // and local proxy (px/proxydetox) status. Polled every 30s.
  // Consumers: LLM proxy, statusline, dashboard.
  network: {
    location: 'unknown',                 // 'corporate' | 'vpn' | 'home' | 'unknown'
    proxy_running: false,                // true if px/proxydetox listening on 127.0.0.1:3128
    proxy_functional: false,             // true if proxy can actually reach external hosts
    internet_reachable: false,           // true if we can reach github.com (directly or via proxy)
    last_probe_end: null                 // ISO timestamp
  },
  generated_at: new Date(STARTED_AT).toISOString(),
  coordinator_uptime_s: 0
};

/**
 * Load the rules file. Schema preserved per SPEC R8.
 * @returns {object|null} Rules object, or null with logged warning if missing/malformed.
 */
function loadRules() {
  try {
    const raw = fs.readFileSync(RULES_PATH, 'utf8');
    const rules = JSON.parse(raw);
    if (!rules.rules || typeof rules.rules !== 'object') {
      log(`rules file missing top-level "rules" object`, 'ERROR');
      return null;
    }
    return rules;
  } catch (err) {
    log(`failed to load ${RULES_PATH}: ${err.message}`, 'ERROR');
    return null;
  }
}

let RULES = loadRules();

/**
 * Iterate over each enabled rule in a category. Per-rule errors are caught and
 * logged so one throwing rule cannot poison the rest of the category iteration.
 * SPEC R6: outer catch logs only — the inner check function tags its own slice
 * with 'unknown' (never 'healthy') on failure.
 *
 * @param {string} category - 'databases' | 'services' | 'processes' | 'files'
 * @param {(name: string, rule: object) => Promise<void>} fn
 */
async function forEachEnabledRule(category, fn) {
  if (!RULES?.rules?.[category]) return;
  for (const [name, rule] of Object.entries(RULES.rules[category])) {
    if (FORBIDDEN_RULE_NAMES.has(name)) {
      log(`skipping forbidden rule '${name}' (Phase 33 D-06/D-08)`, 'WARN');
      continue;
    }
    if (!rule || rule.enabled === false) continue;
    try {
      await fn(name, rule);
    } catch (err) {
      log(`check '${category}.${name}' threw: ${err.message}`, 'ERROR');
    }
  }
}

// PSM instance — single coordinator-owned manager (matches CONTEXT "Reusable Assets").
// PSM exposes: registerService, isProcessAlive, checkDatabaseHealth, getHealthStatus.
const psm = new ProcessStateManager({ codingRoot: REPO_ROOT });
let psmReady = false;
psm.initialize().then(() => { psmReady = true; }).catch(err => {
  log(`PSM init failed: ${err.message}`, 'ERROR');
});

/**
 * Read Docker container healthcheck status (SPEC R7). Surfaces Docker's own
 * answer verbatim. Never substitutes 'healthy' on error.
 *
 * Equivalent shell command:
 *   docker inspect coding-services --format '{{.State.Health.Status}}'
 *
 * @returns {{ healthcheck: string, last_probe_end: string | null }}
 */
function pollDockerHealth() {
  const mode = shouldInject('docker_health');
  if (mode === 'throw') {
    throw new Error('forced (shouldInject docker_health=throw)');
  }
  if (mode === 'fail') {
    return { healthcheck: 'unknown', last_probe_end: null };
  }
  try {
    const result = spawnSync('docker',
      ['inspect', 'coding-services', '--format', '{{.State.Health.Status}}'],
      { encoding: 'utf8', timeout: DOCKER_INSPECT_TIMEOUT_MS }
    );
    if (result.status !== 0) {
      // Docker daemon down or container not found / no healthcheck declared
      return { healthcheck: 'unknown', last_probe_end: null };
    }
    const healthcheck = (result.stdout || '').trim() || 'none';
    return { healthcheck, last_probe_end: new Date().toISOString() };
  } catch (err) {
    log(`docker inspect failed: ${err.message}`, 'ERROR');
    return { healthcheck: 'unknown', last_probe_end: null };
  }
}

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
      // Compound key: many ETMs can share a CLAUDE_SESSION_ID inherited from a
      // parent shell while watching different projects. Keying by sid alone
      // collapses them into one last-writer-wins entry; compound key gives
      // each (session, project) pair its own slot so all projects surface in
      // the rollup and the per-pane lookup can pick the right one.
      const key = `${sid}:${projectName}`;
      currentState.lsl[key] = {
        status,
        lastBeat: ts,
        ...(status === 'stopped' ? { stoppedAt: ts } : {}),
        sessionId: sid,
        projectPath,
        projectName,
        transcriptPath: signal.payload?.transcriptPath,
        tmuxPane: signal.payload?.tmux_pane || null,
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
    case 'verify_run': {
      // Phase 33 plan 33-04: health-verifier-cli POSTs a verify_run summary
      // signal after a one-shot verify. We surface it as a service entry so
      // the SoT records that the verifier ran and what its overall status was.
      if (!signal.source) throw new Error('verify_run requires source');
      const idx = currentState.services.findIndex(s => s.name === signal.source);
      const entry = {
        name: signal.source,
        status: signal.status || 'unknown',
        last_seen: ts,
        last_run: ts,
        violations: signal.payload?.summary?.violations
      };
      if (idx >= 0) currentState.services[idx] = entry;
      else currentState.services.push(entry);
      break;
    }
    default:
      // Tolerant: accept unknown kinds in the skeleton stage; later plans tighten.
      log(`ingestSignal: unknown kind '${signal.kind}'`, 'WARN');
  }
}

// Knowledge pipeline freshness probe. Hits obs_api's
// /api/consolidation/status to read the latest observation/digest/insight
// timestamps + totals. Replaces the [📚] indicator's legacy data source
// (per-project ETM health file that stopped being written at Phase 33).
//
// Health verdict (driven by observation freshness only — digests and insights
// run on slower async cadences and would falsely downgrade the badge if they
// gated it):
//   'healthy'      — observation written within OBS_FRESH_MS
//   'stale'        — last observation between OBS_FRESH_MS and OBS_STALL_MS
//                    (likely just idle — no active Claude session right now)
//   'stalled'      — last observation older than OBS_STALL_MS (pipeline dead)
//   'unreachable'  — obs_api unreachable / non-OK / parse error
//   'disabled'     — obs_api reachable but no rows in any table yet
const OBS_API_URL = process.env.OBS_API_URL || 'http://localhost:12436';
const OBS_FRESH_MS = 15 * 60 * 1000;     // 15 min — counts as fresh
const OBS_STALL_MS = 6 * 60 * 60 * 1000; // 6 h — considered stalled

// obs_api auto-heal — restart when unreachable for 2+ consecutive probes (~10s).
// Simpler than the proxy FSM: no sliding window, just a consecutive-failure gate
// with a max-restart cap to avoid infinite restart loops.
const OBS_API_MAX_RESTARTS = 3;           // max restarts before cooldown
const OBS_API_COOLDOWN_MS = 10 * 60_000;  // 10 min cooldown after max restarts
let obsApiConsecutiveFailures = 0;
let obsApiRestartCount = 0;
let obsApiLastRestartAt = 0;

// ----- Proxy supervision constants (Phase 34 D-01 / D-02 / D-06) -----
const PROXY_URL = process.env.LLM_PROXY_URL || 'http://localhost:12435';
const PROXY_PROBE_INTERVAL_MS = 60_000;          // D-01: every 60s
const PROXY_PROBE_TIMEOUT_MS = 10_000;            // D-02: 10s round-trip threshold
const PROXY_MODE_POLL_TIMEOUT_MS = 2_000;         // GET /health is fast; 2s budget
const PROXY_KICKSTART_WINDOW_MS = 5 * 60_000;     // D-06: 5 min sliding window
const PROXY_KICKSTART_MAX = 3;                    // D-06: 3 kickstarts then cooldown

async function pollKnowledgePipeline() {
  const probeEndedAt = () => new Date().toISOString();
  let body;
  try {
    const r = await fetch(`${OBS_API_URL}/api/consolidation/status`, {
      signal: AbortSignal.timeout(2_000)
    });
    if (!r.ok) {
      currentState.knowledge_pipeline = {
        status: 'unreachable',
        reason: `HTTP ${r.status}`,
        lastObservationAt: null,
        lastDigestAt: null,
        lastInsightAt: null,
        totals: null,
        last_probe_end: probeEndedAt()
      };
      return;
    }
    body = await r.json();
  } catch (err) {
    currentState.knowledge_pipeline = {
      status: 'unreachable',
      reason: err.message,
      lastObservationAt: null,
      lastDigestAt: null,
      lastInsightAt: null,
      totals: null,
      last_probe_end: probeEndedAt()
    };
    return;
  }

  const now = Date.now();
  const ageMs = (iso) => (iso ? now - new Date(iso).getTime() : null);
  const obsAge = ageMs(body.lastObservationAt);
  const digAge = ageMs(body.lastDigestAt);
  const insAge = ageMs(body.lastInsightAt);

  let status;
  if (body.totalObs === 0 && body.totalDigests === 0 && body.totalInsights === 0) {
    status = 'disabled';
  } else if (obsAge === null) {
    // No observation rows yet — treat as stale, not stalled.
    status = 'stale';
  } else if (obsAge > OBS_STALL_MS) {
    status = 'stalled';
  } else if (obsAge > OBS_FRESH_MS) {
    status = 'stale';
  } else {
    status = 'healthy';
  }

  currentState.knowledge_pipeline = {
    status,
    lastObservationAt: body.lastObservationAt,
    lastDigestAt: body.lastDigestAt,
    lastInsightAt: body.lastInsightAt,
    obsAgeMs: obsAge,
    digAgeMs: digAge,
    insAgeMs: insAge,
    totals: {
      observations: body.totalObs,
      digests: body.totalDigests,
      insights: body.totalInsights,
      undigested: body.undigested,
      pendingPast: body.pendingPast,
      pendingToday: body.pendingToday
    },
    inflight: body.inflight,
    last_probe_end: probeEndedAt()
  };
  evaluateObsApiAutoHeal();
}

/**
 * obs_api auto-heal FSM — restart obs_api when unreachable.
 * Called at the end of pollKnowledgePipeline.
 */
function evaluateObsApiAutoHeal() {
  const rule = RULES?.rules?.services?.obs_api;
  if (!rule || rule.auto_heal !== true) return;

  const status = currentState.knowledge_pipeline?.status;
  if (status !== 'unreachable') {
    if (obsApiConsecutiveFailures > 0) {
      log(`obs_api auto-heal -> healthy (recovered after ${obsApiConsecutiveFailures} failures, ${obsApiRestartCount} restarts)`, 'INFO');
    }
    obsApiConsecutiveFailures = 0;
    return;
  }

  obsApiConsecutiveFailures++;

  // Cooldown: too many restarts recently
  const now = Date.now();
  if (obsApiRestartCount >= OBS_API_MAX_RESTARTS && (now - obsApiLastRestartAt) < OBS_API_COOLDOWN_MS) {
    log(`obs_api auto-heal cooldown — ${obsApiRestartCount} restarts, waiting ${Math.round((OBS_API_COOLDOWN_MS - (now - obsApiLastRestartAt)) / 1000)}s`, 'WARN');
    return;
  }
  // Reset counter after cooldown window
  if (obsApiRestartCount >= OBS_API_MAX_RESTARTS && (now - obsApiLastRestartAt) >= OBS_API_COOLDOWN_MS) {
    obsApiRestartCount = 0;
  }

  // Gate: require 2+ consecutive failures (~10s) before restarting
  if (obsApiConsecutiveFailures < 2) return;

  obsApiRestartCount++;
  obsApiLastRestartAt = now;
  log(`obs_api auto-heal: dispatching restart_obs_api (consecutive_failures=${obsApiConsecutiveFailures}, restart_count=${obsApiRestartCount})`, 'INFO');
  getRemediationDispatcher()
    .then(d => d.executeAction('restart_obs_api', { reason: 'unreachable sustained' }))
    .catch(err => log(`obs_api auto-heal failed: ${err.message}`, 'ERROR'));
}

/**
 * Phase 34 R1 (D-01, D-02): tier-pinned semantic-work probe.
 * POSTs a single-token-elicit prompt every 60s; classifies the response per D-02:
 *   - HTTP 4xx/5xx                         -> reason='http_<code>',     semantic_ok=false
 *   - Network timeout (>10s)               -> reason='timeout',         semantic_ok=false
 *   - HTTP 200 missing/empty content       -> reason='empty_content',   semantic_ok=false
 *   - HTTP 200 content lacks 'OK' substring -> reason='oksub_missing',  semantic_ok=false
 *   - HTTP 200 + content contains 'OK'     -> reason=null,              semantic_ok=true
 * NEVER silently 'healthy' on error (Pattern A); always sets last_probe_end.
 */
async function pollProxySemantic() {
  try {
    const probeEndedAt = () => new Date().toISOString();
    const start = Date.now();
    const probeBody = {
      process: 'health-coordinator',
      messages: [{ role: 'user', content: 'say OK' }],
      provider: 'copilot',
      tier: 'haiku',
      maxTokens: 5
    };
    const prevSemantic = currentState.proxy.semantic_ok;
    let r;
    try {
      r = await fetch(`${PROXY_URL}/api/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(probeBody),
        signal: AbortSignal.timeout(PROXY_PROBE_TIMEOUT_MS)
      });
    } catch (err) {
      const elapsed = Date.now() - start;
      const reason = (err && (err.name === 'TimeoutError' || /aborted|timeout/i.test(err.message)))
        ? 'timeout' : `network_${err.message || 'error'}`;
      currentState.proxy.semantic_ok = false;
      currentState.proxy.last_round_trip_ms = elapsed;
      currentState.proxy.reason = reason;
      currentState.proxy.last_probe_end = probeEndedAt();
      if (prevSemantic !== false) log(`proxy semantic_ok flip -> false (${reason})`, 'INFO');
      return;
    }
    const elapsed = Date.now() - start;
    currentState.proxy.last_round_trip_ms = elapsed;
    currentState.proxy.last_probe_end = probeEndedAt();
    if (!r.ok) {
      currentState.proxy.semantic_ok = false;
      currentState.proxy.reason = `http_${r.status}`;
      if (prevSemantic !== false) log(`proxy semantic_ok flip -> false (http_${r.status})`, 'INFO');
      return;
    }
    let body;
    try { body = await r.json(); }
    catch (err) {
      currentState.proxy.semantic_ok = false;
      currentState.proxy.reason = 'empty_content';
      if (prevSemantic !== false) log(`proxy semantic_ok flip -> false (empty_content/json-parse: ${err.message})`, 'INFO');
      return;
    }
    // D-02: extract content. Shape per copilot proxy: { choices: [ { message: { content: '...' } } ] } OR { content: '...' } OR { text: '...' }
    const content = (body?.choices?.[0]?.message?.content)
      ?? body?.content ?? body?.text ?? '';
    if (!content || typeof content !== 'string') {
      currentState.proxy.semantic_ok = false;
      currentState.proxy.reason = 'empty_content';
      if (prevSemantic !== false) log(`proxy semantic_ok flip -> false (empty_content)`, 'INFO');
      return;
    }
    if (!/ok/i.test(content)) {
      currentState.proxy.semantic_ok = false;
      currentState.proxy.reason = 'oksub_missing';
      if (prevSemantic !== false) log(`proxy semantic_ok flip -> false (oksub_missing — got: ${String(content).slice(0, 80)})`, 'INFO');
      return;
    }
    // Success.
    currentState.proxy.semantic_ok = true;
    currentState.proxy.reason = null;
    if (prevSemantic !== true) log(`proxy semantic_ok flip -> true (${elapsed}ms)`, 'INFO');
    log(`proxy semantic probe ok (${elapsed}ms)`, 'DEBUG');
  } finally {
    // Phase 34 D-06: every probe outcome flows through the FSM exactly once.
    // Wrapping in try/finally guarantees this for all return paths AND any
    // unexpected throw — semantic_ok is updated upstream of the FSM, so the
    // FSM always sees the latest decision.
    evaluateAutoHealFSM();
  }
}

/**
 * Phase 34 D-06: auto-heal cooldown finite state machine.
 * States: 'healthy' | 'kickstart_pending' | 'cooldown' | 'disabled'.
 * Transitions:
 *   - rule.auto_heal !== true               -> 'disabled' (kill-switch via D-07)
 *   - probe success                          -> 'healthy', reset consecutive_failures
 *   - kickstart_timestamps.length >= 3 in 5 min -> 'cooldown' (suppress kickstart, log WARN)
 *   - sustained failure >= 60s + within window -> dispatch restart_llm_cli_proxy via /health/remediate
 * Called at the END of pollProxySemantic (success AND failure paths).
 */
function evaluateAutoHealFSM() {
  // D-07 kill-switch: rule.auto_heal=false short-circuits all of this.
  const rule = RULES?.rules?.services?.llm_cli_proxy;
  if (!rule || rule.auto_heal !== true) {
    if (currentState.proxy.auto_heal_status !== 'disabled') {
      log(`proxy auto_heal disabled by config rule (auto_heal=${rule?.auto_heal})`, 'INFO');
    }
    currentState.proxy.auto_heal_status = 'disabled';
    return;
  }

  // Reset on probe success.
  if (currentState.proxy.semantic_ok === true) {
    if (currentState.proxy.consecutive_failures > 0 || currentState.proxy.auto_heal_status !== 'healthy') {
      log(`proxy auto_heal -> healthy (recovered after ${currentState.proxy.consecutive_failures} consecutive failures)`, 'INFO');
    }
    currentState.proxy.consecutive_failures = 0;
    currentState.proxy.auto_heal_status = 'healthy';
    return;
  }

  // Failure path. Slide the kickstart window first.
  const now = Date.now();
  currentState.proxy.kickstart_timestamps = currentState.proxy.kickstart_timestamps
    .filter(ts => (now - ts) < PROXY_KICKSTART_WINDOW_MS);

  // Already at the cap? Stay in cooldown until the window slides clear AND a probe succeeds.
  if (currentState.proxy.kickstart_timestamps.length >= PROXY_KICKSTART_MAX) {
    if (currentState.proxy.auto_heal_status !== 'cooldown') {
      log(`proxy auto-heal cooldown engaged — ${currentState.proxy.kickstart_timestamps.length} kickstarts in last ${PROXY_KICKSTART_WINDOW_MS/1000}s`, 'WARN');
    } else {
      log(`proxy still in cooldown — kickstarts in window: ${currentState.proxy.kickstart_timestamps.length}`, 'WARN');
    }
    currentState.proxy.auto_heal_status = 'cooldown';
    return;
  }

  // Increment consecutive_failures EARLY so the dispatch gate sees the right count.
  currentState.proxy.consecutive_failures += 1;

  // Sustained-failure gate per Requirement 4: only kickstart after >=60s of failures.
  // Probe interval is PROXY_PROBE_INTERVAL_MS (60s); 1 failed probe = ~60s sustained.
  // Use ceil to allow first kickstart after the second consecutive failure (covers edge cases at boot).
  const sustainedSeconds = currentState.proxy.consecutive_failures * (PROXY_PROBE_INTERVAL_MS / 1000);
  if (sustainedSeconds < 60) {
    currentState.proxy.auto_heal_status = 'kickstart_pending';
    return;
  }

  // Fire kickstart through the dispatcher (Pattern E — same code path as dashboard Restart button).
  currentState.proxy.kickstart_timestamps.push(now);
  currentState.proxy.kickstart_count += 1;
  currentState.proxy.auto_heal_status = 'kickstart_pending';
  log(`proxy auto-heal: dispatching restart_llm_cli_proxy (consecutive_failures=${currentState.proxy.consecutive_failures}, kickstart_count=${currentState.proxy.kickstart_count})`, 'INFO');
  getRemediationDispatcher()
    .then(d => d.executeAction('restart_llm_cli_proxy', { reason: 'semantic_ok=false sustained' }))
    .catch(err => log(`proxy auto-heal kickstart failed: ${err.message}`, 'ERROR'));
}

/**
 * Phase 34 R2: poll the proxy's networkMode every tick (~5s) and surface as
 * state.proxy.networkMode. Pattern A: any error -> 'unknown' (never silently
 * a real value). Plan 34-03 will add VPN/CN flap kickstart on transition;
 * THIS PLAN ONLY OBSERVES.
 */
async function pollProxyMode() {
  try {
    const prevMode = currentState.proxy.networkMode;
    const r = await fetch(`${PROXY_URL}/health`, {
      signal: AbortSignal.timeout(PROXY_MODE_POLL_TIMEOUT_MS)
    });
    if (!r.ok) {
      currentState.proxy.networkMode = 'unknown';
      return;
    }
    const body = await r.json();
    const mode = body?.networkMode;
    currentState.proxy.networkMode = (mode === 'vpn' || mode === 'corporate' || mode === 'public') ? mode : 'unknown';

    // Phase 34 R3 / D-05: VPN/CN flap re-detection.
    // Trigger kickstart ONLY on real-value <-> real-value transitions
    // (vpn -> public OR public -> vpn). Transitions involving 'unknown'
    // are coordinator-side noise (proxy startup, transient errors) and
    // are NOT actionable. Flap kickstart does NOT push to
    // kickstart_timestamps — flap is a USER ACTION (network changed),
    // not a proxy-failure response, so cooldown does not gate it.
    const realModes = new Set(['vpn', 'corporate', 'public']);
    if (
      realModes.has(prevMode) &&
      realModes.has(currentState.proxy.networkMode) &&
      prevMode !== currentState.proxy.networkMode
    ) {
      log(`proxy networkMode flip ${prevMode} -> ${currentState.proxy.networkMode}, dispatching restart_llm_cli_proxy`, 'INFO');
      getRemediationDispatcher()
        .then(d => d.executeAction('restart_llm_cli_proxy', { reason: 'networkMode-flip' }))
        .catch(err => log(`networkMode-flip kickstart failed: ${err.message}`, 'ERROR'));
    }
  } catch (err) {
    currentState.proxy.networkMode = 'unknown';
  }
}

// ETM spawn safety net (Phase 33 fills the gap left by removing the legacy
// per-project LSL coordinator). Discovers projects with an actively-written
// Claude transcript and ensures an enhanced-transcript-monitor process is
// running for each. Rate-limited to once per 30s to prevent spawn storms.
const ETM_SPAWN_INTERVAL_MS = 30_000;
const ETM_TRANSCRIPT_ACTIVE_MS = 120_000; // jsonl mtime within 2 min = active
let _lastEtmSpawnCheck = 0;

/**
 * List project paths that currently have an open tmux session.
 *
 * The 2-minute jsonl-mtime gate above (ETM_TRANSCRIPT_ACTIVE_MS) defines
 * "active" as "user typed in the last 2 minutes". That's too aggressive
 * for the user-facing meaning of active: a Claude session can sit idle
 * for hours and the user still expects it to appear in the statusline.
 * tmux's view of "what windows are open" is the truest signal, so we
 * union it with the mtime-based discovery — any project with a live
 * tmux session bypasses the 2-min gate.
 */
function tmuxOpenProjectPaths(agenticDir) {
  try {
    const out = spawnSync('tmux', ['list-sessions', '-F', '#{session_path}'], {
      encoding: 'utf8',
      timeout: 1500,
    });
    if (out.status !== 0 || !out.stdout) return new Set();
    const paths = new Set();
    for (const line of out.stdout.split('\n')) {
      const p = line.trim();
      if (!p) continue;
      if (!p.startsWith(agenticDir + '/')) continue;
      if (fs.existsSync(p)) paths.add(p);
    }
    return paths;
  } catch {
    return new Set();
  }
}

/**
 * Forward-encode a project path to its Claude transcript dir name.
 * Claude Code collapses both `/` and `_` to `-` (verified in
 * enhanced-transcript-monitor.js:1703). The reverse direction is lossy
 * (`Agentic/_work/foo` and `Agentic/-work-foo` encode identically), so
 * any discovery code MUST run forward (path → encoded), not the reverse.
 */
function encodeClaudeProjectDir(projectPath) {
  return projectPath.replace(/[\/_]/g, '-');
}

/**
 * Walk Agentic dir up to depth 2 to enumerate real on-disk project paths.
 * This covers both `Agentic/<name>` and `Agentic/_work/<name>` layouts.
 */
function discoverProjectCandidates(agenticDir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(agenticDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const lvl1 = path.join(agenticDir, entry.name);
    out.push(lvl1);
    let subEntries;
    try {
      subEntries = fs.readdirSync(lvl1, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sub of subEntries) {
      if (!sub.isDirectory() || sub.name.startsWith('.')) continue;
      out.push(path.join(lvl1, sub.name));
    }
  }
  return out;
}

/**
 * Ensure an enhanced-transcript-monitor is running for every project with an
 * actively-written Claude transcript. Skips projects that already have a
 * running heartbeat in currentState.lsl (set by ETM heartbeats; staleness
 * pass at HEARTBEAT_STALENESS_MS = 15s). Rate-limited to once per 30s.
 */
function ensureEtmForActiveProjects() {
  const now = Date.now();
  // Startup grace: wait HEARTBEAT_STALENESS_MS + buffer before doing the first
  // spawn check so existing ETMs (started before us) get a chance to heartbeat
  // and populate currentState.lsl. Without this, a coordinator restart spawns
  // a redundant ETM for every active project even when one is already running.
  if (now - STARTED_AT < HEARTBEAT_STALENESS_MS + 5_000) return;
  if (now - _lastEtmSpawnCheck < ETM_SPAWN_INTERVAL_MS) return;
  _lastEtmSpawnCheck = now;

  const homeDir = process.env.HOME;
  if (!homeDir) return;
  const agenticDir = path.dirname(REPO_ROOT);
  const claudeProjectsDir = path.join(homeDir, '.claude', 'projects');
  if (!fs.existsSync(claudeProjectsDir)) return;
  const monitorScript = path.join(REPO_ROOT, 'scripts', 'enhanced-transcript-monitor.js');
  if (!fs.existsSync(monitorScript)) return;

  // Project names already covered by a fresh heartbeat — skip these.
  const coveredProjects = new Set();
  for (const entry of Object.values(currentState.lsl)) {
    if (entry?.status === 'running' && entry?.projectName) {
      coveredProjects.add(entry.projectName);
    }
  }

  // Projects with a live tmux session bypass the 2-min mtime gate below.
  // Without this, idle-but-open sessions (e.g. sketcher with last prompt
  // 4 hours ago) silently drop out of the statusline because no ETM ever
  // gets spawned for them.
  const tmuxOpen = tmuxOpenProjectPaths(agenticDir);

  for (const projectPath of discoverProjectCandidates(agenticDir)) {
    const projectName = path.basename(projectPath);
    if (coveredProjects.has(projectName)) continue;

    const transcriptDir = path.join(claudeProjectsDir, encodeClaudeProjectDir(projectPath));
    if (!fs.existsSync(transcriptDir)) continue;

    let latestMtime = 0;
    try {
      for (const f of fs.readdirSync(transcriptDir)) {
        if (!f.endsWith('.jsonl')) continue;
        const m = fs.statSync(path.join(transcriptDir, f)).mtime.getTime();
        if (m > latestMtime) latestMtime = m;
      }
    } catch {
      continue;
    }
    // Gate: transcript fresh OR an open tmux session is rooted at this
    // project (which means the user has a Claude window open right now,
    // even if no prompt has been sent recently).
    const transcriptFresh = latestMtime > 0 && (now - latestMtime) <= ETM_TRANSCRIPT_ACTIVE_MS;
    const tmuxAlive = tmuxOpen.has(projectPath);
    if (!transcriptFresh && !tmuxAlive) continue;
    if (latestMtime === 0) continue; // need at least one transcript file to read

    log(`spawning ETM for active project ${projectName} (${projectPath})`, 'INFO');
    try {
      const child = spawn('node', [monitorScript, projectPath], {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          CODING_REPO: REPO_ROOT,
          CODING_TOOLS_PATH: REPO_ROOT,
          TRANSCRIPT_SOURCE_PROJECT: projectPath
        },
        cwd: REPO_ROOT
      });
      child.unref();
    } catch (err) {
      log(`failed to spawn ETM for ${projectName}: ${err.message}`, 'ERROR');
    }
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
 * Run all health checks. Updates currentState in place. Per-check errors are
 * isolated so one failing check does not corrupt other slices. SPEC R6: any
 * unhandled error in a slice surfaces as 'unknown' for that slice — never
 * 'healthy'.
 *
 * Slice coverage:
 *   - container.healthcheck — Docker `.State.Health.Status` passthrough (R7)
 *   - lsl / lsl_by_project — staleness pass + project rollup (D-10)
 *   - services — PSM-tracked host services
 *   - databases — PSM checkDatabaseHealth aggregate
 *   - per-rule entries (databases/services/processes/files) via forEachEnabledRule
 */
// ---------------------------------------------------------------------------
// Network environment detection — single source of truth
// ---------------------------------------------------------------------------
const NETWORK_PROBE_INTERVAL_MS = 30_000;

/**
 * Detect network location and proxy status.
 * Logic ported from coding/scripts/detect-network.sh:
 *   1. Check if px/proxydetox is listening on 127.0.0.1:3128
 *   2. Check if BMW PAC host resolves (→ corporate/CN)
 *   3. Check VPN interfaces (utun*)
 *   4. Determine: corporate | vpn | home
 */
async function pollNetworkStatus() {
  const netState = currentState.network;

  // 1. Is the local proxy active?
  //    px-toggle unsets proxy env vars when disabling, but may leave the
  //    process listening on :3128. Treat proxy as inactive when none of the
  //    standard env vars point to it — that's the user's intent signal.
  const proxyEnvSet = !!(process.env.http_proxy || process.env.https_proxy ||
                         process.env.HTTP_PROXY || process.env.HTTPS_PROXY);
  const portListening = await new Promise(resolve => {
    const sock = net.connect({ host: '127.0.0.1', port: 3128, timeout: 2000 });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
  });
  netState.proxy_running = proxyEnvSet && portListening;

  // 2. Can we resolve BMW PAC host? (indicates CN)
  const pacResolved = await new Promise(resolve => {
    dns.resolve4('muc.proxy-pac.bmwgroup.net', { timeout: 3000 }, (err, addrs) => {
      resolve(!err && addrs && addrs.length > 0);
    });
  });

  // 3. Determine location
  //    PAC resolves = corporate network reachable (physically or via VPN)
  //    proxy running on CN = VPN (physical CN doesn't need the local proxy)
  if (pacResolved && netState.proxy_running) {
    netState.location = 'vpn';        // corporate network + proxy = VPN tunnel
  } else if (pacResolved) {
    netState.location = 'corporate';  // physical corporate network (no proxy needed)
  } else {
    netState.location = 'home';       // direct internet, no corporate access
  }

  // 5. Check if proxy is functional (can reach external host via proxy)
  if (netState.proxy_running) {
    netState.proxy_functional = await new Promise(resolve => {
      const req = http.get('http://127.0.0.1:3128/', {
        timeout: 5000,
        headers: { Host: 'api.github.com' }
      }, res => {
        res.resume();
        // Any response from the proxy (even 407) means it's functional
        resolve(res.statusCode < 502);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  } else {
    netState.proxy_functional = false;
  }

  // 6. Can we reach the internet? (either directly or via proxy)
  netState.internet_reachable = await new Promise(resolve => {
    const opts = { timeout: 5000, method: 'HEAD' };
    if (netState.proxy_running) {
      // Via proxy
      const proxyReq = http.request({
        host: '127.0.0.1', port: 3128,
        method: 'CONNECT', path: 'api.github.com:443',
        timeout: 5000
      });
      proxyReq.on('connect', (res) => {
        resolve(res.statusCode === 200);
        proxyReq.destroy();
      });
      proxyReq.on('error', () => resolve(false));
      proxyReq.on('timeout', () => { proxyReq.destroy(); resolve(false); });
      proxyReq.end();
    } else {
      // Direct
      const req = https.get('https://api.github.com/', opts, res => {
        res.resume();
        resolve(res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    }
  });

  netState.last_probe_end = new Date().toISOString();

  // Also update proxy.networkMode to match (backwards compat for dashboard)
  currentState.proxy.networkMode = netState.location === 'home' ? 'public' : netState.location;

  log(`network: location=${netState.location} proxy_env=${proxyEnvSet} port_listening=${portListening} proxy_running=${netState.proxy_running} proxy_functional=${netState.proxy_functional} internet=${netState.internet_reachable}`);
}

async function runAllChecks() {
  // ----- Network environment detection (every 30s) -----
  const _netProbeAge = currentState.network.last_probe_end
    ? Date.now() - new Date(currentState.network.last_probe_end).getTime()
    : Infinity;
  if (_netProbeAge >= NETWORK_PROBE_INTERVAL_MS) {
    try {
      await pollNetworkStatus();
    } catch (err) {
      log(`network probe threw: ${err.message}`, 'ERROR');
      currentState.network.last_probe_end = new Date().toISOString();
    }
  }

  // ----- Container healthcheck (SPEC R7) -----
  try {
    currentState.container = pollDockerHealth();
  } catch (err) {
    log(`container check threw: ${err.message}`, 'ERROR');
    currentState.container = { healthcheck: 'unknown', last_probe_end: null };
  }

  // ----- LSL staleness + project rollup (signals were ingested between ticks) -----
  try {
    const lslMode = shouldInject('lsl');
    if (lslMode === 'throw') {
      throw new Error('forced (shouldInject lsl=throw)');
    }
    if (lslMode === 'fail') {
      // Mark every project rollup as 'unknown' (SPEC R6) and skip refresh.
      const rollup = {};
      for (const e of Object.values(currentState.lsl)) {
        rollup[e.projectName || 'unknown'] = 'unknown';
      }
      currentState.lsl_by_project = rollup;
    } else {
      refreshLslStaleness();
    }

    // Derive enhanced_transcript_monitor service status from lsl entries.
    // ETM only POSTs lsl_heartbeat signals (not service_status), so the rule
    // entry stays 'unknown' forever otherwise. ETM is healthy iff at least one
    // lsl entry is fresh (running). This is the cheapest way to surface
    // "something is heart­beating" as the ETM service indicator without
    // changing the ETM signal contract.
    const etmIdx = currentState.services.findIndex(s => s.name === 'enhanced_transcript_monitor');
    const anyRunning = Object.values(currentState.lsl).some(e => e.status === 'running');
    const mostRecent = Object.values(currentState.lsl)
      .reduce((m, e) => (e.lastBeat || 0) > (m || 0) ? e.lastBeat : m, 0);
    const etmEntry = {
      name: 'enhanced_transcript_monitor',
      status: anyRunning ? 'running' : (mostRecent ? 'stopped' : 'unknown'),
      last_seen: mostRecent || null,
      derived_from: 'lsl_heartbeats'
    };
    if (etmIdx >= 0) currentState.services[etmIdx] = etmEntry;
    else currentState.services.push(etmEntry);

    // Safety net: ensure an ETM is running for every project with an
    // actively-written Claude transcript. Phase 33 removed the legacy
    // per-project LSL coordinator that used to spawn these; without this
    // sweep, any session not launched via `bin/coding` (e.g. VS Code's
    // Claude extension, or one whose ETM died) leaves no heartbeats in
    // lsl_by_project and the statusline cannot render its label. Internally
    // rate-limited to once per 30s; safe to call every tick.
    try {
      ensureEtmForActiveProjects();
    } catch (err) {
      log(`ETM safety-net spawn threw: ${err.message}`, 'ERROR');
    }
  } catch (err) {
    log(`lsl refresh threw: ${err.message}`, 'ERROR');
    // Mark every project rollup as 'unknown' on failure (SPEC R6).
    const rollup = {};
    for (const e of Object.values(currentState.lsl)) {
      const name = e.projectName || 'unknown';
      rollup[name] = 'unknown';
    }
    currentState.lsl_by_project = rollup;
  }

  // ----- LSL canonical time-window (Phase 36-01, cheap clock-only compute) -----
  // Publishes currentState.lsl_meta.current_window as the single source of truth
  // for 'which HHMM-HHMM window are we in right now?'. Wave 1 is observation-only;
  // statusline and dashboard continue computing locally (CONTEXT.md "Out of scope").
  //
  // CRITICAL: always go through utcToLocalTime() first. Passing a bare new Date()
  // into getTimeWindow() would read .getHours() in launchd's default UTC, drifting
  // the published window from the statusline-side computation by the project TZ
  // offset (PATTERNS.md Section 1 landmine #2 — would be 1-2h off in Europe/Berlin).
  //
  // SPEC R6: on any throw, set the field to literal 'unknown' — never
  // substitute synthetic 'healthy' or a last-good cached value.
  try {
    const local = utcToLocalTime(new Date());
    currentState.lsl_meta.current_window = getTimeWindow(local);
  } catch (err) {
    log(`lsl current_window compute threw: ${err.message}`, 'ERROR');
    currentState.lsl_meta.current_window = 'unknown';
  }

  // ----- Knowledge pipeline freshness (drives [📚] statusline badge) -----
  try {
    await pollKnowledgePipeline();
  } catch (err) {
    log(`knowledge_pipeline probe threw: ${err.message}`, 'ERROR');
    currentState.knowledge_pipeline = {
      status: 'unreachable',
      reason: err.message,
      lastObservationAt: null,
      lastDigestAt: null,
      lastInsightAt: null,
      totals: null,
      last_probe_end: new Date().toISOString()
    };
  }

  // ----- Proxy network mode (every tick — Plan 34-02 R2; Plan 34-03 adds flap kickstart) -----
  try {
    await pollProxyMode();
  } catch (err) {
    log(`proxy networkMode probe threw: ${err.message}`, 'ERROR');
    currentState.proxy.networkMode = 'unknown';
  }

  // ----- Proxy semantic readiness (every 60s — Plan 34-02 R1; Plan 34-03 adds auto-heal FSM) -----
  const _proxyProbeAge = currentState.proxy.last_probe_end
    ? Date.now() - new Date(currentState.proxy.last_probe_end).getTime()
    : Infinity;
  if (_proxyProbeAge >= PROXY_PROBE_INTERVAL_MS) {
    try {
      await pollProxySemantic();
    } catch (err) {
      log(`proxy semantic probe threw: ${err.message}`, 'ERROR');
      currentState.proxy.semantic_ok = false;
      currentState.proxy.reason = err.message;
      currentState.proxy.last_probe_end = new Date().toISOString();
    }
  }

  // ----- Service liveness via PSM (host services only — D-08 drops container supervisorctl) -----
  try {
    const svcMode = shouldInject('services');
    if (svcMode === 'throw') {
      throw new Error('forced (shouldInject services=throw)');
    }
    if (svcMode === 'fail') {
      currentState.services = (currentState.services || []).map(s => ({ ...s, status: 'unknown' }));
      // Skip the PSM populate path — leave services 'unknown' (SPEC R6).
      // Fall through to the rule iteration below; per-rule entries still get added.
    } else {
      if (psmReady && typeof psm.getRegisteredServices === 'function') {
        const registered = psm.getRegisteredServices() || [];
        currentState.services = registered.map(svc => ({
          name: svc.name,
          pid: svc.pid || null,
          status: svc.pid && psm.isProcessAlive(svc.pid) ? 'running' : 'stopped',
          last_seen: Date.now()
        }));
      }
      // If PSM has no getRegisteredServices method, currentState.services is left
      // for signal-driven population (POST /signals service_status) and the rule
      // iteration below ensures each enabled rule gets at least an 'unknown' slot.
    }
  } catch (err) {
    log(`services check threw: ${err.message}`, 'ERROR');
    // Mark every service as 'unknown' (SPEC R6 — never 'healthy' on exception)
    currentState.services = (currentState.services || []).map(s => ({ ...s, status: 'unknown' }));
  }

  // ----- Database health via PSM (LevelDB lock detection + Phase A whitelist) -----
  try {
    const dbMode = shouldInject('db_health');
    if (dbMode === 'throw') {
      throw new Error('forced (shouldInject db_health=throw)');
    }
    if (dbMode === 'fail') {
      currentState.databases = { status: 'unknown' };
    } else if (psmReady && typeof psm.checkDatabaseHealth === 'function') {
      const dbStatus = await psm.checkDatabaseHealth();
      // PSM returns { levelDB: { available, locked, lockedBy }, qdrant: { available } }
      // Aggregate to a single status: healthy iff levelDB available + not locked + qdrant available.
      const levelDbOk = dbStatus?.levelDB?.available !== false && dbStatus?.levelDB?.locked !== true;
      const qdrantOk = dbStatus?.qdrant?.available === true;
      const aggregate = (levelDbOk && qdrantOk) ? 'healthy' : 'degraded';
      currentState.databases = {
        ...(currentState.databases || {}),
        status: aggregate,
        levelDB: dbStatus?.levelDB,
        qdrant: dbStatus?.qdrant,
        // Map PSM probe results to the rule-keyed sub-checks that the
        // dashboard reads (leveldb_lock_check, qdrant_availability, etc.).
        // Without this, sub-checks stay at their 'unknown' default forever.
        leveldb_lock_check: levelDbOk ? 'passed' : (dbStatus?.levelDB?.locked ? 'failed' : 'unknown'),
        leveldb_accessibility: dbStatus?.levelDB?.available !== false ? 'passed' : 'failed',
        qdrant_availability: qdrantOk ? 'passed' : 'failed',
      };

      // Probe Memgraph for graph_integrity (TCP port check on bolt 7687)
      try {
        const net = await import('net');
        await new Promise((resolve, reject) => {
          const sock = net.default.createConnection(7687, 'localhost');
          sock.setTimeout(2000);
          sock.on('connect', () => { sock.destroy(); resolve(); });
          sock.on('timeout', () => { sock.destroy(); reject(new Error('timeout')); });
          sock.on('error', reject);
        });
        currentState.databases.graph_integrity = 'passed';
      } catch {
        currentState.databases.graph_integrity = 'failed';
      }
    }
  } catch (err) {
    log(`db_health check threw: ${err.message}`, 'ERROR');
    currentState.databases = { status: 'unknown' };
  }

  // ----- Rule iteration: ALL FOUR CATEGORIES (W6 — D-05 says "each enabled rule -----
  // becomes a registered check on the 5s tick"). Coverage map per category:
  //   - databases: PSM-backed (already populated above by db_health slice;
  //     forEachEnabledRule iterates rules so they appear in /health/state.databases
  //     even if PSM has not yet reported a status — default 'unknown', NEVER 'healthy').
  //   - services:  coordinator + signal-driven (signals from reduced statusline
  //     daemon and health-verifier reporters arrive via POST /signals; rule
  //     iteration ensures each enabled rule has an entry in currentState.services
  //     even before its first signal — default 'unknown').
  //   - files:     coordinator file-mtime check (a generic stat-based handler;
  //     each rule can carry a `path` or `paths` array; coordinator stats them
  //     and surfaces 'unknown' if missing AND no PSM-backed implementation).
  //   - processes: signal-driven (existing path; processes report via signals).
  // For rule kinds with no PSM-backed implementation, the entry gets status:
  // 'unknown' (NEVER 'healthy' — SPEC R6).

  // databases: ensure each enabled DB rule has a slot in currentState.databases.
  // The PSM-backed db_health slice above sets the aggregate; per-rule entries
  // surface here so /health/state.databases.<rule_name> is greppable.
  if (!currentState.databases || typeof currentState.databases !== 'object') {
    currentState.databases = { status: 'unknown' };
  }
  await forEachEnabledRule('databases', async (name, _rule) => {
    // PSM exposes lock detection (leveldb_lock_check) and accessibility
    // (leveldb_accessibility, qdrant_availability). If PSM has not yet
    // reported on this rule, default to 'unknown' — never 'healthy' (SPEC R6).
    if (currentState.databases[name] === undefined) {
      currentState.databases[name] = 'unknown';
    }
  });

  // services: probe each enabled service rule (Phase 33 G1 closure — plan 33-09).
  // Replaces the previous stub that left every service as 'unknown' forever.
  //
  // Per-rule isolation: a throwing probe surfaces 'unknown' for that rule only
  // (SPEC R6 — never 'healthy' on exception). Probes run CONCURRENTLY via
  // Promise.all so a slow timeout does not serialize the whole tick: the worst
  // case is max(timeouts) ~3s, well under the 5s tick interval.
  //
  // check_type dispatch:
  //   - 'http_health'    → probeHttpHealth(rule.endpoint, rule.timeout_ms ?? 3000)
  //   - 'port_listening' → probeTcpPort('127.0.0.1', rule.port, rule.timeout_ms ?? 2000)
  //   - 'psm_service'    → signal-driven (reporter POSTs service_status); leave for ingestSignal
  //   - other            → status='unknown', NEVER 'healthy' (SPEC R6)
  if (!Array.isArray(currentState.services)) currentState.services = [];
  const serviceRulePromises = [];
  await forEachEnabledRule('services', async (name, rule) => {
    serviceRulePromises.push((async () => {
      let result;
      try {
        const perSvcMode = shouldInject(`services.${name}`);
        if (perSvcMode === 'throw') {
          throw new Error(`forced (shouldInject services.${name}=throw)`);
        }
        if (perSvcMode === 'fail') {
          // Surface 'unknown' for this rule and skip the probe (SPEC R6).
          result = { status: 'unknown', latency_ms: null, error: 'injected fail' };
          // Fall through to the result-recording block below.
          const idx = currentState.services.findIndex(s => s.name === name);
          const prevLastSeen = idx >= 0 ? currentState.services[idx].last_seen : null;
          const entry = {
            name,
            status: result.status,
            last_seen: prevLastSeen,
            latency_ms: result.latency_ms,
            probe_error: result.error
          };
          if (idx < 0) currentState.services.push(entry);
          else currentState.services[idx] = entry;
          return;
        }
        if (rule.check_type === 'http_health' && rule.endpoint) {
          result = await probeHttpHealth(rule.endpoint, rule.timeout_ms || 3000);
        } else if (rule.check_type === 'port_listening' && rule.port) {
          result = await probeTcpPort('127.0.0.1', rule.port, rule.timeout_ms || 2000);
        } else if (rule.check_type === 'psm_service' || rule.check_type === 'process_running') {
          // Signal-driven: reporter POSTs service_status; leave entry for ingestSignal
          // to populate. Ensure a placeholder slot exists so the rule is greppable.
          const idx = currentState.services.findIndex(s => s.name === name);
          if (idx < 0) {
            currentState.services.push({ name, status: 'unknown', last_seen: null });
          }
          return;
        } else {
          // Unknown / unsupported check_type — DO NOT default to 'healthy' (SPEC R6).
          result = {
            status: 'unknown',
            latency_ms: null,
            error: `unsupported check_type: ${rule.check_type}`
          };
        }
      } catch (err) {
        log(`services.${name} probe threw: ${err.message}`, 'ERROR');
        result = { status: 'unknown', latency_ms: null, error: err.message };
      }
      const idx = currentState.services.findIndex(s => s.name === name);
      const prevLastSeen = idx >= 0 ? currentState.services[idx].last_seen : null;
      const entry = {
        name,
        status: result.status,
        last_seen: result.status === 'running' ? Date.now() : prevLastSeen,
        latency_ms: result.latency_ms,
        probe_error: result.error
      };
      if (idx < 0) currentState.services.push(entry);
      else currentState.services[idx] = entry;
    })());
  });
  await Promise.all(serviceRulePromises);

  // files: each enabled rule may carry a `path` or `paths` field; coordinator
  // performs an fs.statSync mtime check. If the file is missing, surface
  // 'unknown' (NEVER 'healthy' — SPEC R6). currentState gains a `files` slot.
  if (!Array.isArray(currentState.files)) currentState.files = [];
  await forEachEnabledRule('files', async (name, rule) => {
    const idx = currentState.files.findIndex(f => f.name === name);
    let status = 'unknown';
    let mtime = null;
    try {
      const paths = Array.isArray(rule.paths) ? rule.paths : (rule.path ? [rule.path] : []);
      if (paths.length === 0) {
        // No path declared — leave 'unknown'; SPEC R6 forbids defaulting to 'healthy'.
      } else {
        // Stat all paths; the freshest mtime represents the rule's recency.
        let freshest = 0;
        for (const p of paths) {
          try {
            const resolved = path.isAbsolute(p) ? p : path.join(REPO_ROOT, p);
            const s = fs.statSync(resolved);
            if (s.mtimeMs > freshest) freshest = s.mtimeMs;
            status = 'present';  // at least one path stat'd successfully
          } catch { /* keep status as-is; missing path stays 'unknown' */ }
        }
        mtime = freshest > 0 ? new Date(freshest).toISOString() : null;
      }
    } catch (err) {
      log(`files.${name} stat threw: ${err.message}`, 'ERROR');
      status = 'unknown';
    }
    const entry = { name, status, mtime };
    if (idx < 0) currentState.files.push(entry);
    else currentState.files[idx] = entry;
  });

  // processes: probe stale PIDs from consolidation heartbeat, and ensure
  // each enabled rule has an entry.
  if (!Array.isArray(currentState.processes)) currentState.processes = [];

  // Probe stale_pids: check consolidation heartbeat for orphaned processes
  const heartbeatPath = path.join(REPO_ROOT, '.observations', 'consolidation-heartbeat.json');
  let stalePidStatus = 'passed';
  let stalePidDetail = 'No stale PIDs';
  try {
    if (fs.existsSync(heartbeatPath)) {
      const hb = JSON.parse(fs.readFileSync(heartbeatPath, 'utf8'));
      const pid = hb?.pid;
      const ts = hb?.timestamp ? Date.parse(hb.timestamp) : 0;
      const ageMs = ts ? Date.now() - ts : Infinity;
      let alive = false;
      if (pid) { try { process.kill(pid, 0); alive = true; } catch { alive = false; } }
      if (pid && !alive) {
        stalePidStatus = 'passed';
        stalePidDetail = `Cleaned stale heartbeat (dead PID ${pid})`;
        try { fs.unlinkSync(heartbeatPath); } catch { /* ignore */ }
      } else if (pid && alive && ageMs > 6 * 60 * 1000) {
        stalePidStatus = 'warning';
        stalePidDetail = `Stale heartbeat: PID ${pid} alive but ${Math.round(ageMs / 1000)}s old`;
      } else if (pid && alive) {
        stalePidStatus = 'passed';
        stalePidDetail = `Active consolidation (PID ${pid})`;
      }
    }
  } catch { /* ignore read errors */ }

  await forEachEnabledRule('processes', async (name, _rule) => {
    const idx = currentState.processes.findIndex(p => p.name === name);
    if (name === 'stale_pids') {
      const entry = { name, pid: null, status: stalePidStatus, detail: stalePidDetail };
      if (idx < 0) currentState.processes.push(entry);
      else currentState.processes[idx] = entry;
    } else if (idx < 0) {
      currentState.processes.push({ name, pid: null, status: 'unknown' });
    }
  });

  // Update timestamp + uptime AFTER checks so /health/state never shows
  // a fresh generated_at while checks themselves are stale.
  currentState.generated_at = new Date().toISOString();
  currentState.coordinator_uptime_s = Math.floor((Date.now() - STARTED_AT) / 1000);
}

/**
 * The 5s tick. Delegates to runAllChecks; the outer guard logs and never
 * overwrites slices to 'healthy' on error (SPEC R6).
 */
async function tick() {
  try {
    const tickMode = shouldInject('tick');
    if (tickMode === 'throw') {
      throw new Error('forced (shouldInject tick=throw)');
    }
    // tick=fail is treated identically to throw at the tick boundary — outer
    // guard logs and currentState slices stay at their last 'unknown' values.
    await runAllChecks();
  } catch (err) {
    // Outer guard: should not be reached because runAllChecks isolates per-check
    // errors. If it IS reached, log and DO NOT mark anything 'healthy'.
    log(`runAllChecks threw at top level: ${err.message}`, 'ERROR');
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
  // D-04: dashboard's "Run Verification" button proxies here.
  // Re-read rules so config changes take effect without coordinator restart.
  try {
    const reloaded = loadRules();
    if (reloaded) RULES = reloaded;
    // Phase 34 D-07: re-evaluate the auto-heal FSM immediately so the
    // kill-switch toggle (rule.auto_heal flip) is visible on /health/state
    // within one tick. Without this the FSM would only re-read the rule on
    // the next 60s pollProxySemantic cycle, missing the spec's 5s budget.
    // Safe to call here: the FSM's failure path only increments
    // consecutive_failures when semantic_ok stayed false, and that flag is
    // unaffected by /health/refresh.
    evaluateAutoHealFSM();
    await forceTick();
    res.json(currentState);
  } catch (err) {
    // SPEC R6: surface failure, never mask as healthy.
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /health/remediate — dashboard proxies "Restart" button clicks here so
// host-side processes (ETM, etc.) can be restarted from inside the Docker'd
// dashboard. Lazy-imports HealthRemediationActions to avoid pulling in PSM at
// coordinator startup.
//   body: { action: '<remediation_action>', service?: '<svc_name>' }
//   200: { ok: true, success, message, action, ... }
//   400: missing/unknown action
//   500: dispatcher error
let remediationDispatcher = null;
async function getRemediationDispatcher() {
  if (remediationDispatcher) return remediationDispatcher;
  const mod = await import('./health-remediation-actions.js');
  remediationDispatcher = new mod.HealthRemediationActions({});
  return remediationDispatcher;
}
app.post('/health/remediate', async (req, res) => {
  const { action, service, details } = req.body || {};
  if (!action || typeof action !== 'string') {
    return res.status(400).json({ ok: false, error: 'action required' });
  }
  try {
    const dispatcher = await getRemediationDispatcher();
    const result = await dispatcher.executeAction(action, { service, ...(details || {}) });
    // Trigger an immediate state refresh so the next dashboard poll reflects the change.
    forceTick().catch(() => {});
    return res.status(result.success ? 200 : 500).json({ ok: result.success, ...result });
  } catch (err) {
    log(`remediate ${action} threw: ${err.message}`, 'ERROR');
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================================================================
// Phase 33-15: Test injection endpoints (loopback-gated, AC#13)
// =====================================================================
// Replaces 33-12's plist-propagation approach (empirically falsified — see
// 33-12-SUMMARY). Sets in-memory injection flags consulted by shouldInject().
// Loopback gate: 127.0.0.1, ::1, ::ffff:127.0.0.1 only — Docker containers
// reaching via host.docker.internal are NOT loopback and get 403.

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const VALID_INJECT_KINDS = new Set(['db_health', 'container', 'docker_health']);
const VALID_INJECT_MODES = new Set(['throw', 'fail']);

/**
 * Returns the active injection flags as an array of { kind, mode } objects.
 */
function listActiveInjections() {
  return [...injectionFlags.entries()].map(([k, m]) => ({ kind: k, mode: m }));
}

// POST /test/inject — sets an in-memory injection flag (AC#13).
//   body: { kind, mode } | { reset: true }
//   200: { ok: true, active: [{kind, mode}, ...] }
//   400: invalid kind/mode
//   403: non-loopback caller
app.post('/test/inject', (req, res) => {
  const ip = req.socket.remoteAddress;
  if (!LOOPBACK_IPS.has(ip)) {
    return res.status(403).json({ error: 'loopback only', remote: ip });
  }
  const body = req.body || {};
  if (body.reset === true) {
    injectionFlags.clear();
    return res.json({ ok: true, active: [] });
  }
  const { kind, mode } = body;
  if (!VALID_INJECT_KINDS.has(kind) || !VALID_INJECT_MODES.has(mode)) {
    return res.status(400).json({
      error: 'invalid kind or mode',
      valid_kinds: [...VALID_INJECT_KINDS],
      valid_modes: [...VALID_INJECT_MODES]
    });
  }
  injectionFlags.set(kind, mode);
  return res.json({ ok: true, active: listActiveInjections() });
});

// POST /test/reset — convenience alias for { reset: true } (loopback-gated).
app.post('/test/reset', (req, res) => {
  const ip = req.socket.remoteAddress;
  if (!LOOPBACK_IPS.has(ip)) {
    return res.status(403).json({ error: 'loopback only', remote: ip });
  }
  injectionFlags.clear();
  return res.json({ ok: true, active: [] });
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
