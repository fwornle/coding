#!/usr/bin/env node
/**
 * scripts/sub-agent-live-claude.mjs — Claude Code live-capture daemon.
 *
 * Phase 51 Plan 07 Task 2.
 *
 * Long-running supervisor that wires lib/lsl/live/claude-fs-watch.mjs to the
 * shared Plan 51-01 registry + an ObservationWriter, emits 30s heartbeats
 * to a state file consumed by Plan 51-11's health-coordinator surface, and
 * shuts down gracefully on SIGTERM/SIGINT.
 *
 * Per CONTEXT.md two-fix-paths: this daemon is the "do it right" Path A
 * tier. Path B (Plan 51-02 sweep) is the safety net for whatever the live
 * tier misses (daemon down, race condition, FSEvents reliability quirks per
 * RESEARCH-opencode.md landmine #2).
 *
 * Per CONTEXT.md D-Live-Sweep-Tags: observations from this tier carry
 * metadata.source='sub-agent' (NO -backfill suffix). The watcher module
 * stamps this; the daemon just wires it up.
 *
 * Per CLAUDE.md no-console-log rule: this CLI uses process.stderr.write
 * exclusively for forensic output.
 *
 * Plan 51-11 wires this daemon to launchd; until then it is hand-run for
 * testing.
 *
 * Usage:
 *   node scripts/sub-agent-live-claude.mjs --help
 *   node scripts/sub-agent-live-claude.mjs
 *   node scripts/sub-agent-live-claude.mjs --projects-dir ~/.claude/projects/-Users-Q284340-Agentic-coding
 *   node scripts/sub-agent-live-claude.mjs --state-file .data/sub-agent-live-state.json --heartbeat-interval 30
 *
 * Env:
 *   LSL_CLAUDE_PROJECTS_DIR   override projects-dir default
 *
 * Exit codes:
 *   0  graceful shutdown via SIGTERM/SIGINT
 *   1  error-budget exceeded (>10 errors within 60s) → supervisor should restart
 *   2  startup failure (e.g. invalid CLI args)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { createRegistry } from '../lib/lsl/registry.mjs';
import { startClaudeWatcher, stopClaudeWatcher } from '../lib/lsl/live/claude-fs-watch.mjs';

const DEFAULT_PROJECTS_DIR = process.env.LSL_CLAUDE_PROJECTS_DIR
  || path.join(os.homedir(), '.claude', 'projects', '-Users-Q284340-Agentic-coding');
const DEFAULT_STATE_FILE = path.join('.data', 'sub-agent-live-state.json');
const DEFAULT_HEARTBEAT_INTERVAL_S = 30;
const ERROR_BUDGET_LIMIT = 10;
const ERROR_BUDGET_WINDOW_MS = 60_000;

function parseStrArg(argv, flag, dflt = null) {
  const i = argv.indexOf(flag);
  if (i < 0) return dflt;
  return argv[i + 1] || dflt;
}

function parseIntArg(argv, flag, dflt) {
  const i = argv.indexOf(flag);
  if (i < 0) return dflt;
  const v = parseInt(argv[i + 1], 10);
  return Number.isFinite(v) ? v : dflt;
}

function hasFlag(argv, flag) {
  return argv.indexOf(flag) >= 0;
}

function printHelp() {
  const help = `Usage: sub-agent-live-claude.mjs [options]

Claude Code Path A (live) capture daemon. Watches the per-project
~/.claude/projects/<encoded-cwd>/ tree for new sub-agent JSONL files
and tails them to ObservationWriter in real time.

Options:
  --projects-dir <path>          Recursive watch root.
                                 Default: ${DEFAULT_PROJECTS_DIR}
  --state-file <path>            Heartbeat state file path.
                                 Default: ${DEFAULT_STATE_FILE}
  --heartbeat-interval <s>       Heartbeat write interval in seconds.
                                 Default: ${DEFAULT_HEARTBEAT_INTERVAL_S}
  --help                         Show this message and exit.

Signals:
  SIGTERM, SIGINT                Graceful shutdown — drains in-flight tails,
                                 writes a final heartbeat with shutdown_at,
                                 then exits 0.

Heartbeat file schema (Plan 51-11 consumer):
  {
    "agent": "claude",
    "last_heartbeat_at": "2026-05-27T12:34:56Z",
    "watched_dirs": 1,
    "active_tails": 3,
    "registered_subagents": 12,
    "registry_rows": [
      { "sub_hash": "abc1234", "parent_session_id": "...", "status": "running" }
    ]
  }
`;
  process.stdout.write(help);
}

/**
 * Atomic .tmp + rename write — matches Plan 50-03's lsl-resolver-job.sh
 * state-file pattern (T-51-07-HT mitigation).
 */
