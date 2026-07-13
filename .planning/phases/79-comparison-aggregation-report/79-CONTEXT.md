# Phase 79: Comparison, Aggregation & Report - Context

**Gathered:** 2026-07-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 79 turns the raw per-cell **Runs** produced by Phase 78 into an **honest side-by-side comparison**: it applies an objective success gate per run, aggregates N repeats per variant into central-tendency + variance summaries, and emits a ranked comparison report (CLI table + machine-readable JSON) keyed by `task_hash`. It delivers **CMP-01, CMP-02, CMP-03**.

**In scope:** success-gate evaluation, per-variant aggregation over `task_hash` groups, ranking, CLI table, JSON/CSV export.

**Out of scope (belongs to Phase 80):** the dashboard Performance-tab variant columns (CMP-04) and the installed cross-agent `experiment run` skill (ORCH-01). Phase 79 produces the export that Phase 80 surfaces.

</domain>

<decisions>
## Implementation Decisions

### Success Gate (CMP-01)
- **D-01:** A run is **successful** (eligible for cost comparison) iff `terminal_state == 'complete'` **AND** its `test_command`/UAT exits 0. Both conditions required.
- **D-02:** A run with **no `test_command`** is **ungated** — shown in the report but **excluded from the ranking** (can never surface as a cheap winner).
- **D-03:** `timeout` / `abort` runs are **failed** — reported in a separate section, **never averaged into a variant's cost/metrics** (satisfies CMP-01 criterion 4: a variant whose runs all fail is shown as "no successful runs", not a cheap winner).
- **D-04:** The gate signal is the **per-cell test outcome** and is **distinct from the judge rubric score**. **RESOLVED via code trace (2026-07-13):** the `test_command` IS already executed at score time — `scripts/measurement-stop.mjs` gathers evidence via `lib/experiments/evidence-harness.mjs` (`runTestCommand`, `agent-headless.mjs:170`; reads `span.meta.test_command`, non-zero exit → false, never throws). **BUT** that objective pass/fail is only consumed to *derive the subjective rubric dims* (`test_coverage`/`regressions`, measurement-stop.mjs:100-108) — it is **NOT persisted as a discrete queryable gate field** on the Run or the Score entity. Therefore CMP-01 requires **persisting the objective gate result at score time** (see D-04a). Re-deriving the gate at aggregation time is **infeasible**: the agent's edits lived in an ephemeral sandbox worktree (D-02) destroyed after the run, so re-running the test at compare time would test a checkout *without* the edits.
- **D-04a (SCOPE — gate persistence):** Phase 79 has two parts. **(A) Gate persistence:** at score time (`measurement-stop.mjs` → `score-write.mjs`), persist the objective test-run outcome the evidence-harness already computes as a **discrete field** — e.g. `gate_passed: true|false|null` on the Score entity (null = no test_command → ungated per D-02). The harness result is already in-hand at that point, so this is a small additive change, not new execution machinery. **(B) Aggregation/report:** the `compare.mjs` aggregator + CLI that reads `readRuns` + the new gate field and applies D-01..D-13. Planner to decide whether gate lives on Score vs Run (Score is where the harness result already lands; the compare reader must join Run→Score either way).
- **D-04b (existing-data reality):** the 36 pre-existing Run rows predate any gate field → they are all **ungated** (shown, never ranked). They are still valid fixtures for verifying the ungated/failed/unscored groupings and the aggregation math, but **full "ranked successful variants" verification needs ≥1 fresh run set scored AFTER gate-persistence lands.** Unit/integration tests should use synthetic Run+gate fixtures; a live gated run (coordinated with the Phase 78-05 smoke) demonstrates the end-to-end ranked path.

### Ranking (CMP-03)
- **D-05:** Default ranking metric is a **composite = `total_tokens / rubric_score`, ascending** (lowest cost-per-quality wins), computed over **successful-gated runs only**.
- **D-06:** The ranking metric is **flag-overridable** — e.g. `--rank-by tokens|wallclock|score|composite`. Composite is the default.
- **D-07:** **Null-rubric handling** (a successful run the judge marked `not_scored:'trivial'` → `rubric_score` null/0): such runs are **not composite-rankable** and go in a separate **"unscored"** group — shown, not ranked as winners (mirrors the ungated D-02 treatment). Never divide by zero/null to fabricate a rank.
- **D-08:** `rubric_score` source: the judge output on the `Run--scored-->Score` entity. Planner to confirm whether it is `goal_aligned_ratio` alone or a defined aggregate of the 5 locked rubric dims. Whichever is chosen must be documented in the export schema.

### Variance / Aggregation (CMP-02)
- **D-09:** Each per-variant metric carries **both** classic and robust statistics: `{ mean, stddev, median, min, max, n }`. Emitted for **tokens, wallclock, route metrics (the 6 heuristics), and rubric scores**.
- **D-10:** `n` (repeat count) is always surfaced so a "winner" from `n=1` is visibly less trustworthy than one from `n=5`. Aggregation groups by **variant within a `task_hash`**.

