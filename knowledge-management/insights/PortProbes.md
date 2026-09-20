# PortProbes

**Type:** Detail

[Architecture Notes] Port-liveness/port-availability logic is triplicated across bash (docker/entrypoint.sh, start-services.sh) and Node (scripts/start-services-robust.js, lib/service-starter.js) with no shared implementation or constants file; Two conceptually opposite probes ('is this port already occupied by a healthy service' vs 'has this port actually been released after a kill') are implemented with different tools (HTTP/TCP client probes vs a throwaway server bind) inside the same file, scripts/start-services-robust.js; Timeout/retry budgets for port readiness are hardcoded per call site rather than centralized, creating inconsistent tuning between the container entrypoint and the host-side service starter; Legacy (start-services.sh) and current (scripts/start-services-robust.js) startup paths coexist behind the ROBUST_MODE flag, each with its own independent port-check implementation (lsof-based vs net/http-based)

# PortProbes — Technical Insight Document

## What It Is

PortProbes is not a single implementation but a conceptual grouping of port-liveness and port-availability logic scattered across three execution contexts: `docker/entrypoint.sh` (bash), `scripts/start-services-robust.js` (current Node path), `start-services.sh` (legacy Node/bash path), and `lib/service-starter.js` (shared health-check primitives). Its defining characteristic is that it addresses two conceptually opposite questions with different tools: "is a service already up and healthy?" (answered by `isPortListening()` and `isTcpPortListening()` in lib/service-starter.js) versus "has the OS actually released this port after I killed something?" (answered by `waitForPortBindable()` in scripts/start-services-robust.js). A third, related concern — actively freeing a port before rebind — is handled by `killProcessOnPortAndWait()`, which combines an lsof-based `checkPortInUse()` check with an escalating kill signal sequence.

## Architecture and Design

The dominant pattern is polling/retry-with-backoff, applied independently in bash (`wait_for_service`) and JS (`waitForPortBindable`, `killProcessOnPortAndWait`), with no shared polling primitive despite conceptually identical loop-sleep-recheck structures. A second pattern, escalating-signal shutdown (SIGTERM then SIGKILL after half of `maxWaitMs` elapses), governs `killProcessOnPortAndWait()` and is mirrored informally at the container level in `docker/entrypoint.sh`'s lifecycle handling, again without shared code. A third pattern — strategy variation by transport — shows up as HTTP GET probes, raw TCP socket probes, and OS-level `lsof` queries all answering the same "is it up" question depending on which file and language is doing the asking. Finally, a fail-open degradation pattern appears explicitly in `wait_for_service()`, which logs a warning and returns 0 after `max_attempts`, deferring to supervisord — a philosophy shared with the codebase's feature-gating fallback (unreadable features.json "starts everything") but explicitly asymmetric with the Node-side `startServiceWithRetry()` in the parent ServiceStarter, where a `required: true` service's exhausted retries actually blocks startup (validated by tests/features/service-gating.test.mjs).

## Implementation Details

`isPortListening()` and `isTcpPortListening()`, consumed by scripts/start-services-robust.js, detect an already-initialized service via HTTP and raw-socket checks respectively. `waitForPortBindable()`, a sibling to `WithDeadline` and `StartServiceWithRetry` under the ServiceStarter hierarchy, takes the opposite approach: it spins up a throwaway `net.createServer()`, calls `.unref()` to avoid blocking the event loop, and resolves true/false based on `listening`/`error` events. This is a narrow, single-purpose workaround for a kernel-timing race (stale TIME_WAIT/lingering sockets after a crash), explicitly not intended as a general port-status query. `killProcessOnPortAndWait()` layers `checkPortInUse()` (via `lsof -ti:${port}`) atop the SIGTERM→SIGKILL escalation, polling at `pollIntervalMs` until the port frees or `maxWaitMs` expires. The bash equivalent, `wait_for_service()`, uses a pure-bash `/dev/tcp/$host/$port` redirect wrapped in `timeout 2`, looping up to 30 attempts (~60s budget). The legacy path, `start-services.sh`'s `check_port()`/`kill_port()`, shells out to `lsof -i :$port` directly, active only under `ROBUST_MODE=false`.

## Integration Points

PortProbes logic sits beneath the parent ServiceStarter abstraction: `startServiceWithRetry()` in lib/service-starter.js is deliberately agnostic to whether the underlying process is a Docker container or Node child process, accepting `startFn` and `healthCheckFn` as parameters. This means the probing strategy (HTTP, TCP, lsof, or bind-based) is injected rather than hardcoded into the retry loop itself, though the retry loop's sibling `WaitForPortBindable` and `WithDeadline` still hardcode their own timeout constants independently of `startServiceWithRetry()`'s `exponentialBackoff` options. The container-level integration point is `docker/entrypoint.sh`, which gates readiness for Qdrant/Redis before supervisord proceeds. The legacy integration point is `start-services.sh`, coexisting behind the `ROBUST_MODE` flag with its own independent lsof-based implementation.

## Usage Guidelines

Developers modifying port-probing behavior must currently update three places by hand: docker/entrypoint.sh, scripts/start-services-robust.js, and start-services.sh — there is no shared constants file or single source of truth for timeout/retry budgets. Timeout values vary by an order of magnitude with no documented rationale (bash: `timeout 2` × 30 attempts ≈ 60s; `waitForPortBindable`: `maxWaitMs=5000`/`pollIntervalMs=250`; `killProcessOnPortAndWait`: `maxWaitMs=5000`/`pollIntervalMs=200`), so any global tuning of startup patience requires cross-language edits. When adding a new readiness check, be explicit about which of the two opposite semantics is intended — "already up" versus "port released" — since scripts/start-services-robust.js implements both using different tools in the same file. Required services should route through `startServiceWithRetry()`'s fail-closed behavior (per tests/features/service-gating.test.mjs); container-level checks via `wait_for_service()` currently fail open regardless of criticality, an inconsistency worth resolving before treating the two layers as interchangeable.


## Hierarchy Context

### Parent
- [ServiceStarter](./ServiceStarter.md) -- startServiceWithRetry() in lib/service-starter.js accepts a startFn and healthCheckFn as parameters, making it agnostic to whether the underlying process is a Docker container or a Node child process

### Siblings
- [WithDeadline](./WithDeadline.md) -- [CGR] withDeadline (function) in service-starter.js
- [StartServiceWithRetry](./StartServiceWithRetry.md) -- [CGR] startServiceWithRetry (function) in service-starter.js
- [WaitForPortBindable](./WaitForPortBindable.md) -- [CGR] waitForPortBindable (function) in start-services-robust.js


---

*Generated from 9 observations*
