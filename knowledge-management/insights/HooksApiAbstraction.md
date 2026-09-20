# HooksApiAbstraction

**Type:** Detail

# HooksApiAbstraction — Technical Insight Document

## What It Is

HooksApiAbstraction is centered on `lib/agent-api/hooks-api.js`, which defines an abstract `HooksManager` base class establishing the contract for agent-specific hook management: registering handlers, translating unified events to native agent events, and triggering hooks with context. It is deliberately implemented in vanilla JS with no TypeScript interfaces, relying on runtime `new.target` guards and throwing stub methods (`getAgentType()`, `loadNativeHooks()`, `saveNativeHooks()`) to enforce its Template Method contract.

Critically, this abstraction sits in tension with its own parent component, **UnifiedHookManager** (in `hook-manager.js`), whose concrete implementation exposes a divergent method (`executeHooks`) rather than `HooksManager`'s `triggerHook`. This strongly suggests hooks-api.js is either a legacy sketch or a parallel abstraction layer that was never fully reconciled with the actual production code path used by `claude-bridge.js`.

## Architecture and Design

The dominant pattern is **Template Method**: `HooksManager` implements shared logic (`triggerHook`, `registerHook`, `unregisterHook`) while deferring agent-specific behavior (native event names, persistence) to subclasses. This is complemented by a **Registry pattern** — a `Map<HookEvent, RegisteredHook[]>` populated via registration calls — and a **Bridge/Adapter pattern** realized in the sibling `ClaudeBridge`, which translates Claude-native payloads into the unified `HookContext` shape.

A **fail-open / graceful degradation** philosophy runs through both layers: `triggerHook()` catches errors per-handler without halting the loop, while `claude-bridge.js`'s `main()` wraps the entire execution and converts any failure into `{decision: 'allow', ...}` with `process.exit(0)`. This nested redundancy trades observability for robustness — systemic bugs surface only as a generic 'Hook bridge error' string with a zero exit code, easily lost in logs.

The **Singleton pattern**, via `getHookManager()`, ties `claude-bridge.js` to the concrete manager instance in `hook-manager.js` — bypassing the abstract `HooksManager` entirely, reinforcing the API-surface divergence noted above.

## Implementation Details

`translateEvent()` implements an intentionally asymmetric `EVENT_MAPPINGS` table: the `claude` mapping nulls out STARTUP, SHUTDOWN, PRE_PROMPT, POST_PROMPT, and ERROR, while `copilot` only nulls POST_PROMPT. The unified `HookEvent` enum is thus a superset built for forward compatibility, and callers must handle `null` translations gracefully.

`registerHook()` validates events against `Object.values(HookEvent)`, generates IDs via `hook-${event}-${Date.now()}-${Math.random()...}`, and re-sorts the entire per-event array (`eventHooks.sort(...)`) on every registration — an O(n log n) operation accepted as a simplicity/performance trade-off given expected low hook counts per event, mirrored in sibling **UnifiedHookManagerCore**'s own default-initialized Map of empty handler arrays per `HookEvent`.

In `claude-bridge.js`, `transformContext()` spreads the entire raw `claudeContext` into a `metadata` bag alongside explicit fields, allowing unvalidated pass-through of unknown keys — good for forward compatibility, but offering no schema guarantee to handlers. `readStdin()` races stdin's 'end' event against a bare `setTimeout(1000)` that resolves `{}` only if `!data`; the timeout is never cleared on early resolution (a minor dangling-timer issue), and as the sibling ClaudeBridge notes, this guard is dangerously narrow — partial-but-truthy data before a stall will hang the process indefinitely rather than falling back safely.

## Integration Points

HooksApiAbstraction's abstract contract is meant to be the parent-defining interface for concrete managers, but the actual runtime path from `claude-bridge.js` calls `manager.executeHooks(...)` against the singleton from `hook-manager.js`, not `triggerHook()` from this abstraction. This is the key integration risk: two structurally similar but API-incompatible layers coexist, and any future maintainer must determine which is authoritative before extending hook behavior. Persistence is entirely deferred — `loadNativeHooks`/`saveNativeHooks` are abstract stubs with no visible implementation in this component, meaning durability logic lives wholly in subclasses.

## Usage Guidelines

