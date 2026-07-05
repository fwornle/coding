# Roadmap: Coding Project — Knowledge Management

## Milestones

- ✅ **v7.3 LLM Proxy Performance — Claude CLI Worker Pool** — Phases 62–66 (shipped 2026-06-21)
- ✅ **v7.4 Performance Measurement System — Cross-agent Token + Route + Outcome Attribution** — Phases 67–75 (100% of phases; complete pending formal `/gsd-complete-milestone` close)
- 🚧 **v7.5 Cross-Agent Comparison Experiment Runner** — Phases 76–87 (active 2026-07-03)

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

<details>
<summary>✅ v7.4 Performance Measurement System — Cross-agent Token + Route + Outcome Attribution (Phases 67–75) — 100% of phases; complete pending formal close</summary>

Quantify, per task, the full cost (tokens), time-to-delivery, route quality, and outcome success across all four supported coding agents (Claude Code, Copilot CLI, OpenCode, Mastra) AND the proxy-routed background services that run during the task — so "approach X cost Y for task type Z" becomes evidence, not anecdote.

**Foundational ordering:** Phase 68 (TELEM — the `token_usage` row contract + measurement span) is the dependency anchor. Every adapter, route, score, and dashboard requirement reads or writes rows with the new columns and consults `.data/active-measurement.json`. It MUST land and verify before any per-agent adapter work (Phases 69–70) begins.

- [x] **Phase 67: Reproducibility & Replay Rig** — Snapshot/restore internal state + record/replay external state so N=1 runs become comparable (completed 2026-07-02)
- [x] **Phase 68: [FOUNDATIONAL] Token Attribution Storage** — `token_usage` schema extension + measurement-span contract + `attachTokenLogger` task_id stamping (completed 2026-06-22)
- [x] **Phase 69: Claude + Copilot Token Adapters** — Claude per-turn + per-reasoning-step JSONL adapter; Copilot events.jsonl adapter with Phase-1 event-vocabulary check (completed 2026-06-22)
- [x] **Phase 70: OpenCode + Mastra Token Adapters** — OpenCode proxy-route per-llm-call logging; Mastra instrumentation-surface read + adapter (completed 2026-06-23)
- [x] **Phase 71: Experiment KB & Task Taxonomy** — km-core ontology + Run-write path + enforced task-taxonomy v0 tag (completed 2026-06-24)
- [x] **Phase 72: Syntactic Route Quality** — `goal_sentence` capture + deterministic route heuristics per run (completed 2026-06-25)
- [x] **Phase 73: Semantic Route Judge & Success Scoring** — LLM-judge `goal_aligned_ratio` + 5-dimension rubric + user override (completed 2026-06-28)
- [x] **Phase 74: Performance Dashboard & Reports** — "Performance" tab query-builder, reasoning-step sub-bands + tier badges, Report entity + saved-query workflow + Report views (completed 2026-06-28)
- [x] **Phase 75: Measurement Attribution Accuracy & Observation Linkage** — foreground token capture + lineage attribution + canonical/per-process model + continuous ETM capture (completed 2026-06-29)

</details>

### 🚧 v7.5 Cross-Agent Comparison Experiment Runner (Phases 76–87)

Turn the v7.4 measurement rig into an experiment tool: a user states a goal plus a variant matrix ("develop X, measure it under settings A vs B") and a repeat count; the system drives each variant across agents from an identical starting snapshot, evaluates an objective success gate, and returns a scored, side-by-side comparison with per-variant variance. This is an **orchestration layer** on the v7.4 substrate (`measurement-start/stop.mjs`, `task_hash`, the experiment km-core KB + `experiments-*` CLIs, the Performance dashboard tab, proxy routing for all four agents, the Phase 67 reproducibility-replay rig) — it WIRES those primitives, it does not rebuild them.

**Prerequisite ordering:** the **VALID** phase (Phase 76) corrects correctness gaps in v7.4's already-shipped attribution / route / score code (diagnosed as O1/O2/O3 in `.planning/v7.4-attribution-findings.md`). VALID-01 (model mis-attribution) breaks "Opus vs Fable"; VALID-03 (non-GSD rubric coverage) breaks "straight vs GSD". Phase 76 MUST land and verify BEFORE the runner phases (RUN/CMP) are trusted. RUN-04 (Copilot headless-drivability) is a **gated spike** — a small capability check inside Phase 78, not a blocking dependency for the rest.

