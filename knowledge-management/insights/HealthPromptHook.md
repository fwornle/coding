# HealthPromptHook

**Type:** Detail

# HealthPromptHook — Technical Insight Document

## What It Is

HealthPromptHook is implemented entirely in `scripts/health-prompt-hook.js`, a single-purpose script that implements Claude Code's `UserPromptSubmit` hook contract. It is a thin, pure consumer of `health-coordinator.js`'s `/health/state` endpoint — it performs no polling, caching, or local health computation of its own, only summarization of a single fetched snapshot. Its companion test, `tests/integration/health-prompt-hook-stall.test.mjs`, is the only other file that constitutes this component's real surface area. Despite sitting under the broader `UnifiedHookManagementSystem` (parent), and despite `ConstraintSystem` also containing it, HealthPromptHook itself has no dispatch table, no `registerHandler()` API, and produces exactly one JSON envelope shape — it is emphatically not a general hook-registration system like its sibling `UnifiedHookManager` (`hook-manager.js`), nor a message-translation layer like sibling `ClaudeBridge`, nor an abstraction layer like sibling `HooksApiAbstraction`.

## Architecture and Design

The dominant architectural theme is **fail-open, redundantly-defended error handling**. The header comment in `main()` states the invariant baldly: "The hook MUST always process.exit(0) so Claude never blocks on errors." This is enforced at three independent layers — the outer try/catch around stdin JSON parsing, `checkHealthStatus()`'s internal try/catch which converts fetch failures into an `'unknown'` status object rather than throwing, and a top-level `main().catch()` fallback that repeats the same `outputEnvelope('')` + `exit(0)` sequence. This triple redundancy signals that "never block Claude" is treated as a correctness property worth defending structurally, not just documenting.

A second pattern is **environment-detection-by-filesystem-proxy**: the Q3 carve-out checks only `existsSync(VERIFIER_SCRIPT)` (presence of `scripts/health-verifier.js`) to decide whether the hook is running inside the coding repo, explicitly *not* spawning that script ("legacy behaviour"). This is a narrow heuristic rather than genuine environment configuration, with a known edge case: a repo clone missing that one file falls silently into the "outside repo" branch with an empty `additionalContext` and no coordinator fetch attempted.

A third pattern is **incident-driven policy encoding with inline provenance**. `deriveSummary()`'s `OK_SERVICE_STATUSES = new Set(['running', 'busy'])` and its single-status `'stalled'` alert gate for `knowledge_pipeline` (child entity **KnowledgePipelineStallDetection**) exist because of two named real incidents — a blocked-event-loop false alarm and a ~31h silent outage that stayed green. Comments explicitly cross-reference `health-coordinator.js`'s `pollKnowledgePipeline()` and `reclassifyBusyService()` by name, showing tight conceptual coupling to an external module that is not code-linked, only documented.

Finally, output is architected as a **fixed-envelope contract decoupled from content logic**: `outputEnvelope()` (child entity **SpecR8OutputEnvelope**) always emits `{ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }`, defending against malformed input (`typeof additionalContext === 'string' ? additionalContext : ''`), separate from `outputHealthContext()`'s status-to-emoji-string mapping logic.

## Implementation Details

`main()` orchestrates: read stdin → `checkHealthStatus()` → `deriveSummary()` (via `outputHealthContext()`) → `outputEnvelope()`. `checkHealthStatus()` (child entity **CoordinatorHealthFetch**) is "the only data source for this hook (Phase 33)": it issues one `fetch(`${coordinator}/health/state`)` against `HEALTH_COORDINATOR_URL || 'http://localhost:3034'`, returning one of three disjoint shapes — HTTP-error (`upstream: 'http_${r.status}'`), fetch-exception (`upstream: 'unreachable'`), or success (`status: deriveSummary(state)`).

`deriveSummary()` renders stall age from `activeStallMs`, not wall-clock last-observation age — a second incident-driven fix, guarded by `Number.isFinite(activeMs)` so a stall with no age reports without an empty bracket (`Math.floor(activeMs / 3600000)`). The rollup loop over `lsl_by_project` is deliberately generic (`if (status !== 'healthy')`), meaning a hypothetical `'missing'` status from the coordinator is handled automatically without hook-side special-casing — an upstream contract the test suite documents but the hook code stays agnostic to.

## Integration Points

