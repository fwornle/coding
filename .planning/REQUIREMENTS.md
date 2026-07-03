# Project Requirements

This file tracks the active milestone's requirements at the top, with previous milestones' requirements retained in `.planning/milestones/` for traceability.

---

# Milestone v7.5 Requirements — Cross-Agent Comparison Experiment Runner (ACTIVE)

**Goal:** Turn the v7.4 measurement rig into an experiment tool. A user states a goal plus a variant matrix ("develop X, measure it under settings A vs B") and a repeat count; the system drives each variant across agents from an identical starting snapshot, evaluates an objective success gate, and returns a scored, side-by-side comparison with per-variant variance.

**Builds on (do NOT rebuild):** `measurement-start/stop.mjs`, `task_hash` comparability, the experiment km-core KB + `experiments-*` CLIs, the Performance dashboard tab, proxy routing for all four agents (commit `2a23a9a25`), and the Phase 67 reproducibility-replay rig. This milestone is an **orchestration layer** on those primitives.

**Sequencing:** The Validity (VALID) requirements are **prerequisites** — they correct correctness gaps in v7.4's shipped attribution/route/score code that the `exp-dash-start-control` pilot (2026-06-29) dogfood-exposed, and they specifically corrupt the two canonical comparisons ("Opus vs Fable", "straight vs GSD/SDD"). VALID must land and verify before the runner (RUN/CMP) is trusted.

**Phase numbering:** Continues from Phase 75 (v7.4) → v7.5 phases start at **Phase 76**.

**Reslot:** the previously-earmarked v7.5 (policy automation / auto-routing, currency conversion — `seeds/v74-policy-engine.md`) moves to **v7.6**; it consumes this runner's comparisons.

---

## v7.5 Requirements

### Measurement Validity — prerequisites (VALID)

*Corrections to v7.4 shipped code, diagnosed in `.planning/v7.4-attribution-findings.md` (pilot run) — required for a comparison to be meaningful.*

- [ ] **VALID-01 (O1 — model attribution):** A Run's canonical model reflects the actual foreground interactive session model (e.g. `claude-opus-4-8`), not the most-frequent proxy token-row model (skewed by Haiku judge/consolidator calls sharing the window). Acceptance: a measured Opus session records model Opus in the runs table, score drawer, and timeline — not `claude-haiku-4.5`.
- [x] **VALID-02 (O2 — route time math):** Route wallclock/step and interval metrics produce plausible values over long, partially-idle interactive windows (no implausible ~28,000 s/step artifacts). Idle/wait gaps are excluded or the metric is defined per active step. Acceptance: a multi-hour session with steering pauses yields per-step times within a sane bound, documented.
- [ ] **VALID-03 (O3 — non-GSD rubric coverage):** The 5-dimension outcome rubric is scored for non-GSD / ad-hoc tasks — `code_quality`, `test_coverage`, `regressions` are not null when `VERIFICATION.md`/`REVIEW.md` are absent; the evidence harness derives signal from the task's tests + working-tree diff, not only GSD artifacts. Acceptance: a straight-coding run scores all 5 dims (none null solely due to missing GSD files).

### Experiment Specification (SPEC)

- [ ] **SPEC-01:** A user declares an experiment as `{goal_sentence, variants[], repeats N}` where each variant is a named settings bundle over `{agent, model, framework/approach, env}` — via CLI flags and/or a declarative spec file.
- [ ] **SPEC-02:** Each variant resolves to a concrete executable config, validated before any run starts; unsupported combinations (e.g. Copilot headless) fail fast with an actionable message rather than mid-run.

### Cross-Agent Runner (RUN)

- [ ] **RUN-01:** For each variant × repeat, the runner restores the identical starting snapshot (Phase 67 rig) before launching, so every variant starts from the same tree + state.
- [ ] **RUN-02:** The runner launches the specified agent (Claude / OpenCode / Mastra) autonomously against the goal, wrapping the work in a measured span tagged with `variant`, `repeat`, and `task_hash`.
- [ ] **RUN-03:** Runs execute unattended to completion, timeout, or abort — producing a scored Run per variant × repeat without requiring interactive operator steering; timeouts/aborts are recorded as such.
- [ ] **RUN-04:** Copilot participation is gated on an explicit headless-drivability capability check; if unsupported, the Copilot variant is skipped with a recorded reason (never silently absent).

### Comparison & Reporting (CMP)

