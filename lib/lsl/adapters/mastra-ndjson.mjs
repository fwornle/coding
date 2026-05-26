/**
 * lib/lsl/adapters/mastra-ndjson.mjs — Mastra Path B (sweep) adapter.
 *
 * Phase 51 Plan 05 Task 1.
 *
 * Per RESEARCH-mastra.md (2026-05-26):
 *  - mastracode currently produces a single NDJSON file per project at
 *    <project>/.observations/transcripts/mastra-transcript.jsonl.
 *  - The file captures parent-session activity ONLY — there are NO sub-agent
 *    records in production today. The 2026-05-23 backfill scope for mastra is
 *    a no-op (no historical sub-agent data to recover).
 *  - Path A (spawn-time hook) is NOT VIABLE — mastracode emits no spawn
 *    lifecycle event for sub-agents. Adapter is sweep-only.
 *
 * This adapter is forward-compat scaffolding. RESEARCH §Detection plan —
 * Path B forward-compat hook documents the NDJSON record shape mastracode
 * WOULD emit if/when sub-agents were added:
 *
 *   {"type":"subagent_start","sessionId":"<parent>","subAgentSessionId":"<sub>",
 *    "subIndex":N,"subName":"reviewer","timestamp":"<iso>"}
 *   {"type":"message","role":"assistant","content":"...","sessionId":"<sub>",
 *    "subAgentSessionId":"<sub>","timestamp":"<iso>"}
 *   {"type":"subagent_end","sessionId":"<parent>","subAgentSessionId":"<sub>",
 *    "timestamp":"<iso>"}
 *
 * The adapter parses both shapes:
 *  - Current parent-only shape — zero sub-agent records, discover() returns []
 *    and emits a single stderr notice naming the file + "forward-compat hook ready".
 *  - Forward-compat shape — one row per subagent_start record, with
 *    convertToObservations() extracting the inner messages bracketed by
 *    subagent_start/subagent_end matching subAgentSessionId.
 *
 * Per CONTEXT.md D-Reuse: Phase 50's `lib/lsl/scan-and-convert.mjs`
 * `deriveProjectHint()` is NOT modified. The adapter parses NDJSON locally and
 * does its own project mapping from the filesystem ancestor of
 * `.observations/transcripts/`.
 *
 * Threat-model mitigations:
 *  - T-51-05-FI (filesystem traversal): uid-check on dir + file. Non-owned skipped.
 *  - T-51-05-PI (path-injection via session_start.cwd): project mapping uses
 *    the FILESYSTEM PATH ancestor, NOT the NDJSON `cwd` field. Allowlist regex.
 *  - T-51-05-FC (forward-compat brittleness): if mastracode emits sub-agent
 *    events with a different schema, Tests 4-7 will fail loudly.
 *  - T-51-05-NX (no-op safety): empty/missing files do NOT throw.
 *
 * Pure ESM. Zero new package installs.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import process from 'node:process';

const PROJECT_ALLOWLIST = /^[a-z0-9-]+$/i;
const SUPPORTED_EXTENSIONS = new Set(['.jsonl', '.ndjson']);

/**
 * Parse a single NDJSON line. Returns null on parse error or empty line.
 * No normalization — caller does the discriminator switch on `type`.
 */
