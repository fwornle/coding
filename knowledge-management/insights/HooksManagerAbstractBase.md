# HooksManagerAbstractBase

**Type:** Detail

# HooksManagerAbstractBase: Technical Insight Document

## What It Is

`HooksManagerAbstractBase` is realized concretely as the `HooksManager` class in `lib/agent-api/hooks-api.js` (roughly lines 110–240). It is a JSDoc-typed, JavaScript-native abstract base class that centralizes a unified hook registry — a `Map<string, RegisteredHook[]>` — and defines the shared algorithm for registering, unregistering, and triggering hooks across agent types. As the parent of `HealthPromptHook` in the entity hierarchy, it provides the generic scaffolding that concrete agent-specific subclasses (for Claude, Copilot, etc.) build upon; those subclasses are never directly observed in this codebase excerpt but are required to supply `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()`.

## Architecture and Design

The dominant pattern is Template Method: `HooksManager` defines the shape of the registration/trigger algorithm while delegating agent-specific decisions to abstract hooks. `translateEvent()` (~line 168) exemplifies this precisely — it owns the lookup logic against `EVENT_MAPPINGS`, but the table row is selected by `this.getAgentType()`, a method the base class never implements. This creates a hard dependency from a "complete" base-class method onto an "abstract" one, a classic Template Method seam.

Since JavaScript lacks a language-level `abstract class` keyword, abstractness is enforced only at runtime via a `new.target === HooksManager` guard in the constructor (lines 110–115). This is a deliberate but partial substitute: `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()` throw `must be implemented by subclass` in their base bodies (~140–160), but a subclass that never invokes them would never trigger a failure — abstraction here is a convention backed by a runtime throw, not a compile-time guarantee.

Sibling entity `HookEventMapping` documents a related but structurally distinct concept in `claude-bridge.js`: `EVENT_MAP` normalizes raw Claude event names into unified lowercase-hyphenated keys, falling back to `.toLowerCase()` silently on unrecognized names. This is architecturally parallel to `HooksManager`'s own `EVENT_MAPPINGS` strategy/lookup-table pattern but is a second, uncoordinated implementation of the same translation concept — a noted sync risk between the two layers.

Sibling `RegisteredHookLifecycle` clarifies that `RegisteredHook` is purely a JSDoc `@typedef`, with no runtime constructor; its lifecycle is entirely Map-array based, born in `registerHook()`, read in `triggerHook()`/`getRegisteredHooks()`, and destroyed in `unregisterHook()`. Notably there is no update path — hooks are immutable once registered.

## Implementation Details

The constructor eagerly seeds `this.hooks` with an empty array for every value in `Object.values(HookEvent)` (lines 118–124), guaranteeing `this.hooks.get(event)` is never undefined for any valid event — a "total initialization" design that trades a small upfront cost for simplifying all downstream lookup logic.

`registerHook()` validates `event` membership and that `handler` is a function, but does not validate `options.priority` or `options.id` shape. A non-numeric priority silently produces `NaN` in the `a.priority - b.priority` sort comparator, which V8 treats as "equal," leaving hook order undefined for malformed input — a partially-validated contract that catches the two most obvious misuses but not all.

`unregisterHook()` (~line 210) performs a linear `findIndex` scan per event bucket — O(events × hooks-per-event) — while `registerHook()` re-sorts the entire bucket by priority on every insertion (O(n log n) via re-sort-on-insert rather than binary insertion). Neither path is optimized for scale, reflecting a registry designed for a handful of hooks per event rather than a plugin marketplace.

`triggerHook()` (~line 230) builds `fullContext` by spreading caller-supplied `context` over base fields (`event`, `agentEvent`, `agentType`, `sessionId`, `timestamp`), meaning callers can silently override these structural fields. Handler execution is fail-permissive: a per-handler try/catch logs `Hook error (${hook.id}): ${error.message}` and continues the loop rather than aborting the chain, mirroring the fail-open contract seen in `claude-bridge.js`'s catch-all `{decision: 'allow', ...}` with `process.exit(0)`.

`getRegisteredHooks()` flattens all buckets via `allHooks.push(...hooks)`, discarding the Map's per-event grouping; no `getHooksForEvent(event)` accessor is exposed publicly, even though `triggerHook()` performs the equivalent internal lookup.

