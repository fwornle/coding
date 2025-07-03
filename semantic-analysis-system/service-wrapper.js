#!/usr/bin/env node

/**
 * Semantic Analysis System Service Wrapper
 * 
 * Integrates the semantic analysis system with the main project's
 * service lifecycle management and port allocation.
 */

import { SemanticAnalysisSystem } from './index.js';
import { Logger } from './shared/logger.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import process from 'process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class ServiceWrapper {
  constructor() {
    this.logger = new Logger('service-wrapper');
    this.system = null;
    this.healthy = false;
  }

  /**
   * Initialize with inherited environment from parent project
   */
  async initialize() {
    this.logger.info('Initializing Semantic Analysis System with inherited environment...');
    
    // Ensure we inherit ALL environment variables from parent
    const requiredEnvVars = [
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'CODING_TOOLS_PATH',
      'CODING_KB_PATH'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    if (missingVars.length > 0) {
      this.logger.warn(`Missing environment variables: ${missingVars.join(', ')}`);
      this.logger.warn('Some features may not work correctly');
    }

    // Use ports from environment (set by port manager)
    const config = {
      mqtt: {
        port: parseInt(process.env.MQTT_BROKER_PORT || '1883'),
        wsPort: parseInt(process.env.MQTT_WS_PORT || '8883')
      },
      rpc: {
        port: parseInt(process.env.JSON_RPC_PORT || '8081')
      },
      monitoring: {
        port: parseInt(process.env.MONITORING_PORT || '9090')
      }
    };

    this.logger.info('Port configuration:', config);

    // Create semantic analysis system
    this.system = new SemanticAnalysisSystem(config);
  }

  /**
   * Start the system
   */
  async start() {
    try {
      await this.initialize();
      
      this.logger.info('Starting Semantic Analysis System...');
      await this.system.start();
      
      this.healthy = true;
      this.logger.info('Semantic Analysis System started successfully');
      
      // Set up health check endpoint
      this.setupHealthCheck();
      
    } catch (error) {
      this.logger.error('Failed to start Semantic Analysis System:', error);
      this.healthy = false;
      throw error;
    }
  }

  /**
   * Stop the system
   */
  async stop() {
    try {
      this.logger.info('Stopping Semantic Analysis System...');
      
      if (this.system) {
        await this.system.shutdown();
      }
      
      this.healthy = false;
      this.logger.info('Semantic Analysis System stopped');
      
    } catch (error) {
      this.logger.error('Error stopping Semantic Analysis System:', error);
      throw error;
    }
  }

  /**
   * Setup health check endpoint
   */
  setupHealthCheck() {
    // The RPC server should expose a health endpoint
    if (this.system.rpcServer) {
      this.system.rpcServer.registerMethod('health', () => {
        return {
          status: this.healthy ? 'healthy' : 'unhealthy',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          agents: this.system.supervisor?.getStats() || {},
          infrastructure: {
            mqtt: this.system.mqttBroker?.isRunning() || false,
            rpc: this.system.rpcServer?.isRunning() || false
          }
        };
      });
    }
  }

  /**
   * Get system status
   */
  getStatus() {
    return {
      healthy: this.healthy,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      agents: this.system?.supervisor?.getStats() || {},
      infrastructure: {
        mqtt: this.system?.mqttBroker?.isRunning() || false,
        rpc: this.system?.rpcServer?.isRunning() || false
      }
    };
  }
}

// Handle command line usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const wrapper = new ServiceWrapper();
  
  // Handle shutdown signals
  const shutdown = async (signal) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    try {
      await wrapper.stop();
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start the system
  wrapper.start().catch(error => {
    console.error('Failed to start:', error);
    process.exit(1);
  });
}

export { ServiceWrapper };