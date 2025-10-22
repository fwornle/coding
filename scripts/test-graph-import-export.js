#!/usr/bin/env node
/**
 * Test GraphDatabaseService Import/Export
 *
 * Verifies Task 7: exportToJSON, importFromJSON
 */

import { GraphDatabaseService } from '../src/knowledge-management/GraphDatabaseService.js';
import fs from 'fs/promises';
import fsSync from 'fs';

async function testImportExport() {
  console.log('🧪 Testing GraphDatabaseService Import/Export\n');
  console.log('━'.repeat(60));

  const testDbPath = '.cache/test-graph-import-export';
  const exportFilePath = '.cache/test-export.json';
  const malformedFilePath = '.cache/test-malformed.json';

  // Cleanup
  if (fsSync.existsSync(testDbPath)) {
    fsSync.rmSync(testDbPath, { recursive: true, force: true });
  }
  if (fsSync.existsSync(exportFilePath)) {
    fsSync.unlinkSync(exportFilePath);
  }
  if (fsSync.existsSync(malformedFilePath)) {
    fsSync.unlinkSync(malformedFilePath);
  }

  try {
    // Test 1: Create test data
    console.log('\n✓ Test 1: Create test data');
    const graphDB = new GraphDatabaseService({ dbPath: testDbPath });
    await graphDB.initialize();

    await graphDB.storeEntity(
      { name: 'PatternA', entityType: 'Pattern', observations: ['Obs1', 'Obs2'], confidence: 0.9 },
      { team: 'test-team' }
    );
    await graphDB.storeEntity(
      { name: 'PatternB', entityType: 'Pattern', observations: ['Obs3'], confidence: 0.8 },
      { team: 'test-team' }
    );
    await graphDB.storeEntity(
      { name: 'Problem1', entityType: 'Problem', confidence: 0.7 },
      { team: 'test-team' }
    );

    await graphDB.storeRelationship('PatternA', 'PatternB', 'uses', { team: 'test-team', confidence: 0.95 });
    await graphDB.storeRelationship('PatternA', 'Problem1', 'solves', { team: 'test-team' });

    console.log('  Created 3 entities and 2 relations for team "test-team"');

    // Test 2: Export to JSON
    console.log('\n✓ Test 2: Export to JSON file');
    const exportResult = await graphDB.exportToJSON('test-team', exportFilePath);
    console.log(`  Exported ${exportResult.entityCount} entities, ${exportResult.relationCount} relations`);
    console.log(`  File: ${exportResult.filePath}`);

    if (exportResult.entityCount !== 3) {
      throw new Error(`Expected 3 entities, got ${exportResult.entityCount}`);
    }
    if (exportResult.relationCount !== 2) {
      throw new Error(`Expected 2 relations, got ${exportResult.relationCount}`);
    }

    // Test 3: Verify export file format
    console.log('\n✓ Test 3: Verify export file format');
    const exportContent = await fs.readFile(exportFilePath, 'utf-8');
    const exportData = JSON.parse(exportContent);

    console.log(`  displayName: ${exportData.displayName}`);
    console.log(`  entities.length: ${exportData.entities.length}`);
    console.log(`  relations.length: ${exportData.relations.length}`);

    if (!exportData.displayName || !exportData.entities || !exportData.relations || !exportData.metadata) {
      throw new Error('Invalid export format');
    }

    // Check entity structure
    const firstEntity = exportData.entities[0];
    if (!firstEntity.name || !firstEntity.entityType || !Array.isArray(firstEntity.observations)) {
      throw new Error('Invalid entity structure in export');
    }

    // Check relation structure
    const firstRelation = exportData.relations[0];
    if (!firstRelation.from || !firstRelation.to || !firstRelation.relationType) {
      throw new Error('Invalid relation structure in export');
    }

    console.log('  Export format validated ✓');

    // Test 4: Import from JSON (fresh database)
    console.log('\n✓ Test 4: Import from JSON into fresh database');
    const graphDB2 = new GraphDatabaseService({ dbPath: testDbPath + '-2' });
    await graphDB2.initialize();

    const importResult = await graphDB2.importFromJSON(exportFilePath);
    console.log(`  Imported ${importResult.entitiesImported}/${importResult.entitiesTotal} entities`);
    console.log(`  Imported ${importResult.relationsImported}/${importResult.relationsTotal} relations`);

    if (importResult.entitiesImported !== 3) {
      throw new Error(`Expected 3 entities imported, got ${importResult.entitiesImported}`);
    }
    if (importResult.relationsImported !== 2) {
      throw new Error(`Expected 2 relations imported, got ${importResult.relationsImported}`);
    }

    // Test 5: Verify imported data
    console.log('\n✓ Test 5: Verify imported data matches original');
    const entity = await graphDB2.getEntity('PatternA', importResult.team);
    if (!entity) {
      throw new Error('PatternA not found after import');
    }
    if (entity.entityType !== 'Pattern') {
      throw new Error('Entity type mismatch');
    }
    if (entity.observations.length !== 2) {
      throw new Error('Observations not imported correctly');
    }
    console.log(`  Entity verified: ${entity.name} (${entity.entityType})`);

    const relations = await graphDB2.queryRelations({ team: importResult.team });
    if (relations.length !== 2) {
      throw new Error(`Expected 2 relations, got ${relations.length}`);
    }
    console.log(`  Relations verified: ${relations.length} relations found`);

    // Test 6: Idempotent import (import again)
    console.log('\n✓ Test 6: Test idempotent import (import twice)');
    const importResult2 = await graphDB2.importFromJSON(exportFilePath);
    console.log(`  Second import: ${importResult2.entitiesImported} entities, ${importResult2.relationsImported} relations`);

    // Should still have same number of entities (updated, not duplicated)
    const allEntities = await graphDB2.queryEntities({ team: importResult.team });
    if (allEntities.length !== 3) {
      throw new Error(`Expected 3 entities after double import, got ${allEntities.length}`);
    }
    console.log('  Idempotent import verified ✓');

    // Test 7: Error handling - file not found
    console.log('\n✓ Test 7: Error handling - file not found');
    try {
      await graphDB2.importFromJSON('.cache/nonexistent.json');
      throw new Error('Should have thrown error for missing file');
    } catch (error) {
      if (!error.message.includes('not found')) {
        throw error;
      }
      console.log(`  Error handled correctly: ${error.message}`);
    }

    // Test 8: Error handling - malformed JSON
    console.log('\n✓ Test 8: Error handling - malformed JSON');
    await fs.writeFile(malformedFilePath, '{ "invalid": json }', 'utf-8');
    try {
      await graphDB2.importFromJSON(malformedFilePath);
      throw new Error('Should have thrown error for malformed JSON');
    } catch (error) {
      if (!error.message.includes('Invalid JSON')) {
        throw error;
      }
      console.log(`  Error handled correctly: ${error.message}`);
    }

    // Test 9: Error handling - invalid schema (missing entities)
    console.log('\n✓ Test 9: Error handling - invalid schema');
    await fs.writeFile(malformedFilePath, JSON.stringify({ relations: [] }), 'utf-8');
    try {
      await graphDB2.importFromJSON(malformedFilePath);
      throw new Error('Should have thrown error for invalid schema');
    } catch (error) {
      if (!error.message.includes('missing or invalid "entities"')) {
        throw error;
      }
      console.log(`  Error handled correctly: ${error.message}`);
    }

    // Test 10: Export parameter validation
    console.log('\n✓ Test 10: Export parameter validation');
    try {
      await graphDB.exportToJSON(null, exportFilePath);
      throw new Error('Should have thrown error for missing team');
    } catch (error) {
      if (!error.message.includes('Team parameter is required')) {
        throw error;
      }
      console.log(`  Team validation works: ${error.message}`);
    }

    try {
      await graphDB.exportToJSON('test-team', null);
      throw new Error('Should have thrown error for missing file path');
    } catch (error) {
      if (!error.message.includes('File path is required')) {
        throw error;
      }
      console.log(`  File path validation works: ${error.message}`);
    }

    // Cleanup
    await graphDB.close();
    await graphDB2.close();
    fsSync.rmSync(testDbPath, { recursive: true, force: true });
    fsSync.rmSync(testDbPath + '-2', { recursive: true, force: true });
    fsSync.unlinkSync(exportFilePath);
    fsSync.unlinkSync(malformedFilePath);

    // Success
    console.log('\n' + '━'.repeat(60));
    console.log('✅ All import/export tests passed!');
    console.log('━'.repeat(60));
    console.log('\nTask 7 Complete: JSON import/export working correctly\n');

    return true;

  } catch (error) {
    console.error('\n' + '━'.repeat(60));
    console.error('❌ Test failed:', error.message);
    console.error('━'.repeat(60));
    console.error('\nStack:', error.stack);

    // Cleanup
    try {
      if (fsSync.existsSync(testDbPath)) {
        fsSync.rmSync(testDbPath, { recursive: true, force: true });
      }
      if (fsSync.existsSync(testDbPath + '-2')) {
        fsSync.rmSync(testDbPath + '-2', { recursive: true, force: true });
      }
      if (fsSync.existsSync(exportFilePath)) {
        fsSync.unlinkSync(exportFilePath);
      }
      if (fsSync.existsSync(malformedFilePath)) {
        fsSync.unlinkSync(malformedFilePath);
      }
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError.message);
    }

    return false;
  }
}

testImportExport().then(success => {
  process.exit(success ? 0 : 1);
});
