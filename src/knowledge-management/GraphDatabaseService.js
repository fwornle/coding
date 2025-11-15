/**
 * GraphDatabaseService
 *
 * Manages knowledge entities and relationships using a graph database architecture.
 * Uses Graphology for in-memory graph operations and Level for persistence.
 *
 * Architecture:
 * - In-memory graph: Graphology (multi-edge support)
 * - Persistence layer: Level (LevelDB for Node.js)
 * - Node IDs: {team}:{entityName} pattern for team isolation
 * - Edges: Store relationship type and metadata
 *
 * Design patterns:
 * - EventEmitter for lifecycle events (entity:stored, relationship:stored, ready)
 * - Graceful degradation (in-memory only if Level unavailable)
 * - SQL-compatible query interface for VKB/UKB integration
 */

import { EventEmitter } from 'events';
import Graph from 'graphology';
import { Level } from 'level';
import fs from 'fs/promises';
import path from 'path';
import { getKnowledgeGraphPath } from './knowledge-paths.js';

export class GraphDatabaseService extends EventEmitter {
  /**
   * Create a GraphDatabaseService instance
   *
   * @param {Object} options - Configuration options
   * @param {string} [options.dbPath] - Path to Level database (defaults to central coding/.data/knowledge-graph)
   * @param {Object} [options.config={}] - Graph database configuration
   * @param {boolean} [options.config.autoPersist=true] - Auto-persist graph changes
   * @param {number} [options.config.persistIntervalMs=1000] - Persistence interval
   * @param {number} [options.config.maxTraversalDepth=5] - Maximum traversal depth
   * @param {number} [options.config.maxResultsPerQuery=1000] - Max query results
   */
  constructor(options = {}) {
    super();

    // CRITICAL: Always use central database in coding/.data/knowledge-graph
    // This ensures ALL projects share the same knowledge base
    this.dbPath = options.dbPath || getKnowledgeGraphPath();
    this.config = options.config || {};

    // Graph instance (will be initialized in initialize())
    this.graph = null;

    // Level database instance
    this.levelDB = null;

    // Persistence settings
    this.autoPersist = this.config.autoPersist !== false;
    this.persistIntervalMs = this.config.persistIntervalMs || 1000;
    this.persistTimer = null;
    this.isDirty = false;

    // JSON export settings (for keeping shared-memory JSONs in sync)
    this.autoExportJSON = this.config.autoExportJSON !== false;
    this.jsonExportDir = this.config.jsonExportDir || path.join(path.dirname(this.dbPath), 'knowledge-export');
  }

  /**
   * Initialize the graph database
   *
   * Creates Graphology graph instance and opens Level database.
   * Loads existing graph from Level if present.
   *
   * @returns {Promise<void>}
   * @throws {Error} If initialization fails critically
   * @emits ready When initialization complete
   */
  async initialize() {
    try {
      // Create Graphology graph with multi-edge support
      this.graph = new Graph({ multi: true });
      console.log('✓ Graphology graph instance created');

      // Pre-flight check: Detect database locks before attempting to open
      const lockPath = path.join(this.dbPath, 'LOCK');
      try {
        await fs.access(lockPath);
        // Lock file exists - check who owns it
        const { spawn } = await import('child_process');
        const lsof = spawn('lsof', [lockPath]);

        let output = '';
        lsof.stdout.on('data', (data) => {
          output += data.toString();
        });

        await new Promise((resolve) => {
          lsof.on('close', () => resolve());
        });

        if (output.trim()) {
          const lines = output.split('\n').filter(line => line.trim());
          if (lines.length > 1) {
            const match = lines[1].match(/\s+(\d+)\s+/);
            if (match) {
              const lockHolderPid = match[1];
              throw new Error(
                `Level DB is locked by another process (PID: ${lockHolderPid}).\n` +
                `This is likely the VKB server. To fix:\n` +
                `  1. Stop VKB server: vkb server stop\n` +
                `  2. Or kill the process: kill ${lockHolderPid}\n` +
                `  3. Then retry your command`
              );
            }
          }
        }
      } catch (preflightError) {
        // If it's our lock detection error, re-throw it
        if (preflightError.message.includes('Level DB is locked')) {
          throw preflightError;
        }
        // Otherwise, lock file doesn't exist or lsof failed - proceed normally
      }

      // Ensure directory exists
      const dbDir = path.dirname(this.dbPath);
      await fs.mkdir(dbDir, { recursive: true });

      // Create and open Level database - NO FALLBACK, FAIL-FAST
      this.levelDB = new Level(this.dbPath, { valueEncoding: 'json' });
      await this.levelDB.open();
      console.log(`✓ Level database opened at: ${this.dbPath}`);

      // Load existing graph from Level if present
      await this._loadGraphFromLevel();

      // Start auto-persist if enabled
      if (this.autoPersist) {
        this._startAutoPersist();
      }

      this.emit('ready');
      console.log(`✓ Graph database initialized (${this.graph.order} nodes, ${this.graph.size} edges)`);

    } catch (error) {
      // Enhance error message for common issues
      let errorMessage = error.message;
      if (error.message.includes('Resource temporarily unavailable') ||
          error.message.includes('EBUSY') ||
          error.message.includes('IO error: lock')) {
        errorMessage =
          `Level DB initialization failed: Database is locked.\n` +
          `Check for running VKB server or other processes using the database.\n` +
          `Original error: ${error.message}`;
      }
      throw new Error(`Failed to initialize graph database: ${errorMessage}`);
    }
  }