- [x] **Phase 76: Measurement Validity Fixes [PREREQUISITE]** — Canonical foreground model attribution, plausible route-time math, and 5-dimension scoring for non-GSD/ad-hoc tasks — so the two canonical comparisons are no longer corrupted at the source (VALID-01/02/03) — verified live 2026-07-03
- [x] **Phase 77: Experiment Spec & Per-Variant Snapshot Foundation** — Declarative validated variant matrix + fail-fast config resolution + per-variant×repeat snapshot restore off the Phase-67 rig (SPEC-01/02, RUN-01) (completed 2026-07-03)
- [ ] **Phase 78: Autonomous Cross-Agent Runner** — Unattended per-cell agent launch wrapped in a measured span; timeouts/aborts recorded; Copilot gated on a headless-drivability spike (RUN-02/03/04)
- [ ] **Phase 79: Comparison, Aggregation & Report** — Objective success gate, N-repeat aggregation with variance, ranked side-by-side report keyed by `task_hash` (CMP-01/02/03)
- [ ] **Phase 80: Experiment Surface — Dashboard & Skill Packaging** — Comparison as variant columns in the Performance tab + single installed `experiment run` skill across the coding agents (CMP-04, ORCH-01)

**Uniform-measurement extension (2026-07-05):** Phases 81–87 extend the milestone with the uniform 4-agent measurement program — wire-level token + context-window capture at the proxy for ALL agents, per-turn context revelation, dashboard control center + timeline v2, and interactive branch-avenue measurement. Research: `.planning/research/uniform-measurement-dossier.md`, `.planning/research/proxy-infra-report.md`.

- [ ] **Phase 81: Copilot BYOK Proxy-Routing Verification Spike** — Live probes of `COPILOT_PROVIDER_BASE_URL` against the proxy; verdict recorded in the spike doc (gates copilot wire scope in Phase 82)
- [ ] **Phase 82: Wire-Measurement Foundation** — Uniform 4-agent proxy capture: cache-token columns + /v1/messages tap cache parse + x-task-id/x-agent header binding + claude-cell & copilot routing + richer-row dedup merge
- [ ] **Phase 83: Token Reconciliation Layer** — Transcript adapters (cladpt/copadt) verify/enrich wire rows; per-span discrepancy sink; no double-counting
- [ ] **Phase 84: Per-Turn Context Revelation** — Persist every measured request as context-turns JSONL with paired usage; read APIs; honest cache explainer
- [ ] **Phase 85: Experiment Control Center** — Launch / re-run (same snapshot, param overrides) / monitor / cancel experiments from the performance dashboard
- [ ] **Phase 86: Timeline v2 & Performance Page Declutter** — Per-turn story (prompt, tool calls, cache split, context band) + IA cleanup
- [ ] **Phase 87: Interactive Spans & Branch Avenues** — Span snapshot from the main agent; forked avenue branches re-running the initial prompt with modified params; compare & merge

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
**Plans**: 7 plans
  - [x] 67-01-PLAN.md — LLM channel core: D-07 match-key + record/replay pure functions + round-trip test (Wave 1)
  - [x] 67-02-PLAN.md — Harness record + honest replay hard-fail + deterministic clock shim (Wave 1)
  - [x] 67-03-PLAN.md — Internal-state capture primitives: git-state + secret-safe env allowlist + MCP inventory + gitignore (Wave 1)
  - [x] 67-04-PLAN.md — KB capture (D-02) + full RunSnapshot assembly with manifest + clock_base (Wave 2)
  - [x] 67-05-PLAN.md — Sandbox restore (D-04) + confirm-gated --in-place (D-05) + repro-restore CLI (Wave 3)
  - [x] 67-06-PLAN.md — Proxy /api/complete replay+record taps (D-06 hard-fail on miss) (Wave 2)
  - [x] 67-07-PLAN.md — Measurement-span integration (D-09): capture-at-open + arm + fixture archive + snapshot_id + live e2e checkpoint (Wave 3)

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
  - [x] 68-01-PLAN.md — TELEM-01: token_usage additive columns + idempotent PRAGMA-guarded startup migration + extended row/insert/logCall (Wave 1)
  - [x] 68-02-PLAN.md — TELEM-02: measurement-span lifecycle (start/stop atomic archive + >24h stale warning) + single getActiveMeasurement() SDK reader + barrel export + operator CLIs (Wave 1)
  - [x] 68-03-PLAN.md — TELEM-03: proxy write-path task_id stamping via the single reader + completed-session timestamp-join backfill sweep + live restarted-daemon row gate (Wave 2)

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
**Plans**: 6 plans
  - [x] 69-01-PLAN.md — Wave 0: WAL-concurrency acceptance test + shared Claude/Copilot JSONL fixtures
  - [x] 69-02-PLAN.md — shared token-db (best-effort INSERT, distinct user_hash) + single-reader task_id resolver
  - [x] 69-03-PLAN.md — Claude per-turn + estimated per-reasoning-step rows + sub-agent parent_call_id linkage
  - [x] 69-04-PLAN.md — Copilot per-session-aggregate rows + Phase-1 vocabulary check (v1.0.63 verdict)
  - [x] 69-05-PLAN.md — Claude live-watcher/supervisor/sweep wiring + live task_id + dedup + reused backfill
  - [x] 69-06-PLAN.md — Copilot live/sweep wiring + reused backfill + cross-adapter best-effort proof

