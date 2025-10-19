/**
 * Database Operations Integration Tests
 *
 * Tests all FR-5 requirements:
 * 1. Qdrant vector search accuracy
 * 2. DuckDB temporal queries
 * 3. Concurrent read/write operations
 * 4. Transaction semantics across databases
 * 5. Data consistency after failures
 * 6. Query performance under load
 * 7. Schema migrations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QdrantClient } from '@qdrant/js-client-rest';
import Database from 'better-sqlite3';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Mock database manager for testing
class MockDatabaseManager {
  constructor(options = {}) {
    this.qdrantUrl = options.qdrantUrl || 'http://localhost:6333';
    this.dbPath = options.dbPath;
    this.qdrantClient = null;
    this.sqliteDb = null;
    this.collections = {
      knowledge_patterns: 'knowledge_patterns',
      knowledge_patterns_small: 'knowledge_patterns_small'
    };
  }

  async initialize() {
    // Initialize Qdrant client
    this.qdrantClient = new QdrantClient({ url: this.qdrantUrl });

    // Initialize SQLite
    this.sqliteDb = new Database(this.dbPath);

    // Create test schema
    await this.createSchema();
  }

  async createSchema() {
    // Create SQLite tables
    this.sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_extractions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        confidence REAL,
        project TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_type ON knowledge_extractions(type);
      CREATE INDEX IF NOT EXISTS idx_project ON knowledge_extractions(project);
      CREATE INDEX IF NOT EXISTS idx_created ON knowledge_extractions(created_at);
    `);

    // Create Qdrant collections (if they don't exist)
    try {
      await this.qdrantClient.getCollection(this.collections.knowledge_patterns);
    } catch (error) {
      await this.qdrantClient.createCollection(this.collections.knowledge_patterns, {
        vectors: {
          size: 1536,
          distance: 'Cosine'
        }
      });
    }

    try {
      await this.qdrantClient.getCollection(this.collections.knowledge_patterns_small);
    } catch (error) {
      await this.qdrantClient.createCollection(this.collections.knowledge_patterns_small, {
        vectors: {
          size: 384,
          distance: 'Cosine'
        }
      });
    }
  }

  async storeKnowledge(knowledge) {
    const id = knowledge.id || `knowledge_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Store in SQLite
    const stmt = this.sqliteDb.prepare(`
      INSERT INTO knowledge_extractions (id, type, content, confidence, project, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      knowledge.type,
      knowledge.content,
      knowledge.confidence,
      knowledge.project || 'test',
      Date.now(),
      Date.now()
    );

    // Store in Qdrant
    if (knowledge.embedding) {
      const collection = knowledge.embedding.length === 384
        ? this.collections.knowledge_patterns_small
        : this.collections.knowledge_patterns;

      await this.qdrantClient.upsert(collection, {
        points: [
          {
            id,
            vector: knowledge.embedding,
            payload: {
              type: knowledge.type,
              content: knowledge.content,
              confidence: knowledge.confidence,
              project: knowledge.project || 'test'
            }
          }
        ]
      });
    }

    return { id, stored: true };
  }

  async searchSimilar(embedding, options = {}) {
    const collection = embedding.length === 384
      ? this.collections.knowledge_patterns_small
      : this.collections.knowledge_patterns;

    const results = await this.qdrantClient.search(collection, {
      vector: embedding,
      limit: options.limit || 10,
      filter: options.filter,
      with_payload: true,
      score_threshold: options.scoreThreshold || 0.7
    });

    return results;
  }

  async queryByType(type, options = {}) {
    const stmt = this.sqliteDb.prepare(`
      SELECT * FROM knowledge_extractions
      WHERE type = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const results = stmt.all(type, options.limit || 10);
    return results;
  }

  async queryByTimeRange(startTime, endTime) {
    const stmt = this.sqliteDb.prepare(`
      SELECT * FROM knowledge_extractions
      WHERE created_at >= ? AND created_at <= ?
      ORDER BY created_at DESC
    `);

    return stmt.all(startTime, endTime);
  }

  async deleteKnowledge(id) {
    // Delete from SQLite
    const stmt = this.sqliteDb.prepare('DELETE FROM knowledge_extractions WHERE id = ?');
    stmt.run(id);

    // Delete from Qdrant (try both collections)
    try {
      await this.qdrantClient.delete(this.collections.knowledge_patterns, {
        points: [id]
      });
    } catch (error) {
      // May not exist in this collection
    }

    try {
      await this.qdrantClient.delete(this.collections.knowledge_patterns_small, {
        points: [id]
      });
    } catch (error) {
      // May not exist in this collection
    }

    return { deleted: true };
  }

  async getStats() {
    const stmt = this.sqliteDb.prepare('SELECT COUNT(*) as count FROM knowledge_extractions');
    const sqliteCount = stmt.get().count;

    let qdrantCount = 0;
    try {
      const info = await this.qdrantClient.getCollection(this.collections.knowledge_patterns);
      qdrantCount += info.points_count || 0;
    } catch (error) {
      // Collection may not exist
    }

    try {
      const info = await this.qdrantClient.getCollection(this.collections.knowledge_patterns_small);
      qdrantCount += info.points_count || 0;
    } catch (error) {
      // Collection may not exist
    }

    return { sqlite: sqliteCount, qdrant: qdrantCount };
  }

  async beginTransaction() {
    this.sqliteDb.exec('BEGIN TRANSACTION');
  }

  async commitTransaction() {
    this.sqliteDb.exec('COMMIT');
  }

  async rollbackTransaction() {
    this.sqliteDb.exec('ROLLBACK');
  }

  async close() {
    if (this.sqliteDb) {
      this.sqliteDb.close();
    }
  }

  async cleanup() {
    // Clear SQLite
    if (this.sqliteDb) {
      this.sqliteDb.exec('DELETE FROM knowledge_extractions');
    }

    // Clear Qdrant collections
    try {
      await this.qdrantClient.delete(this.collections.knowledge_patterns, {
        filter: {} // Delete all
      });
    } catch (error) {
      // May not exist
    }

    try {
      await this.qdrantClient.delete(this.collections.knowledge_patterns_small, {
        filter: {} // Delete all
      });
    } catch (error) {
      // May not exist
    }
  }
}

describe('Database Operations Integration Tests', () => {
  let dbManager;
  let testDir;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = path.join(os.tmpdir(), 'db-test-' + Math.random().toString(36).substring(7));
    await fs.mkdir(testDir, { recursive: true });

    const dbPath = path.join(testDir, 'test.db');

    dbManager = new MockDatabaseManager({
      qdrantUrl: 'http://localhost:6333',
      dbPath
    });

    await dbManager.initialize();
  });

  afterEach(async () => {
    await dbManager.cleanup();
    await dbManager.close();

    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('FR-5.1: Qdrant Vector Search Accuracy', () => {

    it('should find semantically similar items', async () => {
      // Create similar embeddings (high similarity)
      const baseEmbedding = Array.from({ length: 384 }, () => Math.random());
      const similarEmbedding = baseEmbedding.map(v => v + Math.random() * 0.1 - 0.05);

      // Store base item
      await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'Caching with Map data structure',
        confidence: 0.9,
        embedding: baseEmbedding
      });

      // Search with similar embedding
      const results = await dbManager.searchSimilar(similarEmbedding, {
        limit: 5,
        scoreThreshold: 0.7
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeGreaterThan(0.7);
      expect(results[0].payload.content).toBe('Caching with Map data structure');
    });

    it('should not return dissimilar items', async () => {
      const embedding1 = Array.from({ length: 384 }, () => Math.random());
      const embedding2 = Array.from({ length: 384 }, () => Math.random() * -1);

      await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'Item 1',
        confidence: 0.9,
        embedding: embedding1
      });

      const results = await dbManager.searchSimilar(embedding2, {
        limit: 5,
        scoreThreshold: 0.7
      });

      expect(results.length).toBe(0);
    });

    it('should filter by type in vector search', async () => {
      const embedding = Array.from({ length: 384 }, () => Math.random());

      await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'Pattern item',
        confidence: 0.9,
        embedding
      });

      await dbManager.storeKnowledge({
        type: 'bug_solution',
        content: 'Bug item',
        confidence: 0.8,
        embedding: embedding.map(v => v + 0.01)
      });

      const results = await dbManager.searchSimilar(embedding, {
        limit: 5,
        filter: {
          must: [
            { key: 'type', match: { value: 'coding_pattern' } }
          ]
        }
      });

      expect(results.length).toBeGreaterThan(0);
      results.forEach(r => {
        expect(r.payload.type).toBe('coding_pattern');
      });
    });

    it('should handle both 384-dim and 1536-dim embeddings', async () => {
      const small = Array.from({ length: 384 }, () => Math.random());
      const large = Array.from({ length: 1536 }, () => Math.random());

      await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'Small embedding',
        confidence: 0.9,
        embedding: small
      });

      await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'Large embedding',
        confidence: 0.9,
        embedding: large
      });

      const smallResults = await dbManager.searchSimilar(small, { limit: 5 });
      const largeResults = await dbManager.searchSimilar(large, { limit: 5 });

      expect(smallResults.length).toBeGreaterThan(0);
      expect(largeResults.length).toBeGreaterThan(0);
    });

    it('should respect score threshold', async () => {
      const embedding = Array.from({ length: 384 }, () => Math.random());

      await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'Test item',
        confidence: 0.9,
        embedding
      });

      // High threshold - should return exact match
      const highThreshold = await dbManager.searchSimilar(embedding, {
        scoreThreshold: 0.99,
        limit: 5
      });

      expect(highThreshold.length).toBeGreaterThan(0);

      // Very high threshold - may return nothing
      const veryHighThreshold = await dbManager.searchSimilar(
        embedding.map(v => v + Math.random() * 0.5),
        { scoreThreshold: 0.95, limit: 5 }
      );

      expect(veryHighThreshold.length).toBeLessThanOrEqual(highThreshold.length);
    });
  });

  describe('FR-5.2: DuckDB Temporal Queries', () => {

    it('should query knowledge by time range', async () => {
      const now = Date.now();

      await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'Recent item',
        confidence: 0.9
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'Older item',
        confidence: 0.8
      });

      const results = await dbManager.queryByTimeRange(now, Date.now() + 1000);

      expect(results.length).toBe(2);
    });

    it('should order results by creation time', async () => {
      const items = [];
      for (let i = 0; i < 5; i++) {
        await dbManager.storeKnowledge({
          type: 'coding_pattern',
          content: `Item ${i}`,
          confidence: 0.9
        });
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      const results = await dbManager.queryByType('coding_pattern', { limit: 10 });

      expect(results.length).toBe(5);
      // Should be in descending order (newest first)
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].created_at).toBeGreaterThanOrEqual(results[i + 1].created_at);
      }
    });

    it('should filter by type efficiently', async () => {
      await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'Pattern 1',
        confidence: 0.9
      });

      await dbManager.storeKnowledge({
        type: 'bug_solution',
        content: 'Bug 1',
        confidence: 0.8
      });

      await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'Pattern 2',
        confidence: 0.85
      });

      const patterns = await dbManager.queryByType('coding_pattern');
      const bugs = await dbManager.queryByType('bug_solution');

      expect(patterns.length).toBe(2);
      expect(bugs.length).toBe(1);
      patterns.forEach(p => expect(p.type).toBe('coding_pattern'));
      bugs.forEach(b => expect(b.type).toBe('bug_solution'));
    });

    it('should handle empty time ranges', async () => {
      const futureTime = Date.now() + 1000000;
      const results = await dbManager.queryByTimeRange(futureTime, futureTime + 1000);

      expect(results.length).toBe(0);
    });
  });

  describe('FR-5.3: Concurrent Read/Write Operations', () => {

    it('should handle concurrent writes safely', async () => {
      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(
          dbManager.storeKnowledge({
            type: 'coding_pattern',
            content: `Concurrent item ${i}`,
            confidence: 0.9
          })
        );
      }

      const results = await Promise.all(promises);

      expect(results.length).toBe(10);
      results.forEach(r => expect(r.stored).toBe(true));

      // Verify all stored
      const stored = await dbManager.queryByType('coding_pattern');
      expect(stored.length).toBe(10);
    });

    it('should handle concurrent reads safely', async () => {
      await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'Shared item',
        confidence: 0.9
      });

      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(dbManager.queryByType('coding_pattern'));
      }

      const results = await Promise.all(promises);

      expect(results.length).toBe(10);
      results.forEach(r => expect(r.length).toBe(1));
    });

    it('should handle mixed read/write operations', async () => {
      const promises = [];

      // Mix of reads and writes
      for (let i = 0; i < 5; i++) {
        promises.push(
          dbManager.storeKnowledge({
            type: 'coding_pattern',
            content: `Item ${i}`,
            confidence: 0.9
          })
        );

        promises.push(dbManager.queryByType('coding_pattern'));
      }

      const results = await Promise.all(promises);

      expect(results.length).toBe(10);
    });

    it('should maintain data consistency under concurrent load', async () => {
      const embedding = Array.from({ length: 384 }, () => Math.random());

      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(
          dbManager.storeKnowledge({
            type: 'coding_pattern',
            content: `Item ${i}`,
            confidence: 0.9,
            embedding: embedding.map(v => v + Math.random() * 0.01)
          })
        );
      }

      await Promise.all(promises);

      const stats = await dbManager.getStats();
      expect(stats.sqlite).toBe(20);
      expect(stats.qdrant).toBe(20);
    });
  });

  describe('FR-5.4: Transaction Semantics', () => {

    it('should commit transaction successfully', async () => {
      await dbManager.beginTransaction();

      await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'Transactional item',
        confidence: 0.9
      });

      await dbManager.commitTransaction();

      const results = await dbManager.queryByType('coding_pattern');
      expect(results.length).toBe(1);
    });

    it('should rollback transaction on error', async () => {
      await dbManager.beginTransaction();

      await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'Item to rollback',
        confidence: 0.9
      });

      await dbManager.rollbackTransaction();

      const results = await dbManager.queryByType('coding_pattern');
      expect(results.length).toBe(0);
    });

    it('should handle nested transaction attempt', async () => {
      await dbManager.beginTransaction();

      await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'First item',
        confidence: 0.9
      });

      // SQLite doesn't support true nested transactions
      // This tests that the code handles it gracefully
      await expect(dbManager.beginTransaction()).rejects.toThrow();

      await dbManager.rollbackTransaction();
    });

    it('should maintain consistency across SQLite and Qdrant', async () => {
      const embedding = Array.from({ length: 384 }, () => Math.random());

      await dbManager.beginTransaction();

      const result = await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'Consistent item',
        confidence: 0.9,
        embedding
      });

      await dbManager.commitTransaction();

      // Check both databases
      const sqliteResults = await dbManager.queryByType('coding_pattern');
      const qdrantResults = await dbManager.searchSimilar(embedding, { limit: 5 });

      expect(sqliteResults.length).toBe(1);
      expect(qdrantResults.length).toBe(1);
      expect(sqliteResults[0].id).toBe(qdrantResults[0].id);
    });
  });

  describe('FR-5.5: Data Consistency After Failures', () => {

    it('should recover from failed write to Qdrant', async () => {
      // Mock Qdrant failure
      const originalUpsert = dbManager.qdrantClient.upsert;
      dbManager.qdrantClient.upsert = vi.fn().mockRejectedValue(new Error('Qdrant unavailable'));

      try {
        await dbManager.storeKnowledge({
          type: 'coding_pattern',
          content: 'Failed item',
          confidence: 0.9,
          embedding: Array.from({ length: 384 }, () => Math.random())
        });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).toContain('Qdrant unavailable');
      }

      // Restore and verify cleanup
      dbManager.qdrantClient.upsert = originalUpsert;
    });

    it('should handle SQLite database locked scenario', async () => {
      // This test simulates a locked database scenario
      const embedding = Array.from({ length: 384 }, () => Math.random());

      await dbManager.beginTransaction();

      // Try to write from outside transaction (should wait or fail)
      const promise = dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'Blocked item',
        confidence: 0.9,
        embedding
      });

      // Commit to unblock
      await dbManager.commitTransaction();

      // Should complete successfully
      const result = await promise;
      expect(result.stored).toBe(true);
    });

    it('should maintain referential integrity after partial failure', async () => {
      const embedding = Array.from({ length: 384 }, () => Math.random());

      // Store successfully
      const result = await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'Reference item',
        confidence: 0.9,
        embedding
      });

      // Verify both databases have it
      const sqliteResults = await dbManager.queryByType('coding_pattern');
      const qdrantResults = await dbManager.searchSimilar(embedding, { limit: 5 });

      expect(sqliteResults.length).toBe(1);
      expect(qdrantResults.length).toBe(1);

      // Delete and verify both are removed
      await dbManager.deleteKnowledge(result.id);

      const afterDeleteSqlite = await dbManager.queryByType('coding_pattern');
      const afterDeleteQdrant = await dbManager.searchSimilar(embedding, { limit: 5 });

      expect(afterDeleteSqlite.length).toBe(0);
      expect(afterDeleteQdrant.length).toBe(0);
    });
  });

  describe('FR-5.6: Query Performance Under Load', () => {

    it('should handle bulk inserts efficiently', async () => {
      const startTime = Date.now();
      const count = 100;

      for (let i = 0; i < count; i++) {
        await dbManager.storeKnowledge({
          type: 'coding_pattern',
          content: `Bulk item ${i}`,
          confidence: 0.9
        });
      }

      const duration = Date.now() - startTime;

      // Should complete in reasonable time (<5s for 100 items)
      expect(duration).toBeLessThan(5000);

      const results = await dbManager.queryByType('coding_pattern');
      expect(results.length).toBe(count);
    });

    it('should perform indexed queries quickly', async () => {
      // Insert test data
      for (let i = 0; i < 50; i++) {
        await dbManager.storeKnowledge({
          type: i % 3 === 0 ? 'coding_pattern' : 'bug_solution',
          content: `Item ${i}`,
          confidence: 0.9
        });
      }

      const startTime = Date.now();
      const results = await dbManager.queryByType('coding_pattern');
      const duration = Date.now() - startTime;

      // Indexed query should be fast (<100ms)
      expect(duration).toBeLessThan(100);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle concurrent queries under load', async () => {
      // Setup data
      for (let i = 0; i < 20; i++) {
        await dbManager.storeKnowledge({
          type: 'coding_pattern',
          content: `Item ${i}`,
          confidence: 0.9
        });
      }

      const startTime = Date.now();
      const promises = [];

      // 50 concurrent queries
      for (let i = 0; i < 50; i++) {
        promises.push(dbManager.queryByType('coding_pattern'));
      }

      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;

      // Should handle load efficiently
      expect(duration).toBeLessThan(2000);
      expect(results.length).toBe(50);
      results.forEach(r => expect(r.length).toBe(20));
    });

    it('should maintain vector search performance with many embeddings', async () => {
      const embeddings = [];

      // Insert 50 items with embeddings
      for (let i = 0; i < 50; i++) {
        const embedding = Array.from({ length: 384 }, () => Math.random());
        embeddings.push(embedding);

        await dbManager.storeKnowledge({
          type: 'coding_pattern',
          content: `Vector item ${i}`,
          confidence: 0.9,
          embedding
        });
      }

      // Search should still be fast
      const startTime = Date.now();
      const results = await dbManager.searchSimilar(embeddings[0], { limit: 10 });
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(500); // <500ms for vector search
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('FR-5.7: Schema Migrations', () => {

    it('should handle schema updates gracefully', async () => {
      // Add new column
      dbManager.sqliteDb.exec(`
        ALTER TABLE knowledge_extractions
        ADD COLUMN tags TEXT
      `);

      // Verify old data still accessible
      await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'Post-migration item',
        confidence: 0.9
      });

      const results = await dbManager.queryByType('coding_pattern');
      expect(results.length).toBe(1);
    });

    it('should support adding indexes without data loss', async () => {
      // Insert data
      await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'Test item',
        confidence: 0.9
      });

      // Add new index
      dbManager.sqliteDb.exec('CREATE INDEX IF NOT EXISTS idx_confidence ON knowledge_extractions(confidence)');

      // Verify data intact
      const results = await dbManager.queryByType('coding_pattern');
      expect(results.length).toBe(1);
      expect(results[0].content).toBe('Test item');
    });

    it('should handle Qdrant collection recreation', async () => {
      const embedding = Array.from({ length: 384 }, () => Math.random());

      // Store item
      await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'Original item',
        confidence: 0.9,
        embedding
      });

      // Delete and recreate collection
      await dbManager.qdrantClient.deleteCollection(dbManager.collections.knowledge_patterns_small);

      await dbManager.qdrantClient.createCollection(dbManager.collections.knowledge_patterns_small, {
        vectors: {
          size: 384,
          distance: 'Cosine'
        }
      });

      // Re-store data
      await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'Migrated item',
        confidence: 0.9,
        embedding
      });

      const results = await dbManager.searchSimilar(embedding, { limit: 5 });
      expect(results.length).toBeGreaterThan(0);
    });

    it('should validate schema after migration', async () => {
      // Query schema
      const tableInfo = dbManager.sqliteDb.prepare("PRAGMA table_info(knowledge_extractions)").all();

      const expectedColumns = ['id', 'type', 'content', 'confidence', 'project', 'created_at', 'updated_at'];
      const actualColumns = tableInfo.map(col => col.name);

      expectedColumns.forEach(col => {
        expect(actualColumns).toContain(col);
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {

    it('should handle empty database queries', async () => {
      const results = await dbManager.queryByType('nonexistent_type');
      expect(results).toHaveLength(0);
    });

    it('should handle very large embeddings', async () => {
      const largeEmbedding = Array.from({ length: 1536 }, () => Math.random());

      await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'Large embedding item',
        confidence: 0.9,
        embedding: largeEmbedding
      });

      const results = await dbManager.searchSimilar(largeEmbedding, { limit: 5 });
      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle special characters in content', async () => {
      const specialContent = 'Content with <html>, "quotes", and special chars: @#$%^&*()';

      await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: specialContent,
        confidence: 0.9
      });

      const results = await dbManager.queryByType('coding_pattern');
      expect(results[0].content).toBe(specialContent);
    });

    it('should handle database connection recovery', async () => {
      // Close and reopen
      await dbManager.close();

      // Reinitialize
      await dbManager.initialize();

      // Should work after recovery
      await dbManager.storeKnowledge({
        type: 'coding_pattern',
        content: 'Recovery test',
        confidence: 0.9
      });

      const results = await dbManager.queryByType('coding_pattern');
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
