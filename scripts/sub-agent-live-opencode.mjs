#!/usr/bin/env node
/**
 * scripts/sub-agent-live-opencode.mjs - OpenCode Path A live daemon.
 *
 * Phase 51 Plan 08 Task 2 (Wave 4). Long-running supervisor that wires the
 * Plan 51-08 startOpencodeWatcher into a daemon shape that mirrors Plan 51-07's
 * Claude FSEvents daemon (scripts/sub-agent-live-claude.mjs). Same heartbeat
 * cadence, same SIGTERM/SIGINT semantics, same atomic .tmp + rename for the
 * state-file write. Plan 51-11 wires this daemon to launchd alongside Plan
 * 51-07's claude daemon.
 *
 * CLI flags:
 *   --db-path <path>            default: ~/.local/share/opencode/opencode.db
 *   --project-root <path>       default: $CODING_REPO, else this checkout
 *   --state-file <path>         default: .data/sub-agent-live-state-opencode.json
 *   --poll-interval <ms>        default: 5000
 *   --heartbeat-interval <s>    default: 30
 *   --help                      print this banner and exit 0
 *
 * Heartbeat payload (every --heartbeat-interval seconds):
 *   {
 *     agent: 'opencode',
 *     last_heartbeat_at: <ISO>,
 *     polls: <int>,
 *     registered: <int>,
 *     last_poll_at: <ISO|''>,
 *     errors: <int>
 *   }
 *
 * Error budget (T-51-08-DR): >10 errors in 60s -> exit 1 for supervisor
 * restart. The supervisor (launchd in Plan 51-11) re-spawns the daemon.
 *
 * Per CLAUDE.md no-console-log rule: this script emits no console calls;
 * structured stderr writes provide operator forensic trail.
 *
 * Pure ESM. Zero new package installs.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { createRegistry } from '../lib/lsl/registry.mjs';
import opencodeStores from '../lib/lsl/opencode-dbs.cjs';
import {
  startOpencodeWatcher,
  stopOpencodeWatcher,
} from '../lib/lsl/live/opencode-sqlite-poll.mjs';

// ---- Argv parsing ---------------------------------------------------------
function parseArgs(argv) {
  const args = {
    dbPath: null,
    projectRoot: null,
    stateFile: null,
    pollIntervalMs: 5000,
    heartbeatIntervalSec: 30,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--db-path':
        args.dbPath = argv[++i];
        break;
      case '--project-root':
        args.projectRoot = argv[++i];
        break;
      case '--state-file':
        args.stateFile = argv[++i];
        break;
      case '--poll-interval': {
        const v = parseInt(argv[++i], 10);
        if (Number.isFinite(v) && v > 0) args.pollIntervalMs = v;
        break;
      }
      case '--heartbeat-interval': {
        const v = parseInt(argv[++i], 10);
        if (Number.isFinite(v) && v > 0) args.heartbeatIntervalSec = v;
        break;
      }
      default:
        // Ignore unknown flags - daemon should tolerate launchd's quirks.
        break;
    }
  }
  return args;
}

function printHelp() {
  const lines = [
    'sub-agent-live-opencode.mjs - OpenCode live (Path A) daemon',
    '',
    'Usage:',
    '  node scripts/sub-agent-live-opencode.mjs [options]',
    '',
    'Options:',
    '  --db-path <path>            opencode.db path',
    '                              (default: ~/.local/share/opencode/opencode.db)',
    '  --project-root <path>       project root to filter by',
    '                              (default: $CODING_REPO, else this checkout)',
    '  --state-file <path>         heartbeat state file',
    '                              (default: .data/sub-agent-live-state-opencode.json)',
    '  --poll-interval <ms>        poll cadence in ms (default: 5000)',
    '  --heartbeat-interval <s>    heartbeat cadence in seconds (default: 30)',
    '  --help, -h                  print this banner',
    '',
    'Heartbeat payload schema:',
    '  { agent, last_heartbeat_at, polls, registered, last_poll_at, errors,',
    '    cursor: { last_poll_time, last_seen_message_id_by_session } }',
    '',
    'The cursor is read back at startup so a restart resumes instead of',
    'replaying every historical sub-session through the observation writer.',
    '',
    'Atomic state-file write: <state-file>.tmp + renameSync swap.',
    'Graceful shutdown on SIGTERM / SIGINT.',
    'Error budget: >10 errors in 60s -> exit 1 (supervisor restart).',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

// ---- Resume cursor --------------------------------------------------------
/**
 * Read the previous run's cursor out of the heartbeat state file so the first
 * poll resumes instead of replaying the whole opencode.db. See the "Resume
 * cursor" block in lib/lsl/live/opencode-sqlite-poll.mjs for why.
 *
 * Every failure mode here — file absent, unreadable, not JSON, no cursor key —
 * returns undefined, which the watcher treats as a cold start. That is the
 * safe direction: a lost cursor costs a replay, a wrong one loses observations.
 */
