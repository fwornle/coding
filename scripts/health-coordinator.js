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
import { spawnSync, spawn, execFile, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runIfMain } from '../lib/utils/esm-cli.js';
import { createRotatingLogger } from '../lib/utils/log-rotator.js';
import { probeHttpHealth, probeTcpPort } from '../lib/utils/service-probe.js';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import ProcessStateManager from './process-state-manager.js';
import { getTimeWindow, utcToLocalTime } from './timezone-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.HEALTH_COORDINATOR_PORT || '3033', 10);
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
  // Phase 51 Plan 11 — sub-agent capture freshness across all four agents.
  // Reads the per-agent heartbeat files in .data/sub-agent-live-state-*.json
  // via lib/lsl/registry-reader.mjs (the same helper Plan 51-10's statusline
  // uses). status: 'unknown' before first probe · 'healthy' if at least one
  // live daemon has a fresh heartbeat · 'degraded' if all heartbeats are
  // stale (>90s) or missing. Mastra is forward-compat (no Path A daemon yet
  // per CONTEXT.md / RESEARCH-mastra.md), so it always reports available:
  // false with the documented rationale.
  sub_agent_capture: {
    status: 'unknown',
    live_registrations: {
      claude: { running: 0, last_heartbeat_age_ms: null },
      opencode: { running: 0, last_heartbeat_age_ms: null },
      copilot: { running: 0, last_heartbeat_age_ms: null },
      mastra: { running: 0, available: false, reason: 'Path A not viable per RESEARCH-mastra.md' }
    },
    last_sweep_at: null,
    last_sweep_summary: null,
    registry_size: 0,
    copilot_lsl_incomplete_marker: true,
    last_probe_end: null
  },
  // Proxy semantic-readiness — drives the [🧠] statusline badge (Plan 34-05)
  // and the dashboard proxy-health card (Plan 34-05). semantic_ok=true only
  // after a successful POST /api/complete round-trip with content containing
  // "OK". networkMode mirrors the proxy's published value (vpn|public|unknown).
  // auto_heal_status follows D-06 cooldown FSM (wired in Plan 34-03).
  proxy: {
    semantic_ok: null,                   // null until first probe; true|false after — cheap haiku/copilot probe (drives auto-heal FSM)
    last_round_trip_ms: null,            // int, last completion latency
    networkMode: 'unknown',              // 'vpn' | 'corporate' | 'public' | 'unknown'
    auto_heal_status: 'healthy',         // 'healthy'|'kickstart_pending'|'cooldown'|'disabled' (Plan 34-03 transitions)
    kickstart_count: 0,                  // running counter since coordinator boot (D-14 soak gate)
    kickstart_timestamps: [],            // sliding window for D-06 cooldown FSM
    consecutive_failures: 0,             // resets on success
    last_probe_end: null,                // ISO timestamp of last semantic probe completion
    reason: null,                        // last failure classification: 'http_<code>'|'timeout'|'empty_content'|'oksub_missing'|null
    // 3b multi-tier semantic-readiness — does the ACTUALLY CONFIGURED semantic
    // pipeline work, not just "is the proxy reachable on a cheap path". Probe
    // sends process: 'observation-writer' so the proxy's processOverrides logic
    // picks the same route observations would take. Informational only — does
    // NOT drive the auto-heal FSM (an Anthropic 429 on sonnet is not a proxy
    // outage; restarting wouldn't help).
    semantic_strong_ok: null,            // null until first probe; true|false after — heavy-tier probe via configured route
    semantic_strong_round_trip_ms: null,
    semantic_strong_last_probe_end: null,
    semantic_strong_reason: null,
    // Strong-probe escalation: count consecutive RECOVERABLE failures
    // (network_* / http_5xx). Unlike the cheap-probe FSM at evaluateAutoHealFSM,
    // this counter is the basis for kickstart dispatch when the cheap probe
    // is passing but the configured pipeline is broken in a way a proxy
    // restart can fix (e.g. stale HTTPS_PROXY from a launchd KeepAlive
    // restart — the 2026-05-21 9-hr observation silence root cause).
    // Resets on success or non-recoverable reason (timeout/4xx/empty/oksub).
    consecutive_strong_network_failures: 0
  },
  // Network environment detection — single source of truth for CN/VPN/home
  // and local proxy (px/proxydetox) status. Polled every 30s.
  // Consumers: LLM proxy, statusline, dashboard.
  network: {
    location: 'unknown',                 // 'corporate' | 'vpn' | 'open' | 'unknown'
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
const PROXY_PROBE_INTERVAL_MS = 60_000;          // D-01: cheap probe every 60s
// D-02: round-trip threshold. Raised from 10s to 25s on 2026-05-20 because
// the proxy's claude-code provider falls back to the `claude` CLI subprocess
// when the direct API is rate-limited, which costs 5-12s per call. With a
// 10s budget those CLI-fallback paths intermittently tripped 'timeout'
// failures that drove an auto-heal cascade, then the kickstart momentarily
// killed the listening port and the *next* probe failed with
// 'network_fetch failed' — a classic self-inflicted feedback loop.
const PROXY_PROBE_TIMEOUT_MS = 25_000;
const PROXY_MODE_POLL_TIMEOUT_MS = 2_000;         // GET /health is fast; 2s budget
const PROXY_KICKSTART_WINDOW_MS = 5 * 60_000;     // D-06: 5 min sliding window
const PROXY_KICKSTART_MAX = 3;                    // D-06: 3 kickstarts then cooldown
// 3b strong probe runs much less often than the cheap probe (5 min vs 60s)
// because under the per-model 429 rate-limit it falls through to the CLI path
// and burns ~14-22K cache_creation tokens PER PROBE. Combined with the
// "skip if recent real traffic" check, the synthetic probe usually doesn't
// fire at all during active sessions.
const PROXY_STRONG_PROBE_INTERVAL_MS = 5 * 60_000;       // every 5 min
const PROXY_STRONG_PROBE_REAL_TRAFFIC_MAX_AGE_MS = 5 * 60_000; // real obs within 5 min counts as proof
// Cheap-probe real-traffic gate (2026-07-07): same principle as the strong
// probe's skip — ANY successful real LLM call through the proxy within this
// window proves /api/complete liveness better than a synthetic say-OK, at
// zero marginal cost. This is what stops the synthetic ping bursts during
// AFK windows where only background pipeline work (consolidators,
// observation-writer) is running: that work IS the liveness proof. A dead
// proxy is still detected within one gate cycle because the token-usage
// read below hits the proxy itself and fails fast when it is down, falling
// through to the synthetic probe.
const PROXY_PROBE_REAL_TRAFFIC_MAX_AGE_MS = 5 * 60_000;

// AFK full-suspend (restored 2026-07-10): when no session transcript is fresh
// across any project/pane, the user is AFK and no one is watching the dashboard
// — so a synthetic liveness ping has no consumer. The probe gates in the tick
// loop therefore SUPPRESS the synthetic probes ENTIRELY while AFK (gated on
// `userActiveNow()`), rather than throttling them to a 10-min/30-min floor.
// This restores the original Gate-1 contract ("returning false suppresses all
// probes for this tick") that commit 2129be37b silently downgraded to a floor.
// Probing resumes on the first fresh transcript mtime, one tick (≤TICK_MS)
// after the user returns; a proxy that died mid-AFK is detected on that tick.
// What counts as "active" — same threshold the [📚] badge uses for
// ETM-heartbeat promotion in combined-status-line.js (~line 1019).
const USER_ACTIVE_HEARTBEAT_MAX_AGE_MS = 5 * 60_000;

// Physical-presence gate (2026-07-11): the transcript-mtime signal alone is not
// sufficient proof a HUMAN is here. A scheduled task, a /loop, or any background
// agent write keeps a session .jsonl fresh with nobody at the keyboard, so
// userActiveNow() returned true all night and the (correctly AFK-gated)
// consolidation + synthetic probes fired anyway (~225 consolidator-insight calls
// on 2026-07-10 overnight). macOS HID idle time is the authentic "a person
// touched this machine" clock — independent of agent/daemon activity and of the
// machine being kept awake. When a human has been idle longer than this, treat
// them as away and suppress deferrable background LLM work regardless of
// transcript churn.
const HUMAN_HID_IDLE_MAX_MS =
  parseInt(process.env.HUMAN_HID_IDLE_MAX_MS || '', 10) || 10 * 60_000;
let _hidIdleCache = { at: 0, ms: null };

/**
 * macOS HID idle time in ms (time since last real keyboard/mouse input), or
 * null when it cannot be determined (non-darwin, or ioreg failure). Cached for
 * 3s so multiple userActiveNow() calls in one tick don't each spawn ioreg.
 */
function hidIdleMs() {
  const now = Date.now();
  if (now - _hidIdleCache.at < 3000) return _hidIdleCache.ms;
  let ms = null;
  if (process.platform === 'darwin') {
    try {
      const out = execSync('ioreg -c IOHIDSystem', {
        encoding: 'utf8', timeout: 2000, maxBuffer: 8 * 1024 * 1024,
      });
      const m = out.match(/"HIDIdleTime"\s*=\s*(\d+)/);
      if (m) ms = Number(m[1]) / 1e6; // nanoseconds → ms
    } catch { ms = null; }
  }
  _hidIdleCache = { at: now, ms };
  return ms;
}

/**
 * Tri-state human-presence signal from HID idle time:
 *   true  — a person used input within HUMAN_HID_IDLE_MAX_MS
 *   false — demonstrably idle longer than that (away / asleep / lid closed)
 *   null  — unknown (non-darwin or ioreg unavailable) → callers must fall back
 *           to the transcript-mtime signal rather than over-suppressing.
 */
function humanPresentByHid() {
  const idle = hidIdleMs();
  if (idle === null) return null;
  return idle < HUMAN_HID_IDLE_MAX_MS;
}

/**
 * True when at least one tracked ETM is heartbeating fresh. The ETM
 * heartbeat fires on every tool call, permission response, and prompt-set
 * boundary the monitor sees, so it is the canonical "user/agent is here
 * right now" signal — same one the per-project lifecycle bubble and the
 * [📚] badge use. Returns false when every monitor is stopped or every
 * heartbeat is older than USER_ACTIVE_HEARTBEAT_MAX_AGE_MS.
 */
function userActiveNow() {
  const now = Date.now();
  // Physical-presence gate: if HID proves the human has been idle past the
  // threshold, they are away — suppress deferrable background LLM work even if a
  // session .jsonl is being written by a background agent / scheduled task. When
  // HID is unknown (null, e.g. non-darwin) fall through to transcript-only.
  if (humanPresentByHid() === false) return false;
  for (const entry of Object.values(currentState.lsl || {})) {
    if (!entry || entry.status === 'stopped' || !entry.transcriptPath) continue;
    // FIX (2026-06-25): do NOT key idle-detection off entry.lastBeat. The ETM
    // posts an lsl_heartbeat on EVERY poll (enhanced-transcript-monitor.js:4329),
    // so lastBeat tracks "ETM daemon is alive" — NOT real activity — and stays
    // fresh every few seconds 24/7 while the daemon runs. That made userActiveNow()
    // return true all night even when the operator was asleep, so the idle proxy-
    // probe back-off (10min/30min) never engaged and the coordinator burned the
    // ~1700 "say-OK" calls/night this gate exists to prevent. The transcript .jsonl
    // is written by the agent/CLI only on real tool calls and user messages, so its
    // mtime is the authentic activity clock (the same signal the statusline's
    // per-project lifecycle bubble uses). Sub-agent live-state heartbeats are
    // intentionally NOT folded in here — they are also daemon-alive (rewritten on a
    // timer), so they would reintroduce the always-true bug.
    let mt = 0;
    try { mt = fs.statSync(entry.transcriptPath).mtimeMs; } catch { mt = 0; }
    if (mt > 0 && (now - mt) < USER_ACTIVE_HEARTBEAT_MAX_AGE_MS) return true;
  }
  return false;
}

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

  // Auto-trigger consolidation when undigested observations accumulate.
  // AFK-gated (2026-07-10): consolidation is deferrable background LLM work with
  // no live consumer while the operator is away — so suspend it entirely when
  // AFK (this trigger drove ~5k overnight consolidator calls). The backlog is
  // preserved and drains on the operator's return (undigested only grows), when
  // userActiveNow() flips true. Same presence authority as the proxy probes.
  const CONSOLIDATION_THRESHOLD = 5;
  const CONSOLIDATION_COOLDOWN_MS = 10 * 60_000; // 10 min between auto-triggers
  if (
    userActiveNow() &&
    body.undigested >= CONSOLIDATION_THRESHOLD &&
    !body.inflight &&
    (!pollKnowledgePipeline._lastAutoConsolidate ||
      now - pollKnowledgePipeline._lastAutoConsolidate > CONSOLIDATION_COOLDOWN_MS)
  ) {
    pollKnowledgePipeline._lastAutoConsolidate = now;
    log(`[auto-consolidation] triggering: ${body.undigested} undigested observations`);
    fetch(`${OBS_API_URL}/api/consolidation/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'health-coordinator-auto' }),
      signal: AbortSignal.timeout(5_000)
    }).catch(err => log(`[auto-consolidation] trigger failed: ${err.message}`));
  }
}

/**
 * Phase 51 Plan 11 — surface sub-agent capture state in /health/state.
 *
 * Reads the per-agent heartbeat files via lib/lsl/registry-reader.mjs
 * (Plan 51-10's defensive aggregator — same uid-check + try/catch guarantees
 * the statusline relies on). Also reads the sweep job's state file
 * (.data/sub-agent-sweep-state.json) for `last_sweep_at`.
 *
 * The aggregator is purely additive — it stamps `currentState.sub_agent_capture`
 * and never throws (per registry-reader.mjs's defensive contract). On any
 * unexpected error, the block transitions to status:'unknown' with the error
 * captured in `reason`.
 *
 * status transitions:
 *   - 'healthy'  — at least one live daemon has a fresh (non-stale) heartbeat
 *   - 'degraded' — daemons are running but all heartbeats are stale (>90s)
 *                  OR the live tier is silent while sweep evidence exists
 *   - 'unknown'  — no heartbeat files exist yet (cold boot / pre-install)
 *
 * Mastra is forward-compat: RESEARCH-mastra.md found no Path A spawn hook,
 * so the agent's `available:false` slot is permanent per CONTEXT.md.
 *
 * Dynamic-imports registry-reader.mjs so a stale/missing module doesn't
 * crash the coordinator at startup (defensive — coordinator MUST keep
 * running even if Phase 51's lib/lsl is in flux during a deploy).
 */
async function pollSubAgentCapture() {
  const probeEndedAt = () => new Date().toISOString();
  const stateDir = path.join(REPO_ROOT, '.data');
  const sweepStatePath = path.join(stateDir, 'sub-agent-sweep-state.json');

  let heartbeats = null;
  try {
    const mod = await import('../lib/lsl/registry-reader.mjs');
    heartbeats = mod.loadAllHeartbeats({ stateDir });
  } catch (err) {
    log(`sub_agent_capture: registry-reader import failed: ${err.message}`, 'WARN');
    currentState.sub_agent_capture = {
      status: 'unknown',
      reason: `registry_reader_unavailable: ${err.message}`,
      live_registrations: {
        claude: { running: 0, last_heartbeat_age_ms: null },
        opencode: { running: 0, last_heartbeat_age_ms: null },
        copilot: { running: 0, last_heartbeat_age_ms: null },
        mastra: { running: 0, available: false, reason: 'Path A not viable per RESEARCH-mastra.md' }
      },
      last_sweep_at: null,
      last_sweep_summary: null,
      registry_size: 0,
      copilot_lsl_incomplete_marker: true,
      last_probe_end: probeEndedAt()
    };
    return;
  }

  // Aggregate per-agent block. heartbeats[agent] is either:
  //   - {} (file missing/unreadable/foreign-uid)
  //   - {...parsed, stale: false, mtime_ms} (fresh)
  //   - {...parsed, stale: true, age_ms} (stale heartbeat)
  const now = Date.now();
  const liveRegistrations = {
    claude: { running: 0, last_heartbeat_age_ms: null },
    opencode: { running: 0, last_heartbeat_age_ms: null },
    copilot: { running: 0, last_heartbeat_age_ms: null },
    mastra: { running: 0, available: false, reason: 'Path A not viable per RESEARCH-mastra.md' }
  };

  let anyFresh = false;
  let anyHeartbeatFile = false;
  let registrySize = 0;

  for (const agent of ['claude', 'opencode', 'copilot']) {
    const hb = heartbeats[agent] || {};
    if (Object.keys(hb).length === 0) continue; // file missing
    anyHeartbeatFile = true;

    const rows = Array.isArray(hb.registry_rows) ? hb.registry_rows : [];
    const runningRows = rows.filter((r) => r && r.status === 'running');
    liveRegistrations[agent].running = runningRows.length;
    registrySize += runningRows.length;

    if (hb.stale) {
      liveRegistrations[agent].last_heartbeat_age_ms = hb.age_ms ?? null;
    } else if (typeof hb.mtime_ms === 'number') {
      liveRegistrations[agent].last_heartbeat_age_ms = now - hb.mtime_ms;
      anyFresh = true;
    }
  }

  // Read sweep state file. Pure additive — failure here doesn't change status.
  let lastSweepAt = null;
  try {
    if (fs.existsSync(sweepStatePath)) {
      const stat = fs.statSync(sweepStatePath);
      const myUid = typeof process.getuid === 'function' ? process.getuid() : null;
      if (myUid === null || stat.uid === myUid) {
        const parsed = JSON.parse(fs.readFileSync(sweepStatePath, 'utf-8'));
        if (parsed && typeof parsed.last_run_at === 'string') {
          lastSweepAt = parsed.last_run_at;
        }
      }
    }
  } catch (err) {
    log(`sub_agent_capture: sweep state read failed: ${err.message}`, 'WARN');
  }

  // Status decision:
  //   - 'healthy' if at least one live daemon has a fresh heartbeat
  //   - 'degraded' if heartbeat files exist but all are stale OR no fresh
  //     daemon but sweep state shows the sweep tier has run recently
  //   - 'unknown' otherwise (no heartbeats AND no sweep evidence)
  let status;
  if (anyFresh) {
    status = 'healthy';
  } else if (anyHeartbeatFile || lastSweepAt) {
    status = 'degraded';
  } else {
    status = 'unknown';
  }

  currentState.sub_agent_capture = {
    status,
    live_registrations: liveRegistrations,
    last_sweep_at: lastSweepAt,
    last_sweep_summary: null,  // sweep wrapper doesn't persist a per-run summary yet (forward-compat slot)
    registry_size: registrySize,
    copilot_lsl_incomplete_marker: true,  // per CONTEXT.md — copilot tier is degraded-parity by design
    last_probe_end: probeEndedAt()
  };
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
    // Re-entry guard (2026-07-07): stamp last_probe_end up-front so an
    // overlapping tick sees a fresh attempt and does not stack a concurrent
    // say-OK (observed as duplicate same-second probe rows in the token
    // export). Every outcome path below overwrites it with the real end time.
    currentState.proxy.last_probe_end = probeEndedAt();
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
    if (prevSemantic !== true) {
      log(`proxy semantic_ok flip -> true (${elapsed}ms) — triggering immediate strong probe`, 'INFO');
      // Don't wait for the 5-min strong probe cycle — verify full pipeline now.
      setImmediate(() => pollProxySemanticStrong());
    }
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
 * 3b multi-tier strong probe — does the *actually configured* semantic pipeline
 * still work, not just "is the proxy reachable on a cheap path"?
 *
 * Sends process: 'observation-writer' so the proxy's processOverrides logic
 * routes the call through the SAME provider/model observation-writer would
 * use. That makes "is observation-writer effectively healthy?" the question
 * the brain badge answers, instead of the previous "is copilot/haiku
 * reachable" (which is true even when sonnet is being 429'd, leaving the
 * brain badge green while semantic work is silently broken).
 *
 * Important: this probe is INFORMATIONAL ONLY. It does NOT drive the
 * auto-heal FSM. An Anthropic 429 on sonnet is not a proxy outage — the
 * proxy is doing its job — and restarting it wouldn't help.
 *
 * Timeout 30s: CLI fallback for rate-limited sonnet runs ~14s; the cap
 * has to clear the slowest configured route by a comfortable margin or the
 * brain will flap amber every probe cycle.
 */
/**
 * Query the LLM proxy for the most recent observation-writer call timestamp.
 * Returns the age in ms since that call, or null when no row exists or the
 * call fails. Used as the "real-traffic" gate that decides whether to fire
 * the synthetic strong probe (which costs ~14-22K tokens on the CLI fallback
 * path) or skip it because real traffic has already proven the pipeline works.
 *
 * Short timeout (3s) because the proxy's token-usage endpoints are sub-10ms
 * SQL reads — anything slower is a sign of trouble and we should fail open
 * and fall through to the synthetic probe.
 */
async function fetchLastObservationWriterCallAge() {
  try {
    // limit=10 gives us headroom to skip over our own recent probe calls
    // (which also appear in the proxy's token-usage DB as observation-writer
    // rows with the same routing). A real call has output_tokens >> 4; the
    // probe always emits "OK" → 4 tokens. Threshold of 10 cleanly separates.
    const res = await fetch(
      `${PROXY_URL}/api/token-usage/recent?process=observation-writer&limit=10`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) return null;
    const body = await res.json();
    const rows = body?.data || [];
    // Find the most recent row that looks like a REAL call (substantial
    // output, ruling out the probe's 4-token "OK"). Without this filter the
    // probe would self-attest and never fire again — a worse failure mode
    // than burning tokens.
    const row = rows.find(r =>
      Number(r.output_tokens) > 10 &&
      r.timestamp && (r.prompt_preview || '').toLowerCase() !== 'say ok'
    );
    if (!row?.timestamp) return null;
    const t = new Date(row.timestamp).getTime();
    if (!Number.isFinite(t)) return null;
    return Date.now() - t;
  } catch (err) {
    // Re-throw so the caller can distinguish "proxy unreachable" from
    // "proxy says no observation-writer calls".
    throw err;
  }
}

/**
 * Query the LLM proxy for the most recent real (non-probe) LLM call from ANY
 * process — the cheap-probe counterpart of fetchLastObservationWriterCallAge.
 * Returns the age in ms since that call, or null when no qualifying row
 * exists. Throws when the proxy is unreachable so the caller falls through
 * to the synthetic probe (which will then fail fast and drive the FSM).
 */
async function fetchLastRealProxyCallAge() {
  const res = await fetch(
    `${PROXY_URL}/api/token-usage/recent?limit=20`,
    { signal: AbortSignal.timeout(3000) },
  );
  if (!res.ok) return null;
  const body = await res.json();
  const rows = body?.data || [];
  // A qualifying row is any successful call that is not one of our own
  // synthetic say-OK probes (cheap probe logs as health-coordinator, strong
  // probe as observation-writer — both carry the 'say OK' preview).
  const row = rows.find(r =>
    r.timestamp &&
    Number(r.output_tokens) > 0 &&
    (r.prompt_preview || '').toLowerCase() !== 'say ok'
  );
  if (!row?.timestamp) return null;
  const t = new Date(row.timestamp).getTime();
  if (!Number.isFinite(t)) return null;
  return Date.now() - t;
}

async function pollProxySemanticStrong() {
  const probeEndedAt = () => new Date().toISOString();
  const start = Date.now();
  // Set last_probe_end up-front so the scheduler's _strongAge check sees a
  // recent "attempt" and doesn't stack concurrent probes while this one is
  // in flight (the CLI fallback path can take 14s+, which is longer than
  // multiple tick cycles). The timestamp is overwritten at completion with
  // the real end time.
  currentState.proxy.semantic_strong_last_probe_end = probeEndedAt();
  const probeBody = {
    process: 'observation-writer',     // route through the configured pipeline
    messages: [{ role: 'user', content: 'say OK' }],
    maxTokens: 5
  };
  const prev = currentState.proxy.semantic_strong_ok;
  try {
    let r;
    try {
      r = await fetch(`${PROXY_URL}/api/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(probeBody),
        signal: AbortSignal.timeout(30_000)
      });
    } catch (err) {
      const elapsed = Date.now() - start;
      const reason = (err && (err.name === 'TimeoutError' || /aborted|timeout/i.test(err.message)))
        ? 'timeout' : `network_${err.message || 'error'}`;
      currentState.proxy.semantic_strong_ok = false;
      currentState.proxy.semantic_strong_round_trip_ms = elapsed;
      currentState.proxy.semantic_strong_reason = reason;
      currentState.proxy.semantic_strong_last_probe_end = probeEndedAt();
      if (prev !== false) log(`proxy semantic_strong_ok flip -> false (${reason})`, 'INFO');
      return;
    }
    const elapsed = Date.now() - start;
    currentState.proxy.semantic_strong_round_trip_ms = elapsed;
    currentState.proxy.semantic_strong_last_probe_end = probeEndedAt();
    if (!r.ok) {
      currentState.proxy.semantic_strong_ok = false;
      currentState.proxy.semantic_strong_reason = `http_${r.status}`;
      if (prev !== false) log(`proxy semantic_strong_ok flip -> false (http_${r.status})`, 'INFO');
      return;
    }
    let body;
    try { body = await r.json(); }
    catch (err) {
      currentState.proxy.semantic_strong_ok = false;
      currentState.proxy.semantic_strong_reason = 'empty_content';
      if (prev !== false) log(`proxy semantic_strong_ok flip -> false (empty_content/json-parse: ${err.message})`, 'INFO');
      return;
    }
    const content = (body?.choices?.[0]?.message?.content) ?? body?.content ?? body?.text ?? '';
    if (!content || typeof content !== 'string') {
      currentState.proxy.semantic_strong_ok = false;
      currentState.proxy.semantic_strong_reason = 'empty_content';
      if (prev !== false) log(`proxy semantic_strong_ok flip -> false (empty_content)`, 'INFO');
      return;
    }
    if (!/ok/i.test(content)) {
      currentState.proxy.semantic_strong_ok = false;
      currentState.proxy.semantic_strong_reason = 'oksub_missing';
      if (prev !== false) log(`proxy semantic_strong_ok flip -> false (oksub_missing — got: ${String(content).slice(0, 80)})`, 'INFO');
      return;
    }
    currentState.proxy.semantic_strong_ok = true;
    currentState.proxy.semantic_strong_reason = null;
    if (prev !== true) log(`proxy semantic_strong_ok flip -> true (${elapsed}ms)`, 'INFO');
  } finally {
    // Escalation gate — runs on every probe outcome (success, failure, throw).
    // Lets the cheap-probe FSM stay informational while still recovering from
    // failure modes a proxy restart actually fixes (the 2026-05-21 stale-env
    // scenario where copilot/haiku probe passed but observation-writer's
    // claude-code path returned 'fetch failed' in 3-7ms for 9+ hours).
    evaluateStrongProbeEscalation();
  }
}

