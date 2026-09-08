# StartServiceWithRetry

**Type:** Detail

[Architecture Notes] startServiceWithRetry centralizes three resilience primitives (withDeadline, isProcessRunning, sleep) as private module-scoped helpers rather than shared utilities, per the code graph's depth-2 call structure; Dual error-communication contract (throw for required, degraded-status return for optional) creates an implicit coupling between the `required` option and the caller's error-handling style; Health-check timeout (10000ms) is hardcoded and not exposed via the options object, unlike the per-attempt startFn timeout which is fully configurable; Process cleanup (SIGTERM/SIGKILL escalation) is only triggered on health-check failure, not on startFn timeout/exception paths, leaving a potential orphaned-process gap; Logging is directly embedded via console.log with hardcoded emoji-prefixed strings, bypassing the project's centralized Logger class convention; startServicesParallel uses Promise.allSettled, decoupling individual service failures from overall parallel-startup control flow

# StartServiceWithRetry — Technical Insight Document

## What It Is

`startServiceWithRetry` is a function implemented in `lib/service-starter.js` (main logic at `lib/service-starter.js:186-233`) that provides retry-with-backoff orchestration for starting arbitrary services and verifying their health. It sits as a child of **ServiceProbe**, which frames it as a three-layer resilience wrapper around arbitrary async start/health-check function pairs: an outer retry loop (default `maxRetries=3`), an inner deadline guard applied independently to both the start call and health-check call, and post-failure process cleanup. It is also associated with **ServiceStarter**, reflecting its role as the core primitive of the service-starting module used across callers such as VKB, semantic-analysis, and constraint-monitor per the module's doc comments.

The call graph confirms the function has exactly three internal dependencies — `isProcessRunning`, `sleep`, and `withDeadline` — all private, module-scoped helpers defined above it in the same file rather than imported from a shared utilities module.

## Architecture and Design

The dominant pattern is **retry-with-exponential-backoff** layered on top of a **deadline/timeout racing pattern**. The `withDeadline()` helper (`lib/service-starter.js:139-158`, detailed further in sibling entity **WithDeadlineHelper**) implements `Promise.race()` with a `try/finally` that unconditionally clears the timer regardless of which branch wins — a deliberate defensive measure to avoid holding the Node.js event loop open in short-lived callers like test runners.

Within `startServiceWithRetry`, this deadline mechanism is applied twice asymmetrically: once around `startFn()` at a configurable `timeout` (default 30000ms), and once around `healthCheckFn()` at a hardcoded 10000ms not exposed via the options object. This is a conscious trade-off — reasonable when health checks are expected to be fast and uniform, but a constraint for any future service with a legitimately slower probe.

A **graceful degradation pattern** governs the required-vs-optional distinction: required services throw a synthesized Error after retries are exhausted, while optional services return a `status: 'degraded'` object (`lib/service-starter.js:240-259`). This dual contract means call sites must know in advance which idiom applies, creating a correctness trap if `required` is toggled without updating error handling.

At a higher level, `startServicesParallel()` (`lib/service-starter.js:264-296`) wraps concurrent `startServiceWithRetry` calls in `Promise.allSettled` rather than `Promise.all`, decoupling individual service failures from overall control flow — a required service failing doesn't cancel sibling startups; callers must inspect the `failed` array's `required` field after the fact.

## Implementation Details

The retry loop (`lib/service-starter.js:186-233`) calls `startFn()` under `withDeadline`, then `healthCheckFn()` under a second, separately-hardcoded `withDeadline`. On health-check failure, a teardown branch executes (`lib/service-starter.js:213-224`): `isProcessRunning(pid)` → SIGTERM → `sleep(1000)` → conditional SIGKILL escalation. Critically, this cleanup is guarded by `serviceInfo.pid &&` and only fires on the health-check-failed path — not on the `startFn()`-threw-or-timed-out path, leaving a potential gap where a hung process abandoned by `withDeadline`'s timeout rejection is never explicitly killed.

The exponential backoff delay (`lib/service-starter.js:233-238`) is computed as `retryDelay * Math.pow(2, attempt - 1)` with no upper clamp. With defaults (`retryDelay=2000`, `maxRetries=3`), delays stay small (2000ms, 4000ms), but a caller passing a higher `maxRetries` (e.g., 8) could see delays balloon to ~256 seconds, since there's no `Math.min(delay, ceiling)` safeguard.

Logging is handled by a locally-defined `log` closure gated by `options.verbose` (default true), using hardcoded emoji-prefixed string literals (🚀, 📍, ✅, ⚠️, ❌, 💥) rather than the project's centralized Logger class convention (per memory note `[[feedback_logger_class]]`), making structured/JSON logging output non-negotiable without refactoring.

## Integration Points

The function's only internal dependencies — `isProcessRunning`, `sleep`, `withDeadline` — are self-contained within `lib/service-starter.js`, meaning none of its resilience primitives are reused elsewhere per the call graph. Sibling components **PortListeningProbes** (`isPortListening` and `isTcpPortListening`) exist in the same file as opt-in health-check building blocks but are never wired directly into `startServiceWithRetry`; `healthCheckFn` is supplied by the caller, so a caller could bypass both probes entirely and pass a checkless function that always resolves true.

