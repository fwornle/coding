#!/usr/bin/env node
/**
 * SSE-based MCP server for browser-access
 *
 * This server runs as a single persistent process that multiple Claude Code sessions
 * can connect to, avoiding the conflict where multiple stdio-based servers compete
 * for the same Chrome DevTools Protocol connection.
 */

// @ts-ignore - Express types may not be installed
import express from 'express';
type Request = any;
type Response = any;
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Stagehand } from "@browserbasehq/stagehand";
import type { ConstructorParams } from "@browserbasehq/stagehand";

import { sanitizeMessage } from "./utils.js";
import {
  log,
  logRequest,
  logResponse,
  operationLogs,
  ensureLogDirectory,
  setupLogRotation,
  scheduleLogRotation,
  registerExitHandlers,
  logLineToString,
} from "./logging.js";
import { TOOLS, handleToolCall } from "./tools.js";
import { PROMPTS, getPrompt } from "./prompts.js";
import {
  listResources,
  listResourceTemplates,
  readResource,
} from "./resources.js";

const PORT = parseInt(process.env.BROWSER_ACCESS_PORT || '3847', 10);

// Helper function to get the correct browser WebSocket URL
async function getBrowserWebSocketUrl(cdpUrl: string): Promise<string> {
  try {
    const port = cdpUrl.split(':').pop();
    const response = await fetch(`http://localhost:${port}/json/version`);
    const data = await response.json();
    return data.webSocketDebuggerUrl;
  } catch (error) {
    log(`Failed to get browser WebSocket URL: ${error}`, "error");
    return cdpUrl;
  }
}

// Stagehand configuration
const getStagehandConfig = async (): Promise<ConstructorParams> => ({
  env:
    process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID
      ? "BROWSERBASE"
      : "LOCAL",
  apiKey: process.env.BROWSERBASE_API_KEY,
  projectId: process.env.BROWSERBASE_PROJECT_ID,
  logger: (message) => console.error(logLineToString(message)),
  domSettleTimeoutMs: 30_000,
  browserbaseSessionCreateParams:
    process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID
      ? {
          projectId: process.env.BROWSERBASE_PROJECT_ID!,
          browserSettings: process.env.CONTEXT_ID
            ? {
                context: {
                  id: process.env.CONTEXT_ID,
                  persist: true,
                },
              }
            : undefined,
        }
      : undefined,
  localBrowserLaunchOptions: process.env.LOCAL_CDP_URL
    ? {
        cdpUrl: await getBrowserWebSocketUrl(process.env.LOCAL_CDP_URL),
      }
    : undefined,
  enableCaching: true,
  browserbaseSessionID: undefined,
  modelName: "claude-3-5-sonnet-20241022",
  modelClientOptions: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: "https://api.anthropic.com",
  },
  useAPI: false,
});

// Global shared Stagehand instance
let stagehand: Stagehand | undefined;

async function ensureStagehand() {
  const stagehandConfig = await getStagehandConfig();

  if (
    stagehandConfig.env === "LOCAL" &&
    !stagehandConfig.localBrowserLaunchOptions?.cdpUrl
  ) {
    throw new Error(
      'Using a local browser without providing a CDP URL is not supported. Please provide a CDP URL using the LOCAL_CDP_URL environment variable.'
    );
  }

  try {
    if (!stagehand) {
      stagehand = new Stagehand(stagehandConfig);
      await stagehand.init();
      return stagehand;
    }

    // Check if the session is still valid
    try {
      await stagehand.page.evaluate(() => document.title);
      return stagehand;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("Target page, context or browser has been closed") ||
          error.message.includes("Session expired") ||
          error.message.includes("context destroyed"))
      ) {
        log("Browser session expired, reinitializing Stagehand...", "info");
        const newConfig = await getStagehandConfig();
        stagehand = new Stagehand(newConfig);
        await stagehand.init();
        return stagehand;
      }
      throw error;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`Failed to initialize/reinitialize Stagehand: ${errorMsg}`, "error");
    throw error;
  }
}

