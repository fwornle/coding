# Phase 33: Health Monitoring Consolidation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-06
**Phase:** 33-health-monitoring-consolidation
**Areas discussed:** Signal Protocol, Compat Proxy Strategy, Rules Engine Fate, Session ID Derivation

---

## Signal Protocol

### Wire protocol

| Option | Description | Selected |
|--------|-------------|----------|
| HTTP POST per signal | Each reporter does `POST /signals` with JSON body. Idempotent, debuggable with curl, fits existing Express patterns. ~12 POSTs/min/reporter. | ✓ |
| WebSocket connection | Long-lived WS to coordinator. Lower per-signal overhead, but at 5s heartbeat the savings are negligible. Adds reconnect complexity. | |
| Coordinator polls reporters | Reporters expose health endpoints; coordinator pulls every 5s. Inverts ownership; loses 'one writer' simplicity. | |

**User's choice:** HTTP POST per signal (Recommended)

### URL discovery

| Option | Description | Selected |
|--------|-------------|----------|
| `HEALTH_COORDINATOR_URL` env var | Single env var, defaulted to `http://localhost:3034` on host and `http://host.docker.internal:3034` inside container. | ✓ |
| Hardcoded constant in shared lib | Define URL in lib/health-config.js. Less env-var sprawl, but port changes require code edit + redeploy. | |
| Launch arg from launchd / supervisord | Most explicit, most config locations to keep in sync. | |

**User's choice:** HEALTH_COORDINATOR_URL env var (Recommended)

---

## Compat Proxy Strategy

### Proxy strategy for `/api/health-verifier/*`

| Option | Description | Selected |
|--------|-------------|----------|
| In-container backend reverse-proxies to host | server.js handlers fetch host.docker.internal:3034 and reshape into existing JSON shape. Frontend dist/ unchanged. | ✓ |
| Frontend dist/ rebuilt to fetch host directly | Eliminates the proxy hop, but couples this phase to a frontend rebuild step. | |
| Coordinator writes a mirror file the container reads | Bind-mounted file reintroduces file-coupling SPEC explicitly forbids. | |

**User's choice:** In-container backend reverse-proxies to host (Recommended)

### Verify button behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Proxy to coordinator's force-tick | Dashboard backend forwards POST to coordinator's `POST /health/refresh`. Coordinator does immediate poll instead of waiting for next 5s tick. | ✓ |
| Make the button a no-op | POST returns the same JSON as GET. Removes a path; button visibly does nothing. | |
| Spawn a one-off verifier in the container (today) | Defeats the SoT. Strongly discouraged. | |

**User's choice:** Proxy to coordinator's force-tick (Recommended)

---

## Rules Engine Fate

### Rules consumer

| Option | Description | Selected |
|--------|-------------|----------|
| Coordinator consumes rules directly | Coordinator reads health-verification-rules.json on startup; each enabled rule becomes a registered check on the 5s tick. One process owns both data flow AND rule evaluation. | ✓ |
| Rules engine becomes a dedicated reporter | health-verifier.js stays alive (reduced) as rules-engine reporter that POSTs results to coordinator's /signals. Separation of concerns; another process. | |
| Drop rules engine; hardcode coordinator checks | Coordinator has fixed in-code list of checks. Violates SPEC R8 (schema preservation). | |

**User's choice:** Coordinator consumes rules directly (Recommended)

### Rule scope (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| DELETE `bind_mount_freshness` rule | Heal action (force-recreate) cannot fix the macOS Docker virtiofs cause. Single biggest source of churn. | ✓ |
| REMOVE in-container `health-verifier` from `supervisord_status.expected_processes` | In-container health-verifier is intentionally autostart=false. Ratifies the disable in config. | ✓ |
| DROP container-process supervision from host coordinator entirely | Coordinator stops calling docker exec supervisorctl. Container internal-process health delegated to Docker's healthcheck + the in-container dashboard URL. Loses fine-grained "which process inside container is dead" visibility from /health/state. | ✓ |
| KEEP supervisord_status check, fix the consumer | Coordinator continues to read in-container supervisord status, only flag FATAL/BACKOFF as critical. Keeps visibility. | |

**User's choice:** DELETE bind_mount_freshness + REMOVE health-verifier from expected_processes + DROP container-process supervision

**Notes:** User briefly paused after the multi-select to clarify the implication that "drop container-process supervision entirely" is a meaningful loss of fine-grained visibility (Docker's overall healthcheck remains, but per-supervisorctl-program detail moves to the in-container dashboard URL only). User confirmed via "resume" — the loss is acceptable; the dashboard's own backend can still expose per-program status when its UI demands it, and SPEC R7's narrow-auto-heal goal explicitly prefers Docker-driven container restart over host-driven supervisorctl gymnastics.

---

## Session ID Derivation

### Session ID source

| Option | Description | Selected |
|--------|-------------|----------|
| Use existing CLAUDE_SESSION_ID / SESSION_ID env | bin/coding sets these (e.g. claude-60474-1777723363). No new id machinery; matches value already in tmux env. | ✓ |
| Coordinator generates UUID at first signal | Reporter posts intro signal; coordinator returns UUID v4; reporter caches it. Reporter restart loses the id. | |
| Hybrid: env var if set else generate | Most robust; small extra fallback logic. | |

**User's choice:** Use existing CLAUDE_SESSION_ID / SESSION_ID env (Recommended)

### Session expiry

| Option | Description | Selected |
|--------|-------------|----------|
| Stay 'stopped' for 5 min then evict | When heartbeat is >15s stale, mark stopped but keep visible. After 5 min stopped, drop. | ✓ |
| Evict immediately on staleness | As soon as heartbeat >15s old, remove from /health/state.lsl. Momentary blip causes session to disappear. | |
| Never evict; keep all sessions forever | Full audit trail. /health/state grows unbounded. | |

**User's choice:** Stay 'stopped' for 5 min then evict (Recommended)

---

## Claude's Discretion

The following lower-impact decisions were intentionally NOT pinned in discussion; the planner / researcher will recommend defaults:

- Coordinator state durability (in-memory recommended over JSON checkpoint or SQLite)
- Test harness shape for two-session test (bash vs node:test vs Jest)
- launchd plist relaunch policy (KeepAlive=true, ThrottleInterval=30 — standard)
- Log rotation in the new coordinator (reuse Phase A's 10 MB inline rotation pattern)
- Coordinator language/runtime (Node.js 22 ESM with Express — project default)

## Deferred Ideas

- LSL hour-rollover redesign (Phase A applied tactical fix; long-term redesign is its own phase)
- Sub-second / event-driven health detection (inotify, supervisord event listener, docker events) — explicitly out of scope per SPEC
- Encryption / authn on /health/state — future phase if non-local consumers ever appear
- Bind-mount freshness as a WARNING-only rule — D-06 deletes the rule entirely; can be reintroduced if the bug returns as a real concern
- Statusline cache file format redesign — SPEC frees us to rewrite; could surface per-session state in tmux ("[LSL: 1/2 sessions live]")
- Consolidating PSM into the coordinator — PSM has unique LevelDB-lock concerns; folding is a follow-up design question
