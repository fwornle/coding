/**
 * Unified Hook Manager - Central orchestration for agent-agnostic hooks
 *
 * This module provides the central hub for hook management across all agents.
 * It handles:
 * - Loading unified hook configuration from ~/.coding-tools/hooks.json and .coding/hooks.json
 * - Dispatching hook events to registered handlers
 * - Providing bridge entry points for agent-native hook systems
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { createLogger } from '../../logging/Logger.js';
import { HookEvent } from '../hooks-api.js';

const logger = createLogger('hook-manager');

/**
 * @typedef {Object} UnifiedHookConfig
 * @property {Object.<string, HookHandler[]>} hooks - Hooks by event name
 * @property {Object} settings - Global hook settings
 * @property {boolean} settings.enableLogging - Enable hook execution logging
 * @property {boolean} settings.stopOnError - Stop execution on first error
 * @property {number} settings.timeout - Default timeout for hook execution (ms)
 */

/**
 * @typedef {Object} HookHandler
 * @property {string} id - Unique handler identifier
 * @property {string} type - Handler type ('script', 'command', 'module')
 * @property {string} path - Path to script/command/module
 * @property {string[]} [args] - Arguments for script/command
 * @property {number} [priority=100] - Execution priority
 * @property {boolean} [enabled=true] - Whether the handler is enabled
 * @property {string[]} [agents] - Limit to specific agents (empty = all)
 */

/**
 * Unified Hook Manager
 * Central orchestration point for all hook events
 */
class UnifiedHookManager {
  constructor(config = {}) {
    this.config = {
      userConfigPath: config.userConfigPath ||
        path.join(os.homedir(), '.coding-tools', 'hooks.json'),
      projectConfigPath: config.projectConfigPath || null,
      enableLogging: config.enableLogging !== false,
      stopOnError: config.stopOnError || false,
      timeout: config.timeout || 30000,
      ...config
    };

    /** @type {Map<string, HookHandler[]>} */
    this.handlers = new Map();

    // Initialize empty handler arrays for each event
    for (const event of Object.values(HookEvent)) {
      this.handlers.set(event, []);
    }

    this.initialized = false;
  }

  /**
   * Initialize the hook manager by loading configurations
   * @param {string} [projectPath] - Optional project path for project-level config
   */
  async initialize(projectPath) {
    if (projectPath) {
      this.config.projectConfigPath = path.join(projectPath, '.coding', 'hooks.json');
    }

    // Load user-level config
    await this.loadConfig(this.config.userConfigPath, 'user');

    // Load project-level config (overrides user)
    if (this.config.projectConfigPath) {
      await this.loadConfig(this.config.projectConfigPath, 'project');
    }

    this.initialized = true;
    logger.info('Unified hook manager initialized');
  }

  /**
   * Load hooks configuration from a file
   * @param {string} configPath - Path to configuration file
   * @param {string} source - Source identifier ('user' or 'project')
   */
  async loadConfig(configPath, source) {
    try {
      if (!fsSync.existsSync(configPath)) {
        logger.debug(`Hook config not found: ${configPath}`);
        return;
      }

      const content = await fs.readFile(configPath, 'utf8');
      const config = JSON.parse(content);

      // Apply global settings
      if (config.settings) {
        if (config.settings.enableLogging !== undefined) {
          this.config.enableLogging = config.settings.enableLogging;
        }
        if (config.settings.stopOnError !== undefined) {
          this.config.stopOnError = config.settings.stopOnError;
        }
        if (config.settings.timeout !== undefined) {
          this.config.timeout = config.settings.timeout;
        }
      }

      // Register hooks
      if (config.hooks) {
        for (const [event, handlers] of Object.entries(config.hooks)) {
          if (!Object.values(HookEvent).includes(event)) {
            logger.warn(`Unknown hook event in config: ${event}`);
            continue;
          }

          for (const handler of handlers) {
            this.registerHandler(event, {
              ...handler,
              source
            });
          }
        }
      }

      logger.info(`Loaded hook config from ${configPath} (${source})`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.error(`Failed to load hook config: ${configPath}`, { error: error.message });
      }
    }
  }

