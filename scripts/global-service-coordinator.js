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
import ProcessStateManager from './process-state-manager.js';
import { runIfMain } from '../lib/utils/esm-cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

class GlobalServiceCoordinator extends EventEmitter {
  constructor(options = {}) {
    super();

    this.codingRepoPath = options.codingRepoPath || path.resolve(__dirname, '..');
    this.logPath = path.join(this.codingRepoPath, '.logs', 'global-coordinator.log');
    this.isDaemon = options.daemon || false;
    this.isDebugMode = options.debug || false;

    // Initialize Process State Manager for unified tracking
    this.psm = new ProcessStateManager(this.codingRepoPath);

    // Health check intervals
    this.healthCheckInterval = 15000; // 15 seconds
    this.serviceStartTimeout = 30000; // 30 seconds
    this.maxRestartAttempts = 5;
    this.restartBackoffBase = 1000; // 1 second

    // Service definitions - only services not managed elsewhere
    // NOTE: enhanced-transcript-monitor is started by bin/coding, not by this coordinator
    // NOTE: MCP services are started by claude-mcp via bin/coding, not by this coordinator
    this.serviceDefinitions = {
      'constraint-api': {
        type: 'global',
        script: 'scripts/api-service.js',
        healthCheck: 'port:3031',
        priority: 1,
        restartable: true
      },
      'constraint-dashboard': {
        type: 'global',
        script: 'scripts/dashboard-service.js',
        healthCheck: 'port:3030',
        priority: 2,
        restartable: true
      }
    };

    // In-memory registry for coordinator state (all persistence via PSM)
    this.registry = {
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
    
    if (this.isDebugMode || level === 'ERROR' || level === 'WARN') {
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
    if (this.isDebugMode) {
      this.log(message, 'DEBUG');
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
    // MCP services are started by claude-mcp via coding/bin/coding
    // But we also manage other global services like the constraint dashboard
    const globalServices = Object.entries(this.serviceDefinitions)
      .filter(([_, def]) => def.type === 'global')
      .sort((a, b) => a[1].priority - b[1].priority);

    for (const [serviceName, serviceDef] of globalServices) {
      await this.ensureService(serviceName, serviceDef, null);
    }

    return true;
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
      await this.cleanupStaleService(existingService, serviceKey);
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
        // Register service with Process State Manager
        const serviceInfo = {
          name: serviceKey,
          pid: child.pid,
          type: serviceDef.type,
          script: serviceDef.script,
          projectPath: projectPath,
          metadata: {
            managedBy: 'coordinator',
            restartCount: 0
          }
        };

        await this.psm.registerService(serviceInfo);

        // Also keep in local registry for backward compatibility (temporary)
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
    // Check PSM first for unified health status
    const context = {};
    if (projectPath) {
      context.projectPath = projectPath;
    }

    const isPsmHealthy = await this.psm.isServiceRunning(serviceKey, serviceDef.type, context);

    // If PSM says it's not running, it's not healthy
    if (!isPsmHealthy) {
      return false;
    }

    // For port-based health checks, verify the port is actually responding
    if (serviceDef.healthCheck && serviceDef.healthCheck.startsWith('port:')) {
      const port = serviceDef.healthCheck.split(':')[1];
      return await this.checkPort(port);
    }

    // For health-file checks, verify the health file
    if (serviceDef.healthCheck === 'health-file') {
      return await this.checkHealthFile(projectPath);
    }

    // Default: PSM says it's running, assume healthy
    return true;
  }

  /**
   * Check health file (for transcript monitors)
   */
  async checkHealthFile(projectPath) {
    if (!projectPath) return false;

    // Health files are now centralized in coding/.health/ directory
    const projectName = path.basename(projectPath);
    const healthFile = path.join(this.codingRepoPath, '.health', `${projectName}-transcript-monitor-health.json`);
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
  async cleanupStaleService(service, serviceKey) {
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

        // Unregister from PSM
        if (serviceKey) {
          const context = service.projectPath ? { projectPath: service.projectPath } : {};
          await this.psm.unregisterService(serviceKey, service.serviceType || 'global', context);
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

        // Refresh PSM health check timestamp
        const context = service.projectPath ? { projectPath: service.projectPath } : {};
        await this.psm.refreshHealthCheck(serviceKey, service.serviceType || serviceDef.type, context);
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
    
    // Refresh coordinator's own health check in PSM
    try {
      await this.psm.refreshHealthCheck('global-service-coordinator', 'global');
    } catch (error) {
      this.warn('Failed to refresh coordinator health in PSM', error);
    }

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
    // Robust singleton check - OS-level + PSM combined
    const serviceName = 'global-service-coordinator';
    const scriptPattern = 'global-service-coordinator.js';

    const singletonCheck = await this.psm.robustSingletonCheck(serviceName, scriptPattern, 'global');

    if (!singletonCheck.canStart) {
      console.error(`❌ Cannot start ${serviceName}: ${singletonCheck.reason}`);
      if (singletonCheck.existingPids.length > 0) {
        console.error(`   Existing PIDs: ${singletonCheck.existingPids.join(', ')}`);
        console.error(`   To fix: kill ${singletonCheck.existingPids.join(' ')}`);
      }
      process.exit(1);
    }

    this.log('🚀 Starting Global Service Coordinator daemon...');

    // Register coordinator with PSM
    await this.registerSelfWithPSM();

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
   * Register coordinator itself with PSM
   */
  async registerSelfWithPSM() {
    try {
      await this.psm.registerService({
        name: 'global-service-coordinator',
        pid: process.pid,
        type: 'global',
        script: 'scripts/global-service-coordinator.js',
        metadata: {
          version: '2.0.0',
          startTime: Date.now(),
          managedBy: 'self'
        }
      });
      this.log('✅ Coordinator registered with PSM');
    } catch (error) {
      this.error('Failed to register coordinator with PSM', error);
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

    // Unregister from PSM
    try {
      await this.psm.unregisterService('global-service-coordinator', 'global');
      this.log('✅ Coordinator unregistered from PSM');
    } catch (error) {
      this.warn('Failed to unregister coordinator from PSM', error);
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

runIfMain(import.meta.url, () => {
  main().catch(error => {
    console.error(`Global Service Coordinator error: ${error.message}`);
    process.exit(1);
  });
});

export default GlobalServiceCoordinator;