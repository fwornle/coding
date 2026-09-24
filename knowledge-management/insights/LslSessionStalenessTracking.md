# LslSessionStalenessTracking

**Type:** Detail

## What It Is

LslSessionStalenessTracking is implemented in `scripts/health-coordinator.js` as the subsystem responsible for determining whether an LSL (live session logging) session is alive, stalled, or gone. It lives inside the larger `currentState` in-memory source-of-truth maintained by its parent, HealthCoordinator, and manifests as a set of timers, thresholds, and data structures — `HEARTBEAT_STALENESS_MS`, `EVICT_AFTER_STOPPED_MS`, `currentState.lsl`, `currentState.lsl_by_project`, and `currentState.lsl_meta.current_window` — refreshed on the coordinator's 5-second tick. It is exercised by regression tests in `tests/integration/health-coordinator-etm-expected.test.mjs`, which validate both the ETM expectation lifecycle and the active-time stall clock.

## Architecture and Design

The core architectural decision is a **two-stage decay model** rather than a single timeout: a session first transitions to a visible "stopped" status after `HEARTBEAT_STALENESS_MS` (15s) with no heartbeat, then is evicted from `currentState.lsl` only after `EVICT_AFTER_STOPPED_MS` (5 minutes) in that state (tagged D-10 in source). This avoids flapping sessions straight to "gone" on a single missed beat, letting consumers display "last seen N ago" in the interim.

Because a presence-only heartbeat map structurally cannot represent a session that never started (e.g., an ETM crash-looping on launch contributes no key to `lsl_by_project`), the design pairs this with its sibling, EtmExpectationTracking, via the `_etmExpected` Map — an independent detection mechanism for absence-of-event failures. Together these two mechanisms (heartbeat/eviction timers and expectation tracking) form deliberate answers to two distinct failure modes identified in the "Health Coordinator — ETM Reaper Logic" work record: false-positive staleness from wall-clock idle time, and false-healthy status from missing session tracking.

A related architectural sibling, ActiveTimeStallClock, decouples the staleness clock from wall time: `_obsActiveStallMs` only advances while `currentState.user_active === true`, using measured `sinceLastPoll` gaps rather than assumed tick intervals, and resets via `_obsStallAnchor` when a new observation lands.

## Implementation Details

The per-session record shape (status, lastBeat, stoppedAt?, projectPath, projectName?, transcriptPath?, agent?, source?) drives the heartbeat side. The `_etmExpected` lifecycle has three guarded invariants: expectations are recorded only past an activity gate (`!targeted && !transcriptFresh && !tmuxAlive && !hasOpenCode`); full sweeps prune stale expectations while targeted single-project calls leave others untouched; and reaping a dead ETM deletes its expectation via `_reapedProjects.set(...)` followed by `_etmExpected.delete(e.projectName)`, preventing a clean shutdown from becoming a "missing" alarm ~90s later.

`lsl_meta.current_window` is a deliberately separate top-level sibling of `lsl`/`lsl_by_project` (Phase 36-01), avoiding key collisions with `lsl`'s `sid:project` composite keys — a noted "PATTERNS.md Section 1 anomaly." It caches the LSL time-window once per tick instead of letting every consumer call `getTimeWindow()` (which reads `config/live-logging-config.json` from disk), avoiding ~17,280 reads/day.

Regression protection is source-contract testing: regexes over flattened source text assert exact tokens (`_obsActiveStallMs += sinceLastPoll`, absence of the old `obsAge > OBS_STALL_MS` wall-clock branch), a trade-off chosen because exercising the real tick loop requires running the whole daemon.

## Integration Points

This tracking is one slice of HealthCoordinator's broader currentState SoT, alongside container/services/databases/knowledge_pipeline/graph_integrity checks, all refreshed on the same 5s tick. It shares the module with sibling InjectionFlagSystem (fault injection via `shouldInject`) for testability, and depends on `config/live-logging-config.json` for time-window data. Downstream consumers — the prompt hook, statusline, and dashboard — read `currentState.lsl`/`lsl_by_project` and treat absent keys as "healthy," which is precisely the gap EtmExpectationTracking closes.

## Usage Guidelines

Developers modifying eviction/staleness thresholds should preserve the two-stage decay semantics (stopped vs. evicted) rather than collapsing to one timeout. Any change to `_obsActiveStallMs`/`_obsStallAnchor` logic must be mirrored in the regex-based regression test, since even semantically equivalent rewrites will fail CI. New fields should follow the fail-open, never-fabricate-healthy convention, and any new top-level state (like `lsl_meta`) should avoid colliding with existing composite keys used in `lsl`.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Per the work record 'Health Coordinator — ETM Reaper Logic', this mechanism exists specifically to prevent two distinct failure modes from the same root cause: raw wall-clock idle time producing false-positive stall/health warnings, and crash-looping ETM processes showing falsely 'green'/healthy because there was no session-key tracking to catch them. The staleness tracking in health-coordinator.js is the concrete implementation of that requirement — the heartbeat/eviction timers and the `_etmExpected` gap-detector are two separate answers to the two separate ways the earlier design could be wrong.
- Per the work record 'Enhanced Transcript Monitor (ETM) Process Management', the coordinator's LSL/ETM reaping exists to stop orphaned enhanced-transcript-monitor processes from persisting indefinitely by detecting and reaping tmux sessions whose underlying agent process has died, was never launched, has no attached panes, or is fully detached — without this, ETMs and their statusline dots 'pin forever'. This corroborates and gives operational motivation for the `_reapedProjects` / `_etmExpected.delete` cleanup pairing observed directly in the source.

## Hierarchy Context

### Parent
- [HealthCoordinator](./HealthCoordinator.md) -- [LLM] scripts/health-coordinator.js implements the actual HealthCoordinator daemon: a single-owner in-memory state object (currentState) exposed over HTTP (GET /health, GET /health/state, POST /signals, POST /health/refresh) and refreshed on a 5s tick that iterates a check registry loaded from config/health-verification-rules.json. This is the concrete component behind the 'HealthCoordinator' label in the parent context, though the parent's observations (SemanticAnalysisAgent, OntologyClassificationAgent, BaseAgent lifecycle) describe an entirely different subsystem.

### Siblings
- [InjectionFlagSystem](./InjectionFlagSystem.md) -- [LLM] scripts/health-coordinator.js implements the InjectionFlagSystem directly: the module-level `injectionFlags` Map plus `shouldInject(kind)` function unify two fault-injection mechanisms — an in-memory flag set via POST /test/inject (loopback-gated) and the legacy `HEALTH_COORDINATOR_INJECT_THROW` env var — so any check site can query a single function regardless of which mechanism triggered it.
- [EtmExpectationTracking](./EtmExpectationTracking.md) -- [SESSION] Health Coordinator — ETM Reaper Logic notes this prevents false-positive stall/health warnings from raw wall-clock idle time and prevents crash-looping ETMs from showing falsely healthy due to missing session-key tracking.
- [ActiveTimeStallClock](./ActiveTimeStallClock.md) -- [LLM] The test file tests/integration/health-coordinator-etm-expected.test.mjs regex-matches flattened source of scripts/health-coordinator.js for the exact stall-clock update lines (`_obsActiveStallMs += sinceLastPoll`, `_obsStallAnchor` reset, `_obsStallPolledAt` diffing) rather than executing the coordinator, meaning the 'ActiveTimeStallClock' logic is pinned as literal source strings — a regression in these exact tokens (even a semantically equivalent rewrite) would fail CI even though behavior is unchanged.


---

*Generated from 10 observations*