// Recoverable-reason classifier shared between counter update + escalation.
// network_*: DNS/fetch/socket failure — usually fixed by re-resolving env on
//   restart. http_5xx: upstream/proxy temporary error — restart can clear
//   stuck connections. NOT included: 'timeout' (probably slow LLM, restart
//   won't help), 'empty_content'/'oksub_missing' (LLM scaffold problem),
//   'http_4xx' (rate limit / auth — upstream, restart won't help).
function isStrongProbeReasonRecoverable(reason) {
  if (!reason) return false;
  if (reason.startsWith('network_')) return true;
  if (/^http_5\d\d$/.test(reason)) return true;
  return false;
}

// Strong-probe escalation FSM — runs once per pollProxySemanticStrong outcome
// (via try/finally in the caller). Bridges the gap between the cheap-probe
// auto-heal FSM (which can miss stale-env / pipeline-only outages because
// the cheap probe goes via copilot+haiku) and a dispatch action that
// actually fixes them. Threshold of 2 consecutive failures keeps a single
// flaky probe from triggering a restart.
const STRONG_PROBE_ESCALATION_THRESHOLD = 2;
function evaluateStrongProbeEscalation() {
  // Same kill-switch as the cheap-probe FSM (D-07).
  const rule = RULES?.rules?.services?.llm_cli_proxy;
  if (!rule || rule.auto_heal !== true) return;

  // Reset on success.
  if (currentState.proxy.semantic_strong_ok === true) {
    if (currentState.proxy.consecutive_strong_network_failures > 0) {
      log(`proxy strong-probe network-failure counter reset (was ${currentState.proxy.consecutive_strong_network_failures})`, 'INFO');
    }
    currentState.proxy.consecutive_strong_network_failures = 0;
    return;
  }

  // Reset on non-recoverable failure — those mean restart wouldn't help.
  const reason = currentState.proxy.semantic_strong_reason || '';
  if (!isStrongProbeReasonRecoverable(reason)) {
    if (currentState.proxy.consecutive_strong_network_failures > 0) {
      log(`proxy strong-probe failed with non-recoverable reason '${reason}' — counter reset (was ${currentState.proxy.consecutive_strong_network_failures})`, 'INFO');
    }
    currentState.proxy.consecutive_strong_network_failures = 0;
    return;
  }

  // Recoverable failure — increment counter.
  currentState.proxy.consecutive_strong_network_failures += 1;
  const count = currentState.proxy.consecutive_strong_network_failures;
  if (count < STRONG_PROBE_ESCALATION_THRESHOLD) {
    log(`proxy strong-probe recoverable failure ${count}/${STRONG_PROBE_ESCALATION_THRESHOLD} (reason='${reason}') — not yet escalating`, 'INFO');
    return;
  }

  // Threshold reached — gate through the same cooldown window the cheap-probe
  // FSM uses, so the two paths share kickstart-debt accounting.
  const now = Date.now();
  currentState.proxy.kickstart_timestamps = currentState.proxy.kickstart_timestamps
    .filter(ts => (now - ts) < PROXY_KICKSTART_WINDOW_MS);
  if (currentState.proxy.kickstart_timestamps.length >= PROXY_KICKSTART_MAX) {
    log(`proxy strong-probe escalation suppressed — ${currentState.proxy.kickstart_timestamps.length} kickstarts in last ${PROXY_KICKSTART_WINDOW_MS/1000}s (cooldown)`, 'WARN');
    return;
  }

  // Dispatch through the same remediation path as the cheap-probe FSM. Reset
  // the counter on dispatch so we don't fire on every subsequent probe within
  // the same outage — let the cooldown window govern repeats.
  currentState.proxy.kickstart_timestamps.push(now);
  currentState.proxy.kickstart_count += 1;
  currentState.proxy.consecutive_strong_network_failures = 0;
  log(`proxy strong-probe escalation: dispatching restart_llm_cli_proxy (consecutive_strong_failures=${count}, reason='${reason}', kickstart_count=${currentState.proxy.kickstart_count})`, 'INFO');
  getRemediationDispatcher()
    .then(d => d.executeAction('restart_llm_cli_proxy', { reason: `strong-probe ${reason}` }))
    .catch(err => log(`proxy strong-probe escalation kickstart failed: ${err.message}`, 'ERROR'));
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

  // Skip the kickstart action when the failure reason is upstream/LLM-side,
  // not proxy-side. Restarting the proxy won't make a slow LLM faster, won't
  // recover from rate-limit-driven 4xx, and won't fix empty-content / oksub-
  // missing responses. Dispatching anyway just opens a 3-8s window where the
  // listening port is gone and real ETM observation-writer calls land in
  // _fallbackSummary() — exactly the failure mode this code is trying to
  // prevent. Keep bookkeeping intact so the dashboard shows degraded but do
  // NOT push to kickstart_timestamps (no cooldown debt) and do NOT dispatch.
   const reason = currentState.proxy.reason || '';
   const NON_ACTIONABLE_REASONS = new Set(['timeout', 'empty_content', 'oksub_missing']);
   const isHttpClientError = /^http_4\d\d$/.test(reason);
   // After a recent Proxydetox auto-heal (network change), the LLM proxy's HTTP
   // connections are stale. In that case, "timeout" / "empty_content" ARE actionable
   // because a restart refreshes the connections. Detect via recent kickstart timestamps.
   const recentProxyHeal = (currentState.proxy.kickstart_timestamps || []).some(
     ts => (Date.now() - ts) < 120_000  // Proxydetox was kickstarted in last 2 minutes
   );
   if ((NON_ACTIONABLE_REASONS.has(reason) || isHttpClientError) && !recentProxyHeal) {
     currentState.proxy.auto_heal_status = 'kickstart_pending';
     log(`proxy auto-heal: skipping kickstart — reason='${reason}' is upstream/LLM-side, restart won't help (consecutive_failures=${currentState.proxy.consecutive_failures})`, 'INFO');
     return;
   }
   if (recentProxyHeal) {
     log(`proxy auto-heal: recent proxydetox heal detected — treating reason='${reason}' as actionable (stale connections after network change)`, 'INFO');
   }

  // Fire kickstart through the dispatcher (Pattern E — same code path as dashboard Restart button).
  currentState.proxy.kickstart_timestamps.push(now);
  currentState.proxy.kickstart_count += 1;
  currentState.proxy.auto_heal_status = 'kickstart_pending';
  log(`proxy auto-heal: dispatching restart_llm_cli_proxy (consecutive_failures=${currentState.proxy.consecutive_failures}, kickstart_count=${currentState.proxy.kickstart_count}, reason=${reason || 'unknown'})`, 'INFO');
  getRemediationDispatcher()
    .then(d => d.executeAction('restart_llm_cli_proxy', { reason: 'semantic_ok=false sustained' }))
    .catch(err => log(`proxy auto-heal kickstart failed: ${err.message}`, 'ERROR'));
}

