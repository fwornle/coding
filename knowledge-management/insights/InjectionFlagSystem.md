# InjectionFlagSystem

**Type:** Detail

## What It Is

InjectionFlagSystem is implemented directly within `scripts/health-coordinator.js`, as part of the larger HealthCoordinator daemon. It centers on a module-level `injectionFlags` Map and a unified query function, `shouldInject(kind)`, which together provide a fault-injection mechanism for testing health-check failure paths. The system unifies two historically distinct injection mechanisms — an in-memory flag set via `POST /test/inject` (loopback-gated) and a legacy environment variable, `HEALTH_COORDINATOR_INJECT_THROW` — behind a single call site interface.

## Architecture and Design

The core architectural pattern is a dual-mechanism feature-flag lookup with alias resolution. `shouldInject(kind)` checks both the in-memory `injectionFlags` Map and the legacy `INJECT_THROW` array, applying the same aliasing logic to each: 'container' and 'docker_health' are treated as interchangeable keys, so setting either one triggers both check sites (SPEC R7's naming ambiguity between the two terms is the direct cause of this defensive double-aliasing).

The system also encodes a fail-safe fault injection philosophy: it never fabricates a healthy result, and injected failures deliberately surface as 'unknown' (per SPEC R6) or as a 'fail' status, depending on which of two injection modes is used. Notably, `shouldInject` returns one of two strings, 'throw' or 'fail', rather than a boolean, allowing call sites to distinguish between raising an exception (exercising the per-check error-isolation/try-catch boundary) and returning a degraded result synchronously (testing downstream status propagation without touching that boundary).

Historically, the design reflects a falsified alternative: per the 33-12-SUMMARY session record, an earlier approach using `launchctl setenv` to override plist-declared environment defaults was empirically shown not to work on macOS Sequoia (Darwin 25.4.0) across three reproductions. This forced a Phase 33-15 pivot away from environment-based injection toward the current in-memory Map plus loopback-gated HTTP endpoint, which is now the production-grade path for AC#13 testing.

## Implementation Details

Three code elements anchor the system: the `injectionFlags` Map itself (module-level fault-injection state), the `shouldInject(kind)` function (unified lookup with container/docker_health aliasing), and the legacy `INJECT_THROW` array, derived by splitting `process.env.HEALTH_COORDINATOR_INJECT_THROW`. `shouldInject` checks the Map first, then falls back to the legacy env-derived array, re-applying the alias branch at each stage — a "double-checked aliasing" scheme explicitly written as defensive code to survive naming ambiguity between check kinds.

The env-var path is retained, but only for "backward compat / dev-time use," per an explicit comment above `INJECT_THROW`; production AC#13 testing is documented as going through `POST /test/inject`. This reflects a broader philosophy in the module (also visible in `FORBIDDEN_RULE_NAMES`) of tolerating drift across deploy phases rather than assuming a clean cutover — old and new mechanisms coexist rather than the old being removed outright.

## Integration Points

`shouldInject()` is consumed by per-check code across the HealthCoordinator's check registry — services, db_health, docker_health, lsl, and tick — none of which need to know which of the two underlying mechanisms (Map or env var) is currently active. This centralization means fault injection is a single dependency surface rather than one scattered across each check implementation.

The injection system is coupled to HTTP-layer network topology: the `/test/inject` endpoint is loopback-gated, tying test-safety guarantees to the distinction between a 0.0.0.0 bind and loopback-only endpoints. Injection state itself is process-local (the `injectionFlags` Map lives in-process), consistent with the single-owner in-memory `currentState` design of the parent HealthCoordinator daemon. Environment-variable injection, when used, is gated by the daemon's launchd plist (`com.coding.health-coordinator`) EnvironmentVariables block, which requires explicit reload procedures — an operational rigidity that further explains why the in-memory Map became the preferred mechanism.

Within the HealthCoordinator's sibling landscape (LslSessionStalenessTracking, EtmExpectationTracking, ActiveTimeStallClock), InjectionFlagSystem does not share state or logic directly, but it does share the same source file and the same "never fabricate healthy" ethos that governs how degraded states (stopped sessions, stalled ETMs, stall clocks) are surfaced rather than masked.

## Usage Guidelines

Developers adding or testing new health checks should call `shouldInject(kind)` rather than reading `injectionFlags` or environment variables directly, since the function already resolves both mechanisms and the container/docker_health alias. New check kinds that might reasonably be called by more than one name should consider whether they need similar alias handling, given that SPEC R7's naming produced exactly this ambiguity.

For production-grade testing (AC#13), use the loopback-gated `POST /test/inject` HTTP endpoint rather than the legacy environment variable, which requires a plist reload and has been shown unreliable on macOS Sequoia. The env-var path should be treated as dev-time-only and not removed casually — its retention is a deliberate architectural choice, not dead code. When distinguishing test behavior, use the 'throw' vs 'fail' return values intentionally: 'throw' to test error-isolation/try-catch tagging (per SPEC R6), and 'fail' to test downstream status propagation without exercising that boundary.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Per 33-12-SUMMARY (referenced in the module's own comments and the parent context), `launchctl setenv` was empirically found NOT to override plist-declared empty defaults on macOS Sequoia (Darwin 25.4.0) across three independent reproductions — this falsified the original plist-propagation approach to fault injection and forced the Phase 33-15 pivot to the in-memory `injectionFlags` Map plus a loopback-gated HTTP endpoint as the production-grade AC#13 testing path.
- Per the Health Coordinator — Launchd Plist and ETM Debug Environment record, the daemon's environment (including any injection-related variables) is controlled through the com.coding.health-coordinator launchd plist's EnvironmentVariables block, which requires explicit reload procedures when changed — an operational constraint that explains why the legacy env-var injection path was unreliable enough to need the in-memory Map as its replacement.

## Hierarchy Context

### Parent
- [HealthCoordinator](./HealthCoordinator.md) -- [LLM] scripts/health-coordinator.js implements the actual HealthCoordinator daemon: a single-owner in-memory state object (currentState) exposed over HTTP (GET /health, GET /health/state, POST /signals, POST /health/refresh) and refreshed on a 5s tick that iterates a check registry loaded from config/health-verification-rules.json. This is the concrete component behind the 'HealthCoordinator' label in the parent context, though the parent's observations (SemanticAnalysisAgent, OntologyClassificationAgent, BaseAgent lifecycle) describe an entirely different subsystem.

### Siblings
- [LslSessionStalenessTracking](./LslSessionStalenessTracking.md) -- [LLM] scripts/health-coordinator.js implements the actual staleness/eviction thresholds for LSL sessions: `HEARTBEAT_STALENESS_MS = 15_000` marks a session 'stopped' after 15s without a heartbeat, and `EVICT_AFTER_STOPPED_MS = 5 * 60 * 1000` drops it from `currentState.lsl` after 5 minutes in that state (both tagged D-10 in the header comment). This is a two-stage decay rather than a single timeout: a session first degrades to a visible-but-stopped status so consumers can still show 'last seen N ago', and only later disappears entirely, which keeps the dashboard/statusline from flapping a session straight to 'gone' on a single missed beat.
- [EtmExpectationTracking](./EtmExpectationTracking.md) -- [SESSION] Health Coordinator — ETM Reaper Logic notes this prevents false-positive stall/health warnings from raw wall-clock idle time and prevents crash-looping ETMs from showing falsely healthy due to missing session-key tracking.
- [ActiveTimeStallClock](./ActiveTimeStallClock.md) -- [LLM] The test file tests/integration/health-coordinator-etm-expected.test.mjs regex-matches flattened source of scripts/health-coordinator.js for the exact stall-clock update lines (`_obsActiveStallMs += sinceLastPoll`, `_obsStallAnchor` reset, `_obsStallPolledAt` diffing) rather than executing the coordinator, meaning the 'ActiveTimeStallClock' logic is pinned as literal source strings — a regression in these exact tokens (even a semantically equivalent rewrite) would fail CI even though behavior is unchanged.


---

*Generated from 9 observations*
