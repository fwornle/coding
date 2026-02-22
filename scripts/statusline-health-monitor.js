#!/usr/bin/env node

/**
 * StatusLine Health Monitor
 * 
 * Aggregates health data from the Global Coding Monitor (GCM) ecosystem and
 * displays real-time status in Claude Code's status line.
 * 
 * Monitors:
 * - Global Coding Monitor (renamed from Global Service Coordinator)
 * - Active project sessions with Enhanced Transcript Monitors
 * - MCP Constraint Monitor (guardrails)
 */

import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { runIfMain } from '../lib/utils/esm-cli.js';
import ProcessStateManager from './process-state-manager.js';
import { isTransitionLocked, getTransitionLockData } from './docker-mode-transition.js';
import { enableAutoRestart } from './auto-restart-watcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);

class StatusLineHealthMonitor {
  constructor(options = {}) {
    this.codingRepoPath = options.codingRepoPath || path.resolve(__dirname, '..');
    this.updateInterval = options.updateInterval || 15000; // 15 seconds
    this.isDebug = options.debug || false;

    this.logPath = path.join(this.codingRepoPath, '.logs', 'statusline-health.log');

    // Global LSL registry path for multi-project monitoring
    this.registryPath = path.join(this.codingRepoPath, '.global-lsl-registry.json');

    this.lastStatus = null;
    this.updateTimer = null;

    // Auto-healing configuration
    this.autoHealEnabled = options.autoHeal !== false; // Default true
    this.healingAttempts = new Map(); // Track healing attempts per service
    this.maxHealingAttempts = options.maxHealingAttempts || 3;
    this.healingCooldown = options.healingCooldown || 300000; // 5 minutes between healing attempts
    this.lastHealingTime = new Map(); // Track last healing time per service

    // PSM integration for singleton management
    this.psm = new ProcessStateManager({ codingRoot: this.codingRepoPath });
    this.serviceName = 'statusline-health-monitor';
    this.healthRefreshInterval = null;

    // Docker mode transition state
    this.monitoringPaused = false;
    this.transitionData = null;

    // Billing scraper state
    this.lastBillingCheck = 0;
    this.billingScraperRunning = false;

    this.ensureLogDirectory();
  }
  /**
   * Get centralized health file path for a project (same logic as enhanced-transcript-monitor)
   */
  getCentralizedHealthFile(projectPath) {
    // Get coding project path
    const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || this.codingRepoPath;
    
    // Create project-specific health file name based on project path
    const projectName = path.basename(projectPath);
    const healthFileName = `${projectName}-transcript-monitor-health.json`;
    
    // Store in coding project's .health directory
    return path.join(codingPath, '.health', healthFileName);
  }

