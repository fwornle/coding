/**
 * OntologyConfigManager - Singleton manager for ontology configuration
 *
 * Provides:
 * - Hot-reload support via file watching
 * - Event emission on configuration changes
 * - Per-team configuration override
 * - Auto-extend configuration for emerging patterns
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { OntologyConfig, ValidationMode, TeamOntologyConfig } from './types.js';

// Re-export for convenience
export type { TeamOntologyConfig };

/**
 * Auto-extend configuration for suggesting new entity classes
 */
export interface AutoExtendConfig {
  /** Whether auto-extend is enabled */
  enabled: boolean;

  /** Number of similar unclassified entities before suggesting new class */
  suggestionThreshold: number;

  /** Require human approval for auto-extensions */
  requireApproval: boolean;

  /** Similarity threshold for grouping (0-1) */
  similarityThreshold: number;

  /** Path to suggestions storage */
  suggestionsPath: string;
}

/**
 * Extended ontology configuration with auto-extend support
 */
export interface ExtendedOntologyConfig extends OntologyConfig {
  /** Auto-extend configuration */
  autoExtend?: AutoExtendConfig;

  /** Hot-reload enabled */
  hotReload?: boolean;

  /** Watch interval in milliseconds */
  watchInterval?: number;
}

/**
 * Configuration change event
 */
export interface ConfigChangeEvent {
  type: 'upper' | 'lower' | 'team' | 'autoExtend';
  team?: string;
  previousValue?: unknown;
  newValue?: unknown;
  timestamp: Date;
}

/**
 * Singleton manager for ontology configuration
 */
export class OntologyConfigManager extends EventEmitter {
  private static instance: OntologyConfigManager | null = null;

  private config: ExtendedOntologyConfig;
  private teamConfigs: Map<string, TeamOntologyConfig> = new Map();
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private initialized: boolean = false;

  private constructor(config: ExtendedOntologyConfig) {
    super();
    this.config = this.normalizeConfig(config);
  }

  /**
   * Get or create the singleton instance
   */
  static getInstance(config?: ExtendedOntologyConfig): OntologyConfigManager {
    if (!OntologyConfigManager.instance) {
      if (!config) {
        throw new Error('OntologyConfigManager must be initialized with config on first call');
      }
      OntologyConfigManager.instance = new OntologyConfigManager(config);
    }
    return OntologyConfigManager.instance;
  }

  /**
   * Reset the singleton (for testing)
   */
  static resetInstance(): void {
    if (OntologyConfigManager.instance) {
      OntologyConfigManager.instance.stopWatching();
      OntologyConfigManager.instance = null;
    }
  }

  /**
   * Initialize the config manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Validate paths exist
    await this.validatePaths();

    // Set up hot-reload if enabled
    if (this.config.hotReload) {
      await this.startWatching();
    }

    this.initialized = true;
    this.emit('initialized', { config: this.config });
  }

  /**
   * Validate that ontology paths exist
   */
  private async validatePaths(): Promise<void> {
    const errors: string[] = [];

    if (this.config.upperOntologyPath) {
      const upperPath = this.resolvePath(this.config.upperOntologyPath);
      if (!fs.existsSync(upperPath)) {
        errors.push(`Upper ontology not found: ${upperPath}`);
      }
    }

    if (this.config.lowerOntologyPath) {
      const lowerPath = this.resolvePath(this.config.lowerOntologyPath);
      if (!fs.existsSync(lowerPath)) {
        errors.push(`Lower ontology not found: ${lowerPath}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Ontology configuration validation failed:\n${errors.join('\n')}`);
    }
  }

  /**
   * Resolve path relative to project root
   */
  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    // Resolve relative to process.cwd() or project root
    return path.resolve(process.cwd(), filePath);
  }

