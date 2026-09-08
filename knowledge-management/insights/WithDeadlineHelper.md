# WithDeadlineHelper

**Type:** Detail

[LLM] The withDeadlineHelper (lib/service-starter.js, function withDeadline) wraps Promise.race() with a try/finally that unconditionally calls clearTimeout(timer). The critical detail is that `timer` is declared via `let timer;` outside the Promise.race array and assigned inside the executor function passed to `new Promise((_, reject) => { timer = setTimeout(...) })`. This means the finally block always has access to the timer handle regardless of which branch of the race wins, closing a subtle bug class where a naive implementation would only clear the timer on the reject path (or not at all), leaving a dangling setTimeout that holds the Node.js event loop open for the full duration `ms` even after the wrapped work resolved successfully.

# WithDeadlineHelper — Technical Insight Document

## What It Is

`WithDeadlineHelper` refers to the `withDeadline` function implemented in `lib/service-starter.js`, a private, unexported utility that races an arbitrary promise (`work`) against a `setTimeout`-based deadline. It exists as a foundational piece of its parent component, **ServiceProbe** — specifically, ServiceProbe's `startServiceWithRetry()` uses `withDeadline` as the timeout-enforcement layer within a larger three-layer resilience wrapper (retry loop, deadline guard, process cleanup). Despite its generic, reusable design and an explicit doc comment describing the bug class it prevents, `withDeadline` is scoped entirely to this one module, with no exposure to sibling scripts like `scripts/api-service.js` or `scripts/dashboard-service.js`.

## Architecture and Design

The core pattern is a classic **Promise.race-based timeout wrapper with guaranteed resource cleanup**. A `let timer;` variable is declared outside the `Promise.race` array and assigned inside the executor of a second promise (`new Promise((_, reject) => { timer = setTimeout(...) })`), giving a surrounding `try/finally` block unconditional access to the timer handle regardless of which race branch wins. This closes a subtle bug class: naive implementations only clear the timer on the reject path (or never), leaving a dangling `setTimeout` that holds the Node.js event loop open for the full duration `ms` even after the wrapped work resolves successfully.

This is paired with a **fail-fast timeout composition** pattern — the same generic helper is invoked twice within `startServiceWithRetry()`, each time with a different duration and a distinct diagnostic message, demonstrating a reusable-primitive-with-per-call-site-configuration design rather than duplicating timeout logic.

## Implementation Details

`withDeadline` takes three parameters: the promise to wrap (`work`), a duration in milliseconds (`ms`), and a message string. Internally:

- `Promise.race([work, timeoutPromise])` competes the wrapped work against a timeout promise that rejects with the given message.
- The `timer` variable, hoisted outside the race array, is guaranteed to be set by the time either promise settles.
- A `finally` block calls `clearTimeout(timer)` unconditionally, ensuring the event loop handle is released whether `work` resolved, rejected, or the timer itself fired.

Within `startServiceWithRetry()`, this function is invoked twice:
1. `withDeadline(startFn(), timeout, 'Startup timeout after ${timeout}ms')` — wraps the per-attempt start call, where `timeout` defaults to 30000ms and is configurable via `options.timeout`.
2. `withDeadline(healthCheckFn(serviceInfo), 10000, 'Health check timeout')` — wraps the health check call with a **hardcoded** 10000ms deadline.

The distinct messages ('Startup timeout after...' vs 'Health check timeout') double as both rejection payloads and diagnostic strings, letting a single catch block in `startServiceWithRetry()` log a unified failure via `error.message` without separate try/catch scaffolding around each awaited call.

## Integration Points

`WithDeadlineHelper` is a child utility of **ServiceProbe**, sitting inside the middle layer of its three-layer resilience design: an outer retry loop (default `maxRetries=3` with exponential backoff via `retryDelay * 2^(attempt-1)`), the `withDeadline` timeout guard applied separately to `startFn()` and `healthCheckFn()`, and post-failure cleanup that sends SIGTERM then SIGKILL to an unhealthy child process before retrying.

It has no direct interaction with sibling probes **PortListeningProbes** (`isPortListening`, `isTcpPortListening`) — those are opt-in building blocks that a caller may or may not supply as `healthCheckFn`, meaning `withDeadline` simply times out whatever health-check promise it's given, with no enforced contract on what that promise actually verifies. The **StartServiceWithRetry** sibling is effectively the sole consumer of `withDeadline`, embedding both of its call sites directly.

## Usage Guidelines

Developers extending `startServiceWithRetry()` should be aware of the asymmetry in tunability: the startup timeout is configurable via `options.timeout`, but the health-check deadline (10000ms) is hardcoded and cannot be adjusted without editing `lib/service-starter.js` directly — a concern for callers with expensive startup validation logic.

Critically, `withDeadline` only protects its own `setTimeout` handle from leaking; it does **not** cancel the underlying `work` if the timer wins the race. If `startFn()` or `healthCheckFn()` ignores cancellation, the operation continues running in the background after `withDeadline`'s promise has already rejected and the caller has moved on to retrying or killing the process — a known, largely unavoidable limitation of `Promise.race`-based timeouts in JavaScript absent explicit AbortSignal support in the wrapped function.

The doc comment's framing — contrasting an "invisible" leak in a long-lived service starter versus a hang of exactly `ms` in "a test runner, a one-shot CLI" — suggests this was a fix for a real observed hang in a short-lived context, not a purely theoretical concern, though no confirming call site outside `lib/service-starter.js` is present in the current code graph. Given its generic, well-documented design, `withDeadline` is a strong candidate for extraction into a shared utility module if other scripts (which currently rely on raw `spawn()` with `stdio: 'inherit'` and no deadline protection) need similar guarantees.


## Hierarchy Context

### Parent
- [ServiceProbe](./ServiceProbe.md) -- [LLM] service-starter.js's startServiceWithRetry() (lib/service-starter.js) implements a three-layer resilience wrapper around arbitrary async start/health-check function pairs: an outer retry loop (default maxRetries=3) with exponential backoff (retryDelay * 2^(attempt-1)), an inner withDeadline() timeout guard applied separately to both the start call and the health check call (30000ms and 10000ms respectively by default), and post-failure cleanup that SIGTERMs then SIGKILLs an unhealthy child process before the next attempt. The withDeadline() helper is deliberately written with a try/finally that calls clearTimeout(timer) regardless of whether the race was won by the work or the timer — the accompanying comment explains this exists specifically to avoid leaving a dangling setTimeout handle that would hold the Node.js event loop open in short-lived callers like test runners or one-shot CLIs, even though in the long-lived service-starter context itself the leak would be invisible.

### Siblings
- [StartServiceWithRetry](./StartServiceWithRetry.md) -- [CGR] startServiceWithRetry (function) in service-starter.js
- [PortListeningProbes](./PortListeningProbes.md) -- [LLM] lib/service-starter.js exposes two distinct listening-probe primitives that are never both used by the same caller in the code shown: isPortListening(port, timeout=5000) does an HTTP GET to '/health' on localhost and treats any 2xx status as 'listening', while isTcpPortListening(port, timeout=5000) opens a raw net.Socket and treats a successful 'connect' event as sufficient. This is a deliberate protocol split — the doc comment on isTcpPortListening explicitly says 'Use this for non-HTTP services like databases (Memgraph Bolt, PostgreSQL, etc.)' — but neither function is actually wired into startServiceWithRetry() in the excerpt; healthCheckFn is passed in by the caller, so these two probes are opt-in building blocks rather than an enforced health-check contract, meaning a caller could bypass both and pass a checkless function that always resolves true.


---

*Generated from 9 observations*
