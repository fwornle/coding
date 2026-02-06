/**
 * Base Adapter - Abstract base class for all agent adapters
 *
 * Defines the contract that all agent adapters must implement.
 * This provides a unified interface for the coding infrastructure
 * to work with any coding agent (Claude Code, GitHub Copilot CLI, etc.)
 */

import { createLogger } from '../logging/Logger.js';

const logger = createLogger('base-adapter');

/**
 * @typedef {Object} AdapterCapabilities
 * @property {boolean} mcp - MCP (Model Context Protocol) support
 * @property {boolean} hooks - Native hook system support
 * @property {boolean} statusline - Status line integration support
 * @property {boolean} transcripts - Transcript/session logging support
 * @property {boolean} memory - Knowledge/memory management support
 * @property {boolean} browser - Browser automation support
 */

/**
 * @typedef {Object} AdapterConfig
 * @property {string} [codingPath] - Path to the coding infrastructure
 * @property {string} [projectPath] - Path to the target project
 * @property {Object} [hooks] - Hook configuration
 * @property {Object} [statusline] - Status line configuration
 * @property {Object} [transcripts] - Transcript configuration
 */

/**
 * Abstract base class for agent adapters
 * All agent-specific adapters must extend this class
 */
class BaseAdapter {
  /**
   * @param {AdapterConfig} config - Adapter configuration
   */
  constructor(config = {}) {
    if (new.target === BaseAdapter) {
      throw new Error('BaseAdapter is abstract and cannot be instantiated directly');
    }

    this.config = config;
    this.initialized = false;

    // Provider instances (lazy-loaded)
    this._statuslineProvider = null;
    this._hooksManager = null;
    this._transcriptAdapter = null;
  }

  // ============================================
  // Abstract Methods - MUST be implemented
  // ============================================

  /**
   * Get the unique identifier for this agent
   * @returns {string} Agent identifier (e.g., 'claude', 'copilot')
   * @abstract
   */
  getName() {
    throw new Error('getName() must be implemented by subclass');
  }

  /**
   * Get the display name for this agent
   * @returns {string} Human-readable agent name
   * @abstract
   */
  getDisplayName() {
    throw new Error('getDisplayName() must be implemented by subclass');
  }

  /**
   * Get the capabilities supported by this agent
   * @returns {AdapterCapabilities} Capabilities object
   * @abstract
   */
  getCapabilities() {
    throw new Error('getCapabilities() must be implemented by subclass');
  }

  /**
   * Initialize the adapter and any required services
   * @param {AdapterConfig} [config] - Optional config override
   * @returns {Promise<void>}
   * @abstract
   */
  async initialize(config) {
    throw new Error('initialize() must be implemented by subclass');
  }

  /**
   * Launch the agent with the given arguments
   * @param {string[]} args - Command line arguments to pass to the agent
   * @returns {Promise<void>}
   * @abstract
   */
  async launch(args = []) {
    throw new Error('launch() must be implemented by subclass');
  }

  /**
   * Get the StatuslineProvider for this agent
   * @returns {import('./statusline-api.js').StatuslineProvider}
   * @abstract
   */
  getStatuslineProvider() {
    throw new Error('getStatuslineProvider() must be implemented by subclass');
  }

  /**
   * Get the HooksManager for this agent
   * @returns {import('./hooks-api.js').HooksManager}
   * @abstract
   */
  getHooksManager() {
    throw new Error('getHooksManager() must be implemented by subclass');
  }

  /**
   * Get the TranscriptAdapter for this agent
   * @returns {import('./transcript-api.js').TranscriptAdapter}
   * @abstract
   */
  getTranscriptAdapter() {
    throw new Error('getTranscriptAdapter() must be implemented by subclass');
  }

  // ============================================
  // Optional Methods - CAN be overridden
  // ============================================

  /**
   * Perform clean shutdown of the adapter
   * @returns {Promise<void>}
   */
  async shutdown() {
    // Default implementation - subclasses can override
    this.initialized = false;
  }

  /**
   * Check if a specific capability is supported
   * @param {keyof AdapterCapabilities} capability - Capability to check
   * @returns {boolean}
   */
  hasCapability(capability) {
    const capabilities = this.getCapabilities();
    return capabilities[capability] === true;
  }

  /**
   * Check if the adapter is initialized
   * @returns {boolean}
   */
  isInitialized() {
    return this.initialized;
  }

  /**
   * Get the version of this adapter
   * @returns {string}
   */
  getVersion() {
    return '1.0.0';
  }

  /**
   * Get adapter-specific metadata
   * @returns {Object}
   */
  getMetadata() {
    return {
      name: this.getName(),
      displayName: this.getDisplayName(),
      version: this.getVersion(),
      capabilities: this.getCapabilities(),
      initialized: this.isInitialized()
    };
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Log a message with adapter context
   * @param {string} message - Message to log
   * @param {'info'|'warn'|'error'|'debug'} [level='info'] - Log level
   */
  log(message, level = 'info') {
    const prefix = `[${this.getDisplayName()}]`;
    const fullMessage = `${prefix} ${message}`;

    switch (level) {
      case 'error':
        logger.error(fullMessage);
        break;
      case 'warn':
        logger.warn(fullMessage);
        break;
      case 'debug':
        logger.debug(fullMessage);
        break;
      default:
        logger.info(fullMessage);
    }
  }

  /**
   * Validate adapter configuration
   * @returns {{valid: boolean, errors: string[]}}
   */
  validateConfig() {
    const errors = [];

    // Base validation - subclasses can extend
    if (!this.config) {
      errors.push('Configuration is required');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

export default BaseAdapter;
export { BaseAdapter };
