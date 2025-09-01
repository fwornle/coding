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
      
      const status = this.buildCombinedStatus(constraintStatus, semanticStatus);
      
      this.statusCache = status;
      this.lastUpdate = now;
      
      return status;
    } catch (error) {
      return this.getErrorStatus(error);
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
      return { 
        status: 'operational', 
        text: constraintData.text,
        compliance: 8.5,
        violations: 0 
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

  buildCombinedStatus(constraint, semantic) {
    const parts = [];
    let overallColor = 'green';
    
    // ANSI color codes for Claude Code status line
    const colors = {
      green: '\x1b[32m',
      yellow: '\x1b[33m', 
      red: '\x1b[31m',
      reset: '\x1b[0m'
    };

    // Constraint Monitor Status
    if (constraint.status === 'operational') {
      if (constraint.text) {
        parts.push(constraint.text);
      } else {
        parts.push('🛡️ 8.5');  // Added space for better rendering
      }
    } else if (constraint.status === 'degraded') {
      parts.push('🛡️ ⚠️');   // Added space for better rendering
      overallColor = 'yellow';
    } else {
      parts.push('🛡️ ❌');   // Added space for better rendering
      overallColor = 'red';
    }

    // Semantic Analysis Status
    if (semantic.status === 'operational') {
      parts.push('🧠 ✅');  // Added space for better rendering
    } else if (semantic.status === 'degraded') {
      parts.push('🧠 ⚠️'); // Added space for better rendering
      if (overallColor === 'green') overallColor = 'yellow';
    } else {
      parts.push('🧠 ❌'); // Added space for better rendering
      overallColor = 'red';
    }

    const statusText = parts.join(' ');
    const colorCode = colors[overallColor] || colors.green;
    
    return {
      text: `${colorCode}${statusText}${colors.reset}`,
      color: overallColor
    };
  }

  getErrorStatus(error) {
    return {
      text: '\x1b[31m⚠️SYS:ERR\x1b[0m',
      color: 'red'
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
    
    // Claude Code expects plain text output, not JSON
    // First line of stdout becomes the status line text
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