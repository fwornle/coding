# ServiceStarterRetryLogic

**Type:** Detail

## What It Is

ServiceStarterRetryLogic is the retry/health-check machinery embedded within `scripts/start-services-robust.js`, functioning as the concrete retry engine underlying its parent component, RobustServiceStarter. It is not a standalone class but a cross-cutting behavior expressed through the `SERVICE_CONFIGS` object, per-service `startFn`/`healthCheckFn` definitions, and dedicated helper functions (`waitForPortBindable()`, `killProcessOnPortAndWait()`). Its purpose is to govern how services like `transcriptMonitor` and `liveLoggingCoordinator` (both `required:true`, `maxRetries:3`, `timeout:20000`) are started, verified, and retried without producing duplicate or zombie processes.

## Architecture and Design

The design rejects a naive "respawn on failure" loop in favor of a layered, failure-mode-aware retry architecture. At the top tier, `startOneService` (tested in `tests/features/service-gating.test.mjs`) enforces a state machine with four distinct outcomes — successful, degraded, failed, disabled — rather than a binary success/failure signal. This gives required-service failures (`results.failed`, `blocked:true`) a different architectural meaning than a disabled feature bypassing `startFn` entirely (`results.disabled`).

Beneath this sits a second tier: idempotent-start guards inside each service's `startFn`, which check PSM global state, PSM per-project state, and OS-level `pgrep` before spawning — preventing duplicate processes across parallel sessions. A third tier handles port-level retry: `waitForPortBindable()` deliberately avoids `isPortListening`'s HTTP probe because crashed processes can leave sockets in a state producing false negatives, instead using a throwaway `net.createServer().listen()`. A fourth, nested tier is `killProcessOnPortAndWait()`, which escalates SIGTERM to SIGKILL after half of `maxWaitMs`, polling at `pollIntervalMs` — a self-contained retry sub-routine used before restart attempts.

This multi-tier structure is a deliberate architectural trade-off: complexity is pushed into `scripts/start-services-robust.js` so that the higher-level state machine remains simple and testable.

## Implementation Details

`SERVICE_CONFIGS` is the contract table driving everything: each entry declares `required`, `maxRetries`, `timeout`, `startFn`, and `healthCheckFn`. For `transcriptMonitor` and `liveLoggingCoordinator`, `startFn` layers existence checks before spawning, making retries safe to repeat. `waitForPortBindable()` and `killProcessOnPortAndWait()` are imported from `lib/service-starter.js` and used as shared primitives across services rather than reimplemented per-service. The outcome taxonomy is validated structurally in `tests/features/service-gating.test.mjs`, which forces `maxRetries:1` on `transcriptMonitor` to assert `out.blocked=true` and correct population of `results.failed` with `required:true` — treating the retry logic's state transitions as invariants, not just runtime behavior.

## Integration Points

ServiceStarterRetryLogic sits directly beneath RobustServiceStarter and shares infrastructure with sibling concerns ServiceStartupOrdering and the port-probing functions loosely associated with PortReadinessProbes (though the latter is not a standalone module — just `waitForPortBindable()`/`killProcessOnPortAndWait()` reused here). Startup ordering (`SERVICE_ORDER`) and retry configuration (`SERVICE_CONFIGS`) are cross-checked by tests to cover each other exactly, coupling this retry logic tightly to ordering guarantees.

Two parallel systems exist outside this component's scope: `start-services.sh`'s legacy path (active when `ROBUST_MODE` is off) implements cruder bash-based polling with hardcoded sleeps, and `docker/entrypoint.sh`'s `wait_for_service()` implements an unrelated fail-open retry loop for Qdrant/Redis that defers to supervisord rather than using the blocked/degraded/failed taxonomy.

## Usage Guidelines

Developers extending `SERVICE_CONFIGS` must update `SERVICE_ORDER` in tandem, or tests will fail by design. New `startFn` implementations should replicate the idempotency guards (existence checks before spawn) rather than assuming a clean process slate. Health checks should prefer TCP-bind-style probing (`waitForPortBindable`) over naive HTTP probes when a service may have left sockets in an ambiguous state. Anyone touching `ROBUST_MODE` branching in `start-services.sh` should recognize it as a structurally separate, less capable implementation kept only for backward compatibility — not a variant of the same logic.


## Hierarchy Context

### Parent
- [RobustServiceStarter](./RobustServiceStarter.md) -- [LLM] scripts/start-services-robust.js implements the actual RobustServiceStarter logic: SERVICE_CONFIGS declares each service (transcriptMonitor, liveLoggingCoordinator, etc.) with required/optional classification, maxRetries, timeout, a startFn, and a healthCheckFn, and startOneService (referenced in tests/features/service-gating.test.mjs) drives feature-gated startup with blocking semantics for required services. This confirms the parent's description of retry-with-timeout and graceful degradation is concretely realized here rather than being aspirational documentation.

### Siblings
- [PortReadinessProbes](./PortReadinessProbes.md) -- [LLM] The code actually supplied is start-services-robust.js, start-services.sh, docker/entrypoint.sh, prompt-classifier-service.mjs, and a service-gating test — none of which define a component or function named 'PortReadinessProbes'. The closest relatives are waitForPortBindable() and killProcessOnPortAndWait() in scripts/start-services-robust.js, which perform TCP bind probing and port-cleanup-with-wait, but these are two discrete utility functions embedded in a larger orchestrator file, not a standalone 'PortReadinessProbes' module, class, or exported unit. Treating them as the named component would be an inference from thematic similarity (both are about port readiness) rather than direct evidence.
- [ServiceStartupOrdering](./ServiceStartupOrdering.md) -- [LLM] SERVICE_ORDER and SERVICE_CONFIGS in scripts/start-services-robust.js constitute the concrete implementation of 'ServiceStartupOrdering': the test file tests/features/service-gating.test.mjs explicitly asserts that these two structures cover each other exactly and that the live-logging pair (transcriptMonitor, liveLoggingCoordinator) must occupy the first two slots. This turns startup ordering from an implicit consequence of code layout into a checked invariant — adding a service without updating SERVICE_ORDER is a test failure, not a runtime surprise discovered later.


---

*Generated from 9 observations*
