/**
 * VKB Server Management API
 * 
 * Core module for managing the knowledge base visualization server
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ServerManager } from './server-manager.js';
import { DataProcessor } from './data-processor.js';
import { Logger } from './utils/logging.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const DEFAULT_PORT = 8080;
const PID_FILE = '/tmp/vkb-server.pid';
const LOG_FILE = '/tmp/vkb-server.log';

class VKBServer {
  constructor(options = {}) {
    this.port = options.port || DEFAULT_PORT;
    this.projectRoot = options.projectRoot || path.join(__dirname, '..', '..');
    this.visualizerDir = path.join(this.projectRoot, 'memory-visualizer');
    
    // Multi-team support: determine which shared-memory file(s) to use
    const teamsEnv = process.env.CODING_TEAM || 'default';
    
    // Parse multiple teams - support formats like "coding,ui,resi" or "coding ui resi" or "{coding,ui,resi}"
    const teams = teamsEnv
      .replace(/[{}]/g, '') // Remove curly braces if present
      .split(/[,\s]+/)      // Split by comma or space
      .map(t => t.trim())   // Trim whitespace
      .filter(t => t);      // Remove empty strings
    
    // Single team or default
    if (teams.length === 0 || (teams.length === 1 && teams[0] === 'default')) {
      this.sharedMemoryPath = path.join(this.projectRoot, 'shared-memory.json');
      this.sharedMemoryPaths = [this.sharedMemoryPath];
    } else {
      // Multiple teams or single non-default team
      this.sharedMemoryPaths = teams.map(team => 
        path.join(this.projectRoot, `shared-memory-${team.toLowerCase()}.json`)
      );
      this.sharedMemoryPath = this.sharedMemoryPaths[0]; // Primary path for compatibility
    }
    
    this.serverManager = new ServerManager({
      port: this.port,
      pidFile: PID_FILE,
      logFile: LOG_FILE,
      visualizerDir: this.visualizerDir
    });
    
    this.dataProcessor = new DataProcessor({
      sharedMemoryPath: this.sharedMemoryPath,
      sharedMemoryPaths: this.sharedMemoryPaths, // Pass all paths for composition
      visualizerDir: this.visualizerDir,
      projectRoot: this.projectRoot
    });
    
    this.logger = new Logger('VKBServer');
    const kbNames = this.sharedMemoryPaths.map(p => path.basename(p)).join(', ');
    this.logger.info(`Using knowledge base(s): ${kbNames}`);
  }
  
  /**
   * Start the visualization server
   */
  async start(options = {}) {
    this.logger.info('Starting VKB visualization server...');
    
    // Check if server is already running
    if (await this.serverManager.isRunning()) {
      if (options.force) {
        this.logger.warn('Server already running, restarting...');
        await this.stop();
      } else {
        this.logger.warn('Server already running');
        return {
          success: true,
          alreadyRunning: true,
          port: this.port,
          url: `http://localhost:${this.port}`
        };
      }
    }
    
    // Prepare data
    await this.dataProcessor.prepareData();
    
    // Start server
    const result = await this.serverManager.start({
      foreground: options.foreground
    });
    
    return {
      success: result.success,
      port: this.port,
      pid: result.pid,
      url: `http://localhost:${this.port}`,
      logFile: LOG_FILE
    };
  }
  
  /**
   * Stop the visualization server
   */
  async stop() {
    this.logger.info('Stopping VKB visualization server...');
    
    if (!await this.serverManager.isRunning()) {
      this.logger.warn('Server is not running');
      return { success: true, wasRunning: false };
    }
    
    const result = await this.serverManager.stop();
    return { success: result.success, wasRunning: true };
  }
  
  /**
   * Restart the visualization server
   */
  async restart(options = {}) {
    this.logger.info('Restarting VKB visualization server...');
    
    await this.stop();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause
    return await this.start(options);
  }
  
  /**
   * Get server status
   */
  async status() {
    const isRunning = await this.serverManager.isRunning();
    const pid = await this.serverManager.getPid();
    
    return {
      running: isRunning,
      pid: pid,
      port: this.port,
      url: isRunning ? `http://localhost:${this.port}` : null,
      logFile: LOG_FILE
    };
  }
  
  /**
   * Get server logs
   */
  async logs(options = {}) {
    const lines = options.lines || 20;
    const follow = options.follow || false;
    
    return await this.serverManager.getLogs({ lines, follow });
  }
  
  /**
   * Refresh data without restarting server
   */
  async refreshData() {
    this.logger.info('Refreshing visualization data...');
    await this.dataProcessor.prepareData();
    return { success: true };
  }
  
  /**
   * Clear browser cache (Chrome-specific)
   */
  async clearCache() {
    this.logger.info('Clearing browser cache...');
    // This would be platform-specific implementation
    // For now, just return success
    return { success: true, message: 'Cache clearing not implemented in Node.js version' };
  }
}

export { VKBServer };
export default VKBServer;