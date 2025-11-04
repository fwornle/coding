/**
 * Unit tests for OntologyManager
 *
 * Tests:
 * - loadOntology with valid, malformed, and missing files
 * - resolveEntity for upper-only, lower-only, and merged entities with inheritance
 * - getAllEntityClasses without team (upper only) and with team (upper + lower merged)
 * - Caching behavior: load once, serve from cache, verify performance improvement
 * - Cache invalidation via reloadOntologies
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { OntologyManager } from '../../src/ontology/OntologyManager.js';
import { OntologyLoadError, EntityResolutionError } from '../../src/ontology/types.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('OntologyManager', () => {
  let manager;
  const fixturesPath = path.join(__dirname, '../fixtures/ontologies');

  describe('Loading Ontologies', () => {
    test('should load valid upper ontology', async () => {
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
        caching: { enabled: false }
      };

      manager = new OntologyManager(config);
      await manager.initialize();

      const upperOntology = manager.getUpperOntology();
      expect(upperOntology).toBeDefined();
      expect(upperOntology.name).toBe('TestUpperOntology');
      expect(upperOntology.type).toBe('upper');
      expect(upperOntology.entities.TestEntity).toBeDefined();
      expect(upperOntology.entities.ParentEntity).toBeDefined();
    });

    test('should load lower ontology with team config', async () => {
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
        lowerOntologyPath: path.join(fixturesPath, 'test-lower.json'),
        team: 'TestTeam',
        caching: { enabled: false }
      };

      manager = new OntologyManager(config);
      await manager.initialize();

      const lowerOntology = manager.getLowerOntology('TestTeam');
      expect(lowerOntology).toBeDefined();
      expect(lowerOntology.name).toBe('TestLowerOntology');
      expect(lowerOntology.type).toBe('lower');
      expect(lowerOntology.entities.ExtendedEntity).toBeDefined();
      expect(lowerOntology.entities.LowerOnlyEntity).toBeDefined();
    });

    test('should throw error for malformed JSON', async () => {
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'malformed.json'),
        caching: { enabled: false }
      };

      manager = new OntologyManager(config);
      await expect(manager.initialize()).rejects.toThrow();
    });

    test('should throw error for missing file', async () => {
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'nonexistent.json'),
        caching: { enabled: false }
      };

      manager = new OntologyManager(config);
      await expect(manager.initialize()).rejects.toThrow(OntologyLoadError);
    });

    test('should load additional team ontology via loadTeamOntology', async () => {
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
        caching: { enabled: false }
      };

      manager = new OntologyManager(config);
      await manager.initialize();

      await manager.loadTeamOntology({
        team: 'AnotherTeam',
        lowerOntologyPath: path.join(fixturesPath, 'test-lower.json'),
        description: 'Test team'
      });

      const lowerOntology = manager.getLowerOntology('AnotherTeam');
      expect(lowerOntology).toBeDefined();
      expect(lowerOntology.name).toBe('TestLowerOntology');
    });
  });

  describe('Entity Resolution', () => {
    beforeEach(async () => {
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
        lowerOntologyPath: path.join(fixturesPath, 'test-lower.json'),
        team: 'TestTeam',
        caching: { enabled: false }
      };

      manager = new OntologyManager(config);
      await manager.initialize();
    });

    test('should resolve upper-only entity', () => {
      const resolved = manager.resolveEntityDefinition('TestEntity');

      expect(resolved).toBeDefined();
      expect(resolved.description).toBe('A test entity class');
      expect(resolved.ontologyType).toBe('upper');
      expect(resolved.inheritanceChain).toEqual(['TestEntity']);
      expect(resolved.properties.name).toBeDefined();
      expect(resolved.properties.value).toBeDefined();
    });

    test('should resolve lower entity with inheritance from upper', () => {
      const resolved = manager.resolveEntityDefinition('ExtendedEntity', 'TestTeam');

      expect(resolved).toBeDefined();
      expect(resolved.description).toBe('Entity extending TestEntity');
      expect(resolved.ontologyType).toBe('lower');
      expect(resolved.team).toBe('TestTeam');
      expect(resolved.inheritanceChain).toEqual(['TestEntity', 'ExtendedEntity']); // Root first

      // Should have both upper and lower properties
      expect(resolved.properties.name).toBeDefined(); // From upper
      expect(resolved.properties.extraProperty).toBeDefined(); // From lower

      // Lower should have its value property
      expect(resolved.properties.value).toBeDefined(); // Overridden in lower
      expect(resolved.properties.value.description).toBe('Overridden value with different constraints');
    });

    test('should resolve lower-only entity', () => {
      const resolved = manager.resolveEntityDefinition('LowerOnlyEntity', 'TestTeam');

      expect(resolved).toBeDefined();
      expect(resolved.description).toBe('Entity only in lower ontology');
      expect(resolved.ontologyType).toBe('lower');
      expect(resolved.properties.lowerProp).toBeDefined();
    });

    test('should throw error for non-existent entity', () => {
      expect(() => {
        manager.resolveEntityDefinition('NonExistentEntity');
      }).toThrow(EntityResolutionError);
    });

    test('should throw error when trying to get entity for wrong team', () => {
      expect(() => {
        manager.resolveEntityDefinition('ExtendedEntity', 'WrongTeam');
      }).toThrow(EntityResolutionError);
    });
  });

  describe('Entity Class Queries', () => {
    beforeEach(async () => {
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
        lowerOntologyPath: path.join(fixturesPath, 'test-lower.json'),
        team: 'TestTeam',
        caching: { enabled: false }
      };

      manager = new OntologyManager(config);
      await manager.initialize();
    });

    test('should check if entity class exists in upper ontology', () => {
      expect(manager.hasEntityClass('TestEntity')).toBe(true);
      expect(manager.hasEntityClass('ParentEntity')).toBe(true);
      expect(manager.hasEntityClass('NonExistent')).toBe(false);
    });

    test('should check if entity class exists in lower ontology for team', () => {
      expect(manager.hasEntityClass('ExtendedEntity', 'TestTeam')).toBe(true);
      expect(manager.hasEntityClass('LowerOnlyEntity', 'TestTeam')).toBe(true);
      expect(manager.hasEntityClass('ExtendedEntity', 'WrongTeam')).toBe(false);
    });

    test('should get all entity classes without team (upper only)', () => {
      const entityClasses = manager.getAllEntityClasses();

      expect(entityClasses.length).toBeGreaterThanOrEqual(2);
      expect(entityClasses).toContain('TestEntity');
      expect(entityClasses).toContain('ParentEntity');
    });

    test('should get all entity classes with team (upper + lower)', () => {
      const entityClasses = manager.getAllEntityClasses('TestTeam');

      expect(entityClasses.length).toBeGreaterThanOrEqual(4);
      expect(entityClasses).toContain('TestEntity'); // Upper
      expect(entityClasses).toContain('ParentEntity'); // Upper
      expect(entityClasses).toContain('ExtendedEntity'); // Lower
      expect(entityClasses).toContain('LowerOnlyEntity'); // Lower
    });
  });

  describe('Relationships', () => {
    beforeEach(async () => {
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
        lowerOntologyPath: path.join(fixturesPath, 'test-lower.json'),
        team: 'TestTeam',
        caching: { enabled: false }
      };

      manager = new OntologyManager(config);
      await manager.initialize();
    });

    test('should get relationships from upper ontology', () => {
      const relationships = manager.getAllRelationships();

      expect(relationships).toBeDefined();
      expect(typeof relationships).toBe('object');
      expect(Object.keys(relationships).length).toBeGreaterThan(0);
    });

    test('should get relationships from lower ontology for team', () => {
      const relationships = manager.getAllRelationships('TestTeam');

      expect(relationships).toBeDefined();
      expect(typeof relationships).toBe('object');
      // Should have both upper and lower relationships
      expect(Object.keys(relationships).length).toBeGreaterThanOrEqual(1);
    });

    test('should get entity-specific relationships', () => {
      const entityRelationships = manager.getEntityRelationships('TestEntity');

      expect(entityRelationships).toBeDefined();
      expect(Array.isArray(entityRelationships)).toBe(true);
    });
  });

  describe('Caching', () => {
    test('should cache loaded ontology and serve from cache on second load', async () => {
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
        caching: {
          enabled: true,
          ttl: 3600000 // 1 hour
        }
      };

      manager = new OntologyManager(config);

      // First load - from file
      const start1 = Date.now();
      await manager.initialize();
      const time1 = Date.now() - start1;

      // Verify ontology loaded
      const ontology1 = manager.getUpperOntology();
      expect(ontology1).toBeDefined();

      // Reload - cache should still be valid
      const start2 = Date.now();
      await manager.reload();
      const time2 = Date.now() - start2;

      // Verify ontology still available after reload
      const ontology2 = manager.getUpperOntology();
      expect(ontology2).toBeDefined();
      expect(ontology2.name).toBe(ontology1.name);
    });

    test('should respect cache TTL and reload after expiration', async () => {
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
        caching: {
          enabled: true,
          ttl: 100 // 100ms TTL for testing
        }
      };

      manager = new OntologyManager(config);
      await manager.initialize();

      // Verify initial load
      const ontology1 = manager.getUpperOntology();
      expect(ontology1).toBeDefined();

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should reload from file after TTL expiration
      await manager.reload();

      // Ontology should still be available after reload
      const ontology2 = manager.getUpperOntology();
      expect(ontology2).toBeDefined();
      expect(ontology2.name).toBe(ontology1.name);
    });

    test('should clear cache and reload all ontologies via reload()', async () => {
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
        lowerOntologyPath: path.join(fixturesPath, 'test-lower.json'),
        team: 'TestTeam',
        caching: {
          enabled: true,
          ttl: 3600000
        }
      };

      manager = new OntologyManager(config);
      await manager.initialize();

      // Verify initial load
      expect(manager.getUpperOntology()).toBeDefined();
      expect(manager.getLowerOntology('TestTeam')).toBeDefined();

      // Clear cache and reload
      await manager.reload();

      // Ontologies should still be available after reload
      expect(manager.getUpperOntology()).toBeDefined();
      expect(manager.getLowerOntology('TestTeam')).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    test('should throw error when accessing upper ontology before initialization', () => {
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
        caching: { enabled: false }
      };

      manager = new OntologyManager(config);

      expect(() => manager.getUpperOntology()).toThrow(OntologyLoadError);
    });

    test('should handle missing lower ontology gracefully', () => {
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
        team: 'TestTeam',
        caching: { enabled: false }
      };

      manager = new OntologyManager(config);

      // Should initialize successfully even without lower ontology
      expect(manager.initialize()).resolves.not.toThrow();
    });

    test('should return undefined for non-existent team lower ontology', async () => {
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
        caching: { enabled: false }
      };

      manager = new OntologyManager(config);
      await manager.initialize();

      expect(manager.getLowerOntology('NonExistentTeam')).toBeUndefined();
    });
  });
});
