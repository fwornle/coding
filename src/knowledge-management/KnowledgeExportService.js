/**
 * Knowledge Export Service
 *
 * Exports knowledge from the online learning system (Qdrant + SQLite)
 * to VKB-compatible memory format (entities + relations).
 *
 * Conversion mapping:
 * - Knowledge items → Entities with observations
 * - Semantic similarities → Relations between entities
 * - Source metadata added for visual distinction
 */

import crypto from 'crypto';

/**
 * Knowledge types from KnowledgeStorageService
 */
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

/**
 * Mapping from KNOWLEDGE_TYPES to VKB entityType
 */
const TYPE_TO_ENTITY_TYPE = {
  [KNOWLEDGE_TYPES.CODING_PATTERN]: 'Pattern',
  [KNOWLEDGE_TYPES.ARCHITECTURAL_DECISION]: 'Architecture',
  [KNOWLEDGE_TYPES.BUG_SOLUTION]: 'Solution',
  [KNOWLEDGE_TYPES.IMPLEMENTATION_STRATEGY]: 'Strategy',
  [KNOWLEDGE_TYPES.TOOL_USAGE]: 'Tool',
  [KNOWLEDGE_TYPES.OPTIMIZATION]: 'Optimization',
  [KNOWLEDGE_TYPES.INTEGRATION_PATTERN]: 'Pattern',
  [KNOWLEDGE_TYPES.REFACTORING]: 'Refactoring',
  [KNOWLEDGE_TYPES.TESTING_STRATEGY]: 'Strategy',
  [KNOWLEDGE_TYPES.DEPLOYMENT_APPROACH]: 'Deployment',
  [KNOWLEDGE_TYPES.ABSTRACT_CONCEPT]: 'Concept'
};

export class KnowledgeExportService {
  constructor(options = {}) {
    this.databaseManager = options.databaseManager;
    this.embeddingGenerator = options.embeddingGenerator;
    this.debug = options.debug || false;
  }

  /**
   * Export knowledge to VKB memory format
   *
   * @param {Object} options - Export options
   * @param {string} options.projectFilter - Filter by project name
   * @param {string} options.sessionFilter - Filter by session ID
   * @param {Array<string>} options.typeFilter - Filter by knowledge types
   * @param {number} options.limit - Limit number of items
   * @param {number} options.minConfidence - Minimum confidence threshold
   * @param {boolean} options.includeRelations - Generate relations based on similarity
   * @param {number} options.similarityThreshold - Threshold for relation generation (0-1)
   * @returns {Promise<{entities: Array, relations: Array}>}
   */
  async exportToMemoryFormat(options = {}) {
    const {
      projectFilter = null,
      sessionFilter = null,
      typeFilter = null,
      limit = 1000,
      minConfidence = 0.5,
      includeRelations = true,
      similarityThreshold = 0.75
    } = options;

    try {
      // Query knowledge items from databases
      const knowledgeItems = await this.getKnowledgeItems({
        projectFilter,
        sessionFilter,
        typeFilter,
        limit,
        minConfidence
      });

      if (this.debug) {
        console.log(`[KnowledgeExportService] Found ${knowledgeItems.length} knowledge items`);
      }

      // Convert to entities
      const entities = knowledgeItems.map(item => this.convertToEntity(item));

      // Generate relations (optional)
      const relations = includeRelations
        ? await this.generateRelations(knowledgeItems, entities, similarityThreshold)
        : [];

      if (this.debug) {
        console.log(`[KnowledgeExportService] Exported ${entities.length} entities, ${relations.length} relations`);
      }

      return {
        entities,
        relations
      };
    } catch (error) {
      console.error('[KnowledgeExportService] Export failed:', error);
      throw error;
    }
  }

