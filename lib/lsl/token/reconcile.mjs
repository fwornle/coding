/**
 * lib/lsl/token/reconcile.mjs
 *
 * Phase 83, Plan 83-03 — the reconcile matcher. A pure, unit-tested engine that
 * joins an adapter-derived transcript row to its authoritative wire row and
 * decides enrich-vs-flag-vs-fallback, WITHOUT ever double-counting. It is the
 * testable heart of Phase 83, isolated from the I/O wiring so Plan 04 stays thin.
 *
 * Design (locked decisions):
 *   - D-04 (fill gaps only): wire values are authoritative and NEVER overwritten.
 *     The transcript enriches ONLY the fields the wire row lacks (reasoning_tokens,
 *     granularity_tier, parent_call_id, and the cache split when the wire cache
 *     sum is 0) via the Task-1 `reconcileGapFill` primitive. Count disagreements
 *     are RECORDED, never applied.
 *   - D-05 (record all deltas, flag beyond tolerance): every nonzero per-field
 *     delta on a matched pair is recorded; a delta beyond
 *     `max(2% of the larger value, 50 tokens)` is `flagged: true`. Calibrated so
 *     the 82-06 v2 matched-pair cache_read spread (~47946–72264) does NOT
 *     false-flag legitimate pairs (a flat 50-token floor would flag every real
 *     large-cache pair).
 *   - Cross-key join (D-04): wire rows and transcript rows carry DIFFERENT
 *     `user_hash` by design, so the match probes on `tool_call_id` ALONE
 *     (== upstream request-id) via `probeWireRowByRequestId` — NOT the
 *     `(user_hash, tool_call_id)` dedup key.
 *
 * Security / robustness:
 *   - T-83-03-01 (Tampering): every DB read binds via `?` — model/id never
 *     interpolated. The fuzzy candidate SELECT binds the model.
 *   - T-83-03-03 (DoS): NEVER throws. Any DB error → a safe unmatched result
 *     plus a `[reconcile]` stderr line; a reconciliation failure never fails a
 *     run (D-06).
 *
 * Analogs:
 *   - Authority model: token-db.mjs `insertTokenRowDeduped` (the matcher's
 *     direct ancestor) + the Task-1 `probeWireRowByRequestId` / `reconcileGapFill`.
 *   - Window semantics: stop-adapter-registry.mjs `withinSpanWindow` (~:319-328)
 *     — replicated here as the outer clamp (it is module-private there).
 */

import process from 'node:process';
import { probeWireRowByRequestId, reconcileGapFill } from './token-db.mjs';

/** Coalesce a numeric field to 0 (mirrors token-db.mjs `num`). */
function num(v) {
  return v ?? 0;
}

/**
 * The per-field delta set (D-05). Cache is split so a cheap cache-read delta is
 * never conflated with a fresh-input delta.
 */
const DELTA_FIELDS = [
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'reasoning_tokens',
];

/** Default fuzzy window: a wire row must be within 2 min of the transcript ts. */
const DEFAULT_FUZZY_WINDOW_MS = 2 * 60_000;

/** The bounded fuzzy-candidate SELECT — model bound via `?` (T-83-03-01). */
const FUZZY_CANDIDATES_SQL =
  'SELECT id, tool_call_id, model, timestamp, input_tokens, output_tokens, ' +
  'reasoning_tokens, cache_read_tokens, cache_write_tokens, parent_call_id, granularity_tier ' +
  'FROM token_usage WHERE model = ?';

/**
 * A `:reason:N`-suffixed tool_call_id is a per-reasoning-step row the wire never
 * carries (the wire has no reasoning-step split), so it BYPASSES matching
 * entirely and is always inserted with provenance by Plan 04.
 */
function isReasonStep(toolCallId) {
  return typeof toolCallId === 'string' && /:reason:\d+$/.test(toolCallId);
}