### Report Surface & Export (CMP-03)
- **D-11:** Output = a **ranked CLI table** (human-facing, stdout) **plus a structured JSON export** written to **`.data/experiments/reports/<task_hash>.json`** — the JSON is the canonical artifact Phase 80's dashboard variant-columns will consume.
- **D-12:** `--csv` flag additionally emits a CSV alongside the JSON. CSV is opt-in, not default.
- **D-13:** The report is **keyed by `task_hash`** for reproducibility; the JSON schema must include per-variant success-gate outcome, the full `{mean,stddev,median,min,max,n}` block per metric, the rank, and the failed/ungated/unscored groupings.

### Claude's Discretion
- Exact CLI table column layout and formatting.
- JSON schema field names (must be stable — Phase 80 consumes them; document them in the SUMMARY).
- Module/file placement (expected: a new `lib/experiments/compare.mjs` aggregator + a `scripts/experiments-compare.mjs` CLI, mirroring the existing `query.mjs`/`experiments-query.mjs` split).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` §CMP-01/02/03 (lines 45-47) — the locked requirement wording.
- `.planning/ROADMAP.md` §"Phase 79: Comparison, Aggregation & Report" (lines 316-328) — goal + 4 success criteria (note criterion 4: all-fail variant shown as "no successful runs").
- `.planning/v7.5-MILESTONE-AUDIT.md` — the audit that scoped this phase as net-new; warns `run-compare.tsx` and `report-read/write.mjs` are **NOT** variant-aggregators (false-positive trap).

### Existing Run KB substrate (READ — this is what Phase 79 aggregates over)
- `lib/experiments/query.mjs` — `readRuns(store, { includePending })` is the read seam; caller owns store open/close.
- `lib/experiments/run-write.mjs` — the **Run record shape**: `task_hash, agent, model, framework, variant, repeat, terminal_state (complete|timeout|abort), skip_reason, base_variant`, 6 flat route heuristics, token totals (`totalTokens/inputTokens/outputTokens/reasoningTokens`), wallclock. `task_hash` stays constant across `run_id` salt (comparability preserved).
- `lib/experiments/score-write.mjs` — the `Run--scored-->Score` edge + 5 LOCKED rubric dims + `goal_aligned_ratio` + `not_scored:'trivial'` tri-state (relevant to D-07/D-08 null-rubric handling).
- `lib/experiments/store.mjs` — `openExperimentStore()` (caller owns lifecycle).
- `scripts/experiments-query.mjs` — the existing operator CLI pattern to mirror for the new compare CLI.

### Do NOT mistake for CMP deliverables (audit warning)
- `lib/experiments/report-read.mjs` / `report-write.mjs` — Phase 74's saved-query "Report" feature, NOT variant/variance aggregation.
- `integrations/system-health-dashboard/.../run-compare.tsx` — pre-existing manual two-run A/B delta viewer, NOT a variant-matrix aggregator.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `readRuns()` (query.mjs): the exact read path — returns all Run rows with the fields needed for grouping/aggregation. No new store plumbing required.
- The Run record already carries `task_hash`, `variant`, `repeat`, `terminal_state`, token totals, wallclock, and the 6 route heuristics **flat** — aggregation is pure in-memory group-by, no schema migration.
- `Run--scored-->Score` edge gives the rubric score per run for the composite metric.

### Established Patterns
- `lib/experiments/*.mjs` (logic) + `scripts/experiments-*.mjs` (operator CLI) split — mirror it: new `compare.mjs` aggregator + `experiments-compare.mjs` CLI.
- `?? null` never `?? 0` for missing fields (run-write.mjs D-02 idiom) — preserve null vs zero distinction in aggregation (a null metric ≠ 0).
- Caller-owns-store lifecycle: the compare code receives an already-open store and never opens/closes it.

### Integration Points
- **Upstream:** consumes Phase 78 Runs via `readRuns` — 36 live Run rows already exist (incl. multi-agent compare-fizzbuzz-v9*), so Phase 79 can be built and verified against real data immediately, independent of the Phase 78-05 live smoke gate.
- **Downstream:** the JSON export at `.data/experiments/reports/<task_hash>.json` is the contract Phase 80 (CMP-04) renders as dashboard variant columns. Schema stability is a hard requirement across the 79→80 seam.
- **Gate signal dependency (D-04):** if the `test_command` outcome is not already persisted on the Run, CMP-01 needs a coordinated small addition on the Phase 78 runner side.

</code_context>

<specifics>
## Specific Ideas

- Recurring principle across all four decisions: **never let a failed/ungated/unscored run masquerade as a cheap winner.** Failed → separate section; ungated → shown-not-ranked; unscored → separate group. Honesty over completeness of the ranking.
- Surface `n` prominently so low-repeat winners are visibly less trustworthy.

</specifics>

<deferred>
## Deferred Ideas

- **Dashboard variant columns (CMP-04)** — Phase 80.
- **Installed `experiment run` cross-agent skill (ORCH-01)** — Phase 80.
- **Reviewed Todos (not folded):** `2026-05-23-orphan-digest-observation-refs.md` and `2026-06-10-okm-express-api-contract-bridge.md` matched only on generic keywords (export/phase/run) — unrelated to variant comparison; not folded.

</deferred>

---

*Phase: 79-comparison-aggregation-report*
*Context gathered: 2026-07-13*
