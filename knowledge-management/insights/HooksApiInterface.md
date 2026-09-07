# HooksApiInterface

**Type:** Detail

EVENT_MAPPINGS maps unified HookEvent values (e.g. STARTUP, PRE_TOOL) to agent-native names differently per agent: Claude maps PRE_TOOL to 'PreToolUse' while Copilot maps STARTUP to 'sessionStart'.

# HooksApiInterface — Technical Insight Document

## What It Is

HooksApiInterface refers to the abstract contract embodied by `HooksManager`, the base class that defines a unified, agent-agnostic API for registering and translating hook events. `HooksManager`'s constructor explicitly throws ("HooksManager is abstract and cannot be instantiated directly") when instantiated directly, establishing it as an abstract base rather than a usable concrete class. This interface is the foundation that `HookManager` builds upon (`HookManager contains HooksApiInterface`), and it exists alongside sibling implementations such as `ClaudeBridge`, which provides an agent-specific `EVENT_MAP` translating native Claude events ('PreToolUse', 'PostToolUse') to unified names ('pre-tool', 'post-tool').

## Architecture and Design

The design follows the **Template Method** / **Abstract Base Class** pattern: `HooksManager` defines the skeleton of hook management behavior (registration, translation) while deferring agent-specific concerns to subclasses through three mandatory extension points — `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()` — each of which throws a "must be implemented by subclass" error if not overridden. This enforces a strict contract: any concrete agent integration (analogous to `ClaudeBridge`) must supply its own agent-type identifier and native hook persistence logic, while inheriting the unified registration and translation machinery.

A second key pattern is **event-name translation via a mapping table**. `EVENT_MAPPINGS` is a per-agent dictionary that converts unified `HookEvent` enum values into agent-native event strings — for example, Claude maps `PRE_TOOL` to `'PreToolUse'`, while Copilot maps `STARTUP` to `'sessionStart'`. This is conceptually parallel to the sibling `ClaudeBridge`'s `EVENT_MAP`, though `ClaudeBridge` performs the inverse direction (native → unified) whereas `HooksApiInterface`'s `translateEvent()` performs unified → native lookups scoped by the current agent type (via `getAgentType()`). This bidirectional mapping design cleanly separates the "core" unified event model from each agent's idiosyncratic naming.

## Implementation Details

`translateEvent(event)` is the central translation function: it determines the active agent via `getAgentType()`, consults that agent's entry in `EVENT_MAPPINGS`, and returns the native event name — or `null` if the event has no corresponding native counterpart for that agent (e.g., Claude's `POST_PROMPT` maps to `null`). This null-return convention signals "unsupported event for this agent" without throwing, allowing callers to gracefully skip registration for unsupported combinations.

`registerHook()` implements validation and storage: it checks the event argument against `Object.values(HookEvent)` to ensure only recognized unified event types are accepted, rejects any handler that is not a function, and stores valid registrations in a `Map<string, RegisteredHook[]>` keyed by event name. This map-of-arrays structure allows multiple handlers to be registered per event, supporting a fan-out/observer-style dispatch model.

Together, `translateEvent()` and `registerHook()` form the interface's operational core: validate against the unified `HookEvent` enum, translate into agent-native terms when needed, and persist native representations through the abstract `loadNativeHooks()`/`saveNativeHooks()` hooks that subclasses must implement.

## Integration Points

`HooksApiInterface` (via `HooksManager`) is contained by `HookManager`, whose `UnifiedHookManager.initialize(projectPath)` sequences configuration loading — first `loadConfig(userConfigPath, 'user')`, then `loadConfig(projectConfigPath, 'project')` — giving project-level entries precedence through later overwrite. This same load-order pattern appears in the sibling `UnifiedHookManagerConfigLoader`, which computes `projectConfigPath` as `path.join(projectPath, '.coding', 'hooks.json')` and calls `loadConfig` for user config before project config, reinforcing a consistent "user config as default, project config as override" convention across the hooks subsystem.

The interface's dependency on `HookEvent` (used both for `registerHook()` validation and `EVENT_MAPPINGS` keys) makes that enum the shared vocabulary across the entire hooks ecosystem, including sibling components like `ClaudeBridge` (native ↔ unified translation) and tools like `HookMigrationTool`, which supports `--dry-run`, `--no-backup`, `--force`, `--source`, and `--project` flags for migrating hook configurations — implicitly relying on the same unified event model this interface defines.

## Usage Guidelines

Developers must never instantiate `HooksManager` directly; it exists solely to be subclassed, and any attempt to do otherwise fails fast with an explicit error. Concrete agent implementations must supply `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()` — omitting any of these will surface a clear runtime error rather than silent failure, which aids maintainability by making incomplete implementations immediately visible.

When calling `translateEvent()`, callers should treat a `null` result as "this agent does not support this event" rather than as an error condition — for example, Claude does not support `POST_PROMPT`. Handler registration via `registerHook()` requires strict adherence to the `HookEvent` enum and function-typed handlers; invalid events or non-function handlers are rejected, so callers should validate inputs upstream when dynamically constructing hook registrations. Given the precedence rules established at the `HookManager`/`UnifiedHookManagerConfigLoader` level (project overrides user), developers extending or configuring hooks should be mindful that project-level hook definitions will silently override user-level ones with the same key.


## Hierarchy Context

### Parent
- [HookManager](./HookManager.md) -- UnifiedHookManager.initialize(projectPath) loads user config first via loadConfig(userConfigPath, 'user') then project config via loadConfig(projectConfigPath, 'project'), giving project-level entries precedence through later overwrite.

### Siblings
- [ClaudeBridge](./ClaudeBridge.md) -- EVENT_MAP in claude-bridge.js maps native events like 'PreToolUse' and 'PostToolUse' to unified names 'pre-tool' and 'post-tool'.
- [HookMigrationTool](./HookMigrationTool.md) -- parseArgs() supports --dry-run, --no-backup, --force, --source, and --project flags for controlling migration behavior.
- [UnifiedHookManagerConfigLoader](./UnifiedHookManagerConfigLoader.md) -- initialize(projectPath) first calls loadConfig(this.config.userConfigPath, 'user') then, if a projectPath is given, sets projectConfigPath to path.join(projectPath, '.coding', 'hooks.json') and calls loadConfig(..., 'project'), so project config loads and registers after user config.


---

*Generated from 5 observations*
