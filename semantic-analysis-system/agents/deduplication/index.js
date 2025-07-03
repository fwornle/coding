/**
 * Deduplication Agent
 * Detects and merges semantically similar entities using embeddings
 */

import { BaseAgent } from '../../framework/base-agent.js';
import { EmbeddingGenerator } from './generators/embedding-generator.js';
import { SimilarityDetector } from './detectors/similarity-detector.js';
import { EntityMerger } from './mergers/entity-merger.js';
import { EventTypes } from '../../infrastructure/events/event-types.js';
import { Logger } from '../../shared/logger.js';

export class DeduplicationAgent extends BaseAgent {
  constructor(config) {
    super({
      id: 'deduplication',
      ...config
    });
    
    this.embeddingGenerator = null;
    this.similarityDetector = null;
    this.entityMerger = null;
    this.embeddingCache = new Map();
    this.mergeHistory = new Map();
    this.isProcessing = false;
  }

  async onInitialize() {
    this.logger.info('Initializing Deduplication Agent...');
    
    // Initialize components
    this.embeddingGenerator = new EmbeddingGenerator(this.config.embedding);
    this.similarityDetector = new SimilarityDetector(this.config.similarity);
    this.entityMerger = new EntityMerger(this.config.merging);
    
    // Register request handlers
    this.registerRequestHandlers();
    
    // Subscribe to events
    await this.subscribeToEvents();
    
    // Initialize embedding model
    await this.embeddingGenerator.initialize();
    
    // Start periodic deduplication (disabled to prevent background interference)
    // this.startPeriodicDeduplication();
    
    this.logger.info('Deduplication Agent initialized successfully');
  }

  registerRequestHandlers() {
    // Deduplication operations
    this.registerRequestHandler('deduplication/check',
      this.handleDeduplicationCheckRequest.bind(this));
    
    this.registerRequestHandler('deduplication/analyze',
      this.handleDeduplicationAnalysisRequest.bind(this));
    
    this.registerRequestHandler('deduplication/merge',
      this.handleMergeRequest.bind(this));
    
    this.registerRequestHandler('deduplication/group',
      this.handleGroupRequest.bind(this));
    
    // Similarity operations
    this.registerRequestHandler('deduplication/similarity/calculate',
      this.handleSimilarityCalculationRequest.bind(this));
    
    this.registerRequestHandler('deduplication/similarity/find',
      this.handleFindSimilarRequest.bind(this));
    
    // Embedding operations
    this.registerRequestHandler('deduplication/embedding/generate',
      this.handleEmbeddingGenerationRequest.bind(this));
    
    this.registerRequestHandler('deduplication/embedding/clear-cache',
      this.handleClearEmbeddingCacheRequest.bind(this));
  }

  async subscribeToEvents() {
    // Subscribe to entity creation for proactive deduplication
    await this.subscribe(EventTypes.ENTITY_CREATED,
      this.handleEntityCreated.bind(this));
    
    await this.subscribe(EventTypes.ENTITY_UPDATED,
      this.handleEntityUpdated.bind(this));
    
    // Subscribe to knowledge sync for batch deduplication
    await this.subscribe(EventTypes.KNOWLEDGE_SYNCED,
      this.handleKnowledgeSynced.bind(this));
  }

  async handleDeduplicationCheckRequest(data) {
    try {
      const { entity, threshold = 0.85, requestId } = data;
      
      this.logger.info(`Checking deduplication for entity: ${entity.name}`);
      
      // Generate embedding for the entity
      const embedding = await this.generateEntityEmbedding(entity);
      
      // Find similar entities
      const similarEntities = await this.findSimilarEntities(entity, embedding, threshold);
      
      const result = {
        entity: entity.name,
        similarCount: similarEntities.length,
        potentialDuplicates: similarEntities.map(sim => ({
          name: sim.entity.name,
          similarity: sim.similarity,
          recommendation: this.getRecommendation(sim.similarity)
        })),
        threshold
      };
      
      await this.publish('deduplication/check/completed', {
        requestId,
        result,
        status: 'completed'
      });
      
      return result;
      
    } catch (error) {
      this.logger.error('Deduplication check failed:', error);
      throw error;
    }
  }

