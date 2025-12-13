#!/usr/bin/env node

/**
 * Process State Manager
 *
 * Unified registry for tracking all system processes with:
 * - Atomic file operations via locking
 * - Session-aware process tracking
 * - Service type classification (global, per-project, per-session)
 * - Health monitoring and auto-cleanup
 */

import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import lockfile from 'proper-lockfile';
import { runIfMain } from '../lib/utils/esm-cli.js';

class ProcessStateManager {
  constructor(options = {}) {
    this.codingRoot = options.codingRoot || process.env.CODING_REPO || '/Users/q284340/Agentic/coding';
    this.registryPath = path.join(this.codingRoot, '.live-process-registry.json');
    this.lockOptions = {
      stale: 10000, // Consider lock stale after 10 seconds
      retries: {
        retries: 5,
        minTimeout: 100,
        maxTimeout: 1000
      }
    };
  }

  /**
   * Initialize registry file if it doesn't exist
   */
  async initialize() {
    try {
      await fs.access(this.registryPath);
    } catch {
      // File doesn't exist, create with default structure
      const defaultRegistry = {
        version: '3.0.0',
        lastChange: Date.now(),
        sessions: {},
        services: {
          global: {},
          projects: {}
        }
      };
      await fs.writeFile(this.registryPath, JSON.stringify(defaultRegistry, null, 2), 'utf8');
    }
  }

  /**
   * Execute operation with file lock
   */
  async withLock(operation) {
    await this.initialize();

    let release;
    try {
      release = await lockfile.lock(this.registryPath, this.lockOptions);
      const result = await operation();
      return result;
    } finally {
      if (release) {
        await release();
      }
    }
  }

  /**
   * Read registry data
   */
  async readRegistry() {
    const content = await fs.readFile(this.registryPath, 'utf8');
    return JSON.parse(content);
  }