function atomicWriteJson(filePath, obj) {
  const parentDir = path.dirname(filePath);
  if (parentDir && parentDir !== '.' && !fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(obj, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * Build the heartbeat payload from the watcher handle and registry.
 */
function buildHeartbeatPayload({ handle, registry, extra = {} }) {
  const stats = handle.getStats();
  const rows = registry.listByAgent('claude').map((r) => ({
    sub_hash: r.sub_hash,
    parent_session_id: r.parent_session_id,
    status: r.status,
  }));
  return {
    agent: 'claude',
    last_heartbeat_at: new Date().toISOString(),
    watched_dirs: stats.watched,
    active_tails: stats.tailing,
    registered_subagents: stats.registered,
    registry_rows: rows,
    ...extra,
  };
}

async function main(argv) {
  if (hasFlag(argv, '--help') || hasFlag(argv, '-h')) {
    printHelp();
    return 0;
  }

  const projectsDir = parseStrArg(argv, '--projects-dir', DEFAULT_PROJECTS_DIR);
  const stateFile = parseStrArg(argv, '--state-file', DEFAULT_STATE_FILE);
  const heartbeatInterval = parseIntArg(argv, '--heartbeat-interval', DEFAULT_HEARTBEAT_INTERVAL_S);

  process.stderr.write(`[live-claude] starting daemon — projectsDir=${projectsDir} stateFile=${stateFile} heartbeat=${heartbeatInterval}s\n`);

  // Dynamic import kept so --help works without the live-logging layer.
  // 2026-07-06: writes go via obs-api (single km-core owner) — the bare
  // ObservationWriter constructor has had no standalone write path since
  // Phase 44 Plan 12 (LLM call spent, km-core write threw, nothing
  // persisted). ObservationApiClient.init() health-probes obs-api before
  // any LLM spend.
  let ObservationApiClient;
  try {
    ({ ObservationApiClient } = await import('../src/live-logging/ObservationApiClient.js'));
  } catch (err) {
    process.stderr.write(`[live-claude] failed to load ObservationApiClient: ${err.message}\n`);
    return 2;
  }

  const registry = createRegistry();
  let writer;
  try {
    writer = new ObservationApiClient();
    if (typeof writer.init === 'function') {
      await writer.init();
    }
  } catch (err) {
    // obs-api unreachable: fall back to a no-op writer so the daemon's
    // OTHER duties (registry heartbeats, Phase-69 token-row emission) keep
    // running. Observations resume on the next daemon restart with obs-api up.
    process.stderr.write(`[live-claude] ObservationApiClient init failed (${err.message}) — observations disabled, continuing\n`);
    writer = {
      init: async () => {},
      close: async () => {},
      processMessages: async () => ({ observations: 0, errors: 0 }),
    };
  }

  // --- Phase 69 (Plan 69-05 Task 1): token-row emission wiring (D-08).
  //
  // Dynamic-import the token modules — same guarded pattern as
  // ObservationWriter above so `--help` works without better-sqlite3 / the
  // proxy DB present. Construct a SECOND-writer token-db handle against the
  // proxy-owned token-usage.db. Everything here is best-effort: if the import
  // or the DB open fails, the daemon logs and runs WITHOUT token emission —
  // the LSL observation path is never affected (failure isolation).
  let tokenDb = null;
  let openTokenDb = null;
  let buildClaudeTokenRows = null;
  let insertTokenRowDeduped = null;
  let resolveLiveTaskIdSafe = null;
  let ADAPTER_USER_HASH_CLAUDE = null;
  try {
    ({ buildClaudeTokenRows } = await import('../lib/lsl/token/claude-token-rows.mjs'));
    ({ openTokenDb, insertTokenRowDeduped, ADAPTER_USER_HASH_CLAUDE } = await import('../lib/lsl/token/token-db.mjs'));
    ({ resolveLiveTaskIdSafe } = await import('../lib/lsl/token/task-id.mjs'));
    const dataDir = process.env.LLM_PROXY_DATA_DIR
      ?? path.join(process.cwd(), '.data');
    const tokenDbPath = path.join(dataDir, 'llm-proxy', 'token-usage.db');
    tokenDb = openTokenDb(tokenDbPath);
    process.stderr.write(`[live-claude] token emission enabled — db=${tokenDbPath}\n`);
  } catch (err) {
    tokenDb = null;
    process.stderr.write(`[live-claude] token emission disabled (non-fatal): ${err.message}\n`);
  }

  /**
   * Additive onTokenRow hook (D-08). Builds per-turn + per-reasoning-step rows
   * from the just-tailed Claude JSONL, stamps each with the LIVE task_id (via
   * the single span reader) + the distinct adapter user_hash, and inserts each
   * best-effort. The whole body is wrapped in try/catch so an emission failure
   * NEVER propagates back into the watcher's observation path or error budget;
   * the insert is itself best-effort (returns false, never throws).
   *
   * CR-01: buildClaudeTokenRows re-reads the ENTIRE JSONL and returns ALL rows,
   * and this hook fires once per paired exchange — so without dedup, exchange 1's
   * rows get re-inserted on every later exchange (O(n²) inflation). We use the
   * shared insertTokenRowDeduped which probes `(user_hash, tool_call_id)` and
   * inserts only absent rows, making the live path idempotent. Per-turn and
   * per-reasoning-step rows have DISTINCT tool_call_ids (`base` vs
   * `base:reason:N`) so they never collapse into each other.
   */
  async function onTokenRow({ fullPath }) {
    if (!tokenDb) return;
    try {
      const rows = buildClaudeTokenRows(fullPath);
      if (!rows || rows.length === 0) return;
      const liveTaskId = await resolveLiveTaskIdSafe();
      for (const row of rows) {
        row.task_id = liveTaskId;
        row.user_hash = ADAPTER_USER_HASH_CLAUDE;
        insertTokenRowDeduped(tokenDb, row);
      }
    } catch (err) {
      process.stderr.write(`[live-claude] onTokenRow failed (non-fatal): ${err.message}\n`);
    }
  }

  // Error-budget tracking — if onError fires > ERROR_BUDGET_LIMIT times in
  // ERROR_BUDGET_WINDOW_MS, the daemon exits 1 for the supervisor to restart
  // (T-51-07-DR mitigation).
  const errorTimestamps = [];
  function recordError(err) {
    const now = Date.now();
    errorTimestamps.push(now);
    while (errorTimestamps.length > 0 && now - errorTimestamps[0] > ERROR_BUDGET_WINDOW_MS) {
      errorTimestamps.shift();
    }
    process.stderr.write(`[live-claude] error: ${err && err.message ? err.message : String(err)}\n`);
    if (errorTimestamps.length > ERROR_BUDGET_LIMIT) {
      process.stderr.write(`[live-claude] too many errors (${errorTimestamps.length} in 60s); exiting for supervisor restart\n`);
      // Detach the heartbeat + watcher cleanly before exit.
      process.exitCode = 1;
      doShutdown('error-budget-exceeded').catch(() => { /* swallow */ });
    }
  }

  let handle;
  try {
    handle = await startClaudeWatcher({
      projectsDir,
      registry,
      observationWriter: writer,
      onError: recordError,
      // Phase 69 (Plan 69-05 Task 1): additive token-row hook (D-08 isolated).
      onTokenRow,
    });
  } catch (err) {
    process.stderr.write(`[live-claude] startClaudeWatcher failed: ${err.message}\n`);
    return 2;
  }

  process.stderr.write(`[live-claude] watcher attached; first heartbeat in ${heartbeatInterval}s\n`);

  // Heartbeat loop.
  let heartbeatTimer = null;
  function scheduleHeartbeat() {
    heartbeatTimer = setTimeout(() => {
      try {
        const payload = buildHeartbeatPayload({ handle, registry });
        atomicWriteJson(stateFile, payload);
        process.stderr.write(`[live-claude] heartbeat: watched=${payload.watched_dirs} tailing=${payload.active_tails} registered=${payload.registered_subagents}\n`);
      } catch (err) {
        recordError(err);
      }
      scheduleHeartbeat();
    }, heartbeatInterval * 1000);
    // Don't keep the event loop alive on heartbeats alone.
    if (heartbeatTimer && typeof heartbeatTimer.unref === 'function') {
      heartbeatTimer.unref();
    }
  }
  // Initial heartbeat write so consumers see liveness immediately.
  try {
    atomicWriteJson(stateFile, buildHeartbeatPayload({ handle, registry }));
  } catch (err) {
    recordError(err);
  }
  scheduleHeartbeat();

  // Shutdown plumbing.
  let shuttingDown = false;
  async function doShutdown(reason) {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`[live-claude] shutdown initiated: ${reason}\n`);
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
    try {
      await stopClaudeWatcher(handle);
    } catch (err) {
      process.stderr.write(`[live-claude] stopClaudeWatcher failed: ${err.message}\n`);
    }
    if (writer && typeof writer.close === 'function') {
      try {
        await writer.close();
      } catch (err) {
        process.stderr.write(`[live-claude] writer.close failed: ${err.message}\n`);
      }
    }
    // Phase 69: close the token-db second-writer handle (best-effort).
    if (tokenDb && typeof tokenDb.close === 'function') {
      try {
        tokenDb.close();
      } catch (err) {
        process.stderr.write(`[live-claude] tokenDb.close failed: ${err.message}\n`);
      }
    }
    // Final heartbeat with shutdown_at.
    try {
      atomicWriteJson(stateFile, buildHeartbeatPayload({
        handle,
        registry,
        extra: { shutdown_at: new Date().toISOString(), shutdown_reason: reason },
      }));
    } catch (err) {
      process.stderr.write(`[live-claude] final heartbeat write failed: ${err.message}\n`);
    }
    process.stderr.write(`[live-claude] shutdown complete\n`);
    process.exit(process.exitCode || 0);
  }

  process.on('SIGTERM', () => { doShutdown('SIGTERM'); });
  process.on('SIGINT', () => { doShutdown('SIGINT'); });
  process.on('uncaughtException', (err) => {
    process.stderr.write(`[live-claude] uncaughtException: ${err.stack || err.message}\n`);
    recordError(err);
  });
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`[live-claude] unhandledRejection: ${reason}\n`);
    recordError(new Error(String(reason)));
  });

  // The daemon stays alive via process.on(SIGTERM/SIGINT). The heartbeat
  // timer is unref'd, so the only thing keeping the process alive is the
  // fs.watch handle inside the watcher (which has its own backing event
  // listener).
  //
  // Return null to signal "stay running" to the entry-point harness; the
  // process exits via doShutdown's process.exit() call.
  return null;
}

const argv = process.argv.slice(2);
main(argv)
  .then((code) => {
    if (code !== null) process.exit(code);
    // null → keep running (signal handlers will exit).
  })
  .catch((err) => {
    process.stderr.write(`[live-claude] fatal: ${err.stack || err.message}\n`);
    process.exit(1);
  });