  /**
   * Query knowledge items from SQLite
   *
   * @param {Object} filters - Query filters
   * @returns {Promise<Array>} - Array of knowledge items
   */
  async getKnowledgeItems(filters = {}) {
    const {
      projectFilter,
      sessionFilter,
      typeFilter,
      limit,
      minConfidence
    } = filters;

    if (!this.databaseManager || !this.databaseManager.sqlite) {
      throw new Error('DatabaseManager with SQLite not initialized');
    }

    const db = this.databaseManager.sqlite;

    // Build WHERE clause
    const conditions = [];
    const params = {};

    if (projectFilter) {
      conditions.push('project = $project');
      params.$project = projectFilter;
    }

    if (sessionFilter) {
      conditions.push('sessionId = $sessionId');
      params.$sessionId = sessionFilter;
    }

    if (typeFilter && Array.isArray(typeFilter)) {
      const placeholders = typeFilter.map((_, i) => `$type${i}`).join(', ');
      conditions.push(`type IN (${placeholders})`);
      typeFilter.forEach((type, i) => {
        params[`$type${i}`] = type;
      });
    }

    if (minConfidence) {
      conditions.push('confidence >= $minConfidence');
      params.$minConfidence = minConfidence;
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    // Query knowledge extractions
    const query = `
      SELECT
        id,
        type,
        sessionId,
        project,
        confidence,
        extractedAt,
        metadata
      FROM knowledge_extractions
      ${whereClause}
      ORDER BY extractedAt DESC
      LIMIT $limit
    `;

    params.$limit = limit;

    const rows = db.prepare(query).all(params);

    // Parse metadata JSON
    return rows.map(row => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : {}
    }));
  }

  /**
   * Convert knowledge item to VKB entity format
   *
   * @param {Object} knowledgeItem - Knowledge item from database
   * @returns {Object} - Entity in VKB format
   */
  convertToEntity(knowledgeItem) {
    const {
      id,
      type,
      sessionId,
      project,
      confidence,
      extractedAt,
      metadata
    } = knowledgeItem;

    // Get text from Qdrant payload if available
    const text = metadata.text || metadata.pattern || metadata.summary || 'Knowledge item';

    // Generate meaningful entity name from text
    const entityName = this.generateEntityName(text, type, id);

    // Map knowledge type to entity type
    const entityType = TYPE_TO_ENTITY_TYPE[type] || 'Knowledge';

    // Create observation from knowledge text
    const observation = {
      type: 'insight',
      content: text,
      date: extractedAt || new Date().toISOString()
    };

    // Build entity
    return {
      name: entityName,
      entityType: entityType,
      observations: [observation],
      significance: Math.round(confidence * 10), // Convert 0-1 to 0-10 scale
      metadata: {
        source: 'online',
        knowledgeId: id,
        sessionId: sessionId || null,
        project: project || null,
        confidence: confidence,
        extractedAt: extractedAt,
        knowledgeType: type,
        ...metadata
      },
      id: id
    };
  }

  /**
   * Generate meaningful entity name from knowledge text
   *
   * @param {string} text - Knowledge text content
   * @param {string} type - Knowledge type
   * @param {string} id - Knowledge ID (fallback)
   * @returns {string} - Entity name
   */
  generateEntityName(text, type, id) {
    // Extract first meaningful phrase (up to 50 chars)
    let name = text.substring(0, 50).trim();

    // Clean up name
    name = name.replace(/\n/g, ' ');
    name = name.replace(/\s+/g, ' ');

    // If name ends mid-word, truncate to last complete word
    if (text.length > 50) {
      const lastSpace = name.lastIndexOf(' ');
      if (lastSpace > 20) {
        name = name.substring(0, lastSpace);
      }
      name += '...';
    }

    // Add type prefix for clarity
    const typePrefix = TYPE_TO_ENTITY_TYPE[type] || 'Knowledge';

    // If name is still too generic, use ID suffix
    if (name.length < 15) {
      const shortId = id.substring(0, 8);
      return `${typePrefix}_${name}_${shortId}`;
    }

    return `${typePrefix}: ${name}`;
  }

  /**
   * Generate relations between entities based on semantic similarity
   *
   * @param {Array} knowledgeItems - Original knowledge items
   * @param {Array} entities - Converted entities
   * @param {number} threshold - Similarity threshold (0-1)
   * @returns {Promise<Array>} - Array of relations
   */
  async generateRelations(knowledgeItems, entities, threshold = 0.75) {
    const relations = [];

    // Skip if no embedding generator or Qdrant
    if (!this.embeddingGenerator || !this.databaseManager?.qdrant) {
      if (this.debug) {
        console.log('[KnowledgeExportService] Skipping relation generation (no Qdrant/embeddings)');
      }
      return relations;
    }

    // For each knowledge item, find similar items
    for (let i = 0; i < knowledgeItems.length; i++) {
      const item = knowledgeItems[i];
      const entity = entities[i];

      try {
        // Get embedding for this item's text
        const text = item.metadata?.text || item.metadata?.pattern || '';
        if (!text) continue;

        const embedding = await this.embeddingGenerator.generateEmbedding(text, { size: 384 });

        // Search for similar items in Qdrant
        const searchResults = await this.databaseManager.searchVectors(
          'knowledge_patterns_small',
          embedding,
          {
            limit: 5,
            scoreThreshold: threshold
          }
        );

        // Create relations for similar items
        for (const result of searchResults) {
          // Skip self-references
          if (result.id === item.id) continue;

          // Find the entity for this similar item
          const targetEntity = entities.find(e => e.id === result.id);
          if (!targetEntity) continue;

          // Create relation
          relations.push({
            from: entity.name,
            to: targetEntity.name,
            relationType: 'related_to',
            type: 'relation',
            metadata: {
              source: 'online',
              similarity: result.score,
              autoGenerated: true
            }
          });
        }
      } catch (error) {
        if (this.debug) {
          console.error(`[KnowledgeExportService] Error generating relations for ${item.id}:`, error);
        }
      }
    }

    if (this.debug) {
      console.log(`[KnowledgeExportService] Generated ${relations.length} relations from similarities`);
    }

    return relations;
  }

  /**
   * Export to NDJSON format (newline-delimited JSON)
   *
   * @param {Object} data - Data with entities and relations
   * @returns {string} - NDJSON string
   */
  exportToNDJSON(data) {
    const { entities, relations } = data;

    const lines = [];

    // Add entities
    entities.forEach(entity => {
      lines.push(JSON.stringify({ ...entity, type: 'entity' }));
    });

    // Add relations
    relations.forEach(relation => {
      lines.push(JSON.stringify({ ...relation, type: 'relation' }));
    });

    return lines.join('\n');
  }

  /**
   * Get export statistics
   *
   * @returns {Promise<Object>} - Statistics about exportable knowledge
   */
  async getExportStats() {
    if (!this.databaseManager || !this.databaseManager.sqlite) {
      throw new Error('DatabaseManager with SQLite not initialized');
    }

    const db = this.databaseManager.sqlite;

    // Count total knowledge items
    const totalCount = db.prepare('SELECT COUNT(*) as count FROM knowledge_extractions').get();

    // Count by type
    const byType = db.prepare(`
      SELECT type, COUNT(*) as count
      FROM knowledge_extractions
      GROUP BY type
    `).all();

    // Count by project
    const byProject = db.prepare(`
      SELECT project, COUNT(*) as count
      FROM knowledge_extractions
      WHERE project IS NOT NULL
      GROUP BY project
    `).all();

    // Get date range
    const dateRange = db.prepare(`
      SELECT
        MIN(extractedAt) as earliest,
        MAX(extractedAt) as latest
      FROM knowledge_extractions
    `).get();

    return {
      totalCount: totalCount.count,
      byType: byType.reduce((acc, row) => {
        acc[row.type] = row.count;
        return acc;
      }, {}),
      byProject: byProject.reduce((acc, row) => {
        acc[row.project] = row.count;
        return acc;
      }, {}),
      dateRange: {
        earliest: dateRange.earliest,
        latest: dateRange.latest
      }
    };
  }
}

export default KnowledgeExportService;
