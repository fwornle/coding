# ClaudeBridgeScript

**Type:** Detail

# ClaudeBridgeScript — Technical Insight Document

## What It Is

ClaudeBridgeScript is implemented at `lib/agent-api/hooks/claude-bridge.js` and serves as the process-boundary adapter between Claude Code's native hook invocation protocol and the unified hook system. Its core responsibilities are distributed across a small set of tightly-scoped functions: an `EVENT_MAP` table (lines 36-44) translating native event names like `PreToolUse`/`PostToolUse` into unified event strings (`pre-tool`/`post-tool`), a `readStdin()` function (lines 47-70) that parses Claude's piped JSON payload with a 1000ms timeout fallback, `transformContext()` (lines 76-101) that converts Claude's native context into the unified `HookContext` shape, `transformResponse()` (lines 106-112) that converts unified hook results back into Claude's expected `{decision, message}` contract, and a `main()` entrypoint (lines 118-159) that orchestrates the whole request lifecycle. Structurally, it sits beneath its parent HookConfigLoader in the hook subsystem hierarchy, consuming merged/validated configuration to determine which handlers actually run.

## Architecture and Design

The dominant pattern is the **Adapter pattern**: `transformContext()` and `transformResponse()` exist purely to translate between two incompatible schemas — Claude's native stdin JSON and the unified hook context/result shape. Layered on top of this is a **fail-open / graceful degradation** philosophy applied uniformly at every boundary: `readStdin()`'s timeout resolves to `{}` instead of rejecting, `main()`'s fallback chain (`process.env.HOOK_EVENT || process.argv[2] || 'PreToolUse'`) silently defaults to a testing event rather than erroring, and the top-level catch-all in `main()` converts any failure — including hard-thrown errors from classes like HooksManagerAbstraction's `HooksManager` — into a soft `{decision: 'allow'}` response. This creates a deliberate architectural seam described in the observations as "library correctness vs. runtime resilience": strict validation exists at the class API boundary (`new.target` guards, thrown errors for unknown events), but everything is flattened into permissive behavior once it crosses into the bridge process.

A **lazy singleton initialization** pattern governs manager startup: `main()` dynamically imports `./hook-manager.js` (not `hooks-api.js`) via `await import(...)` and only calls `initialize()` if `!manager.initialized`, ensuring HookConfigLoader's `mergeConfigs()`/`validateConfig()` and any expensive sort operations run once per process lifetime rather than per hook invocation.

Most notably, the observations surface a **Strategy/mapping table duplication**: `EVENT_MAP` in claude-bridge.js is an independently maintained translation table from `EVENT_MAPPINGS` in `hooks-api.js`. Combined with sibling entity HookMigrationTool's finding that a third, unknown mapping likely exists inside `hook-manager.js` itself, there are now three parallel encodings of the same Claude event vocabulary — a direct violation of the repo's own "no parallel versions" convention.

## Implementation Details

`readStdin()` implements a race between piped-input reading and a 1000ms timer; on timeout it resolves to an empty object rather than propagating an error, and this empty object is fed directly into `transformContext()`, producing a context with `tool_name`, `cwd`, and `session_id` undefined or derived from environment fallbacks — indistinguishable from a legitimately empty tool call.

`transformContext()` spreads the entirety of the raw `claudeContext` object into `unifiedContext.metadata` (`...claudeContext`), meaning any field Claude Code adds to its native payload passes through unfiltered to user-supplied handlers loaded via HookConfigLoader's merged config, with no schema enforcement on either side.

