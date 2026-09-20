# PortCleanupUtilities

**Type:** Detail

# PortCleanupUtilities — Technical Insight Document

## What It Is

PortCleanupUtilities is a set of low-level, OS-facing functions implemented in `scripts/start-services-robust.js` — specifically `killProcessOnPortAndWait()`, `waitForPortBindable()`, `isProcessRunningByScript()`, and the internal `checkPortInUse()` closure — that exist to guarantee a port is actually free and bindable before a service is (re)spawned. A parallel but far less sophisticated implementation, `check_port()`/`kill_port()`, lives in `start-services.sh` as the legacy bash path. This entity is a child concern of its parent component, StartServicesRobust, which governs the broader REQUIRED/OPTIONAL service-gating model; PortCleanupUtilities specifically handles the pre-spawn resource-availability problem that gating logic depends on but does not itself solve.

## Architecture and Design

The design is built around three architectural patterns working together. First, an **escalating retry pattern**: `killProcessOnPortAndWait()` sends SIGTERM, polls every `pollIntervalMs` (default 200ms), and only escalates to SIGKILL after half of `maxWaitMs` (default 5000ms) has elapsed — a deliberate trade-off favoring graceful shutdown while still bounding startup latency. Second, **defense-in-depth verification**: three independent checks (`isProcessRunningByScript()` via `pgrep`, `killProcessOnPortAndWait()` via `lsof`, and `waitForPortBindable()` via a raw `net.createServer()` bind probe) each operate at a different layer — process registry, OS process table, and kernel socket state — because no single layer is sufficient. `waitForPortBindable()` exists precisely because HTTP-level readiness checks (`isPortListening()` from `lib/service-starter.js`) cannot detect a half-released kernel socket that still throws EADDRINUSE. Third, a **legacy/robust dual-implementation pattern**: rather than migrating `start-services.sh`'s bash logic, it is preserved as a fallback gated by `ROBUST_MODE=false`, coupled to the Node.js implementation only by an environment variable switch.

## Implementation Details

`killProcessOnPortAndWait()` first calls the inner `checkPortInUse()` closure (`lsof -ti:${port}`) to enumerate owning PIDs, signals them with SIGTERM, then polls port occupancy until either the port clears or the wait budget's midpoint is reached, at which point it sends SIGKILL and continues polling up to `maxWaitMs`. `waitForPortBindable()` is structurally independent: it repeatedly attempts `net.createServer().listen()` (using `.unref()` to avoid blocking process exit) and treats a successful bind as authoritative proof of availability, distinct from and complementary to `killProcessOnPortAndWait()`'s occupancy check — callers must invoke both to get a complete pre-spawn guarantee, since one confirms release and the other confirms bindability. `isProcessRunningByScript()` shells out via `exec()` (not `execFile()`) with `pgrep -lf "${scriptPattern}"`, string-interpolating the pattern into the command; this is currently safe only because every call site (e.g., `'enhanced-transcript-monitor.js'`, `'live-logging-coordinator.js'`) passes hardcoded literals, not dynamic input. All three functions employ a consistent **fail-open** error philosophy: `pgrep` failure is explicitly commented as "assume not running," and `lsof` errors in `checkPortInUse()` are caught and mapped to "port free" rather than propagated.

## Integration Points

None of these utilities call into `ProcessStateManager` (imported as `psm` from `scripts/process-state-manager.js`); they operate entirely below PSM's bookkeeping layer, meaning PSM's registry can drift from actual OS/kernel state, and these utilities are the only mechanism reconciling that drift. This makes PortCleanupUtilities a structural sibling-in-spirit to ServiceOrderRegistry's consistency-enforcement role, though ServiceOrderRegistry guards `SERVICE_CONFIGS`/`SERVICE_ORDER` invariants at the registry level while PortCleanupUtilities guards resource state at the OS/kernel level — both exist because trusting a single source of truth (hand-maintained config, or PSM's internal bookkeeping) has proven unreliable. Within the parent StartServicesRobust, these utilities are invoked ahead of `startOneService()`'s spawn logic so that REQUIRED/OPTIONAL gating decisions are made against ports that are genuinely free, not just believed free.

## Usage Guidelines

Any bugfix to port-cleanup semantics must be applied in both `start-services-robust.js` and the legacy `start-services.sh` path, since the latter is intentionally retained rather than removed. Developers must call both `killProcessOnPortAndWait()` and `waitForPortBindable()` together — neither alone provides a complete guarantee. `isProcessRunningByScript()` must never be given a dynamic or user/path-derived `scriptPattern`, as `exec()`'s shell interpretation reintroduces injection risk that is currently avoided only by convention. Finally, because failures fail open by design, a systemic loss of `pgrep`/`lsof` availability (missing binary, sandboxed environment) will silently disable orphan detection and cleanup rather than surface as a startup error — this should be monitored for in constrained deployment environments rather than assumed safe.


## Hierarchy Context

### Parent
- [StartServicesRobust](./StartServicesRobust.md) -- [LLM] scripts/start-services-robust.js implements a two-class service model — REQUIRED (transcriptMonitor, liveLoggingCoordinator) vs OPTIONAL (everything else) — that is enforced not by a flag on the service itself but by how startOneService() (referenced in tests/features/service-gating.test.mjs) interprets the `required: true` field on SERVICE_CONFIGS entries. The test 'a required failure blocks, so downstream services do not start' confirms that a required-service failure sets `out.blocked = true` and halts SERVICE_ORDER iteration, while an optional failure is recorded in `results.failed` or `results.degraded` without stopping subsequent services. This is the concrete mechanism behind the parent-context claim that the toolkit 'should remain usable in a degraded state' — degradation is implemented as a loop-continuation decision, not a separate code path.

### Siblings
- [ServiceOrderRegistry](./ServiceOrderRegistry.md) -- [LLM] tests/features/service-gating.test.mjs enforces two structural invariants on scripts/start-services-robust.js's exported SERVICE_CONFIGS/SERVICE_ORDER pair via the 'service catalogue coverage' describe block: 'every service declares a feature' fails if any SERVICE_CONFIGS entry lacks a `feature` key, and 'SERVICE_ORDER and SERVICE_CONFIGS cover each other exactly' sorts and diffs the two collections' keys. This is a registry-consistency test, not a behavioral one — it exists specifically because, per the test file's own header comment, 'ten hand-written start blocks were ten chances to forget a gate'. The registry (SERVICE_CONFIGS as the map of what a service is, SERVICE_ORDER as the sequence in which startOneService() walks it) is treated as a single source of truth that must be self-consistent, rather than trusting whoever adds a new service to remember to update both.


---

*Generated from 9 observations*
