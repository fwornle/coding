# PortReleaseWaiter

**Type:** Detail

[Code References] scripts/start-services-robust.js - killProcessOnPortAndWait() — SIGTERM-then-SIGKILL escalation with active port polling; scripts/start-services-robust.js - checkPortInUse() (inline helper) — lsof -ti:<port> check with fail-open on error; scripts/start-services-robust.js - waitForPortBindable() — throwaway net.createServer() probe to distinguish bindable vs merely-not-HTTP-responding; scripts/start-services-robust.js - isProcessRunningByScript() — pgrep-based orphan detection used alongside PSM lookups; start-services.sh - kill_port() — legacy single kill -9 + fixed sleep 1, no verification of release; tests/features/service-gating.test.mjs - startOneService()/SERVICE_CONFIGS usage — consumer of port-clearing results during service startup

# PortReleaseWaiter — Technical Insight Document

## What It Is

PortReleaseWaiter is implemented in `scripts/start-services-robust.js` as a pair of complementary functions — `killProcessOnPortAndWait()` and `waitForPortBindable()` — that together solve the problem of confirming a port is truly free before a service startup attempt. It is a sub-concern of the broader ServiceStarter component, specifically the port-lifecycle-management piece invoked during the service (re)start sequence. Rather than being a single monolithic "make this port free" routine, it is deliberately decomposed into two orthogonal concerns: PID-based termination of a known offending process, and kernel-socket-state confirmation when no owning process can be identified.

## Architecture and Design

The core architectural insight is that `lsof`-based process discovery and actual kernel bind-ability are not equivalent signals. `killProcessOnPortAndWait()` handles the "killer-known" case — it can see PIDs holding the port via `lsof -ti:<port>` — while `waitForPortBindable()` handles the "killer-unknown" case, where a crashed predecessor leaves the socket in a TIME_WAIT-like state with no owning PID, yet a real bind still fails with EADDRINUSE. This split is not redundancy but coverage of two distinct failure modes.

Both functions embody a "poll rather than sleep-and-hope" philosophy, explicitly contrasted with the legacy `start-services.sh`'s `kill_port()`, which does a single `kill -9` followed by an unconditional `sleep 1` with no verification. The robust JS path treats port release as an observable event; the legacy path treats it as a duration to guess. Notably, the legacy script is kept as a deliberate fallback rather than deleted, reflecting a conservative migration strategy.

Failure handling follows the fail-open bias documented at the ServiceStarter parent level (feature-gating defaults to "everything enabled"). Here it manifests as boolean returns plus console warnings instead of thrown exceptions, deferring the fatal/non-fatal decision to the calling orchestration layer (`startOneService()`, exercised in `tests/features/service-gating.test.mjs`), mirroring the parent's stance that incomplete information should produce diagnosable behavior rather than a hard crash.

## Implementation Details

`killProcessOnPortAndWait()` implements an escalating graceful-then-forceful kill: SIGTERM is sent to every PID on the port, then an inline helper `checkPortInUse()` polls every `pollIntervalMs` (default 200ms). Only after more than half of `maxWaitMs` (default 5000ms) has elapsed with the port still occupied does the function escalate to SIGKILL. This gives well-behaved processes a window to exit cleanly while guaranteeing bounded total wait time. `checkPortInUse()` swallows all `lsof` execution errors and fails open, returning `false` ("port is free") on any shell-out failure — consistent with the project's broader permissiveness-over-blocking pattern.

`waitForPortBindable()` takes a different approach: rather than trusting `isPortListening()` (HTTP-level check) or `lsof` output, it probes with a throwaway `net.createServer()` bound to `0.0.0.0`. The inline comment documents the rationale directly — a crashed predecessor can hold the kernel socket even though nothing responds to HTTP, and a real startup attempt in that window would burn a `maxRetries` slot on an immediate EADDRINUSE crash. The probe server calls `.unref()` so it never keeps the Node.js event loop alive if the parent process needs to exit early — a small but deliberate detail.

A sibling helper, `isProcessRunningByScript()`, uses `pgrep` for orphan detection alongside PSM lookups. Across the whole file, every shell-out (`lsof` at 3000ms, `pgrep` at 5000ms) is wrapped in `execAsync` with an explicit per-call timeout, ensuring a hung external command cannot silently stall the polling loop past its own `maxWaitMs` budget.

## Integration Points

PortReleaseWaiter's functions are consumed by `startOneService()` within the ServiceStarter orchestration, referenced in `tests/features/service-gating.test.mjs` via `SERVICE_CONFIGS[...].startFn`. It coexists with sibling concerns `HostServiceFeatureGate` and `StartServiceWithRetry` under ServiceStarter — the former gating whether a service starts at all (via `docker/entrypoint.sh` and supervisord's `disabled.conf`), the latter (`startServiceWithRetry` in `service-starter.js`) governing retry behavior around startup attempts that PortReleaseWaiter's bindability checks are designed to protect (avoiding wasted `maxRetries`). The legacy `start-services.sh`'s `kill_port()` remains as an alternate, less rigorous implementation of the same conceptual step.

## Usage Guidelines

Callers should treat a `false` return from `killProcessOnPortAndWait()` as a warning signal requiring explicit handling, not an exception path — the function will not throw even if the port remains stuck after `maxWaitMs`. Developers should prefer `waitForPortBindable()`'s real bind probe over HTTP-based or `lsof`-based checks when the goal is to avoid burning retry budget on a startup attempt, since it directly tests the actual failure condition (EADDRINUSE) rather than an indirect proxy. Any new shell-out added to this file should follow the existing convention of an explicit `execAsync` timeout to preserve the bounded-wait guarantee of the overall polling loop.


## Hierarchy Context

### Parent
- [ServiceStarter](./ServiceStarter.md) -- [LLM] The component enforces feature-gating at two independent layers that must stay in sync: the container-side layer in docker/entrypoint.sh reads a flat host-written snapshot (/coding/.coding/runtime/features.json) and rewrites it into a supervisord include (/etc/supervisor/features.d/disabled.conf) that flips `autostart=false` for programs whose feature is off, while the host-side layer in scripts/start-services-robust.js consults `loadFeatures()` per-service via `startOneService()` before invoking each service's `startFn`. Both layers deliberately fail toward 'everything enabled' — entrypoint.sh explicitly comments that a missing/unreadable snapshot leaves the features directory empty ('starts everything — the historical behaviour'), and an unrecognized feature name in the snapshot is treated as enabled by the inline `node -e` script (`value === false ? "false" : "true"`) rather than defaulting to disabled. This is a considered fail-open design: an incomplete config produces a container that does too much rather than one that silently does nothing, which the comments call easier to diagnose.

### Siblings
- [HostServiceFeatureGate](./HostServiceFeatureGate.md) -- [LLM] docker/entrypoint.sh implements the feature gate as a supervisord *override* rather than a rewrite of supervisord.conf itself: it always does `rm -f "$FEATURES_DIR"/*.conf` before regenerating `disabled.conf`, so the include directory is reset on every container start and there is no possibility of a stale disabled-program entry surviving a feature flip from off to on. The gate is expressed purely as `autostart=false` stanzas layered on top of program definitions that still live in one place (supervisord.conf), which keeps the source of truth for 'how a program starts' separate from 'whether it starts' — a separation of concerns that lets `PROGRAM_FEATURES` stay a short, flat list rather than a duplicated copy of each program block.
- [StartServiceWithRetry](./StartServiceWithRetry.md) -- [CGR] startServiceWithRetry (function) in service-starter.js


---

*Generated from 10 observations*
