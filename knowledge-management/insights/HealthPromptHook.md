# HealthPromptHook

**Type:** SubComponent

# HealthPromptHook — Technical Insight Document

## What It Is

HealthPromptHook is implemented as a standalone Node ESM script at `scripts/health-prompt-hook.js`, invoked by Claude Code as a UserPromptSubmit hook rather than run as a long-lived service. It is a pure consumer of health status: it polls a single upstream coordinator endpoint (`/health/state`), interprets the response through allow-listed field extraction, and emits a one-line status summary wrapped in a fixed JSON envelope. Its sibling `tests/integration/health-prompt-hook-stall.test.mjs` verifies both the stall-message formatting and a table-driven set of status transitions ('stale'/'busy'/'unreachable'/'disabled'/'healthy'). As parent, ConstraintSystem exposes this hook's output through the same tmux statusline click-report mechanism that also opens the constraint-monitor and system-health dashboards — but per the HealthDashboard architecture record, those dashboards (including the two React files sharing the "hooks" filename substring) are architecturally unrelated implementations, not part of this component.

![HealthPromptHook — Architecture](images/health-prompt-hook-architecture.png)

## Architecture and Design

The dominant pattern is a **fail-open display / fail-closed start asymmetry**: the hook always exits 0 and never blocks the user's prompt (fail-open for the UX), but on any coordinator failure it reports `'unknown'` rather than defaulting to `'healthy'` (fail-closed for the *health assessment itself*). This single-seam enforcement of SPEC R6 lives entirely in `checkHealthStatus()`'s try/catch around the fetch call — the child component CoordinatorFetchFailOpen documents this as the only code path in the file, meaning there is exactly one way to reach a `'healthy'` verdict: a successful fetch parsed through `deriveSummary()`.

A second pattern is **single upstream source of truth**: all state comes from the coordinator's JSON shape (`container.healthcheck`, `databases.status`, `services[]`, `lsl_by_project`, `knowledge_pipeline.status/activeStallMs`) with no local `.health/*.json` reads and no schema validation beyond ad hoc property checks — a deliberate tight coupling traded for simplicity. Environment detection uses a **file-existence heuristic** (presence of `scripts/health-verifier.js`) rather than configuration, the so-called Q3 carve-out, which is a project-shape assumption baked into a relative path rather than a flag.

The **SPEC R8 envelope contract**, formalized as the child HealthPromptHookEnvelopeContract, guarantees every exit path funnels through `outputEnvelope()` before `process.exit(0)`.

![HealthPromptHook — Relationship](images/health-prompt-hook-relationship.png)

## Implementation Details

`checkHealthStatus()` (lines 88-135) first applies the Q3 carve-out: if `health-verifier.js` is absent, it short-circuits to `{ servicesAvailable: false, exists: false, isStale: false, shouldBlock: false, status: null }` and `main()` immediately calls `outputEnvelope('')`. Note the header comment's explicit clarification: the script checks only for the verifier's *existence*, never spawning it. When present, the coordinator fetch runs, with non-OK responses and thrown errors both resolving to `overallStatus: 'unknown'` with distinguishing `upstream` fields (`http_${r.status}` vs `'unreachable'`).

`deriveSummary()` (lines 141-198), the responsibility of child DeriveSummaryStalePipelineDetection, contains at least three incident-driven filtering decisions recorded in code comments: `OK_SERVICE_STATUSES` treats `'busy'` as equivalent to `'running'` (avoiding false "stopped" reports during known heavy consolidation work); the knowledge-pipeline check fires only on `status === 'stalled'`, explicitly excluding `'stale'`, `'busy'`, `'unreachable'`, and `'disabled'` — motivated by a real dated outage (2026-09-16, ~31h of silent observation stoppage) where every other check passed and the hook wrongly reported "All systems operational"; and stall messaging is built from `activeStallMs` (active working time with nothing written) rather than wall-clock `obsAgeMs`, per the test asserting "stalled (7h of active work unrecorded)" while asserting `/31h/` does not appear.

`outputHealthContext()` and `outputEnvelope()` (lines 203-212) are the only stdout-touching functions, and the envelope shape `{ hookSpecificOutput: { hookEventName, additionalContext } }` is duplicated across three call sites — `main()`'s catch, the top-level `.catch()`, and normal flow — rather than centralized.

## Integration Points

HealthPromptHook's only network dependency is the health-coordinator's `/health/state` endpoint; it performs no health checks itself, delegating all polling/aggregation upstream. Its coupling to the obs-api pipeline surfaces indirectly: the open, unresolved coverage-metric defect described under "obs-api Service Lifecycle and Dev Workflow Resumption" — where a ratio's denominator wrongly includes 'observations' and 'digests' entity types — lives in obs-api's own coverage computation, not in this file, but it directly affects the data this hook consumes and reports on via DeriveSummaryStalePipelineDetection. Within ConstraintSystem, the hook is reached via the tmux statusline click-report path shared with unrelated dashboards, so despite superficial filename overlap with `workflow/hooks.ts`/`usePolledFetch.ts`, those are not part of this component. Among siblings (HookConfigLoader, UnifiedHookManager, KnowledgeInjectionHook, FeatureGatingSystem), HealthPromptHook is distinct in scope: KnowledgeInjectionHook explicitly has no code overlap with it despite similar naming conventions.

## Usage Guidelines