  /**
   * Store an entity in the graph database
   *
   * @param {Object} entity - Entity to store
   * @param {string} entity.name - Entity name
   * @param {string} entity.entityType - Entity type (Pattern, Problem, etc.)
   * @param {Array<string>} [entity.observations=[]] - Observations about entity
   * @param {number} [entity.confidence=1.0] - Confidence score (0-1)
   * @param {string} [entity.source='manual'] - Source (manual, auto)
   * @param {Object} options - Storage options
   * @param {string} options.team - Team scope for entity
   * @returns {Promise<string>} Node ID (team:name)
   * @throws {Error} If entity validation fails
   * @emits entity:stored When entity stored successfully
   */
  async storeEntity(entity, options = {}) {
    // Validate required fields
    if (!entity.name) {
      throw new Error('Entity name is required');
    }
    if (!options.team) {
      throw new Error('Team scope is required');
    }

    // Generate node ID using team:name pattern
    const nodeId = `${options.team}:${entity.name}`;

    // Prepare node attributes
    const attributes = {
      name: entity.name,
      entityType: entity.entityType || 'Unknown',
      observations: entity.observations || [],
      confidence: entity.confidence !== undefined ? entity.confidence : 1.0,
      source: entity.source || 'manual',
      team: options.team,
      created_at: entity.created_at || new Date().toISOString(),
      last_modified: new Date().toISOString(),
      ...entity // Include any additional attributes
    };

    // Add or update node in graph
    if (this.graph.hasNode(nodeId)) {
      // Update existing node - replaceNodeAttributes is the correct Graphology API
      this.graph.replaceNodeAttributes(nodeId, attributes);
    } else {
      // Create new node
      this.graph.addNode(nodeId, attributes);
    }

    // Mark as dirty for persistence
    this.isDirty = true;

    // Persist to Level immediately if not auto-persisting
    if (!this.autoPersist && this.levelDB) {
      await this._persistGraphToLevel();
      // NOTE: JSON export is handled by GraphKnowledgeExporter via events
    }

    // Emit event for monitoring/logging (GraphKnowledgeExporter listens to this)
    this.emit('entity:stored', { team: options.team, entity: attributes, nodeId });

    return nodeId;
  }

  /**
   * Retrieve an entity from the graph database
   *
   * @param {string} name - Entity name
   * @param {string} team - Team scope
   * @returns {Promise<Object|null>} Entity attributes or null if not found
   */
  async getEntity(name, team) {
    const nodeId = `${team}:${name}`;

    if (!this.graph.hasNode(nodeId)) {
      return null;
    }

    return this.graph.getNodeAttributes(nodeId);
  }

  /**
   * Store a relationship between two entities
   *
   * @param {string} fromEntity - Source entity name
   * @param {string} toEntity - Target entity name
   * @param {string} type - Relationship type (implements, solves, uses, etc.)
   * @param {Object} [metadata={}] - Relationship metadata
   * @param {string} metadata.team - Team scope
   * @param {number} [metadata.confidence=1.0] - Confidence score
   * @returns {Promise<void>}
   * @throws {Error} If either entity doesn't exist
   * @emits relationship:stored When relationship stored successfully
   */
  async storeRelationship(fromEntity, toEntity, type, metadata = {}) {
    const team = metadata.team || 'default';
    const fromId = `${team}:${fromEntity}`;
    const toId = `${team}:${toEntity}`;

    // Validate both entities exist
    if (!this.graph.hasNode(fromId)) {
      throw new Error(`Source entity not found: ${fromEntity} (team: ${team})`);
    }
    if (!this.graph.hasNode(toId)) {
      throw new Error(`Target entity not found: ${toEntity} (team: ${team})`);
    }

    // Prepare edge attributes
    const attributes = {
      type,
      confidence: metadata.confidence !== undefined ? metadata.confidence : 1.0,
      created_at: new Date().toISOString(),
      ...metadata
    };

    // Add edge (graph allows multiple edges between same nodes)
    this.graph.addEdge(fromId, toId, attributes);

    // Mark as dirty for persistence
    this.isDirty = true;

    // Persist to Level immediately if not auto-persisting
    if (!this.autoPersist && this.levelDB) {
      await this._persistGraphToLevel();
      // NOTE: JSON export is handled by GraphKnowledgeExporter via events
    }

    // Emit event for monitoring/logging (GraphKnowledgeExporter listens to this)
    this.emit('relationship:stored', { from: fromId, to: toId, type, metadata });
  }

