#!/usr/bin/env node

/**
 * Combined Status Line: Constraint Monitor + Semantic Analysis
 * 
 * Shows status of both live guardrails and semantic analysis services
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { getGlobalCoordinator } from './live-logging-coordinator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

class CombinedStatusLine {
  constructor() {
    this.cacheTimeout = 5000; // 5 second cache
    this.lastUpdate = 0;
    this.statusCache = null;
  }

  async generateStatus() {
    try {
      const now = Date.now();
      if (this.statusCache && (now - this.lastUpdate) < this.cacheTimeout) {
        return this.statusCache;
      }

      const constraintStatus = await this.getConstraintStatus();
      const semanticStatus = await this.getSemanticStatus();
      
      const status = await this.buildCombinedStatus(constraintStatus, semanticStatus);
      
      // Capture this status generation as a tool interaction for live logging
      await this.captureStatusGeneration(status);
      
      this.statusCache = status;
      this.lastUpdate = now;
      
      return status;
    } catch (error) {
      return this.getErrorStatus(error);
    }
  }

  async captureStatusGeneration(status) {
    try {
      const coordinator = await getGlobalCoordinator();
      await coordinator.captureManualInteraction(
        'StatusLine',
        { type: 'status_generation', services: ['constraint-monitor', 'semantic-analysis'] },
        status,
        { 
          timestamp: Date.now(), 
          source: 'statusLine',
          workingDirectory: process.cwd()
        }
      );
    } catch (error) {
      // Silent fail - logging is optional
      console.debug('Status generation capture failed:', error.message);
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
      // Check XAI/Grok API usage (since we have XAI key, not Groq)
      let apiUsage = { percentage: 'unknown', tokensUsed: 0 };
      
      // Try to get actual usage if possible
      try {
        const response = await fetch('https://api.x.ai/v1/usage', {
          headers: { 'Authorization': `Bearer ${process.env.GROK_API_KEY}` },
          timeout: 2000
        }).catch(() => null);
        
        if (response?.ok) {
          const data = await response.json();
          apiUsage = {
            percentage: data.usage_percentage || 'unknown',
            tokensUsed: data.tokens_used || 0,
            limit: data.token_limit || 10000
          };
        }
      } catch (error) {
        // Fall back to session-based estimation
      }
      
      // If we can't get real usage, estimate from session activity
      if (apiUsage.percentage === 'unknown') {
        const today = new Date().toISOString().split('T')[0];
        const historyDir = join(rootDir, '.specstory/history');
        
        if (existsSync(historyDir)) {
          const files = require('fs').readdirSync(historyDir);
          const todayFiles = files.filter(f => f.includes(today) && f.endsWith('.md'));
          
          // More accurate estimation based on file content
          let totalContent = 0;
          todayFiles.slice(-5).forEach(file => {
            try {
              const content = require('fs').readFileSync(join(historyDir, file), 'utf8');
              totalContent += content.length;
            } catch (e) {}
          });
          
          // Rough token estimation: ~4 chars per token
          const estimatedTokens = Math.floor(totalContent / 4);
          const dailyLimit = 5000; // Conservative estimate for free tier
          const percentage = Math.min(100, (estimatedTokens / dailyLimit) * 100);
          
          apiUsage = {
            percentage: Math.round(percentage),
            tokensUsed: estimatedTokens,
            limit: dailyLimit
          };
        }
      }
      
      return apiUsage;
    } catch (error) {
      return { percentage: 'unknown', tokensUsed: 0 };
    }
  }

  async buildCombinedStatus(constraint, semantic) {
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

    // Semantic Analysis Status with API monitoring
    if (semantic.status === 'operational') {
      // Add API credit monitoring
      const apiUsage = await this.getAPIUsageEstimate();
      
      if (apiUsage.percentage !== 'unknown') {
        const usage = typeof apiUsage.percentage === 'number' ? apiUsage.percentage : 0;
        if (usage > 90) {
          parts.push(`🧠 ❌${usage}%`); // Critical - very high usage
          overallColor = 'red';
        } else if (usage > 80) {
          parts.push(`🧠 ⚠️${usage}%`); // Warning - high usage
          if (overallColor === 'green') overallColor = 'yellow';
        } else if (usage > 50) {
          parts.push(`🧠 ✅${usage}%`); // Show percentage when significant
        } else {
          parts.push('🧠 ✅'); // Low usage - clean display
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