// lib/repro/fixtures/llm-replay.mjs
//
// Phase 67, Plan 67-01 (Wave 1) — D-06 replay lookup. The replay tap in the
// proxy (Plan 06) calls replayLookup once per incoming /api/complete request,
// keyed by the D-07 match key. On a HIT it returns the recorded response object
// (which the caller re-serves as the 200 body). On a MISS it returns null — the
// D-06 hard-fail signal that the proxy turns into a 409 REPLAY_MISS.
//
// CRITICAL (D-06 / comparability guarantee): this module NEVER falls through to
// a live response and NEVER synthesizes one. A miss is null, full stop. The
// hard-fail is enforced by the proxy caller; here we only distinguish hit/miss.
//
// The key producer lives in match-key.mjs — imported here so record and replay
// share ONE hash implementation.
import fs from 'node:fs';
import path from 'node:path';

// Re-export the shared key producers so callers can import the whole replay
// surface from one module (single hash implementation, D-07).
export { matchKey, normalizeReq, resetOrdinals } from './match-key.mjs';

/**
 * Map a composite match key ("<sha256>#<ordinal>") to its fixture filename.
 * MUST match llm-record.mjs::keyToFilename exactly so record and replay resolve
 * to the same path.
 * @param {string} key
 * @returns {string}
 */
function keyToFilename(key) {
  return `${String(key).replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
}

/**
 * Look up a recorded LLM response by its D-07 match key under
 * `<fixturesDir>/llm/`. Returns the parsed response object on a hit, or null on
 * a miss (missing file, unreadable, or unparseable). NEVER returns a live or
 * synthesized response — a miss is always null (D-06 hard-fail signal).
 * @param {string} fixturesDir  The span/snapshot fixtures root.
 * @param {string} key          The D-07 composite match key.
 * @returns {Record<string, unknown>|null}
 */
export function replayLookup(fixturesDir, key) {
  try {
    const file = path.join(fixturesDir, 'llm', keyToFilename(key));
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : null;
  } catch {
    // Miss (ENOENT / unreadable / unparseable) → null hard-fail signal (D-06).
    return null;
  }
}
