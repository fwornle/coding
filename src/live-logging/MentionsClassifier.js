/**
 * MentionsClassifier — Phase 58 Plan 01.
 *
 * Pure-function classifier module (D-02 / D-03) that maps an Insight summary
 * to a closed-set list of entity ids it "mentions". Shared surface used by
 * BOTH the writer-path unification (Plan 02) AND the one-shot backfill script
 * (Plan 03) — single source of truth so the bridge backfill and the one-shot
 * backfill emit identical edges (D-06.2).
 *
 * Public exports:
 *   - loadMentionCandidates(kmStore): Promise<Candidate[]>
 *   - buildMentionsPrompt(insightSummary, candidates): {process,taskType,messages}
 *   - extractMentionsFromLLMResponse(rawText, candidates): string[]   ← ids
 *   - classifyMentions(insightSummary, candidates): Promise<string[]> ← ids
 *   - __resetCacheForTests(): void
 *
 * Internal helpers (not exported but exercised through the public surface):
 *   - resolveProxyUrl()  — RAPID_LLM_PROXY_URL > LLM_CLI_PROXY_URL >
 *                          LLM_PROXY_URL > http://localhost:${LLM_CLI_PROXY_PORT ?? '12435'}
 *   - joinProxyEndpoint(base) — append `/api/complete` exactly once
 *   - callProxy(body)    — POST to the proxy with a 60s AbortSignal timeout
 *
 * Routing convention (CLAUDE.md "km-core LLM proxy endpoint"):
 *   - Default port 12435 — `/api/complete` on rapid-llm-proxy. See CLAUDE.md
 *     for the health-API port landmine (do not mistake one for the other).
 *   - Body shape `{ process, taskType, messages }`; response carries `.content`
 *     (NOT OpenAI-wrapped).
 *   - `taskType: 'mentions-classification'` routes the call to claude-haiku
 *     for cheaper bulk classification.
 *
 * Decisions realized:
 *   - D-02   : one LLM call per Insight, closed-set classifier.
 *   - D-02.1 : reject any name not in the candidate catalog (no fabricated targets).
 *   - D-02.2 : SANITY_CAP = 20 — guard against hallucinated 50-entity responses.
 *   - D-03   : L1+L2+L3 vertical (entityType in {Component, SubComponent, Detail}).
 *   - D-03.1 : NO project filter — cross-project Insights are legitimate.
 *   - D-03.2 : NO Insight / Pattern / File / Process / Container targets.
 *   - D-04.1 : fail-fast — proxy errors propagate; caller decides whether to write.
 *
 * Forensic logging uses `process.stderr.write(...)` — the project's standard
 * out-of-band logger for this module surface (Phase 57-04 SUMMARY locked this
 * convention with `grep -c "console\\.log\\|console\\.error" → 0`). No
 * `console.*` calls anywhere in this module.
 *
 * @module MentionsClassifier
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * D-02.2 sanity cap. The LLM may hallucinate a 50-entity response; we clamp
 * to 20 valid (closed-set-matching) ids. Picked because typical expected
 * count per Insight is 2-5 (D-02.2) — 20 is 4× the upper bound, generous
 * for legitimate cases, tight enough to block edge-spam DoS against the
 * writer path (threat T-58-01-02).
 */
const SANITY_CAP = 20;

/**
 * Proxy request timeout. Mirrors `scripts/backfill-raw-observations.mjs`
 * (host-side proxy client canonical) — claude-haiku typically returns
 * in 1-3s; 60s is the safety ceiling.
 */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * `taskType` field that routes this call to claude-haiku via the
 * processOverrides config (CLAUDE.md rapid-llm-proxy routing).
 */
const TASK_TYPE = 'mentions-classification';

/**
 * `process` label — surfaces in the proxy's request log so operators can
 * grep for consolidator-originated mentions calls.
 */
const PROCESS_LABEL = 'consolidator-mentions';

/**
 * Per-consolidation-run candidate-catalog cache.
 *
 * PATTERNS.md landmine 8: cache per-run, NOT long-lived. New L1/L2/L3
 * entities are emitted by the same consolidator (Phase 57 L2 refinement
 * runs on the L1 emit path), so a long-lived cache goes stale within
 * minutes. Mirrors the per-run `_projectAnchorCache` scope on the
 * consolidator (consolidator.js line 592).
 *
 * Keyed by the kmStore instance (WeakMap so a discarded store doesn't
 * leak); the caller decides the cache lifetime by passing the same
 * store across multiple calls in one consolidation cycle and a fresh
 * store (or calling __resetCacheForTests) when the next cycle begins.
 */
