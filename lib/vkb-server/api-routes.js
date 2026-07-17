/**
 * VKB Server API Routes
 *
 * Provides REST endpoints for querying knowledge from the database.
 * Used by the memory visualizer frontend to fetch entities and relations.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { KnowledgeQueryService } from '../../src/knowledge-management/KnowledgeQueryService.js';
import { UKBDatabaseWriter } from '../../src/knowledge-management/UKBDatabaseWriter.js';
import { createLogger } from '../logging/Logger.js';

const logger = createLogger('api');

const gunzip = promisify(zlib.gunzip);

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
    app.get('/api/experiments/runs/:taskId/context-turns', (req, res) => this.handleContextTurns(req, res));
    // Live variant comparison (Phase 80, CMP-04). Opens the experiment store
    // transiently (open -> readRuns -> buildComparison -> close-in-finally) and
    // returns the FROZEN Phase 79 report JSON for a task_hash — the same shape the
    // CLI writes to .data/experiments/reports/<task_hash>.json (shared gate_outcome
    // stamping via withGateOutcomes). task_hash is validated BEFORE opening the store.
    app.get('/api/experiments/comparison', (req, res) => this.handleComparison(req, res));
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

    // Experiment Control Center run lifecycle (Phase 85-04, D-01/D-02/D-04/D-08/D-09).
    // POST /run enforces the dual-source single-slot 409 (interactive span OR a
    // live experiment run) then DELEGATES the detached spawn to the host
    // coordinator seam (:3034) — the container has only `node`, no agent CLIs
    // (Pitfall 4). GET /run-status/:runId serves progress.json VERBATIM as a pure
    // bind-mounted file read (never opens the experiment LevelDB — Pitfall 6).
    // POST /run-cancel delegates the negated-pid group-kill to the same seam.
    // GET /specs previews the resolved variant matrix (D-09).
    app.post('/api/experiments/run', (req, res) => this.handleExperimentRun(req, res));
    // Phase 87-07 (CR-02/CR-03): the axes-aware fork PREVIEW. Synthesizes-and-counts the
    // avenue matrix from origin_span_id + forkAxes WITHOUT persisting a spec, touching the
    // coordinator, or launching a run — so the launcher's count preview stays SERVER-resolved
    // (D-09) and honest (not the origin spec's static YAML metadata).
    app.post('/api/experiments/fork-preview', (req, res) => this.handleExperimentForkPreview(req, res));
    app.get('/api/experiments/run-status/:runId', (req, res) => this.handleRunStatus(req, res));
    app.post('/api/experiments/run-cancel', (req, res) => this.handleRunCancel(req, res));
    app.get('/api/experiments/specs', (req, res) => this.handleSpecList(req, res));

    // Branch-avenue merge-status / promote / prune (Phase 87-04, AVN-08/AVN-09). These PROXY to
    // the host coordinator seam (:3034) — every state-changing git op (promote/prune) MUST run
    // host-side, NEVER in this container (Pitfall 6). The container layer only forwards the
    // { task_id } body and returns the coordinator's JSON verbatim; NO git argv lives here.
    app.post('/api/experiments/avenue-merge-status', (req, res) => this.handleAvenueMergeStatus(req, res));
    app.post('/api/experiments/avenue-promote', (req, res) => this.handleAvenuePromote(req, res));
    app.post('/api/experiments/avenue-prune', (req, res) => this.handleAvenuePrune(req, res));

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
   * GET /api/experiments/comparison?task_hash=X&rank_by= (Phase 80, CMP-04)
   * Compute the FROZEN Phase 79 variant comparison for one task_hash live from the
   * DEDICATED experiment store, so the dashboard Comparison tab fetches the exact
   * same report the CLI writes to .data/experiments/reports/<task_hash>.json.
   *
   * Mirrors handleRunsQuery's transient open -> readRuns -> close-in-finally idiom
   * (honoring this.experimentRepoRoot for test isolation), adding a buildComparison
   * call + the SHARED gate_outcome stamping (withGateOutcomes / GROUP_GATE_OUTCOME
   * imported from ../experiments/compare.mjs — the single source of truth, so the
   * response deep-equals the CLI writeReportJson doc; no schema drift).
   *
   * task_hash is validated with the reused sanitizeTaskHash allowlist and returns a
   * 400 BEFORE the store is opened (T-80-01-01) — the route writes no filename, so
   * traversal has no sink, but validation is enforced anyway. rank_by defaults to
   * 'composite'. Open ONLY via openExperimentStore (it sets ontologyDir); never
   * construct a km-core store by hand (CLAUDE.md km-core rule).
   */
  async handleComparison(req, res) {
    // Validate task_hash BEFORE opening the store (early-400, mirroring
    // handleReconciliation's _validTaskId guard) — reuse the CLI's allowlist.
    const taskHash = req.query.task_hash;
    try {
      const { sanitizeTaskHash } = await import('../experiments/compare.mjs');
      sanitizeTaskHash(taskHash);
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid task_hash',
        message: error.message
      });
    }
    const rankBy = req.query.rank_by || 'composite';
    try {
      const { openExperimentStore } = await import('../experiments/store.mjs');
      const { readRuns } = await import('../experiments/query.mjs');
      const { buildComparison, withGateOutcomes, GROUP_GATE_OUTCOME } =
        await import('../experiments/compare.mjs');
      const store = await openExperimentStore(this.experimentRepoRoot ? { repoRoot: this.experimentRepoRoot } : {});
      try {
        const rows = await readRuns(store);
        const report = buildComparison(rows, { taskHash, rankBy });
        // Shape the response EXACTLY like the CLI writeReportJson doc (frozen
        // Phase 79 schema): task_hash, rank_by, generated_at, and the four
        // gate_outcome-stamped group arrays.
        const doc = {
          task_hash: report.taskHash ?? taskHash,
          rank_by: report.rankBy ?? rankBy,
          generated_at: new Date().toISOString(),
          ranked: withGateOutcomes(report.ranked, GROUP_GATE_OUTCOME.ranked),
          failed: withGateOutcomes(report.failed, GROUP_GATE_OUTCOME.failed),
          ungated: withGateOutcomes(report.ungated, GROUP_GATE_OUTCOME.ungated),
          unscored: withGateOutcomes(report.unscored, GROUP_GATE_OUTCOME.unscored),
        };
        return res.status(200).json(doc);
      } finally {
        await store.close();
      }
    } catch (error) {
      logger.error('Comparison query failed', { error: error.message });
      return res.status(500).json({
        error: 'Comparison query failed',
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
      const { readTimeline, readAmbientBackground } = await import('../experiments/timeline-read.mjs');
      const timeline = await readTimeline(taskId);
      // OPTION 2: concurrent background (knowledge/infra) activity in this run's
      // wall-clock window, NON-attributed. AGENT-AGNOSTIC: the window is supplied by
      // the caller (from/to query params derived from the run's started_at/ended_at
      // via runWindow), because non-opencode agents (claude/copilot/mastra) barely
      // tag foreground rows with task_id — so a timeline-derived window would be
      // empty for them. We fall back to the timeline min/max only when no window is
      // supplied. This handler MUST NOT open the experiment LevelDB (two-store
      // boundary), so the run's timestamps arrive as query params, not by DB read.
      const isIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
      let winFrom = isIso(req.query.from) ? req.query.from : null;
      let winTo = isIso(req.query.to) ? req.query.to : null;
      if (!winFrom || !winTo) {
        const stamps = [];
        for (const p of timeline) {
          if (p.timestamp) stamps.push(p.timestamp);
          for (const c of (p.children || [])) if (c.timestamp) stamps.push(c.timestamp);
        }
        stamps.sort();
        if (stamps.length) {
          winFrom = winFrom || stamps[0];
          winTo = winTo || stamps[stamps.length - 1];
        }
      }
      const ambient = (winFrom && winTo)
        ? await readAmbientBackground(taskId, winFrom, winTo)
        : [];
      return res.status(200).json({ timeline, ambient });
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
   * GET /api/experiments/runs/:taskId/context-turns (D-10)
   * Serve the per-span context-turns array VERBATIM so the cache explainer
   * (Plan 84-08) needs zero backend re-shaping. Cloned from handleReconciliation:
   * reads a FILE only (like handleTimeline) — MUST NOT open the experiment
   * LevelDB (two-store boundary). taskId is validated by _validTaskId
   * ([A-Za-z0-9._-], <=80) BEFORE the path build, so a `../` traversal is
   * rejected with 400 and the read can never escape .data/measurements/
   * (T-84-07-01).
   *
   * The proxy appends a plaintext context-turns.jsonl per measured request
   * (Plan 84-04) and gzips it to context-turns.jsonl.gz at span close (Plan
   * 84-05). This route prefers the `.gz` (gunzip → split lines → JSON.parse
   * each) and falls back to the plaintext `.jsonl` when the span is not yet
   * closed. When NEITHER file exists the span simply has no per-turn data —
   * that is not an error: return 200 with an empty array (graceful, D-10),
   * NEVER 500. 500 only on an unexpected read/decompress failure.
   */
  async handleContextTurns(req, res) {
    try {
      const { taskId } = req.params;
      if (!this._validTaskId(taskId)) {
        return res.status(400).json({
          error: 'Invalid taskId',
          message: 'taskId is required'
        });
      }
      const baseDir = path.join(this._dataDir(), 'measurements', taskId);
      const gzPath = path.join(baseDir, 'context-turns.jsonl.gz');
      const jsonlPath = path.join(baseDir, 'context-turns.jsonl');

      // Prefer the gzipped file (written at span close); fall back to plaintext
      // (span still open). Read the RAW buffer so gunzip gets bytes, not a
      // decoded string.
      let text;
      try {
        const gzBuf = await fs.readFile(gzPath);
        const buf = await gunzip(gzBuf);
        text = buf.toString('utf8');
      } catch (eGz) {
        if (eGz.code !== 'ENOENT') throw eGz;
        try {
          text = await fs.readFile(jsonlPath, 'utf8');
        } catch (eJsonl) {
          if (eJsonl.code === 'ENOENT') {
            // Graceful-empty: a span without per-turn data is not an error.
            return res.status(200).json({ contextTurns: [] });
          }
          throw eJsonl;
        }
      }

      // Serve VERBATIM — split on newlines, parse each non-empty line, no
      // re-shaping (D-10). One JSONL line == one context turn.
      const contextTurns = text
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line));
      return res.status(200).json({ contextTurns });
    } catch (error) {
      logger.error('Context-turns read failed', { error: error.message });
      return res.status(500).json({
        error: 'Context-turns read failed',
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

  /** Resolve the repo root, container-safe (CODING_ROOT=/coding in the container). */
  _repoRoot() {
    return this.experimentRepoRoot || process.env.CODING_ROOT || process.cwd();
  }

  /**
   * run_id sanitization for the Experiment Control Center (Phase 85-04). The
   * run_id becomes a run-dir path segment AND the composeTaskId salt, so it MUST
   * be short + path-safe. Charset [A-Za-z0-9._-], length ≤ 12 — mirrors the
   * host-side RUN_ID_RE in scripts/experiment-run.mjs (T-85-01-01 / T-85-04-01).
   * A `.`/`..` id matches the charset but is path navigation — reject explicitly
   * so `..` can never escape .data/experiments/runs/.
   */
  _validRunId(id) {
    return typeof id === 'string' && id.length > 0 && id.length <= 12
      && /^[A-Za-z0-9._-]+$/.test(id) && id !== '.' && id !== '..';
  }

  /**
   * The host coordinator base URL (Plan-03 experiment-executor seam). In the
   * container this is host.docker.internal:3034 (wired via HEALTH_COORDINATOR_URL
   * in docker-compose). Falls back to the same default the compose file sets so a
   * bare `node` host run still targets the right port.
   */
  _coordinatorUrl() {
    return (process.env.HEALTH_COORDINATOR_URL || 'http://host.docker.internal:3034').replace(/\/+$/, '');
  }

  /**
   * POST a JSON body to a coordinator seam path and return the parsed response.
   * The fetch is injectable (this._coordinatorFetch) so endpoint tests exercise
   * the delegation WITHOUT firing real HTTP. NEVER spawns/kills in-container —
   * the container has only `node`, no agent CLIs (Pitfall 4).
   */
  async _coordinatorPost(seamPath, body) {
    const doFetch = this._coordinatorFetch || fetch;
    const url = `${this._coordinatorUrl()}${seamPath}`;
    const resp = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, json };
  }

  /**
   * List the server-known experiment specs (config/experiments/*.yaml). Used
   * both by handleSpecList and to validate a launch's requested spec is a MEMBER
   * of this set (T-85-04-02: never forward a raw client path to the host spawn).
   */
  async _listSpecFiles() {
    const specDir = path.join(this._repoRoot(), 'config', 'experiments');
    let entries;
    try {
      entries = await fs.readdir(specDir);
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
    return entries.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  }

  /**
   * POST /api/experiments/run  { spec, overrides? }
   * D-02 dual-source single-slot 409 guard, spec+override validation, then
   * DELEGATE the detached host spawn to the coordinator seam. Returns
   * 200 { run_id, pid } on a clean slot. The live-run check is a PURE file+pid
   * read (progress.json + process.kill(pid, 0)) — it NEVER opens the experiment
   * LevelDB store (Pitfall 6 — lock contention during a live run).
   */
  async handleExperimentRun(req, res) {
    try {
      // WR-01 (Phase 85 REVIEW): the launcher POSTs `rerun_of` as a TOP-LEVEL body field
      // (performanceSlice.ts), not inside `overrides`. Read it here so D-05 re-run provenance
      // reaches the runner argv (--rerun-of) and persists on Run.metadata.rerun_of.
      const { spec, overrides, rerun_of, origin_span_id, forkAxes } = req.body || {};

      // 409 source #1 — an active measurement span holds the slot. Distinguish an
      // EXPERIMENT CELL span (measurement-start stamps meta.variant/meta.repeat on
      // every cell span) from a genuinely interactive span: telling an operator to
      // "Stop it first" for a cell the RUNNER owns is wrong advice (Phase 85-06
      // live-gate feedback — the message must point at the run, not Measurement
      // Control).
      const activePath = path.join(this._dataDir(), 'active-measurement.json');
      try {
        const existing = JSON.parse(await fs.readFile(activePath, 'utf8'));
        const isCellSpan = existing?.meta && (existing.meta.variant !== undefined || existing.meta.repeat !== undefined);
        if (isCellSpan) {
          return res.status(409).json({
            error: 'Slot busy',
            message: `An experiment cell is measuring (task_id=${existing.task_id}). Wait for the run to finish or cancel it.`,
            holder: { kind: 'experiment', task_id: existing.task_id, variant: existing.meta.variant ?? null },
          });
        }
        return res.status(409).json({
          error: 'Slot busy',
          message: `An interactive measurement span is active (task_id=${existing.task_id}). Stop it first.`,
          holder: { kind: 'interactive', task_id: existing.task_id },
        });
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }

      // 409 source #2 — a live experiment run holds the slot (files + pid ONLY).
      const runsDir = path.join(this._dataDir(), 'experiments', 'runs');
      let runIds = [];
      try {
        runIds = await fs.readdir(runsDir);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      for (const rid of runIds) {
        let prog;
        try {
          prog = JSON.parse(await fs.readFile(path.join(runsDir, rid, 'progress.json'), 'utf8'));
        } catch {
          continue; // no/torn progress.json for this run-dir — not a live holder
        }
        if (prog && prog.overall === 'running' && Number.isInteger(prog.pid) && this._pidAlive(prog.pid)) {
          return res.status(409).json({
            error: 'Slot busy',
            message: `An experiment run is live (run_id=${prog.run_id ?? rid}, pid=${prog.pid}). Cancel it first.`,
            holder: { kind: 'experiment', run_id: prog.run_id ?? rid, pid: prog.pid },
          });
        }
      }

      // Phase 87-07 (CR-02): FORK MODE. When origin_span_id is present the launch is a real
      // "Fork into avenues" — synthesize + PERSIST an avenue spec from the origin Run + the
      // chosen forkAxes FIRST, so the written avenue-<origin>.yaml basename passes the SAME V5
      // listing gate below unchanged (T-87-07-01). The synthesized basename becomes the effective
      // spec; origin_span_id + avenue:true are folded into the forwarded overrides (below) so the
      // runner threads --origin-span-id + --avenue → run-write stamps origin_span_id (AVN-01/07).
      // A non-fork launch (origin_span_id absent) skips this entirely and stays byte-identical.
      let effectiveSpec = spec;
      let forkOriginSpanId = null;
      if (origin_span_id !== undefined && origin_span_id !== null) {
        // T-87-07-02: validate the id shape (never resolve/forward a raw ill-shaped id).
        if (!this._validOriginSpanId(origin_span_id)) {
          return res.status(400).json({ error: 'Invalid origin_span_id', message: 'origin_span_id must be a non-empty span id (≤256 chars, no path-navigation segments).' });
        }
        // T-87-07-05: resolve the origin Run via the persisted-Run read the runs table uses
        // (NEVER the live experiment LevelDB — Pitfall 6). 404 when it cannot be resolved.
        const originRun = await this._resolveOriginRun(origin_span_id);
        if (!originRun) {
          return res.status(404).json({ error: 'Origin span not found', message: `no Run resolves to origin_span_id '${origin_span_id}'.` });
        }
        // Map the chosen forkAxes → the flat variants matrix (shared with the preview path so
        // the launched matrix can never diverge from the previewed count).
        const variants = this._mapForkAxesToVariants(forkAxes, originRun);
        // Fork repeats come from the raw body overrides (the `ov` fold happens below); an
        // omitted/invalid repeats falls back to synthesizeAvenueSpec's own default of 1.
        const repeats = (overrides && typeof overrides === 'object' && Number.isInteger(overrides.repeats) && overrides.repeats > 0)
          ? overrides.repeats
          : undefined;
        const { synthesizeAvenueSpec, synthesizeToYamlFile } = await import('../experiments/avenue-spec.mjs');
        let synthSpec;
        try {
          synthSpec = synthesizeAvenueSpec({ originRun, variants, repeats });
        } catch (e) {
          return res.status(400).json({ error: 'Fork synthesis failed', message: e.message });
        }
        // Persist so the avenue basename is a server-LISTED spec → passes the V5 gate below.
        const outPath = synthesizeToYamlFile(synthSpec, { repoRoot: this._repoRoot() });
        effectiveSpec = path.basename(outPath);
        forkOriginSpanId = origin_span_id;
      }

      // V5 spec membership — the spec MUST be a server-listed config/experiments
      // file, never a raw client path (T-85-04-02). This also rejects a `../`
      // traversal segment (never a listed basename). In fork mode `effectiveSpec` is
      // the just-persisted avenue-<origin>.yaml basename (T-87-07-01: it must ALSO
      // pass this gate — a name that escaped config/experiments is rejected here).
      if (typeof effectiveSpec !== 'string' || !effectiveSpec.trim()) {
        return res.status(400).json({ error: 'Invalid spec', message: 'spec (a config/experiments/*.yaml filename) is required.' });
      }
      const specFiles = await this._listSpecFiles();
      if (!specFiles.includes(effectiveSpec)) {
        return res.status(400).json({
          error: 'Unlisted spec',
          message: `spec '${effectiveSpec}' is not one of the server-listed experiment specs (${specFiles.join(', ') || 'none'}).`,
        });
      }
      const specPath = path.join(this._repoRoot(), 'config', 'experiments', effectiveSpec);

      // Resolve the spec so we can validate override variant names against the
      // ACTUAL resolved cell names (D-05 strict). Server-side read only.
      const { resolveExperimentSpec } = await import('../experiments/experiment-spec.mjs');
      const { cellName } = await import('../experiments/experiment-runner.mjs');
      let resolved;
      try {
        resolved = resolveExperimentSpec(specPath);
      } catch (e) {
        return res.status(400).json({ error: 'Malformed spec', message: e.message });
      }
      const resolvedNames = new Set(resolved.cells.map((c) => cellName(c)));

      // Override validation (parity with experiment-run.mjs:107-125): repeats /
      // timeout positive int; every `variants` entry and every `variantOverrides`
      // KEY ∈ the resolved variant names. Do NOT rename variantOverrides (Plan-01
      // runner applyVariantOverride keys on it — forward it whole).
      const ov = overrides && typeof overrides === 'object' && !Array.isArray(overrides)
        ? { ...overrides }
        : {};
      // WR-01: fold a valid top-level `rerun_of` into the forwarded overrides so the runner's
      // buildRunArgv emits --rerun-of (run-launch.mjs reads overrides.rerun_of). Validate it as
      // a safe run_id shape (or null) — an ill-shaped rerun_of is rejected, never forwarded raw.
      if (rerun_of !== undefined && rerun_of !== null) {
        if (typeof rerun_of !== 'string' || !this._validRunId(rerun_of.trim())) {
          return res.status(400).json({ error: 'Invalid rerun_of', message: 'rerun_of must be a run_id ([A-Za-z0-9._-], 1–12 chars) or null.' });
        }
        ov.rerun_of = rerun_of.trim();
      }
      // Phase 87-07 (CR-02): fold the fork provenance into the forwarded overrides so
      // run-launch's buildRunArgv emits --origin-span-id + --avenue (Task 1). `forkOriginSpanId`
      // was set + validated in the fork block above; a non-fork launch leaves it null so these
      // keys never appear (the coordinator POST stays byte-identical for a plain rerun).
      if (forkOriginSpanId) {
        ov.origin_span_id = forkOriginSpanId;
        ov.avenue = true;
      }
      const overrideError = this._validateOverrides(ov, resolvedNames);
      if (overrideError) {
        return res.status(400).json({ error: 'Invalid overrides', message: overrideError });
      }

      // Mint a short path-safe run_id (Pitfall 1 bound — ≤12, same charset as the
      // Plan-01 CLI flag) and compose the run_dir under .data/experiments/runs/.
      //
      // SEAM PATH CONTRACT (Phase 85-06 fix): the coordinator runs ON THE HOST
      // where this container's absolute repo root (/coding) does not exist — a
      // container-absolute run_dir made the host `mkdir '/coding'` ENOENT. The
      // seam therefore carries a REPO-RELATIVE run_dir (.data is bind-mounted, so
      // the same directory is visible on both sides at different roots); the host
      // executor resolves it against ITS repo root (experiment-executor.mjs
      // resolveRunDir). `spec` stays the server-validated basename (V5 gate); the
      // host composes <host repo>/config/experiments/<basename>.
      const runId = this._mintRunId();
      const seamRunDir = path.posix.join('.data', 'experiments', 'runs', runId);

      // Delegate the detached spawn to the host coordinator seam, forwarding
      // `overrides` WHOLE (including variantOverrides). Never spawn in-container.
      const { ok, json } = await this._coordinatorPost('/experiments/run', {
        spec: effectiveSpec, run_id: runId, run_dir: seamRunDir, overrides: ov,
      });
      // D-02 HOST-side slot guard (Phase 85-06): the container's own live-run pid
      // probe above cannot see HOST pids (isolated PID namespace), so the host
      // executor re-checks with real pid visibility and reports slot_busy — map
      // it to the same 409 holder shape as the container-side sources.
      if (json && json.slot_busy) {
        return res.status(409).json({
          error: 'Slot busy',
          message: json.message || 'An experiment run is live. Cancel it first.',
          holder: json.holder || { kind: 'experiment' },
        });
      }
      if (!ok || json.success === false) {
        return res.status(502).json({
          error: 'Coordinator spawn failed',
          message: json.error || json.message || 'the host coordinator did not accept the launch',
        });
      }
      return res.status(200).json({ run_id: runId, pid: json.pid, run_dir: seamRunDir });
    } catch (error) {
      logger.error('Experiment run failed', { error: error.message });
      return res.status(500).json({ error: 'Experiment run failed', message: error.message });
    }
  }

  /**
   * POST /api/experiments/fork-preview  { origin_span_id, forkAxes?, sweep?, repeats? }
   * Phase 87-07 (CR-02/CR-03, T-87-07-03): the axes-aware fork PREVIEW. Resolves the origin
   * Run + maps forkAxes→variants using the EXACT shared path handleExperimentRun's launch uses
   * (_resolveOriginRun + _mapForkAxesToVariants), synthesizes the avenue spec, and returns
   * { cellCount } = variants × repeats — WITHOUT persisting a spec, touching the coordinator,
   * or launching a run. This keeps the launch-gating count SERVER-resolved (D-09) so the client
   * never has to compute an axes cross-product. Same defensive validation as the launch path:
   * 400 on an ill-shaped origin_span_id, 404 when the origin Run cannot be resolved.
   */
  async handleExperimentForkPreview(req, res) {
    try {
      const { origin_span_id, forkAxes, repeats } = req.body || {};
      // T-87-07-02: validate the id shape before it resolves a Run.
      if (!this._validOriginSpanId(origin_span_id)) {
        return res.status(400).json({ error: 'Invalid origin_span_id', message: 'origin_span_id must be a non-empty span id (≤256 chars, no path-navigation segments).' });
      }
      // T-87-07-05: resolve via the persisted-Run read (never the live experiment LevelDB).
      const originRun = await this._resolveOriginRun(origin_span_id);
      if (!originRun) {
        return res.status(404).json({ error: 'Origin span not found', message: `no Run resolves to origin_span_id '${origin_span_id}'.` });
      }
      // Shared mapping — the previewed count can never diverge from the launched matrix.
      const variants = this._mapForkAxesToVariants(forkAxes, originRun);
      const rep = (Number.isInteger(repeats) && repeats > 0) ? repeats : undefined;
      const { synthesizeAvenueSpec } = await import('../experiments/avenue-spec.mjs');
      let synthSpec;
      try {
        synthSpec = synthesizeAvenueSpec({ originRun, variants, repeats: rep });
      } catch (e) {
        return res.status(400).json({ error: 'Fork synthesis failed', message: e.message });
      }
      // The authoritative axes-derived cell count = variants × repeats. NO persist, NO launch.
      const cellCount = synthSpec.variants.length * synthSpec.repeats;
      return res.status(200).json({ cellCount });
    } catch (error) {
      logger.error('Fork preview failed', { error: error.message });
      return res.status(500).json({ error: 'Fork preview failed', message: error.message });
    }
  }

  /**
   * POST /api/experiments/run-cancel  { run_id }
   * Read the run's run.json (files ONLY — never the store), then delegate the
   * negated-pid group-kill to the coordinator seam. 404 when the run is unknown.
   */
  async handleRunCancel(req, res) {
    try {
      const { run_id } = req.body || {};
      if (!this._validRunId(run_id)) {
        return res.status(400).json({ error: 'Invalid run_id', message: 'run_id must match [A-Za-z0-9._-] and be 1–12 chars.' });
      }
      const runDir = path.join(this._dataDir(), 'experiments', 'runs', run_id);
      let runJson;
      try {
        runJson = JSON.parse(await fs.readFile(path.join(runDir, 'run.json'), 'utf8'));
      } catch (e) {
        if (e.code === 'ENOENT') {
          return res.status(404).json({ error: 'Unknown run', message: `No run.json for run_id=${run_id}.` });
        }
        throw e;
      }
      // Seam path contract (see handleExperimentRun): the host resolves a
      // repo-relative run_dir against ITS repo root — never send the
      // container-absolute path across the seam.
      const { ok, json } = await this._coordinatorPost('/experiments/cancel', {
        run_id, run_dir: path.posix.join('.data', 'experiments', 'runs', run_id), pid: runJson.pid,
      });
      if (!ok || json.success === false) {
        return res.status(502).json({
          error: 'Coordinator cancel failed',
          message: json.error || json.message || 'the host coordinator did not accept the cancel',
        });
      }
      return res.status(200).json({ killed: json.killed ?? true, run_id });
    } catch (error) {
      logger.error('Experiment cancel failed', { error: error.message });
      return res.status(500).json({ error: 'Experiment cancel failed', message: error.message });
    }
  }

  /**
   * GET /api/experiments/run-status/:runId
   * Serve <runDir>/progress.json VERBATIM (D-04). Cloned from
   * handleReconciliation: a PURE file read (never opens the experiment store —
   * Pitfall 6). `_validRunId` guards a `../` traversal BEFORE the path build.
   * ENOENT → 200 graceful-empty { runId, overall:'unknown', cells:[] }.
   */
  async handleRunStatus(req, res) {
    try {
      const { runId } = req.params;
      if (!this._validRunId(runId)) {
        return res.status(400).json({ error: 'Invalid runId', message: 'runId must match [A-Za-z0-9._-] and be 1–12 chars.' });
      }
      const filePath = path.join(this._dataDir(), 'experiments', 'runs', runId, 'progress.json');
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        return res.status(200).json(JSON.parse(raw)); // VERBATIM — no re-shaping (D-04)
      } catch (e) {
        if (e.code === 'ENOENT') {
          return res.status(200).json({ runId, overall: 'unknown', cells: [] }); // graceful-empty
        }
        throw e;
      }
    } catch (error) {
      logger.error('Run status read failed', { error: error.message });
      return res.status(500).json({ error: 'Run status read failed', message: error.message });
    }
  }

  /**
   * GET /api/experiments/specs
   * Preview the resolved variant matrix for every config/experiments/*.yaml
   * (D-09). cellCount = cells.length * repeats. A MALFORMED spec is listed with
   * { file, error }, not fatal — the endpoint still 200s with the rest.
   */
  async handleSpecList(req, res) {
    try {
      const specDir = path.join(this._repoRoot(), 'config', 'experiments');
      const files = await this._listSpecFiles();
      const { resolveExperimentSpec } = await import('../experiments/experiment-spec.mjs');
      const { cellName } = await import('../experiments/experiment-runner.mjs');
      const specs = [];
      for (const file of files) {
        try {
          const { goal_sentence, repeats, cells } = resolveExperimentSpec(path.join(specDir, file));
          const variants = cells.map((c) => cellName(c));
          specs.push({
            file,
            goal_sentence,
            repeats,
            variantCount: cells.length,
            cellCount: cells.length * repeats,
            snapshot_id: null,
            variants,
          });
        } catch (e) {
          specs.push({ file, error: e.message }); // listed, not fatal
        }
      }
      return res.status(200).json({ specs });
    } catch (error) {
      logger.error('Spec list failed', { error: error.message });
      return res.status(500).json({ error: 'Spec list failed', message: error.message });
    }
  }

  /**
   * Validate a { task_id } avenue request body. Mirrors the coordinator's own
   * AVENUE_TASK_ID_RE gate ([A-Za-z0-9._-], ≤80, not '.'/'..') so an unmappable id
   * is rejected in-container BEFORE the seam POST, never coerced into a branch ref.
   */
  _validAvenueTaskId(id) {
    return typeof id === 'string' && id.length > 0 && id.length <= 80
      && /^[A-Za-z0-9._-]+$/.test(id) && id !== '.' && id !== '..';
  }

  /**
   * POST /api/experiments/avenue-merge-status  { task_id }
   * PROXY the READ-ONLY merge-status compute to the host coordinator seam (AVN-08).
   * No git runs here — the container only forwards + returns the coordinator JSON
   * verbatim (Pitfall 6). 400 on a bad task_id BEFORE the seam POST.
   */
  async handleAvenueMergeStatus(req, res) {
    return this._proxyAvenue(req, res, '/experiments/avenue-merge-status');
  }

  /**
   * POST /api/experiments/avenue-promote  { task_id }
   * PROXY the conflict-blocked promote to the host coordinator seam (AVN-08). The
   * merge is BLOCKED host-side when git reports conflicts — this layer never runs
   * git, only forwards (Pitfall 6).
   */
  async handleAvenuePromote(req, res) {
    return this._proxyAvenue(req, res, '/experiments/avenue-promote');
  }

  /**
   * POST /api/experiments/avenue-prune  { task_id }
   * PROXY the on-demand worktree+branch removal to the host coordinator seam
   * (AVN-09). State-changing git → host-only; the container only forwards (Pitfall 6).
   */
  async handleAvenuePrune(req, res) {
    return this._proxyAvenue(req, res, '/experiments/avenue-prune');
  }

  /**
   * Shared proxy body for the three avenue routes: validate { task_id }, forward it
   * to the coordinator seam VERBATIM, and relay the coordinator's status+JSON. NEVER
   * spawns/kills or runs git in-container — the host is the only place state-changing
   * avenue git ops run (Pitfall 6 / the 87-01 host-only trust boundary).
   */
  async _proxyAvenue(req, res, seamPath) {
    try {
      const { task_id } = req.body || {};
      if (!this._validAvenueTaskId(task_id)) {
        return res.status(400).json({ error: 'Invalid task_id', message: 'task_id must match [A-Za-z0-9._-] and be 1–80 chars.' });
      }
      const { ok, status, json } = await this._coordinatorPost(seamPath, { task_id });
      if (!ok || json.ok === false) {
        return res.status(status && status >= 400 ? status : 502).json({
          error: 'Coordinator avenue op failed',
          message: json.error || json.message || `the host coordinator rejected ${seamPath}`,
        });
      }
      // Relay the primitive's JSON verbatim (state/ahead/behind/conflicts | promoted | removed).
      return res.status(200).json(json);
    } catch (error) {
      logger.error('Avenue op failed', { seamPath, error: error.message });
      return res.status(500).json({ error: 'Avenue op failed', message: error.message });
    }
  }

  /** Never-throw pid liveness (signal 0). Files+pid only — see Pitfall 6. */
  _pidAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return e.code === 'EPERM'; // exists but not ours → still alive
    }
  }

  /** Mint a short path-safe run_id (≤12 chars, [A-Za-z0-9._-] — Pitfall 1 bound). */
  _mintRunId() {
    return `r${Date.now().toString(36)}`.slice(0, 12);
  }

  /**
   * Validate a launch overrides body (parity with experiment-run.mjs:107-125):
   * repeats/timeout positive int; every `variants` entry and every
   * `variantOverrides` KEY ∈ resolvedNames. Returns an error string or null.
   */
  _validateOverrides(ov, resolvedNames) {
    if (ov.repeats !== undefined) {
      if (!Number.isInteger(ov.repeats) || ov.repeats < 1) {
        return `overrides.repeats must be a positive integer (got ${JSON.stringify(ov.repeats)}).`;
      }
    }
    if (ov.timeout !== undefined) {
      if (!Number.isInteger(ov.timeout) || ov.timeout < 1) {
        return `overrides.timeout must be a positive integer (got ${JSON.stringify(ov.timeout)}).`;
      }
    }
    if (ov.variants !== undefined) {
      if (!Array.isArray(ov.variants)) {
        return 'overrides.variants must be an array of resolved variant names.';
      }
      for (const v of ov.variants) {
        if (!resolvedNames.has(v)) {
          return `overrides.variants contains '${v}', which is not a resolved variant name.`;
        }
      }
    }
    if (ov.variantOverrides !== undefined) {
      if (typeof ov.variantOverrides !== 'object' || ov.variantOverrides === null || Array.isArray(ov.variantOverrides)) {
        return 'overrides.variantOverrides must be an object keyed by resolved variant name.';
      }
      for (const key of Object.keys(ov.variantOverrides)) {
        if (!resolvedNames.has(key)) {
          return `overrides.variantOverrides key '${key}' is not a resolved variant name.`;
        }
      }
    }
    return null;
  }

  /**
   * Phase 87-07 (CR-02, T-87-07-02): validate an `origin_span_id` from the untrusted
   * client BEFORE it is used to resolve a Run or derive an avenue spec basename. A span
   * id is a composeTaskId slug (provider/model may embed a slash, sanitized downstream)
   * — accept a bounded printable string, reject path-navigation segments so a synthesized
   * `avenue-<id>.yaml` name can never traverse out of config/experiments. Returns true
   * for a well-shaped id. Resolution to an actual Run (404) is a SEPARATE gate.
   */
  _validOriginSpanId(id) {
    return typeof id === 'string'
      && id.length > 0
      && id.length <= 256
      && !id.includes('..')
      && !/[\x00-\x1f]/.test(id)
      && id !== '.'
      && id !== '..';
  }

  /**
   * Phase 87-07 (CR-02, T-87-07-05): resolve a completed origin Run by its span id
   * (task_id) via the SAME transient-open experiment-store read the runs table uses
   * (handleRunsQuery) — NEVER the live experiment LevelDB during a live run (Pitfall 6).
   * By this call site the handler has already proven no live run holds the slot, so the
   * transient open is safe. Returns the Run row ({ goal_sentence, snapshot_id, task_id,
   * … }) or null when no Run matches (→ 404 upstream). Never throws for a missing id.
   */
  async _resolveOriginRun(originSpanId) {
    const { openExperimentStore } = await import('../experiments/store.mjs');
    const { readRuns } = await import('../experiments/query.mjs');
    const store = await openExperimentStore(this.experimentRepoRoot ? { repoRoot: this.experimentRepoRoot } : {});
    try {
      // includePending so a just-completed but unscored origin span still resolves.
      const rows = await readRuns(store, { includePending: true });
      return rows.find((r) => r.task_id === originSpanId) ?? null;
    } finally {
      await store.close();
    }
  }

  /**
   * Phase 87-07 (CR-02/CR-03): map the client ForkAxes ({ agents?, models?, frameworks?,
   * kbOn?, kbOff? }) into the flat `variants` array synthesizeAvenueSpec expects — ONE
   * cell per agent×model×framework×env cross-product. This is the SINGLE shared mapping
   * for BOTH the launch path (handleExperimentRun) and the preview path
   * (handleExperimentForkPreview) so the previewed count can NEVER diverge from the
   * launched matrix. An omitted axis seeds from the origin Run's own agent/model (so a
   * bare fork with no axes still yields one origin-shaped cell); env defaults to kb-on
   * unless kbOff is set, and both kbOn && kbOff sweeps the injection axis (2 env values).
   *
   * @param {object} forkAxes the client ForkAxes (may be undefined/empty).
   * @param {object} originRun the resolved origin Run (for the seed agent/model/framework).
   * @returns {Array<{agent:string,model:string,framework:string,env:string}>}
   */
  _mapForkAxesToVariants(forkAxes, originRun) {
    const fx = (forkAxes && typeof forkAxes === 'object' && !Array.isArray(forkAxes)) ? forkAxes : {};
    const nonEmpty = (a, seed) => (Array.isArray(a) && a.length > 0) ? a : [seed];
    // Seed an omitted axis from the origin Run's own recorded axis (fork = start from origin).
    const agents = nonEmpty(fx.agents, originRun?.agent ?? 'claude');
    const models = nonEmpty(fx.models, originRun?.model ?? 'default');
    const frameworks = nonEmpty(fx.frameworks, originRun?.framework ?? 'straight');
    // Env axis (AVN-04 injection A/B). Neither flag → default kb-on. kbOff only → kb-off.
    // Both → sweep [kb-on, kb-off]. This mirrors the ForkAxes doc contract exactly.
    const envs = [];
    if (fx.kbOn) envs.push('kb-on');
    if (fx.kbOff) envs.push('kb-off');
    if (envs.length === 0) envs.push('kb-on');
    const variants = [];
    for (const agent of agents) {
      for (const model of models) {
        for (const framework of frameworks) {
          for (const env of envs) {
            variants.push({ agent, model, framework, env });
          }
        }
      }
    }
    return variants;
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
