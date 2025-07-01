/**
 * MQTT Client Wrapper
 * Provides a simplified interface for agents to communicate via MQTT
 */

import mqtt from 'mqtt';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../shared/logger.js';

export class MQTTClient extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      brokerUrl: config.brokerUrl || 'mqtt://localhost:1884',
      clientId: config.clientId || `agent-${uuidv4()}`,
      username: config.username,
      password: config.password,
      reconnectPeriod: config.reconnectPeriod || 5000,
      keepalive: config.keepalive || 60,
      qos: config.qos || 1,
      ...config
    };
    
    this.logger = new Logger(`mqtt-client:${this.config.clientId}`);
    this.client = null;
    this.subscriptions = new Map();
    this.connected = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const options = {
        clientId: this.config.clientId,
        username: this.config.username,
        password: this.config.password,
        reconnectPeriod: this.config.reconnectPeriod,
        keepalive: this.config.keepalive,
        clean: true,
        rejectUnauthorized: false
      };

      this.client = mqtt.connect(this.config.brokerUrl, options);

      this.client.on('connect', () => {
        this.connected = true;
        this.logger.info(`Connected to MQTT broker at ${this.config.brokerUrl}`);
        
        // Resubscribe to topics after reconnection
        this.resubscribe();
        
        this.emit('connected');
        resolve();
      });

      this.client.on('error', (error) => {
        this.logger.error('MQTT connection error:', error);
        this.emit('error', error);
        if (!this.connected) {
          reject(error);
        }
      });

      this.client.on('close', () => {
        this.connected = false;
        this.logger.warn('MQTT connection closed');
        this.emit('disconnected');
      });

      this.client.on('reconnect', () => {
        this.logger.info('Attempting to reconnect to MQTT broker...');
        this.emit('reconnecting');
      });

      this.client.on('message', (topic, message) => {
        this.handleMessage(topic, message);
      });

      // Set timeout for initial connection
      setTimeout(() => {
        if (!this.connected) {
          reject(new Error('MQTT connection timeout'));
        }
      }, 30000);
    });
  }

  async disconnect() {
    return new Promise((resolve) => {
      if (this.client) {
        this.client.end(() => {
          this.connected = false;
          this.logger.info('Disconnected from MQTT broker');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  async subscribe(topic, handler) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('Not connected to MQTT broker'));
        return;
      }

      this.client.subscribe(topic, { qos: this.config.qos }, (error) => {
        if (error) {
          this.logger.error(`Failed to subscribe to ${topic}:`, error);
          reject(error);
        } else {
          this.logger.debug(`Subscribed to topic: ${topic}`);
          
          // Store subscription for resubscription after reconnect
          if (!this.subscriptions.has(topic)) {
            this.subscriptions.set(topic, []);
          }
          
          if (handler) {
            this.subscriptions.get(topic).push(handler);
          }
          
          resolve();
        }
      });
    });
  }

  async unsubscribe(topic) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('Not connected to MQTT broker'));
        return;
      }

      this.client.unsubscribe(topic, (error) => {
        if (error) {
          this.logger.error(`Failed to unsubscribe from ${topic}:`, error);
          reject(error);
        } else {
          this.logger.debug(`Unsubscribed from topic: ${topic}`);
          this.subscriptions.delete(topic);
          resolve();
        }
      });
    });
  }

  async publish(topic, payload, options = {}) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('Not connected to MQTT broker'));
        return;
      }

      const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
      
      const publishOptions = {
        qos: options.qos || this.config.qos,
        retain: options.retain || false
      };

      this.client.publish(topic, message, publishOptions, (error) => {
        if (error) {
          this.logger.error(`Failed to publish to ${topic}:`, error);
          reject(error);
        } else {
          this.logger.debug(`Published to topic: ${topic}`);
          resolve();
        }
      });
    });
  }

  handleMessage(topic, message) {
    try {
      const payload = JSON.parse(message.toString());
      this.logger.debug(`Received message on ${topic}:`, payload);
      
      // Emit generic message event
      this.emit('message', { topic, payload });
      
      // Call specific handlers for this topic
      const handlers = this.getHandlersForTopic(topic);
      handlers.forEach(handler => {
        try {
          handler(payload, topic);
        } catch (error) {
          this.logger.error(`Handler error for topic ${topic}:`, error);
        }
      });
      
    } catch (error) {
      this.logger.error(`Failed to parse message on ${topic}:`, error);
      // Emit raw message if JSON parsing fails
      this.emit('message', { topic, payload: message.toString() });
    }
  }

  getHandlersForTopic(topic) {
    const handlers = [];
    
    // Direct topic match
    if (this.subscriptions.has(topic)) {
      handlers.push(...this.subscriptions.get(topic));
    }
    
    // Wildcard matching
    for (const [pattern, patternHandlers] of this.subscriptions) {
      if (this.topicMatches(pattern, topic)) {
        handlers.push(...patternHandlers);
      }
    }
    
    return handlers;
  }

  topicMatches(pattern, topic) {
    if (pattern === topic) return true;
    
    const patternParts = pattern.split('/');
    const topicParts = topic.split('/');
    
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === '#') {
        return true; // Multi-level wildcard matches everything after
      }
      
      if (patternParts[i] === '+') {
        continue; // Single-level wildcard matches this level
      }
      
      if (i >= topicParts.length || patternParts[i] !== topicParts[i]) {
        return false;
      }
    }
    
    return patternParts.length === topicParts.length;
  }

  async resubscribe() {
    for (const [topic, handlers] of this.subscriptions) {
      try {
        await this.client.subscribe(topic, { qos: this.config.qos });
        this.logger.debug(`Resubscribed to topic: ${topic}`);
      } catch (error) {
        this.logger.error(`Failed to resubscribe to ${topic}:`, error);
      }
    }
  }

  // Convenience method for request-response pattern
  async request(topic, payload, timeout = 30000) {
    const correlationId = uuidv4();
    const responseTopic = `${topic}/response/${correlationId}`;
    
    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        this.unsubscribe(responseTopic);
        reject(new Error(`Request timeout for ${topic}`));
      }, timeout);
      
      // Subscribe to response topic
      await this.subscribe(responseTopic, (response) => {
        clearTimeout(timer);
        this.unsubscribe(responseTopic);
        resolve(response);
      });
      
      // Publish request with correlation ID
      await this.publish(topic, {
        ...payload,
        correlationId,
        responseTopic
      });
    });
  }
}