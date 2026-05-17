/**
 * RetrievalService -- orchestrator combining embed, search, fuse, and assemble.
 *
 * Combines semantic vector search (Qdrant), keyword search (SQLite FTS5/LIKE),
 * and recency scoring via Reciprocal Rank Fusion with tier-weighted multipliers,
 * then assembles token-budgeted markdown output.
 *
 * Usage:
 *   const svc = getRetrievalService({ dbGetter: () => db });
 *   await svc.initialize();
 *   const { markdown, meta } = await svc.retrieve("Docker build timeout");
 *
 * @module retrieval-service
 */

import { getEmbeddingService } from '../../dist/embedding/embedding-service.js';
import { getQdrantClient } from '../../dist/embedding/qdrant-collections.js';
import { KeywordSearch } from './keyword-search.js';
import { rrfFuse, buildRecencyList, TIER_WEIGHTS, loadAgentProfiles } from './rrf-fusion.js';
import { assembleBudgetedMarkdown } from './token-budget.js';
import { buildWorkingMemory } from './working-memory.js';

/** Qdrant collection names matching embedding-config.json. */
const COLLECTIONS = ['insights', 'digests', 'kg_entities', 'observations'];

/**
 * Orchestrates hybrid retrieval: embed query, parallel semantic + keyword search,
 * RRF fusion, and token-budgeted markdown assembly.
 */
export class RetrievalService {
  /**
   * @param {object} options
   * @param {number} [options.scoreThreshold=0.82] - Minimum Qdrant similarity score (D-04)
   * @param {number} [options.defaultBudget=1000] - Default token budget (D-08)
   * @param {function} [options.dbGetter] - Function returning a better-sqlite3 db instance
   */
  constructor(options = {}) {
    // Default 0.70 (was 0.82). MiniLM-L6-v2 cosine similarities cluster
    // 0.75-0.82 for same-project docs (see _applyTopicRelevance commentary),
    // so a 0.82 floor filtered out almost every legitimate match in practice
    // — Qdrant returned 0 insights for typical queries and the consumer fell
    // back to a noisy keyword-only mix. Lowering the floor lets semantic
    // results in; the topic-relevance pass does the actual ranking.
    this.scoreThreshold = options.scoreThreshold ?? 0.70;
    this.defaultBudget = options.defaultBudget ?? 1000;
    this.embeddingService = null;
    this.qdrantClient = null;
    this.keywordSearch = new KeywordSearch();
    this.dbGetter = options.dbGetter ?? null;
    this.codingRoot = options.codingRoot
      || process.env.CODING_REPO
      || new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
    this._initialized = false;
    this._initPromise = null;
  }

  /**
   * Initialize the service: warm fastembed model and connect to Qdrant.
   * Safe to call multiple times (guard pattern from embedding-service.ts).
   */
  async initialize() {
    if (this._initialized) return;
    if (this._initPromise) {
      await this._initPromise;
      return;
    }

    this._initPromise = (async () => {
      try {
        this.embeddingService = getEmbeddingService();
        await this.embeddingService.initialize(); // warm fastembed model (Pitfall 1)
        this.qdrantClient = getQdrantClient();
        this._initialized = true;
        process.stderr.write('[RetrievalService] Initialized (fastembed warm, Qdrant connected)\n');
      } catch (err) {
        // Reset so next call retries instead of re-awaiting the rejected promise
        this._initPromise = null;
        process.stderr.write(`[RetrievalService] Initialization failed: ${err.message}\n`);
        throw err;
      }
    })();

    await this._initPromise;
  }

