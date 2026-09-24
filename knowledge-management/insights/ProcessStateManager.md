# ProcessStateManager

**Type:** SubComponent

## What It Is

ProcessStateManager is a class defined in `process-state-manager.js`, imported and consumed at `scripts/start-services-robust.js:38` (`import ProcessStateManager from './process-state-manager.js'`) and instantiated once as a module-level singleton at line 60 (`const psm = new ProcessStateManager();`). Its own internal implementation is not present in the supplied files — the only concrete evidence of its behavior comes from call-site usage in start-services-robust.js and from a parent-context observation describing an analogous usage in api-service.js/dashboard-service.js. Functionally, it acts as an external registry/cache tracking which services are running, at what scope, and under what PID, decoupled from supervisord's own process table. It sits under the DockerizedServices parent component alongside siblings ServiceStarter, ServiceProbe, DockerEntrypoint, and DockerComposeStartupScript, and its two documented children — ServiceRegistration and PsmConsumersInStartServicesRobust — represent, respectively, an unconfirmed/unlocated registration abstraction and the concrete consumption pattern found in start-services-robust.js.

## Architecture and Design

The dominant pattern is Registry/Coordinator: PSM maintains a queryable record of service liveness independent of supervisord, exposing at minimum `isServiceRunning(name, scope, opts?)` and `registerService(record)`. Scope is a first-class parameter — `'global'` vs `'per-project'` (with a `projectPath` option) — meaning the registry key space is structured rather than a flat name→pid map. This is evident in the transcriptMonitor block, which checks both `psm.isServiceRunning('transcript-monitor', 'global')` and a scoped `psm.isServiceRunning('enhanced-transcript-monitor', 'per-project', { projectPath: TARGET_PROJECT_PATH })`.

Critically, the caller does not treat PSM as ground truth. A layered liveness-check design is used: PSM global check, then PSM per-project check, then a raw OS-level `pgrep -lf` scan via `isProcessRunningByScript()`, each cheaper check gating the next before a spawn is attempted. When the OS scan finds a process PSM didn't know about, the code self-heals by calling `psm.registerService()` — a reconciliation pattern that assumes PSM state can drift from reality (crashes, out-of-band starts).

![ProcessStateManager — Architecture](images/process-state-manager-architecture.png)

This distrust-and-reconcile posture parallels a documented risk in the sibling/parent ecosystem: the unresolved "Feature Snapshot Forensics" issue on SupervisordRuntime, where a feature snapshot silently rewrites itself into a restrictive state, making supervisord report services as running while they're actually non-functional. Any component treated as an authoritative liveness answer — PSM included — is vulnerable to this class of drift if callers stop cross-checking.

Notably, DockerEntrypoint (docker/entrypoint.sh) implements a structurally parallel but separate authority: it reads a host-written `features.json` snapshot and gates supervisord `autostart` per program, failing open if the snapshot is missing. This is a dual-gating-authority design — one system gates whether supervisord starts a program at all, the other tracks PID/state of processes supervisord can't see into — with no shown integration point between them.

## Implementation Details

The public surface inferred from call sites includes `isServiceRunning(name, scope, opts?)` and `registerService({ name, pid, type, script })`. The `registerService` call from transcriptMonitor's startFn — `psm.registerService({ name: 'transcript-monitor', pid: osCheck.pid, type: 'global', script: 'scripts/enhanced-transcript-monitor.js' })` — shows registration records carry at least name, pid, type/scope, and originating script path. The parent-context observation on api-service.js/dashboard-service.js adds that PSM also exposes `unregisterService()`, called on process exit inside an async IIFE, used specifically because supervisord only tracks a wrapper's own PID, not any grandchild process it spawns.

No observation in the supplied set describes PSM's persistence mechanism (in-memory vs file-backed), so this remains an open question for future investigation rather than something to assume. Similarly, the child entity ServiceRegistration — which one would expect to formalize the registration record structure — could not be located in the supplied files; retrieval instead surfaced unrelated feature-gating and classifier-service code, suggesting a filename/keyword collision rather than an actual implementation gap confirmed by direct inspection.

## Integration Points

![ProcessStateManager — Relationship](images/process-state-manager-relationship.png)

PSM is threaded through start-services-robust.js as a shared singleton rather than via constructor injection — the child component PsmConsumersInStartServicesRobust documents that both the `transcriptMonitor` and `liveLoggingCoordinator` service blocks close over the same `psm` instance. This has a direct consequence: a bookkeeping bug in one service's registration (e.g., registering under the wrong `type`) is visible to every other service's `isServiceRunning` check for the remainder of the process lifetime, since state is shared, not isolated per-service.

Beyond start-services-robust.js, the parent-context pattern in api-service.js/dashboard-service.js shows PSM used inside process wrappers for register-on-start/unregister-on-exit bookkeeping, extending PSM's role wherever supervisord's shallow visibility needs bridging to actual runtime topology. It does not, per the observations, integrate with DockerEntrypoint's feature-snapshot gating mechanism — the two remain parallel, non-communicating authorities over process/service state within DockerizedServices.

## Usage Guidelines

Developers consuming ProcessStateManager should not treat its `isServiceRunning` result as a sole source of truth — the established convention in start-services-robust.js is to layer a real OS-level check (`pgrep`) behind it and reconcile via `registerService()` when discrepancies surface. Any new service-startup logic should follow this same defense-in-depth pattern rather than trusting the registry alone, especially given the known precedent of supervisord/feature-snapshot state silently diverging from real service health.

