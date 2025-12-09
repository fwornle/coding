#!/usr/bin/env node

/**
 * Initialize Knowledge Management System
 *
 * This script initializes the knowledge management system for a fresh install:
 * 1. Creates configuration file from template
 * 2. Initializes Qdrant collections
 * 3. Initializes SQLite database with schemas
 * 4. Verifies all components are working
 *
 * Usage:
 *   node scripts/initialize-knowledge-system.js [--project-path <path>]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseManager } from '../src/databases/DatabaseManager.js';
import { UnifiedInferenceEngine } from '../src/inference/UnifiedInferenceEngine.js';

// EmbeddingGenerator is optional - uses CommonJS format and is loaded lazily
let EmbeddingGenerator = null;
try {
  const module = await import('../src/utils/EmbeddingGenerator.cjs');
  EmbeddingGenerator = module.default || module.EmbeddingGenerator;
} catch (e) {
  // EmbeddingGenerator not available - will use fallback
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class KnowledgeSystemInitializer {
  constructor(options = {}) {
    this.projectPath = options.projectPath || process.cwd();
    this.verbose = options.verbose || false;
  }

  log(message) {
    console.log(`[KnowledgeInit] ${message}`);
  }

  error(message) {
    console.error(`[KnowledgeInit] ❌ ${message}`);
  }

  success(message) {
    console.log(`[KnowledgeInit] ✅ ${message}`);
  }

  /**
   * Main initialization process
   */
  async initialize() {
    try {
      console.log('🚀 Knowledge Management System Initialization');
      console.log('===========================================\n');

      this.log(`Project path: ${this.projectPath}`);

      // Step 1: Create configuration file
      await this.createConfigFile();

      // Step 2: Initialize database manager (creates collections & schemas)
      await this.initializeDatabases();

      // Step 3: Initialize embedding generator
      await this.initializeEmbeddings();

      // Step 4: Initialize inference engine
      await this.initializeInference();

      // Step 5: Verify system
      await this.verifySystem();

      console.log('\n🎉 Knowledge Management System initialized successfully!');
      console.log('\nNext steps:');
      console.log('  1. Start coding with Claude Code');
      console.log('  2. Knowledge will be automatically extracted from your sessions');
      console.log('  3. Check status with: CODING_REPO=/path/to/coding node scripts/combined-status-line.js');

      return true;
    } catch (error) {
      this.error(`Initialization failed: ${error.message}`);
      console.error(error.stack);
      return false;
    }
  }

  /**
   * Create configuration file from template
   */
  async createConfigFile() {
    this.log('Step 1: Creating configuration file...');

    const configDir = path.join(this.projectPath, '.specstory', 'config');
    const configPath = path.join(configDir, 'knowledge-system.json');
    const templatePath = path.join(configDir, 'knowledge-system.template.json');

    // Ensure config directory exists
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
      this.log('Created .specstory/config directory');
    }

    // Check if config already exists
    if (fs.existsSync(configPath)) {
      this.log('Configuration file already exists, skipping');
      return;
    }

    // Check if template exists
    if (!fs.existsSync(templatePath)) {
      this.error('Template file not found at: ' + templatePath);
      throw new Error('Template file missing. Reinstall the package.');
    }

    // Copy template to config
    fs.copyFileSync(templatePath, configPath);
    this.success('Created knowledge-system.json from template');
  }

  /**
   * Initialize database manager (Qdrant + SQLite)
   */
  async initializeDatabases() {
    this.log('Step 2: Initializing databases...');

    this.databaseManager = new DatabaseManager({
      projectPath: this.projectPath,
      debug: this.verbose
    });

    await this.databaseManager.initialize();

    if (this.databaseManager.health.qdrant.available) {
      this.success('Qdrant initialized successfully');
    } else {
      this.log('⚠️  Qdrant not available (optional - system will work without it)');
    }

    if (this.databaseManager.health.sqlite.available) {
      this.success('SQLite initialized successfully');
    } else {
      this.error('SQLite initialization failed (required)');
      throw new Error('SQLite is required for knowledge system');
    }
  }

  /**
   * Initialize embedding generator
   */
  async initializeEmbeddings() {
    this.log('Step 3: Initializing embedding generator...');

    if (EmbeddingGenerator) {
      this.embeddingGenerator = new EmbeddingGenerator({
        projectPath: this.projectPath,
        databaseManager: this.databaseManager,
        debug: this.verbose
      });
      // Note: EmbeddingGenerator doesn't need explicit initialization
      // It will load models on first use
      this.success('Embedding generator configured');
    } else {
      this.log('⚠️  Embedding generator not available (optional - will use fallback)');
    }
  }

  /**
   * Initialize inference engine
   */
  async initializeInference() {
    this.log('Step 4: Initializing inference engine...');

    this.inferenceEngine = new UnifiedInferenceEngine({
      projectPath: this.projectPath,
      debug: this.verbose
    });

    // Note: UnifiedInferenceEngine initializes providers lazily
    this.success('Inference engine configured');
  }

  /**
   * Verify system is working
   */
  async verifySystem() {
    this.log('Step 5: Verifying system...');

    const checks = [];

    // Check 1: Config file exists
    const configPath = path.join(this.projectPath, '.specstory', 'config', 'knowledge-system.json');
    checks.push({
      name: 'Configuration file',
      pass: fs.existsSync(configPath)
    });

    // Check 2: SQLite database created
    checks.push({
      name: 'SQLite database',
      pass: this.databaseManager?.health?.sqlite?.available || false
    });

    // Check 3: Qdrant available (optional)
    const qdrantAvailable = this.databaseManager?.health?.qdrant?.available || false;
    checks.push({
      name: 'Qdrant vector database',
      pass: qdrantAvailable,
      optional: true
    });

    // Print verification results
    console.log('\n📊 Verification Results:');
    for (const check of checks) {
      const status = check.pass ? '✅' : (check.optional ? '⚠️ ' : '❌');
      const suffix = check.optional && !check.pass ? ' (optional)' : '';
      console.log(`  ${status} ${check.name}${suffix}`);
    }

    const requiredPassed = checks.filter(c => !c.optional).every(c => c.pass);
    if (!requiredPassed) {
      throw new Error('Required checks failed');
    }

    this.success('All required checks passed');
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options = {};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project-path' && args[i + 1]) {
    options.projectPath = path.resolve(args[i + 1]);
    i++;
  } else if (args[i] === '--verbose' || args[i] === '-v') {
    options.verbose = true;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log('Initialize Knowledge Management System');
    console.log('\nUsage: node scripts/initialize-knowledge-system.js [options]');
    console.log('\nOptions:');
    console.log('  --project-path <path>  Project directory (default: current directory)');
    console.log('  --verbose, -v          Verbose output');
    console.log('  --help, -h             Show this help');
    process.exit(0);
  }
}

// Run initialization
const initializer = new KnowledgeSystemInitializer(options);
initializer.initialize().then(success => {
  process.exit(success ? 0 : 1);
});
