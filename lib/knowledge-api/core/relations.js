/**
 * Relation Manager - Manages relationships between entities
 */

import { v4 as uuidv4 } from 'uuid';

export class RelationManager {
  constructor(storage, validation, logger) {
    this.storage = storage;
    this.validation = validation;
    this.logger = logger;
  }

  /**
   * Create a new relation
   */
  async create(relationData) {
    // Validate input
    const validation = await this.validation.validateRelation(relationData);
    if (!validation.valid) {
      throw new Error(`Invalid relation data: ${validation.errors.join(', ')}`);
    }

    // Verify entities exist
    const entities = await this.storage.getEntities();
    const fromEntity = entities.find(e => e.name === relationData.from);
    const toEntity = entities.find(e => e.name === relationData.to);
    
    if (!fromEntity) {
      throw new Error(`Source entity not found: ${relationData.from}`);
    }
    if (!toEntity) {
      throw new Error(`Target entity not found: ${relationData.to}`);
    }

    // Create relation with metadata
    const relation = {
      id: uuidv4(),
      from: relationData.from,
      to: relationData.to,
      relationType: relationData.relationType,
      significance: relationData.significance || 5,
      created: new Date().toISOString(),
      metadata: {
        created_by: 'knowledge-api',
        ...relationData.metadata
      }
    };

    // Check for duplicates
    const existing = await this.findRelation(relation.from, relation.to, relation.relationType);
    if (existing) {
      throw new Error(`Relation already exists: ${relation.from} -[${relation.relationType}]-> ${relation.to}`);
    }

    // Store relation
    await this.storage.addRelation(relation);
    
    this.logger.info(`Created relation: ${relation.from} -[${relation.relationType}]-> ${relation.to}`);
    return relation;
  }

  /**
   * Find specific relation
   */
  async findRelation(from, to, relationType = null) {
    const relations = await this.storage.getRelations();
    return relations.find(r => 
      r.from === from && 
      r.to === to && 
      (relationType === null || r.relationType === relationType)
    );
  }

  /**
   * Find relation by ID
   */
  async findById(id) {
    const relations = await this.storage.getRelations();
    return relations.find(r => r.id === id);
  }

  /**
   * Get all relations
   */
  async getAll(filters = {}) {
    let relations = await this.storage.getRelations();
    
    // Apply filters
    if (filters.from) {
      relations = relations.filter(r => r.from === filters.from);
    }
    
    if (filters.to) {
      relations = relations.filter(r => r.to === filters.to);
    }
    
    if (filters.relationType) {
      relations = relations.filter(r => r.relationType === filters.relationType);
    }
    
    if (filters.minSignificance) {
      relations = relations.filter(r => (r.significance || 5) >= filters.minSignificance);
    }
    
    if (filters.entity) {
      relations = relations.filter(r => r.from === filters.entity || r.to === filters.entity);
    }

    // Sort by significance (descending) then by creation date
    relations.sort((a, b) => {
      const sigA = a.significance || 5;
      const sigB = b.significance || 5;
      if (sigA !== sigB) return sigB - sigA;
      return new Date(b.created) - new Date(a.created);
    });

    return relations;
  }

  /**
   * Get relations for a specific entity
   */
  async getForEntity(entityName, direction = 'both') {
    const relations = await this.storage.getRelations();
    
    switch (direction) {
      case 'outgoing':
        return relations.filter(r => r.from === entityName);
      case 'incoming':
        return relations.filter(r => r.to === entityName);
      case 'both':
      default:
        return relations.filter(r => r.from === entityName || r.to === entityName);
    }
  }

  /**
   * Update a relation
   */
  async update(relationId, updates) {
    const relation = await this.findById(relationId);
    if (!relation) {
      throw new Error(`Relation not found: ${relationId}`);
    }

    // Validate updates
    const updatedRelation = { ...relation, ...updates };
    const validation = await this.validation.validateRelation(updatedRelation);
    if (!validation.valid) {
      throw new Error(`Invalid relation updates: ${validation.errors.join(', ')}`);
    }

    // If entities changed, verify they exist
    if (updates.from || updates.to) {
      const entities = await this.storage.getEntities();
      const from = updates.from || relation.from;
      const to = updates.to || relation.to;
      
      if (!entities.find(e => e.name === from)) {
        throw new Error(`Source entity not found: ${from}`);
      }
      if (!entities.find(e => e.name === to)) {
        throw new Error(`Target entity not found: ${to}`);
      }
    }

    await this.storage.updateRelation(relationId, updatedRelation);
    
    this.logger.info(`Updated relation: ${relationId}`);
    return updatedRelation;
  }

  /**
   * Delete a relation
   */
  async delete(relationId) {
    const relation = await this.findById(relationId);
    if (!relation) {
      throw new Error(`Relation not found: ${relationId}`);
    }

    await this.storage.removeRelation(relationId);
    
    this.logger.info(`Deleted relation: ${relation.from} -[${relation.relationType}]-> ${relation.to}`);
    return true;
  }

