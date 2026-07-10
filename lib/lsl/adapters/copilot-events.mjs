/**
 * lib/lsl/adapters/copilot-events.mjs — Copilot Path B sweep adapter.
 *
 * Phase 51 Plan 04 Task 2 (CONTEXT.md AC #4 + D-LSL-Filename + D-Reuse).
 *
 * Walks `~/.copilot/session-state/<uuid>/events.jsonl`, reads each session's
 * sibling `workspace.yaml` to derive project (preferring git_root over cwd
 * per RESEARCH-copilot.md landmine #12), parses subagent.started/completed/
 * failed lifecycle events keyed by toolCallId, and produces registry rows
 * matching the locked Plan 51-01 schema.
 *
 * Key research findings honored:
 *  - sub_hash derives from toolCallId AFTER stripping `toolu_vrtx_` prefix —
 *    sub-agents share the parent's session uuid in Copilot, so the standard
 *    D-LSL-Filename `first 7 chars of session id` rule doesn't apply.
 *  - workspace.yaml is parsed via regex (NO js-yaml dep) per landmine #6.
 *  - Inner sub-agent reasoning is NOT in events.jsonl (only bookend lifecycle
 *    events); every row carries `lsl_incomplete: true` + reason string per
 *    landmine #2 + the "Recommendation A" stub-LSL decision.
 *  - Live sessions (`inuse.<pid>.lock` present) are skipped — Plan 51-09 handles
 *    the live tier.
 *  - uid-check on each session subdirectory mitigates T-51-04-FI.
 *
 * Per D-Reuse: lib/lsl/scan-and-convert.mjs and lib/lsl/window.mjs are NOT
 * imported. Workspace-yaml parsing happens at the adapter layer (not inside
 * scan-and-convert.deriveProjectHint as RESEARCH originally suggested) so
 * Phase 50 primitives remain untouched.
 *
 * Pure ESM. Zero new package installs (T-51-04-SC mitigation).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';

import { parseCopilot } from '../../../src/live-logging/TranscriptNormalizer.js';

const TOOL_CALL_PREFIX = 'toolu_vrtx_';
const PROJECT_ALLOWLIST_RE = /^[a-z0-9-]+$/i;

/**
 * Regex-based parser for the Copilot CLI's workspace.yaml shape.
 *
 * Expects a flat, single-doc YAML with fields: id, cwd, git_root, repository,
 * branch, created_at, updated_at. Returns an object with the fields present;
 * missing fields are absent from the result (NOT null) so callers can probe
 * with the `in` operator.
 *
 * Returns null on unreadable input.
 *
 * @param {string} text
 * @returns {object|null}
 */
export function parseWorkspaceYaml(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const out = {};
  const fields = ['id', 'cwd', 'git_root', 'repository', 'branch', 'created_at', 'updated_at'];
  for (const field of fields) {
    // Multi-line regex with anchored field at line start.
    // The value is captured as everything from the colon-space to end of line.
    const re = new RegExp(`^${field}:\\s+(.+)$`, 'm');
    const match = text.match(re);
    if (match && match[1]) {
      out[field] = match[1].trim();
    }
  }
  return out;
}

/**
 * Derive the project name from a parsed workspace.yaml.
 * Prefers git_root over cwd (landmine #12: llm-cli-proxy is a *component* of
 * `coding`, not its own project). Applies an allowlist regex and falls back
 * to 'unknown' (with stderr) on validation failure.
 *
 * @param {object|null} yaml
 * @returns {string}
 */
export function projectFromWorkspace(yaml) {
  if (!yaml || (!yaml.git_root && !yaml.cwd)) {
    return 'unknown';
  }
  const rootPath = yaml.git_root || yaml.cwd;
  // Reject paths containing parent-traversal segments.
  if (rootPath.includes('..')) {
    process.stderr.write(`[copilot-adapter] invalid project path: ${rootPath}\n`);
    return 'unknown';
  }
  const base = path.basename(rootPath);
  if (!base || !PROJECT_ALLOWLIST_RE.test(base)) {
    process.stderr.write(`[copilot-adapter] invalid project path: ${rootPath}\n`);
    return 'unknown';
  }
  return base;
}

/**
 * Strip the `toolu_vrtx_` prefix from a Copilot toolCallId and take the first
 * 7 chars. Defensive fallback: if the prefix is missing, take the first 7
 * chars of the raw value and emit a stderr notice (landmine #3).
 *
 * @param {string} toolCallId
 * @returns {string}
 */
export function stripToolCallIdPrefix(toolCallId) {
  if (!toolCallId || typeof toolCallId !== 'string') {
    process.stderr.write(`[copilot-adapter] unexpected toolCallId format: ${String(toolCallId)}\n`);
    return '';
  }
  if (toolCallId.startsWith(TOOL_CALL_PREFIX)) {
    return toolCallId.slice(TOOL_CALL_PREFIX.length).slice(0, 7);
  }
  process.stderr.write(`[copilot-adapter] unexpected toolCallId format: ${toolCallId}\n`);
  return toolCallId.slice(0, 7);
}

