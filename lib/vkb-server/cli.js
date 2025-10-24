#!/usr/bin/env node
/**
 * VKB CLI - Command-line interface for VKB Server
 */

// Load environment variables from .env file
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..', '..');

dotenv.config({ path: join(projectRoot, '.env') });

import { Command } from 'commander';
import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import { VKBServer } from './index.js';
import { Logger } from './utils/logging.js';

const execAsync = promisify(exec);
const logger = new Logger('CLI');

// Create CLI
const program = new Command();

program
  .name('vkb-cli')
  .description('VKB Server Management CLI')
  .version('1.0.0');

// Server command group
const serverCmd = program
  .command('server')
  .description('Manage VKB visualization server');

// Start command
serverCmd
  .command('start')
  .description('Start the visualization server')
  .option('-f, --foreground', 'Run server in foreground mode')
  .option('--force', 'Force restart if already running')
  .option('-p, --port <port>', 'Server port', '8080')
  .option('--no-browser', 'Do not open browser automatically')
  .action(async (options) => {
    try {
      const server = new VKBServer({ port: parseInt(options.port) });
      const result = await server.start({
        foreground: options.foreground,
        force: options.force
      });
      
      if (result.alreadyRunning) {
        logger.warn('Server already running');
        logger.info(`URL: ${result.url}`);
      } else {
        logger.success('Visualization server started successfully!');
        logger.info(`Server PID: ${result.pid}`);
        logger.info(`URL: ${result.url}`);
        logger.info(`Logs: ${result.logFile}`);
      }
      
      // Open browser unless disabled
      if (options.browser && !result.alreadyRunning && !options.foreground) {
        await openBrowser(result.url);
      }
      
      if (!options.foreground) {
        logger.info("Server running in background. Use 'vkb server stop' to stop it.");
      }
    } catch (error) {
      logger.error(`Failed to start server: ${error.message}`);
      process.exit(1);
    }
  });

// Stop command
serverCmd
  .command('stop')
  .description('Stop the visualization server')
  .action(async () => {
    try {
      const server = new VKBServer();
      const result = await server.stop();
      
      if (result.wasRunning) {
        logger.success('Server stopped');
      } else {
        logger.warn('Server was not running');
      }
    } catch (error) {
      logger.error(`Failed to stop server: ${error.message}`);
      process.exit(1);
    }
  });

// Restart command
serverCmd
  .command('restart')
  .description('Restart the visualization server')
  .option('-p, --port <port>', 'Server port', '8080')
  .option('--no-browser', 'Do not open browser automatically')
  .action(async (options) => {
    try {
      const server = new VKBServer({ port: parseInt(options.port) });
      const result = await server.restart();
      
      logger.success('Server restarted');
      logger.info(`URL: ${result.url}`);
      
      if (options.browser) {
        await openBrowser(result.url);
      }
    } catch (error) {
      logger.error(`Failed to restart server: ${error.message}`);
      process.exit(1);
    }
  });

// Status command
serverCmd
  .command('status')
  .description('Show server status')
  .action(async () => {
    try {
      const server = new VKBServer();
      const status = await server.status();
      
      if (status.running) {
        logger.success('Visualization server is running');
        logger.info(`PID: ${status.pid || 'Unknown'}`);
        logger.info(`URL: ${status.url}`);
        logger.info(`Logs: ${status.logFile}`);
      } else {
        logger.error('Visualization server is not running');
      }
    } catch (error) {
      logger.error(`Failed to get status: ${error.message}`);
      process.exit(1);
    }
  });

// Logs command
serverCmd
  .command('logs')
  .description('Show server logs')
  .option('-n, --lines <lines>', 'Number of lines to show', '20')
  .option('-f, --follow', 'Follow log output')
  .action(async (options) => {
    try {
      const server = new VKBServer();
      const logs = await server.logs({
        lines: parseInt(options.lines),
        follow: options.follow
      });
      
      console.log(logs);
    } catch (error) {
      logger.error(`Failed to get logs: ${error.message}`);
      process.exit(1);
    }
  });

// Data command group
const dataCmd = program
  .command('data')
  .description('Manage visualization data');

// Process data command
dataCmd
  .command('process')
  .description('Process and convert knowledge base data to NDJSON format')
  .action(async () => {
    try {
      const server = new VKBServer();
      const dataProcessor = server.dataProcessor;
      const result = await dataProcessor.prepareData();
      
      if (result.success) {
        logger.success(`Data processed: ${result.stats.entities} entities, ${result.stats.relations} relations`);
      } else {
        logger.error('Failed to process data');
      }
    } catch (error) {
      logger.error(`Failed to process data: ${error.message}`);
      process.exit(1);
    }
  });

// Refresh data command
dataCmd
  .command('refresh')
  .description('Refresh visualization data without restarting server')
  .action(async () => {
    try {
      const server = new VKBServer();
      await server.refreshData();
      logger.success('Data refreshed successfully');
    } catch (error) {
      logger.error(`Failed to refresh data: ${error.message}`);
      process.exit(1);
    }
  });

// Cache command
program
  .command('clear-cache')
  .description('Clear browser cache for localhost')
  .action(async () => {
    try {
      logger.warn('Browser cache clearing is not implemented in Node.js version');
      logger.info('Please clear your browser cache manually or use Cmd+Shift+R / Ctrl+Shift+R to hard refresh');
    } catch (error) {
      logger.error(`Failed to clear cache: ${error.message}`);
      process.exit(1);
    }
  });

// Helper function to open browser
async function openBrowser(url) {
  try {
    logger.info('Opening browser...');
    
    const platform = process.platform;
    let command;
    
    if (platform === 'darwin') {
      command = `open "${url}"`;
    } else if (platform === 'win32') {
      command = `start "${url}"`;
    } else {
      command = `xdg-open "${url}"`;
    }
    
    await execAsync(command);
  } catch (error) {
    logger.warn('Could not open browser automatically');
    logger.info(`Please open: ${url}`);
  }
}

// Parse arguments
program.parse(process.argv);