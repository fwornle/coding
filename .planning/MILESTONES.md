# Milestones

## v7.5 Cross-Agent Comparison Experiment Runner (Shipped: 2026-07-13)

**Phases completed:** 21 phases, 109 plans, 156 tasks

**Key accomplishments:**

- Shipped the two REPRO-02 channels with no proxy chokepoint: a deterministic freeze-base + monotonic-offset Date shim (replay-run entrypoints only, daemon-forbidden) and the WebSearch/WebFetch/MCP harness channel as an honest post-hoc transcript record() plus a replay() that hard-fails REPLAY_UNSUPPORTED_CHANNEL rather than silently hitting live services.
- Three composable, injection-safe capture units for REPRO-01 — git workspace state (D-03: SHA + re-applyable binary dirty patch + untracked + per-submodule dirty), a secret-safe agent-affecting env allowlist, and a live/fallback MCP inventory — plus the `.data/run-snapshots/` gitignore guard.
- Safe-by-default RunSnapshot restore that reconstructs an isolated git worktree + sandbox KB/config (never touching live), with the sole destructive `--in-place` path gated by a mandatory auto safety-snapshot and a strict typed confirmation.
- Wired D-07 record + D-06 hard-fail replay taps into the live rapid-llm-proxy `POST /api/complete` handler, reusing the single `getActiveMeasurement` span reader and the single Plan 01 fixtures impl via an env-resolved dynamic import — inert unless the active span arms them.
- Wired the full record→replay loop through the Phase-68 measurement span: `measurement-start.mjs` captures a RunSnapshot + arms record/replay via the existing `startMeasurement` meta passthrough, `measurement-stop.mjs` archives fixtures + links `snapshot_id` onto the Run, and `run-write.mjs:108` stops hardcoding null — proven live end-to-end against the running proxy daemon (recorded responses served byte-identical, novel prompt hard-fails 409, default restore never touches live HEAD).
- Task 1 — migration + type (commit `56a8c15`, rapid-llm-proxy):
- Task 1 — measurement-span.ts (commit `3cdf4ee`, rapid-llm-proxy):
- Task 1 — write-path stamping + resolveLiveTaskId + stamping test (rapid-llm-proxy `5aa92a2` feat, `bf17f24` test):
- WAL-concurrency acceptance test (node:test, busy_timeout=5000, sentinel-isolated, finally-cleaned) plus three redacted Claude/Copilot JSONL fixtures every downstream adapter test consumes.
- Host-side best-effort `better-sqlite3` INSERT helper (`token-db.mjs`, distinct `cladpt`/`copadt` user_hash, busy_timeout=5000, never throws) plus the single-reader live `task_id` resolver (`task-id.mjs`) — the two shared contracts Plans 03/04 build against.
- 1. [Rule 3 - Blocking] ESM jest requires NODE_OPTIONS flag
- Task 1 — `buildCopilotTokenRows(eventsJsonlPath, ctx)`
- 1. [Rule 3 - Blocking] Exported `runSweep` + `loadArchivedSpans` and added an entry-point guard in `backfill-task-id-by-timestamp.mjs`
- Task 1 — Generic envelope passthrough on the `logTokenCall` build
- ADAPT-03 fully closed (SC-1/SC-2).
- coding repo
- ADAPT-04 SC-4 closed.
- Created the dedicated experiment km-core store (`openExperimentStore()`) and the standalone 7-class experiment ontology that loads into a live OntologyRegistry where `isValidClass('Run')` is true — the foundation every later Phase 71 plan consumes.
- Closed-6 task taxonomy v0 (refactor/bugfix/new-feature/migration/debug/docs) as a YAML single-source-of-truth plus a pure taxonomy module exporting the D-09 closed-6 write-path enforcer (isValidClass) and the D-11 zero-LLM verb→class keyword scorer (deriveClassFromText), proven by a 9-test node:test suite.
- 1. [Rule 2 — Missing critical functionality] Graceful missing-DB path via `fs.existsSync` pre-check
- `writeRun(store, { span, taskClass, pending, tags, totals })` materializes each measurement span as an independent, queryable km-core Run entity carrying all 8 tags (D-13), plus a basic Outcome stub (token totals + closedState) and a `Run--produces-->Outcome` relation (D-12) — idempotent on `metadata.task_id` so a re-close updates the same node and self-heals the Outcome totals rather than duplicating (D-14).
- Wires the coding-side run-end pipeline (D-07): `scripts/measurement-stop.mjs` now closes the span, derives/prompts a task_class, enforces the closed-6 (free strings rejected, SC-4), quarantines headless-no-class closes without hard-blocking (D-06), aggregates token totals read-only, and writes an idempotent Run — plus the two read/resolve CLIs (`experiments-query` excludes pending, `experiments-classify` resolves the quarantine backlog and re-includes), all proven by a 4-case enforcement suite with the full experiments suite green (28 tests, 27 pass, 1 EXPERIMENTS_LIVE-gated skip).
- Task 1 — `lib/lsl/route/route-event.mjs` (commit `923e5d19d`)
- 1. [Rule 3 - Blocking] `grep -c "console\." == 0` acceptance gate vs. explanatory comment
- Task 1 — `lib/lsl/route/claude-route-trace.mjs` (RED `e64e9d8f2` → GREEN `609bda53a`)
- 1. [Rule 3 - Blocking] Exported `isOwnedByMe` + `openReadonlyDb` from opencode-sqlite.mjs
- Task 3 (`type="checkpoint:human-verify" gate="blocking"`) was NOT executed
- Pure zero-LLM route primitives: a frozen acting-tool classifier, a shared consequential-event filter, a trivial-run guard, and the toward/(toward+away) neutral-excluded ratio with null-not-zero degradation.
- Idempotent, override-preserving `Score` km-core write path — adds the `Score` ontology class + `Run--scored-->Score` relation and clones `run-write.mjs` into `score-write.mjs` (writeScore + applyOverride), defining the judgment object contract the judge (73-04) produces and the close orchestrator (73-05) consumes.
- One-liner:
- Run-close now gathers on-disk evidence, judges the consequential trace (or marks trivial), and writes a Score + `scored` edge — all inside the existing try/finally so a proxy-down judge never hard-blocks — plus an idempotent `experiments-recompute-score.mjs` re-judge CLI that preserves human overrides.
- 1. [Rule 1/3 — Contract mismatch] Followed the RED-test API signatures, not the plan's `<interfaces>` prose
- 1. [Rule 1/3 - Contract mismatch] handleRunsQuery returns `{ rows }` and sets status 200 explicitly
- 1. [Rule 3 — Blocking tooling] Vendored sheet.tsx instead of `npx shadcn add sheet`
- 1. [Rule 1 — Bug] Playwright `networkidle` wait never settles → switched to `domcontentloaded` + h1 assertion
- Four RED test artifacts (2 node:test .mjs, 1 jest .js, 1 playwright .ts) + 2 owned transcript fixtures that lock the canonical-derivation, no-double-count, and OBS-02 event-time acceptance shapes before any seam is touched.
- Aggregation-time foreground/background lineage classifier (`isForegroundGroup`) plus once-computed canonical_model/canonical_agent/background_models[] persisted on Run.metadata — turning the finding-B mis-measure (1.24M haiku daemon tokens out-massing the Opus foreground) into a correct, null-safe canonical source-of-truth with no proxy-DB schema change.
- A per-agent registry that captures ONLY the proxy-bypassing foreground agent (claude → cladpt transcript rows stamped with the active task_id) while leaving proxy-routed agents (copilot/opencode/mastra) stamp-only — closing the ATTR-03 gap where a measured Opus session recorded 0 cladpt rows, without double-counting tokens that are already in `token_usage` via the proxy.
- Wires Plan 02's fg/bg derivation and Plan 03's foreground capture into `measurement-stop.mjs` — the single close convergence point — so every newly-closed Run captures foreground tokens first, derives canonical from the foreground chat agent (never the dominant daemon), segregates background models, and warns on a possible Anthropic-direct proxy bypass; the finding-B `dominant = byAgentModel[0]` selector is removed.
- ETM now fires observations mid-prompt-set on AskUserQuestion decisions and significant tool-activity batches (>=8 tool_use OR >=10min), stamps each at its REAL event time instead of collapsing to the prompt-set start (T0), and links every observation to the active Run via task_id — turning the e0af5b8b acceptance case (decisions 05:30-06:03Z) into observations dated ~05:30-06:03Z (OBS-02 + OBS-01).
- The Performance runs table now renders two model columns — the canonical (foreground chat) model and the concurrent background-service models — and the score drawer + timeline READ the same persisted `Run.metadata` fields, so the operator sees the honest chat model (e.g. Opus) consistently everywhere instead of finding B's daemon-dominated `byAgentModel[0]` (haiku). Legacy Runs with no foreground capture show the D-05 "unmeasured" sentinel; an empty background column shows the em-dash. Built clean and served on localhost:3032; the visual/E2E acceptance is the pending Task 3 operator checkpoint.
- `experiments-recompute-route.mjs` no longer falls back to the dominant-by-count token group (`byAgentModel[0]`) — it now selects the canonical foreground-not-subagent model exactly as the stop path does, and threads `canonical_model` through `writeRun` so a re-close can never re-stamp a measured Opus run as the haiku daemon.
- `wallclockPerStep` redefined as the sum of active inter-event gaps ÷ step count, excluding gaps longer than a single named 5-min idle threshold (env-overridable via `ROUTE_IDLE_GAP_MS`), killing the ~28,000 s/step artifact on multi-hour steering-paused traces.
- When `VERIFICATION.md`/`REVIEW.md` are absent, `evidence-harness.mjs` now derives `code_quality` from the working-tree diff and `test_coverage`/`regressions` from a fail-soft fixed-argv run of the task's test command, and both score consumers gap-fill those three dims onto the judgment before `writeScore` — closing the VALID-03 gap that corrupted the "straight vs GSD" comparison, with null only when genuinely no signal exists and never a guessed 0.
- The corrected recompute rig, re-run on the archived `exp-dash-start-control-claude-opus-4-8` pilot span, provably drops the haiku dominant (canonical=null, never `claude-haiku-4.5`), does NOT reproduce the ~28,364 s/step artifact, and fires the non-GSD `code_quality` diff-derivation (0.26 when a working-tree diff exists) — recorded as concrete before/after numbers. Task 2 (the live fresh-Opus dashboard render) is a human-verify checkpoint and is surfaced below for the operator.
- Pure YAML experiment-spec resolver: cartesian axis expansion into `{agent,model,framework,env,test_command}` variant cells with pre-run all-or-nothing validation (agent enum, copilot+headless combo gate, test_command shell-safety) via the single canonical SHELL_META_RE.
- `measurement-start.mjs` now threads a variant's executable config into `span.meta` — either from per-field CLI flags (SPEC-01) or by resolving a named cell out of a validated experiment spec (SPEC-02) — with flag-over-spec override (D-03), snake_case `test_command` for the evidence harness (D-04), and fail-fast shell-safety / validation before the span ever opens.
- Deterministic per-cell restore proof: every variant × repeat restores from one declare-time baseline into an isolated sandbox (inPlace:false), digests git_sha + KB + routing config with an order-invariant sha256, and either proves two repeats byte-identical or aborts the experiment printing both divergent digests.
- 1. [Rule 3 - Testability enabler] Gated `measurement-stop.mjs` `main()` behind `isDirectRun`
- `lib/experiments/agent-headless.mjs`
- `runMatrix` — the sequential, idempotent, resumable variant×repeat matrix loop that restores an isolated sandbox per cell, launches each headless agent under a 20-min SIGTERM→SIGKILL terminal-state machine, and lands exactly one inline-scored Run per attempted cell (probe-gating copilot and recording best-effort failures).
- One-command matrix runner `scripts/experiment-run.mjs` over the 78-03 runMatrix engine, plus an automated SC#4 integration proof that a stub-agent matrix lands exactly one Run per variant×repeat cell, idempotent on re-run, with abort states recorded and retried.
- Status:
- Persists the objective per-cell test-gate outcome (`gate_passed: true|false|null`) as a discrete queryable field on the Score entity at score time, reusing the already-computed `evidence.testRun` (no second test run) so Plan 02's aggregator can separate gate-passers from failed/ungated runs.
- Task 1 — `lib/experiments/compare.mjs` (pure aggregator)
- Task 1 — sanitizer + JSON/CSV writers (TDD)
- Live `GET /api/experiments/comparison` on the vkb-server returning the frozen Phase 79 report JSON, with gate_outcome stamping extracted into a single shared `compare.mjs` helper imported by both the CLI and the endpoint (no 79->80 schema drift).
- A single installed `experiment` skill wrapping the full declare→run→compare flow: synthesizes a classified (CLOSED_6 task_class) + baselined (resolvable snapshot_id) spec YAML from headline flags, runs the matrix via `experiment-run.mjs --spec`, re-derives the concrete `task_hash` (sha256 of the goal_sentence) skill-side, and auto-runs `experiments-compare.mjs --task-hash "$TASK_HASH"` — distributed to Claude, Copilot, and OpenCode.
- A new "Comparison" 5th sub-tab in the Performance dashboard tab renders the Phase-79 variant matrix — variants as columns, metrics ± variance / gate / n as rows, ranked best-first — fed live by `GET /api/experiments/comparison` via a task_hash-keyed `fetchComparison` Redux thunk. The four honesty-spine groups (ranked / failed / ungated / unscored) are visibly separated; a variant with no successful runs shows in FAILED, never a cheap winner.
- `src/usage-cache.ts` (new, compiles to `dist/` via `npm run build`)
- `proxy-bridge/server.mjs` (runtime, no build)
- Live end-to-end proof that the wired proxy substrate binds every agent's tokens to its own task_id under concurrent load — including a mid-gate fix for a residual /api/complete ambient-span leak — with copilot BYOK and opencode each writing a real file on disk via native tool-call passthrough.
- OpenAI-wire cache parsing on the shim/copilot path (D-09) plus a request-id dedup index + coordinated id allocation that ends tap-vs-adapter id collisions (D-11) — combined Plan 01+02 proxy edits built and live-verified on port 12435.
- Pre-existing: `tests/token-adapters/token-db.test.js` throws `ReferenceError: test is not defined`.
- The no-double-count contract in action — `captureForegroundTokens(span, { reconcile: true })` replaces the blind insert loop with the Plan-03 match-then-enrich-or-fallback matcher on measured spans only, returning a structured reconciliation report while leaving the interactive Stop/sweep path byte-identical.
- Task 1 — reconcile invocation + sink (`scripts/measurement-stop.mjs`, D-01/D-12/D-06).
- 1. [Design choice within Task 2 discretion] Removed the launcher's unbound `/v1/copilot` else-branch
- Live human-verified golden comparison proves the full reconciliation stack: routed-claude reconciled totals equal the pre-change transcript-only baseline (no double-count, no loss), a proxy-down cell falls back to full transcript capture with fallback provenance, and a healthy span shows unmatched_wire=0 — the Phase-83 acceptance gate is PASSED.
- Closed the three verified BLOCKERs from 83-VERIFICATION.md: reconciliation.json now reports real per-field aggregate deltas, a meaningful cladpt orphan `unmatched_wire`, and recovered foreground attribution for interactive-launch spans — all via surgical host-side fixes with no proxy/docker rebuild.
- CR-01 (coding) — fuzzy candidates scoped to the pre-loop wire snapshot.
- Wave-0 scaffold for the per-turn-context-revelation phase: a shared node:test harness, three secret-free recorded request-body/observation fixtures, and nine skipped stub tests — one per RESEARCH test-map behavior — each pointing at the downstream plan that implements it.
- The LSL redaction applier now loads and applies the project's configured 27-pattern secret/PII set from `.specstory/config/redaction-patterns.json` (was only 4 hardcoded PII regexes), exposes a shared `loadRedactionPatterns(configPath)` for the proxy-side raw-body writer, and preserves the exact `{content, redactionCount, securityLevel}` caller contract with the fail-closed catch intact.
- A dedicated hourly launchd job (`com.coding.context-turns-sweeper`) that reclaims per-request `context-turns.jsonl(.gz)` and `raw-bodies.jsonl(.gz)` files under `.data/measurements/<task>/` by age (default 14 days, `CONTEXT_TURNS_RETENTION_DAYS`-configurable), decoupled from span close and best-effort never-throw — cloned from the proven lsl-lock-sweeper trio, registered and verified live via launchctl.
- The core of the phase: a single best-effort never-throw write hook at the proxy appends one honest context-turns JSONL line per measured request (separate cache split, wire discriminator, D-08 breakpoint indices, taxonomy categories, per-message digest with a ≤120-char preview + tool meta, observation_ref:null), and a same-origin `GET /api/context-turns` route serves the per-turn array with graceful-empty on miss. The pure line-assembly logic was extracted to a sibling module so the unit tests exercise the real production path without booting the proxy.
- At span close (`scripts/measurement-stop.mjs`, beside the reconciliation.json write) each per-turn context line is enriched with the nearest correlating ETM observation (time-window + agent, best-effort D-07), then the plaintext `context-turns.jsonl` is gzipped to `.gz` and removed (D-03) and `raw-bodies.jsonl` is likewise gzipped when present — all best-effort never-throw, so a crashed span leaves a readable plaintext for the age sweeper. Correlation runs HERE, not in the proxy hot path (Pitfall 1: observations have no task_id and don't exist at request time).
- The proxy now captures FULL raw request/response bodies for a measured span — but only when the per-span flag `span.meta.capture_raw_bodies` is `true` (default OFF), with every body redacted via the shared 27-pattern configured set BEFORE write (fail-closed to `[REDACTION_ERROR_CONTENT_BLOCKED]` on any redaction error, never crashing the daemon), appended to a SEPARATE `raw-bodies.jsonl` sibling so retention can drop raw bodies independently of the always-on context-turns digest.
- The per-span context-turns file is now readable through the read surfaces (D-10): a thin vkb-server pass-through (`handleContextTurns`) cloned verbatim from `handleReconciliation` — gunzip the span-close `.gz` (plaintext `.jsonl` fallback while the span is open), 200 graceful-empty `{contextTurns:[]}` on miss (never 500), traversal-guarded by the existing `_validTaskId` — plus the dashboard backend `/api/context-turns` same-origin proxy mirror to the LLM proxy :12435, giving the Plan 84-08 cache explainer a data source. The file is served VERBATIM (no re-shaping).
- The existing context-cache-explainer now consumes the real per-request context-turns (D-11/D-12): a `fetchContextTurns` thunk + `selectContextTurnsFor` selector mirror `fetchTimeline`, `summarize()` prefers the honest usage-reported wire values over the timeline's ~bytes/4 estimate, OpenAI-wire cache-write renders as the exact string "N/A (provider reports no cache-creation)" (never 0 or an inferred value) at both per-turn and run-aggregate levels, and a "how prompt caching actually works" copy block explains the Anthropic-wire (has a cache-creation counter) vs OpenAI-wire (cache reads only) asymmetry. No new components — the explainer was extended in place.
- The whole per-turn-context-revelation pipeline was proven honestly end-to-end on one live measured span: the proxy was redeployed (build `e72666a` -> `b1e0a49`) after confirming the coordinator `location=open`, a single measured span with `capture_raw_bodies=true` fired three real `/api/complete` requests, span close produced real `context-turns.jsonl.gz` + `raw-bodies.jsonl.gz`, both read APIs (proxy + vkb-via-dashboard, plus the newly-activated dashboard mirror) served the three OpenAI-wire turns, the live raw bodies redacted three embedded synthetic secrets to `<SECRET/TOKEN/JWT_REDACTED>` with zero unredacted survivors, and the cache explainer rendered the live per-turn split with "N/A (provider reports no cache-creation)" for every OpenAI-wire turn — captured in gsd-browser screenshots. The phase-gate human-verify checkpoint (Task 3) was APPROVED by the operator, who requested three post-approval UI refinements (#1 divider visibility+alignment and #2 an honest Timeline reconciliation note — both applied; #3 a Timeline per-turn intent fallback — assessed and deferred to Phase 86). Phase 84 is COMPLETE (9/9 plans).
- Task 1 — atomic progress emitter (`run-progress.mjs` NEW + runMatrix hooks).
- Task 1 — host executor seam (`00637da46`)
- Task 1 — `handleExperimentRun` + `handleRunCancel` (`9ffcc1117`, RED `01bfa22c8`)
- Task 1 — `performanceSlice.ts` thunks + selectors + prefill reducer (`e67741470`)
- The whole Experiment Control Center proven LIVE end-to-end: a dashboard click spawns a real cross-agent runner ON THE HOST (via the coordinator :3034 seam), the 5s-poll monitor advances, Cancel reaps the detached process group and frees the 409 slot, Re-run pre-fills the launcher with a constant task_hash, and capture_raw_bodies produces raw bodies only when ON — with per-run runner.log diagnosability and a Playwright structure gate.
- 1. [Rule 3 - blocking] Cross-`.ts` import under `integrations/` rejected by root tsconfig `rootDir='./src'`
- 1. [Rule 1 - Bug] Reconciliation wire shape differs from the plan's sketch
- Timeline v2 — compact turn rows (tool chips + mini context band + advisory loop badge) that open a scrubbed Radix single-turn drill-down modal, plus a routed fullscreen whole-run view with the cumulative context-growth band + keyboard nav; DASH-02 tier badge + reasoning sub-bands and the D-06 v1 fallback preserved.
- Declutter IA for the Performance page: a page-header "Show quarantined (N)" control with a live count (out of the sidebar), inline-editable score cells that autosave through the existing server-authoritative `saveOverride` PATCH with optimistic-revert, per-run reconciliation badges (✓/⚠/transcript-fallback, absent when no data), and "Compare selected (2)" → the Plan-04 difference viewer in the Compare tab.
- Task 1 — `lib/experiments/avenue-branch.mjs` (TDD):
- 1. [Rule 3 - Blocking] Drift test relaxed from strict-equality to superset
- `tests/experiments/avenue-crossbranch.test.mjs`
- Read-only git merge-status compute (`merge-tree --write-tree` / `rev-list --left-right` / `branch --merged`, never mutating main) plus a conflict-blocked `promoteAvenue` and on-demand prune, all exposed host-only through coordinator endpoints and vkb-server proxy routes (AVN-08/AVN-09).
- Live visual verification (gsd-browser, both themes) + the mandatory dashboard rebuild+restart are DEFERRED to the orchestrator's post-merge verification.
- Task 1 — slice extension (`performanceSlice.ts`, commit `267fcde25`):
- 1. [Rule 3 - Blocking] Dashboard typecheck gate could not resolve deps in the worktree
- Corrected the two Blocker misleading fork comments (G4), added the AVN-01..09 REQUIREMENTS ledger (G5), and — through the real launch path — produced the first live avenue fork whose two origin_span_id-bearing Runs render in an origin-grouped Avenues panel with a git-computed "conflicts" merge badge, verified visually in both themes.

---

## v7.3 LLM Proxy Performance — Claude CLI Worker Pool (Shipped: 2026-06-21)

**Phases completed:** 5 phases (62–66), 16 plans
**Git range:** `638d525e3` (62-01) → milestone close — 2026-06-20 → 2026-06-21
**Audit:** `tech_debt` — 14/14 requirements satisfied, integration_ok, 0 blockers (see `milestones/v7.3-MILESTONE-AUDIT.md`)
**Known deferred items at close:** 23 pre-existing cross-milestone artifacts (acknowledged — see STATE.md Deferred Items) + 1 new non-blocking `overhead_ms` export/hydrate gap

**Outcome:** Replaced the per-call `claude` CLI `execFile` spawn on the claude-code fallback path with a pool of warm, persistent stream-JSON workers — cutting sonnet/opus fallback latency from ~10–14s to ~2–3s steady-state and keeping Anthropic's prompt-cache warm.

**Key accomplishments:**

- **Persistent worker pool (Phase 62 — POOL-01..04, GUARD-01):** per-model (haiku/sonnet/opus), concurrency-1, lazily-spawned `claude -p` stream-JSON workers serving ONLY the claude-code CLI-fallback path, behind the orthogonal `LLM_PROXY_DISABLE_WORKER_POOL` escape hatch; direct-OAuth path unchanged.
- **Full worker lifecycle (Phase 63 — WLIFE-01..04, live-proven 9/9):** lazy spawn, idle eviction (default 30 min), crash-recovery surfaced as RETRYABLE with a per-key respawn-storm cooldown, and client-disconnect cancellation (SIGTERM+dispose+drop in-flight / dequeue queued) so a dead client never pins a concurrency-1 worker.
- **Worker hygiene (Phase 64 — GUARD-02/03):** CLI version-drift recycle (keeps prompt-cache assumptions valid across `claude` upgrades) + stderr drain-and-throttle (≤1 log/min/worker).
- **Acceptance, operator live-run (Phase 65 — PERF-01/02, 12/12 PASS):** warm sonnet `say OK` ≤3s steady-state with cache-presence floor; pool survives a worker SIGKILL and keeps serving; idle respawn + escape-hatch revert both clean.
- **Dashboard observability (Phase 66 — PERF-03):** introduced a per-model SPAWN/QUEUE `overhead_ms` metric (dispatch→first-output, EXCLUDING generation — the latency the pool actually controls) with a NULL-safe `p50_overhead_ms` median, graded green/amber/red on both `:3032` surfaces. Gap-closure arc (66-03/04/05): the executor refused to fake an unreachable SC-2 red on this fast host, surfaced the threshold-vs-real-overhead mismatch, and closed it with an opt-in `LLM_PROXY_WORKER_SPAWN_DELAY_MS` test seam — SC-1 (warm→green) and SC-2 (regression→red) both live-proven via gsd-browser computed-rgb read-back.

---

## v7.2 VKB & Online-Learning Quality — Graph Data Quality, Ontology Rework, Viewer UX Integrity (ACTIVE)

**Why:** Phase 56.1 visual smoke (2026-06-13/14) surfaced a cluster of seven inter-related quality issues across the unified viewer + online learning pipeline + ontology layer. The foundational pipeline is healthy (km-core export at 1262 nodes / 1592 edges / 88% connectivity after the 2026-06-10 backfill + repair commits), but the long tail of data quality issues makes operators work around the graph view instead of relying on it. Two of the surfaced todos carry operator-set `scope_hint: This is a multi-phase milestone, not a single TODO`.

**Goal:** Bring the online learning pipeline → km-core → unified viewer surface to production data quality, so operators rely on the graph view for navigation and triage instead of working around known-broken rendering.

**Target features (6):**

1. Online pipeline emits semantic-content edges (mentions / dependsOn / isRelatedTo / instanceOf) on Insights — not just `capturedBy → LiveLoggingSystem`.
2. Ontology rework — clarify upper/lower split, build out lower ontology for coding-specific concepts (LSL, ConstraintMonitor, Online-Observation/Digest/Insight tiers), per-project grouping in viewer.
3. VKB rendering UX integrity — Evidence/Pattern filter symmetry, Legend derived from rendered graph, eliminate Observations/Digests architecture bleed, restore CollectiveKnowledge visibility under Online filter.
4. LSL timeline scale honesty — remove 200-record silent cap, honest "all" window name, bi-source coloring (manual vs online) on ticks.
5. OKB data routing fix — resolve `/api/entities` vs `/api/v1/entities` contract mismatch so `/viewer/okb` reaches OKM Express on :8090.
6. Long-tail orphan fixes — close Phase 48 (System-type vanish), Phase 49 (orphan project-anchor relations); reduce 157-orphan baseline materially.

**Scope seed (cluster of 9 todos):**

- `.planning/todos/pending/2026-06-14-online-pipeline-semantic-edges-and-timeline-bi-source.md` *(operator-flagged multi-phase milestone)*
- `.planning/todos/pending/2026-06-14-ontology-rework-lower-ontology-and-project-grouping.md` *(operator-flagged multi-phase milestone)*
- `.planning/todos/pending/2026-06-14-online-filter-hides-ck-truncates-trace.md`
- `.planning/todos/pending/2026-06-14-vkb-evidence-pattern-filter-asymmetry-and-ontology.md`
- `.planning/todos/pending/2026-06-14-vkb-legend-static-cross-domain-bleed.md`
- `.planning/todos/pending/2026-06-14-vkb-shows-observations-digests-architecture-bleed.md`
- `.planning/todos/pending/2026-06-14-lsl-timeline-200-cap-and-all-window-misnaming.md`
- `.planning/todos/pending/2026-06-10-okm-express-api-contract-bridge.md`
- ROADMAP entries Phase 48 (System-type vanish) + Phase 49 (project-anchor orphans) — placeholders folded into v7.2 phase scoping

**Out of scope:**

- LLM proxy worker pool perf (now queued as v7.3 — see below)
- Cross-agent performance measurement system (now queued as v7.4)
- Phase 51 follow-up todos (`opencode-schema-migration-update`, `sweep-llm-proxy-probe-fix`, `json-export-missing-source-field`, sub-agent dashboard observability gap) — agent-capture concerns, not graph data quality
- Phase 54 ETM hardening — operationally adjacent but already its own backlog phase with 3 plans pre-drafted (runs in parallel)
- Phase 35-04/05 retention wiring — runs in parallel
- Phase 46 ONBOARDING.md operator UAT — v7.1 close-out, runs in parallel

**Phase numbering:** Continues from current state. Phase 56.1 was last; new milestone phases start at **Phase 57**.

**Status:** ACTIVE 2026-06-14. Started while v7.1 still has one Phase 46 HUMAN-UAT pending (ONBOARDING.md operator dry-run). v7.1 will be formally archived once that UAT lands.

---

## v7.3 LLM Proxy Performance — Claude CLI Worker Pool (QUEUED, not active — renumbered from v7.2 on 2026-06-14)

**Why:** The `claude-code` direct OAuth path (~0.9s, real token counts) handles haiku perfectly, but Anthropic rate-limits the bearer endpoint per-model. Sonnet/opus on Max-OAuth hit HTTP 429, and the proxy now falls back to the `claude` CLI subprocess — which works against the same Max subscription via a different rate-limit bucket but costs ~10-14s per call due to per-request CLI spawn + the ~16-22K cache_creation system prompt the CLI auto-injects.

**Goal:** Maintain a small persistent pool of warm `claude` CLI workers communicating over stream-JSON stdin/stdout, eliminating the per-call spawn (~3-5s) and keeping Anthropic's prompt-cache warm for the auto-injected system prompt (~2-3× cheaper + faster on cache hits). Expected: 7-15s → ~2-3s per CLI-fallback call.

**Research seed:** `.planning/research/v7.2-llm-proxy-perf-worker-pool.md` *(filename retains the v7.2 origin — content unchanged; new milestone slot is v7.3)*

**Status:** Queued. Do NOT activate while v7.2 (VKB & Online-Learning Quality) is in progress. Plan-phase work to begin after v7.2 ships.

---

## v7.4 Performance Measurement System — Cross-agent Token + Route + Outcome Attribution (QUEUED, not active — renumbered from v7.3 on 2026-06-14)

**Why:** Today we have no quantitative basis for recommending agent / model / framework / spec-level choices to dev teams. The proxy's `/api/token-usage` Evolution chart covers background services (wave-analysis, observation-writer, health-coordinator), but the agent-side spend — user ↔ CA conversations, sub-agents, per-tool-call breakdowns — is invisible. Without per-task attribution across both sides, "approach X cost Y for task type Z" is anecdote, not evidence.

**Goal:** Build a measurement rig that quantifies, per task, the full cost across all four supported agents (Claude Code, Copilot CLI, OpenCode, Mastra) AND the proxy-routed background services that run during the task. Attribution at the best granularity each agent surfaces (Claude per-turn + per-reasoning-step for extended thinking, Copilot per-session-aggregate or per-turn pending verification, OpenCode per-llm-call via proxy, Mastra TBD). Time-series on one timeline via the existing `.observations/token-usage.db` extended with `agent`, `task_id`, `tool_call_id`, `parent_call_id`, `granularity_tier`, `reasoning_tokens`. Full snapshot/restore for reproducibility (git + KB + `.planning/` + routing config + MCP inventory + external HTTP fixtures). New km-core KB of `Experiment / Run / Route / Step / Decision / Outcome / Report` entities and a "Performance" dashboard tab (slotted after Tokens).

**Scoping artifacts:**

- `.planning/notes/v73-perf-measurement-exploration.md` — 7 architectural decisions + 9-phase shape sketch with Phase 3 flagged FOUNDATIONAL *(filename retains v73 origin; new slot is v7.4)*
- `.planning/notes/v73-token-attribution-contract.md` — storage / measurement-span / per-agent adapter contracts
- `.planning/spikes/copilot-proxy-interception.md` — completed spike (4-approach verdict table + recommendation)
- `~/.claude/projects/-Users-Q284340-Agentic-coding/memory/feedback_perf_measurement_requirements.md` — hard requirements

**Out of scope:** VS Code Copilot Chat (state.vscdb opaque); policy automation / auto-routing (queued as v7.5); currency conversion (v7.5).

**Status:** Queued. Do NOT activate while v7.2 (VKB & Online-Learning Quality) or v7.3 (LLM Proxy Worker Pool) is in progress. The full `/gsd-new-milestone` workflow (requirements + roadmap) runs after both ship. Todo: `.planning/todos/pending/start-v73-milestone.md` *(filename retains v73 origin; the todo body refers to the same scope, now slotted as v7.4)*.

---

## v6.0 v6.0 (Shipped: 2026-04-25)

**Phases completed:** 7 phases, 11 plans, 25 tasks

**Key accomplishments:**

- fastembed ONNX embedding service with all-MiniLM-L6-v2 (384-dim), content hashing for idempotency, and Qdrant collection management for 4 knowledge tiers
- One-shot CLI backfill of 1464 knowledge items (645 observations, 132 digests, 12 insights, 675 KG entities) into 4 Qdrant collections with content-hash idempotency
- Redis pub/sub event bus wiring ObservationWriter to embedding listener for automatic Qdrant upserts within seconds of observation creation
- Hybrid retrieval engine combining RRF-fused semantic (Qdrant) + keyword (FTS5/LIKE) + recency search with tier-weighted scoring and gpt-tokenizer budget enforcement
- POST /api/retrieve endpoint wired into health API server with input validation, latency tracking, and Docker bind-mount for retrieval modules
- UserPromptSubmit hook injecting Qdrant-retrieved knowledge (insights, digests, entities, observations) as system-reminder context into Claude Code conversations with fail-open design
- Shared fail-open HTTP retrieval client with context-aware scoring (project 1.15x, cwd 1.10x, recent_files 1.20x cumulative boosts)
- Migrated Claude hook to global settings with shared retrieval client; created OpenCode/Copilot/Mastra session-start adapters; wired all into agent launch pipeline with fail-open timeout
- Live working memory from VKB KG entities + STATE.md frontmatter, token-budgeted to 300 tokens, prepended to every retrieval response
- Per-agent RRF scoring profiles with tier weight multipliers flowing from all four adapters through retrieval service to fusion layer
- Session state writer on agent exit with cross-agent injection via working memory using 2-hour staleness window and fail-open design

---

## v4.0 Mastra Integration & LSL Observational Memory (Shipped: 2026-04-05)

**Phases completed:** 4 phases, 11 plans, 22 tasks

**Key accomplishments:**

- LLM proxy bridge server ported from OKM, delegating to existing lib/llm/LLMService with network-adaptive routing. Token budget and plugin config files created.
- Mastra OpenCode install/uninstall/test functions added to lifecycle scripts with Node 22+ gate, LibSQL storage at .observations/, and 5-check smoke test
- Mastracode agent adapter, launch wrapper, and --mastra CLI flag enabling `coding --mastra` to start mastracode in standard tmux layout
- Mastra agent registered in tmux statusline (magenta M: prefix), health monitor, process supervisor, and remediation with non-blocking LLM proxy checks
- MastraTranscriptReader watching NDJSON lifecycle hook transcripts with full ETM pipeline integration -- mastra conversations flow through exchange extraction, classification, and LSL output
- hooks.json populated with 6 lifecycle hook commands writing NDJSON transcript events to .observations/transcripts/ for MastraTranscriptReader consumption
- Three-format transcript normalizer (Claude JSONL, Copilot events, specstory markdown) with LLM-proxy-routed observation writer and CLI skeleton
- Claude JSONL and Copilot events.jsonl converter handlers with hardened parsers, exchange grouping, and streaming progress reporting
- Batch .specstory converter with SHA-256 manifest idempotency, chronological processing, and --force override
- ETM fires per-exchange observations via ObservationWriter (fire-and-forget) and health API serves GET /api/observations with agent/time/project/FTS5 filtering
- Observations dashboard with sidebar filters, agent-colored expandable cards, pagination, and 30s auto-refresh via react-router-dom routing

---

## v2.1 Wave Pipeline Quality Restoration (Shipped: 2026-03-10)

**Phases completed:** 6 phases (9-14), 20 plans
**Audit status:** tech_debt (Plan 14-03 deferred — workflow state management needs redesign before E2E verification is meaningful)

**Key accomplishments:**

- Full agent pipeline integration (semantic analysis, persistence, insight generation, ontology classification) into wave architecture
- All 6 KG operators restored (conv, aggr, embed, dedup, pred, merge)
- Content quality gate with QA validation and coordinator retry-with-feedback
- Pipeline observability with trace modal (LLM counts, timing, model info, data flow)
- Code-graph-rag integration as code-evidence source for wave agents
- Relationship diagrams and constraint validation gate (Plans 14-01, 14-02)

**Deferred to v3.0:**

- Plan 14-03: Wave 4 diagram wiring + Docker E2E verification
- Workflow state management redesign (fundamental architecture issue)
- Dashboard substep coloring (blocked by state management issues)
- "Batch" label rename (cosmetic, bundled with state machine work)

### Phases

| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| 9 | Agent Pipeline Integration | 3/3 | Complete (2026-03-07) |
| 10 | KG Operations Restoration | 5/5 | Complete (2026-03-08) |
| 11 | Content Quality Gate | 3/3 | Complete (2026-03-09) |
| 12 | Pipeline Observability | 4/4 | Complete (2026-03-09) |
| 13 | Code Graph Agent Integration | 3/3 | Complete (2026-03-09) |
| 14 | Documentation Generation | 2/3 | Partial (14-03 deferred) |

## v1.0 UKB Pipeline Fix & Improvement (Shipped: 2026-03-03)

**Phases completed:** 2 phases (1 + 4), 9 plans
**Audit status:** tech_debt (12/12 executed requirements satisfied, Phases 2-3 deferred)

**Key accomplishments:**

- Multi-format pattern extraction parser (JSON + markdown + LLM retry) with generic name filtering
- Correct PascalCase entity naming across all 7 naming paths
- LLM-synthesized observations in all 4 observation creation methods
- Configurable analysisDepth parameter (surface/deep/comprehensive)
- TypeScript interfaces extended with hierarchy fields across 4 systems (KGEntity, SharedMemoryEntity, VKB Entity/Node)
- Component manifest (8 L1 + 5 L2 components) and ontology types (Component/SubComponent)

**Deferred to future milestones:**

- Phase 2: Insight Generation & Data Routing (7 requirements)
- Phase 3: Significance & Quality Ranking (2 requirements)

**Known gaps:**

- SC-2 (hierarchy field round-trip persistence) deferred to Phase 5
- 4 human verification items pending runtime confirmation

### Phases

| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| 1 | Core Pipeline Data Quality | 7/7 | Complete (2026-03-02) |
| 2 | Insight Generation & Data Routing | 0/? | Deferred |
| 3 | Significance & Quality Ranking | 0/? | Deferred |
| 4 | Schema & Configuration Foundation | 2/2 | Complete (2026-03-01) |