  async handleDeduplicationAnalysisRequest(data) {
    try {
      const { scope = 'all', threshold = 0.85, requestId } = data;
      
      this.logger.info(`Analyzing knowledge base for duplicates (scope: ${scope})`);
      
      // Get all entities from knowledge graph
      const entities = await this.getEntitiesForScope(scope);
      
      // Analyze for duplicates
      const analysis = await this.analyzeForDuplicates(entities, threshold);
      
      await this.publish('deduplication/analysis/completed', {
        requestId,
        analysis,
        status: 'completed'
      });
      
      return analysis;
      
    } catch (error) {
      this.logger.error('Deduplication analysis failed:', error);
      throw error;
    }
  }

  async handleMergeRequest(data) {
    try {
      const { sourceEntityId, targetEntityId, strategy = 'auto', requestId } = data;
      
      this.logger.info(`Merging entities: ${sourceEntityId} -> ${targetEntityId}`);
      
      // Get entities
      const sourceEntity = await this.getEntity(sourceEntityId);
      const targetEntity = await this.getEntity(targetEntityId);
      
      if (!sourceEntity || !targetEntity) {
        throw new Error('One or both entities not found');
      }
      
      // Perform merge
      const mergedEntity = await this.entityMerger.merge(
        sourceEntity,
        targetEntity,
        strategy
      );
      
      // Update knowledge graph
      await this.updateEntity(targetEntityId, mergedEntity);
      await this.removeEntity(sourceEntityId);
      
      // Record merge history
      this.recordMerge(sourceEntityId, targetEntityId, mergedEntity);
      
      await this.publish('deduplication/merge/completed', {
        requestId,
        mergedEntity,
        sourceRemoved: sourceEntityId,
        status: 'completed'
      });
      
      return mergedEntity;
      
    } catch (error) {
      this.logger.error('Entity merge failed:', error);
      throw error;
    }
  }

  async handleGroupRequest(data) {
    try {
      const { entities, groupName, threshold = 0.75, requestId } = data;
      
      this.logger.info(`Creating group: ${groupName} with ${entities.length} entities`);
      
      // Create entity group
      const group = await this.createEntityGroup(entities, groupName, threshold);
      
      await this.publish('deduplication/group/created', {
        requestId,
        group,
        status: 'completed'
      });
      
      return group;
      
    } catch (error) {
      this.logger.error('Group creation failed:', error);
      throw error;
    }
  }

  async handleSimilarityCalculationRequest(data) {
    try {
      const { entity1, entity2, requestId } = data;
      
      // Generate embeddings
      const embedding1 = await this.generateEntityEmbedding(entity1);
      const embedding2 = await this.generateEntityEmbedding(entity2);
      
      // Calculate similarity
      const similarity = this.similarityDetector.calculateSimilarity(embedding1, embedding2);
      
      const result = {
        entity1: entity1.name,
        entity2: entity2.name,
        similarity,
        recommendation: this.getRecommendation(similarity)
      };
      
      await this.publish('deduplication/similarity/calculated', {
        requestId,
        result,
        status: 'completed'
      });
      
      return result;
      
    } catch (error) {
      this.logger.error('Similarity calculation failed:', error);
      throw error;
    }
  }

  async handleFindSimilarRequest(data) {
    try {
      const { entity, limit = 10, threshold = 0.7, requestId } = data;
      
      // Generate embedding
      const embedding = await this.generateEntityEmbedding(entity);
      
      // Find similar entities
      const similarEntities = await this.findSimilarEntities(entity, embedding, threshold, limit);
      
      await this.publish('deduplication/similar/found', {
        requestId,
        entity: entity.name,
        similar: similarEntities,
        status: 'completed'
      });
      
      return similarEntities;
      
    } catch (error) {
      this.logger.error('Find similar failed:', error);
      throw error;
    }
  }

  async handleEmbeddingGenerationRequest(data) {
    try {
      const { entity, requestId } = data;
      
      const embedding = await this.generateEntityEmbedding(entity, true); // Force regeneration
      
      await this.publish('deduplication/embedding/generated', {
        requestId,
        entityName: entity.name,
        embeddingSize: embedding.length,
        status: 'completed'
      });
      
      return {
        entityName: entity.name,
        embedding
      };
      
    } catch (error) {
      this.logger.error('Embedding generation failed:', error);
      throw error;
    }
  }

