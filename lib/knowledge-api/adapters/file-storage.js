/**
 * File Storage Adapter - JSON file-based backend for knowledge storage
 */

import { promises as fs } from 'fs';
import path from 'path';

export class FileStorageAdapter {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.filePath = path.resolve(config.path || './shared-memory.json');
    this.data = { entities: [], relations: [], metadata: {} };
    this.initialized = false;
  }

  /**
   * Initialize storage - load existing file or create new one
   */
  async initialize() {
    try {
      await this._ensureDirectoryExists();
      
      if (await this._fileExists(this.filePath)) {
        await this._loadData();
        this.logger.info(`Loaded knowledge base from: ${this.filePath}`);
      } else {
        await this._createEmptyFile();
        this.logger.info(`Created new knowledge base: ${this.filePath}`);
      }
      
      this.initialized = true;
    } catch (error) {
      this.logger.error(`Failed to initialize storage: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get storage information
   */
  getInfo() {
    return {
      type: 'file',
      path: this.filePath,
      entities: this.data.entities.length,
      relations: this.data.relations.length,
      lastModified: this.data.metadata.last_updated || null
    };
  }

  /**
   * Get all entities
   */
  async getEntities() {
    this._ensureInitialized();
    return [...this.data.entities];
  }

  /**
   * Get all relations
   */
  async getRelations() {
    this._ensureInitialized();
    return [...this.data.relations];
  }

  /**
   * Add entity
   */
  async addEntity(entity) {
    this._ensureInitialized();
    
    // Check for duplicate names
    const existingIndex = this.data.entities.findIndex(e => e.name === entity.name);
    if (existingIndex !== -1) {
      throw new Error(`Entity with name '${entity.name}' already exists`);
    }
    
    this.data.entities.push(entity);
    await this._saveData();
    
    this.logger.debug(`Added entity: ${entity.name}`);
  }

  /**
   * Update entity
   */
  async updateEntity(nameOrId, updatedEntity) {
    this._ensureInitialized();
    
    const index = this.data.entities.findIndex(e => 
      e.name === nameOrId || e.id === nameOrId
    );
    
    if (index === -1) {
      throw new Error(`Entity not found: ${nameOrId}`);
    }
    
    this.data.entities[index] = updatedEntity;
    await this._saveData();
    
    this.logger.debug(`Updated entity: ${updatedEntity.name}`);
  }

  /**
   * Remove entity
   */
  async removeEntity(nameOrId) {
    this._ensureInitialized();
    
    const index = this.data.entities.findIndex(e => 
      e.name === nameOrId || e.id === nameOrId
    );
    
    if (index === -1) {
      throw new Error(`Entity not found: ${nameOrId}`);
    }
    
    const removedEntity = this.data.entities.splice(index, 1)[0];
    await this._saveData();
    
    this.logger.debug(`Removed entity: ${removedEntity.name}`);
    return removedEntity;
  }

  /**
   * Add relation
   */
  async addRelation(relation) {
    this._ensureInitialized();
    
    // Check for duplicate relations
    const existingIndex = this.data.relations.findIndex(r => 
      r.from === relation.from && 
      r.to === relation.to && 
      r.relationType === relation.relationType
    );
    
    if (existingIndex !== -1) {
      throw new Error(`Relation already exists: ${relation.from} -[${relation.relationType}]-> ${relation.to}`);
    }
    
    this.data.relations.push(relation);
    await this._saveData();
    
    this.logger.debug(`Added relation: ${relation.from} -[${relation.relationType}]-> ${relation.to}`);
  }

  /**
   * Update relation
   */
  async updateRelation(relationId, updatedRelation) {
    this._ensureInitialized();
    
    const index = this.data.relations.findIndex(r => r.id === relationId);
    
    if (index === -1) {
      throw new Error(`Relation not found: ${relationId}`);
    }
    
    this.data.relations[index] = updatedRelation;
    await this._saveData();
    
    this.logger.debug(`Updated relation: ${relationId}`);
  }

  /**
   * Remove relation
   */
  async removeRelation(relationId) {
    this._ensureInitialized();
    
    const index = this.data.relations.findIndex(r => r.id === relationId);
    
    if (index === -1) {
      throw new Error(`Relation not found: ${relationId}`);
    }
    
    const removedRelation = this.data.relations.splice(index, 1)[0];
    await this._saveData();
    
    this.logger.debug(`Removed relation: ${relationId}`);
    return removedRelation;
  }

  /**
   * Bulk operations
   */
  async bulkAddEntities(entities) {
    this._ensureInitialized();
    
    for (const entity of entities) {
      if (!this.data.entities.find(e => e.name === entity.name)) {
        this.data.entities.push(entity);
      }
    }
    
    await this._saveData();
    this.logger.debug(`Bulk added ${entities.length} entities`);
  }

  async bulkAddRelations(relations) {
    this._ensureInitialized();
    
    for (const relation of relations) {
      if (!this.data.relations.find(r => 
        r.from === relation.from && 
        r.to === relation.to && 
        r.relationType === relation.relationType
      )) {
        this.data.relations.push(relation);
      }
    }
    
    await this._saveData();
    this.logger.debug(`Bulk added ${relations.length} relations`);
  }

  /**
   * Backup operations
   */
  async createBackup(backupPath = null) {
    this._ensureInitialized();
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultBackupPath = this.filePath.replace('.json', `-backup-${timestamp}.json`);
    const targetPath = backupPath || defaultBackupPath;
    
    await fs.copyFile(this.filePath, targetPath);
    
    this.logger.info(`Created backup: ${targetPath}`);
    return targetPath;
  }

  async restoreFromBackup(backupPath) {
    if (!await this._fileExists(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }
    
    await fs.copyFile(backupPath, this.filePath);
    await this._loadData();
    
    this.logger.info(`Restored from backup: ${backupPath}`);
  }

  /**
   * Export/Import operations
   */
  async exportData() {
    this._ensureInitialized();
    return {
      entities: [...this.data.entities],
      relations: [...this.data.relations],
      metadata: { ...this.data.metadata }
    };
  }

  async importData(importData, merge = false) {
    this._ensureInitialized();
    
    if (!merge) {
      this.data = {
        entities: [...importData.entities],
        relations: [...importData.relations],
        metadata: { ...importData.metadata }
      };
    } else {
      // Merge entities (keep existing, add new)
      for (const entity of importData.entities) {
        if (!this.data.entities.find(e => e.name === entity.name)) {
          this.data.entities.push(entity);
        }
      }
      
      // Merge relations (keep existing, add new)
      for (const relation of importData.relations) {
        if (!this.data.relations.find(r => 
          r.from === relation.from && 
          r.to === relation.to && 
          r.relationType === relation.relationType
        )) {
          this.data.relations.push(relation);
        }
      }
    }
    
    await this._saveData();
    this.logger.info(`Imported data (merge: ${merge})`);
  }

  /**
   * Statistics
   */
  async getStatistics() {
    this._ensureInitialized();
    
    const entityTypes = {};
    const relationTypes = {};
    let totalObservations = 0;
    
    for (const entity of this.data.entities) {
      entityTypes[entity.entityType] = (entityTypes[entity.entityType] || 0) + 1;
      totalObservations += (entity.observations || []).length;
    }
    
    for (const relation of this.data.relations) {
      relationTypes[relation.relationType] = (relationTypes[relation.relationType] || 0) + 1;
    }
    
    return {
      entities: {
        total: this.data.entities.length,
        types: entityTypes
      },
      relations: {
        total: this.data.relations.length,
        types: relationTypes
      },
      observations: {
        total: totalObservations
      },
      lastUpdated: this.data.metadata.last_updated
    };
  }

  /**
   * Close storage
   */
  async close() {
    if (this.initialized) {
      await this._saveData();
      this.logger.debug('Storage closed');
    }
  }

  // Private methods

  _ensureInitialized() {
    if (!this.initialized) {
      throw new Error('Storage not initialized. Call initialize() first.');
    }
  }

  async _ensureDirectoryExists() {
    const dir = path.dirname(this.filePath);
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  async _fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async _loadData() {
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(content);
      
      this.data = {
        entities: parsed.entities || [],
        relations: parsed.relations || [],
        metadata: parsed.metadata || {}
      };
      
      // Migration: ensure all entities have IDs
      for (const entity of this.data.entities) {
        if (!entity.id) {
          entity.id = this._generateId();
        }
      }
      
      // Migration: ensure all relations have IDs
      for (const relation of this.data.relations) {
        if (!relation.id) {
          relation.id = this._generateId();
        }
      }
      
    } catch (error) {
      this.logger.error(`Failed to load data from ${this.filePath}: ${error.message}`);
      throw error;
    }
  }

  async _saveData() {
    try {
      this.data.metadata.last_updated = new Date().toISOString();
      
      const content = JSON.stringify(this.data, null, 2);
      await fs.writeFile(this.filePath, content, 'utf8');
      
    } catch (error) {
      this.logger.error(`Failed to save data to ${this.filePath}: ${error.message}`);
      throw error;
    }
  }

  async _createEmptyFile() {
    this.data = {
      entities: [],
      relations: [],
      metadata: {
        created: new Date().toISOString(),
        version: '2.0.0',
        schema_version: '2.0.0'
      }
    };
    await this._saveData();
  }

  _generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}