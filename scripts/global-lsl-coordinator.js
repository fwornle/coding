#!/usr/bin/env node

/**
 * Global LSL Coordinator - Multi-Project Transcript Monitoring Manager
 * 
 * Ensures robust Live Session Logging across all projects started via coding/bin/coding.
 * Manages Enhanced Transcript Monitor processes for multiple concurrent projects.
 * 
 * Architecture:
 * - Project Registry: Tracks all active projects and their monitoring status
 * - Health Monitoring: Detects and recovers from failed or stale monitors  
 * - Process Management: Starts/stops/restarts monitors as needed
 * - Global Status: Provides system-wide health visibility
 */

import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { runIfMain } from '../lib/utils/esm-cli.js';

// Import ProcessStateManager for robust duplicate prevention
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { default: ProcessStateManager } = await import(path.join(__dirname, 'process-state-manager.js'));

const execAsync = promisify(exec);

class GlobalLSLCoordinator {
  constructor(options = {}) {
    this.debug = options.debug || false;
    this.codingRepoPath = options.codingRepoPath || process.env.CODING_REPO || path.resolve(__dirname, '..');
    this.registryPath = path.join(this.codingRepoPath, '.global-lsl-registry.json');
    this.healthCheckInterval = options.healthCheckInterval || 30000; // 30 seconds
    this.maxMonitorAge = options.maxMonitorAge || 3600000; // 1 hour max stale

    this.registry = this.loadRegistry();
    this.healthTimer = null;

    // Initialize process state manager for duplicate prevention
    this.processStateManager = new ProcessStateManager({ codingRoot: this.codingRepoPath });
  }

  /**
   * Load or create project registry
   */
  loadRegistry() {
    try {
      if (fs.existsSync(this.registryPath)) {
        const data = fs.readFileSync(this.registryPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      this.log(`Warning: Could not load registry: ${error.message}`);
    }
    
    // Create default registry
    return {
      version: "1.0.0",
      lastUpdated: Date.now(),
      projects: {},
      coordinator: {
        pid: process.pid,
        startTime: Date.now(),
        healthCheckInterval: this.healthCheckInterval
      }
    };
  }

  /**
   * Save registry to disk
   */
  saveRegistry() {
    try {
      this.registry.lastUpdated = Date.now();
      fs.writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2));
      this.log(`Registry saved: ${Object.keys(this.registry.projects).length} projects`);
    } catch (error) {
      console.error(`Error saving registry: ${error.message}`);
    }
  }

  /**
   * Ensure LSL monitoring for a project
   */
  async ensure(projectPath, parentPid = null) {
    const projectName = path.basename(projectPath);
    const absoluteProjectPath = path.resolve(projectPath);
    
    this.log(`Ensuring LSL for project: ${projectName} (${absoluteProjectPath})`);
    
    // Create .specstory directory if needed
    const specstoryPath = path.join(absoluteProjectPath, '.specstory', 'history');
    if (!fs.existsSync(specstoryPath)) {
      fs.mkdirSync(specstoryPath, { recursive: true });
      this.log(`Created .specstory/history for ${projectName}`);
    }
    
    // Check if monitor already exists and is healthy
    const existingProject = this.registry.projects[projectName];
    if (existingProject && await this.isMonitorHealthy(existingProject)) {
      this.log(`Monitor already healthy for ${projectName} (PID: ${existingProject.monitorPid})`);
      return true;
    }
    
    // Clean up any stale monitor
    if (existingProject && existingProject.monitorPid) {
      await this.cleanupStaleMonitor(existingProject);
    }
    
    // Start new monitor
    const monitorPid = await this.startMonitor(absoluteProjectPath);
    if (!monitorPid) {
      this.log(`Failed to start monitor for ${projectName}`);
      return false;
    }
    
    // Register project
    this.registry.projects[projectName] = {
      projectPath: absoluteProjectPath,
      monitorPid: monitorPid,
      startTime: Date.now(),
      parentPid: parentPid,
      lastHealthCheck: Date.now(),
      status: 'active',
      exchanges: 0
    };
    
    this.saveRegistry();
    this.log(`LSL monitoring ensured for ${projectName} (PID: ${monitorPid})`);
    return true;
  }

