#!/usr/bin/env node
/**
 * VKB Express Server
 *
 * Node.js Express server that serves the visualizer and provides API endpoints.
 *
 * ROBUST STARTUP: Supports lazy initialization pattern where the HTTP server
 * starts immediately and initialization happens in the background. The /health
 * endpoint returns the current startup state:
 * - { status: 'starting' } - Server is alive, initialization in progress
 * - { status: 'ready' } - Fully initialized and ready
 * - { status: 'error' } - Initialization failed (server still serves cached data)
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { ApiRoutes } from './api-routes.js';
import { Logger } from './utils/logging.js';
import { runIfMain } from '../utils/esm-cli.js';
import { DatabaseManager } from '../../src/databases/DatabaseManager.js';
import { DataProcessor } from './data-processor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = new Logger('ExpressServer');

/**
 * Startup state manager for robust health checks
 * This allows the server to start immediately and initialize in the background
 */
class StartupState {
  constructor() {
    this.status = 'starting'; // 'starting' | 'ready' | 'error'
    this.startTime = Date.now();
    this.readyTime = null;
    this.error = null;
    this.details = {
      databaseManagerReady: false,
      dataProcessorReady: false
    };
  }

  setReady() {
    this.status = 'ready';
    this.readyTime = Date.now();
    logger.info(`Startup complete in ${this.readyTime - this.startTime}ms`);
  }

  setError(error) {
    this.status = 'error';
    this.error = error?.message || String(error);
    logger.error(`Startup error: ${this.error}`);
  }

  updateDetail(key, value) {
    this.details[key] = value;
  }

  toJSON() {
    const elapsed = this.readyTime
      ? this.readyTime - this.startTime
      : Date.now() - this.startTime;

    return {
      status: this.status,
      timestamp: new Date().toISOString(),
      startupTimeMs: elapsed,
      ready: this.status === 'ready',
      ...(this.error && { error: this.error }),
      ...(this.status === 'starting' && { details: this.details })
    };
  }
}

// Global startup state (shared across requests)
let globalStartupState = new StartupState();

/**
 * Create a new startup state instance
 */
export function createStartupState() {
  globalStartupState = new StartupState();
  return globalStartupState;
}

/**
 * Get the current startup state
 */
export function getStartupState() {
  return globalStartupState;
}

/**
 * Create and configure the Express server
 */
export function createServer(options = {}) {
  const {
    port = 8080,
    databaseManager,
    distDir,
    debug = false
  } = options;

  const app = express();

  // Enable CORS
  app.use(cors());

  // Parse JSON bodies
  app.use(express.json());

  // Request logging middleware (always log API requests)
  app.use((req, res, next) => {
    if (req.url.startsWith('/api/')) {
      logger.info(`→ ${req.method} ${req.url}`);
    }
    next();
  });

  // Register API routes
  if (databaseManager) {
    const apiRoutes = new ApiRoutes(databaseManager, { debug });
    apiRoutes.registerRoutes(app);
    logger.info('API routes registered');
  } else {
    logger.warn('No DatabaseManager provided - API routes will not be available');
  }

  // Health check endpoint with startup state awareness
  // Returns 200 for both 'starting' and 'ready' states (server is alive)
  // This allows health checks to pass early while initialization continues
  app.get('/health', (_req, res) => {
    const state = globalStartupState.toJSON();
    // Always return 200 if server is responsive (even while starting)
    // This is the "liveness" check - server process is alive
    res.json(state);
  });

  // Readiness check endpoint - returns 200 only when fully initialized
  // Use this to check if the server is ready to serve requests
  app.get('/ready', (_req, res) => {
    const state = globalStartupState.toJSON();
    if (state.ready) {
      res.json(state);
    } else {
      res.status(503).json(state);
    }
  });

  // Serve markdown files from knowledge-management directory
  // This must come BEFORE static file serving to avoid the catch-all
  const knowledgeManagementDir = path.join(__dirname, '..', '..', 'knowledge-management');
  app.use('/knowledge-management', express.static(knowledgeManagementDir, {
    extensions: ['md'],
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.md')) {
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      }
    }
  }));
  logger.info(`Serving markdown files from: ${knowledgeManagementDir}`);

  // Serve session log files from .specstory/history directory
  // Entity observations reference session logs like "2026-01-25_1100-1200_c197ef.md"
  const specstoryHistoryDir = path.join(__dirname, '..', '..', '.specstory', 'history');
  app.use('/specstory', express.static(specstoryHistoryDir, {
    extensions: ['md'],
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.md')) {
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      }
    }
  }));
  logger.info(`Serving session logs from: ${specstoryHistoryDir}`);

  // Return 404 for missing knowledge-management files (not SPA fallback)
  // This prevents the SPA catch-all from returning HTML for missing markdown files
  app.get('/knowledge-management/*', (req, res) => {
    const requestedPath = req.path.replace('/knowledge-management/', '');
    const filePath = path.join(knowledgeManagementDir, requestedPath);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      logger.warn(`Markdown file not found: ${filePath}`);
      return res.status(404).json({
        error: 'Not Found',
        message: `File not found: ${requestedPath}`,
        path: req.path
      });
    }

    // If file exists but static didn't serve it, something is wrong
    res.status(500).json({
      error: 'Internal Server Error',
      message: `Failed to serve file: ${requestedPath}`
    });
  });

  // Return 404 for missing specstory files (not SPA fallback)
  app.get('/specstory/*', (req, res) => {
    const requestedPath = req.path.replace('/specstory/', '');
    const filePath = path.join(specstoryHistoryDir, requestedPath);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      logger.warn(`Session log not found: ${filePath}`);
      return res.status(404).json({
        error: 'Not Found',
        message: `Session log not found: ${requestedPath}`,
        path: req.path
      });
    }

    // If file exists but static didn't serve it, something is wrong
    res.status(500).json({
      error: 'Internal Server Error',
      message: `Failed to serve session log: ${requestedPath}`
    });
  });

  // Serve static files from dist directory
  if (distDir) {
    app.use(express.static(distDir));
    logger.info(`Serving static files from: ${distDir}`);
  }

  // Catch-all route for SPA (serve index.html for all other routes)
  if (distDir) {
    // Ensure absolute path for sendFile
    const absoluteDistDir = path.isAbsolute(distDir) ? distDir : path.join(process.cwd(), distDir);
    app.get('*', (_req, res) => {
      res.sendFile(path.join(absoluteDistDir, 'index.html'));
    });
  }

  return app;
}

