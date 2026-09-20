# ServiceGatingContract

**Type:** Detail

# ServiceGatingContract — Technical Insight Document

## What It Is

ServiceGatingContract is not a single mechanism but a policy that must hold consistently across three independently-evolving implementations. The host-side gate lives in `scripts/start-services-robust.js`, where `startOneService` checks `SERVICE_CONFIGS[key].feature` against the resolved output of `loadFeatures()` before starting, blocking, or skipping a service. The container-side gate lives in `docker/entrypoint.sh`, where a `PROGRAM_FEATURES` bash string is mapped through an inline `node -e` one-liner that reads `/coding/.coding/runtime/features.json`. The test-side gate is `tests/features/service-gating.test.mjs`, which structurally validates only the host-side implementation against `lib/features/catalogue.cjs`'s `FEATURE_IDS`. As the parent component, RobustServiceOrchestrator composes this contract along with sibling logic like PortCleanupLogic to determine whether, when, and how a service actually starts.

## Architecture and Design

The dominant pattern is feature-flag gating applied at service-orchestration granularity: each entry in `SERVICE_CONFIGS` declares a `feature` key resolved against `loadFeatures()`, producing skip/block/degrade decisions rather than a binary on/off. Layered on top is a result-classification state machine — `emptyResults()`'s mutually exclusive `disabled`, `degraded`, `failed`, and `successful` buckets — explicitly designed so a user's intentional `coding-features set <id> off` doesn't masquerade as a broken/degraded install on a health dashard.

A significant and consequential design asymmetry exists between the host and container gates: `startOneService` is fail-closed, rejecting an unknown feature loudly (`/unknown feature 'nope'/`), while `docker/entrypoint.sh` is fail-open twice over — an unreadable `FEATURES_SNAPSHOT` causes a "starting everything" fallback, and even when the snapshot loads, an unrecognized key inside the `node -e` script defaults to `enabled: true`. The same conceptual error (a service/program naming a nonexistent feature) therefore crashes on one side and silently no-ops on the other.

