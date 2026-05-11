#!/usr/bin/env node
/**
 * Database Initialization Script
 *
 * Initializes Qdrant collections and SQLite tables for the Continuous Learning Knowledge System.
 *
 * Usage:
 *   node scripts/init-databases.js [--skip-qdrant] [--force]
 *
 * Options:
 *   --skip-qdrant  Skip Qdrant initialization (useful if Qdrant is not available)
 *   --force        Force reinitialization even if databases already exist
 *   --help         Show this help message
 */

import { DatabaseManager } from '../src/databases/DatabaseManager.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CODING_ROOT = path.resolve(__dirname, '..');

// Parse command line arguments
const args = process.argv.slice(2);
const skipQdrant = args.includes('--skip-qdrant');
const force = args.includes('--force');
const help = args.includes('--help') || args.includes('-h');

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function showHelp() {
  log('\n📊 Continuous Learning Knowledge System - Database Initialization\n', 'cyan');
  log('Usage:', 'blue');
  log('  node scripts/init-databases.js [options]\n');
  log('Options:', 'blue');
  log('  --skip-qdrant  Skip Qdrant initialization (if Qdrant not available)');
  log('  --force        Force reinitialization (recreate existing databases)');
  log('  --help, -h     Show this help message\n');
  log('Environment Variables:', 'blue');
  log('  QDRANT_URL     Qdrant server URL (default: http://localhost:6333)');
  log('  SQLITE_PATH    SQLite database path (default: $CODING_ROOT/.data/knowledge.db)\n');
  log('Examples:', 'blue');
  log('  node scripts/init-databases.js');
  log('  node scripts/init-databases.js --skip-qdrant');
  log('  QDRANT_URL=http://qdrant:6333 node scripts/init-databases.js\n');
}

async function initializeDatabases() {
  try {
    log('\n🚀 Initializing Continuous Learning Knowledge System Databases\n', 'cyan');

    // Get configuration from environment or use defaults
    const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
    const sqlitePath = process.env.SQLITE_PATH || path.join(CODING_ROOT, '.data', 'knowledge.db');

    // Ensure .data directory exists
    const dataDir = path.dirname(sqlitePath);
    if (!fs.existsSync(dataDir)) {
      log(`📁 Creating data directory: ${dataDir}`, 'blue');
      fs.mkdirSync(dataDir, { recursive: true });
    }

    log('Configuration:', 'blue');
    log(`  Qdrant URL: ${qdrantUrl}${skipQdrant ? ' (SKIPPED)' : ''}`);
    log(`  SQLite Path: ${sqlitePath}`);
    log(`  Force Mode: ${force ? 'YES' : 'NO'}\n`);

    // Initialize DatabaseManager
    log('🔧 Initializing DatabaseManager...', 'blue');
    const dbManager = new DatabaseManager({
      qdrant: skipQdrant ? { enabled: false } : {
        host: qdrantUrl.includes('://') ? new URL(qdrantUrl).hostname : qdrantUrl.split(':')[0],
        port: qdrantUrl.includes('://') ? parseInt(new URL(qdrantUrl).port || '6333') : parseInt(qdrantUrl.split(':')[1] || '6333')
      },
      sqlite: {
        path: sqlitePath
      }
    });

    // Initialize databases
    log('📊 Initializing databases...', 'blue');
    await dbManager.initialize();

    // Check health
    const health = await dbManager.getHealth();
    log('\n✅ Database Initialization Complete!\n', 'green');

    log('Health Status:', 'cyan');
    log(`  Qdrant: ${health.qdrant ? '✅ Connected' : '❌ Not available (skipped)'}`, health.qdrant ? 'green' : 'yellow');
    log(`  SQLite: ${health.sqlite ? '✅ Connected' : '❌ Error'}`, health.sqlite ? 'green' : 'red');

    if (health.qdrant) {
      log('\n📦 Qdrant Collections:', 'cyan');
      log('  • knowledge_patterns (1536-dim) - High-quality OpenAI embeddings');
      log('  • knowledge_patterns_small (384-dim) - Fast local embeddings');
      log('  • session_memory (384-dim) - Session-level knowledge');
    }

    log('\n📊 SQLite Tables:', 'cyan');
    log('  • budget_events - LLM cost tracking');
    log('  • knowledge_extractions - Extracted knowledge metadata');
    log('  • session_metrics - Session-level analytics');
    log('  • embedding_cache - Avoid re-generating embeddings');

    // Close connections
    await dbManager.close();

    log('\n🎉 Databases are ready for use!\n', 'green');
    log('Next Steps:', 'blue');
    log('  1. Start Qdrant if not running: docker run -p 6333:6333 qdrant/qdrant');
    log('  2. Configure API keys in .env (GROQ_API_KEY, ANTHROPIC_API_KEY)');
    log('  3. Start using the Continuous Learning System\n');

    process.exit(0);
  } catch (error) {
    log('\n❌ Database Initialization Failed\n', 'red');
    log(`Error: ${error.message}`, 'red');

    if (error.message.includes('Qdrant') || error.message.includes('ECONNREFUSED')) {
      log('\n💡 Tip: If Qdrant is not available, you can:', 'yellow');
      log('  • Start Qdrant: docker run -p 6333:6333 qdrant/qdrant', 'yellow');
      log('  • Skip Qdrant: node scripts/init-databases.js --skip-qdrant', 'yellow');
      log('  • Set custom URL: QDRANT_URL=http://yourhost:6333 node scripts/init-databases.js\n', 'yellow');
    }

    if (error.stack) {
      log('\nStack trace:', 'red');
      console.error(error.stack);
    }

    process.exit(1);
  }
}

// Main execution
if (help) {
  showHelp();
  process.exit(0);
}

initializeDatabases();
