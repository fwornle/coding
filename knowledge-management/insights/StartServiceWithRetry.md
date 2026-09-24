# StartServiceWithRetry

**Type:** Detail

## What It Is

`startServiceWithRetry` is a function defined in `lib/service-starter.js`, a file that is not itself present in the supplied observations — only its import site and usage are visible. It is exported as part of the `service-starter.js` module surface alongside `createHttpHealthCheck`, `createPidHealthCheck`, `isPortListening`, `isTcpPortListening`, `isProcessRunning`, and `sleep`, all imported together at `scripts/start-services-robust.js:26-34`. It belongs conceptually to the parent component ServiceStarter, which this document treats as the retry/backoff engine underlying robust service startup.

Per the code graph, `StartServiceWithRetry` calls `isProcessRunning`, `sleep`, and `withDeadline` — the last of which appears nowhere else in the supplied bundle and must be treated as graph-only evidence.

## Architecture and Design

The evident design is a **strategy pattern**: `startServiceWithRetry` is a generic retry/backoff primitive that accepts per-service `startFn` and `healthCheckFn` implementations, rather than embedding service-specific logic itself. This mirrors the sibling HealthCheckStrategies, whose `createHttpHealthCheck`/`createPidHealthCheck` factories produce the `healthCheckFn` predicates consumed here. The retry mechanics (attempt counting, sleep-based backoff, deadline enforcement via `withDeadline`) are centralized, while `SERVICE_CONFIGS` entries (e.g., `transcriptMonitor`, `liveLoggingCoordinator`, both with `maxRetries: 3`, `timeout: 20000`) supply the declarative policy data consumed per service.

A key architectural boundary is that pre-flight concerns are deliberately kept outside the retry budget. `waitForPortBindable()` (`scripts/start-services-robust.js:151-178`) explicitly polls for port availability *before* a spawn attempt and "burns no maxRetries slots," and `killProcessOnPortAndWait()` (`:78-149`) performs SIGTERM-then-SIGKILL escalation with `lsof` polling. Both run prior to a `startServiceWithRetry`-driven spawn rather than inside its loop, keeping kernel-socket-timing workarounds out of the generic retry logic. This is a layering decision: the sibling WithDeadlineRace-like polling behavior in these helpers is conceptually similar to (but distinct from) whatever `withDeadline` does inside the retry primitive itself.

## Implementation Details

Because `lib/service-starter.js` itself is absent from the supplied files, the internal mechanics of `startServiceWithRetry` must be inferred from its call graph and callers. The graph shows three calls: `isProcessRunning` (a status check, also independently imported by `start-services-robust.js`), `sleep` (backoff delay between attempts), and `withDeadline` (likely wrapping each attempt in a timeout, plausibly matching the `timeout` fields in `SERVICE_CONFIGS`, though this cannot be confirmed from source text). No implementation code, class structure, or exact backoff algorithm is directly observable.

On the consumer side, `startOneService` (in `scripts/start-services-robust.js`, exercised by `tests/features/service-gating.test.mjs`) orchestrates calls into `startServiceWithRetry`, pairing it with `required`/`feature` flags from `SERVICE_CONFIGS`. The test suite stubs `transcriptMonitor.startFn` to throw and sets `maxRetries: 1`, asserting that a required failure blocks downstream services — this confirms the required/optional contract at the orchestration boundary without directly testing the retry primitive's internals.

## Integration Points

`startServiceWithRetry` integrates with the rest of the system exclusively through `scripts/start-services-robust.js`, which is reached only via the `ROBUST_MODE` branch of `start-services.sh` (`exec node scripts/start-services-robust.js`). The legacy branch of `start-services.sh` and `docker/entrypoint.sh`'s supervisord-based `autostart=false` override represent structurally separate startup paths that do not route through this primitive at all — `entrypoint.sh` delegates restart supervision to supervisord itself, converging with the host-side `startOneService` gating only at the shared `FEATURE_IDS` contract (the basis for the sibling FeatureGatedSupervisorConfig label).

Within its own module, it depends on `isProcessRunning`, `sleep`, and `withDeadline`, and is expected to accept health-check predicates built by the sibling HealthCheckStrategies factories. It is consumed indirectly by `tests/features/service-gating.test.mjs` via `startOneService`, `SERVICE_CONFIGS`, and `SERVICE_ORDER`, but no test directly imports or unit-tests `startServiceWithRetry`.

## Usage Guidelines

