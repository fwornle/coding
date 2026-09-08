# KillProcessOnPortAndWait

**Type:** Detail

killProcessOnPortAndWait() in scripts/start-services-robust.js uses lsof -ti:<port> to discover PIDs holding a port before attempting cleanup

# KillProcessOnPortAndWait — Technical Insight Document

## What It Is

`killProcessOnPortAndWait()` is implemented in `scripts/start-services-robust.js` as part of the `StartServicesRobust` component. It provides a graceful-then-forceful process termination utility targeted at a specific network port rather than a specific PID: it uses `lsof -ti:<port>` to discover which process(es) currently hold a given port, then coordinates a shutdown sequence against that discovery.

## Architecture and Design

The function follows an escalating-force pattern common in process-lifecycle management: attempt a polite shutdown (SIGTERM), observe the system's actual state via polling, and only resort to a hard kill (SIGKILL) if the polite approach fails within a bounded time window. This is a deliberate trade-off between shutdown speed and safety — a naive implementation might SIGKILL immediately (risking data loss or unclean resource release) or wait indefinitely (risking hangs). Here, escalation to SIGKILL only occurs after half of `maxWaitMs` has elapsed, meaning the design explicitly biases toward giving the target process a full "fair" opportunity to exit cleanly before forcing termination.

Rather than throwing exceptions on failure, the function returns a boolean success flag. This is a notable API design choice that shifts control-flow decisions to the caller — consistent with the surrounding `StartServicesRobust` module's philosophy of explicit, inspectable outcomes over exception-based control flow (mirrored in sibling `WaitForPortBindable`, which similarly exposes a purpose-built check distinguishing real port availability from HTTP-level responsiveness).

## Implementation Details

The core mechanics rely on two external calls surfaced in the call graph: `execAsync` (used to run `lsof -ti:<port>` for PID discovery and presumably the `kill` invocations for SIGTERM/SIGKILL) and `sleep` (used to implement the polling interval). The polling loop checks `checkPortInUse()` on a fixed cadence (`pollIntervalMs`, defaulting to 200ms) until either the port clears or `maxWaitMs` (defaulting to 5000ms) is exhausted. The halfway-point escalation logic means that with default settings, SIGTERM is given roughly 2500ms to succeed before SIGKILL is attempted, with the remaining time budget allocated to confirming the forced kill actually cleared the port.

The call chain `KillProcessOnPortAndWait -> sleep` and `KillProcessOnPortAndWait -> execAsync` confirms this is a synchronous-feeling but fully async implementation — each poll cycle awaits both a shell command (for port-state checking or signaling) and a timer-based delay, meaning the function is inherently promise-based and must be awaited by callers.

## Integration Points

`KillProcessOnPortAndWait` lives inside `StartServicesRobust`, whose parent-level sibling `withDeadline()` (in `lib/service-starter.js`) demonstrates the broader module family's concern with event-loop hygiene — ensuring timers and async waits don't leave dangling handles that delay process exit. While `killProcessOnPortAndWait` doesn't itself use `withDeadline()`, it shares the same defensive posture: bounded waiting (`maxWaitMs`) rather than unbounded polling, avoiding the same class of hung-process risk that `withDeadline()` was built to solve for `startServiceWithRetry()`.

It also complements `WaitForPortBindable`, another sibling in `start-services-robust.js`: where `waitForPortBindable()` determines whether a port is free enough to bind a new service, `killProcessOnPortAndWait()` is the corrective action taken when a port is found occupied and needs to be forcibly reclaimed before a new service can start. Together they form a check-then-act pattern for service startup orchestration.

## Usage Guidelines

Callers should treat the boolean return value as authoritative and avoid assuming success — since the function never throws, silent failures are possible if the return value is ignored. Given the default 5-second bound, callers orchestrating multiple service restarts (as implied by the `StartServicesRobust` naming) should account for cumulative wait time across multiple port-kill operations. Developers should also be aware that this function shells out via `execAsync` (relying on `lsof` and OS `kill` semantics), so it is platform-dependent (Unix-like systems) and its correctness depends on `lsof` being installed and PID discovery being accurate at the moment of invocation — a TOCTOU risk if new processes bind the port between discovery and kill.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- killProcessOnPortAndWait (function) in start-services-robust.js

**Relationships:**
- Calls: sleep, execAsync

**Other:**
- Call chain: KillProcessOnPortAndWait -> sleep
- Call chain: KillProcessOnPortAndWait -> execAsync


## Hierarchy Context

### Parent
- [StartServicesRobust](./StartServicesRobust.md) -- [LLM] lib/service-starter.js implements withDeadline() as a wrapper around Promise.race() specifically to solve a Node.js event-loop hygiene problem: when the wrapped work promise resolves before the timeout, the setTimeout timer created for the race is not automatically cancelled by Promise.race() itself. withDeadline() addresses this in a try/finally block that unconditionally calls clearTimeout(timer) regardless of whether the race was won by the work or the timeout. This is not a cosmetic detail — an uncleared timer keeps Node's event loop alive for the full duration of `ms`, which in startServiceWithRetry() is used twice per attempt (once with the caller-supplied `timeout` for startFn(), once hardcoded to 10000ms for healthCheckFn()), meaning a naive implementation would leave up to two dangling timers per retry attempt across `maxRetries` attempts, compounding into significant delayed-exit behavior for any process (test runner, CLI) that invokes this module and expects clean shutdown.

### Siblings
- [WaitForPortBindable](./WaitForPortBindable.md) -- waitForPortBindable() in scripts/start-services-robust.js explicitly contrasts itself with isPortListening, which only detects HTTP responders
- [WrapperPsmRegistrationRace](./WrapperPsmRegistrationRace.md) -- [LLM] In scripts/api-service.js, the sequence of operations after spawn() returns is: attach child.on('error'), attach child.on('exit', async ...), attach process.on('SIGTERM'/'SIGINT') handlers, log '[API Service] Started (PID: ...)', and only then kick off the async IIFE that does `new ProcessStateManager()` -> `psm.initialize()` -> `psm.registerService(...)`. Because `psm.initialize()` is itself async (almost certainly opening a LevelDB/file handle or similar), there is a real window between the child process existing (and thus eligible to crash or exit near-instantly) and the PSM registration IIFE resolving. If the wrapped process (integrations/constraint-monitor/src/dashboard-server.js) fails fast — e.g., port 3031 already bound — `child.on('exit')` can fire and attempt `psm.unregisterService('constraint-api-child', 'global')` before `registerService` for the same name has ever run, meaning the unregister is a no-op against a service that was never actually recorded, and the subsequent registerService call (if it still fires after exit) would register a PID that is already dead.


---

*Generated from 8 observations*