  /**
   * Execute a hybrid retrieval query.
   *
   * Steps:
   * 1. Embed query via fastembed (~20ms warm)
   * 2. Parallel semantic search (Qdrant) + keyword search (SQLite)
   * 3. Build recency list from combined results
   * 4. RRF fusion with tier weights
   * 5. Token-budgeted markdown assembly
   *
   * @param {string} query - Search query text
   * @param {object} [options]
   * @param {number} [options.budget] - Token budget (default from constructor)
   * @param {number} [options.threshold] - Qdrant score threshold (default from constructor)
   * @returns {Promise<{ markdown: string, meta: { query: string, budget: number, results_count: number, latency_ms: number } }>}
   */
  async retrieve(query, options = {}) {
    const { budget = this.defaultBudget, threshold = this.scoreThreshold, context = null } = options;

    // Ensure initialized
    if (!this._initialized) {
      await this.initialize();
    }

    // Step 0: Build working memory (fail-open, per D-03)
    const wm = await buildWorkingMemory(this.codingRoot);
    const semanticBudget = Math.min(budget - wm.tokens, 700);
    // Ensure at least 100 tokens for semantic results even if WM overshoots
    const effectiveSemanticBudget = Math.max(semanticBudget, 100);

    // Step 1: Embed query
    const vector = await this.embeddingService.embedOne(query);

    // Step 2: Parallel semantic + keyword search
    const [semanticResults, keywordHits] = await Promise.all([
      this._semanticSearch(vector, 20, threshold),
      this._keywordSearch(query),
    ]);

    // Step 3: Build recency list from combined unique results
    const recencyResults = buildRecencyList([...semanticResults, ...keywordHits]);

    // Step 4: RRF fusion (with optional per-agent profile multipliers, D-04)
    let agentProfile = null;
    if (context?.agent) {
      const profiles = loadAgentProfiles();
      agentProfile = profiles[context.agent] || null;
    }
    const fused = rrfFuse([semanticResults, keywordHits, recencyResults], 60, agentProfile);

    // Step 4.5: Context-aware relevance boosting (D-09)
    if (context) {
      this._applyContextBoost(fused, context);
    }

    // Step 4.6: Topic-relevance demotion — penalize results whose topic/theme
    // doesn't overlap with query keywords. MiniLM-L6-v2 cosine similarities
    // cluster at 0.75-0.82 for single-project docs, so vector similarity alone
    // cannot discriminate topics. This step uses keyword overlap as a proxy.
    this._applyTopicRelevance(fused, query);

    // Step 4.7: Freshness rerank — demote insights whose backticked code
    // claims no longer exist on disk. The verifier (ObservationConsolidator.
    // verifyInsights) writes metadata.codeVerification.verificationRatio for
    // every insight on a 7-day cadence. We multiply rrfScore by
    // 0.3 + 0.7 * ratio so a 1.0-ratio insight is unaffected, a 0.5-ratio
    // insight gets ~0.65×, and a 0.0-ratio insight is heavily demoted (0.3×)
    // without being filtered out entirely. Only applies to the `insights`
    // tier; digests/kg_entities/observations don't have a verification field.
    this._applyFreshnessRerank(fused);

    fused.sort((a, b) => b.rrfScore - a.rrfScore);

    // Step 5: Token-budgeted markdown assembly (semantic budget after WM)
    const { markdown, tokensUsed } = assembleBudgetedMarkdown(fused, effectiveSemanticBudget);

    // Combine: working memory prefix + semantic results
    const finalMarkdown = wm.markdown ? wm.markdown + '\n\n' + markdown : markdown;

    // Return D-06 response shape (latency_ms set by caller)
    return {
      markdown: finalMarkdown,
      meta: {
        query,
        budget,
        results_count: fused.length,
        tokens_used: wm.tokens + tokensUsed,
        working_memory_tokens: wm.tokens,
        latency_ms: 0,
      },
    };
  }

  /**
   * Search all 4 Qdrant collections in parallel.
   *
   * Each collection is searched independently with graceful degradation:
   * if a collection fails, it returns [] and other collections still contribute.
   * Limits to 20 results per collection (80 max total) per T-29-02.
   *
   * @param {number[]} queryVector - 384-dim embedding vector
   * @param {number} limit - Max results per collection
   * @param {number} threshold - Minimum similarity score (D-04)
   * @returns {Promise<Array<object>>} Flattened results with tier and tierWeight
   */
  async _semanticSearch(queryVector, limit = 20, threshold = 0.75) {
    const results = await Promise.all(
      COLLECTIONS.map((collection) =>
        this.qdrantClient
          .search(collection, {
            vector: queryVector,
            limit,
            score_threshold: threshold,
            with_payload: true,
            with_vector: false,
          })
          .then((points) =>
            points.map((p) => ({
              id: p.id,
              score: p.score,
              payload: p.payload,
              tier: collection,
              tierWeight: TIER_WEIGHTS[collection],
            }))
          )
          .catch((err) => {
            process.stderr.write(
              `[RetrievalService] Qdrant search failed (${collection}): ${err.message}\n`
            );
            return []; // graceful degradation (T-29-04)
          })
      )
    );
    return results.flat();
  }

