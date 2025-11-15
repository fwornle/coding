/**
 * GraphKnowledgeImporter
 *
 * Imports knowledge from git-tracked JSON files into Graphology/LevelDB.
 * Supports team-specific imports with conflict resolution.
 *
 * Architecture:
 * - Reads from .data/knowledge-export/<team>.json
 * - Writes to GraphDatabaseService (in-memory graph + LevelDB)
 * - Conflict resolution: newest-wins (based on last_updated timestamp)
 * - Auto-import on startup (optional)
 *
 * Design patterns:
 * - Team isolation (namespace nodes with team prefix)
 * - Graceful error handling (logs warnings, continues)
 * - Validation (ensures required fields present)
 */

import fs from 'fs/promises';
import path from 'path';
import { getKnowledgeExportPath, getKnowledgeConfigPath, getCodingRepoPath } from './knowledge-paths.js';

export class GraphKnowledgeImporter {
  /**
   * Create a GraphKnowledgeImporter instance
   *
   * @param {GraphDatabaseService} graphService - Graph database instance
   * @param {Object} options - Configuration options
   * @param {string} [options.exportDir] - Export directory path
   * @param {string} [options.configPath] - Knowledge config path
   * @param {string} [options.conflictResolution='newest-wins'] - Conflict resolution strategy
   * @param {boolean} [options.autoImportOnStartup=true] - Auto-import on initialization
   */
  constructor(graphService, options = {}) {
    this.graphService = graphService;
    // CRITICAL: Always use central export directory in coding/.data/knowledge-export
    this.exportDir = options.exportDir || getKnowledgeExportPath();
    this.configPath = options.configPath || getKnowledgeConfigPath();
    this.conflictResolution = options.conflictResolution || 'newest-wins';
    this.autoImportOnStartup = options.autoImportOnStartup !== false;

    // Track if service is initialized
    this.initialized = false;
  }

  /**
   * Initialize import service
   * Optionally triggers auto-import on startup
   *
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Perform auto-import if enabled
      if (this.autoImportOnStartup) {
        console.log('🔄 Auto-importing knowledge from JSON exports...');
        await this.importAllTeams();
      }

      this.initialized = true;
      console.log('✓ Graph knowledge importer initialized');

    } catch (error) {
      console.warn('⚠ Graph knowledge importer initialization failed:', error.message);
      throw error;
    }
  }

  /**
   * Import entities and relationships for a specific team
   *
   * @param {string} team - Team to import
   * @param {Object} [options={}] - Import options
   * @param {string} [options.inputPath] - Override input path
   * @param {boolean} [options.skipValidation=false] - Skip validation
   * @returns {Promise<{entitiesImported: number, relationsImported: number}>}
   */
  async importTeam(team, options = {}) {
    try {
      // Load config to get import path
      const config = await this._loadConfig();
      const teamConfig = config.teams[team];

      if (!teamConfig) {
        throw new Error(`Team "${team}" not found in knowledge-config.json`);
      }

      // Determine input path (resolve relative to coding repo root, not process.cwd())
      const codingRepo = getCodingRepoPath();
      const inputPath = options.inputPath || path.join(codingRepo, teamConfig.exportPath);

      // Check if file exists
      try {
        await fs.access(inputPath);
      } catch (error) {
        console.warn(`⚠ No export file found for team "${team}" at ${inputPath}`);
        return { entitiesImported: 0, entitiesSkipped: 0, relationsImported: 0, relationsSkipped: 0 };
      }

      // Read JSON file
      const content = await fs.readFile(inputPath, 'utf8');
      const data = JSON.parse(content);

      // Validate structure
      if (!options.skipValidation) {
        this._validateImportData(data);
      }

      // Import entities
      let entitiesImported = 0;
      let entitiesSkipped = 0;
      for (const entity of data.entities || []) {
        try {
          const result = await this._importEntity(entity, team);
          if (result.imported) {
            entitiesImported++;
          } else {
            entitiesSkipped++;
          }
        } catch (error) {
          console.warn(`Failed to import entity "${entity.name}":`, error.message);
        }
      }

      // Import relationships
      let relationsImported = 0;
      let relationsSkipped = 0;
      for (const relation of data.relations || []) {
        try {
          const result = await this._importRelation(relation, team);
          if (result.imported) {
            relationsImported++;
          } else {
            relationsSkipped++;
          }
        } catch (error) {
          console.warn(`Failed to import relation "${relation.from}" → "${relation.to}":`, error.message);
        }
      }

      console.log(`✓ Imported team "${team}": ${entitiesImported} entities (${entitiesSkipped} skipped), ${relationsImported} relations (${relationsSkipped} skipped) from ${inputPath}`);

      return { entitiesImported, entitiesSkipped, relationsImported, relationsSkipped };

    } catch (error) {
      console.error(`Import failed for team "${team}":`, error.message);
      throw error;
    }
  }

  /**
   * Import all teams configured in knowledge-config.json
   *
   * @returns {Promise<Object>} Map of team → import results
   */
  async importAllTeams() {
    const config = await this._loadConfig();
    const results = {};

    for (const team of Object.keys(config.teams)) {
      if (config.teams[team].enabled !== false) {
        try {
          results[team] = await this.importTeam(team);
        } catch (error) {
          console.warn(`Failed to import team "${team}":`, error.message);
          results[team] = { error: error.message };
        }
      }
    }

    return results;
  }

