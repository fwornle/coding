# RequiredVsOptionalStartup

**Type:** Detail

# RequiredVsOptionalStartup — Technical Insight Document

## What It Is

RequiredVsOptionalStartup is the design contract that governs which services must succeed for the system to start and which may fail gracefully. It is implemented primarily in `scripts/start-services-robust.js`, where each entry in `SERVICE_CONFIGS` carries a `required` boolean alongside retry parameters — for example, `transcriptMonitor` and `liveLoggingCoordinator` are declared `required: true` with `maxRetries: 3` and `timeout: 20000`, while services like `observationsApi` and `llmCliProxy` are optional and allowed to degrade. This host-side model is the child concept of its parent, **HostServiceStarter**, which owns the broader `SERVICE_CONFIGS`/`SERVICE_ORDER` structures. A structurally parallel but independently implemented version of the same idea exists at the container level in `docker/entrypoint.sh`, which decides what to autostart in supervisord based on a `features.json` snapshot.

## Architecture and Design

The core pattern is retry-with-escalation: `startOneService()` retries a failing service up to `maxRetries` times, and only on exhaustion does it branch behavior by the `required` flag — setting `out.blocked = true` for required services (halting downstream startup) versus allowing optional services to degrade silently. This is validated by `tests/features/service-gating.test.mjs`'s test 'a required failure blocks, so downstream services do not start,' which deliberately overrides `maxRetries` to 1 to avoid the real six-second exponential backoff cost.

Critically, required/optional status is not absolute — it is layered underneath a newer feature-gating system. A service marked `required: true` is only "required" if its associated feature is enabled; the test 'a REQUIRED service whose feature is off does not block startup' confirms that disabling `lsl` for `transcriptMonitor` yields `blocked === false`. This layered gating means required-ness is scoped to "feature enabled AND retries exhausted," a nuance enforced entirely through test cases rather than a single code assertion.

This entity's sibling, **ServiceOrderTable**, enforces the structural symmetry this system depends on: `SERVICE_ORDER` and `SERVICE_CONFIGS` must cover each other exactly (sorted key arrays deep-equal), and every config must declare a `feature` that exists in `FEATURE_IDS`. Without this guardrail, the required/optional contract could silently drift — a service could exist in one structure but not the other, undermining the whole gating design (the test docstring calls out the failure mode directly: "ten hand-written start blocks were ten chances to forget a gate").

At a coarser granularity, `start-services.sh`'s `ROBUST_MODE` flag (lines 12–20) represents a required-vs-optional decision about the *startup mechanism itself* — whether to exec the Node orchestrator or fall back to a ~200-line legacy bash path with manual `lsof`/`kill -9` cleanup and docker-compose polling loops. This legacy path bypasses the structured required/optional framework entirely, printing inline "⚠️ DEGRADED MODE" strings instead of structured result objects — a strangler/fallback pattern applied above the service level.

## Implementation Details

`startOneService()` is the central function enacting the contract: it attempts service startup, retries per `maxRetries`, and on final failure inspects the `required` flag to decide between blocking (`out.blocked = true`) and graceful degradation. Supporting this are two defensive helpers, shared with sibling **PortCleanup**: `killProcessOnPortAndWait()`, which sends SIGTERM via `lsof -ti:<port>` PIDs and escalates to SIGKILL once `Date.now() - startTime > maxWaitMs/2` inside its poll loop (re-issued each tick past the halfway mark, tolerant of already-dead processes), and `waitForPortBindable()`, which spins up a throwaway `net.createServer().listen()` rather than trusting `isPortListening()` — explicitly to avoid burning a `maxRetries` slot on an EADDRINUSE race during crash recovery.

On the container side, `docker/entrypoint.sh` reads a flat `features.json` snapshot and uses an inline `node -e` script to rewrite `autostart=false` into a generated supervisord include (`/etc/supervisor/features.d/disabled.conf`) for programs like `semantic-analysis`, `graphify`, and `constraint-monitor`. Its `PROGRAM_FEATURES` mapping is checked against `supervisord.conf`'s `[program:...]` sections by `tests/features/container-gating.test.mjs`, mirroring the exactly-covers-each-other invariant from `service-gating.test.mjs`.

