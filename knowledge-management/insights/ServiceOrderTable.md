# ServiceOrderTable

**Type:** Detail

[Architecture Notes] docker/entrypoint.sh cannot run the host's feature resolver directly (~/.coding/features.yaml is never mounted); it depends on a pre-resolved, read-only snapshot (.coding/runtime/features.json) written by the host at launch — a one-way, host-to-container data flow with no feedback path; start-services-robust.js's per-service required/optional distinction (SERVICE_CONFIGS[...].required) is orthogonal to and composed with feature gating: a required service whose feature is off does not block startup (verified by the test 'a REQUIRED service whose feature is off does not block startup'), meaning 'required' only applies once a feature is confirmed enabled; Tight coupling between test infrastructure and production code: tests/features/service-gating.test.mjs directly monkey-patches SERVICE_CONFIGS.*.startFn and .feature in place (with try/finally restoration) rather than injecting mocks, meaning the exported SERVICE_CONFIGS object is treated as mutable shared state across the test run; start-services.sh's legacy branch performs direct docker-compose orchestration for constraint-monitor, duplicating logic that presumably exists elsewhere in the constraint-monitor submodule's own startup tooling, creating two independent sources of truth for how that service's databases get started; The prompt-classifier-service.mjs's network-awareness (currentNetwork() delegating to the proxy's /health rather than sensing locally) establishes the proxy as the single source of truth for network mode across independently-run services — a cross-service dependency not visible from SERVICE_CONFIGS alone

# ServiceOrderTable — Technical Insight Document

## What It Is

ServiceOrderTable refers to the declarative service registry — `SERVICE_CONFIGS` and `SERVICE_ORDER` — defined in `scripts/start-services-robust.js`, which together constitute the data model consumed by the parent component, `HostServiceStarter`. `SERVICE_ORDER` specifies the sequence in which services are started; `SERVICE_CONFIGS` holds per-service metadata (`feature`, `required`, `maxRetries`, `timeout`, `startFn`). Unlike a typical registry maintained "by convention," this table's integrity is enforced structurally: `tests/features/service-gating.test.mjs` asserts that `SERVICE_ORDER.map(o => o.key).sort()` exactly equals `Object.keys(SERVICE_CONFIGS).sort()`. This closes a failure mode the test file's own docstring names directly — "ten hand-written start blocks were ten chances to forget a gate" — converting a class of runtime surprise into a CI failure.

## Architecture and Design

The core architectural pattern is a validated declarative registry: rather than trusting that every service config is wired into the startup sequence, the system proves mutual coverage via test assertion. This same "exactly-covers-each-other" invariant is mirrored on the container side, where `docker/entrypoint.sh`'s `PROGRAM_FEATURES` string is checked against supervisord's `[program:...]` sections by `tests/features/container-gating.test.mjs` — the same idea applied to a different process list.

Each entry in the table must also declare a `feature` field resolvable against `FEATURE_IDS` (from `lib/features/catalogue.cjs`), tying the service registry into the project's broader feature-flag catalogue. This is composed with, but orthogonal to, the sibling `RequiredVsOptionalStartup` concept: the `required` boolean only takes effect once a feature is confirmed enabled — a required service whose feature is off does not block startup, as proven by the test "a REQUIRED service whose feature is off does not block startup."

## Implementation Details

`startOneService()`, the consumer of this table, must draw a three-way semantic distinction documented in the `gating` describe block of `tests/features/service-gating.test.mjs`: **disabled** (feature off, `startFn` never invoked, not counted in `results.degraded`), **degraded** (feature on, attempted, not fully healthy), and **failed**+`blocked: true` (a `required: true` service whose `startFn` throws after retries are exhausted — see sibling `RequiredVsOptionalStartup`, and `PortCleanup`'s `killProcessOnPortAndWait()` for the teardown primitive used during retries). The design rationale is explicit in test comments: "Degraded means we wanted this and could not have it. Conflating the two is how a pared-down install ends up looking broken." This forces `startOneService` to consult the feature-resolution object (from `featureSet()`/`loadFeatures()`) *before* calling `startFn`, rather than calling and catching.

Feature-name validation against the table is strict and synchronous: an unrecognized feature string (e.g., `SERVICE_CONFIGS.observationsApi.feature = 'nope'`) causes `startOneService()` to throw immediately (`assert.rejects(..., /unknown feature 'nope'/)`), rather than defaulting to on or off. This is deliberately asymmetric with `docker/entrypoint.sh`'s fail-open handling of unknown feature *values* — a typo'd key is a code bug caught by CI, while a stale snapshot missing a newer key is expected runtime skew that must not break startup.

## Integration Points

The table is the anchor artifact for `HostServiceStarter` and is tightly coupled to the test suite: `tests/features/service-gating.test.mjs` directly monkey-patches `SERVICE_CONFIGS.*.startFn` and `.feature` in place (with try/finally restoration), treating the exported object as mutable shared state rather than injecting mocks. It also connects to the feature catalogue (`lib/features/catalogue.cjs`) and, indirectly, to the container-side gate in `docker/entrypoint.sh`, which reads a host-written snapshot (`.coding/runtime/features.json`) rather than resolving features itself — a one-way, host-to-container data flow with no feedback path.

Siblings `PortCleanup` and `RequiredVsOptionalStartup` describe mechanisms that operate *within* `startOneService()`'s execution of a table entry: port-teardown/bind-probe primitives and the required/optional distinction, respectively. The table itself doesn't implement these behaviors but supplies the configuration (`required`, `maxRetries`, `timeout`) they consume.

## Usage Guidelines

Any new service must be added to both `SERVICE_ORDER` and `SERVICE_CONFIGS` with a valid `feature` key — omitting either half breaks the coverage test by design. Feature keys must exist in `FEATURE_IDS`; typos are intentionally loud failures, not silent no-ops. When adding a `required: true` service, be aware it only blocks startup if its feature is enabled, and that test coverage for retry-exhaustion paths overrides `maxRetries` to avoid paying real exponential backoff costs (documented inline as "six seconds of exponential waiting"). Developers should also note the legacy fallback path in `start-services.sh` (gated by `ROBUST_MODE`) bypasses this entire table and its guarantees — it is untested infrastructure with none of the gating, retry, or coverage assurances, and should be treated as drift risk rather than a viable alternative.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- tests/features/service-gating.test.mjs's `gating` describe block draws a semantic line between three outcomes of `startOneService()` that the SERVICE_CONFIGS/SERVICE_ORDER data model must support: 'disabled' (feature off, `startFn` never invoked, not counted in `results.degraded`), 'degraded' (feature on, service attempted, but not fully healthy), and 'failed'+`blocked: true` (a `required: true` service whose `startFn` throws). The test 'a disabled service is not reported as degraded' encodes an explicit design rationale in its own comment — 'Degraded means we wanted this and could not have it. Conflating the two is how a pared-down install ends up looking broken' — which directly explains why `startOneService` must consult the feature-resolution object (shaped by `featureSet()`/`loadFeatures()`) before ever calling a service's `startFn`, rather than calling it and catching a failure.


## Hierarchy Context

### Parent
- [HostServiceStarter](./HostServiceStarter.md) -- start-services-robust.js defines SERVICE_CONFIGS and SERVICE_ORDER, asserted in tests/features/service-gating.test.mjs to cover each other exactly so no service is configured but never started

### Siblings
- [PortCleanup](./PortCleanup.md) -- [LLM] killProcessOnPortAndWait() in scripts/start-services-robust.js implements a two-phase escalation strategy: it first sends SIGTERM to all PIDs found via `lsof -ti:<port>`, then polls checkPortInUse() every pollIntervalMs, and only escalates to SIGKILL after `Date.now() - startTime > maxWaitMs / 2` has elapsed inside the same polling loop. This means the SIGKILL escalation is re-issued on every poll tick past the halfway mark (not just once), which is harmless for an already-dead process (process.kill throws and is silently caught) but means the function is deliberately imprecise about exactly when force-kill happens — it guarantees 'no later than half the timeout' rather than 'exactly at half the timeout'.
- [RequiredVsOptionalStartup](./RequiredVsOptionalStartup.md) -- [LLM] scripts/start-services-robust.js defines two classes of services via the `required` boolean in SERVICE_CONFIGS — transcriptMonitor and liveLoggingCoordinator are `required: true` with `maxRetries: 3` and `timeout: 20000`, while services like observationsApi and llmCliProxy are optional and degrade gracefully. The service-gating test in tests/features/service-gating.test.mjs ('a required failure blocks, so downstream services do not start') proves this isn't just a config label — startOneService() actually sets `out.blocked = true` on exhausted retries for a required service, and the test harness deliberately overrides `maxRetries` to 1 before testing this to avoid paying the real 3-attempt exponential backoff cost (documented inline as 'the real value costs six seconds of exponential waiting').


---

*Generated from 10 observations*