Developers should treat `translateEvent()`'s null returns as a first-class case, not an edge case — never assume a unified event has a native equivalent for every agent. When extending hook registration, be aware of the deliberate O(n log n) sort-on-every-insert design; it's fine at current scale but not intended for high-frequency registration churn. Most importantly, before adding new functionality, reconcile whether `HooksManager` (hooks-api.js) or `UnifiedHookManager`/`executeHooks` (hook-manager.js) is the intended extension point — treating hooks-api.js as authoritative when the runtime path uses the other could silently produce dead code. Finally, given the fail-open design at both handler and process levels, developers should not rely on exit codes or thrown errors for correctness signaling in hook pipelines; add explicit logging if observability is required, since failures degrade silently by design.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- hooks-api.js's abstract HooksManager class enforces its Template Method contract via `if (new.target === HooksManager) throw new Error(...)` in the constructor, then delegates getAgentType(), loadNativeHooks(), and saveNativeHooks() to subclasses via stub methods that throw 'must be implemented by subclass'. This is a textbook abstract base class pattern in vanilla JS (no TypeScript interfaces), relying entirely on runtime errors rather than compile-time checks to enforce the contract — a trade-off that keeps the module dependency-free but pushes contract violations to first-invocation rather than load time.
- The translateEvent() method in hooks-api.js reveals an intentional asymmetry in the unified event vocabulary: EVENT_MAPPINGS.claude nulls out STARTUP, SHUTDOWN, PRE_PROMPT, POST_PROMPT, and ERROR (delegated to launcher scripts/EXIT traps or simply unsupported), while EVENT_MAPPINGS.copilot only nulls POST_PROMPT. This means the HooksManager abstraction's HookEvent enum is a superset designed for forward compatibility across agents, and callers must handle `translateEvent()` returning null gracefully rather than assuming every unified event has a native equivalent.
- claude-bridge.js's main() function and hooks-api.js's triggerHook() implement two independent, structurally similar fail-open layers: the bridge wraps its entire execution in a try/catch that converts any thrown error (JSON parse failures in readStdin(), import failures for `./hook-manager.js`, etc.) into `{decision: 'allow', ...}` with `process.exit(0)`, while triggerHook() wraps each individual `hook.handler(fullContext)` invocation in its own try/catch and pushes a synthetic error message without stopping the loop. This nested fail-open design means a systemic hook-manager bug would produce a generic 'Hook bridge error' string with no non-zero exit code, making such failures easy to miss in agent session logs.
- There is a naming/API-surface discrepancy between the abstract HooksManager in hooks-api.js (which exposes `triggerHook(event, context)`) and claude-bridge.js's actual call `manager.executeHooks(unifiedContext.event, unifiedContext, 'claude')` against the object returned by `getHookManager()` from hook-manager.js. Combined with the parent-context note that UnifiedHookManager is the sole class in the code graph for this component, this suggests hooks-api.js may be a legacy or parallel abstraction sketch that was superseded by hook-manager.js's concrete singleton-based API, and the two files should be reconciled or one deprecated to avoid confusing future maintainers about which is the source of truth.
- registerHook() in hooks-api.js validates event membership against `Object.values(HookEvent)` and handler type before constructing the hook tuple, and always re-sorts the full per-event array with `eventHooks.sort((a, b) => a.priority - b.priority)` after every push — an O(n log n) operation on each registration rather than a sorted-insert. Given the expected scale (per-agent-type hook counts numbering in the single digits to low dozens per event), this is a deliberate simplicity-over-performance trade-off consistent with the parent-level annotation on UnifiedHookManager doing the same thing.


## Hierarchy Context

### Parent
- [UnifiedHookManager](./UnifiedHookManager.md) -- [CGR] UnifiedHookManager (class) in hook-manager.js

### Siblings
- [ClaudeBridge](./ClaudeBridge.md) -- [LLM] claude-bridge.js's readStdin() (lib/agent-api/hooks/claude-bridge.js:47-73) implements a race between the stdin 'end' event and a bare setTimeout(1000) fallback that resolves to '{}' only if no data has been received at all — note the guard is `if (!data)`, not a check against partial/incomplete data. If Claude's native hook writes a partial JSON payload and then stalls before closing stdin, the timeout won't fire (data is truthy) and the promise never resolves, leaving the bridge process hanging indefinitely rather than degrading to the empty-context fallback. This is a narrower safety net than the surrounding documentation and observations suggest.
- [UnifiedHookManagerCore](./UnifiedHookManagerCore.md) -- Constructor sets default userConfigPath to ~/.coding-tools/hooks.json and initializes a Map of empty handler arrays for every HookEvent


---

*Generated from 10 observations*
