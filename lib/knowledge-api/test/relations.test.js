/**
 * Relation Manager Tests
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'fs';
import path from 'path';
import { EntityManager } from '../core/entities.js';
import { RelationManager } from '../core/relations.js';
import { FileStorageAdapter } from '../adapters/file-storage.js';
import { ValidationService } from '../core/validation.js';
import { Logger } from '../utils/logging.js';

describe('RelationManager', () => {
  let relationManager;
  let entityManager;
  let storage;
  let validation;
  let logger;
  let testDbPath;

  beforeEach(async () => {
    testDbPath = path.join(process.cwd(), `test-relations-${Date.now()}.json`);
    
    logger = new Logger({ level: 'error', console: false });
    validation = new ValidationService();
    storage = new FileStorageAdapter({ path: testDbPath }, logger);
    
    await storage.initialize();
    
    entityManager = new EntityManager(storage, validation, logger);
    relationManager = new RelationManager(storage, validation, logger);

    // Create test entities
    await entityManager.create({
      name: 'EntityA',
      entityType: 'Problem'
    });

    await entityManager.create({
      name: 'EntityB',
      entityType: 'Solution'
    });

    await entityManager.create({
      name: 'EntityC',
      entityType: 'Tool'
    });
  });

  afterEach(async () => {
    try {
      await fs.unlink(testDbPath);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('should create a new relation', async () => {
    const relationData = {
      from: 'EntityA',
      to: 'EntityB',
      relationType: 'solves',
      significance: 8
    };

    const relation = await relationManager.create(relationData);

    assert.strictEqual(relation.from, 'EntityA');
    assert.strictEqual(relation.to, 'EntityB');
    assert.strictEqual(relation.relationType, 'solves');
    assert.strictEqual(relation.significance, 8);
    assert.ok(relation.id);
    assert.ok(relation.created);
  });

  test('should prevent duplicate relations', async () => {
    const relationData = {
      from: 'EntityA',
      to: 'EntityB',
      relationType: 'uses'
    };

    await relationManager.create(relationData);

    await assert.rejects(
      () => relationManager.create(relationData),
      /already exists/
    );
  });

  test('should require existing entities', async () => {
    await assert.rejects(
      () => relationManager.create({
        from: 'NonExistentEntity',
        to: 'EntityB',
        relationType: 'uses'
      }),
      /Source entity not found/
    );

    await assert.rejects(
      () => relationManager.create({
        from: 'EntityA',
        to: 'NonExistentEntity',
        relationType: 'uses'
      }),
      /Target entity not found/
    );
  });

  test('should find specific relation', async () => {
    await relationManager.create({
      from: 'EntityA',
      to: 'EntityB',
      relationType: 'implements'
    });

    const found = await relationManager.findRelation('EntityA', 'EntityB', 'implements');
    assert.ok(found);
    assert.strictEqual(found.from, 'EntityA');
    assert.strictEqual(found.to, 'EntityB');
    assert.strictEqual(found.relationType, 'implements');

    const notFound = await relationManager.findRelation('EntityA', 'EntityB', 'different');
    assert.strictEqual(notFound, undefined);
  });

  test('should find relation by ID', async () => {
    const created = await relationManager.create({
      from: 'EntityA',
      to: 'EntityC',
      relationType: 'uses'
    });

    const found = await relationManager.findById(created.id);
    assert.strictEqual(found.id, created.id);
    assert.strictEqual(found.from, 'EntityA');
    assert.strictEqual(found.to, 'EntityC');
  });

  test('should get all relations with filters', async () => {
    await relationManager.create({
      from: 'EntityA',
      to: 'EntityB',
      relationType: 'solves',
      significance: 9
    });

    await relationManager.create({
      from: 'EntityB',
      to: 'EntityC',
      relationType: 'uses',
      significance: 5
    });

    await relationManager.create({
      from: 'EntityA',
      to: 'EntityC',
      relationType: 'related_to',
      significance: 7
    });

    // Test from filter
    const fromA = await relationManager.getAll({ from: 'EntityA' });
    assert.strictEqual(fromA.length, 2);

    // Test to filter
    const toC = await relationManager.getAll({ to: 'EntityC' });
    assert.strictEqual(toC.length, 2);

    // Test relationType filter
    const solvesRel = await relationManager.getAll({ relationType: 'solves' });
    assert.strictEqual(solvesRel.length, 1);

    // Test significance filter
    const highSig = await relationManager.getAll({ minSignificance: 8 });
    assert.strictEqual(highSig.length, 1);
    assert.strictEqual(highSig[0].significance, 9);
  });

  test('should get relations for entity', async () => {
    await relationManager.create({
      from: 'EntityA',
      to: 'EntityB',
      relationType: 'solves'
    });

    await relationManager.create({
      from: 'EntityC',
      to: 'EntityA',
      relationType: 'uses'
    });

    // Test both directions
    const bothDirections = await relationManager.getForEntity('EntityA', 'both');
    assert.strictEqual(bothDirections.length, 2);

    // Test outgoing only
    const outgoing = await relationManager.getForEntity('EntityA', 'outgoing');
    assert.strictEqual(outgoing.length, 1);
    assert.strictEqual(outgoing[0].to, 'EntityB');

    // Test incoming only
    const incoming = await relationManager.getForEntity('EntityA', 'incoming');
    assert.strictEqual(incoming.length, 1);
    assert.strictEqual(incoming[0].from, 'EntityC');
  });

  test('should update relation', async () => {
    const created = await relationManager.create({
      from: 'EntityA',
      to: 'EntityB',
      relationType: 'uses',
      significance: 5
    });

    const updated = await relationManager.update(created.id, {
      significance: 8,
      relationType: 'implements'
    });

    assert.strictEqual(updated.significance, 8);
    assert.strictEqual(updated.relationType, 'implements');
    assert.strictEqual(updated.from, 'EntityA');
    assert.strictEqual(updated.to, 'EntityB');
  });

  test('should delete relation', async () => {
    const created = await relationManager.create({
      from: 'EntityA',
      to: 'EntityB',
      relationType: 'depends_on'
    });

    const result = await relationManager.delete(created.id);
    assert.strictEqual(result, true);

    const found = await relationManager.findById(created.id);
    assert.strictEqual(found, undefined);
  });

  test('should delete relations by criteria', async () => {
    await relationManager.create({
      from: 'EntityA',
      to: 'EntityB',
      relationType: 'uses'
    });

    await relationManager.create({
      from: 'EntityA',
      to: 'EntityC',
      relationType: 'uses'
    });

    await relationManager.create({
      from: 'EntityB',
      to: 'EntityC',
      relationType: 'implements'
    });

    const deletedCount = await relationManager.deleteByCriteria({
      from: 'EntityA'
    });

    assert.strictEqual(deletedCount, 2);

    const remaining = await relationManager.getAll();
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].relationType, 'implements');
  });

  test('should get relation count', async () => {
    assert.strictEqual(await relationManager.count(), 0);

    await relationManager.create({
      from: 'EntityA',
      to: 'EntityB',
      relationType: 'uses'
    });

    await relationManager.create({
      from: 'EntityB',
      to: 'EntityC',
      relationType: 'implements'
    });

    assert.strictEqual(await relationManager.count(), 2);
  });

  test('should get relation types', async () => {
    await relationManager.create({
      from: 'EntityA',
      to: 'EntityB',
      relationType: 'solves'
    });

    await relationManager.create({
      from: 'EntityB',
      to: 'EntityC',
      relationType: 'uses'
    });

    await relationManager.create({
      from: 'EntityA',
      to: 'EntityC',
      relationType: 'solves'
    });

    const types = await relationManager.getRelationTypes();
    assert.deepStrictEqual(types.sort(), ['solves', 'uses']);
  });

  test('should get connected entities', async () => {
    // Create a small graph: A -> B -> C, A -> C
    await relationManager.create({
      from: 'EntityA',
      to: 'EntityB',
      relationType: 'uses'
    });

    await relationManager.create({
      from: 'EntityB',
      to: 'EntityC',
      relationType: 'implements'
    });

    await relationManager.create({
      from: 'EntityA',
      to: 'EntityC',
      relationType: 'depends_on'
    });

    const connected = await relationManager.getConnectedEntities('EntityA', 2);
    
    // Should find both direct and indirect connections
    const entityNames = connected.map(c => c.entity);
    assert.ok(entityNames.includes('EntityB'));
    assert.ok(entityNames.includes('EntityC'));
  });

  test('should find shortest path between entities', async () => {
    // Create path: A -> B -> C
    await relationManager.create({
      from: 'EntityA',
      to: 'EntityB',
      relationType: 'uses'
    });

    await relationManager.create({
      from: 'EntityB',
      to: 'EntityC',
      relationType: 'implements'
    });

    const path = await relationManager.findPath('EntityA', 'EntityC');
    assert.deepStrictEqual(path, ['EntityA', 'EntityB', 'EntityC']);

    // Test direct path
    await relationManager.create({
      from: 'EntityA',
      to: 'EntityC',
      relationType: 'direct'
    });

    const directPath = await relationManager.findPath('EntityA', 'EntityC');
    assert.deepStrictEqual(directPath, ['EntityA', 'EntityC']);

    // Test no path
    await entityManager.create({
      name: 'IsolatedEntity',
      entityType: 'Isolated'
    });

    const noPath = await relationManager.findPath('EntityA', 'IsolatedEntity');
    assert.strictEqual(noPath, null);
  });

  test('should get entity clusters', async () => {
    // Create two separate clusters
    await relationManager.create({
      from: 'EntityA',
      to: 'EntityB',
      relationType: 'related_to'
    });

    // Add isolated entity
    await entityManager.create({
      name: 'IsolatedEntity',
      entityType: 'Isolated'
    });

    const clusters = await relationManager.getClusters(2);
    
    // Should find one cluster with A and B
    assert.strictEqual(clusters.length, 1);
    assert.strictEqual(clusters[0].length, 2);
    assert.ok(clusters[0].includes('EntityA'));
    assert.ok(clusters[0].includes('EntityB'));
  });

  test('should update entity references', async () => {
    await relationManager.create({
      from: 'EntityA',
      to: 'EntityB',
      relationType: 'uses'
    });

    await relationManager.create({
      from: 'EntityB',
      to: 'EntityA',
      relationType: 'depends_on'
    });

    const updatedCount = await relationManager.updateEntityReferences('EntityA', 'RenamedEntityA');

    assert.strictEqual(updatedCount, 2);

    const relations = await relationManager.getAll();
    const hasOldName = relations.some(r => r.from === 'EntityA' || r.to === 'EntityA');
    const hasNewName = relations.some(r => r.from === 'RenamedEntityA' || r.to === 'RenamedEntityA');

    assert.strictEqual(hasOldName, false);
    assert.strictEqual(hasNewName, true);
  });

  test('should validate relation data', async () => {
    await assert.rejects(
      () => relationManager.create({
        // Missing from
        to: 'EntityB',
        relationType: 'uses'
      }),
      /Invalid relation data/
    );

    await assert.rejects(
      () => relationManager.create({
        from: 'EntityA',
        // Missing to
        relationType: 'uses'
      }),
      /Invalid relation data/
    );

    await assert.rejects(
      () => relationManager.create({
        from: 'EntityA',
        to: 'EntityB',
        // Missing relationType
      }),
      /Invalid relation data/
    );
  });
});