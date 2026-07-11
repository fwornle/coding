# Phase 87: Interactive Spans & Branch Avenues - Context

**Gathered:** 2026-07-11
**Status:** Ready for planning

<domain>
## Phase Boundary

A measurement span started from the **main interactive agent** captures an origin snapshot + the initial prompt. A completed span can be **forked into "avenues"** — headless re-runs of that same initial prompt with modified parameters (agent / model / SDD-framework / knowledge-injection), each executed on a persistent `avenue/<task_id>` git branch. Avenues are **grouped by origin span**, **compared in the dashboard**, and their **merge status is tracked** (a winning avenue can be promoted to main). Measurement data lives in the **main `.data` stores** so it survives across branch switches.

**In scope:** origin span capture from the live agent; the fork/launch UX + variant selection; headless avenue execution on `avenue/*` branches; origin-grouped N-way comparison + pairwise drill-down; merge-status tracking + promote-a-winner; branch persistence/prune lifecycle; cross-branch data survival.

**Out of scope (own phase / deferred):** varying the initial prompt text itself (the goal is "re-run the **initial prompt**"); net-new comparison metrics beyond those already produced by Phases 72/73/82/83.
</domain>

<decisions>
## Implementation Decisions

### Avenue launch & variant selection
- **D-01:** Launch surface is **dashboard-first, CLI-backed** — a "Fork into avenues" action on a completed span in the dashboard (Performance / 85 Control Center) is the primary UX, implemented as a **thin wrapper over a documented CLI / experiment-spec path** so power users can script sweeps. Do not build a UI-only path with no scriptable equivalent.
- **D-02:** Variant selection is **curated-by-default with opt-in sweep** — the user explicitly picks individual avenues (e.g. `claude-opus`, `copilot-gpt5`, `opencode-sonnet+gsd`), and a **sweep toggle** expands chosen dimensions into their cross-product. A sweep MUST show a **count + cost/token preview before launch** (guardrail against matrix explosion).

### Varied axes (what a fork changes; everything else held constant)
- **D-03:** The variant axes are **agent × model × framework × knowledge-injection**:
  - **Agent** — claude / copilot / opencode / mastra.
  - **Model** — opus / sonnet / gpt-5 / haiku / etc. (within/across agents).
  - **Framework** — the **SDD methodology harness**: `gsd`, `spec-workflow`, …, or **no framework at all**. (NOT a code framework.)
  - **Knowledge-injection** — **on/off toggle** for the injected observations / digests / insights / VKB context (the v6.0 knowledge-context-injection prefix), so the experiment can measure whether injection improves or worsens outcomes. This is a first-class avenue axis, not an afterthought.

