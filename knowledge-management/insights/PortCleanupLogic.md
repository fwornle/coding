# PortCleanupLogic

**Type:** Detail

# PortCleanupLogic — Technical Insight Document

## What It Is

PortCleanupLogic is not a standalone module but a pair of sibling functions implemented in `scripts/start-services-robust.js`: `killProcessOnPortAndWait(port, options)` and `waitForPortBindable(port, options)`. Together they form a two-stage contract for reclaiming and verifying a network port before a service under `StartServicesOrchestrator` attempts to bind it. A legacy, structurally weaker counterpart also exists in `start-services.sh` via `check_port()`/`kill_port()`, gated behind `ROBUST_MODE=false`.

## Architecture and Design

The core design pattern is **graduated escalation**: `killProcessOnPortAndWait()` sends `SIGTERM` unconditionally and immediately, then conditionally escalates to `SIGKILL` only if the port remains occupied past the midpoint of a bounded wait window. Critically, this escalation is not implemented via separate timers but nested inside a single `while (Date.now() - startTime < maxWaitMs)` polling loop that calls `sleep(pollIntervalMs)` (from `../lib/service-starter.js`), meaning the `SIGKILL` fires on the next poll tick after `maxWaitMs / 2`, not at an exact instant.

A second pattern, **dual-probe strategy**, separates process-liveness concerns from OS socket-reclamation concerns. `waitForPortBindable()` is structurally distinct — it never shells out to `lsof` or sends signals; instead it constructs an `unref()`'d `net.createServer()` and races `'error'`/`'listening'` events per poll tick. This exists specifically to catch the post-crash kernel hold-window that HTTP-based checks (`isPortListening`) cannot observe, complementing the process-table probe used by the kill function.

A third pattern is **legacy/robust mode duality**: `start-services.sh`'s `kill_port()` performs a single unconditional `SIGKILL` piped from `lsof -t -i :$port` with a flat `sleep 1` — no polling, no escalation, no bind-verification. This duplication across Node and bash is explicitly marked as backward-compatibility scaffolding, but represents two independently maintained implementations with materially different reliability guarantees.

## Implementation Details

`killProcessOnPortAndWait()` first short-circuits via an inline `checkPortInUse()` closure built on `lsof -ti:${port}`. If the port is occupied, it collects PIDs from a fresh `lsof` call and loops `process.kill(pid, 'SIGTERM')`. Inside the polling loop, it rechecks `checkPortInUse()` each tick and issues `process.kill(pid, 'SIGKILL')` on every remaining PID once past the midpoint threshold. After the loop, a final `checkPortInUse()` check determines the return value (`true`/`false`); on failure it logs `'Warning: Port ${port} still in use after ${maxWaitMs}ms timeout'` via plain `console.log` rather than throwing — a bounded-wait contract, not a guaranteed outcome.

Error handling throughout is deliberately **fail-soft**: `checkPortInUse()` swallows `lsof` failures and returns `false` (treating unreadable state as "free"), and both signal sends are wrapped in try/catch discarding errors with the comment "Process may have already exited." This treats process-exit races as non-errors rather than failures to surface.

`waitForPortBindable()` uses defaults of `pollIntervalMs=250`, `maxWaitMs=5000`, closing its probe socket immediately upon a successful bind, confirming release without leaking a listening server.

## Integration Points

PortCleanupLogic is consumed by callers within `SERVICE_CONFIGS` (the registry concretely implemented as documented by sibling **ServiceGatingRegistry**), whose `startFn` implementations presumably invoke both functions in sequence — kill, then verify bindability — before starting a service. The `false` return from either function is left for callers to interpret against `startServiceWithRetry`'s `maxRetries` budget; PortCleanupLogic enforces no retry policy itself. It depends on `sleep()` imported from `../lib/service-starter.js`. Under `StartServicesOrchestrator`, this logic supports the broader restart/verification flow referenced in the parent's Docker Container Restart Verification Baseline. It shares no direct code with siblings **ConstraintMonitorBootstrap** or **ContainerEntrypointFeatureGating**, but sits in the same file and orchestration layer as **ServiceGatingRegistry**'s `SERVICE_CONFIGS`.

## Usage Guidelines

