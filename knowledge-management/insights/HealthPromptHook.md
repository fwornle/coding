# HealthPromptHook

**Type:** SubComponent

[Architecture Notes] hooks-api.js's HooksManager is an abstract class enforced at runtime via `new.target` checks rather than TypeScript's compile-time abstract keyword, since the file is plain JS with JSDoc typing; Two parallel hook-registry implementations exist in this codebase area (hooks-api.js's HooksManager.hooks and the parent-referenced hook-manager.js's UnifiedHookManager) with structurally similar but not identical registration/sort/trigger logic — worth checking for whether one supersedes the other or both are actively used by different code paths; Tight coupling between claude-bridge.js and hook-manager.js: the bridge dynamically imports `./hook-manager.js` inside main() and calls `getHookManager()` + `manager.initialize()` + `manager.executeHooks()`, meaning claude-bridge.js's own EVENT_MAP is only the first of two translation layers before a handler actually runs; No sanitization boundary inside the bridge layer itself — transformContext() passes raw tool_input/context through unfiltered, pushing all privacy/security filtering responsibility onto downstream consumers such as ViolationCaptureService.sanitizeParams(), which is an implicit cross-file contract not enforced by types or runtime checks in the files shown

# HealthPromptHook — Technical Insight Document

## What It Is

HealthPromptHook is the SubComponent within ConstraintSystem responsible for defining and bridging the unified hook abstraction layer to agent-native hook systems (Claude Code, Copilot). Its implementation is anchored in `lib/agent-api/hooks-api.js`, which defines the abstract `HooksManager` base class, and `lib/agent-api/hooks/claude-bridge.js`, which acts as the concrete process-boundary adapter for Claude's native hook payloads. Its three children — `HooksManagerAbstractBase`, `HookEventMapping`, and `RegisteredHookLifecycle` — decompose the responsibilities of this layer: enforcing the abstract contract, translating event names, and managing the registration/trigger/removal lifecycle of individual hooks.

As the parent ConstraintSystem's HookConfigLoader observation notes, configuration cascades from defaults → user → project settings before ever reaching this layer; HealthPromptHook is the runtime machinery that actually registers, sorts, and fires hooks once that configuration is resolved.

![HealthPromptHook — Architecture](images/health-prompt-hook-architecture.png)

## Architecture and Design

The dominant pattern is Template Method: `HooksManager` in hooks-api.js defines the registration/trigger algorithm once (`registerHook()`, `triggerHook()`, `unregisterHook()`) while deferring agent-specific behaviors — `getAgentType()`, `loadNativeHooks()`, `saveNativeHooks()` — to subclasses. Abstractness is enforced only at runtime via a `new.target === HooksManager` check in the constructor, since the codebase is plain JS with JSDoc typing rather than TypeScript — a design decision documented in `HooksManagerAbstractBase`, meaning the guarantee is only as strong as callers' discipline in invoking the abstract methods.

Paired with this is a Bridge/Adapter pattern: claude-bridge.js translates Claude's native event names (`PreToolUse`, `PostToolUse`, etc.) into the unified `HookContext` shape, mirroring what a Copilot-specific bridge would do for `preToolUse`/`postToolUse`. This translation is data-driven via lookup tables (`EVENT_MAP` in claude-bridge.js, `EVENT_MAPPINGS` in hooks-api.js) rather than switch statements, per `HookEventMapping` — new agent types can theoretically be added by extending a table rather than branching logic.

A notable structural finding is that two parallel hook-registry implementations exist side-by-side: `HooksManager.hooks` here and the sibling `UnifiedHookManager`'s registry in hook-manager.js. Both use a `Map<string, RegisteredHook[]>` seeded across `HookEvent` enum values and both re-sort on insert rather than at dispatch — an explicit, consistent trade-off (documented under `RegisteredHookLifecycle` and the sibling KnowledgeInjectionHooks observation) favoring cheap per-call dispatch over cheap registration, justified because registration is a low-frequency startup-time operation.

![HealthPromptHook — Relationship](images/health-prompt-hook-relationship.png)