  async handleClearEmbeddingCacheRequest(data) {
    try {
      const { requestId } = data;
      
      const cacheSize = this.embeddingCache.size;
      this.embeddingCache.clear();
      
      await this.publish('deduplication/embedding/cache-cleared', {
        requestId,
        entriesCleared: cacheSize,
        status: 'completed'
      });
      
      return { entriesCleared: cacheSize };
      
    } catch (error) {
      this.logger.error('Cache clear failed:', error);
      throw error;
    }
  }

  async handleEntityCreated(data) {
    try {
      const { entity } = data;
      
      // Check for duplicates when new entity is created
      const threshold = this.config.autoCheckThreshold || 0.9;
      const similarEntities = await this.findSimilarEntities(entity, null, threshold, 5);
      
      if (similarEntities.length > 0) {
        // Publish duplicate warning
        await this.publish('deduplication/duplicate/detected', {
          entity: entity.name,
          duplicates: similarEntities,
          severity: this.calculateDuplicateSeverity(similarEntities)
        });
        
        // Auto-merge if configured and similarity is very high
        if (this.config.autoMerge && similarEntities[0].similarity >= 0.95) {
          await this.autoMerge(entity, similarEntities[0].entity);
        }
      }
      
    } catch (error) {
      this.logger.warn('Failed to check duplicates for new entity:', error.message);
    }
  }

  async handleEntityUpdated(data) {
    try {
      const { entity } = data;
      
      // Invalidate embedding cache for updated entity
      const cacheKey = this.getEntityCacheKey(entity);
      this.embeddingCache.delete(cacheKey);
      
      // Re-check for duplicates with updated content
      await this.handleEntityCreated(data);
      
    } catch (error) {
      this.logger.warn('Failed to handle entity update for deduplication:', error.message);
    }
  }

  async handleKnowledgeSynced(data) {
    try {
      // Perform batch deduplication after sync
      if (this.config.batchDeduplicationEnabled) {
        await this.performBatchDeduplication();
      }
      
    } catch (error) {
      this.logger.warn('Failed to perform batch deduplication after sync:', error.message);
    }
  }

  async generateEntityEmbedding(entity, forceRegenerate = false) {
    const cacheKey = this.getEntityCacheKey(entity);
    
    // Check cache
    if (!forceRegenerate && this.embeddingCache.has(cacheKey)) {
      return this.embeddingCache.get(cacheKey);
    }
    
    // Generate content for embedding
    const content = this.prepareEntityContent(entity);
    
    // Generate embedding
    const embedding = await this.embeddingGenerator.generateEmbedding(content);
    
    // Cache embedding
    this.embeddingCache.set(cacheKey, embedding);
    
    return embedding;
  }

  prepareEntityContent(entity) {
    // Combine relevant entity fields for embedding
    const parts = [
      entity.name,
      entity.entityType,
      ...(entity.observations || [])
    ];
    
    // Add metadata if relevant
    if (entity.metadata?.description) {
      parts.push(entity.metadata.description);
    }
    
    if (entity.metadata?.technologies) {
      parts.push(...entity.metadata.technologies);
    }
    
    return parts.filter(Boolean).join(' ');
  }

  async findSimilarEntities(entity, embedding = null, threshold = 0.7, limit = 10) {
    // Generate embedding if not provided
    if (!embedding) {
      embedding = await this.generateEntityEmbedding(entity);
    }
    
    // Get all entities from knowledge graph
    const allEntities = await this.getAllEntities();
    
    // Calculate similarities
    const similarities = [];
    
    for (const otherEntity of allEntities) {
      // Skip self
      if (otherEntity.id === entity.id) continue;
      
      // Generate embedding for other entity
      const otherEmbedding = await this.generateEntityEmbedding(otherEntity);
      
      // Calculate similarity
      const similarity = this.similarityDetector.calculateSimilarity(embedding, otherEmbedding);
      
      if (similarity >= threshold) {
        similarities.push({
          entity: otherEntity,
          similarity
        });
      }
    }
    
    // Sort by similarity descending
    similarities.sort((a, b) => b.similarity - a.similarity);
    
    // Return top results
    return similarities.slice(0, limit);
  }

