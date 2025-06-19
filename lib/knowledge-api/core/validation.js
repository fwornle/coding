/**
 * Validation Service - Schema validation for entities and relations
 */

import Joi from 'joi';

export class ValidationService {
  constructor() {
    this.entitySchema = this._createEntitySchema();
    this.relationSchema = this._createRelationSchema();
    this.observationSchema = this._createObservationSchema();
  }

  /**
   * Validate entity data
   */
  async validateEntity(entityData) {
    try {
      await this.entitySchema.validateAsync(entityData);
      return { valid: true, errors: [] };
    } catch (error) {
      return {
        valid: false,
        errors: error.details.map(detail => detail.message)
      };
    }
  }

  /**
   * Validate relation data
   */
  async validateRelation(relationData) {
    try {
      await this.relationSchema.validateAsync(relationData);
      return { valid: true, errors: [] };
    } catch (error) {
      return {
        valid: false,
        errors: error.details.map(detail => detail.message)
      };
    }
  }

  /**
   * Validate observation data
   */
  async validateObservation(observationData) {
    try {
      await this.observationSchema.validateAsync(observationData);
      return { valid: true, errors: [] };
    } catch (error) {
      return {
        valid: false,
        errors: error.details.map(detail => detail.message)
      };
    }
  }

  /**
   * Validate entity name
   */
  validateEntityName(name) {
    const nameSchema = Joi.string()
      .min(1)
      .max(200)
      .pattern(/^[a-zA-Z0-9_\-\s\.]+$/)
      .required();
    
    const { error } = nameSchema.validate(name);
    return {
      valid: !error,
      errors: error ? [error.details[0].message] : []
    };
  }

  /**
   * Validate relation type
   */
  validateRelationType(relationType) {
    const relationTypeSchema = Joi.string()
      .min(1)
      .max(100)
      .pattern(/^[a-zA-Z0-9_\-]+$/)
      .required();
    
    const { error } = relationTypeSchema.validate(relationType);
    return {
      valid: !error,
      errors: error ? [error.details[0].message] : []
    };
  }

  /**
   * Validate significance score
   */
  validateSignificance(significance) {
    const significanceSchema = Joi.number()
      .integer()
      .min(1)
      .max(10)
      .required();
    
    const { error } = significanceSchema.validate(significance);
    return {
      valid: !error,
      errors: error ? [error.details[0].message] : []
    };
  }

  /**
   * Validate URL
   */
  validateUrl(url) {
    const urlSchema = Joi.string().uri({
      scheme: ['http', 'https', 'file']
    });
    
    const { error } = urlSchema.validate(url);
    return {
      valid: !error,
      errors: error ? [error.details[0].message] : []
    };
  }

  /**
   * Validate batch operations
   */
  async validateEntityBatch(entities) {
    const results = [];
    
    for (let i = 0; i < entities.length; i++) {
      const validation = await this.validateEntity(entities[i]);
      if (!validation.valid) {
        results.push({
          index: i,
          entity: entities[i].name || `Entity ${i}`,
          errors: validation.errors
        });
      }
    }
    
    return {
      valid: results.length === 0,
      errors: results
    };
  }

  async validateRelationBatch(relations) {
    const results = [];
    
    for (let i = 0; i < relations.length; i++) {
      const validation = await this.validateRelation(relations[i]);
      if (!validation.valid) {
        results.push({
          index: i,
          relation: `${relations[i].from} -> ${relations[i].to}`,
          errors: validation.errors
        });
      }
    }
    
    return {
      valid: results.length === 0,
      errors: results
    };
  }

  // Private schema creators