### Phase 70: OpenCode + Mastra Token Adapters
**Goal**: OpenCode and Mastra token spend lands in `token_usage` on the shared contract, completing the all-four-agent reach.
**Depends on**: Phase 68 (writes rows on the TELEM contract; gated on TELEM verification passing)
**Requirements**: ADAPT-03, ADAPT-04
**Success Criteria** (what must be TRUE):
  1. OpenCode is configured to route its LLM calls through the proxy at `host.docker.internal:12435`, and the proxy logs each call as a `per-llm-call` row.
  2. OpenCode's active `task_id` is passed via the proxy request envelope and lands on the row.
  3. Mastra's instrumentation surface is identified from `.opencode/mastra.json` (per-step middleware vs observer hooks vs framework callbacks) and its granularity tier is determined.
  4. A Mastra adapter emits rows on the shared contract at the determined granularity tier, stamped with the active `task_id`.
**Plans**: 4 plans
  - [x] 70-01-PLAN.md — Proxy OpenAI-compatible shim (/v1/chat/completions) + generic agent/granularity_tier/task_id envelope passthrough on logTokenCall (ADAPT-03 proxy half)
  - [x] 70-02-PLAN.md — OpenCode custom-provider config at localhost:12435/v1 + live human-verify gate proving an agent='opencode' per-llm-call row (ADAPT-03 end-to-end)
  - [x] 70-03-PLAN.md — Mastra instrumentation-surface investigation + D-08 proxy-route-vs-fallback resolution (ADAPT-04 SC-3)
  - [x] 70-04-PLAN.md — Mastra implementation: Track A proxy-route OR Track B host-side better-sqlite3 fallback adapter + supervisor hook, with live gate (ADAPT-04 SC-4)

### Phase 71: Experiment KB & Task Taxonomy
**Goal**: Each run materializes as an independent, queryable km-core entity with rich tags, and a curated task taxonomy is enforced so comparisons-as-queries return meaningful results.
**Depends on**: Phase 68 (Run-write path sources from `token_usage` rows + the measurement span)
**Requirements**: KB-01, KB-02, KB-03
**Success Criteria** (what must be TRUE):
  1. A km-core ontology defines `Experiment / Run / Route / Step / Decision / Outcome / Report` entities and their relations.
  2. A Run-write path materializes each run as a queryable km-core entity carrying tags (`task_hash`, `task_class`, `agent`, `model`, `framework`, `spec_level`, `snapshot_id`, `trace_id`) sourced from `token_usage` + route + score data.
  3. A task taxonomy v0 (`refactor`, `bugfix`, `new-feature`, `migration`, `debug`, `docs`) exists with definitions.
  4. The `task_class` tag is enforced as required at run-end — a run cannot close without one (not optional metadata).
**Plans**: 5 plans
  - [x] 71-01-PLAN.md — KB-01: dedicated experiment GraphKMStore + standalone experiment-ontology.json (7 classes, meta+classes, extends upper) + openExperimentStore() factory (Wave 1)
  - [x] 71-02-PLAN.md — KB-03: config/task-taxonomy.yaml closed-6 single source of truth + taxonomy.mjs (isValidClass enforcement primitive + zero-LLM deriveClassFromText heuristic) (Wave 1)
  - [x] 71-03-PLAN.md — KB-02: read-only token-usage.db aggregateByTaskId (parameterized, self-healing recompute) (Wave 1)
  - [x] 71-04-PLAN.md — KB-02: idempotent writeRun (Run with 8 tags keyed on metadata.task_id + Outcome stub + produces relation; Route/Step/Decision/Report schema-only) (Wave 2)
  - [x] 71-05-PLAN.md — KB-02/KB-03: close orchestrator (extends measurement-stop.mjs: derive/prompt→enforce→aggregate→writeRun) + experiments query/classify CLIs + SC-4 enforcement/quarantine + live verify + /gsd auto-invoke hook decision (Wave 2)

### Phase 72: Syntactic Route Quality
**Goal**: Every run carries a goal sentence and deterministic, zero-LLM route-quality metrics so route inefficiency is measurable without judge cost.
**Depends on**: Phase 71 (metrics + goal_sentence stored on the Run entity)
**Requirements**: ROUTE-01, ROUTE-02
**Success Criteria** (what must be TRUE):
  1. Each run carries a one-sentence `goal_sentence` — auto-derived from `PLAN.md` for /gsd runs, prompted at "Start measurement" for freeform runs — stored on the Run.
  2. Deterministic syntactic route heuristics are computed per run: loop count, edit-revert count, redundant/unused read count, abandoned tool-call count, total step count, and wallclock per step.
  3. The computed heuristics are stored on the Run and queryable alongside its tags.
