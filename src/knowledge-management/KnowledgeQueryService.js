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

import fs from 'fs';
import path from 'path';

export class KnowledgeQueryService {
  constructor(databaseManager, graphDatabase = null, options = {}) {
    this.databaseManager = databaseManager;
    this.graphDatabase = graphDatabase;
    this.debug = options.debug || false;
    // Cache for km-core JSON exports — keyed by absolute file path, value: { mtimeMs, parsed }
    this._exportCache = new Map();
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
    // Delegate to graph database if available (check both constructor-provided and lazy-initialized)
    const graphDB = this.graphDatabase || this.databaseManager?.graphDB;
    if (graphDB) {
      return await graphDB.queryEntities(options);
    }

    // Phase 42.2 Plan 04 retired GraphDatabaseService; VKB reads the km-core
    // JSON exports written by the wave-controller into
    // .data/knowledge-graph/exports/{team}.json. Falls through to SQLite
    // only if the export dir is missing/empty.
    const fromExports = this._queryEntitiesFromExports(options);
    if (fromExports !== null) return fromExports;

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
    // Delegate to graph database if available (check both constructor-provided and lazy-initialized)
    const graphDB = this.graphDatabase || this.databaseManager?.graphDB;
    if (graphDB) {
      return await graphDB.queryRelations(options);
    }

    // Phase 42.2 Plan 04 retired GraphDatabaseService; read from km-core
    // JSON exports before falling through to the legacy SQLite path.
    const fromExports = this._queryRelationsFromExports(options);
    if (fromExports !== null) return fromExports;

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
    // Delegate to graph database if available (check both constructor-provided and lazy-initialized)
    const graphDB = this.graphDatabase || this.databaseManager?.graphDB;
    if (graphDB) {
      return await graphDB.getStatistics(options);
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
    // Delegate to graph database if available (check both constructor-provided and lazy-initialized)
    const graphDB = this.graphDatabase || this.databaseManager?.graphDB;
    if (graphDB) {
      process.stderr.write('[KnowledgeQueryService] Using GraphDB for teams\n');
      return await graphDB.getTeams();
    }

    // Phase 42.2 Plan 04 retired GraphDatabaseService; derive teams from
    // the km-core JSON export filenames (one file per team).
    const fromExports = this._getTeamsFromExports();
    if (fromExports !== null) return fromExports;

    process.stderr.write('[KnowledgeQueryService] GraphDB not available, using SQLite fallback\n');
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
    // Delegate to graph database if available (check both constructor-provided and lazy-initialized)
    const graphDB = this.graphDatabase || this.databaseManager?.graphDB;
    if (graphDB) {
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

      // Forward hierarchy fields if present
      if (entity.parentEntityName !== undefined) graphEntity.parentEntityName = entity.parentEntityName;
      if (entity.hierarchyLevel !== undefined) graphEntity.hierarchyLevel = entity.hierarchyLevel;
      if (entity.isScaffoldNode !== undefined) graphEntity.isScaffoldNode = entity.isScaffoldNode;
      if (entity.childEntityNames !== undefined) graphEntity.childEntityNames = entity.childEntityNames;

      // Forward operator-enriched fields if present
      if (entity.embedding !== undefined) graphEntity.embedding = entity.embedding;
      if (entity.role !== undefined) graphEntity.role = entity.role;
      if (entity.enrichedContext !== undefined) graphEntity.enrichedContext = entity.enrichedContext;

      const nodeId = await graphDB.storeEntity(graphEntity, { team });

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
    // Delegate to graph database if available (check both constructor-provided and lazy-initialized)
    const graphDB = this.graphDatabase || this.databaseManager?.graphDB;
    if (graphDB) {
      const {
        fromEntityName,
        toEntityName,
        fromEntityId,
        toEntityId,
        relationType,
        confidence = 1.0,
        team = 'coding',
        fromTeam,
        toTeam,
        metadata = {}
      } = relation;

      // Graph database uses entity names, not IDs
      const fromName = fromEntityName || fromEntityId;
      const toName = toEntityName || toEntityId;

      if (!fromName || !toName) {
        throw new Error('Relation requires fromEntityName/fromEntityId and toEntityName/toEntityId');
      }

      await graphDB.storeRelationship(fromName, toName, relationType, {
        team,
        // Forward optional cross-team scope for relations whose
        // endpoints live in different teams (e.g. the central
        // CollectiveKnowledge linking out to per-team Project nodes).
        ...(fromTeam ? { fromTeam } : {}),
        ...(toTeam ? { toTeam } : {}),
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
      process.stderr.write(`[KnowledgeQueryService] Failed to store relation: ${error?.message || error}\n`);
      throw error;
    }
  }

  // ------------------------------------------------------------------
  // km-core JSON-export fallback (Phase 42.2 Plan 04)
  //
  // GraphDatabaseService is retired and DatabaseManager.initializeGraphDB()
  // is a no-op. The VKB server (and any other consumer of this class)
  // would otherwise fall through to the SQLite `knowledge_extractions`
  // table — which was never created in the post-retirement DB schema —
  // and 500. To unblock the viewer without rebuilding the whole VKB
  // around km-core's GraphKMStore, we read the canonical JSON exports
  // written by the wave-controller into .data/knowledge-graph/exports/.
  // Each file is one team's full graph snapshot ({attributes, options,
  // nodes, edges}). Cached by mtime so repeated polling is cheap.
  // ------------------------------------------------------------------

  _getExportDir() {
    const graphRoot = this.databaseManager?.graphDbConfig?.path
      || path.join(process.cwd(), '.data', 'knowledge-graph');
    return path.join(graphRoot, 'exports');
  }

  _loadExports() {
    const dir = this._getExportDir();
    if (!fs.existsSync(dir)) return null;
    let files;
    try {
      files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    } catch {
      return null;
    }
    if (files.length === 0) return null;

    const result = [];
    for (const f of files) {
      const abs = path.join(dir, f);
      const team = path.basename(f, '.json');
      try {
        const stat = fs.statSync(abs);
        const cached = this._exportCache.get(abs);
        let parsed;
        if (cached && cached.mtimeMs === stat.mtimeMs) {
          parsed = cached.parsed;
        } else {
          parsed = JSON.parse(fs.readFileSync(abs, 'utf-8'));
          this._exportCache.set(abs, { mtimeMs: stat.mtimeMs, parsed });
        }
        result.push({
          team,
          nodes: Array.isArray(parsed?.nodes) ? parsed.nodes : [],
          edges: Array.isArray(parsed?.edges) ? parsed.edges : [],
        });
      } catch (err) {
        process.stderr.write(`[KnowledgeQueryService] Failed to read export ${f}: ${err?.message || err}\n`);
      }
    }
    return result;
  }

  _mapNodeToEntity(node, team) {
    const a = (node && node.attributes) || {};
    const subsystem = a.metadata && a.metadata.subsystem;
    const source = a.source
      || (subsystem === 'wave-analysis' || subsystem === 'online-pipeline' ? 'online' : 'manual');
    return {
      id: node?.key || a.id || null,
      entity_name: a.name || a.entity_name || null,
      entity_type: a.entityType || a.ontologyClass || a.entity_type || 'Unknown',
      observations: Array.isArray(a.observations) ? a.observations
        : (a.description ? [a.description] : []),
      extraction_type: a.extraction_type || null,
      classification: a.ontologyClass || a.classification || null,
      confidence: a.confidence != null ? a.confidence : 1.0,
      source,
      team: a.team || team,
      extracted_at: a.createdAt || a.extracted_at || null,
      last_modified: a.updatedAt || a.last_modified || a.createdAt || null,
      session_id: a.session_id || null,
      embedding_id: a.embedding_id || null,
      metadata: a.metadata || {},
      parentEntityName: a.parentEntityName || null,
      hierarchyLevel: a.hierarchyLevel != null ? a.hierarchyLevel : null,
      isScaffoldNode: a.isScaffoldNode || false,
      childEntityNames: Array.isArray(a.childEntityNames) ? a.childEntityNames : [],
      ...(a.embedding ? { embedding: a.embedding } : {}),
      ...(a.role ? { role: a.role } : {}),
      ...(a.layer ? { layer: a.layer } : {}),
    };
  }

  _mapEdgeToRelation(edge, team, idToName) {
    const a = (edge && edge.attributes) || {};
    const from = edge?.source || a.from || null;
    const to = edge?.target || a.to || null;
    return {
      id: edge?.key || null,
      from_entity_id: from,
      to_entity_id: to,
      relation_type: a.type || a.relation_type || 'unknown',
      confidence: a.confidence != null ? a.confidence : 1.0,
      team: a.team || team,
      created_at: (a.metadata && a.metadata.createdAt) || null,
      metadata: a.metadata || {},
      from_name: idToName.get(from) || null,
      to_name: idToName.get(to) || null,
    };
  }

  // Source 'auto' and 'online' are synonyms (see retired graphDB comment).
  _sourceMatches(filter, actual) {
    if (!filter) return true;
    const syn = (s) => (s === 'auto' || s === 'online') ? new Set(['auto', 'online']) : new Set([s]);
    return syn(filter).has(actual);
  }

  _queryEntitiesFromExports(options) {
    const exports = this._loadExports();
    if (!exports) return null;

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
      sortOrder = 'DESC',
    } = options;

    let entities = [];
    for (const ex of exports) {
      if (team && ex.team !== team) continue;
      for (const node of ex.nodes) {
        const e = this._mapNodeToEntity(node, ex.team);
        if (!e.entity_name) continue;
        if (!this._sourceMatches(source, e.source)) continue;
        if (types && types.length > 0 && !types.includes(e.entity_type)) continue;
        if (startDate && e.last_modified && e.last_modified < startDate) continue;
        if (endDate && e.last_modified && e.last_modified > endDate) continue;
        if (e.confidence < minConfidence) continue;
        if (searchTerm) {
          const term = String(searchTerm).toLowerCase();
          if (!String(e.entity_name).toLowerCase().includes(term)) continue;
        }
        entities.push(e);
      }
    }

    const safeSortBy = ['last_modified', 'extracted_at', 'confidence', 'entity_name'].includes(sortBy)
      ? sortBy : 'last_modified';
    const dir = String(sortOrder).toUpperCase() === 'ASC' ? 1 : -1;
    entities.sort((a, b) => {
      const av = a[safeSortBy] ?? '';
      const bv = b[safeSortBy] ?? '';
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });

    const start = Math.max(0, parseInt(offset, 10) || 0);
    const end = start + (Math.max(0, parseInt(limit, 10) || 0));
    return entities.slice(start, end);
  }

  _queryRelationsFromExports(options) {
    const exports = this._loadExports();
    if (!exports) return null;

    const {
      entityId = null,
      team = null,
      relationType = null,
      limit = 1000,
    } = options;

    let relations = [];
    for (const ex of exports) {
      if (team && ex.team !== team) continue;
      const idToName = new Map();
      for (const node of ex.nodes) {
        const a = (node && node.attributes) || {};
        const id = node?.key || a.id;
        if (id && a.name) idToName.set(id, a.name);
      }
      for (const edge of ex.edges) {
        const r = this._mapEdgeToRelation(edge, ex.team, idToName);
        if (entityId && r.from_entity_id !== entityId && r.to_entity_id !== entityId) continue;
        if (relationType && r.relation_type !== relationType) continue;
        relations.push(r);
      }
    }

    return relations.slice(0, Math.max(0, parseInt(limit, 10) || 0));
  }

  _getTeamsFromExports() {
    const exports = this._loadExports();
    if (!exports) return null;
    return exports.map(ex => {
      const lastModified = ex.nodes.reduce((max, n) => {
        const v = n?.attributes?.updatedAt || n?.attributes?.createdAt;
        return v && (!max || v > max) ? v : max;
      }, null);
      return {
        name: ex.team,
        displayName: ex.team.charAt(0).toUpperCase() + ex.team.slice(1),
        entityCount: ex.nodes.length,
        lastActivity: lastModified,
      };
    });
  }
}

export default KnowledgeQueryService;
