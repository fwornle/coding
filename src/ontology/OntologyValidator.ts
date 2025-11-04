/**
 * OntologyValidator - Validates entity instances against ontology definitions
 *
 * Responsibilities:
 * - Validate entity properties against property definitions
 * - Support validation modes: strict, lenient, disabled
 * - Check required properties
 * - Validate property types, enums, patterns, constraints
 * - Handle nested object and array validation
 * - Return detailed validation results with errors and warnings
 */

import {
  EntityDefinition,
  PropertyDefinition,
  ValidationResult,
  ValidationError,
  ValidationOptions,
  PropertyValidationResult,
  OntologyValidationError,
} from './types.js';
import { OntologyManager, ResolvedEntityDefinition } from './OntologyManager.js';
import { ontologyMetrics } from './metrics.js';

/**
 * OntologyValidator - Validates entity instances against ontology schemas
 */
export class OntologyValidator {
  constructor(private ontologyManager: OntologyManager) {}

  /**
   * Validate an entity instance against its ontology definition
   */
  validate(
    entityClass: string,
    entityData: Record<string, any>,
    options: ValidationOptions
  ): ValidationResult {
    ontologyMetrics.incrementCounter('ontology_validation_total', {
      mode: options.mode,
      team: options.team || 'all'
    });

    // Disabled mode - skip validation
    if (options.mode === 'disabled') {
      return { valid: true, errors: [], warnings: [] };
    }

    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    try {
      // Resolve entity definition with inheritance
      const entityDef = this.ontologyManager.resolveEntityDefinition(
        entityClass,
        options.team
      );

      // Validate required properties
      this.validateRequiredProperties(entityDef, entityData, errors, options);

      // Validate each property
      for (const [propName, propValue] of Object.entries(entityData)) {
        const propDef = entityDef.properties[propName];

        if (!propDef) {
          // Unknown property
          if (!options.allowUnknownProperties) {
            const error: ValidationError = {
              path: propName,
              message: `Unknown property '${propName}' not defined in ontology`,
              expected: `Property defined in ${entityClass} ontology`,
              actual: propValue,
            };

            if (options.mode === 'strict') {
              errors.push(error);
              if (options.failFast) {
                return { valid: false, errors, warnings };
              }
            } else {
              warnings.push(error);
            }
          }
          continue;
        }

        // Validate property value
        const propResult = this.validateProperty(
          propName,
          propValue,
          propDef,
          options
        );

        if (!propResult.valid && propResult.error) {
          if (options.mode === 'strict') {
            errors.push(propResult.error);
            if (options.failFast) {
              return { valid: false, errors, warnings };
            }
          } else {
            warnings.push(propResult.error);
          }
        }
      }
    } catch (error) {
      errors.push({
        path: '',
        message: `Validation error: ${(error as Error).message}`,
        actual: entityData,
      });
    }

    const valid = errors.length === 0;

    // Record metrics
    if (valid) {
      ontologyMetrics.incrementCounter('ontology_validation_success', {
        mode: options.mode,
        team: options.team || 'all'
      });
    } else {
      ontologyMetrics.incrementCounter('ontology_validation_failure', {
        mode: options.mode,
        team: options.team || 'all'
      });
    }

    return { valid, errors, warnings };
  }

  /**
   * Validate required properties are present
   */
  private validateRequiredProperties(
    entityDef: ResolvedEntityDefinition,
    entityData: Record<string, any>,
    errors: ValidationError[],
    options: ValidationOptions
  ): void {
    if (!entityDef.requiredProperties) {
      return;
    }

    for (const requiredProp of entityDef.requiredProperties) {
      if (!(requiredProp in entityData) || entityData[requiredProp] === undefined) {
        errors.push({
          path: requiredProp,
          message: `Required property '${requiredProp}' is missing`,
          expected: `Property value of type ${entityDef.properties[requiredProp]?.type}`,
          actual: undefined,
        });

        if (options.failFast) {
          return;
        }
      }
    }
  }