// Hysteresis state for networkMode flip detection. The proxy's reported
// networkMode can oscillate around a threshold (e.g. PAC TCP latency hovering
// at ~47ms with a 30ms threshold) — without hysteresis every oscillation
// dispatches a kickstart, which on 2026-05-20 produced ~30 kickstarts in
// 30 minutes (08:08-08:37 CEST). Require 2 consecutive readings of the new
// mode before dispatching.
let pendingNetworkModeFlip = null;  // { from, to, count } or null
const NETWORK_MODE_FLIP_CONFIRM_TICKS = 2;

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
    const newMode = currentState.proxy.networkMode;
    const isRealTransition =
      realModes.has(prevMode) &&
      realModes.has(newMode) &&
      prevMode !== newMode;

    if (isRealTransition) {
      // Hysteresis: confirm the flip is stable before dispatching a kickstart.
      // Each consecutive tick that reports the same new mode increments the
      // pending counter. Once it reaches NETWORK_MODE_FLIP_CONFIRM_TICKS we
      // dispatch. An intervening reversion clears the pending state.
      if (
        pendingNetworkModeFlip &&
        pendingNetworkModeFlip.from === prevMode &&
        pendingNetworkModeFlip.to === newMode
      ) {
        pendingNetworkModeFlip.count += 1;
      } else {
        pendingNetworkModeFlip = { from: prevMode, to: newMode, count: 1 };
      }

      if (pendingNetworkModeFlip.count >= NETWORK_MODE_FLIP_CONFIRM_TICKS) {
        log(`proxy networkMode flip ${prevMode} -> ${newMode} confirmed (${pendingNetworkModeFlip.count} consecutive ticks), dispatching restart_llm_cli_proxy`, 'INFO');
        pendingNetworkModeFlip = null;
        getRemediationDispatcher()
          .then(d => d.executeAction('restart_llm_cli_proxy', { reason: 'networkMode-flip' }))
          .catch(err => log(`networkMode-flip kickstart failed: ${err.message}`, 'ERROR'));
      } else {
        log(`proxy networkMode flip ${prevMode} -> ${newMode} pending (${pendingNetworkModeFlip.count}/${NETWORK_MODE_FLIP_CONFIRM_TICKS})`, 'DEBUG');
      }
    } else if (pendingNetworkModeFlip && newMode === pendingNetworkModeFlip.from) {
      // Reversion: the new reading matches the prior stable mode, so the
      // pending flip was oscillation noise — clear it without dispatching.
      log(`proxy networkMode flip ${pendingNetworkModeFlip.from} -> ${pendingNetworkModeFlip.to} cancelled (mode reverted)`, 'DEBUG');
      pendingNetworkModeFlip = null;
    }
  } catch (err) {
    currentState.proxy.networkMode = 'unknown';
  }
}