  /**
   * Find related entities using graph traversal
   *
   * Uses breadth-first search to find entities related within specified depth.
   *
   * @param {string} entityName - Starting entity name
   * @param {number} [depth=2] - Maximum traversal depth (hops)
   * @param {Object} [filter={}] - Filter options
   * @param {string} [filter.team] - Filter by team
   * @param {string} [filter.relationshipType] - Filter by relationship type
   * @param {string} [filter.entityType] - Filter by entity type
   * @returns {Promise<Array<Object>>} Array of {entity, depth, relationshipType}
   */
  async findRelated(entityName, depth = 2, filter = {}) {
    const team = filter.team || 'default';
    const startNodeId = `${team}:${entityName}`;

    // Validate starting entity exists
    if (!this.graph.hasNode(startNodeId)) {
      throw new Error(`Entity not found: ${entityName} (team: ${team})`);
    }

    // BFS traversal data structures
    const results = [];
    const visited = new Set(); // Track visited nodes to prevent infinite loops
    const queue = [{ nodeId: startNodeId, currentDepth: 0, relationshipType: null }];

    // BFS traversal
    while (queue.length > 0) {
      const { nodeId, currentDepth, relationshipType } = queue.shift();

      // Skip if we've reached max depth
      if (currentDepth >= depth) {
        continue;
      }

      // Get all neighbors (outbound edges)
      const neighbors = this.graph.outNeighbors(nodeId);

      for (const neighborId of neighbors) {
        // Skip if already visited
        if (visited.has(neighborId)) {
          continue;
        }

        // Get edge attributes to find relationship type
        const edges = this.graph.edges(nodeId, neighborId);
        const edge = edges[0]; // Get first edge (multi-graph may have multiple)
        const edgeAttrs = this.graph.getEdgeAttributes(edge);
        const relType = edgeAttrs.type;

        // Get node attributes
        const nodeAttrs = this.graph.getNodeAttributes(neighborId);

        // Mark as visited BEFORE filtering
        visited.add(neighborId);

        // Check if this node matches filters (for inclusion in results)
        let includeInResults = true;

        // Filter by relationship type
        if (filter.relationshipType && relType !== filter.relationshipType) {
          includeInResults = false;
        }

        // Filter by entity type
        if (filter.entityType && nodeAttrs.entityType !== filter.entityType) {
          includeInResults = false;
        }

        // Filter by team (entity's team, not starting team)
        if (filter.team && nodeAttrs.team !== filter.team) {
          includeInResults = false;
        }

        // Add to results if it matches all filters
        if (includeInResults) {
          results.push({
            entity: nodeAttrs,
            depth: currentDepth + 1,
            relationshipType: relType
          });
        }

        // Always add to queue for further traversal (to find filtered nodes deeper in the graph)
        queue.push({
          nodeId: neighborId,
          currentDepth: currentDepth + 1,
          relationshipType: relType
        });
      }
    }

    return results;
  }

