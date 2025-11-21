/**
 * Relation Command Handler
 *
 * Provides CRUD operations for knowledge base relationships.
 *
 * Architecture:
 * - If VKB server is running → Use HTTP API (no lock conflicts)
 * - If VKB server is stopped → Direct database access
 */

import { DatabaseManager } from '../../../src/databases/DatabaseManager.js';
import { VkbApiClient } from '../core/VkbApiClient.js';
import path from 'path';

export class RelationCommand {
  constructor(codingRepo, config) {
    this.codingRepo = codingRepo;
    this.config = config;
    this.dbManager = null;
    this.graphDB = null;
    this.apiClient = new VkbApiClient({ debug: false });
    this.useApi = null; // Will be determined on first operation
  }

  /**
   * Determine access method: API or direct DB
   */
  async determineAccessMethod() {
    if (this.useApi !== null) {
      return this.useApi;
    }

    const serverAvailable = await this.apiClient.isServerAvailable();

    if (serverAvailable) {
      this.useApi = true;
      console.log('[RelationCommand] Using VKB server API (server is running)');
    } else {
      this.useApi = false;
      console.log('[RelationCommand] Using direct database access (server is stopped)');
    }

    return this.useApi;
  }

  /**
   * Initialize database connection (only for direct access)
   */
  async initializeDirectAccess() {
    if (this.dbManager) {
      return;
    }

    const sqlitePath = path.join(this.codingRepo, '.data', 'knowledge.db');
    const graphDbPath = path.join(this.codingRepo, '.data', 'knowledge-graph');

    this.dbManager = new DatabaseManager({
      sqlite: { path: sqlitePath, enabled: true },
      qdrant: { enabled: false },
      graphDbPath: graphDbPath
    });

    await this.dbManager.initialize();
    this.graphDB = this.dbManager.graphDB;

    if (!this.graphDB) {
      throw new Error('Graph database not available');
    }
  }

  /**
   * List relationships
   */
  async list(options = {}) {
    const useApi = await this.determineAccessMethod();
    const team = options.team || this.config.team || 'coding';

    if (useApi) {
      // Use VKB server API
      const result = await this.apiClient.getRelations({
        team,
        from: options.from || undefined,
        to: options.to || undefined,
        type: options.type || undefined
      });
      return result;
    }

    // Direct database access
    await this.initializeDirectAccess();

    const fromEntity = options.from || null;
    const toEntity = options.to || null;
    const relationType = options.type || null;

    const relations = [];

    // Iterate through all edges
    for (const edge of this.graphDB.graph.edges()) {
      const source = this.graphDB.graph.source(edge);
      const target = this.graphDB.graph.target(edge);

      // Filter by team
      if (!source.startsWith(`${team}:`)) {
        continue;
      }

      const attributes = this.graphDB.graph.getEdgeAttributes(edge);
      const fromName = source.split(':')[1];
      const toName = target.split(':')[1];

      // Apply filters
      if (fromEntity && fromName !== fromEntity) continue;
      if (toEntity && toName !== toEntity) continue;
      if (relationType && attributes.type !== relationType) continue;

      relations.push({
        from: fromName,
        to: toName,
        type: attributes.type,
        confidence: attributes.confidence,
        created: attributes.created_at,
        edgeId: edge
      });
    }

    // Sort by from entity, then type
    relations.sort((a, b) => {
      const cmp = a.from.localeCompare(b.from);
      return cmp !== 0 ? cmp : a.type.localeCompare(b.type);
    });

    return relations;
  }

  /**
   * Show relationship details
   */
  async show(fromEntity, toEntity, options = {}) {
    await this.initialize();

    const team = options.team || this.config.team || 'coding';
    const fromId = `${team}:${fromEntity}`;
    const toId = `${team}:${toEntity}`;

    const relations = [];

    // Find all edges between these two nodes
    if (this.graphDB.graph.hasNode(fromId) && this.graphDB.graph.hasNode(toId)) {
      const edges = this.graphDB.graph.edges(fromId, toId);

      for (const edge of edges) {
        const attributes = this.graphDB.graph.getEdgeAttributes(edge);
        relations.push({
          from: fromEntity,
          to: toEntity,
          type: attributes.type,
          confidence: attributes.confidence,
          created: attributes.created_at,
          metadata: attributes,
          edgeId: edge
        });
      }
    }

    if (relations.length === 0) {
      throw new Error(`No relationships found from ${fromEntity} to ${toEntity} (team: ${team})`);
    }

    return relations;
  }

  /**
   * Create relationship
   */
  async create(fromEntity, toEntity, type, options = {}) {
    await this.initialize();

    const team = options.team || this.config.team || 'coding';

    const metadata = {
      team,
      confidence: options.confidence !== undefined ? options.confidence : 1.0,
      source: options.source || 'manual',
      ...options.metadata
    };

    await this.graphDB.storeRelationship(fromEntity, toEntity, type, metadata);

    return {
      success: true,
      from: fromEntity,
      to: toEntity,
      type,
      metadata
    };
  }

