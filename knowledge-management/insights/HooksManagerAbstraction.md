# HooksManagerAbstraction

**Type:** Detail

# HooksManagerAbstraction — Technical Insight Document

## What It Is

HooksManagerAbstraction refers to the abstract base class `HooksManager` defined in `lib/agent-api/hooks-api.js`, along with its associated hook registration, triggering, and event-mapping machinery. It is designed as a Template Method-style abstraction: the constructor explicitly forbids direct instantiation (`if (new.target === HooksManager) { throw new Error(...) }`), and it declares `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()` as methods that throw "must be implemented by subclass" errors, signaling an intended extension contract for agent-specific hook managers.

Critically, the observations reveal this abstraction is **not currently realized** — no concrete subclass of `HooksManager` exists anywhere in the code graph. Its parent component, HookConfigLoader (in `hook-config.js`), contains this abstraction structurally, but the actual runtime hook dispatch used by sibling ClaudeBridgeScript (`lib/agent-api/hooks/claude-bridge.js`) bypasses `hooks-api.js` entirely, instead importing `getHookManager`/`UnifiedHookManager` from `./hook-manager.js`.

## Architecture and Design

The design exhibits several recognizable patterns layered together: an Abstract Base Class / Template Method pattern (`HooksManager`), an Adapter/Bridge pattern in ClaudeBridgeScript that translates Claude-native stdin payloads into a unified internal context shape, a Map-based Event Registry (`Map<HookEvent, HookHandler[]>`) re-sorted by priority on mutation, and fail-open error isolation implemented independently at two layers.

The most significant architectural finding is **structural drift between two evolutionary stages of the same subsystem**. `hooks-api.js` defines `EVENT_MAPPINGS.claude`, which explicitly nulls out STARTUP and SHUTDOWN ("Handled by launcher script" / "EXIT trap") as well as PRE_PROMPT, POST_PROMPT, and ERROR ("New via hook"). Meanwhile, sibling ClaudeBridgeScript maintains its own independent `EVENT_MAP`, which treats `Startup`→`startup`, `Shutdown`→`shutdown`, and `PrePrompt`/`PostPrompt`/`Error` as live, pass-through events. This is a direct contradiction, not mere duplication — the two tables encode incompatible semantics for identical events. Combined with sibling HookMigrationTool's observation that a *third* implicit vocabulary likely exists inside `hook-manager.js`, this suggests the codebase has at least three uncoordinated sources of truth for the same Claude event taxonomy.

## Implementation Details

`registerHook()` validates the event against `Object.values(HookEvent)`, checks `typeof handler !== 'function'`, defaults `priority` to 100, and then unconditionally re-sorts the entire `eventHooks` array on every call (`eventHooks.sort((a, b) => a.priority - b.priority)`). This produces O(N² log N) total cost across N startup-time registrations — an inefficiency judged inconsequential given the low-frequency, start-of-session registration pattern, consistent with a similar trade-off noted in HookConfigLoader's downstream consumer.

`triggerHook()` implements per-hook fault isolation: each `await hook.handler(fullContext)` inside the dispatch loop is individually wrapped in try/catch, with failures captured as `Hook error (${hook.id}): ${error.message}` messages rather than aborting sibling hook execution — an explicit "continue with other hooks" design. `getRegisteredHooks()` is a flat, unfiltered introspection method (`allHooks.push(...hooks)`) that appears intended for debugging/tooling rather than runtime dispatch, which instead relies on direct `this.hooks.get(event)` lookups.

## Integration Points

The intended integration point — subclasses implementing `getAgentType()`, `loadNativeHooks()`, `saveNativeHooks()` — is unused. Instead, actual integration flows through ClaudeBridgeScript's `main()`, which dynamically imports `./hook-manager.js` (avoiding a static load-time dependency), conditionally calls `manager.initialize(projectPath)` only if `!manager.initialized`, and dispatches via `manager.executeHooks(...)`. This couples claude-bridge.js tightly to hook-manager.js's concrete exported shape rather than to the abstract `HooksManager` interface — the opposite of what the abstraction was presumably designed to enable.

`transformResponse()` further reveals a lossy integration seam: hooks-api.js's `triggerHook()` can produce multiple per-hook messages (including error attributions), but these are flattened via `messages?.join('\n')` into Claude's single-string `{decision, message}` protocol, losing per-hook provenance before reaching the UI.

## Usage Guidelines

