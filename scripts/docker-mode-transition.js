#!/usr/bin/env node

/**
 * Docker Mode Transition Orchestrator
 *
 * Enables safe, transparent transitions between native and Docker modes with:
 * - Lock file mechanism to prevent health monitor interference
 * - Multi-session support (coding, nano-degree, ui-template running simultaneously)
 * - Graceful shutdown with data flush
 * - Rollback mechanism on failure
 * - SIGUSR2 broadcast to pause health monitoring
 */

import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import ProcessStateManager from './process-state-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptRoot = path.resolve(__dirname, '..');

// Lock file location
const TRANSITION_LOCK_FILE = path.join(scriptRoot, '.transition-in-progress');

// Transition timeout (5 minutes)
const TRANSITION_TIMEOUT_MS = 5 * 60 * 1000;

// Health check timeout (must exceed Docker's start_period of 120s for coding-services)
const HEALTH_CHECK_TIMEOUT_MS = 150 * 1000;

// Docker startup timeout (wait for Docker Desktop to start - cold starts can take 60-90s)
const DOCKER_STARTUP_TIMEOUT_MS = 90 * 1000;

class DockerModeTransition {
  constructor(options = {}) {
    this.codingRoot = options.codingRoot || process.env.CODING_REPO || scriptRoot;
    this.psm = new ProcessStateManager({ codingRoot: this.codingRoot });
    this.verbose = options.verbose || false;
  }

  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : '🔄';
    console.log(`[${timestamp}] ${prefix} ${message}`);
  }

  /**
   * Check if a transition is currently in progress
   */
  async isTransitionInProgress() {
    try {
      await fs.access(TRANSITION_LOCK_FILE);
      const content = await fs.readFile(TRANSITION_LOCK_FILE, 'utf8');
      const lockData = JSON.parse(content);

      // Check if lock is stale (older than timeout)
      const lockAge = Date.now() - new Date(lockData.startTime).getTime();
      if (lockAge > TRANSITION_TIMEOUT_MS) {
        this.log('Stale transition lock detected, cleaning up...', 'warn');
        await this.removeLockFile();
        return { inProgress: false, stale: true };
      }

      return { inProgress: true, lockData };
    } catch (error) {
      return { inProgress: false };
    }
  }

  /**
   * Get current mode (native or docker)
   */
  async getCurrentMode() {
    const dockerMarkerPath = path.join(this.codingRoot, '.docker-mode');

    try {
      await fs.access(dockerMarkerPath);
      return 'docker';
    } catch {
      return 'native';
    }
  }

  /**
   * Create transition lock file with metadata
   */
  async createLockFile(fromMode, toMode, sessions) {
    const lockData = {
      startTime: new Date().toISOString(),
      fromMode,
      toMode,
      pid: process.pid,
      sessions,
      status: 'in_progress'
    };

    await fs.writeFile(TRANSITION_LOCK_FILE, JSON.stringify(lockData, null, 2), 'utf8');
    this.log(`Created transition lock: ${fromMode} → ${toMode}`);
    return lockData;
  }

  /**
   * Update lock file status
   */
  async updateLockStatus(status, error = null) {
    try {
      const content = await fs.readFile(TRANSITION_LOCK_FILE, 'utf8');
      const lockData = JSON.parse(content);
      lockData.status = status;
      lockData.lastUpdate = new Date().toISOString();
      if (error) {
        lockData.error = error;
      }
      await fs.writeFile(TRANSITION_LOCK_FILE, JSON.stringify(lockData, null, 2), 'utf8');
    } catch {
      // Lock file may have been removed
    }
  }

  /**
   * Remove transition lock file
   */
  async removeLockFile() {
    try {
      await fs.unlink(TRANSITION_LOCK_FILE);
      this.log('Removed transition lock file');
    } catch {
      // File may not exist
    }
  }

  /**
   * Get all active sessions from PSM
   */
  async getActiveSessions() {
    const registry = await this.psm.getAllServices();
    const sessions = [];

    // Get sessions from registry
    for (const [sessionId, session] of Object.entries(registry.sessions || {})) {
      sessions.push({
        id: sessionId,
        ...session,
        services: Object.keys(session.services || {})
      });
    }

    // Also check for active projects
    for (const [projectPath, services] of Object.entries(registry.services?.projects || {})) {
      const projectName = path.basename(projectPath);
      // Check if any services are alive
      for (const [serviceName, service] of Object.entries(services)) {
        if (this.psm.isProcessAlive(service.pid)) {
          sessions.push({
            id: `project-${projectName}`,
            projectPath,
            projectName,
            services: [serviceName]
          });
          break; // Only add project once
        }
      }
    }

    return sessions;
  }

  /**
   * Broadcast signal to health monitoring processes
   */
  async broadcastPauseSignal() {
    const healthMonitorPatterns = [
      'health-verifier.js',
      'global-process-supervisor.js',
      'statusline-health-monitor.js'
    ];

    let signalCount = 0;

    for (const pattern of healthMonitorPatterns) {
      const processes = await this.psm.findRunningProcessesByScript(pattern);
      for (const proc of processes) {
        try {
          process.kill(proc.pid, 'SIGUSR2');
          this.log(`Sent SIGUSR2 to ${pattern} (PID: ${proc.pid})`);
          signalCount++;
        } catch (error) {
          this.log(`Failed to signal ${pattern} (PID: ${proc.pid}): ${error.message}`, 'warn');
        }
      }
    }

    return signalCount;
  }

  /**
   * Broadcast signal to resume health monitoring
   */
  async broadcastResumeSignal() {
    // SIGUSR1 will be used to resume monitoring
    const healthMonitorPatterns = [
      'health-verifier.js',
      'global-process-supervisor.js',
      'statusline-health-monitor.js'
    ];

    for (const pattern of healthMonitorPatterns) {
      const processes = await this.psm.findRunningProcessesByScript(pattern);
      for (const proc of processes) {
        try {
          process.kill(proc.pid, 'SIGUSR1');
          this.log(`Sent SIGUSR1 (resume) to ${pattern} (PID: ${proc.pid})`);
        } catch (error) {
          // Process may have exited
        }
      }
    }
  }

  /**
   * Check if Docker daemon is ready (not just client)
   */
  isDockerDaemonReady() {
    try {
      execSync('docker ps', { encoding: 'utf8', stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Detect platform (macos, linux, or unknown)
   */
  getPlatform() {
    const platform = process.platform;
    if (platform === 'darwin') return 'macos';
    if (platform === 'linux') return 'linux';
    return 'unknown';
  }

  /**
   * Ensure Docker daemon is running before attempting Docker operations
   * Supports both macOS (Docker Desktop) and Linux (systemd/native daemon)
   * NOTE: We do NOT kill Docker processes - that's destructive and breaks other sessions
   */
  async ensureDockerRunning() {
    // Quick check if already running
    if (this.isDockerDaemonReady()) {
      this.log('Docker daemon is already running');
      return true;
    }

    const platform = this.getPlatform();
    this.log(`Docker daemon not running - attempting to start (platform: ${platform})...`);

    if (platform === 'macos') {
      // macOS: Use Docker Desktop
      const dockerAppPath = '/Applications/Docker.app';
      try {
        await fs.access(dockerAppPath);
      } catch {
        this.log('Docker Desktop not found at /Applications/Docker.app', 'error');
        this.log('Install Docker Desktop: https://www.docker.com/products/docker-desktop');
        return false;
      }

      this.log('Starting Docker Desktop...');
      try {
        execSync('open -a "Docker"', { stdio: 'pipe' });
      } catch (error) {
        this.log(`Failed to launch Docker Desktop: ${error.message}`, 'error');
        return false;
      }
    } else if (platform === 'linux') {
      // Linux: Try systemd first
      try {
        // Check if systemd is available and docker service exists
        execSync('systemctl is-enabled docker 2>/dev/null', { stdio: 'pipe' });
        this.log('Starting Docker via systemd...');
        execSync('sudo systemctl start docker', { stdio: 'pipe' });
      } catch {
        // systemd not available or docker not a systemd service
        this.log('systemd docker service not available', 'warn');
        this.log('Please start Docker manually: sudo dockerd &');
        return false;
      }
    } else {
      this.log(`Unsupported platform: ${platform}`, 'error');
      this.log('Please start Docker manually');
      return false;
    }

    // Wait for Docker daemon to become ready
    this.log(`Waiting for Docker daemon (max ${DOCKER_STARTUP_TIMEOUT_MS / 1000} seconds)...`);
    const startTime = Date.now();
    let lastLogTime = startTime;

    while (Date.now() - startTime < DOCKER_STARTUP_TIMEOUT_MS) {
      if (this.isDockerDaemonReady()) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        this.log(`Docker daemon ready after ${elapsed} seconds`);
        return true;
      }

      // Log progress every 10 seconds
      if (Date.now() - lastLogTime >= 10000) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        this.log(`Still waiting for Docker daemon... (${elapsed}s elapsed)`);
        lastLogTime = Date.now();
      }

      await this.sleep(1000);
    }

    const elapsed = Math.round(DOCKER_STARTUP_TIMEOUT_MS / 1000);
    this.log(`Docker daemon not ready after ${elapsed} seconds`, 'error');
    if (platform === 'macos') {
      this.log('Please start Docker Desktop manually');
    } else if (platform === 'linux') {
      this.log('Please start Docker: sudo systemctl start docker');
    }
    return false;
  }

  /**
   * Stop native services gracefully
   */
  async stopNativeServices() {
    this.log('Stopping native services gracefully...');
    await this.updateLockStatus('stopping_services');

    // Services to stop in reverse dependency order
    const servicesToStop = [
      'system-health-dashboard-frontend',
      'system-health-dashboard-api',
      'vkb-server',
      'semantic-analysis-server',
      'constraint-monitor',
      'transcript-monitor',
      'live-logging-coordinator'
    ];

    const stoppedServices = [];

    for (const serviceName of servicesToStop) {
      try {
        // Check PSM for service
        const registry = await this.psm.getAllServices();
        const service = registry.services?.global?.[serviceName];

        if (service && this.psm.isProcessAlive(service.pid)) {
          this.log(`Stopping ${serviceName} (PID: ${service.pid})...`);

          // Send SIGTERM for graceful shutdown
          process.kill(service.pid, 'SIGTERM');

          // Wait for process to exit (max 10 seconds)
          let attempts = 0;
          while (attempts < 20 && this.psm.isProcessAlive(service.pid)) {
            await this.sleep(500);
            attempts++;
          }

          // Force kill if still running
          if (this.psm.isProcessAlive(service.pid)) {
            this.log(`Force killing ${serviceName}...`, 'warn');
            process.kill(service.pid, 'SIGKILL');
          }

          // Unregister from PSM
          await this.psm.unregisterService(serviceName, 'global');
          stoppedServices.push(serviceName);
          this.log(`Stopped ${serviceName}`);
        }
      } catch (error) {
        this.log(`Error stopping ${serviceName}: ${error.message}`, 'warn');
      }
    }

    // Also check for processes by script pattern (in case not registered in PSM)
    const scriptPatterns = [
      { pattern: 'system-health-dashboard-frontend', port: 3032 },
      { pattern: 'system-health-dashboard-api', port: 3033 },
      { pattern: 'vkb-server', port: 8080 },
      { pattern: 'semantic-analysis-server', port: 8081 },
      { pattern: 'constraint-monitor', port: 8083 },
      { pattern: 'browser-access', port: 3847 },
      { pattern: 'sse-server', port: 3847 }
    ];

    for (const { pattern, port } of scriptPatterns) {
      const processes = await this.psm.findRunningProcessesByScript(pattern);
      for (const proc of processes) {
        try {
          this.log(`Found unregistered ${pattern} (PID: ${proc.pid}), stopping...`);
          process.kill(proc.pid, 'SIGTERM');
          await this.sleep(1000);
          if (this.psm.isProcessAlive(proc.pid)) {
            process.kill(proc.pid, 'SIGKILL');
          }
        } catch (error) {
          // Process may have exited
        }
      }
    }

    // Clean up PSM dead processes
    await this.psm.cleanupDeadProcesses();

    // FIRST: Stop standalone Docker containers that may have been started by native mode services
    // This MUST happen BEFORE port killing to properly release Docker-managed ports
    // Native mode uses different container names than docker-compose mode:
    // - Constraint Monitor: constraint-monitor-redis, constraint-monitor-qdrant
    // - Code Graph RAG: code-graph-rag-memgraph-1, code-graph-rag-lab-1
    if (this.isDockerDaemonReady()) {
      this.log('Stopping standalone Docker containers from native mode...');

      const containerPatterns = [
        'constraint-monitor-',  // Redis, Qdrant from constraint monitor
        'code-graph-rag-',      // Memgraph, Lab from code-graph-rag
        'coding-'               // Any coding- prefixed containers
      ];

      try {
        const runningContainers = execSync('docker ps --format "{{.Names}}"', {
          encoding: 'utf8',
          stdio: 'pipe'
        }).trim().split('\n').filter(Boolean);

        for (const containerName of runningContainers) {
          if (containerPatterns.some(pattern => containerName.startsWith(pattern))) {
            try {
              this.log(`Stopping standalone container: ${containerName}...`);
              execSync(`docker stop ${containerName} 2>/dev/null || true`, {
                encoding: 'utf8',
                stdio: 'pipe',
                timeout: 15000
              });
              execSync(`docker rm ${containerName} 2>/dev/null || true`, {
                encoding: 'utf8',
                stdio: 'pipe'
              });
              this.log(`Stopped ${containerName}`);
            } catch (error) {
              this.log(`Warning: Could not stop ${containerName}: ${error.message}`, 'warn');
            }
          }
        }
      } catch (error) {
        this.log(`Warning: Could not list/stop containers: ${error.message}`, 'warn');
      }

      // Give Docker time to release port bindings
      await this.sleep(2000);
    } else {
      this.log('Docker not running - skipping container cleanup', 'warn');
    }

    // THEN: Release any remaining ports (non-Docker native processes)
    // Only kill ports NOT typically owned by Docker containers
    const nativePorts = [
      8080,   // VKB Server
      3032,   // Health Dashboard HTTP
      3033,   // Health Dashboard WebSocket
      3847,   // Browser Access SSE
      3848,   // Semantic Analysis SSE
      3849,   // Constraint Monitor SSE
      3850    // Code-Graph-RAG SSE
    ];

    this.log('Releasing native service ports...');
    for (const port of nativePorts) {
      try {
        const pids = execSync(`lsof -ti:${port} 2>/dev/null || true`, {
          encoding: 'utf8'
        }).trim();

        if (pids) {
          this.log(`Releasing port ${port} (PIDs: ${pids.split('\n').join(', ')})...`);
          execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, {
            encoding: 'utf8',
            stdio: 'pipe'
          });
        }
      } catch {
        // Port may not be in use or already released
      }
    }

    this.log(`Stopped ${stoppedServices.length} native services`);
    return stoppedServices;
  }

  /**
   * Stop Docker containers
   */
  async stopDockerContainers() {
    this.log('Stopping Docker containers...');
    await this.updateLockStatus('stopping_docker');

    // Check if Docker is running before trying to stop containers
    if (!this.isDockerDaemonReady()) {
      this.log('Docker daemon not running - no containers to stop');
      return;
    }

    try {
      const dockerDir = path.join(this.codingRoot, 'docker');
      const composeFile = path.join(dockerDir, 'docker-compose.yml');

      if (fsSync.existsSync(composeFile)) {
        execSync(`docker compose -f "${composeFile}" down`, {
          encoding: 'utf8',
          stdio: this.verbose ? 'inherit' : 'pipe'
        });
        this.log('Docker containers stopped');
      }
    } catch (error) {
      this.log(`Error stopping Docker containers: ${error.message}`, 'warn');
    }
  }

  /**
   * Start native services
   */
  async startNativeServices() {
    this.log('Starting native services...');
    await this.updateLockStatus('starting_native');

    try {
      const startScript = path.join(this.codingRoot, 'start-services.sh');

      execSync(`"${startScript}"`, {
        encoding: 'utf8',
        stdio: this.verbose ? 'inherit' : 'pipe',
        cwd: this.codingRoot
      });

      this.log('Native services started');
      return true;
    } catch (error) {
      this.log(`Error starting native services: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * Start Docker containers
   */
  async startDockerContainers() {
    this.log('Starting Docker containers...');
    await this.updateLockStatus('starting_docker');

    try {
      // First ensure Docker Desktop is running
      const dockerReady = await this.ensureDockerRunning();
      if (!dockerReady) {
        throw new Error('Docker daemon is not available - please start Docker Desktop');
      }

      const dockerDir = path.join(this.codingRoot, 'docker');
      const composeFile = path.join(dockerDir, 'docker-compose.yml');

      if (!fsSync.existsSync(composeFile)) {
        throw new Error(`Docker compose file not found: ${composeFile}`);
      }

      execSync(`docker compose -f "${composeFile}" up -d`, {
        encoding: 'utf8',
        stdio: this.verbose ? 'inherit' : 'pipe',
        cwd: this.codingRoot,
        env: { ...process.env, CODING_REPO: this.codingRoot }
      });

      this.log('Docker containers started');
      return true;
    } catch (error) {
      this.log(`Error starting Docker containers: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * Wait for services to be healthy
   */
  async waitForHealthy(targetMode) {
    this.log(`Waiting for ${targetMode} services to be healthy...`);
    await this.updateLockStatus('health_check');

    const healthEndpoint = 'http://localhost:8080/health';
    const startTime = Date.now();

    while (Date.now() - startTime < HEALTH_CHECK_TIMEOUT_MS) {
      try {
        const response = await fetch(healthEndpoint, {
          method: 'GET',
          signal: AbortSignal.timeout(5000)
        });

        if (response.ok) {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          this.log(`Services healthy after ${elapsed}s`);
          return true;
        }
      } catch {
        // Service not ready yet
      }

      await this.sleep(2000);
    }

    this.log('Health check timeout', 'error');
    return false;
  }

  /**
   * Set Docker mode marker file
   */
  async setDockerMode(enabled) {
    const markerPath = path.join(this.codingRoot, '.docker-mode');

    if (enabled) {
      await fs.writeFile(markerPath, `# Docker mode enabled\n# Created: ${new Date().toISOString()}\n`, 'utf8');
      this.log('Docker mode marker created');
    } else {
      try {
        await fs.unlink(markerPath);
        this.log('Docker mode marker removed');
      } catch {
        // File may not exist
      }
    }
  }

  /**
   * Perform rollback to previous mode
   */
  async rollback(fromMode) {
    this.log('Rolling back to previous mode...', 'warn');
    await this.updateLockStatus('rolling_back');

    try {
      if (fromMode === 'native') {
        // Kill any partially started Docker containers
        await this.stopDockerContainers();
        // Restart native services
        await this.startNativeServices();
        await this.setDockerMode(false);
      } else {
        // Kill any partially started native services
        await this.stopNativeServices();
        // Restart Docker containers
        await this.startDockerContainers();
        await this.setDockerMode(true);
      }

      // Wait for services
      await this.waitForHealthy(fromMode);

      this.log('Rollback completed');
      return true;
    } catch (error) {
      this.log(`Rollback failed: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * Main transition method
   */
  async transition(targetMode) {
    const fromMode = await this.getCurrentMode();

    if (fromMode === targetMode) {
      this.log(`Already in ${targetMode} mode, no transition needed`);
      return { success: true, message: `Already in ${targetMode} mode` };
    }

    // Check for existing transition
    const transitionStatus = await this.isTransitionInProgress();
    if (transitionStatus.inProgress) {
      const msg = `Transition already in progress: ${transitionStatus.lockData.fromMode} → ${transitionStatus.lockData.toMode}`;
      this.log(msg, 'warn');
      return { success: false, message: msg };
    }

    // Get active sessions
    const sessions = await this.getActiveSessions();
    this.log(`Found ${sessions.length} active session(s)`);

    // Create lock file
    await this.createLockFile(fromMode, targetMode, sessions.map(s => s.id));

    try {
      // CRITICAL: If transitioning TO Docker, ensure Docker is running BEFORE stopping native services
      // Native mode uses Docker containers (Qdrant, Redis, Memgraph) that need Docker to be running to stop properly
      if (targetMode === 'docker') {
        this.log('Ensuring Docker is available for transition...');
        const dockerReady = await this.ensureDockerRunning();
        if (!dockerReady) {
          throw new Error('Docker daemon is not available - cannot proceed with transition');
        }
      }

      // Broadcast pause signal to health monitors
      const signalCount = await this.broadcastPauseSignal();
      this.log(`Paused ${signalCount} health monitor(s)`);

      // Give health monitors time to pause
      await this.sleep(1000);

      // Stop current mode services
      if (fromMode === 'native') {
        await this.stopNativeServices();
      } else {
        await this.stopDockerContainers();
      }

      // Brief pause to release ports
      await this.sleep(2000);

      // Start target mode services
      let startSuccess = false;
      if (targetMode === 'docker') {
        await this.setDockerMode(true);
        startSuccess = await this.startDockerContainers();
      } else {
        await this.setDockerMode(false);
        startSuccess = await this.startNativeServices();
      }

      if (!startSuccess) {
        this.log('Failed to start target mode services, initiating rollback...', 'error');
        await this.rollback(fromMode);
        await this.removeLockFile();
        await this.broadcastResumeSignal();
        return { success: false, message: 'Failed to start services, rolled back' };
      }

      // Wait for health check
      const healthy = await this.waitForHealthy(targetMode);

      if (!healthy) {
        this.log('Services not healthy, initiating rollback...', 'error');
        await this.rollback(fromMode);
        await this.removeLockFile();
        await this.broadcastResumeSignal();
        return { success: false, message: 'Health check failed, rolled back' };
      }

      // Transition successful
      await this.updateLockStatus('completed');
      await this.removeLockFile();

      // Resume health monitoring
      await this.broadcastResumeSignal();

      this.log(`✅ Transition complete: ${fromMode} → ${targetMode}`);
      return {
        success: true,
        message: `Successfully transitioned from ${fromMode} to ${targetMode}`,
        fromMode,
        toMode: targetMode,
        sessions: sessions.map(s => s.id)
      };

    } catch (error) {
      this.log(`Transition error: ${error.message}`, 'error');
      await this.updateLockStatus('error', error.message);

      // Attempt rollback
      await this.rollback(fromMode);
      await this.removeLockFile();
      await this.broadcastResumeSignal();

      return { success: false, message: error.message };
    }
  }

  /**
   * Get current mode status
   */
  async getStatus() {
    const currentMode = await this.getCurrentMode();
    const transitionStatus = await this.isTransitionInProgress();
    const sessions = await this.getActiveSessions();

    return {
      currentMode,
      transitionInProgress: transitionStatus.inProgress,
      transitionData: transitionStatus.lockData || null,
      activeSessions: sessions.length,
      sessions: sessions.map(s => ({ id: s.id, services: s.services?.length || 0 }))
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Check if transition is in progress (for health monitors to import)
 */
export async function isTransitionLocked() {
  try {
    await fs.access(TRANSITION_LOCK_FILE);
    const content = await fs.readFile(TRANSITION_LOCK_FILE, 'utf8');
    const lockData = JSON.parse(content);

    // Check if lock is stale
    const lockAge = Date.now() - new Date(lockData.startTime).getTime();
    if (lockAge > TRANSITION_TIMEOUT_MS) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Get transition lock data (for health monitors)
 */
export async function getTransitionLockData() {
  try {
    const content = await fs.readFile(TRANSITION_LOCK_FILE, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// Export lock file path for other modules
export const TRANSITION_LOCK_PATH = TRANSITION_LOCK_FILE;

// CLI support
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const command = process.argv[2];
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

  const transition = new DockerModeTransition({ verbose });

  (async () => {
    try {
      switch (command) {
        case 'to-docker':
        case 'docker':
          const dockerResult = await transition.transition('docker');
          console.log(dockerResult.success ? '✅' : '❌', dockerResult.message);
          process.exit(dockerResult.success ? 0 : 1);
          break;

        case 'to-native':
        case 'native':
          const nativeResult = await transition.transition('native');
          console.log(nativeResult.success ? '✅' : '❌', nativeResult.message);
          process.exit(nativeResult.success ? 0 : 1);
          break;

        case 'status':
          const status = await transition.getStatus();
          console.log('\n📊 Mode Status:');
          console.log(`   Current Mode: ${status.currentMode === 'docker' ? '🐳' : '💻'} ${status.currentMode}`);
          console.log(`   Transition: ${status.transitionInProgress ? '🔄 In Progress' : '✅ None'}`);
          if (status.transitionData) {
            console.log(`   Transitioning: ${status.transitionData.fromMode} → ${status.transitionData.toMode}`);
            console.log(`   Status: ${status.transitionData.status}`);
          }
          console.log(`   Active Sessions: ${status.activeSessions}`);
          if (status.sessions.length > 0) {
            console.log('   Sessions:');
            status.sessions.forEach(s => {
              console.log(`     - ${s.id} (${s.services} services)`);
            });
          }
          break;

        case 'check':
          // Quick check if transition is in progress (for shell scripts)
          const locked = await isTransitionLocked();
          console.log(locked ? 'transition_in_progress' : 'no_transition');
          process.exit(locked ? 1 : 0);
          break;

        case 'unlock':
          // Force remove lock file (emergency use)
          await transition.removeLockFile();
          console.log('✅ Lock file removed');
          break;

        default:
          console.log('Docker Mode Transition Orchestrator\n');
          console.log('Usage: node docker-mode-transition.js <command> [options]\n');
          console.log('Commands:');
          console.log('  to-docker, docker  - Transition to Docker mode');
          console.log('  to-native, native  - Transition to native mode');
          console.log('  status             - Show current mode and transition status');
          console.log('  check              - Check if transition is in progress (for scripts)');
          console.log('  unlock             - Force remove lock file (emergency)\n');
          console.log('Options:');
          console.log('  --verbose, -v      - Verbose output');
      }
    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }
  })();
}

export default DockerModeTransition;
