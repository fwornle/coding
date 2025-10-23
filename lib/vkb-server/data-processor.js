/**
 * Data Processor - Prepares knowledge base data for visualization
 *
 * ENHANCED: Now supports querying from database backend (Qdrant + SQLite)
 * in addition to traditional JSON files, with automatic freshness scoring.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { Logger } from './utils/logging.js';
import { KnowledgeExportService } from '../../src/knowledge-management/KnowledgeExportService.js';

export class DataProcessor {
  constructor(options) {
    this.sharedMemoryPath = options.sharedMemoryPath;
    this.sharedMemoryPaths = options.sharedMemoryPaths || [options.sharedMemoryPath];
    this.visualizerDir = options.visualizerDir;
    this.projectRoot = options.projectRoot;
    this.logger = new Logger('DataProcessor');

    // ENHANCED: Team support for scoped knowledge
    this.teams = options.teams || ['coding']; // Default to coding team

    // ENHANCED: Database backend support (optional)
    this.useDatabaseBackend = options.useDatabaseBackend || false;
    this.databaseManager = options.databaseManager || null;
    this.knowledgeDecayTracker = options.knowledgeDecayTracker || null;
    this.embeddingGenerator = options.embeddingGenerator || null;

    // ENHANCED: Knowledge export service for online knowledge
    if (this.databaseManager) {
      this.knowledgeExportService = new KnowledgeExportService({
        databaseManager: this.databaseManager,
        embeddingGenerator: this.embeddingGenerator,
        debug: options.debug || false
      });
    }

    // Data source mode: 'batch', 'online', or 'combined'
    this.dataSourceMode = options.dataSourceMode || 'batch';
  }
  
  /**
   * Prepare memory data for visualization
   * ENHANCED: Supports batch, online, or combined data sources
   */
  async prepareData() {
    this.logger.info(`Preparing memory data for visualization (mode: ${this.dataSourceMode})...`);

    // Ensure paths exist
    await this.validatePaths();

    // Create symlink to knowledge-management directory
    await this.createKnowledgeManagementLink();

    // In batch or combined mode, delete existing memory.json to force regeneration
    if (this.dataSourceMode === 'batch' || this.dataSourceMode === 'combined') {
      const memoryPath = path.join(this.visualizerDir, 'dist', 'memory.json');
      try {
        await fs.unlink(memoryPath);
        this.logger.info('Deleted existing memory.json to force regeneration');
      } catch {
        // File doesn't exist, that's fine
      }
    }

    // Process memory data based on mode
    if (this.dataSourceMode === 'batch' || this.dataSourceMode === 'combined') {
      await this.processMemoryData();
    }

    // Export online knowledge if requested
    if (this.dataSourceMode === 'online' || this.dataSourceMode === 'combined') {
      await this.exportOnlineKnowledge();
    }

    // Create combined view if requested
    if (this.dataSourceMode === 'combined') {
      await this.createCombinedView();
    } else if (this.dataSourceMode === 'online') {
      // In online-only mode, copy memory-online.json to memory.json for frontend auto-load
      const distDir = path.join(this.visualizerDir, 'dist');
      const onlinePath = path.join(distDir, 'memory-online.json');
      const memoryPath = path.join(distDir, 'memory.json');
      try {
        const onlineContent = await fs.readFile(onlinePath, 'utf8');
        await fs.writeFile(memoryPath, onlineContent, 'utf8');
        this.logger.info('Created memory.json from online data for frontend auto-load');
      } catch (error) {
        this.logger.error(`Failed to create memory.json for online mode: ${error.message}`);
      }
    }
    // Note: In batch mode, memory.json is already created by processMemoryDataFromJSON()

    // Get statistics
    const stats = await this.getStatistics();
    this.logger.info(`Entities: ${stats.entities}, Relations: ${stats.relations}`);

    return { success: true, stats };
  }

  /**
   * ENHANCED: Export online knowledge from databases to team-scoped JSON files
   */
  async exportOnlineKnowledge() {
    if (!this.knowledgeExportService) {
      this.logger.warn('Online knowledge export skipped: Knowledge extraction system not available');
      this.logger.info('To enable: Fix API keys and run knowledge extraction');
      return;
    }

    this.logger.info('Exporting online knowledge from Qdrant/SQLite...');

    try {
      const distDir = path.join(this.visualizerDir, 'dist');
      const teamContents = [];
      const allProjectEntities = [];
      const allPatternToProjectRelations = [];

      // Export team-scoped online knowledge files
      for (const team of this.teams) {
        this.logger.info(`Exporting online knowledge for team: ${team}`);

        // Export ONLY online (auto-learned) knowledge filtered by team/project
        const knowledgeData = await this.knowledgeExportService.exportToMemoryFormat({
          sourceFilter: 'auto',     // CRITICAL: Only auto-learned knowledge
          projectFilter: team,       // Filter by classification column
          limit: 5000,
          minConfidence: 0.5,
          includeRelations: true,
          similarityThreshold: 0.75
        });

        if (knowledgeData.entities.length === 0) {
          this.logger.warn(`No online knowledge found for team ${team} - database is empty`);
          continue;
        }

        // Add infrastructure entities and relations for this team
        const teamCapitalized = team.charAt(0).toUpperCase() + team.slice(1).toLowerCase();

        // Create Project entity for this team
        const projectEntity = {
          name: teamCapitalized,
          entityType: 'Project',
          observations: [
            {
              date: new Date().toISOString(),
              type: 'insight',
              content: `${teamCapitalized} online auto-learned knowledge`
            }
          ],
          significance: 5,
          metadata: {
            source: 'auto',
            sourceType: 'online'
          },
          type: 'entity',
          _source: 'database'
        };

        // Create relations: Each pattern → Project
        const patternToProjectRelations = knowledgeData.entities.map(entity => ({
          from: entity.name,
          to: teamCapitalized,
          relationType: 'implemented in',
          type: 'relation',
          metadata: {
            source: 'auto',
            autoGenerated: true
          }
        }));

        // Create relations: Each pattern → CollectiveKnowledge (direct connection)
        const patternToSystemRelations = knowledgeData.entities.map(entity => ({
          from: entity.name,
          to: 'CollectiveKnowledge',
          relationType: 'contributes to',
          type: 'relation',
          metadata: {
            source: 'auto',
            autoGenerated: true
          }
        }));

        // Combine knowledge data with infrastructure
        const enhancedEntities = [
          ...knowledgeData.entities,
          projectEntity
        ];

        const enhancedRelations = [
          ...knowledgeData.relations,
          ...patternToProjectRelations,
          ...patternToSystemRelations
        ];

        // Convert to NDJSON
        const ndjson = this.knowledgeExportService.exportToNDJSON({
          entities: enhancedEntities,
          relations: enhancedRelations
        });

        // Write to team-scoped file: memory-online-coding.json, memory-online-ui.json, etc.
        const onlineMemoryPath = path.join(distDir, `memory-online-${team.toLowerCase()}.json`);
        await fs.writeFile(onlineMemoryPath, ndjson, 'utf8');

        // Save for combined file
        teamContents.push(ndjson.trim());

        // Track for combined deduplication
        allProjectEntities.push(projectEntity);
        allPatternToProjectRelations.push(...patternToProjectRelations);

        this.logger.info(`Team ${team}: ${knowledgeData.entities.length} entities, ${knowledgeData.relations.length} relations`);
      }

      // BACKWARDS COMPATIBILITY: Also create combined memory-online.json for "Online" mode
      // Add System entity and project-to-system relations
      if (teamContents.length > 0) {
        // Create System entity (CollectiveKnowledge)
        const systemEntity = {
          name: 'CollectiveKnowledge',
          entityType: 'System',
          observations: [
            {
              date: new Date().toISOString(),
              type: 'insight',
              content: 'Central hub for auto-learned programming patterns'
            }
          ],
          significance: 5,
          metadata: {
            source: 'auto',
            sourceType: 'online'
          },
          type: 'entity',
          _source: 'database'
        };

        // Create relations: Project → System
        const projectToSystemRelations = allProjectEntities.map(projectEntity => ({
          from: projectEntity.name,
          to: 'CollectiveKnowledge',
          relationType: 'contributed patterns to',
          type: 'relation',
          metadata: {
            source: 'auto',
            autoGenerated: true
          }
        }));

        // Combine with deduplication
        const systemEntityNDJSON = JSON.stringify(systemEntity);
        const projectToSystemNDJSON = projectToSystemRelations.map(r => JSON.stringify(r)).join('\n');

        const combinedOnline = [
          ...teamContents,
          systemEntityNDJSON,
          projectToSystemNDJSON
        ].filter(Boolean).join('\n');

        const combinedOnlinePath = path.join(distDir, 'memory-online.json');
        await fs.writeFile(combinedOnlinePath, combinedOnline, 'utf8');
        this.logger.info('Created combined memory-online.json for backwards compatibility');
      }

      this.logger.info('Online knowledge export complete');
    } catch (error) {
      this.logger.error(`Failed to export online knowledge: ${error.message}`);
      if (this.debug) {
        console.error(error.stack);
      }
    }
  }

  /**
   * ENHANCED: Create combined view merging team-scoped batch and online knowledge with deduplication
   */
  async createCombinedView() {
    this.logger.info('Creating combined knowledge view...');

    try {
      const distDir = path.join(this.visualizerDir, 'dist');
      const batchPath = path.join(distDir, 'memory.json');
      const combinedPath = path.join(distDir, 'memory-combined.json');

      // Read batch knowledge (already combined from all team batch files)
      const batchContent = await fs.readFile(batchPath, 'utf8').catch(() => '');

      // Read all team-scoped online knowledge files
      const onlineContents = [];
      for (const team of this.teams) {
        const onlinePath = path.join(distDir, `memory-online-${team.toLowerCase()}.json`);
        const content = await fs.readFile(onlinePath, 'utf8').catch(() => '');
        if (content.trim()) {
          onlineContents.push(content.trim());
        }
      }

      // Parse NDJSON data
      const batchItems = batchContent.trim() ? batchContent.trim().split('\n').map(line => JSON.parse(line)) : [];
      const onlineItems = onlineContents.flatMap(content =>
        content.split('\n').map(line => JSON.parse(line))
      );

      // Separate entities and relations
      const batchEntities = batchItems.filter(item => item.type === 'entity');
      const batchRelations = batchItems.filter(item => item.type === 'relation');
      const onlineEntities = onlineItems.filter(item => item.type === 'entity');
      const onlineRelations = onlineItems.filter(item => item.type === 'relation');

      // Deduplicate entities by name - batch takes precedence
      const entityMap = new Map();

      // First add all batch entities
      for (const entity of batchEntities) {
        entityMap.set(entity.name, entity);
      }

      // Then add online entities only if not already present
      for (const entity of onlineEntities) {
        if (!entityMap.has(entity.name)) {
          entityMap.set(entity.name, entity);
        } else {
          this.logger.info(`Skipping duplicate online entity: ${entity.name} (batch version kept)`);
        }
      }

      // Deduplicate relations by from-to-relationType combination
      const relationMap = new Map();
      const relationKey = (rel) => `${rel.from}|${rel.relationType}|${rel.to}`;

      for (const relation of [...batchRelations, ...onlineRelations]) {
        const key = relationKey(relation);
        if (!relationMap.has(key)) {
          relationMap.set(key, relation);
        }
      }

      // Convert back to arrays
      const deduplicatedEntities = Array.from(entityMap.values());
      const deduplicatedRelations = Array.from(relationMap.values());

      this.logger.info(`Combined view: ${deduplicatedEntities.length} entities (${batchEntities.length} batch, ${onlineEntities.length} online, ${onlineEntities.length - (deduplicatedEntities.length - batchEntities.length)} duplicates removed)`);
      this.logger.info(`Combined view: ${deduplicatedRelations.length} relations (${batchRelations.length} batch, ${onlineRelations.length} online)`);

      // Combine deduplicated data
      const combinedItems = [...deduplicatedEntities, ...deduplicatedRelations];
      const combined = combinedItems.map(item => JSON.stringify(item)).join('\n');

      // Write combined file
      await fs.writeFile(combinedPath, combined, 'utf8');

      // In combined mode, memory.json should be the combined data for frontend auto-load
      const memoryPath = path.join(distDir, 'memory.json');
      await fs.writeFile(memoryPath, combined, 'utf8');
      this.logger.info('Created memory.json from combined data for frontend auto-load');

      this.logger.info(`Combined knowledge view created (${this.teams.length} teams)`);
    } catch (error) {
      this.logger.error(`Failed to create combined view: ${error.message}`);
    }
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
   * CRITICAL: Batch knowledge ALWAYS comes from JSON files (source of truth)
   * Database is ONLY used for online knowledge via exportOnlineKnowledge()
   */
  async processMemoryData() {
    const memoryDist = path.join(this.visualizerDir, 'dist', 'memory.json');

    // Always use JSON file processing for batch knowledge
    this.logger.info('Processing batch knowledge from JSON files...');
    await this.processMemoryDataFromJSON(memoryDist);
  }

  /**
   * Export manual (batch) knowledge from database to NDJSON format
   * ENHANCED: Database-first approach for VKB visualization
   *
   * NOTE: Relations are NOT stored in database - we load them from JSON files
   */
  async exportManualKnowledge() {
    const memoryDist = path.join(this.visualizerDir, 'dist', 'memory.json');

    try {
      // Ensure dist directory exists
      await fs.mkdir(path.dirname(memoryDist), { recursive: true });

      // Query manual knowledge entities from database for all configured teams
      const allEntities = [];
      const allRelations = [];

      for (const team of this.teams) {
        this.logger.info(`Querying manual knowledge for team: ${team}`);

        const result = await this.knowledgeExportService.exportToMemoryFormat({
          sourceFilter: 'manual',  // Only manual/batch knowledge
          projectFilter: team,      // Team-scoped
          limit: 5000,
          minConfidence: 0.0,       // Include all confidence levels
          includeRelations: false,  // Relations not in DB, will load from JSON
          similarityThreshold: 0.75
        });

        // Add source annotation for tracking
        result.entities.forEach(entity => {
          entity._source = `database (${team})`;
        });

        allEntities.push(...result.entities);

        // Load relations from GraphDB (relations ARE stored in database)
        if (this.databaseManager?.graphDB) {
          try {
            const graphRelations = await this.databaseManager.graphDB.queryRelations({
              team,
              limit: 5000
            });

            graphRelations.forEach(relation => {
              allRelations.push({
                from: relation.from_name,
                to: relation.to_name,
                relationType: relation.relation_type,
                confidence: relation.confidence,
                _source: `database (${team})`
              });
            });

            this.logger.info(`Loaded ${graphRelations.length} relations from GraphDB for team: ${team}`);
          } catch (err) {
            this.logger.warn(`Could not load relations from GraphDB for team ${team}: ${err.message}`);
          }
        } else {
          this.logger.warn(`GraphDB not available - relations not loaded for team: ${team}`);
        }
      }
      
      this.logger.info(`Queried ${allEntities.length} entities, ${allRelations.length} relations from database`);

      // Process entities to match frontend expectations (same as processMemoryDataFromJSON)
      const ndjsonLines = [];

      for (const entity of allEntities) {
        const processed = { ...entity, type: 'entity' };

        // Convert observations from object format to simple strings (CRITICAL for frontend)
        if (processed.observations && Array.isArray(processed.observations)) {
          if (processed.observations.length > 0 && typeof processed.observations[0] === 'object') {
            processed.observations = processed.observations.map(obs =>
              typeof obs === 'object' ? obs.content : obs
            );
          }
        }

        ndjsonLines.push(JSON.stringify(processed));
      }

      // Add relations with type field
      for (const relation of allRelations) {
        ndjsonLines.push(JSON.stringify({ ...relation, type: 'relation' }));
      }

      // Write NDJSON file
      await fs.writeFile(memoryDist, ndjsonLines.join('\n'), 'utf8');

      this.logger.info(`Exported manual knowledge to ${path.basename(memoryDist)}: ${allEntities.length} entities, ${allRelations.length} relations`);
      
    } catch (error) {
      this.logger.error(`Failed to export manual knowledge: ${error.message}`);
      throw error;
    }
  }

  /**
   * ENHANCED: Query knowledge from database and convert to NDJSON format
   */
  async processMemoryDataFromDatabase(outputPath) {
    try {
      const ndjsonLines = [];

      // Query all knowledge from Qdrant + SQLite
      const knowledgeItems = await this.queryAllKnowledgeFromDatabase();

      this.logger.info(`Retrieved ${knowledgeItems.entities.length} entities from database`);

      // Convert entities to VKB format with freshness data
      for (const item of knowledgeItems.entities) {
        const entity = await this.transformDatabaseEntityToVKBFormat(item);
        ndjsonLines.push(JSON.stringify(entity));
      }

      // Add relationships (extracted from Qdrant metadata or reconstructed)
      for (const relation of knowledgeItems.relations) {
        ndjsonLines.push(JSON.stringify(relation));
      }

      // Write NDJSON file
      await fs.writeFile(outputPath, ndjsonLines.join('\n'), 'utf8');

      this.logger.info(`Database knowledge exported: ${knowledgeItems.entities.length} entities, ${knowledgeItems.relations.length} relations`);
    } catch (error) {
      this.logger.error(`Failed to query database: ${error.message}`);
      this.logger.warn('Falling back to JSON file processing...');
      await this.processMemoryDataFromJSON(outputPath);
    }
  }

  /**
   * ENHANCED: Query all knowledge from database (Qdrant + SQLite)
   */
  async queryAllKnowledgeFromDatabase() {
    if (!this.databaseManager?.qdrantClient || !this.databaseManager?.sqliteDb) {
      throw new Error('Database backend not available');
    }

    const entities = [];
    const relations = [];
    const entityIds = new Set();

    // Query from both Qdrant collections
    const collections = ['knowledge_patterns', 'knowledge_patterns_small'];

    for (const collectionName of collections) {
      try {
        // Scroll through all points in collection
        const scrollResult = await this.databaseManager.qdrantClient.scroll(collectionName, {
          limit: 1000,
          with_payload: true,
          with_vector: false
        });

        for (const point of scrollResult.points) {
          const payload = point.payload;

          // Skip duplicates (same ID might appear in both collections)
          if (entityIds.has(payload.id)) {
            continue;
          }
          entityIds.add(payload.id);

          // Get freshness data from decay tracker if available
          let freshnessData = null;
          if (this.knowledgeDecayTracker) {
            try {
              const classification = await this.knowledgeDecayTracker.classifyKnowledge({
                id: payload.id,
                type: payload.type,
                extractedAt: payload.metadata?.extractedAt || payload.migratedAt
              });
              freshnessData = {
                freshness: classification.category,
                freshnessScore: classification.score,
                lastAccessed: classification.lastAccessed,
                age: classification.age
              };
            } catch {
              // Freshness tracking not available, skip
            }
          }

          entities.push({
            ...payload,
            _freshness: freshnessData
          });

          // Extract relationships from metadata (if stored)
          if (payload.relationships && Array.isArray(payload.relationships)) {
            for (const rel of payload.relationships) {
              relations.push({
                from: payload.name || payload.id,
                to: rel.to,
                relationType: rel.type || 'relates_to',
                _source: 'database'
              });
            }
          }
        }
      } catch (error) {
        this.logger.warn(`Could not query ${collectionName}: ${error.message}`);
      }
    }

    // Reconstruct relationships from entity connections
    // (e.g., if entities reference each other in observations or concepts)
    const reconstructedRelations = await this.reconstructRelationships(entities);
    relations.push(...reconstructedRelations);

    // Deduplicate relations
    const relationSet = new Set();
    const uniqueRelations = [];
    for (const relation of relations) {
      const key = `${relation.from}|${relation.relationType}|${relation.to}`;
      if (!relationSet.has(key)) {
        relationSet.add(key);
        uniqueRelations.push(relation);
      }
    }

    return {
      entities,
      relations: uniqueRelations
    };
  }

  /**
   * ENHANCED: Transform database entity to VKB format
   */
  async transformDatabaseEntityToVKBFormat(dbEntity) {
    const entity = {
      type: 'entity',
      name: dbEntity.name || dbEntity.id,
      entityType: dbEntity.type || 'unknown',
      observations: dbEntity.observations || [],
      _source: 'database',
      metadata: dbEntity.metadata || {}
    };

    // Add freshness visualization data
    if (dbEntity._freshness) {
      entity._freshness = dbEntity._freshness.freshness; // fresh/aging/stale/deprecated
      entity._freshnessScore = dbEntity._freshness.freshnessScore; // 0.0-1.0
      entity._freshnessAge = dbEntity._freshness.age; // days
      entity._freshnessLastAccessed = dbEntity._freshness.lastAccessed;
    }

    // Add knowledge type metadata for coloring
    if (dbEntity.type) {
      entity.metadata.knowledgeType = dbEntity.type;
    }

    // Add database-specific metadata
    entity.metadata.migratedFrom = dbEntity.migratedFrom;
    entity.metadata.migratedAt = dbEntity.migratedAt;
    entity.metadata.confidence = dbEntity.metadata?.confidence;

    return entity;
  }

  /**
   * ENHANCED: Reconstruct relationships from entity connections
   */
  async reconstructRelationships(entities) {
    const relations = [];
    const entityNameMap = new Map(entities.map(e => [e.name || e.id, e]));

    for (const entity of entities) {
      const name = entity.name || entity.id;

      // Extract mentions of other entities from observations
      if (entity.observations && Array.isArray(entity.observations)) {
        for (const obs of entity.observations) {
          if (typeof obs !== 'string') continue;

          // Find entity names mentioned in observation
          for (const [otherName, otherEntity] of entityNameMap.entries()) {
            if (otherName === name) continue;

            if (obs.includes(otherName)) {
              relations.push({
                from: name,
                to: otherName,
                relationType: 'mentions',
                _source: 'reconstructed'
              });
            }
          }
        }
      }

      // Extract relationships from concepts (if entity has concepts array)
      if (entity.concepts && Array.isArray(entity.concepts)) {
        for (const concept of entity.concepts) {
          if (typeof concept === 'object' && concept.name) {
            if (entityNameMap.has(concept.name)) {
              relations.push({
                from: name,
                to: concept.name,
                relationType: 'uses_concept',
                _source: 'reconstructed'
              });
            }
          }
        }
      }
    }

    return relations;
  }

  /**
   * Original JSON file processing (backward compatible)
   */
  async processMemoryDataFromJSON(outputPath) {
    // Check if ukb has already generated the NDJSON file
    try {
      await fs.access(outputPath);
      const stats = await fs.stat(outputPath);

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
        ndjsonLines.push(JSON.stringify({ ...relation, type: 'relation' }));
      }
    }

    // Write NDJSON file
    await fs.writeFile(outputPath, ndjsonLines.join('\n'), 'utf8');

    // Log summary
    const entityCount = entityMap.size;
    const relationCount = relationSet.size;
    this.logger.info(`Memory data converted to NDJSON format: ${entityCount} entities, ${relationCount} relations`);
  }
  
  /**
   * Get statistics about the knowledge base
   * ENHANCED: Supports database backend
   */
  async getStatistics() {
    // ENHANCED: Use database backend if available
    if (this.useDatabaseBackend && this.databaseManager) {
      return await this.getStatisticsFromDatabase();
    }

    // Fallback to JSON files
    return await this.getStatisticsFromJSON();
  }

  /**
   * ENHANCED: Get statistics from database
   */
  async getStatisticsFromDatabase() {
    try {
      if (!this.databaseManager?.qdrantClient || !this.databaseManager?.sqliteDb) {
        throw new Error('Database not available');
      }

      let totalEntities = 0;
      let totalRelations = 0;
      const freshnessStats = { fresh: 0, aging: 0, stale: 0, deprecated: 0 };

      // Count entities from Qdrant (use knowledge_patterns as primary)
      const countResult = await this.databaseManager.qdrantClient.count('knowledge_patterns');
      totalEntities = countResult.count;

      // Get freshness breakdown from knowledge extractions table
      try {
        const freshnessQuery = `
          SELECT
            COUNT(*) as total
          FROM knowledge_extractions
          WHERE project = ?
        `;
        const result = this.databaseManager.sqliteDb.prepare(freshnessQuery).get(this.projectRoot);
        if (result) {
          totalEntities = result.total;
        }

        // Calculate freshness categories (simplified without decay tracker)
        if (this.knowledgeDecayTracker) {
          const now = Date.now();
          const ages = this.databaseManager.sqliteDb.prepare(`
            SELECT extractedAt FROM knowledge_extractions WHERE project = ?
          `).all(this.projectRoot);

          for (const row of ages) {
            const age = (now - new Date(row.extractedAt).getTime()) / (1000 * 60 * 60 * 24);
            if (age < 30) freshnessStats.fresh++;
            else if (age < 90) freshnessStats.aging++;
            else if (age < 180) freshnessStats.stale++;
            else freshnessStats.deprecated++;
          }
        }
      } catch (error) {
        this.logger.warn(`Could not get freshness stats: ${error.message}`);
      }

      // Estimate relations (not directly stored, would need full query)
      // For now, use a rough estimate
      totalRelations = Math.floor(totalEntities * 1.5); // Avg 1.5 relations per entity

      return {
        entities: totalEntities,
        relations: totalRelations,
        freshness: freshnessStats,
        source: 'database'
      };
    } catch (error) {
      this.logger.warn(`Could not get database statistics: ${error.message}`);
      return await this.getStatisticsFromJSON();
    }
  }

  /**
   * Original JSON-based statistics (backward compatible)
   */
  async getStatisticsFromJSON() {
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
      relations: totalRelations,
      source: 'json'
    };
  }
}