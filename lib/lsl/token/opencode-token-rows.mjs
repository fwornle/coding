/**
 * lib/lsl/token/opencode-token-rows.mjs
 *
 * Phase 85 — the pure EXTRACTION layer that turns the OpenCode SQLite session
 * store (`~/.local/share/opencode/opencode.db`) into `TokenUsageRow`-shaped
 * objects for measurement-stop foreground capture. Mirrors the copilot adapter
 * (copilot-token-rows.mjs) but reads SQLite per-message rows rather than a
 * per-session events.jsonl aggregate — OpenCode records native per-message token
 * usage, so this adapter is `per-turn` granularity.
 *
 * WHY THIS EXISTS (the gap it closes):
 *   The stop-adapter-registry marked `opencode` as `stamp-only` on the assumption
 *   that OpenCode ALWAYS routes through the rapid-llm-proxy (ANTHROPIC_BASE_URL),
 *   so its foreground tokens are already in token_usage. That assumption BREAKS
 *   for an OpenCode session whose backend provider is NOT the proxy — e.g.
 *   `github-copilot/claude-opus-4.8`, which talks to GitHub Copilot's endpoint
 *   directly. Such a session produces ZERO proxy rows, so a measured span records
 *   0 tokens (the exact ctx-drilldown-v1 result). This adapter reconstructs those
 *   tokens from OpenCode's own SQLite store.
 *
 * NO-DOUBLE-COUNT INVARIANT (D-04, provider-gated):
 *   The adapter emits a row ONLY for a message whose provider is in
 *   BYPASS_PROVIDERS (proven-not-proxy-routed). A proxy-routed OpenCode message
 *   (provider `anthropic`) is SKIPPED — its tokens are already the proxy's wire
 *   rows, and emitting a transcript row would double-count. This provider gate is
 *   the OpenCode analogue of copilot's "CLI permanently cannot be proxy-routed"
 *   argument: we only reconstruct what the proxy provably never saw.
 *
 * Security / robustness (mirrors copilot-token-rows.mjs):
 *   - uid-check gate: a non-owned opencode.db yields [] (never read a foreign DB).
 *   - readonly + busy_timeout: short-lived readonly connection; never blocks the
 *     live OpenCode writer (opencode-sqlite.mjs landmine #2).
 *   - bounded scan: only the most-recent MESSAGE_SCAN_LIMIT messages are read
 *     (rowid DESC) — the span-window clamp happens downstream in withinSpanWindow.
 *   - per-row JSON.parse try/catch: a malformed `data` blob is skipped, never throws.
 *
 * Per CLAUDE.md: process.stderr.write only (no-console-log). Pure ESM.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import Database from 'better-sqlite3';

import { ADAPTER_USER_HASH_OPENCODE } from './token-db.mjs';

/**
 * Providers whose OpenCode traffic BYPASSES the rapid-llm-proxy and is therefore
 * INVISIBLE to token_usage — the only providers this adapter reconstructs. A
 * provider NOT in this set is assumed proxy-routed (already captured) and is
 * skipped to preserve the no-double-count invariant. Extend deliberately, and
 * only for a provider proven to bypass the proxy.
 */
export const BYPASS_PROVIDERS = Object.freeze(new Set(['github-copilot']));

/** The default OpenCode SQLite store path. */
export const DEFAULT_OPENCODE_DB = path.join(
  os.homedir(),
  '.local',
  'share',
  'opencode',
  'opencode.db',
);

/** Bound the recent-message scan (rowid DESC). A measured span is minutes long;
 * the downstream withinSpanWindow clamp does the exact time filter. */
const MESSAGE_SCAN_LIMIT = 4000;

/** Coalesce a numeric field to 0 (never NaN/null into a NOT-NULL column). */
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Coalesce a TEXT field to '' (NOT-NULL TEXT columns). */
function str(v) {
  return typeof v === 'string' ? v : '';
}

/** Collapse whitespace and hard-cap a snippet length. */
function snip(s, n) {
  return str(s).replace(/\s+/g, ' ').trim().slice(0, n);
}

