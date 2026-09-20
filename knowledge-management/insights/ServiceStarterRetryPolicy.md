# ServiceStarterRetryPolicy

**Type:** Detail

# ServiceStarterRetryPolicy — Technical Insight Document

## What It Is

ServiceStarterRetryPolicy is the retry, liveness-verification, and gating discipline implemented primarily in `scripts/start-services-robust.js`, consumed via `startServiceWithRetry()` (imported from `lib/service-starter.js`) and orchestrated by `startOneService()`/`SERVICE_ORDER`. Rather than each service maintaining its own hand-rolled startup loop, individual services are described declaratively in `SERVICE_CONFIGS` entries (e.g., `transcriptMonitor`, `liveLoggingCoordinator`) using a small set of fields: `required`, `maxRetries`, `timeout`, `startFn`, `healthCheckFn`. This config object is deliberately the single source of truth read by both the runtime starter and by `tests/features/service-gating.test.mjs`, which asserts `SERVICE_ORDER` is the exhaustive, ordered list of started services. As the code's own docstring puts it, "ten hand-written start blocks were ten chances to forget a gate" — the policy's core value is structural prevention of configuration drift, not just retry mechanics.

As a child of ServiceProbe, this policy sits downstream of the feature-gating layer implemented in `docker/entrypoint.sh`, inheriting its fail-open philosophy at the container level while enforcing stricter fail-loud behavior at the code-configuration level.

## Architecture and Design

The dominant pattern is a **declarative service-registry**: `SERVICE_CONFIGS` + `SERVICE_ORDER` replace ad hoc per-service start blocks with data consumed identically by production code and tests, eliminating drift between what's documented and what's tested.

Layered on top is **defense-in-depth liveness verification** before any retry loop spawns a process: a global PSM check (`psm.isServiceRunning('transcript-monitor', 'global')`), a project-scoped PSM check, and an OS-level `pgrep`-based fallback via `isProcessRunningByScript()`. This reflects a design conviction that "retry" isn't just about restarting failed spawns — it's about proving a spawn is even necessary, since PSM's registry can drift from reality. The OS-level branch self-heals by re-registering orphans (`psm.registerService(...)`) inline, closing the drift loop at read-time instead of deferring to a separate reconciliation job.

A second recurring pattern is **bounded polling instead of fixed sleeps**, embodied by two sibling primitives: `waitForPortBindable()` (child entity PortBindableProbe) and `killProcessOnPortAndWait()`. Both replace a single `sleep()` with poll-until-deadline loops plus a final synchronous check, reflecting the policy's guiding philosophy: "never trust a single point-in-time signal."

Finally, the architecture practices **asymmetric fail-open vs. fail-loud gating**. The parent ServiceProbe (`docker/entrypoint.sh`) fails open on missing/unparseable feature snapshots or unknown feature keys — deliberately, because an idle container is harder to diagnose than an over-started one. In contrast, sibling ServiceGatingTestSuite enforces that an unknown feature *name* referenced by a `SERVICE_CONFIGS` entry throws loudly (`/unknown feature 'nope'/`), since a JS-side typo should never silently disable or enable a service the way a stale host snapshot is permitted to.

## Implementation Details

`waitForPortBindable()` (lines 163–178) guards the START path by constructing a throwaway `net.createServer()`, calling `.unref()` so the probe doesn't hold the event loop open, and racing `error`/`listening` events into a boolean via Promise — deliberately more primitive than the HTTP-based `isPortListening()`, because the kernel can hold a socket in a post-crash TIME_WAIT-like state that an HTTP probe reports as clean, which would otherwise burn a `maxRetries` slot on a doomed EADDRINUSE spawn.

`killProcessOnPortAndWait()` (lines 82–155) guards the STOP path with graduated escalation: SIGTERM first, poll every `pollIntervalMs`, escalate to SIGKILL only once more than half of `maxWaitMs` has elapsed, then a final synchronous check.

`SERVICE_CONFIGS.transcriptMonitor.startFn` (lines 199–260) demonstrates the full liveness chain: global PSM → project-scoped PSM → OS-level `pgrep` fallback with re-registration, all before the retry loop itself runs.

The result-bucketing state machine — `results.successful` / `results.degraded` / `results.disabled` / `failed` — is itself part of the contract: a feature-disabled service must produce zero `startFn` calls and land in `disabled` (never `degraded`), while a `required: true` service whose retries are exhausted sets `out.blocked = true` and lands in `failed`, blocking downstream `SERVICE_ORDER` entries — but only when its feature is actually on.

## Integration Points

The policy is centralized in one file but consumed by two callers — `start-services.sh` (runtime) and `tests/features/service-gating.test.mjs` (verification) — making `SERVICE_CONFIGS` a shared contract rather than a duplicated one. `start-services.sh`'s `ROBUST_MODE` flag (default `true`) delegates entirely to this policy; the preserved LEGACY MODE path reimplements its own waits (`sleep 3`, `sleep 5`) and does not benefit from `waitForPortBindable()` or `killProcessOnPortAndWait()`, meaning the retry policy's race-condition fixes only propagate to one of two reachable code paths.

