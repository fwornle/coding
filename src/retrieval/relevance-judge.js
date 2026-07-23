/**
 * LLM relevance judge for knowledge injection.
 *
 * The cheap hybrid retrieval (vector + FTS5 + recency + IDF-weighted overlap) is good at RECALL
 * but weak at PRECISION: a task goal saturated with generic coding vocabulary ("create a file …
 * that returns …") keyword-matches unrelated insights ("… Root Cause …"). Fixed keyword lists
 * (the retired EXPERIMENT_META_RE) are brittle. This module asks a cheap LLM which candidates are
 * GENUINELY useful specialist know-how for the task, replacing the heuristic's precision layer and
 * generalizing to any task/benchmark.
 *
 * Contract (matches scripts/backfill-raw-observations.mjs): POST {proxy}/api/complete with
 * { process, taskType, messages }, response { content, ... }. taskType routes to a cheap model.
 *
 * FAIL-OPEN by construction: any error / timeout / unparseable response returns the input
 * candidates UNCHANGED, so a proxy outage degrades injection to the heuristic set — never to empty,
 * never blocking. Results are cached per (query, candidate-id-set) with a TTL so repeated prompts
 * and re-runs skip the call.
 *
 * @module relevance-judge
 */

import { createHash } from 'node:crypto';

/** Proxy URL precedence (CLAUDE.md convention). obs-api runs on the host → localhost. */
function proxyUrl() {
  return (
    process.env.RAPID_LLM_PROXY_URL ||
    process.env.LLM_CLI_PROXY_URL ||
    process.env.LLM_PROXY_URL ||
    `http://localhost:${process.env.LLM_CLI_PROXY_PORT || '12435'}`
  ).replace(/\/$/, '');
}

// Measured: a batched haiku judge via the proxy is ~2.5s, so 1500ms silently timed out into
// fail-open (kept everything). 3500ms lets it complete while staying under the retrieval-client
// (4500ms) and the hooks' 5000ms SAFETY_TIMEOUT. Still fails open if the proxy is slower.
const DEFAULT_TIMEOUT_MS = 3500;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min
const CACHE_MAX = 500;
const MAX_CANDIDATES = 12; // batch ceiling — the caller should pass its top-K

/** Module-level cache (the RetrievalService is a singleton in obs-api). key → { ts, ids:Set<string> }. */
const _cache = new Map();

function cacheKey(query, ids) {
  return createHash('sha256').update(`${query}|${[...ids].sort().join(',')}`).digest('hex');
}

function titleOf(payload) {
  const p = payload || {};
  return p.topic || p.theme || p.entityType || '(untitled)';
}

function buildMessages(query, candidates) {
  const list = candidates
    .map((c) => {
      const p = c.payload || {};
      const snippet = String(p.summary_preview || '').replace(/\s+/g, ' ').slice(0, 240);
      return `- id: ${c.id}\n  title: ${titleOf(p)}\n  snippet: ${snippet}`;
    })
    .join('\n');

  const system =
    'You decide which knowledge-base items are GENUINELY useful specialist know-how for accomplishing ' +
    'a developer task. Be strict. EXCLUDE an item when it merely shares generic words with the task, ' +
    'is about an unrelated subsystem/component, is an episodic log of past activity, or documents the ' +
    'task/benchmark itself rather than HOW to accomplish it. Prefer returning nothing over returning ' +
    'loosely-related items. Respond with ONLY a JSON object: {"useful": ["<id>", ...]} listing the ids ' +
    'to KEEP (empty array if none). No prose, no code fences.';

  const user =
    `Task:\n${query}\n\nCandidates:\n${list}\n\n` +
    'Return {"useful":[ids]} — keep only items that genuinely help accomplish the task.';

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** Parse {"useful":[...]} out of the model content; intersect with the real candidate ids. */
function parseUseful(content, validIds) {
  if (!content || typeof content !== 'string') return null;
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj;
  try {
    obj = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!obj || !Array.isArray(obj.useful)) return null;
  return new Set(obj.useful.map(String).filter((id) => validIds.has(id)));
}

/**
 * Keep only the candidates the judge deems genuinely useful for the query.
 *
 * FAIL-OPEN: returns the input `candidates` unchanged on empty input, missing query, cache miss +
 * any proxy error/timeout, or an unparseable response. Judges at most MAX_CANDIDATES (pass a
 * pre-sorted top-K). Never throws.
 *
 * @param {string} query the task/goal text
 * @param {Array<{id:string,payload?:object}>} candidates sorted, already floored/gated
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {(msg:string)=>void} [opts.log]
 * @param {typeof fetch} [opts.fetchImpl] injectable for tests
 * @returns {Promise<Array>} the kept subset (or all, fail-open)
 */
export async function judgeRelevance(query, candidates, opts = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, log, fetchImpl = fetch, failClosed = false } = opts;
  if (!query || !Array.isArray(candidates) || candidates.length === 0) return candidates;
  // On failure the caller chooses the safe direction: interactive fails OPEN (keep the IDF-ranked
  // set — useful degradation), experiment cells fail CLOSED (inject nothing — "judge-confirmed or
  // nothing", never fall open to noise when the proxy is slow/down).
  const onFailure = () => (failClosed ? [] : candidates);

  const pool = candidates.slice(0, MAX_CANDIDATES);
  const validIds = new Set(pool.map((c) => String(c.id)));
  const key = cacheKey(query, validIds);
  const now = Date.now();

  const hit = _cache.get(key);
  if (hit && now - hit.ts < CACHE_TTL_MS) {
    return candidates.filter((c) => hit.ids.has(String(c.id)));
  }

  let keptIds;
  try {
    const body = {
      process: 'kb-relevance-judge',
      taskType: 'dedup', // routes to a cheap model (haiku) per the proxy processOverrides convention
      messages: buildMessages(query, pool),
    };
    const resp = await fetchImpl(`${proxyUrl()}/api/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    keptIds = parseUseful(data && data.content, validIds);
    if (!keptIds) throw new Error('unparseable judge response');
  } catch (err) {
    const fb = onFailure();
    log?.(`[relevance-judge] ${failClosed ? 'fail-closed (0 kept)' : `fail-open (${fb.length} kept)`}: ${err.message}\n`);
    return fb; // interactive: degrade to heuristic set; experiment: inject nothing
  }

  // Bounded cache (drop oldest on overflow).
  if (_cache.size >= CACHE_MAX) {
    const oldest = _cache.keys().next().value;
    if (oldest !== undefined) _cache.delete(oldest);
  }
  _cache.set(key, { ts: now, ids: keptIds });

  return candidates.filter((c) => keptIds.has(String(c.id)));
}

/** Test-only: clear the module cache. */
export function _clearJudgeCache() {
  _cache.clear();
}
