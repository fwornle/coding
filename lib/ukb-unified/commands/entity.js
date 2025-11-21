/**
 * Entity Command Handler
 *
 * Provides CRUD operations for knowledge base entities.
 *
 * Architecture:
 * - If VKB server is running → Use HTTP API (no lock conflicts)
 * - If VKB server is stopped → Direct database access
 */

import { DatabaseManager } from '../../../src/databases/DatabaseManager.js';
import { VkbApiClient } from '../core/VkbApiClient.js';
import path from 'path';

export class EntityCommand {
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
      return this.useApi; // Already determined
    }

    // Check if VKB server is available
    const serverAvailable = await this.apiClient.isServerAvailable();

    if (serverAvailable) {
      this.useApi = true;
      console.log('[EntityCommand] Using VKB server API (server is running)');
    } else {
      this.useApi = false;
      console.log('[EntityCommand] Using direct database access (server is stopped)');
    }

    return this.useApi;
  }

  /**
   * Initialize database connection (only for direct access)
   */
  async initializeDirectAccess() {
    if (this.dbManager) {
      return; // Already initialized
    }

    const sqlitePath = path.join(this.codingRepo, '.data', 'knowledge.db');
    const graphDbPath = path.join(this.codingRepo, '.data', 'knowledge-graph');

    this.dbManager = new DatabaseManager({
      sqlite: { path: sqlitePath, enabled: true },
      qdrant: { enabled: false }, // Not needed for CRUD
      graphDbPath: graphDbPath
    });

    await this.dbManager.initialize();
    this.graphDB = this.dbManager.graphDB;

    if (!this.graphDB) {
      throw new Error('Graph database not available');
    }
  }

  /**
   * List entities
   */
  async list(options = {}) {
    const useApi = await this.determineAccessMethod();
    const team = options.team || this.config.team || 'coding';

    if (useApi) {
      // Use VKB API
      const result = await this.apiClient.getEntities({
        team,
        types: options.entityType || undefined,
        limit: 10000
      });

      return result.entities.map(e => ({
        name: e.name,
        type: e.entityType,
        observations: e.observations?.length || 0,
        created: e.created_at,
        modified: e.last_modified
      }));
    } else {
      // Direct database access
      await this.initializeDirectAccess();

      const entityType = options.entityType || null;
      const nodes = [];

      for (const nodeId of this.graphDB.graph.nodes()) {
        if (nodeId.startsWith(`${team}:`)) {
          const attributes = this.graphDB.graph.getNodeAttributes(nodeId);

          if (!entityType || attributes.entityType === entityType) {
            nodes.push({
              name: attributes.name,
              type: attributes.entityType,
              observations: attributes.observations?.length || 0,
              created: attributes.created_at,
              modified: attributes.last_modified
            });
          }
        }
      }

      nodes.sort((a, b) => a.name.localeCompare(b.name));
      return nodes;
    }
  }

  /**
   * Show entity details
   */
  async show(name, options = {}) {
    const useApi = await this.determineAccessMethod();
    const team = options.team || this.config.team || 'coding';

    if (useApi) {
      // Use VKB API - get by searching
      const result = await this.apiClient.getEntities({
        team,
        searchTerm: name,
        limit: 1
      });

      const entity = result.entities.find(e => e.name === name);
      if (!entity) {
        throw new Error(`Entity not found: ${name} (team: ${team})`);
      }

      return entity;
    } else {
      // Direct database access
      await this.initializeDirectAccess();

      const entity = await this.graphDB.getEntity(name, team);
      if (!entity) {
        throw new Error(`Entity not found: ${name} (team: ${team})`);
      }

      return entity;
    }
  }

  /**
   * Create entity
   */
  async create(entityData, options = {}) {
    await this.initialize();

    const team = options.team || this.config.team || 'coding';

    const entity = {
      name: entityData.name,
      entityType: entityData.entityType || entityData.type || 'Unknown',
      observations: entityData.observations || [],
      confidence: entityData.confidence !== undefined ? entityData.confidence : 1.0,
      source: entityData.source || 'manual'
    };

    const nodeId = await this.graphDB.storeEntity(entity, { team });

    return {
      success: true,
      nodeId,
      entity
    };
  }

  /**
   * Update entity
   */
  async update(name, updates, options = {}) {
    await this.initialize();

    const team = options.team || this.config.team || 'coding';

    // Get existing entity
    const existing = await this.graphDB.getEntity(name, team);
    if (!existing) {
      throw new Error(`Entity not found: ${name} (team: ${team})`);
    }

    // Merge updates
    const updated = {
      ...existing,
      ...updates,
      name, // Preserve name
      last_modified: new Date().toISOString()
    };

    // Store updated entity
    const nodeId = await this.graphDB.storeEntity(updated, { team });

    return {
      success: true,
      nodeId,
      entity: updated
    };
  }

  /**
   * Delete entity
   */
  async delete(name, options = {}) {
    const useApi = await this.determineAccessMethod();
    const team = options.team || this.config.team || 'coding';

    if (useApi) {
      // Use VKB API
      const result = await this.apiClient.deleteEntity(name, { team });
      return {
        success: result.success,
        deleted: result.deleted,
        entity: { name }
      };
    } else {
      // Direct database access
      await this.initializeDirectAccess();

      const nodeId = `${team}:${name}`;

      if (!this.graphDB.graph.hasNode(nodeId)) {
        throw new Error(`Entity not found: ${name} (team: ${team})`);
      }

      const entity = this.graphDB.graph.getNodeAttributes(nodeId);
      this.graphDB.graph.dropNode(nodeId);
      this.graphDB.isDirty = true;

      if (this.graphDB.levelDB) {
        await this.graphDB._persistGraphToLevel();
      }

      this.graphDB.emit('entity:deleted', { team, name, entity });

      return {
        success: true,
        deleted: name,
        entity
      };
    }
  }

  /**
   * Search entities
   */
  async search(query, options = {}) {
    const useApi = await this.determineAccessMethod();
    const team = options.team || this.config.team || 'coding';

    if (useApi) {
      // Use VKB API
      const result = await this.apiClient.searchEntities(query, { team, limit: 10000 });
      return result.entities.map(e => ({
        name: e.name,
        type: e.entityType,
        observations: e.observations?.length || 0,
        score: 2 // API doesn't provide scoring yet
      }));
    } else {
      // Direct database access
      await this.initializeDirectAccess();

      const results = [];
      const lowerQuery = query.toLowerCase();

      for (const nodeId of this.graphDB.graph.nodes()) {
        if (nodeId.startsWith(`${team}:`)) {
          const attributes = this.graphDB.graph.getNodeAttributes(nodeId);

          const matchName = attributes.name.toLowerCase().includes(lowerQuery);
          const matchType = attributes.entityType.toLowerCase().includes(lowerQuery);
          const matchObs = attributes.observations?.some(obs => {
            const obsText = typeof obs === 'string' ? obs : JSON.stringify(obs);
            return obsText.toLowerCase().includes(lowerQuery);
          });

          if (matchName || matchType || matchObs) {
            results.push({
              name: attributes.name,
              type: attributes.entityType,
              observations: attributes.observations?.length || 0,
              score: matchName ? 3 : (matchType ? 2 : 1)
            });
          }
        }
      }

      results.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.name.localeCompare(b.name);
      });

      return results;
    }
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
