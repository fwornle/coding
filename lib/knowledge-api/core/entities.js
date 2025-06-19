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
    
    this.logger.info(`Created entity: ${entity.name} (${entity.entityType})`);
    return entity;
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