  /**
   * Apply context-based score boosting to fused results.
   *
   * Boosts are cumulative:
   * - project match: 1.15x
   * - cwd path segment match: 1.10x
   * - recent_files basename match: 1.20x
   *
   * @param {Array<object>} results - Fused results with rrfScore
   * @param {object} context - { project, cwd, recent_files }
   */
  _applyContextBoost(results, context) {
    if (!context || typeof context !== 'object') return;

    const project = context.project ? context.project.toLowerCase() : null;

    // Extract last 2 path components from cwd (e.g. "/Users/x/Agentic/coding" -> "agentic/coding")
    let cwdSegment = null;
    if (context.cwd && typeof context.cwd === 'string') {
      const parts = context.cwd.split('/').filter(Boolean);
      cwdSegment = parts.slice(-2).join('/').toLowerCase();
    }

    // Extract basenames from recent_files
    const recentBasenames = Array.isArray(context.recent_files)
      ? context.recent_files.map((f) => {
          const segments = f.split('/');
          return segments[segments.length - 1].toLowerCase();
        })
      : [];

    for (const result of results) {
      if (!result.rrfScore) continue;

      const text = this._extractSearchableText(result).toLowerCase();

      // Project filtering. Three signals, in decreasing trust:
      //   1. payload.project — populated by the consolidator; an exact label.
      //   2. payload.source — older signal that often contains the project name.
      //   3. plain-text match — fuzziest, only used as a tiebreaker.
      // When payload.project is present, treat it as authoritative:
      //   - same project  → +1.15x
      //   - 'unknown'     → no change (could belong to either)
      //   - other project → 0.5x (still visible but heavily demoted)
      // When the payload has no project label at all we fall back to the
      // older soft-match path so legacy rows still benefit from a small
      // boost on substring matches.
      if (project) {
        const payloadProjectRaw = (result.payload?.project || '').toLowerCase();
        if (payloadProjectRaw) {
          if (payloadProjectRaw === project) {
            result.rrfScore *= 1.15;
          } else if (payloadProjectRaw !== 'unknown') {
            result.rrfScore *= 0.5;
          }
        } else {
          const payloadSource = (result.payload?.source || '').toLowerCase();
          if (payloadSource.includes(project) || text.includes(project)) {
            result.rrfScore *= 1.15;
          }
        }
      }

      // CWD path segment match
      if (cwdSegment && text.includes(cwdSegment)) {
        result.rrfScore *= 1.10;
      }

      // Recent files basename match
      if (recentBasenames.length > 0) {
        for (const basename of recentBasenames) {
          if (basename && text.includes(basename)) {
            result.rrfScore *= 1.20;
            break; // Only boost once for recent_files
          }
        }
      }
    }
  }

