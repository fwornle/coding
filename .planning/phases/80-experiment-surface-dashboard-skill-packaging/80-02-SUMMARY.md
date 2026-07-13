---
phase: 80-experiment-surface-dashboard-skill-packaging
plan: 02
subsystem: infra
tags: [skill-packaging, experiment-matrix, task-hash, sha256, agent-distribution, cli-wrapper]

# Dependency graph
requires:
  - phase: 78-experiment-runner
    provides: scripts/experiment-run.mjs (spec-driven matrix runner) + measurement-stop.mjs task_hash derivation
  - phase: 79-comparison-aggregation-report
    provides: scripts/experiments-compare.mjs (--task-hash → ranked table + report JSON)
provides:
  - ".claude/commands/experiment.md — thin-wrapper skill chaining synthesize-spec → run → compute-task_hash → auto-compare"
  - "Distribution of the experiment skill to Claude, Copilot, and OpenCode surfaces via generate-agent-instructions.sh"
affects: [dashboard-comparison-tab, experiment-surface, milestone-v7.5-closeout]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Flag→synthesized-spec-YAML (skill authors the spec, calls experiment-run.mjs --spec — no new flags on the tested runner engine)"
    - "Skill-side task_hash re-derivation (sha256 of goal_sentence, mirroring measurement-stop.mjs:805-806) to mechanically close run→compare without scraping task_id"

key-files:
  created:
    - .claude/commands/experiment.md
  modified:
    - .github/copilot-instructions.md
    - CLAUDE.md

key-decisions:
  - "D-07: SKILL synthesizes the spec YAML from operator flags (smaller blast radius) — do NOT add a flags mode to experiment-run.mjs (would touch the tested Phase-78 runner engine, out of scope)"
  - "task_class defaults deterministically to new-feature (CLOSED_6); an invalid supplied value is rejected — never emit an unclassified-quarantining spec"
  - "snapshot_id defaults to the resolvable smoke-spec baseline (same as compare-fizzbuzz.yaml)"

patterns-established:
  - "Thin-wrapper skill discipline: shell to existing CLIs, reimplement no runner/comparison logic; the only skill-side compute is the sha256 the runner already computes"
  - "Concrete task_hash handoff: the skill computes sha256(goal_sentence) itself and passes it to --task-hash — no placeholder, no scraping of the runner's task_id output"

requirements-completed: [ORCH-01]

# Metrics
duration: 12min
completed: 2026-07-13
---

# Phase 80 (Plan 02): Experiment Skill Packaging Summary

**A single installed `experiment` skill wrapping the full declare→run→compare flow: synthesizes a classified (CLOSED_6 task_class) + baselined (resolvable snapshot_id) spec YAML from headline flags, runs the matrix via `experiment-run.mjs --spec`, re-derives the concrete `task_hash` (sha256 of the goal_sentence) skill-side, and auto-runs `experiments-compare.mjs --task-hash "$TASK_HASH"` — distributed to Claude, Copilot, and OpenCode.**

## Performance

- **Duration:** ~12 min
- **Tasks:** 2
- **Files modified:** 3 (1 created, 2 installer-modified)

## Accomplishments
- Authored `.claude/commands/experiment.md` — a thin wrapper that mechanically closes the run→compare loop with a concrete task_hash (no `<placeholder>`, no scraping the runner's `task_id`).
- The synthesized spec carries a valid CLOSED_6 `task_class` (default `new-feature`) + a resolvable `snapshot_id` (default `smoke-spec`), so Runs land classified and the dashboard comparison is non-empty.
- Distributed the skill to all three driveable agent surfaces via the unedited `generate-agent-instructions.sh` (Claude cp, Copilot catalog, OpenCode CLAUDE.md section).

## Task Commits

1. **Task 1: Author .claude/commands/experiment.md** - `b43810905` (feat)
2. **Task 2: Distribute via generate-agent-instructions.sh** - `7a1bde7f9` (feat)

## Files Created/Modified
- `.claude/commands/experiment.md` - The experiment skill (frontmatter `description`/`argument-hint` + numbered flow: parse+argv-guard → synthesize classified spec → sha256 task_hash → run matrix unattended → auto-compare).
- `.github/copilot-instructions.md` - Copilot skill catalog line added by the installer.
- `CLAUDE.md` - OpenCode "Available Skills (Auto-Generated)" section line added by the installer.
- `~/.claude/commands/experiment.md` - Claude install copy (outside the repo, not tracked — created by the installer, proves distribution).

## Decisions Made
- **Flag→spec mapping (D-07, the one real design decision):** the skill synthesizes a spec YAML from `--goal/--variants/--agents/--repeats` and calls `experiment-run.mjs --spec`, rather than adding a flags mode to the tested Phase-78 runner engine (smaller blast radius).
- **task_class:** default `new-feature`; reject an invalid supplied value — never emit a spec that would quarantine Runs as `unclassified` (silent empty-comparison failure).
- **task_hash:** re-derived skill-side as `sha256(goal_sentence)` (the exact `measurement-stop.mjs:805-806` line), constant across all cells — NOT scraped from `experiment-run.mjs` (which prints `task_id`, a different key).

## Deviations from Plan
None - plan executed exactly as written. All Task 1 and Task 2 acceptance criteria (frontmatter, both CLI references, sha256 derivation present + placeholder gone, concrete `$TASK_HASH` to compare, CLOSED_6 class + snapshot_id + unclassified caveat, no `buildComparison` reimplementation, per-agent install) verified green.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ORCH-01 met: the `experiment` skill is installed and usable across the coding agents with a mechanically-closed run→compare handoff.
- Pairs with Plan 80-01's live `GET /api/experiments/comparison` endpoint + the dashboard Comparison tab: the skill's compare step writes `.data/experiments/reports/<task_hash>.json` (the CLI path) while the dashboard fetches the same comparison live — both surfaces, one `buildComparison` source.
- This closes the ORCH-01 requirement gap of milestone v7.5.

---
*Phase: 80-experiment-surface-dashboard-skill-packaging*
*Completed: 2026-07-13*