**Plans**: 5 plans
- [x] 72-01-PLAN.md — RouteEvent schema (route-event.mjs) + computeHeuristics six strict heuristics + golden fixtures (ROUTE-02)
- [x] 72-02-PLAN.md — deriveGoalSentence zero-LLM PLAN.md/ROADMAP '**Goal**:' extractor (ROUTE-01)
- [x] 72-03-PLAN.md — Claude + Copilot normalized route-trace readers (ROUTE-02)
- [x] 72-04-PLAN.md — OpenCode read-only route reader + buildNormalizedTrace dispatcher (ROUTE-02)
- [x] 72-05-PLAN.md — writeRun Route node + flat metrics, measurement-stop wiring + recompute CLI + live verify (ROUTE-01, ROUTE-02)

### Phase 73: Semantic Route Judge & Success Scoring
**Goal**: Every run gets a semantic route-alignment ratio and a 5-dimension success score, both LLM-judge synthesized with rationale and both user-correctable.
**Depends on**: Phase 72 (reads `goal_sentence` + the route trace), Phase 68 (judge calls themselves measured via the proxy)
**Requirements**: ROUTE-03, SCORE-01, SCORE-02
**Success Criteria** (what must be TRUE):
  1. A semantic `goal_aligned_ratio` is computed by an LLM-judge (Haiku via `taskType` routing) that scores each meaningful trace event toward/neutral/away from the goal sentence, stored with rationale.
  2. Every run is scored on the fixed 5-dimension rubric (`goal_achieved`, `code_quality`, `test_coverage`, `regressions`, `spec_drift`) synthesized by the LLM-judge from whatever evidence is present, with a rationale string.
  3. A user can override any rubric dimension in the dashboard, and the corrected score is stored separately from the judged score.
**Plans**: 6 plans
  - [x] 73-01-PLAN.md — Consequential-event classifier + goal_aligned_ratio math (fixture-tested) (Wave 1) [ROUTE-03]
  - [x] 73-02-PLAN.md — Score ontology class + idempotent override-preserving writeScore/applyOverride (Wave 1) [SCORE-01, SCORE-02]
  - [x] 73-03-PLAN.md — Lean on-disk evidence harness, fail-soft to null (Wave 1) [SCORE-01]
  - [x] 73-04-PLAN.md — LLM judge: single structured Haiku call + trivial/pending quarantine (Wave 2) [ROUTE-03, SCORE-01]
  - [x] 73-05-PLAN.md — REST PATCH override endpoint: validation + dedicated-store reachability (Wave 2) [SCORE-02]
  - [x] 73-06-PLAN.md — Wire judge into close path + idempotent recompute-score CLI (Wave 3) [ROUTE-03, SCORE-01]

### Phase 74: Performance Dashboard & Reports
**Goal**: An operator can build task-anchored queries over runs, read reasoning-cost and tier honestly, and save curated findings as durable Reports.
**Depends on**: Phase 71 (queries the Run KB), Phase 73 (renders scores), Phase 69/70 (renders per-tier rows)
**Requirements**: DASH-01, DASH-02, KB-04, DASH-03
**Success Criteria** (what must be TRUE):
  1. A new "Performance" dashboard tab (slotted after Tokens) provides a task-anchored query-builder over runs.
  2. The timeline view renders `per-reasoning-step` rows as stacked sub-bands under their parent turn, and shows each run's `granularity_tier` as a badge so cross-tier averages are not over-interpreted.
  3. A `Report` entity plus saved-query workflow points at a query and a stable results snapshot so curated findings are shareable and do not bit-rot.
  4. `Report` views render a saved query against its stable results snapshot.
  5. Score override UI controls (deferred from Phase 73 per 73-CONTEXT D-07) drive the existing `PATCH /api/experiments/scores/:taskId` endpoint so an operator can correct a judged dimension from the dashboard (closes the SCORE-02 dashboard clause).
**Plans**: 6 plans
  - [x] 74-01-PLAN.md — Wave 0: shared seedIsolatedStore/seedTokenDb fixture + 5 RED node:test files + Playwright skeleton (Wave 1)
  - [x] 74-02-PLAN.md — DASH-01/02 read layer: readRuns (join + pending-exclude) + readTimeline (readonly token-usage.db sub-band grouping) (Wave 2)
  - [x] 74-03-PLAN.md — KB-04/DASH-03: Report ontology fill-in + writeReport/refreshReport + readReports/readReport (snapshot stability) (Wave 3)
  - [x] 74-04-PLAN.md — DASH-01/02/03/KB-04: 5 experiment REST endpoints (transient store) + same-origin server.js proxy to vkb-server:8080 (Wave 4)
  - [x] 74-05-PLAN.md — DASH-01/02: route + nav + sheet primitive + Performance page (faceted sidebar, corrected-wins table, collapsible timeline) [checkpoint] (Wave 5)
  - [x] 74-06-PLAN.md — SCORE-02/KB-04/DASH-03: score-override drawer + Saved Reports sub-view + live Playwright [checkpoint] (Wave 6)
