/**
 * lib/lsl/live/claude-fs-watch.mjs — Claude Code Path A (live) hook.
 *
 * Phase 51 Plan 07 Task 1.
 *
 * Implements RESEARCH-claude.md §Detection plan — Path A Option 1 RECOMMENDED:
 * filesystem watch via FSEvents (macOS native) on `~/.claude/projects/<encoded-cwd>/`
 * recursive. On new `<parent-uuid>/subagents/agent-<hex>.jsonl` file creation,
 * the watcher:
 *   1. uid-checks the file (T-51-07-FI defense-in-depth, matches Plan 51-02).
 *   2. Registers the sub-agent in the Plan 51-01 registry with
 *      status='running', detected_via='fs-watch'.
 *   3. Starts a per-file polling tail (fs.watchFile @ 200ms — FSEvents-on-file
 *      is unreliable per Node docs).
 *   4. On each appended JSONL line, parses + filters by isSidechain (landmine
 *      #3), pairs user/assistant exchanges, and writes them to ObservationWriter
 *      with metadata.source='sub-agent' (NO -backfill suffix per
 *      CONTEXT.md D-Live-Sweep-Tags).
 *   5. When mtime stops updating for > raceGuardMs, calls registry.markCompleted
 *      and tears down the tail.
 *
 * Per CONTEXT.md D-Reuse: this module does NOT touch Phase 50's
 * lib/lsl/window.mjs or lib/lsl/scan-and-convert.mjs. The live writer is a
 * NEW path that reuses ObservationWriter directly (same boundary the sweep
 * adapters use via the Phase 50 primitive's processLineStream).
 *
 * Per CONTEXT.md D-Reuse within Phase 51: imports path-parsing helpers from
 * the Plan 51-02 sweep adapter (claude-jsonl-tree.mjs) — these are not
 * duplicated here.
 *
 * Per CLAUDE.md no-console-log rule: this module uses process.stderr.write
 * exclusively for forensic output.
 *
 * Pure ESM (no build step). Zero new package installs.
 *
 * Threat-model dispositions:
 *   T-51-07-FI: uid-check on every file event before reading.
 *   T-51-07-RC: lazy agentId fill — row is upserted on file-create then
 *               enriched on first-message-read. registry.upsert is idempotent.
 *   T-51-07-FS: missed FSEvents are recoverable via Path B sweep
 *               (CONTEXT.md two-fix-paths). Daemon needs ≥90% reliability,
 *               not 100%.
 *   T-51-07-RL: one tail per active file; tails close on mtime-stop;
 *               bounded by concurrent active sub-agents (typically ≤ 10).
 *   T-51-07-AD: metadata.source='sub-agent' (NO -backfill) distinguishes
 *               live capture from sweep recovery per D-Live-Sweep-Tags.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// D-Reuse within Phase 51: import path-parsing helpers from claude-jsonl-tree.mjs (Plan 51-02 adapter).
import { SUBAGENT_PATH_RE, projectFromClaudeSubagentPath, parentSessionFromClaudeSubagentPath, agentIdFromClaudeSubagentPath, subHashFromAgentId } from '../adapters/claude-jsonl-tree.mjs';

/**
 * Default mtime-stop window: 5 minutes (matches Phase 50's RACE_GUARD_MS).
 * Tests pass a smaller value via the raceGuardMs option.
 */
const DEFAULT_RACE_GUARD_MS = 5 * 60 * 1000;

/**
 * Default per-file polling interval (fs.watchFile). 200ms matches the
 * RESEARCH note about FSEvents-on-file unreliability.
 */
const DEFAULT_TAIL_INTERVAL_MS = 200;

/**
 * Default ENOENT retry interval — when projectsDir doesn't exist yet, the
 * watcher logs a deferral and retries every retryIntervalMs.
 */
const DEFAULT_RETRY_INTERVAL_MS = 5_000;

/**
 * Sub-agent filename match against the relative path fs.watch emits on macOS.
 *
 * The recursive watch is on `~/.claude/projects/` (or the test's tmp
 * equivalent), so the relative filename starts with the encoded-cwd dir:
 *
 *   <encoded-cwd>/<parent-uuid>/subagents/agent-<hex>.jsonl
 *
 * On systems where the watch root is already INSIDE the encoded-cwd dir,
 * the leading `<encoded-cwd>/` is absent; the regex makes it optional so
 * either invocation works.
 */
