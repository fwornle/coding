# FeatureGatedServiceCatalogue

**Type:** Detail

[LLM] The test suite pays an explicit performance cost to test the required-failure-blocks path: 'a required failure blocks, so downstream services do not start' overrides SERVICE_CONFIGS.transcriptMonitor.maxRetries from its production value down to 1, with the comment 'the real value costs six seconds of exponential waiting.' This is a test-only mutation of production config performed via a try/finally that restores originalRetries afterward, revealing that startServiceWithRetry() (imported from lib/service-starter.js per start-services-robust.js's import block, though not shown in the truncated excerpt) implements exponential backoff whose total wait time scales with maxRetries in a way that's expensive enough to matter in a test suite's runtime. This pattern — temporarily monkey-patching a module-level config object's field for the duration of one test — is fragile because SERVICE_CONFIGS is a shared, mutable singleton imported directly rather than injected, so parallel test execution (if node:test ever ran files concurrently within the same process) could see cross-test interference; the try/finally mitigates this only for sequential execution.

# FeatureGatedServiceCatalogue — Technical Insight Document

## What It Is

FeatureGatedServiceCatalogue is the policy layer implemented in `scripts/start-services-robust.js` that determines which host services actually start, based on feature flags. Its core data structures are `SERVICE_CONFIGS` (an object keyed by service name, each entry declaring a `feature` string, an optional `required` boolean, a `startFn`, and retry parameters like `maxRetries`) and `SERVICE_ORDER` (an array establishing startup sequencing). A concrete example is the `transcriptMonitor` entry at `scripts/start-services-robust.js:170-200`, which declares `feature: 'lsl'` and `required: true`.

This catalogue is the host-side counterpart to `docker/entrypoint.sh`'s `PROGRAM_FEATURES` mapping, which encodes the same policy — which feature gates which running thing — for the containerized deployment path. As the parent component **ServiceStarter** description notes, both mechanisms exist because the host and container execution paths never converged on a single source of truth.

## Architecture and Design

The dominant pattern is **uniform feature-flag gating before invocation**: every service in `SERVICE_CONFIGS` is checked against a loaded feature set (via `loadFeatures` from `lib/features/index.mjs`) before `startOneService()` decides to skip, start, or block it. This is enforced structurally, not just at runtime — `tests/features/service-gating.test.mjs` acts as a compile-time-type-system substitute in a codebase without one, running assertions like "every service declares a feature" (lines 38-44) and "SERVICE_ORDER and SERVICE_CONFIGS cover each other exactly" (lines 52-56) to guarantee the two parallel structures never drift apart.

A second key pattern is the **four-way result state machine** — `successful`, `degraded`, `failed`, `disabled` — returned by `startOneService()`. This is a manual discriminated union (parallel arrays rather than a typed enum), and the test "a disabled service is not reported as degraded" (lines 76-90) encodes the operational rationale: conflating "user chose not to run this" with "this failed to start" would send a monitoring consumer down the wrong remediation path.

A third pattern is the **orthogonality of `required` and feature-enablement**. `required` only becomes meaningful when the feature is on — a required-but-disabled service does not block startup, while a required-and-enabled service that throws does (`out.blocked === true`). This implies a strict internal ordering: the feature gate must be evaluated before the required-flag check, an invariant that is test-enforced ("required-ness applies only when the feature is on") but not structurally guaranteed by the code shape — an easy refactor hazard.

Finally, there's a deliberate **fail-open vs. fail-loud asymmetry** across layers: `docker/entrypoint.sh` treats an unrecognized feature key as enabled (fail-open, since the container's `feature.json` is untrusted external data), whereas `SERVICE_CONFIGS` treats an unknown feature string as a bug and throws (`/unknown feature 'nope'/`), because a bad string there stems from first-party code (a typo or stale rename against `lib/features/catalogue.cjs`).

## Implementation Details

`startOneService()` is the central function: it checks the feature flag, branches on `disabled`/`required`/`failed`/`degraded`/`successful`, and populates the appropriate results bucket. Its actual process-spawning and retry mechanics are delegated to the sibling **RetryWithDeadlineStarter**, i.e., `startServiceWithRetry()` in `lib/service-starter.js`, along with health-check helpers (`createHttpHealthCheck`, `createPidHealthCheck`, `isPortListening`, `isProcessRunning`). This separation means `start-services-robust.js` only supplies per-service `startFn`/`healthCheckFn` closures, keeping backoff/deadline logic centralized.

Port lifecycle handling is delegated to the sibling **PortReleaseAndBindability**, whose `waitForPortBindable()` and `killProcessOnPortAndWait()` cover disjoint failure windows (kernel TIME_WAIT vs. HTTP-listener liveness) before a service is (re)started.

Testing this control flow is expensive: exponential backoff means the "required failure blocks" test must temporarily monkey-patch `SERVICE_CONFIGS.transcriptMonitor.maxRetries` down to 1 (from a production value costing "six seconds of exponential waiting"), restoring it via try/finally. This is fragile — `SERVICE_CONFIGS` is a shared, mutable singleton rather than an injected dependency, so isolation depends on careful manual cleanup rather than structural guarantees.