  /**
   * Query entities with SQL-compatible filtering
   *
   * Provides same interface as SQLite queries for VKB/UKB compatibility.
   *
   * @param {Object} [options={}] - Query options
   * @param {string} [options.team] - Filter by team
   * @param {string} [options.source] - Filter by source (manual, auto)
   * @param {Array<string>} [options.types] - Filter by entity types
   * @param {string} [options.startDate] - Filter by created after (ISO string)
   * @param {string} [options.endDate] - Filter by created before (ISO string)
   * @param {number} [options.minConfidence=0] - Minimum confidence score
   * @param {number} [options.limit=1000] - Result limit
   * @param {number} [options.offset=0] - Result offset for pagination
   * @param {string} [options.searchTerm] - Text search term
   * @param {string} [options.sortBy='last_modified'] - Sort field
   * @param {string} [options.sortOrder='DESC'] - Sort order (ASC, DESC)
   * @returns {Promise<Array<Object>>} Array of entities matching filters
   */
  async queryEntities(options = {}) {
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

    // Get all nodes and filter them
    let results = [];
    const filteredInsightNodeIds = new Set(); // Only insight nodes (not System, not Project)

    // First pass: Get regular entities (non-Project, non-System) that match filters
    this.graph.forEachNode((nodeId, attributes) => {
      // Apply team filter
      if (team && attributes.team !== team) return;

      const entityType = attributes.entityType;
      const isSystem = entityType === 'System';
      const isProject = entityType === 'Project';

      // System nodes are ALWAYS visible (ignore all filters)
      if (isSystem) {
        results.push({
          id: nodeId,
          entity_name: attributes.name,
          entity_type: entityType || 'Unknown',
          observations: attributes.observations || [],
          extraction_type: attributes.extraction_type || null,
          classification: attributes.classification || null,
          confidence: attributes.confidence !== undefined ? attributes.confidence : 1.0,
          source: attributes.source || 'manual',
          team: attributes.team,
          extracted_at: attributes.created_at || attributes.extracted_at,
          last_modified: attributes.last_modified,
          session_id: attributes.session_id || null,
          embedding_id: attributes.embedding_id || null,
          metadata: attributes.metadata || {}
        });
        return;
      }

      // Project nodes are handled in second pass (only if referenced)
      if (isProject) return;

      // Apply source filter to regular insight nodes
      if (source && attributes.source !== source) return;

      if (types && types.length > 0 && !types.includes(entityType)) return;
      if (minConfidence > 0 && (attributes.confidence === undefined || attributes.confidence < minConfidence)) return;

      // Date filtering
      if (startDate && attributes.last_modified < startDate) return;
      if (endDate && attributes.last_modified > endDate) return;

      // Search term filtering (case-insensitive)
      if (searchTerm) {
        const nameMatch = attributes.name && attributes.name.toLowerCase().includes(searchTerm.toLowerCase());
        if (!nameMatch) return;
      }

      // Add to filtered insight nodes set (NOT System nodes)
      filteredInsightNodeIds.add(nodeId);

      // Map to SQL-compatible format
      results.push({
        id: nodeId,
        entity_name: attributes.name,
        entity_type: entityType || 'Unknown',
        observations: attributes.observations || [],
        extraction_type: attributes.extraction_type || null,
        classification: attributes.classification || null,
        confidence: attributes.confidence !== undefined ? attributes.confidence : 1.0,
        source: attributes.source || 'manual',
        team: attributes.team,
        extracted_at: attributes.created_at || attributes.extracted_at,
        last_modified: attributes.last_modified,
        session_id: attributes.session_id || null,
        embedding_id: attributes.embedding_id || null,
        metadata: attributes.metadata || {}
      });
    });

    // Second pass: Add Project nodes that are referenced by filtered INSIGHT nodes (not System nodes)
    const referencedProjectIds = new Set();

    // ONLY check for Project nodes referenced by insight nodes, NOT by System nodes
    filteredInsightNodeIds.forEach(nodeId => {
      // Check outgoing edges
      this.graph.forEachOutEdge(nodeId, (edgeId, attributes, source, target) => {
        const targetAttrs = this.graph.getNodeAttributes(target);
        if (targetAttrs.entityType === 'Project') {
          referencedProjectIds.add(target);
        }
      });

      // Check incoming edges
      this.graph.forEachInEdge(nodeId, (edgeId, attributes, source, target) => {
        const sourceAttrs = this.graph.getNodeAttributes(source);
        if (sourceAttrs.entityType === 'Project') {
          referencedProjectIds.add(source);
        }
      });
    });

    // Add referenced Project nodes to results
    referencedProjectIds.forEach(projectId => {
      const attributes = this.graph.getNodeAttributes(projectId);

      // Apply team filter
      if (team && attributes.team !== team) return;

      results.push({
        id: projectId,
        entity_name: attributes.name,
        entity_type: attributes.entityType || 'Unknown',
        observations: attributes.observations || [],
        extraction_type: attributes.extraction_type || null,
        classification: attributes.classification || null,
        confidence: attributes.confidence !== undefined ? attributes.confidence : 1.0,
        source: attributes.source || 'manual',
        team: attributes.team,
        extracted_at: attributes.created_at || attributes.extracted_at,
        last_modified: attributes.last_modified,
        session_id: attributes.session_id || null,
        embedding_id: attributes.embedding_id || null,
        metadata: attributes.metadata || {}
      });
    });

    // Sort results
    const validSortFields = ['last_modified', 'extracted_at', 'confidence', 'entity_name'];
    const safeSortBy = validSortFields.includes(sortBy) ? sortBy : 'last_modified';
    const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 1 : -1;

    results.sort((a, b) => {
      let aVal = a[safeSortBy];
      let bVal = b[safeSortBy];

      // Handle null/undefined values
      if (aVal === null || aVal === undefined) return safeSortOrder;
      if (bVal === null || bVal === undefined) return -safeSortOrder;

      // Compare values
      if (aVal < bVal) return -safeSortOrder;
      if (aVal > bVal) return safeSortOrder;
      return 0;
    });

    // Apply pagination
    const paginatedResults = results.slice(offset, offset + limit);

    return paginatedResults;
  }

