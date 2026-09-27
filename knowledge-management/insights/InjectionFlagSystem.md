# InjectionFlagSystem

**Type:** Detail

## What It Is

InjectionFlagSystem is implemented directly within `scripts/health-coordinator.js`, as part of its parent component HealthCoordinator. It centers on an in-memory `injectionFlags` Map (keyed by check kind) and a `shouldInject(kind)` resolver function, providing a controlled fault-injection mechanism for deterministic testing of health checks. Rather than a separate module, it lives inline alongside the coordinator's own state and control surface — consistent with the pattern seen in siblings like EtmExpectationTracker and ActiveStallClock, which are also inline logic pinned down by regex-based source tests rather than independently exported classes.

## Architecture and Design

The system's core design decision is a fallback chain: `shouldInject` first checks the in-memory `injectionFlags` Map, then falls back to a legacy comma-separated environment variable, `HEALTH_COORDINATOR_INJECT_THROW`. This dual-path structure exists for a concrete, empirically-driven reason — Phase 33-12 testing falsified `launchctl setenv`'s ability to override plist-declared empty defaults on macOS Sequoia across three independent reproductions. That finding forced the in-memory HTTP-driven path (`POST /test/inject` / `POST /test/reset`) to become the production mechanism, with the env var retained only for dev-time convenience.

A second notable pattern is alias resolution: `shouldInject` bidirectionally maps 'container' and 'docker_health' in both the memory-map and legacy env-var branches, reconciling SPEC R7's `.container.healthcheck` naming with the historical `docker_health` code path. This is an intentional compatibility shim, not an oversight, allowing either name to target the same check site.

The test/debug control surface is deliberately coupled to the same single-owner process as production health state (`currentState`), rather than run as a separate harness process — reinforcing HealthCoordinator's single-owner, in-memory source-of-truth architecture.

## Implementation Details

Injection values are modal rather than boolean: `injectionFlags.get(kind)` returns `'throw'` or `'fail'`, enabling tests to distinguish a hard-exception path (exercising SPEC R6's unknown-tagging via caught errors) from a soft degraded-result path (a check's normal failure branch) without needing separate flag maps. The flag namespace is explicitly scoped via a declared comment enumerating valid kinds: `'db_health' | 'docker_health' | 'container' | 'lsl' | 'services' | 'tick' | services.${name}` — constraining `POST /test/inject` to known check registries and preventing silent no-ops from unsupported names.

The `POST /test/inject` endpoint is documented in-code as the "preferred AC#13 path," explicitly loopback-gated as a safety boundary, though the gating logic itself falls outside the observed excerpt.

## Integration Points

InjectionFlagSystem is a subsystem of HealthCoordinator, sharing its process and state model with the coordinator's tick scheduler and check registries (driven by `config/health-verification-rules.json`). Its "never silently report healthy" discipline echoes HeartbeatStalenessPolicy's approach of computing PID staleness from heartbeat file age rather than defaulting to a healthy state — a check disabled via injection must resolve to `'unknown'`, not silently pass.

## Usage Guidelines

Developers should invoke injection via `POST /test/inject` using either alias form ('container' or 'docker_health') and must supply one of the enumerated kinds. Choose `'throw'` to exercise error-tagging paths and `'fail'` to exercise degraded-result branches. The env-var fallback (`HEALTH_COORDINATOR_INJECT_THROW`) should be treated as dev-only, given its proven unreliability under launchd on macOS Sequoia — production and CI testing should rely on the HTTP surface, kept loopback-only for safety.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The Health Coordinator — ETM Reaper Logic and Health Coordinator — Launchd Plist and ETM Debug Environment records describe the same falsification event referenced in the injection code's comments: launchd env propagation was proven unreliable across three independent reproductions (33-12-SUMMARY), which is why the injection flag system had to move off env vars and onto an in-process, loopback-gated HTTP surface (POST /test/inject / POST /test/reset) as its primary mechanism.
- The Multi-Agent Health Monitoring (claude/opencode/copilot heartbeats) record establishes that PID staleness is computed from heartbeat file age to avoid false 'Healthy/Degraded' alarms — this is the same never-default-healthy discipline the injection system enforces structurally, since a check disabled by injection must still resolve to 'unknown' rather than silently reporting healthy.

## Hierarchy Context

### Parent
- [HealthCoordinator](./HealthCoordinator.md) -- [LLM] scripts/health-coordinator.js is the actual implementation of HealthCoordinator: a single-owner in-memory SoT (`currentState`) exposing HTTP endpoints (GET /health, GET /health/state, POST /signals, POST /health/refresh) and a 5s tick scheduler that iterates check registries from config/health-verification-rules.json. This is directly the component under analysis, not an inferred neighbor.

### Siblings
- [EtmExpectationTracker](./EtmExpectationTracker.md) -- [LLM] The test file tests/integration/health-coordinator-etm-expected.test.mjs asserts on the *source text* of scripts/health-coordinator.js (via regex against a whitespace-flattened string) rather than importing and exercising the module, indicating EtmExpectationTracker's actual logic (the `_etmExpected` Map, `ETM_MISSING_MS`, `ETM_SPAWN_INTERVAL_MS`) lives inline inside health-coordinator.js's tick loop rather than as a separate exported class or module.
- [ActiveStallClock](./ActiveStallClock.md) -- [LLM+CGR] The ActiveStallClock is directly implemented in tests/integration/health-coordinator-etm-expected.test.mjs's 'stall clock' test section, which asserts against literal source patterns in scripts/health-coordinator.js: `_obsActiveStallMs`, `_obsStallAnchor`, and `_obsStallPolledAt` are the actual state variables composing the clock, and the tests exist specifically to pin down its behavior against regression.
- [HeartbeatStalenessPolicy](./HeartbeatStalenessPolicy.md) -- [SESSION] Per the Multi-Agent Health Monitoring record, health-coordinator.js computes PID staleness from heartbeat file age and cross-checks PID liveness before marking a session degraded.


---

*Generated from 10 observations*
