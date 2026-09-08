# PortListeningProbes

**Type:** Detail

[LLM] The two listening-probe implementations in this component diverge sharply on failure-handling philosophy despite solving the same 'is this port up' problem. isTcpPortListening/isPortListening in lib/service-starter.js resolve(false) on failure and let the CALLER (startServiceWithRetry) decide whether that's fatal — required services throw, optional ones degrade. wait_for_service() in entrypoint.sh, by contrast, always `return 0` even after exhausting max_attempts, per the parent observations' note about deferring 'liveness enforcement to supervisord's own restart policy.' This is not an oversight but a consequence of where each probe sits: the Node-level probes feed a retry/kill/backoff state machine that can act on failure, while the bash-level probe runs under `set -e` where a genuine failure return would abort the whole container boot — so its only safe design is fail-open.

# PortListeningProbes: Technical Insight Document

## What It Is

PortListeningProbes refers to the pair of listening-probe primitives implemented in `lib/service-starter.js`: `isPortListening(port, timeout=5000)` (lines 33-49) and `isTcpPortListening(port, timeout=5000)` (lines 55-76). The first performs an HTTP GET against `/health` on `localhost` and treats any 2xx response as evidence the service is listening; the second opens a raw `net.Socket` and treats a successful `connect` event as sufficient proof. The doc comment on `isTcpPortListening` is explicit about its intended scope: "Use this for non-HTTP services like databases (Memgraph Bolt, PostgreSQL, etc.)." These two functions are the low-level building blocks that feed into the `healthCheckFn` parameter consumed by the parent component, ServiceProbe's `startServiceWithRetry()`.

A conceptually related but independently implemented probe exists at `docker/entrypoint.sh:14-30` — `wait_for_service()` — which reimplements the same "is this port up" check in bash via `timeout 2 bash -c "echo >/dev/tcp/$host/$port"`. This is not a shared abstraction but a deliberate cross-language duplication, since entrypoint.sh executes before any Node process exists.

## Architecture and Design

The core architectural decision is a **dual-protocol probing strategy** selected per service type. `isPortListening`'s HTTP-level check is materially stronger than a bare TCP handshake: a process can accept TCP connections long before its HTTP framework has registered routes or its dependencies (DB, cache) have initialized. This pushes the same "don't trust bare listening as ready" philosophy that governs the parent's settle-delay-plus-deadlined-healthCheck design down into the probe layer itself. `isTcpPortListening` is reserved for services with no HTTP surface, where a TCP handshake is the only available readiness signal.

Critically, neither probe is hard-wired into `startServiceWithRetry()`. The retry/backoff state machine (sibling StartServiceWithRetry) accepts `healthCheckFn` as an opaque callback, meaning the probes are **opt-in building blocks, not an enforced contract** — a caller could bypass both and supply a checkless function that always resolves true. This decoupling is intentional: the retry loop has no knowledge of which probe strategy underlies it.

The second major pattern is **fail-fast-and-quiet resolution semantics**: every error path (socket `error`, HTTP `error`, timeout) resolves `false` rather than rejecting, with `client.destroy()`/`socket.destroy()` called explicitly before resolution. This matters because the sibling WithDeadlineHelper wraps whatever `healthCheckFn` it's given in its own deadline race — if a probe left a promise permanently pending on a hung connect, the outer deadline would still fire, but the underlying socket/HTTP client would linger unless destroyed manually.

## Implementation Details

`isPortListening` and `isTcpPortListening` share a structural pattern: construct a client (HTTP or raw socket), attach listeners for the success case and all failure cases (error, timeout), and guarantee `destroy()` is called on every terminal branch before `resolve()`. Neither function validates or sanitizes the `port` argument — no bounds check against 0-65535, no type coercion guard — and both hardcode `'localhost'` as the connection target rather than accepting a host parameter. This makes them architecturally scoped to same-host checks only, consistent with their use for locally-spawned child processes inside `startServiceWithRetry()`.

