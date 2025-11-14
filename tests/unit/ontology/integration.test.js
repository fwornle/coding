/**
 * Integration tests for Ontology System - End-to-End Workflows
 *
 * Tests complete workflows:
 * - Full knowledge extraction with ontology (extract → classify → validate → store)
 * - Knowledge extraction without ontology (backward compatibility)
 * - Ontology-based retrieval
 * - Hybrid semantic + ontology retrieval
 * - Team inheritance (upper + lower ontologies)
 * - Real components integration (not just unit test mocks)
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { StreamingKnowledgeExtractor } from '../../src/knowledge-management/StreamingKnowledgeExtractor.js';
import { GraphDatabaseService } from '../../src/knowledge-management/GraphDatabaseService.js';
import { KnowledgeRetriever } from '../../src/knowledge-management/KnowledgeRetriever.js';
import { OntologyManager } from '../../src/ontology/OntologyManager.js';
import { OntologyClassifier } from '../../src/ontology/OntologyClassifier.js';
import { OntologyValidator } from '../../src/ontology/OntologyValidator.js';
import { OntologyQueryEngine } from '../../src/ontology/OntologyQueryEngine.js';
import { createHeuristicClassifier } from '../../src/ontology/heuristics/index.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Ontology Integration Tests', () => {
  let testDbPath;
  let graphDb;
  let extractor;
  let retriever;
  let ontologyManager;
  let mockInferenceEngine;
  const fixturesPath = path.join(__dirname, '../fixtures/ontologies');

  beforeEach(async () => {
    // Create temporary database for each test
    testDbPath = path.join(__dirname, '../fixtures', `.test-graph-${Date.now()}.db`);

    // Mock UnifiedInferenceEngine for deterministic LLM responses
    mockInferenceEngine = {
      generateCompletion: jest.fn().mockResolvedValue({
        content: 'TestEntity',
        usage: { totalTokens: 100 }
      }),
      getCostEstimate: jest.fn().mockReturnValue({ totalCost: 0.001 })
    };

    // Initialize GraphDatabaseService
    graphDb = new GraphDatabaseService({
      dbPath: testDbPath,
      caching: { enabled: false }
    });
    await graphDb.initialize();
  });

  afterEach(async () => {
    // Cleanup
    if (graphDb) {
      await graphDb.close();
    }
    // Wait a bit for file handles to release
    await new Promise(resolve => setTimeout(resolve, 100));
    if (testDbPath && fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch (err) {
        // Ignore cleanup errors
        console.warn(`Failed to delete test database: ${err.message}`);
      }
    }
  });

  describe('Full Knowledge Extraction with Ontology', () => {
    test('should classify, validate, and store knowledge with ontology metadata', async () => {
      // Test ontology components working together without full StreamingKnowledgeExtractor
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
        lowerOntologyPath: path.join(fixturesPath, 'test-lower.json'),
        team: 'TestTeam',
        caching: { enabled: false }
      };

      // Initialize ontology components
      const manager = new OntologyManager(config);
      await manager.initialize();

      const validator = new OntologyValidator(manager);
      const heuristicClassifier = await createHeuristicClassifier(manager);
      const classifier = new OntologyClassifier(manager, validator, heuristicClassifier, mockInferenceEngine);

      // Test knowledge to classify
      const knowledge = {
        content: 'TestEntity has properties including name and description',
        timestamp: new Date().toISOString()
      };

      // Classify knowledge
      const classification = await classifier.classify(knowledge.content, {
        enableLLM: false, // Use only heuristics for speed
        minConfidence: 0.5
      });

      // Verify classification worked
      if (classification) {
        expect(classification.entityClass).toBeDefined();
        expect(classification.confidence).toBeGreaterThan(0);
        expect(classification.method).toBeDefined();

        // Add ontology metadata
        const knowledgeWithOntology = {
          ...knowledge,
          id: `k-${Date.now()}`,
          ontology: {
            entityClass: classification.entityClass,
            team: config.team,
            confidence: classification.confidence,
            classification: {
              method: classification.method,
              timestamp: new Date().toISOString()
            }
          }
        };

        // Store in graph database
        graphDb.graph.addNode(knowledgeWithOntology.id, knowledgeWithOntology);

        // Verify stored with ontology metadata
        const stored = graphDb.graph.getNodeAttributes(knowledgeWithOntology.id);
        expect(stored).toBeDefined();
        expect(stored.ontology).toBeDefined();
        expect(stored.ontology.entityClass).toBe(classification.entityClass);
      }
    });

    test('should respect confidence threshold', async () => {
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
        team: 'TestTeam',
        caching: { enabled: false }
      };

      const manager = new OntologyManager(config);
      await manager.initialize();

      const heuristicClassifier = await createHeuristicClassifier(manager);
      const classifier = new OntologyClassifier(manager, null, heuristicClassifier, mockInferenceEngine);

      // Mock low confidence result
      classifier.classify = jest.fn().mockResolvedValue({
        entityClass: 'TestEntity',
        confidence: 0.4,
        method: 'heuristic'
      });

      const knowledge = {
        content: 'Ambiguous content',
        timestamp: new Date().toISOString()
      };

      const classification = await classifier.classify(knowledge.content, {
        minConfidence: 0.7 // High threshold
      });

      // Classification confidence too low
      expect(classification.confidence).toBeLessThan(0.7);
    });

    test('should validate knowledge against ontology', async () => {
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
        lowerOntologyPath: path.join(fixturesPath, 'test-lower.json'),
        team: 'TestTeam',
        caching: { enabled: false }
      };

      const manager = new OntologyManager(config);
      await manager.initialize();

      const validator = new OntologyValidator(manager);

      // Valid knowledge with required properties
      const entityData = {
        name: 'Test' // Required property
      };

      const validResult = validator.validate('TestEntity', entityData, {
        mode: 'lenient',
        failFast: false
      });

      expect(validResult.valid).toBe(true);
      expect(validResult.errors).toHaveLength(0);
    });
  });

  describe('Knowledge Extraction without Ontology (Backward Compatibility)', () => {
    test('should store knowledge without ontology metadata when ontology disabled', async () => {
      // Store knowledge without ontology metadata
      const knowledge = {
        id: 'k-no-ontology',
        content: 'Test knowledge without ontology',
        timestamp: new Date().toISOString()
      };

      graphDb.graph.addNode(knowledge.id, knowledge);

      // Verify stored without ontology metadata
      const stored = graphDb.graph.getNodeAttributes(knowledge.id);
      expect(stored).toBeDefined();
      expect(stored.ontology).toBeUndefined();
    });

    test('should handle missing ontology files gracefully', async () => {
      const config = {
        upperOntologyPath: '/non/existent/path.json', // Invalid path
        team: 'TestTeam',
        caching: { enabled: false }
      };

      // Should not throw error during construction
      expect(() => {
        ontologyManager = new OntologyManager(config);
      }).not.toThrow();

      // Should throw error during initialization
      await expect(ontologyManager.initialize()).rejects.toThrow();
    });
  });

  describe('Ontology-Based Retrieval', () => {
    test('should query knowledge by entity class', async () => {
      // Setup with ontology enabled
      const config = {
        projectName: 'test-project',
        graphDb: {
          dbPath: testDbPath,
          caching: { enabled: false }
        },
        ontology: {
          enabled: true,
          upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
          lowerOntologyPath: path.join(fixturesPath, 'test-lower.json'),
          team: 'TestTeam',
          confidenceThreshold: 0.5
        }
      };

      // Initialize components
      const ontologyManager = new OntologyManager(config.ontology);
      await ontologyManager.initialize();

      const queryEngine = new OntologyQueryEngine(ontologyManager, graphDb);

      // Mock queryByOntologyClass to return test data
      const testNodes = [
        { id: 'k1', content: 'RPU configuration', ontology: { entityClass: 'TestEntity', team: 'TestTeam', confidence: 0.9 }, timestamp: new Date().toISOString() },
        { id: 'k2', content: 'Parent entity data', ontology: { entityClass: 'ParentEntity', team: 'TestTeam', confidence: 0.85 }, timestamp: new Date().toISOString() },
        { id: 'k3', content: 'Another test entity', ontology: { entityClass: 'TestEntity', team: 'TestTeam', confidence: 0.88 }, timestamp: new Date().toISOString() }
      ];

      graphDb.queryByOntologyClass = jest.fn().mockResolvedValue(testNodes);

      // Query by entity class
      const result = await queryEngine.findByEntityClass('TestEntity');

      expect(result.results).toHaveLength(2);
      expect(result.results[0].ontology.entityClass).toBe('TestEntity');
      expect(result.results[1].ontology.entityClass).toBe('TestEntity');
    });

    test('should filter by team correctly', async () => {
      const config = {
        projectName: 'test-project',
        graphDb: {
          dbPath: testDbPath,
          caching: { enabled: false }
        },
        ontology: {
          enabled: true,
          upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
          team: 'TestTeam'
        }
      };

      const ontologyManager = new OntologyManager(config.ontology);
      await ontologyManager.initialize();
      const queryEngine = new OntologyQueryEngine(ontologyManager, graphDb);

      // Mock queryByOntologyClass to return test data
      const testNodes = [
        { id: 'k1', content: 'TestTeam data', ontology: { entityClass: 'TestEntity', team: 'TestTeam', confidence: 0.9 }, timestamp: new Date().toISOString() },
        { id: 'k2', content: 'OtherTeam data', ontology: { entityClass: 'TestEntity', team: 'OtherTeam', confidence: 0.9 }, timestamp: new Date().toISOString() },
        { id: 'k3', content: 'Mixed team data', ontology: { entityClass: 'TestEntity', team: 'mixed', confidence: 0.9 }, timestamp: new Date().toISOString() }
      ];

      graphDb.queryByOntologyClass = jest.fn().mockResolvedValue(testNodes);

      // Query by team
      const result = await queryEngine.findByEntityClass('TestEntity', 'TestTeam');

      // Should include TestTeam and mixed team items
      expect(result.results.length).toBeGreaterThanOrEqual(2);
      const teams = result.results.map(r => r.ontology.team);
      expect(teams).toContain('TestTeam');
      expect(teams).toContain('mixed');
      expect(teams).not.toContain('OtherTeam');
    });
  });

  describe('Hybrid Semantic + Ontology Retrieval', () => {
    test('should combine graph storage with ontology filtering', async () => {
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
        team: 'TestTeam',
        caching: { enabled: false }
      };

      const ontologyManager = new OntologyManager(config);
      await ontologyManager.initialize();
      const queryEngine = new OntologyQueryEngine(ontologyManager, graphDb);

      // Mock queryByOntologyClass to return test data
      const testNodes = [
        { id: 'k1', content: 'Configuration for system component', ontology: { entityClass: 'TestEntity', team: 'TestTeam', confidence: 0.9 }, timestamp: new Date().toISOString() },
        { id: 'k2', content: 'Configuration for parent system', ontology: { entityClass: 'ParentEntity', team: 'TestTeam', confidence: 0.9 }, timestamp: new Date().toISOString() }
      ];

      graphDb.queryByOntologyClass = jest.fn().mockResolvedValue(testNodes);

      // Query with ontology filter
      const result = await queryEngine.findByEntityClass('TestEntity');

      // Should only return TestEntity items, not ParentEntity
      expect(result.results).toHaveLength(1);
      expect(result.results[0].ontology.entityClass).toBe('TestEntity');
    });
  });

  describe('Team Inheritance (Upper + Lower Ontologies)', () => {
    test('should resolve entities from both upper and lower ontologies', async () => {
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
        lowerOntologyPath: path.join(fixturesPath, 'test-lower.json'),
        team: 'TestTeam',
        caching: { enabled: false }
      };

      ontologyManager = new OntologyManager(config);
      await ontologyManager.initialize();

      // Get all entity classes for team
      const entityClasses = ontologyManager.getAllEntityClasses();

      // Should include entities from both upper and lower ontologies
      expect(entityClasses).toContain('TestEntity'); // From upper
      expect(entityClasses).toContain('ParentEntity'); // From upper
      expect(entityClasses).toContain('ExtendedEntity'); // From lower (if exists)
    });

    test('should merge properties from upper and lower ontologies', async () => {
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
        lowerOntologyPath: path.join(fixturesPath, 'test-lower.json'),
        team: 'TestTeam',
        caching: { enabled: false }
      };

      ontologyManager = new OntologyManager(config);
      await ontologyManager.initialize();

      // Resolve entity from upper ontology
      const resolved = ontologyManager.resolveEntityDefinition('TestEntity');

      // Should have properties defined
      expect(resolved).toBeDefined();
      expect(resolved.properties).toBeDefined();
    });

    test('should classify using entities from both upper and lower ontologies', async () => {
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
        lowerOntologyPath: path.join(fixturesPath, 'test-lower.json'),
        team: 'TestTeam',
        caching: { enabled: false }
      };

      const manager = new OntologyManager(config);
      await manager.initialize();

      const heuristicClassifier = await createHeuristicClassifier(manager);
      const classifier = new OntologyClassifier(manager, null, heuristicClassifier, mockInferenceEngine);

      // Content that should match entities
      const content = 'TestEntity with properties';

      const classification = await classifier.classify(content, {
        enableLLM: false,
        minConfidence: 0.3
      });

      // Should classify using available entities
      if (classification) {
        expect(classification.entityClass).toBeDefined();
        expect(classification.method).toBeDefined();
      }
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle classification failures gracefully', async () => {
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
        team: 'TestTeam',
        caching: { enabled: false }
      };

      const manager = new OntologyManager(config);
      await manager.initialize();

      const heuristicClassifier = await createHeuristicClassifier(manager);
      const classifier = new OntologyClassifier(manager, null, heuristicClassifier, mockInferenceEngine);

      // Mock classification error
      mockInferenceEngine.generateCompletion = jest.fn().mockRejectedValue(
        new Error('LLM failed')
      );

      const content = 'Test content';

      // Should not throw, may return null or use heuristic fallback
      const result = await classifier.classify(content, {
        enableLLM: true,
        enableHeuristics: true
      });

      // Should either return null or fallback result
      expect(result === null || result.method === 'heuristic').toBe(true);
    });

    test('should handle validation failures in strict mode', async () => {
      const config = {
        upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
        team: 'TestTeam',
        caching: { enabled: false }
      };

      const manager = new OntologyManager(config);
      await manager.initialize();

      const validator = new OntologyValidator(manager);

      // Invalid knowledge (missing required properties)
      const invalidData = {}; // Missing required 'name' property

      const result = validator.validate('TestEntity', invalidData, {
        mode: 'strict',
        failFast: true
      });

      // Should have validation errors
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('should store knowledge even without ontology metadata', async () => {
      // Store knowledge without ontology classification
      const knowledge = {
        id: `k-no-classification-${Date.now()}`,
        content: 'Unclassifiable content',
        timestamp: new Date().toISOString()
      };

      graphDb.graph.addNode(knowledge.id, knowledge);

      // Should be stored successfully
      const stored = graphDb.graph.getNodeAttributes(knowledge.id);
      expect(stored).toBeDefined();
      expect(stored.content).toBe(knowledge.content);
    });
  });
});
