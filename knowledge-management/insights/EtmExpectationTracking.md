# EtmExpectationTracking

**Type:** Detail

## What It Is

EtmExpectationTracking is implemented inside `scripts/health-coordinator.js`, as part of the broader HealthCoordinator daemon, centered on a module-level in-memory map called `_etmExpected`. It exists to solve a specific gap in the health rollup: `lsl_by_project` (the coordinator's per-project status ledger) only reflects sessions that have already heartbeated, so a project whose ETM (Enhanced Transcript Monitor) crash-loops on startup contributes no key at all — and every downstream consumer (prompt hook, statusline, dashboard) treats an absent key as "healthy." `_etmExpected` is a second, independent ledger recording which projects *ought* to have a running ETM, checked against the rollup regardless of whether one ever actually reported in.

Its exact behavior is pinned not by unit-testing the coordinator directly but by `tests/integration/health-coordinator-etm-expected.test.mjs`, a source-contract test suite that regex-matches a whitespace-flattened dump of the coordinator's source rather than importing and executing it.

## Architecture and Design

The core pattern is a **shadow expectation ledger**: rather than inferring health purely from what reported in, the system maintains a parallel record of what *should* exist, and cross-checks it against the rollup. This is paired with **activity-gated recording** — an expectation is added to `_etmExpected` only after passing a real activity gate (`if (!targeted && !transcriptFresh && !tmuxAlive && !hasOpenCode)`), never on mere directory existence. The test `'an expectation is recorded only after the activity gate, never before it'` asserts via `src.indexOf` that `_etmExpected.set(` textually follows this gate check, encoding the failure mode it prevents: unconditional recording would make every directory under `~/Agentic` a permanent alarm.

A second key pattern is **scope-aware mutation**: pruning of `_etmExpected` is gated on `!only`, meaning stale entries are only swept during a full health sweep, never during a targeted single-project poll. This symmetric design prevents two opposite failures — a closed session reporting "missing" forever if never pruned outside a full sweep, and a narrow launcher request wiping every other project's expectation if pruning weren't scope-restricted.

Thresholds are **derived, not literal**: `ETM_MISSING_MS = N * ETM_SPAWN_INTERVAL_MS`, with `N >= 2`, tying the missing-timeout directly to the spawner's own cadence so the two can't drift independently out of sync — a just-spawned ETM under two intervals old is not yet considered missing.

Finally, rollup construction follows **fail-open precedence**: `if (name in rollup) continue;` ensures an existing verdict (e.g., "degraded") is never downgraded/overwritten by the expectation check's "missing" label — expectation tracking only fills gaps left by silence, never contradicts a stronger existing signal.

## Implementation Details

Two exit paths remove entries from `_etmExpected`, each independently tested. First, reaping: `'reaping an ETM forgets its expectation'` verifies `_etmExpected.delete(e.projectName)` appears within 600 characters after `_reapedProjects.set(e.projectName, Date.now())` — when the reaper (documented under the sibling-adjacent "Enhanced Transcript Monitor (ETM) Process Management" work) declares a tmux session dead, its expectation is cleared in the same stroke, preventing a false "missing" alarm roughly 90 seconds later. Second, healthy clearance: `if (rollup[name] === 'healthy') { _etmExpected.delete(name); continue; }` removes the expectation once a project self-reports healthy, so the shadow ledger doesn't accumulate stale entries for well-behaved projects.

The "missing" assignment itself is conditional and non-destructive: `if (name in rollup) continue; if (now - exp.since > ETM_MISSING_MS) rollup[name] = 'missing';` — only entries absent from the rollup, and only after exceeding the derived timeout, get labeled.

Because the coordinator's real behavior depends on a running 5-second tick loop and HTTP surface, the test suite substitutes source-contract testing for behavioral testing, matching exact string patterns and structural orderings in the flattened source rather than executing the daemon.

## Integration Points

EtmExpectationTracking is one part of `scripts/health-coordinator.js`, sitting alongside sibling mechanisms in the same file: **LslSessionStalenessTracking** (which manages `HEARTBEAT_STALENESS_MS`/`EVICT_AFTER_STOPPED_MS` two-stage decay for LSL sessions), **InjectionFlagSystem** (fault injection via `shouldInject`), and **ActiveTimeStallClock**, which is structurally separate but shares the same motivating principle — don't let raw elapsed wall-clock time substitute for a real health signal. The stall clock advances `_obsActiveStallMs` only when `currentState.user_active === true`, using `Math.max(0, now - _obsStallPolledAt)` to compensate for delayed ticks, explicitly rejecting a `obsAge > OBS_STALL_MS` wall-clock check that would "trip the alarm again" every night.

Upstream, EtmExpectationTracking depends on the reaper logic (documented in the "Health Coordinator — ETM Reaper Logic" and "ETM Process Management" work records) to decide when an ETM is truly dead; the reaper's deletion from `_reapedProjects` is the trigger that must coincide with expectation clearance. Downstream, the rollup it augments feeds the prompt hook, statusline, and dashboard — all consumers that would otherwise silently treat absent keys as healthy.

## Usage Guidelines

Any change to the activity gate, the `!only` pruning condition, or the reap/healthy deletion paths must preserve their textual ordering and structure, since the test suite verifies these via `indexOf` and regex on flattened source rather than runtime behavior — a semantically equivalent rewrite can still fail CI. Do not decouple `ETM_MISSING_MS` from `ETM_SPAWN_INTERVAL_MS`; the multiplier-based derivation exists specifically to prevent the missing-threshold from drifting independently of spawn cadence and flagging legitimate startup delay. When modifying pruning logic, preserve the full-sweep-only scope — applying it during targeted polls would produce wide, destructive side effects from narrow requests. Treat `_etmExpected` and the stall clock as separate state machines even though they share a design philosophy; conflating them risks losing the fail-open precedence guarantee that keeps a stronger "degraded" signal from being overwritten by a weaker "missing" inference.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Health Coordinator — ETM Reaper Logic notes this prevents false-positive stall/health warnings from raw wall-clock idle time and prevents crash-looping ETMs from showing falsely healthy due to missing session-key tracking.
- Per the work record 'Health Coordinator — ETM Reaper Logic', the reaper exists to prevent two distinct false-positive classes: raw wall-clock idle time producing false stall/health warnings, and crash-looping ETM processes appearing falsely 'green' because they lack session-key tracking. This is the operational justification for pairing `_etmExpected` (catches ETMs that never appear) with the reap-on-death path (catches ETMs that appear then die) — together they close the gap a heartbeat-only rollup leaves open.
- Per the work record 'Enhanced Transcript Monitor (ETM) Process Management', the coordinator's tmux-session reaping exists specifically to stop orphaned ETM processes from persisting indefinitely when the underlying agent process died, was never launched, has no attached panes, or is fully detached — without it, ETMs and statusline dots 'pin forever'. This is the upstream condition that `_etmExpected`'s reap-clears-expectation behavior (observation 4 above) is downstream of: the reaper decides an ETM is dead, and expectation tracking must stop treating its absence as an alarm at the same moment.

## Hierarchy Context

### Parent
- [HealthCoordinator](./HealthCoordinator.md) -- [LLM] scripts/health-coordinator.js implements the actual HealthCoordinator daemon: a single-owner in-memory state object (currentState) exposed over HTTP (GET /health, GET /health/state, POST /signals, POST /health/refresh) and refreshed on a 5s tick that iterates a check registry loaded from config/health-verification-rules.json. This is the concrete component behind the 'HealthCoordinator' label in the parent context, though the parent's observations (SemanticAnalysisAgent, OntologyClassificationAgent, BaseAgent lifecycle) describe an entirely different subsystem.

### Siblings
- [InjectionFlagSystem](./InjectionFlagSystem.md) -- [LLM] scripts/health-coordinator.js implements the InjectionFlagSystem directly: the module-level `injectionFlags` Map plus `shouldInject(kind)` function unify two fault-injection mechanisms — an in-memory flag set via POST /test/inject (loopback-gated) and the legacy `HEALTH_COORDINATOR_INJECT_THROW` env var — so any check site can query a single function regardless of which mechanism triggered it.
- [LslSessionStalenessTracking](./LslSessionStalenessTracking.md) -- [LLM] scripts/health-coordinator.js implements the actual staleness/eviction thresholds for LSL sessions: `HEARTBEAT_STALENESS_MS = 15_000` marks a session 'stopped' after 15s without a heartbeat, and `EVICT_AFTER_STOPPED_MS = 5 * 60 * 1000` drops it from `currentState.lsl` after 5 minutes in that state (both tagged D-10 in the header comment). This is a two-stage decay rather than a single timeout: a session first degrades to a visible-but-stopped status so consumers can still show 'last seen N ago', and only later disappears entirely, which keeps the dashboard/statusline from flapping a session straight to 'gone' on a single missed beat.
- [ActiveTimeStallClock](./ActiveTimeStallClock.md) -- [LLM] The test file tests/integration/health-coordinator-etm-expected.test.mjs regex-matches flattened source of scripts/health-coordinator.js for the exact stall-clock update lines (`_obsActiveStallMs += sinceLastPoll`, `_obsStallAnchor` reset, `_obsStallPolledAt` diffing) rather than executing the coordinator, meaning the 'ActiveTimeStallClock' logic is pinned as literal source strings — a regression in these exact tokens (even a semantically equivalent rewrite) would fail CI even though behavior is unchanged.


---

*Generated from 12 observations*
