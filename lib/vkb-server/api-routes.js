/**
 * VKB Server API Routes
 *
 * Provides REST endpoints for querying knowledge from the database.
 * Used by the memory visualizer frontend to fetch entities and relations.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { KnowledgeQueryService } from '../../src/knowledge-management/KnowledgeQueryService.js';
import { UKBDatabaseWriter } from '../../src/knowledge-management/UKBDatabaseWriter.js';
import { createLogger } from '../logging/Logger.js';

const logger = createLogger('api');

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
    // Optional repo-root override for the DEDICATED experiment store
    // (.data/experiments/leveldb). Production leaves this null so
    // openExperimentStore() resolves CODING_REPO (=/coding in-container);
    // tests inject an isolated tmp root so the single-owner real store is
    // never opened/mutated. See handleScoreOverride (SCORE-02).
    this.experimentRepoRoot = options.experimentRepoRoot || null;
  }

  /**
   * Return a UKBDatabaseWriter for the given team, creating one on
   * demand if the team is not in the prebuilt set. This avoids the
   * silent fallback to 'coding' that previously caused PUTs for teams
   * like 'rapid-automations' or 'onboarding-repro' to land under the
   * wrong team scope.
   */
  _getWriter(team) {
    const t = team || 'coding';
    if (!this.writers[t]) {
      this.writers[t] = new UKBDatabaseWriter(this.databaseManager, { team: t, debug: this.debug });
    }
    return this.writers[t];
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

    // Experiment Score override (SCORE-02). Writes a per-dimension human
    // correction to the DEDICATED experiment store via applyOverride —
    // NEVER the shared KG (UKBDatabaseWriter). Override UI controls land in
    // Phase 74 (D-07); this ships the validated storage contract via API.
    app.patch('/api/experiments/scores/:taskId', (req, res) => this.handleScoreOverride(req, res));

    // Performance dashboard experiment read/write endpoints (Phase 74, DASH-01/02/03,
    // KB-04). Runs/Reports go through the DEDICATED experiment store (transient
    // open->operate->close-in-finally, honoring this.experimentRepoRoot in tests);
    // the timeline reads the proxy-owned token-usage.db read-only and NEVER opens
    // the experiment LevelDB (two-store boundary). NEVER route Runs through
    // /api/entities (that hits the shared KG — RESEARCH Pitfall 1).
    app.get('/api/experiments/runs', (req, res) => this.handleRunsQuery(req, res));
    app.delete('/api/experiments/runs', (req, res) => this.handleDeleteRuns(req, res));
    app.get('/api/experiments/runs/:taskId/timeline', (req, res) => this.handleTimeline(req, res));
    app.get('/api/experiments/runs/:taskId/reconciliation', (req, res) => this.handleReconciliation(req, res));
    app.get('/api/experiments/reports', (req, res) => this.handleReportsQuery(req, res));
    app.post('/api/experiments/reports', (req, res) => this.handleSaveReport(req, res));
    app.post('/api/experiments/reports/:id/refresh', (req, res) => this.handleRefreshReport(req, res));

    // Measurement lifecycle control (dashboard-only MVP). Start writes the active
    // span file the proxy reads to attribute tokens; Stop archives the span and
    // records a close-request marker (the heavy close — token-aggregate + judge +
    // writeRun/writeScore — runs host-side via scripts/measurement-stop.mjs).
    app.get('/api/experiments/measurement/active', (req, res) => this.handleMeasurementActive(req, res));
    app.post('/api/experiments/measurement/start', (req, res) => this.handleMeasurementStart(req, res));
    app.post('/api/experiments/measurement/stop', (req, res) => this.handleMeasurementStop(req, res));

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
      logger.debug('Registered all API routes');
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
        type = null,
        startDate = null,
        endDate = null,
        minConfidence = 0,
        limit = 1000,
        offset = 0,
        searchTerm = null,
        sortBy = 'last_modified',
        sortOrder = 'DESC'
      } = req.query;

      // Accept ?types=A,B,C (CSV) or ?type=A (single value) for filter
      const typesArray = types
        ? types.split(',').map((t) => t.trim()).filter(Boolean)
        : type
          ? [type]
          : null;

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
      logger.error('Entities query failed', { error: error.message });
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
      logger.error('Relations query failed', { error: error.message });
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
        fromTeam,
        toTeam,
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
        ...(fromTeam ? { fromTeam } : {}),
        ...(toTeam ? { toTeam } : {}),
        metadata
      });

      res.status(201).json({
        success: true,
        id: relationId,
        message: `Created relation: ${from} -> ${to}`
      });
    } catch (error) {
      logger.error('Create relation failed', { error: error.message });
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
        metadata = {},
        parentEntityName,
        hierarchyLevel,
        isScaffoldNode,
        childEntityNames,
        embedding,
        role,
        enrichedContext
      } = req.body;

      if (!name || !entityType) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'name and entityType are required'
        });
      }

      const writer = this._getWriter(team);
      const entityData = { name, entityType, observations, significance, metadata };
      if (parentEntityName !== undefined) entityData.parentEntityName = parentEntityName;
      if (hierarchyLevel !== undefined) entityData.hierarchyLevel = hierarchyLevel;
      if (isScaffoldNode !== undefined) entityData.isScaffoldNode = isScaffoldNode;
      if (childEntityNames !== undefined) entityData.childEntityNames = childEntityNames;
      if (embedding !== undefined) entityData.embedding = embedding;
      if (role !== undefined) entityData.role = role;
      if (enrichedContext !== undefined) entityData.enrichedContext = enrichedContext;
      const entityId = await writer.storeEntity(entityData);

      res.status(201).json({
        success: true,
        id: entityId,
        message: `Created entity: ${name}`
      });
    } catch (error) {
      logger.error('Create entity failed', { error: error.message });
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
        metadata = {},
        parentEntityName,
        hierarchyLevel,
        isScaffoldNode,
        childEntityNames,
        embedding,
        role,
        enrichedContext,
        source
      } = req.body;

      if (!entityType || !observations) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'entityType and observations are required'
        });
      }

      const writer = this._getWriter(team);
      const updates = { entityType, observations, significance, metadata };
      if (parentEntityName !== undefined) updates.parentEntityName = parentEntityName;
      if (hierarchyLevel !== undefined) updates.hierarchyLevel = hierarchyLevel;
      if (isScaffoldNode !== undefined) updates.isScaffoldNode = isScaffoldNode;
      if (childEntityNames !== undefined) updates.childEntityNames = childEntityNames;
      if (embedding !== undefined) updates.embedding = embedding;
      if (role !== undefined) updates.role = role;
      if (enrichedContext !== undefined) updates.enrichedContext = enrichedContext;
      if (source !== undefined) updates.source = source;
      const entityId = await writer.updateEntity(name, updates);

      res.status(200).json({
        success: true,
        id: entityId,
        message: `Updated entity: ${name}`
      });
    } catch (error) {
      logger.error('Update entity failed', { error: error.message });
      res.status(500).json({
        error: 'Failed to update entity',
        message: error.message
      });
    }
  }

  /**
   * PATCH /api/experiments/scores/:taskId
   * Apply a single per-dimension human override to a Run's Score (SCORE-02).
   * Body: { dimension, value, overridden_by }
   *
   * Writes corrected_<dimension> + overridden_by/overridden_at to the DEDICATED
   * experiment store via applyOverride (lib/experiments/score-write.mjs, 73-02),
   * PRESERVING all judged fields (D-06). The Score path opens the experiment
   * LevelDB transiently (open -> applyOverride -> close in finally) to honor the
   * single-owner constraint, and NEVER routes through UKBDatabaseWriter / the
   * shared KG. All input is validated BEFORE any store write (T-73-05-01/02/03):
   * unknown dimension, out-of-range value, and a missing/oversized overridden_by
   * are each rejected with 400. A missing Score for the taskId yields 404.
   */
  async handleScoreOverride(req, res) {
    try {
      const { taskId } = req.params;
      const { dimension, value, overridden_by } = req.body || {};

      // Allowlist the 5 LOCKED rubric dimensions (mirrors RUBRIC_DIMENSIONS in
      // score-write.mjs). Unknown names are rejected here before any write
      // (applyOverride also throws as defense-in-depth — T-73-05-02).
      const ALLOWED_DIMENSIONS = ['goal_achieved', 'code_quality', 'test_coverage', 'regressions', 'spec_drift'];
      if (!dimension || !ALLOWED_DIMENSIONS.includes(dimension)) {
        return res.status(400).json({
          error: 'Invalid dimension',
          message: `dimension is required and must be one of: ${ALLOWED_DIMENSIONS.join(', ')}`
        });
      }

      // value present and numeric (T-73-05-01).
      if (value === undefined || value === null || typeof value !== 'number' || Number.isNaN(value)) {
        return res.status(400).json({
          error: 'Invalid value',
          message: 'value is required and must be a number'
        });
      }

      // Range-check per dimension: regressions is binary (0|1); the other four
      // are continuous [0,1]. Out-of-range is rejected before any write.
      if (dimension === 'regressions') {
        if (value !== 0 && value !== 1) {
          return res.status(400).json({
            error: 'Value out of range',
            message: 'regressions must be 0 or 1'
          });
        }
      } else if (value < 0 || value > 1) {
        return res.status(400).json({
          error: 'Value out of range',
          message: `${dimension} must be between 0 and 1`
        });
      }

      // overridden_by: non-empty string with a sane length cap (T-73-05-03).
      if (typeof overridden_by !== 'string' || overridden_by.trim().length === 0) {
        return res.status(400).json({
          error: 'Invalid overridden_by',
          message: 'overridden_by is required and must be a non-empty string'
        });
      }
      if (overridden_by.length > 256) {
        return res.status(400).json({
          error: 'Invalid overridden_by',
          message: 'overridden_by must be at most 256 characters'
        });
      }

      // Open the DEDICATED experiment store transiently (single-owner LevelDB)
      // and apply the override, ALWAYS closing in finally. Dynamic import keeps
      // server boot decoupled from km-core. NOT UKBDatabaseWriter / shared KG.
      const { openExperimentStore } = await import('../experiments/store.mjs');
      const { applyOverride } = await import('../experiments/score-write.mjs');
      const store = await openExperimentStore(this.experimentRepoRoot ? { repoRoot: this.experimentRepoRoot } : {});
      try {
        const scoreId = await applyOverride(store, { taskId, dimension, value, by: overridden_by });
        return res.status(200).json({ success: true, taskId, dimension, id: scoreId });
      } finally {
        await store.close();
      }
    } catch (error) {
      // applyOverride throws when no Score exists for the taskId -> 404.
      if (error.message && error.message.includes('no Score found')) {
        return res.status(404).json({
          error: 'Score not found',
          message: error.message
        });
      }
      logger.error('Score override failed', { error: error.message });
      return res.status(500).json({
        error: 'Score override failed',
        message: error.message
      });
    }
  }

  /**
   * GET /api/experiments/runs?includePending=true (DASH-01)
   * Return every Run joined to its Score + Outcome from the DEDICATED experiment
   * store. Opens the single-owner LevelDB transiently (open -> readRuns -> close in
   * finally), honoring this.experimentRepoRoot for test isolation. Pending Runs are
   * excluded unless includePending=true (D-06). 500 on store error.
   */
  async handleRunsQuery(req, res) {
    try {
      const { openExperimentStore } = await import('../experiments/store.mjs');
      const { readRuns } = await import('../experiments/query.mjs');
      const store = await openExperimentStore(this.experimentRepoRoot ? { repoRoot: this.experimentRepoRoot } : {});
      try {
        const rows = await readRuns(store, { includePending: req.query.includePending === 'true' });
        return res.status(200).json({ rows });
      } finally {
        await store.close();
      }
    } catch (error) {
      logger.error('Runs query failed', { error: error.message });
      return res.status(500).json({
        error: 'Runs query failed',
        message: error.message
      });
    }
  }

  /**
   * DELETE /api/experiments/runs  { taskIds: string[] }
   * Delete one or more experiment runs (Run + joined Score/Outcome/Route) from
   * the DEDICATED experiment store. Mirrors handleRunsQuery's transient open →
   * mutate → close-in-finally pattern and the two-store boundary (NEVER routes
   * through /api/entities). Returns { deleted, notFound, entities }. 400 on a
   * missing/empty taskIds array; 500 on store error.
   */
  async handleDeleteRuns(req, res) {
    const taskIds = Array.isArray(req.body?.taskIds) ? req.body.taskIds : null;
    if (!taskIds || taskIds.length === 0) {
      return res.status(400).json({ error: 'taskIds (non-empty array) is required' });
    }
    try {
      const { openExperimentStore } = await import('../experiments/store.mjs');
      const { deleteRuns } = await import('../experiments/query.mjs');
      const store = await openExperimentStore(this.experimentRepoRoot ? { repoRoot: this.experimentRepoRoot } : {});
      try {
        const result = await deleteRuns(store, taskIds);
        return res.status(200).json(result);
      } finally {
        await store.close();
      }
    } catch (error) {
      logger.error('Run delete failed', { error: error.message });
      return res.status(500).json({ error: 'Run delete failed', message: error.message });
    }
  }

  /**
   * GET /api/experiments/runs/:taskId/timeline (DASH-02)
   * Return the per-turn / per-reasoning-step token timeline for one task_id,
   * read from the proxy-owned token-usage.db read-only via readTimeline. This
   * handler MUST NOT open the experiment LevelDB (two-store boundary). task_id is
   * bound as a `?` parameter inside readTimeline (T-74-04-01); a missing DB yields
   * a graceful empty array. 400 if taskId is missing.
   */
  async handleTimeline(req, res) {
    try {
      const { taskId } = req.params;
      if (!taskId || typeof taskId !== 'string' || taskId.trim().length === 0) {
        return res.status(400).json({
          error: 'Invalid taskId',
          message: 'taskId is required'
        });
      }
      const { readTimeline } = await import('../experiments/timeline-read.mjs');
      const timeline = await readTimeline(taskId);
      return res.status(200).json({ timeline });
    } catch (error) {
      logger.error('Timeline query failed', { error: error.message });
      return res.status(500).json({
        error: 'Timeline query failed',
        message: error.message
      });
    }
  }

  /**
   * GET /api/experiments/runs/:taskId/reconciliation (D-13)
   * Serve the per-span reconciliation.json VERBATIM so Phase 86's badge needs zero
   * backend work. Reads a FILE only (like handleTimeline) — MUST NOT open the
   * experiment LevelDB (two-store boundary). taskId is validated by _validTaskId
   * ([A-Za-z0-9._-], <=80) BEFORE the path build, so a `../` traversal is rejected
   * with 400 and the read can never escape .data/measurements/ (T-83-05-01). A span
   * with no reconciliation data is not an error: ENOENT → 200 with an empty shape
   * (graceful, matching handleMeasurementActive). 500 only on an unexpected read
   * failure.
   */
  async handleReconciliation(req, res) {
    try {
      const { taskId } = req.params;
      if (!this._validTaskId(taskId)) {
        return res.status(400).json({
          error: 'Invalid taskId',
          message: 'taskId is required'
        });
      }
      const filePath = path.join(this._dataDir(), 'measurements', taskId, 'reconciliation.json');
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        // Serve VERBATIM — parse-and-return, no re-shaping (D-13).
        return res.status(200).json(JSON.parse(raw));
      } catch (e) {
        if (e.code === 'ENOENT') {
          // Graceful-empty: a run without reconciliation data is not an error.
          return res.status(200).json({ reconciliation: null });
        }
        throw e;
      }
    } catch (error) {
      logger.error('Reconciliation read failed', { error: error.message });
      return res.status(500).json({
        error: 'Reconciliation read failed',
        message: error.message
      });
    }
  }

  /**
   * GET /api/experiments/reports (KB-04 / DASH-03)
   * List every saved Report (frozen snapshot deserialized). Transient experiment
   * store access (open -> readReports -> close in finally). 500 on store error.
   */
  async handleReportsQuery(req, res) {
    try {
      const { openExperimentStore } = await import('../experiments/store.mjs');
      const { readReports } = await import('../experiments/report-read.mjs');
      const store = await openExperimentStore(this.experimentRepoRoot ? { repoRoot: this.experimentRepoRoot } : {});
      try {
        const reports = await readReports(store);
        return res.status(200).json({ reports });
      } finally {
        await store.close();
      }
    } catch (error) {
      logger.error('Reports query failed', { error: error.message });
      return res.status(500).json({
        error: 'Reports query failed',
        message: error.message
      });
    }
  }

  /**
   * POST /api/experiments/reports (KB-04)
   * Save a Report idempotently. Body: { title, facetState, snapshotRows, reportId? }.
   * Validates title (non-empty, <=256), facetState (object), snapshotRows (array)
   * BEFORE any write (T-74-04-02). A reportId slug is accepted; if absent, a stable
   * slug is minted from the title. Transient experiment store access; 201 on success
   * with { reportId }; 400 on bad input; 500 on store error.
   */
  async handleSaveReport(req, res) {
    try {
      const body = req.body || {};
      const { title, facetState, snapshotRows } = body;

      // Validate title: non-empty string, <=256 chars.
      if (typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({
          error: 'Invalid title',
          message: 'title is required and must be a non-empty string'
        });
      }
      if (title.length > 256) {
        return res.status(400).json({
          error: 'Invalid title',
          message: 'title must be at most 256 characters'
        });
      }
      // Validate facetState: a plain object (the saved query).
      if (typeof facetState !== 'object' || facetState === null || Array.isArray(facetState)) {
        return res.status(400).json({
          error: 'Invalid facetState',
          message: 'facetState is required and must be an object'
        });
      }
      // Validate snapshotRows: an array (the frozen results).
      if (!Array.isArray(snapshotRows)) {
        return res.status(400).json({
          error: 'Invalid snapshotRows',
          message: 'snapshotRows is required and must be an array'
        });
      }

      // Derive a stable reportId slug if the caller did not supply one. The writer
      // is keyed on report_id (its idempotency key), NOT the km-core entity id.
      const reportId = (typeof body.reportId === 'string' && body.reportId.trim().length > 0)
        ? body.reportId.trim()
        : `report-${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'untitled'}`;

      const { openExperimentStore } = await import('../experiments/store.mjs');
      const { writeReport } = await import('../experiments/report-write.mjs');
      const store = await openExperimentStore(this.experimentRepoRoot ? { repoRoot: this.experimentRepoRoot } : {});
      try {
        // facetState is the saved query passed to readRuns on refresh; snapshotRows
        // are the frozen results the writer materializes from the current query.
        await writeReport(store, {
          report_id: reportId,
          name: title,
          query: facetState,
          createdBy: typeof body.createdBy === 'string' ? body.createdBy : null
        });
        return res.status(201).json({ reportId });
      } finally {
        await store.close();
      }
    } catch (error) {
      logger.error('Save report failed', { error: error.message });
      return res.status(500).json({
        error: 'Save report failed',
        message: error.message
      });
    }
  }

  /**
   * POST /api/experiments/reports/:id/refresh (DASH-03)
   * Re-run a saved Report's query and overwrite ONLY its snapshot + snapshot_frozen_at
   * (the explicit "Refresh" action). Transient experiment store access. 404 if the
   * report is absent (mapped from the writer's not-found Error); 500 on store error.
   */
  async handleRefreshReport(req, res) {
    try {
      const reportId = req.params.id;
      const { openExperimentStore } = await import('../experiments/store.mjs');
      const { refreshReport } = await import('../experiments/report-write.mjs');
      const store = await openExperimentStore(this.experimentRepoRoot ? { repoRoot: this.experimentRepoRoot } : {});
      try {
        await refreshReport(store, { report_id: reportId });
        return res.status(200).json({ reportId, refreshedAt: new Date().toISOString() });
      } finally {
        await store.close();
      }
    } catch (error) {
      // refreshReport throws when no Report carries the report_id -> 404.
      if (error.message && error.message.includes('no Report found')) {
        return res.status(404).json({
          error: 'Report not found',
          message: error.message
        });
      }
      logger.error('Refresh report failed', { error: error.message });
      return res.status(500).json({
        error: 'Refresh report failed',
        message: error.message
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Measurement lifecycle control (dashboard-only MVP).
  // ---------------------------------------------------------------------------

  /** Resolve the repo .data dir, container-safe (CODING_ROOT=/coding in the container). */
  _dataDir() {
    const repoRoot = this.experimentRepoRoot || process.env.CODING_ROOT || process.cwd();
    return path.join(repoRoot, '.data');
  }

  /**
   * task_id sanitization mirrors the proxy span gate ([A-Za-z0-9._-], <=80).
   * WR-07 (re-review): dot-only ids ('.', '..') match the charset but are path
   * navigation — '..' would resolve the read one level ABOVE .data/measurements/.
   * The proxy's sanitizeTaskId rejects them explicitly; so do we.
   */
  _validTaskId(id) {
    return typeof id === 'string' && id.length > 0 && id.length <= 80
      && /^[A-Za-z0-9._-]+$/.test(id) && id !== '.' && id !== '..';
  }

  /**
   * GET /api/experiments/measurement/active
   * Returns the active measurement span (read from .data/active-measurement.json),
   * or { active: false } when none is open. Read-only.
   */
  async handleMeasurementActive(req, res) {
    try {
      const activePath = path.join(this._dataDir(), 'active-measurement.json');
      try {
        const raw = await fs.readFile(activePath, 'utf8');
        const span = JSON.parse(raw);
        return res.status(200).json({ active: true, span });
      } catch (e) {
        if (e.code === 'ENOENT') return res.status(200).json({ active: false, span: null });
        throw e;
      }
    } catch (error) {
      logger.error('Measurement active read failed', { error: error.message });
      return res.status(500).json({ error: 'Measurement active read failed', message: error.message });
    }
  }

  /**
   * POST /api/experiments/measurement/start  { task_id, goal }
   * Writes .data/active-measurement.json so the proxy attributes tokens to task_id.
   * Refuses (409) if a span is already active. This mirrors scripts/measurement-start.mjs.
   */
  async handleMeasurementStart(req, res) {
    try {
      const { task_id, goal } = req.body || {};
      if (!this._validTaskId(task_id)) {
        return res.status(400).json({ error: 'Invalid task_id', message: 'task_id must match [A-Za-z0-9._-] and be 1–80 chars.' });
      }
      const activePath = path.join(this._dataDir(), 'active-measurement.json');
      try {
        await fs.access(activePath);
        const existing = JSON.parse(await fs.readFile(activePath, 'utf8'));
        return res.status(409).json({ error: 'Measurement already active', message: `A span is already active (task_id=${existing.task_id}). Stop it first.`, span: existing });
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      const span = {
        task_id,
        started_at: new Date().toISOString(),
        goal_sentence: typeof goal === 'string' && goal.trim() ? goal.trim() : '',
      };
      await fs.mkdir(this._dataDir(), { recursive: true });
      await fs.writeFile(activePath, JSON.stringify(span, null, 2));
      return res.status(201).json({ active: true, span });
    } catch (error) {
      logger.error('Measurement start failed', { error: error.message });
      return res.status(500).json({ error: 'Measurement start failed', message: error.message });
    }
  }

  /**
   * POST /api/experiments/measurement/stop  { task_class? }
   * Archives the active span to .data/measurements/<task_id>.json (stamps ended_at),
   * removes the active span, and records a .data/measurements/<task_id>.close-requested.json
   * marker. The HEAVY close (token-aggregate + judge + writeRun/writeScore) runs host-side;
   * the response returns the exact CLI command to finish scoring.
   */
  async handleMeasurementStop(req, res) {
    try {
      const { task_class } = req.body || {};
      const dataDir = this._dataDir();
      const activePath = path.join(dataDir, 'active-measurement.json');
      let span;
      try {
        span = JSON.parse(await fs.readFile(activePath, 'utf8'));
      } catch (e) {
        if (e.code === 'ENOENT') {
          return res.status(409).json({ error: 'No active measurement', message: 'There is no active measurement span to stop.' });
        }
        throw e;
      }
      const endedAt = new Date().toISOString();
      const archived = { ...span, ended_at: endedAt };
      const measDir = path.join(dataDir, 'measurements');
      await fs.mkdir(measDir, { recursive: true });
      await fs.writeFile(path.join(measDir, `${span.task_id}.json`), JSON.stringify(archived, null, 2));
      // close-request marker: signals the host-side close pipeline what task_class to apply.
      const marker = { task_id: span.task_id, task_class: typeof task_class === 'string' && task_class.trim() ? task_class.trim() : null, requested_at: endedAt, closed: false };
      await fs.writeFile(path.join(measDir, `${span.task_id}.close-requested.json`), JSON.stringify(marker, null, 2));
      await fs.rm(activePath, { force: true });
      const clsFlag = marker.task_class ? ` --task-class ${marker.task_class}` : '';
      return res.status(200).json({
        active: false,
        archived,
        close_command: `node scripts/measurement-stop.mjs${clsFlag}`,
        note: 'Span archived. Run close_command on the host to aggregate tokens, judge, and write the scored Run.',
      });
    } catch (error) {
      logger.error('Measurement stop failed', { error: error.message });
      return res.status(500).json({ error: 'Measurement stop failed', message: error.message });
    }
  }

  /**
   * DELETE /api/entities/:name?team=coding[&force=true]
   * Delete an entity. The underlying GraphDB protects "critical"
   * entities (Project, System) from accidental deletion. Pass
   * force=true to override — used by cleanup scripts that need to
   * remove cross-team leaks of System-typed entities.
   */
  async handleDeleteEntity(req, res) {
    try {
      const { name } = req.params;
      const { team = 'coding', force } = req.query;

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

      const forceDelete = force === 'true' || force === '1' || force === true;
      const result = await graphDB.deleteEntity(name, team, { force: forceDelete });

      res.status(200).json({
        success: result.success,
        deleted: result.deleted,
        team: result.team,
        message: `Deleted entity: ${name}`
      });
    } catch (error) {
      logger.error('Delete entity failed', { error: error.message });

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
      logger.error('Delete relation failed', { error: error.message });
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
      logger.error('Teams query failed', { error: error.message });
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
      logger.error('Stats query failed', { error: error.message });
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
      logger.error('Export failed', { error: error.message });
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
      logger.error('Advanced query failed', { error: error.message });
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
      logger.error('Cleanup relations by type failed', { error: error.message });
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
      logger.error('Ontology classes query failed', { error: error.message });
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
      logger.error('Entity types query failed', { error: error.message });
      res.status(500).json({
        error: 'Failed to query entity types',
        message: error.message
      });
    }
  }
}

export default ApiRoutes;