const RELATIVE_SUBAGENT_RE = /(?:^|\/)[0-9a-f-]{36}\/subagents\/agent-[a-f0-9]+\.jsonl$/;

/**
 * Per-file tail reader. Polls via fs.watchFile (200ms by default) and emits
 * complete user/assistant exchanges to `onMessage` as exchange arrays.
 *
 * The tail closes itself when mtime has not advanced for `raceGuardMs`,
 * invoking `onClose(exchangesEmitted)`.
 *
 * @param {string} filePath
 * @param {object} opts
 * @param {(exchange: Array<{role,content,timestamp}>) => Promise<void>|void} opts.onMessage
 * @param {(exchangesEmitted: number) => void} opts.onClose
 * @param {number} [opts.raceGuardMs]
 * @param {number} [opts.tailIntervalMs]
 * @returns {{ stop: () => Promise<void>, getExchangeCount: () => number }}
 */
function tailFile(filePath, { onMessage, onClose, raceGuardMs, tailIntervalMs }) {
  let lastSize = 0;
  let lastMtimeMs = Date.now();
  let pendingBuffer = ''; // partial last-line accumulator
  let exchangePair = []; // user/assistant accumulator
  let exchangesEmitted = 0;
  let closed = false;
  // Track outstanding writer promises so stop() can drain them.
  const inFlight = new Set();
  let mtimeCheckTimer = null;

  function pushExchangeIfReady() {
    if (exchangePair.length === 0) return null;
    // Emit when we have at least one user + one assistant, or when the pair
    // has 2+ entries (flush on every full pairing).
    if (exchangePair.length >= 2) {
      const out = exchangePair.slice();
      exchangePair = [];
      return out;
    }
    return null;
  }

  async function emit(exchange) {
    exchangesEmitted += 1;
    try {
      const p = onMessage(exchange);
      if (p && typeof p.then === 'function') {
        inFlight.add(p);
        try {
          await p;
        } finally {
          inFlight.delete(p);
        }
      }
    } catch (err) {
      process.stderr.write(`[claude-fs-watch] onMessage threw: ${err.message}\n`);
    }
  }

  function parseAndAccumulate(line) {
    if (!line || !line.trim()) return null;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      // Malformed line — skip per RESEARCH §Known landmines #5.
      return null;
    }
    if (!obj || typeof obj !== 'object') return null;
    // First-line isSidechain:false → stop the tail without emitting.
    if (obj.isSidechain === false) {
      return { kind: 'non-sidechain', obj };
    }
    if (obj.type !== 'user' && obj.type !== 'assistant') return null;
    let content = '';
    const msg = obj.message;
    if (msg && typeof msg === 'object') {
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        const segs = [];
        for (const block of msg.content) {
          if (!block || typeof block !== 'object') continue;
          if (block.type === 'text' && typeof block.text === 'string') {
            segs.push(block.text);
          } else if (block.type === 'tool_use' && block.name) {
            segs.push(`[tool: ${block.name}]`);
          } else if (block.type === 'tool_result') {
            segs.push('[tool-result]');
          }
        }
        content = segs.join('\n');
      }
    }
    return {
      kind: 'message',
      msg: {
        role: obj.type,
        content,
        timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : '',
      },
      raw: obj,
    };
  }

  async function readNewBytes(curr) {
    let fd;
    try {
      fd = fs.openSync(filePath, 'r');
    } catch (err) {
      if (err.code !== 'ENOENT') {
        process.stderr.write(`[claude-fs-watch] open failed for tail ${filePath}: ${err.message}\n`);
      }
      return false;
    }
    try {
      const startOffset = lastSize;
      const newBytes = Math.max(0, curr.size - startOffset);
      if (newBytes <= 0) return false;
      // Cap a single read at 1 MiB to bound memory.
      const chunk = Buffer.alloc(Math.min(newBytes, 1024 * 1024));
      const n = fs.readSync(fd, chunk, 0, chunk.length, startOffset);
      lastSize = startOffset + n;
      const text = pendingBuffer + chunk.slice(0, n).toString('utf-8');
      // Split into lines; preserve any trailing partial in pendingBuffer.
      const parts = text.split('\n');
      pendingBuffer = parts.pop() || '';
      let sawNonSidechain = false;
      for (const line of parts) {
        const parsed = parseAndAccumulate(line);
        if (!parsed) continue;
        if (parsed.kind === 'non-sidechain') {
          sawNonSidechain = true;
          break;
        }
        if (parsed.kind === 'message') {
          exchangePair.push(parsed.msg);
          const ready = pushExchangeIfReady();
          if (ready) {
            await emit(ready);
          }
        }
      }
      return sawNonSidechain ? 'non-sidechain' : true;
    } finally {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }

  // --- Polling listener.
  const listener = (curr, prev) => {
    if (closed) return;
    if (curr.mtimeMs && curr.mtimeMs > lastMtimeMs) {
      lastMtimeMs = curr.mtimeMs;
    }
    if (curr.size > lastSize) {
      // Async — fire and forget; failures are logged inside readNewBytes.
      readNewBytes(curr).then((result) => {
        if (result === 'non-sidechain' && !closed) {
          process.stderr.write(`[claude-fs-watch] skipping non-sidechain ${filePath}\n`);
          // Close via the same onClose path so the caller can stamp the
          // markCompleted with error='non-sidechain'.
          handle.__closeWithError('non-sidechain');
        }
      }).catch((err) => {
        process.stderr.write(`[claude-fs-watch] tail read failed ${filePath}: ${err.message}\n`);
      });
    }
  };

  fs.watchFile(filePath, { interval: tailIntervalMs || DEFAULT_TAIL_INTERVAL_MS }, listener);

  // Process any content already on disk at tail-attach time. fs.watchFile only
  // fires when stat CHANGES — if the file is created with content all at once
  // (the common Claude Code pattern: Agent() returns + Claude immediately writes
  // the entire transcript), no subsequent fs.watchFile event fires. Read the
  // initial content explicitly here so we don't lose the first batch.
  try {
    const st = fs.statSync(filePath);
    lastMtimeMs = st.mtimeMs;
    if (st.size > 0) {
      // Fire-and-forget — same shape as the listener's call.
      readNewBytes(st).then((result) => {
        if (result === 'non-sidechain' && !closed) {
          process.stderr.write(`[claude-fs-watch] skipping non-sidechain ${filePath}\n`);
          handle.__closeWithError('non-sidechain');
        }
      }).catch((err) => {
        process.stderr.write(`[claude-fs-watch] initial read failed ${filePath}: ${err.message}\n`);
      });
    }
  } catch {
    /* file may not exist yet — race window */
  }

  // --- Race-guard mtime-stop detection.
  const guard = raceGuardMs || DEFAULT_RACE_GUARD_MS;
  const onTick = () => {
    if (closed) return;
    const now = Date.now();
    if (now - lastMtimeMs > guard) {
      handle.__closeClean();
    } else {
      mtimeCheckTimer = setTimeout(onTick, Math.min(guard, 1000));
      // Don't keep the event loop alive on this timer alone.
      if (mtimeCheckTimer && typeof mtimeCheckTimer.unref === 'function') {
        mtimeCheckTimer.unref();
      }
    }
  };
  mtimeCheckTimer = setTimeout(onTick, Math.min(guard, 1000));
  if (mtimeCheckTimer && typeof mtimeCheckTimer.unref === 'function') {
    mtimeCheckTimer.unref();
  }

  const handle = {
    async stop() {
      if (closed) return;
      closed = true;
      try { fs.unwatchFile(filePath, listener); } catch { /* ignore */ }
      if (mtimeCheckTimer) { clearTimeout(mtimeCheckTimer); mtimeCheckTimer = null; }
      // Drain in-flight writer promises.
      if (inFlight.size > 0) {
        await Promise.all(Array.from(inFlight));
      }
    },
    getExchangeCount() { return exchangesEmitted; },
    __closeClean() {
      if (closed) return;
      closed = true;
      try { fs.unwatchFile(filePath, listener); } catch { /* ignore */ }
      if (mtimeCheckTimer) { clearTimeout(mtimeCheckTimer); mtimeCheckTimer = null; }
      // Drain (fire-and-forget — caller invokes onClose synchronously).
      (async () => {
        if (inFlight.size > 0) {
          await Promise.all(Array.from(inFlight));
        }
        try { onClose(exchangesEmitted); } catch (err) {
          process.stderr.write(`[claude-fs-watch] onClose threw: ${err.message}\n`);
        }
      })();
    },
    __closeWithError(reason) {
      if (closed) return;
      closed = true;
      try { fs.unwatchFile(filePath, listener); } catch { /* ignore */ }
      if (mtimeCheckTimer) { clearTimeout(mtimeCheckTimer); mtimeCheckTimer = null; }
      (async () => {
        if (inFlight.size > 0) {
          await Promise.all(Array.from(inFlight));
        }
        try { onClose(exchangesEmitted, reason); } catch (err) {
          process.stderr.write(`[claude-fs-watch] onClose threw: ${err.message}\n`);
        }
      })();
    },
  };
  return handle;
}

