---
phase: 77-experiment-spec-per-variant-snapshot-foundation
plan: 01
subsystem: testing
tags: [experiments, yaml, js-yaml, validation, cartesian-matrix, node-test]

# Dependency graph
requires:
  - phase: measurement-validity-fixes-prerequisite
    provides: "evidence-harness.mjs SHELL_META_RE + resolveTestCommand argv-safety idiom"
provides:
  - "lib/experiments/experiment-spec.mjs — pure YAML spec resolver/validator (SPEC-01/SPEC-02)"
  - "expandAxes: {agent,model,framework,env} cartesian expansion into 5-key variant cells (D-02)"
  - "resolveExperimentSpec: load + null-guard + goal_sentence gate + repeats envelope (D-01)"
  - "validateCells: agent enum (D-05) + unsupported-combination gate (D-07) + test_command shell-safety (D-08) + aggregated whole-run fail-fast (D-06)"
  - "SHELL_META_RE exported once from evidence-harness.mjs (single canonical regex)"
  - "config/experiments/example-experiment.yaml — documented human-authored schema example"
affects: [77-02-cli, 77-03-restore-orchestrator, phase-78-run-drivability]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "taxonomy.mjs ESM header + repo-root two-up + yaml.load null-guard mirrored for spec load"
    - "frozen-constant enum tables (KNOWN_AGENTS, UNSUPPORTED_COMBINATIONS) — extensible by later phases"
    - "aggregated error-collector (push-then-throw-once) for whole-run all-or-nothing validation"
    - "canonical regex exported over duplicated (SHELL_META_RE single source)"

key-files:
  created:
    - lib/experiments/experiment-spec.mjs
    - tests/experiments/experiment-spec.test.mjs
    - config/experiments/example-experiment.yaml
  modified:
    - lib/experiments/evidence-harness.mjs

key-decisions:
  - "KNOWN_AGENTS mirrored as a local frozen constant (route-trace-resolve KNOWN_AGENTS is module-private) with a divergence test asserting equality — no silent drift"
  - "Missing axis contributes exactly one documented DEFAULT_AXIS sentinel so the cartesian product never collapses to zero cells"
  - "Loose dimensions (model/framework) validated against small soft advisory lists (KNOWN_MODELS_SOFT/KNOWN_FRAMEWORKS_SOFT) — WARN-only, never block (D-05 loose)"
  - "repeats carried on the resolved envelope, never multiplied into the cell array"

patterns-established:
  - "Pure declarative-spec resolver: no LLM, no network, fs only to read the spec file"
  - "SEAM-then-fill across TDD tasks: Task 1 shipped validateCells as a no-op seam wired into resolveExperimentSpec; Task 2 filled the body"

requirements-completed: [SPEC-01, SPEC-02]

# Metrics
duration: ~18min
completed: 2026-07-03
---

# Phase 77 Plan 01: Experiment Spec Per-Variant Snapshot Foundation Summary

**Pure YAML experiment-spec resolver: cartesian axis expansion into `{agent,model,framework,env,test_command}` variant cells with pre-run all-or-nothing validation (agent enum, copilot+headless combo gate, test_command shell-safety) via the single canonical SHELL_META_RE.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-07-03T09:03Z (approx)
- **Completed:** 2026-07-03
- **Tasks:** 2 (both TDD)
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments
- `expandAxes` produces the exact cartesian product of the four axes; each cell carries EXACTLY the five downstream keys, and a missing axis contributes one documented sentinel so the product never collapses to zero.
- `resolveExperimentSpec` loads a YAML file OR a pre-parsed object, applies the taxonomy-style null/shape guard, requires `goal_sentence`, coerces `repeats` to a positive int on the envelope, and supports both an `axes:` matrix and an explicit `variants:` escape hatch (with per-cell `test_command` override).
- `validateCells` enforces the agent enum (D-05), the frozen `UNSUPPORTED_COMBINATIONS` table (D-07, copilot+headless → Phase-78 RUN-04 pointer), and `test_command` shell-safety (D-08), collecting ALL errors then throwing ONE aggregated whole-run abort (D-06). Unknown model/framework WARN to stderr only (D-05 loose).
- `SHELL_META_RE` is now exported once from `evidence-harness.mjs` (character class byte-identical; `resolveTestCommand` consumer unaffected — its 21-test suite stays green).

## Task Commits

Each task was committed atomically (TDD: test → feat):

