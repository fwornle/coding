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
import { rrfFuse, buildRecencyList, TIER_WEIGHTS } from './rrf-fusion.js';
import { assembleBudgetedMarkdown } from './token-budget.js';

/** Qdrant collection names matching embedding-config.json. */
const COLLECTIONS = ['insights', 'digests', 'kg_entities', 'observations'];

/**
 * Orchestrates hybrid retrieval: embed query, parallel semantic + keyword search,
 * RRF fusion, and token-budgeted markdown assembly.
 */
export class RetrievalService {
  /**
   * @param {object} options
   * @param {number} [options.scoreThreshold=0.75] - Minimum Qdrant similarity score (D-04)
   * @param {number} [options.defaultBudget=1000] - Default token budget (D-08)
   * @param {function} [options.dbGetter] - Function returning a better-sqlite3 db instance
   */
  constructor(options = {}) {
    this.scoreThreshold = options.scoreThreshold ?? 0.75;
    this.defaultBudget = options.defaultBudget ?? 1000;
    this.embeddingService = null;
    this.qdrantClient = null;
    this.keywordSearch = new KeywordSearch();
    this.dbGetter = options.dbGetter ?? null;
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
    const { budget = this.defaultBudget, threshold = this.scoreThreshold } = options;

    // Ensure initialized
    if (!this._initialized) {
      await this.initialize();
    }

    // Step 1: Embed query
    const vector = await this.embeddingService.embedOne(query);

    // Step 2: Parallel semantic + keyword search
    const [semanticResults, keywordHits] = await Promise.all([
      this._semanticSearch(vector, 20, threshold),
      this._keywordSearch(query),
    ]);

    // Step 3: Build recency list from combined unique results
    const recencyResults = buildRecencyList([...semanticResults, ...keywordHits]);

    // Step 4: RRF fusion
    const fused = rrfFuse([semanticResults, keywordHits, recencyResults]);

    // Step 5: Token-budgeted markdown assembly
    const { markdown, tokensUsed } = assembleBudgetedMarkdown(fused, budget);

    // Return D-06 response shape (latency_ms set by caller)
    return {
      markdown,
      meta: {
        query,
        budget,
        results_count: fused.length,
        tokens_used: tokensUsed,
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
