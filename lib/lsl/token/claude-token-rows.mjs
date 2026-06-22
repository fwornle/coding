/**
 * lib/lsl/token/claude-token-rows.mjs
 *
 * Phase 69, Plan 69-03 (Wave 2) — the pure EXTRACTION layer that turns Claude
 * Code session / sub-agent JSONL records into `TokenUsageRow`-shaped objects.
 * This module does NOT touch the DB and does NOT wire any daemon — the INSERT
 * (via lib/lsl/token/token-db.mjs) and the live/sweep wiring land in Plan 05.
 *
 * Granularity (locked decisions):
 *   - D-01: each assistant `usage` block → exactly one `granularity_tier='per-turn'`
 *     row, PLUS a distinct `granularity_tier='per-reasoning-step'` row per
 *     extended-thinking block (NOT folded into the turn row).
 *   - D-05 (CRITICAL): Claude's `usage` block carries NO native reasoning-token
 *     field — thinking is folded into `output_tokens`. The per-reasoning-step
 *     rows are first-class and emitted, but `reasoning_tokens` is ESTIMATED from
 *     the thinking-block content length via `estimateReasoningTokens(text)`, and
 *     every such row stamps `tokens_estimated=1` to flag the value as derived.
 *     NEVER claim the count is extracted from `usage`. Per-turn rows use
 *     `tokens_estimated=0` and `reasoning_tokens=0`.
 *   - D-02: a sub-agent JSONL path (matching SUBAGENT_PATH_RE) carries
 *     `parent_call_id` resolved via the EXPORTED claude-jsonl-tree linkage
 *     (`parentSessionFromClaudeSubagentPath`) — never a re-walked subagents dir.
 *
 * Security / robustness (threat register, Plan 69-03):
 *   - T-69-traversal: uid-check gate (st.uid === process.getuid()) re-applied
 *     verbatim from claude-jsonl-tree.mjs:251-258 — non-owned files yield [].
 *   - T-69-input / T-69-dos: per-line JSON.parse try/catch — a malformed line is
 *     skipped, never throws; numeric usage fields coalesced (`?? 0`) so a
 *     malformed block never writes NaN/null.
 *
 * Per the CLAUDE.md logging rule: this module uses process.stderr.write only
 * (no stdout logging API).
 * Pure ESM (no build step).
 */

import fs from 'node:fs';
import process from 'node:process';
import {
  SUBAGENT_PATH_RE,
  parentSessionFromClaudeSubagentPath,
} from '../adapters/claude-jsonl-tree.mjs';
import { ADAPTER_USER_HASH_CLAUDE } from './token-db.mjs';

/**
 * Deterministic, length-derived reasoning-token estimate (D-05).
 *
 * Claude's session JSONL carries NO native reasoning-token field, so the value
 * is ESTIMATED from the thinking-block content length as `ceil(chars / 4)`
 * (a conventional ~4-chars-per-token heuristic), floored at 1 so empty /
 * undefined thinking text still yields a positive integer. This is NEVER a
 * native extraction — rows built from it stamp `tokens_estimated=1`.
 *
 * @param {string|undefined|null} text the thinking-block content
 * @returns {number} a positive integer estimate (>= 1)
 */
export function estimateReasoningTokens(text) {
  return Math.max(1, Math.ceil((text?.length ?? 0) / 4));
}

/** Coalesce a numeric usage field to 0 (T-69-input — never NaN/null). */
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Build the per-turn + per-reasoning-step token rows for a single Claude
 * session / sub-agent JSONL file.
 *
 * Honors the uid-check gate (non-owned file → []) and the per-line JSON.parse
 * try/catch (malformed line → skip). For a sub-agent path (SUBAGENT_PATH_RE),
 * the isSidechain first-record gate is applied and `parent_call_id` is resolved
 * via the locked claude-jsonl-tree linkage (D-02). For a main-session path,
 * `parent_call_id` stays `''`.
 *
 * `task_id` is intentionally left `''` here — the caller stamps it in Plan 05
 * (live → active span; completed-session → timestamp-join backfill).
 *
 * @param {string} jsonlPath absolute path to a Claude session / sub-agent JSONL
 * @param {object} [ctx] reserved for Plan 05 (e.g. task_id stamping); unused here
 * @returns {Array<object>} TokenUsageRow-shaped objects (per-turn + per-reasoning-step)
 */
