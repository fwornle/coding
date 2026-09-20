# ServiceRegistration

**Type:** Detail

# ServiceRegistration — Technical Insight Document

## What It Is

ServiceRegistration is the consumer-facing usage layer built on top of `ProcessStateManager` (defined in process-state-manager.js), realized concretely in scripts/start-services-robust.js, its legacy sibling start-services.sh, and the CLI wrapper scripts/psm-register.js. Rather than being a distinct class, ServiceRegistration is the set of call sites, conventions, and query/mutation patterns by which host-side orchestration code asks "is this service running?" and "record that this service is now running" against PSM's registry. It is instantiated once, at module scope, as `const psm = new ProcessStateManager();` (start-services-robust.js:41), and is exercised primarily through two `SERVICE_CONFIGS` entries — `transcriptMonitor` and `liveLoggingCoordinator` — whose `startFn` implementations embed the registration/check logic directly.

## Architecture and Design

The dominant pattern is **best-effort cache-reconciliation**: PSM's registry (`psm.isServiceRunning`) is checked first as an optimistic cache, and only if it reports nothing running does the code fall back to `isProcessRunningByScript()`, an independent `pgrep -lf`-based OS probe (start-services-robust.js:47-66). This inverts the naive assumption that a registry would be authoritative — here, raw OS process inspection is the ground truth, and PSM is a deduplication/coordination convenience layered on top.

A second structural pattern is **dual-scope registry querying**. The same `startFn` checks `psm.isServiceRunning('transcript-monitor', 'global')` and then, separately, `psm.isServiceRunning('enhanced-transcript-monitor', 'per-project', { projectPath: TARGET_PROJECT_PATH })` — two different service names under two different scopes, checked sequentially. Notably, a code comment reveals this per-project check outlived the architecture it was built for: "Phase 33 plan 07 retired the per-project LSL coordinator that historically spawned these monitors," meaning ServiceRegistration's scope surface has become partially vestigial relative to what actually spawns processes today.

A third pattern is the **two-tier gating** relationship to docker/entrypoint.sh's `PROGRAM_FEATURES` mechanism. That mechanism operates at container boot, deciding via a `node -e` snippet against `/coding/.coding/runtime/features.json` whether supervisord ever autostarts a program at all (writing `autostart=false` into `/etc/supervisor/features.d/disabled.conf`). This is architecturally disjoint from PSM: a service disabled at that tier never reaches any PSM-aware code path, and there is no shared abstraction between the two — they must stay aligned purely by convention.

## Implementation Details

The registration write path is deliberately non-blocking: `psm.registerService({ name: 'transcript-monitor', pid: osCheck.pid, type: 'global', script: 'scripts/enhanced-transcript-monitor.js' })` is wrapped in its own try/catch that only logs a warning on failure — it never rethrows, and the enclosing function still returns `{ pid: osCheck.pid, service: 'transcript-monitor', skipRegistration: true }` regardless of write success. This makes PSM registration failures fully invisible to the surrounding `SERVICE_ORDER`/`startOneService` orchestration.

Two OS-level primitives — `waitForPortBindable()` (a throwaway `net.createServer().listen()` probe) and `killProcessOnPortAndWait()` (SIGTERM-then-SIGKILL escalation keyed on `lsof -ti:<port>`) — operate entirely without knowledge of PSM, service names, or scopes. They only understand ports and PIDs, reinforcing that whenever the code needs a *guarantee* rather than a *belief* about process state, it deliberately bypasses ServiceRegistration and queries the OS directly.

Underlying all of this is detached process spawning: `spawn(..., { detached: true }); child.unref();` decouples spawned service lifetime from the orchestrator process. This is precisely what necessitates PSM's reconciliation fallback — since the orchestrator can't rely on in-process handles to know if a service is alive, it must reconcile against both a registry and the OS.

## Integration Points

ServiceRegistration surfaces in three distinct integration contexts. First, as an imported class inside start-services-robust.js, consumed synchronously by `transcriptMonitor.startFn` and `liveLoggingCoordinator.startFn`. Second, as a standalone CLI (`scripts/psm-register.js`), invoked from bash by the legacy start-services.sh via `node scripts/psm-register.js --check transcript-monitor global` as a pre-flight duplicate check before falling into the same live-logging startup sequence reimplemented in the Node path. This CLI/class duplication means the same PSM backend has two independently maintained call surfaces that must be kept behaviorally consistent by hand.

Third, and negatively, ServiceRegistration has no integration with docker/entrypoint.sh's `PROGRAM_FEATURES` gating — services disabled at the container/supervisord level simply never invoke any PSM code, making these two gating layers parallel rather than composed.

Test coverage is bounded: tests/features/service-gating.test.mjs enforces that `SERVICE_CONFIGS` entries declare valid `feature` strings and that `SERVICE_ORDER`/`SERVICE_CONFIGS` key sets match, but the test asserting that a feature-off REQUIRED service doesn't block startup works precisely because feature-gating short-circuits before `startFn` — and therefore before any PSM call — executes. As a result, PSM's dual-scope query logic and registration semantics are exercised only in production, never in CI.

## Usage Guidelines

Developers extending `SERVICE_CONFIGS` with new `startFn` implementations should treat PSM checks as advisory, not authoritative — always pair `psm.isServiceRunning` calls with an OS-level fallback (as `isProcessRunningByScript()` does) rather than trusting the registry alone. Registration writes should remain non-fatal on failure, consistent with the existing try/catch pattern, since orchestration must not stall on registry bookkeeping errors. When introducing new per-project scoped checks, be wary of scope/name conventions outliving the architecture that motivated them, as happened with the retired per-project LSL coordinator — periodically audit whether 'per-project' scope checks still correspond to real spawning logic. Finally, since PSM registry-state transitions are untested in CI, any change to `registerService`/`isServiceRunning` semantics should be manually verified against both start-services-robust.js and the legacy start-services.sh/psm-register.js path, and ideally accompanied by new test coverage closing the gap left by service-gating.test.mjs.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- The scope disambiguation described in the parent observations is directly visible in the two `startFn` implementations: `transcriptMonitor.startFn` calls `psm.isServiceRunning('transcript-monitor', 'global')` for the shared instance and `psm.isServiceRunning('enhanced-transcript-monitor', 'per-project', { projectPath: TARGET_PROJECT_PATH })` for the per-project variant — two different service *names* ('transcript-monitor' vs 'enhanced-transcript-monitor') under two different *scopes*, checked sequentially in the same function. A comment in the per-project check explicitly notes 'Phase 33 plan 07 retired the per-project LSL coordinator that historically spawned these monitors' — meaning the scope split in PSM's query surface has outlived at least one architectural change to what spawns the processes it tracks.

**Other:**
- `ProcessStateManager` (process-state-manager.js) is instantiated exactly once at module scope in scripts/start-services-robust.js (`const psm = new ProcessStateManager();`) and is never passed to `isProcessRunningByScript()`, which instead independently shells out via `execAsync('pgrep -lf ...')`. This creates two parallel 'is it running' code paths inside the same file: one backed by PSM's registry (`psm.isServiceRunning`), one backed by raw OS process inspection. The `transcriptMonitor.startFn` and `liveLoggingCoordinator.startFn` both call PSM first, then fall back to `isProcessRunningByScript()` only if PSM reports nothing running — meaning PSM is treated as an optimistic cache and pgrep as the ground-truth fallback, not the other way around.


## Hierarchy Context

### Parent
- [ProcessStateManager](./ProcessStateManager.md) -- [CGR] ProcessStateManager (class) in process-state-manager.js


---

*Generated from 10 observations*
