# PortHealthChecks

**Type:** Detail

## What It Is

"PortHealthChecks" is not a discrete file, class, or module in the supplied codebase — it is a cross-cutting concern realized through several independently-written, structurally different implementations. The relevant code lives in three places: `scripts/start-services-robust.js` (Node, host-side — the actual `ServiceStarter` implementation), `docker/entrypoint.sh` (bash, container-side), and a dead legacy block in `start-services.sh` (bash, disabled by default under `ROBUST_MODE=true`). There is no unifying "PortHealthChecks" artifact tying these together; each mechanism was built locally to solve a version of the same problem — "is this port usable?" — for its own execution context.

## Architecture and Design

The dominant pattern across all three implementations is graceful-then-forceful escalation: attempt a clean signal (SIGTERM, or simply waiting) before resorting to a hard measure (SIGKILL, or giving up). `killProcessOnPortAndWait` in `scripts/start-services-robust.js` embodies this directly, escalating to SIGKILL only after half of `maxWaitMs` has elapsed, deliberately preserving a grace window rather than killing immediately.

A second pattern is the two-tier liveness check, distinguishing "is something answering" from "can I actually bind here." `waitForPortBindable` exists specifically because HTTP-level or registry-level signals can be silent during a kernel-held post-crash window where a bind attempt would still throw EADDRINUSE. This is conceptually distinct from, and complementary to, sibling entity PortReleaseWaiting's port-release semantics — together they form the release-then-rebind handshake described for host-side startup/restart.

A third recurring pattern is fail-open readiness: `docker/entrypoint.sh`'s `wait_for_service` returns success even after exhausting all attempts ("Don't fail - let supervisord handle it"), and it's invoked only conditionally when `QDRANT_URL`/`REDIS_URL` are set — meaning the container's only port-readiness gate can be skipped entirely, not merely degraded. This mirrors the fail-open philosophy documented elsewhere in the same script for feature-gating, and it stands in contrast to the host-side check, whose `false` return is a real, actionable retry-exhaustion signal for its callers.

Finally, a legacy/robust dual-path pattern is gated by `ROBUST_MODE`: `start-services.sh`'s `check_port`/`kill_port` are a cruder, non-graceful ancestor of the robust Node logic, kept alive as dead code for backward compatibility but not benefiting from any correctness fixes made in the robust path.

## Implementation Details

`killProcessOnPortAndWait(port, options)` checks occupancy via `lsof -ti:${port}`, sends SIGTERM to owning PIDs, and polls at `pollIntervalMs` (default 200ms) up to `maxWaitMs` (default 5000ms), escalating to SIGKILL once `Date.now() - startTime > maxWaitMs / 2`. This timing dependency is implicit and fragile: a large `pollIntervalMs` relative to `maxWaitMs` could cause the escalation check to be skipped or fire too close to the deadline, leaving insufficient time for the kernel to release the socket before the final `checkPortInUse()` gives up.

`waitForPortBindable(port, options)` takes a different approach entirely — it spins up a throwaway `net.createServer()` and calls `.listen(port, host)`, resolving `true` only on `'listening'` and `false` on `'error'`. This is a deliberately low-level probe, chosen because HTTP or registry checks cannot detect the specific EADDRINUSE race the function's own comments describe.

`docker/entrypoint.sh`'s `wait_for_service(name, host, port, max_attempts)` uses a bash `/dev/tcp` pseudo-file redirect wrapped in `timeout 2`, polling every 2 seconds up to `max_attempts` (default 30) — architecturally simpler and coarser than the Node-side checks, with no escalation and no bindability nuance.

The legacy `check_port`/`kill_port` pair in `start-services.sh` uses `lsof -i :$port` and `kill -9` directly, with no grace period, no polling for release, and no bindability verification — a strictly cruder implementation that only runs when `ROBUST_MODE=false`.

Separately, `transcriptMonitor`'s `startFn` layers PSM registry checks plus `isProcessRunningByScript`'s `pgrep` fallback as a process-existence check — conceptually parallel to but implementation-distinct from these port-based checks, reflecting that "is this service up" is answered by multiple, non-unified mechanisms even within a single orchestrator file.

## Integration Points

These port-health primitives are locally-scoped helpers inside `scripts/start-services-robust.js`, not part of the exported `SERVICE_CONFIGS`/`SERVICE_ORDER` contract that sibling entity ServiceCatalogueGating builds and that `tests/features/service-gating.test.mjs` enforces structurally. `lib/service-starter.js` is imported for `createHttpHealthCheck`, `createPidHealthCheck`, `isPortListening`, and `isTcpPortListening`, but its implementation isn't present in the supplied files, so the canonical health-check primitives referenced by `SERVICE_CONFIGS` entries can't be directly verified against these port-health helpers.