**UI hint**: yes

### Phase 75: Measurement Attribution Accuracy & Observation Linkage
**Goal**: The measurement system is trustworthy for an interactive foreground agentic session — it captures the foreground chat agent's own tokens, attributes token rows by task/process lineage instead of time-window overlap, shows a canonical + per-process model breakdown, and captures observations continuously (with true event-time stamps) across a long agentic prompt-set.
**Depends on**: Phase 68 (token_usage schema + active-measurement span), Phase 69 (Claude/Copilot token adapters — `lib/lsl/token`), Phase 74 (dashboard timeline + runs table this corrects). Corrects TELEM-03.
**Priority note**: Argued **higher priority than Phase 67** (Reproducibility & Replay Rig): without correct attribution the recorded scores/tokens are not trustworthy for an interactive session, so replay would faithfully reproduce wrong numbers. Sequence 75 before 67.
**Requirements**: ATTR-01, ATTR-02, ATTR-03, OBS-01, OBS-02
**Source/evidence**: `.planning/v7.4-attribution-findings.md` (findings A–D, from the `exp-dash-start-control` dogfood measurement, 2026-06-29). Finding A (timeline drops untagged rows) and finding-1 (timeline shows event time + process per row) are already FIXED on main.
**Success Criteria** (what must be TRUE):
  1. A token row is attributed to a measurement only when it belongs to the measured task's process/agent lineage — concurrent background daemons (`consolidator-*`, `health-coordinator`, `observation-writer`) are excluded from or segregated within a foreground measurement (ATTR-01).
  2. The foreground Claude Code session's own tokens land in `token_usage` stamped with the active `task_id`, so a measured Opus session records Opus — not haiku/sonnet proxy traffic (ATTR-03).
  3. Each Run shows one canonical model AND a per-process model breakdown rendered as two columns (chat model | background-service models) consistently across runs table, score drawer, and timeline (ATTR-02).
  4. Observations produced during a measurement are tagged with its `task_id` and are queryable per Run (OBS-01).
  5. A multi-hour agentic prompt-set whose only typed prompt is at T0 yields observations dated at their real event times (operator decisions at T0+n appear at ~T0+n), not all collapsed to T0 (OBS-02).
**Plans**: 6 plans
  - [x] 75-01-PLAN.md — Wave 0: RED test scaffolds + fixtures (canonical-attribution, stop-adapter-registry, ETM-recapture e0af5b8b, e2e two-column) [Wave 1]
  - [x] 75-02-PLAN.md — ATTR-01/02: aggregation-time fg/bg lineage classifier + canonical_model/background_models persisted on Run.metadata [Wave 2]
  - [x] 75-03-PLAN.md — ATTR-03: per-agent foreground capture registry (claude=transcript cladpt, others stamp-only — no double-count) [Wave 2]
  - [x] 75-04-PLAN.md — ATTR-01/02/03: measurement-stop wiring (capture-then-derive canonical, drop dominant selector) + A1 bypass-guard [Wave 3]
  - [x] 75-05-PLAN.md — OBS-01/02: ETM mid-set re-capture (decision + tool-batch fires) + true event-time + task_id linkage [Wave 2]
  - [x] 75-06-PLAN.md — ATTR-02 display: two-column model render across runs table/score-drawer/timeline + bind-mount rebuild [Wave 3]
**UI hint**: yes

### Phase 76: Measurement Validity Fixes [PREREQUISITE]
**Goal**: The measurement rig reports a trustworthy foreground model, plausible route timing, and a full 5-dimension score for ANY task — including non-GSD / ad-hoc tasks and long, partially-idle interactive sessions — so a variant comparison is meaningful at the source and the two canonical comparisons ("Opus vs Fable", "straight vs GSD/SDD") are no longer corrupted.
**Depends on**: Phase 75 (corrects the same shipped attribution / route / score code path — extends the canonical-model + lineage work rather than re-deriving it)
**Requirements**: VALID-01, VALID-02, VALID-03
**Source/evidence**: `.planning/v7.4-attribution-findings.md` (O1/O2/O3, `exp-dash-start-control` pilot 2026-06-29). This phase is the **prerequisite gate** — RUN/CMP phases are not trusted until it verifies.
**Success Criteria** (what must be TRUE):
  1. A measured Opus interactive session records model `claude-opus-4-8` — its actual foreground session model — in the runs table, score drawer, AND timeline, not the most-frequent proxy token-row model (`claude-haiku-4.5`) skewed by Haiku judge/consolidator calls sharing the window (VALID-01).
  2. A multi-hour session with steering pauses yields per-step route times within a documented sane bound (no implausible ~28,000 s/step artifacts); idle/wait gaps are excluded or the metric is explicitly defined per active step (VALID-02).
  3. A straight-coding (non-GSD) run scores all 5 rubric dimensions — `code_quality`, `test_coverage`, `regressions` are non-null when `VERIFICATION.md` / `REVIEW.md` are absent, with signal derived from the task's tests + working-tree diff rather than only GSD artifacts (VALID-03).
  4. Re-running the two canonical comparisons ("Opus vs Fable", "straight vs GSD/SDD") on the corrected rig yields model / score / time values a human judges plausible against the known sessions — i.e. neither comparison is corrupted by O1 or O3.
