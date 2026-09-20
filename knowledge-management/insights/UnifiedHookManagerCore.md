# UnifiedHookManagerCore

**Type:** Detail

initialize(projectPath) loads user-level config first then project-level config from '.coding/hooks.json', letting project config override user settings like enableLogging/stopOnError/timeout

# UnifiedHookManagerCore: Technical Insight Document

## What It Is

UnifiedHookManagerCore is the internal engine backing `UnifiedHookManager` (defined as a class in `hook-manager.js`), which contains it as a core dependency. Its responsibilities center on configuration loading, handler registration, and lifecycle management for hook events. The constructor establishes a default `userConfigPath` of `~/.coding-tools/hooks.json` and pre-populates a `Map` with an empty handler array for every value in `HookEvent`, establishing a predictable baseline structure before any configuration or registration occurs.

## Architecture and Design

The core exhibits a layered configuration pattern: `initialize(projectPath)` loads user-level settings first, then merges in project-level configuration from `.coding/hooks.json`, allowing project-specific values (e.g., `enableLogging`, `stopOnError`, `timeout`) to override user defaults. This is a classic cascading-override configuration strategy, prioritizing local project intent over global user preferences.

Validation is handled defensively rather than strictly — `loadConfig()` checks event names against `Object.values(HookEvent)` and logs warnings for unrecognized events instead of throwing. This mirrors a broader tolerance-over-rigidity philosophy seen elsewhere in the hook system, contrasting with the stricter contract-enforcement pattern used by sibling `HooksApiAbstraction`, whose abstract `HooksManager` class throws hard errors via `new.target` checks when contracts are violated. UnifiedHookManagerCore instead favors graceful degradation, consistent with resilience-oriented design.

Handler storage uses a `Map` keyed by event type, with each value being a priority-sorted array — a registry/observer-like pattern where handlers are the "observers" of specific hook events.

## Implementation Details

Registration logic in `registerHandler()` deduplicates by handler `id`: if a handler with the same id already exists, it's replaced rather than duplicated. After each registration, the array is re-sorted by ascending priority, ensuring deterministic execution order without requiring callers to manage ordering manually. This sort-on-write approach trades a small per-registration cost for simplicity at handler-invocation time (no need to sort before execution).

`unregisterHandler()` performs a linear search across all event arrays in the Map, removing the first matching entry by id, and returns a boolean to indicate success/failure — a simple, predictable API contract for callers needing confirmation of removal.

Configuration loading follows a two-phase read: user config path resolution, then project config resolution, with explicit override semantics for specific fields rather than a blind object merge, suggesting deliberate control over which settings are project-overridable.

## Integration Points

As a component owned by `UnifiedHookManager`, UnifiedHookManagerCore likely supplies the underlying data structures and logic that the manager exposes through a higher-level API. It sits alongside `ClaudeBridge` and `HooksApiAbstraction` as sibling components in the hook subsystem. While ClaudeBridge deals with stdin/stdout process bridging for Claude's native hook invocation, and HooksApiAbstraction defines the abstract contract subclasses must implement (`getAgentType()`, `loadNativeHooks()`, `saveNativeHooks()`), UnifiedHookManagerCore's role is orthogonal: managing configuration and in-memory handler registries rather than process I/O or subclassing contracts. It's reasonable to infer that handlers registered here could ultimately be invoked in response to events surfaced through the ClaudeBridge/HooksApiAbstraction layers, though no explicit call chain is confirmed in the observations.

## Usage Guidelines

Developers registering handlers should assign unique, stable ids, since `registerHandler()` uses id-based deduplication — reusing an id intentionally replaces prior registrations, which can be leveraged for idempotent re-registration but risks silent overwrites if ids collide unintentionally. Priority values should be chosen carefully since they directly determine execution order via the ascending sort applied on every registration.

When defining project-level `.coding/hooks.json` configuration, be aware that only certain settings (`enableLogging`, `stopOnError`, `timeout`) are documented as overriding user-level config — assume an explicit allow-list rather than a full merge. Unknown event names in configuration will not cause failures but will generate warnings, so validate event names against `HookEvent` during development to avoid silently inert configuration entries. Given the contrast with HooksApiAbstraction's strict runtime contract enforcement, contributors should not assume the same fail-fast behavior here — UnifiedHookManagerCore is intentionally more permissive.


## Hierarchy Context

### Parent
- [UnifiedHookManager](./UnifiedHookManager.md) -- [CGR] UnifiedHookManager (class) in hook-manager.js

### Siblings
- [ClaudeBridge](./ClaudeBridge.md) -- [LLM] claude-bridge.js's readStdin() (lib/agent-api/hooks/claude-bridge.js:47-73) implements a race between the stdin 'end' event and a bare setTimeout(1000) fallback that resolves to '{}' only if no data has been received at all — note the guard is `if (!data)`, not a check against partial/incomplete data. If Claude's native hook writes a partial JSON payload and then stalls before closing stdin, the timeout won't fire (data is truthy) and the promise never resolves, leaving the bridge process hanging indefinitely rather than degrading to the empty-context fallback. This is a narrower safety net than the surrounding documentation and observations suggest.
- [HooksApiAbstraction](./HooksApiAbstraction.md) -- [LLM+CGR] hooks-api.js's abstract HooksManager class enforces its Template Method contract via `if (new.target === HooksManager) throw new Error(...)` in the constructor, then delegates getAgentType(), loadNativeHooks(), and saveNativeHooks() to subclasses via stub methods that throw 'must be implemented by subclass'. This is a textbook abstract base class pattern in vanilla JS (no TypeScript interfaces), relying entirely on runtime errors rather than compile-time checks to enforce the contract — a trade-off that keeps the module dependency-free but pushes contract violations to first-invocation rather than load time.


---

*Generated from 5 observations*
