/**
 * Configuration Manager - Cross-platform configuration handling
 */

import { promises as fs } from 'fs';
import { readFileSync, accessSync } from 'fs';
import path from 'path';
import os from 'os';
import { createLogger } from '../../../logging/Logger.js';

const logger = createLogger('config');

export class ConfigManager {
  constructor(options = {}) {
    this.options = options;
    this.config = null;
    this.configPaths = this._getConfigPaths();
  }

  /**
   * Get configuration value
   */
  get(key, defaultValue = null) {
    if (!this.config) {
      this.config = this._loadConfig();
    }
    
    return this._getNestedValue(this.config, key, defaultValue);
  }

  /**
   * Set configuration value
   */
  set(key, value) {
    if (!this.config) {
      this.config = this._loadConfig();
    }
    
    this._setNestedValue(this.config, key, value);
  }

  /**
   * Save configuration to file
   */
  async save(configPath = null) {
    if (!this.config) {
      return;
    }
    
    const targetPath = configPath || this.configPaths.user;
    
    try {
      await this._ensureDirectoryExists(path.dirname(targetPath));
      await fs.writeFile(targetPath, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (error) {
      logger.warn(`Failed to save config to ${targetPath}`, { error: error.message });
    }
  }

  /**
   * Get all configuration
   */
  getAll() {
    if (!this.config) {
      this.config = this._loadConfig();
    }
    
    return { ...this.config };
  }

  /**
   * Reset to default configuration
   */
  reset() {
    this.config = this._getDefaultConfig();
  }

  /**
   * Validate configuration
   */
  validate() {
    const config = this.getAll();
    const errors = [];
    
    // Validate storage configuration
    if (!config.storage || !config.storage.path) {
      errors.push('Storage path is required');
    }
    
    // Validate paths exist or can be created
    try {
      const storagePath = path.resolve(config.storage.path);
      const storageDir = path.dirname(storagePath);
      // This will throw if directory doesn't exist and can't be created
      fs.access(storageDir);
    } catch (error) {
      errors.push(`Storage directory not accessible: ${path.dirname(config.storage.path)}`);
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  // Private methods

  _loadConfig() {
    // Start with default configuration
    let config = this._getDefaultConfig();
    
    // Override with options passed to constructor
    config = this._mergeConfig(config, this.options);
    
    // Try to load from config files (in order of precedence)
    for (const configPath of Object.values(this.configPaths)) {
      try {
        const fileConfig = this._loadConfigFile(configPath);
        if (fileConfig) {
          config = this._mergeConfig(config, fileConfig);
        }
      } catch (error) {
        // Ignore file not found errors, log others
        if (error.code !== 'ENOENT') {
          logger.warn(`Error loading config from ${configPath}`, { error: error.message });
        }
      }
    }
    
    // Apply environment variable overrides
    config = this._applyEnvironmentOverrides(config);
    
    return config;
  }

  _loadConfigFile(configPath) {
    try {
      const content = readFileSync(configPath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  _getDefaultConfig() {
    return {
      storage: {
        backend: 'file',
        path: this._resolveDefaultStoragePath(),
        team: process.env.CODING_TEAM || 'default',
        codingPath: this._resolveCodingStoragePath()
      },
      integrations: {
        mcp: {
          enabled: true,
          auto_sync: false
        },
        visualizer: {
          enabled: true,
          path: this._resolveVisualizerPath(),
          auto_sync: false
        },
        specstory: {
          enabled: true,
          auto_analyze: false
        }
      },
      analysis: {
        auto_commit_analysis: false,
        significance_threshold: 7,
        max_commits_per_session: 50,
        conversation_analysis: false,
        specstory_analysis: false
      },
      logging: {
        level: 'info',
        console: true,
        file: false
      },
      validation: {
        strict_mode: false,
        auto_fix: true
      },
      cli: {
        interactive_mode: true,
        color_output: true,
        progress_bars: true
      }
    };
  }

  _getConfigPaths() {
    const homeDir = os.homedir();
    const projectRoot = this._findProjectRoot();
    
    return {
      // Project-specific config (highest precedence)
      project: projectRoot ? path.join(projectRoot, '.knowledge-api.json') : null,
      // User config directory
      user: path.join(homeDir, '.config', 'knowledge-api', 'config.json'),
      // Global system config (lowest precedence)
      global: path.join('/etc', 'knowledge-api', 'config.json')
    };
  }

  _findProjectRoot() {
    let currentDir = process.cwd();
    
    while (currentDir !== path.dirname(currentDir)) {
      // Look for project indicators
      const indicators = [
        'CLAUDE.md',
        'package.json',
        '.git'
      ];
      
      // Check for standard project indicators
      for (const indicator of indicators) {
        const indicatorPath = path.join(currentDir, indicator);
        try {
          accessSync(indicatorPath);
          return currentDir;
        } catch {
          // Continue searching
        }
      }
      
      // Also check for knowledge export directory
      try {
        const knowledgeExportPath = path.join(currentDir, '.data', 'knowledge-export');
        accessSync(knowledgeExportPath);
        return currentDir;
      } catch {
        // Continue searching
      }
      
      currentDir = path.dirname(currentDir);
    }
    
    return null;
  }

  _resolveDefaultStoragePath() {
    // Always use CODING_KB_PATH if ukb is being used
    const codingKbPath = process.env.CODING_KB_PATH;
    if (codingKbPath) {
      const projectRoot = this._findProjectRoot();
      if (projectRoot) {
        const projectName = path.basename(projectRoot);
        return path.join(codingKbPath, '.data', 'knowledge-export', `${projectName}.json`);
      }
      return path.join(codingKbPath, '.data', 'knowledge-export', 'coding.json');
    }
    
    // If no CODING_KB_PATH, throw error - files should only be created via ukb
    throw new Error('Knowledge base files can only be created using the ukb command. Use CODING_KB_PATH environment variable to specify location.');
  }

  _resolveCodingStoragePath() {
    const projectRoot = this._findProjectRoot();
    
    if (projectRoot) {
      // Always use .data/knowledge-export/coding.json for cross-team knowledge
      return path.join(projectRoot, '.data', 'knowledge-export', 'coding.json');
    }

    // Fallback to home directory
    return path.join(os.homedir(), '.knowledge-api', 'coding.json');
  }

  _resolveVisualizerPath() {
    const projectRoot = this._findProjectRoot();
    
    if (projectRoot) {
      const visualizerPath = path.join(projectRoot, 'memory-visualizer', 'dist', 'memory.json');
      return visualizerPath;
    }
    
    return null;
  }

  _mergeConfig(target, source) {
    const result = { ...target };
    
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this._mergeConfig(result[key] || {}, value);
      } else {
        result[key] = value;
      }
    }
    
    return result;
  }

  _applyEnvironmentOverrides(config) {
    const envMappings = {
      'KNOWLEDGE_API_STORAGE_PATH': 'storage.path',
      'KNOWLEDGE_API_LOG_LEVEL': 'logging.level',
      'KNOWLEDGE_API_MCP_ENABLED': 'integrations.mcp.enabled',
      'KNOWLEDGE_API_VISUALIZER_PATH': 'integrations.visualizer.path',
      'KNOWLEDGE_API_SIGNIFICANCE_THRESHOLD': 'analysis.significance_threshold',
      'CODING_TEAM': 'storage.team'
    };
    
    const result = { ...config };
    
    for (const [envVar, configPath] of Object.entries(envMappings)) {
      const envValue = process.env[envVar];
      if (envValue !== undefined) {
        let parsedValue = envValue;
        
        // Type coercion for known types
        if (configPath.includes('enabled') || envValue === 'true' || envValue === 'false') {
          parsedValue = envValue === 'true';
        } else if (configPath.includes('threshold') || /^\d+$/.test(envValue)) {
          parsedValue = parseInt(envValue, 10);
        }
        
        this._setNestedValue(result, configPath, parsedValue);
      }
    }
    
    return result;
  }

  _getNestedValue(obj, key, defaultValue) {
    const keys = key.split('.');
    let current = obj;
    
    for (const k of keys) {
      if (current === null || current === undefined || !(k in current)) {
        return defaultValue;
      }
      current = current[k];
    }
    
    return current;
  }

  _setNestedValue(obj, key, value) {
    const keys = key.split('.');
    let current = obj;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in current) || typeof current[k] !== 'object') {
        current[k] = {};
      }
      current = current[k];
    }
    
    current[keys[keys.length - 1]] = value;
  }

  async _ensureDirectoryExists(dirPath) {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  /**
   * Get platform-specific information
   */
  static getPlatformInfo() {
    return {
      platform: os.platform(),
      architecture: os.arch(),
      nodeVersion: process.version,
      homeDirectory: os.homedir(),
      tempDirectory: os.tmpdir(),
      pathSeparator: path.sep
    };
  }

  /**
   * Detect if running in various environments
   */
  static getEnvironmentInfo() {
    return {
      isWindows: os.platform() === 'win32',
      isMacOS: os.platform() === 'darwin',
      isLinux: os.platform() === 'linux',
      isCI: !!(process.env.CI || process.env.CONTINUOUS_INTEGRATION),
      isDocker: require('fs').existsSync('/.dockerenv'),
      hasGit: this._commandExists('git'),
      hasNode: true, // We're running in Node.js
      hasNpm: this._commandExists('npm'),
      hasYarn: this._commandExists('yarn')
    };
  }

  static _commandExists(command) {
    // Simplified check - assume commands exist for now
    return true;
  }
}