# ServiceCatalogueGating

**Type:** Detail

# ServiceCatalogueGating

## What It Is

ServiceCatalogueGating is a cross-cutting mechanism implemented across two independent process boundaries: the host-side Node orchestrator in `scripts/start-services-robust.js` (SERVICE_CONFIGS, `loadFeatures` from `lib/features/index.mjs`, `writeSnapshot` from `lib/features/snapshot.cjs`) and the container-side `docker/entrypoint.sh` (PROGRAM_FEATURES, `disabled.conf` generation for supervisord). It is a sub-mechanism of its parent, ServiceStarter, which is the broader orchestrator wrapping `lib/service-starter.js` primitives into the declarative `SERVICE_CONFIGS` catalogue. Where ServiceStarter is concerned with *how* a service starts and retries, ServiceCatalogueGating is concerned with *whether* it should be attempted at all, based on feature flags.

## Architecture and Design

The core pattern is a declarative catalogue: `SERVICE_CONFIGS` is a plain object keyed by service name, each entry a data tuple (`feature`, `psmPath`, `required`, `maxRetries`, `timeout`, `startFn`, `healthCheckFn`) consumed by a generic runner rather than per-service imperative logic. Gating is layered on top of this catalogue instead of being embedded per-`startFn`, centralizing the on/off decision in one enforcement point, `startOneService(key, results, featureSet)`.

The most significant architectural fact is that gating is mirrored, not shared: the host loop and container supervisord each implement equivalent semantics independently, with no shared code — one as a JS object walked by `startOneService`, the other as a whitespace-delimited `program:feature` string parsed via `node -e` snippets writing `[program:...]\nautostart=false` blocks. Consistency between the two is enforced entirely through separate structural test suites (`tests/features/service-gating.test.mjs` and the referenced `tests/features/container-gating.test.mjs`), not through any shared abstraction.

Both layers make the identical, deliberate design choice to fail open: an unrecognized or absent gating signal defaults to "enabled" rather than "disabled." This is explicit in entrypoint.sh's comment about stale snapshots and in the tests' assertion that a `required: true` service with its feature off does not block startup. This favors availability over isolation.

Configuration flows one-directionally: `loadFeatures()` → `writeSnapshot()` → mounted read-only `features.json` → entrypoint.sh's supervisord override — with no feedback path from container to host resolver.

## Implementation Details

`startOneService` is the enforcement point tested in `service-gating.test.mjs`: a disabled feature yields `blocked === false` with a `results.disabled` entry, never invoking `startFn` (verified via monkey-patching `SERVICE_CONFIGS.observationsApi.startFn`). An unknown feature string throws synchronously (`/unknown feature 'nope'/`) rather than silently skipping — an intentional fail-loud behavior distinct from the fail-open default for merely-absent signals. Critically, "disabled" and "degraded" are separate buckets: `required: true` only blocks startup when the feature is on but the start itself fails, not when the feature is off.

Structural invariants are pinned by assertion rather than type system: `SERVICE_ORDER.map(o => o.key).sort()` must equal `Object.keys(SERVICE_CONFIGS).sort()`, and the first two entries of `SERVICE_ORDER` must be `['transcriptMonitor', 'liveLoggingCoordinator']` because later services register against them — an ordering contract with no compile-time enforcement.

On the container side, `PROGRAM_FEATURES` pairs (e.g. `constraint-monitor:constraints`) are resolved against `/coding/.coding/runtime/features.json` per-program, generating `disabled.conf` for anything off; a matching test asserts this mapping covers exactly the `[program:...]` sections in `supervisord.conf`.

## Integration Points

ServiceCatalogueGating depends on `lib/features/index.mjs` and `lib/features/snapshot.cjs` for feature resolution and snapshot persistence, and on `docker/entrypoint.sh`/supervisord for container-side enforcement. It sits within ServiceStarter alongside siblings PortHealthChecks and PortReleaseWaiting (both implemented via `killProcessOnPortAndWait`/`waitForPortBindable`) and WithDeadlineRacing — these siblings handle port-level readiness, orthogonal to the feature-level on/off decision gating addresses. `start-services.sh`'s `ROBUST_MODE` exec-fallback pattern determines whether gating is even reachable: the legacy inline path (`ROBUST_MODE=false`) hardcodes which services to attempt and has no awareness of gating at all, making it a latent bypass.

## Usage Guidelines

