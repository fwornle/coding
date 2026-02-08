/**
 * Agent Abstraction API - Unified interface for coding agents
 *
 * This module provides a unified abstraction layer for working with
 * different coding agents (Claude Code, GitHub Copilot CLI, etc.)
 *
 * The API consists of:
 * - BaseAdapter: Abstract base class for agent adapters
 * - StatuslineProvider: Interface for status line generation
 * - HooksManager: Unified hook system across agents
 * - TranscriptAdapter: Unified transcript/session log handling
 *
 * @example
 * ```js
 * import { getAdapter, HookEvent } from './lib/agent-api/index.js';
 *
 * // Get adapter for the current agent
 * const adapter = await getAdapter('claude');
 * await adapter.initialize({ projectPath: '/path/to/project' });
 *
 * // Use the hooks manager
 * const hooks = adapter.getHooksManager();
 * hooks.registerHook(HookEvent.PRE_TOOL, async (context) => {
 *   logger.info(`Tool call: ${context.tool.name}`);
 *   return { allow: true };
 * });
 *
 * // Get status line
 * const statusline = adapter.getStatuslineProvider();
 * const status = await statusline.getStatus();
 * logger.info(status.text);
 *
 * // Read transcripts
 * const transcripts = adapter.getTranscriptAdapter();
 * const sessions = await transcripts.readTranscripts({ limit: 5 });
 * ```
 */

import { createLogger } from '../logging/Logger.js';

// API Components
import { BaseAdapter } from './base-adapter.js';
import { StatuslineProvider, createStatuslineProvider } from './statusline-api.js';
import { HooksManager, HookEvent, EVENT_MAPPINGS, createHooksManager } from './hooks-api.js';
import { TranscriptAdapter, LSLEntryType, createTranscriptAdapter } from './transcript-api.js';

const logger = createLogger('agent-api');

/**
 * Registry of available adapter classes
 * @type {Map<string, typeof BaseAdapter>}
 */
const adapterRegistry = new Map();

/**
 * Cached adapter instances
 * @type {Map<string, BaseAdapter>}
 */
const adapterCache = new Map();

/**
 * Register an adapter class for an agent type
 * @param {string} agentType - Agent type identifier
 * @param {typeof BaseAdapter} AdapterClass - Adapter class constructor
 */
function registerAdapter(agentType, AdapterClass) {
  if (!(AdapterClass.prototype instanceof BaseAdapter)) {
    throw new Error('Adapter class must extend BaseAdapter');
  }
  adapterRegistry.set(agentType, AdapterClass);
  logger.info(`Registered adapter for agent type: ${agentType}`);
}

/**
 * Get an adapter instance for a specific agent type
 * @param {string} agentType - Agent type ('claude', 'copilot', etc.)
 * @param {Object} [config] - Adapter configuration
 * @param {boolean} [useCache=true] - Whether to use cached instance
 * @returns {Promise<BaseAdapter>}
 */
async function getAdapter(agentType, config = {}, useCache = true) {
  // Check cache first
  if (useCache && adapterCache.has(agentType)) {
    return adapterCache.get(agentType);
  }

  // Check registry for pre-registered adapters
  if (adapterRegistry.has(agentType)) {
    const AdapterClass = adapterRegistry.get(agentType);
    const adapter = new AdapterClass(config);
    if (useCache) {
      adapterCache.set(agentType, adapter);
    }
    return adapter;
  }

  // Dynamically load adapter by convention: adapters/<agentType>-adapter.js
  try {
    const { default: Adapter } = await import(`./adapters/${agentType}-adapter.js`);
    const adapter = new Adapter(config);
    if (useCache) {
      adapterCache.set(agentType, adapter);
    }
    return adapter;
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error(`Unknown agent type: ${agentType}. No adapter at adapters/${agentType}-adapter.js`);
    }
    throw new Error(`Failed to load adapter for ${agentType}: ${error.message}`);
  }
}

/**
 * Get the adapter for the current agent (from environment)
 * @param {Object} [config] - Adapter configuration
 * @returns {Promise<BaseAdapter>}
 */
async function getCurrentAdapter(config = {}) {
  const agentType = process.env.CODING_AGENT;

  if (!agentType) {
    throw new Error('No agent type set. Ensure CODING_AGENT environment variable is set.');
  }

  return getAdapter(agentType, config);
}

/**
 * Clear the adapter cache
 * @param {string} [agentType] - Specific agent type to clear, or all if not specified
 */
function clearAdapterCache(agentType) {
  if (agentType) {
    adapterCache.delete(agentType);
  } else {
    adapterCache.clear();
  }
}

/**
 * Get list of supported agent types (from config/agents/ + registry)
 * @returns {Promise<string[]>}
 */
async function getSupportedAgents() {
  const builtin = ['claude', 'copilot'];
  const registered = Array.from(adapterRegistry.keys());
  // Discover additional agents from config/agents/
  try {
    const { default: AgentDetector } = await import('../agent-detector.js');
    const detector = new AgentDetector();
    const configAgents = detector.agentConfigs.map(c => c.name).filter(Boolean);
    return [...new Set([...builtin, ...registered, ...configAgents])];
  } catch {
    return [...new Set([...builtin, ...registered])];
  }
}

/**
 * Detect which agents are available on the system
 * @returns {Promise<{[key: string]: boolean}>}
 */
async function detectAvailableAgents() {
  const { default: AgentDetector } = await import('../agent-detector.js');
  const detector = new AgentDetector();
  return detector.detectAll();
}

/**
 * Get the best available agent
 * @returns {Promise<string|null>}
 */
async function getBestAgent() {
  const { default: AgentDetector } = await import('../agent-detector.js');
  const detector = new AgentDetector();
  return detector.getBest();
}

// Export everything
export {
  // Base classes
  BaseAdapter,
  StatuslineProvider,
  HooksManager,
  TranscriptAdapter,

  // Enums
  HookEvent,
  LSLEntryType,
  EVENT_MAPPINGS,

  // Factory functions
  getAdapter,
  getCurrentAdapter,
  createStatuslineProvider,
  createHooksManager,
  createTranscriptAdapter,

  // Registry functions
  registerAdapter,
  clearAdapterCache,
  getSupportedAgents,

  // Detection functions
  detectAvailableAgents,
  getBestAgent
};

// Default export for convenience
export default {
  BaseAdapter,
  StatuslineProvider,
  HooksManager,
  TranscriptAdapter,
  HookEvent,
  LSLEntryType,
  getAdapter,
  getCurrentAdapter,
  getSupportedAgents,
  detectAvailableAgents,
  getBestAgent
};
