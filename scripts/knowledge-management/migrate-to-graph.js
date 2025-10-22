#!/usr/bin/env node
/**
 * Knowledge Migration CLI
 *
 * Migrates knowledge data from SQLite to Graph database.
 *
 * Usage:
 *   node migrate-to-graph.js              # Run migration
 *   node migrate-to-graph.js --dry-run    # Preview migration without changes
 *   node migrate-to-graph.js --help       # Show help
 */

import { GraphMigrationService } from '../../src/knowledge-management/GraphMigrationService.js';
import { DatabaseManager } from '../../src/databases/DatabaseManager.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const showHelp = args.includes('--help') || args.includes('-h');

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function showHelpMessage() {
  console.log(`
${colors.bright}Knowledge Migration CLI${colors.reset}

Migrates knowledge data from SQLite to Graph database.

${colors.bright}Usage:${colors.reset}
  node migrate-to-graph.js              ${colors.dim}# Run migration${colors.reset}
  node migrate-to-graph.js --dry-run    ${colors.dim}# Preview migration without changes${colors.reset}
  node migrate-to-graph.js --help       ${colors.dim}# Show this help message${colors.reset}

${colors.bright}Migration Process:${colors.reset}
  1. ${colors.cyan}Backup${colors.reset}    - Create timestamped backup of SQLite database
  2. ${colors.cyan}Extract${colors.reset}   - Retrieve all entities and relations from SQLite
  3. ${colors.cyan}Transform${colors.reset} - Convert SQLite rows to graph format
  4. ${colors.cyan}Load${colors.reset}      - Store entities and relations in graph database
  5. ${colors.cyan}Verify${colors.reset}    - Compare counts and validate data integrity

${colors.bright}Environment Variables:${colors.reset}
  SQLITE_PATH       Path to SQLite database (default: .data/knowledge.db)
  GRAPH_DB_PATH     Path to graph database (default: .data/knowledge-graph)

${colors.bright}Recovery:${colors.reset}
  If migration fails, the system automatically rolls back to the backup.
  Backups are stored in: .data/backups/

${colors.bright}Examples:${colors.reset}
  ${colors.dim}# Preview migration${colors.reset}
  node migrate-to-graph.js --dry-run

  ${colors.dim}# Run migration${colors.reset}
  node migrate-to-graph.js

  ${colors.dim}# Use custom database paths${colors.reset}
  SQLITE_PATH=/custom/path.db GRAPH_DB_PATH=/custom/graph node migrate-to-graph.js
`);
}

async function runDryRun(databaseManager) {
  console.log(`\n${colors.bright}${colors.blue}🔍 DRY RUN MODE${colors.reset}\n`);
  console.log('━'.repeat(60));

  try {
    // Count entities and relations
    const entityCount = databaseManager.sqlite
      .prepare('SELECT COUNT(*) as count FROM knowledge_extractions')
      .get().count;

    const relationCount = databaseManager.sqlite
      .prepare('SELECT COUNT(*) as count FROM knowledge_relations')
      .get().count;

    // Get teams
    const teams = databaseManager.sqlite
      .prepare('SELECT DISTINCT team FROM knowledge_extractions')
      .all();

    // Get entity types
    const types = databaseManager.sqlite
      .prepare('SELECT entity_type, COUNT(*) as count FROM knowledge_extractions GROUP BY entity_type')
      .all();

    console.log(`\n${colors.bright}Migration Preview:${colors.reset}`);
    console.log(`  ${colors.green}✓${colors.reset} Entities to migrate: ${colors.bright}${entityCount}${colors.reset}`);
    console.log(`  ${colors.green}✓${colors.reset} Relations to migrate: ${colors.bright}${relationCount}${colors.reset}`);

    console.log(`\n${colors.bright}Teams:${colors.reset}`);
    teams.forEach(t => {
      const teamEntityCount = databaseManager.sqlite
        .prepare('SELECT COUNT(*) as count FROM knowledge_extractions WHERE team = ?')
        .get(t.team).count;
      console.log(`  ${colors.cyan}•${colors.reset} ${t.team}: ${teamEntityCount} entities`);
    });

    console.log(`\n${colors.bright}Entity Types:${colors.reset}`);
    types.forEach(type => {
      console.log(`  ${colors.cyan}•${colors.reset} ${type.entity_type}: ${type.count}`);
    });

    console.log('\n' + '━'.repeat(60));
    console.log(`\n${colors.yellow}No changes will be made in dry-run mode.${colors.reset}`);
    console.log(`Run without ${colors.bright}--dry-run${colors.reset} to perform the migration.\n`);

    return true;
  } catch (error) {
    console.error(`\n${colors.red}✗ Dry run failed:${colors.reset}`, error.message);
    return false;
  }
}

