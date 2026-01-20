/**
 * VKB Server API Routes
 *
 * Provides REST endpoints for querying knowledge from the database.
 * Used by the memory visualizer frontend to fetch entities and relations.
 */

import { KnowledgeQueryService } from '../../src/knowledge-management/KnowledgeQueryService.js';
import { UKBDatabaseWriter } from '../../src/knowledge-management/UKBDatabaseWriter.js';

export class ApiRoutes {
  constructor(databaseManager, options = {}) {
    this.databaseManager = databaseManager;
    // Pass graphDB as second argument (correct property name is graphDB, not graphDatabase)
    this.queryService = new KnowledgeQueryService(
      databaseManager,
      databaseManager?.graphDB || null,
      {
        debug: options.debug || false
      }
    );
    // Create UKB writers for each team
    this.writers = {};
    const teams = ['coding', 'ui', 'resi'];
    for (const team of teams) {
      this.writers[team] = new UKBDatabaseWriter(databaseManager, {
        team,
        debug: options.debug || false
      });
    }
    this.debug = options.debug || false;
  }

  /**
   * Register all API routes with Express app
   */
  registerRoutes(app) {
    // Health check endpoint
    app.get('/api/health', (req, res) => this.handleHealth(req, res));

    // Entity queries
    app.get('/api/entities', (req, res) => this.handleEntitiesQuery(req, res));

    // Entity mutations
    app.post('/api/entities', (req, res) => this.handleCreateEntity(req, res));
    app.put('/api/entities/:name', (req, res) => this.handleUpdateEntity(req, res));
    app.delete('/api/entities/:name', (req, res) => this.handleDeleteEntity(req, res));

    // Relations queries
    app.get('/api/relations', (req, res) => this.handleRelationsQuery(req, res));

    // Create relation
    app.post('/api/relations', (req, res) => this.handleCreateRelation(req, res));
    app.delete('/api/relations', (req, res) => this.handleDeleteRelation(req, res));

    // Teams listing
    app.get('/api/teams', (req, res) => this.handleTeamsQuery(req, res));

    // Statistics
    app.get('/api/stats', (req, res) => this.handleStatsQuery(req, res));

    // Export to JSON
    app.post('/api/export', (req, res) => this.handleExport(req, res));

    // Advanced query endpoint
    app.post('/api/query', (req, res) => this.handleAdvancedQuery(req, res));

    // Cleanup endpoint for bulk operations
    app.post('/api/cleanup/relations-by-type', (req, res) => this.handleCleanupRelationsByType(req, res));

    // Ontology endpoints
    app.get('/api/ontology/classes', (req, res) => this.handleOntologyClasses(req, res));
    app.get('/api/ontology/entity-types', (req, res) => this.handleEntityTypes(req, res));

    if (this.debug) {
      console.log('[ApiRoutes] Registered all API routes');
    }
  }

  /**
   * GET /api/health
   * Returns database connectivity status
   */
  async handleHealth(req, res) {
    try {
      const health = await this.databaseManager.getHealth();
      // Graph health can have two structures:
      // 1. From GraphDatabaseService.getHealth(): { status: 'healthy', graph: {...}, persistence: {...} }
      // 2. Fallback from DatabaseManager: { available: true/false, lastCheck, error }
      const graphAvailable =
        health.graph?.status === 'healthy' ||
        health.graph?.status === 'degraded' ||
        health.graph?.available === true;
      res.json({
        status: health.overall || 'degraded',
        sqlite: health.sqlite?.available || false,
        qdrant: health.qdrant?.available || false,
        graph: graphAvailable,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        message: error.message
      });
    }
  }

