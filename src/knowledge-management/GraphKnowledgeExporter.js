/**
 * GraphKnowledgeExporter
 *
 * Exports knowledge from Graphology/LevelDB to git-track able JSON format.
 * Supports team-specific exports with pretty formatting for PR reviews.
 *
 * Architecture:
 * - Reads from GraphDatabaseService (in-memory graph + LevelDB)
 * - Writes to .data/knowledge-export/<team>.json
 * - Format: Pretty JSON matching knowledge-export structure
 * - Auto-export on entity/relationship changes (debounced)
 *
 * Design patterns:
 * - Debounced writes (avoid excessive file I/O)
 * - Team isolation (separate export files per team)
 * - Graceful degradation (logs warnings, doesn't crash)
 */

import fs from 'fs/promises';
import path from 'path';
import { getKnowledgeExportPath, getKnowledgeConfigPath, getCodingRepoPath } from './knowledge-paths.js';

export class GraphKnowledgeExporter {
  /**
   * Create a GraphKnowledgeExporter instance
   *
   * @param {GraphDatabaseService} graphService - Graph database instance
   * @param {Object} options - Configuration options
   * @param {string} [options.exportDir] - Export directory path
   * @param {string} [options.configPath] - Knowledge config path
   * @param {number} [options.debounceMs=5000] - Debounce delay for auto-export
   * @param {boolean} [options.autoExport=true] - Enable auto-export on changes
   * @param {boolean} [options.prettyFormat=true] - Use pretty JSON formatting
   */
  constructor(graphService, options = {}) {
    this.graphService = graphService;
    // CRITICAL: Always use central export directory in coding/.data/knowledge-export
    this.exportDir = options.exportDir || getKnowledgeExportPath();
    this.configPath = options.configPath || getKnowledgeConfigPath();
    this.debounceMs = options.debounceMs !== undefined ? options.debounceMs : 5000;
    this.autoExport = options.autoExport !== false;
    this.prettyFormat = options.prettyFormat !== false;

    // Debounce timers per team
    this.exportTimers = new Map();

    // Track if service is initialized
    this.initialized = false;
  }

  /**
   * Initialize export service
   * Sets up event listeners for auto-export
   *
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Ensure export directory exists
      await fs.mkdir(this.exportDir, { recursive: true });

      // Set up auto-export listeners if enabled
      if (this.autoExport) {
        this.graphService.on('entity:stored', (event) => {
          this._scheduleExport(event.team);
        });

        this.graphService.on('entity:deleted', (event) => {
          this._scheduleExport(event.team);
        });

        this.graphService.on('relationship:stored', (event) => {
          this._scheduleExport(event.team);
        });

        this.graphService.on('relationship:deleted', (event) => {
          this._scheduleExport(event.team);
        });

        console.log('✓ Graph knowledge exporter: auto-export enabled (create/update/delete)');
      }

      this.initialized = true;
      console.log(`✓ Graph knowledge exporter initialized (export dir: ${this.exportDir})`);

    } catch (error) {
      console.warn('⚠ Graph knowledge exporter initialization failed:', error.message);
      throw error;
    }
  }

  /**
   * Schedule an export for a team (debounced)
   *
   * @param {string} team - Team to export
   * @private
   */
  _scheduleExport(team) {
    // Guard: skip if team is undefined/null (defensive against malformed events)
    if (!team || team === 'undefined') {
      console.warn('[GraphKnowledgeExporter] Skipping export for undefined team');
      return;
    }

    // Clear existing timer if present
    if (this.exportTimers.has(team)) {
      clearTimeout(this.exportTimers.get(team));
    }

    // Schedule new export
    const timer = setTimeout(async () => {
      try {
        await this.exportTeam(team);
        this.exportTimers.delete(team);
      } catch (error) {
        console.error(`Failed to auto-export team "${team}":`, error.message);
      }
    }, this.debounceMs);

    this.exportTimers.set(team, timer);
  }

