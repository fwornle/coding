# UnifiedHookManagerConfigLoader

**Type:** Detail

initialize(projectPath) first calls loadConfig(this.config.userConfigPath, 'user') then, if a projectPath is given, sets projectConfigPath to path.join(projectPath, '.coding', 'hooks.json') and calls loadConfig(..., 'project'), so project config loads and registers after user config.

# UnifiedHookManagerConfigLoader — Technical Insight Document

## What It Is

UnifiedHookManagerConfigLoader is the configuration-loading subsystem embedded within HookManager, responsible for reading, merging, and applying hook configuration files at both the user and project scope. It is invoked as part of `HookManager.initialize(projectPath)`, which first loads the user-level configuration via `loadConfig(this.config.userConfigPath, 'user')` and then, when a `projectPath` is supplied, constructs a project config path via `path.join(projectPath, '.coding', 'hooks.json')` and loads it via `loadConfig(..., 'project')`. This two-tier loading model establishes a clear precedence order: project-specific configuration is always applied after (and therefore can override) user-level configuration.

## Architecture and Design

The design follows a layered configuration overlay pattern, similar in spirit to how many CLI tools separate global/user settings from project-local overrides. Rather than merging configs into a separate structure, the loader mutates `this.config` in place — each successive `loadConfig()` call overwrites global settings (`enableLogging`, `stopOnError`, `timeout`) directly on the shared config object. This is a deliberate simplicity-over-purity trade-off: it avoids building a config-merging abstraction layer, at the cost of making the final state dependent on call order (user before project) rather than on an explicit merge strategy.

Handler registration follows a separate but related pattern: `registerHandler(event, handler)` uses a Map keyed by generated or supplied IDs, providing idempotent-by-id registration (re-registering with the same id overwrites rather than duplicates). Handlers per event are kept in a priority-sorted array, effectively implementing a lightweight priority queue per event type — a common pattern for hook/middleware systems where execution order matters.

## Implementation Details

`loadConfig()` performs a defensive existence check using `fsSync.existsSync()` before attempting to read a file; if the file is absent, it returns silently, and any `ENOENT` encountered during reading is likewise swallowed. This favors graceful degradation — missing user or project configs are not treated as errors. However, other failure modes (malformed JSON, permission issues) are surfaced through `logger.error`, distinguishing "expected absence" from "unexpected failure."

`registerHandler` generates a synthetic id when none is provided, using the pattern `` `${event}-${handler.type}-${Date.now()}` ``. This guarantees uniqueness in the common case but introduces a subtle risk: handlers registered within the same millisecond with identical event/type could collide, causing unintended overwrites in the Map. After insertion, the handler array for the event is re-sorted by ascending priority, ensuring deterministic execution order regardless of registration sequence.

## Integration Points

As a component of HookManager, this loader is the mechanism by which HookManager.initialize(projectPath) becomes environment-aware — loading a project's `.coding/hooks.json` in addition to user-wide settings. It sits alongside sibling subsystems in the broader hook infrastructure: ClaudeBridge, which maps native events (`PreToolUse`, `PostToolUse`) to unified internal names (`pre-tool`, `post-tool`) that presumably align with the event keys used in `registerHandler`; HooksApiInterface, whose abstract `HooksManager` base class enforces subclassing discipline across the hook ecosystem; and HookMigrationTool, which handles config migration workflows (`--dry-run`, `--no-backup`, `--force`, `--source`, `--project`) that likely produce or transform the same `hooks.json` files this loader consumes.

## Usage Guidelines

Developers should be aware that configuration load order is significant and fixed: user config always loads first, project config second, meaning project-level `hooks.json` files are the authoritative source for global settings when both exist. Missing config files are not an error condition and require no special handling by callers. When registering handlers, supplying explicit, stable IDs is advisable in high-throughput or programmatic registration scenarios to avoid the theoretical Date.now()-collision risk in auto-generated IDs. Because registration overwrites by id, re-registering a handler with the same id is a valid pattern for updating handler behavior in place. Finally, since global settings are overwritten in-place rather than deep-merged, partial config files that omit fields will not reset those fields to defaults — only fields explicitly present in a loaded file take effect.


## Hierarchy Context

### Parent
- [HookManager](./HookManager.md) -- UnifiedHookManager.initialize(projectPath) loads user config first via loadConfig(userConfigPath, 'user') then project config via loadConfig(projectConfigPath, 'project'), giving project-level entries precedence through later overwrite.

### Siblings
- [ClaudeBridge](./ClaudeBridge.md) -- EVENT_MAP in claude-bridge.js maps native events like 'PreToolUse' and 'PostToolUse' to unified names 'pre-tool' and 'post-tool'.
- [HooksApiInterface](./HooksApiInterface.md) -- HooksManager's constructor throws if instantiated directly ('HooksManager is abstract and cannot be instantiated directly'), enforcing subclassing.
- [HookMigrationTool](./HookMigrationTool.md) -- parseArgs() supports --dry-run, --no-backup, --force, --source, and --project flags for controlling migration behavior.


---

*Generated from 4 observations*
