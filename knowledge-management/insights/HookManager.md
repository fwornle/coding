# HookManager

**Type:** SubComponent

[LLM+CGR] The parent-context observation that registerHandler() re-sorts by priority so 'critical validation handlers... can be given low priority numbers to guarantee they execute before... telemetry handlers' is only partially visible in the adjacent hooks-api.js implementation: `eventHooks.sort((a, b) => a.priority - b.priority)` confirms ascending-priority-first ordering, and triggerHook()'s for-loop awaits each `hook.handler(fullContext)` sequentially with a try/catch per handler that logs-and-continues on error (`logger.error(...); messages.push(...); // Continue with other hooks even if one fails`). This means a failing high-priority (low-number) validation handler does NOT halt lower-priority handlers from still running — the loop always visits every registered hook regardless of an earlier handler's failure or its `allow: false` result, so 'allow' is only ever downgraded, never used to short-circuit remaining execution. A caller expecting an early-priority `allow: false` to skip subsequent handlers (e.g., stop a logging handler from firing after a security handler blocks) would be wrong; UnifiedHookManager's executeHooks() would need to independently implement short-circuiting for that guarantee to hold, since hooks-api.js's triggerHook() does not.

# HookManager — Technical Insight Document

## What It Is

HookManager is implemented as `UnifiedHookManager` in `lib/agent-api/hooks/hook-manager.js`, exposed through module-level `getHookManager()` and `resetHookManager()` functions rather than a directly-exported class. It sits beneath `ConstraintSystem` as the process-facing dispatch mechanism for hook execution, and its subordinate components — `HandlerRegistry`, `TieredConfigLoader`, and `ClaudeBridge` — represent the three functional layers that make it work: registration/ordering of handlers, tiered configuration loading, and the subprocess-facing adapter that Claude Code actually invokes.

Critically, `UnifiedHookManager` is *not* the same abstraction as the class-based `HooksManager` found in `lib/agent-api/hooks-api.js`. The two appear to be parallel, unreconciled hook systems: `hooks-api.js` defines an abstract base (`registerHook`/`triggerHook`, throwing on direct instantiation via `new.target === HooksManager`) while the actual runtime path used by `ClaudeBridge`'s `claude-bridge.js:main()` imports `getHookManager` from `hook-manager.js` and calls `executeHooks()` — a method name absent from `hooks-api.js`. This mismatch (`triggerHook` vs. `executeHooks`, `registerHook` vs. `registerHandler`) suggests `hooks-api.js` is either legacy or a separate lower-level primitive never inherited by `UnifiedHookManager`.

![HookManager — Architecture](images/hook-manager-architecture.png)

## Architecture and Design

The dominant pattern is singleton-with-explicit-reset: `getHookManager()` lazily constructs or returns a cached `UnifiedHookManager`, while `resetHookManager()` tears down shared state for test isolation. However, because `ClaudeBridge` (`claude-bridge.js`) is a `#!/usr/bin/env node` script re-spawned as a fresh subprocess on every single Claude Code tool event, the "singleton" only ever lives for the duration of one hook dispatch — `resetHookManager` is effectively dead weight on the runtime path and exists purely for test-suite teardown between cases, a strong signal the original design anticipated a persistent-process consumer that never materialized.

A second core pattern, visible concretely in the sibling `HooksManager` implementation but conceptually shared by `HandlerRegistry`, is the priority-sorted observer registry: handlers are bucketed per `HookEvent` and re-sorted by priority (`eventHooks.sort((a, b) => a.priority - b.priority)`) on every registration, letting validation/security handlers run before telemetry handlers by assignment of low priority numbers. Execution, however, does not short-circuit — `triggerHook()`'s per-handler try/catch logs and continues regardless of an earlier handler's failure or `allow: false`, meaning any short-circuit guarantee would have to be independently implemented inside `UnifiedHookManager.executeHooks()`.

The third defining pattern is a fail-open error boundary at the process boundary: `ClaudeBridge`'s `main()` wraps `initialize()` + `executeHooks()` in a try/catch that, on any failure, still emits `{ decision: 'allow', message: 'Hook bridge error: ...' }` and calls `process.exit(0)`. This is architecturally consistent with the warn-and-continue posture of sibling `HookConfigLoader.validateConfig()` — both layers favor availability over strict enforcement.

![HookManager — Relationship](images/hook-manager-relationship.png)

## Implementation Details

`TieredConfigLoader.initialize(projectPath)` loads user config first (`loadConfig(this.config.userConfigPath, 'user')`), then project config second, so project-level hooks can override user-level ones — a deliberate override-ordering decision baked into initialization sequence rather than a merge algorithm.

