#!/usr/bin/env node
/**
 * Cleanup Orphaned Knowledge Base Entities
 *
 * Removes entities from the knowledge base that don't have corresponding
 * markdown files in knowledge-management/insights/
 *
 * Usage:
 *   node scripts/cleanup-orphaned-entities.js [--dry-run] [--team=coding]
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const teamArg = args.find(arg => arg.startsWith('--team='));
const team = teamArg ? teamArg.split('=')[1] : 'coding';

console.log(`🔍 Cleanup Orphaned Entities`);
console.log(`   Team: ${team}`);
console.log(`   Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'LIVE (will delete)'}`);
console.log('');

async function main() {
  try {
    // Load knowledge export
    const exportPath = path.join(projectRoot, '.data/knowledge-export', `${team}.json`);
    const exportData = JSON.parse(await fs.readFile(exportPath, 'utf-8'));

    console.log(`📊 Loaded ${exportData.entities.length} entities from ${team}.json`);

    // Find patterns/insights that should have markdown files
    const insightsDir = path.join(projectRoot, 'knowledge-management/insights');
    const orphanedEntities = [];

    for (const entity of exportData.entities) {
      // Check if this entity should have a markdown file
      const shouldHaveMarkdown =
        entity.entityType === 'Pattern' ||
        entity.entityType === 'TransferablePattern' ||
        entity.entityType === 'Insight';

      if (!shouldHaveMarkdown) continue;

      // Check if markdown file exists
      const mdPath = path.join(insightsDir, `${entity.name}.md`);
      try {
        await fs.access(mdPath);
        // File exists - not orphaned
      } catch (error) {
        // File doesn't exist - orphaned!
        orphanedEntities.push(entity);
      }
    }

    if (orphanedEntities.length === 0) {
      console.log('✅ No orphaned entities found!');
      return;
    }

    console.log(`\n⚠️  Found ${orphanedEntities.length} orphaned entities:\n`);

    for (const entity of orphanedEntities) {
      console.log(`   - ${entity.name} (${entity.entityType})`);
      if (entity.observations && entity.observations.length > 0) {
        const firstObs = String(entity.observations[0] || '');
        if (firstObs.length > 0) {
          console.log(`     > ${firstObs.substring(0, 80)}...`);
        }
      }
    }

    if (isDryRun) {
      console.log('\n📋 DRY RUN - No changes made');
      console.log('   To delete these entities, run without --dry-run flag');
      return;
    }

    // Delete orphaned entities using the GraphDB API
    console.log(`\n🗑️  Deleting orphaned entities...`);

    // We need to call the VKB server API to delete properly
    // Check if VKB server is running
    try {
      const response = await fetch('http://localhost:8080/api/health');
      if (!response.ok) {
        throw new Error('VKB server not responding');
      }
    } catch (error) {
      console.error('\n❌ Error: VKB server is not running!');
      console.error('   Start it with: vkb start');
      console.error('   Or use the GraphDB service directly');
      process.exit(1);
    }

    // Delete each orphaned entity
    let deleted = 0;
    let failed = 0;

    for (const entity of orphanedEntities) {
      try {
        const response = await fetch(
          `http://localhost:8080/api/entities/${encodeURIComponent(entity.name)}?team=${team}`,
          { method: 'DELETE' }
        );

        if (response.ok) {
          console.log(`   ✓ Deleted: ${entity.name}`);
          deleted++;
        } else {
          const error = await response.json();
          console.error(`   ✗ Failed: ${entity.name} - ${error.message}`);
          failed++;
        }
      } catch (error) {
        console.error(`   ✗ Failed: ${entity.name} - ${error.message}`);
        failed++;
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Deleted: ${deleted}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Total: ${orphanedEntities.length}`);

    if (deleted > 0) {
      console.log(`\n✅ Cleanup complete! Deleted ${deleted} orphaned entities.`);
      console.log('   The knowledge base export has been updated.');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