// Hysteresis state for the location-vs-proxyMode staleness detector below.
let pendingProxyStaleMismatch = null;        // { class, count } or null
const PROXY_STALE_CONFIRM_TICKS = 3;         // sustained mismatch ticks before restart

// Collapse both network vocabularies onto two comparable classes. The
// coordinator's network.location speaks {corporate,vpn,open,unknown}; the
// proxy's self-reported networkMode speaks {corporate,vpn,public,unknown}.
// Returns null for anything not confidently classifiable (never comparable).
function classifyNetClass(v) {
  if (v === 'corporate' || v === 'vpn') return 'corporate';
  if (v === 'open' || v === 'home' || v === 'public' || v === 'direct') return 'public';
  return null;
}

/**
 * Restart the proxy when the host's authoritative network location disagrees
 * with the proxy's self-reported networkMode — i.e. the proxy is STALE after a
 * network switch it never re-detected.
 *
 * This complements the flip detector inside pollProxyMode(): that one only sees
 * transitions in the proxy's OWN self-report, which is frozen at proxy startup.
 * After a real host network switch (e.g. corporate -> home) the proxy keeps
 * reporting its boot-time mode with a dead HTTPS_PROXY baked in — every fetch()
 * then fails with "fetch failed", but the proxy never crashes, so launchd's
 * KeepAlive never restarts it. That is exactly the 2026-06-24 14-hour zombie
 * (HTTPS_PROXY=proxy.muc:8080 held over from a corporate startup). Comparing the
 * authoritative host location against the proxy's report catches it.
 *
 * Like the networkMode-flip path, this is a network-change response (a user
 * action), not a proxy-failure response, so it does NOT touch
 * kickstart_timestamps and is NOT gated by the failure cooldown.
 */