// Create MCP server for a session
function createMcpServer() {
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

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    try {
      logRequest("ListTools", request.params);
      const response = { tools: TOOLS };
      const sanitizedResponse = sanitizeMessage(response);
      logResponse("ListTools", JSON.parse(sanitizedResponse));
      return JSON.parse(sanitizedResponse);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        error: { code: -32603, message: `Internal error: ${errorMsg}` },
      };
    }
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      logRequest("CallTool", request.params);
      operationLogs.length = 0;

      if (!request.params?.name || !TOOLS.find((t) => t.name === request.params.name)) {
        throw new Error(`Invalid tool name: ${request.params?.name}`);
      }

      try {
        stagehand = await ensureStagehand();
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const config = await getStagehandConfig();
        return {
          content: [
            { type: "text", text: `Failed to initialize Stagehand: ${errorMsg}.\n\nConfig: ${JSON.stringify(config, null, 2)}` },
            { type: "text", text: `Operation logs:\n${operationLogs.join("\n")}` },
          ],
          isError: true,
        };
      }

      const result = await handleToolCall(
        request.params.name,
        request.params.arguments ?? {},
        stagehand
      );

      const sanitizedResult = sanitizeMessage(result);
      logResponse("CallTool", JSON.parse(sanitizedResult));
      return JSON.parse(sanitizedResult);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        error: { code: -32603, message: `Internal error: ${errorMsg}` },
      };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    try {
      logRequest("ListResources", request.params);
      const response = listResources();
      const sanitizedResponse = sanitizeMessage(response);
      logResponse("ListResources", JSON.parse(sanitizedResponse));
      return JSON.parse(sanitizedResponse);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        error: { code: -32603, message: `Internal error: ${errorMsg}` },
      };
    }
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (request) => {
    try {
      logRequest("ListResourceTemplates", request.params);
      const response = listResourceTemplates();
      const sanitizedResponse = sanitizeMessage(response);
      logResponse("ListResourceTemplates", JSON.parse(sanitizedResponse));
      return JSON.parse(sanitizedResponse);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        error: { code: -32603, message: `Internal error: ${errorMsg}` },
      };
    }
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    try {
      logRequest("ReadResource", request.params);
      const uri = request.params.uri.toString();
      const response = readResource(uri);
      const sanitizedResponse = sanitizeMessage(response);
      logResponse("ReadResource", JSON.parse(sanitizedResponse));
      return JSON.parse(sanitizedResponse);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        error: { code: -32603, message: `Internal error: ${errorMsg}` },
      };
    }
  });

  server.setRequestHandler(ListPromptsRequestSchema, async (request) => {
    try {
      logRequest("ListPrompts", request.params);
      const response = { prompts: PROMPTS };
      const sanitizedResponse = sanitizeMessage(response);
      logResponse("ListPrompts", JSON.parse(sanitizedResponse));
      return JSON.parse(sanitizedResponse);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        error: { code: -32603, message: `Internal error: ${errorMsg}` },
      };
    }
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    try {
      logRequest("GetPrompt", request.params);
      try {
        const prompt = getPrompt(request.params?.name || "");
        const sanitizedResponse = sanitizeMessage(prompt);
        logResponse("GetPrompt", JSON.parse(sanitizedResponse));
        return JSON.parse(sanitizedResponse);
      } catch (error) {
        throw new Error(`Invalid prompt name: ${request.params?.name}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        error: { code: -32603, message: `Internal error: ${errorMsg}` },
      };
    }
  });

  return server;
}

// Express app with SSE transport
const app = express();
app.use(express.json());

// Store transports by session ID
const transports: Record<string, SSEServerTransport> = {};

// Store heartbeat intervals by session ID
const heartbeatIntervals: Record<string, NodeJS.Timeout> = {};

// Heartbeat interval in milliseconds (15 seconds)
const HEARTBEAT_INTERVAL_MS = 15000;

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    sessions: Object.keys(transports).length,
    activeHeartbeats: Object.keys(heartbeatIntervals).length,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    stagehandInitialized: !!stagehand,
    uptime: process.uptime(),
  });
});

// SSE endpoint for establishing the stream
app.get('/sse', async (_req: Request, res: Response) => {
  log(`New SSE connection request`, "info");
  try {
    const transport = new SSEServerTransport('/messages', res);
    const sessionId = transport.sessionId;
    transports[sessionId] = transport;

    // Set up heartbeat to keep SSE connection alive
    // SSE comments (lines starting with ':') are ignored by clients but keep the connection open
    const heartbeatInterval = setInterval(() => {
      try {
        // Check if response is still writable before sending heartbeat
        if (!res.writableEnded && !res.destroyed) {
          res.write(`:heartbeat ${Date.now()}\n\n`);
        } else {
          // Connection is closed, clean up
          clearInterval(heartbeatInterval);
          delete heartbeatIntervals[sessionId];
        }
      } catch (error) {
        // Connection likely closed, clean up
        clearInterval(heartbeatInterval);
        delete heartbeatIntervals[sessionId];
      }
    }, HEARTBEAT_INTERVAL_MS);
    heartbeatIntervals[sessionId] = heartbeatInterval;

    transport.onclose = () => {
      log(`SSE transport closed for session ${sessionId}`, "info");
      // Clean up heartbeat interval
      if (heartbeatIntervals[sessionId]) {
        clearInterval(heartbeatIntervals[sessionId]);
        delete heartbeatIntervals[sessionId];
      }
      delete transports[sessionId];
    };

    // Also clean up on response close (handles client disconnect)
    res.on('close', () => {
      if (heartbeatIntervals[sessionId]) {
        clearInterval(heartbeatIntervals[sessionId]);
        delete heartbeatIntervals[sessionId];
      }
    });

    const server = createMcpServer();
    await server.connect(transport);
    log(`Established SSE stream with session ID: ${sessionId}`, "info");
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`Error establishing SSE stream: ${errorMsg}`, "error");
    if (!res.headersSent) {
      res.status(500).send('Error establishing SSE stream');
    }
  }
});

// Messages endpoint for receiving client JSON-RPC requests
app.post('/messages', async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId) {
    res.status(400).send('Missing sessionId parameter');
    return;
  }

  const transport = transports[sessionId];
  if (!transport) {
    log(`No active transport found for session ID: ${sessionId}`, "error");
    res.status(404).send('Session not found');
    return;
  }

  try {
    await transport.handlePostMessage(req, res, req.body);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`Error handling request: ${errorMsg}`, "error");
    if (!res.headersSent) {
      res.status(500).send('Error handling request');
    }
  }
});

// Setup and start
ensureLogDirectory();
setupLogRotation();
scheduleLogRotation();
registerExitHandlers();

app.listen(PORT, () => {
  console.log(`Browser Access SSE Server listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
});

// Handle shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  // Clean up all heartbeat intervals
  for (const sessionId in heartbeatIntervals) {
    clearInterval(heartbeatIntervals[sessionId]);
    delete heartbeatIntervals[sessionId];
  }
  // Close all transports
  for (const sessionId in transports) {
    try {
      await transports[sessionId].close();
      delete transports[sessionId];
    } catch (error) {
      log(`Error closing transport for session ${sessionId}: ${error}`, 'error');
    }
  }
  log('Server shutdown complete', 'info');
  process.exit(0);
});