function readCursorFromStateFile(filePath, key = 'cursor') {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return raw && typeof raw === 'object' ? raw[key] : undefined;
  } catch {
    return undefined;
  }
}

// ---- Atomic heartbeat write -----------------------------------------------
function atomicWriteJson(filePath, payload) {
  const parentDir = path.dirname(filePath);
  if (parentDir && parentDir !== '.' && !fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }
  // Temp name is pid-unique. `launchctl kickstart -k` overlaps the outgoing
  // process's shutdown write with the incoming one's first heartbeat, and with
  // a shared `<file>.tmp` those two interleave: A writes tmp, B overwrites tmp,
  // A renames, B renames — so a rename can publish the OTHER process's payload,
  // or a half-written one. rename(2) is atomic per path, which buys nothing
  // when two writers share the path. Observed on 2026-09-02 as a state file
  // that briefly disagreed with the daemon that had just written it.
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

// ---- Default path resolution ----------------------------------------------
function defaultDbPath() {
  return process.env.LSL_OPENCODE_DB
    || path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
}

function defaultProjectRoot() {
  return process.env.LSL_PROJECT_ROOT_CODING
    || path.join(os.homedir(), 'Agentic', 'coding');
}

function defaultStateFile() {
  return path.join('.data', 'sub-agent-live-state-opencode.json');
}

// ---- Main -----------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const dbPath = args.dbPath || defaultDbPath();
  const projectRoot = args.projectRoot || defaultProjectRoot();
  const stateFile = args.stateFile || defaultStateFile();
  // The agent box's exported snapshot (lib/lsl/opencode-dbs.cjs) is a second
  // store with its own cursor (`box_cursor`). --db / LSL_OPENCODE_DB pin one.
  const boxDb = (args.dbPath || process.env.LSL_OPENCODE_DB) ? null : opencodeStores.boxOpencodeDb();
  const anyStore = () => fs.existsSync(dbPath) || Boolean(boxDb && fs.existsSync(boxDb));

  // No db = opencode is not installed, or has never run. Wait for it instead of
  // exiting: under KeepAlive / Restart=always an exit is a restart every
  // ThrottleInterval for as long as opencode stays absent — a crash loop on
  // every machine without opencode (found by tests/cleanroom/services.sh).
  if (!anyStore()) {
    process.stderr.write(
      `[live-opencode] db not found: ${dbPath} — waiting for opencode to create it\n`,
    );
    while (!anyStore()) {
      await new Promise((r) => setTimeout(r, 60_000));
    }
    process.stderr.write('[live-opencode] db appeared\n');
  }

  const registry = createRegistry();

  // Error budget tracking (T-51-08-DR).
  const errorTimestamps = [];
  function trackError(err) {
    const nowMs = Date.now();
    errorTimestamps.push(nowMs);
    // Drop entries older than 60s.
    while (errorTimestamps.length > 0 && nowMs - errorTimestamps[0] > 60_000) {
      errorTimestamps.shift();
    }
    if (errorTimestamps.length > 10) {
      process.stderr.write(
        '[live-opencode] too many errors; exiting for supervisor restart\n',
      );
      process.exit(1);
    }
  }

  // Duck-typed writer wrapper so the daemon stays testable without the
  // live-logging layer during dry-run smoke. 2026-07-06: writes go via
  // obs-api (single km-core owner) — the former ObservationWriter({dbPath})
  // path died with Phase 44 Plan 12 (SQLite write path removed): the LLM
  // call was spent, then the km-core write threw, so nothing persisted.
  let observationWriter;
  try {
    const mod = await import('../src/live-logging/ObservationApiClient.js');
    observationWriter = new mod.ObservationApiClient();
    if (typeof observationWriter.init === 'function') {
      await observationWriter.init();
    }
  } catch (err) {
    process.stderr.write(
      `[live-opencode] ObservationApiClient init failed: ${err.message}\n`,
    );
    // Fall back to a no-op writer so the daemon still produces heartbeats
    // (useful in environments without the observations DB).
    observationWriter = {
      init: async () => {},
      close: async () => {},
      processMessages: async () => ({ observations: 0, errors: 0 }),
    };
  }

  // One watcher per store, started as soon as its store exists (a store that
  // appears later — the first boxed session — is picked up by the recheck).
  const stores = [{ dbPath, cursorKey: 'cursor', label: 'host', handle: null }];
  if (boxDb) stores.push({ dbPath: boxDb, cursorKey: 'box_cursor', label: 'box', handle: null });
  async function ensureWatchers() {
    for (const store of stores) {
      if (store.handle || store.starting || !fs.existsSync(store.dbPath)) continue;
      store.starting = true;
      const resumeCursor = readCursorFromStateFile(stateFile, store.cursorKey);
      process.stderr.write(
        `[live-opencode] watching ${store.dbPath} (${store.label}, poll=${args.pollIntervalMs}ms)\n`
        + (resumeCursor
          ? `[live-opencode] ${store.label}: resuming from cursor (last_poll_time=${resumeCursor.last_poll_time})\n`
          : `[live-opencode] ${store.label}: no cursor in state file — cold start, replaying history\n`),
      );
      try {
        store.handle = await startOpencodeWatcher({
          dbPath: store.dbPath,
          registry,
          observationWriter,
          projectRoot,
          cursor: resumeCursor,
          pollIntervalMs: args.pollIntervalMs,
          onError: (err) => {
            process.stderr.write(
              `[live-opencode] error (${store.label}): ${err && err.message ? err.message : String(err)}\n`,
            );
            trackError(err);
          },
        });
      } catch (err) {
        process.stderr.write(`[live-opencode] ${store.label}: cannot watch yet: ${err.message}\n`);
      } finally {
        store.starting = false;
      }
    }
  }
  await ensureWatchers();
  const recheckTimer = stores.length > 1 ? setInterval(() => { ensureWatchers(); }, 60_000) : null;
  recheckTimer?.unref?.();

  // ---- Heartbeat loop -----------------------------------------------------
  function writeHeartbeat(extra = {}) {
    const all = stores.map((st) => ({ st, stats: st.handle ? st.handle.getStats() : null }));
    const live = all.filter((a) => a.stats);
    const sum = (k) => live.reduce((n, a) => n + (Number(a.stats[k]) || 0), 0);
    const lastPoll = live.map((a) => a.stats.last_poll_at).filter(Boolean).sort().pop() ?? null;
    const payload = {
      agent: 'opencode',
      last_heartbeat_at: new Date().toISOString(),
      polls: sum('polls'),
      registered: registry.listByAgent('opencode').length,
      last_poll_at: lastPoll,
      errors: sum('errors'),
      // Resume point for the NEXT process, per store. Persisted here rather than
      // in a file of its own so there is exactly one state write to reason
      // about, and so the shutdown heartbeat checkpoints a clean stop for free.
      // A store not watched yet keeps the cursor it had.
      ...Object.fromEntries(all.map(({ st, stats }) => [
        st.cursorKey, stats ? stats.cursor : readCursorFromStateFile(stateFile, st.cursorKey),
      ])),
      // Phase 51 Plan 51-13 (CR-02): mirror Plan 51-07/51-09 daemons by
      // emitting registry_rows so lib/lsl/registry-reader.mjs:145 can
      // enumerate live OpenCode sub-agents. Without this, the registry
      // reader's `Array.isArray(hb.registry_rows)` guard returns [] for
      // OpenCode and `live_registrations.opencode.running` on /health/state
      // is permanently 0 regardless of real activity.
      //
      // ASYMMETRY (REVIEW.md line 132): Plans 51-07/51-09 OMIT `project`
      // from their row objects → registry-reader's project filter is
      // "permissive" (missing project = match). We INCLUDE `project` for
      // OpenCode so the filter is strict-correct rather than defensively-lax.
      // Cleanup of claude/copilot daemons to also stamp `project` is
      // deferred — out of scope for this gap-closure plan.
      registry_rows: registry.listByAgent('opencode').map((r) => ({
        sub_hash: r.sub_hash,
        parent_session_id: r.parent_session_id,
        status: r.status,
        project: r.project,
      })),
      ...extra,
    };
    try {
      atomicWriteJson(stateFile, payload);
    } catch (err) {
      process.stderr.write(
        `[live-opencode] heartbeat write failed: ${err.message}\n`,
      );
    }
  }

  writeHeartbeat();
  const heartbeatTimer = setInterval(
    writeHeartbeat,
    args.heartbeatIntervalSec * 1000,
  );

  // ---- Graceful shutdown --------------------------------------------------
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`[live-opencode] received ${signal}; shutting down\n`);
    clearInterval(heartbeatTimer);
    if (recheckTimer) clearInterval(recheckTimer);
    for (const store of stores) {
      if (!store.handle) continue;
      try {
        await stopOpencodeWatcher(store.handle);
      } catch (err) {
        process.stderr.write(
          `[live-opencode] stopOpencodeWatcher failed (${store.label}): ${err.message}\n`,
        );
      }
    }
    try {
      if (observationWriter && typeof observationWriter.close === 'function') {
        await observationWriter.close();
      }
    } catch { /* */ }
    writeHeartbeat({ shutdown_at: new Date().toISOString() });
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  process.stderr.write(
    `[live-opencode] fatal: ${err && err.message ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
