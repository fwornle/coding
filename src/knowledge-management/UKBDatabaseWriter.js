/**
 * UKB Database Writer
 *
 * Service for writing UKB (manual batch) knowledge directly to the database.
 * Replaces the old JSON file writing approach with direct database persistence.
 *
 * Features:
 * - Store entities with source='manual'
 * - Store relations between entities
 * - Generate embeddings for semantic search (optional)
 * - Team-scoped storage
 */

import crypto from 'crypto';
import { KnowledgeQueryService } from './KnowledgeQueryService.js';

export class UKBDatabaseWriter {
  constructor(databaseManager, options = {}) {
    this.databaseManager = databaseManager;
    this.queryService = new KnowledgeQueryService(
      databaseManager,
      databaseManager.graphDB,  // Pass Graph DB for delegation
      options
    );
    this.embeddingGenerator = options.embeddingGenerator || null;
    this.team = options.team || 'coding';
    this.debug = options.debug || false;
  }

  /**
   * Store an entity in the database
   *
   * @param {Object} entity - Entity object from UKB
   * @param {string} entity.name - Entity name
   * @param {string} entity.entityType - Entity type (Pattern, Architecture, etc.)
   * @param {Array<string>} entity.observations - List of observations
   * @param {number} entity.significance - Significance score (0-10)
   * @param {Object} entity.metadata - Additional metadata
   * @returns {Promise<string>} Entity ID
   */
  async storeEntity(entity) {
    const id = this.generateEntityId(entity.name);

    const entityData = {
      id,
      entityName: entity.name,
      entityType: entity.entityType || 'Pattern',
      observations: entity.observations || [],
      extractionType: entity.entityType || 'Pattern',
      classification: this.team,
      confidence: (entity.significance || 5) / 10, // Convert 0-10 to 0-1
      source: 'manual', // UKB creates manual knowledge
      team: this.team,
      sessionId: null, // No session for batch knowledge
      embeddingId: null, // Will be set if embeddings are generated
      metadata: {
        significance: entity.significance,
        originalMetadata: entity.metadata || {}
      }
    };

    try {
      await this.queryService.storeEntity(entityData);

      if (this.debug) {
        console.log(`[UKBDatabaseWriter] Stored entity: ${entity.name} (${id})`);
      }

      // Generate embedding if available
      if (this.embeddingGenerator) {
        await this.generateAndStoreEmbedding(id, entity);
      }

      return id;
    } catch (error) {
      console.error(`[UKBDatabaseWriter] Failed to store entity ${entity.name}:`, error);
      throw error;
    }
  }

  /**
   * Store a relation between entities
   *
   * @param {Object} relation - Relation object
   * @param {string} relation.from - Source entity name
   * @param {string} relation.to - Target entity name
   * @param {string} relation.type - Relation type
   * @param {number} relation.confidence - Confidence score (0-1)
   * @returns {Promise<string>} Relation ID
   */
  async storeRelation(relation) {
    const fromId = this.generateEntityId(relation.from);
    const toId = this.generateEntityId(relation.to);
    const id = this.generateRelationId(fromId, toId, relation.type);

    const relationData = {
      id,
      fromEntityName: relation.from,  // Pass entity names for GraphDatabase
      toEntityName: relation.to,
      fromEntityId: fromId,
      toEntityId: toId,
      relationType: relation.type || 'related_to',
      confidence: relation.confidence || 1.0,
      team: this.team,
      metadata: relation.metadata || {}
    };

    try {
      await this.queryService.storeRelation(relationData);

      if (this.debug) {
        console.log(`[UKBDatabaseWriter] Stored relation: ${relation.from} -> ${relation.to}`);
      }

      return id;
    } catch (error) {
      console.error(`[UKBDatabaseWriter] Failed to store relation:`, error);
      throw error;
    }
  }

  /**
   * Store multiple entities in a transaction
   *
   * @param {Array<Object>} entities - Array of entity objects
   * @returns {Promise<Array<string>>} Array of entity IDs
   */
  async storeEntities(entities) {
    const ids = [];

    for (const entity of entities) {
      try {
        const id = await this.storeEntity(entity);
        ids.push(id);
      } catch (error) {
        console.error(`[UKBDatabaseWriter] Failed to store entity ${entity.name}:`, error);
        // Continue with other entities
      }
    }

    return ids;
  }

  /**
   * Store multiple relations in a transaction
   *
   * @param {Array<Object>} relations - Array of relation objects
   * @returns {Promise<Array<string>>} Array of relation IDs
   */
  async storeRelations(relations) {
    const ids = [];

    for (const relation of relations) {
      try {
        const id = await this.storeRelation(relation);
        ids.push(id);
      } catch (error) {
        // Relations may fail if entities don't exist - that's okay
        if (this.debug) {
          console.warn(`[UKBDatabaseWriter] Skipped relation: ${relation.from} -> ${relation.to}`);
        }
      }
    }

    return ids;
  }

  /**
   * Generate and store embedding for an entity (optional)
   */
  async generateAndStoreEmbedding(entityId, entity) {
    if (!this.embeddingGenerator) {
      return null;
    }

    try {
      // Combine name and observations for embedding
      const text = `${entity.name}\n${entity.observations.join('\n')}`;

      // Generate embedding
      const embedding = await this.embeddingGenerator.generateEmbedding(text);

      // Store in Qdrant
      if (this.databaseManager.health.qdrant.available) {
        await this.databaseManager.storeVector(
          'knowledge_patterns_small',
          entityId,
          embedding,
          {
            entity_name: entity.name,
            entity_type: entity.entityType,
            team: this.team,
            source: 'manual'
          }
        );

        if (this.debug) {
          console.log(`[UKBDatabaseWriter] Stored embedding for: ${entity.name}`);
        }
      }

      return embedding;
    } catch (error) {
      console.warn(`[UKBDatabaseWriter] Failed to generate embedding for ${entity.name}:`, error);
      return null;
    }
  }

  /**
   * Generate deterministic entity ID from name
   */
  generateEntityId(name) {
    return crypto
      .createHash('sha256')
      .update(name)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Generate deterministic relation ID
   */
  generateRelationId(fromId, toId, type) {
    return crypto
      .createHash('sha256')
      .update(`${fromId}-${toId}-${type}`)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Export current team knowledge to JSON format (backward compatibility)
   *
   * @param {number} limit - Maximum entities to export
   * @returns {Promise<Object>} JSON object with entities and relations
   */
  async exportToJson(limit = 5000) {
    try {
      const entities = await this.queryService.queryEntities({
        team: this.team,
        source: 'manual',
        limit
      });

      const relations = await this.queryService.queryRelations({
        team: this.team
      });

      // Transform to UKB JSON format
      const jsonEntities = entities.map(e => ({
        name: e.entity_name,
        entityType: e.entity_type,
        observations: e.observations,
        significance: Math.round(e.confidence * 10), // Convert 0-1 back to 0-10
        metadata: e.metadata,
        type: 'entity'
      }));

      const jsonRelations = relations.map(r => ({
        from: r.from_name || r.from_entity_id,
        to: r.to_name || r.to_entity_id,
        type: r.relation_type,
        confidence: r.confidence,
        metadata: r.metadata
      }));

      return {
        entities: jsonEntities,
        relations: jsonRelations
      };
    } catch (error) {
      console.error('[UKBDatabaseWriter] Failed to export to JSON:', error);
      throw error;
    }
  }

  /**
   * Get statistics about stored knowledge for this team
   */
  async getStatistics() {
    return await this.queryService.getStatistics({ team: this.team });
  }
}

export default UKBDatabaseWriter;
