---
phase: 87-interactive-spans-and-branch-avenues
plan: 03
subsystem: experiment-runner / avenue-execution
tags: [avenue, experiment-spec, token-attribution, cross-branch, AVN-01, AVN-04, AVN-06, AVN-09]
dependency_graph:
  requires:
    - "lib/experiments/avenue-branch.mjs (createAvenueBranch/commitAvenueWorktree/pruneAvenueBranch — Plan 87-01)"
    - "lib/experiments/experiment-restore.mjs restoreForCell({avenueMode,branchName}) — Plan 87-01"
    - "lib/experiments/experiment-spec.mjs (mastracode + env kb-on/kb-off axis) — Plan 87-02"
    - "lib/experiments/token-aggregate.mjs aggregateByTaskId — Phase 71-03"
    - "lib/lsl/token/token-db.mjs insertTokenRowDeduped — Phase 82-04"
  provides:
    - "synthesizeAvenueSpec / synthesizeToYamlFile (scriptable avenue-spec from a completed span)"
    - "origin_span_id Run metadata (measurement-start -> buildRunTags -> writeRun)"
    - "runCell avenue-mode wiring (branch restore + injection env + commit-on-close + origin_span_id)"
    - "AVN-06 cross-branch no-double-count + survival integration gate"
  affects:
    - "Plan 87-04 (avenue merge/promote/prune — reads avenue/<task_id> branches this runner commits)"
    - "Plan 87-05/06 (UI fork surface — calls synthesizeAvenueSpec)"
tech_stack:
  added: []
  patterns:
    - "null-preserved metadata (origin_span_id ?? null — mirrors rerun_of/base_variant)"
    - "conditional-spread CLI arg (--origin-span-id only when set)"
    - "avenue-gated behavior (avenue flag off => non-avenue cells byte-unchanged)"
    - "dual-writer discipline in test (writer close before readonly aggregate)"
key_files:
  created:
    - lib/experiments/avenue-spec.mjs
    - tests/experiments/avenue-spec.test.mjs
    - tests/experiments/avenue-crossbranch.test.mjs
  modified:
    - lib/experiments/experiment-runner.mjs
    - lib/experiments/run-write.mjs
    - scripts/measurement-start.mjs
    - scripts/measurement-stop.mjs
decisions:
  - "origin_span_id threaded via span.meta (measurement-start --origin-span-id -> buildRunTags -> writeRun.metadata) rather than a new writeRun arg — reuses the exact rerun_of/base_variant fold path, null-preserved."
  - "avenue synthesizer emits an explicit variants: list (not axes:) so the chosen matrix maps 1:1 to cells; resolveExperimentSpec still normalizes each entry through makeCell/validateCells."
  - "avenue commit-on-close is best-effort (try/catch, never aborts the score path) — the measurement already landed on MAIN before the branch commit; a failed commit must not lose the run."
  - "CODING_KNOWLEDGE_INJECTION=0 set on agentBaseEnv ONLY (never spanEnv) — the span must stay on MAIN (Pitfall 1); kb-on/default leaves it unset."
metrics:
  duration_min: 22
  completed: "2026-07-11"
  tasks: 3
  commits: 4
  files_touched: 7
  tests_pass: 72
---

# Phase 87 Plan 03: Avenue Execution Path (synthesize + branch-run + no-double-count) Summary

Wired the avenue execution path into the existing sequential experiment runner: a completed span forks into a scriptable avenue experiment-spec (AVN-01), `runCell` restores onto the `avenue/<task_id>` branch with the injection toggle threaded from the env-axis (AVN-04) while the measurement span stays on MAIN, each avenue Run stamps an `origin_span_id`, and — the riskiest guarantee — the cross-branch no-double-count + post-prune survival invariant (AVN-06 + AVN-09) is proven by a dedicated integration test over the REAL aggregate/dedup identity code.

## What was built

### Task 1 — avenue-spec synthesizer + origin_span_id (AVN-01)
- **`lib/experiments/avenue-spec.mjs`** (new): `synthesizeAvenueSpec({ originRun, variants, repeats, test_command })` builds an experiment-spec where `goal_sentence` = the origin prompt, `snapshot_id` = the origin snapshot id, `origin_span_id` = the origin Run task_id, and `variants` = one canonical `makeCell`-shaped cell per chosen variant (env carries kb-on/kb-off). `synthesizeToYamlFile(spec, {dir})` persists `config/experiments/avenue-<origin>.yaml` (D-01 scriptable / RESEARCH A4) via `js-yaml`, with the filename derived through `sanitizeTaskId` (path-traversal-safe).
- **`origin_span_id` threaded** through `scripts/measurement-start.mjs` (`--origin-span-id` → `span.meta.origin_span_id`), `scripts/measurement-stop.mjs` (`buildRunTags` folds `span.meta?.origin_span_id ?? null`), and `lib/experiments/run-write.mjs` (`writeRun` writes `origin_span_id: t.origin_span_id ?? null` into Run.metadata) — mirroring the existing `rerun_of`/`base_variant` null-preserved pattern.
- **`tests/experiments/avenue-spec.test.mjs`** (new): origin prompt/snapshot preserved, one cell per variant, resolves under `resolveExperimentSpec` (mastracode + kb-on/kb-off legal), scriptable YAML round-trip, `synthesizeToYamlFile` persistence, and `origin_span_id` round-trip through `buildVariantMeta` → `writeRun` (null when absent).

