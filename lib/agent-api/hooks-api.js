/**
 * Hooks API - Interface for agent hook management
 *
 * Provides a unified abstraction over different agent hook systems:
 * - Claude Code: ~/.claude/settings.json hooks (PreToolUse, PostToolUse, etc.)
 * - Copilot CLI: .github/hooks/hooks.json (sessionStart, preToolUse, etc.)
 *
 * The unified system uses bridge scripts that translate between native formats.
 */

import { createLogger } from '../logging/Logger.js';

const logger = createLogger('hooks-api');

/**
 * Unified hook event names that map to agent-specific events
 * @enum {string}
 */
const HookEvent = {
  /** Agent session starts */
  STARTUP: 'startup',
  /** Agent session ends */
  SHUTDOWN: 'shutdown',
  /** Before tool execution */
  PRE_TOOL: 'pre-tool',
  /** After tool execution */
  POST_TOOL: 'post-tool',
  /** Before user prompt processing */
  PRE_PROMPT: 'pre-prompt',
  /** After user prompt processing */
  POST_PROMPT: 'post-prompt',
  /** Error occurred */
  ERROR: 'error'
};

/**
 * Mapping of unified events to agent-native events
 */
const EVENT_MAPPINGS = {
  claude: {
    [HookEvent.STARTUP]: null,  // Handled by launcher script
    [HookEvent.SHUTDOWN]: null,  // EXIT trap
    [HookEvent.PRE_TOOL]: 'PreToolUse',
    [HookEvent.POST_TOOL]: 'PostToolUse',
    [HookEvent.PRE_PROMPT]: null,  // New via hook
    [HookEvent.POST_PROMPT]: null,  // New via hook
    [HookEvent.ERROR]: null  // New via hook
  },
  copilot: {
    [HookEvent.STARTUP]: 'sessionStart',
    [HookEvent.SHUTDOWN]: 'sessionEnd',
    [HookEvent.PRE_TOOL]: 'preToolUse',
    [HookEvent.POST_TOOL]: 'postToolUse',
    [HookEvent.PRE_PROMPT]: 'userPromptSubmitted',
    [HookEvent.POST_PROMPT]: null,  // Not supported
    [HookEvent.ERROR]: 'errorOccurred'
  }
};

/**
 * @typedef {Object} HookContext
 * @property {string} event - The unified event name
 * @property {string} agentEvent - The agent-native event name
 * @property {string} agentType - The agent type ('claude', 'copilot')
 * @property {string} sessionId - Session identifier
 * @property {number} timestamp - Event timestamp
 * @property {Object} [tool] - Tool information (for tool events)
 * @property {string} [tool.name] - Tool name
 * @property {Object} [tool.input] - Tool input parameters
 * @property {Object} [tool.output] - Tool output (for post-tool events)
 * @property {Object} [prompt] - Prompt information (for prompt events)
 * @property {Error} [error] - Error information (for error events)
 * @property {Object} [metadata] - Additional metadata
 */

/**
 * @typedef {function(HookContext): Promise<{allow?: boolean, message?: string}>} HookHandler
 */

/**
 * @typedef {Object} HookConfig
 * @property {string} [userConfigPath] - Path to user-level config (~/.coding-tools/hooks.json)
 * @property {string} [projectConfigPath] - Path to project-level config (.coding/hooks.json)
 * @property {string} [bridgeScriptPath] - Path to the bridge script for this agent
 * @property {boolean} [enableLogging=true] - Enable hook execution logging
 */

/**
 * @typedef {Object} RegisteredHook
 * @property {string} id - Unique hook identifier
 * @property {HookEvent} event - The event this hook handles
 * @property {HookHandler} handler - The hook handler function
 * @property {number} priority - Execution priority (lower = earlier)
 * @property {string} source - Where the hook was registered from
 */

/**
 * Abstract base class for hook managers
 * Implement this class to provide agent-specific hook functionality
 */
class HooksManager {
  /**
   * @param {HookConfig} config - Hook manager configuration
   */
  constructor(config = {}) {
    if (new.target === HooksManager) {
      throw new Error('HooksManager is abstract and cannot be instantiated directly');
    }

    this.config = {
      enableLogging: true,
      ...config
    };

    /** @type {Map<string, RegisteredHook[]>} */
    this.hooks = new Map();

    // Initialize empty hook arrays for each event
    for (const event of Object.values(HookEvent)) {
      this.hooks.set(event, []);
    }
  }

  // ============================================
  // Abstract Methods - MUST be implemented
  // ============================================

  /**
   * Get the agent type this manager handles
   * @returns {string} Agent type ('claude', 'copilot', etc.)
   * @abstract
   */
  getAgentType() {
    throw new Error('getAgentType() must be implemented by subclass');
  }

  /**
   * Load hooks from agent-native configuration
   * @returns {Promise<void>}
   * @abstract
   */
  async loadNativeHooks() {
    throw new Error('loadNativeHooks() must be implemented by subclass');
  }

  /**
   * Save hooks to agent-native configuration
   * @returns {Promise<void>}
   * @abstract
   */
  async saveNativeHooks() {
    throw new Error('saveNativeHooks() must be implemented by subclass');
  }

  /**
   * Translate unified event to agent-native event name
   * @param {HookEvent} event - Unified event name
   * @returns {string|null} Agent-native event name, or null if not supported
   */
  translateEvent(event) {
    const agentType = this.getAgentType();
    const mapping = EVENT_MAPPINGS[agentType];

    if (!mapping) {
      throw new Error(`No event mapping for agent type: ${agentType}`);
    }

    return mapping[event] || null;
  }

