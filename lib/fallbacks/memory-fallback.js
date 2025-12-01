import path from 'path';
import fs from 'fs/promises';
import Graph from 'graphology';
import graphologyUtils from 'graphology-utils';
const { subgraph } = graphologyUtils;

class MemoryFallbackService {
  constructor(config = {}) {
    this.dbPath = config.dbPath || path.join(process.cwd(), '.coding-tools', 'memory.json');
    // Use knowledge export path instead of deprecated shared-memory path
    this.knowledgeExportDir = config.knowledgeExportPath || path.join(process.cwd(), '.data', 'knowledge-export');
    this.graph = new Graph({ multi: true }); // Allow multiple edges between nodes
    this.initialized = false;
    this.syncInterval = null;
    this.lastSync = 0;
    this.syncThrottleMs = 5000; // Minimum 5 seconds between syncs
    this.pendingSync = false;

    // Disable automatic sync - will be handled by unified SynchronizationAgent
    this.autoSyncEnabled = config.autoSyncEnabled || false;

    // Multi-team support
    this.team = config.team || process.env.CODING_TEAM || 'default';
    this.teamFilePath = this._getTeamFilePath();
    this.codingFilePath = path.join(this.knowledgeExportDir, 'coding.json');
    this.entityOrigins = new Map(); // Track which file each entity came from
  }

  _getTeamFilePath() {
    // All teams use .data/knowledge-export/{team}.json
    const teamName = this.team === 'default' ? 'coding' : this.team.toLowerCase();
    return path.join(this.knowledgeExportDir, `${teamName}.json`);
  }

  async initialize() {
    try {
      // Ensure directories exist
      await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
      await fs.mkdir(this.knowledgeExportDir, { recursive: true });

      // Load from knowledge export files
      await this.loadFromKnowledgeExport();

      // Then load any additional data from local graph storage
      await this.loadGraph();
      
      // Auto-sync disabled - only sync on explicit user action
      // this.syncInterval = setInterval(() => {
      //   this.syncToSharedMemory().catch(console.error);
      // }, 300000); // 5 minutes
      
      this.initialized = true;
      console.log(`Memory service initialized with ${this.graph.order} nodes and ${this.graph.size} edges`);
    } catch (error) {
      throw new Error(`Failed to initialize memory service: ${error.message}`);
    }
  }

  async cleanup() {
    // Clear sync interval
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    // Save graph before cleanup
    if (this.initialized) {
      await this.saveGraph();
      if (this.autoSyncEnabled) {
        await this.syncToKnowledgeExport();
      }
    }
  }

  /**
   * Load graph from persistent storage
   */
  async loadGraph() {
    try {
      const data = await fs.readFile(this.dbPath, 'utf8');
      const graphData = JSON.parse(data);
      
      // Clear existing graph
      this.graph.clear();
      
      // Import nodes
      if (graphData.nodes) {
        for (const node of graphData.nodes) {
          this.graph.addNode(node.key, node.attributes);
        }
      }
      
      // Import edges
      if (graphData.edges) {
        for (const edge of graphData.edges) {
          this.graph.addEdge(edge.source, edge.target, edge.attributes);
        }
      }
      
    } catch (error) {
      // File doesn't exist or is invalid, start with empty graph
      console.log('No existing graph data found, starting fresh');
    }
  }

  /**
   * Save graph to persistent storage
   */
  async saveGraph() {
    try {
      const graphData = {
        nodes: this.graph.mapNodes((node, attributes) => ({
          key: node,
          attributes
        })),
        edges: this.graph.mapEdges((edge, attributes, source, target) => ({
          source,
          target,
          attributes
        })),
        metadata: {
          lastSaved: new Date().toISOString(),
          nodeCount: this.graph.order,
          edgeCount: this.graph.size
        }
      };
      
      await fs.writeFile(this.dbPath, JSON.stringify(graphData, null, 2));
    } catch (error) {
      console.error('Failed to save graph:', error.message);
    }
  }

