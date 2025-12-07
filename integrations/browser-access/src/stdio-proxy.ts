#!/usr/bin/env node
/**
 * Stdio proxy that connects to the SSE server
 *
 * This is a lightweight proxy that Claude Code spawns (via stdio transport).
 * It connects to a shared SSE server, forwarding requests/responses.
 * This allows multiple Claude sessions to share the same browser connection.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const SSE_SERVER_URL = process.env.BROWSER_ACCESS_SSE_URL || 'http://localhost:3847';

// Keep process alive with a heartbeat interval
let heartbeatInterval: NodeJS.Timeout | null = null;

async function startProxy() {
  // Connect to the SSE server as a client
  const sseTransport = new SSEClientTransport(new URL(`${SSE_SERVER_URL}/sse`));
  const client = new Client({
    name: "browser-access-proxy",
    version: "1.0.0",
  });

  // Handle SSE transport errors
  sseTransport.onerror = (error) => {
    console.error(`SSE transport error: ${error}`);
    // Don't exit immediately - let the stdio transport handle cleanup
  };

  // Handle SSE transport close
  sseTransport.onclose = () => {
    console.error('SSE transport closed unexpectedly');
    // The process will exit when Claude Code closes the stdio connection
  };

  try {
    await client.connect(sseTransport);
    console.error(`Connected to SSE server at ${SSE_SERVER_URL}`);
  } catch (error) {
    console.error(`Failed to connect to SSE server at ${SSE_SERVER_URL}: ${error}`);
    console.error('Make sure the browser-access SSE server is running: npm run start:sse');
    process.exit(1);
  }

  // Start heartbeat to keep process alive and detect connection issues
  heartbeatInterval = setInterval(() => {
    // This keeps the event loop active
    // The interval itself acts as a keepalive mechanism
  }, 30000);

  // Create stdio server for Claude Code
  const server = new Server(
    {
      name: "stagehand",
      version: "0.1.0",
    },
    {
      capabilities: {
        resources: {},
        tools: {},
        logging: {},
        prompts: {},
      },
    }
  );

  // Forward all requests to the SSE server
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const result = await client.listTools();
    return { tools: result.tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await client.callTool({
      name: request.params.name,
      arguments: request.params.arguments,
    });
    return result;
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const result = await client.listResources();
    return { resources: result.resources };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    const result = await client.listResourceTemplates();
    return { resourceTemplates: result.resourceTemplates };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const result = await client.readResource({ uri: request.params.uri });
    return result;
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    const result = await client.listPrompts();
    return { prompts: result.prompts };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const result = await client.getPrompt({
      name: request.params.name,
      arguments: request.params.arguments,
    });
    return result;
  });

  // Connect to stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  server.sendLoggingMessage({
    level: "info",
    data: "Browser access proxy connected to shared SSE server",
  });

  // Handle stdio transport close (Claude Code disconnected)
  transport.onclose = () => {
    console.error('Stdio transport closed - Claude Code disconnected');
    cleanup();
  };

  // Cleanup function
  function cleanup() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    client.close().catch(() => {});
    process.exit(0);
  }

  // Handle cleanup signals
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Handle stdin close (Claude Code process ended)
  process.stdin.on('close', () => {
    console.error('stdin closed - exiting');
    cleanup();
  });

  // Keep process reference alive
  process.stdin.resume();
}

startProxy().catch((error) => {
  console.error(`Proxy error: ${error}`);
  process.exit(1);
});
