# HandlerPriorityRegistry

**Type:** Detail

[LLM] The component name 'HandlerPriorityRegistry' does not correspond to any class, function, or export literally present in the provided code files (hooks-api.js, claude-bridge.js, hooks.ts, usePolledFetch.ts, cli-and-rules-gating.test.mjs) or in the parent's code graph evidence, which is empty for this component. The closest conceptual match is the priority-sorted 'eventHooks' array inside HooksManager.registerHook() in lib/agent-api/hooks-api.js, where hooks are pushed into a Map<event, RegisteredHook[]> and immediately re-sorted via eventHooks.sort((a, b) => a.priority - b.priority). This suggests HandlerPriorityRegistry is likely a documentation/summary label for that in-memory priority-sorted structure rather than a distinct class, and a developer should verify whether it maps to hooks-api.js's Map or to a similarly named construct in hook-manager.js (not shown here).

# HandlerPriorityRegistry — Technical Insight Document

## What It Is

HandlerPriorityRegistry is not a literal class, function, or export found anywhere in the provided code — no code-graph evidence exists for a symbol of this name in `hooks-api.js`, `claude-bridge.js`, `hooks.ts`, `usePolledFetch.ts`, or `cli-and-rules-gating.test.mjs`. It is best understood as a **descriptive label** applied to the priority-sorted `eventHooks` structure that lives inside `HooksManager` in `lib/agent-api/hooks-api.js`. Specifically, `HooksManager.registerHook()` maintains a `Map<event, RegisteredHook[]>`, and each registration triggers `eventHooks.sort((a, b) => a.priority - b.priority)` to keep handlers ordered by priority. As a child concept under its parent `HookConfigLoader` (in `hook-config.js`), HandlerPriorityRegistry represents the runtime enforcement mechanism for ordering, while HookConfigLoader governs the configuration cascade that presumably feeds priorities and enablement flags into this structure.

Developers should treat this component name as a synthesized/documentation-level abstraction rather than a concrete implementation target, and verify against `hook-manager.js` (not included in this excerpt) whether a parallel, independently-implemented registry exists there.

## Architecture and Design

The dominant pattern is a **priority queue / sorted array** approach: handlers are stored in a plain array and re-sorted on every insertion rather than using an incrementally-maintained structure (e.g., binary-search insert or heap). This sits alongside other patterns in the hooks subsystem — the **Template Method pattern**, where abstract `HooksManager` enforces `getAgentType`/`loadNativeHooks`/`saveNativeHooks` contracts (guarded by a `new.target === HooksManager` check in the constructor), and the **Bridge/Adapter pattern** visible in `claude-bridge.js`'s `transformContext`/`transformResponse`, which translates native Claude events into a unified format.

A significant architectural concern is potential **duplication**: `claude-bridge.js`'s `main()` invokes `getHookManager()` and `manager.executeHooks()` from `hook-manager.js`, a separate implementation from the `HooksManager` class in `hooks-api.js`. If both maintain independent priority-sort logic, they could diverge in semantics (e.g., differing block-wins behavior) without a shared enforcement path — a structural risk worth flagging for any future consolidation work.

## Implementation Details

The core mechanic is straightforward: `registerHook()` pushes a new `RegisteredHook` entry into the array for its event key and re-sorts the entire array by `priority` (ascending), giving O(n log n) cost per registration rather than an optimized insert. This is an explicit trade-off — simplicity over efficiency — justified only if registration is a low-frequency, startup-time operation.

Critically, `triggerHook()` iterates the sorted array **sequentially without short-circuiting** on a block signal. Even after a handler sets `result.allow = false`, subsequent lower-priority handlers still execute and can append messages. Priority therefore governs *execution and message ordering only*, not final-decision precedence — `allow` is a one-way mutation, but the absence of a stop-on-block mechanism means callers could misinterpret which handler produced the final outcome.

Input validation is another notable gap: `registerHook()` checks for non-function handlers and invalid event names but does not validate priority values. A `NaN` or malformed priority would silently corrupt sort ordering rather than throwing — `Array.prototype.sort()` does not raise errors on invalid comparator results.

## Integration Points

Downstream, `claude-bridge.js`'s `main()` function wraps registry execution in a **fail-open** try/catch: any thrown error (including a hypothetical registry failure) results in `{ decision: 'allow', message: 'Hook bridge error: ...' }` and `process.exit(0)`. This makes registry correctness a **security-relevant property**, not merely a functional one — silent ordering bugs from invalid priorities would never surface as errors, yet could still permit operations that should have been blocked.

