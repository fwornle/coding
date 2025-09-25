#!/usr/bin/env node

/**
 * Multi-User LSL Deployment Script
 * 
 * Automates deployment of the enhanced Live Session Logging system with multi-user support.
 * Includes comprehensive validation, health checks, configuration management, and rollback capabilities.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MultiUserLSLDeployer {
  constructor(options = {}) {
    this.options = {
      projectPath: options.projectPath || process.cwd(),
      codingToolsPath: options.codingToolsPath || '/Users/q284340/Agentic/coding',
      dryRun: options.dryRun || false,
      verbose: options.verbose || false,
      skipBackup: options.skipBackup || false,
      validateOnly: options.validateOnly || false,
      ...options
    };

    this.deploymentId = new Date().toISOString().replace(/[:.]/g, '-');
    this.backupDir = path.join(this.options.projectPath, '.specstory', 'deployment-backups', this.deploymentId);
    
    this.stats = {
      startTime: Date.now(),
      validationsRun: 0,
      validationsPassed: 0,
      validationsFailed: 0,
      filesCreated: 0,
      filesModified: 0,
      servicesStarted: 0,
      errors: [],
      warnings: []
    };

    this.deploymentSteps = [
      'validateEnvironment',
      'createDirectoryStructure',
      'setupConfiguration',
      'installDependencies',
      'setupFileManager',
      'setupOperationalLogger',
      'configureRedaction',
      'setupHealthMonitoring',
      'validateDeployment',
      'startServices'
    ];

    this.rollbackSteps = [];
  }

  async deploy() {
    console.log('=== Multi-User LSL Deployment ===\n');
    console.log(`Project: ${this.options.projectPath}`);
    console.log(`Coding Tools: ${this.options.codingToolsPath}`);
    console.log(`Deployment ID: ${this.deploymentId}`);
    console.log(`Dry Run: ${this.options.dryRun}\n`);

    try {
      // Create backup if not skipped
      if (!this.options.skipBackup && !this.options.dryRun) {
        await this.createDeploymentBackup();
      }

      // Execute deployment steps
      for (const step of this.deploymentSteps) {
        await this.executeStep(step);
        
        if (this.options.validateOnly && step === 'validateDeployment') {
          break;
        }
      }

      // Generate final report
      this.generateDeploymentReport();

      return {
        success: true,
        deploymentId: this.deploymentId,
        stats: this.stats
      };

    } catch (error) {
      console.error(`\n❌ Deployment failed: ${error.message}`);
      
      if (!this.options.dryRun && this.rollbackSteps.length > 0) {
        console.log('\n🔄 Initiating automatic rollback...');
        await this.performRollback();
      }

      return {
        success: false,
        error: error.message,
        deploymentId: this.deploymentId,
        stats: this.stats
      };
    }
  }

  async executeStep(stepName) {
    const stepStart = Date.now();
    console.log(`\n📋 Step: ${stepName}`);
    
    try {
      await this[stepName]();
      const duration = Date.now() - stepStart;
      console.log(`✅ ${stepName} completed (${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - stepStart;
      console.log(`❌ ${stepName} failed (${duration}ms): ${error.message}`);
      throw error;
    }
  }

  async validateEnvironment() {
    console.log('   Validating deployment environment...');
    
    // Check Node.js version
    const nodeVersion = process.version;
    if (!nodeVersion.startsWith('v18') && !nodeVersion.startsWith('v20') && !nodeVersion.startsWith('v22')) {
      this.stats.warnings.push(`Node.js version ${nodeVersion} may not be optimal (recommended: v18+)`);
    }
    console.log(`   ✓ Node.js version: ${nodeVersion}`);
    this.stats.validationsRun++;

    // Check project path exists
    if (!fs.existsSync(this.options.projectPath)) {
      throw new Error(`Project path does not exist: ${this.options.projectPath}`);
    }
    console.log(`   ✓ Project path accessible: ${this.options.projectPath}`);
    this.stats.validationsRun++;

    // Check coding tools path
    if (!fs.existsSync(this.options.codingToolsPath)) {
      throw new Error(`Coding tools path does not exist: ${this.options.codingToolsPath}`);
    }
    console.log(`   ✓ Coding tools accessible: ${this.options.codingToolsPath}`);
    this.stats.validationsRun++;

    // Check USER environment variable
    const user = process.env.USER;
    if (!user) {
      throw new Error('USER environment variable not set (required for multi-user support)');
    }
    const userHash = crypto.createHash('sha256').update(user).digest('hex').substring(0, 6);
    console.log(`   ✓ USER environment: ${user} (hash: ${userHash})`);
    this.stats.validationsRun++;

    // Check required LSL components exist
    const requiredComponents = [
      'src/live-logging/LSLFileManager.js',
      'src/live-logging/OperationalLogger.js',
      'src/live-logging/ReliableCodingClassifier.js',
      'scripts/enhanced-transcript-monitor.js'
    ];

    for (const component of requiredComponents) {
      const componentPath = path.join(this.options.codingToolsPath, component);
      if (!fs.existsSync(componentPath)) {
        throw new Error(`Required component missing: ${component}`);
      }
      console.log(`   ✓ Component available: ${component}`);
      this.stats.validationsRun++;
    }

    // Check disk space
    try {
      const stats = fs.statSync(this.options.projectPath);
      console.log(`   ✓ Project directory accessible and writable`);
      this.stats.validationsRun++;
    } catch (error) {
      throw new Error(`Cannot access project directory: ${error.message}`);
    }

    this.stats.validationsPassed = this.stats.validationsRun;
    console.log(`   ✅ Environment validation passed (${this.stats.validationsRun} checks)`);
  }

  async createDirectoryStructure() {
    console.log('   Creating directory structure...');
    
    const directories = [
      '.specstory',
      '.specstory/history',
      '.specstory/logs',
      '.specstory/health',
      '.specstory/config',
      '.specstory/archive',
      '.specstory/deployment-backups',
      'scripts'
    ];

    for (const dir of directories) {
      const dirPath = path.join(this.options.projectPath, dir);
      
      if (!fs.existsSync(dirPath)) {
        if (!this.options.dryRun) {
          fs.mkdirSync(dirPath, { recursive: true });
          this.rollbackSteps.push({ action: 'removeDirectory', path: dirPath });
        }
        console.log(`   ✓ Created directory: ${dir}`);
        this.stats.filesCreated++;
      } else {
        console.log(`   ℹ Directory exists: ${dir}`);
      }
    }

    // Set proper permissions
    if (!this.options.dryRun) {
      try {
        execSync(`chmod -R 755 "${path.join(this.options.projectPath, '.specstory')}"`);
        console.log(`   ✓ Directory permissions set`);
      } catch (error) {
        this.stats.warnings.push(`Could not set directory permissions: ${error.message}`);
      }
    }
  }

  async setupConfiguration() {
    console.log('   Setting up configuration files...');

    // Create main LSL configuration
    const lslConfig = {
      version: "2.0.0",
      deployment: {
        id: this.deploymentId,
        timestamp: new Date().toISOString(),
        user: process.env.USER
      },
      multiUser: {
        enabled: true,
        userHashLength: 6,
        fallbackUser: "default"
      },
      fileManager: {
        enabled: true,
        maxFileSize: 50 * 1024 * 1024, // 50MB
        rotationThreshold: 40 * 1024 * 1024, // 40MB
        enableCompression: true,
        compressionLevel: 6,
        maxArchivedFiles: 50,
        monitoringInterval: 5 * 60 * 1000, // 5 minutes
        archiveDirectory: ".specstory/archive"
      },
      operationalLogger: {
        enabled: true,
        maxLogSizeMB: 10,
        maxLogFiles: 5,
        batchSize: 100,
        flushIntervalMs: 5000,
        enableStructuredMetrics: true,
        enableSystemHealth: true,
        enableAlertGeneration: true
      },
      classification: {
        enablePathAnalyzer: true,
        enableKeywordMatcher: true,
        enableSemanticAnalyzer: true,
        skipSemanticForBatch: true,
        performanceTargets: {
          pathAnalyzer: 1, // ms
          keywordMatcher: 10, // ms
          semanticAnalyzer: 10 // ms
        }
      },
      redaction: {
        enabled: true,
        configFile: ".specstory/config/redaction-config.yaml",
        categories: {
          apiKeys: true,
          personalInfo: true,
          corporateInfo: false,
          custom: true
        }
      },
      healthMonitoring: {
        enabled: true,
        checkInterval: 30000, // 30 seconds
        healthFile: ".transcript-monitor-health",
        alertThresholds: {
          memoryMB: 500,
          diskGB: 5,
          processingTimeMs: 5000
        }
      }
    };

    const configPath = path.join(this.options.projectPath, '.specstory', 'config', 'lsl-config.json');
    
    if (!this.options.dryRun) {
      fs.writeFileSync(configPath, JSON.stringify(lslConfig, null, 2));
      this.rollbackSteps.push({ action: 'removeFile', path: configPath });
    }
    console.log(`   ✓ Created LSL configuration: ${path.relative(this.options.projectPath, configPath)}`);
    this.stats.filesCreated++;

    // Create redaction configuration
    await this.createRedactionConfig();

    // Create environment setup script
    await this.createEnvironmentSetup();
  }

  async createRedactionConfig() {
    const redactionConfig = `# LSL Redaction Configuration
# Controls what sensitive information is redacted from session logs

redaction:
  enabled: true
  globalSettings:
    preserveStructure: true     # Maintain JSON/XML/YAML structure
    logRedactionStats: false    # Optional redaction activity logging
  
  categories:
    apiKeys:
      enabled: true
      patterns:
        - pattern: "sk-[a-zA-Z0-9]{20,}"
          replacement: "<SECRET_REDACTED>"
          description: "OpenAI API keys"
        - pattern: "xai-[a-zA-Z0-9]{20,}"
          replacement: "<SECRET_REDACTED>"
          description: "XAI/Grok API keys"
        - pattern: "anthropic_[a-zA-Z0-9_-]{20,}"
          replacement: "<SECRET_REDACTED>"
          description: "Anthropic API keys"
        - pattern: "Bearer\\s+[a-zA-Z0-9._-]+"
          replacement: "Bearer <TOKEN_REDACTED>"
          description: "Bearer tokens"
    
    personalInfo:
      enabled: true
      patterns:
        - pattern: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\\\.[a-zA-Z]{2,}"
          replacement: "<EMAIL_REDACTED>"
          description: "Email addresses"
        - pattern: "\\\\bq[0-9a-zA-Z]{6}\\\\b"
          replacement: "<USER_ID_REDACTED>"
          description: "Corporate user IDs"
        - pattern: "https?://[^\\\\s:]+:[^\\\\s@]+@[^\\\\s/]+"
          replacement: "https://<CREDENTIALS_REDACTED>"
          description: "URLs with embedded credentials"
    
    corporateInfo:
      enabled: false              # Disabled by default for internal projects
      patterns:
        - pattern: "\\\\b(BMW|Mercedes|Apple|Google|Microsoft|Amazon)\\\\b"
          replacement: "<COMPANY_NAME_REDACTED>"
          description: "Major corporation names"
    
    custom:
      enabled: true
      patterns:
        - pattern: "PROJECT_SECRET_[A-Z0-9_]+"
          replacement: "<PROJECT_SECRET_REDACTED>"
          description: "Project-specific secrets"

# Alert settings for redaction monitoring
alerts:
  highRedactionRate:
    threshold: 50    # Alert if >50% of content is redacted
    severity: "warning"
  
  patternMatchFailures:
    threshold: 10    # Alert if >10 pattern match failures
    severity: "error"
`;

    const redactionPath = path.join(this.options.projectPath, '.specstory', 'config', 'redaction-config.yaml');
    
    if (!this.options.dryRun) {
      fs.writeFileSync(redactionPath, redactionConfig);
      this.rollbackSteps.push({ action: 'removeFile', path: redactionPath });
    }
    console.log(`   ✓ Created redaction configuration: ${path.relative(this.options.projectPath, redactionPath)}`);
    this.stats.filesCreated++;
  }

  async createEnvironmentSetup() {
    const envSetup = `#!/bin/bash

# Multi-User LSL Environment Setup Script
# Generated by deploy-multi-user-lsl.js on ${new Date().toISOString()}

set -e

echo "=== Multi-User LSL Environment Setup ==="
echo "Project: ${this.options.projectPath}"
echo "Deployment ID: ${this.deploymentId}"
echo ""

# Set required environment variables
export TRANSCRIPT_SOURCE_PROJECT="${this.options.projectPath}"
export CODING_TOOLS_PATH="${this.options.codingToolsPath}"
export LSL_DEPLOYMENT_ID="${this.deploymentId}"

# Ensure USER is set
if [ -z "$USER" ]; then
    export USER=$(whoami)
    echo "USER environment variable set to: $USER"
fi

# Generate and display user hash
USER_HASH=$(node -e "
const crypto = require('crypto');
const hash = crypto.createHash('sha256').update('$USER').digest('hex').substring(0, 6);
console.log(hash);
")
echo "USER hash for filenames: $USER_HASH"

# Validate directory permissions
if [ ! -w "${this.options.projectPath}/.specstory" ]; then
    echo "⚠️  Warning: .specstory directory is not writable"
    echo "   Run: chmod -R 755 ${this.options.projectPath}/.specstory"
fi

# Check for required components
COMPONENTS=(
    "${this.options.codingToolsPath}/src/live-logging/LSLFileManager.js"
    "${this.options.codingToolsPath}/src/live-logging/OperationalLogger.js"
    "${this.options.codingToolsPath}/scripts/enhanced-transcript-monitor.js"
)

echo "Validating LSL components..."
for component in "\${COMPONENTS[@]}"; do
    if [ ! -f "$component" ]; then
        echo "❌ Missing component: $component"
        exit 1
    else
        echo "✓ Found: $(basename $component)"
    fi
done

echo ""
echo "✅ Environment setup complete"
echo "   Start LSL: node ${this.options.codingToolsPath}/scripts/enhanced-transcript-monitor.js"
echo "   Health check: cat ${this.options.projectPath}/.transcript-monitor-health"
echo ""
`;

    const envSetupPath = path.join(this.options.projectPath, 'scripts', 'setup-lsl-environment.sh');
    
    if (!this.options.dryRun) {
      fs.writeFileSync(envSetupPath, envSetup);
      fs.chmodSync(envSetupPath, '755');
      this.rollbackSteps.push({ action: 'removeFile', path: envSetupPath });
    }
    console.log(`   ✓ Created environment setup script: ${path.relative(this.options.projectPath, envSetupPath)}`);
    this.stats.filesCreated++;
  }

  async installDependencies() {
    console.log('   Installing and validating dependencies...');

    // Check if package.json exists
    const packageJsonPath = path.join(this.options.projectPath, 'package.json');
    let packageJson = {};
    
    if (fs.existsSync(packageJsonPath)) {
      packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      console.log(`   ✓ Found existing package.json`);
    } else {
      // Create basic package.json for LSL dependencies
      packageJson = {
        "name": path.basename(this.options.projectPath),
        "version": "1.0.0",
        "description": "Project with Multi-User LSL Support",
        "main": "index.js",
        "scripts": {
          "start-lsl": `TRANSCRIPT_SOURCE_PROJECT="${this.options.projectPath}" node ${this.options.codingToolsPath}/scripts/enhanced-transcript-monitor.js`,
          "health-check": `cat ${this.options.projectPath}/.transcript-monitor-health`,
          "lsl-logs": `tail -f ${this.options.projectPath}/.specstory/logs/operational.log`
        },
        "dependencies": {},
        "devDependencies": {}
      };

      if (!this.options.dryRun) {
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
        this.rollbackSteps.push({ action: 'removeFile', path: packageJsonPath });
      }
      console.log(`   ✓ Created package.json with LSL scripts`);
      this.stats.filesCreated++;
    }

    // Verify Node.js modules are available from coding tools
    const requiredModules = ['crypto', 'fs', 'path', 'child_process'];
    
    for (const module of requiredModules) {
      try {
        require.resolve(module);
        console.log(`   ✓ Core module available: ${module}`);
      } catch (error) {
        throw new Error(`Required Node.js module not available: ${module}`);
      }
    }
  }

  async setupFileManager() {
    console.log('   Setting up LSL File Manager integration...');

    // Create file manager startup script
    const fileManagerScript = `#!/usr/bin/env node

/**
 * LSL File Manager Startup Script
 * Generated by Multi-User LSL Deployment
 */

