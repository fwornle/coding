/**
 * lib/lsl/token/copilot-token-rows.mjs
 *
 * Phase 69, Plan 69-04 (Wave 2) — the pure EXTRACTION layer that turns a Copilot
 * CLI `events.jsonl` into `TokenUsageRow`-shaped objects, PLUS the Phase-1
 * event-vocabulary check that bakes the version-keyed granularity verdict. This
 * module does NOT touch the DB and does NOT wire any daemon — the INSERT (via
 * lib/lsl/token/token-db.mjs) and the live/sweep wiring land in Plan 06.
 *
 * Granularity (locked decisions):
 *   - D-04: the default/only viable tier is `per-session-aggregate`, sourced from
 *     `session.shutdown.modelMetrics.<model>.usage`. ONE row per model. The
 *     per-turn upgrade path (D-09) is wired but inert on the installed CLI.
 *   - D-09 (CRITICAL): the verdict is version-keyed. Installed CLI is v1.0.63
 *     (COPILOT_PROBED_VERSION). v1.0.63's per-turn events (`assistant.turn_*`,
 *     `tool.execution_*`) carry NO token usage — only `session.shutdown` does —
 *     so `per-session-aggregate` is the only viable tier. The upgrade branch
 *     (`verdict='per-turn'`) is present but never triggered with v1.0.63 data.
 *
 * Pitfall 5 (T-69-input): a model's `usage` MAY omit `reasoningTokens` entirely;
 *   every numeric field is coalesced `?? 0` so a row never writes NaN/null.
 *   Copilot's `reasoningTokens` is real (unlike Claude's estimated value) but
 *   only at the aggregate tier.
 *
 * Reuse (locked key-link): the canonical line primitive `parseCopilot`
 *   (src/live-logging/TranscriptNormalizer.js) is the ONLY Copilot line parser —
 *   no new JSONL parser is written. `parseCopilot` intentionally returns null for
 *   lifecycle events such as `session.shutdown` (it only surfaces conversation
 *   content + sub-agent records), so the event-`type` discriminator needed for
 *   the modelMetrics aggregate and the vocabulary enumeration is read from the
 *   raw line via a single JSON.parse; `parseCopilot` is still invoked on every
 *   line as the recognized-primitive gate (DRY-via-reuse, not a parallel parser).
 *
 * Security / robustness (threat register, Plan 69-04):
 *   - T-69-traversal: uid-check gate (st.uid === process.getuid()) — a non-owned
 *     events.jsonl yields [].
 *   - T-69-dos: per-line JSON.parse try/catch — a malformed line is skipped,
 *     never throws.
 *   - T-69-crypto / V6: `reasoningOpaque` is NEVER decoded — it is ignored
 *     entirely (no JSON.parse / base64 of it anywhere in this module).
 *
 * Per the CLAUDE.md logging rule: this module uses process.stderr.write only
 * (no stdout logging API). Pure ESM (no build step).
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// Locked reuse: the canonical Copilot line primitive (key-link contract).
// parseCopilot returns null for lifecycle events (session.shutdown etc.); it is
// invoked as the recognized-primitive gate while the event `type` discriminator
// for modelMetrics / vocabulary is read from the raw line (see header note).
import { parseCopilot } from '../../../src/live-logging/TranscriptNormalizer.js';

import { ADAPTER_USER_HASH_COPILOT } from './token-db.mjs';

/**
 * The version this adapter's vocabulary verdict is keyed to (D-09). Re-probe and
 * refresh on a CLI version change — newer events may add per-turn token usage,
 * which would flip the verdict to 'per-turn'.
 */
export const COPILOT_PROBED_VERSION = '1.0.63';

/** Coalesce a numeric usage field to 0 (T-69-input / Pitfall 5 — never NaN/null). */
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Coalesce a TEXT field to '' (NOT-NULL TEXT columns). */
function str(v) {
  return typeof v === 'string' ? v : '';
}

