# Experiment log — exp-dash-start-control-claude-opus-4-8

**Goal (task_hash 9eb8949af0b8fe513662a45abe5dc360025b32417d5b38ed9ea13111a9d15557):**
Add a Start/Stop measurement control to the Performance dashboard tab wired to the measurement CLI.

**Run parameters:** model `claude-opus-4-8[1m]` (intended) · agent `claude` · framework `claude-code` · spec_level `adhoc`
**Span:** started 2026-06-29T05:33:40Z → ended 2026-06-29T05:54:47Z
**Snapshot:** `.data/experiments/snapshots/exp-dash-start-control-claude-opus-4-8.json` (git `bbf191e` + stash `e07c4b4`)

## What we did (followable narrative)
1. Asked whether the full measure→snapshot→solve→log→stop→re-run lifecycle is possible. Mapped it across three subsystems (measurement lifecycle, reproducibility/Phase 67, observation linkage).
2. Started this measurement (CLI) + captured a manual RunSnapshot (pre-Phase-67 stand-in).
3. Solved the task **dashboard-only MVP**: vkb-server `GET/POST /api/experiments/measurement/{active,start,stop}` (same-origin, no server.js change) + a Redux-backed `MeasurementControl` + made `measurement-stop.mjs` resilient to a dashboard-archived span (two-phase stop via a `*.close-requested.json` marker).
4. Dogfooded: the control displayed THIS span while we built it; stopped via the new endpoint; host close resumed from the marker and scored the run.

## Outcome (scored Run)
- task_class `new-feature` · total_tokens **1,244,689** · calls **186** · steps **43**
- route: loops=0, edit_reverts=1, redundant_reads=2, wallclock/step≈28,365s
- rubric: goal_achieved=0.5, regressions=0, code_quality/test_coverage/spec_drift=null · **goal_aligned_ratio=0.933**

## Observations (findings — the "what we noticed")
- **O1 — model mis-attribution:** recorded model `claude-haiku-4.5`, not the actual Opus 4.8 session. The "dominant model" picks the most-frequent token-row model, which is skewed by Haiku *judge* calls inside the span window. → attribution-accuracy gap.
- **O2 — wallclock_per_step implausible (~28k s):** route time-math over a long interactive multi-hour window is wrong. → route-quality heuristic gap.
- **O3 — sparse rubric:** evidence harness keys off GSD artifacts (VERIFICATION.md/REVIEW.md) absent on an ad-hoc task, so 3/5 dims are null. → evidence-harness coverage gap for non-GSD tasks.
- **O4 — token attribution + trace resolution worked** for a live Claude Code session (1.24M tokens, 43 steps captured). The core loop is real.
- **O5 — two-phase stop works:** dashboard archive → host resume-from-marker closed and scored cleanly; `task_hash` stable for comparison.

## How to re-run / compare (step e)
- Same goal text → same `task_hash` → comparable. Re-run with a different model: start a session in that model, `node scripts/measurement-start.mjs --task-id exp-dash-start-control-<model> --goal "<same goal>"`, redo the task, stop+close, compare by task_hash in the dashboard.
- Restore the starting tree: `git checkout bbf191e && git stash apply e07c4b4` (from the snapshot `restore_hint`). Byte-identical restore + deterministic replay is Phase 67 (not yet built).
