# Phase 85: Experiment Control Center - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Experiments can be **launched, re-run, monitored, and cancelled from the performance dashboard**. Three new detached-run trigger APIs land on vkb-server — `POST /api/experiments/run`, `run-status`, `run-cancel` — plus an experiment-launcher UI on the performance tab. Re-run means: same `snapshot_id`, param overrides, and a `rerun_of` linkage on the new Run records. Monitoring is progress-file polling (the runner gains a native progress emitter). Depends on Phase 78 (runner CLI); parallelizable with Phase 84 (done).

**Out of scope (belongs elsewhere):**
- Variant-column comparison display + `experiment run` skill packaging → **Phase 80**.
- Success-gate / variance aggregation / ranked report → **Phase 79**.
- The **difference viewer** (divergence-point trajectory diff between two runs) → **Phase 86** (Timeline v2); Phase 85 only lays its data foundation (see D-08/D-09 and Deferred).
- Avenue re-runs forked from interactive spans → **Phase 87** (which depends on this phase).

**Dependency note:** Phase 78 is 4/5 — the real-agent live smoke gate (78-05) has not run yet. The runner CLI this phase wraps exists and is unit/fake-seam proven; its live multi-agent proof is pending. Phase 85 planning should not block on 78-05, but the phase's own live verification will implicitly exercise it.

</domain>

<decisions>
## Implementation Decisions