export function parseMastraRecord(line) {
  if (!line || !line.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * Extract the project name from a transcript file path. Walks up the path
 * looking for `.observations/transcripts/` and returns path.basename of the
 * directory that owns it. Validates against the project allowlist regex.
 * Returns null on failure (with stderr emit by caller).
 */
export function extractProjectFromPath(filePath) {
  const marker = path.sep + '.observations' + path.sep + 'transcripts' + path.sep;
  const idx = filePath.indexOf(marker);
  if (idx < 0) {
    // Alternative: dir IS the transcripts dir directly. Use the parent-of-parent.
    // Caller may pass in a file path; fall through.
    return null;
  }
  const owner = filePath.slice(0, idx);
  const ownerBase = path.basename(owner);
  if (!ownerBase) return null;
  if (!PROJECT_ALLOWLIST.test(ownerBase)) return null;
  return ownerBase;
}

/**
 * uid-check helper. Returns true when the stat result indicates the file/dir
 * is owned by the running uid. On non-POSIX platforms (Windows, where uid is
 * undefined), returns true (uid-check is a POSIX-only safety gate).
 */
function isOwnedByMe(stat) {
  if (!stat || typeof stat.uid !== 'number') return true;
  const myUid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (myUid == null) return true;
  return stat.uid === myUid;
}

/**
 * Stream-parse a single NDJSON transcript file. Returns:
 *   { subAgents: Array<{parent_session_id, subAgentSessionId, subIndex, subName,
 *                       started_at, completed_at, inner_message_count}>,
 *     sawSubagentStart: boolean }
 *
 * Per RESEARCH landmine #5: subagent records are partitioned by sessionId of
 * the subagent_start record (NOT by file position). A single file may contain
 * multiple parent sessions interleaved.
 */
async function parseTranscriptFile(filePath) {
  // Session boundaries — detected from `{type:'session_start', sessionId, cwd}`
  // records WITHIN the NDJSON (NOT from filename). Per RESEARCH-mastra.md
  // landmine #5: multiple sessions may interleave in one file; the boundaries
  // are needed so future shapes (e.g. session-scoped sub-agents without an
  // explicit `sessionId` on the subagent_start record) can be correlated.
  const sessions = new Map(); // sessionId -> { cwd, started_at, ended_at }
  const subAgents = new Map(); // subAgentSessionId -> entry
  let sawSubagentStart = false;
  let fallbackIndex = 0;

  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const rec = parseMastraRecord(line);
    if (!rec || typeof rec.type !== 'string') continue;

    switch (rec.type) {
      case 'session_start': {
        // Register the session boundary (RESEARCH landmine #5).
        const sid = rec.sessionId;
        if (sid && typeof sid === 'string') {
          sessions.set(sid, {
            cwd: typeof rec.cwd === 'string' ? rec.cwd : '',
            started_at: typeof rec.timestamp === 'string' ? rec.timestamp : null,
            ended_at: null,
          });
        }
        break;
      }
      case 'session_end': {
        const sid = rec.sessionId;
        if (sid && typeof sid === 'string') {
          const existing = sessions.get(sid);
          if (existing) {
            existing.ended_at = typeof rec.timestamp === 'string' ? rec.timestamp : null;
          }
        }
        break;
      }
      case 'subagent_start': {
        sawSubagentStart = true;
        const subId = rec.subAgentSessionId;
        if (!subId || typeof subId !== 'string') break;
        fallbackIndex += 1;
        const entry = {
          // Partition by sessionId of THE subagent_start record (NOT by
          // preceding session_start file-position — RESEARCH landmine #5).
          parent_session_id: rec.sessionId || '',
          subAgentSessionId: subId,
          subIndex: Number.isInteger(rec.subIndex) ? rec.subIndex : fallbackIndex,
          subName: typeof rec.subName === 'string' ? rec.subName : '',
          started_at: typeof rec.timestamp === 'string' ? rec.timestamp : null,
          completed_at: null,
          inner_message_count: 0,
        };
        subAgents.set(subId, entry);
        break;
      }
      case 'subagent_end': {
        const subId = rec.subAgentSessionId;
        if (!subId || typeof subId !== 'string') break;
        const existing = subAgents.get(subId);
        if (existing) {
          existing.completed_at = typeof rec.timestamp === 'string' ? rec.timestamp : null;
        }
        break;
      }
      case 'message': {
        // Count inner messages tagged with subAgentSessionId.
        const subId = rec.subAgentSessionId;
        if (!subId || typeof subId !== 'string') break;
        const existing = subAgents.get(subId);
        if (existing) {
          existing.inner_message_count += 1;
        }
        break;
      }
      default:
        // onToolCall, onToolResult, unknown — ignore.
        break;
    }
  }

  return {
    subAgents: Array.from(subAgents.values()),
    sessions: Array.from(sessions.entries()).map(([id, info]) => ({ id, ...info })),
    sawSubagentStart,
  };
}

/**
 * Re-stream a transcript file and collect inner messages whose
 * `subAgentSessionId === targetSubId`. Returns Array<{role, content, timestamp}>
 * in file order.
 */
async function collectInnerMessages(filePath, targetSubId) {
  const messages = [];
  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const rec = parseMastraRecord(line);
    if (!rec) continue;
    if (rec.type !== 'message') continue;
    if (rec.subAgentSessionId !== targetSubId) continue;
    if (!rec.role || rec.content == null) continue;
    messages.push({
      role: rec.role,
      content: String(rec.content),
      timestamp: rec.timestamp || null,
    });
  }
  return messages;
}