  /**
   * Demote insights whose verification ratio is below 1.0. The consolidator's
   * verifier persists `metadata.codeVerification.verificationRatio` for every
   * insight; we look it up via the supplied SQLite handle and scale the
   * rrfScore by a floored linear function of the ratio.
   *
   *   ratio == 1.0 → multiplier 1.0   (no penalty)
   *   ratio == 0.5 → multiplier 0.65  (mild)
   *   ratio == 0.0 → multiplier 0.30  (heavy but still rankable)
   *
   * Only applies to results from the `insights` tier — digests/kg_entities/
   * observations don't have a code-claim verification signal. Fails open: if
   * no DB getter is configured, or the lookup raises, the results pass
   * through unchanged.
   *
   * @param {Array<object>} results - Fused results with rrfScore
   */
  _applyFreshnessRerank(results) {
    if (!Array.isArray(results) || results.length === 0) return;
    if (!this.dbGetter) return;

    const insightResults = results.filter(
      (r) => r.tier === 'insights' && r.rrfScore && r.id != null
    );
    if (insightResults.length === 0) return;

    let db;
    try {
      db = this.dbGetter();
    } catch {
      return;
    }
    if (!db) return;

    // Batch-fetch verification ratios for every insight in scope.
    const ids = [...new Set(insightResults.map((r) => String(r.id)))];
    const placeholders = ids.map(() => '?').join(',');
    let rows;
    try {
      rows = db.prepare(
        `SELECT id,
                json_extract(metadata, '$.codeVerification.verificationRatio') AS ratio
         FROM insights
         WHERE id IN (${placeholders})`
      ).all(...ids);
    } catch (err) {
      process.stderr.write(
        `[RetrievalService] Freshness rerank lookup failed (non-fatal): ${err.message}\n`
      );
      return;
    }

    const ratioById = new Map();
    for (const row of rows) {
      const r = Number(row.ratio);
      if (Number.isFinite(r)) ratioById.set(String(row.id), r);
    }

    for (const result of insightResults) {
      const ratio = ratioById.get(String(result.id));
      if (ratio === undefined) continue;       // never verified — leave alone
      if (ratio >= 1) continue;                // no penalty if fully fresh
      const multiplier = 0.3 + 0.7 * Math.max(0, Math.min(1, ratio));
      result.rrfScore *= multiplier;
    }
  }

  /**
   * Extract searchable text from a result's payload for context matching.
   *
   * @param {object} result - A fused result with payload
   * @returns {string} Concatenated searchable text
   */
  _extractSearchableText(result) {
    const payload = result.payload || {};
    const parts = [
      payload.text || '',
      payload.title || '',
      payload.content || '',
      payload.source || '',
      payload.project || '',
    ];
    return parts.join(' ');
  }

  /**
   * Boost or demote results based on query-keyword overlap with their topic
   * and summary, plus an additional exact-token boost for "topic-name" matches.
   *
   * MiniLM-L6-v2 cosine similarities cluster 0.75-0.82 for same-project docs,
   * so vector similarity alone cannot reliably discriminate topics within the
   * corpus. Two compensating signals are applied:
   *
   *   1. Substring overlap (broad signal): counts query words appearing as
   *      substrings of the result's topic/theme/summary_preview. "status" in
   *      "statusline" counts. Bands push boosts/demotes hard enough to cover
   *      the typical 3× raw-RRF gap between a noisy top hit and the truly
   *      relevant result.
   *
   *   2. Exact-token overlap (strong signal, NEW): counts query words that
   *      appear AS WHOLE TOKENS in the topic field (split on non-alphanumerics).
   *      A query like "drift on the statusline" matching the topic "Tmux
   *      Statusline Renderer" exactly on "statusline" is a near-certain
   *      relevance signal — far stronger than a substring hit.
   *
   * Compounding the two ensures that an item with strong substring overlap
   * AND a topic-name token match (e.g. "Tmux Statusline Renderer" for a
   * statusline question) reliably outscores items with high raw embedding
   * similarity but no topical relevance (e.g. "Observations Pipeline" for the
   * same query).
   *
   * @param {Array<object>} results - Fused results with rrfScore
   * @param {string} query - Original search query (may include [context: ...])
   */
  _applyTopicRelevance(results, query) {
    if (!query || !results.length) return;

    // Stop words that appear everywhere and carry no topic signal
    const STOP_WORDS = new Set([
      'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was',
      'were', 'been', 'have', 'has', 'had', 'not', 'but', 'what', 'how',
      'why', 'when', 'where', 'which', 'who', 'will', 'can', 'does', 'did',
      'should', 'would', 'could', 'may', 'about', 'into', 'out', 'all',
      'also', 'just', 'than', 'then', 'very', 'some', 'any', 'each',
      'use', 'using', 'used', 'make', 'like', 'need', 'know', 'here',
      'context', 'you', 'your', 'our', 'its', 'their', 'they', 'she',
      'coding', 'project', 'file', 'files', 'system', 'service',
    ]);

    // Extract meaningful words from query (3+ chars, not stop words)
    const queryWords = new Set(
      query.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3 && !STOP_WORDS.has(w))
    );

