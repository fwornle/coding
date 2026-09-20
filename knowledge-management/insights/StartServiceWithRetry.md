# StartServiceWithRetry

**Type:** Detail

# StartServiceWithRetry — Technical Insight Document

## What It Is

`startServiceWithRetry` is implemented in `lib/service-starter.js` as the single generic retry/backoff primitive within the `ServiceStarter` component. Per the code graph, it depends on exactly three primitives: `isProcessRunning` (liveness polling), `sleep` (backoff pacing), and `withDeadline` (bounding the duration of any single attempt). It is deliberately generic — it knows nothing about *which* service it is starting, only how to retry a given attempt until it succeeds, fails definitively, or exceeds a deadline.

This primitive is consumed, not extended, by `scripts/start-services-robust.js`, which supplies service-specific `startFn`/`healthCheckFn` pairs from `SERVICE_CONFIGS` for each managed service. The separation is intentional: retry/backoff logic lives in exactly one place, and per-service behavior is injected as data/functions rather than duplicated per service.

## Architecture and Design

The dominant pattern is **retry-with-backoff composed from small primitives** — `startServiceWithRetry` orchestrates `isProcessRunning`, `sleep`, and `withDeadline` rather than reimplementing polling or timeout logic inline. This keeps the retry engine agnostic to *why* an attempt might fail.

Layered around this generic core, `startOneService()` in `start-services-robust.js` implements a **gate-before-invoke pattern**: `loadFeatures()` is checked per `SERVICE_CONFIGS` entry, and a disabled feature short-circuits before `startFn` — and therefore before `startServiceWithRetry` — is ever reached, recording the outcome in `results.disabled`. The retry engine's dependency chain (`startServiceWithRetry → isProcessRunning/sleep/withDeadline`) is thus only reachable for enabled features; gating is a filter sitting structurally *outside* the retry machinery, confirmed by `tests/features/service-gating.test.mjs`.

This mirrors — but does not share code with — the parent `ServiceStarter`'s container-side gate in `docker/entrypoint.sh`, and is a documented sibling relationship: `HostServiceFeatureGate` (entrypoint.sh's supervisord-override mechanism) and the host-side `loadFeatures()` gate solve the same problem independently. Host-side gating diverges from container-side gating in an important way: `startOneService` treats an unknown feature name as a thrown, loud failure (protecting against internal config typos), while `entrypoint.sh` treats an unknown feature as enabled (forgiving external snapshot version-skew). This is a deliberate **fail-open vs. fail-closed split by concern**, not an inconsistency.

Sibling component `PortReleaseWaiter` (`killProcessOnPortAndWait` and `waitForPortBindable`) sits alongside but outside the retry primitive's visibility — neither function appears in the code graph's dependency list for `startServiceWithRetry`. These are pre-flight helpers that reduce the *odds* of an EADDRINUSE-driven attempt failure, rather than parameters the retry engine itself understands.

## Implementation Details

Internally, `startServiceWithRetry` polls with `isProcessRunning` after each `startFn` invocation, paces retries with `sleep`, and bounds each attempt with `withDeadline`. This is a per-attempt liveness check only — it does not know anything about a service's identity beyond "is this PID alive."

This is structurally distinct from `isProcessRunningByScript()`, a robust.js-local OS-level `pgrep` sweep used for cross-restart orphan detection on specific services (e.g., `transcriptMonitor`, `liveLoggingCoordinator`). `SERVICE_CONFIGS.transcriptMonitor.startFn` compounds this further with a three-tier dedup check — global PSM lookup, per-project PSM lookup, then `isProcessRunningByScript` pgrep fallback — executed once before spawning, decoupled from and predating the retry wrapper. A future maintainer must not assume the graph's `isProcessRunning` already covers this dedup logic: one checks a generic PID's liveness, the other checks whether *this specific service* is already running anywhere in the fleet.

`killProcessOnPortAndWait()` and `waitForPortBindable()` are two independently-invented, uncomposed defenses against the same lingering-socket race: the former actively escalates SIGTERM→poll→SIGKILL and confirms via `lsof -ti:<port>`; the latter passively probes bindability via a throwaway `net.createServer()`. They cover a killer-known case and a killer-unknown case respectively (per the `PortReleaseWaiter` sibling notes).

## Integration Points

`startServiceWithRetry` integrates with `start-services-robust.js` purely through function injection (`startFn`/`healthCheckFn` per `SERVICE_CONFIGS` entry) — it has no direct dependency on feature gating, port cleanup, or dedup logic. All of those concerns are layered *around* it by the caller.

