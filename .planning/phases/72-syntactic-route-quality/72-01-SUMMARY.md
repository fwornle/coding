---
phase: 72-syntactic-route-quality
plan: 01
subsystem: experiments
tags: [route-quality, heuristics, route-event, schema, tdd, zero-llm]
requires: []
provides:
  - "lib/lsl/route/route-event.mjs — the ONE cross-agent RouteEvent typedef + OUTCOMES enum + inputsDigest(input)"
  - "lib/experiments/route-heuristics.mjs — computeHeuristics(RouteEvent[]) + ALL_NULL_HEURISTICS"
  - "tests/fixtures/route/*.json — six golden RouteEvent[] fixtures (incl. true-negatives)"
affects:
  - "Wave-2 readers (72-03/72-04) emit against the RouteEvent shape authored here"
  - "measurement-stop.mjs (72-05) calls computeHeuristics between token-aggregate and writeRun"
tech-stack:
  added: []
  patterns:
    - "Pure zero-LLM transform module (mirrors lib/lsl/token/claude-token-rows.mjs num()/estimate() style)"
    - "node:test + node:assert/strict (tests/experiments/ convention, NOT jest)"
    - "node:crypto sha256 of canonical JSON for digests (V6 — never hand-rolled)"
key-files:
  created:
    - lib/lsl/route/route-event.mjs
    - lib/experiments/route-heuristics.mjs
    - tests/experiments/route-heuristics.test.mjs
    - tests/fixtures/route/loop.json
    - tests/fixtures/route/edit-revert.json
    - tests/fixtures/route/redundant-read.json
    - tests/fixtures/route/abandoned.json
    - tests/fixtures/route/parallel-same-turn.json
    - tests/fixtures/route/true-negatives.json
  modified: []
decisions:
  - "edit_revert_count v0 = Edit-input A→B→A pattern per target_path (OQ2/A2 lock); byte-state reconstruction deferred"
  - "denied folds into total_step_count like every other outcome (D-07); enum value kept for forward-compat"
  - "loop_count counts each maximal adjacent cluster once (3x repeat = 1 loop, not 2)"
  - "null/empty trace → ALL_NULL_HEURISTICS (D-02); 0 reserved for 'trace present, genuinely none'"
metrics:
  duration: ~12 min
  completed: 2026-06-24
  tasks: 2
  files: 9
  tests: 15
---

# Phase 72 Plan 01: RouteEvent Schema + Syntactic Route Heuristics Summary

The deterministic, zero-LLM floor under Phase 73's judge: a single cross-agent `RouteEvent` schema (D-01) plus a pure `computeHeuristics(RouteEvent[])` that emits the six syntactic route-quality metrics under strict/high-precision calibration (D-06), with per-heuristic null fallback (D-02), fully backed by golden-trace fixtures including a true-negative per heuristic (D-08).

## What Was Built

**Task 1 — `lib/lsl/route/route-event.mjs` (commit `923e5d19d`)**
- `RouteEvent` jsdoc `@typedef` with the nine cross-agent fields (D-01) — the shape every Wave-2 reader emits.
- `OUTCOMES` frozen enum: `success` | `error` | `denied` | `abandoned` (+ `OUTCOME_VALUES` array).
- `inputsDigest(input)` — deterministic `node:crypto` sha256 of `JSON.stringify(input ?? null)` (V6, never hand-rolled). Stable for identical input, distinct for different input, never throws on `null`/`undefined`/non-serializable input (falls back to a stable marker on stderr).
- Pure ESM, imports nothing from km-core or `node:fs`. Zero `console.*`.

**Task 2 — fixtures + `lib/experiments/route-heuristics.mjs` (RED `2f8818fc0` → GREEN `2a5e638f0`)**
- Six golden `RouteEvent[]` fixtures under `tests/fixtures/route/` and a 15-test `node:test` suite (one block per heuristic + a true-negative each + the null/empty block).
- `computeHeuristics(trace)` returning `{ loop_count, edit_revert_count, redundant_read_count, abandoned_tool_count, total_step_count, wallclock_per_step }`:
  - **total_step_count** — array length; all outcomes count (D-07).
  - **wallclock_per_step** — `(lastTerminal − firstStart) / max(1, count)` ms; single-event run → that event's `ended − started`; timestamps via `Date.parse` ONLY (Pitfall 6).
  - **abandoned_tool_count** — count of `outcome === 'abandoned'`.
  - **redundant_read_count** — successful re-read of a `target_path` with no intervening Edit/Write to that path (re-read after a mutation is NOT redundant).
  - **edit_revert_count** — v0 input-pattern: Edit-input digest returns to an earlier digest on the same `target_path` (A→B→A → 1; A→B→C → 0).
  - **loop_count** — maximal runs of ≥2 consecutive identical `(tool_name, inputs_digest)`; each cluster counts 1.
- `ALL_NULL_HEURISTICS` (six null keys, frozen) returned for `null`/non-array/empty trace (D-02 — never `0`).
- Imports `inputsDigest` from `../lsl/route/route-event.mjs` (key-link). Zero `console.*`.

## Verification

- `node --test tests/experiments/route-heuristics.test.mjs` → 15/15 pass, 7 suites, 0 fail.
- `grep -c "console\."` returns 0 for both new modules.
- `inputsDigest` uses `node:crypto` sha256 (no hand-rolled hash); stable-digest node-eval exits 0.
- `ls tests/fixtures/route/*.json | wc -l` = 6.
- One true-negative assertion per heuristic present (A→B→C / Read(a),Edit(a),Read(a) / Bash(x),Bash(y),Bash(x) / matched abandoned pair).

## Deviations from Plan

None — plan executed as written.

- The plan listed `lib/lsl/route/route-event.mjs` in `files_modified`; it did not pre-exist, so it was created (the plan body's `<action>` says "Create" — frontmatter wording is harmless).
- The plan's `<verify>` for Task 1 runs Task 2's test suite. Task 1's module has no standalone test file; its behavior is covered by Task 1's inline node-eval acceptance checks and exercised by Task 2's suite. Task 1 therefore committed as a single `feat` commit (the plan-level TDD RED→GREEN gate is satisfied by Task 2's `test(...)` then `feat(...)` commit pair).

## TDD Gate Compliance

Plan is `type: tdd`. Gate sequence verified in git log:
- RED: `test(72-01): add failing route-heuristics suite + golden fixtures (RED)` (`2f8818fc0`) — suite failed (module absent).
- GREEN: `feat(72-01): implement computeHeuristics + ALL_NULL_HEURISTICS (GREEN)` (`2a5e638f0`) — 15/15 pass.
- REFACTOR: not needed (implementation clean at GREEN).
- Task 1 schema module landed as `feat(72-01): author RouteEvent schema...` (`923e5d19d`) ahead of the suite that consumes it.

## Self-Check: PASSED

Created files verified on disk:
- FOUND: lib/lsl/route/route-event.mjs
- FOUND: lib/experiments/route-heuristics.mjs
- FOUND: tests/experiments/route-heuristics.test.mjs
- FOUND: tests/fixtures/route/{loop,edit-revert,redundant-read,abandoned,parallel-same-turn,true-negatives}.json (6)

Commits verified in git log:
- FOUND: 923e5d19d (Task 1 feat)
- FOUND: 2f8818fc0 (RED)
- FOUND: 2a5e638f0 (GREEN)
