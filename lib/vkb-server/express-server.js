#!/usr/bin/env node
/**
 * VKB Express Server
 *
 * Node.js Express server that serves the visualizer and provides API endpoints
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { ApiRoutes } from './api-routes.js';
import { Logger } from './utils/logging.js';
import { runIfMain } from '../utils/esm-cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = new Logger('ExpressServer');

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

  // Health check endpoint (basic - doesn't require database)
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
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

  // Serve static files from dist directory
  if (distDir) {
    app.use(express.static(distDir));
    logger.info(`Serving static files from: ${distDir}`);
  }

  // Catch-all route for SPA (serve index.html for all other routes)
  if (distDir) {
    app.get('*', (req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
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

// CLI mode - start server directly if run as script
runIfMain(import.meta.url, () => {
  const port = parseInt(process.argv[2]) || 8080;
  const distDir = process.argv[3] || path.join(__dirname, '..', '..', 'integrations', 'memory-visualizer', 'dist');

  logger.info(`Starting VKB Express server on port ${port}...`);
  logger.info(`Dist directory: ${distDir}`);

  // Note: In CLI mode, databaseManager needs to be initialized by the caller
  // This is just for basic static file serving
  startServer({ port, distDir, debug: true })
    .then(() => {
      logger.info('Server started successfully');
    })
    .catch((error) => {
      logger.error(`Failed to start server: ${error.message}`);
      process.exit(1);
    });
});