/**
 * Schedule a deferred (ENOENT) re-bind. Used when projectsDir doesn't exist
 * yet on watcher startup.
 */
function scheduleEnoentRetry(state, opts) {
  if (state.closed) return;
  state.enoentTimer = setTimeout(() => {
    state.enoentTimer = null;
    if (!state.closed) {
      attachWatcher(state, opts);
    }
  }, state.retryIntervalMs);
  if (state.enoentTimer && typeof state.enoentTimer.unref === 'function') {
    state.enoentTimer.unref();
  }
}

/**
 * Try to attach the recursive fs.watch. Returns true on success.
 */
function attachWatcher(state, opts) {
  if (state.closed) return false;
  if (state.watcher) return true; // already attached
  if (!fs.existsSync(opts.projectsDir)) {
    process.stderr.write(`[claude-fs-watch] projects dir not yet created; deferring: ${opts.projectsDir}\n`);
    scheduleEnoentRetry(state, opts);
    return false;
  }
  try {
    const watcher = fs.watch(opts.projectsDir, { recursive: true }, (eventType, filename) => {
      handleEvent(state, opts, eventType, filename);
    });
    watcher.on('error', (err) => {
      process.stderr.write(`[claude-fs-watch] watcher error: ${err.message}\n`);
      if (typeof opts.onError === 'function') {
        try { opts.onError(err); } catch { /* ignore */ }
      }
    });
    state.watcher = watcher;
    state.watchedDirs = 1;
    return true;
  } catch (err) {
    process.stderr.write(`[claude-fs-watch] fs.watch failed: ${err.message}\n`);
    if (err.code === 'ENOENT') {
      scheduleEnoentRetry(state, opts);
    }
    return false;
  }
}

