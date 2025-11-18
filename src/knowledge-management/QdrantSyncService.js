/**
 * QdrantSyncService
 *
 * Provides bidirectional synchronization between GraphDatabaseService and Qdrant vector database.
 * Listens to graph events (entity:stored, entity:deleted) and maintains vector representations
 * in Qdrant collections for semantic search capabilities.
 *
 * Architecture:
 * - Listens to GraphDatabaseService events
 * - Generates embeddings (384-dim and 1536-dim) for entity data
 * - Stores in Qdrant collections (knowledge_patterns, knowledge_patterns_small)
 * - Handles Create, Update, Delete operations
 * - Batch processing for initial population
 *
 * Collections:
 * - knowledge_patterns: 1536-dim OpenAI embeddings (high quality)
 * - knowledge_patterns_small: 384-dim local embeddings (fast)
 */

import { EventEmitter } from 'events';
import EmbeddingGenerator from '../utils/EmbeddingGenerator.cjs';

export class QdrantSyncService extends EventEmitter {
  /**
   * Create a QdrantSyncService instance
   *
   * @param {Object} options - Configuration options
   * @param {GraphDatabaseService} options.graphService - Graph database service instance
   * @param {DatabaseManager} options.databaseManager - Database manager with Qdrant client
   * @param {boolean} [options.enabled=true] - Enable/disable sync
   * @param {boolean} [options.syncOnStart=false] - Sync all existing data on initialization
   */
  constructor(options = {}) {
    super();

    if (!options.graphService) {
      throw new Error('GraphDatabaseService instance is required');
    }
    if (!options.databaseManager) {
      throw new Error('DatabaseManager instance is required');
    }

    this.graphService = options.graphService;
    this.databaseManager = options.databaseManager;
    this.enabled = options.enabled !== false;
    this.syncOnStart = options.syncOnStart || false;

    // Embedding generator (will be initialized on init())
    this.embeddingGenerator = null;

    // Stats tracking
    this.stats = {
      synced: 0,
      failed: 0,
      skipped: 0,
      lastSync: null
    };

    // Sync queue for batch processing
    this.syncQueue = [];
    this.processing = false;
  }

  /**
   * Initialize the sync service
   *
   * Sets up event listeners and optionally syncs existing data.
   *
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      console.log('[QdrantSync] Initializing Qdrant sync service...');

      // Initialize embedding generator
      this.embeddingGenerator = new EmbeddingGenerator({
        databaseManager: this.databaseManager,
        debug: false
      });

      if (!this.enabled) {
        console.log('[QdrantSync] Sync is disabled');
        return;
      }

      // Set up event listeners for graph changes
      this._setupEventListeners();

      // Optionally sync all existing data
      if (this.syncOnStart) {
        await this.syncAllEntities();
      }

      console.log('[QdrantSync] ✓ Initialized successfully');
      this.emit('ready');

    } catch (error) {
      console.error('[QdrantSync] Failed to initialize:', error.message);
      throw error;
    }
  }

  /**
   * Set up event listeners for graph database changes
   * @private
   */
  _setupEventListeners() {
    // Listen for entity storage events
    this.graphService.on('entity:stored', async (event) => {
      await this._handleEntityStored(event);
    });

    // Listen for entity deletion events (if implemented)
    this.graphService.on('entity:deleted', async (event) => {
      await this._handleEntityDeleted(event);
    });

    console.log('[QdrantSync] Event listeners registered');
  }

  /**
   * Handle entity:stored event from graph database
   * @private
   */
  async _handleEntityStored(event) {
    if (!this.enabled) return;

    try {
      const { team, entity, nodeId } = event;

      // Generate embeddings for the entity
      const text = this._buildEntityText(entity);

      // Generate both 384-dim and 1536-dim embeddings
      const embedding384 = await this.embeddingGenerator.generateEmbedding(text, { dimensions: 384 });
      const embedding1536 = await this.embeddingGenerator.generateEmbedding(text, { dimensions: 1536 });

      const embeddings = { embedding384, embedding1536 };

      // Build payload for Qdrant
      const payload = {
        id: nodeId,
        name: entity.name,
        entityType: entity.entityType || 'Unknown',
        team: team,
        observations: entity.observations || [],
        created_at: entity.created_at,
        last_modified: entity.last_modified,
        source: entity.source || 'unknown',
        synced_at: new Date().toISOString()
      };

      // Store in both Qdrant collections
      if (embeddings.embedding384) {
        await this.databaseManager.storeVector(
          'knowledge_patterns_small',
          nodeId,
          embeddings.embedding384,
          payload
        );
      }

      if (embeddings.embedding1536) {
        await this.databaseManager.storeVector(
          'knowledge_patterns',
          nodeId,
          embeddings.embedding1536,
          payload
        );
      }

      this.stats.synced++;
      this.stats.lastSync = new Date().toISOString();

      this.emit('entity:synced', { nodeId, team });

    } catch (error) {
      console.error(`[QdrantSync] Failed to sync entity ${event.nodeId}:`, error.message);
      this.stats.failed++;
      this.emit('sync:error', { event, error });
    }
  }

  /**
   * Handle entity:deleted event from graph database
   * @private
   */
  async _handleEntityDeleted(event) {
    if (!this.enabled) return;

    try {
      const { nodeId } = event;

      // Delete from both Qdrant collections
      await this._deleteFromQdrant(nodeId);

      this.emit('entity:deleted:synced', { nodeId });

    } catch (error) {
      console.error(`[QdrantSync] Failed to delete entity ${event.nodeId}:`, error.message);
      this.emit('sync:error', { event, error });
    }
  }

