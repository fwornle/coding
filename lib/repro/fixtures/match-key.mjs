// lib/repro/fixtures/match-key.mjs
//
// Phase 67, Plan 67-01 (Wave 1) — D-07 match key: the SINGLE hash implementation
// shared by the record tap, the replay tap (Plan 06), and the integration flow
// (Plan 07). Recording and replay must never disagree on the key for the same
// logical request, so all three consumers import from here.
//
// normalizeReq(body):  strip volatile fields (task_id, subscription, request/
//   trace id, provider-selection hints) and canonicalize the model alias so two
//   requests that differ only in routing/id metadata collapse to the same hash.
//   Every content-affecting param is preserved (allow-by-default; deny-list only
//   the known-volatile keys).
// matchKey(normalized): sha256(stableStringify(normalized)) combined with a
//   per-hash call ordinal → "<sha256>#<ordinal>", so identical repeated calls
//   (retries) replay in recorded order (D-07).
// resetOrdinals(): clear the ordinal counters (called at span open and in tests).
//
// Hashing idiom mirrors scripts/measurement-stop.mjs:364-365
// (crypto.createHash('sha256')…digest('hex')).
import crypto from 'node:crypto';

// Volatile / provider-selection fields that must NOT affect the match key.
// A request differing only in one of these describes the SAME logical call.
const VOLATILE_KEYS = new Set([
  'task_id', 'taskId',
  'subscription',
  'request_id', 'requestId',
  'trace_id', 'traceId',
  'id',
  'provider', 'providers', 'provider_hint', 'providerHint',
  'process', // routing/provider-selection hint, not request content
  'timestamp', 'ts',
]);

// Module-level per-hash ordinal counter (D-07). Distinct requests each keep an
// independent counter; identical repeats increment.
const _ordinals = new Map();

/**
 * Canonicalize a model name so aliases / casing / whitespace collapse to one
 * form (mirrors the proxy's canonicalizeModelName intent — record & replay must
 * agree on the canonical name).
 * @param {unknown} model
 * @returns {string|undefined}
 */
function canonicalizeModelName(model) {
  if (typeof model !== 'string') return model === undefined ? undefined : model;
  return model.trim().toLowerCase();
}

/**
 * Produce a stable normalized request object: volatile fields dropped, model
 * canonicalized, every other (content-affecting) field preserved verbatim.
 * @param {Record<string, unknown>} body
 * @returns {Record<string, unknown>}
 */
export function normalizeReq(body) {
  const src = (body && typeof body === 'object') ? body : {};
  const out = {};
  for (const key of Object.keys(src)) {
    if (VOLATILE_KEYS.has(key)) continue;
    out[key] = src[key];
  }
  if ('model' in out) out.model = canonicalizeModelName(out.model);
  return out;
}

/**
 * Deterministic JSON serialization: object keys sorted recursively, array order
 * preserved. Guarantees the same hash regardless of input key ordering.
 * @param {unknown} value
 * @returns {string}
 */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`);
  return `{${parts.join(',')}}`;
}

/**
 * Compute the composite match key for a normalized request:
 * "<sha256-hex>#<ordinal>". The sha256 base is stable and volatile-field-robust;
 * the ordinal disambiguates identical repeated calls in recorded order (D-07).
 * Side effect: increments the per-hash ordinal counter.
 * @param {Record<string, unknown>} normalized  Output of normalizeReq.
 * @returns {string}
 */
export function matchKey(normalized) {
  const hash = crypto.createHash('sha256').update(stableStringify(normalized)).digest('hex');
  const ordinal = _ordinals.get(hash) ?? 0;
  _ordinals.set(hash, ordinal + 1);
  return `${hash}#${ordinal}`;
}

/**
 * Clear all per-hash ordinal counters. Call at span open (record start) and on
 * the replay side before reconstructing the key sequence, and in tests.
 * @returns {void}
 */
export function resetOrdinals() {
  _ordinals.clear();
}
