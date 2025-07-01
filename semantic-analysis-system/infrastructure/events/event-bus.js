/**
 * Central Event Bus
 * Manages event routing and coordination between agents
 */

import { EventEmitter } from 'events';
import { MQTTClient } from '../mqtt/client.js';
import { Logger } from '../../shared/logger.js';

export class EventBus extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      namespace: config.namespace || 'semantic-analysis',
      brokerUrl: config.brokerUrl || 'mqtt://localhost:1884',
      ...config
    };
    
    this.logger = new Logger('event-bus');
    this.mqttClient = null;
    this.eventHandlers = new Map();
    this.eventStats = new Map();
  }

  async initialize() {
    try {
      // Initialize MQTT client
      this.mqttClient = new MQTTClient({
        brokerUrl: this.config.brokerUrl,
        clientId: `event-bus-${this.config.namespace}`
      });
      
      await this.mqttClient.connect();
      
      // Subscribe to all events in namespace
      await this.mqttClient.subscribe(`${this.config.namespace}/#`, (payload, topic) => {
        this.handleEvent(topic, payload);
      });
      
      this.logger.info('Event bus initialized');
    } catch (error) {
      this.logger.error('Failed to initialize event bus:', error);
      throw error;
    }
  }

  async shutdown() {
    if (this.mqttClient) {
      await this.mqttClient.disconnect();
    }
  }

  /**
   * Publish an event to the bus
   */
  async publish(eventType, data, options = {}) {
    const topic = this.buildTopic(eventType);
    const event = {
      id: this.generateEventId(),
      type: eventType,
      timestamp: new Date().toISOString(),
      source: options.source || 'unknown',
      data,
      metadata: options.metadata || {}
    };
    
    try {
      await this.mqttClient.publish(topic, event, {
        qos: options.qos || 1,
        retain: options.retain || false
      });
      
      this.updateStats(eventType, 'published');
      this.logger.debug(`Published event: ${eventType}`);
      
      // Emit locally as well
      this.emit(eventType, event);
      
    } catch (error) {
      this.logger.error(`Failed to publish event ${eventType}:`, error);
      throw error;
    }
  }

  /**
   * Subscribe to an event type
   */
  on(eventType, handler) {
    super.on(eventType, handler);
    
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    
    this.eventHandlers.get(eventType).add(handler);
    this.logger.debug(`Registered handler for event: ${eventType}`);
  }

  /**
   * Unsubscribe from an event type
   */
  off(eventType, handler) {
    super.off(eventType, handler);
    
    if (this.eventHandlers.has(eventType)) {
      this.eventHandlers.get(eventType).delete(handler);
      
      if (this.eventHandlers.get(eventType).size === 0) {
        this.eventHandlers.delete(eventType);
      }
    }
  }

  /**
   * Handle incoming MQTT events
   */
  handleEvent(topic, event) {
    const eventType = this.extractEventType(topic);
    
    this.updateStats(eventType, 'received');
    this.logger.debug(`Received event: ${eventType}`);
    
    // Emit to local handlers
    this.emit(eventType, event);
    
    // Also emit a generic 'event' for monitoring
    this.emit('event', {
      type: eventType,
      event
    });
  }

  /**
   * Request-response pattern over events
   */
  async request(eventType, data, timeout = 30000) {
    const requestId = this.generateEventId();
    const responseEvent = `${eventType}/response/${requestId}`;
    
    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(responseEvent, responseHandler);
        reject(new Error(`Event request timeout: ${eventType}`));
      }, timeout);
      
      const responseHandler = (event) => {
        clearTimeout(timer);
        this.off(responseEvent, responseHandler);
        resolve(event.data);
      };
      
      this.on(responseEvent, responseHandler);
      
      await this.publish(eventType, {
        ...data,
        requestId,
        responseEvent
      });
    });
  }

  /**
   * Reply to a request event
   */
  async reply(originalEvent, responseData) {
    if (originalEvent.data && originalEvent.data.responseEvent) {
      await this.publish(originalEvent.data.responseEvent, responseData, {
        source: this.config.namespace
      });
    }
  }

  /**
   * Build MQTT topic from event type
   */
  buildTopic(eventType) {
    return `${this.config.namespace}/${eventType}`;
  }

  /**
   * Extract event type from MQTT topic
   */
  extractEventType(topic) {
    const prefix = `${this.config.namespace}/`;
    if (topic.startsWith(prefix)) {
      return topic.substring(prefix.length);
    }
    return topic;
  }

  /**
   * Generate unique event ID
   */
  generateEventId() {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Update event statistics
   */
  updateStats(eventType, action) {
    if (!this.eventStats.has(eventType)) {
      this.eventStats.set(eventType, {
        published: 0,
        received: 0,
        lastPublished: null,
        lastReceived: null
      });
    }
    
    const stats = this.eventStats.get(eventType);
    stats[action]++;
    stats[`last${action.charAt(0).toUpperCase() + action.slice(1)}`] = new Date();
  }

  /**
   * Get event statistics
   */
  getStats() {
    const stats = {
      totalEvents: 0,
      eventTypes: {}
    };
    
    for (const [eventType, eventStats] of this.eventStats) {
      stats.totalEvents += eventStats.published + eventStats.received;
      stats.eventTypes[eventType] = eventStats;
    }
    
    return stats;
  }

  /**
   * Create event stream for specific pattern
   */
  createEventStream(pattern) {
    const stream = new EventEmitter();
    
    const handler = (event) => {
      if (this.matchesPattern(pattern, event.type)) {
        stream.emit('data', event);
      }
    };
    
    this.on('event', handler);
    
    stream.destroy = () => {
      this.off('event', handler);
    };
    
    return stream;
  }

  /**
   * Check if event type matches pattern
   */
  matchesPattern(pattern, eventType) {
    if (pattern === '*') return true;
    if (pattern === eventType) return true;
    
    // Simple wildcard matching
    const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
    return regex.test(eventType);
  }
}