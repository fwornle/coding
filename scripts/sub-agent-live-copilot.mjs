#!/usr/bin/env node
/**
 * scripts/sub-agent-live-copilot.mjs — Copilot live tier daemon.
 *
 * Phase 51 Plan 09 Task 2.
 *
 * Long-running supervisor that wires lib/lsl/live/copilot-events-tail.mjs
 * (the Path A file-tail watcher) to the shared sub-agent registry +
 * ObservationWriter. Mirrors the Plan 51-07 (claude) and Plan 51-08 (opencode)
 * daemon shape — same CLI surface, same heartbeat schema, same SIGTERM
 * lifecycle, same error budget.
 *
 * Key difference vs. siblings (RESEARCH-copilot.md key finding, accepted):
 * the heartbeat payload carries `lsl_incomplete_marker_present: true` so
 * Plan 51-11 can render the degraded-parity badge in /health/state for the
 * Copilot tier — every Copilot live observation is a STUB containing only
 * spawn metadata + lifecycle outcome (the sub-agent's inner reasoning is
 * not persisted to events.jsonl by Copilot CLI v1.0.48).
 *
 * CLI usage:
 *   node scripts/sub-agent-live-copilot.mjs \
 *     --session-state-dir ~/.copilot/session-state \
 *     --project-root /Users/Q284340/Agentic/coding \
 *     --state-file .data/sub-agent-live-state-copilot.json \
 *     --scan-interval 10000 \
 *     --heartbeat-interval 30
 *
 * Per CLAUDE.md no-console-log rule: this module emits no console calls;
 * operator signalling goes through stderr writes only.
 *
 * Pure ESM. Zero new package installs.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { createRegistry } from '../lib/lsl/registry.mjs';
import { startCopilotWatcher, stopCopilotWatcher } from '../lib/lsl/live/copilot-events-tail.mjs';

const ERROR_BUDGET_WINDOW_MS = 60_000;
const ERROR_BUDGET_THRESHOLD = 10;

function printHelp() {
  process.stdout.write(`sub-agent-live-copilot — Copilot Path A live tier daemon

Usage:
  node scripts/sub-agent-live-copilot.mjs [flags]

Flags:
  --session-state-dir <path>   Root directory for Copilot session-state
                               (default: $LSL_COPILOT_SESSIONS_DIR or
                                ~/.copilot/session-state)
  --project-root <path>        Project root for project filter
                               (default: cwd)
  --state-file <path>          Heartbeat state file destination
                               (default: .data/sub-agent-live-state-copilot.json)
  --scan-interval <ms>         Live-session scan interval in ms
                               (default: 10000)
  --heartbeat-interval <s>     Heartbeat write cadence in seconds
                               (default: 30)
  --help                       Show this help and exit

Behavior:
  - Detects live Copilot sessions via inuse.<pid>.lock with 10-min stale grace
  - Tails events.jsonl per live session, parses subagent.started / .completed /
    .failed bookend events, writes stub observations
  - DEGRADED LSL PARITY: every observation carries lsl_incomplete=true because
    Copilot CLI does NOT persist sub-agent inner reasoning to disk
  - Heartbeat schema mirrors Plans 51-07 + 51-08 with an added
    \`lsl_incomplete_marker_present: true\` field surfaced to Plan 51-11

Signals:
  SIGTERM / SIGINT — graceful shutdown (drain in-flight writes, final heartbeat)

Exit codes:
  0 — clean shutdown
  1 — error budget exceeded (>10 errors in 60s) or bootstrap failure
`);
}

function parseArgs(argv) {
  const opts = {
    sessionStateDir: process.env.LSL_COPILOT_SESSIONS_DIR ||
      path.join(process.env.HOME || '', '.copilot', 'session-state'),
    projectRoot: process.cwd(),
    stateFile: path.join('.data', 'sub-agent-live-state-copilot.json'),
    scanIntervalMs: 10_000,
    heartbeatIntervalS: 30,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '--session-state-dir':
        opts.sessionStateDir = argv[++i];
        break;
      case '--project-root':
        opts.projectRoot = argv[++i];
        break;
      case '--state-file':
        opts.stateFile = argv[++i];
        break;
      case '--scan-interval':
        opts.scanIntervalMs = Number(argv[++i]);
        if (!Number.isFinite(opts.scanIntervalMs) || opts.scanIntervalMs <= 0) {
          process.stderr.write(`[live-copilot] invalid --scan-interval value\n`);
          process.exit(2);
        }
        break;
      case '--heartbeat-interval':
        opts.heartbeatIntervalS = Number(argv[++i]);
        if (!Number.isFinite(opts.heartbeatIntervalS) || opts.heartbeatIntervalS <= 0) {
          process.stderr.write(`[live-copilot] invalid --heartbeat-interval value\n`);
          process.exit(2);
        }
        break;
      default:
        process.stderr.write(`[live-copilot] unknown flag: ${a}\n`);
        process.exit(2);
    }
  }
  return opts;
}

/**
 * Atomic write — produces the .tmp sibling and renames into place so partial
 * writes never corrupt the file Plan 51-11 reads. Mirrors Plan 50-03's
 * lsl-resolver-job.sh state-file pattern (T-51-09-HT, equivalent to
 * Plan 51-07 T-51-07-HT).
 */
