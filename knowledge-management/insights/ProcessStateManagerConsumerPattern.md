# ProcessStateManagerConsumerPattern

**Type:** Detail

[Code References] scripts/start-services-robust.js:44 - `const psm = new ProcessStateManager();` module-level singleton instantiation; scripts/start-services-robust.js (transcriptMonitor.startFn) - triple liveness check: `psm.isServiceRunning('transcript-monitor','global')`, `psm.isServiceRunning('enhanced-transcript-monitor','per-project',{projectPath})`, `isProcessRunningByScript('enhanced-transcript-monitor.js')`; scripts/start-services-robust.js (transcriptMonitor.startFn, orphan branch) - `psm.registerService({name:'transcript-monitor', pid: osCheck.pid, type:'global', script:'scripts/enhanced-transcript-monitor.js'})`; scripts/start-services-robust.js (liveLoggingCoordinator.startFn) - two-step check `psm.isServiceRunning('live-logging-coordinator','global')` + `isProcessRunningByScript('live-logging-coordinator.js')`, no per-project variant; scripts/start-services-robust.js:63-77 - `isProcessRunningByScript(scriptPattern)` OS-level `pgrep -lf` fallback used by all PSM consumers in this file; start-services.sh - `node scripts/psm-register.js --check transcript-monitor global` bash-level PSM consumer via CLI wrapper; docker/entrypoint.sh - independent `/coding/.coding/runtime/features.json` snapshot mechanism, no PSM involvement, gates supervisord `autostart` instead; tests/features/service-gating.test.mjs - stubs `SERVICE_CONFIGS.transcriptMonitor.startFn` directly, bypassing any real PSM call during required-service-blocks-startup assertions

# ProcessStateManagerConsumerPattern

## What It Is

ProcessStateManagerConsumerPattern describes how `ProcessStateManager` (the parent component, defined in `process-state-manager.js`) is actually consumed by its call sites, primarily in `scripts/start-services-robust.js`. At line ~44, that file instantiates a single module-scoped instance — `const psm = new ProcessStateManager();` — and every service's `startFn` closure (e.g., `transcriptMonitor.startFn`, `liveLoggingCoordinator.startFn`) captures this same reference implicitly rather than receiving it as an explicit parameter. This pattern is distinct from its sibling entity, ServiceRegistrationLifecycle, which describes the cascading liveness-check *sequence* itself; ProcessStateManagerConsumerPattern is concerned with *who* calls PSM, *how* they obtain their reference to it, and how consistently they do so across the codebase — including bash-level consumers that never touch the class at all.

## Architecture and Design

The dominant pattern is a module-level singleton via closure capture: no dependency injection seam exists between `startOneService`, the `SERVICE_CONFIGS` table, and the `psm` object. This is a deliberate (if costly) simplicity trade-off — it avoids threading a `psm` argument through every service config — but it means substituting a fake `ProcessStateManager` for testing requires monkeypatching the module import rather than passing a mock through a public API.

Layered on top of this is a defensive multi-tier liveness check, shared conceptually with ServiceRegistrationLifecycle: PSM global check → PSM per-project check (only for `transcriptMonitor`) → OS-level `pgrep` fallback via `isProcessRunningByScript`. `liveLoggingCoordinator.startFn` duplicates this pattern but drops the per-project tier, since per-project coordination was retired in favor of `bin/coding` spawning `enhanced-transcript-monitor` per session directly. The result is two consumers of the same singleton implementing structurally similar but non-identical contracts — three checks versus two — which is exactly the kind of per-callsite drift that makes a shared abstraction hard to verify centrally.

A further architectural bifurcation exists outside this file entirely: Node-based host orchestration talks to PSM via its class API, while bash-based orchestration goes through a dedicated CLI wrapper, `scripts/psm-register.js` (invoked from `start-services.sh` as `node scripts/psm-register.js --check transcript-monitor global`). Meanwhile `docker/entrypoint.sh` bypasses PSM altogether, reading an independent JSON snapshot (`/coding/.coding/runtime/features.json`) to gate supervisord `autostart`. These two "already running" authorities are deliberately non-overlapping — one dedupes host processes by PID, the other gates container-level autostart — and are not expected to reconcile.

## Implementation Details

