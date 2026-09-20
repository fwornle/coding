# EventTranslationMaps

**Type:** Detail

# EventTranslationMaps: Technical Insight Document

## What It Is

EventTranslationMaps refers to the pair of vocabulary-translation tables that convert between a unified internal hook-event representation and agent-native event names in the hooks subsystem. Concretely, it comprises two structurally distinct implementations:

1. **`EVENT_MAPPINGS`** in `lib/agent-api/hooks-api.js` — a nested object keyed by agent type (`claude`, `copilot`), mapping unified `HookEvent` enum values to each agent's native event names. It is consumed by `HooksManager.translateEvent()`.
2. **`EVENT_MAP`** in `lib/agent-api/hooks/claude-bridge.js` — a flat, Claude-only table running in the *inverse* direction, translating native Claude event names (e.g., `'PreToolUse'`) back into unified strings (e.g., `'pre-tool'`), consumed by `transformContext()`.

These two maps encode the same conceptual vocabulary but are maintained independently, in different files, with opposite directionality and no shared source of truth. As a child concept of **HookConfigLoader**, EventTranslationMaps represents the event-naming layer of the broader hook configuration system, sitting alongside sibling abstractions like **UnifiedHookConfigLoader** (config cascading), **HookConfigMigrationTool**, and **HandlerPriorityRegistry** (handler ordering).

## Architecture and Design

The dominant pattern here is a **translation table / adapter-bridge pattern**: native agent vocabularies (Claude, Copilot) are adapted into a unified internal vocabulary and back, so that downstream consumers (like constraint enforcement and `ViolationCaptureService`, per parent context) can operate on a single canonical event model. This is reinforced by a **Template Method** pattern in `HooksManager`, whose constructor enforces an abstract-class contract via `new.target === HooksManager`, with `getAgentType`, `loadNativeHooks`, and `saveNativeHooks` intended as subclass hooks.

However, code-graph evidence reveals a significant architectural fork: `claude-bridge.js`'s `main()` never actually uses `HooksManager` or `EVENT_MAPPINGS`. Instead, it performs its own translation via the local `EVENT_MAP` and delegates execution to `getHookManager()`/`manager.executeHooks()` imported from `hook-manager.js` (a third, not-yet-analyzed file). This means the "official" abstraction (`HooksManager` + `EVENT_MAPPINGS`) and the actual runtime path (`claude-bridge.js` + `hook-manager.js`) have diverged — `EVENT_MAPPINGS` may be effectively dead code from this call path's perspective, a notable maintainability red flag for a translation table that documentation might otherwise treat as canonical.

A second architectural inconsistency exists *within* `claude-bridge.js` itself: request-direction translation (event names) is table-driven via `EVENT_MAP`, but response-direction translation (decision values) is inline ternary logic in `transformResponse()` (`unifiedResult.allow ? 'allow' : 'block'`). The "translation map" concept is thus only partially applied across the bridge's input/output boundary.

## Implementation Details

`HooksManager.translateEvent()` performs a simple `mapping[event] || null` lookup against `EVENT_MAPPINGS`, but this collapses two semantically different states — "this event doesn't exist for this agent" and "this event isn't wired up yet" — into the same `null` value. This is evidenced by asymmetric coverage: `claude`'s `PRE_PROMPT`/`POST_PROMPT`/`ERROR` are all `null` with comments noting `'// New via hook'`, while `copilot`'s equivalents are populated (`'userPromptSubmitted'`, `null`, `'errorOccurred'`). Callers cannot distinguish "unsupported" from "not yet implemented" from the map alone.

On the `claude-bridge.js` side, `transformContext()` uses `EVENT_MAP` with a `.toLowerCase()` fallback for unrecognized native event names — since the table only covers 7 fixed entries, any unmapped Claude event degrades gracefully into a best-effort lowercase string rather than throwing. This graceful degradation is compounded by the **fail-open error handling** in `main()`'s catch block: any exception, including malformed translation results, produces `{decision: 'allow', ...}` followed by `process.exit(0)`, silently swallowing translation errors. This is a deliberate but risky trade-off, since correctness of event translation is load-bearing for downstream constraint enforcement.

