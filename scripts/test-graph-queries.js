#!/usr/bin/env node
/**
 * Test GraphDatabaseService Query Interface
 *
 * Verifies Task 6: queryEntities, queryRelations, getTeams, getStatistics
 */

import { GraphDatabaseService } from '../src/knowledge-management/GraphDatabaseService.js';
import fs from 'fs';

async function testGraphQueries() {
  console.log('🧪 Testing GraphDatabaseService Query Interface\n');
  console.log('━'.repeat(60));

  const testDbPath = '.cache/test-graph-queries';

  // Cleanup
  if (fs.existsSync(testDbPath)) {
    fs.rmSync(testDbPath, { recursive: true, force: true });
  }

  try {
    // Initialize
    console.log('\n✓ Test Setup: Create test graph with multiple teams');
    const graphDB = new GraphDatabaseService({ dbPath: testDbPath });
    await graphDB.initialize();

    // Create entities for team 'alpha'
    await graphDB.storeEntity(
      { name: 'AuthPattern', entityType: 'Pattern', confidence: 0.9, source: 'manual' },
      { team: 'alpha' }
    );
    await graphDB.storeEntity(
      { name: 'CachePattern', entityType: 'Pattern', confidence: 0.8, source: 'auto' },
      { team: 'alpha' }
    );
    await graphDB.storeEntity(
      { name: 'SecurityIssue', entityType: 'Problem', confidence: 0.7, source: 'auto' },
      { team: 'alpha' }
    );

    // Create entities for team 'beta'
    await graphDB.storeEntity(
      { name: 'LoggingTool', entityType: 'Tool', confidence: 0.6, source: 'manual' },
      { team: 'beta' }
    );
    await graphDB.storeEntity(
      { name: 'APIDesign', entityType: 'Pattern', confidence: 0.9, source: 'manual' },
      { team: 'beta' }
    );

    // Create relationships
    await graphDB.storeRelationship('AuthPattern', 'SecurityIssue', 'solves', { team: 'alpha' });
    await graphDB.storeRelationship('CachePattern', 'AuthPattern', 'uses', { team: 'alpha' });
    await graphDB.storeRelationship('APIDesign', 'LoggingTool', 'uses', { team: 'beta' });

    console.log('  Created 5 entities (3 alpha, 2 beta) and 3 relationships');

    // Test 1: Query all entities
    console.log('\n✓ Test 1: Query all entities');
    const allEntities = await graphDB.queryEntities();
    console.log(`  Found ${allEntities.length} entities`);
    if (allEntities.length !== 5) {
      throw new Error(`Expected 5 entities, got ${allEntities.length}`);
    }
    console.log(`  Sample entity: ${allEntities[0].entity_name} (team: ${allEntities[0].team})`);

    // Test 2: Query entities by team
    console.log('\n✓ Test 2: Query entities by team "alpha"');
    const alphaEntities = await graphDB.queryEntities({ team: 'alpha' });
    console.log(`  Found ${alphaEntities.length} alpha entities:`);
    alphaEntities.forEach(e => console.log(`    - ${e.entity_name} (${e.entity_type})`));
    if (alphaEntities.length !== 3) {
      throw new Error(`Expected 3 alpha entities, got ${alphaEntities.length}`);
    }

    // Test 3: Query entities by type
    console.log('\n✓ Test 3: Query entities by type "Pattern"');
    const patterns = await graphDB.queryEntities({ types: ['Pattern'] });
    console.log(`  Found ${patterns.length} patterns:`);
    patterns.forEach(e => console.log(`    - ${e.entity_name} (team: ${e.team})`));
    if (patterns.length !== 3) {
      throw new Error(`Expected 3 patterns, got ${patterns.length}`);
    }

    // Test 4: Query entities by source
    console.log('\n✓ Test 4: Query entities by source "manual"');
    const manualEntities = await graphDB.queryEntities({ source: 'manual' });
    console.log(`  Found ${manualEntities.length} manual entities`);
    if (manualEntities.length !== 3) {
      throw new Error(`Expected 3 manual entities, got ${manualEntities.length}`);
    }

    // Test 5: Query entities by confidence
    console.log('\n✓ Test 5: Query entities with minConfidence 0.8');
    const highConfidence = await graphDB.queryEntities({ minConfidence: 0.8 });
    console.log(`  Found ${highConfidence.length} high-confidence entities:`);
    highConfidence.forEach(e => console.log(`    - ${e.entity_name} (confidence: ${e.confidence})`));
    if (highConfidence.length !== 3) {
      throw new Error(`Expected 3 high-confidence entities, got ${highConfidence.length}`);
    }

    // Test 6: Search by term
    console.log('\n✓ Test 6: Search entities by term "pattern"');
    const searchResults = await graphDB.queryEntities({ searchTerm: 'pattern' });
    console.log(`  Found ${searchResults.length} entities matching "pattern":`);
    searchResults.forEach(e => console.log(`    - ${e.entity_name}`));
    // Should find: AuthPattern, CachePattern (not APIDesign)
    if (searchResults.length !== 2) {
      throw new Error(`Expected 2 matching entities, got ${searchResults.length}`);
    }

    // Test 7: Pagination
    console.log('\n✓ Test 7: Test pagination (limit 2, offset 1)');
    const page = await graphDB.queryEntities({ limit: 2, offset: 1 });
    console.log(`  Got ${page.length} entities (expected 2)`);
    if (page.length !== 2) {
      throw new Error(`Expected 2 entities in page, got ${page.length}`);
    }

    // Test 8: Query all relations
    console.log('\n✓ Test 8: Query all relations');
    const allRelations = await graphDB.queryRelations();
    console.log(`  Found ${allRelations.length} relations:`);
    allRelations.forEach(r => console.log(`    - ${r.from_name} --${r.relation_type}--> ${r.to_name}`));
    if (allRelations.length !== 3) {
      throw new Error(`Expected 3 relations, got ${allRelations.length}`);
    }

    // Test 9: Query relations by team
    console.log('\n✓ Test 9: Query relations by team "alpha"');
    const alphaRelations = await graphDB.queryRelations({ team: 'alpha' });
    console.log(`  Found ${alphaRelations.length} alpha relations`);
    if (alphaRelations.length !== 2) {
      throw new Error(`Expected 2 alpha relations, got ${alphaRelations.length}`);
    }

    // Test 10: Query relations by type
    console.log('\n✓ Test 10: Query relations by type "uses"');
    const usesRelations = await graphDB.queryRelations({ relationType: 'uses' });
    console.log(`  Found ${usesRelations.length} "uses" relations:`);
    usesRelations.forEach(r => console.log(`    - ${r.from_name} uses ${r.to_name}`));
    if (usesRelations.length !== 2) {
      throw new Error(`Expected 2 "uses" relations, got ${usesRelations.length}`);
    }

    // Test 11: Query relations by entity
    console.log('\n✓ Test 11: Query relations for entity "alpha:AuthPattern"');
    const authRelations = await graphDB.queryRelations({ entityId: 'alpha:AuthPattern' });
    console.log(`  Found ${authRelations.length} relations involving AuthPattern:`);
    authRelations.forEach(r => console.log(`    - ${r.from_name} --${r.relation_type}--> ${r.to_name}`));
    if (authRelations.length !== 2) {
      throw new Error(`Expected 2 relations, got ${authRelations.length}`);
    }

    // Test 12: Get teams
    console.log('\n✓ Test 12: Get all teams');
    const teams = await graphDB.getTeams();
    console.log(`  Found ${teams.length} teams:`);
    teams.forEach(t => console.log(`    - ${t.displayName}: ${t.entityCount} entities`));
    if (teams.length !== 2) {
      throw new Error(`Expected 2 teams, got ${teams.length}`);
    }
    if (teams[0].name !== 'alpha' || teams[0].entityCount !== 3) {
      throw new Error('Expected alpha team with 3 entities to be first');
    }

    // Test 13: Get statistics (all teams)
    console.log('\n✓ Test 13: Get statistics for all teams');
    const stats = await graphDB.getStatistics();
    console.log(`  Total entities: ${stats.totalEntities}`);
    console.log(`  Entity breakdowns: ${stats.entitiesByTeamAndSource.length}`);
    console.log(`  Relation breakdowns: ${stats.relationsByTeamAndType.length}`);
    if (stats.totalEntities !== 5) {
      throw new Error(`Expected 5 total entities, got ${stats.totalEntities}`);
    }

    // Test 14: Get statistics (filtered by team)
    console.log('\n✓ Test 14: Get statistics for team "beta"');
    const betaStats = await graphDB.getStatistics({ team: 'beta' });
    console.log(`  Beta total entities: ${betaStats.totalEntities}`);
    console.log(`  Beta entity breakdowns: ${betaStats.entitiesByTeamAndSource.length}`);
    if (betaStats.totalEntities !== 2) {
      throw new Error(`Expected 2 beta entities, got ${betaStats.totalEntities}`);
    }

    // Test 15: Performance test (single entity query <10ms)
    console.log('\n✓ Test 15: Performance test - single entity query');
    const perfStart = Date.now();
    await graphDB.queryEntities({ searchTerm: 'AuthPattern', limit: 1 });
    const perfTime = Date.now() - perfStart;
    console.log(`  Query time: ${perfTime}ms`);
    if (perfTime > 10) {
      console.warn(`  ⚠ Warning: Performance target is <10ms, got ${perfTime}ms`);
    } else {
      console.log('  Performance target met (<10ms) ✓');
    }

    // Cleanup
    await graphDB.close();
    fs.rmSync(testDbPath, { recursive: true, force: true });

    // Success
    console.log('\n' + '━'.repeat(60));
    console.log('✅ All query interface tests passed!');
    console.log('━'.repeat(60));
    console.log('\nTask 6 Complete: SQL-compatible query interface working correctly\n');

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

testGraphQueries().then(success => {
  process.exit(success ? 0 : 1);
});
