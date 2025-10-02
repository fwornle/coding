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
import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);

class StatusLineHealthMonitor {
  constructor(options = {}) {
    this.codingRepoPath = options.codingRepoPath || path.resolve(__dirname, '..');
    this.updateInterval = options.updateInterval || 15000; // 15 seconds
    this.isDebug = options.debug || false;
    
    this.registryPath = path.join(this.codingRepoPath, '.global-service-registry.json');
    this.logPath = path.join(this.codingRepoPath, '.logs', 'statusline-health.log');
    
    this.lastStatus = null;
    this.updateTimer = null;
    
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
        return {
          status: 'healthy',
          icon: '✅',
          details: `${status.services} services, ${status.projects} projects`
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
   * Get active project sessions health
   */
  /**
   * Get active project sessions health
   */
  async getProjectSessionsHealth() {
    const sessions = {};
    
    try {
      // Method 1: Registry-based discovery (preferred when available)
      if (fs.existsSync(this.registryPath)) {
        const registry = JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));
        
        for (const [projectName, projectInfo] of Object.entries(registry.projects || {})) {
          const sessionHealth = await this.getProjectSessionHealth(projectName, projectInfo);
          sessions[projectName] = sessionHealth;
        }
      }
      
      // Method 2: Dynamic discovery via Claude transcript files (discovers unregistered sessions)
      const claudeProjectsDir = path.join(process.env.HOME || '/Users/q284340', '.claude', 'projects');
      
      if (fs.existsSync(claudeProjectsDir)) {
        const projectDirs = fs.readdirSync(claudeProjectsDir).filter(dir => dir.startsWith('-Users-q284340-Agentic-'));
        
        for (const projectDir of projectDirs) {
          const projectDirPath = path.join(claudeProjectsDir, projectDir);
          
          // Extract project name from directory: "-Users-q284340-Agentic-curriculum-alignment" -> "curriculum-alignment"
          const projectName = projectDir.replace(/^-Users-q284340-Agentic-/, '');
          
          // Skip if already found via registry
          if (sessions[projectName]) continue;
          
          // Check if this project has a centralized health file FIRST
          const projectPath = `/Users/q284340/Agentic/${projectName}`;
          const centralizedHealthFile = this.getCentralizedHealthFile(projectPath);
          
          if (fs.existsSync(centralizedHealthFile)) {
            // Has monitor running - use health file data
            sessions[projectName] = await this.getProjectSessionHealthFromFile(centralizedHealthFile);
          } else {
            // No health file - check transcript activity to determine status
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
                
                if (age < 300000) { // Active within 5 minutes
                  sessions[projectName] = {
                    status: 'unmonitored',
                    icon: '🟡',
                    details: 'No transcript monitor'
                  };
                } else if (age < 86400000) { // Active within 24 hours 
                  sessions[projectName] = {
                    status: 'inactive',
                    icon: '⚫',
                    details: 'Session idle'
                  };
                } else {
                  // Older than 24 hours - show as dormant but still track it
                  sessions[projectName] = {
                    status: 'dormant',
                    icon: '💤',
                    details: 'Session dormant'
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
      const commonProjectDirs = [
        this.codingRepoPath, // Current coding directory
        '/Users/q284340/Agentic/curriculum-alignment',
        '/Users/q284340/Agentic/nano-degree'
      ];
      
      for (const projectDir of commonProjectDirs) {
        const projectName = path.basename(projectDir);
        
        // Skip if already found
        if (sessions[projectName]) continue;
        
        if (fs.existsSync(projectDir)) {
          const centralizedHealthFile = this.getCentralizedHealthFile(projectDir);
          if (fs.existsSync(centralizedHealthFile)) {
            sessions[projectName] = await this.getProjectSessionHealthFromFile(centralizedHealthFile);
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
      'nano': 'N'
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
   * Get health for a specific project session
   */
  async getProjectSessionHealth(projectName, projectInfo) {
    try {
      const healthFile = path.join(projectInfo.projectPath, '.transcript-monitor-health');
      return await this.getProjectSessionHealthFromFile(healthFile);
    } catch (error) {
      return {
        status: 'unknown',
        icon: '❓',
        details: 'Health check failed'
      };
    }
  }

  /**
   * Get health from a health file
   */
  async getProjectSessionHealthFromFile(healthFile) {
    try {
      if (!fs.existsSync(healthFile)) {
        return {
          status: 'inactive',
          icon: '⚫',
          details: 'No health file'
        };
      }

      const healthData = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
      const age = Date.now() - healthData.timestamp;
      
      // Determine health based on age and status
      if (age < 90000) { // < 90 seconds
        if (healthData.status === 'running' && healthData.streamingActive) {
          return {
            status: 'healthy',
            icon: '🟢',
            details: `${healthData.activity?.exchangeCount || 0} exchanges`
          };
        } else {
          return {
            status: 'warning',
            icon: '🟡',
            details: 'Not streaming'
          };
        }
      } else if (age < 120000) { // 90s - 2min
        return {
          status: 'warning',
          icon: '🟡',
          details: 'Stale health data'
        };
      } else if (age < 21600000) { // 2min - 6 hours: unhealthy (red)
        return {
          status: 'unhealthy',
          icon: '🔴',
          details: 'Health data too old'
        };
      } else {
        // > 6 hours: inactive (black)
        return {
          status: 'inactive',
          icon: '⚫',
          details: 'Session inactive (>6h)'
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
      // Enhanced health checking with port connectivity and CPU monitoring
      const dashboardPort = 3030; // From .env.ports: CONSTRAINT_DASHBOARD_PORT
      const apiPort = 3031;       // From .env.ports: CONSTRAINT_API_PORT
      
      // Check process existence and CPU usage
      const { stdout: psOutput } = await execAsync('ps aux | grep "constraint-monitor\\|dashboard.*next\\|constraint.*api" | grep -v grep');
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
      
      // Determine overall health status
      if (!processHealth.running) {
        return {
          status: 'inactive',
          icon: '⚫',
          details: 'Constraint monitor offline'
        };
      }
      
      if (processHealth.highCpu) {
        return {
          status: 'stuck',
          icon: '🔴',
          details: `High CPU usage: ${processHealth.details.join(', ')}`
        };
      }
      
      if (!portHealth.dashboard && !portHealth.api) {
        return {
          status: 'unresponsive',
          icon: '🔴', 
          details: 'Ports 3030,3031 unresponsive'
        };
      }
      
      if (!portHealth.dashboard || !portHealth.api) {
        const failedPorts = [];
        if (!portHealth.dashboard) failedPorts.push('3030');
        if (!portHealth.api) failedPorts.push('3031');
        
        return {
          status: 'degraded',
          icon: '🟡',
          details: `Port ${failedPorts.join(',')} down`
        };
      }
      
      // All checks passed
      return {
        status: 'healthy',
        icon: '✅',
        details: 'Ports 3030,3031 responsive'
      };
      
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
   * Format status line display
   */
  /**
   * Format status line display
   */
  formatStatusLine(gcmHealth, sessionHealth, constraintHealth) {
    let statusLine = '';
    
    // Global Coding Monitor
    statusLine += `[GCM:${gcmHealth.icon}]`;
    
    // Project Sessions - show individual session statuses with abbreviations
    // Filter out dormant sessions to avoid clutter
    const sessionEntries = Object.entries(sessionHealth)
      .filter(([projectName, health]) => health.status !== 'dormant');
    
    if (sessionEntries.length > 0) {
      const sessionStatuses = sessionEntries
        .map(([projectName, health]) => {
          const abbrev = this.getProjectAbbreviation(projectName);
          return `${abbrev}:${health.icon}`;
        })
        .join(' ');
      statusLine += ` [Sessions: ${sessionStatuses}]`;
    }
    
    // Constraint Monitor
    statusLine += ` [Guards:${constraintHealth.icon}]`;
    
    return statusLine;
  }

  /**
   * Update status line
   */
  async updateStatusLine() {
    try {
      // Gather health data from all components
      const [gcmHealth, sessionHealth, constraintHealth] = await Promise.all([
        this.getGlobalCodingMonitorHealth(),
        this.getProjectSessionsHealth(),
        this.getConstraintMonitorHealth()
      ]);

      // Format status line
      const statusLine = this.formatStatusLine(gcmHealth, sessionHealth, constraintHealth);
      
      // Only update if changed to avoid unnecessary updates
      if (statusLine !== this.lastStatus) {
        this.lastStatus = statusLine;
        
        // Write to status file for Claude Code integration
        const statusFile = path.join(this.codingRepoPath, '.logs', 'statusline-health-status.txt');
        fs.writeFileSync(statusFile, statusLine);
        
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
          console.log('='.repeat(80) + '\n');
        }
      }
      
    } catch (error) {
      this.log(`Error updating status line: ${error.message}`, 'ERROR');
    }
  }

  /**
   * Start monitoring
   */
  async start() {
    this.log('🚀 Starting StatusLine Health Monitor...');
    
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
    process.exit(0);
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const isDebug = args.includes('--debug');
  const isDaemon = args.includes('--daemon');
  
  if (args.includes('--help')) {
    console.log(`
StatusLine Health Monitor

Usage:
  node statusline-health-monitor.js [options]

Options:
  --daemon    Run in daemon mode
  --debug     Enable debug output
  --help      Show this help

The monitor aggregates health data from:
  - Global Coding Monitor (GCM)
  - Active project sessions
  - MCP Constraint Monitor

Status Line Format:
  [GCM:✅] [Sessions: coding:🟢 curriculum-alignment:🟡] [Guards:✅]

Health Indicators:
  🟢 Healthy    🟡 Warning    🔴 Unhealthy    ❌ Failed    ⚫ Inactive
`);
    process.exit(0);
  }

  const monitor = new StatusLineHealthMonitor({
    debug: isDebug
  });

  // Setup signal handlers
  process.on('SIGTERM', () => monitor.gracefulShutdown());
  process.on('SIGINT', () => monitor.gracefulShutdown());

  if (isDaemon) {
    await monitor.start();
  } else {
    // Single update mode
    await monitor.updateStatusLine();
    console.log(`Status: ${monitor.lastStatus}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}

export default StatusLineHealthMonitor;