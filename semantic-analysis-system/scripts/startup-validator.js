#!/usr/bin/env node

/**
 * Startup Validator
 * Comprehensive pre-startup system validation and diagnostics
 */

import { Logger } from '../shared/logger.js';
import { portManager } from '../shared/port-manager.js';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';

const logger = new Logger('startup-validator');

class StartupValidator {
  constructor() {
    this.validationResults = {
      passed: [],
      failed: [],
      warnings: []
    };
  }

  /**
   * Run comprehensive startup validation
   */
  async validate() {
    logger.info('🔍 Running startup validation...');

    const validations = [
      { name: 'System Requirements', fn: () => this.validateSystemRequirements() },
      { name: 'Port Availability', fn: () => this.validatePortAvailability() },
      { name: 'File Permissions', fn: () => this.validateFilePermissions() },
      { name: 'Dependencies', fn: () => this.validateDependencies() },
      { name: 'Environment', fn: () => this.validateEnvironment() },
      { name: 'Resource Conflicts', fn: () => this.validateResourceConflicts() }
    ];

    for (const validation of validations) {
      try {
        logger.info(`📋 Validating ${validation.name}...`);
        await validation.fn();
        this.validationResults.passed.push(validation.name);
        logger.info(`✅ ${validation.name} validation passed`);
      } catch (error) {
        this.validationResults.failed.push({
          name: validation.name,
          error: error.message
        });
        logger.error(`❌ ${validation.name} validation failed:`, error.message);
      }
    }

    this.printValidationSummary();
    return this.validationResults.failed.length === 0;
  }

  async validateSystemRequirements() {
    // Node.js version
    const nodeVersion = process.version;
    const major = parseInt(nodeVersion.substring(1).split('.')[0]);
    if (major < 16) {
      throw new Error(`Node.js version ${nodeVersion} not supported. Requires 16+`);
    }

    // Memory
    const memoryUsage = process.memoryUsage();
    const availableHeap = memoryUsage.heapTotal;
    if (availableHeap < 50 * 1024 * 1024) {
      this.validationResults.warnings.push('Low memory available');
    }

    // OS checks
    if (process.platform === 'win32') {
      this.validationResults.warnings.push('Windows platform - some features may be limited');
    }
  }

  async validatePortAvailability() {
    // Test all required ports
    const requiredPorts = [1883, 8081, 8080, 8082, 9090];
    const conflicts = [];

    for (const port of requiredPorts) {
      const isAvailable = await this.checkPortAvailable(port);
      if (!isAvailable) {
        const processInfo = await this.getPortProcess(port);
        conflicts.push({
          port,
          process: processInfo?.name || 'unknown',
          pid: processInfo?.pid || 'unknown'
        });
      }
    }

    if (conflicts.length > 0) {
      const conflictDetails = conflicts.map(c => 
        `Port ${c.port} occupied by ${c.process} (PID: ${c.pid})`
      ).join(', ');
      
      // Don't throw error - port manager should handle this
      this.validationResults.warnings.push(`Port conflicts detected: ${conflictDetails}`);
      logger.warn('Port conflicts will be resolved by port manager');
    }
  }

  async validateFilePermissions() {
    const criticalFiles = [
      './package.json',
      './shared/port-manager.js',
      './index.js'
    ];

    const criticalDirs = [
      './logs',
      './config',
      './shared'
    ];

    // Check file access
    for (const file of criticalFiles) {
      try {
        await fs.access(file, fs.constants.R_OK);
      } catch (error) {
        throw new Error(`Cannot read critical file: ${file}`);
      }
    }

    // Check/create directories
    for (const dir of criticalDirs) {
      try {
        await fs.access(dir);
      } catch (error) {
        try {
          await fs.mkdir(dir, { recursive: true });
          logger.info(`Created directory: ${dir}`);
        } catch (createError) {
          throw new Error(`Cannot create directory: ${dir} - ${createError.message}`);
        }
      }
    }
  }