/**
 * Walk a directory looking for transcript files matching *.jsonl or *.ndjson.
 * Returns absolute paths. Does NOT recurse — mastracode writes a single file
 * per project at the top of `.observations/transcripts/`.
 */
function listTranscriptFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (SUPPORTED_EXTENSIONS.has(ext)) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

/**
 * The locked adapter contract from Plan 51-01.
 */
export const adapter = {
  agentId: 'mastra',
  storageType: 'ndjson',

  /**
   * Discover sub-agent transcripts under the search paths.
   *
   * @param {object} opts
   * @param {Array<string>} opts.searchPaths  Directories containing mastra NDJSON files.
   * @param {string} [opts.project]           Project filter; rows whose derived project does not match are dropped.
   * @param {string} [opts.since]             ISO timestamp filter (unused in v1).
   * @returns {Promise<Array<RegistryRow>>}
   */
  async discover({ searchPaths, project, since } = {}) {
    const rows = [];
    if (!Array.isArray(searchPaths) || searchPaths.length === 0) return rows;

    for (const searchPath of searchPaths) {
      if (!searchPath || typeof searchPath !== 'string') continue;

      // Skip directories that don't exist (no-op safety per Test 3).
      let dirStat;
      try {
        dirStat = fs.statSync(searchPath);
      } catch {
        continue;
      }
      if (!dirStat.isDirectory()) continue;

      // uid-check on the directory (T-51-05-FI).
      if (!isOwnedByMe(dirStat)) {
        process.stderr.write(`[mastra-adapter] skipping non-owned dir: ${searchPath}\n`);
        continue;
      }

      const files = listTranscriptFiles(searchPath);
      for (const filePath of files) {
        // uid-check on the file (T-51-05-FI).
        let fileStat;
        try {
          fileStat = fs.statSync(filePath);
        } catch (err) {
          process.stderr.write(`[mastra-adapter] cannot stat ${filePath}: ${err.message}\n`);
          continue;
        }
        if (!isOwnedByMe(fileStat)) {
          process.stderr.write(`[mastra-adapter] skipping non-owned file: ${filePath}\n`);
          continue;
        }

        // Project derivation from filesystem ancestor (T-51-05-PI).
        const projectName = extractProjectFromPath(filePath);
        if (!projectName) {
          process.stderr.write(`[mastra-adapter] invalid project path (allowlist failed): ${filePath}\n`);
          continue;
        }
        if (project && projectName !== project) {
          // Project filter dropped this file silently.
          continue;
        }

        // Parse NDJSON; collect sub-agent entries.
        let parsed;
        try {
          parsed = await parseTranscriptFile(filePath);
        } catch (err) {
          process.stderr.write(`[mastra-adapter] parse error in ${filePath}: ${err.message}\n`);
          continue;
        }

        if (!parsed.sawSubagentStart) {
          // Current mastracode shape — parent-only NDJSON, no sub-agents.
          // Emit forward-compat notice and continue.
          process.stderr.write(
            `[mastra-adapter] no sub-agent records in ${filePath} (parent-only mastracode shape; forward-compat hook ready)\n`
          );
          continue;
        }

        // since-filter (drop sub-agents whose started_at is older than since).
        const sinceMs = since ? Date.parse(since) : null;

        // Emit one row per sub-agent entry.
        for (const entry of parsed.subAgents) {
          if (sinceMs != null && entry.started_at) {
            const ts = Date.parse(entry.started_at);
            if (Number.isFinite(ts) && ts < sinceMs) continue;
          }
          const subHash = entry.subAgentSessionId.slice(0, 7);
          rows.push({
            agent: 'mastra',
            sub_hash: subHash,
            parent_session_id: entry.parent_session_id,
            sub_index: entry.subIndex,
            transcript_path: filePath,
            project: projectName,
            status: 'discovered',
            detected_via: 'sweep',
            discovered_at: new Date().toISOString(),
            agent_metadata: {
              subName: entry.subName,
              subAgentSessionId: entry.subAgentSessionId,
              started_at: entry.started_at,
              completed_at: entry.completed_at,
              lsl_incomplete: false,
            },
          });
        }
      }
    }

    return rows;
  },

  /**
   * Convert discovered rows to observations.
   *
   * For each row (forward-compat shape only — current parent-only shape
   * produces zero rows so this loop is empty by default):
   *   1. Re-stream the NDJSON, capturing messages where
   *      `subAgentSessionId === row.agent_metadata.subAgentSessionId`.
   *   2. Call writer.processMessages with the sub-agent's messages,
   *      tagged with row metadata (parent_session_id, sub_index, sub_hash,
   *      agent='mastra', project, tag/source).
   *
   * @param {Array<RegistryRow>} rows
   * @param {object} opts
   * @param {boolean} [opts.dryRun=false]
   * @param {string}  [opts.tag='sub-agent-backfill']
   * @returns {Promise<Array<{sub_hash, observations_written, skipped, error}>>}
   */
  async convertToObservations(rows, { dryRun = false, tag = 'sub-agent-backfill' } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return [];

    // Late-import the writer so tests can mock it.
    let WriterClass = null;
    if (!dryRun) {
      const mod = await import('../../../src/live-logging/ObservationWriter.js');
      WriterClass = mod.ObservationWriter;
    }
    let writer = null;
    if (WriterClass) {
      writer = new WriterClass();
      if (typeof writer.init === 'function') await writer.init();
    }

    const results = [];
    for (const row of rows) {
      const result = {
        sub_hash: row.sub_hash,
        observations_written: 0,
        skipped: 0,
        error: null,
      };

      if (dryRun) {
        results.push(result);
        continue;
      }

      try {
        const subId = row.agent_metadata && row.agent_metadata.subAgentSessionId;
        if (!subId) {
          result.skipped += 1;
          results.push(result);
          continue;
        }
        const messages = await collectInnerMessages(row.transcript_path, subId);
        if (messages.length === 0) {
          result.skipped += 1;
          results.push(result);
          continue;
        }
        const metadata = {
          agent: 'mastra',
          project: row.project,
          parent_session_id: row.parent_session_id,
          sub_index: row.sub_index,
          sub_hash: row.sub_hash,
          tag,
          source: tag,
          sourceFile: row.transcript_path,
        };
        const r = await writer.processMessages(messages, metadata);
        result.observations_written = (r && r.observations) || 0;
      } catch (err) {
        result.error = err && err.message ? err.message : String(err);
        process.stderr.write(`[mastra-adapter] convert error for ${row.sub_hash}: ${result.error}\n`);
      }
      results.push(result);
    }

    if (writer && typeof writer.close === 'function') {
      await writer.close();
    }

    return results;
  },
};

/**
 * parseMastraExchanges — collect a sub-agent's inner messages from a
 * mastracode NDJSON transcript. Forward-compat: current mastracode shape
 * has no sub-agent messages, so this function returns [] for the
 * 2026-05 baseline. When mastracode adds sub-agents (RESEARCH-mastra.md
 * forward-compat hook), this function returns the writer-compatible
 * exchange shape.
 *
 * Plan 51-06 Task 3 helper.
 *
 * @param {string} ndjsonPath
 * @param {string} subAgentSessionId
 * @returns {Promise<Array<{role, content, timestamp}>>}
 */
export async function parseMastraExchanges(ndjsonPath, subAgentSessionId) {
  if (!ndjsonPath || !subAgentSessionId) return [];
  try {
    const stat = fs.statSync(ndjsonPath);
    if (!isOwnedByMe(stat)) {
      process.stderr.write(`[mastra-adapter] parseMastraExchanges: skipping non-owned ${ndjsonPath}\n`);
      return [];
    }
  } catch {
    return [];
  }
  const messages = await collectInnerMessages(ndjsonPath, subAgentSessionId);
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : '',
      timestamp: typeof m.timestamp === 'string' ? m.timestamp : '',
    }));
}

export default adapter;
