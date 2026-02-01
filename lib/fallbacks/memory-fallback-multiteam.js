import path from 'path';
import fs from 'fs/promises';
import Graph from 'graphology';
import graphologyUtils from 'graphology-utils';
import { createLogger } from '../logging/Logger.js';

const { subgraph } = graphologyUtils;
const logger = createLogger('memory-fallback-mt');

/**
 * Extension of MemoryFallbackService with multi-team support
 * This is a cleaner implementation that we can swap in once tested
 */
class MemoryFallbackServiceMultiTeam {
  constructor(config = {}) {
    this.dbPath = config.dbPath || path.join(process.cwd(), '.coding-tools', 'memory.json');
    // Use knowledge export path instead of deprecated shared-memory path
    this.knowledgeExportDir = config.knowledgeExportPath || path.join(process.cwd(), '.data', 'knowledge-export');
    this.graph = new Graph({ multi: true });
    this.initialized = false;
    this.syncInterval = null;
    this.lastSync = 0;
    this.syncThrottleMs = 5000;
    this.pendingSync = false;

    // Multi-team support
    this.team = config.team || process.env.CODING_TEAM || 'default';
    this.teamFilePath = this._getTeamFilePath();
    this.codingFilePath = path.join(this.knowledgeExportDir, 'coding.json');

    // Track origins for proper sync back
    this.entityOrigins = new Map(); // entityName -> filePath
    this.relationOrigins = new Map(); // relationKey -> filePath
  }

  _getTeamFilePath() {
    // All teams use .data/knowledge-export/{team}.json
    const teamName = this.team === 'default' ? 'coding' : this.team.toLowerCase();
    return path.join(this.knowledgeExportDir, `${teamName}.json`);
  }

  async initialize() {
    try {
      await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
      await fs.mkdir(this.knowledgeExportDir, { recursive: true });

      // Load from knowledge export files
      await this.loadFromKnowledgeExport();
      await this.loadGraph();

      // Start sync interval
      this.syncInterval = setInterval(() => {
        this.syncToKnowledgeExport().catch(err => logger.error('Sync failed', { error: err.message }));
      }, 300000); // 5 minutes

      this.initialized = true;
      logger.info(`Memory service initialized with ${this.graph.order} nodes and ${this.graph.size} edges (team: ${this.team})`);
    } catch (error) {
      throw new Error(`Failed to initialize memory service: ${error.message}`);
    }
  }

  async loadFromKnowledgeExport() {
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

    logger.info(`Loaded knowledge from ${filesToLoad.map(f => path.basename(f.path)).join(', ')}`);
  }

