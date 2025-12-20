#!/usr/bin/env node

/**
 * Global Process Supervisor
 *
 * A daemon that actively monitors and restarts all critical processes:
 * - Per-project transcript monitors
 * - Global services (statusline-health-monitor, health-verifier)
 *
 * Features:
 * - Dynamic project discovery from PSM, health files, and Claude dirs
 * - Cooldown periods to prevent restart storms (5 min per service)
 * - Max 10 restarts per hour per service
 * - Heartbeat file for liveness verification
 * - PSM registration as global singleton
 */

import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import ProcessStateManager from './process-state-manager.js';

class GlobalProcessSupervisor {
  constructor(options = {}) {
    this.codingRoot = options.codingRoot || process.env.CODING_REPO || '/Users/q284340/Agentic/coding';
    this.psm = new ProcessStateManager({ codingRoot: this.codingRoot });
    this.serviceName = 'global-process-supervisor';

    // Cooldown tracking
    this.cooldowns = new Map();      // serviceName -> lastRestartTime
    this.restartCounts = new Map();  // serviceName -> { count, resetTime }

    // Configuration
    this.checkInterval = options.checkInterval || 30000;  // 30 seconds
    this.cooldownMs = options.cooldownMs || 300000;       // 5 minutes
    this.maxRestartsPerHour = options.maxRestartsPerHour || 10;
    this.healthFileMaxAge = options.healthFileMaxAge || 60000;  // 60 seconds stale

    // Internal state
    this.running = false;
    this.checkTimer = null;
    this.heartbeatTimer = null;
    this.heartbeatPath = path.join(this.codingRoot, '.health', 'supervisor-heartbeat.json');
    this.logPath = path.join(this.codingRoot, '.logs', 'global-process-supervisor.log');

    // Global services to monitor
    this.globalServices = [
      { name: 'statusline-health-monitor', script: 'statusline-health-monitor.js', args: ['--daemon', '--auto-heal'] },
      { name: 'health-verifier', script: 'health-verifier.js', args: ['start'] }
    ];
  }

