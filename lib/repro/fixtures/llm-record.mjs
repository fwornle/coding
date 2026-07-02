// lib/repro/fixtures/llm-record.mjs
//
// Phase 67, Plan 67-01 (Wave 1) — D-07 fixture recorder. The record tap in the
// proxy (Plan 06) calls recordFixture once per served LLM response, keyed by the
// D-07 match key. This is BEST-EFFORT: mirroring the proxy's `if (_tokenDb)
// logTokenCall(...)` contract (server.mjs:1861-1863), a fixture write must NEVER
// fail or slow the underlying LLM call. All I/O is wrapped in try/catch and
// returns silently on failure.
//
// The stored fixture carries exactly the proxy response contract
// { content, provider, model, tokens, latencyMs } (+ optional overheadMs) so the
// replay tap can re-serve it byte-identically.
//
// The key producer lives in match-key.mjs — imported here so record and replay
// share ONE hash implementation.
import fs from 'node:fs';
import path from 'node:path';

// Re-export the shared key producers so callers can import the whole record
// surface from one module if they wish (single hash implementation, D-07).
export { matchKey, normalizeReq, resetOrdinals } from './match-key.mjs';

/**
 * Map a composite match key ("<sha256>#<ordinal>") to a safe fixture filename.
 * The same mapping is applied on the replay side (llm-replay.mjs) so record and
 * replay always resolve to the same path.
 * @param {string} key
 * @returns {string}
 */
function keyToFilename(key) {
  return `${String(key).replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
}

/**
 * Best-effort append/write of a recorded LLM response, keyed by the D-07 match
 * key, under `<fixturesDir>/llm/`. Never throws — a write failure is swallowed
 * so it can never break the real LLM call (best-effort contract).
 * @param {string} fixturesDir  The span/snapshot fixtures root.
 * @param {string} key          The D-07 composite match key.
 * @param {Record<string, unknown>} resp  The proxy response object.
 * @returns {void}
 */
export function recordFixture(fixturesDir, key, resp) {
  try {
    const r = (resp && typeof resp === 'object') ? resp : {};
    const record = {
      content: r.content,
      provider: r.provider,
      model: r.model,
      tokens: r.tokens,
      latencyMs: r.latencyMs,
      ...(typeof r.overheadMs === 'number' ? { overheadMs: r.overheadMs } : {}),
    };
    const dir = path.join(fixturesDir, 'llm');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, keyToFilename(key)), JSON.stringify(record), 'utf8');
  } catch {
    // Best-effort: a fixture write must never break or slow the LLM call.
  }
}
