---
phase: 33-health-monitoring-consolidation
plan: 12
subsystem: launchd-environment
tags: [gap-closure, launchd, plist, env-propagation, injection-test, rule4-deviation, blocked]
status: blocked-on-architectural-decision
gap_closure: true
closes_gaps: []  # G7 NOT closed — plist approach empirically fails
attempted_gaps: [G7]

requires:
  - phase: 33-08
    provides: G7 surfaced — `launchctl setenv` not propagating into kickstart-respawned coordinator. Plan 33-12 hypothesized that declaring the env key in the plist's EnvironmentVariables dict with an empty default would let setenv override it.

provides:
  - Empirical evidence that the plan's plist-declaration hypothesis is INCORRECT on macOS Darwin 25.4.0 (Sequoia)
  - Updated plist at `~/Library/LaunchAgents/com.coding.health-coordinator.plist` declaring INJECT_THROW + TICK_MS + URL — does not break anything, but also does not unblock AC#13
  - Architectural decision required: switch injection vector to a NON-launchctl mechanism (POST `/test/inject` endpoint OR marker file OR test-only `kind` on `/signals`)
  - Diagnostics: `launchctl print` output, `ps eww` output, isolated reproduction with a one-shot test plist proving the precedence rule

affects:
  - SPEC AC#13 — still FAILS, gap G7 still open
  - 33-VERIFICATION.md — needs an addendum noting that option (a) from G7's fix-options inventory does NOT work on this macOS; pick option (b) or (c)

tech-stack:
  added: []
  patterns:
    - "Empirical-first verification: planner's hypothesis was tested against reality with a minimal one-shot launchd plist before declaring victory or defeat. Saved hours of confused debugging downstream."

key-files:
  created:
    - .planning/phases/33-health-monitoring-consolidation/33-12-SUMMARY.md
  modified:
    - ~/Library/LaunchAgents/com.coding.health-coordinator.plist  # NOT git-tracked; per-machine
  deleted: []

key-decisions:
  - "Rule 4 architectural deviation: switching injection vector requires user decision — STOP, return checkpoint:decision."
  - "Did NOT revert the plist edit. The new plist declares 3 additional env vars with empty-string defaults. None of them break anything (coordinator code's `(env || 'fallback')` and `.split(',').filter(Boolean)` all handle empty strings correctly). If the user picks option (b) or (c), the extra plist declarations become dead config — harmless but stale."
  - "Coordinator left alive (PID 48732, /health → 200) with `.databases.status=healthy`, `launchctl getenv HEALTH_COORDINATOR_INJECT_THROW` empty — clean baseline."

requirements-completed: []
# R6 (no silent fallback to healthy) NOT completed — injection harness still cannot exercise it
# R9 (single-process supervision) NOT regressed — coordinator KeepAlive still works (verified during reload cycle)

# Metrics
duration: ~25min
attempted: 2026-05-07
tasks_completed: 0   # Task 1 attempted but FAILED the propagation acceptance criterion
tasks_pending: 3     # Task 1 (re-attempt with different vector), Task 2, Task 3
files_created: 1     # this SUMMARY
files_modified: 1    # plist (out-of-tree; not committed)
total_commits: 1     # this SUMMARY commit only
---

# Phase 33 Plan 12: Plist Env-Var Propagation Fix — BLOCKED on Rule 4 Deviation

**Plan's hypothesis empirically falsified: declaring `HEALTH_COORDINATOR_INJECT_THROW` in the plist's `EnvironmentVariables` dict (with empty default) does NOT let `launchctl setenv` override it. macOS launchd's plist-declared values WIN over domain-level setenv. AC#13 still FAILS. Switching injection vector requires user decision (Rule 4).**

## Performance

- **Duration:** ~25 min (Task 1 attempt + diagnostic verification + isolated reproduction)
- **Started:** 2026-05-07T08:50:00Z (approx, executor spawn)
- **Halted at:** 2026-05-07T09:04:30Z (Task 1 propagation criterion FAIL → Rule 4 stop)
- **Tasks attempted:** 1 (Task 1 — partial; mechanical edit OK, behavioral acceptance FAIL)
- **Tasks not run:** Task 2 (blocked by Task 1), Task 3 (blocked by Task 1)
- **Files created (in repo):** 1 (this SUMMARY)
- **Files modified (out-of-tree):** 1 (`~/Library/LaunchAgents/com.coding.health-coordinator.plist`)

## What Was Done — Task 1 (Partial)

### 1a. Plist edit + plutil lint — PASS