By contrast, `wait_for_service()` in `docker/entrypoint.sh:33-41` is host-parameterized and invoked for both Qdrant and Redis with distinct host arguments, reflecting its genuinely multi-host use case — containers reaching sibling containers by service name. The bash implementation also diverges sharply in failure philosophy: it always `return 0`, even after exhausting `max_attempts`, deferring liveness enforcement to supervisord's restart policy. This is a necessity, not an oversight — entrypoint.sh runs under `set -e`, where a genuine failure return would abort container boot entirely, so fail-open is the only safe design at that layer.

## Integration Points

PortListeningProbes connects to its parent ServiceProbe purely through the `healthCheckFn` callback contract of `startServiceWithRetry()`. The retry loop's outer structure — retries with exponential backoff, per-call deadlines via WithDeadlineHelper's `withDeadline()`, and SIGTERM/SIGKILL cleanup between attempts — is entirely agnostic to whether `isPortListening` or `isTcpPortListening` (or neither) is plugged in underneath. The probes' guaranteed-resolve, guaranteed-cleanup semantics are what make them safe to race against `withDeadline()`'s `Promise.race` + `clearTimeout` pattern without producing dangling handles or unhandled rejections.

Across the process boundary, `wait_for_service()` in entrypoint.sh has no code-level integration with the Node-level probes at all — it cannot import an ESM module from bash. Consistency between the two implementations (bash TCP probe vs. `isTcpPortListening`) is maintained purely by convention, since entrypoint.sh executes prior to and independent of the Node runtime that eventually launches under supervisord.

## Usage Guidelines

Developers wiring a new service into `startServiceWithRetry()` should choose `isPortListening` when a `/health` HTTP endpoint exists, since a bare TCP-accept is not a reliable readiness signal for HTTP services with route registration or dependency-init delays. Use `isTcpPortListening` only for non-HTTP services where no better signal is available (e.g., Memgraph Bolt, PostgreSQL). Because neither probe validates its port argument or supports non-localhost targets, they should not be repurposed for cross-container or cross-host checks — use or extend the entrypoint.sh-style approach for that.

Because these probes are opt-in rather than enforced, code review should verify that any custom `healthCheckFn` passed to `startServiceWithRetry()` actually performs a meaningful check rather than trivially resolving true. When modifying `wait_for_service()` in entrypoint.sh or the Node-level probes, remember they must be kept semantically consistent by convention only — there is no shared library boundary, so changes to one should be manually mirrored in the other if the underlying protocol assumptions change.


## Hierarchy Context

### Parent
- [ServiceProbe](./ServiceProbe.md) -- [LLM] service-starter.js's startServiceWithRetry() (lib/service-starter.js) implements a three-layer resilience wrapper around arbitrary async start/health-check function pairs: an outer retry loop (default maxRetries=3) with exponential backoff (retryDelay * 2^(attempt-1)), an inner withDeadline() timeout guard applied separately to both the start call and the health check call (30000ms and 10000ms respectively by default), and post-failure cleanup that SIGTERMs then SIGKILLs an unhealthy child process before the next attempt. The withDeadline() helper is deliberately written with a try/finally that calls clearTimeout(timer) regardless of whether the race was won by the work or the timer — the accompanying comment explains this exists specifically to avoid leaving a dangling setTimeout handle that would hold the Node.js event loop open in short-lived callers like test runners or one-shot CLIs, even though in the long-lived service-starter context itself the leak would be invisible.

### Siblings
- [WithDeadlineHelper](./WithDeadlineHelper.md) -- [LLM] The withDeadlineHelper (lib/service-starter.js, function withDeadline) wraps Promise.race() with a try/finally that unconditionally calls clearTimeout(timer). The critical detail is that `timer` is declared via `let timer;` outside the Promise.race array and assigned inside the executor function passed to `new Promise((_, reject) => { timer = setTimeout(...) })`. This means the finally block always has access to the timer handle regardless of which branch of the race wins, closing a subtle bug class where a naive implementation would only clear the timer on the reject path (or not at all), leaving a dangling setTimeout that holds the Node.js event loop open for the full duration `ms` even after the wrapped work resolved successfully.
- [StartServiceWithRetry](./StartServiceWithRetry.md) -- [CGR] startServiceWithRetry (function) in service-starter.js


---

*Generated from 9 observations*
