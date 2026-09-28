# DeriveSummaryStalePipelineDetection

**Type:** Detail

## What It Is

`DeriveSummaryStalePipelineDetection` is a single conditional branch inside `deriveSummary()`, a function implemented in `scripts/health-prompt-hook.js`. It exists to detect one specific condition — `state.knowledge_pipeline.status === 'stalled'` — and, only on that exact match, pushes the string `observations stalled${age}` onto the `issues` array that ultimately flips `overallStatus` to `unhealthy`. It is not a classifier, module, or class; it is a narrow equality test embedded in a larger reducer function belonging to the parent component `HealthPromptHook`.

## Architecture and Design

The defining architectural trait here is deliberate narrowness: the `===` comparison against `'stalled'` explicitly excludes four sibling statuses on the same field — `'stale'`, `'busy'`, `'unreachable'`, `'disabled'` — rather than treating `knowledge_pipeline.status` as a general enum to branch over. This is an allow-list-of-one pattern, documented in-code by a comment that the observations describe as incident-driven: each filtering decision traces back to a named, dated false-positive/false-negative event, most notably a ~31-hour observation-stall incident where every other coordinator check (databases, services[], lsl_by_project) remained green. That incident is the structural justification for making this a fifth, independent check inside `deriveSummary()` rather than folding it into the `services[]` loop above it — a dead-or-blocked obs_api cannot self-report as stalled, so the verdict must derive from a separately-tracked `lastObservationAt`-based signal immune to that failure mode.

A second key decision is non-additivity with sibling checks: the stall detection pushes into the same shared `issues` array as the `services[]` reporting without short-circuiting it, verified by a test asserting that a simultaneous `stopped` service and a `stalled` pipeline both surface in the output. This favors completeness of diagnostic information over deduplication or masking.

## Implementation Details

The branch reads two mechanics worth separating. First, the guard: `if (state && state.knowledge_pipeline && state.knowledge_pipeline.status === 'stalled')`, defensively checking object presence before the status equality. Second, the age string: `const activeMs = state.knowledge_pipeline.activeStallMs; const age = Number.isFinite(activeMs) ? ... : ''`. Notably, this reads `activeStallMs` rather than the also-present `obsAgeMs` field visible on test fixtures — a deliberate choice to report active-stall duration rather than raw wall-clock age, even though both are available on the object.

Architecturally, the staleness math itself is not computed here: it's pushed upstream to `health-coordinator.js`'s `pollKnowledgePipeline`, and `deriveSummary()` merely consumes the derived `activeStallMs`/`obsAgeMs` fields. `deriveSummary` is module-private and unexported, so its behavior is verified only via the hook's stdout/stdin process boundary — behavioral/black-box testing through real HTTP and subprocess invocation rather than unit import.

## Integration Points

The primary integration point is `tests/integration/health-prompt-hook-stall.test.mjs`, which functions as the executable specification: seven cases enumerate every possible `knowledge_pipeline.status` value (`'stalled'`, `'stale'`, `'busy'`, `'unreachable'`, `'disabled'`, `'healthy'`, and absent) confirming only `'stalled'` triggers amber status. This test also confirms interaction with the sibling `services[]` check via the "does not mask a stopped service" case.