- [ ] **CMP-01:** An objective success gate (task test suite / UAT command) is evaluated per run; cost/route/score metrics are compared only across runs that pass the gate — failed runs are reported separately, not averaged into a variant's cost.
- [ ] **CMP-02:** The runner aggregates N repeats per variant into a per-variant summary with central tendency **and** variance (spread) for tokens, wallclock, route metrics, and rubric scores.
- [ ] **CMP-03:** A side-by-side comparison report (CLI table + machine-readable export) ranks variants on the chosen metric(s), showing variance and each variant's success-gate outcome, keyed by `task_hash` for reproducibility.
- [ ] **CMP-04:** The comparison is viewable in the Performance dashboard tab as variant columns (surfaces CMP-03 without re-running).

### Orchestration Surface (ORCH)

- [ ] **ORCH-01:** The full flow is invokable as a single command/skill (e.g. `experiment run --goal "…" --variants A,B --agents claude,opencode --repeats N`), installed and usable across the coding agents per the multi-agent skill ecosystem.

---

## v7.5 Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| VALID-01 | Phase 76 | Complete |
| VALID-02 | Phase 76 | Complete (76-02) |
| VALID-03 | Phase 76 | Complete |
| SPEC-01 | Phase 77 | Complete |
| SPEC-02 | Phase 77 | Complete |
| RUN-01 | Phase 77 | Complete |
| RUN-02 | Phase 78 | Pending |
| RUN-03 | Phase 78 | Pending |
| RUN-04 | Phase 78 | Pending |
| CMP-01 | Phase 79 | Pending |
| CMP-02 | Phase 79 | Pending |
| CMP-03 | Phase 79 | Pending |
| CMP-04 | Phase 80 | Pending |
| ORCH-01 | Phase 80 | Pending |

**Coverage:** 14/14 v7.5 requirements mapped across 5 phases (76–80). No orphans, no duplicates.

**Phase map (goal-backward):**
- **Phase 76 — Measurement Validity Fixes [PREREQUISITE]:** VALID-01, VALID-02, VALID-03 — corrects the shipped attribution/route/score code so a comparison is meaningful; gates the runner phases.
- **Phase 77 — Experiment Spec & Per-Variant Snapshot Foundation:** SPEC-01, SPEC-02, RUN-01 — declarative validated variant matrix + fail-fast resolution + per-variant snapshot restore off the Phase-67 rig.
- **Phase 78 — Autonomous Cross-Agent Runner:** RUN-02, RUN-03, RUN-04 — unattended per-cell agent launch in a measured span; Copilot gated on a headless-drivability spike.
- **Phase 79 — Comparison, Aggregation & Report:** CMP-01, CMP-02, CMP-03 — success gate + N-repeat variance + ranked report keyed by `task_hash`.
- **Phase 80 — Experiment Surface — Dashboard & Skill Packaging:** CMP-04, ORCH-01 — variant columns in the Performance tab + single installed `experiment run` skill across agents.

---

# Milestone v7.4 Requirements — Performance Measurement System (COMPLETE — pending formal close)

**Goal:** Build a measurement rig that quantifies, per task, the full cost (tokens), time-to-delivery, route quality, and outcome success across all four supported coding agents (Claude Code, Copilot CLI, OpenCode, Mastra) AND the proxy-routed background services that run during the task — so dev teams can be told, evidence-backed: *for task type X at complexity Y, use agent/model Z at spec-level W.*

**Scope seeds:** `.planning/notes/v73-perf-measurement-exploration.md` (7 decisions D1–D7 + 9-phase sketch, Phase 3 FOUNDATIONAL), `.planning/notes/v73-token-attribution-contract.md` (storage + measurement-span + per-agent adapter contracts), `.planning/spikes/copilot-proxy-interception.md` (completed spike), `memory/feedback_perf_measurement_requirements.md` (hard requirements). *(Filenames retain their v73 origin; the slot is v7.4.)*

**Phase numbering:** Continues from Phase 66 (v7.3) → v7.4 phases start at **Phase 67**.

**Foundational ordering:** TELEM (the `token_usage` row contract + measurement span) is the dependency anchor — every adapter, route, score, and dashboard requirement reads or writes rows with the new columns. It MUST land and verify before per-agent adapter work begins.

---

## v7.4 Requirements

### Reproducibility & Replay (REPRO)

- [x] **REPRO-01:** A run can snapshot internal state — git SHA + workspace dirty state, `.data/knowledge-graph/` KB, `processOverrides` routing config, MCP server inventory + versions, prompt text, `.planning/` state, agent-affecting env vars, and agent binary version — and restore it byte-for-byte for a repeat run.
- [x] **REPRO-02:** External state (LLM provider responses via `rapid-llm-proxy`, `WebSearch`/`WebFetch` results, remote MCP replies, clock) is recorded during a run and replayable from fixtures, so repeated N=1 runs are comparable modulo provider non-determinism.

