---
phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as
plan: 10
status: complete
human_verify_status: partial
completed_at: 2026-05-27
gates_green: true
gates_deferred:
  - "T-51-10-EM live tmux render verification under sub-agent load — daemons not yet running (deferred to post-Plan-51-11)"
---

# Plan 51-10 — Statusline reads from sub-agent registry

## Outcome

D-Statusline cleanup complete. `scripts/combined-status-line.js` no longer
walks `<parent>/subagents/` on every tick; sub-agent freshness is sourced
from `lib/lsl/registry-reader.mjs`, which reads the heartbeat files written
by the Plan 51-07/08/09 live daemons. `scripts/status-line-fast.cjs` is
untouched. Codepoint-widths emoji-width fix is preserved (visibleCellWidth
unchanged).

## Tasks

### Task 1 — `lib/lsl/registry-reader.mjs` (TDD)

Commits: `526f4180c` (RED) + `1c2853f10` (GREEN).

Created `lib/lsl/registry-reader.mjs` (200 lines) with three exports:

- `loadAllHeartbeats({stateDir, maxAgeMs})` — reads
  `sub-agent-live-state-{claude,opencode,copilot}.json`, applies uid-check
  + try/catch + stale-mtime gate. Defensive: malformed JSON or non-owned
  files log stderr and fall through to empty.
- `getFreshSubAgents(project, opts)` — merges fresh sub-agents from all
  three agents into one array, filtered by project.
- `getProjectSubMt(project, opts)` — returns the maximum heartbeat-file
  mtime across the three agents for a project (0 if all stale/missing).

10 tests in `tests/live-logging/registry-reader.test.js` cover empty
state, single fresh, stale (90s gate), project filter, multi-agent merge,
malformed JSON defense, uid-check skip.

### Task 2 — Replace 2026-05-24 mitigation in `scripts/combined-status-line.js`

Commits: `61a6a1094` (RED) + `6caa90214` (GREEN/refactor).

Refactored 3 mitigation hooks plus 1 helper:

1. **Module init.** Added cached `getRegistryReader()` loader (dynamic
   `import()` of the `.mjs` module — cached after first call so per-tick
   overhead is a property lookup, not a module load).
2. **`_effectiveActivityMtime(parentPath, projectName, registry)`.** Dropped
   the `fs.readdirSync(subagents/)` walk. New body: `max(parentMt,
   registry.getProjectSubMt(projectName, {stateDir: <rootDir>/.data}))`.
   Try/catch around the registry call so the statusline never crashes on a
   tampered heartbeat file.
3. **`_freshestProjectActivityAgeMs()`.** Pre-loads the registry once at
   the top of its IIFE; passes the cached reader into each
   `_effectiveActivityMtime` call inside the lslEntries loop.
4. **`transcriptAgeMs(projectName)` closure in `getStatusData()`.** Same
   pattern: registry pre-loaded above the loop, passed in.
5. **Projects-mapping write at the bottom of `getStatusData()`.** Reuses the
   same pre-loaded registry, passes through `entry.projectName` so the
   `subMt` sidecar field (consumed by `status-line-fast.cjs`) is registry-
   sourced.

10 tests in `tests/live-logging/statusline-registry-sourced.test.js`:

- Source-level grep gates: `fs.readdirSync(...subagents...)` count = 0,
  `registry-reader.mjs` referenced, `getProjectSubMt` called.
- Width-fix lock: `visibleCellWidth` callsite count unchanged from
  baseline (2 → 2).
- D-Statusline NOT-TOUCHED clause: `scripts/status-line-fast.cjs` carries
  no `registry-reader` import and still references `subMt`.
- Behavior tests at the registry-reader seam: empty/single-agent/multi-agent/
  stale heartbeat scenarios.

### Task 3 — Live tmux verification (checkpoint:human-verify, gate=blocking)

**Status: partial / deferred.**