On the container side, `docker/entrypoint.sh` implements feature lookup via an inline `node -e` snippet reimplementing "unknown key defaults to true" fail-open semantics by hand (`value === false ? "false" : "true"`), rather than importing `lib/features/index.mjs`/`lib/features/catalogue.cjs`. This is a third independent implementation of the same fail-open logic, untested by `tests/features/service-gating.test.mjs`.

## Integration Points

FeatureGatedServiceCatalogue is a child of **ServiceStarter**, formalizing the feature-gating concept that also appears in `docker/entrypoint.sh`. It depends on `lib/features/index.mjs`'s `loadFeatures` and `lib/features/catalogue.cjs`'s `FEATURE_IDS` for validation. It hands off actual process lifecycle work to its siblings **RetryWithDeadlineStarter** (`lib/service-starter.js`) and **PortReleaseAndBindability** (`waitForPortBindable`, `killProcessOnPortAndWait`), plus orphan detection via `isProcessRunningByScript()`'s pgrep scan. Cross-artifact consistency between `SERVICE_CONFIGS`, `PROGRAM_FEATURES`, and `supervisord.conf` is maintained not by shared code but by two separate test suites (`tests/features/service-gating.test.mjs` and `tests/features/container-gating.test.mjs`).

## Usage Guidelines

When adding a new service, it must be added to both `SERVICE_CONFIGS` and `SERVICE_ORDER` (test-enforced), given a valid `feature` string that exists in `FEATURE_IDS`, and — if it should ever block startup — marked `required: true` with the understanding that this only takes effect when its feature is enabled. When adding or renaming a feature, all three artifacts (`SERVICE_CONFIGS`, `PROGRAM_FEATURES`, `supervisord.conf`) and the inline `node -e` snippet in `docker/entrypoint.sh` must be updated in lockstep, since none of them can validate against each other automatically. Developers modifying `startOneService()`'s control flow must preserve the feature-check-before-required-check ordering; inverting it silently breaks the "required-but-disabled shouldn't block" contract. Anyone changing `maxRetries` semantics should be aware that tests deliberately shrink retry counts for speed, and that this pattern of mutating shared singleton config depends on faithful try/finally cleanup to avoid cross-test contamination.


## Hierarchy Context

### Parent
- [ServiceStarter](./ServiceStarter.md) -- [LLM] scripts/start-services-robust.js implements a feature-gated service catalogue via SERVICE_CONFIGS and SERVICE_ORDER, where each service declares a 'feature' string that is checked against a loaded feature set (loadFeatures from lib/features/index.mjs) before startOneService() decides to skip, start, or block. This is a formalization of the docker/entrypoint.sh PROGRAM_FEATURES mapping seen for the containerized path — both the host and container execution paths implement the same feature-gating concept but via entirely separate mechanisms (JS object config vs shell/supervisord conf generation), meaning any new feature must be wired into both places or the two deployment modes will drift, a risk explicitly guarded against by tests/features/service-gating.test.mjs's 'SERVICE_ORDER and SERVICE_CONFIGS cover each other exactly' assertion.

### Siblings
- [RetryWithDeadlineStarter](./RetryWithDeadlineStarter.md) -- [LLM] scripts/start-services-robust.js delegates the actual spawn/health-check/backoff loop to `startServiceWithRetry` (imported from `../lib/service-starter.js` alongside `createHttpHealthCheck`, `createPidHealthCheck`, `isPortListening`, `isTcpPortListening`, `isProcessRunning`, and `sleep`), while the robust-starter file itself only supplies per-service `startFn`/`healthCheckFn` closures inside `SERVICE_CONFIGS`. This is a clean separation of 'how to retry' from 'how to start this particular thing': the retry/deadline mechanics live once in `lib/service-starter.js` and are reused across `transcriptMonitor`, `liveLoggingCoordinator`, and every other entry in `SERVICE_ORDER`, so a change to backoff timing or deadline semantics does not require touching any of the ten-plus service-specific start functions.
- [PortReleaseAndBindability](./PortReleaseAndBindability.md) -- [LLM] scripts/start-services-robust.js's waitForPortBindable() and killProcessOnPortAndWait() encode two separate theories of what 'the port is free' means, and the comment on waitForPortBindable() explicitly justifies why a second check is needed even after killProcessOnPortAndWait() reports success: a throwaway net.createServer().listen() probe on host '0.0.0.0' detects kernel-level TIME_WAIT-style unavailability that isPortListening() (an HTTP-level check per lib/service-starter.js) cannot see, since a crashed process leaves no HTTP listener to probe against but may still leave the socket held by the kernel. This means a caller that only uses killProcessOnPortAndWait() and then immediately spawns a new service risks an EADDRINUSE crash that silently consumes one of startServiceWithRetry()'s maxRetries slots — the two functions are not redundant, they cover disjoint failure windows in the same port-release lifecycle.


---

*Generated from 10 observations*