Other implementation details in `hooks-api.js` include `HooksManager.registerHook()`, which re-sorts the `eventHooks` array by priority on every registration call, and `HooksManager.triggerHook()`, which executes handlers sequentially with per-handler try/catch and continue-on-block semantics. The priority-sorted structure is conceptually the closest match to sibling entity **HandlerPriorityRegistry**, though no class by that literal name exists — it appears to be a documentation label for this in-memory `Map<event, RegisteredHook[]>` structure rather than a distinct implementation.

## Integration Points

EventTranslationMaps sits beneath **HookConfigLoader**, which — per sibling **UnifiedHookConfigLoader** observations — implements a three-tier cascade (`DEFAULT_CONFIG` → `~/.coding-tools/hooks.json` → `.coding/hooks.json`) merged via `mergeConfigs()`. The `HookConfig` JSDoc typedef in `hooks-api.js` documents `userConfigPath` and `projectConfigPath` matching this cascade exactly, suggesting `HooksManager`'s constructor config shape is designed to be populated by `HookConfigLoader`'s merged output — even though no direct import coupling exists between the files.

Downstream, `claude-bridge.js` integrates with `hook-manager.js` via `getHookManager()` and `executeHooks(unifiedContext.event, unifiedContext, 'claude')`, making this the true runtime consumer of translated events rather than `HooksManager` itself. Sibling **HookConfigMigrationTool** presumably operates on the same config paths described in the `HookConfig` typedef, though no direct evidence links it to the translation maps specifically.

Notably, the same "merge partial data over hardcoded defaults" pattern recurs independently in `integrations/system-health-dashboard/src/components/workflow/hooks.ts`'s `useWorkflowDefinitions()`, which spreads `{...STEP_TO_AGENT, ...(stepToAgent || {})}`. This is architecturally analogous to `HookConfigLoader`'s cascade but implemented ad hoc in an unrelated dashboard subsystem, suggesting this merge convention is not a shared, reusable utility across the codebase.

## Usage Guidelines

Developers modifying event names must update **both** `EVENT_MAPPINGS` (hooks-api.js) and `EVENT_MAP` (claude-bridge.js) manually, since there is no shared source of truth — a change to one map without the other will silently desynchronize the two translation directions. Before assuming `EVENT_MAPPINGS`/`HooksManager.translateEvent()` governs live Claude event handling, verify whether `hook-manager.js` (the actual execution path) uses it at all, since current evidence suggests it does not.

When extending `EVENT_MAP` or `EVENT_MAPPINGS`, consider that `null` entries in `EVENT_MAPPINGS` are ambiguous between "not supported" and "not yet wired" — this should be clarified with explicit sentinel values or comments rather than left implicit. Given the fail-open design, any new translation logic should be validated defensively before deployment, since bridge failures during translation will not surface as errors but will silently default to `'allow'`. Finally, if extending decision semantics beyond binary allow/block (e.g., adding `'warn'`), the inline ternary in `transformResponse()` should be converted to an explicit table to maintain consistency with the request-direction design.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- claude-bridge.js's `main()` function never actually uses the `HooksManager` class or its `translateEvent()`/`EVENT_MAPPINGS` from hooks-api.js — instead it does its own translation via the local `EVENT_MAP` and then imports `getHookManager` from `./hook-manager.js` (a third file not shown here) and calls `manager.executeHooks(unifiedContext.event, unifiedContext, 'claude')`. This confirms the parent-context hypothesis that hook-manager.js is the actual runtime consumer, while HooksManager's abstract subclass contract (`getAgentType`, `loadNativeHooks`, `saveNativeHooks`, enforced via `new.target === HooksManager` in the constructor) appears to be a parallel, currently-unconsumed-by-the-bridge abstraction — meaning `EVENT_MAPPINGS` in hooks-api.js may be entirely dead code from the perspective of this call path.

