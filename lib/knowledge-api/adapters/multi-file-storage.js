/**
 * Multi-File Storage Adapter - Team-aware JSON file backend for knowledge storage
 * 
 * Supports loading from multiple files based on team configuration
 * and maintains entity origin tracking for proper sync back.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { FileStorageAdapter } from './file-storage.js';

export class MultiFileStorageAdapter extends FileStorageAdapter {
  constructor(config, logger) {
    super(config, logger);
    
    // Team configuration
    this.team = config.team || process.env.CODING_TEAM || 'default';
    this.teamFilePath = this._getTeamFilePath();
    this.codingFilePath = path.resolve(config.codingPath || './shared-memory-coding.json');
    
    // Track entity/relation origins
    this.entityOrigins = new Map(); // entityId -> filePath
    this.relationOrigins = new Map(); // relationId -> filePath
    
    // Multiple data sources
    this.teamData = { entities: [], relations: [], metadata: {} };
    this.codingData = { entities: [], relations: [], metadata: {} };
    
    this.logger.info(`Multi-file storage initialized for team: ${this.team}`);
  }

  /**
   * Get team-specific file path
   */
  _getTeamFilePath() {
    if (this.team === 'default') {
      return this.filePath; // Use standard shared-memory.json
    }
    
    // Team-specific file: shared-memory-<team>.json
    const dir = path.dirname(this.filePath);
    const filename = `shared-memory-${this.team.toLowerCase()}.json`;
    return path.join(dir, filename);
  }

  /**
   * Initialize storage - load from multiple files
   */
  async initialize() {
    try {
      await this._ensureDirectoryExists();
      
      // Load team-specific file
      if (this.team !== 'default' && await this._fileExists(this.teamFilePath)) {
        await this._loadTeamData();
        this.logger.info(`Loaded team knowledge base from: ${this.teamFilePath}`);
      } else if (this.team === 'default' && await this._fileExists(this.filePath)) {
        // Load default file for backward compatibility
        await this._loadData();
        this.logger.info(`Loaded default knowledge base from: ${this.filePath}`);
      } else if (this.team !== 'default') {
        // Create empty team file
        await this._createEmptyTeamFile();
        this.logger.info(`Created new team knowledge base: ${this.teamFilePath}`);
      }
      
      // Always load coding knowledge base if it exists
      if (await this._fileExists(this.codingFilePath)) {
        await this._loadCodingData();
        this.logger.info(`Loaded coding knowledge base from: ${this.codingFilePath}`);
      }
      
      // Merge data sources
      this._mergeDataSources();
      
      this.initialized = true;
    } catch (error) {
      this.logger.error(`Failed to initialize multi-file storage: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get storage information
   */
  getInfo() {
    const info = super.getInfo();
    return {
      ...info,
      team: this.team,
      files: {
        team: this.teamFilePath,
        coding: this.codingFilePath,
        default: this.filePath
      },
      entityOrigins: {
        team: Array.from(this.entityOrigins.values()).filter(p => p === this.teamFilePath).length,
        coding: Array.from(this.entityOrigins.values()).filter(p => p === this.codingFilePath).length,
        default: Array.from(this.entityOrigins.values()).filter(p => p === this.filePath).length
      }
    };
  }

  /**
   * Add entity with origin tracking
   */
  async addEntity(entity) {
    this._ensureInitialized();
    
    // Check for duplicate names across all sources
    const existingIndex = this.data.entities.findIndex(e => e.name === entity.name);
    if (existingIndex !== -1) {
      throw new Error(`Entity with name '${entity.name}' already exists`);
    }
    
    // Determine target file based on entity metadata or default to team file
    const targetFile = entity.metadata?.team === 'coding' 
      ? this.codingFilePath 
      : (this.team === 'default' ? this.filePath : this.teamFilePath);
    
    // Add to appropriate data source
    if (targetFile === this.codingFilePath) {
      this.codingData.entities.push(entity);
    } else if (targetFile === this.teamFilePath) {
      this.teamData.entities.push(entity);
    } else {
      // Default file (backward compatibility)
      this.data.entities.push(entity);
    }
    
    // Track origin
    this.entityOrigins.set(entity.id || entity.name, targetFile);
    
    // Update merged data
    this._mergeDataSources();
    
    // Save to appropriate file
    await this._saveToFile(targetFile);
    
    this.logger.debug(`Added entity '${entity.name}' to ${path.basename(targetFile)}`);
  }

  /**
   * Update entity - save back to origin file
   */
  async updateEntity(nameOrId, updatedEntity) {
    this._ensureInitialized();
    
    const index = this.data.entities.findIndex(e => 
      e.name === nameOrId || e.id === nameOrId
    );
    
    if (index === -1) {
      throw new Error(`Entity not found: ${nameOrId}`);
    }
    
    // Get origin file
    const originFile = this.entityOrigins.get(nameOrId) || this.entityOrigins.get(this.data.entities[index].id);
    
    // Update in appropriate data source
    if (originFile === this.codingFilePath) {
      const codingIndex = this.codingData.entities.findIndex(e => 
        e.name === nameOrId || e.id === nameOrId
      );
      if (codingIndex !== -1) {
        this.codingData.entities[codingIndex] = updatedEntity;
      }
    } else if (originFile === this.teamFilePath) {
      const teamIndex = this.teamData.entities.findIndex(e => 
        e.name === nameOrId || e.id === nameOrId
      );
      if (teamIndex !== -1) {
        this.teamData.entities[teamIndex] = updatedEntity;
      }
    }
    
    // Update merged data
    this._mergeDataSources();
    
    // Save to origin file
    if (originFile) {
      await this._saveToFile(originFile);
    } else {
      throw new Error(`Cannot update entity '${updatedEntity.name}': origin file not tracked. This indicates a bug in entity origin tracking.`);
    }
    
    this.logger.debug(`Updated entity '${updatedEntity.name}' in ${originFile ? path.basename(originFile) : 'default'}`);
  }

  /**
   * Add relation with origin tracking
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
    
    // Determine target file based on entities involved
    const fromOrigin = this.entityOrigins.get(relation.from);
    const toOrigin = this.entityOrigins.get(relation.to);
    
    let targetFile;
    if (fromOrigin === this.codingFilePath || toOrigin === this.codingFilePath) {
      // If either entity is in coding file, put relation there
      targetFile = this.codingFilePath;
    } else if (fromOrigin === this.teamFilePath || toOrigin === this.teamFilePath) {
      // If either entity is in team file, put relation there
      targetFile = this.teamFilePath;
    } else {
      // Default to team file or default file
      targetFile = this.team === 'default' ? this.filePath : this.teamFilePath;
    }
    
    // Add to appropriate data source
    if (targetFile === this.codingFilePath) {
      this.codingData.relations.push(relation);
    } else if (targetFile === this.teamFilePath) {
      this.teamData.relations.push(relation);
    } else {
      this.data.relations.push(relation);
    }
    
    // Track origin
    this.relationOrigins.set(relation.id, targetFile);
    
    // Update merged data
    this._mergeDataSources();
    
    // Save to appropriate file
    await this._saveToFile(targetFile);
    
    this.logger.debug(`Added relation to ${path.basename(targetFile)}`);
  }

  /**
   * Search across all data sources
   */
  async searchEntities(query, options = {}) {
    this._ensureInitialized();
    
    const results = [];
    const searchTerm = query.toLowerCase();
    
    for (const entity of this.data.entities) {
      if (entity.name.toLowerCase().includes(searchTerm) ||
          entity.entityType.toLowerCase().includes(searchTerm) ||
          (entity.observations || []).some(obs => 
            (typeof obs === 'string' ? obs : obs.content || '').toLowerCase().includes(searchTerm)
          )) {
        // Add source information
        const origin = this.entityOrigins.get(entity.id || entity.name);
        const source = this._getSourceName(origin);
        
        results.push({
          ...entity,
          _source: source,
          _team: source === 'team' ? this.team : source
        });
      }
    }
    
    return results;
  }

  /**
   * Get statistics with team breakdown
   */
  async getStatistics() {
    const stats = await super.getStatistics();
    
    // Add team-specific breakdown
    const teamBreakdown = {
      coding: { entities: 0, relations: 0 },
      team: { entities: 0, relations: 0 },
      default: { entities: 0, relations: 0 }
    };
    
    // Count entities by source
    for (const [id, origin] of this.entityOrigins) {
      const source = this._getSourceName(origin);
      if (teamBreakdown[source]) {
        teamBreakdown[source].entities++;
      }
    }
    
    // Count relations by source
    for (const [id, origin] of this.relationOrigins) {
      const source = this._getSourceName(origin);
      if (teamBreakdown[source]) {
        teamBreakdown[source].relations++;
      }
    }
    
    return {
      ...stats,
      team: this.team,
      breakdown: teamBreakdown
    };
  }

  // Private methods

  async _loadTeamData() {
    try {
      const content = await fs.readFile(this.teamFilePath, 'utf8');
      const parsed = JSON.parse(content);
      
      this.teamData = {
        entities: parsed.entities || [],
        relations: parsed.relations || [],
        metadata: parsed.metadata || {}
      };
      
      // Track origins
      for (const entity of this.teamData.entities) {
        if (!entity.id) entity.id = this._generateId();
        this.entityOrigins.set(entity.id, this.teamFilePath);
        this.entityOrigins.set(entity.name, this.teamFilePath);
      }
      
      for (const relation of this.teamData.relations) {
        if (!relation.id) relation.id = this._generateId();
        this.relationOrigins.set(relation.id, this.teamFilePath);
      }
      
    } catch (error) {
      this.logger.error(`Failed to load team data from ${this.teamFilePath}: ${error.message}`);
      throw error;
    }
  }

  async _loadCodingData() {
    try {
      const content = await fs.readFile(this.codingFilePath, 'utf8');
      const parsed = JSON.parse(content);
      
      this.codingData = {
        entities: parsed.entities || [],
        relations: parsed.relations || [],
        metadata: parsed.metadata || {}
      };
      
      // Track origins
      for (const entity of this.codingData.entities) {
        if (!entity.id) entity.id = this._generateId();
        this.entityOrigins.set(entity.id, this.codingFilePath);
        this.entityOrigins.set(entity.name, this.codingFilePath);
      }
      
      for (const relation of this.codingData.relations) {
        if (!relation.id) relation.id = this._generateId();
        this.relationOrigins.set(relation.id, this.codingFilePath);
      }
      
    } catch (error) {
      this.logger.error(`Failed to load coding data from ${this.codingFilePath}: ${error.message}`);
      throw error;
    }
  }

  _mergeDataSources() {
    // Merge entities
    const mergedEntities = [];
    const seenNames = new Set();
    
    // Add coding entities first (highest priority)
    for (const entity of this.codingData.entities) {
      if (!seenNames.has(entity.name)) {
        mergedEntities.push(entity);
        seenNames.add(entity.name);
      }
    }
    
    // Add team entities
    for (const entity of this.teamData.entities) {
      if (!seenNames.has(entity.name)) {
        mergedEntities.push(entity);
        seenNames.add(entity.name);
      }
    }
    
    // Add default entities (for backward compatibility)
    if (this.team === 'default') {
      for (const entity of this.data.entities) {
        if (!seenNames.has(entity.name)) {
          mergedEntities.push(entity);
          seenNames.add(entity.name);
        }
      }
    }
    
    // Merge relations
    const mergedRelations = [];
    const seenRelations = new Set();
    
    const relationKey = (r) => `${r.from}-${r.relationType}-${r.to}`;
    
    // Add all relations, avoiding duplicates
    const allRelations = [
      ...this.codingData.relations,
      ...this.teamData.relations,
      ...(this.team === 'default' ? this.data.relations : [])
    ];
    
    for (const relation of allRelations) {
      const key = relationKey(relation);
      if (!seenRelations.has(key)) {
        mergedRelations.push(relation);
        seenRelations.add(key);
      }
    }
    
    // Update main data with merged results
    this.data.entities = mergedEntities;
    this.data.relations = mergedRelations;
  }

  async _saveToFile(filePath) {
    let dataToSave;
    
    if (filePath === this.codingFilePath) {
      dataToSave = this.codingData;
    } else if (filePath === this.teamFilePath) {
      dataToSave = this.teamData;
    } else {
      dataToSave = this.data;
    }
    
    try {
      dataToSave.metadata.last_updated = new Date().toISOString();
      dataToSave.metadata.team = this.team;
      
      const content = JSON.stringify(dataToSave, null, 2);
      await fs.writeFile(filePath, content, 'utf8');
      
    } catch (error) {
      this.logger.error(`Failed to save data to ${filePath}: ${error.message}`);
      throw error;
    }
  }

  async _createEmptyTeamFile() {
    this.teamData = {
      entities: [],
      relations: [],
      metadata: {
        created: new Date().toISOString(),
        version: '2.0.0',
        schema_version: '2.0.0',
        team: this.team
      }
    };
    await this._saveToFile(this.teamFilePath);
  }

  _getSourceName(filePath) {
    if (!filePath) return 'default';
    if (filePath === this.codingFilePath) return 'coding';
    if (filePath === this.teamFilePath) return 'team';
    return 'default';
  }
}

export default MultiFileStorageAdapter;