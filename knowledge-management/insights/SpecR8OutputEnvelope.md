# SpecR8OutputEnvelope

**Type:** Detail

## What It Is

SpecR8OutputEnvelope is not a standalone class or module but a realized concept: the fixed JSON contract emitted by `outputEnvelope()` in `scripts/health-prompt-hook.js`. This function always writes `{ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }` to stdout, defending its own shape by coercing non-string `additionalContext` inputs to `''`. It is the terminal output stage of its parent component, HealthPromptHook, which acts as the "status aggregator" feeding tmux statusline and click-report integrations alongside the constraint-monitor dashboard.

## Architecture and Design

Three patterns are explicit in the observations. First, a single-writer/centralized-formatter pattern: `outputEnvelope()` is the only function touching stdout, guaranteeing the wire contract cannot drift across call sites even as new status branches are added to `deriveSummary()`. Second, a fail-safe/never-throw wrapper pattern: nested try/catch blocks around `outputEnvelope('')` calls ensure `exit(0)` under every failure mode, embodying SPEC R8's "never block" guarantee. Third, separation of concerns: status derivation (`deriveSummary()`, `checkHealthStatus()` — the latter shared with sibling CoordinatorHealthFetch) is decoupled from rendering (`outputHealthContext()`, `outputEnvelope()`), so new issue types can be added without touching envelope-shape code.

## Implementation Details

`outputEnvelope()` is reached from four call sites with differing failure semantics but one output shape: the Q3 carve-out in `main()` (`outputEnvelope('')` when `!healthStatus.servicesAvailable`), the normal-flow `outputHealthContext()` wrapper, an inner `catch (error)` block in `main()` (itself wrapped in a last-ditch `try/catch`), and the outer `main().catch(...)` at module scope. `outputHealthContext(healthStatus)` is the sole producer of variable content, switching on `healthStatus.status.overallStatus`: `unknown` yields `⚪ System Health: unknown (${reason})`, `unhealthy` yields `⚠️ System Health: ${issues.slice(0,3).join(', ')}`, and any other status yields `✅ System Health: All systems operational`. Notably, the envelope is deliberately indifferent to intent: both the Q3 no-op branch and the fatal-error branch call `outputEnvelope('')`, producing byte-identical stdout for semantically opposite situations — the only distinguishing trace is a `process.stderr.write` in the error branch, a stream Claude never reads.

## Integration Points

The envelope is the final rendering layer atop `checkHealthStatus()` (sibling CoordinatorHealthFetch), which fetches from `HEALTH_COORDINATOR_URL` and returns one of three disjoint result shapes that ultimately flow through `deriveSummary()` into `outputHealthContext()`. Verification is end-to-end rather than unit-level: `tests/integration/health-prompt-hook-stall.test.mjs`'s `hookSays()` spawns the real hook as a subprocess and asserts `JSON.parse(stdout).hookSpecificOutput.additionalContext`, confirming the shape as actually emitted on the wire rather than as an internal object literal. A noted open defect (from the obs-api Service Lifecycle session record) concerns a coverage-ratio denominator wrongly including 'observations' and 'digests' entity types upstream — not present in the envelope code itself, but any such skew would faithfully surface through `deriveSummary()` into this envelope if it ever manifested as a health status.

## Usage Guidelines

Developers extending status logic should add branches only within `deriveSummary()`/`checkHealthStatus()`, never by writing to stdout directly — doing so would bypass the single-writer guarantee. Any new failure mode should route through the existing `outputEnvelope('')` fallback pattern to preserve the "never block" contract, understanding that this collapses distinct failure causes (intentional no-op vs. crash) into identical stdout output, distinguishable only via stderr. Since no dedicated file or class implements "SpecR8OutputEnvelope" by name, changes should be made directly to `outputEnvelope()`/`outputHealthContext()` in `scripts/health-prompt-hook.js`, and any shape change must be validated against the subprocess-level integration test rather than assumed correct from unit-level inspection alone.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The obs-api Service Lifecycle and Dev Workflow Resumption record notes an open, unresolved defect filed against HealthPromptHook: a coverage-ratio's denominator in obs-api wrongly includes 'observations' and 'digests' entity types, skewing a reported statistic. This is filed against the same component that owns the output envelope but is not recoverable from the current source of health-prompt-hook.js — it names a defect in an upstream data source the hook's envelope would faithfully report if it ever surfaced through `deriveSummary()`.

## Hierarchy Context

### Parent
- [HealthPromptHook](./HealthPromptHook.md) -- [SESSION] The HealthDashboard record establishes that health-prompt-hook.js is the 'status aggregator' feeding the tmux statusline click-report integration alongside the constraint-monitor dashboard.

### Siblings
- [CoordinatorHealthFetch](./CoordinatorHealthFetch.md) -- [LLM] checkHealthStatus() in scripts/health-prompt-hook.js is the concrete implementation of a 'coordinator health fetch': after the Q3 existsSync(VERIFIER_SCRIPT) short-circuit, it issues a single `fetch(`${coordinator}/health/state`)` against `process.env.HEALTH_COORDINATOR_URL || 'http://localhost:3034'` and returns one of three disjoint result shapes — HTTP-error (`overallStatus: 'unknown', upstream: 'http_${r.status}'`), fetch-exception (`upstream: 'unreachable', error: err.message`), or success (`status: deriveSummary(state)`). The function's own docstring calls this out as 'the only data source for this hook (Phase 33)', meaning every downstream status line the operator sees traces back to this one call.
- [KnowledgePipelineStallDetection](./KnowledgePipelineStallDetection.md) -- [SESSION] HealthDashboard record establishes health-prompt-hook.js is the 'status aggregator' feeding the tmux statusline click-report integration alongside the constraint-monitor dashboard.


---

*Generated from 9 observations*
