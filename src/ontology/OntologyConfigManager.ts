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
import {
  resolveOntologyPath,
  OntologyPathNotFoundError,
  clearOntologyPathResolverCache,
} from './ontologyPathResolver.js';
import type { OntologyLayoutDetected } from './ontologyPathResolver.js';

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
   * Reset the singleton (for testing).
   *
   * Phase 42.1.1 WR-04: also flush the resolver's module-level path cache so
   * test-time fixture changes do not bleed across `resetInstance()` calls.
   * The resolver cache is keyed by `(kind, team?, ontologyDir)` and persists
   * across singleton lifetimes, so a test that swaps the on-disk layout
   * between two `getInstance(...)` calls would otherwise see stale resolved
   * paths.
   */
  static resetInstance(): void {
    if (OntologyConfigManager.instance) {
      OntologyConfigManager.instance.stopWatching();
      OntologyConfigManager.instance = null;
    }
    clearOntologyPathResolverCache();
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
   * Validate that ontology paths exist.
   *
   * Routes through resolveOntologyPath so callers that pass two-tier paths
   * (the historical convention) still resolve correctly against the flat
   * on-disk layout (Phase 42.1.1). On successful resolve, the config is
   * rewritten IN PLACE to the absolute resolved path so downstream watchers
   * and getters see the real on-disk location.
   *
   * On miss, the OntologyPathNotFoundError message (which already lists every
   * probed alias) is preserved verbatim in the aggregate validation error.
   *
   * Uses process.stderr.write for the structured-log line (project constraint
   * disallows the stdout logger API in this module).
   */
  private async validatePaths(): Promise<void> {
    const errors: string[] = [];

    if (this.config.upperOntologyPath) {
      try {
        const layout: OntologyLayoutDetected = resolveOntologyPath({
          kind: 'upper',
          team: this.config.team,
          configHint: this.config.upperOntologyPath,
        });
        // Rewrite the config in place so downstream watchers and getters see
        // the resolved absolute path (Test B in OntologyConfigManager.layout.test.ts).
        this.config.upperOntologyPath = layout.resolvedPath;
        // One-shot structured stderr line so post-incident forensics can
        // confirm which layout served the registry (T-42.1.1-03).
        process.stderr.write(
          `[OntologyConfigManager] upper ontology resolved: layout=${layout.layout} alias=${layout.alias} path=${layout.resolvedPath}\n`,
        );
      } catch (err) {
        if (err instanceof OntologyPathNotFoundError) {
          errors.push(err.message);
        } else {
          throw err;
        }
      }
    }

    if (this.config.lowerOntologyPath) {
      try {
        const layout: OntologyLayoutDetected = resolveOntologyPath({
          kind: 'lower',
          team: this.config.team,
          configHint: this.config.lowerOntologyPath,
        });
        this.config.lowerOntologyPath = layout.resolvedPath;
        process.stderr.write(
          `[OntologyConfigManager] lower ontology resolved: layout=${layout.layout} alias=${layout.alias} path=${layout.resolvedPath}\n`,
        );
      } catch (err) {
        if (err instanceof OntologyPathNotFoundError) {
          errors.push(err.message);
        } else {
          throw err;
        }
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
   * Inject a new ontology configuration (swap ontologies at runtime).
   *
   * Phase 42.1.1 review fixes:
   *
   *   CR-01: rewires hot-reload file watchers when the resolver picks a
   *          canonical absolute path that differs from the previously-watched
   *          path. Without this rewire, the old polling watcher tracks a stale
   *          (possibly non-existent) path and on-disk edits to the new
   *          ontology never fire `ontologyChanged`.
   *
   *   WR-01: preserves the structured `OntologyPathNotFoundError` on re-throw
   *          using the ES2022 `cause` option so callers retain access to
   *          `kind` / `team` / `probedPaths`.
   *
   *   WR-02: emits one `ontologyInjected` event per kind that actually
   *          changed (upper / lower / team), replacing the hard-coded
   *          `type: 'upper'` that mis-routed lower-only or team-only swaps.
   *
   *   WR-03: when `options.team` changes the team but no `lowerOntologyPath`
   *          is supplied, re-resolves the lower path under the new team so
   *          `getStatus()` / `getConfig()` do not report a team/path mismatch.
   */
  async injectOntology(options: {
    upperOntologyPath?: string;
    lowerOntologyPath?: string;
    team?: string;
    validationMode?: ValidationMode;
  }): Promise<void> {
    const previousConfig = { ...this.config };
    const previousUpper = this.config.upperOntologyPath;
    const previousLower = this.config.lowerOntologyPath;

    if (options.upperOntologyPath) {
      try {
        const layout: OntologyLayoutDetected = resolveOntologyPath({
          kind: 'upper',
          team: options.team ?? this.config.team,
          configHint: options.upperOntologyPath,
        });
        this.config.upperOntologyPath = layout.resolvedPath;
        process.stderr.write(
          `[OntologyConfigManager] upper ontology injected: layout=${layout.layout} alias=${layout.alias} path=${layout.resolvedPath}\n`,
        );
      } catch (err) {
        if (err instanceof OntologyPathNotFoundError) {
          // WR-01: preserve the structured error via `cause` and surface the
          // kind / team / probedPaths fields so the "Upper ontology not found:"
          // prefix contract is honoured AND callers can still
          // `instanceof OntologyPathNotFoundError` via err.cause.
          const wrapped: Error & {
            cause?: unknown;
            probedPaths?: string[];
            kind?: 'upper' | 'lower';
            team?: string;
          } = new Error(`Upper ontology not found: ${err.message}`, {
            cause: err,
          });
          wrapped.probedPaths = err.probedPaths;
          wrapped.kind = err.kind;
          wrapped.team = err.team;
          throw wrapped;
        }
        throw err;
      }
    }

    if (options.lowerOntologyPath) {
      try {
        const layout: OntologyLayoutDetected = resolveOntologyPath({
          kind: 'lower',
          team: options.team ?? this.config.team,
          configHint: options.lowerOntologyPath,
        });
        this.config.lowerOntologyPath = layout.resolvedPath;
        process.stderr.write(
          `[OntologyConfigManager] lower ontology injected: layout=${layout.layout} alias=${layout.alias} path=${layout.resolvedPath}\n`,
        );
      } catch (err) {
        if (err instanceof OntologyPathNotFoundError) {
          // WR-01: same preserve-via-cause pattern as the upper arm above.
          const wrapped: Error & {
            cause?: unknown;
            probedPaths?: string[];
            kind?: 'upper' | 'lower';
            team?: string;
          } = new Error(`Lower ontology not found: ${err.message}`, {
            cause: err,
          });
          wrapped.probedPaths = err.probedPaths;
          wrapped.kind = err.kind;
          wrapped.team = err.team;
          throw wrapped;
        }
        throw err;
      }
    }

    // WR-03: a team-only swap (no explicit lowerOntologyPath) must re-resolve
    // the lower path under the new team — otherwise the manager reports a
    // team/path mismatch via getStatus() and the hot-reload watcher continues
    // polling the OLD team's file. Only attempt the re-resolve when the team
    // is actually changing AND the caller did not already supply a lower path.
    if (
      options.team &&
      options.team !== this.config.team &&
      !options.lowerOntologyPath
    ) {
      try {
        const layout: OntologyLayoutDetected = resolveOntologyPath({
          kind: 'lower',
          team: options.team,
          configHint: this.config.lowerOntologyPath,
        });
        this.config.lowerOntologyPath = layout.resolvedPath;
        process.stderr.write(
          `[OntologyConfigManager] lower ontology re-resolved on team swap: team=${options.team} layout=${layout.layout} alias=${layout.alias} path=${layout.resolvedPath}\n`,
        );
      } catch (err) {
        if (err instanceof OntologyPathNotFoundError) {
          const wrapped: Error & {
            cause?: unknown;
            probedPaths?: string[];
            kind?: 'upper' | 'lower';
            team?: string;
          } = new Error(`Lower ontology not found: ${err.message}`, {
            cause: err,
          });
          wrapped.probedPaths = err.probedPaths;
          wrapped.kind = err.kind;
          wrapped.team = err.team;
          throw wrapped;
        }
        throw err;
      }
    }

    if (options.team) {
      this.config.team = options.team;
    }

    if (options.validationMode && this.config.validation) {
      this.config.validation.mode = options.validationMode;
    }

    // CR-01: re-wire hot-reload watchers when the resolver-canonical path
    // differs from the previously-watched path. Phase 42.1.1's whole point is
    // that the resolved path differs from what callers pass in (two-tier in,
    // flat out), so the old watcher polls a path that no longer represents
    // truth. Only `stopWatchingFile` + `watchFile` when the path actually
    // changed — otherwise the existing watcher is correct and we avoid
    // tearing down a healthy interval.
    if (this.config.hotReload) {
      if (previousUpper !== this.config.upperOntologyPath) {
        if (previousUpper) {
          this.stopWatchingFile(previousUpper);
        }
        if (this.config.upperOntologyPath) {
          this.watchFile(this.config.upperOntologyPath, () => {
            this.emit('ontologyChanged', {
              type: 'upper',
              timestamp: new Date(),
            } as ConfigChangeEvent);
          });
        }
      }
      if (previousLower !== this.config.lowerOntologyPath) {
        if (previousLower) {
          this.stopWatchingFile(previousLower);
        }
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
    }

    // WR-02: emit one `ontologyInjected` event per kind that actually changed
    // so listeners discriminating on `type` route correctly. The previous
    // implementation hard-coded `type: 'upper'` regardless of which arm of the
    // injection ran, which mis-routed every lower-only and team-only swap.
    const changedTypes: Array<'upper' | 'lower' | 'team'> = [];
    if (options.upperOntologyPath) changedTypes.push('upper');
    if (options.lowerOntologyPath) changedTypes.push('lower');
    if (options.team && options.team !== previousConfig.team) {
      changedTypes.push('team');
    }
    // Fallback — if only validationMode changed, still emit one event with the
    // closest-fit type so existing listeners that count events do not silently
    // miss the update. 'upper' was the historical default; preserve it here so
    // the prior single-event contract is honoured for validationMode-only swaps.
    if (changedTypes.length === 0 && options.validationMode) {
      changedTypes.push('upper');
    }
    for (const t of changedTypes) {
      this.emit('ontologyInjected', {
        type: t,
        team: t === 'team' || t === 'lower' ? this.config.team : undefined,
        previousValue: previousConfig,
        newValue: this.config,
        timestamp: new Date(),
      } as ConfigChangeEvent);
    }
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
