#!/usr/bin/env node
/**
 * Purge Knowledge Entities Script
 *
 * Deletes knowledge entities from the VKB database starting from a specific date.
 * Uses the proper DELETE API to maintain consistency across Graphology, LevelDB, and JSON exports.
 *
 * Usage:
 *   node scripts/purge-knowledge-entities.js <start-date> [options]
 *
 * Examples:
 *   node scripts/purge-knowledge-entities.js 2025-12-23
 *   node scripts/purge-knowledge-entities.js 2025-12-23 --team=coding
 *   node scripts/purge-knowledge-entities.js 2025-12-23 --dry-run
 *   node scripts/purge-knowledge-entities.js 2025-12-23 --team=coding --dry-run
 *
 * Options:
 *   --team=<team>   Team to filter entities (default: coding)
 *   --dry-run       Show what would be deleted without actually deleting
 *   --verbose       Show detailed output for each entity
 *   --help          Show this help message
 */

const VKB_BASE_URL = process.env.VKB_URL || 'http://localhost:8080';

async function fetchEntities(team, startDate) {
  const url = `${VKB_BASE_URL}/api/entities?team=${team}&limit=1000`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch entities: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Filter entities by extracted_at date
    return data.entities.filter(entity => {
      const extractedAt = entity.extracted_at;
      return extractedAt && extractedAt >= startDate;
    });
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') {
      console.error('Error: VKB server is not running. Start it with: vkb start');
      process.exit(1);
    }
    throw error;
  }
}

async function deleteEntity(entityName, team) {
  const url = `${VKB_BASE_URL}/api/entities/${encodeURIComponent(entityName)}?team=${team}`;

  const response = await fetch(url, { method: 'DELETE' });
  const data = await response.json();

  return {
    success: data.success === true,
    message: data.message || data.error
  };
}

async function checkHealth() {
  try {
    const response = await fetch(`${VKB_BASE_URL}/api/health`);
    const data = await response.json();
    return data.status === 'healthy';
  } catch {
    return false;
  }
}

function parseArgs(args) {
  const options = {
    startDate: null,
    team: 'coding',
    dryRun: false,
    verbose: false,
    help: false
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg.startsWith('--team=')) {
      options.team = arg.split('=')[1];
    } else if (!arg.startsWith('-') && !options.startDate) {
      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
        console.error(`Error: Invalid date format "${arg}". Use YYYY-MM-DD format.`);
        process.exit(1);
      }
      options.startDate = arg;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Purge Knowledge Entities Script

Deletes knowledge entities from the VKB database starting from a specific date.
Uses the proper DELETE API to maintain consistency across Graphology, LevelDB, and JSON exports.

Usage:
  node scripts/purge-knowledge-entities.js <start-date> [options]

Arguments:
  start-date      Date from which to delete entities (inclusive), format: YYYY-MM-DD

Options:
  --team=<team>   Team to filter entities (default: coding)
  --dry-run       Show what would be deleted without actually deleting
  --verbose       Show detailed output for each entity
  --help, -h      Show this help message

Examples:
  node scripts/purge-knowledge-entities.js 2025-12-23
  node scripts/purge-knowledge-entities.js 2025-12-23 --team=coding
  node scripts/purge-knowledge-entities.js 2025-12-23 --dry-run
  node scripts/purge-knowledge-entities.js 2025-12-23 --team=ui --verbose

Environment:
  VKB_URL         Base URL for VKB server (default: http://localhost:8080)
`);
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  if (!options.startDate) {
    console.error('Error: Start date is required. Use --help for usage information.');
    process.exit(1);
  }

  console.log(`\nPurge Knowledge Entities`);
  console.log(`   Start date: ${options.startDate} (inclusive)`);
  console.log(`   Team: ${options.team}`);
  console.log(`   Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  // Check VKB health
  const healthy = await checkHealth();
  if (!healthy) {
    console.error('Error: VKB server is not healthy or not running.');
    console.error('Start it with: vkb start');
    process.exit(1);
  }

  // Fetch entities to delete
  console.log('Fetching entities...');
  const entities = await fetchEntities(options.team, options.startDate);

  if (entities.length === 0) {
    console.log(`\nNo entities found created on or after ${options.startDate}`);
    process.exit(0);
  }

  console.log(`Found ${entities.length} entities to delete:\n`);

  if (options.verbose || options.dryRun) {
    for (const entity of entities) {
      console.log(`  - ${entity.entity_name} (extracted: ${entity.extracted_at?.split('T')[0]})`);
    }
    console.log('');
  }

  if (options.dryRun) {
    console.log(`\nDRY RUN: Would delete ${entities.length} entities`);
    console.log('   Run without --dry-run to actually delete.\n');
    process.exit(0);
  }

  // Delete entities
  let deleted = 0;
  let failed = 0;

  for (const entity of entities) {
    const result = await deleteEntity(entity.entity_name, options.team);

    if (result.success) {
      deleted++;
      if (options.verbose) {
        console.log(`  [OK] Deleted: ${entity.entity_name}`);
      }
    } else {
      failed++;
      console.log(`  [FAIL] ${entity.entity_name} - ${result.message}`);
    }
  }

  // Summary
  console.log(`\n========================================`);
  console.log(`Summary:`);
  console.log(`  Deleted: ${deleted}`);
  if (failed > 0) {
    console.log(`  Failed:  ${failed}`);
  }
  console.log(`\nData stores are now in sync (Graphology, LevelDB, JSON export)\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