export function buildClaudeTokenRows(jsonlPath, ctx = {}) { // eslint-disable-line no-unused-vars
  // --- uid-check gate (T-69-traversal) — fail closed on non-owned files. ---
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
      `[token-adapter] read failed: ${jsonlPath}: ${err.message}\n`,
    );
    return [];
  }

  // --- D-02: sub-agent parent linkage (reuse, never re-implement). ---
  const isSubAgent = SUBAGENT_PATH_RE.test(jsonlPath);
  const parentCallId = isSubAgent
    ? parentSessionFromClaudeSubagentPath(jsonlPath) || ''
    : '';

  const lines = raw.split('\n');

  // isSidechain first-record gate (claude-jsonl-tree.mjs:280) — applied ONLY
  // for sub-agent paths: a sub-agent transcript whose FIRST record is
  // isSidechain:false is not a genuine sidechain → skip the whole file.
  if (isSubAgent) {
    for (const line of lines) {
      if (!line.trim()) continue;
      let firstObj;
      try {
        firstObj = JSON.parse(line);
      } catch {
        // Malformed first line — proceed (parse gate handled per-record below).
        break;
      }
      if (firstObj && firstObj.isSidechain === false) {
        process.stderr.write(
          `[token-adapter] skipped non-sidechain ${jsonlPath}\n`,
        );
        return [];
      }
      break; // only inspect the first non-empty record
    }
  }

  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      // T-69-dos: malformed line → skip, never abort the pass.
      continue;
    }
    if (!rec || typeof rec !== 'object') continue;
    if (rec.type !== 'assistant') continue;

    // The fixture nests usage/content/model under `message`; the record top
    // level carries requestId/uuid/model. Read both, preferring `message`.
    const msg = rec.message && typeof rec.message === 'object' ? rec.message : {};
    const usage = msg.usage || rec.usage;
    if (!usage || typeof usage !== 'object') continue;

    const model = str(msg.model) || str(rec.model);
    const baseToolCallId = str(rec.requestId) || str(rec.uuid);
    const inputTokens = num(usage.input_tokens);
    const outputTokens = num(usage.output_tokens);

    // --- D-01: one per-turn row per usage block. ---
    rows.push({
      timestamp: str(rec.timestamp),
      agent: 'claude',
      provider: 'claude-code',
      process: 'token-adapter-claude',
      subscription: '',
      model,
      model_raw: model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      latency_ms: 0,
      overhead_ms: null,
      prompt_preview: '',
      tokens_estimated: 0,
      reasoning_tokens: 0,
      user_hash: ADAPTER_USER_HASH_CLAUDE,
      task_id: '', // stamped by the caller in Plan 05
      tool_call_id: baseToolCallId,
      parent_call_id: parentCallId,
      granularity_tier: 'per-turn',
    });

    // --- D-01 / D-05: one ESTIMATED per-reasoning-step row per thinking block. ---
    const content = Array.isArray(msg.content)
      ? msg.content
      : Array.isArray(rec.content)
        ? rec.content
        : [];
    let reasonIdx = 0;
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type !== 'thinking') continue;
      const thinkingText = typeof block.thinking === 'string' ? block.thinking : '';
      rows.push({
        timestamp: str(rec.timestamp),
        agent: 'claude',
        provider: 'claude-code',
        process: 'token-adapter-claude',
        subscription: '',
        model,
        model_raw: model,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        latency_ms: 0,
        overhead_ms: null,
        prompt_preview: '',
        // D-05: estimated value — flag as derived, NOT a native usage extraction.
        tokens_estimated: 1,
        reasoning_tokens: estimateReasoningTokens(thinkingText),
        user_hash: ADAPTER_USER_HASH_CLAUDE,
        task_id: '',
        tool_call_id: `${baseToolCallId}:reason:${reasonIdx}`,
        parent_call_id: parentCallId,
        granularity_tier: 'per-reasoning-step',
      });
      reasonIdx += 1;
    }
  }

  return rows;
}

/** Coalesce a TEXT field to '' (NOT-NULL TEXT columns). */
function str(v) {
  return typeof v === 'string' ? v : '';
}
