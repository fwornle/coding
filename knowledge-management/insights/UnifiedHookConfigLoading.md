# UnifiedHookConfigLoading

**Type:** Detail

# UnifiedHookConfigLoading — Technical Insight Document

## What It Is

UnifiedHookConfigLoading describes the data-contract boundary and downstream consumption pattern that connects its parent component, HookConfigLoader (in hook-config.js), to the runtime hook infrastructure implemented in `lib/agent-api/hooks-api.js` and `lib/agent-api/hooks/claude-bridge.js`. Rather than being a single class, it is best understood as the *seam* through which loosely-validated configuration produced by HookConfigLoader flows into the strictly-validated runtime registry maintained by `HooksManager`. This seam is a plain-data contract: `HooksManager`'s constructor accepts a bare `HookConfig` object (`{userConfigPath, projectConfigPath, bridgeScriptPath, enableLogging}`) with no import of or dependency on `HookConfigLoader` as a class. The unification lies in how disparate sources — user config, project config, and native agent event names — are merged and translated into the single `HookEvent` space that `HooksManager` and its subclasses operate on.

## Architecture and Design

The architecture layers several well-known patterns on top of this config-to-runtime seam. `HooksManager` is a Template Method / abstract base class: its constructor throws if instantiated directly (`if (new.target === HooksManager) throw ...`), and `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()` are left for concrete per-agent subclasses to implement, while `registerHook()`, `triggerHook()`, and `translateEvent()` are concrete, shared logic. `claude-bridge.js` acts as a Bridge/Adapter, translating Claude Code's native stdin/JSON protocol into the unified `HookContext` shape, and it obtains its manager instance via `getHookManager()` from a sibling `hook-manager.js` module rather than instantiating `HooksManager` directly — implying a factory/singleton layer mediates instantiation.

Event translation is implemented as Strategy-via-lookup-table rather than polymorphic dispatch, appearing independently in two places: `EVENT_MAPPINGS` in hooks-api.js and `EVENT_MAP` in claude-bridge.js. This duplication is directly related to the sibling entity EventTranslationMapping, which documents `EVENT_MAPPINGS`'s per-agent tables (including `null` entries for unsupported claude events like `PRE_PROMPT`/`POST_PROMPT`). A second sibling, MigrationTool, adds yet a third independently-maintained table, `CLAUDE_EVENT_MAP`, used by `migrateClaudeHooks()` to convert native Claude settings into the migrated hook format — reinforcing that event-name translation is a recurring, not-yet-unified concern across the codebase.

Fail-open error handling is layered throughout: `claude-bridge.js`'s `main()` catches all errors and responds with `{decision: 'allow', ...}` plus `process.exit(0)`, and `triggerHook()` independently wraps each handler invocation in its own try/catch, logging and continuing rather than aborting the loop.

## Implementation Details

`HookConfigLoader` (parent) is described as lenient/warning-only at config-load time, per parent-entity observations and the config precedence pattern (`mergeConfigs()` layering project config over user config). This lenience is deliberately asymmetric with `HooksManager.registerHook()`, which throws on invalid event names (`if (!Object.values(HookEvent).includes(event)) throw ...`) and non-function handlers, and defaults missing priority to 100 via `options.priority ?? 100`. Because `eventHooks.sort((a, b) => a.priority - b.priority)` runs on every registration, a non-numeric priority sourced from a hand-edited hooks.json — if passed through unchecked by HookConfigLoader — can silently corrupt ordering, since JS's sort does not throw on NaN comparators.

`translateEvent()` throws `No event mapping for agent type: ${agentType}` on unmapped agent types, while claude-bridge.js's `transformContext()` uses `EVENT_MAP[nativeEvent] || nativeEvent.toLowerCase()`, silently passing through unrecognized events. `readStdin()` in claude-bridge.js uses a manual Promise around stdin events with a 1000ms `setTimeout` fallback that only fires when zero bytes have arrived — a narrower safety net than the file's overall fail-open framing suggests, since a stalled-but-nonzero stream will hang indefinitely.

## Integration Points

