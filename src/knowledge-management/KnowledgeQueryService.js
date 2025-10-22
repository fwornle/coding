/**
 * Knowledge Query Service
 *
 * Provides high-level querying interface for knowledge stored in databases (SQLite + Qdrant).
 * Supports filtering by team, source, type, date ranges, and semantic search.
 *
 * Used by:
 * - VKB server API endpoints
 * - Migration scripts
 * - Analytics and reporting tools
 */

export class KnowledgeQueryService {
  constructor(databaseManager, graphDatabase = null, options = {}) {
    this.databaseManager = databaseManager;
    this.graphDatabase = graphDatabase;
    this.debug = options.debug || false;
  }

  /**
   * Query entities with comprehensive filtering options
   *
   * NOTE: Delegates to GraphDatabaseService when available, falls back to SQLite
   *
   * @param {Object} options - Query options
   * @param {string} options.team - Filter by team (e.g., 'coding', 'ui')
   * @param {string} options.source - Filter by source ('manual' | 'auto')
   * @param {Array<string>} options.types - Filter by entity types
   * @param {string} options.startDate - ISO date string for range start
   * @param {string} options.endDate - ISO date string for range end
   * @param {number} options.minConfidence - Minimum confidence threshold
   * @param {number} options.limit - Maximum results to return
   * @param {number} options.offset - Pagination offset
   * @param {string} options.searchTerm - Entity name search term
   * @param {string} options.sortBy - Sort field ('last_modified', 'extracted_at', 'confidence')
   * @param {string} options.sortOrder - Sort direction ('ASC' | 'DESC')
   * @returns {Promise<Array>} Array of knowledge entities
   */
  async queryEntities(options = {}) {
    // Delegate to graph database if available
    if (this.graphDatabase) {
      return await this.graphDatabase.queryEntities(options);
    }

    // Fallback to SQLite
    if (!this.databaseManager.health.sqlite.available) {
      throw new Error('SQLite database unavailable');
    }

    const {
      team = null,
      source = null,
      types = null,
      startDate = null,
      endDate = null,
      minConfidence = 0,
      limit = 1000,
      offset = 0,
      searchTerm = null,
      sortBy = 'last_modified',
      sortOrder = 'DESC'
    } = options;

    // Build dynamic query
    let query = `
      SELECT
        id,
        entity_name,
        entity_type,
        observations,
        extraction_type,
        classification,
        confidence,
        source,
        team,
        extracted_at,
        last_modified,
        session_id,
        embedding_id,
        metadata
      FROM knowledge_extractions
      WHERE 1=1
    `;

    const params = [];

    // Apply filters
    if (team) {
      query += ' AND team = ?';
      params.push(team);
    }

    if (source) {
      query += ' AND source = ?';
      params.push(source);
    }

    if (types && types.length > 0) {
      query += ` AND entity_type IN (${types.map(() => '?').join(',')})`;
      params.push(...types);
    }

    if (startDate) {
      query += ' AND last_modified >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND last_modified <= ?';
      params.push(endDate);
    }

    if (minConfidence > 0) {
      query += ' AND confidence >= ?';
      params.push(minConfidence);
    }

    if (searchTerm) {
      query += ' AND entity_name LIKE ?';
      params.push(`%${searchTerm}%`);
    }

    // Add sorting
    const validSortFields = ['last_modified', 'extracted_at', 'confidence', 'entity_name'];
    const validSortOrders = ['ASC', 'DESC'];

    const safeSortBy = validSortFields.includes(sortBy) ? sortBy : 'last_modified';
    const safeSortOrder = validSortOrders.includes(sortOrder) ? sortOrder : 'DESC';

    query += ` ORDER BY ${safeSortBy} ${safeSortOrder}`;

    // Add pagination
    query += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    try {
      const stmt = this.databaseManager.sqlite.prepare(query);
      const results = stmt.all(...params);

      // Parse JSON fields
      const entities = results.map(row => ({
        ...row,
        observations: row.observations ? JSON.parse(row.observations) : [],
        metadata: row.metadata ? JSON.parse(row.metadata) : {}
      }));

      if (this.debug) {
        console.log(`[KnowledgeQueryService] Found ${entities.length} entities`);
      }

      return entities;
    } catch (error) {
      console.error('[KnowledgeQueryService] Query failed:', error);
      throw error;
    }
  }

