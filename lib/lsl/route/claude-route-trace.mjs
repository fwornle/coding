/**
 * lib/lsl/route/claude-route-trace.mjs
 *
 * Phase 72, Plan 72-03 (Wave 2) — the Claude normalized-route-trace reader (D-01).
 * Emits the cross-agent `RouteEvent[]` (lib/lsl/route/route-event.mjs) from the
 * tool-call slice of a Claude Code session / sub-agent JSONL — the DISJOINT slice
 * the Phase-69 *token* adapter (claude-token-rows.mjs, reads `usage`) SKIPS.
 *
 * It reuses ONLY the file-location + uid + line-primitive gates from the token
 * adapter (RESEARCH Anti-Patterns / Pitfall 3) — NOT the token-row builders:
 *   - the uid-check gate (claude-token-rows.mjs:82-101) copied VERBATIM — a
 *     non-owned file yields [] (T-72-03-FI / V4 access control);
 *   - the per-line JSON.parse try/catch (claude-token-rows.mjs:145-153) copied
 *     VERBATIM — a malformed line is skipped, never aborts (T-72-03-DOS / V5).
 *
 * Tool-call shape (confirmed on disk):
 *   assistant rec.message.content[] → { type:'tool_use', id, name, input }   ; rec.timestamp = start
 *   user      rec.message.content[] → { type:'tool_result', tool_use_id, is_error, content } ; rec.timestamp = end
 *   abandoned = a tool_use id absent from the tool_result map (no terminal event).
 *
 * D-07: one RouteEvent == one tool_use. Parallel same-turn tool_use blocks are
 * SEPARATE events — never collapsed / deduped by turn or by identical input.
 *
 * Per the CLAUDE.md logging rule: process.stderr.write only (no stdout logging
 * API). Pure ESM (no build step).
 */

import fs from 'node:fs';
import process from 'node:process';
import {
  SUBAGENT_PATH_RE,
  parentSessionFromClaudeSubagentPath,
} from '../adapters/claude-jsonl-tree.mjs';
import { inputsDigest, OUTCOMES } from './route-event.mjs';

/**
 * Build the normalized `RouteEvent[]` for a single Claude session / sub-agent
 * JSONL file from its tool_use / tool_result blocks.
 *
 * Honors the uid-check gate (non-owned file → []) and the per-line JSON.parse
 * try/catch (malformed line → skip). For a sub-agent path (SUBAGENT_PATH_RE),
 * `parentSessionFromClaudeSubagentPath` is consulted only to confirm the linkage
 * resolves; the emitted RouteEvent shape is agent-uniform (no parent field).
 *
 * @param {string} jsonlPath absolute path to a Claude session / sub-agent JSONL
 * @returns {Array<import('./route-event.mjs').RouteEvent>} 0-based seq, encounter order
 */
export function buildClaudeRouteTrace(jsonlPath) {
  // --- uid-check gate (T-72-03-FI) — fail closed on non-owned files. ---
  // Copied VERBATIM from lib/lsl/token/claude-token-rows.mjs:82-101.
  let st;
  try {
    st = fs.statSync(jsonlPath);
  } catch (err) {
    process.stderr.write(
      `[token-adapter] stat failed: ${jsonlPath}: ${err.message}\n`,
    );
    return [];
  }
  if (typeof process.getuid === 'function') {
    const me = process.getuid();
    if (st.uid !== me) {
      process.stderr.write(
        `[token-adapter] skipping non-owned ${jsonlPath} (file uid=${st.uid} != ${me})\n`,
      );
      return [];
    }
  }

  let raw;
  try {
    raw = fs.readFileSync(jsonlPath, 'utf-8');
  } catch (err) {
    process.stderr.write(
      `[route-reader-claude] read failed: ${jsonlPath}: ${err.message}\n`,
    );
    return [];
  }

  // Sub-agent linkage is reused (never re-walked) — consulted to keep the
  // file-location gate identical to the token adapter; the route reader does not
  // carry parent_call_id (the RouteEvent contract is agent-uniform, D-01).
  if (SUBAGENT_PATH_RE.test(jsonlPath)) {
    parentSessionFromClaudeSubagentPath(jsonlPath);
  }

  // First pass: collect tool_use starts (encounter order) and tool_result ends.
  /** @type {Array<{id:string,name:string,input:*,ts:string}>} */
  const starts = [];
  /** @type {Map<string,{ts:string,is_error:boolean}>} */
  const ends = new Map();

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      // T-72-03-DOS: malformed line → skip, never abort the pass.
      // (Per-line JSON.parse try/catch — claude-token-rows.mjs:145-153.)
      continue;
    }
    if (!rec || typeof rec !== 'object') continue;

    // The fixture nests content under `message`; fall back to a top-level
    // `content[]` if a record carries it directly.
    const msg = rec.message && typeof rec.message === 'object' ? rec.message : {};
    const content = Array.isArray(msg.content)
      ? msg.content
      : Array.isArray(rec.content)
        ? rec.content
        : null;
    if (!content) continue;

    const ts = typeof rec.timestamp === 'string' ? rec.timestamp : '';

    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'tool_use' && typeof block.id === 'string') {
        // D-07: one start per tool_use, in encounter order — parallel same-turn
        // blocks are pushed as SEPARATE entries (never collapsed).
        starts.push({
          id: block.id,
          name: typeof block.name === 'string' ? block.name : '',
          input: block.input,
          ts,
        });
      } else if (
        block.type === 'tool_result'
        && typeof block.tool_use_id === 'string'
      ) {
        // Keyed by tool_use_id (NOT positional). First terminal wins.
        if (!ends.has(block.tool_use_id)) {
          ends.set(block.tool_use_id, {
            ts,
            is_error: block.is_error === true,
          });
        }
      }
    }
  }

  // Second pass: one RouteEvent per tool_use, seq 0-based ascending.
  const events = [];
  let seq = 0;
  for (const s of starts) {
    const end = ends.get(s.id);
    const outcome = !end
      ? OUTCOMES.ABANDONED
      : end.is_error
        ? OUTCOMES.ERROR
        : OUTCOMES.SUCCESS;
    const targetPath = s.input && typeof s.input === 'object'
      && typeof s.input.file_path === 'string'
      ? s.input.file_path
      : null;
    events.push({
      seq: seq++,
      tool_call_id: s.id,
      tool_name: s.name,
      inputs_digest: inputsDigest(s.input),
      target_path: targetPath,
      started_at: s.ts || null,
      ended_at: end ? end.ts || null : null,
      outcome,
      agent: 'claude',
    });
  }

  return events;
}
