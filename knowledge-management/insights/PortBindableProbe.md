# PortBindableProbe

**Type:** Detail

# PortBindableProbe: Technical Insight Document

## What It Is

`PortBindableProbe` is realized concretely as the `waitForPortBindable()` function in `scripts/start-services-robust.js`. It is a socket-level readiness probe whose sole purpose is to answer one narrow question: "can I bind this port right now?" It is deliberately more primitive than `isPortListening()` (imported from `lib/service-starter.js`), which answers a different question about application-level HTTP/TCP readiness. As a child concept of the broader `ServiceProbe` component, `PortBindableProbe` occupies the lowest rung of a layered readiness-checking strategy, dealing strictly with kernel/OS socket state rather than anything resembling application health.

## Architecture and Design

The function embodies several distinct, deliberately chosen patterns. First is the **throwaway-probe pattern**: it instantiates a disposable `net.createServer()` purely to interrogate system state, then discards it — never using the server for actual traffic. Second is **poll-until-deadline** logic: rather than a fixed retry count, `waitForPortBindable(port, { host = '0.0.0.0', maxWaitMs = 5000, pollIntervalMs = 250 })` compares `Date.now()` against a wall-clock deadline, meaning the real number of attempts flexes with system load. Third is **fail-toward-retry** error handling — any bind error, whether `EADDRINUSE`, `EACCES`, or otherwise, collapses to a uniform `false`, deferring all retry/backoff policy decisions to the caller.

Architecturally, this sits below the SPEC R6 conservative-probe pattern used in `lib/utils/service-probe.js`'s HTTP/TCP health checks, forming a **layered readiness-checking** design: socket-bind viability as a distinct concern from HTTP-level liveness. Notably, no call site in the provided code composes the two checks together — there's no visible chain of "check bindability, then check HTTP health" for the same service, suggesting `PortBindableProbe` is invoked selectively (e.g., around suspected-crash restarts) rather than universally across every `SERVICE_CONFIGS` `startFn`.

## Implementation Details

The core mechanics live inside a Promise executor that races two socket events. `probe.once('error', () => resolve(false))` and a `listening` handler convert Node's callback-style socket API into a simple boolean outcome. The `.unref()` call is applied immediately upon server creation — a defensive detail ensuring the diagnostic probe socket never keeps the Node event loop alive, so it can never itself become a reason the host process fails to exit cleanly. A synchronous `try { probe.listen(port, host); } catch { resolve(false); }` wrapper additionally guards against throws during the synchronous phase of `.listen()`, layering exception safety on top of the event-based error handling.

The default `host = '0.0.0.0'` is a deliberate design choice: binding on all interfaces is a stronger, more representative test than probing `127.0.0.1` alone, since a port free on loopback but occupied on a specific interface would otherwise produce a false result. This makes the probe's outcome directly predictive of how the real service (which likely binds similarly) will fare.

A subtle timing consequence follows from the poll-then-sleep structure: `await sleep(pollIntervalMs)` (also from `lib/service-starter.js`) executes between attempts, so worst-case wait is actually `maxWaitMs + pollIntervalMs`, not exactly `maxWaitMs` — an off-by-one-interval characteristic callers with hard deadlines should account for.

The function's own doc comment names its reason for existing explicitly: after a crashed process, the kernel can hold a socket such that `isPortListening()` correctly reports nothing is listening, yet `net.createServer().listen()` still throws `EADDRINUSE`. `PortBindableProbe` exists to close exactly this race.

## Integration Points

`PortBindableProbe` depends on `sleep()` and contrasts directly with `isPortListening()`, both imported from `lib/service-starter.js`. It is a sibling concern to `ServiceStarterRetryPolicy`'s `startServiceWithRetry()`, which governs `maxRetries`-based orchestration for `SERVICE_CONFIGS` entries like `transcriptMonitor` and `liveLoggingCoordinator` — a doomed spawn attempt avoided by `PortBindableProbe` directly preserves a scarce `maxRetries` slot. A companion function, `killProcessOnPortAndWait(port, options)`, applies the same poll-then-escalate philosophy to teardown rather than startup, indicating this probing philosophy is a house style rather than a one-off.