### Task 2 — runCell avenue branch + injection env
Extended `runCell` in `lib/experiments/experiment-runner.mjs` behind an `avenue` flag (non-avenue cells byte-unchanged):
1. restore uses `restoreForCell(snapshotId, { avenueMode:true, branchName:'avenue/'+sanitizeTaskId(taskId) })` — the worktree lands under `.data/avenues/<task_id>/` on the named branch;
2. the measurement span still opens with `spanEnv` (LLM_PROXY_DATA_DIR = mainDataDir) — span never repointed to the sandbox (Pitfall 1);
3. `cell.env === 'kb-off'` → `agentBaseEnv.CODING_KNOWLEDGE_INJECTION = '0'` (AVN-04) — on the AGENT child env only, not spanEnv;
4. at cell close (in the same `finally` as measurement-stop), best-effort `commitAvenueWorktree({ worktree, message: 'avenue: <variant> <task_id>' })` so the branch HOLDS the code (D-04);
5. `--origin-span-id <originSpanId>` passed into measurement-start for avenue cells.
The loop stays STRICTLY SEQUENTIAL (Pitfall 5) and the dedup/aggregate identity code is untouched.

### Task 3 — AVN-06 cross-branch no-double-count gate (TOP RISK)
**`tests/experiments/avenue-crossbranch.test.mjs`** (new) — a `node --test` integration test over a temp MAIN `token_usage.db` using the REAL `aggregateByTaskId` + `insertTokenRowDeduped` + `pruneAvenueBranch` (no mocks). Proves four behaviors:
1. per-task_id DISJOINT aggregation (origin + 2 avenues, no bleed / no cross-avenue collision, Pitfall 2);
2. merge-on-cache dedup enriches in place — NO second row (no double-count); a distinct tool_call_id creates a distinct row;
3. post-prune SURVIVAL — after `pruneAvenueBranch` (real git worktree + branch, real commit-on-close), `aggregateByTaskId(avenue)` still returns the avenue totals from the untouched MAIN db (AVN-09 crossover);
4. Pitfall-1 NEGATIVE — an avenue span (wrongly) opened on a SANDBOX data dir aggregates to 0 tokens under its task_id in MAIN (documented, caught failure mode).

## Verification

- `node --test tests/experiments/avenue-spec.test.mjs` — green (AVN-01).
- `node --test tests/experiments/experiment-runner.test.mjs` — green (24/24; non-avenue cells byte-unchanged; avenue wiring present via grep gates).
- `node --test tests/experiments/avenue-crossbranch.test.mjs` — green (4/4; AVN-06 top-risk gate).
- Regression anchors green: `run-write.test.mjs` + `measurement-start-variant.test.mjs` (rerun_of/base_variant null-default contract preserved).
- Full plan surface: **72/72 tests pass**.
- `git diff --stat package.json` empty — ZERO package installs (T-87-03-SC).

Acceptance greps (all matched): `origin_span_id` in run-write.mjs + measurement-start.mjs; `synthesizeAvenueSpec` export; `avenueMode` + `commitAvenueWorktree` + `CODING_KNOWLEDGE_INJECTION` in experiment-runner.mjs; `spanEnv`/`mainDataDir` still MAIN; `aggregateByTaskId`/`insertTokenRowDeduped` in the AVN-06 test; `AVN-06` cited 7×, `AVN-09` cited 6×.

## Deviations from Plan

None — plan executed exactly as written. `avenue-branch.mjs` was NOT modified (parallel Plan 87-04 owns it; this plan only imports `commitAvenueWorktree` from it).

## Threat Model Coverage

- **T-87-03-01** (tampering): goal_sentence carried as a data field (never shelled); branch name derived via `sanitizeTaskId`; test_command shell-safety enforced by `resolveExperimentSpec`/`validateCells` (unchanged).
- **T-87-03-02** (mis-attribution): `composeTaskId` gives a unique task_id per avenue; the AVN-06 test asserts disjoint aggregation.
- **T-87-03-03** (data loss / sandbox span): span always opens with `spanEnv` → MAIN; the AVN-06 test encodes the sandbox-span 0-token failure as a caught negative.
- **T-87-03-04** (elevation): agent cwd = avenue worktree (isolated); only measurement (not code) writes to MAIN; commit-on-close scoped to the avenue branch.
- **T-87-03-05** (concurrent avenues): sequential await-each loop preserved.
- **T-87-03-SC**: zero package installs (`git diff --stat package.json` empty).

## Self-Check: PASSED

- Created files exist: `lib/experiments/avenue-spec.mjs`, `tests/experiments/avenue-spec.test.mjs`, `tests/experiments/avenue-crossbranch.test.mjs` — all present.
- Commits present: `40cf3d201` (RED test), `b4f4c8ff0` (Task 1 GREEN), `d9282e2dc` (Task 2), `2634dc470` (Task 3).
- TDD gate compliance: Task 1 has a `test(...)` RED commit (40cf3d201) before the `feat(...)` GREEN commit (b4f4c8ff0). Task 3 is a test-authoring task (the deliverable is the gate).
