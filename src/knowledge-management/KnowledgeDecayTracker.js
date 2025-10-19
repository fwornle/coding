/**
 * KnowledgeDecayTracker
 *
 * Tracks knowledge lifecycle and calculates freshness scores based on age and usage.
 * Helps maintain knowledge quality by identifying stale, outdated, or deprecated knowledge.
 *
 * Key Features:
 * - Freshness scoring: Calculate time-based freshness (0.0-1.0)
 * - Lifecycle classification: fresh, aging, stale, deprecated
 * - Access tracking: Monitor knowledge usage patterns
 * - Decay analysis: Daily background analysis of knowledge base
 * - Search ranking adjustment: Boost fresh knowledge, demote stale
 * - Deprecation suggestions: Identify candidates for review/removal
 * - Context-aware decay: Some knowledge is timeless (principles vs implementations)
 *
 * Freshness Categories:
 * - FRESH (< 30 days): Recently extracted, highly relevant
 * - AGING (30-90 days): Still relevant, monitor for updates
 * - STALE (90-180 days): Potentially outdated, needs review
 * - DEPRECATED (> 180 days): Likely outdated, candidate for removal
 *
 * Decay Factors:
 * - Age: Time since extraction
 * - Access frequency: How often knowledge is retrieved
 * - Last access: Recency of last retrieval
 * - Type: Some types decay faster (implementations vs principles)
 * - Project activity: Active projects keep knowledge fresh
 *
 * Usage:
 * ```javascript
 * const tracker = new KnowledgeDecayTracker({
 *   databaseManager,
 *   knowledgeStorageService
 * });
 *
 * await tracker.initialize();
 *
 * // Get freshness score
 * const freshness = await tracker.getFreshnessScore(knowledgeId);
 *
 * // Run daily decay analysis
 * await tracker.runDecayAnalysis();
 *
 * // Get deprecation candidates
 * const candidates = await tracker.getDeprecationCandidates();
 * ```
 */

import { EventEmitter } from 'events';

// Freshness categories
const FRESHNESS_CATEGORIES = {
  FRESH: 'fresh',           // < 30 days
  AGING: 'aging',           // 30-90 days
  STALE: 'stale',           // 90-180 days
  DEPRECATED: 'deprecated'  // > 180 days
};

// Age thresholds (in days)
const AGE_THRESHOLDS = {
  FRESH: 30,
  AGING: 90,
  STALE: 180
};

// Decay rates by knowledge type (per day)
const DECAY_RATES = {
  // Fast decay (implementations, tools)
  tool_usage: 0.01,              // Tools change frequently
  deployment_approach: 0.008,    // Deployment practices evolve
  implementation_strategy: 0.006, // Implementations age

  // Medium decay (patterns, optimizations)
  coding_pattern: 0.004,
  optimization: 0.004,
  integration_pattern: 0.003,
  bug_solution: 0.003,

  // Slow decay (decisions, strategies)
  architectural_decision: 0.002,
  refactoring: 0.002,
  testing_strategy: 0.002,

  // Very slow decay (principles)
  abstract_concept: 0.001        // Principles are timeless
};

// Access weight for freshness
const ACCESS_WEIGHT = 0.3; // 30% weight for access patterns

