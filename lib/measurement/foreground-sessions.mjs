/**
 * Per-agent foreground-session detection (Phase 68-04, auto-measure Plan B).
 *
 * The measurement reconciler (scripts/measurement-reconciler.mjs) polls these
 * detectors to learn which session each coding agent is CURRENTLY driving, then
 * binds live proxy traffic to it by writing active-measurement.<agent>.json.
 *
 * Contract — every detector returns
 * `{ agent, sessionId, lastActivityMs, runnerUpMs }` for the most-recently-active
 * top-level session, or `null` when none is found. `lastActivityMs` is a Unix
 * epoch in milliseconds; `runnerUpMs` is the same for the NEXT most recent
 * session of that agent (null when there is only one). The reconciler owns the
 * freshness decision so this module stays a pure locator.
 *
 * Why the runner-up. The proxy has ONE slot per agent, so two sessions of one
 * agent active at once cannot both be measured. "Newest wins" then flips the slot
 * between them on every write — observed 2026-10-03 with two claude sessions,
 * rebinding every 5s poll, so each session's wire traffic was booked to whichever
 * held the slot at that instant. Reporting the runner-up lets the reconciler see
 * the overlap and decline to bind instead of guessing.
 *
 * task_id == session_id (verbatim, no transform) — the SAME convention the
 * Run-reconstruction pipeline uses (lib/lsl/token/opencode-token-rows.mjs), so
 * binding the proxy to sessionId correlates wire-tap bytes with the Run.
 *
 * Locations come from getAgentSearchPaths() (lib/lsl/adapters/index.mjs) — the
 * single source of truth for per-agent on-disk layout (D-09, one level of magic).
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { getAgentSearchPaths } from '../lsl/adapters/index.mjs';

// require() shim for ESM — better-sqlite3 (opencode detector) is CJS-only.
const require = createRequire(import.meta.url);

/**
 * Fold `{ id, mtimeMs }` candidates into the newest and the runner-up, distinct
 * by id. Returns `{ best, runnerUpMs }` — best null when there were none.
 */
function topTwo(candidates) {
  let best = null;
  let second = null;
  for (const c of candidates) {
    if (!c || !c.id) continue;
    if (!best || c.mtimeMs > best.mtimeMs) {
      if (best && best.id !== c.id) second = best;
      best = c;
    } else if (c.id !== best.id && (!second || c.mtimeMs > second.mtimeMs)) {
      second = c;
    }
  }
  return { best, runnerUpMs: second ? second.mtimeMs : null };
}

/** Read a directory's entries, returning [] on any error (rule 06: no throw). */
function readDirSafe(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Claude Code: `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`.
 * Newest .jsonl mtime is the live session; sessionId is the filename stem.
 *
 * TOP-LEVEL ONLY: exactly two levels, project dir then session file. A recursive
 * walk also reached `<session-uuid>/subagents/agent-<id>.jsonl`, and a busy
 * sub-agent then "won" with sessionId `agent-<id>` — a task_id no Run carries.
 * @returns {{ agent: 'claude', sessionId: string, lastActivityMs: number,
 *             runnerUpMs: number|null } | null}
 */
export function detectClaude() {
  const roots = getAgentSearchPaths('claude');
  const candidates = [];
  for (const root of Array.isArray(roots) ? roots : []) {
    if (typeof root !== 'string' || root.length === 0) continue;
    for (const proj of readDirSafe(root)) {
      if (!proj.isDirectory()) continue;
      const projDir = path.join(root, proj.name);
      for (const entry of readDirSafe(projDir)) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
        try {
          const { mtimeMs } = fs.statSync(path.join(projDir, entry.name));
          candidates.push({ id: path.basename(entry.name, '.jsonl'), mtimeMs });
        } catch { /* vanished between readdir and stat — skip */ }
      }
    }
  }
  const { best, runnerUpMs } = topTwo(candidates);
  if (!best) return null;
  return { agent: 'claude', sessionId: best.id, lastActivityMs: best.mtimeMs, runnerUpMs };
}

/**
 * Copilot CLI: `~/.copilot/session-state/<session-uuid>/events.jsonl`.
 * Newest events.jsonl mtime is the live session; sessionId is its parent dir.
 *
 * No capped walk: the state root holds one dir PER SESSION EVER RUN (thousands
 * on a long-lived machine), and the generic BFS this used to share had a scan
 * cap that exhausted in readdir order before covering them all — whether a LIVE
 * session's dir fell inside the cap was luck (observed 2026-07-19: three
 * sessions bound, a fourth invisible). The layout is exactly one level deep,
 * so enumerate the immediate subdirs and stat each one's events.jsonl — one
 * readdir + one stat per session dir, no walk, no cap.
 * @returns {{ agent: 'copilot', sessionId: string, lastActivityMs: number } | null}
 */