`start-services.sh` acts as a thin dispatcher: under default `ROBUST_MODE=true`, it execs into `scripts/start-services-robust.js`, making this the default path through which `startServiceWithRetry` is reached. The legacy bash fallback (retained per a deliberate, commented exception to the "no parallel versions" rule) implements its own divergent port-cleanup (`kill_port()`, `kill -9`, fixed 1-second sleep) and never reuses `waitForPortBindable()`/`killProcessOnPortAndWait()` — the exact fixed-sleep race those functions were built to eliminate on the modern path.

## Usage Guidelines

Do not conflate `isProcessRunning` (the generic per-attempt primitive the retry engine polls) with `isProcessRunningByScript` (robust.js's orphan detector) or the PSM-based dedup in `transcriptMonitor.startFn` — they operate at different layers and serve different questions. When adding new services, follow the existing convention: define `startFn`/`healthCheckFn` in `SERVICE_CONFIGS` and let `startServiceWithRetry` handle backoff, rather than embedding retry logic per service. Feature-gating decisions belong ahead of the retry call, not inside it. Be aware of the fail-open/fail-closed asymmetry across `entrypoint.sh` and `start-services-robust.js` — an unknown feature name should be treated as a loud failure only in host-owned configs, not blindly applied elsewhere. Finally, avoid extending the legacy bash path in `start-services.sh`; it is dead code under default configuration and does not benefit from the modern port-release safeguards.


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
- The call graph shows startServiceWithRetry (lib/service-starter.js) depending on exactly three primitives — isProcessRunning, sleep, and withDeadline — which maps directly onto the retry-with-backoff contract exercised by scripts/start-services-robust.js: each SERVICE_CONFIGS entry supplies a startFn/healthCheckFn pair and startServiceWithRetry drives the retry loop around them using isProcessRunning for liveness polling, sleep for backoff pacing, and withDeadline to bound any single attempt. Because start-services-robust.js also defines its own isProcessRunningByScript() (an OS-level pgrep sweep) as a distinct, non-imported function, there are structurally two different 'is it running' checks in the same startup path — the graph's isProcessRunning is the generic primitive service-starter.js uses internally per-attempt, while isProcessRunningByScript is a robust.js-local orphan-detector layered on top for specific services like transcriptMonitor and liveLoggingCoordinator. Conflating these two in future edits would be easy to get wrong since they look similar but serve different layers (per-attempt liveness vs. cross-restart orphan reconciliation).


## Hierarchy Context

### Parent
- [ServiceStarter](./ServiceStarter.md) -- [LLM] The component enforces feature-gating at two independent layers that must stay in sync: the container-side layer in docker/entrypoint.sh reads a flat host-written snapshot (/coding/.coding/runtime/features.json) and rewrites it into a supervisord include (/etc/supervisor/features.d/disabled.conf) that flips `autostart=false` for programs whose feature is off, while the host-side layer in scripts/start-services-robust.js consults `loadFeatures()` per-service via `startOneService()` before invoking each service's `startFn`. Both layers deliberately fail toward 'everything enabled' — entrypoint.sh explicitly comments that a missing/unreadable snapshot leaves the features directory empty ('starts everything — the historical behaviour'), and an unrecognized feature name in the snapshot is treated as enabled by the inline `node -e` script (`value === false ? "false" : "true"`) rather than defaulting to disabled. This is a considered fail-open design: an incomplete config produces a container that does too much rather than one that silently does nothing, which the comments call easier to diagnose.

### Siblings
- [HostServiceFeatureGate](./HostServiceFeatureGate.md) -- [LLM] docker/entrypoint.sh implements the feature gate as a supervisord *override* rather than a rewrite of supervisord.conf itself: it always does `rm -f "$FEATURES_DIR"/*.conf` before regenerating `disabled.conf`, so the include directory is reset on every container start and there is no possibility of a stale disabled-program entry surviving a feature flip from off to on. The gate is expressed purely as `autostart=false` stanzas layered on top of program definitions that still live in one place (supervisord.conf), which keeps the source of truth for 'how a program starts' separate from 'whether it starts' — a separation of concerns that lets `PROGRAM_FEATURES` stay a short, flat list rather than a duplicated copy of each program block.
- [PortReleaseWaiter](./PortReleaseWaiter.md) -- [LLM] The PortReleaseWaiter's core logic is split across two functions in scripts/start-services-robust.js that solve related but distinct problems: `killProcessOnPortAndWait()` actively terminates a lingering process and confirms the port is free via `lsof -ti:<port>` polling, while `waitForPortBindable()` handles the case where no process is identifiable but the kernel still holds the socket in a TIME_WAIT-like state after a crash. This split exists because `lsof` can report a port as free (no owning PID) while a bind attempt still fails with EADDRINUSE during a brief kernel transition window — the two functions are not redundant, they cover a killer-known case and a killer-unknown case respectively.


---

*Generated from 14 observations*