  _createEntitySchema() {
    return Joi.object({
      id: Joi.string().optional(),
      name: Joi.string()
        .min(1)
        .max(200)
        .pattern(/^[a-zA-Z0-9_\-\s\.]+$/)
        .required(),
      entityType: Joi.string()
        .min(1)
        .max(100)
        .pattern(/^[a-zA-Z0-9_\-]+$/)
        .required(),
      observations: Joi.array()
        .items(
          Joi.alternatives().try(
            Joi.string().max(5000),
            this.observationSchema
          )
        )
        .optional()
        .default([]),
      significance: Joi.number()
        .integer()
        .min(1)
        .max(10)
        .optional()
        .default(5),
      created: Joi.string().isoDate().optional(),
      updated: Joi.string().isoDate().optional(),
      metadata: Joi.object().optional().default({}),
      
      // Legacy fields support
      problem: Joi.object().optional(),
      solution: Joi.object().optional(),
      pattern: Joi.object().optional(),
      legacy_observations: Joi.array().items(Joi.string()).optional()
    });
  }

  _createRelationSchema() {
    return Joi.object({
      id: Joi.string().optional(),
      from: Joi.string()
        .min(1)
        .max(200)
        .required(),
      to: Joi.string()
        .min(1)
        .max(200)
        .required(),
      relationType: Joi.string()
        .min(1)
        .max(100)
        .pattern(/^[a-zA-Z0-9_\-]+$/)
        .required(),
      significance: Joi.number()
        .integer()
        .min(1)
        .max(10)
        .optional()
        .default(5),
      created: Joi.string().isoDate().optional(),
      metadata: Joi.object().optional().default({})
    });
  }

  _createObservationSchema() {
    return Joi.object({
      type: Joi.string()
        .valid('problem', 'solution', 'insight', 'metric', 'reference', 'general')
        .optional()
        .default('general'),
      content: Joi.string()
        .min(1)
        .max(5000)
        .required(),
      date: Joi.string().isoDate().optional(),
      tags: Joi.array().items(Joi.string()).optional(),
      metadata: Joi.object().optional()
    });
  }

  /**
   * Common validation patterns
   */
  static get PATTERNS() {
    return {
      ENTITY_NAME: /^[a-zA-Z0-9_\-\s\.]+$/,
      RELATION_TYPE: /^[a-zA-Z0-9_\-]+$/,
      SAFE_FILENAME: /^[a-zA-Z0-9_\-\.]+$/
    };
  }

  /**
   * Common entity types
   */
  static get ENTITY_TYPES() {
    return [
      'WorkflowPattern',
      'TechnicalPattern',
      'ArchitecturePattern',
      'Problem',
      'Solution',
      'Insight',
      'Tool',
      'Library',
      'Framework',
      'Concept',
      'Best Practice',
      'Anti-Pattern',
      'Debugging',
      'Performance',
      'Security',
      'Documentation',
      'Project',
      'Feature',
      'Bug',
      'Requirement',
      'Testing',
      'Deployment',
      'Integration',
      'API',
      'Database',
      'Configuration',
      'Environment',
      'Workflow',
      'Process',
      'Template',
      'Example',
      'Reference'
    ];
  }

  /**
   * Common relation types
   */
  static get RELATION_TYPES() {
    return [
      'implements',
      'extends',
      'uses',
      'requires',
      'depends_on',
      'related_to',
      'solves',
      'causes',
      'prevents',
      'improves',
      'replaces',
      'similar_to',
      'opposite_of',
      'part_of',
      'contains',
      'references',
      'exemplifies',
      'applies_to',
      'derived_from',
      'leads_to',
      'conflicts_with',
      'complements',
      'precedes',
      'follows',
      'alternative_to',
      'supersedes',
      'validates',
      'tests',
      'documents',
      'configures',
      'enables',
      'disables',
      'optimizes',
      'debugs',
      'monitors',
      'integrates_with',
      'migrates_to',
      'backups',
      'restores'
    ];
  }

  /**
   * Get validation summary
   */
  getValidationSummary() {
    return {
      entityTypes: ValidationService.ENTITY_TYPES,
      relationTypes: ValidationService.RELATION_TYPES,
      patterns: ValidationService.PATTERNS,
      constraints: {
        entityName: { min: 1, max: 200 },
        relationType: { min: 1, max: 100 },
        significance: { min: 1, max: 10 },
        observationContent: { min: 1, max: 5000 }
      }
    };
  }
}