  async _loadFromFile(filePath, source) {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const sharedMemory = JSON.parse(data);
      
      // Import entities
      if (sharedMemory.entities && Array.isArray(sharedMemory.entities)) {
        for (const entity of sharedMemory.entities) {
          const nodeId = this.getNodeId(entity.name);
          
          // Skip if already loaded (prefer first loaded)
          if (!this.graph.hasNode(nodeId)) {
            this.graph.addNode(nodeId, {
              ...entity,
              created: entity.created || entity.metadata?.created_at || new Date().toISOString(),
              lastUpdated: entity.lastUpdated || entity.metadata?.last_updated || new Date().toISOString(),
              _source: source
            });
            
            // Track origin for sync back
            this.entityOrigins.set(entity.name, filePath);
          }
        }
      }
      
      // Import relations
      if (sharedMemory.relations && Array.isArray(sharedMemory.relations)) {
        for (const relation of sharedMemory.relations) {
          const sourceId = this.getNodeId(relation.from);
          const targetId = this.getNodeId(relation.to);
          
          if (this.graph.hasNode(sourceId) && this.graph.hasNode(targetId)) {
            const existingEdges = this.graph.edges(sourceId, targetId);
            const hasRelation = existingEdges.some(edge => 
              this.graph.getEdgeAttribute(edge, 'relationType') === relation.relationType
            );
            
            if (!hasRelation) {
              this.graph.addEdge(sourceId, targetId, {
                relationType: relation.relationType,
                created: new Date().toISOString()
              });
              
              // Track origin
              const relationKey = `${relation.from}-${relation.relationType}-${relation.to}`;
              this.relationOrigins.set(relationKey, filePath);
            }
          }
        }
      }
      
      logger.info(`Loaded ${sharedMemory.entities?.length || 0} entities and ${sharedMemory.relations?.length || 0} relations from ${path.basename(filePath)}`);
    } catch (error) {
      logger.debug(`Could not load ${path.basename(filePath)}`, { error: error.message });
    }
  }

  async syncToKnowledgeExport(force = false) {
    const now = Date.now();

    // Throttle syncing
    if (!force && (now - this.lastSync) < this.syncThrottleMs) {
      if (!this.pendingSync) {
        this.pendingSync = true;
        setTimeout(() => {
          this.pendingSync = false;
          this.syncToKnowledgeExport(false).catch(err => logger.error('Sync failed', { error: err.message }));
        }, this.syncThrottleMs - (now - this.lastSync));
      }
      return;
    }

    this.lastSync = now;

    // Group entities and relations by their origin files
    const fileGroups = new Map();

    // Initialize file groups for files we know about
    const knownFiles = [this.codingFilePath, this.teamFilePath];
    for (const file of knownFiles) {
      if (await this._fileExists(file)) {
        fileGroups.set(file, { entities: [], relations: [] });
      }
    }
    
    // Group entities by origin
    this.graph.forEachNode((node, attributes) => {
      const origin = this.entityOrigins.get(attributes.name) || this.teamFilePath;
      if (!fileGroups.has(origin)) {
        fileGroups.set(origin, { entities: [], relations: [] });
      }
      
      fileGroups.get(origin).entities.push({
        name: attributes.name,
        entityType: attributes.entityType || 'Unknown',
        observations: attributes.observations || [],
        significance: attributes.significance || 5,
        problem: attributes.problem || {},
        solution: attributes.solution || {},
        metadata: {
          created_at: attributes.created || new Date().toISOString(),
          last_updated: new Date().toISOString()
        },
        ...(attributes.id ? { id: attributes.id } : {})
      });
    });
    
    // Group relations by origin
    this.graph.forEachEdge((edge, attributes, source, target) => {
      const sourceNode = this.graph.getNodeAttributes(source);
      const targetNode = this.graph.getNodeAttributes(target);
      
      const relationKey = `${sourceNode.name}-${attributes.relationType}-${targetNode.name}`;
      const origin = this.relationOrigins.get(relationKey) || this.teamFilePath;
      
      if (!fileGroups.has(origin)) {
        fileGroups.set(origin, { entities: [], relations: [] });
      }
      
      fileGroups.get(origin).relations.push({
        from: sourceNode.name,
        to: targetNode.name,
        relationType: attributes.relationType,
        id: attributes.id || this._generateId()
      });
    });
    
    // Save each file group
    for (const [filePath, data] of fileGroups) {
      await this._saveToFile(filePath, data);
    }
  }

  async _saveToFile(filePath, data) {
    // Use lock file to prevent concurrent writes
    const lockFile = filePath + '.lock';
    
    try {
      await fs.writeFile(lockFile, process.pid.toString(), { flag: 'wx' });
    } catch (error) {
      logger.debug(`Skipping sync to ${path.basename(filePath)} - another process is writing`);
      return;
    }
    
    try {
      // Read existing file to preserve metadata
      let existingData = {
        entities: [],
        relations: [],
        metadata: {
          version: "2.0.0",
          created: new Date().toISOString(),
          schema_version: "2.0.0"
        }
      };
      
      try {
        const content = await fs.readFile(filePath, 'utf8');
        existingData = JSON.parse(content);
      } catch {
        // File doesn't exist, use defaults
      }
      
      // Merge with existing data (replace entities/relations but keep metadata)
      const mergedData = {
        ...existingData,
        entities: data.entities,
        relations: data.relations,
        metadata: {
          ...existingData.metadata,
          last_updated: new Date().toISOString(),
          total_entities: data.entities.length,
          total_relations: data.relations.length,
          team: this.team
        }
      };
      
      await fs.writeFile(filePath, JSON.stringify(mergedData, null, 2));
      logger.info(`Synced ${data.entities.length} entities and ${data.relations.length} relations to ${path.basename(filePath)}`);

    } catch (error) {
      logger.error(`Failed to sync to ${path.basename(filePath)}`, { error: error.message });
    } finally {
      // Always remove lock file
      try {
        await fs.unlink(lockFile);
      } catch {
        // Ignore if lock file doesn't exist
      }
    }
  }

  // Inherit all other methods from base class
  async cleanup() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    if (this.initialized) {
      await this.saveGraph();
      await this.syncToKnowledgeExport(true);
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

  _generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  getNodeId(name) {
    return name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  }

  // Additional methods would be inherited or implemented as needed...
}

export default MemoryFallbackServiceMultiTeam;