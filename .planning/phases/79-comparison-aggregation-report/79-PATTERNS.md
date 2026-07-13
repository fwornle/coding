# Phase 79: Comparison, Aggregation & Report - Pattern Map

**Mapped:** 2026-07-13
**Files analyzed:** 5 (2 CREATE, 3 MODIFY)
**Analogs found:** 5 / 5

Phase 79 is a **backend/CLI** phase — no web UI (dashboard variant columns = Phase 80). It delivers CMP-01/02/03: persist an objective gate per run, aggregate N repeats per variant with variance, emit a ranked comparison report (CLI table + JSON export keyed by `task_hash`).

The whole phase mirrors ONE established split (CONTEXT D-04a-B, RESEARCH "Established Patterns"): a pure `lib/experiments/*.mjs` logic module + a `scripts/experiments-*.mjs` operator CLI. Nothing here opens a store inline — the CLI opens via `openExperimentStore()` and passes the already-open store down (caller-owns-store).

**Audit false-positive trap (CONTEXT canonical_refs):** `lib/experiments/report-read.mjs` / `report-write.mjs` are Phase 74's saved-query "Report" feature, NOT variant/variance aggregators. `run-compare.tsx` is a manual two-run A/B delta viewer. Do NOT extend either — `compare.mjs` and `scripts/experiments-compare.mjs` are net-new (confirmed absent on disk).

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `lib/experiments/compare.mjs` (CREATE) | service (pure aggregator) | transform / batch | `lib/experiments/query.mjs` (readRuns join seam) + `lib/experiments/token-aggregate.mjs` (aggregation idioms) | role+flow match |
| `scripts/experiments-compare.mjs` (CREATE) | CLI (operator) | request-response (stdin argv → stdout table + file) | `scripts/experiments-query.mjs` | exact |
| `scripts/measurement-stop.mjs` (MODIFY — gate persist) | orchestrator (close path) | event-driven (span close) | itself, lines 849-863 (evidence→judgment→writeScore) | in-place edit |
| `lib/experiments/score-write.mjs` (MODIFY — add `gate_passed`) | service (KB writer) | CRUD (idempotent putEntity) | itself, the Score.metadata block lines 126-156 | in-place edit |
| `lib/experiments/evidence-harness.mjs` (READ — no edit; gate source) | utility (pure) | transform | n/a (source of the gate signal) | reference |

---

## Pattern Assignments

### `lib/experiments/compare.mjs` (service, transform/batch) — CREATE

The aggregator: group `readRuns()` rows by `variant` within a `task_hash`, apply the D-01 gate, compute `{mean,stddev,median,min,max,n}` per metric, rank by composite `total_tokens / rubric_score` ascending (D-05). Pure in-memory group-by — **no store plumbing, no schema migration**. Caller passes the already-open store (or the pre-read rows).

**Analog A — the read/join seam:** `lib/experiments/query.mjs` `readRuns(store, { includePending })`

**Module header + contract convention to copy** (query.mjs:1-24) — every experiment `lib/` module opens with a block-comment stating: which requirement/decision it serves, the caller-owns-store contract, the join keys, the null-not-zero rule, and `process.stderr.write` (no console). Copy this shape verbatim.

