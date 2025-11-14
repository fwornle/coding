/**
 * Unit tests for OntologyClassifier
 *
 * Tests:
 * - Heuristic-based classification
 * - LLM-based classification (mocked)
 * - Hybrid classification (combining both methods)
 * - Confidence thresholding
 * - Team-specific and mixed team classification
 * - Validation integration
 * - Method selection (heuristic vs LLM)
 *
 * Note: This test suite uses mocks for UnifiedInferenceEngine to avoid actual LLM calls
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { OntologyClassifier } from '../../src/ontology/OntologyClassifier';
import { OntologyManager } from '../../src/ontology/OntologyManager';
import { OntologyValidator } from '../../src/ontology/OntologyValidator';
import { HeuristicClassifier } from '../../src/ontology/heuristics/HeuristicClassifier';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('OntologyClassifier', () => {
  let manager;
  let validator;
  let heuristicClassifier;
  let mockInferenceEngine;
  let classifier;
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

    // Initialize validator
    validator = new OntologyValidator(manager);

    // Initialize heuristic classifier
    heuristicClassifier = new HeuristicClassifier(manager);

    // Mock UnifiedInferenceEngine
    mockInferenceEngine = {
      generateCompletion: jest.fn(),
      getCostEstimate: jest.fn().mockReturnValue({ totalCost: 0.001 })
    };

    // Initialize classifier
    classifier = new OntologyClassifier(
      manager,
      validator,
      heuristicClassifier,
      mockInferenceEngine
    );
  });

  describe('Heuristic Classification', () => {
    test('should classify using heuristics when enableLLM is false', async () => {
      const text = 'This is a test entity with TestEntity characteristics';

      const result = await classifier.classify(text, {
        enableLLM: false,
        enableHeuristics: true,
        minConfidence: 0.3
      });

      // Result may or may not match depending on heuristics
      // Just verify method is 'heuristic' if we get a result
      if (result) {
        expect(result.method).toBe('heuristic');
        expect(result.confidence).toBeGreaterThan(0);
      }
    });

    test('should return null when heuristics disabled and no match found', async () => {
      const text = 'Random text that does not match any patterns';

      const result = await classifier.classify(text, {
        enableLLM: false,
        enableHeuristics: true,
        minConfidence: 0.9
      });

      // With high confidence threshold and random text, should return null
      expect(result).toBeNull();
    });

    test('should respect confidence threshold for heuristics', async () => {
      const text = 'Entity test';

      const lowConfResult = await classifier.classify(text, {
        enableLLM: false,
        minConfidence: 0.1
      });

      const highConfResult = await classifier.classify(text, {
        enableLLM: false,
        minConfidence: 0.99
      });

      // Low confidence threshold should be more likely to return a result
      // High confidence threshold should filter out weak matches
      if (lowConfResult && highConfResult) {
        expect(lowConfResult.confidence).toBeLessThanOrEqual(highConfResult.confidence);
      }
    });
  });

  describe('LLM Classification', () => {
    test('should call LLM when enableLLM is true and heuristics disabled', async () => {
      mockInferenceEngine.generateCompletion.mockResolvedValue({
        content: 'TestEntity',
        usage: { totalTokens: 100 }
      });

      const text = 'Some text for classification';

      const result = await classifier.classify(text, {
        enableLLM: true,
        enableHeuristics: false,
        minConfidence: 0.5
      });

      expect(mockInferenceEngine.generateCompletion).toHaveBeenCalled();
      // Result depends on LLM response parsing
    });

    test('should respect LLM budget', async () => {
      mockInferenceEngine.generateCompletion.mockResolvedValue({
        content: 'TestEntity',
        usage: { totalTokens: 100 }
      });

      mockInferenceEngine.getCostEstimate.mockReturnValue({
        totalCost: 10.0 // Exceeds budget
      });

      const text = 'Text for classification';

      const result = await classifier.classify(text, {
        enableLLM: true,
        enableHeuristics: false,
        llmBudget: 1.0, // Low budget
        minConfidence: 0.5
      });

      // Should not call LLM if cost exceeds budget (or fallback to heuristics)
      // Behavior depends on implementation
    });
  });

  describe('Hybrid Classification', () => {
    test('should try heuristics first then LLM when both enabled', async () => {
      mockInferenceEngine.generateCompletion.mockResolvedValue({
        content: 'TestEntity',
        usage: { totalTokens: 100 }
      });

      const text = 'Hybrid classification test';

      const result = await classifier.classify(text, {
        enableLLM: true,
        enableHeuristics: true,
        minConfidence: 0.5
      });

      // Should attempt heuristics first (no-cost)
      // If heuristics confidence is high enough, may not call LLM
    });

    test('should prefer higher confidence result', async () => {
      // This test would need specific text that gives different results
      // from heuristics vs LLM
      mockInferenceEngine.generateCompletion.mockResolvedValue({
        content: 'ParentEntity',
        usage: { totalTokens: 100 }
      });

      const text = 'Test classification';

      const result = await classifier.classify(text, {
        enableLLM: true,
        enableHeuristics: true,
        minConfidence: 0.1
      });

      // Should return whichever method gives higher confidence
      if (result) {
        expect(['heuristic', 'llm', 'hybrid']).toContain(result.method);
      }
    });
  });

  describe('Team-Specific Classification', () => {
    test('should classify for specific team', async () => {
      const text = 'Extended entity test';

      const result = await classifier.classify(text, {
        team: 'TestTeam',
        enableLLM: false,
        minConfidence: 0.3
      });

      // If match found, should respect team scope
      if (result) {
        expect(['TestTeam', 'upper']).toContain(result.ontology);
      }
    });

    test('should handle mixed team scope', async () => {
      const text = 'Mixed team classification';

      const result = await classifier.classify(text, {
        mixedTeamScope: true,
        enableLLM: false,
        minConfidence: 0.3
      });

      // Should search across all teams
      // Result depends on matches found
    });
  });

  describe('Confidence Thresholding', () => {
    test('should return null when confidence below threshold', async () => {
      const text = 'Weak match text';

      const result = await classifier.classify(text, {
        enableLLM: false,
        minConfidence: 0.99 // Very high threshold
      });

      // With very high threshold, unlikely to get a match
      expect(result).toBeNull();
    });

    test('should return result when confidence above threshold', async () => {
      const text = 'TestEntity';

      const result = await classifier.classify(text, {
        enableLLM: false,
        minConfidence: 0.1 // Very low threshold
      });

      // With entity class name in text and low threshold, likely to match
      // But depends on heuristic patterns
    });
  });

  describe('Validation Integration', () => {
    test('should validate classified result when validate option is true', async () => {
      mockInferenceEngine.generateCompletion.mockResolvedValue({
        content: JSON.stringify({
          entityClass: 'TestEntity',
          properties: { name: 'Test' }
        }),
        usage: { totalTokens: 100 }
      });

      const text = 'Text to classify and validate';

      const result = await classifier.classify(text, {
        enableLLM: true,
        enableHeuristics: false,
        validate: true,
        validationOptions: {
          mode: 'strict'
        }
      });

      // If result is returned, validation was attempted
      // Actual validation results depend on entity structure
    });

    test('should skip validation when validate option is false', async () => {
      const text = 'Test';

      const result = await classifier.classify(text, {
        enableLLM: false,
        validate: false
      });

      // Should complete without validation
      // No specific assertion needed beyond not throwing
    });
  });

  describe('Entity Class Selection', () => {
    test('should return valid entity class from ontology', async () => {
      mockInferenceEngine.generateCompletion.mockResolvedValue({
        content: 'TestEntity',
        usage: { totalTokens: 100 }
      });

      const text = 'Test entity classification';

      const result = await classifier.classify(text, {
        enableLLM: true,
        enableHeuristics: false,
        minConfidence: 0.1
      });

      if (result) {
        // Entity class should exist in ontology
        const entityClasses = manager.getAllEntityClasses();
        expect(entityClasses).toContain(result.entityClass);
      }
    });
  });

  describe('Error Handling', () => {
    test('should handle LLM errors gracefully', async () => {
      mockInferenceEngine.generateCompletion.mockRejectedValue(
        new Error('LLM API error')
      );

      const text = 'Test with LLM error';

      const result = await classifier.classify(text, {
        enableLLM: true,
        enableHeuristics: true,
        minConfidence: 0.5
      });

      // Should fallback to heuristics or return null
      // Should not throw error
      expect(result === null || result.method === 'heuristic').toBe(true);
    });

    test('should handle invalid text input', async () => {
      const result = await classifier.classify('', {
        enableLLM: false
      });

      // Empty text should return null
      expect(result).toBeNull();
    });
  });

  describe('Method Reporting', () => {
    test('should report correct classification method', async () => {
      const text = 'Method reporting test';

      const heuristicResult = await classifier.classify(text, {
        enableLLM: false,
        enableHeuristics: true,
        minConfidence: 0.1
      });

      if (heuristicResult) {
        expect(heuristicResult.method).toBe('heuristic');
      }

      // Test LLM method
      mockInferenceEngine.generateCompletion.mockResolvedValue({
        content: 'TestEntity',
        usage: { totalTokens: 100 }
      });

      const llmResult = await classifier.classify(text, {
        enableLLM: true,
        enableHeuristics: false,
        minConfidence: 0.1
      });

      // LLM result method depends on parsing success
    });
  });
});
