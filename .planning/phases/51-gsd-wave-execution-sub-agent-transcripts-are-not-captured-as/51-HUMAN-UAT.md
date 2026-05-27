---
status: partial
phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as
source: ["51-10-PLAN.md Task 3", "51-11-PLAN.md Tasks 3+4"]
started: 2026-05-27T06:30:00Z
updated: 2026-05-27T06:30:00Z
---

## Current Test

Phase 51 launchd cleanup + 6 acceptance criteria (Task 4) awaiting operator.

## Tests

### 1. Plan 51-11 Task 3 — launchd cleanup + smoke-verify all 4 jobs
expected: All 4 launchd jobs reach `state=running` (PID column ≠ "-") and write at least one heartbeat each to `.data/live-<agent>.log`. Stale nohup'd daemons killed first so launchd can acquire required locks.
result: pending

Steps (run from `/Users/Q284340/Agentic/coding`):

```bash
# 1. Kill nohup'd daemons so launchd can take over
pkill -f 'node scripts/sub-agent-live-(claude|opencode|copilot)\.mjs'
ps aux | grep -E "node scripts/sub-agent-live" | grep -v grep    # should be empty

# 2. Kickstart launchd copies
launchctl kickstart -k gui/$(id -u)/com.coding.sub-agent-live-claude
launchctl kickstart -k gui/$(id -u)/com.coding.sub-agent-live-copilot
# (opencode skipped — see Test 1.A)

# 3. Verify — expect PID column ≠ "-" for claude + copilot
launchctl list | grep com.coding.sub-agent
tail -5 .data/live-claude.log
tail -5 .data/live-copilot.log
```

#### 1.A — opencode daemon schema mismatch
expected: `com.coding.sub-agent-live-opencode` runs (PID ≠ "-") OR is recorded as known limitation if no opencode session DB present.
result: pending (likely deferred to a follow-up)

Observed during Plan 51-11 closure: opencode daemon crashed at startup with:
```
[live-opencode] fatal: unsupported opencode schema migration=null; supported=1,2,3,4; if you upgraded opencode, audit lib/lsl/adapters/opencode-sqlite.mjs against the schema before adding to SUPPORTED_MIGRATIONS
```

Either the operator's opencode SQLite database has a newer schema version not yet listed in `lib/lsl/adapters/opencode-sqlite.mjs` `SUPPORTED_MIGRATIONS`, or no opencode database exists at the expected path. Follow-up phase should: (a) detect schema-not-found gracefully (no FATAL), (b) widen SUPPORTED_MIGRATIONS to current opencode versions. Non-blocking for Phase 51 closure since operator's active agent is Claude.

### 2. Plan 51-11 Task 4 — Six final acceptance criteria
expected: all 6 ACs pass in a fresh `/gsd-execute-phase <test-phase>` run with screenshots captured to `.planning/phases/51-.../verification/`.
result: pending

| AC | Description |
|----|-------------|
| AC1 | Backfill — 2026-05-23 afternoon Phase 42 sub-agent transcripts present in `/observations` tagged `source=sub-agent-backfill` |
| AC2 | LSL parity — fresh wave produces sub-agent LSL files under `.specstory/history/{YYYY}/{MM}/` matching D-LSL-Filename |
| AC3 | Observation parity within ≤15 min — live tier writes `source='sub-agent'` rows during the wave |
| AC4 | Agent-agnostic — same wave under OpenCode + Copilot produces equivalent output |
| AC5 | Idempotency — re-running sweep is a no-op |
| AC6 | Dashboard truth — knowledge-pipeline badge stays GREEN during an active wave; per-project bubble `C🟢` stays green (resolves Plan 51-10 Task 3 partial-verify) |

**Recommendation:** pick a small completed phase (e.g. Phase 50 or one of the small docs-only phases) as `<test-phase>` for the verification wave. **DO NOT** re-run Phase 51 as the test phase — that's what caused the nested-execute incident on 2026-05-27.

### 3. Plan 51-10 Task 3 — live tmux statusline verification under sub-agent load
expected: `C🟢` bubble stays GREEN during sub-agent execution (registry-reader signal kicks in when parent transcript freezes); visibleCellWidth + codepoint-widths rendering unchanged.
result: partial — confirmed C🟢 in a fresh session (no regression), but the specific failure mode (parent frozen + sub-agents running) requires launchd-running daemons. Re-verify after Test 1 above completes.

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps

(populated when results turn from `pending` → `failed`)