  /**
   * Query relationships with filtering
   *
   * @param {Object} [options={}] - Query options
   * @param {string} [options.entityId] - Filter by source or target entity
   * @param {string} [options.team] - Filter by team
   * @param {string} [options.relationType] - Filter by relationship type
   * @param {number} [options.limit=1000] - Result limit
   * @returns {Promise<Array<Object>>} Array of relationships
   */
  async queryRelations(options = {}) {
    const {
      entityId = null,
      team = null,
      relationType = null,
      limit = 1000
    } = options;

    let results = [];

    // Iterate through all edges
    this.graph.forEachEdge((edge, attributes, source, target) => {
      // Filter by entityId (either source or target)
      if (entityId && source !== entityId && target !== entityId) return;

      // Filter by team (check edge metadata)
      if (team && attributes.team !== team) return;

      // Filter by relationship type
      if (relationType && attributes.type !== relationType) return;

      // Get entity names for from/to
      const sourceAttrs = this.graph.getNodeAttributes(source);
      const targetAttrs = this.graph.getNodeAttributes(target);

      // Map to SQL-compatible format
      results.push({
        id: edge,
        from_entity_id: source,
        to_entity_id: target,
        relation_type: attributes.type,
        confidence: attributes.confidence !== undefined ? attributes.confidence : 1.0,
        team: attributes.team || 'default',
        created_at: attributes.created_at || new Date().toISOString(),
        metadata: attributes.metadata || {},
        from_name: sourceAttrs.name,
        to_name: targetAttrs.name
      });
    });

    // Apply limit
    return results.slice(0, limit);
  }

  /**
   * Query entities by ontology classification
   *
   * @param {Object} options - Query options
   * @param {string} options.entityClass - Ontology entity class to filter by
   * @param {string} [options.team] - Team scope (optional, searches all teams if not provided)
   * @param {number} [options.minConfidence=0] - Minimum ontology confidence (0-1)
   * @param {number} [options.limit=1000] - Maximum results to return
   * @param {number} [options.offset=0] - Results offset for pagination
   * @param {string} [options.sortBy='ontology.confidence'] - Sort field (ontology.confidence, last_modified, entity_name)
   * @param {string} [options.sortOrder='DESC'] - Sort order (ASC or DESC)
   * @returns {Promise<Array<Object>>} Entities matching ontology criteria
   */
  async queryByOntologyClass(options = {}) {
    const {
      entityClass,
      team = null,
      minConfidence = 0,
      limit = 1000,
      offset = 0,
      sortBy = 'ontology.confidence',
      sortOrder = 'DESC'
    } = options;

    if (!entityClass) {
      throw new Error('entityClass parameter is required');
    }

    // Get all nodes and filter by ontology classification
    let results = [];

    this.graph.forEachNode((nodeId, attributes) => {
      // Skip nodes without ontology classification
      if (!attributes.ontology || !attributes.ontology.entityClass) {
        return;
      }

      // Filter by entity class
      if (attributes.ontology.entityClass !== entityClass) {
        return;
      }

      // Filter by team if specified
      if (team && attributes.team !== team) {
        return;
      }

      // Filter by minimum confidence
      const ontologyConfidence = attributes.ontology.confidence || 0;
      if (ontologyConfidence < minConfidence) {
        return;
      }

      // Map to result format with ontology metadata
      results.push({
        id: nodeId,
        entity_name: attributes.name,
        entity_type: attributes.entityType || 'Unknown',
        observations: attributes.observations || [],
        confidence: attributes.confidence !== undefined ? attributes.confidence : 1.0,
        source: attributes.source || 'manual',
        team: attributes.team,
        extracted_at: attributes.created_at || attributes.extracted_at,
        last_modified: attributes.last_modified,
        session_id: attributes.session_id || null,
        metadata: attributes.metadata || {},
        // Ontology-specific fields
        ontology: {
          entityClass: attributes.ontology.entityClass,
          confidence: ontologyConfidence,
          team: attributes.ontology.team,
          method: attributes.ontology.method,
          layer: attributes.ontology.layer,
          properties: attributes.ontology.properties || {}
        }
      });
    });

    // Sort results
    const validSortFields = {
      'ontology.confidence': (a) => a.ontology.confidence,
      'last_modified': (a) => a.last_modified,
      'entity_name': (a) => a.entity_name,
      'confidence': (a) => a.confidence
    };

    const sortFn = validSortFields[sortBy] || validSortFields['ontology.confidence'];
    const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 1 : -1;

    results.sort((a, b) => {
      const aVal = sortFn(a);
      const bVal = sortFn(b);

      // Handle null/undefined values
      if (aVal === null || aVal === undefined) return safeSortOrder;
      if (bVal === null || bVal === undefined) return -safeSortOrder;

      // Compare values
      if (aVal < bVal) return -safeSortOrder;
      if (aVal > bVal) return safeSortOrder;
      return 0;
    });

    // Apply pagination
    const paginatedResults = results.slice(offset, offset + limit);

    return paginatedResults;
  }