  ensureLogDirectory() {
    const logDir = path.dirname(this.logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level}] [StatusLineHealth] ${message}\n`;
    
    if (this.isDebug || level === 'ERROR') {
      console.log(logEntry.trim());
    }
    
    try {
      fs.appendFileSync(this.logPath, logEntry);
    } catch (error) {
      console.error(`Failed to write log: ${error.message}`);
    }
  }

  /**
   * Get Global Coding Monitor health status
   */
  async getGlobalCodingMonitorHealth() {
    try {
      // Check if coordinator is running via status command
      const { stdout } = await execAsync(`node "${path.join(this.codingRepoPath, 'scripts/global-service-coordinator.js')}" --status`);

      // Extract JSON from the output (it may have headers)
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in coordinator response');
      }

      const status = JSON.parse(jsonMatch[0]);

      if (status.coordinator && status.coordinator.healthy) {
        // Check actual project registrations from .global-lsl-registry.json
        // (GCM v2.0.0 uses in-memory registry that starts empty)
        let projectCount = 0;

        if (fs.existsSync(this.registryPath)) {
          try {
            const registry = JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));
            projectCount = Object.keys(registry.projects || {}).length;
          } catch (registryError) {
            this.log(`Error reading registry: ${registryError.message}`, 'DEBUG');
          }
        }

        // Coordinator is running and healthy with registered projects
        return {
          status: 'healthy',
          icon: '✅',
          details: `${projectCount} projects`
        };
      } else {
        return {
          status: 'unhealthy',
          icon: '🔴',
          details: 'Coordinator unhealthy'
        };
      }
    } catch (error) {
      this.log(`GCM health check error: ${error.message}`, 'DEBUG');
      return {
        status: 'down',
        icon: '❌',
        details: 'Coordinator not responding'
      };
    }
  }

  /**
   * Get list of projects with running transcript monitors
   * STABILITY FIX: Uses pgrep for more reliable process detection and caches result
   */
  async getRunningTranscriptMonitors() {
    const runningProjects = new Set();

    try {
      // Method 1: Use pgrep which is more reliable than grep on ps output
      // pgrep -lf: -l shows process name with full command, -f matches full argument list
      // NOTE: On macOS, -a means "include ancestors" NOT "show args" (Linux behavior)
      let psOutput = '';
      try {
        psOutput = execSync('pgrep -lf "enhanced-transcript-monitor.js"', { encoding: 'utf8', timeout: 5000 });
      } catch (pgrepError) {
        // pgrep returns exit code 1 when no matches - this is normal
        // Only log if it's a different error
        if (pgrepError.status !== 1) {
          this.log(`pgrep failed with status ${pgrepError.status}: ${pgrepError.message}`, 'WARN');
        }
      }

      if (psOutput && psOutput.trim()) {
        for (const line of psOutput.trim().split('\n')) {
          // Format: PID node enhanced-transcript-monitor.js /path/to/project
          // Extract the LAST path argument (basename) as the project name
          // This handles nested projects like /Agentic/_work/pofo → pofo
          const argMatch = line.match(/enhanced-transcript-monitor\.js\s+(\S+)/);
          if (argMatch) {
            const projectPath = argMatch[1];
            const projectName = path.basename(projectPath);
            if (projectName && projectName !== 'enhanced-transcript-monitor.js') {
              runningProjects.add(projectName);
              continue;
            }
          }

          // Fallback patterns for edge cases (env vars, different command formats)
          const fallbackPatterns = [
            /\/Agentic\/(?:[^/\s]+\/)*([^\s/]+)\s*$/,  // Last segment of Agentic path
            /PROJECT_PATH=\S*\/([^\s/]+)\s*$/            // Handle env var format
          ];

          for (const pattern of fallbackPatterns) {
            const match = line.match(pattern);
            if (match) {
              runningProjects.add(match[1]);
              break;
            }
          }
        }
      }

      // Method 2: Fallback - check centralized health files for recent updates
      // If health file was updated within last 30 seconds, monitor is likely running
      if (runningProjects.size === 0) {
        try {
          const healthDir = path.join(this.codingRepoPath, '.health');
          if (fs.existsSync(healthDir)) {
            const healthFiles = fs.readdirSync(healthDir)
              .filter(f => f.endsWith('-transcript-monitor-health.json'));

            for (const file of healthFiles) {
              const filePath = path.join(healthDir, file);
              const stats = fs.statSync(filePath);
              const age = Date.now() - stats.mtime.getTime();

              // If health file updated in last 30 seconds, monitor is running
              if (age < 30000) {
                const projectName = file.replace('-transcript-monitor-health.json', '');
                runningProjects.add(projectName);
              }
            }
          }
        } catch (fallbackError) {
          this.log(`Health file fallback check failed: ${fallbackError.message}`, 'WARN');
        }
      }

    } catch (error) {
      this.log(`getRunningTranscriptMonitors error: ${error.message}`, 'ERROR');
    }

    return runningProjects;
  }

  /**
   * Get running coding agent sessions via process detection
   * Detects Claude and Copilot processes and their working directories using lsof
   * This catches sessions even if transcript monitors haven't started yet
   */
  async getRunningAgentSessions() {
    const agentSessions = new Set();

    // Helper: extract project name from cwd via lsof
    const extractProjectFromPid = (pid) => {
      try {
        const lsofOutput = execSync(`lsof -p ${pid} 2>/dev/null | grep cwd`, { encoding: 'utf8', timeout: 5000 });
        if (lsofOutput && lsofOutput.trim()) {
          const parts = lsofOutput.trim().split(/\s+/);
          const cwdPath = parts[parts.length - 1];
          const agenticMatch = cwdPath.match(/\/Agentic\/([^/\s]+)/);
          if (agenticMatch) {
            agentSessions.add(agenticMatch[1]);
          }
        }
      } catch (e) { /* process may have exited */ }
    };

    try {
      // Method 1: Find Claude process PIDs and get their working directories
      // Use ps instead of pgrep - pgrep has reliability issues on macOS (misses some processes)
      let claudePids = '';
      try {
        claudePids = execSync('ps -eo pid,comm | awk \'$2 == "claude" {print $1}\'', { encoding: 'utf8', timeout: 5000 });
      } catch (psError) {
        this.log(`ps for claude failed: ${psError.message}`, 'WARN');
      }

      if (claudePids && claudePids.trim()) {
        for (const pidStr of claudePids.trim().split('\n')) {
          const pid = pidStr.trim();
          if (pid) extractProjectFromPid(pid);
        }
      }

      // Method 2: Find non-Claude agent processes (copilot, opencode, etc.)
      // These binaries show full path in ps comm field, so match on basename
      // Also check process elapsed time — zombies surviving VSCode restarts get filtered
      const ZOMBIE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours
      for (const agentName of ['copilot', 'opencode']) {
        let agentLines = '';
        try {
          agentLines = execSync(`ps -eo pid,etime,comm | awk '$3 ~ /${agentName}$/ {print $1, $2}'`, { encoding: 'utf8', timeout: 5000 });
        } catch (psError) {
          // agent not running is normal
        }

        if (agentLines && agentLines.trim()) {
          for (const line of agentLines.trim().split('\n')) {
            const [pid, etime] = line.trim().split(/\s+/);
            if (!pid) continue;

            // Filter zombie agents — processes alive >48h are stale
            // (survived VSCode restarts, terminal closures, etc.)
            if (etime) {
              const elapsedMs = this.parseEtime(etime);
              if (elapsedMs > ZOMBIE_THRESHOLD_MS) {
                this.log(`Skipping zombie ${agentName} PID ${pid} (running ${etime})`, 'DEBUG');
                continue;
              }
            }

            extractProjectFromPid(pid);
          }
        }
      }

      // Method 3: Alternative - check parent launcher processes
      // The claude-mcp-launcher.sh processes know which project they're in
      let launcherOutput = '';
      try {
        launcherOutput = execSync('pgrep -lf "claude-mcp-launcher.sh"', { encoding: 'utf8', timeout: 5000 });
      } catch (pgrepError) {
        if (pgrepError.status !== 1) {
          this.log(`pgrep for launcher failed: ${pgrepError.message}`, 'WARN');
        }
      }

      if (launcherOutput && launcherOutput.trim()) {
        for (const line of launcherOutput.trim().split('\n')) {
          const pidMatch = line.match(/^(\d+)/);
          if (pidMatch) extractProjectFromPid(pidMatch[1]);
        }
      }

    } catch (error) {
      this.log(`getRunningAgentSessions error: ${error.message}`, 'ERROR');
    }

    return agentSessions;
  }

  /**
   * Get active project sessions health
   */
  async getProjectSessionsHealth() {
    const sessions = {};

    // Get projects with running transcript monitors
    const runningMonitors = await this.getRunningTranscriptMonitors();

    // Get projects with running Claude sessions (even without monitors)
    const agentSessions = await this.getRunningAgentSessions();

    // Dynamic path computation - no hardcoded user paths!
    const agenticDir = path.dirname(this.codingRepoPath);
    const homeDir = process.env.HOME;
    const escapedAgenticPath = agenticDir.replace(/\//g, '-').replace(/^-/, '');
    const claudeProjectPrefix = `-${escapedAgenticPath}-`;

    try {
      // Method 1: Registry-based discovery (preferred when available)
      // STABILITY FIX: Also filter by running monitors to ensure consistency
      if (fs.existsSync(this.registryPath)) {
        const registry = JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));

        for (const [projectName, projectInfo] of Object.entries(registry.projects || {})) {
          // Check if monitor is running for this project
          if (!runningMonitors.has(projectName)) {
            // No monitor running — check if an agent (claude/copilot/opencode) is at least running
            const hasAgentSession = agentSessions.has(projectName);

            // If NO agent running AND health file says "stopped" (stale) → skip entirely
            if (!hasAgentSession) {
              const projectPath = path.join(agenticDir, projectName);
              const healthFile = this.getCentralizedHealthFile(projectPath);
              if (fs.existsSync(healthFile)) {
                try {
                  const healthData = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
                  const healthFileAge = healthData.timestamp ? Date.now() - healthData.timestamp : 0;
                  if (healthData.status === 'stopped' && healthFileAge > 300000) { // >5 min since stopped
                    this.log(`Skipping registry session ${projectName} (stopped ${Math.round(healthFileAge / 60000)}min ago, no agent)`, 'DEBUG');
                    continue; // Skip — session is definitively closed
                  }
                } catch { /* fall through to transcript check */ }
              }
            }

            // No monitor — check transcript for recent activity
            const claudeProjectDir = path.join(homeDir, '.claude', 'projects', `${claudeProjectPrefix}${projectName}`);
            if (fs.existsSync(claudeProjectDir)) {
              try {
                const transcriptFiles = fs.readdirSync(claudeProjectDir)
                  .filter(file => file.endsWith('.jsonl'))
                  .map(file => ({
                    path: path.join(claudeProjectDir, file),
                    stats: fs.statSync(path.join(claudeProjectDir, file))
                  }))
                  .sort((a, b) => b.stats.mtime - a.stats.mtime);

                if (transcriptFiles.length > 0) {
                  const mostRecent = transcriptFiles[0];
                  const age = Date.now() - mostRecent.stats.mtime.getTime();
                  // Only show no-monitor sessions if:
                  // 1. Claude/copilot/opencode session is running (virgin/idle session), OR
                  // 2. Very recent activity (< 5 min) suggesting session just closed
                  // Sessions with older transcripts but no agent process are truly closed - omit them
                  const isVeryRecent = age < 300000; // 5 minutes
                  if (hasAgentSession || isVeryRecent) {
                    // Use graduated icon based on transcript age (same progression as monitored sessions)
                    const iconData = hasAgentSession ? this.iconFromAge(age) : { status: 'closing', icon: '💤', details: 'closing' };
                    sessions[projectName] = {
                      ...iconData,
                      status: iconData.status || 'no-monitor',
                      details: iconData.details || (hasAgentSession ? 'virgin' : 'closing')
                    };
                  }
                }
              } catch (e) {
                // Skip on error
              }
            }
            continue; // Skip normal processing - already handled
          }

          const sessionHealth = await this.getProjectSessionHealth(projectName, projectInfo);
          sessions[projectName] = sessionHealth;
        }
      }
      
      // Method 2: Dynamic discovery via Claude transcript files (discovers unregistered sessions)
      // IMPORTANT: Only show sessions with running transcript monitors
      const claudeProjectsDir = path.join(process.env.HOME, '.claude', 'projects');

      if (fs.existsSync(claudeProjectsDir)) {
        const projectDirs = fs.readdirSync(claudeProjectsDir).filter(dir => dir.startsWith(claudeProjectPrefix));

        for (const projectDir of projectDirs) {
          const projectDirPath = path.join(claudeProjectsDir, projectDir);

          // Extract project name from directory dynamically
          const projectName = projectDir.slice(claudeProjectPrefix.length);

          // Skip if already found via registry
          if (sessions[projectName]) continue;

          // Check if monitor is running for this project
          if (!runningMonitors.has(projectName)) {
            // No monitor running - check if session has recent activity
            try {
              const transcriptFiles = fs.readdirSync(projectDirPath)
                .filter(file => file.endsWith('.jsonl'))
                .map(file => ({
                  path: path.join(projectDirPath, file),
                  stats: fs.statSync(path.join(projectDirPath, file))
                }))
                .sort((a, b) => b.stats.mtime - a.stats.mtime);

              if (transcriptFiles.length > 0) {
                const mostRecent = transcriptFiles[0];
                const age = Date.now() - mostRecent.stats.mtime.getTime();
                // Only show no-monitor sessions if:
                // 1. Agent session is running, OR 2. Very recent activity (< 5 min)
                const hasAgent = agentSessions.has(projectName);
                const isVeryRecent = age < 300000; // 5 minutes
                if (hasAgent || isVeryRecent) {
                  const iData = hasAgent ? this.iconFromAge(age) : { status: 'closing', icon: '💤', details: 'closing' };
                  sessions[projectName] = { ...iData, details: iData.details || (hasAgent ? 'virgin' : 'closing') };
                }
              }
            } catch (e) {
              // Skip on error
            }
            continue; // Skip normal processing - already handled or too old
          }

          // Check if this project has a centralized health file FIRST
          const projectPath = path.join(agenticDir, projectName);
          const centralizedHealthFile = this.getCentralizedHealthFile(projectPath);

          if (fs.existsSync(centralizedHealthFile)) {
            // Has monitor running - use health file data
            sessions[projectName] = await this.getProjectSessionHealthFromFile(centralizedHealthFile, projectPath);
          } else {
            // No health file - check transcript activity AND trajectory status
            try {
              const transcriptFiles = fs.readdirSync(projectDirPath)
                .filter(file => file.endsWith('.jsonl'))
                .map(file => ({
                  path: path.join(projectDirPath, file),
                  stats: fs.statSync(path.join(projectDirPath, file))
                }))
                .sort((a, b) => b.stats.mtime - a.stats.mtime);

              // Check trajectory status
              const trajectoryStatus = this.checkTrajectoryStatus(projectPath);

              if (transcriptFiles.length > 0) {
                const mostRecent = transcriptFiles[0];
                const age = Date.now() - mostRecent.stats.mtime.getTime();

                // UNIFIED session activity icon progression:
                // 🟢 Active (<5m) → 🌲 Cooling (5-15m) → 🫒 Fading (15m-1h) → 🪨 Dormant (1-6h) → ⚫ Inactive (6-24h) → 💤 Sleeping (>24h)
                if (age < 300000) { // Active within 5 minutes
                  // Downgrade to amber if trajectory missing/stale
                  if (trajectoryStatus.status !== 'fresh') {
                    sessions[projectName] = {
                      status: 'warning',
                      icon: '🟡',
                      details: trajectoryStatus.status === 'missing' ? 'no tr' : 'stale tr'
                    };
                  } else {
                    sessions[projectName] = {
                      status: 'active',
                      icon: '🟢',
                      details: 'Active session'
                    };
                  }
                } else if (age < 900000) { // 5-15 minutes: cooling (darker green)
                  sessions[projectName] = {
                    status: 'cooling',
                    icon: '🌲',
                    details: 'Cooling down'
                  };
                } else if (age < 3600000) { // 15min - 1 hour: fading (olive)
                  sessions[projectName] = {
                    status: 'fading',
                    icon: '🫒',
                    details: 'Session fading'
                  };
                } else if (age < 21600000) { // 1-6 hours: dormant (rock/dark)
                  sessions[projectName] = {
                    status: 'dormant',
                    icon: '🪨',
                    details: 'Session dormant'
                  };
                } else if (age < 86400000) { // 6-24 hours: inactive (black)
                  sessions[projectName] = {
                    status: 'inactive',
                    icon: '⚫',
                    details: 'Session idle'
                  };
                } else {
                  // Older than 24 hours - show as sleeping
                  sessions[projectName] = {
                    status: 'sleeping',
                    icon: '💤',
                    details: 'Session sleeping'
                  };
                }
              }
            } catch (dirError) {
              // Directory read error - mark as unknown but still include it
              sessions[projectName] = {
                status: 'unknown',
                icon: '❓',
                details: 'Directory access error'
              };
            }
          }
        }
      }
      
      // Method 3: Dynamic discovery of project directories in Agentic parent folder
      // Scan the parent directory for other potential projects
      const commonProjectDirs = [this.codingRepoPath];
      try {
        const siblingDirs = fs.readdirSync(agenticDir)
          .filter(name => {
            const fullPath = path.join(agenticDir, name);
            return fs.statSync(fullPath).isDirectory() && name !== 'coding';
          })
          .map(name => path.join(agenticDir, name));
        commonProjectDirs.push(...siblingDirs);
      } catch (e) {
        // Skip if can't read agentic directory
      }

      for (const projectDir of commonProjectDirs) {
        const projectName = path.basename(projectDir);

        // Skip if already found
        if (sessions[projectName]) continue;

        // Check if monitor is running for this project
        if (!runningMonitors.has(projectName)) {
          // No monitor running - check if session has recent transcript activity
          const claudeProjectDir = path.join(homeDir, '.claude', 'projects', `${claudeProjectPrefix}${projectName}`);
          if (fs.existsSync(claudeProjectDir)) {
            try {
              const transcriptFiles = fs.readdirSync(claudeProjectDir)
                .filter(file => file.endsWith('.jsonl'))
                .map(file => ({
                  path: path.join(claudeProjectDir, file),
                  stats: fs.statSync(path.join(claudeProjectDir, file))
                }))
                .sort((a, b) => b.stats.mtime - a.stats.mtime);

              if (transcriptFiles.length > 0) {
                const mostRecent = transcriptFiles[0];
                const age = Date.now() - mostRecent.stats.mtime.getTime();
                // Only show no-monitor sessions if agent running OR very recent
                const hasAgent3 = agentSessions.has(projectName);
                const isVeryRecent = age < 300000; // 5 minutes
                if (hasAgent3 || isVeryRecent) {
                  const iData3 = hasAgent3 ? this.iconFromAge(age) : { status: 'closing', icon: '💤', details: 'closing' };
                  sessions[projectName] = { ...iData3, details: iData3.details || (hasAgent3 ? 'virgin' : 'closing') };
                }
              }
            } catch (e) {
              // Skip on error
            }
          }
          continue; // Skip normal processing
        }

        if (fs.existsSync(projectDir)) {
          const centralizedHealthFile = this.getCentralizedHealthFile(projectDir);
          if (fs.existsSync(centralizedHealthFile)) {
            sessions[projectName] = await this.getProjectSessionHealthFromFile(centralizedHealthFile, projectDir);
          }
        }
      }
      
    } catch (error) {
      this.log(`Error getting project sessions: ${error.message}`, 'ERROR');
    }

    // Method 4: Add Claude sessions without monitors (detected via process)
    // These are sessions where Claude is running but no transcript monitor has started yet
    // (e.g., user opened session but hasn't typed anything, or monitor crashed)
    for (const projectName of agentSessions) {
      // Skip if already found via other methods
      if (sessions[projectName]) continue;

      // This session has Claude running but no monitor - show as dormant (💤)
      // Not a warning (🟡) because having Claude open without a monitor is expected
      // for idle sessions - the Global Process Supervisor will restart it if needed
      sessions[projectName] = {
        status: 'no-monitor',
        icon: '💤',
        details: 'idle'
      };

      this.log(`Detected Claude session without monitor: ${projectName}`, 'DEBUG');
    }

    // ORPHAN CLEANUP: Remove sessions with stale transcripts ONLY if no agent is running
    // A stale transcript + no agent = truly orphaned monitor → remove
    // A stale transcript + agent running = freshly started session → keep as active
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    const cleanedSessions = {};

    for (const [projectName, sessionData] of Object.entries(sessions)) {
      const hasRunningAgent = agentSessions.has(projectName);

      // Never remove sessions with a running agent
      if (hasRunningAgent) {
        cleanedSessions[projectName] = sessionData;
        continue;
      }

      // Check health file for transcript age
      const projectPath = path.join(agenticDir, projectName);
      const healthFile = this.getCentralizedHealthFile(projectPath);

      if (fs.existsSync(healthFile)) {
        try {
          const healthData = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
          const transcriptAge = healthData.transcriptInfo?.ageMs || 0;
          // Fallback: if transcriptInfo is missing (e.g. stopped sessions), use health file timestamp
          const healthFileAge = healthData.timestamp ? Date.now() - healthData.timestamp : 0;
          const effectiveAge = transcriptAge > 0 ? transcriptAge : healthFileAge;

          // Remove orphaned sessions (stale transcript/health + no agent)
          if (effectiveAge > SIX_HOURS_MS) {
            this.log(`Filtering out orphaned session ${projectName} (effective age: ${Math.round(effectiveAge / 3600000)}h, no agent)`, 'DEBUG');
            continue;
          }

          // Also filter stopped sessions with stale health files
          if (healthData.status === 'stopped' && healthFileAge > SIX_HOURS_MS) {
            this.log(`Filtering out stopped session ${projectName} (stopped ${Math.round(healthFileAge / 3600000)}h ago, no agent)`, 'DEBUG');
            continue;
          }
        } catch (readError) {
          this.log(`Error reading health file for ${projectName}: ${readError.message}`, 'DEBUG');
        }
      }

      cleanedSessions[projectName] = sessionData;
    }

    // SHUTDOWN CLEANUP: Remove sessions where agent process has exited
    // When a user shuts down a coding session, it should disappear from the
    // statusline immediately — not linger as "cooling down" based on transcript age
    const liveSessions = {};
    for (const [projectName, sessionData] of Object.entries(cleanedSessions)) {
      const hasRunningAgent = agentSessions.has(projectName);

      if (hasRunningAgent) {
        // Agent is running — always keep
        liveSessions[projectName] = sessionData;
      } else if (sessionData.status === 'no-monitor') {
        // No-monitor sessions without a running agent should only persist briefly
        // If the health file shows "stopped" and is old, don't keep it
        const projectPath = path.join(agenticDir, projectName);
        const healthFile = this.getCentralizedHealthFile(projectPath);
        let keepSession = true;
        if (fs.existsSync(healthFile)) {
          try {
            const healthData = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
            const healthFileAge = healthData.timestamp ? Date.now() - healthData.timestamp : 0;
            if (healthData.status === 'stopped' && healthFileAge > 300000) { // 5 minutes
              keepSession = false;
              this.log(`Removed stale no-monitor session ${projectName} (stopped ${Math.round(healthFileAge / 60000)}min ago)`, 'DEBUG');
            }
          } catch { /* keep on error */ }
        }
        if (keepSession) {
          liveSessions[projectName] = sessionData;
        }
      } else {
        this.log(`Removed closed session ${projectName} from statusline (agent not running, was: ${sessionData.status})`, 'DEBUG');
      }
    }

    // AGENT AGE CAP: When agent is running, cap the displayed age at monitor uptime
    // This prevents a fresh session in a project with old transcripts from showing as dormant
    // The monitor uptime tracks how long this session has been active — use it as the age ceiling
    for (const [projectName, sessionData] of Object.entries(liveSessions)) {
      if (agentSessions.has(projectName) && sessionData.icon !== '🟢' && sessionData.icon !== '❌') {
        const projectPath = path.join(agenticDir, projectName);
        const healthFile = this.getCentralizedHealthFile(projectPath);
        try {
          if (fs.existsSync(healthFile)) {
            const healthData = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
            // Skip age cap for stopped monitors — their data is stale and would incorrectly
            // show 0ms age (= green) because transcript/uptime fields are missing
            if (healthData.status === 'stopped') {
              continue;
            }
            const uptimeMs = (healthData.metrics?.uptimeSeconds || 0) * 1000;
            const transcriptAge = healthData.transcriptInfo?.ageMs || 0;
            // Skip age cap when transcript is "not_found" — ageMs=0 means "no transcript",
            // not "active 0ms ago" (e.g., opencode without Claude-compatible transcripts)
            if (healthData.transcriptInfo?.status !== 'not_found') {
              // Use min(transcriptAge, monitorUptime) — uptime caps the age for fresh sessions
              const effectiveAge = Math.min(transcriptAge, uptimeMs);
              // Recalculate icon from effective age
              liveSessions[projectName] = this.iconFromAge(effectiveAge);
            }
          }
        } catch {
          // On error, keep existing session data
        }
      }
    }

    return liveSessions;
  }

  /**
   * Convert an age in ms to the graduated session icon/status
   */
  iconFromAge(age) {
    if (age < 300000) return { status: 'active', icon: '🟢', details: 'Active session' };
    if (age < 900000) return { status: 'cooling', icon: '🌲', details: 'Cooling down' };
    if (age < 3600000) return { status: 'fading', icon: '🫒', details: 'Session fading' };
    if (age < 21600000) return { status: 'dormant', icon: '🪨', details: 'Session dormant' };
    if (age < 86400000) return { status: 'inactive', icon: '⚫', details: 'Session inactive' };
    return { status: 'sleeping', icon: '💤', details: 'Session sleeping' };
  }

  /**
   * Parse ps etime format to milliseconds
   * Format: [[dd-]hh:]mm:ss (e.g. "14-03:25:30", "03:25:30", "25:30")
   */
  parseEtime(etime) {
    const match = etime.match(/(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)/);
    if (!match) return 0;
    const days = parseInt(match[1] || '0');
    const hours = parseInt(match[2] || '0');
    const minutes = parseInt(match[3] || '0');
    const seconds = parseInt(match[4] || '0');
    return ((days * 24 + hours) * 3600 + minutes * 60 + seconds) * 1000;
  }

  /**
   * Generate smart abbreviations for project names
   */
  getProjectAbbreviation(projectName) {
    // Handle common patterns and generate readable abbreviations
    const name = projectName.toLowerCase();

    // Known project mappings
    const knownMappings = {
      'coding': 'C',
      'curriculum-alignment': 'CA',
      'nano-degree': 'ND',
      'curriculum': 'CU',
      'alignment': 'AL',
      'nano': 'N',
      'ui-template': 'UT'
    };

    // Check for exact match first
    if (knownMappings[name]) {
      return knownMappings[name];
    }

    // Smart abbreviation generation
    if (name.includes('-')) {
      // Multi-word projects: take first letter of each word
      const parts = name.split('-');
      return parts.map(part => part.charAt(0).toUpperCase()).join('');
    } else if (name.includes('_')) {
      // Underscore separated: take first letter of each word
      const parts = name.split('_');
      return parts.map(part => part.charAt(0).toUpperCase()).join('');
    } else if (name.length <= 3) {
      // Short names: just uppercase
      return name.toUpperCase();
    } else {
      // Long single words: take first 2-3 characters intelligently
      if (name.length <= 6) {
        return name.substring(0, 2).toUpperCase();
      } else {
        // For longer words, try to find vowels/consonants pattern
        const consonants = name.match(/[bcdfghjklmnpqrstvwxyz]/g) || [];
        if (consonants.length >= 2) {
          return consonants.slice(0, 2).join('').toUpperCase();
        } else {
          return name.substring(0, 3).toUpperCase();
        }
      }
    }
  }

  /**
   * Convert health details/status to short reason codes for status line
   */
  getShortReason(details) {
    const text = (details || '').toLowerCase();

    // Map common reasons to short codes
    if (text.includes('not streaming')) return 'idle';
    if (text.includes('stale')) return 'stale';
    if (text.includes('too old')) return 'old';
    if (text.includes('inactive')) return 'sleep';
    if (text.includes('dormant')) return 'sleep';
    if (text.includes('exchanges')) return 'active';
    if (text.includes('warning')) return 'warn';
    if (text.includes('unhealthy')) return 'down';
    if (text.includes('error')) return 'err';

    // Default: first 5 chars
    return text.substring(0, 5);
  }

  /**
   * Get health for a specific project session
   */
  async getProjectSessionHealth(projectName, projectInfo) {
    try {
      // Check CENTRALIZED health file first (preferred - used by all modern monitors)
      const centralizedHealthFile = this.getCentralizedHealthFile(projectInfo.projectPath);
      if (fs.existsSync(centralizedHealthFile)) {
        return await this.getProjectSessionHealthFromFile(centralizedHealthFile, projectInfo.projectPath);
      }

      // Legacy fallback: check old project-local health file
      const legacyHealthFile = path.join(projectInfo.projectPath, '.transcript-monitor-health');
      if (fs.existsSync(legacyHealthFile)) {
        return await this.getProjectSessionHealthFromFile(legacyHealthFile, projectInfo.projectPath);
      }

      // Otherwise, check transcript activity as fallback
      // Compute Claude project directory dynamically
      const agenticDir = path.dirname(this.codingRepoPath);
      const escapedAgenticPath = agenticDir.replace(/\//g, '-').replace(/^-/, '');
      const claudeProjectDir = path.join(process.env.HOME, '.claude', 'projects', `-${escapedAgenticPath}-${projectName}`);

      if (fs.existsSync(claudeProjectDir)) {
        try {
          const transcriptFiles = fs.readdirSync(claudeProjectDir)
            .filter(file => file.endsWith('.jsonl'))
            .map(file => ({
              path: path.join(claudeProjectDir, file),
              stats: fs.statSync(path.join(claudeProjectDir, file))
            }))
            .sort((a, b) => b.stats.mtime - a.stats.mtime);

          if (transcriptFiles.length > 0) {
            const mostRecent = transcriptFiles[0];
            const age = Date.now() - mostRecent.stats.mtime.getTime();

            // Use graduated green shades for declining activity
            if (age < 300000) { // Active within 5 minutes
              return {
                status: 'active',
                icon: '🟢',
                details: 'Active session'
              };
            } else if (age < 900000) { // 5-15 minutes: cooling
              return {
                status: 'cooling',
                icon: '🌲',
                details: 'Cooling down'
              };
            } else if (age < 3600000) { // 15min - 1 hour: fading
              return {
                status: 'fading',
                icon: '🫒',
                details: 'Session fading'
              };
            } else if (age < 21600000) { // 1-6 hours: dormant
              return {
                status: 'dormant',
                icon: '🪨',
                details: 'Session dormant'
              };
            } else if (age < 86400000) { // 6-24 hours: inactive
              return {
                status: 'inactive',
                icon: '⚫',
                details: 'Session idle'
              };
            } else {
              return {
                status: 'sleeping',
                icon: '💤',
                details: 'Session sleeping'
              };
            }
          }
        } catch (transcriptError) {
          this.log(`Error checking transcripts for ${projectName}: ${transcriptError.message}`, 'DEBUG');
        }
      }

      // No health file and no transcripts found
      return await this.getProjectSessionHealthFromFile(healthFile, projectInfo.projectPath); // Will return 'No health file'
    } catch (error) {
      return {
        status: 'unknown',
        icon: '❓',
        details: 'Health check failed'
      };
    }
  }

  /**
   * Check trajectory status for a project
   */
  checkTrajectoryStatus(projectPath) {
    const trajectoryPath = path.join(projectPath, '.specstory', 'trajectory', 'live-state.json');

    if (!fs.existsSync(trajectoryPath)) {
      return { status: 'missing', age: null };
    }

    const stats = fs.statSync(trajectoryPath);
    const age = Date.now() - stats.mtime.getTime();
    const oneHour = 60 * 60 * 1000;

    if (age > oneHour) {
      return { status: 'stale', age };
    }

    return { status: 'fresh', age };
  }

  /**
   * Get health from a health file
   */
  async getProjectSessionHealthFromFile(healthFile, projectPath = null) {
    try {
      if (!fs.existsSync(healthFile)) {
        return {
          status: 'inactive',
          icon: '⚫',
          details: 'No health file'
        };
      }

      const healthData = JSON.parse(fs.readFileSync(healthFile, 'utf8'));

      // Check health file freshness - if file hasn't been updated in >5 min, the monitor isn't running
      const healthFileAge = Date.now() - healthData.timestamp;
      const isHealthFileStale = healthFileAge > 300000; // 5 minutes

      // Use transcript age (actual inactivity) when available, fall back to health check timestamp
      // But if health file is stale, use the health file age instead (more accurate)
      let age = healthData.transcriptInfo?.ageMs ?? healthFileAge;
      if (isHealthFileStale) {
        // Health file not being updated - use file age as minimum
        age = Math.max(age, healthFileAge);
      }

      // If no active transcript/session, show as inactive regardless of monitor state
      // (streamingActive only means the transcript monitor is running, not that a coding agent is active)
      if (healthData.transcriptInfo?.status === 'not_found' ||
          (healthData.transcriptPath === null && !healthData.streamingActive)) {
        return {
          status: 'inactive',
          icon: '⚫',
          details: 'No active session'
        };
      }

      // Check trajectory status if projectPath provided
      let trajectoryStatus = null;
      if (projectPath) {
        trajectoryStatus = this.checkTrajectoryStatus(projectPath);
      }

      // Determine health based on age and status
      // UNIFIED icon progression (same as getProjectSessionsHealth):
      // 🟢 Active (< 5 min) → 🌲 Cooling (5-15 min) → 🫒 Fading (15min-1h) →
      // 🪨 Dormant (1-6h) → ⚫ Inactive (6-24h) → 💤 Sleeping (>24h)
      if (age < 300000) { // < 5 minutes: Active
        // Check trajectory - downgrade to amber if missing/stale
        if (trajectoryStatus && trajectoryStatus.status !== 'fresh') {
          return {
            status: 'warning',
            icon: '🟡',
            details: trajectoryStatus.status === 'missing' ? 'no tr' : 'stale tr'
          };
        }

        // All active sessions (< 5 min) use 🟢 regardless of streaming state
        const details = healthData.status === 'running' && healthData.streamingActive
          ? `${healthData.activity?.exchangeCount || 0} exchanges`
          : 'Active session';

        return {
          status: 'active',
          icon: '🟢',
          details
        };
      } else if (age < 900000) { // 5min - 15min: Cooling (darker green)
        return {
          status: 'cooling',
          icon: '🌲',
          details: 'Cooling down'
        };
      } else if (age < 3600000) { // 15min - 1 hour: fading (dark green/olive)
        return {
          status: 'fading',
          icon: '🫒',
          details: 'Session fading'
        };
      } else if (age < 21600000) { // 1 hour - 6 hours: dormant but trackable (very dark)
        return {
          status: 'dormant',
          icon: '🪨',
          details: 'Session dormant'
        };
      } else if (age < 86400000) { // 6 hours - 24 hours: inactive (black)
        return {
          status: 'inactive',
          icon: '⚫',
          details: 'Session inactive (>6h)'
        };
      } else {
        // > 24 hours: sleeping
        return {
          status: 'sleeping',
          icon: '💤',
          details: 'Session sleeping (>24h)'
        };
      }
    } catch (error) {
      return {
        status: 'error',
        icon: '❌',
        details: 'Health file corrupted'
      };
    }
  }

  /**
   * Get MCP Constraint Monitor (guardrails) health
   */
  async getConstraintMonitorHealthDocker() {
    try {
      const ssePort = 3849; // Constraint monitor SSE port in Docker
      const response = await Promise.race([
        execAsync(`curl -s http://localhost:${ssePort}/health --max-time 3`),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3500))
      ]);
      const data = JSON.parse(response.stdout.trim());
      if (data.status === 'ok') {
        return {
          status: 'healthy',
          icon: '✅',
          details: `Docker SSE port ${ssePort} healthy`
        };
      }
      return {
        status: 'warning',
        icon: '🟡',
        details: `Docker SSE port ${ssePort}: ${data.status || 'unknown'}`
      };
    } catch (error) {
      return {
        status: 'warning',
        icon: '🟡',
        details: 'Docker constraint monitor SSE (3849) not responding'
      };
    }
  }

    async getConstraintMonitorHealth() {
    try {
      // In Docker mode, constraint monitor runs on SSE port 3849 inside the container
      // Native mode uses dashboard port 3030 and API port 3031
      if (this.isDockerMode()) {
        return this.getConstraintMonitorHealthDocker();
      }

      // Enhanced health checking with port connectivity, compilation errors, and CPU monitoring
      const dashboardPort = 3030; // From .env.ports: CONSTRAINT_DASHBOARD_PORT
      const apiPort = 3031;       // From .env.ports: CONSTRAINT_API_PORT

      // Check process existence and CPU usage (with fallback for no processes)
      let psOutput = '';
      try {
        const result = await execAsync('ps aux | grep "constraint-monitor\\|dashboard.*next\\|constraint.*api" | grep -v grep || true');
        psOutput = result.stdout;
      } catch (grepError) {
        // grep returns exit code 1 when no matches found, that's ok
        psOutput = '';
      }
      const processes = psOutput.trim().split('\n').filter(line => line.length > 0);
      
      let processHealth = {
        running: processes.length > 0,
        highCpu: false,
        details: []
      };
      
      // Analyze CPU usage for stuck processes
      for (const processLine of processes) {
        const parts = processLine.trim().split(/\s+/);
        if (parts.length >= 3) {
          const cpuUsage = parseFloat(parts[2]) || 0;
          const pid = parts[1];
          if (cpuUsage > 50) { // High CPU threshold
            processHealth.highCpu = true;
            processHealth.details.push(`PID ${pid}: ${cpuUsage}% CPU`);
          }
        }
      }
      
      // Test port connectivity
      let portHealth = {
        dashboard: false,
        api: false
      };
      
      try {
        // Quick HTTP connectivity test for dashboard
        const dashboardResponse = await Promise.race([
          execAsync(`curl -s -o /dev/null -w "%{http_code}" http://localhost:${dashboardPort} --max-time 3`),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ]);
        const dashboardStatus = parseInt(dashboardResponse.stdout.trim());
        portHealth.dashboard = dashboardStatus >= 200 && dashboardStatus < 500;
      } catch (error) {
        // Dashboard port not responding
        portHealth.dashboard = false;
      }
      
      // Enhanced API check: get full health response including enforcement status
      let enforcementHealth = {
        checked: false,
        healthy: null,
        message: null
      };

      try {
        // Fetch full health response with enforcement details
        const apiResponse = await Promise.race([
          execAsync(`curl -s http://localhost:${apiPort}/api/health --max-time 3`),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ]);

        if (apiResponse.stdout.trim()) {
          try {
            const healthData = JSON.parse(apiResponse.stdout.trim());
            portHealth.api = true; // API responded

            // Extract enforcement status
            if (healthData.enforcement) {
              enforcementHealth.checked = true;
              enforcementHealth.healthy = healthData.enforcement.healthy;
              enforcementHealth.message = healthData.enforcement.message;
            }
          } catch (parseError) {
            // Not JSON, but API responded
            portHealth.api = true;
          }
        }
      } catch (error) {
        // API port not responding
        portHealth.api = false;
      }

      // Check for compilation errors in dashboard logs
      let compilationHealth = {
        hasErrors: false,
        errorDetails: ''
      };

      try {
        // Check recent log files for TypeScript/Next.js compilation errors
        const logCheckPath = path.join(this.codingRepoPath, 'integrations/mcp-constraint-monitor/dashboard');
        const buildCheck = await execAsync(`cd "${logCheckPath}" 2>/dev/null && grep -l "Parsing ecmascript\\|Expression expected\\|Module not found\\|Type error\\|Build error" .next/server/*.js 2>/dev/null | head -1`);

        if (buildCheck.stdout.trim()) {
          compilationHealth.hasErrors = true;
          compilationHealth.errorDetails = 'TypeScript compilation errors detected';
        }
      } catch (error) {
        // No compilation errors found (grep returns 1 when no matches)
        compilationHealth.hasErrors = false;
      }

      // Also check if dashboard responds with actual content (not error page)
      if (portHealth.dashboard && !compilationHealth.hasErrors) {
        try {
          const contentCheck = await execAsync(`curl -s http://localhost:${dashboardPort} --max-time 3 | grep -q "Constraint Monitor" && echo "ok" || echo "error"`);
          if (contentCheck.stdout.trim() === 'error') {
            compilationHealth.hasErrors = true;
            compilationHealth.errorDetails = 'Dashboard returning error page';
          }
        } catch (error) {
          // Ignore content check errors
        }
      }

      // Determine overall health status
      let healthResult;

      if (!processHealth.running) {
        healthResult = {
          status: 'inactive',
          icon: '⚫',
          details: 'Constraint monitor offline'
        };
      } else if (compilationHealth.hasErrors) {
        healthResult = {
          status: 'compilation_error',
          icon: '🔴',
          details: compilationHealth.errorDetails || 'Compilation errors detected'
        };
      } else if (processHealth.highCpu) {
        healthResult = {
          status: 'stuck',
          icon: '🔴',
          details: `High CPU usage: ${processHealth.details.join(', ')}`
        };
      } else if (!portHealth.dashboard && !portHealth.api) {
        healthResult = {
          status: 'unresponsive',
          icon: '🔴',
          details: 'Ports 3030,3031 unresponsive'
        };
      } else if (!portHealth.dashboard || !portHealth.api) {
        const failedPorts = [];
        if (!portHealth.dashboard) failedPorts.push('3030');
        if (!portHealth.api) failedPorts.push('3031');

        healthResult = {
          status: 'degraded',
          icon: '🟡',
          details: `Port ${failedPorts.join(',')} down`
        };
      } else if (enforcementHealth.checked && enforcementHealth.healthy === false) {
        // Ports responsive BUT enforcement is broken - this is a critical issue!
        healthResult = {
          status: 'enforcement_broken',
          icon: '🟡',
          reason: 'enf',
          details: enforcementHealth.message || 'Constraint enforcement not working'
        };
      } else {
        // All checks passed including enforcement
        healthResult = {
          status: 'healthy',
          icon: '✅',
          details: 'Ports 3030,3031 responsive, enforcement active'
        };
      }
      
      // Trigger auto-healing for unhealthy states
      if (this.autoHealEnabled && ['inactive', 'stuck', 'unresponsive', 'degraded'].includes(healthResult.status)) {
        this.log(`Detected unhealthy constraint monitor: ${healthResult.status}`, 'WARN');
        
        // Run auto-healing asynchronously to not block health check
        setImmediate(async () => {
          const healed = await this.autoHealConstraintMonitor(healthResult);
          if (healed) {
            this.log(`🎉 Constraint monitor auto-healed successfully`, 'INFO');
          }
        });
      }
      
      return healthResult;
      
    } catch (error) {
      this.log(`Constraint monitor health check error: ${error.message}`, 'DEBUG');
      return {
        status: 'unknown',
        icon: '❓',
        details: 'Health check failed'
      };
    }
  }

  /**
   * Get Database (GraphDB + LevelDB) health status
   */
  async getDatabaseHealth() {
    try {
      const graphDbPath = path.join(this.codingRepoPath, '.data', 'knowledge-graph');
      const sqlitePath = path.join(this.codingRepoPath, '.data', 'knowledge.db');

      let healthIssues = [];
      let healthStatus = 'healthy';

      // Check if GraphDB directory exists
      if (!fs.existsSync(graphDbPath)) {
        healthIssues.push('GraphDB missing');
        healthStatus = 'unhealthy';
      } else {
        // Check for LevelDB files - MANIFEST files have version suffix (e.g., MANIFEST-000332)
        const levelDbFiles = ['CURRENT', 'LOCK', 'LOG'];
        const missingFiles = levelDbFiles.filter(file => !fs.existsSync(path.join(graphDbPath, file)));

        // Check for MANIFEST-* file separately (it has a version suffix)
        const files = fs.readdirSync(graphDbPath);
        const hasManifest = files.some(f => f.startsWith('MANIFEST-'));
        if (!hasManifest) {
          missingFiles.push('MANIFEST-*');
        }

        if (missingFiles.length > 0) {
          healthIssues.push('LevelDB incomplete');
          healthStatus = 'warning';
        }

        // NOTE: Removed "stale lock" check based on LOCK file age.
        // The LOCK file age does NOT indicate data staleness - it only shows when the database
        // was last accessed. A database can be perfectly healthy even if not accessed for weeks.
        // User feedback: "I might not run this for weeks... doesn't mean we are in a 'stale data' state."
      }

      // Check SQLite database
      if (!fs.existsSync(sqlitePath)) {
        healthIssues.push('SQLite missing');
        if (healthStatus === 'healthy') healthStatus = 'warning';
      }

      // Check LevelDB accessibility by verifying LOCK file is not held by a dead process
      try {
        const lockFile = path.join(graphDbPath, 'LOCK');
        if (fs.existsSync(lockFile)) {
          // LOCK file exists - database has been used, which is a good sign
          // No need to check if it's held by another process here (health-verifier does that)
        }
      } catch (lockError) {
        // Ignore lock check errors
      }

      // Determine icon and details
      let icon, details;
      if (healthStatus === 'healthy') {
        icon = '✅';
        details = 'GraphDB + SQLite OK';
      } else if (healthStatus === 'warning') {
        icon = '🟡';
        details = healthIssues.join(', ');
      } else {
        icon = '🔴';
        details = healthIssues.join(', ');
      }

      return {
        status: healthStatus,
        icon: icon,
        details: details
      };

    } catch (error) {
      this.log(`Database health check error: ${error.message}`, 'DEBUG');
      return {
        status: 'unknown',
        icon: '❓',
        details: 'Health check failed'
      };
    }
  }

  /**
   * Get VKB Server health status
   */
  async getVKBServerHealth() {
    try {
      const vkbPort = 8080;
      const distPath = path.join(this.codingRepoPath, 'integrations', 'memory-visualizer', 'dist', 'index.html');

      let healthIssues = [];
      let healthStatus = 'healthy';

      // Check if dist/index.html exists
      if (!fs.existsSync(distPath)) {
        healthIssues.push('React app not built');
        healthStatus = 'unhealthy';
      }

      // Check if VKB server is listening on port 8080
      try {
        const portCheck = await execAsync(`lsof -i :${vkbPort} -sTCP:LISTEN | grep -q LISTEN && echo "listening" || echo "not_listening"`, {
          timeout: 2000,
          encoding: 'utf8'
        });

        if (!portCheck.stdout.includes('listening')) {
          healthIssues.push('Port 8080 down');
          healthStatus = 'unhealthy';
        } else {
          // Port is listening - check if it responds
          try {
            const response = await Promise.race([
              execAsync(`curl -s -o /dev/null -w "%{http_code}" http://localhost:${vkbPort}/ --max-time 2`),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
            ]);

            const statusCode = parseInt(response.stdout.trim());
            if (statusCode >= 200 && statusCode < 400) {
              // Server responding - but also check if graphDB is healthy
              try {
                const apiHealth = await execAsync(`curl -s http://localhost:${vkbPort}/api/health --max-time 2`);
                const healthData = JSON.parse(apiHealth.stdout);
                if (healthData.graph === false) {
                  healthIssues.push('GraphDB unavailable');
                  healthStatus = 'unhealthy';
                } else if (healthStatus === 'healthy') {
                  healthIssues = []; // Clear any issues if server is fully working
                }
              } catch (apiError) {
                // API check failed but HTTP works - warning state
                healthIssues.push('API health check failed');
                healthStatus = 'warning';
              }
            } else if (statusCode === 404 && fs.existsSync(distPath)) {
              healthIssues.push('404 despite dist exists');
              healthStatus = 'warning';
            } else if (statusCode >= 500) {
              healthIssues.push('Server error');
              healthStatus = 'unhealthy';
            }
          } catch (curlError) {
            healthIssues.push('No response');
            healthStatus = 'unhealthy';
          }
        }
      } catch (portError) {
        healthIssues.push('Port check failed');
        healthStatus = 'warning';
      }

      // Determine icon and details
      let icon, details;
      if (healthStatus === 'healthy') {
        icon = '✅';
        details = 'VKB :8080 OK';
      } else if (healthStatus === 'warning') {
        icon = '🟡';
        details = healthIssues.join(', ');
      } else {
        icon = '🔴';
        details = healthIssues.join(', ');
      }

      const healthResult = {
        status: healthStatus,
        icon: icon,
        details: details
      };

      // Trigger auto-healing for unhealthy VKB server
      if (this.autoHealEnabled && healthStatus === 'unhealthy') {
        this.log(`Detected unhealthy VKB server: ${healthResult.details}`, 'WARN');

        // Run auto-healing asynchronously to not block health check
        setImmediate(async () => {
          const healed = await this.autoHealVKBServer(healthResult);
          if (healed) {
            this.log(`🎉 VKB server auto-healed successfully`, 'INFO');
          }
        });
      }

      return healthResult;

    } catch (error) {
      this.log(`VKB server health check error: ${error.message}`, 'DEBUG');
      return {
        status: 'unknown',
        icon: '❓',
        details: 'Health check failed'
      };
    }
  }

  /**
   * Get Browser Access SSE Server health status
   * Monitors the shared MCP server for parallel Claude sessions
   */
  async getBrowserAccessHealth() {
    try {
      const browserAccessPort = 3847;
      let healthIssues = [];
      let healthStatus = 'healthy';

      // Check if the SSE server is listening on port 3847
      try {
        const portCheck = await execAsync(`lsof -i :${browserAccessPort} -sTCP:LISTEN | grep -q LISTEN && echo "listening" || echo "not_listening"`, {
          timeout: 2000,
          encoding: 'utf8'
        });

        if (!portCheck.stdout.includes('listening')) {
          // Server not running - this is acceptable if browser automation not needed
          return {
            status: 'inactive',
            icon: '⚪',
            details: 'SSE server not running (optional)'
          };
        }

        // Port is listening - check health endpoint
        try {
          const healthResponse = await Promise.race([
            execAsync(`curl -s http://localhost:${browserAccessPort}/health --max-time 3`),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
          ]);

          const healthData = JSON.parse(healthResponse.stdout.trim());

          if (healthData.status === 'ok') {
            const sessions = healthData.sessions || 0;
            const stagehandInit = healthData.stagehandInitialized ? 'yes' : 'no';
            return {
              status: 'healthy',
              icon: '✅',
              details: `SSE :3847 OK (${sessions} sessions, stagehand: ${stagehandInit})`
            };
          } else {
            healthIssues.push('Health endpoint returned error');
            healthStatus = 'warning';
          }
        } catch (healthError) {
          if (healthError.message === 'timeout') {
            healthIssues.push('Health timeout');
            healthStatus = 'warning';
          } else {
            healthIssues.push('Health check failed');
            healthStatus = 'warning';
          }
        }
      } catch (portError) {
        healthIssues.push('Port check failed');
        healthStatus = 'warning';
      }

      // Determine icon and details
      let icon, details;
      if (healthStatus === 'healthy') {
        icon = '✅';
        details = 'Browser SSE OK';
      } else if (healthStatus === 'warning') {
        icon = '🟡';
        details = healthIssues.join(', ');
      } else {
        icon = '🔴';
        details = healthIssues.join(', ');
      }

      return {
        status: healthStatus,
        icon: icon,
        details: details
      };

    } catch (error) {
      this.log(`Browser access health check error: ${error.message}`, 'DEBUG');
      return {
        status: 'unknown',
        icon: '❓',
        details: 'Health check failed'
      };
    }
  }

  /**
   * Check if running in Docker mode
   * Docker mode is detected by:
   * - CODING_DOCKER_MODE environment variable
   * - .docker-mode marker file
   * - running coding-services container
   */
  isDockerMode() {
    // Check environment variable
    if (process.env.CODING_DOCKER_MODE === 'true') {
      return true;
    }
    // Check marker file
    const markerFile = path.join(this.codingRepoPath, '.docker-mode');
    if (fs.existsSync(markerFile)) {
      return true;
    }
    return false;
  }

  /**
   * Get Semantic Analysis SSE Server health status (Docker mode)
   * Monitors the semantic-analysis MCP SSE server on port 3848
   */
  async getSemanticAnalysisSSEHealth() {
    try {
      const port = parseInt(process.env.SEMANTIC_ANALYSIS_SSE_PORT || '3848', 10);

      // Check health endpoint
      try {
        const healthResponse = await Promise.race([
          execAsync(`curl -s http://localhost:${port}/health --max-time 3`),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3500))
        ]);

        const healthData = JSON.parse(healthResponse.stdout.trim());

        if (healthData.status === 'ok' || healthData.status === 'healthy') {
          return {
            status: 'healthy',
            icon: '✅',
            details: `SSE :${port} OK`
          };
        } else {
          return {
            status: 'warning',
            icon: '🟡',
            details: `SSE :${port} ${healthData.status}`
          };
        }
      } catch (healthError) {
        // Check if port is at least listening
        try {
          const portCheck = await execAsync(`lsof -i :${port} -sTCP:LISTEN | grep -q LISTEN && echo "listening" || echo "not_listening"`, {
            timeout: 2000
          });
          if (portCheck.stdout.includes('listening')) {
            return {
              status: 'warning',
              icon: '🟡',
              details: `SSE :${port} no health response`
            };
          }
        } catch (portCheckError) {
          this.log(`Port check error for semantic-analysis: ${portCheckError.message}`, 'DEBUG');
        }

        return {
          status: 'inactive',
          icon: '⚪',
          details: `SSE :${port} not running`
        };
      }
    } catch (error) {
      this.log(`Semantic Analysis SSE health check error: ${error.message}`, 'DEBUG');
      return {
        status: 'unknown',
        icon: '❓',
        details: 'Health check failed'
      };
    }
  }

  /**
   * Get Constraint Monitor SSE Server health status (Docker mode)
   * Monitors the constraint-monitor MCP SSE server on port 3849
   */
  async getConstraintMonitorSSEHealth() {
    try {
      const port = parseInt(process.env.CONSTRAINT_MONITOR_SSE_PORT || '3849', 10);

      // Check if port is listening (SSE server may not have a separate health endpoint)
      try {
        const portCheck = await execAsync(`lsof -i :${port} -sTCP:LISTEN | grep -q LISTEN && echo "listening" || echo "not_listening"`, {
          timeout: 2000
        });

        if (portCheck.stdout.includes('listening')) {
          // Try health endpoint if available
          try {
            const healthResponse = await Promise.race([
              execAsync(`curl -s http://localhost:${port}/health --max-time 2`),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500))
            ]);
            const healthData = JSON.parse(healthResponse.stdout.trim());
            if (healthData.status === 'ok' || healthData.status === 'healthy') {
              return {
                status: 'healthy',
                icon: '✅',
                details: `SSE :${port} OK`
              };
            }
          } catch (healthEndpointError) {
            // No health endpoint, but port is listening - log for debugging
            this.log(`Constraint monitor SSE has no health endpoint (port listening): ${healthEndpointError.message}`, 'DEBUG');
          }

          return {
            status: 'healthy',
            icon: '✅',
            details: `SSE :${port} listening`
          };
        } else {
          return {
            status: 'inactive',
            icon: '⚪',
            details: `SSE :${port} not running`
          };
        }
      } catch (error) {
        return {
          status: 'inactive',
          icon: '⚪',
          details: `SSE :${port} not running`
        };
      }
    } catch (error) {
      this.log(`Constraint Monitor SSE health check error: ${error.message}`, 'DEBUG');
      return {
        status: 'unknown',
        icon: '❓',
        details: 'Health check failed'
      };
    }
  }

  /**
   * Get Code Graph RAG SSE Server health status (Docker mode)
   * Monitors the code-graph-rag MCP SSE server on port 3850
   */
  async getCodeGraphRAGSSEHealth() {
    try {
      const port = parseInt(process.env.CODE_GRAPH_RAG_SSE_PORT || '3850', 10);

      // Check health endpoint
      try {
        const healthResponse = await Promise.race([
          execAsync(`curl -s http://localhost:${port}/health --max-time 3`),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3500))
        ]);

        const healthData = JSON.parse(healthResponse.stdout.trim());

        if (healthData.status === 'ok' || healthData.status === 'healthy') {
          return {
            status: 'healthy',
            icon: '✅',
            details: `SSE :${port} OK`
          };
        } else {
          return {
            status: 'warning',
            icon: '🟡',
            details: `SSE :${port} ${healthData.status}`
          };
        }
      } catch (healthError) {
        // Check if port is at least listening
        try {
          const portCheck = await execAsync(`lsof -i :${port} -sTCP:LISTEN | grep -q LISTEN && echo "listening" || echo "not_listening"`, {
            timeout: 2000
          });
          if (portCheck.stdout.includes('listening')) {
            return {
              status: 'warning',
              icon: '🟡',
              details: `SSE :${port} no health response`
            };
          }
        } catch (portCheckError) {
          this.log(`Port check error for code-graph-rag: ${portCheckError.message}`, 'DEBUG');
        }

        return {
          status: 'inactive',
          icon: '⚪',
          details: `SSE :${port} not running`
        };
      }
    } catch (error) {
      this.log(`Code Graph RAG SSE health check error: ${error.message}`, 'DEBUG');
      return {
        status: 'unknown',
        icon: '❓',
        details: 'Health check failed'
      };
    }
  }

  /**
   * Get all Docker MCP SSE server health statuses
   * Returns combined health for semantic-analysis, constraint-monitor, code-graph-rag
   */
  async getDockerMCPHealth() {
    if (!this.isDockerMode()) {
      return null; // Not in Docker mode, skip these checks
    }

    const [saHealth, cmHealth, cgrHealth] = await Promise.all([
      this.getSemanticAnalysisSSEHealth(),
      this.getConstraintMonitorSSEHealth(),
      this.getCodeGraphRAGSSEHealth()
    ]);

    // Combine statuses
    const allHealthy = [saHealth, cmHealth, cgrHealth].every(h => h.status === 'healthy');
    const anyUnhealthy = [saHealth, cmHealth, cgrHealth].some(h => h.status === 'unhealthy' || h.status === 'warning');
    const allInactive = [saHealth, cmHealth, cgrHealth].every(h => h.status === 'inactive');

    let overallStatus, overallIcon;
    if (allInactive) {
      overallStatus = 'inactive';
      overallIcon = '⚪';
    } else if (allHealthy) {
      overallStatus = 'healthy';
      overallIcon = '✅';
    } else if (anyUnhealthy) {
      overallStatus = 'warning';
      overallIcon = '🟡';
    } else {
      overallStatus = 'healthy';
      overallIcon = '✅';
    }

    return {
      status: overallStatus,
      icon: overallIcon,
      details: `SA:${saHealth.icon} CM:${cmHealth.icon} CGR:${cgrHealth.icon}`,
      individual: { semantic: saHealth, constraint: cmHealth, codeGraph: cgrHealth }
    };
  }

  /**
   * Get System Health Dashboard health status
   * Monitors the health dashboard UI (3032) and API (3033)
   */
  async getHealthDashboardHealth() {
    try {
      const uiPort = 3032;
      const apiPort = 3033;
      let healthIssues = [];
      let healthStatus = 'healthy';

      // Check UI port (3032)
      let uiResponding = false;
      try {
        const uiCheck = await Promise.race([
          execAsync(`curl -s -o /dev/null -w "%{http_code}" http://localhost:${uiPort} --max-time 2`),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500))
        ]);
        const uiStatus = parseInt(uiCheck.stdout.trim());
        uiResponding = uiStatus >= 200 && uiStatus < 500;
      } catch (error) {
        uiResponding = false;
      }

      // Check API port (3033)
      let apiResponding = false;
      try {
        const apiCheck = await Promise.race([
          execAsync(`curl -s http://localhost:${apiPort}/api/health --max-time 2`),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500))
        ]);
        const apiData = JSON.parse(apiCheck.stdout.trim());
        apiResponding = apiData.status === 'success';
      } catch (error) {
        apiResponding = false;
      }

      // Determine overall health
      if (!uiResponding && !apiResponding) {
        return {
          status: 'unhealthy',
          icon: '🔴',
          details: 'Dashboard offline (UI:3032, API:3033)'
        };
      } else if (!uiResponding) {
        return {
          status: 'warning',
          icon: '🟡',
          details: 'Dashboard UI down (3032)'
        };
      } else if (!apiResponding) {
        return {
          status: 'warning',
          icon: '🟡',
          details: 'Dashboard API down (3033)'
        };
      }

      return {
        status: 'healthy',
        icon: '✅',
        details: 'Dashboard OK (UI:3032, API:3033)'
      };

    } catch (error) {
      this.log(`Health dashboard check error: ${error.message}`, 'DEBUG');
      return {
        status: 'unknown',
        icon: '❓',
        details: 'Health check failed'
      };
    }
  }

  /**
   * Auto-heal constraint monitor service when issues are detected
   */
  async autoHealConstraintMonitor(healthStatus) {
    if (!this.autoHealEnabled) return false;

    // Skip auto-healing in Docker mode - services run in containers, not native
    if (this.isDockerMode()) {
      this.log('🐳 Auto-healing SKIPPED for constraint-monitor - Docker mode active (services run in containers)', 'INFO');
      return false;
    }

    // Skip auto-healing during Docker mode transition
    if (this.monitoringPaused) {
      this.log('⏸️  Auto-healing SKIPPED for constraint-monitor - Docker mode transition in progress', 'INFO');
      return false;
    }

    // Also check lock file directly (in case signal was missed)
    try {
      const transitionLocked = await isTransitionLocked();
      if (transitionLocked) {
        this.log('🔒 Auto-healing SKIPPED for constraint-monitor - transition lock detected', 'INFO');
        return false;
      }
    } catch {
      // Continue if check fails (fail open)
    }

    const serviceKey = 'constraint-monitor';
    const now = Date.now();
    
    // Check if we're in cooldown period
    const lastHeal = this.lastHealingTime.get(serviceKey) || 0;
    if (now - lastHeal < this.healingCooldown) {
      this.log(`Auto-heal cooldown for ${serviceKey}, waiting ${Math.round((this.healingCooldown - (now - lastHeal)) / 1000)}s`, 'DEBUG');
      return false;
    }
    
    // Check if we've exceeded max attempts
    const attempts = this.healingAttempts.get(serviceKey) || 0;
    if (attempts >= this.maxHealingAttempts) {
      this.log(`Max healing attempts (${this.maxHealingAttempts}) reached for ${serviceKey}`, 'ERROR');
      return false;
    }
    
    let healed = false;
    
    try {
      this.log(`🔧 Auto-healing constraint monitor (status: ${healthStatus.status})`, 'INFO');
      
      // Different healing strategies based on the issue
      switch (healthStatus.status) {
        case 'stuck':
          // High CPU - kill and restart
          this.log('Detected stuck process with high CPU, killing and restarting...', 'INFO');
          await this.killConstraintMonitorProcesses();
          await this.startConstraintMonitorServices();
          healed = true;
          break;
          
        case 'unresponsive':
        case 'degraded':
          // Ports not responding - try graceful restart first
          this.log('Services unresponsive, attempting graceful restart...', 'INFO');
          await this.restartConstraintMonitorGracefully();
          healed = true;
          break;
          
        case 'inactive':
        case 'down':
          // Not running - start services
          this.log('Services not running, starting...', 'INFO');
          await this.startConstraintMonitorServices();
          healed = true;
          break;
          
        default:
          this.log(`No auto-heal action for status: ${healthStatus.status}`, 'DEBUG');
          return false;
      }
      
      if (healed) {
        // Update tracking
        this.healingAttempts.set(serviceKey, attempts + 1);
        this.lastHealingTime.set(serviceKey, now);
        
        // Wait a bit for services to stabilize
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Verify healing worked
        const newHealth = await this.getConstraintMonitorHealth();
        if (newHealth.status === 'healthy') {
          this.log(`✅ Auto-healing successful! Constraint monitor is now healthy`, 'INFO');
          // Reset attempts on successful heal
          this.healingAttempts.set(serviceKey, 0);
          return true;
        } else {
          this.log(`⚠️ Auto-healing completed but service still unhealthy: ${newHealth.status}`, 'WARN');
          return false;
        }
      }
    } catch (error) {
      this.log(`Auto-healing failed: ${error.message}`, 'ERROR');
      this.healingAttempts.set(serviceKey, attempts + 1);
      this.lastHealingTime.set(serviceKey, now);
      return false;
    }
    
    return false;
  }
  
  /**
   * Kill constraint monitor processes forcefully
   */
  async killConstraintMonitorProcesses() {
    try {
      // Kill all constraint monitor related processes
      await execAsync('pkill -f "constraint-monitor" || true');
      await execAsync('pkill -f "dashboard.*next.*3030" || true');
      await execAsync('lsof -ti:3030,3031 | xargs kill -9 2>/dev/null || true');
      
      this.log('Killed constraint monitor processes', 'INFO');
      
      // Wait for processes to fully terminate
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      this.log(`Error killing processes: ${error.message}`, 'WARN');
    }
  }
  
  /**
   * Start constraint monitor services
   */
  async startConstraintMonitorServices() {
    try {
      const monitorPath = path.join(this.codingRepoPath, 'integrations', 'mcp-constraint-monitor');
      
      // Start dashboard on port 3030
      this.log('Starting constraint monitor dashboard on port 3030...', 'INFO');
      execAsync(`cd "${monitorPath}" && PORT=3030 npm run dashboard > /dev/null 2>&1 &`).catch(err => {
        this.log(`Dashboard start error (non-critical): ${err.message}`, 'DEBUG');
      });
      
      // Start API on port 3031 if needed
      this.log('Starting constraint monitor API on port 3031...', 'INFO');
      execAsync(`cd "${monitorPath}" && PORT=3031 npm run api > /dev/null 2>&1 &`).catch(err => {
        this.log(`API start error (non-critical): ${err.message}`, 'DEBUG');
      });
      
      this.log('Constraint monitor services start initiated', 'INFO');
    } catch (error) {
      this.log(`Error starting services: ${error.message}`, 'ERROR');
      throw error;
    }
  }
  
  /**
   * Gracefully restart constraint monitor
   */
  async restartConstraintMonitorGracefully() {
    try {
      this.log('Attempting graceful restart of constraint monitor...', 'INFO');
      
      // Try to stop gracefully first
      await execAsync('pkill -SIGTERM -f "constraint-monitor" || true');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Force kill if still running
      const { stdout } = await execAsync('pgrep -f "constraint-monitor" || true');
      if (stdout.trim()) {
        this.log('Processes still running after SIGTERM, forcing kill...', 'INFO');
        await this.killConstraintMonitorProcesses();
      }
      
      // Start services
      await this.startConstraintMonitorServices();
      
      this.log('Graceful restart completed', 'INFO');
    } catch (error) {
      this.log(`Graceful restart failed: ${error.message}`, 'ERROR');
      throw error;
    }
  }

  /**
   * Auto-heal VKB server when issues are detected
   */
  async autoHealVKBServer(healthStatus) {
    if (!this.autoHealEnabled) return false;

    // Skip auto-healing in Docker mode - services run in containers, not native
    if (this.isDockerMode()) {
      this.log('🐳 Auto-healing SKIPPED for VKB server - Docker mode active (services run in containers)', 'INFO');
      return false;
    }

    // Skip auto-healing during Docker mode transition
    if (this.monitoringPaused) {
      this.log('⏸️  Auto-healing SKIPPED for VKB server - Docker mode transition in progress', 'INFO');
      return false;
    }

    // Also check lock file directly (in case signal was missed)
    try {
      const transitionLocked = await isTransitionLocked();
      if (transitionLocked) {
        this.log('🔒 Auto-healing SKIPPED for VKB server - transition lock detected', 'INFO');
        return false;
      }
    } catch {
      // Continue if check fails (fail open)
    }

    const serviceKey = 'vkb-server';
    const now = Date.now();

    // Check if we're in cooldown period
    const lastHeal = this.lastHealingTime.get(serviceKey) || 0;
    if (now - lastHeal < this.healingCooldown) {
      this.log(`Auto-heal cooldown for ${serviceKey}, waiting ${Math.round((this.healingCooldown - (now - lastHeal)) / 1000)}s`, 'DEBUG');
      return false;
    }

    // Check if we've exceeded max attempts
    const attempts = this.healingAttempts.get(serviceKey) || 0;
    if (attempts >= this.maxHealingAttempts) {
      this.log(`Max healing attempts (${this.maxHealingAttempts}) reached for ${serviceKey}`, 'ERROR');
      return false;
    }

    let healed = false;

    try {
      this.log(`🔧 Auto-healing VKB server (issue: ${healthStatus.details})`, 'INFO');

      // VKB healing strategy: kill any stale processes on port 8080 and restart
      await this.restartVKBServer();
      healed = true;

      if (healed) {
        // Update tracking
        this.healingAttempts.set(serviceKey, attempts + 1);
        this.lastHealingTime.set(serviceKey, now);

        // Wait a bit for server to stabilize
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Verify healing worked
        const newHealth = await this.getVKBServerHealth();
        if (newHealth.status === 'healthy') {
          this.log(`✅ Auto-healing successful! VKB server is now healthy`, 'INFO');
          // Reset attempts on successful heal
          this.healingAttempts.set(serviceKey, 0);
          return true;
        } else {
          this.log(`⚠️ Auto-healing completed but VKB server still unhealthy: ${newHealth.details}`, 'WARN');
          return false;
        }
      }
    } catch (error) {
      this.log(`VKB auto-healing failed: ${error.message}`, 'ERROR');
      this.healingAttempts.set(serviceKey, attempts + 1);
      this.lastHealingTime.set(serviceKey, now);
      return false;
    }

    return false;
  }

  /**
   * Restart VKB server
   */
  async restartVKBServer() {
    try {
      this.log('Stopping any existing VKB server processes...', 'INFO');

      // Gracefully stop VKB first (allows LevelDB to close properly)
      const vkbStopScript = path.join(this.codingRepoPath, 'bin', 'vkb');
      try {
        await execAsync(`"${vkbStopScript}" stop`, { timeout: 5000 });
      } catch (stopErr) {
        this.log('Graceful stop failed, trying SIGTERM...', 'DEBUG');
      }

      // Give graceful shutdown time, then SIGTERM (not SIGKILL)
      await new Promise(resolve => setTimeout(resolve, 2000));
      await execAsync('lsof -ti:8080 | xargs kill -15 2>/dev/null || true');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Only force kill if still running
      await execAsync('lsof -ti:8080 | xargs kill -9 2>/dev/null || true');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Use the bin/vkb script to start the server properly
      const vkbScript = path.join(this.codingRepoPath, 'bin', 'vkb');

      this.log('Starting VKB server via bin/vkb...', 'INFO');

      // Start VKB in background (--no-browser to prevent opening windows on auto-heal)
      execAsync(`"${vkbScript}" start --no-browser`).catch(err => {
        this.log(`VKB start error (non-critical): ${err.message}`, 'DEBUG');
      });

      this.log('VKB server restart initiated', 'INFO');
    } catch (error) {
      this.log(`Error restarting VKB server: ${error.message}`, 'ERROR');
      throw error;
    }
  }

  /**
   * Format status line display
   * @param {Object} dockerMCPHealth - Docker MCP SSE servers health (null if not in Docker mode)
   */
  formatStatusLine(gcmHealth, sessionHealth, constraintHealth, databaseHealth, vkbHealth, browserAccessHealth, healthDashboardHealth, dockerMCPHealth = null) {
    let statusLine = '';

    // Show transition status if in progress
    if (this.monitoringPaused && this.transitionData) {
      const { fromMode, toMode } = this.transitionData;
      statusLine += `[🔄 TRANSITIONING: ${fromMode} → ${toMode}] `;
    }

    // Global Coding Monitor with reason code if not healthy
    if (gcmHealth.icon === '🟡' || gcmHealth.icon === '🔴') {
      const reason = gcmHealth.reason || this.getShortReason(gcmHealth.details || gcmHealth.status);
      statusLine += `[GCM:${gcmHealth.icon}(${reason})]`;
    } else {
      statusLine += `[GCM:${gcmHealth.icon}]`;
    }

    // Project Sessions - show ALL sessions (sleeping shown as 💤, never hidden)
    const activeSessionEntries = Object.entries(sessionHealth);

    if (activeSessionEntries.length > 0) {
      const sessionStatuses = activeSessionEntries
        .map(([projectName, health]) => {
          const abbrev = this.getProjectAbbreviation(projectName);
          // Add reason in parentheses for yellow/red statuses
          if (health.icon === '🟡' || health.icon === '🔴') {
            const reason = this.getShortReason(health.details || health.status);
            return `${abbrev}:${health.icon}(${reason})`;
          }
          return `${abbrev}:${health.icon}`;
        })
        .join(' ');
      statusLine += ` [Sessions: ${sessionStatuses}]`;
    }

    // Constraint Monitor (Guards) - show reason if unhealthy
    if (constraintHealth.icon === '🟡' || constraintHealth.icon === '🔴') {
      const reason = constraintHealth.reason || this.getShortReason(constraintHealth.details || constraintHealth.status);
      statusLine += ` [Guards:${constraintHealth.icon}(${reason})]`;
    } else {
      statusLine += ` [Guards:${constraintHealth.icon}]`;
    }

    // Database Health (GraphDB + LevelDB + SQLite)
    if (databaseHealth.icon === '🟡' || databaseHealth.icon === '🔴') {
      const reason = this.getShortReason(databaseHealth.details || databaseHealth.status);
      statusLine += ` [DB:${databaseHealth.icon}(${reason})]`;
    } else {
      statusLine += ` [DB:${databaseHealth.icon}]`;
    }

    // VKB Server Health
    if (vkbHealth.icon === '🟡' || vkbHealth.icon === '🔴') {
      const reason = this.getShortReason(vkbHealth.details || vkbHealth.status);
      statusLine += ` [VKB:${vkbHealth.icon}(${reason})]`;
    } else {
      statusLine += ` [VKB:${vkbHealth.icon}]`;
    }

    // Browser Access SSE Server Health (only show if not inactive)
    if (browserAccessHealth && browserAccessHealth.status !== 'inactive') {
      if (browserAccessHealth.icon === '🟡' || browserAccessHealth.icon === '🔴') {
        const reason = this.getShortReason(browserAccessHealth.details || browserAccessHealth.status);
        statusLine += ` [Browser:${browserAccessHealth.icon}(${reason})]`;
      } else {
        statusLine += ` [Browser:${browserAccessHealth.icon}]`;
      }
    }

    // Health Dashboard (UI:3032, API:3033) - always show since it's core infrastructure
    if (healthDashboardHealth) {
      if (healthDashboardHealth.icon === '🟡' || healthDashboardHealth.icon === '🔴') {
        const reason = this.getShortReason(healthDashboardHealth.details || healthDashboardHealth.status);
        statusLine += ` [Dash:${healthDashboardHealth.icon}(${reason})]`;
      } else {
        statusLine += ` [Dash:${healthDashboardHealth.icon}]`;
      }
    }

    // Docker MCP SSE Servers (only shown in Docker mode)
    if (dockerMCPHealth && dockerMCPHealth.status !== 'inactive') {
      if (dockerMCPHealth.icon === '🟡' || dockerMCPHealth.icon === '🔴') {
        statusLine += ` [🐳MCP:${dockerMCPHealth.icon}(${dockerMCPHealth.details})]`;
      } else {
        statusLine += ` [🐳MCP:${dockerMCPHealth.icon}]`;
      }
    }

    return statusLine;
  }

  /**
   * Check and run billing scraper if interval has passed
   * Runs in background to avoid blocking health checks
   */
  async checkBillingScraper() {
    // Don't run if already running
    if (this.billingScraperRunning) return;

    try {
      // Load config to check if auto-scrape is enabled and get interval
      const configPath = path.join(this.codingRepoPath, 'config', 'live-logging-config.json');
      if (!fs.existsSync(configPath)) return;

      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const groqConfig = config?.provider_credits?.groq;

      // Skip if not configured for auto-scrape
      if (!groqConfig?.autoScrape || groqConfig?.billingType !== 'monthly') return;

      // Check interval (default 15 minutes)
      const intervalMs = (groqConfig.scrapeIntervalMinutes || 15) * 60 * 1000;
      const now = Date.now();

      if ((now - this.lastBillingCheck) < intervalMs) return;

      // Check if there are active sessions (don't scrape if idle)
      const activeSessions = await this.getRunningAgentSessions();
      if (activeSessions.size === 0) {
        this.log('Skipping billing scrape - no active sessions');
        return;
      }

      // Run scraper in background
      this.billingScraperRunning = true;
      this.lastBillingCheck = now;

      this.log('Starting Groq billing scraper...');

      const scraperPath = path.join(this.codingRepoPath, 'scripts', 'groq-billing-scraper.js');
      if (!fs.existsSync(scraperPath)) {
        this.log('Billing scraper not found', 'WARN');
        this.billingScraperRunning = false;
        return;
      }

      // Run scraper as background process
      const scraperProcess = spawn('node', [scraperPath], {
        cwd: this.codingRepoPath,
        env: { ...process.env, CODING_REPO: this.codingRepoPath },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
      });

      let stdout = '';
      let stderr = '';

      scraperProcess.stdout.on('data', (data) => { stdout += data.toString(); });
      scraperProcess.stderr.on('data', (data) => { stderr += data.toString(); });

      scraperProcess.on('close', (code) => {
        this.billingScraperRunning = false;

        if (code === 0 && stdout) {
          try {
            const result = JSON.parse(stdout.trim());
            if (result.scraped) {
              this.log(`Groq billing updated: $${result.spend}`);
            } else if (result.needsAuth) {
              this.log('Groq billing scrape needs authentication', 'WARN');
            }
          } catch (parseError) {
            this.log(`Billing scraper output parse error: ${parseError.message}`, 'WARN');
          }
        } else if (code !== 0) {
          this.log(`Billing scraper failed (exit ${code}): ${stderr}`, 'WARN');
        }
      });

      scraperProcess.on('error', (error) => {
        this.billingScraperRunning = false;
        this.log(`Billing scraper spawn error: ${error.message}`, 'ERROR');
      });

    } catch (error) {
      this.billingScraperRunning = false;
      this.log(`Billing check error: ${error.message}`, 'ERROR');
    }
  }

  /**
   * Update status line
   */
  async updateStatusLine() {
    try {
      // Gather health data from all components (including new database, VKB, browser-access, health dashboard, and Docker MCP checks)
      const [gcmHealth, sessionHealth, constraintHealth, databaseHealth, vkbHealth, browserAccessHealth, healthDashboardHealth, dockerMCPHealth] = await Promise.all([
        this.getGlobalCodingMonitorHealth(),
        this.getProjectSessionsHealth(),
        this.getConstraintMonitorHealth(),
        this.getDatabaseHealth(),
        this.getVKBServerHealth(),
        this.getBrowserAccessHealth(),
        this.getHealthDashboardHealth(),
        this.getDockerMCPHealth()
      ]);

      // Format status line
      const statusLine = this.formatStatusLine(gcmHealth, sessionHealth, constraintHealth, databaseHealth, vkbHealth, browserAccessHealth, healthDashboardHealth, dockerMCPHealth);

      // Write status file for Claude Code integration
      // IMPORTANT: Always write/touch the file even when content hasn't changed,
      // because combined-status-line.js uses file mtime to check freshness
      const statusFile = path.join(this.codingRepoPath, '.logs', 'statusline-health-status.txt');
      const tempFile = statusFile + '.tmp.' + process.pid;
      fs.writeFileSync(tempFile, statusLine);
      fs.renameSync(tempFile, statusFile);  // rename is atomic on POSIX filesystems

      if (statusLine !== this.lastStatus) {
        this.lastStatus = statusLine;
        this.log(`Status updated: ${statusLine}`);

        // Emit status for any listeners
        if (this.isDebug) {
          console.log('\n' + '='.repeat(80));
          console.log('STATUS LINE UPDATE');
          console.log('='.repeat(80));
          console.log(`Display: ${statusLine}`);
          console.log('\nDetails:');
          console.log(`  GCM: ${gcmHealth.status} - ${gcmHealth.details}`);
          console.log('  Sessions:');
          for (const [project, health] of Object.entries(sessionHealth)) {
            console.log(`    ${project}: ${health.status} - ${health.details}`);
          }
          console.log(`  Constraints: ${constraintHealth.status} - ${constraintHealth.details}`);
          console.log(`  Database: ${databaseHealth.status} - ${databaseHealth.details}`);
          console.log(`  VKB: ${vkbHealth.status} - ${vkbHealth.details}`);
          console.log(`  Browser Access: ${browserAccessHealth.status} - ${browserAccessHealth.details}`);
          console.log(`  Health Dashboard: ${healthDashboardHealth.status} - ${healthDashboardHealth.details}`);
          if (dockerMCPHealth) {
            console.log(`  Docker MCP: ${dockerMCPHealth.status} - ${dockerMCPHealth.details}`);
            if (dockerMCPHealth.individual) {
              console.log(`    Semantic Analysis: ${dockerMCPHealth.individual.semantic.status} - ${dockerMCPHealth.individual.semantic.details}`);
              console.log(`    Constraint Monitor SSE: ${dockerMCPHealth.individual.constraint.status} - ${dockerMCPHealth.individual.constraint.details}`);
              console.log(`    Code Graph RAG: ${dockerMCPHealth.individual.codeGraph.status} - ${dockerMCPHealth.individual.codeGraph.details}`);
            }
          }
          console.log('='.repeat(80) + '\n');
        }
      }

      // Broadcast terminal titles to all Claude sessions for visibility in idle terminals
      await this.broadcastTerminalTitles(sessionHealth);

      // Check if it's time to run the billing scraper (runs in background)
      this.checkBillingScraper().catch(error => {
        this.log(`Billing scraper error: ${error.message}`, 'WARN');
      });

    } catch (error) {
      this.log(`Error updating status line: ${error.message}`, 'ERROR');
    }
  }

  /**
   * Broadcast terminal title updates to all Claude session terminals
   * This makes status visible even in idle sessions (via terminal tab/title bar)
   */
  async broadcastTerminalTitles(sessionHealth) {
    try {
      // Find all Claude process TTYs and update their terminal titles
      // NOTE: This works on iTerm2 and Terminal.app, but NOT on VSCode's integrated terminal
      // VSCode does not process OSC 0 escape sequences written directly to TTY from external processes
      const claudeTtys = await this.getClaudeSessionTTYs();

      if (claudeTtys.length === 0) return;

      for (const { projectName, tty } of claudeTtys) {
        try {
          // Create project-specific terminal title
          const projectAbbr = this.getProjectAbbreviation(projectName);
          const projectHealth = sessionHealth[projectName];
          const projectIcon = projectHealth?.icon || '❓';

          // Format: "C🟢 | CA🪨 ND💤 UT🟢" - current project first, then others
          const otherSessions = Object.entries(sessionHealth)
            .filter(([name]) => name !== projectName)
            .map(([name, health]) => `${this.getProjectAbbreviation(name)}${health.icon}`)
            .join(' ');

          const title = `${projectAbbr}${projectIcon} | ${otherSessions}`;

          // Write ANSI escape code to set terminal title
          // ESC ] 0 ; title BEL - sets both window title and icon name
          const titleSequence = `\x1b]0;${title}\x07`;

          // Write to TTY (best effort - may fail for various reasons)
          fs.writeFileSync(tty, titleSequence);
        } catch (ttyError) {
          // Silently ignore TTY write errors (permission, closed terminal, etc.)
        }
      }
    } catch (error) {
      // Silently ignore broadcast errors - this is a best-effort feature
    }
  }

  /**
   * Get TTY devices for all running Claude sessions
   * @returns {Promise<Array<{projectName: string, tty: string}>>}
   */
  async getClaudeSessionTTYs() {
    const sessions = [];

    try {
      // Find Claude processes and their TTYs using ps
      // Format: PID TTY COMMAND
      const { stdout } = await execAsync('ps -eo pid,tty,comm | grep -E "^[[:space:]]*[0-9]+[[:space:]]+ttys[0-9]+[[:space:]]+claude$"', { timeout: 5000 });

      if (!stdout || !stdout.trim()) return sessions;

      for (const line of stdout.trim().split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          const pid = parts[0];
          const tty = parts[1];

          // Skip if no TTY (background process)
          if (tty === '??' || tty === '-') continue;

          // Get the working directory to determine project
          try {
            const { stdout: lsofOut } = await execAsync(`lsof -p ${pid} 2>/dev/null | grep cwd | head -1`, { timeout: 3000 });
            if (lsofOut) {
              const cwdParts = lsofOut.trim().split(/\s+/);
              const cwdPath = cwdParts[cwdParts.length - 1];
              const agenticMatch = cwdPath.match(/\/Agentic\/([^/\s]+)/);

              if (agenticMatch) {
                const projectName = agenticMatch[1];
                const ttyPath = `/dev/${tty}`;

                // Verify TTY exists and is writable
                if (fs.existsSync(ttyPath)) {
                  sessions.push({ projectName, tty: ttyPath });
                }
              }
            }
          } catch (lsofError) {
            // Process may have exited
          }
        }
      }
    } catch (error) {
      // grep returns exit code 1 when no matches - this is normal
      if (!error.message.includes('exit code 1')) {
        this.log(`Error getting Claude TTYs: ${error.message}`, 'DEBUG');
      }
    }

    return sessions;
  }

  /**
   * Check if another instance is already running via PSM and PID file
   * @param {boolean} forceKill - If true, kill existing instance and take over
   * @returns {Promise<{running: boolean, pid?: number, killed?: boolean}>}
   */
  async checkExistingInstance(forceKill = false) {
    try {
      // First, clean up any dead processes from PSM
      const cleaned = await this.psm.cleanupDeadProcesses();
      if (cleaned > 0) {
        this.log(`Cleaned up ${cleaned} dead process(es) from PSM registry`, 'INFO');
      }

      // Check PID file first (shell script compatibility)
      const pidFile = path.join(this.codingRepoPath, '.pids', 'statusline-health-monitor.pid');
      let pidFromFile = null;

      if (fs.existsSync(pidFile)) {
        try {
          pidFromFile = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
          if (!isNaN(pidFromFile) && this.psm.isProcessAlive(pidFromFile)) {
            // Verify it's the health monitor process
            const { stdout } = await execAsync(`ps -p ${pidFromFile} -o args=`, { timeout: 3000 }).catch(() => ({ stdout: '' }));
            if (stdout.includes('statusline-health-monitor')) {
              if (forceKill) {
                this.log(`Force killing existing instance from PID file (PID: ${pidFromFile})...`, 'WARN');
                process.kill(pidFromFile, 'SIGTERM');
                await new Promise(resolve => setTimeout(resolve, 1000));
                if (this.psm.isProcessAlive(pidFromFile)) {
                  process.kill(pidFromFile, 'SIGKILL');
                  await new Promise(resolve => setTimeout(resolve, 500));
                }
                fs.unlinkSync(pidFile);
                await this.psm.unregisterService(this.serviceName, 'global');
                return { running: false, pid: pidFromFile, killed: true };
              }
              return { running: true, pid: pidFromFile };
            }
          }
          // Stale PID file, clean it up
          fs.unlinkSync(pidFile);
        } catch (e) {
          // Ignore errors, continue to PSM check
        }
      }

      // Check if service is registered and alive via PSM
      const isRunning = await this.psm.isServiceRunning(this.serviceName, 'global');

      if (isRunning) {
        const service = await this.psm.getService(this.serviceName, 'global');
        const existingPid = service?.pid;

        if (forceKill && existingPid) {
          this.log(`Force killing existing instance (PID: ${existingPid})...`, 'WARN');
          try {
            process.kill(existingPid, 'SIGTERM');
            // Wait briefly for graceful shutdown
            await new Promise(resolve => setTimeout(resolve, 1000));
            // Check if still alive, force kill if needed
            if (this.psm.isProcessAlive(existingPid)) {
              process.kill(existingPid, 'SIGKILL');
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          } catch (e) {
            // Process might already be dead
          }
          // Clean up the registry entry
          await this.psm.unregisterService(this.serviceName, 'global');
          return { running: false, pid: existingPid, killed: true };
        }

        return { running: true, pid: existingPid };
      }

      return { running: false };
    } catch (error) {
      this.log(`Error checking existing instance: ${error.message}`, 'ERROR');
      return { running: false };
    }
  }

  /**
   * Register this instance with PSM
   */
  async registerWithPSM() {
    try {
      await this.psm.registerService({
        name: this.serviceName,
        type: 'global',
        pid: process.pid,
        script: __filename,
        metadata: {
          startedAt: new Date().toISOString(),
          updateInterval: this.updateInterval,
          autoHeal: this.autoHealEnabled
        }
      });
      this.log(`Registered with PSM as global service (PID: ${process.pid})`, 'INFO');

      // Set up periodic health refresh to PSM
      this.healthRefreshInterval = setInterval(async () => {
        try {
          await this.psm.refreshHealthCheck(this.serviceName, 'global');
        } catch (e) {
          this.log(`PSM health refresh failed: ${e.message}`, 'DEBUG');
        }
      }, 30000); // Refresh every 30 seconds

      return true;
    } catch (error) {
      this.log(`Failed to register with PSM: ${error.message}`, 'ERROR');
      return false;
    }
  }

  /**
   * Unregister from PSM
   */
  async unregisterFromPSM() {
    try {
      if (this.healthRefreshInterval) {
        clearInterval(this.healthRefreshInterval);
        this.healthRefreshInterval = null;
      }
      await this.psm.unregisterService(this.serviceName, 'global');
      this.log('Unregistered from PSM', 'INFO');
    } catch (error) {
      this.log(`Failed to unregister from PSM: ${error.message}`, 'ERROR');
    }
  }

  /**
   * Write PID file for shell script compatibility
   */
  writePidFile() {
    const pidDir = path.join(this.codingRepoPath, '.pids');
    const pidFile = path.join(pidDir, 'statusline-health-monitor.pid');

    try {
      if (!fs.existsSync(pidDir)) {
        fs.mkdirSync(pidDir, { recursive: true });
      }
      fs.writeFileSync(pidFile, String(process.pid));
      this.log(`PID file written: ${pidFile} (PID: ${process.pid})`);
    } catch (error) {
      this.log(`Failed to write PID file: ${error.message}`, 'WARN');
    }
  }

  /**
   * Remove PID file on shutdown
   */
  removePidFile() {
    const pidFile = path.join(this.codingRepoPath, '.pids', 'statusline-health-monitor.pid');

    try {
      if (fs.existsSync(pidFile)) {
        const storedPid = fs.readFileSync(pidFile, 'utf8').trim();
        // Only remove if it's our PID (prevent removing another instance's file)
        if (storedPid === String(process.pid)) {
          fs.unlinkSync(pidFile);
          this.log('PID file removed');
        }
      }
    } catch (error) {
      this.log(`Failed to remove PID file: ${error.message}`, 'WARN');
    }
  }

  /**
   * Start monitoring
   */
  async start() {
    this.log('🚀 Starting StatusLine Health Monitor...');

    // Log Docker mode status at startup for diagnostics
    const dockerMode = this.isDockerMode();
    this.log(`📦 Docker mode: ${dockerMode ? 'ENABLED (auto-heal will skip native services)' : 'disabled (native mode)'}`);
    if (dockerMode) {
      this.log(`   - Auto-healing for VKB/constraint-monitor: DISABLED in Docker mode`);
      this.log(`   - Services should run in containers, not native processes`);
    }

    // Write PID file for shell script compatibility
    this.writePidFile();

    // Register with PSM
    await this.registerWithPSM();

    // Install Docker mode transition signal handlers
    process.on('SIGUSR2', async () => {
      this.monitoringPaused = true;
      try {
        this.transitionData = await getTransitionLockData();
      } catch {
        this.transitionData = { fromMode: 'unknown', toMode: 'unknown' };
      }
      this.log('⏸️  Monitoring PAUSED (Docker mode transition in progress)', 'WARN');
      // Update status to show transition
      await this.updateStatusLine();
    });

    process.on('SIGUSR1', () => {
      this.monitoringPaused = false;
      this.transitionData = null;
      this.log('▶️  Monitoring RESUMED (Docker mode transition complete)');
      // Force status update after transition
      this.updateStatusLine();
    });

    // Initial update
    await this.updateStatusLine();

    // Set up periodic updates
    this.updateTimer = setInterval(() => {
      this.updateStatusLine().catch(error => {
        this.log(`Update error: ${error.message}`, 'ERROR');
      });
    }, this.updateInterval);

    this.log(`✅ StatusLine Health Monitor started (update interval: ${this.updateInterval}ms)`);

    // Keep process alive
    process.stdin.resume();
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    
    this.log('🛑 StatusLine Health Monitor stopped');
  }

  /**
   * Graceful shutdown
   */
  async gracefulShutdown() {
    this.log('📴 Shutting down StatusLine Health Monitor...');
    this.stop();
    this.removePidFile();
    await this.unregisterFromPSM();
    process.exit(0);
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const isDebug = args.includes('--debug');
  const isDaemon = args.includes('--daemon');
  const autoHeal = args.includes('--auto-heal');
  const forceStart = args.includes('--force');

  if (args.includes('--help')) {
    console.log(`
StatusLine Health Monitor

Usage:
  node statusline-health-monitor.js [options]

Options:
  --daemon      Run in daemon mode (continuous monitoring)
  --force       Force start: kill existing instance if running
  --debug       Enable debug output
  --auto-heal   Enable auto-healing for unhealthy services
  --help        Show this help

Singleton Management:
  This daemon registers with the Process State Manager (PSM) as a global service.
  Only one instance can run at a time across all parallel coding sessions.
  Use --force to kill an existing instance and take over.

The monitor aggregates health data from:
  - Global Coding Monitor (GCM)
  - Active project sessions
  - MCP Constraint Monitor

Status Line Format:
  [GCM:✅] [Sessions: coding:🟢 curriculum-alignment:🟡] [Guards:✅]

Session Activity Icons (unified progression):
  🟢 Active   (< 5 min)     Active session with recent activity
  🌲 Cooling  (5-15 min)    Session cooling down
  🫒 Fading   (15min-1h)    Session fading, still tracked
  🪨 Dormant  (1-6 hours)   Session dormant but alive
  ⚫ Inactive (6-24 hours)  Session inactive, may be orphaned
  💤 Sleeping (> 24 hours)  Session sleeping, consider cleanup
  🟡 Warning                Trajectory file missing or stale
  ❌ Failed                 Service error or crash

Auto-Healing:
  When --auto-heal is enabled, the monitor will automatically:
  - Restart services that are down
  - Kill and restart stuck processes with high CPU
  - Attempt graceful recovery for unresponsive services
  - Limit healing attempts to prevent infinite loops
`);
    process.exit(0);
  }

  const monitor = new StatusLineHealthMonitor({
    debug: isDebug,
    autoHeal: autoHeal
  });

  // Setup signal handlers
  process.on('SIGTERM', () => monitor.gracefulShutdown());
  process.on('SIGINT', () => monitor.gracefulShutdown());

  if (isDaemon) {
    // Check for existing instance (singleton pattern)
    const existing = await monitor.checkExistingInstance(forceStart);

    if (existing.running) {
      console.log(`❌ StatusLine Health Monitor already running (PID: ${existing.pid})`);
      console.log(`   Use --force to kill and restart`);
      process.exit(1);
    }

    if (existing.killed) {
      console.log(`⚠️  Killed existing instance (PID: ${existing.pid}), starting new one...`);
    }

    await monitor.start();

    // Watch for code changes and auto-restart (supervisor will restart us)
    enableAutoRestart({
      scriptUrl: import.meta.url,
      dependencies: ['./process-state-manager.js', './docker-mode-transition.js'],
      cleanupFn: async () => {
        monitor.stop();
        monitor.removePidFile();
        await monitor.unregisterFromPSM();
      },
      logger: (msg) => monitor.log(msg)
    });
  } else {
    // Single update mode - no singleton check needed
    await monitor.updateStatusLine();
    console.log(`Status: ${monitor.lastStatus}`);
  }
}

runIfMain(import.meta.url, () => {
  main().catch(error => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
});

export default StatusLineHealthMonitor;