The hook depends entirely on `health-coordinator.js` as its single upstream data source, referencing `pollKnowledgePipeline()`, `reclassifyBusyService()`, and `OBS_STALL_MS` only in comments, not imports. Downstream, it emits into Claude Code's hook runner via stdout using the SPEC R8 shape. Per the `HealthDashboard` session note, it also feeds the tmux statusline click-report integration as a "status aggregator" alongside the constraint-monitor dashboard. Files retrieved by naming coincidence — `tests/features/cli-and-rules-gating.test.mjs`, `hooks.ts`, `usePolledFetch.ts` — are confirmed architecturally unrelated despite the "hook" keyword match.

## Usage Guidelines

Never modify `main()`'s exit-0 guarantee or remove any of its three redundant error-handling layers. Treat the Q3 `existsSync` carve-out as fragile — deleting `health-verifier.js` from a repo silently changes hook behavior. When adjusting `deriveSummary()`'s allow/deny lists, preserve the inline incident comments; they are load-bearing documentation, not decoration. Prefer black-box testing (as in `hookSays()`, spinning a one-shot `http.createServer()` and driving the hook via `execFile`) over unit-testing `deriveSummary()` directly, since it is module-private and the goal is regression-testing the operator-visible string, not internal shape.


## Hierarchy Context

### Parent
- [UnifiedHookManagementSystem](./UnifiedHookManagementSystem.md) -- [SESSION] The tmux Statusline Copy-Mode / Mouse Configuration record and Tmux Pane Badge — ETM Entry Selection Logic record are both filed under HookManagementSystem, indicating this component's scope extends beyond agent tool hooks into tmux pane/statusline click-hook wiring.

### Children
- [CoordinatorHealthFetch](./CoordinatorHealthFetch.md) -- [LLM] checkHealthStatus() in scripts/health-prompt-hook.js is the concrete implementation of a 'coordinator health fetch': after the Q3 existsSync(VERIFIER_SCRIPT) short-circuit, it issues a single `fetch(`${coordinator}/health/state`)` against `process.env.HEALTH_COORDINATOR_URL || 'http://localhost:3034'` and returns one of three disjoint result shapes — HTTP-error (`overallStatus: 'unknown', upstream: 'http_${r.status}'`), fetch-exception (`upstream: 'unreachable', error: err.message`), or success (`status: deriveSummary(state)`). The function's own docstring calls this out as 'the only data source for this hook (Phase 33)', meaning every downstream status line the operator sees traces back to this one call.
- [KnowledgePipelineStallDetection](./KnowledgePipelineStallDetection.md) -- [SESSION] HealthDashboard record establishes health-prompt-hook.js is the 'status aggregator' feeding the tmux statusline click-report integration alongside the constraint-monitor dashboard.
- [SpecR8OutputEnvelope](./SpecR8OutputEnvelope.md) -- [LLM] `outputEnvelope()` in scripts/health-prompt-hook.js is the single implementation of the SPEC R8 contract: it always writes `{ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }` to stdout, and defends the shape itself with `typeof additionalContext === 'string' ? additionalContext : ''` so a caller passing `undefined` or an object still yields a well-formed envelope rather than `"undefined"` leaking into Claude's context.

### Siblings
- [UnifiedHookManager](./UnifiedHookManager.md) -- [CGR] UnifiedHookManager (class) in hook-manager.js
- [ClaudeBridge](./ClaudeBridge.md) -- [LLM] None of the four retrieved files implement, import, or reference anything named 'ClaudeBridge'. scripts/health-prompt-hook.js implements a single UserPromptSubmit hook contract (readStdin → checkHealthStatus → deriveSummary → outputEnvelope) with no bridging logic to Claude's tool-calling layer, no message translation, and no API adapter code — it only emits a fixed-shape JSON envelope ({ hookSpecificOutput: { hookEventName, additionalContext } }) to stdout for Claude Code's hook runner to consume.
- [HooksApiAbstraction](./HooksApiAbstraction.md) -- [LLM] None of the four retrieved files implement anything resembling an 'API abstraction' over hooks — there is no registration table, no handler interface, and no dispatch loop. scripts/health-prompt-hook.js is a single-purpose script hard-wired to one hook event ('UserPromptSubmit'): main() calls checkHealthStatus() and outputHealthContext() directly, with no indirection layer a caller could register additional hook types against. If a 'HooksApiAbstraction' component exists in this codebase as a distinct module (e.g. hook-config.js or hook-manager.js per the parent context's UnifiedHookManager.loadConfig()/registerHandler() description), it was not returned by this retrieval.


---

*Generated from 10 observations*