The registry's sibling entities reinforce this fragile-contract theme: **EventTranslationMaps** shows two independently maintained, inverse-direction event maps (`EVENT_MAPPINGS` in `hooks-api.js` vs. `EVENT_MAP` in `claude-bridge.js`) with no shared source of truth. Similarly, **HookConfigMigrationTool**'s context reveals that `HooksManager`'s config shape (`userConfigPath`, `projectConfigPath` per the `HookConfig` JSDoc typedef) matches HookConfigLoader's three-tier cascade (DEFAULT_CONFIG → `~/.coding-tools/hooks.json` → `.coding/hooks.json`) by convention only — `hooks-api.js` never imports `HookConfigLoader` directly. The same pattern of implicit, unenforced contracts likely applies to how priorities are populated into the registry.

## Usage Guidelines

Developers extending or debugging this area should: (1) confirm whether `hook-manager.js` implements its own priority registry and reconcile it with `HooksManager` in `hooks-api.js` to avoid divergent block semantics; (2) add explicit priority validation in `registerHook()` (reject `NaN`/non-numeric priorities) since malformed input currently degrades silently; (3) consider adding block-and-stop short-circuiting in `triggerHook()` if priority is meant to express decision precedence, not just ordering; (4) be aware that the fail-open design in `claude-bridge.js` means registry bugs default to permissive behavior — any hardening effort should treat registry integrity as a security boundary. Finally, treat unrelated bundled files (`hooks.ts`, `usePolledFetch.ts`, `cli-and-rules-gating.test.mjs`) as aggregation artifacts with no genuine architectural coupling to this component.


## Hierarchy Context

### Parent
- [HookConfigLoader](./HookConfigLoader.md) -- [CGR] HookConfigLoader (class) in hook-config.js

### Siblings
- [UnifiedHookConfigLoader](./UnifiedHookConfigLoader.md) -- [LLM+CGR] Per the parent context, HookConfigLoader (hook-config.js) is the sole named entity in the code graph for that file, implementing a three-tier cascade (DEFAULT_CONFIG → ~/.coding-tools/hooks.json → .coding/hooks.json) merged via mergeConfigs(). No implementation of hook-config.js itself is present in this component's code files, so its internal merge semantics (array concatenation vs. override, deep vs. shallow merge) remain unverified — the only concrete evidence available here is the consuming code in lib/agent-api/hooks-api.js and lib/agent-api/hooks/claude-bridge.js, which describe the config's downstream effects rather than its construction.
- [EventTranslationMaps](./EventTranslationMaps.md) -- [LLM+CGR] Two independent event-translation maps exist in the hooks subsystem: `EVENT_MAPPINGS` in lib/agent-api/hooks-api.js (keyed by agent type `claude`/`copilot`, mapping unified `HookEvent` enum values to native event names) and `EVENT_MAP` in lib/agent-api/hooks/claude-bridge.js (a flat, claude-only, inverse-direction map from native Claude event names like 'PreToolUse' back to unified strings like 'pre-tool'). These are structurally opposite translations of the same vocabulary maintained in two separate files with no shared source of truth — hooks-api.js's `translateEvent()` goes unified→native, while claude-bridge.js's `transformContext()` goes native→unified, and a change to one event name (e.g. renaming 'pre-tool' to 'preTool') would require manually finding and updating both maps or the two systems would silently desynchronize.
- [HookConfigMigrationTool](./HookConfigMigrationTool.md) -- [LLM+CGR] The parent context establishes that HookConfigLoader (hook-config.js) implements a three-tier cascade (DEFAULT_CONFIG → ~/.coding-tools/hooks.json → .coding/hooks.json merged via mergeConfigs()), and the actual JSDoc typedef for HookConfig in lib/agent-api/hooks-api.js corroborates this exactly: `@typedef {Object} HookConfig` documents `userConfigPath` ('Path to user-level config (~/.coding-tools/hooks.json)') and `projectConfigPath` ('Path to project-level config (.coding/hooks.json)'). This is strong cross-file evidence that HooksManager's constructor config shape was designed to be populated by HookConfigLoader's merged output, even though hooks-api.js never imports or references HookConfigLoader directly — the two files agree on a contract without any visible coupling in the code shown.


---

*Generated from 9 observations*
