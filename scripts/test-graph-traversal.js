#!/usr/bin/env node
/**
 * Test GraphDatabaseService Graph Traversal
 *
 * Verifies Task 5: findRelated() with BFS algorithm
 *
 * Test graph structure:
 *   A --implements--> B --solves--> C
 *   A --uses--> D
 *   B --uses--> D
 *   D --requires--> E
 *   A --related-to--> A (circular self-reference)
 */

import { GraphDatabaseService } from '../src/knowledge-management/GraphDatabaseService.js';
import fs from 'fs';

async function testGraphTraversal() {
  console.log('🧪 Testing GraphDatabaseService Graph Traversal\n');
  console.log('━'.repeat(60));

  const testDbPath = '.cache/test-graph-traversal';

  // Cleanup
  if (fs.existsSync(testDbPath)) {
    fs.rmSync(testDbPath, { recursive: true, force: true });
  }

  try {
    // Initialize
    console.log('\n✓ Test Setup: Create test graph');
    const graphDB = new GraphDatabaseService({ dbPath: testDbPath });
    await graphDB.initialize();

    // Create test entities
    await graphDB.storeEntity({ name: 'A', entityType: 'Pattern', confidence: 0.9 }, { team: 'test' });
    await graphDB.storeEntity({ name: 'B', entityType: 'Pattern', confidence: 0.8 }, { team: 'test' });
    await graphDB.storeEntity({ name: 'C', entityType: 'Problem', confidence: 0.7 }, { team: 'test' });
    await graphDB.storeEntity({ name: 'D', entityType: 'Tool', confidence: 0.6 }, { team: 'test' });
    await graphDB.storeEntity({ name: 'E', entityType: 'Library', confidence: 0.5 }, { team: 'test' });

    // Create relationships
    await graphDB.storeRelationship('A', 'B', 'implements', { team: 'test' });
    await graphDB.storeRelationship('B', 'C', 'solves', { team: 'test' });
    await graphDB.storeRelationship('A', 'D', 'uses', { team: 'test' });
    await graphDB.storeRelationship('B', 'D', 'uses', { team: 'test' });
    await graphDB.storeRelationship('D', 'E', 'requires', { team: 'test' });
    await graphDB.storeRelationship('A', 'A', 'related-to', { team: 'test' }); // Circular

    console.log('  Created 5 entities and 6 relationships');

    // Test 1: Basic traversal depth 1
    console.log('\n✓ Test 1: Depth 1 traversal from A');
    const depth1 = await graphDB.findRelated('A', 1, { team: 'test' });
    console.log(`  Found ${depth1.length} related entities:`);
    depth1.forEach(r => console.log(`    - ${r.entity.name} (depth: ${r.depth}, type: ${r.relationshipType})`));

    if (depth1.length !== 3) {
      throw new Error(`Expected 3 entities at depth 1, got ${depth1.length}`);
    }
    // Should find: A (circular), B, D
    const names1 = depth1.map(r => r.entity.name).sort();
    if (names1.join(',') !== 'A,B,D') {
      throw new Error(`Expected A,B,D, got ${names1.join(',')}`);
    }

    // Test 2: Depth 2 traversal from A
    console.log('\n✓ Test 2: Depth 2 traversal from A');
    const depth2 = await graphDB.findRelated('A', 2, { team: 'test' });
    console.log(`  Found ${depth2.length} related entities:`);
    depth2.forEach(r => console.log(`    - ${r.entity.name} (depth: ${r.depth}, type: ${r.relationshipType})`));

    if (depth2.length !== 5) {
      throw new Error(`Expected 5 entities at depth 1-2, got ${depth2.length}`);
    }
    // Should find: A, B, D (depth 1) + C, E (depth 2)
    const names2 = depth2.map(r => r.entity.name).sort();
    if (names2.join(',') !== 'A,B,C,D,E') {
      throw new Error(`Expected A,B,C,D,E, got ${names2.join(',')}`);
    }

    // Verify correct depths
    const depthMap = {};
    depth2.forEach(r => { depthMap[r.entity.name] = r.depth; });
    if (depthMap['A'] !== 1) throw new Error('A should be depth 1');
    if (depthMap['B'] !== 1) throw new Error('B should be depth 1');
    if (depthMap['D'] !== 1) throw new Error('D should be depth 1');
    if (depthMap['C'] !== 2) throw new Error('C should be depth 2');
    if (depthMap['E'] !== 2) throw new Error('E should be depth 2');
    console.log('  Depths verified: depth 1 (A,B,D), depth 2 (C,E)');

    // Test 3: Filter by relationship type
    console.log('\n✓ Test 3: Filter by relationship type "uses"');
    const filtered = await graphDB.findRelated('A', 2, { team: 'test', relationshipType: 'uses' });
    console.log(`  Found ${filtered.length} entities with "uses" relationship:`);
    filtered.forEach(r => console.log(`    - ${r.entity.name} (depth: ${r.depth}, type: ${r.relationshipType})`));

    if (filtered.length !== 1) {
      throw new Error(`Expected 1 entity with "uses", got ${filtered.length}`);
    }
    if (filtered[0].entity.name !== 'D') {
      throw new Error('Expected to find D via "uses" relationship');
    }

    // Test 4: Filter by entity type
    console.log('\n✓ Test 4: Filter by entity type "Problem"');
    const typeFiltered = await graphDB.findRelated('A', 2, { team: 'test', entityType: 'Problem' });
    console.log(`  Found ${typeFiltered.length} entities of type "Problem":`);
    typeFiltered.forEach(r => console.log(`    - ${r.entity.name} (depth: ${r.depth}, type: ${r.relationshipType})`));

    if (typeFiltered.length !== 1) {
      throw new Error(`Expected 1 entity of type "Problem", got ${typeFiltered.length}`);
    }
    if (typeFiltered[0].entity.name !== 'C') {
      throw new Error('Expected to find C (Problem type)');
    }

    // Test 5: Circular reference handling
    console.log('\n✓ Test 5: Circular reference (A -> A) handled correctly');
    const circularCheck = depth2.filter(r => r.entity.name === 'A');
    if (circularCheck.length !== 1) {
      throw new Error('Circular reference should be visited only once');
    }
    console.log('  Circular reference visited exactly once ✓');

    // Test 6: Non-existent entity error
    console.log('\n✓ Test 6: Non-existent entity throws error');
    try {
      await graphDB.findRelated('NonExistent', 2, { team: 'test' });
      throw new Error('Should have thrown error for non-existent entity');
    } catch (error) {
      if (!error.message.includes('Entity not found')) {
        throw error;
      }
      console.log('  Error thrown correctly: ' + error.message);
    }

    // Test 7: Performance benchmark (create larger graph)
    console.log('\n✓ Test 7: Performance benchmark (2-hop traversal)');
    const startTime = Date.now();

    // Create a chain of 100 entities
    for (let i = 1; i <= 100; i++) {
      await graphDB.storeEntity(
        { name: `Entity${i}`, entityType: 'Test', confidence: 0.5 },
        { team: 'perf' }
      );
      if (i > 1) {
        await graphDB.storeRelationship(
          `Entity${i-1}`,
          `Entity${i}`,
          'connects',
          { team: 'perf' }
        );
      }
    }

    const perfStart = Date.now();
    const perfResults = await graphDB.findRelated('Entity1', 2, { team: 'perf' });
    const perfTime = Date.now() - perfStart;

    console.log(`  Traversal time: ${perfTime}ms`);
    console.log(`  Entities found: ${perfResults.length} (expected 2)`);

    if (perfTime > 50) {
      console.warn(`  ⚠ Warning: Performance target is <50ms, got ${perfTime}ms`);
    } else {
      console.log('  Performance target met (<50ms) ✓');
    }

    // Cleanup
    await graphDB.close();
    fs.rmSync(testDbPath, { recursive: true, force: true });

    // Success
    console.log('\n' + '━'.repeat(60));
    console.log('✅ All graph traversal tests passed!');
    console.log('━'.repeat(60));
    console.log('\nTask 5 Complete: BFS traversal working correctly\n');

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

testGraphTraversal().then(success => {
  process.exit(success ? 0 : 1);
});
