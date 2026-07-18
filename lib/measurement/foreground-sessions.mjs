/**
 * Per-agent foreground-session detection (Phase 68-04, auto-measure Plan B).
 *
 * The measurement reconciler (scripts/measurement-reconciler.mjs) polls these
 * detectors to learn which session each coding agent is CURRENTLY driving, then
 * binds live proxy traffic to it by writing active-measurement.<agent>.json.
 *
 * Contract — every detector returns `{ agent, sessionId, lastActivityMs }` for
 * the most-recently-active top-level session, or `null` when none is found.
 * `lastActivityMs` is a Unix epoch in milliseconds; the reconciler owns the
 * freshness decision so this module stays a pure "newest session" locator.
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

// Bound every directory walk (NASA rule 2). A developer machine holds at most a
// few thousand session files; 20k is a generous ceiling that still terminates.
const MAX_SCAN_ENTRIES = 20000;

/**
 * Walk `dirs` breadth-first (bounded) and return the single newest file whose
 * basename satisfies `matchName`, as `{ filePath, mtimeMs }` or null.
 *
 * @param {string[]} dirs
 * @param {(name: string) => boolean} matchName
 * @returns {{ filePath: string, mtimeMs: number } | null}
 */
function newestMatchingFile(dirs, matchName) {
  /** @type {string[]} */
  const queue = dirs.filter((d) => typeof d === 'string' && d.length > 0);
  let best = null;
  let scanned = 0;

  while (queue.length > 0 && scanned < MAX_SCAN_ENTRIES) {
    const dir = queue.shift();
    const entries = readDirSafe(dir);
    for (const entry of entries) {
      if (scanned >= MAX_SCAN_ENTRIES) break;
      scanned += 1;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
      } else if (entry.isFile() && matchName(entry.name)) {
        best = pickNewer(best, full);
      }
    }
  }
  return best;
}

/** Read a directory's entries, returning [] on any error (rule 06: no throw). */
function readDirSafe(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Return whichever of `best`/`candidate path` has the greater mtime. */
function pickNewer(best, full) {
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(full).mtimeMs;
  } catch {
    return best;
  }
  if (!best || mtimeMs > best.mtimeMs) return { filePath: full, mtimeMs };
  return best;
}

/**
 * Claude Code: `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`.
 * Newest .jsonl mtime is the live session; sessionId is the filename stem.
 * @returns {{ agent: 'claude', sessionId: string, lastActivityMs: number } | null}
 */
export function detectClaude() {
  const dirs = getAgentSearchPaths('claude');
  const hit = newestMatchingFile(dirs, (name) => name.endsWith('.jsonl'));
  if (!hit) return null;
  const sessionId = path.basename(hit.filePath, '.jsonl');
  if (!sessionId) return null;
  return { agent: 'claude', sessionId, lastActivityMs: hit.mtimeMs };
}

/**
 * Copilot CLI: `~/.copilot/session-state/<session-uuid>/events.jsonl`.
 * Newest events.jsonl mtime is the live session; sessionId is its parent dir.
 * @returns {{ agent: 'copilot', sessionId: string, lastActivityMs: number } | null}
 */
export function detectCopilot() {
  const dirs = getAgentSearchPaths('copilot');
  const hit = newestMatchingFile(dirs, (name) => name === 'events.jsonl');
  if (!hit) return null;
  const sessionId = path.basename(path.dirname(hit.filePath));
  if (!sessionId) return null;
  return { agent: 'copilot', sessionId, lastActivityMs: hit.mtimeMs };
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
    const row = db
      .prepare(
        'SELECT id, time_updated FROM session '
          + 'WHERE parent_id IS NULL ORDER BY time_updated DESC LIMIT 1',
      )
      .get();
    if (!row || !row.id) return null;
    return { agent: 'opencode', sessionId: row.id, lastActivityMs: Number(row.time_updated) || 0 };
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
 * Mastra: intentionally stubbed — the agent is being retired, so auto-measure
 * never binds it. Returns null so the reconciler simply skips it.
 * @returns {null}
 */
export function detectMastra() {
  return null;
}

const DETECTORS = {
  claude: detectClaude,
  opencode: detectOpencode,
  copilot: detectCopilot,
  mastra: detectMastra,
};

/** Agents the reconciler actively binds (mastra excluded — stubbed/retiring). */
export const AUTO_MEASURE_AGENTS = ['claude', 'opencode', 'copilot'];

/**
 * Dispatch to the detector for `agent`. Unknown agents return null.
 * @param {string} agent
 * @returns {{ agent: string, sessionId: string, lastActivityMs: number } | null}
 */
export function detectForegroundSession(agent) {
  const fn = DETECTORS[agent];
  return typeof fn === 'function' ? fn() : null;
}