export function detectCopilot() {
  const dirs = getAgentSearchPaths('copilot');
  const candidates = [];
  for (const root of Array.isArray(dirs) ? dirs : []) {
    if (typeof root !== 'string' || root.length === 0) continue;
    for (const entry of readDirSafe(root)) {
      if (!entry.isDirectory()) continue;
      try {
        const st = fs.statSync(path.join(root, entry.name, 'events.jsonl'));
        candidates.push({ id: entry.name, mtimeMs: st.mtimeMs });
      } catch { /* session dir without events.jsonl — skip */ }
    }
  }
  const { best, runnerUpMs } = topTwo(candidates);
  if (!best) return null;
  return { agent: 'copilot', sessionId: best.id, lastActivityMs: best.mtimeMs, runnerUpMs };
}

/**
 * OpenCode: the most-recently-updated TOP-LEVEL session (parent_id IS NULL) in
 * the SQLite store. `time_updated` is a ms epoch. sessionId is the row id.
 * @returns {{ agent: 'opencode', sessionId: string, lastActivityMs: number } | null}
 */
export function detectOpencode() {
  const paths = getAgentSearchPaths('opencode');
  const spec = Array.isArray(paths) ? paths.find((p) => p && p.type === 'sqlite') : null;
  if (!spec || !spec.dbPath) return null;
  return queryOpencodeLatest(spec.dbPath);
}

/** Open the DB read-only and return the newest top-level session, or null. */
function queryOpencodeLatest(dbPath) {
  let db;
  try {
    // Lazy require: better-sqlite3 is a native dep only needed for opencode.
    const Database = require('better-sqlite3');
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = db
      .prepare(
        'SELECT id, time_updated FROM session '
          + 'WHERE parent_id IS NULL ORDER BY time_updated DESC LIMIT 2',
      )
      .all();
    const { best, runnerUpMs } = topTwo(
      rows.map((r) => ({ id: r.id, mtimeMs: Number(r.time_updated) || 0 })),
    );
    if (!best) return null;
    return { agent: 'opencode', sessionId: best.id, lastActivityMs: best.mtimeMs, runnerUpMs };
  } catch {
    return null;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        /* rule 03: best-effort close, never mask the primary result */
      }
    }
  }
}

/**
 * pi: the most-recently-modified session JSONL in the pinned session directory.
 *
 * This REPLACES detectMastra, which was a hardcoded `return null` because
 * mastracode had no readable session state to detect. pi persists its own
 * sessions, so this is a real detector and pi is in AUTO_MEASURE_AGENTS below —
 * the single clearest instance of the retired agent's degraded state being
 * replaced rather than ported.
 *
 * The directory is resolved here rather than via getAgentSearchPaths('pi')
 * because that helper serves the SUB-AGENT sweep registry, which pi is
 * deliberately absent from (no sub-agent concept in core). config/agents/pi.sh
 * pins PI_CODING_AGENT_SESSION_DIR, so that wins; the project-local path is the
 * fallback for a pi started outside the launcher.
 *
 * sessionId comes from the FILENAME (`<timestamp>_<uuid>.jsonl`), whose uuid is
 * the same id pi writes in the file's session header — so there is no need to
 * open and parse the file just to identify the session.
 * @returns {{ agent: 'pi', sessionId: string, lastActivityMs: number } | null}
 */
export function detectPi() {
  // An explicit pin is AUTHORITATIVE: if PI_CODING_AGENT_SESSION_DIR is set we
  // look there and nowhere else, even when it turns up empty. Falling back would
  // let the reconciler bind a session from a directory nobody configured, which
  // is a worse outcome than reporting "no live session".
  const root = process.env.PI_CODING_AGENT_SESSION_DIR
    || path.resolve('.observations', 'pi-sessions');

  const candidates = [];
  for (const entry of readDirSafe(root)) {
    if (entry.isDirectory()) continue;
    if (!entry.name.endsWith('.jsonl')) continue;
    try {
      const st = fs.statSync(path.join(root, entry.name));
      const base = entry.name.replace(/\.jsonl$/, '');
      const sep = base.lastIndexOf('_');
      candidates.push({ id: sep >= 0 ? base.slice(sep + 1) : base, mtimeMs: st.mtimeMs });
    } catch { /* vanished between readdir and stat — skip */ }
  }
  const { best, runnerUpMs } = topTwo(candidates);
  if (!best) return null;
  return { agent: 'pi', sessionId: best.id, lastActivityMs: best.mtimeMs, runnerUpMs };
}

const DETECTORS = {
  claude: detectClaude,
  opencode: detectOpencode,
  copilot: detectCopilot,
  pi: detectPi,
};

/** Agents the reconciler actively binds. */
export const AUTO_MEASURE_AGENTS = ['claude', 'opencode', 'copilot', 'pi'];

/**
 * Dispatch to the detector for `agent`. Unknown agents return null.
 * @param {string} agent
 * @returns {{ agent: string, sessionId: string, lastActivityMs: number } | null}
 */
export function detectForegroundSession(agent) {
  const fn = DETECTORS[agent];
  return typeof fn === 'function' ? fn() : null;
}