- Captured pre-state: PID 17627, `ps eww` env contained only `HEALTH_COORDINATOR_PORT=3034` (and PATH).
- Wrote new plist at `~/Library/LaunchAgents/com.coding.health-coordinator.plist` exactly per plan spec, declaring `HEALTH_COORDINATOR_INJECT_THROW`, `HEALTH_COORDINATOR_TICK_MS`, `HEALTH_COORDINATOR_URL` with empty-string defaults.
- `plutil -lint` → `OK`.
- SHA before: `d1210d7c574316...`
- SHA after:  `b42bd5f50281ef...`
- `grep -c 'HEALTH_COORDINATOR_INJECT_THROW' ~/Library/LaunchAgents/com.coding.health-coordinator.plist` → 1 (matches AC).

### 1b. Bootout + bootstrap cycle — PASS

```
launchctl bootout "gui/$UID/com.coding.health-coordinator"  # clean
sleep 2; (no process, expected)
launchctl bootstrap "gui/$UID" ~/Library/LaunchAgents/com.coding.health-coordinator.plist
sleep 4
launchctl list | grep com.coding.health-coordinator
  → 44064  0  com.coding.health-coordinator
curl -sf http://localhost:3034/health
  → {"status":"ok","port":3034,"role":"health-coordinator"}
```

`launchctl print "gui/$UID/com.coding.health-coordinator"` confirmed the new plist's environment dict was loaded:
```
environment = {
    OSLogRateLimit => 64
    HEALTH_COORDINATOR_PORT => 3034
    HEALTH_COORDINATOR_URL =>
    HEALTH_COORDINATOR_TICK_MS =>
    PATH => /opt/homebrew/bin:/usr/local/bin:/usr/bin:/usr/sbin:/bin:/sbin
    HEALTH_COORDINATOR_INJECT_THROW =>
    XPC_SERVICE_NAME => com.coding.health-coordinator
}
```

`ps eww` on the running process shows the same 4 declared keys, all with their plist defaults (the three new ones empty).

### 1c. Setenv + kickstart propagation test — **FAIL**

This is the criterion the whole plan exists to satisfy:
> "After `launchctl setenv HEALTH_COORDINATOR_INJECT_THROW db_health` + kickstart, `ps eww -p $(pgrep -f health-coordinator.js | head -1) | tr ' ' '\n' | grep '^HEALTH_COORDINATOR_INJECT_THROW=db_health'` returns 1 match"

Actual behavior:

```bash
launchctl setenv HEALTH_COORDINATOR_INJECT_THROW db_health
launchctl getenv HEALTH_COORDINATOR_INJECT_THROW
  → db_health      # domain env IS set

launchctl kickstart -k "gui/$UID/com.coding.health-coordinator"
sleep 8
PID=$(pgrep -f health-coordinator.js | head -1)   # 45439

ps eww -p 45439 | tr ' ' '\n' | grep '^HEALTH_COORDINATOR_INJECT_THROW='
  → HEALTH_COORDINATOR_INJECT_THROW=          # EMPTY — NOT db_health

launchctl print "gui/$UID/com.coding.health-coordinator" | grep INJECT_THROW
  →     HEALTH_COORDINATOR_INJECT_THROW =>    # service env shows empty
```

The plist's empty-string default **wins** over the domain setenv. Result: `grep` returns 0 matches, AC fails.

Variant tested: `launchctl bootout` first, `launchctl setenv` second, `launchctl bootstrap` third (in case set-before-bootstrap matters) — same empty result. Service env is locked to plist-declared values regardless of when domain setenv happened.

### 1d. Isolated reproduction — confirms launchd precedence rule

Wrote a one-shot test plist at `/tmp/33-12-test-plist.plist` that:
- Declares `HEALTH_COORDINATOR_INJECT_THROW = "PLIST_DEFAULT_VALUE"` (non-empty)
- ProgramArguments runs `printenv HEALTH_COORDINATOR_INJECT_THROW > /tmp/33-12-test-out.txt`
- RunAtLoad=true

Procedure:
```bash
launchctl setenv HEALTH_COORDINATOR_INJECT_THROW DOMAIN_OVERRIDE_VALUE
launchctl getenv HEALTH_COORDINATOR_INJECT_THROW   → DOMAIN_OVERRIDE_VALUE
launchctl bootstrap "gui/$UID" /tmp/33-12-test-plist.plist
sleep 2
cat /tmp/33-12-test-out.txt
  → PLIST_DEFAULT_VALUE
  → (exit)
```