  /**
   * Query relations for specific entities
   *
   * NOTE: Delegates to GraphDatabaseService when available, falls back to SQLite
   *
   * @param {Object} options - Query options
   * @param {string} options.entityId - Get relations for this entity
   * @param {string} options.team - Filter by team
   * @param {string} options.relationType - Filter by relation type
   * @param {number} options.limit - Maximum results
   * @returns {Promise<Array>} Array of relations
   */
  async queryRelations(options = {}) {
    // Delegate to graph database if available
    if (this.graphDatabase) {
      return await this.graphDatabase.queryRelations(options);
    }

    // Fallback to SQLite
    if (!this.databaseManager.health.sqlite.available) {
      throw new Error('SQLite database unavailable');
    }

    const {
      entityId = null,
      team = null,
      relationType = null,
      limit = 1000
    } = options;

    let query = `
      SELECT
        r.id,
        r.from_entity_id,
        r.to_entity_id,
        r.relation_type,
        r.confidence,
        r.team,
        r.created_at,
        r.metadata,
        e1.entity_name as from_name,
        e2.entity_name as to_name
      FROM knowledge_relations r
      LEFT JOIN knowledge_extractions e1 ON r.from_entity_id = e1.id
      LEFT JOIN knowledge_extractions e2 ON r.to_entity_id = e2.id
      WHERE 1=1
    `;

    const params = [];

    if (entityId) {
      query += ' AND (r.from_entity_id = ? OR r.to_entity_id = ?)';
      params.push(entityId, entityId);
    }

    if (team) {
      query += ' AND r.team = ?';
      params.push(team);
    }

    if (relationType) {
      query += ' AND r.relation_type = ?';
      params.push(relationType);
    }

    query += ' LIMIT ?';
    params.push(limit);

    try {
      const stmt = this.databaseManager.sqlite.prepare(query);
      const results = stmt.all(...params);

      // Parse JSON metadata
      const relations = results.map(row => ({
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : {}
      }));

      if (this.debug) {
        console.log(`[KnowledgeQueryService] Found ${relations.length} relations`);
      }

      return relations;
    } catch (error) {
      console.error('[KnowledgeQueryService] Relations query failed:', error);
      throw error;
    }
  }

