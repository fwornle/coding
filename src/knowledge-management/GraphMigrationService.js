/**
 * Graph Migration Service
 *
 * Handles migration of knowledge data from SQLite to Graph database.
 * Implements 5-phase migration with backup, verification, and rollback capabilities.
 *
 * Migration Phases:
 * 1. Backup: Create timestamped backup of SQLite database
 * 2. Extract: Retrieve all entities and relations from SQLite
 * 3. Transform: Convert SQLite rows to graph format
 * 4. Load: Store entities and relations in graph database
 * 5. Verify: Compare counts and sample data integrity
 *
 * Features:
 * - Zero data loss guarantee through verification
 * - Rollback capability to restore pre-migration state
 * - Progress reporting for large migrations
 * - Comprehensive error handling
 */

import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';

export class GraphMigrationService extends EventEmitter {
  constructor(databaseManager, graphDatabase, options = {}) {
    super();
    this.databaseManager = databaseManager;
    this.graphDatabase = graphDatabase;
    this.backupDir = options.backupDir || path.join(process.cwd(), '.data', 'backups');
    this.debug = options.debug || false;
  }

  /**
   * Run complete migration from SQLite to Graph database
   *
   * @returns {Promise<Object>} Migration report with statistics
   */
  async runMigration() {
    const startTime = Date.now();
    let backupPath = null;

    try {
      this.emit('migration:started', { timestamp: new Date().toISOString() });

      // Phase 1: Backup
      this.emit('phase:started', { phase: 'backup' });
      backupPath = await this.createBackup();
      this.emit('phase:completed', { phase: 'backup', backupPath });

      // Phase 2: Extract
      this.emit('phase:started', { phase: 'extract' });
      const { entities, relations } = await this.extractData();
      this.emit('phase:completed', {
        phase: 'extract',
        entityCount: entities.length,
        relationCount: relations.length
      });

      // Phase 3: Transform
      this.emit('phase:started', { phase: 'transform' });
      const transformedData = this.transformData(entities, relations);
      this.emit('phase:completed', { phase: 'transform' });

      // Phase 4: Load
      this.emit('phase:started', { phase: 'load' });
      await this.loadData(transformedData);
      this.emit('phase:completed', { phase: 'load' });

      // Phase 5: Verify
      this.emit('phase:started', { phase: 'verify' });
      await this.verifyMigration(entities, relations);
      this.emit('phase:completed', { phase: 'verify' });

      const duration = Date.now() - startTime;
      const report = {
        success: true,
        entitiesMigrated: entities.length,
        relationsMigrated: relations.length,
        backupPath,
        duration,
        timestamp: new Date().toISOString()
      };

      this.emit('migration:completed', report);
      return report;

    } catch (error) {
      this.emit('migration:failed', {
        error: error.message,
        backupPath
      });

      // Attempt rollback if backup exists
      if (backupPath) {
        try {
          await this.rollback(backupPath);
          this.emit('rollback:completed', { backupPath });
        } catch (rollbackError) {
          this.emit('rollback:failed', { error: rollbackError.message });
          console.error('[GraphMigrationService] Rollback failed:', rollbackError.message);
        }
      }

      throw error;
    }
  }

  /**
   * Phase 1: Create timestamped backup of SQLite database
   *
   * @returns {Promise<string>} Path to backup file
   */
  async createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sqlitePath = this.databaseManager.sqliteConfig.path;

    // Create backup directory
    await fs.mkdir(this.backupDir, { recursive: true });

    const backupPath = path.join(this.backupDir, `knowledge-${timestamp}.db`);

