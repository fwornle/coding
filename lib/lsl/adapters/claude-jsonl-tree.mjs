/**
 * lib/lsl/adapters/claude-jsonl-tree.mjs — Claude Code Path B sweep adapter.
 *
 * Phase 51 Plan 02 Task 1.
 *
 * Implements the locked adapter contract from Plan 51-01 (see
 * lib/lsl/adapters/README.md). Walks
 *   ~/.claude/projects/<encoded-cwd>/<parent-uuid>/subagents/agent-<hex>.jsonl
 * applies the fs uid-check gate (T-51-02-FI), filters non-sidechain records
 * defense-in-depth (RESEARCH-claude.md landmine #3), enriches each row with
 *   { agent, sub_hash, parent_session_id, sub_index, transcript_path,
 *     project, status, detected_via, discovered_at, agent_metadata }
 * computes `sub_index` by first-message timestamp within each parent UUID
 * group (RESEARCH-claude.md landmine #8 — NOT lexicographic), and delegates
 * conversion to Phase 50's convertTranscriptsToObservations() unchanged
 * per CONTEXT.md D-Reuse.
 *
 * Per CLAUDE.md no-console-log rule: this module uses process.stderr.write
 * exclusively for forensic output.
 *
 * Pure ESM (no build step). Zero new package installs.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { convertTranscriptsToObservations } from '../scan-and-convert.mjs';

/**
 * Matches a Claude sub-agent transcript path:
 *   .../.claude/projects/<encoded-cwd>/<parent-uuid>/subagents/agent-<hex>.jsonl
 *
 * Capture groups:
 *   $1 — encoded-cwd (e.g. '-Users-Q284340-Agentic-coding')
 *   $2 — parent session UUID (36-char canonical UUID format)
 *   $3 — agent hex id (lowercase hex)
 */
export const SUBAGENT_PATH_RE = /\/\.claude\/projects\/(-[^/]+)\/([0-9a-f-]{36})\/subagents\/agent-([a-f0-9]+)\.jsonl$/;

/**
 * Project-name allowlist (T-51-02-PI). The decoded project name (last segment
 * of the encoded-cwd path) MUST match this regex; otherwise the row is dropped.
 * The regex rejects '/', '..', control chars, and anything outside [a-z0-9-].
 */
const PROJECT_NAME_ALLOW = /^[a-z0-9-]+$/i;

/**
 * Decode an encoded-cwd string to its filesystem path.
 *   '-Users-Q284340-Agentic-coding' → '/Users/Q284340/Agentic/coding'
 */
function decodeEncodedCwd(encoded) {
  return encoded.replace(/^-/, '/').replace(/-/g, '/');
}

/**
 * Project name (last segment of decoded cwd) from a transcript path.
 *
 * Falls back to the file's first JSONL line `cwd` field if path-walk fails
 * (defense-in-depth — RESEARCH-claude.md landmine #1).
 *
 * Returns 'unknown' if both routes fail.
 *
 * @param {string} transcriptPath
 * @returns {string}
 */
export function projectFromClaudeSubagentPath(transcriptPath) {
  const m = transcriptPath.match(SUBAGENT_PATH_RE);
  if (m) {
    const decoded = decodeEncodedCwd(m[1]);
    const segments = decoded.split('/').filter(Boolean);
    return segments[segments.length - 1] || 'unknown';
  }
  // Fallback to first-line cwd.
  try {
    const firstLine = readFirstLine(transcriptPath);
    const obj = JSON.parse(firstLine);
    if (obj && obj.cwd) return path.basename(obj.cwd);
  } catch {
    /* swallow */
  }
  return 'unknown';
}

/**
 * Parent session UUID from a transcript path. Null if no match.
 */
export function parentSessionFromClaudeSubagentPath(transcriptPath) {
  const m = transcriptPath.match(SUBAGENT_PATH_RE);
  return m ? m[2] : null;
}

/**
 * Full 17-char agent hex id from a transcript path. Null if no match.
 */
export function agentIdFromClaudeSubagentPath(transcriptPath) {
  const m = transcriptPath.match(SUBAGENT_PATH_RE);
  return m ? m[3] : null;
}

/**
 * sub_hash = first 7 chars of the agent hex id (CONTEXT.md D-LSL-Filename
 * Claude-specific override).
 */
export function subHashFromAgentId(agentId) {
  if (!agentId || typeof agentId !== 'string') return null;
  return agentId.slice(0, 7);
}

/**
 * Read the first non-empty line of a file synchronously. Returns the line
 * verbatim (without trailing newline) or '' if the file is empty/unreadable.
 *
 * Defensive: opens the file with fs.openSync + readSync into a small buffer
 * so we don't pay the cost of streaming an entire large transcript just to
 * peek at line 1.
 */