async function runMigration(databaseManager, graphDatabase) {
  console.log(`\n${colors.bright}${colors.green}🚀 MIGRATION MODE${colors.reset}\n`);
  console.log('━'.repeat(60));

  const migrationService = new GraphMigrationService(
    databaseManager,
    graphDatabase,
    { debug: false }
  );

  // Track progress
  let currentPhase = '';
  let progressStart = 0;

  migrationService.on('migration:started', (data) => {
    console.log(`\n${colors.bright}Starting migration...${colors.reset}`);
    console.log(`  Timestamp: ${data.timestamp}\n`);
  });

  migrationService.on('phase:started', (data) => {
    currentPhase = data.phase;
    progressStart = Date.now();
    const phaseNames = {
      backup: '📦 Backup',
      extract: '📤 Extract',
      transform: '🔄 Transform',
      load: '📥 Load',
      verify: '✅ Verify'
    };
    console.log(`${phaseNames[data.phase] || data.phase}...`);
  });

  migrationService.on('phase:completed', (data) => {
    const duration = Date.now() - progressStart;
    if (data.phase === 'backup') {
      console.log(`  ${colors.green}✓${colors.reset} Backup created: ${path.basename(data.backupPath)} (${duration}ms)`);
    } else if (data.phase === 'extract') {
      console.log(`  ${colors.green}✓${colors.reset} Extracted ${data.entityCount} entities, ${data.relationCount} relations (${duration}ms)`);
    } else if (data.phase === 'transform') {
      console.log(`  ${colors.green}✓${colors.reset} Transformation complete (${duration}ms)`);
    } else if (data.phase === 'load') {
      console.log(`  ${colors.green}✓${colors.reset} Data loaded into graph database (${duration}ms)`);
    } else if (data.phase === 'verify') {
      console.log(`  ${colors.green}✓${colors.reset} Verification passed (${duration}ms)`);
    }
  });

  migrationService.on('progress', (data) => {
    if (data.phase === 'load') {
      const percentage = Math.round((data.loaded / data.total) * 100);
      process.stdout.write(`\r  Progress: ${data.loaded}/${data.total} ${data.type} (${percentage}%)`);
      if (data.loaded === data.total) {
        process.stdout.write('\n');
      }
    }
  });

  migrationService.on('migration:failed', (data) => {
    console.log(`\n${colors.red}✗ Migration failed:${colors.reset} ${data.error}`);
    if (data.backupPath) {
      console.log(`  ${colors.yellow}⟲${colors.reset} Rolling back from backup: ${path.basename(data.backupPath)}`);
    }
  });

  migrationService.on('rollback:completed', (data) => {
    console.log(`  ${colors.green}✓${colors.reset} Rollback successful`);
  });

  migrationService.on('rollback:failed', (data) => {
    console.log(`  ${colors.red}✗ Rollback failed:${colors.reset} ${data.error}`);
  });

  try {
    const report = await migrationService.runMigration();

    console.log('\n' + '━'.repeat(60));
    console.log(`\n${colors.bright}${colors.green}✅ Migration Successful!${colors.reset}\n`);
    console.log(`${colors.bright}Migration Report:${colors.reset}`);
    console.log(`  Entities migrated:  ${colors.bright}${report.entitiesMigrated}${colors.reset}`);
    console.log(`  Relations migrated: ${colors.bright}${report.relationsMigrated}${colors.reset}`);
    console.log(`  Duration:           ${colors.bright}${report.duration}ms${colors.reset}`);
    console.log(`  Backup location:    ${colors.dim}${report.backupPath}${colors.reset}`);
    console.log(`  Timestamp:          ${report.timestamp}`);

    console.log(`\n${colors.bright}Next Steps:${colors.reset}`);
    console.log(`  1. Verify data in VKB: ${colors.cyan}vkb${colors.reset}`);
    console.log(`  2. Test queries: ${colors.cyan}ukb query --team coding${colors.reset}`);
    console.log(`  3. Remove MCP Memory server (Task 14)`);
    console.log('\n' + '━'.repeat(60) + '\n');

    return true;
  } catch (error) {
    console.error(`\n${colors.red}✗ Migration failed:${colors.reset} ${error.message}`);
    console.error('\n' + '━'.repeat(60));
    console.error(`\n${colors.bright}Recovery Instructions:${colors.reset}`);
    console.error(`  1. Check backup in: ${colors.cyan}.data/backups/${colors.reset}`);
    console.error(`  2. System should have automatically rolled back`);
    console.error(`  3. Review error message and resolve the issue`);
    console.error(`  4. Retry migration: ${colors.cyan}node migrate-to-graph.js${colors.reset}`);
    console.error('\n' + '━'.repeat(60) + '\n');

    return false;
  }
}