**The join `compare.mjs` consumes** — `readRuns` already returns each Run joined to its Score + Outcome (query.mjs:99-117). `compare.mjs` calls `readRuns(store)` and receives rows shaped `{ ...run.metadata, goal_sentence, score: Score.metadata|null, outcome: Outcome.metadata|null }`:
```javascript
// query.mjs:100-116 — the join compare.mjs reads (do NOT re-implement)
for await (const e of store.iterate({ entityType: 'Run' })) {
  const meta = e.metadata ?? {};
  if (meta.pending && !includePending) continue; // D-06 quarantine
  const taskId = meta.task_id;
  rows.push({
    ...meta,                                    // task_hash, variant, repeat, terminal_state, tokens, 6 heuristics
    goal_sentence: (typeof e.description === 'string' && e.description.trim()) ? e.description : null,
    score: scoreMap.get(taskId) ?? null,        // ← rubric dims + goal_aligned_ratio + gate_passed (Phase 79)
    outcome: outcomeMap.get(taskId) ?? null,    // ← totalTokens/inputTokens/outputTokens/reasoningTokens
  });
}
```
So a Run row already carries (from run-write.mjs:100-146, flat on `metadata`): `task_hash`, `variant`, `repeat`, `terminal_state` (`complete|timeout|abort`), `skip_reason`, `base_variant`, `rerun_of`, and the **6 route heuristics flat** (`loop_count`, `edit_revert_count`, `redundant_read_count`, `abandoned_tool_count`, `total_step_count`, `wallclock_per_step`). Token totals live on the joined `outcome` (`outcome.totalTokens` etc.). The rubric lives on the joined `score` (5 dims + `goal_aligned_ratio`). **This is the exact shape to group and aggregate — no new read path.**

**The `effectiveDimension` rule to reuse for rubric reads** (query.mjs:44-62) — the corrected-wins rule (human `corrected_<dim>` beats judge `<dim>`, else null, never coerced to 0). If `compare.mjs` needs a per-dimension rubric value, import and reuse `effectiveDimension(score, dim)` — do NOT re-derive corrected-vs-judged.

**The gate join (Phase 79 D-04a):** the persisted `gate_passed` field lands on `score.metadata.gate_passed` (see the score-write edit below). So `compare.mjs` reads it off the joined score: `const gate = row.score?.gate_passed ?? null;` — `null` = ungated (no `test_command`, D-02) → shown-not-ranked; `false` = failed the objective test → failed section (D-03); `true` = eligible for the ranked cost comparison (only when ALSO `terminal_state === 'complete'`, D-01).

**Analog B — aggregation idioms:** `lib/experiments/token-aggregate.mjs`

**Group-by + graceful-degradation shape** (token-aggregate.mjs:78-121) — the module demonstrates the house group-by/classifier style: a small pure exported predicate (`isForegroundGroup`), a `zeroTotals()` empty-shape helper, and early-return degradation on bad input (`typeof taskId !== 'string' → return zero-result`). Mirror this: export the gate predicate (e.g. `isRankable(row)`), a `zeroStats()`/`emptySummary()` shape, and return an empty summary rather than throwing on empty input.

**The null-not-zero idiom is LOAD-BEARING for the variance math (D-09, CONTEXT "Established Patterns"):** run-write.mjs:141-146 and query.mjs:96-98 both preserve `null` as "could not compute" — never `?? 0`. When aggregating a metric across N repeats, **a `null` heuristic value must be EXCLUDED from the `{mean,stddev,median,min,max,n}` computation, not treated as 0.** `n` is the count of *non-null* contributing values (so a variant with 3 repeats but one null loop_count reports `n:2` for that metric). This is why D-10 surfaces `n` prominently: a null ≠ 0, and averaging in a fabricated 0 would understate the metric. Never divide by zero/null to fabricate a composite rank (D-07 — a `not_scored:'trivial'`/null-rubric run goes to the "unscored" group, not ranked).

**Ranking (D-05/D-06/D-07):** default composite = `total_tokens / rubric_score` ascending, over successful-gated runs only. `--rank-by tokens|wallclock|score|composite` overridable. `rubric_score` source (D-08 — planner to confirm & DOCUMENT in the export schema): either `score.goal_aligned_ratio` alone or a defined aggregate of the 5 locked dims (`goal_achieved`, `code_quality`, `test_coverage`, `regressions`, `spec_drift`) read via `effectiveDimension`.

**Logging:** `process.stderr.write('[experiments] compare ...\n')` — mirror query.mjs:119-122. No `console.*` (CLAUDE.md no-console-log).

---

### `scripts/experiments-compare.mjs` (CLI, request-response) — CREATE