    if (queryWords.size === 0) return;

    for (const result of results) {
      if (!result.rrfScore) continue;

      const p = result.payload || {};

      // Substring-overlap target: topic + theme + summary_preview
      const topicText = [
        p.topic || '',
        p.theme || '',
        p.summary_preview || '',
      ].join(' ').toLowerCase();

      // Exact-token target: ONLY topic/theme (the named field — title-like).
      // Tokenize on non-alphanumerics so "Tmux Statusline Renderer" yields
      // ['tmux','statusline','renderer'] — a query word "statusline" matches
      // the whole token, not just any substring.
      const topicTokens = new Set(
        ((p.topic || '') + ' ' + (p.theme || ''))
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(Boolean)
      );

      // Count overlaps in both modes
      let substringOverlap = 0;
      let exactTokenOverlap = 0;
      for (const word of queryWords) {
        if (topicText.includes(word)) substringOverlap++;
        if (topicTokens.has(word)) exactTokenOverlap++;
      }

      // Substring band — broad signal, governs the base multiplier.
      // 0   → 0.30× (hard demote, was 0.40×): an item with no topical overlap
      //      at all is almost never what the user is asking about, even if
      //      the embedding model thinks it's similar.
      // 1   → 1.00× (neutral): one accidental substring hit is too weak.
      // 2   → 1.50× (boost, was 1.00× neutral): two overlapping words is a
      //      meaningful topical signal.
      // 3+  → 1.90× (strong boost, was 1.30×): high topical overlap.
      let multiplier = 1.0;
      if (substringOverlap === 0) multiplier = 0.30;
      else if (substringOverlap === 1) multiplier = 1.00;
      else if (substringOverlap === 2) multiplier = 1.50;
      else multiplier = 1.90;

      // Exact-token band — narrow signal, compounds with substring band.
      // Matching a whole token of the topic with a query word is the
      // strongest topical signal we have without an LLM in the loop.
      // 1   → ×1.6 compound (e.g. query "statusline drift" matches topic
      //      "Tmux Statusline Renderer" on "statusline").
      // 2+  → ×2.2 compound (query saturates the topic).
      if (exactTokenOverlap === 1) multiplier *= 1.6;
      else if (exactTokenOverlap >= 2) multiplier *= 2.2;

      result.rrfScore *= multiplier;
    }
  }

  /**
   * Run keyword search across SQLite observation/digest/insight tables.
   *
   * @param {string} query - Search query text
   * @returns {Array<object>} Flattened results with tier, tierWeight, and synthetic id
   */
  _keywordSearch(query) {
    const db = this.dbGetter ? this.dbGetter() : null;
    if (!db) return [];

    try {
      const results = this.keywordSearch.search(db, query);

      // Flatten { observations, digests, insights } into a single array
      const all = [];
      for (const tier of ['observations', 'digests', 'insights']) {
        for (const item of results[tier] || []) {
          all.push({
            ...item,
            // Synthetic id to avoid collisions with Qdrant point IDs
            id: item.id ? `kw-${tier}-${item.id}` : `kw-${tier}-${Math.random().toString(36).slice(2)}`,
            tier,
            tierWeight: TIER_WEIGHTS[tier] ?? 1.0,
          });
        }
      }
      return all;
    } catch (err) {
      process.stderr.write(`[RetrievalService] Keyword search failed: ${err.message}\n`);
      return [];
    }
  }
}

/** Singleton instance for shared use across requests. */
let instance = null;

/**
 * Get or create the singleton RetrievalService instance.
 *
 * @param {object} [options] - Options passed to constructor on first call
 * @returns {RetrievalService}
 */
export function getRetrievalService(options) {
  if (!instance) instance = new RetrievalService(options);
  return instance;
}
