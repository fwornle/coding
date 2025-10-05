#!/usr/bin/env node

/**
 * Simple Repository Indexer for Qdrant
 * Populates coding_infrastructure collection with repository content
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';
import { getFastEmbeddingGenerator } from './fast-embedding-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

class SimpleIndexer {
  constructor() {
    this.qdrant = new QdrantClient({
      url: 'http://localhost:6333'
    });
    this.collection = 'coding_infrastructure';
    this.embeddingGenerator = getFastEmbeddingGenerator();
    this.stats = {
      filesProcessed: 0,
      chunksCreated: 0,
      errors: 0
    };
  }

  async ensureCollection() {
    try {
      await this.qdrant.getCollection(this.collection);
      console.log(`✅ Collection '${this.collection}' exists`);
    } catch (error) {
      console.log(`📦 Creating collection '${this.collection}'...`);
      await this.qdrant.createCollection(this.collection, {
        vectors: {
          size: 384,
          distance: 'Cosine'
        },
        optimizers_config: {
          indexing_threshold: 10000
        },
        hnsw_config: {
          m: 16,
          ef_construct: 100
        }
      });
      console.log(`✅ Collection created`);
    }
  }

  async generateEmbedding(text) {
    // Fast native JavaScript embedding (10-100x faster than Python spawning)
    return await this.embeddingGenerator.generate(text);
  }

  async indexFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const relativePath = path.relative(rootDir, filePath);

      // Skip empty files
      if (content.trim().length === 0) {
        return 0;
      }

      // Generate embedding for file content (limit to first 3000 chars for speed)
      const textToEmbed = content.substring(0, 3000);
      const embedding = await this.generateEmbedding(textToEmbed);

      // Store in Qdrant - use UUID-safe ID
      const crypto = await import('crypto');
      const pointId = crypto.createHash('md5').update(relativePath).digest('hex');

      await this.qdrant.upsert(this.collection, {
        wait: false, // Don't wait for indexing - faster
        points: [{
          id: pointId,
          vector: embedding,
          payload: {
            file_path: relativePath,
            file_type: path.extname(filePath),
            content_preview: content.substring(0, 500),
            indexed_at: new Date().toISOString()
          }
        }]
      });

      this.stats.filesProcessed++;
      this.stats.chunksCreated++;

      return 1;
    } catch (error) {
      console.error(`❌ Failed to index ${filePath}: ${error.message}`);
      this.stats.errors++;
      return 0;
    }
  }

  async indexRepository() {
    console.log('🔍 Finding files to index...');

    const patterns = [
      'src/**/*.js',
      'scripts/**/*.js',
      'scripts/**/*.cjs',
      'docs/**/*.md',
      'config/**/*.json'
    ];

    const excludePatterns = [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/*.test.js',
      '**/*.spec.js'
    ];

    const files = await glob(patterns, {
      cwd: rootDir,
      absolute: true,
      ignore: excludePatterns
    });

    console.log(`📁 Found ${files.length} files to index`);

    // Process all files
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      await this.indexFile(file);

      // Progress update every 25 files
      if ((i + 1) % 25 === 0) {
        console.log(`📊 Progress: ${i + 1}/${files.length} files processed`);
      }
    }

    console.log(`\n✅ Indexing complete!`);
    console.log(`   Files processed: ${this.stats.filesProcessed}`);
    console.log(`   Chunks created: ${this.stats.chunksCreated}`);
    console.log(`   Errors: ${this.stats.errors}`);
  }

  async run() {
    try {
      console.log('🚀 Simple Repository Indexer\n');

      await this.ensureCollection();
      await this.indexRepository();

      // Verify results
      const info = await this.qdrant.getCollection(this.collection);
      console.log(`\n📊 Collection stats:`);
      console.log(`   Points: ${info.points_count}`);
      console.log(`   Indexed vectors: ${info.indexed_vectors_count}`);

    } catch (error) {
      console.error('❌ Indexing failed:', error.message);
      process.exit(1);
    }
  }
}

const indexer = new SimpleIndexer();
indexer.run();
