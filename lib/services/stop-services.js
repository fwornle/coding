#!/usr/bin/env node

/**
 * Service Shutdown Script
 * Gracefully stops all services for the coding project
 */

import { ServiceLifecycleManager } from './lifecycle-manager.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import process from 'process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..', '..');

// Parse command line arguments
const args = process.argv.slice(2);
const agentType = args.find(arg => arg.startsWith('--agent'))?.split('=')[1] || 
               (args.includes('--agent') ? args[args.indexOf('--agent') + 1] : 'claude');
const verbose = args.includes('--verbose') || args.includes('-v');
const force = args.includes('--force') || args.includes('-f');

async function main() {
  try {
    // Change to project root
    process.chdir(projectRoot);
    
    // Create lifecycle manager
    const manager = new ServiceLifecycleManager('config/services.yaml');
    manager.setVerbose(verbose);

    console.log('🛑 Stopping coding services...');
    
    if (force) {
      console.log('⚡ Force mode enabled - will kill processes immediately');
    }

    // Load configuration to know what services exist
    manager.loadConfiguration();
    
    // Stop all services
    await manager.stopAll();
    
    console.log('✅ All services stopped successfully');

  } catch (error) {
    console.error('❌ Failed to stop services:', error.message);
    if (verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();