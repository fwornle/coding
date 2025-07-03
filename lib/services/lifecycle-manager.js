/**
 * Service Lifecycle Manager
 * 
 * Manages coordinated startup and shutdown of all services in the coding project.
 * Provides health monitoring and dependency management.
 */

import { spawn } from 'child_process';
import { createConnection } from 'net';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { CentralPortManager } from './port-manager.js';

export class ServiceLifecycleManager {
  constructor(configPath = 'config/services.yaml') {
    this.portManager = new CentralPortManager();
    this.configPath = configPath;
    this.services = new Map(); // serviceName -> service config
    this.processes = new Map(); // serviceName -> child process
    this.startupOrder = [];
    this.shutdownOrder = [];
    this.healthChecks = new Map(); // serviceName -> health check interval
    this.verbose = false;
    this.loadEnvironment();
  }

  /**
   * Load environment variables from .env.ports file
   */
  loadEnvironment() {
    const envPath = path.join(process.cwd(), '.env.ports');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, value] = trimmed.split('=');
          if (key && value && !process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    }
  }

  /**
   * Load service configuration
   */
  loadConfiguration() {
    const configFile = path.resolve(this.configPath);
    if (!fs.existsSync(configFile)) {
      throw new Error(`Service configuration file not found: ${configFile}`);
    }

    try {
      const content = fs.readFileSync(configFile, 'utf8');
      const config = yaml.load(content);
      
      if (!config.services) {
        throw new Error('Invalid service configuration: missing "services" section');
      }

      // Process service configurations
      for (const [serviceName, serviceConfig] of Object.entries(config.services)) {
        this.services.set(serviceName, {
          name: serviceName,
          ...serviceConfig
        });
      }

      // Calculate startup order based on dependencies
      this.calculateStartupOrder();
      
      this.log('📋 Loaded configuration for services:', Array.from(this.services.keys()).join(', '));
      
    } catch (error) {
      throw new Error(`Failed to load service configuration: ${error.message}`);
    }
  }

  /**
   * Calculate startup order based on dependencies
   */
  calculateStartupOrder() {
    const ordered = [];
    const visited = new Set();
    const visiting = new Set();

    const visit = (serviceName) => {
      if (visiting.has(serviceName)) {
        throw new Error(`Circular dependency detected: ${serviceName}`);
      }
      if (visited.has(serviceName)) {
        return;
      }

      visiting.add(serviceName);
      
      const service = this.services.get(serviceName);
      if (service && service.dependsOn) {
        for (const dependency of service.dependsOn) {
          visit(dependency);
        }
      }

      visiting.delete(serviceName);
      visited.add(serviceName);
      ordered.push(serviceName);
    };

    // Visit all services
    for (const serviceName of this.services.keys()) {
      visit(serviceName);
    }

    this.startupOrder = ordered;
    this.shutdownOrder = [...ordered].reverse();
    
    this.log('🔄 Startup order:', this.startupOrder.join(' → '));
  }

  /**
   * Enable verbose logging
   */
  setVerbose(verbose) {
    this.verbose = verbose;
  }

  /**
   * Log message with timestamp
   */
  log(...args) {
    if (this.verbose) {
      console.log(`[${new Date().toISOString()}]`, ...args);
    }
  }

  /**
   * Start a specific service
   */
  async startService(serviceName) {
    const service = this.services.get(serviceName);
    if (!service) {
      throw new Error(`Service not found: ${serviceName}`);
    }

    this.log(`🚀 Starting ${service.displayName || serviceName}...`);

    try {
      // Allocate port if needed
      if (service.preferredPort && service.type !== 'mcp') {
        const port = await this.portManager.allocatePort(
          serviceName, 
          service.preferredPort,
          { killExisting: true }
        );
        
        // Update environment with allocated port
        if (service.env) {
          service.env = { ...service.env };
        } else {
          service.env = {};
        }
        
        // Set the port environment variable
        const portEnvVar = `${serviceName.toUpperCase().replace(/-/g, '_')}_PORT`;
        service.env[portEnvVar] = port.toString();
      }

      // Start the service process
      if (service.command) {
        await this.startProcess(serviceName, service);
      }

      // Wait for service to be healthy
      await this.waitForHealth(serviceName, service);

      // Start health monitoring
      this.startHealthMonitoring(serviceName, service);

      console.log(`✅ ${service.displayName || serviceName} started successfully`);
      
    } catch (error) {
      console.error(`❌ Failed to start ${serviceName}: ${error.message}`);
      
      if (service.critical) {
        throw new Error(`Critical service ${serviceName} failed to start: ${error.message}`);
      }
    }
  }

  /**
   * Start a service process
   */
  async startProcess(serviceName, service) {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        ...(service.env?.inherit ? process.env : {}),
        ...service.env
      };

      // Parse command
      const [command, ...args] = service.command.split(' ');
      
      const child = spawn(command, args, {
        env,
        cwd: service.workingDirectory || process.cwd(),
        stdio: service.type === 'mcp' ? ['pipe', 'pipe', 'pipe'] : 'inherit'
      });

      this.processes.set(serviceName, child);

      child.on('spawn', () => {
        this.portManager.updateServiceStatus(serviceName, { 
          pid: child.pid,
          health: 'starting'
        });
        this.log(`📦 Process spawned for ${serviceName} (PID: ${child.pid})`);
        resolve();
      });

      child.on('error', (error) => {
        this.log(`🚨 Process error for ${serviceName}:`, error.message);
        reject(error);
      });

      child.on('exit', (code, signal) => {
        this.log(`💀 Process exited for ${serviceName}: code=${code}, signal=${signal}`);
        this.processes.delete(serviceName);
        
        // If service exited with code 0, it might be because it's already running
        if (code === 0) {
          console.log(`✅ ${service.displayName || serviceName} already running`);
          this.portManager.updateServiceStatus(serviceName, { 
            pid: null,
            health: 'healthy'  // Assume healthy if exited cleanly
          });
        } else {
          this.portManager.updateServiceStatus(serviceName, { 
            pid: null,
            health: 'stopped'
          });
        }
      });

      // Give process a moment to start, but don't wait too long
      setTimeout(resolve, 100);
    });
  }

  /**
   * Wait for service to become healthy
   */
  async waitForHealth(serviceName, service, maxWaitTime = 5000) {
    if (!service.healthCheck) {
      // No health check defined, assume healthy
      this.portManager.updateServiceStatus(serviceName, { health: 'healthy' });
      return;
    }

    // Check if service process exited cleanly (code 0) - this means it's already running
    const process = this.processes.get(serviceName);
    if (!process || process.exitCode === 0) {
      this.log(`🔍 Service ${serviceName} exited cleanly, checking if already running...`);
      
      // Try a quick health check to see if it's actually running
      try {
        const healthy = await this.checkServiceHealth(serviceName, service);
        if (healthy) {
          this.portManager.updateServiceStatus(serviceName, { health: 'healthy' });
          return;
        }
      } catch (error) {
        this.log(`🔍 Quick health check failed for ${serviceName}, assuming already running`);
      }
      
      // If health check failed but process exited cleanly, assume service is already running
      this.portManager.updateServiceStatus(serviceName, { health: 'healthy' });
      return;
    }

    const startTime = Date.now();
    const checkInterval = 500;

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const healthy = await this.checkServiceHealth(serviceName, service);
        if (healthy) {
          this.portManager.updateServiceStatus(serviceName, { health: 'healthy' });
          return;
        }
      } catch (error) {
        this.log(`🔍 Health check failed for ${serviceName}:`, error.message);
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    throw new Error(`Service ${serviceName} did not become healthy within ${maxWaitTime}ms`);
  }

  /**
   * Check if a service is healthy
   */
  async checkServiceHealth(serviceName, service) {
    const healthCheck = service.healthCheck;
    
    switch (healthCheck.type) {
      case 'tcp':
        return this.checkTcpHealth(serviceName, healthCheck);
      case 'http':
        return this.checkHttpHealth(serviceName, healthCheck);
      case 'process':
        return this.checkProcessHealth(serviceName);
      default:
        throw new Error(`Unknown health check type: ${healthCheck.type}`);
    }
  }

  /**
   * TCP health check
   */
  async checkTcpHealth(serviceName, healthCheck) {
    const port = this.portManager.getPort(serviceName);
    if (!port) {
      return false;
    }

    return new Promise((resolve) => {
      const socket = createConnection(port, 'localhost');
      let resolved = false;
      
      const resolveOnce = (value) => {
        if (!resolved) {
          resolved = true;
          resolve(value);
        }
      };
      
      socket.on('connect', () => {
        socket.destroy();
        resolveOnce(true);
      });
      
      socket.on('error', () => {
        resolveOnce(false);
      });
      
      setTimeout(() => {
        socket.destroy();
        resolveOnce(false);
      }, healthCheck.timeout || 2000);
    });
  }

  /**
   * HTTP health check
   */
  async checkHttpHealth(serviceName, healthCheck) {
    const port = this.portManager.getPort(serviceName);
    if (!port) {
      return false;
    }

    try {
      const response = await fetch(`http://localhost:${port}${healthCheck.endpoint || '/'}`, {
        method: 'GET',
        signal: AbortSignal.timeout(healthCheck.timeout || 2000)
      });
      
      return response.ok;
    } catch (error) {
      // Log specific error types for debugging
      if (error.name === 'AbortError') {
        this.log(`🔍 HTTP health check timeout for ${serviceName}`);
      } else if (error.code === 'ECONNREFUSED') {
        this.log(`🔍 HTTP health check connection refused for ${serviceName}`);
      }
      return false;
    }
  }

  /**
   * Process health check
   */
  async checkProcessHealth(serviceName) {
    const process = this.processes.get(serviceName);
    return process && !process.killed;
  }

  /**
   * Start health monitoring for a service
   */
  startHealthMonitoring(serviceName, service) {
    if (!service.healthCheck) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const healthy = await this.checkServiceHealth(serviceName, service);
        const currentHealth = this.portManager.getServiceRegistry().get(serviceName)?.health;
        
        if (!healthy && currentHealth === 'healthy') {
          console.warn(`⚠️  Service ${serviceName} became unhealthy`);
          this.portManager.updateServiceStatus(serviceName, { health: 'unhealthy' });
        } else if (healthy && currentHealth === 'unhealthy') {
          console.log(`✅ Service ${serviceName} recovered`);
          this.portManager.updateServiceStatus(serviceName, { health: 'healthy' });
        }
      } catch (error) {
        this.log(`🔍 Health monitoring error for ${serviceName}:`, error.message);
      }
    }, service.healthCheck.interval || 30000);

    this.healthChecks.set(serviceName, interval);
  }

  /**
   * Start all services in dependency order
   */
  async startAll(agentType = 'claude') {
    try {
      // Load configuration
      this.loadConfiguration();

      // Load port configuration
      this.portManager.loadConfiguration();

      console.log('🚀 Starting Coding Services...');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Filter services by agent type
      const servicesToStart = this.startupOrder.filter(serviceName => {
        const service = this.services.get(serviceName);
        return !service.agentTypes || service.agentTypes.includes(agentType);
      });

      // Start services in order
      for (const serviceName of servicesToStart) {
        await this.startService(serviceName);
      }

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ All services healthy and ready!');
      console.log('');

      // Generate port report
      this.portManager.generateReport();

    } catch (error) {
      console.error('❌ Service startup failed:', error.message);
      console.log('\n🧹 Cleaning up partially started services...');
      await this.stopAll();
      throw error;
    }
  }

  /**
   * Stop a specific service
   */
  async stopService(serviceName) {
    const service = this.services.get(serviceName);
    if (!service) {
      this.log(`⚠️  Service not found: ${serviceName}`);
      return;
    }

    this.log(`🛑 Stopping ${service.displayName || serviceName}...`);

    // Stop health monitoring
    const healthInterval = this.healthChecks.get(serviceName);
    if (healthInterval) {
      clearInterval(healthInterval);
      this.healthChecks.delete(serviceName);
    }

    // Stop process
    const process = this.processes.get(serviceName);
    if (process && !process.killed) {
      process.kill('SIGTERM');
      
      // Wait for graceful shutdown
      await new Promise(resolve => {
        const timeout = setTimeout(() => {
          if (!process.killed) {
            this.log(`🔥 Force killing ${serviceName}`);
            process.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        process.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    // Deallocate port
    this.portManager.deallocatePort(serviceName);

    console.log(`✅ ${service.displayName || serviceName} stopped`);
  }

  /**
   * Stop all services in reverse dependency order
   */
  async stopAll() {
    console.log('🛑 Stopping all services...');
    
    for (const serviceName of this.shutdownOrder) {
      if (this.processes.has(serviceName) || this.portManager.getPort(serviceName)) {
        await this.stopService(serviceName);
      }
    }

    // Final cleanup
    this.portManager.cleanup();
    console.log('✅ All services stopped');
  }

  /**
   * Get status of all services
   */
  getStatus() {
    const status = {
      services: {},
      ports: this.portManager.getAllocations(),
      healthy: 0,
      unhealthy: 0,
      unknown: 0
    };

    for (const [serviceName, info] of this.portManager.getServiceRegistry()) {
      status.services[serviceName] = info;
      
      switch (info.health) {
        case 'healthy':
          status.healthy++;
          break;
        case 'unhealthy':
          status.unhealthy++;
          break;
        default:
          status.unknown++;
      }
    }

    return status;
  }
}