## Integration Points

`HooksManager` sits below `HealthPromptHook` in the hierarchy and above concrete, unseen subclasses that implement `loadNativeHooks()`/`saveNativeHooks()` against agent-specific storage (e.g., `~/.claude/settings.json` vs `.github/hooks/hooks.json`). It shares its unified-registry philosophy with `HookEventMapping`'s `EVENT_MAP` and interacts closely with `claude-bridge.js`'s `transformContext()`, which spreads the raw Claude payload unfiltered into `metadata` — extending the same unguarded-override concern already present in `triggerHook`'s context spread into a second, uncoordinated site in the pipeline.

## Usage Guidelines

Subclasses must implement `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()`; failing to call them anywhere bypasses the abstractness enforcement entirely, so code review discipline substitutes for compiler guarantees. Callers of `registerHook()` should always pass numeric priorities, since malformed values silently corrupt sort order rather than throwing. Because there is no update path for a `RegisteredHook`, changing priority or handler requires unregister-then-reregister, which changes object identity and re-triggers sorting. Given the unfiltered context-spread in `triggerHook()` and `transformContext()`, callers and handler authors should treat `agentType`, `agentEvent`, `sessionId`, and `timestamp` as potentially overridden by untrusted input, and any future EVENT_MAPPINGS/EVENT_MAP changes should be synchronized manually across `hooks-api.js` and `claude-bridge.js` to avoid translation drift.


## Hierarchy Context

### Parent
- [HealthPromptHook](./HealthPromptHook.md) -- [LLM] HooksManager in lib/agent-api/hooks-api.js is an abstract base class (constructor throws if `new.target === HooksManager`) that centralizes the unified hook registry as a `Map<string, RegisteredHook[]>`, seeded in the constructor by iterating `Object.values(HookEvent)` so every event key exists even before any handler is registered. This mirrors the parent observation about UnifiedHookManager's Map<event, HookHandler[]> registry, but hooks-api.js is the older/more generic abstraction layer: it defines `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()` as abstract methods subclasses must implement, meaning the actual Claude/Copilot-specific behavior (reading ~/.claude/settings.json vs .github/hooks/hooks.json) lives outside this file entirely, in whatever concrete class extends HooksManager.

### Siblings
- [HookEventMapping](./HookEventMapping.md) -- [LLM] EVENT_MAP in claude-bridge.js (lib/agent-api/hooks/claude-bridge.js) is the sole place where a raw Claude native event string ('PreToolUse', 'PostToolUse', 'Startup', 'Shutdown', 'PrePrompt', 'PostPrompt', 'Error') is normalized to the unified lowercase-hyphenated form ('pre-tool', 'post-tool', etc.) via transformContext()'s `EVENT_MAP[nativeEvent] || nativeEvent.toLowerCase()` fallback. That fallback means an unrecognized native event silently degrades to `.toLowerCase()` rather than throwing, so a typo'd or future Claude event name (e.g. 'SessionEnd') would produce a unified event key that likely has no registered hooks in hooks-api.js's Map, rather than surfacing as an explicit translation error.
- [RegisteredHookLifecycle](./RegisteredHookLifecycle.md) -- [LLM] The `RegisteredHook` shape is only a JSDoc `@typedef` in lib/agent-api/hooks-api.js (properties: `id`, `event`, `handler`, `priority`, `source`) — there is no runtime class or constructor for it. `registerHook()` builds the literal object `{ id, event, handler, priority, source }` inline and pushes it into the per-event array retrieved from `this.hooks.get(event)`. This means the 'lifecycle' of a RegisteredHook is entirely a Map-array lifecycle: born via `registerHook()`'s `eventHooks.push(hook)` + re-sort, read via `triggerHook()`'s `for (const hook of eventHooks)` iteration or `getRegisteredHooks()`'s flatten-and-concat over `this.hooks.values()`, and destroyed via `unregisterHook()`'s `hooks.findIndex(h => h.id === hookId)` + `splice`. There is no update path — a registered hook's priority or handler cannot be changed in place; the only way to change either is unregister-then-reregister, which also changes the object identity and re-triggers the sort.


---

*Generated from 9 observations*
