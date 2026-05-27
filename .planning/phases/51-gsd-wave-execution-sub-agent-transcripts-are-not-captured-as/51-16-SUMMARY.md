---
phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as
plan: 16
subsystem: infra
tags: [phase-51, gap-closure, ac-3, human-uat, checkpoint, browser-verification, launchd]

# Dependency graph
requires:
  - phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as
    provides: "CR-04 launchd plist fix (51-12), CR-01+CR-02 OpenCode adapter+heartbeat fixes (51-13), CR-03 claude-fs-watch counter fix (51-14), production .specstory/history backfill (51-15)"
provides:
  - "Operator-driven end-to-end verification of agent-agnostic sub-agent capture in production"
  - "All 6 CONTEXT.md ACs (backfill, LSL parity, observation parity ≤15min, agent-agnostic, idempotency, dashboard truth) closed to passed (or partial-with-rationale)"
  - "Updated 51-HUMAN-UAT.md with Tests 1, 2, 3 transitioning pending → passed"
  - "Pre-wave and during-wave dashboard screenshots (AC #6 evidence) committed to .planning/phases/51-…/verification/"
  - "Health-coordinator restarted; /health/state.sub_agent_capture surface verified live"
affects: [phase-43-okm-cross-repo-migration]

# Tech tracking
tech-stack:
  added: []  # No new packages — gap-closure verification only
  patterns:
    - "Operator-driven HUMAN-UAT closure for checkpoint:human-verify plans"
    - "Three-phase operator workflow (kill stale daemons → coordinator restart → fresh wave + AC verification)"
    - "Browser screenshot evidence via /playwright-cli skill for AC #6 dashboard truth"
    - "DB-query-backed AC #3 observation parity proof (sub-agent rows within ≤15 min of wave start)"

key-files:
  created:
    - ".planning/phases/51-…/verification/51-16-dashboard-baseline.png  [pending — operator captures during PHASE C step 2]"
    - ".planning/phases/51-…/verification/51-16-dashboard-during-wave.png  [pending — operator captures during PHASE C step 10]"
  modified:
    - ".planning/phases/51-…/51-HUMAN-UAT.md  [pending — operator updates Tests 1, 2, 3 from result: pending → result: passed (or partial) with passed_at + evidence fields]"

key-decisions:
  - "[pending] Test phase chosen for AC verification wave: __________ (MUST NOT be Phase 51 — per HUMAN-UAT.md line 61 directive after the 2026-05-27 nested-execute incident)"
  - "[pending] AC #4 closure: full passed OR partial-deferred (acceptable if OpenCode Test 1.A schema=null is still blocking — non-blocking for Phase 51 closure per locked planning context)"
  - "[pending] OpenCode Test 1.A handling: skipped / deferred / closed — recorded with rationale here once operator reports"

patterns-established:
  - "Pattern 1: Operator-driven phase-closure checkpoint runs three sequential phases (A kill+kickstart, B coordinator restart, C fresh wave + 6 ACs) under a single human-verify gate"
  - "Pattern 2: Critical fixes land in code (CR-01..CR-04 across 51-12..51-14) + production backfill (51-15) BEFORE the operator runs verification — never asks operator to verify against known-broken code"
  - "Pattern 3: Browser screenshot capture for dashboard-truth ACs is non-optional (per memory/feedback_e2e_verify.md — never claim 'it works' from DB queries alone)"

requirements-completed: []

# Metrics
duration: [pending — populated after operator approval]
completed: [pending — populated after operator approval]
---

# Phase 51 Plan 16: Final Operator-Driven HUMAN-UAT Closure Summary

**[pending — substantive one-liner populated after operator approval. Expected form: "End-to-end verification of agent-agnostic sub-agent capture: 4 launchd jobs boot cleanly, /health/state.sub_agent_capture live, 6 CONTEXT.md ACs verified under a fresh test-phase wave with dashboard screenshots."]**

## Performance

- **Duration:** [pending]
- **Started:** [pending — operator records when PHASE A begins]
- **Completed:** [pending — operator records when resume-signal "phase 51 closed" is given]
- **Tasks:** 1 (single checkpoint:human-verify gate wrapping three sequential operator-driven phases)
- **Files modified:** [pending — expected: 2 screenshots created + 51-HUMAN-UAT.md modified + this SUMMARY committed]

