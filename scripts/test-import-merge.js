#!/usr/bin/env node
/**
 * Test GraphKnowledgeImporter Merge Behavior
 *
 * This script verifies that the timestamp-based merge logic works correctly:
 * 1. Creates test entities in LevelDB with newer timestamps
 * 2. Imports from JSON (which has older timestamps)
 * 3. Verifies that DB entities are NOT overwritten by older JSON data
 */

import { GraphDatabaseService } from '../src/knowledge-management/GraphDatabaseService.js';
import { GraphKnowledgeImporter } from '../src/knowledge-management/GraphKnowledgeImporter.js';
import fs from 'fs/promises';
import path from 'path';

async function main() {
  console.log('🧪 Testing GraphKnowledgeImporter Timestamp-Based Merge\n');

  const testDbPath = '.cache/test-merge-db';

  // Clean up test DB
  try {
    await fs.rm(testDbPath, { recursive: true, force: true });
  } catch (error) {
    // Ignore
  }

  // Step 1: Create graph DB with test entity (newer timestamp)
  console.log('📝 Step 1: Create DB with entity "Coding" (newer timestamp)');
  const graphDB = new GraphDatabaseService({
    dbPath: testDbPath,
    config: { autoPersist: false, autoExportJSON: false }
  });

  await graphDB.initialize();

  const newerTime = new Date().toISOString(); // NOW (will be newer than JSON)
  await graphDB.storeEntity({
    name: 'Coding',
    entityType: 'Project',
    observations: ['This is DB version with NEWER timestamp'],
    source: 'manual',
    created_at: newerTime,
    last_modified: newerTime
  }, { team: 'coding' });

  console.log(`  ✓ Created "Coding" entity with timestamp: ${newerTime}`);

  const beforeEntity = await graphDB.getEntity('Coding', 'coding');
  console.log(`  ✓ Observations: ${JSON.stringify(beforeEntity.observations)}\n`);

  // Step 2: Import from JSON (older timestamps)
  console.log('📝 Step 2: Import from JSON (which has older June 2025 timestamps)');
  const importer = new GraphKnowledgeImporter(graphDB, {
    autoImportOnStartup: false,
    conflictResolution: 'newest-wins'
  });

  const result = await importer.importTeam('coding');

  console.log('\n📊 Import Results:');
  console.log(`  Entities imported: ${result.entitiesImported}`);
  console.log(`  Entities skipped: ${result.entitiesSkipped}`);
  console.log(`  Relations imported: ${result.relationsImported}`);
  console.log(`  Relations skipped: ${result.relationsSkipped}\n`);

  // Step 3: Verify DB entity was NOT overwritten
  console.log('📝 Step 3: Verify "Coding" entity was NOT overwritten');
  const afterEntity = await graphDB.getEntity('Coding', 'coding');

  console.log(`  DB version timestamp: ${afterEntity.last_modified}`);
  console.log(`  DB observations: ${JSON.stringify(afterEntity.observations)}`);

  // Check if observations match (should still be DB version)
  if (afterEntity.observations[0] === 'This is DB version with NEWER timestamp') {
    console.log('\n✅ SUCCESS: DB entity with newer timestamp was preserved!');
    console.log('   JSON import correctly skipped older version.');
  } else {
    console.log('\n❌ FAILURE: DB entity was overwritten by older JSON data!');
    console.log('   This should not happen with newest-wins conflict resolution.');
    process.exit(1);
  }

  await graphDB.close();

  // Clean up
  await fs.rm(testDbPath, { recursive: true, force: true });

  console.log('\n🎉 Test passed - timestamp-based merge working correctly!\n');
}

main().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
