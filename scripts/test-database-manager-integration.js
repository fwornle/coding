#!/usr/bin/env node
/**
 * Test DatabaseManager Integration with GraphDatabaseService
 *
 * Verifies Task 10: DatabaseManager initializes GraphDatabaseService
 */

import { DatabaseManager } from '../src/databases/DatabaseManager.js';
import fs from 'fs';

async function testDatabaseManagerIntegration() {
  console.log('🧪 Testing DatabaseManager Integration with GraphDatabaseService\n');
  console.log('━'.repeat(60));

  const testDbPath = '.cache/test-db-manager-graph';

  // Cleanup
  if (fs.existsSync(testDbPath)) {
    fs.rmSync(testDbPath, { recursive: true, force: true });
  }

  try {
    // Test 1: Create DatabaseManager with graph database enabled
    console.log('\n✓ Test 1: Initialize DatabaseManager with graph database');
    const dbManager = new DatabaseManager({
      graphDbPath: testDbPath,
      sqlite: { enabled: false }, // Disable SQLite for this test
      qdrant: { enabled: false }  // Disable Qdrant for this test
    });

    await dbManager.initialize();

    if (!dbManager.graphDB) {
      throw new Error('GraphDatabaseService not initialized');
    }

    console.log('  DatabaseManager initialized with graph database');
    console.log(`  Graph DB path: ${testDbPath}`);

    // Test 2: Verify graph database is available in health check
    console.log('\n✓ Test 2: Health check includes graph database');
    const health = await dbManager.getHealth();
    console.log(`  Overall health: ${health.overall}`);
    console.log(`  Graph available: ${health.graph.available || health.graph.status === 'healthy'}`);

    if (!health.graph.available && health.graph.status !== 'healthy') {
      throw new Error('Graph database not available in health check');
    }

    // Test 3: Store and retrieve data through graph database
    console.log('\n✓ Test 3: Store and retrieve data through graph database');
    await dbManager.graphDB.storeEntity(
      { name: 'TestEntity', entityType: 'Test', confidence: 0.9 },
      { team: 'test' }
    );

    const entity = await dbManager.graphDB.getEntity('TestEntity', 'test');
    if (!entity) {
      throw new Error('Failed to retrieve entity from graph database');
    }
    console.log(`  Entity stored and retrieved: ${entity.name}`);

    // Test 4: Close DatabaseManager
    console.log('\n✓ Test 4: Close DatabaseManager');
    await dbManager.close();
    console.log('  DatabaseManager closed successfully');

    // Test 5: Verify data persisted
    console.log('\n✓ Test 5: Verify persistence after restart');
    const dbManager2 = new DatabaseManager({
      graphDbPath: testDbPath,
      sqlite: { enabled: false },
      qdrant: { enabled: false }
    });

    await dbManager2.initialize();
    const persistedEntity = await dbManager2.graphDB.getEntity('TestEntity', 'test');
    if (!persistedEntity) {
      throw new Error('Entity not persisted');
    }
    console.log(`  Data persisted correctly: ${persistedEntity.name}`);

    await dbManager2.close();

    // Test 6: Test graceful degradation when graph DB fails
    console.log('\n✓ Test 6: Graceful degradation when graph DB unavailable');
    const dbManager3 = new DatabaseManager({
      graphDbPath: '/invalid/path/that/will/fail',
      sqlite: { enabled: false },
      qdrant: { enabled: false }
    });

    // Should not throw error, just degrade gracefully
    await dbManager3.initialize();

    const health3 = await dbManager3.getHealth();
    if (health3.graph.available) {
      throw new Error('Graph should be unavailable with invalid path');
    }
    console.log('  Graceful degradation works: graph unavailable, system continues');
    console.log(`  Overall health status: ${health3.overall}`);

    await dbManager3.close();

    // Cleanup
    fs.rmSync(testDbPath, { recursive: true, force: true });

    // Success
    console.log('\n' + '━'.repeat(60));
    console.log('✅ All DatabaseManager integration tests passed!');
    console.log('━'.repeat(60));
    console.log('\nTask 10 Complete: DatabaseManager integrates GraphDatabaseService\n');
    console.log('Key accomplishments:');
    console.log('  ✓ GraphDatabaseService initializes on DatabaseManager startup');
    console.log('  ✓ Health check includes graph database status');
    console.log('  ✓ Data persists across restarts');
    console.log('  ✓ Graceful degradation when graph DB fails');
    console.log('  ✓ Close() properly cleans up graph database\n');

    return true;

  } catch (error) {
    console.error('\n' + '━'.repeat(60));
    console.error('❌ Test failed:', error.message);
    console.error('━'.repeat(60));
    console.error('\nStack:', error.stack);

    // Cleanup
    try {
      if (fs.existsSync(testDbPath)) {
        fs.rmSync(testDbPath, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError.message);
    }

    return false;
  }
}

testDatabaseManagerIntegration().then(success => {
  process.exit(success ? 0 : 1);
});