  /**
   * Get list of all teams
   *
   * @returns {Promise<Array<string>>} Sorted array of unique team names
   */
  async getTeams() {
    // Collect team statistics
    const teamStats = new Map();

    this.graph.forEachNode((nodeId, attributes) => {
      const team = attributes.team;
      if (!team) return;

      if (!teamStats.has(team)) {
        teamStats.set(team, {
          name: team,
          entityCount: 0,
          lastActivity: null
        });
      }

      const stats = teamStats.get(team);
      stats.entityCount++;

      // Track latest activity
      const lastModified = attributes.last_modified;
      if (lastModified && (!stats.lastActivity || lastModified > stats.lastActivity)) {
        stats.lastActivity = lastModified;
      }
    });

    // Convert to array and add display names
    const teams = Array.from(teamStats.values()).map(t => ({
      name: t.name,
      displayName: t.name.charAt(0).toUpperCase() + t.name.slice(1),
      entityCount: t.entityCount,
      lastActivity: t.lastActivity
    }));

    // Sort by entity count (descending)
    teams.sort((a, b) => b.entityCount - a.entityCount);

    return teams;
  }

  /**
   * Get statistics about stored knowledge
   *
   * @param {Object} [options={}] - Statistics options
   * @param {string} [options.team] - Filter statistics by team
   * @returns {Promise<Object>} Statistics object with entity/relation counts
   */
  async getStatistics(options = {}) {
    const { team = null } = options;

    // Entity statistics by team, source, and type
    const entityStats = [];
    const entityCountMap = new Map();

    this.graph.forEachNode((nodeId, attributes) => {
      // Filter by team if specified
      if (team && attributes.team !== team) return;

      const key = `${attributes.team}|${attributes.source}|${attributes.entityType}`;

      if (!entityCountMap.has(key)) {
        entityCountMap.set(key, {
          team: attributes.team,
          source: attributes.source || 'manual',
          entity_type: attributes.entityType || 'Unknown',
          count: 0
        });
      }

      entityCountMap.get(key).count++;
    });

    entityStats.push(...Array.from(entityCountMap.values()));

    // Relationship statistics by team and type
    const relationStats = [];
    const relationCountMap = new Map();

    this.graph.forEachEdge((edge, attributes) => {
      // Filter by team if specified
      if (team && attributes.team !== team) return;

      const key = `${attributes.team || 'default'}|${attributes.type}`;

      if (!relationCountMap.has(key)) {
        relationCountMap.set(key, {
          team: attributes.team || 'default',
          relation_type: attributes.type,
          count: 0
        });
      }

      relationCountMap.get(key).count++;
    });

    relationStats.push(...Array.from(relationCountMap.values()));

    // Total entity count
    let totalEntities = 0;
    this.graph.forEachNode((nodeId, attributes) => {
      if (team && attributes.team !== team) return;
      totalEntities++;
    });

    return {
      totalEntities,
      entitiesByTeamAndSource: entityStats,
      relationsByTeamAndType: relationStats,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Export knowledge to JSON file
   *
   * Used for manual backups via `ukb export` command.
   *
   * @param {string} team - Team to export
   * @param {string} filePath - Output file path
   * @returns {Promise<Object>} Export result with counts
   * @throws {Error} If file write fails
   */
  async exportToJSON(team, filePath) {
    if (!team) {
      throw new Error('Team parameter is required for export');
    }

    if (!filePath) {
      throw new Error('File path is required for export');
    }

    // Collect all entities for the team
    const entities = [];
    this.graph.forEachNode((nodeId, attributes) => {
      if (attributes.team !== team) return;

      // Export entity in shared-memory format (strip internal node ID)
      entities.push({
        name: attributes.name,
        entityType: attributes.entityType || 'Unknown',
        observations: attributes.observations || [],
        significance: attributes.significance || attributes.confidence || 1.0,
        problem: attributes.problem || {},
        solution: attributes.solution || {},
        metadata: {
          created_at: attributes.created_at || attributes.extracted_at,
          last_updated: attributes.last_modified || new Date().toISOString(),
          ...attributes.metadata
        },
        // Preserve additional attributes
        source: attributes.source,
        classification: attributes.classification,
        extraction_type: attributes.extraction_type,
        session_id: attributes.session_id,
        embedding_id: attributes.embedding_id
      });
    });

    // Collect all relations for the team
    const relations = [];
    this.graph.forEachEdge((edge, attributes, source, target) => {
      if (attributes.team !== team) return;

      const sourceAttrs = this.graph.getNodeAttributes(source);
      const targetAttrs = this.graph.getNodeAttributes(target);

      // Export relation in shared-memory format
      relations.push({
        from: sourceAttrs.name,
        to: targetAttrs.name,
        relationType: attributes.type,
        confidence: attributes.confidence,
        metadata: attributes.metadata || {}
      });
    });

    // Create export data matching shared-memory schema
    const exportData = {
      displayName: team.charAt(0).toUpperCase() + team.slice(1),
      description: `Knowledge graph export for team: ${team}`,
      entities,
      relations,
      metadata: {
        last_updated: new Date().toISOString(),
        team,
        entity_count: entities.length,
        relation_count: relations.length,
        exported_by: 'GraphDatabaseService',
        export_version: '1.0'
      }
    };

    // Write to file with pretty-printing (2-space indent)
    try {
      await fs.writeFile(filePath, JSON.stringify(exportData, null, 2), 'utf-8');

      return {
        success: true,
        team,
        entityCount: entities.length,
        relationCount: relations.length,
        filePath
      };
    } catch (error) {
      throw new Error(`Failed to write export file: ${error.message}`);
    }
  }

  /**
   * Import knowledge from JSON file
   *
   * Used for manual imports via `ukb import` command.
   * Idempotent - safe to run multiple times.
   *
   * @param {string} filePath - Input file path
   * @returns {Promise<Object>} Import result with counts
   * @throws {Error} If file read fails or JSON invalid
   */
  async importFromJSON(filePath) {
    if (!filePath) {
      throw new Error('File path is required for import');
    }

    // Read and parse JSON file
    let jsonData;
    try {
      const fileContent = await fs.readFile(filePath, 'utf-8');
      jsonData = JSON.parse(fileContent);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Import file not found: ${filePath}`);
      }
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in import file: ${error.message}`);
      }
      throw new Error(`Failed to read import file: ${error.message}`);
    }

    // Validate JSON schema
    if (!jsonData.entities || !Array.isArray(jsonData.entities)) {
      throw new Error('Invalid import format: missing or invalid "entities" array');
    }

    if (!jsonData.relations || !Array.isArray(jsonData.relations)) {
      throw new Error('Invalid import format: missing or invalid "relations" array');
    }

    // Determine team from metadata or use 'imported'
    const team = jsonData.metadata?.team || 'imported';

    // Import entities
    let entitiesImported = 0;
    const entityNameToId = new Map();

    for (const entity of jsonData.entities) {
      if (!entity.name) {
        console.warn('Skipping entity without name:', entity);
        continue;
      }

      try {
        // Map significance to confidence
        const confidence = entity.significance !== undefined ? entity.significance / 10 : 1.0;

        const nodeId = await this.storeEntity({
          name: entity.name,
          entityType: entity.entityType || 'Unknown',
          observations: entity.observations || [],
          confidence,
          source: entity.source || 'manual',
          problem: entity.problem || {},
          solution: entity.solution || {},
          classification: entity.classification,
          extraction_type: entity.extraction_type,
          session_id: entity.session_id,
          embedding_id: entity.embedding_id,
          metadata: entity.metadata || {},
          created_at: entity.metadata?.created_at,
          last_modified: entity.metadata?.last_updated || entity.metadata?.last_modified
        }, { team });

        entityNameToId.set(entity.name, nodeId);
        entitiesImported++;
      } catch (error) {
        console.warn(`Failed to import entity "${entity.name}":`, error.message);
      }
    }

    // Import relations
    let relationsImported = 0;

    for (const relation of jsonData.relations) {
      if (!relation.from || !relation.to || !relation.relationType) {
        console.warn('Skipping invalid relation:', relation);
        continue;
      }

      try {
        await this.storeRelationship(
          relation.from,
          relation.to,
          relation.relationType,
          {
            team,
            confidence: relation.confidence,
            metadata: relation.metadata || {}
          }
        );
        relationsImported++;
      } catch (error) {
        // Relation might fail if entities don't exist yet (cross-team relations)
        console.warn(`Failed to import relation "${relation.from}" -> "${relation.to}":`, error.message);
      }
    }

    return {
      success: true,
      team,
      entitiesImported,
      entitiesTotal: jsonData.entities.length,
      relationsImported,
      relationsTotal: jsonData.relations.length,
      filePath
    };
  }

