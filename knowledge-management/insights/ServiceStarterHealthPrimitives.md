# ServiceStarterHealthPrimitives

**Type:** Detail

[Architecture Notes] Tight coupling between health semantics and the specific shell tool invoked (pgrep, lsof, /dev/tcp, docker-compose ps) rather than a shared cross-platform abstraction; start-services-robust.js's ordering dependency (transcriptMonitor, liveLoggingCoordinator must be first two in SERVICE_ORDER) is enforced only by a dedicated test, not by an explicit dependency graph in the code; Legacy start-services.sh is dead-code-in-waiting behind ROBUST_MODE flag rather than deleted, creating latent drift risk if robust mode is ever disabled; docker/entrypoint.sh's feature gate deliberately fails open (missing/unreadable features.json => start everything) while start-services-robust.js's required-service gate fails closed (a required startFn failure sets blocked=true) — same 'feature gating' concept, opposite default-safety direction depending on host vs container context; No shared module between docker/entrypoint.sh, scripts/start-services-robust.js, and start-services.sh for TCP/port/process readiness checks — each maintains its own bash or Node implementation

# ServiceStarterHealthPrimitives — Technical Insight Document

## What It Is

ServiceStarterHealthPrimitives refers to the collection of bespoke, low-level readiness/liveness checks implemented directly in `scripts/start-services-robust.js`: `isProcessRunningByScript()`, `killProcessOnPortAndWait()`, and `waitForPortBindable()`. These functions are the host-side counterpart to its parent, ServiceProbe (`service-probe.js`), which implements SPEC R6's strict three-state health model (running/stopped/unknown) for both DockerizedServices and host-native subprocesses. Unlike ServiceProbe's protocol-level, identity-agnostic checks, ServiceStarterHealthPrimitives is deeply concerned with process ownership and OS-level resource state — actual PIDs, actual listening sockets, actual kill signals — making it the "ground truth" layer that decides whether a service is truly stopped or truly free before start-services-robust.js proceeds.

## Architecture and Design

The defining architectural pattern here is **three independent primitives solving three different flavors of "is this actually stopped/free"** rather than delegating to one shared abstraction. `isProcessRunningByScript()` shells out to `pgrep -lf` and manually parses output to catch orphaned processes that ProcessStateManager doesn't track. `killProcessOnPortAndWait()` polls `lsof -ti:PORT` in a loop, escalating from SIGTERM to SIGKILL at the 50%-of-maxWaitMs mark — an escalating retry/kill pattern documented explicitly in the Architectural Patterns notes. `waitForPortBindable()` uses a throwaway-resource probing technique, opening a disposable `net.createServer()` to bind-test the real port, specifically to catch a documented blind spot: the kernel may hold a socket open in a state invisible to HTTP-based checks like `isPortListening` (imported from `lib/service-starter.js`) for a short window after a crash.

This sits below the two-layer gating architecture also seen in its sibling EntrypointTcpWaitForService and in the parent ServiceProbe's containment hierarchy: a feature-enablement gate (SERVICE_CONFIGS.feature) strictly precedes any of these primitives running at all — `startOneService()` never invokes `isProcessRunningByScript()`, `killProcessOnPortAndWait()`, or `waitForPortBindable()` for a disabled feature. This mirrors docker/entrypoint.sh's PROGRAM_FEATURES gate sitting upstream of its own probing, confirming the same two-layer pattern is independently reimplemented on both container and host sides with zero shared code.

## Implementation Details

`isProcessRunningByScript()` manually parses `pid command` lines from `pgrep -lf` output — a fragile, string-parsing approach chosen specifically to catch orphans that a more structured tracker (ProcessStateManager) misses. `killProcessOnPortAndWait()` combines polling (`lsof -ti:PORT`) with a hardcoded time-based escalation policy baked directly into the function rather than parameterized as a reusable strategy. `waitForPortBindable()`'s docstring is notably self-aware, explicitly documenting the tradeoff between the fast, false-negative-prone `isPortListening` HTTP check used for steady-state health versus its own slower bind-attempt check reserved for post-crash restart races — a per-callsite choice rather than a single unified "is this port free" function.