/**
 * uid-check gate (T-69-traversal) — stat the events.jsonl and fail closed on a
 * non-owned file. Returns the raw file content on success, or null (with a
 * stderr notice) on a non-owned / unreadable file.
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
 * Derive the session UUID for a Copilot `events.jsonl` (CR-02 — the natural key
 * for `(user_hash, tool_call_id)` dedup MUST be session-scoped, else two sessions
 * that used the same model collide and the second is silently dropped).
 *
 * Resolution order:
 *   1. The `session.start` event's `data.sessionId` captured during the line
 *      scan (the authoritative id — passed in as `scannedSessionId`).
 *   2. The parent directory name of the events path — Copilot stores sessions at
 *      `~/.copilot/session-state/<sessionId>/events.jsonl`.
 *   3. A non-empty placeholder (`'session-unknown'`) ONLY if neither is
 *      available — NEVER collapse to a bare model name.
 *
 * @param {string} eventsJsonlPath absolute path to events.jsonl
 * @param {string} scannedSessionId the data.sessionId seen on session.start ('' if absent)
 * @returns {string} a non-empty session id
 */
function deriveSessionUuid(eventsJsonlPath, scannedSessionId) {
  if (scannedSessionId) return scannedSessionId;
  const dirName = path.basename(path.dirname(eventsJsonlPath || ''));
  if (dirName && dirName !== '.' && dirName !== '/' && dirName !== '..') {
    return dirName;
  }
  return 'session-unknown';
}

/**
 * Build the per-session-aggregate token rows for a single Copilot `events.jsonl`.
 *
 * Streams the file line-by-line (reusing the `parseCopilot` recognized-primitive
 * gate per the locked key-link); on the `session.shutdown` event it reads
 * `data.modelMetrics` and emits ONE `per-session-aggregate` row per model. Every
 * numeric token field is coalesced `?? 0` (Pitfall 5 — a model omitting
 * `reasoningTokens` yields reasoning_tokens=0, never NaN/null). `reasoningOpaque`
 * is never decoded (V6).
 *
 * Honors the uid-check gate (non-owned file → []) and a per-line JSON.parse
 * try/catch (malformed line → skip). `task_id` is intentionally left `''` here —
 * the caller stamps it in Plan 06 (live → active span; completed-session →
 * timestamp-join backfill).
 *
 * @param {string} eventsJsonlPath absolute path to a Copilot events.jsonl
 * @param {object} [ctx] reserved for Plan 06 (e.g. task_id stamping); unused here
 * @returns {Array<object>} TokenUsageRow-shaped per-session-aggregate objects
 */
export function buildCopilotTokenRows(eventsJsonlPath, ctx = {}) { // eslint-disable-line no-unused-vars
  const raw = readOwnedFile(eventsJsonlPath);
  if (raw == null) return [];

  const rows = [];
  // CR-02: capture the session.start data.sessionId during the SAME line scan so
  // the per-session-aggregate tool_call_id can be session-scoped. session.start
  // always precedes session.shutdown in the stream, so it is set before any
  // aggregate row is built.
  let scannedSessionId = '';
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;

    // Reuse the canonical primitive as the recognized-line gate (key-link).
    // It returns null for session.shutdown, so the aggregate `type` discriminator
    // is read from the raw line below — no new JSONL parser is introduced.
    try {
      parseCopilot(line);
    } catch {
      // parseCopilot is defensive (returns null on bad input) — guard anyway.
    }

    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      // T-69-dos: malformed line → skip, never abort the pass.
      continue;
    }
    if (!evt || typeof evt !== 'object') continue;
    const eventType = evt.type || evt.event;

    // CR-02: session.start carries data.sessionId (session.shutdown does NOT).
    if (eventType === 'session.start') {
      const sid = evt.data && typeof evt.data.sessionId === 'string'
        ? evt.data.sessionId
        : '';
      if (sid) scannedSessionId = sid;
      continue;
    }

    if (eventType !== 'session.shutdown') continue;

    // Session-scoped natural key (CR-02): `<sessionUuid>:<model>`. Two sessions
    // that used the same model now yield DISTINCT tool_call_ids, so the sweep
    // dedup probe no longer drops the second session.
    const sessionUuid = deriveSessionUuid(eventsJsonlPath, scannedSessionId);

    const mm = evt.data && typeof evt.data.modelMetrics === 'object'
      ? evt.data.modelMetrics
      : null;
    if (!mm) continue;

    for (const [model, m] of Object.entries(mm)) {
      const usage = m && typeof m.usage === 'object' ? m.usage : {};
      const inputTokens = num(usage.inputTokens);
      const outputTokens = num(usage.outputTokens);
      rows.push({
        timestamp: str(evt.timestamp) || new Date().toISOString(),
        agent: 'copilot',
        provider: 'copilot',
        process: 'token-adapter-copilot',
        subscription: '',
        model: str(model),
        model_raw: str(model),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
        latency_ms: 0,
        overhead_ms: null,
        prompt_preview: '',
        tokens_estimated: 0,
        // Pitfall 5: reasoningTokens key MAY be absent — coalesce to 0.
        // Copilot's value is native (unlike Claude's estimate), so tokens_estimated stays 0.
        reasoning_tokens: num(usage.reasoningTokens),
        user_hash: ADAPTER_USER_HASH_COPILOT,
        task_id: '', // stamped by the caller in Plan 06
        // CR-02: session-scoped natural key — `<sessionUuid>:<model>`.
        tool_call_id: `${sessionUuid}:${str(model)}`,
        parent_call_id: '',
        granularity_tier: 'per-session-aggregate',
      });
    }
  }

  return rows;
}

