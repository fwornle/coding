# PortListeningChecks

**Type:** Detail

[LLM] The two health-check functions encode different failure semantics that a caller must understand before choosing one. isPortListening() treats any request-level error (client.on('error')) or timeout as false, but also implicitly treats any non-2xx status code (e.g. 500, 404) as unhealthy via the strict `res.statusCode >= 200 && res.statusCode < 300` range check — so a service that is up but returning 503 during its own warmup would read as fully down to startServiceWithRetry(), triggering the SIGTERM/SIGKILL cleanup path even though the process might have recovered given more time. isTcpPortListening(), by contrast, only proves a listener exists on the port — it resolves true purely from the socket 'connect' event with no protocol-level verification, so a TCP-accepting-but-application-broken process (e.g. a Node process that bound the port before crashing in its request handler) would pass this check yet still be non-functional. Choosing the wrong one of these two for a given service could produce either false negatives (aggressive killing of a slow-starting service) or false positives (declaring 'success' on a process that never becomes truly usable).

# PortListeningChecks — Technical Insight Document

## What It Is

PortListeningChecks refers to a pair of exported probe functions implemented in `lib/service-starter.js`: `isPortListening()` and `isTcpPortListening()`. Both are pure, side-effect-free functions that answer the question "is something responding on this port?" using two different protocol-level strategies — an HTTP GET to `/health` treating any 2xx status as healthy (`isPortListening()`), and a raw `net.Socket` connect that resolves `true` purely on the socket's `connect` event with no application-level verification (`isTcpPortListening()`). Critically, neither function is invoked internally by the retry machinery in its parent component, **ServiceStarter** — they are library building blocks that a caller composes into a `healthCheckFn` closure, which is then passed into the sibling function `StartServiceWithRetry` (`startServiceWithRetry()`).

## Architecture and Design

The dominant pattern here is Strategy: `healthCheckFn` is a caller-supplied strategy interface, and `isPortListening()`/`isTcpPortListening()` are two interchangeable implementations covering different protocol semantics (HTTP health endpoint vs. bare TCP handshake). This decouples "how do I know a service is up" from "how many times do I retry and how do I back off" — the latter concern living entirely in `startServiceWithRetry()` and its use of the sibling `WithDeadline` (`withDeadline()`) primitive. This separation lets the same retry/timeout/kill scaffolding serve heterogeneous dependencies: a JSON HTTP health check for something like a VKB Server versus a plain TCP handshake for Qdrant- or Redis-style services.

A second, unrelated architectural axis exists at the system level: `docker/entrypoint.sh`'s `PROGRAM_FEATURES` supervisord autostart gating and `service-starter.js`'s required/optional retry classification are structurally similar "is this allowed to be down" checks that are functionally disconnected. PortListeningChecks sits only on the `service-starter.js` side — a program disabled via the feature snapshot never reaches a `startFn`/`healthCheckFn` pair at all, so no port check is ever attempted. Diagnosing "why isn't port X responding" therefore requires checking both mechanisms independently.

## Implementation Details

`isPortListening()` performs an HTTP GET to `/health`, treating any `client.on('error')` or timeout as unhealthy, and enforcing a strict `res.statusCode >= 200 && res.statusCode < 300` range — meaning a service returning 503 during warmup reads as fully down. `isTcpPortListening()` only proves a listener exists on the socket, resolving `true` on `connect` with zero protocol verification, so a process that bound the port but crashed inside its request handler would still pass. Both default their `timeout` parameter to 5000ms.

This 5000ms default interacts poorly with the outer scaffolding: `startServiceWithRetry()` wraps `healthCheckFn()` in `withDeadline()` with a hardcoded 10000ms deadline. Since the internal 5000ms timeout fires first, the outer 10000ms deadline is effectively dead code under default configuration — the real ceiling on a single probe is 5000ms unless a caller explicitly overrides the timeout argument.

Two other helpers round out the module. `isProcessRunning()` wraps `process.kill(pid, 0)` in try/catch without inspecting the thrown error's type, so a permissions failure (`EPERM`, process owned by another user) is indistinguishable from "process does not exist" — a latent gap that's benign in its current caller context (the wrapper killing its own recently-spawned child) but risky if reused elsewhere. `sleep()` is a non-cancellable `setTimeout` promise wrapper, used for a 2000ms post-start delay and a 1000ms post-SIGTERM delay before SIGKILL escalation — deliberately simpler than `withDeadline()`, which uses try/finally to clear its timer and is safe to race against other async work.

## Integration Points

PortListeningChecks integrates with its parent, **ServiceStarter**, exclusively through the `healthCheckFn` parameter contract of `startServiceWithRetry()`, and indirectly through `withDeadline()`'s timeout-racing behavior. It has no direct coupling to `docker/entrypoint.sh`'s feature-gating mechanism, `isProcessRunning()`, or `sleep()` beyond sharing the same module and being composed by the same callers. Any caller wiring `() => isPortListening(port)` or `() => isTcpPortListening(port)` into `healthCheckFn` implicitly inherits the 5000ms/10000ms timeout mismatch described above.

## Usage Guidelines

Choose `isPortListening()` for services with a meaningful HTTP health endpoint where a strict 2xx check is desired, accepting the risk of false negatives during legitimate 503-warmup windows that could trigger premature SIGTERM/SIGKILL cleanup. Choose `isTcpPortListening()` only when a bare listening socket is a sufficient proxy for health, accepting the risk of false positives on a process that accepted a connection but is otherwise non-functional. When composing either into `healthCheckFn`, explicitly override the default 5000ms timeout if you want the outer 10000ms `withDeadline()` ceiling to have any effect. Do not reuse `isProcessRunning()` for cross-user PID checks without adding error-code inspection. Finally, remember that a disabled `PROGRAM_FEATURES` entry means no port check is ever attempted — rule that out before debugging `isPortListening()`/`isTcpPortListening()` behavior.


## Hierarchy Context

### Parent
- [ServiceStarter](./ServiceStarter.md) -- [LLM] The core resilience primitive in lib/service-starter.js is withDeadline(), which wraps Promise.race() around a work promise and a timeout-rejecting promise, then clears the timer in a finally block regardless of which promise wins. This is not the naive Promise.race() pattern seen in many codebases — the naive version leaves the losing setTimeout timer armed on the event loop even after the work promise resolves, which is a classic cause of hung Node.js processes (a test runner or one-shot CLI that never exits cleanly, or a long-lived service that leaks a timer handle per retry attempt). startServiceWithRetry() calls withDeadline() twice per attempt (once wrapping startFn() with the attempt's `timeout` option, once wrapping healthCheckFn() with a hardcoded 10000ms), so the leak-avoidance matters doubly under the exponential-backoff retry loop where dozens of timers could otherwise accumulate across maxRetries attempts.

### Siblings
- [StartServiceWithRetry](./StartServiceWithRetry.md) -- [CGR] startServiceWithRetry (function) in service-starter.js
- [WithDeadline](./WithDeadline.md) -- [CGR] withDeadline (function) in service-starter.js


---

*Generated from 9 observations*
