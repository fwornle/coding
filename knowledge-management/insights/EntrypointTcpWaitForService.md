# EntrypointTcpWaitForService

**Type:** Detail

[Architecture Notes] Temporal/informational decoupling: the TCP-wait step executes before, and has no data channel into, the later feature-gating block in the same file, so it probes databases without knowing which features actually need them; No persistence of probe outcome — unlike the feature-gating mechanism in the same script, which writes its decision to a supervisord include file, wait_for_service()'s result is stdout-only and lost once the function returns; Three independent, non-shared health/readiness implementations coexist in this codebase for overlapping concerns (entrypoint.sh's /dev/tcp check, start-services.sh's lsof/docker-compose polling, service-probe.js's structured three-state probe); Asymmetric fail-open design consistent with project-wide convention: this is a starting-pathway component (runs before `exec "$@"` launches supervisord) yet is deliberately fail-open rather than fail-closed, an explicit carve-out matching the same carve-out documented for the feature-gating block later in the file

# EntrypointTcpWaitForService — Technical Insight Document

## What It Is

`EntrypointTcpWaitForService` is the `wait_for_service()` bash function defined at `docker/entrypoint.sh:14-30`, invoked twice during container startup (`docker/entrypoint.sh:34-40`) to probe TCP reachability of Qdrant (port 6333) and Redis (port 6379) before supervisord launches its managed programs. It performs a bounded retry loop — default `max_attempts=30` with a fixed 2-second sleep between attempts — using `timeout 2 bash -c "echo >/dev/tcp/$host/$port"` (line 19) as its sole reachability primitive. Host values are extracted from `QDRANT_URL`/`REDIS_URL` via naive `sed` substitutions rather than a proper URL parser.

As the `ServiceProbe` parent context frames it, this component is one of at least two (in practice three, alongside `start-services.sh`) independent health-probing implementations in the codebase, distinguished by running at container-entrypoint time against fixed infrastructure dependencies rather than as an ongoing post-startup <COMPANY_NAME_REDACTED>.

## Architecture and Design

The dominant pattern is a **polling/retry loop with bounded attempts and fixed backoff**, contrasted explicitly with the exponential backoff used in `start-services.sh`'s Docker health-check loop (`docker-compose ps | grep 'Up.*healthy'`). Layered on top of this loop is a **fail-open orchestration gate**: regardless of whether the loop exhausts `max_attempts`, the function unconditionally `return 0`s (lines 27-28), with the explicit comment "Don't fail - let supervisord handle it." This means the probe can never block the subsequent `exec "$@"` that launches supervisord — an unreachable Qdrant/Redis produces only a WARNING log line, never a halted boot.

This fail-open design is architecturally consistent with — and explicitly mirrors — the feature-gating (`FEATURES_SNAPSHOT`/`PROGRAM_FEATURES`) block later in the same file, which sibling `ServiceStarterHealthPrimitives` also references as sharing this "advisory, not gating" philosophy. However, the two mechanisms diverge sharply in persistence: the feature-gating block writes its decision to `/etc/supervisor/features.d/disabled.conf`, a supervisord include file that downstream tooling can inspect, whereas `wait_for_service()`'s outcome is a function-local bash return code that is never written to disk, exported, or otherwise surfaced — its only externally observable trace is stdout ("Waiting for $name...", "$name is ready!", "WARNING..."). This is a deliberate (if implicit) architectural asymmetry: one gate persists state for later consumers, the other evaporates the instant the function returns.

## Implementation Details

The core mechanics are simple and self-contained: a `while` loop bounded by `max_attempts`, each iteration attempting `timeout 2 bash -c "echo >/dev/tcp/$host/$port"` and sleeping 2 seconds on failure. Host extraction uses two near-duplicate one-off `sed` pipelines — `s|http://||; s|:.*||` for Qdrant, `s|redis://||` for Redis — rather than a shared parsing helper. This is fragile by construction: an `https://` URL, a URL with embedded credentials, or an IPv6 literal (which itself contains colons) would silently produce a wrong or empty host string fed directly into `/dev/tcp/$host/$port`.

Critically, the temporal placement of this component matters as much as its internals. It executes at `docker/entrypoint.sh` lines ~35-46, strictly *before* the `FEATURES_SNAPSHOT`/`PROGRAM_FEATURES` block parses `features.json`. This means the probe has zero visibility into which supervisord programs (`semantic-analysis`, `embedding-listener`, etc.) will actually be enabled. If the `knowledge` feature (and all Qdrant/Redis-dependent programs) is disabled, `wait_for_service()` still unconditionally burns up to 60 seconds (30 × 2s per service) polling databases that no enabled program will ever touch.

