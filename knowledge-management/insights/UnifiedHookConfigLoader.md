# UnifiedHookConfigLoader

**Type:** Detail

# UnifiedHookConfigLoader — Technical Insight Document

## What It Is

UnifiedHookConfigLoader sits within the hook subsystem as a child of `UnifiedHookManager` (defined in `lib/agent-api/hooks/hook-manager.js`), alongside sibling components `HandlerRegistry`, `ClaudeBridgeAdapter`, and `HookMigrationTool`. While the specific loader implementation file is not present in this observation bundle, its position in the hierarchy — nested under `UnifiedHookManager` and grouped with `HandlerRegistry` and adapters — indicates its role is configuration ingestion and normalization for the unified hook dispatch pipeline that ultimately feeds `HooksManager`-style registries (`lib/agent-api/hooks-api.js`) and agent-specific bridges like `claude-bridge.js` (`lib/agent-api/hooks/claude-bridge.js`). Because `HookConfigLoader` also "contains" `UnifiedHookConfigLoader` per the entity relationships, this component is best understood as the unified/multi-agent specialization of a more general config-loading concept, mirroring the same abstract/concrete split seen in `HooksManager`.

## Architecture and Design

The surrounding subsystem is built from well-established patterns that constrain how a config loader must behave. `HooksManager` (`lib/agent-api/hooks-api.js`) is an explicit Template Method / Abstract Base Class — its constructor throws on direct instantiation (`new.target === HooksManager`), deferring `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()` to subclasses. `UnifiedHookConfigLoader`, as a sibling of `HandlerRegistry` under `UnifiedHookManager`, likely exists to supply the configuration data (event mappings, registered handler definitions, priorities) that `loadNativeHooks()`/`saveNativeHooks()`-style methods would consume or produce, without itself owning dispatch logic — that responsibility belongs to `HandlerRegistry` and the manager's `Map<event, Handler[]>` structures.

A recurring architectural risk flagged across sibling observations is duplication: `EVENT_MAP` in `claude-bridge.js:33-41` and `EVENT_MAPPINGS` in `hooks-api.js:35-52` are independently maintained tables translating event names per agent. Any config loader in this space must be evaluated against this duplication risk — if `UnifiedHookConfigLoader` maintains yet another translation or schema table, it becomes a third synchronization point for lifecycle event names, compounding the existing risk noted in Architecture Notes ("Event-name translation is duplicated across at least two independently maintained tables").