On the container side, `docker/entrypoint.sh`'s readiness gate for Qdrant/Redis runs before supervisord starts, and is architecturally disconnected from the host-side Node checks — different language, different mechanism (`/dev/tcp` vs `net.createServer`), same underlying question.

## Usage Guidelines

Developers modifying `killProcessOnPortAndWait`'s timing parameters should keep `pollIntervalMs` meaningfully smaller than `maxWaitMs` to guarantee the SIGKILL escalation actually fires with enough runway before the deadline — this invariant is not covered by `tests/features/service-gating.test.mjs`, which only checks `SERVICE_CONFIGS`/`SERVICE_ORDER` structure, not port-helper timing behavior. Anyone re-enabling `ROBUST_MODE=false` should be aware the legacy `check_port`/`kill_port` path in `start-services.sh` has not received any of the reliability fixes (e.g., the EADDRINUSE race handling in `waitForPortBindable`) present in the robust path, and can silently diverge in behavior. Finally, because `docker/entrypoint.sh`'s readiness gate is skipped entirely when `QDRANT_URL`/`REDIS_URL` are unset, and fails open on exhaustion regardless, it should not be relied upon as a hard precondition — it is advisory logging consistent with the broader fail-open posture of that script, not a blocking gate.


## Hierarchy Context

### Parent
- [ServiceStarter](./ServiceStarter.md) -- [LLM] scripts/start-services-robust.js is the actual ServiceStarter implementation — a Node orchestrator that wraps lib/service-starter.js's startServiceWithRetry/createHttpHealthCheck/createPidHealthCheck primitives into a declarative SERVICE_CONFIGS map, each entry a {name, feature, psmPath, required, maxRetries, timeout, startFn, healthCheckFn} tuple. start-services.sh is a thin bash shim that execs this script when ROBUST_MODE=true (the default) and only falls back to an inline legacy bash startup path (manual docker-compose/lsof/kill logic) when ROBUST_MODE=false, meaning the legacy code in start-services.sh below the exec is dead in normal operation but kept for backward compatibility.

### Siblings
- [WithDeadlineRacing](./WithDeadlineRacing.md) -- [LLM] No file or function named "WithDeadlineRacing" appears anywhere in the supplied Code Files (docker/entrypoint.sh, scripts/prompt-classifier-service.mjs, scripts/start-services-robust.js, start-services.sh, tests/features/service-gating.test.mjs). The nearest thematic analogues are killProcessOnPortAndWait() and waitForPortBindable() in scripts/start-services-robust.js, which the parent context itself already describes as 'a graceful-then-forceful shutdown/startup race-avoidance pair' — but those two functions are the actual, differently-named implementation the parent observation refers to, not a distinct 'WithDeadlineRacing' entity.
- [PortReleaseWaiting](./PortReleaseWaiting.md) -- [LLM] scripts/start-services-robust.js implements two distinct port-release-waiting primitives that together form a graceful-then-forceful shutdown/startup handshake. `killProcessOnPortAndWait(port, options)` first checks port occupancy via `lsof -ti:${port}`, sends SIGTERM to any PIDs found, then polls with `checkPortInUse()` on a `pollIntervalMs` (default 200ms) cadence up to `maxWaitMs` (default 5000ms); only after half the timeout elapses does it escalate to SIGKILL. This two-phase escalation avoids killing processes that would have exited cleanly on their own, while still bounding total wait time so a hung process cannot stall the whole startup sequence indefinitely.
- [ServiceCatalogueGating](./ServiceCatalogueGating.md) -- [LLM] scripts/start-services-robust.js implements the actual service catalogue: SERVICE_CONFIGS is a plain object keyed by service name (transcriptMonitor, liveLoggingCoordinator, and others truncated in the excerpt), each entry declaring a `feature` string, a `psmPath`, `required`, `maxRetries`, `timeout`, `startFn`, and `healthCheckFn`. Gating is layered on top of this catalogue rather than baked into each `startFn`: the file imports `loadFeatures` from `lib/features/index.mjs` and calls `writeSnapshot` from `lib/features/snapshot.cjs`, meaning the same process that decides which services to attempt locally is also the writer of the flat snapshot that `docker/entrypoint.sh` later reads to gate the container's supervisord programs — one Node process is upstream of two independent gating mechanisms (host loop, container supervisord).


---

*Generated from 9 observations*