function atomicWriteJSON(filePath, obj) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, filePath);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  process.stderr.write(`[live-copilot] starting watcher on ${opts.sessionStateDir}\n`);
  process.stderr.write(`[live-copilot] project root: ${opts.projectRoot}\n`);
  process.stderr.write(`[live-copilot] scan interval: ${opts.scanIntervalMs}ms\n`);
  process.stderr.write(`[live-copilot] heartbeat: ${opts.heartbeatIntervalS}s -> ${opts.stateFile}\n`);

  // Bootstrap registry + writer.
  const registry = createRegistry();

  // Writer lazy-imported to keep --help fast. 2026-07-06: writes go via
  // obs-api (single km-core owner) — the bare ObservationWriter constructor
  // has had no standalone write path since Phase 44 Plan 12 (LLM call spent,
  // km-core write threw, nothing persisted). ObservationApiClient.init()
  // health-probes obs-api before any LLM spend.
  let ObservationWriterCtor;
  try {
    ({ ObservationApiClient: ObservationWriterCtor } = await import('../src/live-logging/ObservationApiClient.js'));
  } catch (err) {
    process.stderr.write(`[live-copilot] failed to load ObservationApiClient: ${err.message}\n`);
    process.exit(1);
  }
  let writer = new ObservationWriterCtor();
  if (typeof writer.init === 'function') {
    try {
      await writer.init();
    } catch (err) {
      // obs-api unreachable: fall back to a no-op writer so the daemon's
      // OTHER duties (registry heartbeats, Phase-69 token-row emission) keep
      // running. Observations resume on the next daemon restart with obs-api up.
      process.stderr.write(`[live-copilot] writer init failed (${err.message}) — observations disabled, continuing\n`);
      writer = {
        init: async () => {},
        close: async () => {},
        processMessages: async () => ({ observations: 0, errors: 0 }),
      };
    }
  }

  // --- Phase 69 (Plan 69-06 Task 1): token-row emission wiring (D-08).
  //
  // Dynamic-import the token modules — same guarded pattern as ObservationWriter
  // above so `--help` works without better-sqlite3 / the proxy DB present.
  // Construct a SECOND-writer token-db handle against the proxy-owned
  // token-usage.db. Everything here is best-effort: if the import or DB open
  // fails, the daemon logs and runs WITHOUT token emission — the LSL/observation
  // path is never affected (failure isolation).
  let tokenDb = null;
  let buildCopilotTokenRows = null;
  let insertTokenRowDeduped = null;
  let resolveLiveTaskIdSafe = null;
  let ADAPTER_USER_HASH_COPILOT = null;
  try {
    let checkCopilotVocabulary;
    let warnOnVersionDrift;
    ({ buildCopilotTokenRows, checkCopilotVocabulary, warnOnVersionDrift } =
      await import('../lib/lsl/token/copilot-token-rows.mjs'));
    const tokenDbMod = await import('../lib/lsl/token/token-db.mjs');
    insertTokenRowDeduped = tokenDbMod.insertTokenRowDeduped;
    ADAPTER_USER_HASH_COPILOT = tokenDbMod.ADAPTER_USER_HASH_COPILOT;
    ({ resolveLiveTaskIdSafe } = await import('../lib/lsl/token/task-id.mjs'));

    const dataDir = process.env.LLM_PROXY_DATA_DIR
      ?? path.join(process.cwd(), '.data');
    const tokenDbPath = path.join(dataDir, 'llm-proxy', 'token-usage.db');
    tokenDb = tokenDbMod.openTokenDb(tokenDbPath);
    process.stderr.write(`[live-copilot] token emission enabled — db=${tokenDbPath}\n`);

    // One-time event-vocabulary verdict + version-drift warning (D-04 / D-09).
    // The verdict is informational here — per-session-aggregate is the only
    // viable tier on v1.0.63; a drift warning prompts a re-probe on CLI upgrade.
    try {
      const installed = process.env.COPILOT_CLI_VERSION;
      if (installed) warnOnVersionDrift(installed);
      void checkCopilotVocabulary; // available for an opt-in startup probe
    } catch (err) {
      process.stderr.write(`[live-copilot] vocabulary probe skipped (non-fatal): ${err.message}\n`);
    }
  } catch (err) {
    tokenDb = null;
    process.stderr.write(`[live-copilot] token emission disabled (non-fatal): ${err.message}\n`);
  }

  /**
   * Additive onTokenRow hook (D-08). Fired from the live tail on a
   * session.shutdown line; builds the per-session-aggregate rows from the
   * session's events.jsonl, stamps each with the LIVE task_id (via the single
   * span reader) + the distinct adapter user_hash, and inserts each best-effort.
   * The whole body is wrapped in try/catch so an emission failure NEVER
   * propagates back into the watcher's observation path; the insert is itself
   * best-effort (returns false, never throws).
   *
   * CR-01: the live tail may fire onTokenRow more than once for a session (and
   * the same session.shutdown aggregate could be re-emitted), so we use the
   * shared insertTokenRowDeduped which probes `(user_hash, tool_call_id)` and
   * inserts only absent rows. The Copilot tool_call_id is now session-scoped
   * (`<sessionUuid>:<model>`, CR-02) so distinct sessions on the same model do
   * NOT collapse into one another.
   *
   * @param {{eventsPath: string, event: object}} ctx
   */
  async function onTokenRow({ eventsPath } = {}) {
    if (!tokenDb || !eventsPath) return;
    try {
      const rows = buildCopilotTokenRows(eventsPath);
      if (!rows || rows.length === 0) return;
      const liveTaskId = await resolveLiveTaskIdSafe();
      for (const row of rows) {
        row.task_id = liveTaskId;
        row.user_hash = ADAPTER_USER_HASH_COPILOT;
        insertTokenRowDeduped(tokenDb, row);
      }
    } catch (err) {
      process.stderr.write(`[live-copilot] onTokenRow failed (non-fatal): ${err.message}\n`);
    }
  }

  // Error budget: bail if >10 errors in any rolling 60s window
  const errorTimes = [];
  const checkErrorBudget = () => {
    const now = Date.now();
    while (errorTimes.length > 0 && now - errorTimes[0] > ERROR_BUDGET_WINDOW_MS) {
      errorTimes.shift();
    }
    if (errorTimes.length > ERROR_BUDGET_THRESHOLD) {
      process.stderr.write(`[live-copilot] error budget exceeded (>${ERROR_BUDGET_THRESHOLD} in ${ERROR_BUDGET_WINDOW_MS}ms); exiting for supervisor restart\n`);
      process.exit(1);
    }
  };

  const onError = (err) => {
    errorTimes.push(Date.now());
    process.stderr.write(`[live-copilot] error: ${err && err.message ? err.message : String(err)}\n`);
    checkErrorBudget();
  };

  let handle;
  try {
    handle = await startCopilotWatcher({
      sessionStateDir: opts.sessionStateDir,
      registry,
      observationWriter: writer,
      projectRoot: opts.projectRoot,
      liveSessionScanIntervalMs: opts.scanIntervalMs,
      onError,
      // Phase 69 (Plan 69-06 Task 1): isolated session.shutdown token-row hook (D-08).
      onTokenRow,
    });
  } catch (err) {
    process.stderr.write(`[live-copilot] startCopilotWatcher failed: ${err.message}\n`);
    process.exit(1);
  }

  // Heartbeat loop
  const writeHeartbeat = (extra = {}) => {
    const stats = handle.getStats();
    const payload = {
      agent: 'copilot',
      last_heartbeat_at: new Date().toISOString(),
      watching_sessions: stats.watching_sessions,
      tail_count: stats.tail_count,
      registered: stats.registered,
      errors: stats.errors,
      last_scan_at: stats.last_scan_at,
      lsl_incomplete_marker_present: true,                // Plan 51-11 degraded-parity badge surface
      session_state_dir: opts.sessionStateDir,
      project_root: opts.projectRoot,
      registry_rows: registry.listByAgent('copilot').map((r) => ({
        sub_hash: r.sub_hash,
        parent_session_id: r.parent_session_id,
        status: r.status,
      })),
      ...extra,
    };
    try {
      atomicWriteJSON(opts.stateFile, payload);
    } catch (err) {
      process.stderr.write(`[live-copilot] heartbeat write failed: ${err.message}\n`);
    }
  };

  writeHeartbeat();
  const heartbeatTimer = setInterval(writeHeartbeat, opts.heartbeatIntervalS * 1000);
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`[live-copilot] received ${signal}; shutting down...\n`);
    clearInterval(heartbeatTimer);
    try {
      await stopCopilotWatcher(handle);
    } catch (err) {
      process.stderr.write(`[live-copilot] stop error: ${err.message}\n`);
    }
    try {
      if (writer && typeof writer.close === 'function') await writer.close();
    } catch (err) {
      process.stderr.write(`[live-copilot] writer close error: ${err.message}\n`);
    }
    // Phase 69 (Plan 69-06): close the token-db second-writer handle (best-effort).
    if (tokenDb && typeof tokenDb.close === 'function') {
      try {
        tokenDb.close();
      } catch (err) {
        process.stderr.write(`[live-copilot] tokenDb close error: ${err.message}\n`);
      }
    }
    // Final heartbeat with shutdown_at
    writeHeartbeat({ shutdown_at: new Date().toISOString() });
    process.stderr.write(`[live-copilot] shutdown complete\n`);
    process.exit(0);
  };

  process.on('SIGTERM', () => { shutdown('SIGTERM'); });
  process.on('SIGINT', () => { shutdown('SIGINT'); });

  // Keep process alive (the timers' unref means we'd otherwise exit).
  // A dedicated unref-resistant interval that does nothing but tick:
  const keepalive = setInterval(() => {}, 1 << 30);
  // intentionally NOT unref'd — it pins the event loop.
  // Suppress unused-var lint:
  void keepalive;
}

main().catch((err) => {
  process.stderr.write(`[live-copilot] fatal: ${err && err.stack ? err.stack : String(err)}\n`);
  process.exit(1);
});
