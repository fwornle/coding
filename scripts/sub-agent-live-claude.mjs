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

  // Dynamic import ObservationWriter — its constructor opens a DB, which can
  // fail at startup. Keep the import out of the top of file so --help works
  // even when the DB layer is unavailable (e.g. in a test fixture without
  // SQLite).
  let ObservationWriter;
  try {
    ({ ObservationWriter } = await import('../src/live-logging/ObservationWriter.js'));
  } catch (err) {
    process.stderr.write(`[live-claude] failed to load ObservationWriter: ${err.message}\n`);
    return 2;
  }

  const registry = createRegistry();
  let writer;
  try {
    writer = new ObservationWriter();
    if (typeof writer.init === 'function') {
      await writer.init();
    }
  } catch (err) {
    process.stderr.write(`[live-claude] ObservationWriter init failed: ${err.message}\n`);
    return 2;
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