Within the parent `ServiceProbe` hierarchy, `PortBindableProbe` is conceptually distinct from siblings `FeatureGatingOverride` (which governs whether a service starts at all via `entrypoint.sh` and `features.json`) and `ServiceGatingTestSuite` (which structurally validates that `SERVICE_ORDER`/`SERVICE_CONFIGS` stay in sync). Where those siblings address *whether* and *whether correctly declared* a service starts, `PortBindableProbe` addresses a narrower operational question of *when it is safe* to attempt a bind during that start sequence.

## Usage Guidelines

Developers should treat `waitForPortBindable()` as a targeted diagnostic for crash-recovery scenarios, not a general-purpose substitute for `isPortListening()`. Because its error handling is intentionally coarse — never distinguishing `EADDRINUSE` from `EACCES` or `EADDRNOTAVAIL` — callers must not assume a `false` return implies transience; a permission-denied condition on a privileged port will poll uselessly until `maxWaitMs` before returning `false`, same as a genuinely transient conflict. Any caller depending on a hard timeout budget should account for the extra `pollIntervalMs` tail beyond `maxWaitMs`. Given the absence of a visible composed call site chaining this probe with HTTP health checks, engineers extending `SERVICE_CONFIGS` startup flows should explicitly decide whether a given service's restart path warrants this bindability check, rather than assuming it is already applied universally.


## Hierarchy Context

### Parent
- [ServiceProbe](./ServiceProbe.md) -- [LLM] docker/entrypoint.sh implements a fail-open feature-gating layer that sits strictly between the host's feature resolver and supervisord: it reads a flat JSON snapshot at /coding/.coding/runtime/features.json (written by the host, never by the container) and, for each entry in the PROGRAM_FEATURES mapping (e.g. 'semantic-analysis:knowledge', 'constraint-monitor:constraints', 'health-dashboard:health'), uses `node -e` (not jq, since jq isn't installed in the image) to decide whether to emit an `autostart=false` override into /etc/supervisor/features.d/disabled.conf. Critically, the script comments explain the asymmetric fail-open design: a missing or unparseable snapshot leaves the override directory empty, which starts EVERYTHING, because the authors judged that a container silently running nothing due to a late-arriving JSON file would be a much harder failure mode to diagnose than one that over-starts. An unknown feature key in the snapshot also reads as enabled by default, guarding against an old host snapshot silently disabling a newer program it doesn't know about.

### Siblings
- [FeatureGatingOverride](./FeatureGatingOverride.md) -- entrypoint.sh reads FEATURES_SNAPSHOT=/coding/.coding/runtime/features.json, mounted read-only, and writes overrides to FEATURES_DIR=/etc/supervisor/features.d/disabled.conf
- [ServiceGatingTestSuite](./ServiceGatingTestSuite.md) -- [LLM] tests/features/service-gating.test.mjs treats structural drift as a first-class bug class, not just a testing nicety — its four `describe('service catalogue coverage')` tests (`every service declares a feature`, `every declared feature is a real one`, `SERVICE_ORDER and SERVICE_CONFIGS cover each other exactly`, `the live-logging pair still starts before everything else`) exist purely to catch the failure mode named in the file's own docstring comment: 'ten hand-written start blocks were ten chances to forget a gate.' This is a defensive test suite written against a historical incident class (a service silently missing its feature gate) rather than against a single past bug, and it validates SERVICE_CONFIGS/SERVICE_ORDER imported live from scripts/start-services-robust.js rather than against a fixture, so the assertions can never drift out of sync with the real catalogue.
- [ServiceStarterRetryPolicy](./ServiceStarterRetryPolicy.md) -- [LLM] scripts/start-services-robust.js's SERVICE_CONFIGS entries (e.g. transcriptMonitor, liveLoggingCoordinator) encode a retry policy through a small set of declarative fields — `required`, `maxRetries`, `timeout`, `startFn`, `healthCheckFn` — rather than each service hand-writing its own loop. This is consumed by `startServiceWithRetry()` (imported from lib/service-starter.js) and orchestrated by `startOneService()`/`SERVICE_ORDER`, which tests/features/service-gating.test.mjs asserts is the exhaustive list of started services. The docstring's framing — 'ten hand-written start blocks were ten chances to forget a gate' — makes explicit that the retry policy's real value is structural: a service literally cannot start without declaring a `feature`, because the config object is the single place both the starter and the test suite read from.


---

*Generated from 9 observations*
