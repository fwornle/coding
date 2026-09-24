# UnifiedHookManager

**Type:** SubComponent

## What It Is

UnifiedHookManager is a class identified by the code graph in `lib/agent-api/hooks/hook-manager.js`, within the `lib/agent-api/hooks/` directory that also houses `claude-bridge.js`. It functions as the shared, lazily-initialized dispatcher for the constraint/hook system, accessed through a singleton accessor `getHookManager()` and exposing at least two consumer-facing methods confirmed by usage in `claude-bridge.js`: `initialize(projectPath)` and `executeHooks(event, context, agentType)`. Critically, none of the retrieved files contain the actual body of `hook-manager.js` — its internal `Map<HookEvent, HookHandler[]>` registration/sort/dispatch logic (as attributed by parent-context observations) cannot be verified against source in this pass. Everything below distinguishes what is directly evidenced from what is inferred by analogy.

As a SubComponent, UnifiedHookManager sits beneath ConstraintSystem, alongside siblings HookConfigLoader, ViolationCaptureService, HealthPromptHook, and KnowledgeInjectionHooks, and it contains two children of its own: ClaudeBridge and UnifiedHookManagerConfigLoading.

![UnifiedHookManager — Architecture](images/unified-hook-manager-architecture.png)

## Architecture and Design

The clearest architectural pattern in evidence is a **bridge/adapter** sitting in front of UnifiedHookManager: `claude-bridge.js` (implemented as the child component ClaudeBridge) translates Claude Code's native `PreToolUse`/`PostToolUse`-style stdin JSON events into a unified event vocabulary before calling `executeHooks()`. Its `EVENT_MAP` hard-codes seven Claude-native event names (PreToolUse, PostToolUse, Startup, Shutdown, PrePrompt, PostPrompt, Error) to unified lowercase-hyphen equivalents, falling back to `nativeEvent.toLowerCase()` for anything unmapped — a deliberate looseness that trades correctness for non-blocking behavior rather than erroring on unknown events.

A second pattern, evidenced in the sibling file `hooks-api.js`, is an **abstract base class / template method** structure: `HooksManager` pre-populates a `Map` for every `HookEvent` in its constructor and requires subclasses to implement `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()`. This is structurally identical to the eager pre-population and push-then-sort-by-priority idiom described for UnifiedHookManager, but it is a *different class in a different file* with a different method surface (`registerHook`/`unregisterHook`/`triggerHook` vs. `initialize`/`executeHooks`). Whether UnifiedHookManager subclasses `HooksManager` or independently reuses the same idiom cannot be determined from the files retrieved — this is flagged rather than assumed.

A third recurring pattern is **fail-open error handling**, applied consistently across the hook pipeline: `HookConfigLoader` uses it at the config-parsing boundary, and `claude-bridge.js`'s `main()` catch block applies the same philosophy one layer up, at the dispatch boundary — any exception during manager initialization or hook execution is logged and answered with `{decision: 'allow', ...}` followed by `process.exit(0)`, ensuring a broken hook manager never blocks a Claude Code tool call.

![UnifiedHookManager — Relationship](images/unified-hook-manager-relationship.png)

## Implementation Details

The concrete mechanics visible from `claude-bridge.js` are: a dynamic import — `const { getHookManager } = await import('./hook-manager.js')` — decoupling the bridge script's startup from the manager module's load; a guarded initialization — `if (!manager.initialized) { await manager.initialize(projectPath); }`; and dispatch via `await manager.executeHooks(unifiedContext.event, unifiedContext, 'claude')`. ClaudeBridge's `main()` implements a three-stage pipeline: `readStdin()` parses Claude's JSON payload, `transformContext(claudeContext, nativeEvent)` maps it to the unified shape, and `transformResponse(unifiedResult)` converts the unified `{allow, messages}` result back to Claude's `{decision, message}` format.

By contrast, the analogous but distinct `HooksManager` in `hooks-api.js` shows what the internals of a Map-based hook registry look like in this codebase: the constructor runs `for (const event of Object.values(HookEvent)) { this.hooks.set(event, []); }`, and registration performs `eventHooks.push(hook); eventHooks.sort((a, b) => a.priority - b.priority);`. This is offered as the closest available analogue to UnifiedHookManager's internals, not a confirmed description of them.

The child component UnifiedHookManagerConfigLoading is explicitly a gap: no retrieved file shows what `initialize(projectPath)` actually does — whether it reads JSON/YAML config, or how it resolves project- vs. user-level paths remains unknown from source.

## Integration Points

UnifiedHookManager is contained by ConstraintSystem, and per the Statusline Click-Report Feature session record, UI dispatch logic for the tmux statusline's 'constraints' field lives in "HookManagementSystem" (the broader system this component family belongs to), opening or focusing the constraint-monitor dashboard tab that surfaces ViolationCaptureService's output — placing UI wiring one level removed from the violation data itself. A related session record on ETM entry selection for tmux pane badges also falls under this same architectural family, though it addresses a distinct concern (resolving the freshest ETM entry among project-singleton ETMs) rather than hook registration or dispatch.

Downstream, UnifiedHookManager's child ClaudeBridge is the sole confirmed integration point into Claude Code itself, translating between Claude's native hook protocol and the unified event model. Sibling HookConfigLoader presumably supplies configuration consumed via the `initialize()` call, though the wiring between them is not directly evidenced. KnowledgeInjectionHooks, another sibling, shares the same eager Map-initialization idiom via `hooks-api.js`'s `HooksManager`, suggesting a common structural vocabulary across hook-related siblings even where concrete class identity differs.

## Usage Guidelines

