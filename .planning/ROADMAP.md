# Roadmap: Coding Project — Knowledge Management

## Milestones

- ✅ **v7.3 LLM Proxy Performance — Claude CLI Worker Pool** — Phases 62–66 (shipped 2026-06-21)
- 🚧 **v7.4 Performance Measurement System — Cross-agent Token + Route + Outcome Attribution** — Phases 67–74 (active 2026-06-21)

## Phases

<details>
<summary>✅ v7.3 LLM Proxy Performance — Claude CLI Worker Pool (Phases 62–66) — SHIPPED 2026-06-21</summary>

Replaced the per-call `claude` CLI `execFile` spawn on the claude-code fallback path with a pool of warm, persistent stream-JSON workers — sonnet/opus fallback latency cut from ~10–14s to ~2–3s steady-state. 14/14 requirements satisfied. Full detail: `milestones/v7.3-ROADMAP.md`, `milestones/v7.3-REQUIREMENTS.md`, `milestones/v7.3-MILESTONE-AUDIT.md`.

- [x] Phase 62: Worker Pool Core — Stream-JSON Transport (3 plans) — POOL-01..04, GUARD-01
- [x] Phase 63: Worker Lifecycle — Lazy Spawn / Idle Eviction / Crash Recovery / Cancellation (5 plans) — WLIFE-01..04 (live-proven 9/9)
- [x] Phase 64: Worker Hygiene — CLI Version Pinning + stderr Throttling (2 plans) — GUARD-02/03
- [x] Phase 65: Steady-State Latency, Crash-Survival Acceptance (1 plan) — PERF-01/02 (operator live-run 12/12)
- [x] Phase 66: Dashboard Latency Observability (5 plans incl. gap-closure 66-03/04/05) — PERF-03 (SC-1 green + SC-2 red live-proven)

</details>

### 🚧 v7.4 Performance Measurement System — Cross-agent Token + Route + Outcome Attribution (Phases 67–74)

Quantify, per task, the full cost (tokens), time-to-delivery, route quality, and outcome success across all four supported coding agents (Claude Code, Copilot CLI, OpenCode, Mastra) AND the proxy-routed background services that run during the task — so "approach X cost Y for task type Z" becomes evidence, not anecdote.

**Foundational ordering:** Phase 68 (TELEM — the `token_usage` row contract + measurement span) is the dependency anchor. Every adapter, route, score, and dashboard requirement reads or writes rows with the new columns and consults `.data/active-measurement.json`. It MUST land and verify before any per-agent adapter work (Phases 69–70) begins.

- [ ] **Phase 67: Reproducibility & Replay Rig** — Snapshot/restore internal state + record/replay external state so N=1 runs become comparable
- [ ] **Phase 68: [FOUNDATIONAL] Token Attribution Storage** — `token_usage` schema extension + measurement-span contract + `attachTokenLogger` task_id stamping
- [ ] **Phase 69: Claude + Copilot Token Adapters** — Claude per-turn + per-reasoning-step JSONL adapter; Copilot events.jsonl adapter with Phase-1 event-vocabulary check
- [ ] **Phase 70: OpenCode + Mastra Token Adapters** — OpenCode proxy-route per-llm-call logging; Mastra instrumentation-surface read + adapter
- [ ] **Phase 71: Experiment KB & Task Taxonomy** — km-core ontology + Run-write path + enforced task-taxonomy v0 tag
- [ ] **Phase 72: Syntactic Route Quality** — `goal_sentence` capture + deterministic route heuristics per run
- [ ] **Phase 73: Semantic Route Judge & Success Scoring** — LLM-judge `goal_aligned_ratio` + 5-dimension rubric + user override
- [ ] **Phase 74: Performance Dashboard & Reports** — "Performance" tab query-builder, reasoning-step sub-bands + tier badges, Report entity + saved-query workflow + Report views

## Phase Details

### Phase 67: Reproducibility & Replay Rig
**Goal**: A run's internal and external state can be captured and restored so a repeat run starts from byte-identical conditions and replays the same external responses.
**Depends on**: Nothing (first v7.4 phase; non-blocking infrastructure — independent of TELEM)
**Requirements**: REPRO-01, REPRO-02
**Success Criteria** (what must be TRUE):
  1. A snapshot captures git SHA + workspace dirty state, `.data/knowledge-graph/` KB, `processOverrides` routing config, MCP server inventory + versions, prompt text, `.planning/` state, agent-affecting env vars, and agent binary version into a single restorable `RunSnapshot`.
  2. Restoring a snapshot returns the workspace and KB to the captured state byte-for-byte for a repeat run.
  3. During a recorded run, LLM provider responses (via `rapid-llm-proxy`), `WebSearch`/`WebFetch` results, remote MCP replies, and the clock are written to fixtures.
  4. A replay run reads those fixtures instead of hitting live providers, so repeated N=1 runs are comparable modulo provider non-determinism.
