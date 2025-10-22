/**
 * KnowledgeStorageService
 *
 * Unified storage interface for knowledge management system.
 * Coordinates storage across Graph DB (entities/relations) and Qdrant (vectors).
 *
 * Key Features:
 * - Unified API: Single interface for all knowledge storage operations
 * - Transactional storage: Atomic writes to Graph DB and Qdrant
 * - Deduplication: Prevents storing similar knowledge (>95% similarity)
 * - Batch operations: Efficient bulk storage and retrieval
 * - Semantic search: Vector-based similarity search
 * - Temporal queries: Time-based knowledge filtering
 * - Event tracking: Log all knowledge operations for analytics
 * - Rollback support: Undo failed operations
 *
 * Storage Strategy:
 * - Entities: Graph DB (knowledge entities, relations, metadata)
 * - Vectors: Qdrant knowledge_patterns (1536-dim) for concepts
 * - Vectors: Qdrant knowledge_patterns_small (384-dim) for code patterns
 * - Abstractions: Same collections with isAbstraction flag
 *
 * Usage:
 * ```javascript
 * const storage = new KnowledgeStorageService({
 *   databaseManager,
 *   graphDatabase,
 *   embeddingGenerator
 * });
 *
 * await storage.initialize();
 *
 * // Store knowledge
 * await storage.storeKnowledge({
 *   type: 'coding_pattern',
 *   text: 'Always use async/await...',
 *   confidence: 0.85,
 *   sessionId: 'session-123',
 *   project: '/path/to/project'
 * });
 *
 * // Search knowledge
 * const results = await storage.searchKnowledge('async patterns', {
 *   limit: 10,
 *   minConfidence: 0.7
 * });
 *
 * // Get recent knowledge
 * const recent = await storage.getRecentKnowledge({ maxAgeDays: 30 });
 * ```
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';

// Storage configuration
const STORAGE_CONFIG = {
  DEDUPLICATION_THRESHOLD: 0.95,  // 95% similarity = duplicate
  BATCH_SIZE: 50,                 // Maximum batch size
  TRANSACTION_TIMEOUT: 10000,     // 10 seconds
  DEFAULT_VECTOR_SIZE: 384        // Fast by default
};

// Knowledge types
const KNOWLEDGE_TYPES = {
  CODING_PATTERN: 'coding_pattern',
  ARCHITECTURAL_DECISION: 'architectural_decision',
  BUG_SOLUTION: 'bug_solution',
  IMPLEMENTATION_STRATEGY: 'implementation_strategy',
  TOOL_USAGE: 'tool_usage',
  OPTIMIZATION: 'optimization',
  INTEGRATION_PATTERN: 'integration_pattern',
  REFACTORING: 'refactoring',
  TESTING_STRATEGY: 'testing_strategy',
  DEPLOYMENT_APPROACH: 'deployment_approach',
  ABSTRACT_CONCEPT: 'abstract_concept'
};

export class KnowledgeStorageService extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = config;
    this.initialized = false;

    // Required dependencies
    this.databaseManager = config.databaseManager;
    this.graphDatabase = config.graphDatabase;
    this.embeddingGenerator = config.embeddingGenerator;

    if (!this.databaseManager || !this.graphDatabase || !this.embeddingGenerator) {
      throw new Error('KnowledgeStorageService requires databaseManager, graphDatabase, and embeddingGenerator');
    }

    // Storage configuration
    this.deduplicationThreshold = config.deduplicationThreshold || STORAGE_CONFIG.DEDUPLICATION_THRESHOLD;
    this.batchSize = config.batchSize || STORAGE_CONFIG.BATCH_SIZE;
    this.defaultVectorSize = config.defaultVectorSize || STORAGE_CONFIG.DEFAULT_VECTOR_SIZE;

    // Statistics
    this.stats = {
      stored: 0,
      duplicatesSkipped: 0,
      searchQueries: 0,
      batchOperations: 0,
      failures: 0,
      byType: {}
    };
  }

  /**
   * Initialize service
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    console.log('[KnowledgeStorageService] Initializing...');

    // Verify dependencies
    if (!this.databaseManager.initialized) {
      await this.databaseManager.initialize();
    }

    if (!this.embeddingGenerator.initialized) {
      await this.embeddingGenerator.initialize();
    }

    this.initialized = true;
    this.emit('initialized');
    console.log('[KnowledgeStorageService] Initialized');
  }

  /**
   * Store knowledge item
   *
   * @param {object} knowledge - Knowledge item to store
   * @param {object} options - Storage options
   * @returns {Promise<object>} Stored knowledge with ID
   */
  async storeKnowledge(knowledge, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    const {
      skipDeduplication = false,
      vectorSize = 'auto' // 'auto', 384, or 1536
    } = options;

    try {
      // Validate knowledge
      this.validateKnowledge(knowledge);

      // Check for duplicates
      if (!skipDeduplication) {
        const isDuplicate = await this.checkDuplicate(knowledge.text);
        if (isDuplicate) {
          this.stats.duplicatesSkipped++;
          this.emit('duplicate-skipped', { text: knowledge.text.substring(0, 50) });
          console.log('[KnowledgeStorageService] Duplicate knowledge skipped');
          return null;
        }
      }

      // Determine vector size
      const useVectorSize = vectorSize === 'auto'
        ? (knowledge.type === KNOWLEDGE_TYPES.ABSTRACT_CONCEPT ? 1536 : 384)
        : vectorSize;

      // Generate embeddings
      const embeddings = await this.generateEmbeddings(knowledge.text, useVectorSize);

      // Generate ID
      const id = knowledge.id || this.generateKnowledgeId(knowledge.text);

      // Store in databases (transactional)
      await this.storeTransactional(id, knowledge, embeddings);

      // Update statistics
      this.stats.stored++;
      if (!this.stats.byType[knowledge.type]) {
        this.stats.byType[knowledge.type] = 0;
      }
      this.stats.byType[knowledge.type]++;

      this.emit('knowledge-stored', {
        id,
        type: knowledge.type,
        vectorSize: useVectorSize
      });

      console.log(`[KnowledgeStorageService] Stored: ${knowledge.type} (${useVectorSize}-dim)`);

      return { id, ...knowledge };
    } catch (error) {
      this.stats.failures++;
      console.error('[KnowledgeStorageService] Storage failed:', error);
      throw error;
    }
  }

  /**
   * Store multiple knowledge items in batch
   */
  async storeBatch(knowledgeItems, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    console.log(`[KnowledgeStorageService] Storing batch of ${knowledgeItems.length} items`);

    const results = [];
    const batches = this.createBatches(knowledgeItems, this.batchSize);

    for (const batch of batches) {
      const batchResults = await Promise.allSettled(
        batch.map(item => this.storeKnowledge(item, options))
      );

      results.push(...batchResults.map((result, i) => ({
        index: i,
        status: result.status,
        value: result.value,
        reason: result.reason
      })));
    }

    this.stats.batchOperations++;

    const successful = results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
    const duplicates = results.filter(r => r.status === 'fulfilled' && r.value === null).length;
    const failures = results.filter(r => r.status === 'rejected').length;

    console.log(`[KnowledgeStorageService] Batch complete: ${successful} stored, ${duplicates} duplicates, ${failures} failures`);

    return results;
  }

  /**
   * Search knowledge by semantic similarity
   */
  async searchKnowledge(query, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    const {
      limit = 10,
      minConfidence = 0.0,
      knowledgeTypes = null,
      projectPath = null,
      vectorSize = this.defaultVectorSize,
      includeAbstractions = true
    } = options;

    this.stats.searchQueries++;

    try {
      // Generate query embedding
      const queryEmbedding = await this.embeddingGenerator.generate(query, {
        vectorSize
      });

      // Determine collection
      const collection = vectorSize === 384
        ? 'knowledge_patterns_small'
        : 'knowledge_patterns';

      // Build filter
      const filter = this.buildFilter({
        minConfidence,
        knowledgeTypes,
        projectPath,
        includeAbstractions
      });

      // Search Qdrant
      const results = await this.databaseManager.searchVectors(
        collection,
        queryEmbedding,
        {
          limit,
          filter,
          includePayload: true
        }
      );

      this.emit('search-complete', {
        query: query.substring(0, 50),
        resultsCount: results.length,
        collection
      });

      return results.map(result => ({
        id: result.id,
        score: result.score,
        knowledge: result.payload
      }));
    } catch (error) {
      console.error('[KnowledgeStorageService] Search failed:', error);
      return [];
    }
  }

  /**
   * Get recent knowledge
   */
  async getRecentKnowledge(options = {}) {
    const {
      limit = 20,
      maxAgeDays = 30,
      knowledgeTypes = null,
      projectPath = null
    } = options;

    try {
      const cutoffDate = new Date(Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000)).toISOString();

      // Build filter
      const filter = {
        must: [
          {
            key: 'extractedAt',
            range: { gte: cutoffDate }
          }
        ]
      };

      if (knowledgeTypes && knowledgeTypes.length > 0) {
        filter.must.push({
          key: 'type',
          match: { any: knowledgeTypes }
        });
      }

      if (projectPath) {
        filter.must.push({
          key: 'project',
          match: { value: projectPath }
        });
      }

      // Query Qdrant
      const results = await this.databaseManager.searchVectors(
        'knowledge_patterns',
        null, // No query vector, just filter
        {
          limit,
          filter,
          includePayload: true
        }
      );

      return results.map(result => ({
        id: result.id,
        knowledge: result.payload
      }));
    } catch (error) {
      console.error('[KnowledgeStorageService] Recent knowledge retrieval failed:', error);
      return [];
    }
  }

  /**
   * Get knowledge by type
   */
  async getKnowledgeByType(knowledgeType, options = {}) {
    const { limit = 50, projectPath = null } = options;

    try {
      const filter = {
        must: [
          {
            key: 'type',
            match: { value: knowledgeType }
          }
        ]
      };

      if (projectPath) {
        filter.must.push({
          key: 'project',
          match: { value: projectPath }
        });
      }

      const results = await this.databaseManager.searchVectors(
        'knowledge_patterns',
        null,
        {
          limit,
          filter,
          includePayload: true
        }
      );

      return results.map(result => ({
        id: result.id,
        knowledge: result.payload
      }));
    } catch (error) {
      console.error('[KnowledgeStorageService] Type-based retrieval failed:', error);
      return [];
    }
  }

  /**
   * Get knowledge by ID
   */
  async getKnowledgeById(knowledgeId) {
    try {
      // Try both collections
      for (const collection of ['knowledge_patterns', 'knowledge_patterns_small']) {
        const results = await this.databaseManager.searchVectors(
          collection,
          null,
          {
            limit: 1,
            filter: {
              must: [
                {
                  key: 'id',
                  match: { value: knowledgeId }
                }
              ]
            },
            includePayload: true
          }
        );

        if (results.length > 0) {
          return {
            id: results[0].id,
            knowledge: results[0].payload
          };
        }
      }

      return null;
    } catch (error) {
      console.error('[KnowledgeStorageService] ID-based retrieval failed:', error);
      return null;
    }
  }

  /**
   * Delete knowledge by ID
   */
  async deleteKnowledge(knowledgeId) {
    try {
      // Delete from Graph DB
      if (this.graphDatabase && this.graphDatabase.deleteEntity) {
        await this.graphDatabase.deleteEntity(knowledgeId);
      }

      // Delete from both Qdrant collections
      await this.databaseManager.deleteVector('knowledge_patterns', knowledgeId);
      await this.databaseManager.deleteVector('knowledge_patterns_small', knowledgeId);

      this.emit('knowledge-deleted', { id: knowledgeId });
      console.log(`[KnowledgeStorageService] Deleted: ${knowledgeId}`);

      return true;
    } catch (error) {
      console.error('[KnowledgeStorageService] Deletion failed:', error);
      return false;
    }
  }

  /**
   * Update knowledge metadata
   */
  async updateKnowledge(knowledgeId, updates) {
    try {
      // Get existing knowledge
      const existing = await this.getKnowledgeById(knowledgeId);
      if (!existing) {
        throw new Error('Knowledge not found');
      }

      // Merge updates
      const updated = {
        ...existing.knowledge,
        ...updates,
        updatedAt: new Date().toISOString()
      };

      // Re-store (will overwrite)
      await this.storeKnowledge(updated, {
        skipDeduplication: true,
        vectorSize: 'auto'
      });

      this.emit('knowledge-updated', { id: knowledgeId });
      console.log(`[KnowledgeStorageService] Updated: ${knowledgeId}`);

      return updated;
    } catch (error) {
      console.error('[KnowledgeStorageService] Update failed:', error);
      throw error;
    }
  }

  /**
   * Check if knowledge is duplicate
   */
  async checkDuplicate(knowledgeText) {
    try {
      const embedding = await this.embeddingGenerator.generate(knowledgeText, {
        vectorSize: 1536 // Use high-quality for duplicate detection
      });

      const similar = await this.databaseManager.searchVectors(
        'knowledge_patterns',
        embedding,
        {
          limit: 1,
          scoreThreshold: this.deduplicationThreshold,
          includePayload: true
        }
      );

      return similar.length > 0;
    } catch (error) {
      console.error('[KnowledgeStorageService] Duplicate check failed:', error);
      return false; // Assume not duplicate on error
    }
  }

  /**
   * Store knowledge transactionally (Graph DB + Qdrant)
   */
  async storeTransactional(id, knowledge, embeddings) {
    const { embedding384, embedding1536 } = embeddings;

    try {
      // Store entity in Graph DB (primary storage)
      const entity = {
        name: id,
        entityName: knowledge.text?.substring(0, 100) || id,
        entityType: knowledge.type,
        observations: [knowledge.text],
        extractionType: knowledge.type,
        classification: knowledge.project || 'coding',
        confidence: knowledge.confidence || 1.0,
        source: 'manual',
        sessionId: knowledge.sessionId || null,
        embeddingId: id,
        metadata: knowledge.metadata || {}
      };

      await this.graphDatabase.storeEntity(entity, {
        team: knowledge.project || 'coding'
      });

      // Store vectors in Qdrant (for semantic search)
      if (embedding384) {
        await this.databaseManager.storeVector(
          'knowledge_patterns_small',
          id,
          embedding384,
          this.createPayload(knowledge)
        );
      }

      if (embedding1536) {
        await this.databaseManager.storeVector(
          'knowledge_patterns',
          id,
          embedding1536,
          this.createPayload(knowledge)
        );
      }
    } catch (error) {
      // Rollback on failure
      await this.rollbackStorage(id);
      throw error;
    }
  }

  /**
   * Rollback failed storage
   */
  async rollbackStorage(knowledgeId) {
    try {
      await this.deleteKnowledge(knowledgeId);
      console.log(`[KnowledgeStorageService] Rolled back: ${knowledgeId}`);
    } catch (error) {
      console.error('[KnowledgeStorageService] Rollback failed:', error);
    }
  }

  /**
   * Generate embeddings (dual vector sizes)
   */
  async generateEmbeddings(text, vectorSize) {
    const embeddings = {};

    if (vectorSize === 384 || vectorSize === 'both') {
      embeddings.embedding384 = await this.embeddingGenerator.generate(text, {
        vectorSize: 384
      });
    }

    if (vectorSize === 1536 || vectorSize === 'both') {
      embeddings.embedding1536 = await this.embeddingGenerator.generate(text, {
        vectorSize: 1536
      });
    }

    return embeddings;
  }

  /**
   * Create payload for Qdrant storage
   */
  createPayload(knowledge) {
    return {
      type: knowledge.type,
      text: knowledge.text,
      confidence: knowledge.confidence || 1.0,
      sessionId: knowledge.sessionId || null,
      project: knowledge.project || null,
      intent: knowledge.intent || null,
      extractedAt: knowledge.extractedAt || new Date().toISOString(),
      isAbstraction: knowledge.isAbstraction || false,
      level: knowledge.level || 0
    };
  }

  /**
   * Build search filter
   */
  buildFilter(options) {
    const {
      minConfidence,
      knowledgeTypes,
      projectPath,
      includeAbstractions
    } = options;

    const filter = { must: [] };

    if (minConfidence > 0) {
      filter.must.push({
        key: 'confidence',
        range: { gte: minConfidence }
      });
    }

    if (knowledgeTypes && knowledgeTypes.length > 0) {
      filter.must.push({
        key: 'type',
        match: { any: knowledgeTypes }
      });
    }

    if (projectPath) {
      filter.must.push({
        key: 'project',
        match: { value: projectPath }
      });
    }

    if (!includeAbstractions) {
      filter.must.push({
        key: 'isAbstraction',
        match: { value: false }
      });
    }

    return filter.must.length > 0 ? filter : undefined;
  }

  /**
   * Validate knowledge structure
   */
  validateKnowledge(knowledge) {
    if (!knowledge.type) {
      throw new Error('Knowledge type is required');
    }

    if (!knowledge.text) {
      throw new Error('Knowledge text is required');
    }

    if (knowledge.confidence !== undefined && (knowledge.confidence < 0 || knowledge.confidence > 1)) {
      throw new Error('Confidence must be between 0 and 1');
    }

    if (!Object.values(KNOWLEDGE_TYPES).includes(knowledge.type)) {
      throw new Error(`Invalid knowledge type: ${knowledge.type}`);
    }
  }

  /**
   * Generate unique knowledge ID
   */
  generateKnowledgeId(text) {
    const hash = crypto.createHash('sha256')
      .update(text)
      .digest('hex');
    return `knowledge_${hash.substring(0, 16)}`;
  }

  /**
   * Create batches from array
   */
  createBatches(items, batchSize) {
    const batches = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      deduplicationRate: this.stats.stored > 0
        ? (this.stats.duplicatesSkipped / (this.stats.stored + this.stats.duplicatesSkipped)).toFixed(2)
        : 0,
      successRate: (this.stats.stored + this.stats.failures) > 0
        ? (this.stats.stored / (this.stats.stored + this.stats.failures)).toFixed(2)
        : 0
    };
  }

  /**
   * Clear statistics
   */
  clearStats() {
    this.stats = {
      stored: 0,
      duplicatesSkipped: 0,
      searchQueries: 0,
      batchOperations: 0,
      failures: 0,
      byType: {}
    };
  }
}

export default KnowledgeStorageService;
export { STORAGE_CONFIG, KNOWLEDGE_TYPES };
