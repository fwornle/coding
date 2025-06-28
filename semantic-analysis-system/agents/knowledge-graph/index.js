/**
 * Knowledge Graph Agent
 * Manages knowledge graph operations and integrates with existing ukb system
 */

import { BaseAgent } from '../../framework/base-agent.js';
import { KnowledgeAPI } from './providers/knowledge-api.js';
import { UkbIntegration } from './integrations/ukb-integration.js';
import { EntityProcessor } from './processors/entity-processor.js';
import { EventTypes } from '../../infrastructure/events/event-types.js';
import { Logger } from '../../shared/logger.js';

export class KnowledgeGraphAgent extends BaseAgent {
  constructor(config) {
    super({
      id: 'knowledge-graph',
      ...config
    });
    
    this.knowledgeAPI = null;
    this.ukbIntegration = null;
    this.entityProcessor = null;
    this.operationQueue = [];
    this.isProcessing = false;
  }

  async onInitialize() {
    this.logger.info('Initializing Knowledge Graph Agent...');
    
    // Initialize knowledge API
    this.knowledgeAPI = new KnowledgeAPI(this.config.knowledgeApi);
    
    // Initialize UKB integration
    this.ukbIntegration = new UkbIntegration(this.config.ukb);
    
    // Initialize entity processor
    this.entityProcessor = new EntityProcessor(this.config.processing);
    
    // Register request handlers
    this.registerRequestHandlers();
    
    // Subscribe to events
    await this.subscribeToEvents();
    
    // Start operation processor
    this.startOperationProcessor();
    
    this.logger.info('Knowledge Graph Agent initialized successfully');
  }

  registerRequestHandlers() {
    // Entity operations
    this.registerRequestHandler(EventTypes.ENTITY_CREATE_REQUESTED,
      this.handleEntityCreateRequest.bind(this));
    
    this.registerRequestHandler('knowledge/entity/update',
      this.handleEntityUpdateRequest.bind(this));
    
    this.registerRequestHandler('knowledge/entity/search',
      this.handleEntitySearchRequest.bind(this));
    
    // Relation operations
    this.registerRequestHandler(EventTypes.RELATION_CREATE_REQUESTED,
      this.handleRelationCreateRequest.bind(this));
    
    this.registerRequestHandler('knowledge/relation/search',
      this.handleRelationSearchRequest.bind(this));
    
    // Graph operations
    this.registerRequestHandler('knowledge/graph/export',
      this.handleGraphExportRequest.bind(this));
    
    this.registerRequestHandler('knowledge/graph/import',
      this.handleGraphImportRequest.bind(this));
    
    // Insight operations
    this.registerRequestHandler('knowledge/insights/extract',
      this.handleInsightExtractionRequest.bind(this));
    
    // UKB integration
    this.registerRequestHandler('knowledge/ukb/sync',
      this.handleUkbSyncRequest.bind(this));
  }

  async subscribeToEvents() {
    // Subscribe to analysis completion events for knowledge extraction
    await this.subscribe(EventTypes.CODE_ANALYSIS_COMPLETED,
      this.handleCodeAnalysisCompleted.bind(this));
    
    await this.subscribe(EventTypes.CONVERSATION_ANALYSIS_COMPLETED,
      this.handleConversationAnalysisCompleted.bind(this));
    
    await this.subscribe(EventTypes.WEB_SEARCH_COMPLETED,
      this.handleWebSearchCompleted.bind(this));
    
    // Subscribe to pattern detection events
    await this.subscribe(EventTypes.PATTERN_DETECTED,
      this.handlePatternDetected.bind(this));
    
    // Subscribe to knowledge updates
    await this.subscribe('knowledge/#', (data, topic) => {
      this.logger.debug(`Received knowledge event: ${topic}`);
    });
  }

  async handleEntityCreateRequest(data) {
    try {
      this.logger.info('Processing entity creation request:', data);
      
      const { name, entityType, significance, observations, metadata, requestId } = data;
      
      if (!name || !entityType) {
        throw new Error('Entity name and type are required');
      }

      // Process entity data
      const processedEntity = await this.entityProcessor.processEntity({
        name,
        entityType,
        significance: significance || 5,
        observations: observations || [],
        metadata: metadata || {}
      });

      // Create entity via knowledge API
      const entity = await this.knowledgeAPI.createEntity(processedEntity);
      
      // Sync with UKB if configured
      if (this.config.autoSyncUkb) {
        await this.ukbIntegration.syncEntity(entity);
      }

      // Publish success event
      await this.publish(EventTypes.ENTITY_CREATED, {
        requestId,
        entity,
        status: 'completed'
      });

      this.logger.info(`Entity created: ${entity.name}`);
      return entity;
      
    } catch (error) {
      this.logger.error('Entity creation failed:', error);
      
      await this.publish(EventTypes.AGENT_ERROR, {
        requestId: data.requestId,
        error: error.message,
        operation: 'entity-create'
      });
      
      throw error;
    }
  }

