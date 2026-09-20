# ClaudeBridge

**Type:** Detail

[Architecture Notes] hooks-api.js's EVENT_MAPPINGS.claude table and claude-bridge.js's own EVENT_MAP disagree on which native Claude events exist/are supported, suggesting hook-manager.js (imported dynamically by claude-bridge.js as getHookManager()/executeHooks()) is a divergent, more current implementation than the abstract HooksManager/triggerHook() sketched in hooks-api.js; Tight coupling between claude-bridge.js and the shape of Claude's native stdin payload — transformContext() spreads the entire raw payload into metadata, so any addition to Claude's native hook payload silently propagates to every registered hook handler without an explicit allow-list; Registration-time validation (registerHook()) is fail-closed/throwing, while execution-time errors (triggerHook(), main()) are fail-open/swallowing — an architectural inconsistency in how the same subsystem handles two different failure phases; The bridge script is a standalone Node entrypoint (`if (process.argv[1] === fileURLToPath(import.<COMPANY_NAME_REDACTED>.url)) main();`) that also exports main/transformContext/transformResponse/EVENT_MAP, so it doubles as both a CLI invoked by Claude Code's hook runner and an importable module for testing

# ClaudeBridge: Technical Insight Document

## What It Is

ClaudeBridge is implemented in `lib/agent-api/hooks/claude-bridge.js` as a standalone Node.js entrypoint that translates Claude Code's native stdin-based JSON hook protocol into the unified internal `HookContext` shape consumed elsewhere in the system. It is invoked directly by Claude Code's hook runner (guarded by `if (process.argv[1] === fileURLToPath(import.<COMPANY_NAME_REDACTED>.url)) main();`) but also exports its internals (`main`, `transformContext`, `transformResponse`, `EVENT_MAP`) for use as an importable module, most notably by its parent, **UnifiedHookManager**, which contains ClaudeBridge as a subcomponent in the hook-dispatch hierarchy. Structurally, ClaudeBridge sits as an adapter layer between Claude's agent-specific hook vocabulary (`PreToolUse`, `PostToolUse`, etc.) and the more general hook infrastructure represented by its siblings, **UnifiedHookManagerCore** and **HooksApiAbstraction**.

## Architecture and Design

The dominant pattern is Adapter/Bridge: raw Claude stdin JSON is read, transformed, dispatched to hook handlers, and the result is collapsed back into Claude's native `decision`/`message` response shape via `transformResponse()` (claude-bridge.js:108-115). This complements the Template Method pattern in the sibling `HooksApiAbstraction`, where the abstract `HooksManager` class defines `registerHook()`/`triggerHook()` while deferring `getAgentType()`, `loadNativeHooks()`, `saveNativeHosts()`, and `translateEvent()` to subclasses — enforced only at runtime via `new.target` checks and throwing stubs, not via compile-time interfaces.

A key architectural finding is that this Template Method design in `hooks-api.js` appears to be a diverged, possibly stale sketch relative to the dynamically-imported `hook-manager.js` (`UnifiedHookManager`'s `executeHooks()`), which claude-bridge.js actually exercises via `await import('./hook-manager.js')` (line 129). The `EVENT_MAP` in claude-bridge.js:33-41 (7 native events) directly contradicts `EVENT_MAPPINGS.claude` in hooks-api.js:41-49, which maps five of those same events to `null` for the Claude agent type. This suggests two competing implementations of the same adapter contract coexist in the codebase.

The system also exhibits a strictly conjunctive (AND) aggregation pattern for hook voting: `triggerHook()` (hooks-api.js:216-263) accumulates `allow` starting `true`, flippable only to `false`, with no early exit or override mechanism — any single blocking hook wins regardless of priority.

## Implementation Details

`readStdin()` (claude-bridge.js:47-73) races the stdin `'end'` event against a bare `setTimeout(1000)`, but the timeout only resolves to `'{}'` when `!data` — i.e., zero bytes received. Partial payloads that stall mid-stream are not caught by this guard, so the bridge can hang indefinitely despite the surrounding documentation implying general timeout protection.

`transformContext()` (claude-bridge.js:82-103) promotes `session_id`, `tool_name`, `tool_input`, and `tool_output` to top-level fields, then spreads the *entire* raw `claudeContext` into `metadata`, giving every registered `'source': 'api'` hook handler implicit, unfiltered access to Claude's full native payload — an allow-list-free data-sharing contract baked into the bridge itself.

Error handling operates asymmetrically across phases: `registerHook()` (hooks-api.js:163-186) is fail-closed, throwing synchronously on invalid events or non-function handlers, while `triggerHook()` wraps each handler in try/catch (fail-open), and `main()`'s top-level catch (claude-bridge.js:118-152) reduces *any* failure — malformed JSON, a broken dynamic import of `hook-manager.js`, or a handler exception — to an identical `Hook bridge error: ...` message with `decision: 'allow'` and `process.exit(0)`.

## Integration Points

ClaudeBridge's primary integration is with `hook-manager.js`'s `UnifiedHookManager` via a lazy dynamic import and `manager.initialize()`, deferred until after stdin parsing completes — meaning module-load failures are indistinguishable from data errors at the response layer. It also nominally integrates with `HooksApiAbstraction`'s abstract `HooksManager`/`registerHook()`/`triggerHook()` contract, though the divergent `EVENT_MAPPINGS.claude` table suggests this integration path may be outdated relative to what's actually executed. Every registered hook handler, regardless of its declared interest (pre-tool vs. post-tool), receives the full spread of Claude's native payload through `metadata`, coupling all downstream handlers tightly to Claude's stdin schema.

## Usage Guidelines

Developers should treat `readStdin()`'s timeout as a "no-data-at-all" guard only, not a general stall protection — partial/stalled native hook invocations can still hang the bridge indefinitely. Anyone adding fields to Claude's native hook payload should be aware they will silently propagate to every hook handler via `metadata`; there is no allow-list to update, but auditing handler access is prudent. Because hook aggregation is strictly conjunctive with no override mechanism, hook authors should assume their `allow: false` decisions cannot be countermanded by later or higher-priority hooks. Finally, given the fail-closed/fail-open inconsistency, errors from `registerHook()` during startup can crash a caller, whereas equivalent bugs at `triggerHook()`/`main()` time are silently absorbed into an `allow` decision — code relying on ClaudeBridge should not assume decision output alone indicates whether the hook subsystem is functioning correctly versus deliberately declining.


## Hierarchy Context

### Parent
- [UnifiedHookManager](./UnifiedHookManager.md) -- [CGR] UnifiedHookManager (class) in hook-manager.js

### Siblings
- [UnifiedHookManagerCore](./UnifiedHookManagerCore.md) -- Constructor sets default userConfigPath to ~/.coding-tools/hooks.json and initializes a Map of empty handler arrays for every HookEvent
- [HooksApiAbstraction](./HooksApiAbstraction.md) -- [LLM+CGR] hooks-api.js's abstract HooksManager class enforces its Template Method contract via `if (new.target === HooksManager) throw new Error(...)` in the constructor, then delegates getAgentType(), loadNativeHooks(), and saveNativeHooks() to subclasses via stub methods that throw 'must be implemented by subclass'. This is a textbook abstract base class pattern in vanilla JS (no TypeScript interfaces), relying entirely on runtime errors rather than compile-time checks to enforce the contract — a trade-off that keeps the module dependency-free but pushes contract violations to first-invocation rather than load time.


---

*Generated from 9 observations*