  /**
   * Validate a single property against its definition
   */
  private validateProperty(
    propName: string,
    propValue: any,
    propDef: PropertyDefinition,
    options: ValidationOptions
  ): PropertyValidationResult {
    // Null/undefined handling
    if (propValue === null || propValue === undefined) {
      if (propDef.default !== undefined) {
        return { valid: true }; // Will use default value
      }
      return {
        valid: false,
        error: {
          path: propName,
          message: `Property '${propName}' is null or undefined`,
          expected: `Value of type ${propDef.type}`,
          actual: propValue,
        },
      };
    }

    // Type validation
    const typeResult = this.validateType(propName, propValue, propDef, options);
    if (!typeResult.valid) {
      return typeResult;
    }

    // Enum validation
    if (propDef.enum && propDef.enum.length > 0) {
      if (!propDef.enum.includes(propValue)) {
        return {
          valid: false,
          error: {
            path: propName,
            message: `Property '${propName}' has invalid enum value`,
            expected: `One of: ${propDef.enum.join(', ')}`,
            actual: propValue,
          },
        };
      }
    }

    // Pattern validation (for strings)
    if (propDef.pattern && typeof propValue === 'string') {
      const regex = new RegExp(propDef.pattern);
      if (!regex.test(propValue)) {
        return {
          valid: false,
          error: {
            path: propName,
            message: `Property '${propName}' does not match pattern`,
            expected: `String matching pattern: ${propDef.pattern}`,
            actual: propValue,
          },
        };
      }
    }

    // Min/Max validation
    if (propDef.min !== undefined || propDef.max !== undefined) {
      const minMaxResult = this.validateMinMax(propName, propValue, propDef);
      if (!minMaxResult.valid) {
        return minMaxResult;
      }
    }

    return { valid: true };
  }

  /**
   * Validate property type
   */
  private validateType(
    propName: string,
    propValue: any,
    propDef: PropertyDefinition,
    options: ValidationOptions
  ): PropertyValidationResult {
    switch (propDef.type) {
      case 'string':
        if (typeof propValue !== 'string') {
          return {
            valid: false,
            error: {
              path: propName,
              message: `Property '${propName}' must be a string`,
              expected: 'string',
              actual: typeof propValue,
            },
          };
        }
        break;

      case 'number':
        if (typeof propValue !== 'number' || isNaN(propValue)) {
          return {
            valid: false,
            error: {
              path: propName,
              message: `Property '${propName}' must be a number`,
              expected: 'number',
              actual: typeof propValue,
            },
          };
        }
        break;

      case 'boolean':
        if (typeof propValue !== 'boolean') {
          return {
            valid: false,
            error: {
              path: propName,
              message: `Property '${propName}' must be a boolean`,
              expected: 'boolean',
              actual: typeof propValue,
            },
          };
        }
        break;

      case 'object':
        if (typeof propValue !== 'object' || Array.isArray(propValue)) {
          return {
            valid: false,
            error: {
              path: propName,
              message: `Property '${propName}' must be an object`,
              expected: 'object',
              actual: Array.isArray(propValue) ? 'array' : typeof propValue,
            },
          };
        }

        // Validate nested object properties
        if (propDef.properties) {
          const nestedResult = this.validateNestedObject(
            propName,
            propValue,
            propDef.properties,
            options
          );
          if (!nestedResult.valid) {
            return nestedResult;
          }
        }
        break;

      case 'array':
        if (!Array.isArray(propValue)) {
          return {
            valid: false,
            error: {
              path: propName,
              message: `Property '${propName}' must be an array`,
              expected: 'array',
              actual: typeof propValue,
            },
          };
        }

        // Validate array items
        if (propDef.items) {
          const arrayResult = this.validateArray(
            propName,
            propValue,
            propDef.items,
            options
          );
          if (!arrayResult.valid) {
            return arrayResult;
          }
        }
        break;

      case 'reference':
        // Reference validation - check if referenced entity exists
        if (typeof propValue !== 'string') {
          return {
            valid: false,
            error: {
              path: propName,
              message: `Property '${propName}' must be a string reference`,
              expected: 'string (entity reference)',
              actual: typeof propValue,
            },
          };
        }

        if (propDef.targetEntityClass) {
          // Optional: Verify referenced entity class exists
          const exists = this.ontologyManager.hasEntityClass(
            propDef.targetEntityClass,
            options.team
          );
          if (!exists) {
            return {
              valid: false,
              error: {
                path: propName,
                message: `Reference target entity class '${propDef.targetEntityClass}' does not exist`,
                expected: `Valid entity class`,
                actual: propDef.targetEntityClass,
              },
            };
          }
        }
        break;

      default:
        return {
          valid: false,
          error: {
            path: propName,
            message: `Unknown property type '${propDef.type}'`,
            expected: 'string | number | boolean | object | array | reference',
            actual: propDef.type,
          },
        };
    }

    return { valid: true };
  }

