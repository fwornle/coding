/**
 * Hook Configuration Loader
 *
 * Handles loading and merging hook configurations from multiple sources:
 * - User-level: ~/.coding-tools/hooks.json
 * - Project-level: {project}/.coding/hooks.json
 *
 * Project configuration extends/overrides user configuration.
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { createLogger } from '../../logging/Logger.js';

const logger = createLogger('hook-config');

/**
 * @typedef {Object} HookConfigEntry
 * @property {string} id - Unique identifier for this hook entry
 * @property {string} type - Handler type ('script', 'command', 'module')
 * @property {string} path - Path to the handler
 * @property {string[]} [args] - Arguments for the handler
 * @property {number} [priority=100] - Execution priority (lower = earlier)
 * @property {boolean} [enabled=true] - Whether the hook is enabled
 * @property {string[]} [agents] - Limit to specific agents (empty = all)
 * @property {string} [description] - Human-readable description
 */

/**
 * @typedef {Object} HookConfigFile
 * @property {Object} settings - Global settings
 * @property {boolean} settings.enableLogging - Enable execution logging
 * @property {boolean} settings.stopOnError - Stop on first error
 * @property {number} settings.timeout - Default timeout (ms)
 * @property {Object.<string, HookConfigEntry[]>} hooks - Hooks by event
 */

/**
 * Default configuration paths
 */
const CONFIG_PATHS = {
  user: path.join(os.homedir(), '.coding-tools', 'hooks.json'),
  project: '.coding/hooks.json'
};

/**
 * Default hook configuration
 */
const DEFAULT_CONFIG = {
  settings: {
    enableLogging: true,
    stopOnError: false,
    timeout: 30000
  },
  hooks: {
    'startup': [],
    'shutdown': [],
    'pre-tool': [],
    'post-tool': [],
    'pre-prompt': [],
    'post-prompt': [],
    'error': []
  }
};

/**
 * Hook Configuration Loader
 */
class HookConfigLoader {
  constructor(options = {}) {
    this.options = {
      userConfigPath: options.userConfigPath || CONFIG_PATHS.user,
      projectPath: options.projectPath || process.cwd(),
      createIfMissing: options.createIfMissing || false,
      ...options
    };

    this.userConfig = null;
    this.projectConfig = null;
    this.mergedConfig = null;
  }

  /**
   * Load all configurations
   * @returns {Promise<HookConfigFile>}
   */
  async load() {
    // Load user-level config
    this.userConfig = await this.loadConfigFile(this.options.userConfigPath);

    // Load project-level config
    const projectConfigPath = path.join(this.options.projectPath, CONFIG_PATHS.project);
    this.projectConfig = await this.loadConfigFile(projectConfigPath);

    // Merge configurations
    this.mergedConfig = this.mergeConfigs(this.userConfig, this.projectConfig);

    return this.mergedConfig;
  }

