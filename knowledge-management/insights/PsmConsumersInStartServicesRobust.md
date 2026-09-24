# PsmConsumersInStartServicesRobust

**Type:** Detail

## What It Is

`PsmConsumersInStartServicesRobust` describes how `scripts/start-services-robust.js` consumes its parent component, `ProcessStateManager`, as a shared runtime dependency. A single `ProcessStateManager` instance is instantiated once at module scope (`scripts/start-services-robust.js:60`: `const psm = new ProcessStateManager();`) and is reused across multiple independent service-start blocks — specifically `transcriptMonitor.startFn` and `liveLoggingCoordinator.startFn` — rather than each service constructing its own manager. This entity is not a class or module in its own right; it is the consumption pattern and set of call sites through which start-services-robust.js reads and writes PSM state before deciding whether to spawn a service.

## Architecture and Design

The dominant pattern is registry-with-reconciliation: PSM is treated as a fast cache of "is this service already running" state, but it is never trusted as sole source of truth. Every PSM check is layered with a raw OS-level `pgrep`-style scan (`isProcessRunningByScript`) defined in the same file, producing a three-tier liveness check in `transcriptMonitor.startFn`: global PSM scope, per-project PSM scope (with `TARGET_PROJECT_PATH`), then OS-level process scan. `liveLoggingCoordinator.startFn` repeats a simplified two-tier version of the same shape. This duplication is a notable design trade-off — there is no shared helper centralizing the PSM-then-pgrep sequence, so any future refinement (such as adding coordinator-side re-registration to match transcriptMonitor's) must be hand-applied per block.

The module-level singleton means all consuming blocks share fate: a bug in one service's registration bookkeeping (wrong `type`, wrong scope) is visible to every other block's `isServiceRunning` check for the process lifetime. Error handling is deliberately fail-open — a failed `registerService` reconciliation write is caught and logged as a warning rather than blocking the already-detected-running short-circuit, prioritizing availability of the skip-spawn decision over registry consistency.

## Implementation Details

When PSM and OS checks disagree — PSM has no record but `pgrep` finds a live orphan process — `transcriptMonitor.startFn` performs a live reconciliation write: `psm.registerService({ name: 'transcript-monitor', pid: osCheck.pid, type: 'global', script: 'scripts/enhanced-transcript-monitor.js' })`, wrapped in its own try/catch. Every early-return path arising from a positive PSM or OS check sets `skipRegistration: true` on the result object. The paired `healthCheckFn` explicitly trusts this flag: `if (result.skipRegistration) return true; return createPidHealthCheck()(result);` — meaning a PSM-satisfied "already running" claim is never independently re-verified by the retry/health-check machinery imported from `../lib/service-starter.js`.

An inline comment in `transcriptMonitor.startFn` clarifies historical context: the per-project PSM check predates a retirement (Phase 33 plan 07) of a per-project LSL coordinator that used to spawn these monitors; `bin/coding` now spawns `enhanced-transcript-monitor` directly per session, and the check remains as a guard against that direct-spawn path duplicating an existing per-project monitor rather than as active coordination with a still-living coordinator.

## Integration Points

The detach-and-unref spawning pattern (`spawn(..., { detached: true, ... })` followed by `child.unref()`) is directly why PSM registration matters here: once unref'd, the parent process loses visibility into the grandchild, and PSM's registry is the out-of-band mechanism that preserves that visibility — a concern independently echoed in the kgbench Benchmarking Harness work record's documentation of silent-kill and detachment failure modes for background runs. Structurally, `tests/features/service-gating.test.mjs` imports `startOneService`, `SERVICE_CONFIGS`, and `SERVICE_ORDER` from this file and asserts feature-gating and ordering properties, but exercises none of the PSM-specific branches — confirming the reconciliation logic runs unexercised by existing tests. The sibling entity `ServiceRegistration` could not be located in the supplied files at all, suggesting it may not exist as implemented code or was misretrieved via filename similarity to `registerService()`.

## Usage Guidelines

Developers modifying `start-services-robust.js` should treat the PSM API (`isServiceRunning(name, scope, options)`, `registerService(...)`) as tightly coupled to this file's specific two-tier-plus-scope usage pattern — changes to PSM's scope semantics (`'global'` vs `'per-project'`) will silently affect both consuming blocks. Because reconciliation writes are fail-open and health checks trust `skipRegistration` unconditionally, any change here should preserve the intent that a PSM/OS "already running" positive is authoritative for health purposes without re-verification. Given the identified duplication between `transcriptMonitor` and `liveLoggingCoordinator`, and the total absence of PSM-specific test coverage isolating registration/scope/orphan-reconciliation contracts, any nontrivial change to this consumption logic should be paired with new tests rather than relying on `tests/features/service-gating.test.mjs`, which deliberately does not exercise these paths.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The kgbench Benchmarking Harness work record documents recurring failure patterns for background runs — silent kills, tool-call timeout ceilings, and process-group kills — and the detachment strategies required so a spawned run survives past the tool-call lifetime that started it. This bears directly on `transcriptMonitor.startFn`'s `spawn(..., { detached: true, stdio: [...], cwd: CODING_DIR })` followed by `child.unref()` in scripts/start-services-robust.js: PSM's registration step exists precisely because a supervisor (or the parent Node process) loses direct visibility into a detached grandchild the moment it unrefs, the same visibility gap the kgbench record independently identifies as a source of silently-lost background work.

## Hierarchy Context

### Parent
- [ProcessStateManager](./ProcessStateManager.md) -- [CGR] ProcessStateManager (class) in process-state-manager.js

### Siblings
- [ServiceRegistration](./ServiceRegistration.md) -- [LLM] No file in the supplied set defines a class, module, or file named "ServiceRegistration" (or anything resembling it). The five files retrieved — docker/entrypoint.sh, scripts/prompt-classifier-service.mjs, scripts/start-services-robust.js, start-services.sh, and tests/features/service-gating.test.mjs — implement feature gating, service startup retry, and a classifier HTTP service, none of which are a registration component. This looks like a filename/neighborhood match on the parent's 'process-state-manager.js' and 'registerService()' terms rather than a retrieval of this entity's actual implementation.


---

*Generated from 10 observations*