The fail-open philosophy pervasive in `ClaudeBridgeAdapter` and `HookMigrationTool` (both wrapping `main()`'s pipeline in a single outer try/catch that always resolves to `process.exit(0)` with `decision: 'allow'`) sets an implicit contract for anything upstream, including config loading: a malformed or missing configuration should not crash the bridge or block a tool call, it should degrade to a permissive default. This means `UnifiedHookConfigLoader`, if invoked during `manager.initialize()` in the bridge's pipeline (readStdin → transformContext → import hook-manager.js → initialize/executeHooks → transformResponse), inherits the same masking problem: a config load failure is likely indistinguishable from "no config, hook explicitly allowed."

## Implementation Details

No source lines for `UnifiedHookConfigLoader` itself appear in the observations, so implementation specifics cannot be confirmed from this bundle. However, its expected neighbors provide strong structural context: `HooksManager.registerHook()` validates `event` membership against `Object.values(HookEvent)` and `handler` type, generates non-deterministic default IDs (`Date.now()-${random}`), and maintains priority ordering via `eventHooks.sort((a, b) => a.priority - b.priority)` on every registration. If `UnifiedHookConfigLoader` is responsible for hydrating handlers from persisted/native config into this registry, it must supply IDs and priorities consistent with this sort-on-insert model, and it inherits the same lack of upsert semantics — reloading a config twice without deliberate ID tracking would append duplicate entries rather than replace them, per the `unregisterHook()` linear `findIndex` search behavior.

Given `translateEvent()`'s behavior in `hooks-api.js:140-148` (throws on unknown agent type, silently returns `null` on unknown individual event via `mapping[event] || null`), any config loader translating raw configuration into `HookEvent` values should be scrutinized for whether it propagates or swallows equivalent gaps — silent `null` events downstream can mask genuine unsupported-event conditions, as already noted for `copilot`'s `POST_PROMPT`.

## Integration Points

`UnifiedHookConfigLoader`'s placement under `UnifiedHookManager` ties it directly to the parent's dispatch machinery, and by extension to the `getHookManager()` singleton that `ClaudeBridgeAdapter`'s `main()` lazily imports (`import('./hook-manager.js')`) on each invocation. As a stateless per-invocation translation layer, `claude-bridge.js` does not own hook state itself — it defers entirely to the singleton, meaning any configuration `UnifiedHookConfigLoader` loads must already be resident or loadable by the time `manager.initialize()`/`executeHooks()` runs within the bridge's single 1000ms-bounded execution window (cf. `readStdin()`'s timeout race, lines 47-68).

It also sits conceptually alongside `HandlerRegistry`, which documents the same open question raised for `HooksManager` more broadly: whether `UnifiedHookManager` extends `HooksManager` or is a parallel, non-inheriting reimplementation. Since `UnifiedHookConfigLoader` is a child of `UnifiedHookManager` specifically (not of `HooksManager`), it likely only needs to satisfy `UnifiedHookManager`'s expectations, but if the two managers are meant to converge, `UnifiedHookConfigLoader` may become a bridge point for supplying config to whichever concrete `HooksManager` subclass is active.

Finally, `HookMigrationTool` as a sibling suggests a direct producer/consumer relationship: migration tooling likely writes or transforms configuration that `UnifiedHookConfigLoader` subsequently reads, making format compatibility between the two siblings a priority.

## Usage Guidelines

Because the surrounding subsystem is explicitly fail-open — bridge and manager code paths collapse errors into permissive `allow` decisions — any code path through `UnifiedHookConfigLoader` should treat configuration errors as high-severity operationally even though they are low-severity functionally (the system keeps running). Developers should ensure config load failures are logged loudly (mirroring `ClaudeBridgeAdapter`'s reliance on `logger.error('Bridge execution failed', ...)`) since monitoring cannot rely on exit codes or the `allow`/`deny` decision to detect a broken loader.

Given the demonstrated absence of a sanitization boundary in `transformContext()` (raw `tool_input` spread unfiltered into `metadata`), any config-driven handler wiring done by `UnifiedHookConfigLoader` should not assume upstream data has been redacted — if config controls which handlers see which context fields, it is the last realistic place to introduce filtering before third-party `hook.handler(fullContext)` calls receive raw tool arguments.

Finally, avoid conflating this subsystem with the unrelated React `hooks.ts`/`usePolledFetch.ts` files in `integrations/system-health-dashboard`, which are explicitly flagged as a naming collision with no code relationship to `HookEvent`, `HooksManager`, or `UnifiedHookManager` — greps and future graph queries for "hooks" should filter by these directory paths to avoid false coupling.


## Hierarchy Context

### Parent
- [UnifiedHookManager](./UnifiedHookManager.md) -- [CGR] UnifiedHookManager (class) in hook-manager.js

### Siblings
- [HandlerRegistry](./HandlerRegistry.md) -- [LLM] lib/agent-api/hooks-api.js defines an abstract `HooksManager` base class whose constructor throws if instantiated directly (`if (new.target === HooksManager) throw new Error(...)`), establishing a template-method pattern where `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()` are abstract stubs that throw 'must be implemented by subclass'. This is a classic Gang-of-Four abstract base class, but the parent-context observations note that `UnifiedHookManager` in `lib/agent-api/hooks/hook-manager.js` independently implements the same `Map<event, Handler[]>` + priority-sort registration pattern, raising the question of whether `UnifiedHookManager` actually extends `HooksManager` or is a parallel reimplementation — the code shown here gives no `extends` clause to confirm inheritance.
- [ClaudeBridgeAdapter](./ClaudeBridgeAdapter.md) -- [LLM+CGR] claude-bridge.js's `main()` function (lib/agent-api/hooks/claude-bridge.js:123-159) implements a strict linear pipeline — readStdin() → transformContext() → dynamic `import('./hook-manager.js')` → manager.initialize()/executeHooks() → transformResponse() — and every stage is wrapped in one outer try/catch that funnels ALL failures (JSON parse errors from readStdin, import failures, initialize() throwing, executeHooks() throwing) into the same fail-open response: `{decision: 'allow', message: 'Hook bridge error: ...'}` with `process.exit(0)`. This means a bug in transformContext() and a missing hook-manager.js module are observationally indistinguishable to Claude Code itself — both silently allow the tool call — so operators must rely on the `logger.error('Bridge execution failed', ...)` call to distinguish causes, and any monitoring built on top of this bridge needs to tail logs rather than trust the adapter's own exit code/stdout.
- [HookMigrationTool](./HookMigrationTool.md) -- [LLM] claude-bridge.js's main() function (lib/agent-api/hooks/claude-bridge.js) implements a strict linear pipeline — readStdin() → transformContext() → dynamic import of hook-manager.js's getHookManager() → manager.executeHooks() → transformResponse() — and every exit path, including the catch block, terminates with process.exit(0) and a JSON write to stdout. This is a deliberate fail-open contract: even a JSON.parse failure in readStdin() (line ~60, 'Failed to parse stdin JSON') or an exception inside executeHooks() results in `{decision: 'allow', message: 'Hook bridge error: ...'}` rather than a non-zero exit, meaning Claude Code's PreToolUse/PostToolUse gate can never be blocked by a bridge-level bug — only by an explicit `allow: false` returned from a properly executing hook handler.


---

*Generated from 10 observations*
