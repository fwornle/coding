#!/usr/bin/env node
/**
 * UKB Database CLI - Direct database persistence for knowledge management
 *
 * Replaces JSON-based storage with direct database writes to SQLite + Qdrant.
 * Simple CLI without heavy dependencies.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseManager } from '../../src/databases/DatabaseManager.js';
import { UKBDatabaseWriter } from '../../src/knowledge-management/UKBDatabaseWriter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CLI Configuration
const CLI_VERSION = '2.0.0';

// Global instances
let databaseManager = null;
let writer = null;

/**
 * Initialize database connection and UKB writer
 */
async function initializeDatabase(options = {}) {
  if (writer) return writer;

  try {
    const team = options.team || process.env.CODING_TEAM || 'coding';
    const projectRoot = path.join(__dirname, '..', '..');
    const sqlitePath = process.env.SQLITE_PATH || path.join(projectRoot, '.data', 'knowledge.db');
    const graphDbPath = process.env.GRAPH_DB_PATH || path.join(projectRoot, '.data', 'knowledge-graph');

    // Initialize DatabaseManager
    databaseManager = new DatabaseManager({
      sqlite: {
        path: sqlitePath,
        enabled: true
      },
      qdrant: {
        host: process.env.QDRANT_HOST || 'localhost',
        port: parseInt(process.env.QDRANT_PORT || '6333'),
        enabled: process.env.QDRANT_ENABLED !== 'false'
      },
      graphDbPath: graphDbPath
    });

    await databaseManager.initialize();

    // Initialize UKB writer
    writer = new UKBDatabaseWriter(databaseManager, {
      team,
      debug: options.debug || false
    });

    console.log(`✅ Connected to database (team: ${team})`);
    return writer;

  } catch (error) {
    console.error('Failed to initialize database:', error.message);
    process.exit(1);
  }
}

/**
 * Display help message
 */
function showHelp() {
  console.log(`
UKB Database CLI v${CLI_VERSION}
Direct database persistence for knowledge management

Usage:
  ukb [command] [options]

Commands:
  status                    Show knowledge base status
  add-entity                Add entity from stdin (JSON format)
  add-relation              Add relation from stdin (JSON format)
  import <file>             Import entities and relations from JSON file
  export <file>             Export database to JSON file
  help                      Show this help message

Options:
  --team <team>             Specify team context (default: coding)
  --debug                   Enable debug logging

JSON Input Format (stdin):

For add-entity:
{
  "name": "Entity Name",
  "entityType": "Pattern",
  "significance": 8,
  "observations": ["Observation 1", "Observation 2"],
  "metadata": {}
}

For add-relation:
{
  "from": "Entity1",
  "to": "Entity2",
  "type": "related_to",
  "confidence": 1.0
}

For import file:
{
  "entities": [...],
  "relations": [...]
}

Examples:
  # Show status
  ukb status

  # Add entity from JSON
  echo '{"name":"Pattern","entityType":"Pattern","significance":8}' | ukb add-entity

  # Import batch
  ukb import shared-memory-coding.json

  # Export to JSON
  ukb export backup.json --team coding
`);
}

/**
 * Display status
 */
async function displayStatus(options) {
  console.log('Getting knowledge base status...');

  try {
    const writer = await initializeDatabase(options);
    const stats = await writer.getStatistics();
    const health = databaseManager.getHealth();

    console.log('\n📊 Knowledge Base Status');
    console.log('='.repeat(50));
    console.log(`Storage:        Graph DB + Qdrant (database-first)`);
    console.log(`Team:           ${writer.team}`);
    console.log(`Entities:       ${stats.totalEntities || 0}`);
    console.log(`Relations:      ${stats.relationsByTeamAndType?.length || 0}`);
    console.log(`\nDatabase Health:`);
    console.log(`  Graph DB:     ${health.graphDB?.available ? '✓ Available' : '✗ Unavailable'}`);
    console.log(`  Qdrant:       ${health.qdrant.available ? '✓ Available' : '○ Optional (disabled)'}`);
    console.log(`  SQLite:       ${health.sqlite.available ? '✓ Available (analytics)' : '✗ Unavailable'}`);
    console.log('');

  } catch (error) {
    console.error('Failed to get status:', error.message);
    process.exit(1);
  }
}

/**
 * Add entity from stdin
 */
