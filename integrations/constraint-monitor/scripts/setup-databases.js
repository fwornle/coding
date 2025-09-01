#!/usr/bin/env node

/**
 * Constraint Monitor Database Setup Script
 * 
 * Sets up Qdrant collections, DuckDB schema, and SQLite configuration
 */

import { QdrantDatabase } from '../src/database/qdrant-client.js';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Conditional import for DuckDB to avoid startup failures
let DuckDBAnalytics;
try {
  const duckModule = await import('../src/database/duckdb-client.js');
  DuckDBAnalytics = duckModule.DuckDBAnalytics;
} catch (error) {
  console.log('⚠️  DuckDB module unavailable:', error.message);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '../data');
const configDir = join(__dirname, '../config');

async function setupDirectories() {
  console.log('📁 Setting up directories...');
  
  const dirs = [dataDir, configDir, join(__dirname, '../logs')];
  
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(`  ✅ Created: ${dir}`);
    }
  }
}

async function setupQdrant() {
  console.log('\n🔍 Setting up Qdrant vector database...');
  
  try {
    const qdrant = new QdrantDatabase();
    await qdrant.initialize();
    
    console.log('  ✅ Qdrant collection initialized');
    await qdrant.close();
  } catch (error) {
    console.log(`  ⚠️  Qdrant setup skipped (service may not be running): ${error.message}`);
    console.log('  💡 Start Qdrant with: docker-compose up -d qdrant');
  }
}

async function setupDuckDB() {
  console.log('\n🦆 Setting up DuckDB analytics database...');
  
  if (!DuckDBAnalytics) {
    console.log('  ⚠️  DuckDB setup skipped (module unavailable)');
    console.log('  💡 Run: npm install duckdb && npm rebuild duckdb');
    return;
  }
  
  try {
    const duckdb = new DuckDBAnalytics({
      path: join(dataDir, 'constraint-analytics.db')
    });
    await duckdb.initialize();
    
    console.log('  ✅ DuckDB schema initialized');
    await duckdb.close();
  } catch (error) {
    console.log(`  ⚠️  DuckDB setup skipped (runtime error): ${error.message}`);
    console.log('  💡 Run: npm rebuild duckdb');
    // Don't throw error - make it optional
  }
}

async function setupConfiguration() {
  console.log('\n⚙️  Setting up configuration files...');
  
  // Default constraints configuration
  const constraintsConfig = `# Constraint Monitor Configuration
constraints:
  - id: no-console-log
    type: anti-pattern
    severity: error
    matcher: "console\\\\.log"
    message: "Use Logger.log() instead of console.log"
    correctionAction: block
    
  - id: trajectory-alignment
    type: semantic
    severity: warning
    threshold: 5
    message: "Action misaligned with user intent"
    correctionAction: suggest

  - id: excessive-exploration
    type: workflow
    severity: warning
    fileReadLimit: 10
    message: "Reading too many files for simple task"
    correctionAction: warn

  - id: unauthorized-commit
    type: pattern
    severity: critical
    matcher: "git\\\\s+commit"
    message: "Ask user permission before committing changes"
    correctionAction: block
`;

  const constraintsPath = join(configDir, 'constraints.yaml');
  if (!existsSync(constraintsPath)) {
    writeFileSync(constraintsPath, constraintsConfig);
    console.log('  ✅ Created constraints.yaml');
  }
  
  // Status line configuration
  const statusLineConfig = {
    enabled: true,
    showCompliance: true,
    showViolations: true,
    showTrajectory: true,
    maxLength: 50,
    updateInterval: 1000,
    colors: {
      excellent: 'green',
      good: 'cyan',
      warning: 'yellow',
      critical: 'red'
    },
    icons: {
      shield: '🛡️',
      warning: '⚠️',
      trajectory: '📈',
      blocked: '🚫'
    }
  };
  
  const statusLinePath = join(configDir, 'status-line.json');
  if (!existsSync(statusLinePath)) {
    writeFileSync(statusLinePath, JSON.stringify(statusLineConfig, null, 2));
    console.log('  ✅ Created status-line.json');
  }
}

async function setupEnvironment() {
  console.log('\n🌍 Checking environment...');
  
  const requiredVars = ['GROQ_API_KEY'];
  const warnings = [];
  
  // Debug: Show what we found
  console.log('  🔍 Checking API keys...');
  for (const varName of requiredVars) {
    const value = process.env[varName];
    if (!value) {
      warnings.push(`${varName} not set`);
      console.log(`      - ${varName}: ❌ Not found`);
    } else {
      console.log(`      - ${varName}: ✅ Found (${value.substring(0, 10)}...)`);
    }
  }
  
  if (warnings.length > 0) {
    console.log('  ⚠️  Environment warnings:');
    warnings.forEach(w => console.log(`      - ${w}`));
    console.log('  💡 Add missing API keys to your .env file');
  } else {
    console.log('  ✅ All environment variables configured');
  }
}

async function main() {
  console.log('🛡️  Constraint Monitor Database Setup\n');
  
  try {
    await setupDirectories();
    await setupConfiguration();
    await setupEnvironment();
    await setupDuckDB();
    await setupQdrant(); // Optional - may fail if Docker not running
    
    console.log('\n✅ Setup completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('   1. Start databases: docker-compose up -d');
    console.log('   2. Start monitor: npm start');
    console.log('   3. View dashboard: http://localhost:8767/dashboard');
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}