**Plans**: TBD

### Phase 68: [FOUNDATIONAL] Token Attribution Storage
**Goal**: The `token_usage` store carries the cross-agent row contract (new columns) and a measurement span exists that every writer can consult to stamp the active `task_id`.
**Depends on**: Nothing (must land before Phases 69–70; the dependency anchor for the milestone)
**Requirements**: TELEM-01, TELEM-02, TELEM-03
**Success Criteria** (what must be TRUE):
  1. After service startup, `token_usage` has the additive columns `agent`, `task_id`, `tool_call_id`, `parent_call_id`, `granularity_tier`, `reasoning_tokens`; existing rows show empty-string/zero defaults and no historical writer errors.
  2. The startup migration is idempotent — a second startup makes no schema change and logs no error.
  3. "Start measurement" writes `.data/active-measurement.json`; "Stop measurement" sets `ended_at`, atomically renames to `.data/measurements/<task_id>.json`, and a span left open >24h surfaces a stale-span warning.
  4. A single `getActiveMeasurement()` SDK reader returns the active span (or null) and is the only JSON parser callers use.
  5. The proxy `attachTokenLogger` write path stamps each row with the active `task_id` per the resolution rules (in-window → task_id; out-of-window / no span → ""; completed-session sweeps backfill by timestamp join against archived spans).
**Plans**: 3 plans
  - [ ] 68-01-PLAN.md — TELEM-01: token_usage additive columns + idempotent PRAGMA-guarded startup migration + extended row/insert/logCall (Wave 1)
  - [ ] 68-02-PLAN.md — TELEM-02: measurement-span lifecycle (start/stop atomic archive + >24h stale warning) + single getActiveMeasurement() SDK reader + barrel export + operator CLIs (Wave 1)
  - [ ] 68-03-PLAN.md — TELEM-03: proxy write-path task_id stamping via the single reader + completed-session timestamp-join backfill sweep + live restarted-daemon row gate (Wave 2)

### Phase 69: Claude + Copilot Token Adapters
**Goal**: Claude Code and Copilot CLI token spend lands in `token_usage` on the shared contract at the best granularity each surfaces, with sub-agents linked to their parent.
**Depends on**: Phase 68 (writes rows on the TELEM contract; gated on TELEM verification passing)
**Requirements**: ADAPT-01, ADAPT-02
**Success Criteria** (what must be TRUE):
  1. Claude Code session JSONL `usage` blocks are ingested as `per-turn` rows, with `per-reasoning-step` rows emitted for extended-thinking blocks carrying `reasoning_tokens` separate from input/output.
  2. Claude sub-agent JSONLs are linked to their parent turn via `parent_call_id`; in-progress sessions are live-tailed and completed sessions are swept on adapter startup.
  3. Copilot CLI `events.jsonl` is ingested at `per-session-aggregate` granularity from `session.shutdown.modelMetrics`.
  4. The Phase-1 Copilot event-vocabulary check is performed (distinct `type:` values listed, per-turn usage payload presence confirmed); if per-turn payloads exist the adapter upgrades to emitting `per-turn` rows.
  5. Both adapters stamp rows with the active `task_id` (live) or backfill it by timestamp join (sweep) per the TELEM resolution rules.
**Plans**: TBD

### Phase 70: OpenCode + Mastra Token Adapters
**Goal**: OpenCode and Mastra token spend lands in `token_usage` on the shared contract, completing the all-four-agent reach.
**Depends on**: Phase 68 (writes rows on the TELEM contract; gated on TELEM verification passing)
**Requirements**: ADAPT-03, ADAPT-04
**Success Criteria** (what must be TRUE):
  1. OpenCode is configured to route its LLM calls through the proxy at `host.docker.internal:12435`, and the proxy logs each call as a `per-llm-call` row.
  2. OpenCode's active `task_id` is passed via the proxy request envelope and lands on the row.
  3. Mastra's instrumentation surface is identified from `.opencode/mastra.json` (per-step middleware vs observer hooks vs framework callbacks) and its granularity tier is determined.
  4. A Mastra adapter emits rows on the shared contract at the determined granularity tier, stamped with the active `task_id`.
**Plans**: TBD