Error handling forms two independent, stacked fail-open layers: `triggerHook()` catches and logs per-handler errors while continuing the iteration (fail-permissive at the handler level), and claude-bridge.js's `main()` catches at the process level, always emitting `{decision:'allow', ...}` and calling `process.exit(0)` — even on JSON parse failures or missing imports. This double-layered tolerance trades enforcement strength for availability, consistent with this codebase's broader fail-open philosophy for gating mechanisms.

## Implementation Details

The `HooksManager` constructor (hooks-api.js:112-124) seeds an empty array for every value in the `HookEvent` enum, guaranteeing `this.hooks.get(event)` never returns undefined downstream. `registerHook()` (lines 174-198) builds a `RegisteredHook` object inline — `{id, event, handler, priority, source}`, defined only as a JSDoc `@typedef` with no backing class — defaults `priority` to `100` via `options.priority ?? 100`, pushes it into the per-event array, and re-sorts that array by priority on every call. As `RegisteredHookLifecycle` notes, there is no update path: changing a hook's priority or handler requires unregister (via `findIndex` + `splice`) then re-register, which changes object identity and re-triggers the sort.

`triggerHook()` (lines 230-266) iterates the sorted array per event, wrapping each handler call in try/catch; failures produce a synthesized `Hook error (${hook.id}): ${error.message}` message pushed into the results but never abort the chain.

On the bridge side, `readStdin()` (claude-bridge.js:47-70) has a 1000ms fallback timeout that resolves `{}` if `data` is still falsy, but never calls `clearTimeout` on the normal `'end'` path — a benign resource-management smell rather than a functional defect, since only the first Promise resolution takes effect. `transformContext()` (lines 77-97) spreads the entire raw `claudeContext` into `metadata` unfiltered, meaning tool inputs and file contents pass through with no redaction performed at this layer. `EVENT_MAP` (lines 33-41) covers seven native Claude events, translating them via `EVENT_MAP[nativeEvent] || nativeEvent.toLowerCase()` — an unrecognized event silently lowercases rather than throwing, per `HookEventMapping`.

## Integration Points

HealthPromptHook sits beneath ConstraintSystem and beside HookConfigLoader (which supplies merged configuration), UnifiedHookManager (a structurally similar but separate registry implementation), and KnowledgeInjectionHooks (which documents the same re-sort-on-insert registration strategy, confirming this pattern is used consistently rather than as a one-off). claude-bridge.js is tightly coupled to hook-manager.js: `main()` dynamically imports `./hook-manager.js`, calling `getHookManager()`, `manager.initialize()`, and `manager.executeHooks()` — meaning the bridge's own `EVENT_MAP` is only the first of two translation layers a payload passes through before a handler actually executes.

Downstream, any handler that logs violations — e.g., ViolationCaptureService — is expected to call `sanitizeParams()` before persisting context data, since neither `transformContext()` nor `triggerHook()` performs sanitization. This is an implicit, type-unenforced cross-file contract: credentials embedded in `tool_input` could leak into violation-history.json if a handler bypasses that step.

There's also a documented inconsistency worth flagging as an integration risk: hooks-api.js's `EVENT_MAPPINGS.claude` maps STARTUP/SHUTDOWN/PRE_PROMPT/POST_PROMPT/ERROR to `null` (commented "handled by launcher script"), while claude-bridge.js's own `EVENT_MAP` actively translates these same events to real unified names. This suggests the two files' translation tables have drifted out of sync.

## Usage Guidelines

Developers extending this subsystem should register hooks with explicit `priority` values rather than relying on the `100` default, since same-priority hooks interleave in registration order — an implicit ordering dependency that only surfaces when priorities collide. Because `RegisteredHook` has no update path, treat hook mutation as unregister-then-reregister, not in-place edits.

Never assume `transformContext()` or the bridge layer sanitizes payload data — any handler writing context to disk or logs must explicitly apply sanitization equivalent to `sanitizeParams()`. When adding a new agent type, extend the `EVENT_MAP`/`EVENT_MAPPINGS` lookup tables consistently in both hooks-api.js and the relevant bridge file, and reconcile the current drift between them rather than propagating it further. Finally, given the fail-open design at both the handler and process levels, do not rely on this hook system as a hard enforcement gate — a bug in any handler or in the bridge process degrades silently to "allow," so critical constraints should not depend solely on hook execution succeeding.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- [LLM] The configuration merging strategy in HookConfigLoader (lib/agent-api/hooks/hook-config.js) implements a three-tier cascade — DEFAULT_CONFIG baked into the code, user-level settings from ~/.coding-tools/hooks.json, and project-level settings from .coding/hooks.json — resolved through mergeConfigs(). This design lets individual developers set personal defaults (e.g., preferred logging verbosity or disabled hooks) while allowing a project to enforce mandatory constraints that override user preferences, but not vice versa. A new developer extending this system needs to understand that the merge is not a deep recursive merge in all cases; array-type handler lists are typically concatenated or replaced depending on the key, so adding a new hook type requires checking mergeConfigs() logic to avoid silently dropping user-level handlers.