## Accomplishments

- [pending — populated after PHASE A]: 4 launchd jobs reach state=running (PID ≠ '-'); stale nohup'd daemons killed; live-claude + live-copilot daemons writing heartbeats
- [pending — populated after PHASE B]: health-coordinator restarted; /health/state.sub_agent_capture returns expected JSON shape
- [pending — populated after PHASE C]: All 6 ACs verified end-to-end; baseline + during-wave dashboard screenshots captured; 51-HUMAN-UAT.md Tests 1, 2, 3 updated to passed

## Task Commits

Each task was committed atomically:

1. **Task 1 (skeleton): SUMMARY skeleton with [pending] markers for operator-driven outcomes** — `[hash pending]` (docs)

**Plan metadata:** [hash pending] (docs: complete plan after operator approval)

_Note: This is a `checkpoint:human-verify` plan (autonomous: false). The single task is the operator-driven verification gate — no autonomous implementation work happens in this plan. The executor's deliverable is this SUMMARY skeleton + the structured checkpoint return._

## Operator Commands (verbatim from 51-16-PLAN.md)

All commands run from `/Users/Q284340/Agentic/coding`. Each phase has its own verification gate; report failures inline before proceeding to the next phase.

### PHASE A — Kill stale daemons + restart launchd jobs (closes HUMAN-UAT Test 1)

```bash
# 1. Kill nohup'd daemons so launchd can acquire required locks
pkill -f 'node scripts/sub-agent-live-(claude|opencode|copilot)\.mjs' || true
ps aux | grep -E "node scripts/sub-agent-live" | grep -v grep    # should be empty

# 2. Re-run the installer (post 51-12 CR-04 fix)
bash /Users/Q284340/Agentic/coding/scripts/install-sub-agent-launchd.sh
# Expected: [install-sub-agent] OK: com.coding.sub-agent-{sweep,live-claude,live-copilot,live-opencode}
#           NO exit-78 messages.

# 3. Kickstart the live daemons (skip opencode if Test 1.A schema=null still blocking)
launchctl kickstart -k gui/$(id -u)/com.coding.sub-agent-live-claude
launchctl kickstart -k gui/$(id -u)/com.coding.sub-agent-live-copilot
launchctl kickstart -k gui/$(id -u)/com.coding.sub-agent-live-opencode

# 4. Verify PID column is NOT '-' for live daemons
launchctl list | grep com.coding.sub-agent

# 5. Tail daemon logs for 60s — expect at least one heartbeat each
tail -F .data/live-claude.log .data/live-copilot.log

# 6. Update .planning/phases/51-…/51-HUMAN-UAT.md Test 1:
#    result: pending → result: passed (or partial if opencode 1.A still failing)
#    Add passed_at: <ISO>
```

**Outcome (operator fills in):**
- Stale daemons killed: [pending — paste ps output here, expected empty]
- Installer output: [pending — paste full output here, NO exit-78]
- launchctl list output: [pending — paste here, expected PID ≠ '-' for live-claude + live-copilot]
- Heartbeat samples from .data/live-claude.log + .data/live-copilot.log: [pending]
- HUMAN-UAT.md Test 1 result: [pending — passed | partial | failed]

### PHASE B — Restart health-coordinator + verify /health/state.sub_agent_capture (closes VERIFICATION human_verification #3)

```bash
# 1. Identify the running coordinator process
ps aux | grep 'scripts/health-coordinator.js' | grep -v grep
# Note the PID (per VERIFICATION.md line 67, currently PID 1806 — pre-merge from Tue 07AM)

# 2. Restart via launchctl (check label first)
launchctl list | grep -i health
launchctl kickstart -k gui/$(id -u)/com.coding.health-coordinator   # adjust label if different

# 3. Wait 10s and probe
sleep 10
curl -s http://localhost:3033/health/state | jq -e .sub_agent_capture
# Expected: jq exits 0 (previously returned 404 per VERIFICATION.md line 68)

curl -s http://localhost:3033/health/state | jq .sub_agent_capture
# Expected shape: live_registrations + last_sweep_at + registry_size per Plan 51-11 interfaces
```

**Outcome (operator fills in):**
- Old coordinator PID: [pending]
- New coordinator PID after kickstart: [pending]
- /health/state.sub_agent_capture jq output: [pending — paste here]
- Per-agent live_registrations.{claude,opencode,copilot,mastra}: [pending]
- registry_size: [pending]
- last_sweep_at: [pending]