/**
 * The D-05 tolerance for a single field: `max(2% of the larger value, 50)`. The
 * relative term keeps legitimate large-cache pairs (82-06 v2 ~47946–72264) from
 * being blanket-flagged; the 50-token floor keeps tiny values from flagging on
 * sub-token rounding.
 */
function toleranceFor(a, b) {
  return Math.max(0.02 * Math.max(a, b), 50);
}

/**
 * The withinSpanWindow outer clamp (replicated from stop-adapter-registry.mjs,
 * where it is module-private). A candidate wire row whose timestamp falls outside
 * the span window (1 min before started_at, 5 min after ended_at) is rejected.
 * When the span carries no window (unit tests) or the ts is unparseable, keep it
 * (best-effort, backward compat).
 */
function withinSpanWindow(tsMs, span) {
  const startMs = span && span.started_at ? Date.parse(span.started_at) : NaN;
  const endMs = span && span.ended_at ? Date.parse(span.ended_at) : NaN;
  if (!Number.isFinite(startMs) && !Number.isFinite(endMs)) return true;
  if (!Number.isFinite(tsMs)) return true;
  const lo = Number.isFinite(startMs) ? startMs - 60_000 : -Infinity;
  const hi = Number.isFinite(endMs) ? endMs + 5 * 60_000 : Infinity;
  return tsMs >= lo && tsMs <= hi;
}

/**
 * Bounded fuzzy fallback: among same-model wire rows within BOTH the span window
 * (outer clamp) and the fuzzy window (± windowMs around the transcript ts), pick
 * the nearest timestamp, breaking ties by the lowest id. Returns null on no
 * candidate / missing basis. Never throws (caller wraps).
 */
