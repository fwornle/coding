#!/usr/bin/env node

/**
 * Global LSL Coordinator Service
 * 
 * Ensures robust Live Session Logging across all Claude sessions
 * regardless of how or where they are started.
 * 
 * Features:
 * - Global session registry
 * - Health monitoring and recovery
 * - Automatic cleanup of orphaned processes
 * - Cross-project session tracking
 */

const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const os = require('os');

class GlobalLSLCoordinator {
  constructor() {
    this.codingRepo = path.resolve(__dirname, '..');
    this.registryFile = path.join(this.codingRepo, '.mcp-sync', 'session-registry.json');
    this.logFile = path.join(this.codingRepo, 'logs', 'global-lsl-coordinator.log');
    this.registry = this.loadRegistry();
    this.healthCheckInterval = 30000; // 30 seconds
    this.cleanupInterval = 300000; // 5 minutes
    
    this.ensureDirectories();
    this.startHealthMonitoring();
  }

  ensureDirectories() {
    const dirs = [
      path.dirname(this.registryFile),
      path.dirname(this.logFile)
    ];
    
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  log(level, message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[GlobalLSLCoordinator] ${timestamp} ${level.toUpperCase()}: ${message}\n`;
    
    console.log(logEntry.trim());
    
    try {
      fs.appendFileSync(this.logFile, logEntry);
    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }
  }

  loadRegistry() {
    try {
      if (fs.existsSync(this.registryFile)) {
        const data = fs.readFileSync(this.registryFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      this.log('warn', `Failed to load registry: ${error.message}`);
    }
    
    return {
      sessions: {},
      lastCleanup: Date.now(),
      version: '1.0.0'
    };
  }

  saveRegistry() {
    try {
      fs.writeFileSync(this.registryFile, JSON.stringify(this.registry, null, 2));
    } catch (error) {
      this.log('error', `Failed to save registry: ${error.message}`);
    }
  }

  registerSession(projectDir, pid, claudeProcess) {
    const sessionId = `${projectDir}_${pid}`;
    const sessionInfo = {
      sessionId,
      projectDir,
      pid,
      claudeProcess: claudeProcess || 'unknown',
      startTime: Date.now(),
      lastHealthCheck: Date.now(),
      transcriptMonitorPid: null,
      status: 'active'
    };

    this.registry.sessions[sessionId] = sessionInfo;
    this.saveRegistry();
    
    this.log('info', `Registered session: ${sessionId} in ${projectDir}`);
    return sessionId;
  }

  unregisterSession(sessionId) {
    if (this.registry.sessions[sessionId]) {
      delete this.registry.sessions[sessionId];
      this.saveRegistry();
      this.log('info', `Unregistered session: ${sessionId}`);
    }
  }

  async startTranscriptMonitor(projectDir) {
    try {
      // Ensure .specstory/history exists
      const historyDir = path.join(projectDir, '.specstory', 'history');
      if (!fs.existsSync(historyDir)) {
        fs.mkdirSync(historyDir, { recursive: true });
        this.log('info', `Created .specstory/history in ${projectDir}`);
      }

      // Kill any existing monitors for this project to avoid conflicts
      await this.killExistingMonitors(projectDir);

      // Start enhanced transcript monitor
      const monitorScript = path.join(this.codingRepo, 'scripts', 'enhanced-transcript-monitor.js');
      const logFile = path.join(projectDir, 'transcript-monitor.log');
      
      const monitor = spawn('node', [monitorScript], {
        cwd: projectDir,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      // Redirect output to log file
      if (monitor.stdout) {
        const logStream = fs.createWriteStream(logFile, { flags: 'a' });
        monitor.stdout.pipe(logStream);
        monitor.stderr.pipe(logStream);
      }

      monitor.unref(); // Allow parent to exit

      // Brief startup verification
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const isRunning = await this.isProcessRunning(monitor.pid);
      if (isRunning) {
        this.log('info', `Started transcript monitor for ${projectDir} (PID: ${monitor.pid})`);
        return monitor.pid;
      } else {
        throw new Error('Monitor failed to start');
      }

    } catch (error) {
      this.log('error', `Failed to start transcript monitor for ${projectDir}: ${error.message}`);
      return null;
    }
  }

  async killExistingMonitors(projectDir = null) {
    return new Promise((resolve) => {
      const patterns = [
        'enhanced-transcript-monitor.js',
        'simplified-transcript-monitor.js',
        'transcript-monitor.js'
      ];

      const killPromises = patterns.map(pattern => {
        return new Promise((resolveKill) => {
          exec(`pkill -f "${pattern}"`, (error) => {
            // Don't log errors as it's normal for processes not to exist
            resolveKill();
          });
        });
      });

      Promise.all(killPromises).then(() => {
        this.log('info', `Cleaned up existing transcript monitors${projectDir ? ` for ${projectDir}` : ''}`);
        resolve();
      });
    });
  }

  async isProcessRunning(pid) {
    try {
      process.kill(pid, 0); // Signal 0 checks if process exists
      return true;
    } catch (error) {
      return false;
    }
  }

  async healthCheck() {
    const now = Date.now();
    const sessionsToCheck = Object.values(this.registry.sessions);
    
    this.log('debug', `Health check: monitoring ${sessionsToCheck.length} sessions`);

    for (const session of sessionsToCheck) {
      try {
        // Check if Claude process is still running
        const claudeRunning = await this.isProcessRunning(session.pid);
        
        // Check if transcript monitor is running
        let monitorRunning = false;
        if (session.transcriptMonitorPid) {
          monitorRunning = await this.isProcessRunning(session.transcriptMonitorPid);
        }

        if (!claudeRunning) {
          // Claude session ended, clean up
          this.log('info', `Claude session ended: ${session.sessionId}`);
          this.unregisterSession(session.sessionId);
        } else if (!monitorRunning) {
          // Claude running but monitor died, restart monitor
          this.log('warn', `Transcript monitor died for ${session.sessionId}, restarting...`);
          const newMonitorPid = await this.startTranscriptMonitor(session.projectDir);
          if (newMonitorPid) {
            session.transcriptMonitorPid = newMonitorPid;
            session.lastHealthCheck = now;
            this.saveRegistry();
          }
        } else {
          // All good, update health check time
          session.lastHealthCheck = now;
        }

      } catch (error) {
        this.log('error', `Health check failed for ${session.sessionId}: ${error.message}`);
      }
    }

    // Cleanup old entries
    if (now - this.registry.lastCleanup > this.cleanupInterval) {
      await this.cleanup();
      this.registry.lastCleanup = now;
      this.saveRegistry();
    }
  }

  async cleanup() {
    this.log('info', 'Running cleanup of orphaned processes and old entries');
    
    // Remove sessions older than 24 hours that are no longer active
    const cutoffTime = Date.now() - (24 * 60 * 60 * 1000);
    const sessionsToRemove = [];
    
    for (const [sessionId, session] of Object.entries(this.registry.sessions)) {
      if (session.startTime < cutoffTime) {
        const stillRunning = await this.isProcessRunning(session.pid);
        if (!stillRunning) {
          sessionsToRemove.push(sessionId);
        }
      }
    }

    sessionsToRemove.forEach(sessionId => {
      this.unregisterSession(sessionId);
    });

    if (sessionsToRemove.length > 0) {
      this.log('info', `Cleaned up ${sessionsToRemove.length} old session entries`);
    }
  }

  startHealthMonitoring() {
    this.log('info', 'Starting health monitoring');
    
    setInterval(() => {
      this.healthCheck().catch(error => {
        this.log('error', `Health check error: ${error.message}`);
      });
    }, this.healthCheckInterval);

    // Initial health check
    setTimeout(() => {
      this.healthCheck().catch(error => {
        this.log('error', `Initial health check error: ${error.message}`);
      });
    }, 2000);
  }

  async ensureTranscriptMonitor(projectDir, claudePid) {
    // Register the session
    const sessionId = this.registerSession(projectDir, claudePid);
    
    // Start transcript monitor for this session
    const monitorPid = await this.startTranscriptMonitor(projectDir);
    
    if (monitorPid && this.registry.sessions[sessionId]) {
      this.registry.sessions[sessionId].transcriptMonitorPid = monitorPid;
      this.saveRegistry();
      this.log('info', `LSL setup complete for session ${sessionId}`);
      return true;
    } else {
      this.log('error', `Failed to complete LSL setup for session ${sessionId}`);
      return false;
    }
  }

  getStatus() {
    const sessions = Object.values(this.registry.sessions);
    return {
      activeSessions: sessions.length,
      sessions: sessions.map(s => ({
        sessionId: s.sessionId,
        projectDir: s.projectDir,
        pid: s.pid,
        startTime: new Date(s.startTime).toISOString(),
        status: s.status
      })),
      lastCleanup: new Date(this.registry.lastCleanup).toISOString()
    };
  }
}

// CLI interface
if (require.main === module) {
  const coordinator = new GlobalLSLCoordinator();
  
  const command = process.argv[2];
  const args = process.argv.slice(3);

  switch (command) {
    case 'start':
      coordinator.log('info', 'Global LSL Coordinator started');
      // Keep process alive
      process.on('SIGINT', () => {
        coordinator.log('info', 'Shutting down Global LSL Coordinator');
        process.exit(0);
      });
      break;

    case 'ensure':
      if (args.length < 2) {
        console.error('Usage: global-lsl-coordinator.js ensure <project_dir> <claude_pid>');
        process.exit(1);
      }
      const [projectDir, claudePid] = args;
      coordinator.ensureTranscriptMonitor(projectDir, parseInt(claudePid))
        .then(success => {
          process.exit(success ? 0 : 1);
        });
      break;

    case 'status':
      console.log(JSON.stringify(coordinator.getStatus(), null, 2));
      break;

    case 'cleanup':
      coordinator.cleanup().then(() => {
        coordinator.log('info', 'Manual cleanup completed');
      });
      break;

    default:
      console.log(`
Global LSL Coordinator Service

Commands:
  start              Start the coordinator service
  ensure <dir> <pid> Ensure transcript monitoring for a session
  status             Show current status
  cleanup            Run manual cleanup

The coordinator ensures robust Live Session Logging by:
- Tracking all active Claude sessions
- Monitoring transcript monitor health
- Automatically restarting failed monitors
- Cleaning up orphaned processes
      `);
      break;
  }
}

module.exports = GlobalLSLCoordinator;