`HandlerRegistry`'s concrete analog in `hooks-api.js` pre-seeds an empty array per `HookEvent` enum value in the constructor (`this.hooks = new Map()`), and `registerHook()` wraps each handler in a `{ id, event, handler, priority, source }` record before re-sorting the full bucket — an O(n log n) re-sort per insertion that is functionally irrelevant at hook-system scale but signals a codebase optimized for correctness/readability over throughput.

`ClaudeBridge`'s `transformContext()` builds a metadata object where `workingDirectory`/`projectPath` are explicitly derived, then spreads the raw `claudeContext` *after* those keys — meaning any same-named field in Claude Code's native payload silently overrides the derived value. Its `readStdin()` uses a 1000ms fallback timeout (`resolve({})`) that doesn't clear the `'end'` listener, a latent (but currently benign, thanks to Promise's idempotent-resolve semantics) race condition.

## Integration Points

`UnifiedHookManager` is a child of `ConstraintSystem`, which relies on it to dispatch enforcement logic through the handler registry. It is invoked exclusively through `ClaudeBridge`, which imports `getHookManager` and calls `manager.executeHooks(unifiedContext.event, unifiedContext, 'claude')` after conditionally running `manager.initialize(projectPath)` when `!manager.initialized`.

Sensitive-data handling crosses component boundaries inconsistently: sibling `ViolationCaptureService.sanitizeParams()` redacts password/token/key/secret/auth substrings only at persistence time, but `ClaudeBridge.transformContext()` forwards the full unredacted `claudeContext` into in-memory handler execution — meaning any lower-priority logging handler sees raw data regardless of a higher-priority redacting handler's position in the registry, since redaction is not an execution-time control.

## Usage Guidelines

Developers extending hook behavior should confirm which abstraction they're targeting before writing code: subclassing `HooksManager` in `hooks-api.js` will silently do nothing for the actual Claude Code execution path, since only `hook-manager.js`'s `executeHooks()` is wired into `claude-bridge.js`. Priority values assigned via the registry should be treated as load-bearing for correctness — since execution never short-circuits on failure or `allow: false`, security/validation handlers must not assume that a block prevents subsequent handlers from running. Given the fail-open boundary and lenient config validation, any handler intended to enforce hard constraints (per `ConstraintSystem`) should perform its own defensive validation rather than relying on the pipeline to halt on error — a broken hook is functionally equivalent to no hook, traceable only via logs.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- UnifiedHookManager (class) in hook-manager.js
- getHookManager (function) in hook-manager.js
- resetHookManager (function) in hook-manager.js

**Relationships:**
- The code graph identifies UnifiedHookManager (hook-manager.js) alongside module-level getHookManager and resetHookManager functions, which is the classic singleton-with-reset pattern used to give the hook system one process-wide registry while still allowing tests to tear it down. This is corroborated by lib/agent-api/hooks/claude-bridge.js:main(), which calls `const { getHookManager } = await import('./hook-manager.js'); const manager = getHookManager();` and then conditionally calls `manager.initialize(projectPath)` only `if (!manager.initialized)` — meaning the bridge script (invoked fresh on every single Claude Code tool call as a subprocess) relies on getHookManager() to either construct a new instance or return a process-cached one. Since claude-bridge.js is spawned per-hook-event as `node .../claude-bridge.js`, each invocation is a brand-new Node process, so the singleton only has the lifetime of that one process — resetHookManager's value is almost certainly for test isolation (resetting shared state between test cases) rather than genuine runtime reuse across tool calls, since there's no persistent process to reuse it in.

**Other:**
- The parent-context observation that registerHandler() re-sorts by priority so 'critical validation handlers... can be given low priority numbers to guarantee they execute before... telemetry handlers' is only partially visible in the adjacent hooks-api.js implementation: `eventHooks.sort((a, b) => a.priority - b.priority)` confirms ascending-priority-first ordering, and triggerHook()'s for-loop awaits each `hook.handler(fullContext)` sequentially with a try/catch per handler that logs-and-continues on error (`logger.error(...); messages.push(...); // Continue with other hooks even if one fails`). This means a failing high-priority (low-number) validation handler does NOT halt lower-priority handlers from still running — the loop always visits every registered hook regardless of an earlier handler's failure or its `allow: false` result, so 'allow' is only ever downgraded, never used to short-circuit remaining execution. A caller expecting an early-priority `allow: false` to skip subsequent handlers (e.g., stop a logging handler from firing after a security handler blocks) would be wrong; UnifiedHookManager's executeHooks() would need to independently implement short-circuiting for that guarantee to hold, since hooks-api.js's triggerHook() does not.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- [LLM] The hook dispatch architecture in UnifiedHookManager (lib/agent-api/hooks/hook-manager.js) centers on a handler registry keyed by HookEvent enum values (pre-tool, post-tool, pre-prompt, post-prompt, startup, shutdown, error), where each event maps to an array of handler objects containing a numeric priority field. When registerHandler() is called, the new handler is inserted and the array is re-sorted by priority, meaning handler execution order is deterministic and controllable by callers rather than being first-registered-first-run. This design allows critical validation handlers (e.g., security or ConstraintSystem enforcement logic) to be given low priority numbers to guarantee they execute before lower-priority logging or telemetry handlers, but it also means that a misconfigured priority value could silently reorder execution in ways that are hard to trace without inspecting the registry at runtime.