  /**
   * Export all entities and relationships for a specific team
   *
   * @param {string} team - Team to export
   * @param {Object} [options={}] - Export options
   * @param {string} [options.outputPath] - Override output path
   * @param {boolean} [options.force] - Force export even if no content changes
   * @returns {Promise<string|null>} Path to exported file, or null if no changes
   */
  async exportTeam(team, options = {}) {
    try {
      // Load config to get export path
      const config = await this._loadConfig();
      const teamConfig = config.teams[team];

      if (!teamConfig) {
        throw new Error(`Team "${team}" not found in knowledge-config.json`);
      }

      // Determine output path (resolve relative to coding repo root, not process.cwd())
      const codingRepo = getCodingRepoPath();
      const outputPath = options.outputPath || path.join(codingRepo, teamConfig.exportPath);

      // Extract entities and relationships for this team
      const { entities, relations } = await this._extractTeamData(team);

      // Check if content actually changed before writing (avoid timestamp-only updates)
      if (!options.force) {
        const hasChanges = await this._hasContentChanges(outputPath, entities, relations);
        if (!hasChanges) {
          console.log(`○ Skipped export for team "${team}": no content changes detected`);
          return null;
        }
      }

      // Preserve timestamps from existing file for unchanged entities
      const entitiesWithPreservedTimestamps = await this._preserveUnchangedTimestamps(outputPath, entities);

      // Build export structure (matching knowledge-export format)
      const exportData = {
        entities: entitiesWithPreservedTimestamps,
        relations,
        metadata: {
          version: '1.0.0',
          team,
          exported_at: new Date().toISOString(),
          total_entities: entitiesWithPreservedTimestamps.length,
          total_relations: relations.length,
          description: teamConfig.description || `Knowledge base for team: ${team}`
        }
      };

      // Write to file with pretty formatting
      const jsonContent = this.prettyFormat
        ? JSON.stringify(exportData, null, 2)
        : JSON.stringify(exportData);

      await fs.writeFile(outputPath, jsonContent, 'utf8');

      console.log(`✓ Exported team "${team}": ${entitiesWithPreservedTimestamps.length} entities, ${relations.length} relations → ${outputPath}`);

      return outputPath;

    } catch (error) {
      console.error(`Export failed for team "${team}":`, error.message);
      throw error;
    }
  }

  /**
   * Preserve timestamps from existing file for entities that haven't changed
   * Only updates timestamps for entities with actual content changes
   *
   * @param {string} filePath - Path to existing export file
   * @param {Array} newEntities - New entities from graph
   * @returns {Promise<Array>} Entities with preserved timestamps where appropriate
   * @private
   */
  async _preserveUnchangedTimestamps(filePath, newEntities) {
    try {
      const existingContent = await fs.readFile(filePath, 'utf8');
      const existingData = JSON.parse(existingContent);

      // Build lookup map of existing entities by name
      const existingByName = new Map();
      for (const entity of (existingData.entities || [])) {
        existingByName.set(entity.name, entity);
      }

      let preservedCount = 0;
      let changedCount = 0;
      let newCount = 0;

      // For each new entity, check if it has changed
      const result = newEntities.map(newEntity => {
        const existing = existingByName.get(newEntity.name);

        if (!existing) {
          // New entity - use current timestamp
          newCount++;
          return newEntity;
        }

        // Check if content changed (compare normalized versions)
        const contentChanged = this._entityContentChanged(existing, newEntity);

        if (!contentChanged && existing.metadata?.last_updated) {
          // Content unchanged - preserve original timestamp
          preservedCount++;
          return {
            ...newEntity,
            metadata: {
              ...newEntity.metadata,
              created_at: existing.metadata.created_at || newEntity.metadata?.created_at,
              last_updated: existing.metadata.last_updated
            }
          };
        }

        // Content changed - use new timestamp
        changedCount++;
        return newEntity;
      });

      console.log(`[GraphKnowledgeExporter] Timestamp preservation: ${preservedCount} preserved, ${changedCount} changed, ${newCount} new`);
      return result;

    } catch (error) {
      // File doesn't exist or can't be read - return entities as-is
      console.log(`[GraphKnowledgeExporter] Cannot preserve timestamps: ${error.message}`);
      return newEntities;
    }
  }

