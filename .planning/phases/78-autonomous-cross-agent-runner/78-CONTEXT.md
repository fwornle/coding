# Phase 78: Autonomous Cross-Agent Runner - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the **autonomous runner** for the v7.5 cross-agent experiment: it takes the validated variant cells + per-cell snapshot restore from Phase 77 and actually **drives each agent headlessly against the goal inside a measured span**, producing exactly one **scored Run per variant × repeat cell** without operator steering. Copilot participation is gated on an explicit headless-drivability probe. Requirements: RUN-02, RUN-03, RUN-04.

Explicitly **NOT** in scope (later phases):
- Declaration/validation of the variant matrix and per-cell restore rig → **Phase 77 (done)**; this phase *consumes* it.
- The success gate, N-repeat variance analysis, and ranked comparison report (CMP-01/02/03) → **Phase 79**.
- Auto-routing / policy engine that consumes the comparisons → **v7.6**.

This phase **wires** shipped machinery (Phase-67 restore rig, Phase 77 spec/restore, the existing Run-KB `writeRun`/`judge`/`score-write`, and the per-agent `config/agents/*.sh` launchers). It does not rebuild any of them.

**Prerequisite note:** Phase 76 (VALID) must have landed and verified before this runner's Runs are trusted (per ROADMAP prerequisite ordering — VALID-01/03 fix model mis-attribution and non-GSD rubric coverage). This does not block *building* Phase 78, but the produced Runs are only trustworthy on top of a verified Phase 76.
</domain>

<decisions>
## Implementation Decisions