  async analyzeForDuplicates(entities, threshold = 0.85) {
    const duplicateGroups = [];
    const processed = new Set();
    
    for (let i = 0; i < entities.length; i++) {
      if (processed.has(entities[i].id)) continue;
      
      const entity = entities[i];
      const embedding = await this.generateEntityEmbedding(entity);
      const group = {
        primary: entity,
        duplicates: []
      };
      
      for (let j = i + 1; j < entities.length; j++) {
        if (processed.has(entities[j].id)) continue;
        
        const otherEntity = entities[j];
        const otherEmbedding = await this.generateEntityEmbedding(otherEntity);
        
        const similarity = this.similarityDetector.calculateSimilarity(embedding, otherEmbedding);
        
        if (similarity >= threshold) {
          group.duplicates.push({
            entity: otherEntity,
            similarity
          });
          processed.add(otherEntity.id);
        }
      }
      
      if (group.duplicates.length > 0) {
        duplicateGroups.push(group);
        processed.add(entity.id);
      }
    }
    
    return {
      totalEntities: entities.length,
      duplicateGroups: duplicateGroups.length,
      groups: duplicateGroups,
      potentialMerges: this.calculatePotentialMerges(duplicateGroups),
      spaceReduction: this.calculateSpaceReduction(duplicateGroups)
    };
  }

