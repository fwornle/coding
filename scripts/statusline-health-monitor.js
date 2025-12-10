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

    this.ensureLogDirectory();
  }
  /**
   * Get centralized health file path for a project (same logic as enhanced-transcript-monitor)
   */
  getCentralizedHealthFile(projectPath) {
    // Get coding project path
    const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || '/Users/q284340/Agentic/coding';
    
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
      // pgrep -f returns PIDs of matching processes, -a also shows full command
      let psOutput = '';
      try {
        psOutput = execSync('pgrep -af "enhanced-transcript-monitor.js"', { encoding: 'utf8', timeout: 5000 });
      } catch (pgrepError) {
        // pgrep returns exit code 1 when no matches - this is normal
        // Only log if it's a different error
        if (pgrepError.status !== 1) {
          this.log(`pgrep failed with status ${pgrepError.status}: ${pgrepError.message}`, 'WARN');
        }
      }

      if (psOutput && psOutput.trim()) {
        for (const line of psOutput.trim().split('\n')) {
          // Format: PID enhanced-transcript-monitor.js /Users/q284340/Agentic/PROJECT
          // Try multiple patterns for robustness
          const patterns = [
            /enhanced-transcript-monitor\.js\s+\/Users\/q284340\/Agentic\/([^\s]+)/,
            /\/Agentic\/([^\s/]+)(?:\s|$)/,  // Fallback: just extract project after /Agentic/
            /PROJECT_PATH=\/Users\/q284340\/Agentic\/([^\s]+)/  // Handle env var format
          ];

          for (const pattern of patterns) {
            const match = line.match(pattern);
            if (match) {
              runningProjects.add(match[1]);
              break;  // Found a match, no need to try other patterns
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
   * Get active project sessions health
   */
  async getProjectSessionsHealth() {
    const sessions = {};

    // Get projects with running transcript monitors - only these should be shown
    const runningMonitors = await this.getRunningTranscriptMonitors();

    try {
      // Method 1: Registry-based discovery (preferred when available)
      // STABILITY FIX: Also filter by running monitors to ensure consistency
      if (fs.existsSync(this.registryPath)) {
        const registry = JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));

        for (const [projectName, projectInfo] of Object.entries(registry.projects || {})) {
          // CRITICAL: Skip if no transcript monitor is running for this project
          // This ensures Method 1 behaves consistently with Methods 2 and 3
          if (!runningMonitors.has(projectName)) continue;

          const sessionHealth = await this.getProjectSessionHealth(projectName, projectInfo);
          sessions[projectName] = sessionHealth;
        }
      }
      
      // Method 2: Dynamic discovery via Claude transcript files (discovers unregistered sessions)
      // IMPORTANT: Only show sessions with running transcript monitors
      const claudeProjectsDir = path.join(process.env.HOME || '/Users/q284340', '.claude', 'projects');

      if (fs.existsSync(claudeProjectsDir)) {
        const projectDirs = fs.readdirSync(claudeProjectsDir).filter(dir => dir.startsWith('-Users-q284340-Agentic-'));

        for (const projectDir of projectDirs) {
          const projectDirPath = path.join(claudeProjectsDir, projectDir);

          // Extract project name from directory: "-Users-q284340-Agentic-curriculum-alignment" -> "curriculum-alignment"
          const projectName = projectDir.replace(/^-Users-q284340-Agentic-/, '');

          // Skip if already found via registry
          if (sessions[projectName]) continue;

          // Skip if no transcript monitor is running for this project
          if (!runningMonitors.has(projectName)) continue;

          // Check if this project has a centralized health file FIRST
          const projectPath = `/Users/q284340/Agentic/${projectName}`;
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

                // Use graduated green shades for declining activity
                // 🟢 bright green → 🟩 medium → 🌲 dark → 🫒 olive → 🪨 rock → ⚫ black
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
      
      // Method 3: Fallback hardcoded check for known project directories (using centralized health files)
      // IMPORTANT: Only show sessions with running transcript monitors
      const commonProjectDirs = [
        this.codingRepoPath, // Current coding directory
        '/Users/q284340/Agentic/curriculum-alignment',
        '/Users/q284340/Agentic/nano-degree'
      ];

      for (const projectDir of commonProjectDirs) {
        const projectName = path.basename(projectDir);

        // Skip if already found
        if (sessions[projectName]) continue;

        // Skip if no transcript monitor is running for this project
        if (!runningMonitors.has(projectName)) continue;

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
    
    return sessions;
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
      const healthFile = path.join(projectInfo.projectPath, '.transcript-monitor-health');

      // If health file exists, use it
      if (fs.existsSync(healthFile)) {
        return await this.getProjectSessionHealthFromFile(healthFile, projectInfo.projectPath);
      }

      // Otherwise, check transcript activity as fallback
      const claudeProjectDir = path.join(process.env.HOME || '/Users/q284340', '.claude', 'projects', `-Users-q284340-Agentic-${projectName}`);

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

      // If no active transcript/session, show as inactive (black) regardless of health file age
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
      // Use graduated green shades for declining activity instead of orange/red
      // 🟢 bright green → 🌲 dark green → ⚫ black (inactive)
      if (age < 90000) { // < 90 seconds
        if (healthData.status === 'running' && healthData.streamingActive) {
          // Check trajectory - downgrade to amber if missing/stale
          if (trajectoryStatus && trajectoryStatus.status !== 'fresh') {
            return {
              status: 'warning',
              icon: '🟡',
              details: trajectoryStatus.status === 'missing' ? 'no tr' : 'stale tr'
            };
          }

          return {
            status: 'healthy',
            icon: '🟢',
            details: `${healthData.activity?.exchangeCount || 0} exchanges`
          };
        } else {
          // Not streaming but health data fresh - use graduated green
          return {
            status: 'idle',
            icon: '🟩',
            details: 'Not streaming'
          };
        }
      } else if (age < 300000) { // 90s - 5min: slightly stale (medium green)
        return {
          status: 'stale',
          icon: '🟩',
          details: 'Recently active'
        };
      } else if (age < 900000) { // 5min - 15min: stale (darker green)
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
  async getConstraintMonitorHealth() {
    try {
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
      
      try {
        // Quick HTTP connectivity test for API
        const apiResponse = await Promise.race([
          execAsync(`curl -s -o /dev/null -w "%{http_code}" http://localhost:${apiPort}/api/health --max-time 3`),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ]);
        const apiStatus = parseInt(apiResponse.stdout.trim());
        portHealth.api = apiStatus >= 200 && apiStatus < 500;
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
      } else {
        // All checks passed
        healthResult = {
          status: 'healthy',
          icon: '✅',
          details: 'Ports 3030,3031 responsive'
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

      // Try to get actual database status via ukb command
      try {
        const { stdout } = await execAsync(`node "${path.join(this.codingRepoPath, 'bin/ukb')}" status --team coding 2>&1`, {
          timeout: 3000,
          encoding: 'utf8'
        });

        // Parse output for database health indicators
        if (stdout.includes('Level DB unavailable') || stdout.includes('running in-memory only')) {
          healthIssues.push('LevelDB unavailable');
          healthStatus = 'unhealthy';
        }

        if (stdout.includes('Graph DB:     ✗')) {
          healthIssues.push('GraphDB down');
          healthStatus = 'unhealthy';
        }
      } catch (ukbError) {
        // UKB command failed - database likely has issues
        if (!healthIssues.length) {
          healthIssues.push('UKB unreachable');
          healthStatus = 'warning';
        }
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
              // Server responding correctly
              if (healthStatus === 'healthy') {
                healthIssues = []; // Clear any issues if server is actually working
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
   * Auto-heal constraint monitor service when issues are detected
   */
  async autoHealConstraintMonitor(healthStatus) {
    if (!this.autoHealEnabled) return false;
    
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

      // Kill any process on port 8080
      await execAsync('lsof -ti:8080 | xargs kill -9 2>/dev/null || true');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Use the bin/vkb script to start the server properly
      const vkbScript = path.join(this.codingRepoPath, 'bin', 'vkb');

      this.log('Starting VKB server via bin/vkb...', 'INFO');

      // Start VKB in background
      execAsync(`"${vkbScript}" start`).catch(err => {
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
   */
  /**
   * Format status line display
   */
  formatStatusLine(gcmHealth, sessionHealth, constraintHealth, databaseHealth, vkbHealth, browserAccessHealth) {
    let statusLine = '';

    // Global Coding Monitor with reason code if not healthy
    if (gcmHealth.icon === '🟡' || gcmHealth.icon === '🔴') {
      const reason = gcmHealth.reason || this.getShortReason(gcmHealth.details || gcmHealth.status);
      statusLine += `[GCM:${gcmHealth.icon}(${reason})]`;
    } else {
      statusLine += `[GCM:${gcmHealth.icon}]`;
    }

    // Project Sessions - show individual session statuses with abbreviations
    // Since we now only include sessions with running transcript monitors,
    // we show all sessions regardless of status (dormant, sleeping, etc.)
    // The running monitor IS the signal that a session is active
    const sessionEntries = Object.entries(sessionHealth);

    if (sessionEntries.length > 0) {
      const sessionStatuses = sessionEntries
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

    // Constraint Monitor
    statusLine += ` [Guards:${constraintHealth.icon}]`;

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

    return statusLine;
  }

  /**
   * Update status line
   */
  async updateStatusLine() {
    try {
      // Gather health data from all components (including new database, VKB, and browser-access checks)
      const [gcmHealth, sessionHealth, constraintHealth, databaseHealth, vkbHealth, browserAccessHealth] = await Promise.all([
        this.getGlobalCodingMonitorHealth(),
        this.getProjectSessionsHealth(),
        this.getConstraintMonitorHealth(),
        this.getDatabaseHealth(),
        this.getVKBServerHealth(),
        this.getBrowserAccessHealth()
      ]);

      // Format status line
      const statusLine = this.formatStatusLine(gcmHealth, sessionHealth, constraintHealth, databaseHealth, vkbHealth, browserAccessHealth);

      // Only update if changed to avoid unnecessary updates
      if (statusLine !== this.lastStatus) {
        this.lastStatus = statusLine;

        // Write to status file for Claude Code integration
        // STABILITY FIX: Use atomic write (write to temp file, then rename) to prevent race conditions
        const statusFile = path.join(this.codingRepoPath, '.logs', 'statusline-health-status.txt');
        const tempFile = statusFile + '.tmp.' + process.pid;
        fs.writeFileSync(tempFile, statusLine);
        fs.renameSync(tempFile, statusFile);  // rename is atomic on POSIX filesystems

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
          console.log('='.repeat(80) + '\n');
        }
      }

    } catch (error) {
      this.log(`Error updating status line: ${error.message}`, 'ERROR');
    }
  }

  /**
   * Check if another instance is already running via PSM
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

      // Check if service is registered and alive
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
   * Start monitoring
   */
  async start() {
    this.log('🚀 Starting StatusLine Health Monitor...');

    // Register with PSM
    await this.registerWithPSM();

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

Health Indicators (graduated green for session activity):
  🟢 Active     🟩 Idle       🌲 Cooling      🫒 Fading
  🪨 Dormant    ⚫ Inactive   💤 Sleeping     🟡 Warning
  ❌ Failed

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