async function main() {
  if (showHelp) {
    showHelpMessage();
    process.exit(0);
  }

  console.log(`\n${colors.bright}Knowledge Migration CLI${colors.reset}`);

  const projectRoot = path.join(__dirname, '..', '..');
  const sqlitePath = process.env.SQLITE_PATH || path.join(projectRoot, '.data', 'knowledge.db');
  const graphDbPath = process.env.GRAPH_DB_PATH || path.join(projectRoot, '.data', 'knowledge-graph');

  console.log(`\n${colors.dim}Configuration:${colors.reset}`);
  console.log(`  SQLite:  ${sqlitePath}`);
  console.log(`  Graph:   ${graphDbPath}`);

  try {
    // Initialize DatabaseManager
    const databaseManager = new DatabaseManager({
      sqlite: {
        path: sqlitePath,
        enabled: true
      },
      qdrant: {
        enabled: false // Not needed for migration
      },
      graphDbPath: isDryRun ? null : graphDbPath // Skip graph DB in dry-run mode
    });

    // Suppress console.log during initialization
    const originalLog = console.log;
    console.log = () => {};
    await databaseManager.initialize();
    console.log = originalLog;

    // Check SQLite availability
    if (!databaseManager.health.sqlite.available) {
      console.error(`\n${colors.red}✗ SQLite database not available${colors.reset}`);
      console.error(`  Expected at: ${sqlitePath}`);
      console.error(`  Please check that the database exists and is accessible.\n`);
      process.exit(1);
    }

    // Check graph database availability (only for actual migration)
    if (!isDryRun && !databaseManager.health.graph.available) {
      console.error(`\n${colors.red}✗ Graph database not available${colors.reset}`);
      console.error(`  Expected at: ${graphDbPath}`);
      console.error(`  Error: ${databaseManager.health.graph.error}\n`);
      process.exit(1);
    }

    let success;
    if (isDryRun) {
      success = await runDryRun(databaseManager);
    } else {
      success = await runMigration(databaseManager, databaseManager.graphDB);
    }

    await databaseManager.close();
    process.exit(success ? 0 : 1);

  } catch (error) {
    console.error(`\n${colors.red}✗ Fatal error:${colors.reset}`, error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log(`\n\n${colors.yellow}⚠ Migration interrupted by user${colors.reset}`);
  console.log('Database may be in an inconsistent state.');
  console.log('Check backups in .data/backups/ if needed.\n');
  process.exit(1);
});

main();
