/**
 * Knowledge API
 * Interface to the knowledge management system
 */

import { promises as fs } from 'fs';
import path from 'path';
import { Logger } from '../../../shared/logger.js';

export class KnowledgeAPI {
  constructor(config = {}) {
    this.config = {
      sharedMemoryPath: config.sharedMemoryPath || process.env.CODING_TOOLS_PATH + '/shared-memory.json',
      backupEnabled: config.backupEnabled !== false,
      backupPath: config.backupPath || process.env.CODING_TOOLS_PATH + '/.backups',
      autoSave: config.autoSave !== false,
      ...config
    };
    
    this.logger = new Logger('knowledge-api');
    this.knowledgeData = null;
    this.lastModified = null;
    
    this.initializeKnowledgeData();
  }

  async initializeKnowledgeData() {
    try {
      await this.loadKnowledgeData();
      this.logger.info('Knowledge API initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize knowledge data:', error);
      await this.createEmptyKnowledgeBase();
    }
  }

  async loadKnowledgeData() {
    try {
      const stats = await fs.stat(this.config.sharedMemoryPath);
      
      // Check if file has been modified since last load
      if (this.lastModified && stats.mtime <= this.lastModified) {
        return this.knowledgeData;
      }
      
      const data = await fs.readFile(this.config.sharedMemoryPath, 'utf8');
      this.knowledgeData = JSON.parse(data);
      this.lastModified = stats.mtime;
      
      // Validate structure
      if (!this.knowledgeData.entities) {
        this.knowledgeData.entities = [];
      }
      if (!this.knowledgeData.relations) {
        this.knowledgeData.relations = [];
      }
      if (!this.knowledgeData.metadata) {
        this.knowledgeData.metadata = { version: '1.0.0' };
      }
      
      this.logger.debug(`Loaded knowledge data: ${this.knowledgeData.entities.length} entities, ${this.knowledgeData.relations.length} relations`);
      
      return this.knowledgeData;
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        await this.createEmptyKnowledgeBase();
        return this.knowledgeData;
      }
      throw error;
    }
  }

  async saveKnowledgeData() {
    try {
      // Create backup if enabled
      if (this.config.backupEnabled) {
        await this.createBackup();
      }
      
      // Update metadata
      this.knowledgeData.metadata.lastModified = new Date().toISOString();
      this.knowledgeData.metadata.entityCount = this.knowledgeData.entities.length;
      this.knowledgeData.metadata.relationCount = this.knowledgeData.relations.length;
      
      // Write to file
      const dataString = JSON.stringify(this.knowledgeData, null, 2);
      await fs.writeFile(this.config.sharedMemoryPath, dataString, 'utf8');
      
      this.lastModified = new Date();
      this.logger.debug('Knowledge data saved successfully');
      
    } catch (error) {
      this.logger.error('Failed to save knowledge data:', error);
      throw error;
    }
  }

  async createEmptyKnowledgeBase() {
    this.knowledgeData = {
      entities: [],
      relations: [],
      metadata: {
        version: '1.0.0',
        created: new Date().toISOString(),
        entityCount: 0,
        relationCount: 0
      }
    };
    
    await this.saveKnowledgeData();
    this.logger.info('Created empty knowledge base');
  }

  async createBackup() {
    try {
      if (!this.knowledgeData) return;
      
      const backupDir = this.config.backupPath;
      await fs.mkdir(backupDir, { recursive: true });
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(backupDir, `shared-memory-${timestamp}.json`);
      
      const dataString = JSON.stringify(this.knowledgeData, null, 2);
      await fs.writeFile(backupFile, dataString, 'utf8');
      
      this.logger.debug(`Backup created: ${backupFile}`);
      
      // Clean old backups (keep last 10)
      await this.cleanOldBackups(backupDir);
      
    } catch (error) {
      this.logger.warn('Failed to create backup:', error.message);
    }
  }

  async cleanOldBackups(backupDir) {
    try {
      const files = await fs.readdir(backupDir);
      const backupFiles = files
        .filter(file => file.startsWith('shared-memory-') && file.endsWith('.json'))
        .map(file => ({
          name: file,
          path: path.join(backupDir, file)
        }));
      
      if (backupFiles.length > 10) {
        // Sort by name (timestamp) and remove oldest
        backupFiles.sort((a, b) => a.name.localeCompare(b.name));
        
        for (let i = 0; i < backupFiles.length - 10; i++) {
          await fs.unlink(backupFiles[i].path);
          this.logger.debug(`Deleted old backup: ${backupFiles[i].name}`);
        }
      }
    } catch (error) {
      this.logger.debug('Failed to clean old backups:', error.message);
    }
  }

  async createEntity(entityData) {
    await this.loadKnowledgeData();
    
    // Generate ID if not provided
    const entity = {
      id: entityData.id || this.generateEntityId(),
      name: entityData.name,
      entityType: entityData.entityType,
      significance: entityData.significance || 5,
      observations: entityData.observations || [],
      metadata: {
        created: new Date().toISOString(),
        ...entityData.metadata
      }
    };
    
    // Check for duplicates
    const existing = this.knowledgeData.entities.find(e => 
      e.name === entity.name && e.entityType === entity.entityType
    );
    
    if (existing) {
      // Update existing entity instead of creating duplicate
      return await this.updateEntity(existing.id, {
        significance: Math.max(existing.significance, entity.significance),
        observations: [...new Set([...existing.observations, ...entity.observations])],
        metadata: { ...existing.metadata, ...entity.metadata }
      });
    }
    
    this.knowledgeData.entities.push(entity);
    
    if (this.config.autoSave) {
      await this.saveKnowledgeData();
    }
    
    this.logger.debug(`Created entity: ${entity.name} (${entity.entityType})`);
    return entity;
  }

  async updateEntity(entityId, updates) {
    await this.loadKnowledgeData();
    
    const entityIndex = this.knowledgeData.entities.findIndex(e => e.id === entityId);
    
    if (entityIndex === -1) {
      throw new Error(`Entity not found: ${entityId}`);
    }
    
    const entity = this.knowledgeData.entities[entityIndex];
    
    // Merge updates
    Object.assign(entity, updates);
    entity.metadata.lastModified = new Date().toISOString();
    
    if (this.config.autoSave) {
      await this.saveKnowledgeData();
    }
    
    this.logger.debug(`Updated entity: ${entity.name}`);
    return entity;
  }

  async getEntity(entityId) {
    await this.loadKnowledgeData();
    
    return this.knowledgeData.entities.find(e => e.id === entityId);
  }

  async searchEntities(query, filters = {}) {
    await this.loadKnowledgeData();
    
    let results = [...this.knowledgeData.entities];
    
    // Text search
    if (query) {
      const searchTerms = query.toLowerCase().split(/\s+/);
      results = results.filter(entity => {
        const searchText = `${entity.name} ${entity.entityType} ${entity.observations.join(' ')}`.toLowerCase();
        return searchTerms.some(term => searchText.includes(term));
      });
    }
    
    // Apply filters
    if (filters.entityType) {
      results = results.filter(e => e.entityType === filters.entityType);
    }
    
    if (filters.minSignificance !== undefined) {
      results = results.filter(e => e.significance >= filters.minSignificance);
    }
    
    if (filters.maxResults) {
      results = results.slice(0, filters.maxResults);
    }
    
    // Sort by significance
    results.sort((a, b) => b.significance - a.significance);
    
    return results;
  }

  async createRelation(relationData) {
    await this.loadKnowledgeData();
    
    const relation = {
      id: relationData.id || this.generateRelationId(),
      from: relationData.from,
      to: relationData.to,
      relationType: relationData.relationType,
      metadata: {
        created: new Date().toISOString(),
        ...relationData.metadata
      }
    };
    
    // Check for duplicates
    const existing = this.knowledgeData.relations.find(r =>
      r.from === relation.from && 
      r.to === relation.to && 
      r.relationType === relation.relationType
    );
    
    if (existing) {
      this.logger.debug(`Relation already exists: ${relation.from} -> ${relation.to} (${relation.relationType})`);
      return existing;
    }
    
    this.knowledgeData.relations.push(relation);
    
    if (this.config.autoSave) {
      await this.saveKnowledgeData();
    }
    
    this.logger.debug(`Created relation: ${relation.from} -> ${relation.to} (${relation.relationType})`);
    return relation;
  }

  async getRelations(entityId, options = {}) {
    await this.loadKnowledgeData();
    
    let relations = this.knowledgeData.relations;
    
    // Filter by entity
    if (options.direction === 'outgoing') {
      relations = relations.filter(r => r.from === entityId);
    } else if (options.direction === 'incoming') {
      relations = relations.filter(r => r.to === entityId);
    } else {
      relations = relations.filter(r => r.from === entityId || r.to === entityId);
    }
    
    // Filter by relation type
    if (options.relationType) {
      relations = relations.filter(r => r.relationType === options.relationType);
    }
    
    return relations;
  }

  async exportGraph(format = 'json', filters = {}) {
    await this.loadKnowledgeData();
    
    let entities = [...this.knowledgeData.entities];
    let relations = [...this.knowledgeData.relations];
    
    // Apply filters
    if (filters.entityTypes) {
      entities = entities.filter(e => filters.entityTypes.includes(e.entityType));
    }
    
    if (filters.minSignificance) {
      entities = entities.filter(e => e.significance >= filters.minSignificance);
    }
    
    const exportData = {
      entities,
      relations: relations.filter(r => 
        entities.some(e => e.id === r.from) && 
        entities.some(e => e.id === r.to)
      ),
      metadata: {
        ...this.knowledgeData.metadata,
        exportedAt: new Date().toISOString(),
        format,
        filters
      }
    };
    
    switch (format) {
      case 'json':
        return exportData;
      case 'cypher':
        return this.convertToCypher(exportData);
      case 'graphml':
        return this.convertToGraphML(exportData);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  async importGraph(format, data, options = {}) {
    const importResult = {
      entitiesImported: 0,
      relationsImported: 0,
      errors: []
    };
    
    try {
      let importData;
      
      switch (format) {
        case 'json':
          importData = typeof data === 'string' ? JSON.parse(data) : data;
          break;
        default:
          throw new Error(`Unsupported import format: ${format}`);
      }
      
      // Import entities
      if (importData.entities) {
        for (const entityData of importData.entities) {
          try {
            await this.createEntity(entityData);
            importResult.entitiesImported++;
          } catch (error) {
            importResult.errors.push(`Entity import failed: ${error.message}`);
          }
        }
      }
      
      // Import relations
      if (importData.relations) {
        for (const relationData of importData.relations) {
          try {
            await this.createRelation(relationData);
            importResult.relationsImported++;
          } catch (error) {
            importResult.errors.push(`Relation import failed: ${error.message}`);
          }
        }
      }
      
      if (this.config.autoSave) {
        await this.saveKnowledgeData();
      }
      
    } catch (error) {
      importResult.errors.push(`Import failed: ${error.message}`);
    }
    
    return importResult;
  }

  convertToCypher(data) {
    const statements = [];
    
    // Create entities
    for (const entity of data.entities) {
      const props = {
        name: entity.name,
        significance: entity.significance,
        ...entity.metadata
      };
      
      const propsStr = Object.entries(props)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join(', ');
      
      statements.push(`CREATE (n:${entity.entityType} {${propsStr}})`);
    }
    
    // Create relations
    for (const relation of data.relations) {
      statements.push(
        `MATCH (a {name: ${JSON.stringify(relation.from)}}), (b {name: ${JSON.stringify(relation.to)}}) ` +
        `CREATE (a)-[:${relation.relationType}]->(b)`
      );
    }
    
    return statements.join(';\n') + ';';
  }

  convertToGraphML(data) {
    // Basic GraphML conversion - in production, use a proper GraphML library
    const nodes = data.entities.map(e => 
      `<node id="${e.id}"><data key="name">${e.name}</data><data key="type">${e.entityType}</data></node>`
    ).join('\n    ');
    
    const edges = data.relations.map(r => 
      `<edge source="${r.from}" target="${r.to}"><data key="type">${r.relationType}</data></edge>`
    ).join('\n    ');
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="name" for="node" attr.name="name" attr.type="string"/>
  <key id="type" for="node" attr.name="type" attr.type="string"/>
  <key id="type" for="edge" attr.name="type" attr.type="string"/>
  <graph id="knowledge-graph" edgedefault="directed">
    ${nodes}
    ${edges}
  </graph>
</graphml>`;
  }

  generateEntityId() {
    return `entity_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  generateRelationId() {
    return `relation_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  getInfo() {
    return {
      sharedMemoryPath: this.config.sharedMemoryPath,
      entitiesCount: this.knowledgeData?.entities?.length || 0,
      relationsCount: this.knowledgeData?.relations?.length || 0,
      lastModified: this.lastModified,
      capabilities: this.getCapabilities()
    };
  }

  getCapabilities() {
    return [
      'entity-crud',
      'relation-crud',
      'graph-search',
      'import-export',
      'backup-restore',
      'format-conversion'
    ];
  }
}