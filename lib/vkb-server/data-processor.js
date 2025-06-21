/**
 * Data Processor - Prepares knowledge base data for visualization
 */

import { promises as fs } from 'fs';
import path from 'path';
import { Logger } from './utils/logging.js';

export class DataProcessor {
  constructor(options) {
    this.sharedMemoryPath = options.sharedMemoryPath;
    this.sharedMemoryPaths = options.sharedMemoryPaths || [options.sharedMemoryPath];
    this.visualizerDir = options.visualizerDir;
    this.projectRoot = options.projectRoot;
    this.logger = new Logger('DataProcessor');
  }
  
  /**
   * Prepare memory data for visualization
   */
  async prepareData() {
    this.logger.info('Preparing memory data for visualization...');
    
    // Ensure paths exist
    await this.validatePaths();
    
    // Create symlink to knowledge-management directory
    await this.createKnowledgeManagementLink();
    
    // Process memory data
    await this.processMemoryData();
    
    // Get statistics
    const stats = await this.getStatistics();
    this.logger.info(`Entities: ${stats.entities}, Relations: ${stats.relations}`);
    
    return { success: true, stats };
  }
  
  /**
   * Validate required paths exist
   */
  async validatePaths() {
    // Check visualizer directory
    try {
      await fs.access(this.visualizerDir);
    } catch {
      throw new Error(`Memory visualizer directory not found: ${this.visualizerDir}`);
    }
    
    // Check shared memory file
    try {
      await fs.access(this.sharedMemoryPath);
    } catch {
      throw new Error(`Shared memory file not found: ${this.sharedMemoryPath}`);
    }
    
    // Ensure dist directory exists
    const distDir = path.join(this.visualizerDir, 'dist');
    await fs.mkdir(distDir, { recursive: true });
  }
  
  /**
   * Create symlink to knowledge-management directory
   */
  async createKnowledgeManagementLink() {
    const kmLink = path.join(this.visualizerDir, 'dist', 'knowledge-management');
    const kmSource = path.join(this.projectRoot, 'knowledge-management');
    
    // Remove existing symlink if present
    try {
      const stats = await fs.lstat(kmLink);
      if (stats.isSymbolicLink()) {
        await fs.unlink(kmLink);
      }
    } catch {
      // Link doesn't exist, which is fine
    }
    
    // Create new symlink
    try {
      await fs.symlink(kmSource, kmLink);
      this.logger.info('Knowledge management files linked for serving');
      
      // Count insight files
      const insightsDir = path.join(kmSource, 'insights');
      try {
        const files = await fs.readdir(insightsDir);
        const mdFiles = files.filter(f => f.endsWith('.md'));
        this.logger.info(`Found ${mdFiles.length} insight files`);
      } catch {
        this.logger.warn('Could not count insight files');
      }
    } catch (error) {
      this.logger.warn('Could not create symlink to knowledge-management directory');
      this.logger.warn('Insight files may not be accessible');
    }
  }
  
