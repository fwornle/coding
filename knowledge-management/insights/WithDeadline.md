# WithDeadline

**Type:** Detail

[LLM+CGR] The two call sites of withDeadline inside startServiceWithRetry use different, asymmetric ms/message pairs: `withDeadline(startFn(), timeout, 'Startup timeout after ${timeout}ms')` where timeout defaults to 30000 and is caller-configurable via options.timeout, versus `withDeadline(healthCheckFn(serviceInfo), 10000, 'Health check timeout')` where 10000 is a literal embedded at the call site with no corresponding options field. This means withDeadline itself is fully generic and reusable, but the service-level policy layered on top of it (startServiceWithRetry) hardcodes one of its two invocations, so the reusability of the helper does not translate into configurability of the health-check budget for callers of the higher-level function.

# WithDeadline — Technical Insight Document

## What It Is

`withDeadline` is a standalone async helper function defined in `lib/service-starter.js`, part of the broader **ServiceStarter** component. It is not a class and is not shown as exported in the truncated listing, suggesting it functions as an internal utility used exclusively within the module. Its signature, `withDeadline(work, ms, message)`, wraps an already-invoked promise (`work`) in a race against a timeout, guaranteeing that any timer resources are cleaned up regardless of outcome. It is the low-level timing-safety primitive that its sibling function, **StartServiceWithRetry** (`startServiceWithRetry`), builds its resilience behavior on top of.

## Architecture and Design

The core pattern is a **deadline/timeout wrapper via `Promise.race`**, combined with a **fail-safe resource cleanup** strategy: `let timer;` is declared in the outer function scope specifically so a `finally` block can call `clearTimeout(timer)` no matter which promise in the race settles first. This is a deliberate departure from the naive `Promise.race` timeout pattern common in many codebases, where the losing `setTimeout` is left armed on the event loop — a frequent cause of hung processes or leaked timer handles, especially problematic under `startServiceWithRetry`'s exponential-backoff loop where dozens of attempts could otherwise accumulate dangling timers.

The design cleanly separates **mechanism from policy**: `withDeadline` supplies only the generic, leak-free race mechanics, while `startServiceWithRetry` supplies all domain-specific decisions — what `work` is, how long is acceptable, and what error message to surface. This single-responsibility boundary is what allows the same helper to safely bound both a multi-second service startup and a much shorter health probe.

## Implementation Details

Internally, `withDeadline` constructs a rejection promise via `new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })`, races it against `work` using `Promise.race`, and unconditionally executes `clearTimeout(timer)` in `finally`. Because `setTimeout` synchronously returns a handle, `timer` is always assigned before any possible throw, making the defensive `clearTimeout(undefined)` no-op path theoretically safe but practically unreachable.

Critically, `withDeadline` accepts an **already-invoked promise, not a thunk**. This means the caller — `startServiceWithRetry` — must call `startFn()` or `healthCheckFn(serviceInfo)` before passing the result in. Consequently, any *synchronous* throw inside those functions occurs outside `withDeadline`'s `try/finally` entirely, bypassing the deadline mechanism — only the asynchronous portion of `work` is actually bounded.

`withDeadline` has no awareness of *why* `work` settles: it returns or rethrows whatever `Promise.race` produces. Its entire contribution to correctness is the `finally`-block cleanup — it does not distinguish a timeout Error from a functional error thrown by `work`, and downstream consumers can only differentiate them via `error.message` string inspection (e.g., `'Startup timeout after 30000ms'`) rather than structured error classes.

## Integration Points

`startServiceWithRetry` invokes `withDeadline` twice per attempt with asymmetric configuration:

- `withDeadline(startFn(), timeout, 'Startup timeout after ${timeout}ms')` — `timeout` defaults to 30000ms but is caller-configurable via `options.timeout`.
- `withDeadline(healthCheckFn(serviceInfo), 10000, 'Health check timeout')` — 10000ms is a literal hardcoded at the call site with no corresponding options field.

This asymmetry means the helper itself is fully generic and reusable, but the policy layer above it does not expose equivalent configurability for both invocations. Since `withDeadline` rethrows Errors rather than returning a status/sentinel, both call sites rely on ordinary `try/catch`: the retry loop's per-attempt `catch (error)` block treats a genuine `startFn()` failure and a `withDeadline` timeout identically, setting `lastError = error`, with the distinguishing detail surviving only in the message text.

The health-check invocation is also just one piece of a larger latency budget the retry loop tolerates per attempt — `sleep(2000)` (grace period) + up to 10000ms (health check) + up to 1000ms (SIGTERM grace in the kill branch) + backoff delay — none of which `withDeadline` itself is aware of; it only bounds the single promise passed to it.

