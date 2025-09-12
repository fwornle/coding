#!/usr/bin/env node

/**
 * Combined Status Line: Constraint Monitor + Semantic Analysis
 * 
 * Shows status of both live guardrails and semantic analysis services
 */

import fs, { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { getTimeWindow } from './timezone-utils.js';

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
      const liveLogTarget = await this.getCurrentLiveLogTarget();
      const redirectStatus = await this.getRedirectStatus();
      
      // Robust transcript monitor health check and auto-restart
      await this.ensureTranscriptMonitorRunning();
      
      const status = await this.buildCombinedStatus(constraintStatus, semanticStatus, liveLogTarget, redirectStatus);
      
      this.statusCache = status;
      this.lastUpdate = now;
      
      return status;
    } catch (error) {
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
      const currentTranche = getTimeWindow(now); // Pass Date directly - getTimeWindow expects local date
      
      if (process.env.DEBUG_STATUS) {
        console.error(`DEBUG: UTC time: ${now.getUTCHours()}:${now.getUTCMinutes()}`);
        console.error(`DEBUG: Local time (CEST): ${now.getHours()}:${now.getMinutes()}`);
        console.error(`DEBUG: Current tranche calculated: ${currentTranche}`);
      }
      
      // 2. Look for current tranche session files in BOTH coding and target project
      const today = new Date().toISOString().split('T')[0];
      const targetProject = process.env.CODING_TARGET_PROJECT || process.cwd();
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
          
          const currentTrancheFiles = fs.readdirSync(historyDir)
            .filter(f => f.includes(today) && f.includes(currentTranche) && f.includes('session') && f.endsWith('.md'));
          
          if (process.env.DEBUG_STATUS) {
            console.error(`DEBUG: Looking for files with: ${today} AND ${currentTranche} AND session.md`);
            console.error(`DEBUG: Found current tranche files:`, currentTrancheFiles);
          }
          
          if (currentTrancheFiles.length > 0) {
            // Found current tranche session file - calculate time remaining
            const remainingMinutes = this.calculateTimeRemaining(currentTranche);
            
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
      const remainingMinutes = this.calculateTimeRemaining(currentTranche);
      
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
        violations: constraintData.text.includes('⚠️') ? 1 : 0,
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
      const hasSemanticAnalysis = services.services.includes('semantic-analysis');
      
      if (hasSemanticAnalysis && services.services_running >= 2) {
        return { status: 'operational' };
      } else {
        return { status: 'degraded' };
      }
    } catch (error) {
      return { status: 'offline', error: error.message };
    }
  }

  async getAPIUsageEstimate() {
    try {
      // Check if we have cached API data that's still valid
      const now = Date.now();
      if (this.apiCache && (now - this.lastApiCheck) < this.apiCheckInterval) {
        return this.apiCache;
      }

      // Get API key from configured environment variables
      const apiKeyVars = this.config.api_key_env_vars || ['XAI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
      let apiKey = null;
      let provider = null;

      for (const envVar of apiKeyVars) {
        const key = process.env[envVar];
        if (key) {
          apiKey = key;
          if (key.startsWith('xai-')) {
            provider = 'xai';
          } else if (key.startsWith('sk-') && envVar.includes('OPENAI')) {
            provider = 'openai';
          } else if (key.startsWith('sk-ant-') || envVar.includes('ANTHROPIC')) {
            provider = 'anthropic';
          }
          break;
        }
      }

      let apiUsage = { percentage: 'unknown', tokensUsed: 0, remainingCredits: 'unknown', model: provider || 'unknown' };
      
      // Try to get actual usage if possible
      if (apiKey && provider) {
        const providerConfig = this.config.semantic_analysis?.models?.[provider];
        const usageEndpoint = this.config.credit_checking?.endpoints?.[provider];
        
        if (usageEndpoint && providerConfig) {
          try {
            const timeout = this.config.semantic_analysis?.timeout || 10000;
            const response = await fetch(`${providerConfig.base_url}${usageEndpoint}`, {
              headers: { 'Authorization': `Bearer ${apiKey}` },
              timeout: Math.min(timeout, 5000) // Cap at 5s for status checks
            }).catch(() => null);
            
            if (response?.ok) {
              const data = await response.json();
              
              if (provider === 'xai') {
                // XAI API returns actual dollar amounts
                const totalCredits = data.credit_limit || providerConfig.default_limit || 20.00;
                const usedCredits = data.total_usage || 0;
                const remainingCredits = Math.max(0, totalCredits - usedCredits);
                const remainingPercentage = Math.round((remainingCredits / totalCredits) * 100);
                
                apiUsage = {
                  percentage: Math.round((usedCredits / totalCredits) * 100),
                  tokensUsed: data.tokens_used || 0,
                  limit: totalCredits,
                  remainingCredits: remainingPercentage,
                  usedCredits,
                  model: provider
                };
              } else if (provider === 'anthropic') {
                // Anthropic usage API structure
                apiUsage = {
                  percentage: data.usage_percentage || 'unknown',
                  tokensUsed: data.total_tokens || 0,
                  remainingCredits: data.remaining_balance_percentage || 'unknown',
                  model: provider
                };
              }
              
              if (process.env.DEBUG_STATUS) {
                console.error(`${provider.toUpperCase()} API response:`, JSON.stringify(data, null, 2));
              }
            }
          } catch (error) {
            if (process.env.DEBUG_STATUS) {
              console.error(`${provider.toUpperCase()} API error: ${error.message}`);
            }
          }
        }
        
        // Provider-specific fallback estimates
        if (apiUsage.percentage === 'unknown') {
          const fallbackConfig = this.config.semantic_analysis?.fallback_credits || {};
          
          if (provider === 'xai') {
            // Conservative estimate for XAI users based on user feedback
            apiUsage = {
              percentage: 5, // Low usage estimate
              tokensUsed: 0,
              remainingCredits: fallbackConfig.conservative_estimate || 90,
              model: provider
            };
          } else if (provider === 'openai' || provider === 'anthropic') {
            // More conservative for other providers since no usage API
            apiUsage = {
              percentage: 25, // Moderate usage estimate
              tokensUsed: 0,
              remainingCredits: fallbackConfig.unknown_default || 75,
              model: provider
            };
          }
        }
        
        // Cache the result
        this.apiCache = apiUsage;
        this.lastApiCheck = now;
      }
      
      // If we can't get real usage, estimate from session activity
      if (apiUsage.percentage === 'unknown') {
        const today = new Date().toISOString().split('T')[0];
        const historyDir = join(rootDir, '.specstory/history');
        
        
        if (existsSync(historyDir)) {
          const files = fs.readdirSync(historyDir);
          const todayFiles = files.filter(f => f.includes(today) && f.endsWith('.md'));
          
          
          // More accurate estimation based on file content
          let totalContent = 0;
          todayFiles.slice(-5).forEach(file => {
            try {
              const content = fs.readFileSync(join(historyDir, file), 'utf8');
              totalContent += content.length;
            } catch (e) {}
          });
          
          // Rough token estimation: ~4 chars per token
          const estimatedTokens = Math.floor(totalContent / 4);
          const dailyLimit = 5000; // Conservative estimate for free tier
          const usedPercentage = Math.min(100, (estimatedTokens / dailyLimit) * 100);
          const remainingPercentage = Math.max(0, 100 - usedPercentage);
          
          apiUsage = {
            percentage: Math.round(usedPercentage),
            tokensUsed: estimatedTokens,
            limit: dailyLimit,
            remainingCredits: Math.round(remainingPercentage),
            model: 'grok'
          };
          
        }
      }
      
      return apiUsage;
    } catch (error) {
      return { percentage: 'unknown', tokensUsed: 0 };
    }
  }

  async getRedirectStatus() {
    try {
      // Only show redirect indicator when working OUTSIDE the coding project
      const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || rootDir;
      const targetProject = process.env.CODING_TARGET_PROJECT;
      
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
      // Check if integrated transcript monitor is running by looking for health file
      const codingPath = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || rootDir;
      const healthFile = join(codingPath, '.transcript-monitor-health');
      
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
      
      const { spawn } = await import('child_process');
      
      // Start monitor in background with proper environment
      const env = {
        ...process.env,
        CODING_TOOLS_PATH: codingPath,
        CODING_TARGET_PROJECT: process.env.CODING_TARGET_PROJECT || process.cwd()
      };
      
      const monitor = spawn('node', [monitorScript], {
        detached: true,
        stdio: 'ignore',
        env
      });
      
      monitor.unref(); // Allow parent to exit without waiting
      
      if (process.env.DEBUG_STATUS) {
        console.error('DEBUG: Started integrated transcript monitor with PID:', monitor.pid);
      }
    } catch (error) {
      if (process.env.DEBUG_STATUS) {
        console.error('DEBUG: Failed to start transcript monitor:', error.message);
      }
    }
  }

  async buildCombinedStatus(constraint, semantic, liveLogTarget, redirectStatus) {
    const parts = [];
    let overallColor = 'green';

    // Constraint Monitor Status - use original constraint status text to preserve trajectory
    if (constraint.status === 'operational') {
      if (constraint.rawData && constraint.rawData.text) {
        // Use the original constraint monitor text which includes trajectory
        parts.push(constraint.rawData.text);
      } else {
        const score = constraint.compliance.toFixed(1);
        const violationsCount = constraint.violations || 0;
        
        if (violationsCount > 0) {
          parts.push(`🛡️ ${score} ⚠️${violationsCount}`);
          overallColor = 'yellow';
        } else {
          parts.push(`🛡️ ${score} 🔍EX`); // Add back trajectory
        }
      }
    } else if (constraint.status === 'degraded') {
      parts.push('🛡️ ⚠️');
      overallColor = 'yellow';
    } else {
      parts.push('🛡️ ❌');
      overallColor = 'red';
    }

    // Semantic Analysis Status with API credit monitoring
    if (semantic.status === 'operational') {
      const apiUsage = await this.getAPIUsageEstimate();
      
      if (apiUsage.remainingCredits !== 'unknown') {
        const remaining = typeof apiUsage.remainingCredits === 'number' ? apiUsage.remainingCredits : 100;
        const thresholds = this.config.status_line?.display?.credit_thresholds || { critical: 10, warning: 20, moderate: 80 };
        
        if (remaining < thresholds.critical) {
          parts.push(`🧠 ❌${remaining}%`); // Critical - very low credits
          overallColor = 'red';
        } else if (remaining < thresholds.warning) {
          parts.push(`🧠 ⚠️${remaining}%`); // Warning - low credits
          if (overallColor === 'green') overallColor = 'yellow';
        } else if (remaining < thresholds.moderate) {
          parts.push(`🧠 ✅${remaining}%`); // Show percentage when moderate
        } else {
          parts.push('🧠 ✅'); // High credits - clean display
        }
      } else {
        parts.push('🧠 ✅'); // Unknown usage - assume OK
      }
    } else if (semantic.status === 'degraded') {
      parts.push('🧠 ⚠️');
      if (overallColor === 'green') overallColor = 'yellow';
    } else {
      parts.push('🧠 ❌');
      overallColor = 'red';
    }

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

  buildCombinedTooltip(constraint, semantic) {
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
    lines.push('━'.repeat(30));
    lines.push('🖱️  Click to open constraint dashboard');
    lines.push('🔄 Updates every 5 seconds');
    
    return lines.join('\n');
  }

  /**
   * Robust transcript monitor health check and auto-restart mechanism
   * Runs every 300ms via status line updates to ensure transcript monitor is always running
   */
  async ensureTranscriptMonitorRunning() {
    try {
      // Check if transcript monitor process is running  
      const { exec } = await import('child_process');
      const util = await import('util');
      const execAsync = util.promisify(exec);
      
      try {
        const { stdout } = await execAsync('ps aux | grep -v grep | grep enhanced-transcript-monitor');
        if (stdout.trim().length > 0) {
          // Transcript monitor is running
          return;
        }
      } catch (error) {
        // ps command failed or no process found
      }
      
      // Transcript monitor is not running - restart it
      const targetProject = process.env.CODING_TARGET_PROJECT || process.cwd();
      const codingPath = process.env.CODING_TOOLS_PATH || '/Users/q284340/Agentic/coding';
      
      // Start transcript monitor in background
      const startCommand = `cd "${targetProject}" && TRANSCRIPT_DEBUG=false node "${codingPath}/scripts/enhanced-transcript-monitor.js" > transcript-monitor.log 2>&1 &`;
      
      await execAsync(startCommand);
      
      if (process.env.DEBUG_STATUS) {
        console.error('🔄 Auto-restarted transcript monitor');
      }
      
    } catch (error) {
      if (process.env.DEBUG_STATUS) {
        console.error('❌ Failed to restart transcript monitor:', error.message);
      }
    }
  }

  getErrorStatus(error) {
    return {
      text: '⚠️SYS:ERR',
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
      console.log('⚠️SYS:TIMEOUT');
      process.exit(0);
    }, 4000);

    const statusLine = new CombinedStatusLine();
    const status = await statusLine.generateStatus();
    
    clearTimeout(timeout);
    
    // Claude Code status line expects plain text output
    // Rich features like tooltips may need different configuration
    console.log(status.text);
    process.exit(0);
  } catch (error) {
    console.log('⚠️SYS:ERR');
    process.exit(0);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

// Run main function
main();