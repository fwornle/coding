/**
 * DatabaseManager
 *
 * Unified database manager coordinating Qdrant (vectors) + SQLite (analytics/budget).
 * Provides single interface for all database operations across the knowledge system.
 *
 * Key Features:
 * - Dual-database architecture: Qdrant for vectors, SQLite for analytics
 * - Automatic schema creation and migration
 * - Budget tracking (budget_events table)
 * - Knowledge embeddings storage (multiple collections)
 * - Session analytics and metrics
 * - Graceful degradation when databases unavailable
 * - Connection pooling and health monitoring
 *
 * Database Responsibilities:
 * 1. Qdrant: Vector embeddings for knowledge patterns, trajectory analysis, semantic search
 * 2. SQLite: Budget tracking, session metrics, analytics, pattern analysis
 *
 * Collections in Qdrant:
 * - knowledge_patterns (1536-dim): OpenAI text-embedding-3-small embeddings
 * - knowledge_patterns_small (384-dim): sentence-transformers/all-MiniLM-L6-v2 embeddings
 * - trajectory_analysis (384-dim): Coding trajectory patterns
 * - session_memory (384-dim): Session-level knowledge
 *
 * Tables in SQLite:
 * - budget_events: LLM cost tracking
 * - knowledge_extractions: Extracted knowledge metadata
 * - session_metrics: Session-level analytics
 * - embedding_cache: Embedding generation cache
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import Database from 'better-sqlite3';
import { EventEmitter } from 'events';
import { createHash, randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';

export class DatabaseManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = config;
    this.initialized = false;

    // Qdrant configuration
    this.qdrantConfig = {
      host: config.qdrant?.host || 'localhost',
      port: config.qdrant?.port || 6333,
      enabled: config.qdrant?.enabled !== false,
      collections: config.qdrant?.collections || {
        knowledge_patterns: { vectorSize: 1536, distance: 'Cosine' },
        knowledge_patterns_small: { vectorSize: 384, distance: 'Cosine' },
        trajectory_analysis: { vectorSize: 384, distance: 'Cosine' },
        session_memory: { vectorSize: 384, distance: 'Cosine' }
      }
    };

    // SQLite configuration
    this.sqliteConfig = {
      path: config.sqlite?.path || path.join(process.cwd(), '.cache', 'knowledge.db'),
      memory: config.sqlite?.memory || false,
      enabled: config.sqlite?.enabled !== false
    };

    // Graph database configuration
    this.graphDbConfig = {
      path: config.graphDbPath || path.join(process.cwd(), '.data', 'knowledge-graph'),
      enabled: config.graphDb?.enabled !== false
    };

    // Database clients
    this.qdrant = null;
    this.sqlite = null;
    this.graphDB = null;
    this.qdrantSync = null;  // Sync service for Qdrant ↔ Graph bidirectional sync

    // Health status
    this.health = {
      qdrant: { available: false, lastCheck: null, error: null },
      sqlite: { available: false, lastCheck: null, error: null },
      graph: { available: false, lastCheck: null, error: null }
    };

    // Statistics
    this.stats = {
      qdrant: {
        operations: 0,
        errors: 0,
        collections: {}
      },
      sqlite: {
        operations: 0,
        errors: 0,
        tables: {}
      }
    };
  }

  /**
   * Initialize database connections and schemas
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    console.log('[DatabaseManager] Initializing...');

    // Initialize Qdrant (optional)
    if (this.qdrantConfig.enabled) {
      await this.initializeQdrant();
    }

    // Initialize SQLite (for analytics/budget tracking)
    if (this.sqliteConfig.enabled) {
      await this.initializeSQLite();
    }

    // Initialize Graph Database (for knowledge entities and relationships)
    if (this.graphDbConfig.enabled) {
      await this.initializeGraphDB();
    }

    this.initialized = true;
    this.emit('initialized', {
      qdrant: this.health.qdrant.available,
      sqlite: this.health.sqlite.available,
      graph: this.health.graph.available
    });
    console.log('[DatabaseManager] Initialized -',
      `Qdrant: ${this.health.qdrant.available ? 'available' : 'unavailable'},`,
      `SQLite: ${this.health.sqlite.available ? 'available' : 'unavailable'},`,
      `Graph: ${this.health.graph.available ? 'available' : 'unavailable'}`
    );
  }

  /**
   * Initialize Qdrant vector database
   */
  async initializeQdrant() {
    try {
      this.qdrant = new QdrantClient({
        url: `http://${this.qdrantConfig.host}:${this.qdrantConfig.port}`,
        checkCompatibility: false  // Skip version check (fails through proxies)
      });

      // Test connection
      await this.qdrant.getCollections();

      // Ensure collections exist
      for (const [collectionName, collectionConfig] of Object.entries(this.qdrantConfig.collections)) {
        await this.ensureQdrantCollection(collectionName, collectionConfig);
      }

      this.health.qdrant = {
        available: true,
        lastCheck: Date.now(),
        error: null
      };

      console.log('[DatabaseManager] Qdrant initialized successfully');
    } catch (error) {
      this.health.qdrant = {
        available: false,
        lastCheck: Date.now(),
        error: error.message
      };

      console.warn('[DatabaseManager] Qdrant not available:', error.message);
      console.warn('[DatabaseManager] Vector search features will be disabled');
      console.warn('[DatabaseManager] To enable: docker run -p 6333:6333 qdrant/qdrant');
    }
  }

  /**
   * Ensure Qdrant collection exists with proper configuration
   */
  async ensureQdrantCollection(collectionName, config) {
    try {
      const collections = await this.qdrant.getCollections();
      const exists = collections.collections.some(c => c.name === collectionName);

      if (!exists) {
        await this.qdrant.createCollection(collectionName, {
          vectors: {
            size: config.vectorSize,
            distance: config.distance,
            hnsw_config: {
              m: 16,              // Optimized for speed
              ef_construct: 100,
              full_scan_threshold: 10000
            },
            quantization_config: {
              scalar: {
                type: 'int8',     // 4x faster queries
                quantile: 0.99,
                always_ram: true
              }
            }
          }
        });

        console.log(`[DatabaseManager] Created Qdrant collection: ${collectionName} (${config.vectorSize}-dim)`);
      }

      this.stats.qdrant.collections[collectionName] = { operations: 0, errors: 0 };
    } catch (error) {
      console.warn(`[DatabaseManager] Failed to ensure collection ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Initialize SQLite database
   */
  async initializeSQLite() {
    try {
      const dbPath = this.sqliteConfig.memory ? ':memory:' : this.sqliteConfig.path;

      // Create directory if needed
      if (!this.sqliteConfig.memory && dbPath !== ':memory:') {
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }

      this.sqlite = new Database(dbPath);

      // Performance optimizations
      this.sqlite.pragma('journal_mode = WAL');
      this.sqlite.pragma('synchronous = NORMAL');
      this.sqlite.pragma('cache_size = 10000');
      this.sqlite.pragma('temp_store = memory');
      this.sqlite.pragma('optimize');

      // Create schemas
      await this.createSQLiteSchemas();

      this.health.sqlite = {
        available: true,
        lastCheck: Date.now(),
        error: null
      };

      console.log('[DatabaseManager] SQLite initialized successfully');
    } catch (error) {
      this.health.sqlite = {
        available: false,
        lastCheck: Date.now(),
        error: error.message
      };

      console.error('[DatabaseManager] SQLite initialization failed:', error);
      throw error; // SQLite is required for budget tracking
    }
  }

  /**
   * Initialize Graph Database (Graphology + Level)
   */
  async initializeGraphDB() {
    try {
      // Dynamic import to avoid loading if not needed
      const { GraphDatabaseService } = await import('../knowledge-management/GraphDatabaseService.js');
      const { GraphKnowledgeImporter } = await import('../knowledge-management/GraphKnowledgeImporter.js');
      const { GraphKnowledgeExporter } = await import('../knowledge-management/GraphKnowledgeExporter.js');
      const { QdrantSyncService } = await import('../knowledge-management/QdrantSyncService.js');

      // Create graph database instance
      this.graphDB = new GraphDatabaseService({
        dbPath: this.graphDbConfig.path,
        config: {
          autoPersist: true,
          persistIntervalMs: 1000
        }
      });

      // Initialize the graph database
      await this.graphDB.initialize();

      // Import knowledge from JSON exports on startup (Phase 4 bidirectional sync)
      const importer = new GraphKnowledgeImporter(this.graphDB, {
        autoImportOnStartup: true,
        conflictResolution: 'newest-wins'
      });
      await importer.initialize();

      // CRITICAL: Initialize exporter to keep JSON, LevelDB, and Graphology in sync
      // This is NOT optional - all three storage layers must remain synchronized
      this.graphExporter = new GraphKnowledgeExporter(this.graphDB, {
        autoExport: true,
        debounceMs: 5000
      });
      await this.graphExporter.initialize();

      // Initialize QdrantSyncService for bidirectional Graph ↔ Qdrant synchronization
      // This ensures Qdrant vector database stays in sync with graph changes
      if (this.qdrantConfig.enabled && this.health.qdrant.available) {
        try {
          this.qdrantSync = new QdrantSyncService({
            graphService: this.graphDB,
            databaseManager: this,
            enabled: true,
            syncOnStart: false  // Manual population via sync script
          });
          await this.qdrantSync.initialize();
          console.log('[DatabaseManager] QdrantSyncService initialized - bidirectional sync active');
        } catch (error) {
          console.warn('[DatabaseManager] QdrantSyncService initialization failed:', error.message);
          console.warn('[DatabaseManager] Graph→Qdrant sync disabled, but graph operations continue normally');
          // Non-fatal: Graph DB works without Qdrant sync
        }
      } else {
        console.log('[DatabaseManager] QdrantSyncService skipped (Qdrant not available)');
      }

      this.health.graph = {
        available: true,
        lastCheck: Date.now(),
        error: null
      };

      console.log(`[DatabaseManager] Graph database initialized at: ${this.graphDbConfig.path}`);
    } catch (error) {
      this.health.graph = {
        available: false,
        lastCheck: Date.now(),
        error: error.message
      };

      console.warn('[DatabaseManager] Graph database not available:', error.message);
      console.warn('[DatabaseManager] Knowledge operations (entities/relations) are unavailable');
      console.warn('[DatabaseManager] Note: SQLite is only used for analytics (budget tracking, session metrics)');
      // Continue with degraded functionality - graph DB is optional for analytics-only operations
    }
  }

  /**
   * Create SQLite schemas for all tables
   */
  async createSQLiteSchemas() {
    // Budget tracking table
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS budget_events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        operation_type TEXT,
        provider TEXT NOT NULL,
        model TEXT,
        tokens_used INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        project TEXT,
        metadata TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // NOTE: knowledge_extractions and knowledge_relations tables REMOVED
    // Knowledge is now stored in Graph DB (see GraphDatabaseService)
    // SQLite is now ONLY for analytics: budget_events, session_metrics, embedding_cache

    // Session metrics
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS session_metrics (
        session_id TEXT PRIMARY KEY,
        project TEXT,
        start_time TEXT,
        end_time TEXT,
        total_exchanges INTEGER DEFAULT 0,
        knowledge_extractions INTEGER DEFAULT 0,
        budget_spent REAL DEFAULT 0.0,
        classifications TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Embedding cache (to avoid re-generating same embeddings)
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS embedding_cache (
        content_hash TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        model TEXT NOT NULL,
        vector_size INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        last_accessed TEXT DEFAULT (datetime('now')),
        access_count INTEGER DEFAULT 0
      )
    `);

    // Create indexes
    this.createSQLiteIndexes();

    console.log('[DatabaseManager] SQLite schemas created');
  }

  /**
   * Create indexes for fast queries
   */
  createSQLiteIndexes() {
    const indexes = [
      // Budget tracking indexes
      'CREATE INDEX IF NOT EXISTS idx_budget_timestamp ON budget_events(timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_budget_provider ON budget_events(provider, operation_type)',
      'CREATE INDEX IF NOT EXISTS idx_budget_project ON budget_events(project, timestamp)',

      // Session metrics indexes
      'CREATE INDEX IF NOT EXISTS idx_session_time ON session_metrics(start_time, end_time)',
      'CREATE INDEX IF NOT EXISTS idx_session_project ON session_metrics(project)',

      // Embedding cache indexes
      'CREATE INDEX IF NOT EXISTS idx_embedding_model ON embedding_cache(model, vector_size)',
      'CREATE INDEX IF NOT EXISTS idx_embedding_access ON embedding_cache(last_accessed, access_count)'
    ];

    for (const index of indexes) {
      this.sqlite.exec(index);
    }
  }

  /**
   * Convert node ID to UUID for Qdrant compatibility
   *
   * Qdrant requires point IDs to be either unsigned integers or UUIDs.
   * This method generates a deterministic UUID from a string node ID using SHA-256.
   *
   * @param {string} nodeId - The node ID (e.g., "coding:CollectiveKnowledge")
   * @returns {string} A valid UUID
   */
  _nodeIdToUUID(nodeId) {
    // Generate deterministic UUID from node ID using SHA-256
    const hash = createHash('sha256').update(nodeId).digest('hex');

    // Format as UUID v4 (xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx)
    // Where y is one of [8, 9, a, b]
    const uuid = [
      hash.slice(0, 8),
      hash.slice(8, 12),
      '4' + hash.slice(13, 16),  // Version 4
      ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + hash.slice(18, 20),  // Variant bits
      hash.slice(20, 32)
    ].join('-');

    return uuid;
  }

  /**
   * Store vector in Qdrant
   */
  async storeVector(collection, id, vector, payload = {}) {
    if (!this.health.qdrant.available) {
      console.warn('[DatabaseManager] Qdrant unavailable, skipping vector storage');
      return false;
    }

    try {
      // Convert node ID to UUID for Qdrant compatibility
      const qdrantId = this._nodeIdToUUID(id);

      // Store original node ID in payload for reference
      const enrichedPayload = {
        ...payload,
        node_id: id  // Preserve original node ID
      };

      await this.qdrant.upsert(collection, {
        wait: false, // Async for performance
        points: [{
          id: qdrantId,
          vector,
          payload: enrichedPayload
        }]
      });

      this.stats.qdrant.operations++;
      this.stats.qdrant.collections[collection].operations++;

      return true;
    } catch (error) {
      this.stats.qdrant.errors++;
      this.stats.qdrant.collections[collection].errors++;
      console.error(`[DatabaseManager] Qdrant upsert failed for ${collection}:`, error);
      return false;
    }
  }

  /**
   * Search vectors in Qdrant
   */
  async searchVectors(collection, queryVector, options = {}) {
    if (!this.health.qdrant.available) {
      console.warn('[DatabaseManager] Qdrant unavailable, returning empty results');
      return [];
    }

    const {
      limit = 10,
      scoreThreshold = 0.7,
      filter = {},
      includePayload = true
    } = options;

    try {
      const results = await this.qdrant.search(collection, {
        vector: queryVector,
        limit,
        score_threshold: scoreThreshold,
        with_payload: includePayload,
        params: {
          hnsw_ef: 64,        // Speed vs accuracy tradeoff
          exact: false        // Allow approximate results for speed
        },
        filter
      });

      this.stats.qdrant.operations++;
      this.stats.qdrant.collections[collection].operations++;

      return results;
    } catch (error) {
      this.stats.qdrant.errors++;
      this.stats.qdrant.collections[collection].errors++;
      console.error(`[DatabaseManager] Qdrant search failed for ${collection}:`, error);
      return [];
    }
  }

  /**
   * Store budget event in SQLite
   */
  async storeBudgetEvent(event) {
    if (!this.health.sqlite.available) {
      throw new Error('SQLite unavailable - budget tracking requires database');
    }

    try {
      const stmt = this.sqlite.prepare(`
        INSERT INTO budget_events (
          id, timestamp, operation_type, provider, model,
          tokens_used, cost_usd, project, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        event.id,
        event.timestamp,
        event.operationType,
        event.provider,
        event.model,
        event.tokens,
        event.cost,
        event.project,
        JSON.stringify(event.metadata || {})
      );

      this.stats.sqlite.operations++;
      return true;
    } catch (error) {
      this.stats.sqlite.errors++;
      console.error('[DatabaseManager] Failed to store budget event:', error);
      throw error;
    }
  }

  /**
   * Get budget summary for a time period
   */
  async getBudgetSummary(startDate, endDate, project = null) {
    if (!this.health.sqlite.available) {
      return null;
    }

    try {
      let query = `
        SELECT
          SUM(cost_usd) as total_cost,
          SUM(tokens_used) as total_tokens,
          COUNT(*) as event_count,
          provider,
          operation_type
        FROM budget_events
        WHERE timestamp >= ? AND timestamp <= ?
      `;

      const params = [startDate, endDate];

      if (project) {
        query += ' AND project = ?';
        params.push(project);
      }

      query += ' GROUP BY provider, operation_type';

      const stmt = this.sqlite.prepare(query);
      const results = stmt.all(...params);

      this.stats.sqlite.operations++;
      return results;
    } catch (error) {
      this.stats.sqlite.errors++;
      console.error('[DatabaseManager] Failed to get budget summary:', error);
      return null;
    }
  }

  /**
   * @deprecated Knowledge is now stored in Graph DB, not SQLite
   * This method is kept for backwards compatibility but does nothing
   */
  async storeKnowledgeExtraction(extraction) {
    console.warn('[DatabaseManager] storeKnowledgeExtraction is deprecated - knowledge is now stored in Graph DB');
    return true; // Return success to avoid breaking existing code
  }

  /**
   * @deprecated Knowledge is now stored in Graph DB, not SQLite
   * This method is kept for backwards compatibility but does nothing
   */
  async deleteKnowledgeExtraction(id) {
    console.warn('[DatabaseManager] deleteKnowledgeExtraction is deprecated - knowledge is now stored in Graph DB');
    return true; // Return success to avoid breaking existing code
  }

  /**
   * Update session metrics
   */
  async updateSessionMetrics(sessionId, updates) {
    if (!this.health.sqlite.available) {
      return false;
    }

    try {
      const fields = [];
      const values = [];

      for (const [key, value] of Object.entries(updates)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }

      fields.push('updated_at = datetime("now")');
      values.push(sessionId);

      const stmt = this.sqlite.prepare(`
        INSERT INTO session_metrics (session_id, ${Object.keys(updates).join(', ')})
        VALUES (?, ${Object.keys(updates).map(() => '?').join(', ')})
        ON CONFLICT (session_id) DO UPDATE SET ${fields.join(', ')}
      `);

      stmt.run(sessionId, ...Object.values(updates));

      this.stats.sqlite.operations++;
      return true;
    } catch (error) {
      this.stats.sqlite.errors++;
      console.error('[DatabaseManager] Failed to update session metrics:', error);
      return false;
    }
  }

  /**
   * Get or create cached embedding
   */
  async getCachedEmbedding(content, model, vectorSize) {
    if (!this.health.sqlite.available) {
      return null;
    }

    try {
      const crypto = await import('crypto');
      const contentHash = crypto.createHash('sha256').update(content).digest('hex');

      const stmt = this.sqlite.prepare(`
        SELECT embedding FROM embedding_cache
        WHERE content_hash = ? AND model = ? AND vector_size = ?
      `);

      const result = stmt.get(contentHash, model, vectorSize);

      if (result) {
        // Update access stats
        this.sqlite.prepare(`
          UPDATE embedding_cache
          SET last_accessed = datetime('now'), access_count = access_count + 1
          WHERE content_hash = ?
        `).run(contentHash);

        this.stats.sqlite.operations++;
        return JSON.parse(result.embedding);
      }

      return null;
    } catch (error) {
      this.stats.sqlite.errors++;
      console.error('[DatabaseManager] Failed to get cached embedding:', error);
      return null;
    }
  }

  /**
   * Cache embedding for future use
   */
  async cacheEmbedding(content, embedding, model, vectorSize) {
    if (!this.health.sqlite.available) {
      return false;
    }

    try {
      const crypto = await import('crypto');
      const contentHash = crypto.createHash('sha256').update(content).digest('hex');

      const stmt = this.sqlite.prepare(`
        INSERT OR REPLACE INTO embedding_cache (
          content_hash, content, embedding, model, vector_size,
          last_accessed, access_count
        ) VALUES (?, ?, ?, ?, ?, datetime('now'), 1)
      `);

      stmt.run(
        contentHash,
        content,
        JSON.stringify(embedding),
        model,
        vectorSize
      );

      this.stats.sqlite.operations++;
      return true;
    } catch (error) {
      this.stats.sqlite.errors++;
      console.error('[DatabaseManager] Failed to cache embedding:', error);
      return false;
    }
  }

  /**
   * Get database health status
   */
  async getHealth() {
    // Get graph database health if available
    let graphHealth = this.health.graph;
    if (this.graphDB && this.health.graph.available) {
      try {
        graphHealth = await this.graphDB.getHealth();
      } catch (error) {
        graphHealth = {
          ...this.health.graph,
          error: error.message
        };
      }
    }

    // Determine overall health status
    const allHealthy = this.health.qdrant.available &&
                       this.health.sqlite.available &&
                       this.health.graph.available;
    const anyAvailable = this.health.qdrant.available ||
                         this.health.sqlite.available ||
                         this.health.graph.available;

    return {
      qdrant: this.health.qdrant,
      sqlite: this.health.sqlite,
      graph: graphHealth,
      overall: allHealthy ? 'healthy' : (anyAvailable ? 'degraded' : 'unavailable')
    };
  }

  /**
   * Get database statistics
   */
  getStats() {
    return {
      ...this.stats,
      health: this.getHealth()
    };
  }

  /**
   * Cleanup old data (budget events, embeddings cache)
   */
  async cleanup(retentionDays = 90) {
    if (!this.health.sqlite.available) {
      return;
    }

    try {
      const cutoffDate = new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000)).toISOString();

      // Delete old budget events
      this.sqlite.prepare(`
        DELETE FROM budget_events
        WHERE timestamp < ?
      `).run(cutoffDate);

      // Delete old unused embeddings (keep frequently accessed ones)
      this.sqlite.prepare(`
        DELETE FROM embedding_cache
        WHERE last_accessed < ? AND access_count < 3
      `).run(cutoffDate);

      console.log(`[DatabaseManager] Cleaned up data older than ${retentionDays} days`);
    } catch (error) {
      console.warn('[DatabaseManager] Cleanup failed:', error);
    }
  }

  /**
   * Close database connections
   */
  async close() {
    if (this.sqlite) {
      this.sqlite.close();
    }

    // CRITICAL: Shutdown exporter BEFORE closing graph to flush pending exports
    // This prevents the race condition where debounced exports fire after graph is cleared
    if (this.graphExporter) {
      await this.graphExporter.shutdown();
    }

    // Shutdown QdrantSyncService before closing graph
    if (this.qdrantSync) {
      await this.qdrantSync.shutdown();
    }

    // Close graph database
    if (this.graphDB) {
      await this.graphDB.close();
    }

    // Qdrant client doesn't need explicit closing

    this.initialized = false;
    console.log('[DatabaseManager] Closed');
  }
}

export default DatabaseManager;