Developers extending this hook should preserve the single-seam SPEC R6 pattern — never introduce a code path that defaults to `'healthy'` outside of a successfully parsed coordinator response. Any change to environment detection should recognize that the `health-verifier.js` existence check is a hard-coded assumption about project shape, not a configurable flag, and will silently zero out output for projects lacking that sibling file. Modifications to `deriveSummary()` must respect its incident-driven exclusions (busy≠down, stale≠stalled, activeStallMs over wall-clock) since each encodes a specific false-positive already experienced in production. Finally, while the three-site duplication of the outputEnvelope/exit pattern is a known maintainability wart, any refactor must still guarantee the SPEC R8 shape is emitted on every exit, including uncaught exceptions.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- obs-api Service Lifecycle and Dev Workflow Resumption: a coverage metric in obs-api computes a ratio whose denominator should exclude 'observations' and 'digests' entity types but currently includes them, skewing reported coverage — an open unresolved code-fix task
- The work record 'obs-api Service Lifecycle and Dev Workflow Resumption' (about HealthPromptHook) documents an open, unresolved defect distinct from anything visible in the current source: a coverage metric in obs-api computes a ratio whose denominator should exclude 'observations' and 'digests' entity types but currently includes them, skewing the reported coverage value. This is recorded as a located-but-not-yet-fixed task, meaning the metric's arithmetic bug exists somewhere in obs-api's coverage computation rather than in health-prompt-hook.js itself, which only consumes the coordinator's `/health/state` output.
- The 'HealthDashboard — Performance/System-Health/Token-Cost Dashboards: Architecture' record establishes that health-prompt-hook.js functions as a shared status aggregator reached through the same tmux statusline click-report mechanism that also opens two architecturally unrelated dashboards (Next.js constraint-monitor vs Vite system-health-dashboard). This confirms the hook's role is scoped to producing the one-line UserPromptSubmit summary text, not to any dashboard rendering — the two React hook files retrieved alongside it (workflow/hooks.ts, usePolledFetch.ts) belong to the separate system-health-dashboard codebase and are not implementations of this component, despite the shared 'hooks' filename substring.

## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- [SESSION] Statusline Click-Report Feature establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the constraint-monitor dashboard tab, integrating HookManagementSystem-driven violation data with the dashboard UI

### Children
- [DeriveSummaryStalePipelineDetection](./DeriveSummaryStalePipelineDetection.md) -- [SESSION] obs-api Service Lifecycle and Dev Workflow Resumption: a coverage metric in obs-api computes a ratio whose denominator should exclude 'observations' and 'digests' entity types but currently includes them, skewing reported coverage — an open unresolved code-fix task related to the same obs-api pipeline this hook monitors.
- [CoordinatorFetchFailOpen](./CoordinatorFetchFailOpen.md) -- [LLM] The component's fail-open behavior is implemented entirely within checkHealthStatus() in scripts/health-prompt-hook.js, where the try/catch around `fetch(coordinator/health/state)` is the single seam enforcing SPEC R6. A non-OK HTTP response resolves to `status: { overallStatus: 'unknown', upstream: 'http_${r.status}' }`, and a thrown fetch error resolves to `status: { overallStatus: 'unknown', upstream: 'unreachable', error: err.message }` — both paths deliberately avoid ever defaulting to 'healthy', meaning the only route to a 'healthy' verdict is a successful fetch parsed through deriveSummary().
- [HealthPromptHookEnvelopeContract](./HealthPromptHookEnvelopeContract.md) -- [LLM] The component name 'HealthPromptHookEnvelopeContract' most closely maps to the SPEC R8 envelope guarantee implemented in scripts/health-prompt-hook.js: every exit path — the Q3 short-circuit inside main(), the outputHealthContext() normal-flow call, the catch block inside main(), and the top-level `.catch()` on the initial `main()` invocation — funnels through outputEnvelope(), which always emits `{ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }`. There is no separate 'contract' module, type definition, or schema file in the supplied code; the 'contract' exists only as this repeated call-site convention, duplicated three times rather than centralized in a single wrapper function.

### Siblings
- [HookConfigLoader](./HookConfigLoader.md) -- [CGR] HookConfigLoader (class) in hook-config.js
- [UnifiedHookManager](./UnifiedHookManager.md) -- [CGR] UnifiedHookManager (class) in hook-manager.js
- [KnowledgeInjectionHook](./KnowledgeInjectionHook.md) -- [LLM] None of the four supplied code files — scripts/health-prompt-hook.js, tests/integration/health-prompt-hook-stall.test.mjs, integrations/system-health-dashboard/src/components/workflow/hooks.ts, tests/features/cli-and-rules-gating.test.mjs, and integrations/system-health-dashboard/src/hooks/usePolledFetch.ts — mention 'KnowledgeInjectionHook', a knowledge-base injection mechanism, or any hook that inserts KB content into an agent/LLM prompt. health-prompt-hook.js is a UserPromptSubmit hook, but its entire body is health-status reporting (coordinator polling, deriveSummary, envelope shaping) with no reference to knowledge, retrieval, or content injection.
- [FeatureGatingSystem](./FeatureGatingSystem.md) -- [LLM+CGR] tests/features/cli-and-rules-gating.test.mjs is the clearest evidence of a FeatureGatingSystem: it imports FEATURE_IDS from lib/features/catalogue.cjs, exercises lib/features/require-feature.sh via subprocess calls to bin/graphify, bin/semantic, bin/constraints, etc., and asserts a specific contract — disabled features exit with code 2 and stderr matching /'codegraph' feature, which is switched off/, while stdout stays empty so piped output is never polluted by gate messages.


---

*Generated from 12 observations*