### Children
- [HooksManagerAbstractBase](./HooksManagerAbstractBase.md) -- [LLM] The constructor in lib/agent-api/hooks-api.js:110-124 uses the `new.target === HooksManager` check to enforce abstractness at runtime rather than relying on TypeScript's compile-time `abstract class` keyword — a JSDoc-typed JS codebase's only real enforcement mechanism for the Template Method pattern. This means `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()` (all throwing `must be implemented by subclass` in their base-class bodies, lines ~140-160) are abstract by convention plus a runtime throw, not by any language-level guarantee — a concrete subclass that simply never calls these methods would never trigger the failure, so the abstraction is only as strong as its callers' discipline.
- [HookEventMapping](./HookEventMapping.md) -- [LLM] EVENT_MAP in claude-bridge.js (lib/agent-api/hooks/claude-bridge.js) is the sole place where a raw Claude native event string ('PreToolUse', 'PostToolUse', 'Startup', 'Shutdown', 'PrePrompt', 'PostPrompt', 'Error') is normalized to the unified lowercase-hyphenated form ('pre-tool', 'post-tool', etc.) via transformContext()'s `EVENT_MAP[nativeEvent] || nativeEvent.toLowerCase()` fallback. That fallback means an unrecognized native event silently degrades to `.toLowerCase()` rather than throwing, so a typo'd or future Claude event name (e.g. 'SessionEnd') would produce a unified event key that likely has no registered hooks in hooks-api.js's Map, rather than surfacing as an explicit translation error.
- [RegisteredHookLifecycle](./RegisteredHookLifecycle.md) -- [LLM] The `RegisteredHook` shape is only a JSDoc `@typedef` in lib/agent-api/hooks-api.js (properties: `id`, `event`, `handler`, `priority`, `source`) — there is no runtime class or constructor for it. `registerHook()` builds the literal object `{ id, event, handler, priority, source }` inline and pushes it into the per-event array retrieved from `this.hooks.get(event)`. This means the 'lifecycle' of a RegisteredHook is entirely a Map-array lifecycle: born via `registerHook()`'s `eventHooks.push(hook)` + re-sort, read via `triggerHook()`'s `for (const hook of eventHooks)` iteration or `getRegisteredHooks()`'s flatten-and-concat over `this.hooks.values()`, and destroyed via `unregisterHook()`'s `hooks.findIndex(h => h.id === hookId)` + `splice`. There is no update path — a registered hook's priority or handler cannot be changed in place; the only way to change either is unregister-then-reregister, which also changes the object identity and re-triggers the sort.

### Siblings
- [HookConfigLoader](./HookConfigLoader.md) -- [CGR] HookConfigLoader (class) in hook-config.js
- [UnifiedHookManager](./UnifiedHookManager.md) -- [CGR] UnifiedHookManager (class) in hook-manager.js
- [KnowledgeInjectionHooks](./KnowledgeInjectionHooks.md) -- [LLM] lib/agent-api/hooks-api.js defines an abstract `HooksManager` base class whose `registerHook()` method pushes a new hook into `this.hooks.get(event)` and then immediately calls `eventHooks.sort((a, b) => a.priority - b.priority)` on every single registration. This re-sort-on-insert strategy means the handler array is always kept in priority order rather than being sorted lazily at dispatch time in `triggerHook()`. The cost is O(n log n) per registration instead of amortizing the sort to a single O(n log n) pass before the first dispatch, which is a reasonable trade-off only because hook registration is a low-frequency, mostly-startup-time operation while `triggerHook()` (invoked per tool call) stays a cheap linear scan.


---

*Generated from 10 observations*