  /**
   * Process memory data into NDJSON format
   */
  async processMemoryData() {
    const memoryDist = path.join(this.visualizerDir, 'dist', 'memory.json');
    
    // Check if ukb has already generated the NDJSON file
    try {
      await fs.access(memoryDist);
      const stats = await fs.stat(memoryDist);
      
      // Check if memory.json is newer than all source files
      let useExisting = true;
      for (const memPath of this.sharedMemoryPaths) {
        try {
          const sharedStats = await fs.stat(memPath);
          if (sharedStats.mtime > stats.mtime) {
            useExisting = false;
            break;
          }
        } catch {
          // File doesn't exist, skip
        }
      }
      
      if (useExisting) {
        this.logger.info('Using existing NDJSON data (managed by ukb)');
        return;
      }
    } catch {
      // File doesn't exist, we'll create it
    }
    
    // Convert and merge multiple shared-memory files to NDJSON format
    this.logger.info(`Converting ${this.sharedMemoryPaths.length} shared memory file(s) to NDJSON format...`);
    
    const ndjsonLines = [];
    const entityMap = new Map(); // For deduplication by name
    const allRelations = [];
    
    // Process each shared memory file
    for (const memPath of this.sharedMemoryPaths) {
      try {
        const sharedMemory = JSON.parse(await fs.readFile(memPath, 'utf8'));
        const fileName = path.basename(memPath);
        this.logger.info(`Processing ${fileName}...`);
        
        // Process entities from this file
        if (sharedMemory.entities && Array.isArray(sharedMemory.entities)) {
          for (const entity of sharedMemory.entities) {
            const existing = entityMap.get(entity.name);
            
            // Special handling for CodingKnowledge - always merge, never replace
            if (entity.name === 'CodingKnowledge') {
              if (existing) {
                // Merge observations and source files
                const sources = existing._sources || [existing._source];
                if (!sources.includes(fileName)) {
                  sources.push(fileName);
                }
                existing._sources = sources;
                existing._source = sources.join(', '); // For display
              } else {
                entity._source = fileName;
                entity._sources = [fileName];
                entityMap.set(entity.name, entity);
              }
            } else {
              // Normal entity handling - keep the entity with the latest update time
              if (!existing || 
                  (entity.metadata?.last_updated || entity.created || '2000-01-01') > 
                  (existing.metadata?.last_updated || existing.created || '2000-01-01')) {
                // Add source file info
                entity._source = fileName;
                entityMap.set(entity.name, entity);
              }
            }
          }
        }
        
        // Collect relations from this file
        if (sharedMemory.relations && Array.isArray(sharedMemory.relations)) {
          allRelations.push(...sharedMemory.relations.map(r => ({...r, _source: fileName})));
        }
      } catch (error) {
        this.logger.warn(`Could not read ${memPath}: ${error.message}`);
      }
    }
    
    // Convert entities to NDJSON
    for (const entity of entityMap.values()) {
      const processed = { ...entity, type: 'entity' };
      
      // Handle different observation formats
      if (processed.observations && Array.isArray(processed.observations)) {
        if (processed.observations.length > 0 && typeof processed.observations[0] === 'object') {
          // Enhanced format - extract content
          processed.observations = processed.observations.map(obs => 
            typeof obs === 'object' ? obs.content : obs
          );
        }
      } else if (processed.legacy_observations && Array.isArray(processed.legacy_observations)) {
        // Use legacy observations if available
        processed.observations = processed.legacy_observations;
      }
      
      ndjsonLines.push(JSON.stringify(processed));
    }
    
    // Deduplicate and process relations
    const relationSet = new Set();
    for (const relation of allRelations) {
      const key = `${relation.from}|${relation.relationType}|${relation.to}`;
      if (!relationSet.has(key)) {
        relationSet.add(key);
        ndjsonLines.push(JSON.stringify(relation));
      }
    }
    
    // Write NDJSON file
    await fs.writeFile(memoryDist, ndjsonLines.join('\n'), 'utf8');
    
    // Log summary
    const entityCount = entityMap.size;
    const relationCount = relationSet.size;
    this.logger.info(`Memory data converted to NDJSON format: ${entityCount} entities, ${relationCount} relations`);
  }
  
  /**
   * Get statistics about the knowledge base
   */
  async getStatistics() {
    let totalEntities = 0;
    let totalRelations = 0;
    const entityNames = new Set();
    
    for (const memPath of this.sharedMemoryPaths) {
      try {
        const sharedMemory = JSON.parse(await fs.readFile(memPath, 'utf8'));
        
        // Count unique entities by name
        if (sharedMemory.entities && Array.isArray(sharedMemory.entities)) {
          sharedMemory.entities.forEach(e => entityNames.add(e.name));
        }
        
        totalRelations += sharedMemory.relations?.length || 0;
      } catch {
        // File doesn't exist, skip
      }
    }
    
    return {
      entities: entityNames.size,
      relations: totalRelations
    };
  }
}