Treat the fail-open default as intentional, not a bug: an absent or unrecognized feature signal should keep running rather than silently disable functionality — but this means gating is unsuitable for isolation-sensitive deployments without additional hardening. Never reorder `SERVICE_ORDER` without updating the coverage test, since registration dependencies (e.g., `transcriptMonitor`, `liveLoggingCoordinator` first) are enforced only by assertion. Avoid enabling `ROBUST_MODE=false` in production, as it bypasses gating entirely. Because the container has no closed feedback loop to the host resolver, always perform manual post-rebuild health verification (as noted in the container health-verification workflow) rather than trusting supervisord's "started successfully" signal alone.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The 'Coding-Services Docker Container — Health Verification Workflow' work record's emphasis on verifying supervised processes and health endpoints post-rebuild is a direct operational consequence of docker/entrypoint.sh's gating design: because `disabled.conf` is generated at container start from a snapshot the container did not produce and cannot validate against the host's live feature resolver, a stale or wrongly-written `features.json` would produce a container that reports itself healthy (supervisord started what it was told to) while actually missing a feature-gated program a downstream pipeline like wave-analysis depends on — the manual verification step exists precisely because this gating layer has no closed feedback loop back to the host.

## Hierarchy Context

### Parent
- [ServiceStarter](./ServiceStarter.md) -- [LLM] scripts/start-services-robust.js is the actual ServiceStarter implementation — a Node orchestrator that wraps lib/service-starter.js's startServiceWithRetry/createHttpHealthCheck/createPidHealthCheck primitives into a declarative SERVICE_CONFIGS map, each entry a {name, feature, psmPath, required, maxRetries, timeout, startFn, healthCheckFn} tuple. start-services.sh is a thin bash shim that execs this script when ROBUST_MODE=true (the default) and only falls back to an inline legacy bash startup path (manual docker-compose/lsof/kill logic) when ROBUST_MODE=false, meaning the legacy code in start-services.sh below the exec is dead in normal operation but kept for backward compatibility.

### Siblings
- [WithDeadlineRacing](./WithDeadlineRacing.md) -- [LLM] No file or function named "WithDeadlineRacing" appears anywhere in the supplied Code Files (docker/entrypoint.sh, scripts/prompt-classifier-service.mjs, scripts/start-services-robust.js, start-services.sh, tests/features/service-gating.test.mjs). The nearest thematic analogues are killProcessOnPortAndWait() and waitForPortBindable() in scripts/start-services-robust.js, which the parent context itself already describes as 'a graceful-then-forceful shutdown/startup race-avoidance pair' — but those two functions are the actual, differently-named implementation the parent observation refers to, not a distinct 'WithDeadlineRacing' entity.
- [PortHealthChecks](./PortHealthChecks.md) -- [LLM] scripts/start-services-robust.js implements two complementary port-health primitives that form a graceful-then-forceful lifecycle pair: killProcessOnPortAndWait(port, options) first checks occupancy via `lsof -ti:${port}`, sends SIGTERM to any owning PIDs, polls port occupancy at pollIntervalMs (default 200ms) up to maxWaitMs (default 5000ms), and escalates to SIGKILL only after half the timeout has elapsed — a deliberate grace window rather than an immediate hard kill. Its counterpart, waitForPortBindable(port, options), does not trust any HTTP-level signal; it repeatedly spins up a throwaway `net.createServer()` and attempts `.listen(port, host)`, resolving true only on the 'listening' event and false on 'error', because the function's own comment explains the kernel can hold a socket in a post-crash window where nothing answers HTTP probes yet EADDRINUSE still fires on bind. Together these functions treat 'is this port usable' as two distinct, unrelated questions — release-after-kill and bind-capability-after-restart — rather than one boolean.
- [PortReleaseWaiting](./PortReleaseWaiting.md) -- [LLM] scripts/start-services-robust.js implements two distinct port-release-waiting primitives that together form a graceful-then-forceful shutdown/startup handshake. `killProcessOnPortAndWait(port, options)` first checks port occupancy via `lsof -ti:${port}`, sends SIGTERM to any PIDs found, then polls with `checkPortInUse()` on a `pollIntervalMs` (default 200ms) cadence up to `maxWaitMs` (default 5000ms); only after half the timeout elapses does it escalate to SIGKILL. This two-phase escalation avoids killing processes that would have exited cleanly on their own, while still bounding total wait time so a hung process cannot stall the whole startup sequence indefinitely.


---

*Generated from 10 observations*
