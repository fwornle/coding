# WrapperPsmRegistrationRace

**Type:** Detail

[LLM] In scripts/api-service.js, the sequence of operations after spawn() returns is: attach child.on('error'), attach child.on('exit', async ...), attach process.on('SIGTERM'/'SIGINT') handlers, log '[API Service] Started (PID: ...)', and only then kick off the async IIFE that does `new ProcessStateManager()` -> `psm.initialize()` -> `psm.registerService(...)`. Because `psm.initialize()` is itself async (almost certainly opening a LevelDB/file handle or similar), there is a real window between the child process existing (and thus eligible to crash or exit near-instantly) and the PSM registration IIFE resolving. If the wrapped process (integrations/constraint-monitor/src/dashboard-server.js) fails fast — e.g., port 3031 already bound — `child.on('exit')` can fire and attempt `psm.unregisterService('constraint-api-child', 'global')` before `registerService` for the same name has ever run, meaning the unregister is a no-op against a service that was never actually recorded, and the subsequent registerService call (if it still fires after exit) would register a PID that is already dead.

# WrapperPsmRegistrationRace

## What It Is

`WrapperPsmRegistrationRace` describes a structural race condition present in `scripts/api-service.js` and `scripts/dashboard-service.js`, two near-duplicate wrapper scripts that spawn a target process (respectively `integrations/constraint-monitor/src/dashboard-server.js` and an `npm run dev` Next.js process) and attempt to register that process with a `ProcessStateManager` (PSM) instance. In both files, the sequence after `spawn()` returns is: attach `child.on('error')`, attach `child.on('exit', async ...)`, attach SIGTERM/SIGINT handlers, log `'[API Service] Started (PID: ...)'`, and only then launch an async IIFE that constructs `new ProcessStateManager()`, calls `psm.initialize()`, and then `psm.registerService(...)`. Because `initialize()` and `registerService()` are asynchronous, there is a real window in which the child process can crash or exit before registration ever completes — meaning `child.on('exit')`'s cleanup call to `psm.unregisterService('constraint-api-child', 'global')` (or the dashboard equivalent) can fire against a service that was never actually recorded in PSM.

## Architecture and Design

The core pattern is a **fire-and-forget async IIFE for post-spawn bookkeeping**, deliberately decoupled from the synchronous `spawn()` call (`scripts/api-service.js:60-83`, `scripts/dashboard-service.js:57-80`). This reflects a broader **wrapper/adapter pattern**: thin process-wrapper scripts around independently runnable servers, exposing a uniform PID/PSM-registration contract to a higher-level coordinator. The design assumes registration is best-effort metadata rather than a precondition for the process being considered "up" — evidenced by the explicit comment `'Continue anyway - not critical'` when registration fails.

This is architecturally consistent with the parent component, `StartServicesRobust`, whose `lib/service-starter.js:startServiceWithRetry()` treats PSM state as untrustworthy and instead relies on a caller-supplied `healthCheckFn` that probes real TCP/HTTP endpoints. However, this separation of concerns creates two **independent, non-communicating subsystems** tracking the same child process: health verification (retry orchestrator) and PSM bookkeeping (wrapper-internal IIFE) can diverge silently, with neither detecting the other's gap.

## Implementation Details

Each wrapper instantiates its own `ProcessStateManager` rather than sharing a singleton across services — a design choice that later compounds into lock-contention risk (see below). The exit handler's cleanup (`scripts/api-service.js:48-58`, `scripts/dashboard-service.js:46-56`) wraps `psm.unregisterService(...)` in a try/catch with the comment `'// Ignore cleanup errors'`, meaning failures are silently swallowed and never surfaced. There is a notable **failure-handling asymmetry**: `child.on('error')` calls `process.exit(1)` immediately with zero PSM interaction, while `child.on('exit')` at least attempts cleanup — but with no verification that the unregister succeeded. If `psm.initialize()` throws inside the exit handler (e.g., an unreachable or locked store), a dead process can remain marked "alive" in PSM indefinitely.

