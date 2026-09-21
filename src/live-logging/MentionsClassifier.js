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
 * Global pacing gate for mentions-classify proxy calls.
 *
 * Consolidation mirrors insights to the KG in a sequential loop, so mentions
 * calls arrive as a steady back-to-back stream. Off-corp that stream saturates
 * the Claude Max-OAuth *haiku* per-model rate limit: each 429'd call is pushed
 * onto the slow CLI fallback (14-20s), and a single slow call eats the
 * consolidator's 15s KG-push budget — so the same insights fail every cycle.
 *
 * The gate serializes callProxy invocations and spaces consecutive calls at
 * least MENTIONS_MIN_INTERVAL_MS apart, keeping the endpoint under its limit so
 * calls stay on the fast direct-OAuth HTTP path. Env-tunable; 0 disables (unit
 * tests set it to 0 to avoid artificial delay).
 */
// Read dynamically (not cached at load) so tests can set the env to 0 to disable
// pacing without a fixed module-load ordering constraint. Default 1000ms.
function _minIntervalMs() {
  const v = Number(process.env.MENTIONS_MIN_INTERVAL_MS);
  return Number.isFinite(v) && v >= 0 ? v : 1000;
}
let _pace = Promise.resolve();
let _lastCallStartedAt = 0;

/**
 * Run `fn` behind the pacing gate: wait for the prior gated call to finish, then
 * for the remaining min-interval since the last call started, then invoke `fn`.
 * The chain advances regardless of `fn`'s outcome, but the result/rejection is
 * propagated to THIS caller. Reset for tests via __resetPaceForTests.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function _paced(fn) {
  const run = _pace.then(async () => {
    const interval = _minIntervalMs();
    if (interval > 0) {
      const wait = _lastCallStartedAt + interval - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    _lastCallStartedAt = Date.now();
    return fn();
  });
  // Advance the chain on both fulfilment and rejection so one failure can't wedge
  // the gate; swallow here (the real outcome is returned to the caller via `run`).
  _pace = run.then(() => undefined, () => undefined);
  return run;
}

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
  // Pace through the global gate so a batch of mentions calls doesn't saturate
  // the OAuth-haiku rate limit (see MENTIONS_MIN_INTERVAL_MS).
  return _paced(async () => {
    const payload = JSON.stringify(body);
    let resp;
    try {
      resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // undici collapses every socket-level failure into the bare message
      // "fetch failed" and hides the real reason on err.cause. Callers log
      // err.message only, so 105 consecutive failures in obs-api.log all read
      // "fetch failed" with nothing to act on. Re-throw with the cause chain,
      // the endpoint and the payload size folded into the message.
      const cause = err?.cause;
      const detail = cause
        ? `${cause.code || cause.name || 'cause'}: ${cause.message || String(cause)}`
        : (err?.name || 'unknown');
      const e = new Error(
        `${err.message} — ${detail} (endpoint=${endpoint}, `
        + `payload=${Math.round(payload.length / 1024)}KB, timeout=${REQUEST_TIMEOUT_MS}ms)`
      );
      e.cause = err;
      throw e;
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${text.slice(0, 300)}`);
    }
    return resp.json();
  });
}

// ---------------------------------------------------------------------------
// Internal: regex helper
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe inclusion in a RegExp pattern.
 *
 * Copied verbatim from `integrations/semantic-analysis/src/agents/
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

  // `findByOntologyClass` is an OR-gate by design (matches when
  // `entityType === cls` OR `ontologyClass === cls`) for BC with the
  // Phase 37/38 era when class fields drifted. Production data has 74
  // Insights / 16 Processes / 11 Containers / 15 Observations whose
  // `entityType` is non-architectural but whose `ontologyClass` got
  // stamped as 'Detail', so the OR-gate pulls them into the 'Detail'
  // bucket. Enforce the D-03 contract — strict entityType — so the
  // candidate set stays at the documented "L1+L2+L3 vertical only" and
  // mention edges cannot target Insights / Processes / Containers /
  // Observations even when the LLM picks a drift-y name.
  const STRICT_TYPES = new Set(['Component', 'SubComponent', 'Detail']);
  const flat = [...components, ...subComponents, ...details]
    .filter((e) => STRICT_TYPES.has(e.entityType))
    .map((e) => ({
      id: e.id,
      name: e.name,
      description: deriveDescription(e),
      // The prompt needs this to ask the primary-subject question properly:
      // only a Component or SubComponent can HOLD an insight. A Detail is a
      // leaf and a sibling of one.
      entityType: e.entityType,
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
 * Hard ceiling on catalog entries per request. 400 x (name + 120 chars of
 * description) lands around 40KB — comfortably under the size that produced
 * ECONNRESET at 103KB, with headroom for the summary itself.
 */