let _candidateCache = new WeakMap();

// ---------------------------------------------------------------------------
// Internal: proxy URL resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the rapid-llm-proxy base URL with the canonical precedence chain
 * documented in CLAUDE.md "km-core LLM proxy endpoint":
 *   RAPID_LLM_PROXY_URL → LLM_CLI_PROXY_URL → LLM_PROXY_URL →
 *   http://localhost:${LLM_CLI_PROXY_PORT ?? '12435'}
 *
 * Default port is **12435** (rapid-llm-proxy `/api/complete`). See CLAUDE.md
 * for the health-API port landmine (do not mistake one for the other; a POST
 * to the wrong port returns HTML and silently masks the bug).
 *
 * @returns {string} base URL with no trailing slash (caller appends path)
 */
function resolveProxyUrl() {
  if (process.env.RAPID_LLM_PROXY_URL) return process.env.RAPID_LLM_PROXY_URL;
  if (process.env.LLM_CLI_PROXY_URL) return process.env.LLM_CLI_PROXY_URL;
  if (process.env.LLM_PROXY_URL) return process.env.LLM_PROXY_URL;
  const port = process.env.LLM_CLI_PROXY_PORT || '12435';
  return `http://localhost:${port}`;
}

/**
 * Append `/api/complete` exactly once. Idempotent on already-suffixed URLs.
 *
 * @param {string} base
 * @returns {string}
 */
function joinProxyEndpoint(base) {
  const trimmed = String(base || '').replace(/\/+$/, '');
  if (trimmed.endsWith('/api/complete')) return trimmed;
  return `${trimmed}/api/complete`;
}

/**
 * POST to the proxy with the canonical body shape.
 *
 * Throws `Error('HTTP <status> <statusText>: <body[:300]>')` on non-2xx.
 * Returns the parsed JSON response (caller extracts `.content`).
 *
 * @param {object} body — { process, taskType, messages }
 * @returns {Promise<object>} parsed JSON response: { content, provider, model, tokens, latencyMs }
 */
