/**
 * ConfigManager - Centralized configuration management for UKB
 *
 * Manages .ukb-config.json with defaults, validation, and config commands
 */

import { promises as fs } from 'fs';
import path from 'path';

const DEFAULT_CONFIG = {
  defaultBehavior: 'incremental',
  autoCommitCheckpoint: false,
  team: 'coding',
  workflows: {
    'incremental-update': {
      maxCommitsPerRun: 100,
      maxSessionsPerRun: 50,
      significanceThreshold: 5,
      includeGit: true,
      includeVibe: true,
      includeWeb: false
    },
    'complete-analysis': {
      depth: 200,
      daysBack: 90,
      includeGit: true,
      includeVibe: true,
      includeWeb: true,
      significanceThreshold: 6
    },
    'pattern-extraction': {
      focusAreas: ['architectural', 'design', 'performance'],
      significanceThreshold: 7,
      includeWeb: true
    },
    'git-only': {
      depth: 100,
      includeGit: true,
      includeVibe: false,
      includeWeb: false
    },
    'vibe-only': {
      daysBack: 30,
      includeGit: false,
      includeVibe: true,
      includeWeb: false
    }
  },
  storage: {
    checkpoint: '.data/ukb-last-run.json',
    graphDb: '.data/knowledge-graph/',
    jsonExport: '.data/shared-memory-coding.json'
  },
  mcpServer: {
    timeout: 600000,  // 10 minutes
    retries: 3,
    retryDelay: 5000  // 5 seconds
  },
  display: {
    progressBar: true,
    verbose: false,
    colorOutput: true
  }
};

export class ConfigManager {
  constructor(codingRepo, options = {}) {
    this.codingRepo = codingRepo;
    this.configPath = options.configPath ||
      path.join(codingRepo, '.ukb-config.json');
    this.debug = options.debug || false;
    this.config = null;
  }

  /**
   * Load configuration (from file or defaults)
   */
  async loadConfig() {
    if (this.config) {
      return this.config; // Already loaded
    }

    try {
      const data = await fs.readFile(this.configPath, 'utf8');
      const fileConfig = JSON.parse(data);

      // Merge with defaults (file config overrides defaults)
      this.config = this.mergeConfig(DEFAULT_CONFIG, fileConfig);
      this.log('Loaded configuration from file');

    } catch (error) {
      if (error.code === 'ENOENT') {
        this.log('No config file found, using defaults');
        this.config = { ...DEFAULT_CONFIG };
      } else {
        this.log(`Error loading config: ${error.message}, using defaults`);
        this.config = { ...DEFAULT_CONFIG };
      }
    }

    return this.config;
  }

  /**
   * Save configuration to file
   */
  async saveConfig(config = null) {
    const configToSave = config || this.config || DEFAULT_CONFIG;

    // Ensure directory exists
    const configDir = path.dirname(this.configPath);
    await fs.mkdir(configDir, { recursive: true });

    // Write config file
    await fs.writeFile(
      this.configPath,
      JSON.stringify(configToSave, null, 2),
      'utf8'
    );

    this.config = configToSave;
    this.log('Configuration saved');
    return configToSave;
  }

  /**
   * Get configuration value by key (supports dot notation)
   */
  async get(key) {
    await this.loadConfig();

    const keys = key.split('.');
    let value = this.config;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Set configuration value by key (supports dot notation)
   */
  async set(key, value) {
    await this.loadConfig();

    const keys = key.split('.');
    const lastKey = keys.pop();
    let target = this.config;

    // Navigate to the parent object
    for (const k of keys) {
      if (!(k in target)) {
        target[k] = {};
      }
      target = target[k];
    }

    // Set the value
    target[lastKey] = value;

    // Save to file
    await this.saveConfig();

    return value;
  }

  /**
   * Get workflow configuration
   */
  async getWorkflowConfig(workflowName) {
    await this.loadConfig();

    if (workflowName in this.config.workflows) {
      return this.config.workflows[workflowName];
    }

    this.log(`Warning: Unknown workflow '${workflowName}', using incremental-update defaults`);
    return this.config.workflows['incremental-update'];
  }

  /**
   * Get default workflow name
   */
  async getDefaultWorkflow() {
    const behavior = await this.get('defaultBehavior');
    return behavior === 'incremental' ? 'incremental-update' : 'complete-analysis';
  }

  /**
   * Get team name
   */
  async getTeam() {
    return await this.get('team');
  }

  /**
   * List all configuration (formatted)
   */
  async listConfig() {
    await this.loadConfig();
    return this.config;
  }

  /**
   * Reset configuration to defaults
   */
  async resetConfig() {
    this.config = { ...DEFAULT_CONFIG };
    await this.saveConfig();
    this.log('Configuration reset to defaults');
    return this.config;
  }

  /**
   * Validate configuration
   */
  validateConfig(config) {
    const errors = [];

    // Check required top-level keys
    const requiredKeys = ['defaultBehavior', 'workflows', 'storage', 'mcpServer'];
    for (const key of requiredKeys) {
      if (!(key in config)) {
        errors.push(`Missing required key: ${key}`);
      }
    }

    // Validate defaultBehavior
    if (config.defaultBehavior && !['incremental', 'full'].includes(config.defaultBehavior)) {
      errors.push(`Invalid defaultBehavior: ${config.defaultBehavior} (must be 'incremental' or 'full')`);
    }

    // Validate workflow configurations exist
    if (config.workflows) {
      const requiredWorkflows = ['incremental-update', 'complete-analysis'];
      for (const wf of requiredWorkflows) {
        if (!(wf in config.workflows)) {
          errors.push(`Missing required workflow: ${wf}`);
        }
      }
    }

    // Validate storage paths
    if (config.storage) {
      const requiredPaths = ['checkpoint', 'graphDb', 'jsonExport'];
      for (const pathKey of requiredPaths) {
        if (!config.storage[pathKey]) {
          errors.push(`Missing storage path: ${pathKey}`);
        }
      }
    }

    // Validate MCP server settings
    if (config.mcpServer) {
      if (config.mcpServer.timeout && config.mcpServer.timeout < 10000) {
        errors.push('MCP timeout must be at least 10000ms (10 seconds)');
      }
      if (config.mcpServer.retries && (config.mcpServer.retries < 0 || config.mcpServer.retries > 10)) {
        errors.push('MCP retries must be between 0 and 10');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Deep merge two configuration objects
   */
  mergeConfig(defaults, overrides) {
    const merged = { ...defaults };

    for (const key in overrides) {
      if (overrides[key] && typeof overrides[key] === 'object' && !Array.isArray(overrides[key])) {
        // Recursive merge for nested objects
        merged[key] = this.mergeConfig(defaults[key] || {}, overrides[key]);
      } else {
        // Direct override for primitives and arrays
        merged[key] = overrides[key];
      }
    }

    return merged;
  }

  /**
   * Get storage paths
   */
  async getStoragePaths() {
    await this.loadConfig();

    return {
      checkpoint: path.join(this.codingRepo, this.config.storage.checkpoint),
      graphDb: path.join(this.codingRepo, this.config.storage.graphDb),
      jsonExport: path.join(this.codingRepo, this.config.storage.jsonExport)
    };
  }

  /**
   * Check if auto-commit is enabled
   */
  async isAutoCommitEnabled() {
    return await this.get('autoCommitCheckpoint');
  }

  /**
   * Debug logging
   */
  log(message) {
    if (this.debug) {
      console.log(`[ConfigManager] ${message}`);
    }
  }
}

// Export default config for reference
export { DEFAULT_CONFIG };
