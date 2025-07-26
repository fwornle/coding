import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { log, logRequest, logResponse, logError } from "./logging.js";
import { TOOLS, handleToolCall } from "./tools.js";

export function createServer() {
  const server = new Server(
    {
      name: "semantic-analysis",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
    }
  );

  // Setup request handlers
  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    try {
      logRequest("ListTools", request.params);
      const response = { tools: TOOLS };
      logResponse("ListTools", response);
      return response;
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), "ListTools");
      return {
        error: {
          code: -32603,
          message: `Internal error: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      logRequest("CallTool", request.params);

      if (!request.params?.name || !TOOLS.find((t) => t.name === request.params.name)) {
        throw new Error(`Invalid tool name: ${request.params?.name}`);
      }

      const result = await handleToolCall(
        request.params.name,
        request.params.arguments ?? {}
      );

      logResponse("CallTool", result);
      return result;
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), "CallTool");
      return {
        error: {
          code: -32603,
          message: `Internal error: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  });

  return server;
}