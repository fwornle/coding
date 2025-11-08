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
import { DatabaseManager } from '../../src/databases/DatabaseManager.js';
import { startServer as startExpressServer } from './express-server.js';
import ProcessStateManager from '../../scripts/process-state-manager.js';

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
    this.visualizerDir = path.join(this.projectRoot, 'integrations', 'memory-visualizer');
    this.expressServer = null; // Will hold the Express server instance
    
    // Multi-view support: determine which shared-memory file(s) to use
    const teamsEnv = process.env.KNOWLEDGE_VIEW || process.env.CODING_TEAM || 'coding'; // Default to coding view
    
    // Parse multiple teams - support formats like "coding,ui,resi" or "coding ui resi" or "{coding,ui,resi}"
    const teams = teamsEnv
      .replace(/[{}]/g, '') // Remove curly braces if present
      .split(/[,\s]+/)      // Split by comma or space
      .map(t => t.trim())   // Trim whitespace
      .filter(t => t);      // Remove empty strings
    
    // Default to coding if empty
    if (teams.length === 0) {
      teams.push('coding');
    }
    
    // Use CODING_KB_PATH if set, otherwise use project root
    const kbPath = process.env.CODING_KB_PATH || this.projectRoot;
    
    // Always use team-specific files, no more shared-memory.json
    this.sharedMemoryPaths = teams.map(team => 
      path.join(kbPath, `shared-memory-${team.toLowerCase()}.json`)
    );
    this.sharedMemoryPath = this.sharedMemoryPaths[0]; // Primary path for compatibility
    
    this.serverManager = new ServerManager({
      port: this.port,
      pidFile: PID_FILE,
      logFile: LOG_FILE,
      visualizerDir: this.visualizerDir
    });

    // ENHANCED: Support data source mode from environment
    // DEFAULT CHANGED: Use 'online' (GraphDB) instead of 'batch' (JSON files)
    // Phase 4: GraphDB is primary storage, JSON files are only for git-tracked collaboration
    const dataSourceMode = process.env.VKB_DATA_SOURCE || 'online';
    const useDatabaseBackend = (dataSourceMode === 'online' || dataSourceMode === 'combined');

    // Initialize DatabaseManager if needed for online/combined mode
    let databaseManager = options.databaseManager || null;
    if (useDatabaseBackend && !databaseManager) {
      const sqlitePath = process.env.SQLITE_PATH || path.join(this.projectRoot, '.data', 'knowledge.db');
      const graphDbPath = process.env.GRAPH_DB_PATH || path.join(this.projectRoot, '.data', 'knowledge-graph');
      const exportDir = process.env.KNOWLEDGE_EXPORT_DIR || path.join(this.projectRoot, '.data', 'knowledge-export');
      databaseManager = new DatabaseManager({
        sqlite: {
          path: sqlitePath,
          enabled: true
        },
        qdrant: {
          host: process.env.QDRANT_URL?.replace('http://', '').replace(':6333', '') || 'localhost',
          port: 6333,
          enabled: false // Optional for VKB viewer
        },
        graphDbPath: graphDbPath,  // Use graphDbPath (not graphDb.path)
        exportDir: exportDir,      // Add export directory for auto-import
        graphDb: {
          enabled: true  // Enable GraphDB for online knowledge
        }
      });
      this.databaseManager = databaseManager;
    }

    this.dataProcessor = new DataProcessor({
      sharedMemoryPath: this.sharedMemoryPath,
      sharedMemoryPaths: this.sharedMemoryPaths, // Pass all paths for composition
      teams: teams, // ENHANCED: Pass teams array for scoped online knowledge export
      visualizerDir: this.visualizerDir,
      projectRoot: this.projectRoot,
      dataSourceMode: dataSourceMode,
      useDatabaseBackend: useDatabaseBackend,
      databaseManager: databaseManager,
      embeddingGenerator: options.embeddingGenerator || null,
      debug: options.debug || false
    });
    
    this.logger = new Logger('VKBServer');

    // Log the actual data source being used
    if (dataSourceMode === 'online') {
      this.logger.info(`Using GraphDB data source for teams: ${teams.join(', ')}`);
    } else if (dataSourceMode === 'combined') {
      this.logger.info(`Using combined data source (GraphDB + JSON) for teams: ${teams.join(', ')}`);
    } else {
      const kbNames = this.sharedMemoryPaths.map(p => path.basename(p)).join(', ');
      this.logger.info(`Using JSON file data source: ${kbNames}`);
    }
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

    // Initialize DatabaseManager if needed
    if (this.databaseManager && !this.databaseManager.initialized) {
      this.logger.info('Initializing DatabaseManager for online knowledge...');
      await this.databaseManager.initialize();
    }

    // Prepare data (exports from GraphDB to dist directory)
    await this.dataProcessor.prepareData();

    // Start Express server with API routes
    const distDir = path.join(this.visualizerDir, 'dist');
    this.logger.info(`Starting Express server on port ${this.port}...`);
    this.logger.info(`Serving from: ${distDir}`);

    try {
      this.expressServer = await startExpressServer({
        port: this.port,
        databaseManager: this.databaseManager,
        distDir: distDir,
        debug: options.debug || false
      });

      // Write PID file for compatibility with CLI tools
      await fs.writeFile(PID_FILE, String(process.pid));

      // Register with Process State Manager
      try {
        const psm = new ProcessStateManager({ codingRoot: this.projectRoot });
        await psm.registerService({
          name: 'vkb-server',
          type: 'global',
          pid: process.pid,
          script: 'lib/vkb-server/index.js',
          metadata: {
            port: this.port,
            url: `http://localhost:${this.port}`,
            logFile: LOG_FILE
          }
        });
        this.logger.info('Registered with Process State Manager');
      } catch (error) {
        this.logger.warn(`Failed to register with PSM: ${error.message}`);
        // Don't fail startup if PSM registration fails
      }

      return {
        success: true,
        port: this.port,
        pid: process.pid,
        url: `http://localhost:${this.port}`,
        logFile: LOG_FILE
      };
    } catch (error) {
      this.logger.error(`Failed to start Express server: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Stop the visualization server
   */
  async stop() {
    this.logger.info('Stopping VKB visualization server...');

    // Close Express server if it's running
    if (this.expressServer) {
      return new Promise((resolve) => {
        this.expressServer.close(async () => {
          this.logger.info('Express server closed');
          this.expressServer = null;

          // Clean up PID file
          await fs.unlink(PID_FILE).catch(() => {});

          // Unregister from Process State Manager
          try {
            const psm = new ProcessStateManager({ codingRoot: this.projectRoot });
            await psm.unregisterService('vkb-server', 'global');
            this.logger.info('Unregistered from Process State Manager');
          } catch (error) {
            this.logger.warn(`Failed to unregister from PSM: ${error.message}`);
          }

          resolve({ success: true, wasRunning: true });
        });
      });
    }

    // Fallback to ServerManager for old Python-based servers
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
    
    // Force clean memory.json regeneration on restart (prevent corruption)
    try {
      const memoryDist = path.join(this.visualizerDir, 'dist', 'memory.json');
      await fs.unlink(memoryDist);
      this.logger.info('Cleared memory.json to force clean regeneration');
    } catch {
      // File doesn't exist, which is fine
    }
    
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