# HookConfigLoader

**Type:** SubComponent

# HookConfigLoader — Technical Insight Document

## What It Is

HookConfigLoader is a class implemented in `lib/agent-api/hooks/hook-config.js`, and it is the sole named entity present in the code graph for that file. As a member of the ConstraintSystem, its role is to load and resolve hook configuration through a three-tier cascade: a baked-in `DEFAULT_CONFIG`, user-level overrides from `~/.coding-tools/hooks.json`, and project-level settings from `.coding/hooks.json`, all reconciled through a `mergeConfigs()` function. This positions HookConfigLoader as a configuration-resolution layer that sits upstream of runtime hook dispatch — it determines *what* hooks and constraints should apply before any hook manager actually executes handlers.

Importantly, no direct code-graph evidence of HookConfigLoader's internal implementation exists beyond its class name and file path; the merge semantics described here are inherited from prior analysis at the ConstraintSystem (parent) level and corroborated indirectly by consumer code, not observed directly in hook-config.js.

## Architecture and Design

![HookConfigLoader — Architecture](images/hook-config-loader-architecture.png)

The hooks subsystem exhibits two distinct extensibility philosophies coexisting side by side. HookConfigLoader represents a **layered configuration cascade pattern** — config-driven, standalone, without any subclassing contract. This contrasts sharply with the abstract `HooksManager` base class in `lib/agent-api/hooks-api.js`, which enforces a **Template Method pattern** via `new.target === HooksManager` guards and abstract methods (`getAgentType`, `loadNativeHooks`, `saveNativeHooks`) that concrete agent adapters must implement. HookConfigLoader is not part of that inheritance hierarchy; it is a separate, earlier-loaded layer that feeds initial state into runtime hook managers.

Strong indirect evidence of the intended contract comes from the `HookConfig` JSDoc typedef in hooks-api.js, which documents `userConfigPath` and `projectConfigPath` fields matching HookConfigLoader's tiers exactly — even though hooks-api.js never imports HookConfigLoader directly. This is a design-by-convention coupling rather than a code-level one, and it's a gap worth closing during any refactor.

A related architectural concern is the apparent duplication of hook-registry logic between `HooksManager` (hooks-api.js) and `UnifiedHookManager` (hook-manager.js), both of which maintain priority-sorted handler arrays re-sorted on every `registerHook()` call. It remains unclear whether HookConfigLoader's merged output feeds both systems or only one — a significant ambiguity since claude-bridge.js (the runtime consumer) calls `getHookManager()` from hook-manager.js exclusively, not the abstract `HooksManager` from hooks-api.js.

## Implementation Details

Since hook-config.js's internals aren't directly visible in the code graph, implementation understanding relies on the documented three-tier merge: DEFAULT_CONFIG → user config → project config, with `mergeConfigs()` performing the reconciliation. Per parent-level analysis, this merge is not uniformly deep/recursive — array-type handler lists may be concatenated or replaced depending on the key, meaning careless changes could silently drop user-level handlers.

Children of HookConfigLoader illuminate related but distinct concerns rather than internal mechanics: **UnifiedHookConfigLoader** reiterates that the true merge semantics (array concat vs. override) remain unverified from code alone. **EventTranslationMaps** documents two independently-maintained translation tables — `EVENT_MAPPINGS` in hooks-api.js (unified→native, keyed by agent type) and `EVENT_MAP` in claude-bridge.js (native→unified, Claude-only) — which have no shared source of truth and risk desynchronization. **HookConfigMigrationTool** cross-validates the config path contract via the `HookConfig` typedef. **HandlerPriorityRegistry** does not map to any literal class or export; it's best understood as a documentation label for the priority-sorted `eventHooks` array inside `HooksManager.registerHook()`, which pushes into a `Map<event, RegisteredHook[]>` and immediately re-sorts by priority — a low-frequency O(n log n) cost incurred at registration time rather than dispatch time.

## Integration Points

![HookConfigLoader — Relationship](images/hook-config-loader-relationship.png)