  /**
   * Check if entity content has changed (ignoring timestamps)
   *
   * @param {Object} existing - Existing entity from file
   * @param {Object} newEntity - New entity from graph
   * @returns {boolean} True if content has changed
   * @private
   */
  _entityContentChanged(existing, newEntity) {
    // Compare key content fields
    if (existing.name !== newEntity.name) return true;
    if (existing.entityType !== newEntity.entityType) return true;
    if (existing.source !== newEntity.source) return true;
    if (existing.significance !== newEntity.significance) return true;

    // Compare observations (sorted)
    const existingObs = (existing.observations || []).map(o =>
      typeof o === 'string' ? o : (o.content || JSON.stringify(o))
    ).sort();
    const newObs = (newEntity.observations || []).map(o =>
      typeof o === 'string' ? o : (o.content || JSON.stringify(o))
    ).sort();

    if (JSON.stringify(existingObs) !== JSON.stringify(newObs)) return true;

    // Compare optional fields
    if (JSON.stringify(existing.problem) !== JSON.stringify(newEntity.problem)) return true;
    if (JSON.stringify(existing.solution) !== JSON.stringify(newEntity.solution)) return true;

    return false;
  }

  /**
   * Check if the content has actually changed compared to existing file
   * Compares entities and relations, ignoring metadata like timestamps
   *
   * @param {string} filePath - Path to existing export file
   * @param {Array} newEntities - New entities to compare
   * @param {Array} newRelations - New relations to compare
   * @returns {Promise<boolean>} True if content has changed
   * @private
   */
  async _hasContentChanges(filePath, newEntities, newRelations) {
    try {
      // If file doesn't exist, there are definitely changes
      const existingContent = await fs.readFile(filePath, 'utf8');
      const existingData = JSON.parse(existingContent);

      // Compare entity counts first (fast check)
      if (existingData.entities?.length !== newEntities.length) {
        return true;
      }
      if (existingData.relations?.length !== newRelations.length) {
        return true;
      }

      // Deep compare entities (sort for stable comparison)
      const sortedExisting = this._sortForComparison(existingData.entities, existingData.relations);
      const sortedNew = this._sortForComparison(newEntities, newRelations);

      // Compare stringified versions (excluding timestamps in metadata)
      const existingNormalized = JSON.stringify(sortedExisting);
      const newNormalized = JSON.stringify(sortedNew);

      return existingNormalized !== newNormalized;

    } catch (error) {
      // File doesn't exist or can't be read - treat as changed
      return true;
    }
  }