function readFirstLine(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const head = buf.slice(0, n).toString('utf-8');
    const nl = head.indexOf('\n');
    return nl >= 0 ? head.slice(0, nl) : head;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Read the first JSONL record's `timestamp` field. Returns ISO string or
 * null if the line is missing/malformed.
 */
export function readFirstMessageTimestamp(filePath) {
  try {
    const line = readFirstLine(filePath);
    const obj = JSON.parse(line);
    if (obj && typeof obj.timestamp === 'string') return obj.timestamp;
  } catch {
    /* swallow */
  }
  return null;
}

/**
 * Read up to N records from a transcript and return the first ASSISTANT
 * record found, or null. Used to extract attributionAgent/attributionSkill.
 *
 * Bounded at 10 lines per landmine #10 (attributionSkill may be null).
 */
function readFirstAssistantRecord(filePath, maxLines = 10) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const lines = buf.slice(0, n).toString('utf-8').split('\n');
    for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
      const ln = lines[i].trim();
      if (!ln) continue;
      try {
        const obj = JSON.parse(ln);
        if (obj && (obj.type === 'assistant' || (obj.message && obj.message.role === 'assistant'))) {
          return obj;
        }
      } catch {
        /* skip malformed line */
      }
    }
  } catch {
    /* swallow */
  } finally {
    if (fd != null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
  return null;
}

/**
 * Group rows by parent_session_id, sort each group by first-message timestamp
 * ascending, assign 1-based sub_index within each group, and return the
 * (mutated) rows. RESEARCH-claude.md landmine #8.
 */
export function computeSubIndexes(rows) {
  const byParent = new Map();
  for (const r of rows) {
    const key = r.parent_session_id || '__null__';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(r);
  }
  for (const [, group] of byParent) {
    group.sort((a, b) => {
      const ta = Date.parse(a.__firstMessageTs || '') || 0;
      const tb = Date.parse(b.__firstMessageTs || '') || 0;
      return ta - tb;
    });
    group.forEach((r, i) => { r.sub_index = i + 1; });
  }
  return rows;
}

/**
 * Walk a directory tree and return absolute paths of all sub-agent JSONL files.
 * Filters by the SUBAGENT_PATH_RE at the candidate stage so unrelated jsonl
 * files (e.g. parent session transcripts at the top level) are not picked up.
 */
function walkSubAgentJsonl(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  visit(root);
  return out;

  function visit(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        visit(full);
      } else if (e.isFile() && full.endsWith('.jsonl')) {
        // Only keep paths that match the sub-agent layout. This makes the
        // adapter safe to run against the entire ~/.claude/projects/ tree.
        if (SUBAGENT_PATH_RE.test(full)) {
          out.push(full);
        }
      }
    }
  }
}

/**
 * Build one registry row from a candidate transcript path. Returns null when
 * the file fails any of the gates:
 *  - uid-check (T-51-02-FI)
 *  - isSidechain:false on the first record (defense-in-depth, landmine #3)
 *  - project-name allowlist (T-51-02-PI)
 */
function buildRow(absPath) {
  let st;
  try {
    st = fs.statSync(absPath);
  } catch (err) {
    process.stderr.write(`[claude-adapter] stat failed: ${absPath}: ${err.message}\n`);
    return null;
  }
  // T-51-02-FI: uid-check gate — fail closed.
  if (typeof process.getuid === 'function') {
    const me = process.getuid();
    if (st.uid !== me) {
      process.stderr.write(`[claude-adapter] skipping non-owned ${absPath} (file uid=${st.uid} != ${me})\n`);
      return null;
    }
  }

  // Peek at the first line for the isSidechain gate (landmine #3) and
  // simultaneously capture the first-message timestamp for sub_index ordering.
  let firstObj = null;
  try {
    const firstLine = readFirstLine(absPath);
    if (firstLine && firstLine.trim()) {
      try {
        firstObj = JSON.parse(firstLine);
      } catch {
        // Truncated/malformed first line — landmine #5. We still proceed:
        // the row is produced; conversion-time parsing is the Phase 50
        // primitive's job. firstObj stays null and timestamp ordering falls
        // back to lexicographic-by-default (Date.parse('') === NaN → 0).
        firstObj = null;
      }
    }
  } catch (err) {
    process.stderr.write(`[claude-adapter] read failed: ${absPath}: ${err.message}\n`);
    return null;
  }
  if (firstObj && firstObj.isSidechain === false) {
    process.stderr.write(`[claude-adapter] skipped non-sidechain ${absPath}\n`);
    return null;
  }

  const project = projectFromClaudeSubagentPath(absPath);
  if (!PROJECT_NAME_ALLOW.test(project)) {
    process.stderr.write(`[claude-adapter] skipping ${absPath}: project name "${project}" not in allowlist\n`);
    return null;
  }
  const parentSessionId = parentSessionFromClaudeSubagentPath(absPath);
  const agentId = agentIdFromClaudeSubagentPath(absPath);
  if (!parentSessionId || !agentId) {
    process.stderr.write(`[claude-adapter] could not parse path: ${absPath}\n`);
    return null;
  }
  const subHash = subHashFromAgentId(agentId);

  // Attribution: try to find the first assistant record's attributionAgent /
  // attributionSkill. Bounded at 10 lines (landmine #10).
  let attributionAgent = null;
  let attributionSkill = null;
  try {
    const asst = readFirstAssistantRecord(absPath, 10);
    if (asst) {
      if (typeof asst.attributionAgent === 'string') attributionAgent = asst.attributionAgent;
      if (typeof asst.attributionSkill === 'string') attributionSkill = asst.attributionSkill;
    }
  } catch {
    /* swallow */
  }

  const firstMessageTs = firstObj && typeof firstObj.timestamp === 'string'
    ? firstObj.timestamp
    : null;

  return {
    agent: 'claude',
    sub_hash: subHash,
    parent_session_id: parentSessionId,
    sub_index: null, // populated by computeSubIndexes()
    transcript_path: absPath,
    project,
    status: 'discovered',
    detected_via: 'sweep',
    discovered_at: new Date().toISOString(),
    agent_metadata: {
      agent_id: agentId,
      attributionAgent,
      attributionSkill,
    },
    // internal — stripped before returning to caller
    __firstMessageTs: firstMessageTs,
    __mtimeMs: st.mtimeMs,
  };
}