HookConfigLoader's most concrete downstream consumer is the runtime dispatch path exercised by `claude-bridge.js`, which dynamically imports hook-manager.js and calls `getHookManager()`, lazily invoking `initialize(projectPath)` before executing hooks via `executeHooks()`. If HookConfigLoader's merge happens inside that `initialize()` call, a critical interaction emerges: claude-bridge.js's `main()` is fail-open, catching all errors and returning `decision: 'allow'`. Any exception during config loading or merging would therefore be silently treated as an allowed operation — a security-relevant detail given that constraint enforcement depends on hooks actually firing.

Sibling `UnifiedHookManager` (hook-manager.js) and `HooksManager` (hooks-api.js, sibling context via <AWS_SECRET_REDACTED>) both maintain independent Map-based priority registries that HookConfigLoader's merged config presumably seeds, though the exact consumption path is unverified. Additionally, `triggerHook()` in hooks-api.js executes handlers sequentially without stopping on a block signal — meaning a project-level constraint merged in by HookConfigLoader could have its `allow: false` effectively overridden by a later, lower-priority handler, undermining assumptions of "first-block-wins" semantics.

## Usage Guidelines

Developers extending HookConfigLoader or modifying hook-config.js should first inspect the file directly rather than relying solely on this document, since internal merge logic (array concatenation vs. replacement, DEFAULT_CONFIG contents) is not directly evidenced in the code graph. Before adding a new hook type, verify `mergeConfigs()` behavior to avoid silently dropping user-level handlers — project settings should be able to enforce mandatory constraints over user preferences, but not vice versa, per the intended cascade design.

Because two parallel hook-registry implementations may exist (HooksManager vs. UnifiedHookManager), confirm which one(s) actually consume HookConfigLoader's merged output before assuming user/project settings apply system-wide. Also account for the fail-open error handling in claude-bridge.js: any config-loading failure is currently indistinguishable from a legitimate "allow" decision, which has real implications for constraint enforcement and ViolationCaptureService reliability. Finally, remember that EventTranslationMaps' two independent event-name mappings must be kept manually synchronized — a renamed event key requires coordinated updates in both hooks-api.js and claude-bridge.js.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- HookConfigLoader (class) in hook-config.js

**Other:**
- HookConfigLoader is the sole named entity in the code graph for hook-config.js, and per the parent context it implements a three-tier cascade (DEFAULT_CONFIG, user ~/.coding-tools/hooks.json, project .coding/hooks.json) merged via mergeConfigs(). This is architecturally distinct from the sibling HooksManager abstraction in lib/agent-api/hooks-api.js, which manages an in-memory Map<event, RegisteredHook[]> registry but has no analogous multi-tier file-based config resolution — suggesting HookConfigLoader is a separate, earlier-loaded configuration layer that feeds initial state into runtime hook managers rather than being merged into the same class hierarchy.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- [LLM] The configuration merging strategy in HookConfigLoader (lib/agent-api/hooks/hook-config.js) implements a three-tier cascade — DEFAULT_CONFIG baked into the code, user-level settings from ~/.coding-tools/hooks.json, and project-level settings from .coding/hooks.json — resolved through mergeConfigs(). This design lets individual developers set personal defaults (e.g., preferred logging verbosity or disabled hooks) while allowing a project to enforce mandatory constraints that override user preferences, but not vice versa. A new developer extending this system needs to understand that the merge is not a deep recursive merge in all cases; array-type handler lists are typically concatenated or replaced depending on the key, so adding a new hook type requires checking mergeConfigs() logic to avoid silently dropping user-level handlers.