The function also implements no process-identity awareness: it cannot distinguish "Qdrant is up" from "something else is listening on 6333" from "a stale socket is being held by a dying process." It collapses transient/unknown and definitively-down states into a single WARNING + `return 0`, with no three-state model at all.

## Integration Points

`wait_for_service()` is the entrypoint-time counterpart to two other implementations of the same conceptual check identified under parent `ServiceProbe`: `probeTcpPort()` in `service-probe.js` (post-startup polling with SPEC R6's strict three-state running/stopped/unknown model) and `check_port()`/`docker-compose ps | grep 'Up.*healthy'` in `start-services.sh` (explicit DEGRADED/FULLY OPERATIONAL semantics). None of these three share code — a change to what "ready" means for Qdrant in one location does not propagate to the others.

It is also distinct from sibling `WaitForPortBindable` (`waitForPortBindable()` in `start-services-robust.js`), which detects lingering kernel socket holds after a crash, and from that file's `isProcessRunningByScript()`/`killProcessOnPortAndWait()` pair — both of which carry process-identity awareness this bash function entirely lacks. Sibling `ServiceStarterHealthPrimitives` further highlights the asymmetry with `start-services-robust.js`'s `SERVICE_CONFIGS` entries (e.g., `transcriptMonitor` with `required: true`), which *can* set `blocked=true` and halt host-side startup — the same readiness question is answered with opposite failure semantics depending on whether the container or host startup path is asking.

## Usage Guidelines

Developers should treat `wait_for_service()` strictly as a diagnostic/logging aid, not a dependency gate — its `return 0` guarantee means it will never prevent supervisord from starting even when Qdrant or Redis is completely unreachable. Anyone relying on "the entrypoint waited for the database" as a correctness invariant is mistaken; actual readiness enforcement, if needed, must happen downstream (e.g., within the supervisord-managed programs themselves or via `service-probe.js`'s stricter model).

When modifying URL formats for `QDRANT_URL`/`REDIS_URL`, be aware the `sed`-based parsing is brittle against `https://`, embedded credentials, or IPv6 hosts — any such change should be paired with a review of the extraction logic at `docker/entrypoint.sh:34-40`. More broadly, given three independent, non-shared health-check implementations exist across `entrypoint.sh`, `start-services.sh`, and `service-probe.js`, any change to "what does ready mean" for Qdrant/Redis should be cross-checked against all three rather than assumed to propagate. Finally, if feature-gating semantics change, consider whether the TCP-wait step's unconditional execution (regardless of `PROGRAM_FEATURES`) still makes sense, since it currently wastes up to 60 seconds probing dependencies that may not be needed by any enabled program.


## Hierarchy Context

### Parent
- [ServiceProbe](./ServiceProbe.md) -- [LLM] service-probe.js is architected as a pure protocol-level health <COMPANY_NAME_REDACTED> that is deliberately blind to process ownership, deployment topology, and service identity beyond a URL or port. Per the parent context, probeHttpHealth() and probeTcpPort() implement SPEC R6's strict three-state model (running/stopped/unknown), and this component's inclusion in DockerizedServices is evidence that the same probing logic is reused for supervisord-managed containerized processes (docker/entrypoint.sh, Dockerfile.coding-services) and host-native subprocesses (scripts/start-services-robust.js via lib/service-starter.js). The trade-off documented in the parent observations is real and visible in the code here: docker/entrypoint.sh's wait_for_service() function implements its own ad-hoc TCP probing (bash /dev/tcp check) rather than delegating to service-probe.js, meaning there are at least two independent health-probing implementations in this codebase — one for container-internal database readiness (Qdrant/Redis) at entrypoint time, and one (service-probe.js) for post-startup ongoing health polling.

### Siblings
- [ServiceStarterHealthPrimitives](./ServiceStarterHealthPrimitives.md) -- [LLM] docker/entrypoint.sh's wait_for_service() function (lines defining the retry loop with `timeout 2 bash -c "echo >/dev/tcp/$host/$port"`) always returns 0 even after exhausting max_attempts — the comment 'Don't fail - let supervisord handle it' means this health primitive is deliberately advisory, not gating. This is architecturally distinct from service-probe.js's strict three-state model referenced in the parent context: entrypoint.sh's probe can never produce a 'stopped' or 'unknown' verdict that blocks the container boot sequence, only a log message, whereas SERVICE_CONFIGS entries in start-services-robust.js (e.g. transcriptMonitor with required: true) can set blocked=true via startOneService() and halt downstream host-side startup entirely. The same conceptual question ('is this dependency ready?') is answered with opposite failure semantics depending on which of the two startup paths (container vs host) is asking.
- [WaitForPortBindable](./WaitForPortBindable.md) -- [CGR] waitForPortBindable (function) in start-services-robust.js


---

*Generated from 9 observations*