  async validateDependencies() {
    try {
      const packageJson = JSON.parse(await fs.readFile('./package.json', 'utf8'));
      const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

      // Check critical dependencies
      const critical = ['aedes', 'mqtt', 'jayson', 'websocket-stream'];
      const missing = critical.filter(dep => !dependencies[dep]);

      if (missing.length > 0) {
        throw new Error(`Missing critical dependencies: ${missing.join(', ')}`);
      }

      // Try to import critical modules
      try {
        await import('aedes');
        await import('mqtt');
        await import('jayson/promise/index.js');
        await import('websocket-stream');
      } catch (importError) {
        throw new Error(`Cannot import dependencies: ${importError.message}`);
      }

    } catch (error) {
      throw new Error(`Dependency validation failed: ${error.message}`);
    }
  }

  async validateEnvironment() {
    // Check environment variables
    const optional = [
      'GOOGLE_API_KEY',
      'GOOGLE_CSE_ID',
      'CODING_TOOLS_PATH',
      'CODING_KB_PATH'
    ];

    const missing = optional.filter(env => !process.env[env]);
    if (missing.length > 0) {
      this.validationResults.warnings.push(`Optional environment variables not set: ${missing.join(', ')}`);
    }

    // Check working directory
    const cwd = process.cwd();
    if (!cwd.includes('semantic-analysis-system')) {
      this.validationResults.warnings.push('Not running from semantic-analysis-system directory');
    }
  }

  async validateResourceConflicts() {
    // Check for existing processes that might conflict
    const processNames = ['aedes', 'mqtt', 'semantic-analysis'];
    const conflicts = [];

    for (const processName of processNames) {
      const running = await this.findRunningProcesses(processName);
      if (running.length > 0) {
        conflicts.push({
          process: processName,
          count: running.length,
          pids: running
        });
      }
    }

    if (conflicts.length > 0) {
      const conflictDetails = conflicts.map(c => 
        `${c.process}: ${c.count} processes (PIDs: ${c.pids.join(', ')})`
      ).join(', ');
      
      this.validationResults.warnings.push(`Existing processes found: ${conflictDetails}`);
    }
  }

  // Utility methods
  async checkPortAvailable(port) {
    const net = await import('net');
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(port, () => {
        server.close(() => resolve(true));
      });
      server.on('error', () => resolve(false));
    });
  }

  async getPortProcess(port) {
    return new Promise((resolve) => {
      const lsof = spawn('lsof', ['-ti', `:${port}`]);
      let output = '';

      lsof.stdout.on('data', (data) => {
        output += data.toString();
      });

      lsof.on('close', (code) => {
        if (code === 0 && output.trim()) {
          const pid = output.trim().split('\n')[0];
          const ps = spawn('ps', ['-p', pid, '-o', 'comm=']);
          let name = '';
          
          ps.stdout.on('data', (data) => {
            name += data.toString();
          });
          
          ps.on('close', () => {
            resolve({ pid: parseInt(pid), name: name.trim() });
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  async findRunningProcesses(processName) {
    return new Promise((resolve) => {
      const pgrep = spawn('pgrep', ['-f', processName]);
      let output = '';

      pgrep.stdout.on('data', (data) => {
        output += data.toString();
      });

      pgrep.on('close', (code) => {
        if (code === 0 && output.trim()) {
          const pids = output.trim().split('\n').map(pid => parseInt(pid));
          resolve(pids);
        } else {
          resolve([]);
        }
      });
    });
  }

  printValidationSummary() {
    logger.info('\n📊 Validation Summary:');
    logger.info(`✅ Passed: ${this.validationResults.passed.length}`);
    logger.info(`❌ Failed: ${this.validationResults.failed.length}`);
    logger.info(`⚠️  Warnings: ${this.validationResults.warnings.length}`);

    if (this.validationResults.failed.length > 0) {
      logger.error('\n❌ Failed Validations:');
      this.validationResults.failed.forEach(failure => {
        logger.error(`  • ${failure.name}: ${failure.error}`);
      });
    }

    if (this.validationResults.warnings.length > 0) {
      logger.warn('\n⚠️  Warnings:');
      this.validationResults.warnings.forEach(warning => {
        logger.warn(`  • ${warning}`);
      });
    }

    if (this.validationResults.failed.length === 0) {
      logger.info('\n🎉 All critical validations passed! System ready for startup.');
    } else {
      logger.error('\n🚫 Critical validations failed! Please fix issues before startup.');
    }
  }
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const validator = new StartupValidator();
  
  validator.validate()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      logger.error('Validation failed:', error);
      process.exit(1);
    });
}

export { StartupValidator };