### Children
- [HandlerRegistry](./HandlerRegistry.md) -- [LLM] The actual 'HandlerRegistry' in this codebase lives inside `HooksManager` in lib/agent-api/hooks-api.js: the constructor initializes `this.hooks = new Map()` and pre-seeds an empty array for every value of the `HookEvent` enum (`for (const event of Object.values(HookEvent)) { this.hooks.set(event, []) }`). This is a classic per-event bucketed registry — `registerHook(event, handler, options)` validates the event against `HookEvent`, wraps the handler in a `{ id, event, handler, priority, source }` record, pushes it into the bucket for that event, and then re-sorts the whole bucket with `eventHooks.sort((a, b) => a.priority - b.priority)` on every single registration. Re-sorting the full array on each insert (rather than inserting at the correct position) is O(n log n) per registration instead of O(log n) or O(n), which is irrelevant at hook-system scale (dozens of handlers) but signals this registry was written for correctness/readability, not throughput.
- [TieredConfigLoader](./TieredConfigLoader.md) -- initialize(projectPath) first calls loadConfig(this.config.userConfigPath, 'user') then loadConfig(this.config.projectConfigPath, 'project'), so project hooks load second and can override
- [ClaudeBridge](./ClaudeBridge.md) -- [LLM+CGR] The code graph confirms `UnifiedHookManager`, `getHookManager`, and `resetHookManager` as the exported surface of hook-manager.js, and lib/agent-api/hooks/claude-bridge.js:main() is the sole observed caller pattern for the singleton getter: `const { getHookManager } = await import('./hook-manager.js'); const manager = getHookManager();` followed by a conditional `if (!manager.initialized) await manager.initialize(projectPath)`. Because claude-bridge.js is a `#!/usr/bin/env node` script re-spawned by Claude Code as a fresh subprocess on every single PreToolUse/PostToolUse event (per the shebang and the `~/.claude/settings.json` usage comment at the top of the file), the singleton pattern buys nothing at runtime — `getHookManager()` will always construct a brand-new `UnifiedHookManager` in a brand-new process, execute exactly once, and be garbage-collected on `process.exit(0)`. `resetHookManager` (visible in the code graph but never imported by claude-bridge.js) is therefore dead weight for the Claude Code path and exists purely to let test suites tear down shared module state between test cases — a strong signal that whoever designed hook-manager.js anticipated a persistent-process consumer that claude-bridge.js's per-event subprocess model never delivers.

### Siblings
- [HookConfigLoader](./HookConfigLoader.md) -- [CGR] HookConfigLoader (class) in hook-config.js
- [ViolationCaptureService](./ViolationCaptureService.md) -- [CGR] ViolationCaptureService (class) in violation-capture-service.js
- [ContentValidationAgent](./ContentValidationAgent.md) -- [LLM] ContentValidationAgent (integrations/semantic-analysis/src/agents/content-validation-agent.ts) is fundamentally a text-mining validator rather than a structural one: it works over free-text knowledge-base observations, diagrams, and insights and uses two regex pattern arrays — filePathPatterns and commandPatterns — to pull candidate file/command references out of prose before checking them against the live filesystem and git history. This is architecturally different from most of the enforcement code in this repo (e.g. HooksManager.registerHook in lib/agent-api/hooks-api.js, which validates structured event/handler objects), because natural-language extraction has no schema to lean on — correctness is entirely a function of how comprehensive the two pattern arrays are, and any observation phrased in an unusual way (e.g. a path embedded in a sentence without backticks) will silently evade extraction.
- [KnowledgeInjectionHooks](./KnowledgeInjectionHooks.md) -- isInjectionEnabled() in knowledge-injection-hook.js reads `process.env.CODING_KNOWLEDGE_INJECTION`, defaulting to enabled unless the value matches '0'/'false'/'off' (case-insensitive, trimmed)


---

*Generated from 12 observations*
