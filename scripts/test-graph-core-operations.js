#!/usr/bin/env node
/**
 * Test GraphDatabaseService Core Operations
 *
 * Verifies Task 4: initialize, storeEntity, getEntity, storeRelationship, persistence
 */

import { GraphDatabaseService } from '../src/knowledge-management/GraphDatabaseService.js';
import fs from 'fs';

async function testCoreOperations() {
  console.log('🧪 Testing GraphDatabaseService Core Operations\n');
  console.log('━'.repeat(60));

  const testDbPath = '.cache/test-graph-core';

  // Cleanup
  if (fs.existsSync(testDbPath)) {
    fs.rmSync(testDbPath, { recursive: true, force: true });
  }

  try {
    // Test 1: Initialize
    console.log('\n✓ Test 1: Initialize graph database');
    const graphDB = new GraphDatabaseService({ dbPath: testDbPath });

    let readyEmitted = false;
    graphDB.on('ready', () => { readyEmitted = true; });

    await graphDB.initialize();

    if (!readyEmitted) throw new Error('ready event not emitted');
    console.log('  Database initialized successfully');
    console.log(`  Nodes: ${graphDB.graph.order}, Edges: ${graphDB.graph.size}`);

    // Test 2: Store Entity
    console.log('\n✓ Test 2: Store entity');
    let entityStored = false;
    graphDB.on('entity:stored', () => { entityStored = true; });

    const nodeId = await graphDB.storeEntity(
      {
        name: 'JWT Authentication',
        entityType: 'Pattern',
        observations: ['Uses RS256 algorithm', 'Requires secret key'],
        confidence: 0.9
      },
      { team: 'test' }
    );

    if (nodeId !== 'test:JWT Authentication') {
      throw new Error(`Wrong node ID: ${nodeId}`);
    }
    if (!entityStored) throw new Error('entity:stored event not emitted');
    console.log(`  Entity stored with ID: ${nodeId}`);

    // Test 3: Get Entity
    console.log('\n✓ Test 3: Retrieve entity');
    const entity = await graphDB.getEntity('JWT Authentication', 'test');

    if (!entity) throw new Error('Entity not found');
    if (entity.name !== 'JWT Authentication') throw new Error('Wrong entity name');
    if (entity.entityType !== 'Pattern') throw new Error('Wrong entity type');
    if (entity.confidence !== 0.9) throw new Error('Wrong confidence');
    if (entity.observations.length !== 2) throw new Error('Wrong observations count');
    console.log('  Entity retrieved successfully:', entity.name);

    // Test 4: Store another entity and relationship
    console.log('\n✓ Test 4: Store relationship');
    await graphDB.storeEntity(
      { name: 'Stateless Auth', entityType: 'Problem', confidence: 0.8 },
      { team: 'test' }
    );

    let relationshipStored = false;
    graphDB.on('relationship:stored', () => { relationshipStored = true; });

    await graphDB.storeRelationship(
      'JWT Authentication',
      'Stateless Auth',
      'solves',
      { team: 'test', confidence: 0.95 }
    );

    if (!relationshipStored) throw new Error('relationship:stored event not emitted');
    console.log('  Relationship stored: JWT Authentication --solves--> Stateless Auth');

    // Test 5: Persistence
    console.log('\n✓ Test 5: Test persistence');
    await graphDB.close();
    console.log('  Database closed');

    // Reopen and verify data persisted
    const graphDB2 = new GraphDatabaseService({ dbPath: testDbPath });
    await graphDB2.initialize();

    const persistedEntity = await graphDB2.getEntity('JWT Authentication', 'test');
    if (!persistedEntity) throw new Error('Entity not persisted');
    if (persistedEntity.name !== 'JWT Authentication') throw new Error('Persisted data corrupted');

    console.log('  Data persisted correctly');
    console.log(`  Reopened with ${graphDB2.graph.order} nodes, ${graphDB2.graph.size} edges`);

    // Test 6: Health check
    console.log('\n✓ Test 6: Health check');
    const health = await graphDB2.getHealth();
    console.log('  Health status:', health.status);
    console.log('  Nodes:', health.graph.nodes);
    console.log('  Edges:', health.graph.edges);
    console.log('  Persistence:', health.persistence.type);

    // Cleanup
    await graphDB2.close();
    fs.rmSync(testDbPath, { recursive: true, force: true });

    // Success
    console.log('\n' + '━'.repeat(60));
    console.log('✅ All core operations tests passed!');
    console.log('━'.repeat(60));
    console.log('\nTask 4 Complete: Core graph operations working correctly\n');

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

testCoreOperations().then(success => {
  process.exit(success ? 0 : 1);
});