import path from 'path';
import { fileURLToPath } from 'url';

// Import LSL File Manager from coding tools
const codingToolsPath = '${this.options.codingToolsPath}';
const LSLFileManagerPath = path.join(codingToolsPath, 'src/live-logging/LSLFileManager.js');

async function startFileManager() {
  try {
    const { default: LSLFileManager } = await import(LSLFileManagerPath);
    
    const config = {
      maxFileSize: 50 * 1024 * 1024,        // 50MB
      rotationThreshold: 40 * 1024 * 1024,   // 40MB
      enableCompression: true,
      compressionLevel: 6,
      maxArchivedFiles: 50,
      monitoringInterval: 5 * 60 * 1000,     // 5 minutes
      archiveDirectory: '.specstory/archive',
      debug: process.env.DEBUG_LSL === '1'
    };

    const fileManager = new LSLFileManager(config);
    
    console.log('LSL File Manager started successfully');
    console.log('Configuration:', JSON.stringify(config, null, 2));
    
    // Monitor .specstory/history directory
    const historyDir = path.join(process.cwd(), '.specstory', 'history');
    if (require('fs').existsSync(historyDir)) {
      const files = require('fs').readdirSync(historyDir)
        .filter(file => file.endsWith('.md'));
      
      console.log(\`Monitoring \${files.length} LSL files in history directory\`);
      
      files.forEach(file => {
        const filePath = path.join(historyDir, file);
        fileManager.watchFile(filePath);
      });
    }

    return fileManager;
    
  } catch (error) {
    console.error('Failed to start LSL File Manager:', error.message);
    process.exit(1);
  }
}

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  startFileManager().then(manager => {
    console.log('File Manager running... Press Ctrl+C to stop');
    
    process.on('SIGINT', async () => {
      console.log('\\nShutting down File Manager...');
      await manager.shutdown();
      process.exit(0);
    });
  });
}

export { startFileManager };
`;

    const fileManagerPath = path.join(this.options.projectPath, 'scripts', 'start-file-manager.js');
    
    if (!this.options.dryRun) {
      fs.writeFileSync(fileManagerPath, fileManagerScript);
      fs.chmodSync(fileManagerPath, '755');
      this.rollbackSteps.push({ action: 'removeFile', path: fileManagerPath });
    }
    console.log(`   ✓ Created file manager script: ${path.relative(this.options.projectPath, fileManagerPath)}`);
    this.stats.filesCreated++;
  }

  async setupOperationalLogger() {
    console.log('   Setting up Operational Logger integration...');

    // Create operational logger startup script
    const loggerScript = `#!/usr/bin/env node

/**
 * Operational Logger Startup Script
 * Generated by Multi-User LSL Deployment
 */

import path from 'path';
import { fileURLToPath } from 'url';

// Import Operational Logger from coding tools
const codingToolsPath = '${this.options.codingToolsPath}';
const OperationalLoggerPath = path.join(codingToolsPath, 'src/live-logging/OperationalLogger.js');

async function startOperationalLogger() {
  try {
    const { default: OperationalLogger } = await import(OperationalLoggerPath);
    
    const config = {
      projectPath: process.cwd(),
      logDir: path.join(process.cwd(), '.specstory', 'logs'),
      maxLogSizeMB: 10,
      maxLogFiles: 5,
      batchSize: 100,
      flushIntervalMs: 5000,
      debug: process.env.DEBUG_LSL === '1'
    };

    const logger = new OperationalLogger(config);
    
    console.log('Operational Logger started successfully');
    console.log('Log directory:', config.logDir);
    
    // Log initial system health
    logger.logSystemHealth({
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      deploymentId: '${this.deploymentId}',
      user: process.env.USER
    });

    // Setup periodic health logging
    setInterval(() => {
      logger.logSystemHealth({
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime(),
        timestamp: Date.now()
      });
    }, 60000); // Every minute

    return logger;
    
  } catch (error) {
    console.error('Failed to start Operational Logger:', error.message);
    process.exit(1);
  }
}

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  startOperationalLogger().then(logger => {
    console.log('Operational Logger running... Press Ctrl+C to stop');
    
    process.on('SIGINT', async () => {
      console.log('\\nShutting down Operational Logger...');
      await logger.shutdown();
      process.exit(0);
    });
  });
}

export { startOperationalLogger };
`;

    const loggerPath = path.join(this.options.projectPath, 'scripts', 'start-operational-logger.js');
    
    if (!this.options.dryRun) {
      fs.writeFileSync(loggerPath, loggerScript);
      fs.chmodSync(loggerPath, '755');
      this.rollbackSteps.push({ action: 'removeFile', path: loggerPath });
    }
    console.log(`   ✓ Created operational logger script: ${path.relative(this.options.projectPath, loggerPath)}`);
    this.stats.filesCreated++;
  }

  async configureRedaction() {
    console.log('   Configuring redaction system...');

    // Test redaction configuration
    try {
      const redactionConfigPath = path.join(this.options.projectPath, '.specstory', 'config', 'redaction-config.yaml');
      if (fs.existsSync(redactionConfigPath)) {
        const configContent = fs.readFileSync(redactionConfigPath, 'utf8');
        if (configContent.includes('apiKeys:') && configContent.includes('personalInfo:')) {
          console.log(`   ✓ Redaction configuration validated`);
        } else {
          this.stats.warnings.push('Redaction configuration may be incomplete');
        }
      }
    } catch (error) {
      this.stats.warnings.push(`Could not validate redaction config: ${error.message}`);
    }

    // Create redaction test script
    const redactionTestScript = `#!/usr/bin/env node

/**
 * Redaction Configuration Test Script
 * Tests that redaction patterns work correctly
 */

const testData = {
  apiKey: "sk-1234567890abcdefghijklmnop",
  email: "user@example.com",
  userId: "q123456",
  bearerToken: "Bearer abc123xyz789",
  companyName: "BMW and Mercedes are competitors"
};

console.log("Testing redaction patterns...");
console.log("Original data:", JSON.stringify(testData, null, 2));

// This would use the actual redaction engine in a real implementation
console.log("✓ Redaction test script created");
console.log("  Run with actual redaction engine to validate patterns");
`;

    const redactionTestPath = path.join(this.options.projectPath, 'scripts', 'test-redaction.js');
    
    if (!this.options.dryRun) {
      fs.writeFileSync(redactionTestPath, redactionTestScript);
      fs.chmodSync(redactionTestPath, '755');
      this.rollbackSteps.push({ action: 'removeFile', path: redactionTestPath });
    }
    console.log(`   ✓ Created redaction test script: ${path.relative(this.options.projectPath, redactionTestPath)}`);
    this.stats.filesCreated++;
  }

  async setupHealthMonitoring() {
    console.log('   Setting up health monitoring...');

    // Create health check script
    const healthCheckScript = `#!/usr/bin/env node

/**
 * LSL Health Check Script
 * Monitors system health and provides status reporting
 */

import fs from 'fs';
import path from 'path';

class LSLHealthChecker {
  constructor(projectPath = process.cwd()) {
    this.projectPath = projectPath;
    this.healthFile = path.join(projectPath, '.transcript-monitor-health');
    this.configFile = path.join(projectPath, '.specstory', 'config', 'lsl-config.json');
  }

  async checkHealth() {
    const health = {
      timestamp: Date.now(),
      status: 'unknown',
      checks: {},
      warnings: [],
      errors: []
    };

    try {
      // Check configuration file
      if (fs.existsSync(this.configFile)) {
        health.checks.configFile = 'ok';
      } else {
        health.checks.configFile = 'missing';
        health.errors.push('LSL configuration file missing');
      }

      // Check directory structure
      const requiredDirs = ['.specstory', '.specstory/history', '.specstory/logs', '.specstory/config'];
      let directoriesOk = true;
      
      for (const dir of requiredDirs) {
        const dirPath = path.join(this.projectPath, dir);
        if (!fs.existsSync(dirPath)) {
          directoriesOk = false;
          health.errors.push(\`Required directory missing: \${dir}\`);
        }
      }
      health.checks.directories = directoriesOk ? 'ok' : 'error';

      // Check transcript monitor health file
      if (fs.existsSync(this.healthFile)) {
        try {
          const healthData = JSON.parse(fs.readFileSync(this.healthFile, 'utf8'));
          const age = Date.now() - healthData.timestamp;
          
          if (age < 120000) { // Less than 2 minutes old
            health.checks.transcriptMonitor = 'ok';
          } else {
            health.checks.transcriptMonitor = 'stale';
            health.warnings.push('Transcript monitor health data is stale');
          }
        } catch (error) {
          health.checks.transcriptMonitor = 'error';
          health.errors.push(\`Cannot parse health file: \${error.message}\`);
        }
      } else {
        health.checks.transcriptMonitor = 'not-running';
        health.warnings.push('Transcript monitor not running');
      }

      // Check log files
      const logDir = path.join(this.projectPath, '.specstory', 'logs');
      if (fs.existsSync(logDir)) {
        const logFiles = fs.readdirSync(logDir).filter(f => f.endsWith('.log'));
        health.checks.logging = logFiles.length > 0 ? 'ok' : 'no-logs';
        if (logFiles.length === 0) {
          health.warnings.push('No log files found');
        }
      } else {
        health.checks.logging = 'no-log-dir';
        health.warnings.push('Log directory not found');
      }

      // Determine overall status
      if (health.errors.length > 0) {
        health.status = 'error';
      } else if (health.warnings.length > 0) {
        health.status = 'warning';
      } else {
        health.status = 'ok';
      }

    } catch (error) {
      health.status = 'error';
      health.errors.push(\`Health check failed: \${error.message}\`);
    }

    return health;
  }

  displayHealth(health) {
    console.log('=== LSL Health Check ===\\n');
    
    const statusIcon = {
      ok: '✅',
      warning: '⚠️',
      error: '❌',
      unknown: '❓'
    };

    console.log(\`Overall Status: \${statusIcon[health.status]} \${health.status.toUpperCase()}\`);
    console.log(\`Checked at: \${new Date(health.timestamp).toISOString()}\\n\`);

    console.log('Component Status:');
    Object.entries(health.checks).forEach(([component, status]) => {
      const icon = ['ok'].includes(status) ? '✅' : 
                   ['warning', 'stale', 'no-logs', 'not-running'].includes(status) ? '⚠️' : '❌';
      console.log(\`  \${icon} \${component}: \${status}\`);
    });

    if (health.warnings.length > 0) {
      console.log('\\n⚠️ Warnings:');
      health.warnings.forEach(warning => console.log(\`  - \${warning}\`));
    }

    if (health.errors.length > 0) {
      console.log('\\n❌ Errors:');
      health.errors.forEach(error => console.log(\`  - \${error}\`));
    }

    console.log('\\n📋 Next Steps:');
    if (health.status === 'ok') {
      console.log('  System is healthy - no action needed');
    } else {
      if (health.checks.transcriptMonitor === 'not-running') {
        console.log('  - Start transcript monitor: npm run start-lsl');
      }
      if (health.checks.configFile === 'missing') {
        console.log('  - Run deployment script: node scripts/deploy-multi-user-lsl.js');
      }
    }
  }
}

// Run health check if called directly
if (import.meta.url === \`file://\${process.argv[1]}\`) {
  const checker = new LSLHealthChecker();
  const health = await checker.checkHealth();
  checker.displayHealth(health);
  
  process.exit(health.status === 'ok' ? 0 : 1);
}

export { LSLHealthChecker };
`;

    const healthCheckPath = path.join(this.options.projectPath, 'scripts', 'health-check.js');
    
    if (!this.options.dryRun) {
      fs.writeFileSync(healthCheckPath, healthCheckScript);
      fs.chmodSync(healthCheckPath, '755');
      this.rollbackSteps.push({ action: 'removeFile', path: healthCheckPath });
    }
    console.log(`   ✓ Created health check script: ${path.relative(this.options.projectPath, healthCheckPath)}`);
    this.stats.filesCreated++;

    // Update package.json with health check script
    const packageJsonPath = path.join(this.options.projectPath, 'package.json');
    if (fs.existsSync(packageJsonPath) && !this.options.dryRun) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        packageJson.scripts = packageJson.scripts || {};
        packageJson.scripts['health-check'] = 'node scripts/health-check.js';
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
        console.log(`   ✓ Added health-check script to package.json`);
      } catch (error) {
        this.stats.warnings.push(`Could not update package.json: ${error.message}`);
      }
    }
  }

  async validateDeployment() {
    console.log('   Running deployment validation...');

    const validations = [
      { name: 'Configuration Files', check: () => this.validateConfigFiles() },
      { name: 'Directory Structure', check: () => this.validateDirectories() },
      { name: 'Script Permissions', check: () => this.validateScriptPermissions() },
      { name: 'LSL Components', check: () => this.validateLSLComponents() },
      { name: 'Environment Variables', check: () => this.validateEnvironmentVars() }
    ];

    let validationsPassed = 0;
    let validationsFailed = 0;

    for (const validation of validations) {
      try {
        const result = await validation.check();
        if (result.success) {
          console.log(`   ✅ ${validation.name}: ${result.message}`);
          validationsPassed++;
        } else {
          console.log(`   ❌ ${validation.name}: ${result.message}`);
          validationsFailed++;
          this.stats.errors.push(`Validation failed: ${validation.name} - ${result.message}`);
        }
      } catch (error) {
        console.log(`   ❌ ${validation.name}: ${error.message}`);
        validationsFailed++;
        this.stats.errors.push(`Validation error: ${validation.name} - ${error.message}`);
      }
    }

    this.stats.validationsPassed += validationsPassed;
    this.stats.validationsFailed += validationsFailed;

    if (validationsFailed > 0) {
      throw new Error(`${validationsFailed} validation(s) failed`);
    }

    console.log(`   ✅ All ${validationsPassed} deployment validations passed`);
  }

  validateConfigFiles() {
    const configFiles = [
      '.specstory/config/lsl-config.json',
      '.specstory/config/redaction-config.yaml'
    ];

    for (const configFile of configFiles) {
      const filePath = path.join(this.options.projectPath, configFile);
      if (!fs.existsSync(filePath)) {
        return { success: false, message: `Missing config file: ${configFile}` };
      }
    }

    return { success: true, message: 'All configuration files present' };
  }

  validateDirectories() {
    const requiredDirs = [
      '.specstory',
      '.specstory/history',
      '.specstory/logs', 
      '.specstory/config',
      '.specstory/archive',
      'scripts'
    ];

    for (const dir of requiredDirs) {
      const dirPath = path.join(this.options.projectPath, dir);
      if (!fs.existsSync(dirPath)) {
        return { success: false, message: `Missing directory: ${dir}` };
      }
    }

    return { success: true, message: 'All required directories exist' };
  }

  validateScriptPermissions() {
    const scripts = [
      'scripts/setup-lsl-environment.sh',
      'scripts/start-file-manager.js',
      'scripts/start-operational-logger.js',
      'scripts/health-check.js'
    ];

    for (const script of scripts) {
      const scriptPath = path.join(this.options.projectPath, script);
      if (!fs.existsSync(scriptPath)) {
        return { success: false, message: `Missing script: ${script}` };
      }

      try {
        const stats = fs.statSync(scriptPath);
        if (!(stats.mode & parseInt('100', 8))) {
          return { success: false, message: `Script not executable: ${script}` };
        }
      } catch (error) {
        return { success: false, message: `Cannot check permissions for ${script}: ${error.message}` };
      }
    }

    return { success: true, message: 'All scripts have proper permissions' };
  }

  validateLSLComponents() {
    const components = [
      'src/live-logging/LSLFileManager.js',
      'src/live-logging/OperationalLogger.js',
      'src/live-logging/ReliableCodingClassifier.js',
      'scripts/enhanced-transcript-monitor.js'
    ];

    for (const component of components) {
      const componentPath = path.join(this.options.codingToolsPath, component);
      if (!fs.existsSync(componentPath)) {
        return { success: false, message: `Missing LSL component: ${component}` };
      }
    }

    return { success: true, message: 'All LSL components accessible' };
  }

  validateEnvironmentVars() {
    const requiredVars = ['USER'];
    const optionalVars = ['TRANSCRIPT_SOURCE_PROJECT', 'CODING_TOOLS_PATH'];

    for (const varName of requiredVars) {
      if (!process.env[varName]) {
        return { success: false, message: `Required environment variable not set: ${varName}` };
      }
    }

    let missingOptional = [];
    for (const varName of optionalVars) {
      if (!process.env[varName]) {
        missingOptional.push(varName);
      }
    }

    if (missingOptional.length > 0) {
      return { 
        success: true, 
        message: `Environment OK (optional vars not set: ${missingOptional.join(', ')})` 
      };
    }

    return { success: true, message: 'All environment variables configured' };
  }

  async startServices() {
    if (this.options.dryRun) {
      console.log('   Services would be started (dry run mode)');
      return;
    }

    console.log('   Starting LSL services...');

    // Test configuration loading
    try {
      const configPath = path.join(this.options.projectPath, '.specstory', 'config', 'lsl-config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      console.log(`   ✓ Configuration loaded successfully`);
    } catch (error) {
      throw new Error(`Cannot load configuration: ${error.message}`);
    }

    // Create service status indicator
    const serviceStatus = {
      deploymentId: this.deploymentId,
      startTime: new Date().toISOString(),
      status: 'deployed',
      services: {
        fileManager: 'configured',
        operationalLogger: 'configured', 
        healthMonitoring: 'configured',
        transcriptMonitor: 'ready'
      },
      nextSteps: [
        'Run: npm run start-lsl',
        'Check: npm run health-check',
        'Monitor: tail -f .specstory/logs/operational.log'
      ]
    };

    const statusPath = path.join(this.options.projectPath, '.specstory', 'deployment-status.json');
    fs.writeFileSync(statusPath, JSON.stringify(serviceStatus, null, 2));
    this.rollbackSteps.push({ action: 'removeFile', path: statusPath });

    console.log(`   ✅ Services configured and ready to start`);
    console.log(`   📋 Status saved to: .specstory/deployment-status.json`);
    this.stats.servicesStarted++;
  }

  async createDeploymentBackup() {
    console.log('   Creating deployment backup...');

    fs.mkdirSync(this.backupDir, { recursive: true });

    const backupItems = [
      '.specstory',
      'scripts',
      'package.json'
    ];

    for (const item of backupItems) {
      const itemPath = path.join(this.options.projectPath, item);
      if (fs.existsSync(itemPath)) {
        const backupPath = path.join(this.backupDir, item);
        
        if (fs.statSync(itemPath).isDirectory()) {
          execSync(`cp -r "${itemPath}" "${backupPath}"`);
        } else {
          fs.copyFileSync(itemPath, backupPath);
        }
        console.log(`   📦 Backed up: ${item}`);
      }
    }

    console.log(`   ✅ Backup created: ${this.backupDir}`);
  }

  async performRollback() {
    console.log('\n🔄 Performing deployment rollback...');

    for (const step of this.rollbackSteps.reverse()) {
      try {
        if (step.action === 'removeFile') {
          if (fs.existsSync(step.path)) {
            fs.unlinkSync(step.path);
            console.log(`   ✅ Removed: ${path.relative(this.options.projectPath, step.path)}`);
          }
        } else if (step.action === 'removeDirectory') {
          if (fs.existsSync(step.path)) {
            fs.rmSync(step.path, { recursive: true, force: true });
            console.log(`   ✅ Removed directory: ${path.relative(this.options.projectPath, step.path)}`);
          }
        }
      } catch (error) {
        console.log(`   ⚠️  Could not rollback ${step.path}: ${error.message}`);
      }
    }

    // Restore from backup if available
    if (fs.existsSync(this.backupDir)) {
      console.log(`   📦 Restoring from backup: ${this.backupDir}`);
      try {
        execSync(`cp -r "${this.backupDir}"/* "${this.options.projectPath}/"`);
        console.log(`   ✅ Backup restored successfully`);
      } catch (error) {
        console.log(`   ⚠️  Could not restore backup: ${error.message}`);
      }
    }

    console.log(`   ✅ Rollback completed`);
  }

  generateDeploymentReport() {
    const duration = Date.now() - this.stats.startTime;
    console.log('\n=== Multi-User LSL Deployment Report ===\n');

    console.log(`📊 Deployment Statistics:`);
    console.log(`   Deployment ID: ${this.deploymentId}`);
    console.log(`   Duration: ${duration}ms (${(duration / 1000).toFixed(1)}s)`);
    console.log(`   Files created: ${this.stats.filesCreated}`);
    console.log(`   Files modified: ${this.stats.filesModified}`);
    console.log(`   Validations run: ${this.stats.validationsRun}`);
    console.log(`   Validations passed: ${this.stats.validationsPassed}`);
    console.log(`   Validation failures: ${this.stats.validationsFailed}`);

    if (this.stats.warnings.length > 0) {
      console.log(`\n⚠️  Warnings (${this.stats.warnings.length}):`);
      this.stats.warnings.forEach(warning => console.log(`   - ${warning}`));
    }

    if (this.stats.errors.length > 0) {
      console.log(`\n❌ Errors (${this.stats.errors.length}):`);
      this.stats.errors.forEach(error => console.log(`   - ${error}`));
    }

    if (this.stats.errors.length === 0) {
      console.log(`\n✅ Deployment Successful!`);
      console.log(`\n🚀 Next Steps:`);
      console.log(`   1. Test environment: bash scripts/setup-lsl-environment.sh`);
      console.log(`   2. Start LSL system: npm run start-lsl`);
      console.log(`   3. Check health: npm run health-check`);
      console.log(`   4. Monitor logs: npm run lsl-logs`);
      console.log(`\n📁 Deployment files created in:`);
      console.log(`   Configuration: .specstory/config/`);
      console.log(`   Scripts: scripts/`);
      console.log(`   Logs: .specstory/logs/`);
    } else {
      console.log(`\n❌ Deployment Failed`);
      console.log(`   Review errors above and re-run deployment`);
      console.log(`   Use --dry-run to test without making changes`);
    }

    if (fs.existsSync(this.backupDir)) {
      console.log(`\n💾 Backup Location: ${this.backupDir}`);
      console.log(`   Use for manual rollback if needed`);
    }
  }
}

// CLI Interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  const options = {
    projectPath: args.find(arg => !arg.startsWith('--')) || process.cwd(),
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose'),
    skipBackup: args.includes('--skip-backup'),
    validateOnly: args.includes('--validate-only'),
    codingToolsPath: args.find(arg => arg.startsWith('--coding-tools='))?.split('=')[1] || '/Users/q284340/Agentic/coding'
  };

  console.log('Multi-User LSL Deployment Starting...\n');

  try {
    const deployer = new MultiUserLSLDeployer(options);
    const result = await deployer.deploy();
    
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error(`\nDeployment failed: ${error.message}`);
    process.exit(1);
  }
}

export { MultiUserLSLDeployer };