Required-ness is not an unconditional property: the test "a REQUIRED service whose feature is off does not block startup" encodes blocking semantics as `required AND enabled AND retriesExhausted`, not just `required AND retriesExhausted`. This conditional scoping is load-bearing for minimal/proxy-only install profiles (per the parent CLAUDE.md's Feature Modularity section) — turning off `lsl` disables `transcriptMonitor`/`liveLoggingCoordinator` without a separate required-flag flip.

Finally, `start-services.sh`'s `ROBUST_MODE` toggle is an architectural escape hatch: when `false`, it runs a fully independent legacy path (raw `docker-compose up -d`, manual `docker run` for Qdrant/Redis, git-clone bootstrapping) with zero reference to `SERVICE_CONFIGS`, `feature` keys, or `loadFeatures()`. The entire gating contract is opt-in via an environment variable, in tension with the project's stated "NO PARALLEL VERSIONS" rule.

## Implementation Details

`startOneService` in `scripts/start-services-robust.js` is the enforcement point of the host-side gate, consulting `SERVICE_CONFIGS[key].feature` and delegating actual retry mechanics to `startServiceWithRetry` from `lib/service-starter.js`. It relies on, but is tested independently from, lower-level primitives: sibling component PortCleanupLogic supplies `killProcessOnPortAndWait()` (graduated SIGTERM→SIGKILL escalation with `lsof -ti:${port}` polling via `checkPortInUse()`) and `waitForPortBindable()` (a throwaway `net.createServer().listen()` probe). Neither primitive is exercised by `service-gating.test.mjs`, which mocks `startFn` and validates only the skip/block/degrade decision logic, not the underlying port-race mitigations that make retries actually succeed.

`SERVICE_CONFIGS.transcriptMonitor.startFn` performs a triple-check (global PSM, per-project PSM, `isProcessRunningByScript` pgrep fallback) before declaring a service already running — evidence of defensive, conservative state-detection consistent with the contract's cautious philosophy elsewhere.

The test suite's `featureSet()` helper builds a synthetic `loadFeatures()`-shaped object by iterating the real `FEATURE_IDS` from `lib/features/catalogue.cjs` and defaulting every feature to `enabled: true` unless overridden. This guarantees new feature IDs don't break existing assertions, but it also means the tests never touch the real `loadFeatures()` resolver — only its ID surface — so a bug in real-world default-enabled-state resolution would go undetected here.

On the container side, `docker/entrypoint.sh` resolves `PROGRAM_FEATURES` against `features.json` via an inline Node snippet with no shared module with the host-side `lib/features/index.mjs`. A comment references `tests/features/container-gating.test.mjs` as validating this against `supervisord.conf`, but no such enforcement is visible in the observed structural tests.

## Integration Points

ServiceGatingContract sits inside RobustServiceOrchestrator, which is a thicker composition layer than a thin consumer of `lib/service-starter.js` — it imports `startServiceWithRetry`, `createHttpHealthCheck`, `createPidHealthCheck`, `isPortListening`, `isTcpPortListening`, `isProcessRunning`, and `sleep` from that module, but also defines substantial orchestration logic locally. It depends on `lib/features/catalogue.cjs` (`FEATURE_IDS`) for the canonical feature vocabulary and on `loadFeatures()` for runtime resolution. Its sibling, PortCleanupLogic, supplies the two composable-but-unlinked primitives (`killProcessOnPortAndWait`, `waitForPortBindable`) that gated services are expected to invoke manually before/after `startServiceWithRetry` — no code path automatically chains them. The container-side twin in `docker/entrypoint.sh` integrates with `supervisord.conf`'s `[program:...]` sections and the same `features.json` snapshot file, but through an entirely separate, non-shared resolution engine.

## Usage Guidelines

Any new feature ID added to `lib/features/catalogue.cjs` must be manually mirrored into `docker/entrypoint.sh`'s `PROGRAM_FEATURES` string and ideally into `supervisord.conf`, since no automated test currently guarantees this synchronization despite the comment claiming `container-gating.test.mjs` exists. Developers modifying `SERVICE_CONFIGS` should remember that `required: true` only blocks startup when the associated feature is also enabled — don't assume required implies unconditional blocking. When writing startup logic for a new service, both `killProcessOnPortAndWait()` and `waitForPortBindable()` should be explicitly composed (kill, then confirm) since the framework does not chain them automatically. Anyone touching `start-services.sh` should be aware that `ROBUST_MODE=false` completely bypasses this contract; the two paths should eventually be unified or the legacy path deprecated to honor the project's no-parallel-versions principle. Finally, because `featureSet()` in the test suite defaults all features to enabled, adding tests for a newly introduced feature's disabled-state behavior requires explicit overrides — it will not happen by default.


## Hierarchy Context

### Parent
- [RobustServiceOrchestrator](./RobustServiceOrchestrator.md) -- [LLM] The parent-context observations describe a wrapper-based process-management architecture (api-service.js, dashboard-service.js, lib/service-starter.js) that is largely superseded in the actual files shown here by scripts/start-services-robust.js, which implements its own retry/backoff logic directly rather than delegating entirely to lib/service-starter.js's startServiceWithRetry(). start-services-robust.js does import startServiceWithRetry, createHttpHealthCheck, createPidHealthCheck, isPortListening, isTcpPortListening, isProcessRunning, and sleep from '../lib/service-starter.js', confirming the layering described in the parent context, but it also defines significant orchestration logic locally (isProcessRunningByScript, killProcessOnPortAndWait, waitForPortBindable), suggesting RobustServiceOrchestrator is a thicker composition layer on top of the primitives rather than a thin consumer.

### Siblings
- [PortCleanupLogic](./PortCleanupLogic.md) -- [LLM] scripts/start-services-robust.js implements two independent, layered port-release strategies that are never unified: killProcessOnPortAndWait(port, options) actively frees a port by shelling out to `lsof -ti:${port}` to enumerate PIDs, sending SIGTERM to all of them, polling checkPortInUse() every pollIntervalMs (default 200ms), and escalating to SIGKILL only after maxWaitMs/2 has elapsed — a graduated-force pattern that trades a slower best case for avoiding data-loss from an immediate SIGKILL. This is distinct in purpose from waitForPortBindable(port, options), which does not kill anything; it passively waits for the kernel to release a socket by repeatedly attempting a throwaway `net.createServer().listen(port, host)` probe, closing it immediately on success. The two are meant to be composed (kill, then confirm bindability) but nothing in the visible source actually calls waitForPortBindable() from within killProcessOnPortAndWait() or vice versa — each SERVICE_CONFIGS.startFn would need to invoke both explicitly, which is a fragile manual composition rather than a single guaranteed cleanup primitive.


---

*Generated from 10 observations*
