# HookEventMapping

**Type:** Detail

# HookEventMapping — Technical Insight Document

## What It Is

HookEventMapping refers to the event-name translation layer that bridges Claude's native hook event vocabulary (`PreToolUse`, `PostToolUse`, `Startup`, `Shutdown`, `PrePrompt`, `PostPrompt`, `Error`) into the internal unified event vocabulary (`pre-tool`, `post-tool`, etc.) used throughout the hooks subsystem. It exists in **two independent, non-communicating implementations**:

- `lib/agent-api/hooks/claude-bridge.js`'s `EVENT_MAP`, consulted inside `transformContext()` via `EVENT_MAP[nativeEvent] || nativeEvent.toLowerCase()`.
- `lib/agent-api/hooks-api.js`'s `EVENT_MAPPINGS.claude` table, consulted through `HooksManager.translateEvent()`.

As a child concept of its parent **HealthPromptHook** (built around `HooksManager`'s `Map<string, RegisteredHook[]>` registry seeded from `HookEvent`), HookEventMapping is the mechanism that determines which registry key a raw vendor event resolves to before any handler lookup happens.

## Architecture and Design

The dominant pattern is **Bridge/Adapter**: vendor-specific event names are translated into an internal, agent-agnostic vocabulary so that downstream handler registration and dispatch (the `Map`-based registry described in sibling **RegisteredHookLifecycle**) need not know about Claude specifically. This complements the **abstract base class / template method** pattern in sibling **HooksManagerAbstractBase**, where `HooksManager` defines `getAgentType()`, `loadNativeHooks()`, `saveNativeHooks()` as subclass responsibilities — `EVENT_MAPPINGS.claude` is the Claude-specific data table analogous to what a concrete subclass would supply.

Critically, the two mapping tables represent **parallel, un-unified abstraction layers**. `claude-bridge.js` never imports `hooks-api.js` or instantiates any `HooksManager` subclass; it only imports `hook-manager.js` (a distinct, unshown module) via dynamic `await import()`. This suggests `hooks-api.js`'s `EVENT_MAPPINGS` — with its `null` entries for `STARTUP`/`SHUTDOWN`/`PRE_PROMPT`/`POST_PROMPT`/`ERROR` annotated "Handled by launcher script" — may be a legacy or alternate code path not actually wired into the live execution flow that `claude-bridge.js` represents.

## Implementation Details

`claude-bridge.js`'s `EVENT_MAP` has no null entries — all 7 native events resolve to real unified strings — and its fallback (`nativeEvent.toLowerCase()`) is a silent degrade rather than a thrown error: an unrecognized event like a hypothetical `SessionEnd` produces a unified key unlikely to have registered hooks, rather than an explicit translation failure. This favors fail-open behavior consistent with `main()`'s overall design: it dynamically imports `./hook-manager.js` inside a try block, so import failures, JSON parse errors, and handler exceptions are all uniformly caught and converted into `{decision: 'allow', ...}` — the fail-open response.

`transformContext()` also resolves `projectPath` via `process.env.TRANSCRIPT_SOURCE_PROJECT || claudeContext.project_path`, meaning environment state can silently override Claude's own reported project context with no cross-validation — a latent staleness risk in long-lived shells.

By contrast, `hooks-api.js`'s `EVENT_MAPPINGS.claude` explicitly nulls out several events, deferring their handling elsewhere. Its `HooksManager` constructor enforces abstractness via `new.target === HooksManager` (a runtime-only guarantee, per **HooksManagerAbstractBase**), and hooks are stored as plain `RegisteredHook` JSDoc-typed objects (`id`, `event`, `handler`, `priority`, `source`) with no update path — per **RegisteredHookLifecycle**, changing a hook requires unregister-then-reregister via `registerHook()`'s push+resort and `unregisterHook()`'s `findIndex`+`splice`.

## Integration Points

`transformContext()` feeds its translated event name and unsanitized spread of `claudeContext` into `metadata`, which is passed onward to `hook-manager.js`'s `getHookManager()`/`executeHooks()` — bypassing `HooksManager` entirely. `transformResponse()` then collapses the richer `{allow, messages}` result shape back into Claude's binary `{decision, message}` protocol by joining all messages with `'\n'`, flattening any distinction between a hard block reason and unrelated informational messages.

`readStdin()` interacts with mapping indirectly: its 1000ms early-resolve timeout produces an empty `{}` context (no session_id, no tool info) that still flows through `transformContext()` and its event-mapping logic, versus a truncated-JSON case that rejects and is caught by `main()`'s fail-open handler — two different code paths for what is conceptually "no usable input."

## Usage Guidelines

Developers should treat `EVENT_MAP` in `claude-bridge.js` as the authoritative, currently-live translation table, since `EVENT_MAPPINGS.claude` in `hooks-api.js` appears disconnected from this execution path and may drift silently — there is no shared source of truth or test enforcing consistency between them. Anyone adding a new Claude native event must update `EVENT_MAP` explicitly rather than relying on the `.toLowerCase()` fallback, which masks unmapped events instead of surfacing errors. Given the fail-open design layered at both `main()` (process-level) and `triggerHook()` (per-handler, in `hooks-api.js`), mapping bugs will not block execution but may cause hooks to silently never fire — so testing new event types against the actual registered-hook `Map` is essential. Finally, since no redaction happens in `transformContext()` before metadata reaches downstream handlers, any sensitive context data must be sanitized by consumers, not assumed safe at the mapping layer.


## Hierarchy Context

### Parent
- [HealthPromptHook](./HealthPromptHook.md) -- [LLM] HooksManager in lib/agent-api/hooks-api.js is an abstract base class (constructor throws if `new.target === HooksManager`) that centralizes the unified hook registry as a `Map<string, RegisteredHook[]>`, seeded in the constructor by iterating `Object.values(HookEvent)` so every event key exists even before any handler is registered. This mirrors the parent observation about UnifiedHookManager's Map<event, HookHandler[]> registry, but hooks-api.js is the older/more generic abstraction layer: it defines `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()` as abstract methods subclasses must implement, meaning the actual Claude/Copilot-specific behavior (reading ~/.claude/settings.json vs .github/hooks/hooks.json) lives outside this file entirely, in whatever concrete class extends HooksManager.

### Siblings
- [HooksManagerAbstractBase](./HooksManagerAbstractBase.md) -- [LLM] The constructor in lib/agent-api/hooks-api.js:110-124 uses the `new.target === HooksManager` check to enforce abstractness at runtime rather than relying on TypeScript's compile-time `abstract class` keyword — a JSDoc-typed JS codebase's only real enforcement mechanism for the Template Method pattern. This means `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()` (all throwing `must be implemented by subclass` in their base-class bodies, lines ~140-160) are abstract by convention plus a runtime throw, not by any language-level guarantee — a concrete subclass that simply never calls these methods would never trigger the failure, so the abstraction is only as strong as its callers' discipline.
- [RegisteredHookLifecycle](./RegisteredHookLifecycle.md) -- [LLM] The `RegisteredHook` shape is only a JSDoc `@typedef` in lib/agent-api/hooks-api.js (properties: `id`, `event`, `handler`, `priority`, `source`) — there is no runtime class or constructor for it. `registerHook()` builds the literal object `{ id, event, handler, priority, source }` inline and pushes it into the per-event array retrieved from `this.hooks.get(event)`. This means the 'lifecycle' of a RegisteredHook is entirely a Map-array lifecycle: born via `registerHook()`'s `eventHooks.push(hook)` + re-sort, read via `triggerHook()`'s `for (const hook of eventHooks)` iteration or `getRegisteredHooks()`'s flatten-and-concat over `this.hooks.values()`, and destroyed via `unregisterHook()`'s `hooks.findIndex(h => h.id === hookId)` + `splice`. There is no update path — a registered hook's priority or handler cannot be changed in place; the only way to change either is unregister-then-reregister, which also changes the object identity and re-triggers the sort.


---

*Generated from 10 observations*