  /**
   * Delete entity from Qdrant collections
   * @private
   */
  async _deleteFromQdrant(nodeId) {
    // Convert node ID to UUID (must match the UUID used when storing)
    const qdrantId = this.databaseManager._nodeIdToUUID(nodeId);

    try {
      // Delete from knowledge_patterns_small
      await this.databaseManager.qdrant.delete('knowledge_patterns_small', {
        points: [qdrantId]
      });
    } catch (error) {
      // Ignore if not found
      if (!error.message.includes('Not found')) {
        throw error;
      }
    }

    try {
      // Delete from knowledge_patterns
      await this.databaseManager.qdrant.delete('knowledge_patterns', {
        points: [qdrantId]
      });
    } catch (error) {
      // Ignore if not found
      if (!error.message.includes('Not found')) {
        throw error;
      }
    }
  }

  /**
   * Build searchable text from entity for embedding generation
   * @private
   */
  _buildEntityText(entity) {
    const parts = [
      entity.name,
      entity.entityType,
      ...(entity.observations || [])
    ];

    return parts.filter(Boolean).join('. ');
  }

  /**
   * Sync all existing entities from graph database to Qdrant
   *
   * Useful for initial population or recovery scenarios.
   *
   * @param {Object} options - Sync options
   * @param {string[]} [options.teams] - Teams to sync (default: all)
   * @param {number} [options.batchSize=20] - Batch size for processing
   * @returns {Promise<Object>} Sync results
   */
  async syncAllEntities(options = {}) {
    const batchSize = options.batchSize || 20;
    const teams = options.teams || ['coding', 'ui', 'resi'];

    console.log('[QdrantSync] Starting full sync of all entities...');

    const results = {
      total: 0,
      synced: 0,
      failed: 0,
      duration: 0
    };

    const startTime = Date.now();

    try {
      for (const team of teams) {
        console.log(`[QdrantSync] Syncing team: ${team}`);

        // Get all entities for this team from graph
        const entities = await this._getAllEntitiesForTeam(team);
        results.total += entities.length;

        console.log(`  Found ${entities.length} entities`);

        // Process in batches
        for (let i = 0; i < entities.length; i += batchSize) {
          const batch = entities.slice(i, i + batchSize);

          for (const entity of batch) {
            try {
              const nodeId = `${team}:${entity.name}`;

              // Generate embeddings
              const text = this._buildEntityText(entity);

              // Generate both 384-dim and 1536-dim embeddings
              const embedding384 = await this.embeddingGenerator.generateEmbedding(text, { dimensions: 384 });
              const embedding1536 = await this.embeddingGenerator.generateEmbedding(text, { dimensions: 1536 });

              const embeddings = { embedding384, embedding1536 };

              // Build payload
              const payload = {
                id: nodeId,
                name: entity.name,
                entityType: entity.entityType || 'Unknown',
                team: team,
                observations: entity.observations || [],
                created_at: entity.created_at,
                last_modified: entity.last_modified,
                source: entity.source || 'unknown',
                synced_at: new Date().toISOString()
              };

              // Store in both collections
              if (embeddings.embedding384) {
                await this.databaseManager.storeVector(
                  'knowledge_patterns_small',
                  nodeId,
                  embeddings.embedding384,
                  payload
                );
              }

              if (embeddings.embedding1536) {
                await this.databaseManager.storeVector(
                  'knowledge_patterns',
                  nodeId,
                  embeddings.embedding1536,
                  payload
                );
              }

              results.synced++;

            } catch (error) {
              console.error(`  ✗ Failed to sync ${entity.name}:`, error.message);
              results.failed++;
            }
          }

          // Progress update
          const progress = Math.min(i + batchSize, entities.length);
          console.log(`  Progress: ${progress}/${entities.length}`);
        }
      }

      results.duration = Date.now() - startTime;

      console.log('[QdrantSync] ✓ Full sync complete');
      console.log(`  Total: ${results.total}`);
      console.log(`  Synced: ${results.synced}`);
      console.log(`  Failed: ${results.failed}`);
      console.log(`  Duration: ${(results.duration / 1000).toFixed(1)}s`);

      this.emit('sync:complete', results);

      return results;

    } catch (error) {
      console.error('[QdrantSync] Full sync failed:', error.message);
      throw error;
    }
  }

  /**
   * Get all entities for a team from graph database
   * @private
   */
  async _getAllEntitiesForTeam(team) {
    const entities = [];

    // Iterate through all nodes in the graph
    this.graphService.graph.forEachNode((nodeId, attributes) => {
      // Check if node belongs to this team
      if (attributes.team === team || nodeId.startsWith(`${team}:`)) {
        entities.push(attributes);
      }
    });

    return entities;
  }

  /**
   * Get sync statistics
   *
   * @returns {Object} Sync stats
   */
  getStats() {
    return {
      ...this.stats,
      enabled: this.enabled
    };
  }

  /**
   * Enable sync
   */
  enable() {
    this.enabled = true;
    console.log('[QdrantSync] Sync enabled');
  }

  /**
   * Disable sync
   */
  disable() {
    this.enabled = false;
    console.log('[QdrantSync] Sync disabled');
  }

  /**
   * Shutdown the sync service
   */
  async shutdown() {
    this.enabled = false;
    this.removeAllListeners();
    console.log('[QdrantSync] Shutdown complete');
  }
}