/**
 * Test whether a session directory contains a live-session lock file
 * (`inuse.<pid>.lock`). Live sessions are skipped — Path A in Plan 51-09
 * handles the live tier.
 */
function hasLiveLock(sessionDir) {
  let entries;
  try {
    entries = fs.readdirSync(sessionDir);
  } catch {
    return false;
  }
  return entries.some((e) => /^inuse\.\d+\.lock$/.test(e));
}

/**
 * Stream-parse a Copilot events.jsonl file into an ordered list of sub-agent
 * lifecycle records (started, completed, failed). Conversation events are
 * ignored — they would be handled by the per-session LSL writer in Plan 51-06.
 *
 * Returns Array<{ subEventType, toolCallId, agentName, agentDisplayName,
 *                 agentDescription, timestamp, errorMessage }>.
 */
async function readSubAgentEvents(eventsPath) {
  const out = [];
  const stream = fs.createReadStream(eventsPath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let parsed;
    try {
      parsed = parseCopilot(line);
    } catch {
      continue;
    }
    if (!parsed || parsed.type !== 'subagent') continue;
    out.push(parsed);
  }
  return out;
}

/**
 * Stitch started/completed/failed events into per-toolCallId rows.
 * Order preserved by first-occurrence of `started`.
 */
function stitchSubAgentRows(events) {
  const byToolCallId = new Map();
  const startedOrder = [];

  for (const evt of events) {
    const tcId = evt.toolCallId;
    if (!tcId) continue;
    if (evt.subEventType === 'started') {
      if (!byToolCallId.has(tcId)) {
        byToolCallId.set(tcId, {
          toolCallId: tcId,
          agentName: evt.agentName,
          agentDisplayName: evt.agentDisplayName,
          agentDescription: evt.agentDescription,
          started_at: evt.timestamp,
          completed_at: null,
          completion_status: null,
          errorMessage: null,
        });
        startedOrder.push(tcId);
      }
    } else if (evt.subEventType === 'completed') {
      const row = byToolCallId.get(tcId);
      if (row) {
        row.completed_at = evt.timestamp;
        row.completion_status = 'success';
      }
    } else if (evt.subEventType === 'failed') {
      const row = byToolCallId.get(tcId);
      if (row) {
        row.completed_at = evt.timestamp;
        row.completion_status = 'error';
        row.errorMessage = evt.errorMessage;
      }
    }
  }
  return startedOrder.map((tcId) => byToolCallId.get(tcId));
}

/**
 * Build a single Plan 51-01 registry row from a stitched sub-agent record.
 */
function buildRow({ stitched, subIndex, sessionUuid, eventsPath, project }) {
  const subHash = stripToolCallIdPrefix(stitched.toolCallId);
  return {
    agent: 'copilot',
    sub_hash: subHash,
    parent_session_id: sessionUuid,
    sub_index: subIndex,
    transcript_path: eventsPath,
    project,
    status: 'discovered',
    detected_via: 'sweep',
    discovered_at: new Date().toISOString(),
    agent_metadata: {
      toolCallId: stitched.toolCallId,
      agentName: stitched.agentName,
      agentDisplayName: stitched.agentDisplayName,
      agentDescription: stitched.agentDescription,
      started_at: stitched.started_at,
      completed_at: stitched.completed_at,
      completion_status: stitched.completion_status,
      errorMessage: stitched.errorMessage,
      lsl_incomplete: true,
      lsl_incomplete_reason: 'Copilot CLI emits only subagent.started/completed lifecycle events; inner reasoning not persisted',
    },
  };
}

/**
 * discover() — walk one or more `session-state` root directories.
 *
 * @param {object} opts
 * @param {string[]} opts.searchPaths   Array of session-state roots (e.g.
 *                                       [`~/.copilot/session-state`]).
 * @param {string}   [opts.project]      Optional project filter — when set,
 *                                       sessions whose project does not match
 *                                       are skipped (NOT counted as unknown).
 *                                       'coding' is the default in callers.
 * @param {string}   [opts.since]        ISO timestamp — currently advisory
 *                                       (every events.jsonl is read); reserved
 *                                       for the live-tier plan that adds
 *                                       mtime-based filtering.
 * @returns {Promise<object[]>}
 */