  async handleEntityUpdateRequest(data) {
    try {
      const { entityId, updates, requestId } = data;
      
      if (!entityId) {
        throw new Error('Entity ID is required for updates');
      }

      const updatedEntity = await this.knowledgeAPI.updateEntity(entityId, updates);
      
      if (this.config.autoSyncUkb) {
        await this.ukbIntegration.syncEntity(updatedEntity);
      }

      await this.publish('knowledge/entity/updated', {
        requestId,
        entity: updatedEntity,
        status: 'completed'
      });

      return updatedEntity;
      
    } catch (error) {
      this.logger.error('Entity update failed:', error);
      throw error;
    }
  }

  async handleEntitySearchRequest(data) {
    try {
      const { query, filters, requestId } = data;
      
      const results = await this.knowledgeAPI.searchEntities(query, filters);
      
      await this.publish('knowledge/entity/search/completed', {
        requestId,
        results,
        query,
        status: 'completed'
      });

      return results;
      
    } catch (error) {
      this.logger.error('Entity search failed:', error);
      throw error;
    }
  }

  async handleRelationCreateRequest(data) {
    try {
      this.logger.info('Processing relation creation request:', data);
      
      const { from, to, relationType, metadata, requestId } = data;
      
      if (!from || !to || !relationType) {
        throw new Error('From entity, to entity, and relation type are required');
      }

      const relation = await this.knowledgeAPI.createRelation({
        from,
        to,
        relationType,
        metadata: metadata || {}
      });
      
      if (this.config.autoSyncUkb) {
        await this.ukbIntegration.syncRelation(relation);
      }

      await this.publish(EventTypes.RELATION_CREATED, {
        requestId,
        relation,
        status: 'completed'
      });

      this.logger.info(`Relation created: ${from} -> ${to} (${relationType})`);
      return relation;
      
    } catch (error) {
      this.logger.error('Relation creation failed:', error);
      throw error;
    }
  }

  async handleRelationSearchRequest(data) {
    try {
      const { entityId, direction, relationType, requestId } = data;
      
      const relations = await this.knowledgeAPI.getRelations(entityId, {
        direction,
        relationType
      });
      
      await this.publish('knowledge/relation/search/completed', {
        requestId,
        relations,
        entityId,
        status: 'completed'
      });

      return relations;
      
    } catch (error) {
      this.logger.error('Relation search failed:', error);
      throw error;
    }
  }

  async handleGraphExportRequest(data) {
    try {
      const { format, filters, requestId } = data;
      
      const exportData = await this.knowledgeAPI.exportGraph(format, filters);
      
      await this.publish('knowledge/graph/exported', {
        requestId,
        format,
        data: exportData,
        status: 'completed'
      });

      return exportData;
      
    } catch (error) {
      this.logger.error('Graph export failed:', error);
      throw error;
    }
  }

  async handleGraphImportRequest(data) {
    try {
      const { format, data: importData, options, requestId } = data;
      
      const result = await this.knowledgeAPI.importGraph(format, importData, options);
      
      if (this.config.autoSyncUkb) {
        await this.ukbIntegration.syncAll();
      }

      await this.publish('knowledge/graph/imported', {
        requestId,
        result,
        status: 'completed'
      });

      return result;
      
    } catch (error) {
      this.logger.error('Graph import failed:', error);
      throw error;
    }
  }

  async handleInsightExtractionRequest(data) {
    try {
      const { analysisData, context, requestId } = data;
      
      const insights = await this.entityProcessor.extractInsights(analysisData, context);
      
      // Create entities for significant insights
      for (const insight of insights) {
        if (insight.significance >= (this.config.significanceThreshold || 7)) {
          await this.queueOperation('create-entity', {
            name: insight.title,
            entityType: 'Insight',
            significance: insight.significance,
            observations: [insight.description],
            metadata: {
              source: 'insight-extraction',
              context,
              extractedAt: new Date().toISOString()
            }
          });
        }
      }

      await this.publish('knowledge/insights/extracted', {
        requestId,
        insights,
        status: 'completed'
      });

      return insights;
      
    } catch (error) {
      this.logger.error('Insight extraction failed:', error);
      throw error;
    }
  }

