# ServiceStartupOrdering

**Type:** Detail

## What It Is

ServiceStartupOrdering is the mechanism that governs the sequence in which services are started within `scripts/start-services-robust.js`, implemented as a standalone data structure — `SERVICE_ORDER` — that walks alongside, but is decoupled from, the `SERVICE_CONFIGS` map that its parent component RobustServiceStarter uses to define each service's behavior. The invariant it enforces is checked, not assumed: `tests/features/service-gating.test.mjs` asserts that `SERVICE_ORDER` and `SERVICE_CONFIGS` cover the exact same set of services, and that `transcriptMonitor` and `liveLoggingCoordinator` — the live-logging pair — occupy the first two positions. This turns startup sequencing from an implicit, layout-dependent behavior into a test-enforced contract.

## Architecture and Design

The core architectural decision is separating ordering from configuration: `SERVICE_ORDER` is an array of `{key}` objects consumed by whatever driver invokes `startOneService`, rather than relying on the iteration order of `SERVICE_CONFIGS`'s object keys. This avoids depending on JavaScript object-key enumeration semantics for something as consequential as startup sequence, and it makes the "live-logging pair first" rule directly assertable against array order in tests.

Layered on top of ordering is a separate feature-gating and required/optional system (owned conceptually by the parent RobustServiceStarter and sibling ServiceStarterRetryLogic): `SERVICE_ORDER` determines *when* a service is attempted, while `required` flags and feature flags jointly determine whether failure escalates to a blocking condition. Observation 4 makes this distinction explicit — a required service like `transcriptMonitor` does not block startup if its feature is disabled, showing that ordering and blocking-ness are orthogonal concerns intentionally kept independent.

This ordering guarantee is scoped narrowly: it only holds on the Node.js `ROBUST_MODE` path exec'd from `start-services.sh:14-20`. The legacy bash fallback in the same script has no equivalent concept, sequencing constraint-monitor Docker containers and live-logging processes via ad hoc shell commands. Separately, `docker/entrypoint.sh` implements a parallel, coarser-grained gating scheme for supervisord programs using `PROGRAM_FEATURES` and a `features.json` snapshot — structurally analogous in intent but sharing no code with `SERVICE_ORDER`/`SERVICE_CONFIGS`.

## Implementation Details

The concrete dependency motivating hard-pinned ordering is visible in `SERVICE_CONFIGS.transcriptMonitor`'s `startFn`, which checks `psm.isServiceRunning` and falls back to OS-level `pgrep` detection. Any service started before the live-logging pair risks observing or logging against a monitor that isn't yet up — hence positions 0 and 1 are hard-pinned rather than left to feature-gating alone. This same `startFn` also anchors sibling ServiceStarterRetryLogic, whose guarded, idempotent start logic (PSM global check, PSM per-project check, `pgrep`) prevents duplicate process spawns across parallel sessions; ordering and retry logic operate on the same underlying config entries but address different failure modes.

Notably, the ordering guarantee itself is enforced only via test assertions in `tests/features/service-gating.test.mjs` — there is no runtime constraint inside `start-services-robust.js` that would prevent `SERVICE_ORDER` from drifting out of sync with reality; correctness rests on the test suite catching regressions, not on a self-checking runtime invariant.

## Integration Points

ServiceStartupOrdering sits inside RobustServiceStarter and depends on `startOneService` as its execution driver. It interacts with sibling ServiceStarterRetryLogic through shared `SERVICE_CONFIGS` entries (maxRetries, timeout, startFn) but addresses a distinct concern — sequence rather than retry behavior. It is unrelated to sibling PortReadinessProbes, which — despite thematic similarity — is not a named module but rather two discrete utility functions (`waitForPortBindable()`, `killProcessOnPortAndWait()`) embedded in the same orchestrator file. Externally, the mechanism has a structural counterpart in `docker/entrypoint.sh`'s `PROGRAM_FEATURES`/`features.json` supervisord gating, but the two must be maintained independently since they share no code path.

## Usage Guidelines

Any new service added to `SERVICE_CONFIGS` must also be added to `SERVICE_ORDER`, or `tests/features/service-gating.test.mjs` will fail — this is by design, converting a silent runtime risk into an immediate test failure. The live-logging pair (`transcriptMonitor`, `liveLoggingCoordinator`) must always remain first in `SERVICE_ORDER`; do not assume feature-gating alone protects downstream services from starting before logging/monitoring is available. Developers should remember that ordering guarantees do not extend to the legacy bash path in `start-services.sh`, nor to the containerized supervisord path in `docker/entrypoint.sh` — each must be reasoned about and updated separately when startup requirements change.


## Hierarchy Context

### Parent
- [RobustServiceStarter](./RobustServiceStarter.md) -- [LLM] scripts/start-services-robust.js implements the actual RobustServiceStarter logic: SERVICE_CONFIGS declares each service (transcriptMonitor, liveLoggingCoordinator, etc.) with required/optional classification, maxRetries, timeout, a startFn, and a healthCheckFn, and startOneService (referenced in tests/features/service-gating.test.mjs) drives feature-gated startup with blocking semantics for required services. This confirms the parent's description of retry-with-timeout and graceful degradation is concretely realized here rather than being aspirational documentation.

### Siblings
- [ServiceStarterRetryLogic](./ServiceStarterRetryLogic.md) -- [LLM] scripts/start-services-robust.js's SERVICE_CONFIGS object defines the retry logic contract per-service: transcriptMonitor and liveLoggingCoordinator are both marked required:true with maxRetries:3 and timeout:20000, and their startFn implementations layer multiple existence checks (PSM global, PSM per-project, OS-level pgrep) before spawning, meaning the 'retry' in ServiceStarterRetryLogic is not a naive respawn loop but a guarded idempotent start that avoids duplicate processes across parallel sessions.
- [PortReadinessProbes](./PortReadinessProbes.md) -- [LLM] The code actually supplied is start-services-robust.js, start-services.sh, docker/entrypoint.sh, prompt-classifier-service.mjs, and a service-gating test — none of which define a component or function named 'PortReadinessProbes'. The closest relatives are waitForPortBindable() and killProcessOnPortAndWait() in scripts/start-services-robust.js, which perform TCP bind probing and port-cleanup-with-wait, but these are two discrete utility functions embedded in a larger orchestrator file, not a standalone 'PortReadinessProbes' module, class, or exported unit. Treating them as the named component would be an inference from thematic similarity (both are about port readiness) rather than direct evidence.


---

*Generated from 9 observations*
