# ServiceOrderRegistry

**Type:** Detail

[Code References] tests/features/service-gating.test.mjs:34-38 - 'SERVICE_ORDER and SERVICE_CONFIGS cover each other exactly' structural diff test; tests/features/service-gating.test.mjs:83-89 - 'a REQUIRED service whose feature is off does not block startup' assertion; tests/features/service-gating.test.mjs:100-114 - 'a required failure blocks, so downstream services do not start' assertion; tests/features/service-gating.test.mjs:117-127 - unknown feature on a config throws rather than silently skipping; scripts/start-services-robust.js:54-72 - isProcessRunningByScript() pgrep-based orphan detection; scripts/start-services-robust.js:85-146 - killProcessOnPortAndWait() SIGTERM/SIGKILL escalation with polling; scripts/start-services-robust.js:156-171 - waitForPortBindable() TCP bind probe distinct from HTTP-based isPortListening(); scripts/start-services-robust.js:194-224 - transcriptMonitor.startFn three-tier PSM/OS duplicate-detection cascade with orphan re-registration; docker/entrypoint.sh:96-150 - PROGRAM_FEATURES mapping and node -e feature snapshot read with fail-open unknown-feature/missing-snapshot semantics; start-services.sh:12-20 - ROBUST_MODE dispatch to scripts/start-services-robust.js, else legacy bash path

# ServiceOrderRegistry: Technical Insight Document

## What It Is

