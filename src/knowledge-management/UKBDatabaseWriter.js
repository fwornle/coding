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
      // Default to 'manual' for UKB writes; explicit `entity.source`
      // wins so the consolidator's online-learning path can mark its
      // entities as 'online' (rendered red/pink in the viewer).
      source: entity.source || 'manual',
      team: this.team,
      sessionId: null, // No session for batch knowledge
      embeddingId: null, // Will be set if embeddings are generated
      metadata: {
        significance: entity.significance,
        originalMetadata: entity.metadata || {},
        // Hoist ontology to top-level metadata for direct access by VKB viewer
        ...(entity.metadata?.ontology ? { ontology: entity.metadata.ontology } : {})
      }
    };
    // Preserve original creation timestamp when updating an existing
    // entity (the GraphDB merge already does this, but pass it through
    // explicitly so the SQLite fallback path doesn't reset it).
    if (entity.created_at) entityData.created_at = entity.created_at;

    // Forward hierarchy fields if present
    if (entity.parentEntityName !== undefined) entityData.parentEntityName = entity.parentEntityName;
    if (entity.hierarchyLevel !== undefined) entityData.hierarchyLevel = entity.hierarchyLevel;
    if (entity.isScaffoldNode !== undefined) entityData.isScaffoldNode = entity.isScaffoldNode;
    if (entity.childEntityNames !== undefined) entityData.childEntityNames = entity.childEntityNames;

    // Forward operator-enriched fields if present
    if (entity.embedding !== undefined) entityData.embedding = entity.embedding;
    if (entity.role !== undefined) entityData.role = entity.role;
    if (entity.enrichedContext !== undefined) entityData.enrichedContext = entity.enrichedContext;

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
   * Update an existing entity in the database
   *
   * @param {string} entityName - Name of the entity to update
   * @param {Object} updates - Updates to apply (observations, significance, etc.)
   * @returns {Promise<string>} Entity ID
   */
  async updateEntity(entityName, updates) {
    // For GraphDB/LevelDB, storing with the same name will overwrite
    const entityData = {
      name: entityName,
      entityType: updates.entityType,
      observations: updates.observations,
      significance: updates.significance,
      metadata: {
        ...updates.metadata,
        last_updated: new Date().toISOString()
      }
    };
    // Forward hierarchy fields if present
    if (updates.parentEntityName !== undefined) entityData.parentEntityName = updates.parentEntityName;
    if (updates.hierarchyLevel !== undefined) entityData.hierarchyLevel = updates.hierarchyLevel;
    if (updates.isScaffoldNode !== undefined) entityData.isScaffoldNode = updates.isScaffoldNode;
    if (updates.childEntityNames !== undefined) entityData.childEntityNames = updates.childEntityNames;

    // Forward operator-enriched fields if present
    if (updates.embedding !== undefined) entityData.embedding = updates.embedding;
    if (updates.role !== undefined) entityData.role = updates.role;
    if (updates.enrichedContext !== undefined) entityData.enrichedContext = updates.enrichedContext;

    // Preserve provenance fields when an entity already exists. Without
    // this, every cleanup-style PUT (e.g. dedup, re-export, casing
    // canonicalization) would relabel an entity that was originally
    // online-extracted as `manual`. Read the existing record from
    // GraphDB and forward its source + created_at so the merge in
    // GraphDatabaseService.storeEntity preserves the original tier.
    const graphDB = this.databaseManager?.graphDB;
    if (graphDB?.graph) {
      const nodeId = `${this.team}:${entityName}`;
      if (graphDB.graph.hasNode(nodeId)) {
        const existing = graphDB.graph.getNodeAttributes(nodeId);
        if (existing.source && updates.source === undefined) {
          entityData.source = existing.source;
        }
        if (existing.created_at) {
          entityData.created_at = existing.created_at;
        }
      }
    }
    if (updates.source !== undefined) entityData.source = updates.source;

    if (this.debug) {
      process.stderr.write(`[UKBDatabaseWriter] Updating entity: ${entityName}\n`);
    }

    return await this.storeEntity(entityData);
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
