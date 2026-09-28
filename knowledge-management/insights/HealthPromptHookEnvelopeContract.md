# HealthPromptHookEnvelopeContract

**Type:** Detail

## What It Is

HealthPromptHookEnvelopeContract refers not to a discrete module but to an implicit convention implemented entirely within `scripts/health-prompt-hook.js`, the same file that houses its siblings DeriveSummaryStalePipelineDetection and CoordinatorFetchFailOpen. It represents the SPEC R8 guarantee that every exit path of the hook process emits a stable JSON shape: `{ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }`. There is no dedicated contract file, TypeScript interface, or JSON schema defining this shape — it exists purely as a call-site convention enforced by discipline and a single writer function, `outputEnvelope()`.

## Architecture and Design

The core pattern is a fail-safe wrapper: every possible termination route through `main()` — the Q3 short-circuit, the normal-flow call via `outputHealthContext()`, the internal catch block, and the top-level `.catch()` on the initial `main()` invocation — funnels through `outputEnvelope()` rather than writing to stdout independently. This centralizes the one seam that touches process output while leaving the call sites themselves duplicated three times rather than abstracted into a shared wrapper, a deliberate (if slightly repetitive) trade-off favoring explicitness at each exit over a single control-flow funnel.

Notably, the contract is decoupled from whether health data was ever actually computed. The Q3 carve-out (detection of `VERIFIER_SCRIPT` existence, shared conceptually with the sibling CoordinatorFetchFailOpen's environment-sensitive checks) causes `checkHealthStatus()` to short-circuit with `servicesAvailable: false` when running outside the coding repo, and `main()` calls `outputEnvelope('')` directly — bypassing `outputHealthContext()` and `deriveSummary()` entirely. The envelope shape survives even when no status object was ever generated, reflecting the file's own header distinction between SPEC R6 (coordinator-side no-fallback-to-healthy, the domain of CoordinatorFetchFailOpen) and Q3 (consumer-side environment detection).

## Implementation Details

`outputEnvelope()` is the sole writer of the envelope. Its enforcement mechanism is a runtime type guard, not a schema validator: `typeof additionalContext === 'string' ? additionalContext : ''`. This means a caller bug that passes a non-string (say, an object from a malformed status computed elsewhere, such as in DeriveSummaryStalePipelineDetection's logic) cannot corrupt the JSON structure — it can only silently degrade to an empty `additionalContext`. This is a defensive but lossy safeguard: correctness of shape is guaranteed, but content-level errors are swallowed rather than surfaced.

Three call sites in `main()` — the Q3 branch, the catch block, and the top-level `.catch()` — all converge on `outputEnvelope('')`, reinforcing that failure paths intentionally emit an empty-context envelope rather than omitting output or throwing raw errors to stdout.

## Integration Points

The contract's only consumer in the supplied evidence is `tests/integration/health-prompt-hook-stall.test.mjs`, specifically its `hookSays()` helper, which spawns the real process via `execFile` and parses `JSON.parse(stdout).hookSpecificOutput.additionalContext`. Every status-string assertion (stalled/stale/busy/unreachable/disabled) in that test implicitly depends on the envelope being valid, parseable JSON with that exact key path — if the envelope were malformed, `JSON.parse` would throw before any assertion ran. Critically, no test explicitly asserts the envelope shape itself (e.g., checking `hookEventName === 'UserPromptSubmit'`); the guarantee is exercised implicitly, never verified as a first-class check.

The parent HealthPromptHook's broader session history includes an unrelated, unresolved coverage-ratio defect in obs-api (denominator wrongly including 'observations' and 'digests' entity types) — noted here only to clarify that this concern is distinct from and unaffected by the envelope contract.

## Usage Guidelines

Any future call site that produces hook output must route through `outputEnvelope()` rather than writing to stdout directly, preserving the single-writer invariant. Because the contract's enforcement is a type guard rather than a schema, callers should not assume structured error propagation — non-string inputs degrade silently to empty context rather than raising visible failures, so upstream bugs (e.g., in status derivation) may manifest as empty output rather than explicit errors. Developers extending test coverage should consider adding an explicit assertion on the envelope's top-level shape (`hookSpecificOutput`, `hookEventName`) rather than continuing to rely on incidental JSON.parse success, since the current tests only prove parseability, not conformance to the named contract.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- No file in the supplied code graph or code files defines a type, interface, JSON schema, or dedicated contract-testing module named 'HealthPromptHookEnvelopeContract' or similar; the two React hook files (hooks.ts, usePolledFetch.ts) belong to the unrelated system-health-dashboard frontend and implement polling/state hooks, not envelope validation, confirming the parent record's own note that they share only the 'hooks' filename substring with this component.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The work record 'obs-api Service Lifecycle and Dev Workflow Resumption' documents an open, unresolved defect in obs-api's coverage-ratio computation — a denominator that should exclude 'observations' and 'digests' entity types but currently includes them — which is unrelated to the envelope contract itself; it is evidence that this parent entity's session history spans at least two distinct concerns (the hook's output-shape guarantee and a separate metrics bug in a different service), and the coverage bug remains located-but-unfixed as of the record.

## Hierarchy Context

### Parent
- [HealthPromptHook](./HealthPromptHook.md) -- [SESSION] obs-api Service Lifecycle and Dev Workflow Resumption: a coverage metric in obs-api computes a ratio whose denominator should exclude 'observations' and 'digests' entity types but currently includes them, skewing reported coverage — an open unresolved code-fix task

### Siblings
- [DeriveSummaryStalePipelineDetection](./DeriveSummaryStalePipelineDetection.md) -- [SESSION] obs-api Service Lifecycle and Dev Workflow Resumption: a coverage metric in obs-api computes a ratio whose denominator should exclude 'observations' and 'digests' entity types but currently includes them, skewing reported coverage — an open unresolved code-fix task related to the same obs-api pipeline this hook monitors.
- [CoordinatorFetchFailOpen](./CoordinatorFetchFailOpen.md) -- [LLM] The component's fail-open behavior is implemented entirely within checkHealthStatus() in scripts/health-prompt-hook.js, where the try/catch around `fetch(coordinator/health/state)` is the single seam enforcing SPEC R6. A non-OK HTTP response resolves to `status: { overallStatus: 'unknown', upstream: 'http_${r.status}' }`, and a thrown fetch error resolves to `status: { overallStatus: 'unknown', upstream: 'unreachable', error: err.message }` — both paths deliberately avoid ever defaulting to 'healthy', meaning the only route to a 'healthy' verdict is a successful fetch parsed through deriveSummary().


---

*Generated from 9 observations*
