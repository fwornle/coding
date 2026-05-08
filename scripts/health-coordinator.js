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
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runIfMain } from '../lib/utils/esm-cli.js';
import { createRotatingLogger } from '../lib/utils/log-rotator.js';
import { probeHttpHealth, probeTcpPort } from '../lib/utils/service-probe.js';
import ProcessStateManager from './process-state-manager.js';

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
  processes: [],
  databases: { status: 'unknown' },
  files: [],
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
async function runAllChecks() {
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
        qdrant: dbStatus?.qdrant
      };
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

  // processes: signal-driven (existing path). Rule iteration ensures each
  // enabled rule has an entry in currentState.processes even before its
  // first signal.
  if (!Array.isArray(currentState.processes)) currentState.processes = [];
  await forEachEnabledRule('processes', async (name, _rule) => {
    const idx = currentState.processes.findIndex(p => p.name === name);
    if (idx < 0) {
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
    await forceTick();
    res.json(currentState);
  } catch (err) {
    // SPEC R6: surface failure, never mask as healthy.
    res.status(500).json({ ok: false, error: err.message });
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