  /**
   * Normalize configuration with defaults
   */
  private normalizeConfig(config: ExtendedOntologyConfig): ExtendedOntologyConfig {
    return {
      enabled: config.enabled ?? true,
      upperOntologyPath: config.upperOntologyPath,
      team: config.team,
      lowerOntologyPath: config.lowerOntologyPath,
      validation: {
        mode: config.validation?.mode ?? 'lenient',
        failOnError: config.validation?.failOnError ?? false,
        allowUnknownProperties: config.validation?.allowUnknownProperties ?? true,
      },
      classification: {
        useUpper: config.classification?.useUpper ?? true,
        useLower: config.classification?.useLower ?? true,
        minConfidence: config.classification?.minConfidence ?? 0.7,
        enableLLM: config.classification?.enableLLM ?? false,
        enableHeuristics: config.classification?.enableHeuristics ?? true,
        llmBudgetPerClassification: config.classification?.llmBudgetPerClassification ?? 500,
      },
      caching: {
        enabled: config.caching?.enabled ?? true,
        maxEntries: config.caching?.maxEntries ?? 100,
        ttl: config.caching?.ttl ?? 300000, // 5 minutes
      },
      autoExtend: {
        enabled: config.autoExtend?.enabled ?? true,
        suggestionThreshold: config.autoExtend?.suggestionThreshold ?? 3,
        requireApproval: config.autoExtend?.requireApproval ?? true,
        similarityThreshold: config.autoExtend?.similarityThreshold ?? 0.85,
        suggestionsPath: config.autoExtend?.suggestionsPath ?? '.data/ontologies/suggestions',
      },
      hotReload: config.hotReload ?? true,
      watchInterval: config.watchInterval ?? 5000,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): ExtendedOntologyConfig {
    return { ...this.config };
  }

  /**
   * Get configuration for a specific team
   */
  getTeamConfig(team: string): TeamOntologyConfig | undefined {
    return this.teamConfigs.get(team);
  }

  /**
   * Get all team configurations
   */
  getAllTeamConfigs(): Map<string, TeamOntologyConfig> {
    return new Map(this.teamConfigs);
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<ExtendedOntologyConfig>): void {
    const previousConfig = { ...this.config };
    this.config = this.normalizeConfig({ ...this.config, ...updates });

    this.emit('configChanged', {
      type: 'upper',
      previousValue: previousConfig,
      newValue: this.config,
      timestamp: new Date(),
    } as ConfigChangeEvent);
  }

  /**
   * Register a team-specific configuration
   */
  registerTeamConfig(teamConfig: TeamOntologyConfig): void {
    const previous = this.teamConfigs.get(teamConfig.team);
    this.teamConfigs.set(teamConfig.team, teamConfig);

    // Set up watching for team's lower ontology
    if (this.config.hotReload) {
      this.watchFile(teamConfig.lowerOntologyPath, () => {
        this.emit('ontologyChanged', {
          type: 'lower',
          team: teamConfig.team,
          timestamp: new Date(),
        } as ConfigChangeEvent);
      });
    }

    this.emit('teamConfigRegistered', {
      type: 'team',
      team: teamConfig.team,
      previousValue: previous,
      newValue: teamConfig,
      timestamp: new Date(),
    } as ConfigChangeEvent);
  }

  /**
   * Remove a team configuration
   */
  unregisterTeamConfig(team: string): boolean {
    const config = this.teamConfigs.get(team);
    if (config) {
      this.stopWatchingFile(config.lowerOntologyPath);
      this.teamConfigs.delete(team);

      this.emit('teamConfigUnregistered', {
        type: 'team',
        team,
        previousValue: config,
        timestamp: new Date(),
      } as ConfigChangeEvent);

      return true;
    }
    return false;
  }

  /**
   * Inject a new ontology configuration (swap ontologies at runtime)
   */
  async injectOntology(options: {
    upperOntologyPath?: string;
    lowerOntologyPath?: string;
    team?: string;
    validationMode?: ValidationMode;
  }): Promise<void> {
    const previousConfig = { ...this.config };

    if (options.upperOntologyPath) {
      const resolvedPath = this.resolvePath(options.upperOntologyPath);
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Upper ontology not found: ${resolvedPath}`);
      }
      this.config.upperOntologyPath = options.upperOntologyPath;
    }

    if (options.lowerOntologyPath) {
      const resolvedPath = this.resolvePath(options.lowerOntologyPath);
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Lower ontology not found: ${resolvedPath}`);
      }
      this.config.lowerOntologyPath = options.lowerOntologyPath;
    }

    if (options.team) {
      this.config.team = options.team;
    }