### Detached-run architecture
- **D-01: vkb-server detached spawn.** `POST /api/experiments/run` makes vkb-server (host-side :8080 — the dashboard container already proxies `/api/experiments` to `host.docker.internal:8080`) spawn `node scripts/experiment-run.mjs` with `detached: true` + `unref()`, fixed-argv (no shell strings). Each run gets a run-dir holding pid + launch metadata. A vkb-server restart does NOT kill the run (orphan keeps running); status is recovered from the progress file + pid liveness. No new daemon, no launchd job queue.
- **D-02: Strict 409 concurrency guard.** Launch refuses with 409 when the single measurement-span slot is contended — an interactive span is active (`active-measurement.json` exists) OR another experiment run is live. Response names the holder (task_id / running run_id). No force flag, no queueing — the token mis-attribution hazard (any concurrent main-session LLM call gets stamped with the cell's task_id; see the UNATTENDED caveat in `scripts/experiment-run.mjs`) is severe enough that overlap is simply never allowed. Mirrors the existing `handleMeasurementStart` 409 pattern.

### Progress contract
- **D-03: Native progress emitter in runMatrix.** `lib/experiments/experiment-runner.mjs` gains a best-effort, never-throw progress writer that updates `progress.json` at every cell state transition (restoring → launching → running → scoring → terminal). Emitting from the source keeps states accurate and benefits manual CLI runs too. Honors the house never-block contract (Phase-84 D-02 lineage): progress write failure → stderr, never aborts a cell.
- **D-04: Full per-cell matrix granularity.** `progress.json` carries one entry per variant×repeat cell — state (`pending/restoring/running/scoring/complete/timeout/abort/skipped`), started/ended timestamps, composite task_id, skip/abort reason — plus a run-level header: spec name, `snapshot_id`, pid, done/total counts, overall state. `run-status` serves the file verbatim (house thin-read-API pattern, graceful-empty on ENOENT). No live agent-output tail (rejected: hot-path churn + redaction scope).

### Re-run semantics
- **D-05: New run identity — all cells re-execute.** A re-run mints a new `run_id` that salts the composite task_id (`task_hash` unchanged for comparability), so every cell executes fresh from the same `snapshot_id`. New Run records carry `rerun_of: <original run_id>`. D-10 idempotent resume (Phase 78) remains a distinct concept that operates WITHIN a run identity — rerun ≠ resume.
- **D-06: Overridable params = CLI-narrowing set + per-variant model/agent.** Re-run accepts repeats, timeout, variant subset (what `experiment-run.mjs` already takes) AND per-variant model/agent overrides (user explicitly wants quick what-ifs from a finished run).
- **D-07: Mutated variants get a derived, auto-suffixed name.** When a re-run overrides a variant's model/agent, the new Run's variant name records the change (e.g. `A` → `A@opus-4.8`), with the original preserved as `base_variant`. Aggregations (Phase 79) and compare views never silently mix two different bundles under one label; the `rerun_of` link still pairs the runs.

### Cancel semantics
- **D-08: Hard kill, abort recorded, resumable.** `run-cancel` SIGTERM→SIGKILLs the runner process group, reusing the Phase-78 D-04 timeout-kill machinery. The in-flight cell lands as `abort`; remaining cells stay `pending` in progress.json; overall state becomes `cancelled`. A cancelled run is resumable later via D-10 resume (the aborted cell retries). No graceful finish-current-cell mode — a dashboard cancel button must act immediately and predictably.

### Launcher UI scope
- **D-09: Spec picker + overrides — the dashboard launches, never edits.** The launcher lists existing `config/experiments/*.yaml` specs (small list API), shows the resolved matrix (variants × repeats = N cells) BEFORE launch, and offers override fields (repeats, timeout, variant subset). No in-dashboard spec builder or YAML editor — spec authoring stays in the editor / git.
- **D-10: Monitoring panel = cell grid + header, 5s polling.** Straight render of progress.json: run header (spec, snapshot, overall state, done/total, elapsed, Cancel button) + a variant×repeat grid with per-cell state chips and abort/skip reasons. Completed cells link to the existing Runs table / timeline views. Follows the `measurement-control.tsx` polling pattern (5s interval) and `performanceSlice.ts` thunk+selector shape. No live log-tail streaming endpoint.
- **D-11: Re-run entry point lives on the finished run.** A Re-run button on a completed experiment's run header / runs-table row opens the launcher pre-filled (same spec + `snapshot_id`, `rerun_of` set) with the D-06 override fields. No base-run dropdown inside the launcher.

### Claude's Discretion
- run_id format, run-dir location/naming (suggested: under `.data/experiments/runs/<run_id>/`), and the exact salting scheme for the composite task_id (must not break `safeSanitizeTaskId` / slug length limits — see the Pitfall-1 truncation note in `experiment-runner.mjs`).
- Exact progress.json field names, the API response envelope, and pid-liveness detection details (stale-pid → state `orphaned`/`unknown` handling).
- The spec-list endpoint shape and how resolved-matrix preview is computed (reuse `resolveExperimentSpec` server-side).
- How the derived variant suffix is rendered (`@model` vs another convention) as long as `base_variant` is preserved.
- Redux slice layout for launcher/monitor state (extend `performanceSlice` vs a new slice).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Runner CLI + matrix engine (the thing being wrapped)
- `scripts/experiment-run.mjs` — operator CLI; flags (`--spec/--variant/--repeats/--timeout`), env contract (`CODING_REPO`, `LLM_PROXY_DATA_DIR`, `LLM_PROXY_PORT`, `CODING_PROXY_ROUTE`), `EXPERIMENT_RUN_FAKE` test seam, and the **UNATTENDED single-span-slot caveat** that motivates D-02.
- `lib/experiments/experiment-runner.mjs` — `runMatrix` engine: sequential idempotent loop, D-10 resume done-set, composite task_id (+ Pitfall-1 slug truncation), SIGTERM→SIGKILL timeout kill (the machinery D-08 reuses), terminal states.
- `lib/experiments/experiment-spec.mjs` — `resolveExperimentSpec` / `validateCells` (server-side matrix preview for D-09; variant bundle shape for D-06/D-07 overrides).
- `lib/experiments/run-write.mjs` + `lib/experiments/query.mjs` — Run record shape (where `rerun_of` / `base_variant` metadata lands) and `readRuns` (resume ledger).

### API host (where the three new routes land)
- `lib/vkb-server/api-routes.js` — all existing `/api/experiments/*` routes; `handleMeasurementStart` (~887) is the exact 409-guard template for D-02; `handleMeasurementStop` shows the current no-spawn precedent D-01 deliberately breaks; `handleReconciliation`/`handleContextTurns` are the thin verbatim-serve read-API template for `run-status`.
- `integrations/system-health-dashboard/server.js` — the container→host proxy for `/api/experiments` (~346; forwards to `host.docker.internal:8080`) — new routes ride this for free, verify path passthrough.

### UI templates
- `integrations/system-health-dashboard/src/components/performance/measurement-control.tsx` — the layout + 5s-polling + start/stop thunk pattern the launcher mirrors (D-10).
- `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts` — thunk/selector conventions (`fetchTimeline`, `fetchActiveMeasurement`, `startMeasurement`/`stopMeasurement`).
- `integrations/system-health-dashboard/src/components/performance/runs-table.tsx` + `run-compare.tsx` — where the D-11 Re-run button and completed-cell links integrate.

### Prior locked decisions this phase inherits
- `.planning/phases/78-autonomous-cross-agent-runner/78-CONTEXT.md` — D-04 (terminal states + kill machinery), D-06 (20-min default timeout), D-09 (sequential single-owner), D-10 (idempotent resume — the semantics D-05 salts around), D-12 (required vs best-effort agents).
- `.planning/phases/77-experiment-spec-per-variant-snapshot-foundation/77-CONTEXT.md` — spec/restore foundation (`restoreForCell`, snapshot identity) that "same snapshot_id" re-runs rely on.
- `CLAUDE.md` — no-console-log (`process.stderr.write`), fixed-argv exec only, constraint-dodging forbidden, dashboard rebuild recipe (bind-mount + VirtioFS cache gotchas for UI verification).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`runMatrix`** (`experiment-runner.mjs`): the entire matrix loop exists — this phase adds a progress-emitter option and a run-identity salt, it does NOT rebuild orchestration.
- **`handleMeasurementStart` 409 guard** (`api-routes.js` ~887): copy for the D-02 launch guard (same `active-measurement.json` check + `409 + holder` response shape).
- **Thin read-API pattern** (`handleReconciliation` / `handleContextTurns`): verbatim-serve + graceful-ENOENT — the `run-status` template.
- **`measurement-control.tsx` + `performanceSlice.ts`**: polling control card + Redux thunks — the launcher/monitor UI skeleton.
- **`resolveExperimentSpec`**: fail-fast spec resolution — reuse server-side for the pre-launch matrix preview (D-09).
- **SIGTERM→SIGKILL kill helper** in `experiment-runner.mjs` (grace pattern from `server-manager.js:162-167`): the D-08 cancel reuses it against the detached pid.

### Established Patterns
- **Never-throw / best-effort** on all write hooks (progress emitter inherits this).
- **Fixed-argv, no-shell exec** — mandatory for the detached spawn and the cancel kill.
- **Recorded-state, never silently absent** (Phase 77/78 lineage) — extended here to `cancelled` overall state + `pending` remaining cells.
- **Dashboard container never spawns host work** — everything host-side goes through vkb-server :8080 (D-01 keeps this boundary; the container only proxies).

### Integration Points
- New routes in `api-routes.js`: `POST /api/experiments/run`, `GET /api/experiments/run-status` (or `/runs/:runId/status`), `POST /api/experiments/run-cancel` + a spec-list endpoint.
- Progress emitter hooks inside `runMatrix` cell loop; run-dir under `.data/experiments/` (exact path Claude's discretion).
- `rerun_of` / `base_variant` metadata → `run-write.mjs` Run records (consumed later by Phase 79 aggregation + Phase 86 difference viewer).
- Launcher card + monitor grid on the performance tab beside `measurement-control.tsx`; Re-run button in `runs-table.tsx` row actions.

</code_context>

<specifics>
## Specific Ideas

- **The difference viewer is the user's north star for re-runs**: "see where two runs differ and how the different decisions lead to more or fewer tokens, more or fewer loops." The viewer itself is Phase 86, but Phase 85 must make run-pairing first-class: `rerun_of` on every re-run Run record, `base_variant` on mutated variants, and same-`task_hash` comparability preserved (D-05/D-07). Planner: treat the pairing metadata as a hard requirement, not decoration.
- **Dashboard launches, never edits** — spec YAML stays in git; the UI is a control surface, not an authoring surface (D-09).
- **A cancel button must act immediately** — no "graceful after current cell" surprise latency (D-08).

</specifics>

<deferred>
## Deferred Ideas

- **Difference viewer — divergence-point trajectory diff** (→ **Phase 86**, decided this discussion): align two runs' per-turn sequences (context-turns + timeline), find the first divergence (different tool call / approach), render side-by-side trajectories from that point with cumulative token deltas and flagged tool-call loops. Consumes Phase-85 `rerun_of` pairs, Phase-84 context-turns, and Phase-86 per-turn UI components. **Suggest folding into Phase 86's scope line when planning that phase** (it already owns "compare-from-selection").
- **Queueing launches when the span slot is busy** — rejected for D-02 (surprise late starts = mis-attribution); revisit only if operators demand it.
- **Live agent-output tail in the monitor** — rejected for D-04/D-10 (hot-path churn, redaction scope, needs streaming endpoint); Phase 86+ could add it if wanted.
- **Graceful cancel-after-cell mode** — rejected for D-08; could return as an optional flag if hard-kill abort noise becomes annoying.
- **In-dashboard spec builder/editor** — rejected for D-09; specs stay git-authored.

### Reviewed Todos (not folded)
The `todo.match-phase` scan surfaced only low-relevance keyword matches (score ≤0.6: obs-api SIGTERM crash, OKM Express API contract, sub-agent dashboard observability gap, hierarchy wire-up, km-core store consolidation, orphan digest refs, LSL timeline 200-cap) — the same set reviewed and not folded in Phases 78/84. None concern experiment launching/control. The sub-agent observability gap is tangentially adjacent (isolated sandboxes + dashboard) but Phase-85 monitoring is progress-file-based, not observation-based — not folded.

</deferred>

---

*Phase: 85-experiment-control-center*
*Context gathered: 2026-07-08*
