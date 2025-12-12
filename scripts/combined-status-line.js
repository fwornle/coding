#!/usr/bin/env node

/**
 * Combined Status Line: Constraint Monitor + Semantic Analysis
 * 
 * Shows status of both live guardrails and semantic analysis services
 */

import fs, { readFileSync, writeFileSync, existsSync } from 'fs';
import path, { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { getTimeWindow, getShortTimeWindow } from './timezone-utils.js';
import { UKBProcessManager } from './ukb-process-manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = process.env.CODING_REPO || join(__dirname, '..');

// Load configuration
let config = {};
try {
  const configPath = join(rootDir, 'config', 'live-logging-config.json');
  if (existsSync(configPath)) {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  }
} catch (error) {
  console.error('Warning: Could not load configuration, using defaults');
}

class CombinedStatusLine {
  constructor() {
    this.cacheTimeout = config.status_line?.cache_timeout || 5000;
    this.apiCheckInterval = config.status_line?.api_check_interval || 30000;
    this.lastUpdate = 0;
    this.lastApiCheck = 0;
    this.statusCache = null;
    this.apiCache = null;
    this.currentSessionId = null;
    this.config = config;
  }

  async generateStatus() {
    try {
      const now = Date.now();
      if (this.statusCache && (now - this.lastUpdate) < this.cacheTimeout) {
        return this.statusCache;
      }

      const constraintStatus = await this.getConstraintStatus();
      const semanticStatus = await this.getSemanticStatus();
      const knowledgeStatus = await this.getKnowledgeSystemStatus();
      const liveLogTarget = await this.getCurrentLiveLogTarget();
      const redirectStatus = await this.getRedirectStatus();
      const globalHealthStatus = await this.getGlobalHealthStatus();
      const healthVerifierStatus = await this.getHealthVerifierStatus();
      const ukbStatus = this.getUKBStatus();

      // Robust transcript monitor health check and auto-restart
      await this.ensureTranscriptMonitorRunning();

      // Ensure statusline health monitor daemon is running (global singleton)
      await this.ensureStatuslineHealthMonitorRunning();

      const status = await this.buildCombinedStatus(constraintStatus, semanticStatus, knowledgeStatus, liveLogTarget, redirectStatus, globalHealthStatus, healthVerifierStatus, ukbStatus);

      this.statusCache = status;
      this.lastUpdate = now;

      return status;
    } catch (error) {
      // CRITICAL: Log the actual error so we can debug!
      console.error(`ERROR in generateStatus: ${error.message}`);
      console.error(error.stack);
      return this.getErrorStatus(error);
    }
  }

  calculateTimeRemaining(sessionTimeRange) {
    if (!sessionTimeRange) return null;
    
    const match = sessionTimeRange.match(/(\d{2})(\d{2})-(\d{2})(\d{2})/);
    if (!match) return null;
    
    const [, startHour, startMin, endHour, endMin] = match;
    const now = new Date();
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();
    
    // Calculate end time for today
    const endTime = new Date();
    endTime.setHours(parseInt(endHour), parseInt(endMin), 0, 0);
    
    // Calculate remaining minutes
    const currentTime = new Date();
    currentTime.setHours(currentHour, currentMin, 0, 0);
    
    const remainingMs = endTime.getTime() - currentTime.getTime();
    const remainingMinutes = Math.floor(remainingMs / (1000 * 60));
    
    return remainingMinutes;
  }

  async getCurrentLiveLogTarget() {
    try {
      // 1. Calculate current time tranche using the same timezone utilities as LSL
      const now = new Date();
      // JavaScript Date already returns local time when using getHours()
      const currentTranche = getShortTimeWindow(now); // Use short format for status line display
      
      if (process.env.DEBUG_STATUS) {
        console.error(`DEBUG: UTC time: ${now.getUTCHours()}:${now.getUTCMinutes()}`);
        console.error(`DEBUG: Local time (CEST): ${now.getHours()}:${now.getMinutes()}`);
        console.error(`DEBUG: Current tranche calculated: ${currentTranche}`);
      }
      
      // 2. Look for current tranche session files in BOTH coding and target project
      const today = new Date().toISOString().split('T')[0];
      const targetProject = process.env.TRANSCRIPT_SOURCE_PROJECT || process.cwd();
      const checkDirs = [
        join(rootDir, '.specstory/history'),           // Coding repo
        join(targetProject, '.specstory/history')      // Target project
      ];
      
      // Look specifically for current tranche session files
      for (const historyDir of checkDirs) {
        if (existsSync(historyDir)) {
          if (process.env.DEBUG_STATUS) {
            console.error(`DEBUG: Checking directory: ${historyDir}`);
            const allFiles = fs.readdirSync(historyDir);
            console.error(`DEBUG: All files in ${historyDir}:`, allFiles.filter(f => f.includes(today)));
          }
          
          // Convert short format back to full format for file matching
          const fullTranche = getTimeWindow(now);
          const currentTrancheFiles = fs.readdirSync(historyDir)
            .filter(f => f.includes(today) && f.includes(fullTranche) && f.includes('session') && f.endsWith('.md'));
          
          if (process.env.DEBUG_STATUS) {
            console.error(`DEBUG: Looking for files with: ${today} AND ${fullTranche} AND session.md`);
            console.error(`DEBUG: Found current tranche files:`, currentTrancheFiles);
          }
          
          if (currentTrancheFiles.length > 0) {
            // Found current tranche session file - calculate time remaining
            const remainingMinutes = this.calculateTimeRemaining(fullTranche);
            
            if (process.env.DEBUG_STATUS) {
              console.error(`DEBUG: Found current tranche file, remaining minutes: ${remainingMinutes}`);
            }
            
            if (remainingMinutes !== null && remainingMinutes <= 5 && remainingMinutes > 0) {
              return `🟠${currentTranche}-session(${remainingMinutes}min)`;
            } else if (remainingMinutes !== null && remainingMinutes <= 0) {
              return `🔴${currentTranche}-session(ended)`;
            } else {
              return `${currentTranche}-session`;
            }
          }
        }
      }
      
      // 3. No current tranche file found - show current time window with status
      // We should always show the current time window, not fall back to old sessions
      const fullTranche = getTimeWindow(now);
      const remainingMinutes = this.calculateTimeRemaining(fullTranche);
      
      if (process.env.DEBUG_STATUS) {
        console.error(`DEBUG: No session file for current tranche, showing time window with ${remainingMinutes} min remaining`);
      }
      
      if (remainingMinutes !== null && remainingMinutes <= 5 && remainingMinutes > 0) {
        return `🟠${currentTranche}(${remainingMinutes}min)`;
      } else if (remainingMinutes !== null && remainingMinutes <= 0) {
        return `🔴${currentTranche}(ended)`;
      } else {
        return `${currentTranche}`;
      }
      
      // 2. Check current transcript to predict target filename
      const os = await import('os');
      const homeDir = os.homedir();
      // Create transcript directory path based on current coding repo location
      const codingRepo = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || rootDir;
      const transcriptDirName = `-${codingRepo.replace(/[^a-zA-Z0-9]/g, '-')}`;
      const transcriptDir = join(homeDir, '.claude', 'projects', transcriptDirName);
      
      if (existsSync(transcriptDir)) {
        const files = fs.readdirSync(transcriptDir)
          .filter(file => file.endsWith('.jsonl'))
          .map(file => {
            const filePath = join(transcriptDir, file);
            const stats = fs.statSync(filePath);
            return { file, mtime: stats.mtime, size: stats.size };
          })
          .sort((a, b) => b.mtime - a.mtime);
        
        if (files.length > 0) {
          const mostRecent = files[0];
          const timeDiff = Date.now() - mostRecent.mtime.getTime();
          
          if (timeDiff < 600000) { // 10 minutes = active session
            // Show what the target live log filename would be
            const uuid = mostRecent.file.replace('.jsonl', '');
            const shortUuid = uuid.substring(0, 8);
            const now = new Date();
            const time = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
            
            if (process.env.DEBUG_STATUS) {
              console.error(`Active transcript: ${mostRecent.file}, target: ${time}_${shortUuid}_live-session.md`);
            }
            
            return `${time}_${shortUuid}`;
          }
        }
      }
      
      // 3. Generate expected target filename based on current time
      const currentTime = new Date();
      const timeId = `${String(currentTime.getHours()).padStart(2, '0')}${String(currentTime.getMinutes()).padStart(2, '0')}`;
      return timeId + '_TBD';
      
    } catch (error) {
      return '----';
    }
  }

  /**
   * Get trajectory state from live-state.json
   */
  getTrajectoryState() {
    // Map states to icons (from config/live-logging-config.json) - SINGLE SOURCE OF TRUTH
    // NOTE: Leading space is intentional for proper spacing when appended
    const stateIconMap = {
      'exploring': ' 🔍EX',
      'on_track': ' 📈ON',
      'off_track': ' 📉OFF',
      'implementing': ' ⚙️IMP',
      'verifying': ' ✅VER',
      'blocked': ' 🚫BLK'
    };

    // Determine which project we're currently working in
    const targetProject = process.env.TRANSCRIPT_SOURCE_PROJECT || process.cwd();
    const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || rootDir;

    // Try to read from current project first (if not coding)
    let trajectoryPath;
    if (targetProject && !targetProject.includes(codingPath)) {
      trajectoryPath = join(targetProject, '.specstory', 'trajectory', 'live-state.json');
    } else {
      trajectoryPath = join(rootDir, '.specstory', 'trajectory', 'live-state.json');
    }

    // Auto-create trajectory file with defaults if missing (for new repositories)
    if (!existsSync(trajectoryPath)) {
      const trajectoryDir = dirname(trajectoryPath);
      if (!existsSync(trajectoryDir)) {
        const fs = require('fs');
        fs.mkdirSync(trajectoryDir, { recursive: true });
      }

      const defaultState = {
        currentState: 'exploring',
        lastUpdated: new Date().toISOString(),
        confidence: 0.8
      };

      writeFileSync(trajectoryPath, JSON.stringify(defaultState, null, 2));
      console.error(`ℹ️ Auto-created trajectory state file: ${trajectoryPath}`);

      return stateIconMap['exploring'];
    }

    try {
      const trajectoryData = JSON.parse(readFileSync(trajectoryPath, 'utf8'));
      const currentState = trajectoryData.currentState;

      if (!currentState) {
        // Auto-repair: add missing currentState field
        trajectoryData.currentState = 'exploring';
        trajectoryData.lastUpdated = new Date().toISOString();
        writeFileSync(trajectoryPath, JSON.stringify(trajectoryData, null, 2));
        console.error(`⚠️ Auto-repaired trajectory file (added missing currentState): ${trajectoryPath}`);
      }

      const icon = stateIconMap[currentState];
      if (!icon) {
        throw new Error(`Unknown trajectory state "${currentState}" in ${trajectoryPath}`);
      }

      return icon;
    } catch (error) {
      throw new Error(`Failed to read trajectory state from ${trajectoryPath}: ${error.message}`);
    }
  }

  async getConstraintStatus() {
    try {
      // Check if constraint monitor is running
      const servicesPath = join(rootDir, '.services-running.json');
      if (!existsSync(servicesPath)) {
        return { status: 'offline', compliance: 0, violations: 0 };
      }

      const services = JSON.parse(readFileSync(servicesPath, 'utf8'));
      const cmStatus = services.constraint_monitor;
      
      if (!cmStatus || cmStatus.status !== '✅ FULLY OPERATIONAL') {
        return { status: 'degraded', compliance: 0, violations: 0 };
      }

      // Get detailed constraint status
      const constraintScript = join(rootDir, 'integrations/mcp-constraint-monitor/src/status/constraint-status-line.js');
      const result = execSync(`node "${constraintScript}"`, { 
        timeout: 3000, 
        encoding: 'utf8' 
      });
      
      const constraintData = JSON.parse(result);
      
      // Extract actual compliance score from the text if possible
      let actualCompliance = 8.5;
      const complianceMatch = constraintData.text.match(/🛡️\s*(\d+\.?\d*)/);
      if (complianceMatch) {
        actualCompliance = parseFloat(complianceMatch[1]);
      }
      
      return { 
        status: 'operational', 
        text: constraintData.text,
        compliance: actualCompliance,
        violations: (() => {
          const violationMatch = constraintData.text.match(/⚠️\s*(\d+)/);
          return violationMatch ? parseInt(violationMatch[1]) : 0;
        })(),
        rawData: constraintData
      };
    } catch (error) {
      return { status: 'offline', compliance: 0, violations: 0, error: error.message };
    }
  }

  async getSemanticStatus() {
    try {
      // Check MCP semantic analysis connection
      const servicesPath = join(rootDir, '.services-running.json');
      if (!existsSync(servicesPath)) {
        return { status: 'offline' };
      }

      const services = JSON.parse(readFileSync(servicesPath, 'utf8'));

      // Check semantic_analysis object (not in services array because it uses stdio transport)
      const semanticAnalysis = services.semantic_analysis;

      if (semanticAnalysis && semanticAnalysis.health === 'healthy') {
        return { status: 'operational' };
      } else if (semanticAnalysis) {
        return { status: 'degraded' };
      } else {
        return { status: 'offline' };
      }
    } catch (error) {
      return { status: 'offline', error: error.message };
    }
  }

  async getKnowledgeSystemStatus() {
    try {
      // Read knowledge extraction status from transcript monitor health file
      const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || rootDir;
      const projectName = basename(process.env.TRANSCRIPT_SOURCE_PROJECT || process.cwd());
      const healthFile = join(codingPath, '.health', `${projectName}-transcript-monitor-health.json`);

      if (!existsSync(healthFile)) {
        return {
          status: 'offline',
          extractionState: 'disabled',
          budgetUsage: null,
          cacheHitRate: null
        };
      }

      const healthData = JSON.parse(readFileSync(healthFile, 'utf8'));
      const knowledgeStatus = healthData.knowledgeExtraction || {};

      return {
        status: knowledgeStatus.enabled ? 'operational' : 'disabled',
        extractionState: knowledgeStatus.state || 'unknown',
        lastExtraction: knowledgeStatus.lastExtraction || null,
        errorCount: knowledgeStatus.errorCount || 0,
        enabled: knowledgeStatus.enabled || false
      };
    } catch (error) {
      return {
        status: 'offline',
        extractionState: 'error',
        error: error.message
      };
    }
  }

  async getHealthVerifierStatus() {
    try {
      const statusPath = join(rootDir, '.health/verification-status.json');
      if (!existsSync(statusPath)) {
        return { status: 'offline' };
      }

      const statusData = JSON.parse(readFileSync(statusPath, 'utf8'));
      const age = Date.now() - new Date(statusData.lastUpdate).getTime();

      // Stale if > 2 minutes old (verifier runs every 60s)
      if (age > 120000) {
        return { status: 'stale', ...statusData };
      }

      return { status: 'operational', ...statusData };
    } catch (error) {
      return { status: 'error', error: error.message };
    }
  }

  /**
   * Get UKB (Update Knowledge Base) process status
   * Shows running/stale/frozen 13-agent workflows
   */
  getUKBStatus() {
    try {
      const ukbManager = new UKBProcessManager();
      const summary = ukbManager.getStatusSummary();

      return {
        status: summary.total > 0 ? 'active' : 'idle',
        running: summary.running,
        stale: summary.stale,
        frozen: summary.frozen,
        total: summary.total
      };
    } catch (error) {
      if (process.env.DEBUG_STATUS) {
        console.error(`DEBUG: UKB status check failed: ${error.message}`);
      }
      return { status: 'error', running: 0, stale: 0, frozen: 0, total: 0 };
    }
  }

  async getGlobalHealthStatus() {
    try {
      // Read health status from the statusline health monitor
      const healthStatusFile = join(rootDir, '.logs', 'statusline-health-status.txt');
      
      if (!existsSync(healthStatusFile)) {
        return { 
          status: 'initializing',
          gcm: { icon: '🟡', status: 'initializing' },
          sessions: {},
          guards: { icon: '🟡', status: 'initializing' }
        };
      }
      
      // Read the latest health status
      const healthStatus = readFileSync(healthStatusFile, 'utf8').trim();
      
      // Parse the health status format: [GCM:✅] [Sessions: coding:🟢] [Guards:✅]
      const gcmMatch = healthStatus.match(/\[GCM:([^\]]+)\]/);
      const sessionsMatch = healthStatus.match(/\[Sessions:\s*([^\]]+)\]/);
      const guardsMatch = healthStatus.match(/\[Guards:([^\]]+)\]/);
      
      const result = {
        status: 'operational',
        rawStatus: healthStatus,
        gcm: { icon: '✅', status: 'healthy' },
        sessions: {},
        guards: { icon: '✅', status: 'healthy' }
      };
      
      // Parse GCM status
      if (gcmMatch) {
        result.gcm.icon = gcmMatch[1];
        result.gcm.status = gcmMatch[1] === '✅' ? 'healthy' : 
                           gcmMatch[1] === '🟡' ? 'warning' : 'unhealthy';
      }
      
      // Parse sessions status - format: "project:icon" or "project:icon(reason)"
      if (sessionsMatch) {
        const sessionsStr = sessionsMatch[1].trim();
        // CRITICAL: Properly handle reasons with spaces like "(no tr)" by parsing character-by-character
        // tracking parenthesis depth
        const sessionPairs = [];
        let current = '';
        let inParens = false;

        for (let i = 0; i < sessionsStr.length; i++) {
          const char = sessionsStr[i];
          if (char === '(') {
            inParens = true;
            current += char;
          } else if (char === ')') {
            inParens = false;
            current += char;
          } else if (char === ' ' && !inParens) {
            if (current) sessionPairs.push(current);
            current = '';
          } else {
            current += char;
          }
        }
        if (current) sessionPairs.push(current);

        for (const pair of sessionPairs) {
          // Split on : to get project and icon+reason
          const colonIndex = pair.indexOf(':');
          if (colonIndex === -1) continue;

          const projectName = pair.substring(0, colonIndex);
          const iconPart = pair.substring(colonIndex + 1);
          if (!projectName || !iconPart) continue;

          // Extract icon and optional reason - look for pattern like "icon(reason)"
          const reasonMatch = iconPart.match(/\(([^)]+)\)/);
          const icon = reasonMatch ? iconPart.substring(0, iconPart.indexOf('(')) : iconPart;
          const reason = reasonMatch ? reasonMatch[1] : undefined;

          result.sessions[projectName] = {
            icon: icon,
            reason: reason,
            status: icon === '🟢' ? 'healthy' :
                   icon === '🟡' ? 'warning' : 'unhealthy'
          };
        }
      }
      
      // Parse guards status
      if (guardsMatch) {
        result.guards.icon = guardsMatch[1];
        result.guards.status = guardsMatch[1] === '✅' ? 'healthy' : 
                              guardsMatch[1] === '🟡' ? 'warning' : 'unhealthy';
      }
      
      // Check if health file is recent (within 30 seconds)
      const stats = fs.statSync(healthStatusFile);
      const age = Date.now() - stats.mtime.getTime();

      if (age > 30000) {
        result.status = 'stale';
        result.gcm.status = 'stale';

        // AUTO-CORRECTION: When status file is stale, validate sessions against
        // actual running processes to prevent showing phantom/crashed sessions
        const runningMonitors = this.getRunningTranscriptMonitorsSync();

        if (runningMonitors.size > 0) {
          // Filter sessions to only include those with running monitors
          const validatedSessions = {};
          for (const [abbrev, sessionData] of Object.entries(result.sessions)) {
            // Map abbreviation back to project name for validation
            const projectNameForAbbrev = this.getProjectNameFromAbbrev(abbrev);
            if (runningMonitors.has(projectNameForAbbrev) || runningMonitors.has(abbrev)) {
              validatedSessions[abbrev] = sessionData;
            }
          }
          result.sessions = validatedSessions;

          if (process.env.DEBUG_STATUS) {
            console.error(`DEBUG: Stale file auto-correction: filtered sessions to ${Object.keys(validatedSessions).join(', ')} based on running monitors: ${[...runningMonitors].join(', ')}`);
          }
        } else {
          // No running monitors found - clear all sessions (crashed state)
          result.sessions = {};
          if (process.env.DEBUG_STATUS) {
            console.error('DEBUG: Stale file auto-correction: cleared all sessions (no running monitors detected)');
          }
        }
      }

      // CRITICAL: Check for stale trajectory data in CURRENT project only
      // GCM status should only reflect issues in the project where it's displayed
      let currentProjectTrajectoryIssue = null;

      // Determine current project from environment or working directory
      const currentProjectPath = process.env.TRANSCRIPT_SOURCE_PROJECT || process.cwd();

      // Check trajectory for current project only
      const currentTrajectoryPath = join(currentProjectPath, '.specstory', 'trajectory', 'live-state.json');
      if (existsSync(currentTrajectoryPath)) {
        const trajStats = fs.statSync(currentTrajectoryPath);
        const trajAge = Date.now() - trajStats.mtime.getTime();
        const oneHour = 60 * 60 * 1000;

        if (trajAge > oneHour) {
          const ageMinutes = Math.floor(trajAge / 1000 / 60);
          currentProjectTrajectoryIssue = `stale tr`;
        }
      } else {
        // Current project session active but no trajectory file
        const currentProjectName = currentProjectPath.split('/').pop();
        const currentSession = result.sessions[currentProjectName] || result.sessions['coding'] || result.sessions['C'];

        if (currentSession && currentSession.status === 'healthy') {
          currentProjectTrajectoryIssue = 'no tr';
        }
      }

      // If trajectory issue detected in CURRENT project, downgrade GCM status
      if (currentProjectTrajectoryIssue) {
        result.gcm.status = 'warning';
        result.gcm.icon = '🟡';
        result.gcm.reason = currentProjectTrajectoryIssue;

        // If status is still 'operational', downgrade to 'degraded'
        if (result.status === 'operational') {
          result.status = 'degraded';
        }
      }

      return result;
    } catch (error) {
      return { 
        status: 'error',
        error: error.message,
        gcm: { icon: '❌', status: 'error' },
        sessions: {},
        guards: { icon: '❌', status: 'error' }
      };
    }
  }

  async getAPIUsageEstimate() {
    try {
      // Check if we have cached API data that's still valid
      const now = Date.now();
      if (this.apiCache && (now - this.lastApiCheck) < this.apiCheckInterval) {
        return this.apiCache;
      }

      // Use shared API quota checker utility
      const apiQuotaChecker = await import('../lib/api-quota-checker.js');

      // Check all active providers in parallel
      const providers = await apiQuotaChecker.checkAllProviders(this.config, {
        useCache: true,
        timeout: 5000
      });

      // Cache the results
      this.apiCache = { providers };
      this.lastApiCheck = now;

      return this.apiCache;
    } catch (error) {
      if (process.env.DEBUG_STATUS) {
        console.error('API usage check error:', error.message);
      }
      return { providers: [] };
    }
  }

  async getRedirectStatus() {
    try {
      // Only show redirect indicator when working OUTSIDE the coding project
      const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || rootDir;
      const targetProject = process.env.TRANSCRIPT_SOURCE_PROJECT;
      
      // If target project is the coding project itself, no redirect needed
      if (!targetProject || targetProject.includes(codingPath)) {
        if (process.env.DEBUG_STATUS) {
          console.error(`DEBUG: Target is coding project (${targetProject}), no redirect needed`);
        }
        return { active: false };
      }
      
      // Check if current conversation involves coding by reading stdin JSON input
      const input = await this.readStdinInput();
      if (input && input.transcript_path) {
        return await this.analyzeConversationForCoding(input.transcript_path);
      }
      
      if (process.env.DEBUG_STATUS) {
        console.error(`DEBUG: No transcript path available for conversation analysis`);
      }
      
      return { active: false };
    } catch (error) {
      if (process.env.DEBUG_STATUS) {
        console.error(`DEBUG: Redirect analysis failed: ${error.message}`);
      }
      return { active: false };
    }
  }

  async readStdinInput() {
    try {
      // Read JSON input from stdin if available
      if (process.stdin.isTTY) {
        return null; // No stdin input when run directly
      }
      
      let data = '';
      for await (const chunk of process.stdin) {
        data += chunk;
      }
      
      return data.trim() ? JSON.parse(data) : null;
    } catch (error) {
      return null;
    }
  }

  resolveRelativePaths(input, workingDir) {
    // Helper to resolve relative paths in tool inputs using working directory context
    const resolved = { ...input };
    
    // Common file path fields in tool inputs
    const pathFields = ['file_path', 'path', 'command', 'glob'];
    
    for (const field of pathFields) {
      if (resolved[field] && typeof resolved[field] === 'string') {
        const value = resolved[field];
        // If it's a relative path and we have a working directory, resolve it
        if (!value.startsWith('/') && workingDir) {
          resolved[field] = `${workingDir}/${value}`;
        }
      }
    }
    
    return resolved;
  }

  async analyzeConversationForCoding(transcriptPath) {
    try {
      if (!existsSync(transcriptPath)) {
        return { active: false };
      }

      const transcript = readFileSync(transcriptPath, 'utf8');
      const lines = transcript.trim().split('\n').filter(line => line.trim());
      
      const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || rootDir;
      const codingIndicators = [
        codingPath.toLowerCase(),
        '/coding/',
        'coding/',
        'combined-status-line',
        'transcript-monitor',
        'enhanced-transcript',
        'scripts/',
        '.js"',
        '.ts"',
        'status line',
        'statusline'
      ];

      // Find the most recent complete exchange (user prompt + assistant responses)
      let currentExchangeLines = [];
      let lastUserMessageIndex = -1;
      
      // First, find the last user message
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line.trim()) continue;
        
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'user' && !entry.isMeta) {
            lastUserMessageIndex = i;
            break;
          }
        } catch (parseError) {
          continue;
        }
      }
      
      if (lastUserMessageIndex === -1) {
        return { active: false }; // No user messages found
      }
      
      // Collect the exchange: last user message + subsequent assistant responses
      for (let i = lastUserMessageIndex; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        
        try {
          const entry = JSON.parse(line);
          // Include the user message and any assistant responses that follow
          if (entry.type === 'user' || entry.type === 'assistant') {
            // Stop if we hit a new user message (unless it's the first one we found)
            if (entry.type === 'user' && i > lastUserMessageIndex) {
              break;
            }
            currentExchangeLines.push(line);
          }
        } catch (parseError) {
          continue;
        }
      }
      
      // Analyze the current exchange for coding activity with working directory context
      let currentWorkingDir = null;
      let foundCodingActivity = false;
      
      // Process entries to track working directory changes and detect coding activity
      for (const line of currentExchangeLines) {
        try {
          const entry = JSON.parse(line);
          
          // Update working directory context from transcript metadata
          if (entry.cwd) {
            currentWorkingDir = entry.cwd;
          }
          
          // Check both USER and ASSISTANT messages for redirect detection
          // Skip system messages (hooks, internal operations)
          if (entry.type === 'system') continue;
          
          // Only check user and assistant messages
          if (entry.type !== 'user' && entry.type !== 'assistant') continue;
          
          // Extract message content based on entry type
          let actualContent = '';
          if (entry.message && entry.message.content) {
            // Handle different content formats
            if (typeof entry.message.content === 'string') {
              actualContent = entry.message.content.toLowerCase();
            } else if (Array.isArray(entry.message.content)) {
              for (const item of entry.message.content) {
                if (item.type === 'text' && item.text) {
                  actualContent += item.text.toLowerCase() + ' ';
                } else if (entry.type === 'user' && item.type === 'tool_result') {
                  // Skip tool results for user messages (they contain previous outputs)
                  continue;
                } else if (entry.type === 'assistant' && item.type === 'tool_use') {
                  // Include tool usage from assistant messages for coding detection
                  let toolContent = JSON.stringify(item.input).toLowerCase();
                  
                  // Resolve relative paths using working directory context
                  if (currentWorkingDir && item.input && typeof item.input === 'object') {
                    const resolvedInput = this.resolveRelativePaths(item.input, currentWorkingDir);
                    toolContent = JSON.stringify(resolvedInput).toLowerCase();
                  }
                  
                  actualContent += toolContent + ' ';
                }
              }
            }
          } else if (entry.content && typeof entry.content === 'string') {
            actualContent = entry.content.toLowerCase();
          }
          
          // Skip if no actual content
          if (!actualContent) continue;
          
          // Check for coding indicators
          for (const indicator of codingIndicators) {
            if (actualContent.includes(indicator)) {
              if (process.env.DEBUG_STATUS) {
                console.error(`DEBUG: Found coding indicator "${indicator}" in ${entry.type} message`);
                console.error(`DEBUG: Working directory context: ${currentWorkingDir}`);
              }
              foundCodingActivity = true;
              break;
            }
          }
          
          // Also check if we're currently in the coding directory
          if (currentWorkingDir && currentWorkingDir.includes('/coding')) {
            if (process.env.DEBUG_STATUS) {
              console.error(`DEBUG: Working in coding directory: ${currentWorkingDir}`);
            }
            foundCodingActivity = true;
          }
          
          if (foundCodingActivity) break;
          
        } catch (parseError) {
          // Skip malformed JSON lines
          continue;
        }
      }
      
      if (foundCodingActivity) {
        return {
          active: true,
          target: 'coding',
          source: 'current_exchange',
          workingDir: currentWorkingDir
        };
      }
      
      return { active: false };
    } catch (error) {
      if (process.env.DEBUG_STATUS) {
        console.error(`DEBUG: Conversation analysis failed: ${error.message}`);
      }
      return { active: false };
    }
  }

  async ensureTranscriptMonitorRunning() {
    try {
      // CRITICAL FIX: Check PSM FIRST to prevent duplicate spawns
      const projectPath = process.env.TRANSCRIPT_SOURCE_PROJECT;
      if (!projectPath) {
        return; // Can't check without project path
      }

      // Check if monitor is already registered in PSM
      try {
        const ProcessStateManager = (await import('./process-state-manager.js')).default;
        const psm = new ProcessStateManager();
        await psm.initialize();

        const existingMonitor = await psm.getService('enhanced-transcript-monitor', 'per-project', { projectPath });

        if (existingMonitor) {
          // Check if registered PID is still alive
          try {
            process.kill(existingMonitor.pid, 0); // Test if process exists
            if (process.env.DEBUG_STATUS) {
              console.error('DEBUG: Transcript monitor already running (PID:', existingMonitor.pid, ')');
            }
            return; // Monitor is running, don't spawn another
          } catch (err) {
            // PID is dead, unregister it
            if (process.env.DEBUG_STATUS) {
              console.error('DEBUG: Registered monitor PID', existingMonitor.pid, 'is dead, cleaning up...');
            }
            await psm.unregisterService('enhanced-transcript-monitor', 'per-project', { projectPath });
          }
        }
      } catch (psmError) {
        if (process.env.DEBUG_STATUS) {
          console.error('DEBUG: PSM check failed:', psmError.message);
        }
        // Fall through to health file check
      }

      // Check if integrated transcript monitor is running by looking for CENTRALIZED health file
      const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || rootDir;
      // CRITICAL FIX: Use centralized health file location (same as getCentralizedHealthFile in enhanced-transcript-monitor.js)
      const projectName = basename(projectPath);
      const healthFile = join(codingPath, '.health', `${projectName}-transcript-monitor-health.json`);

      if (!existsSync(healthFile)) {
        // Monitor not running, start it in background
        if (process.env.DEBUG_STATUS) {
          console.error('DEBUG: Transcript monitor not detected, starting...');
        }
        await this.startTranscriptMonitor();
        return;
      }

      // Check if health file is recent (within last 10 seconds)
      const stats = fs.statSync(healthFile);
      const now = Date.now();
      const age = now - stats.mtime.getTime();

      if (age > 10000) {
        // Health file is stale, restart monitor
        if (process.env.DEBUG_STATUS) {
          console.error('DEBUG: Transcript monitor health stale, restarting...');
        }
        await this.startTranscriptMonitor();
      }
    } catch (error) {
      if (process.env.DEBUG_STATUS) {
        console.error('DEBUG: Error checking transcript monitor:', error.message);
      }
    }
  }

  async startTranscriptMonitor() {
    try {
      const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || rootDir;
      const monitorScript = join(codingPath, 'scripts', 'enhanced-transcript-monitor.js');

      if (!existsSync(monitorScript)) {
        return; // Script not found, skip auto-start
      }

      // Determine project path - MUST be explicit
      const projectPath = process.env.TRANSCRIPT_SOURCE_PROJECT;
      if (!projectPath) {
        if (process.env.DEBUG_STATUS) {
          console.error('DEBUG: Cannot start transcript monitor - no TRANSCRIPT_SOURCE_PROJECT set');
        }
        return; // Don't start without explicit project path
      }

      const { spawn } = await import('child_process');

      // Start monitor in background with proper environment
      const env = {
        ...process.env,
        CODING_TOOLS_PATH: codingPath,
        TRANSCRIPT_SOURCE_PROJECT: projectPath
      };

      // CRITICAL: Pass project path as argument, not just environment
      const monitor = spawn('node', [monitorScript, projectPath], {
        detached: true,
        stdio: 'ignore',
        env
      });

      monitor.unref(); // Allow parent to exit without waiting

      if (process.env.DEBUG_STATUS) {
        console.error('DEBUG: Started integrated transcript monitor with PID:', monitor.pid);
      }

      // CRITICAL: Register spawned process with PSM
      try {
        const ProcessStateManager = (await import('./process-state-manager.js')).default;
        const psm = new ProcessStateManager();
        await psm.initialize();

        await psm.registerService({
          name: 'enhanced-transcript-monitor',
          pid: monitor.pid,
          type: 'per-project',
          script: 'enhanced-transcript-monitor.js',
          projectPath: projectPath,
          metadata: {
            spawnedBy: 'combined-status-line',
            autoStarted: true
          }
        });

        if (process.env.DEBUG_STATUS) {
          console.error('DEBUG: Registered monitor with PSM');
        }
      } catch (psmError) {
        console.error('Failed to register monitor with PSM:', psmError.message);
        // Continue anyway - process is running even if registration failed
      }
    } catch (error) {
      if (process.env.DEBUG_STATUS) {
        console.error('DEBUG: Failed to start transcript monitor:', error.message);
      }
    }
  }

  /**
   * Ensure statusline health monitor daemon is running (global singleton via PSM)
   * This is the "watcher of the watcher" - auto-restarts the health monitor if it dies
   */
  async ensureStatuslineHealthMonitorRunning() {
    try {
      const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || rootDir;

      // Check PSM for existing healthy instance
      try {
        const ProcessStateManager = (await import('./process-state-manager.js')).default;
        const psm = new ProcessStateManager();
        await psm.initialize();

        // Clean up dead processes first
        await psm.cleanupDeadProcesses();

        // Check if statusline-health-monitor is running
        const isRunning = await psm.isServiceRunning('statusline-health-monitor', 'global');

        if (isRunning) {
          // Already running, nothing to do
          if (process.env.DEBUG_STATUS) {
            console.error('DEBUG: Statusline health monitor already running via PSM');
          }
          return;
        }
      } catch (psmError) {
        if (process.env.DEBUG_STATUS) {
          console.error('DEBUG: PSM check failed:', psmError.message);
        }
        // Fall through to status file check
      }

      // Fallback: Check status file freshness
      const statusFile = join(codingPath, '.logs', 'statusline-health-status.txt');

      if (existsSync(statusFile)) {
        const stats = fs.statSync(statusFile);
        const age = Date.now() - stats.mtime.getTime();

        // If status file updated in last 30 seconds, monitor is likely running
        if (age < 30000) {
          if (process.env.DEBUG_STATUS) {
            console.error('DEBUG: Status file fresh, monitor likely running');
          }
          return;
        }
      }

      // Monitor not running or stale - start it
      if (process.env.DEBUG_STATUS) {
        console.error('DEBUG: Statusline health monitor not detected, starting...');
      }
      await this.startStatuslineHealthMonitor();
    } catch (error) {
      if (process.env.DEBUG_STATUS) {
        console.error('DEBUG: Error checking statusline health monitor:', error.message);
      }
    }
  }

  /**
   * Start the statusline health monitor daemon
   */
  async startStatuslineHealthMonitor() {
    try {
      const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || rootDir;
      const monitorScript = join(codingPath, 'scripts', 'statusline-health-monitor.js');

      if (!existsSync(monitorScript)) {
        console.error('DEBUG: Statusline health monitor script not found');
        return;
      }

      const { spawn } = await import('child_process');

      // Start monitor in daemon mode with auto-heal enabled
      const monitor = spawn('node', [monitorScript, '--daemon', '--auto-heal'], {
        detached: true,
        stdio: 'ignore',
        cwd: codingPath,
        env: {
          ...process.env,
          CODING_REPO: codingPath
        }
      });

      monitor.unref(); // Allow parent to exit without waiting

      if (process.env.DEBUG_STATUS) {
        console.error('DEBUG: Started statusline health monitor with PID:', monitor.pid);
      }

      // Note: The monitor will register itself with PSM on startup
      // We don't need to register it here since it has its own PSM integration

    } catch (error) {
      if (process.env.DEBUG_STATUS) {
        console.error('DEBUG: Failed to start statusline health monitor:', error.message);
      }
    }
  }

  async buildCombinedStatus(constraint, semantic, knowledge, liveLogTarget, redirectStatus, globalHealth, healthVerifier, ukbStatus) {
    const parts = [];
    let overallColor = 'green';

    // Global Health Status (GCM + Individual Session Statuses) - highest priority monitoring
    if (globalHealth && globalHealth.status !== 'error') {
      const gcmIcon = globalHealth.gcm?.icon || '🟡';
      const sessionEntries = Object.entries(globalHealth.sessions || {});

      if (sessionEntries.length > 0) {
        // Build the full GCM and Sessions display without labels
        // Determine current project to highlight it
        const currentProject = process.env.TRANSCRIPT_SOURCE_PROJECT || process.cwd();
        const currentProjectName = currentProject.split('/').pop();
        const currentAbbrev = this.getProjectAbbreviation(currentProjectName);

        const sessionStatuses = sessionEntries
          .map(([project, health]) => {
            const abbrev = this.getProjectAbbreviation(project);
            // Underline the current project's abbreviation
            const isCurrentProject = abbrev === currentAbbrev;
            const displayAbbrev = isCurrentProject ? `\u001b[4m${abbrev}\u001b[24m` : abbrev;
            // Add reason for yellow/red statuses
            if ((health.icon === '🟡' || health.icon === '🔴') && health.reason) {
              return `${displayAbbrev}${health.icon}(${health.reason})`;
            }
            return `${displayAbbrev}${health.icon}`;
          })
          .join(' ');

        // Include GCM with reason code if not healthy
        const gcmReason = globalHealth.gcm?.reason;
        const gcmDisplay = gcmReason ? `GCM${gcmIcon}(${gcmReason})` : `GCM${gcmIcon}`;
        parts.push(`[${gcmDisplay}]`);
        parts.push(`[${sessionStatuses}]`);
        
        // Determine overall session health for color coding
        const hasUnhealthy = sessionStatuses.includes('🔴');
        const hasWarning = sessionStatuses.includes('🟡');
        
        if (hasUnhealthy) overallColor = 'red';
        else if (hasWarning && overallColor === 'green') overallColor = 'yellow';
      } else {
        // Just GCM with no sessions
        const gcmReason = globalHealth.gcm?.reason;
        const gcmDisplay = gcmReason ? `GCM${gcmIcon}(${gcmReason})` : `GCM${gcmIcon}`;
        parts.push(`[${gcmDisplay}]`);
        if (gcmIcon === '❌') overallColor = 'red';
        else if (gcmIcon === '🟡' && overallColor === 'green') overallColor = 'yellow';
      }
    }

    // Constraint Monitor Status with TRJ label (trajectory)
    if (constraint.status === 'operational') {
      // Convert compliance to percentage (0-10 scale to 0-100%)
      const compliancePercent = constraint.compliance <= 10 ?
        Math.round(constraint.compliance * 10) :
        Math.round(constraint.compliance);
      const score = `${compliancePercent}%`;
      const violationsCount = constraint.violations || 0;
      
      // Get real-time trajectory state from live-state.json
      const trajectoryIcon = this.getTrajectoryState();

      // Build constraint section: shield + score + optional violations + trajectory
      // These are independent concepts that should BOTH be visible
      let constraintPart = `[🛡️ ${score}`;
      if (violationsCount > 0) {
        constraintPart += ` ⚠️ ${violationsCount}`;
        overallColor = 'yellow';
      }
      constraintPart += `${trajectoryIcon}]`;
      parts.push(constraintPart);
    } else if (constraint.status === 'degraded') {
      parts.push('[🛡️ ⚠️]');
      overallColor = 'yellow';
    } else {
      parts.push('[🛡️ ❌]');
      overallColor = 'red';
    }

    // API Provider Status (Multi-provider display with bar chart emojis)
    if (semantic.status === 'operational') {
      const apiData = await this.getAPIUsageEstimate();
      const providers = apiData.providers || [];

      if (providers.length > 0) {
        // Import the formatter utility
        const apiQuotaChecker = await import('../lib/api-quota-checker.js');

        // Format each provider for display
        const providerDisplays = providers.map(p => apiQuotaChecker.formatQuotaDisplay(p));

        // Combine into single bracket: [G📊🟢 A📊🟡55%]
        parts.push(`[${providerDisplays.join(' ')}]`);

        // Update overall color based on worst provider status
        const hasCritical = providers.some(p => p.status === 'critical');
        const hasLow = providers.some(p => p.status === 'low' || p.status === 'degraded');

        if (hasCritical) {
          overallColor = 'red';
        } else if (hasLow && overallColor === 'green') {
          overallColor = 'yellow';
        }
      } else {
        // No providers configured - show generic healthy status
        parts.push('[API✅]');
      }
    } else if (semantic.status === 'degraded') {
      parts.push('[API⚠️]');
      if (overallColor === 'green') overallColor = 'yellow';
    } else {
      parts.push('[API❌]');
      overallColor = 'red';
    }

    // Knowledge System Status (Book icon for knowledge extraction)
    if (knowledge.status === 'operational') {
      const stateIcon = knowledge.extractionState === 'ready' ? '✅' :
                        knowledge.extractionState === 'processing' ? '⏳' :
                        knowledge.extractionState === 'idle' ? '💤' : '⚠️';

      const errorCount = knowledge.errorCount || 0;
      if (errorCount > 0) {
        // When showing errorCount, don't duplicate the warning emoji
        // If state is already warning, just show the count
        const displayIcon = stateIcon === '⚠️' ? '' : stateIcon;
        parts.push(`[📚${displayIcon}⚠️${errorCount}]`);
        if (overallColor === 'green') overallColor = 'yellow';
      } else {
        parts.push(`[📚${stateIcon}]`);
      }
    } else if (knowledge.status === 'disabled') {
      parts.push('[📚⏸️ ]'); // Paused/disabled (space for alignment)
    } else {
      parts.push('[📚❌]'); // Offline (no space - red cross is wide enough)
      if (overallColor === 'green') overallColor = 'yellow';
    }

    // Health Verifier Status (Hospital/medical icon for health monitoring)
    if (healthVerifier && healthVerifier.status === 'operational') {
      const overallStatus = healthVerifier.overallStatus || 'healthy';
      const violationCount = healthVerifier.violationCount || 0;
      const criticalCount = healthVerifier.criticalCount || 0;

      if (criticalCount > 0) {
        parts.push(`[🏥❌${criticalCount}]`); // Critical issues
        overallColor = 'red';
      } else if (violationCount > 0) {
        parts.push(`[🏥⚠️${violationCount}]`); // Warning issues
        if (overallColor === 'green') overallColor = 'yellow';
      } else if (overallStatus === 'healthy') {
        parts.push('[🏥✅]'); // All checks passed
      } else {
        parts.push('[🏥🟡]'); // Degraded but no specific violations
        if (overallColor === 'green') overallColor = 'yellow';
      }
    } else if (healthVerifier && healthVerifier.status === 'stale') {
      parts.push('[🏥⏰]'); // Stale data
      if (overallColor === 'green') overallColor = 'yellow';
    } else if (healthVerifier && healthVerifier.status === 'error') {
      parts.push('[🏥❌]'); // Error reading status
      if (overallColor === 'green') overallColor = 'yellow';
    } else {
      parts.push('[🏥💤]'); // Offline/not running
    }

    // UKB (Update Knowledge Base) Process Status - shows 13-agent workflow activity
    if (ukbStatus && ukbStatus.total > 0) {
      // Active workflows running
      let ukbPart = `[🧠`;
      if (ukbStatus.running > 0) {
        ukbPart += `${ukbStatus.running}⏳`;
      }
      if (ukbStatus.stale > 0) {
        ukbPart += `${ukbStatus.stale}⚠️`;
        if (overallColor === 'green') overallColor = 'yellow';
      }
      if (ukbStatus.frozen > 0) {
        ukbPart += `${ukbStatus.frozen}🥶`;
        overallColor = 'red';
      }
      ukbPart += ']';
      parts.push(ukbPart);
    }
    // Don't show anything when no UKB processes are running (cleaner status line)

    // Add redirect indicator if active (compact)
    if (redirectStatus && redirectStatus.active) {
      // Shorten common target names for compactness
      const target = redirectStatus.target
        .replace('coding', 'cod')
        .replace('nano-degree', 'nano');
      parts.push(`→${target}`);
    }

    // Add live log target filename inline at the end (readable format)
    if (liveLogTarget && liveLogTarget !== '----') {
      // Keep the full time window but remove redundant text
      let compactTarget = liveLogTarget
        .replace('-session', '')
        .replace('(ended)', '')
        .trim();
      
      parts.push(`📋${compactTarget}`);
    }
    
    const statusText = parts.join(' ');
    
    // Since Claude Code doesn't support tooltips/clicks natively,
    // we'll provide the text and have users run ./bin/status for details
    return {
      text: statusText,
      color: overallColor,
      helpCommand: './bin/status'
    };
  }

  /**
   * Generate smart abbreviations for project names (shared with health monitor)
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
   * Reverse mapping from abbreviation back to project name
   * Used for validating sessions against running monitors
   */
  getProjectNameFromAbbrev(abbrev) {
    // Reverse mapping of known abbreviations
    const reverseMapping = {
      'C': 'coding',
      'CA': 'curriculum-alignment',
      'ND': 'nano-degree',
      'CU': 'curriculum',
      'AL': 'alignment',
      'N': 'nano',
      'UT': 'ui-template'
    };

    const upperAbbrev = abbrev.toUpperCase();
    return reverseMapping[upperAbbrev] || abbrev.toLowerCase();
  }

  /**
   * Synchronous check for running transcript monitors
   * Used for auto-correction when status file is stale
   */
  getRunningTranscriptMonitorsSync() {
    const runningProjects = new Set();

    try {
      // Use pgrep to find running enhanced-transcript-monitor processes
      const psOutput = execSync('pgrep -af "enhanced-transcript-monitor.js" 2>/dev/null || true', {
        encoding: 'utf8',
        timeout: 5000
      });

      if (psOutput && psOutput.trim()) {
        for (const line of psOutput.trim().split('\n')) {
          // Extract project name from command line
          // Format: PID node enhanced-transcript-monitor.js /Users/q284340/Agentic/PROJECT
          const patterns = [
            /enhanced-transcript-monitor\.js\s+\/Users\/q284340\/Agentic\/([^\s]+)/,
            /\/Agentic\/([^\s/]+)(?:\s|$)/,
            /PROJECT_PATH=\/Users\/q284340\/Agentic\/([^\s]+)/
          ];

          for (const pattern of patterns) {
            const match = line.match(pattern);
            if (match) {
              runningProjects.add(match[1]);
              break;
            }
          }
        }
      }

      // Fallback: Check health files if pgrep found nothing
      // Health files updated in last 30 seconds indicate running monitor
      if (runningProjects.size === 0) {
        const healthDir = join(rootDir, '.health');
        if (existsSync(healthDir)) {
          const healthFiles = fs.readdirSync(healthDir)
            .filter(f => f.endsWith('-transcript-monitor-health.json'));

          for (const file of healthFiles) {
            const filePath = join(healthDir, file);
            const fileStats = fs.statSync(filePath);
            const fileAge = Date.now() - fileStats.mtime.getTime();

            // If health file updated in last 30 seconds, monitor is running
            if (fileAge < 30000) {
              const projectName = file.replace('-transcript-monitor-health.json', '');
              runningProjects.add(projectName);
            }
          }
        }
      }

    } catch (error) {
      if (process.env.DEBUG_STATUS) {
        console.error(`DEBUG: getRunningTranscriptMonitorsSync error: ${error.message}`);
      }
    }

    return runningProjects;
  }

  buildCombinedTooltip(constraint, semantic, knowledge) {
    const lines = ['⚙️ System Status Dashboard'];
    lines.push('━'.repeat(30));

    // Constraint Monitor Section
    lines.push('🛡️  CONSTRAINT MONITOR');
    if (constraint.status === 'operational') {
      lines.push(`   ✅ Status: Operational`);
      lines.push(`   📊 Compliance: ${constraint.compliance}/10.0`);
      if (constraint.violations === 0) {
        lines.push(`   🟢 Violations: None active`);
      } else {
        lines.push(`   ⚠️  Violations: ${constraint.violations} active`);
      }
    } else if (constraint.status === 'degraded') {
      lines.push(`   ⚠️  Status: Degraded`);
      lines.push(`   📊 Compliance: Checking...`);
    } else {
      lines.push(`   ❌ Status: Offline`);
      lines.push(`   📊 Compliance: N/A`);
    }

    lines.push('');

    // Semantic Analysis Section
    lines.push('🧠 SEMANTIC ANALYSIS');
    if (semantic.status === 'operational') {
      lines.push(`   ✅ Status: Operational`);
      lines.push(`   🔍 Analysis: Ready`);
      lines.push(`   📈 Insights: Available`);
    } else if (semantic.status === 'degraded') {
      lines.push(`   ⚠️  Status: Degraded`);
      lines.push(`   🔍 Analysis: Limited`);
    } else {
      lines.push(`   ❌ Status: Offline`);
      lines.push(`   🔍 Analysis: Unavailable`);
    }

    lines.push('');

    // Knowledge System Section
    lines.push('📚 KNOWLEDGE SYSTEM');
    if (knowledge.status === 'operational') {
      lines.push(`   ✅ Status: Operational`);
      lines.push(`   🔄 State: ${knowledge.extractionState || 'unknown'}`);
      if (knowledge.lastExtraction) {
        const lastTime = new Date(knowledge.lastExtraction).toLocaleTimeString();
        lines.push(`   ⏱️  Last Extraction: ${lastTime}`);
      }
      if (knowledge.errorCount > 0) {
        lines.push(`   ⚠️  Errors: ${knowledge.errorCount}`);
      }
    } else if (knowledge.status === 'disabled') {
      lines.push(`   ⏸️  Status: Disabled`);
      lines.push(`   💡 Enable in config`);
    } else {
      lines.push(`   ❌ Status: Offline`);
      lines.push(`   🔍 Extraction: Unavailable`);
    }

    lines.push('');
    lines.push('━'.repeat(30));
    lines.push('🖱️  Click to open constraint dashboard');
    lines.push('🔄 Updates every 5 seconds');

    return lines.join('\n');
  }

  // REMOVED: Duplicate buggy ensureTranscriptMonitorRunning() method
  // The correct version is at line 962 which properly passes project path
  // This duplicate was spawning monitors WITHOUT project path arguments,
  // causing orphaned processes to create files in wrong directories

  getErrorStatus(error) {
    return {
      text: '⚠️ SYS:ERR',
      color: 'red',
      tooltip: `System error: ${error.message || 'Unknown error'}`,
      onClick: 'open-dashboard'
    };
  }
}

// Main execution
async function main() {
  try {
    const timeout = setTimeout(() => {
      console.error('⚠️ SYS:TIMEOUT - Status line generation took >4s');
      console.log('⚠️ SYS:TIMEOUT');
      process.exit(1);
    }, 4000);

    const statusLine = new CombinedStatusLine();
    const status = await statusLine.generateStatus();

    clearTimeout(timeout);

    // Claude Code status line expects plain text output
    // Rich features like tooltips may need different configuration
    console.log(status.text);
    process.exit(0);
  } catch (error) {
    // CRITICAL: Log actual error to stderr so we can debug, not silent failure!
    console.error(`⚠️ FATAL ERROR in status line generation: ${error.message}`);
    console.error(error.stack);
    console.log('⚠️ SYS:ERR');
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

// Run main function
main();