  /**
   * Start Enhanced Transcript Monitor for a project
   */
  async startMonitor(projectPath) {
    return new Promise(async (resolve) => {
      const monitorScript = path.join(this.codingRepoPath, 'scripts', 'enhanced-transcript-monitor.js');
      const logFile = path.join(projectPath, 'transcript-monitor.log');
      const projectName = path.basename(projectPath);

      // CRITICAL: Check PSM for existing healthy monitor before spawning
      try {
        const ProcessStateManager = (await import('./process-state-manager.js')).default;
        const psm = new ProcessStateManager();
        await psm.initialize();

        // PSM getService expects context object with projectPath property for per-project services
        const existingService = await psm.getService('enhanced-transcript-monitor', 'per-project', { projectPath });
        if (existingService && existingService.pid) {
          // Check if the existing monitor is actually alive
          try {
            process.kill(existingService.pid, 0);
            this.log(`Found existing healthy monitor via PSM (PID: ${existingService.pid}) - reusing`);
            resolve(existingService.pid);
            return;
          } catch (error) {
            // PSM entry is stale, will clean up and start new
            this.log(`PSM has stale monitor entry (PID: ${existingService.pid}) - will start fresh`);
            await psm.unregisterService('enhanced-transcript-monitor', 'per-project', { projectPath });
          }
        }
      } catch (psmError) {
        this.log(`PSM check failed: ${psmError.message} - continuing with startup`);
      }

      // Kill any existing monitors for this project first
      // CRITICAL FIX: Pass project path as argument so pkill can find it
      exec(`pkill -f "enhanced-transcript-monitor.js ${projectPath}"`, () => {
        // RACE CONDITION FIX: Wait for old process to fully terminate before spawning new one
        setTimeout(() => {
          // CRITICAL FIX: Add project path as argument so pkill pattern can match
          const child = spawn('node', [monitorScript, projectPath], {
          cwd: projectPath,
          detached: true,
          stdio: ['ignore', 'ignore', 'ignore'],
          env: {
            ...process.env,
            TRANSCRIPT_DEBUG: this.debug ? 'true' : 'false',
            PROJECT_PATH: projectPath,
            TRANSCRIPT_SOURCE_PROJECT: projectPath,  // Critical: Tell monitor which project to monitor
            CODING_TOOLS_PATH: this.codingRepoPath
          }
        });

        child.unref(); // Allow parent to exit

        // Verify monitor started successfully and register with PSM
        setTimeout(async () => {
          try {
            process.kill(child.pid, 0); // Test if process exists
            this.log(`Monitor started for ${path.basename(projectPath)} (PID: ${child.pid})`);

            // CRITICAL: Register spawned monitor with PSM
            try {
              const ProcessStateManager = (await import('./process-state-manager.js')).default;
              const psm = new ProcessStateManager();
              await psm.initialize();

              await psm.registerService({
                name: 'enhanced-transcript-monitor',
                pid: child.pid,
                type: 'per-project',
                script: 'enhanced-transcript-monitor.js',
                projectPath: projectPath,
                metadata: {
                  spawnedBy: 'global-lsl-coordinator',
                  monitorScript: monitorScript
                }
              });

              this.log(`Monitor registered with PSM (PID: ${child.pid})`);
            } catch (psmError) {
              this.log(`Failed to register monitor with PSM: ${psmError.message}`);
              // Continue anyway - monitor is running
            }

            resolve(child.pid);
          } catch (error) {
            this.log(`Monitor failed to start for ${path.basename(projectPath)}: ${error.message}`);
            resolve(null);
          }
        }, 1000);
        }, 500);  // End of race condition fix setTimeout
      });
    });
  }

  /**
   * Check if a monitor process is healthy
   */
  async isMonitorHealthy(projectInfo) {
    const { monitorPid, projectPath, startTime } = projectInfo;
    
    if (!monitorPid) return false;
    
    // Check if process exists
    try {
      process.kill(monitorPid, 0);
    } catch (error) {
      this.log(`Monitor PID ${monitorPid} not found`);
      return false;
    }
    
    // Check health file (stored in coding project's .health directory)
    const projectName = path.basename(projectPath);
    const healthFile = path.join(this.codingRepoPath, '.health', `${projectName}-transcript-monitor-health.json`);
    if (!fs.existsSync(healthFile)) {
      this.log(`Health file missing for ${projectName}`);
      return false;
    }
    
    try {
      const healthData = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
      const age = Date.now() - healthData.timestamp;
      
      // Health file should be updated recently (within 60 seconds)
      if (age > 60000) {
        this.log(`Stale health file for ${projectName} (${age}ms old)`);
        return false;
      }

      // Check for suspicious activity (no exchanges processed for long time)
      if (healthData.activity && healthData.activity.isSuspicious) {
        this.log(`Suspicious activity detected for ${projectName}: ${healthData.activity.suspicionReason}`);
        return false;
      }
      
      return true;
    } catch (error) {
      this.log(`Error reading health file for ${projectName}: ${error.message}`);
      return false;
    }
  }

