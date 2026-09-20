# TieredConfigLoader

**Type:** Detail

initialize(projectPath) first calls loadConfig(this.config.userConfigPath, 'user') then loadConfig(this.config.projectConfigPath, 'project'), so project hooks load second and can override

# TieredConfigLoader — Technical Insight Document

## What It Is

TieredConfigLoader is a configuration-loading subcomponent contained within HookManager (specifically the `UnifiedHookManager` class in hook-manager.js). Its responsibility is to resolve hook configuration from two distinct sources — a user-level config and a project-level config — and merge them into the manager's runtime state. It is invoked as part of `initialize(projectPath)`, which sequences a call to `loadConfig(this.config.userConfigPath, 'user')` followed by `loadConfig(this.config.projectConfigPath, 'project')`.

## Architecture and Design

The defining architectural pattern here is **tiered configuration override**: user config is loaded first, and project config is loaded second, so that project-specific hooks.json settings can override user-level defaults. This ordering is explicit in `initialize(projectPath)` and represents a deliberate design decision to let project-scoped configuration win in conflicts — a common convention for tools that need per-repository customization layered on top of personal defaults.

The loader is fail-soft by design: `loadConfig()` checks `fsSync.existsSync(configPath)` and silently no-ops when a config file is absent, rather than throwing. Similarly, unknown event names encountered in a hooks.json file are not treated as fatal errors — they are logged via `logger.warn(\`Unknown hook event in config: ${event}\`)` and skipped. This reflects a robustness-over-strictness philosophy: malformed or forward-incompatible config files degrade gracefully instead of blocking hook manager initialization entirely.

## Implementation Details

The core mechanics revolve around two touchpoints: file existence checking and settings application. `loadConfig()` applies `config.settings` (fields like `enableLogging`, `stopOnError`, `timeout`) directly onto `this.config`, meaning either the user or project config file can globally adjust HookManager's behavior, not just register hooks. Because project config loads after user config, these settings fields also follow the tiered-override rule — a project's `timeout` or `stopOnError` value will supersede the user's.

Event validation happens per-entry within the loaded hooks.json structure: each event name is checked against a known set (implicitly the `HookEvent` enum used elsewhere in the system, e.g., by HandlerRegistry in hooks-api.js), with unrecognized entries logged and discarded rather than propagated into the manager's hook buckets.

## Integration Points

TieredConfigLoader's output feeds directly into HookManager's runtime state — the settings and hook definitions it loads populate `this.config` and presumably the registries that dispatch hook execution. It shares its parent (HookManager) with siblings HandlerRegistry and ClaudeBridge. HandlerRegistry (implemented as `HooksManager` in lib/agent-api/hooks-api.js) is the per-event bucketed registry that hooks loaded via TieredConfigLoader would ultimately be registered into, using the same `HookEvent` enum vocabulary that TieredConfigLoader validates event names against.

ClaudeBridge (lib/agent-api/hooks/claude-bridge.js) is the actual runtime consumer of HookManager, invoking `getHookManager()` and conditionally calling `manager.initialize(projectPath)` if not already initialized — this is the entry point through which TieredConfigLoader's two-phase config load actually executes in practice. Notably, because claude-bridge.js runs as a freshly spawned subprocess per PreToolUse/PostToolUse event, TieredConfigLoader's load-and-merge sequence runs from scratch on every single hook invocation rather than persisting across events.

## Usage Guidelines

Developers modifying hooks.json files should understand that project-level configuration always wins over user-level configuration for both hook settings (`enableLogging`, `stopOnError`, `timeout`) and any overlapping hook definitions, given the load order in `initialize(projectPath)`. Because absent config files are silently skipped and unknown event names are merely warned about, misconfigurations (typos in event names, missing files) will not surface as hard errors — reliance on log output (`logger.warn`) is necessary to catch these issues during development. Given ClaudeBridge's per-process re-invocation model, there is no benefit to assuming state persists between loads; each subprocess reloads and re-merges both tiers of config independently, so config loading should remain cheap and side-effect-free to avoid performance concerns at the per-event granularity implied by claude-bridge.js's shebang-driven execution model.


## Hierarchy Context

### Parent
- [HookManager](./HookManager.md) -- [CGR] UnifiedHookManager (class) in hook-manager.js

### Siblings
- [HandlerRegistry](./HandlerRegistry.md) -- [LLM] The actual 'HandlerRegistry' in this codebase lives inside `HooksManager` in lib/agent-api/hooks-api.js: the constructor initializes `this.hooks = new Map()` and pre-seeds an empty array for every value of the `HookEvent` enum (`for (const event of Object.values(HookEvent)) { this.hooks.set(event, []) }`). This is a classic per-event bucketed registry — `registerHook(event, handler, options)` validates the event against `HookEvent`, wraps the handler in a `{ id, event, handler, priority, source }` record, pushes it into the bucket for that event, and then re-sorts the whole bucket with `eventHooks.sort((a, b) => a.priority - b.priority)` on every single registration. Re-sorting the full array on each insert (rather than inserting at the correct position) is O(n log n) per registration instead of O(log n) or O(n), which is irrelevant at hook-system scale (dozens of handlers) but signals this registry was written for correctness/readability, not throughput.
- [ClaudeBridge](./ClaudeBridge.md) -- [LLM+CGR] The code graph confirms `UnifiedHookManager`, `getHookManager`, and `resetHookManager` as the exported surface of hook-manager.js, and lib/agent-api/hooks/claude-bridge.js:main() is the sole observed caller pattern for the singleton getter: `const { getHookManager } = await import('./hook-manager.js'); const manager = getHookManager();` followed by a conditional `if (!manager.initialized) await manager.initialize(projectPath)`. Because claude-bridge.js is a `#!/usr/bin/env node` script re-spawned by Claude Code as a fresh subprocess on every single PreToolUse/PostToolUse event (per the shebang and the `~/.claude/settings.json` usage comment at the top of the file), the singleton pattern buys nothing at runtime — `getHookManager()` will always construct a brand-new `UnifiedHookManager` in a brand-new process, execute exactly once, and be garbage-collected on `process.exit(0)`. `resetHookManager` (visible in the code graph but never imported by claude-bridge.js) is therefore dead weight for the Claude Code path and exists purely to let test suites tear down shared module state between test cases — a strong signal that whoever designed hook-manager.js anticipated a persistent-process consumer that claude-bridge.js's per-event subprocess model never delivers.


---

*Generated from 4 observations*
