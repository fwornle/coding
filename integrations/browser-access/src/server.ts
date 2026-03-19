import { Server } from "@modelcontextprotocol/sdk/server/index.js";
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
  setServerInstance,
} from "./logging.js";
import * as fs from "fs";
import * as path from "path";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";

/**
 * Read the Anthropic standard model name from config/llm-providers.yaml.
 * Uses a lightweight regex parse to avoid requiring a YAML dependency.
 */
function getAnthropicModel(): string {
  try {
    const codingRepo = process.env.CODING_REPO || path.resolve(process.cwd());
    const yamlPath = path.join(codingRepo, "config", "llm-providers.yaml");
    const yaml = fs.readFileSync(yamlPath, "utf8");
    const anthropicMatch = yaml.match(/^\s*anthropic:\s*$/m);
    if (anthropicMatch) {
      const afterAnthropic = yaml.slice(
        anthropicMatch.index! + anthropicMatch[0].length
      );
      const standardMatch = afterAnthropic.match(
        /^\s+standard:\s*"?([^"\s\n]+)"?/m
      );
      if (standardMatch) {
        return standardMatch[1];
      }
    }
  } catch {
    // Config unreadable — use default
  }
  return DEFAULT_ANTHROPIC_MODEL;
}

// Helper function to get the correct browser WebSocket URL
async function getBrowserWebSocketUrl(cdpUrl: string): Promise<string> {
  try {
    // Extract port from CDP URL (e.g., "ws://localhost:9222" -> "9222")
    const port = cdpUrl.split(':').pop();
    const response = await fetch(`http://localhost:${port}/json/version`);
    const data = await response.json();
    return data.webSocketDebuggerUrl;
  } catch (error) {
    log(`Failed to get browser WebSocket URL: ${error}`, "error");
    return cdpUrl; // Fallback to original URL
  }
}
import { TOOLS, handleToolCall } from "./tools.js";
import { PROMPTS, getPrompt } from "./prompts.js";
import {
  listResources,
  listResourceTemplates,
  readResource,
} from "./resources.js";

// Define Stagehand configuration
export const getStagehandConfig = async (): Promise<ConstructorParams> => ({
  env:
    process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID
      ? "BROWSERBASE"
      : "LOCAL",
  apiKey: process.env.BROWSERBASE_API_KEY /* API key for authentication */,
  projectId: process.env.BROWSERBASE_PROJECT_ID /* Project identifier */,
  logger: (message) =>
    console.error(
      logLineToString(message)
    ) /* Custom logging function to stderr */,
  domSettleTimeoutMs: 30_000 /* Timeout for DOM to settle in milliseconds */,
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
  enableCaching: true /* Enable caching functionality */,
  browserbaseSessionID:
    undefined /* Session ID for resuming Browserbase sessions */,
  modelName: getAnthropicModel() /* Model name from config/llm-providers.yaml */,
  modelClientOptions: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: "https://api.anthropic.com",
  } /* Configuration options for the model client */,
  useAPI: false,
});

// Global state
let stagehand: Stagehand | undefined;

// Ensure Stagehand is initialized
export async function ensureStagehand() {
  const stagehandConfig = await getStagehandConfig();
  
  if (
    stagehandConfig.env === "LOCAL" &&
    !stagehandConfig.localBrowserLaunchOptions?.cdpUrl
  ) {
    throw new Error(
      'Using a local browser without providing a CDP URL is not supported. Please provide a CDP URL using the LOCAL_CDP_URL environment variable.\n\nTo launch your browser in "debug", see our documentation.\n\nhttps://docs.stagehand.dev/examples/customize_browser#use-your-personal-browser'
    );
  }

  try {
    if (!stagehand) {
      stagehand = new Stagehand(stagehandConfig);
      await stagehand.init();
      return stagehand;
    }

    // Try to perform a simple operation to check if the session is still valid
    try {
      await stagehand.page.evaluate(() => document.title);
      return stagehand;
    } catch (error) {
      // If we get an error indicating the session is invalid, reinitialize
      if (
        error instanceof Error &&
        (error.message.includes(
          "Target page, context or browser has been closed"
        ) ||
          error.message.includes("Session expired") ||
          error.message.includes("context destroyed"))
      ) {
        log("Browser session expired, reinitializing Stagehand...", "info");
        const newConfig = await getStagehandConfig();
        stagehand = new Stagehand(newConfig);
        await stagehand.init();
        return stagehand;
      }
      throw error; // Re-throw if it's a different type of error
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`Failed to initialize/reinitialize Stagehand: ${errorMsg}`, "error");
    throw error;
  }
}

// Create the server
export function createServer() {
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

  // Store server instance for logging
  setServerInstance(server);

  // Setup request handlers
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
        error: {
          code: -32603,
          message: `Internal error: ${errorMsg}`,
        },
      };
    }
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      logRequest("CallTool", request.params);
      operationLogs.length = 0; // Clear logs for new operation

      if (
        !request.params?.name ||
        !TOOLS.find((t) => t.name === request.params.name)
      ) {
        throw new Error(`Invalid tool name: ${request.params?.name}`);
      }

      // Ensure Stagehand is initialized
      try {
        stagehand = await ensureStagehand();
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const config = await getStagehandConfig();
        return {
          content: [
            {
              type: "text",
              text: `Failed to initialize Stagehand: ${errorMsg}.\n\nConfig: ${JSON.stringify(
                config,
                null,
                2
              )}`,
            },
            {
              type: "text",
              text: `Operation logs:\n${operationLogs.join("\n")}`,
            },
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
        error: {
          code: -32603,
          message: `Internal error: ${errorMsg}`,
        },
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
        error: {
          code: -32603,
          message: `Internal error: ${errorMsg}`,
        },
      };
    }
  });

  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    async (request) => {
      try {
        logRequest("ListResourceTemplates", request.params);
        const response = listResourceTemplates();
        const sanitizedResponse = sanitizeMessage(response);
        logResponse("ListResourceTemplates", JSON.parse(sanitizedResponse));
        return JSON.parse(sanitizedResponse);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          error: {
            code: -32603,
            message: `Internal error: ${errorMsg}`,
          },
        };
      }
    }
  );

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
        error: {
          code: -32603,
          message: `Internal error: ${errorMsg}`,
        },
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
        error: {
          code: -32603,
          message: `Internal error: ${errorMsg}`,
        },
      };
    }
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    try {
      logRequest("GetPrompt", request.params);

      // Check if prompt name is valid and get the prompt
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
        error: {
          code: -32603,
          message: `Internal error: ${errorMsg}`,
        },
      };
    }
  });

  return server;
}

// Import missing function from logging
import { formatLogResponse, logLineToString } from "./logging.js";