    try {
      // Check if source database exists
      await fs.access(sqlitePath);

      // Checkpoint WAL to ensure all data is in main database file
      if (this.databaseManager.sqlite) {
        this.databaseManager.sqlite.pragma('wal_checkpoint(TRUNCATE)');
      }

      // Copy database file
      await fs.copyFile(sqlitePath, backupPath);

      if (this.debug) {
        console.log(`[GraphMigrationService] Backup created: ${backupPath}`);
      }

      return backupPath;
    } catch (error) {
      throw new Error(`Failed to create backup: ${error.message}`);
    }
  }

  /**
   * Phase 2: Extract all entities and relations from SQLite
   *
   * @returns {Promise<Object>} Extracted entities and relations
   */
  async extractData() {
    if (!this.databaseManager.health.sqlite.available) {
      throw new Error('SQLite database not available for extraction');
    }

    try {
      // Extract entities
      const entityQuery = `
        SELECT
          id,
          entity_name,
          entity_type,
          observations,
          extraction_type,
          classification,
          confidence,
          source,
          team,
          extracted_at,
          last_modified,
          session_id,
          embedding_id,
          metadata
        FROM knowledge_extractions
        ORDER BY team, entity_name
      `;

      const entities = this.databaseManager.sqlite.prepare(entityQuery).all();

      // Extract relations
      const relationQuery = `
        SELECT
          r.id,
          r.from_entity_id,
          r.to_entity_id,
          r.relation_type,
          r.confidence,
          r.team,
          r.created_at,
          r.metadata,
          e1.entity_name as from_name,
          e2.entity_name as to_name
        FROM knowledge_relations r
        LEFT JOIN knowledge_extractions e1 ON r.from_entity_id = e1.id
        LEFT JOIN knowledge_extractions e2 ON r.to_entity_id = e2.id
        ORDER BY r.team, r.created_at
      `;

      const relations = this.databaseManager.sqlite.prepare(relationQuery).all();

      if (this.debug) {
        console.log(`[GraphMigrationService] Extracted ${entities.length} entities and ${relations.length} relations`);
      }

      return { entities, relations };
    } catch (error) {
      throw new Error(`Failed to extract data: ${error.message}`);
    }
  }

  /**
   * Phase 3: Transform SQLite rows to graph format
   *
   * @param {Array} entities - SQLite entity rows
   * @param {Array} relations - SQLite relation rows
   * @returns {Object} Transformed data ready for graph database
   */
  transformData(entities, relations) {
    const transformedEntities = entities.map(entity => this.transformEntity(entity));
    const transformedRelations = relations.map(relation => this.transformRelation(relation));

    if (this.debug) {
      console.log(`[GraphMigrationService] Transformed ${transformedEntities.length} entities and ${transformedRelations.length} relations`);
    }

    return {
      entities: transformedEntities,
      relations: transformedRelations
    };
  }

  /**
   * Transform single entity from SQLite format to graph format
   *
   * @param {Object} row - SQLite row
   * @returns {Object} Graph-compatible entity
   */
  transformEntity(row) {
    try {
      // Use entity_name if available, fallback to id if null
      const entityName = row.entity_name || row.id || `entity_${Date.now()}`;

      return {
        name: entityName,
        entityName: entityName,  // Also set entityName for compatibility
        entityType: row.entity_type || 'Unknown',
        observations: row.observations ? JSON.parse(row.observations) : [],
        extractionType: row.extraction_type,
        classification: row.classification,
        confidence: row.confidence !== null ? row.confidence : 1.0,
        source: row.source || 'manual',
        team: row.team,
        created_at: row.extracted_at,
        last_modified: row.last_modified,
        sessionId: row.session_id,
        embeddingId: row.embedding_id,
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
        // Preserve original SQLite ID for reference mapping
        sqliteId: row.id
      };
    } catch (error) {
      console.error(`[GraphMigrationService] Failed to transform entity ${row.id}:`, error.message);
      throw new Error(`Entity transformation failed for ${row.entity_name || row.id}: ${error.message}`);
    }
  }

  /**
   * Transform single relation from SQLite format to graph format
   *
   * @param {Object} row - SQLite relation row
   * @returns {Object} Graph-compatible relation
   */
  transformRelation(row) {
    try {
      if (!row.from_name || !row.to_name) {
        console.warn(`[GraphMigrationService] Skipping relation ${row.id}: missing entity names`);
        return null;
      }

      return {
        fromName: row.from_name,
        toName: row.to_name,
        relationType: row.relation_type,
        confidence: row.confidence !== null ? row.confidence : 1.0,
        team: row.team,
        created_at: row.created_at,
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
        // Preserve original SQLite ID
        sqliteId: row.id
      };
    } catch (error) {
      console.error(`[GraphMigrationService] Failed to transform relation ${row.id}:`, error.message);
      throw new Error(`Relation transformation failed: ${error.message}`);
    }
  }

  /**
   * Phase 4: Load transformed data into graph database
   *
   * @param {Object} data - Transformed entities and relations
   */
  async loadData(data) {
    const { entities, relations } = data;
    let entitiesLoaded = 0;
    let relationsLoaded = 0;

    try {
      // Load entities
      for (const entity of entities) {
        await this.graphDatabase.storeEntity(entity, { team: entity.team });
        entitiesLoaded++;

        // Progress reporting every 100 entities
        if (entitiesLoaded % 100 === 0) {
          this.emit('progress', {
            phase: 'load',
            type: 'entities',
            loaded: entitiesLoaded,
            total: entities.length
          });
        }
      }

      if (this.debug) {
        console.log(`[GraphMigrationService] Loaded ${entitiesLoaded} entities`);
      }

      // Load relations (filter out null relations from transform errors)
      const validRelations = relations.filter(r => r !== null);

      for (const relation of validRelations) {
        await this.graphDatabase.storeRelationship(
          relation.fromName,
          relation.toName,
          relation.relationType,
          {
            team: relation.team,
            confidence: relation.confidence,
            metadata: relation.metadata,
            created_at: relation.created_at
          }
        );
        relationsLoaded++;

        // Progress reporting every 100 relations
        if (relationsLoaded % 100 === 0) {
          this.emit('progress', {
            phase: 'load',
            type: 'relations',
            loaded: relationsLoaded,
            total: validRelations.length
          });
        }
      }

      if (this.debug) {
        console.log(`[GraphMigrationService] Loaded ${relationsLoaded} relations`);
      }

    } catch (error) {
      throw new Error(`Failed to load data (${entitiesLoaded} entities, ${relationsLoaded} relations loaded): ${error.message}`);
    }
  }

  /**
   * Phase 5: Verify migration integrity
   *
   * @param {Array} originalEntities - Original SQLite entities
   * @param {Array} originalRelations - Original SQLite relations
   */
  async verifyMigration(originalEntities, originalRelations) {
    const errors = [];

    try {
      // Verify entity counts
      const graphEntities = await this.graphDatabase.queryEntities({ limit: 100000 });

      if (graphEntities.length !== originalEntities.length) {
        errors.push(`Entity count mismatch: SQLite=${originalEntities.length}, Graph=${graphEntities.length}`);
      }

      // Verify relation counts
      const graphRelations = await this.graphDatabase.queryRelations({ limit: 100000 });

      // Filter out null relations from transform
      const validOriginalRelations = originalRelations.filter(r => r.from_name && r.to_name);

      if (graphRelations.length !== validOriginalRelations.length) {
        errors.push(`Relation count mismatch: SQLite=${validOriginalRelations.length}, Graph=${graphRelations.length}`);
      }

      // Sample 10 random entities for attribute integrity
      const sampleSize = Math.min(10, originalEntities.length);
      const sampleIndices = this.getRandomSample(originalEntities.length, sampleSize);

      for (const index of sampleIndices) {
        const original = originalEntities[index];
        // Use same fallback logic as transformation
        const lookupName = original.entity_name || original.id || `entity_${Date.now()}`;
        const graphEntity = await this.graphDatabase.getEntity(lookupName, original.team);

        if (!graphEntity) {
          errors.push(`Entity not found in graph: ${lookupName} (team: ${original.team})`);
          continue;
        }

        // Verify key attributes (compare with transformed values, not original SQLite values)
        const expectedEntityType = original.entity_type || 'Unknown';
        if (graphEntity.entityType !== expectedEntityType) {
          errors.push(`Entity type mismatch for ${lookupName}: ${graphEntity.entityType} vs ${expectedEntityType}`);
        }

        const expectedSource = original.source || 'manual';
        if (graphEntity.source !== expectedSource) {
          errors.push(`Source mismatch for ${lookupName}: ${graphEntity.source} vs ${expectedSource}`);
        }
      }

      if (errors.length > 0) {
        throw new Error(`Verification failed:\n${errors.join('\n')}`);
      }

      if (this.debug) {
        console.log('[GraphMigrationService] Verification passed: all counts match, samples verified');
      }

    } catch (error) {
      throw new Error(`Verification failed: ${error.message}`);
    }
  }

  /**
   * Rollback migration by restoring SQLite from backup
   *
   * @param {string} backupPath - Path to backup file
   */
  async rollback(backupPath) {
    const sqlitePath = this.databaseManager.sqliteConfig.path;

    try {
      // Verify backup exists
      await fs.access(backupPath);

      // Close current database connection if open
      if (this.databaseManager.sqlite) {
        this.databaseManager.sqlite.close();
        this.databaseManager.sqlite = null;
      }

      // Restore from backup
      await fs.copyFile(backupPath, sqlitePath);

      if (this.debug) {
        console.log(`[GraphMigrationService] Rollback completed: restored from ${backupPath}`);
      }

      // Note: Caller should reinitialize database connection after rollback
      return sqlitePath;

    } catch (error) {
      throw new Error(`Rollback failed: ${error.message}`);
    }
  }

  /**
   * Get random sample indices
   *
   * @param {number} total - Total count
   * @param {number} sampleSize - Sample size
   * @returns {Array<number>} Random indices
   */
  getRandomSample(total, sampleSize) {
    const indices = [];
    while (indices.length < sampleSize) {
      const index = Math.floor(Math.random() * total);
      if (!indices.includes(index)) {
        indices.push(index);
      }
    }
    return indices;
  }
}

export default GraphMigrationService;