Callers should treat `getHookManager()` as the sole entry point, checking `manager.initialized` before invoking `initialize(projectPath)`, mirroring the guard pattern already used in `claude-bridge.js`. Any code dispatching through UnifiedHookManager should adopt the same fail-open posture demonstrated at the bridge boundary — catch exceptions around `executeHooks()` and degrade gracefully rather than propagating errors that could block agent tool calls.

Developers extending event handling should be cautious of the EVENT_MAP fallback behavior: unmapped native events silently degrade to a lowercased guess rather than failing loudly, which could produce silently-mismatched unified event names if Claude Code introduces new native events. Given the confirmed structural similarity but distinct identity of `hooks-api.js`'s `HooksManager`, developers should not assume UnifiedHookManager reuses that abstract base class's `registerHook`/`triggerHook` interface — its actual internals remain unverified pending direct access to `hook-manager.js`'s body. Finally, since UnifiedHookManagerConfigLoading's behavior is undocumented in source, any assumptions about config file format or path resolution should be validated directly against `hook-manager.js` before being relied upon elsewhere.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- UnifiedHookManager (class) in hook-manager.js

**Other:**
- The code graph identifies UnifiedHookManager as a class in lib/agent-api/hooks/hook-manager.js, and lib/agent-api/hooks/claude-bridge.js confirms this file exists and exports a getHookManager() singleton accessor with an initialize(projectPath) method and an executeHooks(event, context, agentType) method: `const { getHookManager } = await import('./hook-manager.js'); const manager = getHookManager();` followed by `if (!manager.initialized) { ... await manager.initialize(projectPath); }` and `await manager.executeHooks(unifiedContext.event, unifiedContext, 'claude')`. None of the retrieved files contain the actual body of hook-manager.js, so the Map<HookEvent, HookHandler[]> registration/sort/dispatch internals described in the parent context's observations cannot be verified against source in this pass.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The Statusline Click-Report Feature work record establishes that HookManagementSystem's click-to-focus behavior on the tmux statusline's 'constraints' field opens or focuses the constraint-monitor dashboard tab, with that wiring living inside HookManagementSystem rather than inside ConstraintSystem's own code — placing UI dispatch logic in the same architectural family as UnifiedHookManager, one level removed from the violation data it surfaces.
- The Tmux Pane Badge — ETM Entry Selection Logic work record, filed under HookManagementSystem, establishes that ETMs are project singletons rather than per-pane, and that tmux pane badges must resolve to the freshest ETM entry rather than a stale 'corpse' entry left over from a prior session sharing the same pane — a session-selection concern adjacent to, but distinct from, the hook registration/priority-dispatch logic UnifiedHookManager itself is described as implementing.

## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- [SESSION] The Statusline Click-Report Feature work record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the constraint-monitor dashboard tab, integrating ConstraintSystem output into the click-driven statusline UX

### Children
- [ClaudeBridge](./ClaudeBridge.md) -- [LLM] lib/agent-api/hooks/claude-bridge.js is the actual ClaudeBridge implementation, and its main() function shows a three-stage translation pipeline: readStdin() parses the JSON payload Claude Code writes to the hook process's stdin, transformContext(claudeContext, nativeEvent) maps it into a unified shape, and transformResponse(unifiedResult) converts the unified {allow, messages} result back into Claude's expected {decision: 'allow'|'block', message} shape. The EVENT_MAP constant hard-codes only seven Claude-native event names (PreToolUse, PostToolUse, Startup, Shutdown, PrePrompt, PostPrompt, Error) to unified lowercase-hyphen equivalents, with an unmapped fallback of `nativeEvent.toLowerCase()` in transformContext — so an event Claude Code introduces after this file was last updated silently degrades to a guessed unified name rather than erroring.
- [UnifiedHookManagerConfigLoading](./UnifiedHookManagerConfigLoading.md) -- [LLM] None of the retrieved files contain an implementation of a config-loading routine for UnifiedHookManager. lib/agent-api/hooks/claude-bridge.js only *calls* `manager.initialize(projectPath)` on the singleton returned by `getHookManager()` from './hook-manager.js' — it does not define what `initialize()` does, whether it reads a JSON/YAML config file, or how it resolves user-level vs project-level hook config paths. The parent entity's own observations already flag this: 'None of the retrieved files contain the actual body of hook-manager.js.' This pass inherits the same gap for the more specific ConfigLoading sub-component.

### Siblings
- [HookConfigLoader](./HookConfigLoader.md) -- [CGR] HookConfigLoader (class) in hook-config.js
- [ViolationCaptureService](./ViolationCaptureService.md) -- [SESSION] Statusline Click-Click-Report Feature work record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the constraint-monitor dashboard tab that displays this service's output.
- [HealthPromptHook](./HealthPromptHook.md) -- [SESSION] obs-api Service Lifecycle record notes an open, unresolved defect where a coverage metric denominator wrongly includes 'observations' and 'digests' entity types, skewing values this hook's summary could reflect.
- [KnowledgeInjectionHooks](./KnowledgeInjectionHooks.md) -- [LLM] lib/agent-api/hooks-api.js defines an abstract `HooksManager` base class whose constructor pre-populates `this.hooks` (a `Map<string, RegisteredHook[]>`) with an empty array for every value in the `HookEvent` enum, exactly mirroring the eager-initialization pattern the parent context attributes to `hook-manager.js`'s `UnifiedHookManager`. This is a distinct file from `hook-manager.js` — `hooks-api.js` exposes `registerHook()`/`unregisterHook()`/`triggerHook()` as a generic interface, while subclasses must implement `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()` (all of which throw 'must be implemented by subclass' if unimplemented here), so this file is the abstract contract rather than the concrete dispatcher.


---

*Generated from 9 observations*