At the caller layer, `scripts/api-service.js:27-37` configures spawn environment via `CONSTRAINT_API_PORT`, while `scripts/dashboard-service.js:31-37` hardcodes `NEXT_PUBLIC_API_BASE_URL`, a latent coupling bug contrasting with the more flexible API service configuration. This reflects the broader architectural pattern of fail-open configuration mirrored in `docker/entrypoint.sh`.

## Usage Guidelines

Callers must be aware of the dual error-communication contract: code expecting exceptions must not pass `required: false` without adjusting for a degraded-status return instead. Given the hardcoded 10000ms health-check deadline, services with slower health probes cannot tune this without source edits. Callers configuring `maxRetries` should be cautious of the unbounded exponential backoff — high retry counts can block execution for minutes. Because process cleanup only triggers on health-check failure, callers relying on guaranteed process teardown after a `startFn()` timeout should implement supplementary cleanup. Finally, this module's console-based logging is appropriate for CLI/service-startup contexts but would require refactoring before reuse in a request-serving path where structured logging is required.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- startServiceWithRetry (function) in service-starter.js

**Relationships:**
- Calls: isProcessRunning, sleep, withDeadline

**Other:**
- Call chain: StartServiceWithRetry -> isProcessRunning
- Call chain: StartServiceWithRetry -> sleep
- Call chain: StartServiceWithRetry -> withDeadline
- The call graph confirms startServiceWithRetry() has exactly three internal dependencies — isProcessRunning, sleep, and withDeadline — and all three are private, module-scoped functions defined above it in lib/service-starter.js rather than imported from a shared utilities module. This means the retry orchestration logic is self-contained: none of its resilience primitives (deadline racing, process liveness checks, delay scheduling) are reused elsewhere in the codebase per the graph, which both simplifies reasoning about this one function in isolation and means any future duplication of this pattern (e.g. a hypothetical second retry helper) would need to re-implement or explicitly extract these three primitives rather than importing them.
- The two-deadline design visible in the call graph — withDeadline wrapping startFn() at the configurable `timeout` (default 30000ms) and a second, independently-hardcoded withDeadline wrapping healthCheckFn() at a fixed 10000ms — is not parameterized through the function's options object the way maxRetries, timeout, retryDelay, required, and exponentialBackoff are. This asymmetry means a caller of startServiceWithRetry cannot tune how long they're willing to wait for a health check without editing the source, which is a reasonable trade-off if health checks are expected to be fast and uniform across all callers (VKB, semantic-analysis, constraint-monitor, etc. per the module doc comment) but becomes a limitation if any future service has a legitimately slower health probe.


## Hierarchy Context

### Parent
- [ServiceProbe](./ServiceProbe.md) -- [LLM] service-starter.js's startServiceWithRetry() (lib/service-starter.js) implements a three-layer resilience wrapper around arbitrary async start/health-check function pairs: an outer retry loop (default maxRetries=3) with exponential backoff (retryDelay * 2^(attempt-1)), an inner withDeadline() timeout guard applied separately to both the start call and the health check call (30000ms and 10000ms respectively by default), and post-failure cleanup that SIGTERMs then SIGKILLs an unhealthy child process before the next attempt. The withDeadline() helper is deliberately written with a try/finally that calls clearTimeout(timer) regardless of whether the race was won by the work or the timer — the accompanying comment explains this exists specifically to avoid leaving a dangling setTimeout handle that would hold the Node.js event loop open in short-lived callers like test runners or one-shot CLIs, even though in the long-lived service-starter context itself the leak would be invisible.

### Siblings
- [WithDeadlineHelper](./WithDeadlineHelper.md) -- [LLM] The withDeadlineHelper (lib/service-starter.js, function withDeadline) wraps Promise.race() with a try/finally that unconditionally calls clearTimeout(timer). The critical detail is that `timer` is declared via `let timer;` outside the Promise.race array and assigned inside the executor function passed to `new Promise((_, reject) => { timer = setTimeout(...) })`. This means the finally block always has access to the timer handle regardless of which branch of the race wins, closing a subtle bug class where a naive implementation would only clear the timer on the reject path (or not at all), leaving a dangling setTimeout that holds the Node.js event loop open for the full duration `ms` even after the wrapped work resolved successfully.
- [PortListeningProbes](./PortListeningProbes.md) -- [LLM] lib/service-starter.js exposes two distinct listening-probe primitives that are never both used by the same caller in the code shown: isPortListening(port, timeout=5000) does an HTTP GET to '/health' on localhost and treats any 2xx status as 'listening', while isTcpPortListening(port, timeout=5000) opens a raw net.Socket and treats a successful 'connect' event as sufficient. This is a deliberate protocol split — the doc comment on isTcpPortListening explicitly says 'Use this for non-HTTP services like databases (Memgraph Bolt, PostgreSQL, etc.)' — but neither function is actually wired into startServiceWithRetry() in the excerpt; healthCheckFn is passed in by the caller, so these two probes are opt-in building blocks rather than an enforced health-check contract, meaning a caller could bypass both and pass a checkless function that always resolves true.


---

*Generated from 15 observations*
