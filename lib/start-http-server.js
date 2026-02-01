#!/usr/bin/env node

import { CopilotHTTPServer } from './adapters/copilot-http-server.js';

async function startHTTPServer() {
  try {
    const port = process.env.FALLBACK_SERVICE_PORT || 8765;
    const server = new CopilotHTTPServer(port);
    await server.start();
    
    process.stdout.write(`✓ HTTP server started on port ${port}\n`);
    
    // Handle shutdown
    process.on('SIGINT', async () => {
      process.stdout.write('\nShutting down HTTP server...\n');
      await server.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      process.stdout.write('\nShutting down HTTP server...\n');
      await server.stop();
      process.exit(0);
    });
    
  } catch (error) {
    process.stderr.write(`Failed to start HTTP server: ${error.message}\n`);
    process.exit(1);
  }
}

startHTTPServer();
