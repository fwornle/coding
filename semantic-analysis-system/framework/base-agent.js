/**
 * Base Agent Class
 * Provides common functionality for all agents including communication,
 * lifecycle management, and event handling
 */

import { EventEmitter } from 'events';
import { MQTTClient } from '../infrastructure/mqtt/client.js';
import { JSONRPCClient } from '../infrastructure/rpc/client.js';
import { Logger } from '../shared/logger.js';
import { EventTypes, EventUtils } from '../infrastructure/events/event-types.js';

export class BaseAgent extends EventEmitter {
  constructor(config) {
    super();
    
    this.config = {
      id: config.id || 'unknown-agent',
      mqtt: config.mqtt || {},
      rpc: config.rpc || {},
      healthCheck: config.healthCheck || { interval: 30000 },
      ...config
    };
    
    this.logger = new Logger(this.config.id);
    this.mqttClient = null;
    this.rpcClient = null;
    this.status = 'stopped';
    this.startTime = null;
    this.healthCheckInterval = null;
    this.requestHandlers = new Map();
    this.eventHandlers = new Map();
  }

  /**
   * Initialize the agent
   */
  async initialize() {
    try {
      this.logger.info('Initializing agent...');
      
      // Initialize MQTT communication
      await this.initializeMQTT();
      
      // Initialize RPC communication
      await this.initializeRPC();
      
      // Set up default event handlers
      this.setupDefaultEventHandlers();
      
      // Agent-specific initialization
      await this.onInitialize();
      
      this.status = 'initialized';
      this.logger.info('Agent initialized successfully');
      
    } catch (error) {
      this.logger.error('Failed to initialize agent:', error);
      throw error;
    }
  }

  /**
   * Start the agent
   */
  async start() {
    try {
      if (this.status === 'running') {
        this.logger.warn('Agent is already running');
        return;
      }
      
      if (this.status !== 'initialized') {
        await this.initialize();
      }
      
      this.logger.info('Starting agent...');
      this.startTime = new Date();
      this.status = 'running';
      
      // Start health checks
      this.startHealthChecks();
      
      // Agent-specific startup
      await this.onStart();
      
      // Announce agent started
      await this.publish(EventTypes.AGENT_STARTED, {
        agentId: this.config.id,
        startTime: this.startTime
      });
      
      this.logger.info('Agent started successfully');
      this.emit('started');
      
    } catch (error) {
      this.logger.error('Failed to start agent:', error);
      this.status = 'error';
      throw error;
    }
  }