/**
 * Turn an assistant message's `part` blobs into a compact human-readable
 * "what was done this turn" summary — a lead text snippet plus the sequence of
 * tool actions (tool name + its most identifying argument). This is what the
 * Performance-tab timeline renders per turn so a run is no longer a wall of
 * anonymous token counts. Bounded to ~240 chars; never throws.
 *
 * @param {Array<object>} parts parsed part-data blobs, time-ordered
 * @returns {string} the activity summary ('' when nothing meaningful)
 */
function summarizeParts(parts) {
  const tools = [];
  let lead = '';
  for (const p of parts) {
    if (!p || typeof p !== 'object') continue;
    if (p.type === 'text' && !lead) {
      lead = snip(p.text ?? p.content, 140);
    } else if (p.type === 'tool') {
      const name = str(p.tool) || 'tool';
      const input = (p.state && typeof p.state.input === 'object' && p.state.input) || {};
      let arg = input.filePath
        ? str(input.filePath).split('/').pop()
        : str(input.description || input.pattern || input.command || input.url || '');
      arg = snip(arg, 52);
      tools.push(arg ? `${name}(${arg})` : name);
    }
  }
  const segs = [];
  if (lead) segs.push(lead);
  if (tools.length) {
    const shown = tools.slice(0, 8).join(', ');
    const extra = tools.length > 8 ? ` +${tools.length - 8}` : '';
    segs.push(`· ${shown}${extra}`);
  }
  return snip(segs.join(' '), 240);
}

/**
 * uid-check gate — stat the DB and fail closed on a non-owned file. Returns the
 * absolute path on success, or '' (with a stderr notice) on a non-owned / missing
 * file. Mirrors copilot-token-rows.readOwnedFile's ownership contract.
 *
 * @param {string} dbPath
 * @returns {string} the path when owned + present, else ''
 */
function ownedDbPath(dbPath) {
  let st;
  try {
    st = fs.statSync(dbPath);
  } catch (err) {
    process.stderr.write(
      `[token-adapter-opencode] stat failed: ${dbPath}: ${err.message}\n`,
    );
    return '';
  }
  if (typeof process.getuid === 'function') {
    const me = process.getuid();
    if (typeof st.uid === 'number' && st.uid !== me) {
      process.stderr.write(
        `[token-adapter-opencode] skipping non-owned ${dbPath} (file uid=${st.uid} != ${me})\n`,
      );
      return '';
    }
  }
  return dbPath;
}

/**
 * Extract the token usage object from an OpenCode assistant message `data` blob.
 * OpenCode shape (verified): `data.tokens = { total, input, output, reasoning,
 * cache: { read, write } }`. Returns null when absent / not an object.
 *
 * @param {object} d parsed message data
 * @returns {{input:number,output:number,reasoning:number,cacheRead:number,cacheWrite:number}|null}
 */
function extractTokens(d) {
  const t = d && typeof d.tokens === 'object' && d.tokens ? d.tokens : null;
  if (!t) return null;
  const cache = t.cache && typeof t.cache === 'object' ? t.cache : {};
  return {
    input: num(t.input),
    output: num(t.output),
    reasoning: num(t.reasoning),
    cacheRead: num(cache.read),
    cacheWrite: num(cache.write),
  };
}

/**
 * Build per-turn token rows from the OpenCode SQLite store.
 *
 * Reads the most-recent MESSAGE_SCAN_LIMIT messages (rowid DESC, readonly), and
 * for each ASSISTANT message whose provider is in BYPASS_PROVIDERS emits ONE
 * `per-turn` row. Messages from proxy-routed providers (anthropic) are SKIPPED
 * (no-double-count). Zero-token placeholder messages (the streaming stub with all
 * fields 0) are skipped. `task_id` is left '' — the caller (captureForegroundTokens)
 * stamps it with the span's task_id.
 *
 * @param {string} [dbPath] absolute path to opencode.db (default DEFAULT_OPENCODE_DB)
 * @param {object} [ctx] reserved (unused) — parity with the copilot builder signature
 * @returns {Array<object>} TokenUsageRow-shaped per-turn objects (possibly empty)
 */