  /**
   * Load a single configuration file
   * @param {string} configPath - Path to config file
   * @returns {Promise<HookConfigFile|null>}
   */
  async loadConfigFile(configPath) {
    try {
      if (!fsSync.existsSync(configPath)) {
        if (this.options.createIfMissing) {
          await this.createDefaultConfig(configPath);
          return { ...DEFAULT_CONFIG };
        }
        return null;
      }

      const content = await fs.readFile(configPath, 'utf8');
      const config = JSON.parse(content);

      // Validate structure
      this.validateConfig(config, configPath);

      logger.debug(`Loaded hook config: ${configPath}`);
      return config;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.error(`Failed to load hook config: ${configPath}`, { error: error.message });
      }
      return null;
    }
  }

  /**
   * Validate configuration structure
   * @param {Object} config - Configuration to validate
   * @param {string} source - Source path for error messages
   */
  validateConfig(config, source) {
    const errors = [];

    if (config.settings) {
      if (config.settings.timeout !== undefined && typeof config.settings.timeout !== 'number') {
        errors.push('settings.timeout must be a number');
      }
      if (config.settings.timeout < 0) {
        errors.push('settings.timeout must be positive');
      }
    }

    if (config.hooks) {
      for (const [event, handlers] of Object.entries(config.hooks)) {
        if (!Array.isArray(handlers)) {
          errors.push(`hooks.${event} must be an array`);
          continue;
        }

        for (let i = 0; i < handlers.length; i++) {
          const handler = handlers[i];

          if (!handler.type) {
            errors.push(`hooks.${event}[${i}].type is required`);
          }

          if (!handler.path) {
            errors.push(`hooks.${event}[${i}].path is required`);
          }

          if (handler.priority !== undefined && typeof handler.priority !== 'number') {
            errors.push(`hooks.${event}[${i}].priority must be a number`);
          }

          if (handler.agents !== undefined && !Array.isArray(handler.agents)) {
            errors.push(`hooks.${event}[${i}].agents must be an array`);
          }
        }
      }
    }

    if (errors.length > 0) {
      logger.warn(`Hook config validation warnings (${source}):`, { errors });
    }
  }

  /**
   * Merge user and project configurations
   * Project config overrides user config
   * @param {HookConfigFile|null} userConfig
   * @param {HookConfigFile|null} projectConfig
   * @returns {HookConfigFile}
   */
  mergeConfigs(userConfig, projectConfig) {
    // Start with defaults
    const merged = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

    // Apply user config
    if (userConfig) {
      this.applyConfig(merged, userConfig, 'user');
    }

    // Apply project config (overrides)
    if (projectConfig) {
      this.applyConfig(merged, projectConfig, 'project');
    }

    return merged;
  }

  /**
   * Apply a config layer to the merged result
   * @param {HookConfigFile} target - Target config to modify
   * @param {HookConfigFile} source - Source config to apply
   * @param {string} sourceName - Source name for tracking
   */
  applyConfig(target, source, sourceName) {
    // Merge settings
    if (source.settings) {
      target.settings = { ...target.settings, ...source.settings };
    }

    // Merge hooks
    if (source.hooks) {
      for (const [event, handlers] of Object.entries(source.hooks)) {
        if (!target.hooks[event]) {
          target.hooks[event] = [];
        }

        for (const handler of handlers) {
          // Add source tracking
          const trackedHandler = {
            ...handler,
            _source: sourceName
          };

          // If handler has an ID, check for override
          if (handler.id) {
            const existingIndex = target.hooks[event].findIndex(h => h.id === handler.id);
            if (existingIndex !== -1) {
              // Override existing handler
              target.hooks[event][existingIndex] = trackedHandler;
              continue;
            }
          }

          // Add new handler
          target.hooks[event].push(trackedHandler);
        }

        // Sort by priority
        target.hooks[event].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
      }
    }
  }

  /**
   * Create a default configuration file
   * @param {string} configPath - Path to create config at
   */
  async createDefaultConfig(configPath) {
    const dir = path.dirname(configPath);

    if (!fsSync.existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }

    const configWithComments = {
      "$schema": "https://coding.example.com/schemas/hooks-config.json",
      "_comment": "Hook configuration for coding infrastructure. See docs/architecture/agent-abstraction-api.md",
      ...DEFAULT_CONFIG
    };

    await fs.writeFile(configPath, JSON.stringify(configWithComments, null, 2));
    logger.info(`Created default hook config: ${configPath}`);
  }

  /**
   * Save configuration to a file
   * @param {HookConfigFile} config - Configuration to save
   * @param {string} configPath - Path to save to
   */
  async saveConfig(config, configPath) {
    const dir = path.dirname(configPath);

    if (!fsSync.existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    logger.info(`Saved hook config: ${configPath}`);
  }

  /**
   * Get the merged configuration
   * @returns {HookConfigFile}
   */
  getConfig() {
    if (!this.mergedConfig) {
      throw new Error('Configuration not loaded. Call load() first.');
    }
    return this.mergedConfig;
  }

  /**
   * Get user configuration
   * @returns {HookConfigFile|null}
   */
  getUserConfig() {
    return this.userConfig;
  }

  /**
   * Get project configuration
   * @returns {HookConfigFile|null}
   */
  getProjectConfig() {
    return this.projectConfig;
  }

  /**
   * Check if user config exists
   * @returns {boolean}
   */
  hasUserConfig() {
    return fsSync.existsSync(this.options.userConfigPath);
  }

  /**
   * Check if project config exists
   * @returns {boolean}
   */
  hasProjectConfig() {
    const projectConfigPath = path.join(this.options.projectPath, CONFIG_PATHS.project);
    return fsSync.existsSync(projectConfigPath);
  }
}

/**
 * Create a hook configuration loader
 * @param {Object} options - Loader options
 * @returns {HookConfigLoader}
 */
function createConfigLoader(options = {}) {
  return new HookConfigLoader(options);
}

export {
  HookConfigLoader,
  createConfigLoader,
  CONFIG_PATHS,
  DEFAULT_CONFIG
};
export default HookConfigLoader;