  /**
   * Validate nested object properties
   */
  private validateNestedObject(
    parentPath: string,
    objValue: Record<string, any>,
    propDefs: Record<string, PropertyDefinition>,
    options: ValidationOptions
  ): PropertyValidationResult {
    for (const [nestedPropName, nestedPropValue] of Object.entries(objValue)) {
      const nestedPropDef = propDefs[nestedPropName];

      if (!nestedPropDef && !options.allowUnknownProperties) {
        return {
          valid: false,
          error: {
            path: `${parentPath}.${nestedPropName}`,
            message: `Unknown nested property '${nestedPropName}'`,
            expected: 'Property defined in ontology',
            actual: nestedPropValue,
          },
        };
      }

      if (nestedPropDef) {
        const nestedResult = this.validateProperty(
          `${parentPath}.${nestedPropName}`,
          nestedPropValue,
          nestedPropDef,
          options
        );

        if (!nestedResult.valid) {
          return nestedResult;
        }
      }
    }

    return { valid: true };
  }

  /**
   * Validate array items
   */
  private validateArray(
    propName: string,
    arrayValue: any[],
    itemsDef: string | PropertyDefinition,
    options: ValidationOptions
  ): PropertyValidationResult {
    // String item type (simple type name)
    if (typeof itemsDef === 'string') {
      for (let i = 0; i < arrayValue.length; i++) {
        const item = arrayValue[i];
        const expectedType = itemsDef;

        if (typeof item !== expectedType) {
          return {
            valid: false,
            error: {
              path: `${propName}[${i}]`,
              message: `Array item at index ${i} has wrong type`,
              expected: expectedType,
              actual: typeof item,
            },
          };
        }
      }
      return { valid: true };
    }

    // PropertyDefinition for complex item types
    for (let i = 0; i < arrayValue.length; i++) {
      const item = arrayValue[i];
      const itemResult = this.validateProperty(
        `${propName}[${i}]`,
        item,
        itemsDef,
        options
      );

      if (!itemResult.valid) {
        return itemResult;
      }
    }

    return { valid: true };
  }

  /**
   * Validate min/max constraints
   */
  private validateMinMax(
    propName: string,
    propValue: any,
    propDef: PropertyDefinition
  ): PropertyValidationResult {
    // For numbers: min/max value
    if (typeof propValue === 'number') {
      if (propDef.min !== undefined && propValue < propDef.min) {
        return {
          valid: false,
          error: {
            path: propName,
            message: `Property '${propName}' is below minimum`,
            expected: `>= ${propDef.min}`,
            actual: propValue,
          },
        };
      }

      if (propDef.max !== undefined && propValue > propDef.max) {
        return {
          valid: false,
          error: {
            path: propName,
            message: `Property '${propName}' exceeds maximum`,
            expected: `<= ${propDef.max}`,
            actual: propValue,
          },
        };
      }
    }

    // For strings: min/max length
    if (typeof propValue === 'string') {
      if (propDef.min !== undefined && propValue.length < propDef.min) {
        return {
          valid: false,
          error: {
            path: propName,
            message: `Property '${propName}' is too short`,
            expected: `>= ${propDef.min} characters`,
            actual: `${propValue.length} characters`,
          },
        };
      }

      if (propDef.max !== undefined && propValue.length > propDef.max) {
        return {
          valid: false,
          error: {
            path: propName,
            message: `Property '${propName}' is too long`,
            expected: `<= ${propDef.max} characters`,
            actual: `${propValue.length} characters`,
          },
        };
      }
    }

    // For arrays: min/max length
    if (Array.isArray(propValue)) {
      if (propDef.min !== undefined && propValue.length < propDef.min) {
        return {
          valid: false,
          error: {
            path: propName,
            message: `Array '${propName}' has too few items`,
            expected: `>= ${propDef.min} items`,
            actual: `${propValue.length} items`,
          },
        };
      }

      if (propDef.max !== undefined && propValue.length > propDef.max) {
        return {
          valid: false,
          error: {
            path: propName,
            message: `Array '${propName}' has too many items`,
            expected: `<= ${propDef.max} items`,
            actual: `${propValue.length} items`,
          },
        };
      }
    }

    return { valid: true };
  }

  /**
   * Batch validate multiple entity instances
   */
  batchValidate(
    entities: Array<{ entityClass: string; data: Record<string, any> }>,
    options: ValidationOptions
  ): Array<{ index: number; result: ValidationResult }> {
    return entities.map((entity, index) => ({
      index,
      result: this.validate(entity.entityClass, entity.data, options),
    }));
  }

  /**
   * Validate and throw on error (strict mode helper)
   */
  validateOrThrow(
    entityClass: string,
    entityData: Record<string, any>,
    options: ValidationOptions
  ): void {
    const result = this.validate(entityClass, entityData, options);
    if (!result.valid) {
      throw new OntologyValidationError(
        `Validation failed for entity class '${entityClass}'`,
        result.errors
      );
    }
  }
}