  /**
   * Get statistics about knowledge in the database
   *
   * NOTE: Delegates to GraphDatabaseService when available, falls back to SQLite
   *
   * @param {Object} options - Query options
   * @param {string} options.team - Filter by team
   * @returns {Promise<Object>} Statistics object
   */
  async getStatistics(options = {}) {
    // Delegate to graph database if available
    if (this.graphDatabase) {
      return await this.graphDatabase.getStatistics(options);
    }

    // Fallback to SQLite
    if (!this.databaseManager.health.sqlite.available) {
      throw new Error('SQLite database unavailable');
    }

    const { team = null } = options;

    try {
      // Entity counts by team and source
      let entityQuery = `
        SELECT
          team,
          source,
          entity_type,
          COUNT(*) as count
        FROM knowledge_extractions
      `;
      const entityParams = [];

      if (team) {
        entityQuery += ' WHERE team = ?';
        entityParams.push(team);
      }

      entityQuery += ' GROUP BY team, source, entity_type';

      const entityStmt = this.databaseManager.sqlite.prepare(entityQuery);
      const entityStats = entityStmt.all(...entityParams);

      // Relation counts
      let relationQuery = `
        SELECT
          team,
          relation_type,
          COUNT(*) as count
        FROM knowledge_relations
      `;
      const relationParams = [];

      if (team) {
        relationQuery += ' WHERE team = ?';
        relationParams.push(team);
      }

      relationQuery += ' GROUP BY team, relation_type';

      const relationStmt = this.databaseManager.sqlite.prepare(relationQuery);
      const relationStats = relationStmt.all(...relationParams);

      // Total counts
      let totalQuery = 'SELECT COUNT(*) as total FROM knowledge_extractions';
      const totalParams = [];

      if (team) {
        totalQuery += ' WHERE team = ?';
        totalParams.push(team);
      }

      const totalStmt = this.databaseManager.sqlite.prepare(totalQuery);
      const totalResult = totalStmt.get(...totalParams);

      return {
        totalEntities: totalResult.total,
        entitiesByTeamAndSource: entityStats,
        relationsByTeamAndType: relationStats,
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      console.error('[KnowledgeQueryService] Statistics query failed:', error);
      throw error;
    }
  }

  /**
   * Get list of unique teams in the database
   *
   * NOTE: Delegates to GraphDatabaseService when available, falls back to SQLite
   *
   * @returns {Promise<Array>} Array of team names with counts
   */
  async getTeams() {
    // Delegate to graph database if available
    if (this.graphDatabase) {
      return await this.graphDatabase.getTeams();
    }

    // Fallback to SQLite
    if (!this.databaseManager.health.sqlite.available) {
      throw new Error('SQLite database unavailable');
    }

    try {
      const query = `
        SELECT
          team,
          COUNT(*) as entity_count,
          MAX(last_modified) as last_activity
        FROM knowledge_extractions
        GROUP BY team
        ORDER BY entity_count DESC
      `;

      const stmt = this.databaseManager.sqlite.prepare(query);
      const teams = stmt.all();

      return teams.map(t => ({
        name: t.team,
        displayName: t.team.charAt(0).toUpperCase() + t.team.slice(1),
        entityCount: t.entity_count,
        lastActivity: t.last_activity
      }));
    } catch (error) {
      console.error('[KnowledgeQueryService] Teams query failed:', error);
      throw error;
    }
  }

  /**
   * Semantic search using Qdrant vector database
   *
   * @param {string} queryText - Search query
   * @param {Object} options - Search options
   * @param {string} options.team - Filter by team
   * @param {number} options.limit - Maximum results
   * @param {number} options.threshold - Similarity threshold (0-1)
   * @returns {Promise<Array>} Array of similar entities with scores
   */
  async semanticSearch(queryText, options = {}) {
    if (!this.databaseManager.health.qdrant.available) {
      console.warn('[KnowledgeQueryService] Qdrant unavailable, semantic search disabled');
      return [];
    }

    const {
      team = null,
      limit = 10,
      threshold = 0.7
    } = options;

    // This would require the embedding generator to create query vector
    // For now, return placeholder
    console.warn('[KnowledgeQueryService] Semantic search not fully implemented yet');
    return [];
  }

  /**
   * Store a new entity in the database
   *
   * NOTE: Delegates to GraphDatabaseService when available, falls back to SQLite
   *
   * @param {Object} entity - Entity object
   * @returns {Promise<string>} ID of stored entity
   */
  async storeEntity(entity) {
    // Delegate to graph database if available
    if (this.graphDatabase) {
      const {
        entityName,
        entityType,
        observations = [],
        extractionType = 'manual',
        classification = null,
        confidence = 1.0,
        source = 'manual',
        team = 'coding',
        sessionId = null,
        embeddingId = null,
        metadata = {}
      } = entity;

      const graphEntity = {
        name: entityName,
        entityType,
        observations,
        extractionType,
        classification,
        confidence,
        source,
        sessionId,
        embeddingId,
        metadata
      };

      const nodeId = await this.graphDatabase.storeEntity(graphEntity, { team });

      if (this.debug) {
        console.log(`[KnowledgeQueryService] Stored entity in graph: ${entityName} (${nodeId})`);
      }

      return nodeId;
    }

    // Fallback to SQLite
    if (!this.databaseManager.health.sqlite.available) {
      throw new Error('SQLite database unavailable');
    }

    const {
      id,
      entityName,
      entityType,
      observations = [],
      extractionType = 'manual',
      classification = null,
      confidence = 1.0,
      source = 'manual',
      team = 'coding',
      sessionId = null,
      embeddingId = null,
      metadata = {}
    } = entity;

    try {
      const stmt = this.databaseManager.sqlite.prepare(`
        INSERT INTO knowledge_extractions (
          id, entity_name, entity_type, observations, extraction_type,
          classification, confidence, source, team, session_id,
          embedding_id, metadata, extracted_at, last_modified
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `);

      stmt.run(
        id,
        entityName,
        entityType,
        JSON.stringify(observations),
        extractionType,
        classification,
        confidence,
        source,
        team,
        sessionId,
        embeddingId,
        JSON.stringify(metadata)
      );

      if (this.debug) {
        console.log(`[KnowledgeQueryService] Stored entity: ${entityName} (${id})`);
      }

      return id;
    } catch (error) {
      console.error('[KnowledgeQueryService] Failed to store entity:', error);
      throw error;
    }
  }

  /**
   * Store a relation between entities
   *
   * NOTE: Delegates to GraphDatabaseService when available, falls back to SQLite
   *
   * @param {Object} relation - Relation object (supports both name-based and ID-based)
   * @returns {Promise<string>} ID of stored relation
   */
  async storeRelation(relation) {
    // Delegate to graph database if available
    if (this.graphDatabase) {
      const {
        fromEntityName,
        toEntityName,
        fromEntityId,
        toEntityId,
        relationType,
        confidence = 1.0,
        team = 'coding',
        metadata = {}
      } = relation;

      // Graph database uses entity names, not IDs
      const fromName = fromEntityName || fromEntityId;
      const toName = toEntityName || toEntityId;

      if (!fromName || !toName) {
        throw new Error('Relation requires fromEntityName/fromEntityId and toEntityName/toEntityId');
      }

      await this.graphDatabase.storeRelationship(fromName, toName, relationType, {
        team,
        confidence,
        metadata
      });

      if (this.debug) {
        console.log(`[KnowledgeQueryService] Stored relation in graph: ${fromName} -> ${toName}`);
      }

      // Return a consistent ID format for graph relations
      return `${team}:${fromName}:${relationType}:${toName}`;
    }

    // Fallback to SQLite
    if (!this.databaseManager.health.sqlite.available) {
      throw new Error('SQLite database unavailable');
    }

    const {
      id,
      fromEntityId,
      toEntityId,
      relationType,
      confidence = 1.0,
      team = 'coding',
      metadata = {}
    } = relation;

    try {
      const stmt = this.databaseManager.sqlite.prepare(`
        INSERT INTO knowledge_relations (
          id, from_entity_id, to_entity_id, relation_type,
          confidence, team, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        fromEntityId,
        toEntityId,
        relationType,
        confidence,
        team,
        JSON.stringify(metadata)
      );

      if (this.debug) {
        console.log(`[KnowledgeQueryService] Stored relation: ${fromEntityId} -> ${toEntityId}`);
      }

      return id;
    } catch (error) {
      console.error('[KnowledgeQueryService] Failed to store relation:', error);
      throw error;
    }
  }
}

export default KnowledgeQueryService;
