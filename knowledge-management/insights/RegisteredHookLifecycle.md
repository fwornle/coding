# RegisteredHookLifecycle

**Type:** Detail

# RegisteredHookLifecycle — Technical Insight Document

## What It Is

`RegisteredHookLifecycle` describes the birth-to-death path of a `RegisteredHook`, a data shape defined purely as a JSDoc `@typedef` in `lib/agent-api/hooks-api.js` — there is no runtime class, constructor, or encapsulation behind it. Its fields (`id`, `event`, `handler`, `priority`, `source`) are assembled as a plain object literal inside `registerHook()` and stored directly in a per-event array retrieved from `this.hooks.get(event)`. As the child of `HealthPromptHook` (via the parent `HooksManager` abstraction), the lifecycle is entirely a `Map`-and-array lifecycle: hooks are created via `registerHook()`, read via `triggerHook()` and `getRegisteredHooks()`, and destroyed via `unregisterHook()`. Critically, there is no update operation — a hook's `priority` or `handler` cannot be mutated in place, only replaced by unregistering and re-registering, which produces a new identity.

## Architecture and Design

The design centers on a Registry pattern: a `Map<string, RegisteredHook[]>` eagerly seeded in the `HooksManager` constructor by iterating `Object.values(HookEvent)`, so every event bucket exists before any hook is ever registered. This is consistent with the sibling `HooksManagerAbstractBase`, which enforces abstractness only via a runtime `new.target === HooksManager` check rather than a language-level guarantee — a JSDoc-typed JS codebase's substitute for TypeScript's `abstract class`.

Ordering in this registry is two-tiered, a subtlety easy to miss: `getRegisteredHooks()` flattens `this.hooks.values()` in Map iteration (insertion) order, which is fixed by the constructor's enum-seeding loop (STARTUP, SHUTDOWN, PRE_TOOL, POST_TOOL, PRE_PROMPT, POST_PROMPT, ERROR) — not by registration order across events. Within a single event's array, however, order follows `priority` via an insertion-sort-on-write (`eventHooks.sort(...)` on every `registerHook()` call, rather than a lazy sort-on-read or maintained sorted insert). A consumer reading a full hook dump could easily mistake this for one flat priority queue when it is actually enum-order-then-priority-order.

The execution model is fail-permissive at two levels: per-handler (try/catch inside `triggerHook()`) and, as seen in the sibling `HookEventMapping`'s translation layer, per-process (claude-bridge.js's catch-all defaulting to `allow`). This philosophy extends into the lifecycle itself — malformed handler return values are treated as implicit passes rather than errors.

## Implementation Details

`registerHook()` builds `{ id, event, handler, priority, source }`, pushes it onto the array for `event`, and re-sorts by priority. Default IDs are generated as `hook-${event}-${Date.now()}-${random}`, embedding the event name directly in the string — yet `unregisterHook(hookId)` ignores this and instead loops over every entry in `this.hooks.entries()` (`for (const [event, hooks] of ...)`), performing an O(E) scan across all seven `HookEvent` buckets before an O(N) `findIndex` and `splice`. At current scale (single-digit handlers per event) this is inconsequential, but it means the ID structure is not actually leveraged as an optimization hint by the API's own code.

`triggerHook()` iterates the live array (`for (const hook of eventHooks)`) with no defensive copy such as `[...eventHooks]`. Since `unregisterHook()`'s `splice` mutates the same array object in place, a handler that calls back into `registerHook()`/`unregisterHook()` for the same event mid-trigger creates a genuine hazard: `for...of` tolerates concurrent splices without throwing, but can skip or double-visit elements depending on splice position relative to the iteration cursor.

Result handling is similarly permissive: `if (result) { if (result.allow === false) allow = false; if (result.message) messages.push(...) }` — a handler returning `undefined`, `null`, or a typo'd key like `allowed` instead of `allow` is silently treated as a pass, with no schema validation against the `HookHandler` JSDoc contract.

## Integration Points