The primary integration point is the implicit shape agreement between HookConfigLoader's merged config output and `HooksManager`'s constructor input — no type-checking mechanism enforces this, so a shape change (e.g., `agents` array-to-object) would only surface as a runtime failure. `claude-bridge.js` integrates via `getHookManager()` from hook-manager.js, and its `EVENT_MAP` duplicates responsibility with `EVENT_MAPPINGS` in hooks-api.js. `HooksManager.hooks` (a `Map<string, RegisteredHook[]>`) functions as an Observer/registry, populated by `registerHook()` and drained by `triggerHook()`. Sibling entities MigrationTool and EventTranslationMapping both intersect with this space by maintaining their own event-mapping tables (`CLAUDE_EVENT_MAP` and `EVENT_MAPPINGS` respectively), which are not currently unified with `EVENT_MAP`.

## Usage Guidelines

Developers modifying HookConfigLoader's merge/validation logic must manually verify compatibility with `HooksManager`'s constructor contract, since no automated check exists at that boundary. Priority values in hooks.json should be validated as numeric before reaching `registerHook()` to avoid NaN-driven ordering corruption. When adding new native agent event names, update both `EVENT_MAPPINGS` (hooks-api.js) and `EVENT_MAP` (claude-bridge.js) — and consider whether `CLAUDE_EVENT_MAP` (MigrationTool) also needs updating — to avoid divergent throw-vs-silent-passthrough behavior. Because fail-open logic exists at three uncorrelated log sites (HookConfigLoader warnings, triggerHook per-handler errors, claude-bridge.js's top-level catch), debugging a "hook didn't fire" issue requires checking all three; adding a shared correlation id would materially improve diagnosability.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- The parent-entity observations place HookConfigLoader as a standalone class in hook-config.js, and the actual hooks-api.js file confirms the architectural split described: HooksManager (lib/agent-api/hooks-api.js) is an abstract base class whose constructor accepts a plain HookConfig object (`{userConfigPath, projectConfigPath, bridgeScriptPath, enableLogging}`) rather than an instance of HookConfigLoader. This is a genuine data-contract boundary — HooksManager.constructor() never imports or calls into hook-config.js in the code shown, so any change to HookConfigLoader's merged output shape (e.g. renaming a field, changing 'agents' from an array to an object) would not be caught by type checking at this seam, only by a runtime failure inside whatever code eventually wires the loader's output into `new HooksManager(config)`.
- claude-bridge.js's main() function embodies the fail-open philosophy attributed to HookConfigLoader.validateConfig() in the parent-entity observations, and the code confirms it precisely: the catch block constructs `{ decision: 'allow', message: 'Hook bridge error: ...' }` and calls `process.exit(0)`, with an explicit comment '// On error, allow the operation to continue (fail-open)'. Critically, this fail-open behavior is unconditional — it fires whether the underlying error originated from a malformed config the loader let through, a broken bridgeScriptPath, or an exception inside manager.executeHooks() itself, so an operator cannot distinguish 'no hooks configured' from 'hooks configured but broken' by observing Claude Code's behavior; both look identical (silent allow).

**Other:**
- HooksManager.registerHook() in hooks-api.js (lines implementing `if (!Object.values(HookEvent).includes(event)) throw ...` and `if (typeof handler !== 'function') throw ...`) is strict-by-design, which validates the parent-entity's claim that registration enforces stronger invariants than HookConfigLoader's lenient config validation. The `priority = options.priority ?? 100` default combined with `eventHooks.sort((a, b) => a.priority - b.priority)` on every call means a NaN or non-numeric priority sourced from a hand-edited hooks.json (if HookConfigLoader passes it through unchecked, per the parent-entity's description of its validation gaps) would silently corrupt the Map<string, RegisteredHook[]> ordering used later by triggerHook(), since Array.prototype.sort with NaN comparators does not throw — it just produces an unspecified order.


## Hierarchy Context

### Parent
- [HookConfigLoader](./HookConfigLoader.md) -- [CGR] HookConfigLoader (class) in hook-config.js

### Siblings
- [MigrationTool](./MigrationTool.md) -- migrateClaudeHooks() reads ~/.claude/settings.json and maps native events via CLAUDE_EVENT_MAP (e.g. 'PreToolUse' -> 'pre-tool') into a migratedHooks object tagged with _migrated metadata.
- [EventTranslationMapping](./EventTranslationMapping.md) -- hooks-api.js's EVENT_MAPPINGS defines per-agent translation tables for 'claude' and 'copilot', with several unified events (e.g. PRE_PROMPT, POST_PROMPT) mapped to null for claude, signaling unsupported events.


---

*Generated from 10 observations*
