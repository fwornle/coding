/**
 * Robust Startup System
 * Ensures reliable startup with comprehensive validation, error handling, and rollback
 */

import { Logger } from '../../shared/logger.js';
import { portManager } from '../../shared/port-manager.js';
import { MQTTBroker } from '../../infrastructure/mqtt/broker.js';
import { JSONRPCServer } from '../../infrastructure/rpc/server.js';

const logger = new Logger('robust-startup');

export class RobustStartupManager {
  constructor() {
    this.startedServices = new Map();
    this.startupPhase = 'INIT';
    this.startupErrors = [];
  }

  /**
   * Robust startup with comprehensive validation and error handling
   */
  async startSystem() {
    try {
      logger.info('🚀 Starting Robust Semantic Analysis System...');
      
      // Phase 1: Pre-startup validation
      await this.validateSystemRequirements();
      
      // Phase 2: Port management and allocation
      await this.setupPortManagement();
      
      // Phase 3: Infrastructure startup with validation
      await this.startInfrastructure();
      
      // Phase 4: Health validation
      await this.validateSystemHealth();
      
      logger.info('✅ System startup completed successfully');
      return true;
      
    } catch (error) {
      logger.error('❌ System startup failed:', error);
      await this.rollbackStartup();
      throw error;
    }
  }

  /**
   * Phase 1: Validate system requirements before attempting startup
   */
  async validateSystemRequirements() {
    this.startupPhase = 'VALIDATION';
    logger.info('📋 Validating system requirements...');

    const checks = [
      { name: 'Node.js version', check: () => this.validateNodeVersion() },
      { name: 'Required directories', check: () => this.validateDirectories() },
      { name: 'Environment variables', check: () => this.validateEnvironment() },
      { name: 'System resources', check: () => this.validateResources() }
    ];

    for (const { name, check } of checks) {
      try {
        await check();
        logger.info(`✅ ${name} validation passed`);
      } catch (error) {
        logger.error(`❌ ${name} validation failed:`, error);
        throw new Error(`System validation failed: ${name} - ${error.message}`);
      }
    }
  }

  async validateNodeVersion() {
    const version = process.version;
    const major = parseInt(version.substring(1).split('.')[0]);
    if (major < 16) {
      throw new Error(`Node.js ${major} not supported. Requires Node.js 16+`);
    }
  }

  async validateDirectories() {
    const fs = await import('fs');
    const requiredDirs = ['./logs', './config', './shared'];
    
    for (const dir of requiredDirs) {
      try {
        await fs.promises.access(dir);
      } catch (error) {
        await fs.promises.mkdir(dir, { recursive: true });
        logger.info(`Created missing directory: ${dir}`);
      }
    }
  }

  async validateEnvironment() {
    // Check critical environment variables
    const required = [];
    const optional = ['GOOGLE_API_KEY', 'GOOGLE_CSE_ID'];
    
    for (const envVar of required) {
      if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
      }
    }
    
