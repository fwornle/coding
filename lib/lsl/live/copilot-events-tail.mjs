/**
 * lib/lsl/live/copilot-events-tail.mjs — Copilot Path A (live) watcher.
 *
 * Phase 51 Plan 09 Task 1.
 *
 * RESEARCH-copilot.md §Detection plan — Path A Option A1 (RECOMMENDED for
 * first ship): file-tail via fs.watchFile on
 * `~/.copilot/session-state/<uuid>/events.jsonl` for each session whose
 * directory contains an `inuse.<pid>.lock` (live-session indicator).
 *
 * CRITICAL — DEGRADED LSL PARITY (RESEARCH key finding, accepted):
 * Copilot CLI emits ONLY `subagent.started` / `subagent.completed` /
 * `subagent.failed` lifecycle events on disk. The sub-agent's user/assistant
 * messages, tool calls, and intermediate reasoning are NEVER persisted to
 * events.jsonl. This means:
 *   - The stub observation produced here carries only spawn metadata + outcome.
 *   - Every observation is stamped `lsl_incomplete: true` + a locked note.
 *   - The inner reasoning is FOREVER LOST — no live mitigation possible.
 *   - Plan 51-11 surfaces this as a per-agent capability degradation in
 *     /health/state via the `lsl_incomplete_marker_present` heartbeat field.
 *
 * Per D-Live-Sweep-Tags: live observations carry `metadata.source = 'sub-agent'`
 * (NO `-backfill` suffix). Sweep observations from Plan 51-04 carry
 * `metadata.source = 'sub-agent-backfill'`. Both ALSO carry
 * `metadata.lsl_incomplete = true` for Copilot.
 *
 * Per D-Reuse: Phase 50 primitives (lib/lsl/window.mjs, lib/lsl/scan-and-convert.mjs)
 * are NOT imported. parseWorkspaceYaml + projectFromWorkspace + stripToolCallIdPrefix
 * are imported from the Plan 51-04 adapter (D-Reuse within Phase 51). The
 * parseCopilot v1.0.48 fix landed in Plan 51-04 is consumed via the adapter
 * helper readSubAgentEvents pattern — here we parse each appended line
 * directly via parseCopilot.
 *
 * Threat model:
 *   T-51-09-FI  uid-check on session dirs + events.jsonl files (defense-in-depth)
 *   T-51-09-LP  KNOWN GAP: degraded LSL parity for Copilot. Accepted with marker.
 *   T-51-09-RC  10-min mtime grace on inuse.<pid>.lock (RESEARCH landmine #5)
 *   T-51-09-PV  Parser version drift — inherits Plan 51-04 cross-version matrix.
 *   T-51-09-RL  CPU bounded by concurrent Copilot sessions (typically 1-5).
 *   T-51-09-AD  Provenance: parent_session_id + sub_index + sub_hash + agent +
 *               project + toolCallId + completion_status + detected_via.
 *   T-51-09-SC  Zero new package installs (fs.watchFile is Node stdlib).
 *
 * Pure ESM. Per CLAUDE.md no-console-log rule, this module emits no console
 * calls — operator signalling goes through stderr writes only.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  parseWorkspaceYaml,
  projectFromWorkspace,
  stripToolCallIdPrefix,
} from '../adapters/copilot-events.mjs';
import { parseCopilot } from '../../../src/live-logging/TranscriptNormalizer.js';

/**
 * Time window (ms) after which a stale `inuse.<pid>.lock` is treated as
 * evidence of a dead session (no live watcher started). Per RESEARCH-copilot.md
 * landmine #5: a hard-crashed Copilot session leaves the lock orphaned.
 */
const LOCK_STALE_GRACE_MS = 10 * 60 * 1000;

/**
 * fs.watchFile polling interval (ms). Matches Plan 51-07's per-file tail
 * pattern. 200ms is comfortable for human-interactive Copilot sessions; the
 * file size only grows by a few KB per turn.
 */
const TAIL_POLL_INTERVAL_MS = 200;

/**
 * Locked degraded-parity note string. Tests assert this verbatim.
 */
const COPILOT_LSL_INCOMPLETE_NOTE = 'Copilot CLI emits only lifecycle bookends';
const COPILOT_LSL_INCOMPLETE_REASON =
  'Copilot CLI emits only subagent.started/completed lifecycle events; ' +
  'inner reasoning not persisted to events.jsonl';