**Definitive proof:** plist-declared value wins over domain `launchctl setenv` on this macOS (Darwin 25.4.0 / macOS Sequoia 15.x). The plan's option (a) from the G7 fix-options inventory is INCORRECT for this OS version.

(Test plist deleted after.)

### 1e. Cleanup + final state

```
launchctl unsetenv HEALTH_COORDINATOR_INJECT_THROW
launchctl getenv HEALTH_COORDINATOR_INJECT_THROW    → (empty)
launchctl kickstart -k "gui/$UID/com.coding.health-coordinator"
sleep 12  (wait 2 ticks for steady-state)
PID = 48732
curl -sf http://localhost:3034/health   → 200
.databases.status = "healthy"
.databases.qdrant.available = true
.databases.levelDB.available = true
```

Coordinator is alive and healthy; system is in a clean baseline. The plist is the modified version (with the 3 extra empty-default keys); reverting would require another bootout+bootstrap.

## Why The Hypothesis Failed (Diagnosis)

The 33-12 plan's hypothesis section read:

> Once a key is declared in the plist's dict, `launchctl setenv <KEY> <value>` overrides the empty default and the value reaches the child process at next kickstart.

This hypothesis was rooted in conventional Unix env-precedence intuition (more-specific-overrides-less-specific). Empirically, **macOS launchd applies the OPPOSITE rule for plist-declared keys**: a `<key>NAME</key><string>VAL</string>` pair in `EnvironmentVariables` is a HARD declaration; domain `launchctl setenv NAME` cannot override it.

Domain setenv DOES propagate to child processes in two cases (verified earlier in 33-08 and reconfirmed indirectly here):
1. The plist has NO `EnvironmentVariables` dict at all (launchd uses domain env wholesale)
2. The plist's `EnvironmentVariables` dict does NOT mention the key (per 33-08, evidence was inconsistent — sometimes the inheritance worked, sometimes not; this is what 33-08 called "not consistently merged")

But once the key is declared, the plist value is sticky. So the plan's "declare with empty default" approach actively DEFEATS what we want: it converts an inconsistently-inherited key into a guaranteed-empty key.

## Architectural Decision Required (Rule 4 Stop)

Three viable alternatives from the G7 fix-options inventory in `33-08-SUMMARY.md`:

### Option A — Test-only debug HTTP endpoint (recommended)

Add `POST /test/inject` to `scripts/health-coordinator.js`, guarded by `NODE_ENV=test` (which the plist CAN set reliably) or by a localhost-only check. Body: `{"checks":["db_health","services"]}` → coordinator stores list in module-level `INJECT_THROW` array.

**Pros:** Self-contained; no launchd interaction; trivially testable; cleanup is just `POST /test/inject {"checks":[]}`. No plist editing required.

**Cons:** Adds a debug surface (mitigated by NODE_ENV gate or 127.0.0.1-only listener).

### Option B — Marker file polled by coordinator

Coordinator polls `~/.coding/inject-throw` (or similar) every tick; if present, reads it as the comma-separated list. Test harness writes/deletes the file.

**Pros:** No HTTP, no env vars, no launchd interaction.

**Cons:** New side-channel state on disk; tick-cadence delay before injection takes effect; cleanup is "delete the file."

### Option C — Test-only `kind` on POST `/signals`

Reuse the existing POST `/signals` endpoint with `kind: "test_inject_throw"` payload that flips the in-memory INJECT_THROW list.

**Pros:** Reuses an existing endpoint; same auth surface as production signals.

**Cons:** Mixes test-only behavior into production signal pipeline; needs `NODE_ENV=test` or similar gate to ignore in production.

### NOT viable

