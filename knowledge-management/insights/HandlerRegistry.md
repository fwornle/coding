# HandlerRegistry

**Type:** Detail

# HandlerRegistry — Technical Insight Document

## What It Is

HandlerRegistry is the internal registration data structure at the heart of `UnifiedHookManager` (its parent component, defined in `lib/agent-api/hooks/hook-manager.js`), responsible for maintaining a `Map<event, Handler[]>` of registered hook handlers and dispatching them in priority order. Its closest analog in the codebase is `HooksManager.registerHook()` in `lib/agent-api/hooks-api.js:172-197`, which implements the same map-of-arrays-plus-priority-sort registration logic. Notably, no `extends` clause is visible confirming that `UnifiedHookManager` actually inherits from the abstract `HooksManager` base class (`lib/agent-api/hooks-api.js:107-119`) — it may be a parallel/legacy reimplementation of the same registry concept rather than a genuine subclass, which is an open architectural question rather than a settled fact.

## Architecture and Design

The registry sits at the center of several classic patterns. `HooksManager` establishes a Template Method pattern: its constructor throws if instantiated directly (`new.target === HooksManager`), and abstract methods (`getAgentType()`, `loadNativeHooks()`, `saveNativeHooks()`) are stubs meant for subclass implementation. Registration itself follows a Registry pattern with priority ordering — `eventHooks.sort((a, b) => a.priority - b.priority)` runs on every `push` in `registerHook()`, an O(n log n) operation performed per registration rather than once before dispatch, a minor scalability inefficiency for high-churn registration scenarios.

Dispatch follows a fail-soft/fail-open Observer-like publish-subscribe model: `triggerHook()` (`hooks-api.js:225-266`) wraps each handler invocation in its own try/catch, isolating a misbehaving handler without aborting siblings in the same event's array. This inner isolation is complemented by an outer fail-open boundary in the sibling `ClaudeBridgeAdapter`'s `main()` function, which wraps the entire pipeline and defaults to `{decision: 'allow', ...}` on any failure — a two-layer, deliberately availability-over-enforcement design shared consistently across both files.

The registry is also the reuse target of a Singleton accessor pattern: since the bridge process is spawned fresh per Claude tool call (stateless per-invocation), `getHookManager()` in `claude-bridge.js` implies a module-level singleton that must persist registration state across invocations via some caching/config-reload mechanism not shown in these files.

## Implementation Details

Registration mechanics live in `registerHook()`, which inserts handlers into per-event arrays and re-sorts on each insert. Dispatch mechanics live in `triggerHook()`, which iterates the sorted handler array for an event and isolates failures per-handler with `Hook error (${hook.id}): ${error.message}` logging. The registry's event vocabulary is defined via `HookEvent` in `hooks-api.js`, translated per-agent through the nested `EVENT_MAPPINGS` object (`hooks-api.js:39-59`), which explicitly documents unsupported translations (e.g., `copilot.POST_PROMPT: null`). The `ClaudeBridgeAdapter` maintains its own flat `EVENT_MAP` (`claude-bridge.js:37-45`) for Claude-native event names, translating inbound stdin JSON via `transformContext()` (`claude-bridge.js:79-99`) before handlers registered in the registry ever see it.

A significant implementation gap: `transformContext()` performs an unguarded `...claudeContext` spread directly into `metadata`, meaning raw fields from Claude's stdin (potentially including sensitive `tool_input` payloads) reach every registered handler in the registry with no allowlist or redaction step at this layer — any sanitization must occur downstream inside `UnifiedHookManager.executeHooks()`, outside the files examined here.

## Integration Points

HandlerRegistry is owned by `UnifiedHookManager`, its parent, which presumably wraps the registry with scoping and invocation logic beyond raw storage. It is exercised indirectly through sibling components: `ClaudeBridgeAdapter`'s `main()` pipeline (readStdin → transformContext → dynamic `import('./hook-manager.js')` → `manager.initialize()`/`executeHooks()` → transformResponse) is the primary external entry point that populates and triggers registry contents at runtime. `UnifiedHookConfigLoader` and `HookMigrationTool` are siblings that presumably handle configuration loading and legacy migration into this registry's expected shape, though the specifics of that interface aren't detailed in these observations.

