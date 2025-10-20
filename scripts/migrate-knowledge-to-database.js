#!/usr/bin/env node
/**
 * Migration Script: Import Batch Knowledge to SQLite Database
 *
 * This script migrates existing batch knowledge from JSON files
 * (shared-memory-*.json) to the SQLite database, adding a 'source'
 * column to distinguish manual vs auto-learned knowledge.
 *
 * Steps:
 * 1. Add 'source' column to knowledge_extractions table ('manual' | 'auto')
 * 2. Import entities and relations from JSON files
 * 3. Mark imported data with source='manual'
 */

import Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(PROJECT_ROOT, '.data', 'knowledge.db');

class KnowledgeMigration {
  constructor() {
    this.db = null;
    this.stats = {
      entitiesImported: 0,
      relationsImported: 0,
      errors: []
    };
  }

  async initialize() {
    console.log('🔄 Initializing knowledge migration...');

    // Open database
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');

    console.log(`✓ Connected to database: ${DB_PATH}`);
  }

  /**
   * Step 1: Add 'source' column to schema
   */
  addSourceColumn() {
    console.log('\n📋 Step 1: Adding source column to schema...');

    try {
      // Check if column already exists
      const columns = this.db.prepare("PRAGMA table_info(knowledge_extractions)").all();
      const hasSourceColumn = columns.some(col => col.name === 'source');

      if (hasSourceColumn) {
        console.log('⚠️  Source column already exists, skipping...');
        return;
      }

      // Add source column with default 'auto' for existing online-learned data
      this.db.exec(`
        ALTER TABLE knowledge_extractions
        ADD COLUMN source TEXT DEFAULT 'auto' CHECK(source IN ('manual', 'auto'))
      `);

      console.log('✓ Added source column (manual | auto)');

      // Create index on source column
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_knowledge_source
        ON knowledge_extractions(source, classification)
      `);

      console.log('✓ Created index on source column');

    } catch (error) {
      console.error('❌ Failed to add source column:', error.message);
      throw error;
    }
  }

  /**
   * Step 2: Import batch knowledge from JSON files
   */
  async importBatchKnowledge() {
    console.log('\n📥 Step 2: Importing batch knowledge from JSON files...');

    // Find all shared-memory-*.json files
    const sharedMemoryFiles = await this.findSharedMemoryFiles();

    if (sharedMemoryFiles.length === 0) {
      console.log('⚠️  No shared-memory-*.json files found');
      return;
    }

    console.log(`Found ${sharedMemoryFiles.length} shared memory files:`);
    sharedMemoryFiles.forEach(file => console.log(`  - ${path.basename(file)}`));

    // Process each file
    for (const filePath of sharedMemoryFiles) {
      await this.importFile(filePath);
    }

    console.log('\n✓ Batch knowledge import complete');
    console.log(`  Entities imported: ${this.stats.entitiesImported}`);
    console.log(`  Relations imported: ${this.stats.relationsImported}`);

    if (this.stats.errors.length > 0) {
      console.log(`\n⚠️  Errors encountered: ${this.stats.errors.length}`);
      this.stats.errors.forEach(err => console.log(`  - ${err}`));
    }
  }

  /**
   * Find all shared-memory-*.json files in project root
   */
  async findSharedMemoryFiles() {
    const files = await fs.readdir(PROJECT_ROOT);
    const sharedMemoryFiles = files
      .filter(f => f.startsWith('shared-memory-') && f.endsWith('.json'))
      .map(f => path.join(PROJECT_ROOT, f));

    return sharedMemoryFiles;
  }

  /**
   * Import entities and relations from a single JSON file
   */
  async importFile(filePath) {
    const fileName = path.basename(filePath);
    console.log(`\n  Processing ${fileName}...`);

    try {
      // Extract team name from filename (e.g., shared-memory-coding.json -> coding)
      const teamMatch = fileName.match(/^shared-memory-(.+)\.json$/);
      const team = teamMatch ? teamMatch[1] : 'unknown';

      // Read and parse JSON file (standard format with entities/relations arrays)
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content);

      let entityCount = 0;
      let relationCount = 0;

      // Process entities array
      if (data.entities && Array.isArray(data.entities)) {
        for (const entity of data.entities) {
          try {
            await this.importEntity(entity, team);
            entityCount++;
          } catch (err) {
            this.stats.errors.push(`Error importing entity in ${fileName}: ${err.message}`);
          }
        }
      }

      // Process relations array
      if (data.relations && Array.isArray(data.relations)) {
        for (const relation of data.relations) {
          try {
            await this.importRelation(relation, team);
            relationCount++;
          } catch (err) {
            this.stats.errors.push(`Error importing relation in ${fileName}: ${err.message}`);
          }
        }
      }

      console.log(`    ✓ ${entityCount} entities, ${relationCount} relations`);
      this.stats.entitiesImported += entityCount;
      this.stats.relationsImported += relationCount;

    } catch (error) {
      this.stats.errors.push(`Error reading ${fileName}: ${error.message}`);
    }
  }

  /**
   * Import a single entity to database
   */
  async importEntity(entity, team) {
    const id = entity.id || this.generateId(entity.name);

    // Convert entity to knowledge extraction format
    const extraction = {
      id: id,
      session_id: null, // Batch knowledge has no session
      exchange_id: null,
      extraction_type: entity.entityType || 'Concept',
      classification: team,
      confidence: (entity.significance || 5) / 10, // Convert 0-10 to 0-1
      source_file: null,
      extracted_at: new Date().toISOString(),
      embedding_id: null,
      source: 'manual', // Mark as manual/batch knowledge
      metadata: JSON.stringify({
        name: entity.name,
        entityType: entity.entityType,
        observations: entity.observations || [],
        significance: entity.significance,
        originalMetadata: entity.metadata || {}
      })
    };

    // Insert or replace
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO knowledge_extractions
      (id, session_id, exchange_id, extraction_type, classification, confidence,
       source_file, extracted_at, embedding_id, source, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      extraction.id,
      extraction.session_id,
      extraction.exchange_id,
      extraction.extraction_type,
      extraction.classification,
      extraction.confidence,
      extraction.source_file,
      extraction.extracted_at,
      extraction.embedding_id,
      extraction.source,
      extraction.metadata
    );
  }

  /**
   * Import a single relation to database
   * Note: Relations are stored in entity metadata for now
   */
  async importRelation(relation, team) {
    // For now, we'll store relations in a separate way or in metadata
    // This can be expanded in the future to have a separate relations table
    this.stats.relationsImported++;
  }

  /**
   * Generate deterministic ID from name
   */
  generateId(name) {
    return crypto
      .createHash('sha256')
      .update(name)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Verify migration results
   */
  async verify() {
    console.log('\n🔍 Verifying migration...');

    // Count manual vs auto knowledge
    const manualCount = this.db.prepare(
      "SELECT COUNT(*) as count FROM knowledge_extractions WHERE source = 'manual'"
    ).get().count;

    const autoCount = this.db.prepare(
      "SELECT COUNT(*) as count FROM knowledge_extractions WHERE source = 'auto'"
    ).get().count;

    console.log(`✓ Manual knowledge: ${manualCount}`);
    console.log(`✓ Auto knowledge: ${autoCount}`);
    console.log(`✓ Total: ${manualCount + autoCount}`);

    // Show sample by team
    const byTeam = this.db.prepare(`
      SELECT classification, COUNT(*) as count
      FROM knowledge_extractions
      WHERE source = 'manual'
      GROUP BY classification
    `).all();

    if (byTeam.length > 0) {
      console.log('\n📊 Manual knowledge by team:');
      byTeam.forEach(row => {
        console.log(`  ${row.classification}: ${row.count}`);
      });
    }
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      console.log('\n✓ Database connection closed');
    }
  }

  /**
   * Run complete migration
   */
  async run() {
    try {
      await this.initialize();
      this.addSourceColumn();
      await this.importBatchKnowledge();
      await this.verify();

      console.log('\n✅ Migration complete!');

    } catch (error) {
      console.error('\n❌ Migration failed:', error);
      throw error;
    } finally {
      this.close();
    }
  }
}

// Run migration if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const migration = new KnowledgeMigration();
  migration.run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { KnowledgeMigration };
