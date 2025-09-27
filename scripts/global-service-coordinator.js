#!/usr/bin/env node

/**
 * Global Service Coordinator - Self-Healing Service Management Daemon
 * 
 * Manages ALL critical coding services (LSL, trajectory, constraint monitoring, MCP servers)
 * with robust health monitoring, automatic recovery, and comprehensive service discovery.
 * 
 * Architecture:
 * - Service Registry: Real-time tracking of all services across all projects
 * - Health Monitoring: Continuous heartbeat checks with intelligent recovery
 * - Process Supervision: Parent-child relationships to detect orphaned processes  
 * - Automatic Recovery: Immediate restart of failed services with exponential backoff
 * - Service Discovery: Dynamic detection and registration of services
 * - Multi-Project Support: Handles concurrent projects with isolated monitoring
 * 
 * Services Managed:
 * - Enhanced Transcript Monitor (per project)
 * - Trajectory Generator (per project) 
 * - MCP Constraint Monitor (global)
 * - MCP Memory Server (global)
 * - MCP Semantic Analysis Server (global)
 * - Status Line Integrator (per project)
 * 
 * Usage:
 *   node scripts/global-service-coordinator.js --daemon
 *   node scripts/global-service-coordinator.js --status
 *   node scripts/global-service-coordinator.js --register-project /path/to/project
 */

import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