async function discover({ searchPaths, project, since } = {}) {
  if (!Array.isArray(searchPaths) || searchPaths.length === 0) return [];
  const myUid = typeof process.getuid === 'function' ? process.getuid() : null;
  const rows = [];

  // Honor `since` via events.jsonl mtime (2026-07-10). Previously `since` was
  // advisory and EVERY session was re-read + re-converted, so the 30-min sweep
  // re-summarized the same ~100 STATIC historical sessions on every run — one
  // LLM call each (~4,800 wasted calls/day, measured on 8.6k sessions all >24h
  // old). A completed copilot session's events.jsonl is append-only and never
  // rewritten, so its mtime is a stable "last active" clock: skip sessions with
  // no new events since the last sweep. Genuinely new/active sub-agent sessions
  // (mtime > since) still flow through. Invalid/absent `since` → no filter.
  const sinceMs = since ? Date.parse(since) : NaN;

  for (const root of searchPaths) {
    if (!root || !fs.existsSync(root)) continue;

    let sessionEntries;
    try {
      sessionEntries = fs.readdirSync(root, { withFileTypes: true });
    } catch (err) {
      process.stderr.write(`[copilot-adapter] cannot read ${root}: ${err.message}\n`);
      continue;
    }

    for (const entry of sessionEntries) {
      if (!entry.isDirectory()) continue;
      const sessionUuid = entry.name;
      const sessionDir = path.join(root, sessionUuid);

      // uid-check (T-51-04-FI)
      try {
        const dirStat = fs.statSync(sessionDir);
        if (myUid != null && typeof dirStat.uid === 'number' && dirStat.uid !== myUid) {
          process.stderr.write(`[copilot-adapter] skipping non-owned session ${sessionUuid} (uid=${dirStat.uid})\n`);
          continue;
        }
      } catch {
        continue;
      }

      // Live-session lock guard (T-51-04-RC)
      if (hasLiveLock(sessionDir)) {
        process.stderr.write(`[copilot-adapter] skipping live session ${sessionUuid} (inuse lock present)\n`);
        continue;
      }

      const eventsPath = path.join(sessionDir, 'events.jsonl');
      if (!fs.existsSync(eventsPath)) continue;

      // since-gate: skip sessions with no new events since the last sweep. This
      // is the guard that stops the 30-min re-burn on static historical rows.
      if (!Number.isNaN(sinceMs)) {
        let evMtime = 0;
        try { evMtime = fs.statSync(eventsPath).mtimeMs; } catch { evMtime = 0; }
        if (evMtime > 0 && evMtime <= sinceMs) continue;
      }

      // Parse sibling workspace.yaml
      let workspace = null;
      const workspacePath = path.join(sessionDir, 'workspace.yaml');
      if (fs.existsSync(workspacePath)) {
        try {
          workspace = parseWorkspaceYaml(fs.readFileSync(workspacePath, 'utf8'));
        } catch (err) {
          process.stderr.write(`[copilot-adapter] cannot read workspace.yaml for ${sessionUuid}: ${err.message}\n`);
        }
      } else {
        process.stderr.write(`[copilot-adapter] workspace.yaml missing for ${sessionUuid}\n`);
      }

      const rowProject = projectFromWorkspace(workspace);
      if (project && rowProject !== project && rowProject !== 'unknown') {
        continue;
      }

      // Read + stitch sub-agent lifecycle events
      let events;
      try {
        events = await readSubAgentEvents(eventsPath);
      } catch (err) {
        process.stderr.write(`[copilot-adapter] cannot read events.jsonl for ${sessionUuid}: ${err.message}\n`);
        continue;
      }
      const stitchedList = stitchSubAgentRows(events);

      stitchedList.forEach((stitched, idx) => {
        const row = buildRow({
          stitched,
          subIndex: idx + 1,
          sessionUuid,
          eventsPath,
          project: rowProject,
        });
        rows.push(row);
      });
    }
  }

  return rows;
}

/**
 * convertToObservations() — synthesize one observation per row.
 *
 * Per RESEARCH key finding ("Recommendation A — stub-LSL with lsl_incomplete"):
 * inner sub-agent reasoning is NOT in events.jsonl. We build a synthetic
 * user+assistant exchange carrying the spawn metadata + lifecycle outcome
 * summary, then route it through ObservationWriter. Every emitted observation
 * carries metadata.lsl_incomplete=true so dashboard consumers know this
 * Copilot row is degraded vs. Claude Code rows.
 *
 * @param {object[]} rows
 * @param {object}   [opts]
 * @param {boolean}  [opts.dryRun=false]
 * @param {string}   [opts.tag]
 * @returns {Promise<Array<{ sub_hash, observations_written, skipped, error }>>}
 */