  log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level}] [Supervisor] ${message}`;
    console.log(logEntry);

    // Append to log file
    try {
      fs.appendFileSync(this.logPath, logEntry + '\n');
    } catch {
      // Ignore log write errors
    }
  }

  // ============================================
  // PROJECT DISCOVERY
  // ============================================

  /**
   * Discover all active projects from multiple sources
   */
  async discoverActiveProjects() {
    const projects = new Set();

    // Source 1: PSM Registry
    const psmProjects = await this.getProjectsFromPSM();
    psmProjects.forEach(p => projects.add(p));

    // Source 2: Health Files
    const healthProjects = this.getProjectsFromHealthFiles();
    healthProjects.forEach(p => projects.add(p));

    // Source 3: Claude Transcript Directories
    const claudeProjects = this.getProjectsFromClaudeTranscripts();
    claudeProjects.forEach(p => projects.add(p));

    return Array.from(projects);
  }

  /**
   * Get projects from PSM registry (per-project services)
   */
  async getProjectsFromPSM() {
    const projects = [];
    try {
      const registry = await this.psm.getAllServices();
      const projectServices = registry.services?.projects || {};

      for (const projectPath of Object.keys(projectServices)) {
        if (projectPath.includes('/Agentic/')) {
          projects.push(projectPath);
        }
      }
    } catch (error) {
      this.log(`PSM discovery error: ${error.message}`, 'WARN');
    }
    return projects;
  }

  /**
   * Get projects from health files in .health directory
   */
  getProjectsFromHealthFiles() {
    const projects = [];
    try {
      const healthDir = path.join(this.codingRoot, '.health');
      const files = fs.readdirSync(healthDir);

      for (const file of files) {
        const match = file.match(/^(.+)-transcript-monitor-health\.json$/);
        if (match) {
          const projectName = match[1];
          // Convert project name to full path
          const projectPath = `/Users/q284340/Agentic/${projectName}`;
          if (fs.existsSync(projectPath)) {
            projects.push(projectPath);
          }
        }
      }
    } catch (error) {
      this.log(`Health file discovery error: ${error.message}`, 'WARN');
    }
    return projects;
  }

  /**
   * Get projects from Claude transcript directories
   */
  getProjectsFromClaudeTranscripts() {
    const projects = [];
    try {
      const claudeProjectsDir = path.join(process.env.HOME || '/Users/q284340', '.claude', 'projects');
      if (!fs.existsSync(claudeProjectsDir)) return projects;

      const dirs = fs.readdirSync(claudeProjectsDir);
      for (const dir of dirs) {
        // Match pattern: -Users-q284340-Agentic-{projectName}
        const match = dir.match(/^-Users-q284340-Agentic-(.+)$/);
        if (match) {
          const projectPath = `/Users/q284340/Agentic/${match[1]}`;
          if (fs.existsSync(projectPath)) {
            // Check if transcripts exist and are recent (< 24 hours)
            const transcriptDir = path.join(claudeProjectsDir, dir);
            const files = fs.readdirSync(transcriptDir).filter(f => f.endsWith('.jsonl'));
            if (files.length > 0) {
              const latestFile = files
                .map(f => ({ file: f, mtime: fs.statSync(path.join(transcriptDir, f)).mtime.getTime() }))
                .sort((a, b) => b.mtime - a.mtime)[0];

              // Only include if transcript is less than 24 hours old
              if (Date.now() - latestFile.mtime < 24 * 60 * 60 * 1000) {
                projects.push(projectPath);
              }
            }
          }
        }
      }
    } catch (error) {
      this.log(`Claude transcript discovery error: ${error.message}`, 'WARN');
    }
    return projects;
  }

  // ============================================
  // HEALTH CHECKING
  // ============================================

  /**
   * Check if a transcript monitor is healthy for a given project
   */
  isMonitorHealthy(projectPath) {
    try {
      const projectName = path.basename(projectPath);
      const healthFile = path.join(this.codingRoot, '.health', `${projectName}-transcript-monitor-health.json`);

      if (!fs.existsSync(healthFile)) {
        return { healthy: false, reason: 'no health file' };
      }

      const stats = fs.statSync(healthFile);
      const age = Date.now() - stats.mtime.getTime();

      if (age > this.healthFileMaxAge) {
        return { healthy: false, reason: `stale health file (${Math.round(age / 1000)}s old)` };
      }

      // Read health file to get PID and verify it's alive
      const healthData = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
      if (healthData.metrics?.processId) {
        const pid = healthData.metrics.processId;
        if (!this.psm.isProcessAlive(pid)) {
          return { healthy: false, reason: `PID ${pid} is dead`, pid };
        }
      }

      return { healthy: true, reason: 'ok' };
    } catch (error) {
      return { healthy: false, reason: error.message };
    }
  }

  /**
   * Check if a global service is healthy
   */
  async isGlobalServiceHealthy(serviceName) {
    try {
      const service = await this.psm.getService(serviceName, 'global');
      if (!service) {
        return { healthy: false, reason: 'not registered' };
      }

      if (!this.psm.isProcessAlive(service.pid)) {
        return { healthy: false, reason: `PID ${service.pid} is dead`, pid: service.pid };
      }

      return { healthy: true, reason: 'ok', pid: service.pid };
    } catch (error) {
      return { healthy: false, reason: error.message };
    }
  }

  // ============================================
  // COOLDOWN AND RATE LIMITING
  // ============================================

  /**
   * Check if a service is in cooldown
   */
  isInCooldown(serviceName) {
    const lastRestart = this.cooldowns.get(serviceName);
    if (!lastRestart) return false;

    return Date.now() - lastRestart < this.cooldownMs;
  }

  /**
   * Check if we can restart (not over hourly limit)
   */
  canRestart(serviceName) {
    const counts = this.restartCounts.get(serviceName);
    if (!counts) return true;

    const now = Date.now();
    // Reset count if more than 1 hour has passed
    if (now - counts.resetTime > 60 * 60 * 1000) {
      this.restartCounts.set(serviceName, { count: 0, resetTime: now });
      return true;
    }

    return counts.count < this.maxRestartsPerHour;
  }

  /**
   * Record a restart attempt
   */
  recordRestart(serviceName) {
    // Update cooldown
    this.cooldowns.set(serviceName, Date.now());

    // Update restart count
    const counts = this.restartCounts.get(serviceName) || { count: 0, resetTime: Date.now() };
    counts.count++;
    this.restartCounts.set(serviceName, counts);
  }

  // ============================================
  // RESTART LOGIC
  // ============================================

  /**
   * Restart a transcript monitor for a project
   */
  async restartTranscriptMonitor(projectPath) {
    const serviceName = `transcript-monitor:${path.basename(projectPath)}`;

    // Check cooldown and rate limits
    if (this.isInCooldown(serviceName)) {
      this.log(`${serviceName} is in cooldown, skipping restart`, 'DEBUG');
      return false;
    }

    if (!this.canRestart(serviceName)) {
      this.log(`${serviceName} exceeded hourly restart limit`, 'WARN');
      return false;
    }

    try {
      this.log(`Restarting transcript monitor for ${projectPath}`);

      // Clean up dead PSM entry first
      await this.psm.unregisterService('enhanced-transcript-monitor', 'per-project', { projectPath });

      // Spawn new monitor
      const monitorScript = path.join(this.codingRoot, 'scripts', 'enhanced-transcript-monitor.js');
      const env = {
        ...process.env,
        CODING_REPO: this.codingRoot,
        TRANSCRIPT_SOURCE_PROJECT: projectPath
      };

      const monitor = spawn('node', [monitorScript, projectPath], {
        detached: true,
        stdio: 'ignore',
        env,
        cwd: this.codingRoot
      });

      monitor.unref();

      // Register with PSM
      await this.psm.registerService({
        name: 'enhanced-transcript-monitor',
        pid: monitor.pid,
        type: 'per-project',
        script: 'enhanced-transcript-monitor.js',
        projectPath,
        metadata: {
          spawnedBy: 'global-process-supervisor',
          restartedAt: new Date().toISOString()
        }
      });

      this.recordRestart(serviceName);
      this.log(`Restarted transcript monitor for ${projectPath} (PID: ${monitor.pid})`);
      return true;
    } catch (error) {
      this.log(`Failed to restart transcript monitor for ${projectPath}: ${error.message}`, 'ERROR');
      return false;
    }
  }

  /**
   * Restart a global service
   */
  async restartGlobalService(serviceConfig) {
    const { name, script, args } = serviceConfig;

    // Check cooldown and rate limits
    if (this.isInCooldown(name)) {
      this.log(`${name} is in cooldown, skipping restart`, 'DEBUG');
      return false;
    }

    if (!this.canRestart(name)) {
      this.log(`${name} exceeded hourly restart limit`, 'WARN');
      return false;
    }

    try {
      this.log(`Restarting global service: ${name}`);

      // Clean up dead PSM entry first
      await this.psm.unregisterService(name, 'global');

      // Spawn new service
      const scriptPath = path.join(this.codingRoot, 'scripts', script);
      const env = {
        ...process.env,
        CODING_REPO: this.codingRoot
      };

      const service = spawn('node', [scriptPath, ...args], {
        detached: true,
        stdio: 'ignore',
        env,
        cwd: this.codingRoot
      });

      service.unref();

      // Give service time to self-register with PSM
      await new Promise(resolve => setTimeout(resolve, 2000));

      this.recordRestart(name);
      this.log(`Restarted global service: ${name} (PID: ${service.pid})`);
      return true;
    } catch (error) {
      this.log(`Failed to restart global service ${name}: ${error.message}`, 'ERROR');
      return false;
    }
  }

  // ============================================
  // SUPERVISION LOOP
  // ============================================

  /**
   * Check all transcript monitors and restart dead ones
   */
  async checkAllTranscriptMonitors() {
    const projects = await this.discoverActiveProjects();
    let restartCount = 0;

    for (const projectPath of projects) {
      const health = this.isMonitorHealthy(projectPath);

      if (!health.healthy) {
        this.log(`Monitor unhealthy for ${path.basename(projectPath)}: ${health.reason}`);

        if (await this.restartTranscriptMonitor(projectPath)) {
          restartCount++;
        }
      }
    }

    return { checked: projects.length, restarted: restartCount };
  }

  /**
   * Check all global services and restart dead ones
   */
  async checkGlobalServices() {
    let restartCount = 0;

    for (const serviceConfig of this.globalServices) {
      const health = await this.isGlobalServiceHealthy(serviceConfig.name);

      if (!health.healthy) {
        this.log(`Global service unhealthy: ${serviceConfig.name}: ${health.reason}`);

        if (await this.restartGlobalService(serviceConfig)) {
          restartCount++;
        }
      }
    }

    return { checked: this.globalServices.length, restarted: restartCount };
  }

  /**
   * Main supervision loop
   */
  async supervisionLoop() {
    if (!this.running) return;

    try {
      this.log('Running supervision check...', 'DEBUG');

      // Check transcript monitors
      const monitorResults = await this.checkAllTranscriptMonitors();
      if (monitorResults.restarted > 0) {
        this.log(`Transcript monitors: checked ${monitorResults.checked}, restarted ${monitorResults.restarted}`);
      }

      // Check global services
      const serviceResults = await this.checkGlobalServices();
      if (serviceResults.restarted > 0) {
        this.log(`Global services: checked ${serviceResults.checked}, restarted ${serviceResults.restarted}`);
      }
    } catch (error) {
      this.log(`Supervision check error: ${error.message}`, 'ERROR');
    }
  }

  // ============================================
  // HEARTBEAT
  // ============================================

  writeHeartbeat() {
    try {
      const heartbeat = {
        pid: process.pid,
        timestamp: Date.now(),
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage().heapUsed,
        cooldowns: Object.fromEntries(this.cooldowns),
        restartCounts: Object.fromEntries(
          Array.from(this.restartCounts.entries()).map(([k, v]) => [k, v.count])
        )
      };

      fs.writeFileSync(this.heartbeatPath, JSON.stringify(heartbeat, null, 2));
    } catch (error) {
      this.log(`Failed to write heartbeat: ${error.message}`, 'ERROR');
    }
  }

  // ============================================
  // LIFECYCLE
  // ============================================

  /**
   * Check for existing instance
   */
  async checkExistingInstance() {
    try {
      // Check PSM for existing registration
      const existing = await this.psm.getService(this.serviceName, 'global');
      if (existing && this.psm.isProcessAlive(existing.pid)) {
        return { running: true, pid: existing.pid };
      }

      // Check via pgrep
      const processes = await this.psm.findRunningProcessesByScript('global-process-supervisor');
      if (processes.length > 0) {
        return { running: true, pid: processes[0].pid };
      }

      // Clean up dead PSM entry if exists
      if (existing) {
        await this.psm.unregisterService(this.serviceName, 'global');
      }

      return { running: false };
    } catch (error) {
      this.log(`Error checking existing instance: ${error.message}`, 'WARN');
      return { running: false };
    }
  }

  /**
   * Start the supervisor daemon
   */
  async start() {
    // Check for existing instance
    const existing = await this.checkExistingInstance();
    if (existing.running) {
      console.error(`Supervisor already running (PID: ${existing.pid})`);
      process.exit(1);
    }

    // Ensure directories exist
    const healthDir = path.join(this.codingRoot, '.health');
    const logsDir = path.join(this.codingRoot, '.logs');
    if (!fs.existsSync(healthDir)) fs.mkdirSync(healthDir, { recursive: true });
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    // Initialize PSM
    await this.psm.initialize();

    // Register with PSM
    await this.psm.registerService({
      name: this.serviceName,
      pid: process.pid,
      type: 'global',
      script: 'global-process-supervisor.js',
      metadata: {
        startedAt: new Date().toISOString(),
        checkInterval: this.checkInterval
      }
    });

    this.running = true;
    this.log('Global Process Supervisor started');

    // Set up graceful shutdown
    process.on('SIGTERM', () => this.stop());
    process.on('SIGINT', () => this.stop());
    process.on('uncaughtException', (error) => {
      this.log(`Uncaught exception: ${error.message}`, 'ERROR');
      // Don't exit - keep supervising
    });
    process.on('unhandledRejection', (reason) => {
      this.log(`Unhandled rejection: ${reason}`, 'ERROR');
      // Don't exit - keep supervising
    });

    // Write initial heartbeat
    this.writeHeartbeat();

    // Start heartbeat timer (every 15 seconds)
    this.heartbeatTimer = setInterval(() => this.writeHeartbeat(), 15000);

    // Run initial check
    await this.supervisionLoop();

    // Start supervision timer
    this.checkTimer = setInterval(() => this.supervisionLoop(), this.checkInterval);

    console.log(`✅ Global Process Supervisor running (PID: ${process.pid})`);
    console.log(`   Check interval: ${this.checkInterval / 1000}s`);
    console.log(`   Cooldown: ${this.cooldownMs / 1000}s`);
    console.log(`   Max restarts/hour: ${this.maxRestartsPerHour}`);
  }

  /**
   * Stop the supervisor daemon
   */
  async stop() {
    this.log('Stopping Global Process Supervisor...');
    this.running = false;

    // Clear timers
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Unregister from PSM
    try {
      await this.psm.unregisterService(this.serviceName, 'global');
    } catch {
      // Ignore unregister errors
    }

    // Remove heartbeat file
    try {
      fs.unlinkSync(this.heartbeatPath);
    } catch {
      // Ignore
    }

    this.log('Global Process Supervisor stopped');
    process.exit(0);
  }
}

// ============================================
// MAIN
// ============================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Global Process Supervisor

Usage: node global-process-supervisor.js [options]

Options:
  --daemon        Run as a daemon (default if no options)
  --check-once    Run a single check and exit
  --status        Show current status and exit
  --help, -h      Show this help

Environment:
  CODING_REPO     Path to coding repository (default: /Users/q284340/Agentic/coding)
`);
    process.exit(0);
  }

  const supervisor = new GlobalProcessSupervisor();

  if (args.includes('--status')) {
    // Show status
    const existing = await supervisor.checkExistingInstance();
    if (existing.running) {
      console.log(`Supervisor is running (PID: ${existing.pid})`);

      // Read heartbeat
      try {
        const heartbeat = JSON.parse(fs.readFileSync(supervisor.heartbeatPath, 'utf8'));
        console.log(`  Uptime: ${Math.round(heartbeat.uptime)}s`);
        console.log(`  Last heartbeat: ${new Date(heartbeat.timestamp).toISOString()}`);
      } catch {
        console.log('  (heartbeat not available)');
      }
    } else {
      console.log('Supervisor is not running');
    }
    process.exit(0);
  }

  if (args.includes('--check-once')) {
    // Single check mode
    await supervisor.psm.initialize();
    console.log('Running single supervision check...\n');

    const monitors = await supervisor.checkAllTranscriptMonitors();
    console.log(`Transcript Monitors: ${monitors.checked} checked, ${monitors.restarted} restarted`);

    const services = await supervisor.checkGlobalServices();
    console.log(`Global Services: ${services.checked} checked, ${services.restarted} restarted`);

    process.exit(0);
  }

  // Default: daemon mode
  await supervisor.start();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

export default GlobalProcessSupervisor;
