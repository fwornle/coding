# KnowledgePipelineStallDetection

**Type:** Detail

## What It Is

KnowledgePipelineStallDetection is a narrow, well-tested branch of logic inside `deriveSummary()` in `scripts/health-prompt-hook.js`, part of the larger HealthPromptHook component. It exists to surface a single condition — `state.knowledge_pipeline && state.knowledge_pipeline.status === 'stalled'` — and, when true, render a human-actionable message: `` `observations stalled (${Math.floor(activeMs / 3600000)}h of active work unrecorded)` ``, where `activeMs` comes from `state.knowledge_pipeline.activeStallMs`. It is not a detector in the sense of computing staleness itself; it is a formatter of a verdict computed upstream.

## Architecture and Design

The defining architectural decision is a strict producer/consumer split: the coordinator (external to this file, invoked via the sibling CoordinatorHealthFetch's `checkHealthStatus()`) computes `knowledge_pipeline.status` and `activeStallMs`, while `health-prompt-hook.js` only reads and formats them. This keeps the hook thin and stateless — no staleness/activity-time math lives here — mirroring the same division of labor CoordinatorHealthFetch relies on for its own `deriveSummary(state)` invocation.

Within `deriveSummary()`, the stall check coexists with a `services[]` loop, but the two are deliberately decoupled: issues are accumulated additively (`issues.push` per independent check) rather than through exclusive branching, so a stopped service and a stalled pipeline can both be reported in the same line without one masking the other. This is paired with an explicit allow-list classification: only the literal 'stalled' status escalates to the amber path, while 'stale', 'busy', 'unreachable', 'disabled', and 'healthy' all resolve to "All systems operational" — an intentional suppression of false positives arising from overlapping status vocabularies across the system. Output is uniformly wrapped by the sibling SpecR8OutputEnvelope's `outputEnvelope()`, regardless of which branch produced the content.

## Implementation Details

The `Number.isFinite(activeMs)` guard is the key defensive mechanic: it prevents `NaN`, `undefined`, or malformed values from producing an empty or broken bracket suffix, falling back to an empty suffix instead. Since `deriveSummary()` is module-private, it isn't unit-tested directly; correctness is verified by spawning the real hook as a subprocess and parsing stdout, per `tests/integration/health-prompt-hook-stall.test.mjs`. That suite is the authoritative evidence for this component's existence and exact shape — it asserts the literal rendered string `observations stalled (7h of active work unrecorded)` while explicitly asserting `assert.doesNotMatch(line, /31h/)`, hard-encoding the distinction between active-work-time and wall-clock age. A second test locks the `Number.isFinite` guard against no-age input. A third confirms additive reporting: a stopped `obs_api` service plus a stalled pipeline together produce a line containing both `service obs_api stopped` and `observations stalled`. A parametrized loop over the six-way status partition guards against accidental escalation of non-stalled statuses.

## Integration Points

This component depends entirely on the coordinator populating `state.knowledge_pipeline.status` and `activeStallMs`, fetched via CoordinatorHealthFetch's `checkHealthStatus()` against `HEALTH_COORDINATOR_URL`. Its output flows into SpecR8OutputEnvelope's `outputEnvelope()` for delivery to Claude's context, and upstream into the tmux statusline / HealthDashboard's click-report integration, per the parent HealthPromptHook's role as "status aggregator." Note also an open, unresolved defect recorded against HealthPromptHook: a coverage ratio computed elsewhere in obs-api wrongly includes 'observations' and 'digests' entity types in its denominator — a distinct, adjacent bug not present in this stall-detection logic itself, but attached to the same component.

## Usage Guidelines

Do not add staleness computation to `health-prompt-hook.js` — that logic belongs in the coordinator; the hook must remain a pure formatter. Any change to `deriveSummary()`'s status handling must preserve the six-way non-escalation contract and the additive issue accumulation, both enforced by existing tests. Three retrieved files (`hooks.ts`, `usePolledFetch.ts`, `cli-and-rules-gating.test.mjs`) contain no reference to this component and should not be treated as related despite directory/filename proximity.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- HealthDashboard record establishes health-prompt-hook.js is the 'status aggregator' feeding the tmux statusline click-report integration alongside the constraint-monitor dashboard.
- The obs-api Service Lifecycle and Dev Workflow Resumption record files an open, unresolved defect directly against HealthPromptHook: a coverage ratio computed elsewhere in obs-api has a denominator that wrongly includes 'observations' and 'digests' entity types, skewing a reported statistic. This is a distinct bug from the stall-detection logic itself (which is verified correct by the test suite) — it is an adjacent, not-yet-located defect that the record attaches to this component rather than something recoverable from health-prompt-hook.js's current source.

## Hierarchy Context

### Parent
- [HealthPromptHook](./HealthPromptHook.md) -- [SESSION] The HealthDashboard record establishes that health-prompt-hook.js is the 'status aggregator' feeding the tmux statusline click-report integration alongside the constraint-monitor dashboard.

### Siblings
- [CoordinatorHealthFetch](./CoordinatorHealthFetch.md) -- [LLM] checkHealthStatus() in scripts/health-prompt-hook.js is the concrete implementation of a 'coordinator health fetch': after the Q3 existsSync(VERIFIER_SCRIPT) short-circuit, it issues a single `fetch(`${coordinator}/health/state`)` against `process.env.HEALTH_COORDINATOR_URL || 'http://localhost:3034'` and returns one of three disjoint result shapes — HTTP-error (`overallStatus: 'unknown', upstream: 'http_${r.status}'`), fetch-exception (`upstream: 'unreachable', error: err.message`), or success (`status: deriveSummary(state)`). The function's own docstring calls this out as 'the only data source for this hook (Phase 33)', meaning every downstream status line the operator sees traces back to this one call.
- [SpecR8OutputEnvelope](./SpecR8OutputEnvelope.md) -- [LLM] `outputEnvelope()` in scripts/health-prompt-hook.js is the single implementation of the SPEC R8 contract: it always writes `{ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }` to stdout, and defends the shape itself with `typeof additionalContext === 'string' ? additionalContext : ''` so a caller passing `undefined` or an object still yields a well-formed envelope rather than `"undefined"` leaking into Claude's context.


---

*Generated from 10 observations*
