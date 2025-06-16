#!/usr/bin/env node

const { CopilotHTTPServer } = require('./adapters/copilot-http-server');

async function startHTTPServer() {
  try {
    const port = process.env.FALLBACK_SERVICE_PORT || 8765;
    const server = new CopilotHTTPServer(port);
    await server.start();
    
    console.log(`✓ HTTP server started on port ${port}`);
    
    // Handle shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down HTTP server...');
      await server.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\nShutting down HTTP server...');
      await server.stop();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Failed to start HTTP server:', error.message);
    process.exit(1);
  }
}

startHTTPServer();