function fuzzyMatch(db, transcriptRow, span, opts) {
  const model = transcriptRow && transcriptRow.model;
  if (!model) return null;
  const tMs = transcriptRow.timestamp ? Date.parse(transcriptRow.timestamp) : NaN;
  if (!Number.isFinite(tMs)) return null; // no timestamp basis → cannot fuzzy-match
  const windowMs = opts && opts.fuzzyWindowMs != null ? opts.fuzzyWindowMs : DEFAULT_FUZZY_WINDOW_MS;

  const candidates = db.prepare(FUZZY_CANDIDATES_SQL).all(model);
  let best = null;
  let bestDiff = Infinity;
  for (const c of candidates) {
    const cMs = c.timestamp ? Date.parse(c.timestamp) : NaN;
    if (!Number.isFinite(cMs)) continue;
    if (!withinSpanWindow(cMs, span)) continue; // outer clamp
    const diff = Math.abs(cMs - tMs);
    if (diff > windowMs) continue; // fuzzy window
    // Nearest timestamp wins; tie → lowest id.
    if (diff < bestDiff || (diff === bestDiff && (best === null || c.id < best.id))) {
      best = c;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * Match a transcript row to its authoritative wire row (D-04). Order:
 *   1. request-id probe by `tool_call_id` ALONE (cross-user_hash join);
 *   2. on miss, a bounded fuzzy match by model + timestamp.
 * A `:reason:N` tool_call_id bypasses matching entirely (returns null/null).
 * Never throws — any DB error → a safe `{ method: null, wireRow: null }`.
 *
 * @param {import('better-sqlite3').Database} db handle from openTokenDb
 * @param {object} transcriptRow the adapter-derived row
 * @param {object} [span] the active measurement span (outer window clamp)
 * @param {object} [opts] { fuzzyWindowMs }
 * @returns {{ method: 'request-id'|'fuzzy'|null, wireRow: object|null }}
 */
export function matchWireRow(db, transcriptRow, span = {}, opts = {}) {
  try {
    const tcid = transcriptRow && transcriptRow.tool_call_id;
    // :reason:N rows have no wire counterpart — never match.
    if (isReasonStep(tcid)) return { method: null, wireRow: null };

    // (1) request-id probe by tool_call_id alone (across user_hash).
    if (typeof tcid === 'string' && tcid.length > 0) {
      const wire = probeWireRowByRequestId(db, tcid);
      if (wire) return { method: 'request-id', wireRow: wire };
    }

    // (2) bounded fuzzy fallback (model + timestamp).
    const fuzzy = fuzzyMatch(db, transcriptRow, span, opts);
    if (fuzzy) return { method: 'fuzzy', wireRow: fuzzy };

    return { method: null, wireRow: null };
  } catch (err) {
    process.stderr.write(`[reconcile] match failed (non-fatal): ${err.message}\n`);
    return { method: null, wireRow: null };
  }
}

/**
 * Record every nonzero per-field delta on a matched pair (D-05). Zero-delta
 * fields are omitted. Each entry is `{ wire, transcript, delta, flagged }` where
 * `flagged` is `delta > max(2% of larger, 50)`. Pure — no DB, no throw.
 *
 * @param {object} wireRow the authoritative wire row
 * @param {object} transcriptRow the adapter-derived row
 * @returns {Record<string, {wire:number, transcript:number, delta:number, flagged:boolean}>}
 */
export function computeDeltas(wireRow, transcriptRow) {
  const out = {};
  if (!wireRow || !transcriptRow) return out;
  for (const f of DELTA_FIELDS) {
    const w = num(wireRow[f]);
    const t = num(transcriptRow[f]);
    const delta = Math.abs(w - t);
    if (delta === 0) continue; // record only nonzero deltas
    out[f] = { wire: w, transcript: t, delta, flagged: delta > toleranceFor(w, t) };
  }
  return out;
}

/**
 * Reconcile a single transcript row against the wire (D-04/D-05). On a match:
 * fill-gaps-only enrich (wire wins), record per-field deltas, and flag any delta
 * beyond tolerance. On a miss (or a `:reason:N` bypass): return an unmatched
 * result marked for fallback insertion (Plan 04 inserts with provenance). Never
 * throws (T-83-03-03 / D-06) — any error → a safe fallback result.
 *
 * @param {import('better-sqlite3').Database} db handle from openTokenDb
 * @param {object} transcriptRow the adapter-derived row
 * @param {object} [span] the active measurement span (outer window clamp)
 * @param {object} [opts] { fuzzyWindowMs }
 * @returns {{ method: 'request-id'|'fuzzy'|null, matched: boolean, enriched: boolean,
 *   fallback: boolean, deltas: object, flagged: boolean, alwaysInsert?: boolean }}
 */
export function reconcileRow(db, transcriptRow, span = {}, opts = {}) {
  const base = {
    method: null,
    matched: false,
    enriched: false,
    fallback: false,
    deltas: {},
    flagged: false,
  };
  try {
    const tcid = transcriptRow && transcriptRow.tool_call_id;

    // :reason:N — always-insert (wire never carries a reasoning-step split).
    if (isReasonStep(tcid)) {
      return { ...base, fallback: true, alwaysInsert: true };
    }

    const { method, wireRow } = matchWireRow(db, transcriptRow, span, opts);
    if (!wireRow) {
      return { ...base, fallback: true };
    }

    const deltas = computeDeltas(wireRow, transcriptRow);
    const flagged = Object.values(deltas).some((d) => d.flagged);

    // Fill-gaps-only enrich, keyed on the WIRE row's tool_call_id (fuzzy matches
    // carry no transcript tool_call_id). Wire counts never decrease/overwrite.
    const enriched = reconcileGapFill(db, wireRow.tool_call_id, {
      reasoning_tokens: transcriptRow.reasoning_tokens,
      granularity_tier: transcriptRow.granularity_tier,
      parent_call_id: transcriptRow.parent_call_id,
      cache_read_tokens: transcriptRow.cache_read_tokens,
      cache_write_tokens: transcriptRow.cache_write_tokens,
    });

    return { method, matched: true, enriched, fallback: false, deltas, flagged };
  } catch (err) {
    process.stderr.write(`[reconcile] reconcileRow failed (non-fatal): ${err.message}\n`);
    return { ...base, fallback: true };
  }
}