  /**
   * Clean up stale monitor process
   */
  async cleanupStaleMonitor(projectInfo) {
    const { monitorPid, projectPath } = projectInfo;

    if (monitorPid) {
      // First check if process actually exists
      let processExists = false;
      try {
        process.kill(monitorPid, 0); // Signal 0 = check existence only
        processExists = true;
      } catch (error) {
        // ESRCH = No such process - this is expected for stale entries
        processExists = false;
        this.log(`Monitor PID ${monitorPid} already gone`);
      }

      if (processExists) {
        try {
          process.kill(monitorPid, 'SIGTERM');
          this.log(`Sent SIGTERM to stale monitor PID ${monitorPid}`);

          // Wait for graceful shutdown
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Force kill if still running
          try {
            process.kill(monitorPid, 0); // Check if still exists
            process.kill(monitorPid, 'SIGKILL');
            this.log(`Force killed monitor PID ${monitorPid}`);
          } catch (error) {
            // Process already gone after SIGTERM, that's fine
          }
        } catch (error) {
          // Process may have died between check and kill, that's fine
          this.log(`Monitor PID ${monitorPid} died during cleanup`);
        }
      }

      // CRITICAL: Always unregister from PSM (even if process was already dead)
      try {
        const ProcessStateManager = (await import('./process-state-manager.js')).default;
        const psm = new ProcessStateManager();
        await psm.initialize();
        await psm.unregisterService('enhanced-transcript-monitor', 'per-project', { projectPath });
        this.log(`Monitor unregistered from PSM (PID: ${monitorPid})`);
      } catch (psmError) {
        this.log(`Failed to unregister monitor from PSM: ${psmError.message}`);
      }
    }
  }

  /**
   * Perform health check on all registered projects
   */
  async performHealthCheck() {
    // CRITICAL: Reload registry from disk before each health check
    // This ensures we pick up projects registered by temporary `ensure` calls
    // from other processes (e.g., coding/bin/coding startup scripts)
    this.registry = this.loadRegistry();

    this.log(`Performing global health check...`);

    const projects = Object.keys(this.registry.projects);
    let healthyCount = 0;
    let recoveredCount = 0;
    
    for (const projectName of projects) {
      const projectInfo = this.registry.projects[projectName];
      
      if (await this.isMonitorHealthy(projectInfo)) {
        healthyCount++;
        projectInfo.lastHealthCheck = Date.now();
      } else {
        this.log(`Recovering unhealthy monitor for ${projectName}`);
        
        // Attempt recovery
        if (await this.ensure(projectInfo.projectPath)) {
          recoveredCount++;
          this.log(`Successfully recovered monitor for ${projectName}`);
        } else {
          this.log(`Failed to recover monitor for ${projectName}`);
          projectInfo.status = 'failed';
        }
      }
    }
    
    this.log(`Health check complete: ${healthyCount} healthy, ${recoveredCount} recovered`);
    this.saveRegistry();
  }

  /**
   * Start continuous health monitoring with duplicate prevention
   */
  async startHealthMonitoring() {
    // Initialize process state manager
    await this.processStateManager.initialize();

    // Robust singleton check - OS-level + PSM combined
    const serviceName = 'global-lsl-coordinator';
    const scriptPattern = 'global-lsl-coordinator.js';

    const singletonCheck = await this.processStateManager.robustSingletonCheck(
      serviceName,
      scriptPattern,
      'global'
    );

    if (!singletonCheck.canStart) {
      console.error(`❌ Cannot start ${serviceName}: ${singletonCheck.reason}`);
      if (singletonCheck.existingPids.length > 0) {
        console.error(`   Existing PIDs: ${singletonCheck.existingPids.join(', ')}`);
        console.error(`   To fix: kill ${singletonCheck.existingPids.join(' ')}`);
      }
      process.exit(1);
    }

    // Register this coordinator instance
    try {
      await this.processStateManager.registerService({
        name: serviceName,
        type: 'global',
        pid: process.pid,
        script: 'global-lsl-coordinator.js',
        metadata: {
          mode: 'monitor',
          healthCheckInterval: this.healthCheckInterval
        }
      });
      this.log(`✅ Coordinator registered (PID: ${process.pid})`);
    } catch (error) {
      console.error(`❌ Failed to register coordinator: ${error.message}`);
      process.exit(1);
    }

    if (this.healthTimer) {
      clearInterval(this.healthTimer);
    }

    // Update coordinator PID in registry to reflect current process
    this.registry.coordinator.pid = process.pid;
    this.registry.coordinator.startTime = Date.now();
    this.saveRegistry();

    this.healthTimer = setInterval(() => {
      this.performHealthCheck().catch(error => {
        console.error(`Health check failed: ${error.message}`);
      });
    }, this.healthCheckInterval);

    this.log(`Started global health monitoring (interval: ${this.healthCheckInterval}ms)`);
  }

