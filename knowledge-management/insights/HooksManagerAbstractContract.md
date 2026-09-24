# HooksManagerAbstractContract

**Type:** Detail

## What It Is

HooksManagerAbstractContract refers to the abstract `HooksManager` class defined in `lib/agent-api/hooks-api.js`. It is the base contract for the hook system that governs tool-call lifecycle events (PreToolUse, PostToolUse, Startup, Shutdown, Error) across different coding agents. As the parent component KnowledgeInjectionHooks describes, this class pre-populates `this.hooks` — a `Map<string, RegisteredHook[]>` — with an empty array for every value in the `HookEvent` enum at construction time, and exposes the generic operations `registerHook()`, `unregisterHook()`, and `triggerHook()`. It deliberately leaves `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()` unimplemented, throwing "must be implemented by subclass" errors, marking it as a pure abstract contract rather than a working manager. Notably, no concrete subclass is present in the supplied files; the actual dispatcher (`hook-manager.js` / `getHookManager`) lives elsewhere and is referenced only through a lazy dynamic import in `claude-bridge.js`.

## Architecture and Design

The dominant pattern is Template Method / Abstract Base Class: the base defines the algorithmic skeleton (registration, triggering, translation) while subclasses supply agent-specific identity and I/O behavior. Since the codebase is plain JavaScript rather than TypeScript, abstraction is enforced at runtime rather than compile time — the constructor's `if (new.target === HooksManager) throw new Error(...)` guard prevents direct instantiation, substituting for a static `abstract` keyword.

A second key pattern is the Adapter/Translation pattern implemented via `translateEvent()` and the `EVENT_MAPPINGS` table. This design cleanly splits responsibility: the abstract file owns the full event vocabulary (`HookEvent`) and the mapping data (`EVENT_MAPPINGS.claude`, `EVENT_MAPPINGS.copilot`), while subclasses own only the identity lookup key via `getAgentType()`. This is distinct from the sibling EventMappingsTable, which is simply the static `EVENT_MAPPINGS` object itself rather than a separate component.

Error handling follows a fail-open philosophy at multiple levels: `triggerHook()` wraps each hook invocation in its own try/catch so one failing hook doesn't block subsequent hooks for the same event, and this mirrors the process-level fail-open behavior in `claude-bridge.js`'s `main()`. This favors pipeline resilience over strict fail-fast correctness.

## Implementation Details

`registerHook()` performs strict up-front validation against `Object.values(HookEvent)` before pushing and sorting hooks by priority — a push-then-sort insertion strategy for a priority queue. `unregisterHook()` searches linearly via `findIndex`, and `getRegisteredHooks()` flattens `this.hooks.values()` into a single array for introspection/debugging. Together these three methods represent distinct access patterns (targeted lookup, full-map iteration, ID search) over one shared `Map` structure.

`triggerHook()` builds `fullContext` by spreading `...context` last, meaning caller-supplied fields silently override computed defaults (`event`, `agentEvent`, `agentType`, `sessionId`, `timestamp`) — a permissive design contrasted with the strict validation in `registerHook()`.

`translateEvent()` looks up `EVENT_MAPPINGS[agentType]`, where `EVENT_MAPPINGS.copilot` includes `POST_PROMPT: null` to mark it explicitly unsupported. This static table exists because, per the 'Copilot filesystem hooks no injection' finding, Copilot CLI's context-injection event name changes across versions (`postToolUse` on ≤1.0.71 vs. `userPromptSubmitted` on 1.0.72+) — the abstract contract has no version-aware resolution mechanism, only a fixed compile-time mapping.

## Integration Points

The concrete subclass referenced as `hook-manager.js`/`getHookManager` is loaded only via lazy dynamic import inside `claude-bridge.js`'s `main()`, keeping this abstract contract decoupled from any specific runtime instantiation. The sibling ClaudeBridgeTranslation component (`lib/agent-api/hooks/claude-bridge.js`) is the concrete bridge that translates Claude's native stdin/stdout protocol into the unified `HookContext` shape consumed by this contract's `triggerHook()`, via `transformContext()` and its own `EVENT_MAP`. This component is explicitly distinct from the KnowledgeInjectionHookFiltering sibling and the separate self-hosted Knowledge Management Pipeline — despite naming overlap around "hooks," this contract governs whether a tool call is allowed (lifecycle gating), not what knowledge content is injected into a prompt.

## Usage Guidelines