async function convertToObservations(rows, { dryRun = false, tag } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  if (dryRun) {
    return rows.map((row) => ({ sub_hash: row.sub_hash, observations_written: 0, skipped: 0 }));
  }
  // 2026-07-06: write via obs-api (single km-core owner), NOT a local
  // ObservationWriter — Phase 44 Plan 12 cut the writer's standalone path, so
  // the bare constructor burned one LLM call per row and then failed the
  // km-core write on every 30-min sweep (~4,800 wasted calls/day). The HTTP
  // client's init() health-probes obs-api BEFORE any LLM spend, and obs-api's
  // in-process writer pre-LLM dedups re-discovered rows by content hash.
  const { ObservationApiClient } = await import('../../../src/live-logging/ObservationApiClient.js');
  const writer = new ObservationApiClient();
  if (typeof writer.init === 'function') await writer.init();

  const results = [];
  for (const row of rows) {
    const meta = row.agent_metadata || {};
    const desc = meta.agentDescription
      ? String(meta.agentDescription).slice(0, 200)
      : '';
    const summary =
      `Copilot sub-agent ${meta.agentName} spawned at ${meta.started_at}, ` +
      `${meta.completion_status || 'running'} at ${meta.completed_at || 'n/a'}. ${desc}`;

    const userMsg = {
      id: `copilot-user-${row.sub_hash}`,
      role: 'user',
      content: `[Copilot sub-agent invocation: ${meta.agentName}]`,
      createdAt: meta.started_at || row.discovered_at,
      metadata: { agent: 'copilot', synthetic: true },
    };
    const asstMsg = {
      id: `copilot-asst-${row.sub_hash}`,
      role: 'assistant',
      content: summary,
      createdAt: meta.completed_at || meta.started_at || row.discovered_at,
      metadata: { agent: 'copilot', synthetic: true },
    };

    try {
      const r = await writer.processMessages([userMsg, asstMsg], {
        agent: 'copilot',
        sourceFile: row.transcript_path,
        source: tag || 'sub-agent-backfill',
        tag,
        project: row.project,
        parent_session_id: row.parent_session_id,
        sub_index: row.sub_index,
        sub_hash: row.sub_hash,
        lsl_incomplete: true,
        lsl_incomplete_reason: meta.lsl_incomplete_reason
          || 'Copilot CLI emits only lifecycle bookends; inner reasoning not persisted to events.jsonl',
      });
      results.push({ sub_hash: row.sub_hash, observations_written: r?.observations || 0, skipped: 0 });
    } catch (err) {
      process.stderr.write(`[copilot-adapter] convert failed for ${row.sub_hash}: ${err.message}\n`);
      results.push({ sub_hash: row.sub_hash, observations_written: 0, error: err.message });
    }
  }

  if (typeof writer.close === 'function') await writer.close();
  return results;
}

/**
 * parseCopilotExchanges — synthesize a single user/assistant exchange
 * pair from a Copilot sub-agent's lifecycle bookends.
 *
 * Per RESEARCH-copilot.md key finding: Copilot CLI emits ONLY
 * subagent.started/completed/failed lifecycle events on events.jsonl;
 * the inner sub-agent reasoning is NOT persisted. There is no inner
 * transcript to recover. This helper consumes the same events.jsonl
 * the adapter scanned, finds the started/completed/failed pair for the
 * requested toolCallId, and returns ONE synthetic exchange:
 *   user      = '[Copilot sub-agent invocation]'
 *   assistant = <spawn metadata + outcome summary>
 *
 * The caller (Plan 51-06 CLI) is responsible for stamping
 * `lsl_incomplete=true` on the registry row's `agent_metadata` BEFORE
 * passing to writeSubAgentLSL — the writer reads this directly into
 * frontmatter (Plan 51-06 Task 2 Test 6).
 *
 * Plan 51-06 Task 3 helper.
 *
 * @param {string} eventsJsonlPath
 * @param {string} toolCallId
 * @returns {Promise<Array<{role, content, timestamp}>>}
 */
export async function parseCopilotExchanges(eventsJsonlPath, toolCallId) {
  if (!toolCallId) return [];
  let events;
  try {
    events = await readSubAgentEvents(eventsJsonlPath);
  } catch {
    return [];
  }
  const stitched = stitchSubAgentRows(events);
  const row = stitched.find((s) => s && s.toolCallId === toolCallId);
  if (!row) return [];
  const desc = row.agentDescription ? String(row.agentDescription).slice(0, 200) : '';
  const summary =
    `Copilot sub-agent ${row.agentName || 'unknown'} spawned at ${row.started_at}, ` +
    `${row.completion_status || 'running'} at ${row.completed_at || 'n/a'}. ${desc}`;
  return [
    {
      role: 'user',
      content: `[Copilot sub-agent invocation: ${row.agentName || 'unknown'}]`,
      timestamp: row.started_at || new Date().toISOString(),
    },
    {
      role: 'assistant',
      content: summary,
      timestamp: row.completed_at || row.started_at || new Date().toISOString(),
    },
  ];
}

export const adapter = {
  agentId: 'copilot',
  storageType: 'events-jsonl',
  discover,
  convertToObservations,
};