  /**
   * Get database health status
   *
   * @returns {Promise<Object>} Health status object
   */
  async getHealth() {
    const health = {
      status: 'healthy',
      graph: {
        nodes: this.graph ? this.graph.order : 0,
        edges: this.graph ? this.graph.size : 0
      },
      persistence: {
        type: 'level',
        path: this.dbPath,
        autoPersist: this.autoPersist,
        isDirty: this.isDirty
      }
    };

    // Check if Level DB is accessible
    if (this.levelDB) {
      try {
        // Try a simple operation to verify connectivity
        await this.levelDB.get('graph').catch(() => null);
        health.persistence.levelStatus = 'connected';
      } catch (error) {
        health.persistence.levelStatus = 'error';
        health.persistence.levelError = error.message;
        health.status = 'degraded';
      }
    } else {
      // Should never happen after successful initialization with fail-fast
      health.status = 'error';
      health.persistence.error = 'Level DB not initialized - system in invalid state';
    }

    return health;
  }

  /**
   * Close database and cleanup resources
   *
   * @returns {Promise<void>}
   */
  async close() {
    // Stop auto-persist timer
    this._stopAutoPersist();

    // Persist any pending changes
    if (this.isDirty && this.levelDB) {
      await this._persistGraphToLevel();
    }

    // Close Level database
    if (this.levelDB) {
      await this.levelDB.close();
      this.levelDB = null;
    }

    // Clear graph
    if (this.graph) {
      this.graph.clear();
    }

    console.log('✓ Graph database closed');
  }

