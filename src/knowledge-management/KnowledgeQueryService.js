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
import { createLogger } from '../../lib/logging/Logger.js';

const logger = createLogger('KnowledgeQueryService');

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

  _getExportDirs() {
    // TWO source dirs since Phase 42.2 (the migration is partial):
    //   - .data/exports/        — legacy/canonical UKBDatabaseWriter +
    //                              ObservationConsolidator HTTP-API output;
    //                              entities/relations shape; team named after
    //                              filename (coding.json, resi.json, ui.json).
    //                              Frozen post-Phase-42.2 (last writer was the
    //                              retired graphDB) but tracked in git so it
    //                              still carries the rich KM-Core baseline:
    //                              full CK -> Project -> Component hierarchy,
    //                              manual + online sources, ~928 entities and
    //                              ~1124 relations as of the freeze.
    //   - .data/knowledge-graph/exports/ — wave-controller's km-core output;
    //                              nodes/edges shape (Graphology); writes go
    //                              to general.json by default because the
    //                              team field never reaches km-core (Phase 49
    //                              Gap 1). Sparse — typically <50 edges.
    //
    // Reading from BOTH gives the user the rich legacy hierarchy AND any new
    // wave-controller updates. Merging by entity name (with legacy as the
    // base) so a later wave-controller update can overlay attributes without
    // losing legacy relations.
    const graphRoot = this.databaseManager?.graphDbConfig?.path
      || path.join(process.cwd(), '.data', 'knowledge-graph');
    const dataRoot = path.dirname(graphRoot);
    return [
      { dir: path.join(dataRoot, 'exports'),           shape: 'legacy'  },
      { dir: path.join(graphRoot, 'exports'),          shape: 'km-core' },
    ];
  }

  // Back-compat: some callers (or future ones) may still ask for a single dir.
  _getExportDir() {
    return this._getExportDirs()[0].dir;
  }

  // Load all KB exports from BOTH source dirs, normalising each into a uniform
  // legacy-style envelope: { team, entities: [...legacy-entity...], relations:
  // [...legacy-relation...] }. Returns null if neither dir has anything.
  _loadExports() {
    const dirs = this._getExportDirs();
    const result = [];
    for (const { dir, shape } of dirs) {
      if (!fs.existsSync(dir)) continue;
      let files;
      try {
        files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      } catch {
        continue;
      }
      for (const f of files) {
        const abs = path.join(dir, f);
        const fallbackTeam = path.basename(f, '.json');
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
          // km-core's general.json is the unattributed-team default bucket;
          // post-Phase-49 every entity should land in its real team's file.
          // Until that fix, treat km-core general as 'coding' so name-matches
          // against the rich legacy coding.json collapse the ~727 duplicates
          // (the wave-controller re-discovered entities that already exist)
          // and the duplicated entities pick up the legacy file's relations.
          const explicitTeam = parsed?.metadata?.team;
          const team = explicitTeam
            || (shape === 'km-core' && fallbackTeam === 'general' ? 'coding' : fallbackTeam);
          result.push({
            team,
            shape,
            entities: this._normaliseEntities(parsed, shape, team),
            relations: this._normaliseRelations(parsed, shape, team),
          });
        } catch (err) {
          logger.warn(`Failed to read export ${f}`, { error: err?.message || String(err) });
        }
      }
    }
    if (result.length === 0) return null;
    // Special case: a file ALWAYS named "general.json" written by the km-core
    // path doesn't represent a team — it's the unattributed-domain bucket
    // (wave-controller writes that never had a team threaded). Surface them
    // under their actual team if known; otherwise label them "general" so
    // the existing legend doesn't break.
    return result;
  }

  // Convert a parsed export into legacy { name, entityType, observations,
  // source, team, metadata, ... } entity records regardless of shape.
  _normaliseEntities(parsed, shape, team) {
    if (shape === 'legacy') {
      return Array.isArray(parsed?.entities) ? parsed.entities.map(e => ({
        ...e,
        team: e.team || team,
      })) : [];
    }
    // km-core: nodes are { key, attributes: { name, entityType, metadata, ... } }
    if (!Array.isArray(parsed?.nodes)) return [];
    return parsed.nodes.map(n => {
      const a = n.attributes || {};
      const subsystem = (a.metadata && a.metadata.subsystem) || null;
      let source = a.source;
      if (!source) {
        if (subsystem === 'wave-analysis')         source = 'manual';
        else if (subsystem === 'online-pipeline')  source = 'online';
        else                                       source = 'manual';
      }
      return {
        id: n.key || a.id || null,
        name: a.name || null,
        entityType: a.entityType || a.ontologyClass || 'Unknown',
        observations: Array.isArray(a.observations) ? a.observations
          : (a.description ? [a.description] : []),
        significance: a.significance || null,
        source,
        team: a.team || team,
        metadata: {
          ...(a.metadata || {}),
          ...(a.createdAt ? { created_at: a.createdAt } : {}),
          ...(a.updatedAt ? { last_updated: a.updatedAt } : {}),
        },
        ...(a.parentEntityName !== undefined ? { parentEntityName: a.parentEntityName } : {}),
        ...(a.hierarchyLevel != null ? { hierarchyLevel: a.hierarchyLevel } : {}),
        ...(a.isScaffoldNode ? { isScaffoldNode: a.isScaffoldNode } : {}),
        ...(Array.isArray(a.childEntityNames) ? { childEntityNames: a.childEntityNames } : {}),
        ...(a.embedding ? { embedding: a.embedding } : {}),
        ...(a.role ? { role: a.role } : {}),
        ...(a.layer ? { layer: a.layer } : {}),
      };
    });
  }

  // Convert a parsed export's relations into a uniform { from, to,
  // relationType, metadata } shape with names (not ids).
  _normaliseRelations(parsed, shape, team) {
    if (shape === 'legacy') {
      return Array.isArray(parsed?.relations) ? parsed.relations.map(r => ({
        ...r,
        team: r.team || team,
      })) : [];
    }
    // km-core edges reference UUIDs in source/target → resolve via nodes list.
    const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
    const idToName = new Map();
    for (const n of nodes) {
      const id = n.key || n.attributes?.id;
      const name = n.attributes?.name;
      if (id && name) idToName.set(id, name);
    }
    if (!Array.isArray(parsed?.edges)) return [];
    return parsed.edges.map(e => {
      const a = e.attributes || {};
      const fromName = idToName.get(e.source || a.from) || null;
      const toName = idToName.get(e.target || a.to) || null;
      return {
        from: fromName,
        to: toName,
        relationType: a.type || a.relation_type || 'unknown',
        metadata: a.metadata || {},
        team: a.team || team,
      };
    });
  }

  // Convert a normalised legacy-shape entity record into the public API
  // shape the VKB frontend expects (snake_case-ish, entity_name / entity_type
  // / observations / source / team / metadata / hierarchy fields).
  _mapNodeToEntity(entity, team) {
    const m = entity.metadata || {};
    return {
      id: entity.id || null,
      entity_name: entity.name || null,
      entity_type: entity.entityType || 'Unknown',
      observations: Array.isArray(entity.observations) ? entity.observations : [],
      extraction_type: entity.extraction_type || entity.extractionType || null,
      classification: entity.classification || entity.entityType || null,
      confidence: entity.confidence != null ? entity.confidence
        : (entity.significance != null ? entity.significance : 1.0),
      source: entity.source || 'manual',
      team: entity.team || team,
      extracted_at: m.created_at || m.createdAt || entity.extracted_at || null,
      last_modified: m.last_updated || m.updatedAt || entity.last_modified || m.created_at || null,
      session_id: entity.session_id || null,
      embedding_id: entity.embedding_id || null,
      metadata: m,
      parentEntityName: entity.parentEntityName || null,
      hierarchyLevel: entity.hierarchyLevel != null ? entity.hierarchyLevel : null,
      isScaffoldNode: entity.isScaffoldNode || false,
      childEntityNames: Array.isArray(entity.childEntityNames) ? entity.childEntityNames : [],
      ...(entity.embedding ? { embedding: entity.embedding } : {}),
      ...(entity.role ? { role: entity.role } : {}),
      ...(entity.layer ? { layer: entity.layer } : {}),
    };
  }

  _mapEdgeToRelation(relation, team) {
    return {
      id: relation.id || null,
      from_entity_id: relation.from || null,
      to_entity_id: relation.to || null,
      relation_type: relation.relationType || relation.relation_type || 'unknown',
      confidence: relation.confidence != null ? relation.confidence : 1.0,
      team: relation.team || team,
      created_at: (relation.metadata && relation.metadata.createdAt) || null,
      metadata: relation.metadata || {},
      from_name: relation.from || null,
      to_name: relation.to || null,
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

    // Merge across BOTH source dirs by (team, entity_name). Process
    // km-core FIRST so legacy can OVERLAY same-named duplicates — the
    // legacy file carries the authoritative source distinction
    // ('online' vs 'manual') that the km-core path lost when it stamped
    // every wave-analysis re-discovery as 'manual'. For names that only
    // exist in km-core (the ~73 truly-new wave-analysis entities), the
    // km-core value remains.
    const ordered = [
      ...exports.filter(ex => ex.shape !== 'legacy'),
      ...exports.filter(ex => ex.shape === 'legacy'),
    ];
    const merged = new Map(); // key: `${team}:${name}` → mapped entity
    for (const ex of ordered) {
      if (team && ex.team !== team) continue;
      for (const ent of ex.entities) {
        const e = this._mapNodeToEntity(ent, ex.team);
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
        const key = `${e.team}:${e.entity_name}`;
        merged.set(key, e); // later writes overlay earlier — km-core overlays legacy
      }
    }
    let entities = [...merged.values()];

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

    // Merge across both source dirs by (team, from, to, relationType).
    // Same precedence as entities: legacy first, km-core overlays.
    const ordered = [
      ...exports.filter(ex => ex.shape === 'legacy'),
      ...exports.filter(ex => ex.shape !== 'legacy'),
    ];
    const merged = new Map();
    for (const ex of ordered) {
      if (team && ex.team !== team) continue;
      for (const rel of ex.relations) {
        const r = this._mapEdgeToRelation(rel, ex.team);
        if (!r.from_name || !r.to_name) continue; // skip orphaned edges (km-core nodes pruned)
        if (entityId && r.from_name !== entityId && r.to_name !== entityId) continue;
        if (relationType && r.relation_type !== relationType) continue;
        const key = `${r.team}:${r.from_name}:${r.relation_type}:${r.to_name}`;
        merged.set(key, r);
      }
    }
    const relations = [...merged.values()];

    return relations.slice(0, Math.max(0, parseInt(limit, 10) || 0));
  }

  _getTeamsFromExports() {
    const exports = this._loadExports();
    if (!exports) return null;
    // Aggregate by team across BOTH dirs. Count is the UNION (de-duplicated
    // by entity name) so it matches what /api/entities returns rather than
    // showing a per-file max (legacy 928) that contradicts the deduped union
    // (1001 = 928 + 73 unique km-core additions).
    const byTeam = new Map(); // team → { names: Set, lastActivity }
    for (const ex of exports) {
      let lastActivity = null;
      let entry = byTeam.get(ex.team);
      if (!entry) {
        entry = { names: new Set(), lastActivity: null };
        byTeam.set(ex.team, entry);
      }
      for (const e of ex.entities) {
        if (e.name) entry.names.add(e.name);
        const v = e.metadata?.last_updated || e.metadata?.updatedAt
              || e.metadata?.created_at || e.metadata?.createdAt;
        if (v && (!lastActivity || v > lastActivity)) lastActivity = v;
      }
      if (lastActivity && (!entry.lastActivity || lastActivity > entry.lastActivity)) {
        entry.lastActivity = lastActivity;
      }
    }
    return [...byTeam.entries()].map(([name, info]) => ({
      name,
      displayName: name.charAt(0).toUpperCase() + name.slice(1),
      entityCount: info.names.size,
      lastActivity: info.lastActivity,
    }));
  }
}

export default KnowledgeQueryService;