### RUN-02 — Autonomous launch mechanism & sandbox binding
- **D-01:** Drive each agent via a **thin per-agent headless adapter that reuses the existing `config/agents/*.sh` launch scripts** (resolved through `lib/agent-registry.js` / `lib/agent-detector.js`), passing each CLI's non-interactive/print flag. Do NOT build a parallel standalone driver layer, and do NOT carve a headless path into interactive `bin/coding`. Rationale: least new surface, keeps agent invocation in one place already used by the launcher.
- **D-02:** The agent runs with **`cwd` = the restored sandbox worktree** and **`LLM_PROXY_DATA_DIR` = the sandbox `.data/`** (the outputs of Phase 77's `restoreForCell` / `restoreSnapshot`), so all file edits AND token/route rows land inside the isolated cell — never the live checkout/KB. Blast radius stays zero (inherits Phase 77 D-10 / T-77-08).
- **D-03:** Each cell's work is wrapped in a **measured span** (via the existing `measurement-start.mjs` → `measurement-stop.mjs` seam) tagged with `variant`, `repeat`, and `task_hash` (RUN-02), threading the Phase-77 per-variant `span.meta` (`agent/model/framework/test_command`) that `measurement-stop.mjs` already reads.

### RUN-03 — Completion / timeout / abort semantics
- **D-04:** **Agent process exit is the completion signal.** `exit(0)` → the run is **complete**; a wall-clock timeout kills the process and records the Run as **`timeout`**; a non-zero or killed exit records **`abort`**. All three terminal states are recorded on the Run — none silently dropped (RUN-03).
- **D-05:** The per-variant **`test_command` runs AFTER completion, for scoring only** — it is NOT the completion gate. (Completion is process exit; the test suite feeds VALID-03 `test_coverage`/`regressions` via the Phase-76 `resolveTestCommand` path, not the done/abort decision.)
- **D-06:** **Default per-cell wall-clock timeout = 20 minutes**, overridable via a spec/CLI field. Long enough for a real coding task, bounded enough that a hung agent cannot stall the matrix.

### RUN-04 — Copilot headless-drivability spike
- **D-07:** Gate Copilot with a **minimal one-turn headless probe** — "can Copilot run one headless turn against a trivial prompt and exit 0?" — NOT a full end-to-end drive. This matches the `copilot + headless → unsupported` combination gate already seeded in `lib/experiments/experiment-spec.mjs` (which points here for resolution).
- **D-08:** On probe failure, the **Copilot variant cell is skipped with a recorded reason on the Run record** (e.g. `skipped: copilot-headless-unsupported`) — **never silently absent** (RUN-04). Known prior signal: Copilot per-prompt injection may not be supported, so this probe is expected to often conclude "skip"; the point is a *recorded* skip backed by an actual capability check, not a static assumption.

### SC#4 — Matrix orchestration (exactly one Run per cell)
- **D-09:** **Sequential cell execution** (one cell at a time across the isolated sandboxes) — not parallel. Keeps ordering deterministic, token attribution clean, and failure isolation simple for this phase. (Parallelism is a possible later optimization; the sandboxes are already isolated enough to allow it, but it is out of scope here.)
- **D-10:** **Idempotent cell identity = `task_hash + variant + repeat`.** A re-run of the matrix **skips already-completed cells**, so the terminal state is **exactly one Run per variant × repeat cell** (SC#4) and an interrupted matrix is resumable.
- **D-11:** **Scoring runs inline per cell** — `judge.mjs` / `score-write.mjs` execute right after each cell's span closes, so every Run is scored as it lands (no separate later pass, no window of unscored Runs).

### Scope of agents this phase
- **D-12:** **Claude + OpenCode are REQUIRED** to autonomously complete the full matrix this phase (satisfies SC#4's "≥2 agents end-to-end"). **Mastra is best-effort** — included if its headless drive works, otherwise a recorded-skip with reason (same pattern as Copilot, D-08). **Copilot is gated** by the RUN-04 probe (D-07/D-08). This bounds verification risk: the phase can verify on the two most headless-drivable CLIs without stalling on a flaky driver.

### Claude's Discretion
- Exact module layout for the runner (e.g. `lib/experiments/experiment-runner.mjs` + a thin `scripts/experiment-run.mjs` operator CLI) and the adapter shape over `config/agents/*.sh`.
- The precise per-agent headless invocation/flags for `claude.sh` / `opencode.sh` / `mastra.sh` — the researcher confirms each CLI's non-interactive mode; the adapter encodes it.
- How the timeout is implemented (spawn + timer + SIGTERM→SIGKILL escalation) and the exact `timeout`/`abort` enum wording on the Run record.
- The exact prompt/handoff the runner gives each headless agent (how the `goal_sentence` + sandbox context are delivered), as long as the agent works inside the sandbox cwd.
- The one-turn Copilot probe's exact trivial prompt and success assertion.
- Cell sequencing/resume bookkeeping (where the "completed cells" ledger lives — a manifest vs querying the Run-KB for existing `task_hash+variant+repeat`).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements + goal
- `.planning/REQUIREMENTS.md` — v7.5 block: RUN-02, RUN-03, RUN-04 acceptance text.
- `.planning/ROADMAP.md` — Phase 78 section (goal + 4 success criteria) and the prerequisite-ordering note (Phase 76 VALID must verify before the runner's Runs are trusted; RUN-04 is a gated spike inside this phase).

### Phase 77 outputs this phase consumes (WIRE, do not rebuild)
- `lib/experiments/experiment-spec.mjs` — `resolveExperimentSpec` / `validateCells` / `expandAxes`; the `UNSUPPORTED_COMBINATIONS` table already seeds `copilot + headless → unsupported` pointing at this phase's RUN-04 probe. The runner consumes resolved+validated cells.
- `lib/experiments/experiment-restore.mjs` — `restoreForCell(snapshotId, {repoRoot, dataDir, ontologyDir}) → {worktree, sandboxDataDir, digest}` (isolated sandbox per cell, `inPlace:false`); `runVariantRepeats` for the byte-identical determinism proof. The runner restores each cell via this before launching the agent.
- `.planning/phases/77-experiment-spec-per-variant-snapshot-foundation/77-CONTEXT.md` — the full Phase-77 decision set (D-01..D-12) this phase builds on.

### Phase-67 snapshot/restore rig (underneath Phase 77)
- `lib/repro/capture-snapshot.mjs` — `captureSnapshot(task_id, {repoRoot, dataDir, prompt})`; declare-time baseline (Phase 77 D-09).
- `lib/repro/restore-snapshot.mjs` — `restoreSnapshot(snapshotId, {inPlace:false, repoRoot, dataDir, ontologyDir}) → {worktree, sandboxDataDir, ...}`; restores under `.data/run-restores/<snapshot-id>-<ts>/`.

### Agent launch surface (RUN-02 adapter target)
- `config/agents/claude.sh`, `config/agents/opencode.sh`, `config/agents/mastra.sh`, `config/agents/copilot.sh` — the per-agent launch scripts the headless adapter reuses.
- `lib/agent-registry.js` / `lib/agent-detector.js` — agent→adapter mapping and `config/agents/*.sh` discovery (the resolution layer for D-01).
- `bin/coding` — the interactive launcher (reference for how routing/proxy env is set per agent; NOT the runner's launch path — D-01 rejects carving a headless path here).

### Measured-span seam (RUN-02 tagging)
- `scripts/measurement-start.mjs` — opens the span; Phase 77 added `--agent/--model/--framework/--test-command` and `--spec/--variant`; the runner sets `variant`/`repeat`/`task_hash` here.
- `scripts/measurement-stop.mjs` — closes the span; reads `span.meta.agent/.framework/.test_command`; writes Run.metadata (`task_hash`, `agent`, `model`, `snapshot_id`, …).
- `lib/experiments/evidence-harness.mjs` §`resolveTestCommand` — runs the per-variant `test_command` for scoring (D-05); `SHELL_META_RE` fixed-argv guard.

### Run scoring + experiment KB (RUN-03 output; inline scoring D-11)
- `lib/experiments/run-write.mjs` — `writeRun(store, {span, taskClass, pending, tags, totals, heuristics})`; how a Run lands in the experiment KB.
- `lib/experiments/query.mjs` — `readRuns(store, {includePending})`; used for the idempotent "already-completed cell" check (D-10).
- `lib/experiments/judge.mjs` / `lib/experiments/score-write.mjs` — the scoring pass the runner invokes inline per cell (D-11).

### Standing constraints
- `CLAUDE.md` — no-console-log (`process.stderr.write` for diagnostics), fixed-argv exec only (no shell strings — reinforced for agent launch + timeout kill), constraint-dodging forbidden, `.mjs` ESM style to match siblings.
- `.planning/phases/76-*/76-VERIFICATION.md` — the Phase-76 `test_command` carry-forward (origin of D-05's scoring path) and the VALID prerequisite the runner's Runs depend on.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `config/agents/*.sh` + `agent-registry.js`/`agent-detector.js` — the entire per-agent launch surface exists; the runner adds a thin headless adapter over it (D-01), not a new launcher.
- `restoreForCell` / `restoreSnapshot` — isolated sandbox worktree + `.data/` per cell already shipped (Phase 77 / 67); the runner sets the agent's cwd + `LLM_PROXY_DATA_DIR` to these (D-02).
- `measurement-start.mjs` / `measurement-stop.mjs` — the measured-span seam with per-variant `span.meta` passthrough already wired by Phase 77; the runner tags `variant`/`repeat`/`task_hash` (D-03).
- `writeRun` / `readRuns` / `judge.mjs` / `score-write.mjs` — the Run-KB write + scoring machinery exists; the runner orchestrates it inline per cell (D-11) and queries it for idempotency (D-10).
- `experiment-spec.mjs` `UNSUPPORTED_COMBINATIONS` — the `copilot+headless` gate is pre-seeded to point here; the RUN-04 probe resolves it (D-07).

### Established Patterns
- **Safe-by-default isolated restore** (sandbox worktree unless explicit in-place) — the runner never touches the live tree (D-02, inherits Phase 67 D-04 / Phase 77 D-10).
- **Fixed-argv, no-shell exec** (`SHELL_META_RE`, `spawnSync`) — mandatory for agent launch, the timeout kill, and `test_command` (D-01/D-05/D-06).
- **Whole-run fail-fast + recorded-skip, never silently-absent** (Phase 77 D-06/D-07) — extended here to recorded run states: `complete`/`timeout`/`abort` (D-04) and probe-gated skips (D-08).

### Integration Points
- Resolved cell (Phase 77) → `restoreForCell` → sandbox worktree + `.data/` → headless agent launch (cwd/env bound) → measured span (`variant`/`repeat`/`task_hash`) → `measurement-stop` Run.metadata → inline `judge`/`score-write` → one scored Run in the experiment KB per cell.
- Idempotency ledger ↔ `readRuns` (existing `task_hash+variant+repeat`) gates re-run/resume (D-10).
- Copilot cell ↔ one-turn headless probe → recorded-skip on failure (D-07/D-08).

</code_context>

<specifics>
## Specific Ideas

- All four presented gray areas resolved to the recommended, lowest-risk-reuse option — the runner is deliberately an **orchestrator over shipped parts**, adding only: the headless adapter (D-01), the timeout/terminal-state bookkeeping (D-04/D-06), the Copilot probe (D-07), and the sequential idempotent matrix loop (D-09/D-10).
- The phase's own success bar is pragmatic: **Claude + OpenCode required end-to-end; Mastra best-effort; Copilot probe-gated** (D-12) — SC#4's "≥2 agents" is met by the two most drivable CLIs, with honest recorded-skips for the rest.

</specifics>

<deferred>
## Deferred Ideas

- **Parallel cell execution across sandboxes** — the sandboxes are isolated enough to allow it, but this phase runs sequentially (D-09); parallelism is a later performance optimization.
- **Separate (non-inline) scoring pass** — considered and rejected for this phase (D-11 scores inline); a batch re-score pass could be a future utility.
- **Framework/approach closed-enum** — still deferred (from Phase 77 D-05); `framework` stays free-form here.
- **Success gate / N-repeat variance / ranked report (CMP-01/02/03)** → Phase 79.
- **Auto-routing / policy engine** consuming the comparisons → v7.6.

### Reviewed Todos (not folded)
Three pending todos surfaced as low-relevance keyword matches for Phase 78 and were reviewed but NOT folded (none concern the autonomous runner):
- `2026-06-10-okm-express-api-contract-bridge.md` — OKM Express ↔ unified-viewer API contract mismatch. Out of scope (dashboard/API plumbing).
- `2026-06-10-sub-agent-dashboard-observability-gap.md` — sub-agent observations from worktree-isolated `Agent()` calls not reaching the dashboard. Out of scope (observability), though tangentially related to running isolated agents — revisit if runner Runs need dashboard surfacing.
- `2026-06-14-lsl-timeline-200-cap-and-all-window-misnaming.md` — LSL timeline strip truncation. Out of scope (unrelated UI/LSL).

</deferred>

---

*Phase: 78-autonomous-cross-agent-runner*
*Context gathered: 2026-07-03*