  /**
   * Stop the agent
   */
  async stop() {
    try {
      this.logger.info('Stopping agent...');
      this.status = 'stopping';
      
      // Stop health checks
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }
      
      // Agent-specific cleanup
      await this.onStop();
      
      // Disconnect from MQTT
      if (this.mqttClient) {
        await this.mqttClient.disconnect();
      }
      
      // Announce agent stopped
      await this.publish(EventTypes.AGENT_STOPPED, {
        agentId: this.config.id,
        stopTime: new Date()
      });
      
      this.status = 'stopped';
      this.logger.info('Agent stopped successfully');
      this.emit('stopped');
      
    } catch (error) {
      this.logger.error('Error stopping agent:', error);
      this.status = 'error';
    }
  }

  /**
   * Initialize MQTT communication
   */
  async initializeMQTT() {
    this.mqttClient = new MQTTClient({
      clientId: `${this.config.id}-${Date.now()}`,
      ...this.config.mqtt
    });
    
    await this.mqttClient.connect();
    
    // Set up message handling
    this.mqttClient.on('message', ({ topic, payload }) => {
      this.handleMQTTMessage(topic, payload);
    });
    
    // Subscribe to agent-specific topics
    const subscriptions = this.config.mqtt.subscriptions || [];
    for (const topic of subscriptions) {
      await this.mqttClient.subscribe(topic);
    }
    
    // Subscribe to global agent events
    await this.mqttClient.subscribe(`agents/${this.config.id}/#`);
  }

  /**
   * Initialize RPC communication
   */
  async initializeRPC() {
    if (this.config.rpc.endpoint) {
      this.rpcClient = new JSONRPCClient(this.config.rpc);
    }
  }

  /**
   * Set up default event handlers
   */
  setupDefaultEventHandlers() {
    // Handle health check requests
    this.on(EventTypes.AGENT_HEALTH_CHECK, this.handleHealthCheck.bind(this));
  }

  /**
   * Handle incoming MQTT messages
   */
  handleMQTTMessage(topic, payload) {
    try {
      // Extract event type from topic
      const eventType = this.extractEventType(topic);
      
      this.logger.debug(`Received event: ${eventType}`);
      
      // Emit to local handlers
      this.emit(eventType, payload);
      
      // Handle request-response pattern
      if (EventUtils.isRequestEvent(payload)) {
        this.handleRequest(payload);
      }
      
    } catch (error) {
      this.logger.error('Error handling MQTT message:', error);
    }
  }

  /**
   * Handle request events
   */
  async handleRequest(event) {
    const handler = this.requestHandlers.get(event.type);
    
    if (handler) {
      try {
        const response = await handler(event.data);
        
        // Send response if response topic is provided
        if (event.data.responseEvent) {
          await this.publish(event.data.responseEvent, response);
        }
        
      } catch (error) {
        this.logger.error(`Error handling request ${event.type}:`, error);
        
        // Send error response
        if (event.data.responseEvent) {
          await this.publish(event.data.responseEvent, {
            error: error.message,
            code: error.code || 'HANDLER_ERROR'
          });
        }
      }
    }
  }

  /**
   * Register a request handler
   */
  registerRequestHandler(eventType, handler) {
    this.requestHandlers.set(eventType, handler);
    this.logger.debug(`Registered request handler for: ${eventType}`);
  }

  /**
   * Publish an event
   */
  async publish(eventType, data, options = {}) {
    const event = EventUtils.createEvent(eventType, data, {
      source: this.config.id,
      ...options
    });
    
    const topic = this.buildTopic(eventType);
    
    if (this.mqttClient) {
      await this.mqttClient.publish(topic, event, options);
    }
    
    return event;
  }

  /**
   * Subscribe to an event type
   */
  async subscribe(eventType, handler) {
    if (this.mqttClient) {
      const topic = this.buildTopic(eventType);
      await this.mqttClient.subscribe(topic, handler);
    }
    
    // Also register local handler
    this.on(eventType, handler);
  }

  /**
   * Make an RPC call to another agent
   */
  async call(agent, method, params) {
    if (!this.rpcClient) {
      throw new Error('RPC client not initialized');
    }
    
    const fullMethod = `${agent}.${method}`;
    return await this.rpcClient.call(fullMethod, params);
  }

  /**
   * Make a request with response pattern
   */
  async request(eventType, data, timeout = 30000) {
    if (!this.mqttClient) {
      throw new Error('MQTT client not initialized');
    }
    
    return await this.mqttClient.request(this.buildTopic(eventType), data, timeout);
  }

  /**
   * Build MQTT topic from event type
   */
  buildTopic(eventType) {
    return `semantic-analysis/${eventType}`;
  }

  /**
   * Extract event type from MQTT topic
   */
  extractEventType(topic) {
    const prefix = 'semantic-analysis/';
    if (topic.startsWith(prefix)) {
      return topic.substring(prefix.length);
    }
    return topic;
  }

  /**
   * Start periodic health checks
   */
  startHealthChecks() {
    const interval = this.config.healthCheck.interval;
    
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.getHealth();
        
        await this.publish(EventTypes.AGENT_HEALTH_CHECK, {
          agentId: this.config.id,
          health,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        this.logger.error('Health check failed:', error);
        
        await this.publish(EventTypes.AGENT_ERROR, {
          agentId: this.config.id,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }, interval);
  }

  /**
   * Handle health check request
   */
  async handleHealthCheck(data) {
    return await this.getHealth();
  }

  /**
   * Get agent health status
   */
  async getHealth() {
    const uptime = this.startTime ? Date.now() - this.startTime.getTime() : 0;
    
    return {
      agentId: this.config.id,
      status: this.status,
      uptime,
      memory: process.memoryUsage(),
      mqttConnected: this.mqttClient?.connected || false,
      lastActivity: new Date().toISOString()
    };
  }

  /**
   * Get agent statistics
   */
  getStats() {
    return {
      agentId: this.config.id,
      status: this.status,
      startTime: this.startTime,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      requestHandlers: this.requestHandlers.size,
      eventHandlers: this.eventHandlers.size
    };
  }

  // Abstract methods to be implemented by subclasses
  async onInitialize() {
    // Override in subclass
  }

  async onStart() {
    // Override in subclass
  }

  async onStop() {
    // Override in subclass
  }
}