### PHASE C — Run fresh /gsd-execute-phase against a SMALL DOCS-ONLY test phase + verify all 6 ACs

```bash
# 1. Capture baseline observation count for AC #3 delta
BASELINE_TS=$(date +%s)
sqlite3 .observations/observations.db "SELECT COUNT(*) FROM observations WHERE json_extract(metadata,'\$.source')='sub-agent'"
# Record the value (likely 2 per VERIFICATION.md line 61)
echo "BASELINE_TS=$BASELINE_TS BASELINE_LIVE_COUNT=<value>"

# 2. Capture pre-wave dashboard screenshot via /playwright-cli skill
# Open http://localhost:3032, screenshot to:
#   .planning/phases/51-…/verification/51-16-dashboard-baseline.png
# Confirm knowledge-pipeline badge is GREEN

# 3. Pick a small docs-only test phase (NOT Phase 51!)
#    Candidates: Phase 50 (re-run synthetic plan), or any small docs-only phase
#    HARD CONSTRAINT: NOT Phase 51, NOT a heavyweight migration

# 4. Run the wave
# /gsd-execute-phase <small-test-phase>
tail -F .data/live-claude.log
# Expected: [live-claude] new sub-agent detected: agent-... parent_session=...

# 5. Verify AC #1 — Backfill (existing 2026-05-23 backfill healthy)
sqlite3 .observations/observations.db "SELECT COUNT(*) FROM observations WHERE json_extract(metadata,'\$.source')='sub-agent-backfill'"
# Expected: >= 117 (per VERIFICATION.md line 6 / table row #6)

# 6. Verify AC #2 — LSL parity (post Plan 51-15)
find .specstory/history -name '*_S[0-9]*-*-*.md' | wc -l
# Expected: > 0 (post Plan 51-15 backfill)
find .specstory/history -name '*_S[0-9]*-*-*.md' -newer /tmp/51-16-wave-start | head -5
# Expected: at least one file with mtime AFTER wave start

# 7. Verify AC #3 — Observation parity ≤15 min (THE critical gap)
sqlite3 .observations/observations.db "SELECT COUNT(*) FROM observations WHERE json_extract(metadata,'\$.source')='sub-agent' AND created_at > $BASELINE_TS"
# Expected: > 0 (new live-tier observations from the wave, NOT pre-existing manual rows)

sqlite3 .observations/observations.db "SELECT json_extract(metadata,'\$.sub_hash'), datetime(created_at, 'unixepoch') FROM observations WHERE json_extract(metadata,'\$.source')='sub-agent' AND created_at > $BASELINE_TS ORDER BY created_at DESC LIMIT 10"
# Expected: rows from last few minutes with sub_hash matching live-detected agents

# 8. Verify AC #4 — Agent-agnostic
# Minimum: confirm claude daemon produced rows (post-CR-03 observations_written>0 mid-tail)
# Full: re-run small test in opencode + copilot (BEST-EFFORT — defer if 1.A still blocking)

# 9. Verify AC #5 — Idempotency
launchctl kickstart -k gui/$(id -u)/com.coding.sub-agent-sweep
sleep 30
sqlite3 .observations/observations.db "SELECT COUNT(*) FROM observations WHERE json_extract(metadata,'\$.source')='sub-agent-backfill'"
# Expected: same count as step 5 (ObservationWriter content_hash dedup + registry idempotency key)

# 10. Verify AC #6 — Dashboard truth (DURING the wave, not after)
# Capture screenshot during step 4 to:
#   .planning/phases/51-…/verification/51-16-dashboard-during-wave.png
# Confirm knowledge-pipeline badge stays GREEN; per-project bubble C🟢 stays green
# (resolves Plan 51-10 Task 3 partial-verify — HUMAN-UAT Test 3)

# 11. Update .planning/phases/51-…/51-HUMAN-UAT.md
#     Test 2 (Plan 51-11 Task 4): result: pending → result: passed
#     Test 3 (Plan 51-10 Task 3): result: pending → result: passed
#     Add passed_at: <ISO> + evidence: see .planning/phases/51-…/verification/
```

**Outcome (operator fills in):**