  /**
   * Sort entities and relations for stable comparison
   * Also normalizes by removing volatile fields like timestamps
   *
   * @param {Array} entities - Entities to sort
   * @param {Array} relations - Relations to sort
   * @returns {Object} Sorted and normalized data
   * @private
   */
  _sortForComparison(entities, relations) {
    // Normalize entities (remove volatile metadata like timestamps)
    const normalizedEntities = entities.map(e => ({
      name: e.name,
      entityType: e.entityType,
      // Normalize observations: extract content for objects, keep strings as-is, then sort
      observations: this._normalizeObservations(e.observations),
      significance: e.significance,
      source: e.source,
      problem: e.problem,
      solution: e.solution
    })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    // Normalize relations
    const normalizedRelations = relations.map(r => ({
      from: r.from,
      to: r.to,
      relationType: r.relationType
    })).sort((a, b) => {
      const aKey = `${a.from}|${a.relationType}|${a.to}`;
      const bKey = `${b.from}|${b.relationType}|${b.to}`;
      return aKey.localeCompare(bKey);
    });

    return { entities: normalizedEntities, relations: normalizedRelations };
  }

  /**
   * Normalize observations array for comparison
   * Extracts just the content from observation objects, ignoring dates and other metadata
   *
   * @param {Array} observations - Observations array (can be strings or objects)
   * @returns {Array} Normalized observations (strings only, sorted)
   * @private
   */
  _normalizeObservations(observations) {
    if (!observations || !Array.isArray(observations)) return [];

    return observations.map(obs => {
      if (typeof obs === 'string') return obs;
      if (typeof obs === 'object' && obs !== null) {
        // Extract content from observation objects, ignore type/date/metadata
        return obs.content || JSON.stringify(obs);
      }
      return String(obs);
    }).sort();
  }

  /**
   * Export all teams
   *
   * @returns {Promise<Object>} Map of team → export path
   */
  async exportAllTeams() {
    const config = await this._loadConfig();
    const results = {};

    for (const team of Object.keys(config.teams)) {
      if (config.teams[team].enabled !== false) {
        try {
          results[team] = await this.exportTeam(team);
        } catch (error) {
          console.warn(`Failed to export team "${team}":`, error.message);
          results[team] = { error: error.message };
        }
      }
    }

    return results;
  }

  /**
   * Extract entities and relationships for a specific team
   *
   * @param {string} team - Team name
   * @returns {Promise<{entities: Array, relations: Array}>}
   * @private
   */
  async _extractTeamData(team) {
    const graph = this.graphService.graph;
    const entities = [];
    const relations = [];

    // Extract entities (nodes with matching team)
    graph.forEachNode((nodeId, attributes) => {
      if (attributes.team === team) {
        // Build entity object (remove internal graph metadata)
        const entity = {
          name: attributes.name,
          entityType: attributes.entityType,
          observations: attributes.observations || [],
          significance: attributes.significance,
          source: attributes.source || 'manual'  // Export source field (manual/auto)
        };

        // Add metadata
        entity.metadata = {
          created_at: attributes.created_at,
          last_updated: attributes.last_modified
        };

        // Include optional fields
        if (attributes.problem) entity.problem = attributes.problem;
        if (attributes.solution) entity.solution = attributes.solution;

        // Generate ID for backward compatibility
        entity.id = this._generateEntityId(entity.name);

        entities.push(entity);
      }
    });

    // Extract relationships (edges connecting team nodes)
    graph.forEachEdge((edgeId, attributes, source, target, sourceAttributes, targetAttributes) => {
      // Only include edges where both nodes belong to the team
      if (sourceAttributes.team === team && targetAttributes.team === team) {
        relations.push({
          from: sourceAttributes.name,
          to: targetAttributes.name,
          relationType: attributes.type || 'related-to',
          metadata: attributes.metadata || {}
        });
      }
    });

    // LOG: Check for Coding → CollectiveKnowledge relations
    const codingToCollective = relations.filter(r =>
      r.from === 'Coding' && r.to === 'CollectiveKnowledge'
    );
    console.log(`🔍 [EXPORT] Team "${team}": ${entities.length} entities, ${relations.length} relations. Coding→CollectiveKnowledge: ${codingToCollective.length} found`);
    if (codingToCollective.length > 0) {
      console.log(`🔍 [EXPORT] Coding→CollectiveKnowledge relations:`, JSON.stringify(codingToCollective, null, 2));
    }

    return { entities, relations };
  }

  /**
   * Generate a unique ID for an entity (backward compatibility)
   *
   * @param {string} name - Entity name
   * @returns {string} Generated ID
   * @private
   */
  _generateEntityId(name) {
    // Simple deterministic ID generation (matches knowledge-export format)
    const hash = name.split('').reduce((acc, char) => {
      return ((acc << 5) - acc) + char.charCodeAt(0);
    }, 0);
    return 'mc4flkg' + Math.abs(hash).toString(36);
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
        export: {
          format: 'pretty-json',
          autoExport: true
        }
      };
    }
  }

  /**
   * Clean up timers on shutdown
   */
  async shutdown() {
    // Clear all pending export timers
    for (const timer of this.exportTimers.values()) {
      clearTimeout(timer);
    }
    this.exportTimers.clear();

    // Trigger final export for all pending teams
    const pendingTeams = Array.from(this.exportTimers.keys());
    for (const team of pendingTeams) {
      try {
        await this.exportTeam(team);
      } catch (error) {
        console.warn(`Final export failed for team "${team}":`, error.message);
      }
    }

    console.log('✓ Graph knowledge exporter shutdown');
  }
}
