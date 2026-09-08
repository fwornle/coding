# WaitForPortBindable

**Type:** Detail

Documented rationale: a crashed process can leave the kernel holding a socket briefly, and spawning into that window burns a maxRetries slot with EADDRINUSE

## What It Is

`waitForPortBindable()` is a helper function implemented in `scripts/start-services-robust.js`, part of the larger `StartServicesRobust` component. Its purpose is to determine whether a TCP port is genuinely free to bind, as opposed to merely checking whether something is currently responding on it. The function explicitly positions itself as a correction to a weaker sibling check, `isPortListening`, which only detects HTTP responders and therefore cannot distinguish "port truly free" from "port occupied by a non-HTTP process or a lingering kernel-held socket."

## Architecture and Design

The core design pattern here is a **disposable-probe polling loop**: rather than inspecting OS-level socket state through an external tool, the function opens a throwaway `net.createServer().listen()` on each poll iteration and immediately closes it (`probe.close(() => resolve(true))`) upon success. This is a lightweight, dependency-free way to ask the kernel directly "can I bind this port right now?" rather than relying on indirect signals like HTTP responsiveness.

The documented rationale reveals the real design driver: after a process crash, the kernel can hold a socket in a transitional state for a brief window. If a caller naively retries a spawn during that window, it burns a `maxRetries` slot on an `EADDRINUSE` error. `waitForPortBindable()` exists specifically to absorb that race window before spawn attempts occur, protecting the retry budget used elsewhere in the file.

Polling parameters — `pollIntervalMs` (default 250ms) and `maxWaitMs` (default 5000ms) — mirror the retry-with-timeout pattern used throughout `start-services-robust.js`, giving the file a consistent idiom for bounded waiting rather than introducing a bespoke timeout mechanism just for this function.

## Implementation Details

Mechanically, the function loops: attempt to bind a disposable server, and on success close it and resolve `true`. On failure (port still bound), it waits via the `sleep` helper before retrying, per the call chain `WaitForPortBindable -> sleep`. This continues until either the bind succeeds or `maxWaitMs` elapses, at which point it presumably resolves `false` (or times out), consistent with the bounded-wait convention used by sibling logic in the file.

The use of a real `net.createServer().listen()` probe (rather than shelling out) keeps the check self-contained and fast per iteration, at the cost of creating/destroying a server object each poll — an accepted trade-off given the short poll interval and bounded total wait.

## Integration Points

Within `StartServicesRobust`, `waitForPortBindable` sits alongside `KillProcessOnPortAndWait`, which uses `lsof -ti:<port>` to find PIDs holding a port before cleanup. The two are complementary: `KillProcessOnPortAndWait` handles killing an occupying process, while `waitForPortBindable` handles waiting out the kernel's post-crash socket hold — together covering both "something is deliberately using the port" and "nothing is using it, but the OS hasn't released it yet."

Its parent context, `StartServicesRobust`, also documents `withDeadline()` in `lib/service-starter.js`, which wraps `Promise.race()` with disciplined `clearTimeout` cleanup to avoid dangling timers across `maxRetries` attempts. `waitForPortBindable`'s own bounded polling (`maxWaitMs`) reflects the same file-wide discipline of never waiting unboundedly, keeping it consistent with the timeout hygiene enforced elsewhere in the startup/retry machinery.

The sibling `WrapperPsmRegistrationRace` in `scripts/api-service.js` illustrates a related class of problem — a race window between process spawn and async registration — reinforcing that this codebase is broadly concerned with races around process lifecycle and port/socket state, of which `waitForPortBindable` addresses the kernel-socket variant specifically.

## Usage Guidelines

Developers should prefer `waitForPortBindable()` over `isPortListening` whenever the goal is to confirm a port is safe to bind (e.g., before spawning a service), not merely to check liveness of an HTTP endpoint — the two checks answer different questions and are not interchangeable. Callers should also respect the existing `pollIntervalMs`/`maxWaitMs` defaults unless there's a specific reason to override them, since these values are tuned to the same retry-with-timeout convention used elsewhere in `start-services-robust.js`. When adding new port-management logic, it should follow this same bounded-polling idiom rather than introducing unbounded waits or ad hoc timeout handling, to keep behavior predictable across the module.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- waitForPortBindable (function) in start-services-robust.js

**Relationships:**
- Calls: sleep

**Other:**
- Call chain: WaitForPortBindable -> sleep


## Hierarchy Context

### Parent
- [StartServicesRobust](./StartServicesRobust.md) -- [LLM] lib/service-starter.js implements withDeadline() as a wrapper around Promise.race() specifically to solve a Node.js event-loop hygiene problem: when the wrapped work promise resolves before the timeout, the setTimeout timer created for the race is not automatically cancelled by Promise.race() itself. withDeadline() addresses this in a try/finally block that unconditionally calls clearTimeout(timer) regardless of whether the race was won by the work or the timeout. This is not a cosmetic detail — an uncleared timer keeps Node's event loop alive for the full duration of `ms`, which in startServiceWithRetry() is used twice per attempt (once with the caller-supplied `timeout` for startFn(), once hardcoded to 10000ms for healthCheckFn()), meaning a naive implementation would leave up to two dangling timers per retry attempt across `maxRetries` attempts, compounding into significant delayed-exit behavior for any process (test runner, CLI) that invokes this module and expects clean shutdown.

### Siblings
- [KillProcessOnPortAndWait](./KillProcessOnPortAndWait.md) -- killProcessOnPortAndWait() in scripts/start-services-robust.js uses lsof -ti:<port> to discover PIDs holding a port before attempting cleanup
- [WrapperPsmRegistrationRace](./WrapperPsmRegistrationRace.md) -- [LLM] In scripts/api-service.js, the sequence of operations after spawn() returns is: attach child.on('error'), attach child.on('exit', async ...), attach process.on('SIGTERM'/'SIGINT') handlers, log '[API Service] Started (PID: ...)', and only then kick off the async IIFE that does `new ProcessStateManager()` -> `psm.initialize()` -> `psm.registerService(...)`. Because `psm.initialize()` is itself async (almost certainly opening a LevelDB/file handle or similar), there is a real window between the child process existing (and thus eligible to crash or exit near-instantly) and the PSM registration IIFE resolving. If the wrapped process (integrations/constraint-monitor/src/dashboard-server.js) fails fast — e.g., port 3031 already bound — `child.on('exit')` can fire and attempt `psm.unregisterService('constraint-api-child', 'global')` before `registerService` for the same name has ever run, meaning the unregister is a no-op against a service that was never actually recorded, and the subsequent registerService call (if it still fires after exit) would register a PID that is already dead.


---

*Generated from 7 observations*