  /**
   * Deduplicate observations based on content
   */
  deduplicateObservations(observations) {
    if (!observations || observations.length === 0) return [];
    
    // For structured observations (objects with content field)
    if (typeof observations[0] === 'object' && observations[0].content) {
      const seen = new Set();
      return observations.filter(obs => {
        const key = obs.content;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    }
    
    // For simple string observations
    return [...new Set(observations)];
  }

  /**
   * Create entities in the graph
   */
  async createEntities(entities) {
    if (!this.initialized) throw new Error('Memory service not initialized');
    
    const created = [];
    const updated = [];
    
    for (const entity of entities) {
      const nodeId = this.getNodeId(entity.name);
      
      if (this.graph.hasNode(nodeId)) {
        // Update existing node
        const existing = this.graph.getNodeAttributes(nodeId);
        // Merge observations with deduplication
        const existingObs = existing.observations || [];
        const newObs = entity.observations || [];
        const mergedObservations = this.deduplicateObservations([...existingObs, ...newObs]);
        
        const updatedAttributes = {
          ...existing,
          ...entity,
          observations: mergedObservations,
          lastUpdated: new Date().toISOString()
        };
        
        this.graph.replaceNodeAttributes(nodeId, updatedAttributes);
        updated.push(entity.name);
      } else {
        // Create new node
        this.graph.addNode(nodeId, {
          ...entity,
          created: new Date().toISOString(),
          lastUpdated: new Date().toISOString()
        });
        created.push(entity.name);
      }
    }
    
    // Save after modifications
    await this.saveGraph();

    // Sync to knowledge export (only if auto-sync enabled)
    if (this.autoSyncEnabled) {
      await this.syncToKnowledgeExport();
    }

    return {
      success: true,
      created: created.length,
      updated: updated.length,
      total: entities.length
    };
  }

  /**
   * Create relations between entities
   */
  async createRelations(relations) {
    if (!this.initialized) throw new Error('Memory service not initialized');
    
    const created = [];
    const failed = [];
    const skipped = [];
    
    for (const relation of relations) {
      const sourceId = this.getNodeId(relation.from);
      const targetId = this.getNodeId(relation.to);
      
      // Ensure both nodes exist
      if (!this.graph.hasNode(sourceId)) {
        this.graph.addNode(sourceId, {
          name: relation.from,
          entityType: 'Unknown',
          created: new Date().toISOString()
        });
      }
      
      if (!this.graph.hasNode(targetId)) {
        this.graph.addNode(targetId, {
          name: relation.to,
          entityType: 'Unknown',
          created: new Date().toISOString()
        });
      }
      
      // Check if relation already exists with same type
      const existingEdges = this.graph.edges(sourceId, targetId);
      let relationExists = false;
      
      for (const edge of existingEdges) {
        const edgeAttrs = this.graph.getEdgeAttributes(edge);
        if (edgeAttrs.relationType === relation.relationType) {
          relationExists = true;
          skipped.push(relation);
          break;
        }
      }
      
      if (!relationExists) {
        try {
          // Add new edge with relation type as attribute
          this.graph.addEdge(sourceId, targetId, {
            relationType: relation.relationType,
            created: new Date().toISOString()
          });
          created.push(relation);
        } catch (error) {
          failed.push(relation);
        }
      }
    }
    
    // Save after modifications
    await this.saveGraph();

    // Sync to knowledge export (only if auto-sync enabled)
    if (this.autoSyncEnabled) {
      await this.syncToKnowledgeExport();
    }

    return {
      success: true,
      created: created.length,
      failed: failed.length,
      skipped: skipped.length
    };
  }

  /**
   * Search for nodes matching a query
   */
  async searchNodes(query) {
    if (!this.initialized) throw new Error('Memory service not initialized');
    
    const results = [];
    const queryLower = query.toLowerCase();
    
    this.graph.forEachNode((node, attributes) => {
      // Search in node name
      if (attributes.name && attributes.name.toLowerCase().includes(queryLower)) {
        results.push(this.formatNode(node, attributes));
        return;
      }
      
      // Search in entity type
      if (attributes.entityType && attributes.entityType.toLowerCase().includes(queryLower)) {
        results.push(this.formatNode(node, attributes));
        return;
      }
      
      // Search in observations
      if (attributes.observations && Array.isArray(attributes.observations)) {
        for (const obs of attributes.observations) {
          if (typeof obs === 'string' && obs.toLowerCase().includes(queryLower)) {
            results.push(this.formatNode(node, attributes));
            return;
          }
        }
      }
    });
    
    return results;
  }

  /**
   * Read the entire graph
   */
  async readGraph() {
    if (!this.initialized) throw new Error('Memory service not initialized');
    
    const nodes = this.graph.mapNodes((node, attributes) => 
      this.formatNode(node, attributes)
    );
    
    const edges = this.graph.mapEdges((edge, attributes, source, target) => ({
      from: this.graph.getNodeAttribute(source, 'name'),
      to: this.graph.getNodeAttribute(target, 'name'),
      relationType: attributes.relationType || 'related'
    }));
    
    return { 
      nodes, 
      edges,
      metadata: {
        nodeCount: this.graph.order,
        edgeCount: this.graph.size,
        lastAccessed: new Date().toISOString()
      }
    };
  }

  /**
   * Delete entities
   */
  async deleteEntities(entityNames) {
    if (!this.initialized) throw new Error('Memory service not initialized');
    
    const deleted = [];
    const notFound = [];
    
    for (const name of entityNames) {
      const nodeId = this.getNodeId(name);
      
      if (this.graph.hasNode(nodeId)) {
        this.graph.dropNode(nodeId);
        deleted.push(name);
      } else {
        notFound.push(name);
      }
    }
    
    // Save after modifications
    await this.saveGraph();

    // Sync to knowledge export (only if auto-sync enabled)
    if (this.autoSyncEnabled) {
      await this.syncToKnowledgeExport();
    }

    return {
      success: true,
      deleted: deleted.length,
      notFound: notFound.length
    };
  }

  /**
   * Get nodes connected to a specific node
   */
  async getConnectedNodes(entityName, depth = 1) {
    if (!this.initialized) throw new Error('Memory service not initialized');
    
    const nodeId = this.getNodeId(entityName);
    if (!this.graph.hasNode(nodeId)) {
      return { nodes: [], edges: [] };
    }
    
    const connectedNodes = new Set([nodeId]);
    const connectedEdges = new Set();
    
    // BFS to find nodes within specified depth
    const queue = [{ node: nodeId, currentDepth: 0 }];
    const visited = new Set([nodeId]);
    
    while (queue.length > 0) {
      const { node, currentDepth } = queue.shift();
      
      if (currentDepth < depth) {
        // Get neighbors
        this.graph.forEachNeighbor(node, (neighbor) => {
          connectedNodes.add(neighbor);
          
          // Add edges
          this.graph.forEachEdge(node, neighbor, (edge) => {
            connectedEdges.add(edge);
          });
          
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push({ node: neighbor, currentDepth: currentDepth + 1 });
          }
        });
      }
    }
    
    // Format results
    const nodes = Array.from(connectedNodes).map(nodeId => 
      this.formatNode(nodeId, this.graph.getNodeAttributes(nodeId))
    );
    
    const edges = Array.from(connectedEdges).map(edgeId => {
      const edgeData = this.graph.getEdgeAttributes(edgeId);
      const { source, target } = this.graph.extremities(edgeId);
      return {
        from: this.graph.getNodeAttribute(source, 'name'),
        to: this.graph.getNodeAttribute(target, 'name'),
        relationType: edgeData.relationType || 'related'
      };
    });
    
    return { nodes, edges };
  }

  /**
   * Import data from MCP memory format
   */
  async importFromMCP(data) {
    if (data.nodes) {
      const entities = data.nodes.map(node => ({
        name: node.name,
        entityType: node.entityType,
        observations: node.observations || []
      }));
      await this.createEntities(entities);
    }
    
    if (data.edges) {
      await this.createRelations(data.edges);
    }
    
    return { success: true };
  }

  /**
   * Export data to MCP memory format
   */
  async exportToMCP() {
    const graph = await this.readGraph();
    return {
      nodes: graph.nodes,
      edges: graph.edges
    };
  }

  /**
   * Get graph statistics
   */
  getStats() {
    return {
      nodes: this.graph.order,
      edges: this.graph.size,
      density: this.graph.size / (this.graph.order * (this.graph.order - 1)),
      components: this.graph.order > 0 ? 1 : 0 // Simplified
    };
  }

  // Helper methods
  
  getNodeId(name) {
    return name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  }

  formatNode(nodeId, attributes) {
    return {
      name: attributes.name,
      entityType: attributes.entityType,
      observations: attributes.observations || [],
      created: attributes.created,
      lastUpdated: attributes.lastUpdated
    };
  }

  /**
   * Load data from knowledge export files
   */
  async loadFromKnowledgeExport() {
    // Determine which files to load based on team configuration
    const filesToLoad = [];

    // Always load coding knowledge base if it exists
    if (await this._fileExists(this.codingFilePath)) {
      filesToLoad.push({ path: this.codingFilePath, source: 'coding' });
    }

    // Load team-specific file if different from coding
    if (this.team !== 'default' && this.team !== 'coding' && await this._fileExists(this.teamFilePath)) {
      filesToLoad.push({ path: this.teamFilePath, source: 'team' });
    }

    // Load each file
    for (const fileInfo of filesToLoad) {
      await this._loadFromFile(fileInfo.path, fileInfo.source);
    }

    console.log(`Loaded ${this.graph.order} entities from ${filesToLoad.length} knowledge export file(s)`);
  }

  async _fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async _loadFromFile(filePath, source) {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const sharedMemory = JSON.parse(data);
      
      // Import entities
      if (sharedMemory.entities && Array.isArray(sharedMemory.entities)) {
        for (const entity of sharedMemory.entities) {
          const nodeId = this.getNodeId(entity.name);
          if (!this.graph.hasNode(nodeId)) {
            this.graph.addNode(nodeId, {
              ...entity,
              created: entity.created || entity.metadata?.created_at || new Date().toISOString(),
              lastUpdated: entity.lastUpdated || entity.metadata?.last_updated || new Date().toISOString(),
              _source: source
            });
            // Track origin
            this.entityOrigins.set(entity.name, filePath);
            if (entity.id) {
              this.entityOrigins.set(entity.id, filePath);
            }
          }
        }
      }
      
      // Import relations
      if (sharedMemory.relations && Array.isArray(sharedMemory.relations)) {
        for (const relation of sharedMemory.relations) {
          const sourceId = this.getNodeId(relation.from);
          const targetId = this.getNodeId(relation.to);
          
          // Ensure nodes exist
          if (this.graph.hasNode(sourceId) && this.graph.hasNode(targetId)) {
            // Check if edge already exists
            const existingEdges = this.graph.edges(sourceId, targetId);
            const hasRelation = existingEdges.some(edge => 
              this.graph.getEdgeAttribute(edge, 'relationType') === relation.relationType
            );
            
            if (!hasRelation) {
              this.graph.addEdge(sourceId, targetId, {
                relationType: relation.relationType,
                created: new Date().toISOString()
              });
            }
          }
        }
      }
      
      console.log(`Loaded ${sharedMemory.entities?.length || 0} entities and ${sharedMemory.relations?.length || 0} relations from ${path.basename(filePath)}`);
    } catch (error) {
      // File doesn't exist or is invalid, that's okay
      console.log(`No ${path.basename(filePath)} found or error reading: ${error.message}`);
    }
  }

