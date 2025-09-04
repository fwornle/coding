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
// Removed live-logging-coordinator import to prevent console output

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
      
      const status = await this.buildCombinedStatus(constraintStatus, semanticStatus, liveLogTarget);
      
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
      // 1. Check for today's most recent live session files first
      const today = new Date().toISOString().split('T')[0];
      const historyDir = join(rootDir, '.specstory/history');
      
      if (existsSync(historyDir)) {
        const files = fs.readdirSync(historyDir)
          .filter(f => f.includes(today) && (f.includes('-session.md') || f.includes('live-transcript') || f.includes('live-session')))
          .map(f => {
            const filePath = join(historyDir, f);
            const stats = fs.statSync(filePath);
            return { file: f, mtime: stats.mtime };
          })
          .sort((a, b) => b.mtime - a.mtime); // Most recent first by modification time
        
        if (files.length > 0) {
          const mostRecent = files[0].file;
          
          if (process.env.DEBUG_STATUS) {
            console.error(`Most recent live file: ${mostRecent}`);
          }
          
          // Show appropriate filename format based on type
          if (mostRecent.includes('-session.md')) {
            // For session files, show time range: 1030-1130-session
            const timeMatch = mostRecent.match(/(\d{4}-\d{4})-session/);
            if (timeMatch) {
              const timeRange = timeMatch[1];
              const remainingMinutes = this.calculateTimeRemaining(timeRange);
              
              // Add color coding based on time remaining
              let sessionDisplay = `${timeRange}-session`;
              if (remainingMinutes !== null && remainingMinutes <= 5 && remainingMinutes > 0) {
                // Orange warning for last 5 minutes with time display
                sessionDisplay = `🟠${timeRange}-session(${remainingMinutes}min)`;
              } else if (remainingMinutes !== null && remainingMinutes <= 0) {
                // Red if past session end
                sessionDisplay = `🔴${timeRange}-session(ended)`;
              }
              
              return sessionDisplay;
            }
            return mostRecent.replace('.md', '');
          } else if (mostRecent.includes('live-transcript') || mostRecent.includes('live-session')) {
            return mostRecent.replace('.md', '');
          }
          
          // Fallback: show full filename
          return mostRecent.replace('.md', '');
        }
      }
      
      // 2. Check current transcript to predict target filename
      const os = await import('os');
      const homeDir = os.homedir();
      const transcriptDir = join(homeDir, '.claude', 'projects', '-Users-q284340-Agentic-coding');
      
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
      const now = new Date();
      const timeId = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
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
      const apiKeyVars = this.config.api_key_env_vars || ['GROQ_API_KEY', 'GROK_API_KEY', 'XAI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
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

  async buildCombinedStatus(constraint, semantic, liveLogTarget) {
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

    // Add live log target filename inline at the end
    if (liveLogTarget && liveLogTarget !== '----') {
      parts.push(`📋${liveLogTarget}`);
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