/**
 * Handle a single fs.watch event — filter for sub-agent jsonl files, run the
 * uid-check, register the sub-agent in the registry, start a tail.
 */
function handleEvent(state, opts, eventType, filename) {
  if (state.closed) return;
  if (!filename) return;
  // On macOS recursive watch, filename is a relative path including the parent
  // uuid + 'subagents/agent-*.jsonl'.
  if (!RELATIVE_SUBAGENT_RE.test(filename)) return;
  const fullPath = path.join(opts.projectsDir, filename);
  // Drop duplicates — once we've registered + tailed, subsequent change
  // events for the same path are no-ops here (the tail handles content
  // growth).
  if (state.tails.has(fullPath)) return;

  // T-51-07-FI: uid-check fail-closed.
  let st;
  try {
    st = fs.statSync(fullPath);
  } catch (err) {
    // File may have been deleted in the brief window between event + stat.
    if (err.code !== 'ENOENT') {
      process.stderr.write(`[claude-fs-watch] stat failed ${fullPath}: ${err.message}\n`);
    }
    return;
  }
  if (typeof process.getuid === 'function') {
    const me = process.getuid();
    if (st.uid !== me) {
      process.stderr.write(`[claude-fs-watch] skipping non-owned ${fullPath} (file uid=${st.uid} != ${me})\n`);
      return;
    }
  }

  // Path-parsing via D-Reuse imports.
  if (!SUBAGENT_PATH_RE.test(fullPath)) {
    // Shouldn't happen — filename matched RELATIVE_SUBAGENT_RE — but
    // double-gate for safety.
    return;
  }
  const parentSessionId = parentSessionFromClaudeSubagentPath(fullPath);
  const agentId = agentIdFromClaudeSubagentPath(fullPath);
  const project = projectFromClaudeSubagentPath(fullPath);
  const subHash = subHashFromAgentId(agentId);
  if (!parentSessionId || !agentId || !subHash) {
    process.stderr.write(`[claude-fs-watch] path-parse miss for ${fullPath}\n`);
    return;
  }

  // Stage 1 upsert — row created on file-create. agentId is captured even on
  // an empty file because the path itself encodes it; the "lazy fill" comes
  // from setting agent_metadata.agent_id to the parsed agentId NOW (path is
  // authoritative) AND re-upserting once the first JSONL line confirms it
  // (Test 6 verifies the second upsert).
  const initialRow = {
    agent: 'claude',
    sub_hash: subHash,
    parent_session_id: parentSessionId,
    sub_index: null, // recomputed below
    transcript_path: fullPath,
    project,
    status: 'running',
    detected_via: 'fs-watch',
    agent_metadata: {
      agent_id: agentId,
      attributionAgent: null,
      attributionSkill: null,
    },
  };
  opts.registry.upsert(initialRow);
  state.registeredCount = Math.max(state.registeredCount, opts.registry.size());

  // Sibling tracking — recompute sub_index for all siblings of this parent
  // in fs-watch first-touch order (Plan 07 differs from Plan 02's
  // timestamp-sort because the watcher sees creates in real-time order).
  let siblings = state.siblings.get(parentSessionId);
  if (!siblings) {
    siblings = [];
    state.siblings.set(parentSessionId, siblings);
  }
  if (!siblings.includes(subHash)) siblings.push(subHash);
  siblings.forEach((sh, i) => {
    const row = opts.registry.get('claude', sh);
    if (row) {
      opts.registry.upsert({ agent: 'claude', sub_hash: sh, sub_index: i + 1 });
    }
  });

  // Stage 2 — start the tail. The tail's onMessage will (a) for the first
  // valid message, re-upsert with the verified agentId; (b) for each
  // paired exchange, write to ObservationWriter.
  const tailHandle = tailFile(fullPath, {
    raceGuardMs: opts.raceGuardMs,
    tailIntervalMs: opts.tailIntervalMs,
    onMessage: async (exchange) => {
      // Lazy agentId re-upsert — first observed message confirms the
      // identity. The path-derived agentId is authoritative but the
      // re-upsert proves liveness (Test 6).
      opts.registry.upsert({
        agent: 'claude',
        sub_hash: subHash,
        agent_metadata: {
          ...(opts.registry.get('claude', subHash)?.agent_metadata || {}),
          agent_id: agentId,
        },
      });
      // Write to ObservationWriter. Per CONTEXT.md D-Live-Sweep-Tags:
      // metadata.source = 'sub-agent' (NO -backfill suffix).
      try {
        await opts.observationWriter.processMessages(exchange, {
          agent: 'claude',
          sourceFile: fullPath,
          source: 'sub-agent',
          tag: 'sub-agent',
          project,
          parent_session_id: parentSessionId,
          sub_index: opts.registry.get('claude', subHash)?.sub_index,
          sub_hash: subHash,
        });
        // Increment registry's observations_written counter via a SINGLE
        // atomic upsert (CR-03 / Plan 51-14). The prior implementation did
        // get() → upsert({}) → mutate cur, but upsert internally creates
        // a new merged object and replaces the Map slot, so `cur` becomes
        // orphaned and the mutation was invisible to all downstream readers
        // (heartbeat, registry-reader, future health-coordinator queries).
        // The final value at markCompleted (line below) was accidentally
        // right because the truthy-check on 0 fell back to exchangesEmitted.
        const cur = opts.registry.get('claude', subHash);
        if (cur) {
          opts.registry.upsert({
            agent: 'claude',
            sub_hash: subHash,
            observations_written: (cur.observations_written || 0) + 1,
          });
        }
      } catch (err) {
        process.stderr.write(`[claude-fs-watch] writer failed for ${fullPath}: ${err.message}\n`);
        if (typeof opts.onError === 'function') {
          try { opts.onError(err); } catch { /* ignore */ }
        }
      }
    },
    onClose: (exchangesEmitted, errorReason) => {
      // Drop the tail from state.
      state.tails.delete(fullPath);
      try {
        if (errorReason) {
          opts.registry.markCompleted('claude', subHash, { error: errorReason });
        } else {
          const row = opts.registry.get('claude', subHash);
          opts.registry.markCompleted('claude', subHash, {
            observations_written: row && row.observations_written ? row.observations_written : exchangesEmitted,
            completed_at: new Date().toISOString(),
          });
        }
      } catch (err) {
        process.stderr.write(`[claude-fs-watch] markCompleted failed for ${fullPath}: ${err.message}\n`);
      }
    },
  });
  state.tails.set(fullPath, tailHandle);
}

