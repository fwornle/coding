/**
 * Simple Validation Service - Basic validation without Joi
 */

export class ValidationService {
  constructor() {
    // Simple validation without external dependencies
  }

  /**
   * Validate entity data
   */
  async validateEntity(entityData) {
    const errors = [];
    
    if (!entityData || typeof entityData !== 'object') {
      errors.push('Entity data must be an object');
    }
    
    if (!entityData.name || typeof entityData.name !== 'string' || entityData.name.trim().length === 0) {
      errors.push('Entity name is required and must be a non-empty string');
    }
    
    if (!entityData.entityType || typeof entityData.entityType !== 'string') {
      errors.push('Entity type is required and must be a string');
    }
    
    if (entityData.significance !== undefined) {
      const sig = Number(entityData.significance);
      if (isNaN(sig) || sig < 1 || sig > 10) {
        errors.push('Significance must be a number between 1 and 10');
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate relation data
   */
  async validateRelation(relationData) {
    const errors = [];
    
    if (!relationData || typeof relationData !== 'object') {
      errors.push('Relation data must be an object');
    }
    
    if (!relationData.from || typeof relationData.from !== 'string') {
      errors.push('Relation "from" is required and must be a string');
    }
    
    if (!relationData.to || typeof relationData.to !== 'string') {
      errors.push('Relation "to" is required and must be a string');
    }
    
    if (!relationData.relationType || typeof relationData.relationType !== 'string') {
      errors.push('Relation type is required and must be a string');
    }
    
    if (relationData.significance !== undefined) {
      const sig = Number(relationData.significance);
      if (isNaN(sig) || sig < 1 || sig > 10) {
        errors.push('Significance must be a number between 1 and 10');
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate observation data
   */
  async validateObservation(observationData) {
    const errors = [];
    
    if (typeof observationData === 'string') {
      return { valid: true, errors: [] };
    }
    
    if (!observationData || typeof observationData !== 'object') {
      errors.push('Observation must be a string or object');
    }
    
    if (!observationData.content || typeof observationData.content !== 'string') {
      errors.push('Observation content is required and must be a string');
    }
    
    return {
      valid: errors.length === 0,
      errors
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
      'Documentation',
      'Project',
      'Feature'
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
      'part_of',
      'contains',
      'references',
      'exemplifies'
    ];
  }
}