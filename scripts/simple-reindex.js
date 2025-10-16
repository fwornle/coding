#!/usr/bin/env node

/**
 * Repository & LSL Session Indexer for Qdrant
 * Supports both code repository indexing and LSL session indexing
 *
 * Usage:
 *   node simple-reindex.js                                           # Index coding repo
 *   node simple-reindex.js --lsl <project-path> <collection-name>   # Index LSL sessions
 *
 * Examples:
 *   node simple-reindex.js
 *   node simple-reindex.js --lsl /Users/q284340/Agentic/curriculum-alignment curriculum_alignment
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

class RepositoryIndexer {
  constructor(options = {}) {
    this.qdrant = new QdrantClient({
      url: 'http://localhost:6333'
    });
    this.collection = options.collection || 'coding_infrastructure';
    this.mode = options.mode || 'repo'; // 'repo' or 'lsl'
    this.projectPath = options.projectPath || rootDir;
    this.projectName = options.projectName || path.basename(this.projectPath);
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
          size: 768, // nomic-embed-text-v1 uses 768 dimensions
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

  async indexLSLFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const relativePath = path.relative(this.projectPath, filePath);
      const filename = path.basename(filePath);

      // Skip empty files
      if (content.trim().length === 0) {
        return 0;
      }

      // Parse LSL filename: YYYY-MM-DD_HHMM-HHMM_<user-hash>[_from-<project>].md
      const filenameMatch = filename.match(/^(\d{4}-\d{2}-\d{2})_(\d{4})-(\d{4})_([a-z0-9]+)(_from-([a-zA-Z0-9_-]+))?\.md$/);

      let metadata = {
        file_path: relativePath,
        file_type: '.md',
        session_type: 'lsl',
        project_name: this.projectName,
        indexed_at: new Date().toISOString()
      };

      if (filenameMatch) {
        const [, date, startTime, endTime, userHash, , fromProject] = filenameMatch;
        metadata = {
          ...metadata,
          session_date: date,
          session_start: startTime,
          session_end: endTime,
          user_hash: userHash,
          from_project: fromProject || this.projectName
        };
      }

      // Generate embedding for LSL content (limit to first 3000 chars)
      const textToEmbed = content.substring(0, 3000);
      const embedding = await this.generateEmbedding(textToEmbed);

      // Store in Qdrant - use UUID-safe ID
      const crypto = await import('crypto');
      const pointId = crypto.createHash('md5').update(`${this.projectName}:${relativePath}`).digest('hex');

      await this.qdrant.upsert(this.collection, {
        wait: false,
        points: [{
          id: pointId,
          vector: embedding,
          payload: {
            ...metadata,
            content_preview: content.substring(0, 500)
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

  async indexLSLSessions() {
    console.log(`🔍 Finding LSL session files in ${this.projectPath}...`);

    const lslDir = path.join(this.projectPath, '.specstory', 'history');

    if (!fs.existsSync(lslDir)) {
      console.error(`❌ LSL directory not found: ${lslDir}`);
      return;
    }

    const files = await glob('**/*.md', {
      cwd: lslDir,
      absolute: true
    });

    console.log(`📁 Found ${files.length} LSL session files`);

    // Process all LSL files
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      await this.indexLSLFile(file);

      // Progress update every 25 files
      if ((i + 1) % 25 === 0) {
        console.log(`📊 Progress: ${i + 1}/${files.length} files processed`);
      }
    }

    console.log(`\n✅ LSL indexing complete!`);
    console.log(`   Files processed: ${this.stats.filesProcessed}`);
    console.log(`   Chunks created: ${this.stats.chunksCreated}`);
    console.log(`   Errors: ${this.stats.errors}`);
  }

  async run() {
    try {
      if (this.mode === 'lsl') {
        console.log(`🚀 LSL Session Indexer\n`);
        console.log(`   Project: ${this.projectName}`);
        console.log(`   Collection: ${this.collection}\n`);
      } else {
        console.log('🚀 Repository Indexer\n');
        console.log(`   Collection: ${this.collection}\n`);
      }

      await this.ensureCollection();

      if (this.mode === 'lsl') {
        await this.indexLSLSessions();
      } else {
        await this.indexRepository();
      }

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

// Parse command-line arguments
const args = process.argv.slice(2);
let options = {};

if (args.length > 0 && args[0] === '--lsl') {
  // LSL mode: node simple-reindex.js --lsl <project-path> <collection-name>
  if (args.length < 3) {
    console.error('❌ Usage: node simple-reindex.js --lsl <project-path> <collection-name>');
    console.error('   Example: node simple-reindex.js --lsl /Users/q284340/Agentic/curriculum-alignment curriculum_alignment');
    process.exit(1);
  }

  options = {
    mode: 'lsl',
    projectPath: args[1],
    collection: args[2]
  };
} else if (args.length > 0) {
  console.error('❌ Invalid arguments. Usage:');
  console.error('   node simple-reindex.js                                         # Index coding repo');
  console.error('   node simple-reindex.js --lsl <project-path> <collection-name> # Index LSL sessions');
  process.exit(1);
}

const indexer = new RepositoryIndexer(options);
indexer.run();