A key asymmetry is deliberately encoded: the in-process orchestrator fails LOUD on bad config — `startOneService()` rejects with `/unknown feature 'nope'/` rather than silently skipping an unrecognized feature — while `entrypoint.sh` fails OPEN, treating unknown/missing snapshot keys as enabled (`value === false ? "false" : "true"`), with the inline rationale that a container silently running nothing due to a late JSON file is harder to diagnose than one running too much.

## Integration Points

RequiredVsOptionalStartup sits directly beneath its parent HostServiceStarter's `SERVICE_CONFIGS`/`SERVICE_ORDER` structures and depends on `lib/features/catalogue.cjs`'s `FEATURE_IDS` for feature validation. It integrates with sibling ServiceOrderTable's structural coverage tests to prevent configuration drift, and with sibling PortCleanup's `killProcessOnPortAndWait()`/`waitForPortBindable()` helpers to make startup ordering reliable — which matters most for required services since their failure has downstream blocking consequences. It also connects conceptually (not via shared code) to the container-side gating in `docker/entrypoint.sh`, forming two independently implemented but philosophically aligned systems.

## Usage Guidelines

When adding a new service to `SERVICE_CONFIGS`, it must also appear in `SERVICE_ORDER` and declare a valid `feature` — omitting either will fail the coverage tests in `tests/features/service-gating.test.mjs`. Developers should treat `required: true` as conditional, not absolute: it only produces blocking behavior when the associated feature is enabled, so disabling a feature is a legitimate degraded-but-not-broken configuration. When writing tests against retry logic, override `maxRetries` to avoid paying the real exponential backoff cost. Unknown feature names in service configs must be treated as errors, not silent skips, consistent with the fail-loud philosophy of the host orchestrator — this is intentionally different from the fail-open behavior expected in `entrypoint.sh`'s runtime snapshot handling, so this asymmetry should be preserved rather than "fixed" toward consistency.


## Hierarchy Context

### Parent
- [HostServiceStarter](./HostServiceStarter.md) -- start-services-robust.js defines SERVICE_CONFIGS and SERVICE_ORDER, asserted in tests/features/service-gating.test.mjs to cover each other exactly so no service is configured but never started

### Siblings
- [ServiceOrderTable](./ServiceOrderTable.md) -- [LLM] The gating contract in scripts/start-services-robust.js is enforced structurally, not just behaviorally: tests/features/service-gating.test.mjs asserts that `SERVICE_ORDER.map(o => o.key).sort()` exactly equals `Object.keys(SERVICE_CONFIGS).sort()`, and separately that every `SERVICE_CONFIGS` entry declares a `feature` field that exists in `FEATURE_IDS` (imported from `lib/features/catalogue.cjs`). This closes a specific failure mode called out in the test file's own docstring — 'ten hand-written start blocks were ten chances to forget a gate' — by making an un-gated or orphaned service a test failure rather than a runtime surprise. The mirrored idea appears in docker/entrypoint.sh's `PROGRAM_FEATURES` string, which `tests/features/container-gating.test.mjs` (referenced in the shell script's comments) checks against the `[program:...]` sections of supervisord.conf — the same exactly-covers-each-other invariant applied to the container's process list instead of the host's service list.
- [PortCleanup](./PortCleanup.md) -- [LLM] killProcessOnPortAndWait() in scripts/start-services-robust.js implements a two-phase escalation strategy: it first sends SIGTERM to all PIDs found via `lsof -ti:<port>`, then polls checkPortInUse() every pollIntervalMs, and only escalates to SIGKILL after `Date.now() - startTime > maxWaitMs / 2` has elapsed inside the same polling loop. This means the SIGKILL escalation is re-issued on every poll tick past the halfway mark (not just once), which is harmless for an already-dead process (process.kill throws and is silently caught) but means the function is deliberately imprecise about exactly when force-kill happens — it guarantees 'no later than half the timeout' rather than 'exactly at half the timeout'.


---

*Generated from 9 observations*
