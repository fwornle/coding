# CoordinatorFetchFailOpen

**Type:** Detail

## What It Is

CoordinatorFetchFailOpen is the fail-open contract governing the coordinator health-check call inside `checkHealthStatus()` in `scripts/health-prompt-hook.js`. It is the single seam — a try/catch wrapped around `fetch(coordinator/health/state)` — that enforces SPEC R6: any non-OK HTTP response or thrown fetch error must resolve to an `overallStatus: 'unknown'` state rather than ever defaulting to `'healthy'`. As a child of HealthPromptHook, it implements one of the parent's core guarantees (never blocking Claude on a coordinator outage) while its sibling HealthPromptHookEnvelopeContract handles the downstream output-shape guarantee and DeriveSummaryStalePipelineDetection handles the success-path interpretation.

## Architecture and Design

The design centers on an explicit-failure-state pattern: rather than silently defaulting to a healthy status or letting exceptions propagate, both failure branches produce a distinguishable `'unknown'` status carrying diagnostic detail (`upstream: 'http_${r.status}'` or `upstream: 'unreachable', error: err.message`). This is layered with defense-in-depth at the `main()` level, where two separate catch blocks plus a top-level `main().catch(...)` each independently call `outputEnvelope('')` before `process.exit(0)` — duplicated rather than centralized, a deliberate trade-off favoring guaranteed non-blocking behavior over DRY code.

Notably, the Q3 carve-out (`existsSync(VERIFIER_SCRIPT)`) is architecturally distinct from this coordinator-fetch fail-open path, despite living in the same function. The code comment explicitly separates the two: SPEC R6 governs coordinator-side checks, while the environment-detection short-circuit is a consumer-side concern with its own fail-open origin (`shouldBlock: false, status: null`).

## Implementation Details

`checkHealthStatus()` is the sole translation point where network failures become status objects — there is no reusable library or shared error-handling module; the coupling is intentionally tight and function-local. Success responses flow through `deriveSummary()` (verified by `tests/integration/health-prompt-hook-stall.test.mjs` via `hookSays()`, which confirms a `'stalled'` pipeline status produces an amber line, never reaching the fail-open branches). Failure responses bypass `deriveSummary()` entirely.

Downstream, `outputHealthContext()` treats `overallStatus === 'unknown'` as its own display branch (`⚪ System Health: unknown (${reason})`), kept visually distinct from both `'healthy'` and `'unhealthy'` outcomes so operators can distinguish an unreachable coordinator from a confirmed outage.

## Integration Points

This component depends on the coordinator's `/health/state` HTTP endpoint and integrates with `main()`'s exit-guarantee machinery, `outputEnvelope()`, and `outputHealthContext()`. It has no relationship to the coverage-ratio defect noted in the parent HealthPromptHook's SESSION record (an obs-api-side denominator bug) — that issue lives upstream in obs-api's coverage computation, not in this consumer-side hook.

## Usage Guidelines

Developers must preserve the never-default-to-healthy invariant when touching `checkHealthStatus()`, keep failure branches disjoint from `deriveSummary()`, and resist the urge to "simplify" the duplicated catch/exit pattern in `main()` — the redundancy is intentional, guaranteeing `process.exit(0)` under all failure modes. Any change to the Q3 carve-out should remain clearly commented as distinct from SPEC R6 to avoid conflating the two fail-open origins.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- tests/integration/health-prompt-hook-stall.test.mjs exercises the coordinator-fetch path via a real HTTP server (`hookSays()`), asserting that a JSON response with `knowledge_pipeline.status: 'stalled'` produces an amber line via deriveSummary(), not the fail-open 'unknown' path — confirming the fetch-success branch is what feeds deriveSummary() rather than the failure branches, which never reach that function.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The work record 'obs-api Service Lifecycle and Dev Workflow Resumption' documents an open, unresolved defect in obs-api's own coverage-ratio computation (denominator wrongly including 'observations' and 'digests' entity types) that is unrelated to CoordinatorFetchFailOpen's logic — it lives upstream in obs-api, not in health-prompt-hook.js, which only consumes the coordinator's already-computed `/health/state` output and cannot itself be the site of that arithmetic bug.

## Hierarchy Context

### Parent
- [HealthPromptHook](./HealthPromptHook.md) -- [SESSION] obs-api Service Lifecycle and Dev Workflow Resumption: a coverage metric in obs-api computes a ratio whose denominator should exclude 'observations' and 'digests' entity types but currently includes them, skewing reported coverage — an open unresolved code-fix task

### Siblings
- [DeriveSummaryStalePipelineDetection](./DeriveSummaryStalePipelineDetection.md) -- [SESSION] obs-api Service Lifecycle and Dev Workflow Resumption: a coverage metric in obs-api computes a ratio whose denominator should exclude 'observations' and 'digests' entity types but currently includes them, skewing reported coverage — an open unresolved code-fix task related to the same obs-api pipeline this hook monitors.
- [HealthPromptHookEnvelopeContract](./HealthPromptHookEnvelopeContract.md) -- [LLM] The component name 'HealthPromptHookEnvelopeContract' most closely maps to the SPEC R8 envelope guarantee implemented in scripts/health-prompt-hook.js: every exit path — the Q3 short-circuit inside main(), the outputHealthContext() normal-flow call, the catch block inside main(), and the top-level `.catch()` on the initial `main()` invocation — funnels through outputEnvelope(), which always emits `{ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }`. There is no separate 'contract' module, type definition, or schema file in the supplied code; the 'contract' exists only as this repeated call-site convention, duplicated three times rather than centralized in a single wrapper function.


---

*Generated from 9 observations*
