# WithDeadline

**Type:** Detail

# WithDeadline — Technical Insight Document

## What It Is

`withDeadline()` is a generic timeout-wrapper utility implemented in `lib/service-starter.js`. At its core, it races a caller-supplied work promise against a timeout promise using `Promise.race()`, and guarantees cleanup of the underlying timer via a `finally` block that calls `clearTimeout()`. It is the lowest-level timing primitive in the service-starter subsystem, sitting beneath `StartServiceWithRetry` in the component hierarchy as a child utility that `startServiceWithRetry()` composes with retry/backoff logic.

Its defining characteristic is genericity: it has no knowledge of Docker, child processes, or HTTP — it simply bounds however long an arbitrary promise is allowed to run before being treated as a failure by its caller.

## Architecture and Design

The dominant pattern here is the **timeout/deadline wrapper via Promise.race with guaranteed cleanup**, one of several architectural patterns cataloged for this subsystem alongside the retry-with-backoff pattern (`startServiceWithRetry()`) and the strategy pattern used for health checks (HTTP GET vs. raw TCP probing, via `isPortListening()`/`isTcpPortListening()`).

Structurally, `withDeadline()` embodies a clean separation of concerns from its parent, `ServiceStarter`: it only knows about promise racing and cleanup, while `startServiceWithRetry()` owns retry counts, backoff, and required/optional gating semantics. This lets `startServiceWithRetry()` remain agnostic about whether `startFn()` spawns a Docker container or a Node child process — bounding is handled uniformly by `withDeadline()` regardless of the underlying work.

This design also echoes a broader team convention visible in sibling code: `WaitForPortBindable`'s `waitForPortBindable()` in `scripts/start-services-robust.js` calls `probe.unref()` on its throwaway `net.createServer()` socket for the same underlying reason `withDeadline()` calls `clearTimeout()` — to prevent Node.js event-loop handles from keeping the process alive after logical completion. This is evidence of team-wide awareness that Node's event loop must be actively managed in orchestration/health-check tooling.

## Implementation Details

The core mechanic is straightforward but subtle: `Promise.race()` is set up between the work promise and a `setTimeout`-based timeout promise, and whichever settles first determines the outcome. The critical fix embedded in the implementation is that `clearTimeout()` is called in a `finally` block — not just on the timeout/loss path, but on the **win path** too. Without this, a pending `setTimeout()` handle remains registered on the event loop even after the work promise resolves first, which can cause short-lived CLI scripts or health-check callers to hang indefinitely because a timer is still scheduled to fire.

This finally-based cleanup mirrors the idiom used in `waitForPortBindable()`, which always calls `probe.close()` in its resolve callbacks regardless of listen success or failure — suggesting `withDeadline()` was hardened as part of the same defensive-programming pass that produced these other timeout/cleanup-safe helpers in the file.

A known limitation is that `Promise.race()` does not cancel the underlying work: if `startFn()` (e.g., a Docker container spawn) is still running when the deadline fires, that work continues executing in the background even though the caller has already moved on to a retry or failure state. This is the classic trade-off of `Promise.race`-based deadlines versus true cancellation via `AbortController`. Without additional guards, this could produce duplicate or orphaned start attempts — a risk partially mitigated elsewhere by idempotency checks such as the "already-running" checks visible in `transcriptMonitor.startFn`.

## Integration Points

`withDeadline()`'s primary consumer is `startServiceWithRetry()`, imported in `scripts/start-services-robust.js`'s import list alongside `createHttpHealthCheck`, `isPortListening`, `isTcpPortListening`, and `sleep`. Each retry attempt gets a fresh deadline from `withDeadline()`, so a single hung Docker start or hung HTTP probe cannot stall the entire multi-service bring-up defined in `SERVICE_CONFIGS`.

Though not directly shown wrapping them in the provided code, `withDeadline()` is a strong candidate for reuse around the HTTP GET in `isPortListening()` or the raw `net.Socket` connection in `isTcpPortListening()` (siblings under `PortProbes`), since it is decoupled from any particular async operation.

Test coverage exists indirectly through `tests/features/service-gating.test.mjs`, where `startOneService()` tests exercise required/degraded/failed startup semantics that depend on bounded, deadline-based attempts — meaning changes to `withDeadline()`'s timing behavior have direct implications for gating test correctness.

## Usage Guidelines

Developers reusing `withDeadline()` should remember that it only stops the *caller* from waiting — it does not abort or cancel the wrapped work. Any operation wrapped by it (spawning processes, network calls) should be designed to tolerate continuing execution past the deadline, or should be paired with idempotency/already-running checks like those in `transcriptMonitor.startFn`.

Always ensure the `finally`/`clearTimeout()` discipline is preserved when modifying or extending this utility — omitting cleanup on the win path reintroduces the exact event-loop-hang bug this function was fixed to solve, an easy regression given how subtle the original bug was. When building new timeout-bounded utilities elsewhere in the codebase, follow the same cleanup-on-both-paths convention seen in `waitForPortBindable()`'s `probe.unref()`/`probe.close()` handling, rather than relying on GC or process exit for handle cleanup.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- withDeadline (function) in service-starter.js

**Other:**
- withDeadline() in service-starter.js wraps a work promise with Promise.race against a timeout promise, and uses a finally block to call clearTimeout() regardless of which promise wins the race. This is a fix for a specific hang bug: without the explicit clearTimeout(), a pending setTimeout() handle keeps the Node.js event loop alive even after the work promise resolves first, preventing the process from exiting cleanly. This is a common and subtle bug in timeout-wrapper utilities — the timer must be cancelled on the WIN path, not just the loss path, or short-lived CLI scripts and health-check callers hang indefinitely waiting for a timer that will never fire a meaningful callback.


## Hierarchy Context

### Parent
- [ServiceStarter](./ServiceStarter.md) -- startServiceWithRetry() in lib/service-starter.js accepts a startFn and healthCheckFn as parameters, making it agnostic to whether the underlying process is a Docker container or a Node child process

### Siblings
- [PortProbes](./PortProbes.md) -- [LLM] The codebase implements two structurally distinct 'is it up yet' probes that map to two different failure models. `isPortListening()` and `isTcpPortListening()` in lib/service-starter.js (consumed by scripts/start-services-robust.js) are HTTP-vs-raw-socket checks meant to detect an already-initialized service, whereas `waitForPortBindable()` in scripts/start-services-robust.js is checking the opposite condition — that the OS has fully released a port after a kill so a *new* listener won't immediately die with EADDRINUSE. The comment above `waitForPortBindable()` explicitly calls out that this is a distinct problem from `isPortListening()`: a crashed process can leave the kernel holding the socket in a way that fails HTTP probes silently while `bind()` still throws, which would otherwise burn a `maxRetries` slot in `startServiceWithRetry()` for no functional reason.
- [StartServiceWithRetry](./StartServiceWithRetry.md) -- [CGR] startServiceWithRetry (function) in service-starter.js
- [WaitForPortBindable](./WaitForPortBindable.md) -- [CGR] waitForPortBindable (function) in start-services-robust.js


---

*Generated from 10 observations*