  /**
   * Persist graph to Level database (internal method)
   *
   * @private
   * @returns {Promise<void>}
   */
  async _persistGraphToLevel() {
    if (!this.levelDB) {
      return; // Skip if Level not initialized (shouldn't happen with fail-fast)
    }

    try {
      // Serialize graph to JSON
      const graphData = {
        nodes: this.graph.mapNodes((node, attributes) => ({
          key: node,
          attributes
        })),
        edges: this.graph.mapEdges((edge, attributes, source, target) => ({
          source,
          target,
          attributes
        })),
        metadata: {
          lastSaved: new Date().toISOString(),
          nodeCount: this.graph.order,
          edgeCount: this.graph.size
        }
      };

      // Store in Level database
      await this.levelDB.put('graph', graphData);

      this.isDirty = false;

    } catch (error) {
      console.error('Failed to persist graph to Level:', error.message);
      throw error;
    }
  }

  /**
   * Load graph from Level database (internal method)
   *
   * @private
   * @returns {Promise<void>}
   */
  async _loadGraphFromLevel() {
    if (!this.levelDB) {
      return; // Skip if Level not initialized (shouldn't happen with fail-fast)
    }

    try {
      // Try to load graph data from Level
      const graphData = await this.levelDB.get('graph');

      // Clear existing graph
      this.graph.clear();

      // Import nodes
      if (graphData.nodes) {
        for (const node of graphData.nodes) {
          this.graph.addNode(node.key, node.attributes);
        }
      }

      // Import edges
      if (graphData.edges) {
        for (const edge of graphData.edges) {
          this.graph.addEdge(edge.source, edge.target, edge.attributes);
        }
      }

      console.log(`  Loaded ${graphData.metadata.nodeCount} nodes and ${graphData.metadata.edgeCount} edges from Level`);

    } catch (error) {
      if (error.code === 'LEVEL_NOT_FOUND') {
        // No existing data, start fresh
        console.log('  No existing graph data found in Level, starting fresh');
      } else {
        console.warn('  Failed to load graph from Level:', error.message);
      }
    }
  }

  /**
   * Export all teams to JSON files (internal method)
   * Ensures JSON files stay in sync with LevelDB
   *
   * @private
   */
  async _exportAllTeamsToJSON() {
    if (!this.autoExportJSON) {
      return;
    }

    try {
      // Ensure export directory exists
      await fs.mkdir(this.jsonExportDir, { recursive: true });

      // Get all teams in the graph
      const teams = new Set();
      this.graph.forEachNode((nodeId, attributes) => {
        if (attributes.team) {
          teams.add(attributes.team);
        }
      });

      // Export each team to its own JSON file
      for (const team of teams) {
        const exportPath = path.join(this.jsonExportDir, `${team}.json`);
        await this.exportToJSON(team, exportPath);
      }
    } catch (error) {
      console.error('[GraphDB] Auto-export to JSON failed:', error.message);
    }
  }

  /**
   * Start auto-persist timer (internal method)
   *
   * @private
   */
  _startAutoPersist() {
    if (this.persistTimer) {
      return; // Already started
    }

    this.persistTimer = setInterval(async () => {
      if (this.isDirty && this.levelDB) {
        try {
          await this._persistGraphToLevel();
          // NOTE: JSON export is handled by GraphKnowledgeExporter
          // which listens to entity:stored events and exports with proper debouncing.
          // DO NOT export to JSON here to avoid race conditions during initialization.
        } catch (error) {
          console.error('Auto-persist failed:', error.message);
        }
      }
    }, this.persistIntervalMs);
  }

  /**
   * Stop auto-persist timer (internal method)
   *
   * @private
   */
  _stopAutoPersist() {
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }
  }
}