function evaluateProxyStaleness() {
  // Shares the proxy auto_heal kill-switch (D-07).
  const rule = RULES?.rules?.services?.llm_cli_proxy;
  if (!rule || rule.auto_heal !== true) { pendingProxyStaleMismatch = null; return; }

  const hostClass = classifyNetClass(currentState.network?.location);
  const proxyClass = classifyNetClass(currentState.proxy?.networkMode);

  // Only actionable when BOTH classes are known and disagree. An 'unknown' on
  // either side is transient (startup / probe error) and must never restart.
  if (!hostClass || !proxyClass || hostClass === proxyClass) {
    if (pendingProxyStaleMismatch) {
      log(`proxy staleness cleared (host=${currentState.network?.location} proxy=${currentState.proxy?.networkMode})`, 'DEBUG');
      pendingProxyStaleMismatch = null;
    }
    return;
  }

  // Confirmed-disagreement hysteresis — require N consecutive ticks so a
  // single-tick race between the two probes can't fire a needless restart.
  if (pendingProxyStaleMismatch && pendingProxyStaleMismatch.class === hostClass) {
    pendingProxyStaleMismatch.count += 1;
  } else {
    pendingProxyStaleMismatch = { class: hostClass, count: 1 };
  }

  if (pendingProxyStaleMismatch.count < PROXY_STALE_CONFIRM_TICKS) {
    log(`proxy stale: host=${hostClass} but proxy reports ${proxyClass} (${pendingProxyStaleMismatch.count}/${PROXY_STALE_CONFIRM_TICKS})`, 'DEBUG');
    return;
  }

  log(`proxy stale: host=${hostClass} but proxy frozen at ${proxyClass} for ${pendingProxyStaleMismatch.count} ticks — dispatching restart_llm_cli_proxy`, 'INFO');
  pendingProxyStaleMismatch = null;
  getRemediationDispatcher()
    .then(d => d.executeAction('restart_llm_cli_proxy', { reason: 'network-location-mismatch' }))
    .catch(err => log(`proxy staleness kickstart failed: ${err.message}`, 'ERROR'));
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
 * Project paths with an OpenCode session updated within the freshness window.
 * OpenCode stores sessions in ~/.local/share/opencode/opencode.db (a `session`
 * row has `directory` = project path and `time_updated` = epoch ms). This lets
 * the auto-spawner start an ETM for OpenCode-only projects that have no Claude
 * `.jsonl` transcript at all (e.g. rapid-automations). Fully guarded and
 * timeboxed — a missing db, missing sqlite3 CLI, or slow query yields an empty
 * set rather than blocking the coordinator tick. Bounded by a `time_updated`
 * predicate so the (multi-GB) DB is not fully scanned.
 */
function openCodeFreshProjects(now) {
  const homeDir = process.env.HOME;
  if (!homeDir) return new Set();
  const dbPath = path.join(homeDir, '.local', 'share', 'opencode', 'opencode.db');
  if (!fs.existsSync(dbPath)) return new Set();
  const cutoff = now - ETM_TRANSCRIPT_ACTIVE_MS;
  try {
    const out = spawnSync(
      'sqlite3',
      ['-readonly', dbPath, `SELECT DISTINCT directory FROM session WHERE time_updated > ${cutoff};`],
      { encoding: 'utf8', timeout: 3000 }
    );
    if (out.status !== 0 || !out.stdout) return new Set();
    const paths = new Set();
    for (const line of out.stdout.split('\n')) {
      const p = line.trim();
      if (p) paths.add(p);
    }
    return paths;
  } catch {
    return new Set();
  }
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
  const openCodeFresh = openCodeFreshProjects(now);

  for (const projectPath of discoverProjectCandidates(agenticDir)) {
    const projectName = path.basename(projectPath);
    if (coveredProjects.has(projectName)) continue;

    // Claude transcript freshness. Absence of the ~/.claude/projects dir is
    // NON-FATAL: OpenCode-only projects (e.g. rapid-automations) never have one
    // but still qualify via the OpenCode DB or a live tmux session below.
    let latestMtime = 0;
    const transcriptDir = path.join(claudeProjectsDir, encodeClaudeProjectDir(projectPath));
    if (fs.existsSync(transcriptDir)) {
      try {
        for (const f of fs.readdirSync(transcriptDir)) {
          if (!f.endsWith('.jsonl')) continue;
          const m = fs.statSync(path.join(transcriptDir, f)).mtime.getTime();
          if (m > latestMtime) latestMtime = m;
        }
      } catch {
        // Unreadable transcript dir → treat as no Claude transcript; other
        // signals (tmux / OpenCode) may still qualify the project.
      }
    }

    // Gate: spawn one ETM if the project shows activity on ANY source —
    //   - transcriptFresh: a Claude .jsonl written within the window
    //   - tmuxAlive:       an open tmux session rooted at this project
    //   - openCodeFresh:   an OpenCode session updated within the window
    // ETM itself then discovers the correct transcript (Claude .jsonl or the
    // OpenCode DB). The former hard `latestMtime === 0` guard is removed — it
    // defeated the tmux/OpenCode bypass for projects with no Claude transcript.
    const transcriptFresh = latestMtime > 0 && (now - latestMtime) <= ETM_TRANSCRIPT_ACTIVE_MS;
    const tmuxAlive = tmuxOpen.has(projectPath);
    const hasOpenCode = openCodeFresh.has(projectPath);
    if (!transcriptFresh && !tmuxAlive && !hasOpenCode) continue;

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
const NETWORK_PROBE_INTERVAL_MS = 15_000;

// Sleep/wake detection: if time between ticks exceeds 3x TICK_MS, we likely woke from sleep
let lastTickTimestamp = Date.now();
function detectWakeFromSleep() {
  const now = Date.now();
  const gap = now - lastTickTimestamp;
  lastTickTimestamp = now;
  if (gap > TICK_MS * 3) {
    log(`network: detected wake from sleep (gap=${Math.round(gap/1000)}s) — forcing immediate probe`, 'INFO');
    // Clear last_probe_end to force immediate re-probe
    currentState.network.last_probe_end = null;
    return true;
  }
  return false;
}

/**
 * Detect network location and proxy status — INDEPENDENTLY.
 *
 * N (network location): Where am I physically?
 *   - 'corporate' = on BMW corporate LAN (office Wi-Fi/Ethernet)
 *   - 'vpn'       = connected to BMW VPN from outside
 *   - 'open'      = home/public internet, no corporate access
 *   Detection: Cisco Secure Client VPN CLI (definitive) + DNS probe (fallback).
 *   NEVER depends on whether local proxy is running.
 *
 * P (proxy status): Is the local proxy active and functional?
 *   - Running = port 3128 listening AND proxy env vars set (user intent)
 *   - Functional = can actually proxy traffic (semantic probe elsewhere)
 *   NEVER influences N.
 */
async function pollNetworkStatus() {
  const netState = currentState.network;

  // ── P: Proxy status (independent of N) ──────────────────────────────────
   const proxyEnvSet = !!(process.env.http_proxy || process.env.https_proxy ||
                         process.env.HTTP_PROXY || process.env.HTTPS_PROXY);
   const portListening = await new Promise(resolve => {
     const sock = net.connect({ host: '127.0.0.1', port: 3128, timeout: 2000 });
     sock.once('connect', () => { sock.destroy(); resolve(true); });
     sock.once('error', () => resolve(false));
     sock.once('timeout', () => { sock.destroy(); resolve(false); });
   });

   // P: "Is proxy enabled?" — determined by user intent (the persistent toggle in ~/.bash_profile
   // written by ~/proxy.sh aka `px`). proxydetox is a launchctl daemon that's always running,
   // so port 3128 alone doesn't indicate intent. The bash_profile line is the ground truth:
   //   "http_proxy=..."  → enabled (user ran `px` to enable)
   //   "#http_proxy=..." → disabled (user ran `px` to disable)
   let proxyEnabledByUser = false;
   try {
     const bashProfile = fs.readFileSync(path.join(os.homedir(), '.bash_profile'), 'utf8');
     // If uncommented http_proxy= line exists, user enabled proxy
     proxyEnabledByUser = /^http_proxy=/m.test(bashProfile);
   } catch { /* file missing — treat as disabled */ }

    // Auto-heal: detect and fix two failure modes:
    //   1. Port dead (stale socket after sleep/wake) — portListening=false
    //   2. Port alive but proxy broken (Proxydetox confused after VPN disconnect / network change)
    //      — portListening=true but functional probe fails
    let effectivePortListening = portListening;
    let proxyFunctional = false;

    if (proxyEnabledByUser) {
      // Functional probe: actually try to proxy a request (not just TCP connect)
      if (portListening) {
        try {
          execSync('curl -s --connect-timeout 3 --max-time 5 -x http://127.0.0.1:3128 -o /dev/null -w "%{http_code}" https://api.github.com 2>/dev/null | grep -q 200', { timeout: 8000 });
          proxyFunctional = true;
        } catch {
          proxyFunctional = false;
        }
      }

      // Need kickstart if: port dead OR port alive but not functional
      const needsKickstart = !portListening || (portListening && !proxyFunctional);
      if (needsKickstart) {
        const reason = !portListening ? 'port 3128 dead (stale socket)' : 'port alive but proxy not functional (network change?)';
        log(`network: proxy intent=ON but ${reason} — kickstarting proxydetox`, 'WARN');
        try {
          execSync('launchctl kickstart -k gui/$(id -u)/cc.colorto.proxydetox 2>/dev/null || launchctl start cc.colorto.proxydetox 2>/dev/null', { timeout: 5000 });
          // Re-check after kickstart (give it 2s to bind + initialize)
          await new Promise(r => setTimeout(r, 2000));
          // Re-probe: port check
          const portNow = await new Promise(resolve => {
            const sock = net.connect({ host: '127.0.0.1', port: 3128, timeout: 2000 });
            sock.once('connect', () => { sock.destroy(); resolve(true); });
            sock.once('error', () => resolve(false));
            sock.once('timeout', () => { sock.destroy(); resolve(false); });
          });
          if (portNow) {
            // Re-probe: functional check
            try {
              execSync('curl -s --connect-timeout 3 --max-time 5 -x http://127.0.0.1:3128 -o /dev/null -w "%{http_code}" https://api.github.com 2>/dev/null | grep -q 200', { timeout: 8000 });
              proxyFunctional = true;
              log('network: proxydetox auto-healed — port 3128 listening and functional', 'INFO');
              // Force immediate semantic re-probe and LLM proxy restart on next tick
              // so the status line updates within 5-10s, not 60s
              currentState.proxy.last_probe_end = null;  // force immediate semantic re-probe
              currentState.proxy.consecutive_failures = 0;
            } catch {
              proxyFunctional = false;
              log('network: proxydetox kickstarted — port listening but still not functional', 'WARN');
            }
            // Also restart LLM proxy — its HTTP connections are stale after network change
            try {
              execSync(`launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy`, { timeout: 5000 });
              log('network: LLM proxy kickstarted after proxydetox auto-heal (stale connections)', 'INFO');
            } catch (e) {
              log(`network: LLM proxy kickstart failed: ${e.message}`, 'WARN');
            }
          } else {
            log('network: proxydetox kickstart failed — port still dead', 'WARN');
          }
          effectivePortListening = portNow;
        } catch (e) {
          log(`network: proxydetox kickstart error: ${e.message}`, 'ERROR');
          effectivePortListening = false;
        }
      }
    }

    // proxy_running = user enabled it AND proxydetox is actually listening AND functional
    netState.proxy_running = proxyEnabledByUser && effectivePortListening;
    netState.proxy_functional = proxyEnabledByUser ? proxyFunctional : false;
    netState.proxy_port_listening = effectivePortListening;  // raw: is proxydetox daemon alive?
    netState.proxy_env_set = proxyEnvSet;           // track separately for debugging
    netState.proxy_enabled_by_user = proxyEnabledByUser;  // the persistent toggle

  // ── N: Network location (independent of P) ─────────────────────────────
  // Strategy: 3 independent signals, evaluated in priority order.
  //   1. Cisco Secure Client VPN CLI — definitive "vpn" signal
  //   2. BMW PAC DNS resolution + latency — distinguishes corporate vs open
  //   3. utun interface presence — fallback VPN indicator

  // Signal 1: Cisco VPN state (most reliable)
  // Note: the vpn CLI drops into an interactive VPN> prompt after output,
  // so we must close stdin and use kill-on-timeout to avoid hanging.
  const vpnConnected = await new Promise(resolve => {
    const vpnBin = '/opt/cisco/secureclient/bin/vpn';
    let stdout = '';
    const child = spawn(vpnBin, ['state'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.on('close', () => resolve(/state:\s*Connected/i.test(stdout)));
    child.on('error', () => resolve(false));
    setTimeout(() => { try { child.kill(); } catch {} }, 3000);
  });

  // Signal 2: BMW PAC DNS resolution (indicates corporate network reachability)
  // IMPORTANT: Use execSync('dig') instead of dns.Resolver — Node's dns module
  // caches the system DNS servers from process startup and never re-reads them.
  // If the coordinator starts on a hotspot (public DNS), it will NEVER resolve
  // internal BMW hostnames even after switching to office LAN (corporate DNS).
  // 'dig' spawns a fresh process that uses the OS's current DNS configuration.
  const pacResolved = await new Promise(resolve => {
    try {
      const result = execSync('dig +short +timeout=2 +tries=1 muc.proxy-pac.bmwgroup.net A 2>/dev/null', { timeout: 4000, encoding: 'utf8' });
      const hasIP = /\d+\.\d+\.\d+\.\d+/.test(result.trim());
      resolve(hasIP);
    } catch {
      resolve(false);
    }
  });

  // Signal 3 (used only when PAC resolves): latency distinguishes physical CN vs VPN
  let onPhysicalCN = false;
  if (pacResolved && !vpnConnected) {
    // Only measure latency if VPN CLI didn't already tell us
    onPhysicalCN = await new Promise(resolve => {
      const start = Date.now();
      const sock = net.connect({ host: 'muc.proxy-pac.bmwgroup.net', port: 80, timeout: 2000 });
      sock.once('connect', () => { const ms = Date.now() - start; log(`network: PAC TCP latency=${ms}ms (threshold=100ms)`, 'DEBUG'); sock.destroy(); resolve(ms < 100); });
      sock.once('error', () => resolve(false));
      sock.once('timeout', () => { sock.destroy(); resolve(false); });
    });
  }

  // Determine location from signals (N is NEVER influenced by proxy/port state)
  if (vpnConnected) {
    netState.location = 'vpn';          // Cisco says connected — definitive
  } else if (pacResolved && onPhysicalCN) {
    netState.location = 'corporate';    // PAC resolves + low latency = on-site
  } else if (pacResolved) {
    netState.location = 'vpn';          // PAC resolves + high latency = VPN (CLI missed?)
  } else {
    netState.location = 'open';         // no corporate access whatsoever
  }

   log(`network: location=${netState.location} (vpnCli=${vpnConnected}, pac=${pacResolved}, physCN=${onPhysicalCN}, px=${effectivePortListening}, envSet=${proxyEnvSet})`, 'DEBUG');

   // Auto-manage proxy env vars in THIS process based on user intent (bash_profile toggle):
   // - User enabled proxy (px) + port listening → set env vars so our probes use proxy
   // - User disabled proxy → clear env vars so our probes go direct
   const onCorporateNet = netState.location === 'corporate' || netState.location === 'vpn';
    if (proxyEnabledByUser && effectivePortListening && !proxyEnvSet) {
     const proxyUrl = 'http://127.0.0.1:3128';
     process.env.http_proxy = proxyUrl;
     process.env.https_proxy = proxyUrl;
     process.env.HTTP_PROXY = proxyUrl;
     process.env.HTTPS_PROXY = proxyUrl;
     log(`network: auto-enabled proxy env vars (user enabled proxy, port 3128 listening)`, 'INFO');
   } else if (!proxyEnabledByUser && proxyEnvSet) {
     delete process.env.http_proxy;
     delete process.env.https_proxy;
     delete process.env.HTTP_PROXY;
     delete process.env.HTTPS_PROXY;
     log(`network: auto-disabled proxy env vars (user disabled proxy via px)`, 'INFO');
   }

   // 5. Check if proxy is functional (can actually CONNECT through to an external host)
   // Only test when user has proxy enabled — otherwise P:OFF (not ERR)
    if (proxyEnabledByUser && effectivePortListening) {
    netState.proxy_functional = await new Promise(resolve => {
      // Use CONNECT (actual tunnel) not plain GET (just checks if px process responds)
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
    });
  } else {
    netState.proxy_functional = false;
  }

  // 6. Can we reach the internet?
  // Strategy: on corporate/vpn, try via proxy; on open, try direct.
  // Always try direct as fallback if proxy path fails.
  netState.internet_reachable = await new Promise(resolve => {
    const tryDirect = () => {
      const req = https.get('https://api.github.com/', { timeout: 5000 }, res => {
        res.resume();
        resolve(res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    };

    if (netState.proxy_functional && proxyEnabledByUser) {
      // Try via proxy first, fall back to direct
      const proxyReq = http.request({
        host: '127.0.0.1', port: 3128,
        method: 'CONNECT', path: 'api.github.com:443',
        timeout: 5000
      });
      proxyReq.on('connect', (res) => {
        resolve(res.statusCode === 200);
        proxyReq.destroy();
      });
      proxyReq.on('error', () => tryDirect());
      proxyReq.on('timeout', () => { proxyReq.destroy(); tryDirect(); });
      proxyReq.end();
    } else {
      tryDirect();
    }
  });

  netState.last_probe_end = new Date().toISOString();

  // Also update proxy.networkMode to match (backwards compat for dashboard)
  currentState.proxy.networkMode = netState.location === 'open' ? 'public' : netState.location;

   log(`network: location=${netState.location} proxy_enabled=${proxyEnabledByUser} port_listening=${effectivePortListening} proxy_running=${netState.proxy_running} proxy_functional=${netState.proxy_functional} internet=${netState.internet_reachable}`);
}

async function runAllChecks() {
  // Detect sleep/wake transitions — forces immediate network re-probe
  detectWakeFromSleep();

  // ----- Network environment detection (every 15s, or 5s if proxy is broken) -----
  const _netProbeAge = currentState.network.last_probe_end
    ? Date.now() - new Date(currentState.network.last_probe_end).getTime()
    : Infinity;
  // Probe faster when proxy is enabled but not functional (healing in progress)
  const _proxyHealing = currentState.network.proxy_enabled && !currentState.network.proxy_functional;
  const _effectiveProbeInterval = _proxyHealing ? 5_000 : NETWORK_PROBE_INTERVAL_MS;
  if (_netProbeAge >= _effectiveProbeInterval) {
    try {
      // Hard ceiling: pollNetworkStatus must complete within 15s or we abandon it.
      // This prevents a single hanging socket/DNS from freezing the entire runAllChecks loop.
      await Promise.race([
        pollNetworkStatus(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('pollNetworkStatus timed out after 15s')), 15_000)),
      ]);
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

  // ----- Sub-agent capture aggregation (Phase 51 Plan 11) -----
  // Reads heartbeat files via lib/lsl/registry-reader.mjs + sweep state file
  // and stamps currentState.sub_agent_capture. Defensive — never throws even
  // when registry-reader / files are missing (status falls through to
  // 'unknown' / 'degraded' instead).
  try {
    await pollSubAgentCapture();
  } catch (err) {
    log(`sub_agent_capture probe threw: ${err.message}`, 'ERROR');
    currentState.sub_agent_capture = {
      status: 'unknown',
      reason: err.message,
      live_registrations: {
        claude: { running: 0, last_heartbeat_age_ms: null },
        opencode: { running: 0, last_heartbeat_age_ms: null },
        copilot: { running: 0, last_heartbeat_age_ms: null },
        mastra: { running: 0, available: false, reason: 'Path A not viable per RESEARCH-mastra.md' }
      },
      last_sweep_at: null,
      last_sweep_summary: null,
      registry_size: 0,
      copilot_lsl_incomplete_marker: true,
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

  // ----- Proxy staleness vs authoritative host location (network-switch heal) -----
  // pollProxyMode (above) only catches changes in the proxy's OWN self-report,
  // which is frozen at proxy startup. Compare the authoritative host location
  // against the proxy's report and restart on a sustained mismatch — the gap
  // that let the 2026-06-24 stale-corporate-proxy zombie survive 14h.
  try {
    evaluateProxyStaleness();
  } catch (err) {
    log(`proxy staleness check threw: ${err.message}`, 'ERROR');
  }

  // ----- Proxy semantic readiness (every 60s while ACTIVE; fully suspended while AFK — Plan 34-02 R1; Plan 34-03 auto-heal FSM) -----
  // Compute presence once and reuse for both the cheap and strong probe gates.
  // When AFK (_userActive === false) BOTH synthetic probes are skipped entirely
  // — see the AFK full-suspend note near PROXY_PROBE_INTERVAL_MS.
  const _userActive = userActiveNow();
  // Surface presence in /health/state so external AFK-gated background jobs
  // (e.g. the sub-agent-sweep launchd job) can suspend their own LLM work while
  // the operator is away — the coordinator is the single presence authority.
  currentState.user_active = _userActive;
  const _proxyProbeAge = currentState.proxy.last_probe_end
    ? Date.now() - new Date(currentState.proxy.last_probe_end).getTime()
    : Infinity;
  if (_userActive && _proxyProbeAge >= PROXY_PROBE_INTERVAL_MS) {
    // Real-traffic skip (2026-07-07, mirrors the strong probe below): a
    // recent successful real call through the proxy is strictly stronger
    // proof of /api/complete liveness than a synthetic say-OK. Only when the
    // pipeline is quiet does the synthetic probe fire — which is exactly the
    // "ping every now and then" cadence the probe exists to provide.
    let _realCallAgeMs = null;
    try {
      _realCallAgeMs = await fetchLastRealProxyCallAge();
    } catch (err) {
      // Proxy unreachable on the token-usage read — fall through to the
      // synthetic probe, which will classify the failure and drive the FSM.
      log(`proxy real-traffic check threw: ${err.message}; firing synthetic probe`, 'DEBUG');
    }
    if (_realCallAgeMs !== null && _realCallAgeMs < PROXY_PROBE_REAL_TRAFFIC_MAX_AGE_MS) {
      const prevSemantic = currentState.proxy.semantic_ok;
      currentState.proxy.semantic_ok = true;
      currentState.proxy.reason = 'recent-real-traffic';
      currentState.proxy.last_round_trip_ms = null;
      currentState.proxy.last_probe_end = new Date().toISOString();
      if (prevSemantic !== true) log(`proxy semantic_ok flip -> true (recent-real-traffic age=${Math.round(_realCallAgeMs / 1000)}s)`, 'INFO');
      evaluateAutoHealFSM();
    } else {
      try {
        await pollProxySemantic();
      } catch (err) {
        log(`proxy semantic probe threw: ${err.message}`, 'ERROR');
        currentState.proxy.semantic_ok = false;
        currentState.proxy.reason = err.message;
        currentState.proxy.last_probe_end = new Date().toISOString();
      }
    }
  }

  // 3b multi-tier: strong probe runs on a SEPARATE, much slower cadence
  // (5 min vs 60s) because under the per-model 429 rate-limit it falls
  // through to the CLI path and bills ~14-22K cache_creation tokens per
  // probe. Plus we SKIP the synthetic probe entirely when an actual
  // observation-writer call has succeeded in the last 5 minutes — real
  // traffic is a strictly stronger proof than a synthetic say-OK, and
  // it costs nothing because the user is already paying for those calls.
  // Fire-and-forget — the CLI fallback can take ~14s and must not serialize
  // the tick loop.
  const _strongAge = currentState.proxy.semantic_strong_last_probe_end
    ? Date.now() - new Date(currentState.proxy.semantic_strong_last_probe_end).getTime()
    : Infinity;
  if (_userActive && _strongAge >= PROXY_STRONG_PROBE_INTERVAL_MS) {
    // Query the proxy's token-usage DB for the most recent observation-writer
    // call. That timestamp is set the instant the LLM call completes — much
    // tighter than knowledge_pipeline.lastObservationAt which lags by 10-15s
    // (the observation-writer's own LLM call is itself slow via CLI fallback,
    // so by the time the DB row lands the synthetic-probe window has elapsed).
    fetchLastObservationWriterCallAge().then(realObsAgeMs => {
      if (realObsAgeMs !== null && realObsAgeMs < PROXY_STRONG_PROBE_REAL_TRAFFIC_MAX_AGE_MS) {
        // Recent real observation-writer LLM call proves the configured pipeline
        // works. Adopt that as the strong-probe success signal without spending
        // tokens on a synthetic say-OK.
        const prev = currentState.proxy.semantic_strong_ok;
        currentState.proxy.semantic_strong_ok = true;
        currentState.proxy.semantic_strong_reason = 'recent-real-traffic';
        currentState.proxy.semantic_strong_last_probe_end = new Date().toISOString();
        currentState.proxy.semantic_strong_round_trip_ms = null;
        if (prev !== true) log(`proxy semantic_strong_ok flip -> true (recent-real-traffic age=${Math.round(realObsAgeMs/1000)}s)`, 'INFO');
        return;
      }
      // No recent real traffic — fall back to the synthetic probe.
      pollProxySemanticStrong().catch(err => {
        log(`proxy semantic_strong probe threw: ${err.message}`, 'ERROR');
        currentState.proxy.semantic_strong_ok = false;
        currentState.proxy.semantic_strong_reason = `exception_${err.message || 'unknown'}`;
        currentState.proxy.semantic_strong_last_probe_end = new Date().toISOString();
      });
    }).catch(err => {
      // If the proxy probe itself is unreachable, don't silently skip — fall
      // through to the synthetic probe path (which will set its own state).
      log(`proxy token-usage probe threw: ${err.message}; firing synthetic`, 'WARN');
      pollProxySemanticStrong().catch(probeErr => {
        log(`proxy semantic_strong probe threw: ${probeErr.message}`, 'ERROR');
        currentState.proxy.semantic_strong_ok = false;
        currentState.proxy.semantic_strong_reason = `exception_${probeErr.message || 'unknown'}`;
        currentState.proxy.semantic_strong_last_probe_end = new Date().toISOString();
      });
    });
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
    // Reset network probe age so forceTick re-probes immediately (px toggle)
    currentState.network.last_probe_end = null;
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
// Phase 85-03: Experiment-executor host seam (D-01 amended / OQ3)
// =====================================================================
// The detached runner spawn + process-group cancel MUST run on the HOST
// (where the agent CLIs live) — the container has only `node` (Pitfall 4).
// The vkb-server container proxy (Plan 04) reaches these two endpoints over
// HTTP; the handlers delegate to lib/experiments/experiment-executor.mjs,
// which in turn delegates spawn→run-launch.launchRun and cancel→cancelRun,
// writes the terminal 'cancelled' progress patch via run-progress.writeProgress,
// and clears the run-owned active-measurement.json span (OQ3) so the D-02
// 409 slot frees even after a hard SIGKILL.
//
// V4 origin gate: accept the container (host-gateway, a NON-loopback private
// IP) AND host-side loopback callers; reject arbitrary EXTERNAL callers. Do
// NOT reuse the /test/* LOOPBACK_IPS gate — it would 403 the container proxy
// (85-PATTERNS V4 note). The coordinator port is not published beyond
// localhost / the Docker-desktop loopback, so a private-range origin is the
// container proxy, never a public caller.

/**
 * True when the request originates from the host (loopback) OR a container on
 * the Docker private network (host-gateway). Rejects public/external IPs.
 *
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function isExperimentOriginAllowed(req) {
  const raw = req.socket?.remoteAddress || '';
  // Normalize IPv4-mapped IPv6 (::ffff:127.0.0.1 → 127.0.0.1).
  const ip = raw.replace(/^::ffff:/, '');
  // Host-side loopback.
  if (ip === '127.0.0.1' || ip === '::1') return true;
  // RFC1918 / Docker private ranges (host-gateway origin): 10/8, 172.16–31/12,
  // 192.168/16. A container reaching the coordinator via host-gateway presents
  // one of these; an external caller cannot (port not published beyond localhost).
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  const m = /^172\.(\d{1,3})\./.exec(ip);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

let experimentExecutorModule = null;
async function getExperimentExecutor() {
  if (experimentExecutorModule) return experimentExecutorModule;
  experimentExecutorModule = await import('../lib/experiments/experiment-executor.mjs');
  return experimentExecutorModule;
}

// CR-01 (Phase 85 REVIEW): the coordinator is the real trust boundary — every co-resident
// container on the Docker bridge passes the broad RFC1918 origin gate, so run_id/run_dir MUST
// be validated HERE before they reach the executor's fs sinks. Mirror the container-side
// `_validRunId` charset+length bound and require run_dir to stay under .data/experiments/runs/.
const EXPERIMENT_RUN_ID_RE = /^[A-Za-z0-9._-]{1,12}$/;
const EXPERIMENT_RUNS_ROOT = path.resolve(REPO_ROOT, '.data', 'experiments', 'runs');
function isValidExperimentRunId(runId) {
  return typeof runId === 'string' && EXPERIMENT_RUN_ID_RE.test(runId) && runId !== '.' && runId !== '..';
}
function isContainedRunDir(runDir) {
  if (typeof runDir !== 'string' || runDir.length === 0) return false;
  const abs = path.isAbsolute(runDir) ? path.resolve(runDir) : path.resolve(REPO_ROOT, runDir);
  return abs === EXPERIMENT_RUNS_ROOT || abs.startsWith(EXPERIMENT_RUNS_ROOT + path.sep);
}

// POST /experiments/run — detached host spawn of the experiment runner (D-01).
//   body: { spec, run_id, run_dir, overrides? }
//   200: { ok: true, success: true, pid }
//   400: missing fields / bad request
//   403: external origin (V4 gate)
//   500: executor error
app.post('/experiments/run', async (req, res) => {
  if (!isExperimentOriginAllowed(req)) {
    log(`experiments/run rejected external origin ${req.socket?.remoteAddress}`, 'WARN');
    return res.status(403).json({ ok: false, error: 'origin not allowed' });
  }
  const { spec, run_id, run_dir, overrides } = req.body || {};
  if (!spec || !run_id || !run_dir) {
    return res.status(400).json({ ok: false, error: 'spec, run_id and run_dir required' });
  }
  // CR-01: reject a traversal-y run_id/run_dir BEFORE the executor touches the filesystem.
  if (!isValidExperimentRunId(run_id)) {
    log(`experiments/run rejected invalid run_id: ${JSON.stringify(run_id)}`, 'WARN');
    return res.status(400).json({ ok: false, error: 'invalid run_id' });
  }
  if (!isContainedRunDir(run_dir)) {
    log(`experiments/run rejected out-of-tree run_dir: ${JSON.stringify(run_dir)}`, 'WARN');
    return res.status(400).json({ ok: false, error: 'run_dir escapes .data/experiments/runs/' });
  }
  try {
    const { runExperiment } = await getExperimentExecutor();
    // hostEnv is the coordinator's OWN env — it already carries CODING_REPO,
    // LLM_PROXY_DATA_DIR, LLM_PROXY_PORT, CODING_PROXY_ROUTE (run-launch merges
    // the four contract vars from it onto the child's process.env).
    const result = await runExperiment({ spec, run_id, run_dir, overrides, env: process.env });
    // slot_busy = the HOST-side D-02 live-run guard (Phase 85-06) — a 409, not a 500.
    const status = result.success ? 200 : (result.slot_busy ? 409 : 500);
    return res.status(status).json({ ok: result.success, ...result });
  } catch (err) {
    log(`experiments/run threw: ${err.message}`, 'ERROR');
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /experiments/cancel — negated-pid group kill + terminal progress patch +
// OQ3 stale-span clear (Plan 02 cancelRun + Plan 01 writeProgress).
//   body: { run_id, run_dir, pid }
//   200: { ok: true, success: true, killed, span_cleared }
//   400: missing fields
//   403: external origin (V4 gate)
//   500: executor error
app.post('/experiments/cancel', async (req, res) => {
  if (!isExperimentOriginAllowed(req)) {
    log(`experiments/cancel rejected external origin ${req.socket?.remoteAddress}`, 'WARN');
    return res.status(403).json({ ok: false, error: 'origin not allowed' });
  }
  const { run_id, run_dir, pid } = req.body || {};
  if (!run_dir || pid === undefined || pid === null) {
    return res.status(400).json({ ok: false, error: 'run_dir and pid required' });
  }
  // CR-01: reject a traversal-y run_id/run_dir BEFORE the executor touches the filesystem.
  if (run_id !== undefined && run_id !== null && !isValidExperimentRunId(run_id)) {
    log(`experiments/cancel rejected invalid run_id: ${JSON.stringify(run_id)}`, 'WARN');
    return res.status(400).json({ ok: false, error: 'invalid run_id' });
  }
  if (!isContainedRunDir(run_dir)) {
    log(`experiments/cancel rejected out-of-tree run_dir: ${JSON.stringify(run_dir)}`, 'WARN');
    return res.status(400).json({ ok: false, error: 'run_dir escapes .data/experiments/runs/' });
  }
  try {
    const { cancelExperiment } = await getExperimentExecutor();
    const result = await cancelExperiment({ run_id, run_dir, pid, env: process.env });
    // CR-02: a pid that does not match the run's recorded run.json.pid is a 409 refusal,
    // not a 500 executor error — the request is well-formed but not authorized to signal it.
    const status = result.success ? 200 : (result.pid_mismatch ? 409 : 500);
    return res.status(status).json({ ok: result.success, ...result });
  } catch (err) {
    log(`experiments/cancel threw: ${err.message}`, 'ERROR');
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================================================================
// Phase 87-04 (Wave 2) — AVN-08/AVN-09: avenue merge-status / promote / prune host seam.
// =====================================================================
// State-changing git ops (promote/prune) MUST run on the HOST, never the container (Pitfall 6 /
// the 87-01 host-only trust boundary). These three endpoints mirror the /experiments/run
// delegation + the isExperimentOriginAllowed V4 gate above, and delegate to the fixed-argv
// primitives in lib/experiments/avenue-branch.mjs. Each takes { task_id }, re-validates it via the
// module's own sanitizeTaskId gate (task_id → git argv, T-87-04-05), and returns the primitive's
// JSON VERBATIM (no client recompute). The vkb-server container proxy (api-routes.js) reaches
// these over HTTP behind the same origin gate.

let avenueBranchModule = null;
async function getAvenueBranch() {
  if (avenueBranchModule) return avenueBranchModule;
  avenueBranchModule = await import('../lib/experiments/avenue-branch.mjs');
  return avenueBranchModule;
}

// The avenue primitives sanitize internally, but a well-shaped task_id is required BEFORE argv:
// reject an empty / non-string / '.'/'..' id at the coordinator boundary (mirror the module's
// sanitizeTaskId charset so an unmappable id is a 400, not a silently-coerced branch).
const AVENUE_TASK_ID_RE = /^[A-Za-z0-9._-]+$/;
function isValidAvenueTaskId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 80
    && AVENUE_TASK_ID_RE.test(id) && id !== '.' && id !== '..';
}

// POST /experiments/avenue-merge-status — READ-ONLY status compute (never mutates main).
//   body: { task_id }
//   200: { ok:true, state, ahead, behind, conflicts, branch }
//   400: missing/invalid task_id
//   403: external origin (V4 gate)
//   500: primitive error
app.post('/experiments/avenue-merge-status', async (req, res) => {
  if (!isExperimentOriginAllowed(req)) {
    log(`experiments/avenue-merge-status rejected external origin ${req.socket?.remoteAddress}`, 'WARN');
    return res.status(403).json({ ok: false, error: 'origin not allowed' });
  }
  const { task_id } = req.body || {};
  if (!isValidAvenueTaskId(task_id)) {
    log(`experiments/avenue-merge-status rejected invalid task_id: ${JSON.stringify(task_id)}`, 'WARN');
    return res.status(400).json({ ok: false, error: 'invalid task_id' });
  }
  try {
    const { avenueMergeStatus } = await getAvenueBranch();
    const result = avenueMergeStatus({ taskId: task_id, repoRoot: REPO_ROOT });
    return res.status(200).json({ ok: true, ...result }); // VERBATIM — no re-shaping
  } catch (err) {
    log(`experiments/avenue-merge-status threw: ${err.message}`, 'ERROR');
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /experiments/avenue-promote — STATE-CHANGING host-only merge (conflict-blocked).
//   body: { task_id }
//   200: { ok:true, promoted, reason?, conflicts? }
//   400: missing/invalid task_id
//   403: external origin (V4 gate)
//   500: primitive error
app.post('/experiments/avenue-promote', async (req, res) => {
  if (!isExperimentOriginAllowed(req)) {
    log(`experiments/avenue-promote rejected external origin ${req.socket?.remoteAddress}`, 'WARN');
    return res.status(403).json({ ok: false, error: 'origin not allowed' });
  }
  const { task_id } = req.body || {};
  if (!isValidAvenueTaskId(task_id)) {
    log(`experiments/avenue-promote rejected invalid task_id: ${JSON.stringify(task_id)}`, 'WARN');
    return res.status(400).json({ ok: false, error: 'invalid task_id' });
  }
  try {
    const { promoteAvenue } = await getAvenueBranch();
    const result = promoteAvenue({ taskId: task_id, repoRoot: REPO_ROOT });
    return res.status(200).json({ ok: true, ...result }); // VERBATIM — conflict-blocked in the primitive
  } catch (err) {
    log(`experiments/avenue-promote threw: ${err.message}`, 'ERROR');
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /experiments/avenue-prune — STATE-CHANGING host-only worktree+branch removal (on-demand).
//   body: { task_id }
//   200: { ok:true, removed }
//   400: missing/invalid task_id
//   403: external origin (V4 gate)
//   500: primitive error
app.post('/experiments/avenue-prune', async (req, res) => {
  if (!isExperimentOriginAllowed(req)) {
    log(`experiments/avenue-prune rejected external origin ${req.socket?.remoteAddress}`, 'WARN');
    return res.status(403).json({ ok: false, error: 'origin not allowed' });
  }
  const { task_id } = req.body || {};
  if (!isValidAvenueTaskId(task_id)) {
    log(`experiments/avenue-prune rejected invalid task_id: ${JSON.stringify(task_id)}`, 'WARN');
    return res.status(400).json({ ok: false, error: 'invalid task_id' });
  }
  try {
    const { pruneAvenueBranch } = await getAvenueBranch();
    const result = pruneAvenueBranch({ taskId: task_id, repoRoot: REPO_ROOT });
    return res.status(200).json({ ok: true, ...result }); // VERBATIM
  } catch (err) {
    log(`experiments/avenue-prune threw: ${err.message}`, 'ERROR');
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