    for (const envVar of optional) {
      if (!process.env[envVar]) {
        logger.warn(`Optional environment variable not set: ${envVar}`);
      }
    }
  }

  async validateResources() {
    const usage = process.memoryUsage();
    const availableMemory = usage.heapTotal;
    
    if (availableMemory < 100 * 1024 * 1024) { // 100MB minimum
      logger.warn('Low memory available, system may be unstable');
    }
  }

  /**
   * Phase 2: Setup port management with validation
   */
  async setupPortManagement() {
    this.startupPhase = 'PORT_MANAGEMENT';
    logger.info('🔌 Setting up port management...');

    try {
      // Initialize and validate port manager
      await portManager.initialize();
      
      // Validate all ports are actually available
      await this.validatePortAllocations();
      
      logger.info('✅ Port management setup completed');
      
    } catch (error) {
      throw new Error(`Port management setup failed: ${error.message}`);
    }
  }

  async validatePortAllocations() {
    const allocations = portManager.serviceRegistry;
    
    for (const [serviceId, config] of Object.entries(allocations)) {
      if (config.type === 'stdio') continue;
      
      const port = config.current;
      if (!port) {
        throw new Error(`No port allocated for ${serviceId}`);
      }
      
      // Double-check port is actually available
      const isAvailable = await portManager.isPortAvailable(port);
      if (!isAvailable) {
        throw new Error(`Port ${port} for ${serviceId} is not actually available`);
      }
    }
    
    logger.info('✅ All port allocations validated');
  }

  /**
   * Phase 3: Start infrastructure services with validation
   */
  async startInfrastructure() {
    this.startupPhase = 'INFRASTRUCTURE';
    logger.info('🏗️ Starting infrastructure services...');

    const services = [
      { 
        name: 'MQTT Broker', 
        id: 'mqtt-broker',
        starter: () => this.startMqttBroker(),
        validator: () => this.validateMqttBroker(),
        healthCheck: () => this.healthCheckMqttBroker()
      },
      { 
        name: 'JSON-RPC Server', 
        id: 'json-rpc',
        starter: () => this.startJsonRpcServer(),
        validator: () => this.validateJsonRpcServer(),
        healthCheck: () => this.healthCheckJsonRpcServer()
      }
    ];

    for (const service of services) {
      try {
        logger.info(`🔄 Starting ${service.name}...`);
        
        // Start the service
        const instance = await service.starter();
        this.startedServices.set(service.id, instance);
        
        // Validate startup
        await service.validator();
        
        // Health check
        await service.healthCheck();
        
        logger.info(`✅ ${service.name} started and validated`);
        
      } catch (error) {
        logger.error(`❌ Failed to start ${service.name}:`, error);
        throw new Error(`Infrastructure startup failed: ${service.name} - ${error.message}`);
      }
    }
  }

  async startMqttBroker() {
    const port = portManager.getPort('mqtt-broker-tcp');
    const wsPort = portManager.getPort('mqtt-broker-ws');
    
    const broker = new MQTTBroker({
      port: port,
      wsPort: wsPort,
      host: '127.0.0.1' // Bind to localhost only for security
    });
    
    await broker.start();
    return broker;
  }

  async validateMqttBroker() {
    const broker = this.startedServices.get('mqtt-broker');
    if (!broker || !broker.aedes) {
      throw new Error('MQTT broker not properly initialized');
    }
    
    // Validate ports are actually listening
    const port = portManager.getPort('mqtt-broker-tcp');
    const isListening = await this.isPortListening(port);
    if (!isListening) {
      throw new Error(`MQTT broker not listening on port ${port}`);
    }
  }

  async healthCheckMqttBroker() {
    const broker = this.startedServices.get('mqtt-broker');
    const stats = broker.getStats();
    
    logger.info(`MQTT Broker Health: ${stats.clients} clients connected`);
  }

  async startJsonRpcServer() {
    const port = portManager.getPort('json-rpc-server');
    
    // Import server class
    const { JSONRPCServer } = await import('../../infrastructure/rpc/server.js');
    const server = new JSONRPCServer({ port });
    
    await server.start();
    return server;
  }

  async validateJsonRpcServer() {
    const server = this.startedServices.get('json-rpc');
    if (!server) {
      throw new Error('JSON-RPC server not properly initialized');
    }
    
    // Validate port is listening
    const port = portManager.getPort('json-rpc-server');
    const isListening = await this.isPortListening(port);
    if (!isListening) {
      throw new Error(`JSON-RPC server not listening on port ${port}`);
    }
  }

  async healthCheckJsonRpcServer() {
    const port = portManager.getPort('json-rpc-server');
    
    try {
      // Simple HTTP request to check if server responds
      const response = await fetch(`http://localhost:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'system.ping',
          id: 1
        })
      });
      
      if (!response.ok) {
        throw new Error(`JSON-RPC server returned status ${response.status}`);
      }
      
      logger.info('JSON-RPC Server Health: Responding to requests');
      
    } catch (error) {
      logger.warn('JSON-RPC health check failed, but server is running:', error.message);
    }
  }

  /**
   * Phase 4: Final system health validation
   */
  async validateSystemHealth() {
    this.startupPhase = 'HEALTH_VALIDATION';
    logger.info('🏥 Validating system health...');

    const healthChecks = [
      { name: 'Memory usage', check: () => this.checkMemoryHealth() },
      { name: 'Service connectivity', check: () => this.checkServiceConnectivity() },
      { name: 'Port bindings', check: () => this.checkPortBindings() }
    ];

    for (const { name, check } of healthChecks) {
      try {
        await check();
        logger.info(`✅ ${name} health check passed`);
      } catch (error) {
        logger.warn(`⚠️ ${name} health check failed:`, error.message);
        // Health check failures are warnings, not fatal errors
      }
    }
  }

  async checkMemoryHealth() {
    const usage = process.memoryUsage();
    const heapUsed = Math.round(usage.heapUsed / 1024 / 1024);
    const heapTotal = Math.round(usage.heapTotal / 1024 / 1024);
    
    logger.info(`Memory usage: ${heapUsed}MB / ${heapTotal}MB`);
    
    if (heapUsed > heapTotal * 0.9) {
      throw new Error('High memory usage detected');
    }
  }

  async checkServiceConnectivity() {
    // Test inter-service connectivity
    const mqttPort = portManager.getPort('mqtt-broker-tcp');
    const rpcPort = portManager.getPort('json-rpc-server');
    
    const connectivityTests = [
      { service: 'MQTT', port: mqttPort },
      { service: 'JSON-RPC', port: rpcPort }
    ];
    
    for (const { service, port } of connectivityTests) {
      const canConnect = await this.canConnectToPort(port);
      if (!canConnect) {
        throw new Error(`Cannot connect to ${service} on port ${port}`);
      }
    }
  }

  async checkPortBindings() {
    const allocations = portManager.serviceRegistry;
    
    for (const [serviceId, config] of Object.entries(allocations)) {
      if (config.type !== 'listen') continue;
      
      const isListening = await this.isPortListening(config.current);
      if (!isListening) {
        throw new Error(`Service ${serviceId} not listening on port ${config.current}`);
      }
    }
  }

  /**
   * Utility: Check if a port is listening
   */
  async isPortListening(port) {
    const net = await import('net');
    
    return new Promise((resolve) => {
      const client = net.createConnection({ port, host: '127.0.0.1' });
      
      client.on('connect', () => {
        client.end();
        resolve(true);
      });
      
      client.on('error', () => {
        resolve(false);
      });
      
      // Timeout after 2 seconds
      setTimeout(() => {
        client.destroy();
        resolve(false);
      }, 2000);
    });
  }

  /**
   * Utility: Check if we can connect to a port
   */
  async canConnectToPort(port) {
    return this.isPortListening(port);
  }

  /**
   * Rollback: Clean shutdown of started services
   */
  async rollbackStartup() {
    logger.warn('🔄 Rolling back startup due to failure...');
    
    for (const [serviceId, service] of this.startedServices) {
      try {
        if (service.stop) {
          await service.stop();
          logger.info(`✅ Rolled back ${serviceId}`);
        }
      } catch (error) {
        logger.error(`❌ Failed to rollback ${serviceId}:`, error);
      }
    }
    
    this.startedServices.clear();
    
    // Cleanup port manager
    try {
      await portManager.cleanup();
      logger.info('✅ Port manager cleaned up');
    } catch (error) {
      logger.error('❌ Failed to cleanup port manager:', error);
    }
  }

  /**
   * Get system status
   */
  getSystemStatus() {
    return {
      phase: this.startupPhase,
      startedServices: Array.from(this.startedServices.keys()),
      errors: this.startupErrors,
      portAllocations: portManager.serviceRegistry,
      health: {
        memory: process.memoryUsage(),
        uptime: process.uptime()
      }
    };
  }
}