  /**
   * Register a handler for an event
   * @param {string} event - Hook event name
   * @param {HookHandler} handler - Handler configuration
   */
  registerHandler(event, handler) {
    const eventHandlers = this.handlers.get(event) || [];

    // Generate ID if not provided
    const id = handler.id || `${event}-${handler.type}-${Date.now()}`;

    const fullHandler = {
      id,
      type: handler.type || 'script',
      path: handler.path,
      args: handler.args || [],
      priority: handler.priority ?? 100,
      enabled: handler.enabled !== false,
      agents: handler.agents || [],
      source: handler.source || 'api',
      ...handler
    };

    // Check for duplicate ID
    const existingIndex = eventHandlers.findIndex(h => h.id === id);
    if (existingIndex !== -1) {
      eventHandlers[existingIndex] = fullHandler;
    } else {
      eventHandlers.push(fullHandler);
    }

    // Sort by priority
    eventHandlers.sort((a, b) => a.priority - b.priority);

    this.handlers.set(event, eventHandlers);

    if (this.config.enableLogging) {
      logger.debug(`Registered handler: ${id} for event: ${event}`);
    }

    return id;
  }

  /**
   * Unregister a handler by ID
   * @param {string} handlerId - Handler ID to remove
   * @returns {boolean} True if handler was found and removed
   */
  unregisterHandler(handlerId) {
    for (const [event, handlers] of this.handlers.entries()) {
      const index = handlers.findIndex(h => h.id === handlerId);

      if (index !== -1) {
        handlers.splice(index, 1);
        logger.debug(`Unregistered handler: ${handlerId}`);
        return true;
      }
    }

    return false;
  }

  /**
   * Execute all handlers for an event
   * @param {string} event - Event to trigger
   * @param {Object} context - Event context
   * @param {string} [agentType] - Current agent type (for filtering)
   * @returns {Promise<{allow: boolean, messages: string[], results: Object[]}>}
   */
  async executeHooks(event, context = {}, agentType) {
    const handlers = this.handlers.get(event) || [];

    if (handlers.length === 0) {
      return { allow: true, messages: [], results: [] };
    }

    const results = [];
    const messages = [];
    let allow = true;

    const fullContext = {
      event,
      agentType: agentType || process.env.CODING_AGENT || 'unknown',
      sessionId: context.sessionId ||
        process.env.CLAUDE_SESSION_ID ||
        process.env.COPILOT_SESSION_ID ||
        'unknown',
      timestamp: Date.now(),
      ...context
    };

    for (const handler of handlers) {
      // Skip disabled handlers
      if (!handler.enabled) {
        continue;
      }

      // Skip handlers not applicable to current agent
      if (handler.agents && handler.agents.length > 0 && !handler.agents.includes(fullContext.agentType)) {
        continue;
      }

      try {
        if (this.config.enableLogging) {
          logger.debug(`Executing handler: ${handler.id} for event: ${event}`);
        }

        const result = await this.executeHandler(handler, fullContext);
        results.push({ handlerId: handler.id, ...result });

        if (result.allow === false) {
          allow = false;
        }

        if (result.message) {
          messages.push(result.message);
        }

        // Stop on error if configured
        if (this.config.stopOnError && result.error) {
          break;
        }
      } catch (error) {
        logger.error(`Handler ${handler.id} threw error`, { error: error.message });
        results.push({ handlerId: handler.id, error: error.message });
        messages.push(`Handler error (${handler.id}): ${error.message}`);

        if (this.config.stopOnError) {
          break;
        }
      }
    }

    return { allow, messages, results };
  }

  /**
   * Execute a single handler
   * @param {HookHandler} handler - Handler to execute
   * @param {Object} context - Event context
   * @returns {Promise<{allow?: boolean, message?: string, error?: string}>}
   */
  async executeHandler(handler, context) {
    switch (handler.type) {
      case 'script':
        return this.executeScript(handler, context);

      case 'command':
        return this.executeCommand(handler, context);

      case 'module':
        return this.executeModule(handler, context);

      default:
        return { error: `Unknown handler type: ${handler.type}` };
    }
  }

