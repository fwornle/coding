# HostServiceFeatureGate

**Type:** Detail

# HostServiceFeatureGate — Technical Insight Document

## What It Is

HostServiceFeatureGate is the host-side half of a two-layer feature-gating mechanism whose container-side counterpart lives in `docker/entrypoint.sh`. As a child of **ServiceStarter**, it is realized concretely in `scripts/start-services-robust.js`, where `loadFeatures()` is consulted per-service via `startOneService()` before a service's `startFn` is invoked. Where the container-side layer expresses "on/off" as supervisord `autostart=false` override stanzas layered atop an immutable `supervisord.conf`, the host-side gate makes the same enable/disable decision directly in JavaScript, guarding calls into functions like `SERVICE_CONFIGS.transcriptMonitor.startFn`. Both layers are independently implemented (bash+inline node vs. pure Node.js) but must stay logically consistent with the shared source of truth, `lib/features/catalogue.cjs`.

## Architecture and Design

The defining architectural decision inherited from the parent **ServiceStarter** is fail-open semantics: an incomplete or unrecognized feature configuration resolves toward "enabled" rather than "disabled." On the container side this is explicit in the inline `node -e` script's `value === false ? "false" : "true"` logic — only an explicit `false` disables a program, while `undefined`, `null`, typos, or malformed JSON all fail toward "true." This produces three independent fail-open layers (missing snapshot, JSON parse failure, unrecognized key), each catching a different failure mode with the same enabled-by-default outcome. HostServiceFeatureGate mirrors this same philosophy on the host side, per the Architectural Patterns catalogue: "two independently evolved layers... both default an unreadable/unrecognized config to 'enabled' rather than 'disabled.'" This is a considered trade-off: a misconfigured system does too much rather than silently doing nothing, which is judged easier to diagnose in practice.

A second key design separation is "how a program starts" vs. "whether it starts." Program definitions remain centralized (in `supervisord.conf` on the container side; in `SERVICE_CONFIGS` on the host side), while the feature gate is a thin, orthogonal layer on top, keeping `PROGRAM_FEATURES` a short flat list rather than a duplicated program registry.

## Implementation Details

On the host side, HostServiceFeatureGate's gating check happens before `startOneService()` dispatches to a service's `startFn`. This sits upstream of the more elaborate process-lifecycle machinery in `scripts/start-services-robust.js` — `killProcessOnPortAndWait()`, `waitForPortBindable()`, and the three-tier dedup check in `SERVICE_CONFIGS.transcriptMonitor.startFn` (global PSM → per-project PSM → `pgrep` via `isProcessRunningByScript()`) — none of which run at all if the feature gate has already decided a service is off. These lifecycle helpers are siblings to this gate conceptually: **PortReleaseWaiter** covers the killer-known vs. killer-unknown port-clearing cases, while HostServiceFeatureGate covers the earlier question of whether to attempt starting the service at all.

The container-side analog resets state on every boot: `docker/entrypoint.sh` always runs `rm -f "$FEATURES_DIR"/*.conf` before regenerating `disabled.conf`, guaranteeing no stale disabled-program entry survives a flag flip from off to on.

## Integration Points

HostServiceFeatureGate depends on `loadFeatures()` and, transitively, on `lib/features/catalogue.cjs` as the canonical feature-id source — the same dependency the container-side gate has via its snapshot file and the same dependency exercised by `tests/features/service-gating.test.mjs`'s `featureSet()` helper, which builds synthetic `loadFeatures()`-shaped fixtures from `FEATURE_IDS` rather than a hardcoded list. This coupling means new features are automatically exercised by existing tests, at the cost of the catalogue itself being a single point of failure for test correctness. The gate also interacts with `start-services.sh`'s `ROBUST_MODE` branch: since `ROBUST_MODE` defaults to `'true'` and `exec`s into `scripts/start-services-robust.js`, HostServiceFeatureGate is the effective, default-path gating mechanism, while the legacy bash fallback in `start-services.sh` has no corresponding feature-flag integration or test coverage.

## Usage Guidelines

Developers adding a new feature-gated service must update both the container-side snapshot logic and the host-side `loadFeatures()`/`SERVICE_CONFIGS` wiring, since these are independently implemented and not automatically synchronized beyond sharing `lib/features/catalogue.cjs`. Because the design is deliberately fail-open, any new gating logic should preserve the convention that ambiguous or missing configuration enables rather than disables a service — deviating from this (e.g., defaulting to disabled) would break the documented, diagnosable failure mode. Tests should be added or extended in `tests/features/service-gating.test.mjs`, notably the existing 'a disabled service is not reported as degraded' assertion, to ensure disabled services are distinguished from degraded ones rather than conflated. Finally, since `start-services.sh`'s legacy path is unreachable dead code under default configuration and untested, any gating-related fix made only in `scripts/start-services-robust.js` should be assumed not to apply to the legacy path.


## Hierarchy Context

### Parent
- [ServiceStarter](./ServiceStarter.md) -- [LLM] The component enforces feature-gating at two independent layers that must stay in sync: the container-side layer in docker/entrypoint.sh reads a flat host-written snapshot (/coding/.coding/runtime/features.json) and rewrites it into a supervisord include (/etc/supervisor/features.d/disabled.conf) that flips `autostart=false` for programs whose feature is off, while the host-side layer in scripts/start-services-robust.js consults `loadFeatures()` per-service via `startOneService()` before invoking each service's `startFn`. Both layers deliberately fail toward 'everything enabled' — entrypoint.sh explicitly comments that a missing/unreadable snapshot leaves the features directory empty ('starts everything — the historical behaviour'), and an unrecognized feature name in the snapshot is treated as enabled by the inline `node -e` script (`value === false ? "false" : "true"`) rather than defaulting to disabled. This is a considered fail-open design: an incomplete config produces a container that does too much rather than one that silently does nothing, which the comments call easier to diagnose.

### Siblings
- [StartServiceWithRetry](./StartServiceWithRetry.md) -- [CGR] startServiceWithRetry (function) in service-starter.js
- [PortReleaseWaiter](./PortReleaseWaiter.md) -- [LLM] The PortReleaseWaiter's core logic is split across two functions in scripts/start-services-robust.js that solve related but distinct problems: `killProcessOnPortAndWait()` actively terminates a lingering process and confirms the port is free via `lsof -ti:<port>` polling, while `waitForPortBindable()` handles the case where no process is identifiable but the kernel still holds the socket in a TIME_WAIT-like state after a crash. This split exists because `lsof` can report a port as free (no owning PID) while a bind attempt still fails with EADDRINUSE during a brief kernel transition window — the two functions are not redundant, they cover a killer-known case and a killer-unknown case respectively.


---

*Generated from 10 observations*