- Option D (plan's choice — declare in plist with empty default): **PROVEN to NOT work on this macOS.**
- Option E (declare in plist with `db_health` default literally): would make the coordinator permanently unhealthy. Useless.
- Option F (remove the EnvironmentVariables dict entirely so launchd inherits domain env wholesale): regresses `HEALTH_COORDINATOR_PORT=3034` and `PATH` declarations the production system depends on — risky.

## Deviations from Plan

### Auto-fixed Issues

(none — Task 1 mechanical steps all worked, the failure is at the design level)

### Rule 4 — Architectural

**1. [Rule 4] Plan's option (a) injection-vector hypothesis empirically falsified**

- **Found during:** Task 1 verification step — `ps eww` after `launchctl setenv` + `launchctl kickstart -k`
- **Issue:** Declaring `HEALTH_COORDINATOR_INJECT_THROW` in plist's EnvironmentVariables dict with empty default does NOT let `launchctl setenv` override it. Plist value is sticky on macOS Darwin 25.4.0.
- **Verification:** Three independent tests:
  1. Live coordinator: setenv → kickstart → `ps eww` shows empty INJECT_THROW
  2. Live coordinator (variant): bootout → setenv → bootstrap → `ps eww` shows empty INJECT_THROW
  3. Isolated minimal-repro plist: setenv `DOMAIN_OVERRIDE_VALUE`, plist declares `PLIST_DEFAULT_VALUE`, child sees `PLIST_DEFAULT_VALUE` (plist wins)
- **Action proposed:** Stop, return `checkpoint:decision` with three options (A/B/C above). User picks the injection vector; a follow-up plan implements it.
- **Files NOT reverted:** plist still has the 3 extra empty-default keys. Reverting would require another bootout+bootstrap cycle and is harmless to leave (per "key-decisions" #2).
- **Committed in:** N/A (this SUMMARY commit only — no code changes)

## Acceptance Criteria — Per Plan

| AC | Status | Notes |
|---|---|---|
| `plutil -lint` exits 0 | PASS | `OK` |
| `grep -c HEALTH_COORDINATOR_INJECT_THROW plist` ≥ 1 | PASS | 1 |
| `launchctl list \| grep com.coding.health-coordinator` returns 1 | PASS | Single entry post-bootstrap |
| After setenv+kickstart, `ps eww` shows `HEALTH_COORDINATOR_INJECT_THROW=db_health` | **FAIL** | Always empty (plist wins) |
| `curl -sf http://localhost:3034/health` 200 | PASS | Coordinator alive after reload |
| AC#11 sanity (kill -9 → respawn) | NOT TESTED | Skipped — KeepAlive untouched, no risk-add from plist edit; AC#11 will be re-validated in a future plan that actually closes G7 |
| Task 2: `injection.test.sh` PASS | NOT RUN | Blocked by Task 1 propagation failure |
| Task 2: AC#13 manual `db_health` repro PASS | NOT RUN | Same |
| Task 2: cleanup OK | N/A | Already cleaned up domain env; final `getenv` empty |
| Task 3: human-verify | NOT REACHED | Plan's premise invalidated; different checkpoint type returned |

## Final State

| Attribute | Value |
|---|---|
| Coordinator PID | 48732 |
| Coordinator HTTP /health | 200 OK |
| `.databases.status` | `healthy` |
| `launchctl getenv HEALTH_COORDINATOR_INJECT_THROW` | (empty) |
| Plist on disk | NEW (modified — has 3 extra empty-default keys) |
| Plist git-tracked? | NO — `~/Library/LaunchAgents/` is per-machine |
| Domain env clean? | YES |
| Phase 33 G7 status | STILL OPEN |
| Phase 33 AC#13 status | STILL FAILS |

## PID History During Attempt

| Step | PID | Notes |
|---|---|---|
| Initial state (executor spawn) | 17627 | Pre-edit; old plist loaded |
| After bootout + bootstrap (1b) | 44064 | New plist loaded; clean reload |
| After setenv + kickstart (1c) | 45439 | Env var still empty in process |
| After 2nd bootout + bootstrap (1c-variant) | 46752 | Env var still empty |
| Final (after unsetenv + kickstart) | 48732 | Clean baseline |

## Self-Check: PASSED

| Artifact | Status |
|---|---|
| 33-12-SUMMARY.md exists | FOUND (this file) |
| Plist edited, plutil OK | FOUND (sha b42bd5f5...) |
| Coordinator HTTP /health 200 at end | FOUND (curl exit 0) |
| Domain env cleaned (`launchctl getenv` empty) | FOUND |
| Empirical falsification of plan's hypothesis documented | FOUND (3 independent tests) |
| Three alternative architectures listed for user | FOUND (Options A/B/C) |
| No source files modified in repo | VERIFIED — only `.planning/...` SUMMARY |
| STATE.md / ROADMAP.md NOT updated | VERIFIED — orchestrator-owned per spawn instructions |

## Next Step

Return **checkpoint:decision** to orchestrator with the three alternative injection vectors. User picks A, B, or C; orchestrator either authors a follow-up plan or amends 33-12 with the new vector and respawns the executor.

---

*Phase: 33-health-monitoring-consolidation*
*Plan 12: BLOCKED — empirical Rule 4 architectural deviation*
*Halted: 2026-05-07*