Upstream, sibling FeatureGatingOverride (`docker/entrypoint.sh`) determines which services are even eligible to start, coupling `PROGRAM_FEATURES` to `FEATURE_IDS` and `supervisord.conf`. Sibling PortBindableProbe is directly embedded as `waitForPortBindable()`. Sibling ServiceGatingTestSuite imports `SERVICE_CONFIGS`/`SERVICE_ORDER` live rather than via fixtures, so it can never silently drift from the real catalogue.

Architecturally adjacent but not integrated is `scripts/prompt-classifier-service.mjs`, whose `loadConfig()` mirrors the same "never fabricate a good state from an uncertain signal" discipline — on YAML parse failure it withholds updating `configMtimeMs` so a fix is picked up on the next poll — but resolves the risk asymmetry oppositely (fail toward last-known-good rather than toward maximal startup).

## Usage Guidelines

Every new service must declare a `feature` in its `SERVICE_CONFIGS` entry; omitting one, or naming a nonexistent feature, is a loud test/runtime failure, not a silent gap. `SERVICE_ORDER` position matters — `transcriptMonitor` and `liveLoggingCoordinator` must remain first because later services register against them, enforced by explicit ordering tests. Developers modifying startup races should prefer bounded polling primitives (`waitForPortBindable`, `killProcessOnPortAndWait`) over `sleep()`. Any race-condition fix made in the robust starter should be manually ported to LEGACY MODE if `ROBUST_MODE=false` remains a supported path, since there is no shared implementation. Finally, respect the fail-open/fail-loud split: container-level feature gating should stay permissive on ambiguous input, while code-level misconfiguration (unknown feature strings in `SERVICE_CONFIGS`) must always throw.


## Hierarchy Context

### Parent
- [ServiceProbe](./ServiceProbe.md) -- [LLM] docker/entrypoint.sh implements a fail-open feature-gating layer that sits strictly between the host's feature resolver and supervisord: it reads a flat JSON snapshot at /coding/.coding/runtime/features.json (written by the host, never by the container) and, for each entry in the PROGRAM_FEATURES mapping (e.g. 'semantic-analysis:knowledge', 'constraint-monitor:constraints', 'health-dashboard:health'), uses `node -e` (not jq, since jq isn't installed in the image) to decide whether to emit an `autostart=false` override into /etc/supervisor/features.d/disabled.conf. Critically, the script comments explain the asymmetric fail-open design: a missing or unparseable snapshot leaves the override directory empty, which starts EVERYTHING, because the authors judged that a container silently running nothing due to a late-arriving JSON file would be a much harder failure mode to diagnose than one that over-starts. An unknown feature key in the snapshot also reads as enabled by default, guarding against an old host snapshot silently disabling a newer program it doesn't know about.

### Siblings
- [FeatureGatingOverride](./FeatureGatingOverride.md) -- entrypoint.sh reads FEATURES_SNAPSHOT=/coding/.coding/runtime/features.json, mounted read-only, and writes overrides to FEATURES_DIR=/etc/supervisor/features.d/disabled.conf
- [ServiceGatingTestSuite](./ServiceGatingTestSuite.md) -- [LLM] tests/features/service-gating.test.mjs treats structural drift as a first-class bug class, not just a testing nicety — its four `describe('service catalogue coverage')` tests (`every service declares a feature`, `every declared feature is a real one`, `SERVICE_ORDER and SERVICE_CONFIGS cover each other exactly`, `the live-logging pair still starts before everything else`) exist purely to catch the failure mode named in the file's own docstring comment: 'ten hand-written start blocks were ten chances to forget a gate.' This is a defensive test suite written against a historical incident class (a service silently missing its feature gate) rather than against a single past bug, and it validates SERVICE_CONFIGS/SERVICE_ORDER imported live from scripts/start-services-robust.js rather than against a fixture, so the assertions can never drift out of sync with the real catalogue.
- [PortBindableProbe](./PortBindableProbe.md) -- [LLM] The `waitForPortBindable()` function in scripts/start-services-robust.js implements a socket-level readiness probe that is deliberately more primitive than `isPortListening()` from lib/service-starter.js. It constructs a throwaway `net.createServer()`, calls `.unref()` immediately so the probe never keeps the Node event loop alive if the parent process were to exit mid-poll, and races `error`/`listening` events inside a Promise to convert the socket's callback API into a simple boolean. This is a narrow, single-purpose primitive — it answers exactly one question ('can I bind this port right now') and nothing else, refusing to conflate that with HTTP-level readiness the way a naive health check might.


---

*Generated from 10 observations*
