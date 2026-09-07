# TwoTierConfigLoading

**Type:** Detail

initialize() in hook-manager.js first calls `await this.loadConfig(this.config.userConfigPath, 'user')` then conditionally `await this.loadConfig(this.config.projectConfigPath, 'project')` if a projectPath was supplied

# TwoTierConfigLoading — Technical Insight Document

## What It Is

TwoTierConfigLoading is implemented in `initialize()` within `hook-manager.js`, as a core behavior of the `HookConfigLoader`. It defines a layered configuration strategy in which a user-level configuration file and an optional project-level configuration file are loaded in sequence, allowing project-specific settings to be layered on top of (and potentially override) user-wide defaults. The user configuration path defaults to `path.join(os.homedir(), '.coding-tools', 'hooks.json')`, while the project configuration path is derived dynamically from a supplied `projectPath` as `path.join(projectPath, '.coding', 'hooks.json')`.

## Architecture and Design

The design follows a **tiered override pattern**, common in tools that need to support both global/user defaults and per-project customization. `initialize()` first unconditionally awaits `this.loadConfig(this.config.userConfigPath, 'user')`, establishing baseline settings, and only afterward conditionally awaits `this.loadConfig(this.config.projectConfigPath, 'project')` if a `projectPath` was supplied at construction time. This ordering is a deliberate design decision: user config is always the foundation, and project config — when present — is applied second, giving it the ability to override or refine user-level settings.

This structure cleanly separates *scope resolution* (which paths to check) from *loading mechanics* (how a single config file is parsed), since both tiers funnel through the same `loadConfig()` function. This avoids code duplication and ensures identical semantics (missing-file handling, settings merging) regardless of tier.

## Implementation Details

The two-tier flow is orchestrated entirely inside `initialize()`, which sequences two awaited calls to `loadConfig()` with different path/tier-label arguments (`'user'` and `'project'`). The tier label is primarily used for logging/debugging context rather than altering logic paths.

Each tier is optional at the file-system level: `loadConfig()` performs `if (!fsSync.existsSync(configPath)) { logger.debug(...); return; }`, silently skipping any tier whose file doesn't exist. This makes the entire two-tier mechanism resilient to partial configuration — a user with no `hooks.json` at all, or a project without a `.coding/hooks.json`, will not cause errors; the system simply falls back to constructor defaults.

The actual settings application, handled by the sibling concept **ConfigSettingsOverride**, only takes effect once a config file is successfully loaded. Within `loadConfig()`, the parent-level behavior applies `config.settings.enableLogging`, `stopOnError`, and `timeout` only when those fields are explicitly defined in the loaded JSON (via `!== undefined` checks), otherwise preserving whatever value is already in place. This means when the project tier loads *after* the user tier, only explicitly-set project fields overwrite prior values (whether those came from user config or constructor defaults) — undefined fields simply fall through unchanged. This selective-override behavior is what makes the two-tier sequencing meaningful: without it, layering wouldn't produce partial-override semantics, only full replacement.

## Integration Points

TwoTierConfigLoading is a direct behavioral component of `HookConfigLoader`, and depends on:
- `os.homedir()` and `path.join()` for resolving the user config path
- The externally supplied `projectPath` constructor parameter for resolving the project config path
- `fsSync.existsSync()` for file-presence checks, keeping the loader synchronous-safe for this check despite `loadConfig()` being async overall
- `logger.debug()` for observability when a tier is skipped

Its sibling, **ConfigSettingsOverride**, is tightly coupled: TwoTierConfigLoading determines *when and in what order* configs are loaded, while ConfigSettingsOverride determines *how* values from each loaded config are merged into `this.config`. Together they implement a complete cascading configuration system under `HookConfigLoader`.

## Usage Guidelines

Developers integrating with `HookConfigLoader` should be aware that omitting `projectPath` entirely skips project-tier loading — this is intentional and not an error condition. Both config files are optional; the system is designed to run purely on constructor defaults if neither file exists. When authoring project-level `hooks.json` files, only explicitly-set fields (`enableLogging`, `stopOnError`, `timeout`) will override previously established values — omitting a field is the correct way to "inherit" the user-level or default value rather than reset it. Because project config loads strictly after user config, project files should be treated as the authoritative override layer, and user config as the baseline/fallback layer.


## Hierarchy Context

### Parent
- [HookConfigLoader](./HookConfigLoader.md) -- loadConfig() in hook-manager.js applies config.settings.enableLogging, stopOnError, and timeout only when explicitly defined in the file (`!== undefined` checks), preserving constructor defaults otherwise.

### Siblings
- [ConfigSettingsOverride](./ConfigSettingsOverride.md) -- hook-manager.js loadConfig() checks `if (config.settings.enableLogging !== undefined)` before overwriting `this.config.enableLogging`, and repeats the same pattern for stopOnError and timeout


---

*Generated from 3 observations*