### Token Attribution Storage (TELEM) — FOUNDATIONAL

- [ ] **TELEM-01:** `token_usage` gains additive columns (`agent`, `task_id`, `tool_call_id`, `parent_call_id`, `granularity_tier`, `reasoning_tokens`) via an idempotent startup migration; existing rows backfill to defaults and no historical writer breaks.
- [ ] **TELEM-02:** A measurement span is controlled via `.data/active-measurement.json` (start writes it, stop sets `ended_at` and archives to `.data/measurements/<task_id>.json`, atomic rename, >24h stale-span warning) exposed through a single `getActiveMeasurement()` SDK reader.
- [ ] **TELEM-03:** The proxy `attachTokenLogger` write path stamps every row with the active `task_id` per the resolution rules (in-window → task_id; out-of-window / no span → ""; completed-session sweeps backfill by timestamp join against archived spans).

### Per-Agent Adapters (ADAPT)

- [x] **ADAPT-01:** Claude Code token rows are ingested from session JSONL `usage` blocks at `per-turn` granularity (plus `per-reasoning-step` rows for extended thinking), with sub-agents linked via `parent_call_id`; live-tail for in-progress sessions + sweep for completed ones.
- [x] **ADAPT-02:** Copilot CLI token rows are ingested from `events.jsonl` at `per-session-aggregate` granularity, with the Phase-1 event-vocabulary check that upgrades to `per-turn` if per-turn usage payloads exist.
- [x] **ADAPT-03:** OpenCode LLM calls route through the proxy (`host.docker.internal:12435`) and are logged `per-llm-call` with the active `task_id` passed via the request envelope.
- [x] **ADAPT-04:** Mastra's instrumentation surface is identified (from `.opencode/mastra.json`) and an adapter emits rows on the shared contract at its determined granularity tier.

### Route Quality (ROUTE)

- [ ] **ROUTE-01:** Each run carries a one-sentence `goal_sentence` (auto-derived from `PLAN.md` for /gsd runs; prompted at "Start measurement" for freeform runs) stored on the Run.
- [ ] **ROUTE-02:** Deterministic syntactic route heuristics are computed per run (loop count, edit-revert count, redundant/unused read count, abandoned tool-call count, total step count, wallclock per step).
- [ ] **ROUTE-03:** A semantic `goal_aligned_ratio` is computed by an LLM-judge (Haiku via `taskType` routing) scoring each meaningful trace event toward/neutral/away from the goal sentence, stored with rationale.

### Success Scoring (SCORE)

- [ ] **SCORE-01:** Every run is scored on the fixed 5-dimension rubric (`goal_achieved`, `code_quality`, `test_coverage`, `regressions`, `spec_drift`) synthesized by an LLM-judge from whatever evidence is present, with a rationale string.
- [ ] **SCORE-02:** A user can override any rubric dimension in the dashboard; the corrected score is stored separately from the judged score.

### Experiment Knowledge Base (KB)

- [ ] **KB-01:** A km-core ontology defines `Experiment / Run / Route / Step / Decision / Outcome / Report` entities and their relations.
- [ ] **KB-02:** A Run-write path materializes each run as an independent, queryable km-core entity (rich tags: task_hash, task_class, agent, model, framework, spec_level, snapshot_id, trace_id) sourced from `token_usage` + route + score data.
- [ ] **KB-03:** A task taxonomy v0 (`refactor`, `bugfix`, `new-feature`, `migration`, `debug`, `docs`) is defined with definitions and enforced as a required tag at run-end (not optional metadata).
- [ ] **KB-04:** A `Report` entity + saved-query workflow points at a query plus a stable results snapshot so curated findings are shareable and do not bit-rot.

### Performance Dashboard (DASH)

- [ ] **DASH-01:** A new "Performance" dashboard tab (slotted after Tokens) provides a task-anchored query-builder over runs.
- [ ] **DASH-02:** The timeline view renders `per-reasoning-step` rows as stacked sub-bands under their parent turn, and shows each run's `granularity_tier` as a badge so cross-tier averages are not over-interpreted.
- [ ] **DASH-03:** `Report` views render a saved query against its stable results snapshot.

### Attribution Accuracy & Observation Linkage (ATTR/OBS)