/**
 * startClaudeWatcher — public entry point. Returns a handle whose `stop()`
 * fully drains tails and closes the watcher.
 *
 * @param {object} opts
 * @param {string} opts.projectsDir              Recursive watch root.
 * @param {object} opts.registry                 createRegistry() instance.
 * @param {object} opts.observationWriter        ObservationWriter instance.
 * @param {(err: Error) => void} [opts.onError]  Non-fatal error callback.
 * @param {number} [opts.raceGuardMs]            mtime-stop window (default 5min).
 * @param {number} [opts.tailIntervalMs]         per-file polling interval (200ms).
 * @param {number} [opts.retryIntervalMs]        ENOENT retry interval (5s).
 * @returns {Promise<{stop: () => Promise<void>, getStats: () => {watched,tailing,registered}}>}
 */
export async function startClaudeWatcher({
  projectsDir,
  registry,
  observationWriter,
  onError,
  raceGuardMs,
  tailIntervalMs,
  retryIntervalMs,
} = {}) {
  if (!projectsDir || typeof projectsDir !== 'string') {
    throw new TypeError('startClaudeWatcher: projectsDir is required');
  }
  if (!registry || typeof registry.upsert !== 'function') {
    throw new TypeError('startClaudeWatcher: registry with upsert() is required');
  }
  if (!observationWriter || typeof observationWriter.processMessages !== 'function') {
    throw new TypeError('startClaudeWatcher: observationWriter with processMessages() is required');
  }
  const state = {
    closed: false,
    watcher: null,
    watchedDirs: 0,
    tails: new Map(),
    siblings: new Map(),
    registeredCount: 0,
    enoentTimer: null,
    retryIntervalMs: retryIntervalMs || DEFAULT_RETRY_INTERVAL_MS,
  };

  const eOpts = {
    projectsDir,
    registry,
    observationWriter,
    onError,
    raceGuardMs,
    tailIntervalMs,
  };
  // Try to attach immediately; if ENOENT, scheduleEnoentRetry was already called.
  attachWatcher(state, eOpts);

  return {
    state,
    async stop() {
      if (state.closed) return;
      state.closed = true;
      if (state.enoentTimer) {
        clearTimeout(state.enoentTimer);
        state.enoentTimer = null;
      }
      if (state.watcher) {
        try { state.watcher.close(); } catch { /* ignore */ }
        state.watcher = null;
      }
      // Drain all in-flight tails — each tail's stop() awaits in-flight
      // writer calls (Test 8).
      const tailHandles = Array.from(state.tails.values());
      state.tails.clear();
      await Promise.all(tailHandles.map((t) => {
        try { return t.stop(); } catch { return Promise.resolve(); }
      }));
    },
    getStats() {
      return {
        watched: state.watchedDirs,
        tailing: state.tails.size,
        registered: registry.size(),
      };
    },
  };
}

/**
 * stopClaudeWatcher(handle) — equivalent to `handle.stop()`. Idempotent.
 */
export async function stopClaudeWatcher(handle) {
  if (!handle || typeof handle.stop !== 'function') return;
  await handle.stop();
}