### Children
- [UnifiedHookConfigLoader](./UnifiedHookConfigLoader.md) -- [LLM+CGR] Per the parent context, HookConfigLoader (hook-config.js) is the sole named entity in the code graph for that file, implementing a three-tier cascade (DEFAULT_CONFIG → ~/.coding-tools/hooks.json → .coding/hooks.json) merged via mergeConfigs(). No implementation of hook-config.js itself is present in this component's code files, so its internal merge semantics (array concatenation vs. override, deep vs. shallow merge) remain unverified — the only concrete evidence available here is the consuming code in lib/agent-api/hooks-api.js and lib/agent-api/hooks/claude-bridge.js, which describe the config's downstream effects rather than its construction.
- [EventTranslationMaps](./EventTranslationMaps.md) -- [LLM+CGR] Two independent event-translation maps exist in the hooks subsystem: `EVENT_MAPPINGS` in lib/agent-api/hooks-api.js (keyed by agent type `claude`/`copilot`, mapping unified `HookEvent` enum values to native event names) and `EVENT_MAP` in lib/agent-api/hooks/claude-bridge.js (a flat, claude-only, inverse-direction map from native Claude event names like 'PreToolUse' back to unified strings like 'pre-tool'). These are structurally opposite translations of the same vocabulary maintained in two separate files with no shared source of truth — hooks-api.js's `translateEvent()` goes unified→native, while claude-bridge.js's `transformContext()` goes native→unified, and a change to one event name (e.g. renaming 'pre-tool' to 'preTool') would require manually finding and updating both maps or the two systems would silently desynchronize.
- [HookConfigMigrationTool](./HookConfigMigrationTool.md) -- [LLM+CGR] The parent context establishes that HookConfigLoader (hook-config.js) implements a three-tier cascade (DEFAULT_CONFIG → ~/.coding-tools/hooks.json → .coding/hooks.json merged via mergeConfigs()), and the actual JSDoc typedef for HookConfig in lib/agent-api/hooks-api.js corroborates this exactly: `@typedef {Object} HookConfig` documents `userConfigPath` ('Path to user-level config (~/.coding-tools/hooks.json)') and `projectConfigPath` ('Path to project-level config (.coding/hooks.json)'). This is strong cross-file evidence that HooksManager's constructor config shape was designed to be populated by HookConfigLoader's merged output, even though hooks-api.js never imports or references HookConfigLoader directly — the two files agree on a contract without any visible coupling in the code shown.
- [HandlerPriorityRegistry](./HandlerPriorityRegistry.md) -- [LLM] The component name 'HandlerPriorityRegistry' does not correspond to any class, function, or export literally present in the provided code files (hooks-api.js, claude-bridge.js, hooks.ts, usePolledFetch.ts, cli-and-rules-gating.test.mjs) or in the parent's code graph evidence, which is empty for this component. The closest conceptual match is the priority-sorted 'eventHooks' array inside HooksManager.registerHook() in lib/agent-api/hooks-api.js, where hooks are pushed into a Map<event, RegisteredHook[]> and immediately re-sorted via eventHooks.sort((a, b) => a.priority - b.priority). This suggests HandlerPriorityRegistry is likely a documentation/summary label for that in-memory priority-sorted structure rather than a distinct class, and a developer should verify whether it maps to hooks-api.js's Map or to a similarly named construct in hook-manager.js (not shown here).

### Siblings
- [UnifiedHookManager](./UnifiedHookManager.md) -- [CGR] UnifiedHookManager (class) in hook-manager.js
- [KnowledgeInjectionHooks](./KnowledgeInjectionHooks.md) -- [LLM] lib/agent-api/hooks-api.js defines an abstract `HooksManager` base class whose `registerHook()` method pushes a new hook into `this.hooks.get(event)` and then immediately calls `eventHooks.sort((a, b) => a.priority - b.priority)` on every single registration. This re-sort-on-insert strategy means the handler array is always kept in priority order rather than being sorted lazily at dispatch time in `triggerHook()`. The cost is O(n log n) per registration instead of amortizing the sort to a single O(n log n) pass before the first dispatch, which is a reasonable trade-off only because hook registration is a low-frequency, mostly-startup-time operation while `triggerHook()` (invoked per tool call) stays a cheap linear scan.
- [HealthPromptHook](./HealthPromptHook.md) -- [LLM] HooksManager in lib/agent-api/hooks-api.js is an abstract base class (constructor throws if `new.target === HooksManager`) that centralizes the unified hook registry as a `Map<string, RegisteredHook[]>`, seeded in the constructor by iterating `Object.values(HookEvent)` so every event key exists even before any handler is registered. This mirrors the parent observation about UnifiedHookManager's Map<event, HookHandler[]> registry, but hooks-api.js is the older/more generic abstraction layer: it defines `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()` as abstract methods subclasses must implement, meaning the actual Claude/Copilot-specific behavior (reading ~/.claude/settings.json vs .github/hooks/hooks.json) lives outside this file entirely, in whatever concrete class extends HooksManager.


---

*Generated from 10 observations*