export class KnowledgeDecayTracker extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = config;
    this.initialized = false;

    // Required dependencies
    this.databaseManager = config.databaseManager;
    this.knowledgeStorageService = config.knowledgeStorageService;

    if (!this.databaseManager) {
      throw new Error('KnowledgeDecayTracker requires databaseManager');
    }

    // Decay configuration
    this.ageThresholds = config.ageThresholds || AGE_THRESHOLDS;
    this.decayRates = config.decayRates || DECAY_RATES;
    this.accessWeight = config.accessWeight || ACCESS_WEIGHT;

    // Access tracking
    this.accessLog = new Map(); // knowledgeId -> { count, lastAccess }

    // Statistics
    this.stats = {
      analysisRuns: 0,
      knowledgeAnalyzed: 0,
      deprecationSuggestions: 0,
      freshnessUpdates: 0,
      byCategory: {
        fresh: 0,
        aging: 0,
        stale: 0,
        deprecated: 0
      }
    };
  }

  /**
   * Initialize tracker
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    console.log('[KnowledgeDecayTracker] Initializing...');

    // Verify dependencies
    if (!this.databaseManager.initialized) {
      await this.databaseManager.initialize();
    }

    // Load access log from database
    await this.loadAccessLog();

    this.initialized = true;
    this.emit('initialized');
    console.log('[KnowledgeDecayTracker] Initialized');
  }

  /**
   * Get freshness score for knowledge item
   *
   * @param {string} knowledgeId - Knowledge ID
   * @returns {Promise<object>} Freshness score and category
   */
  async getFreshnessScore(knowledgeId) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Get knowledge metadata
      const knowledge = await this.getKnowledgeMetadata(knowledgeId);
      if (!knowledge) {
        return null;
      }

      // Calculate age-based score
      const ageScore = this.calculateAgeScore(knowledge);

      // Calculate access-based score
      const accessScore = this.calculateAccessScore(knowledgeId);

      // Combine scores
      const finalScore = (1 - this.accessWeight) * ageScore + this.accessWeight * accessScore;

      // Determine category
      const category = this.categorize(knowledge.ageInDays);

      return {
        score: finalScore,
        category,
        ageInDays: knowledge.ageInDays,
        ageScore,
        accessScore,
        lastAccess: this.accessLog.get(knowledgeId)?.lastAccess || null,
        accessCount: this.accessLog.get(knowledgeId)?.count || 0
      };
    } catch (error) {
      console.error('[KnowledgeDecayTracker] Freshness calculation failed:', error);
      return null;
    }
  }

  /**
   * Track knowledge access
   */
  async trackAccess(knowledgeId) {
    const now = Date.now();

    // Update in-memory log
    const existing = this.accessLog.get(knowledgeId) || { count: 0, lastAccess: null };
    this.accessLog.set(knowledgeId, {
      count: existing.count + 1,
      lastAccess: now
    });

    // Persist to database (async, non-blocking)
    this.persistAccessLog(knowledgeId).catch(error => {
      console.error('[KnowledgeDecayTracker] Access log persistence failed:', error);
    });

    this.emit('access-tracked', { knowledgeId });
  }

  /**
   * Run decay analysis on entire knowledge base
   */
  async runDecayAnalysis() {
    if (!this.initialized) {
      await this.initialize();
    }

    console.log('[KnowledgeDecayTracker] Running decay analysis...');
    const startTime = Date.now();

    try {
      // Get all knowledge metadata
      const allKnowledge = await this.getAllKnowledgeMetadata();

      console.log(`[KnowledgeDecayTracker] Analyzing ${allKnowledge.length} knowledge items`);

      // Analyze each item
      const results = {
        fresh: [],
        aging: [],
        stale: [],
        deprecated: []
      };

      for (const knowledge of allKnowledge) {
        const freshness = await this.getFreshnessScore(knowledge.id);
        if (freshness) {
          results[freshness.category].push({
            id: knowledge.id,
            type: knowledge.type,
            freshness
          });
        }
      }

      // Update statistics
      this.stats.analysisRuns++;
      this.stats.knowledgeAnalyzed += allKnowledge.length;
      this.stats.byCategory = {
        fresh: results.fresh.length,
        aging: results.aging.length,
        stale: results.stale.length,
        deprecated: results.deprecated.length
      };

      // Generate deprecation suggestions
      const deprecationCandidates = this.identifyDeprecationCandidates(results);
      this.stats.deprecationSuggestions = deprecationCandidates.length;

      const duration = Date.now() - startTime;

      this.emit('analysis-complete', {
        duration,
        analyzed: allKnowledge.length,
        results: this.stats.byCategory,
        deprecationCandidates: deprecationCandidates.length
      });

      console.log(`[KnowledgeDecayTracker] Analysis complete in ${duration}ms`);
      console.log(`  Fresh: ${results.fresh.length}`);
      console.log(`  Aging: ${results.aging.length}`);
      console.log(`  Stale: ${results.stale.length}`);
      console.log(`  Deprecated: ${results.deprecated.length}`);
      console.log(`  Deprecation candidates: ${deprecationCandidates.length}`);

      return {
        results,
        deprecationCandidates,
        stats: this.stats
      };
    } catch (error) {
      console.error('[KnowledgeDecayTracker] Decay analysis failed:', error);
      throw error;
    }
  }

  /**
   * Get deprecation candidates
   */
  async getDeprecationCandidates(options = {}) {
    const {
      maxAgeDays = 180,
      minAccessDays = 90, // No access in 90 days
      limit = 20
    } = options;

    try {
      const allKnowledge = await this.getAllKnowledgeMetadata();
      const now = Date.now();

      const candidates = [];

      for (const knowledge of allKnowledge) {
        const freshness = await this.getFreshnessScore(knowledge.id);
        if (!freshness) continue;

        // Check age threshold
        if (freshness.ageInDays < maxAgeDays) continue;

        // Check access recency
        const daysSinceAccess = freshness.lastAccess
          ? (now - freshness.lastAccess) / (1000 * 60 * 60 * 24)
          : Infinity;

        if (daysSinceAccess < minAccessDays) continue;

        candidates.push({
          id: knowledge.id,
          type: knowledge.type,
          ageInDays: freshness.ageInDays,
          daysSinceAccess,
          accessCount: freshness.accessCount,
          score: freshness.score,
          reason: this.generateDeprecationReason(freshness, daysSinceAccess)
        });
      }

      // Sort by age (oldest first)
      candidates.sort((a, b) => b.ageInDays - a.ageInDays);

      return candidates.slice(0, limit);
    } catch (error) {
      console.error('[KnowledgeDecayTracker] Deprecation candidate retrieval failed:', error);
      return [];
    }
  }

  /**
   * Adjust search ranking based on freshness
   */
  adjustRanking(results) {
    return results.map(result => {
      const freshness = this.getFreshnessScoreSync(result);
      const freshnessMultiplier = this.getFreshnessMultiplier(freshness.category);

      return {
        ...result,
        score: result.score * freshnessMultiplier,
        freshness: freshness.category,
        originalScore: result.score
      };
    }).sort((a, b) => b.score - a.score);
  }

  /**
   * Calculate age-based freshness score
   */
  calculateAgeScore(knowledge) {
    const { type, ageInDays } = knowledge;

    // Get decay rate for type
    const decayRate = this.decayRates[type] || 0.005;

    // Exponential decay: score = e^(-decay_rate * age)
    const score = Math.exp(-decayRate * ageInDays);

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate access-based freshness score
   */
  calculateAccessScore(knowledgeId) {
    const accessData = this.accessLog.get(knowledgeId);
    if (!accessData || accessData.count === 0) {
      return 0.5; // Neutral if never accessed
    }

    const now = Date.now();
    const daysSinceAccess = (now - accessData.lastAccess) / (1000 * 60 * 60 * 24);

    // Recency score: decays over 180 days
    const recencyScore = Math.exp(-daysSinceAccess / 180);

    // Frequency score: logarithmic scaling
    const frequencyScore = Math.min(1, Math.log10(accessData.count + 1) / 2);

    // Combined: 70% recency, 30% frequency
    return 0.7 * recencyScore + 0.3 * frequencyScore;
  }

  /**
   * Categorize knowledge by age
   */
  categorize(ageInDays) {
    if (ageInDays < this.ageThresholds.FRESH) {
      return FRESHNESS_CATEGORIES.FRESH;
    } else if (ageInDays < this.ageThresholds.AGING) {
      return FRESHNESS_CATEGORIES.AGING;
    } else if (ageInDays < this.ageThresholds.STALE) {
      return FRESHNESS_CATEGORIES.STALE;
    } else {
      return FRESHNESS_CATEGORIES.DEPRECATED;
    }
  }

  /**
   * Get freshness multiplier for ranking
   */
  getFreshnessMultiplier(category) {
    switch (category) {
      case FRESHNESS_CATEGORIES.FRESH:
        return 1.2; // 20% boost
      case FRESHNESS_CATEGORIES.AGING:
        return 1.0; // No change
      case FRESHNESS_CATEGORIES.STALE:
        return 0.8; // 20% penalty
      case FRESHNESS_CATEGORIES.DEPRECATED:
        return 0.5; // 50% penalty
      default:
        return 1.0;
    }
  }

  /**
   * Get freshness score synchronously (for ranking)
   */
  getFreshnessScoreSync(result) {
    const extractedAt = result.knowledge?.extractedAt || result.payload?.extractedAt;
    if (!extractedAt) {
      return { category: FRESHNESS_CATEGORIES.AGING, score: 0.5 };
    }

    const ageInDays = (Date.now() - new Date(extractedAt).getTime()) / (1000 * 60 * 60 * 24);
    const category = this.categorize(ageInDays);

    return { category, score: 0.5 }; // Simplified for sync
  }

  /**
   * Identify deprecation candidates from analysis results
   */
  identifyDeprecationCandidates(results) {
    const candidates = [];

    // Deprecated items with low access
    for (const item of results.deprecated) {
      if (item.freshness.accessCount < 3) {
        candidates.push({
          ...item,
          reason: 'Old and rarely accessed'
        });
      }
    }

    // Stale items with no recent access
    for (const item of results.stale) {
      if (item.freshness.accessCount === 0) {
        candidates.push({
          ...item,
          reason: 'Never accessed and aging'
        });
      }
    }

    return candidates;
  }

  /**
   * Generate deprecation reason
   */
  generateDeprecationReason(freshness, daysSinceAccess) {
    const reasons = [];

    if (freshness.ageInDays > 365) {
      reasons.push('over 1 year old');
    } else if (freshness.ageInDays > 180) {
      reasons.push('over 6 months old');
    }

    if (daysSinceAccess === Infinity) {
      reasons.push('never accessed');
    } else if (daysSinceAccess > 180) {
      reasons.push('not accessed in 6+ months');
    }

    if (freshness.accessCount === 0) {
      reasons.push('no usage history');
    } else if (freshness.accessCount < 3) {
      reasons.push('rarely used');
    }

    return reasons.join(', ');
  }

  /**
   * Get knowledge metadata
   */
  async getKnowledgeMetadata(knowledgeId) {
    try {
      const result = await this.knowledgeStorageService?.getKnowledgeById(knowledgeId);
      if (!result) return null;

      const extractedAt = result.knowledge.extractedAt;
      const ageInDays = (Date.now() - new Date(extractedAt).getTime()) / (1000 * 60 * 60 * 24);

      return {
        id: knowledgeId,
        type: result.knowledge.type,
        extractedAt,
        ageInDays
      };
    } catch (error) {
      console.error('[KnowledgeDecayTracker] Metadata retrieval failed:', error);
      return null;
    }
  }

  /**
   * Get all knowledge metadata
   */
  async getAllKnowledgeMetadata() {
    try {
      // Query all knowledge from SQLite
      const results = await this.databaseManager.getAllKnowledgeExtractions();

      return results.map(row => ({
        id: row.id,
        type: row.type,
        extractedAt: row.extractedAt,
        ageInDays: (Date.now() - new Date(row.extractedAt).getTime()) / (1000 * 60 * 60 * 24)
      }));
    } catch (error) {
      console.error('[KnowledgeDecayTracker] All metadata retrieval failed:', error);
      return [];
    }
  }

  /**
   * Load access log from database
   */
  async loadAccessLog() {
    try {
      // Load from SQLite access_log table
      const logs = await this.databaseManager.getAccessLogs();

      for (const log of logs) {
        this.accessLog.set(log.knowledgeId, {
          count: log.count,
          lastAccess: new Date(log.lastAccess).getTime()
        });
      }

      console.log(`[KnowledgeDecayTracker] Loaded ${logs.length} access logs`);
    } catch (error) {
      console.error('[KnowledgeDecayTracker] Access log loading failed:', error);
    }
  }

  /**
   * Persist access log to database
   */
  async persistAccessLog(knowledgeId) {
    const accessData = this.accessLog.get(knowledgeId);
    if (!accessData) return;

    try {
      await this.databaseManager.updateAccessLog({
        knowledgeId,
        count: accessData.count,
        lastAccess: new Date(accessData.lastAccess).toISOString()
      });
    } catch (error) {
      console.error('[KnowledgeDecayTracker] Access log persistence failed:', error);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      accessLogSize: this.accessLog.size
    };
  }

  /**
   * Clear statistics
   */
  clearStats() {
    this.stats = {
      analysisRuns: 0,
      knowledgeAnalyzed: 0,
      deprecationSuggestions: 0,
      freshnessUpdates: 0,
      byCategory: {
        fresh: 0,
        aging: 0,
        stale: 0,
        deprecated: 0
      }
    };
  }
}

export default KnowledgeDecayTracker;
export { FRESHNESS_CATEGORIES, AGE_THRESHOLDS, DECAY_RATES };
