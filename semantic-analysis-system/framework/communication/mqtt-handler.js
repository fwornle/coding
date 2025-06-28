/**
 * MQTT Communication Handler
 * Handles MQTT-specific communication patterns and routing
 */

import { EventEmitter } from 'events';
import { Logger } from '../../shared/logger.js';
import { EventUtils } from '../../infrastructure/events/event-types.js';

export class MQTTHandler extends EventEmitter {
  constructor(mqttClient, agentId) {
    super();
    
    this.mqttClient = mqttClient;
    this.agentId = agentId;
    this.logger = new Logger(`mqtt-handler:${agentId}`);
    
    this.subscriptions = new Map();
    this.messageFilters = [];
    this.middlewares = [];
    
    this.setupEventHandlers();
  }

  /**
   * Set up event handlers
   */
  setupEventHandlers() {
    this.mqttClient.on('message', ({ topic, payload }) => {
      this.handleMessage(topic, payload);
    });
    
    this.mqttClient.on('connected', () => {
      this.emit('connected');
      this.resubscribeAll();
    });
    
    this.mqttClient.on('disconnected', () => {
      this.emit('disconnected');
    });
  }

  /**
   * Subscribe to a topic with handler
   */
  async subscribe(topic, handler, options = {}) {
    try {
      await this.mqttClient.subscribe(topic);
      
      if (!this.subscriptions.has(topic)) {
        this.subscriptions.set(topic, new Set());
      }
      
      if (handler) {
        this.subscriptions.get(topic).add(handler);
      }
      
      this.logger.debug(`Subscribed to topic: ${topic}`);
      return true;
      
    } catch (error) {
      this.logger.error(`Failed to subscribe to ${topic}:`, error);
      throw error;
    }
  }

  /**
   * Unsubscribe from a topic
   */
  async unsubscribe(topic, handler = null) {
    try {
      if (handler && this.subscriptions.has(topic)) {
        this.subscriptions.get(topic).delete(handler);
        
        // Only unsubscribe from MQTT if no handlers left
        if (this.subscriptions.get(topic).size === 0) {
          await this.mqttClient.unsubscribe(topic);
          this.subscriptions.delete(topic);
        }
      } else {
        await this.mqttClient.unsubscribe(topic);
        this.subscriptions.delete(topic);
      }
      
      this.logger.debug(`Unsubscribed from topic: ${topic}`);
      
    } catch (error) {
      this.logger.error(`Failed to unsubscribe from ${topic}:`, error);
      throw error;
    }
  }

  /**
   * Publish message to topic
   */
  async publish(topic, payload, options = {}) {
    try {
      // Apply middleware to outgoing messages
      const processedPayload = await this.applyOutgoingMiddleware(payload, topic);
      
      await this.mqttClient.publish(topic, processedPayload, {
        qos: options.qos || 1,
        retain: options.retain || false
      });
      
      this.logger.debug(`Published to topic: ${topic}`);
      return true;
      
    } catch (error) {
      this.logger.error(`Failed to publish to ${topic}:`, error);
      throw error;
    }
  }

  /**
   * Handle incoming MQTT message
   */
  async handleMessage(topic, payload) {
    try {
      // Apply incoming middleware
      const processedPayload = await this.applyIncomingMiddleware(payload, topic);
      
      // Apply message filters
      if (!this.passesFilters(processedPayload, topic)) {
        return;
      }
      
      // Route to specific handlers
      const handlers = this.getHandlersForTopic(topic);
      
      for (const handler of handlers) {
        try {
          await handler(processedPayload, topic);
        } catch (error) {
          this.logger.error(`Handler error for topic ${topic}:`, error);
        }
      }
      
      // Emit generic message event
      this.emit('message', {
        topic,
        payload: processedPayload,
        timestamp: new Date()
      });
      
    } catch (error) {
      this.logger.error(`Error handling message on ${topic}:`, error);
    }
  }

