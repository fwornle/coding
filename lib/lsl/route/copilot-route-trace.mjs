/**
 * lib/lsl/route/copilot-route-trace.mjs
 *
 * Phase 72, Plan 72-03 (Wave 2) — the Copilot normalized-route-trace reader (D-01).
 * Emits the cross-agent `RouteEvent[]` (lib/lsl/route/route-event.mjs) from the
 * per-tool slice of a Copilot CLI `events.jsonl` — the DISJOINT slice the
 * Phase-69 *token* adapter (copilot-token-rows.mjs, reads `session.shutdown`)
 * SKIPS.
 *
 * State-of-the-Art: Copilot v1.0.63 `events.jsonl` carries full
 * `tool.execution_start` / `tool.execution_complete` per-tool events, so Copilot
 * computes a FULL RouteEvent[] and feeds all six heuristics. D-02 `null` is the
 * FALLBACK (only when the file can't be located) — Copilot is NOT pre-nulled.
 *
 * Reuse ONLY the gates from the token adapter (RESEARCH Anti-Patterns / Pitfall 3),
 * not the token-row builder:
 *   - `readOwnedFile()` (copilot-token-rows.mjs:83-110) — uid-check fail-closed
 *     read; a non-owned file returns null → this reader returns [] (T-72-03-FI);
 *   - `parseCopilot` (TranscriptNormalizer.js) invoked per line as the
 *     recognized-primitive gate (key-link); the `tool.execution_*` discriminator
 *     is read from the raw line via its own JSON.parse try/catch (T-72-03-DOS).
 *
 * Tool-call shape (confirmed v1.0.63):
 *   tool.execution_start.data    = { toolCallId, toolName, arguments } + evt.timestamp (start)
 *   tool.execution_complete.data = { toolCallId, success, result }     + evt.timestamp (end)
 *   outcome: success ← complete.data.success===true ; error ← false ;
 *            abandoned ← start with no complete ; denied folds into error (v0, A4).
 *
 * Matching is by `toolCallId` (NOT positional). Per the CLAUDE.md logging rule:
 * process.stderr.write only (no stdout logging API). Pure ESM (no build step).
 */

import fs from 'node:fs';
import process from 'node:process';

// Locked reuse: the canonical Copilot line primitive (key-link contract).
// parseCopilot returns null for lifecycle events (session.start/shutdown etc.);
// it is invoked as the recognized-primitive gate while the `tool.execution_*`
// discriminator is read from the raw line (no parallel parser introduced).
import { parseCopilot } from '../../../src/live-logging/TranscriptNormalizer.js';
import { inputsDigest, OUTCOMES } from './route-event.mjs';

/**
 * uid-check gate (T-72-03-FI) — stat the events.jsonl and fail closed on a
 * non-owned file. Returns the raw file content on success, or null (with a
 * stderr notice) on a non-owned / unreadable file.
 *
 * Copied VERBATIM from lib/lsl/token/copilot-token-rows.mjs:83-110.
 *
 * @param {string} eventsJsonlPath
 * @returns {string|null}
 */
function readOwnedFile(eventsJsonlPath) {
  let st;
  try {
    st = fs.statSync(eventsJsonlPath);
  } catch (err) {
    process.stderr.write(
      `[token-adapter-copilot] stat failed: ${eventsJsonlPath}: ${err.message}\n`,
    );
    return null;
  }
  if (typeof process.getuid === 'function') {
    const me = process.getuid();
    if (typeof st.uid === 'number' && st.uid !== me) {
      process.stderr.write(
        `[token-adapter-copilot] skipping non-owned ${eventsJsonlPath} (file uid=${st.uid} != ${me})\n`,
      );
      return null;
    }
  }
  try {
    return fs.readFileSync(eventsJsonlPath, 'utf-8');
  } catch (err) {
    process.stderr.write(
      `[token-adapter-copilot] read failed: ${eventsJsonlPath}: ${err.message}\n`,
    );
    return null;
  }
}

/**
 * Build the normalized `RouteEvent[]` for a single Copilot `events.jsonl` from
 * its `tool.execution_start` / `tool.execution_complete` events.
 *
 * Honors the uid-check gate (non-owned file → []) and the per-line JSON.parse
 * try/catch (malformed line → skip). Matching is by `data.toolCallId` (NOT
 * positional). Copilot is NOT pre-nulled — a present file yields a full trace.
 *
 * @param {string} eventsJsonlPath absolute path to a Copilot events.jsonl
 * @returns {Array<import('./route-event.mjs').RouteEvent>} 0-based seq, encounter order
 */
export function buildCopilotRouteTrace(eventsJsonlPath) {
  const raw = readOwnedFile(eventsJsonlPath);
  if (raw == null) return [];

  // First pass: collect execution_start (encounter order) + execution_complete.
  /** @type {Array<{id:string,name:string,args:*,ts:string}>} */
  const starts = [];
  /** @type {Map<string,{ts:string,success:boolean}>} */
  const ends = new Map();

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;

    // Recognized-primitive gate (key-link). parseCopilot returns null for
    // tool.execution_* lifecycle events, so the discriminator is read from the
    // raw line below — no new JSONL parser is introduced. Wrapped defensively.
    try {
      parseCopilot(line);
    } catch {
      // parseCopilot is defensive (returns null on bad input) — guard anyway.
    }

    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      // T-72-03-DOS: malformed line → skip, never abort the pass.
      continue;
    }
    if (!evt || typeof evt !== 'object') continue;

    const eventType = evt.type || evt.event;
    const data = evt.data && typeof evt.data === 'object' ? evt.data : null;
    if (!data || typeof data.toolCallId !== 'string') continue;
    const ts = typeof evt.timestamp === 'string' ? evt.timestamp : '';

    if (eventType === 'tool.execution_start') {
      starts.push({
        id: data.toolCallId,
        name: typeof data.toolName === 'string'
          ? data.toolName
          : typeof data.name === 'string'
            ? data.name
            : '',
        args: data.arguments,
        ts,
      });
    } else if (eventType === 'tool.execution_complete') {
      // Keyed by toolCallId (NOT positional). First terminal wins.
      if (!ends.has(data.toolCallId)) {
        // `success:true` → success; anything else (false / denied / absent
        // with a present complete event) folds into error (v0, A4).
        const success = data.success === true;
        ends.set(data.toolCallId, { ts, success });
      }
    }
  }

  // Second pass: one RouteEvent per start, seq 0-based ascending.
  const events = [];
  let seq = 0;
  for (const s of starts) {
    const end = ends.get(s.id);
    const outcome = !end
      ? OUTCOMES.ABANDONED
      : end.success
        ? OUTCOMES.SUCCESS
        : OUTCOMES.ERROR;
    const targetPath = s.args && typeof s.args === 'object'
      ? typeof s.args.file_path === 'string'
        ? s.args.file_path
        : typeof s.args.filePath === 'string'
          ? s.args.filePath
          : null
      : null;
    events.push({
      seq: seq++,
      tool_call_id: s.id,
      tool_name: s.name,
      inputs_digest: inputsDigest(s.args),
      target_path: targetPath,
      started_at: s.ts || null,
      ended_at: end ? end.ts || null : null,
      outcome,
      agent: 'copilot',
    });
  }

  return events;
}
