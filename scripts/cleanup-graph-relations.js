#!/usr/bin/env node
/**
 * Cleanup script for graph database relations
 *
 * This script:
 * 1. Normalizes relation types (spaces → underscores)
 * 2. Removes duplicate relations
 * 3. Removes generic 'relation' type edges where specific types exist
 * 4. Cleans up JSON export files to prevent re-import of duplicates
 *
 * Usage: node scripts/cleanup-graph-relations.js
 */

import { GraphDatabaseService } from '../src/knowledge-management/GraphDatabaseService.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPORT_DIR = path.join(__dirname, '../.data/knowledge-export');

/**
 * Clean up a JSON export file
 * - Normalize relation types (spaces → underscores)
 * - Remove empty relation types
 * - Remove generic 'relation' type when specific type exists
 */
async function cleanupJsonExport(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(content);

    if (!data.relations || !Array.isArray(data.relations)) {
      console.log(`  ⏭ Skipping ${path.basename(filePath)} - no relations array`);
      return { normalized: 0, removed: 0 };
    }

    const normalizeType = (type) => (type || '').replace(/\s+/g, '_');

    let normalized = 0;
    let removed = 0;

    // Step 1: Normalize relation types
    for (const rel of data.relations) {
      const originalType = rel.relationType || '';
      const normalizedType = normalizeType(originalType);
      if (originalType !== normalizedType) {
        rel.relationType = normalizedType;
        normalized++;
      }
    }

    // Step 2: Group by from-to pair
    const pairMap = new Map();
    for (const rel of data.relations) {
      const key = `${rel.from}__${rel.to}`;
      if (!pairMap.has(key)) {
        pairMap.set(key, []);
      }
      pairMap.get(key).push(rel);
    }

    // Step 3: For each pair, remove 'relation' if specific type exists
    const cleanedRelations = [];
    for (const [key, rels] of pairMap.entries()) {
      const genericRels = rels.filter(r => r.relationType === 'relation');
      const specificRels = rels.filter(r => r.relationType && r.relationType !== 'relation');

      if (genericRels.length > 0 && specificRels.length > 0) {
        // Keep only specific types
        cleanedRelations.push(...specificRels);
        removed += genericRels.length;
      } else {
        // Keep all relations
        cleanedRelations.push(...rels);
      }
    }

    // Step 4: Remove empty relation types
    const finalRelations = cleanedRelations.filter(r => {
      if (!r.relationType) {
        removed++;
        return false;
      }
      return true;
    });

    data.relations = finalRelations;

    // Write back
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');

    return { normalized, removed };
  } catch (error) {
    console.log(`  ⚠ Error processing ${path.basename(filePath)}: ${error.message}`);
    return { normalized: 0, removed: 0 };
  }
}

async function main() {
  console.log('🚀 Starting graph relations cleanup...\n');

  const graphDB = new GraphDatabaseService();

  try {
    await graphDB.initialize();

    // Get initial stats
    const stats = await graphDB.getStatistics();
    console.log(`📊 Initial state: ${stats.entityCount || 0} entities, ${stats.relationCount || 0} relations\n`);

    // Step 1: Normalize and cleanup (fix spaces, remove empty types, remove redundant 'relation')
    console.log('=== Step 1: Normalize and Cleanup Graph DB ===');
    const cleanupResult = await graphDB.normalizeAndCleanupRelations();
    console.log('');

    // Step 2: Deduplicate (remove duplicate edges with same from/to/type)
    console.log('=== Step 2: Deduplicate Graph DB ===');
    const dedupeResult = await graphDB.deduplicateRelations();
    console.log('');

    // Get final stats
    const finalStats = await graphDB.getStatistics();
    console.log(`📊 Final state: ${finalStats.entityCount || 0} entities, ${finalStats.relationCount || 0} relations\n`);

    // Step 3: Clean up JSON export files
    console.log('=== Step 3: Clean JSON Export Files ===');
    const jsonFiles = await fs.readdir(EXPORT_DIR);
    let totalJsonNormalized = 0;
    let totalJsonRemoved = 0;

    for (const file of jsonFiles) {
      if (file.endsWith('.json')) {
        const filePath = path.join(EXPORT_DIR, file);
        console.log(`  Processing ${file}...`);
        const result = await cleanupJsonExport(filePath);
        totalJsonNormalized += result.normalized;
        totalJsonRemoved += result.removed;
        if (result.normalized > 0 || result.removed > 0) {
          console.log(`    Normalized: ${result.normalized}, Removed: ${result.removed}`);
        }
      }
    }
    console.log('');

    // Summary
    console.log('=== Summary ===');
    console.log('Graph DB:');
    console.log(`  Normalized types: ${cleanupResult.normalized}`);
    console.log(`  Generic 'relation' removed: ${cleanupResult.genericRemoved}`);
    console.log(`  Empty types removed: ${cleanupResult.emptyRemoved}`);
    console.log(`  Duplicates removed: ${dedupeResult.duplicatesRemoved}`);
    console.log(`  Total relations before: ${stats.relationCount || 0}`);
    console.log(`  Total relations after: ${finalStats.relationCount || 0}`);
    console.log('JSON Exports:');
    console.log(`  Normalized types: ${totalJsonNormalized}`);
    console.log(`  Relations removed: ${totalJsonRemoved}`);

    await graphDB.close();
    console.log('\n✅ Cleanup complete!');

  } catch (error) {
    console.error('❌ Cleanup failed:', error.message);
    await graphDB.close();
    process.exit(1);
  }
}

main();