/**
 * Test whether a session directory contains a live `inuse.<pid>.lock` whose
 * mtime is within the LOCK_STALE_GRACE_MS window. Returns the lock filename
 * (relative to sessionDir) on success, null otherwise.
 *
 * @param {string} sessionDir
 * @returns {string|null}
 */
function findLiveLockFile(sessionDir) {
  let entries;
  try {
    entries = fs.readdirSync(sessionDir);
  } catch {
    return null;
  }
  const now = Date.now();
  for (const name of entries) {
    if (!/^inuse\.\d+\.lock$/.test(name)) continue;
    const lockPath = path.join(sessionDir, name);
    try {
      const st = fs.statSync(lockPath);
      if (now - st.mtimeMs <= LOCK_STALE_GRACE_MS) {
        return name;
      }
    } catch {
      // unreadable lock — skip
    }
  }
  return null;
}

/**
 * Verify session dir is owned by the current uid. Defensive guard against
 * traversal into another user's Copilot state (T-51-09-FI).
 *
 * Returns true if owned (or uid check unavailable / non-POSIX); false if
 * mismatched.
 */
function isOwnedByMe(sessionDir, myUid) {
  if (myUid == null) return true; // non-POSIX (e.g. Windows): skip the check
  try {
    const st = fs.statSync(sessionDir);
    if (typeof st.uid === 'number' && st.uid !== myUid) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

/**
 * scanForLiveSessions — list session directories under sessionStateDir that
 * have a live (non-stale) inuse.<pid>.lock AND belong to the current uid.
 *
 * @param {string} sessionStateDir
 * @param {number|null} myUid
 * @returns {Array<{sessionId: string, sessionDir: string}>}
 */
function scanForLiveSessions(sessionStateDir, myUid) {
  let entries;
  try {
    entries = fs.readdirSync(sessionStateDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const live = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sessionId = entry.name;
    const sessionDir = path.join(sessionStateDir, sessionId);

    if (!isOwnedByMe(sessionDir, myUid)) {
      process.stderr.write(`[live-copilot] skipping non-owned session ${sessionId}\n`);
      continue;
    }
    const lockName = findLiveLockFile(sessionDir);
    if (!lockName) continue;
    live.push({ sessionId, sessionDir });
  }
  return live;
}

/**
 * Read workspace.yaml from a session dir; returns the parsed object or null
 * if absent/unreadable.
 */
function readWorkspace(sessionDir) {
  const workspacePath = path.join(sessionDir, 'workspace.yaml');
  if (!fs.existsSync(workspacePath)) return null;
  try {
    const text = fs.readFileSync(workspacePath, 'utf8');
    return parseWorkspaceYaml(text);
  } catch {
    return null;
  }
}

/**
 * Decide if a session's project matches the projectRoot filter.
 *
 * The projectRoot may be a path (`/Users/Q284340/Agentic/coding`) or a
 * basename (`coding`). We compare against the workspace.yaml git_root /
 * cwd. Sessions whose project resolves to 'unknown' (no workspace.yaml) are
 * also skipped when a filter is active — this saves resources for stray
 * Copilot sessions that don't belong to this project.
 */
function projectMatches(workspaceYaml, projectRoot) {
  if (!projectRoot) return true;
  const sessionProject = projectFromWorkspace(workspaceYaml);
  if (!sessionProject || sessionProject === 'unknown') return false;
  const expectedBase = path.basename(projectRoot);
  return sessionProject === expectedBase;
}

/**
 * Per-tail state for one session's events.jsonl.
 *
 * @typedef {Object} TailState
 * @property {string}        sessionId
 * @property {string}        sessionDir
 * @property {string}        eventsPath
 * @property {string}        project
 * @property {number}        lastReadSize
 * @property {string}        residual   - partial trailing line from last chunk
 * @property {Map<string, {sub_hash:string, started_at:string, agentName:string,
 *                         agentDisplayName:string|undefined, agentDescription:string|undefined}>} watching
 *                         - by toolCallId, open sub-agent rows awaiting completion
 * @property {boolean}       closed
 * @property {Promise[]}     pending     - in-flight observation writes (for drain)
 */

/**
 * Build the stub-observation payload (synthetic 2-message exchange).
 * Locked by Test 6 + the plan's <interfaces> stub-observation shape.
 */
function buildStubObservation({
  agentName, agentDescription, started_at, completed_at, completion_status,
}) {
  const desc = agentDescription ? String(agentDescription).slice(0, 200) : '';
  const summary =
    `Copilot sub-agent ${agentName || 'unknown'} spawned at ${started_at}; ` +
    `${completion_status || 'running'} at ${completed_at || 'n/a'}. ${desc}`.trim();
  const userMsg = {
    role: 'user',
    content: `[Copilot sub-agent invocation: ${agentName || 'unknown'}]`,
    createdAt: started_at,
  };
  const asstMsg = {
    role: 'assistant',
    content: `${agentDescription || agentName || 'sub-agent'}\n\n(Status: ${completion_status || 'unknown'})`,
    createdAt: completed_at || started_at,
  };
  return { messages: [userMsg, asstMsg], summary };
}

/**
 * tailEventsFile — start an fs.watchFile-based tail on events.jsonl. Returns
 * a `stop()` function. On each new appended line, invokes callbacks for
 * subagent.started / .completed / .failed events.
 *
 * Phase 69 (Plan 69-06 Task 1): an OPTIONAL `cfg.onTokenRow({ eventsPath, event })`
 * hook fires on a `session.shutdown` line (the per-session-aggregate token-row
 * source, D-04). It is wrapped in the SAME
 * `Promise.resolve(...).catch(...)` isolation pattern used for the subagent
 * dispatch — BUT a token-write failure routes to a dedicated
 * `[copilot-events-tail] onTokenRow threw (non-fatal): <msg>` stderr line, NOT
 * into the subagent `onError` path (D-08 failure isolation: token emission can
 * never crash or pollute the LSL/observation path).
 *
 * @param {object} cfg
 * @param {string} cfg.eventsPath
 * @param {(line: object) => Promise<void>} cfg.onSubagentStarted
 * @param {(line: object) => Promise<void>} cfg.onSubagentEnded
 * @param {(err: Error) => void} cfg.onError
 * @param {(ctx: {eventsPath: string, event: object}) => Promise<void>} [cfg.onTokenRow]
 * @returns {{ stop: () => Promise<void>, getCount: () => number }}
 */
function tailEventsFile({ eventsPath, onSubagentStarted, onSubagentEnded, onError, onTokenRow }) {
  let lastSize = 0;
  let residual = '';
  let closed = false;
  let processedCount = 0;
  const inflight = [];

  try {
    const st = fs.statSync(eventsPath);
    lastSize = st.size;
    // Note: deliberately do NOT process pre-existing content — Path A is
    // strictly forward-looking. Pre-existing rows are the sweep's job (Plan 51-04).
  } catch {
    // file may not exist yet — fs.watchFile will pick up first write
  }

  const listener = (curr, prev) => {
    if (closed) return;
    if (curr.size <= lastSize) {
      lastSize = curr.size;
      return;
    }
    let fd;
    try {
      fd = fs.openSync(eventsPath, 'r');
      const len = curr.size - lastSize;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, lastSize);
      lastSize = curr.size;
      const chunk = residual + buf.toString('utf8');
      const parts = chunk.split('\n');
      residual = parts.pop() || '';
      for (const line of parts) {
        if (!line.trim()) continue;

        // Phase 69 (Plan 69-06 Task 1): session.shutdown branch. parseCopilot
        // returns null for lifecycle events, so the per-session-aggregate
        // token-row source is detected via a raw JSON.parse discriminator
        // (mirrors copilot-token-rows.mjs). The onTokenRow hook is OPTIONAL and
        // ISOLATED — a token-write failure goes to a dedicated stderr line, NOT
        // the subagent onError path (D-08).
        if (onTokenRow) {
          let evt;
          try {
            evt = JSON.parse(line);
          } catch {
            evt = null;
          }
          const evtType = evt && typeof evt === 'object' ? (evt.type || evt.event) : null;
          if (evtType === 'session.shutdown') {
            try {
              const p = Promise.resolve(onTokenRow({ eventsPath, event: evt })).catch((err) => {
                process.stderr.write(
                  `[copilot-events-tail] onTokenRow threw (non-fatal): ${err && err.message ? err.message : String(err)}\n`,
                );
              });
              inflight.push(p);
            } catch (err) {
              process.stderr.write(
                `[copilot-events-tail] onTokenRow threw (non-fatal): ${err && err.message ? err.message : String(err)}\n`,
              );
            }
          }
        }

        let parsed;
        try {
          parsed = parseCopilot(line);
        } catch {
          continue;
        }
        if (!parsed || parsed.type !== 'subagent') continue;
        processedCount++;
        try {
          if (parsed.subEventType === 'started') {
            const p = Promise.resolve(onSubagentStarted(parsed)).catch((err) => onError(err));
            inflight.push(p);
          } else if (parsed.subEventType === 'completed' || parsed.subEventType === 'failed') {
            const p = Promise.resolve(onSubagentEnded(parsed)).catch((err) => onError(err));
            inflight.push(p);
          }
        } catch (err) {
          onError(err);
        }
      }
    } catch (err) {
      onError(err);
    } finally {
      if (fd != null) {
        try { fs.closeSync(fd); } catch { /* noop */ }
      }
    }
  };

  fs.watchFile(eventsPath, { interval: TAIL_POLL_INTERVAL_MS, persistent: false }, listener);

  return {
    async stop() {
      closed = true;
      fs.unwatchFile(eventsPath, listener);
      // Drain inflight writes
      if (inflight.length > 0) {
        await Promise.allSettled(inflight);
      }
    },
    getCount: () => processedCount,
    drain: async () => {
      if (inflight.length > 0) await Promise.allSettled(inflight);
    },
  };
}

/**
 * startCopilotWatcher — start the live Copilot Path A watcher.
 *
 * @param {object}   opts
 * @param {string}   opts.sessionStateDir            default ~/.copilot/session-state
 * @param {object}   opts.registry                   sub-agent registry (Plan 51-01)
 * @param {object}   opts.observationWriter          ObservationWriter instance
 * @param {string}   opts.projectRoot                project root (path or basename)
 * @param {number}   [opts.liveSessionScanIntervalMs=10000]
 * @param {(err:Error)=>void} [opts.onError]
 * @param {(ctx:{eventsPath:string, event:object})=>Promise<void>} [opts.onTokenRow]
 *   Phase 69 (Plan 69-06): OPTIONAL isolated hook fired on a session.shutdown
 *   line — the per-session-aggregate token-row emission point (D-04 / D-08).
 * @returns {Promise<{stop: () => Promise<void>, getStats: () => object}>}
 */
export async function startCopilotWatcher({
  sessionStateDir,
  registry,
  observationWriter,
  projectRoot,
  liveSessionScanIntervalMs = 10_000,
  onError = (err) => process.stderr.write(`[live-copilot] error: ${err && err.message ? err.message : String(err)}\n`),
  onTokenRow,
} = {}) {
  if (!sessionStateDir) {
    sessionStateDir =
      process.env.LSL_COPILOT_SESSIONS_DIR ||
      path.join(process.env.HOME || '', '.copilot', 'session-state');
  }
  if (!registry) throw new TypeError('startCopilotWatcher: registry is required');
  if (!observationWriter) throw new TypeError('startCopilotWatcher: observationWriter is required');

  const myUid = typeof process.getuid === 'function' ? process.getuid() : null;

  /** @type {Map<string, TailState>} */
  const tails = new Map();
  const state = {
    tails,
    errors: 0,
    lastScanAt: null,
    closed: false,
  };
  /** in-flight writer.processMessages promises, awaited by stop() */
  const pendingWrites = [];

  const stripPrefixToHash = (toolCallId) => {
    // Use the adapter's stripToolCallIdPrefix helper (D-Reuse within Phase 51)
    return stripToolCallIdPrefix(toolCallId);
  };

  /**
   * Allocate a sub_index by counting existing copilot rows under the same
   * parent_session_id within this project.
   */
  function nextSubIndex(parent_session_id, project) {
    const siblings = registry.listByProject ? registry.listByProject(project) : [];
    const sameParent = siblings.filter(
      (r) => r && r.agent === 'copilot' && r.parent_session_id === parent_session_id,
    );
    return sameParent.length + 1;
  }

  /**
   * Ingest a subagent.started event. Idempotent via registry composite key.
   */
  async function ingestStarted(tail, evt) {
    const toolCallId = evt.toolCallId;
    if (!toolCallId) return;
    const sub_hash = stripPrefixToHash(toolCallId);
    if (!sub_hash) return;
    const sub_index = nextSubIndex(tail.sessionId, tail.project);
    const started_at = evt.timestamp || new Date().toISOString();

    registry.upsert({
      agent: 'copilot',
      sub_hash,
      parent_session_id: tail.sessionId,
      sub_index,
      transcript_path: tail.eventsPath,
      project: tail.project,
      status: 'running',
      detected_via: 'event-tail',
      agent_metadata: {
        toolCallId,
        agentName: evt.agentName,
        agentDisplayName: evt.agentDisplayName,
        agentDescription: evt.agentDescription,
        started_at,
        completed_at: null,
        completion_status: null,
        errorMessage: null,
        lsl_incomplete: true,
        lsl_incomplete_reason: COPILOT_LSL_INCOMPLETE_REASON,
        note: COPILOT_LSL_INCOMPLETE_NOTE,
      },
    });

    tail.watching.set(toolCallId, {
      sub_hash,
      sub_index,
      started_at,
      agentName: evt.agentName,
      agentDisplayName: evt.agentDisplayName,
      agentDescription: evt.agentDescription,
    });
  }

  /**
   * Ingest a subagent.completed / .failed event. Marks the row, writes the
   * stub observation (lifecycle bookend pair).
   */
  async function ingestEnded(tail, evt) {
    const toolCallId = evt.toolCallId;
    if (!toolCallId) return;
    const open = tail.watching.get(toolCallId);
    const sub_hash = open?.sub_hash || stripPrefixToHash(toolCallId);
    if (!sub_hash) return;

    const completion_status = evt.subEventType === 'completed' ? 'success' : 'error';
    const completed_at = evt.timestamp || new Date().toISOString();
    const errorMessage = evt.errorMessage || null;

    // Update registry — both the metadata (completion fields) and the
    // top-level status via markCompleted.
    const existing = registry.get('copilot', sub_hash);
    if (existing) {
      // Stamp metadata fields first (preserve via upsert mutate)
      registry.upsert({
        agent: 'copilot',
        sub_hash,
        agent_metadata: {
          ...(existing.agent_metadata || {}),
          completion_status,
          completed_at,
          errorMessage,
        },
      });
      // Then transition status
      try {
        registry.markCompleted('copilot', sub_hash, {
          completed_at,
          error: completion_status === 'error' ? (errorMessage || 'subagent failed') : undefined,
        });
      } catch {
        // tolerated — markCompleted may throw if row not present in custom registries
      }
    }

    // Write the stub observation (degraded LSL parity per RESEARCH key finding)
    const started_at = open?.started_at || existing?.agent_metadata?.started_at || completed_at;
    const stub = buildStubObservation({
      agentName: open?.agentName || existing?.agent_metadata?.agentName,
      agentDescription: open?.agentDescription || existing?.agent_metadata?.agentDescription,
      started_at,
      completed_at,
      completion_status,
    });

    const metadata = {
      agent: 'copilot',
      source: 'sub-agent',                   // D-Live-Sweep-Tags: live tier
      parent_session_id: tail.sessionId,
      sub_index: open?.sub_index || existing?.sub_index || null,
      sub_hash,
      project: tail.project,
      lsl_incomplete: true,
      lsl_incomplete_reason: COPILOT_LSL_INCOMPLETE_REASON,
      note: COPILOT_LSL_INCOMPLETE_NOTE,
      toolCallId,
      completion_status,
      detected_via: 'event-tail',
      sourceFile: tail.eventsPath,
    };

    try {
      const writePromise = Promise.resolve(
        observationWriter.processMessages(stub.messages, metadata),
      ).catch((err) => {
        state.errors++;
        onError(err);
      });
      pendingWrites.push(writePromise);
      await writePromise;
    } catch (err) {
      state.errors++;
      onError(err);
    }

    tail.watching.delete(toolCallId);
  }

  /**
   * Stop a tail and best-effort mark its open sub-agents as lock_gone.
   * Called when the lock file for a watched session disappears.
   */
  async function closeTailWithLockGone(tail) {
    try {
      await tail.tail.stop();
    } catch (err) {
      onError(err);
    }
    // Mark any still-open sub-agents as lock_gone (defensive completion)
    for (const [toolCallId, open] of tail.watching.entries()) {
      const sub_hash = open.sub_hash;
      const existing = registry.get('copilot', sub_hash);
      if (!existing) continue;
      registry.upsert({
        agent: 'copilot',
        sub_hash,
        agent_metadata: {
          ...(existing.agent_metadata || {}),
          completion_status: 'lock_gone',
          completed_at: null,
        },
      });
      try {
        registry.markCompleted('copilot', sub_hash, {
          completed_at: null,
          error: 'lock_gone',
        });
      } catch {
        // tolerated
      }
      // Best-effort stub observation with lock_gone status
      const stub = buildStubObservation({
        agentName: open.agentName,
        agentDescription: open.agentDescription,
        started_at: open.started_at,
        completed_at: null,
        completion_status: 'lock_gone',
      });
      const metadata = {
        agent: 'copilot',
        source: 'sub-agent',
        parent_session_id: tail.sessionId,
        sub_index: open.sub_index,
        sub_hash,
        project: tail.project,
        lsl_incomplete: true,
        lsl_incomplete_reason: COPILOT_LSL_INCOMPLETE_REASON,
        note: COPILOT_LSL_INCOMPLETE_NOTE,
        toolCallId,
        completion_status: 'lock_gone',
        detected_via: 'event-tail',
        sourceFile: tail.eventsPath,
      };
      try {
        const p = Promise.resolve(
          observationWriter.processMessages(stub.messages, metadata),
        ).catch((err) => onError(err));
        pendingWrites.push(p);
        await p;
      } catch (err) {
        onError(err);
      }
    }
    tail.watching.clear();
  }

  /**
   * One scan iteration. Adds tails for newly-live sessions; removes tails
   * for sessions whose lock disappeared.
   */
  async function scanLoop() {
    if (state.closed) return;
    state.lastScanAt = new Date().toISOString();
    let live;
    try {
      live = scanForLiveSessions(sessionStateDir, myUid);
    } catch (err) {
      state.errors++;
      onError(err);
      return;
    }

    const liveIds = new Set(live.map((s) => s.sessionId));

    // Add tails for newly-live sessions
    for (const { sessionId, sessionDir } of live) {
      if (tails.has(sessionId)) continue;

      // Read workspace.yaml + project filter
      const workspace = readWorkspace(sessionDir);
      if (!projectMatches(workspace, projectRoot)) continue;
      const project = projectFromWorkspace(workspace);

      const eventsPath = path.join(sessionDir, 'events.jsonl');

      // uid-check on events.jsonl file (defense-in-depth)
      try {
        const st = fs.statSync(eventsPath);
        if (myUid != null && typeof st.uid === 'number' && st.uid !== myUid) {
          process.stderr.write(`[live-copilot] skipping non-owned events.jsonl for ${sessionId}\n`);
          continue;
        }
      } catch {
        // file doesn't exist yet — fs.watchFile will handle when it appears
      }

      const tailState = {
        sessionId,
        sessionDir,
        eventsPath,
        project,
        watching: new Map(),
        tail: null,
      };

      const tail = tailEventsFile({
        eventsPath,
        onSubagentStarted: (evt) => ingestStarted(tailState, evt),
        onSubagentEnded: (evt) => ingestEnded(tailState, evt),
        onError: (err) => {
          state.errors++;
          onError(err);
        },
        // Phase 69 (Plan 69-06): isolated session.shutdown token-row hook (D-08).
        onTokenRow,
      });
      tailState.tail = tail;
      tails.set(sessionId, tailState);
    }

    // Remove tails for sessions whose lock disappeared
    for (const [sessionId, tailState] of [...tails.entries()]) {
      if (liveIds.has(sessionId)) continue;
      tails.delete(sessionId);
      try {
        await closeTailWithLockGone(tailState);
      } catch (err) {
        state.errors++;
        onError(err);
      }
    }
  }

  // Initial scan (synchronous wrt the returned handle, so callers can assert
  // watching_sessions immediately after the first interval tick fires).
  await scanLoop();

  // Periodic re-scan.
  const scanTimer = setInterval(() => {
    scanLoop().catch((err) => {
      state.errors++;
      onError(err);
    });
  }, liveSessionScanIntervalMs);
  // Don't keep the event loop alive solely for this timer.
  if (typeof scanTimer.unref === 'function') scanTimer.unref();

  return {
    async stop() {
      if (state.closed) return;
      state.closed = true;
      clearInterval(scanTimer);
      // Stop all tails (without lock_gone — clean shutdown)
      const tailHandles = [...tails.values()];
      tails.clear();
      for (const t of tailHandles) {
        try {
          await t.tail.stop();
        } catch (err) {
          onError(err);
        }
      }
      // Drain any pending writes
      if (pendingWrites.length > 0) {
        await Promise.allSettled(pendingWrites);
      }
    },
    getStats() {
      let tail_count = 0;
      for (const t of tails.values()) {
        if (t.tail) tail_count++;
      }
      return {
        watching_sessions: tails.size,
        tail_count,
        registered: registry.listByAgent ? registry.listByAgent('copilot').length : 0,
        errors: state.errors,
        last_scan_at: state.lastScanAt || new Date().toISOString(),
      };
    },
  };
}

/**
 * stopCopilotWatcher — convenience wrapper that calls handle.stop().
 *
 * @param {object} handle
 */
export async function stopCopilotWatcher(handle) {
  if (handle && typeof handle.stop === 'function') {
    await handle.stop();
  }
}