| AC | Description | Expected | Result |
|----|-------------|----------|--------|
| AC1 | Backfill source='sub-agent-backfill' count | ≥ 117 | [pending] |
| AC2 | LSL parity — files matching *_S[0-9]*-*-*.md | > 0 + new file post-wave-start | [pending] |
| AC3 | Observation parity — new sub-agent rows since BASELINE_TS | > 0 | [pending] |
| AC4 | Agent-agnostic — claude daemon observations_written > 0; opencode+copilot best-effort | passed OR partial | [pending] |
| AC5 | Idempotency — sweep no-op (count unchanged) | unchanged | [pending] |
| AC6 | Dashboard knowledge-pipeline badge stays GREEN; per-project bubble C🟢 stays green | screenshots show GREEN | [pending] |

**Screenshots:**
- `.planning/phases/51-…/verification/51-16-dashboard-baseline.png`: [pending — operator captures during PHASE C step 2]
- `.planning/phases/51-…/verification/51-16-dashboard-during-wave.png`: [pending — operator captures during PHASE C step 10]

**51-HUMAN-UAT.md diff (operator paste after update):**
```
[pending]
```

## DB Query Evidence (operator fills in)

```sql
-- AC #1: Backfill count
SELECT COUNT(*) FROM observations WHERE json_extract(metadata,'$.source')='sub-agent-backfill';
-- Result: [pending]

-- AC #3: Live-tier rows since wave start
SELECT COUNT(*) FROM observations WHERE json_extract(metadata,'$.source')='sub-agent' AND created_at > $BASELINE_TS;
-- Result: [pending]

-- AC #5: Idempotency check (after sweep re-run)
SELECT COUNT(*) FROM observations WHERE json_extract(metadata,'$.source')='sub-agent-backfill';
-- Result: [pending — should be unchanged]
```

## Test Phase Used

[pending — operator records the small docs-only test phase chosen. MUST NOT be Phase 51 per HUMAN-UAT.md line 61. Suggested: Phase 50 or another small docs-only phase.]

## Decisions Made

[pending — populated after operator approval]

## Deviations from Plan

[pending — populated after operator approval. Expected: None — this plan is operator-driven verification only with no autonomous implementation surface.]

## Issues Encountered

[pending — populated after operator approval. Common failure modes documented in 51-16-PLAN.md "FAILURE MODES the operator should report" section:
- launchctl kickstart returns exit 78 → 51-12 fix incomplete; escalate to 51-12 revision
- /health/state.sub_agent_capture remains 404 after coordinator restart → coordinator is shell-spawned not launchd-managed; pkill + relaunch via launchctl
- AC #3 fails (zero new sub-agent observations within 15 min of wave start) → CR-03 fix incomplete OR pollSubAgentCapture path bug; escalate
- LSL files exist but window.mjs can't parse them → Plan 51-06 D-LSL-Filename regression; escalate]

## Phase 51 Cumulative Closure Metrics

[pending — populated after operator approval. Expected:
- Total plans across Phase 51: 11 original + 5 gap-closure (51-12..51-16) = 16
- All 16 plans marked [x] complete in ROADMAP.md
- Cumulative D-Reuse gate: clean (Phase 50 files unchanged)
- Cumulative new npm packages: 0
- Total tests: sum across all 16 plan SUMMARYs (181+ from VERIFICATION baseline + new tests from 51-12..51-15)
- Total commits: sum across all 16 plans + final phase-closure commit
- STATE.md repointed to Phase 43 (v7.1 OKM Cross-Repo Migration) per locked planning context (orchestrator handles, NOT this plan)]

## Known Stubs

None — this is a checkpoint:human-verify SUMMARY skeleton, not an implementation deliverable. All [pending] markers represent operator-driven outcomes awaiting live verification; they are not stubs in the code-quality sense.

## User Setup Required

This plan IS the user setup gate. The operator drives all three phases (A, B, C) in a live shell + browser session. No autonomous executor can complete this work — see "Operator Commands" section above for the verbatim shell commands.

## Next Phase Readiness

[pending — populated after operator approval. Expected: Phase 51 closes; STATE.md re-points to Phase 43 (v7.1 OKM Cross-Repo Migration). Orchestrator handles STATE.md + ROADMAP.md updates AFTER operator approval signal "phase 51 closed".]

---
*Phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as*
*Plan: 16 (final closure)*
*Completed: [pending — operator approval]*