  /**
   * Stop health monitoring and unregister service
   */
  async stopHealthMonitoring() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
      this.log('Stopped global health monitoring');
    }

    // Unregister coordinator service
    try {
      await this.processStateManager.unregisterService('global-lsl-coordinator', 'global');
      this.log('✅ Coordinator unregistered');
    } catch (error) {
      this.log(`⚠️ Failed to unregister coordinator: ${error.message}`);
    }
  }

  /**
   * Get global status of all monitored projects
   */
  getGlobalStatus() {
    const projects = Object.keys(this.registry.projects);
    const status = {
      coordinator: {
        pid: process.pid,
        uptime: Date.now() - this.registry.coordinator.startTime,
        healthCheckInterval: this.healthCheckInterval
      },
      projects: {
        total: projects.length,
        active: 0,
        healthy: 0,
        failed: 0,
        details: {}
      },
      timestamp: Date.now()
    };
    
    projects.forEach(projectName => {
      const project = this.registry.projects[projectName];
      status.projects.details[projectName] = {
        path: project.projectPath,
        monitorPid: project.monitorPid,
        status: project.status,
        uptime: Date.now() - project.startTime,
        lastHealthCheck: project.lastHealthCheck
      };
      
      if (project.status === 'active') status.projects.active++;
      if (project.status === 'failed') status.projects.failed++;
    });
    
    return status;
  }

  /**
   * Debug logging
   */
  log(message) {
    const timestamp = new Date().toISOString().substr(11, 12);
    console.log(`[${timestamp}] [GlobalLSL] ${message}`);
  }

  /**
   * Cleanup on exit
   */
  cleanup() {
    this.stopHealthMonitoring();
    this.saveRegistry();
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  const coordinator = new GlobalLSLCoordinator({ debug: true });
  
  // Handle cleanup on exit
  process.on('SIGINT', () => coordinator.cleanup());
  process.on('SIGTERM', () => coordinator.cleanup());
  
  switch (command) {
    case 'ensure':
      const projectPath = args[1];
      const parentPid = args[2] ? parseInt(args[2]) : null;
      
      if (!projectPath) {
        console.error('Usage: global-lsl-coordinator.js ensure <project_path> [parent_pid]');
        process.exit(1);
      }
      
      const success = await coordinator.ensure(projectPath, parentPid);
      process.exit(success ? 0 : 1);
      
    case 'status':
      const status = coordinator.getGlobalStatus();
      console.log(JSON.stringify(status, null, 2));
      break;
      
    case 'health-check':
      await coordinator.performHealthCheck();
      break;
      
    case 'monitor':
      await coordinator.startHealthMonitoring();
      console.log('Global LSL Coordinator monitoring started. Press Ctrl+C to stop.');

      // Handle shutdown gracefully
      process.on('SIGINT', async () => {
        console.log('\nShutting down coordinator...');
        await coordinator.stopHealthMonitoring();
        process.exit(0);
      });

      // Keep alive
      setInterval(() => {}, 1000);
      break;
      
    default:
      console.log(`Global LSL Coordinator - Multi-Project Transcript Monitoring

Usage:
  global-lsl-coordinator.js ensure <project_path> [parent_pid]    Ensure LSL for a project
  global-lsl-coordinator.js status                               Show global status
  global-lsl-coordinator.js health-check                         Run one-time health check
  global-lsl-coordinator.js monitor                              Start continuous monitoring

Examples:
  global-lsl-coordinator.js ensure /path/to/curriculum-alignment
  global-lsl-coordinator.js status | jq .
  global-lsl-coordinator.js monitor
`);
      break;
  }
}

// Run CLI if called directly
runIfMain(import.meta.url, () => {
  main().catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
  });
});

export default GlobalLSLCoordinator;