  async handleUkbSyncRequest(data) {
    try {
      const { direction, requestId } = data; // 'to-ukb', 'from-ukb', 'bidirectional'
      
      let result;
      
      switch (direction) {
        case 'to-ukb':
          result = await this.ukbIntegration.exportToUkb();
          break;
        case 'from-ukb':
          result = await this.ukbIntegration.importFromUkb();
          break;
        case 'bidirectional':
          result = await this.ukbIntegration.syncBidirectional();
          break;
        default:
          throw new Error(`Unknown sync direction: ${direction}`);
      }

      await this.publish(EventTypes.KNOWLEDGE_SYNCED, {
        requestId,
        direction,
        result,
        status: 'completed'
      });

      return result;
      
    } catch (error) {
      this.logger.error('UKB sync failed:', error);
      throw error;
    }
  }

  async handleCodeAnalysisCompleted(data) {
    try {
      const { result } = data;
      
      // Extract entities from code analysis
      const entities = await this.entityProcessor.extractEntitiesFromCodeAnalysis(result);
      
      // Queue entity creation operations
      for (const entity of entities) {
        await this.queueOperation('create-entity', entity);
      }
      
    } catch (error) {
      this.logger.warn('Failed to process code analysis for knowledge extraction:', error.message);
    }
  }

  async handleConversationAnalysisCompleted(data) {
    try {
      const { result } = data;
      
      // Extract entities from conversation analysis
      const entities = await this.entityProcessor.extractEntitiesFromConversation(result);
      
      // Queue entity creation operations
      for (const entity of entities) {
        await this.queueOperation('create-entity', entity);
      }
      
    } catch (error) {
      this.logger.warn('Failed to process conversation analysis for knowledge extraction:', error.message);
    }
  }

  async handleWebSearchCompleted(data) {
    try {
      const { result } = data;
      
      // Extract reference entities from search results
      const references = await this.entityProcessor.extractReferencesFromSearch(result);
      
      // Queue reference creation operations
      for (const reference of references) {
        await this.queueOperation('create-entity', reference);
      }
      
    } catch (error) {
      this.logger.warn('Failed to process search results for knowledge extraction:', error.message);
    }
  }

  async handlePatternDetected(data) {
    try {
      const { type, analysis, significance } = data;
      
      if (significance >= (this.config.significanceThreshold || 7)) {
        await this.queueOperation('create-entity', {
          name: `Pattern: ${type}`,
          entityType: 'Pattern',
          significance,
          observations: [JSON.stringify(analysis)],
          metadata: {
            source: 'pattern-detection',
            detectedAt: new Date().toISOString()
          }
        });
      }
      
    } catch (error) {
      this.logger.warn('Failed to process pattern detection for knowledge storage:', error.message);
    }
  }

  async queueOperation(type, data) {
    this.operationQueue.push({
      type,
      data,
      timestamp: Date.now()
    });
    
    // Process queue if not already processing
    if (!this.isProcessing) {
      this.processOperationQueue();
    }
  }

  async processOperationQueue() {
    if (this.isProcessing || this.operationQueue.length === 0) {
      return;
    }
    
    this.isProcessing = true;
    
    try {
      while (this.operationQueue.length > 0) {
        const operation = this.operationQueue.shift();
        
        try {
          switch (operation.type) {
            case 'create-entity':
              await this.handleEntityCreateRequest(operation.data);
              break;
            case 'create-relation':
              await this.handleRelationCreateRequest(operation.data);
              break;
            default:
              this.logger.warn(`Unknown operation type: ${operation.type}`);
          }
          
          // Small delay to prevent overwhelming the system
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (error) {
          this.logger.error(`Failed to process queued operation:`, error);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  startOperationProcessor() {
    // Process queue periodically
    setInterval(() => {
      if (!this.isProcessing && this.operationQueue.length > 0) {
        this.processOperationQueue();
      }
    }, 5000); // Every 5 seconds
  }

  getCapabilities() {
    return [
      'entity-management',
      'relation-management',
      'graph-operations',
      'ukb-integration',
      'insight-extraction',
      'automatic-knowledge-capture',
      'pattern-storage'
    ];
  }

  getMetadata() {
    return {
      knowledgeAPI: this.knowledgeAPI?.getInfo(),
      ukbIntegration: this.ukbIntegration?.getInfo(),
      queueSize: this.operationQueue.length,
      isProcessing: this.isProcessing,
      config: this.config
    };
  }

  async onStop() {
    // Process remaining operations before stopping
    if (this.operationQueue.length > 0) {
      this.logger.info(`Processing ${this.operationQueue.length} remaining operations...`);
      await this.processOperationQueue();
    }
    
    this.logger.info('Knowledge Graph Agent stopped');
  }
}