Developers should treat `hooks-api.js`'s `HooksManager` as either legacy or aspirational rather than load-bearing — any new agent hook integration should investigate whether `hook-manager.js`'s `UnifiedHookManager` is the actual intended extension point before subclassing `HooksManager`. Given the confirmed divergence between `EVENT_MAPPINGS.claude` and ClaudeBridgeScript's `EVENT_MAP` (especially for STARTUP/SHUTDOWN and PRE_PROMPT/POST_PROMPT/ERROR), any consolidation effort must reconcile all known event tables — hooks-api.js, claude-bridge.js, and hook-manager.js's internal mapping — into one canonical source, per the repo's own stated conventions against parallel-version duplication. Error handling should remain fail-open at both the per-hook (`triggerHook`) and whole-process (`main()`'s catch returning `{decision:'allow', ...}` with `process.exit(0)`) levels, but maintainers should recognize these are two independent, non-unified mechanisms rather than a single coordinated strategy.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- The abstract HooksManager class in lib/agent-api/hooks-api.js enforces its own abstractness via `if (new.target === HooksManager) { throw new Error(...) }` in the constructor, and declares getAgentType(), loadNativeHooks(), and saveNativeHooks() as methods that throw 'must be implemented by subclass' errors. This is a textbook Template Method / abstract base class pattern, but no concrete subclass of HooksManager appears anywhere in the provided code graph or code files — hook-manager.js's UnifiedHookManager (referenced in claude-bridge.js's `await import('./hook-manager.js')`) is never shown extending HooksManager, and claude-bridge.js imports `getHookManager` from './hook-manager.js', not hooks-api.js. This strongly suggests hooks-api.js is either a superseded design or an abstraction layer that has not yet been wired into the actual execution path used by claude-bridge.js.

**Other:**
- registerHook() in hooks-api.js (lib/agent-api/hooks-api.js) performs three validation steps before registration — checking `Object.values(HookEvent).includes(event)`, checking `typeof handler !== 'function'`, and defaulting priority to 100 — then unconditionally re-sorts the full eventHooks array with `eventHooks.sort((a, b) => a.priority - b.priority)` on every single call. For a session with N hooks registered at startup, this is O(N log N) work repeated N times (O(N² log N) total), which is a real but likely inconsequential inefficiency given hook registration is described in the parent context as 'start-of-session, low-frequency' — the same trade-off documented for HookConfigLoader's downstream consumer UnifiedHookManager.
- triggerHook() in hooks-api.js is architected with per-hook error isolation: inside the `for (const hook of eventHooks)` loop, each `await hook.handler(fullContext)` call is wrapped in its own try/catch, and a thrown error is captured into the messages array (`Hook error (${hook.id}): ${error.message}`) with an explicit comment 'Continue with other hooks even if one fails' rather than aborting the loop. This means a single malformed or crashing hook handler cannot prevent sibling hooks for the same event from executing — a finer-grained fail-open guarantee than the bridge-level catch-all described in claude-bridge.js's main(), and one that operates purely in-process rather than at the subprocess boundary.
- claude-bridge.js's main() constructs its unified context and dispatch pipeline in a specific sequence: read stdin via readStdin() (with its 1000ms fallback timeout), call transformContext() to map Claude-native fields (tool_name, tool_input, tool_output, cwd, project_path) into the unified shape, dynamically `await import('./hook-manager.js')` to avoid a static dependency at module load time, conditionally call `manager.initialize(projectPath)` only `if (!manager.initialized)`, then call `manager.executeHooks(unifiedContext.event, unifiedContext, 'claude')`. The dynamic import is notable: it means hook-manager.js (and whatever it pulls in, e.g. HookConfigLoader) is loaded lazily only when a hook actually fires, not at claude-bridge.js's module top level — reducing startup cost for the common case where readStdin() might resolve quickly but no hooks are configured.


## Hierarchy Context

### Parent
- [HookConfigLoader](./HookConfigLoader.md) -- [CGR] HookConfigLoader (class) in hook-config.js

### Siblings
- [ClaudeBridgeScript](./ClaudeBridgeScript.md) -- [LLM+CGR] claude-bridge.js's EVENT_MAP is a second, independent translation table distinct from hooks-api.js's EVENT_MAPPINGS.claude — EVENT_MAP handles 'PrePrompt'/'PostPrompt'/'Error' as pass-through unified events (`'PrePrompt': 'pre-prompt'`) while EVENT_MAPPINGS.claude explicitly nulls out PRE_PROMPT, POST_PROMPT, and ERROR as 'New via hook'. This means claude-bridge.js's own mapping has already evolved past hooks-api.js's EVENT_MAPPINGS for the claude agent type, reinforcing the parent-context suspicion that hook-manager.js/claude-bridge.js and hooks-api.js are two versions of the same subsystem at different points of drift rather than cleanly separated layers.
- [HookMigrationTool](./HookMigrationTool.md) -- [LLM+CGR] claude-bridge.js's EVENT_MAP (mapping 'PreToolUse'->'pre-tool', 'PostToolUse'->'post-tool', etc.) is a second, independent translation table from the EVENT_MAPPINGS structure in lib/agent-api/hooks-api.js — the bridge maintains its own hardcoded Claude-native-to-unified mapping rather than importing translateEvent()/EVENT_MAPPINGS from hooks-api.js, and rather than importing from hook-manager.js's UnifiedHookManager either. This means there are now three places (hooks-api.js's EVENT_MAPPINGS, claude-bridge.js's EVENT_MAP, and whatever hook-manager.js uses internally) that encode the claude event-name vocabulary, which is exactly the kind of 'parallel versions' duplication the repo's own conventions elsewhere explicitly warn against.


---

*Generated from 10 observations*
