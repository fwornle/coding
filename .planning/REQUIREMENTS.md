# Project Requirements

This file tracks the active milestone's requirements at the top, with previous milestones' requirements retained in `.planning/milestones/` for traceability.

---

# Milestone v7.4 Requirements — Performance Measurement System (ACTIVE)

**Goal:** Build a measurement rig that quantifies, per task, the full cost (tokens), time-to-delivery, route quality, and outcome success across all four supported coding agents (Claude Code, Copilot CLI, OpenCode, Mastra) AND the proxy-routed background services that run during the task — so dev teams can be told, evidence-backed: *for task type X at complexity Y, use agent/model Z at spec-level W.*

**Scope seeds:** `.planning/notes/v73-perf-measurement-exploration.md` (7 decisions D1–D7 + 9-phase sketch, Phase 3 FOUNDATIONAL), `.planning/notes/v73-token-attribution-contract.md` (storage + measurement-span + per-agent adapter contracts), `.planning/spikes/copilot-proxy-interception.md` (completed spike), `memory/feedback_perf_measurement_requirements.md` (hard requirements). *(Filenames retain their v73 origin; the slot is v7.4.)*

**Phase numbering:** Continues from Phase 66 (v7.3) → v7.4 phases start at **Phase 67**.

**Foundational ordering:** TELEM (the `token_usage` row contract + measurement span) is the dependency anchor — every adapter, route, score, and dashboard requirement reads or writes rows with the new columns. It MUST land and verify before per-agent adapter work begins.

---

## v7.4 Requirements

### Reproducibility & Replay (REPRO)

- [ ] **REPRO-01:** A run can snapshot internal state — git SHA + workspace dirty state, `.data/knowledge-graph/` KB, `processOverrides` routing config, MCP server inventory + versions, prompt text, `.planning/` state, agent-affecting env vars, and agent binary version — and restore it byte-for-byte for a repeat run.
- [ ] **REPRO-02:** External state (LLM provider responses via `rapid-llm-proxy`, `WebSearch`/`WebFetch` results, remote MCP replies, clock) is recorded during a run and replayable from fixtures, so repeated N=1 runs are comparable modulo provider non-determinism.

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
- [ ] **ATTR-02:** Each Run has one canonical model/agent source-of-truth (no dominant-vs-first-row divergence across the runs table, score drawer, and timeline) AND persists a per-process model breakdown, surfaced as a two-column display: the foreground chat model in one column, the full list of background-service models in another.
- [ ] **ATTR-03:** The foreground interactive agent's (Claude Code) own session tokens are captured into `token_usage` stamped with the active `task_id` — via the existing `lib/lsl/token` adapters (`buildClaudeTokenRows()` + insert helper) wired into the stop/close (or a live) path — so the recorded model reflects reality (e.g. Opus), not concurrent proxy traffic. (Claude Code calls Anthropic directly and bypasses the proxy, so its usage is otherwise invisible.)
- [x] **OBS-01:** Observations/digests/insights produced during a measurement are tagged with the active `task_id` (ETM reads `getActiveMeasurement()`), exposed in the observation view, and queryable/correlatable to the Run — so "what happened during measurement X" is reconstructable.
- [x] **OBS-02:** ETM captures observations *throughout* a long-running agentic prompt-set, not only at its start — re-capturing on meaningful boundaries (each AskUserQuestion decision and/or significant tool-activity batches / periodic flush) — and stamps each observation with its **real event time**, not the prompt-set start. Acceptance: a session whose only typed prompt is at T0 but which runs for hours with operator decisions at T0+n yields observations dated ~T0+n, not all at T0 (finding D).

---

## Future Requirements (deferred from v7.4)

- Policy automation / auto-routing of tasks to agents/models — v7.5 (`seeds/v74-policy-engine.md`); gated on the v7.4 KB holding ≥~50 completed Runs across ≥3 task_classes with ≥2 agents and ≥2 models per class.
- Cost-in-currency conversion (tokens → $) — v7.5, downstream of policy work.
- Cross-task aggregation reports beyond saved `Report` queries.

## Out of Scope

- **VS Code Copilot Chat** — `state.vscdb` LevelDB is opaque with no stable per-call telemetry surface (operator decision at scoping).
- **Token-attribution row deletion / TTL** — existing `token_usage` retain-indefinitely behaviour preserved.
- **Auto-routing / policy engine in `bin/coding`** — explicitly v7.5.

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REPRO-01 | Phase 67 | Pending |
| REPRO-02 | Phase 67 | Pending |
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