  /**
   * Write registry data
   */
  async writeRegistry(data) {
    data.lastChange = Date.now();
    await fs.writeFile(this.registryPath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Register a service
   *
   * @param {Object} serviceInfo
   * @param {string} serviceInfo.name - Service identifier
   * @param {string} serviceInfo.type - 'global', 'per-project', or 'per-session'
   * @param {number} serviceInfo.pid - Process ID
   * @param {string} serviceInfo.script - Script path
   * @param {string} [serviceInfo.projectPath] - For per-project services
   * @param {string} [serviceInfo.sessionId] - For per-session services
   * @param {Object} [serviceInfo.metadata] - Additional metadata
   */
  async registerService(serviceInfo) {
    return this.withLock(async () => {
      const registry = await this.readRegistry();

      const serviceRecord = {
        pid: serviceInfo.pid,
        script: serviceInfo.script,
        type: serviceInfo.type,
        startTime: Date.now(),
        lastHealthCheck: Date.now(),
        status: 'running',
        metadata: serviceInfo.metadata || {}
      };

      if (serviceInfo.type === 'global') {
        registry.services.global[serviceInfo.name] = serviceRecord;
      } else if (serviceInfo.type === 'per-project') {
        if (!serviceInfo.projectPath) {
          throw new Error('projectPath required for per-project services');
        }
        if (!registry.services.projects[serviceInfo.projectPath]) {
          registry.services.projects[serviceInfo.projectPath] = {};
        }
        registry.services.projects[serviceInfo.projectPath][serviceInfo.name] = serviceRecord;
      } else if (serviceInfo.type === 'per-session') {
        if (!serviceInfo.sessionId) {
          throw new Error('sessionId required for per-session services');
        }
        if (!registry.sessions[serviceInfo.sessionId]) {
          registry.sessions[serviceInfo.sessionId] = {
            startTime: Date.now(),
            services: {}
          };
        }
        registry.sessions[serviceInfo.sessionId].services[serviceInfo.name] = serviceRecord;
      }

      await this.writeRegistry(registry);
      return serviceRecord;
    });
  }

  /**
   * Check if a service is currently running
   */
  async isServiceRunning(name, type, context = {}) {
    return this.withLock(async () => {
      const registry = await this.readRegistry();

      let serviceRecord;
      if (type === 'global') {
        serviceRecord = registry.services.global[name];
      } else if (type === 'per-project' && context.projectPath) {
        const projectServices = registry.services.projects[context.projectPath];
        serviceRecord = projectServices ? projectServices[name] : null;
      } else if (type === 'per-session' && context.sessionId) {
        const session = registry.sessions[context.sessionId];
        serviceRecord = session ? session.services[name] : null;
      }

      if (!serviceRecord) {
        return false;
      }

      // Validate process is actually running
      return this.isProcessAlive(serviceRecord.pid);
    });
  }

  /**
   * Check if a process ID is alive
   */
  isProcessAlive(pid) {
    try {
      // Sending signal 0 checks if process exists without killing it
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Get service information
   */
  async getService(name, type, context = {}) {
    return this.withLock(async () => {
      const registry = await this.readRegistry();

      if (type === 'global') {
        return registry.services.global[name] || null;
      } else if (type === 'per-project' && context.projectPath) {
        const projectServices = registry.services.projects[context.projectPath];
        return projectServices ? projectServices[name] || null : null;
      } else if (type === 'per-session' && context.sessionId) {
        const session = registry.sessions[context.sessionId];
        return session ? session.services[name] || null : null;
      }

      return null;
    });
  }

  /**
   * Refresh service health check timestamp
   */
  async refreshHealthCheck(name, type, context = {}) {
    return this.withLock(async () => {
      const registry = await this.readRegistry();

      let serviceRecord;
      if (type === 'global') {
        serviceRecord = registry.services.global[name];
      } else if (type === 'per-project' && context.projectPath) {
        const projectServices = registry.services.projects[context.projectPath];
        serviceRecord = projectServices ? projectServices[name] : null;
      } else if (type === 'per-session' && context.sessionId) {
        const session = registry.sessions[context.sessionId];
        serviceRecord = session ? session.services[name] : null;
      }

      if (serviceRecord) {
        serviceRecord.lastHealthCheck = Date.now();
        serviceRecord.status = 'running';
        await this.writeRegistry(registry);
        return true;
      }

      return false;
    });
  }

  /**
   * Unregister a service
   */
  async unregisterService(name, type, context = {}) {
    return this.withLock(async () => {
      const registry = await this.readRegistry();

      let removed = false;
      if (type === 'global') {
        if (registry.services.global[name]) {
          delete registry.services.global[name];
          removed = true;
        }
      } else if (type === 'per-project' && context.projectPath) {
        const projectServices = registry.services.projects[context.projectPath];
        if (projectServices && projectServices[name]) {
          delete projectServices[name];
          removed = true;
          // Clean up empty project entries
          if (Object.keys(projectServices).length === 0) {
            delete registry.services.projects[context.projectPath];
          }
        }
      } else if (type === 'per-session' && context.sessionId) {
        const session = registry.sessions[context.sessionId];
        if (session && session.services[name]) {
          delete session.services[name];
          removed = true;
        }
      }

      if (removed) {
        await this.writeRegistry(registry);
      }

      return removed;
    });
  }

  /**
   * Clean up dead PIDs from the registry
   * This prevents stale entries from blocking new service registrations
   *
   * @returns {Promise<Object>} Statistics about cleanup: { globalCleaned, projectsCleaned, sessionsCleaned, total }
   */
  async cleanupDeadProcesses() {
    return this.withLock(async () => {
      const registry = await this.readRegistry();
      let globalCleaned = 0;
      let projectsCleaned = 0;
      let sessionsCleaned = 0;

      // Clean up global services with dead PIDs
      for (const [serviceName, serviceRecord] of Object.entries(registry.services.global)) {
        if (!this.isProcessAlive(serviceRecord.pid)) {
          delete registry.services.global[serviceName];
          globalCleaned++;
        }
      }

      // Clean up per-project services with dead PIDs
      for (const [projectPath, projectServices] of Object.entries(registry.services.projects)) {
        for (const [serviceName, serviceRecord] of Object.entries(projectServices)) {
          if (!this.isProcessAlive(serviceRecord.pid)) {
            delete projectServices[serviceName];
            projectsCleaned++;
          }
        }
        // Remove empty project entries
        if (Object.keys(projectServices).length === 0) {
          delete registry.services.projects[projectPath];
        }
      }

      // Clean up per-session services with dead PIDs
      for (const [sessionId, session] of Object.entries(registry.sessions)) {
        for (const [serviceName, serviceRecord] of Object.entries(session.services || {})) {
          if (!this.isProcessAlive(serviceRecord.pid)) {
            delete session.services[serviceName];
            sessionsCleaned++;
          }
        }
        // Remove empty sessions
        if (Object.keys(session.services || {}).length === 0) {
          delete registry.sessions[sessionId];
        }
      }

      const total = globalCleaned + projectsCleaned + sessionsCleaned;
      if (total > 0) {
        await this.writeRegistry(registry);
      }

      return {
        globalCleaned,
        projectsCleaned,
        sessionsCleaned,
        total
      };
    });
  }

  /**
   * Register a session
   */
  async registerSession(sessionId, metadata = {}) {
    return this.withLock(async () => {
      const registry = await this.readRegistry();

      if (!registry.sessions[sessionId]) {
        registry.sessions[sessionId] = {
          startTime: Date.now(),
          services: {},
          metadata
        };
        await this.writeRegistry(registry);
      }

      return registry.sessions[sessionId];
    });
  }

  /**
   * Cleanup a session and terminate all its services
   */
  async cleanupSession(sessionId) {
    return this.withLock(async () => {
      const registry = await this.readRegistry();

      const session = registry.sessions[sessionId];
      if (!session) {
        return { cleaned: 0, terminated: [] };
      }

      const terminated = [];
      let cleaned = 0;

      // Terminate all session services
      for (const [serviceName, serviceRecord] of Object.entries(session.services)) {
        try {
          if (this.isProcessAlive(serviceRecord.pid)) {
            process.kill(serviceRecord.pid, 'SIGTERM');
            terminated.push({ name: serviceName, pid: serviceRecord.pid });
          }
          cleaned++;
        } catch (error) {
          // Process might already be dead
          cleaned++;
        }
      }

      // Remove session from registry
      delete registry.sessions[sessionId];
      await this.writeRegistry(registry);

      return { cleaned, terminated };
    });
  }

  /**
   * Alias for cleanupDeadProcesses - removes stale service entries
   */
  async cleanupStaleServices() {
    return this.cleanupDeadProcesses();
  }

  /**
   * Get all services across all types
   */
  async getAllServices() {
    return this.withLock(async () => {
      return this.readRegistry();
    });
  }

  /**
   * Check database health and lock status
   */
  async checkDatabaseHealth() {
    const health = {
      levelDB: { available: true, locked: false, lockedBy: null },
      qdrant: { available: false }
    };

    // Check Level DB lock
    const levelDBLockPath = path.join(this.codingRoot, '.data/knowledge-graph/LOCK');
    try {
      await fs.access(levelDBLockPath);
      // Lock file exists - check who owns it
      const { spawn } = await import('child_process');
      const lsof = spawn('lsof', [levelDBLockPath]);

      let output = '';
      lsof.stdout.on('data', (data) => {
        output += data.toString();
      });

      await new Promise((resolve) => {
        lsof.on('close', () => resolve());
      });

      if (output.trim()) {
        const lines = output.split('\n').filter(line => line.trim());
        if (lines.length > 1) {
          // Parse lsof output: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
          const match = lines[1].match(/\s+(\d+)\s+/);
          if (match) {
            health.levelDB.locked = true;
            health.levelDB.lockedBy = parseInt(match[1]);
          }
        }
      }
    } catch {
      // Lock file doesn't exist - database is available
      health.levelDB.locked = false;
    }

    // Check Qdrant availability
    try {
      const response = await fetch('http://localhost:6333/readyz', {
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      });
      health.qdrant.available = response.ok;
    } catch {
      health.qdrant.available = false;
    }

    return health;
  }

  /**
   * Get health status report
   */
  async getHealthStatus() {
    return this.withLock(async () => {
      const registry = await this.readRegistry();
      const status = {
        healthy: 0,
        unhealthy: 0,
        total: 0,
        databases: null,
        details: {
          global: [],
          projects: {},
          sessions: {}
        }
      };

      // Check database health
      status.databases = await this.checkDatabaseHealth();

      // Check global services
      for (const [name, service] of Object.entries(registry.services.global)) {
        status.total++;
        const alive = this.isProcessAlive(service.pid);
        if (alive) {
          status.healthy++;
        } else {
          status.unhealthy++;
        }
        status.details.global.push({
          name,
          pid: service.pid,
          alive,
          uptime: Date.now() - service.startTime
        });
      }

      // Check per-project services
      for (const [projectPath, services] of Object.entries(registry.services.projects)) {
        status.details.projects[projectPath] = [];
        for (const [name, service] of Object.entries(services)) {
          status.total++;
          const alive = this.isProcessAlive(service.pid);
          if (alive) {
            status.healthy++;
          } else {
            status.unhealthy++;
          }
          status.details.projects[projectPath].push({
            name,
            pid: service.pid,
            alive,
            uptime: Date.now() - service.startTime
          });
        }
      }

      // Check session services
      for (const [sessionId, session] of Object.entries(registry.sessions)) {
        status.details.sessions[sessionId] = [];
        for (const [name, service] of Object.entries(session.services)) {
          status.total++;
          const alive = this.isProcessAlive(service.pid);
          if (alive) {
            status.healthy++;
          } else {
            status.unhealthy++;
          }
          status.details.sessions[sessionId].push({
            name,
            pid: service.pid,
            alive,
            uptime: Date.now() - service.startTime
          });
        }
      }

      // Validate database availability
      status.databaseIssues = [];

      // Check if Level DB lock is held by unregistered process
      if (status.databases.levelDB.locked && status.databases.levelDB.lockedBy) {
        const lockHolderPid = status.databases.levelDB.lockedBy;
        let isRegistered = false;

        // Check if lock holder is a registered service
        for (const service of Object.values(registry.services.global)) {
          if (service.pid === lockHolderPid) {
            isRegistered = true;
            break;
          }
        }

        if (!isRegistered) {
          for (const services of Object.values(registry.services.projects)) {
            for (const service of Object.values(services)) {
              if (service.pid === lockHolderPid) {
                isRegistered = true;
                break;
              }
            }
            if (isRegistered) break;
          }
        }

        if (!isRegistered) {
          for (const session of Object.values(registry.sessions)) {
            for (const service of Object.values(session.services)) {
              if (service.pid === lockHolderPid) {
                isRegistered = true;
                break;
              }
            }
            if (isRegistered) break;
          }
        }

        if (!isRegistered) {
          status.databaseIssues.push({
            type: 'leveldb_lock',
            severity: 'critical',
            message: `Level DB locked by unregistered process (PID: ${lockHolderPid})`,
            pid: lockHolderPid
          });
        }
      }

      // Check Qdrant availability
      if (!status.databases.qdrant.available) {
        status.databaseIssues.push({
          type: 'qdrant_unavailable',
          severity: 'warning',
          message: 'Qdrant vector database is not available (http://localhost:6333/readyz failed)'
        });
      }

      return status;
    });
  }
}

// CLI support
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const manager = new ProcessStateManager();

  const command = process.argv[2];

  (async () => {
    try {
      switch (command) {
        case 'init':
          await manager.initialize();
          console.log('✅ Process registry initialized');
          break;

        case 'status':
          const status = await manager.getHealthStatus();
          console.log('\n📊 Process Health Status:');
          console.log(`   Total: ${status.total} | Healthy: ${status.healthy} | Unhealthy: ${status.unhealthy}\n`);

          console.log('Global Services:');
          status.details.global.forEach(s => {
            const icon = s.alive ? '✅' : '❌';
            const uptime = Math.floor(s.uptime / 1000 / 60);
            console.log(`   ${icon} ${s.name} (PID: ${s.pid}, uptime: ${uptime}m)`);
          });

          console.log('\nProject Services:');
          for (const [project, services] of Object.entries(status.details.projects)) {
            console.log(`   ${project}:`);
            services.forEach(s => {
              const icon = s.alive ? '✅' : '❌';
              const uptime = Math.floor(s.uptime / 1000 / 60);
              console.log(`     ${icon} ${s.name} (PID: ${s.pid}, uptime: ${uptime}m)`);
            });
          }

          console.log('\nSession Services:');
          for (const [sessionId, services] of Object.entries(status.details.sessions)) {
            console.log(`   Session ${sessionId}:`);
            services.forEach(s => {
              const icon = s.alive ? '✅' : '❌';
              const uptime = Math.floor(s.uptime / 1000 / 60);
              console.log(`     ${icon} ${s.name} (PID: ${s.pid}, uptime: ${uptime}m)`);
            });
          }
          break;

        case 'cleanup':
          const cleaned = await manager.cleanupDeadProcesses();
          console.log(`✅ Cleaned up ${cleaned} dead process(es)`);
          break;

        case 'dump':
          const registry = await manager.getAllServices();
          console.log(JSON.stringify(registry, null, 2));
          break;

        default:
          console.log('Process State Manager CLI\n');
          console.log('Usage: node process-state-manager.js <command>\n');
          console.log('Commands:');
          console.log('  init     - Initialize registry file');
          console.log('  status   - Show health status of all services');
          console.log('  cleanup  - Remove dead processes from registry');
          console.log('  dump     - Dump entire registry as JSON');
      }
    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }
  })();
}

export default ProcessStateManager;