When registering services, scope must be specified explicitly and consistently (`'global'` vs `'per-project'` with `projectPath`), since PSM's registry key space depends on this distinction rather than encoding scope into the name. Because PSM is consumed as a shared singleton across all service blocks in a file, care must be taken to use correct, distinct `name`/`type` values per registration — an error here silently corrupts liveness checks for unrelated services sharing the same instance.

Test coverage is currently a gap: `tests/features/service-gating.test.mjs` validates `SERVICE_CONFIGS`/`SERVICE_ORDER` but exercises none of PSM's registration, reconciliation, or scope semantics directly, meaning its contract is currently verified only through the manual startup flow. Future work should treat PSM's internal implementation, persistence mechanism, and the unresolved ServiceRegistration child as open investigation items before building further automated dependencies on it.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- ProcessStateManager (class) in process-state-manager.js

**Relationships:**
- The code graph confirms `ProcessStateManager` as a class defined in `process-state-manager.js`, matching the import path `import ProcessStateManager from './process-state-manager.js'` at scripts/start-services-robust.js:38. No other file in the supplied set imports or references this class, so the only concrete evidence of its behavior available here is call-site usage in start-services-robust.js, not its internal implementation.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The parent-context observation on api-service.js/dashboard-service.js documents a spawn+PSM-registration pattern used elsewhere in this codebase: each wrapper spawns a grandchild process and, inside an async IIFE, imports ProcessStateManager to call `psm.registerService()` immediately and `psm.unregisterService()` on process exit, specifically because supervisord only tracks the wrapper's own PID and not the process it spawns. This establishes that PSM's purpose is to bridge supervisord's shallow process visibility with the actual runtime topology, a role consistent with how start-services-robust.js uses it for non-containerized/host-side services.
- The unresolved 'Feature Snapshot Forensics' investigation (about SupervisordRuntime) records that a runtime feature snapshot has been observed to silently rewrite itself into a restrictive 'logging-only' state, causing services like Constraint Monitor to stop functioning even while supervisord reports them as running, with no confirmed root cause across multiple sessions. This is directly relevant to any component (including ProcessStateManager) that other code treats as an authoritative 'is this service alive' answer: a caller trusting either supervisord's status or a PSM registration without cross-checking real health could be fooled by this class of drift.

## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- [SESSION] Docker Container Restart Verification Baseline establishes a pre/post supervisor-process-list and container-state comparison habit around routine docker-compose up -d restarts to catch regressions like stale naming or misconfigured mounts

### Children
- [ServiceRegistration](./ServiceRegistration.md) -- [LLM] No file in the supplied set defines a class, module, or file named "ServiceRegistration" (or anything resembling it). The five files retrieved — docker/entrypoint.sh, scripts/prompt-classifier-service.mjs, scripts/start-services-robust.js, start-services.sh, and tests/features/service-gating.test.mjs — implement feature gating, service startup retry, and a classifier HTTP service, none of which are a registration component. This looks like a filename/neighborhood match on the parent's 'process-state-manager.js' and 'registerService()' terms rather than a retrieval of this entity's actual implementation.
- [PsmConsumersInStartServicesRobust](./PsmConsumersInStartServicesRobust.md) -- [LLM] scripts/start-services-robust.js:60 instantiates `const psm = new ProcessStateManager();` once at module scope, and both service blocks visible in the supplied source (`transcriptMonitor` and `liveLoggingCoordinator`) close over that single instance rather than constructing their own. This is a shared-singleton consumption pattern: every `startFn` in the file reads and writes the same in-memory/registry state, so a bug in one service's registration bookkeeping (e.g. registering under the wrong `type`) is visible to every other service's `isServiceRunning` check for the rest of the process lifetime, not just to its own block.

### Siblings
- [ServiceStarter](./ServiceStarter.md) -- [SESSION] Docker Container Restart Verification Baseline establishes a habit of comparing supervisor process lists and container state before/after docker-compose up -d restarts to catch regressions like stale naming or misconfigured mounts, directly exercising the startup paths this library implements.
- [ServiceProbe](./ServiceProbe.md) -- [SESSION] coding --copilot Launcher Health Check reuses the same rebuild-and-verify Docker workflow as the restart-verification baseline, confirming supervised processes and health endpoints are live before downstream pipelines like wave-analysis depend on them.
- [DockerEntrypoint](./DockerEntrypoint.md) -- [SESSION] Docker Container Restart Verification Baseline establishes a pre/post supervisor-process-list and container-state comparison habit around routine docker-compose up -d restarts to catch regressions like stale naming or misconfigured mounts.
- [DockerComposeStartupScript](./DockerComposeStartupScript.md) -- [LLM] docker/entrypoint.sh implements the container-side half of the feature-gating mechanism described in its own inline comments: it reads a flat JSON snapshot at /coding/.coding/runtime/features.json (mounted read-only, written by the host, never the host's ~/.coding/features.yaml itself since that file is never mounted into the container) and, for each entry in the hardcoded PROGRAM_FEATURES mapping (e.g. semantic-analysis:knowledge, constraint-monitor:constraints, health-dashboard:health), invokes `node -e` — not jq, which is explicitly absent from the image — to check snap.features[feature] and writes an `autostart=false` supervisord include into /etc/supervisor/features.d/disabled.conf for anything that resolves to false. An unknown feature name defaults to enabled, so an older host snapshot can never accidentally disable a program it doesn't know about.


---

*Generated from 11 observations*
