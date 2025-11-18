#!/usr/bin/env node
/**
 * sync-graph-to-qdrant.js
 *
 * Synchronizes existing graph database entities to Qdrant vector collections.
 * This script performs initial population of Qdrant with all entities from the graph database.
 *
 * Usage:
 *   node scripts/sync-graph-to-qdrant.js [options]
 *
 * Options:
 *   --teams <team1,team2>   Comma-separated list of teams to sync (default: coding,ui,resi)
 *   --batch-size <n>        Number of entities to process per batch (default: 20)
 *   --dry-run              Show what would be synced without actually syncing
 *
 * Examples:
 *   node scripts/sync-graph-to-qdrant.js
 *   node scripts/sync-graph-to-qdrant.js --teams coding,ui
 *   node scripts/sync-graph-to-qdrant.js --batch-size 10 --dry-run
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { DatabaseManager } from '../src/databases/DatabaseManager.js';
import { GraphDatabaseService } from '../src/knowledge-management/GraphDatabaseService.js';
import { QdrantSyncService } from '../src/knowledge-management/QdrantSyncService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  teams: ['coding', 'ui', 'resi'],
  batchSize: 20,
  dryRun: false
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--teams' && args[i + 1]) {
    options.teams = args[i + 1].split(',').map(t => t.trim());
    i++;
  } else if (args[i] === '--batch-size' && args[i + 1]) {
    options.batchSize = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--dry-run') {
    options.dryRun = true;
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║     Graph Database → Qdrant Synchronization Script           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`📊 Configuration:`);
  console.log(`   Teams: ${options.teams.join(', ')}`);
  console.log(`   Batch Size: ${options.batchSize}`);
  console.log(`   Dry Run: ${options.dryRun ? 'Yes' : 'No'}`);
  console.log();

  let databaseManager = null;
  let graphService = null;
  let syncService = null;

  try {
    // Step 1: Initialize DatabaseManager
    console.log('🔧 Step 1: Initializing DatabaseManager...');
    databaseManager = new DatabaseManager({
      levelPath: join(projectRoot, '.data/knowledge-graph'),
      qdrant: {
        host: 'localhost',
        port: 6333,
        enabled: true
      }
    });
    await databaseManager.initialize();
    console.log('   ✓ DatabaseManager initialized');
    console.log();

    // Step 2: Get GraphDatabaseService from DatabaseManager
    console.log('🔧 Step 2: Getting GraphDatabaseService from DatabaseManager...');
    graphService = databaseManager.graphDB;
    if (!graphService) {
      throw new Error('GraphDatabaseService not available from DatabaseManager');
    }
    console.log('   ✓ GraphDatabaseService retrieved');
    console.log();

    // Step 3: Check current state
    console.log('📊 Step 3: Analyzing current state...');

    // Count entities in graph
    const entityCounts = { coding: 0, ui: 0, resi: 0 };
    graphService.graph.forEachNode((nodeId, attributes) => {
      if (attributes.team && entityCounts[attributes.team] !== undefined) {
        entityCounts[attributes.team]++;
      }
    });

    const totalEntities = Object.values(entityCounts).reduce((sum, count) => sum + count, 0);
    console.log(`   Graph Database:`);
    console.log(`     - Coding: ${entityCounts.coding} entities`);
    console.log(`     - UI: ${entityCounts.ui} entities`);
    console.log(`     - ReSi: ${entityCounts.resi} entities`);
    console.log(`     - Total: ${totalEntities} entities`);
    console.log();

    // Check Qdrant collections
    const qdrant = databaseManager.qdrant;
    let patternsCount = 0;
    let patternsSmallCount = 0;

    try {
      const patternsInfo = await qdrant.getCollection('knowledge_patterns');
      patternsCount = patternsInfo.points_count || 0;
    } catch (error) {
      console.log(`   ⚠️  knowledge_patterns collection not accessible: ${error.message}`);
    }

    try {
      const patternsSmallInfo = await qdrant.getCollection('knowledge_patterns_small');
      patternsSmallCount = patternsSmallInfo.points_count || 0;
    } catch (error) {
      console.log(`   ⚠️  knowledge_patterns_small collection not accessible: ${error.message}`);
    }

    console.log(`   Qdrant Collections:`);
    console.log(`     - knowledge_patterns (1536-dim): ${patternsCount} points`);
    console.log(`     - knowledge_patterns_small (384-dim): ${patternsSmallCount} points`);
    console.log();

    if (totalEntities === 0) {
      console.log('⚠️  No entities found in graph database. Nothing to sync.');
      return;
    }

    if (options.dryRun) {
      console.log('🔍 DRY RUN MODE - No changes will be made');
      console.log(`   Would sync ${totalEntities} entities to Qdrant`);
      console.log(`   Would process in batches of ${options.batchSize}`);
      console.log(`   Estimated batches: ${Math.ceil(totalEntities / options.batchSize)}`);
      return;
    }

    // Step 4: Get QdrantSyncService from DatabaseManager
    console.log('🔧 Step 4: Getting QdrantSyncService from DatabaseManager...');
    syncService = databaseManager.qdrantSync;
    if (!syncService) {
      console.log('   ⚠️  QdrantSyncService not available (Qdrant may be disabled)');
      console.log('   Creating standalone instance...');
      syncService = new QdrantSyncService({
        graphService,
        databaseManager,
        enabled: true,
        syncOnStart: false  // We'll manually call syncAllEntities
      });
      await syncService.initialize();
    }
    console.log('   ✓ QdrantSyncService ready');
    console.log();

    // Step 5: Sync all entities
    console.log('🚀 Step 5: Syncing entities to Qdrant...');
    console.log('   This may take a few minutes depending on the number of entities...');
    console.log();

    const results = await syncService.syncAllEntities({
      teams: options.teams,
      batchSize: options.batchSize
    });

    // Step 6: Report results
    console.log();
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    Synchronization Results                    ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log();
    console.log(`📊 Statistics:`);
    console.log(`   Total Entities: ${results.total}`);
    console.log(`   Successfully Synced: ${results.synced} ✓`);
    console.log(`   Failed: ${results.failed} ${results.failed > 0 ? '✗' : ''}`);
    console.log(`   Duration: ${(results.duration / 1000).toFixed(2)}s`);
    console.log();

    if (results.failed > 0) {
      console.log('⚠️  Some entities failed to sync. Check the logs above for details.');
    } else {
      console.log('✅ All entities synced successfully!');
    }
    console.log();

    // Step 7: Verify collections
    console.log('🔍 Step 7: Verifying Qdrant collections...');

    try {
      const patternsInfo = await qdrant.getCollection('knowledge_patterns');
      const patternsSmallInfo = await qdrant.getCollection('knowledge_patterns_small');

      console.log(`   knowledge_patterns: ${patternsInfo.points_count} points`);
      console.log(`   knowledge_patterns_small: ${patternsSmallInfo.points_count} points`);
      console.log();

      if (patternsInfo.points_count === results.synced &&
          patternsSmallInfo.points_count === results.synced) {
        console.log('✅ Verification successful - all entities present in both collections');
      } else {
        console.log('⚠️  Mismatch detected between expected and actual counts');
      }
    } catch (error) {
      console.log(`   ⚠️  Could not verify collections: ${error.message}`);
    }

  } catch (error) {
    console.error();
    console.error('❌ Synchronization failed:', error.message);
    console.error();
    console.error('Stack trace:');
    console.error(error.stack);
    process.exit(1);

  } finally {
    // Cleanup
    console.log();
    console.log('🧹 Cleaning up...');

    if (syncService) {
      await syncService.shutdown();
      console.log('   ✓ QdrantSyncService shutdown');
    }

    if (graphService) {
      await graphService.close();
      console.log('   ✓ GraphDatabaseService closed');
    }

    if (databaseManager) {
      await databaseManager.close();
      console.log('   ✓ DatabaseManager closed');
    }

    console.log();
    console.log('✨ Done!');
  }
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