async function callProxy(body) {
  const endpoint = joinProxyEndpoint(resolveProxyUrl());
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${text.slice(0, 300)}`);
  }
  return resp.json();
}

// ---------------------------------------------------------------------------
// Internal: regex helper
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe inclusion in a RegExp pattern.
 *
 * Copied verbatim from `integrations/mcp-server-semantic-analysis/src/agents/
 * ontology-classification-agent.ts` line 146 — same Phase 57-04 escape
 * surface so the closed-set regex behaves identically across the two
 * classifier modules.
 *
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Public: loadMentionCandidates
// ---------------------------------------------------------------------------

/**
 * Load the L1+L2+L3 vertical of the live entity graph as a flat candidate
 * catalog. Per D-03 / D-03.1 / D-03.2: `entityType in {Component,
 * SubComponent, Detail}`; NO project filter; NO Insight / Pattern / File
 * / Process / Container targets.
 *
 * Current graph (as of Phase 58 context-gather 2026-06-15): 7 + 326 + 312 =
 * 645 candidates. Fits in ~10K tokens of names+descriptions — well under
 * the claude-haiku context window.
 *
 * Per-run memoization via a `WeakMap<kmStore, candidates[]>` so multiple
 * Insights consolidated in one cycle share one fetch (PATTERNS.md
 * landmine 8). The cache is keyed on the store instance and stays warm
 * for the lifetime of that instance; passing a fresh store (or calling
 * `__resetCacheForTests()`) invalidates it.
 *
 * @param {object} kmStore — anything with `findByOntologyClass(class): Promise<Entity[]>`
 * @returns {Promise<Array<{id: string, name: string, description: string}>>}
 */
export async function loadMentionCandidates(kmStore) {
  if (!kmStore || typeof kmStore.findByOntologyClass !== 'function') {
    throw new Error('[MentionsClassifier] loadMentionCandidates: kmStore.findByOntologyClass missing');
  }

  const cached = _candidateCache.get(kmStore);
  if (cached) return cached;

  // D-03: L1+L2+L3 vertical via the L1 carrier names.
  const [components, subComponents, details] = await Promise.all([
    kmStore.findByOntologyClass('Component'),
    kmStore.findByOntologyClass('SubComponent'),
    kmStore.findByOntologyClass('Detail'),
  ]);

  const flat = [...components, ...subComponents, ...details].map((e) => ({
    id: e.id,
    name: e.name,
    description: deriveDescription(e),
  }));

  _candidateCache.set(kmStore, flat);
  return flat;
}

/**
 * Extract a string description from a km-core Entity, handling the three
 * shapes the codebase emits:
 *   1. `e.description` — legacy / scripted-write surface.
 *   2. `e.descriptionSegments[].text` — segmented provenance (PATTERNS §3).
 *   3. `e.metadata.descriptionSegments[].text` — km-core canonical location
 *      (lib/km-core/src/types/entity.ts line 73).
 *
 * Falls back to '' (NOT undefined) so the catalog rendering never emits
 * 'undefined' strings into the LLM prompt.
 *
 * @param {object} e
 * @returns {string}
 */
function deriveDescription(e) {
  if (!e || typeof e !== 'object') return '';
  if (typeof e.description === 'string' && e.description) return e.description;
  if (Array.isArray(e.descriptionSegments) && e.descriptionSegments.length > 0) {
    return e.descriptionSegments.map((s) => (s && typeof s.text === 'string') ? s.text : '').filter(Boolean).join(' ');
  }
  if (e.metadata && Array.isArray(e.metadata.descriptionSegments) && e.metadata.descriptionSegments.length > 0) {
    return e.metadata.descriptionSegments.map((s) => (s && typeof s.text === 'string') ? s.text : '').filter(Boolean).join(' ');
  }
  return '';
}

// ---------------------------------------------------------------------------
// Public: buildMentionsPrompt
// ---------------------------------------------------------------------------

/**
 * Build the proxy request body. Two-part system message per D-02.1:
 *   (a) ontology hint — frames candidates by layer (Component /
 *       SubComponent / Detail), so the LLM knows the L1+L2+L3 vertical
 *       is the closed set.
 *   (b) candidate catalog — `- ${name}: ${description.slice(0,120)}`
 *       per line, capped to 120 chars of description so the prompt stays
 *       tight.
 *
 * User message carries the Insight summary verbatim. Response shape:
 * JSON array of entity names. The extractor (below) rejects anything
 * not in the closed set.
 *
 * @param {string} insightSummary
 * @param {Array<{id:string,name:string,description:string}>} candidates
 * @returns {{process:string, taskType:string, messages:Array<{role:string,content:string}>}}
 */
export function buildMentionsPrompt(insightSummary, candidates) {
  const safeSummary = typeof insightSummary === 'string' ? insightSummary : String(insightSummary ?? '');
  const list = Array.isArray(candidates) ? candidates : [];

  const catalog = list
    .map((c) => {
      const name = (c && typeof c.name === 'string') ? c.name : '';
      const desc = (c && typeof c.description === 'string') ? c.description : '';
      return `- ${name}: ${desc.slice(0, 120)}`;
    })
    .join('\n');

  return {
    process: PROCESS_LABEL,
    taskType: TASK_TYPE, // 'mentions-classification' — routes to claude-haiku
    messages: [
      {
        role: 'system',
        content:
          'You classify which architectural entities an Insight discusses.\n' +
          'Pick a subset of entities from the catalog below whose subjects are clearly discussed in the Insight summary.\n' +
          'Reply with ONLY a JSON array of entity names, e.g. ["EtmDaemon", "LiveLoggingSystem"]. No prose, no markdown fences.\n' +
          'Reject hallucinated names — only emit names that appear VERBATIM in the catalog below.\n' +
          'Return an empty array [] if no entity in the catalog clearly matches the Insight.\n' +
          'The catalog covers the L1+L2+L3 architectural vertical (entityType in {Component, SubComponent, Detail}).\n\n' +
          'Candidate catalog:\n' +
          catalog,
      },
      {
        role: 'user',
        content: `Insight summary:\n${safeSummary}\n\nReturn the mentions JSON array.`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Public: extractMentionsFromLLMResponse
// ---------------------------------------------------------------------------

/**
 * Parse the LLM's response into a list of ids drawn from the closed
 * candidate set.
 *
 * Two parse paths:
 *   1. JSON-array (preferred) — strip ```json``` fences if present,
 *      `JSON.parse`, accept only `Array<string>`.
 *   2. Fallback token-boundary scan — if JSON parsing fails, scan the
 *      raw text for each candidate name using the verbatim regex from
 *      `extractL2FromLLMResponse` (line 137-143) so 'EtmDaemon' inside
 *      a sentence resolves but 'SuperEtmDaemonX' (hallucinated near-miss)
 *      does not.
 *
 * Closed-set guard (D-02.1, threat T-58-01-01): every parsed name MUST
 * appear in `validNamesById`. Anything else is silently dropped —
 * prompt-injection that asks for ['SomeFakeName'] cannot escape.
 *
 * Sanity cap (D-02.2, threat T-58-01-02): stop accumulating once
 * SANITY_CAP=20 valid ids are collected, even if the LLM offered more.
 *
 * Dedup: a name appearing multiple times in the response yields the
 * id exactly once.
 *
 * @param {string} rawText
 * @param {Array<{id:string,name:string,description?:string}>} candidates
 * @returns {string[]} ids
 */
export function extractMentionsFromLLMResponse(rawText, candidates) {
  const text = typeof rawText === 'string' ? rawText : '';
  const list = Array.isArray(candidates) ? candidates : [];
  const validNamesById = new Map();
  for (const c of list) {
    if (c && typeof c.name === 'string' && typeof c.id === 'string') {
      validNamesById.set(c.name, c.id);
    }
  }

  let parsed;
  try {
    const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    parsed = JSON.parse(json);
  } catch {
    // Fallback: token-boundary scan against each candidate name.
    const found = new Set();
    for (const name of validNamesById.keys()) {
      const re = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegex(name)}([^A-Za-z0-9_]|$)`);
      if (re.test(text)) found.add(name);
    }
    parsed = [...found];
  }

  if (!Array.isArray(parsed)) return [];

  const seenIds = new Set();
  const validIds = [];
  for (const name of parsed) {
    if (typeof name !== 'string') continue;
    const id = validNamesById.get(name);
    if (!id) continue; // D-02.1 hallucination guard
    if (seenIds.has(id)) continue; // dedup
    seenIds.add(id);
    validIds.push(id);
    if (validIds.length >= SANITY_CAP) break; // D-02.2 cap
  }
  return validIds;
}