Notably, `withDeadline` does not interact with the sibling **PortListeningChecks** helpers (`isPortListening`, `isTcpPortListening`) directly — those are building blocks a caller composes into an arbitrary `healthCheckFn(serviceInfo)`, which is then wrapped by `withDeadline`. This preserves the decoupling between "how is health determined" and "how is health-check duration bounded."

## Usage Guidelines

Developers reusing `withDeadline` should remember it expects an **invoked promise, not a thunk** — any synchronous throw must be guarded by the caller before invocation, or it will escape the deadline entirely. Because errors are surfaced as generic `Error` objects distinguished only by message string, any code branching on timeout-vs-functional-failure should treat this as a fragile, string-matching contract rather than a structured error hierarchy — a candidate for future refactoring if stricter error typing is needed. When adding new call sites, consider whether the timeout value should be configurable (as with `startFn`'s `timeout` option) or is acceptable as a hardcoded constant (as with the health check's 10000ms) — the current asymmetry is a known trade-off, not an oversight, but it limits configurability for callers of `startServiceWithRetry` who might want to tune health-check budgets per service.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- withDeadline (function) in service-starter.js

**Other:**
- withDeadline (service-starter.js) is a standalone async helper — not a class, not exported in the truncated listing — that wraps `Promise.race` between a caller-supplied `work` promise and a `setTimeout`-driven rejection, then unconditionally clears the timer in a `finally` block. The function signature `withDeadline(work, ms, message)` is intentionally generic: it takes an already-invoked promise (not a thunk), meaning the caller (startServiceWithRetry) is responsible for triggering `startFn()` or `healthCheckFn(serviceInfo)` before wrapping it, so any synchronous throw inside those functions happens outside withDeadline's try/finally and is not subject to the deadline at all — only the asynchronous portion is bounded.
- The two call sites of withDeadline inside startServiceWithRetry use different, asymmetric ms/message pairs: `withDeadline(startFn(), timeout, 'Startup timeout after ${timeout}ms')` where timeout defaults to 30000 and is caller-configurable via options.timeout, versus `withDeadline(healthCheckFn(serviceInfo), 10000, 'Health check timeout')` where 10000 is a literal embedded at the call site with no corresponding options field. This means withDeadline itself is fully generic and reusable, but the service-level policy layered on top of it (startServiceWithRetry) hardcodes one of its two invocations, so the reusability of the helper does not translate into configurability of the health-check budget for callers of the higher-level function.


## Hierarchy Context

### Parent
- [ServiceStarter](./ServiceStarter.md) -- [LLM] The core resilience primitive in lib/service-starter.js is withDeadline(), which wraps Promise.race() around a work promise and a timeout-rejecting promise, then clears the timer in a finally block regardless of which promise wins. This is not the naive Promise.race() pattern seen in many codebases — the naive version leaves the losing setTimeout timer armed on the event loop even after the work promise resolves, which is a classic cause of hung Node.js processes (a test runner or one-shot CLI that never exits cleanly, or a long-lived service that leaks a timer handle per retry attempt). startServiceWithRetry() calls withDeadline() twice per attempt (once wrapping startFn() with the attempt's `timeout` option, once wrapping healthCheckFn() with a hardcoded 10000ms), so the leak-avoidance matters doubly under the exponential-backoff retry loop where dozens of timers could otherwise accumulate across maxRetries attempts.

### Siblings
- [StartServiceWithRetry](./StartServiceWithRetry.md) -- [CGR] startServiceWithRetry (function) in service-starter.js
- [PortListeningChecks](./PortListeningChecks.md) -- [LLM] lib/service-starter.js implements two distinct port-listening checks — isPortListening() (HTTP-based, does a GET to /health and treats 2xx as healthy) and isTcpPortListening() (raw net.Socket connect, resolves true on the 'connect' event alone) — but neither is actually called anywhere inside startServiceWithRetry() itself. The retry loop takes an arbitrary healthCheckFn(serviceInfo) as a parameter instead, meaning these two exported helpers are building blocks a caller may compose into its own healthCheckFn rather than logic wired into the retry machinery directly. This is a meaningful design choice: it decouples 'how do I know this service is up' (HTTP health endpoint vs raw TCP port vs something else entirely, e.g. a PID check) from 'how many times do I retry and how do I back off', letting the same retry/timeout/kill scaffolding serve services with heterogeneous health semantics — a JSON HTTP health check for something like VKB Server versus a bare TCP handshake for Qdrant or Redis-style dependencies.


---

*Generated from 10 observations*
