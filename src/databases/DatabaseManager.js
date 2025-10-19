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

    // Database clients
    this.qdrant = null;
    this.sqlite = null;

    // Health status
    this.health = {
      qdrant: { available: false, lastCheck: null, error: null },
      sqlite: { available: false, lastCheck: null, error: null }
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

    // Initialize SQLite (required for budget tracking)
    if (this.sqliteConfig.enabled) {
      await this.initializeSQLite();
    }

    this.initialized = true;
    this.emit('initialized', { qdrant: this.health.qdrant.available, sqlite: this.health.sqlite.available });
    console.log('[DatabaseManager] Initialized -',
      `Qdrant: ${this.health.qdrant.available ? 'available' : 'unavailable'},`,
      `SQLite: ${this.health.sqlite.available ? 'available' : 'unavailable'}`
    );
  }

  /**
   * Initialize Qdrant vector database
   */
  async initializeQdrant() {
    try {
      this.qdrant = new QdrantClient({
        url: `http://${this.qdrantConfig.host}:${this.qdrantConfig.port}`
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

    // Knowledge extractions metadata
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_extractions (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        exchange_id TEXT,
        extraction_type TEXT NOT NULL,
        classification TEXT,
        confidence REAL,
        source_file TEXT,
        extracted_at TEXT DEFAULT (datetime('now')),
        embedding_id TEXT,
        metadata TEXT
      )
    `);

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

      // Knowledge extraction indexes
      'CREATE INDEX IF NOT EXISTS idx_knowledge_session ON knowledge_extractions(session_id)',
      'CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge_extractions(extraction_type, classification)',
      'CREATE INDEX IF NOT EXISTS idx_knowledge_time ON knowledge_extractions(extracted_at)',

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
   * Store vector in Qdrant
   */
  async storeVector(collection, id, vector, payload = {}) {
    if (!this.health.qdrant.available) {
      console.warn('[DatabaseManager] Qdrant unavailable, skipping vector storage');
      return false;
    }

    try {
      await this.qdrant.upsert(collection, {
        wait: false, // Async for performance
        points: [{
          id,
          vector,
          payload
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
   * Store knowledge extraction metadata
   */
  async storeKnowledgeExtraction(extraction) {
    if (!this.health.sqlite.available) {
      console.warn('[DatabaseManager] SQLite unavailable, skipping extraction metadata');
      return false;
    }

    try {
      const stmt = this.sqlite.prepare(`
        INSERT INTO knowledge_extractions (
          id, session_id, exchange_id, extraction_type, classification,
          confidence, source_file, embedding_id, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        extraction.id,
        extraction.sessionId,
        extraction.exchangeId,
        extraction.extractionType,
        extraction.classification,
        extraction.confidence,
        extraction.sourceFile,
        extraction.embeddingId,
        JSON.stringify(extraction.metadata || {})
      );

      this.stats.sqlite.operations++;
      return true;
    } catch (error) {
      this.stats.sqlite.errors++;
      console.error('[DatabaseManager] Failed to store knowledge extraction:', error);
      return false;
    }
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
  getHealth() {
    return {
      qdrant: this.health.qdrant,
      sqlite: this.health.sqlite,
      overall: this.health.qdrant.available || this.health.sqlite.available
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

    // Qdrant client doesn't need explicit closing

    this.initialized = false;
    console.log('[DatabaseManager] Closed');
  }
}

export default DatabaseManager;
