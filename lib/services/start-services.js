#!/usr/bin/env node

/**
 * Service Startup Script
 * Starts all required services for the coding project
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
const dryRun = args.includes('--dry-run');

async function main() {
  try {
    // Change to project root
    process.chdir(projectRoot);
    
    // Create lifecycle manager
    const manager = new ServiceLifecycleManager('config/services.yaml');
    manager.setVerbose(verbose);

    if (dryRun) {
      console.log('🔍 Dry run mode - would start services for agent type:', agentType);
      manager.loadConfiguration();
      
      const status = manager.getStatus();
      console.log('\nServices that would be started:');
      
      for (const [serviceName, service] of manager.services) {
        if (!service.agentTypes || service.agentTypes.includes(agentType)) {
          console.log(`  • ${service.displayName || serviceName} (${service.type})`);
          if (service.preferredPort) {
            console.log(`    Port: ${service.preferredPort}`);
          }
          if (service.critical) {
            console.log(`    Critical: Yes`);
          }
        }
      }
      
      return;
    }

    // Start services
    await manager.startAll(agentType);
    
    // For Claude agent, run services in background and exit
    if (agentType === 'claude') {
      console.log('✅ All services started successfully in background');
      console.log('🔄 Services will continue running independently');
      
      // Write PID file for service management
      const fs = await import('fs');
      const pidInfo = {
        timestamp: new Date().toISOString(),
        services: Array.from(manager.services.keys()),
        agent: agentType
      };
      
      try {
        await fs.promises.writeFile(
          join(projectRoot, '.services-running.json'),
          JSON.stringify(pidInfo, null, 2)
        );
      } catch (error) {
        console.warn('⚠️  Could not write service status file:', error.message);
      }
      
      // Exit cleanly to allow Claude Code to start
      process.exit(0);
    }

  } catch (error) {
    console.error('❌ Failed to start services:', error.message);
    if (verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('💥 Uncaught exception:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('💥 Unhandled rejection:', reason);
  process.exit(1);
});

main();