/**
 * Phase-1 event-vocabulary check (D-04 / D-09 deliverable).
 *
 * Streams a Copilot `events.jsonl` and returns the set of distinct event `type:`
 * values plus the version-keyed granularity verdict:
 *
 *   - `types`: the distinct event `type` strings, in first-seen order.
 *   - `perTurnUsagePresent`: true iff some `assistant.*` event carries a non-empty
 *     per-turn token-usage payload (an `inputTokens`/`outputTokens` on the event's
 *     `data` or `data.usage`). v1.0.63's `assistant.message` carries `reasoningOpaque`
 *     + `toolRequests` but NO token counts, so this is false on the installed CLI.
 *   - `verdict`: `'per-turn'` when `perTurnUsagePresent`, else `'per-session-aggregate'`
 *     (D-04 — the only viable tier on v1.0.63; the upgrade branch is present but
 *     inert with v1.0.63 data).
 *
 * `reasoningOpaque` is NEVER decoded (V6). Honors the uid-check gate (non-owned
 * file → empty vocabulary) and a per-line JSON.parse try/catch (malformed line →
 * skip). `parseCopilot` is invoked as the recognized-primitive gate per the
 * locked key-link (it returns null for lifecycle events; the `type` discriminator
 * is read from the raw line).
 *
 * @param {string} eventsJsonlPath absolute path to a Copilot events.jsonl
 * @returns {{ types: string[], perTurnUsagePresent: boolean, verdict: string }}
 */
export function checkCopilotVocabulary(eventsJsonlPath) {
  const raw = readOwnedFile(eventsJsonlPath);
  if (raw == null) {
    return { types: [], perTurnUsagePresent: false, verdict: 'per-session-aggregate' };
  }

  const seen = new Set();
  const types = [];
  let perTurnUsagePresent = false;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;

    // Recognized-primitive gate (key-link reuse) — null for lifecycle events.
    try {
      parseCopilot(line);
    } catch {
      // parseCopilot is defensive; guard anyway.
    }

    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (!evt || typeof evt !== 'object') continue;
    const eventType = evt.type || evt.event;
    if (typeof eventType !== 'string' || !eventType) continue;

    if (!seen.has(eventType)) {
      seen.add(eventType);
      types.push(eventType);
    }

    // Per-turn upgrade probe (D-09): does an assistant.* event carry token usage?
    // v1.0.63 does NOT — so this stays false on the installed CLI.
    if (eventType.startsWith('assistant.')) {
      const data = evt.data && typeof evt.data === 'object' ? evt.data : {};
      const usage = data.usage && typeof data.usage === 'object' ? data.usage : data;
      const hasInput = typeof usage.inputTokens === 'number';
      const hasOutput = typeof usage.outputTokens === 'number';
      if (hasInput || hasOutput) {
        perTurnUsagePresent = true;
      }
    }
  }

  const verdict = perTurnUsagePresent ? 'per-turn' : 'per-session-aggregate';
  return { types, perTurnUsagePresent, verdict };
}

/**
 * Emit a stderr drift warning when the installed Copilot CLI version differs from
 * the version this adapter's verdict is keyed to (Pitfall 3 / D-09). On a version
 * change the vocabulary check must be re-run, because a newer CLI may surface
 * per-turn token usage that would flip the verdict to `'per-turn'`. No-op when
 * the versions match.
 *
 * @param {string} installedVersion the installed `copilot --version` string
 * @returns {void}
 */
export function warnOnVersionDrift(installedVersion) {
  if (installedVersion !== COPILOT_PROBED_VERSION) {
    process.stderr.write(
      `[token-adapter-copilot] CLI version drift: installed=${installedVersion} `
        + `probed=${COPILOT_PROBED_VERSION} — re-run vocabulary check\n`,
    );
  }
}