The operator CLI: ranked table to **stdout**, JSON export to **`.data/experiments/reports/<task_hash>.json`** (D-11), `--csv` opt-in (D-12), `--rank-by` override (D-06). This is an **exact-shape clone** of `scripts/experiments-query.mjs` — same shebang, arg parser, store-open-in-`main`, `try/finally close()`, entry-point guard, and named exports for the pure helpers (so tests import without running `main`).

**Analog:** `scripts/experiments-query.mjs`

**Header + shebang + arg parser** (experiments-query.mjs:1-39):
```javascript
#!/usr/bin/env node
/** Operator CLI — ... Output via process.stdout.write / process.stderr.write only
 * (no console.* — no-console-log / CLAUDE.md). Usage: node scripts/experiments-compare.mjs ...
 * Analog: scripts/experiments-query.mjs (CLI arg parse → store open/iterate → close in finally). */
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { openExperimentStore } from '../lib/experiments/store.mjs'; // ontologyDir set inside — NEVER `new GraphKMStore` here

function parseStrArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] ?? null;
}
```
Add a `--task-hash <h>` required filter, a `--rank-by <metric>` (default `composite`), and a boolean `--csv` (presence check: `argv.includes('--csv')`).

**Store open/close lifecycle in `main`** (experiments-query.mjs:105-126) — copy exactly. The CLI is the ONLY place that opens the store; it passes the open store into `compare.mjs`:
```javascript
async function main() {
  const args = process.argv.slice(2);
  const taskHash = parseStrArg(args, '--task-hash');
  const rankBy = parseStrArg(args, '--rank-by') ?? 'composite';
  const store = await openExperimentStore();   // ontologyDir honoured inside store.mjs (CLAUDE.md km-core rule)
  try {
    const rows = await readRuns(store);        // the join seam — reuse, don't re-read
    const report = buildComparison(rows, { taskHash, rankBy }); // compare.mjs pure aggregator
    process.stdout.write(renderTable(report));                  // human-facing ranked table
    writeReportJson(report, taskHash);                          // .data/experiments/reports/<task_hash>.json
    if (args.includes('--csv')) writeReportCsv(report, taskHash);
  } finally {
    await store.close();                       // caller owns close (query.mjs / score-write contract)
  }
}
```

**Entry-point guard + FATAL wrapper + named exports** (experiments-query.mjs:128-145) — copy verbatim so the pure helpers (`renderTable`, `writeReportJson`, etc.) are importable by the node:test file WITHOUT invoking `main()`:
```javascript
const isMain = (() => {
  try { return import.meta.url === pathToFileURL(process.argv[1]).href; } catch { return false; }
})();
if (isMain) {
  main().catch((err) => { process.stderr.write(`FATAL: ${err.stack || err.message}\n`); process.exit(1); });
}
export { buildComparison, renderTable, writeReportJson, writeReportCsv };
```

**Report dir:** `.data/experiments/` already exists (holds `exports/`, `runs/`, `snapshots/`); the `reports/` subdir does NOT yet exist — `writeReportJson` must `fs.mkdirSync(reportsDir, { recursive: true })` before writing `<task_hash>.json`.

