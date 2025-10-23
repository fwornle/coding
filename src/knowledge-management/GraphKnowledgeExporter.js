/**
 * GraphKnowledgeExporter
 *
 * Exports knowledge from Graphology/LevelDB to git-track able JSON format.
 * Supports team-specific exports with pretty formatting for PR reviews.
 *
 * Architecture:
 * - Reads from GraphDatabaseService (in-memory graph + LevelDB)
 * - Writes to .data/knowledge-export/<team>.json
 * - Format: Pretty JSON matching shared-memory-*.json structure
 * - Auto-export on entity/relationship changes (debounced)
 *
 * Design patterns:
 * - Debounced writes (avoid excessive file I/O)
 * - Team isolation (separate export files per team)
 * - Graceful degradation (logs warnings, doesn't crash)
 */

import fs from 'fs/promises';
import path from 'path';

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
    this.exportDir = options.exportDir || path.join(process.cwd(), '.data', 'knowledge-export');
    this.configPath = options.configPath || path.join(process.cwd(), '.data', 'knowledge-config.json');
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

        this.graphService.on('relationship:stored', (event) => {
          this._scheduleExport(event.team);
        });

        console.log('✓ Graph knowledge exporter: auto-export enabled');
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
   * @returns {Promise<string>} Path to exported file
   */
  async exportTeam(team, options = {}) {
    try {
      // Load config to get export path
      const config = await this._loadConfig();
      const teamConfig = config.teams[team];

      if (!teamConfig) {
        throw new Error(`Team "${team}" not found in knowledge-config.json`);
      }

      // Determine output path
      const outputPath = options.outputPath || path.join(process.cwd(), teamConfig.exportPath);

      // Extract entities and relationships for this team
      const { entities, relations } = await this._extractTeamData(team);

      // Build export structure (matching shared-memory-*.json format)
      const exportData = {
        entities,
        relations,
        metadata: {
          version: '1.0.0',
          team,
          exported_at: new Date().toISOString(),
          total_entities: entities.length,
          total_relations: relations.length,
          description: teamConfig.description || `Knowledge base for team: ${team}`
        }
      };

      // Write to file with pretty formatting
      const jsonContent = this.prettyFormat
        ? JSON.stringify(exportData, null, 2)
        : JSON.stringify(exportData);

      await fs.writeFile(outputPath, jsonContent, 'utf8');

      console.log(`✓ Exported team "${team}": ${entities.length} entities, ${relations.length} relations → ${outputPath}`);

      return outputPath;

    } catch (error) {
      console.error(`Export failed for team "${team}":`, error.message);
      throw error;
    }
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
          significance: attributes.significance
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
    // Simple deterministic ID generation (matches old shared-memory format)
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