  /**
   * GET /api/entities?team=coding&source=auto&limit=1000&offset=0
   * Query entities with filters
   */
  async handleEntitiesQuery(req, res) {
    try {
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
      } = req.query;

      // Parse types array if provided
      const typesArray = types ? types.split(',').map(t => t.trim()) : null;

      const entities = await this.queryService.queryEntities({
        team,
        source,
        types: typesArray,
        startDate,
        endDate,
        minConfidence: parseFloat(minConfidence),
        limit: parseInt(limit),
        offset: parseInt(offset),
        searchTerm,
        sortBy,
        sortOrder
      });

      res.json({
        entities,
        count: entities.length,
        limit: parseInt(limit),
        offset: parseInt(offset)
      });
    } catch (error) {
      console.error('[ApiRoutes] Entities query failed:', error);
      res.status(500).json({
        error: 'Failed to query entities',
        message: error.message
      });
    }
  }

  /**
   * GET /api/relations?entityId=abc123&team=coding
   * Query relations for entities
   */
  async handleRelationsQuery(req, res) {
    try {
      const {
        entityId = null,
        team = null,
        relationType = null,
        limit = 1000
      } = req.query;

      const relations = await this.queryService.queryRelations({
        entityId,
        team,
        relationType,
        limit: parseInt(limit)
      });

      res.json({
        relations,
        count: relations.length
      });
    } catch (error) {
      console.error('[ApiRoutes] Relations query failed:', error);
      res.status(500).json({
        error: 'Failed to query relations',
        message: error.message
      });
    }
  }

  /**
   * POST /api/relations
   * Create a new relation between entities
   * Body: { from, to, type, confidence?, team? }
   */
  async handleCreateRelation(req, res) {
    try {
      const {
        from,
        to,
        type,
        confidence = 1.0,
        team = 'coding',
        metadata = {}
      } = req.body;

      if (!from || !to || !type) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'from, to, and type are required'
        });
      }

      const relationId = await this.queryService.storeRelation({
        fromEntityName: from,
        toEntityName: to,
        relationType: type,
        confidence,
        team,
        metadata
      });

      res.status(201).json({
        success: true,
        id: relationId,
        message: `Created relation: ${from} -> ${to}`
      });
    } catch (error) {
      console.error('[ApiRoutes] Create relation failed:', error);
      res.status(500).json({
        error: 'Failed to create relation',
        message: error.message
      });
    }
  }

  /**
   * POST /api/entities
   * Create a new entity
   */
  async handleCreateEntity(req, res) {
    try {
      const {
        name,
        entityType,
        observations = [],
        significance = 5,
        team = 'coding',
        metadata = {}
      } = req.body;

      if (!name || !entityType) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'name and entityType are required'
        });
      }

      const writer = this.writers[team] || this.writers['coding'];
      const entityId = await writer.storeEntity({
        name,
        entityType,
        observations,
        significance,
        metadata
      });

      res.status(201).json({
        success: true,
        id: entityId,
        message: `Created entity: ${name}`
      });
    } catch (error) {
      console.error('[ApiRoutes] Create entity failed:', error);
      res.status(500).json({
        error: 'Failed to create entity',
        message: error.message
      });
    }
  }

  /**
   * PUT /api/entities/:name
   * Update an existing entity
   */
  async handleUpdateEntity(req, res) {
    try {
      const { name } = req.params;
      const {
        entityType,
        observations,
        significance,
        team = 'coding',
        metadata = {}
      } = req.body;

      if (!entityType || !observations) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'entityType and observations are required'
        });
      }

      const writer = this.writers[team] || this.writers['coding'];
      const entityId = await writer.updateEntity(name, {
        entityType,
        observations,
        significance,
        metadata
      });

      res.status(200).json({
        success: true,
        id: entityId,
        message: `Updated entity: ${name}`
      });
    } catch (error) {
      console.error('[ApiRoutes] Update entity failed:', error);
      res.status(500).json({
        error: 'Failed to update entity',
        message: error.message
      });
    }
  }

  /**
   * DELETE /api/entities/:name?team=coding
   * Delete an entity
   */
  async handleDeleteEntity(req, res) {
    try {
      const { name } = req.params;
      const { team = 'coding' } = req.query;

      if (!name) {
        return res.status(400).json({
          error: 'Missing required parameter',
          message: 'Entity name is required'
        });
      }

      // Access GraphDB
      const graphDB = this.databaseManager.graphDB;
      if (!graphDB) {
        return res.status(503).json({
          error: 'Service unavailable',
          message: 'Graph database not available'
        });
      }

      // Use proper deleteEntity method with abstraction
      const result = await graphDB.deleteEntity(name, team);

      res.status(200).json({
        success: result.success,
        deleted: result.deleted,
        team: result.team,
        message: `Deleted entity: ${name}`
      });
    } catch (error) {
      console.error('[ApiRoutes] Delete entity failed:', error);

      // Check if entity not found
      if (error.message && error.message.includes('not found')) {
        return res.status(404).json({
          error: 'Entity not found',
          message: error.message
        });
      }

      res.status(500).json({
        error: 'Failed to delete entity',
        message: error.message
      });
    }
  }

  /**
   * DELETE /api/relations?from=EntityA&to=EntityB&team=coding&type=relation&all=false
   * Delete relationship(s) between entities
   */
  async handleDeleteRelation(req, res) {
    try {
      const {
        from,
        to,
        team = 'coding',
        type = null,
        all = false
      } = req.query;

      if (!from || !to) {
        return res.status(400).json({
          error: 'Missing required parameters',
          message: 'from and to entity names are required'
        });
      }

      // Access GraphDB directly for deletion
      const graphDB = this.databaseManager.graphDB;
      if (!graphDB) {
        return res.status(503).json({
          error: 'Service unavailable',
          message: 'Graph database not available'
        });
      }

      const fromId = `${team}:${from}`;
      const toId = `${team}:${to}`;

      // Check if both entities exist
      if (!graphDB.graph.hasNode(fromId) || !graphDB.graph.hasNode(toId)) {
        return res.status(404).json({
          error: 'Entities not found',
          message: `One or both entities not found: ${from}, ${to} (team: ${team})`
        });
      }

      const edges = graphDB.graph.edges(fromId, toId);
      if (edges.length === 0) {
        return res.status(404).json({
          error: 'No relationships found',
          message: `No relationship found from ${from} to ${to} (team: ${team})`
        });
      }

      // Determine which edges to delete
      let edgesToDelete = [];
      if (type) {
        // Delete all edges with specified type
        edgesToDelete = edges.filter(edge => {
          const attrs = graphDB.graph.getEdgeAttributes(edge);
          return attrs.type === type;
        });
        if (edgesToDelete.length === 0) {
          return res.status(404).json({
            error: 'No matching relationships',
            message: `No relationship of type '${type}' found from ${from} to ${to}`
          });
        }
      } else if (all === 'true' || all === true) {
        // Delete all edges between entities
        edgesToDelete = edges;
      } else {
        // Default: delete first edge only
        edgesToDelete = [edges[0]];
      }

      // Delete the edges
      const deletedEdges = [];
      for (const edgeId of edgesToDelete) {
        const attrs = graphDB.graph.getEdgeAttributes(edgeId);
        graphDB.graph.dropEdge(edgeId);
        deletedEdges.push({
          edgeId,
          type: attrs.type,
          attributes: attrs
        });
      }

      // Mark as dirty for persistence
      graphDB.isDirty = true;

      // Persist immediately
      if (graphDB.levelDB) {
        await graphDB._persistGraphToLevel();
      }

      // Emit deletion events
      for (const deleted of deletedEdges) {
        graphDB.emit('relationship:deleted', {
          team,
          from,
          to,
          type: deleted.type
        });
      }

      res.status(200).json({
        success: true,
        deleted: deletedEdges.length,
        from,
        to,
        team,
        edges: deletedEdges.map(e => ({ type: e.type, edgeId: e.edgeId })),
        message: `Deleted ${deletedEdges.length} relationship(s) from ${from} to ${to}`
      });
    } catch (error) {
      console.error('[ApiRoutes] Delete relation failed:', error);
      res.status(500).json({
        error: 'Failed to delete relation',
        message: error.message
      });
    }
  }

  /**
   * GET /api/teams
   * Get list of available teams with statistics
   */
  async handleTeamsQuery(req, res) {
    try {
      const teams = await this.queryService.getTeams();

      res.json({
        available: teams,
        count: teams.length
      });
    } catch (error) {
      console.error('[ApiRoutes] Teams query failed:', error);
      res.status(500).json({
        error: 'Failed to query teams',
        message: error.message
      });
    }
  }

  /**
   * GET /api/stats?team=coding
   * Get knowledge statistics
   */
  async handleStatsQuery(req, res) {
    try {
      const { team = null } = req.query;

      const stats = await this.queryService.getStatistics({ team });

      res.json(stats);
    } catch (error) {
      console.error('[ApiRoutes] Stats query failed:', error);
      res.status(500).json({
        error: 'Failed to get statistics',
        message: error.message
      });
    }
  }

  /**
   * POST /api/export
   * Export team data to JSON file
   * Body: { team, filePath }
   */
  async handleExport(req, res) {
    try {
      const { team, filePath } = req.body;

      if (!team || !filePath) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'team and filePath are required'
        });
      }

      // Use GraphDB to export
      if (!this.databaseManager.graphDB) {
        return res.status(500).json({
          error: 'GraphDB unavailable',
          message: 'Cannot export without GraphDB'
        });
      }

      const result = await this.databaseManager.graphDB.exportToJSON(team, filePath);

      res.json(result);
    } catch (error) {
      console.error('[ApiRoutes] Export failed:', error);
      res.status(500).json({
        error: 'Export failed',
        message: error.message
      });
    }
  }

  /**
   * POST /api/query
   * Advanced query with complex filters
   * Body: { filters: {...}, pagination: {...}, sort: {...} }
   */
  async handleAdvancedQuery(req, res) {
    try {
      const { filters = {}, pagination = {}, sort = {} } = req.body;

      const entities = await this.queryService.queryEntities({
        ...filters,
        limit: pagination.limit || 1000,
        offset: pagination.offset || 0,
        sortBy: sort.field || 'last_modified',
        sortOrder: sort.order || 'DESC'
      });

      const relations = filters.includeRelations
        ? await this.queryService.queryRelations({ team: filters.team })
        : [];

      res.json({
        entities,
        relations,
        pagination: {
          count: entities.length,
          limit: pagination.limit || 1000,
          offset: pagination.offset || 0
        }
      });
    } catch (error) {
      console.error('[ApiRoutes] Advanced query failed:', error);
      res.status(500).json({
        error: 'Advanced query failed',
        message: error.message
      });
    }
  }

  /**
   * POST /api/cleanup/relations-by-type
   * Delete all relations of a specific type (used for cleanup operations)
   * Body: { type, team? }
   */
  async handleCleanupRelationsByType(req, res) {
    try {
      const { type, team = null } = req.body;

      if (!type) {
        return res.status(400).json({
          error: 'Missing required field',
          message: 'type is required'
        });
      }

      // Access GraphDB directly
      const graphDB = this.databaseManager.graphDB;
      if (!graphDB) {
        return res.status(503).json({
          error: 'Service unavailable',
          message: 'Graph database not available'
        });
      }

      // Use the deleteRelationsByType method we added
      const result = await graphDB.deleteRelationsByType(type, { team });

      res.json({
        success: true,
        deleted: result.deleted,
        type,
        team: team || 'all',
        edges: result.edges,
        message: `Deleted ${result.deleted} relationship(s) of type '${type}'`
      });
    } catch (error) {
      console.error('[ApiRoutes] Cleanup relations by type failed:', error);
      res.status(500).json({
        error: 'Cleanup failed',
        message: error.message
      });
    }
  }

  /**
   * GET /api/ontology/classes
   * Get available ontology classes with counts
   * Returns both upper and lower ontology classes
   */
  async handleOntologyClasses(req, res) {
    try {
      const { team = null } = req.query;

      // Get all unique entity types from the graph as a proxy for ontology classes
      const graphDB = this.databaseManager.graphDB;
      if (!graphDB) {
        return res.status(503).json({
          error: 'Service unavailable',
          message: 'Graph database not available'
        });
      }

      const classCounts = {};
      const classDetails = {};

      graphDB.graph.forEachNode((nodeId, attributes) => {
        // Filter by team if specified
        if (team && attributes.team !== team) return;

        const entityType = attributes.entityType || 'Unknown';
        classCounts[entityType] = (classCounts[entityType] || 0) + 1;

        // Extract ontology metadata if available (check both top-level and nested in originalMetadata)
        const ontologyMeta = attributes.metadata?.ontology || attributes.metadata?.originalMetadata?.ontology;
        if (ontologyMeta && !classDetails[entityType]) {
          classDetails[entityType] = {
            ontologyName: ontologyMeta.ontologyName,
            classificationMethod: ontologyMeta.classificationMethod
          };
        }
      });

      // Format response
      const classes = Object.entries(classCounts).map(([name, count]) => ({
        name,
        count,
        ontologySource: classDetails[name]?.ontologyName || 'unknown',
        classificationMethod: classDetails[name]?.classificationMethod || 'legacy'
      })).sort((a, b) => b.count - a.count);

      res.json({
        classes,
        totalClasses: classes.length,
        team: team || 'all'
      });
    } catch (error) {
      console.error('[ApiRoutes] Ontology classes query failed:', error);
      res.status(500).json({
        error: 'Failed to query ontology classes',
        message: error.message
      });
    }
  }

  /**
   * GET /api/ontology/entity-types?team=coding
   * Get distinct entity types for filtering (simpler endpoint for dropdowns)
   */
  async handleEntityTypes(req, res) {
    try {
      const { team = null } = req.query;

      const graphDB = this.databaseManager.graphDB;
      if (!graphDB) {
        return res.status(503).json({
          error: 'Service unavailable',
          message: 'Graph database not available'
        });
      }

      const entityTypes = new Set();

      graphDB.graph.forEachNode((nodeId, attributes) => {
        if (team && attributes.team !== team) return;
        if (attributes.entityType) {
          entityTypes.add(attributes.entityType);
        }
      });

      // Return sorted list with 'All' option first
      const types = ['All', ...Array.from(entityTypes).sort()];

      res.json({
        entityTypes: types,
        count: types.length - 1, // Exclude 'All' from count
        team: team || 'all'
      });
    } catch (error) {
      console.error('[ApiRoutes] Entity types query failed:', error);
      res.status(500).json({
        error: 'Failed to query entity types',
        message: error.message
      });
    }
  }
}

export default ApiRoutes;