ServiceOrderRegistry refers to the paired data structures `SERVICE_CONFIGS` and `SERVICE_ORDER`, exported from `scripts/start-services-robust.js`, which together form the declarative catalogue that its parent component StartServicesRobust walks at startup. `SERVICE_CONFIGS` is the map describing what each service *is* (its feature flag, whether it's `required`, its start function), while `SERVICE_ORDER` is the sequence dictating the order in which `startOneService()` iterates over them. The registry is directly exercised by `tests/features/service-gating.test.mjs`, which imports `startOneService`, `SERVICE_CONFIGS`, and `SERVICE_ORDER` as independently-testable units rather than treating them as private implementation details of an inlined startup loop.

## Architecture and Design

The core architectural pattern is a **registry with a structural coverage test**: rather than trusting developers to remember to update two related collections when adding a new service, `tests/features/service-gating.test.mjs` (lines 34-38) sorts and diffs the keys of `SERVICE_CONFIGS` and `SERVICE_ORDER`, failing loudly if they diverge. The test file's own header comment frames the motivation bluntly — "ten hand-written start blocks were ten chances to forget a gate" — indicating this registry replaced an earlier pattern of duplicated, per-service startup logic.

Layered on top of the registry is an **orthogonal classification system**: each service's disposition is determined by three independent axes — feature enabled/disabled, required/optional, succeeded/failed — collapsing into disjoint outcome buckets (`disabled`, `failed`, `degraded`, `successful`) rather than a single status enum. This is the concrete mechanism, described in the parent StartServicesRobust context, by which the toolkit "remains usable in a degraded state": degradation is a loop-continuation decision inside `startOneService()`, not a separate code path.

The registry also has a **fail-loud posture for internal inconsistency**: an unrecognized `feature` string on a single `SERVICE_CONFIGS` entry causes `startOneService()` to reject with `/unknown feature 'nope'/` rather than silently defaulting to enabled or disabled. This gives two independent tripwires at different granularities — the catalogue-level coverage test catches structural mismatches, while the per-call rejection catches typos in individual entries at runtime.

## Implementation Details

`startOneService()` interprets the registry's `feature` and `required` fields with a specific evaluation order that inverts a naive assumption: `required` is only consulted *after* determining the feature is enabled. A REQUIRED service whose feature is off does not block startup (`results.disabled`, `out.blocked = false`) — proven by the test "a REQUIRED service whose feature is off does not block startup." Only when a feature-on, required service fails does `out.blocked = true` propagate, halting further `SERVICE_ORDER` iteration ("a required failure blocks, so downstream services do not start," test lines 100-114). Feature-on, optional failures land in `results.failed` or `results.degraded` without blocking.

An unknown feature key throws synchronously rather than being silently coerced, per the test at lines 117-127, which asserts a rejected promise when `SERVICE_CONFIGS.observationsApi.feature` is set to a nonexistent value like `'nope'`.

## Integration Points

The registry is tightly coupled, by design, to `tests/features/service-gating.test.mjs`'s exact import surface — `startOneService`, `SERVICE_CONFIGS`, `SERVICE_ORDER` — meaning a rename of any of these breaks the test at the import line rather than at assertion time. This is a deliberate but fragile integration: it guarantees the test suite notices structural drift immediately, at the cost of any refactor requiring coordinated updates.

Within StartServicesRobust, the registry governs which services get PortCleanupUtilities-style defensive handling. Sibling logic like `killProcessOnPortAndWait()` (SIGTERM→poll→SIGKILL escalation) and `waitForPortBindable()` (TCP bind probing) and the `transcriptMonitor.startFn` PSM/pgrep/spawn cascade all execute *within* the per-service dispatch that the registry orders — the registry decides *whether and when* a service runs, while these siblings decide *how safely* it can be (re)started.

Notably, the registry has no shared-code relationship with `docker/entrypoint.sh`'s parallel feature-gating block; the two independently implement similar coverage-diff conventions but deliberately diverge in fail-direction (host fails closed for required services, container fails open on missing/unrecognized features), maintained only by convention and separate test suites (`container-gating.test.mjs` vs `service-gating.test.mjs`).

## Usage Guidelines

Any new service must be added to *both* `SERVICE_CONFIGS` and `SERVICE_ORDER`, or the coverage test fails — this is intentional friction preventing silent omissions. Every entry must declare a `feature` key, and that string must resolve to a known feature (checked against `lib/features/catalogue.cjs`'s `FEATURE_IDS`), or `startOneService()` throws at runtime. Developers should not assume `required: true` means "always blocks" — it only matters when the associated feature is enabled. When modifying `startOneService`, `SERVICE_CONFIGS`, or `SERVICE_ORDER` exports, expect `tests/features/service-gating.test.mjs` to break at import time if names change, and treat that coupling as a feature, not a bug, of the registry-consistency design. Finally, remember `start-services.sh`'s `ROBUST_MODE` dispatcher only exercises this registry-driven path by default; the legacy bash/docker-compose path bypasses the registry entirely and has no equivalent automated coverage.


## Hierarchy Context

### Parent
- [StartServicesRobust](./StartServicesRobust.md) -- [LLM] scripts/start-services-robust.js implements a two-class service model — REQUIRED (transcriptMonitor, liveLoggingCoordinator) vs OPTIONAL (everything else) — that is enforced not by a flag on the service itself but by how startOneService() (referenced in tests/features/service-gating.test.mjs) interprets the `required: true` field on SERVICE_CONFIGS entries. The test 'a required failure blocks, so downstream services do not start' confirms that a required-service failure sets `out.blocked = true` and halts SERVICE_ORDER iteration, while an optional failure is recorded in `results.failed` or `results.degraded` without stopping subsequent services. This is the concrete mechanism behind the parent-context claim that the toolkit 'should remain usable in a degraded state' — degradation is implemented as a loop-continuation decision, not a separate code path.

### Siblings
- [PortCleanupUtilities](./PortCleanupUtilities.md) -- [LLM] `killProcessOnPortAndWait()` in scripts/start-services-robust.js implements a SIGTERM-then-poll-then-SIGKILL escalation rather than a blind `kill -9`: it first checks `checkPortInUse()` via `lsof -ti:${port}`, sends SIGTERM to all owning PIDs, then polls every `pollIntervalMs` (default 200ms) up to `maxWaitMs` (default 5000ms), only escalating to SIGKILL once half the wait budget has elapsed. This two-phase design gives a well-behaved process a real chance to release its socket and flush state before being forcibly killed, while still guaranteeing termination within a hard deadline — a deliberate trade-off between graceful shutdown and startup-blocking latency.


---

*Generated from 10 observations*