  /**
   * Update relationship
   *
   * Note: Since Graphology allows multi-edges, we need to identify which edge to update.
   * If multiple edges exist, we update the first one unless edgeId is specified.
   */
  async update(fromEntity, toEntity, updates, options = {}) {
    await this.initialize();

    const team = options.team || this.config.team || 'coding';
    const fromId = `${team}:${fromEntity}`;
    const toId = `${team}:${toEntity}`;

    // Find edges between these entities
    if (!this.graphDB.graph.hasNode(fromId) || !this.graphDB.graph.hasNode(toId)) {
      throw new Error(`Entities not found: ${fromEntity} -> ${toEntity} (team: ${team})`);
    }

    const edges = this.graphDB.graph.edges(fromId, toId);
    if (edges.length === 0) {
      throw new Error(`No relationship found from ${fromEntity} to ${toEntity} (team: ${team})`);
    }

    // Use specified edge or first edge
    const edgeId = options.edgeId || edges[0];
    if (!edges.includes(edgeId)) {
      throw new Error(`Edge not found: ${edgeId}`);
    }

    // Get current attributes
    const currentAttrs = this.graphDB.graph.getEdgeAttributes(edgeId);

    // Merge updates
    const updatedAttrs = {
      ...currentAttrs,
      ...updates,
      last_modified: new Date().toISOString()
    };

    // Update edge attributes
    this.graphDB.graph.setEdgeAttributes(edgeId, updatedAttrs);

    // Mark as dirty for persistence
    this.graphDB.isDirty = true;

    // Persist immediately
    if (this.graphDB.levelDB) {
      await this.graphDB._persistGraphToLevel();
    }

    return {
      success: true,
      edgeId,
      from: fromEntity,
      to: toEntity,
      attributes: updatedAttrs
    };
  }

  /**
   * Delete relationship
   */
  async delete(fromEntity, toEntity, options = {}) {
    const useApi = await this.determineAccessMethod();
    const team = options.team || this.config.team || 'coding';

    if (useApi) {
      // Use VKB API
      const result = await this.apiClient.deleteRelation(fromEntity, toEntity, {
        team,
        type: options.type || undefined,
        all: options.all || undefined
      });

      return {
        success: result.success,
        deleted: result.deleted,
        edges: result.edges || []
      };
    } else {
      // Direct database access
      await this.initializeDirectAccess();

      const fromId = `${team}:${fromEntity}`;
      const toId = `${team}:${toEntity}`;

      if (!this.graphDB.graph.hasNode(fromId) || !this.graphDB.graph.hasNode(toId)) {
        throw new Error(`Entities not found: ${fromEntity} -> ${toEntity} (team: ${team})`);
      }

      const edges = this.graphDB.graph.edges(fromId, toId);
      if (edges.length === 0) {
        throw new Error(`No relationship found from ${fromEntity} to ${toEntity} (team: ${team})`);
      }

      let edgesToDelete = [];
      if (options.edgeId) {
        if (!edges.includes(options.edgeId)) {
          throw new Error(`Edge not found: ${options.edgeId}`);
        }
        edgesToDelete = [options.edgeId];
      } else if (options.type) {
        edgesToDelete = edges.filter(edge => {
          const attrs = this.graphDB.graph.getEdgeAttributes(edge);
          return attrs.type === options.type;
        });
        if (edgesToDelete.length === 0) {
          throw new Error(`No relationship of type '${options.type}' found from ${fromEntity} to ${toEntity}`);
        }
      } else if (options.all) {
        edgesToDelete = edges;
      } else {
        edgesToDelete = [edges[0]];
      }

      const deletedEdges = [];
      for (const edgeId of edgesToDelete) {
        const attrs = this.graphDB.graph.getEdgeAttributes(edgeId);
        this.graphDB.graph.dropEdge(edgeId);
        deletedEdges.push({
          edgeId,
          type: attrs.type,
          attributes: attrs
        });
      }

      this.graphDB.isDirty = true;

      if (this.graphDB.levelDB) {
        await this.graphDB._persistGraphToLevel();
      }

      for (const deleted of deletedEdges) {
        this.graphDB.emit('relationship:deleted', {
          team,
          from: fromEntity,
          to: toEntity,
          type: deleted.type
        });
      }

      return {
        success: true,
        deleted: deletedEdges.length,
        edges: deletedEdges
      };
    }
  }

  /**
   * Find related entities
   */
  async findRelated(entityName, options = {}) {
    await this.initialize();

    const team = options.team || this.config.team || 'coding';
    const depth = options.depth || 2;
    const filter = {
      team,
      relationshipType: options.type || null,
      entityType: options.entityType || null
    };

    const results = await this.graphDB.findRelated(entityName, depth, filter);

    return results;
  }

  /**
   * Close database connection
   */
  async close() {
    if (this.dbManager && this.dbManager.graphDB) {
      await this.dbManager.graphDB.close();
    }
  }
}