### Phase 71: Experiment KB & Task Taxonomy
**Goal**: Each run materializes as an independent, queryable km-core entity with rich tags, and a curated task taxonomy is enforced so comparisons-as-queries return meaningful results.
**Depends on**: Phase 68 (Run-write path sources from `token_usage` rows + the measurement span)
**Requirements**: KB-01, KB-02, KB-03
**Success Criteria** (what must be TRUE):
  1. A km-core ontology defines `Experiment / Run / Route / Step / Decision / Outcome / Report` entities and their relations.
  2. A Run-write path materializes each run as a queryable km-core entity carrying tags (`task_hash`, `task_class`, `agent`, `model`, `framework`, `spec_level`, `snapshot_id`, `trace_id`) sourced from `token_usage` + route + score data.
  3. A task taxonomy v0 (`refactor`, `bugfix`, `new-feature`, `migration`, `debug`, `docs`) exists with definitions.
  4. The `task_class` tag is enforced as required at run-end — a run cannot close without one (not optional metadata).
**Plans**: TBD

### Phase 72: Syntactic Route Quality
**Goal**: Every run carries a goal sentence and deterministic, zero-LLM route-quality metrics so route inefficiency is measurable without judge cost.
**Depends on**: Phase 71 (metrics + goal_sentence stored on the Run entity)
**Requirements**: ROUTE-01, ROUTE-02
**Success Criteria** (what must be TRUE):
  1. Each run carries a one-sentence `goal_sentence` — auto-derived from `PLAN.md` for /gsd runs, prompted at "Start measurement" for freeform runs — stored on the Run.
  2. Deterministic syntactic route heuristics are computed per run: loop count, edit-revert count, redundant/unused read count, abandoned tool-call count, total step count, and wallclock per step.
  3. The computed heuristics are stored on the Run and queryable alongside its tags.
**Plans**: TBD

### Phase 73: Semantic Route Judge & Success Scoring
**Goal**: Every run gets a semantic route-alignment ratio and a 5-dimension success score, both LLM-judge synthesized with rationale and both user-correctable.
**Depends on**: Phase 72 (reads `goal_sentence` + the route trace), Phase 68 (judge calls themselves measured via the proxy)
**Requirements**: ROUTE-03, SCORE-01, SCORE-02
**Success Criteria** (what must be TRUE):
  1. A semantic `goal_aligned_ratio` is computed by an LLM-judge (Haiku via `taskType` routing) that scores each meaningful trace event toward/neutral/away from the goal sentence, stored with rationale.
  2. Every run is scored on the fixed 5-dimension rubric (`goal_achieved`, `code_quality`, `test_coverage`, `regressions`, `spec_drift`) synthesized by the LLM-judge from whatever evidence is present, with a rationale string.
  3. A user can override any rubric dimension in the dashboard, and the corrected score is stored separately from the judged score.
**Plans**: TBD

### Phase 74: Performance Dashboard & Reports
**Goal**: An operator can build task-anchored queries over runs, read reasoning-cost and tier honestly, and save curated findings as durable Reports.
**Depends on**: Phase 71 (queries the Run KB), Phase 73 (renders scores), Phase 69/70 (renders per-tier rows)
**Requirements**: DASH-01, DASH-02, KB-04, DASH-03
**Success Criteria** (what must be TRUE):
  1. A new "Performance" dashboard tab (slotted after Tokens) provides a task-anchored query-builder over runs.
  2. The timeline view renders `per-reasoning-step` rows as stacked sub-bands under their parent turn, and shows each run's `granularity_tier` as a badge so cross-tier averages are not over-interpreted.
  3. A `Report` entity plus saved-query workflow points at a query and a stable results snapshot so curated findings are shareable and do not bit-rot.
  4. `Report` views render a saved query against its stable results snapshot.
**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 62. Worker Pool Core | v7.3 | 3/3 | Complete | 2026-06-21 |
| 63. Worker Lifecycle | v7.3 | 5/5 | Complete | 2026-06-21 |
| 64. Worker Hygiene | v7.3 | 2/2 | Complete | 2026-06-21 |
| 65. Acceptance | v7.3 | 1/1 | Complete | 2026-06-21 |
| 66. Dashboard Observability | v7.3 | 5/5 | Complete | 2026-06-21 |
| 67. Reproducibility & Replay Rig | v7.4 | 0/? | Not started | - |
| 68. Token Attribution Storage [FOUNDATIONAL] | v7.4 | 0/3 | Not started | - |
| 69. Claude + Copilot Token Adapters | v7.4 | 0/? | Not started | - |
| 70. OpenCode + Mastra Token Adapters | v7.4 | 0/? | Not started | - |
| 71. Experiment KB & Task Taxonomy | v7.4 | 0/? | Not started | - |
| 72. Syntactic Route Quality | v7.4 | 0/? | Not started | - |
| 73. Semantic Route Judge & Success Scoring | v7.4 | 0/? | Not started | - |
| 74. Performance Dashboard & Reports | v7.4 | 0/? | Not started | - |