### Merge semantics & branch lifecycle
- **D-04:** Avenues are **adoptable**, not throwaway — `avenue/<task_id>` branches hold the **real code changes** the re-run produced. The dashboard tracks **merge status** (merged / unmerged / conflicts, computed from git) and lets the user **promote a winning avenue back to main**.
- **D-05:** Branches **persist until explicitly pruned** (matches the goal's "persistent" wording) — a prune action cleans them up on demand. Measurement data is written to **main `.data` stores** regardless of branch, so pruning a branch never loses measurement data.

### Comparison presentation
- **D-06:** Comparison is **origin-grouped N-way + pairwise drill-down** — an origin-grouped panel shows all avenues side-by-side as ranked rows; selecting **any two** opens the **existing Phase 86-04 difference viewer** for the deep pairwise trajectory diff. Add a grouping/ranking layer on top of 86-04; do not rebuild trajectory diffing.
- **D-07:** Default ranking axis is **outcome score** (the Phase 73 success/outcome score — "best result first"), with **tokens/cost, route quality, and wall-clock** as secondary sortable columns.

### Origin snapshot fidelity
- **D-08:** Avenue re-runs start from a **full Phase 67 `RunSnapshot`** (git SHA + workspace dirty state + `.data/knowledge-graph` KB + `processOverrides` routing + prompt text + agent-affecting env + `.planning` state), restored via the existing `repro-restore` / `experiment-restore` rig, so every avenue starts **byte-identical** to the origin and only the D-03 axes vary. Reuse the proven rig rather than a lighter capture.

### Claude's Discretion
- Avenue execution isolation & parallelism (git worktree per `avenue/*` branch vs sequential; concurrency limits) — implementation detail for research/planning, but note the existing worktree machinery and the `.data/run-restores/*` worktree precedent.
- The exact mechanism for cross-branch data survival (writing measurement rows to main `.data` from a worktree/branch context without collision) — planner's call; must guarantee no per-branch data loss and no double-counting (see Phase 83 reconciliation identity rules).
- How the knowledge-injection on/off toggle is wired into each agent's launch (per-agent adapter/hook) — reuse the v6.0 injection seam.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Reproducibility / snapshot rig (origin capture + restore — D-08)
- `scripts/measurement-start.mjs` — how an interactive measurement span starts today (origin capture entry point).
- `scripts/measurement-stop.mjs` — span completion.
- `scripts/experiment-restore.mjs`, `scripts/repro-restore.mjs` — snapshot restore rig to reuse for avenue re-run origins.
- `.planning/phases/67-*/` (Reproducibility & Replay Rig) — `RunSnapshot` contents & guarantees (REPRO-01/02).

### Headless run engine + experiment surface (avenue execution — D-01/D-03)
- `scripts/experiment-run.mjs` — the Phase 78 autonomous cross-agent runner (the headless re-run engine avenues drive).
- `scripts/experiments-classify.mjs`, `scripts/write-session-state.js` — supporting runner infra.
- `.planning/phases/77-*/` (Experiment Spec & Per-Variant Snapshot Foundation) — the variant/spec model to extend with the D-03 axes.
- `.planning/phases/85-experiment-control-center/85-CONTEXT.md` — the Control Center surface the fork action plugs into.

### Comparison surface (D-06/D-07)
- `integrations/system-health-dashboard/src/components/performance/difference-viewer.tsx` — Phase 86-04 pairwise trajectory diff to reuse.
- `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts` — the slice holding run/compare state (`fetchContextTurns`, compare-selection, reconciliation).
- Phase 72/73 route-quality + outcome/success scoring — the ranking metrics (route quality, outcome score).

### Measurement data integrity (cross-branch survival — D-05)
- `.planning/phases/82-*/` (Wire-Measurement Foundation) and `.planning/phases/83-*/` (Token Reconciliation Layer) — wire-row identity + reconciliation rules that must hold when avenues on different branches write to the shared main `.data` store (avoid double-counting).

### Knowledge-injection axis (D-03)
- The v6.0 knowledge-context-injection system (per-agent adapters/hooks, Qdrant semantic search, 300-token working-memory prefix) — the seam the on/off toggle flips. (Confirm exact module paths during research.)

### Codebase maps
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/INTEGRATIONS.md`, `.planning/codebase/STRUCTURE.md` — orientation for the runner ↔ dashboard ↔ `.data` wiring.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Snapshot/replay rig** (`measurement-start/stop.mjs`, `experiment-restore.mjs`, `repro-restore.mjs`, Phase 67 `RunSnapshot`, `.data/run-restores/`): reuse wholesale for byte-identical avenue origins (D-08).
- **Headless run engine** (`experiment-run.mjs`, Phase 78): the execution path each avenue invokes with its varied params (D-03).
- **Difference viewer** (`difference-viewer.tsx`, Phase 86-04): pairwise trajectory diff for the drill-down (D-06); it self-reads `selectCompareA/selectCompareB` and aligns via the pure `run-align.ts`.
- **Control Center** (Phase 85 dashboard surface): host for the fork action (D-01).
- **`performanceSlice.ts`**: the frozen Redux contract (Phase 86-02) — extend, don't fork, for avenue grouping/compare state.

### Established Patterns
- **`avenue/<task_id>` branches are greenfield** — no existing `avenue` code; the branch-per-run pattern is new but the `.data/run-restores/*` detached worktrees are a precedent for isolated re-run checkouts + auto-prune sweepers.
- **Measurement data → main `.data` stores** (not per-branch): the existing exporters/obs stores already live in main `.data`; the constraint is that avenue runs on a branch/worktree must write back to the main store.
- **Honesty/identity rules** (Phases 82/83): wire-row identity keyed on SQLite rowid, reconciliation dedup — must be preserved so cross-branch avenue writes never double-count.

### Integration Points
- Dashboard fork action → CLI/spec → `experiment-run.mjs` with a variant matrix.
- Avenue runner → snapshot restore rig → git `avenue/*` branch (worktree) → main `.data` writeback.
- Avenue results → `performanceSlice` → origin-grouped N-way panel → 86-04 difference viewer.
</code_context>

<specifics>
## Specific Ideas

- **Knowledge-injection A/B is a headline use case:** the user specifically wants to toggle injected observations/digests/insights/VKB context on vs off across otherwise-identical avenues to measure whether the injection actually helps or hurts — treat this axis as a primary experiment, not a niche flag.
- **"Framework" means SDD harness** (gsd / spec-workflow / none), explicitly not a code framework — the variant picker and labels must reflect this.
- Sweeps must never silently launch a huge matrix — always a **count + cost preview** first.
</specifics>

<deferred>
## Deferred Ideas

- **Varying the initial prompt text** across avenues (prompt-variant experiments) — the phase goal is re-running *the initial prompt*; prompt mutation is a separate capability / future phase.
- The 18 pending todos surfaced during cross-reference were VKB/observability/data-integrity items (scores 0.4–0.6) unrelated to spans/avenues — **not folded**; they remain in the backlog for their own phases.

### Reviewed Todos (not folded)
- All 18 phase-matched todos were reviewed and **not folded** — none are in the span/avenue domain (they concern VKB rendering, observation-store integrity, LSL timeline, and the health-coordinator subscription-limit follow-up). Left in `.planning/todos/pending/` for future phases.
</deferred>

---

*Phase: 87-interactive-spans-and-branch-avenues*
*Context gathered: 2026-07-11*