**Plans**: 4 plans
  - [x] 76-01-PLAN.md — VALID-01: close the residual recompute-route model read-path (drop the dominant-by-count fallback; use canonical fg-not-dominant) (Wave 1)
  - [x] 76-02-PLAN.md — VALID-02: idle-excluding wallclock_per_step with a named 5-min threshold (kills the ~28k s/step artifact) (Wave 1)
  - [x] 76-03-PLAN.md — VALID-03: derive non-GSD code_quality/test_coverage/regressions from diff + fail-soft fixed-argv test run + score-path overlay (Wave 1)
  - [x] 76-04-PLAN.md — Regression anchor: recompute the archived pilot span + live fresh-Opus dashboard verification [checkpoint] (Wave 2) — **COMPLETE**. Task 1: dry-run recompute proves canonical never haiku (OLD byAgentModel[0]=haiku daemon → NEW fgGroups=[] → canonical=null) / no 28k artifact / non-GSD diff-derivation fires (0.26). Task 2: operator-verified live on localhost:3032/performance — link-obs-control Opus session shows Chat model=claude-opus-4.8 with claude-haiku-4.5 confined to Background; pilot span=unmeasured (not haiku); no row shows a daemon as canonical. SC 1-4 all satisfied.

### Phase 77: Experiment Spec & Per-Variant Snapshot Foundation
**Goal**: A user can declare an experiment as a validated variant matrix, and the runner can restore the identical Phase-67 starting snapshot before every variant × repeat so each run begins from the same tree + KB + routing state.
**Depends on**: Phase 76 (a comparison is only meaningful once measurement is valid), Phase 67 (wires the reproducibility-replay snapshot/restore rig — does not rebuild it)
**Requirements**: SPEC-01, SPEC-02, RUN-01
**Success Criteria** (what must be TRUE):
  1. A user declares an experiment as `{goal_sentence, variants[], repeats N}` where each variant is a named settings bundle over `{agent, model, framework/approach, env}`, via CLI flags and/or a declarative spec file (SPEC-01).
  2. Each variant resolves to a concrete executable config, validated BEFORE any run starts; unsupported combinations (e.g. Copilot headless) fail fast with an actionable message rather than mid-run (SPEC-02).
  3. Before each variant × repeat, the runner restores the identical Phase-67 starting snapshot, so every variant begins from the same git tree + `.data/knowledge-graph/` KB + routing config (RUN-01).
  4. Two repeats of the same variant are shown to start from byte-identical restored conditions (the snapshot restore is repeatable, not one-shot).
**Plans**: 3 plans
- [x] 77-01-PLAN.md — experiment-spec.mjs: YAML matrix load + cartesian-axis expansion + fail-fast validation (agent enum, unsupported-combo gate, test_command shell-safety) [SPEC-01, SPEC-02]
- [x] 77-02-PLAN.md — measurement-start.mjs: --spec/--variant + per-field flags thread validated cell into span.meta, flags override the file [SPEC-01, SPEC-02]
- [x] 77-03-PLAN.md — experiment-restore.mjs: per-cell isolated snapshot restore + byte-identical determinism digest/assert [RUN-01]

### Phase 78: Autonomous Cross-Agent Runner
**Goal**: The runner drives each variant × repeat unattended — launching the specified agent against the goal inside a measured span — producing a scored Run per cell without operator steering, with Copilot participation gated on an explicit headless-drivability capability check.
**Depends on**: Phase 77 (consumes the validated spec + per-variant snapshot restore), Phase 75/76 (each run wrapped in a trustworthy measured span)
**Requirements**: RUN-02, RUN-03, RUN-04
**Success Criteria** (what must be TRUE):
  1. The runner launches the specified agent (Claude / OpenCode / Mastra) autonomously against the goal, wrapping the work in a measured span tagged with `variant`, `repeat`, and `task_hash` (RUN-02).
  2. Runs execute unattended to completion, timeout, or abort — each producing a scored Run per variant × repeat without interactive operator steering; timeouts and aborts are recorded as such, not dropped (RUN-03).
  3. Copilot participation is gated on an explicit headless-drivability capability check (a small spike); if unsupported, the Copilot variant is skipped with a recorded reason — never silently absent (RUN-04).
  4. A full N-repeat matrix across ≥2 agents completes end-to-end and lands exactly one Run per variant × repeat cell in the experiment KB.