Three redundant event-mapping tables — `EVENT_MAPPINGS.claude`, `EVENT_MAPPINGS.copilot` (both in `hooks-api.js`), and `claude-bridge.js`'s own `EVENT_MAP` — must stay synchronized whenever a new `HookEvent` is added, since the registry's dispatch correctness depends on consistent event-name translation across all three. Unrelated namesakes worth explicitly ruling out: the React `hooks.ts`/`usePolledFetch.ts` dashboard subscriber pattern and the `cli-and-rules-gating.test.mjs` feature-gating tests share vocabulary ("hooks") but have zero functional coupling to this registry.

## Usage Guidelines

Developers adding a new event type must update all three mapping tables in lockstep to avoid silent dispatch failures. Because registration re-sorts on every insert, bulk registration at startup should be batched where possible rather than relying on incremental pushes if performance matters. Given the unguarded metadata spread in `transformContext()`, any handler registered into this registry should treat incoming `metadata` as untrusted and avoid logging it verbatim; sanitization is not guaranteed upstream. Finally, because both the registry's per-handler isolation and the bridge's outer catch are fail-open, a systemic failure (e.g., corrupted config or missing `hook-manager.js`) degrades silently to "no hooks ran" — this bridge/registry pairing is explicitly unsuitable as a location for mandatory, non-bypassable policy enforcement; such logic belongs in a hook handler that itself returns `allow: false`, not in the registry's dispatch machinery.


## Hierarchy Context

### Parent
- [UnifiedHookManager](./UnifiedHookManager.md) -- [CGR] UnifiedHookManager (class) in hook-manager.js

### Siblings
- [UnifiedHookConfigLoader](./UnifiedHookConfigLoader.md) -- [LLM] The claude-bridge.js `main()` function (lib/agent-api/hooks/claude-bridge.js:120-159) implements a strict fail-open contract: both the happy path and the catch block call `process.exit(0)`, and the catch block explicitly constructs `{ decision: 'allow', message: 'Hook bridge error: ...' }` before exiting. This means a crash inside `transformContext()`, a failure to `import('./hook-manager.js')`, or an exception thrown by `manager.executeHooks()` all degrade to the same outcome as a hook that legitimately allowed the action — Claude Code cannot distinguish 'no one objected' from 'the hook infrastructure was broken.' This is a deliberate availability-over-enforcement trade-off, but it also means the bridge is a poor place to add mandatory (non-bypassable) policy checks.
- [ClaudeBridgeAdapter](./ClaudeBridgeAdapter.md) -- [LLM+CGR] claude-bridge.js's `main()` function (lib/agent-api/hooks/claude-bridge.js:123-159) implements a strict linear pipeline — readStdin() → transformContext() → dynamic `import('./hook-manager.js')` → manager.initialize()/executeHooks() → transformResponse() — and every stage is wrapped in one outer try/catch that funnels ALL failures (JSON parse errors from readStdin, import failures, initialize() throwing, executeHooks() throwing) into the same fail-open response: `{decision: 'allow', message: 'Hook bridge error: ...'}` with `process.exit(0)`. This means a bug in transformContext() and a missing hook-manager.js module are observationally indistinguishable to Claude Code itself — both silently allow the tool call — so operators must rely on the `logger.error('Bridge execution failed', ...)` call to distinguish causes, and any monitoring built on top of this bridge needs to tail logs rather than trust the adapter's own exit code/stdout.
- [HookMigrationTool](./HookMigrationTool.md) -- [LLM] claude-bridge.js's main() function (lib/agent-api/hooks/claude-bridge.js) implements a strict linear pipeline — readStdin() → transformContext() → dynamic import of hook-manager.js's getHookManager() → manager.executeHooks() → transformResponse() — and every exit path, including the catch block, terminates with process.exit(0) and a JSON write to stdout. This is a deliberate fail-open contract: even a JSON.parse failure in readStdin() (line ~60, 'Failed to parse stdin JSON') or an exception inside executeHooks() results in `{decision: 'allow', message: 'Hook bridge error: ...'}` rather than a non-zero exit, meaning Claude Code's PreToolUse/PostToolUse gate can never be blocked by a bridge-level bug — only by an explicit `allow: false` returned from a properly executing hook handler.


---

*Generated from 10 observations*
