# Phase 63: Worker Lifecycle — Lazy Spawn, Idle Eviction, Crash Recovery & Cancellation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-21
**Phase:** 63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can
**Areas discussed:** Cancellation (WLIFE-04), Idle eviction (WLIFE-02), Crash recovery (WLIFE-03), Fold-in Phase-62 warnings

---

## Cancellation (WLIFE-04) — cancel mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| SIGTERM + respawn (dispose on abort) | Abort → SIGTERM worker, reject RETRYABLE, drop from pool, lazy cold respawn next request. Closes WR-05. Matches SC-4 "else SIGTERM+respawn". | ✓ |
| Hybrid: interrupt, then SIGTERM after grace | Try protocol interrupt, escalate to SIGTERM after a grace window. | |
| Discuss further | — | |

**User's choice:** SIGTERM + respawn (dispose on abort)
**Notes:** Driven by Phase-62 live evidence — the protocol `control_request{interrupt}` did NOT terminate the real stream (cancel test hung). → D-01.

## Cancellation (WLIFE-04) — stray-result correlation (WR-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Dispose-on-cancel makes it moot + add a guard | Disposed worker can't leak a result; add a monotonic request-generation check in _onEvent. | ✓ |
| Full request-id correlation | Tag each request with an id; only settle on matching id. | |
| Discuss further | — | |

**User's choice:** Dispose-on-cancel makes it moot + add a guard
**Notes:** → D-02. Consistent with the SIGTERM+respawn choice above.

## Idle eviction (WLIFE-02) — mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Per-worker unref'd idle timer | setTimeout reset on each settle, unref'd; on fire dispose+exit; lazy respawn. Default 30min. | ✓ |
| Periodic pool sweep | Single interval scans lastSettled timestamps. | |
| Discuss further | — | |

**User's choice:** Per-worker unref'd idle timer
**Notes:** → D-04/D-05. Reuses the reap path; no central loop; unref so it never keeps the proxy alive.

## Crash recovery (WLIFE-03) — persistently-broken-key guard

| Option | Description | Selected |
|--------|-------------|----------|
| Add crash cooldown → execFile overflow | Track consecutive failures per key; after threshold, route to execFile overflow for a cooldown. Plus EPIPE→crash guard (WR-01). | ✓ |
| Pure lazy-respawn is sufficient | Minimal; each crash drops worker, next request spawns once. Still add EPIPE guard. | |
| Discuss further | — | |

**User's choice:** Add crash cooldown → execFile overflow
**Notes:** → D-06/D-07. Reuses D-06 graceful degradation; protects against bad OAuth/flags hammering spawn. No auto-restart loop exists, so SC-3 is satisfied structurally.

## Fold-in Phase-62 warnings (WR-03/04/05)

User selected this area to fold the deferred lifecycle/cancellation review warnings into Phase 63. Captured as locked decisions (no separate question — they follow from the cancel design):
- WR-03 → D-03 (abort distinguishes in-flight vs queued request)
- WR-04 → D-08 (dispose() removes worker from pool array synchronously)
- WR-05 → D-02 (dispose-on-cancel + generation guard)

---

## Claude's Discretion
- Env-knob names (idle timeout, crash-cooldown threshold/window), crash-frequency data structure, request-generation counter representation, timer placement (worker vs pool). Consistent with Phase-62 discretion.
- WLIFE-01 (lazy spawn) is verify-only — already built in Phase 62; Phase 63 adds the missing cold-start `--live` test (D-09).

## Deferred Ideas
- WR-02 (recycle ceiling cache-inclusive sum) → Phase 64 hygiene.
- Real protocol cancel if a future claude CLI supports it → revisit D-01 to preserve warmth; not actionable now.
- 16 `todo.match-phase` matches reviewed, none folded (keyword false positives — obs-api/VKB/LSL/ontology, unrelated to the proxy worker pool).
