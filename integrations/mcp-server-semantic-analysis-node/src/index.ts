#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { setupLogging, log } from "./logging.js";

// Setup logging
setupLogging();

// Run the server
async function runServer() {
  try {
    log("Starting Semantic Analysis MCP Server...", "info");
    
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    server.sendLoggingMessage({
      level: "info",
      data: "Semantic Analysis MCP server is ready to accept requests",
    });
    
    log("Server connected and ready", "info");
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`Failed to start server: ${errorMsg}`, "error");
    console.error(errorMsg);
    process.exit(1);
  }
}

runServer().catch((error) => {
  const errorMsg = error instanceof Error ? error.message : String(error);
  console.error(errorMsg);
  process.exit(1);
});