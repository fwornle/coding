# ServiceRegistrationLifecycle

**Type:** Detail

[Architecture Notes] PSM is treated as a best-effort cache of process state, not a source of truth, requiring OS-level pgrep fallback verification; Two independent gating layers exist: PSM-based host process gating (start-services-robust.js) and supervisord-based container gating (docker/entrypoint.sh), with no visible cross-linkage; Registration writes to PSM appear only in exceptional/orphan paths in the shown code, suggesting normal-path registration may live in lib/service-starter.js (startServiceWithRetry), an unverified assumption; Test coverage (service-gating.test.mjs) validates orchestration-layer contracts (SERVICE_ORDER, blocking, feature gating) but leaves PSM's internal registration/query correctness untested; start-services.sh and start-services-robust.js form a legacy/modern dual-path architecture switched by the ROBUST_MODE environment variable

# ServiceRegistrationLifecycle

## What It Is

ServiceRegistrationLifecycle describes how services—most concretely the `transcriptMonitor` entry in `SERVICE_CONFIGS` within `scripts/start-services-robust.js`—are checked for liveness, spawned, and (sometimes) registered with `ProcessStateManager` (PSM), its parent component. The lifecycle is not a single unified mechanism but a layered set of checks and writes that span at least two independent gating systems: PSM-based host process gating in `start-services-robust.js`/`start-services.sh`, and supervisord-based container gating in `docker/entrypoint.sh`. There is no visible code linking these two layers, and they govern different service sets (transcript/constraint monitors on the host side vs. semantic-analysis, graphify, constraint-monitor, etc. in the container's `features.json`-driven `disabled.conf` generation).

## Architecture and Design

The dominant pattern is cascading, fail-open liveness verification before any spawn decision. The `transcriptMonitor.startFn` performs a PSM global check, then a PSM per-project check, then an OS-level `pgrep` fallback via `isProcessRunningByScript('enhanced-transcript-monitor.js')`, short-circuiting at the first positive match and returning `{ pid, skipRegistration: true }`. This three-tier redundancy is itself an architectural admission that PSM state can drift from OS reality—PSM is a best-effort cache, not a source of truth, as reinforced by sibling entity ProcessStateManagerConsumerPattern's observation that `psm` is a module-singleton captured via closure rather than injected.

A second pattern is self-healing state reconciliation: when the pgrep fallback discovers an orphaned process PSM didn't know about, the code re-registers it via `psm.registerService({name, pid, type, script})`—the only visible explicit registration call in the shown code. Normal-path spawns (`child.unref()`, returning `{ pid: child.pid, service: 'transcript-monitor' }`) show no corresponding registration, suggesting that path either relies on `startServiceWithRetry` (from `lib/service-starter.js`) to register, or has a structural gap.

A third pattern is legacy/modern dual-path migration: `start-services.sh` duplicates the same PSM check at the bash level via `node scripts/psm-register.js --check transcript-monitor global`, while `ROBUST_MODE=true` delegates to the newer Node starter. This coexistence indicates an in-progress migration rather than a finished design.

## Implementation Details

The core mechanics live in `SERVICE_CONFIGS.transcriptMonitor.startFn` and its companion `healthCheckFn`, which must special-case `result.skipRegistration` to avoid re-validating a process it didn't spawn. `isProcessRunningByScript` implements the OS-level fallback with explicit fail-open semantics ("If pgrep fails, assume not running"). The orphan-recovery branch wraps `psm.registerService(...)` in a try/catch that swallows failures with a warning ("Could not re-register with PSM") and proceeds regardless—PSM writes are best-effort bookkeeping, never a gate blocking startup. On the container side, `docker/entrypoint.sh` reads `.coding/runtime/features.json` and writes `[program:name]\nautostart=false` stanzas to `/etc/supervisor/features.d/disabled.conf`, with unknown/missing feature keys defaulting to `enabled=true` and missing snapshots starting everything—mirroring the same fail-open philosophy at a different layer.

## Integration Points

ServiceRegistrationLifecycle is a child concept under parent ProcessStateManager, and shares the same startup module with sibling ProcessStateManagerConsumerPattern, which documents how `psm` is instantiated once at module scope and captured by closure across all `SERVICE_CONFIGS` startFns—meaning any registration behavior here inherits that same lack of dependency injection. It integrates with `lib/service-starter.js`'s `startServiceWithRetry` (unverified as the true home of happy-path registration), with `lib/features/catalogue.cjs`'s `FEATURE_IDS` (validated by `tests/features/service-gating.test.mjs`), and indirectly with the container orchestration layer via `docker/entrypoint.sh`, though no code bridges PSM state and supervisord state.

## Usage Guidelines

Developers should treat PSM registration as advisory, not authoritative—health checks and new features must tolerate stale or missing PSM entries and fall back to OS-level verification as `isProcessRunningByScript` does. Any new service added to `SERVICE_CONFIGS` should be paired with a `SERVICE_ORDER` entry and a valid `cfg.feature` in `FEATURE_IDS`, since `tests/features/service-gating.test.mjs` enforces exact structural coverage and throws on unknown features. Because this test suite stubs `startFn` wholesale and never exercises PSM directly, changes to registration semantics (especially the orphan-recovery write path or the suspected `startServiceWithRetry` registration) should be manually verified rather than relied upon for test coverage. Finally, follow the established fail-open convention: uncertain lifecycle state should resolve toward allowing startup, not blocking it, consistent with both the host-side pgrep fallback and the container-side feature-snapshot defaults.


## Hierarchy Context

### Parent
- [ProcessStateManager](./ProcessStateManager.md) -- [CGR] ProcessStateManager (class) in process-state-manager.js

### Siblings
- [ProcessStateManagerConsumerPattern](./ProcessStateManagerConsumerPattern.md) -- [LLM] `scripts/start-services-robust.js` instantiates `ProcessStateManager` exactly once at module scope (`const psm = new ProcessStateManager();`, line ~44) and every `startFn` closure inside `SERVICE_CONFIGS` (e.g. `transcriptMonitor.startFn`, `liveLoggingCoordinator.startFn`) captures that same reference via closure rather than receiving it as a parameter. This is a module-singleton-via-closure pattern rather than dependency injection: `startOneService` and the service configs have no explicit `psm` argument, so any test wanting to substitute a fake `ProcessStateManager` would have to monkeypatch the module import, not pass a mock through the public API — consistent with the coverage gap already noted in the parent context, and visible directly in `tests/features/service-gating.test.mjs`, which stubs `SERVICE_CONFIGS.transcriptMonitor.startFn` wholesale instead of touching `psm`.


---

*Generated from 10 observations*