  /**
   * Sync graph data back to appropriate knowledge export files
   */
  async syncToKnowledgeExport(force = false) {
    const now = Date.now();
    
    // Throttle syncing unless forced
    if (!force && (now - this.lastSync) < this.syncThrottleMs) {
      if (!this.pendingSync) {
        this.pendingSync = true;
        setTimeout(() => {
          this.pendingSync = false;
          this.syncToKnowledgeExport(false).catch(console.error);
        }, this.syncThrottleMs - (now - this.lastSync));
      }
      return;
    }
    
    // MULTI-TEAM: Determine correct file to sync to based on team
    const targetFile = this.teamFilePath; // This already handles team logic via _getTeamFilePath()
    
    // Simple file lock to prevent concurrent writes
    const lockFile = targetFile + '.lock';
    try {
      await fs.writeFile(lockFile, process.pid.toString(), { flag: 'wx' });
    } catch (error) {
      // Another process is writing, skip this sync
      console.log(`Skipping sync - another process is writing to ${path.basename(targetFile)}`);
      return;
    }
    
    try {
      this.lastSync = now;
      
      // Read existing knowledge export
      let knowledgeExport = {
        entities: [],
        relations: [],
        metadata: {
          version: "1.0.0",
          created: new Date().toISOString(),
          contributors: [],
          total_entities: 0,
          total_relations: 0
        }
      };
      
      try {
        const existing = await fs.readFile(targetFile, 'utf8');
        knowledgeExport = JSON.parse(existing);
      } catch (error) {
        // File doesn't exist, use defaults
      }

      // Export all nodes as entities - preserve existing entity structure
      const entities = this.graph.mapNodes((node, attributes) => {
        // Find existing entity in knowledge export to preserve structure
        const existingEntity = knowledgeExport.entities.find(e =>
          e.name === attributes.name
        );
        
        if (existingEntity) {
          // Preserve existing structure, only update necessary fields
          return {
            ...existingEntity,
            // Update only these fields from graph
            observations: attributes.observations || existingEntity.observations || [],
            significance: attributes.significance || existingEntity.significance || 5,
            problem: attributes.problem || existingEntity.problem || {},
            solution: attributes.solution || existingEntity.solution || {},
            metadata: {
              ...existingEntity.metadata,
              last_updated: new Date().toISOString()
            }
          };
        } else {
          // New entity - create with basic structure
          return {
            name: attributes.name,
            entityType: attributes.entityType || 'Unknown',
            observations: attributes.observations || [],
            significance: attributes.significance || 5,
            problem: attributes.problem || {},
            solution: attributes.solution || {},
            metadata: {
              created_at: attributes.created || new Date().toISOString(),
              last_updated: new Date().toISOString()
            }
          };
        }
      });
      
      // Export all edges as relations - preserve existing relation structure
      const relationMap = new Map();
      this.graph.forEachEdge((edge, attributes, source, target) => {
        const fromName = this.graph.getNodeAttribute(source, 'name');
        const toName = this.graph.getNodeAttribute(target, 'name');
        const relationType = attributes.relationType || 'related';
        
        // Create unique key for deduplication
        const key = `${fromName}|${relationType}|${toName}`;
        
        if (!relationMap.has(key)) {
          // Find existing relation in knowledge export to preserve structure
          const existingRelation = knowledgeExport.relations.find(r =>
            r.from === fromName && r.to === toName && r.relationType === relationType
          );
          
          if (existingRelation) {
            // Preserve existing relation structure
            relationMap.set(key, existingRelation);
          } else {
            // New relation - create with basic structure
            relationMap.set(key, {
              from: fromName,
              to: toName,
              relationType: relationType
            });
          }
        }
      });
      
      const relations = Array.from(relationMap.values());
      
      // Merge entities intelligently (prevent duplicates from multiple processes)
      const existingEntitiesMap = new Map();
      knowledgeExport.entities.forEach(entity => {
        existingEntitiesMap.set(entity.name, entity);
      });
      
      // Merge new entities with existing ones
      entities.forEach(newEntity => {
        const existing = existingEntitiesMap.get(newEntity.name);
        if (existing) {
          // Merge observations without duplicates
          const combinedObservations = [
            ...(existing.observations || []),
            ...(newEntity.observations || [])
          ];
          newEntity.observations = this.deduplicateObservations(combinedObservations);
          
          // Update metadata
          newEntity.metadata.created_at = existing.metadata?.created_at || newEntity.metadata.created_at;
          newEntity.metadata.last_updated = new Date().toISOString();
        }
        existingEntitiesMap.set(newEntity.name, newEntity);
      });
      
      // Update knowledge export with merged entities
      knowledgeExport.entities = Array.from(existingEntitiesMap.values());
      knowledgeExport.relations = relations;
      knowledgeExport.metadata.total_entities = entities.length;
      knowledgeExport.metadata.total_relations = relations.length;
      knowledgeExport.metadata.last_updated = new Date().toISOString();

      // Write to file
      await fs.writeFile(targetFile, JSON.stringify(knowledgeExport, null, 2));

      console.log(`Synced ${entities.length} entities and ${relations.length} relations to ${path.basename(targetFile)}`);
    } catch (error) {
      console.error('Failed to sync to knowledge export:', error.message);
    } finally {
      // Always remove lock file
      try {
        await fs.unlink(lockFile);
      } catch (error) {
        // Lock file might not exist, ignore
      }
    }
  }
}

export default MemoryFallbackService;