Within `HealthPromptHook`, this detection sits alongside siblings `CoordinatorFetchFailOpen` (which governs how `checkHealthStatus()` handles fetch failures, resolving to `'unknown'` rather than ever defaulting `'healthy'`) and `HealthPromptHookEnvelopeContract` (the repeated `outputEnvelope()` call-site convention). Together these three form independent layers: fail-open network handling, summary derivation (including this stall check), and output envelope guarantees. There's also a loosely related open defect in obs-api's coverage-ratio computation (documented under the parent's session record) — it lives in obs-api itself, not in `deriveSummary()`, but is adjacent since both concern the same coordinator/obs-api pipeline being monitored.

## Usage Guidelines

Developers modifying this branch must preserve the exact five-way exclusion semantics pinned by the test file — adding or removing a status from the excluded set without updating both the code comment and the enumeration tests breaks the two independent grounding points intentionally kept in sync. Any change to which field feeds the age string (`activeStallMs` vs `obsAgeMs`) should be deliberate and documented, since the current choice was itself a considered deviation from the "obvious" field. Because `deriveSummary` is unexported, new tests must go through the integration/process boundary rather than direct import. Finally, this check must remain non-short-circuiting relative to the `services[]` loop — any refactor should preserve independent issue-array pushes so simultaneous failures remain simultaneously visible.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- deriveSummary() in scripts/health-prompt-hook.js implements the stale-pipeline detection this component is named for: it checks `state.knowledge_pipeline.status === 'stalled'` and, only on that exact value, pushes an `observations stalled${age}` string onto the `issues` array that ultimately flips `overallStatus` to `unhealthy`. The check is deliberately narrow — four sibling statuses ('stale', 'busy', 'unreachable', 'disabled') on the same `knowledge_pipeline.status` field are explicitly excluded by the `===` comparison, meaning this is a single-branch equality test rather than a general-purpose pipeline-health classifier.
- The age computation inside the stalled branch — `const activeMs = state.knowledge_pipeline.activeStallMs; const age = Number.isFinite(activeMs) ? ... : ''` — reads a specific field (`activeStallMs`) rather than the more obvious `obsAgeMs` also present on the same object. Both fields are visible on the test fixtures in tests/integration/health-prompt-hook-stall.test.mjs (`knowledge_pipeline: { status: 'stalled', obsAgeMs: 31 * 3600_000, activeStallMs: 7 * 3600_000 }`), confirming the function has access to wall-clock age but deliberately discards it in favor of active-time in the rendered string.
- tests/integration/health-prompt-hook-stall.test.mjs is the executable specification for this exact branch: seven of its test cases enumerate every value `knowledge_pipeline.status` can take ('stalled', 'stale', 'busy', 'unreachable', 'disabled', 'healthy', and the key being entirely absent) and assert that only 'stalled' turns the summary line amber. This test file effectively pins the exclusion set that the code comment above the `if` statement justifies narratively — the comment and the test enumerate the same five-way branch independently, giving the stale/stalled distinction two points of grounding rather than one.
- The stall detection is deliberately non-additive with the services[] issue reporting above it in deriveSummary() — the final test in health-prompt-hook-stall.test.mjs ('a stall does not mask a stopped service — both are reported') asserts that a simultaneous `services: [{ name: 'obs_api', status: 'stopped' }]` and `knowledge_pipeline: { status: 'stalled', ... }` produce both `service obs_api stopped` and `observations stalled` in the same issues array, confirming the two checks push into a shared `issues` list without short-circuiting each other.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- obs-api Service Lifecycle and Dev Workflow Resumption: a coverage metric in obs-api computes a ratio whose denominator should exclude 'observations' and 'digests' entity types but currently includes them, skewing reported coverage — an open unresolved code-fix task related to the same obs-api pipeline this hook monitors.
- The work record 'obs-api Service Lifecycle and Dev Workflow Resumption' documents an open, unresolved defect adjacent to this component: a coverage metric in obs-api computes a ratio whose denominator should exclude 'observations' and 'digests' entity types but currently includes them, skewing reported coverage. This bug is located in obs-api's own coverage computation, not in deriveSummary() or health-prompt-hook.js, which only consumes obs-api's/the coordinator's output — the record frames it as a located-but-unfixed task rather than something visible in this file's source.

## Hierarchy Context

### Parent
- [HealthPromptHook](./HealthPromptHook.md) -- [SESSION] obs-api Service Lifecycle and Dev Workflow Resumption: a coverage metric in obs-api computes a ratio whose denominator should exclude 'observations' and 'digests' entity types but currently includes them, skewing reported coverage — an open unresolved code-fix task

### Siblings
- [CoordinatorFetchFailOpen](./CoordinatorFetchFailOpen.md) -- [LLM] The component's fail-open behavior is implemented entirely within checkHealthStatus() in scripts/health-prompt-hook.js, where the try/catch around `fetch(coordinator/health/state)` is the single seam enforcing SPEC R6. A non-OK HTTP response resolves to `status: { overallStatus: 'unknown', upstream: 'http_${r.status}' }`, and a thrown fetch error resolves to `status: { overallStatus: 'unknown', upstream: 'unreachable', error: err.message }` — both paths deliberately avoid ever defaulting to 'healthy', meaning the only route to a 'healthy' verdict is a successful fetch parsed through deriveSummary().
- [HealthPromptHookEnvelopeContract](./HealthPromptHookEnvelopeContract.md) -- [LLM] The component name 'HealthPromptHookEnvelopeContract' most closely maps to the SPEC R8 envelope guarantee implemented in scripts/health-prompt-hook.js: every exit path — the Q3 short-circuit inside main(), the outputHealthContext() normal-flow call, the catch block inside main(), and the top-level `.catch()` on the initial `main()` invocation — funnels through outputEnvelope(), which always emits `{ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }`. There is no separate 'contract' module, type definition, or schema file in the supplied code; the 'contract' exists only as this repeated call-site convention, duplicated three times rather than centralized in a single wrapper function.


---

*Generated from 10 observations*