**Output discipline:** table + progress → `process.stdout.write`; diagnostics → `process.stderr.write`. No `console.*` (CLAUDE.md). D-13: the JSON schema must include per-variant gate outcome, the full `{mean,stddev,median,min,max,n}` block per metric, the rank, and the failed/ungated/unscored groupings. Schema field names are stable (Phase 80 consumes them) — DOCUMENT them in the SUMMARY (CONTEXT Claude's Discretion).

---

### `scripts/measurement-stop.mjs` (orchestrator, event-driven) — MODIFY (gate persist, D-04a part A)

**The gate signal is ALREADY computed here** — this is the small additive change. At close time (lines 849-863) the evidence harness runs the objective test and the result is already in-hand; today it is only *consumed to derive subjective rubric dims* (`overlayNonGsdRubric`), never persisted as a discrete queryable gate. Phase 79 threads the objective pass/fail into the judgment so `writeScore` persists it.

**Analog:** `scripts/measurement-stop.mjs` itself, the score path (lines 849-863):
```javascript
// measurement-stop.mjs:849-863 — evidence → judge → overlay → writeScore
const evidence = gatherEvidence({ span, phaseArg, repoRoot: REPO_ROOT });   // ← evidence.testRun = { status, counts }|null
const consequential = trace ? filterConsequential(trace) : [];
judgment = isTrivialRun(trace)
  ? { not_scored: 'trivial' }
  : await runJudge({ span, trace: consequential, evidence });
overlayNonGsdRubric(judgment, evidence);   // gap-fills rubric dims from the SAME test result
await writeScore(store, { span, judgment });
```

**The gate value derivation** — `gatherEvidence` returns `evidence.testRun` shaped `{ status: number|null, counts: {passed,failed}|null } | null` (evidence-harness.mjs:387-390, and `runTestCommand` at 278-302). The gate is exactly:
- `evidence.testRun == null` (no `test_command` / no runnable test — D-02) → `gate_passed = null` (ungated).
- `evidence.testRun.status === 0` → `gate_passed = true`.
- otherwise (non-zero exit / failed counts) → `gate_passed = false`.

This mirrors the existing `regressionsFromRun` logic (evidence-harness.mjs:347-353) — reuse that null/exit-status shape; do NOT run the test a second time (D-04: the sandbox worktree is destroyed after the run, so re-deriving at compare time is infeasible). **Recommended:** add a tiny pure exported helper in `evidence-harness.mjs`, e.g. `export function gateFromEvidence(evidence)` returning `true|false|null`, then thread `judgment.gate_passed = gateFromEvidence(evidence)` right after `overlayNonGsdRubric(...)` and BEFORE `writeScore(...)`. Keep it null-not-zero (never coerce a missing test to `false`).

**overlayNonGsdRubric mutate-in-place idiom to mirror** (measurement-stop.mjs:107-116) — the phase already mutates the judgment object before `writeScore`; the gate stamp follows the same "compute-once, attach-to-judgment, single writeScore" pattern:
```javascript
function overlayNonGsdRubric(judgment, evidence) {
  if (!judgment || judgment.not_scored === 'trivial') return;
  const derived = deriveNonGsdRubric(evidence);
  const rubric = judgment.rubric ?? (judgment.rubric = {});
  for (const dim of NON_GSD_DIMS) {
    if ((rubric[dim] ?? null) === null && derived[dim] !== null) rubric[dim] = derived[dim];
  }
}
```
Note: this is additive — do NOT change the existing rubric-derivation behaviour (API-preservation rule, CLAUDE.md).

---

### `lib/experiments/score-write.mjs` (service/CRUD) — MODIFY (add `gate_passed` to Score.metadata)

**The one edit:** accept `judgment.gate_passed` and persist it as a discrete field on the Score entity's metadata, alongside `goal_aligned_ratio` and the 5 rubric dims. This is where the harness result already lands (CONTEXT D-04a: "Score is where the harness result already lands").

**Analog:** `score-write.mjs` itself, the `metadata` block (lines 126-156):
```javascript
// score-write.mjs:126-146 — add gate_passed next to the judged fields, null-not-zero
metadata: {
  domain: 'experiment',
  run_task_id: span.task_id,
  goal_aligned_ratio: j.goal_aligned_ratio ?? null,
  // ...event_labels, ratio_rationale...
  goal_achieved: rubric.goal_achieved ?? null,
  code_quality: rubric.code_quality ?? null,
  test_coverage: rubric.test_coverage ?? null,
  regressions: rubric.regressions ?? null,
  spec_drift: rubric.spec_drift ?? null,
  // ── CMP-01 / Phase 79 (D-04a): the OBJECTIVE per-cell test-gate outcome, DISTINCT
  //    from the subjective rubric (D-04). true = test exited 0; false = non-zero;
  //    null = no test_command (ungated per D-02). NEVER `?? false` — null-not-zero. ──
  gate_passed: j.gate_passed ?? null,
  // ...pending, not_scored, corrected_* (unchanged) ...
}
```

**Idempotency + override preservation are already handled** (score-write.mjs:72-104, 149-156) — the Score is keyed on `metadata.run_task_id`, re-judge UPDATES the same node, and `corrected_*` overrides carry forward. `gate_passed` is a *judged* field (overwritten on re-judge like the rubric dims), NOT a corrected field — so it sits with the judged block, not the `corrected_*` block. Update the JSDoc `@param args.judgment` typedef (lines 61-69) to add `gate_passed?: boolean|null`.

**Update the JSDoc contract in query.mjs** — no code change needed there (`...meta`/`...score` already surfaces the new field via `scoreMap.get(taskId)`), but note in the SUMMARY that `readRuns` rows now expose `row.score.gate_passed`.

---

## Shared Patterns

### Caller-owns-store lifecycle
**Source:** `lib/experiments/store.mjs` (openExperimentStore, ontologyDir set inside) + `scripts/experiments-query.mjs:111-125` (open in `main`, `try/finally close()`).
**Apply to:** `scripts/experiments-compare.mjs` (opens) and `lib/experiments/compare.mjs` (receives an already-open store, NEVER opens/closes/constructs one).
Do NOT `new GraphKMStore(...)` anywhere — the ontologyDir rule (CLAUDE.md km-core) is honoured only via `openExperimentStore()`. `compare.mjs` ideally takes the pre-read `rows` (from `readRuns`) so it is trivially unit-testable with synthetic fixtures (CONTEXT D-04b) and never touches a store at all.

### Null-not-zero (`?? null` never `?? 0`)
**Source:** `lib/experiments/run-write.mjs:141-146`, `lib/experiments/score-write.mjs:133-141`, `lib/experiments/query.mjs:96-98`.
**Apply to:** every new field (`gate_passed`), every metric aggregation (exclude nulls from `{mean,stddev,median,min,max,n}`; `n` counts non-null contributors), and the composite rank (never divide by null/0 — route null-rubric to the "unscored" group, D-07).

### Module header contract comment
**Source:** `lib/experiments/query.mjs:1-24`, `run-write.mjs:1-30`, `score-write.mjs:1-39`.
**Apply to:** `compare.mjs` — open with a block comment stating the requirement (CMP-01/02/03), the decisions honoured (D-01..D-13), the caller-owns-store + null-not-zero contracts, the join keys it consumes, and the `process.stderr.write` (no console.*) rule.

### stdout/stderr only (no console.*)
**Source:** `scripts/experiments-query.mjs` (stdout for results, stderr for diagnostics), `query.mjs:119-122`.
**Apply to:** both new files. CLAUDE.md no-console-log — table/JSON status → `process.stdout.write`; diagnostics → `process.stderr.write`. Do NOT dodge with a different raw-write API.

### Pure-helpers + entry-point guard (testability)
**Source:** `scripts/experiments-query.mjs:128-145` (isMain guard + named exports).
**Apply to:** `scripts/experiments-compare.mjs` — export `buildComparison`/`renderTable`/`writeReportJson`/`writeReportCsv` so the node:test file imports them without running `main()`. CONTEXT D-04b: unit/integration tests use synthetic Run+gate fixtures; the 36 pre-existing rows are ungated fixtures for the ungated/failed/unscored groupings + aggregation math; the ranked-successful path needs ≥1 fresh gate-persisted run.

---

## No Analog Found

None. Every new/modified file has a strong in-repo analog. The only net-new surface is the `.data/experiments/reports/` output directory (create with `fs.mkdirSync(..., { recursive: true })`) and the CSV writer (a trivial join of the JSON summary), neither of which needs a code analog.

---

## Metadata

**Analog search scope:** `lib/experiments/`, `scripts/experiments-*.mjs`, `scripts/measurement-stop.mjs`, `.data/experiments/`.
**Files scanned:** query.mjs, run-write.mjs, score-write.mjs, token-aggregate.mjs, evidence-harness.mjs, agent-headless.mjs, store.mjs, experiments-query.mjs, measurement-stop.mjs.
**Pattern extraction date:** 2026-07-13