// ---------------------------------------------------------------------------
// Public: classifyMentions (orchestrator)
// ---------------------------------------------------------------------------

/**
 * Tie build + call + extract together. The single entry point that Plan 02
 * (writer-path) and Plan 03 (backfill) both import.
 *
 * Per D-04.1 fail-fast: if `callProxy` throws, this function logs a one-line
 * forensic line via `process.stderr.write` and rethrows. The CALLER decides
 * whether to write the Insight. This is intentional — the alternative
 * (write-then-edge-then-flip-pending) re-introduces the orphan-bleed window
 * that Phase 58 is closing.
 *
 * @param {string} insightSummary
 * @param {Array<{id:string,name:string,description:string}>} candidates
 * @returns {Promise<string[]>} ids (possibly empty, possibly up to SANITY_CAP)
 */
export async function classifyMentions(insightSummary, candidates) {
  const body = buildMentionsPrompt(insightSummary, candidates);
  let response;
  try {
    response = await callProxy(body);
  } catch (err) {
    process.stderr.write(`[MentionsClassifier] proxy call failed: ${err.message}\n`);
    throw err;
  }
  const content = (response && typeof response.content === 'string') ? response.content : '';
  return extractMentionsFromLLMResponse(content, candidates);
}

// ---------------------------------------------------------------------------
// Test hook
// ---------------------------------------------------------------------------

/**
 * Clear the per-store candidate cache. Test-only — invoked from
 * `MentionsClassifier.test.js` between tests so the WeakMap-spy
 * counter assertion (Test 8) is reliable.
 */
export function __resetCacheForTests() {
  // WeakMap is not iterable by spec — we cannot enumerate keys to delete.
  // Swap the reference for a fresh WeakMap so subsequent loadMentionCandidates
  // calls miss the cache and re-invoke kmStore.findByOntologyClass.
  _candidateCache = new WeakMap();
}