Within `transcriptMonitor.startFn`, PSM is read twice defensively (`psm.isServiceRunning('transcript-monitor','global')`, then the per-project variant scoped to `TARGET_PROJECT_PATH`) before falling back to the local `isProcessRunningByScript('enhanced-transcript-monitor.js')` helper (lines ~63-77), a thin wrapper over `pgrep -lf`. Only this third, OS-level branch calls `psm.registerService(...)`, and only as a repair action for a process PSM didn't know about — an orphan-recovery write, not a normal-path write. The actual fresh-spawn path further down calls `spawn('node', [...])` and returns `{ pid: child.pid, service: 'transcript-monitor' }` with no `psm.registerService` call whatsoever, implying registration for a freshly spawned process is either handled inside the imported `startServiceWithRetry` (from `../lib/service-starter.js`) or simply falls through uncaptured — an inconsistency the observations flag directly rather than resolve.

`liveLoggingCoordinator.startFn` mirrors this two-check-then-fallback shape but omits the per-project tier entirely. Both consumers rely on the same `isProcessRunningByScript` helper, making it the de facto shared reconciliation primitive between PSM's internal state and OS reality, even though it lives outside the `ProcessStateManager` class itself.

Separately, `killProcessOnPortAndWait` and `waitForPortBindable` implement port-based liveness/cleanup (`lsof -ti:${port}`, a throwaway `net.createServer().listen()` probe) that is structurally parallel to PSM's PID-based checks but entirely independent of it — PSM's schema only covers `transcript-monitor` and `live-logging-coordinator`, the two services `SERVICE_ORDER` requires to start first, leaving port-level concerns to local utilities in `start-services-robust.js`.

## Integration Points

ProcessStateManagerConsumerPattern connects PSM (parent) to three distinct consumer surfaces: (1) the closures in `SERVICE_CONFIGS` within `start-services-robust.js`, sharing the module-scoped `psm` singleton; (2) `lib/service-starter.js`'s `startServiceWithRetry`, suspected to hold the "real" registration responsibility for fresh spawns that `start-services-robust.js` itself skips; and (3) the CLI wrapper `scripts/psm-register.js`, which mediates bash-level access for `start-services.sh` without exposing the class API to shell scripts. It does *not* integrate with `docker/entrypoint.sh`'s `features.json` mechanism — that is a parallel, intentionally separate gating layer for supervisord autostart, not a PSM consumer.

The sibling entity ServiceRegistrationLifecycle documents the check-sequence contract this pattern's consumers implement; together they show PSM's real-world contract is defined less by the class itself and more by how each closure chooses to call it.

## Usage Guidelines

Developers extending `SERVICE_CONFIGS` should recognize that adding a new `startFn` means manually replicating the liveness-check cascade (or consciously diverging from it, as `liveLoggingCoordinator` does) — there is no enforced base class or shared helper beyond the standalone `isProcessRunningByScript` function. Because `psm` is closure-captured at module scope, any new test must stub the entire `startFn`, as `tests/features/service-gating.test.mjs` already does by replacing `SERVICE_CONFIGS.transcriptMonitor.startFn` wholesale; this test verifies orchestration-layer contracts (`blocked: true` propagation, `SERVICE_ORDER`/`SERVICE_CONFIGS` correspondence) but does not exercise PSM's own scope/PID-matching logic, so a regression causing `isServiceRunning` to always return `false` would pass unnoticed here. Anyone reasoning about "is this service running" logic should be aware there are two independent authorities in the system (PSM's PID registry vs. `docker/entrypoint.sh`'s `features.json`) that are not meant to be unified — conflating them would be a design error, not a bug fix. Finally, since `psm.registerService` is currently invoked only in orphan-repair branches, anyone auditing registration completeness must also check `lib/service-starter.js` to get the full picture; assuming `start-services-robust.js` alone captures PSM's write behavior will be misleading.


## Hierarchy Context

### Parent
- [ProcessStateManager](./ProcessStateManager.md) -- [CGR] ProcessStateManager (class) in process-state-manager.js

### Siblings
- [ServiceRegistrationLifecycle](./ServiceRegistrationLifecycle.md) -- [LLM] The `startFn` for `transcriptMonitor` in scripts/start-services-robust.js implements a cascading liveness-check pattern: PSM global check → PSM per-project check → OS-level `pgrep` fallback via `isProcessRunningByScript('enhanced-transcript-monitor.js')`. Each check short-circuits and returns `{ pid: 'already-running', skipRegistration: true }` or a real PID with `skipRegistration: true`, meaning the health-check function (`healthCheckFn`) must special-case `result.skipRegistration` to avoid re-validating a process it didn't spawn. This three-tier check is a direct architectural admission that PSM state can drift from OS reality.


---

*Generated from 9 observations*
