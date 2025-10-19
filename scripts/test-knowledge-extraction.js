#!/usr/bin/env node

/**
 * E2E Test for Knowledge Extraction System
 *
 * Tests the full knowledge extraction pipeline:
 * 1. Database initialization (Qdrant + SQLite)
 * 2. Embedding generation
 * 3. Knowledge extraction from sample session
 * 4. Knowledge storage and retrieval
 *
 * Usage:
 *   node scripts/test-knowledge-extraction.js [--verbose]
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import { DatabaseManager } from '../src/databases/DatabaseManager.js';
import { EmbeddingGenerator } from '../src/knowledge-management/EmbeddingGenerator.js';
import { UnifiedInferenceEngine } from '../src/inference/UnifiedInferenceEngine.js';
import { KnowledgeExtractor } from '../src/knowledge-management/KnowledgeExtractor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectPath = join(__dirname, '..');

class KnowledgeExtractionTest {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.testsPassed = 0;
    this.testsFailed = 0;
  }

  log(message, level = 'info') {
    const prefix = {
      'info': '  ℹ️ ',
      'success': '  ✅',
      'error': '  ❌',
      'test': '🧪'
    }[level] || '  ';

    console.log(`${prefix} ${message}`);
  }

  async runTest(testName, testFn) {
    this.log(`${testName}...`, 'test');
    try {
      await testFn();
      this.testsPassed++;
      this.log(`${testName} - PASSED`, 'success');
      return true;
    } catch (error) {
      this.testsFailed++;
      this.log(`${testName} - FAILED: ${error.message}`, 'error');
      if (this.verbose) {
        console.error(error.stack);
      }
      return false;
    }
  }

  async run() {
    console.log('\n🔬 Knowledge Extraction E2E Test');
    console.log('==================================\n');

    // Test 1: Database Manager Initialization
    await this.runTest('Database Manager Initialization', async () => {
      this.databaseManager = new DatabaseManager({
        projectPath,
        debug: this.verbose
      });

      await this.databaseManager.initialize();

      if (!this.databaseManager.initialized) {
        throw new Error('DatabaseManager failed to initialize');
      }

      if (!this.databaseManager.health.sqlite.available) {
        throw new Error('SQLite database not available (required)');
      }

      this.log('SQLite: available', 'info');

      if (this.databaseManager.health.qdrant.available) {
        this.log('Qdrant: available', 'info');
      } else {
        this.log('Qdrant: not available (optional)', 'info');
      }
    });

    // Test 2: Embedding Generator Initialization
    await this.runTest('Embedding Generator Initialization', async () => {
      this.embeddingGenerator = new EmbeddingGenerator({
        projectPath,
        databaseManager: this.databaseManager,
        debug: this.verbose
      });

      // EmbeddingGenerator doesn't have explicit initialization
      // but we can test it by generating a sample embedding
      const testEmbedding = await this.embeddingGenerator.generate(
        'This is a test knowledge pattern',
        { vectorSize: 384 }
      );

      if (!testEmbedding || !Array.isArray(testEmbedding) || testEmbedding.length !== 384) {
        throw new Error('Embedding generation failed or returned invalid format');
      }

      this.log(`Generated 384-dim embedding`, 'info');
    });

    // Test 3: Inference Engine Initialization
    await this.runTest('Inference Engine Initialization', async () => {
      this.inferenceEngine = new UnifiedInferenceEngine({
        projectPath,
        debug: this.verbose
      });

      // UnifiedInferenceEngine initializes lazily, so just verify it was created
      if (!this.inferenceEngine) {
        throw new Error('InferenceEngine creation failed');
      }

      this.log('Inference engine ready', 'info');
    });

    // Test 4: Knowledge Extractor Initialization
    await this.runTest('Knowledge Extractor Initialization', async () => {
      this.knowledgeExtractor = new KnowledgeExtractor({
        databaseManager: this.databaseManager,
        embeddingGenerator: this.embeddingGenerator,
        inferenceEngine: this.inferenceEngine,
        minConfidence: 0.6,
        debug: this.verbose
      });

      await this.knowledgeExtractor.initialize();

      if (!this.knowledgeExtractor.initialized) {
        throw new Error('KnowledgeExtractor failed to initialize');
      }

      this.log('Knowledge extractor ready', 'info');
    });

    // Test 5: Create Sample Session File
    await this.runTest('Create Sample Session File', async () => {
            const sampleSession = `# Session Log: 2025-10-19 14:00-15:00

## User

How do I implement a simple caching pattern in JavaScript?

## Assistant

Here's a simple caching pattern using a Map:

\`\`\`javascript
class SimpleCache {
  constructor(maxSize = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key) {
    return this.cache.get(key);
  }

  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  has(key) {
    return this.cache.has(key);
  }
}
\`\`\`

This implements a basic LRU (Least Recently Used) cache with a maximum size limit.

## User

Can you add a TTL (Time To Live) feature?

## Assistant

Sure! Here's the enhanced version with TTL:

\`\`\`javascript
class CacheWithTTL {
  constructor(maxSize = 100, defaultTTL = 60000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
  }

  set(key, value, ttl = this.defaultTTL) {
    const entry = {
      value,
      expiry: Date.now() + ttl
    };
    this.cache.set(key, entry);

    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }
}
\`\`\`

This version adds expiration tracking for each cache entry.
`;

      const testDir = join(projectPath, '.test-data');
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }

      this.sampleSessionPath = join(testDir, 'test-session.md');
      fs.writeFileSync(this.sampleSessionPath, sampleSession, 'utf-8');

      this.log(`Created sample session at ${this.sampleSessionPath}`, 'info');
    });

    // Test 6: Extract Knowledge from Session
    await this.runTest('Extract Knowledge from Session', async () => {
      const knowledge = await this.knowledgeExtractor.extractFromSession(
        this.sampleSessionPath
      );

      if (!Array.isArray(knowledge)) {
        throw new Error('Expected array of knowledge items');
      }

      this.log(`Extracted ${knowledge.length} knowledge items`, 'info');

      if (knowledge.length > 0) {
        const firstItem = knowledge[0];
        this.log(`First item type: ${firstItem.knowledgeType}`, 'info');
        this.log(`First item confidence: ${firstItem.confidence.toFixed(2)}`, 'info');
      }

      this.extractedKnowledge = knowledge;
    });

    // Test 7: Verify Knowledge Storage
    if (this.databaseManager.health.sqlite.available) {
      await this.runTest('Verify Knowledge Storage in SQLite', async () => {
        const db = this.databaseManager.sqlite;

        const knowledgeCount = db.prepare(
          'SELECT COUNT(*) as count FROM knowledge_extractions'
        ).get();

        if (knowledgeCount.count === 0) {
          throw new Error('No knowledge stored in database');
        }

        this.log(`Found ${knowledgeCount.count} entries in database`, 'info');
      });
    }

    // Test 8: Cleanup
    await this.runTest('Cleanup Test Data', async () => {
      if (fs.existsSync(this.sampleSessionPath)) {
        fs.unlinkSync(this.sampleSessionPath);
      }

      const testDir = join(projectPath, '.test-data');
      if (fs.existsSync(testDir)) {
        fs.rmdirSync(testDir);
      }

      this.log('Test data cleaned up', 'info');
    });

    // Print summary
    this.printSummary();
  }

  printSummary() {
    console.log('\n==================================');
    console.log('Test Summary:');
    console.log(`  ✅ Passed: ${this.testsPassed}`);
    console.log(`  ❌ Failed: ${this.testsFailed}`);
    console.log(`  📊 Total:  ${this.testsPassed + this.testsFailed}`);
    console.log('==================================\n');

    if (this.testsFailed === 0) {
      console.log('🎉 All tests passed!\n');
      process.exit(0);
    } else {
      console.log('⚠️  Some tests failed. Check output above for details.\n');
      process.exit(1);
    }
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  verbose: args.includes('--verbose') || args.includes('-v')
};

// Run tests
const test = new KnowledgeExtractionTest(options);
test.run().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
