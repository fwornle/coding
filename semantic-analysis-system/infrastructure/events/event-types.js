/**
 * Event Type Definitions
 * Standardized event types for agent communication
 */

export const EventTypes = {
  // Analysis events
  ANALYSIS_REQUESTED: 'analysis/requested',
  ANALYSIS_STARTED: 'analysis/started',
  ANALYSIS_PROGRESS: 'analysis/progress',
  ANALYSIS_COMPLETED: 'analysis/completed',
  ANALYSIS_FAILED: 'analysis/failed',
  
  // Code analysis specific
  CODE_ANALYSIS_REQUESTED: 'analysis/code/requested',
  CODE_ANALYSIS_COMPLETED: 'analysis/code/completed',
  COMMIT_DETECTED: 'git/commit/detected',
  PATTERN_DETECTED: 'analysis/pattern/detected',
  
  // Conversation analysis
  CONVERSATION_ANALYSIS_REQUESTED: 'analysis/conversation/requested',
  CONVERSATION_ANALYSIS_COMPLETED: 'analysis/conversation/completed',
  INSIGHT_EXTRACTED: 'analysis/insight/extracted',
  
  // Web search events
  SEARCH_REQUESTED: 'search/requested',
  SEARCH_PROGRESS: 'search/progress',
  SEARCH_COMPLETED: 'search/completed',
  SEARCH_FAILED: 'search/failed',
  WEB_SEARCH_REQUESTED: 'search/web/requested',
  WEB_SEARCH_COMPLETED: 'search/web/completed',
  REFERENCE_VALIDATED: 'search/reference/validated',
  CONTENT_EXTRACTED: 'search/content/extracted',
  
  // Knowledge graph events
  ENTITY_CREATE_REQUESTED: 'knowledge/entity/create/requested',
  ENTITY_CREATED: 'knowledge/entity/created',
  RELATION_CREATE_REQUESTED: 'knowledge/relation/create/requested',
  RELATION_CREATED: 'knowledge/relation/created',
  KNOWLEDGE_UPDATED: 'knowledge/updated',
  KNOWLEDGE_SYNCED: 'knowledge/synced',
  
  // Workflow events
  WORKFLOW_STARTED: 'workflow/started',
  WORKFLOW_STEP_COMPLETED: 'workflow/step/completed',
  WORKFLOW_COMPLETED: 'workflow/completed',
  WORKFLOW_FAILED: 'workflow/failed',
  
  // Agent lifecycle events
  AGENT_STARTED: 'agent/started',
  AGENT_STOPPED: 'agent/stopped',
  AGENT_ERROR: 'agent/error',
  AGENT_HEALTH_CHECK: 'agent/health',
  
  // System events
  SYSTEM_STARTED: 'system/started',
  SYSTEM_STOPPED: 'system/stopped',
  SYSTEM_ERROR: 'system/error'
};

/**
 * Event schemas for validation
 */
export const EventSchemas = {
  [EventTypes.ANALYSIS_REQUESTED]: {
    type: 'object',
    required: ['analysisType', 'params'],
    properties: {
      analysisType: { type: 'string', enum: ['code', 'conversation', 'pattern'] },
      params: { type: 'object' },
      requestId: { type: 'string' },
      timeout: { type: 'number' }
    }
  },
  
  [EventTypes.CODE_ANALYSIS_REQUESTED]: {
    type: 'object',
    required: ['repository'],
    properties: {
      repository: { type: 'string' },
      depth: { type: 'number', default: 10 },
      branch: { type: 'string', default: 'main' },
      significanceThreshold: { type: 'number', default: 7 }
    }
  },
  
  [EventTypes.CONVERSATION_ANALYSIS_REQUESTED]: {
    type: 'object',
    required: ['conversationPath'],
    properties: {
      conversationPath: { type: 'string' },
      extractInsights: { type: 'boolean', default: true },
      updateKnowledge: { type: 'boolean', default: true }
    }
  },
  
  [EventTypes.SEARCH_REQUESTED]: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string' },
      context: { type: 'string' },
      maxResults: { type: 'number', default: 10 },
      includeDocumentation: { type: 'boolean', default: true }
    }
  },
  
  [EventTypes.ENTITY_CREATE_REQUESTED]: {
    type: 'object',
    required: ['name', 'entityType'],
    properties: {
      name: { type: 'string' },
      entityType: { type: 'string' },
      significance: { type: 'number', minimum: 1, maximum: 10 },
      observations: { type: 'array', items: { type: 'string' } },
      metadata: { type: 'object' }
    }
  }
};

/**
 * Utility functions for events
 */
export class EventUtils {
  /**
   * Create a standardized event payload
   */
  static createEvent(type, data, options = {}) {
    return {
      id: options.id || EventUtils.generateId(),
      type,
      timestamp: new Date().toISOString(),
      source: options.source || 'unknown',
      data,
      metadata: options.metadata || {}
    };
  }
  
  /**
   * Generate unique event ID
   */
  static generateId() {
    return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
  
  /**
   * Validate event against schema
   */
  static validateEvent(event) {
    if (!event.type || !event.data) {
      throw new Error('Event must have type and data properties');
    }
    
    const schema = EventSchemas[event.type];
    if (schema) {
      // Basic validation - in production, use a proper JSON schema validator
      return EventUtils.validateObject(event.data, schema);
    }
    
    return true;
  }
  
  /**
   * Basic object validation
   */
  static validateObject(obj, schema) {
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in obj)) {
          throw new Error(`Required field missing: ${field}`);
        }
      }
    }
    
    return true;
  }
  
  /**
   * Create response event for request
   */
  static createResponse(originalEvent, responseData, success = true) {
    const responseType = success 
      ? originalEvent.type.replace('/requested', '/completed')
      : originalEvent.type.replace('/requested', '/failed');
    
    return EventUtils.createEvent(responseType, {
      originalEventId: originalEvent.id,
      requestId: originalEvent.data.requestId,
      ...responseData
    }, {
      source: 'response-handler'
    });
  }
  
  /**
   * Check if event is a request type
   */
  static isRequestEvent(event) {
    return event.type.includes('/requested');
  }
  
  /**
   * Check if event is a response type
   */
  static isResponseEvent(event) {
    return event.type.includes('/completed') || event.type.includes('/failed');
  }
  
  /**
   * Extract request ID from event
   */
  static getRequestId(event) {
    return event.data?.requestId || event.id;
  }
}