  /**
   * Import a single entity
   *
   * @param {Object} entity - Entity to import
   * @param {string} team - Team scope
   * @returns {Promise<{imported: boolean, reason?: string}>}
   * @private
   */
  async _importEntity(entity, team) {
    // Check if entity already exists
    const existing = await this.graphService.getEntity(entity.name, team);

    // Handle conflicts
    if (existing && this.conflictResolution === 'newest-wins') {
      const existingDate = new Date(existing.last_modified || existing.created_at || 0);
      const importDate = new Date(entity.metadata?.last_updated || entity.metadata?.created_at || 0);

      if (existingDate > importDate) {
        // Skip import - existing is newer
        console.log(`  ⏭ Skipping "${entity.name}" - DB version (${existingDate.toISOString()}) is newer than JSON (${importDate.toISOString()})`);
        return { imported: false, reason: 'db-newer' };
      } else if (existingDate.getTime() === importDate.getTime()) {
        // Same timestamp - skip to avoid unnecessary writes
        console.log(`  ⏭ Skipping "${entity.name}" - same timestamp (${existingDate.toISOString()})`);
        return { imported: false, reason: 'same-timestamp' };
      } else {
        // JSON is newer - log update
        console.log(`  ⬆️  Updating "${entity.name}" - JSON version (${importDate.toISOString()}) is newer than DB (${existingDate.toISOString()})`);
      }
    } else if (!existing) {
      console.log(`  ➕ Adding new entity "${entity.name}"`);
    }

    // Prepare entity for storage
    const entityData = {
      name: entity.name,
      entityType: entity.entityType,
      observations: entity.observations || [],
      significance: entity.significance,
      problem: entity.problem,
      solution: entity.solution,
      source: entity.source || 'manual',  // Preserve source field (auto/manual)
      created_at: entity.metadata?.created_at || new Date().toISOString(),
      last_modified: entity.metadata?.last_updated || new Date().toISOString()
    };

    // Store in graph database
    await this.graphService.storeEntity(entityData, { team });
    return { imported: true };
  }

  /**
   * Import a single relationship
   *
   * @param {Object} relation - Relationship to import
   * @param {string} team - Team scope
   * @returns {Promise<{imported: boolean, reason?: string}>}
   * @private
   */
  async _importRelation(relation, team) {
    // Verify both entities exist
    const fromEntity = await this.graphService.getEntity(relation.from, team);
    const toEntity = await this.graphService.getEntity(relation.to, team);

    if (!fromEntity) {
      throw new Error(`Source entity "${relation.from}" not found`);
    }
    if (!toEntity) {
      throw new Error(`Target entity "${relation.to}" not found`);
    }

    // Check if relation already exists (deduplicate)
    const fromId = `${team}:${relation.from}`;
    const toId = `${team}:${relation.to}`;
    const relationType = relation.relationType || relation.type || 'related-to';

    // Check if edge already exists with same type
    if (this.graphService.graph.hasDirectedEdge(fromId, toId)) {
      const existingEdges = this.graphService.graph.directedEdges(fromId, toId);
      const duplicate = existingEdges.some(edgeId => {
        const attrs = this.graphService.graph.getEdgeAttributes(edgeId);
        return attrs.type === relationType;
      });

      if (duplicate) {
        // Skip duplicate relation
        console.log(`  ⏭ Skipping relation "${relation.from}" → "${relation.to}" (${relationType}) - already exists`);
        return { imported: false, reason: 'duplicate' };
      }
    }

    // Store relationship
    console.log(`  ➕ Adding relation "${relation.from}" → "${relation.to}" (${relationType})`);
    await this.graphService.storeRelationship(
      relation.from,
      relation.to,
      relationType,
      {
        team,
        ...relation.metadata
      }
    );
    return { imported: true };
  }

  /**
   * Validate import data structure
   *
   * @param {Object} data - Import data
   * @throws {Error} If validation fails
   * @private
   */
  _validateImportData(data) {
    if (!data.entities || !Array.isArray(data.entities)) {
      throw new Error('Invalid import data: "entities" must be an array');
    }

    if (!data.relations || !Array.isArray(data.relations)) {
      throw new Error('Invalid import data: "relations" must be an array');
    }

    // Validate entities
    for (const entity of data.entities) {
      if (!entity.name) {
        throw new Error('Invalid entity: "name" is required');
      }
      if (!entity.entityType) {
        throw new Error(`Invalid entity "${entity.name}": "entityType" is required`);
      }
    }

    // Validate relations
    for (const relation of data.relations) {
      if (!relation.from) {
        throw new Error('Invalid relation: "from" is required');
      }
      if (!relation.to) {
        throw new Error('Invalid relation: "to" is required');
      }
    }
  }

  /**
   * Load knowledge configuration
   *
   * @returns {Promise<Object>} Configuration object
   * @private
   */
  async _loadConfig() {
    try {
      const content = await fs.readFile(this.configPath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      // Return default config if file doesn't exist
      return {
        teams: {},
        import: {
          autoImportOnStartup: true,
          conflictResolution: 'newest-wins'
        }
      };
    }
  }

  /**
   * Get import statistics for all teams
   *
   * @returns {Promise<Object>} Statistics about available imports
   */
  async getImportStats() {
    const config = await this._loadConfig();
    const stats = {};
    const codingRepo = getCodingRepoPath();

    for (const [team, teamConfig] of Object.entries(config.teams)) {
      const exportPath = path.join(codingRepo, teamConfig.exportPath);

      try {
        // Check if file exists
        await fs.access(exportPath);

        // Read file
        const content = await fs.readFile(exportPath, 'utf8');
        const data = JSON.parse(content);

        stats[team] = {
          exists: true,
          path: exportPath,
          entities: data.entities?.length || 0,
          relations: data.relations?.length || 0,
          lastExported: data.metadata?.exported_at || null
        };
      } catch (error) {
        stats[team] = {
          exists: false,
          path: exportPath,
          error: error.message
        };
      }
    }

    return stats;
  }
}
