# RetryWithDeadlineStarter

**Type:** Detail

# RetryWithDeadlineStarter

## What It Is

RetryWithDeadlineStarter is the core retry/backoff mechanism implemented in `lib/service-starter.js`, exposed primarily through the `startServiceWithRetry` function and its supporting health-check factories (`createHttpHealthCheck`, `createPidHealthCheck`) and probing utilities (`isPortListening`, `isTcpPortListening`, `isProcessRunning`, `sleep`). It is consumed by `scripts/start-services-robust.js`, which imports these primitives and wires them into a per-service `startFn`/`healthCheckFn` pair for every entry in `SERVICE_CONFIGS`. As a child of the broader ServiceStarter component, RetryWithDeadlineStarter is the generic "how to retry" engine, deliberately kept ignorant of "how to start this particular thing" — that knowledge lives entirely in the service-specific closures defined by the parent.

## Architecture and Design

The defining architectural decision is separation of concerns: retry/deadline mechanics (exponential backoff, `maxRetries`, timeout/deadline semantics) are centralized once in `lib/service-starter.js` and reused across every entry in `SERVICE_ORDER` — including `transcriptMonitor` and `liveLoggingCoordinator` — rather than reimplemented per service. This means changes to backoff timing or deadline logic require touching a single file, not the ten-plus service-specific start functions in `scripts/start-services-robust.js`.

This starter is intentionally positioned as the *last* stage in a pipeline of increasingly cheap guards. Upstream, its sibling **FeatureGatedServiceCatalogue** ensures `startOneService()` never even calls into the retry loop for disabled features — confirmed by tests asserting `startFn` is never invoked when a feature is off, and by the fail-closed exception where an unknown feature string causes `startOneService('observationsApi', ...)` to reject with `/unknown feature 'nope'/` rather than silently skipping. Also upstream, `isProcessRunningByScript()`'s three-tier idempotency check (global PSM → per-project PSM → `pgrep` fallback) short-circuits the warm-restart case entirely, returning `{ pid: 'already-running', skipRegistration: true }` before `startServiceWithRetry` is ever invoked. Its sibling **PortReleaseAndBindability** (`waitForPortBindable()`, `killProcessOnPortAndWait()`) similarly operates just outside the retry abstraction, treating pre-flight cleanup as a distinct concern from health-check polling.

## Implementation Details

`startServiceWithRetry` drives an exponential backoff loop bounded by a per-service `maxRetries` value stored on `SERVICE_CONFIGS` (e.g., `SERVICE_CONFIGS.transcriptMonitor.maxRetries`). Tests confirm this is genuinely exponential rather than fixed-interval: `tests/features/service-gating.test.mjs` overrides `maxRetries = 1` specifically to avoid paying "six seconds of exponential waiting" in the real configuration, treating the config field as a mutable test knob rather than a constant baked into the starter.

Health checking is pluggable via `healthCheckFn`, generated from `createHttpHealthCheck`/`createPidHealthCheck` or hand-written per service. Notably, the `healthCheckFn` for idempotent services must special-case the skip path: `async (result) => { if (result.skipRegistration) return true; ... }`, so a warm restart that never spawned a process doesn't spuriously enter health-check polling.

Pre-flight helpers protect the finite retry budget rather than relying on the loop to absorb transient conditions. `waitForPortBindable()` uses a throwaway `net.createServer().listen()` probe instead of the HTTP-level `isPortListening()`, because a kernel-held socket after a crash causes `EADDRINUSE` on spawn without answering HTTP probes — a distinction that would otherwise silently burn a retry attempt.

## Integration Points

RetryWithDeadlineStarter's terminal outcome (success, degraded, or exhausted failure) is read by `startOneService()`, which couples it to the `required: true`/`false` flag on each `SERVICE_CONFIGS` entry to decide whether to set a `blocked` control-flow signal that halts `SERVICE_ORDER` iteration — verified by the test asserting `out.blocked === true` and `results.failed[0].required === true` once retries are exhausted. This ties the generic starter to config-driven, service-specific control flow that lives outside `lib/service-starter.js` itself.

It also depends on upstream feature-gate resolution (`loadFeatures`) performed by the parent ServiceStarter/FeatureGatedServiceCatalogue, and downstream on pre-flight guards from PortReleaseAndBindability and `isProcessRunningByScript()`.

## Usage Guidelines

Developers should never bypass the idempotency and port-bindability pre-checks when adding new `startFn` implementations — burning `maxRetries` on conditions like stale TIME_WAIT sockets or already-running processes defeats the purpose of the bounded retry budget. When testing services with meaningful `maxRetries`, mutate the config value directly (as the gating tests do) rather than waiting out real backoff. Any new service must set both `required` and `feature` correctly, since these fields — not the retry starter itself — determine whether exhaustion blocks startup and whether the starter is invoked at all.


## Hierarchy Context

### Parent
- [ServiceStarter](./ServiceStarter.md) -- [LLM] scripts/start-services-robust.js implements a feature-gated service catalogue via SERVICE_CONFIGS and SERVICE_ORDER, where each service declares a 'feature' string that is checked against a loaded feature set (loadFeatures from lib/features/index.mjs) before startOneService() decides to skip, start, or block. This is a formalization of the docker/entrypoint.sh PROGRAM_FEATURES mapping seen for the containerized path — both the host and container execution paths implement the same feature-gating concept but via entirely separate mechanisms (JS object config vs shell/supervisord conf generation), meaning any new feature must be wired into both places or the two deployment modes will drift, a risk explicitly guarded against by tests/features/service-gating.test.mjs's 'SERVICE_ORDER and SERVICE_CONFIGS cover each other exactly' assertion.

### Siblings
- [FeatureGatedServiceCatalogue](./FeatureGatedServiceCatalogue.md) -- [LLM] scripts/start-services-robust.js's SERVICE_CONFIGS object gates every host service through a single 'feature' string checked before startFn executes, and tests/features/service-gating.test.mjs enforces this exhaustively: 'every service declares a feature' fails the build if any entry in SERVICE_CONFIGS omits the field, 'every declared feature is a real one' cross-checks the string against FEATURE_IDS from lib/features/catalogue.cjs, and 'SERVICE_ORDER and SERVICE_CONFIGS cover each other exactly' guarantees the two parallel data structures (an object keyed by service name, and an ordered array used for sequencing) never drift apart. This is a case where the test suite is doing structural type-checking that a real type system would normally provide — the JS object literal has no compile-time guarantee that SERVICE_ORDER and Object.keys(SERVICE_CONFIGS) stay in sync, so the test exists purely to catch a class of error (forgetting to add a new service to one of the two lists) that would otherwise silently manifest as a service that never starts.
- [PortReleaseAndBindability](./PortReleaseAndBindability.md) -- [LLM] scripts/start-services-robust.js's waitForPortBindable() and killProcessOnPortAndWait() encode two separate theories of what 'the port is free' means, and the comment on waitForPortBindable() explicitly justifies why a second check is needed even after killProcessOnPortAndWait() reports success: a throwaway net.createServer().listen() probe on host '0.0.0.0' detects kernel-level TIME_WAIT-style unavailability that isPortListening() (an HTTP-level check per lib/service-starter.js) cannot see, since a crashed process leaves no HTTP listener to probe against but may still leave the socket held by the kernel. This means a caller that only uses killProcessOnPortAndWait() and then immediately spawns a new service risks an EADDRINUSE crash that silently consumes one of startServiceWithRetry()'s maxRetries slots — the two functions are not redundant, they cover disjoint failure windows in the same port-release lifecycle.


---

*Generated from 10 observations*
