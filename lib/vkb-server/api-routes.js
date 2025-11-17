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

    // Relations queries
    app.get('/api/relations', (req, res) => this.handleRelationsQuery(req, res));

    // Create relation
    app.post('/api/relations', (req, res) => this.handleCreateRelation(req, res));

    // Teams listing
    app.get('/api/teams', (req, res) => this.handleTeamsQuery(req, res));

    // Statistics
    app.get('/api/stats', (req, res) => this.handleStatsQuery(req, res));

    // Export to JSON
    app.post('/api/export', (req, res) => this.handleExport(req, res));

    // Advanced query endpoint
    app.post('/api/query', (req, res) => this.handleAdvancedQuery(req, res));

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
      // Graph health has different structure: { status, graph, persistence }
      const graphAvailable = health.graph?.status === 'healthy' || health.graph?.status === 'degraded';
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
}

export default ApiRoutes;
