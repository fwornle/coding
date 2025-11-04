/**
 * KnowledgeRetriever
 *
 * Context-aware knowledge retrieval system using semantic search and ranking.
 * Retrieves relevant knowledge based on current trajectory, intent, and context.
 *
 * Key Features:
 * - Semantic search using dual-vector embeddings (384-dim fast, 1536-dim accurate)
 * - Context-aware ranking (considers trajectory state, intent, recency, relevance)
 * - Multi-source retrieval (knowledge patterns, code snippets, solutions)
 * - Freshness-based filtering (prioritize recent knowledge, filter stale)
 * - Knowledge fusion (combine and deduplicate results from multiple sources)
 * - Explanation generation (why this knowledge is relevant)
 *
 * Ranking Factors:
 * - Semantic similarity (0-1): How well query matches knowledge
 * - Recency weight (0-1): Fresher knowledge ranked higher
 * - Intent match (0-1): Knowledge aligns with current intent
 * - Confidence score (0-1): Extraction confidence from KnowledgeExtractor
 * - Usage frequency: How often knowledge has been accessed
 *
 * Usage:
 * ```javascript
 * const retriever = new KnowledgeRetriever({
 *   databaseManager,
 *   embeddingGenerator
 * });
 *
 * await retriever.initialize();
 *
 * // Retrieve knowledge for current context
 * const results = await retriever.retrieve(query, {
 *   intent: 'debugging',
 *   trajectoryState: 'debugging',
 *   limit: 5
 * });
 *
 * // Each result includes:
 * // { knowledge, score, reasoning, metadata }
 * ```
 */

import { EventEmitter } from 'events';
import { OntologyQueryEngine } from '../ontology/OntologyQueryEngine.js';

// Knowledge freshness categories (from KnowledgeDecayTracker)
const FRESHNESS_CATEGORIES = {
  FRESH: 'fresh',           // < 30 days
  AGING: 'aging',           // 30-90 days
  STALE: 'stale',           // 90-180 days
  DEPRECATED: 'deprecated'  // > 180 days
};

// Freshness weights for ranking
const FRESHNESS_WEIGHTS = {
  fresh: 1.0,
  aging: 0.8,
  stale: 0.5,
  deprecated: 0.2
};