const MAX_CANDIDATES = Number(process.env.MENTIONS_MAX_CANDIDATES) > 0
  ? Number(process.env.MENTIONS_MAX_CANDIDATES)
  : 400;

/** Per-candidate description budget (chars). */
const DESC_BUDGET = 120;

/** Tokens too generic to signal a real mention. */
const RANK_STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'this', 'that', 'system',
  'service', 'config', 'file', 'data', 'code', 'coding', 'project', 'pipeline',
]);

function rankTokens(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4 && !RANK_STOP.has(t))
  );
}

/**
 * Order candidates by how plausibly the summary mentions them, best first.
 *
 * Score = number of distinct name tokens that appear in the summary, with a
 * smaller weight for description tokens (a description match is weak evidence
 * — many entities share vocabulary). Stable: equal scores keep catalog order,
 * so a given (summary, catalog) always yields the same prompt.
 *
 * @param {string} summary
 * @param {Array<{name:string, description:string}>} candidates
 * @returns {Array<object>} same objects, reordered
 */
export function rankCandidatesByRelevance(summary, candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const hay = rankTokens(summary);
  if (hay.size === 0) return [...list];
  return list
    .map((c, i) => {
      let score = 0;
      for (const t of rankTokens(c && c.name)) if (hay.has(t)) score += 10;
      for (const t of rankTokens(c && c.description)) if (hay.has(t)) score += 1;
      return { c, i, score };
    })
    .sort((a, b) => (b.score - a.score) || (a.i - b.i))
    .map((x) => x.c);
}

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

  // Relevance-ranked cap. The catalog is UNBOUNDED by construction — it is the
  // whole L1+L2+L3 vertical, and the docblock above still says "645
  // candidates ... ~10K tokens" from Phase 58. The graph has since grown to
  // 19 Components + 315 SubComponents + 707 Details = 1041, which renders a
  // ~103KB body that the proxy drops mid-flight:
  //
  //   mentions classify failed: fetch failed — ECONNRESET: read ECONNRESET
  //     (endpoint=.../api/complete, payload=103KB, timeout=60000ms)
  //
  // Because _pushInsightToKG fail-fasts on a classifier error, the Insight is
  // never written, its digest stays uncovered, and the next consolidation
  // re-synthesizes it — 105 failures across 45 insights, forever.
  //
  // A blind head(N) would drop candidates arbitrarily. Rank by lexical overlap
  // with the summary first: a genuine mention nearly always shares a token
  // with the entity name, so the entities actually worth picking survive the
  // cut and only implausible ones are dropped. Ties keep catalog order, so the
  // selection is deterministic for a given (summary, catalog).
  const ranked = rankCandidatesByRelevance(safeSummary, list);
  const kept = ranked.slice(0, MAX_CANDIDATES);
  if (ranked.length > kept.length) {
    process.stderr.write(
      `[MentionsClassifier] candidate catalog capped: ${ranked.length} -> ${kept.length} `
      + `(MAX_CANDIDATES=${MAX_CANDIDATES}); dropped the lowest-relevance entries\n`
    );
  }

  const catalog = kept
    .map((c) => {
      const name = (c && typeof c.name === 'string') ? c.name : '';
      const desc = (c && typeof c.description === 'string') ? c.description : '';
      const cls = (c && typeof c.entityType === 'string') ? c.entityType : 'Detail';
      return `- ${name} [${cls}]: ${desc.slice(0, DESC_BUDGET)}`;
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
          'Then name the ONE entity that should OWN this Insight in the architecture hierarchy — the\n' +
          'subsystem it is mainly about, not merely something mentioned alongside.\n' +
          '"primary" MUST be an entry marked [Component] or [SubComponent]. Entries marked [Detail] are\n' +
          'leaves and can never own an Insight — if the Insight is mostly about a [Detail], name the\n' +
          '[SubComponent] or [Component] that the Detail belongs to instead.\n' +
          'Prefer the most specific owner that still covers the whole Insight. Return null rather than\n' +
          'guessing when no listed [Component] or [SubComponent] genuinely owns it.\n' +
          '"primary" does NOT have to appear in "mentions".\n' +
          'Reply with ONLY a JSON object, no prose and no markdown fences, shaped exactly:\n' +
          '  {"mentions": ["EtmDaemon", "LiveLoggingSystem"], "primary": "LiveLoggingSystem"}\n' +
          'Reject hallucinated names — only emit names that appear VERBATIM in the catalog below.\n' +
          'Return {"mentions": [], "primary": null} if no entity in the catalog clearly matches the Insight.\n' +
          'The catalog covers the L1+L2+L3 architectural vertical (entityType in {Component, SubComponent, Detail}).\n\n' +
          'Candidate catalog:\n' +
          catalog,
      },
      {
        role: 'user',
        content: `Insight summary:\n${safeSummary}\n\nReturn the mentions JSON object.`,
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
 * @returns {Promise<{ids: string[], primaryId: string|null}>} ids (possibly
 *   empty, possibly up to SANITY_CAP) plus the single entity the insight is
 *   primarily about, or null when the model declines to pick one.
 */
/**
 * Extract both answers from one classifier response.
 *
 * Accepts TWO response shapes on purpose:
 *   {"mentions": [...], "primary": "Name"|null}   the shape the prompt asks for
 *   ["Name", ...]                                  the shape it asked for before
 *
 * The bare array is not legacy tolerance for its own sake — an LLM drops back
 * to it under load or after a prompt regression, and when it does, the correct
 * behaviour is to keep the mentions and lose only the primary. Treating that as
 * a parse failure would discard a usable classification and, via the caller's
 * fail-fast, refuse to write the Insight at all.
 *
 * `primary` is held to the same closed set as the mentions and must be one of
 * them; anything else (a hallucinated name, an entity it did not list) becomes
 * null and the caller falls back to its own rule.
 *
 * @param {string} rawText
 * @param {Array<{id:string,name:string,description:string}>} candidates
 * @returns {{ids: string[], primaryId: string|null}}
 */
export function extractMentionsResult(rawText, candidates) {
  const text = typeof rawText === 'string' ? rawText : '';
  const list = Array.isArray(candidates) ? candidates : [];

  let primaryName = null;
  let mentionsText = text;

  const stripped = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  if (stripped.startsWith('{')) {
    try {
      const obj = JSON.parse(stripped);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        if (Array.isArray(obj.mentions)) mentionsText = JSON.stringify(obj.mentions);
        if (typeof obj.primary === 'string') primaryName = obj.primary;
      }
    } catch {
      // Fall through: the array extractor's token scan still salvages names
      // from a truncated or malformed object.
    }
  }

  // One closed-set gate for both answers — the existing extractor already
  // rejects anything not in the catalog, so reuse it rather than re-deriving
  // the rule and letting the two drift.
  const ids = extractMentionsFromLLMResponse(mentionsText, list);

  let primaryId = null;
  if (primaryName) {
    // Closed-set membership is the hallucination guard. Requiring the primary
    // to ALSO appear in `mentions` was measured and rejected nothing (0 of 20
    // probed), while ruling out the legitimate answer where an insight names
    // only Details and is owned by the SubComponent above them.
    const hit = list.find((c) => c && c.name === primaryName);
    if (hit) primaryId = hit.id;
  }

  return { ids, primaryId };
}

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
  return extractMentionsResult(content, candidates);
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

/**
 * Reset the global pacing gate. Test-only — clears the serialization chain and
 * the last-call timestamp so a test's timing assertions start from a clean slate.
 */
export function __resetPaceForTests() {
  _pace = Promise.resolve();
  _lastCallStartedAt = 0;
}
