/**
 * Knowledge API Integration Tests
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'fs';
import path from 'path';
import KnowledgeAPI from '../index.js';

describe('KnowledgeAPI', () => {
  let api;
  let testDbPath;

  beforeEach(async () => {
    testDbPath = path.join(process.cwd(), `test-api-${Date.now()}.json`);
    
    api = new KnowledgeAPI({
      storage: {
        path: testDbPath
      },
      logging: {
        level: 'error',
        console: false
      }
    });

    await api.initialize();
  });

  afterEach(async () => {
    if (api) {
      await api.close();
    }
    try {
      await fs.unlink(testDbPath);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('should initialize successfully', async () => {
    const status = await api.getStatus();
    
    assert.strictEqual(status.status, 'ready');
    assert.strictEqual(status.version, '1.0.0');
    assert.strictEqual(status.stats.entities, 0);
    assert.strictEqual(status.stats.relations, 0);
    assert.ok(status.timestamp);
  });

  test('should provide access to core managers', () => {
    assert.ok(api.entities);
    assert.ok(api.relations);
    assert.ok(api.insights);
    assert.ok(api.validation);
    assert.ok(api.storage);
  });

  test('should create and manage entities through API', async () => {
    // Create entity
    const entity = await api.entities.create({
      name: 'APITestEntity',
      entityType: 'Example',
      significance: 7
    });

    assert.strictEqual(entity.name, 'APITestEntity');
    assert.strictEqual(entity.significance, 7);

    // Get status to verify count
    const status = await api.getStatus();
    assert.strictEqual(status.stats.entities, 1);

    // Find entity
    const found = await api.entities.findByName('APITestEntity');
    assert.strictEqual(found.name, 'APITestEntity');
  });

  test('should create and manage relations through API', async () => {
    // Create entities first
    await api.entities.create({
      name: 'SourceEntity',
      entityType: 'Problem'
    });

    await api.entities.create({
      name: 'TargetEntity',
      entityType: 'Solution'
    });

    // Create relation
    const relation = await api.relations.create({
      from: 'SourceEntity',
      to: 'TargetEntity',
      relationType: 'solves',
      significance: 8
    });

    assert.strictEqual(relation.from, 'SourceEntity');
    assert.strictEqual(relation.to, 'TargetEntity');
    assert.strictEqual(relation.relationType, 'solves');

    // Get status to verify count
    const status = await api.getStatus();
    assert.strictEqual(status.stats.relations, 1);
  });

  test('should process insights through API', async () => {
    const insightData = {
      type: 'problem-solution',
      problem: 'Test problem description',
      solution: 'Test solution description'
    };

    const result = await api.insights.processInsight(insightData);

    assert.ok(result.entities);
    assert.ok(result.relations);
    assert.ok(result.significance);
    assert.ok(result.processed);

    // Verify entities were created
    const status = await api.getStatus();
    assert.ok(status.stats.entities > 0);
  });

  test('should handle configuration correctly', async () => {
    const customApi = new KnowledgeAPI({
      storage: {
        path: path.join(process.cwd(), `custom-test-${Date.now()}.json`)
      },
      analysis: {
        significance_threshold: 8
      }
    });

    await customApi.initialize();

    assert.strictEqual(customApi.config.get('analysis.significance_threshold'), 8);

    await customApi.close();
    try {
      await fs.unlink(customApi.config.get('storage.path'));
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('should validate data through validation service', async () => {
    const validation = api.validation;

    // Valid entity
    const validEntity = await validation.validateEntity({
      name: 'ValidEntity',
      entityType: 'Test',
      significance: 5
    });
    assert.strictEqual(validEntity.valid, true);

    // Invalid entity
    const invalidEntity = await validation.validateEntity({
      name: '', // Invalid name
      entityType: 'Test'
    });
    assert.strictEqual(invalidEntity.valid, false);
    assert.ok(invalidEntity.errors.length > 0);

    // Valid relation
    const validRelation = await validation.validateRelation({
      from: 'EntityA',
      to: 'EntityB',
      relationType: 'uses'
    });
    assert.strictEqual(validRelation.valid, true);

    // Invalid relation
    const invalidRelation = await validation.validateRelation({
      from: 'EntityA',
      // Missing 'to' and 'relationType'
    });
    assert.strictEqual(invalidRelation.valid, false);
    assert.ok(invalidRelation.errors.length > 0);
  });

  test('should handle storage operations', async () => {
    // Create some test data
    await api.entities.create({
      name: 'StorageTestEntity',
      entityType: 'Test'
    });

    // Get storage info
    const storageInfo = api.storage.getInfo();
    assert.strictEqual(storageInfo.type, 'file');
    assert.strictEqual(storageInfo.entities, 1);
    assert.strictEqual(storageInfo.relations, 0);

    // Export data
    const exportedData = await api.storage.exportData();
    assert.ok(exportedData.entities);
    assert.ok(exportedData.relations);
    assert.ok(exportedData.metadata);
    assert.strictEqual(exportedData.entities.length, 1);

    // Get statistics
    const stats = await api.storage.getStatistics();
    assert.strictEqual(stats.entities.total, 1);
    assert.strictEqual(stats.relations.total, 0);
    assert.ok(stats.entities.types);
  });

  test('should handle errors gracefully', async () => {
    // Test entity creation with invalid data
    await assert.rejects(
      () => api.entities.create({
        name: 'Test',
        entityType: 'Test',
        significance: 15 // Invalid significance
      }),
      /Invalid entity data/
    );

    // Test relation creation with non-existent entities
    await assert.rejects(
      () => api.relations.create({
        from: 'NonExistent1',
        to: 'NonExistent2',
        relationType: 'uses'
      }),
      /Source entity not found/
    );

    // Test insight processing with invalid data
    await assert.rejects(
      () => api.insights.processInsight({
        type: 'invalid-type'
      }),
      /Invalid insight type/
    );
  });

  test('should maintain data consistency', async () => {
    // Create entities and relations
    await api.entities.create({
      name: 'ConsistencyTestA',
      entityType: 'Test'
    });

    await api.entities.create({
      name: 'ConsistencyTestB',
      entityType: 'Test'
    });

    const relation = await api.relations.create({
      from: 'ConsistencyTestA',
      to: 'ConsistencyTestB',
      relationType: 'related_to'
    });

    // Rename entity and update relations
    await api.entities.rename('ConsistencyTestA', 'RenamedTestA');
    await api.relations.updateEntityReferences('ConsistencyTestA', 'RenamedTestA');

    // Verify consistency
    const updatedRelation = await api.relations.findById(relation.id);
    assert.strictEqual(updatedRelation.from, 'RenamedTestA');

    const renamedEntity = await api.entities.findByName('RenamedTestA');
    assert.ok(renamedEntity);

    const oldEntity = await api.entities.findByName('ConsistencyTestA');
    assert.strictEqual(oldEntity, undefined);
  });

  test('should close properly', async () => {
    const status1 = await api.getStatus();
    assert.strictEqual(status1.status, 'ready');

    await api.close();

    // After closing, operations should fail
    await assert.rejects(
      () => api.entities.getAll(),
      /Storage not initialized/
    );
  });
});