  // ============================================
  // Core Hook Management Methods
  // ============================================

  /**
   * Register a hook handler for a specific event
   * @param {HookEvent} event - The event to handle
   * @param {HookHandler} handler - The handler function
   * @param {Object} [options] - Registration options
   * @param {number} [options.priority=100] - Execution priority
   * @param {string} [options.id] - Hook identifier
   * @param {string} [options.source='api'] - Where the hook was registered from
   * @returns {string} Hook ID
   */
  registerHook(event, handler, options = {}) {
    if (!Object.values(HookEvent).includes(event)) {
      throw new Error(`Invalid hook event: ${event}`);
    }

    if (typeof handler !== 'function') {
      throw new Error('Hook handler must be a function');
    }

    const id = options.id || `hook-${event}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const priority = options.priority ?? 100;
    const source = options.source || 'api';

    const hook = { id, event, handler, priority, source };

    const eventHooks = this.hooks.get(event) || [];
    eventHooks.push(hook);

    // Sort by priority (lower = earlier)
    eventHooks.sort((a, b) => a.priority - b.priority);

    this.hooks.set(event, eventHooks);

    if (this.config.enableLogging) {
      logger.debug(`Registered hook: ${id} for event: ${event} (priority: ${priority})`);
    }

    return id;
  }

  /**
   * Unregister a hook by ID
   * @param {string} hookId - The hook ID to remove
   * @returns {boolean} True if hook was found and removed
   */
  unregisterHook(hookId) {
    for (const [event, hooks] of this.hooks.entries()) {
      const index = hooks.findIndex(h => h.id === hookId);

      if (index !== -1) {
        hooks.splice(index, 1);

        if (this.config.enableLogging) {
          logger.debug(`Unregistered hook: ${hookId} from event: ${event}`);
        }

        return true;
      }
    }

    return false;
  }

  /**
   * Trigger all hooks for a specific event
   * @param {HookEvent} event - The event to trigger
   * @param {Partial<HookContext>} context - Event context
   * @returns {Promise<{allow: boolean, messages: string[]}>}
   */
  async triggerHook(event, context = {}) {
    const eventHooks = this.hooks.get(event) || [];

    if (eventHooks.length === 0) {
      return { allow: true, messages: [] };
    }

    const fullContext = {
      event,
      agentEvent: this.translateEvent(event),
      agentType: this.getAgentType(),
      sessionId: context.sessionId || process.env.CLAUDE_SESSION_ID || process.env.COPILOT_SESSION_ID || 'unknown',
      timestamp: Date.now(),
      ...context
    };

    const messages = [];
    let allow = true;

    for (const hook of eventHooks) {
      try {
        if (this.config.enableLogging) {
          logger.debug(`Executing hook: ${hook.id} for event: ${event}`);
        }

        const result = await hook.handler(fullContext);

        if (result) {
          if (result.allow === false) {
            allow = false;
          }

          if (result.message) {
            messages.push(result.message);
          }
        }
      } catch (error) {
        logger.error(`Hook ${hook.id} threw error`, { error: error.message });
        messages.push(`Hook error (${hook.id}): ${error.message}`);
        // Continue with other hooks even if one fails
      }
    }

    return { allow, messages };
  }

  /**
   * Get all registered hooks
   * @returns {RegisteredHook[]}
   */
  getRegisteredHooks() {
    const allHooks = [];

    for (const hooks of this.hooks.values()) {
      allHooks.push(...hooks);
    }

    return allHooks;
  }

  /**
   * Get hooks for a specific event
   * @param {HookEvent} event - Event to get hooks for
   * @returns {RegisteredHook[]}
   */
  getHooksForEvent(event) {
    return [...(this.hooks.get(event) || [])];
  }

  /**
   * Check if an event has any registered hooks
   * @param {HookEvent} event - Event to check
   * @returns {boolean}
   */
  hasHooks(event) {
    const hooks = this.hooks.get(event);
    return hooks && hooks.length > 0;
  }

  /**
   * Clear all hooks for a specific event
   * @param {HookEvent} event - Event to clear hooks for
   */
  clearHooks(event) {
    this.hooks.set(event, []);

    if (this.config.enableLogging) {
      logger.debug(`Cleared all hooks for event: ${event}`);
    }
  }

  /**
   * Clear all registered hooks
   */
  clearAllHooks() {
    for (const event of Object.values(HookEvent)) {
      this.hooks.set(event, []);
    }

    if (this.config.enableLogging) {
      logger.debug('Cleared all hooks');
    }
  }
}

/**
 * Factory function to create a hooks manager for a specific agent
 * @param {string} agentType - Agent type ('claude', 'copilot', etc.)
 * @param {HookConfig} config - Manager configuration
 * @returns {Promise<HooksManager>}
 */
async function createHooksManager(agentType, config = {}) {
  switch (agentType) {
    case 'claude':
      const { ClaudeHooksManager } = await import('./adapters/claude-adapter.js');
      return new ClaudeHooksManager(config);

    case 'copilot':
      const { CopilotHooksManager } = await import('./adapters/copilot-adapter.js');
      return new CopilotHooksManager(config);

    default:
      throw new Error(`Unknown agent type: ${agentType}`);
  }
}

export {
  HooksManager,
  HookEvent,
  EVENT_MAPPINGS,
  createHooksManager
};
export default HooksManager;
