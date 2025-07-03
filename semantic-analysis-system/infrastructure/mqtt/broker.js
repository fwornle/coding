/**
 * Embedded MQTT Broker using Aedes
 * Provides local MQTT broker for agent communication
 */

import Aedes from 'aedes';
import { createServer } from 'net';
import { createServer as createHttpServer } from 'http';
import ws from 'websocket-stream';
import { Logger } from '../../shared/logger.js';

export class MQTTBroker {
  constructor(config = {}) {
    this.config = {
      port: config.port || 1883,
      wsPort: config.wsPort || 8883,
      persistence: config.persistence || true,
      host: config.host || '0.0.0.0',
      ...config
    };
    
    this.logger = new Logger('mqtt-broker');
    this.aedes = null;
    this.tcpServer = null;
    this.wsServer = null;
    this.clients = new Map();
    this.running = false;
  }

  async start() {
    try {
      // Create Aedes instance
      this.aedes = new Aedes({
        concurrency: 100,
        heartbeatInterval: 60000,
        connectTimeout: 30000,
      });

      // Set up event handlers
      this.setupEventHandlers();

      // Start TCP server
      await this.startTcpServer();

      // Start WebSocket server
      await this.startWsServer();

      this.running = true;
      this.logger.info(`MQTT broker started on port ${this.config.port} (TCP) and ${this.config.wsPort} (WS)`);
    } catch (error) {
      this.logger.error('Failed to start MQTT broker:', error);
      this.running = false;
      throw error;
    }
  }

  async stop() {
    return new Promise((resolve) => {
      if (this.aedes) {
        this.aedes.close(() => {
          this.logger.info('MQTT broker stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  setupEventHandlers() {
    // Client connected
    this.aedes.on('client', (client) => {
      this.clients.set(client.id, {
        id: client.id,
        connectedAt: new Date(),
        subscriptions: []
      });
      this.logger.debug(`Client connected: ${client.id}`);
    });

    // Client disconnected
    this.aedes.on('clientDisconnect', (client) => {
      this.clients.delete(client.id);
      this.logger.debug(`Client disconnected: ${client.id}`);
    });

    // Message published
    this.aedes.on('publish', (packet, client) => {
      if (client) {
        this.logger.debug(`Message published by ${client.id} to ${packet.topic}`);
      }
    });

    // Subscription
    this.aedes.on('subscribe', (subscriptions, client) => {
      const clientInfo = this.clients.get(client.id);
      if (clientInfo) {
        clientInfo.subscriptions = subscriptions.map(s => s.topic);
      }
      this.logger.debug(`Client ${client.id} subscribed to:`, subscriptions.map(s => s.topic));
    });

    // Unsubscription
    this.aedes.on('unsubscribe', (subscriptions, client) => {
      this.logger.debug(`Client ${client.id} unsubscribed from:`, subscriptions);
    });

    // Error handling
    this.aedes.on('clientError', (client, error) => {
      this.logger.error(`Client error for ${client.id}:`, error);
    });
  }

  startTcpServer() {
    return new Promise((resolve, reject) => {
      this.tcpServer = createServer(this.aedes.handle);
      
      this.tcpServer.listen(this.config.port, this.config.host, () => {
        this.logger.info(`MQTT TCP server listening on ${this.config.host}:${this.config.port}`);
        resolve();
      });

      this.tcpServer.on('error', (error) => {
        this.logger.error('TCP server error:', error);
        reject(error);
      });
    });
  }

  startWsServer() {
    return new Promise((resolve) => {
      const httpServer = createHttpServer();
      
      ws.createServer({ server: httpServer }, this.aedes.handle);
      
      httpServer.listen(this.config.wsPort, this.config.host, () => {
        this.logger.info(`MQTT WebSocket server listening on ${this.config.host}:${this.config.wsPort}`);
        this.wsServer = httpServer;
        resolve();
      });
    });
  }

  // Broker statistics
  getStats() {
    return {
      clients: this.clients.size,
      subscriptions: Array.from(this.clients.values())
        .flatMap(c => c.subscriptions)
        .filter((v, i, a) => a.indexOf(v) === i).length,
      published: this.aedes.published || 0,
      connectedClients: Array.from(this.clients.entries()).map(([id, info]) => ({
        id,
        connectedAt: info.connectedAt,
        subscriptions: info.subscriptions
      }))
    };
  }

  // Publish message directly from broker
  publish(topic, payload, options = {}) {
    return new Promise((resolve, reject) => {
      this.aedes.publish({
        topic,
        payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
        qos: options.qos || 1,
        retain: options.retain || false
      }, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  async stop() {
    try {
      this.running = false;
      
      if (this.tcpServer) {
        await new Promise((resolve) => {
          this.tcpServer.close(resolve);
        });
        this.tcpServer = null;
      }
      
      if (this.wsServer) {
        await new Promise((resolve) => {
          this.wsServer.close(resolve);
        });
        this.wsServer = null;
      }
      
      if (this.aedes) {
        await new Promise((resolve) => {
          this.aedes.close(resolve);
        });
        this.aedes = null;
      }
      
      this.clients.clear();
      this.logger.info('MQTT broker stopped');
    } catch (error) {
      this.logger.error('Failed to stop MQTT broker:', error);
      throw error;
    }
  }

  isRunning() {
    return this.running && this.tcpServer && this.aedes;
  }
}