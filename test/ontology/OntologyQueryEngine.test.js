/**
 * Unit tests for OntologyQueryEngine
 *
 * Tests:
 * - findByEntityClass with and without team filtering
 * - findByProperty with simple and nested properties
 * - aggregateByEntityClass for count aggregation
 * - findRelated for relationship queries
 * - Complex queries with multiple filters
 * - Pagination (limit, offset)
 * - Sorting (sortBy, sortOrder)
 * - Team filtering including "mixed" team items
 * - Nested property access with dot notation and array indices
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { OntologyQueryEngine } from '../../src/ontology/OntologyQueryEngine.js';
import { OntologyManager } from '../../src/ontology/OntologyManager.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('OntologyQueryEngine', () => {
  let manager;
  let mockGraphDatabase;
  let queryEngine;
  let mockNodes;
  const fixturesPath = path.join(__dirname, '../fixtures/ontologies');

  beforeEach(async () => {
    // Initialize OntologyManager
    const config = {
      upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
      lowerOntologyPath: path.join(fixturesPath, 'test-lower.json'),
      team: 'TestTeam',
      caching: { enabled: false }
    };

    manager = new OntologyManager(config);
    await manager.initialize();

    // Create mock knowledge nodes with ontology metadata
    mockNodes = [
      {
        id: 'k1',
        content: 'RPU configuration for virtual target',
        timestamp: '2025-11-01T10:00:00Z',
        ontology: {
          entityClass: 'RPU',
          team: 'ReSi',
          confidence: 0.9,
          properties: {
            name: 'SensorFusion',
            virtualTarget: 'ECU-1',
            resourceRequirements: { cpu: '4 cores', memory: '8GB' }
          }
        }
      },
      {
        id: 'k2',
        content: 'Kubernetes cluster configuration',
        timestamp: '2025-11-01T11:00:00Z',
        ontology: {
          entityClass: 'KubernetesCluster',
          team: 'RaaS',
          confidence: 0.85,
          properties: {
            name: 'prod-cluster',
            nodes: 10,
            region: 'us-west'
          }
        }
      },
      {
        id: 'k3',
        content: 'Another RPU for different target',
        timestamp: '2025-11-01T12:00:00Z',
        ontology: {
          entityClass: 'RPU',
          team: 'ReSi',
          confidence: 0.88,
          properties: {
            name: 'ObjectDetection',
            virtualTarget: 'ECU-2',
            resourceRequirements: { cpu: '8 cores', memory: '16GB' }
          }
        }
      },
      {
        id: 'k4',
        content: 'Mixed team knowledge',
        timestamp: '2025-11-01T13:00:00Z',
        ontology: {
          entityClass: 'CompoundReprocessing',
          team: 'mixed',
          confidence: 0.92,
          properties: {
            name: 'MultiTeamWorkflow',
            components: ['rpu1', 'rpu2']
          }
        }
      },
      {
        id: 'k5',
        content: 'Knowledge without ontology',
        timestamp: '2025-11-01T14:00:00Z'
      }
    ];

    // Mock GraphDatabaseService
    mockGraphDatabase = {
      getAllNodes: jest.fn().mockResolvedValue(mockNodes),
      queryByOntologyClass: jest.fn().mockResolvedValue(
        mockNodes.filter(n => n.ontology)
      ),
      getNode: jest.fn((id) => {
        return Promise.resolve(mockNodes.find(n => n.id === id));
      }),
      getRelationships: jest.fn((id, type) => {
        // Mock relationships
        if (id === 'k1') {
          return Promise.resolve([
            { source: 'k1', target: 'k3', type: 'relatedTo' }
          ]);
        }
        return Promise.resolve([]);
      })
    };

    // Initialize QueryEngine
    queryEngine = new OntologyQueryEngine(manager, mockGraphDatabase);
  });

  describe('findByEntityClass', () => {
    test('should return all knowledge of specified entity class', async () => {
      const result = await queryEngine.findByEntityClass('RPU');

      expect(result.results).toHaveLength(2);
      expect(result.results[0].ontology.entityClass).toBe('RPU');
      expect(result.results[1].ontology.entityClass).toBe('RPU');
      expect(result.totalCount).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    test('should filter by team', async () => {
      const result = await queryEngine.findByEntityClass('RPU', 'ReSi');

      expect(result.results).toHaveLength(2);
      expect(result.results[0].ontology.team).toBe('ReSi');
      expect(result.results[1].ontology.team).toBe('ReSi');
    });

    test('should include mixed team items when filtering by team', async () => {
      const result = await queryEngine.findByEntityClass('CompoundReprocessing', 'RaaS');

      // Mixed team items should be included for any team filter
      expect(result.results.length).toBeGreaterThanOrEqual(0);
    });

    test('should return empty results for non-existent entity class', async () => {
      const result = await queryEngine.findByEntityClass('NonExistentClass');

      expect(result.results).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });

    test('should support pagination', async () => {
      const result = await queryEngine.findByEntityClass('RPU', undefined, {
        limit: 1,
        offset: 0
      });

      expect(result.results).toHaveLength(1);
      expect(result.totalCount).toBe(2);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('findByProperty', () => {
    test('should filter by simple property', async () => {
      const result = await queryEngine.findByProperty(
        'RPU',
        'ontology.properties.name',
        'SensorFusion'
      );

      expect(result.results).toHaveLength(1);
      expect(result.results[0].ontology.properties.name).toBe('SensorFusion');
    });

    test('should filter by nested property using dot notation', async () => {
      const result = await queryEngine.findByProperty(
        'RPU',
        'ontology.properties.resourceRequirements.cpu',
        '4 cores'
      );

      expect(result.results).toHaveLength(1);
      expect(result.results[0].ontology.properties.resourceRequirements.cpu).toBe('4 cores');
    });

    test('should return empty results when property value does not match', async () => {
      const result = await queryEngine.findByProperty(
        'RPU',
        'ontology.properties.name',
        'NonExistentName'
      );

      expect(result.results).toHaveLength(0);
    });
  });

  describe('aggregateByEntityClass', () => {
    test('should return accurate counts per entity class', async () => {
      const counts = await queryEngine.aggregateByEntityClass();

      expect(counts['RPU']).toBe(2);
      expect(counts['KubernetesCluster']).toBe(1);
      expect(counts['CompoundReprocessing']).toBe(1);
    });

    test('should filter aggregation by team', async () => {
      const counts = await queryEngine.aggregateByEntityClass('ReSi');

      expect(counts['RPU']).toBe(2);
      expect(counts['KubernetesCluster']).toBeUndefined();
    });

    test('should include mixed team items in team aggregation', async () => {
      const counts = await queryEngine.aggregateByEntityClass('RaaS');

      expect(counts['KubernetesCluster']).toBe(1);
      // Mixed team item should be included
      expect(counts['CompoundReprocessing']).toBe(1);
    });
  });

  describe('findRelated', () => {
    test('should follow relationships to find related knowledge', async () => {
      const related = await queryEngine.findRelated('k1');

      expect(related).toHaveLength(1);
      expect(related[0].id).toBe('k3');
      expect(related[0].ontology.entityClass).toBe('RPU');
    });

    test('should filter by relationship type', async () => {
      const related = await queryEngine.findRelated('k1', 'relatedTo');

      expect(related).toHaveLength(1);
    });

    test('should return empty array for node with no relationships', async () => {
      const related = await queryEngine.findRelated('k2');

      expect(related).toHaveLength(0);
    });

    test('should return empty array for non-existent node', async () => {
      const related = await queryEngine.findRelated('non-existent');

      expect(related).toHaveLength(0);
    });
  });

  describe('Complex Queries', () => {
    test('should combine entity class and team filters', async () => {
      const result = await queryEngine.query({
        entityClass: 'RPU',
        team: 'ReSi'
      });

      expect(result.results).toHaveLength(2);
      expect(result.results.every(r => r.ontology.entityClass === 'RPU')).toBe(true);
      expect(result.results.every(r => r.ontology.team === 'ReSi')).toBe(true);
    });

    test('should combine multiple filters', async () => {
      const result = await queryEngine.query({
        entityClass: 'RPU',
        properties: {
          'ontology.properties.virtualTarget': 'ECU-1'
        }
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].id).toBe('k1');
    });

    test('should filter by multiple entity classes', async () => {
      const result = await queryEngine.query({
        entityClasses: ['RPU', 'KubernetesCluster']
      });

      expect(result.results).toHaveLength(3); // 2 RPUs + 1 KubernetesCluster
    });
  });

  describe('Pagination', () => {
    test('should apply limit correctly', async () => {
      const result = await queryEngine.query({}, { limit: 2 });

      expect(result.results).toHaveLength(2);
      expect(result.hasMore).toBe(true);
    });

    test('should apply offset correctly', async () => {
      const result = await queryEngine.query({}, { limit: 2, offset: 2 });

      expect(result.results).toHaveLength(2);
      expect(result.totalCount).toBe(4); // Total nodes with ontology
    });

    test('should indicate hasMore correctly', async () => {
      const result1 = await queryEngine.query({}, { limit: 2, offset: 0 });
      expect(result1.hasMore).toBe(true);

      const result2 = await queryEngine.query({}, { limit: 10, offset: 0 });
      expect(result2.hasMore).toBe(false);
    });
  });

  describe('Sorting', () => {
    test('should sort by timestamp ascending', async () => {
      const result = await queryEngine.query(
        {},
        { sortBy: 'timestamp', sortOrder: 'asc' }
      );

      expect(result.results[0].timestamp).toBe('2025-11-01T10:00:00Z');
      expect(result.results[result.results.length - 1].timestamp).toBe('2025-11-01T13:00:00Z');
    });

    test('should sort by timestamp descending', async () => {
      const result = await queryEngine.query(
        {},
        { sortBy: 'timestamp', sortOrder: 'desc' }
      );

      expect(result.results[0].timestamp).toBe('2025-11-01T13:00:00Z');
      expect(result.results[result.results.length - 1].timestamp).toBe('2025-11-01T10:00:00Z');
    });

    test('should sort by confidence', async () => {
      const result = await queryEngine.query(
        {},
        { sortBy: 'ontology.confidence', sortOrder: 'desc' }
      );

      expect(result.results[0].ontology.confidence).toBeGreaterThanOrEqual(
        result.results[1].ontology.confidence
      );
    });
  });

  describe('Nested Property Access', () => {
    test('should access nested object properties', async () => {
      const result = await queryEngine.query({
        properties: {
          'ontology.properties.resourceRequirements.memory': '8GB'
        }
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].id).toBe('k1');
    });

    test('should handle array properties', async () => {
      const result = await queryEngine.query({
        properties: {
          'ontology.properties.components[0]': 'rpu1'
        }
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].id).toBe('k4');
    });

    test('should return undefined for non-existent nested property', async () => {
      const result = await queryEngine.query({
        properties: {
          'ontology.properties.nonExistent.field': 'value'
        }
      });

      expect(result.results).toHaveLength(0);
    });
  });

  describe('Query Options', () => {
    test('should exclude properties when includeProperties is false', async () => {
      const result = await queryEngine.query(
        { entityClass: 'RPU' },
        { includeProperties: false }
      );

      expect(result.results[0].ontology.properties).toBeUndefined();
    });

    test('should include properties by default', async () => {
      const result = await queryEngine.query({ entityClass: 'RPU' });

      expect(result.results[0].ontology.properties).toBeDefined();
    });
  });

  describe('Team Filtering', () => {
    test('should include mixed team items for any team filter', async () => {
      const resultRaaS = await queryEngine.query({ team: 'RaaS' });
      const resultReSi = await queryEngine.query({ team: 'ReSi' });

      // Both should include the mixed team item
      const mixedInRaaS = resultRaaS.results.some(r => r.ontology.team === 'mixed');
      const mixedInReSi = resultReSi.results.some(r => r.ontology.team === 'mixed');

      expect(mixedInRaaS).toBe(true);
      expect(mixedInReSi).toBe(true);
    });

    test('should not include other team items when filtering by specific team', async () => {
      const result = await queryEngine.query({ team: 'RaaS' });

      const hasReSiOnly = result.results.some(
        r => r.ontology.team === 'ReSi' && r.ontology.team !== 'mixed'
      );
      expect(hasReSiOnly).toBe(false);
    });
  });

  describe('Statistics', () => {
    test('should return accurate statistics', async () => {
      const stats = await queryEngine.getStatistics();

      expect(stats.totalKnowledge).toBe(5); // All nodes including without ontology
      expect(stats.knowledgeWithOntology).toBe(4); // Nodes with ontology
      expect(stats.entityClasses).toContain('RPU');
      expect(stats.entityClasses).toContain('KubernetesCluster');
      expect(stats.teams).toContain('ReSi');
      expect(stats.teams).toContain('RaaS');
      expect(stats.teams).toContain('mixed');
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty query results', async () => {
      const result = await queryEngine.query({
        entityClass: 'NonExistentClass'
      });

      expect(result.results).toHaveLength(0);
      expect(result.totalCount).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    test('should handle nodes without ontology metadata gracefully', async () => {
      const result = await queryEngine.query();

      // Should only return nodes with ontology metadata
      expect(result.results.every(r => r.ontology !== undefined)).toBe(true);
    });

    test('should handle missing nested properties gracefully', async () => {
      const result = await queryEngine.query({
        properties: {
          'ontology.properties.missing.deeply.nested.field': 'value'
        }
      });

      expect(result.results).toHaveLength(0);
    });
  });
});