/**
 * Start the Express server
 */
export async function startServer(options = {}) {
  const {
    port = 8080,
    databaseManager,
    distDir,
    debug = false
  } = options;

  const app = createServer({ port, databaseManager, distDir, debug });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      logger.success(`VKB server listening on http://localhost:${port}`);
      resolve(server);
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${port} is already in use`);
      } else {
        logger.error(`Server error: ${error.message}`);
      }
      reject(error);
    });
  });
}

// Standalone mode - start server with full initialization when run directly
// Used by Docker/supervisord where there's no VKBServer wrapper
runIfMain(import.meta.url, async () => {
  const port = parseInt(process.env.VKB_PORT || process.argv[2]) || 8080;
  const projectRoot = path.join(__dirname, '..', '..');
  const distDir = process.argv[3] || path.join(projectRoot, 'integrations', 'memory-visualizer', 'dist');

  logger.info(`Starting VKB Express server standalone on port ${port}...`);
  logger.info(`Project root: ${projectRoot}`);
  logger.info(`Dist directory: ${distDir}`);

  // Create startup state for health tracking
  const startupState = createStartupState();

  // Determine data source mode
  const dataSourceMode = process.env.VKB_DATA_SOURCE || 'online';
  const useDatabaseBackend = (dataSourceMode === 'online' || dataSourceMode === 'combined');

  // Create DatabaseManager for API routes
  let databaseManager = null;
  if (useDatabaseBackend) {
    const sqlitePath = process.env.SQLITE_PATH || path.join(projectRoot, '.data', 'knowledge.db');
    const graphDbPath = process.env.GRAPH_DB_PATH || path.join(projectRoot, '.data', 'knowledge-graph');
    const exportDir = process.env.KNOWLEDGE_EXPORT_DIR || path.join(projectRoot, '.data', 'knowledge-export');
    databaseManager = new DatabaseManager({
      sqlite: {
        path: sqlitePath,
        enabled: true
      },
      qdrant: {
        host: process.env.QDRANT_URL?.replace('http://', '').replace(':6333', '') || 'localhost',
        port: 6333,
        enabled: process.env.VKB_QDRANT_ENABLED === 'true' || process.env.VKB_QDRANT_ENABLED === 'auto' || process.env.VKB_QDRANT_ENABLED === undefined
      },
      graphDbPath: graphDbPath,
      exportDir: exportDir,
      graphDb: {
        enabled: true
      }
    });
    logger.info(`DatabaseManager created (mode: ${dataSourceMode})`);
  }

  try {
    // Start Express server immediately (enables health checks)
    await startServer({ port, databaseManager, distDir, debug: true });
    logger.info('Express server started - initializing in background...');

    // Background initialization (non-blocking)
    (async () => {
      try {
        // Step 1: Initialize DatabaseManager
        if (databaseManager) {
          logger.info('Initializing DatabaseManager...');
          await databaseManager.initialize();
          startupState.updateDetail('databaseManagerReady', true);
          logger.info('DatabaseManager initialized');
        } else {
          startupState.updateDetail('databaseManagerReady', true);
        }

        // Step 2: Prepare data via DataProcessor
        const teamsEnv = process.env.KNOWLEDGE_VIEW || process.env.CODING_TEAM || 'coding';
        const teams = teamsEnv.replace(/[{}]/g, '').split(/[,\s]+/).map(t => t.trim()).filter(t => t);
        if (teams.length === 0) teams.push('coding');

        const knowledgeExportDir = path.join(projectRoot, '.data', 'knowledge-export');
        const knowledgeExportPaths = teams.map(team => path.join(knowledgeExportDir, `${team.toLowerCase()}.json`));

        const dataProcessor = new DataProcessor({
          knowledgeExportPath: knowledgeExportPaths[0],
          knowledgeExportPaths,
          teams,
          visualizerDir: path.join(projectRoot, 'integrations', 'memory-visualizer'),
          projectRoot,
          dataSourceMode,
          useDatabaseBackend,
          databaseManager
        });

        logger.info('Preparing data...');
        await dataProcessor.prepareData();
        startupState.updateDetail('dataProcessorReady', true);
        logger.info('Data preparation complete');

        // Mark as fully ready
        startupState.setReady();
        logger.info('VKB server fully initialized and ready');
      } catch (error) {
        logger.error(`Background initialization failed: ${error.message}`);
        startupState.setError(error);
      }
    })();
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
});