Callers should supply a `startFn`/`healthCheckFn` pair matched to a `SERVICE_CONFIGS` entry, setting `maxRetries` and `timeout` appropriately for the service's expected startup latency (transcriptMonitor and liveLoggingCoordinator both use `maxRetries: 3, timeout: 20000` as a baseline). Developers must not fold port-availability or process-killing logic into the retry loop itself — that responsibility belongs to pre-flight helpers like `waitForPortBindable` and `killProcessOnPortAndWait`, which are explicitly designed to run before, and independently of, the retry budget. The `required` flag on a service config should be treated as a hard fail-fast switch: per the service-gating test, a required service's exhausted retries should block downstream startup, whereas optional services should degrade gracefully. Finally, since `lib/service-starter.js` was not available for direct inspection here, any future work should retrieve that file explicitly before modifying retry/backoff/deadline behavior, since current understanding rests on call-graph inference and caller usage rather than direct source review.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- startServiceWithRetry (function) in service-starter.js

**Relationships:**
- Calls: isProcessRunning, sleep, withDeadline
- The code graph's call_graph places StartServiceWithRetry -> isProcessRunning, StartServiceWithRetry -> sleep, and StartServiceWithRetry -> withDeadline. isProcessRunning and sleep both appear as named imports in scripts/start-services-robust.js, which is consistent with the graph, but withDeadline appears in neither the import list nor anywhere else in the supplied code — it is graph-only evidence with no corroborating source text in this bundle, so its role (likely wrapping each retry attempt in a timeout, matching SERVICE_CONFIGS entries' `timeout` fields like transcriptMonitor's `timeout: 20000`) cannot be confirmed here.
- tests/features/service-gating.test.mjs imports startOneService, SERVICE_CONFIGS, and SERVICE_ORDER from scripts/start-services-robust.js (not from service-starter.js), and its assertions (e.g. 'a required failure blocks, so downstream services do not start', which stubs transcriptMonitor.startFn to throw and sets maxRetries: 1) exercise startServiceWithRetry only indirectly, through startOneService's orchestration. This confirms the contract at the boundary — required-ness plus feature-gating determines whether a failure blocks startup — without the test file itself ever touching the retry primitive.

**Other:**
- Call chain: StartServiceWithRetry -> isProcessRunning
- Call chain: StartServiceWithRetry -> sleep
- Call chain: StartServiceWithRetry -> withDeadline


## Hierarchy Context

### Parent
- [ServiceStarter](./ServiceStarter.md) -- [SESSION] Docker Container Restart Verification Baseline establishes a habit of comparing supervisor process lists and container state before/after docker-compose up -d restarts to catch regressions like stale naming or misconfigured mounts, directly exercising the startup paths this library implements.

### Siblings
- [WithDeadlineRace](./WithDeadlineRace.md) -- [LLM] None of the supplied files define, import, or reference a symbol, function, or class named `WithDeadlineRace` — not in docker/entrypoint.sh, scripts/prompt-classifier-service.mjs, scripts/start-services-robust.js, start-services.sh, or tests/features/service-gating.test.mjs. The closest conceptual matches are `waitForPortBindable()` (scripts/start-services-robust.js) and `killProcessOnPortAndWait()` (scripts/start-services-robust.js), which poll against a deadline (`maxWaitMs`) rather than racing multiple concurrent operations against one.
- [HealthCheckStrategies](./HealthCheckStrategies.md) -- [LLM] None of the supplied code files define a component named or structured as "HealthCheckStrategies." The parent context describes lib/service-starter.js exporting createHttpHealthCheck() and createPidHealthCheck() as distinct health-check strategy factories consumed by startServiceWithRetry(), and start-services-robust.js does import these three names (visible in its import block), but the actual implementations of createHttpHealthCheck/createPidHealthCheck are not present in any of the code files shown — only their call sites and usage patterns (e.g. the transcriptMonitor healthCheckFn wrapping createPidHealthCheck() in scripts/start-services-robust.js) are visible.
- [FeatureGatedSupervisorConfig](./FeatureGatedSupervisorConfig.md) -- [LLM] The supplied files do not implement a component named 'FeatureGatedSupervisorConfig'. docker/entrypoint.sh generates a supervisord include from PROGRAM_FEATURES, and scripts/start-services-robust.js gates host-side SERVICE_CONFIGS via a `feature` key checked in `startOneService`, but there is no class, module, or exported symbol called FeatureGatedSupervisorConfig anywhere in the provided code — it appears to be a conceptual label applied post-hoc to describe the convergence of these two parallel gating mechanisms rather than an actual artifact.


---

*Generated from 14 observations*