Developers must never instantiate `HooksManager` directly — always subclass and implement `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()`, since calling any of these on the base class throws by design. When calling `triggerHook()`, be cautious with caller-supplied `context` objects: because spread happens last, passing an `agentType` or `event` field will silently override computed values, unlike the stricter `registerHook()` path. When extending `EVENT_MAPPINGS` for new agents, remember that unsupported events should be explicitly marked `null` (as with Copilot's `POST_PROMPT`) rather than omitted, and that version-specific event-name differences (as with Copilot) are not automatically handled — callers must track agent versioning externally if needed.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The 'Coding-Tools Knowledge Management Pipeline' record describes a separate self-hosted KB system that injects relevant knowledge into agent prompts; hooks-api.js and claude-bridge.js in this component handle only tool-call lifecycle events (pre/post-tool, startup/shutdown, error) and contain no code path that reads from or writes to that KB pipeline, confirming these are adjacent but distinct subsystems despite both being called 'hooks'.
- The 'Copilot filesystem hooks no injection' record establishes that Copilot CLI's context-injection event name changes between versions (postToolUse on ≤1.0.71, userPromptSubmitted on 1.0.72+), which is why `EVENT_MAPPINGS.copilot` in hooks-api.js is a static table with `POST_PROMPT: null` marked unsupported rather than a version-aware resolver — the abstract contract as written has no mechanism to track installed Copilot version, only a fixed compile-time mapping.

## Hierarchy Context

### Parent
- [KnowledgeInjectionHooks](./KnowledgeInjectionHooks.md) -- [LLM] lib/agent-api/hooks-api.js defines an abstract `HooksManager` base class whose constructor pre-populates `this.hooks` (a `Map<string, RegisteredHook[]>`) with an empty array for every value in the `HookEvent` enum, exactly mirroring the eager-initialization pattern the parent context attributes to `hook-manager.js`'s `UnifiedHookManager`. This is a distinct file from `hook-manager.js` — `hooks-api.js` exposes `registerHook()`/`unregisterHook()`/`triggerHook()` as a generic interface, while subclasses must implement `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()` (all of which throw 'must be implemented by subclass' if unimplemented here), so this file is the abstract contract rather than the concrete dispatcher.

### Siblings
- [EventMappingsTable](./EventMappingsTable.md) -- [LLM] No file in the supplied set defines a component named 'EventMappingsTable' — no table/grid UI component, no React table renderer, and no data structure literally named that. The closest thematically-related artifact is `EVENT_MAPPINGS` in lib/agent-api/hooks-api.js:38-55, a plain JS object mapping unified `HookEvent` enum values to agent-native event name strings per agent type (`claude`, `copilot`). That is a static lookup table, not a UI or persistence component, and the filename match ('EventMappings' + 'Table') appears to be a substring/synonym collision from retrieval rather than an actual implementation of this entity.
- [ClaudeBridgeTranslation](./ClaudeBridgeTranslation.md) -- [LLM] lib/agent-api/hooks/claude-bridge.js is the concrete implementation of the ClaudeBridgeTranslation component: `transformContext(claudeContext, nativeEvent)` (claude-bridge.js:75-97) builds the unified `HookContext` shape by looking up `EVENT_MAP[nativeEvent]` (claude-bridge.js:34-42) and falling back to `nativeEvent.toLowerCase()` if the native event isn't one of the seven mapped names, then attaches `tool: { name, input, output }` only when `claudeContext.tool_name` is present (using `undefined` rather than an empty object so `manager.executeHooks` can distinguish tool events from lifecycle events), and spreads the raw `claudeContext` into `metadata` alongside `workingDirectory`/`projectPath` so nothing from Claude's native payload is silently dropped even though only a subset is promoted to typed fields.
- [KnowledgeInjectionHookFiltering](./KnowledgeInjectionHookFiltering.md) -- [LLM] The supplied files implement tool-call lifecycle hooks, not knowledge injection. lib/agent-api/hooks-api.js's `HooksManager` governs PreToolUse/PostToolUse/Startup/Shutdown/Error events via `registerHook()`/`triggerHook()`, and lib/agent-api/hooks/claude-bridge.js's `main()` bridges Claude Code's native stdin/stdout hook protocol into that same event vocabulary. Neither file selects, ranks, or filters knowledge-base content for insertion into an agent prompt — they decide whether a tool call is allowed, not what context an agent sees.


---

*Generated from 10 observations*
