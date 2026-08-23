/**
 * Per-turn KB retrieval capture store.
 *
 * Persists, for every `/api/retrieve` call that carries a `task_id`, exactly what was
 * injected (Insights/Digests/Entities/Observations, each with its rrfScore/score) AND
 * the selection `trace` that explains what was dropped at which stage. The dashboard
 * reads these back to render scored cards plus a drop-off funnel.
 *
 * WHY APPEND-ONLY, PER TURN. The original writer wrote `<task_id>.json` and OVERWROTE
 * it on every call. For an interactive session `task_id` is the session UUID (see
 * src/hooks/knowledge-injection-hook.js), so a 39-turn session left exactly ONE
 * capture — the last turn — and "what was injected at turn 12, and why that?" could
 * not be answered at all. Each retrieval now appends one JSONL line.
 *
 * ON-DISK FORMAT (`.data/retrieval-captures/<sanitized task_id>.jsonl`), one line per turn:
 *
 *   { task_id, turn, capturedAt, meta, items, trace }
 *
 * `turn` is a 0-based ordinal within the file. Legacy single-turn `<task_id>.json`
 * files are NOT migrated — the reader (system-health-dashboard/server.js
 * handleRetrieveCapture) falls back to them when no `.jsonl` exists.
 *
 * NEVER-THROWS: this sits on the retrieval hot path behind a fail-open hook. Any IO
 * error is swallowed and reported to `log`; a capture is diagnostics, never a reason
 * to fail or delay an agent's turn.
 *
 * @module capture-store
 */

import fs from 'node:fs';
import path from 'node:path';

/** Filesystem-safe capture id. Mirrors the reader's sanitizer exactly. */
export function sanitizeCaptureId(id) {
  return String(id).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
}

/**
 * Next turn ordinal per capture file. Counting lines on every append would re-read the
 * whole file each turn; this caches the counter and pays the O(file) count at most once
 * per task per process lifetime — so an obs-api restart mid-session still resumes at the
 * right ordinal instead of colliding at 0.
 * @type {Map<string, number>}
 */
const _nextTurn = new Map();

/** Test-only: clear the in-process turn counters. */
export function _resetTurnCounters() {
  _nextTurn.clear();
}

function nextTurnFor(file, key) {
  const cached = _nextTurn.get(key);
  if (cached !== undefined) return cached;
  let n = 0;
  try {
    // Count non-empty lines already on disk. Missing file → 0 (first turn).
    n = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).length;
  } catch {
    n = 0;
  }
  _nextTurn.set(key, n);
  return n;
}

/**
 * Append one turn's capture. Returns the turn ordinal written, or null when nothing
 * was written (no task id, nothing to record, or an IO error).
 *
 * A ZERO-ITEM result is still recorded when a trace is present. "Nothing was injected,
 * and here is which stage killed every candidate" is the single most useful record the
 * funnel can show; the previous writer's `items.length === 0` early-return discarded
 * precisely that case.
 *
 * @param {object} args
 * @param {string} args.dir capture directory (`.data/retrieval-captures`)
 * @param {string} args.taskId run/session id (experiment slug or session UUID)
 * @param {object} args.result the retrieve() result ({ items, trace, meta })
 * @param {(msg:string)=>void} [args.log] diagnostic sink (defaults to no-op)
 * @returns {number|null} the turn ordinal written, else null
 */
export function appendCapture({ dir, taskId, result, log }) {
  try {
    if (!taskId) return null;
    const items = Array.isArray(result?.items) ? result.items : [];
    const trace = result?.trace ?? null;
    if (items.length === 0 && !trace) return null;

    fs.mkdirSync(dir, { recursive: true });
    const key = sanitizeCaptureId(taskId);
    const file = path.join(dir, `${key}.jsonl`);
    const turn = nextTurnFor(file, key);
    const line = JSON.stringify({
      task_id: taskId,
      turn,
      capturedAt: new Date().toISOString(),
      meta: result?.meta || null,
      items,
      trace,
    });
    fs.appendFileSync(file, line + '\n', 'utf8');
    _nextTurn.set(key, turn + 1);
    return turn;
  } catch (err) {
    log?.(`[capture-store] append failed (non-fatal): ${err.message}\n`);
    return null;
  }
}

/**
 * Read every captured turn for a task, newest last. Prefers the per-turn `.jsonl`;
 * falls back to a legacy single-turn `.json`. Unparseable lines are skipped rather
 * than failing the read — a torn final line (crash mid-append) must not hide the
 * turns before it. Returns [] when nothing is on disk.
 *
 * @param {object} args
 * @param {string} args.dir capture directory
 * @param {string} args.taskId run/session id
 * @returns {Array<object>} captured turns
 */
export function readCaptures({ dir, taskId }) {
  try {
    if (!taskId) return [];
    const key = sanitizeCaptureId(taskId);
    const jsonl = path.join(dir, `${key}.jsonl`);
    if (fs.existsSync(jsonl)) {
      return fs
        .readFileSync(jsonl, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
    }
    const legacy = path.join(dir, `${key}.json`);
    if (fs.existsSync(legacy)) {
      // Legacy captures carry no turn number and are always the session's last turn.
      return [{ ...JSON.parse(fs.readFileSync(legacy, 'utf8')), turn: 0, legacy: true }];
    }
    return [];
  } catch {
    return [];
  }
}
