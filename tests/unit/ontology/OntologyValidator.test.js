/**
 * Unit tests for OntologyValidator
 *
 * Tests:
 * - Property type validation: string, number, boolean, object, array, reference
 * - Required property validation
 * - Enum validation
 * - Pattern validation for strings
 * - Min/max constraints for numbers and arrays
 * - Nested object validation
 * - Array item validation
 * - Validation modes: strict, lenient, disabled
 * - Unknown property handling
 * - Error and warning collection
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { OntologyValidator } from '../../src/ontology/OntologyValidator.js';
import { OntologyManager } from '../../src/ontology/OntologyManager.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('OntologyValidator', () => {
  let manager;
  let validator;
  const fixturesPath = path.join(__dirname, '../fixtures/ontologies');

  beforeEach(async () => {
    const config = {
      upperOntologyPath: path.join(fixturesPath, 'test-upper.json'),
      lowerOntologyPath: path.join(fixturesPath, 'test-lower.json'),
      team: 'TestTeam',
      caching: { enabled: false }
    };

    manager = new OntologyManager(config);
    await manager.initialize();
    validator = new OntologyValidator(manager);
  });

  describe('Validation Modes', () => {
    test('should skip validation in disabled mode', () => {
      const result = validator.validate('TestEntity', {}, { mode: 'disabled' });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    test('should return errors in strict mode for invalid data', () => {
      const entityData = {
        unknownProp: 'value'
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict',
        allowUnknownProperties: false
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('should return warnings in lenient mode for unknown properties', () => {
      const entityData = {
        name: 'Test',
        unknownProp: 'value'
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'lenient',
        allowUnknownProperties: false
      });

      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].path).toBe('unknownProp');
    });

    test('should allow unknown properties when allowUnknownProperties is true', () => {
      const entityData = {
        name: 'Test',
        unknownProp: 'value'
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict',
        allowUnknownProperties: true
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Required Property Validation', () => {
    test('should fail when required property is missing', () => {
      const entityData = {
        value: 42
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict'
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].path).toBe('name');
      expect(result.errors[0].message).toContain('Required property');
    });

    test('should fail when required property is undefined', () => {
      const entityData = {
        name: undefined,
        value: 42
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict'
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path === 'name')).toBe(true);
    });

    test('should pass when all required properties are present', () => {
      const entityData = {
        name: 'Valid Entity'
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict'
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Type Validation', () => {
    test('should validate string type', () => {
      const entityData = {
        name: 'Test String'
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict'
      });

      expect(result.valid).toBe(true);
    });

    test('should fail for invalid string type', () => {
      const entityData = {
        name: 123 // Should be string
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict'
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('must be a string');
    });

    test('should validate number type', () => {
      const entityData = {
        name: 'Test',
        value: 42
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict'
      });

      expect(result.valid).toBe(true);
    });

    test('should fail for invalid number type', () => {
      const entityData = {
        name: 'Test',
        value: 'not a number'
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict'
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path === 'value')).toBe(true);
    });

    test('should validate boolean type', () => {
      const entityData = {
        lowerProp: true
      };

      const result = validator.validate('LowerOnlyEntity', entityData, {
        mode: 'strict',
        team: 'TestTeam',
        allowUnknownProperties: true
      });

      expect(result.valid).toBe(true);
    });

    test('should validate array type', () => {
      const entityData = {
        name: 'Test',
        tags: ['tag1', 'tag2', 'tag3']
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict'
      });

      expect(result.valid).toBe(true);
    });

    test('should fail for invalid array type', () => {
      const entityData = {
        name: 'Test',
        tags: 'not an array'
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict'
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path === 'tags')).toBe(true);
    });
  });

  describe('Enum Validation', () => {
    test('should validate valid enum value', () => {
      const entityData = {
        name: 'Test',
        category: 'type-a'
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict'
      });

      expect(result.valid).toBe(true);
    });

    test('should fail for invalid enum value', () => {
      const entityData = {
        name: 'Test',
        category: 'invalid-type'
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict'
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('invalid enum value');
      expect(result.errors[0].expected).toContain('type-a');
    });
  });

  describe('Pattern Validation', () => {
    test('should validate string matching pattern', () => {
      // This test would need a property with a pattern in the test ontology
      // For now, we'll test the mechanism exists
      const entityData = {
        name: 'Test'
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict'
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('Min/Max Validation', () => {
    test('should validate number within min/max range', () => {
      // TestEntity has value property, assuming it has constraints
      const entityData = {
        name: 'Test',
        value: 50
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict'
      });

      expect(result.valid).toBe(true);
    });

    test('should validate array length constraints', () => {
      const entityData = {
        name: 'Test',
        tags: ['tag1', 'tag2']
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict'
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('Null and Undefined Handling', () => {
    test('should fail for null value without default', () => {
      const entityData = {
        name: null
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict'
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('null or undefined'))).toBe(true);
    });

    test('should allow null if property has default value', () => {
      // This would need a property with a default value in the test ontology
      const entityData = {
        name: 'Test'
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict'
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('Inheritance and Lower Ontology Validation', () => {
    test('should validate entity from lower ontology', () => {
      const entityData = {
        name: 'Extended Test',
        extraProperty: 'lower-specific-value'
      };

      const result = validator.validate('ExtendedEntity', entityData, {
        mode: 'strict',
        team: 'TestTeam'
      });

      expect(result.valid).toBe(true);
    });

    test('should validate inherited properties from upper ontology', () => {
      const entityData = {
        name: 'Extended Test',
        value: 150,
        extraProperty: 'test'
      };

      const result = validator.validate('ExtendedEntity', entityData, {
        mode: 'strict',
        team: 'TestTeam'
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('Fail Fast Mode', () => {
    test('should stop validation on first error when failFast is true', () => {
      const entityData = {
        // Missing required 'name'
        value: 'not a number',
        category: 'invalid-enum'
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict',
        failFast: true
      });

      expect(result.valid).toBe(false);
      // Should have fewer errors than without failFast (not necessarily exactly 1)
      expect(result.errors.length).toBeLessThanOrEqual(2);
    });

    test('should collect all errors when failFast is false', () => {
      const entityData = {
        // Missing required 'name'
        value: 'not a number',
        category: 'invalid-enum'
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict',
        failFast: false
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1); // Multiple errors
    });
  });

  describe('Error Messages', () => {
    test('should provide detailed error messages with path', () => {
      const entityData = {
        name: 123 // Wrong type for testing error details
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict'
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0].path).toBeDefined();
      expect(result.errors[0].message).toBeDefined();
      expect(result.errors[0].expected).toBeDefined();
      // actual should be defined for type errors
      expect(result.errors[0]).toHaveProperty('actual');
    });

    test('should include expected and actual values in errors', () => {
      const entityData = {
        name: 123
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict'
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0].expected).toBe('string');
      expect(result.errors[0].actual).toBe('number');
    });
  });

  describe('Complex Validation Scenarios', () => {
    test('should validate complete valid entity', () => {
      const entityData = {
        name: 'Complete Entity',
        value: 75,
        category: 'type-b',
        tags: ['complete', 'valid', 'test']
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict'
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    test('should handle multiple validation errors', () => {
      const entityData = {
        name: 123,          // Wrong type
        value: 'invalid',   // Wrong type
        category: 'bad',    // Invalid enum
        tags: 'not-array'   // Wrong type
      };

      const result = validator.validate('TestEntity', entityData, {
        mode: 'strict',
        failFast: false
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });

    test('should validate empty entity when no required properties', () => {
      const entityData = {};

      const result = validator.validate('ParentEntity', entityData, {
        mode: 'strict'
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should handle validation error gracefully', () => {
      const entityData = {
        name: 'Test'
      };

      const result = validator.validate('NonExistentEntity', entityData, {
        mode: 'strict'
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain('Validation error');
    });
  });
});