`RegisteredHookLifecycle` sits underneath `HealthPromptHook` and is managed entirely by the abstract `HooksManager` base class, which defers agent-specific translation (`getAgentType()`, `loadNativeHooks()`, `saveNativeHooks()`) to concrete subclasses — none of which are visible in these observations. The sibling `HookEventMapping` shows that `claude-bridge.js` normalizes native Claude events into unified event keys via `EVENT_MAP`, falling back to `.toLowerCase()` for unrecognized events rather than erroring — a mismatch that can silently route hooks to unpopulated buckets.

More significantly, `claude-bridge.js`'s actual runtime path (`main()` calling `getHookManager().executeHooks(...)`) never touches the `HooksManager`/`RegisteredHook` machinery in hooks-api.js at all — it uses a separate module, `hook-manager.js`. Combined with `EVENT_MAP` diverging from `EVENT_MAPPINGS.claude` in hooks-api.js, this strongly suggests two parallel hook-registration implementations coexist, and the `RegisteredHookLifecycle` documented here may be a legacy or unused path relative to what a live Claude Code session actually executes.

## Usage Guidelines

Developers should treat a `RegisteredHook`'s `id`, once assigned, as immutable and its `priority`/`handler` as effectively immutable too — any change requires unregister-then-reregister, which changes object identity and re-triggers the array sort. When enumerating hooks via `getRegisteredHooks()`, remember the two-tier ordering (enum-order groups, priority-order within group) rather than assuming a single flat priority sequence. Handlers should avoid registering or unregistering hooks for the same event they are currently being triggered under, since `triggerHook()` takes no defensive snapshot of the array. Finally, given the apparent existence of a separate `hook-manager.js` registry actually used by `claude-bridge.js`, any work targeting live Claude Code hook behavior should first confirm which of the two implementations is actually reachable before assuming changes to `hooks-api.js`'s `HooksManager` will have runtime effect.


## Hierarchy Context

### Parent
- [HealthPromptHook](./HealthPromptHook.md) -- [LLM] HooksManager in lib/agent-api/hooks-api.js is an abstract base class (constructor throws if `new.target === HooksManager`) that centralizes the unified hook registry as a `Map<string, RegisteredHook[]>`, seeded in the constructor by iterating `Object.values(HookEvent)` so every event key exists even before any handler is registered. This mirrors the parent observation about UnifiedHookManager's Map<event, HookHandler[]> registry, but hooks-api.js is the older/more generic abstraction layer: it defines `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()` as abstract methods subclasses must implement, meaning the actual Claude/Copilot-specific behavior (reading ~/.claude/settings.json vs .github/hooks/hooks.json) lives outside this file entirely, in whatever concrete class extends HooksManager.

### Siblings
- [HooksManagerAbstractBase](./HooksManagerAbstractBase.md) -- [LLM] The constructor in lib/agent-api/hooks-api.js:110-124 uses the `new.target === HooksManager` check to enforce abstractness at runtime rather than relying on TypeScript's compile-time `abstract class` keyword — a JSDoc-typed JS codebase's only real enforcement mechanism for the Template Method pattern. This means `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()` (all throwing `must be implemented by subclass` in their base-class bodies, lines ~140-160) are abstract by convention plus a runtime throw, not by any language-level guarantee — a concrete subclass that simply never calls these methods would never trigger the failure, so the abstraction is only as strong as its callers' discipline.
- [HookEventMapping](./HookEventMapping.md) -- [LLM] EVENT_MAP in claude-bridge.js (lib/agent-api/hooks/claude-bridge.js) is the sole place where a raw Claude native event string ('PreToolUse', 'PostToolUse', 'Startup', 'Shutdown', 'PrePrompt', 'PostPrompt', 'Error') is normalized to the unified lowercase-hyphenated form ('pre-tool', 'post-tool', etc.) via transformContext()'s `EVENT_MAP[nativeEvent] || nativeEvent.toLowerCase()` fallback. That fallback means an unrecognized native event silently degrades to `.toLowerCase()` rather than throwing, so a typo'd or future Claude event name (e.g. 'SessionEnd') would produce a unified event key that likely has no registered hooks in hooks-api.js's Map, rather than surfacing as an explicit translation error.


---

*Generated from 9 observations*