  async performBatchDeduplication() {
    if (this.isProcessing) {
      this.logger.debug('Batch deduplication already in progress');
      return;
    }
    
    this.isProcessing = true;
    
    try {
      this.logger.info('Starting batch deduplication...');
      
      const analysis = await this.analyzeForDuplicates(
        await this.getAllEntities(),
        this.config.batchThreshold || 0.9
      );
      
      // Auto-merge high confidence duplicates
      if (this.config.autoMergeBatch) {
        for (const group of analysis.groups) {
          for (const duplicate of group.duplicates) {
            if (duplicate.similarity >= 0.95) {
              await this.autoMerge(duplicate.entity, group.primary);
            }
          }
        }
      }
      
      // Publish batch deduplication results
      await this.publish('deduplication/batch/completed', {
        analysis,
        timestamp: new Date().toISOString()
      });
      
      this.logger.info(`Batch deduplication completed: ${analysis.duplicateGroups} groups found`);
      
    } catch (error) {
      this.logger.error('Batch deduplication failed:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  async autoMerge(sourceEntity, targetEntity) {
    try {
      this.logger.info(`Auto-merging: ${sourceEntity.name} -> ${targetEntity.name}`);
      
      const mergedEntity = await this.entityMerger.merge(
        sourceEntity,
        targetEntity,
        'auto'
      );
      
      // Update target entity
      await this.updateEntity(targetEntity.id, mergedEntity);
      
      // Remove source entity
      await this.removeEntity(sourceEntity.id);
      
      // Record merge
      this.recordMerge(sourceEntity.id, targetEntity.id, mergedEntity);
      
      // Publish auto-merge event
      await this.publish('deduplication/auto-merge/completed', {
        source: sourceEntity.name,
        target: targetEntity.name,
        merged: mergedEntity
      });
      
    } catch (error) {
      this.logger.error('Auto-merge failed:', error);
    }
  }

  async createEntityGroup(entities, groupName, threshold) {
    const group = {
      id: `group_${Date.now()}`,
      name: groupName,
      type: 'EntityGroup',
      members: entities.map(e => e.id),
      threshold,
      created: new Date().toISOString(),
      metadata: {
        memberCount: entities.length,
        avgSimilarity: await this.calculateGroupSimilarity(entities)
      }
    };
    
    // Create group entity in knowledge graph
    await this.createEntity({
      name: groupName,
      entityType: 'EntityGroup',
      significance: 7,
      observations: [
        `Group of ${entities.length} similar entities`,
        `Similarity threshold: ${threshold}`,
        `Members: ${entities.map(e => e.name).join(', ')}`
      ],
      metadata: group.metadata
    });
    
    return group;
  }

  async calculateGroupSimilarity(entities) {
    if (entities.length < 2) return 1;
    
    let totalSimilarity = 0;
    let comparisons = 0;
    
    for (let i = 0; i < entities.length - 1; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const embedding1 = await this.generateEntityEmbedding(entities[i]);
        const embedding2 = await this.generateEntityEmbedding(entities[j]);
        
        totalSimilarity += this.similarityDetector.calculateSimilarity(embedding1, embedding2);
        comparisons++;
      }
    }
    
    return comparisons > 0 ? totalSimilarity / comparisons : 0;
  }

  recordMerge(sourceId, targetId, mergedEntity) {
    const mergeRecord = {
      sourceId,
      targetId,
      mergedEntity: mergedEntity.id,
      timestamp: new Date().toISOString()
    };
    
    this.mergeHistory.set(sourceId, mergeRecord);
    
    // Keep merge history limited
    if (this.mergeHistory.size > 1000) {
      const oldestKey = this.mergeHistory.keys().next().value;
      this.mergeHistory.delete(oldestKey);
    }
  }

  getRecommendation(similarity) {
    if (similarity >= 0.95) return 'auto-merge';
    if (similarity >= 0.90) return 'merge';
    if (similarity >= 0.80) return 'review';
    if (similarity >= 0.70) return 'group';
    return 'ignore';
  }

  calculateDuplicateSeverity(similarEntities) {
    const highSimilarity = similarEntities.filter(s => s.similarity >= 0.9).length;
    
    if (highSimilarity >= 3) return 'critical';
    if (highSimilarity >= 1) return 'high';
    if (similarEntities.length >= 3) return 'medium';
    return 'low';
  }

  calculatePotentialMerges(duplicateGroups) {
    let merges = 0;
    
    for (const group of duplicateGroups) {
      merges += group.duplicates.filter(d => d.similarity >= 0.9).length;
    }
    
    return merges;
  }

  calculateSpaceReduction(duplicateGroups) {
    let totalDuplicates = 0;
    
    for (const group of duplicateGroups) {
      totalDuplicates += group.duplicates.length;
    }
    
    return {
      entities: totalDuplicates,
      percentage: (totalDuplicates / (duplicateGroups.length + totalDuplicates)) * 100
    };
  }

  getEntityCacheKey(entity) {
    return `${entity.id}_${entity.updated || entity.created || ''}`;
  }

  async getEntitiesForScope(scope) {
    // This would connect to the knowledge graph agent
    // For now, returning mock implementation
    return [];
  }

  async getAllEntities() {
    // This would connect to the knowledge graph agent
    return [];
  }

  async getEntity(entityId) {
    // This would connect to the knowledge graph agent
    return null;
  }

  async createEntity(entity) {
    // This would use the knowledge graph agent
    await this.publish(EventTypes.ENTITY_CREATE_REQUESTED, entity);
  }

  async updateEntity(entityId, updates) {
    // This would use the knowledge graph agent
    await this.publish(EventTypes.ENTITY_UPDATED, { entityId, updates });
  }

  async removeEntity(entityId) {
    // This would use the knowledge graph agent
    await this.publish(EventTypes.ENTITY_REMOVED, { entityId });
  }

  startPeriodicDeduplication() {
    if (this.config.periodicDeduplication?.enabled) {
      const interval = this.config.periodicDeduplication.interval || 3600000; // 1 hour default
      
      setInterval(() => {
        this.performBatchDeduplication();
      }, interval);
      
      this.logger.info(`Periodic deduplication enabled: every ${interval}ms`);
    }
  }

  getCapabilities() {
    return [
      'embedding-generation',
      'similarity-detection',
      'entity-merging',
      'duplicate-detection',
      'auto-merge',
      'batch-deduplication',
      'entity-grouping',
      'merge-history',
      'cache-management'
    ];
  }

  getMetadata() {
    return {
      embeddingGenerator: this.embeddingGenerator?.getInfo(),
      similarityDetector: this.similarityDetector?.getInfo(),
      embeddingCacheSize: this.embeddingCache.size,
      mergeHistorySize: this.mergeHistory.size,
      isProcessing: this.isProcessing,
      config: this.config
    };
  }

  async onStop() {
    // Clear caches
    this.embeddingCache.clear();
    
    // Stop periodic deduplication if running
    
    this.logger.info('Deduplication Agent stopped');
  }
}