    if (options.validationMode && this.config.validation) {
      this.config.validation.mode = options.validationMode;
    }

    // Emit change event for listeners to reload
    this.emit('ontologyInjected', {
      type: 'upper',
      previousValue: previousConfig,
      newValue: this.config,
      timestamp: new Date(),
    } as ConfigChangeEvent);
  }

  /**
   * Get auto-extend configuration
   */
  getAutoExtendConfig(): AutoExtendConfig {
    return { ...this.config.autoExtend! };
  }

  /**
   * Update auto-extend configuration
   */
  updateAutoExtendConfig(updates: Partial<AutoExtendConfig>): void {
    const previous = { ...this.config.autoExtend };
    this.config.autoExtend = { ...this.config.autoExtend!, ...updates };

    this.emit('autoExtendConfigChanged', {
      type: 'autoExtend',
      previousValue: previous,
      newValue: this.config.autoExtend,
      timestamp: new Date(),
    } as ConfigChangeEvent);
  }

  /**
   * Start watching ontology files for changes
   */
  private async startWatching(): Promise<void> {
    // Watch upper ontology
    if (this.config.upperOntologyPath) {
      this.watchFile(this.config.upperOntologyPath, () => {
        this.emit('ontologyChanged', {
          type: 'upper',
          timestamp: new Date(),
        } as ConfigChangeEvent);
      });
    }

    // Watch lower ontology
    if (this.config.lowerOntologyPath) {
      this.watchFile(this.config.lowerOntologyPath, () => {
        this.emit('ontologyChanged', {
          type: 'lower',
          team: this.config.team,
          timestamp: new Date(),
        } as ConfigChangeEvent);
      });
    }
  }

  /**
   * Watch a file for changes
   */
  private watchFile(filePath: string, callback: () => void): void {
    const resolvedPath = this.resolvePath(filePath);

    // Don't watch the same file twice
    if (this.watchers.has(resolvedPath)) {
      return;
    }

    try {
      // Use polling for cross-platform compatibility
      let lastMtime: number = 0;

      const checkFile = () => {
        try {
          const stats = fs.statSync(resolvedPath);
          const mtime = stats.mtimeMs;

          if (lastMtime > 0 && mtime > lastMtime) {
            callback();
          }
          lastMtime = mtime;
        } catch (err) {
          // File might have been deleted temporarily during save
        }
      };

      // Initial check
      checkFile();

      // Set up interval
      const interval = setInterval(checkFile, this.config.watchInterval ?? 5000);

      // Store as pseudo-watcher
      this.watchers.set(resolvedPath, {
        close: () => clearInterval(interval),
      } as fs.FSWatcher);

    } catch (err) {
      console.warn(`Failed to watch ontology file ${resolvedPath}:`, err);
    }
  }

  /**
   * Stop watching a specific file
   */
  private stopWatchingFile(filePath: string): void {
    const resolvedPath = this.resolvePath(filePath);
    const watcher = this.watchers.get(resolvedPath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(resolvedPath);
    }
  }

  /**
   * Stop watching all files
   */
  stopWatching(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }

  /**
   * Get status information
   */
  getStatus(): {
    initialized: boolean;
    enabled: boolean;
    upperOntologyPath: string;
    lowerOntologyPath?: string;
    team?: string;
    hotReload: boolean;
    watchedFiles: string[];
    registeredTeams: string[];
    autoExtend: AutoExtendConfig;
  } {
    return {
      initialized: this.initialized,
      enabled: this.config.enabled,
      upperOntologyPath: this.config.upperOntologyPath,
      lowerOntologyPath: this.config.lowerOntologyPath,
      team: this.config.team,
      hotReload: this.config.hotReload ?? false,
      watchedFiles: Array.from(this.watchers.keys()),
      registeredTeams: Array.from(this.teamConfigs.keys()),
      autoExtend: this.getAutoExtendConfig(),
    };
  }
}

/**
 * Create and initialize a config manager instance
 */
export async function createOntologyConfigManager(
  config: ExtendedOntologyConfig
): Promise<OntologyConfigManager> {
  const manager = OntologyConfigManager.getInstance(config);
  await manager.initialize();
  return manager;
}

export default OntologyConfigManager;