/**
 * Locked Plan-51-01 adapter contract.
 */
export const adapter = {
  agentId: 'claude',
  storageType: 'jsonl-tree',

  /**
   * Discover sub-agent transcripts under the provided search paths.
   *
   * @param {object} opts
   * @param {Array<string>} opts.searchPaths
   * @param {string} [opts.project]   Filter rows by project name.
   * @param {string} [opts.since]     ISO timestamp; rows with mtime < since are dropped.
   * @returns {Promise<Array<object>>}
   */
  async discover({ searchPaths, project, since } = {}) {
    if (!Array.isArray(searchPaths) || searchPaths.length === 0) return [];
    const sinceMs = since ? Date.parse(since) : null;
    const candidates = [];
    for (const root of searchPaths) {
      if (!root) continue;
      for (const p of walkSubAgentJsonl(root)) {
        candidates.push(p);
      }
    }
    // Deduplicate (in case search paths overlap).
    const seen = new Set();
    const unique = candidates.filter((p) => {
      if (seen.has(p)) return false;
      seen.add(p);
      return true;
    });

    const rows = [];
    for (const absPath of unique) {
      const row = buildRow(absPath);
      if (!row) continue;
      if (sinceMs != null && row.__mtimeMs < sinceMs) continue;
      if (project && row.project !== project) continue;
      rows.push(row);
    }

    computeSubIndexes(rows);

    // Sort by mtime ascending (oldest first), matching the Phase 50
    // primitive's sort order.
    rows.sort((a, b) => a.__mtimeMs - b.__mtimeMs);

    // Strip internal helper fields before returning.
    for (const r of rows) {
      delete r.__firstMessageTs;
      delete r.__mtimeMs;
    }
    return rows;
  },

  /**
   * Convert discovered rows to observations via the Phase 50 primitive
   * (lib/lsl/scan-and-convert.mjs).
   *
   * Per the Plan 51-02 Option A pattern: call the primitive once per row so
   * the per-row metadata (parent_session_id, sub_index, sub_hash, agent,
   * project) can be passed through via the `tag` field carrying a
   * JSON-encoded payload — the primitive stamps `metadata.source = tag` and
   * downstream observation rows can be re-stamped via a single UPDATE keyed
   * on `metadata.sourceFile` after the primitive writes.
   *
   * @param {Array<object>} rows
   * @param {object} opts
   * @param {boolean} [opts.dryRun=false]
   * @param {string}  [opts.tag='sub-agent-backfill']
   * @returns {Promise<Array<{ sub_hash, observations_written, skipped, error }>>}
   */
  async convertToObservations(rows, { dryRun = false, tag } = {}) {
    const effectiveTag = tag || 'sub-agent-backfill';
    const results = [];
    if (!Array.isArray(rows) || rows.length === 0) return results;
    for (const row of rows) {
      // Build a transcript entry shaped like scanTranscriptsForUnconverted()
      // returns — but carry the per-row metadata fields as additional
      // properties so the dispatcher and any post-write stamp pass can pick
      // them up. The Phase 50 primitive uses `.path` and ignores extras.
      const transcript = {
        path: row.transcript_path,
        mtime: row.__mtimeMs ?? Date.now(),
        projectHint: row.project,
        parentSession: row.parent_session_id,
        // per-row metadata channel (Option A)
        parent_session_id: row.parent_session_id,
        sub_index: row.sub_index,
        sub_hash: row.sub_hash,
        agent: 'claude',
        project: row.project,
      };
      let observations_written = 0;
      let skipped = 0;
      let error = null;
      try {
        const primitiveResults = await convertTranscriptsToObservations(
          [transcript],
          { dryRun, tag: effectiveTag },
        );
        if (Array.isArray(primitiveResults) && primitiveResults.length > 0) {
          observations_written = primitiveResults[0].observationsWritten || 0;
          skipped = primitiveResults[0].skipped || 0;
        }
      } catch (err) {
        error = err && err.message ? err.message : String(err);
      }
      results.push({
        sub_hash: row.sub_hash,
        observations_written,
        skipped,
        error,
      });
    }
    return results;
  },
};