  /**
   * Delete relations by criteria
   */
  async deleteByCriteria(criteria) {
    const relations = await this.getAll(criteria);
    let deletedCount = 0;
    
    for (const relation of relations) {
      await this.delete(relation.id);
      deletedCount++;
    }
    
    this.logger.info(`Deleted ${deletedCount} relations matching criteria`);
    return deletedCount;
  }

  /**
   * Get relation count
   */
  async count() {
    const relations = await this.storage.getRelations();
    return relations.length;
  }

  /**
   * Get relation types
   */
  async getRelationTypes() {
    const relations = await this.storage.getRelations();
    const types = [...new Set(relations.map(r => r.relationType))];
    return types.sort();
  }

  /**
   * Get connected entities (graph traversal)
   */
  async getConnectedEntities(entityName, maxDepth = 2, visitedEntities = new Set()) {
    if (maxDepth <= 0 || visitedEntities.has(entityName)) {
      return [];
    }
    
    visitedEntities.add(entityName);
    const connectedEntities = [];
    
    // Get direct connections
    const relations = await this.getForEntity(entityName);
    
    for (const relation of relations) {
      const connectedEntity = relation.from === entityName ? relation.to : relation.from;
      
      if (!visitedEntities.has(connectedEntity)) {
        connectedEntities.push({
          entity: connectedEntity,
          relation: relation,
          depth: maxDepth
        });
        
        // Recursive traversal
        if (maxDepth > 1) {
          const deeperConnections = await this.getConnectedEntities(
            connectedEntity, 
            maxDepth - 1, 
            new Set(visitedEntities)
          );
          connectedEntities.push(...deeperConnections);
        }
      }
    }
    
    return connectedEntities;
  }

  /**
   * Find shortest path between entities
   */
  async findPath(fromEntity, toEntity, maxDepth = 5) {
    if (fromEntity === toEntity) {
      return [fromEntity];
    }
    
    const queue = [[fromEntity]];
    const visited = new Set([fromEntity]);
    
    while (queue.length > 0 && queue[0].length <= maxDepth) {
      const path = queue.shift();
      const currentEntity = path[path.length - 1];
      
      const relations = await this.getForEntity(currentEntity);
      
      for (const relation of relations) {
        const nextEntity = relation.from === currentEntity ? relation.to : relation.from;
        
        if (nextEntity === toEntity) {
          return [...path, nextEntity];
        }
        
        if (!visited.has(nextEntity)) {
          visited.add(nextEntity);
          queue.push([...path, nextEntity]);
        }
      }
    }
    
    return null; // No path found
  }

  /**
   * Get entity clusters/communities
   */
  async getClusters(minClusterSize = 2) {
    const entities = await this.storage.getEntities();
    const relations = await this.storage.getRelations();
    
    const entitySet = new Set(entities.map(e => e.name));
    const clusters = [];
    const visited = new Set();
    
    // Simple connected components algorithm
    for (const entity of entitySet) {
      if (!visited.has(entity)) {
        const cluster = await this._getConnectedComponent(entity, relations, visited);
        if (cluster.length >= minClusterSize) {
          clusters.push(cluster);
        }
      }
    }
    
    return clusters.sort((a, b) => b.length - a.length);
  }

  /**
   * Helper method for cluster detection
   */
  async _getConnectedComponent(startEntity, relations, visited) {
    const component = [];
    const stack = [startEntity];
    
    while (stack.length > 0) {
      const entity = stack.pop();
      
      if (!visited.has(entity)) {
        visited.add(entity);
        component.push(entity);
        
        // Find connected entities
        const connectedRelations = relations.filter(r => 
          r.from === entity || r.to === entity
        );
        
        for (const relation of connectedRelations) {
          const connectedEntity = relation.from === entity ? relation.to : relation.from;
          if (!visited.has(connectedEntity)) {
            stack.push(connectedEntity);
          }
        }
      }
    }
    
    return component;
  }

  /**
   * Update entity references in relations (for entity renames)
   */
  async updateEntityReferences(oldName, newName) {
    const relations = await this.storage.getRelations();
    let updatedCount = 0;
    
    for (const relation of relations) {
      let needsUpdate = false;
      const updates = {};
      
      if (relation.from === oldName) {
        updates.from = newName;
        needsUpdate = true;
      }
      
      if (relation.to === oldName) {
        updates.to = newName;
        needsUpdate = true;
      }
      
      if (needsUpdate) {
        await this.update(relation.id, updates);
        updatedCount++;
      }
    }
    
    this.logger.info(`Updated ${updatedCount} relation references: ${oldName} -> ${newName}`);
    return updatedCount;
  }
}