**Plans**: 5 plans
- [x] 78-01-PLAN.md — Run-record schema + span-seam threading (variant/repeat/terminal_state/skip_reason; R2/R3/R4)
- [x] 78-02-PLAN.md — Headless agent adapter + Copilot one-turn probe (RUN-02/04)
- [x] 78-03-PLAN.md — Runner engine: sequential idempotent matrix loop, terminal-state machine, probe gate, skip-Run
- [x] 78-04-PLAN.md — Operator CLI (scripts/experiment-run.mjs) + SC#4 integration test
- [ ] 78-05-PLAN.md — Live cross-agent smoke + acceptance checkpoint (autonomous:false)

### Phase 79: Comparison, Aggregation & Report
**Goal**: The runner turns raw per-cell Runs into an honest side-by-side comparison — gating on an objective success signal, aggregating repeats with variance, and ranking variants — so only genuinely successful runs are cost-compared.
**Depends on**: Phase 78 (consumes the per-cell Runs), Phase 71 (aggregates over the experiment Run KB)
**Requirements**: CMP-01, CMP-02, CMP-03
**Success Criteria** (what must be TRUE):
  1. An objective success gate (task test suite / UAT command) is evaluated per run; cost / route / score metrics are compared only across runs that PASS the gate — failed runs are reported separately, not averaged into a variant's cost (CMP-01).
  2. N repeats per variant aggregate into a per-variant summary carrying central tendency AND variance (spread) for tokens, wallclock, route metrics, and rubric scores (CMP-02).
  3. A side-by-side comparison report (CLI table + machine-readable export) ranks variants on the chosen metric(s), showing variance and each variant's success-gate outcome, keyed by `task_hash` for reproducibility (CMP-03).
  4. A variant whose runs all fail the gate is shown as "no successful runs", never surfaced as a cheap winner by averaging failed cheap runs.
**Plans**: TBD

### Phase 80: Experiment Surface — Dashboard & Skill Packaging
**Goal**: The whole experiment flow is invokable as a single installed skill/command across the coding agents, and its comparison is viewable in the Performance dashboard tab without re-running.
**Depends on**: Phase 79 (surfaces the comparison it produces), Phase 74 (extends the existing "Performance" dashboard tab)
**Requirements**: CMP-04, ORCH-01
**Success Criteria** (what must be TRUE):
  1. The full flow runs as a single command / skill (e.g. `experiment run --goal "…" --variants A,B --agents claude,opencode --repeats N`), installed and usable across the coding agents per the multi-agent skill ecosystem (ORCH-01).
  2. The comparison is viewable in the Performance dashboard tab as variant columns, surfacing CMP-03 without re-running the experiment (CMP-04).
  3. An operator can go from a one-line command to a rendered side-by-side variant comparison in the dashboard, end-to-end.
**Plans**: TBD
**UI hint**: yes

### Phase 81: Copilot BYOK Proxy-Routing Verification Spike
**Goal**: A live-evidence verdict on routing Copilot CLI through the measurement proxy via BYOK env vars (`COPILOT_PROVIDER_BASE_URL`/`COPILOT_PROVIDER_TYPE`/`COPILOT_PROVIDER_WIRE_MODEL`): shim reached, model mapping resolved, streaming + tool calls intact, copilot-stamped token rows in token-usage.db — recorded in `.planning/spikes/copilot-proxy-interception.md` (confirms or overturns the 2026-06-04 "no seam" conclusion). Fallback verdict if BYOK fails: copilot stays copadt-primary (3 wire + 1 reconciled).
**Depends on**: Nothing (independent live spike; gates copilot scope in Phase 82)
**Requirements**: TBD
**Plans**: TBD

### Phase 82: Wire-Measurement Foundation (Uniform 4-Agent Proxy Capture)
**Goal**: All four agents' LLM calls land in proxy `token_usage` with cache split and per-request task binding: cache-token columns in the proxy schema (names matching coding-side `ensureCacheColumns`), `/v1/messages` tap parses `cache_read/cache_creation` usage (SSE + non-streaming), `x-task-id`/`x-agent` headers honored on `/v1/messages` (kills ambient-singleton leakage), claude experiment cells re-routed through the proxy, copilot BYOK routing per the Phase 81 verdict, and `insertTokenRowDeduped` merges richer rows instead of first-writer-wins. Flag-gated: opencode anthropic-native provider for prompt-cache fidelity.
**Depends on**: Phase 81 (copilot scope)
**Requirements**: TBD
**Plans**: TBD

