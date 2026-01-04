/**
 * Entity Manager - Core CRUD operations for knowledge entities
 */

import { v4 as uuidv4 } from 'uuid';

export class EntityManager {
  constructor(storage, validation, logger) {
    this.storage = storage;
    this.validation = validation;
    this.logger = logger;
  }

  /**
   * Create a new entity
   */
  async create(entityData) {
    // Validate input
    const validation = await this.validation.validateEntity(entityData);
    if (!validation.valid) {
      throw new Error(`Invalid entity data: ${validation.errors.join(', ')}`);
    }

    // Create entity with metadata
    const entity = {
      id: uuidv4(),
      name: entityData.name,
      entityType: entityData.entityType,
      observations: entityData.observations || [],
      significance: entityData.significance || 5,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      metadata: {
        created_by: 'knowledge-api',
        version: '2.0.0',
        ...entityData.metadata
      }
    };

    // Check for duplicates
    const existing = await this.findByName(entity.name);
    if (existing) {
      throw new Error(`Entity with name '${entity.name}' already exists`);
    }

    // Store entity
    await this.storage.addEntity(entity);
    
    // Auto-create relations to ensure entity connectivity (skip for auto-created entities)
    if (!entity.metadata.auto_created) {
      await this._createAutoRelations(entity);
    }
    
    this.logger.info(`Created entity: ${entity.name} (${entity.entityType})`);
    return entity;
  }

  /**
   * Create automatic relations for new entities to ensure graph connectivity
   * HIERARCHICAL STRUCTURE: CollectiveKnowledge -> Projects -> Topics
   */
  async _createAutoRelations(entity) {
    try {
      // 1. Ensure CollectiveKnowledge exists
      let collectiveKnowledge = await this.findByName('CollectiveKnowledge');
      if (!collectiveKnowledge) {
        // Create directly without auto-relations to avoid recursion
        collectiveKnowledge = {
          id: uuidv4(),
          name: 'CollectiveKnowledge',
          entityType: 'System',
          observations: ['Central system node representing collective knowledge across all projects'],
          significance: 10,
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          metadata: {
            created_by: 'knowledge-api',
            version: '2.0.0',
            auto_created: true
          }
        };
        await this.storage.addEntity(collectiveKnowledge);
        this.logger.info('Auto-created CollectiveKnowledge entity');
      }

      // 2. Create project-specific relations if team metadata exists
      // Topics link to Projects (NOT directly to CollectiveKnowledge)
      if (entity.metadata && entity.metadata.team) {
        const projectNode = await this._ensureProjectNode(entity.metadata.team);
        if (projectNode) {
          const relations = await this.storage.getRelations();
          const projectRelation = relations.find(r =>
            r.from === projectNode.name && r.to === entity.name
          );
          
          if (!projectRelation) {
            const relation = {
              id: uuidv4(),
              from: projectNode.name,
              to: entity.name,
              relationType: 'contains',
              significance: 7,
              created: new Date().toISOString(),
              metadata: {
                created_by: 'knowledge-api',
                auto_created: true
              }
            };
            
            await this.storage.addRelation(relation);
            this.logger.debug(`Auto-created project relation: ${projectNode.name} -> ${entity.name}`);
          }
        }
      }
    } catch (error) {
      // Don't fail entity creation if relation creation fails
      this.logger.warn(`Failed to create auto-relations for ${entity.name}:`, error.message);
    }
  }

  /**
   * Ensure project node exists for a team/view
   */
  async _ensureProjectNode(team) {
    // Determine the appropriate project node based on semantic analysis
    const projectName = await this._determineProjectNode(team);
    
    if (!projectName) {
      this.logger.warn(`Could not determine project node for team: ${team}`);
      return null;
    }
    
    let projectNode = await this.findByName(projectName);
    if (!projectNode) {
      this.logger.warn(`Project node ${projectName} not found for team ${team}`);
      // Don't auto-create project nodes - they should be created intentionally
      return null;
    }
    
    return projectNode;
  }

  /**
   * Determine the appropriate project node based on semantic context
   */
  async _determineProjectNode(team) {
    // Known mappings from our analysis
    const projectMappings = {
      'coding': 'Coding',      // coding.json → Coding project
      'ui': null,              // ui.json → DynArch or Timeline (needs semantic analysis)
      'resi': 'Normalisa'      // resi.json → Normalisa project
    };

    // For coding team, always use "Coding" project
    if (team === 'coding') {
      return 'Coding';
    }

    // For other teams, we need semantic analysis to determine the project
    // This would require analyzing the entity content and current repository
    // For now, return the default mapping or null
    return projectMappings[team] || null;
  }

  /**
   * Find entity by name
   */
  async findByName(name) {
    const entities = await this.storage.getEntities();
    return entities.find(e => e.name === name);
  }

