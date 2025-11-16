#!/usr/bin/env node
/**
 * Database Schema Migration Script
 *
 * Migrates the existing knowledge.db to the new schema with:
 * - team column for multi-team support
 * - last_modified column for tracking updates
 * - entity_name, entity_type, observations columns for direct entity storage
 * - knowledge_relations table for entity relationships
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { runIfMain } from '../lib/utils/esm-cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(PROJECT_ROOT, '.data', 'knowledge.db');

class SchemaMigration {
  constructor() {
    this.db = null;
  }

  async run() {
    console.log('🔄 Database Schema Migration');
    console.log('='.repeat(50));
    console.log(`Database: ${DB_PATH}\n`);

    try {
      // Open database
      this.db = new Database(DB_PATH);
      this.db.pragma('journal_mode = WAL');

      console.log('✓ Connected to database\n');

      // Check current schema
      await this.checkCurrentSchema();

      // Run migrations
      await this.addMissingColumns();
      await this.createRelationsTable();
      await this.createIndexes();

      console.log('\n✅ Migration complete!');
      console.log('\nYou can now use the database-first UKB CLI.');

    } catch (error) {
      console.error('\n❌ Migration failed:', error.message);
      throw error;
    } finally {
      if (this.db) {
        this.db.close();
        console.log('\n✓ Database connection closed');
      }
    }
  }

  async checkCurrentSchema() {
    console.log('📋 Checking current schema...');

    const columns = this.db.pragma('table_info(knowledge_extractions)');
    const columnNames = columns.map(c => c.name);

    console.log(`  Current columns: ${columnNames.join(', ')}`);

    const missingColumns = ['team', 'last_modified', 'entity_name', 'entity_type', 'observations']
      .filter(col => !columnNames.includes(col));

    if (missingColumns.length > 0) {
      console.log(`  Missing columns: ${missingColumns.join(', ')}`);
    } else {
      console.log('  All required columns present');
    }

    // Check if relations table exists
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const hasRelationsTable = tables.some(t => t.name === 'knowledge_relations');

    if (!hasRelationsTable) {
      console.log('  Missing table: knowledge_relations');
    } else {
      console.log('  knowledge_relations table exists');
    }

    console.log('');
  }

  async addMissingColumns() {
    console.log('🔧 Adding missing columns to knowledge_extractions...');

    const columns = this.db.pragma('table_info(knowledge_extractions)');
    const columnNames = columns.map(c => c.name);

    // Add team column
    if (!columnNames.includes('team')) {
      console.log('  Adding column: team');
      this.db.exec(`
        ALTER TABLE knowledge_extractions
        ADD COLUMN team TEXT DEFAULT 'coding'
      `);
    }

    // Add last_modified column (use NULL default, then update)
    if (!columnNames.includes('last_modified')) {
      console.log('  Adding column: last_modified');
      this.db.exec(`
        ALTER TABLE knowledge_extractions
        ADD COLUMN last_modified TEXT
      `);

      // Update existing rows with extracted_at value or current timestamp
      this.db.exec(`
        UPDATE knowledge_extractions
        SET last_modified = COALESCE(extracted_at, datetime('now'))
        WHERE last_modified IS NULL
      `);
    }

    // Add entity_name column
    if (!columnNames.includes('entity_name')) {
      console.log('  Adding column: entity_name');
      this.db.exec(`
        ALTER TABLE knowledge_extractions
        ADD COLUMN entity_name TEXT
      `);
    }

    // Add entity_type column
    if (!columnNames.includes('entity_type')) {
      console.log('  Adding column: entity_type');
      this.db.exec(`
        ALTER TABLE knowledge_extractions
        ADD COLUMN entity_type TEXT
      `);
    }

    // Add observations column
    if (!columnNames.includes('observations')) {
      console.log('  Adding column: observations');
      this.db.exec(`
        ALTER TABLE knowledge_extractions
        ADD COLUMN observations TEXT
      `);
    }

    console.log('✓ Columns added successfully\n');
  }

  async createRelationsTable() {
    console.log('🔗 Creating knowledge_relations table...');

    // Check if table exists
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const hasRelationsTable = tables.some(t => t.name === 'knowledge_relations');

    if (hasRelationsTable) {
      console.log('  Table already exists, skipping\n');
      return;
    }

    this.db.exec(`
      CREATE TABLE knowledge_relations (
        id TEXT PRIMARY KEY,
        from_entity_id TEXT NOT NULL,
        to_entity_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        metadata TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        team TEXT DEFAULT 'coding',
        FOREIGN KEY (from_entity_id) REFERENCES knowledge_extractions(id) ON DELETE CASCADE,
        FOREIGN KEY (to_entity_id) REFERENCES knowledge_extractions(id) ON DELETE CASCADE
      )
    `);

    console.log('✓ knowledge_relations table created\n');
  }

  async createIndexes() {
    console.log('📇 Creating indexes...');

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge_extractions(source, team)',
      'CREATE INDEX IF NOT EXISTS idx_knowledge_team ON knowledge_extractions(team, last_modified)',
      'CREATE INDEX IF NOT EXISTS idx_knowledge_entity_name ON knowledge_extractions(entity_name)',
      'CREATE INDEX IF NOT EXISTS idx_relations_from ON knowledge_relations(from_entity_id)',
      'CREATE INDEX IF NOT EXISTS idx_relations_to ON knowledge_relations(to_entity_id)',
      'CREATE INDEX IF NOT EXISTS idx_relations_team ON knowledge_relations(team)',
      'CREATE INDEX IF NOT EXISTS idx_relations_type ON knowledge_relations(relation_type)'
    ];

    for (const indexSQL of indexes) {
      this.db.exec(indexSQL);
    }

    console.log('✓ Indexes created successfully');
  }
}

// Run migration if called directly
runIfMain(import.meta.url, () => {
  const migration = new SchemaMigration();
  migration.run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
});

export { SchemaMigration };
