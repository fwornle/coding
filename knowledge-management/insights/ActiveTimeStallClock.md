# ActiveTimeStallClock

**Type:** Detail

## What It Is

ActiveTimeStallClock is a stall-detection mechanism implemented inside `scripts/health-coordinator.js`, as part of the tick/poll cycle of its parent component, HealthCoordinator. Its concrete implementation is not visible in the supplied source excerpt; its behavior is known instead through the strict assertions in `tests/integration/health-coordinator-etm-expected.test.mjs`, which regex-matches the flattened source for exact lines involving `_obsActiveStallMs`, `_obsStallAnchor`, and `_obsStallPolledAt`. It accumulates "active" wall-clock time — time during which `currentState.user_active === true` — rather than raw elapsed time, so it can distinguish an idle-but-healthy machine from a genuinely stalled observation pipeline.

## Architecture and Design

The design directly addresses a documented failure mode: an earlier implementation measured stall via `obsAge > OBS_STALL_MS`, which produced false alarms every ordinary night, since both an idle machine and a dead pipeline yield zero new observations. The fix restricts accumulation to active-user windows, requiring `currentState` to expose a `user_active` flag alongside its other subsystem statuses (container, services, lsl, databases, knowledge_pipeline, graph_integrity, sub_agent_capture, classifier).

Two patterns stand out. First, an active-time-only accumulator pattern: instead of adding a fixed increment per tick, `sinceLastPoll = _obsStallPolledAt ? Math.max(0, now - _obsStallPolledAt) : 0` measures actual elapsed time between polls, compensating for delayed or slow ticks against the nominal `TICK_MS` (from `HEALTH_COORDINATOR_TICK_MS`). Second, an anchor-and-reset pattern keyed to content rather than time: `if (body.lastObservationAt !== _obsStallAnchor) { _obsStallAnchor = body.lastObservationAt; _obsActiveStallMs = 0; }` resets the clock whenever a genuinely new observation arrives, decoupling stall detection from polling cadence entirely.

This design rationale is corroborated independently by session-level notes on the sibling EtmExpectationTracking component, whose stated purpose — preventing false-positive stall/health warnings from raw wall-clock idle time — matches the stall clock's own embedded comments, suggesting a shared design philosophy across HealthCoordinator's stall/health-detection logic.

## Implementation Details

The mechanism centers on three module-level state variables: `_obsActiveStallMs` (accumulated active stall duration), `_obsStallAnchor` (the last-seen `lastObservationAt` value), and `_obsStallPolledAt` (timestamp of the previous poll). Each poll computes `sinceLastPoll` from real elapsed time, adds it to `_obsActiveStallMs` only when the user-active condition holds, and unconditionally checks whether the observation anchor has changed to decide whether to reset. The result is published as `activeStallMs: _obsActiveStallMs`.

Because the test suite pins these exact source tokens via regex against the flattened file rather than executing the coordinator, the implementation is effectively frozen at the string level: a semantically equivalent rewrite (renamed variables, restructured conditionals) would fail CI even without any behavioral change. This makes the test a strict low-level contract rather than a black-box behavioral test.

## Integration Points

ActiveTimeStallClock lives entirely within HealthCoordinator's tick/poll loop and reads from `currentState`, sharing that state object with sibling mechanisms like InjectionFlagSystem and LslSessionStalenessTracking. Its output field, `activeStallMs`, is explicitly commented as being consumed by "the prompt hook" to report active hours — an external, not-shown consumer — establishing an implicit cross-component contract per the Health Prompt Hook (Observation Pipeline Status Reporting) notes. A tracked, uncommitted false-positive issue in that prompt hook is flagged as possibly related to the same class of stall-detection defect this clock was built to avoid, though the two are not confirmed to be the same bug.

## Usage Guidelines

Any change to the stall-clock lines in `scripts/health-coordinator.js` must be validated against `tests/integration/health-coordinator-etm-expected.test.mjs`, since the test enforces literal source phrasing, not just behavior — refactors should be paired with corresponding test regex updates. Developers must preserve the `user_active`-gated accumulation logic; reverting to raw `obsAge` comparisons reintroduces the known false-alarm failure mode. Because `activeStallMs` is consumed downstream by the prompt hook, changes to its semantics or units should be coordinated with that consumer even though its source isn't present here. Finally, the anchor-reset logic should remain keyed to `lastObservationAt` content changes rather than tick counts, preserving the decoupling from polling cadence that gives the clock its resilience to slow or delayed ticks.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Per Health Prompt Hook — Observation Pipeline Status Reporting, a health-check false positive (not yet committed as a fix) is tracked among recurring operational issues surfaced across session continuity summaries — consistent with the stall clock's own documented history of false 'stalled' alarms, though the record does not confirm these are the same defect.
- Per Health Coordinator — ETM Reaper Logic, the stated purpose of related coordinator logic is explicitly to prevent false-positive stall/health warnings from raw wall-clock idle time, corroborating the design rationale embedded in the ActiveTimeStallClock's active-time-only accumulation strategy from an independent, session-level source rather than from source comments alone.

## Hierarchy Context

### Parent
- [HealthCoordinator](./HealthCoordinator.md) -- [LLM] scripts/health-coordinator.js implements the actual HealthCoordinator daemon: a single-owner in-memory state object (currentState) exposed over HTTP (GET /health, GET /health/state, POST /signals, POST /health/refresh) and refreshed on a 5s tick that iterates a check registry loaded from config/health-verification-rules.json. This is the concrete component behind the 'HealthCoordinator' label in the parent context, though the parent's observations (SemanticAnalysisAgent, OntologyClassificationAgent, BaseAgent lifecycle) describe an entirely different subsystem.

### Siblings
- [InjectionFlagSystem](./InjectionFlagSystem.md) -- [LLM] scripts/health-coordinator.js implements the InjectionFlagSystem directly: the module-level `injectionFlags` Map plus `shouldInject(kind)` function unify two fault-injection mechanisms — an in-memory flag set via POST /test/inject (loopback-gated) and the legacy `HEALTH_COORDINATOR_INJECT_THROW` env var — so any check site can query a single function regardless of which mechanism triggered it.
- [LslSessionStalenessTracking](./LslSessionStalenessTracking.md) -- [LLM] scripts/health-coordinator.js implements the actual staleness/eviction thresholds for LSL sessions: `HEARTBEAT_STALENESS_MS = 15_000` marks a session 'stopped' after 15s without a heartbeat, and `EVICT_AFTER_STOPPED_MS = 5 * 60 * 1000` drops it from `currentState.lsl` after 5 minutes in that state (both tagged D-10 in the header comment). This is a two-stage decay rather than a single timeout: a session first degrades to a visible-but-stopped status so consumers can still show 'last seen N ago', and only later disappears entirely, which keeps the dashboard/statusline from flapping a session straight to 'gone' on a single missed beat.
- [EtmExpectationTracking](./EtmExpectationTracking.md) -- [SESSION] Health Coordinator — ETM Reaper Logic notes this prevents false-positive stall/health warnings from raw wall-clock idle time and prevents crash-looping ETMs from showing falsely healthy due to missing session-key tracking.


---

*Generated from 10 observations*