**Other:**
- Two independent event-translation maps exist in the hooks subsystem: `EVENT_MAPPINGS` in lib/agent-api/hooks-api.js (keyed by agent type `claude`/`copilot`, mapping unified `HookEvent` enum values to native event names) and `EVENT_MAP` in lib/agent-api/hooks/claude-bridge.js (a flat, claude-only, inverse-direction map from native Claude event names like 'PreToolUse' back to unified strings like 'pre-tool'). These are structurally opposite translations of the same vocabulary maintained in two separate files with no shared source of truth — hooks-api.js's `translateEvent()` goes unified→native, while claude-bridge.js's `transformContext()` goes native→unified, and a change to one event name (e.g. renaming 'pre-tool' to 'preTool') would require manually finding and updating both maps or the two systems would silently desynchronize.
- `EVENT_MAPPINGS` in hooks-api.js has structurally asymmetric coverage between the `claude` and `copilot` agent keys: `claude`'s `PRE_PROMPT`/`POST_PROMPT`/`ERROR` are all `null` with comments '// New via hook', while `copilot`'s equivalents are populated ('userPromptSubmitted', `null`, 'errorOccurred'). Combined with the unrelated code-graph evidence in tests/features/cli-and-rules-gating.test.mjs asserting version-adaptive Copilot hook schemas ({version:1, hooks:{...}}), this suggests the translation map's `null` entries are a deliberate 'not yet wired for this agent' placeholder rather than 'this event cannot exist for this agent' — a distinction `translateEvent()`'s `mapping[event] || null` return doesn't preserve, so a caller can't tell 'unsupported' from 'not yet implemented' from the map alone.


## Hierarchy Context

### Parent
- [HookConfigLoader](./HookConfigLoader.md) -- [CGR] HookConfigLoader (class) in hook-config.js

### Siblings
- [UnifiedHookConfigLoader](./UnifiedHookConfigLoader.md) -- [LLM+CGR] Per the parent context, HookConfigLoader (hook-config.js) is the sole named entity in the code graph for that file, implementing a three-tier cascade (DEFAULT_CONFIG → ~/.coding-tools/hooks.json → .coding/hooks.json) merged via mergeConfigs(). No implementation of hook-config.js itself is present in this component's code files, so its internal merge semantics (array concatenation vs. override, deep vs. shallow merge) remain unverified — the only concrete evidence available here is the consuming code in lib/agent-api/hooks-api.js and lib/agent-api/hooks/claude-bridge.js, which describe the config's downstream effects rather than its construction.
- [HookConfigMigrationTool](./HookConfigMigrationTool.md) -- [LLM+CGR] The parent context establishes that HookConfigLoader (hook-config.js) implements a three-tier cascade (DEFAULT_CONFIG → ~/.coding-tools/hooks.json → .coding/hooks.json merged via mergeConfigs()), and the actual JSDoc typedef for HookConfig in lib/agent-api/hooks-api.js corroborates this exactly: `@typedef {Object} HookConfig` documents `userConfigPath` ('Path to user-level config (~/.coding-tools/hooks.json)') and `projectConfigPath` ('Path to project-level config (.coding/hooks.json)'). This is strong cross-file evidence that HooksManager's constructor config shape was designed to be populated by HookConfigLoader's merged output, even though hooks-api.js never imports or references HookConfigLoader directly — the two files agree on a contract without any visible coupling in the code shown.
- [HandlerPriorityRegistry](./HandlerPriorityRegistry.md) -- [LLM] The component name 'HandlerPriorityRegistry' does not correspond to any class, function, or export literally present in the provided code files (hooks-api.js, claude-bridge.js, hooks.ts, usePolledFetch.ts, cli-and-rules-gating.test.mjs) or in the parent's code graph evidence, which is empty for this component. The closest conceptual match is the priority-sorted 'eventHooks' array inside HooksManager.registerHook() in lib/agent-api/hooks-api.js, where hooks are pushed into a Map<event, RegisteredHook[]> and immediately re-sorted via eventHooks.sort((a, b) => a.priority - b.priority). This suggests HandlerPriorityRegistry is likely a documentation/summary label for that in-memory priority-sorted structure rather than a distinct class, and a developer should verify whether it maps to hooks-api.js's Map or to a similarly named construct in hook-manager.js (not shown here).


---

*Generated from 9 observations*