export function buildOpencodeTokenRows(dbPath = DEFAULT_OPENCODE_DB, ctx = {}) { // eslint-disable-line no-unused-vars
  const resolved = ownedDbPath(dbPath);
  if (!resolved) return [];

  let db;
  const rows = [];
  try {
    db = new Database(resolved, { readonly: true, timeout: 5000 });
    // Prepared once — per-message part lookup is indexed (part_message_id_id_idx),
    // so the per-turn activity summary costs a bounded indexed scan per emitted row.
    let partStmt = null;
    try {
      partStmt = db.prepare(
        'SELECT data FROM part WHERE message_id = ? ORDER BY time_created ASC',
      );
    } catch {
      partStmt = null; // an OpenCode store predating the part table → no summaries, still emit tokens.
    }
    const activityFor = (messageId) => {
      if (!partStmt) return '';
      let partRecs;
      try {
        partRecs = partStmt.all(messageId);
      } catch {
        return '';
      }
      const parsed = [];
      for (const pr of partRecs) {
        try {
          parsed.push(JSON.parse(pr.data));
        } catch {
          // skip a malformed part blob, keep summarizing the rest
        }
      }
      return summarizeParts(parsed);
    };
    let records;
    try {
      records = db
        .prepare(
          'SELECT id, session_id, data FROM message ORDER BY rowid DESC LIMIT ?',
        )
        .all(MESSAGE_SCAN_LIMIT);
    } catch (err) {
      process.stderr.write(
        `[token-adapter-opencode] message query failed (non-fatal): ${err.message}\n`,
      );
      return [];
    }

    for (const rec of records) {
      let d;
      try {
        d = JSON.parse(rec.data);
      } catch {
        continue; // malformed blob → skip, never abort the pass
      }
      if (!d || typeof d !== 'object') continue;
      if (d.role !== 'assistant') continue;

      const provider = str(d.providerID || d.provider);
      // NO-DOUBLE-COUNT (D-04): only reconstruct bypass-provider messages. A
      // proxy-routed provider is already in token_usage as a wire row.
      if (!BYPASS_PROVIDERS.has(provider)) continue;

      const tok = extractTokens(d);
      if (!tok) continue;
      const total = tok.input + tok.output;
      // Skip the zero-token streaming placeholder (input+output+reasoning+cache all 0).
      if (total === 0 && tok.reasoning === 0 && tok.cacheRead === 0 && tok.cacheWrite === 0) {
        continue;
      }

      const createdMs = d.time && typeof d.time.created === 'number'
        ? d.time.created
        : NaN;
      const timestamp = Number.isFinite(createdMs)
        ? new Date(createdMs).toISOString()
        : new Date().toISOString();
      const model = str(d.modelID || d.model);

      rows.push({
        timestamp,
        agent: 'opencode',
        provider: provider || 'opencode',
        process: 'token-adapter-opencode',
        subscription: '',
        model,
        model_raw: model,
        input_tokens: tok.input,
        output_tokens: tok.output,
        total_tokens: total,
        latency_ms: 0,
        overhead_ms: null,
        prompt_preview: activityFor(rec.id),
        tokens_estimated: 0,
        cache_read_tokens: tok.cacheRead,
        cache_write_tokens: tok.cacheWrite,
        reasoning_tokens: tok.reasoning,
        user_hash: ADAPTER_USER_HASH_OPENCODE,
        task_id: '', // stamped by the caller (captureForegroundTokens)
        // Session-scoped natural key: `<session_id>:<message_id>` — unique per
        // assistant turn, so the (user_hash, tool_call_id) dedup never collides
        // across turns or sessions.
        tool_call_id: `${str(rec.session_id)}:${str(rec.id)}`,
        parent_call_id: '',
        granularity_tier: 'per-turn',
      });
    }
  } catch (err) {
    process.stderr.write(
      `[token-adapter-opencode] open failed (non-fatal): ${err.message}\n`,
    );
    return [];
  } finally {
    try {
      if (db) db.close();
    } catch {
      // best-effort close — never throw out of the builder.
    }
  }

  return rows;
}