  /**
   * Execute a script handler
   */
  async executeScript(handler, context) {
    const { spawn } = await import('child_process');

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ error: `Handler timeout after ${this.config.timeout}ms` });
      }, this.config.timeout);

      const proc = spawn(handler.path, handler.args || [], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOOK_EVENT: context.event,
          HOOK_AGENT: context.agentType,
          HOOK_SESSION_ID: context.sessionId,
          HOOK_TOOL_NAME: context.tool?.name || ''
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Send context to stdin
      proc.stdin.write(JSON.stringify(context));
      proc.stdin.end();

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        clearTimeout(timeout);

        try {
          const result = stdout.trim() ? JSON.parse(stdout) : {};
          resolve({
            allow: result.allow !== false,
            message: result.message || (code !== 0 ? stderr : undefined)
          });
        } catch {
          resolve({
            allow: code === 0,
            message: stderr || undefined
          });
        }
      });

      proc.on('error', (error) => {
        clearTimeout(timeout);
        resolve({ error: error.message });
      });
    });
  }

  /**
   * Execute a shell command handler
   */
  async executeCommand(handler, context) {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      const command = handler.args ?
        `${handler.path} ${handler.args.join(' ')}` :
        handler.path;

      const { stdout, stderr } = await execAsync(command, {
        timeout: this.config.timeout,
        env: {
          ...process.env,
          HOOK_EVENT: context.event,
          HOOK_CONTEXT: JSON.stringify(context)
        }
      });

      return {
        allow: true,
        message: stdout.trim() || stderr.trim() || undefined
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Execute a module handler (Node.js module)
   */
  async executeModule(handler, context) {
    try {
      const modulePath = path.isAbsolute(handler.path) ?
        handler.path :
        path.resolve(process.cwd(), handler.path);

      const module = await import(modulePath);
      const handlerFn = module.default || module.handler || module;

      if (typeof handlerFn !== 'function') {
        return { error: 'Module does not export a handler function' };
      }

      const result = await handlerFn(context);

      return {
        allow: result?.allow !== false,
        message: result?.message
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Get all registered handlers
   * @returns {HookHandler[]}
   */
  getAllHandlers() {
    const allHandlers = [];

    for (const handlers of this.handlers.values()) {
      allHandlers.push(...handlers);
    }

    return allHandlers;
  }

  /**
   * Get handlers for a specific event
   * @param {string} event - Event name
   * @returns {HookHandler[]}
   */
  getHandlersForEvent(event) {
    return [...(this.handlers.get(event) || [])];
  }

  /**
   * Create default hook configuration file
   * @param {string} configPath - Path to create config at
   */
  async createDefaultConfig(configPath) {
    const defaultConfig = {
      "$schema": "./hooks-config-schema.json",
      "settings": {
        "enableLogging": true,
        "stopOnError": false,
        "timeout": 30000
      },
      "hooks": {
        "startup": [],
        "shutdown": [],
        "pre-tool": [],
        "post-tool": [],
        "pre-prompt": [],
        "error": []
      }
    };

    const dir = path.dirname(configPath);
    if (!fsSync.existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }

    await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
    logger.info(`Created default hook config: ${configPath}`);
  }
}

// Singleton instance for global access
let globalManager = null;

/**
 * Get the global hook manager instance
 * @param {Object} [config] - Configuration (only used on first call)
 * @returns {UnifiedHookManager}
 */
function getHookManager(config) {
  if (!globalManager) {
    globalManager = new UnifiedHookManager(config);
  }
  return globalManager;
}

/**
 * Reset the global hook manager (primarily for testing)
 */
function resetHookManager() {
  globalManager = null;
}

export {
  UnifiedHookManager,
  getHookManager,
  resetHookManager
};
export default UnifiedHookManager;