Critically, neither `psm.initialize()` nor `registerService()`/`unregisterService()` are wrapped in any timeout, unlike `lib/service-starter.js`'s `withDeadline()`, which bounds `startFn()` (configurable) and `healthCheckFn()` (hardcoded 10000ms). If `initialize()` hangs — plausible given each wrapper opens its own PSM instance and could contend for the same underlying lock — the registration IIFE never resolves, and the wrapper produces no further log output beyond `'Started (PID: ...)'`, an effectively invisible hang.

The dashboard wrapper (`scripts/dashboard-service.js`) is structurally identical but higher-risk in practice: spawning `npm run dev` introduces an additional layer of near-instant failure modes (missing `node_modules`, broken `package.json` in `DASHBOARD_DIR`) beyond what a direct `node <path>` invocation in `api-service.js` faces, making the exit-before-registration race easier to trigger.

## Integration Points

The wrappers register under **hardcoded, singular service names** (`'constraint-api-child'`, `'constraint-dashboard-child'`) rather than PID- or attempt-derived identifiers. This intersects badly with `startServiceWithRetry()` in `lib/service-starter.js`: each retry spawns a new child with a new PID, but the same fixed PSM name is targeted every time, so a slow, still-in-flight registration from attempt N can race a later attempt N+1's registration or unregistration, with PSM having no generation/attempt identifier to disambiguate them.

This entity sits within `StartServicesRobust` alongside siblings `KillProcessOnPortAndWait` and `WaitForPortBindable`, both of which take the opposite philosophy — actively verifying real system state (`lsof -ti:<port>`, TCP bindability) rather than trusting async bookkeeping. The contrast underscores that PSM registration in these wrappers is deliberately not treated as a source of truth by the rest of the orchestration layer.

## Usage Guidelines

Developers extending or copy-pasting these wrapper templates should treat the race as a **class of bug**, not a one-off — it will replicate anywhere this same IIFE-after-spawn structure is reused. Any new wrapper should: register before or synchronously with process startup where possible, derive PSM service names from PID or attempt/generation counters to survive retries, wrap `psm.initialize()`/`registerService()`/`unregisterService()` in `withDeadline()`-style timeouts, and avoid silently swallowing cleanup errors. Because PSM state cannot currently be trusted as a liveness signal, any coordinator logic should continue relying on real health checks (as `startServiceWithRetry` already does) rather than PSM registration status, until the registration/liveness synchronization gap is closed.


## Hierarchy Context

### Parent
- [StartServicesRobust](./StartServicesRobust.md) -- [LLM] lib/service-starter.js implements withDeadline() as a wrapper around Promise.race() specifically to solve a Node.js event-loop hygiene problem: when the wrapped work promise resolves before the timeout, the setTimeout timer created for the race is not automatically cancelled by Promise.race() itself. withDeadline() addresses this in a try/finally block that unconditionally calls clearTimeout(timer) regardless of whether the race was won by the work or the timeout. This is not a cosmetic detail — an uncleared timer keeps Node's event loop alive for the full duration of `ms`, which in startServiceWithRetry() is used twice per attempt (once with the caller-supplied `timeout` for startFn(), once hardcoded to 10000ms for healthCheckFn()), meaning a naive implementation would leave up to two dangling timers per retry attempt across `maxRetries` attempts, compounding into significant delayed-exit behavior for any process (test runner, CLI) that invokes this module and expects clean shutdown.

### Siblings
- [KillProcessOnPortAndWait](./KillProcessOnPortAndWait.md) -- killProcessOnPortAndWait() in scripts/start-services-robust.js uses lsof -ti:<port> to discover PIDs holding a port before attempting cleanup
- [WaitForPortBindable](./WaitForPortBindable.md) -- waitForPortBindable() in scripts/start-services-robust.js explicitly contrasts itself with isPortListening, which only detects HTTP responders


---

*Generated from 9 observations*