  /**
   * Get handlers for a specific topic
   */
  getHandlersForTopic(topic) {
    const handlers = [];
    
    for (const [pattern, patternHandlers] of this.subscriptions) {
      if (this.topicMatches(pattern, topic)) {
        handlers.push(...patternHandlers);
      }
    }
    
    return handlers;
  }

  /**
   * Check if topic matches pattern (supports MQTT wildcards)
   */
  topicMatches(pattern, topic) {
    if (pattern === topic) return true;
    
    const patternParts = pattern.split('/');
    const topicParts = topic.split('/');
    
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === '#') {
        return true; // Multi-level wildcard
      }
      
      if (patternParts[i] === '+') {
        continue; // Single-level wildcard
      }
      
      if (i >= topicParts.length || patternParts[i] !== topicParts[i]) {
        return false;
      }
    }
    
    return patternParts.length === topicParts.length;
  }

  /**
   * Add message filter
   */
  addFilter(filter) {
    this.messageFilters.push(filter);
  }

  /**
   * Remove message filter
   */
  removeFilter(filter) {
    const index = this.messageFilters.indexOf(filter);
    if (index > -1) {
      this.messageFilters.splice(index, 1);
    }
  }

  /**
   * Check if message passes filters
   */
  passesFilters(payload, topic) {
    for (const filter of this.messageFilters) {
      if (!filter(payload, topic)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Add middleware
   */
  use(middleware) {
    this.middlewares.push(middleware);
  }

  /**
   * Apply middleware to incoming messages
   */
  async applyIncomingMiddleware(payload, topic) {
    let processedPayload = payload;
    
    for (const middleware of this.middlewares) {
      if (middleware.incoming) {
        processedPayload = await middleware.incoming(processedPayload, topic);
      }
    }
    
    return processedPayload;
  }

  /**
   * Apply middleware to outgoing messages
   */
  async applyOutgoingMiddleware(payload, topic) {
    let processedPayload = payload;
    
    for (const middleware of this.middlewares) {
      if (middleware.outgoing) {
        processedPayload = await middleware.outgoing(processedPayload, topic);
      }
    }
    
    return processedPayload;
  }

  /**
   * Resubscribe to all topics (after reconnection)
   */
  async resubscribeAll() {
    for (const topic of this.subscriptions.keys()) {
      try {
        await this.mqttClient.subscribe(topic);
        this.logger.debug(`Resubscribed to topic: ${topic}`);
      } catch (error) {
        this.logger.error(`Failed to resubscribe to ${topic}:`, error);
      }
    }
  }

  /**
   * Request-response pattern
   */
  async request(topic, payload, timeout = 30000) {
    const correlationId = EventUtils.generateId();
    const responseTopic = `${topic}/response/${correlationId}`;
    
    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        this.unsubscribe(responseTopic);
        reject(new Error(`Request timeout for ${topic}`));
      }, timeout);
      
      // Subscribe to response
      await this.subscribe(responseTopic, (response) => {
        clearTimeout(timer);
        this.unsubscribe(responseTopic);
        resolve(response);
      });
      
      // Send request
      await this.publish(topic, {
        ...payload,
        correlationId,
        responseTopic,
        timestamp: new Date().toISOString()
      });
    });
  }

  /**
   * Reply to a request
   */
  async reply(originalMessage, response) {
    if (originalMessage.responseTopic) {
      await this.publish(originalMessage.responseTopic, {
        correlationId: originalMessage.correlationId,
        response,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Broadcast message to all agents
   */
  async broadcast(eventType, payload) {
    const topic = `semantic-analysis/broadcast/${eventType}`;
    await this.publish(topic, payload);
  }

  /**
   * Send direct message to specific agent
   */
  async sendToAgent(targetAgentId, eventType, payload) {
    const topic = `semantic-analysis/agents/${targetAgentId}/${eventType}`;
    await this.publish(topic, payload);
  }

  /**
   * Get connection statistics
   */
  getStats() {
    return {
      connected: this.mqttClient.connected,
      subscriptions: this.subscriptions.size,
      filters: this.messageFilters.length,
      middlewares: this.middlewares.length
    };
  }
}