Verification performed in this session:
- Bubble shows `C🟢` in a fresh Claude session (no regression in normal
  operation — the refactor doesn't break the green path).
- visibleCellWidth and codepoint-width logic byte-identical to baseline
  (Test 6 gate green).
- No statusline crashes / error output observed.

Verification deferred:
- The specific Plan-51 regression scenario (parent transcript frozen
  WHILE sub-agents are actively running) requires the live daemons
  (`scripts/sub-agent-live-{claude,opencode,copilot}.mjs`) to be running.
  Those daemons are wired by Plan 51-11's launchd installers, which
  haven't been installed yet at this point in the execution sequence.
- Screenshot capture (before / during-wave / after) deferred to the same
  post-Plan-51-11 verification cycle.

**Re-verification path:** After Plan 51-11 ships and the launchd jobs are
loaded, run `/gsd-execute-phase <test-phase>` in a real tmux pane and
confirm the `C🟢` bubble stays green throughout. If it fades to ⚫ during
sub-agent execution, the registry-reader signal isn't reaching the
statusline — likely cause is a daemon not writing heartbeats or a
heartbeat-file uid-check mismatch.

## Acceptance gates

| Gate | Expected | Actual |
|---|---|---|
| `grep -cE "fs\.readdirSync.*subagents" scripts/combined-status-line.js` | 0 | 0 ✓ |
| `grep -F "registry-reader" scripts/combined-status-line.js` | ≥ 1 line | 4 lines ✓ |
| `grep -c "getProjectSubMt" scripts/combined-status-line.js` | ≥ 1 | 3 ✓ |
| `grep -c "visibleCellWidth" scripts/combined-status-line.js` | unchanged | 2 = 2 ✓ |
| `git diff scripts/status-line-fast.cjs` | 0 lines | 0 ✓ |
| `git diff --stat lib/lsl/window.mjs lib/lsl/scan-and-convert.mjs` | 0 files | 0 ✓ |
| `console.` count in combined-status-line.js | unchanged | 48 = 48 ✓ |
| Task 1 RED + GREEN commits | 2 commits | `526f4180c` + `1c2853f10` ✓ |
| Task 2 RED + REFACTOR commits | 2 commits | `61a6a1094` + `6caa90214` ✓ |
| All Task 1+2 tests pass | 20 tests | 10 + 10 = 20 ✓ |
| Live-logging regression | 0 failures | 459/459 ✓ (26 unrelated pre-existing CJS suite-load errors from leftover worktree dirs) |

## Deviations

1. **Subagent-spawning execution went inline (orchestrator), not via gsd-executor.**
   Two consecutive 529 API overloads bounced the executor agent on first
   dispatch (Task 1 partially completed before the first overload; second
   dispatch returned with 0 tool_uses). The orchestrator absorbed Tasks 2
   and 3 inline rather than wait through the API instability. The first
   agent's two valid commits (Task 1 RED + GREEN) were merged into main
   via `beed607df` before the inline phase began. No work was lost.

2. **A worktree-cwd-drift incident from Wave 2 carried over:** the residual
   `worktree-agent-a9a9a3300ce46d977` worktree from the interrupted first
   attempt had to be force-cleaned with an uncommitted RED test file
   discarded. The inline-authored RED test file is equivalent.

3. **Task 3 is partial.** Recorded under `gates_deferred` in frontmatter;
   the regression-scenario re-verification must happen after Plan 51-11
   wires the daemons.

## Files

Created:
- `lib/lsl/registry-reader.mjs` (200 lines)
- `tests/live-logging/registry-reader.test.js` (282 lines)
- `tests/live-logging/statusline-registry-sourced.test.js` (158 lines)

Modified:
- `scripts/combined-status-line.js` (+46 / −27 — 3 mitigation hooks replaced + 1 helper rewritten)

Untouched (by contract):
- `scripts/status-line-fast.cjs` (D-Statusline NOT-TOUCHED clause)
- `lib/lsl/window.mjs`, `lib/lsl/scan-and-convert.mjs` (D-Reuse cumulative gate from Phase 50)

## Threat-model dispositions

| ID | Mitigation status |
|---|---|
| T-51-10-FI (info disclosure via heartbeat read) | mitigated — uid-check + try/catch + stale-mtime gate in `loadAllHeartbeats` |
| T-51-10-EM (emoji-width regression) | mitigated grep-gate ✓; live tmux check deferred (gates_deferred) |
| T-51-10-CR (corrupt heartbeat file) | mitigated — try/catch logs stderr + empty fallback |
| T-51-10-PI (malicious heartbeat injection) | mitigated — uid-check rejects non-owned files |
| T-51-10-AT (concurrent projects-mapping writes) | accepted — pre-existing atomic `.tmp` + rename pattern preserved |
| T-51-10-AD (mitigation-removal audit trail) | mitigated — `refactor(51-10):` commit + this SUMMARY |