  /**
   * Find entity by ID
   */
  async findById(id) {
    const entities = await this.storage.getEntities();
    return entities.find(e => e.id === id);
  }

  /**
   * Get all entities
   */
  async getAll(filters = {}) {
    let entities = await this.storage.getEntities();
    
    // Apply filters
    if (filters.entityType) {
      entities = entities.filter(e => e.entityType === filters.entityType);
    }
    
    if (filters.minSignificance) {
      entities = entities.filter(e => (e.significance || 5) >= filters.minSignificance);
    }
    
    if (filters.search) {
      const searchTerm = filters.search.toLowerCase();
      entities = entities.filter(e => 
        e.name.toLowerCase().includes(searchTerm) ||
        e.entityType.toLowerCase().includes(searchTerm) ||
        (e.observations || []).some(obs => 
          (typeof obs === 'string' ? obs : obs.content || '').toLowerCase().includes(searchTerm)
        )
      );
    }

    // Sort by significance (descending) then by name
    entities.sort((a, b) => {
      const sigA = a.significance || 5;
      const sigB = b.significance || 5;
      if (sigA !== sigB) return sigB - sigA;
      return a.name.localeCompare(b.name);
    });

    return entities;
  }

  /**
   * Update an entity
   */
  async update(nameOrId, updates) {
    const entity = await this.findByName(nameOrId) || await this.findById(nameOrId);
    if (!entity) {
      throw new Error(`Entity not found: ${nameOrId}`);
    }

    // Validate updates
    const updatedEntity = { ...entity, ...updates };
    const validation = await this.validation.validateEntity(updatedEntity);
    if (!validation.valid) {
      throw new Error(`Invalid entity updates: ${validation.errors.join(', ')}`);
    }

    // Apply updates
    updatedEntity.updated = new Date().toISOString();
    
    await this.storage.updateEntity(entity.name, updatedEntity);
    
    this.logger.info(`Updated entity: ${entity.name}`);
    return updatedEntity;
  }

  /**
   * Add observation to entity
   */
  async addObservation(nameOrId, observation) {
    const entity = await this.findByName(nameOrId) || await this.findById(nameOrId);
    if (!entity) {
      throw new Error(`Entity not found: ${nameOrId}`);
    }

    // Normalize observation format
    const normalizedObs = typeof observation === 'string' ? 
      { type: 'general', content: observation, date: new Date().toISOString() } :
      { date: new Date().toISOString(), ...observation };

    // Add observation
    const observations = entity.observations || [];
    observations.push(normalizedObs);

    await this.update(entity.name, { observations });
    
    this.logger.info(`Added observation to entity: ${entity.name}`);
    return normalizedObs;
  }

  /**
   * Remove observation from entity
   */
  async removeObservation(nameOrId, observationIndex) {
    const entity = await this.findByName(nameOrId) || await this.findById(nameOrId);
    if (!entity) {
      throw new Error(`Entity not found: ${nameOrId}`);
    }

    const observations = [...(entity.observations || [])];
    if (observationIndex < 0 || observationIndex >= observations.length) {
      throw new Error(`Invalid observation index: ${observationIndex}`);
    }

    observations.splice(observationIndex, 1);
    await this.update(entity.name, { observations });
    
    this.logger.info(`Removed observation from entity: ${entity.name}`);
    return entity;
  }

  /**
   * Delete an entity
   */
  async delete(nameOrId) {
    const entity = await this.findByName(nameOrId) || await this.findById(nameOrId);
    if (!entity) {
      throw new Error(`Entity not found: ${nameOrId}`);
    }

    await this.storage.removeEntity(entity.name);
    
    this.logger.info(`Deleted entity: ${entity.name}`);
    return true;
  }

  /**
   * Get entity count
   */
  async count() {
    const entities = await this.storage.getEntities();
    return entities.length;
  }

  /**
   * Get entities by type
   */
  async getByType(entityType) {
    return this.getAll({ entityType });
  }

  /**
   * Search entities
   */
  async search(query, options = {}) {
    return this.getAll({ search: query, ...options });
  }

  /**
   * Rename an entity
   */
  async rename(oldName, newName) {
    const entity = await this.findByName(oldName);
    if (!entity) {
      throw new Error(`Entity not found: ${oldName}`);
    }

    const existing = await this.findByName(newName);
    if (existing) {
      throw new Error(`Entity with name '${newName}' already exists`);
    }

    // Update entity name
    const updatedEntity = { ...entity, name: newName, updated: new Date().toISOString() };
    
    // Remove old entity and add new one
    await this.storage.removeEntity(oldName);
    await this.storage.addEntity(updatedEntity);
    
    this.logger.info(`Renamed entity: ${oldName} -> ${newName}`);
    return updatedEntity;
  }

  /**
   * Get high-significance entities
   */
  async getHighSignificance(threshold = 8) {
    return this.getAll({ minSignificance: threshold });
  }
}