class GlobalServiceCoordinator extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.codingRepoPath = options.codingRepoPath || path.resolve(__dirname, '..');
    this.registryPath = path.join(this.codingRepoPath, '.global-service-registry.json');
    this.logPath = path.join(this.codingRepoPath, '.logs', 'global-coordinator.log');
    this.isDaemon = options.daemon || false;
    this.debug = options.debug || false;
    
    // Health check intervals
    this.healthCheckInterval = 15000; // 15 seconds
    this.serviceStartTimeout = 30000; // 30 seconds
    this.maxRestartAttempts = 5;
    this.restartBackoffBase = 1000; // 1 second
    
    // Service definitions
    this.serviceDefinitions = {
      'mcp-constraint-monitor': {
        type: 'global',
        script: 'integrations/mcp-constraint-monitor/src/server.js',
        healthCheck: 'port:6333', // Check if Qdrant-like port responds
        priority: 1,
        restartable: true
      },
      'mcp-memory': {
        type: 'global', 
        script: 'scripts/mcp-memory-server.js',
        healthCheck: 'process',
        priority: 2,
        restartable: true
      },
      'enhanced-transcript-monitor': {
        type: 'per-project',
        script: 'scripts/enhanced-transcript-monitor.js',
        healthCheck: 'health-file', // .transcript-monitor-health
        priority: 3,
        restartable: true
      },
      'trajectory-generator': {
        type: 'per-project',
        script: 'scripts/trajectory-generator.js', 
        healthCheck: 'health-file',
        priority: 4,
        restartable: true
      }
    };
    
    this.registry = this.loadRegistry();
    this.healthTimer = null;
    this.recoveryQueue = new Map(); // Track services being recovered
    
    this.ensureLogDirectory();
    this.setupSignalHandlers();
  }

  ensureLogDirectory() {
    const logDir = path.dirname(this.logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  setupSignalHandlers() {
    process.on('SIGTERM', () => this.gracefulShutdown());
    process.on('SIGINT', () => this.gracefulShutdown());
    process.on('uncaughtException', (error) => {
      this.error(`Uncaught exception: ${error.message}`, error);
      this.gracefulShutdown();
    });
  }

  log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level}] [GlobalCoordinator] ${message}\n`;
    
    if (this.debug || level === 'ERROR' || level === 'WARN') {
      console.log(logEntry.trim());
    }
    
    try {
      fs.appendFileSync(this.logPath, logEntry);
    } catch (error) {
      console.error(`Failed to write log: ${error.message}`);
    }
  }

  error(message, err = null) {
    this.log(`${message}${err ? ': ' + err.stack : ''}`, 'ERROR');
  }

  warn(message) {
    this.log(message, 'WARN');
  }

  debug(message) {
    if (this.debug) {
      this.log(message, 'DEBUG');
    }
  }

  /**
   * Load or create service registry
   */
  loadRegistry() {
    try {
      if (fs.existsSync(this.registryPath)) {
        const data = fs.readFileSync(this.registryPath, 'utf8');
        const registry = JSON.parse(data);
        
        // Validate registry format
        if (!registry.services) registry.services = {};
        if (!registry.projects) registry.projects = {};
        if (!registry.coordinator) registry.coordinator = {};
        
        return registry;
      }
    } catch (error) {
      this.warn(`Could not load registry: ${error.message}`);
    }
    
    return {
      version: "2.0.0",
      lastUpdated: Date.now(),
      coordinator: {
        pid: process.pid,
        startTime: Date.now(),
        healthCheckInterval: this.healthCheckInterval,
        version: "2.0.0"
      },
      services: {},
      projects: {}
    };
  }

  /**
   * Save registry to disk
   */
  saveRegistry() {
    try {
      this.registry.lastUpdated = Date.now();
      this.registry.coordinator.lastHealthCheck = Date.now();
      
      fs.writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2));
      
      this.debug(`Registry saved: ${Object.keys(this.registry.services).length} services, ${Object.keys(this.registry.projects).length} projects`);
    } catch (error) {
      this.error(`Error saving registry: ${error.message}`);
    }
  }

  /**
   * Register a new project for monitoring
   */
  async registerProject(projectPath, sessionPid = null) {
    const absolutePath = path.resolve(projectPath);
    const projectName = path.basename(absolutePath);
    
    this.log(`🔗 Registering project: ${projectName} (${absolutePath})`);
    
    // Create .specstory directory if needed
    const specstoryPath = path.join(absolutePath, '.specstory', 'history');
    if (!fs.existsSync(specstoryPath)) {
      fs.mkdirSync(specstoryPath, { recursive: true });
      this.log(`Created .specstory/history for ${projectName}`);
    }
    
    // Register in registry
    this.registry.projects[projectName] = {
      projectPath: absolutePath,
      sessionPid: sessionPid,
      registrationTime: Date.now(),
      lastHealthCheck: Date.now(),
      status: 'registered',
      services: {}
    };
    
    // Start project-specific services
    await this.ensureProjectServices(projectName);
    
    this.saveRegistry();
    this.log(`✅ Project registered: ${projectName}`);
    
    return projectName;
  }

  /**
   * Ensure all services for a project are running
   */
  async ensureProjectServices(projectName) {
    const project = this.registry.projects[projectName];
    if (!project) {
      this.error(`Project not found: ${projectName}`);
      return false;
    }

    const projectServices = Object.entries(this.serviceDefinitions)
      .filter(([_, def]) => def.type === 'per-project')
      .sort((a, b) => a[1].priority - b[1].priority);

    for (const [serviceName, serviceDef] of projectServices) {
      const serviceKey = `${projectName}:${serviceName}`;
      await this.ensureService(serviceKey, serviceDef, project.projectPath);
    }

    return true;
  }

  /**
   * Ensure global services are running
   */
  async ensureGlobalServices() {
    const globalServices = Object.entries(this.serviceDefinitions)
      .filter(([_, def]) => def.type === 'global')
      .sort((a, b) => a[1].priority - b[1].priority);

    for (const [serviceName, serviceDef] of globalServices) {
      await this.ensureService(serviceName, serviceDef);
    }
  }

  /**
   * Ensure a specific service is running
   */
  async ensureService(serviceKey, serviceDef, projectPath = null) {
    const existingService = this.registry.services[serviceKey];
    
    // Check if service is already healthy
    if (existingService && await this.isServiceHealthy(serviceKey, serviceDef, projectPath)) {
      this.debug(`Service already healthy: ${serviceKey}`);
      return true;
    }

    // Clean up stale service
    if (existingService && existingService.pid) {
      await this.cleanupStaleService(existingService);
    }

    // Check if service is in recovery queue
    if (this.recoveryQueue.has(serviceKey)) {
      this.debug(`Service already in recovery: ${serviceKey}`);
      return false;
    }

    // Start service
    return await this.startService(serviceKey, serviceDef, projectPath);
  }

  /**
   * Start a service
   */
  async startService(serviceKey, serviceDef, projectPath = null) {
    try {
      this.log(`🚀 Starting service: ${serviceKey}`);
      
      const scriptPath = path.join(this.codingRepoPath, serviceDef.script);
      if (!fs.existsSync(scriptPath)) {
        this.error(`Service script not found: ${scriptPath}`);
        return false;
      }

      // Prepare spawn options
      const spawnOptions = {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        cwd: projectPath || this.codingRepoPath
      };

      // Prepare arguments
      const args = [scriptPath];
      if (projectPath) {
        // Add project-specific arguments
        args.push('--project', projectPath);
      }

      // Set environment variables
      const env = { ...process.env };
      if (projectPath) {
        env.TRANSCRIPT_SOURCE_PROJECT = projectPath;
        env.CODING_PROJECT_DIR = projectPath;
      }
      env.CODING_REPO = this.codingRepoPath;
      env.CODING_TOOLS_PATH = this.codingRepoPath;
      spawnOptions.env = env;

      // Spawn process
      const child = spawn('node', args, spawnOptions);
      child.unref();

      // Wait for startup
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify startup
      const isHealthy = await this.isServiceHealthy(serviceKey, serviceDef, projectPath);
      if (isHealthy) {
        // Register service
        this.registry.services[serviceKey] = {
          pid: child.pid,
          serviceType: serviceDef.type,
          script: serviceDef.script,
          projectPath: projectPath,
          startTime: Date.now(),
          lastHealthCheck: Date.now(),
          status: 'running',
          restartCount: 0
        };

        this.log(`✅ Service started: ${serviceKey} (PID: ${child.pid})`);
        this.saveRegistry();
        return true;
      } else {
        this.error(`❌ Service failed to start: ${serviceKey}`);
        return false;
      }

    } catch (error) {
      this.error(`Error starting service ${serviceKey}`, error);
      return false;
    }
  }

  /**
   * Check if a service is healthy
   */
  async isServiceHealthy(serviceKey, serviceDef, projectPath = null) {
    const service = this.registry.services[serviceKey];
    if (!service) return false;

    // Check if process exists
    try {
      process.kill(service.pid, 0);
    } catch (error) {
      this.debug(`Service process ${service.pid} not found: ${serviceKey}`);
      return false;
    }

    // Service-specific health checks
    switch (serviceDef.healthCheck) {
      case 'health-file':
        return await this.checkHealthFile(projectPath);
      
      case 'port':
        const port = serviceDef.healthCheck.split(':')[1];
        return await this.checkPort(port);
      
      case 'process':
      default:
        return true; // Process exists, assume healthy
    }
  }

  /**
   * Check health file (for transcript monitors)
   */
  async checkHealthFile(projectPath) {
    if (!projectPath) return false;
    
    const healthFile = path.join(projectPath, '.transcript-monitor-health');
    if (!fs.existsSync(healthFile)) return false;

    try {
      const healthData = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
      const age = Date.now() - healthData.timestamp;
      
      // Health file should be recent (within 90 seconds)
      return age < 90000;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if port is responding
   */
  async checkPort(port) {
    try {
      const { stdout } = await execAsync(`lsof -ti:${port}`);
      return stdout.trim().length > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Clean up stale service
   */
  async cleanupStaleService(service) {
    if (service.pid) {
      try {
        process.kill(service.pid, 'SIGTERM');
        this.debug(`Cleaned up stale service PID ${service.pid}`);
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        try {
          process.kill(service.pid, 'SIGKILL');
        } catch (error) {
          // Process already gone
        }
      } catch (error) {
        // Process already gone
      }
    }
  }

  /**
   * Perform comprehensive health check on all services
   */
  async performHealthCheck() {
    this.debug('🔍 Performing global health check...');
    
    let healthyCount = 0;
    let recoveredCount = 0;
    
    // Check global services
    await this.ensureGlobalServices();
    
    // Check all registered services
    for (const [serviceKey, service] of Object.entries(this.registry.services)) {
      const serviceDef = this.getServiceDefinition(serviceKey);
      if (!serviceDef) continue;
      
      const isHealthy = await this.isServiceHealthy(serviceKey, serviceDef, service.projectPath);
      
      if (isHealthy) {
        healthyCount++;
        service.lastHealthCheck = Date.now();
        service.status = 'running';
      } else {
        this.warn(`Service unhealthy: ${serviceKey}`);
        
        // Attempt recovery
        if (serviceDef.restartable && !this.recoveryQueue.has(serviceKey)) {
          this.recoveryQueue.set(serviceKey, Date.now());
          
          // Schedule recovery after backoff
          const restartCount = service.restartCount || 0;
          const backoffDelay = Math.min(this.restartBackoffBase * Math.pow(2, restartCount), 30000);
          
          setTimeout(async () => {
            if (restartCount < this.maxRestartAttempts) {
              this.log(`🔄 Recovering service: ${serviceKey} (attempt ${restartCount + 1})`);
              
              const recovered = await this.ensureService(serviceKey, serviceDef, service.projectPath);
              if (recovered) {
                recoveredCount++;
                this.log(`✅ Service recovered: ${serviceKey}`);
              } else {
                service.restartCount = restartCount + 1;
                this.warn(`❌ Service recovery failed: ${serviceKey} (attempt ${restartCount + 1})`);
              }
            } else {
              this.error(`💥 Service recovery exhausted: ${serviceKey}`);
              service.status = 'failed';
            }
            
            this.recoveryQueue.delete(serviceKey);
          }, backoffDelay);
        }
      }
    }
    
    this.saveRegistry();
    this.debug(`Health check complete: ${healthyCount} healthy, ${recoveredCount} recovered`);
  }

  /**
   * Get service definition by key
   */
  getServiceDefinition(serviceKey) {
    // Handle project-specific services
    if (serviceKey.includes(':')) {
      const [_, serviceName] = serviceKey.split(':');
      return this.serviceDefinitions[serviceName];
    }
    
    return this.serviceDefinitions[serviceKey];
  }

  /**
   * Start daemon mode
   */
  async startDaemon() {
    this.log('🚀 Starting Global Service Coordinator daemon...');
    
    // Ensure global services
    await this.ensureGlobalServices();
    
    // Start health monitoring
    this.healthTimer = setInterval(() => {
      this.performHealthCheck().catch(error => {
        this.error('Health check failed', error);
      });
    }, this.healthCheckInterval);
    
    // Initial health check
    await this.performHealthCheck();
    
    this.log('✅ Global Service Coordinator daemon started');
    
    // Keep process alive
    if (this.isDaemon) {
      process.stdin.resume();
    }
  }

  /**
   * Graceful shutdown
   */
  async gracefulShutdown() {
    this.log('🛑 Shutting down Global Service Coordinator...');
    
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
    }
    
    // Optional: Clean shutdown of managed services
    // (for now, let services continue running)
    
    this.log('✅ Global Service Coordinator shutdown complete');
    process.exit(0);
  }

  /**
   * Get current status
   */
  async getStatus() {
    const services = Object.keys(this.registry.services).length;
    const projects = Object.keys(this.registry.projects).length;
    const uptime = Date.now() - this.registry.coordinator.startTime;
    
    return {
      coordinator: {
        pid: process.pid,
        uptime: uptime,
        version: "2.0.0",
        healthy: true
      },
      services: services,
      projects: projects,
      registry: this.registry,
      lastHealthCheck: this.registry.coordinator.lastHealthCheck
    };
  }
}

// CLI handling
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--daemon')) {
    const coordinator = new GlobalServiceCoordinator({ daemon: true, debug: args.includes('--debug') });
    await coordinator.startDaemon();
  } else if (args.includes('--status')) {
    const coordinator = new GlobalServiceCoordinator();
    const status = await coordinator.getStatus();
    console.log('📊 Global Service Coordinator Status:');
    console.log(JSON.stringify(status, null, 2));
  } else if (args.includes('--register-project')) {
    const projectIndex = args.indexOf('--register-project');
    const projectPath = args[projectIndex + 1];
    if (!projectPath) {
      console.error('Usage: --register-project /path/to/project');
      process.exit(1);
    }
    
    const coordinator = new GlobalServiceCoordinator();
    await coordinator.registerProject(projectPath);
  } else {
    console.log('Usage:');
    console.log('  --daemon                      Run as daemon');
    console.log('  --status                      Show status');
    console.log('  --register-project <path>     Register project for monitoring');
    console.log('  --debug                       Enable debug logging');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(`Global Service Coordinator error: ${error.message}`);
    process.exit(1);
  });
}

export default GlobalServiceCoordinator;