/**
 * VKB Server API Routes
 *
 * Provides REST endpoints for querying knowledge from the database.
 * Used by the memory visualizer frontend to fetch entities and relations.
 */

import { KnowledgeQueryService } from '../../src/knowledge-management/KnowledgeQueryService.js';

export class ApiRoutes {
  constructor(databaseManager, options = {}) {
    this.databaseManager = databaseManager;
    this.queryService = new KnowledgeQueryService(databaseManager, {
      debug: options.debug || false
    });
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

    // Relations queries
    app.get('/api/relations', (req, res) => this.handleRelationsQuery(req, res));

    // Teams listing
    app.get('/api/teams', (req, res) => this.handleTeamsQuery(req, res));

    // Statistics
    app.get('/api/stats', (req, res) => this.handleStatsQuery(req, res));

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
      const health = this.databaseManager.getHealth();
      res.json({
        status: health.overall ? 'healthy' : 'degraded',
        sqlite: health.sqlite.available,
        qdrant: health.qdrant.available,
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