export class KnowledgeRetriever extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = config;
    this.initialized = false;

    // Required dependencies
    this.databaseManager = config.databaseManager;
    this.embeddingGenerator = config.embeddingGenerator;

    if (!this.databaseManager || !this.embeddingGenerator) {
      throw new Error('KnowledgeRetriever requires databaseManager and embeddingGenerator');
    }

    // Optional ontology support
    this.ontologyQueryEngine = config.ontologyQueryEngine || null;
    this.graphDatabase = config.graphDatabase || null;
    this.ontologyEnabled = !!this.ontologyQueryEngine;

    // Retrieval configuration
    this.defaultLimit = config.defaultLimit || 10;
    this.minSimilarity = config.minSimilarity || 0.6;
    this.recencyDecayDays = config.recencyDecayDays || 90; // 90 days for full decay
    this.intentMatchWeight = config.intentMatchWeight || 0.2; // 20% weight for intent match
    this.freshnessWeight = config.freshnessWeight || 0.15; // 15% weight for freshness
    this.similarityWeight = config.similarityWeight || 0.65; // 65% weight for similarity

    // Vector size selection
    this.fastVectorSize = 384;  // For fast retrieval
    this.accurateVectorSize = 1536; // For accurate retrieval

    // Statistics
    this.stats = {
      retrievals: 0,
      cacheHits: 0,
      fastRetrievals: 0,
      accurateRetrievals: 0,
      totalResultsReturned: 0,
      averageLatency: 0
    };
  }

  /**
   * Initialize retriever
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    console.log('[KnowledgeRetriever] Initializing...');

    // Verify dependencies are initialized
    if (!this.databaseManager.initialized) {
      await this.databaseManager.initialize();
    }

    if (!this.embeddingGenerator.initialized) {
      await this.embeddingGenerator.initialize();
    }

    this.initialized = true;
    this.emit('initialized');
    console.log('[KnowledgeRetriever] Initialized');
  }

  /**
   * Retrieve relevant knowledge
   *
   * @param {string} query - Search query
   * @param {object} context - Retrieval context
   * @returns {Promise<Array>} Ranked knowledge results
   */
  async retrieve(query, context = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = Date.now();
    this.stats.retrievals++;

    try {
      const {
        intent = null,
        trajectoryState = null,
        projectPath = null,
        limit = this.defaultLimit,
        vectorSize = 'auto', // 'auto', 384, or 1536
        includeStale = false
      } = context;

      // Determine vector size
      const useVectorSize = vectorSize === 'auto'
        ? (limit <= 5 ? this.accurateVectorSize : this.fastVectorSize)
        : vectorSize;

      // Generate query embedding
      const queryEmbedding = await this.embeddingGenerator.generate(query, {
        vectorSize: useVectorSize
      });

      // Search knowledge base
      const collection = useVectorSize === this.fastVectorSize
        ? 'knowledge_patterns_small'
        : 'knowledge_patterns';

      const rawResults = await this.databaseManager.searchVectors(
        collection,
        queryEmbedding,
        {
          limit: limit * 3, // Over-fetch for re-ranking
          scoreThreshold: this.minSimilarity,
          includePayload: true
        }
      );

      // Track retrieval type
      if (useVectorSize === this.fastVectorSize) {
        this.stats.fastRetrievals++;
      } else {
        this.stats.accurateRetrievals++;
      }

      // Re-rank results with context
      const rankedResults = await this.rankResults(rawResults, {
        query,
        intent,
        trajectoryState,
        projectPath,
        includeStale
      });

      // Take top N after re-ranking
      const finalResults = rankedResults.slice(0, limit);

      // Generate explanations
      const resultsWithExplanations = finalResults.map(result => ({
        ...result,
        reasoning: this.generateReasoning(result, context)
      }));

      // Update statistics
      const latency = Date.now() - startTime;
      this.stats.totalResultsReturned += finalResults.length;
      this.stats.averageLatency = (this.stats.averageLatency * (this.stats.retrievals - 1) + latency) / this.stats.retrievals;

      this.emit('retrieval-complete', {
        query: query.substring(0, 50),
        resultsCount: finalResults.length,
        latency,
        vectorSize: useVectorSize
      });

      console.log(`[KnowledgeRetriever] Retrieved ${finalResults.length} results in ${latency}ms (${collection})`);

      return resultsWithExplanations;
    } catch (error) {
      console.error('[KnowledgeRetriever] Retrieval failed:', error);
      return [];
    }
  }

  /**
   * Re-rank results based on context
   */
  async rankResults(results, context) {
    const now = Date.now();

    return results.map(result => {
      // Base score (semantic similarity)
      const similarityScore = result.score;

      // Calculate recency score
      const extractedAt = result.payload.extractedAt
        ? new Date(result.payload.extractedAt).getTime()
        : now;
      const ageInDays = (now - extractedAt) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.max(0, 1 - (ageInDays / this.recencyDecayDays));

      // Calculate freshness score
      const freshness = this.calculateFreshness(ageInDays);
      const freshnessScore = FRESHNESS_WEIGHTS[freshness];

      // Calculate intent match score
      let intentScore = 0.5; // Neutral if no intent provided
      if (context.intent && result.payload.type) {
        intentScore = this.calculateIntentMatch(context.intent, result.payload.type);
      }

      // Calculate project match score
      let projectScore = 0.5; // Neutral if no project provided
      if (context.projectPath && result.payload.project) {
        projectScore = context.projectPath === result.payload.project ? 1.0 : 0.3;
      }

      // Weighted final score
      const finalScore =
        (this.similarityWeight * similarityScore) +
        (this.freshnessWeight * freshnessScore) +
        (this.intentMatchWeight * intentScore) +
        (0.1 * recencyScore) + // Recency gets 10% weight
        (0.05 * projectScore); // Project match gets 5% weight

      return {
        id: result.id,
        knowledge: {
          type: result.payload.type,
          text: result.payload.text,
          confidence: result.payload.confidence,
          sessionId: result.payload.sessionId,
          project: result.payload.project,
          extractedAt: result.payload.extractedAt
        },
        score: finalScore,
        components: {
          similarity: similarityScore,
          recency: recencyScore,
          freshness: freshnessScore,
          intent: intentScore,
          project: projectScore
        },
        freshness,
        metadata: result.payload
      };
    }).sort((a, b) => b.score - a.score);
  }

  /**
   * Calculate freshness category
   */
  calculateFreshness(ageInDays) {
    if (ageInDays < 30) return FRESHNESS_CATEGORIES.FRESH;
    if (ageInDays < 90) return FRESHNESS_CATEGORIES.AGING;
    if (ageInDays < 180) return FRESHNESS_CATEGORIES.STALE;
    return FRESHNESS_CATEGORIES.DEPRECATED;
  }

  /**
   * Calculate intent match score
   */
  calculateIntentMatch(intent, knowledgeType) {
    // Map intents to knowledge types
    const intentToKnowledgeMap = {
      'debugging': ['bug_solution', 'debugging', 'testing_strategy'],
      'feature-dev': ['implementation_strategy', 'coding_pattern', 'architectural_decision'],
      'refactoring': ['refactoring', 'coding_pattern', 'optimization'],
      'testing': ['testing_strategy', 'bug_solution'],
      'learning': ['coding_pattern', 'implementation_strategy', 'architectural_decision'],
      'optimization': ['optimization', 'coding_pattern'],
      'documentation': ['implementation_strategy', 'architectural_decision'],
      'exploration': ['coding_pattern', 'architectural_decision']
    };

    const relevantTypes = intentToKnowledgeMap[intent] || [];

    if (relevantTypes.includes(knowledgeType)) {
      return 1.0; // Perfect match
    } else if (relevantTypes.length === 0) {
      return 0.5; // Neutral if no mapping
    } else {
      return 0.3; // Slight mismatch
    }
  }

  /**
   * Generate reasoning for why knowledge is relevant
   */
  generateReasoning(result, context) {
    const reasons = [];

    // Similarity
    if (result.components.similarity > 0.8) {
      reasons.push(`highly relevant to your query (${(result.components.similarity * 100).toFixed(0)}% match)`);
    } else if (result.components.similarity > 0.6) {
      reasons.push(`relevant to your query (${(result.components.similarity * 100).toFixed(0)}% match)`);
    }

    // Freshness
    if (result.freshness === FRESHNESS_CATEGORIES.FRESH) {
      reasons.push('recently extracted knowledge');
    } else if (result.freshness === FRESHNESS_CATEGORIES.DEPRECATED) {
      reasons.push('older knowledge (may be outdated)');
    }

    // Intent match
    if (context.intent && result.components.intent >= 0.8) {
      reasons.push(`matches your ${context.intent} intent`);
    }

    // Project match
    if (context.projectPath && result.components.project === 1.0) {
      reasons.push('from this project');
    }

    // Confidence
    if (result.knowledge.confidence >= 0.8) {
      reasons.push('high-confidence extraction');
    }

    return reasons.length > 0
      ? reasons.join(', ')
      : 'relevant knowledge';
  }

  /**
   * Retrieve knowledge by type
   */
  async retrieveByType(knowledgeType, context = {}) {
    const { limit = this.defaultLimit } = context;

    try {
      // Query by metadata filter
      const results = await this.databaseManager.searchVectors(
        'knowledge_patterns',
        null, // No semantic search, just filter
        {
          limit,
          filter: {
            must: [{
              key: 'type',
              match: { value: knowledgeType }
            }]
          },
          includePayload: true
        }
      );

      return results.map(result => ({
        id: result.id,
        knowledge: result.payload,
        score: 1.0, // No similarity score for type-based retrieval
        metadata: result.payload
      }));
    } catch (error) {
      console.error('[KnowledgeRetriever] Type-based retrieval failed:', error);
      return [];
    }
  }

  /**
   * Retrieve recent knowledge
   */
  async retrieveRecent(context = {}) {
    const {
      limit = this.defaultLimit,
      maxAgeDays = 30
    } = context;

    try {
      const cutoffDate = new Date(Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000)).toISOString();

      // Query by recency filter
      const results = await this.databaseManager.searchVectors(
        'knowledge_patterns',
        null,
        {
          limit,
          filter: {
            must: [{
              key: 'extractedAt',
              range: { gte: cutoffDate }
            }]
          },
          includePayload: true
        }
      );

      return results.map(result => ({
        id: result.id,
        knowledge: result.payload,
        score: 1.0,
        metadata: result.payload
      }));
    } catch (error) {
      console.error('[KnowledgeRetriever] Recent knowledge retrieval failed:', error);
      return [];
    }
  }

  /**
   * Find similar knowledge (for deduplication)
   */
  async findSimilar(knowledgeText, threshold = 0.95) {
    try {
      const embedding = await this.embeddingGenerator.generate(knowledgeText, {
        vectorSize: this.accurateVectorSize
      });

      const results = await this.databaseManager.searchVectors(
        'knowledge_patterns',
        embedding,
        {
          limit: 5,
          scoreThreshold: threshold,
          includePayload: true
        }
      );

      return results;
    } catch (error) {
      console.error('[KnowledgeRetriever] Similarity search failed:', error);
      return [];
    }
  }

  /**
   * Retrieve knowledge by ontology entity class
   *
   * @param {string} entityClass - Ontology entity class to retrieve
   * @param {object} options - Retrieval options
   * @param {string} [options.team] - Team scope (optional)
   * @param {number} [options.minConfidence=0.7] - Minimum ontology confidence
   * @param {number} [options.limit=10] - Maximum results
   * @param {string} [options.sortBy='ontology.confidence'] - Sort field
   * @param {string} [options.sortOrder='DESC'] - Sort order
   * @returns {Promise<Array>} Knowledge items with ontology metadata
   */
  async retrieveByOntology(entityClass, options = {}) {
    if (!this.ontologyEnabled) {
      console.warn('[KnowledgeRetriever] Ontology retrieval not available - ontologyQueryEngine not configured');
      return [];
    }

    try {
      const {
        team = null,
        minConfidence = 0.7,
        limit = this.defaultLimit,
        sortBy = 'ontology.confidence',
        sortOrder = 'DESC'
      } = options;

      // Use GraphDatabaseService queryByOntologyClass method
      if (this.graphDatabase && this.graphDatabase.queryByOntologyClass) {
        const results = await this.graphDatabase.queryByOntologyClass({
          entityClass,
          team,
          minConfidence,
          limit,
          sortBy,
          sortOrder
        });

        // Map to standard retrieval format
        return results.map(result => ({
          id: result.id,
          knowledge: {
            type: result.entity_type,
            text: result.observations ? result.observations.join(' ') : '',
            confidence: result.confidence,
            metadata: result.metadata
          },
          score: result.ontology.confidence,
          metadata: {
            ...result,
            ontology: result.ontology
          },
          reasoning: `Retrieved by ontology class: ${entityClass} (confidence: ${result.ontology.confidence.toFixed(2)}, method: ${result.ontology.method})`
        }));
      }

      // Fallback to OntologyQueryEngine if available
      if (this.ontologyQueryEngine) {
        const queryResult = await this.ontologyQueryEngine.findByEntityClass(
          entityClass,
          team,
          {
            limit,
            offset: 0,
            sortBy: 'ontology.confidence',
            sortOrder: sortOrder.toLowerCase()
          }
        );

        return queryResult.results.map(item => ({
          id: item.id,
          knowledge: {
            type: item.ontology?.entityClass || 'Unknown',
            text: item.content,
            confidence: item.ontology?.confidence || 0,
            metadata: item.metadata || {}
          },
          score: item.ontology?.confidence || 0,
          metadata: item,
          reasoning: `Retrieved by ontology class: ${entityClass}`
        }));
      }

      return [];
    } catch (error) {
      console.error('[KnowledgeRetriever] Ontology retrieval failed:', error);
      return [];
    }
  }

  /**
   * Get retrieval statistics
   */
  getStats() {
    return {
      ...this.stats,
      averageResultsPerRetrieval: this.stats.retrievals > 0
        ? (this.stats.totalResultsReturned / this.stats.retrievals).toFixed(2)
        : 0
    };
  }

  /**
   * Clear statistics
   */
  clearStats() {
    this.stats = {
      retrievals: 0,
      cacheHits: 0,
      fastRetrievals: 0,
      accurateRetrievals: 0,
      totalResultsReturned: 0,
      averageLatency: 0
    };
  }
}

export default KnowledgeRetriever;
export { FRESHNESS_CATEGORIES, FRESHNESS_WEIGHTS };