Callers should treat both functions' return values as advisory rather than authoritative — neither throws on failure, so silent progression past a stuck port is possible unless the caller explicitly checks the boolean result. Because `SIGKILL` escalation timing is tick-bound (dependent on `pollIntervalMs`), callers tuning `maxWaitMs` should account for granularity, not assume precise midpoint firing. Given the parallel bash implementation in `start-services.sh` lacks escalation and bind-verification entirely, any reliability-sensitive changes should be made in `scripts/start-services-robust.js` and, if backward compatibility matters, mirrored deliberately rather than assumed equivalent.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- The escalation timing is driven by a single polling loop, not two separate timers: inside the `while (Date.now() - startTime < maxWaitMs)` loop, the function calls `sleep(pollIntervalMs)` (imported from `../lib/service-starter.js`), re-checks `checkPortInUse()`, and only fires `process.kill(pid, 'SIGKILL')` on every remaining PID once `Date.now() - startTime > maxWaitMs / 2`. Because the SIGKILL branch is nested inside the same loop body rather than a separate `setTimeout`, the function only ever escalates on a poll tick — with the default `pollIntervalMs=200` against `maxWaitMs=5000`, escalation fires within one 200ms tick of the 2500ms midpoint, not exactly at it.
- `waitForPortBindable()`, also in scripts/start-services-robust.js, is a structurally distinct function from `killProcessOnPortAndWait()` even though both operate on the same port lifecycle: it does not call `lsof` or send signals at all. Instead it constructs a throwaway `net.createServer()`, calls `.unref()` so the probe itself cannot keep the process alive, and races `'error'`/`'listening'` events inside a `Promise` per poll tick (default `pollIntervalMs=250`, `maxWaitMs=5000`), closing the probe socket immediately on a successful bind. This confirms the parent's [LLM] claim that the function exists to catch a post-crash kernel hold-window that HTTP-based checks (`isPortListening`) cannot see.

**Other:**
- `killProcessOnPortAndWait()` in scripts/start-services-robust.js is the concrete PortCleanupLogic: it takes a `port` and options (`maxWaitMs=5000`, `pollIntervalMs=200`, `label`), first calling an inline `checkPortInUse()` closure (built on `lsof -ti:${port}`) to short-circuit if the port is already free. If occupied, it re-runs `lsof -ti:${port}` to collect PIDs, then loops `process.kill(pid, 'SIGTERM')` over each one. This mirrors the parent's [LLM] observation describing the same function's 'graduated-escalation design' — the code confirms it structurally: SIGTERM is unconditional and immediate, SIGKILL is conditional and delayed.


## Hierarchy Context

### Parent
- [StartServicesOrchestrator](./StartServicesOrchestrator.md) -- [SESSION] Docker Container Restart Verification Baseline establishes capturing supervisor process list and container state as a baseline before docker-compose up -d, to compare against post-restart state and catch regressions like stale naming or misconfigured mounts.

### Siblings
- [ConstraintMonitorBootstrap](./ConstraintMonitorBootstrap.md) -- [LLM] None of the supplied code files define, export, or reference a symbol, class, or function literally named 'ConstraintMonitorBootstrap'. The closest material is docker/entrypoint.sh's PROGRAM_FEATURES gate (which maps 'constraint-monitor', 'constraint-dashboard', and 'constraint-dashboard-api' program names to the 'constraints' feature and writes autostart=false into /etc/supervisor/features.d/disabled.conf when that feature is off), and start-services.sh's legacy bash block that clones integrations/constraint-monitor, brings up its docker-compose stack (Qdrant + Redis), and starts its dashboard/API processes on ports 3030/3031. Neither of these is a 'bootstrap' abstraction in the sense of a dedicated initialization class/module — they are, respectively, a container-level feature toggle and a shell-scripted legacy startup sequence.
- [ContainerEntrypointFeatureGating](./ContainerEntrypointFeatureGating.md) -- [LLM] docker/entrypoint.sh implements the container-side feature gate as a self-contained bash block (the "Feature gating" section) rather than delegating to a Node script for the decision logic, even though it shells out to `node -e` per-pair for the actual on/off evaluation. The design reads `FEATURES_SNAPSHOT="/coding/.coding/runtime/features.json"` — a flat JSON file mounted read-only — and iterates a space-separated `PROGRAM_FEATURES` string of `program:feature` pairs (`semantic-analysis:knowledge`, `embedding-listener:knowledge`, `graphify:codegraph`, `constraint-monitor:constraints`, `constraint-dashboard:constraints`, `constraint-dashboard-api:constraints`, `health-dashboard:health`, `health-dashboard-frontend:health`), writing `autostart=false` stanzas into `/etc/supervisor/features.d/disabled.conf` for anything found off. This is a materially different mechanism from the host-side `loadFeatures()`/`SERVICE_CONFIGS` gating in scripts/start-services-robust.js — the container has no access to `~/.coding/features.yaml` and cannot run the resolver, so it consumes a pre-resolved snapshot rather than re-deriving the same decision.
- [ServiceGatingRegistry](./ServiceGatingRegistry.md) -- [LLM+CGR] There is no class or file literally named `ServiceGatingRegistry`; the registry function is implemented as a plain object, `SERVICE_CONFIGS`, in `scripts/start-services-robust.js`, where each key (e.g. `transcriptMonitor`, `liveLoggingCoordinator`) maps to a config entry declaring `name`, `feature`, `psmPath`, `required`, `maxRetries`, `timeout`, `startFn`, and `healthCheckFn`. `tests/features/service-gating.test.mjs` treats this object as the canonical registry under test, asserting structurally that every entry in `SERVICE_CONFIGS` declares a `feature` field and that `SERVICE_ORDER` and `SERVICE_CONFIGS` 'cover each other exactly' (`ordered = SERVICE_ORDER.map(o => o.key).sort()` must equal `configured = Object.keys(SERVICE_CONFIGS).sort()`). This is the concrete mechanism behind the parent entity's claim that 'ten hand-written start blocks were ten chances to forget a gate.'


---

*Generated from 10 observations*
