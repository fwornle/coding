#!/usr/bin/env node

/**
 * Infrastructure-only startup
 * Starts MQTT and JSON-RPC services without the complex agent system
 */

import { MQTTBroker } from './infrastructure/mqtt/broker.js';
import { JSONRPCServer } from './infrastructure/rpc/server.js';
import { portManager } from './shared/port-manager.js';
import { Logger } from './shared/logger.js';

const logger = new Logger('infrastructure');

class InfrastructureManager {
  constructor() {
    this.mqttBroker = null;
    this.rpcServer = null;
    this.running = false;
  }

  async start() {
    try {
      logger.info('🚀 Starting infrastructure services...');

      // Initialize port manager
      await portManager.initialize();
      
      // Start MQTT broker
      const mqttPort = portManager.getPort('mqtt-broker-tcp');
      this.mqttBroker = new MQTTBroker({ port: mqttPort });
      await this.mqttBroker.start();
      logger.info(`✅ MQTT broker running on port ${mqttPort}`);

      // Start JSON-RPC server
      const rpcPort = portManager.getPort('json-rpc-server');
      this.rpcServer = new JSONRPCServer({ port: rpcPort });
      
      // Register basic methods
      this.rpcServer.registerMethod('system.ping', async () => {
        return { status: 'ok', timestamp: new Date().toISOString() };
      });
      
      this.rpcServer.registerMethod('system.status', async () => {
        return {
          mqtt: this.mqttBroker.getStats(),
          rpc: this.rpcServer.getStats(),
          uptime: process.uptime()
        };
      });
      
      await this.rpcServer.start();
      logger.info(`✅ JSON-RPC server running on port ${rpcPort}`);

      this.running = true;
      this.setupShutdownHandlers();
      
      logger.info('✅ Infrastructure services started successfully!');
      
      // Keep alive with periodic status
      this.keepAlive();
      
    } catch (error) {
      logger.error('❌ Failed to start infrastructure:', error);
      await this.shutdown();
      process.exit(1);
    }
  }

  keepAlive() {
    setInterval(() => {
      if (this.running) {
        logger.info('📊 Services running - MQTT clients:', this.mqttBroker.getStats().clients);
      }
    }, 30000); // Every 30 seconds
  }

  setupShutdownHandlers() {
    const shutdown = async (signal) => {
      logger.info(`Received ${signal}, shutting down...`);
      await this.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('SIGQUIT', shutdown);
  }

  async shutdown() {
    if (!this.running) return;
    
    logger.info('🛑 Shutting down infrastructure services...');
    this.running = false;

    if (this.rpcServer) {
      await this.rpcServer.stop();
    }

    if (this.mqttBroker) {
      await this.mqttBroker.stop();
    }

    await portManager.cleanup();
    logger.info('✅ Infrastructure services stopped');
  }
}

// Start the infrastructure
const manager = new InfrastructureManager();
manager.start();