All three primitives share only the imported `sleep()` helper from `lib/service-starter.js` — no common polling/backoff abstraction exists, meaning any future timeout policy change requires editing three call sites independently.

## Integration Points

These primitives are invoked from within `startOneService()`, gated by SERVICE_CONFIGS entries (e.g., `transcriptMonitor`, `liveLoggingCoordinator` marked `required: true`), and their failure can set `blocked=true`, halting downstream host-side startup — a fail-closed contract. This is architecturally opposite to the sibling EntrypointTcpWaitForService's `wait_for_service()`, which always returns 0 and can never block container boot ("Don't fail — let supervisord handle it"), demonstrating that the same conceptual question ("is this dependency ready?") receives opposite failure semantics depending on which startup path — container vs. host — is asking.

A legacy, weaker duplicate exists in `start-services.sh`'s `check_port()`/`kill_port()` (immediate SIGKILL, no grace period) and docker-compose health polling, active only when `ROBUST_MODE=false`, retained "for backward compatibility" — dead-code-in-waiting that risks semantic drift if ever reactivated.

## Usage Guidelines

Testing coverage is notably asymmetric: `tests/features/service-gating.test.mjs` validates only the structural/<COMPANY_NAME_REDACTED> layer (SERVICE_ORDER/SERVICE_CONFIGS consistency, ordering invariants like the live-logging pair starting first) via ES imports, and exercises failure paths through mocked `startFn` throws rather than real `pgrep`/`lsof` invocations. The actual shell-invoking logic in these primitives has no direct unit coverage. Developers modifying timeout, escalation, or polling behavior must edit all three functions individually, and should be aware that `check_port()`/`kill_port()` in `start-services.sh` still exist as a latent, weaker-semantics fallback that must not silently become active. Given the tight coupling to specific shell tools (`pgrep`, `lsof`, `/dev/tcp`, `docker-compose`), any cross-platform port abstraction would require touching entrypoint.sh, start-services-robust.js, and start-services.sh independently — no shared module currently exists.


## Hierarchy Context

### Parent
- [ServiceProbe](./ServiceProbe.md) -- [LLM] service-probe.js is architected as a pure protocol-level health <COMPANY_NAME_REDACTED> that is deliberately blind to process ownership, deployment topology, and service identity beyond a URL or port. Per the parent context, probeHttpHealth() and probeTcpPort() implement SPEC R6's strict three-state model (running/stopped/unknown), and this component's inclusion in DockerizedServices is evidence that the same probing logic is reused for supervisord-managed containerized processes (docker/entrypoint.sh, Dockerfile.coding-services) and host-native subprocesses (scripts/start-services-robust.js via lib/service-starter.js). The trade-off documented in the parent observations is real and visible in the code here: docker/entrypoint.sh's wait_for_service() function implements its own ad-hoc TCP probing (bash /dev/tcp check) rather than delegating to service-probe.js, meaning there are at least two independent health-probing implementations in this codebase — one for container-internal database readiness (Qdrant/Redis) at entrypoint time, and one (service-probe.js) for post-startup ongoing health polling.

### Siblings
- [EntrypointTcpWaitForService](./EntrypointTcpWaitForService.md) -- [LLM] docker/entrypoint.sh's wait_for_service() (docker/entrypoint.sh:14-30) is a self-contained bash function using `timeout 2 bash -c "echo >/dev/tcp/$host/$port"` in a bounded retry loop (default max_attempts=30, 2s sleep between attempts), invoked twice — once for Qdrant (port 6333, derived from QDRANT_URL via sed) and once for Redis (port 6379, derived from REDIS_URL). Critically, the function's final branch on exhausting all attempts still `return 0`, with the comment "Don't fail - let supervisord handle it" — meaning this probe can NEVER halt container startup, only log a WARNING. This is a deliberately weaker contract than a typical readiness gate: it never blocks `exec "$@"` from running supervisord, so a completely unreachable Qdrant/Redis produces a warning in container logs but full supervisord startup proceeds regardless.
- [WaitForPortBindable](./WaitForPortBindable.md) -- [CGR] waitForPortBindable (function) in start-services-robust.js


---

*Generated from 9 observations*