### Phase 83: Token Reconciliation Layer
**Goal**: cladpt/copadt transcript adapters become verify/enrich sources (new `reconcile` mode): wire rows are primary; transcript rows match by request-id (time+model fuzzy fallback); discrepancies recorded per span in `reconciliation.json`; transcript fallback preserved for proxy-down windows; copilot cache split merged from session-state — zero double-counting.
**Depends on**: Phase 82
**Requirements**: TBD
**Plans**: TBD

### Phase 84: Per-Turn Context Revelation
**Goal**: Every measured request persisted as one context-turns JSONL line (category analysis, cache-breakpoint positions, per-message digests incl. tool_use names + sizes, paired response usage), gzipped at span close with retention policy; optional flag-gated full raw bodies; read APIs on proxy (`/api/context-turns`) + vkb-server pass-through; cache explainer shows honest per-turn sent/cached/fresh numbers for all agents with the "how prompt caching actually works" copy.
**Depends on**: Phase 82
**Requirements**: TBD
**Plans**: TBD

### Phase 85: Experiment Control Center
**Goal**: Experiments can be launched, re-run (same snapshot_id + param overrides via `rerun_of`), monitored (progress-file polling), and cancelled from the performance dashboard through new detached-run trigger APIs (`POST /api/experiments/run`, `run-status`, `run-cancel`) and an experiment-launcher UI.
**Depends on**: Phase 78 (runner CLI); parallelizable with Phase 84
**Requirements**: TBD
**Plans**: TBD
**UI hint**: yes

### Phase 86: Timeline v2 & Performance Page Declutter
**Goal**: The run timeline tells the per-turn story — user-prompt excerpt, tool calls with args digests, token cost with cache split, stacked context-window band per turn — with drill-down modal and fullscreen view; performance page IA decluttered (surfaced quarantine toggle, compare-from-selection, one-step scoring, reconciliation badge); graceful degradation for runs without context-turns data.
**Depends on**: Phases 82, 84 (data); Phase 83 (reconciliation badge)
**Requirements**: TBD
**Plans**: TBD
**UI hint**: yes

### Phase 87: Interactive Spans & Branch Avenues
**Goal**: A measurement span started from the main interactive agent captures origin snapshot + initial prompt; completed spans fork into "avenues" — headless re-runs of the initial prompt with modified agent/model/framework, each on a persistent `avenue/<task_id>` git branch — grouped by origin, compared in the dashboard, merge-status tracked; measurement data survives across branches (main-`.data` stores).
**Depends on**: Phases 82, 85
**Requirements**: TBD
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
| 67. Reproducibility & Replay Rig | v7.4 | 7/7 | Complete   | 2026-07-02 |
| 68. Token Attribution Storage [FOUNDATIONAL] | v7.4 | 3/3 | Complete    | 2026-06-22 |
| 69. Claude + Copilot Token Adapters | v7.4 | 6/6 | Complete    | 2026-06-22 |
| 70. OpenCode + Mastra Token Adapters | v7.4 | 4/4 | Complete    | 2026-06-23 |
| 71. Experiment KB & Task Taxonomy | v7.4 | 5/5 | Complete    | 2026-06-24 |
| 72. Syntactic Route Quality | v7.4 | 5/5 | Complete   | 2026-06-25 |
| 73. Semantic Route Judge & Success Scoring | v7.4 | 6/6 | Complete   | 2026-06-28 |
| 74. Performance Dashboard & Reports | v7.4 | 6/6 | Complete   | 2026-06-28 |
| 75. Measurement Attribution Accuracy & Observation Linkage | v7.4 | 6/6 | Complete   | 2026-06-29 |
| 76. Measurement Validity Fixes [PREREQUISITE] | v7.5 | 4/4 | Complete | VALID-01/02/03 verified (live 2026-07-03) |
| 77. Experiment Spec & Per-Variant Snapshot Foundation | v7.5 | 3/3 | Complete    | 2026-07-03 |
| 78. Autonomous Cross-Agent Runner | v7.5 | 4/5 | In Progress|  |
| 79. Comparison, Aggregation & Report | v7.5 | 0/? | Not started | - |
| 80. Experiment Surface — Dashboard & Skill Packaging | v7.5 | 0/? | Not started | - |
| 81. Copilot BYOK Verification Spike | v7.5 | 0/? | Not started | - |
| 82. Wire-Measurement Foundation | v7.5 | 0/? | Not started | - |
| 83. Token Reconciliation Layer | v7.5 | 0/? | Not started | - |
| 84. Per-Turn Context Revelation | v7.5 | 0/? | Not started | - |
| 85. Experiment Control Center | v7.5 | 0/? | Not started | - |
| 86. Timeline v2 & Declutter | v7.5 | 0/? | Not started | - |
| 87. Interactive Spans & Branch Avenues | v7.5 | 0/? | Not started | - |