async function addEntityFromStdin(options) {
  const writer = await initializeDatabase(options);

  return new Promise((resolve, reject) => {
    let input = '';

    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (chunk) => {
      input += chunk;
    });

    process.stdin.on('end', async () => {
      try {
        const entityData = JSON.parse(input.trim());

        if (!entityData.name || !entityData.entityType) {
          console.error('Invalid entity data - name and entityType required');
          process.exit(1);
        }

        console.log(`Creating entity: ${entityData.name}...`);

        const id = await writer.storeEntity(entityData);

        console.log(`✓ Created entity: ${entityData.name} (${id})`);
        resolve();

      } catch (error) {
        console.error('Failed to add entity:', error.message);
        reject(error);
      }
    });
  });
}

/**
 * Add relation from stdin
 */
async function addRelationFromStdin(options) {
  const writer = await initializeDatabase(options);

  return new Promise((resolve, reject) => {
    let input = '';

    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (chunk) => {
      input += chunk;
    });

    process.stdin.on('end', async () => {
      try {
        const relationData = JSON.parse(input.trim());

        if (!relationData.from || !relationData.to || !relationData.type) {
          console.error('Invalid relation data - from, to, and type required');
          process.exit(1);
        }

        console.log(`Creating relation: ${relationData.from} -[${relationData.type}]-> ${relationData.to}...`);

        const id = await writer.storeRelation(relationData);

        console.log(`✓ Created relation (${id})`);
        resolve();

      } catch (error) {
        console.error('Failed to add relation:', error.message);
        reject(error);
      }
    });
  });
}

/**
 * Import batch from file
 */
async function importBatch(filePath, options) {
  const writer = await initializeDatabase(options);

  try {
    console.log(`Reading ${filePath}...`);
    const content = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(content);

    if (!data.entities || !Array.isArray(data.entities)) {
      console.error('Invalid JSON format - expected { entities: [...], relations: [...] }');
      process.exit(1);
    }

    console.log('\n📥 Batch Import');
    console.log('='.repeat(50));
    console.log(`Entities to import:  ${data.entities.length}`);
    if (data.relations) {
      console.log(`Relations to import: ${data.relations.length}`);
    }

    // Import entities
    console.log('\nImporting entities...');
    const entityIds = await writer.storeEntities(data.entities);
    console.log(`✓ Imported ${entityIds.length} entities`);

    // Import relations if present
    if (data.relations && data.relations.length > 0) {
      console.log('Importing relations...');
      const relationIds = await writer.storeRelations(data.relations);
      console.log(`✓ Imported ${relationIds.length} relations`);
    }

    console.log('\n✅ Import complete\n');

  } catch (error) {
    console.error('Import failed:', error.message);
    process.exit(1);
  }
}

/**
 * Export to JSON
 */
async function exportToJson(filePath, options) {
  const writer = await initializeDatabase(options);

  console.log(`Exporting to ${filePath}...`);

  try {
    const limit = parseInt(options.limit) || 5000;
    const data = await writer.exportToJson(limit);

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');

    console.log(`✓ Exported ${data.entities.length} entities and ${data.relations.length} relations`);

  } catch (error) {
    console.error('Export failed:', error.message);
    process.exit(1);
  }
}

/**
 * Parse command line arguments
 */
function parseArgs(args) {
  const options = {
    team: null,
    debug: false,
    limit: '5000'
  };

  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--team' && i + 1 < args.length) {
      options.team = args[++i];
    } else if (arg === '--debug') {
      options.debug = true;
    } else if (arg === '--limit' && i + 1 < args.length) {
      options.limit = args[++i];
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  return { options, positional };
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    return;
  }

  const { options, positional } = parseArgs(args);
  const command = positional[0];

  try {
    switch (command) {
      case 'status':
        await displayStatus(options);
        break;

      case 'add-entity':
        await addEntityFromStdin(options);
        break;

      case 'add-relation':
        await addRelationFromStdin(options);
        break;

      case 'import':
        if (positional.length < 2) {
          console.error('Error: import requires file path');
          console.error('Usage: ukb import <file>');
          process.exit(1);
        }
        await importBatch(positional[1], options);
        break;

      case 'export':
        if (positional.length < 2) {
          console.error('Error: export requires file path');
          console.error('Usage: ukb export <file> [--team <team>] [--limit <number>]');
          process.exit(1);
        }
        await exportToJson(positional[1], options);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.error('Use "ukb help" for usage information');
        process.exit(1);
    }

  } catch (error) {
    console.error('Error:', error.message);
    if (options.debug) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    if (databaseManager) {
      await databaseManager.close();
    }
  }
}

// Error handling
process.on('unhandledRejection', (error) => {
  console.error('Unhandled error:', error.message);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  if (databaseManager) {
    await databaseManager.close();
  }
  process.exit(0);
});

// Run main function
main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