Evidence: `.planning/v7.4-attribution-findings.md` (findings A–D, from the `exp-dash-start-control` dogfood measurement, 2026-06-29). These correct TELEM-03's time-window attribution, which conflates concurrent background-daemon traffic with the measured task and misses the foreground agent's own tokens — making scores/tokens untrustworthy for an interactive session.

- [ ] **ATTR-01:** A token row is attributed to a measurement only when it belongs to the measured task's process/agent lineage — not by time-window overlap alone (corrects TELEM-03). Background processes (`consolidator-*`, `health-coordinator`, `observation-writer`, other non-task daemons) are excluded from, or segregated within, a foreground interactive measurement. The lineage signal is defined explicitly (process allow/deny list, agent/session id, or an explicit `task_id` stamp at the call site).
- [x] **ATTR-02:** Each Run has one canonical model/agent source-of-truth (no dominant-vs-first-row divergence across the runs table, score drawer, and timeline) AND persists a per-process model breakdown, surfaced as a two-column display: the foreground chat model in one column, the full list of background-service models in another.
- [ ] **ATTR-03:** The foreground interactive agent's (Claude Code) own session tokens are captured into `token_usage` stamped with the active `task_id` — via the existing `lib/lsl/token` adapters (`buildClaudeTokenRows()` + insert helper) wired into the stop/close (or a live) path — so the recorded model reflects reality (e.g. Opus), not concurrent proxy traffic. (Claude Code calls Anthropic directly and bypasses the proxy, so its usage is otherwise invisible.)
- [x] **OBS-01:** Observations/digests/insights produced during a measurement are tagged with the active `task_id` (ETM reads `getActiveMeasurement()`), exposed in the observation view, and queryable/correlatable to the Run — so "what happened during measurement X" is reconstructable.
- [x] **OBS-02:** ETM captures observations *throughout* a long-running agentic prompt-set, not only at its start — re-capturing on meaningful boundaries (each AskUserQuestion decision and/or significant tool-activity batches / periodic flush) — and stamps each observation with its **real event time**, not the prompt-set start. Acceptance: a session whose only typed prompt is at T0 but which runs for hours with operator decisions at T0+n yields observations dated ~T0+n, not all at T0 (finding D).

---

## Future Requirements (deferred from v7.4)

- Policy automation / auto-routing of tasks to agents/models — v7.6 (`seeds/v74-policy-engine.md`); gated on the v7.4 KB holding ≥~50 completed Runs across ≥3 task_classes with ≥2 agents and ≥2 models per class. **Consumes the v7.5 runner's comparisons — this milestone is its prerequisite.**
- Cost-in-currency conversion (tokens → $) — v7.6, downstream of policy work.
- Cross-task aggregation reports beyond saved `Report` queries.

## Out of Scope

- **VS Code Copilot Chat** — `state.vscdb` LevelDB is opaque with no stable per-call telemetry surface (operator decision at scoping).
- **Token-attribution row deletion / TTL** — existing `token_usage` retain-indefinitely behaviour preserved.
- **Auto-routing / policy engine in `bin/coding`** — explicitly v7.6 (reslotted from v7.5).

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REPRO-01 | Phase 67 | Complete |
| REPRO-02 | Phase 67 | Complete |
| TELEM-01 | Phase 68 | Complete |
| TELEM-02 | Phase 68 | Complete |
| TELEM-03 | Phase 68 | Complete |
| ADAPT-01 | Phase 69 | Complete |
| ADAPT-02 | Phase 69 | Complete |
| ADAPT-03 | Phase 70 | Complete |
| ADAPT-04 | Phase 70 | Complete |
| KB-01 | Phase 71 | Complete |
| KB-02 | Phase 71 | Complete |
| KB-03 | Phase 71 | Complete |
| ROUTE-01 | Phase 72 | Pending |
| ROUTE-02 | Phase 72 | Pending |
| ROUTE-03 | Phase 73 | Pending |
| SCORE-01 | Phase 73 | Pending |
| SCORE-02 | Phase 73 | Pending |
| KB-04 | Phase 74 | Complete |
| DASH-01 | Phase 74 | Complete |
| DASH-02 | Phase 74 | Complete |
| DASH-03 | Phase 74 | Complete |
| ATTR-01 | Phase 75 | Complete |
| ATTR-02 | Phase 75 | Complete |
| ATTR-03 | Phase 75 | Complete |
| OBS-01 | Phase 75 | Complete |
| OBS-02 | Phase 75 | Complete |

**Coverage:** 26/26 requirements mapped across 9 phases (67–75). No orphans, no duplicates.
