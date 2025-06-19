/**
 * Entity Manager Tests
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'fs';
import path from 'path';
import { EntityManager } from '../core/entities.js';
import { FileStorageAdapter } from '../adapters/file-storage.js';
import { ValidationService } from '../core/validation.js';
import { Logger } from '../utils/logging.js';

describe('EntityManager', () => {
  let entityManager;
  let storage;
  let validation;
  let logger;
  let testDbPath;

  beforeEach(async () => {
    // Create temporary test database
    testDbPath = path.join(process.cwd(), `test-db-${Date.now()}.json`);
    
    logger = new Logger({ level: 'error', console: false });
    validation = new ValidationService();
    storage = new FileStorageAdapter({ path: testDbPath }, logger);
    
    await storage.initialize();
    
    entityManager = new EntityManager(storage, validation, logger);
  });

  afterEach(async () => {
    // Cleanup test database
    try {
      await fs.unlink(testDbPath);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('should create a new entity', async () => {
    const entityData = {
      name: 'TestEntity',
      entityType: 'WorkflowPattern',
      observations: ['Test observation'],
      significance: 8
    };

    const entity = await entityManager.create(entityData);

    assert.strictEqual(entity.name, 'TestEntity');
    assert.strictEqual(entity.entityType, 'WorkflowPattern');
    assert.strictEqual(entity.significance, 8);
    assert.ok(entity.id);
    assert.ok(entity.created);
    assert.ok(entity.updated);
  });

  test('should prevent duplicate entity names', async () => {
    const entityData = {
      name: 'DuplicateTest',
      entityType: 'Problem'
    };

    await entityManager.create(entityData);

    await assert.rejects(
      () => entityManager.create(entityData),
      /already exists/
    );
  });

  test('should find entity by name', async () => {
    const entityData = {
      name: 'FindByNameTest',
      entityType: 'Solution'
    };

    await entityManager.create(entityData);
    const found = await entityManager.findByName('FindByNameTest');

    assert.strictEqual(found.name, 'FindByNameTest');
    assert.strictEqual(found.entityType, 'Solution');
  });

  test('should find entity by ID', async () => {
    const entityData = {
      name: 'FindByIdTest',
      entityType: 'Tool'
    };

    const created = await entityManager.create(entityData);
    const found = await entityManager.findById(created.id);

    assert.strictEqual(found.id, created.id);
    assert.strictEqual(found.name, 'FindByIdTest');
  });

  test('should get all entities with filters', async () => {
    await entityManager.create({
      name: 'Entity1',
      entityType: 'Problem',
      significance: 8
    });

    await entityManager.create({
      name: 'Entity2',
      entityType: 'Solution',
      significance: 5
    });

    await entityManager.create({
      name: 'Entity3',
      entityType: 'Problem',
      significance: 3
    });

    // Test entity type filter
    const problems = await entityManager.getAll({ entityType: 'Problem' });
    assert.strictEqual(problems.length, 2);

    // Test significance filter
    const highSignificance = await entityManager.getAll({ minSignificance: 7 });
    assert.strictEqual(highSignificance.length, 1);
    assert.strictEqual(highSignificance[0].name, 'Entity1');

    // Test search filter
    const searchResults = await entityManager.getAll({ search: 'entity1' });
    assert.strictEqual(searchResults.length, 1);
    assert.strictEqual(searchResults[0].name, 'Entity1');
  });

  test('should update entity', async () => {
    const entityData = {
      name: 'UpdateTest',
      entityType: 'Framework',
      significance: 5
    };

    const created = await entityManager.create(entityData);
    
    const updated = await entityManager.update(created.name, {
      significance: 9,
      observations: ['Updated observation']
    });

    assert.strictEqual(updated.significance, 9);
    assert.strictEqual(updated.observations.length, 1);
    assert.strictEqual(updated.observations[0], 'Updated observation');
    assert.notStrictEqual(updated.updated, created.updated);
  });

  test('should add observation to entity', async () => {
    const entityData = {
      name: 'ObservationTest',
      entityType: 'Best Practice'
    };

    const created = await entityManager.create(entityData);
    
    const observation = await entityManager.addObservation(created.name, 'New observation');

    assert.strictEqual(observation.content, 'New observation');
    assert.strictEqual(observation.type, 'general');
    assert.ok(observation.date);

    // Verify it was added to the entity
    const updated = await entityManager.findByName(created.name);
    assert.strictEqual(updated.observations.length, 1);
  });

  test('should remove observation from entity', async () => {
    const entityData = {
      name: 'RemoveObservationTest',
      entityType: 'Documentation',
      observations: ['First observation', 'Second observation']
    };

    const created = await entityManager.create(entityData);
    
    await entityManager.removeObservation(created.name, 0);

    const updated = await entityManager.findByName(created.name);
    assert.strictEqual(updated.observations.length, 1);
    assert.strictEqual(updated.observations[0], 'Second observation');
  });

  test('should delete entity', async () => {
    const entityData = {
      name: 'DeleteTest',
      entityType: 'Testing'
    };

    await entityManager.create(entityData);
    
    const result = await entityManager.delete('DeleteTest');
    assert.strictEqual(result, true);

    const found = await entityManager.findByName('DeleteTest');
    assert.strictEqual(found, undefined);
  });

  test('should rename entity', async () => {
    const entityData = {
      name: 'OldName',
      entityType: 'Example'
    };

    await entityManager.create(entityData);
    
    const renamed = await entityManager.rename('OldName', 'NewName');

    assert.strictEqual(renamed.name, 'NewName');
    
    const oldEntity = await entityManager.findByName('OldName');
    const newEntity = await entityManager.findByName('NewName');
    
    assert.strictEqual(oldEntity, undefined);
    assert.ok(newEntity);
    assert.strictEqual(newEntity.name, 'NewName');
  });

  test('should get entity count', async () => {
    assert.strictEqual(await entityManager.count(), 0);

    await entityManager.create({
      name: 'Count1',
      entityType: 'Test'
    });

    await entityManager.create({
      name: 'Count2',
      entityType: 'Test'
    });

    assert.strictEqual(await entityManager.count(), 2);
  });

  test('should get entities by type', async () => {
    await entityManager.create({
      name: 'TypeTest1',
      entityType: 'Pattern'
    });

    await entityManager.create({
      name: 'TypeTest2',
      entityType: 'Pattern'
    });

    await entityManager.create({
      name: 'TypeTest3',
      entityType: 'Tool'
    });

    const patterns = await entityManager.getByType('Pattern');
    assert.strictEqual(patterns.length, 2);
    
    const tools = await entityManager.getByType('Tool');
    assert.strictEqual(tools.length, 1);
  });

  test('should search entities', async () => {
    await entityManager.create({
      name: 'SearchableEntity',
      entityType: 'Example',
      observations: ['This contains searchable content']
    });

    await entityManager.create({
      name: 'AnotherEntity',
      entityType: 'Example',
      observations: ['This has different content']
    });

    const results = await entityManager.search('searchable');
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].name, 'SearchableEntity');
  });

  test('should get high significance entities', async () => {
    await entityManager.create({
      name: 'HighSig1',
      entityType: 'Important',
      significance: 9
    });

    await entityManager.create({
      name: 'HighSig2',
      entityType: 'Important',
      significance: 8
    });

    await entityManager.create({
      name: 'LowSig',
      entityType: 'Normal',
      significance: 5
    });

    const highSig = await entityManager.getHighSignificance(8);
    assert.strictEqual(highSig.length, 2);
  });

  test('should validate entity data', async () => {
    await assert.rejects(
      () => entityManager.create({
        // Missing name
        entityType: 'Test'
      }),
      /Invalid entity data/
    );

    await assert.rejects(
      () => entityManager.create({
        name: 'Test',
        // Missing entityType
      }),
      /Invalid entity data/
    );

    await assert.rejects(
      () => entityManager.create({
        name: 'Test',
        entityType: 'Test',
        significance: 15 // Invalid significance
      }),
      /Invalid entity data/
    );
  });
});