`transformResponse()` performs a lossy collapse: the unified system (per sibling HookMigrationTool and hooks-api.js's `triggerHook()`, lines 230-266) accumulates a `messages: string[]` array and independent `allow` flags across multiple priority-ordered handlers, but the bridge joins all messages with newlines and reduces them to Claude's single binary `decision: 'allow'|'block'` field — discarding which specific handler in the priority-sorted Map caused a block.

`main()`'s event resolution uses a three-tier fallback (`HOOK_EVENT` env var → CLI arg → `'PreToolUse'` default, explicitly commented "Default for testing"), extending fail-open behavior into event classification itself: a misconfigured `hooks.json` handler omitting its event silently misclassifies as `PreToolUse` rather than failing loudly.

## Integration Points

claude-bridge.js integrates with HookConfigLoader (its parent) indirectly through `getHookManager()`, which triggers `mergeConfigs()`/`validateConfig()` on first-use initialization — inheriting HookConfigLoader's lenient, warn-only validation posture rather than enforcing its own schema. Critically, the bridge couples to `hook-manager.js`'s `UnifiedHookManager` via dynamic import, *not* to `hooks-api.js`. This makes sibling HooksManagerAbstraction's `HooksManager` class effectively disconnected from the actual Claude execution path — no concrete subclass of `HooksManager` appears wired into claude-bridge.js's flow, suggesting it is either superseded or serves a different, unshown consumer. Sibling HookMigrationTool's analysis of the duplicated `EVENT_MAP`/`EVENT_MAPPINGS` tables further reinforces that these components are drifting independently rather than sharing a single source of truth for event vocabulary.

## Usage Guidelines

Developers extending or debugging ClaudeBridgeScript should treat every silent-default behavior as a potential masking of misconfiguration: an unexpected `PreToolUse` classification, an empty context object, or an always-`allow` decision may indicate a stdin timeout, a missing `HOOK_EVENT`, or a swallowed exception rather than genuine bridge behavior — these failure modes are indistinguishable from legitimate empty/no-op invocations by design. When modifying event-name handling, changes must be mirrored across at least `EVENT_MAP` (claude-bridge.js) and `EVENT_MAPPINGS` (hooks-api.js), and likely a third mapping inside `hook-manager.js`, until the duplication is consolidated. Because `transformContext()` performs an unfiltered spread of Claude's native payload into handler-visible metadata, handler authors should not assume any sanitization has occurred, and anyone pointing `handler.path` at untrusted scripts should treat the received context as an unvalidated superset of Claude's internal payload. Finally, because `transformResponse()` discards per-handler attribution, debugging a block decision requires inspecting the unified layer's `triggerHook()` output directly rather than relying on the bridge's collapsed response.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- main() in claude-bridge.js dynamically imports './hook-manager.js' (`const { getHookManager } = await import('./hook-manager.js')`) rather than statically importing it at module top-level, and lazily initializes the manager only if `!manager.initialized`. This lazy, on-demand initialization pattern means HookConfigLoader's mergeConfigs() and validateConfig() are only invoked once per bridge process, at the moment the first hook actually fires — the singleton getHookManager() plus the initialized guard is what prevents the O(n log n) re-sort behavior noted in the parent context from repeating across triggerHook-equivalent calls within a single process lifetime.

**Other:**
- claude-bridge.js's EVENT_MAP is a second, independent translation table distinct from hooks-api.js's EVENT_MAPPINGS.claude — EVENT_MAP handles 'PrePrompt'/'PostPrompt'/'Error' as pass-through unified events (`'PrePrompt': 'pre-prompt'`) while EVENT_MAPPINGS.claude explicitly nulls out PRE_PROMPT, POST_PROMPT, and ERROR as 'New via hook'. This means claude-bridge.js's own mapping has already evolved past hooks-api.js's EVENT_MAPPINGS for the claude agent type, reinforcing the parent-context suspicion that hook-manager.js/claude-bridge.js and hooks-api.js are two versions of the same subsystem at different points of drift rather than cleanly separated layers.
- transformResponse() collapses the rich `{allow, messages: string[]}` result shape (visible in hooks-api.js's triggerHook(), which accumulates a `messages` array across all handlers for an event) into Claude's binary `{decision: 'allow'|'block', message}` contract by joining messages with newlines. This is a lossy protocol adapter: hooks-api.js's per-handler message/allow granularity (each handler can independently set `result.allow === false`) is flattened into a single decision, so a project author cannot tell from the bridge's output alone which of several stacked hook handlers (as ordered by UnifiedHookManager's priority-sorted Map, per the parent context) caused a block.


## Hierarchy Context

### Parent
- [HookConfigLoader](./HookConfigLoader.md) -- [CGR] HookConfigLoader (class) in hook-config.js

### Siblings
- [HooksManagerAbstraction](./HooksManagerAbstraction.md) -- [LLM+CGR] The abstract HooksManager class in lib/agent-api/hooks-api.js enforces its own abstractness via `if (new.target === HooksManager) { throw new Error(...) }` in the constructor, and declares getAgentType(), loadNativeHooks(), and saveNativeHooks() as methods that throw 'must be implemented by subclass' errors. This is a textbook Template Method / abstract base class pattern, but no concrete subclass of HooksManager appears anywhere in the provided code graph or code files — hook-manager.js's UnifiedHookManager (referenced in claude-bridge.js's `await import('./hook-manager.js')`) is never shown extending HooksManager, and claude-bridge.js imports `getHookManager` from './hook-manager.js', not hooks-api.js. This strongly suggests hooks-api.js is either a superseded design or an abstraction layer that has not yet been wired into the actual execution path used by claude-bridge.js.
- [HookMigrationTool](./HookMigrationTool.md) -- [LLM+CGR] claude-bridge.js's EVENT_MAP (mapping 'PreToolUse'->'pre-tool', 'PostToolUse'->'post-tool', etc.) is a second, independent translation table from the EVENT_MAPPINGS structure in lib/agent-api/hooks-api.js — the bridge maintains its own hardcoded Claude-native-to-unified mapping rather than importing translateEvent()/EVENT_MAPPINGS from hooks-api.js, and rather than importing from hook-manager.js's UnifiedHookManager either. This means there are now three places (hooks-api.js's EVENT_MAPPINGS, claude-bridge.js's EVENT_MAP, and whatever hook-manager.js uses internally) that encode the claude event-name vocabulary, which is exactly the kind of 'parallel versions' duplication the repo's own conventions elsewhere explicitly warn against.


---

*Generated from 10 observations*
