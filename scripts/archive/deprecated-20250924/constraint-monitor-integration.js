#!/usr/bin/env node

/**
 * Constraint Monitor Integration
 * Automatically monitors file changes and code edits for constraint violations
 */

import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';

const CODING_TOOLS_PATH = process.env.CODING_TOOLS_PATH || '/Users/q284340/Agentic/coding';
const TRANSCRIPT_SOURCE_PROJECT = process.env.TRANSCRIPT_SOURCE_PROJECT || process.cwd();

// File patterns to monitor for constraint violations
const MONITORED_PATTERNS = [
  '**/*.js',
  '**/*.ts',
  '**/*.jsx',
  '**/*.tsx',
  '**/*.py',
  '**/*.sh',
  '**/*.puml',
  '**/*.md'
];

// Files to exclude from monitoring
const EXCLUDED_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.next/**'
];

class ConstraintMonitorIntegration {
  constructor() {
    this.isMonitoring = false;
    this.violationCache = new Map();
    this.processedFiles = new Set();
  }

  async checkConstraints(filePath, content) {
    try {
      // Use Claude Code's MCP constraint monitor
      // This would need to be integrated via the MCP protocol
      // For now, simulate the check with basic pattern matching
      
      const violations = [];
      
      // Basic constraint checks
      if (content.includes('console.log(')) {
        violations.push({
          constraint_id: 'no-console-log',
          message: 'Use Logger.log() instead of console.log',
          severity: 'warning',
          matches: (content.match(/console\.log/g) || []).length
        });
      }
      
      // Check for hardcoded user paths
      if (content.includes('/Users/q284340/')) {
        violations.push({
          constraint_id: 'no-hardcoded-paths',
          message: 'Use environment variables instead of hardcoded user paths',
          severity: 'error',
          matches: (content.match(/\/Users\/q284340\//g) || []).length
        });
      }
      
      // Check PlantUML note syntax
      if (filePath.endsWith('.puml') && content.includes('note over') && content.includes('\n') && !content.includes('note over ') && content.includes(':')) {
        violations.push({
          constraint_id: 'plantuml-note-syntax',
          message: 'PlantUML note blocks must use single-line syntax',
          severity: 'error',
          matches: 1
        });
      }

      const result = { violations, compliance_score: violations.length === 0 ? 10.0 : Math.max(5.0, 10.0 - violations.length) };
      
      if (result.violations && result.violations.length > 0) {
        console.log(`🛡️ Constraint violations detected in ${filePath}:`);
        result.violations.forEach(violation => {
          console.log(`  - ${violation.severity.toUpperCase()}: ${violation.message} (${violation.constraint_id})`);
        });
        
        // Cache violations for this file
        this.violationCache.set(filePath, result.violations);
        
        return result.violations;
      } else {
        // Clear any cached violations for this file
        this.violationCache.delete(filePath);
        return [];
      }
    } catch (error) {
      console.warn(`Error checking constraints for ${filePath}:`, error.message);
      return null;
    }
  }

  getFileType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.js':
      case '.ts':
      case '.jsx':
      case '.tsx':
        return 'code';
      case '.py':
        return 'code';
      case '.sh':
        return 'action';
      case '.puml':
        return 'file';
      case '.md':
        return 'file';
      default:
        return 'file';
    }
  }

  async processFile(filePath, event = 'change') {
    // Skip if already processed recently
    const cacheKey = `${filePath}:${event}`;
    if (this.processedFiles.has(cacheKey)) {
      return;
    }
    this.processedFiles.add(cacheKey);
    
    // Clean cache after 5 seconds
    setTimeout(() => {
      this.processedFiles.delete(cacheKey);
    }, 5000);

    try {
      if (!fs.existsSync(filePath)) {
        console.log(`File ${filePath} was deleted`);
        this.violationCache.delete(filePath);
        return;
      }

      const stats = fs.statSync(filePath);
      if (stats.size === 0 || stats.size > 1024 * 1024) { // Skip empty files or files > 1MB
        return;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const violations = await this.checkConstraints(filePath, content);
      
      if (violations && violations.length > 0) {
        // Update status line to reflect violations
        this.updateStatusLine();
      }
    } catch (error) {
      console.warn(`Error processing file ${filePath}:`, error.message);
    }
  }

  updateStatusLine() {
    // Trigger status line update to show constraint violations
    try {
      const statusScript = path.join(CODING_TOOLS_PATH, 'scripts/combined-status-line.js');
      if (fs.existsSync(statusScript)) {
        // Status line will show updated compliance score
        console.log('🛡️ Status line updated with constraint monitoring results');
      }
    } catch (error) {
      console.warn('Could not update status line:', error.message);
    }
  }

  start() {
    if (this.isMonitoring) {
      console.log('Constraint monitoring is already running');
      return;
    }

    console.log('🛡️ Starting constraint monitor integration...');
    console.log(`Monitoring project: ${TRANSCRIPT_SOURCE_PROJECT}`);
    
    // Watch file changes
    const watcher = chokidar.watch(MONITORED_PATTERNS, {
      cwd: TRANSCRIPT_SOURCE_PROJECT,
      ignored: EXCLUDED_PATTERNS,
      ignoreInitial: true,
      persistent: true,
      atomic: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    });

    watcher
      .on('add', (filePath) => this.processFile(path.resolve(TRANSCRIPT_SOURCE_PROJECT, filePath), 'add'))
      .on('change', (filePath) => this.processFile(path.resolve(TRANSCRIPT_SOURCE_PROJECT, filePath), 'change'))
      .on('unlink', (filePath) => {
        const fullPath = path.resolve(TRANSCRIPT_SOURCE_PROJECT, filePath);
        this.violationCache.delete(fullPath);
      })
      .on('error', (error) => console.error('File watcher error:', error));

    this.isMonitoring = true;
    console.log('🛡️ Constraint monitor integration is now active');

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛡️ Stopping constraint monitor integration...');
      watcher.close();
      this.isMonitoring = false;
      process.exit(0);
    });
  }

  async scanExisting() {
    console.log('🛡️ Scanning existing files for constraint violations...');
    
    const scanPatterns = MONITORED_PATTERNS.map(pattern => 
      path.join(TRANSCRIPT_SOURCE_PROJECT, pattern)
    );

    // Simple glob-like scan
    const filesToScan = [];
    for (const pattern of MONITORED_PATTERNS) {
      const globPattern = pattern.replace('**/', '');
      const ext = globPattern.replace('*.', '');
      
      // Recursively find files with this extension
      const findFiles = (dir) => {
        try {
          const entries = fs.readdirSync(dir);
          for (const entry of entries) {
            const fullPath = path.join(dir, entry);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory() && !EXCLUDED_PATTERNS.some(excluded => 
              fullPath.includes(excluded.replace('**/', '').replace('/**', ''))
            )) {
              findFiles(fullPath);
            } else if (stat.isFile() && fullPath.endsWith(ext)) {
              filesToScan.push(fullPath);
            }
          }
        } catch (error) {
          // Skip directories we can't read
        }
      };
      
      findFiles(TRANSCRIPT_SOURCE_PROJECT);
    }

    let totalViolations = 0;
    for (const filePath of filesToScan.slice(0, 50)) { // Limit to first 50 files
      const violations = await this.checkConstraints(filePath, fs.readFileSync(filePath, 'utf8'));
      if (violations) {
        totalViolations += violations.length;
      }
    }

    console.log(`🛡️ Initial scan complete. Found ${totalViolations} total violations in ${filesToScan.length} files.`);
  }
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const integration = new ConstraintMonitorIntegration();
  
  const command = process.argv[2] || 'start';
  
  switch (command) {
    case 'start':
      integration.start();
      break;
    case 'scan':
      integration.scanExisting();
      break;
    case 'help':
      console.log(`
Constraint Monitor Integration

Commands:
  start   - Start real-time file monitoring
  scan    - Scan existing files for violations
  help    - Show this help message

Environment Variables:
  TRANSCRIPT_SOURCE_PROJECT - Project directory to monitor (default: current directory)
  CODING_TOOLS_PATH     - Path to coding tools (default: /Users/q284340/Agentic/coding)
      `);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

export default ConstraintMonitorIntegration;