1. **Task 1 (RED): axis expansion + spec load guard tests** - `eaadf9d85` (test)
2. **Task 1 (GREEN): experiment spec resolver + example YAML** - `d0206b876` (feat)
3. **Task 2 (RED): cell validation gate tests** - `8468baea7` (test)
4. **Task 2 (GREEN): validateCells + SHELL_META_RE export** - `1285dd7d8` (feat)

_TDD gate sequence verified: test() commit precedes feat() commit for each task._

## Files Created/Modified
- `lib/experiments/experiment-spec.mjs` - Pure spec resolver/validator: expandAxes, resolveExperimentSpec, validateCells, KNOWN_AGENTS, UNSUPPORTED_COMBINATIONS, SHELL_META_RE re-export.
- `tests/experiments/experiment-spec.test.mjs` - 20 node:test cases covering expansion, load guards, and all four validation gates (incl. a parametrized shell-metacharacter sweep and a stderr-capture WARN assertion).
- `config/experiments/example-experiment.yaml` - Human-authored SoT schema example (version 1, 2×2 agent×model matrix, fixed-argv test_command).
- `lib/experiments/evidence-harness.mjs` - Added `export` to the existing `SHELL_META_RE` constant (one-keyword change; character class unchanged).

## Decisions Made
- Mirrored `KNOWN_AGENTS` locally as a frozen constant (the route-trace-resolve original is module-private) and added a divergence test asserting equality — reuse-by-value with a guard against silent drift, per the plan's "do not silently diverge" instruction.
- Introduced small soft advisory lists for the loose model/framework dimensions so D-05-loose WARN behaviour is deterministic and testable; a fully-recognized matrix (opus/sonnet/straight/default) emits zero warnings.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reworded a JSDoc line to satisfy the console. acceptance grep**
- **Found during:** Task 2 (verification)
- **Issue:** A JSDoc prose line read "never console.*" — `grep -v '^\s*//' | grep -c 'console\.'` does not strip `*`-prefixed JSDoc lines, so the acceptance grep counted 1 (a false positive on comment prose, not executable code).
- **Fix:** Reworded the comment to "never the global logging API"; no code behaviour changed.
- **Files modified:** lib/experiments/experiment-spec.mjs
- **Verification:** `grep -v '^\s*//' lib/experiments/experiment-spec.mjs | grep -c 'console\.'` → 0; 20/20 tests still pass.
- **Committed in:** 1285dd7d8 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking-grep)
**Impact on plan:** Cosmetic comment wording only; no logic change, no scope creep.

## Issues Encountered
- The worktree has no local `node_modules`; `js-yaml` resolves via Node's upward module walk to the main repo's `node_modules` (worktree lives under the repo tree). Confirmed by running the existing taxonomy suite green before writing code — no install needed (matches the plan's T-77-SC "accept: no new supply-chain surface").

## Verification Results
- `node --test tests/experiments/experiment-spec.test.mjs` → 20 tests, 20 pass, 0 fail.
- `node --test tests/experiments/evidence-harness.test.mjs` → 21 pass, 0 fail (SHELL_META_RE export did not regress `resolveTestCommand`).
- `grep -c "export const SHELL_META_RE" lib/experiments/evidence-harness.mjs` → 1; character class byte-identical to pre-edit.
- `node -e import(...)` exports listing → `KNOWN_AGENTS, SHELL_META_RE, UNSUPPORTED_COMBINATIONS, expandAxes, resolveExperimentSpec, validateCells`.
- `console.` non-comment count in experiment-spec.mjs → 0.

## Known Stubs
None — `validateCells` was a documented no-op seam only within Task 1; Task 2 filled it with the full enforcement body. No stubs remain.

## Next Phase Readiness
- Plan 02 (CLI) can import `resolveExperimentSpec` to turn a `--spec` flag into validated cells, and merge each cell's five keys into `span.meta`.
- Plan 03 (per-cell restore orchestrator) can iterate the resolved `cells` × `repeats` envelope.
- No blockers.

## Self-Check: PASSED
- FOUND: lib/experiments/experiment-spec.mjs
- FOUND: tests/experiments/experiment-spec.test.mjs
- FOUND: config/experiments/example-experiment.yaml
- FOUND: lib/experiments/evidence-harness.mjs (SHELL_META_RE now exported)
- FOUND commit: eaadf9d85, d0206b876, 8468baea7, 1285dd7d8

---
*Phase: 77-experiment-spec-per-variant-snapshot-foundation*
*Completed: 2026-07-03*
